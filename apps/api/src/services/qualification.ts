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
import { requete } from '../bdd.js';
import { decouperBbox, limiterAlaFrance, pointDansBbox, type Bbox } from '../geo.js';
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

/** Levee lorsque l'emprise demandee ne peut pas etre exploitee. */
export class ErreurEmprise extends Error {}

/**
 * Ramene une emprise a quelque chose d'exploitable, ou refuse.
 *
 * Trois garde-fous, chacun repondant a un incident constate : une qualification lancee
 * depuis une vue large avait porte sur des parcelles situees a des dizaines de kilometres
 * de la zone de travail.
 *
 *   1. **Bornes valides.** MapLibre peut renvoyer des longitudes hors de [-180, 180] en vue
 *      tres large (copies du monde), ce qui produit une emprise absurde.
 *   2. **Limitation au territoire.** L'application ne couvre que la France metropolitaine :
 *      toute portion d'emprise en dehors est ecartee au lieu d'etre interrogee.
 *   3. **Etendue maximale.** Au-dela, l'utilisateur ne travaille plus sur un secteur mais
 *      balaye une region : le refus est explicite plutot que silencieusement tronque.
 */
export function normaliserEmprise(bbox: Bbox): Bbox {
  const [ouest, sud, est, nord] = bbox;
  if (![ouest, sud, est, nord].every(Number.isFinite) || ouest >= est || sud >= nord) {
    throw new ErreurEmprise("L'emprise demandee est invalide.");
  }

  const limitee = limiterAlaFrance(bbox);
  if (!limitee) {
    throw new ErreurEmprise(
      "L'emprise affichee ne recoupe pas la France metropolitaine, seul territoire couvert.",
    );
  }

  const etendue = (limitee[2] - limitee[0]) * (limitee[3] - limitee[1]);
  if (etendue > ETENDUE_MAX_DEG2) {
    throw new ErreurEmprise(
      "L'emprise affichee est trop vaste pour une qualification : zoomez sur votre zone de travail. " +
        "A cette echelle, le nombre de parcelles depasse ce qu'il est raisonnable d'interroger.",
    );
  }

  return limitee;
}

/**
 * Etendue maximale d'une qualification, en degres carres.
 *
 * 0,5 deg2 represente environ 55 km sur 70, soit un large canton ou un petit departement :
 * la plus grande zone de travail plausible. Au-dela, c'est une erreur de manipulation.
 */
