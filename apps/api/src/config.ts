/** Configuration applicative, lue depuis l'environnement. */

// Charge `.env` s'il existe, AVANT toute lecture de process.env. L'environnement reste
// prioritaire sur le fichier.
import { fichierEnvCharge } from './env.js';

function texte(cle: string, defaut: string): string {
  return process.env[cle] ?? defaut;
}

function nombre(cle: string, defaut: number): number {
  const v = process.env[cle];
  if (!v) return defaut;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaut;
}

function booleen(cle: string, defaut: boolean): boolean {
  const v = process.env[cle];
  if (v == null) return defaut;
  return v === 'true' || v === '1';
}

export const config = {
  /** Chemin du `.env` effectivement charge, ou `null`. Consigne au demarrage. */
  fichierEnvCharge,
  env: texte('NODE_ENV', 'development'),
  port: nombre('PORT', 3000),
  hote: texte('HOTE', '0.0.0.0'),
  niveauLog: texte('NIVEAU_LOG', 'info'),

  bdd: {
    url: texte('DATABASE_URL', 'postgres://enr:enr@localhost:5432/prospection_enr'),
    poolMax: nombre('BDD_POOL_MAX', 10),
    timeoutMs: nombre('BDD_TIMEOUT_MS', 30000),
  },

  auth: {
    /** En developpement, permet de travailler sans compte. Interdit en production. */
    desactivee: booleen('AUTH_DESACTIVEE', false),
    /**
     * Secret de signature des jetons. Laisse vide, l'instance en genere un au premier
     * demarrage et le conserve en base (voir amorcage.ts) : une installation sans
     * configuration reste ainsi securisee.
     */
    secretJwt: texte('SECRET_JWT', ''),
    dureeToken: texte('DUREE_TOKEN', '12h'),
  },

  demarrage: {
    /** Applique les migrations au demarrage : evite une etape manuelle a l'installation. */
    migrationsAuto: booleen('MIGRATIONS_AUTO', true),
    /**
     * Charge les donnees nationales manquantes en arriere-plan au premier demarrage.
     * A desactiver quand l'ingestion est pilotee par un ordonnanceur externe.
     */
    amorcageAuto: booleen('AMORCAGE_AUTO', true),
    /** Delai maximal d'attente de la base au demarrage (conteneurs demarrant ensemble). */
    attenteBddMs: nombre('ATTENTE_BDD_MS', 60_000),
  },

  /**
   * Interface web servie par l'API lorsque le build existe : une installation locale
   * n'a alors qu'un seul port a ouvrir et une seule commande a lancer.
   */
  web: {
    repertoireStatique: texte('REPERTOIRE_WEB', ''),
    servirStatique: booleen('SERVIR_WEB', true),
    /**
     * Origines autorisees a appeler l'API depuis un navigateur, separees par des virgules.
     * Necessaire uniquement lorsque l'interface est hebergee ailleurs que l'API (front
     * statique sur Netlify, par exemple). Vide : seules les origines locales sont admises.
     */
    originesAutorisees: texte('ORIGINES_AUTORISEES', '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o) => o.length > 0),
  },

  /** URLs des services externes, surchargeables pour les tests. */
  sources: {
    apicarto: texte('URL_APICARTO', 'https://apicarto.ign.fr/api'),
    geoplateformeWfs: texte('URL_GEOPF_WFS', 'https://data.geopf.fr/wfs/ows'),
    geoplateformeAlti: texte('URL_GEOPF_ALTI', 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest'),
    georisques: texte('URL_GEORISQUES', 'https://georisques.gouv.fr/api'),
    // Geocodage : la Geoplateforme remplace api-adresse.data.gouv.fr, deprecie et instable
    // (503 frequents). L'ancien host reste utilise en repli.
    adresse: texte('URL_ADRESSE', 'https://data.geopf.fr/geocodage'),
    adresseRepli: texte('URL_ADRESSE_REPLI', 'https://api-adresse.data.gouv.fr'),
    geoApiGouv: texte('URL_GEO_API', 'https://geo.api.gouv.fr'),
    opendataEnedis: texte('URL_OPENDATA_ENEDIS', 'https://opendata.enedis.fr/api/explore/v2.1'),
    odre: texte('URL_ODRE', 'https://odre.opendatasoft.com/api/explore/v2.1'),
    opendataGrdf: texte('URL_OPENDATA_GRDF', 'https://opendata.grdf.fr/api/explore/v2.1'),
  },

  http: {
    /** Delai maximal d'une requete sortante vers une source externe. */
    timeoutMs: nombre('HTTP_TIMEOUT_MS', 20000),
    /** Nombre de tentatives (la premiere incluse) en cas d'echec reseau. */
    tentatives: nombre('HTTP_TENTATIVES', 3),
    /** Nombre maximal de requetes simultanees vers une meme source. */
    concurrence: nombre('HTTP_CONCURRENCE', 4),
    /** Duree de vie du cache memoire des reponses externes. */
    cacheTtlMs: nombre('HTTP_CACHE_TTL_MS', 15 * 60 * 1000),
  },

  cache: {
    /** Age au-dela duquel un snapshot de parcelle est re-calcule. */
    snapshotMaxAgeJours: nombre('SNAPSHOT_MAX_AGE_JOURS', 30),
    /** Age au-dela duquel une geometrie de parcelle en cache est rafraichie. */
    parcelleMaxAgeJours: nombre('PARCELLE_MAX_AGE_JOURS', 180),
  },

  donnees: {
    /** Repertoire des donnees volumineuses ingerees (rasters). */
    repertoire: texte('REPERTOIRE_DONNEES', 'data'),
  },

  carte: {
    /** Zoom minimal a partir duquel les parcelles sont servies. */
    zoomMinParcelles: nombre('ZOOM_MIN_PARCELLES', 14),
    zoomMaxCommunes: nombre('ZOOM_MAX_COMMUNES', 13),
    /** Nombre maximal de parcelles retournees par requete d'emprise. */
    limiteParcelles: nombre('LIMITE_PARCELLES', 3000),
  },

  qualification: {
    /** Surface minimale d'une parcelle qualifiee a la demande, en m2 (evite le bruit). */
    surfaceMinM2: nombre('QUALIF_SURFACE_MIN_M2', 3000),
    /** Nombre maximal de parcelles enrichies en une seule requete. */
    lotMax: nombre('QUALIF_LOT_MAX', 300),
  },
} as const;

export type Config = typeof config;
