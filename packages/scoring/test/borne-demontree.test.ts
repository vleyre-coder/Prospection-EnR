/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * « RIEN DANS LE RAYON INTERROGÉ » EST UNE MESURE, PAS UNE IGNORANCE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ÉTÉ MESURÉ, le 28/09/2026, sur les 301 parcelles de la base : `distanceCoursEauM` était
 * renseignée sur **deux** d'entre elles. La BD TOPO n'était pourtant jamais en échec — le
 * connecteur interrogeait bien la couche des cours d'eau dans un rayon de 1 000 m, et n'en trouvait
 * aucun. En Beauce, plateau de craie, c'est le cas général.
 *
 * Ce fait de terrain était rendu comme une ignorance : `null`, critère gris, **5,5 % du poids de la
 * méthanisation retirés du calcul sur 99 % du parc** — pour une parcelle dont on savait qu'aucun
 * cours d'eau ne coule à moins d'un kilomètre, c'est-à-dire la situation la plus favorable que ce
 * critère puisse noter, puisqu'il sature à 300 m.
 *
 * ═══ CE QUE CE FICHIER GARDE, ET POURQUOI CHAQUE MOITIÉ COMPTE
 *
 *   1. LA BORNE EST NOTÉE. Sans quoi la correction n'existe pas.
 *   2. LA BORNE EST ÉCRITE COMME UNE BORNE. « au-delà de 1 000 m », jamais « 1 000 m ». Un rayon de
 *      recherche présenté comme un relevé, dans un document remis à un propriétaire, serait le
 *      défaut que cette correction prétend réparer, retourné.
 *   3. `valeurBrute` RESTE NULLE. C'est elle que lisent les exports de données et les seuils : y
 *      placer la borne ferait passer un minorant pour une mesure partout ailleurs.
 *   4. LA NOTE EST MINORÉE, JAMAIS MAJORÉE. Les deux courbes concernées sont croissantes et la
 *      distance réelle dépasse la borne : noter la borne ne peut pas surestimer la parcelle. Le
 *      test l'exige explicitement, parce qu'une courbe décroissante ajoutée demain inverserait
 *      silencieusement le sens de l'erreur.
 *   5. DEUX CHAMPS NULS RESTENT GRIS. Une requête en échec ne doit pas devenir une borne : c'est
 *      la différence entre « j'ai regardé et n'ai rien vu » et « je n'ai pas pu regarder ».
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '28390000ZL0030',
      codeInsee: '28390',
      nomCommune: 'Tillay-le-Péneux',
      prefixe: '000',
      section: 'ZL',
      numero: '0030',
      contenanceM2: 73100,
      surfaceCalculeeM2: 73100,
      centroide: [1.77236, 48.14363],
      codeDepartement: '28',
    },
    '2026-09-28T09:00:00.000Z',
  );
}

/** Le critère demandé, dans le résultat de méthanisation. */
function critere(s: ParcelleSnapshot, id: string) {
  const r = calculerScore(s, 'methanisation');
  const c = r.criteres.find((x) => x.id === id);
  assert.ok(c, `critère ${id} absent du résultat`);
  return c;
}

test('SANS COURS D’EAU DANS LE RAYON, LE CRITERE EST NOTE — ET IL NE L’ETAIT PAS', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = 1000;

  const c = critere(s, 'dist_eau');
  assert.notEqual(c.note, null, 'une borne démontrée doit se noter : c’est tout l’objet du champ');
  assert.equal(c.feu !== 'gris', true);
  /*
   * La courbe sature à 300 m et la borne vaut 1 000 m : la note est ici EXACTE, pas seulement
   * prudente. C'est le cas général en Beauce, et c'est ce qui rend la correction utile.
   */
  assert.equal(c.note, 100);
});

