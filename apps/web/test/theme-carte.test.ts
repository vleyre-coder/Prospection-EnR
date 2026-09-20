/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA CARTE SUIT LE MEME THEME QUE LE RESTE DE L'ECRAN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE GARDE EXISTE. Le theme est un reglage a TROIS valeurs, et presque tout le rendu s'y
 * adapte par le CSS, qui sait lire la preference du systeme tout seul. La carte ne le peut pas :
 * MapLibre peint ses tuiles dans un canevas, et l'assombrissement du fond se regle en JavaScript.
 * La regle est donc ECRITE DEUX FOIS — une en CSS, une en TypeScript — et c'est exactement le
 * genre de duplication qui derive en silence.
 *
 * CE QUE LA DIVERGENCE PRODUIRAIT : un fond de carte assombri sous un habillage clair, ou un plan
 * beige eclatant sous un habillage sombre. Rien ne planterait, aucun type ne broncherait, et le
 * defaut ne se verrait que sur la moitie des postes — ceux dont le systeme est regle a l'inverse
 * du reglage de l'application.
 *
 * LA REGLE, recopiee de `global.css` :
 *
 *     @media (prefers-color-scheme: dark) { :root:not([data-theme='clair']) { … } }
 *     :root[data-theme='sombre'] { … }
 *
 * soit : sombre si le reglage vaut `sombre`, ou si le systeme est sombre et que le reglage ne
 * force pas `clair`. Les six combinaisons sont enumerees ci-dessous, sans en omettre une seule —
 * c'est une table de verite, elle n'a pas de cas « evident ».
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estSombre, type Theme } from '../src/utils/theme.js';

const ICI = dirname(fileURLToPath(import.meta.url));

test('LES SIX COMBINAISONS DE THEME ET DE PREFERENCE SYSTEME', () => {
  const cas: Array<{ theme: Theme; systeme: boolean; attendu: boolean; pourquoi: string }> = [
    { theme: 'sombre', systeme: false, attendu: true, pourquoi: 'le reglage force le sombre, le systeme ne peut pas le defaire' },
    { theme: 'sombre', systeme: true, attendu: true, pourquoi: 'les deux concordent' },
    { theme: 'clair', systeme: true, attendu: false, pourquoi: 'le reglage force le clair MALGRE un systeme sombre — le cas que `:not([data-theme=clair])` protege' },
    { theme: 'clair', systeme: false, attendu: false, pourquoi: 'les deux concordent' },
    { theme: 'systeme', systeme: true, attendu: true, pourquoi: 'sans reglage, la preference du systeme decide' },
    { theme: 'systeme', systeme: false, attendu: false, pourquoi: 'sans reglage, la preference du systeme decide' },
  ];
  for (const c of cas) {
    assert.equal(
      estSombre(c.theme, c.systeme),
      c.attendu,
      `theme=${c.theme}, systeme sombre=${c.systeme} : ${c.pourquoi}`,
    );
  }
});

test('LA REGLE DU CSS EST BIEN CELLE QUE LE CODE RECOPIE', () => {
  /*
   * Un garde sur la table de verite seule ne prouverait rien si le CSS changeait de convention —
   * il figerait une regle devenue fausse. On verifie donc que les deux selecteurs recopies
   * existent TOUJOURS dans la feuille de style, c'est-a-dire que la source de verite n'a pas
   * bouge sous le code qui la duplique.
   */
  const css = readFileSync(resolve(ICI, '..', 'src', 'styles', 'global.css'), 'utf8');
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\)/,
    'le CSS ne lit plus la preference du systeme : `utils/theme.ts` recopie une regle disparue',
  );
  assert.match(
    css,
    /:root:not\(\[data-theme='clair'\]\)/,
    "le CSS n'exclut plus le forcage en clair : `estSombre` rendrait l'inverse du reste de l'ecran",
  );
  assert.match(
    css,
    /:root\[data-theme='sombre'\]/,
    'le CSS ne reconnait plus le forcage en sombre',
  );
});
