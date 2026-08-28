#!/usr/bin/env node
/**
 * Le geste que fait l'utilisateur : un double-clic, et l'application s'ouvre.
 *
 * Ce fichier est l'orchestration, et rien d'autre : la base est ouverte par `lanceur.mjs`,
 * l'API est celle du depot. Ce qui est propre a l'installation portable et qui vit ici :
 *
 *   - **le premier remplissage.** La base livree dans l'archive est vide : un repertoire
 *     PostgreSQL est lie a la plateforme ET a la version majeure, donc il ne peut pas etre
 *     fabrique ailleurs que sur la machine qui l'utilisera. Ce qui EST transportable, c'est un
 *     `pg_dump` en SQL. `donnees/amorce.sql.gz`, s'il est present dans l'archive, est donc
 *     restaure au premier lancement — c'est ce qui evite d'attendre l'ingestion nationale.
 *   - **l'arret propre.** Fermer la fenetre ne doit pas laisser une base a recuperer au
 *     prochain lancement. Trois signaux sont couverts, dont la fermeture de la console
 *     Windows.
 *   - **l'ouverture du navigateur**, une fois l'API reellement prete et pas avant : une page
 *     ouverte trop tot affiche une erreur de connexion, et l'utilisateur conclut que ca ne
 *     marche pas.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';
import { ouvrirBase, racinePortable } from './lanceur.mjs';

const SOUS_WINDOWS = process.platform === 'win32';

/** Ouvre l'URL dans le navigateur par defaut, sans dependance externe. */
function ouvrirNavigateur(url) {
  if (SOUS_WINDOWS) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Restaure l'amorce nationale si elle est fournie et que la base vient d'etre creee.
 *
 * Un `pg_dump` compresse, et non un repertoire de donnees : un PGDATA est lie a la plateforme
 * et a la version majeure de PostgreSQL, donc infabricable ailleurs que sur la machine cible.
 * Le SQL, lui, traverse.
 */
async function restaurerAmorce({ racine, url, journal = console }) {
  const amorce = join(racine, 'donnees', 'amorce.sql.gz');
  if (!existsSync(amorce)) {
    journal.log(
      "Aucune amorce nationale dans l'archive : les donnees de reference seront\n" +
        '  telechargees en arriere-plan au premier demarrage (5 a 10 minutes).',
    );
    return false;
  }
  const mo = (statSync(amorce).size / 1048576).toFixed(0);
  journal.log(`Restauration des donnees de reference (${mo} Mo, une seule fois)...`);
  const binaires = join(racine, 'moteurs', 'postgres', 'bin');
  const psql = spawn(join(binaires, SOUS_WINDOWS ? 'psql.exe' : 'psql'), [url, '-q', '-v', 'ON_ERROR_STOP=1'], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  await new Promise((resoudre, rejeter) => {
    createReadStream(amorce).pipe(createGunzip()).pipe(psql.stdin);
    psql.on('exit', (code) =>
      code === 0 ? resoudre() : rejeter(new Error(`Restauration interrompue (code ${code}).`)),
    );
  });
  journal.log('Donnees de reference en place.');
  return true;
}

async function principal() {
  const racine = racinePortable();
  const journal = console;

  journal.log('');
  journal.log('  Prospection EnR — application locale');
  journal.log('  ' + '-'.repeat(38));
  journal.log('');

  const base = await ouvrirBase({ racine, journal });
  let apiArretee = false;

  const arretPropre = (code = 0) => {
    if (apiArretee) return;
    apiArretee = true;
    journal.log('\nFermeture...');
    base.arreter();
    process.exit(code);
  };
  // SIGBREAK couvre la fermeture de la console Windows ; sans lui, la base resterait a
  // recuperer au lancement suivant.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(signal, () => arretPropre(0));
  }

  try {
    if (base.premiereOuverture) {
      // Les migrations d'abord : l'amorce suppose le schema en place.
      journal.log('Application du schema...');
      const migrations = spawnSync(
        join(racine, 'moteurs', 'node', SOUS_WINDOWS ? 'node.exe' : 'node'),
        [join(racine, 'application', 'apps', 'api', 'dist', 'scripts', 'migrer.js')],
        { env: { ...process.env, DATABASE_URL: base.url }, stdio: 'inherit' },
      );
      if (migrations.status !== 0) throw new Error('Les migrations ont echoue.');
      await restaurerAmorce({ racine, url: base.url, journal });
    }

    journal.log("Demarrage de l'application...");
    const api = spawn(
      join(racine, 'moteurs', 'node', SOUS_WINDOWS ? 'node.exe' : 'node'),
      [join(racine, 'application', 'apps', 'api', 'dist', 'serveur.js')],
      {
        env: {
          ...process.env,
          DATABASE_URL: base.url,
          HOTE: '127.0.0.1',
          PORT: '3000',
          NODE_ENV: 'production',
          SERVIR_WEB: 'true',
          MIGRATIONS_AUTO: 'true',
          /**
           * L'amorcage reste actif meme apres restauration de l'amorce : le serveur constate
           * que les donnees sont la et n'y revient pas. Le couper aurait fige les donnees de
           * reference a la date de fabrication de l'archive, sans que personne le remarque —
           * or les postes sources et leur saturation changent tous les mois.
           */
          AMORCAGE_AUTO: 'true',
          // Poste personnel, base dans le dossier de l'utilisateur, ecoute sur la boucle
          // locale : un ecran de connexion n'ajouterait rien. Ce reglage est refuse en
          // production par le serveur lui-meme des que NODE_ENV vaut 'production' sur un
          // hebergement — voir apps/api/src/serveur.ts. Ici, il est explicite et assume.
          AUTH_DESACTIVEE: 'true',
        },
        stdio: 'inherit',
      },
    );
    api.on('exit', (code) => arretPropre(code ?? 0));

    // L'API annonce son ecoute ; on attend qu'elle reponde vraiment avant d'ouvrir la page.
    const url = 'http://127.0.0.1:3000';
    const debut = Date.now();
    for (;;) {
      if (Date.now() - debut > 90_000) throw new Error("L'application n'a pas demarre en 90 s.");
      try {
        const r = await fetch(`${url}/api/sante`);
        if (r.ok) break;
      } catch {
        /* pas encore la */
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    journal.log('');
    journal.log(`  Application ouverte : ${url}`);
    journal.log('  Laissez cette fenetre ouverte. Fermez-la pour arreter.');
    journal.log('');
    ouvrirNavigateur(url);
  } catch (erreur) {
    journal.error(`\nECHEC : ${erreur.message}`);
    journal.error('Details techniques dans donnees/journal.txt');
    arretPropre(1);
  }
}

principal();
