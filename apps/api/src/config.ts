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
     * Application de BUREAU : un poste, un utilisateur, une base dans son propre dossier.
     *
     * POURQUOI CE DRAPEAU EXISTE PLUTOT QU'UN MENSONGE SUR NODE_ENV. L'application portable
     * (scripts/portable/) tourne avec `NODE_ENV=production` — c'est ce qui garde la politique
     * CORS restrictive et les journaux sobres. Mais elle n'a aucun compte a proposer : son
     * utilisateur a deja ouvert la session Windows et double-clique sur une icone. Elle posait
     * donc aussi `AUTH_DESACTIVEE=true`, combinaison que le serveur REFUSE — a juste titre.
     *
     * Constate en lancant vraiment l'archive : l'interface s'affichait, et toutes les routes
     * utiles rendaient 500 « AUTH_DESACTIVEE est interdit en production ». Une carte vide et
     * rien d'autre.
     *
     * Les deux mauvaises reponses etaient : basculer en `NODE_ENV=development`, ce qui ouvre
     * la politique CORS a TOUTES les origines — n'importe quelle page web visitee par
     * l'utilisateur aurait alors pu lire ses donnees de proprietaires sur 127.0.0.1 ; ou
     * affaiblir le garde-fou de production, qui protege un vrai serveur.
     *
     * `MODE_BUREAU` nomme la situation au lieu de la deguiser, et il est lui-meme garde : il
     * n'est accepte que si le serveur n'ecoute que la boucle locale (voir serveur.ts). Sur une
     * machine joignable depuis le reseau, il ne donne rien.
     */
    modeBureau: booleen('MODE_BUREAU', false),
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
    /**
     * Nombre de relais de confiance devant l'API, pour determiner l'adresse REELLE de l'appelant.
     *
     * POURQUOI CE REGLAGE EXISTE, ET POURQUOI IL N'EST PAS `true`. Le serveur declarait
     * `trustProxy: true`, ce qui fait prendre a Fastify l'entree la PLUS A GAUCHE de
     * `X-Forwarded-For` — c'est-a-dire une valeur entierement fournie par le client. La limitation de
     * debit indexe ses seaux sur `req.ip` pour les appels non authentifies : elle etait donc
     * contournable en changeant un en-tete a chaque requete.
     *
     * MESURE : 429 apres 11 tentatives sur la route de connexion en conditions normales,
     * JAMAIS en 60 tentatives en variant `X-Forwarded-For`. C'est la seule protection de la seule
     * route qu'un attaquant non authentifie peut marteler, et elle ne protegeait rien.
     *
     * Avec un nombre de sauts, Fastify compte depuis la DROITE : l'entree retenue est celle qu'a
     * ecrite le relais de confiance le plus proche, et les entrees ajoutees par le client, a gauche,
     * sont ignorees.
     *
     * LA VALEUR PAR DEFAUT EST 0, et c'est un choix. Mettre 1 par defaut « parce que la pile livree a
     * nginx » serait la meme faute sous une forme plus discrete : une API exposee directement, sans
     * relais, ne recoit qu'UNE entree dans `X-Forwarded-For` — celle du client — et un saut de
     * confiance suffit alors a la retenir. Mesure faite : avec 1 saut et aucun relais reel, la
     * limitation reste contournable en 60 tentatives sur 60.
     *
     * A 0, `req.ip` est l'adresse de la connexion TCP : non falsifiable, quelle que soit
     * l'exposition. Un deploiement derriere un relais DOIT declarer combien il en a, et la pile
     * docker-compose livree le fait (`RELAIS_DE_CONFIANCE=1`). La configuration sure est celle qu'on
     * obtient sans rien declarer.
     *
     * Ne PAS mettre une valeur superieure au nombre reel de relais : chaque saut de trop redonne au
     * client la maitrise d'une entree.
     */
    relaisDeConfiance: nombre('RELAIS_DE_CONFIANCE', 0),
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
    /**
     * Zoom minimal a partir duquel les parcelles sont servies.
     *
     * 12 et non 14 : les parcelles qualifiees doivent etre visibles a l'echelle de
     * plusieurs communes, sans quoi l'utilisateur ne voit jamais son travail d'ensemble.
     * Seules les parcelles effectivement qualifiees sont en base, donc le volume reste
     * modeste ; la geometrie est de plus simplifiee en vue large.
     */
    zoomMinParcelles: nombre('ZOOM_MIN_PARCELLES', 12),
    zoomMaxCommunes: nombre('ZOOM_MAX_COMMUNES', 12),
    /** Nombre maximal de parcelles retournees par requete d'emprise. */
    limiteParcelles: nombre('LIMITE_PARCELLES', 3000),
  },

  qualification: {
    /** Surface minimale d'une parcelle qualifiee a la demande, en m2 (evite le bruit). */
    surfaceMinM2: nombre('QUALIF_SURFACE_MIN_M2', 3000),
    /**
     * Nombre maximal de parcelles enrichies en une seule campagne.
     *
     * 1500 et non 300 : la qualification d'une emprise s'execute desormais en arriere-plan,
     * ce qui rend une campagne longue exploitable. A 5 secondes par parcelle, 1500 parcelles
     * representent environ deux heures - le volume d'un secteur de plusieurs communes.
     * L'interface annonce le volume et la duree avant de lancer.
     */
    lotMax: nombre('QUALIF_LOT_MAX', 1500),
  },
} as const;

