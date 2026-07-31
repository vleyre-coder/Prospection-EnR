/**
 * Application des migrations SQL de db/migrations, dans l'ordre lexicographique.
 *
 * Extrait du script CLI pour que le serveur puisse initialiser sa propre base au
 * demarrage : une installation ne doit pas exiger d'etape manuelle pour fonctionner.
 * Idempotent, et trace chaque migration appliquee avec son empreinte.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pool, requete } from './bdd.js';
import { journal } from './journal.js';

const ici = dirname(fileURLToPath(import.meta.url));
// Fonctionne aussi bien depuis src/ (dev) que depuis dist/ (production).
export const DOSSIER_MIGRATIONS = join(ici, '..', '..', '..', 'db', 'migrations');

export interface ResultatMigrations {
  appliquees: number;
  total: number;
}

/**
 * Verrou consultatif : plusieurs instances de l'API peuvent demarrer simultanement
 * (redemarrage roulant, replicas). Sans verrou, elles rejoueraient les memes
 * migrations en parallele.
 */
async function avecVerrou<T>(cle: number, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [cle]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [cle]).catch(() => undefined);
    client.release();
  }
}

export async function appliquerMigrations(): Promise<ResultatMigrations> {
  return avecVerrou(864_201, appliquerMigrationsSansVerrou);
}

async function appliquerMigrationsSansVerrou(): Promise<ResultatMigrations> {
  await requete(`
    CREATE TABLE IF NOT EXISTS migration_appliquee (
      nom         text PRIMARY KEY,
      empreinte   text NOT NULL,
      appliquee_le timestamptz NOT NULL DEFAULT now()
    )`);

  const fichiers = (await readdir(DOSSIER_MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  if (fichiers.length === 0) {
    journal.warn({ dossier: DOSSIER_MIGRATIONS }, 'Aucune migration trouvee');
  }

  const deja = await requete<{ nom: string; empreinte: string }>(
    `SELECT nom, empreinte FROM migration_appliquee`,
  );
  const parNom = new Map(deja.map((d) => [d.nom, d.empreinte]));

  let appliquees = 0;
  for (const fichier of fichiers) {
    const sql = await readFile(join(DOSSIER_MIGRATIONS, fichier), 'utf8');
    const empreinte = createHash('sha256').update(sql).digest('hex').slice(0, 16);
    const existante = parNom.get(fichier);

    if (existante === empreinte) continue;
    if (existante && existante !== empreinte) {
      // Une migration deja appliquee ne doit pas etre modifiee : c'est le signe d'une
      // erreur de developpement, pas quelque chose a rejouer silencieusement.
      throw new Error(
        `La migration ${fichier} a deja ete appliquee mais son contenu a change ` +
          `(empreinte ${existante} attendue, ${empreinte} trouvee). ` +
          `Creez une nouvelle migration plutot que de modifier celle-ci.`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO migration_appliquee (nom, empreinte) VALUES ($1, $2)`, [
        fichier,
        empreinte,
      ]);
      await client.query('COMMIT');
      journal.info({ fichier }, 'Migration appliquee');
      appliquees += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      journal.error({ err, fichier }, 'Echec de migration');
      throw err;
    } finally {
      client.release();
    }
  }

  return { appliquees, total: fichiers.length };
}
