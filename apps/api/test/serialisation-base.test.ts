/**
 * LES LISTES DE FICHIERS TENUES A LA MAIN, ET POURQUOI ELLES DOIVENT ETRE GARDEES.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE L'AUDIT 11 A TROUVE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * L'integration continue etait ROUGE depuis huit livraisons, sur ses trois jobs, sans que
 * personne — moi compris — n'aille regarder. Je declarais la suite verte sur la foi
 * d'executions locales, sur une base que des mois d'essais avaient peuplee. Sur une base
 * fraichement migree, treize fichiers de test se partagent le departement fictif 99 et
 * plusieurs font le menage par `DELETE ... WHERE code_departement = '99'` ; `node --test`
 * executant les FICHIERS en parallele, ils s'effacaient mutuellement leur population.
 *
 * Mesures, memes fichiers, meme base neuve, un drapeau d'ecart :
 *   - en parallele : 51/57, puis 75/77 a l'execution suivante — les tests en echec CHANGENT,
 *     signature d'une course, et raison pour laquelle la CI semblait tomber en panne
 *     differemment chaque fois ;
 *   - en serie : 57/57 puis 77/77, reproductible.
 *   - prix : 44 s contre 34 s. Dix secondes.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER GARDE, ET POURQUOI CE N'EST PAS LE MEME DEFAUT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La serialisation vit dans une COMMANDE (`test:base`, et les etapes de `ci.yml`), donc loin
 * des tests qui en dependent. Deux facons de la perdre en silence :
 *
 *   1. un fichier ajoute demain touche la base et n'est inscrit nulle part — il ne tourne
 *      alors ni dans `test:base` ni dans la CI, et ne protege plus rien. C'est EXACTEMENT le
 *      defaut qui a laisse 22 tests rouges sans que personne le sache, a la livraison
 *      precedente ;
 *   2. une etape de CI est recopiee sans le drapeau, et la course revient.
 *
 * Ce fichier ne teste donc pas du code applicatif : il teste que l'OUTILLAGE dit la verite.
 * C'est le seul endroit du depot ou cette propriete peut etre verifiee, et elle ne coute rien
 * — aucune base requise, tout est lisible sur le disque.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAPEAU_SERIE, refusDeCourse } from './aides/communes-fictives.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_API = resolve(ICI, '..');
const RACINE_DEPOT = resolve(RACINE_API, '..', '..');

/** Nom du module d'aide qui porte le territoire fictif partage. */
const AIDE = 'communes-fictives';

/**
 * Les fichiers de test qui ECRIVENT dans le territoire partage — lus sur le disque.
 *
 * DEUX CONDITIONS, ET LA SECONDE N'EST PAS DU ZELE. Importer l'aide ne suffit pas : ce
 * fichier-ci l'importe pour ses deux valeurs pures (`DRAPEAU_SERIE`, `refusDeCourse`) et ne
 * touche aucune base — il n'a donc rien a serialiser, et l'exiger de lui aurait fait echouer
 * le garde sur son propre auteur, ce que la premiere execution a effectivement montre. Le
 * critere qui dit la verite est : importer le territoire ET parler a la base.
 */
function fichiersDuTerritoirePartage(): string[] {
  return readdirSync(join(RACINE_API, 'test'))
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => {
      const source = readFileSync(join(RACINE_API, 'test', f), 'utf8');
      return source.includes(AIDE) && /from '\.\.\/src\/bdd\.js'/.test(source);
    })
    .sort();
}

