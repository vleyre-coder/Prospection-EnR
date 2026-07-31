/** Routes de recherche, filtres, exports, ponderations, authentification et administration. */

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { estFiliere, FILIERES, PONDERATIONS_DEFAUT, type Filiere } from '@enr/core';
import { VERSION_MOTEUR } from '@enr/scoring';
import { config } from '../config.js';
import { requete, requeteUne } from '../bdd.js';
import { filtrerParcelles, rechercher, type FiltresParcelles } from '../services/recherche.js';
import { csvResultats, ficheParcellePdf, geojsonParcelles } from '../services/exports.js';
import { anneauxDepuisGeoJson, archiveShapefile } from '../services/shapefile.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import {
  enregistrerIngestion,
  journaliser,
  lireJournal,
  compterContraintes,
  compterPostes,
  etatSources,
} from '../depots/sources.js';
import { rescorerTout } from '../services/qualification.js';
import { erreur } from './erreurs.js';

// ---------------------------------------------------------------------------
// Mots de passe : scrypt, avec sel par utilisateur
// ---------------------------------------------------------------------------

export function hacherMotDePasse(motDePasse: string): string {
  const sel = randomBytes(16).toString('hex');
  const cle = scryptSync(motDePasse, sel, 64).toString('hex');
  return `scrypt$${sel}$${cle}`;
}

function verifierMotDePasse(motDePasse: string, hash: string): boolean {
  const [algo, sel, cle] = hash.split('$');
  if (algo !== 'scrypt' || !sel || !cle) return false;
  const candidat = scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(cle, 'hex');
  return candidat.length === attendu.length && timingSafeEqual(candidat, attendu);
}

