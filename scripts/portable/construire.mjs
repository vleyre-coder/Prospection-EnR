#!/usr/bin/env node
/**
 * Fabrique l'archive de l'application locale pour Windows.
 *
 * A LIRE AVANT DE MODIFIER CE FICHIER : CE QU'IL PEUT ET NE PEUT PAS FAIRE.
 *
 * Ce script tourne sous Linux (ou en integration continue) et produit une archive destinee a
 * Windows. Il assemble donc des binaires qu'il ne peut PAS executer. Deux consequences a
 * assumer plutot qu'a masquer :
 *
 *   1. **La base livree est vide.** Un repertoire de donnees PostgreSQL est lie a la
 *      plateforme ET a la version majeure du serveur : un PGDATA fabrique ici serait refuse
 *      par le PostgreSQL Windows de l'archive. Ce qui traverse, c'est un `pg_dump` en SQL.
 *      L'option `--amorce <fichier.sql.gz>` embarque un tel dump, que `demarrer.mjs` restaure
 *      au premier lancement. Sans lui, l'archive est fonctionnelle mais telechargera les
 *      donnees nationales au premier demarrage.
 *   2. **L'executable n'est pas eprouve ici.** Il est fabrique par injection SEA dans
 *      `node.exe` — operation purement JavaScript, donc faisable depuis Linux — mais son
 *      double-clic ne peut etre constate que sur un poste Windows. C'est pourquoi l'archive
 *      contient AUSSI `Prospection-EnR.cmd`, un lanceur en lot qui fait exactement la meme
 *      chose et ne depend d'aucune injection. Si l'un des deux devait echouer, l'autre reste.
 *
 * CE QUI EST ELAGUE, ET CE QUI NE L'EST PAS. L'archive PostgreSQL pese 323 Mo ; on n'en garde
 * que `bin`, `lib` et `share`, en ENTIER. Les trois dossiers ecartes — `include`, `doc`,
 * `symbols` — ne servent qu'a compiler, lire la documentation et deboguer. En revanche, aucun
 * fichier n'est retire A L'INTERIEUR de `bin` : les dependances entre DLL de PostgreSQL et de
 * PostGIS (ICU, OpenSSL, GEOS, PROJ, GDAL) ne se devinent pas a la lecture des noms, et un
 * elagage trop fin produirait une archive qui plante au premier appel de PostGIS — sur le
 * poste de l'utilisateur, pas ici. Quelques dizaines de megaoctets ne valent pas ce risque.
 *
 * Usage :
 *   node scripts/portable/construire.mjs [--sortie distribution] [--amorce donnees.sql.gz]
 *                                        [--depot <url>] [--sans-archive] [--reutiliser-cache]
 *                                        [--sans-elagage-fin]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Versions FIGEES, et c'est un choix.
 *
 * Une archive « derniere version » ne se reproduit pas : deux fabrications a deux semaines
 * d'ecart donneraient deux PostgreSQL differents, donc deux repertoires de donnees
 * incompatibles entre eux. Un utilisateur qui met a jour son dossier verrait sa base refusee.
 * Les versions sont donc epinglees ici, et changer PG_MAJEUR est une decision a prendre
 * sciemment — avec une note de migration pour les bases existantes.
 */
export const VERSIONS = {
  pgMajeur: 16,
  postgres: '16.4-1',
  postgis: '3.6.2',
  node: process.versions.node,
};

const SOURCES = [
  {
    cle: 'postgres',
    url: `https://get.enterprisedb.com/postgresql/postgresql-${VERSIONS.postgres}-windows-x64-binaries.zip`,
    fichier: `postgresql-${VERSIONS.postgres}-windows-x64.zip`,
  },
  {
    cle: 'postgis',
    url: `https://download.osgeo.org/postgis/windows/pg${VERSIONS.pgMajeur}/postgis-bundle-pg${VERSIONS.pgMajeur}-${VERSIONS.postgis}x64.zip`,
    fichier: `postgis-bundle-${VERSIONS.postgis}.zip`,
  },
  {
    cle: 'node',
    url: `https://nodejs.org/dist/v${VERSIONS.node}/win-x64/node.exe`,
    fichier: 'node.exe',
  },
];

// ------------------------------------------------------------------------------- utilitaires ---

