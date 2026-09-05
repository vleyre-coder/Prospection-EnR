/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA PUISSANCE ESTIMEE — ET SURTOUT LES TROIS FILIERES OU ELLE NE DOIT PAS ETRE UN NOMBRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER GARDE VRAIMENT. Le calcul photovoltaique est une multiplication : il n'a pas
 * besoin d'etre garde, et un test qui verifierait 12 x 1 = 12 ne prouverait rien. Ce qui doit etre
 * garde, c'est le REFUS de repondre sur les trois autres filieres.
 *
 * POURQUOI C'EST FRAGILE. La demande a l'origine de ce module est « la puissance estimative du
 * projet en prenant la puissance moyenne qu'on peut installer sur un hectare ». Elle est formulee
 * comme si elle valait partout. La pente naturelle, dans six mois, sera d'ajouter une densite pour
 * l'eolien « en attendant mieux » — 0,1 MW/ha a l'air raisonnable, personne ne le remarquera, et le
 * dossier de site remis a un developpeur affichera un nombre de MW fabrique. Le chiffre serait faux
 * de plusieurs centaines de pour cent : la puissance d'un parc depend du nombre de machines que la
 * forme du terrain et les sillages autorisent, pas de sa surface.
 *
 * D'ou la forme de ces tests : ils exigent `mwc === null` ET une explication non vide. Le `null` seul
 * ne suffirait pas — une fonction qui rendrait `null` sans rien dire produirait un tiret dans le
 * dossier, que le lecteur interpreterait comme une donnee manquante, alors que c'est une donnee
 * INEXISTANTE.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Le paquet CONSTRUIT : la suite tourne sous `node --test --experimental-strip-types`, qui ne
// resout pas `../src/*.js` vers du TypeScript.
import { puissanceEstimee } from '../dist/index.js';
import { FILIERES } from '@enr/core';

/** Les filieres dont la puissance NE se deduit PAS d'une surface. */
const SANS_DENSITE = ['eolien_terrestre', 'bess', 'methanisation'] as const;

test('le photovoltaique au sol est estime a 1 MWc par hectare utile', () => {
  const p = puissanceEstimee('solaire_sol', 12);
  assert.equal(p.mwc, 12);
  assert.equal(p.densiteMwcParHa, 1);
  assert.ok(p.methode.length > 0);
});

test('l’agrivoltaisme est estime a la moitie : la couverture y est plafonnee', () => {
  const p = puissanceEstimee('solaire_sol', 12, 'agrivoltaisme');
  assert.equal(p.mwc, 6);
  assert.equal(p.densiteMwcParHa, 0.5);
  assert.ok(
    /agrivolta/i.test(p.methode),
    `la methode doit dire POURQUOI la densite est divisee par deux, sans quoi le dossier affiche ` +
      `deux chiffres differents pour la meme surface sans explication — ecrit : « ${p.methode} »`,
  );
});

test('AUCUNE des trois autres filieres ne rend un nombre de MW', () => {
  for (const filiere of SANS_DENSITE) {
    const p = puissanceEstimee(filiere, 40);
    assert.equal(
      p.mwc,
      null,
      `${filiere} : une puissance a ete estimee depuis une surface de 40 ha. Ce chiffre serait ` +
        `fabrique — la puissance d’un parc eolien tient au nombre de machines, celle d’un stockage ` +
        `a la capacite du poste source, celle d’une methanisation au tonnage d’intrants.`,
    );
    assert.equal(p.densiteMwcParHa, null, `${filiere} : une densite MWc/ha n’a pas de sens ici`);
    assert.ok(
      p.methode.trim().length > 30,
      `${filiere} : le refus doit s’EXPLIQUER. Sans phrase, le dossier affiche un tiret, que le ` +
        `lecteur lit comme « donnee manquante » au lieu de « grandeur qui ne se calcule pas ainsi »`,
    );
  }
});

test('la surface utile inconnue ne produit jamais de puissance', () => {
  for (const surface of [null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    const p = puissanceEstimee('solaire_sol', surface);
    assert.equal(
      p.mwc,
      null,
      `surface ${String(surface)} : une puissance a ete rendue. Zero, negatif et NaN viennent tous ` +
        `d’une parcelle dont la bande perimetrale a mange toute l’emprise ou dont la surface manque : ` +
        `aucun n’autorise a annoncer des MW`,
    );
    assert.ok(p.methode.length > 0);
  }
});

test('TOUTES les filieres du referentiel sont traitees, y compris celles a venir', () => {
  /*
   * LE GARDE QUI COMPTE POUR LA SUITE. `puissanceEstimee` se termine par un `return` non garde : une
   * cinquieme filiere ajoutee au referentiel tomberait donc dans la branche « methanisation » et
   * hériterait de son explication — « le tonnage d'intrants mobilisable » — sur, mettons, de
   * l'hydroelectricite. Le compilateur ne le verrait pas : la branche existe et rend le bon type.
   *
   * Ce test ne peut pas deviner la bonne reponse pour une filiere qui n'existe pas encore. Il exige
   * la seule chose verifiable : que chaque filiere du referentiel produise une explication qui LUI
   * corresponde, en refusant qu'une explication serve deux filieres differentes.
   */
  const methodes = new Map<string, string>();
  for (const filiere of FILIERES) {
    const p = puissanceEstimee(filiere, 25);
    assert.ok(p.methode.trim().length > 0, `${filiere} : aucune methode`);
    const deja = [...methodes.entries()].find(([, m]) => m === p.methode);
    assert.equal(
      deja,
      undefined,
      `${filiere} et ${deja?.[0]} rendent la MEME explication. L’une des deux est donc tombee dans ` +
        `la branche de l’autre : le dossier de site expliquerait la puissance de l’une par la ` +
        `physique de l’autre.`,
    );
    methodes.set(filiere, p.methode);
  }
});
