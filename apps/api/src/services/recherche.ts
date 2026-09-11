/**
 * Recherche unifiee et filtres parametrables.
 *
 * La recherche detecte le type de saisie (IDU, reference cadastrale, coordonnees, adresse,
 * commune, poste source) plutot que d'imposer a l'utilisateur de choisir un mode.
 */

import {
  COEFFICIENT_TRACE,
  composerIdu,
  DEPARTEMENTS,
  FILIERES,
  REGIONS,
  lineaireRaccordementKm,
  STATUTS_PROSPECTION,
  type Feu,
  type Filiere,
  type StatutProspection,
  type TypeSol,
} from '@enr/core';
import { ErreurValidation, lecteur } from '../validation.js';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { requete } from '../bdd.js';
import {
  normaliserNumero,
  normaliserSection,
  // Alias : `parcelleEnResultat` de ce fichier lit la BASE, celle-ci lit le CADASTRE. Les deux noms
  // se ressemblent trop pour cohabiter sans preciser lequel interroge quoi.
  parcelleParIdu as parcelleParIduCadastre,
} from '../connecteurs/cadastre.js';
import { bboxDe, bboxValide, type Bbox } from '../geo.js';

export interface ResultatRecherche {
  type: 'parcelle' | 'adresse' | 'commune' | 'coordonnees' | 'poste_source';
  libelle: string;
  sousTitre: string | null;
  /**
   * Position du resultat, ou `null` quand elle est INCONNUE.
   *
   * Ce champ valait auparavant `[0, 0]` dans ce cas — le golfe de Guinee, presente comme une position
   * reelle. L'interface s'en tirait en comparant a `[0, 0]`, donc un sentinelle circulait dans les deux
   * moitieres de l'application, et rien n'empechait un futur appelant de centrer la carte dessus.
   * `null` dit la meme chose sans mentir, et le compilateur oblige desormais chaque lecteur a traiter
   * le cas.
   */
  centroide: [number, number] | null;
  bbox: Bbox | null;
  idu: string | null;
  codeInsee: string | null;
}

const RE_IDU = /^[0-9]{2}[0-9A-B][0-9]{2}[0-9]{3}[0-9A-Z]{2}[0-9]{4}$/i;
const RE_REFERENCE = /^(\d{5})\s+([0-9A-Z]{1,2})\s+(\d{1,4})$/i;
const RE_COORDONNEES = /^(-?\d{1,3}[.,]\d+)\s*[,;]?\s+(-?\d{1,3}[.,]\d+)$/;

export async function rechercher(q: string, limite = 10): Promise<ResultatRecherche[]> {
  const texte = q.trim();
  if (texte.length < 2) return [];

  // 1. Identifiant unique de parcelle.
  if (RE_IDU.test(texte.replace(/\s/g, ''))) {
    const idu = texte.replace(/\s/g, '').toUpperCase();
    const r = await parcelleDesignee(idu, idu.slice(0, 5), idu.slice(8, 10), idu.slice(10, 14));
    return r ? [r] : [];
  }

  // 2. Reference cadastrale "insee section numero".
  const ref = RE_REFERENCE.exec(texte);
  if (ref) {
    /**
     * Prefixe « 000 » par defaut, et il faut le dire : une reference saisie a la main ne porte pas le
     * prefixe de commune absorbee. Dans une commune fusionnee, deux parcelles de meme section et meme
     * numero coexistent sous deux prefixes ; « 000 » en designe alors une, celle de la commune
     * d'origine. C'est le comportement le plus utile faute de mieux, mais ce n'est pas une certitude.
     */
    const idu = composerIdu({ codeInsee: ref[1]!, section: ref[2]!, numero: ref[3]! });
    const r = await parcelleDesignee(idu, ref[1]!, normaliserSection(ref[2]!), normaliserNumero(ref[3]!));
    return r ? [r] : [];
  }

  // 3. Coordonnees. On accepte les deux ordres et on tranche par plausibilite :
  // en France metropolitaine la latitude est comprise entre 41 et 52, la longitude
  // entre -5 et 10.
  const coord = RE_COORDONNEES.exec(texte);
  if (coord) {
    const a = Number(coord[1]!.replace(',', '.'));
    const b = Number(coord[2]!.replace(',', '.'));
    const aEstLatitude = a >= 40 && a <= 52 && (b < 40 || b > 52);
    const lat = aEstLatitude ? a : b;
    const lon = aEstLatitude ? b : a;
    return [
      {
        type: 'coordonnees',
        libelle: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        sousTitre: aEstLatitude ? 'latitude, longitude' : 'longitude, latitude (ordre inverse detecte)',
        centroide: [lon, lat],
        bbox: null,
        idu: null,
        codeInsee: null,
      },
    ];
  }

  // 4. Adresse, commune et poste source, en parallele.
  const [adresses, postes] = await Promise.all([
    rechercheAdresse(texte, limite).catch(() => []),
    recherchePosteSource(texte, 5).catch(() => []),
  ]);

  return [...postes, ...adresses].slice(0, limite);
}

async function parcelleEnResultat(idu: string): Promise<ResultatRecherche | null> {
  const lignes = await requete<{
    idu: string;
    nom_commune: string | null;
    section: string;
    numero: string;
    code_insee: string;
    lon: number;
    lat: number;
    minlon: number;
    minlat: number;
    maxlon: number;
    maxlat: number;
  }>(
    `SELECT idu, nom_commune, section, numero, code_insee,
            ST_X(centroide) AS lon, ST_Y(centroide) AS lat,
            ST_XMin(geom) AS minlon, ST_YMin(geom) AS minlat,
            ST_XMax(geom) AS maxlon, ST_YMax(geom) AS maxlat
       FROM parcelle WHERE idu = $1`,
    [idu],
  );
  const l = lignes[0];
  if (!l) return null;

  return {
    type: 'parcelle',
    libelle: `Parcelle ${l.section} ${l.numero}`,
    sousTitre: `${l.nom_commune ?? l.code_insee} - ${l.idu}`,
    centroide: [l.lon, l.lat],
    bbox: [l.minlon, l.minlat, l.maxlon, l.maxlat],
    idu: l.idu,
    codeInsee: l.code_insee,
  };
}

