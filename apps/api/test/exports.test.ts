/**
 * Tests des exports : CSV, GeoJSON et rapport PDF.
 *
 * POURQUOI CE FICHIER EXISTE. Trois audits successifs ont trouve quatre regressions, et
 * chaque fois hors du moteur de scoring - le seul composant qui etait teste. Deux d'entre
 * elles etaient dans ces exports : un statut « Score faible » sur une parcelle
 * reglementairement ecartee, et un « aucune declaration » agricole affirme a partir d'une
 * absence de donnee. Ces deux erreurs sortent de l'application par un fichier remis a un
 * tiers ; ce sont donc les plus couteuses, et les moins visibles a la relecture.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot, type ResultatScore } from '@enr/core';
import { formatNombre } from '@enr/scoring';
import {
  csvResultats,
  ficheParcellePdf,
  geojsonParcelles,
  libelleRpg,
} from '../src/services/exports.js';
import type { LigneResultatFiltre } from '../src/services/recherche.js';
import type { ParcelleEnBase } from '../src/depots/parcelles.js';

// ---------------------------------------------------------------------------
// Fixtures minimales
// ---------------------------------------------------------------------------

function ligne(sur: Partial<LigneResultatFiltre> = {}): LigneResultatFiltre {
  return {
    idu: '01001000AA0001',
    nomCommune: 'Villeneuve',
    section: 'AA',
    numero: '0001',
    surfaceHa: 12.5,
    statutScore: 'vert',
    scoreGlobal: 78.4,
    nbKnockOutsBloquants: 0,
    statutProspection: null,
    distancePosteKm: 4.2,
    pentePct: 3.1,
    // Une valeur REELLE du domaine (`TypeSol`), et non une invention : c'est elle qui doit se
    // traduire en libelle. Le repli sur une valeur inconnue est teste separement.
    typeSol: 'agricole_exploite',
    centroide: [5.2231, 46.2044],
    ...sur,
  };
}

/**
 * Snapshot vide.
 *
 * Produit par le MEME constructeur que la production (`snapshotVide` de @enr/core) plutot
 * que recopie a la main : une fixture recopiee derive du type des qu'un champ change, et
 * le test devient alors vert sur une structure que la production ne produit plus.
 */
function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '01001000AA0001',
      codeInsee: '01001',
      nomCommune: 'Villeneuve',
      section: 'AA',
      numero: '0001',
      contenanceM2: 125000,
      surfaceCalculeeM2: 124800,
      centroide: [5.2231, 46.2044],
      codeDepartement: '01',
    },
    '2026-08-04T09:00:00.000Z',
  );
}

/**
 * Score vide. Type sans cast a dessein : un `as unknown as ResultatScore` laisserait
 * passer une fixture qui ne ressemble plus au type reel, et le test cesserait alors de
 * tester la production tout en restant vert.
 */
function scoreVide(): ResultatScore {
  return {
    idu: '01001000AA0001',
    filiere: 'solaire_sol',
    statut: 'gris',
    scoreGlobal: null,
    knockOuts: [],
    limitesViabilite: [],
    criteres: [],
    pointsForts: [],
    pointsVigilance: [],
    seuilsProcedure: [],
    couvertureDonnees: 0,
    regimeImplantation: null,
    ponderationsAppliquees: {},
    versionMoteur: 'test',
    dateCalcul: '2026-08-04T09:00:00.000Z',
    avertissements: [],
  };
}

