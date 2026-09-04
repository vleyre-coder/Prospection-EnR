/**
 * Ce que devient un clic sur une parcelle du cadastre.
 *
 * POURQUOI CE FICHIER EXISTE — signalement d'usage. Une parcelle precise etait introuvable, et le
 * correctif a deux moitiees : afficher TOUT le cadastre, puis permettre d'etudier une parcelle qu'on y
 * voit. Cette seconde moitie repose sur un clic, et un clic est precisement ce qu'aucun test de ce
 * depot ne pouvait observer jusqu'ici — MapLibre exige un navigateur.
 *
 * `decisionClicCadastre` porte donc les trois decisions du gestionnaire, et le gestionnaire lui-meme
 * n'est plus que du cablage. Ce qui est verifie ici, ce sont les trois cas ou se joue la justesse :
 *
 *   - une parcelle DEJA qualifiee sous le curseur : MapLibre declenche les gestionnaires des DEUX
 *     couches, et sans ce depart, ouvrir une fiche relancerait une qualification par-dessus ;
 *   - un outil de dessin actif : le clic sert deja a mesurer ou a selectionner ;
 *   - une tuile qui n'identifie pas la parcelle : refuser, plutot que qualifier un identifiant invente.
 *
 * CE QUI RESTE NON COUVERT, et il faut le dire : l'affichage du message de retour, et le fait que la
 * qualification soit reellement lancee puis la fiche ouverte. Cela demande un navigateur avec une carte
 * rendue et des tuiles cadastrales servies par l'IGN — donc du reseau, ce que la suite s'interdit. Le
 * cablage du gestionnaire est verifie ci-dessous par un controle STRUCTUREL, faute de mieux : il attrape
 * l'oubli d'enregistrement ou de retrait, pas une erreur de comportement.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionClicCadastre } from '../src/utils/clic-cadastre.js';

/** Attributs d'une entite reelle de la couche `parcelle` du Plan Cadastral Informatise. */
const PARCELLE = {
  idu: '28390000ZH0012',
  code_insee: '28390',
  com_abs: '000',
  section: 'ZH',
  numero: '0012',
  nom_com: 'Tillay-le-Péneux',
  contenance: 39319,
};

test('LE CAS NORMAL : cliquer une parcelle non qualifiee la designe pour qualification', () => {
  const d = decisionClicCadastre({
    proprietes: PARCELLE,
    parcelleQualifieeSousLeCurseur: false,
    outil: 'aucun',
  });
  assert.equal(d.action, 'qualifier');
  assert.equal(d.action === 'qualifier' && d.idu, '28390000ZH0012');
  assert.equal(d.action === 'qualifier' && d.libelle, 'ZH 0012');
});

test('UNE PARCELLE DEJA QUALIFIEE SOUS LE CURSEUR : le clic ne nous appartient pas', () => {
  /**
   * Le piege du double gestionnaire. La couche cadastrale est dessinee SOUS les parcelles qualifiees
   * pour que celles-ci gardent leur couleur de score ; MapLibre notifie alors les deux couches d'un
   * meme clic. Sans ce depart, ouvrir la fiche d'une parcelle deja etudiee declencherait en meme temps
   * une nouvelle qualification — plusieurs secondes d'attente et un appel inutile aux sources
   * publiques, a chaque consultation.
   */
  const d = decisionClicCadastre({
    proprietes: PARCELLE,
    parcelleQualifieeSousLeCurseur: true,
    outil: 'aucun',
  });
  assert.equal(d.action, 'ignorer');
});

test('UN OUTIL DE DESSIN ACTIF : le clic sert a mesurer ou a selectionner', () => {
  for (const outil of ['polygone', 'mesure', 'selection'] as const) {
    const d = decisionClicCadastre({
      proprietes: PARCELLE,
      parcelleQualifieeSousLeCurseur: false,
      outil,
    });
    assert.equal(
      d.action,
      'ignorer',
      `avec l'outil « ${outil} », un clic ne doit pas lancer une qualification de plusieurs secondes`,
    );
  }
});

test('UNE TUILE QUI N’IDENTIFIE PAS LA PARCELLE EST REFUSEE, avec un motif', () => {
  const d = decisionClicCadastre({
    proprietes: { section: 'ZH', numero: '0012' },
    parcelleQualifieeSousLeCurseur: false,
    outil: 'aucun',
  });
  assert.equal(d.action, 'refuser');
  // Le message doit dire quoi faire, pas seulement que ca n'a pas marche.
  assert.match(d.action === 'refuser' ? d.message : '', /référence cadastrale/);
  assert.equal(d.action === 'refuser' && d.libelle, 'ZH 0012');
});

test('une parcelle sans section ni numero garde un libelle presentable', () => {
  // Le libelle est affiche a l'utilisateur : « Parcelle undefined undefined » serait pire que rien.
  const d = decisionClicCadastre({
    proprietes: { idu: '28390000ZH0012' },
    parcelleQualifieeSousLeCurseur: false,
    outil: 'aucun',
  });
  assert.equal(d.action === 'qualifier' && d.libelle, 'parcelle');
});

// ---------------------------------------------------------------------------
// Le cablage, faute de pouvoir l'executer
// ---------------------------------------------------------------------------

test('le gestionnaire est branche sur la couche cadastrale, ET debranche au demontage', () => {
  /**
   * CONTROLE STRUCTUREL, et son intention est modeste : il ne prouve pas que le clic marche, il
   * interdit deux oublis deja commis ailleurs dans ce fichier — brancher un gestionnaire sans le
   * debrancher (chaque changement de filiere ajoute alors un gestionnaire de plus, et un clic finit par
   * lancer plusieurs qualifications), et l'inverse.
   */
  const source = readFileSync(new URL('../src/components/Carte.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /m\.on\('click', 'cadastre-surface', surClicCadastre\)/,
    'sans cet enregistrement, cliquer une parcelle non qualifiee ne fait rien : le defaut signale',
  );
  assert.match(
    source,
    /m\.off\('click', 'cadastre-surface', surClicCadastre\)/,
    'un gestionnaire branche sans retrait s’accumule a chaque re-execution de l’effet',
  );
  // Le depart sur la couche qualifiee doit rester : c'est lui qui evite la double action.
  assert.match(source, /layers: \['parcelles-remplissage'\]/);
});
