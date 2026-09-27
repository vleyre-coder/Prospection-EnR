/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * « RIEN DANS LE RAYON INTERROGÉ » EST UNE MESURE, PAS UNE IGNORANCE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ÉTÉ MESURÉ, le 28/09/2026, sur les 301 parcelles de la base : `distanceCoursEauM` était
 * renseignée sur **deux** d'entre elles. La BD TOPO n'était pourtant jamais en échec — le
 * connecteur interrogeait bien la couche des cours d'eau dans un rayon de 1 000 m, et n'en trouvait
 * aucun. En Beauce, plateau de craie, c'est le cas général.
 *
 * Ce fait de terrain était rendu comme une ignorance : `null`, critère gris, **5,5 % du poids de la
 * méthanisation retirés du calcul sur 99 % du parc** — pour une parcelle dont on savait qu'aucun
 * cours d'eau ne coule à moins d'un kilomètre, c'est-à-dire la situation la plus favorable que ce
 * critère puisse noter, puisqu'il sature à 300 m.
 *
 * ═══ CE QUE CE FICHIER GARDE, ET POURQUOI CHAQUE MOITIÉ COMPTE
 *
 *   1. LA BORNE EST NOTÉE. Sans quoi la correction n'existe pas.
 *   2. LA BORNE EST ÉCRITE COMME UNE BORNE. « au-delà de 1 000 m », jamais « 1 000 m ». Un rayon de
 *      recherche présenté comme un relevé, dans un document remis à un propriétaire, serait le
 *      défaut que cette correction prétend réparer, retourné.
 *   3. `valeurBrute` RESTE NULLE. C'est elle que lisent les exports de données et les seuils : y
 *      placer la borne ferait passer un minorant pour une mesure partout ailleurs.
 *   4. LA NOTE EST MINORÉE, JAMAIS MAJORÉE. Les deux courbes concernées sont croissantes et la
 *      distance réelle dépasse la borne : noter la borne ne peut pas surestimer la parcelle. Le
 *      test l'exige explicitement, parce qu'une courbe décroissante ajoutée demain inverserait
 *      silencieusement le sens de l'erreur.
 *   5. DEUX CHAMPS NULS RESTENT GRIS. Une requête en échec ne doit pas devenir une borne : c'est
 *      la différence entre « j'ai regardé et n'ai rien vu » et « je n'ai pas pu regarder ».
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '28390000ZL0030',
      codeInsee: '28390',
      nomCommune: 'Tillay-le-Péneux',
      prefixe: '000',
      section: 'ZL',
      numero: '0030',
      contenanceM2: 73100,
      surfaceCalculeeM2: 73100,
      centroide: [1.77236, 48.14363],
      codeDepartement: '28',
    },
    '2026-09-28T09:00:00.000Z',
  );
}

/** Le critère demandé, dans le résultat de méthanisation. */
function critere(s: ParcelleSnapshot, id: string) {
  const r = calculerScore(s, 'methanisation');
  const c = r.criteres.find((x) => x.id === id);
  assert.ok(c, `critère ${id} absent du résultat`);
  return c;
}

test('SANS COURS D’EAU DANS LE RAYON, LE CRITERE EST NOTE — ET IL NE L’ETAIT PAS', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = 1000;

  const c = critere(s, 'dist_eau');
  assert.notEqual(c.note, null, 'une borne démontrée doit se noter : c’est tout l’objet du champ');
  assert.equal(c.feu !== 'gris', true);
  /*
   * La courbe sature à 300 m et la borne vaut 1 000 m : la note est ici EXACTE, pas seulement
   * prudente. C'est le cas général en Beauce, et c'est ce qui rend la correction utile.
   */
  assert.equal(c.note, 100);
});

test('LA BORNE S’ECRIT COMME UNE BORNE, ET NE PASSE PAS POUR UNE MESURE', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = 1000;

  const c = critere(s, 'dist_eau');
  assert.match(
    c.valeurAffichee ?? '',
    /au-delà de/i,
    'le document doit dire « au-delà de », sans quoi un rayon de recherche passe pour un relevé',
  );
  /**
   * `valeurBrute` EST LUE AILLEURS — exports de données, seuils, comparaisons. Y placer la borne
   * propagerait le minorant hors du seul endroit qui sait ce qu'il vaut, et il y perdrait sa
   * qualification en chemin.
   */
  assert.equal(c.valeurBrute, null, 'la borne ne doit pas se propager comme une valeur mesurée');
});

