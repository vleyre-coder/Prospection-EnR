/**
 * Tests de la nomenclature administrative generee.
 *
 * POURQUOI CE FICHIER EXISTE. `territoires.ts` est genere par `scripts/territoires.mjs` depuis
 * geo.api.gouv.fr, puis COMMITTE. Le generateur verifie la vraisemblance du releve, mais il ne
 * tourne pas en integration continue : sans reseau, rien ne garantirait plus que la table qu'on
 * embarque est coherente. Ces tests le garantissent HORS RESEAU.
 *
 * CE QU'ILS PROTEGENT. Un selecteur de territoire qui propose « toute une region » construit sa
 * liste de departements avec `departementsDeRegion`. Si un departement pointait une region absente,
 * il disparaitrait de tous les selecteurs sans le moindre message : l'operateur croirait la region
 * balayee alors qu'un de ses departements n'aurait jamais ete propose. C'est exactement le genre de
 * perte silencieuse que cette application refuse.
 *
 * CE QU'ILS NE PROTEGENT PAS. Ils ne disent pas si la nomenclature est A JOUR — seul un releve le
 * dit, et `node scripts/territoires.mjs --verifier` le fait sur demande. Ils ne disent pas non plus
 * si un territoire porte des donnees : c'est la base qui repond, par la couverture de recherche.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPARTEMENTS,
  REGIONS,
  TERRITOIRES_RELEVE_LE,
  departementsDeRegion,
  nomDepartement,
  nomRegion,
} from '../src/territoires.js';

test('LA TABLE COUVRE LES 18 REGIONS ET LES 101 DEPARTEMENTS', () => {
  /*
   * Les deux comptes sont ceux du Code officiel geographique : 18 regions (13 metropolitaines et
   * 5 d'outre-mer) et 101 departements. Ils sont figes ici EXPRES : une regeneration qui en
   * perdrait la moitie — source tronquee, filtre malencontreux — passerait sinon inapercue.
   *
   * Les deux comptes sont par ailleurs ceux de la table `commune` de la base nationale, mesures :
   * 34 875 communes reparties sur 101 departements et 18 codes region.
   */
  assert.equal(REGIONS.length, 18);
  assert.equal(DEPARTEMENTS.length, 101);
});

test('AUCUN CODE EN DOUBLE, NI EN REGION NI EN DEPARTEMENT', () => {
  assert.equal(new Set(REGIONS.map((r) => r.code)).size, REGIONS.length);
  assert.equal(new Set(DEPARTEMENTS.map((d) => d.code)).size, DEPARTEMENTS.length);
});

test('CHAQUE DEPARTEMENT POINTE UNE REGION QUI EXISTE', () => {
  const codes = new Set(REGIONS.map((r) => r.code));
  const orphelins = DEPARTEMENTS.filter((d) => !codes.has(d.codeRegion));
  assert.deepEqual(
    orphelins.map((d) => `${d.code} -> ${d.codeRegion}`),
    [],
    'un departement rattache a une region absente disparaitrait de tous les selecteurs',
  );
});

test('CHAQUE REGION COMPTE AU MOINS UN DEPARTEMENT', () => {
  // Une region vide serait proposee dans le selecteur et ne rendrait jamais rien.
  const vides = REGIONS.filter((r) => departementsDeRegion(r.code).length === 0);
  assert.deepEqual(vides.map((r) => r.code), []);
});

test('LA SOMME DES DEPARTEMENTS PAR REGION REDONNE LA TABLE ENTIERE', () => {
  // Garde contre un `departementsDeRegion` qui filtrerait sur le mauvais champ : le total doit
  // etre conserve, sans perte ni doublon.
  const parRegion = REGIONS.flatMap((r) => departementsDeRegion(r.code).map((d) => d.code));
  assert.equal(parRegion.length, DEPARTEMENTS.length);
  assert.equal(new Set(parRegion).size, DEPARTEMENTS.length);
});

test('LES CODES ONT LA FORME ATTENDUE PAR LA VALIDATION DE L API', () => {
  /*
   * `filtresValides` accepte un code departement sur le motif /^(\d{2}|\d{3}|2A|2B)$/ et un code
   * region sur /^\d{2}$/. Si la table portait un code hors de ces motifs, l'interface le
   * proposerait et le serveur le REFUSERAIT en 400 : une entree du selecteur inutilisable.
   */
  for (const r of REGIONS) {
    assert.match(r.code, /^\d{2}$/, `code region hors motif : ${r.code}`);
  }
  for (const d of DEPARTEMENTS) {
    assert.match(d.code, /^(\d{2}|\d{3}|2A|2B)$/, `code departement hors motif : ${d.code}`);
  }
});

test('CHAQUE TERRITOIRE PORTE UN NOM NON VIDE ET ACCENTUE CORRECTEMENT', () => {
  for (const t of [...REGIONS, ...DEPARTEMENTS]) {
    assert.ok(t.nom.trim().length >= 3, `nom trop court : ${t.code} « ${t.nom} »`);
  }
  // Temoin d'un encodage abime : « Ile-de-France » sans accent, ou « ÃŽle » en double encodage.
  assert.equal(nomRegion('11'), 'Île-de-France');
  assert.equal(nomDepartement('2A'), 'Corse-du-Sud');
  assert.equal(nomDepartement('974'), 'La Réunion');
  assert.ok(!REGIONS.some((r) => r.nom.includes('Ã')), 'nom de region double-encode');
  assert.ok(!DEPARTEMENTS.some((d) => d.nom.includes('Ã')), 'nom de departement double-encode');
});

test('UN CODE INCONNU RETOURNE LE CODE, ET NON `undefined`', () => {
  /*
   * L'interface affiche ces libelles directement. Rendre `undefined` afficherait « undefined » a
   * l'ecran ; rendre le code affiche une information pauvre mais VRAIE. Le cas se produit pour de
   * bon : la base peut porter un code departement de collectivite d'outre-mer que l'API Geo ne
   * publie pas comme departement.
   */
  assert.equal(nomRegion('99'), '99');
  assert.equal(nomDepartement('987'), '987');
  assert.equal(departementsDeRegion('99').length, 0);
});

test('LE RELEVE EST DATE, ET LA DATE EST PLAUSIBLE', () => {
  assert.match(TERRITOIRES_RELEVE_LE, /^\d{4}-\d{2}-\d{2}$/);
  // La derniere refonte des regions est de 2016 : un releve anterieur decrirait 22 regions.
  assert.ok(TERRITOIRES_RELEVE_LE >= '2016-01-01', 'releve anterieur a la refonte regionale');
});
