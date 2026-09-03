#!/usr/bin/env node
/**
 * Le geste que fait l'utilisateur : un double-clic, et l'application s'ouvre.
 *
 * Ce fichier est l'orchestration, et rien d'autre : la base est ouverte par `lanceur.mjs`,
 * l'affichage est tenu par `animation.mjs`, l'API est celle du depot. Ce qui est propre a
 * l'application de bureau et qui vit ici :
 *
 *   - **la sequence rendue VISIBLE.** Entre le double-clic et la carte il s'ecoule cinq
 *     secondes, une trentaine a la premiere ouverture. La sequence est donc decoupee en etapes
 *     nommees et chronometrees, plutot que d'appeler `ouvrirBase()` d'un bloc : un blocage se
 *     lit alors sur la ligne ou la roue s'est arretee, et non dans un silence.
 *   - **le premier remplissage.** La base livree dans l'archive est vide : un repertoire
 *     PostgreSQL est lie a la plateforme ET a la version majeure, donc il ne peut pas etre
 *     fabrique ailleurs que sur la machine qui l'utilisera. Ce qui EST transportable, c'est un
 *     `pg_dump` en SQL. `donnees/amorce.sql.gz`, s'il est present, est restaure au premier
 *     lancement — c'est ce qui evite d'attendre l'ingestion nationale.
 *   - **le raccourci sur le bureau**, propose une seule fois, a la premiere ouverture.
 *   - **l'arret propre.** Fermer la fenetre ne doit pas laisser une base a recuperer au
 *     prochain lancement. Trois signaux sont couverts, dont la fermeture de la console Windows.
 *   - **l'ouverture du navigateur**, une fois l'API reellement prete et pas avant : une page
 *     ouverte trop tot affiche une erreur de connexion, et l'utilisateur conclut que ca ne
 *     marche pas.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';
import { Progression, attendreLecture, banniere } from './animation.mjs';
import {
  PORT_APPLICATION_DEPART,
  demarrerBase, dossierBinaires, enregistrerPort, estNotreApplication, journaliser,
  lirePortEnregistre, portLibre, preparerBase, preparerSchema, racinePortable,
} from './lanceur.mjs';

/**
 * L'application repond-elle DEJA sur ce port, et est-ce bien la notre ?
 *
 * Rend l'adresse si oui, `null` sinon. La verification du CORPS est la correction du defaut
 * mesure a l'audit 11 : la version precedente se contentait du code 200, si bien que n'importe
 * quel service occupant le port 3000 — Docker, un serveur de developpement, Grafana — faisait
 * annoncer « l'application etait deja ouverte », ouvrir le navigateur SUR CE SERVICE, et sortir
 * en succes. Verifie en placant un service tiers sur 3000 : le lanceur ouvrait sa page et
 * l'application ne demarrait jamais, sans un mot.
 */
async function applicationDejaLa(port) {
  const adresse = `http://127.0.0.1:${port}`;
  try {
    const rep = await fetch(`${adresse}/api/sante`, { signal: AbortSignal.timeout(1500) });
    if (!rep.ok) return null;
    return estNotreApplication(await rep.text()) ? adresse : null;
  } catch {
    return null;
  }
}

const SOUS_WINDOWS = process.platform === 'win32';
const NODE = SOUS_WINDOWS ? 'node.exe' : 'node';

/**
 * Ouvre l'URL dans le navigateur par defaut, et NE FAIT JAMAIS TOMBER L'APPLICATION.
 *
 * LE DEFAUT QUE CE GESTIONNAIRE D'ERREUR CORRIGE, trouve en lancant reellement la sequence.
 * La version precedente appelait `spawn(...)` sans ecouter l'evenement `error`. Le programme
 * d'ouverture etant absent, Node a relance l'erreur comme un evenement non gere : le lanceur
 * s'est arrete net — apres avoir demarre la base, applique le schema et servi l'interface,
 * qui repondaient toutes deux correctement. L'utilisateur aurait vu la fenetre se fermer une
 * seconde apres l'annonce « L'application est ouverte », et conclu a une panne totale, alors
 * que le seul echec etait cosmetique.
 *
 * Ne pas savoir ouvrir un navigateur n'est pas une raison d'arreter une application qui
 * fonctionne : on le dit, on donne l'adresse, et on continue.
 */
