#!/usr/bin/env node
/**
 * Lanceur de l'application portable : un dossier, un double-clic, aucune installation.
 *
 * CE QU'IL RESOUT. `demarrer.bat` suppose Node ET PostgreSQL deja installes sur le poste —
 * deux installations, un mot de passe `postgres` a retrouver, un Stack Builder ou cocher
 * PostGIS. Ici, les deux moteurs voyagent DANS le dossier. Copier le dossier sur une cle USB
 * et le brancher ailleurs suffit : memes donnees, aucun droit administrateur, aucune trace
 * laissee sur le poste hote.
 *
 * ARBORESCENCE ATTENDUE, et elle explique tous les chemins de ce fichier :
 *
 *   Prospection-EnR/
 *     Prospection-EnR.exe        le lanceur (ce script, empaquete)
 *     moteurs/
 *       node/node.exe
 *       postgres/bin/{postgres,initdb,pg_ctl,psql}.exe   + lib/ + share/ (PostGIS compris)
 *     application/               le depot construit (dist + node_modules de production)
 *     donnees/
 *       pgdata/                  LA BASE — jamais versionnee, voir scripts/portable/depot.mjs
 *       journal.txt
 *
 * TROIS DECISIONS QUI NE SE DEVINENT PAS A LA LECTURE :
 *
 * 1. **Un port choisi, pas impose.** 5432 est presque toujours pris sur un poste ou
 *    PostgreSQL a deja ete installe une fois — et sur le poste d'un collegue, on ne sait pas.
 *    Le lanceur prend le premier port libre au-dessus de 54329, et l'ecrit dans le journal.
 * 2. **Ecoute sur la boucle locale uniquement**, et authentification `trust` restreinte a
 *    celle-ci. C'est defendable pour une base qui vit dans un dossier de bureau et qui n'est
 *    joignable que depuis la machine ; ce ne le serait pas une seconde sur un serveur, et
 *    c'est pourquoi ce lanceur ne sert QUE l'installation portable.
 * 3. **`--binaires` existe pour les tests.** Sans lui, la sequence complete — initdb, demarrage,
 *    creation de la base, extensions, migrations — ne serait verifiable que sur un poste
 *    Windows equipe du paquet complet, c'est-a-dire jamais en integration continue. Avec lui,
 *    la meme sequence tourne contre le PostgreSQL du systeme, sur Linux, dans un dossier
 *    jetable. Ce n'est pas une porte derobee : elle ne change aucun comportement, elle designe
 *    seulement ou trouver les binaires.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOUS_WINDOWS = process.platform === 'win32';
const EXE = SOUS_WINDOWS ? '.exe' : '';

/** Nom du role et de la base. Fixes : ils ne servent qu'a l'interieur du dossier. */
export const COMPTE = 'enr';
export const BASE = 'prospection_enr';

/** Premier port tente pour PostgreSQL. Volontairement loin de 5432, souvent occupe. */
export const PORT_BASE_DEPART = 54329;

/**
 * Racine de l'installation portable.
 *
 * Depuis `scripts/portable/` en developpement, deux niveaux au-dessus. Empaquete, le script
 * est a la racine : `RACINE_PORTABLE` le dit alors explicitement.
 */