const parcelle: ParcelleEnBase = {
  idu: '01001000AA0001',
  codeInsee: '01001',
  nomCommune: 'Villeneuve',
  section: 'AA',
  numero: '0001',
  contenanceM2: 125000,
  surfaceCalculeeM2: 124800,
  codeDepartement: '01',
  geometrie: { type: 'Polygon', coordinates: [[[5.22, 46.2], [5.23, 46.2], [5.23, 46.21], [5.22, 46.21], [5.22, 46.2]]] },
} as unknown as ParcelleEnBase;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test("le CSV distingue une parcelle ecartee d'une parcelle mal notee", () => {
  const csv = csvResultats([
    ligne({ statutScore: 'rouge', scoreGlobal: 31, nbKnockOutsBloquants: 0 }),
    ligne({ idu: '01001000AA0002', statutScore: 'rouge', scoreGlobal: 28, nbKnockOutsBloquants: 2 }),
  ]);
  const lignes = csv.trimEnd().split('\n');
  const entetes = lignes[0]!.split(';');
  const iEcartee = entetes.indexOf('Ecartee reglementairement');

  assert.ok(iEcartee > 0, 'la colonne doit exister');
  // Meme statut, meme ordre de grandeur de score : sans cette colonne les deux lignes
  // sont indiscernables, et rien ne dit que la seconde est juridiquement exclue.
  assert.equal(lignes[1]!.split(';')[iEcartee], 'non');
  assert.equal(lignes[2]!.split(';')[iEcartee], 'oui');
});

test('le CSV echappe les separateurs et les guillemets', () => {
  const csv = csvResultats([ligne({ nomCommune: 'Saint-Jean; dit "le Haut"' })]);
  const ligneDonnee = csv.trimEnd().split('\n')[1]!;
  assert.ok(ligneDonnee.includes('"Saint-Jean; dit ""le Haut"""'));
  // Le champ echappe ne doit pas augmenter le nombre de colonnes. Compte relatif aux
  // en-tetes et non a un nombre fige : ajouter une colonne est legitime, en decaler une
  // ne l'est pas.
  const champs = (l: string): number => l.match(/(^|;)("([^"]|"")*"|[^;]*)/g)?.length ?? 0;
  assert.equal(champs(ligneDonnee), champs(csv.trimEnd().split('\n')[0]!));
});

test('le CSV utilise la virgule decimale, lisible par Excel francais', () => {
  const csv = csvResultats([ligne({ surfaceHa: 12.5, scoreGlobal: 78.4 })]);
  assert.ok(csv.includes(';12,5;'));
  assert.ok(csv.includes(';78,4;'));
});

test('LE CHANGEMENT DE FORMAT : le CSV n’ecrit plus aucune cle d’enumeration', () => {
  /**
   * Le fichier ecrivait `gris`, `a_prospecter`, `agricole_exploite` — le vocabulaire interne du code —
   * la ou l'ecran affiche « Donnees manquantes », « A prospecter », « Terrain agricole exploite ». Un
   * destinataire externe n'a pas la cle de lecture, et le fichier ne disait donc pas la meme chose que
   * l'application qui l'a produit.
   *
   * Le garde est STRUCTUREL et ne nomme aucune valeur : il refuse toute cellule qui ressemble a un
   * identifiant de code — minuscules et souligne, sans espace. Une liste de valeurs interdites
   * laisserait passer la prochaine enumeration ajoutee.
   */
  const csv = csvResultats([
    ligne({ statutScore: 'gris', statutProspection: 'a_prospecter', typeSol: 'agricole_exploite' }),
    ligne({ idu: '01001000AA0002', statutScore: 'vert', statutProspection: 'en_negociation', typeSol: 'naturel_forestier' }),
  ]);

  const cellules = csv
    .trimEnd()
    .split('\n')
    .slice(1)
    .flatMap((l) => l.split(';'));
  const cles = cellules.filter((c) => /^[a-z]+(?:_[a-z0-9]+)+$/.test(c));
  assert.deepEqual(cles, [], `cles d’enumeration encore ecrites telles quelles : ${cles.join(', ')}`);

  // Et les libelles attendus sont bien la : l'absence de cles ne prouverait rien si les cases etaient
  // simplement vides.
  for (const attendu of [
    'Données manquantes',
    'À prospecter',
    'Terrain agricole exploite',
    'En négociation',
    'Espace naturel ou forestier',
  ]) {
    assert.ok(csv.includes(attendu), `libelle « ${attendu} » absent du CSV`);
  }
});

