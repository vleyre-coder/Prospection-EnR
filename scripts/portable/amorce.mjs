#!/usr/bin/env node
/**
 * L'AMORCE NATIONALE : ce que l'archive embarque pour que le premier lancement soit immediat.
 *
 * SANS ELLE, le premier demarrage telecharge les donnees de reference depuis une vingtaine
 * d'API publiques — 35 000 communes, 3 119 postes sources, 43 873 monuments — soit cinq a dix
 * minutes d'attente, et une dependance a la disponibilite de services tiers le jour ou
 * l'utilisateur ouvre l'application pour la premiere fois. L'amorce est un `pg_dump` de ces
 * donnees, restaure en quelques secondes par `demarrer.mjs`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE LISTE D'AUTORISATION, ALORS QUE LE GARDE D'ENVOI GIT UTILISAIT L'INVERSE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Ce n'est pas une incoherence, c'est la meme regle appliquee a une asymetrie inversee.
 *
 *   - Pour un ENVOI git, oublier d'interdire un fichier de donnees etait irreparable, et
 *     oublier d'autoriser un fichier de code n'etait qu'ennuyeux. D'ou une liste d'interdits.
 *   - Ici, l'archive part vers quiconque la recoit. Oublier d'EXCLURE une table de donnees
 *     personnelles diffuse ces donnees ; oublier d'INCLURE une table de reference coute un
 *     retelechargement au premier lancement. L'asymetrie est inversee, donc la liste aussi.
 *
 * Et pour que cette liste ne se perime pas en silence, un test lit le schema reel dans
 * `db/migrations/` et EXIGE que chaque table soit classee explicitement dans l'une des deux
 * listes. Une table ajoutee demain fera echouer ce test au lieu d'etre incluse par accident.
 *
 * Usage :
 *   node scripts/portable/amorce.mjs --sortie donnees/amorce.sql.gz
 *                                    [--url postgres://...] [--verifier-seulement]
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Tables EMBARQUEES : donnees publiques, retelechargeables, identiques pour tout le monde.
 *
 * Chaque entree porte ce qu'elle contient et d'ou elle vient. Une table dont on ne sait pas
 * dire la provenance n'a rien a faire dans une archive distribuee.
 */
export const TABLES_EMBARQUEES = {
  source_donnee: 'referentiel des sources et de leur millesime — metadonnee technique',
  couverture_ingestion:
    "ce qui a ete ingere, territoire par territoire. Indispensable : sans elle, l'application " +
    'ne saurait pas que les donnees sont la et les redemanderait',
  commune: 'les 35 000 communes francaises — geo.api.gouv.fr, public',
  poste_source: 'les 3 119 postes sources et leur saturation — Capareseau, public',
  canalisation_gaz: 'reseau de transport de gaz — public',
  point_injection_gaz: "points d'injection biomethane — public",
  contrainte: 'zonages publics : Natura 2000, monuments, PPR, AOC, zones humides…',
  zaer: "zones d'acceleration des ENR — deliberations communales, publiques",
  document_cadre_pv: 'documents-cadres departementaux photovoltaiques — arretes publics',
};

/**
 * Tables ECARTEES, avec le motif. Ce sont elles qui rendent ce fichier necessaire.
 *
 * `parametre` merite une mention particuliere : elle porte le SECRET DE SIGNATURE DES JETONS,
 * genere par chaque instance, et le commentaire de schema dit litteralement « Ne jamais
 * exposer ». L'embarquer aurait pose le meme secret dans chaque copie distribuee de
 * l'archive — de quoi forger un jeton valide sur l'installation de n'importe qui.
 */
export const TABLES_ECARTEES = {
  proprietaire_parcelle: 'DONNEES NOMINATIVES de proprietaires — jamais, sous aucun pretexte',
  utilisateur: 'comptes et empreintes de mots de passe',
  parametre: 'secret de signature des jetons (« Ne jamais exposer », dit le schema)',
  journal_acces: 'journal des consultations — donnee RGPD, propre a une instance',
  lead: 'pipeline commercial de son proprietaire',
  lead_evenement: "historique du pipeline commercial",
  site: "regroupements de parcelles composes par l'utilisateur",
  site_parcelle: "composition des sites de l'utilisateur",
  document: "pieces jointes par l'utilisateur",
  filtre_sauvegarde: "filtres enregistres par l'utilisateur",
  profil_ponderation: "ponderations de scoring personnalisees par l'utilisateur",
  demande_qualification: "file de travail, propre a une instance",
  tache_qualification: 'file de travail, propre a une instance',
  parcelle:
    "parcelles qualifiees : le travail de l'utilisateur, et un volume qui gonflerait " +
    "l'archive sans profiter a personne d'autre",
  parcelle_snapshot: "releves de qualification — le travail de l'utilisateur",
  score_parcelle_filiere: 'scores calcules sur les parcelles qualifiees',
  commune_score_filiere: 'agregats communaux derives des parcelles qualifiees',
};

/**
 * Lit les tables reellement declarees par le schema.
 *
 * Le schema est la SEULE source de verite ici. Une liste recopiee a la main se desynchronise
 * a la premiere migration, et le jour ou elle se desynchronise, c'est en silence.
 */
export function tablesDuSchema(dossier = join(RACINE, 'db', 'migrations')) {
  const trouvees = new Set();
  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dossier, fichier), 'utf8');
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      trouvees.add(m[1].toLowerCase());
    }
  }
  return [...trouvees].sort();
}

