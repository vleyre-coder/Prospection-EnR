/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE PANNEAU DES PROFILS — les deux phrases qu'il ne doit jamais cesser de dire
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROTEGE, ET POURQUOI CE SONT DES PHRASES. Les refus, eux, sont tenus par le
 * serveur et testes contre la base. Ce qui ne tient qu'a l'ecran, c'est ce que l'operateur
 * COMPREND de ce qu'il saisit — et deux contresens y coutent cher :
 *
 *   1. croire que son profil influence la fiche d'une parcelle. Le §2.3 dit l'inverse : la carte
 *      evalue TOUJOURS au seuil reglementaire. Un operateur qui l'ignore lit un « défavorable »
 *      produit par l'exigence d'un developpeur et croit lire le droit ;
 *   2. croire qu'un seuil peut assouplir. Le serveur refuse — mais un refus qui arrive apres la
 *      saisie de vingt lignes fait perdre le travail, donc l'ecran doit le dire avant.
 *
 * ET UNE TROISIEME CHOSE, la plus importante pour la fidelite au referentiel : le texte
 * reglementaire est AFFICHE TEL QUEL. « ≥ 500 m (modulable à la hausse) » n'est pas « au moins
 * 500 m » — la modulation par le prefet disparait dans la reformulation, et c'est precisement ce
 * que l'operateur doit pouvoir citer au developpeur.
 *
 * CE QUE CE RENDU NE COUVRE PAS. `renderToStaticMarkup` n'execute ni les effets ni les clics : il
 * dit ce que le composant produit a partir d'un etat donne, pas ce qu'il devient quand on tape
 * dedans. Le repli des seuils est pour cela un `<details>` natif et non un etat React — le contenu
 * reste dans le document, donc mesurable ici.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { PanneauProfils } from '../src/components/PanneauProfils.js';
import type { ContrainteParametrable, ProfilResume } from '../src/api/client.js';
import { rendreResolu, texte } from './aides/rendu.js';

/**
 * Deux contraintes, choisies parce qu'elles se comportent A L'OPPOSE l'une de l'autre.
 *
 * Le recul eolien porte un seuil FERME et un sens ETABLI : rien a demander. La distance aux tiers
 * en methanisation porte deux regimes ICPE dans la meme cellule, donc un seuil NON etabli et un
 * sens a demander. Un jeu d'essai qui n'aurait que le premier cas laisserait passer la moitie des
 * regressions possibles.
 */
const RECUL: ContrainteParametrable = {
  id: 'eolien_terrestre__eloignement_500_m_des_habitations',
  filiere: 'eolien_terrestre',
  categorie: 'A. Distances habitations',
  nom: 'Éloignement 500 m des habitations',
  description: 'Distance mini entre tout aérogénérateur et constructions à usage d’habitation.',
  seuilReglementaire: '≥ 500 m (modulable à la hausse)',
  referenceReglementaire: 'Art. L515-44 C. env. ; Arrêté 26/08/2011 art. 3',
  coucheSig: 'Bâti IGN BD TOPO + Cadastre (DGFiP)',
  caractere: 'redhibitoire',
  unite: 'm',
  valeurReglementaire: 500,
  operateurReglementaire: 'min',
  sensEtabli: 'min',
  sensRequis: false,
  reglementaireEtabli: true,
  raisons: [],
};

const TIERS: ContrainteParametrable = {
  id: 'methanisation__distance_d_implantation_aux_tiers_habitations_erp',
  filiere: 'methanisation',
  categorie: 'B. Distances',
  nom: 'Distance d’implantation aux tiers / habitations / ERP',
  description: 'Distance minimale aux tiers selon le régime ICPE.',
  seuilReglementaire: '100 m (Déclaration) / 200 m (Enregistrement-Autorisation)',
  referenceReglementaire: 'Arrêté du 12/08/2010',
  coucheSig: 'Bâti IGN BD TOPO',
  caractere: 'redhibitoire',
  unite: 'm',
  valeurReglementaire: 100,
  operateurReglementaire: 'egal',
  sensEtabli: null,
  sensRequis: true,
  reglementaireEtabli: false,
  raisons: ['extraction_incomplete'],
};

const PROFILS: ProfilResume[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    nom: 'Méthanisation — Développeur X',
    filiere: 'methanisation',
    developpeur: 'Développeur X',
    notes: null,
    creePar: 'operateur@local',
    creeLe: '2026-09-01T10:00:00.000Z',
    majLe: '2026-09-10T10:00:00.000Z',
    nbSeuils: 2,
  },
];

