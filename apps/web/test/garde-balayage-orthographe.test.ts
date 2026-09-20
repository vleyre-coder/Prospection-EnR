/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * L'OUTIL DE RECHERCHE ORTHOGRAPHIQUE LIT BIEN SON PERIMETRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE, et ce qu'il a coute. `scripts/orthographe-dictionnaire.mjs` est le
 * seul outil du depot qui cherche des fautes NOUVELLES — les deux gardes voisins n'empechent que le
 * retour des anciennes. Il ne recopie pas son perimetre : il le LIT dans `MODULES_TEXTE`, pour que
 * les trois portent exactement sur les memes fichiers.
 *
 * Il le lisait mal. La liste porte des commentaires en francais — « Cote-d'Or », « l'y inclure »,
 * « sans une phrase de prose » — et une apostrophe francaise est une apostrophe simple : le releve
 * des litteraux y voyait des chemins de module. Le script tentait alors d'ouvrir un fragment de
 * phrase et mourait sur un ENOENT, APRES une sortie qui ressemblait a un succes.
 *
 * CE QUE CETTE PANNE COUTAIT : rien de visible, et c'est tout le probleme. Un outil de recherche en
 * panne ne rend pas d'erreur utile — il rend zero faute, ce qui se lit comme « rien a corriger ».
 * Les 13 fautes corrigees par l'audit 13 etaient toutes dans son perimetre, et toutes anciennes.
 *
 * CE GARDE NE DEMANDE PAS HUNSPELL, et c'est la raison pour laquelle le balayage a ete decoupe :
 * `modulesTexte()` est exportee, le reste du script vit dans `principal()`, appele seulement en
 * lancement direct. Un code de balayage qui s'executait a l'import ne pouvait etre teste que par un
 * test exigeant le dictionnaire, c'est-a-dire par aucun. La lecture du perimetre, elle, se verifie
 * partout, y compris dans une CI sans paquet systeme.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — script utilitaire en JavaScript, sans declaration de types.
import { modulesTexte } from '../../../scripts/orthographe-dictionnaire.mjs';
import { MODULES_TEXTE } from './orthographe-affichee.test.js';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('LE BALAYAGE LIT EXACTEMENT LE PERIMETRE DU GARDE, sans un fragment de commentaire', () => {
  const lus = modulesTexte() as string[];

  /*
   * L'EGALITE EXACTE, et non une inclusion. Si le script lisait MOINS que le garde, il chercherait
   * des fautes dans un sous-ensemble sans que rien ne le dise — la panne d'origine, en plus discret.
   * S'il lisait PLUS, ce serait qu'il a repris du texte qui n'est pas un module.
   */
  assert.deepEqual(
    lus,
    [...MODULES_TEXTE],
    'le perimetre lu par le balayage differe de MODULES_TEXTE : la lecture a derive',
  );
});

test('aucune entree lue n’est un fragment de phrase : toutes sont des fichiers qui existent', () => {
  const lus = modulesTexte() as string[];
  assert.ok(lus.length > 20, `perimetre suspicieusement court : ${lus.length} module(s)`);

  for (const m of lus) {
    // La forme d'abord : c'est elle qui separe un chemin d'un morceau de commentaire francais.
    assert.match(
      m,
      /^(apps|packages)\/[\w./-]+\.tsx?$/,
      `« ${m.slice(0, 70)} » n’a pas la forme d’un chemin de module`,
    );
    // Puis l'existence : un chemin bien forme mais disparu ferait taire le balayage sur ce fichier.
    assert.ok(existsSync(resolve(RACINE, m)), `le module lu « ${m} » n’existe pas sur le disque`);
    // Et la signature exacte de la panne : une apostrophe ou une espace dans une entree.
    assert.ok(
      !m.includes(' ') && !m.includes("'"),
      `« ${m.slice(0, 70) }» porte une espace ou une apostrophe : c’est un fragment de commentaire`,
    );
  }
});
