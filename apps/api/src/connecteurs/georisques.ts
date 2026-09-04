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

import type { Eau, Risques, SeveritePlanPpr, Topographie } from '@enr/core';
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

/**
 * Taille de page demandee a Georisques.
 *
 * Le service accepte davantage, mais une page trop grande allonge la reponse sans reduire le
 * nombre de requetes dans les cas courants (la plupart des communes ont moins de 100 objets).
 */
const TAILLE_PAGE = 100;

/**
 * Nombre maximal de pages parcourues.
 *
 * Garde-fou de volumetrie : au-dela, on prefere une valeur MINOREE ET SIGNALEE a une rafale de
 * requetes. Le cas ne se presente pas sur les compteurs du referentiel, dont les courbes de score
 * saturent bien avant (8 mouvements de terrain, 12 cavites, 12 sites pollues).
 */
const PAGES_MAX = 10;

/**
 * Pagination des reponses Georisques.
 *
 * POURQUOI. Les longueurs de ces listes servent de COMPTEURS au snapshot
 * (`mouvementsTerrain`, `cavitesProches`, `sitesPollues`). La version precedente demandait
 * `page_size: 50` et renvoyait `rep.data ?? []` sans jamais lire `results` ni `total_pages` :
 * Menton annoncait 148 mouvements de terrain pour 50 renvoyes, Lyon 214 sites pollues, Paris
 * 199 ICPE. L'effet sur la note etait nul — les courbes saturent avant 50 — mais la fiche
 * ecrivait « 50 mouvement(s) de terrain » la ou il y en avait 148, et ce meme 50 revenait a
 * l'identique sur toutes les communes concernees.
 *
 * `complet` distingue les trois etats qui comptent : total atteint, total tronque par le
 * garde-fou, ou source muette. Un compteur incomplet doit pouvoir etre signale comme minore.
 */
interface ListePaginee<T> {
  objets: T[];
  /** `true` si tous les objets annonces par le service ont ete recuperes. */
  complet: boolean;
  /** Total annonce par le service, `null` s'il ne l'annonce pas. */
  totalAnnonce: number | null;
}

async function paginer<T>(
  chemin: string,
  params: Record<string, string | number | undefined>,
  cle: 'data' | 'content',
  paramPage: 'page' | 'pageNumber',
  paramTaille: 'page_size' | 'pageSize',
  /** Georisques numerote `page` a partir de 1, et `pageNumber` a partir de 0. */
  premierePage: number,
): Promise<ListePaginee<T> | null> {
  try {
    const objets: T[] = [];
    let totalAnnonce: number | null = null;
    let complet = true;

    for (let i = 0; i < PAGES_MAX; i += 1) {
      const url = avecParams(`${config.sources.georisques}/v1/${chemin}`, {
        ...params,
        [paramTaille]: TAILLE_PAGE,
        [paramPage]: premierePage + i,
      });
      const rep = await jsonExterne<EnveloppeA<T> & EnveloppeB<T>>(url, {
        connecteur: CONNECTEUR,
        timeoutMs: 25000,
      });
      const lot = (cle === 'data' ? rep.data : rep.content) ?? [];
      objets.push(...lot);
      totalAnnonce = rep.results ?? rep.totalElements ?? totalAnnonce;

      // Fin normale : le service a annonce un total et on l'a atteint, ou la page est incomplete.
      if (totalAnnonce != null && objets.length >= totalAnnonce) break;
      if (lot.length < TAILLE_PAGE) break;
      // Derniere iteration autorisee alors qu'il reste des objets : on le dit.
      if (i === PAGES_MAX - 1) complet = false;
    }

    if (!complet) {
      journal.warn(
        { chemin, recuperes: objets.length, totalAnnonce },
        `Pagination Georisques interrompue au garde-fou de ${PAGES_MAX} pages : le compte est minore.`,
      );
    }
    return { objets, complet, totalAnnonce };
  } catch {
    return null;
  }
}

