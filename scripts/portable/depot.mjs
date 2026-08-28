#!/usr/bin/env node
/**
 * La boucle GitHub de l'application locale : recuperer les mises a jour, renvoyer les siennes.
 *
 * CE QUE CE FICHIER PROTEGE, ET POURQUOI IL EXISTE SEPAREMENT DU LANCEUR.
 *
 * L'application portable est un dossier pose sur un bureau. Dans ce dossier cohabitent deux
 * choses de nature COMPLETEMENT differente :
 *
 *   - le CODE, qui doit aller sur GitHub — c'est tout l'interet de la boucle ;
 *   - les DONNEES, qui ne doivent JAMAIS y aller : la base contient le pipeline commercial
 *     et, potentiellement, des donnees nominatives de proprietaires. Les pousser sur GitHub,
 *     meme dans un depot prive, serait une communication de donnees personnelles a un
 *     sous-traitant non declare, sur un serveur hors UE, et — c'est le pire — IRREVERSIBLE :
 *     un commit pousse reste dans l'historique et dans les copies de chacun, meme apres
 *     suppression du fichier.
 *
 * Un `.gitignore` seul ne suffit pas a tenir cette promesse. Il se contourne d'un `git add -f`,
 * il ne couvre pas un dossier renomme, et il est MUET — on ne sait meme pas qu'on a evite le
 * pire. Ce fichier ajoute donc un garde EXECUTE avant chaque envoi, qui refuse et qui explique.
 *
 * La regle est fondee sur une liste de motifs INTERDITS plutot que sur une liste d'autorises,
 * et ce choix est asymetrique a dessein : un fichier de code oublie par une liste blanche ne
 * serait pas pousse — ennuyeux, rattrapable ; un fichier de donnees oublie par une liste noire
 * serait pousse — irrattrapable. On accepte donc de bloquer trop plutot que trop peu, et le
 * message dit comment passer outre en connaissance de cause.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du depot : deux niveaux au-dessus de scripts/portable/. */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Motifs de chemins qui ne doivent jamais partir sur GitHub.
 *
 * Chaque entree porte sa raison, parce qu'un garde dont on ne comprend pas le motif finit
 * toujours par etre desactive par quelqu'un de presse.
 */
