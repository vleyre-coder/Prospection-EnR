/**
 * Tests des groupes de culture du RPG et de leurs familles d'usage.
 *
 * POURQUOI CE FICHIER EXISTE. La table vivait dans `apps/api/src/connecteurs/rpg.ts`, hors de tout
 * test et hors du perimetre du garde d'orthographe — six de ses libelles circulaient sans accent
 * dans du texte AFFICHE. Elle est descendue dans `@enr/core` parce que deux nouveaux lecteurs en
 * ont besoin : le formulaire de recherche, qui traduit « de l'elevage » en groupes de culture cote
 * navigateur, et le dossier remis au developpeur, qui doit nommer l'agriculture declaree.
 *
 * CE QUE CES TESTS PROTEGENT. Une famille dont la reciproque perdrait un groupe ferait disparaitre
 * du foncier reellement propice — sans erreur, sans message, et l'operateur conclurait que ce type
 * d'agriculture n'existe pas sur le territoire. C'est le meme defaut muet que pour les regimes
 * d'implantation, et il se protege de la meme facon.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILLES_CULTURE,
  GROUPES_CULTURE,
  familleDuGroupe,
  groupesDesFamilles,
  libelleGroupeCulture,
} from '../src/cultures.js';

test('LA NOMENCLATURE COUVRE LES 27 GROUPES DU RPG', () => {
  /*
   * 27, et non 28 : la nomenclature du RPG numerote de 1 a 28 mais NE PUBLIE PAS le groupe 13.
   * Le chiffre est fige ici expres — une table tronquee par une edition maladroite passerait
   * sinon inapercue.
   */
  assert.equal(Object.keys(GROUPES_CULTURE).length, 27);
  assert.ok(!('13' in GROUPES_CULTURE), 'le groupe 13 n’existe pas dans la nomenclature du RPG');
});

test('CHAQUE GROUPE APPARTIENT A EXACTEMENT UNE FAMILLE', () => {
  /*
   * C'EST LE TEST QUI COMPTE POUR LA RECHERCHE. Un groupe orphelin serait introuvable par le
   * formulaire : le foncier correspondant existerait en base et resterait invisible. Un groupe
   * dans DEUX familles ferait, lui, compter deux fois la meme parcelle a la deselection.
   */
  for (const code of Object.keys(GROUPES_CULTURE)) {
    const familles = FAMILLES_CULTURE.filter((f) => f.groupes.includes(code));
    assert.equal(
      familles.length,
      1,
      `le groupe ${code} (${GROUPES_CULTURE[code]}) appartient a ${familles.length} famille(s)`,
    );
  }
  // Et l'inverse : une famille ne cite aucun groupe inexistant, qui ne ramenerait jamais rien.
  for (const f of FAMILLES_CULTURE) {
    for (const g of f.groupes) {
      assert.ok(GROUPES_CULTURE[g], `la famille ${f.id} cite un groupe inconnu : ${g}`);
    }
  }
});

test('LA RECIPROQUE EST COMPLETE ET NE PERD AUCUN GROUPE', () => {
  const tous = groupesDesFamilles(FAMILLES_CULTURE.map((f) => f.id));
  assert.equal(tous.length, Object.keys(GROUPES_CULTURE).length);
  assert.equal(new Set(tous).size, tous.length, 'un groupe compte deux fois');

  // L'elevage est le cas metier le plus demande : prairies, fourrage, estives et landes.
  assert.deepEqual(groupesDesFamilles(['elevage']), ['16', '17', '18', '19']);
  // Le tri est NUMERIQUE et non lexicographique : '2' avant '10', sinon la liste se lit mal en
  // infobulle et un diff de test devient illisible.
  assert.deepEqual(groupesDesFamilles(['grandes_cultures']).slice(0, 5), ['1', '2', '3', '4', '5']);
});

test('UNE FAMILLE INCONNUE NE RAMENE RIEN, PLUTOT QUE TOUT', () => {
  // Le sens d'erreur importe : rendre tous les groupes ferait sauter le filtre en silence, et la
  // recherche annoncerait un critere d'agriculture qu'elle n'applique pas.
  assert.deepEqual(groupesDesFamilles(['famille_inexistante']), []);
  assert.deepEqual(groupesDesFamilles([]), []);
});

test('CHAQUE FAMILLE PORTE UNE AIDE QUI DIT CE QU’ELLE IMPLIQUE POUR UN PROJET', () => {
  const ids = new Set<string>();
  for (const f of FAMILLES_CULTURE) {
    assert.ok(!ids.has(f.id), `identifiant de famille en double : ${f.id}`);
    ids.add(f.id);
    assert.ok(f.libelle.trim().length > 3, `libelle trop court : ${f.id}`);
    assert.ok(f.groupes.length > 0, `famille vide : ${f.id}`);
    // L'infobulle est ce qui evite a l'operateur de deviner le decoupage : une phrase, pas un mot.
    assert.ok(f.aide.length > 40, `aide trop courte pour informer : ${f.id} — « ${f.aide} »`);
  }
});

test('LES LIBELLES AFFICHES SONT ACCENTUES', () => {
  /*
   * LE DEFAUT REELLEMENT CORRIGE. Ces libelles sont affiches — fiche, dossier PDF, formulaire de
   * recherche — mais `connecteurs/rpg.ts` n'a jamais fait partie du perimetre du garde
   * d'orthographe. Six d'entre eux circulaient sans accent. Les temoins sont pris parmi eux.
   */
  assert.equal(libelleGroupeCulture('1'), 'Blé tendre');
  assert.equal(libelleGroupeCulture('2'), 'Maïs grain et ensilage');
  assert.equal(libelleGroupeCulture('8'), 'Protéagineux');
  assert.equal(libelleGroupeCulture('15'), 'Légumineuses à grains');
  assert.equal(libelleGroupeCulture('26'), 'Canne à sucre');
  assert.ok(!Object.values(GROUPES_CULTURE).some((l) => l.includes('Ã')), 'libelle double-encode');
});

test('UN CODE ABSENT OU INCONNU NE PRODUIT NI `undefined` NI FAUSSE CERTITUDE', () => {
  // `null` pour une absence — le lecteur doit ecrire « aucune declaration » lui-meme, avec la
  // nuance qui convient — et le code brut pour un groupe inconnu, qui garde l'information a
  // l'ecran au lieu de la faire disparaitre.
  assert.equal(libelleGroupeCulture(null), null);
  assert.equal(libelleGroupeCulture(''), null);
  assert.equal(libelleGroupeCulture('99'), '99');
  assert.equal(familleDuGroupe('99'), null, 'un groupe inconnu ne tombe pas dans « Divers »');
  assert.equal(familleDuGroupe(null), null);
  assert.equal(familleDuGroupe('18')?.id, 'elevage');
});
