#!/usr/bin/env node
/**
 * Exigence de robustesse du mot de passe du portail Netlify.
 *
 * POURQUOI CE FICHIER EXISTE. Le portail (netlify/edge-functions/portail.ts) protege
 * l'interface par un mot de passe PARTAGE, sans compte nominatif et sans autre frein a la
 * force brute qu'un plafond de 300 requetes par minute et par adresse IP. Un plafond par IP
 * se contourne avec plusieurs IP ; la seule chose qui rende l'attaque sans espoir, c'est la
 * longueur du secret. C'est donc verifie a la construction du site, ou un refus coute une
 * minute, plutot que laisse a la bonne volonte de celui qui remplit le formulaire Netlify.
 *
 * Les seuils ne sont pas decoratifs :
 *   - 16 caracteres minimum : en dessous, une liste de mots de passe courants suffit ;
 *   - 10 caracteres DISTINCTS minimum : « aaaaaaaaaaaaaaaa » fait bien 16 caracteres et ne
 *     vaut rien. C'est le nombre de symboles differents qui fait l'entropie, pas la longueur ;
 *   - refus des marqueurs connus (« motdepasse », « azerty », « 123456»…) : ce sont les
 *     premieres entrees de toutes les listes d'attaque.
 *
 * Ce module est appele par scripts/netlify-build.sh et couvert par
 * apps/web/test/portail-netlify.test.ts.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Longueur minimale acceptee. */
export const LONGUEUR_MINIMALE = 16;

/** Nombre de caracteres distincts minimal accepte. */
export const DISTINCTS_MINIMAUX = 10;

/**
 * Marqueurs refuses en sous-chaine. Tous font au moins six caracteres : la probabilite
 * qu'un mot de passe tire au hasard en contienne un par accident est negligeable, alors
 * qu'un mot de passe choisi par un humain en contient un tres souvent.
 */
export const MARQUEURS_REFUSES = [
  'motdepasse',
  'password',
  'passwd',
  'azerty',
  'qwerty',
  '123456',
  'changeme',
  'changez',
  'prospection',
  'netlify',
  'secret',
  'dimeo',
];

/**
 * Evalue un mot de passe candidat.
 *
 * @param {string | undefined | null} candidat
 * @returns {{ ok: boolean, probleme: string | null }}
 */
export function evaluer(candidat) {
  const valeur = typeof candidat === 'string' ? candidat : '';
  if (valeur === '') {
    return { ok: false, probleme: 'MOT_DE_PASSE_SITE est vide.' };
  }
  // Un espace en tete ou en fin est presque toujours un copier-coller malheureux, et il
  // serait transmis tel quel par le navigateur : mieux vaut le refuser que le voir echouer
  // a la connexion sans explication.
  if (valeur !== valeur.trim()) {
    return {
      ok: false,
      probleme: 'MOT_DE_PASSE_SITE commence ou finit par une espace (copier-coller ?).',
    };
  }
  if (valeur.length < LONGUEUR_MINIMALE) {
    return {
      ok: false,
      probleme: `MOT_DE_PASSE_SITE fait ${valeur.length} caracteres ; il en faut au moins ${LONGUEUR_MINIMALE}.`,
    };
  }
  const distincts = new Set(valeur).size;
  if (distincts < DISTINCTS_MINIMAUX) {
    return {
      ok: false,
      probleme: `MOT_DE_PASSE_SITE n'emploie que ${distincts} caracteres differents ; il en faut au moins ${DISTINCTS_MINIMAUX}.`,
    };
  }
  const minuscule = valeur.toLowerCase();
  const marqueur = MARQUEURS_REFUSES.find((m) => minuscule.includes(m));
  if (marqueur != null) {
    return {
      ok: false,
      probleme: `MOT_DE_PASSE_SITE contient « ${marqueur} », qui figure dans toutes les listes d'attaque.`,
    };
  }
  return { ok: true, probleme: null };
}

/** Propose un mot de passe acceptable, a copier dans les variables Netlify. */
export function proposer() {
  // 24 octets en base64url : 32 caracteres, ~144 bits. Hors de portee de la force brute.
  const octets = new Uint8Array(24);
  crypto.getRandomValues(octets);
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mode ligne de commande : lit MOT_DE_PASSE_SITE dans l'environnement (jamais en argument,
// qui serait visible dans la liste des processus) et sort en erreur si le compte n'est pas bon.
// Le test importe ce module ; la comparaison ci-dessous distingue les deux usages.
const appeleEnDirect =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (appeleEnDirect && process.argv.includes('--proposer')) {
  // Sur la sortie standard, et seul : la valeur est destinee a etre copiee.
  console.log(proposer());
} else if (appeleEnDirect) {
  const verdict = evaluer(process.env['MOT_DE_PASSE_SITE']);
  if (!verdict.ok) {
    console.error(verdict.probleme);
    console.error(`Exemple de valeur acceptable : ${proposer()}`);
    process.exit(1);
  }
}
