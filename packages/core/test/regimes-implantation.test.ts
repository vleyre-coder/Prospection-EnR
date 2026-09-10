/**
 * Tests de la correspondance nature du sol <-> regime d'implantation.
 *
 * POURQUOI CE FICHIER EXISTE. Cette table etait un `switch` dans `@enr/scoring`, lu par un seul
 * appelant. Elle est descendue dans `@enr/core` parce que l'outil de recherche par criteres a
 * besoin de la RECIPROQUE : « cherche-moi du foncier propice a de l'agrivoltaisme » doit se
 * traduire en une selection de natures de sol, cote navigateur, ou le moteur n'est pas installe.
 *
 * CE QUE CES TESTS PROTEGENT. Une reciproque incomplete est un defaut MUET : le filtre renverrait
 * moins de parcelles que ce qu'il annonce, sans erreur ni message, et l'operateur conclurait que
 * le foncier n'existe pas. Le meme risque vaut pour un regime sans libelle, qui s'afficherait
 * comme un identifiant technique dans un document remis a un tiers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBELLES_REGIME,
  ORDRE_REGIMES,
  ORDRE_TYPES_SOL,
  REGIME_PAR_TYPE_SOL,
  TYPES_SOL,
  typesSolDuRegime,
} from '../src/types.js';

test('CHAQUE NATURE DE SOL CONNUE A UN REGIME', () => {
  // Une nature de sol ajoutee sans regime rendrait `determinerRegimeImplantation` nul sur des
  // parcelles pourtant renseignees : la fiche perdrait son cadre juridique sans le dire.
  for (const t of Object.keys(TYPES_SOL) as Array<keyof typeof TYPES_SOL>) {
    assert.ok(REGIME_PAR_TYPE_SOL[t], `nature de sol sans regime : ${t}`);
  }
  assert.equal(Object.keys(REGIME_PAR_TYPE_SOL).length, Object.keys(TYPES_SOL).length);
  assert.equal(ORDRE_TYPES_SOL.length, Object.keys(TYPES_SOL).length);
});

test('CHAQUE REGIME A UN LIBELLE, ET FIGURE DANS L ORDRE D AFFICHAGE', () => {
  const regimes = new Set(Object.values(REGIME_PAR_TYPE_SOL));
  for (const r of regimes) {
    assert.ok(LIBELLES_REGIME[r], `regime sans libelle : ${r}`);
    assert.ok(ORDRE_REGIMES.includes(r), `regime absent de ORDRE_REGIMES : ${r}`);
  }
  // Et l'inverse : un libelle ou une entree d'ordre qui ne correspond a aucun regime atteignable
  // proposerait dans le selecteur de recherche un critere qui ne ramene jamais rien.
  for (const r of ORDRE_REGIMES) {
    assert.ok(regimes.has(r), `ORDRE_REGIMES cite un regime inatteignable : ${r}`);
  }
  for (const r of Object.keys(LIBELLES_REGIME)) {
    assert.ok(regimes.has(r), `LIBELLES_REGIME cite un regime inatteignable : ${r}`);
  }
  assert.equal(ORDRE_REGIMES.length, regimes.size);
});

test('LA RECIPROQUE EST COMPLETE : AUCUNE NATURE DE SOL NE SE PERD', () => {
  /*
   * C'est LE test qui compte pour l'outil de recherche. Un regime dont la reciproque oublierait
   * une nature de sol ferait disparaitre du resultat un foncier reellement propice — sans erreur,
   * sans message, sans moyen de s'en apercevoir.
   *
   * `pv_sol_terrain_degrade` est le cas non trivial : DEUX natures de sol y menent
   * (« artificialise » et « degrade »). Une reciproque ecrite a la main aurait pu n'en garder
   * qu'une.
   */
  const couvertes = ORDRE_REGIMES.flatMap((r) => typesSolDuRegime(r));
  assert.equal(new Set(couvertes).size, Object.keys(TYPES_SOL).length);
  assert.equal(couvertes.length, Object.keys(TYPES_SOL).length, 'une nature de sol comptee deux fois');
  assert.deepEqual(typesSolDuRegime('pv_sol_terrain_degrade').sort(), ['artificialise', 'degrade']);
  assert.deepEqual(typesSolDuRegime('agrivoltaisme'), ['agricole_exploite']);
});

test('CHAQUE NATURE DE SOL SE RETROUVE PAR SON PROPRE REGIME', () => {
  for (const t of ORDRE_TYPES_SOL) {
    const regime = REGIME_PAR_TYPE_SOL[t]!;
    assert.ok(
      typesSolDuRegime(regime).includes(t),
      `${t} a le regime ${regime} mais n'est pas rendu par sa reciproque`,
    );
  }
});

test('UN REGIME INCONNU NE RAMENE RIEN, PLUTOT QUE TOUT', () => {
  // Le sens d'erreur importe : rendre la liste entiere sur un identifiant inconnu ferait
  // silencieusement sauter le filtre, et la recherche annoncerait un critere qu'elle n'applique
  // pas.
  assert.deepEqual(typesSolDuRegime('regime_inexistant'), []);
});
