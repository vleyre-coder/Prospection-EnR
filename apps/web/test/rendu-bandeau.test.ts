/**
 * Le bandeau d'avertissements : la section 12, et les deux alertes de fraicheur.
 *
 * POURQUOI CE FICHIER EXISTE. Ce bandeau porte trois choses qui ont chacune leur histoire dans ces
 * audits, et qui partagent une propriete desagreable : **leur disparition ne casse rien.** Aucun test
 * n'echouerait, aucune page ne planterait, et l'outil se mettrait simplement a mentir par omission.
 *
 *   1. Les avertissements de portee GLOBALE — la section 12 du cahier des charges. C'est la clause
 *      non negociable de l'outil, celle qui repond « non » a « peut-on traiter un feu vert comme une
 *      conclusion ». Elle est reaffirmee a la fin de chacun des dix rapports d'audit.
 *   2. Le bandeau « parcelles en retard sur la donnee », ne du defaut A2 de l'audit 9 : le score se
 *      calcule sur le snapshot, pas sur les couches, donc une ingestion n'atteint pas les parcelles
 *      deja qualifiees. Mesure a l'epoque : 438 parcelles portant un snapshot de 11 h 48 alors que
 *      les sites classes avaient ete ingeres a 19 h 38. Lire ce bandeau est la premiere des trois
 *      conditions d'usage professionnel enoncees a chaque audit depuis.
 *   3. Le bouton de reprise, masque aux comptes en LECTURE SEULE (audit 9) : la route repond 403, et
 *      un bouton qui echoue en silence est pire que pas de bouton.
 *
 * Le composant n'etait joignable que par `App`, dont le rendu monte la carte MapLibre — impossible
 * hors navigateur. Il est desormais exporte, pour cette raison, ecrite a son point de definition.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { BandeauAvertissements } from '../src/components/BandeauAvertissements.js';
import { referentiel, rendre, texte } from './aides/rendu.js';

type Role = 'admin' | 'prospection' | 'lecture' | null;

function bandeau(
  options: {
    sourcesPerimees?: string[];
    parcellesARafraichir?: number | null;
    role?: Role;
    avertissementsMasques?: string[];
  } = {},
): string {
  return texte(
    rendre(
      h(BandeauAvertissements, {
        referentiel: referentiel as never,
        sourcesPerimees: options.sourcesPerimees ?? [],
        parcellesARafraichir: options.parcellesARafraichir ?? null,
        role: options.role ?? 'prospection',
      }),
      [],
      { avertissementsMasques: options.avertissementsMasques ?? [] },
    ),
  );
}

const GLOBAUX = referentiel.avertissements.filter((a) => a.portee === 'global');

test('LA CLAUSE NON NEGOCIABLE : les avertissements de la section 12 sont affiches', () => {
  assert.ok(GLOBAUX.length > 0, 'le referentiel doit porter des avertissements de portee globale');
  const t = bandeau();
  for (const a of GLOBAUX) {
    assert.ok(t.includes(a.titre), `titre de l’avertissement §12 « ${a.id} » absent`);
    assert.ok(
      t.includes(a.texte.slice(0, 60)),
      `texte de l’avertissement §12 « ${a.id} » absent — c’est la clause que dix audits ont refuse de retirer`,
    );
  }
});

test('un avertissement masque pour la session disparait, les autres restent', () => {
  // Le masquage est volontairement limite a la session : l'avertissement reapparait au prochain
  // chargement. Le test verifie qu'il masque BIEN celui demande, et LUI SEUL.
  const cible = GLOBAUX[0]!;
  const t = bandeau({ avertissementsMasques: [cible.id] });
  assert.ok(!t.includes(cible.texte.slice(0, 60)), `« ${cible.id} » masque devrait disparaitre`);
  for (const autre of GLOBAUX.filter((a) => a.id !== cible.id)) {
    assert.ok(
      t.includes(autre.texte.slice(0, 60)),
      `masquer « ${cible.id} » a aussi fait disparaitre « ${autre.id} »`,
    );
  }
});

test('LE BANDEAU DE L’AUDIT 9 : le retard sur la donnee est annonce, avec son compte', () => {
  const t = bandeau({ parcellesARafraichir: 438 });
  assert.ok(t.includes('Parcelles en retard sur la donnée'), 'le titre du bandeau de retard manque');
  assert.ok(
    t.includes('438'),
    'le nombre de parcelles en retard doit etre affiche : « il y a du retard » sans chiffre ne se pilote pas',
  );
});

test('aucun retard, aucun bandeau de retard — un compteur a zero ne doit pas alarmer', () => {
  for (const valeur of [0, null]) {
    const t = bandeau({ parcellesARafraichir: valeur });
    assert.ok(
      !t.includes('Parcelles en retard sur la donnée'),
      `parcellesARafraichir=${valeur} ne doit declencher aucun bandeau de retard`,
    );
  }
});

test('LE POINT DE L’AUDIT 9 : un compte en lecture seule voit le retard mais pas le bouton', () => {
  /**
   * La distinction est le fond du sujet : le RETARD est une information, elle est due a tout le
   * monde ; la REPRISE est une action, et la route la refuse a un compte en lecture seule. Afficher
   * le bouton reviendrait a promettre un 403.
   */
  const lecture = bandeau({ parcellesARafraichir: 12, role: 'lecture' });
  assert.ok(lecture.includes('Parcelles en retard sur la donnée'), 'le retard est du a tout le monde');
  assert.ok(
    !lecture.includes('Rafraîchir un lot'),
    'un compte en lecture seule ne doit pas se voir proposer une action qui finira en 403',
  );

  for (const role of ['admin', 'prospection'] as const) {
    const t = bandeau({ parcellesARafraichir: 12, role });
    assert.ok(t.includes('Rafraîchir un lot'), `le role ${role} doit pouvoir reprendre un lot`);
  }
});

test('les sources perimees sont nommees, pas seulement comptees', () => {
  // Une alerte qui ne dit pas QUELLE source est perimee n'est pas actionnable.
  const t = bandeau({ sourcesPerimees: ['postes_sources', 'zaer_local'] });
  assert.ok(t.includes('Sources à rafraîchir'), 'le titre manque');
  assert.ok(t.includes('postes_sources') && t.includes('zaer_local'), 'les sources doivent etre nommees');
});

test('le bandeau n’ecrit aucun nombre a point decimal ni aucune date ISO', () => {
  // Meme garde typographique que la fiche : le defaut B1 de l'audit 10 s'est revele present partout
  // ou un nombre est mis en forme par l'interface plutot que par le moteur.
  const t = bandeau({ parcellesARafraichir: 438, sourcesPerimees: ['postes_sources'] });
  const decimaux = [...t.matchAll(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g)]
    .map((m) => m[0])
    .filter((s) => s.split('.').length === 2);
  assert.deepEqual(decimaux, [], `points decimaux dans le bandeau : ${decimaux.join(', ')}`);
  assert.deepEqual(t.match(/\d{4}-\d{2}-\d{2}/g) ?? [], [], 'dates ISO dans le bandeau');
});
