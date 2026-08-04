/**
 * Reprise d'une base privee de sa table de suivi des migrations.
 *
 * POURQUOI CE TEST EXISTE. Le SQL des migrations n'est pas rejouable dans l'absolu : la
 * migration 010 redefinit par `CREATE OR REPLACE VIEW` une vue creee en 005, et rejouer 005
 * ensuite echoue (`cannot drop columns from view`, code 42P16). Tant que la table
 * `migration_appliquee` existe, cela n'a aucune consequence puisqu'elle empeche tout rejeu.
 *
 * Mais si elle disparait alors que le schema est a jour — restauration selective, dump pris
 * avec `--exclude-table`, base adoptee — le serveur applique les migrations au demarrage,
 * bute sur 005 et ne demarre plus. Verifie sur une vraie base : la reprise etait impossible.
 * Le mode adoption est la porte de sortie ; ce test verifie qu'elle ouvre, et qu'elle refuse
 * de s'ouvrir sur une base vierge ou elle laisserait un schema absent repute installe.
 *
 * COMMENT ILS S'EXECUTENT. Ignores faute de base, comme postgis.test.ts, et executes en CI.
 *
 * ATTENTION : ce fichier MODIFIE la base designee par DATABASE_URL — il supprime la table de
 * suivi et renomme temporairement `parcelle`. Chaque test remet l'etat en place (`finally`),
 * mais un `npm test` lance par erreur avec un DATABASE_URL de production ferait des degats.
 * Il faut donc l'autoriser explicitement par TESTS_MIGRATIONS=1, ce que seule la CI fait, sur
 * sa base jetable. Sans cette variable les tests sont ignores, et la sortie le dit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { requete } from '../src/bdd.js';
import { appliquerMigrations, DOSSIER_MIGRATIONS } from '../src/migrations.js';

let baseDisponible: boolean | null = null;

/** Motif d'exclusion, ou `null` si les tests peuvent s'executer. */
async function motifExclusion(): Promise<string | null> {
  if (process.env.TESTS_MIGRATIONS !== '1') {
    return 'ignore : tests destructifs, definir TESTS_MIGRATIONS=1 sur une base jetable';
  }
  if (baseDisponible == null) {
    try {
      await requete('SELECT postgis_version()');
      baseDisponible = true;
    } catch {
      baseDisponible = false;
    }
  }
  return baseDisponible ? null : 'ignore : base indisponible';
}

async function nbFichiers(): Promise<number> {
  return (await readdir(DOSSIER_MIGRATIONS)).filter((f) => f.endsWith('.sql')).length;
}

test('un second passage n’applique aucune migration', async (t) => {
  const exclusion = await motifExclusion();
  if (exclusion) return t.skip(exclusion);
  await appliquerMigrations();
  const r = await appliquerMigrations();
  assert.equal(r.appliquees, 0, 'la table de suivi doit empecher tout rejeu');
  assert.equal(r.total, await nbFichiers());
});

test('la perte de la table de suivi rend le demarrage impossible', async (t) => {
  const exclusion = await motifExclusion();
  if (exclusion) return t.skip(exclusion);
  await appliquerMigrations();
  await requete('DROP TABLE IF EXISTS migration_appliquee');
  // Le comportement constate, et la raison d'etre du mode adoption. Si un jour le SQL devient
  // reellement rejouable, ce test echouera : ce sera une bonne nouvelle a acter ici.
  await assert.rejects(
    () => appliquerMigrations(),
    (err: unknown) => {
      const code = (err as { code?: string }).code;
      assert.equal(code, '42P16', `attendu 42P16 (cannot drop columns from view), recu ${code}`);
      return true;
    },
  );
});

test('le mode adoption rend la base a nouveau demarrable', async (t) => {
  const exclusion = await motifExclusion();
  if (exclusion) return t.skip(exclusion);
  await requete('DROP TABLE IF EXISTS migration_appliquee');

  const adoption = await appliquerMigrations({ adopterSansExecuter: true });
  assert.equal(adoption.appliquees, 0, 'aucun SQL ne doit etre execute');
  assert.equal(adoption.adoptees, await nbFichiers(), 'tous les fichiers doivent etre enregistres');

  const apres = await appliquerMigrations();
  assert.equal(apres.appliquees, 0, 'la base doit etre revenue a un etat stable');

  const [suivi] = await requete<{ n: string }>('SELECT count(*)::text AS n FROM migration_appliquee');
  assert.equal(Number(suivi?.n), await nbFichiers());
});

test('l’adoption est refusee sur une base vierge', async (t) => {
  const exclusion = await motifExclusion();
  if (exclusion) return t.skip(exclusion);
  await appliquerMigrations();
  // `SET search_path` ne conviendrait pas : le pool distribue plusieurs connexions et le
  // reglage est propre a chacune. On rend donc la table temoin reellement introuvable, par un
  // renommage — instantane, et transparent pour les vues qui en dependent (PostgreSQL les lie
  // par OID, pas par nom). Remis en place dans le `finally`.
  await requete('DROP TABLE IF EXISTS migration_appliquee');
  await requete('ALTER TABLE parcelle RENAME TO parcelle_masquee_test');
  try {
    await assert.rejects(
      () => appliquerMigrations({ adopterSansExecuter: true }),
      /Adoption refusee/,
      'une base sans schema ne doit pas pouvoir etre marquee a jour',
    );
    // La garde intervient avant toute ecriture : aucun fichier n'est enregistre.
    const [suivi] = await requete<{ n: string }>(
      'SELECT count(*)::text AS n FROM migration_appliquee',
    );
    assert.equal(Number(suivi?.n), 0, 'aucune migration ne doit avoir ete enregistree');
  } finally {
    await requete('ALTER TABLE parcelle_masquee_test RENAME TO parcelle');
    await appliquerMigrations({ adopterSansExecuter: true });
  }
});