test('le CSV distingue « Rédhibitoire » d’un simple score faible, comme la liste a l’ecran', () => {
  // La palette separe deliberement deux rouges. Ecrire « Score faible » dans les deux cas perdrait la
  // distinction la plus lourde du fichier : « peu interessante » contre « juridiquement fermee ».
  const csv = csvResultats([
    ligne({ statutScore: 'rouge', nbKnockOutsBloquants: 0 }),
    ligne({ idu: '01001000AA0002', statutScore: 'rouge', nbKnockOutsBloquants: 2 }),
  ]);
  const lignes = csv.trimEnd().split('\n');
  const i = lignes[0]!.split(';').indexOf('Statut score');
  assert.equal(lignes[1]!.split(';')[i], 'Score faible');
  assert.equal(lignes[2]!.split(';')[i], 'Rédhibitoire');
});

test('une absence reste une case vide, jamais un libelle fabrique', () => {
  // `null` sur le statut de prospection signifie « aucun suivi ouvert », et sur le statut de score
  // « pas encore qualifiee ». Inventer un libelle pour une absence est la faute fondatrice de ces
  // audits, sous sa forme la plus benigne.
  const lignes = csvResultats([ligne({ statutScore: null, statutProspection: null, typeSol: null })])
    .trimEnd()
    .split('\n');
  const entetes = lignes[0]!.split(';');
  const cellules = lignes[1]!.split(';');
  for (const colonne of ['Statut score', 'Statut prospection', 'Type de sol']) {
    assert.equal(cellules[entetes.indexOf(colonne)], '', `« ${colonne} » devrait etre vide`);
  }
});

test('une valeur inconnue de la table de libelles est reportee telle quelle, pas effacee', () => {
  /**
   * Le repli compte : si une nouvelle nature de sol apparaissait en base sans entree dans la table,
   * effacer la case ferait DISPARAITRE une information de la ligne. Mieux vaut une valeur brute
   * visible — qui se remarque et se corrige — qu'une case vide, qui ne se remarque pas.
   */
  const csv = csvResultats([ligne({ typeSol: 'un_sol_inconnu_du_referentiel' })]);
  assert.ok(csv.includes('un_sol_inconnu_du_referentiel'), 'la valeur brute doit rester visible');
});

test('LE CHANGEMENT DE FORMAT : les coordonnees sont bornees a six decimales', () => {
  /**
   * Le fichier ecrivait `1,7455783348199738` — dix-sept chiffres significatifs, soit une precision
   * affichee de l'ordre du dixieme de nanometre sur une donnee issue du cadastre, que l'application
   * qualifie d'indicative dans chacun de ses avertissements.
   *
   * Six decimales valent environ 7 cm en longitude et 11 cm en latitude aux latitudes francaises :
   * deja bien plus fin que la source.
   */
  const csv = csvResultats([ligne({ centroide: [1.7455783348199738, 48.15809211] })]);
  const lignes = csv.trimEnd().split('\n');
  const entetes = lignes[0]!.split(';');
  const cellules = lignes[1]!.split(';');
  assert.equal(cellules[entetes.indexOf('Longitude')], '1,745578');
  assert.equal(cellules[entetes.indexOf('Latitude')], '48,158092');

  // Et aucun nombre du fichier ne depasse cette precision : le garde porte sur tout le CSV, pas sur
  // les seules deux colonnes ci-dessus.
  const trop = csv.match(/\d+,\d{8,}/g) ?? [];
  assert.deepEqual(trop, [], `nombres a precision excessive : ${trop.join(', ')}`);
});