/**
 * Une parcelle designee par son identifiant : en base, sinon au cadastre.
 *
 * POURQUOI CETTE FONCTION EXISTE — signalement d'usage. La recherche ne lisait QUE
 * `FROM parcelle WHERE idu = $1`, or cette table ne contient que les parcelles DEJA QUALIFIEES. Taper
 * l'identifiant EXACT d'une parcelle jamais etudiee ne renvoyait donc rien : la parcelle qu'un collegue
 * demandait etait introuvable par son identifiant, en plus d'etre invisible sur la carte.
 *
 * Le repli interroge le cadastre pour CE seul identifiant. C'est proportionne : une requete ciblee,
 * declenchee par une saisie explicite, et non un balayage. Et il n'ECRIT RIEN en base — une recherche
 * est une lecture, et le defaut B4 de l'audit 10 etait precisement un chemin de lecture qui declenchait
 * des ecritures. La parcelle sera enregistree quand l'utilisateur demandera vraiment sa qualification.
 *
 * TROIS ISSUES, ET ELLES SE DISENT DIFFEREMMENT. La version precedente les confondait toutes les trois
 * en un resultat unique place a `[0, 0]` et annonce « a qualifier », ce qui affirmait l'existence d'une
 * parcelle que personne n'avait verifiee :
 *
 *   - connue en base : le resultat porte sa position et son emprise reelles ;
 *   - inconnue en base mais presente au cadastre : position et emprise reelles egalement, et la mention
 *     « a qualifier » — la parcelle existe, l'application ne l'a pas encore etudiee. Ne pas confondre
 *     les deux est la regle fondatrice de ces audits ;
 *   - absente du cadastre : AUCUN resultat. L'identifiant saisi ne designe pas une parcelle ; l'interface
 *     affiche « Aucun resultat », qui est la verite. Inventer une entree conduirait a lancer une
 *     qualification vouee a l'echec ;
 *   - cadastre injoignable : un resultat SANS position, qui dit que la source n'a pas repondu. La
 *     qualification reste possible — c'est le chemin degrade qui existait — mais l'utilisateur sait que
 *     l'existence de la parcelle n'a pas ete verifiee.
 */
async function parcelleDesignee(
  idu: string,
  codeInsee: string,
  section: string,
  numero: string,
): Promise<ResultatRecherche | null> {
  const enBase = await parcelleEnResultat(idu);
  if (enBase) return enBase;

  let brute: Awaited<ReturnType<typeof parcelleParIduCadastre>>;
  try {
    brute = await parcelleParIduCadastre(idu);
  } catch {
    return {
      type: 'parcelle',
      libelle: `Parcelle ${section} ${numero}`,
      sousTitre: `${idu} - cadastre injoignable, existence non verifiee - a qualifier`,
      centroide: null,
      bbox: null,
      idu,
      codeInsee,
    };
  }
  if (!brute) return null;

  return {
    type: 'parcelle',
    libelle: `Parcelle ${brute.section} ${brute.numero}`,
    sousTitre: `${brute.nomCommune ?? brute.codeInsee} - ${brute.idu} - a qualifier`,
    centroide: brute.centroide,
    bbox: brute.geometrie ? bboxDe(brute.geometrie) : null,
    idu: brute.idu,
    codeInsee: brute.codeInsee,
  };
}

interface ProprietesAdresse {
  label?: string;
  context?: string;
  type?: string;
  citycode?: string;
  city?: string;
  postcode?: string;
}

interface ReponseGeocodage {
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: ProprietesAdresse;
  }>;
}

/**
 * Geocodage via la Geoplateforme, avec repli sur api-adresse.data.gouv.fr.
 *
 * Les deux services partagent la meme API (Base Adresse Nationale) mais l'ancien host est
 * deprecie et repond regulierement 503 : le repli evite qu'une indisponibilite ponctuelle
 * prive l'utilisateur de la recherche.
 */
async function rechercheAdresse(q: string, limite: number): Promise<ResultatRecherche[]> {
  const params = { q, limit: limite, autocomplete: 1 };
  let fc: ReponseGeocodage;
  try {
    fc = await jsonExterne<ReponseGeocodage>(
      avecParams(`${config.sources.adresse}/search`, params),
      { connecteur: 'geocodage' },
    );
  } catch {
    fc = await jsonExterne<ReponseGeocodage>(
      avecParams(`${config.sources.adresseRepli}/search/`, params),
      { connecteur: 'geocodage' },
    );
  }

  return fc.features.map((f) => ({
    type: f.properties.type === 'municipality' ? ('commune' as const) : ('adresse' as const),
    libelle: f.properties.label ?? '',
    sousTitre: f.properties.context ?? null,
    centroide: f.geometry.coordinates,
    bbox: null,
    idu: null,
    codeInsee: f.properties.citycode ?? null,
  }));
}

