/**
 * Veille sur la degradation SILENCIEUSE des sources externes.
 *
 * POURQUOI CE MODULE EXISTE. Sept audits ont trouve leur defaut critique dans la meme situation :
 * une source repond HTTP 200, le code ne plante pas, et la valeur qui remonte est nulle ou fausse.
 *
 *   audit 5 : le WFS renvoyait 3 000 objets sur 15 892, sans le dire autrement que par un champ
 *             que personne ne lisait ;
 *   audit 6 : `typedoc` et `sitename` — deux champs lus sous un nom inexistant, donc deux valeurs
 *             toujours nulles ;
 *   audit 7 : `libPpr` — la detection des PPR ne fonctionnait pas, sur toutes les parcelles.
 *
 * Dans les trois cas, RIEN ne s'allumait. Ni une erreur, ni un journal, ni la sonde de sante :
 * elle verifie que les services repondent, pas que leurs reponses portent encore quelque chose.
 *
 * Ce module surveille donc le TAUX DE RENSEIGNEMENT des champs, parcelle apres parcelle. Un champ
 * qui passe de « renseigne 9 fois sur 10 » a « jamais renseigne » signale un contrat rompu, meme
 * si tout repond 200. C'est le seul signal qui aurait permis de voir les trois defauts ci-dessus
 * sans attendre un audit.
 *
 * CE QU'IL NE FAIT PAS. Il ne juge pas la justesse d'une valeur : un champ toujours renseigne mais
 * faux lui echappe. Il detecte la disparition, pas l'erreur. C'est deja ce qui manquait.
 */

import { journal } from '../journal.js';
import type { ParcelleSnapshot } from '@enr/core';

/**
 * Champs surveilles, et taux de renseignement attendu.
 *
 * `tauxMin` est deliberement bas : il ne dit pas « ce champ doit etre renseigne », il dit « si ce
 * champ n'est JAMAIS renseigne sur un lot entier, quelque chose est casse ». Un seuil serre
 * produirait des fausses alertes sur des territoires legitimement pauvres en donnees — une commune
 * sans PPR n'a pas de PPR, et c'est normal.
 *
 * Chaque entree porte le defaut qu'elle aurait permis de voir, quand il y en a un.
 */
interface ChampSurveille {
  chemin: string;
  /** Extrait la valeur ; `null` ou `undefined` compte comme non renseigne. */
  lire: (s: ParcelleSnapshot) => unknown;
  /** Part minimale de parcelles ou le champ doit etre renseigne, entre 0 et 1. */
  tauxMin: number;
  motif: string;
}

export const CHAMPS_SURVEILLES: readonly ChampSurveille[] = [
  {
    chemin: 'urbanisme.typeDocument',
    lire: (s) => s.urbanisme.typeDocument,
    // Une commune au reglement national d'urbanisme n'a pas de document : le taux ne peut pas
    // etre de 1. Mais zero sur un lot entier signale un champ lu sous un mauvais nom.
    tauxMin: 0.3,
    motif: "Lu sous `typedoc` jusqu'a l'audit 6, alors que le champ reel est `du_type` : la valeur etait TOUJOURS nulle et chaque fiche affichait « non renseigne ».",
  },
  {
    chemin: 'milieux.natura2000Habitats.nom',
    lire: (s) => s.milieux.natura2000Habitats.nom,
    // Le nom n'existe que si un site est trouve dans le rayon : le taux depend du territoire.
    tauxMin: 0.05,
    motif: "Lu sous `nom_site` puis `nom` jusqu'a l'audit 6, alors que les couches Natura 2000 d'API Carto emploient `sitename` : le nom du site etait TOUJOURS nul.",
  },
  {
    chemin: 'bati.distanceHabitationM',
    lire: (s) => s.bati.distanceHabitationM,
    tauxMin: 0.5,
    motif: "Fausse de deux ordres de grandeur en tissu dense jusqu'a l'audit 5 (troncature WFS non detectee), et sous-estimee d'un tiers du bati jusqu'a l'audit 6.",
  },
  {
    chemin: 'topographie.pentePct',
    lire: (s) => s.topographie.pentePct,
    tauxMin: 0.7,
    motif: 'Aberrante jusqu’a 1 665 % sur 14 % des parcelles avant l’audit 4 (ajustement de plan mal conditionne).',
  },
  {
    chemin: 'raccordement.posteLePlusProche',
    lire: (s) => s.raccordement.posteLePlusProche,
    tauxMin: 0.5,
    motif: 'Depend d’une ingestion : un poste source jamais trouve signale une ingestion vide plutot qu’un territoire sans reseau.',
  },
  {
    chemin: 'occupationSol.typeSol',
    lire: (s) => s.occupationSol.typeSol,
    tauxMin: 0.5,
    motif: 'Deduit du RPG et de la couverture forestiere : un type de sol jamais determine signale que les deux sources sont muettes.',
  },
];

/** Une anomalie de veille : un champ dont le taux de renseignement s'est effondre. */
export interface AnomalieVeille {
  chemin: string;
  renseignes: number;
  total: number;
  taux: number;
  tauxMin: number;
  motif: string;
}

/**
 * Compare les taux de renseignement d'un lot de snapshots aux taux attendus.
 *
 * A n'appeler que sur un lot ASSEZ GRAND : sur trois parcelles, un taux de 0 ne prouve rien. Le
 * seuil est explicite pour que l'appelant ne puisse pas s'en dispenser par inadvertance.
 */
export function veillerSurLot(
  snapshots: readonly ParcelleSnapshot[],
  lotMinimal = 20,
): { anomalies: AnomalieVeille[]; suffisant: boolean } {
  if (snapshots.length < lotMinimal) return { anomalies: [], suffisant: false };

  const anomalies: AnomalieVeille[] = [];
  for (const champ of CHAMPS_SURVEILLES) {
    let renseignes = 0;
    for (const s of snapshots) {
      const v = champ.lire(s);
      // `0`, `false` et la chaine vide sont des valeurs renseignees : seul l'absence compte.
      if (v !== null && v !== undefined) renseignes += 1;
    }
    const taux = renseignes / snapshots.length;
    if (taux < champ.tauxMin) {
      anomalies.push({
        chemin: champ.chemin,
        renseignes,
        total: snapshots.length,
        taux,
        tauxMin: champ.tauxMin,
        motif: champ.motif,
      });
    }
  }
  return { anomalies, suffisant: true };
}

/**
 * Journalise le resultat d'une veille, au niveau qui correspond a sa gravite.
 *
 * Un champ tombe a ZERO sur un lot entier est traite comme une erreur, pas un avertissement :
 * c'est la signature exacte d'un contrat rompu, et les trois defauts cites en tete de fichier
 * l'auraient declenchee.
 */
export function journaliserVeille(resultat: ReturnType<typeof veillerSurLot>): void {
  if (!resultat.suffisant || resultat.anomalies.length === 0) return;
  for (const a of resultat.anomalies) {
    const detail = {
      chemin: a.chemin,
      renseignes: a.renseignes,
      total: a.total,
      taux: `${(a.taux * 100).toFixed(1)} %`,
      attendu: `>= ${(a.tauxMin * 100).toFixed(0)} %`,
      motif: a.motif,
    };
    if (a.renseignes === 0) {
      journal.error(
        detail,
        'VEILLE SOURCES : champ jamais renseigne sur tout le lot. Signature d’un contrat rompu — ' +
          'verifiez que le nom du champ lu existe toujours dans la reponse du service.',
      );
    } else {
      journal.warn(detail, 'VEILLE SOURCES : taux de renseignement anormalement bas.');
    }
  }
}
