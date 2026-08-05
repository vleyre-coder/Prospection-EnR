/**
 * Connecteur Georisques (BRGM / MTE).
 *
 * Pieges verifies (docs/API_CONTRACTS.md §6) :
 *   - `latlon` s'ecrit `lon,lat` ; `rayon` est plafonne a 10 000 m ;
 *   - trois enveloppes de reponse coexistent : `{data}` (majorite),
 *     `{content, pageNumber}` (gaspar/ppr*, pagination 0-based, parametre `codeInsee`),
 *     et un objet nu pour `/rga` ;
 *   - `/rga` renvoie un CORPS VIDE avec un HTTP 200 hors zone argileuse : il faut traiter
 *     ce cas comme "alea nul" et non comme une erreur.
 */

import type { Eau, Risques, Topographie } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { journal } from '../journal.js';
import type { Position } from '../geo.js';

const CONNECTEUR = 'georisques';

interface EnveloppeA<T> {
  results?: number;
  page?: number;
  total_pages?: number;
  data?: T[];
}

interface EnveloppeB<T> {
  totalElements?: number;
  totalPages?: number;
  pageNumber?: number;
  content?: T[];
}

function latlon(pt: Position): string {
  return `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
}

async function formeA<T>(
  chemin: string,
  params: Record<string, string | number | undefined>,
): Promise<T[] | null> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/${chemin}`, { page_size: 50, ...params });
    const rep = await jsonExterne<EnveloppeA<T>>(url, { connecteur: CONNECTEUR, timeoutMs: 25000 });
    return rep.data ?? [];
  } catch {
    return null;
  }
}

async function formeB<T>(chemin: string, codeInsee: string): Promise<T[] | null> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/${chemin}`, {
      codeInsee,
      pageSize: 50,
    });
    const rep = await jsonExterne<EnveloppeB<T>>(url, { connecteur: CONNECTEUR, timeoutMs: 25000 });
    return rep.content ?? [];
  } catch {
    return null;
  }
}

/** Alea retrait-gonflement des argiles. Corps vide en HTTP 200 = hors zone argileuse. */
async function aleaArgiles(pt: Position): Promise<Topographie['aleaArgiles']> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/rga`, { latlon: latlon(pt) });
    const rep = await jsonExterne<{ codeExposition?: string; exposition?: string } | string>(url, {
      connecteur: CONNECTEUR,
    });
    // Corps vide (chaine vide) : aucune exposition recensee a ce point.
    if (typeof rep === 'string') return rep.trim() === '' ? 'nul' : null;
    const code = rep.codeExposition;
    if (code == null) return 'nul';
    return code === '1' ? 'faible' : code === '2' ? 'moyen' : code === '3' ? 'fort' : null;
  } catch {
    return null;
  }
}

/**
 * Un plan de prevention des risques, tel que `gaspar/pprn` et `gaspar/pprt` le renvoient.
 *
 * ATTENTION AU NOM DU CHAMP. Le libelle est dans **`libPpr`**. Le connecteur lisait
 * `libelle_risque_long` puis `libelle_risque` : ces deux champs N'EXISTENT PAS. `familleRisque`
 * recevait donc toujours la chaine vide, la table par famille restait vide en toute circonstance,
 * et l'application AFFIRMAIT `ppri.present = false`, `pprif.present = false`,
 * `pprt.present = false` et `inondation.alea = 'nul'` — sur toutes les parcelles de France.
 * Verifie par execution : Arles (PPRN-I submersion marine), Aix (6 PPR), Nice (7 PPR),
 * Montpellier (PPRI + PPRIF) ressortaient tous en « aucun PPR, alea nul ».
 */
interface PprBrut {
  /** Libelle du plan, ex. « PPRN-I - SUB marine - Arles 2015 ». */
  libPpr?: string | null;
  /** Identifiant Gaspar, ex. « 13DDTM20000134 ». */
  idGaspar?: string | null;
  /** Le plan est-il en cours de revision ? */
  etatRevision?: boolean | null;
  /** Bassin de risques, ex. « BV Arc ». */
  libBassinRisques?: string | null;
  /** Zones reglementaires du plan — voir `zonesReglementaires()`. */
  zonageReglementaire?: {
    zoneRegExists?: boolean | null;
    listTypeReg?: Array<{
      code?: string | null;
      libelle?: string | null;
      nom?: string | null;
      codeZone?: string | null;
    }> | null;
  } | null;
}