function mo(octets) {
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

/** Taille recursive d'un dossier, en octets. */
export function poids(chemin) {
  if (!existsSync(chemin)) return 0;
  const s = statSync(chemin);
  if (!s.isDirectory()) return s.size;
  return readdirSync(chemin).reduce((total, entree) => total + poids(join(chemin, entree)), 0);
}

function etape(titre) {
  console.log(`\n=== ${titre} ===`);
}

function executer(commande, args, options = {}) {
  const r = spawnSync(commande, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${commande} ${args.join(' ')} a echoue (code ${r.status}).`);
}

// -------------------------------------------------------------------------------- telechargement ---

function telecharger(cache, reutiliser) {
  etape('Telechargement des moteurs');
  mkdirSync(cache, { recursive: true });
  for (const source of SOURCES) {
    const cible = join(cache, source.fichier);
    if (reutiliser && existsSync(cible) && statSync(cible).size > 1024) {
      console.log(`  deja en cache : ${source.fichier} (${mo(statSync(cible).size)})`);
      continue;
    }
    console.log(`  ${source.url}`);
    // `-C -` reprend un telechargement interrompu : ces fichiers pesent des centaines de Mo,
    // et repartir de zero a chaque coupure rendrait la fabrication penible sur un lien fragile.
    executer('curl', ['-fL', '--retry', '3', '--retry-delay', '2', '-C', '-', '-o', cible, source.url]);
    console.log(`  -> ${source.fichier} (${mo(statSync(cible).size)})`);
  }
}

// ------------------------------------------------------------------------------------ moteurs ---

/** Dossiers de l'archive PostgreSQL a conserver. Voir l'en-tete pour le raisonnement. */
export const DOSSIERS_POSTGRES_GARDES = ['bin', 'lib', 'share'];

function preparerPostgres(cache, travail) {
  etape('Extraction et elagage de PostgreSQL');
  const extrait = join(travail, 'pg-extrait');
  rmSync(extrait, { recursive: true, force: true });
  mkdirSync(extrait, { recursive: true });
  // L'archive d'EnterpriseDB place tout sous `pgsql/`.
  executer('unzip', ['-q', join(cache, `postgresql-${VERSIONS.postgres}-windows-x64.zip`), '-d', extrait]);
  const source = join(extrait, 'pgsql');
  if (!existsSync(source)) throw new Error(`Arborescence inattendue : ${source} absent.`);

  const avant = poids(source);
  const cible = join(travail, 'postgres');
  rmSync(cible, { recursive: true, force: true });
  mkdirSync(cible, { recursive: true });
  for (const dossier of DOSSIERS_POSTGRES_GARDES) {
    const de = join(source, dossier);
    if (!existsSync(de)) throw new Error(`Dossier attendu absent de l'archive : ${dossier}`);
    cpSync(de, join(cible, dossier), { recursive: true });
  }
  const ecartes = readdirSync(source).filter((d) => !DOSSIERS_POSTGRES_GARDES.includes(d));
  console.log(`  garde  : ${DOSSIERS_POSTGRES_GARDES.join(', ')}`);
  console.log(`  ecarte : ${ecartes.join(', ') || '(rien)'}`);
  console.log(`  ${mo(avant)} -> ${mo(poids(cible))}`);
  rmSync(extrait, { recursive: true, force: true });
  return cible;
}

function fusionnerPostgis(cache, postgres) {
  etape('Fusion du paquet PostGIS');
  const extrait = join(dirname(postgres), 'postgis-extrait');
  rmSync(extrait, { recursive: true, force: true });
  mkdirSync(extrait, { recursive: true });
  executer('unzip', ['-q', join(cache, `postgis-bundle-${VERSIONS.postgis}.zip`), '-d', extrait]);

  // Le paquet contient un unique dossier `postgis-bundle-pgXX-x.y.z`, calque sur bin/lib/share.
  const [racineBundle] = readdirSync(extrait);
  if (!racineBundle) throw new Error('Paquet PostGIS vide.');
  const source = join(extrait, racineBundle);
  const avant = poids(postgres);
  for (const dossier of readdirSync(source)) {
    const de = join(source, dossier);
    if (!statSync(de).isDirectory()) continue;
    cpSync(de, join(postgres, dossier), { recursive: true, force: true });
  }
  console.log(`  fusionne depuis ${racineBundle}`);
  console.log(`  ${mo(avant)} -> ${mo(poids(postgres))}`);

  // Controle non negociable : sans ces fichiers, l'application ne peut afficher aucune carte.
  // Mieux vaut refuser de produire l'archive que la livrer muette.
  const controles = [
    join(postgres, 'share', 'extension', 'postgis.control'),
    join(postgres, 'bin', 'postgres.exe'),
    join(postgres, 'bin', 'initdb.exe'),
    join(postgres, 'bin', 'psql.exe'),
    join(postgres, 'bin', 'pg_isready.exe'),
    join(postgres, 'bin', 'pg_ctl.exe'),
  ];
  const manquants = controles.filter((c) => !existsSync(c));
  if (manquants.length > 0) {
    throw new Error(`Archive incomplete, fichiers absents :\n  ${manquants.join('\n  ')}`);
  }
  const dllPostgis = readdirSync(join(postgres, 'lib')).filter((f) => /^postgis.*\.dll$/i.test(f));
  if (dllPostgis.length === 0) throw new Error('Aucune bibliotheque PostGIS dans lib/.');
  console.log(`  controle : ${dllPostgis.join(', ')}`);
  rmSync(extrait, { recursive: true, force: true });
}

// ----------------------------------------------------------------------------- elagage fin ---

/**
 * Programmes et modules que l'application invoque ou charge REELLEMENT.
 *
 * Les extensions actives sont celles que `lanceur.mjs` cree : postgis, pgcrypto, btree_gist.
 * `postgis_topology` est ajoute par prudence — il accompagne postgis de pres et ne pese rien.
 */
export const GRAINES = [
  'postgres.exe', 'initdb.exe', 'psql.exe', 'pg_ctl.exe', 'pg_isready.exe',
  // pg_dump/pg_restore servent aux sauvegardes documentees dans docs/HEBERGEMENT.md.
  'pg_dump.exe', 'pg_restore.exe',
  'postgis-3.dll', 'postgis_topology-3.dll', 'pgcrypto.dll', 'btree_gist.dll',
];

/**
 * Familles de `share/extension` a NE PAS livrer. Liste de REFUS et non d'autorisation : une
 * famille inconnue est gardee. Retirer un fichier SQL de trop ne casse que le
 * `CREATE EXTENSION` de cette extension-la — que l'application ne fait jamais pour celles-ci.
 */
export const EXTENSIONS_REFUSEES = [
  'pgrouting', 'mobilitydb', 'postgis_raster', 'postgis_sfcgal',
  'postgis_tiger_geocoder', 'postgis_tiger_geocoder_pre', 'tiger_geocoder', 'tiger_geocoder.in',
  'address_standardizer', 'address_standardizer_data_us', 'ogr_fdw', 'h3', 'h3_postgis',
  'pointcloud', 'pointcloud_postgis',
];

/** Table d'importation d'un binaire PE, y compris les imports differes. */
function importsPE(chemin) {
  const r = spawnSync('objdump', ['-p', chemin], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return [...r.stdout.matchAll(/DLL Name:\s*(\S+)/g)].map((m) => m[1].toLowerCase());
}

/**
 * Retire ce qu'aucun chemin d'execution n'atteint.
 *
 * MESURE QUI JUSTIFIE CETTE ETAPE : le paquet PostGIS fait passer l'arbre de 119,7 Mo a
 * 401,0 Mo, et sur 275 binaires livres, **40 seulement** sont atteignables depuis les graines
 * ci-dessus. Le reste — GDAL (34,8 Mo), SFCGAL (11,3 Mo), wxWidgets et GTK pour une interface
 * graphique de chargement de shapefiles, pgRouting, MobilityDB — n'est jamais charge par cette
 * application.
 *
 * LE RAISONNEMENT DE SURETE, ET SA LIMITE, HONNETEMENT. La fermeture est calculee sur les
 * tables d'importation reelles des binaires, imports differes compris, et non sur les noms de
 * fichiers. Elle a d'ailleurs confirme deux choses utiles : `postgis-3.dll` n'importe NI GDAL
 * NI SFCGAL, et `icudt67.dll` (27 Mo) EST atteignable — le retirer aurait tue PostgreSQL.
 * Ce que la fermeture ne voit pas : un `LoadLibrary` par nom, decide a l'execution. Le seul
 * cas de ce genre ici serait un `CREATE EXTENSION` sur une extension retiree, ce que
 * l'application ne fait pas.
 *
 * En cas de doute sur un poste, `--sans-elagage-fin` produit l'archive complete.
 */
export function elaguerFin(postgres) {
  etape('Elagage fin : ce qu’aucun chemin d’execution n’atteint');
  const avant = poids(postgres);

  // 1. Index de tous les binaires, par nom de fichier en minuscules.
  const index = new Map();
  const parcourir = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const c = join(d, e.name);
      if (e.isDirectory()) parcourir(c);
      else if (/\.(dll|exe)$/i.test(e.name)) index.set(e.name.toLowerCase(), c);
    }
  };
  parcourir(postgres);

  // 2. Fermeture transitive depuis les graines.
  const atteignables = new Set();
  const file = [];
  for (const graine of GRAINES) {
    const cle = graine.toLowerCase();
    if (index.has(cle)) {
      atteignables.add(cle);
      file.push(cle);
    } else {
      console.log(`  graine absente de l'archive : ${graine}`);
    }
  }
  let objdumpMuet = 0;
  while (file.length > 0) {
    const nom = file.shift();
    const deps = importsPE(index.get(nom));
    if (deps == null) {
      objdumpMuet += 1;
      continue;
    }
    for (const dep of deps) {
      if (index.has(dep) && !atteignables.has(dep)) {
        atteignables.add(dep);
        file.push(dep);
      }
    }
  }
  if (objdumpMuet > 0) {
    // Sans lecture fiable des tables d'importation, on ne retire RIEN : une archive un peu
    // grosse vaut infiniment mieux qu'une archive muette sur le poste de l'utilisateur.
    throw new Error(
      `objdump n'a pas su lire ${objdumpMuet} binaire(s) : elagage abandonne. ` +
        'Relancez avec --sans-elagage-fin.',
    );
  }

  // 3. Retrait des binaires inatteignables.
  let retires = 0;
  let gagne = 0;
  const plusGros = [];
  for (const [nom, chemin] of index) {
    if (atteignables.has(nom)) continue;
    const taille = statSync(chemin).size;
    plusGros.push([taille, chemin.slice(postgres.length + 1)]);
    rmSync(chemin);
    retires += 1;
    gagne += taille;
  }
  console.log(`  binaires : ${index.size} presents, ${atteignables.size} atteignables`);
  console.log(`  retires  : ${retires} fichiers, ${mo(gagne)}`);
  for (const [taille, nom] of plusGros.sort((a, b) => b[0] - a[0]).slice(0, 6)) {
    console.log(`      ${mo(taille).padStart(9)}  ${nom}`);
  }

  // 4. Scripts SQL des extensions qu'on ne cree jamais.
  const dossierExt = join(postgres, 'share', 'extension');
  let gagneSql = 0;
  if (existsSync(dossierExt)) {
    for (const fichier of readdirSync(dossierExt)) {
      const famille = fichier.split('--')[0].replace(/\.(control|sql)$/, '');
      if (!EXTENSIONS_REFUSEES.includes(famille)) continue;
      const chemin = join(dossierExt, fichier);
      gagneSql += statSync(chemin).size;
      rmSync(chemin);
    }
  }
  // GDAL n'est plus la : ses donnees de reference ne servent plus a rien.
  const gdalData = join(postgres, 'gdal-data');
  let gagneGdal = 0;
  if (existsSync(gdalData) && !atteignables.has('libgdal-35.dll')) {
    gagneGdal = poids(gdalData);
    rmSync(gdalData, { recursive: true, force: true });
  }
  console.log(`  scripts d'extensions inutilisees : ${mo(gagneSql)}`);
  console.log(`  donnees GDAL devenues orphelines : ${mo(gagneGdal)}`);

  // 5. Le controle qui compte : l'archive doit encore pouvoir servir PostGIS.
  const vitaux = [
    join(postgres, 'bin', 'postgres.exe'),
    join(postgres, 'bin', 'initdb.exe'),
    join(postgres, 'bin', 'psql.exe'),
    join(postgres, 'bin', 'pg_isready.exe'),
    join(postgres, 'bin', 'pg_ctl.exe'),
    join(postgres, 'lib', 'postgis-3.dll'),
    join(postgres, 'share', 'extension', 'postgis.control'),
    join(postgres, 'share', 'extension', 'postgis--3.6.2.sql'),
  ];
  const perdus = vitaux.filter((v) => !existsSync(v));
  if (perdus.length > 0) {
    throw new Error(`L'elagage a retire des fichiers vitaux :\n  ${perdus.join('\n  ')}`);
  }
  console.log(`  ${mo(avant)} -> ${mo(poids(postgres))}`);
}