export const INTERDITS = [
  {
    motif: /^donnees\//,
    raison: 'dossier de la base : pipeline commercial et donnees de proprietaires',
  },
  { motif: /^pgdata\//, raison: 'repertoire de donnees PostgreSQL' },
  { motif: /(^|\/)\.env$/, raison: 'secrets de configuration (SECRET_JWT, mots de passe)' },
  { motif: /(^|\/)jeton[-_][^/]*\.txt$/i, raison: "jeton d'acces GitHub" },
  { motif: /\.(dump|bak)$/i, raison: 'sauvegarde de base de donnees' },
  { motif: /\.sql\.(gz|zip)$/i, raison: 'sauvegarde de base de donnees' },
  {
    motif: /(^|\/)exports?\//,
    raison: "exports produits par l'application (peuvent nommer des proprietaires)",
  },
  {
    motif: /\.(csv|geojson|shp|dbf|shx)$/i,
    raison: 'export de donnees parcellaires',
    /**
     * Les jeux d'essai versionnes sont du CODE, pas des donnees : ils sont fictifs, ils sont
     * lus par les tests, et les bloquer rendrait le depot immodifiable sur ces fichiers-la.
     */
    saufSi: /^(apps|packages)\/[^/]+\/(test|e2e)\//,
  },
];

/**
 * Trie une liste de chemins en « autorises » et « refuses ».
 *
 * Fonction PURE, et c'est delibere : c'est la seule facon de la couvrir par des tests sans
 * depot git, sans reseau et sans risque. Tout le reste du fichier n'est que de la plomberie
 * autour d'elle.
 *
 * @param {string[]} chemins chemins relatifs a la racine du depot
 * @returns {{ autorises: string[], refuses: Array<{ chemin: string, raison: string }> }}
 */
export function trier(chemins) {
  const autorises = [];
  const refuses = [];
  for (const brut of chemins) {
    /**
     * Windows rend des barres obliques INVERSES. Sans cette normalisation,
     * `donnees\pgdata\base` echapperait au motif `^donnees/` — c'est-a-dire que le garde
     * serait inoperant precisement sur la plateforme visee. Un test l'exige.
     */
    const chemin = brut.replace(/\\/g, '/').replace(/^\.\//, '');
    if (chemin === '') continue;
    const trouve = INTERDITS.find(
      (i) => i.motif.test(chemin) && !(i.saufSi && i.saufSi.test(chemin)),
    );
    if (trouve) refuses.push({ chemin, raison: trouve.raison });
    else autorises.push(chemin);
  }
  return { autorises, refuses };
}

/**
 * La DECISION d'envoi, isolee de toute plomberie.
 *
 * Extraite de `pousser()` pour une raison precise : tant qu'elle y etait enfouie, la seule
 * facon de la verifier aurait ete de fabriquer un depot git jetable et d'y tenter un envoi.
 * Personne n'ecrit ce test-la, donc la regle la plus couteuse du fichier serait restee la
 * seule non couverte. Ici, elle se teste en trois lignes — et une mutation prouve qu'elle
 * protege vraiment.
 *
 * @param {string[]} chemins
 * @param {{ forcer?: boolean }} options
 * @returns {{ action: 'refuser' | 'rien' | 'envoyer', autorises: string[],
 *             refuses: Array<{ chemin: string, raison: string }> }}
 */
export function decider(chemins, { forcer = false } = {}) {
  const { autorises, refuses } = trier(chemins);
  if (refuses.length > 0 && !forcer) return { action: 'refuser', autorises, refuses };
  if (autorises.length === 0) return { action: 'rien', autorises, refuses };
  return { action: 'envoyer', autorises, refuses };
}

// --------------------------------------------------------------------------- plomberie git ---

function git(...args) {
  return execFileSync('git', args, {
    cwd: RACINE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function estUnDepotGit() {
  return existsSync(resolve(RACINE, '.git'));
}

/** Chemins ajoutes, modifies ou supprimes, tels que git les voit. */
export function cheminsModifies() {
  return git('status', '--porcelain=v1', '-z')
    .split('\0')
    .filter((ligne) => ligne.length > 3)
    .map((ligne) => ligne.slice(3));
}

export function brancheCourante() {
  return git('rev-parse', '--abbrev-ref', 'HEAD').trim();
}

// ------------------------------------------------------------------------------ operations ---

/**
 * Recupere les mises a jour du depot distant.
 *
 * `--ff-only` et rien d'autre : une fusion automatique sur un poste ou personne ne relira le
 * resultat produirait des conflits silencieux dans du code que l'utilisateur n'ecrit pas. Si
 * l'avance rapide est impossible, mieux vaut s'arreter et le dire.
 */
export function mettreAJour({ journal = console } = {}) {
  const branche = brancheCourante();
  journal.log(`Recuperation des mises a jour (branche ${branche})...`);
  try {
    journal.log(git('pull', '--ff-only', 'origin', branche).trim());
    return { ok: true };
  } catch (erreur) {
    const texte = String(erreur.stderr || erreur.message);
    journal.error('\nLa mise a jour a echoue.');
    if (/non-fast-forward|diverge/i.test(texte)) {
      journal.error(
        "Votre copie contient des modifications qui ne sont pas sur GitHub. Envoyez-les\n" +
          "d'abord avec `Pousser-vers-GitHub`, puis relancez la mise a jour.",
      );
    } else {
      journal.error(texte.trim());
    }
    return { ok: false };
  }
}

/**
 * Envoie les modifications locales sur GitHub, apres passage du garde.
 *
 * @param {{ message?: string, forcer?: boolean, journal?: Console }} options
 */
export function pousser({ message, forcer = false, journal = console } = {}) {
  if (!estUnDepotGit()) {
    journal.error(
      "Ce dossier n'est pas une copie de travail git : il a probablement ete obtenu en\n" +
        'decompressant une archive ZIP, qui ne contient pas l\'historique.\n' +
        'Voir docs/APPLICATION-LOCALE.md, section « Relier le dossier a GitHub ».',
    );
    return { ok: false, raison: 'pas_un_depot' };
  }

  const { action, autorises, refuses } = decider(cheminsModifies(), { forcer });

  if (action === 'refuser') {
    journal.error('\nENVOI REFUSE. Ces fichiers ne doivent pas aller sur GitHub :\n');
    for (const { chemin, raison } of refuses) journal.error(`  ${chemin}\n      ${raison}`);
    journal.error(
      '\nUn envoi est definitif : meme supprime ensuite, un fichier pousse reste dans\n' +
        "l'historique et dans toutes les copies. Ces fichiers restent donc sur votre poste.\n" +
        '\nSi vous savez ce que vous faites, relancez avec --forcer.',
    );
    return { ok: false, raison: 'fichiers_interdits', refuses };
  }

  if (action === 'rien') {
    journal.log('Rien a envoyer : aucune modification de code.');
    return { ok: true, envoye: false };
  }

  journal.log(`${autorises.length} fichier(s) a envoyer :`);
  for (const c of autorises) journal.log(`  ${c}`);

  // `-A --` limite l'ajout aux chemins autorises tout en prenant en compte les suppressions.
  git('add', '-A', '--', ...autorises);
  const texte = message?.trim() || `Modifications locales du ${new Date().toISOString().slice(0, 10)}`;
  git('commit', '-m', texte);

  const branche = brancheCourante();
  journal.log(`Envoi vers origin/${branche}...`);
  try {
    git('push', '-u', 'origin', branche);
    journal.log('Envoye.');
    return { ok: true, envoye: true };
  } catch (erreur) {
    const sortie = String(erreur.stderr || erreur.message);
    journal.error('\nL\'envoi a echoue. Le commit est fait ; seul l\'envoi reste a refaire.');
    if (/Authentication|could not read Username|403|denied/i.test(sortie)) {
      journal.error(
        "\nC'est un probleme d'identifiants. GitHub n'accepte plus les mots de passe de compte :\n" +
          "il faut un JETON D'ACCES PERSONNEL (Settings > Developer settings > Personal access\n" +
          'tokens, portee `repo`), a saisir a la place du mot de passe.',
      );
    } else {
      journal.error(sortie.trim());
    }
    return { ok: false, raison: 'envoi' };
  }
}

// ------------------------------------------------------------------------- ligne de commande ---

const appeleEnDirect =
  process.argv[1] != null &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (appeleEnDirect) {
  const commande = process.argv[2];
  const forcer = process.argv.includes('--forcer');
  const message = process.argv.slice(3).find((a) => !a.startsWith('--'));
  if (commande === 'pousser') {
    process.exit(pousser({ message, forcer }).ok ? 0 : 1);
  } else if (commande === 'mettre-a-jour') {
    process.exit(mettreAJour().ok ? 0 : 1);
  } else if (commande === 'verifier') {
    const { autorises, refuses } = trier(cheminsModifies());
    console.log(`${autorises.length} fichier(s) envoyable(s), ${refuses.length} bloque(s).`);
    for (const { chemin, raison } of refuses) console.log(`  BLOQUE ${chemin} — ${raison}`);
  } else {
    console.error('Usage : depot.mjs <pousser [message] [--forcer] | mettre-a-jour | verifier>');
    process.exit(2);
  }
}
