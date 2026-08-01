/**
 * Tests de la limitation des emprises.
 *
 * Ils portent sur l'incident constate : une qualification lancee depuis une vue large avait
 * porte sur des parcelles situees a des dizaines de kilometres de la zone de travail. Chaque
 * cas ci-dessous correspond a une porte par laquelle cela pouvait arriver.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decouperBbox, limiterAlaFrance, pointDansBbox, FRANCE_METRO } from '../src/geo.js';
import { ErreurEmprise, normaliserEmprise } from '../src/services/qualification.js';
import type { Bbox } from '../src/geo.js';

const BEAUCE: Bbox = [1.73, 48.14, 1.79, 48.18];

test("une emprise de travail normale n'est pas modifiee", () => {
  assert.deepEqual(normaliserEmprise(BEAUCE), BEAUCE);
});

test('une emprise debordant la France est ramenee au territoire', () => {
  // Cas reel : MapLibre renvoie des bornes qui depassent largement le territoire des que
  // l'utilisateur dezoome, y compris sur la mer et les pays voisins. Le rognage doit
  // ramener l'emprise a la France, sans jamais l'elargir.
  const europe: Bbox = [-20, 35, 25, 58];
  assert.deepEqual(limiterAlaFrance(europe), FRANCE_METRO);

  // Et une emprise a l'echelle europeenne, meme rognee, reste trop vaste pour une
  // qualification : elle est refusee, et non silencieusement reduite a un coin du pays.
  assert.throws(() => normaliserEmprise(europe), ErreurEmprise);
});

test("une emprise a cheval sur la frontiere est rognee et acceptee", () => {
  // Un secteur frontalier reste exploitable : seule la portion hors territoire est ecartee.
  const frontiere: Bbox = [7.9, 47.4, 8.2, 47.6];
  const limitee = normaliserEmprise(frontiere);
  assert.equal(limitee[2], 8.2, 'la portion en France doit etre conservee');
  assert.ok(limitee[3] <= FRANCE_METRO[3]);
});

test('une emprise hors de France est refusee explicitement', () => {
  assert.throws(() => normaliserEmprise([20, 45, 22, 47]), ErreurEmprise);
});

test('une emprise absurde est refusee', () => {
  // Les copies du monde de MapLibre peuvent produire des longitudes hors bornes.
  assert.throws(() => normaliserEmprise([-400, 40, 400, 55]), ErreurEmprise);
  assert.throws(() => normaliserEmprise([2, 48, 2, 48]), ErreurEmprise);
  assert.throws(() => normaliserEmprise([3, 48, 2, 49]), ErreurEmprise);
});

test('une emprise trop vaste est refusee plutot que tronquee en silence', () => {
  // Environ 3 degres sur 3, soit un tiers de la France : ce n'est plus une zone de travail.
  assert.throws(() => normaliserEmprise([1, 45, 4, 48]), ErreurEmprise);
});

test('le verrou de bordure ecarte les parcelles hors emprise', () => {
  // Une parcelle de Gueugnon (Saone-et-Loire) ne doit jamais etre retenue pour une emprise
  // situee en Beauce, quelle que soit la reponse du service interroge.
  assert.equal(pointDansBbox([1.7625, 48.162], BEAUCE), true);
  assert.equal(pointDansBbox([4.0662, 46.6003], BEAUCE), false);
});

test("le decoupage couvre l'emprise sans la depasser", () => {
  const cellules = decouperBbox(BEAUCE, 0.02);
  assert.ok(cellules.length > 1, 'une emprise plus grande que la cellule doit etre decoupee');
  for (const c of cellules) {
    assert.ok(c[0] >= BEAUCE[0] && c[1] >= BEAUCE[1], 'cellule debordant au sud-ouest');
    assert.ok(c[2] <= BEAUCE[2] && c[3] <= BEAUCE[3], 'cellule debordant au nord-est');
  }
});

test('une emprise plus petite que la cellule produit une cellule unique', () => {
  const minuscule: Bbox = [2.0, 48.0, 2.001, 48.001];
  assert.equal(decouperBbox(minuscule, 0.05).length, 1);
});

test('limiterAlaFrance rend null pour une emprise disjointe', () => {
  assert.equal(limiterAlaFrance([20, 45, 22, 47]), null);
});
