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
 * Fin de la balise ouvrante commencee a `depart`, en tenant compte des accolades et des chaines.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE FONCTION EXISTE, ET CE QUE SON ABSENCE COUTAIT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ce fichier cherchait la balise ouvrante avec `<button\b([^>]*)>`. Or `[^>]*` s'arrete au PREMIER
 * `>` rencontre — et dans `onClick={() => …}`, ce `>` est celui de la FLECHE. Mesure sur les
 * composants du projet : 39 boutons sur 50 etaient decoupes a cet endroit.
 *
 * Consequence : pour ces 39 boutons, `attributs` s'arretait au milieu du gestionnaire et le
 * « contenu » examine commencait par le CORPS DE LA FONCTION. Le garde ne lisait donc pas le
 * libelle du bouton, mais du code — et il passait parce que ce code contient des identifiants de
 * trois lettres. Un `aria-label` place apres un gestionnaire n'etait pas vu non plus. Autrement
 * dit, la mesure portait sur autre chose que ce qu'elle annonçait, et dans le sens le plus
 * trompeur : elle validait.
 *
 * Revele par un bouton dont le libelle vient d'une table : il a ete signale muet, et l'examen de
 * ce qui lui etait reproche — « { setType(t); » — a montre que le decoupage etait faux.
 */
function finBalise(source: string, depart: number): number {
  let profondeur = 0;
  let guillemet: string | null = null;
  for (let i = depart; i < source.length; i += 1) {
    const c = source[i];
    if (guillemet) {
      if (c === guillemet && source[i - 1] !== '\\') guillemet = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') guillemet = c;
    else if (c === '{') profondeur += 1;
    else if (c === '}') profondeur -= 1;
    else if (c === '>' && profondeur === 0) return i;
  }
  return -1;
}

/** Les balises JSX d'un fragment, retirees sans se faire piéger par un `=>` dans un attribut. */
function retirerBalises(fragment: string): string {
  let sortie = '';
  let i = 0;
  while (i < fragment.length) {
    if (fragment[i] === '<') {
      const fin = finBalise(fragment, i);
      if (fin === -1) break;
      sortie += ' ';
      i = fin + 1;
    } else {
      sortie += fragment[i];
      i += 1;
    }
  }
  return sortie;
}

/**
 * Un fragment JSX donne-t-il un nom au controle qui le contient ?
 *
 * TROIS FORMES NOMMENT, et il a fallu les distinguer pour ne pas accuser a tort :
 *
 *   1. du TEXTE NU entre les balises — « Fermer » ;
 *   2. une CHAINE dans une expression — `{enCours ? 'Connexion…' : 'Se connecter'}` ;
 *   3. une EXPRESSION QUI REND UNE VALEUR — `{libelle}`, `{fam.libelle}`. Sept boutons du projet
 *      sont dans ce cas : leur libelle vient d'une table ou d'une prop, et aucun n'est muet pour
 *      autant. L'ancienne version supprimait les accolades avec leur contenu ; une fois le
 *      decoupage corrige, elle aurait signale ces sept-la — sept accusations fausses, sur un garde
 *      dont l'en-tete rappelle qu'« un garde qui accuse a tort finit desactive ».
 *
 * CE QUI RESTE MUET, et c'est la cible reelle : un contenu qui ne porte QUE des elements — une
 * icone seule — ou rien du tout. Un lecteur d'ecran n'a alors rien a annoncer.
 */
function porteUnNom(fragment: string): boolean {
  const horsBalises = retirerBalises(fragment);
  // Texte nu, accolades otees : « Fermer », « Réessayer ».
  if (/[A-Za-zÀ-ÿ]{3,}/.test(horsBalises.replace(/\{[\s\S]*?\}/g, ' '))) return true;
  for (const m of horsBalises.matchAll(/\{([\s\S]*?)\}/g)) {
    const expression = (m[1] ?? '').trim();
    // Un commentaire JSX ne rend rien : `{/* … */}` ne nomme pas un bouton.
    if (expression.startsWith('/*')) continue;
    if (/[A-Za-zÀ-ÿ]{3,}/.test(expression)) return true;
  }
  return false;
}

test('chaque bouton porte un nom accessible', () => {
  // Un bouton dont le contenu est une icone seule est muet pour un lecteur d'ecran : il lui faut
  // un `aria-label`. Un bouton dont le contenu rend du texte se nomme tout seul.
  const muets: string[] = [];
  for (const { nom, source } of composants()) {
    for (const debut of source.matchAll(/<button\b/g)) {
      const fin = finBalise(source, debut.index);
      if (fin === -1) continue;
      const attributs = source.slice(debut.index, fin);
      // Un `<button … />` auto-ferme n'a pas de contenu : seul un `aria-label` peut le nommer.
      const contenu =
        source[fin - 1] === '/' ? '' : source.slice(fin + 1, source.indexOf('</button>', fin));
      const aUnLibelle =
        /aria-label/.test(attributs) ||
        /aria-labelledby/.test(attributs) ||
        porteUnNom(contenu);
      if (!aUnLibelle) muets.push(`${nom} : ${contenu.trim().slice(0, 40)}`);
    }
  }
  assert.deepEqual(muets, [], `bouton(s) sans nom accessible : ${muets.join(' | ')}`);
});

/**
 * Le garde attrape-t-il encore un bouton REELLEMENT muet ?
 *
 * SANS CE TEST, LA CORRECTION CI-DESSUS SERAIT INVERIFIABLE. Elle assouplit le critere — elle
 * accepte desormais `{libelle}` — et un assouplissement mal borne rend un garde qui ne refuse plus
 * rien. On lui soumet donc les trois formes muettes connues, et les trois formes nommees.
 */
test('le garde de nom accessible refuse encore ce qui est vraiment muet', () => {
  const muet = [
    '<Icone nom="fermer" />',
    '{/* une icone viendra ici */}',
    '',
  ];
  for (const contenu of muet) {
    assert.equal(porteUnNom(contenu), false, `« ${contenu} » ne nomme aucun bouton`);
  }

  const nomme = ['Fermer', "{enCours ? 'Connexion…' : 'Se connecter'}", '{fam.libelle}'];
  for (const contenu of nomme) {
    assert.equal(porteUnNom(contenu), true, `« ${contenu} » nomme bien le bouton`);
  }

  // Et le decoupage de la balise ne se laisse plus prendre par la fleche d'un gestionnaire.
  const source = '<button onClick={() => f(a > b)} aria-label="Trier">X</button>';
  assert.equal(source.slice(0, finBalise(source, 0) + 1).includes('aria-label'), true);
});

test('chaque champ de saisie est associe a un libelle', () => {
  // Trois formes valides, et la troisieme est celle qu'emploie ce projet :
  //   1. `aria-label` sur le champ ;
  //   2. `id` sur le champ + `htmlFor` sur un `<label>` ;
  //   3. le champ ENVELOPPE dans un `<label>`, qui l'associe implicitement.
  const orphelins: string[] = [];
  for (const { nom, source } of composants()) {
    for (const m of source.matchAll(/<(input|select|textarea)\b[^>]*/g)) {
      // `m.group` n'existe pas sur un RegExpExecArray (c'est `groups`) : les deux branches du
      // ternaire rendaient donc la meme chose. Ligne sans effet, retiree — TypeScript l'aurait
      // refusee si les tests etaient types, ce qu'ils ne sont pas.
      const balise = m[0];
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
