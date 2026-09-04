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

/**
 * Rouge REDHIBITOIRE : un critere eliminatoire est declenche.
 *
 * A distinguer du rouge de score faible, qui partageait jusqu'ici la meme couleur. Les deux
 * n'appellent pourtant pas la meme decision : l'un est definitif en l'etat du droit, l'autre
 * est une question de priorite - une parcelle notee 38 peut redevenir interessante si le
 * poste source est renforce ou si les ponderations changent. Les confondre sur la carte, la
 * ou se prend la decision d'envoyer un prospecteur, est un contresens metier.
 *
 * Teinte volontairement plus sombre et plus saturee que le rouge de score : elle reste
 * distinguable en deuteranopie par sa luminance nettement plus basse.
 */
export const COULEUR_REDHIBITOIRE = '#7f1d1d';
export const COULEUR_REDHIBITOIRE_REMPLISSAGE = '#991b1b';

export const LIBELLES_SCORE: Record<Feu, string> = {
  vert: 'Propice',
  orange: 'Sous conditions / a etudier',
  rouge: 'Score faible',
  gris: 'Donnees manquantes',
};

export const LIBELLE_REDHIBITOIRE = 'Redhibitoire';

export const DESCRIPTIONS_SCORE: Record<Feu, string> = {
  vert: "Aucun critère rédhibitoire et score global au-dessus du seuil : parcelle à démarcher en priorité.",
  orange:
    "Aucun critère rédhibitoire, mais des points de vigilance abaissent le score : à étudier avant démarchage.",
  rouge:
    "Aucun critère rédhibitoire, mais un score très bas : parcelle peu intéressante en l'état, sans obstacle de droit. Elle peut remonter si le contexte evolue (renforcement de poste, changement de pondération).",
  gris: "Couverture de données insuffisante pour conclure. L'absence de donnée ne vaut pas absence de contrainte.",
};

export const DESCRIPTION_REDHIBITOIRE =
  "Au moins un critère éliminatoire est declenche (recul réglementaire hors d'atteinte, protection forte, poste sature sans renforcement...). Aucun score n'est calcule : la parcelle est écartée en l'état du droit, et non simplement mal classée.";

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