test('LA NOTE ISSUE D’UNE BORNE NE DEPASSE JAMAIS CELLE DE LA MESURE CORRESPONDANTE', () => {
  /**
   * LE GARDE QUI SURVIVRA AUX COURBES FUTURES. Noter une borne inférieure n'est légitime que sur
   * une courbe CROISSANTE : la distance réelle dépasse la borne, donc la note réelle lui est
   * supérieure ou égale. Si quelqu'un rendait un jour cette courbe décroissante — « trop loin d'un
   * cours d'eau coûte en génie civil », par exemple — noter la borne deviendrait une SURESTIMATION,
   * et rien d'autre ne le dirait.
   */
  const avecBorne = snapshot();
  avecBorne.eau.distanceCoursEauM = null;
  avecBorne.eau.coursEauAuDelaDeM = 1000;

  const mesuree = snapshot();
  mesuree.eau.distanceCoursEauM = 1000;

  const nBorne = critere(avecBorne, 'dist_eau').note;
  const nMesure = critere(mesuree, 'dist_eau').note;
  assert.ok(nBorne != null && nMesure != null);
  assert.ok(
    nBorne <= nMesure,
    `noter la borne (${nBorne}) doit minorer, jamais majorer la mesure de même valeur (${nMesure})`,
  );
});

test('LES DEUX CHAMPS NULS RESTENT GRIS : UNE REQUETE EN ECHEC N’EST PAS UNE BORNE', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = null;

  const c = critere(s, 'dist_eau');
  assert.equal(c.note, null);
  assert.equal(c.feu, 'gris', '« je n’ai pas pu regarder » ne doit pas devenir « je n’ai rien vu »');
});

test('LE CAPTAGE SUIT LA MEME REGLE, ET NE SUPPOSE PLUS CINQ KILOMETRES', () => {
  /**
   * CE QUE CETTE LIGNE VALAIT : `paliers(c.distanceM ?? 5000, …)`. Faute de distance connue, elle
   * supposait 5 km — la note maximale — c'est-à-dire qu'elle notait le mieux possible ce qu'elle
   * savait le moins. Le repli était jusqu'ici quasi inatteignable ; il devient courant maintenant
   * qu'un secteur peut être déclaré renseigné sans qu'aucun captage n'y figure.
   *
   * Ce qui est démontré n'est pas 5 km, c'est le rayon interrogé : 1 000 m, soit 88 et non 100.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };

  const c = critere(s, 'dist_captage');
  assert.equal(c.note, 88, 'la note porte sur le rayon interrogé, pas sur une distance supposée');
  assert.match(c.valeurAffichee ?? '', /aucun captage à moins de/i);
  assert.ok(
    (c.note ?? 0) < 100,
    'supposer 5 km donnait 100 : la borne démontrée doit rester en deçà',
  );
});

test('UN SECTEUR NON RENSEIGNE LAISSE LE CAPTAGE GRIS', () => {
  /*
   * Le GPU ne publie que les servitudes effectivement téléversées. Sans aucune servitude rendue
   * pour l'emprise, l'absence d'AS1 ne prouve rien — et le critère doit le dire.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: null, type: null, distanceM: null, auDelaDeM: null };

  const c = critere(s, 'dist_captage');
  assert.equal(c.note, null);
  assert.equal(c.feu, 'gris');
});

test('LA BORNE FAIT REMONTER LA COUVERTURE MESURABLE, PAS LE SUJET COMPLET', () => {
  /**
   * LE SENS DE LA CORRECTION, VÉRIFIÉ SUR LE CHIFFRE QUI DÉCIDE DU GRIS.
   *
   * `couvertureDonnees` mesure ce qui a pu être su ici ; c'est elle qui décide qu'une filière
   * bascule en gris sous 80 %. `couvertureCatalogue` mesure la part du sujet regardée. Les deux
   * doivent monter, puisqu'un critère passe de non renseigné à renseigné — mais la première est
   * celle qui change le verdict.
   */
  const avant = snapshot();
  avant.eau.distanceCoursEauM = null;
  avant.eau.coursEauAuDelaDeM = null;
  avant.eau.captageAep = { dansPerimetre: null, type: null, distanceM: null, auDelaDeM: null };

  const apres = snapshot();
  apres.eau.distanceCoursEauM = null;
  apres.eau.coursEauAuDelaDeM = 1000;
  apres.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };

  const a = calculerScore(avant, 'methanisation');
  const b = calculerScore(apres, 'methanisation');
  assert.ok(
    b.couvertureDonnees > a.couvertureDonnees,
    `la couverture mesurable doit monter (${a.couvertureDonnees} → ${b.couvertureDonnees})`,
  );
  assert.ok(b.couvertureCatalogue > a.couvertureCatalogue);
});
