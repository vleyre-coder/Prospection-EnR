/**
 * Tests du calcul de pente.
 *
 * POURQUOI CE FICHIER EXISTE. Quatre audits, et celui-ci a trouve que 7 parcelles reelles sur 49
 * portaient une pente superieure a 100 %, jusqu'a 1 666 % pour 1,8 m de denivele. La cause etait
 * une garde de conditionnement inoperante — un seuil ABSOLU de 1e-6 sur un determinant dont
 * l'echelle naturelle est 1e7. Le defaut a traverse les trois audits precedents parce qu'aucun
 * test ne couvrait cette fonction et qu'aucune borne de vraisemblance ne s'appliquait.
 *
 * Le critere de pente pese 6,1 % du score solaire, et la note passait de 99/100 a 0/100 : 8 a
 * 12 points de score global, assez pour faire changer une parcelle de couleur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { penteDepuisSemis } from '../src/geo.js';

type Pt = { lon: number; lat: number; z: number };

/** Semis regulier `n x n` sur `pasDeg` degres, avec un gradient de `dzParPas` metres en longitude. */
function grille(n: number, pasDeg: number, dzParPas: number, z0 = 128): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      pts.push({ lon: 1.75 + i * pasDeg, lat: 48.1 + j * pasDeg, z: z0 + i * dzParPas });
    }
  }
  return pts;
}

/**
 * Semis en bande : les points suivent une diagonale, avec une extension transverse de
 * `lateralDeg` degres seulement. C'est la configuration produite par une parcelle en laniere,
 * dont la grille de sondage ne retient qu'une file de points — et c'est elle qui faisait
 * exploser la regression.
 */
