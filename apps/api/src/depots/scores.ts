/** Depot des scores materialises par parcelle et par filiere. */

import type { Feu, Filiere, ResultatScore } from '@enr/core';
import { requete, requeteUne } from '../bdd.js';

export const PROFIL_DEFAUT = 'defaut';

export async function scoreParcelle(
  idu: string,
  filiere: Filiere,
  profil = PROFIL_DEFAUT,
): Promise<ResultatScore | null> {
  const l = await requeteUne<{ detail: ResultatScore }>(
    `SELECT detail FROM score_parcelle_filiere
      WHERE idu = $1 AND filiere = $2 AND profil_ponderation = $3`,
    [idu, filiere, profil],
  );
  return l?.detail ?? null;
}

export async function enregistrerScore(
  score: ResultatScore,
  profil = PROFIL_DEFAUT,
): Promise<void> {
  await requete(
    `INSERT INTO score_parcelle_filiere
       (idu, filiere, statut, score_global, detail, couverture_donnees, nb_knock_outs,
        nb_knock_outs_bloquants, regime_implantation, profil_ponderation, version_moteur,
        date_calcul)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET
       statut = EXCLUDED.statut,
       score_global = EXCLUDED.score_global,
       detail = EXCLUDED.detail,
       couverture_donnees = EXCLUDED.couverture_donnees,
       nb_knock_outs = EXCLUDED.nb_knock_outs,
       nb_knock_outs_bloquants = EXCLUDED.nb_knock_outs_bloquants,
       regime_implantation = EXCLUDED.regime_implantation,
       version_moteur = EXCLUDED.version_moteur,
       date_calcul = now()`,
    [
      score.idu,
      score.filiere,
      score.statut,
      score.scoreGlobal,
      JSON.stringify(score),
      score.couvertureDonnees,
      score.knockOuts.length,
      // Seuls les knock-outs non derogeables qualifient une parcelle d'ecartee : la carte,
      // le filtre et la liste s'appuient sur ce compteur, la fiche sur le meme critere.
      score.knockOuts.filter((k) => !k.derogeable).length,
      score.regimeImplantation,
      profil,
      score.versionMoteur,
    ],
  );
}

export async function enregistrerScores(scores: ResultatScore[], profil = PROFIL_DEFAUT): Promise<number> {
  for (const s of scores) await enregistrerScore(s, profil);
  return scores.length;
}

/** Statuts synthetiques pour un lot d'IDU, utilises pour recolorer la carte. */
export async function statutsParIdus(
  idus: string[],
  filiere: Filiere,
  profil = PROFIL_DEFAUT,
): Promise<Record<string, { statut: Feu; scoreGlobal: number | null }>> {
  if (idus.length === 0) return {};
  const lignes = await requete<{ idu: string; statut: Feu; score_global: number | null }>(
    `SELECT idu, statut, score_global FROM score_parcelle_filiere
      WHERE idu = ANY($1) AND filiere = $2 AND profil_ponderation = $3`,
    [idus, filiere, profil],
  );
  return Object.fromEntries(
    lignes.map((l) => [l.idu, { statut: l.statut, scoreGlobal: l.score_global }]),
  );
}

/**
 * Scores COMPLETS pour un lot d'IDU, en une seule requete.
 *
 * POURQUOI — audit 8, defaut C9. Les exports GeoJSON et Shapefile appelaient `scoreParcelle` dans une
 * boucle `for`, soit une requete SQL sequentielle PAR PARCELLE. Un export de 5 000 parcelles faisait
 * 5 000 allers-retours, chacun avec sa latence : la duree croissait lineairement la ou une seule
 * requete suffit. `statutsParIdus` existait deja pour la carte, mais ne renvoie que le statut et le
 * score global — les exports ont besoin du detail complet (knock-outs, regime, couverture).
 */
export async function scoresParIdus(
  idus: string[],
  filiere: Filiere,
  profil = PROFIL_DEFAUT,
): Promise<Record<string, ResultatScore>> {
  if (idus.length === 0) return {};
  const lignes = await requete<{ idu: string; detail: ResultatScore }>(
    `SELECT idu, detail FROM score_parcelle_filiere
      WHERE idu = ANY($1) AND filiere = $2 AND profil_ponderation = $3`,
    [idus, filiere, profil],
  );
  return Object.fromEntries(lignes.map((l) => [l.idu, l.detail]));
}

/** Invalide les scores calcules par une version anterieure du moteur. */
export async function invaliderVersionsAnterieures(versionCourante: string): Promise<number> {
  const lignes = await requete<{ n: number }>(
    `WITH supprimes AS (
       DELETE FROM score_parcelle_filiere WHERE version_moteur <> $1 RETURNING 1
     )
     SELECT count(*)::int AS n FROM supprimes`,
    [versionCourante],
  );
  return lignes[0]?.n ?? 0;
}

/** Compteurs par statut, pour le tableau de bord. */
export async function repartitionStatuts(
  filiere: Filiere,
): Promise<Record<Feu, number> & { total: number }> {
  const lignes = await requete<{ statut: Feu; n: number }>(
    `SELECT statut, count(*)::int AS n FROM score_parcelle_filiere
      WHERE filiere = $1 AND profil_ponderation = $2
      GROUP BY statut`,
    [filiere, PROFIL_DEFAUT],
  );
  const base = { vert: 0, orange: 0, rouge: 0, gris: 0, total: 0 };
  for (const l of lignes) {
    base[l.statut] = l.n;
    base.total += l.n;
  }
  return base;
}

/**
 * Rafraichit les agregats communaux servant la vue nationale.
 *
 * A appeler apres toute qualification de masse : sans cela, le travail accompli reste
 * invisible en dessous du zoom parcellaire, et l'utilisateur croit n'avoir rien produit.
 */
export async function rafraichirCompteursCommunaux(): Promise<void> {
  await requete('SELECT rafraichir_compteurs_communaux()');
}
