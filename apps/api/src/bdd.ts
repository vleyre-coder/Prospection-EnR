/** Acces PostgreSQL / PostGIS. */

import pg from 'pg';
import { config } from './config.js';
import { journal } from './journal.js';

const { Pool } = pg;

// Les numeric PostgreSQL arrivent en string par defaut : on les convertit en nombre
// pour que les scores et surfaces soient exploitables directement en JSON.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString: config.bdd.url,
  max: config.bdd.poolMax,
  connectionTimeoutMillis: config.bdd.timeoutMs,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  journal.error({ err }, 'Erreur inattendue du pool PostgreSQL');
});

export async function requete<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const debut = Date.now();
  try {
    const res = await pool.query<T>(sql, params as never[]);
    const duree = Date.now() - debut;
    if (duree > 2000) {
      journal.warn({ duree, sql: sql.slice(0, 160) }, 'Requete SQL lente');
    }
    return res.rows;
  } catch (err) {
    journal.error({ err, sql: sql.slice(0, 300) }, 'Échec de requête SQL');
    throw err;
  }
}

export async function requeteUne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await requete<T>(sql, params);
  return rows[0] ?? null;
}

/** Execute un bloc dans une transaction, avec l'utilisateur courant pose pour les triggers. */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  utilisateur?: string,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (utilisateur) {
      await client.query('SELECT set_config($1, $2, true)', ['app.utilisateur', utilisateur]);
    }
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function bddDisponible(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function fermerBdd(): Promise<void> {
  await pool.end();
}

/**
 * Verrou consultatif non bloquant.
 *
 * POURQUOI ICI ET PLUS DANS `amorcage.ts` — audit 10, §H. Cette fonction y etait nee pour un besoin
 * de l'amorcage : « en developpement, `tsx watch` relance le serveur a chaque sauvegarde. Sans ce
 * verrou, une modification de code pendant l'ingestion des communes en declencherait une seconde en
 * parallele. » En etendant la protection aux ingestions manuelles, je l'ai importee depuis
 * `ingestion/index.ts` — que `amorcage.ts` importe deja. Cela creait un cycle
 * `ingestion -> amorcage -> ingestion` : inoffensif ici, parce que la fonction n'est appelee qu'a
 * l'execution, mais un cycle d'imports est une dette qui se paie plus tard, quand un binding est lu
 * pendant l'evaluation du module.
 *
 * Un verrou consultatif est une primitive de base de donnees : sa place est dans ce module, que tous
 * les autres importent sans jamais etre importes par lui.
 *
 * Le verrou est tenu par une connexion DEDIEE, sortie du pool jusqu'a sa liberation. Appeler la
 * fonction de liberation rendue est donc obligatoire, y compris en cas d'echec : sans elle, la
 * connexion ne revient pas au pool et le verrou n'est rendu qu'a la fin du processus.
 */
export async function tenterVerrou(cle: number): Promise<(() => Promise<void>) | null> {
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
