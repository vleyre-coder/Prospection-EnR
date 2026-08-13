/**
 * Ce qu'une campagne de qualification a laisse de cote — et qu'elle taisait.
 *
 * POURQUOI CE FICHIER EXISTE — signalement d'usage, troisieme volet. Une parcelle etait introuvable, et
 * en cherchant pourquoi j'ai trouve TROIS troncatures qui s'appliquaient toutes en silence :
 *
 *   1. **le filtre de surface**, 3 000 m2 par defaut. Mesure sur trois communes reelles de la Beauce —
 *      une region de GRANDES parcelles : Bazoches-les-Hautes 487 parcelles ecartees sur 806 (60 %),
 *      Loigny-la-Bataille 377 sur 689 (55 %), Tillay-le-Peneux 609 sur 1 090 (56 %) ;
 *   2. **le plafond de lot**, 1 500 parcelles. `idus.slice(0, lotMax)` tronquait la liste, et le
 *      resultat annoncait ensuite « N qualifiees sur 1 500 » comme si 1 500 avait ete la demande ;
 *   3. **les cellules en echec** de la recuperation, journalisees en avertissement — c'est-a-dire
 *      visibles du seul exploitant du serveur, jamais de l'utilisateur.
 *
 * Le resultat d'une campagne partielle etait donc INDISTINGUABLE d'une campagne complete. Un
 * prospecteur concluait « il n'y a rien d'interessant dans ce secteur » quand la verite etait « ce
 * secteur n'a pas ete regarde ». C'est la faute fondatrice de tous ces audits — affirmer plus que ce que
 * la donnee permet — appliquee a la COUVERTURE, et c'est la plus couteuse : elle porte sur ce qui
 * n'existe pas a l'ecran, donc sur ce que personne ne peut verifier.
 *
 * COMMENT, sans reseau : `fetch` est remplace le temps du fichier et sert des reponses construites a
 * partir de la reponse REELLE capturee sur API Carto. Les noms de champs viennent donc de la source ;
 * seules l'identite et la surface des parcelles varient, pour fabriquer les cas.
 */

import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parcellesParGrandeEmprise } from '../src/connecteurs/cadastre.js';
import { avertissementCouverture } from '../src/services/qualification.js';
import { viderCacheHttp } from '../src/http.js';

interface Fixture {
  type: string;
  features: { type: string; geometry: unknown; properties: Record<string, unknown> }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/reponses/cadastre-parcelle-beauce.json', import.meta.url), 'utf8'),
) as Fixture;

const MODELE = fixture.features[0]!;

/**
 * Une parcelle de la commune fictive 99001, de surface choisie.
 *
 * LA GEOMETRIE EST FABRIQUEE, et il faut dire pourquoi : le filtre porte sur
 * `surfaceCalculeeM2 ?? contenanceM2`, et `surfaceCalculeeM2` est calculee par le connecteur DEPUIS LA
 * GEOMETRIE. Renseigner la seule `contenance` ne fabriquerait donc aucune petite parcelle — je m'en suis
 * apercu en voyant quatre parcelles retenues sur quatre. C'est un carre, place a la meme latitude que la
 * fixture pour que la conversion degres-metres soit celle du terrain reel.
 */
function parcelleFictive(numero: string, surfaceM2Visee: number): Fixture['features'][number] {
  const cote = Math.sqrt(surfaceM2Visee);
  // A 48 deg de latitude : 1 deg de latitude vaut environ 111 km, 1 deg de longitude environ 74 km.
  const dLat = cote / 111_000;
  const dLon = cote / 74_000;
  const [lon0, lat0] = [1.75, 48.12];
  return {
    ...MODELE,
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [lon0, lat0],
            [lon0 + dLon, lat0],
            [lon0 + dLon, lat0 + dLat],
            [lon0, lat0 + dLat],
            [lon0, lat0],
          ],
        ],
      ],
    },
    properties: {
      ...MODELE.properties,
      idu: `99001000ZT${numero}`,
      code_insee: '99001',
      code_dep: '99',
      code_com: '001',
      nom_com: 'Commune fictive de test',
      numero,
      contenance: Math.round(surfaceM2Visee),
    },
  };
}

