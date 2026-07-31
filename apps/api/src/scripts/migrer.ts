/**
 * Applique les migrations SQL de db/migrations.
 *
 * Le serveur les applique deja lui-meme au demarrage (MIGRATIONS_AUTO) : ce script
 * reste utile pour initialiser une base sans lancer l'API, ou pour verifier l'etat
 * du schema en exploitation.
 */

import { pool } from '../bdd.js';
import { journal } from '../journal.js';
import { appliquerMigrations } from '../migrations.js';
import { synchroniserReferentiel } from '../depots/sources.js';

async function main(): Promise<void> {
  const { appliquees, total } = await appliquerMigrations();
  const nbSources = await synchroniserReferentiel();
  journal.info({ appliquees, total, sources: nbSources }, 'Migrations terminees');
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Migrations interrompues');
  process.exit(1);
});
