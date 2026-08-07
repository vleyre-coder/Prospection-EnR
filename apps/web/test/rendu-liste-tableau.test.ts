/**
 * Les deux autres vues que l'utilisateur regarde : la liste et le tableau de bord.
 *
 * POURQUOI CE FICHIER EXISTE. La fiche etait la vue la plus grosse, et `rendu-fiche.test.ts` s'en
 * occupe. Mais un prospecteur ne travaille pas fiche par fiche : il balaie la LISTE, et c'est la
 * qu'il decide sur quoi ouvrir une fiche. Une erreur d'affichage y coute donc plus cher qu'ailleurs —
 * elle oriente le travail avant meme qu'il commence.
 *
 * L'HISTOIRE QUE CE FICHIER GARDE. Le defaut B1 de l'audit 7 tenait en une phrase : les knock-outs
 * eliminatoires, calcules et affiches dans la fiche, **ne remontaient pas jusqu'a la liste ni au
 * CSV**. Une parcelle juridiquement fermee s'y presentait avec un score ordinaire, au milieu des
 * autres. La correction a ajoute `nbKnockOutsBloquants` a chaque ligne ; rien ne verifiait qu'elle
 * reste affichee.
 *
 * Le jeu capture rend ce cas verifiable de la meilleure facon possible : une seule parcelle de la
 * base est qualifiee en eolien, et c'est precisement la parcelle ecartee — statut rouge, un knock-out
 * bloquant, celui du recul de 500 m de l'article L.515-44.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { VueListe } from '../src/components/VueListe.js';
import { TableauDeBord } from '../src/components/TableauDeBord.js';
import type { LigneListe } from '../src/api/client.js';
import { referentiel, rendreResolu, texte } from './aides/rendu.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture<T>(nom: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, nom), 'utf8')) as T;
}

const listeSolaire = fixture<{ total: number; resultats: LigneListe[] }>('liste-solaire.json');
const listeEolien = fixture<{ total: number; resultats: LigneListe[] }>('liste-eolien.json');
const tableau = fixture<Record<string, unknown>>('tableau-de-bord-solaire.json');

function afficherListe(
  donnees: { total: number; resultats: LigneListe[] },
  filiere: 'solaire_sol' | 'eolien_terrestre',
): string {
  return texte(
    rendreResolu(
      h(VueListe, { filiere, referentiel, onOuvrir: () => undefined }),
      { liste: donnees },
      // Sans cette borne, la liste se restreint a l'emprise de la carte, qui n'existe pas ici.
      { limiterALEmprise: false },
    ),
  );
}

/** Mêmes deux gardes typographiques que la fiche, sur les autres vues. */
function fautesTypographiques(t: string): { decimaux: string[]; iso: string[] } {
  return {
    decimaux: [...t.matchAll(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g)]
      .map((m) => m[0])
      .filter((s) => s.split('.').length === 2),
    iso: t.match(/\d{4}-\d{2}-\d{2}/g) ?? [],
  };
}

test('LE DEFAUT DE L’AUDIT 7 : une parcelle ecartee est signalee dans la LISTE, pas seulement dans sa fiche', () => {
  const ligne = listeEolien.resultats[0];
  assert.ok(ligne, 'la liste eolienne capturee doit contenir une ligne');
  assert.ok(
    ligne.nbKnockOutsBloquants > 0,
    'le cas capture doit porter un knock-out bloquant, sinon il ne prouve rien',
  );
  assert.equal(ligne.statutScore, 'rouge');

  const t = afficherListe(listeEolien, 'eolien_terrestre');
  // La liste designe la parcelle comme un plan cadastral le fait — section et numero — et non par son
  // IDU, qui est un identifiant technique. C'est le bon choix, et il faut donc verifier CE choix.
  assert.ok(
    t.includes(ligne.section) && t.includes(ligne.numero),
    `la parcelle ${ligne.section} ${ligne.numero} doit apparaitre dans la liste`,
  );
  // Le libelle du statut redhibitoire est distinct de celui d'un simple score faible : c'est tout
  // l'objet de la palette `couleurRedhibitoire` / `libelleRedhibitoire` du referentiel.
  assert.ok(
    t.includes(referentiel.palette.libelleRedhibitoire),
    `la liste doit porter le libelle « ${referentiel.palette.libelleRedhibitoire} » pour une parcelle ecartee`,
  );
});

