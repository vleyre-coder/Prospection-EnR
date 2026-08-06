/**
 * Une valeur inconnue se lit comme inconnue.
 *
 * POURQUOI CE FICHIER EXISTE. `FicheParcelle.tsx` decide de ce que le prospecteur lit, donc de ce sur
 * quoi une decision est prise. Il pesait 1 200 lignes pour zero test, et les audits 5 a 8 ont tous
 * releve le ratio de test de l'interface sans jamais atteindre cette logique.
 *
 * L'audit 8 a montre pourquoi c'est le mauvais endroit pour faire l'economie d'un test. Ses deux
 * defauts les plus graves n'etaient pas des plantages : c'etaient des PHRASES. « Aucun site classe ni
 * inscrit dans le rayon d'analyse » et « 1 proprietaire(s) estime(s) » s'affichaient comme des
 * constats de recherche, sur zero donnee. Un critere gris protege son lecteur — il dit « je ne sais
 * pas ». Une phrase affirmative, une cellule vide ou un zero mis pour un inconnu ne peuvent pas etre
 * rattrapes : ils ne ressemblent pas a une absence.
 *
 * POURQUOI PAS UN MONTAGE DE COMPOSANT. Premiere tentative : monter `val()` avec jsdom et
 * `@testing-library/react`. Le montage echoue sur `import.meta.env.VITE_URL_API` — le composant
 * importe le client d'API, indisponible hors de Vite. Deux issues possibles : simuler l'environnement
 * Vite, ou extraire la decision. La seconde est meilleure, et c'est celle que l'en-tete de
 * `utils/affichage.ts` prescrit depuis sa creation : une fonction de l'etat vers un texte est de la
 * logique metier, pas du rendu. Les deux dependances de test ajoutees pour la premiere tentative ont
 * ete retirees : une dependance non utilisee est un defaut a son tour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valeurAffichable } from '../src/utils/affichage.js';
import { formatNombre } from '../src/utils/geometrie.js';

/** Le formateur reel de l'application : tester avec un autre ne prouverait rien sur l'ecran. */
const rendre = (v: unknown, unite = ''): ReturnType<typeof valeurAffichable> =>
  valeurAffichable(v, unite, formatNombre);

test('une valeur absente est signalee comme absente', () => {
  for (const v of [null, undefined]) {
    assert.deepEqual(rendre(v), { absente: true }, JSON.stringify(v));
  }
});

test('une chaine vide OU BLANCHE est une absence', () => {
  /**
   * DEFAUT TROUVE EN ECRIVANT CE TEST. La garde etait `v === ''`, qui ne rattrape pas `'   '` : une
   * chaine d'espaces produisait une cellule visuellement vide, indiscernable d'un defaut de rendu.
   * Plusieurs sources en produisent — `gestnom` des sites proteges, `commentaire` des ZAER et
   * plusieurs champs de Georisques valent l'espace plutot que la chaine vide.
   */
  for (const v of ['', ' ', '   ', '\t', '\n ']) {
    assert.deepEqual(rendre(v), { absente: true }, JSON.stringify(v));
  }
});

test('un zero mesure ne se confond pas avec une absence', () => {
  // La distinction structurante de l'application, prise a l'envers. Corriger « inconnu affiche comme
  // zero » en affichant « inconnu » partout detruirait l'information : zero cavite recensee est un
  // CONSTAT, et doit se lire comme tel.
  const r = rendre(0);
  assert.equal(r.absente, false);
  assert.match(r.absente === false ? r.texte : '', /0/);
});

test('un booleen se lit en francais, et un booleen inconnu reste inconnu', () => {
  assert.deepEqual(rendre(true), { absente: false, texte: 'oui' });
  assert.deepEqual(rendre(false), { absente: false, texte: 'non' });
  // Le cas qui compte : un booleen inconnu ne doit JAMAIS se lire « non ». C'est la forme la plus
  // courante du defaut corrige a l'audit 8 — une absence presentee comme une absence de contrainte.
  assert.deepEqual(rendre(null), { absente: true });
});

test('un nombre porte son unite et le separateur decimal francais', () => {
  // Le point decimal a ete corrige dans les exports a l'audit 5 ; l'ecran doit suivre la meme regle,
  // faute de quoi le rapport et l'interface ne se lisent pas pareil.
  const r = rendre(3.5, 'km');
  assert.equal(r.absente, false);
  const texte = r.absente === false ? r.texte : '';
  assert.match(texte, /3,5/, 'le separateur decimal doit etre la virgule');
  assert.match(texte, /km/, "l'unite doit accompagner la valeur");
  assert.doesNotMatch(texte, /3\.5/, "aucun point decimal a l'ecran");
});

test('un entier ne gagne pas de decimale fantaisiste', () => {
  const r = rendre(12, 'ha');
  assert.equal(r.absente === false && /^12\s*ha$/.test(r.texte), true, JSON.stringify(r));
});

test('un nombre non fini est une absence, et non « Infinity » a l’ecran', () => {
  // `Number.POSITIVE_INFINITY` et `NaN` traversent le typage sans bruit : un calcul de distance sur
  // une geometrie degeneree en produit. Affiches tels quels, ils se lisent comme des valeurs.
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(rendre(v), { absente: true }, String(v));
  }
});

test('une chaine renseignee passe telle quelle', () => {
  assert.deepEqual(rendre('GRDF'), { absente: false, texte: 'GRDF' });
  assert.deepEqual(rendre('Site classé'), { absente: false, texte: 'Site classé' });
});
