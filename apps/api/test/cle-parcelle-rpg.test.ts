/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA CLE QUI EMPECHE DE COMPTER DEUX FOIS LE MEME HECTARE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CETTE CLE EXISTE, et pourquoi elle n'a d'equivalent dans aucune autre ingestion.
 *
 * `objetsWfs` rejoue une page entiere quand le flux se coupe en cours de route, et son commentaire
 * l'assume : « des objets ont deja ete emis, les reemettre est sans consequence, l'insertion est
 * idempotente sur la cle naturelle ». C'est vrai de toutes les autres ingestions, qui ECRIVENT un
 * objet par ligne sous une cle. L'ingestion du RPG, elle, SOMME des hectares par commune — et une
 * somme n'est pas idempotente.
 *
 * ═══ CE QUI A ETE MESURE, le 27/09/2026
 *
 * Coupure observee a la septieme page du Loiret : **3 484 objets deja emis**, puis la page rejouee
 * en entier. Sans cle, ces 3 484 parcelles s'ajoutaient une seconde fois aux hectares de leurs
 * communes. Aucun compteur ne bougeait, aucune erreur n'etait levee : le journal disait simplement
 * qu'une page avait ete rejouee, ce qui est normal.
 *
 * Le double compte a ete pris par un controle physique, le seul qui ne puisse pas mentir : **une
 * commune ne peut pas porter plus d'hectares agricoles qu'elle n'a d'hectares**. Avant correction,
 * le Loiret affichait 454 247 ha de surface agricole declaree, soit 67 % de sa superficie, pour une
 * realite voisine de 55 % ; apres, 344 191 ha. Sur les 1 123 communes des quatre departements
 * ingeres, deux depassent encore leur propre superficie, de 1 et 2 % — ce qui est l'erreur
 * attendue du rattachement par centroide, et non un doublon.
 *
 * ═══ CE QUE CE FICHIER GARDE
 *
 * `cleParcelleRpg` ne fait qu'une chose, mais elle doit etre faite dans cet ordre-la, et elle doit
 * rendre `null` — et non une chaine constante — quand elle ne sait pas. Une cle constante ferait
 * s'effondrer toutes les parcelles sans identifiant sur UNE seule ligne : au lieu d'un doublon
 * possible, on perdrait des milliers d'hectares reels. L'erreur serait alors dans l'autre sens, et
 * tout aussi invisible.
 *
 * Aucune base, aucun reseau : la fonction est pure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleParcelleRpg } from '../src/ingestion/wfs-national.js';

/** Proprietes reelles d'une parcelle RPG, relevees sur la source le 27/09/2026. */
const REELLE = {
  pacage: '079012282',
  num_ilot: 3,
  num_parcel: 7,
  iup: '905beed3-e9b1-4a53-b87d-c07ada84c57e',
  code_cultu: 'PPH',
  sf_adm_co: 2.4,
};

test('L’IDENTIFIANT DE PARCELLE EST PRIS EN PREMIER, PARCE QU’IL EST LE SEUL VRAIMENT UNIQUE', () => {
  assert.equal(cleParcelleRpg(REELLE), '905beed3-e9b1-4a53-b87d-c07ada84c57e');
});

test('LA MEME PARCELLE REJOUEE DONNE LA MEME CLE — C’EST TOUT CE QUI EST DEMANDE', () => {
  /*
   * Le rejeu d'une page reemet des objets IDENTIQUES. La seule propriete qui compte est donc la
   * stabilite : deux lectures du meme objet doivent donner la meme cle, sinon le dedoublonnage ne
   * voit rien passer.
   */
  const copie = { ...REELLE };
  assert.equal(cleParcelleRpg(copie), cleParcelleRpg(REELLE));
});

test('DEUX PARCELLES DIFFERENTES NE PARTAGENT PAS LEUR CLE', () => {
  /**
   * LE CONTRE-EXEMPLE INDISPENSABLE. Une cle trop grossiere — le seul numero de pacage, par
   * exemple — confondrait toutes les parcelles d'un meme exploitant. Le dedoublonnage n'ecarterait
   * plus des doublons mais des parcelles REELLES, et la commune perdrait des hectares qu'elle
   * possede. L'erreur irait alors dans l'autre sens, sans plus de bruit.
   */
  const autre = { ...REELLE, iup: 'b0000000-0000-4000-8000-000000000001', num_parcel: 8 };
  assert.notEqual(cleParcelleRpg(autre), cleParcelleRpg(REELLE));
});

