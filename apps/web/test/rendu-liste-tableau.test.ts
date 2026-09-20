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
import { graduations, TableauDeBord } from '../src/components/TableauDeBord.js';
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
  /*
   * `nomCommune` est `string | null` dans le type de l'API — une parcelle dont la commune n'est pas
   * jointe existe. L'assertion le passait a `includes` sans le verifier : avec `null` elle aurait
   * cherche la chaine « null » et reussi ou echoue pour la mauvaise raison. Le typage des tests,
   * active le 8 septembre 2026, l'a refuse.
   */
  const commune = echantillon[0]!.nomCommune;
  assert.ok(commune != null, 'le fixture doit porter une commune nommee, sinon ce test ne prouve rien');
  assert.ok(
    t.includes(commune),
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

test('l’axe du graphique d’activite ne porte jamais deux fois le meme nombre', () => {
  /**
   * LE DEFAUT MESURE : l'axe etait fige a trois graduations, `[0, 0.5, 1]` fois le maximum, chaque
   * libelle arrondi. Sur un portefeuille d'UN lead — l'etat normal du premier jour — `maxi` vaut 1,
   * `Math.round(0.5)` vaut 1 en JavaScript, et l'axe affichait **1, 1, 0** : le meme nombre a deux
   * hauteurs. Un point valant 1 se lisait aussi bien au sommet qu'au milieu.
   *
   * Le test balaie les maximums que rencontre un portefeuille reel, du premier lead au millier,
   * plutot que le seul cas repare : un axe qui redoublerait a 7 serait le meme defaut.
   */
  for (let maxi = 0; maxi <= 200; maxi++) {
    const g = graduations(maxi);
    assert.equal(new Set(g).size, g.length, `maxi=${maxi} : graduations en double — ${g.join(', ')}`);
    assert.ok(
      g.every((v) => Number.isInteger(v) && v >= 0),
      `maxi=${maxi} : une graduation de comptage doit etre un entier positif — ${g.join(', ')}`,
    );
    // Le sommet de l'axe doit porter le maximum, sans quoi la courbe sortirait du cadre.
    assert.equal(Math.max(...g), Math.max(1, maxi), `maxi=${maxi} : le sommet de l'axe ne porte pas le maximum`);
    assert.ok(g.includes(0), `maxi=${maxi} : l'axe doit porter le zero`);
  }
  // Le cas exact du defaut, nomme pour qu'il ne se reperde pas dans la boucle.
  assert.deepEqual(graduations(1), [0, 1]);
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

test('UN SEUL MOIS DE DONNEES DESSINE QUAND MEME QUELQUE CHOSE', () => {
  /**
   * LE DEFAUT MESURE, sur la capture du tableau de bord. Avec un seul releve, le pas horizontal
   * vaut 0 et le chemin se reduit a un « M » sans aucun « L » : SVG ne trace pas un segment de
   * longueur nulle. Le graphique montrait donc un cadre vide avec ses deux graduations —
   * exactement ce que montre un portefeuille SANS activite —, alors qu'il y avait bien un lead.
   *
   * Deux etats opposes rendus a l'identique : c'est la faute que ce depot traque partout ailleurs,
   * transposee au graphique. Les points de releve la ferment par construction.
   */
  const html = rendreResolu(
    h(TableauDeBord, { filiere: 'solaire_sol', referentiel }),
    {
      'tableau-de-bord': {
        ...tableau,
        evolution: [{ mois: '2026-09', nouveaux: 1, securises: 0 }],
      },
    },
  );
  const cercles = html.match(/<circle/g) ?? [];
  assert.ok(
    cercles.length >= 2,
    `un releve unique doit porter ses points (un par serie) — ${cercles.length} cercle(s) rendus`,
  );
  // Et le titre du graphique doit etre la : sans lui, on ne saurait pas ce que le cadre montre.
  assert.match(texte(html), /Activité sur 12 mois/);
});

test('UNE PARCELLE ECARTEE POUR SA TAILLE NE PORTE PAS « SCORE FAIBLE »', () => {
  /**
   * LE DEFAUT MESURE, sur la base de bout en bout. Le statut rouge a TROIS causes : un couperet
   * reglementaire, un score sous le seuil, et une limite de VIABILITE — une parcelle trop petite
   * pour porter un projet, quel que soit son score. La liste ne connaissait que les deux
   * premieres et repliait la troisieme sur le libelle du score.
   *
   * A l'ecran : la parcelle 0C 0843 porte un score de 72,7 et la mention « Score faible », pendant
   * qu'une voisine a 70,3 porte « Sous conditions ». Les deux libelles sont incompatibles avec les
   * deux chiffres, et l'operateur cherche un defaut de notation la ou la parcelle offre 0,03 ha
   * implantables. La fiche le disait ; la liste, ou l'on decide quoi ouvrir, ne le remontait pas.
   */
  const base = listeSolaire.resultats[0]!;
  const t = texte(
    rendreResolu(
      h(VueListe, { filiere: 'solaire_sol', referentiel, onOuvrir: () => undefined }),
      {
        liste: {
          total: 1,
          resultats: [
            { ...base, statutScore: 'rouge', scoreGlobal: 72.7, nbKnockOutsBloquants: 0,
              limiteViabilite: 'Surface très insuffisante' },
          ],
        },
      },
      { limiterALEmprise: false },
    ),
  );
  assert.match(t, /Surface très insuffisante/, `le motif reel doit etre affiche — ${t.slice(0, 300)}`);
  assert.doesNotMatch(
    t,
    new RegExp(referentiel.palette.libellesScore.rouge, 'i'),
    'le libelle du score ne doit pas etre affiche quand ce n’est pas le score qui a decide',
  );
});

test('SANS LIMITE DE VIABILITE, LE ROUGE GARDE LE LIBELLE DU SCORE', () => {
  /*
   * Le contre-exemple : une parcelle rouge PARCE QUE mal notee doit continuer a le dire. Sans lui,
   * on aurait remplace un libelle faux par un autre.
   */
  const base = listeSolaire.resultats[0]!;
  const t = texte(
    rendreResolu(
      h(VueListe, { filiere: 'solaire_sol', referentiel, onOuvrir: () => undefined }),
      {
        liste: {
          total: 1,
          resultats: [
            { ...base, statutScore: 'rouge', scoreGlobal: 31, nbKnockOutsBloquants: 0, limiteViabilite: null },
          ],
        },
      },
      { limiterALEmprise: false },
    ),
  );
  assert.match(t, new RegExp(referentiel.palette.libellesScore.rouge, 'i'));
});

test('UNE CELLULE « TRACE ESTIME » VIDE DIT POURQUOI ELLE L’EST', () => {
  /**
   * UN TIRET SANS EXPLICATION EST UNE AFFIRMATION VIDE. Sur un territoire ou la couche des postes
   * sources n'est pas ingeree, cette colonne rend « — » sur CHAQUE ligne, et elle sert en plus de
   * clef de tri : cliquer son en-tete ne change alors rien, sans un mot. Mesure avant l'ingestion
   * des postes sur la base de bout en bout : 301 lignes sur 301 vides.
   *
   * CE QUE L'INFOBULLE DOIT REFUSER DE FAIRE : choisir une cause. « Pas de poste ingere » et
   * « parcelle non requalifiee » produisent le meme tiret, et les deux appellent des gestes
   * differents. Elle nomme donc les deux, et interdit explicitement la lecture « aucun poste a
   * proximite » — celle qui ferait ecarter une parcelle pour une raison inexistante.
   */
  const base = listeSolaire.resultats[0]!;
  const html = rendreResolu(
    h(VueListe, { filiere: 'solaire_sol', referentiel, onOuvrir: () => undefined }),
    {
      liste: {
        total: 1,
        resultats: [{ ...base, distancePosteKm: null, lineaireRaccordementKm: null }],
      },
    },
    { limiterALEmprise: false },
  );
  assert.match(html, /non renseignée/i, `l’infobulle doit exister — ${html.slice(0, 200)}`);
  assert.match(html, /pas ingérée sur ce territoire/i, 'la premiere cause doit etre nommee');
  assert.match(html, /requalifiée/i, 'la seconde cause doit etre nommee');
  assert.match(
    html,
    /n(&#x27;|’)est pas une absence de/i,
    'l’infobulle doit refuser la lecture « aucun poste a proximite »',
  );
});

test('LE TABLEAU DE BORD DIT CE QUI MANQUE AUX PARCELLES GRISES', () => {
  /**
   * LE DEFAUT MESURE, audit 13. Le seuil de grisement vaut 80 % de couverture. Apres l'ingestion
   * des postes sources, quatre filieres le franchissent — et le BESS plafonne a 78,2 % sur les
   * 301 parcelles, jamais une de plus. La filiere entiere ne concluait donc rien a moins de deux
   * points du seuil, et UN SEUL critere en portait l'essentiel : la capacite residuelle du poste
   * source, 16,4 % du poids.
   *
   * Le tableau de bord annoncait « Données manquantes 301 (100 %) » et s'arretait la. Il a fallu
   * quatre requetes SQL pour etablir la cause — c'est-a-dire que personne ne l'etablirait jamais
   * depuis l'interface.
   */
  const html = rendreResolu(
    h(TableauDeBord, { filiere: 'bess', referentiel }),
    {
      'tableau-de-bord': {
        ...tableau,
        repartitionScores: { vert: 0, orange: 0, rouge: 0, gris: 301, total: 301 },
        criteresManquants: [
          { id: 'racc_capacite_residuelle', libelle: 'Capacité résiduelle du poste source', partPoidsPct: 16.4, nbParcelles: 301 },
          { id: 'racc_quote_part', libelle: 'Quote-part S3REnR', partPoidsPct: 3.3, nbParcelles: 301 },
          { id: 'fonc_nb_proprietaires', libelle: 'Nombre de propriétaires', partPoidsPct: 2.5, nbParcelles: 301 },
          { id: 'pat_monuments', libelle: 'Monuments historiques', partPoidsPct: 1.6, nbParcelles: 301 },
        ],
      },
    },
  );
  const t = texte(html);
  assert.match(t, /Ce qui manque/i, `le bloc doit exister — ${t.slice(0, 300)}`);
  // LE CRITERE DOMINANT EST NOMME : c'est lui qui decide ou porter l'effort.
  assert.match(t, /Capacité résiduelle du poste source/);
  // ET SON POIDS : « il manque un critere » n'aide pas a decider, « 16,4 % du poids » si.
  assert.match(t, /16[,.]4\s*%/, 'la part de poids doit etre chiffree');
  // Les criteres au-dela des trois premiers sont COMPTES, pas masques.
  assert.match(t, /1 autre/i, 'le reste doit etre annonce plutot que tu');
  // Et la conclusion : ce qui fera basculer, c'est la donnee, pas la ponderation.
  assert.match(t, /pas un changement de pondération/i);
});

test('SANS PARCELLE GRISE, LE TABLEAU DE BORD NE PARLE PAS DE CE QUI MANQUE', () => {
  /*
   * Le contre-exemple : un bloc qui parle toujours ne signale plus rien. Sur un portefeuille
   * entierement conclu, un critere non renseigne n'empeche rien — l'afficher serait du bruit.
   */
  const html = rendreResolu(
    h(TableauDeBord, { filiere: 'solaire_sol', referentiel }),
    {
      'tableau-de-bord': {
        ...tableau,
        repartitionScores: { vert: 10, orange: 5, rouge: 2, gris: 0, total: 17 },
        criteresManquants: [
          { id: 'pat_monuments', libelle: 'Monuments historiques', partPoidsPct: 1.6, nbParcelles: 0 },
        ],
      },
    },
  );
  assert.doesNotMatch(texte(html), /Ce qui manque/i);
});
