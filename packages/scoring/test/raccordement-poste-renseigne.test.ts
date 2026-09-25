/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA CAPACITE D'ACCUEIL SE LIT SUR UN POSTE QUI LA PORTE — ET LE DOCUMENT DIT LEQUEL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══ LE DEFAUT MESURE, ET IL TENAIT A UNE LIGNE
 *
 * Les criteres de capacite residuelle et de quote-part ne lisaient QUE `posteLePlusProche`. Or les
 * postes viennent de deux sources qui ne portent pas la meme chose : la BD TOPO donne la POSITION
 * de tous les postes, Capareseau donne la CAPACITE d'accueil d'une partie d'entre eux. Le plus
 * proche est presque toujours un poste de la BD TOPO, sans capacite.
 *
 * CHIFFRES, sur les 301 parcelles de la base d'essai. Avant : `racc_capacite_residuelle` gris sur
 * 301/301, `racc_quote_part` de meme — alors que les 301 parcelles portaient un poste ALTERNATIF
 * renseigne, dans le meme instantane, a quelques centaines de metres de plus. La donnee etait
 * ingeree, stockee, et a un champ du critere qui la reclamait.
 *
 * CE QUE CELA COUTAIT : la filiere BESS etait ENTIEREMENT GRISE — 301 parcelles sur 301, a 1,8
 * point du seuil de couverture, `racc_capacite_residuelle` pesant 20 % de sa note. Apres
 * correction, 300 orange et 1 rouge, couverture moyenne 78,2 % → 98,3 %. Aucune donnee nouvelle
 * n'a ete ingeree : seule la lecture a change.
 *
 * ═══ CE QUE CE FICHIER GARDE, ET QUI N'EST PAS SEULEMENT « LE CRITERE EST RENSEIGNE »
 *
 * Trois proprietes, dont deux sont des garde-fous contre la correction elle-meme :
 *
 *   1. un poste alternatif renseigne rend le critere evaluable ;
 *   2. le document DIT que la valeur ne vient pas du poste le plus proche. La capacite d'un poste
 *      n'est pas celle d'un autre : substituer en silence ferait lire, sur la ligne « poste le
 *      plus proche », un chiffre qui n'est pas le sien ;
 *   3. le poste retenu est le plus PROCHE de ceux qui sont renseignes, et non le premier de la
 *      liste — laquelle n'est pas triee par distance. Verifie sur la base : « 8,88 ; 7,88 ; 9 »
 *      pour une parcelle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot, type PosteSourceRef } from '@enr/core';
import { calculerScore } from '../dist/index.js';

/** Un poste de la BD TOPO : une position, et rien d'autre. */
function postePosition(nom: string, distanceKm: number): PosteSourceRef {
  return {
    id: `geopf:${nom}`,
    nom,
    gestionnaire: 'autre_grd',
    tension: '90 kV',
    distanceKm,
    capaciteResiduelleMw: null,
    etatSaturation: null,
    fileAttenteMw: null,
    quotePartEurParKw: null,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  };
}

/** Un poste de Capareseau : la capacite d'accueil, la saturation, la quote-part. */
function posteCapareseau(nom: string, distanceKm: number, capaciteMw: number): PosteSourceRef {
  return {
    ...postePosition(nom, distanceKm),
    id: nom,
    capaciteResiduelleMw: capaciteMw,
    etatSaturation: 'disponible',
    quotePartEurParKw: 45,
  };
}

function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '28399000ZC0123',
      codeInsee: '28399',
      nomCommune: 'Tillay-le-Péneux',
      prefixe: '000',
      section: 'ZC',
      numero: '0123',
      contenanceM2: 125000,
      surfaceCalculeeM2: 124800,
      centroide: [1.8357, 48.1609],
      codeDepartement: '28',
    },
    '2026-09-25T09:00:00.000Z',
  );
}

/** Le critere demande, tel que le moteur le rend. */
function critere(s: ParcelleSnapshot, id: string) {
  const score = calculerScore(s, 'bess');
  const c = score.criteres.find((x) => x.id === id);
  assert.ok(c, `critere ${id} absent du resultat`);
  return c;
}

