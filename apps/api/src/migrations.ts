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
  /** Migrations enregistrees sans etre executees (mode adoption). */
  adoptees?: number;
}

export interface OptionsMigrations {
  /**
   * Enregistre les migrations comme appliquees SANS executer leur SQL.
   *
   * Necessaire parce que le SQL n'est pas rejouable dans l'absolu : la migration 010
   * redefinit par `CREATE OR REPLACE VIEW` une vue creee en 005, et rejouer 005 ensuite
   * echoue (« cannot drop columns from view »). C'est sans consequence tant que la table
   * `migration_appliquee` existe, puisqu'elle empeche tout rejeu — mais si elle disparait
   * (restauration partielle, base adoptee, dump pris avec `--exclude-table`), le serveur
   * ne demarre plus du tout et il n'existait aucune porte de sortie.
   *
   * Equivalent du `baseline` de Flyway ou du `stamp` d'Alembic. Refuse de s'appliquer a une
   * base vierge, ou elle laisserait un schema absent marque comme installe.
   */
  adopterSansExecuter?: boolean;
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

export async function appliquerMigrations(
  options: OptionsMigrations = {},
): Promise<ResultatMigrations> {
  return avecVerrou(864_201, () => appliquerMigrationsSansVerrou(options));
}

/** La base porte-t-elle deja le schema applicatif ? */
async function schemaDejaInstalle(): Promise<boolean> {
  const [r] = await requete<{ presente: boolean }>(
    `SELECT to_regclass('public.parcelle') IS NOT NULL AS presente`,
  );
  return r?.presente === true;
}

async function appliquerMigrationsSansVerrou(
  options: OptionsMigrations,
): Promise<ResultatMigrations> {
  await requete(`
    CREATE TABLE IF NOT EXISTS migration_appliquee (
      nom         text PRIMARY KEY,
      empreinte   text NOT NULL,
      appliquee_le timestamptz NOT NULL DEFAULT now()
    )`);

  if (options.adopterSansExecuter && !(await schemaDejaInstalle())) {
    throw new Error(
      "Adoption refusée : la table « parcelle » est absente, donc le schéma n'est pas installe. " +
        'Marquer les migrations comme appliquées laisserait une base vide réputée à jour. ' +
        'Appliquez les migrations normalement.',
    );
  }

  const fichiers = (await readdir(DOSSIER_MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  if (fichiers.length === 0) {
    journal.warn({ dossier: DOSSIER_MIGRATIONS }, 'Aucune migration trouvee');
  }

  const deja = await requete<{ nom: string; empreinte: string }>(
    `SELECT nom, empreinte FROM migration_appliquee`,
  );
  const parNom = new Map(deja.map((d) => [d.nom, d.empreinte]));

  let appliquees = 0;
  let adoptees = 0;
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
          `Creez une nouvelle migration plutôt que de modifier celle-ci.`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!options.adopterSansExecuter) await client.query(sql);
      await client.query(`INSERT INTO migration_appliquee (nom, empreinte) VALUES ($1, $2)`, [
        fichier,
        empreinte,
      ]);
      await client.query('COMMIT');
      if (options.adopterSansExecuter) {
        journal.warn({ fichier }, 'Migration enregistrée sans être exécutée (adoption)');
        adoptees += 1;
      } else {
        journal.info({ fichier }, 'Migration appliquee');
        appliquees += 1;
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      journal.error({ err, fichier }, 'Échec de migration');
      throw err;
    } finally {
      client.release();
    }
  }

  return { appliquees, total: fichiers.length, adoptees };
}