/**
 * Objet dont SEULE la presence compte : aucun champ n'est lu dessus.
 *
 * Les points d'entree `cavites`, `mvt`, `ssp/casias`, `installations_classees`, `gaspar/tri` et
 * `tri_zonage` ne servent qu'a denombrer. Ils declaraient auparavant des champs (`id_cavite`,
 * `id_mvt`, `nom_usuel`, `raison_sociale`, `libelle_tri`) dont quatre n'existent meme pas dans la
 * reponse — sans consequence puisqu'ils n'etaient pas lus, mais une declaration fausse fait croire
 * a un contrat verifie. C'est exactement le voisinage ou se cachait le defaut des PPR.
 */
type CompteSeul = Record<string, unknown>;

export type FamilleRisque =
  | 'inondation'
  | 'incendie'
  | 'technologique'
  | 'mouvement'
  | 'argiles'
  | 'seisme';

/**
 * Classe un PPR selon la famille de risque qu'il couvre, d'apres son libelle.
 *
 * LE VOCABULAIRE REEL EST CODE, PAS REDIGE. C'est le second etage du defaut corrige ici :
 * renommer le champ `libPpr` ne suffisait pas, car la version precedente cherchait les mots
 * entiers « inondation », « submersion », « incendie », « mouvement ». Les libelles reels releves
 * sur huit communes sont des sigles :
 *
 *   PPRN-I - SUB marine - Arles 2015        inondation   (aucun mot-cle present)
 *   PPRI_Lez_Mosson                          inondation
 *   PPRi-Lezarde                             inondation
 *   PPRL-PANES                               inondation (littoral)
 *   PER-I - BV Paillons [ Nice ] 1999        inondation (plan d'exposition aux risques, ancien)
 *   PPRIF Montpellier                        incendie
 *   PPRN-IF - Aix-en-Provence 2021           incendie
 *   PPRN-MVT - Nice 2020                     mouvement de terrain
 *   PPRN-RGA - Aix-en-Provence 2012          retrait-gonflement des argiles
 *   PPRN-S - seisme_Aix_en_Provence          seisme
 *   PPR Bordeaux (revision)                  INDETERMINE — et doit le rester
 *
 * DEUX PIEGES D'ECRITURE, tous deux rencontres et corriges :
 *   - decouper le libelle pour en extraire un « sigle » detruit les sigles composes :
 *     `PPRN-I`.split(/[\s\-_]/)[0] vaut `pprn`, et aucune regle sur `pprn-i` ne s'applique ;
 *   - `_` est un caractere de MOT en regex, donc `\bppri\b` ne matche pas `ppri_lez_mosson`.
 *     Le libelle est donc normalise (`_` -> espace) avant toute comparaison.
 *
 * L'ORDRE DES REGLES EST SIGNIFIANT : `IF`, `MVT`, `RGA` et `S` se testent avant `I`, dont ils
 * partagent le prefixe.
 */
export function familleRisque(libelle: string | null | undefined): FamilleRisque | null {
  const brut = (libelle ?? '').trim();
  if (brut === '') return null;
  // Normalisation : minuscules, et `_` rendu separateur pour que les limites de mot tiennent.
  const l = brut.toLowerCase().replace(/_/g, ' ');

  // --- Sigles de type, du plus specifique au plus general -------------------
  if (/\bppr[nt]?-?if\b|\bpprif\b/.test(l)) return 'incendie';
  if (/\bppr[nt]?-?mvt\b|\bpprmvt\b/.test(l)) return 'mouvement';
  if (/\bppr[nt]?-?rga\b/.test(l)) return 'argiles';
  if (/\bppr[nt]?-?s\b/.test(l)) return 'seisme';
  if (/\bpprt\b/.test(l)) return 'technologique';
  if (/\bppri\b|\bpprl\b|\bppr[nt]?-?i\b|\bppr[nt]?-?sm\b|\bper-?i\b/.test(l)) {
    return 'inondation';
  }

  // --- Repli sur les mots entiers -----------------------------------------
  if (/inondation|submersion|crue|littoral|d[eé]bordement|ruissellement/.test(l)) return 'inondation';
  if (/for[eê]t|incendie|\bfeu/.test(l)) return 'incendie';
  if (/technolog|industriel|seveso/.test(l)) return 'technologique';
  if (/mouvement|glissement|[eé]boulement|effondrement|cavit/.test(l)) return 'mouvement';
  if (/argile|retrait[- ]gonflement|s[eé]cheresse/.test(l)) return 'argiles';
  if (/s[eé]isme|sismique/.test(l)) return 'seisme';

  // Indetermine : « PPR Bordeaux (revision) » n'a aucune nature lisible. On ne range pas au
  // hasard : un plan de nature inconnue compte comme present sans famille.
  return null;
}

