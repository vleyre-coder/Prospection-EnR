/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * L'OUTIL DE REVUE MONTRE LES QUATRE VUES, PAS TROIS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, audit 13. `captures.spec.ts` produit les images que l'on REGARDE pour juger
 * l'ergonomie et l'esthetique. Des quatre vues de la barre superieure — carte, liste, recherche,
 * tableau de bord —, la troisieme n'etait capturee nulle part.
 *
 * POURQUOI CELA COMPTE. C'est la vue ou l'operateur POSE ses criteres, donc celle qui oriente tout
 * le reste du travail. Et c'est la vue ou vivent les pastilles de typologie, dont l'ambiguite
 * « Agrivoltaisme » a ete corrigee par cet audit : sans capture, la correction ne se relit pas.
 * Un outil de revue qui ignore une vue sur quatre laisse les defauts de cette vue hors de portee
 * du seul controle qui les verrait — exactement ce qui est arrive.
 *
 * CE QUE CE GARDE NE PEUT PAS FAIRE, et il faut le dire : il verifie qu'une capture EXISTE pour
 * chaque vue, pas qu'elle montre quelque chose d'utile. Juger une image reste un travail humain ;
 * ce garde ne fait que l'empecher de manquer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * Les vues de la barre superieure, LUES dans le type qui fait foi.
 *
 * Recopier la liste ici en ferait une seconde verite : une cinquieme vue ajoutee a `Vue` sans
 * capture passerait alors inapercue, ce qui est precisement le defaut corrige.
 */
function vuesDeclarees(): string[] {
  const source = readFileSync(resolve(ICI, '..', 'src', 'store', 'etat.ts'), 'utf8');
  const ligne = /export type Vue =([^;]+);/.exec(source);
  assert.ok(ligne, 'le type `Vue` a change de forme dans store/etat.ts');
  return [...ligne[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
}

test('CHAQUE VUE DE LA BARRE A SA CAPTURE DE REVUE', () => {
  const spec = readFileSync(resolve(ICI, '..', 'e2e', 'captures.spec.ts'), 'utf8');
  const vues = vuesDeclarees();
  assert.ok(vues.length >= 4, `${vues.length} vue(s) lues : le type \`Vue\` a change de forme`);

  /*
   * Le nom de fichier de chaque capture porte le nom de sa vue — « 04-liste.png »,
   * « 11-recherche.png », « 05-tableau-de-bord.png ». C'est ce lien, et non un commentaire, qui
   * rend la couverture verifiable.
   */
  const captures = [...spec.matchAll(/\$\{SORTIE\}\/([\w-]+)\.png/g)].map((m) => m[1]!);
  assert.ok(captures.length > 0, 'aucune capture trouvee dans captures.spec.ts');

  const manquantes = vues.filter((v) => !captures.some((c) => c.includes(v)));
  assert.deepEqual(
    manquantes,
    [],
    `Vue(s) sans capture de revue : ${manquantes.join(', ')}.\n` +
      `Captures declarees : ${captures.join(', ')}.\n` +
      'Ajoutez une capture nommee d’apres la vue dans apps/web/e2e/captures.spec.ts.',
  );
});
