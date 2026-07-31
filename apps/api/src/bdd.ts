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
    journal.error({ err, sql: sql.slice(0, 300) }, 'Echec de requete SQL');
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
