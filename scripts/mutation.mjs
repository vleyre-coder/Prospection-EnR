#!/usr/bin/env node
/**
 * Verification par mutation, sur les invariants les plus couteux a perdre.
 *
 * POURQUOI. Sept audits ont montre qu'un test peut passer sans rien proteger : mes propres tests
 * de `estHabitation` verifiaient un cas qui se produit 0,0 % du temps, et mon controle de contrat
 * ne couvrait que 3 connecteurs sur 14 sans le dire. La seule facon de savoir qu'un test protege
 * quelque chose est de casser ce qu'il pretend proteger et de verifier qu'il echoue.
 *
 * Ce script etait une manipulation manuelle a chaque audit. Il devient une etape de CI : chaque
 * mutation ci-dessous DOIT faire echouer au moins un test. Une mutation qui passe signale un test
 * decoratif, et c'est une regression aussi reelle qu'un bug.
 *
 * Ce n'est pas un outil de mutation generique : la liste est choisie, chaque entree correspond a
 * un defaut REELLEMENT survenu, et porte la reference de l'audit qui l'a trouve.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** @type {Array<{ audit: string, quoi: string, fichier: string, de: string, vers: string, tests: string[] }>} */
const MUTATIONS = [
  {
    audit: 'audit 5',
    quoi: 'la troncature WFS n’est plus detectee',
    fichier: 'apps/api/src/connecteurs/distances.ts',
    de: 'return d != null && d <= rayonCouvertM ? d : null;',
    vers: 'return d;',
    tests: ['apps/api/test/wfs-troncature.test.ts', 'apps/api/test/zonage-naturel.test.ts'],
  },
  {
    audit: 'audit 6',
    quoi: '« Indifferencie » est de nouveau exclu des habitations',
    fichier: 'apps/api/src/connecteurs/wfs.ts',
    de: "return v === '' || v.startsWith('indiff');",
    vers: "return v === '';",
    tests: ['apps/api/test/wfs-troncature.test.ts', 'apps/api/test/transformation-connecteurs.test.ts'],
  },
  {
    audit: 'audit 6',
    quoi: 'le nom du zonage revient au premier objet renvoye',
    fichier: 'apps/api/src/connecteurs/distances.ts',
    de: 'nom: distanceRetenue == null ? null : (plusProche?.nom ?? null),',
    vers: 'nom: feats[0]?.nom ?? null,',
    tests: ['apps/api/test/zonage-naturel.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'les PPR incendie sont classes avant d’etre distingues des PPR inondation',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "if (/\\bppr[nt]?-?if\\b|\\bpprif\\b/.test(l)) trouvees.add('incendie');",
    vers: '// mutation',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'le souligne casse de nouveau la limite de mot des sigles de PPR',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "const l = brut.toLowerCase().replace(/_/g, ' ');",
    vers: 'const l = brut.toLowerCase();',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'les PPRT sont classes au libelle plutot qu’a leur provenance',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "for (const p of pprt?.objets ?? []) classer(p, ['technologique']);",
    vers: 'for (const p of pprt?.objets ?? []) classer(p, famillesRisque(p.libPpr));',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'une chaine vide redevient zero a l’ingestion',
    fichier: 'apps/api/src/ingestion/index.ts',
    de: "if (brut === '') return null;",
    vers: '// mutation',
    tests: ['apps/api/test/ingestion.test.ts'],
  },
];

let echecs = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.fichier, 'utf8');
  if (!original.includes(m.de)) {
    console.error(`\nECHEC (${m.audit}) : motif introuvable dans ${m.fichier}.`);
    console.error(`  Le code a change : mettez la mutation a jour, ou retirez-la si l'invariant a disparu.`);
    console.error(`  Motif attendu : ${m.de}`);
    echecs += 1;
    continue;
  }
  writeFileSync(m.fichier, original.replace(m.de, m.vers));
  let attrapee = false;
  try {
    execFileSync('npx', ['tsx', '--test', ...m.tests], { stdio: 'pipe' });
  } catch {
    attrapee = true;
  } finally {
    writeFileSync(m.fichier, original);
  }
  if (attrapee) {
    console.log(`OK   (${m.audit}) ${m.quoi}`);
  } else {
    console.error(`\nECHEC (${m.audit}) : « ${m.quoi} » ne fait echouer AUCUN test.`);
    console.error(`  Les tests ${m.tests.join(', ')} sont donc decoratifs sur ce point.`);
    echecs += 1;
  }
}

console.log(`\n${MUTATIONS.length - echecs}/${MUTATIONS.length} mutations attrapees.`);
process.exit(echecs > 0 ? 1 : 0);
