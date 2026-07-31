/** Serveur HTTP Fastify. */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config.js';
import { journal } from './journal.js';
import { bddDisponible, fermerBdd } from './bdd.js';
import { synchroniserReferentiel } from './depots/sources.js';
import { routesReferentiel } from './routes/referentiel.js';
import { routesCarte } from './routes/carte.js';
import { routesParcelles } from './routes/parcelles.js';
import { routesProspection } from './routes/prospection.js';
import { routesDivers } from './routes/divers.js';
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

export async function construireServeur() {
  const app = Fastify({
    // Fastify 5 distingue `logger` (options de configuration) de `loggerInstance`
    // (instance pino deja construite) : ici, l'instance partagee de l'application.
    loggerInstance: journal,
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.env === 'development' ? true : /\.?localhost|127\.0\.0\.1/,
    credentials: true,
  });

  await app.register(jwt, { secret: config.auth.secretJwt });

  // --- Authentification ----------------------------------------------------
  app.addHook('onRequest', async (req, rep) => {
    if (!req.url.startsWith('/api/')) return;
    if (ROUTES_PUBLIQUES.some((r) => req.url.startsWith(r))) return;
    // Les tuiles vectorielles sont servies sans authentification : elles ne contiennent
    // aucune donnee nominative, et l'imposer casserait le cache du client cartographique.
    if (req.url.startsWith('/api/carte/tuiles/')) return;
    // Meme raison pour le relais du fond de carte : ce sont des tuiles IGN publiques.
    if (req.url.startsWith('/api/carte/fond/')) return;

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

  app.setNotFoundHandler((req, rep) =>
    rep.code(404).send({
      erreur: { code: 'route_inconnue', message: `Route inconnue : ${req.method} ${req.url}` },
    }),
  );

  // --- Routes --------------------------------------------------------------
  await app.register(routesReferentiel);
  await app.register(routesCarte);
  await app.register(routesParcelles);
  await app.register(routesProspection);
  await app.register(routesDivers);

  return app;
}

async function demarrer(): Promise<void> {
  const app = await construireServeur();

  const bdd = await bddDisponible();
  if (!bdd) {
    journal.error(
      { url: config.bdd.url.replace(/:[^:@]*@/, ':***@') },
      "Base de donnees injoignable. Lancez `npm run db:migrate` et verifiez DATABASE_URL.",
    );
  } else {
    const n = await synchroniserReferentiel().catch((err) => {
      journal.warn({ err }, 'Synchronisation du referentiel des sources impossible');
      return 0;
    });
    journal.info({ connecteurs: n }, 'Referentiel des sources synchronise');
  }

  if (config.auth.desactivee && config.env !== 'development') {
    journal.warn(
      "AUTH_DESACTIVEE est actif hors developpement : toutes les requetes sont traitees comme administrateur.",
    );
  }

  await app.listen({ port: config.port, host: config.hote });
  journal.info({ port: config.port }, 'API de prospection ENR demarree');

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