async function recherchePosteSource(q: string, limite: number): Promise<ResultatRecherche[]> {
  const lignes = await requete<{
    id: string;
    nom: string;
    gestionnaire: string;
    etat_saturation: string | null;
    capacite_residuelle_mw: number | null;
    lon: number;
    lat: number;
  }>(
    `SELECT id, nom, gestionnaire, etat_saturation, capacite_residuelle_mw,
            ST_X(geom) AS lon, ST_Y(geom) AS lat
       FROM poste_source
      WHERE nom ILIKE '%' || $1 || '%'
      -- Le nom le plus court d'abord, donc le plus proche de la saisie. Les ex aequo sont nombreux
      -- (tous les postes dont le nom fait le meme nombre de caracteres) et la limite en ecarte une
      -- partie : sans departage, deux saisies identiques ne proposaient pas forcement les memes
      -- postes (audit 9, defaut A1).
      ORDER BY length(nom), nom, id
      LIMIT $2`,
    [q, limite],
  );
  return lignes.map((l) => ({
    type: 'poste_source' as const,
    libelle: `Poste ${l.nom}`,
    sousTitre: `${l.gestionnaire}${l.etat_saturation ? ` - ${l.etat_saturation}` : ''}${
      l.capacite_residuelle_mw != null ? ` - ${l.capacite_residuelle_mw} MW disponibles` : ''
    }`,
    centroide: [l.lon, l.lat] as [number, number],
    bbox: null,
    idu: null,
    codeInsee: null,
  }));
}

// ---------------------------------------------------------------------------
// Filtres parametrables par filiere
// ---------------------------------------------------------------------------

/**
 * Plafond du nombre de resultats par appel.
 *
 * `limite` n'etait pas bornee : `{"limite": 100000}` etait accepte, soit une lecture de toute la
 * table en un seul appel sur une base nationale. 1 000 couvre tous les usages de l'interface
 * (la vue liste en demande 300) tout en gardant la reponse et la requete a une taille tenable.
 */
export const LIMITE_MAX = 1000;
export const LIMITE_DEFAUT = 200;

/**
 * Plafond distinct pour les exports.
 *
 * Un export CSV a besoin de bien plus de lignes qu'une page de liste : c'est son objet. Le
 * plafond doit donc etre EXPLICITE et non herite, sinon l'un des deux usages est mal servi —
 * soit la liste laisse passer une lecture de toute la table, soit l'export est tronque en
 * silence, ce qui est pire puisque le fichier parait complet.
 */
export const LIMITE_MAX_EXPORT = 20_000;
export const LIMITE_DEFAUT_EXPORT = 5000;

