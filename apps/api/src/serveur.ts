/** Serveur HTTP Fastify. */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { journal } from './journal.js';
import { fermerBdd } from './bdd.js';
import {
  amorcerSiNecessaire,
  assurerAdministrateur,
  attendreBdd,
  resoudreSecretJwt,
  tenterVerrou,
} from './amorcage.js';
import {
  rescorerSiVersionObsolete,
  signalerCampagnesInterrompues,
} from './services/qualification.js';
import { appliquerMigrations } from './migrations.js';
import { synchroniserReferentiel } from './depots/sources.js';
import { routesReferentiel } from './routes/referentiel.js';
import { routesCarte } from './routes/carte.js';
import { routesParcelles } from './routes/parcelles.js';
import { routesProspection } from './routes/prospection.js';
import { routesDivers } from './routes/divers.js';
import statique from '@fastify/static';
import compression from '@fastify/compress';
import { optionsStatique, repertoireInterface } from './routes/statique.js';
import { ErreurSource } from './http.js';

export interface UtilisateurCourant {
  id: string;
  email: string;
  nom: string;
  role: 'admin' | 'prospection' | 'lecture';
  habiliteDonneesProprietaires: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    utilisateur?: UtilisateurCourant;
  }
}

/** Routes accessibles sans authentification. */
const ROUTES_PUBLIQUES = ['/api/sante', '/api/auth/connexion', '/api/referentiel'];

export interface OptionsServeur {
  /** Secret de signature des jetons. A defaut, celui de la configuration. */
  secretJwt?: string;
}

