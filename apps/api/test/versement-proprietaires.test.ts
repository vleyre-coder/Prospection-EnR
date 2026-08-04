/**
 * Tests du versement des donnees de propriete.
 *
 * Ce chemin manipule les seules donnees a caractere personnel de l'application. Ses garde-fous
 * ne sont pas cosmetiques : refuser un enregistrement sans provenance documentee et sans date
 * de purge est ce qui rend la conservation licite, et ce qui permet d'honorer un droit d'acces.
 * Un assouplissement accidentel de ces controles ne se verrait ni au typage ni a l'usage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyser, decouperLigneCsv } from '../src/scripts/verser-proprietaires.js';

const ENTETES = 'idu;nb_comptes;indivision;proprietaire_public;nominatif;origine_donnee;purge_prevue_le';
const csv = (...lignes: string[]): string => [ENTETES, ...lignes].join('\n');
const OK = '283900000C0843;2;oui;non;;Demande DGFiP du 12/05/2026;2027-05-12';

// ---------------------------------------------------------------------------
// Decoupage CSV
// ---------------------------------------------------------------------------

test('un guillemet au milieu d’un champ reste litteral', () => {
  // Defaut trouve en versant un vrai fichier : le premier guillemet d'un JSON brut ouvrait un
  // echappement, et le JSON ressortait sans ses guillemets, donc invalide.
  const champs = decouperLigneCsv('a;{"noms":["X","Y"]};b');
  assert.equal(champs[1], '{"noms":["X","Y"]}');
  assert.equal(champs.length, 3, 'les virgules internes ne creent pas de colonnes');
});

test('un champ ouvert par un guillemet est echappe selon les regles', () => {
  const champs = decouperLigneCsv('a;"contient ; un separateur";b');
  assert.deepEqual(champs, ['a', 'contient ; un separateur', 'b']);
});

test('un guillemet double dans un champ echappe donne un guillemet litteral', () => {
  assert.deepEqual(decouperLigneCsv('"{""a"":1}";b'), ['{"a":1}', 'b']);
});

test('les champs vides sont conserves, pas ecrases', () => {
  assert.deepEqual(decouperLigneCsv('a;;b;'), ['a', '', 'b', '']);
});

// ---------------------------------------------------------------------------
// Garde-fous RGPD
// ---------------------------------------------------------------------------

test('une ligne complete et documentee est acceptee', () => {
  const [l] = analyser(csv(OK));
  assert.equal(l!.idu, '283900000C0843');
  assert.equal(l!.nbComptes, 2);
  assert.equal(l!.indivision, true);
  assert.equal(l!.proprietairePublic, false);
  assert.equal(l!.purgePrevueLe, '2027-05-12');
});

test('une donnee sans provenance documentee est refusee', () => {
  assert.throws(
    () => analyser(csv('283900000C0843;2;oui;non;;;2027-05-12')),
    /origine_donnee est obligatoire/,
  );
});

test('une donnee sans date de purge est refusee', () => {
  assert.throws(
    () => analyser(csv('283900000C0843;2;oui;non;;Demande DGFiP;')),
    /purge_prevue_le est obligatoire/,
  );
});

test('une date de purge mal formee est refusee, sans interpretation', () => {
  // Accepter « 12/05/2027 » puis le lire comme une date ISO produirait une echeance fausse,
  // donc une conservation plus longue que decidee.
  assert.throws(
    () => analyser(csv('283900000C0843;2;oui;non;;Demande DGFiP;12/05/2027')),
    /AAAA-MM-JJ/,
  );
});

test('les colonnes obligatoires manquantes sont refusees avant toute lecture', () => {
  // La premiere colonne manquante est signalee, dans l'ordre de la liste des obligatoires.
  assert.throws(() => analyser('idu;nb_comptes\n283900000C0843;2'), /origine_donnee/);
  assert.throws(
    () => analyser('idu;origine_donnee\n283900000C0843;Demande'),
    /purge_prevue_le/,
  );
});

test('un JSON nominatif invalide est refuse plutot que stocke tel quel', () => {
  assert.throws(
    () => analyser(csv('283900000C0843;2;oui;non;{pas du json};Demande;2027-05-12')),
    /JSON valide/,
  );
});

test('un nominatif JSON brut est accepte et analyse', () => {
  const [l] = analyser(csv('283900000C0843;;;;{"noms":["DUPONT Jean"]};Demande DGFiP;2027-05-12'));
  assert.deepEqual(l!.nominatif, { noms: ['DUPONT Jean'] });
});

test('un IDU de longueur invalide est refuse', () => {
  assert.throws(() => analyser(csv('2839;2;oui;non;;Demande;2027-05-12')), /IDU invalide/);
});

test('un IDU en doublon est refuse : la derniere ligne ecraserait la premiere en silence', () => {
  assert.throws(() => analyser(csv(OK, OK)), /doublon/);
});

test('une valeur booleenne non comprise est refusee, jamais interpretee comme faux', () => {
  // Lire « peut-etre » comme `false` affirmerait l'absence d'indivision — une conclusion
  // metier tiree d'une saisie que personne n'a validee.
  assert.throws(
    () => analyser(csv('283900000C0843;2;peut-etre;non;;Demande;2027-05-12')),
    /booleenne non comprise/,
  );
});

test('les champs facultatifs vides restent null, sans valeur par defaut', () => {
  const [l] = analyser(csv('283900000C0843;;;;;Demande DGFiP;2027-05-12'));
  assert.equal(l!.nbComptes, null);
  assert.equal(l!.indivision, null);
  assert.equal(l!.proprietairePublic, null);
  assert.equal(l!.nominatif, null);
});

test('l’erreur indique le numero de ligne du fichier', () => {
  assert.throws(() => analyser(csv(OK, '2839;;;;;Demande;2027-05-12')), /ligne 3/);
});

test('un fichier reduit a ses en-tetes est refuse', () => {
  assert.throws(() => analyser(ENTETES), /vide/);
});

test('une BOM UTF-8 en tete de fichier ne casse pas la premiere colonne', () => {
  // Excel en produit une systematiquement : sans ce nettoyage, la colonne « idu » devient
  // « ﻿idu » et le fichier est refuse pour une raison incomprehensible.
  const [l] = analyser('﻿' + csv(OK));
  assert.equal(l!.idu, '283900000C0843');
});

test('un fichier a fins de ligne Windows est accepte', () => {
  const [l] = analyser(csv(OK).replace(/\n/g, '\r\n'));
  assert.equal(l!.purgePrevueLe, '2027-05-12');
});

// ---------------------------------------------------------------------------
// Garde sur le declenchement de la purge
// ---------------------------------------------------------------------------

test('la purge RGPD est bien declenchee par le serveur', async () => {
  // La fonction SQL `purger_donnees_nominatives` existait depuis la migration 006 et n'etait
  // appelee par aucun code : elle serait restee inoperante des le premier versement reel.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const lire = (p: string): string =>
    readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

  assert.match(lire('../../../db/migrations/006_utilisateurs_rgpd.sql'), /purger_donnees_nominatives/);
  assert.match(lire('../src/depots/parcelles.ts'), /SELECT purger_donnees_nominatives\(\)/);
  assert.match(
    lire('../src/serveur.ts'),
    /purgerDonneesNominatives\(\)/,
    'le serveur doit appeler la purge, sinon la fonction SQL ne sert a rien',
  );
});