export async function routesDivers(app: FastifyInstance): Promise<void> {
  // --- Recherche unifiee ---------------------------------------------------
  app.get('/api/recherche', async (req) => {
    const q = req.query as { q?: string; limite?: string };
    const resultats = await rechercher(q.q ?? '', q.limite ? Number(q.limite) : 10);
    return { resultats };
  });

  // --- Filtres parametrables ----------------------------------------------
  app.post('/api/recherche/parcelles', async (req, rep) => {
    const corps = req.body as Partial<FiltresParcelles> & { filiere?: string };
    if (!estFiliere(corps.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    }
    return filtrerParcelles({ ...corps, filiere: corps.filiere } as FiltresParcelles);
  });

  // --- Exports -------------------------------------------------------------
  app.get<{ Params: { idu: string } }>('/api/exports/parcelle/:idu.pdf', async (req, rep) => {
    const q = req.query as { filiere?: string };
    if (!estFiliere(q.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Parametre `filiere` requis et valide');
    }
    const idu = req.params.idu.toUpperCase();
    const [parcelle, snapshot, score] = await Promise.all([
      depotParcelles.parcelleParIdu(idu),
      depotParcelles.snapshotParIdu(idu),
      depotScores.scoreParcelle(idu, q.filiere),
    ]);
    if (!parcelle || !snapshot || !score) {
      return erreur(rep, 404, 'parcelle_non_qualifiee', 'Qualifiez la parcelle avant de l\'exporter');
    }

    await journaliser('export_pdf', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      cible: idu,
      details: { filiere: q.filiere },
    });

    return rep
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="fiche-${idu}-${q.filiere}.pdf"`)
      .send(ficheParcellePdf(parcelle, snapshot.snapshot, score));
  });

  app.post('/api/exports/geojson', async (req, rep) => {
    const corps = req.body as { idus?: string[]; filiere?: string };
    if (!Array.isArray(corps.idus) || corps.idus.length === 0) {
      return erreur(rep, 400, 'idus_manquants', 'Champ `idus` requis');
    }
    const filiere: Filiere = estFiliere(corps.filiere) ? corps.filiere : 'solaire_sol';
    const donnees = await chargerPourExport(corps.idus, filiere);
    await journaliser('export_geojson', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      details: { nb: donnees.length, filiere },
    });
    return rep
      .header('Content-Type', 'application/geo+json')
      .header('Content-Disposition', `attachment; filename="parcelles-${filiere}.geojson"`)
      .send(geojsonParcelles(donnees));
  });

  app.post('/api/exports/shapefile', async (req, rep) => {
    const corps = req.body as { idus?: string[]; filiere?: string };
    if (!Array.isArray(corps.idus) || corps.idus.length === 0) {
      return erreur(rep, 400, 'idus_manquants', 'Champ `idus` requis');
    }
    const filiere: Filiere = estFiliere(corps.filiere) ? corps.filiere : 'solaire_sol';
    const donnees = await chargerPourExport(corps.idus, filiere);
    if (donnees.length === 0) {
      return erreur(rep, 404, 'aucune_parcelle', 'Aucune parcelle qualifiee dans la selection');
    }

    const archive = archiveShapefile(
      donnees.map(({ parcelle, score }) => ({
        anneaux: anneauxDepuisGeoJson(parcelle.geometrie),
        attributs: {
          idu: parcelle.idu,
          code_insee: parcelle.codeInsee,
          commune: parcelle.nomCommune,
          section: parcelle.section,
          numero: parcelle.numero,
          surface_ha:
            Math.round(((parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000) * 100) / 100,
          statut: score?.statut ?? null,
          score: score?.scoreGlobal ?? null,
          couverture: score?.couvertureDonnees ?? null,
          nb_ko: score?.knockOuts.length ?? null,
          regime: score?.regimeImplantation ?? null,
        },
      })),
      `parcelles-${filiere}`,
    );

    await journaliser('export_shapefile', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      details: { nb: donnees.length, filiere },
    });

    return rep
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="parcelles-${filiere}-shapefile.zip"`)
      .send(archive);
  });

  app.post('/api/exports/csv', async (req, rep) => {
    const corps = req.body as Partial<FiltresParcelles> & { filiere?: string };
    if (!estFiliere(corps.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    }
    const { resultats } = await filtrerParcelles({
      ...corps,
      filiere: corps.filiere,
      limite: Math.min(corps.limite ?? 5000, 20000),
    } as FiltresParcelles);
    await journaliser('export_csv', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      details: { nb: resultats.length, filiere: corps.filiere },
    });
    return rep
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="parcelles-${corps.filiere}.csv"`)
      .send(csvResultats(resultats));
  });

  // --- Ponderations sauvegardees ------------------------------------------
  app.get('/api/ponderations', async (req) => {
    const q = req.query as { filiere?: string };
    const lignes = await requete<{
      id: string;
      nom: string;
      filiere: Filiere;
      poids: Record<string, number>;
      seuil_vert: number;
      seuil_orange: number;
      seuil_couverture: number;
      partage: boolean;
    }>(
      `SELECT id, nom, filiere, poids, seuil_vert, seuil_orange, seuil_couverture, partage
         FROM profil_ponderation
        WHERE ($1::text IS NULL OR filiere = $1)
          AND (partage = true OR utilisateur_id = $2 OR utilisateur_id IS NULL)
        ORDER BY nom`,
      [estFiliere(q.filiere) ? q.filiere : null, req.utilisateur?.id ?? null],
    );
    return {
      defaut: PONDERATIONS_DEFAUT,
      enregistres: lignes.map((l) => ({
        id: l.id,
        nom: l.nom,
        filiere: l.filiere,
        poids: l.poids,
        seuilVert: l.seuil_vert,
        seuilOrange: l.seuil_orange,
        seuilCouvertureDonnees: l.seuil_couverture,
        partage: l.partage,
      })),
    };
  });

  app.post('/api/ponderations', async (req, rep) => {
    const corps = req.body as {
      nom?: string;
      filiere?: string;
      poids?: Record<string, number>;
      seuilVert?: number;
      seuilOrange?: number;
      seuilCouvertureDonnees?: number;
      partage?: boolean;
    };
    if (!corps.nom?.trim()) return erreur(rep, 400, 'nom_manquant', 'Champ `nom` requis');
    if (!estFiliere(corps.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Champ `filiere` requis et valide');
    }
    if (!corps.poids || Object.keys(corps.poids).length === 0) {
      return erreur(rep, 400, 'poids_manquants', 'Champ `poids` requis');
    }
    const ligne = await requeteUne<{ id: string }>(
      `INSERT INTO profil_ponderation
         (nom, filiere, utilisateur_id, partage, poids, seuil_vert, seuil_orange, seuil_couverture)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 65), COALESCE($7, 40), COALESCE($8, 0.5))
       ON CONFLICT (utilisateur_id, filiere, nom) DO UPDATE SET
         poids = EXCLUDED.poids, seuil_vert = EXCLUDED.seuil_vert,
         seuil_orange = EXCLUDED.seuil_orange, seuil_couverture = EXCLUDED.seuil_couverture,
         partage = EXCLUDED.partage
       RETURNING id`,
      [
        corps.nom.trim(),
        corps.filiere,
        req.utilisateur?.id ?? null,
        corps.partage ?? false,
        JSON.stringify(corps.poids),
        corps.seuilVert ?? null,
        corps.seuilOrange ?? null,
        corps.seuilCouvertureDonnees ?? null,
      ],
    );
    return rep.code(201).send({ id: ligne?.id });
  });

  app.delete<{ Params: { id: string } }>('/api/ponderations/:id', async (req, rep) => {
    await requete(`DELETE FROM profil_ponderation WHERE id = $1`, [req.params.id]);
    return rep.code(204).send();
  });

  // --- Authentification ----------------------------------------------------
  app.post('/api/auth/connexion', async (req, rep) => {
    const corps = req.body as { email?: string; motDePasse?: string };
    if (!corps.email || !corps.motDePasse) {
      return erreur(rep, 400, 'identifiants_manquants', 'Champs `email` et `motDePasse` requis');
    }
    const u = await requeteUne<{
      id: string;
      email: string;
      nom: string;
      mot_de_passe_hash: string;
      role: string;
      habilite_donnees_proprietaires: boolean;
      actif: boolean;
    }>(`SELECT * FROM utilisateur WHERE lower(email) = lower($1)`, [corps.email]);

    if (!u || !u.actif || !verifierMotDePasse(corps.motDePasse, u.mot_de_passe_hash)) {
      await journaliser('connexion_echouee', { email: corps.email, adresseIp: req.ip });
      // Message volontairement identique dans les deux cas : ne pas reveler l'existence
      // d'un compte.
      return erreur(rep, 401, 'identifiants_invalides', 'Identifiants invalides');
    }

    await requete(`UPDATE utilisateur SET derniere_connexion = now() WHERE id = $1`, [u.id]);
    await journaliser('connexion', { utilisateurId: u.id, email: u.email, adresseIp: req.ip });

    const token = app.jwt.sign(
      {
        id: u.id,
        email: u.email,
        nom: u.nom,
        role: u.role,
        habiliteDonneesProprietaires: u.habilite_donnees_proprietaires,
      },
      { expiresIn: config.auth.dureeToken },
    );
    return {
      token,
      utilisateur: {
        id: u.id,
        email: u.email,
        nom: u.nom,
        role: u.role,
        habiliteDonneesProprietaires: u.habilite_donnees_proprietaires,
      },
    };
  });

  app.get('/api/auth/moi', async (req, rep) => {
    if (!req.utilisateur) return erreur(rep, 401, 'non_authentifie', 'Authentification requise');
    return req.utilisateur;
  });

  // --- Administration ------------------------------------------------------
  const admin = { preHandler: exigerRole('admin') };

  app.get('/api/admin/ingestions', admin, async () => ({
    sources: await etatSources(),
    contraintes: await compterContraintes(),
    postes: await compterPostes(),
    versionMoteur: VERSION_MOTEUR,
  }));

  app.post<{ Params: { connecteur: string } }>(
    '/api/admin/ingestions/:connecteur',
    admin,
    async (req, rep) => {
      const { lancerIngestion } = await import('../ingestion/index.js');
      const resultat = await lancerIngestion(req.params.connecteur).catch((err: Error) => {
        void enregistrerIngestion(req.params.connecteur, 'echec', err.message, null);
        return null;
      });
      if (!resultat) {
        return erreur(
          rep,
          502,
          'ingestion_echouee',
          `L'ingestion du connecteur ${req.params.connecteur} a echoue. Consultez les journaux.`,
        );
      }
      return resultat;
    },
  );

  app.post('/api/admin/rescorer', admin, async (req) => {
    const corps = req.body as { filiere?: string; limite?: number };
    return rescorerTout(
      estFiliere(corps.filiere) ? [corps.filiere] : [...FILIERES],
      corps.limite ?? 5000,
    );
  });

  app.get('/api/admin/journal', admin, async (req) => {
    const q = req.query as { limite?: string };
    return { entrees: await lireJournal(q.limite ? Number(q.limite) : 200) };
  });

  app.post('/api/admin/utilisateurs', admin, async (req, rep) => {
    const corps = req.body as {
      email?: string;
      nom?: string;
      motDePasse?: string;
      role?: string;
      habiliteDonneesProprietaires?: boolean;
    };
    if (!corps.email || !corps.nom || !corps.motDePasse) {
      return erreur(rep, 400, 'champs_manquants', 'Champs `email`, `nom` et `motDePasse` requis');
    }
    if (corps.motDePasse.length < 12) {
      return erreur(
        rep,
        422,
        'mot_de_passe_faible',
        'Le mot de passe doit comporter au moins 12 caracteres',
      );
    }
    const roles = ['admin', 'prospection', 'lecture'];
    const role = corps.role && roles.includes(corps.role) ? corps.role : 'lecture';
    const u = await requeteUne<{ id: string }>(
      `INSERT INTO utilisateur (email, nom, mot_de_passe_hash, role, habilite_donnees_proprietaires)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        corps.email.toLowerCase(),
        corps.nom,
        hacherMotDePasse(corps.motDePasse),
        role,
        corps.habiliteDonneesProprietaires ?? false,
      ],
    );
    await journaliser('creation_utilisateur', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      cible: corps.email,
      details: { role },
    });
    return rep.code(201).send({ id: u?.id });
  });

  app.post('/api/admin/purge-rgpd', admin, async (req) => {
    const l = await requeteUne<{ purger_donnees_nominatives: number }>(
      `SELECT purger_donnees_nominatives()`,
    );
    return { lignesPurgees: l?.purger_donnees_nominatives ?? 0, demandePar: req.utilisateur?.email };
  });
}

/**
 * Garde de role, utilise en `preHandler`.
 *
 * En Fastify, un `preHandler` asynchrone qui envoie une reponse court-circuite la chaine :
 * le gestionnaire de route n'est alors jamais appele.
 */
function exigerRole(role: 'admin' | 'prospection'): preHandlerHookHandler {
  return async function gardeRole(req, rep) {
    const u = req.utilisateur;
    if (!u) {
      await erreur(rep, 401, 'non_authentifie', 'Authentification requise');
      return;
    }
    if (u.role !== 'admin' && u.role !== role) {
      await erreur(rep, 403, 'role_insuffisant', `Role ${role} requis pour cette operation`);
      return;
    }
  };
}

async function chargerPourExport(idus: string[], filiere: Filiere) {
  const parcelles = await depotParcelles.parcellesParIdus(idus.map((i) => i.toUpperCase()));
  const resultat = [];
  for (const parcelle of parcelles) {
    const score = await depotScores.scoreParcelle(parcelle.idu, filiere);
    resultat.push({ parcelle, score });
  }
  return resultat;
}

/** Empreinte du referentiel, utilisee pour invalider les caches clients. */
export function empreinteReferentiel(): string {
  return createHash('sha1')
    .update(JSON.stringify({ PONDERATIONS_DEFAUT, VERSION_MOTEUR }))
    .digest('hex')
    .slice(0, 12);
}
