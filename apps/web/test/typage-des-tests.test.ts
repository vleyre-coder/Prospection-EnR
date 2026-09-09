/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * LES TESTS DE CE PAQUET SONT TYPÉS — et ils ne l'étaient pas
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══ CE QUI MANQUAIT, ET COMBIEN ÇA COÛTAIT
 *
 * `apps/web/tsconfig.json` ne portait que `"include": ["src/**\/*"]`. Les 21 fichiers de `test/` et
 * les 12 de `e2e/` étaient donc écrits en TypeScript, exécutés par `tsx`, et **jamais vérifiés par
 * le compilateur**. Un test peut alors se tromper de type sans que rien ne le dise — et un test qui
 * se trompe de type ne prouve plus ce qu'il annonce.
 *
 * Mesure du 8 septembre 2026, en ajoutant `test/**\/*` et `e2e/**\/*` à la configuration : **6
 * erreurs**, dont quatre défauts réels et deux points de configuration.
 *
 *   1. `TS7016` × 3 — trois modules `.mjs` importés par des tests sans aucune déclaration, donc
 *      typés `any` en silence : `scripts/portable/animation.mjs`, `scripts/portable/depot.mjs` et
 *      `scripts/portail-mot-de-passe.mjs`. Le dernier décide si un mot de passe de portail est
 *      acceptable ; le second empêche d'envoyer `donnees/` ou un `.env` sur GitHub. Leurs tests ne
 *      vérifiaient plus aucune signature. Trois fichiers `.d.mts` écrits à la main y répondent —
 *      à la main parce que ces scripts doivent rester du JavaScript pur, ils tournent chez
 *      l'utilisateur final sans étape de construction.
 *
 *   2. `TS2339` — `assert.equal(v.ok, true, \`… (${v.probleme})\`)` dans `portail-netlify.test.ts` :
 *      `probleme` n'existe que dans la branche refusée de l'union. Sans consequence sur une
 *      proposition acceptée, mais c'est le même relâchement qui écrit « (undefined) » dans un
 *      message d'échec le jour où ce message compte.
 *
 *   3. `TS2345` — `t.includes(echantillon[0]!.nomCommune)` dans `rendu-liste-tableau.test.ts` :
 *      `nomCommune` est `string | null` dans le type de l'API. Avec `null`, l'assertion cherchait
 *      la chaîne « null » et réussissait ou échouait pour la mauvaise raison.
 *
 *   4. `TS5097` × 2 — deux imports en `.ts` explicite, exigés par la fonction edge de Netlify.
 *      `allowImportingTsExtensions` est activé : il est licite ici puisque ce projet est en
 *      `noEmit` et que Vite fait l'empaquetage.
 *
 * Deux défauts de la même famille avaient déjà été trouvés à la main lors de la revue d'ergonomie —
 * un fixture qui ne compilait plus contre `ZoneProposee`, et un ternaire dont les deux branches
 * rendaient la même chose. Ils avaient été corrigés sans que la cause le soit.
 *
 * ═══ POURQUOI CE GARDE EST STRUCTUREL, ET NON UN APPEL À `tsc`
 *
 * Lancer le compilateur depuis un test doublerait le temps de la suite pour vérifier ce que
 * `npm run typecheck` vérifie déjà — à chaque exécution, et dans le job d'intégration continue qui
 * l'appelle. Ce que `typecheck` ne peut PAS voir, c'est qu'on ait rétréci son périmètre : retirer
 * `test/**\/*` de l'`include` rendrait le typage vert ET la couverture nulle, sans un mot.
 *
 * C'est exactement le mode de défaillance qui a laissé ce trou ouvert dix-sept audits. Ce fichier le
 * ferme : il lit la configuration et exige que le périmètre y soit.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ICI = dirname(fileURLToPath(import.meta.url));
const PAQUET = resolve(ICI, '..');
const RACINE = resolve(PAQUET, '..', '..');

