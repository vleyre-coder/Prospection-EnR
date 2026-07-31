/** Routes de la fiche parcelle, de la qualification et du scoring a la volee. */

import type { FastifyInstance } from 'fastify';
import { estFiliere, AVERTISSEMENTS, type Filiere, type OptionsScoring } from '@enr/core';
import { calculerScore } from '@enr/scoring';
import { bboxDepuisChaine } from '../geo.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import * as depotProspection from '../depots/prospection.js';
import { journaliserStrict } from '../depots/sources.js';
import {
  estimerEmprise,
  etatQualification,
  lancerQualificationEmprise,
  qualifierEmprise,
  qualifierIdus,
  scorerAvecPonderation,
} from '../services/qualification.js';
import { requeteUne } from '../bdd.js';
import { erreur } from './erreurs.js';

/**
 * Au-dela de cette etendue, une emprise est traitee en arriere-plan.
 *
 * 0,02 degre carre represente environ 3 km sur 7, soit deja plusieurs dizaines de parcelles
 * exploitables et quelques minutes de traitement : c'est le point ou une requete HTTP
 * synchrone devient un mauvais choix.
 */
const SEUIL_ARRIERE_PLAN_DEG2 = 0.02;

export async function routesParcelles(app: FastifyInstance): Promise<void> {
  // --- Fiche parcelle ------------------------------------------------------
  app.get<{ Params: { idu: string } }>('/api/parcelles/:idu', async (req, rep) => {
    const q = req.query as { filiere?: string; rafraichir?: string };
    if (!estFiliere(q.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Parametre `filiere` requis et valide');
    }
    const filiere: Filiere = q.filiere;
    const idu = req.params.idu.toUpperCase();
    const forcer = q.rafraichir === 'true';

    // La parcelle est qualifiee a la demande si elle est absente du cache ou si le
    // rafraichissement est demande explicitement.
    let parcelle = await depotParcelles.parcelleParIdu(idu);
    let snapshot = parcelle ? await depotParcelles.snapshotParIdu(idu) : null;

    if (!parcelle || !snapshot || forcer) {
      await qualifierIdus([idu], { forcer, filieres: [filiere] });
      parcelle = await depotParcelles.parcelleParIdu(idu);
      snapshot = parcelle ? await depotParcelles.snapshotParIdu(idu) : null;
    }

    if (!parcelle) {
      return erreur(rep, 404, 'parcelle_introuvable', `Parcelle ${idu} introuvable au cadastre`);
    }
    if (!snapshot) {
      return erreur(
        rep,
        502,
        'enrichissement_impossible',
        "La parcelle existe mais aucune source n'a pu etre interrogee. Reessayez plus tard.",
      );
    }

    let score = await depotScores.scoreParcelle(idu, filiere);
    if (!score) {
      score = calculerScore(snapshot.snapshot, filiere);
      await depotScores.enregistrerScore(score);
    }

    const lead = await depotProspection.leadParParcelle(idu, filiere);

    return {
      parcelle: {
        idu: parcelle.idu,
        codeInsee: parcelle.codeInsee,
        nomCommune: parcelle.nomCommune,
        codeDepartement: parcelle.codeDepartement,
        section: parcelle.section,
        numero: parcelle.numero,
        prefixe: parcelle.prefixe,
        contenanceM2: parcelle.contenanceM2,
        surfaceCalculeeM2: parcelle.surfaceCalculeeM2,
        geometrie: parcelle.geometrie,
        centroide: parcelle.centroide,
        dateRecuperation: parcelle.dateRecuperation,
      },
      snapshot: snapshot.snapshot,
      score,
      lead,
      connecteursEnEchec: snapshot.connecteursEnEchec,
      avertissements: AVERTISSEMENTS,
    };
  });

  // --- Recalcul a la volee avec ponderations modifiees --------------------
  app.post<{ Params: { idu: string } }>('/api/parcelles/:idu/score', async (req, rep) => {
    const corps = req.body as {
      filiere?: string;
      ponderation?: OptionsScoring['ponderation'];
      options?: Omit<OptionsScoring, 'ponderation'>;
    };
    if (!estFiliere(corps.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    }
    const snapshot = await depotParcelles.snapshotParIdu(req.params.idu.toUpperCase());
    if (!snapshot) {
      return erreur(rep, 404, 'snapshot_absent', 'Parcelle non qualifiee : appelez /api/parcelles/:idu');
    }
    return calculerScore(snapshot.snapshot, corps.filiere, {
      ...corps.options,
      ponderation: corps.ponderation,
    });
  });

  // --- Recalcul par lot (recoloration de la carte) ------------------------
  app.post('/api/parcelles/scores', async (req, rep) => {
    const corps = req.body as {
      idus?: string[];
      filiere?: string;
      ponderation?: OptionsScoring['ponderation'];
      options?: Omit<OptionsScoring, 'ponderation'>;
    };
    if (!estFiliere(corps.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    }
    if (!Array.isArray(corps.idus) || corps.idus.length === 0) {
      return erreur(rep, 400, 'idus_manquants', 'Champ `idus` requis');
    }
    if (corps.idus.length > 3000) {
      return erreur(rep, 422, 'lot_trop_grand', 'Au maximum 3000 parcelles par appel');
    }

    const resultats = await scorerAvecPonderation(
      corps.idus.map((i) => i.toUpperCase()),
      corps.filiere,
      { ...corps.options, ponderation: corps.ponderation },
    );

    // Reponse allegee : la carte n'a besoin que du statut et du score.
    return {
      scores: Object.fromEntries(
        Object.entries(resultats).map(([idu, r]) => [
          idu,
          { statut: r.statut, scoreGlobal: r.scoreGlobal, nbKnockOuts: r.knockOuts.length },
        ]),
      ),
    };
  });

  // --- Donnees de proprietaire (RGPD : habilitation + motif + journal) ----
  app.get<{ Params: { idu: string } }>('/api/parcelles/:idu/proprietaire', async (req, rep) => {
    const utilisateur = req.utilisateur;
    if (!utilisateur?.habiliteDonneesProprietaires) {
      return erreur(
        rep,
        403,
        'non_habilite',
        "Acces aux donnees de proprietaires reserve aux utilisateurs habilites. Contactez l'administrateur.",
      );
    }
    const motif = req.headers['x-motif-acces'];
    if (typeof motif !== 'string' || motif.trim().length < 5) {
      return erreur(
        rep,
        400,
        'motif_requis',
        "Un motif d'acces circonstancie est requis (en-tete X-Motif-Acces) et sera journalise.",
      );
    }

    const idu = req.params.idu.toUpperCase();
    // Journalisation STRICTE : sans trace de l'acces, la consultation est refusee.
    await journaliserStrict('consultation_proprietaire', {
      utilisateurId: utilisateur.id,
      email: utilisateur.email,
      cible: idu,
      motif,
      adresseIp: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
    });

    const ligne = await requeteUne<{
      nb_comptes: number | null;
      indivision: boolean | null;
      proprietaire_public: boolean | null;
      nominatif: unknown;
      origine_donnee: string | null;
    }>(
      `SELECT nb_comptes, indivision, proprietaire_public, nominatif, origine_donnee
         FROM proprietaire_parcelle WHERE idu = $1`,
      [idu],
    );

    return {
      nbComptes: ligne?.nb_comptes ?? null,
      indivision: ligne?.indivision ?? null,
      proprietairePublic: ligne?.proprietaire_public ?? null,
      nominatif: ligne?.nominatif ?? null,
      origineDonnee: ligne?.origine_donnee ?? null,
      avertissement:
        "Aucune API publique n'expose legalement les donnees nominatives de propriete. Ces informations proviennent d'une demande documentee aupres de la DGFiP ou de la mairie, et leur diffusion hors du cadre de prospection declare est interdite. Cette consultation a ete journalisee.",
    };
  });

  // --- Qualification a la demande -----------------------------------------
  app.post('/api/qualification/emprise', async (req, rep) => {
    const corps = req.body as {
      bbox?: [number, number, number, number] | string;
      filiere?: string;
      surfaceMinM2?: number;
      forcer?: boolean;
      /** Force le traitement en arriere-plan, quelle que soit la taille de l'emprise. */
      arrierePlan?: boolean;
    };
    const bbox = Array.isArray(corps.bbox)
      ? corps.bbox
      : bboxDepuisChaine(String(corps.bbox ?? ''));
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Champ `bbox` requis');

    // Une emprise etendue se traite en arriere-plan : la maintenir dans une requete HTTP
    // la ferait couper par les passerelles bien avant la fin.
    const etendue = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    const enArrierePlan = corps.arrierePlan === true || etendue > SEUIL_ARRIERE_PLAN_DEG2;

    if (enArrierePlan) {
      const lance = lancerQualificationEmprise(bbox, {
        surfaceMinM2: corps.surfaceMinM2,
        filieres: estFiliere(corps.filiere) ? [corps.filiere] : undefined,
        forcer: corps.forcer,
      });
      if (!lance) {
        return erreur(
          rep,
          409,
          'qualification_en_cours',
          'Une qualification est deja en cours. Attendez sa fin : les sources publiques sont limitees en debit et deux campagnes simultanees seraient plus lentes que l\'une seule.',
        );
      }
      return { mode: 'arriere_plan', etat: lance };
    }

    const resultat = await qualifierEmprise(bbox, {
      surfaceMinM2: corps.surfaceMinM2,
      filieres: estFiliere(corps.filiere) ? [corps.filiere] : undefined,
      forcer: corps.forcer,
    });
    return { mode: 'immediat', ...resultat };
  });

  /** Avancement de la qualification en arriere-plan. */
  app.get('/api/qualification/etat', async () => etatQualification());

  /** Volume et duree previsibles d'une emprise, avant de lancer la campagne. */
  app.post('/api/qualification/estimation', async (req, rep) => {
    const corps = req.body as {
      bbox?: [number, number, number, number] | string;
      surfaceMinM2?: number;
    };
    const bbox = Array.isArray(corps.bbox)
      ? corps.bbox
      : bboxDepuisChaine(String(corps.bbox ?? ''));
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Champ `bbox` requis');
    return estimerEmprise(bbox, corps.surfaceMinM2);
  });

  app.post('/api/qualification/parcelles', async (req, rep) => {
    const corps = req.body as { idus?: string[]; filiere?: string; forcer?: boolean };
    if (!Array.isArray(corps.idus) || corps.idus.length === 0) {
      return erreur(rep, 400, 'idus_manquants', 'Champ `idus` requis');
    }
    return qualifierIdus(
      corps.idus.map((i) => i.toUpperCase()),
      { forcer: corps.forcer, filieres: estFiliere(corps.filiere) ? [corps.filiere] : undefined },
    );
  });
}