function scriptTestBase(): string {
  const pkg = JSON.parse(readFileSync(join(RACINE_API, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const script = pkg.scripts['test:base'];
  assert.ok(script, "le script `test:base` doit exister : c'est lui qui serialise les tests de base");
  return script;
}

test('le temoin : la detection du territoire partage trouve bien des fichiers', () => {
  // Sans ce temoin, une lecture qui renverrait une liste vide ferait passer tous les tests
  // suivants pour de bonnes raisons apparentes et de mauvaises raisons reelles.
  const fichiers = fichiersDuTerritoirePartage();
  assert.ok(
    fichiers.length >= 5,
    `seulement ${fichiers.length} fichier(s) trouve(s) : la detection de « ${AIDE} » est cassee`,
  );
});

test('TOUT fichier touchant le territoire partage est inscrit dans `test:base`', () => {
  const script = scriptTestBase();
  const oublies = fichiersDuTerritoirePartage().filter((f) => !script.includes(f));
  assert.deepEqual(
    oublies,
    [],
    'Ces fichiers ecrivent dans le territoire fictif partage mais ne figurent pas dans le ' +
      'script `test:base` : ils tourneront donc en PARALLELE des autres et effaceront leurs ' +
      "donnees. Ajoutez-les au script, et a l'etape correspondante de .github/workflows/ci.yml.",
  );
});

test('`test:base` serialise reellement, et ne se contente pas de lister', () => {
  assert.match(
    scriptTestBase(),
    new RegExp(DRAPEAU_SERIE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `sans ${DRAPEAU_SERIE}, la liste ne sert a rien : les fichiers repartent en parallele`,
  );
});

test('`test:base` ne nomme aucun fichier disparu', () => {
  /**
   * Le sens inverse, et il compte autant. Un fichier renomme laisserait son ancien nom dans le
   * script : la commande echouerait sur un fichier introuvable, ou — pire selon les versions du
   * lanceur — n'executerait rien en le signalant a peine.
   */
  const existants = new Set(
    readdirSync(join(RACINE_API, 'test')).filter((f) => f.endsWith('.test.ts')),
  );
  const nommes = [...scriptTestBase().matchAll(/test\/([A-Za-z0-9._-]+\.test\.ts)/g)].map(
    (m) => m[1] as string,
  );
  assert.ok(nommes.length > 0, 'le script devrait nommer des fichiers');
  const fantomes = nommes.filter((f) => !existants.has(f));
  assert.deepEqual(fantomes, [], 'ces fichiers sont nommes par `test:base` mais n’existent plus');
});

test("toute etape de CI qui lance ces tests porte le drapeau de serialisation", () => {
  /**
   * La CI est le seul endroit ou ces tests tournent vraiment avec une base, et c'est donc le
   * seul endroit ou la course fait des degats visibles. Le controle porte sur le FICHIER DE
   * WORKFLOW, pas sur ce qu'on croit y avoir ecrit — meme regle que pour l'amorce, ou le
   * controle relit le dump produit et non la commande lancee.
   */
  const chemin = join(RACINE_DEPOT, '.github', 'workflows', 'ci.yml');
  const yml = readFileSync(chemin, 'utf8');
  const partages = fichiersDuTerritoirePartage();

  // Une etape = un bloc `- name:` jusqu'au suivant. Decoupage grossier, et suffisant : on
  // cherche seulement la coexistence, dans un meme bloc, d'un fichier partage et du drapeau.
  const etapes = yml.split(/^      - name: /m).slice(1);
  assert.ok(etapes.length > 5, `decoupage des etapes suspect : ${etapes.length} trouvee(s)`);

  const fautives = etapes
    .filter((e) => partages.some((f) => e.includes(f)))
    .filter((e) => !e.includes(DRAPEAU_SERIE))
    .map((e) => (e.split('\n')[0] ?? '').trim());

  assert.deepEqual(
    fautives,
    [],
    `Ces etapes de ci.yml lancent des tests du territoire partage SANS ${DRAPEAU_SERIE} : ` +
      'elles rejoueront la course qui a rendu la CI rouge huit livraisons de suite.',
  );
});

test('le garde REFUSE vraiment un fichier lance en parallele, pas seulement en theorie', () => {
  /**
   * La fonction pure est testee juste en dessous ; ce test-ci verifie qu'elle est BRANCHEE.
   * Un garde calcule puis ignore serait le pire des deux mondes : il donnerait l'assurance
   * d'une protection tout en laissant la course intacte. On lance donc reellement un fichier
   * du territoire partage, avec une base et sans le drapeau, et on exige un refus.
   *
   * Sans `DATABASE_URL`, il n'y a rien a garder et ce test n'a pas d'objet : il s'ignore.
   */
  if (!process.env['DATABASE_URL']) {
    process.stderr.write('# base absente : branchement du garde non verifie (DATABASE_URL requis)\n');
    return;
  }
  /**
   * `NODE_TEST_CONTEXT` EST RETIRE, et il a fallu l'executer pour le decouvrir. Quand un
   * fichier de test lance lui-meme un lanceur de tests, le petit-fils herite de cette
   * variable, se croit rattache au lanceur parent, et SORT EN 0 quand meme. Premiere
   * execution : le meme `spawnSync` rendait 1 depuis un `node` ordinaire et 0 depuis
   * `tsx --test` — le test concluait donc que le garde ne marchait pas, alors que c'etait le
   * code de retour qui etait avale.
   */
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const r = spawnSync('npx', ['tsx', '--test', 'test/pagination-stable.test.ts'], {
    cwd: RACINE_API,
    encoding: 'utf8',
    timeout: 120_000,
    env,
  });
  const sortie = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.notEqual(r.status, 0, 'une execution en parallele doit echouer, pas passer');
  assert.match(sortie, /departement fictif/, 'le refus doit expliquer la cause');
  assert.match(sortie, /test:base/, 'et nommer la commande a utiliser');
});

test('le refus de course ne se declenche que quand il y a quelque chose a partager', () => {
  // Sans base, ces fichiers s'ignorent : exiger la serie ferait echouer un `npm test`
  // ordinaire — et le premier reflexe serait alors de retirer le garde.
  assert.equal(refusDeCourse([], {}), null, 'sans DATABASE_URL, rien a garder');
  assert.equal(
    refusDeCourse([DRAPEAU_SERIE], { DATABASE_URL: 'postgres://x' }),
    null,
    'avec le drapeau, rien a signaler',
  );
  const refus = refusDeCourse([], { DATABASE_URL: 'postgres://x' });
  assert.ok(refus, 'avec une base et sans drapeau, le refus doit tomber');
  assert.match(refus, /test:base/, 'le refus doit nommer la commande a utiliser');
});
