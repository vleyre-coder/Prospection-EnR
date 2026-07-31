/**
 * Palette de l'application.
 *
 * Deux dimensions doivent rester visuellement distinctes (cahier des charges, section 10) :
 *   (a) le SCORE DE PROPICE  -> remplissage de la parcelle (vert / orange / rouge / gris)
 *   (b) l'ETAT DE PROSPECTION -> contour et pastille (palette froide : bleus / violets)
 *
 * Les couleurs de score sont choisies pour rester distinguables en cas de deuteranopie
 * (le rouge et le vert retenus diffèrent nettement en luminance) et lisibles en exterieur.
 */

import type { Feu } from './types.js';

export const COULEURS_SCORE: Record<Feu, string> = {
  vert: '#16a34a',
  orange: '#f59e0b',
  rouge: '#dc2626',
  gris: '#9ca3af',
};

export const COULEURS_SCORE_REMPLISSAGE: Record<Feu, string> = {
  vert: '#22c55e',
  orange: '#fbbf24',
  rouge: '#ef4444',
  gris: '#d1d5db',
};

export const LIBELLES_SCORE: Record<Feu, string> = {
  vert: 'Propice',
  orange: 'Sous conditions / a etudier',
  rouge: 'Redhibitoire / ecarte',
  gris: 'Donnees manquantes',
};

export const DESCRIPTIONS_SCORE: Record<Feu, string> = {
  vert: "Aucun critere redhibitoire et score global au-dessus du seuil : parcelle a demarcher en priorite.",
  orange:
    "Aucun critere redhibitoire, mais des points de vigilance abaissent le score : a etudier avant demarchage.",
  rouge:
    "Au moins un critere redhibitoire est declenche, ou le score est tres bas : parcelle a ecarter en l'etat.",
  gris: "Couverture de donnees insuffisante pour conclure. L'absence de donnee ne vaut pas absence de contrainte.",
};

export const COULEURS_SATURATION: Record<string, string> = {
  disponible: '#15803d',
  tendu: '#d97706',
  sature: '#b91c1c',
  inconnu: '#6b7280',
};

export const LIBELLES_SATURATION: Record<string, string> = {
  disponible: 'Capacite disponible',
  tendu: 'Capacite tendue',
  sature: 'Poste sature',
  inconnu: 'Etat inconnu',
};
