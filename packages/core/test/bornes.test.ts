/**
 * Tests des bornes de vraisemblance.
 *
 * POURQUOI. Le quatrieme audit a trouve une pente de 1 666 % en base, ayant survecu trois audits
 * et faussant le score de 14 % des parcelles. Le calcul est corrige, mais le vrai enseignement
 * etait qu'AUCUN CONTROLE ne s'opposait a l'ecriture d'une valeur impossible.
 *
 * Ces bornes sont le seul garde-fou du projet qui protege de defauts A VENIR plutot que de defauts
 * connus : un connecteur qui change d'unite, une API qui renvoie des pieds, une regression dans un
 * calcul non teste. Les tests ci-dessous verifient donc autant le mecanisme que sa DISCIPLINE —
 * qu'aucune borne ne soit declaree sans motif, qu'aucune ne rejette un cas reel, et que la
 * violation produise un « je ne sais pas » et non un nombre ecrete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BORNES_SNAPSHOT,
  assainirSnapshot,
  identiteDepuisIdu,
  snapshotVide,
  verifierBornes,
  type ParcelleSnapshot,
} from '../dist/index.js';

function snap(): ParcelleSnapshot {
  const s = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  // Le poste source est `null` dans un snapshot vide : les bornes qui le concernent ne
  // s'appliqueraient jamais sans cette initialisation.
  s.raccordement.posteLePlusProche = {
    id: 'p1',
    nom: 'Poste test',
    gestionnaire: 'Enedis',
    tension: '63 kV / 20 kV',
    distanceKm: 4.2,
    capaciteResiduelleMw: 12,
    etatSaturation: 'disponible',
    fileAttenteMw: 0,
    quotePartEurParKw: 45,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
  };
  return s;
}

/** Ecrit une valeur au bout d'un chemin pointe. */
function poser(s: ParcelleSnapshot, chemin: string, valeur: unknown): void {
  const parties = chemin.split('.');
  let courant: Record<string, unknown> = s as unknown as Record<string, unknown>;
  for (const cle of parties.slice(0, -1)) courant = courant[cle] as Record<string, unknown>;
  courant[parties[parties.length - 1]!] = valeur;
}

function lire(s: ParcelleSnapshot, chemin: string): unknown {
  let courant: unknown = s;
  for (const cle of chemin.split('.')) courant = (courant as Record<string, unknown>)[cle];
  return courant;
}

// ---------------------------------------------------------------------------
// Discipline de declaration
// ---------------------------------------------------------------------------

test('chaque borne porte un motif, une unite et un intervalle ordonne', () => {
  const fautes: string[] = [];
  for (const b of BORNES_SNAPSHOT) {
    // Une borne sans motif finit par etre resserree a tort par quelqu'un qui ne sait pas
    // pourquoi elle est la : c'est ainsi qu'un garde-fou devient un defaut.
    if (!b.motif || b.motif.length < 40) fautes.push(`${b.chemin} : motif absent ou trop court`);
    if (!b.unite) fautes.push(`${b.chemin} : unite`);
    if (!(b.min < b.max)) fautes.push(`${b.chemin} : intervalle [${b.min}, ${b.max}]`);
    if (!Number.isFinite(b.min) || !Number.isFinite(b.max)) fautes.push(`${b.chemin} : borne non finie`);
  }
  assert.deepEqual(fautes, []);
});

test('aucune borne n’est declaree deux fois', () => {
  const chemins = BORNES_SNAPSHOT.map((b) => b.chemin);
  assert.equal(new Set(chemins).size, chemins.length);
});

test('chaque chemin borne existe reellement dans le snapshot', () => {
  // Une borne sur un chemin inexistant ne s'applique jamais et donne l'illusion d'une protection.
  // C'est exactement le defaut trouve sur les cibles d'avertissement.
  const s = snap();
  const introuvables = BORNES_SNAPSHOT.filter((b) => {
    let courant: unknown = s;
    for (const cle of b.chemin.split('.')) {
      if (courant == null || typeof courant !== 'object' || !(cle in courant)) return true;
      courant = (courant as Record<string, unknown>)[cle];
    }
    return false;
  }).map((b) => b.chemin);
  assert.deepEqual(introuvables, []);
});

// ---------------------------------------------------------------------------
// Le cas qui a motive tout ceci
// ---------------------------------------------------------------------------

test('une pente de 1 666 % est refusee et ramenee a « je ne sais pas »', () => {
  const s = snap();
  poser(s, 'topographie.pentePct', 1665.9);
  const anomalies = assainirSnapshot(s);

  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.chemin, 'topographie.pentePct');
  assert.equal(anomalies[0]!.valeur, 1665.9);
  // `null` et NON un ecretage a 100 : une valeur ecretee reste fausse et cesse d'etre visible.
  assert.equal(s.topographie.pentePct, null);
});

