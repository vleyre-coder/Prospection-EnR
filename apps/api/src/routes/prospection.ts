/** Routes du pipeline de prospection : leads, sites, tableau de bord. */

import type { FastifyInstance } from 'fastify';
import {
  estFiliere,
  FILIERES,
  STATUTS_PROSPECTION,
  type Filiere,
  type StatutProspection,
} from '@enr/core';
import { calculerScoreSite } from '@enr/scoring';
import * as depot from '../depots/prospection.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import { journaliser } from '../depots/sources.js';
import { erreur } from './erreurs.js';
import { entierRequete, lecteur } from '../validation.js';

/** Types d'evenement d'un lead. Liste fermee, partagee entre la validation et le depot. */
const TYPES_EVENEMENT = ['contact', 'note', 'document'] as const;

/** Un site regroupe des parcelles voisines : la borne evite un scoring consolide non borne. */
const MAX_PARCELLES_PAR_SITE = 500;

/** Forme d'un identifiant UUID, celle que produit la base pour les leads et les sites. */
const MOTIF_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function estStatut(v: unknown): v is StatutProspection {
  return typeof v === 'string' && (STATUTS_PROSPECTION as readonly string[]).includes(v);
}

export async function routesProspection(app: FastifyInstance): Promise<void> {
  // --- Leads ---------------------------------------------------------------
  app.get('/api/leads', async (req) => {
    const q = req.query as { filiere?: string; statut?: string; assigneA?: string; limite?: string };
    return depot.listerLeads({
      filiere: estFiliere(q.filiere) ? q.filiere : undefined,
      statuts: q.statut?.split(',').filter(estStatut),
      assigneA: q.assigneA,
      limite: entierRequete(q.limite, 'limite', { defaut: 200, min: 1, max: 1000 }),
    });
  });

  app.get<{ Params: { id: string } }>('/api/leads/:id', async (req, rep) => {
    const lead = await depot.leadParId(req.params.id);
    if (!lead) return erreur(rep, 404, 'lead_introuvable', 'Lead introuvable');
    return lead;
  });

  app.post('/api/leads', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre role ne permet pas de modifier le pipeline');
    }
    const c = lecteur(req.body);
    const filiere = c.parmi('filiere', FILIERES);
    const idu = c.idu('idu');
    const siteId = c.texte('siteId', { max: 64, motif: MOTIF_UUID, description: 'identifiant UUID' });
    const statut = c.parmi('statut', STATUTS_PROSPECTION);
    const notes = c.texteOuVide('notes', { max: 5000 });
    // Toute cle non lue est refusee : un champ mal orthographie serait sinon ignore en silence, et
    // l'appelant croirait avoir renseigne une note ou un statut qui n'a jamais ete enregistre.
    c.refuserInconnus();

    if (!filiere) return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    if (!idu && !siteId) return erreur(rep, 400, 'cible_manquante', 'Champ `idu` ou `siteId` requis');
    if (idu && siteId) {
      return erreur(rep, 400, 'cible_ambigue', 'Un lead porte une parcelle OU un site, pas les deux');
    }

    // Le score au moment de la prise en prospection est conserve : il permet de mesurer
    // la derive lorsque les donnees sources evoluent.
    let scoreInitial: number | null = null;
    if (idu) {
      const parcelle = await depotParcelles.parcelleParIdu(idu);
      if (!parcelle) {
        return erreur(
          rep,
          404,
          'parcelle_non_qualifiee',
          'Qualifiez la parcelle avant de la mettre en prospection',
        );
      }
      const score = await depotScores.scoreParcelle(idu, filiere);
      scoreInitial = score?.scoreGlobal ?? null;
    }

    const lead = await depot.creerLead(
      {
        idu: idu ?? null,
        siteId: siteId ?? null,
        filiere,
        statut,
        notes: notes ?? null,
        assigneA: req.utilisateur?.id ?? null,
        scoreInitial,
      },
      req.utilisateur?.email ?? 'systeme',
    );
    return rep.code(201).send(lead);
  });

  app.patch<{ Params: { id: string } }>('/api/leads/:id', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre role ne permet pas de modifier le pipeline');
    }
    const c = lecteur(req.body);
    // `texteOuVide` et non `texte` : ces deux champs doivent pouvoir etre EFFACES. `texte()` ramene la
    // chaine vide a `undefined`, ce qui aurait rendu impossible la suppression d'une note ou d'une
    // affectation — en silence, l'appel repondant 200 sans rien changer.
    const statut = c.parmi('statut', STATUTS_PROSPECTION);
    const notes = c.texteOuVide('notes', { max: 5000 });
    const assigneA = c.texteOuVide('assigneA', { max: 64 });
    c.refuserInconnus();

    const lead = await depot.majLead(
      req.params.id,
      { statut, notes, assigneA },
      req.utilisateur?.email ?? 'systeme',
    );
    if (!lead) return erreur(rep, 404, 'lead_introuvable', 'Lead introuvable');
    return lead;
  });

  app.post<{ Params: { id: string } }>('/api/leads/:id/evenements', async (req, rep) => {
    const c = lecteur(req.body);
    const type = c.parmi('type', TYPES_EVENEMENT);
    const commentaire = c.texteOuVide('commentaire', { max: 5000 });
    c.refuserInconnus();
    if (!type) {
      return erreur(rep, 400, 'type_invalide', `Type attendu parmi : ${TYPES_EVENEMENT.join(', ')}`);
    }
    const ev = await depot.ajouterEvenement(
      req.params.id,
      type,
      req.utilisateur?.email ?? 'systeme',
      commentaire ?? null,
    );
    if (!ev) return erreur(rep, 404, 'lead_introuvable', 'Lead introuvable');
    return rep.code(201).send(ev);
  });

  app.delete<{ Params: { id: string } }>('/api/leads/:id', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre role ne permet pas de modifier le pipeline');
    }
    const ok = await depot.supprimerLead(req.params.id);
    if (!ok) return erreur(rep, 404, 'lead_introuvable', 'Lead introuvable');
    await journaliser('suppression_lead', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      cible: req.params.id,
    });
    return rep.code(204).send();
  });

  // --- Sites ---------------------------------------------------------------
  app.get('/api/sites', async (req) => {
    const q = req.query as { filiere?: string };
    return depot.listerSites(estFiliere(q.filiere) ? q.filiere : undefined);
  });

  app.post('/api/sites', async (req, rep) => {
    // Meme garde que pour les leads : un compte en lecture seule ne cree rien.
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre compte est en lecture seule.');
    }
    const c = lecteur(req.body);
    const nom = c.texte('nom', { max: 200 });
    const filiere = c.parmi('filiere', FILIERES);
    // Plafond explicite : un site est un regroupement de parcelles voisines, pas un departement. Sans
    // borne, la creation d'un site declenchait un scoring consolide sur une liste non bornee.
    const idus = c.listeIdu('idus', MAX_PARCELLES_PAR_SITE);
    const geometrie = c.geometrie('geometrie');
    const commentaire = c.texteOuVide('commentaire', { max: 5000 });
    c.refuserInconnus();

    if (!nom) return erreur(rep, 400, 'nom_manquant', 'Champ `nom` requis');
    if (!filiere) return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    if (!idus?.length && !geometrie) {
      return erreur(rep, 400, 'cible_manquante', 'Champ `idus` ou `geometrie` requis');
    }

    const site = await depot.creerSite({
      nom,
      filiere,
      idus,
      geometrie: geometrie ?? null,
      commentaire: commentaire ?? null,
    });

    // Score consolide du site : les parcelles ecartees en sont retirees, et la
    // fragmentation qui en resulte penalise le score.
    const consolide = await scorerSite(site.id, filiere);
    return rep.code(201).send({ ...site, ...consolide });
  });

  app.get<{ Params: { id: string } }>('/api/sites/:id', async (req, rep) => {
    const site = await depot.siteParId(req.params.id);
    if (!site) return erreur(rep, 404, 'site_introuvable', 'Site introuvable');
    const q = req.query as { filiere?: string };
    const filiere = estFiliere(q.filiere) ? q.filiere : site.filiere;
    return { ...site, ...(await scorerSite(site.id, filiere)) };
  });

  app.get<{ Params: { id: string } }>('/api/sites/:id/score', async (req, rep) => {
    const site = await depot.siteParId(req.params.id);
    if (!site) return erreur(rep, 404, 'site_introuvable', 'Site introuvable');
    const q = req.query as { filiere?: string };
    return scorerSite(site.id, estFiliere(q.filiere) ? q.filiere : site.filiere);
  });

  app.delete<{ Params: { id: string } }>('/api/sites/:id', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre compte est en lecture seule.');
    }
    const ok = await depot.supprimerSite(req.params.id);
    if (!ok) return erreur(rep, 404, 'site_introuvable', 'Site introuvable');
    return rep.code(204).send();
  });

  // --- Tableau de bord -----------------------------------------------------
  app.get('/api/tableau-de-bord', async (req, rep) => {
    const q = req.query as { filiere?: string };
    if (!estFiliere(q.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Parametre `filiere` requis et valide');
    }
    const [prospection, scores] = await Promise.all([
      depot.tableauDeBord(q.filiere),
      depotScores.repartitionStatuts(q.filiere),
    ]);
    return { ...prospection, repartitionScores: scores };
  });
}

