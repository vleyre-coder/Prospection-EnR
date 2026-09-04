/**
 * Effacer ce qui a disparu de la source — et refuser de le faire quand on n'en est pas sûr.
 *
 * POURQUOI CE MODULE EXISTE — audit 9, défaut D1. Aucune ingestion ne contenait de `DELETE` : toutes
 * sont en « insertion ou mise à jour » sur la clé naturelle. Un objet retiré de la source restait
 * donc en base indéfiniment et continuait d'être affirmé. Un site déclassé restait un site classé,
 * une délibération de ZAER annulée restait une ZAER — et les communes révisent régulièrement leurs
 * délibérations, donc le cas n'est pas d'école.
 *
 * LA PARTIE DIFFICILE N'EST PAS LA SUPPRESSION, C'EST LE DROIT DE SUPPRIMER. Une suppression mal
 * gardée est bien pire que le défaut qu'elle corrige : elle transforme une source momentanément
 * dégradée en effacement d'une couche entière, c'est-à-dire exactement la famille de fautes que ces
 * audits corrigent depuis huit itérations — affirmer une absence qu'on n'a pas constatée. Deux
 * conditions sont donc exigées, et elles sont indépendantes.
 *
 *   1. **Pagination prouvée complète.** Le générateur WFS sait distinguer « dernière page atteinte »
 *      de « borne de sécurité atteinte » ou « erreur remontée » ; il le dit désormais à son appelant.
 *      Sans cette preuve, aucune suppression : les objets manquants sont peut-être simplement
 *      dans la partie non lue.
 *   2. **Volumétrie sous un plafond.** Même une pagination complète peut refléter une source qui a
 *      silencieusement tronqué sa réponse — la Géoplateforme a déjà répondu 400 en plein milieu d'une
 *      couche, et 503 quatre fois d'affilée. Au-delà d'une part du jeu, la suppression est refusée
 *      et JOURNALISÉE : mieux vaut une couche qui contient des objets périmés, signalés, qu'une
 *      couche vidée en silence.
 *
 * La décision est isolée dans une fonction pure, pour qu'elle soit testable sans base ni réseau : ce
 * sont ses branches qui portent le risque, pas la requête `DELETE`.
 */

import { requete } from '../bdd.js';
import { journal } from '../journal.js';

/**
 * Part maximale du jeu qu'une ingestion s'autorise à effacer.
 *
 * 20 % : une révision annuelle de la couche des ZAER ou des sites protégés ne retire pas un objet
 * sur cinq. Au-delà, l'hypothèse la plus probable n'est pas que la source a changé, c'est que la
 * lecture s'est mal passée.
 */
export const PART_SUPPRESSION_MAX = 0.2;

export interface DecisionSuppression {
  autorisee: boolean;
  /** Motif circonstancié, journalisé et repris dans le compte rendu d'ingestion. */
  motif: string;
}

/**
 * La suppression est-elle autorisée ?
 *
 * Fonction pure : c'est la porte, et elle doit pouvoir être ouverte et refermée en test sans base.
 *
 * @param complete    la pagination est-elle allée au bout, sans erreur ni borne de sécurité
 * @param nbEnBase    nombre de lignes du connecteur présentes en base APRÈS l'ingestion
 * @param nbDisparus  nombre de lignes non revues par cette ingestion
 */
export function suppressionAutorisee({
  complete,
  nbEnBase,
  nbDisparus,
  partMax = PART_SUPPRESSION_MAX,
}: {
  complete: boolean;
  nbEnBase: number;
  nbDisparus: number;
  partMax?: number;
}): DecisionSuppression {
  if (!complete) {
    return {
      autorisee: false,
      motif:
        'pagination incomplète : les objets manquants sont peut-être dans la partie non lue, ' +
        'aucune suppression',
    };
  }
  if (nbDisparus === 0) {
    return { autorisee: true, motif: 'aucun objet disparu' };
  }
  // Base vide avant l'ingestion : il n'y a rien a supprimer, et la part serait indefinie.
  if (nbEnBase === 0) {
    return {
      autorisee: false,
      motif: 'aucune ligne en base après ingestion : état anormal, aucune suppression',
    };
  }
  const part = nbDisparus / nbEnBase;
  if (part > partMax) {
    return {
      autorisee: false,
      motif:
        `${nbDisparus} objets non revus sur ${nbEnBase} en base, soit ` +
        `${Math.round(part * 100)} % — au-dela du plafond de ${Math.round(partMax * 100)} %. ` +
        'Une source tronquée est plus probable qu’une révision de cette ampleur : aucune suppression. ' +
        'Vérifier la source, puis relancer.',
    };
  }
  return {
    autorisee: true,
    motif: `${nbDisparus} objets disparus de la source sur ${nbEnBase} (${Math.round(part * 100)} %)`,
  };
}