/**
 * La configuration, lue telle quelle si elle est du JSON strict, sinon debarrassee de ses
 * commentaires — un `tsconfig.json` a le droit d'en porter.
 *
 * LE PIEGE, ET IL M'A ATTRAPE. Ma premiere version retirait les commentaires par deux expressions
 * regulieres appliquees a tout le fichier. La valeur `src/**` suivie de `/*` contient la sequence
 * qui ouvre un commentaire de bloc : le motif l'avalait avec tout ce qui suivait, et le test
 * annoncait une disparition sur une configuration parfaitement correcte. Un garde qui accuse a tort
 * est pire qu'absent : on apprend a l'ignorer.
 *
 * Le retrait est donc CONSCIENT DES CHAINES, et il n'a lieu que si le JSON strict a echoue.
 */
function configuration(): { include?: string[]; compilerOptions?: Record<string, unknown> } {
  const brut = readFileSync(resolve(PAQUET, 'tsconfig.json'), 'utf8');
  try {
    return JSON.parse(brut);
  } catch {
    let net = '';
    let dansChaine = false;
    for (let i = 0; i < brut.length; i += 1) {
      const c = brut[i]!;
      if (dansChaine) {
        net += c;
        if (c === '\\') {
          net += brut[i + 1] ?? '';
          i += 1;
        } else if (c === '"') dansChaine = false;
        continue;
      }
      if (c === '"') {
        dansChaine = true;
        net += c;
        continue;
      }
      if (c === '/' && brut[i + 1] === '/') {
        while (i < brut.length && brut[i] !== '\n') i += 1;
        net += '\n';
        continue;
      }
      if (c === '/' && brut[i + 1] === '*') {
        i = brut.indexOf('*/', i + 2) + 1;
        continue;
      }
      net += c;
    }
    return JSON.parse(net);
  }
}

test('LE PERIMETRE DU TYPAGE COUVRE LES TESTS ET LES PARCOURS DE BOUT EN BOUT', () => {
  const { include } = configuration();
  assert.ok(Array.isArray(include), 'tsconfig.json doit porter un `include` explicite');

  for (const attendu of ['src/**/*', 'test/**/*', 'e2e/**/*']) {
    assert.ok(
      include.includes(attendu),
      `« ${attendu} » a disparu de l’\`include\` de apps/web/tsconfig.json.\n` +
        'Le retirer rend `npm run typecheck` vert en cessant de regarder : c’est ce qui a laissé ' +
        'six erreurs de typage vivre dans les tests jusqu’au 8 septembre 2026. Si le retrait est ' +
        'voulu, il faut le justifier ici, pas seulement dans la configuration.',
    );
  }
});

test('les trois modules .mjs importes par des tests portent leurs declarations', () => {
  /*
   * Sans elles, TypeScript type le module `any` et rend `TS7016` — ou pire, se taise si un jour
   * `noImplicitAny` etait relache. Le garde porte sur la PRESENCE du fichier : son contenu, lui,
   * est verifie par le compilateur a chaque `npm run typecheck`.
   */
  const attendus = [
    'scripts/portable/animation.d.mts',
    'scripts/portable/depot.d.mts',
    'scripts/portail-mot-de-passe.d.mts',
  ];
  for (const chemin of attendus) {
    const contenu = readFileSync(resolve(RACINE, chemin), 'utf8');
    assert.match(
      contenu,
      /^export /m,
      `${chemin} ne declare rien : un fichier de declarations vide rend le module « any » sans ` +
        'que TS7016 ne le signale plus',
    );
  }
});

test('allowImportingTsExtensions reste licite : ce paquet ne produit rien', () => {
  /*
   * `allowImportingTsExtensions` n'est accepte par TypeScript qu'avec `noEmit` ou
   * `emitDeclarationOnly` — c'est Vite qui empaquette ici. Si quelqu'un retirait `noEmit`, le
   * compilateur refuserait la configuration entiere, et le message ne dirait pas pourquoi les deux
   * options sont liees. Ce test le dit.
   */
  const { compilerOptions } = configuration();
  assert.ok(compilerOptions, 'tsconfig.json doit porter des `compilerOptions`');
  if (compilerOptions['allowImportingTsExtensions'] === true) {
    assert.equal(
      compilerOptions['noEmit'],
      true,
      '`allowImportingTsExtensions` exige `noEmit` : les deux vont ensemble, et c’est Vite qui ' +
        'produit le paquet de cette application.',
    );
  }
});
