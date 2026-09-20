/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE DOSSIER DE RELECTURE JURIDIQUE NE DOIT PAS AFFICHER DE COMPTES FAUX
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `docs/RELECTURE-JURIDIQUE.md` sert a ORGANISER le travail d'un juriste : il dit combien de
 * contraintes citent un article, lesquelles n'en citent aucun, et ou le classeur se contredit
 * lui-meme. Un tel document se perime a la premiere correction du classeur, et il se perime en
 * SILENCE — un tableau faux se lit exactement comme un tableau juste.
 *
 * Le cout d'un compte faux n'est pas le meme que pour le rapport de verification : ici, c'est du
 * temps de juriste passe a chercher une divergence qui a deja ete resolue, ou pire, une divergence
 * qu'on ne lui signale plus. Ce fichier recompte donc tout et exige que le document le dise.
 *
 * LA CLASSIFICATION VIT ICI, ET C'EST DELIBERE. Elle ne sert a rien d'autre qu'a produire ce
 * document : la mettre dans le code de production ajouterait une fonction que personne n'appelle.
 * Elle doit en revanche etre EXACTEMENT celle qui a produit les chiffres — d'ou le fait qu'elle
 * soit ecrite une seule fois, ici, et que le document soit compare a sa sortie.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRAINTES_REFERENTIEL, MILLESIME_REFERENTIEL } from '../src/contraintes-referentiel.js';
import type { ContrainteReferentiel } from '../src/contraintes-referentiel.js';

const DOSSIER = readFileSync(new URL('../../../docs/RELECTURE-JURIDIQUE.md', import.meta.url), 'utf8');

/** Un article numerote : « Art. L515-44 », « article R.421-9 », « L411-1 » precede de `art`. */
const ARTICLE = /\b(?:art\.?|article)s?\s*[LRD]?\.?\s*\d+/i;
/** Un texte date, identifiable et opposable, mais sans numero d'article. */
const TEXTE_DATE = /\b(?:arrêté|décret|loi|circulaire|instruction|directive|règlement)\b/i;
/** Une source qui n'est pas un texte : doctrine, guide, jurisprudence, base de donnees. */
const DOCTRINE =
  /\b(?:doctrine|guide|jurisprudence|recommandation|consultation|charte|atlas|schéma|base |cartographie|inventaire|règles de l|nomenclature)\b/i;

type Nature = 'article' | 'texte_date' | 'doctrine' | 'autre' | 'absente';

/**
 * Nature de la reference d'une contrainte.
 *
 * L'ORDRE DES TESTS PORTE LE SENS. « Arrêté 26/08/2011 art. 3 » cite un article : il compte comme
 * article, et non comme texte date. « Décret 2010-1255 (zonage sismique) » n'en cite pas : il
 * reste un texte date. Inverser les deux premiers tests ferait basculer une trentaine de lignes
 * d'une colonne a l'autre sans que rien ne le signale.
 */
function nature(contrainte: ContrainteReferentiel): Nature {
  const r = (contrainte.referenceReglementaire ?? '').trim();
  if (r === '' || r === '—' || r === '-') return 'absente';
  if (ARTICLE.test(r)) return 'article';
  if (TEXTE_DATE.test(r)) return 'texte_date';
  if (DOCTRINE.test(r)) return 'doctrine';
  return 'autre';
}

/** Les contraintes qui partagent un intitule, par intitule. */
function parIntitule(): Map<string, ContrainteReferentiel[]> {
  const m = new Map<string, ContrainteReferentiel[]>();
  for (const c of CONTRAINTES_REFERENTIEL) {
    const l = m.get(c.nom) ?? [];
    l.push(c);
    m.set(c.nom, l);
  }
  return m;
}

/** Les groupes d'intitules identiques dont un champ varie d'une filiere a l'autre. */
function groupesDivergents(champ: 'caractere' | 'seuilReglementaire'): ContrainteReferentiel[][] {
  return [...parIntitule().values()].filter(
    (l) => l.length > 1 && new Set(l.map((c) => c[champ])).size > 1,
  );
}

/** Le document annonce-t-il ce nombre, en gras, dans une phrase contenant `contexte` ? */
function annonce(nombre: number, contexte: string): boolean {
  const lignes = DOSSIER.split('\n').filter((l) => l.includes(contexte));
  return lignes.some((l) => new RegExp(`\\*\\*${nombre}\\b`).test(l) || l.includes(` ${nombre} `));
}

test('LE CLASSEMENT DES REFERENCES EST CELUI QUE LE DOSSIER ANNONCE', () => {
  const comptes: Record<Nature, number> = {
    article: 0,
    texte_date: 0,
    doctrine: 0,
    autre: 0,
    absente: 0,
  };
  for (const c of CONTRAINTES_REFERENTIEL) comptes[nature(c)] += 1;

  assert.equal(CONTRAINTES_REFERENTIEL.length, 292);
  assert.deepEqual(comptes, {
    article: 128,
    texte_date: 32,
    doctrine: 40,
    autre: 70,
    absente: 22,
  });
  // Le total doit se retrouver : un classement qui perd une contrainte en chemin est inutilisable.
  assert.equal(
    Object.values(comptes).reduce((a, b) => a + b, 0),
    CONTRAINTES_REFERENTIEL.length,
  );

  for (const [n, contexte] of [
    [128, 'Article numéroté'],
    [32, 'Texte daté'],
    [40, 'Doctrine, guide'],
    [70, 'Autre'],
    [22, 'Aucune référence'],
  ] as const) {
    assert.ok(annonce(n, contexte), `le dossier doit annoncer ${n} pour « ${contexte} »`);
  }
});