export async function construireServeur(options: OptionsServeur = {}) {
  const app = Fastify({
    // Fastify 5 distingue `logger` (options de configuration) de `loggerInstance`
    // (instance pino deja construite) : ici, l'instance partagee de l'application.
    loggerInstance: journal,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });

  // CORS : tout ouvert en developpement ; en production, les origines locales plus celles
  // declarees explicitement. Cette liste est ce qui permet d'heberger l'interface ailleurs
  // que l'API (front statique sur un hebergeur de sites) sans ouvrir l'API a tous.
  const originesLocales = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  await app.register(cors, {
    origin:
      config.env === 'development'
        ? true
        : (origine, retour) => {
            if (!origine) return retour(null, true); // requete hors navigateur
            const admise =
              originesLocales.test(origine) || config.web.originesAutorisees.includes(origine);
            return retour(null, admise);
          },
    credentials: true,
  });

  // Le secret vient du demarrage (variable d'environnement, ou secret persiste en base).
  // Le repli aleatoire ne sert qu'aux appels directs a `construireServeur` (tests) :
  // il vaut mieux des jetons non reutilisables qu'un secret devinable.
  // Compression : le paquet cartographique depasse le megaoctet, et une tuile vectorielle
  // nationale approche les 700 ko. nginx s'en charge dans la pile docker-compose, mais
  // l'image de l'API doit rester utilisable seule, derriere n'importe quel hebergeur.
  // Les tuiles et le GeoJSON ne figurent pas dans les types compressibles par defaut :
  // ce sont pourtant les reponses les plus volumineuses de l'application.
  await app.register(compression, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
    customTypes: /^application\/(vnd\.mapbox-vector-tile|geo\+json)/,
  });

  await app.register(jwt, {
    secret: options.secretJwt || config.auth.secretJwt || randomBytes(32).toString('hex'),
  });

  // --- Authentification ----------------------------------------------------
  app.addHook('onRequest', async (req, rep) => {
    if (!req.url.startsWith('/api/')) return;
    if (ROUTES_PUBLIQUES.some((r) => req.url.startsWith(r))) return;
    // Les tuiles communales (compteurs agreges) et les tuiles de contraintes (zonages
    // publics) restent ouvertes : elles ne portent rien de confidentiel, et les laisser
    // libres evite d'imposer un en-tete a chaque requete du client cartographique.
    //
    // Les tuiles PARCELLAIRES, elles, portent `statut_prospection` : le pipeline
    // commercial, parcelle par parcelle. Servi sans authentification, il exposait a qui
    // connaissait l'URL la liste des terrains demarches, negocies ou signes - une
    // information concurrentielle, et un indice indirect sur les proprietaires contactes.
    // Elles exigent donc un jeton, comme le reste de l'API.
    if (
      req.url.startsWith('/api/carte/tuiles/') &&
      !req.url.startsWith('/api/carte/tuiles/parcelles/')
    ) {
      return;
    }
    // Meme raison pour le relais du fond de carte : ce sont des tuiles IGN publiques.
    if (req.url.startsWith('/api/carte/fond/')) return;
    // Idem pour les polices d'etiquettes : MapLibre les charge sans en-tete d'autorisation.
    if (req.url.startsWith('/api/carte/polices/')) return;

    if (config.auth.desactivee) {
      if (config.env === 'production') {
        // Garde-fou : ne jamais demarrer sans authentification en production.
        return rep.code(500).send({
          erreur: {
            code: 'configuration_invalide',
            message: "AUTH_DESACTIVEE est interdit en production.",
          },
        });
      }
      req.utilisateur = {
        id: '00000000-0000-0000-0000-000000000000',
        email: 'developpement@local',
        nom: 'Mode developpement',
        role: 'admin',
        habiliteDonneesProprietaires: true,
      };
      return;
    }

    try {
      await req.jwtVerify();
      req.utilisateur = req.user as UtilisateurCourant;
    } catch {
      return rep
        .code(401)
        .send({ erreur: { code: 'non_authentifie', message: 'Authentification requise' } });
    }
  });

  // --- Gestion d'erreurs ---------------------------------------------------
  app.setErrorHandler((brut, req, rep) => {
    const err = brut as Error & { statusCode?: number };
    if (err instanceof ErreurSource) {
      // Un echec de source externe n'est pas une erreur applicative : on le signale
      // explicitement pour que l'interface affiche un critere gris plutot qu'un plantage.
      req.log.warn({ err, connecteur: err.connecteur }, 'Source externe indisponible');
      return rep.code(502).send({
        erreur: {
          code: 'source_indisponible',
          message: `La source ${err.connecteur} est momentanement indisponible. Les criteres concernes restent non evalues.`,
          details: { connecteur: err.connecteur, statut: err.statut },
        },
      });
    }
    req.log.error({ err }, 'Erreur non geree');
    const statut = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return rep.code(statut).send({
      erreur: {
        code: statut === 500 ? 'erreur_interne' : 'requete_invalide',
        message:
          statut === 500 && config.env === 'production'
            ? 'Erreur interne du serveur'
            : err.message,
      },
    });
  });

  // --- Routes --------------------------------------------------------------
  await app.register(routesReferentiel);
  await app.register(routesCarte);
  await app.register(routesParcelles);
  await app.register(routesProspection);
  await app.register(routesDivers);

  // --- Interface web -------------------------------------------------------
  // Servie par l'API des lors que son build existe : une installation locale n'a alors
  // qu'une seule commande a lancer et qu'un seul port a ouvrir.
  const interfaceWeb = repertoireInterface();
  if (interfaceWeb) {
    await app.register(statique, optionsStatique(interfaceWeb));
    journal.info({ racine: interfaceWeb }, "Interface web servie par l'API");
  }

  app.setNotFoundHandler((req, rep) => {
    // Application a page unique : une URL inconnue doit rendre l'interface, pas un 404,
    // sinon la navigation directe et le rechargement de page cassent.
    if (interfaceWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return rep.sendFile('index.html');
    }
    return rep.code(404).send({
      erreur: { code: 'route_inconnue', message: `Route inconnue : ${req.method} ${req.url}` },
    });
  });

  return app;
}

