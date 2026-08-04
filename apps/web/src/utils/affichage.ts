/**
 * Decisions d'AFFICHAGE, extraites des composants pour etre testables.
 *
 * POURQUOI CE FICHIER EXISTE. Trois audits ont trouve quatre defauts critiques, et trois
 * d'entre eux etaient des decisions d'affichage : quel libelle pour quel etat, quel message
 * pour quelle absence de donnee. Ce ne sont pas des bugs de rendu React — ce sont des
 * fonctions de l'etat vers un texte, c'est-a-dire de la logique metier pure. Tant qu'elles
 * vivaient dans le JSX, elles etaient invisibles au typage comme aux tests, et le seul moyen
 * de les verifier etait de les regarder.
 *
 * Regle de partage : ce module ne contient AUCUN JSX et n'importe rien de React. Il choisit
 * un texte et une couleur ; le composant les place.
 */

import type { Feu } from '@enr/core';

/** Sous-ensemble de la palette du referentiel utilise ici, pour ne pas dependre du tout. */
export interface PaletteAffichage {
  couleursScore: Record<Feu, string>;
  libellesScore: Record<Feu, string>;
  couleurRedhibitoire: string;
  libelleRedhibitoire: string;
  descriptionRedhibitoire: string;
}

export interface EtiquetteStatut {
  libelle: string;
  couleur: string;
  /** Infobulle, presente uniquement quand le libelle merite une explication. */
  titre?: string;
  /** Vrai si la parcelle est ecartee par le droit et non par sa note. */
  redhibitoire: boolean;
}

/**
 * Etiquette de statut d'une parcelle dans une liste ou un tableau.
 *
 * LE PIEGE QUE CETTE FONCTION EXISTE POUR FERMER. Une parcelle frappee d'un critere
 * redhibitoire non derogeable et une parcelle simplement mal notee portent le MEME statut :
 * `rouge`. Elles n'appellent pourtant pas la meme action — la premiere est exclue par un
 * texte, la seconde est un arbitrage. La liste etant l'outil de tri quotidien, les confondre
 * conduit a redemarcher une parcelle que le droit ecarte.
 *
 * `nbKnockOutsBloquants` et non `nbKnockOuts` : les knock-outs derogeables (STECAL,
 * modification de PLU) conditionnent un projet, ils ne l'excluent pas.
 */
export function etiquetteStatut(
  statutScore: Feu | null,
  nbKnockOutsBloquants: number,
  palette: PaletteAffichage,
): EtiquetteStatut | null {
  if (statutScore == null) return null;
  if (nbKnockOutsBloquants > 0) {
    return {
      libelle: palette.libelleRedhibitoire,
      couleur: palette.couleurRedhibitoire,
      titre: palette.descriptionRedhibitoire,
      redhibitoire: true,
    };
  }
  return {
    libelle: palette.libellesScore[statutScore],
    couleur: palette.couleursScore[statutScore],
    redhibitoire: false,
  };
}

/**
 * Culture RPG : distingue l'absence de DECLARATION de l'absence de DONNEE.
 *
 * « Aucune declaration PAC » est un constat, et meme un argument favorable en solaire au sol.
 * « Donnee indisponible » est un aveu d'ignorance. Les ecrire l'un pour l'autre transforme
 * une ignorance en affirmation, ou un atout en lacune.
 *
 * Le discriminant est `anneesDeclareesConsecutives` : `null` quand aucune source RPG n'a
 * repondu, `0` quand le RPG a repondu sans ilot recouvrant la parcelle.
 */
export function libelleCultureRpg(rpg: {
  libelleCulture: string | null;
  libelleGroupeCulture: string | null;
  anneesDeclareesConsecutives: number | null;
}): { texte: string; absent: boolean } {
  const culture = rpg.libelleCulture ?? rpg.libelleGroupeCulture;
  if (culture) return { texte: culture, absent: false };
  if (rpg.anneesDeclareesConsecutives == null) {
    return { texte: 'donnee indisponible (RPG non consulte)', absent: true };
  }
  return { texte: 'aucune declaration PAC', absent: false };
}

/**
 * Faut-il signaler une session expiree pour ce 401 ?
 *
 * Un 401 n'est une EXPIRATION que s'il y avait une session. Sans ce test, le tout premier
 * appel de l'application — `/api/auth/moi`, emis avant toute connexion — affichait
 * « Session expiree » a un visiteur qui n'avait jamais eu de session. Et la route de
 * connexion elle-meme repond 401 sur un mot de passe faux : c'est une erreur de saisie, pas
 * une expiration.
 */
export function estSessionExpiree(
  statut: number,
  jetonPresentAvantAppel: boolean,
  chemin: string,
): boolean {
  if (statut !== 401) return false;
  if (!jetonPresentAvantAppel) return false;
  return !chemin.startsWith('/api/auth/connexion');
}