test('le GeoJSON garde ses cles ET ajoute les libelles : rien ne casse, tout se lit', () => {
  /**
   * L'asymetrie avec le CSV est deliberee et doit rester verifiee dans les deux sens. Le GeoJSON est
   * consomme par des programmes et des SIG : remplacer `statut_score` casserait tout filtre et toute
   * regle de symbologie construite dessus. Mais un SIG affiche aussi sa table d'attributs a un humain.
   * Les deux colonnes coexistent.
   */
  const score = { ...scoreVide(), statut: 'gris' as const, regimeImplantation: 'agrivoltaisme' };
  const gj = geojsonParcelles([{ parcelle, score }]) as {
    features: Array<{ properties: Record<string, unknown> }>;
  };
  const props = gj.features[0]!.properties;

  // La cle, intacte.
  assert.equal(props['statut_score'], 'gris');
  assert.equal(props['regime_implantation'], 'agrivoltaisme');
  // Le libelle, en plus.
  assert.equal(props['statut_score_libelle'], 'Données manquantes');
  assert.ok(
    String(props['regime_implantation_libelle']).startsWith('Agrivoltaisme'),
    `libelle de regime inattendu : ${String(props['regime_implantation_libelle'])}`,
  );
});

test('le CSV commence par une BOM UTF-8', () => {
  // Sans BOM, Excel lit les accents en Latin-1 et « Ecartee » devient illisible.
  assert.equal(csvResultats([ligne()]).charCodeAt(0), 0xfeff);
});

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

test('le GeoJSON porte le compteur de knock-outs bloquants', () => {
  const fc = geojsonParcelles([
    {
      parcelle,
      score: {
        ...scoreVide(),
        knockOuts: [
          { id: 'a', libelle: 'A', motif: 'm', famille: 'urbanisme', regleLiee: null, source: null, derogeable: false },
          { id: 'b', libelle: 'B', motif: 'm', famille: 'urbanisme', regleLiee: null, source: null, derogeable: true },
        ],
      },
    },
  ]) as { features: Array<{ properties: Record<string, unknown> }> };

  const p = fc.features[0]!.properties;
  assert.equal(p['nb_knock_outs'], 2, 'total, derogeables inclus');
  assert.equal(p['nb_ko_bloquants'], 1, 'seuls les non derogeables');
});

