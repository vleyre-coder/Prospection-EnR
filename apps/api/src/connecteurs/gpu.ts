/**
 * Connecteur urbanisme - IGN API Carto, module GPU (Geoportail de l'Urbanisme).
 *
 * Fournit le zonage PLU/PLUi/carte communale, les prescriptions (dont EBC et emplacements
 * reserves) et les servitudes d'utilite publique recouvrant une parcelle.
 */

import type { PrescriptionInfo, Urbanisme, ZoneUrbaInfo } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { journal } from '../journal.js';
import { type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import { reparerProprietes } from '../texte.js';
import { partsCouvertesExactes } from './distances.js';

const CONNECTEUR = 'apicarto_gpu';

/**
 * Famille du zonage d'urbanisme, ramenee aux quatre que le classeur nomme.
 *
 * LES LIBELLES REELS SONT UNE CENTAINE. Releve sur la base de reference : « A », « Ap », « N »,
 * « Nj », « 1AUx », « UBa »… Chaque document d'urbanisme invente ses suffixes. Le classeur, lui,
 * raisonne sur quatre familles (« U/AU éco favorable ; A/N défavorable »), et laisser chaque
 * lecteur refaire le prefixe a sa facon garantit qu'un « Ah » sera range en zone A par l'un et en
 * zone inconnue par l'autre.
 *
 * L'ORDRE DES TESTS COMPTE : « AU » doit etre reconnu AVANT « A », sans quoi « 1AUx » tomberait en
 * zone agricole — une zone a urbaniser presentee comme une terre agricole, sur la donnee qui
 * gouverne la constructibilite.
 */
export function familleZone(typeZone: string | null | undefined): 'U' | 'AU' | 'A' | 'N' | null {
  const t = (typeZone ?? '').trim().toUpperCase();
  if (!t) return null;
  // Un chiffre de tete numerote les zones a urbaniser (« 1AU », « 2AUx ») : il se retire.
  const nu = t.replace(/^\d+/, '');
  if (nu.startsWith('AU')) return 'AU';
  if (nu.startsWith('U')) return 'U';
  if (nu.startsWith('A')) return 'A';
  if (nu.startsWith('N')) return 'N';
  return null;
}

/**
 * La famille du zonage qui couvre la plus grande part de la parcelle.
 *
 * DOMINANT SE MESURE, IL NE SE PREND PAS EN PREMIER. 82 des 382 zonages releves portent sur des
 * parcelles a cheval sur plusieurs zones ; retenir le premier de la liste rendrait le resultat
 * dependant de l'ordre de la reponse du GPU, qui n'est pas un ordre de surface.
 *
 * Une part NULLE ne disqualifie pas : c'est le cas quand le calcul d'intersection a echoue, et un
 * zonage unique reste alors le zonage applicable.
 */
export function zoneDominante(
  zonages: ReadonlyArray<{ typeZone: string | null; partRecouvrement: number | null }>,
): 'U' | 'AU' | 'A' | 'N' | null {
  let meilleure: { famille: 'U' | 'AU' | 'A' | 'N'; part: number } | null = null;
  for (const z of zonages) {
    const famille = familleZone(z.typeZone);
    if (famille == null) continue;
    const part = z.partRecouvrement ?? 0;
    if (meilleure == null || part > meilleure.part) meilleure = { famille, part };
  }
  return meilleure?.famille ?? null;
}

interface ProprietesZoneUrba {
  libelle?: string | null;
  libelong?: string | null;
  typezone?: string | null;
  destdomi?: string | null;
  urlfic?: string | null;
  datappro?: string | null;
  partition?: string | null;
  idurba?: string | null;
}

interface ProprietesPrescription {
  typepsc?: string | null;
  libelle?: string | null;
  txt?: string | null;
  nature?: string | null;
}

/**
 * Proprietes du point d'entree `gpu/document`.
 *
 * Le type de document est dans **`du_type`**. Le connecteur lisait `typedoc`, qui n'existe pas
 * dans la reponse : `typeDocument` etait donc TOUJOURS nul, et chaque fiche affichait
 * « Document d'urbanisme : non renseigne ». Verifie sur six communes, `du_type` vaut `PLU` ou
 * `PLUi` — exactement les valeurs que `TYPES_DOCUMENT` sait deja traduire.
 *
 * `datappro` et `nomreg` n'existent pas non plus sur ce point d'entree (la date d'approbation
 * vient de `zone-urba`, qui la porte bien). `name` transporte un identifiant compose du type
 * et de la date, par exemple `75056_PLU_20260616`.
 */
interface ProprietesDocument {
  du_type?: string | null;
  name?: string | null;
  partition?: string | null;
}

interface ProprietesMunicipality {
  partition?: string | null;
  insee?: string | null;
  is_rnu?: boolean | null;
}

/**
 * Codes de prescription du standard CNIG.
 * `01` = espace boise classe, `21` a `23` = emplacements reserves.
 */
function estEbc(typepsc: string | null | undefined): boolean {
  return typepsc === '01';
}

/**
 * Un espace boise classe recouvre-t-il la parcelle ? Trois etats.
 *
 * POURQUOI LE TROISIEME. La couche des prescriptions rend une liste vide aussi bien pour un
 * territoire sans EBC que pour un territoire dont le document n'est pas publie au GPU. Compter le
 * second pour une absence d'EBC ferait conclure « contrainte respectee » — redhibitoire, dans le
 * sens favorable — sur une question jamais posee.
 *
 * LIMITE CONNUE, ET ELLE VAUT D'ETRE ECRITE : `estEbc` repose sur le code CNIG `01`, et AUCUNE des
 * 301 parcelles de la base de reference n'en porte. Des sondages sur une dizaine de communes
 * francaises n'en ont pas fait apparaitre non plus. La branche `true` n'est donc exercee que par
 * le test unitaire ; le jour ou une parcelle en portera un, c'est cette fonction qu'il faudra
 * confronter a la realite du terrain avant de croire le verdict.
 */
export function presenceEbc(
  prescriptions: ReadonlyArray<{ estEbc: boolean }>,
  couvertParGpu: boolean | null,
): boolean | null {
  if (prescriptions.some((p) => p.estEbc)) return true;
  // Sans document publie, l'absence de prescription ne prouve rien.
  return couvertParGpu === true ? false : null;
}

function estEmplacementReserve(typepsc: string | null | undefined): boolean {
  return typepsc != null && ['21', '22', '23'].includes(typepsc);
}

/**
 * Correspondance des valeurs de `du_type` vers le type du snapshot.
 *
 * Les cles sont en MAJUSCULES parce que la valeur est normalisee avant la recherche : une cle
 * `PLUi` serait inatteignable. `PLUi` (observe) arrive donc ici sous `PLUI`.
 */
const TYPES_DOCUMENT: Record<string, Urbanisme['typeDocument']> = {
  // `PLU` et `PLUI` sont les deux seules valeurs observees sur le service ; `POS` et `CC`
  // etaient deja prevues. Rien d'autre n'est ajoute ici sans avoir ete constate : un type non
  // repertorie declenche un avertissement et reste non renseigne.
  PLU: 'PLU',
  PLUI: 'PLUi',
  POS: 'POS',
  CC: 'CC',
};

async function interroger<P>(chemin: string, geom: GeoJsonGeometry): Promise<FeatureCollection<P>> {
  const url = avecParams(`${config.sources.apicarto}/gpu/${chemin}`, { geom: geomParam(geom) });
  const collection = await jsonExterne<FeatureCollection<P>>(url, { connecteur: CONNECTEUR });
  /*
   * REPARATION D'UN DOUBLE ENCODAGE VENU DE LA SOURCE, faite ici et pas au cas par cas.
   *
   * Le GPU republie certains libelles encodes deux fois en UTF-8 : `nomsuplitt` valait
   * « ChÃ¢teau de VilleprÃ©vost », verifie octet par octet sur le service (voir `texte.ts`). Ces
   * libelles partent dans le dossier de site remis a un developpeur.
   *
   * Au niveau du POINT D'ENTREE et non des trois ou quatre champs concernes : rien ne garantit que
   * `nomsuplitt` soit le seul touche, et un champ ajoute demain heriterait de la reparation sans
   * qu'il faille y penser. Le cout est nul quand il n'y a rien a reparer — la fonction sort sur un
   * test de presence de « Ã » ou « Â ».
   */
  return {
    ...collection,
    features: (collection.features ?? []).map((f) => ({
      ...f,
      properties: reparerProprietes(f.properties),
    })),
  };
}

/**
 * Recupere l'ensemble des informations d'urbanisme d'une parcelle.
 * Chaque sous-appel echoue independamment : un echec laisse le champ correspondant a null
 * plutot que d'invalider tout le bloc.
 */
export async function urbanismeParcelle(
  geom: GeoJsonGeometry,
  surfaceParcelleM2: number,
): Promise<{ urbanisme: Partial<Urbanisme>; echecs: string[] }> {
  const echecs: string[] = [];
  const urbanisme: Partial<Urbanisme> = {};

  const [zones, prescriptions, documents, municipality, sups] = await Promise.allSettled([
    interroger<ProprietesZoneUrba>('zone-urba', geom),
    interroger<ProprietesPrescription>('prescription-surf', geom),
    interroger<ProprietesDocument>('document', geom),
    interroger<ProprietesMunicipality>('municipality', geom),
    interroger<{ suptype?: string | null; nomsuplitt?: string | null }>('assiette-sup-s', geom),
  ]);

  if (zones.status === 'fulfilled') {
    void surfaceParcelleM2;
    urbanisme.zonages = zones.value.features.map<ZoneUrbaInfo>((f) => ({
      libelle: f.properties.libelle ?? f.properties.libelong ?? null,
      typeZone: f.properties.typezone ?? null,
      destinationDominante: f.properties.destdomi ?? null,
      urlReglement: f.properties.urlfic ?? null,
      dateApprobation: f.properties.datappro ?? null,
      // Renseigne juste apres, en une seule requete PostGIS pour toutes les zones.
      partRecouvrement: null,
    }));

    // L'API renvoie la geometrie du zonage ENTIER, pas l'intersection : la part couverte doit
    // donc etre calculee. Ce champ designe le zonage DOMINANT, qui gouverne un knock-out : il
    // doit mesurer ce qu'il pretend mesurer, et l'intersection exacte de PostGIS vaut mieux
    // qu'un echantillonnage de 1 600 points execute sur la boucle d'evenements.
    const parts = await partsCouvertesExactes(
      geom,
      zones.value.features.map((f) => (f.geometry as GeoJsonGeometry | null) ?? null),
    );
    for (let i = 0; i < (urbanisme.zonages?.length ?? 0); i += 1) {
      urbanisme.zonages![i]!.partRecouvrement = parts[i] ?? null;
    }
    urbanisme.familleZoneDominante = zoneDominante(urbanisme.zonages ?? []);
  } else {
    echecs.push('gpu/zone-urba');
  }

  if (prescriptions.status === 'fulfilled') {
    urbanisme.prescriptions = prescriptions.value.features.map<PrescriptionInfo>((f) => ({
      type: f.properties.typepsc ?? null,
      libelle: f.properties.libelle ?? f.properties.txt ?? f.properties.nature ?? null,
      estEbc: estEbc(f.properties.typepsc),
      estEmplacementReserve: estEmplacementReserve(f.properties.typepsc),
    }));
    // Pose provisoirement sans le document : `couvertParGpu` n'est connu qu'apres l'appel
    // `municipality`, plus bas, ou la valeur est recalculee avec les trois etats.
    urbanisme.presenceEbc = urbanisme.prescriptions.some((x) => x.estEbc) ? true : null;
  } else {
    echecs.push('gpu/prescription-surf');
  }

  if (documents.status === 'fulfilled') {
    const doc = documents.value.features[0]?.properties;
    const brut = (doc?.du_type ?? '').trim().toUpperCase();
    // Un type inconnu reste NUL et n'est pas requalifie en PLU. Le repli precedent l'aurait
    // fait, et un PSMV ou un SCOT presente comme un PLU est une affirmation fausse sur un
    // document transmis a un tiers — alors qu'un champ vide se lit comme ce qu'il est.
    urbanisme.typeDocument = TYPES_DOCUMENT[brut] ?? null;
    if (brut && !TYPES_DOCUMENT[brut]) {
      journal.warn(
        { du_type: doc?.du_type },
        'Type de document d\'urbanisme inconnu : laisse non renseigne plutôt que requalifie.',
      );
    }
  } else {
    echecs.push('gpu/document');
  }

  if (municipality.status === 'fulfilled') {
    const m = municipality.value.features[0]?.properties;
    // Une commune presente dans le GPU avec is_rnu = true releve du reglement national.
    if (m?.is_rnu === true) {
      urbanisme.typeDocument = 'RNU';
      urbanisme.couvertParGpu = false;
    } else {
      urbanisme.couvertParGpu = municipality.value.features.length > 0;
    }
    /*
     * LE TROISIEME ETAT SE POSE ICI, une fois le document connu. `prescriptions` vaut `[]` quand
     * l'appel a echoue comme quand il n'y a rien : c'est `couvertParGpu` qui distingue les deux.
     */
    if (prescriptions.status === 'fulfilled') {
      urbanisme.presenceEbc = presenceEbc(urbanisme.prescriptions ?? [], urbanisme.couvertParGpu);
    }
  } else {
    echecs.push('gpu/municipality');
  }

  if (sups.status === 'fulfilled') {
    urbanisme.servitudes = sups.value.features
      .map((f) => f.properties.suptype ?? f.properties.nomsuplitt)
      .filter((s): s is string => Boolean(s));
  } else {
    echecs.push('gpu/assiette-sup-s');
  }

  return { urbanisme, echecs };
}

/**
 * Distance a la zone destinee a l'habitation la plus proche (zonages U et AU du document
 * d'urbanisme) - necessaire pour l'application du seuil eolien de 500 m, qui vise aussi
 * les zones destinees a l'habitation et non seulement le bati existant.
 */
export async function distanceZoneHabitat(
  geom: GeoJsonGeometry,
  empriseElargie: GeoJsonGeometry,
): Promise<number | null> {
  try {
    const fc = await interroger<ProprietesZoneUrba>('zone-urba', empriseElargie);
    const habitat = fc.features.filter((f) => {
      const t = (f.properties.typezone ?? '').toUpperCase();
      const d = (f.properties.destdomi ?? '').toUpperCase();
      return /^(U|AU)/.test(t) && !/X|E|I|Y|Z/.test(t.slice(1)) && !d.includes('ACTIVITE');
    });
    if (habitat.length === 0) return null;
    const { distanceMinEntreGeometries } = await import('./distances.js');
    return distanceMinEntreGeometries(
      geom,
      habitat.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean),
    );
  } catch {
    return null;
  }
}