/** Calcule et persiste le score consolide d'un site. */
async function scorerSite(
  siteId: string,
  filiere: Filiere,
): Promise<{
  scoreGlobal: number | null;
  statutScore: string;
  surfaceTotaleHa: number;
  surfaceUtileHa: number;
  nbGroupesContigus: number | null;
  limitesViabilite: unknown[];
  parcelles: unknown[];
  knockOutsConsolides: unknown[];
} | Record<string, never>> {
  const site = await depot.siteParId(siteId);
  if (!site || site.idus.length === 0) return {};

  const snapshots = [];
  // Les echecs sont suivis PAR PARCELLE : une liste unique pour le site griserait des criteres
  // reellement mesures sur les parcelles dont la source a repondu (audit 8, B3).
  const echecsParIdu: Record<string, readonly string[]> = {};
  for (const idu of site.idus) {
    const s = await depotParcelles.snapshotParIdu(idu);
    if (s) {
      snapshots.push(s.snapshot);
      echecsParIdu[s.snapshot.identite.idu] = s.connecteursEnEchec;
    }
  }
  if (snapshots.length === 0) return {};

  // La contiguite est une propriete des GEOMETRIES : le moteur ne les recoit pas, c'est donc
  // ici qu'elle se mesure. Sans elle, il traite le site comme disperse — prudent, mais qui
  // sous-estime un vrai regroupement jointif.
  const groupes = await depot.nbGroupesContigus(site.idus);
  const consolide = calculerScoreSite(snapshots, filiere, {}, groupes, echecsParIdu);
  await depot.majScoreSite(siteId, consolide.scoreGlobal, consolide.statut, {
    knockOuts: consolide.knockOutsConsolides,
    nbParcelles: snapshots.length,
    nbGroupesContigus: consolide.nbGroupesContigus,
    surfaceUtileHa: consolide.surfaceUtileHa,
    limitesViabilite: consolide.limitesViabilite,
    filiere,
  });

  return {
    scoreGlobal: consolide.scoreGlobal,
    statutScore: consolide.statut,
    surfaceTotaleHa: Math.round(consolide.surfaceTotaleHa * 100) / 100,
    surfaceUtileHa: Math.round(consolide.surfaceUtileHa * 100) / 100,
    nbGroupesContigus: consolide.nbGroupesContigus,
    limitesViabilite: consolide.limitesViabilite,
    parcelles: consolide.parcelles,
    knockOutsConsolides: consolide.knockOutsConsolides,
  };
}
