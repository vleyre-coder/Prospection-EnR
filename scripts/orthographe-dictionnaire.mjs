#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * BALAYER LE TEXTE AFFICHE CONTRE LE DICTIONNAIRE FRANCAIS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE SCRIPT CHERCHE, ET QUE LES TESTS NE PEUVENT PAS CHERCHER. Les deux gardes d'orthographe
 * de `apps/web/test` empechent un RETOUR : le premier interdit qu'un mot s'ecrive de deux facons, le
 * second interdit le retour des 88 graphies corrigees le 8 septembre 2026. Aucun des deux ne cherche
 * une faute NOUVELLE, parce que cela demande un dictionnaire, donc un paquet systeme — et un test qui
 * s'ignore en silence quand un paquet manque donne l'illusion d'une couverture.
 *
 * Ce script est donc l'outil de recherche, lance a la main, et l'echec qu'il rend est une invitation
 * a lire, pas un verdict : « calcule » est faux dans « score calcule » et juste dans « l'application
 * calcule ». Le dictionnaire ne tranche pas entre le verbe et le participe. Un humain, si.
 *
 * ═══ CE QU'IL DEMANDE
 *
 *     apt-get install -y hunspell hunspell-fr
 *
 * ═══ CE QU'IL A DONNE LE 8 SEPTEMBRE 2026
 *
 *     1 831 mots distincts dans le texte affiche
 *       306 refuses par hunspell
 *        86 dont le refus s'explique par un accent manquant   (161 occurrences)
 *
 * Apres correction : 5 mots, 33 occurrences, tous legitimes — `acces` et `bati` sont des chemins de
 * champ, `core` le nom du paquet `@enr/core`, `demarrage` un chemin d'import, `filiere` le parametre
 * de requete des URL de tuiles.
 *
 * ═══ LA METHODE, ET SA LIMITE
 *
 * Un mot sans accent d'un litteral affiche est retenu quand hunspell le REFUSE et qu'une graphie
 * ACCENTUEE du meme squelette est, elle, acceptee. La limite est que le squelette doit exister au
 * dictionnaire : « paraitre » (graphie de 1990) est accepte, donc « paraître » n'est pas propose, et
 * le script ne dit rien. C'est un plancher, pas un plafond — il ne remplace pas une relecture.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..');

function exigerHunspell() {
  try {
    execFileSync('hunspell', ['-vv'], { stdio: 'ignore' });
  } catch {
    console.error(
      'hunspell est introuvable. Ce script ne peut pas fonctionner sans lui :\n' +
        '  apt-get install -y hunspell hunspell-fr\n' +
        'Les deux gardes de `apps/web/test/orthographe-*.test.ts`, eux, ne demandent rien.',
    );
    process.exit(1);
  }
  const dico = ['/usr/share/hunspell/fr_FR.dic', '/usr/share/hunspell/fr.dic'].find(existsSync);
  if (!dico) {
    console.error('Le dictionnaire francais est introuvable :\n  apt-get install -y hunspell-fr');
    process.exit(1);
  }
  return dico;
}

/**
 * Le perimetre est LU dans le fichier de test, jamais recopie.
 *
 * Deux listes de modules a maintenir en parallele finissent toujours par diverger, et ce script
 * balayerait alors un sous-ensemble de ce que les gardes protegent, sans que rien ne le signale.
 */
function modulesTexte() {
  const src = readFileSync(
    resolve(RACINE, 'apps/web/test/orthographe-affichee.test.ts'),
    'utf8',
  );
  const bloc = /export const MODULES_TEXTE: readonly string\[\] = \[([\s\S]*?)\];/.exec(src);
  if (!bloc) {
    console.error(
      'MODULES_TEXTE introuvable dans orthographe-affichee.test.ts : le perimetre a change de forme.',
    );
    process.exit(1);
  }
  return [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

exigerHunspell();

// `relever` fait l'analyse TypeScript des litteraux affiches : c'est la MEME fonction que les gardes
// utilisent, importee et non reecrite.
const { relever } = await import(
  resolve(RACINE, 'apps/web/test/orthographe-affichee.test.ts')
);

const releve = relever(modulesTexte(), RACINE);
const parMot = new Map();
for (const o of releve.nus) {
  const clef = o.mot.toLowerCase();
  if (!parMot.has(clef)) parMot.set(clef, []);
  parMot.get(clef).push(o);
}
const distincts = [...parMot.keys()];

const ENV = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const options = ['-d', 'fr_FR', '-i', 'UTF-8'];

const refuses = new Set(
  execFileSync('hunspell', [...options, '-l'], {
    input: `${distincts.join('\n')}\n`,
    encoding: 'utf8',
    env: ENV,
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
);

// `^` protege chaque mot : sans lui, hunspell lirait certaines lignes comme des commandes.
const liste = [...refuses];
const verdicts = execFileSync('hunspell', [...options, '-a'], {
  input: `${liste.map((m) => `^${m}`).join('\n')}\n`,
  encoding: 'utf8',
  env: ENV,
})
  .split('\n')
  .slice(1)
  .filter((l) => l.trim() !== '');

const plie = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const candidats = [];
liste.forEach((mot, i) => {
  const ligne = verdicts[i] ?? '';
  const suggestions = ligne.includes(':') ? ligne.split(':')[1].trim().split(', ') : [];
  // On exige une difference d'ACCENT, pas de casse : « aot » suggerant « AOT » n'est pas une faute
  // d'accent, c'est un sigle.
  const accentuees = suggestions.filter(
    (s) => plie(s) === mot.toLowerCase() && s.toLowerCase() !== mot.toLowerCase(),
  );
  if (accentuees.length > 0) candidats.push({ mot, accentuees, occurrences: parMot.get(mot) });
});

const occurrences = candidats.reduce((t, c) => t + c.occurrences.length, 0);
console.log(
  `${distincts.length} mots distincts dans le texte affiche | ${refuses.size} refuses par hunspell | ` +
    `${candidats.length} dont un accent manquant explique le refus (${occurrences} occurrences)\n`,
);

for (const { mot, accentuees, occurrences: occ } of candidats.sort((a, b) => a.mot.localeCompare(b.mot))) {
  console.log(`== ${mot}  ->  ${accentuees.join(' / ')}`);
  for (const o of occ) {
    console.log(`   ${`${o.module}:${o.ligne}`.padEnd(52)} ${o.contexte.slice(0, 96)}`);
  }
}

if (candidats.length > 0) {
  console.log(
    '\nLisez chaque occurrence : le dictionnaire ne distingue pas le verbe du participe. Corrigez ce ' +
      "qui est faux, puis ajoutez les graphies au garde `orthographe-dictionnaire.test.ts` pour qu'elles " +
      'ne reviennent pas.',
  );
}
