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
import { decouperBbox, type Bbox } from '../geo.js';
import {
  parcellesParEmprise,
  parcellesParGrandeEmprise,
  parcelleParIdu as recupererParcelle,
} from '../connecteurs/cadastre.js';
import { couvertureSnapshot, enrichirParcelle } from '../enrichissement.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';

/** Rapport d'avancement : (traitees, total, echecs). */
export type Progres = (traitees: number, total: number, echecs: number) => void;

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
  options: { forcer?: boolean; filieres?: Filiere[]; onProgres?: Progres } = {},
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
    options.onProgres?.(nbEnrichies + nbEchecs, lot.length, nbEchecs);
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
  options: {
    surfaceMinM2?: number;
    filieres?: Filiere[];
    forcer?: boolean;
    onProgres?: Progres;
  } = {},
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
    { filieres: options.filieres, forcer: options.forcer, onProgres: options.onProgres },
  );

  return { ...resultat, nbParcelles: retenues.length, dureeMs: Date.now() - debut };
}

// ---------------------------------------------------------------------------
// Qualification d'une grande emprise, en arriere-plan
// ---------------------------------------------------------------------------

/**
 * Une emprise a l'echelle de plusieurs communes represente des centaines de parcelles, soit
 * plusieurs dizaines de minutes a 4-6 secondes l'unite. Tenir une requete HTTP ouverte
 * pendant ce temps est impossible : les passerelles la couperaient, et l'utilisateur
 * n'aurait aucune visibilite. Le travail se fait donc en arriere-plan, avec un etat
 * interrogeable, comme pour l'amorcage des donnees nationales.
 */
export interface EtatQualification {
  enCours: boolean;
  /** Phase en cours, pour un message utile plutot qu'un pourcentage seul. */
  phase: 'recuperation' | 'enrichissement' | 'terminee' | 'aucune';
  /** Parcelles retenues dans l'emprise (connu apres la phase de recuperation). */
  total: number;
  traitees: number;
  echecs: number;
  debutLe: string | null;
  finLe: string | null;
  message: string | null;
  /** Estimation du temps restant, en secondes. */
  resteSecondes: number | null;
}

const etat: EtatQualification = {
  enCours: false,
  phase: 'aucune',
  total: 0,
  traitees: 0,
  echecs: 0,
  debutLe: null,
  finLe: null,
  message: null,
  resteSecondes: null,
};

export function etatQualification(): EtatQualification {
  return { ...etat };
}

/**
 * Lance la qualification d'une grande emprise et rend la main immediatement.
 *
 * Renvoie `null` si une qualification est deja en cours : en lancer deux en parallele
 * saturerait les sources publiques, limitees a une requete par seconde, et les deux
 * seraient plus lentes que l'une seule.
 */
export function lancerQualificationEmprise(
  bbox: Bbox,
  options: { surfaceMinM2?: number; filieres?: Filiere[]; forcer?: boolean } = {},
): EtatQualification | null {
  if (etat.enCours) return null;

  etat.enCours = true;
  etat.phase = 'recuperation';
  etat.total = 0;
  etat.traitees = 0;
  etat.echecs = 0;
  etat.debutLe = new Date().toISOString();
  etat.finLe = null;
  etat.resteSecondes = null;
  etat.message = 'Recuperation du parcellaire au cadastre…';

  void (async () => {
    const debut = Date.now();
    const surfaceMin = options.surfaceMinM2 ?? config.qualification.surfaceMinM2;
    try {
      const retenues = await parcellesParGrandeEmprise(bbox, {
        surfaceMinM2: surfaceMin,
        limite: config.qualification.lotMax,
        onProgres: (fait, totalCellules, trouvees) => {
          etat.message = `Recuperation du parcellaire : secteur ${fait}/${totalCellules}, ${trouvees} parcelle(s) retenue(s)`;
        },
      });

      await depotParcelles.enregistrerParcelles(retenues);

      etat.phase = 'enrichissement';
      etat.total = retenues.length;
      etat.message = `${retenues.length} parcelle(s) a qualifier`;

      const resultat = await qualifierIdus(
        retenues.map((p) => p.idu),
        {
          filieres: options.filieres,
          forcer: options.forcer,
          onProgres: (traitees, total, echecs) => {
            etat.traitees = traitees;
            etat.total = total;
            etat.echecs = echecs;
            const parParcelle = (Date.now() - debut) / Math.max(traitees, 1);
            etat.resteSecondes = Math.round(((total - traitees) * parParcelle) / 1000);
            etat.message = `Qualification : ${traitees}/${total} parcelle(s)`;
          },
        },
      );

      // Les compteurs communaux alimentent la vue nationale : sans ce rafraichissement, le
      // travail accompli reste invisible a l'echelle du departement.
      await depotScores.rafraichirCompteursCommunaux().catch((err: unknown) =>
        journal.warn({ err }, 'Rafraichissement des compteurs communaux impossible'),
      );

      etat.message =
        `${resultat.nbEnrichies} parcelle(s) qualifiee(s) sur ${retenues.length}` +
        (resultat.nbEchecs > 0 ? `, ${resultat.nbEchecs} en echec` : '');
      journal.info({ bbox, ...resultat }, 'Qualification de grande emprise terminee');
    } catch (err) {
      journal.error({ err, bbox }, 'Qualification de grande emprise interrompue');
      etat.message = `Interrompue : ${(err as Error).message}`;
    } finally {
      etat.enCours = false;
      etat.phase = 'terminee';
      etat.finLe = new Date().toISOString();
      etat.resteSecondes = null;
    }
  })();

  return etatQualification();
}

/**
 * Estime le volume d'une emprise avant de lancer quoi que ce soit, pour que l'utilisateur
 * decide en connaissance de cause. Une seule cellule est sondee et le resultat extrapole :
 * compter reellement couterait aussi cher que qualifier.
 */
export async function estimerEmprise(
  bbox: Bbox,
  surfaceMinM2?: number,
): Promise<{ nbEstime: number; dureeEstimeeMin: number; nbCellules: number }> {
  const surfaceMin = surfaceMinM2 ?? config.qualification.surfaceMinM2;
  const cellules = decouperBbox(bbox, 0.05);
  const sonde = cellules[Math.floor(cellules.length / 2)] ?? bbox;

  const lot = await parcellesParEmprise(sonde).catch(() => []);
  const retenuesSonde = lot.filter((p) => (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin);
  const nbEstime = Math.min(retenuesSonde.length * cellules.length, config.qualification.lotMax);

  // 5 secondes par parcelle : ordre de grandeur mesure, impose par la limite de debit des
  // sources publiques (1 requete/seconde cote Geoplateforme).
  return {
    nbEstime,
    dureeEstimeeMin: Math.ceil((nbEstime * 5) / 60),
    nbCellules: cellules.length,
  };
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
