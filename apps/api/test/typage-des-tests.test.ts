/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES TESTS DE CE PAQUET SONT TYPES — et ils ne l'etaient pas
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI MANQUAIT. `apps/api/tsconfig.json` ne portait que `"include": ["src/**\/*"]`. Les
 * cinquante fichiers de `test/` etaient donc ecrits en TypeScript, executes par `tsx`, et JAMAIS
 * verifies par le compilateur. Un test peut alors se tromper de type sans que rien ne le dise — et
 * un test qui se trompe de type ne prouve plus ce qu'il annonce.
 *
 * `apps/web` avait ferme ce trou et documente le raisonnement dans son propre
 * `typage-des-tests.test.ts`. Le meme trou restait ouvert ici, sur le paquet qui porte le plus de
 * code.
 *
 * CE QUE L'OUVERTURE DU PERIMETRE A TROUVE : 31 erreurs sur 8 fichiers, dont quatre defauts reels.
 *
 *   1. `limiterDebit` se declarait `preHandlerHookHandler` — la forme a rappel, trois parametres —
 *      alors qu'elle rend une fonction asynchrone a deux. Quinze appels parfaitement corrects
 *      etaient refuses pour un `done` qui n'existe pas. Corrige a la SOURCE, en
 *      `preHandlerAsyncHookHandler` ;
 *   2. `audit8-affirmations.test.ts` declarait `filiere = 'solaire_sol' as const`, ce qui narrait
 *      le PARAMETRE au seul litteral : la fonction n'acceptait qu'une filiere alors que le test
 *      lui en passe trois. Elles passaient a l'execution — JavaScript ne verifie rien — donc la
 *      signature mentait sans consequence visible ;
 *   3. la fixture de `exports.test.ts` avait perdu `lineaireRaccordementKm`, ajoute depuis a
 *      `LigneResultatFiltre`. Les tests d'export s'exercaient sur une forme que la recherche ne
 *      produit plus — exactement ce contre quoi le commentaire de la fixture voisine met en garde.
 *      Son `Identite` avait de meme perdu `prefixe` ;
 *   4. `scripts/portable/amorce.mjs` arrivait en `any` faute de declaration. Le test de l'amorce
 *      nationale ne verifiait donc plus aucune signature du garde qui decide quelles tables
 *      partent dans une archive distribuee — et lesquelles, donnees nominatives et secret de
 *      signature en tete, ne doivent jamais en sortir.
 *
 * POURQUOI CE GARDE EST STRUCTUREL, ET NON UN APPEL A `tsc`. Lancer le compilateur depuis un test
 * doublerait la duree de la suite pour verifier ce que `npm run typecheck` verifie deja, a chaque
 * execution. Ce que `typecheck` ne peut PAS voir, c'est qu'on ait retreci son perimetre : retirer
 * `test/**\/*` de l'`include` rendrait le typage vert ET la couverture nulle, sans un mot. C'est
 * exactement le mode de defaillance qui a laisse ce trou ouvert. Ce fichier le ferme.
 *
 * POURQUOI DEUX CONFIGURATIONS. `tsconfig.json` sert a CONSTRUIRE : il porte `rootDir: src` et
 * emet `dist/serveur.js`, le point d'entree declare par le paquet. Y ajouter les tests obligerait
 * a retirer `rootDir`, et TypeScript deduirait une racine commune a `src` et `test` — la sortie
 * partirait dans `dist/src/`, et le paquet ne demarrerait plus. `tsconfig.test.json` ne construit
 * donc rien et n'existe que pour verifier.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const PAQUET = resolve(ICI, '..');

function lireJson(chemin: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(PAQUET, chemin), 'utf8')) as Record<string, unknown>;
}