test('SANS IDENTIFIANT DE PARCELLE, LE TRIPLET DE DECLARATION PREND LE RELAIS', () => {
  /*
   * Le millesime fait partie du nom de la couche et tournera. Si un millesime cessait d'exposer
   * `iup`, le triplet pacage / ilot / parcelle identifie encore la parcelle dans la declaration de
   * son exploitant — et l'ingestion continue de dedoublonner au lieu de s'effondrer en silence.
   */
  const sansIup = { pacage: '079012282', num_ilot: 3, num_parcel: 7 };
  assert.equal(cleParcelleRpg(sansIup), '079012282/3/7');

  const voisine = { pacage: '079012282', num_ilot: 3, num_parcel: 8 };
  assert.notEqual(cleParcelleRpg(voisine), cleParcelleRpg(sansIup));
});

test('SANS AUCUN IDENTIFIANT, LA REPONSE EST « JE NE SAIS PAS » ET NON UNE CLE CONSTANTE', () => {
  /**
   * LA GARDE LA PLUS IMPORTANTE DU FICHIER. Rendre ici une chaine constante — `''`, `'inconnu'` —
   * ferait s'effondrer toutes les parcelles sans identifiant sur une seule ligne de la table de
   * travail : la premiere serait comptee, toutes les autres jetees par `ON CONFLICT DO NOTHING`.
   * Au lieu d'un doublon possible, on perdrait des milliers d'hectares reels, et le total resterait
   * parfaitement plausible.
   *
   * `null` oblige l'appelant a fabriquer une cle unique, donc a COMPTER la parcelle.
   */
  assert.equal(cleParcelleRpg({}), null);
  assert.equal(cleParcelleRpg({ sf_adm_co: 2.4 }), null, 'une surface seule n’identifie rien');
  assert.equal(cleParcelleRpg({ iup: '' }), null, 'un identifiant vide n’est pas un identifiant');
  assert.equal(
    cleParcelleRpg({ pacage: '079012282' }),
    null,
    'un pacage sans ilot ni parcelle designe une exploitation entiere, pas une parcelle',
  );
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA CONDITION QUI AUTORISE UNE SUPPRESSION
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `effacerDisparus` prend pour périmètre le CONNECTEUR, pas le département — il regarde toutes les
 * lignes `rpg_communal` de la table. Or ce job s'exécute département par département.
 *
 * Lui déclarer un parcours « complet » après avoir ingéré le seul 28 ferait passer pour disparues
 * toutes les communes du 41, du 45 et du 91 : ingérées la veille, parfaitement valides, et
 * simplement pas regardées aujourd'hui. Le garde-fou de proportion d'`effacerDisparus` les sauverait
 * peut-être — mais compter dessus, c'est s'en remettre au hasard des volumes : sur une base où le 28
 * pèse la majorité des lignes, la suppression passerait.
 */

import { tousDepartementsRelus } from '../src/ingestion/wfs-national.js';

test('N’EFFACER QUE SI TOUS LES DEPARTEMENTS EN BASE ONT ETE RELUS EN ENTIER', () => {
  assert.equal(
    tousDepartementsRelus(['28', '41'], ['28', '41'], true),
    true,
    'les deux departements en base ont ete relus : la suppression est legitime',
  );
});

test('UN DEPARTEMENT EN BASE NON RELU INTERDIT TOUTE SUPPRESSION', () => {
  /*
   * LE CAS REEL : on reingere le 28 seul, alors que le 41 est en base depuis hier. Ses communes
   * n'ont pas ete revues par ce run, et elles n'ont pas disparu pour autant.
   */
  assert.equal(
    tousDepartementsRelus(['28', '41'], ['28'], true),
    false,
    'le 41 n’a pas ete regarde : ses communes ne sont pas des disparues',
  );
});

test('UNE PAGINATION INTERROMPUE INTERDIT LA SUPPRESSION, MEME SI LES DEPARTEMENTS COINCIDENT', () => {
  /**
   * LES DEUX CONDITIONS SONT INDEPENDANTES. Un run peut couvrir exactement les bons départements et
   * n'en avoir lu qu'une partie : une pagination coupée laisse des communes non revues, qui seraient
   * alors effacées alors qu'elles existent.
   */
  assert.equal(tousDepartementsRelus(['28'], ['28'], false), false);
});

test('UN DEPARTEMENT INCONNU EN BASE INTERDIT LA SUPPRESSION', () => {
  /*
   * Une ligne sans departement ne peut pas etre declaree relue : on ne sait pas d'ou elle vient.
   * Mieux vaut garder une ligne perimee qu'en effacer une valide.
   */
  assert.equal(tousDepartementsRelus([null], ['28'], true), false);
  assert.equal(tousDepartementsRelus(['28', null], ['28'], true), false);
});

test('UNE BASE VIDE N’EMPECHE PAS LA SUPPRESSION — IL N’Y A SIMPLEMENT RIEN A EFFACER', () => {
  assert.equal(tousDepartementsRelus([], ['28'], true), true);
});