/**
 * Severite maximale des zones reglementaires d'un plan, d'apres `zonageReglementaire`.
 *
 * L'API expose bien les zones du plan, contrairement a ce que le commentaire de ce fichier
 * affirmait. Codes normalises releves sur le service :
 *   01 = prescriptions hors zone d'alea, 02 = prescriptions,
 *   03 = interdiction,                   04 = interdiction stricte, 07 = non identifie.
 *
 * ATTENTION A LA PORTEE, et la fiche doit le dire : ceci designe les zones que le PLAN contient,
 * PAS la zone applicable a la parcelle. Cette derniere reste a lire sur le reglement graphique.
 * Savoir qu'un plan comporte une zone d'interdiction stricte est neanmoins une information
 * materielle : le profil de risque n'est pas celui d'un plan limite a des prescriptions.
 */
export function zonesReglementaires(ppr: PprBrut): {
  severiteMax: 'interdiction_stricte' | 'interdiction' | 'prescriptions' | 'precaution' | null;
  libelles: string[];
} {
  const liste = ppr.zonageReglementaire?.listTypeReg ?? [];
  if (liste.length === 0) return { severiteMax: null, libelles: [] };
  const codes = new Set(liste.map((z) => (z.code ?? '').trim()));
  const severiteMax = codes.has('04')
    ? 'interdiction_stricte'
    : codes.has('03')
      ? 'interdiction'
      : codes.has('02')
        ? 'prescriptions'
        : codes.has('01')
          ? 'precaution'
          : null;
  const libelles = [
    ...new Set(liste.map((z) => (z.nom ?? z.codeZone ?? '').trim()).filter((v) => v !== '')),
  ];
  return { severiteMax, libelles };
}

/**
 * Recupere les risques et contraintes d'eau d'une parcelle.
 *
 * Les PPR sont recenses au niveau COMMUNAL : l'application signale donc la presence d'un
 * PPR, mais ne peut pas determiner le zonage reglementaire applicable a la parcelle
 * (rouge / bleu). Le zonage reste a lire sur le reglement du PPR, ce que la fiche indique.
 */
