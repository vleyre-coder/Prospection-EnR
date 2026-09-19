/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * MODE 2 — TRADUIRE LES SEUILS D'UN DEVELOPPEUR EN CONDITIONS DE RECHERCHE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE §2.3 COTE RECHERCHE. La recherche evalue au seuil DEVELOPPEUR quand il existe pour la
 * contrainte, et au seuil reglementaire sinon. Ce module fait la premiere moitie : il transforme
 * les seuils d'un profil en conditions SQL portant sur les grandeurs du releve.
 *
 * POURQUOI EN SQL, ET SURTOUT PAS APRES COUP. La tentation etait de recuperer la page de
 * resultats, d'evaluer le verdict sur chaque ligne, puis de retirer celles qui ne tiennent pas le
 * cahier des charges. C'est FAUX, et faux de facon insidieuse : le `total` compte les lignes AVANT
 * ce tri, la page 2 ne commence pas ou la page 1 s'arrete, et l'operateur voit « 240 résultats »
 * au-dessus d'une liste qui en montre neuf. Le depot tient d'ailleurs un garde de pagination
 * stable, pour exactement ce genre d'ecart.
 *
 * Traduire en conditions SQL rend le filtrage et le comptage coherents par construction, et
 * reutilise le mecanisme de seuils generiques deja valide contre `BORNES_SNAPSHOT`.
 *
 * CE QUE LA TRADUCTION NE PEUT PAS FAIRE, ET LE DIT. Une contrainte sans correspondance vers une
 * grandeur du releve — 250 des 292 — ne produit aucune condition. Un seuil saisi sur elle serait
 * donc ANNONCE et jamais applique, ce qui est la pire des reponses : l'operateur croit son filtre
 * actif. La traduction rend donc la liste des seuils IGNORES, que la route remonte au client.
 *
 * ET LE SENS N'EST JAMAIS DEVINE. Un seuil developpeur porte son sens quand le classeur ne
 * l'etablit pas, et le recopie sinon — voir `seuils-developpeur.ts`. Ici, on se contente de le
 * lire : un seuil sans sens exploitable est ignore et signale, jamais applique au hasard.
 */

import { contrainteParId, sensReglementaire, type SensSeuil } from '@enr/core';
import { correspondanceDe } from '@enr/scoring';

/** Une condition de recherche, dans la forme que `filtrerParcelles` sait deja appliquer. */
export interface SeuilTraduit {
  chemin: string;
  min?: number;
  max?: number;
}

/** Un seuil qui n'a pas pu etre traduit, avec la raison — jamais passe sous silence. */
export interface SeuilIgnore {
  contrainteId: string;
  nom: string;
  raison: 'grandeur_non_mesuree' | 'contrainte_inconnue' | 'sens_indetermine' | 'mode_presence';
}

export interface TraductionProfil {
  seuils: SeuilTraduit[];
  ignores: SeuilIgnore[];
}

/**
 * Un seuil a traduire, dans une forme qui couvre les DEUX representations du depot.
 *
 * `SeuilDeveloppeur` (dans `@enr/core`) note un sens absent `undefined` ; la base, qui ne connait
 * pas `undefined`, le note `null`. Les deux veulent dire la meme chose — « le classeur etablit le
 * sens, il n'y a rien a saisir » — et les reconcilier par un transtypage masquerait le jour ou
 * elles cesseraient d'etre equivalentes. Le type les accepte donc explicitement toutes les deux.
 */
export interface SeuilATraduire {
  contrainteId: string;
  valeur: number;
  sens?: SensSeuil | null;
}

/**
 * Traduit les seuils d'un profil en conditions de recherche.
 *
 * Les seuils traduits s'ajoutent a ceux que l'operateur a saisis directement dans le formulaire.
 * En cas de collision sur un meme chemin, c'est au constructeur SQL de trancher — il refuse deja
 * les doublons, ce que la route rend en 400 plutot qu'en silence.
 */
export function traduireProfil(seuilsDeveloppeur: readonly SeuilATraduire[]): TraductionProfil {
  const seuils: SeuilTraduit[] = [];
  const ignores: SeuilIgnore[] = [];

  for (const s of seuilsDeveloppeur) {
    const contrainte = contrainteParId(s.contrainteId);
    if (!contrainte) {
      // Le profil a survecu a une revision du classeur : la route signale deja l'orphelin, et on
      // ne fabrique surtout pas de condition a partir d'une contrainte qui n'existe plus.
      ignores.push({ contrainteId: s.contrainteId, nom: s.contrainteId, raison: 'contrainte_inconnue' });
      continue;
    }

    const correspondance = correspondanceDe(s.contrainteId);
    if (!correspondance) {
      ignores.push({ contrainteId: s.contrainteId, nom: contrainte.nom, raison: 'grandeur_non_mesuree' });
      continue;
    }
    if (correspondance.mode !== 'seuil') {
      /*
       * Une contrainte de PRESENCE — « interdit en cœur de parc » — se mesure par un recouvrement,
       * pas par un nombre. Un seuil developpeur n'y a pas de sens ; la validation de l'ecriture le
       * refuse deja, et ceci ferme la porte cote lecture pour un profil ancien.
       */
      ignores.push({ contrainteId: s.contrainteId, nom: contrainte.nom, raison: 'mode_presence' });
      continue;
    }

    const chemin = correspondance.chemins[0];
    if (chemin === undefined) {
      ignores.push({ contrainteId: s.contrainteId, nom: contrainte.nom, raison: 'grandeur_non_mesuree' });
      continue;
    }

    // Le sens du classeur d'abord, celui de l'operateur ensuite. Jamais de defaut.
    const sens = sensReglementaire(contrainte) ?? s.sens ?? null;
    if (sens === null) {
      ignores.push({ contrainteId: s.contrainteId, nom: contrainte.nom, raison: 'sens_indetermine' });
      continue;
    }

    seuils.push(sens === 'min' ? { chemin, min: s.valeur } : { chemin, max: s.valeur });
  }

  return { seuils, ignores };
}

/** Phrase d'explication d'un seuil ignore, pour l'interface et le dossier. */
export function expliquerIgnore(i: SeuilIgnore): string {
  switch (i.raison) {
    case 'grandeur_non_mesuree':
      return `« ${i.nom} » : aucune grandeur du relevé ne mesure cette contrainte, le seuil n'a pas été appliqué.`;
    case 'contrainte_inconnue':
      return `« ${i.nom} » : cette contrainte n'existe plus au référentiel, le seuil n'a pas été appliqué.`;
    case 'sens_indetermine':
      return `« ${i.nom} » : le sens de l'exigence n'est pas renseigné, le seuil n'a pas été appliqué.`;
    case 'mode_presence':
      return `« ${i.nom} » : cette contrainte se mesure par recouvrement et non par un seuil chiffré.`;
  }
}
