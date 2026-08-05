/**
 * Veille sur la degradation silencieuse des sources.
 *
 * POURQUOI CE FICHIER EXISTE. Les trois defauts critiques des audits 5, 6 et 7 ont la meme
 * signature : une source repond HTTP 200, le code ne plante pas, et un champ devient toujours nul
 * ou faux. Rien ne s'allume — ni erreur, ni journal, ni sonde de sante, qui verifie que les
 * services repondent et non que leurs reponses portent encore quelque chose.
 *
 * Le seul signal disponible est l'effondrement du TAUX DE RENSEIGNEMENT sur un lot. Ces tests
 * verifient que ce signal se declenche quand il doit, et surtout qu'il ne se declenche pas a tort :
 * une veille qui crie sur un territoire legitimement pauvre en donnees serait ignoree en deux jours.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identiteDepuisIdu, snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { CHAMPS_SURVEILLES, veillerSurLot } from '../src/services/veille-sources.js';

/** Lot de snapshots, tous identiques a la transformation pres. */
function lot(n: number, remplir: (s: ParcelleSnapshot, i: number) => void): ParcelleSnapshot[] {
  return Array.from({ length: n }, (_, i) => {
    const s = snapshotVide(identiteDepuisIdu('283900000C0843'));
    remplir(s, i);
    return s;
  });
}

/** Remplit tous les champs surveilles, pour partir d'un lot sain. */
function remplirTout(s: ParcelleSnapshot): void {
  s.urbanisme.typeDocument = 'PLUi';
  s.milieux.natura2000Habitats.nom = 'Beauce et vallee de la Conie';
  s.bati.distanceHabitationM = 420;
  s.topographie.pentePct = 2.4;
  s.raccordement.posteLePlusProche = {
    nom: 'Poste test', gestionnaire: 'Enedis', distanceKm: 3.2,
    capaciteResiduelleMw: 12, fileAttenteMw: 0, etatSaturation: 'disponible',
    renforcement: null, coutRaccordementEurParKw: null,
  } as never;
  s.occupationSol.typeSol = 'agricole_exploite';
}

test('un lot sain ne declenche aucune anomalie', () => {
  const r = veillerSurLot(lot(30, remplirTout));
  assert.equal(r.suffisant, true);
  assert.deepEqual(r.anomalies, []);
});

test('un champ tombe a zero sur tout le lot est signale', () => {
  // Signature exacte du defaut de l'audit 6 : `typeDocument` toujours nul parce que lu sous
  // `typedoc`, un nom qui n'existe pas dans la reponse.
  const r = veillerSurLot(lot(30, (s) => {
    remplirTout(s);
    s.urbanisme.typeDocument = null;
  }));
  const a = r.anomalies.find((x) => x.chemin === 'urbanisme.typeDocument');
  assert.ok(a, 'le champ effondre doit etre signale');
  assert.equal(a.renseignes, 0);
  assert.equal(a.total, 30);
  assert.match(a.motif, /du_type/, 'le motif doit rappeler le defaut historique');
});

test('plusieurs champs effondres sont tous signales', () => {
  const r = veillerSurLot(lot(25, (s) => {
    remplirTout(s);
    s.urbanisme.typeDocument = null;
    s.milieux.natura2000Habitats.nom = null;
    s.bati.distanceHabitationM = null;
  }));
  const chemins = r.anomalies.map((a) => a.chemin).sort();
  assert.deepEqual(chemins, [
    'bati.distanceHabitationM',
    'milieux.natura2000Habitats.nom',
    'urbanisme.typeDocument',
  ]);
});

test('un lot trop petit ne conclut rien, plutot que de conclure a tort', () => {
  // Sur trois parcelles, un taux de 0 ne prouve rien : trois communes au reglement national
  // d'urbanisme suffiraient a produire une fausse alerte.
  const r = veillerSurLot(lot(3, () => undefined), 20);
  assert.equal(r.suffisant, false);
  assert.deepEqual(r.anomalies, []);
});

test('un territoire legitimement pauvre en donnees ne declenche pas d’alerte', () => {
  // Une commune sans site Natura 2000 dans le rayon n'a pas de nom de site, et c'est normal.
  // Le seuil de ce champ est donc bas : la veille detecte la disparition, pas la rarete.
  const natura = CHAMPS_SURVEILLES.find((c) => c.chemin === 'milieux.natura2000Habitats.nom');
  assert.ok(natura && natura.tauxMin <= 0.1, 'le seuil doit rester tolerant sur ce champ');
  // Un site sur vingt suffit a rester au-dessus du seuil.
  const r = veillerSurLot(lot(20, (s, i) => {
    remplirTout(s);
    if (i > 0) s.milieux.natura2000Habitats.nom = null;
  }));
  assert.equal(r.anomalies.find((a) => a.chemin === 'milieux.natura2000Habitats.nom'), undefined);
});

test('zero, false et la chaine vide comptent comme renseignes', () => {
  // Distinction fondamentale de toute l'application : `0` est une mesure, `null` une absence.
  // Une distance de 0 m signifie « habitation sur la parcelle » — le cas le plus grave, qui ne
  // doit surtout pas etre compte comme donnee manquante.
  const r = veillerSurLot(lot(30, (s) => {
    remplirTout(s);
    s.bati.distanceHabitationM = 0;
    s.topographie.pentePct = 0;
  }));
  assert.deepEqual(r.anomalies, []);
});

test('chaque champ surveille porte un motif qui explique ce qu’il protege', () => {
  // Un seuil sans justification devient un seuil qu'on ajuste pour faire taire l'alerte.
  for (const c of CHAMPS_SURVEILLES) {
    assert.ok(c.motif.length > 60, `${c.chemin} : motif trop court`);
    assert.ok(c.tauxMin > 0 && c.tauxMin <= 1, `${c.chemin} : seuil hors bornes`);
  }
  assert.ok(CHAMPS_SURVEILLES.length >= 6, 'la surveillance doit couvrir les champs structurants');
});