export async function risquesEtEau(
  centroide: Position,
  codeInsee: string,
): Promise<{
  risques: Partial<Risques>;
  eau: Partial<Eau>;
  topographie: Partial<Topographie>;
  echecs: string[];
}> {
  const echecs: string[] = [];

  const [argiles, cavites, mvt, pprn, pprt, tri, triZonage, casias, icpe] = await Promise.all([
    aleaArgiles(centroide),
    formeA<CompteSeul>('cavites', { latlon: latlon(centroide), rayon: 1000 }),
    formeA<CompteSeul>('mvt', { code_insee: codeInsee }),
    formeB<PprBrut>('gaspar/pprn', codeInsee),
    formeB<PprBrut>('gaspar/pprt', codeInsee),
    formeA<CompteSeul>('gaspar/tri', { code_insee: codeInsee }),
    formeA<CompteSeul>('tri_zonage', { latlon: latlon(centroide) }),
    formeA<CompteSeul>('ssp/casias', { latlon: latlon(centroide), rayon: 500 }),
    formeA<CompteSeul>('installations_classees', {
      latlon: latlon(centroide),
      rayon: 2000,
    }),
  ]);

  if (cavites == null) echecs.push('georisques/cavites');
  if (pprn == null) echecs.push('georisques/gaspar/pprn');
  if (casias == null) echecs.push('georisques/ssp/casias');

  const parFamille = new Map<FamilleRisque, PprBrut[]>();
  /** Plans dont le libelle ne permet pas de determiner la nature du risque. */
  const indetermines: PprBrut[] = [];
  const classer = (p: PprBrut, f: FamilleRisque | null): void => {
    if (!f) {
      if (p.libPpr) indetermines.push(p);
      return;
    }
    parFamille.set(f, [...(parFamille.get(f) ?? []), p]);
  };

  // LA PROVENANCE EST UN CLASSIFIEUR, et le plus fiable des deux. Tout plan renvoye par
  // `gaspar/pprt` est technologique par construction du point d'entree, quel que soit son
  // libelle — « Vallee de la chimie » (Lyon) n'en porte aucun sigle, et fusionner les deux
  // listes avant de classer faisait perdre cette information : le PPRT de Lyon ressortait absent.
  for (const p of pprt ?? []) classer(p, 'technologique');
  // Les plans naturels, eux, se classent au libelle : `gaspar/pprn` en melange les familles.
  for (const p of pprn ?? []) classer(p, familleRisque(p.libPpr));
  if (indetermines.length > 0) {
    // Un plan existe mais sa nature est illisible : ne pas le ranger au hasard, et ne pas le
    // taire non plus. `PPR Bordeaux (revision)` est le cas reel qui impose cette branche.
    journal.warn(
      { codeInsee, libelles: indetermines.map((p) => p.libPpr) },
      'PPR dont le libelle ne permet pas de determiner la famille de risque : compte comme present ' +
        'sans famille, plutot que range par defaut. Les familles seisme et argiles sont reconnues mais ' +
        "ne portent aucun critere du referentiel : elles n'apparaissent donc pas dans la fiche.",
    );
  }

  /**
   * Severite maximale des zones d'une famille, si le plan l'expose.
   * `null` quand aucun plan de cette famille, ou quand aucun n'expose ses zones.
   */
  const zonageDe = (f: FamilleRisque): string | null => {
    const plans = parFamille.get(f) ?? [];
    const ordre = ['interdiction_stricte', 'interdiction', 'prescriptions', 'precaution'] as const;
    let pire: (typeof ordre)[number] | null = null;
    for (const plan of plans) {
      const { severiteMax } = zonesReglementaires(plan);
      if (severiteMax == null) continue;
      if (pire == null || ordre.indexOf(severiteMax) < ordre.indexOf(pire)) pire = severiteMax;
    }
    return pire;
  };

  const risques: Partial<Risques> = {
    ppri:
      pprn == null
        ? { present: null, zonage: null }
        : {
            present: parFamille.has('inondation'),
            // L'API expose les zones que le PLAN contient (`zonageReglementaire.listTypeReg`),
            // et non la zone applicable a la parcelle : celle-la reste a lire sur le reglement
            // graphique, ce que la fiche indique. Savoir qu'un plan comporte une zone
            // d'interdiction stricte reste une information materielle.
            zonage: zonageDe('inondation'),
          },
    pprif:
      pprn == null
        ? { present: null, zonage: null }
        : { present: parFamille.has('incendie'), zonage: zonageDe('incendie') },
    pprt:
      pprt == null
        ? { present: null, zonage: null }
        : { present: parFamille.has('technologique'), zonage: zonageDe('technologique') },
    sitesPollues: casias == null ? null : casias.length,
    icpeProches: icpe == null ? null : icpe.length,
    // Les servitudes aeronautiques et les radars ne sont pas exposes par Georisques :
    // ils relevent d'une ingestion dediee (DGAC, Meteo-France) non couverte a ce stade.
    radars: [],
    servitudesAeronautiques: null,
    faisceauxHertziens: null,
    reseauxEnterres: [],
    obligationDebroussaillement: parFamille.has('incendie') ? true : null,
  };

  const eau: Partial<Eau> = {
    inondation: {
      zonagePpri: null,
      // Le PPR d'inondation pese maintenant reellement : avant la correction du champ `libPpr`,
      // `parFamille` etait toujours vide et cette branche ne pouvait produire que 'nul' ou 'fort'.
      alea:
        triZonage == null && tri == null && pprn == null
          ? null
          : (triZonage?.length ?? 0) > 0
            ? 'fort'
            : parFamille.has('inondation')
              ? 'moyen'
              : 'nul',
      dansTri: tri == null ? null : tri.length > 0,
    },
    // Les perimetres de protection de captage relevent des ARS et des SUP du GPU :
    // non exposes de facon homogene, laisses a null (critere gris) plutot qu'inventes.
    captageAep: { dansPerimetre: null, type: null, distanceM: null },
    karst: null,
  };

  const topographie: Partial<Topographie> = {
    aleaArgiles: argiles,
    cavitesProches: cavites == null ? null : cavites.length,
    mouvementsTerrain: mvt == null ? null : mvt.length,
  };

  return { risques, eau, topographie, echecs };
}
