/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * REPARER UN DOUBLE ENCODAGE SANS ABIMER LE TEXTE CORRECT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * D'OU VIENT CE FICHIER. Le dossier de site imprimait « ac1, ChÃ¢teau de VilleprÃ©vost » dans la
 * colonne des servitudes d'utilite publique. Verification faite sur le service lui-meme, octet par
 * octet : `C3 83 C2 A2` la ou « â » s'ecrit `C3 A2`. Le texte est encode DEUX FOIS en amont de
 * l'API IGN, qui le republie tel quel. Notre lecture est correcte ; c'est la donnee qui ne l'est pas.
 *
 * CE QUI DOIT ETRE GARDE, ET CE N'EST PAS LA REPARATION. Qu'une chaine cassee soit reparee se voit
 * a l'oeil sur un document. Ce qui ne se voit pas, et ce qui ferait de cette fonction un defaut pire
 * que celui qu'elle corrige, c'est qu'elle ABIME un texte correct — silencieusement, sur chaque
 * libelle de chaque source, dans des documents remis a des tiers.
 *
 * D'ou l'equilibre de ces tests : un cas de reparation, et huit cas ou la fonction doit se taire —
 * francais correct, ASCII pur, texte deja repare, caracteres hors Latin-1, chaine vide, absence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reparerDoubleEncodage, reparerProprietes } from '../src/texte.js';

test('le cas reel : le libelle de servitude republie par le GPU', () => {
  assert.equal(reparerDoubleEncodage('ChÃ¢teau de VilleprÃ©vost'), 'Château de Villeprévost');
});

test('LE TEXTE FRANCAIS CORRECT N’EST JAMAIS TOUCHE', () => {
  /*
   * Le risque reel de cette fonction. Chacune de ces chaines est un libelle veritable du depot ou
   * des sources : si l'une d'elles ressortait modifiee, la reparation ferait plus de degats que le
   * defaut, et sur bien plus de documents.
   */
  const correctes = [
    'Château de Villeprévost',
    'Forêt fermée de chênes décidus purs',
    "Orientations d'Aménagement et de Programmation thématiques commune Tillay-le-Péneux",
    'Vallée du Loir et affluents aux environs de Châteaudun',
    'Périmètre de protection de captage d’eau potable',
    'Pelouses sèches de Saint-Florentin',
    'Zone naturelle',
    '',
  ];
  for (const texte of correctes) {
    assert.equal(
      reparerDoubleEncodage(texte),
      texte,
      `« ${texte} » a ete modifie alors qu'il est correct : la reparation abime le texte sain`,
    );
  }
});

test('un « Ã » ne suffit pas : la relecture doit etre du UTF-8 VALIDE', () => {
  /*
   * LE TROU TROUVE PAR MUTATION, et il etait exactement du genre que ce fichier pretend garder.
   * Retirer la verification `relu.includes('�')` ne faisait echouer aucun test : toutes mes
   * chaines correctes sortaient AVANT, sur l'absence de « Ã » ou « Â ». La condition la plus fine
   * de la fonction — celle qui distingue un double encodage d'un texte qui contient simplement un
   * « Ã » — n'etait donc verifiee par rien.
   *
   * Ces chaines-ci passent le marqueur ET le test Latin-1, et echouent seulement a la validite :
   * `C3 20` et `C2 20` ne sont pas des sequences UTF-8. Sans le garde, elles ressortiraient avec un
   * caractere de remplacement a la place de deux caracteres lisibles.
   */
  for (const texte of ['Parcelle Ã 500 m', 'Zone Â risque', 'Ã']) {
    const repare = reparerDoubleEncodage(texte);
    assert.equal(
      repare,
      texte,
      `« ${texte} » a ete transforme en « ${repare} » : la relecture n'est pas du UTF-8 valide, ` +
        `la reparation aurait du renoncer`,
    );
    assert.ok(!String(repare).includes('�'), 'aucun caractere de remplacement ne doit sortir');
  }
});

test('un caractere hors Latin-1 interdit la conversion', () => {
  /*
   * La condition qui protege le plus large : un tiret cadratin, un guillemet typographique ou un
   * caractere non europeen ne tient pas sur un octet. Passer par Latin-1 perdrait l'information, la
   * fonction refuse donc d'essayer — meme si un « Ã » se trouve ailleurs dans la chaine.
   */
  for (const texte of ['Ã vallée — du Loir', 'Ã 100 % “sûr”', 'Ã 日本']) {
    assert.equal(reparerDoubleEncodage(texte), texte);
  }
});

test('l’absence traverse sans traitement', () => {
  assert.equal(reparerDoubleEncodage(null), null);
  assert.equal(reparerDoubleEncodage(undefined), undefined);
});

test('la reparation est idempotente', () => {
  const une = reparerDoubleEncodage('ChÃ¢teau de VilleprÃ©vost');
  assert.equal(reparerDoubleEncodage(une), une, 'une seconde passe doit etre sans effet');
});

test('les proprietes : seules les chaines sont traitees, le reste passe intact', () => {
  const entree = {
    nomsuplitt: 'ChÃ¢teau de VilleprÃ©vost',
    suptype: 'ac1',
    surface: 1234.5,
    actif: true,
    absent: null,
    liste: ['ChÃ¢teau'],
  };
  const sortie = reparerProprietes(entree);
  assert.equal(sortie.nomsuplitt, 'Château de Villeprévost');
  assert.equal(sortie.suptype, 'ac1');
  assert.equal(sortie.surface, 1234.5);
  assert.equal(sortie.actif, true);
  assert.equal(sortie.absent, null);
  /*
   * Les tableaux ne sont PAS parcourus, et c'est delibere : les proprietes d'une entite GeoJSON
   * sont plates dans toutes les sources exploitees ici, et descendre dans les tableaux ferait
   * parcourir des listes de coordonnees. Le test fige ce choix pour qu'il reste un choix.
   */
  assert.deepEqual(sortie.liste, ['ChÃ¢teau']);
  assert.notEqual(sortie, entree, 'l’objet d’entree ne doit pas etre modifie en place');
  assert.equal(entree.nomsuplitt, 'ChÃ¢teau de VilleprÃ©vost');
});
