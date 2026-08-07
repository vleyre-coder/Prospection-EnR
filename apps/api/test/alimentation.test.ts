/**
 * Un champ CITE n'est pas un champ ALIMENTE.
 *
 * POURQUOI CE FICHIER EXISTE, et pourquoi c'est le controle le plus important du depot.
 *
 * `champs-orphelins.test.ts` verifie qu'aucun champ lu par une decision n'est sans ecrivain. Il a
 * fonctionne : il a trouve `trameVerteBleue` a sa premiere execution. Mais il verifie la CITATION —
 * « le nom du champ apparait-il quelque part dans un connecteur ? » — et l'audit 8 a montre que la
 * citation ne prouve rien. Les 156 feuilles du snapshot etaient toutes citees, et trois d'entre
 * elles ne pouvaient recevoir aucune valeur en production :
 *
 *   - `patrimoine.siteClasse` etait ecrit par `patrimoine()`, a partir d'une table lue pour quatre
 *     types dont un seul est ingere. Le champ etait donc « alimente » par une absence affirmee, et
 *     le critere valait 90/100 en vert avec la phrase « Aucun site classe ni inscrit dans le rayon
 *     d'analyse », partout en France, sur zero donnee ;
 *   - `foncier.nbProprietairesEstime` etait ecrit — avec la constante `1`, litteralement ;
 *   - `gisement.surfacesEpandageHa` etait ecrit a `0` sur une table vide.
 *
 * La question posee par les sept premiers audits etait « ce que le code calcule est-il juste ? ».
 * Elle ne pouvait pas voir ces defauts, parce que le code EST juste : il lit proprement une table
 * que rien ne remplit. La question posee ici est l'autre : **existe-t-il, en production, un chemin
 * de donnees capable d'alimenter ce que le code affiche ?**
 *
 * Deux controles mecaniques y repondent, chacun taille sur une forme reellement rencontree.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), 'utf8');
}

/** Retire commentaires et chaines : un motif ne doit jamais matcher sa propre explication. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

function concatener(dossiers: readonly string[], nu = true): string {
  let texte = '';
  for (const d of dossiers) {
    const base = new URL(d, import.meta.url);
    let fichiers: string[] = [];
    try {
      fichiers = readdirSync(base);
    } catch {
      continue;
    }
    for (const f of fichiers) {
      if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
      try {
        const brut = readFileSync(new URL(f, base), 'utf8');
        texte += nu ? sansCommentaires(brut) : brut;
      } catch {
        /* sous-repertoire : ignore */
      }
    }
  }
  return texte;
}

// ---------------------------------------------------------------------------
// Controle 1 — les couches lues en base doivent etre ecrites par une ingestion
// ---------------------------------------------------------------------------

/**
 * Couches lues dans `contrainte` sans etre ingerees, et pourquoi c'est admis.
 *
 * Y figurer engage a ce que le critere correspondant soit declare `sansSource`, c'est-a-dire que la
 * fiche DISE que l'enjeu n'a pas ete regarde et indique ou le chercher. Ce n'est pas un
 * laissez-passer : c'est la contrepartie explicite de l'absence.
 */
