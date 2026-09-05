/** Routes de recherche, filtres, exports, ponderations, authentification et administration. */

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import {
  CRITERES,
  estFiliere,
  FILIERES,
  LIBELLES_SCORE,
  PONDERATIONS_DEFAUT,
  type Filiere,
} from '@enr/core';
import { VERSION_MOTEUR } from '@enr/scoring';
import { config } from '../config.js';
import { requete, requeteUne } from '../bdd.js';
import { hacherMotDePasse, verifierMotDePasse } from '../mots-de-passe.js';
import {
  filtrerParcelles,
  filtresValides,
  rechercher,
  LIMITE_DEFAUT_EXPORT,
  LIMITE_MAX_EXPORT,
} from '../services/recherche.js';
import { entierRequete, ErreurValidation, lecteur, ponderationValide } from '../validation.js';

/** Roles applicatifs. Liste fermee : une valeur invalide est refusee, et non ramenee a `lecture`. */
const ROLES = ['admin', 'prospection', 'lecture'] as const;
import { csvResultats, dossierSitePdf, ficheParcellePdf, geojsonParcelles } from '../services/exports.js';
import { anneauxDepuisGeoJson, archiveShapefile } from '../services/shapefile.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import * as depotProspection from '../depots/prospection.js';
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
import { limiterDebit } from '../debit.js';