/**
 * Classe les tables du schema. Toute table inconnue des deux listes est signalee.
 *
 * @returns {{ embarquees: string[], ecartees: string[], nonClassees: string[] }}
 */
export function classer(tables = tablesDuSchema()) {
  const embarquees = [];
  const ecartees = [];
  const nonClassees = [];
  for (const t of tables) {
    if (Object.hasOwn(TABLES_EMBARQUEES, t)) embarquees.push(t);
    else if (Object.hasOwn(TABLES_ECARTEES, t)) ecartees.push(t);
    else nonClassees.push(t);
  }
  return { embarquees, ecartees, nonClassees };
}

/**
 * Relit l'amorce produite et REFUSE si une table ecartee y apparait.
 *
 * Ceinture et bretelles, et ce n'est pas de la paranoia gratuite : `pg_dump --table` accepte
 * des motifs, une faute de frappe peut elargir la selection, et une vue ou une contrainte
 * peut entrainer une table voisine. Le seul controle qui vaille porte sur le FICHIER PRODUIT,
 * pas sur la commande qu'on croyait avoir lancee.
 */
export async function verifierAmorce(chemin) {
  const interdites = Object.keys(TABLES_ECARTEES);
  const vues = new Set();
  const fautes = [];
  let octets = 0;

  await new Promise((resoudre, rejeter) => {
    let reste = '';
    const flux = createReadStream(chemin).pipe(createGunzip());
    flux.on('data', (morceau) => {
      octets += morceau.length;
      const texte = reste + morceau.toString('utf8');
      const lignes = texte.split('\n');
      reste = lignes.pop() ?? '';
      for (const ligne of lignes) {
        const copie = /^COPY\s+(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(ligne);
        if (!copie) continue;
        const table = copie[1].toLowerCase();
        vues.add(table);
        if (interdites.includes(table)) fautes.push(table);
      }
    });
    flux.on('end', resoudre);
    flux.on('error', rejeter);
  });

  return { tablesTrouvees: [...vues].sort(), fautes: [...new Set(fautes)], octetsDecompresses: octets };
}

// ------------------------------------------------------------------------- ligne de commande ---

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 ? process.argv[i + 1] : defaut;
}

async function principal() {
  const { embarquees, ecartees, nonClassees } = classer();

  console.log("Amorce nationale : classement des tables du schema\n");
  console.log(`  embarquees : ${embarquees.length}`);
  for (const t of embarquees) console.log(`     + ${t.padEnd(24)} ${TABLES_EMBARQUEES[t]}`);
  console.log(`  ecartees   : ${ecartees.length}`);
  for (const t of ecartees) console.log(`     - ${t.padEnd(24)} ${TABLES_ECARTEES[t]}`);

  if (nonClassees.length > 0) {
    console.error(
      `\nREFUS : ${nonClassees.length} table(s) du schema ne sont classees nulle part :\n` +
        nonClassees.map((t) => `  ${t}`).join('\n') +
        "\n\nUne table ajoutee au schema doit etre classee EXPLICITEMENT, dans TABLES_EMBARQUEES\n" +
        'ou dans TABLES_ECARTEES. Ne pas trancher, c\'est laisser le hasard decider si des\n' +
        'donnees partent dans une archive distribuee.',
    );
    process.exit(1);
  }

  if (process.argv.includes('--verifier-seulement')) return;

  const url = argument('url', process.env['DATABASE_URL']);
  if (!url) {
    console.error('\n--url ou DATABASE_URL est requis pour produire l\'amorce.');
    process.exit(1);
  }
  const sortie = resolve(argument('sortie', join(RACINE, 'distribution', 'amorce.sql.gz')));
  mkdirSync(dirname(sortie), { recursive: true });

  console.log(`\nExtraction vers ${sortie}...`);
  const args = [
    url, '--data-only', '--no-owner', '--no-privileges', '--no-comments',
    ...embarquees.flatMap((t) => ['--table', t]),
  ];
  // `pg_dump | gzip` par le shell : le flux ne passe pas par Node, donc la memoire ne borne
  // pas la taille de l'amorce.
  execFileSync('bash', ['-c', `pg_dump "$@" | gzip -9 > ${JSON.stringify(sortie)}`, '--', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const controle = await verifierAmorce(sortie);
  console.log(`\n  ${(statSync(sortie).size / 1048576).toFixed(1)} Mo compresses`);
  console.log(`  ${(controle.octetsDecompresses / 1048576).toFixed(1)} Mo decompresses`);
  console.log(`  tables presentes : ${controle.tablesTrouvees.join(', ') || '(aucune)'}`);

  if (controle.fautes.length > 0) {
    console.error(
      `\nREFUS : l'amorce produite contient des tables ecartees : ${controle.fautes.join(', ')}\n` +
        "Le fichier est laisse en place pour examen, mais il ne doit PAS etre distribue.",
    );
    process.exit(1);
  }
  const absentes = embarquees.filter((t) => !controle.tablesTrouvees.includes(t));
  if (absentes.length > 0) {
    console.log(
      `  note : ${absentes.length} table(s) embarquee(s) sont vides dans cette base ` +
        `(${absentes.join(', ')}). L'ingestion etait-elle complete ?`,
    );
  }
  console.log('\n  Aucune table ecartee dans le fichier produit.');
}

const appeleEnDirect =
  process.argv[1] != null && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '@@');
if (appeleEnDirect) {
  principal().catch((erreur) => {
    console.error(`\nECHEC : ${erreur.message}`);
    process.exit(1);
  });
}