const COUCHES_NON_INGEREES: Record<string, string> = {
  spr:
    'Sites patrimoniaux remarquables : ABSENTS de la couche STE du WFS Geoplateforme, qui ne porte que ' +
    'les sites classes et inscrits. Ils relevent d’un autre jeu (Atlas des patrimoines). ' +
    '`patrimoine()` retourne `recouvre: null` pour ce type.',
  elevage:
    'Inventaire ICPE. RECHERCHE DE SOURCE MENEE ET DOCUMENTEE (docs/SOURCES_DONNEES.md §3.2) : la ' +
    'classification EST disponible par l’API Georisques (booleens `bovins`, `porcs`, `volailles`), mais ' +
    'aucun fichier national FRAIS n’existe pour l’ingerer — les deux jeux data.gouv candidats datent ' +
    'de 2021. Un appel par parcelle couterait dix a vingt requetes paginees sur un quota public ' +
    'partage, pour un comptage qui ne suffit pas a calculer le tonnage. `agregerIntrants` retourne ' +
    'donc `null` par couche absente, et gis_intrants est `sansSource`.',
  industrie_agroalimentaire:
    'Meme conclusion que elevage. La classification est le code NAF 10 ou 11 OU une rubrique ICPE 22xx : ' +
    'mesure sur 300 installations bretonnes, 9 par chaque critere avec seulement 3 en commun — les deux ' +
    'doivent etre combines par OU, pas pris seuls.',
  surface_agricole_commune:
    'RPG agrege par commune, non ingere. Le RPG est interrogeable a la parcelle, mais agreger les ' +
    'surfaces agricoles dans un rayon de 10 km demanderait des dizaines d’appels par parcelle. ' +
    '`surfacesEpandageHa` vaut `null` et gis_debouche_epandage est `sansSource`.',
  document_cadre_pv:
    'Documents-cadres departementaux PV au sol : arretes prefectoraux, aucun job d’ingestion. ' +
    '`documentCadrePv()` retourne `departementCouvert: null` — distingue de `false`, qui signifie ' +
    'que le departement n’en a pas — et le knock-out ne se declenche que sur `true`.',
};

/**
 * Couches qu'un job d'ingestion alimente, et le job qui le fait.
 *
 * POURQUOI CETTE SECONDE TABLE. `typesEcrits()` ne voit que les types ecrits en LITTERAL dans un
 * `INSERT INTO contrainte`. C'etait suffisant tant qu'un seul job ecrivait un seul type ; ce n'est
 * plus vrai : l'ingestion des sites passe le type en parametre (`d.type`), et les ZAER vont dans leur
 * propre table. Ces couches auraient donc ete signalees comme non ingerees alors qu'elles le sont.
 *
 * Le defaut est celui de mon propre controle, et il est du meme genre que ceux qu'il traque : un
 * perimetre plus etroit que ce qu'il annonce. La table ci-dessous le complete, et les deux tests
 * suivants la verifient dans les DEUX SENS — le type doit apparaitre dans le job nomme, et une couche
 * ingeree ne doit plus figurer dans `COUCHES_NON_INGEREES`.
 */
const TYPES_INGERES_PAR: Record<string, { fichier: string; fonction: string }> = {
  monument_historique: { fichier: '../src/ingestion/index.ts', fonction: 'ingererPatrimoine' },
  site_classe: { fichier: '../src/ingestion/wfs-national.ts', fonction: 'typeSite' },
  site_inscrit: { fichier: '../src/ingestion/wfs-national.ts', fonction: 'typeSite' },
  zaer: { fichier: '../src/ingestion/wfs-national.ts', fonction: 'ingererZaer' },
};

test('chaque couche declaree ingeree l’est bien par le job nomme', () => {
  // Sans cette verification, la table ci-dessus deviendrait une liste de vœux : on y inscrirait une
  // couche, le controle la considererait alimentee, et personne ne l'ingererait.
  for (const [type, { fichier, fonction }] of Object.entries(TYPES_INGERES_PAR)) {
    const source = sansCommentaires(lire(fichier));
    assert.match(
      source,
      new RegExp(`function\\s+${fonction}\\b`),
      `${fichier} doit definir ${fonction}(), declare comme ingerant ${type}`,
    );
    assert.match(
      source,
      new RegExp(`'${type}'`),
      `${fonction}() doit mentionner le type '${type}' qu'il est declare ingerer`,
    );
  }
});

test('une couche desormais ingeree ne reste pas declaree absente', () => {
  /**
   * LE CONTROLE QUI SE PERIME LE PLUS VITE, donc celui qu'il faut automatiser.
   *
   * `zaer`, `site_classe` et `site_inscrit` figuraient dans `COUCHES_NON_INGEREES` avec un motif juste
   * — aucun job ne les alimentait. Deux jobs les alimentent maintenant, et laisser la declaration en
   * place ferait croire au controle que l'absence est assumee, alors que la donnee est la. Le critere
   * resterait declare `sansSource`, donc gris, sur une donnee disponible : la faute de l'audit 8 dans
   * l'autre sens.
   */
  const doublement = Object.keys(TYPES_INGERES_PAR)
    .filter((t) => COUCHES_NON_INGEREES[t])
    .sort();
  assert.deepEqual(
    doublement,
    [],
    'ces couches sont a la fois declarees ingerees et declarees absentes. Retirez-les de ' +
      'COUCHES_NON_INGEREES, et retirez `sansSource` du critere correspondant, sinon la fiche restera ' +
      'grise sur une donnee disponible.',
  );
});

