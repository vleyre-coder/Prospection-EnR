/**
 * Etat de l'application : la ponderation effective envoyee a l'API.
 *
 * POURQUOI CE FICHIER EXISTE. `ponderationCourante` decide de ce qui part au serveur pour
 * recalculer un score. Elle porte une distinction qui n'est pas cosmetique : renvoyer `undefined`
 * signifie « utilise le profil par defaut », renvoyer un objet signifie « voici MES poids ». Se
 * tromper fait silencieusement scorer toute une campagne avec la mauvaise ponderation — sans
 * plantage, sans message, avec des nombres plausibles.
 *
 * La ponderation est aussi PAR FILIERE : des poids saisis pour le solaire ne doivent pas fuir vers
 * l'eolien, dont les criteres et les seuils n'ont rien a voir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ponderationCourante, STATUTS, FEUX } from '../src/store/etat.js';
import type { EtatApp } from '../src/store/etat.js';

/** Etat minimal : seuls les champs que la fonction lit sont necessaires. */
function etat(
  filiere: string,
  ponderations: Record<string, Record<string, number> | undefined>,
  seuils: Record<string, { seuilVert: number; seuilOrange: number } | undefined> = {},
): EtatApp {
  return { filiere, ponderations, seuils } as unknown as EtatApp;
}

test('sans poids ni seuil, aucune ponderation n’est envoyee', () => {
  // `undefined` et non `{}` : un objet vide serait interprete comme une surcharge, et le serveur
  // remplacerait le profil par defaut par rien du tout.
  assert.equal(ponderationCourante(etat('solaire_sol', {})), undefined);
  assert.equal(ponderationCourante(etat('solaire_sol', { solaire_sol: {} })), undefined);
  assert.equal(ponderationCourante(etat('solaire_sol', { solaire_sol: undefined })), undefined);
});

test('des poids saisis sont transmis tels quels', () => {
  const r = ponderationCourante(etat('solaire_sol', { solaire_sol: { urb_zonage: 12 } }));
  assert.deepEqual(r, { poids: { urb_zonage: 12 } });
});

test('des seuils seuls suffisent a declencher une surcharge', () => {
  // Un utilisateur peut ne toucher qu'aux seuils vert/orange sans modifier les poids.
  const r = ponderationCourante(etat('bess', {}, { bess: { seuilVert: 70, seuilOrange: 50 } }));
  assert.deepEqual(r, { seuilVert: 70, seuilOrange: 50 });
});

test('poids et seuils se combinent', () => {
  const r = ponderationCourante(
    etat('bess', { bess: { risq_inondation: 8 } }, { bess: { seuilVert: 72, seuilOrange: 55 } }),
  );
  assert.deepEqual(r, { poids: { risq_inondation: 8 }, seuilVert: 72, seuilOrange: 55 });
});

test('la ponderation d’une filiere ne fuit pas vers une autre', () => {
  // Les criteres et les seuils differents d'une filiere a l'autre : melanger les deux produirait
  // un score calcule avec des poids qui n'ont aucun sens pour la filiere affichee.
  const e = etat(
    'eolien_terrestre',
    { solaire_sol: { urb_zonage: 20 }, eolien_terrestre: { risq_aero_radar: 15 } },
    { solaire_sol: { seuilVert: 80, seuilOrange: 60 } },
  );
  assert.deepEqual(ponderationCourante(e), { poids: { risq_aero_radar: 15 } });
});

test('changer de filiere sans y avoir touche redonne le profil par defaut', () => {
  const e = etat('methanisation', { solaire_sol: { urb_zonage: 20 } });
  assert.equal(ponderationCourante(e), undefined);
});

test('un poids nul est une surcharge deliberee, pas une absence', () => {
  // Mettre un critere a 0 est une facon legitime de le neutraliser : la valeur doit passer.
  const r = ponderationCourante(etat('solaire_sol', { solaire_sol: { pat_monuments: 0 } }));
  assert.deepEqual(r, { poids: { pat_monuments: 0 } });
});

// ---------------------------------------------------------------------------
// Listes de reference exposees a l'interface
// ---------------------------------------------------------------------------

test('les statuts de prospection couvrent le cycle commercial, sans doublon', () => {
  assert.deepEqual(STATUTS, ['a_prospecter', 'contact_pris', 'en_negociation', 'securise', 'ecarte']);
  assert.equal(new Set(STATUTS).size, STATUTS.length);
});

test('les quatre feux sont exposes, gris compris', () => {
  // Le gris n'est pas un statut de confort : il signale une couverture de donnees insuffisante,
  // et il doit rester filtrable comme les autres.
  assert.deepEqual(FEUX, ['vert', 'orange', 'rouge', 'gris']);
});
