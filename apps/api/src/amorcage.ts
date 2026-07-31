/**
 * Amorcage automatique de l'instance.
 *
 * Objectif : `docker compose up` ou `npm start` doit suffire. L'utilisateur n'a pas a
 * enchainer migration, generation de secret et cinq commandes d'ingestion avant de voir
 * une carte utilisable.
 *
 * Trois responsabilites, dans cet ordre :
 *   1. attendre que PostgreSQL reponde (le conteneur de base peut demarrer apres l'API) ;
 *   2. appliquer les migrations et resoudre le secret de signature des jetons ;
 *   3. charger, une seule fois, les donnees nationales indispensables.
 *
 * L'amorcage des donnees s'execute **en arriere-plan, apres l'ouverture du port** :
 * l'ingestion des 35 000 communes prend plusieurs minutes et l'interface doit rester
 * accessible pendant ce temps. Son avancement est publie par `/api/sante`, que le
 * frontend affiche en bandeau — sans quoi l'utilisateur verrait une carte vide sans
 * comprendre pourquoi.
 */

import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { journal } from './journal.js';
import { pool, requete, requeteUne } from './bdd.js';
import { hacherMotDePasse, motDePasseAleatoire } from './mots-de-passe.js';
import { JOBS, lancerIngestion } from './ingestion/index.js';
import { CHEMIN_RASTER } from './connecteurs/vent.js';

// ---------------------------------------------------------------------------
// Attente de la base
// ---------------------------------------------------------------------------

/**
 * Interroge la base jusqu'a ce qu'elle reponde. Sans cette attente, un demarrage
 * simultane des conteneurs se solde par un echec alors que la base serait prete
 * deux secondes plus tard.
 */