test('LA BORNE S’ECRIT COMME UNE BORNE, ET NE PASSE PAS POUR UNE MESURE', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = 1000;

  const c = critere(s, 'dist_eau');
  assert.match(
    c.valeurAffichee ?? '',
    /au-delà de/i,
    'le document doit dire « au-delà de », sans quoi un rayon de recherche passe pour un relevé',
  );
  /**
   * `valeurBrute` EST LUE AILLEURS — exports de données, seuils, comparaisons. Y placer la borne
   * propagerait le minorant hors du seul endroit qui sait ce qu'il vaut, et il y perdrait sa
   * qualification en chemin.
   */
  assert.equal(c.valeurBrute, null, 'la borne ne doit pas se propager comme une valeur mesurée');
});

test('LA NOTE ISSUE D’UNE BORNE NE DEPASSE JAMAIS CELLE DE LA MESURE CORRESPONDANTE', () => {
  /**
   * LE GARDE QUI SURVIVRA AUX COURBES FUTURES. Noter une borne inférieure n'est légitime que sur
   * une courbe CROISSANTE : la distance réelle dépasse la borne, donc la note réelle lui est
   * supérieure ou égale. Si quelqu'un rendait un jour cette courbe décroissante — « trop loin d'un
   * cours d'eau coûte en génie civil », par exemple — noter la borne deviendrait une SURESTIMATION,
   * et rien d'autre ne le dirait.
   */
  const avecBorne = snapshot();
  avecBorne.eau.distanceCoursEauM = null;
  avecBorne.eau.coursEauAuDelaDeM = 1000;

  const mesuree = snapshot();
  mesuree.eau.distanceCoursEauM = 1000;

  const nBorne = critere(avecBorne, 'dist_eau').note;
  const nMesure = critere(mesuree, 'dist_eau').note;
  assert.ok(nBorne != null && nMesure != null);
  assert.ok(
    nBorne <= nMesure,
    `noter la borne (${nBorne}) doit minorer, jamais majorer la mesure de même valeur (${nMesure})`,
  );
});

test('LES DEUX CHAMPS NULS RESTENT GRIS : UNE REQUETE EN ECHEC N’EST PAS UNE BORNE', () => {
  const s = snapshot();
  s.eau.distanceCoursEauM = null;
  s.eau.coursEauAuDelaDeM = null;

  const c = critere(s, 'dist_eau');
  assert.equal(c.note, null);
  assert.equal(c.feu, 'gris', '« je n’ai pas pu regarder » ne doit pas devenir « je n’ai rien vu »');
});

test('LE CAPTAGE SUIT LA MEME REGLE, ET NE SUPPOSE PLUS CINQ KILOMETRES', () => {
  /**
   * CE QUE CETTE LIGNE VALAIT : `paliers(c.distanceM ?? 5000, …)`. Faute de distance connue, elle
   * supposait 5 km — la note maximale — c'est-à-dire qu'elle notait le mieux possible ce qu'elle
   * savait le moins. Le repli était jusqu'ici quasi inatteignable ; il devient courant maintenant
   * qu'un secteur peut être déclaré renseigné sans qu'aucun captage n'y figure.
   *
   * Ce qui est démontré n'est pas 5 km, c'est le rayon interrogé : 1 000 m, soit 88 et non 100.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };

  const c = critere(s, 'dist_captage');
  assert.equal(c.note, 88, 'la note porte sur le rayon interrogé, pas sur une distance supposée');
  assert.match(c.valeurAffichee ?? '', /aucun captage à moins de/i);
  assert.ok(
    (c.note ?? 0) < 100,
    'supposer 5 km donnait 100 : la borne démontrée doit rester en deçà',
  );
});

test('UN SECTEUR NON RENSEIGNE LAISSE LE CAPTAGE GRIS', () => {
  /*
   * Le GPU ne publie que les servitudes effectivement téléversées. Sans aucune servitude rendue
   * pour l'emprise, l'absence d'AS1 ne prouve rien — et le critère doit le dire.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: null, type: null, distanceM: null, auDelaDeM: null };

  const c = critere(s, 'dist_captage');
  assert.equal(c.note, null);
  assert.equal(c.feu, 'gris');
});

test('LA BORNE FAIT REMONTER LA COUVERTURE MESURABLE, PAS LE SUJET COMPLET', () => {
  /**
   * LE SENS DE LA CORRECTION, VÉRIFIÉ SUR LE CHIFFRE QUI DÉCIDE DU GRIS.
   *
   * `couvertureDonnees` mesure ce qui a pu être su ici ; c'est elle qui décide qu'une filière
   * bascule en gris sous 80 %. `couvertureCatalogue` mesure la part du sujet regardée. Les deux
   * doivent monter, puisqu'un critère passe de non renseigné à renseigné — mais la première est
   * celle qui change le verdict.
   */
  const avant = snapshot();
  avant.eau.distanceCoursEauM = null;
  avant.eau.coursEauAuDelaDeM = null;
  avant.eau.captageAep = { dansPerimetre: null, type: null, distanceM: null, auDelaDeM: null };

  const apres = snapshot();
  apres.eau.distanceCoursEauM = null;
  apres.eau.coursEauAuDelaDeM = 1000;
  apres.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };

  const a = calculerScore(avant, 'methanisation');
  const b = calculerScore(apres, 'methanisation');
  assert.ok(
    b.couvertureDonnees > a.couvertureDonnees,
    `la couverture mesurable doit monter (${a.couvertureDonnees} → ${b.couvertureDonnees})`,
  );
  assert.ok(b.couvertureCatalogue > a.couvertureCatalogue);
});