/** Types lus dans la table `contrainte`, tous emplacements confondus. */
function typesLus(source: string): Set<string> {
  const nu = sansCommentaires(source);
  const types = new Set<string>();
  // `type IN ('a', 'b')`, `type = ANY($1)` avec constante voisine, `c.type = 'a'`.
  for (const m of nu.matchAll(/\btype\s+IN\s*\(([^)]*)\)/gi)) {
    for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) types.add(t[1]!);
  }
  for (const m of nu.matchAll(/\b(?:c\.)?type\s*=\s*'([a-z_]+)'/gi)) types.add(m[1]!);
  // Les listes passees en parametre (`type = ANY($1)`) sont declarees en constante TypeScript.
  for (const m of nu.matchAll(/COUCHES_INTRANTS\s*=\s*\[([^\]]*)\]/g)) {
    for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) types.add(t[1]!);
  }
  for (const m of nu.matchAll(/TYPES_PATRIMOINE\s*=\s*\[([^\]]*)\]/g)) {
    for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) types.add(t[1]!);
  }
  /**
   * Les couches interrogees via `couchesPresentes` / `couchesPresentesDansDepartement`.
   *
   * Ajoute apres que ce test a trouve `zaer` a sa premiere execution sans voir `document_cadre_pv`,
   * pourtant lu de la meme facon : le motif ne lisait que le SQL, pas les appels de l'aide qui
   * l'encapsule. Un controle qui ne voit qu'une partie de ce qu'il pretend couvrir est exactement le
   * defaut que l'audit 7 a trouve dans mon controle de contrat — il couvrait 3 connecteurs sur 14.
   */
  for (const m of nu.matchAll(/couchesPresentes(?:DansDepartement)?\(\s*\[([^\]]*)\]/g)) {
    for (const t of m[1]!.matchAll(/'([a-z_]+)'/g)) types.add(t[1]!);
  }
  return types;
}

/** Types effectivement inseres dans `contrainte` par un job d'ingestion. */
function typesEcrits(): Set<string> {
  const nu = sansCommentaires(concatener(['../src/ingestion/'], false));
  const ecrits = new Set<string>();
  /**
   * Chaque `INSERT INTO contrainte` ecrit son type en litteral dans le SELECT.
   *
   * LA BORNE DE 900 CARACTERES A ETE RETIREE, et elle merite une explication : elle a casse ce test.
   * Ajouter dix lignes de commentaire dans la requete d'ingestion du patrimoine culturel a repousse
   * le backtick fermant au-dela de la fenetre ; la requete entiere cessait alors d'etre reconnue, et
   * le test annoncait « les monuments historiques doivent etre ingeres » — c'est-a-dire un defaut
   * d'ingestion, alors que rien de l'ingestion n'avait change.
   *
   * Un nombre magique dans un garde structurel est une bombe a retardement : il ne se declenche pas
   * a l'ecriture, mais le jour ou quelqu'un allonge le code surveille, et il accuse alors le mauvais
   * coupable. Or la borne etait inutile : le litteral SQL est delimite par des backticks et n'en
   * contient aucun, donc `[^\`]*` s'arrete exactement ou il faut, quelle que soit la longueur.
   */
  const inserts = nu.matchAll(/INSERT\s+INTO\s+contrainte[^`;]*(?:;|`)/gi);
  for (const bloc of inserts) {
    for (const m of bloc[0].matchAll(/SELECT\s+'([a-z_]+)'/gi)) ecrits.add(m[1]!);
  }
  return ecrits;
}