export function racinePortable(env = process.env) {
  if (env['RACINE_PORTABLE']) return resolve(env['RACINE_PORTABLE']);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Port de depart de l'APPLICATION, distinct de celui de la base.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE N'EST PLUS 3000, ET C'EST LE DEFAUT LE PLUS PROBABLE DE TOUT CE CHANTIER
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le lanceur servait l'application sur 3000, en dur, et commencait par demander
 * `GET http://127.0.0.1:3000/api/sante` : si ca repondait, il concluait « elle est deja
 * ouverte », ouvrait le navigateur et sortait en SUCCES. Or 3000 est l'un des ports les plus
 * disputes d'un poste de travail — Docker, un serveur de developpement, Grafana, une
 * application Electron.
 *
 * MESURE, audit 11. Un service tiers quelconque place sur 3000, qui repond 200 comme le font la
 * plupart : le lanceur annonce « l'application etait deja ouverte », ouvre le navigateur SUR CE
 * SERVICE, et sort en 0. L'utilisateur double-clique, voit s'ouvrir une page qui n'est pas la
 * sienne, et l'application ne demarre jamais. Aucun message, aucune trace, code de sortie 0.
 *
 * Deux fautes distinctes, corrigees separement :
 *   1. la sonde acceptait N'IMPORTE QUEL 200 — voir `estNotreApplication()` ;
 *   2. le port etait fige, donc meme reconnu, le squatteur bloquait l'application — d'ou ce
 *      port de depart et la recherche d'un port libre, comme cela se faisait deja pour
 *      PostgreSQL. Le port retenu est ecrit dans `donnees/port.txt`, sans quoi le second
 *      double-clic ne saurait plus ou chercher la fenetre a ramener.
 */
export const PORT_APPLICATION_DEPART = 3000;

/** Fichier ou le lanceur note le port retenu, pour que le prochain lancement le retrouve. */
const FICHIER_PORT = 'port.txt';

/**
 * Est-ce BIEN notre application qui repond, et pas un inconnu sur le meme port ?
 *
 * Fonction pure, pour etre testable sans reseau. Le critere est la signature de la reponse de
 * `/api/sante` : `versionMoteur` et `baseDeDonnees` y sont toujours presents et ne se
 * rencontrent pas ailleurs par hasard. Un simple code 200 ne prouve rien — c'est exactement ce
 * qui a fait ouvrir le navigateur sur le service d'un tiers.
 */
export function estNotreApplication(corps) {
  if (typeof corps === 'string') {
    try {
      corps = JSON.parse(corps);
    } catch {
      return false;
    }
  }
  if (corps === null || typeof corps !== 'object') return false;
  return typeof corps.versionMoteur === 'string' && typeof corps.baseDeDonnees === 'string';
}

/** Port note par un lancement precedent, ou `null` si le fichier manque ou est illisible. */
export function lirePortEnregistre(racine) {
  try {
    const brut = readFileSync(join(racine, 'donnees', FICHIER_PORT), 'utf8').trim();
    const port = Number(brut);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

export function enregistrerPort(racine, port) {
  const fichier = join(racine, 'donnees', FICHIER_PORT);
  mkdirSync(dirname(fichier), { recursive: true });
  writeFileSync(fichier, `${port}\n`);
}

/** Premier port TCP libre a partir de `depart`, sur la boucle locale. */
export function portLibre(depart = PORT_BASE_DEPART, essais = 50) {
  return new Promise((resoudre, rejeter) => {
    let port = depart;
    const tenter = () => {
      if (port >= depart + essais) {
        rejeter(new Error(`Aucun port libre entre ${depart} et ${depart + essais}.`));
        return;
      }
      const serveur = createServer();
      serveur.once('error', () => {
        port += 1;
        tenter();
      });
      serveur.once('listening', () => serveur.close(() => resoudre(port)));
      serveur.listen(port, '127.0.0.1');
    };
    tenter();
  });
}

/**
 * Localise les binaires PostgreSQL.
 *
 * L'ordre compte : le dossier embarque d'abord, pour qu'une installation systeme presente sur
 * le poste ne prenne JAMAIS le pas sur celle qui voyage avec les donnees. Une base creee par
 * PostgreSQL 16 et ouverte par un PostgreSQL 17 present sur le poste hote refuserait de
 * demarrer — et l'utilisateur n'aurait aucun moyen de comprendre pourquoi.
 */
export function dossierBinaires(racine, surcharge) {
  if (surcharge) return resolve(surcharge);
  const embarque = join(racine, 'moteurs', 'postgres', 'bin');
  if (existsSync(join(embarque, `postgres${EXE}`))) return embarque;
  throw new Error(
    `Moteur PostgreSQL introuvable dans ${embarque}.\n` +
      "Le dossier a-t-il ete decompresse en entier ? Utilisez --binaires <dossier> pour en designer un autre.",
  );
}

function outil(binaires, nom) {
  return join(binaires, `${nom}${EXE}`);
}

/**
 * EXPORTEE depuis l'audit 11. `demarrer.mjs` en a besoin pour y verser la sortie d'erreur de
 * l'API, qui n'y allait pas : le message d'echec renvoyait vers `donnees\\journal.txt` alors
 * que ce fichier ne contenait que les lignes de PostgreSQL. Or l'API est le composant qui
 * echoue le plus volontiers — migrations, port, base — et son erreur partait sur une console
 * qui se ferme. Renvoyer quelqu'un vers un fichier qui ne contient pas la reponse est une
 * fausse piste, pas une aide.
 */
export function journaliser(racine, ligne) {
  const fichier = join(racine, 'donnees', 'journal.txt');
  mkdirSync(dirname(fichier), { recursive: true });
  appendFileSync(fichier, `${new Date().toISOString()}  ${ligne}\n`);
}

/**
 * Cree le repertoire de donnees s'il n'existe pas.
 *
 * `--auth=trust` avec `listen_addresses=127.0.0.1` : la base n'est joignable que depuis la
 * machine, dans un dossier que son proprietaire ouvre deja. Y ajouter un mot de passe
 * n'ajouterait aucune securite (il serait dans le meme dossier) et ajouterait une panne
 * possible. Ce qui protege reellement, c'est l'authentification de l'application elle-meme.
 */
export function preparerBase({ racine, binaires, journal = console }) {
  const pgdata = join(racine, 'donnees', 'pgdata');
  if (existsSync(join(pgdata, 'PG_VERSION'))) return { pgdata, cree: false };

  journal.log('Premiere ouverture : preparation de la base (une seule fois, ~30 s)...');
  mkdirSync(pgdata, { recursive: true });
  const r = spawnSync(
    outil(binaires, 'initdb'),
    ['-D', pgdata, '-U', COMPTE, '--encoding=UTF8', '--locale=C', '--auth=trust'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`initdb a echoue :\n${r.stderr || r.stdout}`);
  }
  return { pgdata, cree: true };
}

/** Demarre PostgreSQL et rend le processus, une fois la base joignable. */
export async function demarrerBase({ racine, binaires, pgdata, port, journal = console }) {
  const processus = spawn(
    outil(binaires, 'postgres'),
    [
      '-D', pgdata,
      '-p', String(port),
      '-c', 'listen_addresses=127.0.0.1',
      '-c', 'logging_collector=off',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  processus.stdout.on('data', (d) => journaliser(racine, `pg: ${String(d).trim()}`));
  processus.stderr.on('data', (d) => journaliser(racine, `pg: ${String(d).trim()}`));

  const debut = Date.now();
  const limiteMs = 60_000;
  for (;;) {
    /**
     * `-U COMPTE` n'est pas decoratif. Sans lui, `pg_isready` se connecte sous le nom du
     * compte du systeme, qui n'existe pas comme role dans cette base : PostgreSQL repond
     * bien — c'est tout ce que `pg_isready` demande — mais inscrit un `FATAL: role "..."
     * does not exist` dans le journal, a CHAQUE demarrage. Or `donnees/journal.txt` est le
     * fichier qu'on ouvre quand quelque chose ne va pas : y laisser une erreur fatale de
     * routine, c'est apprendre a ignorer les erreurs fatales.
     */
    const pret = spawnSync(
      outil(binaires, 'pg_isready'),
      ['-h', '127.0.0.1', '-p', String(port), '-U', COMPTE, '-d', 'postgres'],
      { encoding: 'utf8' },
    );
    if (pret.status === 0) break;
    if (processus.exitCode != null) {
      throw new Error(
        `PostgreSQL s'est arrete au demarrage (code ${processus.exitCode}). Voir donnees/journal.txt.`,
      );
    }
    if (Date.now() - debut > limiteMs) {
      processus.kill();
      throw new Error("PostgreSQL n'a pas repondu en 60 secondes. Voir donnees/journal.txt.");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  journal.log(`Base de donnees prete (port ${port}).`);
  return processus;
}

/** Cree la base applicative et ses extensions si elles manquent. Idempotent. */
export function preparerSchema({ binaires, port, journal = console }) {
  const psql = (base, sql) =>
    spawnSync(outil(binaires, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', COMPTE, '-d', base, '-tAc', sql], {
      encoding: 'utf8',
    });

  const existe = psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${BASE}'`);
  if (existe.stdout.trim() !== '1') {
    journal.log('Creation de la base applicative...');
    const c = psql('postgres', `CREATE DATABASE ${BASE} OWNER ${COMPTE}`);
    if (c.status !== 0) throw new Error(`Creation de la base impossible :\n${c.stderr}`);
  }

  for (const ext of ['postgis', 'pgcrypto', 'btree_gist']) {
    const e = psql(BASE, `CREATE EXTENSION IF NOT EXISTS ${ext}`);
    if (e.status !== 0) {
      throw new Error(
        `L'extension ${ext} n'a pas pu etre activee :\n${e.stderr}\n` +
          (ext === 'postgis'
            ? "PostGIS manque dans le moteur embarque : l'archive est incomplete."
            : ''),
      );
    }
  }
  return `postgres://${COMPTE}@127.0.0.1:${port}/${BASE}`;
}

/** Arrete proprement PostgreSQL. Un arret brutal laisserait la base a recuperer au prochain lancement. */
export function arreterBase({ binaires, pgdata, processus, journal = console }) {
  try {
    spawnSync(outil(binaires, 'pg_ctl'), ['-D', pgdata, '-m', 'fast', 'stop'], { encoding: 'utf8' });
  } catch {
    /* le kill ci-dessous reste le filet */
  }
  if (processus && processus.exitCode == null) processus.kill();
  journal.log('Base de donnees arretee.');
}

/**
 * Sequence complete. Rend l'URL de connexion et de quoi tout arreter.
 *
 * Separee de la ligne de commande pour etre appelable par un test : c'est cette fonction que
 * `test/portable-lanceur.test.ts` execute, contre le PostgreSQL du systeme.
 */
export async function ouvrirBase({ racine, binaires: surcharge, journal = console } = {}) {
  const base = racine ?? racinePortable();
  const binaires = dossierBinaires(base, surcharge);
  const { pgdata, cree } = preparerBase({ racine: base, binaires, journal });
  const port = await portLibre();
  const processus = await demarrerBase({ racine: base, binaires, pgdata, port, journal });
  try {
    const url = preparerSchema({ binaires, port, journal });
    return {
      url,
      port,
      premiereOuverture: cree,
      arreter: () => arreterBase({ binaires, pgdata, processus, journal }),
    };
  } catch (erreur) {
    arreterBase({ binaires, pgdata, processus, journal });
    throw erreur;
  }
}