/** Points d'entree a enveloppe `{results, page, total_pages, data}`. */
async function formeA<T>(
  chemin: string,
  params: Record<string, string | number | undefined>,
): Promise<ListePaginee<T> | null> {
  return paginer<T>(chemin, params, 'data', 'page', 'page_size', 1);
}

/** Points d'entree a enveloppe `{totalElements, totalPages, pageNumber, content}`. */
async function formeB<T>(
  chemin: string,
  codeInsee: string,
): Promise<ListePaginee<T> | null> {
  return paginer<T>(chemin, { codeInsee }, 'content', 'pageNumber', 'pageSize', 0);
}

/** Compte les objets d'une liste paginee, `null` si la source n'a pas repondu. */
function compter(l: ListePaginee<unknown> | null): number | null {
  return l == null ? null : l.objets.length;
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

/**
 * Rayons d'interrogation des comptages de proximite, en metres.
 *
 * NOMMES ET EXPORTES parce qu'ils doivent etre AFFICHES. Le rayon des cavites etait ecrit en dur a
 * 1 000 m dans la requete, documente « dans un rayon de 500 m » dans le type, affiche « cavite(s)
 * < 500 m » par le moteur et « Cavites souterraines (< 1 km) » par la fiche : trois valeurs annoncees
 * pour un seul nombre, dont deux fausses. Un chiffre dont le perimetre n'est pas celui annonce est
 * inexploitable — le lecteur ne peut pas savoir ce qu'il compte.
 */
export const RAYON_CAVITES_M = 1000;
export const RAYON_MOUVEMENTS_M = 1000;

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
export function famillesRisque(libelle: string | null | undefined): FamilleRisque[] {
  const brut = (libelle ?? '').trim();
  if (brut === '') return [];
  // `_` est un caractere de MOT en regex : sans cette normalisation, `\bppri\b` ne matche pas
  // `ppri_lez_mosson`. Et decouper le libelle pour en extraire un « sigle » detruirait les sigles
  // composes : `'PPRN-I'.split(/[\s\-_]/)[0]` vaut `pprn`.
  const l = brut.toLowerCase().replace(/_/g, ' ');
  const trouvees = new Set<FamilleRisque>();

  // --- Sigles de type ------------------------------------------------------
  // ACCUMULATIF et non exclusif : un meme plan peut couvrir plusieurs risques.
  if (/\bppr[nt]?-?if\b|\bpprif\b/.test(l)) trouvees.add('incendie');
  // `mt` est un sigle de mouvement de terrain releve a cote de `mvt` : « PPRN-MT - ... ».
  if (/\bppr[nt]?-?mvt\b|\bpprmvt\b|\bppr[nt]?-?mt\b/.test(l)) trouvees.add('mouvement');
  if (/\bppr[nt]?-?rga\b/.test(l)) trouvees.add('argiles');
  if (/\bppr[nt]?-?s\b/.test(l)) trouvees.add('seisme');
  if (/\bpprt\b/.test(l)) trouvees.add('technologique');
  // `pi` et `pprnpi` sont deux ecritures de l'inondation relevees dans Gaspar : « PPRNPi - ... »
  // (plan de prevention des risques naturels previsibles inondation) et « ... - Pi - ... ».
  if (
    /\bppri\b|\bpprl\b|\bppr[nt]?-?i\b|\bppr[nt]?-?sm\b|\bper-?i\b|\bpprn-?pi\b|\bpi\b/.test(l)
  ) {
    trouvees.add('inondation');
  }

  // --- Plans multirisques --------------------------------------------------
  // Releve reel : « PER-Multi [ MVT & S ] - Menton 2001 ». Le type n'est pas dans le sigle de
  // tete mais dans une liste entre crochets. Les jetons nus (`s`, `i`) ne sont interpretes QUE
  // dans ce contexte : hors crochets, un `s` isole matcherait n'importe quel mot.
  if (/multi/.test(l)) {
    const JETONS: Record<string, FamilleRisque> = {
      i: 'inondation', sm: 'inondation', l: 'inondation',
      if: 'incendie', mvt: 'mouvement', rga: 'argiles', s: 'seisme', t: 'technologique',
    };
    for (const bloc of l.match(/\[([^\]]*)\]/g) ?? []) {
      for (const jeton of bloc.replace(/[[\]]/g, '').split(/[&,+/]|\bet\b/)) {
        const f = JETONS[jeton.trim()];
        if (f) trouvees.add(f);
      }
    }
  }

  // --- Repli sur les mots entiers -----------------------------------------
  // N'intervient que si aucun sigle n'a parle : un libelle redige peut nommer plusieurs risques.
  if (trouvees.size === 0) {
    if (/inondation|submersion|crue|littoral|d[eé]bordement|ruissellement/.test(l)) trouvees.add('inondation');
    if (/for[eê]t|incendie|\bfeu/.test(l)) trouvees.add('incendie');
    if (/technolog|industriel|seveso/.test(l)) trouvees.add('technologique');
    if (/mouvement|glissement|[eé]boulement|effondrement|cavit/.test(l)) trouvees.add('mouvement');
    if (/argile|retrait[- ]gonflement|s[eé]cheresse/.test(l)) trouvees.add('argiles');
    if (/s[eé]isme|sismique/.test(l)) trouvees.add('seisme');
  }

  // Vide : « PPR Bordeaux (revision) » n'a aucune nature lisible. On ne range pas au hasard.
  return [...trouvees];
}