// --- Interception du reseau -------------------------------------------------

/** Ce que la source fait, requete par requete. Chaque appel consomme la premiere entree. */
let scenario: ({ mode: 'succes'; features: Fixture['features'] } | { mode: 'panne' })[] = [];
let appels = 0;
const fetchOriginal = globalThis.fetch;

before(() => {
  globalThis.fetch = (async () => {
    const etape = scenario[appels] ?? { mode: 'succes' as const, features: [] };
    appels += 1;
    if (etape.mode === 'panne') throw new TypeError('fetch failed (simule)');
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: etape.features }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  appels = 0;
  viderCacheHttp();
});

after(() => {
  globalThis.fetch = fetchOriginal;
});

/**
 * Emprise couvrant exactement deux cellules de 0,05 deg.
 *
 * Le connecteur decoupe l'emprise en cellules et interroge la source une fois par cellule ; deux
 * cellules suffisent a distinguer « une cellule a echoue » de « tout a echoue ».
 */
const EMPRISE: [number, number, number, number] = [1.7, 48.1, 1.8, 48.15];

// --- La recuperation rend compte de ce qu'elle n'a pas ramene ---------------

test('UNE CELLULE EN ECHEC EST COMPTEE, plus seulement journalisee', async () => {
  /**
   * Le cas le plus grave des trois, parce qu'il est le plus invisible : la cellule qui echoue ne laisse
   * AUCUNE trace a l'ecran. Un secteur entier manque, et le reste du resultat a l'air normal.
   *
   * La panne est servie a chaque tentative de la premiere cellule : le client HTTP reessaie, et une
   * cellule n'est en echec que lorsque toutes ses tentatives ont echoue.
   */
  scenario = [
    { mode: 'panne' },
    { mode: 'panne' },
    { mode: 'panne' },
    { mode: 'succes', features: [parcelleFictive('0002', 50_000)] },
  ];
  const r = await parcellesParGrandeEmprise(EMPRISE, { surfaceMinM2: 3000 });

  assert.equal(r.cellulesEnEchec, 1, 'la cellule en echec doit etre comptee');
  assert.equal(r.cellulesTotal, 2);
  assert.equal(r.parcelles.length, 1, 'le reste du secteur reste exploitable');
  // Et cela DOIT produire un avertissement : c'est tout l'objet du chantier.
  const phrase = avertissementCouverture({
    ecarteesSurface: r.ecarteesSurface,
    surfaceMinM2: 3000,
    cellulesEnEchec: r.cellulesEnEchec,
    cellulesSautees: r.cellulesSautees,
    cellulesTotal: r.cellulesTotal,
    plafondAtteint: r.plafondAtteint,
    ignoreesPlafond: 0,
  });
  assert.match(phrase ?? '', /1 secteur\(s\) sur 2 non recupere/);
});

test('LES PARCELLES ECARTEES PAR LE FILTRE DE SURFACE SONT COMPTEES', async () => {
  // Trois parcelles sous le seuil, une au-dessus : la campagne n'en verra qu'une, et doit le dire.
  scenario = [
    {
      mode: 'succes',
      features: [
        parcelleFictive('0002', 50_000),
        parcelleFictive('0003', 900),
        parcelleFictive('0004', 1200),
        parcelleFictive('0005', 2500),
      ],
    },
  ];
  const r = await parcellesParGrandeEmprise(EMPRISE, { surfaceMinM2: 3000 });

  assert.equal(r.parcelles.length, 1, 'une seule parcelle depasse le seuil');
  assert.equal(r.ecarteesSurface, 3, 'les trois parcelles sous le seuil sont comptees');
  assert.equal(r.cellulesEnEchec, 0);
  assert.equal(r.plafondAtteint, false);
});

test('sans filtre, aucune parcelle n’est ecartee — le compte ne s’invente pas', async () => {
  scenario = [
    { mode: 'succes', features: [parcelleFictive('0002', 50_000), parcelleFictive('0003', 900)] },
  ];
  const r = await parcellesParGrandeEmprise(EMPRISE, { surfaceMinM2: 0 });
  assert.equal(r.parcelles.length, 2);
  assert.equal(r.ecarteesSurface, 0);
});

test('LE PLAFOND DE LOT ARRETE LA RECUPERATION, et les cellules non vues sont comptees', async () => {
  /**
   * Le plafond n'est pas une simple troncature de liste : les cellules suivantes ne sont PAS
   * interrogees du tout. L'emprise demandee n'est donc pas couverte, et c'est une information
   * differente de « il n'y avait rien la-bas ».
   */
  scenario = [
    { mode: 'succes', features: [parcelleFictive('0002', 50_000), parcelleFictive('0003', 60_000)] },
    { mode: 'succes', features: [parcelleFictive('0004', 70_000)] },
  ];
  const r = await parcellesParGrandeEmprise(EMPRISE, { surfaceMinM2: 0, limite: 2 });

  assert.equal(r.plafondAtteint, true);
  assert.equal(r.parcelles.length, 2, 'la recuperation s’arrete au plafond');
  assert.equal(r.cellulesSautees, 1, 'la seconde cellule n’a jamais ete interrogee');
  assert.equal(appels, 1, 'et aucune requete n’a ete emise pour elle');
});

// --- La phrase remontee a l'utilisateur ------------------------------------

const COMPLETE = {
  ecarteesSurface: 0,
  surfaceMinM2: 3000,
  cellulesEnEchec: 0,
  cellulesSautees: 0,
  cellulesTotal: 4,
  plafondAtteint: false,
  ignoreesPlafond: 0,
};

test('UNE COUVERTURE COMPLETE NE DIT RIEN : pas de faux avertissement', () => {
  // Aussi important que l'inverse. Un avertissement affiche a chaque campagne serait ignore dans le
  // mois, et le vrai cas passerait alors inapercu.
  assert.equal(avertissementCouverture(COMPLETE), null);
});

test('la phrase nomme le seuil en hectares, pas en metres carres', () => {
  const p = avertissementCouverture({ ...COMPLETE, ecarteesSurface: 487 });
  // « 3 000 m2 » ne parle pas a un prospecteur foncier ; « 0,3 ha » si.
  assert.match(p ?? '', /487 parcelle\(s\) ecartee\(s\)/);
  assert.match(p ?? '', /0,3 ha/);
});

test('LA PHRASE DIT QUOI FAIRE, et pas seulement ce qui manque', () => {
  /**
   * Un avertissement sans issue laisse l'utilisateur devant un mur. Les deux chemins qui contournent la
   * troncature existent maintenant tous les deux — cliquer la parcelle sur le cadastre, ou la chercher
   * par sa reference — et la phrase doit les nommer.
   */
  const p = avertissementCouverture({ ...COMPLETE, ecarteesSurface: 12 }) ?? '';
  assert.match(p, /cliquant sur le cadastre/);
  assert.match(p, /reference/);
});

test('les trois troncatures se cumulent dans une seule phrase', () => {
  const p =
    avertissementCouverture({
      ecarteesSurface: 300,
      surfaceMinM2: 3000,
      cellulesEnEchec: 2,
      cellulesSautees: 5,
      cellulesTotal: 12,
      plafondAtteint: true,
      ignoreesPlafond: 40,
    }) ?? '';
  assert.match(p, /300 parcelle\(s\) ecartee\(s\)/);
  assert.match(p, /2 secteur\(s\) sur 12 non recupere/);
  assert.match(p, /plafond de lot atteint, 5 secteur\(s\) sur 12/);
  assert.match(p, /40 parcelle\(s\) retenue\(s\) mais non qualifiee\(s\)/);
});