const ETENDUE_MAX_DEG2 = 0.5;

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
  const emprise = normaliserEmprise(bbox);

  const brutes = await parcellesParEmprise(emprise);
  const retenues = brutes.filter(
    (p) =>
      (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin &&
      // Verrou de bordure : un service peut renvoyer des objets debordant l'emprise
      // demandee. La zone de travail affichee doit rester la seule limite.
      pointDansBbox(p.centroide, emprise),
  );

  journal.info(
    { bbox: emprise, trouvees: brutes.length, retenues: retenues.length, surfaceMin },
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
  /**
   * Demandes en attente, dans l'ordre ou elles seront traitees.
   *
   * Les sources publiques sont limitees a une requete par seconde : deux campagnes
   * simultanees ne vont pas deux fois plus vite, elles se partagent le meme debit. La
   * concurrence n'a donc pas de sens ici — mais REFUSER la seconde demande n'en avait pas
   * davantage. L'utilisateur devait revenir toutes les dix minutes voir si la voie etait
   * libre, sans savoir combien de temps il restait ni qui occupait la place.
   */
  fileAttente: DemandeEnAttente[];
}

/** Demande de qualification acceptee mais pas encore demarree. */
export interface DemandeEnAttente {
  id: string;
  /** Rang dans la file, 1 = prochaine a demarrer. */
  position: number;
  demandeeLe: string;
  /** Auteur, pour que chacun reconnaisse sa demande dans la file. */
  utilisateurId: string | null;
  bbox: Bbox;
  nbParcellesEstime: number | null;
}

const etat: Omit<EtatQualification, 'fileAttente'> = {
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

/**
 * Demandes acceptees, non encore demarrees. Traitees en FIFO.
 *
 * Bornee : au-dela, la demande est refusee explicitement plutot que d'accumuler des
 * campagnes que personne n'attend plus. Une file de cinq emprises departementales
 * represente deja plusieurs heures de travail.
 */
const FILE_MAX = 5;

interface Attente {
  id: string;
  bbox: Bbox;
  options: OptionsCampagne;
  demandeeLe: string;
  nbParcellesEstime: number | null;
}

const file: Attente[] = [];
let compteurDemandes = 0;

export function etatQualification(): EtatQualification {
  return {
    ...etat,
    fileAttente: file.map((a, i) => ({
      id: a.id,
      position: i + 1,
      demandeeLe: a.demandeeLe,
      utilisateurId: a.options.utilisateurId ?? null,
      bbox: a.bbox,
      nbParcellesEstime: a.nbParcellesEstime,
    })),
  };
}

/**
 * Identifiant de la campagne en cours en base, pour y reporter l'avancement.
 * `null` hors campagne.
 */
let tacheId: number | null = null;
let dernierReport = 0;

/** Ouvre une trace de campagne. Un echec d'ecriture ne doit pas empecher le travail. */
async function ouvrirTache(bbox: Bbox, utilisateurId: string | null): Promise<void> {
  const lignes = await requete<{ id: number }>(
    `INSERT INTO tache_qualification (bbox, utilisateur_id) VALUES ($1, $2) RETURNING id`,
    [JSON.stringify(bbox), utilisateurId],
  ).catch((err: unknown) => {
    journal.warn({ err }, "Trace de campagne impossible : le travail se poursuit sans");
    return [] as Array<{ id: number }>;
  });
  tacheId = lignes[0]?.id ?? null;
  dernierReport = 0;
}

/**
 * Reporte l'avancement en base, au plus une fois toutes les deux secondes.
 *
 * Sans cette limitation, une campagne de 500 parcelles produirait 500 ecritures pour un
 * besoin d'affichage : la trace sert a savoir ou en etait le travail, pas a le compter au
 * centieme.
 */
async function reporterTache(force = false): Promise<void> {
  if (tacheId == null) return;
  const maintenant = Date.now();
  if (!force && maintenant - dernierReport < 2000) return;
  dernierReport = maintenant;
  await requete(
    `UPDATE tache_qualification
        SET phase = $2, total = $3, traitees = $4, echecs = $5, message = $6
      WHERE id = $1`,
    [tacheId, etat.phase === 'aucune' ? 'recuperation' : etat.phase, etat.total, etat.traitees, etat.echecs, etat.message],
  ).catch(() => undefined);
}

async function cloturerTache(): Promise<void> {
  if (tacheId == null) return;
  await requete(
    `UPDATE tache_qualification
        SET phase = 'terminee', total = $2, traitees = $3, echecs = $4, message = $5,
            fin_le = now()
      WHERE id = $1`,
    [tacheId, etat.total, etat.traitees, etat.echecs, etat.message],
  ).catch(() => undefined);
  tacheId = null;
}

/**
 * Marque comme interrompues les campagnes restees ouvertes.
 *
 * A appeler au demarrage : une campagne sans date de fin signifie que le processus s'est
 * arrete en cours de route. Le travail deja accompli est conserve - les parcelles qualifiees
 * sont en base - mais l'utilisateur doit savoir que le lot n'est pas complet, sans quoi il
 * conclura a tort que son secteur a ete entierement traite.
 */
export async function signalerCampagnesInterrompues(): Promise<number> {
  const lignes = await requete<{ id: number }>(
    `UPDATE tache_qualification
        SET interrompue = true, fin_le = now(),
            message = COALESCE(message, '') || ' [interrompue par un arret du serveur]'
      WHERE fin_le IS NULL
      RETURNING id`,
  ).catch(() => [] as Array<{ id: number }>);
  if (lignes.length > 0) {
    journal.warn(
      { campagnes: lignes.length },
      'Campagnes de qualification interrompues par un arret precedent : les lots concernes sont incomplets',
    );
  }
  return lignes.length;
}

/** Derniere campagne connue, pour informer l'utilisateur apres un redemarrage. */
export async function derniereCampagne(): Promise<{
  debutLe: string;
  finLe: string | null;
  total: number;
  traitees: number;
  echecs: number;
  interrompue: boolean;
  message: string | null;
} | null> {
  const lignes = await requete<{
    debut_le: string;
    fin_le: string | null;
    total: number;
    traitees: number;
    echecs: number;
    interrompue: boolean;
    message: string | null;
  }>(
    `SELECT debut_le, fin_le, total, traitees, echecs, interrompue, message
       FROM tache_qualification ORDER BY debut_le DESC LIMIT 1`,
  ).catch(() => []);
  const l = lignes[0];
  if (!l) return null;
  return {
    debutLe: l.debut_le,
    finLe: l.fin_le,
    total: l.total,
    traitees: l.traitees,
    echecs: l.echecs,
    interrompue: l.interrompue,
    message: l.message,
  };
}

export interface OptionsCampagne {
  surfaceMinM2?: number;
  filieres?: Filiere[];
  forcer?: boolean;
  /** Auteur de la demande, trace en base pour savoir qui consomme le quota partage. */
  utilisateurId?: string | null;
}

/** Issue d'une demande de qualification en arriere-plan. */
export type IssueDemande =
  | { accepte: true; id: string; position: number; etat: EtatQualification }
  | { accepte: false; motif: 'file_pleine'; etat: EtatQualification };

/**
 * Accepte une demande de qualification de grande emprise et rend la main immediatement.
 *
 * UNE SEULE CAMPAGNE S'EXECUTE A LA FOIS, et ce n'est pas une limitation technique a lever :
 * les sources publiques plafonnent a une requete par seconde, donc deux campagnes
 * simultanees se partagent le meme debit et finissent toutes deux plus tard que l'une seule
 * n'aurait fini. La serialisation est le bon comportement.
 *
 * Ce qui etait faux, c'etait de REFUSER la seconde demande. Un second utilisateur recevait un
 * 409 et devait revenir a l'aveugle, sans savoir ni ce qui tournait, ni combien de temps il
 * restait. Sa demande est desormais mise en file et demarre seule a la fin de la precedente.
 *
 * L'emprise est normalisee ICI, avant la mise en file : une emprise irrecevable doit lever
 * tout de suite, et non echouer une heure plus tard au fond de la file.
 */
export function lancerQualificationEmprise(bbox: Bbox, options: OptionsCampagne = {}): IssueDemande {
  const emprise = normaliserEmprise(bbox);

  if (file.length >= FILE_MAX) {
    return { accepte: false, motif: 'file_pleine', etat: etatQualification() };
  }

  compteurDemandes += 1;
  const demande: Attente = {
    id: `q${compteurDemandes}`,
    bbox: emprise,
    options,
    demandeeLe: new Date().toISOString(),
    nbParcellesEstime: null,
  };
  file.push(demande);
  demarrerSuivanteSiLibre();

  // `demarrerSuivanteSiLibre` retire de la file la demande qu'elle demarre : si la notre n'y
  // est plus, c'est qu'elle tourne. Sinon, sa position est son rang courant.
  const rang = file.indexOf(demande);
  return {
    accepte: true,
    id: demande.id,
    position: rang === -1 ? 0 : rang + 1,
    etat: etatQualification(),
  };
}

/**
 * Demarre la prochaine demande si aucune campagne n'occupe le debit.
 *
 * Appelee a la mise en file et a la fin de chaque campagne : c'est le seul point qui fait
 * avancer la file, ce qui evite deux campagnes lancees par deux chemins differents.
 */
function demarrerSuivanteSiLibre(): void {
  if (etat.enCours) return;
  const demande = file.shift();
  if (!demande) return;
  executerCampagne(demande);
}

function executerCampagne(demande: Attente): void {
  const emprise = demande.bbox;
  const options = demande.options;

  etat.enCours = true;
  etat.phase = 'recuperation';
  etat.total = 0;
  etat.traitees = 0;
  etat.echecs = 0;
  etat.debutLe = new Date().toISOString();
  etat.finLe = null;
  etat.resteSecondes = null;
  etat.message =
    file.length > 0
      ? `Recuperation du parcellaire au cadastre… (${file.length} demande(s) ensuite)`
      : 'Recuperation du parcellaire au cadastre…';

  void (async () => {
    const debut = Date.now();
    await ouvrirTache(emprise, options.utilisateurId ?? null);
    const surfaceMin = options.surfaceMinM2 ?? config.qualification.surfaceMinM2;
    try {
      const brutes = await parcellesParGrandeEmprise(emprise, {
        surfaceMinM2: surfaceMin,
        limite: config.qualification.lotMax,
        onProgres: (fait, totalCellules, trouvees) => {
          etat.message = `Recuperation du parcellaire : secteur ${fait}/${totalCellules}, ${trouvees} parcelle(s) retenue(s)`;
          void reporterTache();
        },
      });

      // Verrou de bordure : les cellules de la grille se recouvrent et un service peut
      // renvoyer des objets debordant l'emprise. Seules les parcelles dont le centroide est
      // dans la zone affichee sont qualifiees.
      const retenues = brutes.filter((p) => pointDansBbox(p.centroide, emprise));
      if (retenues.length < brutes.length) {
        journal.debug(
          { ecartees: brutes.length - retenues.length },
          'Parcelles hors emprise ecartees',
        );
      }

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
            void reporterTache();
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
      journal.info({ bbox: emprise, ...resultat }, 'Qualification de grande emprise terminee');
    } catch (err) {
      journal.error({ err, bbox: emprise }, 'Qualification de grande emprise interrompue');
      etat.message = `Interrompue : ${(err as Error).message}`;
    } finally {
      etat.enCours = false;
      etat.phase = 'terminee';
      etat.finLe = new Date().toISOString();
      etat.resteSecondes = null;
      await cloturerTache();

      // Sans cet appel, une demande mise en file n'aurait jamais demarre. Il est dans le
      // `finally` a dessein : une campagne interrompue par une erreur ne doit pas bloquer
      // la file derriere elle.
      if (file.length > 0) {
        journal.info(
          { restantes: file.length },
          'Campagne terminee, demarrage de la demande suivante',
        );
      }
      demarrerSuivanteSiLibre();
    }
  })();
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
  const emprise = normaliserEmprise(bbox);
  const cellules = decouperBbox(emprise, 0.05);
  const sonde = cellules[Math.floor(cellules.length / 2)] ?? emprise;

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

/**
 * Recalcul par batch, apres mise a jour de donnees ou changement de version du moteur.
 *
 * Le recalcul part des snapshots deja stockes : aucune source n'est reinterrogee, ce qui
 * rend l'operation rapide et hors ligne. La population traitee est celle des parcelles
 * disposant d'un snapshot et privees de score a la version courante - et non celle des
 * parcelles dont la donnee est perimee, qui est un tout autre ensemble.
 */
export async function rescorerTout(
  filieres: Filiere[] = [...FILIERES],
  limite = 5000,
): Promise<{ nbParcelles: number; nbScores: number }> {
  // L'ordre importe : on selectionne AVANT de supprimer. Une parcelle dont le score
  // obsolete vient d'etre efface doit se retrouver dans la liste a recalculer, faute de
  // quoi elle sort de la carte et des listes sans que personne ne s'en apercoive.
  const idus = await depotParcelles.idusSansScoreCourant(VERSION_MOTEUR, limite);

  let nbScores = 0;
  for (const idu of idus) {
    const s = await depotParcelles.snapshotParIdu(idu);
    if (!s) continue;
    const scores = filieres.map((f) => calculerScore(s.snapshot, f));
    await depotScores.enregistrerScores(scores);
    nbScores += scores.length;
  }

  // Le menage ne vient qu'ensuite, et seulement sur ce qui reste d'une version anterieure :
  // les lignes recalculees ci-dessus portent desormais la version courante.
  const invalides = await depotScores.invaliderVersionsAnterieures(VERSION_MOTEUR);
  if (invalides > 0) {
    journal.info({ invalides, version: VERSION_MOTEUR }, 'Scores obsoletes supprimes');
  }

  return { nbParcelles: idus.length, nbScores };
}

/**
 * Recalcule au demarrage les scores laisses par une version anterieure du moteur.
 *
 * Sans cela, une correction du moteur reste invisible : la carte, les listes et les exports
 * continuent d'afficher des statuts calcules par la version corrigee. L'utilisateur n'a
 * aucun moyen de le savoir - le score ne porte pas sa date - et n'a aucune raison de penser
 * a lancer un script de recalcul.
 */
export async function rescorerSiVersionObsolete(): Promise<void> {
  const obsoletes = await depotParcelles.nbScoresObsoletes(VERSION_MOTEUR);
  if (obsoletes === 0) return;

  journal.info(
    { obsoletes, version: VERSION_MOTEUR },
    'Version du moteur modifiee : recalcul des scores a partir des snapshots stockes',
  );

  // Par lots, jusqu'a epuisement : la selection ne renvoie que ce qui reste a faire, donc
  // un lot sans progression signifie qu'il n'y a plus rien a traiter (ou que les snapshots
  // manquent) et arrete la boucle.
  let total = 0;
  for (;;) {
    const { nbParcelles, nbScores } = await rescorerTout(undefined, 500);
    // `nbScores === 0` avec des parcelles selectionnees signale un lot dont les snapshots
    // sont introuvables : le meme lot reviendrait indefiniment.
    if (nbParcelles === 0 || nbScores === 0) break;
    total += nbParcelles;
  }

  // Les compteurs communaux alimentent la vue nationale : ils sont derives des scores et
  // doivent suivre, sinon la France reste coloriee par l'ancien moteur.
  await requete(`SELECT rafraichir_compteurs_communaux()`).catch((err: unknown) =>
    journal.warn({ err }, 'Rafraichissement des compteurs communaux impossible'),
  );

  journal.info({ parcelles: total, version: VERSION_MOTEUR }, 'Recalcul des scores termine');
}