function rendre(contraintes: ContrainteParametrable[], filiere = 'eolien_terrestre'): string {
  return texte(
    rendreResolu(
      h(PanneauProfils),
      { 'contraintes-parametrables': contraintes, profils: PROFILS },
      { filiere },
    ),
  );
}

test('LE TEXTE REGLEMENTAIRE EST AFFICHE TEL QUEL, JAMAIS REFORMULE', () => {
  const t = rendre([RECUL]);

  /*
   * « ≥ 500 m (modulable à la hausse) » et non « au moins 500 m » : la modulation par le prefet
   * disparait dans la reformulation, et c'est justement l'information qui permet a un developpeur
   * de savoir que le seuil peut monter. La reference suit, pour qu'il puisse verifier.
   */
  assert.match(t, /≥ 500 m \(modulable à la hausse\)/);
  assert.match(t, /L515-44/);
  assert.match(t, /Éloignement 500 m des habitations/);
});

test('L’ECRAN ANNONCE QUE LE SEUIL NE PEUT QUE DURCIR, AVANT LA SAISIE', () => {
  const t = rendre([RECUL]);

  /*
   * Le refus existe cote serveur et il est teste contre la base. Mais un refus qui arrive apres la
   * saisie fait perdre le travail : la regle doit etre lisible avant qu'on tape.
   */
  assert.match(t, /ne peut que\s+durcir/i);
  assert.match(t, /plus permissive est refusée/i);
});

test('L’ECRAN DIT QUE LA FICHE RESTE EVALUEE AU SEUIL REGLEMENTAIRE', () => {
  const t = rendre([RECUL]);

  /*
   * LA PHRASE LA PLUS IMPORTANTE DU PANNEAU. Sans elle, un operateur qui a ouvert le profil d'un
   * developpeur exigeant croira que la fiche d'une parcelle en tient compte — et lira un verdict
   * comme s'il venait du droit. C'est le §2.3 rendu visible.
   */
  assert.match(t, /fiche d’une parcelle reste évaluée au seuil réglementaire/);
});

test('LE SENS EST DEMANDE LA OU LE CLASSEUR NE LE DONNE PAS, ET AFFICHE SINON', () => {
  const ferme = rendre([RECUL]);
  // Sens etabli : il est AFFICHE, pas propose — le laisser choisir permettrait d'inverser la
  // contrainte sans que rien ne le signale.
  assert.match(ferme, /au moins/);
  assert.doesNotMatch(ferme, /Sens \?/);

  const ambigu = rendre([TIERS], 'methanisation');
  // Sens non etabli : il est DEMANDE, et l'option vide reste offerte pour ne pas imposer un choix
  // par inertie.
  assert.match(ambigu, /Sens \?/);
  assert.match(ambigu, /au moins/);
  assert.match(ambigu, /au plus/);
});

test('UN SEUIL REGLEMENTAIRE NON ETABLI EST SIGNALE, SANS ETRE INTERDIT', () => {
  const t = rendre([TIERS], 'methanisation');

  /*
   * La contrainte reste parametrable — c'est meme la que l'exigence du developpeur sert le plus,
   * puisque « 100 m / 200 m selon le regime » ne tranche rien tout seul. Mais l'ecran doit dire
   * que la CONFORMITE n'est pas acquise pour autant, sans quoi l'operateur lira le filtre comme un
   * verdict.
   */
  assert.match(t, /100 m \(Déclaration\) \/ 200 m \(Enregistrement-Autorisation\)/);
  assert.match(t, /n’est pas établi de façon ferme/);
  assert.match(t, /conformité/);
});

test('LES PROFILS ENREGISTRES SONT PROPOSES AVEC LEUR DEVELOPPEUR ET LEUR COMPTE DE SEUILS', () => {
  const t = rendre([RECUL]);

  // Le nom seul ne suffit pas a distinguer deux profils voisins : le developpeur et le nombre de
  // seuils sont ce qui permet de reconnaitre le bon avant de l'ouvrir.
  assert.match(t, /Méthanisation — Développeur X/);
  assert.match(t, /2 seuils/);
  assert.match(t, /Nouveau profil/);
});

test('UNE FILIERE SANS CONTRAINTE PARAMETRABLE LE DIT, AU LIEU DE PARAITRE VIDE', () => {
  const t = rendre([]);

  /*
   * Une liste vide sans explication se lit « c'est cassé ». La raison est precise et verifiable :
   * une contrainte n'est parametrable que si une couche nationale permet de la mesurer et que le
   * classeur porte un nombre.
   */
  assert.match(t, /Aucune contrainte paramétrable/);
  assert.match(t, /couche\s+nationale/);
});
