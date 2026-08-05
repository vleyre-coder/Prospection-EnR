#!/usr/bin/env node
/**
 * Prepare une campagne de validation par un expert.
 *
 * POURQUOI CET OUTIL EXISTE. La fiabilite ne se demontre pas, elle se mesure. Sept audits ont
 * etabli que le code est correct et que les tests passent — et pourtant trois defauts critiques
 * ont survecu, parce que personne n'avait confronte un champ du snapshot a la realite du terrain.
 *
 * Aucun test automatique ne peut faire ce travail : verifier qu'une parcelle est bien en zone A du
 * PLU, qu'un PPRI la couvre reellement, ou que l'habitation la plus proche est bien a 120 m,
 * demande d'ouvrir le plan de zonage et de regarder. C'est le seul item de la feuille de route qui
 * demande un apport humain irremplacable.
 *
 * CE QUE CET OUTIL FAIT : il choisit un echantillon, qualifie les parcelles, et produit un fichier
 * de saisie ou chaque champ verifiable est pre-rempli avec la valeur de l'application et une case
 * vide pour la valeur constatee. L'expert n'a plus qu'a remplir la seconde colonne.
 *
 * CE QU'IL NE FAIT PAS : conclure. Le taux d'ecart se calcule apres saisie, avec
 * `--depouiller`.
 *
 * USAGE
 *   node scripts/campagne-validation.mjs --emprise 1.70,48.10,1.90,48.25 --taille 30
 *   node scripts/campagne-validation.mjs --depouiller docs/validation/campagne-2026-08-05.csv
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Champs qu'un expert peut verifier sans outil specialise, et ou. */
const CHAMPS_VERIFIABLES = [
  { chemin: 'urbanisme.zonages[0].typeZone', ou: 'plan de zonage du PLU (Geoportail de l’urbanisme)' },
  { chemin: 'urbanisme.typeDocument', ou: 'page de la commune sur le GPU' },
  { chemin: 'occupationSol.typeSol', ou: 'photo aerienne recente + registre parcellaire graphique' },
  { chemin: 'bati.distanceHabitationM', ou: 'mesure sur photo aerienne, bord de parcelle au bati' },
  { chemin: 'topographie.pentePct', ou: 'profil altimetrique Geoportail' },
  { chemin: 'risques.ppri.present', ou: 'cartographie des PPR de la prefecture' },
  { chemin: 'risques.pprif.present', ou: 'cartographie des PPR de la prefecture' },
  { chemin: 'milieux.natura2000Habitats.recouvre', ou: 'carte INPN' },
  { chemin: 'milieux.natura2000Habitats.nom', ou: 'carte INPN' },
  { chemin: 'milieux.appb.recouvre', ou: 'carte INPN, couche APPB' },
  { chemin: 'eau.zoneHumide', ou: 'inventaire departemental des zones humides' },
  { chemin: 'raccordement.posteLePlusProche.nom', ou: 'Capareseau' },
  { chemin: 'raccordement.posteLePlusProche.distanceKm', ou: 'Capareseau, mesure a vol d’oiseau' },
];

function lireArg(nom, defaut = null) {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

function valeurA(objet, chemin) {
  let cur = objet;
  for (const seg of chemin.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

const csvEchappe = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------------------------------------------------------------------------
// Depouillement
// ---------------------------------------------------------------------------

const aDepouiller = lireArg('--depouiller');
if (aDepouiller) {
  const lignes = readFileSync(aDepouiller, 'utf8').trim().split('\n').slice(1);
  let total = 0;
  let saisis = 0;
  let ecarts = 0;
  const parChamp = new Map();
  for (const ligne of lignes) {
    // Analyse suffisante pour ce format : aucun champ ne contient de point-virgule non echappe.
    const cols = ligne.split(';').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const [, champ, valeurApp, valeurConstatee] = cols;
    if (!champ) continue;
    total += 1;
    if ((valeurConstatee ?? '').trim() === '') continue;
    saisis += 1;
    const identique = (valeurApp ?? '').trim() === valeurConstatee.trim();
    if (!identique) {
      ecarts += 1;
      parChamp.set(champ, (parChamp.get(champ) ?? 0) + 1);
    }
  }
  console.log(`Lignes : ${total} | saisies : ${saisis} | ecarts : ${ecarts}`);
  if (saisis === 0) {
    console.log('\nAucune valeur constatee saisie : rien a conclure.');
    process.exit(0);
  }
  console.log(`Taux de concordance : ${(((saisis - ecarts) / saisis) * 100).toFixed(1)} %`);
  if (parChamp.size > 0) {
    console.log('\nEcarts par champ, du plus frequent au moins frequent :');
    for (const [champ, n] of [...parChamp.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${champ}`);
    }
  }
  console.log(
    `\nRappel de methode : un ecart n'est pas forcement un defaut de l'application — la source\n` +
      `officielle peut etre perimee, ou la question mal posee. Chaque ecart doit etre tranche un a\n` +
      `un, et celui qui revele un defaut doit donner lieu a un test avant correction.`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

const emprise = lireArg('--emprise');
const taille = Number(lireArg('--taille', '30'));
if (!emprise) {
  console.error('Usage : --emprise ouest,sud,est,nord [--taille 30]  |  --depouiller <fichier.csv>');
  process.exit(1);
}

console.log(`Qualification de l'emprise ${emprise}, echantillon de ${taille} parcelles...`);
// Le script de qualification ecrit les snapshots dans un FICHIER et n'imprime que son chemin :
// `journal` ecrit sur stdout depuis tous les modules traverses, donc dependre de la sortie
// standard obligerait a deviner quelle ligne est le JSON.
const fichierSnapshots = '/tmp/campagne-validation-snapshots.json';
execFileSync(
  'npx',
  [
    'tsx', 'apps/api/src/scripts/qualifier-emprise.ts',
    '--bbox', emprise, '--limite', String(taille), '--sortie', fichierSnapshots,
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const snapshots = JSON.parse(readFileSync(fichierSnapshots, 'utf8'));

const date = new Date().toISOString().slice(0, 10);
mkdirSync('docs/validation', { recursive: true });
const chemin = `docs/validation/campagne-${date}.csv`;

const entete = 'idu;champ;valeur_application;valeur_constatee;ou_verifier;commentaire';
const corps = [];
for (const s of snapshots) {
  for (const { chemin: c, ou } of CHAMPS_VERIFIABLES) {
    const v = valeurA(s, c);
    corps.push(
      [s.identite?.idu ?? '?', c, v === undefined ? '' : JSON.stringify(v), '', ou, '']
        .map(csvEchappe)
        .join(';'),
    );
  }
}
writeFileSync(chemin, `﻿${[entete, ...corps].join('\n')}\n`, 'utf8');

console.log(`\n${chemin} ecrit : ${snapshots.length} parcelles x ${CHAMPS_VERIFIABLES.length} champs.`);
console.log(
  `\nA remettre a un expert ENR. Une seule colonne a remplir : « valeur_constatee ». Laisser vide\n` +
    `ce qui n'a pas ete verifie — une ligne vide est honnete, une ligne recopiee ne prouve rien.\n` +
    `Puis : node scripts/campagne-validation.mjs --depouiller ${chemin}`,
);