test("le GeoJSON porte l'avertissement sur la valeur juridique des contours", () => {
  const fc = geojsonParcelles([{ parcelle, score: null }]) as {
    metadata: { avertissement: string };
  };
  assert.match(fc.metadata.avertissement, /sans valeur juridique/i);
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Concatene le flux PDF pour pouvoir en inspecter le contenu. */
async function pdf(snapshot: ParcelleSnapshot, score = scoreVide()): Promise<Buffer> {
  const flux = ficheParcellePdf(parcelle, snapshot, score);
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(Buffer.from(m as Buffer));
  return Buffer.concat(morceaux);
}

test('le rapport se genere sur un snapshot entierement vide', async () => {
  const buf = await pdf(snapshot());
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.subarray(-1024).toString('latin1').includes('%%EOF'));
});

test("« aucune declaration » n'est ecrit que si le RPG a effectivement repondu", () => {
  const base = snapshot().occupationSol.rpg;

  // RPG injoignable : aucune affirmation possible sur l'usage agricole.
  assert.equal(libelleRpg({ ...base, anneesDeclareesConsecutives: null }), 'non renseigne (RPG non consulte)');

  // RPG joignable, aucun ilot recouvrant : l'absence de declaration est un CONSTAT, et
  // c'est meme un argument favorable en solaire au sol. Elle doit donc etre affirmee.
  assert.equal(libelleRpg({ ...base, anneesDeclareesConsecutives: 0 }), 'aucune declaration PAC');

  // Declaration presente : le libelle de culture primait deja.
  assert.equal(
    libelleRpg({ ...base, libelleCulture: 'Ble tendre d\'hiver', anneesDeclareesConsecutives: 5 }),
    'Ble tendre d\'hiver',
  );
});

test('le rapport pagine et numerote', async () => {
  const buf = await pdf(snapshot());
  // /Count n indique le nombre de pages de l'arbre de pages.
  const m = /\/Count (\d+)/.exec(buf.toString('latin1'));
  assert.ok(m, 'le catalogue doit declarer un nombre de pages');
  assert.ok(Number(m![1]) >= 1);
});

/**
 * Correction (audit 5, C2). La colonne des poids du rapport PDF affichait « 10.7 % » : un point
 * decimal dans un document francais destine a etre transmis a un elu ou a un proprietaire.
 * Le projet a un formateur unique, `formatNombre`, qui produit la virgule.
 *
 * Le test est structurel parce que le defaut est invisible aux tests fonctionnels : le PDF se
 * genere, se pagine et contient les bonnes valeurs — seul le separateur est faux. Il verifie
 * donc qu'aucun `toFixed` decimal ne parvienne au document sans passer par une mise en forme
 * francaise, quel que soit le champ ajoute ensuite.
 */
test('aucun nombre decimal du rapport n’echappe au separateur francais', () => {
  const source = readFileSync(new URL('../src/services/exports.ts', import.meta.url), 'utf8');
  const sansCommentaires = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const fautifs: string[] = [];
  for (const m of sansCommentaires.matchAll(/.{0,60}\.toFixed\([1-9]\).{0,40}/g)) {
    const extrait = m[0];
    // Trois mises en forme acceptables : la conversion explicite, `formatNombre`, ou les
    // coordonnees geographiques — seule exception assumee, documentee a son point d'emploi :
    // une paire deja separee par une virgule deviendrait ambigue, et ces coordonnees sont
    // faites pour etre recopiees dans un outil cartographique.
    if (
      !extrait.includes("replace('.', ',')") &&
      !extrait.includes('formatNombre') &&
      !extrait.includes('centroide')
    ) {
      fautifs.push(extrait.trim());
    }
  }
  assert.deepEqual(fautifs, [], `nombres decimaux non localises : ${fautifs.join(' | ')}`);
});

test('les poids sont formates avec une virgule et une unite separee', () => {
  // Verifie le formateur lui-meme sur les poids reellement rencontres dans le referentiel.
  assert.equal(formatNombre(10.7, '%'), '10,7 %');
  assert.equal(formatNombre(3.8, '%'), '3,8 %');
  // Un poids rond perd sa decimale mais garde l'espace avant le signe, comme l'exige l'usage
  // typographique francais (verifie sur un rendu PDF reel).
  assert.equal(formatNombre(3, '%'), '3 %');
});

/**
 * Toute date du rapport passe par `dateFr` — audit 10, défaut B2.
 *
 * POURQUOI CE GARDE MANQUAIT. Celui de l'audit 5, juste au-dessus, ne surveille que les `toFixed`
 * décimaux. Il ne pouvait donc pas voir deux choses, et le rapport portait les deux :
 *
 *   - une date brute interpolée : « Permis de construire … depuis le 2022-10-01 », dans un document
 *     qui écrit « rapport du 07/08/2026 » en première page. Deux conventions de date dans le même
 *     PDF remis à un propriétaire ou à un financeur ;
 *   - la date de vérification du référentiel réglementaire, en pied de rapport, au format ISO.
 *
 * Un garde qui surveille un seul motif donne l'illusion de couvrir un sujet. Celui-ci ferme l'autre
 * moitié : aucune expression dont le nom évoque une date ne doit être interpolée sans mise en forme.
 */
test('aucune date du rapport n’echappe a la mise en forme francaise', () => {
  const source = readFileSync(new URL('../src/services/exports.ts', import.meta.url), 'utf8');
  const sansCommentaires = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  const fautifs: string[] = [];
  // Toute interpolation `${...date...}` dans un gabarit : le nom de l'expression suffit a la
  // reconnaitre, et c'est plus robuste qu'une liste de champs a tenir a jour.
  for (const m of sansCommentaires.matchAll(/\$\{([^}]*[Dd]ate[^}]*)\}/g)) {
    const expr = (m[1] ?? '').trim();
    // Mises en forme acceptees : `dateFr`, une conversion locale explicite, ou un champ deja
    // formate en amont (les libelles de source portent leur propre millesime en clair).
    if (
      !expr.includes('dateFr') &&
      !expr.includes('toLocaleDateString') &&
      !/^date[A-Za-z]*Fr$/.test(expr)
    ) {
      fautifs.push(expr);
    }
  }
  assert.deepEqual(
    fautifs,
    [],
    `dates interpolees sans mise en forme francaise : ${fautifs.join(' | ')}`,
  );
});