/**
 * Famille unique d'un plan, ou `null`.
 *
 * Conservee pour les usages qui n'attendent qu'une reponse ; renvoie `null` des lors que le plan
 * couvre plusieurs risques, car en choisir un serait arbitraire.
 */
export function familleRisque(libelle: string | null | undefined): FamilleRisque | null {
  const f = famillesRisque(libelle);
  return f.length === 1 ? f[0]! : null;
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
  severiteMax: SeveritePlanPpr | null;
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
/**
 * Une famille de risque est-elle presente, absente, ou inconnue ?
 *
 * Extraite de `risquesEtEau` pour etre TESTABLE : la logique vivait dans une fermeture au milieu
 * d'une fonction qui fait quinze appels reseau, si bien qu'aucun test ne pouvait l'atteindre. C'est
 * une des raisons pour lesquelles le defaut B5 a survecu a l'audit 7, ou il avait pourtant ete
 * decrit.
 */
export function presenceFamille(args: {
  /** La liste des plans a-t-elle ete recue ? `false` = appel en echec. */
  listeRecue: boolean;
  /** Au moins un plan a-t-il ete range dans cette famille ? */
  aFamille: boolean;
  /** Au moins un plan existe-t-il dont le libelle n'a pas pu etre classe ? */
  aIndetermine: boolean;
  /** Le classement de cette famille repose-t-il sur le libelle, donc faillible ? */
  incertainSiIndetermine: boolean;
}): boolean | null {
  if (!args.listeRecue) return null;
  if (args.aFamille) return true;
  // Rien dans cette famille. Est-ce une absence, ou une ignorance ? Un plan illisible venant de
  // `gaspar/pprn` peut etre un PPRI : affirmer `false` serait nier ce qu'on vient de lire.
  if (args.incertainSiIndetermine && args.aIndetermine) return null;
  return false;
}

/**
 * Alea d'inondation a l'echelle de la PARCELLE.
 *
 * Extraite pour la meme raison que `presenceFamille`, et parce que les deux defauts qu'elle corrige
 * (B3 et B4 de l'audit 8) sont des erreurs de logique booleenne : le seul moyen de prouver qu'elles
 * sont mortes est d'enumerer les combinaisons.
 *
 * La seule donnee PARCELLAIRE disponible est le zonage TRI, qui est une geometrie. Le PPR est un
 * fait COMMUNAL : il ne peut ni etablir ni ecarter un alea sur une parcelle donnee. Il peut
 * seulement empecher de conclure a l'absence.
 */
export function aleaInondation(args: {
  /** Le zonage TRI (geometrie) a-t-il repondu ? */
  zonageTriConnu: boolean;
  /** La parcelle est-elle dans un zonage TRI ? */
  dansZonageTri: boolean;
  /** La liste des TRI de la commune a-t-elle repondu ? */
  triConnu: boolean;
  /** La liste des PPRN de la commune a-t-elle repondu ? */
  pprnConnu: boolean;
  /** Un PPR d'inondation pese-t-il sur la commune ? */
  ppriSurLaCommune: boolean;
  /** Un plan existe-t-il dont la famille n'a pas pu etre determinee ? */
  planIndetermine: boolean;
}): 'nul' | 'moyen' | 'fort' | null {
  // Un zonage TRI contenant la parcelle est un fait parcellaire etabli.
  if (args.dansZonageTri) return 'fort';
  // Sans le fait parcellaire, aucune conclusion possible.
  if (!args.zonageTriConnu || !args.triConnu) return null;
  // Le zonage TRI ne contient pas la parcelle. Conclure a un alea nul exige de savoir qu'aucun plan
  // de prevention d'inondation ne pese sur la commune : sinon la parcelle est peut-etre en zone
  // d'alea du reglement graphique, que l'application ne lit pas.
  if (!args.pprnConnu || args.ppriSurLaCommune || args.planIndetermine) return null;
  return 'nul';
}

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
    formeA<CompteSeul>('cavites', { latlon: latlon(centroide), rayon: RAYON_CAVITES_M }),
    /**
     * PAR PROXIMITE, ET NON PAR COMMUNE.
     *
     * Cet appel valait `{ code_insee: codeInsee }`, et son resultat alimentait
     * `topographie.mouvementsTerrain`, presente comme « mouvements de terrain recenses A PROXIMITE » et
     * note sur une echelle locale : 1 mouvement vaut 75/100, 3 valent 50, 8 valent 20.
     *
     * Un comptage COMMUNAL sur une echelle LOCALE, c'est la faute corrigee pour l'alea d'inondation a
     * l'audit 8, avec un effet plus fort. Mesure sur Nice : 28 mouvements a l'echelle de la commune,
     * mais UN SEUL dans un rayon de 1 km autour d'un point donne. Le critere notait donc 20/100 la ou
     * la proximite reelle valait 75 — 55 points d'ecart, sur chaque parcelle de la commune, sur un fait
     * qui ne dit rien de la parcelle : une commune de montagne accumule des eboulements historiques
     * repartis sur cinquante kilometres carres.
     *
     * Le point d'entree accepte `latlon` et `rayon`, exactement comme celui des cavites. Il n'y avait
     * aucune raison de s'en priver.
     */
    formeA<CompteSeul>('mvt', { latlon: latlon(centroide), rayon: RAYON_MOUVEMENTS_M }),
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
  const classer = (p: PprBrut, familles: readonly FamilleRisque[]): void => {
    if (familles.length === 0) {
      if (p.libPpr) indetermines.push(p);
      return;
    }
    // Un plan multirisque compte dans CHACUNE de ses familles : « PER-Multi [ MVT & S ] »
    // (Menton) releve du mouvement de terrain et du seisme, pas de l'un au choix.
    for (const f of familles) parFamille.set(f, [...(parFamille.get(f) ?? []), p]);
  };

  // LA PROVENANCE EST UN CLASSIFIEUR, et le plus fiable des deux. Tout plan renvoye par
  // `gaspar/pprt` est technologique par construction du point d'entree, quel que soit son
  // libelle — « Vallee de la chimie » (Lyon) n'en porte aucun sigle, et fusionner les deux
  // listes avant de classer faisait perdre cette information : le PPRT de Lyon ressortait absent.
  for (const p of pprt?.objets ?? []) classer(p, ['technologique']);
  // Les plans naturels, eux, se classent au libelle : `gaspar/pprn` en melange les familles.
  for (const p of pprn?.objets ?? []) classer(p, famillesRisque(p.libPpr));
  if (indetermines.length > 0) {
    // Un plan existe mais sa nature est illisible : ne pas le ranger au hasard, et ne pas le
    // taire non plus. `PPR Bordeaux (revision)` est le cas reel qui impose cette branche.
    journal.warn(
      { codeInsee, libelles: indetermines.map((p) => p.libPpr) },
      'PPR dont le libelle ne permet pas de déterminer la famille de risque : compte comme présent ' +
        'sans famille, plutôt que range par défaut. Les familles séisme et argiles sont reconnues mais ' +
        "ne portent aucun critère du référentiel : elles n'apparaissent donc pas dans la fiche.",
    );
  }

  /**
   * Severite maximale des zones d'une famille, si le plan l'expose.
   * `null` quand aucun plan de cette famille, ou quand aucun n'expose ses zones.
   */
  const severiteDe = (f: FamilleRisque): SeveritePlanPpr | null => {
    const plans = parFamille.get(f) ?? [];
    const ordre: readonly SeveritePlanPpr[] = [
      'interdiction_stricte',
      'interdiction',
      'prescriptions',
      'precaution',
    ];
    let pire: SeveritePlanPpr | null = null;
    for (const plan of plans) {
      const { severiteMax } = zonesReglementaires(plan);
      if (severiteMax == null) continue;
      if (pire == null || ordre.indexOf(severiteMax) < ordre.indexOf(pire)) pire = severiteMax;
    }
    return pire;
  };

  // `zonage` reste NUL, et ce n'est pas un oubli : l'API n'expose pas la geometrie des zones,
  // donc la zone applicable a la parcelle est inconnue. La severite du plan va dans son propre
  // champ. Les confondre reviendrait a faire lire au moteur une severite de plan la ou il attend
  // une couleur de zone parcellaire — le glissement de sens qui a produit la moitie des defauts
  // de ce projet.
  const plan = (
    liste: ListePaginee<PprBrut> | null,
    famille: FamilleRisque,
    /**
     * Un plan non classable rend-il cette famille INCERTAINE ?
     *
     * Corrige a l'audit 8 (B5). `present` valait `parFamille.has(famille)`, donc `false` des lors
     * qu'aucun plan n'etait range dans la famille — y compris quand un plan EXISTAIT sans que son
     * libelle permette de le classer. Mesure de l'audit 7 : 30 % des communes ayant un PPRN ont au
     * moins un plan dont le libelle n'est pas classable. Sur celles-la, l'application affirmait
     * « pas de PPRI » a propos d'un plan qu'elle venait elle-meme de lire.
     *
     * La regle juste depend de la PROVENANCE, pas de la famille :
     *   - `gaspar/pprn` melange les familles naturelles et se classe au libelle. Un libelle
     *     illisible rend donc chaque famille naturelle INCERTAINE : `null`, et non `false`.
     *   - `gaspar/pprt` est technologique par construction du point d'entree. Aucun libelle n'entre
     *     dans la decision, donc aucun plan illisible ne peut rendre la famille incertaine.
     */
    incertainSiIndetermine: boolean,
  ): { present: boolean | null; zonage: string | null; severitePlan: SeveritePlanPpr | null } => {
    const present = presenceFamille({
      listeRecue: liste != null,
      aFamille: parFamille.has(famille),
      aIndetermine: indetermines.length > 0,
      incertainSiIndetermine,
    });
    // La severite n'a de sens que sur un plan effectivement identifie dans la famille.
    return { present, zonage: null, severitePlan: present === true ? severiteDe(famille) : null };
  };

  const risques: Partial<Risques> = {
    ppri: plan(pprn, 'inondation', true),
    pprif: plan(pprn, 'incendie', true),
    // Provenance = classifieur : aucun libelle n'entre dans la decision, donc aucune incertitude.
    pprt: plan(pprt, 'technologique', false),
    sitesPollues: compter(casias),
    icpeProches: compter(icpe),
    // Les servitudes aeronautiques et les radars ne sont pas exposes par Georisques :
    // ils relevent d'une ingestion dediee (DGAC, Meteo-France) non couverte a ce stade.
    radars: [],
    servitudesAeronautiques: null,
    faisceauxHertziens: null,
    reseauxEnterres: [],
    obligationDebroussaillement: parFamille.has('incendie') ? true : null,
  };

  /**
   * L'ALEA D'INONDATION — deux defauts corriges ici, audit 8 (B3 et B4).
   *
   * Ancienne expression :
   *
   *     alea: triZonage == null && tri == null && pprn == null ? null
   *         : (triZonage?.objets.length ?? 0) > 0 ? 'fort'
   *         : parFamille.has('inondation') ? 'moyen'
   *         : 'nul'
   *
   * DEFAUT 1 — les trois conditions du `null` etaient liees par `&&`. Il fallait que les TROIS
   * appels aient echoue pour que l'alea soit inconnu. Si l'appel TRI reussissait et que l'appel
   * `gaspar/pprn` echouait, `parFamille` etait vide et l'expression tombait sur `'nul'` : un echec
   * de source produisait « alea nul », note 100/100 en VERT. C'est la direction dangereuse de
   * l'erreur — un silence devient une affirmation favorable. Chaque source repond desormais de son
   * seul perimetre, et il faut que TOUTES aient repondu pour conclure a une absence.
   *
   * DEFAUT 2 — `'moyen'` etait deduit de `parFamille`, construit a partir des plans de prevention
   * recenses par Georisques A L'ECHELLE DE LA COMMUNE. L'existence d'un PPRI communal devenait donc
   * « alea moyen » sur CHAQUE parcelle de la commune, y compris sur un plateau a trois kilometres du
   * moindre cours d'eau. 85 % des communes francaises ont un PPRN : le critere passait a 45/100,
   * feu orange, presque partout, et apparaissait en point de vigilance sur la quasi-totalite des
   * parcelles — un signal present partout n'est plus un signal.
   *
   * Un alea est une grandeur PARCELLAIRE. L'application ne dispose, a l'echelle de la parcelle, que
   * du zonage TRI (une geometrie, donc un fait parcellaire). Le PPR communal n'est pas jete pour
   * autant : il reste expose par `risques.ppri`, ou il est a sa juste echelle et correctement
   * qualifie. Ce qui disparait, c'est la traduction abusive d'un fait communal en mesure locale.
   */
  const eau: Partial<Eau> = {
    inondation: {
      zonagePpri: null,
      alea: aleaInondation({
        zonageTriConnu: triZonage != null,
        dansZonageTri: (triZonage?.objets.length ?? 0) > 0,
        triConnu: tri != null,
        pprnConnu: pprn != null,
        ppriSurLaCommune: parFamille.has('inondation'),
        planIndetermine: indetermines.length > 0,
      }),
      dansTri: tri == null ? null : tri.objets.length > 0,
    },
    // Les perimetres de protection de captage relevent des ARS et des SUP du GPU :
    // non exposes de facon homogene, laisses a null (critere gris) plutot qu'inventes.
    captageAep: { dansPerimetre: null, type: null, distanceM: null },
    karst: null,
  };

  const topographie: Partial<Topographie> = {
    aleaArgiles: argiles,
    cavitesProches: compter(cavites),
    mouvementsTerrain: compter(mvt),
  };

  return { risques, eau, topographie, echecs };
}
