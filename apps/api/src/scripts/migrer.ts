/**
 * Applique les migrations SQL de db/migrations, dans l'ordre lexicographique.
 * Idempotent : chaque migration appliquee est tracee dans `migration_appliquee`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pool, requete } from '../bdd.js';
import { journal } from '../journal.js';
import { synchroniserReferentiel } from '../depots/sources.js';

const ici = dirname(fileURLToPath(import.meta.url));
// Fonctionne aussi bien depuis src/ (dev) que depuis dist/ (production).
const DOSSIER_MIGRATIONS = join(ici, '..', '..', '..', '..', 'db', 'migrations');

async function main(): Promise<void> {
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
      journal.error(
        { fichier, empreinteAttendue: existante, empreinteActuelle: empreinte },
        'Migration deja appliquee mais modifiee : creez une nouvelle migration plutot que de modifier celle-ci',
      );
      process.exitCode = 1;
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO migration_appliquee (nom, empreinte) VALUES ($1, $2)`,
        [fichier, empreinte],
      );
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

  const nbSources = await synchroniserReferentiel();
  journal.info(
    { appliquees, total: fichiers.length, sources: nbSources },
    'Migrations terminees',
  );
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Migrations interrompues');
  process.exit(1);
});