test('les valeurs plausibles traversent sans etre touchees', () => {
  const s = snap();
  poser(s, 'topographie.pentePct', 3.2);
  poser(s, 'topographie.altitudeM', 129);
  poser(s, 'gisement.irradiationKwhM2An', 1475);
  poser(s, 'bati.distanceHabitationM', 565);
  poser(s, 'gisement.ventVitesse100mMs', 6.4);

  assert.deepEqual(assainirSnapshot(s), []);
  assert.equal(s.topographie.pentePct, 3.2);
  assert.equal(s.gisement.irradiationKwhM2An, 1475);
});

// ---------------------------------------------------------------------------
// Aucun cas reel francais ne doit etre rejete
// ---------------------------------------------------------------------------

test('les extremes reels du territoire francais sont acceptes', () => {
  /**
   * Une borne trop serree serait un defaut PLUS GRAVE que celui qu'elle corrige : elle
   * effacerait des donnees justes sur les parcelles les plus atypiques, precisement celles ou
   * l'utilisateur a le plus besoin de la mesure.
   */
  const extremes: Array<[string, number, string]> = [
    ['topographie.pentePct', 85, 'coteau viticole tres pentu'],
    ['topographie.penteMaxPct', 150, 'front de taille dans une ancienne carriere'],
    ['topographie.altitudeM', 2800, 'parcelle d’alpage en Haute-Savoie'],
    ['topographie.altitudeM', -2, 'delta du Rhone, sous le niveau de la mer'],
    ['topographie.deniveleM', 900, 'parcelle de montagne tres etendue'],
    ['gisement.irradiationKwhM2An', 2100, 'La Reunion'],
    ['gisement.irradiationKwhM2An', 950, 'nord de la France, annee peu ensoleillee'],
    ['gisement.ventVitesse100mMs', 10.5, 'cote du Cotentin'],
    ['gisement.productibleKwhKwcAn', 1700, 'outre-mer'],
    ['bati.distanceHabitationM', 15_000, 'plateau du Vercors, point le plus isole'],
    ['raccordement.posteLePlusProche.distanceKm', 60, 'zone de montagne mal desservie'],
    ['foncier.surfaceDunSeulTenantHa', 12_000, 'domaine forestier d’un seul tenant'],
    ['occupationSol.rpg.anneesDeclareesConsecutives', 18, 'exploitation declaree sans interruption'],
    ['patrimoine.monumentHistorique.distanceM', 45_000, 'zone rurale sans monument classe'],
  ];

  const rejetes: string[] = [];
  for (const [chemin, valeur, cas] of extremes) {
    const s = snap();
    poser(s, chemin, valeur);
    if (verifierBornes(s).some((a) => a.chemin === chemin)) {
      rejetes.push(`${chemin} = ${valeur} (${cas})`);
    }
  }
  assert.deepEqual(rejetes, [], 'ces valeurs existent en France : les rejeter effacerait du vrai');
});

test('les confusions d’unite classiques sont rattrapees', () => {
  // Chaque ligne est une erreur qu'un changement de source peut introduire du jour au lendemain,
  // sans qu'aucun test unitaire existant ne s'en apercoive.
  const confusions: Array<[string, number, string]> = [
    ['raccordement.posteLePlusProche.distanceKm', 4200, 'metres pris pour des kilometres'],
    ['bati.distanceHabitationM', 1_850_000, 'millimetres pris pour des metres'],
    ['gisement.irradiationKwhM2An', 5_310_000, 'joules par metre carre pris pour des kWh'],
    ['gisement.irradiationKwhM2An', 1.475, 'MWh pris pour des kWh'],
    ['topographie.altitudeM', 423, "pieds pris pour des metres — NON rattrape, la valeur reste plausible"],
    ['occupationSol.rpg.partRecouvrement', 87, 'pourcents pris pour une part'],
    ['gisement.ventVitesse100mMs', 23, 'km/h pris pour des m/s'],
    ['topographie.pentePct', 45_000, 'pour-mille ou degres multiplies'],
  ];

  const nonRattrapees: string[] = [];
  for (const [chemin, valeur, cas] of confusions) {
    const s = snap();
    poser(s, chemin, valeur);
    if (!verifierBornes(s).some((a) => a.chemin === chemin)) nonRattrapees.push(`${chemin} = ${valeur} (${cas})`);
  }
  // Le cas des pieds est volontairement dans la liste et volontairement NON rattrape : 423 m est
  // une altitude parfaitement plausible en France. Une borne ne peut pas tout attraper, et le
  // reconnaitre explicitement vaut mieux que de laisser croire le contraire.
  assert.deepEqual(nonRattrapees, [
    'topographie.altitudeM = 423 (pieds pris pour des metres — NON rattrape, la valeur reste plausible)',
  ]);
});

