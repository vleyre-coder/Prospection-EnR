/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * TROIS ALEAS QUE LE CLASSEUR NOMME ET QUE PERSONNE N'INTERROGEAIT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE JOUE ICI. La zone de sismicite, le potentiel radon et l'etablissement SEVESO le plus
 * proche sont des faits que Georisques expose et que l'application ne demandait pas. Les brancher
 * est facile ; les brancher SANS produire d'affirmation fausse l'est moins, et c'est ce que ce
 * fichier tient :
 *
 *   1. UN ECHEC D'APPEL NE DOIT JAMAIS RESSEMBLER A UNE ABSENCE DE RISQUE. C'est la direction
 *      dangereuse de l'erreur, et le defaut B3 de l'audit 8 l'avait deja produite : trois sources
 *      liees par `&&` faisaient qu'un echec se traduisait par « aléa nul », note 100/100 en vert.
 *      D'ou le troisieme etat de `sevesoProche.statut` : `aucun` est une REPONSE, `null` un echec.
 *
 *   2. UNE VALEUR HORS ECHELLE N'EST PAS UNE COMMUNE ATYPIQUE, c'est un champ mal lu. Le zonage
 *      sismique compte cinq zones et le radon trois categories : au-dela, la valeur ne designe
 *      plus un classement, et `Number('')` vaut ZERO, ce qui passerait pour une zone.
 *
 *   3. UN STATUT SEVESO INCONNU NE SE REPLIE PAS SUR LE SEUIL LE PLUS BAS. Un repli « prudent »
 *      dans le sens rassurant est le pire des deux.
 *
 * Ces tests n'appellent PAS le reseau : ils portent sur les fonctions de lecture, isolees pour
 * cette raison. L'appel reel est verifie par le test de bout en bout de la base.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classeCommunale,
  sevesoLePlusProche,
  statutSeveso,
} from '../src/connecteurs/georisques.js';

/** Beauce, au sud de Chartres. Sert de point de reference a toutes les distances ci-dessous. */
const CENTROIDE: [number, number] = [1.79, 48.156];

test('UN CLASSEMENT COMMUNAL HORS ECHELLE EST REFUSE, PAS ARRONDI', () => {
  assert.equal(classeCommunale('3', 5), 3);
  assert.equal(classeCommunale(' 5 ', 5), 5, 'les espaces de la reponse ne doivent pas gener');
  assert.equal(classeCommunale('1', 3), 1);

  /*
   * LE PIEGE EXACT : `Number('')` vaut ZERO, et zero passerait pour une zone sismique s'il n'etait
   * pas refuse. Une reponse vide est une reponse manquante, pas une zone de sismicite nulle —
   * l'echelle legale commence a 1.
   */
  assert.equal(classeCommunale('', 5), null, 'une chaine vide n’est pas la zone zero');
  assert.equal(classeCommunale(null, 5), null);
  assert.equal(classeCommunale(undefined, 5), null);
  assert.equal(classeCommunale('0', 5), null, 'la zone 0 n’existe pas');
  assert.equal(classeCommunale('6', 5), null, 'il n’y a que cinq zones de sismicite');
  assert.equal(classeCommunale('4', 3), null, 'il n’y a que trois categories de radon');
  assert.equal(classeCommunale('2.5', 5), null, 'un classement est un entier');
  assert.equal(classeCommunale('zone 3', 5), null, 'un libelle n’est pas un code');
});