/** Table sur laquelle porte l'effacement, avec la façon d'y désigner un connecteur. */
export type Cible =
  | { table: 'contrainte'; connecteur: string }
  | { table: 'zaer'; connecteur: 'zaer_local' };

/**
 * Condition SQL désignant le périmètre de l'effacement.
 *
 * EXPORTÉE POUR ÊTRE TESTÉE, et c'est justifié : la branche `zaer` est la plus dangereuse du module.
 * `zaer` ne porte pas de colonne `connecteur`, donc le périmètre y est défini par
 * `est_demonstration = false`. Une erreur dans cette expression effacerait le jeu de démonstration,
 * qui ne vient d'aucune source et ne peut donc pas en avoir disparu. Le vérifier de bout en bout
 * demanderait de supprimer réellement des ZAER réelles sur la base d'exécution, ce qu'un test ne doit
 * pas faire ; la condition étant PARTAGÉE par le comptage et par le `DELETE`, la vérifier ici couvre
 * exactement ce qui est en jeu.
 */
export function conditionCible(cible: Cible): { where: string; params: unknown[] } {
  if (cible.table === 'contrainte') {
    return { where: `connecteur = $1`, params: [cible.connecteur] };
  }
  // `zaer` ne porte pas de colonne `connecteur`. Les zones de demonstration sont explicitement
  // preservees : elles ne viennent d'aucune source et ne peuvent donc pas en avoir disparu.
  return { where: `est_demonstration = false`, params: [] };
}

/**
 * Efface les lignes que cette ingestion n'a pas revues, si elle en a le droit.
 *
 * `debutRun` doit être l'horodatage pris AVANT la première insertion : toute ligne dont `updated_at`
 * lui est antérieur n'a pas été revue.
 */
export async function effacerDisparus(
  cible: Cible,
  debutRun: Date,
  complete: boolean,
  partMax = PART_SUPPRESSION_MAX,
): Promise<{ supprimes: number; motif: string }> {
  const { where, params } = conditionCible(cible);
  const decalage = params.length;

  const [compte] = await requete<{ en_base: number; disparus: number }>(
    `SELECT count(*)::int AS en_base,
            count(*) FILTER (WHERE updated_at < $${decalage + 1})::int AS disparus
       FROM ${cible.table} WHERE ${where}`,
    [...params, debutRun],
  );
  const nbEnBase = compte?.en_base ?? 0;
  const nbDisparus = compte?.disparus ?? 0;

  const decision = suppressionAutorisee({ complete, nbEnBase, nbDisparus, partMax });
  if (!decision.autorisee) {
    // Un refus doit se voir : c'est l'information qui dit a l'exploitant que sa couche contient des
    // objets perimes, et pourquoi ils n'ont pas ete retires.
    if (nbDisparus > 0) {
      journal.warn(
        { table: cible.table, connecteur: cible.connecteur, nbEnBase, nbDisparus, motif: decision.motif },
        'Suppression des objets disparus REFUSÉE',
      );
    }
    return { supprimes: 0, motif: decision.motif };
  }
  if (nbDisparus === 0) return { supprimes: 0, motif: decision.motif };

  const supprimees = await requete<{ n: number }>(
    `WITH morts AS (
       DELETE FROM ${cible.table}
        WHERE ${where} AND updated_at < $${decalage + 1}
        RETURNING 1
     )
     SELECT count(*)::int AS n FROM morts`,
    [...params, debutRun],
  );
  const supprimes = supprimees[0]?.n ?? 0;
  journal.info(
    { table: cible.table, connecteur: cible.connecteur, supprimes, nbEnBase },
    'Objets disparus de la source effaces',
  );
  return { supprimes, motif: decision.motif };
}