test('LE CAPTAGE SURVIT A UNE PANNE DE GEORISQUES, PARCE QUE CE N’EST PAS SA SOURCE', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * UNE ERREUR D'ETIQUETTE COUTAIT 5,5 % DU POIDS DE LA METHANISATION
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * `eau.captageAep` n'est rempli QUE par le connecteur des servitudes, depuis les assiettes AS1
   * du Géoportail de l'urbanisme. Le connecteur Géorisques écrit explicitement `null`, avec le
   * commentaire qui le dit. Le critère déclarait pourtant Géorisques comme source.
   *
   * Or le moteur annule la note de tout critère dont la source est en échec — mécanisme juste et
   * indispensable. Géorisques étant injoignable, la note du captage était jetée sur les 301
   * parcelles **alors que le GPU avait répondu et que la donnée était dans l'instantané**.
   *
   * Ce test met Géorisques en échec et exige que le captage garde sa note. Il échouerait sur
   * l'ancien code, et il échouera de nouveau si quelqu'un réattribue ce critère par mégarde.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };
  /*
   * Les deux sources sont declarees dans l'instantane : c'est ce qui permet de verifier LAQUELLE le
   * critere revendique. Avec une seule, l'assertion passerait par defaut.
   */
  s.sources['apicarto_gpu'] = {
    nom: "Géoportail de l'urbanisme — servitudes d'utilité publique",
    connecteur: 'apicarto_gpu',
    dateInterrogation: '2026-09-30T00:00:00.000Z',
    valeurJuridique: 'opposable',
  };
  s.sources['georisques'] = {
    nom: 'Géorisques (BRGM / MTE)',
    connecteur: 'georisques',
    dateInterrogation: '2026-09-30T00:00:00.000Z',
    valeurJuridique: 'opposable',
  };

  const r = calculerScore(s, 'methanisation', {
    connecteursEnEchec: [
      'georisques/gaspar/pprn',
      'georisques/cavites',
      'georisques/installations_classees',
    ],
  });
  const c = r.criteres.find((x) => x.id === 'dist_captage');
  assert.ok(c);
  assert.equal(c.note, 88, 'la panne de Géorisques ne doit pas emporter une donnée venue du GPU');
  assert.equal(
    c.source?.connecteur,
    'apicarto_gpu',
    'la fiche doit nommer la source réelle : une référence fausse vaut moins que pas de référence',
  );
});

