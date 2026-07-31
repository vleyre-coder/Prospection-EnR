/**
 * Service de qualification : recuperation, enrichissement, scoring et persistance.
 *
 * C'est le coeur du fonctionnement a l'echelle nationale. Le parcellaire francais compte
 * environ cent millions d'objets : il n'est pas pre-ingere. Une parcelle n'entre dans la
 * base que lorsqu'un utilisateur s'en approche (zoom >= 14) ou la demande explicitement.
 * Son snapshot et ses scores sont alors materialises, puis rafraichis par lot.
 */

import { FILIERES, type Filiere, type ResultatScore } from '@enr/core';
import { calculerScore, VERSION_MOTEUR } from '@enr/scoring';
import { journal } from '../journal.js';
import { config } from '../config.js';
import type { Bbox } from '../geo.js';
import { parcellesParEmprise, parcelleParIdu as recupererParcelle } from '../connecteurs/cadastre.js';
import { couvertureSnapshot, enrichirParcelle } from '../enrichissement.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';

export interface ResultatQualification {
  nbParcelles: number;
  nbEnrichies: number;
  nbEchecs: number;
  dureeMs: number;
  echecsParConnecteur: Record<string, number>;
}

/**
 * Qualifie une liste d'IDU : recupere la geometrie si absente, enrichit, score pour les
 * quatre filieres, et persiste. Les parcelles deja qualifiees et fraiches sont ignorees,
 * sauf si `forcer` est vrai.
 */
export async function qualifierIdus(
  idus: string[],
  options: { forcer?: boolean; filieres?: Filiere[] } = {},
): Promise<ResultatQualification> {
  const debut = Date.now();
  const filieres = options.filieres ?? [...FILIERES];
  const echecsParConnecteur: Record<string, number> = {};
  let nbEnrichies = 0;
  let nbEchecs = 0;

  const lot = idus.slice(0, config.qualification.lotMax);

  for (const idu of lot) {
    try {
      // 1. Geometrie : cache, sinon API Carto.
      let enBase = await depotParcelles.parcelleParIdu(idu);
      if (!enBase) {
        const brute = await recupererParcelle(idu);
        if (!brute) {
          nbEchecs += 1;
          continue;
        }
        await depotParcelles.enregistrerParcelle(brute);
        enBase = await depotParcelles.parcelleParIdu(idu);
      }
      if (!enBase) {
        nbEchecs += 1;
        continue;
      }

      // 2. Snapshot : reutilise s'il est frais.
      const existant = await depotParcelles.snapshotParIdu(idu);
      let snapshot = existant?.snapshot;
      let echecs = existant?.connecteursEnEchec ?? [];

      const doitEnrichir =
        options.forcer === true || !existant || depotParcelles.snapshotPerime(existant.dateSnapshot);

      if (doitEnrichir) {
        const resultat = await enrichirParcelle({
          idu: enBase.idu,
          codeInsee: enBase.codeInsee,
          nomCommune: enBase.nomCommune ?? '',
          codeDepartement: enBase.codeDepartement,
          prefixe: enBase.prefixe,
          section: enBase.section,
          numero: enBase.numero,
          contenanceM2: enBase.contenanceM2,
          surfaceCalculeeM2: enBase.surfaceCalculeeM2 ?? 0,
          geometrie: enBase.geometrie,
          centroide: enBase.centroide,
        });
        snapshot = resultat.snapshot;
        echecs = resultat.connecteursEnEchec;
        await depotParcelles.enregistrerSnapshot(
          idu,
          snapshot,
          echecs,
          couvertureSnapshot(snapshot),
        );
      }

      if (!snapshot) {
        nbEchecs += 1;
        continue;
      }

      for (const e of echecs) {
        echecsParConnecteur[e] = (echecsParConnecteur[e] ?? 0) + 1;
      }

      // 3. Scoring des filieres demandees, avec le profil par defaut.
      const scores = filieres.map((f) => calculerScore(snapshot!, f));
      await depotScores.enregistrerScores(scores);

      nbEnrichies += 1;
    } catch (err) {
      journal.warn({ err, idu }, 'Echec de qualification de parcelle');
      nbEchecs += 1;
    }
  }

  return {
    nbParcelles: lot.length,
    nbEnrichies,
    nbEchecs,
    dureeMs: Date.now() - debut,
    echecsParConnecteur,
  };
}

/**
 * Qualifie toutes les parcelles d'une emprise depassant la surface minimale.
 *
 * Le filtre de surface est essentiel : une commune compte des milliers de micro-parcelles
 * sans interet pour un projet ENR, et les qualifier saturerait inutilement les sources.
 */
export async function qualifierEmprise(
  bbox: Bbox,
  options: { surfaceMinM2?: number; filieres?: Filiere[]; forcer?: boolean } = {},
): Promise<ResultatQualification> {
  const debut = Date.now();
  const surfaceMin = options.surfaceMinM2 ?? config.qualification.surfaceMinM2;

  const brutes = await parcellesParEmprise(bbox);
  const retenues = brutes.filter(
    (p) => (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin,
  );

  journal.info(
    { bbox, trouvees: brutes.length, retenues: retenues.length, surfaceMin },
    "Qualification d'emprise",
  );

  await depotParcelles.enregistrerParcelles(retenues);

  const resultat = await qualifierIdus(
    retenues.map((p) => p.idu),
    { filieres: options.filieres, forcer: options.forcer },
  );

  return { ...resultat, nbParcelles: retenues.length, dureeMs: Date.now() - debut };
}

/**
 * Recalcule les scores d'un lot de parcelles a la volee, avec des ponderations modifiees.
 * Ne persiste rien : c'est le mode "curseurs" de l'interface.
 */
export async function scorerAvecPonderation(
  idus: string[],
  filiere: Filiere,
  ponderation: Parameters<typeof calculerScore>[2],
): Promise<Record<string, ResultatScore>> {
  const out: Record<string, ResultatScore> = {};
  for (const idu of idus) {
    const s = await depotParcelles.snapshotParIdu(idu);
    if (!s) continue;
    out[idu] = calculerScore(s.snapshot, filiere, ponderation);
  }
  return out;
}

/** Recalcul par batch, apres mise a jour de donnees ou changement de version du moteur. */
export async function rescorerTout(
  filieres: Filiere[] = [...FILIERES],
  limite = 5000,
): Promise<{ nbParcelles: number; nbScores: number }> {
  const invalides = await depotScores.invaliderVersionsAnterieures(VERSION_MOTEUR);
  if (invalides > 0) {
    journal.info({ invalides, version: VERSION_MOTEUR }, 'Scores obsoletes invalides');
  }

  const idus = await depotParcelles.idusARafraichir(limite);
  let nbScores = 0;
  for (const idu of idus) {
    const s = await depotParcelles.snapshotParIdu(idu);
    if (!s) continue;
    const scores = filieres.map((f) => calculerScore(s.snapshot, f));
    await depotScores.enregistrerScores(scores);
    nbScores += scores.length;
  }
  return { nbParcelles: idus.length, nbScores };
}