// ---------------------------------------------------------------------------
// Absence de donnee et valeurs non finies
// ---------------------------------------------------------------------------

test('une donnee absente n’est pas une anomalie de borne', () => {
  // L'absence est un etat legitime, abondamment gere ailleurs : la signaler ici noierait les
  // vraies anomalies sous des dizaines de lignes de journal a chaque parcelle.
  assert.deepEqual(verifierBornes(snap()).filter((a) => a.chemin !== 'x'), []);
});

test('NaN et Infinity sont refuses', () => {
  // Ils traduisent une division par zero ou une lecture ratee, et se propageraient dans tous les
  // calculs sans jamais declencher une comparaison de bornes : `NaN > 100` est faux.
  for (const valeur of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const s = snap();
    poser(s, 'topographie.pentePct', valeur);
    const a = verifierBornes(s);
    assert.equal(a.length, 1, `${String(valeur)} doit etre signale`);
    assert.equal(a[0]!.chemin, 'topographie.pentePct');
  }
});

test('une valeur negative est refusee la ou elle n’a pas de sens', () => {
  for (const chemin of ['bati.distanceHabitationM', 'topographie.pentePct', 'foncier.nbProprietairesEstime']) {
    const s = snap();
    poser(s, chemin, -1);
    assert.ok(
      verifierBornes(s).some((a) => a.chemin === chemin),
      `${chemin} = -1 doit etre refuse`,
    );
  }
});

test('une altitude negative reste acceptee : elle existe', () => {
  // Contre-exemple delibere au test precedent : toutes les grandeurs ne sont pas positives.
  const s = snap();
  poser(s, 'topographie.altitudeM', -2);
  assert.deepEqual(verifierBornes(s), []);
});

// ---------------------------------------------------------------------------
// Comportement d'ensemble
// ---------------------------------------------------------------------------

test('plusieurs anomalies sont toutes relevees et toutes annulees', () => {
  const s = snap();
  poser(s, 'topographie.pentePct', 1665.9);
  poser(s, 'gisement.irradiationKwhM2An', 5_310_000);
  poser(s, 'bati.distanceHabitationM', -50);

  const anomalies = assainirSnapshot(s);
  assert.equal(anomalies.length, 3);
  assert.equal(s.topographie.pentePct, null);
  assert.equal(s.gisement.irradiationKwhM2An, null);
  assert.equal(s.bati.distanceHabitationM, null);
});

test('l’assainissement est idempotent', () => {
  const s = snap();
  poser(s, 'topographie.pentePct', 1665.9);
  assert.equal(assainirSnapshot(s).length, 1);
  assert.deepEqual(assainirSnapshot(s), [], 'un deuxieme passage ne doit plus rien trouver');
});

test('une anomalie porte de quoi diagnostiquer le connecteur fautif', () => {
  const s = snap();
  poser(s, 'gisement.ventVitesse100mMs', 23);
  const [a] = assainirSnapshot(s);
  assert.ok(a);
  // Sans la valeur, l'unite et l'intervalle, le journal dit qu'il y a un probleme sans dire
  // lequel : l'exploitant ne peut pas remonter au connecteur.
  assert.equal(a!.valeur, 23);
  assert.equal(a!.unite, 'm/s');
  assert.equal(a!.max, 20);
  assert.ok(a!.motif.length > 40);
});

test('un poste source absent ne declenche aucune anomalie', () => {
  // Le chemin traverse un `null` : la lecture doit s'arreter proprement, pas lever.
  const s = snapshotVide(identiteDepuisIdu('283900000C0843'));
  assert.equal(s.raccordement.posteLePlusProche, null);
  assert.deepEqual(verifierBornes(s), []);
});

test('l’assainissement est branche sur le pipeline d’enrichissement', async () => {
  /**
   * Le mecanisme le plus soigne ne sert a rien s'il n'est appele nulle part — c'est arrive trois
   * fois dans ce projet (purge RGPD, derniere campagne, empreinte du referentiel). Cette garde
   * verifie le branchement lui-meme.
   */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('../../../apps/api/src/enrichissement.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /assainirSnapshot\(snapshot\)/, 'le pipeline doit assainir avant de rendre');
  // Apres la pose de `dateSnapshot` : l'assainissement doit voir le snapshot COMPLET, tous
  // connecteurs fusionnes, sinon il controlerait un objet a moitie rempli.
  assert.ok(
    source.indexOf('snapshot.dateSnapshot =') < source.indexOf('assainirSnapshot(snapshot)'),
    "l'assainissement doit venir apres la fusion de tous les connecteurs",
  );
  assert.match(source, /journal\.warn/, 'une anomalie doit etre journalisee pour etre vue');
});