test('LES REDHIBITOIRES SANS ARTICLE SONT COMPTEES, ET LE DETAIL AUSSI', () => {
  /*
   * LE CHIFFRE QUI ORIENTE TOUT LE DOSSIER. Ce sont les contraintes qui ECARTENT une parcelle sans
   * pouvoir designer l'article qui le justifie. S'il baisse, c'est que la relecture avance ; s'il
   * monte, c'est qu'une contrainte redhibitoire vient d'entrer sans fondement.
   */
  const red = CONTRAINTES_REFERENTIEL.filter((c) => c.caractere === 'redhibitoire');
  assert.equal(red.length, 133);

  const parNature: Record<string, number> = {};
  for (const c of red) parNature[nature(c)] = (parNature[nature(c)] ?? 0) + 1;
  assert.deepEqual(parNature, { article: 83, texte_date: 13, doctrine: 6, autre: 28, absente: 3 });
  assert.equal(red.length - (parNature['article'] ?? 0), 50, '50 redhibitoires sans article');
});

test('LES TROIS REDHIBITOIRES SANS AUCUN FONDEMENT SONT NOMMEES UNE PAR UNE', () => {
  /*
   * Ce sont des criteres ECONOMIQUES ranges en redhibitoire : un terrain peu vente n'est pas un
   * terrain interdit. Le moteur refuse desormais d'en tirer une infraction, mais la ligne reste
   * dans le classeur et doit etre tranchee. Les nommer ici garantit qu'une quatrieme ne s'ajoute
   * pas en silence — et qu'on s'apercoive si l'une des trois disparait.
   */
  const sansFondement = CONTRAINTES_REFERENTIEL.filter(
    (c) => c.caractere === 'redhibitoire' && nature(c) === 'absente',
  ).map((c) => c.id);
  assert.deepEqual(sansFondement.sort(), [
    'bess__acces_poids_lourds_logistique',
    'bess__surface_emprise_necessaire',
    'eolien_terrestre__gisement_de_vent',
  ]);
  for (const nom of ['Gisement de vent', 'Surface / emprise nécessaire', 'Accès poids lourds']) {
    assert.ok(DOSSIER.includes(nom), `le dossier doit nommer « ${nom} »`);
  }
});

test('LES CONTRADICTIONS INTERNES DU CLASSEUR SONT COMPTEES', () => {
  /*
   * LA PARTIE LA PLUS UTILE DU DOSSIER. Un meme intitule traite en « redhibitoire » ici et en
   * « cadre » la : au moins une des deux lectures est fausse, et aucune verification externe n'est
   * necessaire pour le savoir. C'est par la qu'une relecture doit commencer.
   */
  const caractere = groupesDivergents('caractere');
  const seuil = groupesDivergents('seuilReglementaire');
  assert.equal(caractere.length, 8, 'groupes a severite divergente');
  assert.equal(caractere.reduce((n, l) => n + l.length, 0), 25, 'contraintes concernees');
  assert.equal(seuil.length, 18, 'groupes a seuil divergent');
  assert.equal(seuil.reduce((n, l) => n + l.length, 0), 57, 'contraintes concernees');

  // Le cas le plus suspect est nomme dans le dossier, avec sa consequence.
  assert.ok(
    caractere.some(
      (l) =>
        // Apostrophe DROITE : c'est celle du classeur, et une apostrophe typographique ne
        // correspondrait a rien. Le libelle est recopie, pas normalise.
        l[0]!.nom.includes("Servitudes d'utilité publique") &&
        l.some((c) => c.caractere === 'cadre') &&
        l.some((c) => c.caractere === 'redhibitoire'),
    ),
    'les SUP doivent bien porter deux caracteres opposes selon la filiere',
  );
  assert.match(DOSSIER, /`cadre` en agrivoltaïsme/);
});

test('LE DOSSIER DECRIT LE MILLESIME QU’IL A EXAMINE', () => {
  // Un dossier de relecture date d'un autre millesime decrit un autre classeur.
  assert.ok(
    DOSSIER.includes(MILLESIME_REFERENTIEL),
    `le dossier doit annoncer le millesime ${MILLESIME_REFERENTIEL}`,
  );
});

test('LE DOSSIER NE SE PRESENTE PAS COMME UNE VALIDATION JURIDIQUE', () => {
  /*
   * L'INVARIANT LE PLUS IMPORTANT DE CE FICHIER, et le seul qui ne porte pas sur un nombre.
   *
   * Ce document ressemble a un audit juridique : il classe des references, cite des articles et
   * conclut. Un lecteur presse pourrait le prendre pour la validation elle-meme, et c'est
   * exactement l'erreur qui rendrait tout ce travail nuisible — l'application ferait autorite sur
   * un terrain ou elle n'a rien verifie. Le refus doit donc etre ECRIT, et le rester.
   */
  assert.match(DOSSIER, /Ce n'est pas une validation juridique|Ce n’est pas une validation juridique/);
  assert.match(DOSSIER, /Légifrance est inaccessible/);
  assert.match(DOSSIER, /cohérence interne/);
});
