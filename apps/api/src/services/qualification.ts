/**
 * Service de qualification : recuperation, enrichissement, scoring et persistance.
 *
 * C'est le coeur du fonctionnement a l'echelle nationale. Le parcellaire francais compte
 * environ cent millions d'objets : il n'est pas pre-ingere. Une parcelle n'entre dans la
 * base que lorsqu'un utilisateur s'en approche (zoom >= 14) ou la demande explicitement.
 * Son snapshot et ses scores sont alors materialises, puis rafraichis par lot.
 */

import { FILIERES, type Filiere, type ParcelleSnapshot, type ResultatScore } from '@enr/core';
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
import { journaliserVeille, veillerSurLot } from './veille-sources.js';
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

  // Arrondi avant comparaison. Sans lui, le test bascule sur le dernier bit de la soustraction :
  // six emprises mathematiquement identiques de 1 deg x 0,5 deg donnaient des largeurs de
  // 0,999 999 999 999 999 8 a 1,000 000 000 000 000 2, et seule celle-ci etait refusee « trop
  // vaste ». Pour l'utilisateur, la meme vue de carte etait acceptee ou refusee selon une
  // fraction de degre de panoramique, sans raison visible.
  //
  // Six decimales, soit environ 10 cm : bien en dessous de toute imprecision qui compterait sur
  // une emprise de plusieurs dizaines de kilometres, et bien au-dessus du bruit binaire.
  const etendue = Math.round((limitee[2] - limitee[0]) * (limitee[3] - limitee[1]) * 1e6) / 1e6;
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
  /**
   * Parcelles demandees mais JAMAIS TRAITEES, le plafond de lot ayant tronque la liste.
   *
   * Ce nombre etait perdu : `idus.slice(0, lotMax)` ecartait silencieusement le reste, et le resultat
   * annoncait « N parcelles qualifiees » sur le lot tronque comme s'il s'agissait de la demande. Une
   * campagne de 2 000 parcelles en rendait 1 500 et se declarait terminee.
   */
  nbIgnorees: number;
  /**
   * Parcelles vues au cadastre mais ecartees par le filtre de surface minimale, quand la qualification
   * porte sur une emprise. `0` pour une liste d'identifiants, ou aucun filtre ne s'applique.
   */
  nbEcarteesSurface: number;
  /** Surface minimale reellement appliquee, en m2. `null` pour une liste d'identifiants. */
  surfaceMinAppliqueeM2: number | null;
  /** Cellules de l'emprise dont le parcellaire n'a pas pu etre recupere. */
  cellulesEnEchec: number;
  /** Cellules de l'emprise jamais interrogees, le plafond ayant arrete la recuperation. */
  cellulesSautees: number;
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
  /**
   * Snapshots fraichement enrichis, pour la veille sur la degradation des sources.
   *
   * Les trois defauts critiques des audits 5, 6 et 7 etaient des champs devenus toujours nuls
   * sans qu'aucune erreur ne se declenche. Le seul signal qui les aurait montres est
   * l'effondrement du taux de renseignement sur un lot. Voir services/veille-sources.ts.
   */
  const pourVeille: ParcelleSnapshot[] = [];

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

      /**
       * Trois motifs de reprendre l'enrichissement, et non deux — audit 9, defaut A2.
       *
       * Le troisieme est l'arrivee de la donnee. Sans lui, une ingestion de sites proteges, de
       * ZAER ou de postes sources n'atteignait jamais les parcelles deja qualifiees : leur
       * snapshot restait valide au sens de l'age, et le rescoring par version de moteur le
       * relisait fidelement. Mesure : 438 parcelles portant un snapshot anterieur de huit heures
       * a l'ingestion des sites, et rien pour le detecter.
       */
      const doitEnrichir =
        options.forcer === true ||
        !existant ||
        depotParcelles.snapshotPerime(existant.dateSnapshot) ||
        (await depotParcelles.snapshotDepasseParDonnee(
          existant.dateSnapshot,
          enBase.codeDepartement,
        ));

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
        // Snapshots FRAICHEMENT enrichis seulement : un snapshot repris du cache ne dit rien de
        // l'etat actuel des sources, et le compter diluerait le signal.
        pourVeille.push(resultat.snapshot);
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
      //
      // `connecteursEnEchec` est transmis au moteur, et pas seulement journalise : sans lui, une
      // valeur laissee par un connecteur en echec serait notee comme une mesure (audit 8, B3).
      const scores = filieres.map((f) =>
        calculerScore(snapshot!, f, { connecteursEnEchec: echecs }),
      );
      await depotScores.enregistrerScores(scores);

      nbEnrichies += 1;
    } catch (err) {
      journal.warn({ err, idu }, 'Echec de qualification de parcelle');
      nbEchecs += 1;
    }
    options.onProgres?.(nbEnrichies + nbEchecs, lot.length, nbEchecs);
  }

  // Veille sur la degradation silencieuse des sources : un champ tombe a zero sur tout un lot
  // signale un contrat rompu, meme si chaque service a repondu HTTP 200. C'est le signal qui
  // manquait aux audits 5, 6 et 7 — trois defauts critiques ou rien ne s'est allume.
  journaliserVeille(veillerSurLot(pourVeille));

  return {
    nbParcelles: lot.length,
    nbEnrichies,
    nbEchecs,
    dureeMs: Date.now() - debut,
    echecsParConnecteur,
    nbIgnorees: idus.length - lot.length,
    nbEcarteesSurface: 0,
    surfaceMinAppliqueeM2: null,
    cellulesEnEchec: 0,
    cellulesSautees: 0,
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
  // Verrou de bordure : un service peut renvoyer des objets debordant l'emprise demandee. La zone de
  // travail affichee doit rester la seule limite.
  const dansEmprise = brutes.filter((p) => pointDansBbox(p.centroide, emprise));
  const retenues = dansEmprise.filter(
    (p) => (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin,
  );
  // Ecartees par le FILTRE DE SURFACE, et comptees comme telles : c'est plus de la moitie du
  // parcellaire dans certaines regions, et le resultat ne le disait pas.
  const ecarteesSurface = dansEmprise.length - retenues.length;

  journal.info(
    { bbox: emprise, trouvees: brutes.length, retenues: retenues.length, ecarteesSurface, surfaceMin },
    "Qualification d'emprise",
  );

  await depotParcelles.enregistrerParcelles(retenues);

  const resultat = await qualifierIdus(
    retenues.map((p) => p.idu),
    { filieres: options.filieres, forcer: options.forcer, onProgres: options.onProgres },
  );

  return {
    ...resultat,
    nbParcelles: retenues.length,
    dureeMs: Date.now() - debut,
    nbEcarteesSurface: ecarteesSurface,
    surfaceMinAppliqueeM2: surfaceMin,
  };
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
  /**
   * CE QUE LA CAMPAGNE N'A PAS COUVERT, et qu'aucun champ ne disait.
   *
   * Trois troncatures s'appliquaient en silence : le filtre de surface, le plafond de lot, et les
   * cellules dont la recuperation echouait (journalisees en avertissement seulement). Une campagne
   * partielle etait donc indistinguable d'une campagne complete, et un secteur non regarde se lisait
   * comme un secteur sans interet. `null` avant la fin de la phase de recuperation.
   */
  couverture: CouvertureCampagne | null;
}

/** Ce qu'une campagne a laisse de cote — voir `EtatQualification.couverture`. */
export interface CouvertureCampagne {
  /** Parcelles vues au cadastre mais ecartees par le filtre de surface minimale. */
  ecarteesSurface: number;
  /** Surface minimale appliquee, en m2 : le nombre n'a de sens qu'accompagne du seuil. */
  surfaceMinM2: number;
  /** Cellules dont le parcellaire n'a pas pu etre recupere : leur contenu manque. */
  cellulesEnEchec: number;
  /** Cellules jamais interrogees, le plafond de lot ayant arrete la recuperation. */
  cellulesSautees: number;
  cellulesTotal: number;
  /** Vrai si le plafond de lot a interrompu la recuperation avant la fin de l'emprise. */
  plafondAtteint: boolean;
  /** Parcelles retenues puis tronquees par le plafond de lot, jamais qualifiees. */
  ignoreesPlafond: number;
  /**
   * Phrase prete a afficher, ou `null` si la couverture est complete.
   *
   * Construite ici et non dans l'interface : c'est le service qui sait ce qui a ete tronque, et une
   * regle de formulation ecrite deux fois se corrige une fois sur deux.
   */
  avertissement: string | null;
}

/** Formule ce qui manque a une campagne, en une phrase, ou `null` si rien ne manque. */
export function avertissementCouverture(c: Omit<CouvertureCampagne, 'avertissement'>): string | null {
  const morceaux: string[] = [];
  if (c.ecarteesSurface > 0) {
    morceaux.push(
      `${c.ecarteesSurface} parcelle(s) ecartee(s) car plus petite(s) que ` +
        `${(c.surfaceMinM2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`,
    );
  }
  if (c.cellulesEnEchec > 0) {
    morceaux.push(
      `${c.cellulesEnEchec} secteur(s) sur ${c.cellulesTotal} non recupere(s) : leur parcellaire manque`,
    );
  }
  if (c.plafondAtteint) {
    morceaux.push(
      `plafond de lot atteint, ${c.cellulesSautees} secteur(s) sur ${c.cellulesTotal} pas interroge(s)`,
    );
  }
  if (c.ignoreesPlafond > 0) {
    morceaux.push(`${c.ignoreesPlafond} parcelle(s) retenue(s) mais non qualifiee(s), faute de place`);
  }
  if (morceaux.length === 0) return null;
  return (
    `Couverture incomplete : ${morceaux.join(' ; ')}. ` +
    'Une parcelle precise peut toujours etre qualifiee en la cliquant sur le cadastre, ou par sa ' +
    'reference dans la recherche.'
  );
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
  couverture: null,
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
  /** Identifiant de la ligne `demande_qualification`, en texte pour l'exposition HTTP. */
  id: string;
  bbox: Bbox;
  options: OptionsCampagne;
  demandeeLe: string;
  nbParcellesEstime: number | null;
}

/**
 * File en memoire, DOUBLEE d'une trace en base.
 *
 * La memoire sert au fonctionnement — elle est synchrone, donc `demarrerSuivanteSiLibre` reste
 * atomique et deux campagnes ne peuvent pas partir en meme temps. La base sert a la SURVIE : au
 * redemarrage, `restaurerFile` recharge ce qui n'avait pas demarre. Sans elle, trois demandes
 * acceptees disparaissaient sans le dire a personne.
 */
const file: Attente[] = [];

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
       FROM tache_qualification ORDER BY debut_le DESC, id DESC LIMIT 1`,
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
export async function lancerQualificationEmprise(
  bbox: Bbox,
  options: OptionsCampagne = {},
): Promise<IssueDemande> {
  const emprise = normaliserEmprise(bbox);

  if (file.length >= FILE_MAX) {
    return { accepte: false, motif: 'file_pleine', etat: etatQualification() };
  }

  // Trace en base AVANT la mise en file : une demande acceptee doit survivre a un redemarrage,
  // et il vaut mieux une ligne orpheline (nettoyee au demarrage suivant) qu'une demande acceptee
  // dont il ne reste rien.
  const id = await enregistrerDemande(emprise, options);

  const demande: Attente = {
    id,
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
  // Volontairement sans `await` : le marquage est de la tracabilite, pas une condition du
  // demarrage. `demarrerSuivanteSiLibre` doit rester SYNCHRONE de bout en bout, sinon deux
  // appels concurrents pourraient franchir la garde `etat.enCours` avant que l'un ne la pose.
  void marquerDemarree(demande.id);
  executerCampagne(demande);
}

// ---------------------------------------------------------------------------
// Persistance de la file
// ---------------------------------------------------------------------------

/**
 * Enregistre une demande acceptee et rend son identifiant.
 *
 * Un echec d'ecriture ne refuse PAS la demande : le travail est plus utile que sa trace, et
 * l'application entiere est construite sur ce principe (cf. `ouvrirTache`). On perd alors la
 * durabilite pour cette demande-la, ce que le journal signale.
 */
async function enregistrerDemande(bbox: Bbox, options: OptionsCampagne): Promise<string> {
  const lignes = await requete<{ id: string }>(
    `INSERT INTO demande_qualification (bbox, options, utilisateur_id)
     VALUES ($1, $2, $3) RETURNING id::text`,
    [
      JSON.stringify(bbox),
      JSON.stringify({
        surfaceMinM2: options.surfaceMinM2 ?? null,
        filieres: options.filieres ?? null,
        forcer: options.forcer ?? null,
      }),
      options.utilisateurId ?? null,
    ],
  ).catch((err: unknown) => {
    journal.warn(
      { err },
      'Demande de qualification non tracee en base : elle ne survivra pas a un redemarrage',
    );
    return [] as Array<{ id: string }>;
  });
  // `mem:` prefixe les identifiants sans trace en base, pour que `marquerDemarree` ne tente pas
  // une mise a jour sur une ligne inexistante.
  return lignes[0]?.id ?? `mem:${Date.now()}`;
}

async function marquerDemarree(id: string): Promise<void> {
  if (id.startsWith('mem:')) return;
  await requete(
    `UPDATE demande_qualification SET demarree_le = now() WHERE id = $1::bigint`,
    [id],
  ).catch(() => undefined);
}

/**
 * Recharge la file depuis la base, au demarrage.
 *
 * A appeler APRES `signalerCampagnesInterrompues` : une demande dont la campagne avait demarre
 * porte `demarree_le` et ne doit pas repartir, c'est la campagne interrompue qui la represente.
 * Seules les demandes jamais demarrees reviennent dans la file.
 *
 * Retourne le nombre de demandes restaurees, pour que le demarrage le journalise.
 */
export async function restaurerFile(): Promise<number> {
  const lignes = await requete<{
    id: string;
    bbox: Bbox;
    options: { surfaceMinM2: number | null; filieres: Filiere[] | null; forcer: boolean | null };
    utilisateur_id: string | null;
    demandee_le: string;
  }>(
    `SELECT id::text, bbox, options, utilisateur_id, demandee_le
       FROM demande_qualification
      WHERE demarree_le IS NULL AND abandonnee_le IS NULL
      -- Departage par l'identifiant : deux demandes acceptees dans la meme milliseconde
      -- doivent repartir dans l'ordre ou elles ont ete acceptees, pas dans un ordre arbitraire.
      ORDER BY demandee_le, id
      LIMIT $1`,
    [FILE_MAX],
  ).catch((err: unknown) => {
    journal.warn({ err }, "Restauration de la file de qualification impossible");
    return [] as never[];
  });

  for (const l of lignes) {
    file.push({
      id: l.id,
      bbox: l.bbox,
      options: {
        surfaceMinM2: l.options?.surfaceMinM2 ?? undefined,
        filieres: l.options?.filieres ?? undefined,
        forcer: l.options?.forcer ?? undefined,
        utilisateurId: l.utilisateur_id,
      },
      demandeeLe: l.demandee_le,
      nbParcellesEstime: null,
    });
  }

  /**
   * Au-dela de FILE_MAX, les demandes excedentaires sont ABANDONNEES explicitement.
   *
   * Les garder en base sans les charger reviendrait a recreer le probleme que cette table
   * corrige : une demande acceptee dont il ne se passe plus rien. Le motif est ecrit, pour que
   * l'utilisateur sache pourquoi.
   */
  await requete(
    `UPDATE demande_qualification
        SET abandonnee_le = now(),
            motif_abandon = 'File pleine au redemarrage : demande au-dela des '
                            || $1 || ' plus anciennes. A relancer.'
      WHERE demarree_le IS NULL AND abandonnee_le IS NULL
        AND id::text <> ALL($2::text[])`,
    [FILE_MAX, lignes.map((l) => l.id)],
  ).catch(() => undefined);

  if (lignes.length > 0) {
    journal.info(
      { restaurees: lignes.length },
      'Demandes de qualification restaurees depuis la base : la file reprend ou elle en etait',
    );
    demarrerSuivanteSiLibre();
  }
  return lignes.length;
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
  // Remise a zero : sans elle, la couverture incomplete d'une campagne precedente resterait affichee
  // pendant la suivante, ce qui est pire qu'aucune information.
  etat.couverture = null;
  etat.message =
    file.length > 0
      ? `Recuperation du parcellaire au cadastre… (${file.length} demande(s) ensuite)`
      : 'Recuperation du parcellaire au cadastre…';

  void (async () => {
    const debut = Date.now();
    await ouvrirTache(emprise, options.utilisateurId ?? null);
    const surfaceMin = options.surfaceMinM2 ?? config.qualification.surfaceMinM2;
    try {
      const recuperation = await parcellesParGrandeEmprise(emprise, {
        surfaceMinM2: surfaceMin,
        limite: config.qualification.lotMax,
        onProgres: (fait, totalCellules, trouvees) => {
          etat.message = `Recuperation du parcellaire : secteur ${fait}/${totalCellules}, ${trouvees} parcelle(s) retenue(s)`;
          void reporterTache();
        },
      });
      const brutes = recuperation.parcelles;

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

      /**
       * LA COUVERTURE EST PUBLIEE DES LA FIN DE LA RECUPERATION, et non a la fin de la campagne.
       *
       * Une campagne dure des dizaines de minutes : savoir des le debut que la moitie du parcellaire a
       * ete ecartee, ou que trois secteurs manquent, permet de l'arreter et de relancer autrement.
       * L'apprendre a la fin ne sert plus a rien.
       */
      const ignoreesPlafond = Math.max(0, retenues.length - config.qualification.lotMax);
      const sansPhrase = {
        ecarteesSurface: recuperation.ecarteesSurface,
        surfaceMinM2: surfaceMin,
        cellulesEnEchec: recuperation.cellulesEnEchec,
        cellulesSautees: recuperation.cellulesSautees,
        cellulesTotal: recuperation.cellulesTotal,
        plafondAtteint: recuperation.plafondAtteint,
        ignoreesPlafond,
      };
      etat.couverture = { ...sansPhrase, avertissement: avertissementCouverture(sansPhrase) };
      if (etat.couverture.avertissement) {
        journal.warn(
          { bbox: emprise, ...sansPhrase },
          'Campagne a couverture incomplete : les troncatures sont remontees a l’utilisateur',
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
        (resultat.nbEchecs > 0 ? `, ${resultat.nbEchecs} en echec` : '') +
        // La couverture est rappelee dans le message final : le bandeau de suivi disparait, le
        // message reste, et c'est lui que l'utilisateur lit avant de conclure sur son secteur.
        (etat.couverture?.avertissement ? `. ${etat.couverture.avertissement}` : '');
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
): Promise<{
  nbEstime: number;
  dureeEstimeeMin: number;
  nbCellules: number;
  /**
   * Parcelles que le FILTRE DE SURFACE ecartera, extrapolees depuis la sonde.
   *
   * L'estimation annoncait « environ N parcelles a qualifier » sans dire qu'un filtre en retirait
   * d'abord une part — plus de la moitie du parcellaire dans certaines regions. L'utilisateur
   * approuvait donc une campagne dont il ignorait le perimetre reel.
   */
  nbEcarteesEstime: number;
  /** Surface minimale appliquee, en m2 : le nombre ci-dessus n'a de sens qu'avec le seuil. */
  surfaceMinM2: number;
  /** Vrai si l'estimation atteint le plafond de lot : la campagne ne couvrira pas toute l'emprise. */
  plafonne: boolean;
}> {
  const surfaceMin = surfaceMinM2 ?? config.qualification.surfaceMinM2;
  const emprise = normaliserEmprise(bbox);
  const cellules = decouperBbox(emprise, 0.05);
  const sonde = cellules[Math.floor(cellules.length / 2)] ?? emprise;

  const lot = await parcellesParEmprise(sonde).catch(() => []);
  const retenuesSonde = lot.filter((p) => (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin);
  const brut = retenuesSonde.length * cellules.length;
  const nbEstime = Math.min(brut, config.qualification.lotMax);

  // 5 secondes par parcelle : ordre de grandeur mesure, impose par la limite de debit des
  // sources publiques (1 requete/seconde cote Geoplateforme).
  return {
    nbEstime,
    dureeEstimeeMin: Math.ceil((nbEstime * 5) / 60),
    nbCellules: cellules.length,
    nbEcarteesEstime: (lot.length - retenuesSonde.length) * cellules.length,
    surfaceMinM2: surfaceMin,
    plafonne: brut > config.qualification.lotMax,
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
    out[idu] = calculerScore(s.snapshot, filiere, {
      ...ponderation,
      connecteursEnEchec: s.connecteursEnEchec,
    });
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
    // Les echecs sont conserves avec le snapshot : un rescoring hors ligne doit les respecter,
    // sinon un recalcul redonnerait une note a un critere dont la source avait echoue.
    const scores = filieres.map((f) =>
      calculerScore(s.snapshot, f, { connecteursEnEchec: s.connecteursEnEchec }),
    );
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