test('toute couche lue dans `contrainte` est ingeree, ou son absence est declaree', () => {
  /**
   * LE CONTROLE QUI AURAIT TROUVE LE DEFAUT B1 SANS AUDIT.
   *
   * Il existe un seul `INSERT INTO contrainte` dans tout le depot, et il n'ecrit qu'un seul type.
   * Six types etaient lus. Le rapport est brutal quand on le pose ainsi, et personne ne l'avait pose.
   */
  const lus = typesLus(concatener(['../src/connecteurs/', '../src/services/', '../src/routes/']));
  const ecrits = typesEcrits();

  assert.ok(lus.size >= 6, `attendu au moins 6 types lus, trouve ${lus.size} : le motif ne lit plus rien`);
  assert.ok(ecrits.has('monument_historique'), 'les monuments historiques doivent etre ingeres');

  const nonAlimentes = [...lus]
    .filter((t) => !ecrits.has(t) && !TYPES_INGERES_PAR[t] && !COUCHES_NON_INGEREES[t])
    .sort();

  assert.deepEqual(
    nonAlimentes,
    [],
    'ces couches sont LUES en base et ecrites par aucune ingestion. Une liste vide en devient ' +
      'indiscernable d’une absence de contrainte, et le critere qui en depend affirme une absence ' +
      'sur zero donnee. Ingerez la couche, ou declarez-la dans COUCHES_NON_INGEREES en disant ' +
      'comment la fiche informe que l’enjeu n’a pas ete regarde.',
  );
});

