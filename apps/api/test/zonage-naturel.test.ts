/**
 * Reduction d'un ensemble de zonages naturels a la synthese portee par le snapshot.
 *
 * POURQUOI CES TESTS EXISTENT. Le connecteur Nature prenait le nom du site sur `features[0]`,
 * c'est-a-dire sur le premier element de l'ordre de reponse de l'API, sur une emprise de 10 km,
 * tout en calculant la distance comme le minimum sur l'ensemble. La fiche concatenait ensuite les
 * deux comme s'ils decrivaient le meme objet. Mesure sur cinq localisations reelles, couche ZNIEFF
 * de type I : dans 4 cas sur 5, le nom affiche designait un autre site que la distance affichee.
 *
 * Exemple mesure (Sologne) : la fiche annoncait « 1 846 m — ETANG DE MALZONE », alors que le site
 * situe a 1 846 m est « ETANG DES BROSSES ». Ce n'etait pas une donnee manquante mais une donnee
 * FAUSSE, sur un document destine a etre transmis a un tiers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonageDepuisFeatures,
  RAYON_ZONAGES_NATURELS_M,
  type FeatureZonage,
} from '../src/connecteurs/distances.js';
import type { GeoJsonGeometry } from '../src/geo.js';

/** Carre centre sur (lon, lat), de demi-cote `d` degres. */
function carre(lon: number, lat: number, d: number): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ],
    ],
  };
}

// Parcelle de reference : environ 100 m de cote, en Beauce.
const PARCELLE = carre(1.75, 48.15, 0.00045);

/** Zonage carre de 200 m de cote, decale de `decalageDeg` en longitude. */
function siteA(nom: string, decalageDeg: number): FeatureZonage {
  return { geometry: carre(1.75 + decalageDeg, 48.15, 0.0009), nom };
}

test('le nom vient du site le plus proche, et non du premier renvoye', () => {
  // L'ordre de la liste est deliberement l'inverse de l'ordre des distances : c'est exactement
  // la configuration qui produisait le defaut.
  const z = zonageDepuisFeatures(PARCELLE, [
    siteA('ETANG DE MALZONE', 0.05), // le plus loin, mais premier dans la reponse
    siteA('ETANG DES BROSSES', 0.02), // le plus proche
  ]);
  assert.equal(z.nom, 'ETANG DES BROSSES');
  assert.equal(z.recouvre, false);
  assert.ok(z.distanceM != null && z.distanceM > 0);
});

test('la distance annoncee est bien celle du site nomme', () => {
  const proche = siteA('PROCHE', 0.02);
  const loin = siteA('LOIN', 0.05);
  const z = zonageDepuisFeatures(PARCELLE, [loin, proche]);
  // La distance rendue doit etre celle du site nomme, mesuree seule.
  const seul = zonageDepuisFeatures(PARCELLE, [proche]);
  assert.equal(z.nom, seul.nom);
  assert.equal(z.distanceM, seul.distanceM);
});

test('un recouvrement l’emporte, avec une distance nulle et le nom du site recouvrant', () => {
  const z = zonageDepuisFeatures(PARCELLE, [
    siteA('VOISIN', 0.02),
    { geometry: carre(1.75, 48.15, 0.01), nom: 'RECOUVRANT' },
  ]);
  assert.equal(z.recouvre, true);
  assert.equal(z.distanceM, 0);
  assert.equal(z.nom, 'RECOUVRANT');
});

test('une reponse complete et vide est un constat d’absence, pas une donnee manquante', () => {
  const z = zonageDepuisFeatures(PARCELLE, []);
  assert.equal(z.recouvre, false, 'absence CONSTATEE');
  assert.equal(z.partRecouvrement, 0);
  assert.equal(z.distanceM, null, 'aucune distance a annoncer');
  assert.equal(z.nom, null);
});

test('une part de recouvrement n’est plus affirmee a 100 % sans l’avoir mesuree', () => {
  // La version precedente ecrivait `partRecouvrement: recouvre ? 1 : 0`, soit 100 % des qu'il y
  // avait le moindre recouvrement — faux des qu'une parcelle n'est qu'en partie dans le zonage.
  // La part exacte demanderait une intersection PostGIS par couche et par parcelle ; aucun
  // critere ne la lit pour les milieux naturels, donc on la laisse INCONNUE plutot que fausse.
  const z = zonageDepuisFeatures(PARCELLE, [{ geometry: carre(1.75, 48.15, 0.01), nom: 'X' }]);
  assert.equal(z.recouvre, true);
  assert.equal(z.partRecouvrement, null);
  // En revanche, 0 % est exact quand il n'y a pas de recouvrement.
  assert.equal(zonageDepuisFeatures(PARCELLE, [siteA('Y', 0.02)]).partRecouvrement, 0);
});

test('au-dela du rayon couvert, la distance et le nom disparaissent ensemble', () => {
  // Un site trouve hors du rayon exhaustif n'est pas demontre comme le plus proche, et une
  // distance surestimee est ici optimiste (plus loin d'un zonage protege = meilleure note).
  const loin = siteA('TRES LOIN', 0.3); // ~22 km
  const z = zonageDepuisFeatures(PARCELLE, [loin], 10000);
  assert.equal(z.distanceM, null);
  assert.equal(
    z.nom,
    null,
    'le nom ne doit pas survivre seul : il designerait un site sans dire a quelle distance',
  );
  assert.equal(z.recouvre, false);
});

test('le rayon par defaut est celui annonce a l’utilisateur', () => {
  // La fiche ecrit « aucun site trouve dans un rayon de N km » : la constante doit etre unique,
  // sans quoi le connecteur et le moteur annonceraient deux rayons differents.
  assert.equal(RAYON_ZONAGES_NATURELS_M, 10000);
  const z = zonageDepuisFeatures(PARCELLE, [siteA('DANS LE RAYON', 0.05)]);
  assert.ok(z.distanceM != null && z.distanceM < RAYON_ZONAGES_NATURELS_M);
});

test('un site sans nom donne une distance sans nom, pas une erreur', () => {
  const z = zonageDepuisFeatures(PARCELLE, [{ geometry: carre(1.79, 48.15, 0.0009), nom: null }]);
  assert.ok(z.distanceM != null);
  assert.equal(z.nom, null);
});
