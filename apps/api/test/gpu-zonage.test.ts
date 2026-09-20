/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE ZONAGE D'URBANISME, RAMENE A CE QUE LE CLASSEUR SAIT LIRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE JOUE ICI. Le Geoportail rend des libelles de zone inventes document par document —
 * « A », « Ap », « N », « Nj », « 1AUx », « UBa ». Le classeur, lui, raisonne sur quatre familles.
 * La normalisation est donc necessaire, et elle porte deux pieges qui ne se voient pas :
 *
 *   1. L'ORDRE DES PREFIXES. « AU » doit etre reconnu AVANT « A », sans quoi « 1AUx » tombe en
 *      zone agricole. Une zone a urbaniser presentee comme une terre agricole, sur la donnee qui
 *      gouverne la constructibilite : l'erreur est invisible et porte sur l'essentiel.
 *
 *   2. « DOMINANT » SE MESURE. 82 des 382 zonages releves portent sur des parcelles a cheval sur
 *      plusieurs zones. Prendre le premier de la liste rend le resultat dependant de l'ordre de la
 *      reponse du GPU, qui n'est pas un ordre de surface — donc reproductible par hasard.
 *
 * Ces fonctions sont pures et exportees pour cette raison : elles se verifient sans reseau.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familleZone, presenceEbc, zoneDominante } from '../src/connecteurs/gpu.js';

test('« 1AUx » EST UNE ZONE A URBANISER, PAS UNE ZONE AGRICOLE', () => {
  /*
   * LE PIEGE PRINCIPAL DE CE FICHIER. Un test de prefixe ecrit dans l'ordre alphabetique — « A »
   * avant « AU » — range toutes les zones a urbaniser en zone agricole. La faute ne leve rien, ne
   * se voit pas a la relecture, et porte sur la donnee qui decide de la constructibilite.
   */
  assert.equal(familleZone('1AUx'), 'AU');
  assert.equal(familleZone('AU'), 'AU');
  assert.equal(familleZone('2AU'), 'AU');
  assert.equal(familleZone('AUc'), 'AU');

  assert.equal(familleZone('A'), 'A');
  assert.equal(familleZone('Ap'), 'A', 'un suffixe de protection reste une zone agricole');
  assert.equal(familleZone('Ah'), 'A');
});

test('LES QUATRE FAMILLES, ET RIEN D’AUTRE', () => {
  assert.equal(familleZone('U'), 'U');
  assert.equal(familleZone('UBa'), 'U');
  assert.equal(familleZone('N'), 'N');
  assert.equal(familleZone('Nj'), 'N');

  // Une valeur qui ne designe aucune des quatre familles rend `null` PLUTOT QUE d'etre rangee par
  // defaut : un zonage inconnu range en zone agricole ferait trancher une contrainte sur une
  // supposition.
  assert.equal(familleZone('ZZ'), null);
  assert.equal(familleZone(''), null);
  assert.equal(familleZone(null), null);
  assert.equal(familleZone(undefined), null);
  assert.equal(familleZone('  '), null, 'une valeur blanche n’est pas un zonage');
});

test('LE ZONAGE DOMINANT EST CELUI QUI COUVRE LE PLUS, PAS LE PREMIER RENDU', () => {
  /*
   * Le cas reel : une parcelle de Beauce a cheval sur « A » (95 %) et sur une langue de « N »
   * (5 %). Si l'ordre de la reponse place « N » en tete, prendre le premier ferait conclure que la
   * parcelle est en zone naturelle — et le verdict citerait le mauvais reglement.
   */
  assert.equal(
    zoneDominante([
      { typeZone: 'N', partRecouvrement: 0.05 },
      { typeZone: 'A', partRecouvrement: 0.95 },
    ]),
    'A',
  );
  // Et l'inverse, pour que le test ne passe pas simplement parce que « A » vient apres.
  assert.equal(
    zoneDominante([
      { typeZone: 'A', partRecouvrement: 0.2 },
      { typeZone: 'U', partRecouvrement: 0.8 },
    ]),
    'U',
  );
});

test('UN ZONAGE UNIQUE RESTE APPLICABLE MEME SANS PART CALCULEE', () => {
  /*
   * Le calcul d'intersection PostGIS peut echouer sur une geometrie invalide. Ecarter alors le
   * seul zonage connu ferait perdre l'information entiere pour une incertitude de SURFACE — alors
   * qu'avec un zonage unique, la surface ne decide de rien.
   */
  assert.equal(zoneDominante([{ typeZone: 'A', partRecouvrement: null }]), 'A');
  assert.equal(zoneDominante([]), null, 'aucun zonage : aucune famille, et surtout pas un repli');
  assert.equal(
    zoneDominante([{ typeZone: 'ZZ', partRecouvrement: 1 }]),
    null,
    'un zonage illisible ne devient pas une famille par defaut',
  );
});

test('« AUCUN EBC » N’EST UNE REPONSE QUE SI UN DOCUMENT COUVRE LE TERRITOIRE', () => {
  /*
   * LA COUCHE REND UNE LISTE VIDE DANS DEUX CAS OPPOSES : un territoire sans espace boise classe,
   * et un territoire dont le document d'urbanisme n'est pas publie au Geoportail. Les confondre
   * ferait conclure « contrainte respectee » — sur une contrainte REDHIBITOIRE, donc dans le sens
   * favorable — a une question qui n'a jamais ete posee.
   */
  assert.equal(presenceEbc([], true), false, 'document publie, aucun EBC : c’est une reponse');
  assert.equal(presenceEbc([], null), null, 'sans document, on ne sait rien');
  assert.equal(presenceEbc([], false), null, 'territoire au RNU : la question reste ouverte');

  /*
   * LA BRANCHE `true` N'EST EXERCEE QUE PAR CE TEST. Aucune des 301 parcelles de la base de
   * reference ne porte de prescription de type EBC, et des sondages sur une dizaine de communes
   * n'en ont pas fait apparaitre. Le rattachement repose donc sur le code CNIG `01` seul — ce qui
   * est ecrit dans le rapport de verification, plutot que passe sous silence.
   */
  assert.equal(presenceEbc([{ estEbc: true }], true), true);
  assert.equal(presenceEbc([{ estEbc: false }, { estEbc: true }], true), true);
  assert.equal(
    presenceEbc([{ estEbc: true }], null),
    true,
    'un EBC constate vaut meme sans savoir si le document est publie : il EST la',
  );
  assert.equal(presenceEbc([{ estEbc: false }], true), false);
});