test('le perimetre de typage couvre les tests de ce paquet', () => {
  const config = lireJson('tsconfig.test.json');
  const include = config['include'];

  assert.ok(Array.isArray(include), 'tsconfig.test.json doit declarer un `include`');
  assert.ok(
    include.includes('test/**/*'),
    'les tests de `apps/api` doivent etre dans le perimetre du compilateur : ' +
      'sans cela, un test peut se tromper de type sans que rien ne le dise',
  );
  assert.ok(
    include.includes('src/**/*'),
    'la source doit y etre aussi : un test ne se verifie que contre le code qu’il exerce',
  );

  // Et cette configuration ne doit RIEN emettre : c'est `tsconfig.json` qui construit.
  const options = config['compilerOptions'] as Record<string, unknown> | undefined;
  assert.equal(options?.['noEmit'], true, 'tsconfig.test.json ne doit rien emettre');
});

test('la configuration de CONSTRUCTION garde sa racine, et n’emet pas les tests', () => {
  /*
   * LE PIEGE A EVITER, et il est concret : ajouter `test/**\/*` a `tsconfig.json` oblige a retirer
   * `rootDir`. TypeScript deduit alors une racine commune a `src` et `test`, la sortie part dans
   * `dist/src/serveur.js`, et `main` — qui pointe sur `dist/serveur.js` — ne resout plus rien. Le
   * paquet construit sans erreur et ne demarre pas.
   */
  const config = lireJson('tsconfig.json');
  const options = config['compilerOptions'] as Record<string, unknown>;
  const include = config['include'];

  assert.equal(options['rootDir'], 'src', 'la construction doit garder `rootDir: src`');
  assert.ok(Array.isArray(include));
  assert.ok(
    !include.some((m) => String(m).startsWith('test/')),
    'les tests ne doivent pas entrer dans la configuration de CONSTRUCTION',
  );

  // Le point d'entree doit correspondre a ce que cette racine produit.
  const paquet = lireJson('package.json');
  assert.equal(
    paquet['main'],
    './dist/serveur.js',
    'si `main` change, verifiez que `rootDir` produit toujours ce chemin',
  );
});

test('la commande `typecheck` exerce REELLEMENT les deux configurations', () => {
  /*
   * Sans cela, `tsconfig.test.json` pourrait exister, etre correct, et n'etre jamais lance — le
   * troisieme mecanisme ecrit puis oublie du depot. L'integration continue appelle `typecheck` ;
   * c'est donc cette commande qui doit porter les deux.
   */
  const paquet = lireJson('package.json');
  const scripts = paquet['scripts'] as Record<string, string>;
  const typecheck = scripts['typecheck'] ?? '';

  assert.match(typecheck, /tsconfig\.json/, '`typecheck` doit verifier la source');
  assert.match(typecheck, /tsconfig\.test\.json/, '`typecheck` doit verifier les tests');
});

test('les scripts .mjs importes par les tests portent une declaration de types', () => {
  /*
   * Un module `.mjs` sans declaration arrive en `any` : le test qui l'importe ne verifie plus
   * aucune signature, en silence. Quatre scripts sont dans ce cas dans le depot, tous garde-fous —
   * amorce d'archive, envoi au depot distant, mot de passe de portail — et tous doivent rester du
   * JavaScript pur, puisqu'ils tournent chez l'utilisateur final sans etape de construction. D'ou
   * des `.d.mts` ecrits a la main.
   */
  const source = readFileSync(resolve(PAQUET, 'test', 'amorce-nationale.test.ts'), 'utf8');
  assert.match(source, /scripts\/portable\/amorce\.mjs/, 'le test doit bien importer ce script');

  const declaration = resolve(PAQUET, '..', '..', 'scripts', 'portable', 'amorce.d.mts');
  const contenu = readFileSync(declaration, 'utf8');
  for (const nom of ['tablesDuSchema', 'classer', 'verifierAmorce', 'TABLES_ECARTEES']) {
    assert.match(
      contenu,
      new RegExp(`\\b${nom}\\b`),
      `la declaration doit couvrir « ${nom} », que le test appelle`,
    );
  }
});