test('LE MECANISME D’ANNULATION SUR SOURCE EN ECHEC RESTE INTACT', () => {
  /*
   * LE CONTRE-EXEMPLE INDISPENSABLE. Corriger une etiquette ne doit pas desarmer le garde : un
   * critere dont la VRAIE source est en echec doit toujours perdre sa note. Sans ce test, on
   * pourrait « reparer » le captage en supprimant le mecanisme, et les deux tests passeraient.
   */
  const s = snapshot();
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: null, auDelaDeM: 1000 };
  const r = calculerScore(s, 'methanisation', { connecteursEnEchec: ['apicarto_gpu'] });
  const c = r.criteres.find((x) => x.id === 'dist_captage');
  assert.ok(c);
  assert.equal(c.note, null, 'une panne de la VRAIE source doit toujours annuler la note');
});

/** Les deux sources déclarées, pour que l'assertion porte sur celle que le critère revendique. */
function avecDeuxSources(): ParcelleSnapshot {
  const s = snapshot();
  s.sources['apicarto_gpu'] = {
    nom: "Géoportail de l'urbanisme — servitudes d'utilité publique",
    connecteur: 'apicarto_gpu',
    dateInterrogation: '2026-09-30T00:00:00.000Z',
    valeurJuridique: 'opposable',
  };
  s.sources['georisques'] = {
    nom: 'Géorisques (BRGM / MTE)',
    connecteur: 'georisques',
    dateInterrogation: '2026-09-30T00:00:00.000Z',
    valeurJuridique: 'opposable',
  };
  return s;
}

test('LE CAPTAGE NOMME LE GPU SUR SES TROIS BRANCHES, PAS SEULEMENT UNE', () => {
  /**
   * LA VERIFICATION PAR MUTATION A MONTRE QUE LE PREMIER TEST N'EN COUVRAIT QU'UNE.
   *
   * Ce critère a trois sorties : la parcelle est DANS un périmètre, elle est HORS périmètre, ou
   * l'on ne sait rien. Réattribuer l'une des trois à Géorisques ne faisait échouer aucun test tant
   * que le seul cas couvert était « hors périmètre ».
   *
   * Les trois comptent, et pas pour la même raison. Celle qui décide du gris — « on ne sait rien » —
   * emporte 5,5 % du poids de la méthanisation quand Géorisques tombe. Les deux autres décident de
   * ce que la fiche **affiche** comme source, et une référence fausse dans un document de
   * traçabilité vaut moins que pas de référence : celui qui vérifie ne trouve rien, et cesse de
   * croire les autres.
   */
  const dedans = avecDeuxSources();
  dedans.eau.captageAep = { dansPerimetre: true, type: 'rapproche', distanceM: 0, auDelaDeM: null };
  const cDedans = calculerScore(dedans, 'methanisation').criteres.find((x) => x.id === 'dist_captage');
  assert.ok(cDedans);
  assert.equal(cDedans.source?.connecteur, 'apicarto_gpu', 'branche « dans le périmètre »');

  const dehors = avecDeuxSources();
  dehors.eau.captageAep = { dansPerimetre: false, type: null, distanceM: 350, auDelaDeM: null };
  const cDehors = calculerScore(dehors, 'methanisation').criteres.find((x) => x.id === 'dist_captage');
  assert.ok(cDehors);
  assert.equal(cDehors.source?.connecteur, 'apicarto_gpu', 'branche « hors périmètre »');

  const inconnu = avecDeuxSources();
  inconnu.eau.captageAep = { dansPerimetre: null, type: null, distanceM: null, auDelaDeM: null };
  const cInconnu = calculerScore(inconnu, 'methanisation').criteres.find((x) => x.id === 'dist_captage');
  assert.ok(cInconnu);
  assert.equal(cInconnu.note, null);
  assert.equal(
    cInconnu.source?.connecteur,
    'apicarto_gpu',
    'branche « on ne sait rien » : c’est elle qui décide du gris quand Géorisques tombe',
  );
});
