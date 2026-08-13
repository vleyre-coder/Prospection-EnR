/**
 * La decision derriere un clic sur le cadastre.
 *
 * POURQUOI CE FICHIER EXISTE, plutot que quelques lignes dans `Carte.tsx`. Un gestionnaire
 * d'evenement MapLibre ne s'execute pas sans navigateur : la logique qu'il contient echappe aux tests.
 * En la sortant ici — un module sans MapLibre, donc importable par un test ordinaire — les trois
 * decisions qui comptent deviennent verifiables, et le gestionnaire n'est plus que du cablage.
 */

import { iduDepuisTuile, type ProprietesTuileParcelle } from '@enr/core';
import type { OutilDessin } from '../store/etat.js';

/**
 * Ce qu'il faut faire d'un clic sur une parcelle du CADASTRE — la couche des parcelles non encore
 * qualifiees.
 *
 * POURQUOI CETTE FONCTION EST SEPAREE DU GESTIONNAIRE. Elle porte les trois seules decisions qui
 * comptent, et un gestionnaire d'evenement MapLibre ne s'execute pas sans navigateur : la sortir la
 * rend verifiable par un test ordinaire, la ou le reste du gestionnaire n'est que du cablage. C'est le
 * meme raisonnement qui a rendu le bandeau d'avertissements testable au chantier A.
 *
 *   - `ignorer` : le clic ne nous appartient pas. Deux cas, et ils sont tous les deux reels — une
 *     parcelle DEJA qualifiee se trouve sous le curseur (MapLibre declenche les gestionnaires des deux
 *     couches, et c'est la fiche qui doit s'ouvrir, pas une seconde qualification) ; ou bien un outil
 *     de dessin est actif, et le clic sert alors a mesurer ou a selectionner ;
 *   - `refuser` : la tuile ne permet pas d'identifier la parcelle. On le dit plutot que de lancer une
 *     qualification sur un identifiant invente ;
 *   - `qualifier` : le cas normal.
 */
export function decisionClicCadastre(arg: {
  proprietes: ProprietesTuileParcelle;
  parcelleQualifieeSousLeCurseur: boolean;
  outil: OutilDessin;
}):
  | { action: 'ignorer' }
  | { action: 'refuser'; libelle: string; message: string }
  | { action: 'qualifier'; idu: string; libelle: string } {
  if (arg.parcelleQualifieeSousLeCurseur) return { action: 'ignorer' };
  // 'selection' comme 'polygone' et 'mesure' : dans ces trois modes le clic a deja un sens, et lancer
  // une qualification de plusieurs secondes par-dessus serait une surprise desagreable.
  if (arg.outil !== 'aucun') return { action: 'ignorer' };

  const libelle =
    [arg.proprietes.section, arg.proprietes.numero].filter(Boolean).join(' ') || 'parcelle';
  const idu = iduDepuisTuile(arg.proprietes);
  if (!idu) {
    return {
      action: 'refuser',
      libelle,
      message:
        'Cette parcelle du cadastre ne porte pas d’identifiant exploitable : elle ne peut pas etre ' +
        'qualifiee depuis la carte. Recherchez-la par sa reference cadastrale.',
    };
  }
  return { action: 'qualifier', idu, libelle };
}