export interface FiltresParcelles {
  filiere: Filiere;
  bbox?: Bbox;
  codeDepartement?: string;
  /**
   * PLUSIEURS departements a la fois.
   *
   * POURQUOI CE CHAMP S'AJOUTE A `codeDepartement` AU LIEU DE LE REMPLACER. Le champ singulier est
   * utilise par l'interface existante et par les exports ; le renommer aurait casse les deux pour
   * un gain nul. Les deux se cumulent, et l'un n'exclut pas l'autre.
   *
   * CE QU'IL PERMET, ET C'EST LA DEMANDE DU PROPRIETAIRE : « scanner tout un departement ou toute
   * une region ». Une region se resout en une liste de departements (voir `codeRegion`), et c'est
   * cette liste qui arrive ici.
   */
  codesDepartement?: string[];
  /**
   * UNE REGION ENTIERE, resolue en departements par la table `commune`.
   *
   * La resolution passe par `p.code_departement IN (SELECT ... FROM commune WHERE code_region = ?)`
   * et NON par une jointure sur la commune de chaque parcelle : `parcelle.code_departement` porte
   * un index, `commune.code_region` non. La sous-requete rend une douzaine de codes, le filtre
   * reste donc indexable. Mesure de la table : 34 875 communes, 18 regions, `code_region` renseigne
   * partout — la correspondance vient donc de la DONNEE et n'est codee en dur nulle part.
   */
  codeRegion?: string;
  codeInsee?: string;
  surfaceMinHa?: number;
  surfaceMaxHa?: number;
  distancePosteMaxKm?: number;
  capacitePosteMinMw?: number;
  penteMaxPct?: number;
  scoreMin?: number;
  statutsScore?: Feu[];
  statutsProspection?: StatutProspection[];
  typesSol?: TypeSol[];
  exclureNatura2000?: boolean;
  exclureZoneHumide?: boolean;
  exclureAop?: boolean;
  exclureKnockOuts?: boolean;
  /**
   * Ne retenir que les parcelles situees dans une zone d'acceleration des ENR.
   *
   * Sur une ZAER, l'argument reglementaire est deja acquis par la deliberation : c'est le premier
   * filtre que demande un developpeur qui cherche du foncier defendable rapidement.
   */
  enZaerSeulement?: boolean;
  /**
   * Types de zone du PLU RECOUVRANT la parcelle, au moins en partie.
   *
   * CE N'EST PAS LE ZONAGE DOMINANT, et le libelle de l'interface le dit. Une parcelle a cheval sur
   * une zone A et une zone N est retenue par `['A']` comme par `['N']` : le filtre repond a « cette
   * parcelle touche-t-elle une zone de ce type », qui est la question qu'on se pose en prospection.
   * Annoncer « zonage dominant » demanderait de comparer les parts de recouvrement, ce que le
   * snapshot permet mais qui repond a une AUTRE question.
   */
  typesZonePlu?: string[];
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LE TYPE D'AGRICULTURE DECLARE — codes de groupe de culture du RPG
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * POURQUOI CE CRITERE EXISTE, ET C'EST UNE DEMANDE EXPLICITE. « Un terrain agricole, mais avec
   * un type d'agriculture bien specifique, ca peut etre aussi de l'elevage. » La nature du sol
   * (`typesSol`) dit seulement « agricole exploite » : elle ne distingue pas une prairie paturee
   * d'un champ de ble, alors que ce sont DEUX PROJETS DIFFERENTS. Un agrivoltaisme sur pature se
   * monte avec un eleveur sur une duree compatible avec un cheptel ; sur grandes cultures il se
   * discute en hauteur de structure et en passage d'engins ; sur vigne il appelle des persiennes
   * et une AOC.
   *
   * CE SONT LES CODES QUI VOYAGENT, PAS LES LIBELLES. Le libelle est stocke dans l'instantane tel
   * qu'il etait a la qualification — accents compris ou non, nomenclature de l'epoque. Filtrer
   * dessus ferait dependre le resultat de la DATE de qualification de chaque parcelle. Le code,
   * lui, est stable depuis le millesime 2015. L'interface propose des familles d'usage
   * (`FAMILLES_CULTURE`, dans `@enr/core`) et les traduit en codes avant l'appel.
   */
  groupesCulture?: string[];
  tri?: 'score_desc' | 'score_asc' | 'surface_desc' | 'distance_poste_asc';
  limite?: number;
  decalage?: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE LA RECHERCHE SAIT DU TERRITOIRE QU'ON LUI A DEMANDE DE BALAYER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SANS CE BLOC, « 0 RESULTAT » MENT — et c'est le defaut le plus couteux qu'un outil de recherche
 * puisse avoir. Le proprietaire demande de « scanner tout un departement ou toute une region » pour
 * en sortir les parcelles propices. Or la recherche ne peut porter que sur ce qui a ete QUALIFIE :
 * une campagne d'ingestion couvre quelques milliers de parcelles, un departement en compte des
 * centaines de milliers.
 *
 * « Aucune parcelle ne correspond a vos criteres » et « ce departement n'a jamais ete balaye » sont
 * donc deux phrases radicalement differentes, et l'ancienne reponse `{ total, resultats }` ne
 * permettait pas de les distinguer. Un operateur qui lit la premiere alors que la seconde est vraie
 * conclut qu'il n'y a rien a prospecter — et passe au departement suivant.
 *
 * C'est la meme discipline que `zonesAProspecter`, qui rend sa couverture depuis l'audit 13, pour
 * la meme raison.
 */
export interface CouvertureRecherche {
  /**
   * Les departements sur lesquels la recherche a REELLEMENT porte, resolus depuis les criteres de
   * territoire. Vide quand aucun territoire n'est demande : la recherche porte alors sur toute la
   * base, et `communesDuTerritoire` vaut `null` parce que la question n'a pas de sens.
   */
  departementsDemandes: string[];
  /** Parcelles qualifiees pour cette filiere dans le territoire, AVANT application des criteres. */
  parcellesQualifiees: number;
  /** Communes du territoire portant au moins une parcelle qualifiee. */
  communesAvecParcelle: number;
  /** Communes que compte le territoire. `null` si aucun territoire n'est demande. */
  communesDuTerritoire: number | null;
}

/**
 * Les departements sur lesquels la recherche porte reellement, resolus depuis les criteres.
 *
 * ORDRE DE RESOLUTION, et il compte : une region demandee est developpee en ses departements, puis
 * l'intersection est prise avec les codes explicites s'il y en a. Demander « region Centre-Val de
 * Loire » ET « departement 28 » doit rendre le seul 28, pas les six departements de la region — les
 * criteres se CUMULENT, comme partout ailleurs dans ce filtre.
 */
async function departementsDuTerritoire(f: FiltresParcelles): Promise<string[]> {
  const explicites = new Set<string>();
  if (f.codeDepartement) explicites.add(f.codeDepartement);
  for (const d of f.codesDepartement ?? []) explicites.add(d);

  if (!f.codeRegion) return [...explicites].sort();

  const deLaRegion = await requete<{ code_departement: string }>(
    `SELECT DISTINCT code_departement FROM commune WHERE code_region = $1 ORDER BY 1`,
    [f.codeRegion],
  );
  const codes = deLaRegion.map((d) => d.code_departement);
  if (explicites.size === 0) return codes;
  return codes.filter((c) => explicites.has(c)).sort();
}

/**
 * Ce que la recherche sait du territoire demande — voir `CouvertureRecherche`.
 *
 * LES DEUX COMPTES SONT PRIS SANS LES CRITERES DE L'UTILISATEUR, et c'est tout leur interet : ils
 * repondent a « qu'y a-t-il ici a regarder », pas a « qu'ai-je trouve ». C'est la comparaison des
 * deux qui informe — 12 resultats sur 300 parcelles qualifiees se lit tout autrement que 12 sur
 * 40 000.
 *
 * `codeInsee` et `bbox` ne sont deliberement PAS pris en compte dans le territoire : le premier est
 * une commune precise, ou la question de la couverture ne se pose pas, et le second est l'emprise
 * de la carte, qui n'est pas un territoire administratif. La couverture porte sur ce que
 * l'utilisateur a nomme, pas sur ce qu'il regarde.
 */
async function couvertureDuTerritoire(f: FiltresParcelles): Promise<CouvertureRecherche> {
  const departements = await departementsDuTerritoire(f);
  const restreint = departements.length > 0;

  const [comptes, communes] = await Promise.all([
    requete<{ parcelles: number; communes: number }>(
      `SELECT count(*)::int AS parcelles,
              count(DISTINCT p.code_insee)::int AS communes
         FROM score_parcelle_filiere s
         JOIN parcelle p ON p.idu = s.idu
        WHERE s.filiere = $1 AND s.profil_ponderation = 'defaut'
          ${restreint ? 'AND p.code_departement = ANY($2)' : ''}`,
      restreint ? [f.filiere, departements] : [f.filiere],
    ),
    restreint
      ? requete<{ n: number }>(
          `SELECT count(*)::int AS n FROM commune WHERE code_departement = ANY($1)`,
          [departements],
        )
      : Promise.resolve([]),
  ]);

  return {
    departementsDemandes: departements,
    parcellesQualifiees: comptes[0]?.parcelles ?? 0,
    communesAvecParcelle: comptes[0]?.communes ?? 0,
    communesDuTerritoire: restreint ? (communes[0]?.n ?? 0) : null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES TERRITOIRES QU'ON PEUT REELLEMENT BALAYER, ET CE QU'ILS CONTIENNENT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A QUOI CELA SERT. La demande est de « scanner tout un departement ou toute une region ». Pour
 * cela il faut un selecteur, et un selecteur a besoin de deux choses que deux sources distinctes
 * detiennent :
 *
 *   - les NOMS et le rattachement region -> departement : nomenclature administrative, figee dans
 *     `@enr/core` (`territoires.ts`, relevee sur geo.api.gouv.fr) ;
 *   - ce que le territoire CONTIENT vraiment : communes ingerees et parcelles qualifiees pour la
 *     filiere, que seule la base sait.
 *
 * POURQUOI LES COMPTES FIGURENT DANS LE SELECTEUR ET PAS SEULEMENT DANS LES RESULTATS. Un
 * departement a des centaines de milliers de parcelles cadastrales ; une campagne de qualification
 * en couvre quelques milliers. Proposer les 101 departements comme s'ils etaient equivalents
 * enverrait l'operateur balayer un territoire vide, puis conclure qu'il n'y a rien a y prospecter.
 * Le compte affiche a cote du nom evite ce contresens AVANT la recherche, pas apres.
 */
export interface TerritoireInterrogeable {
  code: string;
  nom: string;
  /** Region de rattachement. `null` pour une region (elle est son propre niveau). */
  codeRegion: string | null;
  /** Communes presentes dans la base pour ce territoire. 0 signifie « jamais ingere ». */
  communes: number;
  /**
   * Parcelles qualifiees pour la filiere demandee. `null` quand aucune filiere n'est precisee :
   * le compte n'a alors pas de sens, et afficher 0 mentirait.
   */
  parcellesQualifiees: number | null;
}

/**
 * Regions et departements interrogeables, avec ce que la base contient de chacun.
 *
 * DEUX REQUETES SEULEMENT, agregees par departement, puis les regions sont recomposees en
 * memoire depuis la nomenclature. Une requete par territoire — 119 aller-retours — aurait ete
 * l'ecriture naive ; le selecteur s'ouvre a chaque changement de filiere.
 */
export async function territoiresInterrogeables(
  filiere?: Filiere,
): Promise<{ regions: TerritoireInterrogeable[]; departements: TerritoireInterrogeable[] }> {
  const [communes, parcelles] = await Promise.all([
    requete<{ code_departement: string; n: number }>(
      `SELECT code_departement, count(*)::int AS n FROM commune GROUP BY 1`,
    ),
    filiere
      ? requete<{ code_departement: string; n: number }>(
          `SELECT p.code_departement, count(*)::int AS n
             FROM score_parcelle_filiere s
             JOIN parcelle p ON p.idu = s.idu
            WHERE s.filiere = $1 AND s.profil_ponderation = 'defaut'
            GROUP BY 1`,
          [filiere],
        )
      : Promise.resolve([]),
  ]);

  const parDep = new Map(communes.map((c) => [c.code_departement, c.n]));
  const parcParDep = new Map(parcelles.map((p) => [p.code_departement, p.n]));

  const departements: TerritoireInterrogeable[] = DEPARTEMENTS.map((d) => ({
    code: d.code,
    nom: d.nom,
    codeRegion: d.codeRegion,
    communes: parDep.get(d.code) ?? 0,
    parcellesQualifiees: filiere ? (parcParDep.get(d.code) ?? 0) : null,
  }));

  const regions: TerritoireInterrogeable[] = REGIONS.map((r) => {
    const siens = departements.filter((d) => d.codeRegion === r.code);
    return {
      code: r.code,
      nom: r.nom,
      codeRegion: null,
      communes: siens.reduce((s, d) => s + d.communes, 0),
      parcellesQualifiees: filiere
        ? siens.reduce((s, d) => s + (d.parcellesQualifiees ?? 0), 0)
        : null,
    };
  });

  return { regions, departements };
}

export interface LigneResultatFiltre {
  idu: string;
  nomCommune: string | null;
  section: string;
  numero: string;
  surfaceHa: number | null;
  statutScore: Feu | null;
  scoreGlobal: number | null;
  /**
   * Nombre de criteres redhibitoires NON derogeables. Remonte jusqu'au client parce que
   * le statut seul ne distingue pas une parcelle mal notee d'une parcelle
   * reglementairement exclue : les deux sont rouges.
   */
  nbKnockOutsBloquants: number;
  statutProspection: StatutProspection | null;
  /** Vol d'oiseau, tel que mesure. */
  distancePosteKm: number | null;
  /** Lineaire de trace estime : la grandeur notee, et celle qui se paie. */
  lineaireRaccordementKm: number | null;
  pentePct: number | null;
  typeSol: string | null;
  centroide: [number, number];
}

/**
 * Recherche filtree sur les parcelles qualifiees.
 *
 * Les criteres portant sur le snapshot (pente, type de sol, zone humide...) sont evalues
 * directement en JSONB : cela evite de dupliquer ces colonnes tout en restant indexable.
 */
export async function filtrerParcelles(
  f: FiltresParcelles,
  /**
   * Plafond du nombre de lignes. Passe explicitement par les exports, qui ont besoin de plus que
   * la liste. Le defaut protege les appelants qui ne s'en preoccupent pas.
   */
  limiteMax: number = LIMITE_MAX,
): Promise<{ total: number; resultats: LigneResultatFiltre[]; couverture: CouvertureRecherche }> {
  const conditions: string[] = ['s.filiere = $1', `s.profil_ponderation = 'defaut'`];
  const params: unknown[] = [f.filiere];

  const ajouter = (sql: string, valeur: unknown): void => {
    params.push(valeur);
    conditions.push(sql.replace('$?', `$${params.length}`));
  };

  if (f.bbox) {
    params.push(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]);
    conditions.push(
      `p.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }
  if (f.codeDepartement) ajouter('p.code_departement = $?', f.codeDepartement);
  if (f.codesDepartement?.length) ajouter('p.code_departement = ANY($?)', f.codesDepartement);
  if (f.codeRegion) {
    /*
     * La region se resout en departements par sous-requete, et non par jointure sur la commune de
     * chaque parcelle : `parcelle.code_departement` porte un index, `commune.code_region` non. La
     * sous-requete rend une douzaine de codes ; le filtre reste indexable.
     */
    ajouter(
      `p.code_departement IN (
         SELECT DISTINCT code_departement FROM commune WHERE code_region = $?
       )`,
      f.codeRegion,
    );
  }
  if (f.codeInsee) ajouter('p.code_insee = $?', f.codeInsee);
  if (f.surfaceMinHa != null) ajouter('COALESCE(p.surface_calculee_m2, p.contenance_m2) >= $? * 10000', f.surfaceMinHa);
  if (f.surfaceMaxHa != null) ajouter('COALESCE(p.surface_calculee_m2, p.contenance_m2) <= $? * 10000', f.surfaceMaxHa);
  if (f.scoreMin != null) ajouter('s.score_global >= $?', f.scoreMin);
  if (f.statutsScore?.length) ajouter('s.statut = ANY($?)', f.statutsScore);
  if (f.statutsProspection?.length) ajouter('l.statut = ANY($?)', f.statutsProspection);
  // Les knock-outs derogeables (STECAL, modification de PLU) ne justifient pas d'ecarter
  // une parcelle de la liste : seuls les bloquants le font.
  if (f.exclureKnockOuts) conditions.push('s.nb_knock_outs_bloquants = 0');

  if (f.distancePosteMaxKm != null) {
    // Le seuil saisi est un budget de LINEAIRE de trace, comme le rayon dessine sur la
    // carte et comme la grandeur notee par le critere de raccordement. Le snapshot ne
    // stocke que le vol d'oiseau : c'est donc lui qu'on majore, en SQL, pour rester
    // indexable et n'avoir aucune ligne a filtrer cote applicatif.
    ajouter(
      `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric` +
        ` * ${COEFFICIENT_TRACE} <= $?`,
      f.distancePosteMaxKm,
    );
  }
  if (f.capacitePosteMinMw != null) {
    ajouter(
      `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'capaciteResiduelleMw')::numeric >= $?`,
      f.capacitePosteMinMw,
    );
  }
  if (f.penteMaxPct != null) {
    ajouter(`(sn.snapshot -> 'topographie' ->> 'pentePct')::numeric <= $?`, f.penteMaxPct);
  }
  if (f.typesSol?.length) {
    ajouter(`(sn.snapshot -> 'occupationSol' ->> 'typeSol') = ANY($?)`, f.typesSol);
  }
  if (f.exclureZoneHumide) {
    conditions.push(`COALESCE(sn.snapshot -> 'eau' ->> 'zoneHumide', 'non') <> 'oui'`);
  }
  if (f.exclureAop) {
    conditions.push(`COALESCE((sn.snapshot -> 'occupationSol' -> 'aop' ->> 'presente')::boolean, false) = false`);
  }
  if (f.exclureNatura2000) {
    conditions.push(
      `COALESCE((sn.snapshot -> 'milieux' -> 'natura2000Habitats' ->> 'recouvre')::boolean, false) = false
       AND COALESCE((sn.snapshot -> 'milieux' -> 'natura2000Oiseaux' ->> 'recouvre')::boolean, false) = false`,
    );
  }
  if (f.enZaerSeulement) {
    /*
     * `COALESCE` a `false` et non a `true` : une parcelle dont le snapshot ne porte pas
     * l'information ZAER n'est PAS presumee en zone d'acceleration. Le sens d'erreur acceptable est
     * de perdre une occasion, jamais d'en inventer une.
     */
    conditions.push(
      `COALESCE((sn.snapshot -> 'urbanisme' -> 'zaer' ->> 'present')::boolean, false) = true`,
    );
  }
  if (f.typesZonePlu?.length) {
    /*
     * « TOUCHE une zone de ce type », et non « a ce zonage pour dominante » : voir le champ.
     *
     * `upper()` des deux cotes, parce que `typezone` arrive du Geoportail de l'urbanisme SANS
     * normalisation (`gpu.ts` recopie `f.properties.typezone` tel quel). Une commune publie `AUc`
     * la ou une autre publie `AUC` : comparer les casses brutes ferait manquer la moitie du
     * foncier concerne, sans rien signaler. La validation majuscule le critere saisi.
     */
    ajouter(
      `EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(sn.snapshot -> 'urbanisme' -> 'zonages', '[]'::jsonb)) z
          WHERE upper(z ->> 'typeZone') = ANY($?)
       )`,
      f.typesZonePlu,
    );
  }

  if (f.groupesCulture?.length) {
    /*
     * Le CODE du groupe, jamais son libelle — voir le champ. Aucun `COALESCE` ici : une parcelle
     * sans declaration PAC n'a pas de groupe, et ne doit donc PAS etre retenue par un critere qui
     * demande explicitement un type d'agriculture. « Aucune declaration » se cherche par la nature
     * du sol (`inculte`), qui est la question differente qu'elle pose.
     */
    ajouter(
      `(sn.snapshot -> 'occupationSol' -> 'rpg' ->> 'codeGroupeCulture') = ANY($?)`,
      f.groupesCulture,
    );
  }

  const where = conditions.join(' AND ');
  const base = `
    FROM score_parcelle_filiere s
    JOIN parcelle p ON p.idu = s.idu
    LEFT JOIN parcelle_snapshot sn ON sn.idu = s.idu
    LEFT JOIN lead l ON l.idu = s.idu AND l.filiere = s.filiere
    WHERE ${where}`;

  const totalLignes = await requete<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);
  const couverture = await couvertureDuTerritoire(f);

  /**
   * Critere de tri demande, TOUJOURS suivi d'un departage par l'IDU.
   *
   * POURQUOI LE DEPARTAGE EST INDISPENSABLE — audit 9, defaut A1. Le score est arrondi au
   * dixieme : sur l'intervalle 0-100 il n'existe que 1 001 valeurs possibles, donc une campagne
   * departementale de 200 000 parcelles compte quelques centaines d'ex aequo par valeur. Les
   * ex aequo sont la REGLE, pas l'exception.
   *
   * Or `ORDER BY score` ne dit rien de l'ordre entre ex aequo, et PostgreSQL le choisit selon le
   * plan retenu. Mesure sur 200 000 lignes, requete et donnees identiques, seul le plan change :
   *
   *   - `LIMIT 300` sans departage : 113 des 300 parcelles renvoyees changent (38 %) selon que le
   *     plan est parallele ou non, 107 changent apres la simple creation d'un index.
   *   - `LIMIT 25 OFFSET 0` puis `OFFSET 25` : 20 des 25 parcelles de la page 2 etaient deja sur
   *     la page 1, et 21 des 50 meilleures n'apparaissaient sur AUCUNE des deux pages. Cause : le
   *     tri partiel « top-N » a une profondeur de OFFSET+LIMIT, qui differe d'une page a l'autre.
   *
   * Autrement dit la liste des « 300 meilleures parcelles » et le CSV qui en est exporte n'etaient
   * pas reproductibles, et 4 parcelles sur 10 du haut du classement pouvaient rester invisibles
   * sans le moindre signe. Avec le departage : 0 doublon, 0 omission (mesure refaite a l'identique).
   *
   * L'IDU est la cle primaire de `parcelle` : le tri devient donc un ordre TOTAL, ce qui suffit.
   */
  const critere =
    f.tri === 'score_asc'
      ? 's.score_global ASC NULLS LAST'
      : f.tri === 'surface_desc'
        ? 'COALESCE(p.surface_calculee_m2, p.contenance_m2) DESC'
        : f.tri === 'distance_poste_asc'
          ? `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric ASC NULLS LAST`
          : 's.score_global DESC NULLS LAST';
  const ordre = `${critere}, p.idu ASC`;

  // Double garde. La validation du corps borne deja `limite`, mais `filtrerParcelles` est
  // appelable depuis d'autres chemins (scripts, futurs appels internes) : le plafond doit tenir
  // meme sans elle, sinon la protection depend de l'appelant.
  params.push(
    Math.min(limiteMax, Math.max(1, Math.floor(f.limite ?? LIMITE_DEFAUT))),
    Math.max(0, Math.floor(f.decalage ?? 0)),
  );

  const lignes = await requete<{
    idu: string;
    nom_commune: string | null;
    section: string;
    numero: string;
    surface_m2: number | null;
    statut: Feu | null;
    score_global: number | null;
    nb_knock_outs_bloquants: number;
    statut_prospection: StatutProspection | null;
    distance_poste_km: number | null;
    pente_pct: number | null;
    type_sol: string | null;
    lon: number;
    lat: number;
  }>(
    `SELECT p.idu, p.nom_commune, p.section, p.numero,
            COALESCE(p.surface_calculee_m2, p.contenance_m2) AS surface_m2,
            s.statut, s.score_global, COALESCE(s.nb_knock_outs_bloquants, 0)::int AS nb_knock_outs_bloquants,
            l.statut AS statut_prospection,
            (sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric AS distance_poste_km,
            (sn.snapshot -> 'topographie' ->> 'pentePct')::numeric AS pente_pct,
            (sn.snapshot -> 'occupationSol' ->> 'typeSol') AS type_sol,
            ST_X(p.centroide) AS lon, ST_Y(p.centroide) AS lat
     ${base}
     ORDER BY ${ordre}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    total: totalLignes[0]?.n ?? 0,
    couverture,
    resultats: lignes.map((l) => ({
      idu: l.idu,
      nomCommune: l.nom_commune,
      section: l.section,
      numero: l.numero,
      surfaceHa: l.surface_m2 == null ? null : Math.round((l.surface_m2 / 10000) * 100) / 100,
      statutScore: l.statut,
      scoreGlobal: l.score_global,
      nbKnockOutsBloquants: l.nb_knock_outs_bloquants,
      statutProspection: l.statut_prospection,
      distancePosteKm: l.distance_poste_km,
      lineaireRaccordementKm:
        l.distance_poste_km == null ? null : lineaireRaccordementKm(l.distance_poste_km),
      pentePct: l.pente_pct,
      typeSol: l.type_sol,
      centroide: [l.lon, l.lat] as [number, number],
    })),
  };
}

/**
 * Valide un corps de requete de filtrage et rend des filtres surs.
 *
 * Liste blanche integrale : chaque champ est lu avec son type, ses bornes et son ensemble de
 * valeurs, et toute cle non reconnue est REFUSEE. Un filtre mal orthographie — `surfaceMinHA`,
 * `exclureAOP` — serait sinon ignore en silence et la liste renverrait plus de parcelles que
 * demande, ce qui est la reponse la plus trompeuse possible pour un outil de tri.
 *
 * Vit ici, a cote de `filtrerParcelles`, et non dans la route : les deux doivent evoluer
 * ensemble, et une regle de validation eloignee du SQL qu'elle protege finit par en diverger.
 */
export function filtresValides(
  corps: unknown,
  /** Plafond applique a `limite`. Les exports en passent un plus haut. */
  limiteMax: number = LIMITE_MAX,
): FiltresParcelles {
  const l = lecteur(corps, 'corps de filtrage');

  const filiere = l.parmi('filiere', FILIERES);
  if (!filiere) {
    throw new ErreurValidation('filiere', `Champ \`filiere\` requis, parmi ${FILIERES.join(', ')}.`);
  }

  const filtres: FiltresParcelles = {
    filiere,
    bbox: l.bbox('bbox', (b) => bboxValide(b)),
    codeDepartement: l.texte('codeDepartement', {
      max: 3,
      motif: /^(\d{2}|\d{3}|2A|2B)$/,
      description: 'code département a 2 ou 3 caractères (ex. 28, 971, 2A)',
    }),
    /*
     * PLAFOND A 101 : le nombre exact de departements francais, mesure et fige par
     * `packages/core/test/territoires.test.ts`. Un plafond plus bas amputerait une selection
     * legitime « toute la France » ; un plafond plus haut laisserait passer une liste absurde.
     */
    codesDepartement: l.listeCodes('codesDepartement', {
      motif: /^(\d{2}|\d{3}|2A|2B)$/i,
      description: 'codes département a 2 ou 3 caractères (ex. 28, 971, 2A)',
      maxElements: 101,
    }),
    codeRegion: l.texte('codeRegion', {
      max: 2,
      motif: /^\d{2}$/,
      description: 'code région INSEE a 2 chiffres (ex. 24 pour Centre-Val de Loire)',
    }),
    codeInsee: l.texte('codeInsee', {
      max: 5,
      motif: /^\d{5}$|^\d[0-9AB]\d{3}$/,
      description: 'code INSEE a 5 caracteres',
    }),
    surfaceMinHa: l.nombre('surfaceMinHa', { min: 0, max: 100_000 }),
    surfaceMaxHa: l.nombre('surfaceMaxHa', { min: 0, max: 100_000 }),
    distancePosteMaxKm: l.nombre('distancePosteMaxKm', { min: 0, max: 500 }),
    capacitePosteMinMw: l.nombre('capacitePosteMinMw', { min: 0, max: 10_000 }),
    penteMaxPct: l.nombre('penteMaxPct', { min: 0, max: 100 }),
    scoreMin: l.nombre('scoreMin', { min: 0, max: 100 }),
    statutsScore: l.listeParmi('statutsScore', FEUX_VALIDES),
    statutsProspection: l.listeParmi('statutsProspection', STATUTS_PROSPECTION),
    typesSol: l.listeParmi('typesSol', TYPES_SOL_VALIDES),
    exclureNatura2000: l.booleen('exclureNatura2000'),
    exclureZoneHumide: l.booleen('exclureZoneHumide'),
    exclureAop: l.booleen('exclureAop'),
    exclureKnockOuts: l.booleen('exclureKnockOuts'),
    enZaerSeulement: l.booleen('enZaerSeulement'),
    /*
     * Motif volontairement large — voir `listeCodes`. Le GPU publie des `typezone` non normalises
     * (`A`, `N`, `U`, `AUc`, `AUs`, et pour les anciens POS `NA` a `ND`), auxquels s'ajoutent des
     * variantes locales. La longueur est bornee a 10 : au-dela ce n'est plus un type de zone mais
     * un libelle, qui ne se compare pas de la meme facon.
     */
    typesZonePlu: l.listeCodes('typesZonePlu', {
      motif: /^[A-Za-z0-9]{1,10}$/,
      description: 'types de zone du PLU, alphanumériques, de 1 a 10 caractères (ex. A, N, U, AUc)',
      maxElements: 30,
    }),
    /*
     * Les codes de groupe RPG sont NUMERIQUES (« 1 » a « 28 »), d'ou un motif propre plutot que
     * `listeCodes`, dont la mise en majuscules n'aurait aucun sens ici. Le plafond de 28 est le
     * nombre de groupes de la nomenclature, fige par le test de `@enr/core` : au-dela, la demande
     * ne peut plus correspondre a rien de reel.
     */
    groupesCulture: l.listeCodes('groupesCulture', {
      motif: /^\d{1,2}$/,
      description: 'codes de groupe de culture RPG (1 a 28)',
      maxElements: 28,
    }),
    tri: l.parmi('tri', TRIS_VALIDES),
    limite: l.nombre('limite', { min: 1, max: limiteMax, entier: true }),
    decalage: l.nombre('decalage', { min: 0, max: 1_000_000, entier: true }),
  };

  l.refuserInconnus();

  // Coherence entre bornes : un intervalle inverse ne renvoie rien, ce qui se lit comme
  // « aucune parcelle ne correspond » alors que c'est la demande qui est contradictoire.
  if (
    filtres.surfaceMinHa != null &&
    filtres.surfaceMaxHa != null &&
    filtres.surfaceMinHa > filtres.surfaceMaxHa
  ) {
    throw new ErreurValidation(
      'surfaceMinHa',
      `Surface minimale (${filtres.surfaceMinHa} ha) superieure a la maximale (${filtres.surfaceMaxHa} ha) : aucune parcelle ne peut correspondre.`,
    );
  }

  return filtres;
}

/** Valeurs closes acceptees par les filtres, alignees sur les types du domaine. */
const FEUX_VALIDES = ['vert', 'orange', 'rouge', 'gris'] as const satisfies readonly Feu[];
const TYPES_SOL_VALIDES = [
  'artificialise',
  'degrade',
  'agricole_exploite',
  'inculte',
  'naturel_forestier',
] as const satisfies readonly TypeSol[];
const TRIS_VALIDES = ['score_desc', 'score_asc', 'surface_desc', 'distance_poste_asc'] as const;