// -------------------------------------------------------------------------------- application ---

function construireApplication(travail, depot) {
  etape("Construction de l'application");
  executer('npm', ['run', 'build'], { cwd: RACINE });

  /**
   * Un `node_modules` de PRODUCTION, fabrique a part, ET RESTREINT AUX TROIS ESPACES SERVEUR.
   *
   * Copier celui du depot embarquerait Playwright, Vite, TypeScript et leurs navigateurs :
   * plusieurs centaines de megaoctets qui ne servent qu'a developper.
   *
   * MAIS `--omit=dev` SEUL NE SUFFISAIT PAS, et la mesure l'a montre. La premiere version
   * installait les quatre espaces de travail : 137 Mo de `node_modules`, dont maplibre-gl
   * (41 Mo), jsts (13 Mo), @turf (9,6 Mo), @maplibre (9,2 Mo) et @tanstack (4,9 Mo) — 78 Mo
   * de dependances de l'INTERFACE, alors que l'interface est deja compilee dans
   * `apps/web/dist` et n'a plus besoin d'aucun paquet a l'execution. Les selectionner
   * explicitement fait tomber ce poste a une quarantaine de megaoctets.
   *
   * Les quatre `package.json` sont tout de meme copies : sans eux, le graphe d'espaces de
   * travail ne correspondrait plus au fichier de verrouillage et `npm ci` refuserait.
   */
  const app = join(travail, 'application');
  rmSync(app, { recursive: true, force: true });

  /**
   * `application/` est une VRAIE COPIE DE TRAVAIL GIT, pas un tas de fichiers construits.
   *
   * LA PREMIERE VERSION NE COPIAIT QUE LES SORTIES DE CONSTRUCTION — `dist/`, les migrations,
   * quatre `package.json`. Elle demarrait parfaitement, et elle rendait `Pousser-vers-GitHub`
   * inutile : sans les sources ni l'historique, il n'y a rien a envoyer. Or c'est la moitie de
   * ce que l'application locale doit permettre. Le defaut ne se voyait qu'en essayant
   * d'envoyer, c'est-a-dire trop tard.
   *
   * Un clone donc, avec son historique (une soixantaine de commits, une dizaine de Mo). Les
   * sorties de construction et `node_modules` y sont deposees par-dessus : elles sont ignorees
   * par `.gitignore`, donc invisibles pour git et sans effet sur ce qui sera pousse.
   */
  const branche = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: RACINE, encoding: 'utf8',
  }).trim();
  executer('git', ['clone', '--no-hardlinks', '--branch', branche, `file://${RACINE}`, app]);
  // L'origine devient le depot vers lequel l'utilisateur poussera, et non le chemin local
  // qui a servi a fabriquer l'archive et qui n'existe pas sur son poste.
  executer('git', ['remote', 'set-url', 'origin', depot], { cwd: app });
  console.log(`  clone de la branche ${branche}, origine -> ${depot}`);
  executer(
    'npm',
    [
      'ci', '--omit=dev', '--ignore-scripts', '--include-workspace-root',
      '--workspace', '@enr/api', '--workspace', '@enr/core', '--workspace', '@enr/scoring',
    ],
    { cwd: app },
  );

  // Les sorties de construction, deposees par-dessus le clone. Ignorees par git.
  for (const chemin of [
    'packages/core/dist', 'packages/scoring/dist', 'apps/api/dist', 'apps/web/dist',
  ]) {
    cpSync(join(RACINE, chemin), join(app, chemin), { recursive: true });
  }

  /**
   * Les cartes de source de l'interface ne partent pas.
   *
   * Elles pesent 2,7 Mo, ne servent qu'a deboguer dans la console du navigateur, et exposent
   * le code source complet a quiconque ouvre les outils de developpement sur un poste ou
   * l'archive a ete copiee. Aucun de ces deux effets n'est souhaite dans une distribution.
   */
  for (const carte of readdirSync(join(app, 'apps', 'web', 'dist', 'assets')).filter((f) =>
    f.endsWith('.map'),
  )) {
    rmSync(join(app, 'apps', 'web', 'dist', 'assets', carte));
  }

  controlerPortabilite(app);
  console.log(`  application : ${mo(poids(app))}`);
  return app;
}

