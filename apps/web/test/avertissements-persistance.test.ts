/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * RETIRER UN AVERTISSEMENT DU §12 EST DEFINITIF — ET REVERSIBLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER GARDE. Les deux avertissements de la section 12 etaient masquables pour la
 * SEULE session : ils revenaient a chaque chargement. Le proprietaire du projet a demande qu'ils
 * puissent etre retires pour de bon. Ce changement revient sur une decision que plusieurs audits
 * avaient defendue — l'audit 8 appelle ces textes « la seule protection du lecteur » — il ne doit
 * donc pas pouvoir se produire par accident, ni se defaire en silence.
 *
 * CE QUI REND LA DEMANDE TENABLE, verifie et non suppose : le rapport PDF porte une section
 * entiere « Avertissements - a lire avant tout usage » avec ces memes textes, plus un pied de page
 * sur chaque page. La protection subsiste donc dans le document qui engage. Ce qui disparait, c'est
 * la repetition a l'ecran pour quelqu'un qui les a deja lus.
 *
 * TROIS PROPRIETES, ET AUCUNE N'EST DECORATIVE :
 *
 *   1. le retrait est RELU au chargement — sans quoi « definitif » redevient « pour la session » ;
 *   2. le retrait est ECRIT dans le stockage — sans quoi il ne survit pas au rechargement ;
 *   3. le rappel VIDE la liste, dans l'etat ET dans le stockage — sans quoi « reversible » serait
 *      faux, et un retrait fait par curiosite exigerait de vider le stockage du navigateur.
 *
 * POURQUOI UN FICHIER A PART, et un seul import. Le magasin lit `localStorage` AU CHARGEMENT DU
 * MODULE (`const prefs = chargerPreferences()`). La propriete 1 ne peut donc se verifier qu'avec un
 * stockage deja garni AVANT le premier import — ce qui interdit de partager ce fichier avec des
 * tests qui importeraient le magasin autrement. L'ordre ci-dessous n'est pas un style, c'est la
 * condition de la mesure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const CLE = 'enr_preferences';

/**
 * Un `localStorage` minimal, pose AVANT l'import du magasin.
 *
 * Node n'en fournit pas par defaut. Celui-ci est volontairement nu : il n'a pas a imiter le
 * navigateur, seulement a rendre observable ce que le magasin y ecrit.
 */
const memoire = new Map<string, string>();
memoire.set(CLE, JSON.stringify({ avertissementsMasques: ['avert_deja_retire'] }));
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (c: string): string | null => memoire.get(c) ?? null,
  setItem: (c: string, v: string): void => void memoire.set(c, v),
  removeItem: (c: string): void => void memoire.delete(c),
  clear: (): void => memoire.clear(),
  key: (i: number): string | null => [...memoire.keys()][i] ?? null,
  get length(): number {
    return memoire.size;
  },
};

const { useEtat } = await import('../src/store/etat.js');

/** Ce que le magasin a effectivement ecrit dans le stockage. */
function retiresDansLeStockage(): string[] {
  const brut = memoire.get(CLE);
  assert.ok(brut, 'le magasin n’a rien ecrit dans le stockage');
  return (JSON.parse(brut) as { avertissementsMasques?: string[] }).avertissementsMasques ?? [];
}

test('un avertissement retire avant le chargement l’est encore apres', () => {
  // La propriete qui distingue « definitif » de « pour cette session ». Sans elle, tout le reste
  // de ce fichier passerait quand meme, et l'avertissement reviendrait au prochain chargement.
  assert.deepEqual(useEtat.getState().avertissementsMasques, ['avert_deja_retire']);
});

test('retirer un avertissement l’ecrit dans le stockage, sans perdre les precedents', () => {
  useEtat.getState().masquerAvertissement('avert_nouveau');
  assert.deepEqual(useEtat.getState().avertissementsMasques, [
    'avert_deja_retire',
    'avert_nouveau',
  ]);
  assert.deepEqual(retiresDansLeStockage(), ['avert_deja_retire', 'avert_nouveau']);
});

test('retirer deux fois le meme avertissement ne le compte pas deux fois', () => {
  // Le compteur du bouton de rappel lit cette liste : un doublon afficherait « 3 avertissements »
  // la ou il n'y en a que deux, et le retrait est desormais persiste, donc le doublon le serait
  // aussi — a chaque clic.
  const avant = useEtat.getState().avertissementsMasques.length;
  useEtat.getState().masquerAvertissement('avert_nouveau');
  assert.equal(useEtat.getState().avertissementsMasques.length, avant);
  assert.equal(retiresDansLeStockage().length, avant);
});

test('le rappel vide la liste, dans l’etat ET dans le stockage', () => {
  // « Definitif » ne doit pas vouloir dire « sans retour ». Vider l'etat sans vider le stockage
  // ferait revenir les avertissements retires au prochain chargement : le rappel n'aurait tenu
  // que le temps de la session, exactement le defaut que ce changement corrige, a l'envers.
  useEtat.getState().rappelerAvertissements();
  assert.deepEqual(useEtat.getState().avertissementsMasques, []);
  assert.deepEqual(retiresDansLeStockage(), []);
});

test('un stockage illisible ne fait pas planter le magasin', () => {
  // Navigation privee, quota depasse, valeur corrompue a la main : le magasin doit demarrer avec
  // une liste vide plutot que refuser de se charger. La lecture est deja protegee ; ce test le
  // fixe, parce qu'un `JSON.parse` sans garde est exactement le genre de ligne qu'on ajoute sans y
  // penser.
  memoire.set(CLE, '{ ceci n’est pas du JSON');
  assert.doesNotThrow(() => useEtat.getState().masquerAvertissement('avert_apres_corruption'));
  assert.deepEqual(useEtat.getState().avertissementsMasques, ['avert_apres_corruption']);
});
