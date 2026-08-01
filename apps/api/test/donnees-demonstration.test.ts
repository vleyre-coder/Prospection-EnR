/**
 * Les donnees de demonstration ne doivent jamais fonder une conclusion reglementaire.
 *
 * L'amorcage insere une ZAER et un document-cadre fictifs pour que l'application soit
 * demontrable sans attendre une deliberation reelle. Ils n'etaient distingues que par un
 * champ texte que le moteur ne lit pas : une parcelle etait donc presentee comme situee en
 * zone d'acceleration ENR - un argument reglementaire de premier plan - alors que la zone
 * n'existe pas. Deux garde-fous se completent :
 *   - la colonne `est_demonstration`, posee par la migration 008 ;
 *   - le filtre `est_demonstration = false` dans TOUTES les lectures du moteur.
 *
 * Le second est le plus fragile : il suffit d'ajouter une requete pour rouvrir la breche.
 * Ce test lit donc le code source des connecteurs et refuse toute lecture non filtree.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (chemin: string): string =>
  readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

const CONNECTEURS_LOCAUX = source('../src/connecteurs/locales.ts');
const MIGRATION = source('../../../db/migrations/008_donnees_demonstration.sql');
const SEEDER = source('../src/scripts/seeder.ts');

/** Tables dont les enregistrements de demonstration doivent etre ecartes du moteur. */
const TABLES = ['zaer', 'document_cadre_pv'];

test('la migration pose le marqueur sur les deux tables concernees', () => {
  for (const table of TABLES) {
    assert.match(
      MIGRATION,
      new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS est_demonstration`),
      `${table} doit porter la colonne est_demonstration`,
    );
  }
  // Reprise des enregistrements poses par les versions precedentes : sans elle, les bases
  // deja amorcees gardent des exemples indiscernables du reel.
  assert.match(MIGRATION, /UPDATE zaer SET est_demonstration = true/);
  assert.match(MIGRATION, /UPDATE document_cadre_pv SET est_demonstration = true/);
  // `document_cadre_pv` n'a pas de colonne `source_document` : la marque y est portee par
  // `criteres_texte`. Se tromper de colonne ferait echouer la migration au demarrage.
  assert.ok(
    !/UPDATE document_cadre_pv SET est_demonstration = true\s*\n\s*WHERE source_document/.test(
      MIGRATION,
    ),
    'la reprise de document_cadre_pv doit porter sur criteres_texte',
  );
});

test('l’amorcage marque explicitement ce qu’il insere', () => {
  for (const table of TABLES) {
    const insertion = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)`);
    const m = insertion.exec(SEEDER);
    assert.ok(m, `l'amorcage doit inserer dans ${table}`);
    assert.match(
      m[1]!,
      /est_demonstration/,
      `l'insertion dans ${table} doit poser est_demonstration`,
    );
  }
});

test('l’amorcage n’enregistre aucune couverture d’ingestion pour ses exemples', () => {
  // Enregistrer une couverture ferait passer le connecteur de « on ne sait pas s'il existe
  // une ZAER ici » a « il n'y a pas de ZAER ici » : une affirmation d'absence fondee sur un
  // jeu fictif, aussi trompeuse que l'affirmation de presence qu'on vient de corriger.
  assert.ok(
    !/enregistrerCouverture/.test(SEEDER),
    "l'amorcage des couches locales ne doit declarer aucune couverture",
  );
});

test('toute lecture des couches locales ecarte les donnees de demonstration', () => {
  for (const table of TABLES) {
    // Chaque `FROM <table>` du connecteur doit etre suivi, dans la meme requete, du filtre.
    const lectures = [...CONNECTEURS_LOCAUX.matchAll(new RegExp(`FROM ${table}\\b`, 'g'))];
    assert.ok(lectures.length > 0, `le connecteur doit bien lire ${table}`);

    for (const lecture of lectures) {
      const suite = CONNECTEURS_LOCAUX.slice(lecture.index, lecture.index + 400);
      const finRequete = suite.indexOf('`');
      const clause = finRequete === -1 ? suite : suite.slice(0, finRequete);
      assert.match(
        clause,
        /est_demonstration\s*=\s*false/,
        `une lecture de ${table} ne filtre pas les donnees de demonstration :\n${clause}`,
      );
    }
  }
});