/**
 * REFUSE de produire une archive dont les dependances ne traverseraient pas la plateforme.
 *
 * `npm ci` tourne ici, sous Linux ; le resultat tournera sous Windows. Pour un arbre de
 * JavaScript pur c'est indifferent — et la mesure dit qu'il l'est aujourd'hui : zero paquet
 * contraint par `os`/`cpu`, zero binaire `.node`. Mais rien ne garantit que ce le restera :
 * une seule dependance a liaison native ajoutee un jour (sharp, bcrypt, better-sqlite3…)
 * produirait une archive qui plante au demarrage SUR LE POSTE DE L'UTILISATEUR, avec un
 * message que personne ne saura relier a la machine de fabrication.
 *
 * Ce controle transforme cette panne lointaine en echec de construction immediat. Le remede,
 * le jour ou il se declenchera, sera de fabriquer l'archive sous Windows — pas de retirer le
 * controle.
 */
export function controlerPortabilite(app) {
  const suspects = [];
  const natifs = [];
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isFile() && entree.name.endsWith('.node')) natifs.push(chemin);
      if (!entree.isDirectory()) continue;
      if (entree.name === 'node_modules' || entree.name.startsWith('@')) {
        parcourir(chemin);
        continue;
      }
      const manifeste = join(chemin, 'package.json');
      if (existsSync(manifeste)) {
        try {
          const j = JSON.parse(readFileSync(manifeste, 'utf8'));
          if (j.os || j.cpu) suspects.push(`${j.name}@${j.version} (os=${j.os} cpu=${j.cpu})`);
        } catch {
          /* un manifeste illisible n'est pas notre affaire ici */
        }
      }
      parcourir(chemin);
    }
  };
  parcourir(join(app, 'node_modules'));

  if (suspects.length > 0 || natifs.length > 0) {
    throw new Error(
      "Ces dependances ne traverseraient pas Linux -> Windows :\n" +
        [...suspects, ...natifs.map((n) => `binaire natif ${n}`)].map((s) => `  ${s}`).join('\n') +
        '\nFabriquez l\'archive sous Windows, ou retirez la dependance.',
    );
  }
  console.log('  portabilite : aucun paquet lie a la plateforme, aucun binaire natif');
}