export async function attendreBdd(delaiMaxMs = 60_000): Promise<boolean> {
  const echeance = Date.now() + delaiMaxMs;
  let signale = false;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      if (Date.now() >= echeance) {
        journal.error({ err }, 'Base de donnees toujours injoignable');
        return false;
      }
      if (!signale) {
        journal.info("Attente de la base de donnees…");
        signale = true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ---------------------------------------------------------------------------
// Secret de signature des jetons
// ---------------------------------------------------------------------------

/** Valeur d'exemple livree dans .env.example : elle ne doit jamais servir en production. */
const SECRET_EXEMPLE = 'changez-ce-secret-en-production';

/**
 * Determine le secret de signature.
 *
 * Un secret fourni par l'environnement est toujours prioritaire — c'est le mode
 * recommande en production, ou le secret doit etre gere hors du depot. A defaut,
 * l'instance en tire un au hasard au premier demarrage et le conserve en base : une
 * installation sans configuration est ainsi securisee, et les sessions survivent aux
 * redemarrages.
 */
export async function resoudreSecretJwt(bddPrete: boolean): Promise<string> {
  const fourni = process.env['SECRET_JWT']?.trim();
  if (fourni && fourni !== SECRET_EXEMPLE && fourni.length >= 16) return fourni;

  if (fourni === SECRET_EXEMPLE && config.env === 'production') {
    journal.warn(
      'SECRET_JWT vaut encore la valeur d\'exemple : un secret aleatoire est genere et conserve en base.',
    );
  }

  if (!bddPrete) {
    // Sans base, aucune persistance possible : un secret volatil vaut mieux qu'un
    // secret connu publiquement. Les jetons deja emis deviennent invalides.
    journal.warn('Base indisponible : secret de signature temporaire (les sessions ne survivront pas au redemarrage).');
    return randomBytes(32).toString('hex');
  }

  const existant = await requeteUne<{ valeur: string }>(
    `SELECT valeur FROM parametre WHERE cle = 'secret_jwt'`,
  ).catch(() => null);
  if (existant?.valeur) return existant.valeur;

  const secret = randomBytes(32).toString('hex');
  // ON CONFLICT : deux instances peuvent demarrer en meme temps ; la premiere gagne.
  const pose = await requeteUne<{ valeur: string }>(
    `INSERT INTO parametre (cle, valeur) VALUES ('secret_jwt', $1)
     ON CONFLICT (cle) DO UPDATE SET valeur = parametre.valeur
     RETURNING valeur`,
    [secret],
  );
  journal.info('Secret de signature des jetons genere et conserve en base.');
  return pose?.valeur ?? secret;
}

// ---------------------------------------------------------------------------
// Compte administrateur
// ---------------------------------------------------------------------------

/**
 * Garantit qu'un acces existe.
 *
 * Deux cas. Si l'exploitant fournit ADMIN_EMAIL et ADMIN_MOT_DE_PASSE, le compte est
 * cree ou mis a jour — c'est le mode a privilegier. Sinon, et seulement si la base ne
 * contient aucun utilisateur, un premier administrateur est cree avec un mot de passe
 * tire au hasard et affiche dans les journaux : sans cela, une installation par
 * conteneurs demarre sur un ecran de connexion dont personne ne detient les
 * identifiants. Aucun mot de passe par defaut n'est jamais utilise.
 */
export async function assurerAdministrateur(): Promise<void> {
  const email = (process.env['ADMIN_EMAIL'] ?? '').trim().toLowerCase();
  const motDePasse = process.env['ADMIN_MOT_DE_PASSE'];

  if (email && motDePasse) {
    if (motDePasse.length < 12) {
      journal.error('ADMIN_MOT_DE_PASSE doit comporter au moins 12 caracteres : compte non cree.');
      return;
    }
    await requete(
      `INSERT INTO utilisateur (email, nom, mot_de_passe_hash, role, habilite_donnees_proprietaires)
       VALUES ($1, 'Administrateur', $2, 'admin', true)
       ON CONFLICT (email) DO UPDATE SET
         mot_de_passe_hash = EXCLUDED.mot_de_passe_hash, role = 'admin', actif = true`,
      [email, hacherMotDePasse(motDePasse)],
    );
    journal.info({ email }, 'Compte administrateur cree ou mis a jour');
    return;
  }

  // L'authentification desactivee est un mode de developpement : inutile d'y creer un compte.
  if (config.auth.desactivee) return;

  const nb = await compte('SELECT count(*)::int AS n FROM utilisateur');
  if (nb > 0) return;

  const genere = motDePasseAleatoire();
  const emailInitial = email || 'admin@prospection-enr.local';
  await requete(
    `INSERT INTO utilisateur (email, nom, mot_de_passe_hash, role, habilite_donnees_proprietaires)
     VALUES ($1, 'Administrateur', $2, 'admin', true)
     ON CONFLICT (email) DO NOTHING`,
    [emailInitial, hacherMotDePasse(genere)],
  );
  // Affichage volontairement voyant : c'est la seule occasion de lire ce mot de passe.
  journal.warn(
    '\n' +
      '  ============================================================\n' +
      "   PREMIER DEMARRAGE - compte administrateur cree\n" +
      `   Identifiant : ${emailInitial}\n` +
      `   Mot de passe : ${genere}\n` +
      '   Notez-le : il n\'est affiche qu\'une seule fois.\n' +
      '   Pour choisir vous-meme ces identifiants, definissez ADMIN_EMAIL\n' +
      '   et ADMIN_MOT_DE_PASSE avant le premier demarrage.\n' +
      '  ============================================================',
  );
}

// ---------------------------------------------------------------------------
// Amorcage des donnees nationales
// ---------------------------------------------------------------------------

type StatutJob = 'attente' | 'en_cours' | 'ok' | 'echec' | 'deja_present';

interface JobAmorcage {
  nom: string;
  libelle: string;
  /** Duree indicative annoncee a l'utilisateur. */
  duree: string;
  /** L'application est-elle inutilisable sans cette donnee ? */
  indispensable: boolean;
  /** Vrai si la donnee est deja presente : le job est alors saute. */
  dejaPresent: () => Promise<boolean>;
}

async function compte(sql: string): Promise<number> {
  const r = await requeteUne<{ n: number }>(sql).catch(() => null);
  return r?.n ?? 0;
}

/**
 * Ordre volontaire : d'abord ce qui rend la carte lisible (communes), puis ce qui
 * debloque le critere le plus determinant de trois filieres sur quatre (postes sources),
 * puis les couches de contexte.
 */
const AMORCAGE: JobAmorcage[] = [
  {
    nom: 'communes',
    libelle: 'Contours des 35 000 communes',
    duree: '5 a 10 min',
    indispensable: true,
    // Seuil et non « > 0 » : une ingestion interrompue laisse une table partielle,
    // qu'il faut reprendre plutot que considerer comme faite.
    dejaPresent: async () => (await compte('SELECT count(*)::int AS n FROM commune')) > 30_000,
  },
  {
    nom: 'postes_sources',
    libelle: 'Postes sources et capacites de raccordement',
    duree: '2 min',
    indispensable: false,
    dejaPresent: async () => (await compte('SELECT count(*)::int AS n FROM poste_source')) > 1_000,
  },
  {
    nom: 'patrimoine_culture',
    libelle: 'Monuments historiques',
    duree: '30 s',
    indispensable: false,
    dejaPresent: async () =>
      (await compte(
        `SELECT count(*)::int AS n FROM contrainte WHERE connecteur = 'patrimoine_culture'`,
      )) > 1_000,
  },
  {
    nom: 'reseau_gaz',
    libelle: "Sites d'injection de biomethane",
    duree: '30 s',
    indispensable: false,
    dejaPresent: async () =>
      (await compte('SELECT count(*)::int AS n FROM point_injection_gaz')) > 0,
  },
  {
    nom: 'vent_100m',
    libelle: 'Gisement de vent a 100 m (55 Mo)',
    duree: '1 a 3 min',
    indispensable: false,
    dejaPresent: async () => existsSync(CHEMIN_RASTER),
  },
];

export interface EtapeAmorcage {
  nom: string;
  libelle: string;
  duree: string;
  indispensable: boolean;
  statut: StatutJob;
  message: string | null;
}

export interface EtatAmorcage {
  /** Une ingestion initiale est en cours : l'interface doit le dire a l'utilisateur. */
  enCours: boolean;
  debutLe: string | null;
  finLe: string | null;
  etapes: EtapeAmorcage[];
}

const etat: EtatAmorcage = { enCours: false, debutLe: null, finLe: null, etapes: [] };

export function etatAmorcage(): EtatAmorcage {
  return { ...etat, etapes: etat.etapes.map((e) => ({ ...e })) };
}

/**
 * Verrou consultatif non bloquant : en developpement, `tsx watch` relance le serveur a
 * chaque sauvegarde. Sans ce verrou, une modification de code pendant l'ingestion des
 * communes en declencherait une seconde en parallele.
 */
async function tenterVerrou(cle: number): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect();
  const r = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [cle]);
  if (!r.rows[0]?.ok) {
    client.release();
    return null;
  }
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [cle]).catch(() => undefined);
    client.release();
  };
}

