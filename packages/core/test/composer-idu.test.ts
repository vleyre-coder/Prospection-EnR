/**
 * La composition d'un IDU, et son aller-retour avec `identiteDepuisIdu`.
 *
 * POURQUOI CE FICHIER EXISTE. Un signalement d'usage a montre qu'une parcelle precise etait
 * introuvable dans l'application. L'une des pieces du correctif est de pouvoir designer une parcelle
 * depuis le cadastre affiche sur la carte — donc de composer son IDU a partir des attributs de la
 * tuile vectorielle (`code_insee`, `com_abs`, `section`, `numero`).
 *
 * Cette composition etait deja ecrite a deux endroits du depot, et l'une des deux versions etait
 * fautive. Une regle de domaine ecrite plusieurs fois se corrige une fois sur deux : elle est
 * desormais unique, et ce fichier verifie qu'elle est juste — y compris sur les cas qui font
 * echouer les versions naives.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerIdu, identiteDepuisIdu, iduDepuisTuile } from '../src/index.js';

test('LE CAS REEL : la parcelle de reference se recompose a l’identique', () => {
  // 283900000A0094 : Tillay-le-Peneux, section 0A, parcelle 0094. C'est la parcelle qui sert de
  // reference a toutes les fixtures du projet.
  assert.equal(
    composerIdu({ codeInsee: '28390', prefixe: '000', section: '0A', numero: '0094' }),
    '283900000A0094',
  );
});

test('LE PIEGE DES VERSIONS NAIVES : une section d’une seule lettre est completee', () => {
  /**
   * Le Plan Cadastral Informatise ecrit parfois la section « A » et parfois « 0A ». La composition
   * sans normalisation, telle qu'elle existait dans le connecteur cadastre, produisait alors un IDU
   * de TREIZE caracteres — qui ne correspond a aucune parcelle, et dont la recherche ne renvoie rien
   * sans dire pourquoi.
   */
  assert.equal(
    composerIdu({ codeInsee: '28390', prefixe: '000', section: 'A', numero: '0094' }),
    '283900000A0094',
  );
  assert.equal(composerIdu({ codeInsee: '28390', section: 'A', numero: '94' }).length, 14);
});

test('un numero court est complete a gauche, pas a droite', () => {
  // Completer a droite donnerait « 9400 » : une autre parcelle, existante, sur la meme section. Le
  // sens de la completion n'est donc pas un detail de presentation.
  assert.equal(
    composerIdu({ codeInsee: '28390', prefixe: '000', section: '0A', numero: '94' }),
    '283900000A0094',
  );
});

test('LE PREFIXE N’EST PAS TOUJOURS « 000 » : une commune fusionnee le porte', () => {
  /**
   * C'etait la faute de la recherche, qui ecrivait « 000 » en dur. Dans une commune issue d'une
   * fusion, le prefixe designe la commune ABSORBEE : deux parcelles de meme section et meme numero
   * coexistent alors sous deux prefixes differents. Ecrire « 000 » en dur revient a en designer une
   * au hasard.
   */
  assert.equal(
    composerIdu({ codeInsee: '14712', prefixe: '215', section: 'AB', numero: '0012' }),
    '14712215AB0012',
  );
  // Absent ou nul, le prefixe vaut « 000 » : le cas de loin le plus courant.
  assert.equal(composerIdu({ codeInsee: '14712', section: 'AB', numero: '0012' }).slice(5, 8), '000');
  assert.equal(
    composerIdu({ codeInsee: '14712', prefixe: null, section: 'AB', numero: '0012' }).slice(5, 8),
    '000',
  );
});

test('un code INSEE corse ou d’outre-mer traverse sans dommage', () => {
  // Les codes corses portent une lettre (« 2A004 »), et l'outre-mer tient sur trois chiffres de
  // departement (« 97411 »). Ni l'un ni l'autre ne doit etre altere par la normalisation.
  assert.equal(composerIdu({ codeInsee: '2A004', section: 'AB', numero: '1' }).slice(0, 5), '2A004');
  assert.equal(composerIdu({ codeInsee: '97411', section: 'AB', numero: '1' }).slice(0, 5), '97411');
});

test('les espaces parasites d’une source sont absorbes', () => {
  // Les attributs d'une tuile vectorielle arrivent parfois avec des espaces. Un IDU de 15 caracteres
  // ne correspondrait a rien, et l'echec serait muet.
  assert.equal(
    composerIdu({ codeInsee: ' 28390 ', prefixe: ' 000 ', section: ' 0a ', numero: ' 94 ' }),
    '283900000A0094',
  );
});

