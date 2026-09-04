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
import { partsCouvertesExactes } from './distances.js';

const CONNECTEUR = 'apicarto_gpu';

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
  return jsonExterne<FeatureCollection<P>>(url, { connecteur: CONNECTEUR });
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