// ---------------------------------------------------------------------------------- assemblage ---

const LANCEURS = {
  'Prospection-EnR.cmd': `@echo off
title Prospection EnR
cd /d "%~dp0"
set RACINE_PORTABLE=%~dp0
"%~dp0moteurs\\node\\node.exe" "%~dp0application\\scripts\\portable\\demarrer.mjs"
if errorlevel 1 pause
`,
  'Mettre-a-jour.cmd': `@echo off
title Prospection EnR - mise a jour
cd /d "%~dp0application"
"%~dp0moteurs\\node\\node.exe" "%~dp0application\\scripts\\portable\\depot.mjs" mettre-a-jour
pause
`,
  'Pousser-vers-GitHub.cmd': `@echo off
title Prospection EnR - envoi vers GitHub
cd /d "%~dp0application"
set /p MESSAGE=Decrivez vos modifications (Entree pour un libelle par defaut) :
"%~dp0moteurs\\node\\node.exe" "%~dp0application\\scripts\\portable\\depot.mjs" pousser "%MESSAGE%"
pause
`,
};

const LISEZ_MOI = `Prospection EnR - application locale
====================================

DEMARRER : double-cliquez sur Prospection-EnR.exe
           (ou Prospection-EnR.cmd s'il ne repond pas)

La premiere ouverture prepare la base de donnees : comptez une trentaine de
secondes. Les suivantes sont immediates.

Laissez la fenetre noire ouverte pendant l'utilisation. La fermer arrete
proprement l'application et la base.


CE DOSSIER EST TRANSPORTABLE
Copiez-le entier sur une cle USB, branchez-la sur un autre PC, double-cliquez :
memes donnees, aucune installation, aucun droit administrateur.


ATTENTION - DONNEES PERSONNELLES
Le sous-dossier donnees\\ contient votre base : parcelles, pipeline commercial,
et potentiellement des noms de proprietaires, EN CLAIR.

Une cle USB perdue est une violation de donnees a notifier a la CNIL sous
72 heures. Chiffrez le support (BitLocker, VeraCrypt).

Ce dossier n'est JAMAIS envoye sur GitHub : Pousser-vers-GitHub le refuse et
vous explique pourquoi.


INTERNET
"Local" ne veut pas dire "hors ligne". La qualification d'une parcelle interroge
une vingtaine d'API publiques francaises. Sans connexion, seules les parcelles
deja consultees restent lisibles.


EN CAS DE PROBLEME
donnees\\journal.txt contient le detail technique du dernier lancement.
Documentation : application\\docs\\APPLICATION-LOCALE.md
`;

