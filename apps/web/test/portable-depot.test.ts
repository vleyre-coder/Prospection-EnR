/**
 * Le garde qui empeche la base de partir sur GitHub, execute.
 *
 * POURQUOI CE FICHIER EXISTE. L'application locale vit dans un dossier ou le code et la base
 * de donnees sont voisins. La base contient le pipeline commercial et, potentiellement, des
 * donnees nominatives de proprietaires. Un envoi sur GitHub est DEFINITIF : meme supprime
 * ensuite, un fichier pousse reste dans l'historique et dans toutes les copies clonees.
 *
 * C'est donc l'erreur la plus couteuse que ce depot puisse commettre, et la seule qu'on ne
 * puisse pas corriger apres coup. Elle merite mieux qu'un `.gitignore` — qui se contourne d'un
 * `git add -f`, ne suit pas un dossier renomme, et ne dit rien quand il agit.
 *
 * Les cas ci-dessous sont ceux qui arrivent vraiment sur un poste Windows, pas ceux qui sont
 * commodes a ecrire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTERDITS, decider, trier } from '../../../scripts/portable/depot.mjs';

/** Raccourci : la liste des chemins bloques, sans les raisons. */
const bloques = (chemins: string[]): string[] =>
  trier(chemins).refuses.map((r: { chemin: string }) => r.chemin);

test('le dossier de la base est refuse, y compris ecrit a la mode Windows', () => {
  /**
   * LE CAS QUI COMPTE. Sur Windows, `git status` rend `donnees\pgdata\base\1\2601`. Sans
   * normalisation des barres obliques, le motif `^donnees/` ne mordrait pas — autrement dit
   * le garde serait inoperant EXACTEMENT sur la plateforme qu'il doit proteger. Ce test
   * echouait avant que la normalisation soit ecrite.
   */
  const cas = [
    'donnees/pgdata/base/1/2601',
    'donnees\\pgdata\\base\\1\\2601',
    'donnees/pgdata/postgresql.conf',
    './donnees/raster/gwa.tif',
    'pgdata/PG_VERSION',
    'pgdata\\PG_VERSION',
  ];
  assert.deepEqual(bloques(cas).length, cas.length, `tous doivent etre bloques : ${bloques(cas)}`);
});

test('les secrets et les sauvegardes sont refuses', () => {
  const cas = [
    '.env',
    'apps/api/.env',
    'jeton-github.txt',
    'jeton_llegender.txt',
    'sauvegarde-2026-08-27.sql.gz',
    'base.dump',
    'prospection_enr.bak',
  ];
  assert.deepEqual(bloques(cas).length, cas.length, `tous doivent etre bloques : ${bloques(cas)}`);

  // Le temoin : `.env.example` est du code, il DOIT passer. Un motif trop large le bloquerait,
  // et le depot deviendrait immodifiable sur le fichier qui documente la configuration.
  assert.deepEqual(bloques(['.env.example']), []);
});

test('les exports produits par l’application sont refuses', () => {
  const cas = [
    'exports/parcelles-28390.csv',
    'export/liste.geojson',
    'mes-parcelles.csv',
    'contour.shp',
  ];
  assert.deepEqual(bloques(cas).length, cas.length, `tous doivent etre bloques : ${bloques(cas)}`);
});

test('les jeux d’essai versionnes restent envoyables — ce sont du code', () => {
  /**
   * L'exception a la regle, et elle est necessaire. Les fixtures sont fictives, elles sont
   * lues par les tests, et elles vivent dans le depot depuis le debut. Les bloquer rendrait
   * impossible toute correction de test touchant un `.geojson` — et un garde qui empeche de
   * travailler finit desactive, donc absent le jour ou il servirait.
   */
  const cas = [
    'apps/web/test/fixtures/parcelle.geojson',
    'apps/api/test/fixtures/communes.csv',
    'apps/web/e2e/fixtures/export.csv',
  ];
  assert.deepEqual(bloques(cas), [], 'les fixtures de test doivent passer');
});

test('le code ordinaire passe sans entrave', () => {
  const cas = [
    'apps/api/src/serveur.ts',
    'packages/core/src/reglementation.ts',
    'docs/APPLICATION-LOCALE.md',
    'scripts/portable/depot.mjs',
    'package.json',
    'demarrer.bat',
  ];
  const { autorises, refuses } = trier(cas);
  assert.deepEqual(refuses, []);
  assert.deepEqual(autorises, cas);
});

test('chaque interdit porte une raison lisible', () => {
  /**
   * Un garde muet est un garde qu'on desactive. Le message doit dire POURQUOI, sinon
   * l'utilisateur presse relancera avec --forcer sans avoir compris ce qu'il risque.
   */
  for (const { motif, raison } of INTERDITS as Array<{ motif: RegExp; raison: string }>) {
    assert.ok(raison && raison.length > 15, `raison trop courte pour ${motif}`);
  }
});

test('UN SEUL fichier de donnees suffit a bloquer tout l’envoi', () => {
  /**
   * LA PROPRIETE QUI COMPTE VRAIMENT, et elle n'est pas dans `trier`. Un envoi ou l'on
   * ecarterait le fichier interdit pour envoyer le reste serait pire que le refus : il
   * donnerait l'habitude de voir passer des avertissements, jusqu'au jour ou l'un d'eux
   * comptait. Vingt fichiers de code legitimes, un seul fichier de base : on ne pousse RIEN.
   */
  const melange = [
    'apps/api/src/serveur.ts',
    'packages/core/src/reglementation.ts',
    'donnees/pgdata/base/1/2601',
    'docs/APPLICATION-LOCALE.md',
  ];
  const verdict = decider(melange) as { action: string; refuses: unknown[] };
  assert.equal(verdict.action, 'refuser');
  assert.equal(verdict.refuses.length, 1);

  // `--forcer` reste possible, sinon on ne pourrait jamais reparer une situation batarde —
  // mais il faut le demander explicitement.
  assert.equal((decider(melange, { forcer: true }) as { action: string }).action, 'envoyer');
});

test('sans modification de code, il n’y a rien a envoyer', () => {
  assert.equal((decider([]) as { action: string }).action, 'rien');
  // Un dossier de donnees seul modifie : refus, et surtout pas un commit vide.
  assert.equal((decider(['donnees/pgdata/PG_VERSION']) as { action: string }).action, 'refuser');
});

test('un chemin vide ne fait pas trebucher le tri', () => {
  const { autorises, refuses } = trier(['', './', 'src/a.ts']);
  assert.deepEqual(refuses, []);
  assert.deepEqual(autorises, ['src/a.ts']);
});