test('UN STATUT SEVESO INCONNU NE SE REPLIE PAS SUR LE SEUIL LE PLUS BAS', () => {
  assert.equal(statutSeveso('Seveso seuil haut'), 'seuil_haut');
  assert.equal(statutSeveso('Seveso seuil bas'), 'seuil_bas');
  assert.equal(statutSeveso('SEVESO SEUIL HAUT'), 'seuil_haut', 'la casse varie selon les fiches');

  // « Non Seveso » est la valeur la plus frequente du jeu : la confondre avec un seuil bas
  // classerait en SEVESO la quasi-totalite des installations classees de France.
  assert.equal(statutSeveso('Non Seveso'), null);
  assert.equal(statutSeveso(null), null);
  assert.equal(statutSeveso(''), null);
  /*
   * Un libelle SEVESO sans seuil lisible rend `null`. Le repli tentant serait `seuil_bas` — « au
   * moins on signale quelque chose » — mais il ferait passer une lacune de lecture pour une
   * mesure, et dans le sens rassurant puisque le seuil bas est le moins severe.
   */
  assert.equal(statutSeveso('Seveso'), null, 'un seuil illisible n’est pas un seuil bas');
});

test('LE PLUS PROCHE, ET NON LE PREMIER DE LA LISTE', () => {
  /*
   * L'ordre de Georisques n'est pas un ordre de distance. Retenir le premier element donnerait un
   * etablissement a huit kilometres alors qu'un autre est a trois cents metres — et c'est la
   * distance qui decide de l'etude de cumul, pas le rang dans la reponse.
   */
  const r = sevesoLePlusProche(CENTROIDE, [
    { raisonSociale: 'Loin', statutSeveso: 'Seveso seuil haut', longitude: 1.9, latitude: 48.25 },
    { raisonSociale: 'Ignoree', statutSeveso: 'Non Seveso', longitude: 1.7901, latitude: 48.1561 },
    { raisonSociale: 'Proche', statutSeveso: 'Seveso seuil bas', longitude: 1.7915, latitude: 48.1568 },
  ]);
  assert.equal(r.nom, 'Proche');
  assert.equal(r.statut, 'seuil_bas');
  assert.ok(r.distanceKm != null && r.distanceKm < 1.5, `distance ${String(r.distanceKm)} km`);
});

test('UN ETABLISSEMENT SEVESO NON GEOLOCALISE EST RETENU QUAND MEME', () => {
  /*
   * Georisques ne place pas toutes ses fiches. Ecarter un etablissement SEVESO parce qu'on ne sait
   * pas le positionner transformerait une incertitude de POSITION en absence d'ETABLISSEMENT — et
   * la fiche annoncerait « aucun SEVESO » sur une parcelle qui en a un dans le rayon.
   */
  const r = sevesoLePlusProche(CENTROIDE, [
    { raisonSociale: 'Sans coordonnees', statutSeveso: 'Seveso seuil haut' },
  ]);
  assert.equal(r.statut, 'seuil_haut');
  assert.equal(r.distanceKm, null, 'la distance manque, et le dit');
  assert.equal(r.nom, 'Sans coordonnees');
});

test('« AUCUN » EST UNE REPONSE, ET NE SE CONFOND PAS AVEC UN ECHEC', () => {
  /*
   * L'INVARIANT LE PLUS IMPORTANT DE CE FICHIER. Sans le troisieme etat, « la couche n'a pas
   * repondu » et « aucun etablissement SEVESO dans le rayon » s'ecriraient tous deux `null`, et la
   * contrainte du classeur resterait eternellement « non evaluee » — alors que la reponse est
   * mesuree. C'est la meme erreur, en sens inverse, que celle qui ferait passer un echec pour une
   * absence de risque.
   */
  const liste = sevesoLePlusProche(CENTROIDE, [
    { raisonSociale: 'Une ICPE ordinaire', statutSeveso: 'Non Seveso', longitude: 1.79, latitude: 48.16 },
  ]);
  assert.equal(liste.statut, 'aucun', 'la couche a repondu : l’absence est un fait');

  const vide = sevesoLePlusProche(CENTROIDE, []);
  assert.equal(vide.statut, 'aucun', 'une liste vide est une reponse, pas un silence');

  // Et l'echec, lui, ne passe pas par cette fonction : le connecteur rend les trois champs nuls
  // quand l'appel a echoue. Les deux formes sont donc distinguables par le lecteur.
  assert.notEqual(vide.statut, null);
});