test('L’ALLER-RETOUR EST FIDELE : composer puis decomposer redonne les composants', () => {
  /**
   * La propriete qui compte vraiment, et la seule qui protege contre une derive future : les deux
   * fonctions vivent dans le meme fichier et doivent rester inverses l'une de l'autre. Si quelqu'un
   * change une largeur de champ dans l'une, ce test tombe.
   */
  const cas = [
    { codeInsee: '28390', prefixe: '000', section: '0A', numero: '0094' },
    { codeInsee: '14712', prefixe: '215', section: 'AB', numero: '0012' },
    { codeInsee: '2A004', prefixe: '000', section: 'ZC', numero: '1234' },
    { codeInsee: '97411', prefixe: '042', section: 'AY', numero: '0007' },
  ];
  for (const c of cas) {
    const idu = composerIdu(c);
    assert.equal(idu.length, 14, `${idu} ne fait pas 14 caracteres`);
    const identite = identiteDepuisIdu(idu);
    assert.equal(identite.codeInsee, c.codeInsee);
    assert.equal(identite.prefixe, c.prefixe);
    assert.equal(identite.section, c.section);
    assert.equal(identite.numero, c.numero);
  }
});

// ---------------------------------------------------------------------------
// Designer une parcelle cliquee sur une tuile cadastrale
// ---------------------------------------------------------------------------

/**
 * Les attributs employes ci-dessous sont ceux d'une entite REELLE de la couche `parcelle` du Plan
 * Cadastral Informatise, relevee le 13/08/2026 sur la tuile 16/33093/22738 (Tillay-le-Peneux). La liste
 * complete des attributs est figee dans `apps/api/test/fixtures/proprietes-sources.json` et surveillee
 * par `contrats-sources` : ici on verifie ce que le code EN FAIT.
 */
const ENTITE_REELLE = {
  code_com: '390',
  numero: '0012',
  feuille: 1,
  code_arr: '000',
  code_insee: '28390',
  nom_com: 'Tillay-le-Péneux',
  contenance: 39319,
  com_abs: '000',
  idu: '28390000ZH0012',
  section: 'ZH',
  gid: 8082105,
  fid: 249456,
  code_dep: '28',
};

test('UNE PARCELLE CLIQUEE EST IDENTIFIEE : la tuile porte son identifiant tout fait', () => {
  assert.equal(iduDepuisTuile(ENTITE_REELLE), '28390000ZH0012');
});

test('sans identifiant sur la tuile, il se recompose des composants', () => {
  const { idu: _ignore, ...sansIdu } = ENTITE_REELLE;
  assert.equal(iduDepuisTuile(sansIdu), '28390000ZH0012');
  // Et la recomposition normalise : « ZH » abrege en « H », numero non complete.
  assert.equal(
    iduDepuisTuile({ code_insee: '28390', com_abs: '000', section: 'H', numero: '12' }),
    '283900000H0012',
  );
});

test('UN IDENTIFIANT TRONQUE EST REFUSE plutot que propage', () => {
  /**
   * Le cas important. Un identifiant incomplet ne designe AUCUNE parcelle : la qualification
   * echouerait sans que l'utilisateur puisse comprendre pourquoi. Il vaut mieux ne rien proposer et le
   * dire — c'est ce que `null` permet a l'appelant.
   */
  assert.equal(iduDepuisTuile({ idu: '28390000ZH001' }), null, 'treize caracteres : refuse');
  assert.equal(iduDepuisTuile({}), null, 'aucun attribut : refuse');
  assert.equal(iduDepuisTuile({ code_insee: '28390', section: 'ZH' }), null, 'numero manquant : refuse');
  assert.equal(iduDepuisTuile({ code_insee: '28390', numero: '0012' }), null, 'section manquante : refuse');
  assert.equal(iduDepuisTuile({ idu: null, code_insee: null }), null, 'attributs nuls : refuse');
});

test('un identifiant tronque sur la tuile n’empeche pas la recomposition', () => {
  // Une tuile peut porter un `idu` inutilisable ET les composants justes. On ne jette pas le clic pour
  // autant : les composants ont le dernier mot.
  assert.equal(
    iduDepuisTuile({ idu: 'ABC', code_insee: '28390', com_abs: '000', section: 'ZH', numero: '0012' }),
    '28390000ZH0012',
  );
});