function ouvrirNavigateur(url, progression) {
  const [commande, args] = SOUS_WINDOWS
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const enfant = spawn(commande, args, { detached: true, stdio: 'ignore' });
    enfant.on('error', () => {
      progression.note(`Ouvrez vous-meme cette adresse dans votre navigateur : ${url}`);
    });
    enfant.unref();
  } catch {
    progression.note(`Ouvrez vous-meme cette adresse dans votre navigateur : ${url}`);
  }
}

/**
 * Pose le raccourci sur le bureau, une seule fois.
 *
 * PAR POWERSHELL, ET NON EN ECRIVANT LE FICHIER. Un `.lnk` est un format binaire Windows ; un
 * `.lnk` mal forme est PIRE qu'absent — l'icone apparait, puis le double-clic echoue sans
 * message utile. `WScript.Shell` est le mecanisme officiel, present sur toute installation
 * depuis Windows 2000, et c'est lui qui garantit un raccourci valide.
 *
 * L'echec n'est jamais fatal : un raccourci manquant n'empeche pas de travailler, alors
 * qu'une application qui refuse de demarrer parce qu'elle n'a pas su decorer un bureau serait
 * absurde.
 */
function poserRaccourci(racine, progression) {
  if (!SOUS_WINDOWS) return false;
  const cible = join(racine, 'Prospection-EnR.exe');
  const script = [
    "$b=[Environment]::GetFolderPath('Desktop');",
    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $b 'Prospection EnR.lnk'));",
    `$s.TargetPath='${cible}';`,
    `$s.WorkingDirectory='${racine}';`,
    `$s.IconLocation='${cible}';`,
    "$s.Description='Prospection fonciere pour projets d''energies renouvelables';",
    '$s.Save();',
  ].join(' ');
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (r.status === 0) {
    progression.note('Raccourci « Prospection EnR » place sur votre bureau.');
    return true;
  }
  progression.note(
    'Raccourci non cree — double-cliquez sur Creer-un-raccourci.cmd pour reessayer.',
  );
  return false;
}

/**
 * Restaure l'amorce nationale si elle est fournie.
 *
 * Un `pg_dump` compresse, et non un repertoire de donnees : un PGDATA est lie a la plateforme
 * et a la version majeure de PostgreSQL, donc infabricable ailleurs que sur la machine cible.
 * Le SQL, lui, traverse.
 */