function bande(lateralDeg: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 9; i += 1) {
    pts.push({
      lon: 1.75 + i * 0.0004,
      lat: 48.1 + i * 0.0004 + (i % 2) * lateralDeg,
      z: 128 + (i % 2) * 0.4,
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Ce que la regression doit continuer a faire
// ---------------------------------------------------------------------------

test('un semis bien reparti donne la pente par regression', () => {
  // Pas de 0,0005 deg ~ 37 m en longitude a cette latitude ; 0,5 m par pas -> ~1,3 %.
  const r = penteDepuisSemis(grille(6, 0.0005, 0.5));
  assert.equal(r.penteEstimeeParPaires, false, 'la regression doit etre retenue');
  assert.ok(r.pentePct != null && r.pentePct > 1 && r.pentePct < 2, `pente ${r.pentePct}`);
  assert.ok(r.orientationDeg != null, 'une regression retenue fournit une orientation');
});

test('une pente reellement forte n’est pas ecartee a tort', () => {
  // 20 m par pas de ~37 m : environ 54 %. Plausible sur un coteau, doit passer.
  const r = penteDepuisSemis(grille(6, 0.0005, 20));
  assert.equal(r.penteEstimeeParPaires, false);
  assert.ok(r.pentePct != null && r.pentePct > 45 && r.pentePct < 65, `pente ${r.pentePct}`);
});

test('un terrain parfaitement plat donne zero, et non null', () => {
  const r = penteDepuisSemis(grille(6, 0.0005, 0));
  assert.equal(r.pentePct, 0, 'une pente nulle est une information, pas une absence');
  assert.equal(r.penteEstimeeParPaires, false);
});

// ---------------------------------------------------------------------------
// Le defaut : la garde de conditionnement
// ---------------------------------------------------------------------------

test('un semis en bande etroite ne produit plus de pente aberrante', () => {
  // C'est le coeur du defaut. Avant correction : 6,5 %, 32,3 %, puis 129,4 % a mesure que la
  // bande se resserre, alors que le terrain est le meme et quasi plat.
  for (const lateralDeg of [1e-4, 2e-5, 5e-6]) {
    const r = penteDepuisSemis(bande(lateralDeg));
    assert.ok(r.pentePct != null, 'une valeur doit rester disponible');
    assert.ok(
      r.pentePct! < 5,
      `bande de ${(lateralDeg * 111000).toFixed(1)} m : pente ${r.pentePct} % (attendu sous 5 %)`,
    );
    assert.equal(r.penteEstimeeParPaires, true, 'le repli doit etre signale');
    assert.equal(r.orientationDeg, null, "l'orientation vient de la regression ecartee");
  }
});

test('un semis strictement aligne est ecarte, alors qu’il avait le MEILLEUR conditionnement', () => {
  // Piege contre-intuitif : quand toutes les latitudes sont egales, sxy vaut 0 et le rapport
  // det / (sxx.syy) vaut exactement 1 — le conditionnement relatif le declare parfait. Seule
  // une condition sur l'ETENDUE du nuage attrape ce cas.
  const pts: Pt[] = [];
  for (let i = 0; i < 9; i += 1) pts.push({ lon: 1.75 + i * 0.0004, lat: 48.1, z: 128 + i * 0.3 });
  const r = penteDepuisSemis(pts);
  assert.equal(r.penteEstimeeParPaires, true, 'la regression doit etre ecartee');
  assert.ok(r.pentePct != null && r.pentePct < 3, `pente ${r.pentePct}`);
});

test('la pente publiee ne depasse jamais la borne de vraisemblance', () => {
  // Balayage large de configurations degenerees : aucune ne doit produire plus de 100 %,
  // c'est-a-dire plus de 45 degres, sur un terrain dont le denivele est inferieur au metre.
  for (let k = 1; k <= 40; k += 1) {
    const r = penteDepuisSemis(bande(1e-3 / k));
    assert.ok(
      r.pentePct == null || r.pentePct <= 100,
      `k=${k} : pente ${r.pentePct} % au-dela de la borne`,
    );
  }
});

test('une parcelle trop petite rend null plutot qu’un nombre invente', () => {
  // 4x4 points sur 6 m de cote : aucune paire n'atteint 10 m, et l'etendue est sous le seuil
  // ou l'altimetrie a une resolution utile. On ne sait pas, et on le dit.
  const r = penteDepuisSemis(grille(4, 0.00002, 0.01));
  assert.equal(r.pentePct, null, "l'ignorance doit rester explicite : le critere passera gris");
  assert.equal(r.penteMaxPct, null);
});

test('moins de trois points ne produit aucune pente', () => {
  const r = penteDepuisSemis([
    { lon: 1.75, lat: 48.1, z: 128 },
    { lon: 1.751, lat: 48.101, z: 130 },
  ]);
  assert.equal(r.pentePct, null);
  assert.equal(r.deniveleM, null);
  assert.equal(r.penteEstimeeParPaires, false);
});

test('les points sans altitude sont ecartes du calcul', () => {
  const bons = grille(6, 0.0005, 0.5);
  const avecTrous = [
    ...bons,
    { lon: 1.7501, lat: 48.1001, z: Number.NaN },
    { lon: 1.7502, lat: 48.1002, z: Number.POSITIVE_INFINITY },
  ];
  const a = penteDepuisSemis(bons);
  const b = penteDepuisSemis(avecTrous);
  assert.equal(b.pentePct, a.pentePct, 'un z non fini ne doit pas influencer la pente');
});

test('le denivele reste la difference brute des altitudes', () => {
  // Le denivele n'est pas issu de la regression : il ne doit pas etre affecte par son rejet.
  const r = penteDepuisSemis(bande(5e-6));
  assert.equal(r.deniveleM, 0.4);
});

// ---------------------------------------------------------------------------
// Garde sur la migration de rattrapage
// ---------------------------------------------------------------------------

test('la migration 011 repare les snapshots deja stockes', async () => {
  // Corriger le code ne suffit pas : la pente est une donnee de SNAPSHOT, et recalculer les
  // scores les recalculerait sur la meme valeur fausse.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const sql = readFileSync(
    fileURLToPath(new URL('../../../db/migrations/011_pente_aberrante.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /pentePct.*::numeric > 100/s, 'le seuil de reparation doit etre present');
  assert.match(sql, /penteMaxPct/, 'le repli doit utiliser la mesure par paires deja stockee');
  assert.match(sql, /penteEstimeeParPaires/, 'les lignes reparees doivent etre marquees');
  assert.match(sql, /orientationDeg.*null/s, "l'orientation issue de la regression doit etre retiree");
});