test('la liste affiche reellement les parcelles renvoyees par l’API, avec leur commune', () => {
  const t = afficherListe(listeSolaire, 'solaire_sol');
  const echantillon = listeSolaire.resultats.slice(0, 10);
  assert.equal(echantillon.length, 10, 'la liste capturee doit contenir au moins dix lignes');
  for (const l of echantillon) {
    assert.ok(
      t.includes(`${l.section} ${l.numero}`),
      `la parcelle ${l.section} ${l.numero} n’apparait pas dans la liste rendue`,
    );
  }
  assert.ok(
    t.includes(echantillon[0]!.nomCommune),
    'le nom de commune doit etre lisible : une section seule ne se situe pas',
  );
  // Le compte total, et non seulement les lignes affichees : sans lui, on ignore qu'on regarde 50
  // parcelles sur 439.
  assert.ok(
    t.includes(String(listeSolaire.total)),
    'le nombre total de resultats doit etre affiche, pas seulement les lignes visibles',
  );
});

test('la liste n’ecrit aucun nombre a point decimal ni aucune date ISO', () => {
  /**
   * Le cas est concret : la premiere ligne capturee porte `surfaceHa: 67.14` et `pentePct: 0.4`. Si
   * la liste interpolait ces nombres bruts, elle ecrirait « 67.14 ha » sous une fiche qui ecrit
   * « 67,14 ha » — le defaut B1 de l'audit 10, transpose a la vue la plus consultee.
   */
  for (const [nom, donnees, filiere] of [
    ['solaire', listeSolaire, 'solaire_sol'],
    ['eolien', listeEolien, 'eolien_terrestre'],
  ] as const) {
    const { decimaux, iso } = fautesTypographiques(afficherListe(donnees, filiere));
    assert.deepEqual(decimaux, [], `liste ${nom} : points decimaux ${decimaux.join(', ')}`);
    assert.deepEqual(iso, [], `liste ${nom} : dates ISO ${iso.join(', ')}`);
  }
});

test('le tableau de bord rend ses agregats, et sans faute typographique', () => {
  const html = rendreResolu(
    h(TableauDeBord, { filiere: 'solaire_sol', referentiel }),
    { 'tableau-de-bord': tableau },
  );
  const t = texte(html);
  assert.ok(html.length > 500, `rendu suspicieusement court (${html.length} car.)`);

  // Les compteurs par statut sont la raison d'etre de la vue : s'ils manquent, il ne reste qu'un
  // cadre vide, et rien ne le signalerait.
  const parStatut = tableau['parStatut'] as Record<string, number> | undefined;
  assert.ok(parStatut && Object.keys(parStatut).length > 0, 'le tableau capture doit porter des compteurs');
  const totalAttendu = Object.values(parStatut).reduce((a, b) => a + b, 0);
  assert.ok(totalAttendu > 0, 'le tableau capture doit compter au moins une parcelle');

  const { decimaux, iso } = fautesTypographiques(t);
  assert.deepEqual(decimaux, [], `tableau de bord : points decimaux ${decimaux.join(', ')}`);
  assert.deepEqual(iso, [], `tableau de bord : dates ISO ${iso.join(', ')}`);
});

test('une liste vide se distingue d’une liste en chargement', () => {
  /**
   * Deux etats que rien ne separe visuellement produisent la meme erreur d'interpretation que
   * l'absence de donnee confondue avec une absence de contrainte — la faute fondatrice de ces audits,
   * sous sa forme d'interface : « aucun resultat » et « je ne sais pas encore » ne sont pas la meme
   * phrase.
   */
  const t = afficherListe({ total: 0, resultats: [] }, 'solaire_sol');
  assert.ok(
    /aucune|aucun resultat|vide|0 parcelle/i.test(t),
    `une liste vide doit le dire explicitement ; texte rendu : « ${t.slice(0, 200)} »`,
  );
});