async function restaurerAmorce({ racine, url, binaires }) {
  const amorce = join(racine, 'donnees', 'amorce.sql.gz');
  if (!existsSync(amorce)) return null;
  const mo = (statSync(amorce).size / 1048576).toFixed(0);
  const psql = spawn(join(binaires, SOUS_WINDOWS ? 'psql.exe' : 'psql'), [url, '-q', '-v', 'ON_ERROR_STOP=1'], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let erreur = '';
  psql.stderr.on('data', (d) => (erreur += String(d)));
  await new Promise((resoudre, rejeter) => {
    createReadStream(amorce).pipe(createGunzip()).pipe(psql.stdin);
    psql.on('exit', (code) =>
      code === 0 ? resoudre() : rejeter(new Error(erreur.split('\n')[0] || `code ${code}`)),
    );
  });
  return `${mo} Mo`;
}

async function principal() {
  const racine = racinePortable();
  const progression = new Progression();
  process.stdout.write(banniere());

  let base = null;
  const arretPropre = (code = 0) => {
    if (base) {
      const aArreter = base;
      base = null;
      progression.arreter();
      process.stdout.write('\n  Fermeture...\n');
      aArreter.arreter();
    }
    process.exit(code);
  };
  // SIGBREAK couvre la fermeture de la console Windows ; sans lui, la base resterait a
  // recuperer au lancement suivant.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => arretPropre(0));

  try {
    const binaires = dossierBinaires(racine);
    const muet = { log: () => {}, error: () => {} };

    /**
     * DEUXIEME DOUBLE-CLIC : on ouvre la fenetre, on ne redemarre rien.
     *
     * C'est le geste le plus courant sur un bureau — l'utilisateur ne voit pas la fenetre
     * derriere les autres et reclique sur l'icone. Sans ce controle, le second lancement
     * echouait sur `lock file "postmaster.pid" already exists` et affichait « le demarrage a
     * echoue », alors que l'application marchait parfaitement. Constate en test, message
     * releve dans le journal.
     *
     * ON CHERCHE D'ABORD LE PORT NOTE PAR LE LANCEMENT PRECEDENT, puis le port historique.
     * Le second essai n'est pas du zele : une installation deja utilisee avant cette correction
     * tourne sur 3000 sans avoir de `port.txt`, et il ne faut pas lui demarrer un second
     * exemplaire par-dessus.
     */
    for (const candidat of [lirePortEnregistre(racine), PORT_APPLICATION_DEPART]) {
      if (candidat == null) continue;
      const ouverte = await applicationDejaLa(candidat);
      if (ouverte) {
        progression.note("L'application etait deja ouverte — je ramene simplement sa fenetre.");
        ouvrirNavigateur(ouverte, progression);
        process.stdout.write(`\n  ${ouverte}\n\n`);
        process.exit(0);
      }
    }

    /**
     * Le port de l'application est CHOISI, plus impose. Voir `PORT_APPLICATION_DEPART` pour la
     * mesure qui l'exige : sur un port occupe, la version precedente n'ouvrait pas seulement
     * une mauvaise page, elle ne demarrait jamais l'application.
     */
    const portApp = await portLibre(PORT_APPLICATION_DEPART, 50);
    const adresse = `http://127.0.0.1:${portApp}`;
    enregistrerPort(racine, portApp);

    const premiere = !existsSync(join(racine, 'donnees', 'pgdata', 'PG_VERSION'));
    const { pgdata } = await progression.pendant(
      premiere ? 'Preparation de la base (une seule fois)' : 'Verification de la base',
      async () => preparerBase({ racine, binaires, journal: muet }),
    );

    const port = await portLibre();
    /**
     * Le processus est retenu DEHORS de l'etape, et ce n'est pas un detail de style :
     * `pendant()` rend le resultat de la tache, qui est ici la chaine affichee a cote de la
     * coche. L'ecrire `const processus = await progression.pendant(...)` aurait donne la
     * chaine « port 54329 » a la place du processus — et l'arret propre aurait porte sur
     * rien, laissant une base a recuperer au lancement suivant.
     */
    let processus = null;
    await progression.pendant('Demarrage du moteur de donnees', async () => {
      processus = await demarrerBase({ racine, binaires, pgdata, port, journal: muet });
      return `port ${port}`;
    });
    base = {
      arreter: () => {
        spawnSync(join(binaires, SOUS_WINDOWS ? 'pg_ctl.exe' : 'pg_ctl'), ['-D', pgdata, '-m', 'fast', 'stop'], {
          encoding: 'utf8',
        });
        if (processus.exitCode == null) processus.kill();
      },
    };

    const url = await progression.pendant('Ouverture de la base applicative', async () =>
      preparerSchema({ binaires, port, journal: muet }),
    );

    if (premiere) {
      await progression.pendant('Application du schema', async () => {
        const r = spawnSync(
          join(racine, 'moteurs', 'node', NODE),
          [join(racine, 'application', 'apps', 'api', 'dist', 'scripts', 'migrer.js')],
          { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
        );
        if (r.status !== 0) throw new Error((r.stderr || '').split('\n')[0] || 'migrations en echec');
      });

      const restaure = await progression.pendant(
        'Chargement des donnees de reference',
        async () => (await restaurerAmorce({ racine, url, binaires })) ?? 'a telecharger au demarrage',
      );
      if (restaure === 'a telecharger au demarrage') {
        progression.note('Les donnees nationales seront telechargees en arriere-plan (5 a 10 min).');
      }
    }

    await progression.pendant("Demarrage de l'application", async () => {
      const api = spawn(
        join(racine, 'moteurs', 'node', NODE),
        [join(racine, 'application', 'apps', 'api', 'dist', 'serveur.js')],
        {
          env: {
            ...process.env,
            DATABASE_URL: url,
            HOTE: '127.0.0.1',
            PORT: String(portApp),
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
            /**
             * Poste personnel, base dans le dossier de l'utilisateur, ecoute sur la boucle
             * locale : un ecran de connexion n'ajouterait rien. Ce reglage est refuse par le
             * serveur des qu'il tourne sur un hebergement — voir apps/api/src/serveur.ts.
             * Ici il est explicite et assume.
             */
            AUTH_DESACTIVEE: 'true',
            /**
             * LE DRAPEAU SANS LEQUEL RIEN NE MARCHE, et il a manque.
             *
             * `AUTH_DESACTIVEE` seul est REFUSE quand `NODE_ENV` vaut `production` — a juste
             * titre : c'est le garde-fou qui empeche de mettre en ligne un serveur sans
             * authentification. Constate en lancant vraiment l'archive : l'interface
             * s'affichait, et toutes les routes utiles rendaient 500
             * « AUTH_DESACTIVEE est interdit en production ». Une carte vide, et rien d'autre.
             *
             * `MODE_BUREAU` nomme l'exception au lieu de la deguiser en environnement de
             * developpement — ce qui aurait ouvert la politique CORS a toutes les origines,
             * donc permis a n'importe quelle page visitee de lire les donnees sur 127.0.0.1.
             * Le serveur ne l'accepte que s'il n'ecoute que la boucle locale, ce que la ligne
             * `HOTE` ci-dessus garantit.
             */
            MODE_BUREAU: 'true',
          },
          /**
           * LA SORTIE D'ERREUR DE L'API EST CAPTUREE, ET PAS SEULEMENT AFFICHEE.
           *
           * Elle etait en `inherit` : elle partait donc sur la console, c'est-a-dire sur une
           * fenetre qui se ferme. Pendant ce temps, le message d'echec du lanceur renvoyait
           * vers `donnees\\journal.txt` — un fichier qui ne contenait que les lignes de
           * PostgreSQL. L'API est pourtant le composant qui echoue le plus volontiers
           * (migrations, port deja pris, base incomplete), et son erreur etait la seule chose
           * qui n'atterrissait nulle part de durable. Trouve a l'audit 11 en cherchant ce que
           * le fichier annonce contenait vraiment.
           */
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      api.stderr.on('data', (d) => journaliser(racine, `api: ${String(d).trimEnd()}`));
      api.on('exit', (code) => arretPropre(code ?? 0));

      const debut = Date.now();
      for (;;) {
        if (Date.now() - debut > 90_000) throw new Error("pas de reponse en 90 s");
        try {
          const r = await fetch(`${adresse}/api/sante`);
          if (r.ok) break;
        } catch {
          /* pas encore la */
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return adresse;
    });

    if (premiere) poserRaccourci(racine, progression);

    process.stdout.write(`\n  L'application est ouverte : ${adresse}\n`);
    process.stdout.write('  Laissez cette fenetre ouverte. Fermez-la pour arreter.\n\n');
    ouvrirNavigateur(adresse, progression);
  } catch (erreur) {
    /**
     * LA CAUSE EST ECRITE DANS LE JOURNAL AVANT TOUT, parce que la fenetre, elle, ne dure pas.
     *
     * Le message annoncait « Detail technique dans donnees\journal.txt » sans jamais y ecrire
     * la cause de SON echec : le journal ne recevait que les lignes de PostgreSQL. Le seul
     * endroit ou l'erreur apparaissait etait la console — et une console allouee par un
     * double-clic dans l'explorateur est detruite quand le processus se termine. Autrement dit,
     * le message qu'il faut lire etait precisement celui qu'on ne pouvait pas lire.
     */
    journaliser(racine, `demarrage: ECHEC — ${erreur.stack ?? erreur.message}`);
    process.stdout.write(`\n  Le demarrage a echoue : ${erreur.message}\n`);
    process.stdout.write('  Detail technique dans donnees\\journal.txt\n\n');
    await attendreLecture();
    arretPropre(1);
  }
}



principal();
