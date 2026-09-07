/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE POTENTIEL COMMUNAL — l'indicateur qui colore la carte que l'operateur regarde EN PREMIER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI EST EN JEU. Cet indicateur ne qualifie aucune parcelle : il repond a « par ou commencer a
 * regarder ». C'est justement ce qui le rend dangereux — il oriente le travail avant toute
 * verification, et personne ne va contredire une couleur sur une carte nationale.
 *
 * TROIS FACONS DE LE RENDRE FAUX, et ce sont les trois que ce fichier verrouille.
 *
 *   1. OUBLIER LA DISPONIBILITE FONCIERE. Le raccordement seul rendrait PARIS VERT : la capitale
 *      est a quelques centaines de metres d'un poste source. Une carte qui designe Paris comme
 *      terrain de prospection photovoltaique au sol est le faux positif le plus visible possible ;
 *   2. MOYENNER LES DEUX AXES. Une commune tres bien raccordee et entierement batie ressortirait
 *      « moyenne », c'est-a-dire orange, c'est-a-dire a regarder. Un projet a besoin des DEUX :
 *      c'est le facteur limitant qui gouverne, jamais la compensation de l'un par l'autre ;
 *   3. NOTER SUR UN SEUL AXE QUAND L'AUTRE MANQUE. Defaut REELLEMENT commis dans la premiere
 *      version, et trouve en eprouvant la fonction : une commune rurale sans poste source ingere
 *      ressortait a « 100, VERT », le seul axe renseigne etant la densite. L'absence de la donnee
 *      la plus determinante se lisait comme une bonne nouvelle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Le paquet CONSTRUIT : la suite tourne sous `node --test --experimental-strip-types`.
import { potentielCommunal, COURBE_DENSITE } from '../dist/index.js';
import { FILIERES } from '@enr/core';

/** Grandeurs relevees sur les communes reelles, en km au poste et en habitants par km2. */
const PARIS = { distancePosteKm: 0.3, densiteHabKm2: 19954 };
const BEAUCE = { distancePosteKm: 4.4, densiteHabKm2: 14.2 };
const RURAL_ISOLE = { distancePosteKm: 25, densiteHabKm2: 12 };

test('PARIS N’EST JAMAIS VERTE, malgre un poste source a 300 m', () => {
  const r = potentielCommunal(PARIS, 'solaire_sol');
  assert.equal(
    r.statut,
    'rouge',
    `Paris ressort « ${r.statut} » avec un potentiel de ${r.potentiel}. Une carte nationale qui ` +
      'designe la capitale comme terrain de prospection au sol est le faux positif le plus visible ' +
      "que cette application puisse produire.",
  );
  assert.equal(r.facteurLimitant, 'foncier');
  assert.ok(
    (r.axes.raccordement.note ?? 0) > 90,
    'le raccordement parisien est excellent : c’est bien le foncier qui doit trancher, et non une ' +
      'mauvaise note de reseau',
  );
});

test('UNE COMMUNE RURALE BIEN RACCORDEE EST VERTE', () => {
  const r = potentielCommunal(BEAUCE, 'solaire_sol');
  assert.equal(r.statut, 'vert', `Beauce agricole a 4,4 km d’un poste : « ${r.statut} » obtenu`);
});

test('UNE COMMUNE RURALE TROP LOIN DU RESEAU EST ROUGE', () => {
  const r = potentielCommunal(RURAL_ISOLE, 'solaire_sol');
  assert.equal(r.statut, 'rouge');
  assert.equal(
    r.facteurLimitant,
    'raccordement',
    'du foncier disponible ne compense pas 25 km de reseau a construire',
  );
});

test('LE FACTEUR LIMITANT GOUVERNE — ce n’est PAS une moyenne', () => {
  /*
   * Le cas qui separe les deux regles : un axe excellent, un axe nul. Une moyenne rendrait ~50,
   * c'est-a-dire ORANGE, c'est-a-dire « a regarder ». Le minimum rend 0, c'est-a-dire rouge.
   */
  const r = potentielCommunal({ distancePosteKm: 0.2, densiteHabKm2: 8000 }, 'solaire_sol');
  assert.equal(r.axes.foncier.note, 0);
  assert.equal(
    r.potentiel,
    0,
    `potentiel ${r.potentiel} : un axe a 0 et un axe a ~99 ne doivent pas produire un « milieu » ` +
      'qui ne correspond a aucun territoire reel',
  );
});

test('UN AXE MANQUANT INTERDIT DE CONCLURE — jamais un potentiel partiel', () => {
  for (const [nom, entree] of [
    ['sans poste ingere', { distancePosteKm: null, densiteHabKm2: 14 }],
    ['sans population', { distancePosteKm: 4, densiteHabKm2: null }],
    ['sans rien', { distancePosteKm: null, densiteHabKm2: null }],
  ] as const) {
    const r = potentielCommunal(entree, 'solaire_sol');
    assert.equal(
      r.potentiel,
      null,
      `${nom} : un potentiel de ${r.potentiel} a ete rendu sur une donnee incomplete`,
    );
    assert.equal(r.statut, 'gris', `${nom} : le statut doit etre gris`);
    assert.ok(
      /inconnu/i.test(r.methode),
      `${nom} : la methode doit dire que c’est INCONNU et non faible — « ${r.methode} »`,
    );
  }
});

test('les valeurs non finies sont traitees comme absentes', () => {
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(potentielCommunal({ distancePosteKm: v, densiteHabKm2: 14 }, 'solaire_sol').potentiel, null);
    assert.equal(potentielCommunal({ distancePosteKm: 4, densiteHabKm2: v }, 'solaire_sol').potentiel, null);
  }
});

test('TOUTES les filieres sont notables, et le raccordement les distingue', () => {
  /*
   * Les courbes de distance different par filiere — un stockage supporte bien moins de lineaire
   * qu'un parc solaire. Si le bareme cessait de dependre de la filiere, les quatre cartes
   * nationales deviendraient identiques sans que rien ne le signale.
   */
  const notes = new Map<string, number>();
  for (const filiere of FILIERES) {
    const r = potentielCommunal({ distancePosteKm: 8, densiteHabKm2: 14 }, filiere);
    assert.ok(r.potentiel != null, `${filiere} : aucun potentiel rendu`);
    notes.set(filiere, r.potentiel);
  }
  assert.ok(
    new Set(notes.values()).size > 1,
    `les quatre filieres rendent la meme note (${[...notes.values()].join(', ')}) a 8 km d’un ` +
      'poste : le bareme ne depend plus de la filiere',
  );
});

test('la courbe de densite est monotone decroissante', () => {
  // Une courbe qui remonterait ferait qu’une commune PLUS dense serait mieux notee.
  for (let i = 1; i < COURBE_DENSITE.length; i += 1) {
    assert.ok(
      COURBE_DENSITE[i]![0] > COURBE_DENSITE[i - 1]![0],
      'les abscisses doivent croitre',
    );
    assert.ok(
      COURBE_DENSITE[i]![1] <= COURBE_DENSITE[i - 1]![1],
      `densite ${COURBE_DENSITE[i]![0]} hab/km2 mieux notee que ${COURBE_DENSITE[i - 1]![0]}`,
    );
  }
});