function assembler({ travail, sortie, postgres, application, cache, amorce }) {
  etape("Assemblage de l'arborescence");
  rmSync(sortie, { recursive: true, force: true });
  mkdirSync(join(sortie, 'moteurs', 'node'), { recursive: true });
  mkdirSync(join(sortie, 'donnees'), { recursive: true });

  cpSync(postgres, join(sortie, 'moteurs', 'postgres'), { recursive: true });
  cpSync(join(cache, 'node.exe'), join(sortie, 'moteurs', 'node', 'node.exe'));
  cpSync(application, join(sortie, 'application'), { recursive: true });
  cpSync(join(RACINE, 'docs'), join(sortie, 'application', 'docs'), { recursive: true });

  for (const [nom, contenu] of Object.entries(LANCEURS)) {
    // Fins de ligne Windows : un .cmd en fins de ligne Unix se comporte de facon erratique
    // (cmd.exe avale le dernier caractere de certaines lignes).
    writeFileSync(join(sortie, nom), contenu.replace(/\n/g, '\r\n'));
  }
  writeFileSync(join(sortie, 'LISEZ-MOI.txt'), LISEZ_MOI.replace(/\n/g, '\r\n'));

  if (amorce) {
    const cible = join(sortie, 'donnees', 'amorce.sql.gz');
    cpSync(resolve(amorce), cible);
    console.log(`  amorce nationale : ${mo(statSync(cible).size)}`);
  } else {
    console.log(
      '  PAS D\'AMORCE : le premier demarrage telechargera les donnees nationales\n' +
        '    (5 a 10 minutes). Fournissez --amorce <dump.sql.gz> pour l\'eviter.',
    );
  }
  return sortie;
}