export async function routesDivers(app: FastifyInstance): Promise<void> {
  // --- Recherche unifiee ---------------------------------------------------
  app.get('/api/recherche', async (req) => {
    const q = req.query as { q?: string; limite?: string };
    const resultats = await rechercher(
      q.q ?? '',
      entierRequete(q.limite, 'limite', { defaut: 10, min: 1, max: 50 }),
    );
    return { resultats };
  });

  // --- Filtres parametrables ----------------------------------------------
  app.post('/api/recherche/parcelles', async (req, rep) => {
    /**
     * Le corps est VALIDE avant d'atteindre le constructeur SQL.
     *
     * Il etait auparavant diffuse tel quel avec un `as FiltresParcelles`, qui ne verifie rien a
     * l'execution : `{"limite": -5}` remontait un 500 « LIMIT must not be negative »,
     * `{"surfaceMinHa": "abc"}` un 500 de syntaxe PostgreSQL. Une faute de saisie etait
     * presentee comme une panne serveur — l'utilisateur ne pouvait pas savoir quoi corriger, et
     * une supervision reveillait une astreinte.
     */
    try {
      return filtrerParcelles(filtresValides(req.body));
    } catch (err) {
      if (err instanceof ErreurValidation) {
        return erreur(rep, 400, 'filtre_invalide', err.message, { champ: err.champ });
      }
      throw err;
    }
  });

  // --- Exports -------------------------------------------------------------
  app.get<{ Params: { idu: string } }>('/api/exports/parcelle/:idu.pdf', async (req, rep) => {
    const q = req.query as { filiere?: string };
    if (!estFiliere(q.filiere)) {
      return erreur(rep, 400, 'filiere_invalide', 'Paramètre `filière` requis et valide');
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
      .send(ficheParcellePdf(parcelle, snapshot.snapshot, score, snapshot.connecteursEnEchec));
  });

  const debitExport = {
    preHandler: limiterDebit({ max: 30, fenetreMs: 10 * 60 * 1000, operation: 'export' }),
  };

  app.post('/api/exports/geojson', debitExport, async (req, rep) => {
    const c = lecteur(req.body);
    const filiere: Filiere = c.parmi('filiere', FILIERES) ?? 'solaire_sol';
    c.valideAilleurs('idus'); // plafond, type des elements et doublons : voir `idusValides`
    c.refuserInconnus();
    const donnees = await chargerPourExport(
      idusValides((req.body as { idus?: unknown }).idus, LIMITE_MAX_EXPORT),
      filiere,
    );
    // Meme comportement que le Shapefile : un fichier qui s'ouvre sur rien, sans message, laisse
    // croire a un export reussi (audit 8, D7).
    if (donnees.length === 0) {
      return erreur(rep, 404, 'aucune_parcelle', 'Aucune parcelle qualifiée dans la sélection');
    }
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

  app.post('/api/exports/shapefile', debitExport, async (req, rep) => {
    const c = lecteur(req.body);
    const filiere: Filiere = c.parmi('filiere', FILIERES) ?? 'solaire_sol';
    c.valideAilleurs('idus'); // plafond, type des elements et doublons : voir `idusValides`
    c.refuserInconnus();
    const donnees = await chargerPourExport(
      idusValides((req.body as { idus?: unknown }).idus, LIMITE_MAX_EXPORT),
      filiere,
    );
    if (donnees.length === 0) {
      return erreur(rep, 404, 'aucune_parcelle', 'Aucune parcelle qualifiée dans la sélection');
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
          // Le total inclut les knock-outs DEROGEABLES (STECAL, modification de PLU), qui
          // conditionnent un projet sans l'exclure. Le destinataire d'un Shapefile — geometre,
          // bureau d'etudes, consultant SIG — ne peut pas trancher sans ce second compteur : le
          // CSV et le GeoJSON le portaient deja, celui-ci l'avait manque.
          nb_ko_bloq: score?.knockOuts.filter((k) => !k.derogeable).length ?? null,
          ecartee: score == null ? null : score.knockOuts.some((k) => !k.derogeable) ? 'oui' : 'non',
          regime: score?.regimeImplantation ?? null,
          /**
           * Le libelle du statut, AJOUTE a cote de la cle et non a sa place.
           *
           * Meme raisonnement que pour le GeoJSON : `statut` porte `vert`/`orange`/`rouge`/`gris`,
           * cles sur lesquelles se construisent les regles de symbologie d'un SIG — les remplacer
           * casserait les projets existants. Mais la table d'attributs est lue par un humain, qui n'a
           * pas la cle de lecture. Les deux colonnes coexistent.
           *
           * Le nom est contraint a dix caracteres par le format DBF, d'ou l'abreviation.
           */
          statut_lib: score?.statut ? LIBELLES_SCORE[score.statut] : null,
        },
      })),
      `parcelles-${filiere}`,
      /**
       * Largeurs minimales declarees, pour que le schema du DBF ne depende pas du lot.
       *
       * Sans elles, un export ou tous les regimes sont nuls produit un champ REGIME d'un
       * caractere, la ou un autre lot le donne a 22 : les deux fichiers decrivent la meme chose
       * avec des schemas differents, et les fusionner dans un SIG tronque le plus etroit.
       *
       * Valeurs tirees du domaine et non d'un lot : IDU cadastral sur 14, code INSEE sur 5,
       * section sur 2 (elle est completee a gauche par un zero dans l'IDU),
       * feux tricolores sur 5 (« orange »), regimes d'implantation sur 22
       * (« pv_sol_terrain_degrade »), et 40 pour un nom de commune — le plus long de France en
       * compte 38 (Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson).
       */
      {
        idu: 14,
        code_insee: 5,
        commune: 40,
        section: 2,
        numero: 4,
        statut: 5,
        ecartee: 3,
        regime: 22,
        // « Sous conditions / a etudier » est le plus long des quatre libelles de feu : 27 caracteres.
        statut_lib: 27,
      },
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

  app.post('/api/exports/csv', debitExport, async (req, rep) => {
    // Meme validation que la recherche, avec le plafond des exports : un export a besoin de plus
    // de lignes qu'une page de liste, mais pas d'echapper au controle pour autant.
    let filtres;
    try {
      filtres = filtresValides(req.body, LIMITE_MAX_EXPORT);
    } catch (err) {
      if (err instanceof ErreurValidation) {
        return erreur(rep, 400, 'filtre_invalide', err.message, { champ: err.champ });
      }
      throw err;
    }
    const { resultats } = await filtrerParcelles(
      { ...filtres, limite: filtres.limite ?? LIMITE_DEFAUT_EXPORT },
      LIMITE_MAX_EXPORT,
    );
    await journaliser('export_csv', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      details: { nb: resultats.length, filiere: filtres.filiere },
    });
    return rep
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="parcelles-${filtres.filiere}.csv"`)
      .send(csvResultats(resultats));
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * DOSSIER DE SITE — le document qu'on remet a un developpeur
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * POURQUOI UN PLAFOND BEAUCOUP PLUS BAS QUE LES AUTRES EXPORTS (25 contre 20 000). Un CSV de
   * 20 000 lignes est un fichier ; un PDF de 20 000 parcelles est une panne. Chaque parcelle ajoute
   * huit rangees de tableau mesurees une a une par pdfkit, et le document se construit EN MEMOIRE
   * avant d'etre servi. Le plafond n'est donc pas une precaution de forme : c'est la limite au-dela
   * de laquelle la requete cesse d'etre servie et devient un deni de service sur soi-meme.
   *
   * Vingt-cinq, et pas cent : un dossier de site remis a un developpeur porte sur une emprise
   * negociee, pas sur un departement. Au-dela, ce n'est plus un site.
   */
  const MAX_PARCELLES_DOSSIER = 25;

  app.post('/api/exports/dossier', debitExport, async (req, rep) => {
    const c = lecteur(req.body);
    const filiere: Filiere = c.parmi('filiere', FILIERES) ?? 'solaire_sol';
    c.valideAilleurs('idus');
    c.refuserInconnus();

    let idus: string[];
    try {
      idus = idusValides((req.body as { idus?: unknown }).idus, MAX_PARCELLES_DOSSIER);
    } catch (err) {
      if (err instanceof ErreurValidation) {
        return erreur(rep, 400, 'selection_invalide', err.message, { champ: err.champ });
      }
      throw err;
    }

    const [parcelles, snapshots, scores, statuts] = await Promise.all([
      depotParcelles.parcellesParIdus(idus),
      depotParcelles.snapshotsParIdus(idus),
      depotScores.scoresParIdus(idus, filiere),
      depotProspection.statutsProspectionParIdus(idus, filiere),
    ]);

    /**
     * UNE PARCELLE NON QUALIFIEE EST NOMMEE, PAS IGNOREE.
     *
     * Les exports GeoJSON et Shapefile laissent tomber en silence les parcelles sans score : le
     * fichier s'ouvre, il a l'air complet, et il manque trois parcelles. Sur un dossier remis a un
     * developpeur, ce silence-la se paie plus cher qu'un refus — l'ensemble du raisonnement porte
     * sur des surfaces et une puissance CUMULEES, qui seraient fausses sans que rien ne le montre.
     */
    const retenues = parcelles
      .map((parcelle) => ({
        parcelle,
        snapshot: snapshots[parcelle.idu],
        score: scores[parcelle.idu],
        statutProspection: statuts[parcelle.idu] ?? null,
      }))
      .filter(
        (l): l is typeof l & { snapshot: NonNullable<typeof l.snapshot>; score: NonNullable<typeof l.score> } =>
          l.snapshot != null && l.score != null,
      );
    const manquantes = idus.filter((idu) => !retenues.some((l) => l.parcelle.idu === idu));
    if (manquantes.length > 0) {
      return erreur(
        rep,
        409,
        'parcelles_non_qualifiees',
        `${manquantes.length} parcelle(s) de la sélection ne sont pas qualifiées pour cette filière : ` +
          'le dossier raisonne sur des surfaces et une puissance cumulées, il ne peut pas en omettre ' +
          'une sans se tromper. Qualifiez-les, ou retirez-les de la sélection.',
        { idus: manquantes },
      );
    }

    // La contiguite reelle, mesuree en base : elle decide de la methode de surface utile, donc du
    // chiffre de puissance. La deduire du nombre de parcelles serait une supposition.
    const nbGroupesContigus = await depotProspection.nbGroupesContigus(
      retenues.map((l) => l.parcelle.idu),
    );

    await journaliser('export_dossier', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      details: { nb: retenues.length, filiere, nbGroupesContigus },
    });

    return rep
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="dossier-site-${filiere}.pdf"`)
      .send(
        dossierSitePdf(
          retenues.map((l) => ({
            parcelle: l.parcelle,
            snapshot: l.snapshot.snapshot,
            score: l.score,
            connecteursEnEchec: l.snapshot.connecteursEnEchec,
            statutProspection: l.statutProspection,
          })),
          { filiere, nbGroupesContigus },
        ),
      );
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
        ORDER BY nom, id`,
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
    const c = lecteur(req.body);
    const nom = c.texte('nom', { max: 120 });
    const filiere = c.parmi('filiere', FILIERES);
    const partage = c.booleen('partage');
    if (!nom) return erreur(rep, 400, 'nom_manquant', 'Champ `nom` requis');
    if (!filiere) return erreur(rep, 400, 'filiere_invalide', 'Champ `filière` requis et valide');
    /**
     * Les poids sont VALIDES avant d'etre persistes.
     *
     * Ils etaient stockes tels quels : une cle inconnue etait acceptee puis ignoree par le moteur
     * (l'utilisateur croyait avoir repondere un critere inchange), un poids negatif inversait la
     * contribution du critere — le score MONTAIT quand le critere se degradait — et `NaN` rendait le
     * score global vide sur une parcelle bien renseignee.
     */
    const profil = ponderationValide(req.body, (id) => CRITERES[id] != null);
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
        nom,
        filiere,
        req.utilisateur?.id ?? null,
        partage ?? false,
        JSON.stringify(profil.poids),
        profil.seuilVert ?? null,
        profil.seuilOrange ?? null,
        profil.seuilCouvertureDonnees ?? null,
      ],
    );
    return rep.code(201).send({ id: ligne?.id });
  });

  app.delete<{ Params: { id: string } }>('/api/ponderations/:id', async (req, rep) => {
    const u = req.utilisateur;
    if (!u) return erreur(rep, 401, 'non_authentifie', 'Authentification requise');

    // Verification de PROPRIETE, et non simple authentification : la requete supprimait
    // auparavant n'importe quel profil sur simple connaissance de son identifiant, y compris
    // celui d'un collegue. Un administrateur reste autorise, pour pouvoir faire le menage.
    const supprimees = await requete<{ id: string }>(
      `DELETE FROM profil_ponderation
        WHERE id = $1 AND ($2::boolean OR utilisateur_id = $3)
        RETURNING id`,
      [req.params.id, u.role === 'admin', u.id],
    );
    if (supprimees.length === 0) {
      // Meme reponse que le profil soit inexistant ou appartienne a un tiers : distinguer
      // les deux revelerait l'existence des profils d'autrui.
      return erreur(rep, 404, 'profil_introuvable', 'Aucun profil de pondération supprimable à cet identifiant');
    }
    return rep.code(204).send();
  });

  // --- Authentification ----------------------------------------------------
  app.post(
    '/api/auth/connexion',
    // Route publique : la seule ou un attaquant non authentifie peut insister. La limite
    // vise le bourrage d'identifiants, pas l'usage normal - dix essais par quart d'heure
    // laissent largement place a une faute de frappe.
    { preHandler: limiterDebit({ max: 10, fenetreMs: 15 * 60 * 1000, operation: 'connexion' }) },
    async (req, rep) => {
    /**
     * Bornes de taille sur une route PUBLIQUE.
     *
     * Le corps etait lu par assertion de type : un `email` de plusieurs mega-octets partait dans une
     * requete SQL, et un `motDePasse` de meme taille dans la fonction de hachage — coûteuse par
     * construction. C'est la seule route ou un attaquant non authentifie peut insister, donc la seule
     * ou la taille des entrees doit etre bornee avant tout travail.
     *
     * Le mot de passe n'est PAS lu par `texte()` : un `trim()` modifierait silencieusement ce que
     * l'utilisateur a saisi, et un mot de passe se compare tel quel.
     */
    const c = lecteur(req.body);
    const email = c.texte('email', { max: 254 });
    const brutMdp = (req.body as { motDePasse?: unknown }).motDePasse;
    c.valideAilleurs('motDePasse'); // compare tel quel, sans `trim()` : longueur bornee plus bas
    c.refuserInconnus();
    const motDePasse = typeof brutMdp === 'string' && brutMdp.length <= 512 ? brutMdp : null;
    if (!email || !motDePasse) {
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
    }>(`SELECT * FROM utilisateur WHERE lower(email) = lower($1)`, [email]);

    if (!u || !u.actif || !verifierMotDePasse(motDePasse, u.mot_de_passe_hash)) {
      await journaliser('connexion_echouee', { email, adresseIp: req.ip });
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
    },
  );

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
      const { lancerIngestion, ErreurIngestionEnCours } = await import('../ingestion/index.js');
      // 409 et non 502 : une ingestion deja en cours n'est pas une panne, c'est un conflit. Le
      // client doit pouvoir distinguer « reessayez plus tard » de « la source a echoue », et
      // l'echec ne doit pas etre inscrit au journal des sources — la source n'a rien fait de mal
      // (audit 10, defaut B3).
      let dejaEnCours = false;
      const resultat = await lancerIngestion(req.params.connecteur).catch((err: Error) => {
        if (err instanceof ErreurIngestionEnCours) {
          dejaEnCours = true;
          return null;
        }
        void enregistrerIngestion(req.params.connecteur, 'echec', err.message, null);
        return null;
      });
      if (dejaEnCours) {
        return erreur(
          rep,
          409,
          'ingestion_en_cours',
          `Une ingestion du connecteur ${req.params.connecteur} est deja en cours. Attendez sa fin : ` +
            'la lancer deux fois consomme deux fois le quota des sources publiques.',
        );
      }
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
    const c = lecteur(req.body ?? {});
    const filiere = c.parmi('filiere', FILIERES);
    // Borne explicite : `corps.limite ?? 5000` acceptait `NaN` et n'importe quel entier, alors que la
    // valeur part en `LIMIT` SQL et gouverne la duree d'un recalcul complet.
    const limite = c.nombre('limite', { min: 1, max: 200_000, entier: true }) ?? 5000;
    c.refuserInconnus();
    return rescorerTout(filiere ? [filiere] : [...FILIERES], limite);
  });

  app.get('/api/admin/journal', admin, async (req) => {
    const q = req.query as { limite?: string };
    return {
      entrees: await lireJournal(entierRequete(q.limite, 'limite', { defaut: 200, min: 1, max: 5000 })),
    };
  });

  app.post('/api/admin/utilisateurs', admin, async (req, rep) => {
    const c = lecteur(req.body);
    const email = c.texte('email', {
      max: 254,
      motif: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
      description: 'adresse de courriel',
    });
    const nom = c.texte('nom', { max: 120 });
    // Le mot de passe n'est PAS borne par `texte()` : la longueur minimale est un controle metier,
    // verifie plus bas avec son propre code d'erreur, et un `trim()` sur un mot de passe modifierait
    // silencieusement ce que l'utilisateur a saisi.
    const motDePasse = typeof (req.body as { motDePasse?: unknown }).motDePasse === 'string'
      ? ((req.body as { motDePasse: string }).motDePasse)
      : undefined;
    c.valideAilleurs('motDePasse'); // compare tel quel, sans `trim()` : longueur bornee plus bas
    /**
     * Le role est REFUSE s'il est invalide, et non ramene a `lecture`.
     *
     * Le repli silencieux etait un piege : une faute de frappe (`"Admin"`, `"admin "`) creait un compte
     * en lecture seule, et l'administrateur constatait plus tard que son collegue ne pouvait rien
     * faire — sans aucun moyen de savoir pourquoi. Une valeur invalide est une faute d'appel.
     */
    const role = c.parmi('role', ROLES) ?? 'lecture';
    const habilite = c.booleen('habiliteDonneesProprietaires');
    c.refuserInconnus();

    if (!email || !nom || motDePasse == null || motDePasse === '') {
      return erreur(rep, 400, 'champs_manquants', 'Champs `email`, `nom` et `motDePasse` requis');
    }
    if (motDePasse.length < 12) {
      return erreur(
        rep,
        422,
        'mot_de_passe_faible',
        'Le mot de passe doit comporter au moins 12 caractères',
      );
    }
    const u = await requeteUne<{ id: string }>(
      `INSERT INTO utilisateur (email, nom, mot_de_passe_hash, role, habilite_donnees_proprietaires)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email.toLowerCase(), nom, hacherMotDePasse(motDePasse), role, habilite ?? false],
    );
    await journaliser('creation_utilisateur', {
      utilisateurId: req.utilisateur?.id,
      email: req.utilisateur?.email,
      cible: email,
      details: { role, habilite: habilite ?? false },
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

/**
 * Valide et normalise une liste d'IDU recue dans un corps d'export.
 *
 * TROIS DEFAUTS EN UNE LIGNE — audit 8, C9. Les routes GeoJSON et Shapefile se contentaient de
 * `Array.isArray(corps.idus) && corps.idus.length > 0` :
 *
 *   1. AUCUN PLAFOND, alors que `/api/exports/csv` en a un. La limitation de debit (30 requetes par
 *      10 minutes) borne la FREQUENCE, pas la TAILLE : un seul appel pouvait demander 500 000 IDU et
 *      epuiser la memoire du serveur.
 *   2. AUCUN CONTROLE DE TYPE des elements. `idus.map((i) => i.toUpperCase())` sur un element
 *      non-chaine leve un `TypeError` non intercepte, donc une erreur 500 sur une faute d'appel.
 *   3. Les doublons n'etaient pas ecartes : une liste repetant mille fois le meme IDU faisait mille
 *      fois le travail.
 */
function idusValides(brut: unknown, maximum: number): string[] {
  if (!Array.isArray(brut) || brut.length === 0) {
    throw new ErreurValidation('idus', 'Champ `idus` requis : tableau non vide d’identifiants de parcelle.');
  }
  if (brut.length > maximum) {
    throw new ErreurValidation(
      'idus',
      `Champ \`idus\` : ${brut.length} identifiants demandes, maximum ${maximum}. ` +
        'Restreignez la sélection, ou exportez en plusieurs lots.',
    );
  }
  const vus = new Set<string>();
  for (const [i, v] of brut.entries()) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new ErreurValidation('idus', `Champ \`idus\` : l’element ${i} n’est pas un identifiant.`);
    }
    vus.add(v.trim().toUpperCase());
  }
  return [...vus];
}

async function chargerPourExport(idus: string[], filiere: Filiere) {
  const parcelles = await depotParcelles.parcellesParIdus(idus);
  // Une seule requete pour tous les scores, au lieu d'une par parcelle : la boucle precedente
  // faisait un aller-retour SQL par element de la selection (audit 8, C9).
  const scores = await depotScores.scoresParIdus(
    parcelles.map((p) => p.idu),
    filiere,
  );
  return parcelles.map((parcelle) => ({ parcelle, score: scores[parcelle.idu] ?? null }));
}

/** Empreinte du referentiel, utilisee pour invalider les caches clients. */
export function empreinteReferentiel(): string {
  return createHash('sha1')
    .update(JSON.stringify({ PONDERATIONS_DEFAUT, VERSION_MOTEUR }))
    .digest('hex')
    .slice(0, 12);
}
