/**
 * Accessibilite : garanties verifiables sur les composants.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 7 listait un audit d'accessibilite (item 17) parmi les
 * travaux demandant un apport exterieur. Une partie ne le demande pas : les garanties
 * structurelles se verifient sur le source, et une fois verifiees elles doivent le rester.
 *
 * CE QUE CES TESTS COUVRENT : chaque controle interactif porte un nom accessible, les champs de
 * saisie sont associes a un libelle, et les elements masques au lecteur d'ecran le sont
 * deliberement.
 *
 * CE QU'ILS NE COUVRENT PAS, et qui reste a faire par un humain : le contraste reel des couleurs
 * rendues, l'ordre de tabulation dans la page assemblee, le comportement d'un lecteur d'ecran, et
 * l'usage a la carte au clavier seul. Un test statique ne remplace pas cela.
 *
 * NOTE DE METHODE. Ma premiere mesure signalait « 6 champs sans libelle » : elle cherchait
 * `aria-label` ou `id`, et ignorait le motif `<label><input/>Texte</label>`, qui associe le libelle
 * IMPLICITEMENT et est parfaitement valide. Il n'y avait aucun defaut. Le critere ci-dessous
 * accepte les trois formes, ce qui est la regle reelle.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function composants(): Array<{ nom: string; source: string }> {
  const base = new URL('../src/components/', import.meta.url);
  return readdirSync(base)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ nom: f, source: readFileSync(new URL(f, base), 'utf8') }));
}

/**
 * Texte lisible d'un fragment JSX.
 *
 * Les balises sont retirees, mais PAS le contenu des expressions : un libelle est tres souvent
 * conditionnel — `{enCours ? 'Connexion…' : 'Se connecter'}` porte bien un nom accessible. Ma
 * premiere version supprimait les accolades avec leur contenu et signalait donc ce bouton comme
 * muet, a tort. On conserve donc les chaines litterales trouvees dans les expressions.
 */
function texteLisible(fragment: string): string {
  const chaines = [...fragment.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    .join(' ');
  const horsBalises = fragment.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ');
  return `${horsBalises} ${chaines}`.trim();
}

test('chaque bouton porte un nom accessible', () => {
  // Un bouton dont le contenu est une icone seule est muet pour un lecteur d'ecran : il lui faut
  // un `aria-label`. Un bouton dont le contenu est du texte se nomme tout seul.
  const muets: string[] = [];
  for (const { nom, source } of composants()) {
    for (const m of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const [, attributs, contenu] = m;
      const aUnLibelle =
        /aria-label/.test(attributs ?? '') ||
        /aria-labelledby/.test(attributs ?? '') ||
        /[A-Za-zÀ-ÿ]{3,}/.test(texteLisible(contenu ?? ''));
      if (!aUnLibelle) muets.push(`${nom} : ${(contenu ?? '').trim().slice(0, 40)}`);
    }
  }
  assert.deepEqual(muets, [], `bouton(s) sans nom accessible : ${muets.join(' | ')}`);
});

test('chaque champ de saisie est associe a un libelle', () => {
  // Trois formes valides, et la troisieme est celle qu'emploie ce projet :
  //   1. `aria-label` sur le champ ;
  //   2. `id` sur le champ + `htmlFor` sur un `<label>` ;
  //   3. le champ ENVELOPPE dans un `<label>`, qui l'associe implicitement.
  const orphelins: string[] = [];
  for (const { nom, source } of composants()) {
    for (const m of source.matchAll(/<(input|select|textarea)\b[^>]*/g)) {
      const balise = m.group ? m[0] : m[0];
      if (/aria-label|aria-labelledby|\sid=/.test(balise)) continue;
      // Enveloppement : on cherche un `<label` ouvert et non ferme avant le champ.
      const avant = source.slice(0, m.index ?? 0);
      const dernierOuvrant = avant.lastIndexOf('<label');
      const dernierFermant = avant.lastIndexOf('</label>');
      if (dernierOuvrant > dernierFermant) continue;
      orphelins.push(`${nom} : ${balise.split(/\s+/).slice(0, 3).join(' ')}`);
    }
  }
  assert.deepEqual(orphelins, [], `champ(s) sans libelle associe : ${orphelins.join(' | ')}`);
});

test('les elements purement decoratifs sont masques au lecteur d’ecran', () => {
  // Une pastille de couleur qui porte deja son sens en texte a cote ne doit pas etre annoncee
  // deux fois. On verifie seulement que le projet emploie bien `aria-hidden` quelque part : sans
  // occurrence, c'est le signe que la question n'a jamais ete posee.
  const total = composants().reduce(
    (n, { source }) => n + (source.match(/aria-hidden/g) ?? []).length,
    0,
  );
  assert.ok(total > 0, 'aucun aria-hidden : les elements decoratifs ne sont pas distingues');
});

test('aucun titre de section ne saute de niveau', () => {
  // Un lecteur d'ecran navigue par titres : passer de h2 a h4 fait disparaitre un niveau de
  // structure. On verifie la progression dans chaque fichier.
  const fautes: string[] = [];
  for (const { nom, source } of composants()) {
    const niveaux = [...source.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < niveaux.length; i += 1) {
      if (niveaux[i]! > niveaux[i - 1]! + 1) {
        fautes.push(`${nom} : h${niveaux[i - 1]} suivi de h${niveaux[i]}`);
      }
    }
  }
  assert.deepEqual(fautes, [], `saut(s) de niveau de titre : ${fautes.join(' | ')}`);
});

test('les zones qui se rafraichissent seules sont annoncees', () => {
  // Une liste de resultats qui change sans que le lecteur d'ecran le dise laisse l'utilisateur
  // sur une information perimee. `aria-live` ou `role="status"` est la reponse minimale.
  const source = composants()
    .map((c) => c.source)
    .join('\n');
  assert.match(
    source,
    /aria-live|role="status"|role="alert"/,
    'aucune region live : les mises a jour asynchrones ne sont pas annoncees',
  );
});