async function demarrer(): Promise<void> {
  if (config.fichierEnvCharge) {
    journal.info({ fichier: config.fichierEnvCharge }, 'Configuration chargee depuis .env');
  }

  // 1. La base peut demarrer en meme temps que l'API (conteneurs) : on l'attend.
  const bdd = await attendreBdd(config.demarrage.attenteBddMs);
  if (!bdd) {
    journal.error(
      { url: config.bdd.url.replace(/:[^:@]*@/, ':***@') },
      "Base de donnees injoignable. Verifiez DATABASE_URL et que PostgreSQL est demarre.",
    );
  }

  // 2. Schema et referentiel : l'application initialise sa propre base.
  if (bdd && config.demarrage.migrationsAuto) {
    try {
      const { appliquees, total } = await appliquerMigrations();
      if (appliquees > 0) journal.info({ appliquees, total }, 'Schema mis a jour');
    } catch (err) {
      journal.error(
        { err },
        'Echec des migrations : le serveur demarre mais les donnees seront indisponibles.',
      );
    }
  }
  if (bdd) {
    // Une campagne sans date de fin signale un arret du serveur en cours de traitement :
    // le lot est incomplet, et l'utilisateur doit pouvoir le constater.
    await signalerCampagnesInterrompues().catch((err: unknown) =>
      journal.warn({ err }, 'Verification des campagnes interrompues impossible'),
    );
  }
  if (bdd) {
    const n = await synchroniserReferentiel().catch((err: unknown) => {
      journal.warn({ err }, 'Synchronisation du referentiel des sources impossible');
      return 0;
    });
    journal.info({ connecteurs: n }, 'Referentiel des sources synchronise');
  }

  // 3. Secret de signature et acces : fournis par l'environnement, ou generes.
  const secretJwt = await resoudreSecretJwt(bdd);
  if (bdd) {
    await assurerAdministrateur().catch((err: unknown) =>
      journal.error({ err }, 'Creation du compte administrateur impossible'),
    );
  }

  const app = await construireServeur({ secretJwt });

  if (config.auth.desactivee && config.env !== 'development') {
    journal.warn(
      "AUTH_DESACTIVEE est actif hors developpement : toutes les requetes sont traitees comme administrateur.",
    );
  }

  await app.listen({ port: config.port, host: config.hote });
  journal.info(
    { port: config.port, adresse: `http://localhost:${config.port}` },
    'API de prospection ENR demarree',
  );

  // 4. Donnees nationales : en arriere-plan, apres l'ouverture du port. L'ingestion des
  //    communes dure plusieurs minutes ; l'interface doit rester accessible pendant ce
  //    temps, et son avancement est publie par /api/sante.
  if (bdd && config.demarrage.amorcageAuto) {
    void amorcerSiNecessaire().catch((err: unknown) =>
      journal.error({ err }, 'Amorcage des donnees nationales interrompu'),
    );
  }

  // 5. Scores laisses par une version anterieure du moteur : recalcules a partir des
  //    snapshots stockes, sans reinterroger la moindre source. Une correction du moteur
  //    qui n'atteint pas les parcelles deja qualifiees n'a corrige que le code.
  if (bdd) {
    void (async () => {
      const liberer = await tenterVerrou(864_203);
      if (!liberer) return;
      try {
        await rescorerSiVersionObsolete();
      } finally {
        await liberer();
      }
    })().catch((err: unknown) => journal.error({ err }, 'Recalcul des scores interrompu'));
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      journal.info({ signal }, 'Arret demande');
      void app
        .close()
        .then(fermerBdd)
        .then(() => process.exit(0));
    });
  }
}

// Ne demarre le serveur que si le module est le point d'entree, afin que les tests
// puissent importer `construireServeur` sans ouvrir de port.
const estPointEntree =
  process.argv[1] != null &&
  (import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, '')) ||
    import.meta.url === `file://${process.argv[1]}`);

if (estPointEntree) {
  demarrer().catch((err) => {
    journal.error({ err }, 'Echec du demarrage');
    process.exit(1);
  });
}
