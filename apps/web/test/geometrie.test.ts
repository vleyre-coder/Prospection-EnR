/**
 * Geometrie et formatage cote client.
 *
 * POURQUOI CE FICHIER EXISTE. L'interface pesait 6 136 lignes pour 195 lignes de test, soit un
 * ratio de 0,03, releve a l'audit 5 puis reporte aux audits 6 et 7. Ce module-la est le plus
 * exposé : ses fonctions alimentent les outils de mesure de surface et de distance que le
 * prospecteur utilise pour decider, et les cercles de rayon de raccordement affiches sur la carte.
 * Une erreur de facteur 2 ou d'unite ne provoque aucun plantage — elle produit un nombre plausible
 * et faux, sur lequel quelqu'un fonde une decision.
 *
 * Les valeurs de reference sont calculees independamment (formule de Haversine a la main, ou
 * geometrie elementaire) et non reprises du code teste.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cercleGeodesique,
  distanceM,
  formatDate,
  formatDateHeure,
  formatLongueur,
  formatNombre,
  formatSurface,
  longueurLigneM,
  surfaceAnneauHa,
  type Position,
} from '../src/utils/geometrie.js';

/** Tolerance relative admise pour une approximation spherique. */
function proche(obtenu: number, attendu: number, tolerance = 0.01): void {
  const ecart = Math.abs(obtenu - attendu) / Math.max(1e-9, Math.abs(attendu));
  assert.ok(
    ecart <= tolerance,
    `attendu ${attendu} +/- ${(tolerance * 100).toFixed(1)} %, obtenu ${obtenu} (ecart ${(ecart * 100).toFixed(2)} %)`,
  );
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

test('un degre de latitude vaut environ 111,2 km', () => {
  // Reference geodesique independante du code : la circonference terrestre / 360.
  proche(distanceM([0, 48], [0, 49]), 111195, 0.005);
});

test('un degre de longitude se contracte avec la latitude', () => {
  // A 48 deg, le facteur est cos(48) = 0,669. Un degre de longitude vaut donc ~74,4 km.
  proche(distanceM([1, 48], [2, 48]), 111195 * Math.cos((48 * Math.PI) / 180), 0.01);
  // A l'equateur, il vaut autant qu'un degre de latitude.
  proche(distanceM([1, 0], [2, 0]), 111195, 0.005);
});

test('la distance est symetrique et nulle sur un meme point', () => {
  const a: Position = [1.75, 48.15];
  const b: Position = [2.35, 48.85];
  assert.equal(distanceM(a, a), 0);
  proche(distanceM(a, b), distanceM(b, a), 1e-9);
});

test('une distance connue entre deux villes est retrouvee', () => {
  // Paris (2,3522 / 48,8566) - Orleans (1,9093 / 47,9027) : 111 km a vol d'oiseau.
  proche(distanceM([2.3522, 48.8566], [1.9093, 47.9027]), 111_000, 0.02);
});

test('la longueur d’une ligne est la somme de ses segments', () => {
  const points: Position[] = [
    [1.0, 48.0],
    [1.0, 48.1],
    [1.1, 48.1],
  ];
  const attendu = distanceM(points[0]!, points[1]!) + distanceM(points[1]!, points[2]!);
  proche(longueurLigneM(points), attendu, 1e-9);
});

test('une ligne de moins de deux points a une longueur nulle', () => {
  assert.equal(longueurLigneM([]), 0);
  assert.equal(longueurLigneM([[1, 48]]), 0);
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

test('la surface d’un carre d’un kilometre de cote vaut 100 hectares', () => {
  // Reference elementaire : 1 km x 1 km = 1 000 000 m2 = 100 ha. C'est l'ordre de grandeur qu'un
  // prospecteur verifie de tete, donc celui qui doit etre juste.
  const lat = 48;
  const dLat = 1000 / 111195;
  const dLon = 1000 / (111195 * Math.cos((lat * Math.PI) / 180));
  const carre: Position[] = [
    [1.0, lat],
    [1.0 + dLon, lat],
    [1.0 + dLon, lat + dLat],
    [1.0, lat + dLat],
    [1.0, lat],
  ];
  proche(surfaceAnneauHa(carre), 100, 0.01);
});

test('la surface ne depend pas du sens de parcours', () => {
  const lat = 45;
  const d = 0.01;
  const sens: Position[] = [[2, lat], [2 + d, lat], [2 + d, lat + d], [2, lat + d], [2, lat]];
  const inverse: Position[] = [...sens].reverse();
  proche(surfaceAnneauHa(inverse), surfaceAnneauHa(sens), 1e-9);
});

test('un anneau degenere a une surface nulle plutot qu’une valeur fantaisiste', () => {
  assert.equal(surfaceAnneauHa([]), 0);
  assert.equal(surfaceAnneauHa([[1, 48], [2, 48], [1, 48]]), 0, 'moins de quatre sommets');
});

test('une parcelle de taille realiste donne un ordre de grandeur credible', () => {
  // 200 m x 200 m = 4 ha, la taille d'une parcelle agricole courante.
  const lat = 48.15;
  const dLat = 200 / 111195;
  const dLon = 200 / (111195 * Math.cos((lat * Math.PI) / 180));
  const p: Position[] = [
    [1.75, lat],
    [1.75 + dLon, lat],
    [1.75 + dLon, lat + dLat],
    [1.75, lat + dLat],
    [1.75, lat],
  ];
  proche(surfaceAnneauHa(p), 4, 0.02);
});

// ---------------------------------------------------------------------------
// Cercle de rayon de raccordement
// ---------------------------------------------------------------------------

test('le cercle de raccordement a le rayon demande, dans les deux directions', () => {
  const centre: Position = [1.75, 48.15];
  const rayon = 5000;
  const anneau = cercleGeodesique(centre, rayon).coordinates[0]! as Position[];
  // Chaque sommet doit etre a la distance demandee. La tolerance couvre l'approximation par
  // facteurs constants : c'est un cercle de carte, pas un calcul geodesique exact.
  for (const p of anneau) proche(distanceM(centre, p), rayon, 0.02);
});

test('le cercle est ferme, et son nombre de sommets est celui demande', () => {
  const anneau = cercleGeodesique([2, 45], 1000, 16).coordinates[0]!;
  assert.equal(anneau.length, 17, '16 segments + le point de fermeture');
  assert.deepEqual(anneau[0], anneau[anneau.length - 1], "l'anneau doit etre ferme");
});

test('le cercle ne degenere pas pres des poles', () => {
  // La garde `Math.max(0.1, cos(lat))` evite une division par zero, qui produirait un cercle
  // infiniment large. Aucune parcelle francaise n'est concernee, mais un plantage de la carte
  // sur une saisie aberrante ne serait pas acceptable.
  const anneau = cercleGeodesique([0, 89.9], 1000).coordinates[0]! as Position[];
  assert.ok(anneau.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});

// ---------------------------------------------------------------------------
// Formatage francais
// ---------------------------------------------------------------------------

test('une surface inferieure a l’hectare s’exprime en metres carres', () => {
  // Sous l'hectare, « 0,05 ha » est illisible pour un prospecteur : il pense en m2.
  assert.match(formatSurface(0.05), /^500\s*m²$/);
  assert.match(formatSurface(0.9999), /m²$/);
});

test('une surface d’un hectare ou plus s’exprime en hectares, a deux decimales', () => {
  assert.match(formatSurface(1), /^1,00\s*ha$/);
  assert.match(formatSurface(12.345), /^12,3[45]\s*ha$/);
});

test('une longueur bascule en kilometres a partir de mille metres', () => {
  assert.match(formatLongueur(999), /^999\s*m$/);
  assert.match(formatLongueur(1000), /^1,00\s*km$/);
  assert.match(formatLongueur(12_345), /^12,3[45]\s*km$/);
});

test('le separateur decimal est la virgule, partout', () => {
  // Le point decimal a ete corrige a l'audit 5 dans les exports ; l'interface doit suivre la
  // meme regle, faute de quoi l'ecran et le rapport ne se lisent pas pareil.
  for (const rendu of [formatSurface(1.5), formatLongueur(1500), formatNombre(2.5, 'MW')]) {
    assert.ok(!rendu.includes('.'), `« ${rendu} » ne doit pas contenir de point decimal`);
    assert.ok(rendu.includes(','), `« ${rendu} » doit contenir une virgule`);
  }
});

test('une valeur absente s’affiche comme absente, et non comme zero', () => {
  // Distinction structurante de toute l'application : « inconnu » n'est pas « nul ».
  assert.equal(formatNombre(null), '—');
  assert.equal(formatNombre(undefined), '—');
  assert.match(formatNombre(0), /^0,0$/);
});

test('une date absente ou illisible ne produit pas « Invalid Date »', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDate(''), '—');
  // Une chaine non analysable est rendue telle quelle : mieux vaut la donnee brute qu'un
  // « Invalid Date » qui ne dit rien au lecteur.
  assert.equal(formatDate('pas-une-date'), 'pas-une-date');
  assert.equal(formatDateHeure('pas-une-date'), 'pas-une-date');
});

test('une date valide est rendue au format francais', () => {
  assert.equal(formatDate('2026-08-05T10:30:00.000Z'), '05/08/2026');
  assert.match(formatDateHeure('2026-08-05T10:30:00.000Z'), /^05\/08\/2026/);
});
