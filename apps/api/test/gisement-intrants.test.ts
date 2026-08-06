/**
 * Une question posee globalement ne peut pas repondre par couche.
 *
 * POURQUOI CE FICHIER EXISTE. `intrantsMethanisation` portait le bon raisonnement dans son
 * commentaire — « un comptage a zero sur une table vide serait indiscernable d'un comptage a zero sur
 * un territoire sans elevage » — et le trahissait dans son code : UNE seule question d'existence
 * pour TROIS couches independantes.
 *
 *     SELECT EXISTS (SELECT 1 FROM contrainte WHERE type = ANY($1)) AS presente
 *
 * Une base ou une seule des trois couches serait ingeree repondait `true`, et le code affirmait
 * alors « 0 IAA a moins de 20 km » et « 0 ha d'epandage » comme des constats de terrain, avec
 * `sourcesIntrantsIngerees: true` pour l'attester. Le defaut etait dormant — aucune des trois
 * couches n'est ingeree aujourd'hui — et se serait declenche au PREMIER pas de la correction, c'est
 *-a-dire au moment ou l'on croirait avoir bien fait.
 *
 * Les cas ci-dessous enumerent donc les huit combinaisons d'ingestion partielle. C'est le seul moyen
 * de prouver qu'une confusion entre `null` et `0` est morte : elle ne provoque aucune erreur, elle
 * produit un nombre plausible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregerIntrants, RENDEMENTS_INTRANTS } from '../src/connecteurs/gisement.js';

const ELEVAGE = 'elevage';
const IAA = 'industrie_agroalimentaire';
const SURFACES = 'surface_agricole_commune';

/** Etat d'ingestion depuis la liste des couches presentes. */
function presence(...presentes: string[]): Record<string, boolean> {
  return Object.fromEntries([ELEVAGE, IAA, SURFACES].map((t) => [t, presentes.includes(t)]));
}

/** Comptages tels que les renvoie PostgreSQL : `count()` donne 0, `sum()` donne NULL. */
const COMPTES = { elevages: 4, iaa: 2, surfacesHa: 850 };

test('les trois couches ingerees : tout est compte et le total est calcule', () => {
  const r = agregerIntrants(presence(ELEVAGE, IAA, SURFACES), COMPTES);
  assert.equal(r.elevagesRayon10km, 4);
  assert.equal(r.iaaRayon20km, 2);
  assert.equal(r.surfacesEpandageHa, 850);
  assert.equal(r.sourcesIntrantsIngerees, true);
  // Reference calculee a la main, independamment du code : 4 x 250 + 2 x 800 + 850 x 0,4.
  assert.equal(r.intrantsMethaTonnesMsAn, 1000 + 1600 + 340);
  // Et la constante doit rester celle documentee, sans quoi le calcul ci-dessus ne dit plus rien.
  assert.equal(RENDEMENTS_INTRANTS.parElevage, 250);
  assert.equal(RENDEMENTS_INTRANTS.parIaa, 800);
  assert.equal(RENDEMENTS_INTRANTS.parHectare, 0.4);
});

test('aucune couche ingeree : tout est inconnu, rien ne vaut zero', () => {
  const r = agregerIntrants(presence(), COMPTES);
  assert.equal(r.elevagesRayon10km, null);
  assert.equal(r.iaaRayon20km, null);
  assert.equal(r.surfacesEpandageHa, null);
  assert.equal(r.intrantsMethaTonnesMsAn, null);
  assert.equal(r.sourcesIntrantsIngerees, false);
});

test('une seule couche ingeree ne fait pas affirmer zero sur les deux autres', () => {
  // LE DEFAUT, dans sa forme exacte. Avant correction, ce cas repondait
  // `{ elevages: 4, iaa: 0, surfaces: 0, sourcesIntrantsIngerees: true }` — deux absences
  // affirmees et un total sous-estime presente comme une estimation.
  const r = agregerIntrants(presence(ELEVAGE), COMPTES);
  assert.equal(r.elevagesRayon10km, 4, 'la couche presente est bien comptee');
  assert.equal(r.iaaRayon20km, null, 'la couche absente ne vaut pas zero');
  assert.equal(r.surfacesEpandageHa, null, 'la couche absente ne vaut pas zero');
  assert.equal(
    r.intrantsMethaTonnesMsAn,
    null,
    'un total partiel serait une borne inferieure presentee comme une estimation',
  );
  assert.equal(r.sourcesIntrantsIngerees, false);
});

test('les huit combinaisons : un comptage n’existe que si SA couche est ingeree', () => {
  const toutes = [ELEVAGE, IAA, SURFACES];
  for (let masque = 0; masque < 8; masque += 1) {
    const presentes = toutes.filter((_, i) => (masque & (1 << i)) !== 0);
    const r = agregerIntrants(presence(...presentes), COMPTES);

    assert.equal(
      r.elevagesRayon10km != null,
      presentes.includes(ELEVAGE),
      `masque ${masque} : elevages`,
    );
    assert.equal(r.iaaRayon20km != null, presentes.includes(IAA), `masque ${masque} : IAA`);
    assert.equal(
      r.surfacesEpandageHa != null,
      presentes.includes(SURFACES),
      `masque ${masque} : surfaces`,
    );
    assert.equal(
      r.intrantsMethaTonnesMsAn != null,
      presentes.length === 3,
      `masque ${masque} : le total n'existe que si les trois couches sont la`,
    );
    assert.equal(r.sourcesIntrantsIngerees, presentes.length === 3, `masque ${masque} : drapeau`);
  }
});

test('sur une couche ingeree, un comptage nul est une absence de terrain et vaut zero', () => {
  // La distinction dans l'autre sens, indispensable : corriger le defaut en rendant tout `null`
  // aurait detruit l'information utile. Une couche ingeree qui ne trouve rien informe.
  const r = agregerIntrants(presence(ELEVAGE, IAA, SURFACES), {
    elevages: 0,
    iaa: 0,
    surfacesHa: null, // `sum()` sur un ensemble vide renvoie NULL, et non 0
  });
  assert.equal(r.elevagesRayon10km, 0);
  assert.equal(r.iaaRayon20km, 0);
  assert.equal(
    r.surfacesEpandageHa,
    0,
    'sur une couche ingeree, un SUM nul est bien une absence de surface',
  );
  assert.equal(r.intrantsMethaTonnesMsAn, 0);
  assert.equal(r.sourcesIntrantsIngerees, true, 'territoire reellement depourvu, et on le sait');
});

test('les surfaces sont arrondies, et un arrondi ne cree pas de valeur', () => {
  const r = agregerIntrants(presence(SURFACES), { elevages: null, iaa: null, surfacesHa: 12.4 });
  assert.equal(r.surfacesEpandageHa, 12);
  const vide = agregerIntrants(presence(), { elevages: null, iaa: null, surfacesHa: 12.4 });
  assert.equal(vide.surfacesEpandageHa, null, 'un arrondi ne doit pas transformer null en 0');
});
