/**
 * Estimation de la part reellement couverte d'une parcelle par un zonage.
 *
 * Ce qui est teste ici a une portee reglementaire : cette part designe le « zonage
 * dominant », qui gouverne le knock-out de zone naturelle. Elle etait auparavant calculee
 * comme `surface de la zone / surface de la parcelle`, plafonne a 1 - un rapport de tailles,
 * pas un recouvrement. Comme presque toute zone de PLU est plus vaste qu'une parcelle, la
 * valeur valait 1 partout et le « dominant » se reduisait a l'ordre de reponse du service.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partCouverte } from '../src/connecteurs/distances.js';
import type { GeoJsonGeometry } from '../src/geo.js';

/** Rectangle en degres, aux coordonnees d'une parcelle de Beauce. */
function rectangle(minLon: number, minLat: number, maxLon: number, maxLat: number): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  } as GeoJsonGeometry;
}

const PARCELLE = rectangle(1.7, 48.1, 1.71, 48.11);

test('une zone qui englobe entierement la parcelle la couvre a 100 %', () => {
  // Cas le plus frequent : une zone A de plusieurs centaines d'hectares sur une parcelle.
  const zone = rectangle(1.5, 48.0, 1.9, 48.3);
  assert.equal(partCouverte(PARCELLE, zone), 1);
});

test('une zone disjointe ne couvre rien', () => {
  const zone = rectangle(2.0, 48.5, 2.1, 48.6);
  assert.equal(partCouverte(PARCELLE, zone), 0);
});

test('une zone couvrant la moitie de la parcelle rend environ 0,5', () => {
  // La moitie ouest exactement.
  const zone = rectangle(1.6, 48.0, 1.705, 48.2);
  const part = partCouverte(PARCELLE, zone);
  assert.ok(part != null, 'la part doit etre estimable');
  assert.ok(Math.abs(part - 0.5) < 0.05, `part estimee ${part}, attendue ~0,5`);
});

test('une zone couvrant un quart de la parcelle rend environ 0,25', () => {
  const zone = rectangle(1.6, 48.0, 1.705, 48.105);
  const part = partCouverte(PARCELLE, zone);
  assert.ok(part != null);
  assert.ok(Math.abs(part - 0.25) < 0.05, `part estimee ${part}, attendue ~0,25`);
});

test('la taille absolue de la zone n’influe pas sur la part couverte', () => {
  // C'etait precisement le defaut corrige : deux zones couvrant la meme moitie de la
  // parcelle, l'une minuscule et l'autre immense, doivent rendre la meme part.
  const petite = rectangle(1.699, 48.099, 1.705, 48.111);
  const immense = rectangle(0.0, 47.0, 1.705, 49.0);
  const a = partCouverte(PARCELLE, petite);
  const b = partCouverte(PARCELLE, immense);
  assert.ok(a != null && b != null);
  assert.ok(
    Math.abs(a - b) < 0.05,
    `la petite zone rend ${a}, l'immense ${b} : elles couvrent pourtant la meme moitie`,
  );
});

test('le zonage dominant est bien celui qui couvre le plus, pas le plus grand', () => {
  // Situation reelle : une parcelle a 80 % en zone U (zone communale modeste) et effleuree
  // par une vaste zone N intercommunale. C'est U qui gouverne.
  const zoneU = rectangle(1.6, 48.0, 1.708, 48.2);
  const zoneN = rectangle(1.708, 47.0, 3.0, 49.0);
  const partU = partCouverte(PARCELLE, zoneU);
  const partN = partCouverte(PARCELLE, zoneN);
  assert.ok(partU != null && partN != null);
  assert.ok(partU > partN, `U couvre ${partU}, N couvre ${partN} : U doit dominer`);
  assert.ok(partU > 0.7);
  assert.ok(partN < 0.3);
});

test('une geometrie vide ne produit pas de part inventee', () => {
  const vide = { type: 'Polygon', coordinates: [] } as unknown as GeoJsonGeometry;
  assert.equal(partCouverte(vide, PARCELLE), null);
});