test('UN POSTE ALTERNATIF RENSEIGNE REND LA CAPACITE EVALUABLE', () => {
  const s = snapshot();
  s.raccordement.posteLePlusProche = postePosition('Poste de transformation 90 kV', 7.28);
  s.raccordement.postesAlternatifs = [posteCapareseau('ORGERES', 7.41, 32)];

  const c = critere(s, 'racc_capacite_residuelle');
  assert.notEqual(c.feu, 'gris', 'la capacite est dans l’instantané : le critere ne doit pas etre gris');
  assert.equal(c.valeurBrute, 32);

  /*
   * ET LE DOCUMENT DIT D'OU VIENT LE CHIFFRE. C'est la moitie de la correction : sans cette
   * mention, la fiche remise a un tiers ferait lire sur la ligne « poste le plus proche » une
   * capacite qui appartient a un autre poste.
   */
  assert.match(c.valeurAffichee, /ORGERES/, 'le poste retenu doit etre nomme');
  assert.match(c.commentaire ?? '', /n’est pas renseigné/, 'le commentaire doit expliquer la substitution');
});

test('LA QUOTE-PART SUIT LA MEME LECTURE', () => {
  const s = snapshot();
  s.raccordement.posteLePlusProche = postePosition('Poste de transformation 90 kV', 7.28);
  s.raccordement.postesAlternatifs = [posteCapareseau('ORGERES', 7.41, 32)];

  const c = critere(s, 'racc_quote_part');
  assert.notEqual(c.feu, 'gris');
  assert.equal(c.valeurBrute, 45);
  assert.match(c.valeurAffichee, /ORGERES/);
});

test('LE POSTE LE PLUS PROCHE GARDE LA MAIN QUAND IL EST RENSEIGNE', () => {
  /*
   * LE GARDE-FOU LE PLUS IMPORTANT. Une correction trop large irait chercher un poste lointain
   * alors que le poste voisin porte l'information : le critere deviendrait plus flatteur — ou plus
   * severe — sans aucune raison, et la mention « au poste X » apparaitrait la ou elle n'a pas lieu
   * d'etre.
   */
  const s = snapshot();
  s.raccordement.posteLePlusProche = posteCapareseau('JANVILLE', 4.2, 12);
  s.raccordement.postesAlternatifs = [posteCapareseau('ORGERES', 9.9, 99)];

  const c = critere(s, 'racc_capacite_residuelle');
  assert.equal(c.valeurBrute, 12, 'la capacite doit rester celle du poste le plus proche');
  assert.doesNotMatch(c.valeurAffichee, /au poste/, 'aucune mention de substitution n’est due ici');
  assert.doesNotMatch(c.commentaire ?? '', /n’est pas renseigné/);
});

test('ENTRE PLUSIEURS POSTES RENSEIGNES, C’EST LE PLUS PROCHE QUI COMPTE', () => {
  /*
   * LA LISTE DES ALTERNATIFS N'EST PAS TRIEE PAR DISTANCE — verifie sur la base : « 8,88 ; 7,88 ;
   * 9 » pour une parcelle. Prendre le premier renseigne retiendrait donc parfois un poste plus
   * lointain qu'un autre disponible, et le raccordement se chiffrerait sur le mauvais.
   */
  const s = snapshot();
  s.raccordement.posteLePlusProche = postePosition('Poste de transformation 90 kV', 7.0);
  s.raccordement.postesAlternatifs = [
    posteCapareseau('LOIN', 12.5, 90),
    posteCapareseau('PRES', 7.9, 18),
    posteCapareseau('MOYEN', 9.4, 50),
  ];

  const c = critere(s, 'racc_capacite_residuelle');
  assert.equal(c.valeurBrute, 18, 'le poste retenu doit etre PRES, a 7,9 km');
  assert.match(c.valeurAffichee, /PRES/);
});

test('AUCUN POSTE RENSEIGNE : LE CRITERE RESTE GRIS, ET NE S’INVENTE PAS', () => {
  /*
   * Le contre-exemple qui empeche la correction de devenir une invention. Quand personne ne porte
   * la capacite, le critere doit rester une donnee absente : c'est ce qui abaisse la couverture et
   * empeche l'application de declarer une parcelle propice sur une information qu'elle n'a pas.
   */
  const s = snapshot();
  s.raccordement.posteLePlusProche = postePosition('Poste A', 7.0);
  s.raccordement.postesAlternatifs = [postePosition('Poste B', 8.0), postePosition('Poste C', 9.0)];

  assert.equal(critere(s, 'racc_capacite_residuelle').feu, 'gris');
  assert.equal(critere(s, 'racc_quote_part').feu, 'gris');
});
