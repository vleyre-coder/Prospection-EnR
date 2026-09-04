/**
 * Applique les migrations SQL de db/migrations.
 *
 * Le serveur les applique deja lui-meme au demarrage (MIGRATIONS_AUTO) : ce script
 * reste utile pour initialiser une base sans lancer l'API, ou pour verifier l'etat
 * du schema en exploitation.
 *
 * Option `--adopter` : enregistre les migrations comme appliquees sans executer leur SQL.
 * A n'employer que sur une base dont le schema est deja a jour mais dont la table de suivi
 * `migration_appliquee` a disparu — sans quoi le serveur ne demarre plus (voir
 * docs/SAUVEGARDE.md, section « Table de suivi des migrations »).
 */

import { pool } from '../bdd.js';
import { journal } from '../journal.js';
import { appliquerMigrations } from '../migrations.js';
import { synchroniserReferentiel } from '../depots/sources.js';

async function main(): Promise<void> {
  const adopter = process.argv.includes('--adopter');
  if (adopter) {
    journal.warn(
      'Mode adoption : le SQL ne sera PAS execute, les migrations seront seulement ' +
        'enregistrées comme appliquées. À réserver à une base déjà à jour.',
    );
  }
  const { appliquees, adoptees, total } = await appliquerMigrations({
    adopterSansExecuter: adopter,
  });
  // Le referentiel des sources se resynchronise dans les deux cas : c'est un contenu, pas un
  // schema, et il doit refleter le code deploye.
  const nbSources = await synchroniserReferentiel();
  journal.info({ appliquees, adoptees, total, sources: nbSources }, 'Migrations terminees');
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Migrations interrompues');
  process.exit(1);
});