/**
 * Charge les donnees nationales manquantes. Idempotent : chaque etape verifie d'abord si
 * sa donnee est deja en base. Une etape en echec n'interrompt pas les suivantes — perdre
 * les monuments historiques ne doit pas priver l'utilisateur des postes sources.
 */
export async function amorcerSiNecessaire(): Promise<EtatAmorcage> {
  etat.etapes = AMORCAGE.map((j) => ({
    nom: j.nom,
    libelle: j.libelle,
    duree: j.duree,
    indispensable: j.indispensable,
    statut: 'attente' as StatutJob,
    message: null,
  }));

  // Ce qui est deja la est marque avant toute prise de verrou : l'etat renvoye est
  // ainsi exact meme si une autre instance mene l'ingestion.
  const aFaire: JobAmorcage[] = [];
  for (const [i, job] of AMORCAGE.entries()) {
    const etape = etat.etapes[i]!;
    if (await job.dejaPresent().catch(() => false)) etape.statut = 'deja_present';
    else aFaire.push(job);
  }

  if (aFaire.length === 0) {
    journal.info('Donnees nationales deja presentes : aucun amorcage necessaire.');
    return etatAmorcage();
  }

  const liberer = await tenterVerrou(864_202);
  if (!liberer) {
    journal.info('Amorcage deja en cours dans une autre instance : rien a faire ici.');
    return etatAmorcage();
  }

  etat.enCours = true;
  etat.debutLe = new Date().toISOString();
  etat.finLe = null;
  journal.info(
    { etapes: aFaire.map((j) => j.nom) },
    'Premier demarrage : chargement des donnees nationales en arriere-plan',
  );

  try {
    for (const job of aFaire) {
      const etape = etat.etapes.find((e) => e.nom === job.nom)!;
      etape.statut = 'en_cours';
      journal.info({ job: job.nom, duree: job.duree }, `Amorcage : ${job.libelle}`);
      try {
        if (!JOBS[job.nom]) throw new Error(`Job d'ingestion inconnu : ${job.nom}`);
        const r = await lancerIngestion(job.nom);
        // Un job peut se terminer sans erreur et sans rien produire (jeu de donnees
        // renomme cote fournisseur, filtre trop strict). Le seul juge fiable est la
        // presence effective de la donnee : c'est le meme test que pour la sauter.
        const abouti = await job.dejaPresent().catch(() => false);
        etape.statut = abouti ? 'ok' : 'echec';
        etape.message = abouti
          ? resume(r)
          : "Le job s'est termine sans produire de donnee exploitable.";
        journal.info(
          { job: job.nom, abouti, ...r },
          abouti ? `Amorcage termine : ${job.libelle}` : `Amorcage sans resultat : ${job.libelle}`,
        );
      } catch (err) {
        etape.statut = 'echec';
        etape.message = (err as Error).message;
        journal.error(
          { err, job: job.nom },
          `Amorcage en echec : ${job.libelle}. Relancez plus tard avec : npm run ingest -w @enr/api -- ${job.nom}`,
        );
      }
    }
    // Compteurs de la vue nationale : ils dependent des communes et des scores.
    await requete('SELECT rafraichir_compteurs_communaux()').catch((err: unknown) =>
      journal.warn({ err }, 'Rafraichissement des compteurs communaux impossible'),
    );
  } finally {
    etat.enCours = false;
    etat.finLe = new Date().toISOString();
    await liberer();
  }

  const echecs = etat.etapes.filter((e) => e.statut === 'echec');
  journal.info(
    { echecs: echecs.map((e) => e.nom) },
    echecs.length === 0 ? 'Amorcage complet' : 'Amorcage termine avec des etapes en echec',
  );
  return etatAmorcage();
}

/** Resume court d'un retour de job, pour l'affichage dans l'interface. */
function resume(r: Record<string, unknown>): string {
  const nb = ['nbCommunes', 'nbPostes', 'nbObjets', 'nbPoints', 'octets'].find(
    (c) => typeof r[c] === 'number',
  );
  if (nb === 'octets') return `${Math.round((r['octets'] as number) / 1_048_576)} Mo`;
  if (nb) return `${r[nb] as number} enregistrements`;
  return 'termine';
}