export type Config = typeof config;

/**
 * L'application de bureau peut-elle se passer d'authentification ?
 *
 * DEUX CONDITIONS, ET LES DEUX SONT NECESSAIRES.
 *
 *   1. `MODE_BUREAU=true` — la situation est DECLAREE. Un reglage implicite finit toujours
 *      par etre herite par une installation qui n'aurait pas du l'avoir.
 *   2. Le serveur n'ecoute QUE la boucle locale. C'est la condition qui a du mordant : elle ne
 *      se contourne pas par une variable d'environnement oubliee, parce qu'elle porte sur ce
 *      que la machine expose reellement. Sur `0.0.0.0` — le defaut, et le cas de tout
 *      hebergement — le mode bureau ne donne rien.
 *
 * `::1` couvre la boucle locale IPv6, qu'une pile IPv6 preferera parfois a `127.0.0.1`.
 */
export function estBoucleLocale(hote: string): boolean {
  const h = hote.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  /**
   * L'adresse est VALIDEE, pas seulement prefixee. Un simple `startsWith('127.')` — ma
   * premiere version — acceptait `127.0.0.1.exemple.fr`, c'est-a-dire un nom de domaine que
   * son proprietaire fait pointer ou il veut, y compris sur une adresse publique. Le serveur
   * se serait alors cru sur la boucle locale tout en etant joignable par tout le monde, SANS
   * authentification. Trouve par le test, pas par la relecture.
   */
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const octets = v4.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  // Tout 127.0.0.0/8 est de la boucle locale, pas seulement 127.0.0.1.
  return octets[0] === 127;
}

/**
 * EXPORTEE, et pas seulement par commodite d'organisation.
 *
 * Le crochet `onRequest` ci-dessous et la sonde `/api/sante` doivent rendre le MEME verdict sur
 * la meme configuration. Ils ne le rendaient pas : la sonde ignorait `MODE_BUREAU` et declarait
 * l'instance `hors_service` avec le message « toutes les routes protegees repondent en erreur.
 * Retirez cette variable », a la seconde ou une route protegee repondait 200 — mesure faite a
 * l'audit 11 sur l'application de bureau reellement lancee.
 *
 * Le pire n'etait pas le diagnostic errone mais le CONSEIL : retirer `MODE_BUREAU` casse
 * l'application de bureau, precisement. Un fichier de diagnostic qui prescrit la panne est plus
 * nuisible qu'un silence. Deux lecteurs d'une meme regle doivent lire la meme fonction.
 */
export function modeBureauRecevable(): boolean {
  return config.auth.modeBureau && estBoucleLocale(config.hote);
}

/**
 * Les configurations qui rendent l'instance INOPERANTE, avec ce qu'il faut faire.
 *
 * FONCTION PURE ET PARAMETREE, et c'est le seul moyen de la tester honnetement. Cette liste
 * vivait en ligne dans `/api/sante`, ou elle lisait le `config` global : pour l'exercer il
 * fallait donc lancer un serveur avec un environnement prepare — quinze secondes par cas, et
 * quatre cas. Elle n'etait donc exercee par aucun test, et elle etait fausse.
 *
 * Ce qu'elle doit dire, verifie a l'execution sur quatre serveurs reellement lances :
 *   - `AUTH_DESACTIVEE` en production, sans mode bureau  → inoperante ; routes protegees : 500 ;
 *   - `AUTH_DESACTIVEE` + `MODE_BUREAU` sur 127.0.0.1    → OPERANTE  ; routes protegees : 200 ;
 *   - `AUTH_DESACTIVEE` + `MODE_BUREAU` sur 0.0.0.0      → inoperante ; routes protegees : 500,
 *     et c'est le cas qu'il faut nommer : une instance joignable par le reseau sans
 *     authentification ;
 *   - authentification active                            → rien a signaler.
 */
export function configurationsFatales(
  c: Pick<typeof config, 'env' | 'hote'> & { auth: Pick<typeof config.auth, 'desactivee' | 'modeBureau'> },
): string[] {
  const fatales: string[] = [];
  if (!c.auth.desactivee) return fatales;
  const bureauRecevable = c.auth.modeBureau && estBoucleLocale(c.hote);

  if (c.env === 'production' && !bureauRecevable) {
    fatales.push(
      'AUTH_DESACTIVEE est actif en production : toutes les routes protégées répondent en erreur. ' +
        'Retirez cette variable.',
    );
  }
  if (c.auth.modeBureau && !estBoucleLocale(c.hote)) {
    fatales.push(
      `MODE_BUREAU n'est recevable que sur la boucle locale, or HOTE vaut « ${c.hote} » : ` +
        "cette instance est joignable par le réseau et n'aurait aucune authentification. " +
        'Retirez AUTH_DESACTIVEE et MODE_BUREAU, ou faites écouter le serveur sur 127.0.0.1.',
    );
  }
  return fatales;
}