/**
 * Fabrique `Prospection-EnR.exe` par injection SEA dans `node.exe`.
 *
 * Le programme injecte est un talon de quinze lignes en CommonJS — les applications
 * mono-fichier de Node 22 ne chargent que du CommonJS — dont l'unique role est de relancer
 * `node.exe` sur `demarrer.mjs`. Ce minimalisme est deliberé : c'est la seule partie de
 * l'archive que je ne peux pas executer avant livraison, donc celle qui doit contenir le moins
 * de logique possible. Toute la vraie logique reste dans les fichiers .mjs, testables.
 *
 * En cas d'echec, l'archive reste utilisable par `Prospection-EnR.cmd`.
 */
function fabriquerExecutable({ travail, sortie }) {
  etape('Fabrication de Prospection-EnR.exe');
  const talon = join(travail, 'talon.cjs');
  writeFileSync(
    talon,
    `'use strict';
// Talon de lancement. Aucune logique : il relance node.exe sur le vrai lanceur.
const { spawn } = require('node:child_process');
const { dirname, join } = require('node:path');
const racine = dirname(process.execPath);
const enfant = spawn(
  join(racine, 'moteurs', 'node', 'node.exe'),
  [join(racine, 'application', 'scripts', 'portable', 'demarrer.mjs')],
  { stdio: 'inherit', env: Object.assign({}, process.env, { RACINE_PORTABLE: racine }) },
);
enfant.on('error', (e) => {
  console.error('Lancement impossible : ' + e.message);
  console.error('Essayez Prospection-EnR.cmd, qui fait la meme chose.');
  process.exit(1);
});
enfant.on('exit', (code) => process.exit(code === null ? 0 : code));
`,
  );
  const config = join(travail, 'sea-config.json');
  const blob = join(travail, 'talon.blob');
  writeFileSync(
    config,
    JSON.stringify({ main: talon, output: blob, disableExperimentalSEAWarning: true }, null, 2),
  );

  try {
    executer(process.execPath, ['--experimental-sea-config', config]);
    const exe = join(sortie, 'Prospection-EnR.exe');
    cpSync(join(sortie, 'moteurs', 'node', 'node.exe'), exe);
    executer('npx', [
      '--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', blob,
      '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ]);
    console.log(`  Prospection-EnR.exe : ${mo(statSync(exe).size)}`);
    return true;
  } catch (erreur) {
    console.log(`  ECHEC de l'injection SEA : ${erreur.message}`);
    console.log('  L\'archive reste utilisable par Prospection-EnR.cmd.');
    return false;
  }
}

function archiver(sortie) {
  etape("Compression de l'archive");
  const zip = `${sortie}.zip`;
  rmSync(zip, { force: true });
  executer('zip', ['-rq', '-9', zip, basename(sortie)], { cwd: dirname(sortie) });
  console.log(`  ${basename(zip)} : ${mo(statSync(zip).size)}`);
  return zip;
}

// -------------------------------------------------------------------------------------- main ---

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? process.argv[i + 1] : defaut;
}

async function principal() {
  const sortie = resolve(argument('sortie', join(RACINE, 'distribution', 'Prospection-EnR')));
  const cache = resolve(argument('cache', join(RACINE, '.cache-portable')));
  const travail = resolve(argument('travail', join(RACINE, '.travail-portable')));
  const amorce = argument('amorce', null);
  /**
   * Depot vers lequel l'utilisateur poussera. Par defaut l'origine de CETTE copie, ce qui
   * est le comportement attendu ; `--depot` sert a viser un autre compte, par exemple
   * https://github.com/Llegender/Prospection_EnR.git
   */
  const depot = argument(
    'depot',
    execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: RACINE, encoding: 'utf8' }).trim(),
  );
  const reutiliser = process.argv.includes('--reutiliser-cache');

  console.log('Fabrication de l\'application locale Windows');
  console.log(`  PostgreSQL ${VERSIONS.postgres} · PostGIS ${VERSIONS.postgis} · Node ${VERSIONS.node}`);
  console.log(`  depot d'envoi : ${depot}`);

  mkdirSync(travail, { recursive: true });
  telecharger(cache, reutiliser);
  const postgres = preparerPostgres(cache, travail);
  fusionnerPostgis(cache, postgres);
  if (!process.argv.includes('--sans-elagage-fin')) elaguerFin(postgres);
  const application = construireApplication(travail, depot);
  assembler({ travail, sortie, postgres, application, cache, amorce });
  const exeFait = fabriquerExecutable({ travail, sortie });

  etape('Recapitulatif');
  const lignes = [
    ['moteurs/postgres', poids(join(sortie, 'moteurs', 'postgres'))],
    ['moteurs/node', poids(join(sortie, 'moteurs', 'node'))],
    ['application', poids(join(sortie, 'application'))],
    ['donnees', poids(join(sortie, 'donnees'))],
  ];
  for (const [nom, taille] of lignes) console.log(`  ${nom.padEnd(20)} ${mo(taille)}`);
  console.log(`  ${'TOTAL'.padEnd(20)} ${mo(poids(sortie))}`);
  console.log(`  executable SEA       ${exeFait ? 'produit' : 'ABSENT — utiliser le .cmd'}`);

  if (!process.argv.includes('--sans-archive')) archiver(sortie);

  console.log(
    '\nCE QUI N\'A PAS PU ETRE EPROUVE ICI : le double-clic. Les binaires sont pour Windows,\n' +
      'cet environnement est sous Linux. Le premier lancement sur un poste Windows reste la\n' +
      'seule verification qui vaille.',
  );
}

principal().catch((erreur) => {
  console.error(`\nECHEC : ${erreur.message}`);
  process.exit(1);
});