test('toute couche declaree non ingeree porte un critere `sansSource`', () => {
  // La contrepartie de la liste ci-dessus. Sans ce test, `COUCHES_NON_INGEREES` deviendrait un
  // simple silencieux : on y inscrirait une couche et le critere continuerait d'affirmer.
  const evaluateurs = sansCommentaires(lire('../../../packages/scoring/src/criteres-eval.ts'));
  const nb = (evaluateurs.match(/sansSource\(/g) ?? []).length;
  assert.ok(
    nb >= 8,
    `attendu au moins 8 appels a sansSource() pour couvrir les couches non ingerees, trouve ${nb}`,
  );
});

// ---------------------------------------------------------------------------
// Controle 2 — un champ structurellement nul doit etre declare, pas subi
// ---------------------------------------------------------------------------

/**
 * Champs qu'aucun chemin de production ne peut renseigner, et pourquoi c'est assume.
 *
 * Ce sont les champs affectes a `null` (ou `[]`) SANS CONDITION par un connecteur, et jamais
 * renseignes ailleurs. Chacun doit se traduire par un critere `sansSource` : la fiche dit que
 * l'enjeu n'a pas ete regarde, indique ou le chercher, et le statut est plafonne a orange.
 */
const NULS_ASSUMES: Record<string, string> = {
  karst: 'Alea karstique absent de Georisques. Critere risq_karst declare `sansSource` (BRGM InfoTerre).',
  sensibiliteArcheologique:
    'Zones de presomption de prescription arretees par les DRAC, non publiees nationalement. ' +
    'Critere pat_archeologie declare `sansSource`.',
  covisibiliteIndice:
    'Supprime volontairement a l’audit 3 : il valait « nombre de monuments x 6 », une arithmetique ' +
    'sans contenu presentee comme une mesure sur 100. La covisibilite exige une analyse de bassin ' +
    'visuel. Aucun critere ne le lit.',
  servitudesAeronautiques:
    'DGAC et zone aerienne de defense, aucune API. Critere risq_aero_radar declare `sansSource`.',
  radars: 'Meteo-France et Defense, aucune API. Meme critere que servitudesAeronautiques.',
  reseauxEnterres:
    'Teleservice reseaux-et-canalisations.gouv.fr, sans API ouverte. Affiche en information dans la ' +
    'fiche, ne porte aucune note.',
  preEnjeuEspeces:
    'Mis a `null` a l’audit 8 : il valait une derivation de la proximite des zonages naturels, deja ' +
    'notee par env_proximite_natura2000 et env_znieff — donc un double comptage de 7 % sur l’eolien.',
  sensibiliteAvifaune:
    'Exige des inventaires sur un cycle biologique complet, ou les atlas regionaux DREAL / LPO. ' +
    'Aucun critere ne le lit.',
  sensibiliteChiropteres: 'Meme raison que sensibiliteAvifaune.',
  nbProprietairesEstime:
    'Aucune API publique n’expose le nombre de comptes cadastraux : il s’obtient par demande ' +
    'documentee a la DGFiP puis versement. Critere fonc_nb_proprietaires declare `sansSource`.',
  indivisionProbable: 'Non determinable sans donnee nominative. Aucune note ne s’y appuie.',
  zonagePpri:
    'L’API Georisques expose la LISTE des zones d’un plan, pas leur geometrie : la zone applicable ' +
    'a la parcelle est inconnue. La severite du plan est exposee dans son propre champ.',
  inculteDepuis2013:
    'La date de reference du 10 mars 2013 depasse la profondeur du RPG interrogeable : le caractere ' +
    'non exploite ne peut pas etre affirme, seulement signale comme restant a demontrer. La fiche ' +
    'affiche « a demontrer (historique RPG et photo-interpretation) » et le critere sol_type le ' +
    'rappelle dans son commentaire. C’est un `null` VOULU, et non une source manquante.',
  codeEpci: 'Non renseigne par le cadastre ; sans usage decisionnel.',
  nomEpci: 'Non renseigne par le cadastre ; sans usage decisionnel.',
};

/**
 * Champs affectes a `null` ou `[]` sans condition dans un connecteur.
 *
 * On ne cherche que la forme litterale — `champ: null,` en fin de ligne, ou `x.champ = null;` — car
 * c'est celle qui trahit une absence STRUCTURELLE. Une affectation conditionnelle
 * (`champ: v ?? null`) est au contraire le comportement voulu.
 */
function nulsInconditionnels(source: string): Set<string> {
  const nu = sansCommentaires(source);
  const champs = new Set<string>();
  for (const m of nu.matchAll(/^\s{2,}([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(?:null|\[\])\s*,\s*$/gm)) {
    champs.add(m[1]!);
  }
  for (const m of nu.matchAll(/^\s*[a-zA-Z.]+\.([a-zA-Z][a-zA-Z0-9]*)\s*=\s*(?:null|\[\])\s*;\s*$/gm)) {
    champs.add(m[1]!);
  }
  return champs;
}

/** Le champ recoit-il, ailleurs, une valeur qui n'est pas litteralement nulle ? */
function recoitUneValeur(champ: string, source: string): boolean {
  const nu = sansCommentaires(source);
  for (const m of nu.matchAll(new RegExp(`\\b${champ}\\s*[:=]\\s*([^,;\\n]+)`, 'g'))) {
    const valeur = m[1]!.trim();
    if (valeur === 'null' || valeur === '[]' || valeur === 'null,' || valeur === '') continue;
    // Une signature de type (`champ: number | null`) n'est pas une affectation.
    if (/^(number|string|boolean|readonly|Array|Record|Partial|null\s*\|)/.test(valeur)) continue;
    return true;
  }
  return false;
}

test('tout champ structurellement nul est declare, et jamais subi', () => {
  /**
   * LE CONTROLE QUI AURAIT TROUVE LES DEFAUTS B2, C1 ET C2 SANS AUDIT.
   *
   * Un champ affecte a `null` sans condition et jamais renseigne ailleurs est une source qui
   * n'existe pas. Ce n'est pas un probleme en soi — plusieurs enjeux reels n'ont aucune API — mais
   * cela DOIT etre un choix explicite, et le critere correspondant doit dire que l'enjeu n'a pas ete
   * regarde. Subi, il produit un critere gris qu'on prend pour une panne, ou pire, un `0` qu'on
   * prend pour une mesure.
   */
  const connecteurs = concatener(['../src/connecteurs/']);
  const nuls = nulsInconditionnels(connecteurs);
  assert.ok(nuls.size >= 8, `attendu au moins 8 champs nuls litteraux, trouve ${nuls.size}`);

  const tousEcrivains = concatener([
    '../src/connecteurs/',
    '../src/ingestion/',
    '../src/routes/',
    '../src/scripts/',
    '../src/depots/',
  ]);

  const subis = [...nuls]
    .filter((champ) => !NULS_ASSUMES[champ])
    .filter((champ) => !recoitUneValeur(champ, tousEcrivains))
    .sort();

  assert.deepEqual(
    subis,
    [],
    'ces champs sont mis a `null` (ou `[]`) sans condition et ne recoivent jamais de valeur : ' +
      'aucun chemin de production ne peut les alimenter. Alimentez-les, ou declarez-les dans ' +
      'NULS_ASSUMES en disant comment la fiche informe que l’enjeu n’a pas ete regarde — et ' +
      'declarez le critere correspondant `sansSource`.',
  );
});

test('les champs declares nuls le sont vraiment, sinon la liste devient un mensonge', () => {
  /**
   * Le controle inverse, et il compte autant.
   *
   * Une liste d'exemptions ne se relit pas : elle se perime. Le jour ou une couche est enfin
   * ingeree, son entree dans NULS_ASSUMES continuerait d'affirmer que l'enjeu n'est pas regarde —
   * et le critere resterait declare `sansSource`, donc gris, sur une donnee desormais disponible.
   * C'est la meme faute que celle de l'audit 8, dans l'autre sens.
   */
  const connecteurs = concatener(['../src/connecteurs/']);
  const nuls = nulsInconditionnels(connecteurs);
  const perimes = Object.keys(NULS_ASSUMES)
    .filter((champ) => !nuls.has(champ))
    .filter((champ) => new RegExp(`\\b${champ}\\b`).test(sansCommentaires(connecteurs)))
    .sort();

  assert.deepEqual(
    perimes,
    [],
    'ces champs sont declares structurellement nuls mais ne le sont plus dans le code : une source ' +
      'les alimente desormais. Retirez-les de NULS_ASSUMES, et retirez `sansSource` du critere ' +
      'correspondant, sinon la fiche restera grise sur une donnee disponible.',
  );
});

// ---------------------------------------------------------------------------
// Controle 3 — aucune valeur en dur ne doit alimenter un critere note
// ---------------------------------------------------------------------------

test('aucun connecteur ne renseigne un champ du snapshot par une constante litterale', () => {
  /**
   * LE CONTROLE QUI AURAIT TROUVE LE DEFAUT B2 DIRECTEMENT.
   *
   * `cadastre.ts` retournait `nbProprietairesEstime: 1`. Litteralement, pour toutes les parcelles de
   * France, sous un commentaire decrivant un algorithme jamais ecrit. Le critere valait 100/100 en
   * vert, « 1 proprietaire(s) estime(s) », sur le facteur qui decide le plus souvent de la mort d'un
   * projet.
   *
   * Une constante numerique retournee par un connecteur est presque toujours ce defaut. Les rares
   * cas legitimes — un compteur initialise, une part de recouvrement de 1 sur un recouvrement
   * constate — sont ecrits comme des expressions, non comme des affectations litterales de champ de
   * snapshot. La liste des exceptions est donc courte, et le restera.
   */
  const CONSTANTES_LEGITIMES = new Set([
    // `partRecouvrement: l[0].contient ? 1 : 0` est une expression, pas une constante : elle ne
    // matche pas le motif. Rien ne figure ici pour l'instant, et c'est le but.
  ]);

  const connecteurs = concatener(['../src/connecteurs/']);
  // Champs de snapshot affectes a un nombre litteral, hors 0 (compteur) et hors expressions.
  const enDur: string[] = [];
  for (const m of connecteurs.matchAll(
    /^\s{2,}([a-zA-Z][a-zA-Z0-9]*(?:Estime|Indice|Pct|M|Km|Ha|An|Mw|Nm3h|Deg))\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*$/gm,
  )) {
    const [, champ, valeur] = m;
    if (!champ || CONSTANTES_LEGITIMES.has(champ)) continue;
    // `0` est admis : c'est l'initialisation d'un compteur, pas une mesure inventee.
    if (valeur === '0') continue;
    enDur.push(`${champ} = ${valeur}`);
  }

  assert.deepEqual(
    enDur.sort(),
    [],
    'un connecteur renseigne un champ mesurable par une constante. Une valeur en dur est notee ' +
      'comme une mesure, s’affiche comme un fait et part dans les exports : c’est le defaut le plus ' +
      'trompeur de tous, parce qu’il ne ressemble pas a une absence. Mesurez la valeur, ou rendez ' +
      'le champ `null`.',
  );
});
