/**
 * Chercher une parcelle que l'application n'a JAMAIS qualifiee.
 *
 * POURQUOI CE FICHIER EXISTE — signalement d'usage, et c'est le defaut le plus grave rencontre
 * jusqu'ici. Un collegue a demande une parcelle precise. Elle etait introuvable : ni sur la carte, ni
 * par son identifiant. La recherche par identifiant lisait UNIQUEMENT
 * `FROM parcelle WHERE idu = $1`, or cette table ne contient que les parcelles DEJA QUALIFIEES.
 * Autrement dit, l'application ne savait trouver que ce qu'elle connaissait deja, et repondait « aucun
 * resultat » pour tout le reste — soit l'immense majorite des 100 millions de parcelles francaises.
 *
 * L'echec etait MUET, et c'est ce qui le rend grave : rien ne distinguait « cette parcelle n'existe
 * pas » de « cette parcelle n'a pas encore ete etudiee ». Un prospecteur en concluait raisonnablement
 * que la parcelle n'existait pas.
 *
 * CE QUE CES TESTS VERROUILLENT — les quatre issues d'une recherche par identifiant, et le fait
 * qu'elles se disent DIFFEREMMENT :
 *
 *   1. parcelle connue en base -> position reelle, et AUCUN appel au cadastre ;
 *   2. inconnue en base, presente au cadastre -> position reelle et mention « a qualifier » ;
 *   3. absente du cadastre -> aucun resultat, car l'identifiant ne designe rien ;
 *   4. cadastre injoignable -> un resultat SANS position, qui dit que la source n'a pas repondu.
 *
 * Et une garantie transversale : une recherche N'ECRIT RIEN en base. Le defaut B4 de l'audit 10 etait
 * precisement un chemin de lecture qui declenchait des ecritures.
 *
 * COMMENT, sans reseau. `fetch` est remplace le temps du fichier. La reponse servie reprend la reponse
 * REELLE capturee sur API Carto (`fixtures/reponses/cadastre-parcelle-beauce.json`) : tous les NOMS de
 * champs viennent de la source, seule l'IDENTITE de la parcelle est reecrite vers un departement
 * fictif — 99, qu'aucune donnee reelle ne porte. Sans cela le test dependrait du contenu de la base de
 * developpement, ou la parcelle de reference se trouve deja qualifiee : il passerait ici et
 * echouerait ailleurs, ce qui est pire que pas de test. La forme des reponses cadastre reste verifiee
 * par `contrats-sources` et `transformation-connecteurs`, sur la fixture non modifiee.
 */

import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { rechercher } from '../src/services/recherche.js';
import { viderCacheHttp } from '../src/http.js';
import { DEP_LOCAL, INSEE_LOCAL } from './aides/communes-fictives.js';

/** Departement fictif : aucune donnee reelle ne le porte, la base ne peut donc pas le contenir. */
/** Territoire fictif PARTAGE : importe, pour passer par le garde de serialisation (audit 11). */
const DEP = DEP_LOCAL;
const INSEE = INSEE_LOCAL;
const IDU_INCONNUE = '99001000ZT0002';
const IDU_CONNUE = '99001000ZT0003';
const COMMUNE = 'Commune fictive de test';

interface Fixture {
  type: string;
  features: {
    type: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/reponses/cadastre-parcelle-beauce.json', import.meta.url), 'utf8'),
) as Fixture;

/**
 * La reponse capturee, reidentifiee vers la commune fictive.
 *
 * Les cles ne sont pas recopiees a la main : elles sont celles de la fixture, et seules cinq valeurs
 * d'identite sont remplacees. Si API Carto renommait `code_insee`, ce test continuerait de passer —
 * mais `contrats-sources` tomberait, ce qui est sa raison d'etre.
 */
function reponseCadastre(): Fixture {
  const modele = fixture.features[0];
  assert.ok(modele, 'la fixture cadastre doit porter au moins une parcelle');
  return {
    type: fixture.type,
    features: [
      {
        ...modele,
        properties: {
          ...modele.properties,
          idu: IDU_INCONNUE,
          code_insee: INSEE,
          code_dep: DEP,
          code_com: '001',
          nom_com: COMMUNE,
        },
      },
    ],
  };
}

/** Geometrie de la fixture, pour verifier que la position renvoyee est bien la sienne. */
function bboxFixture(): [number, number, number, number] {
  const coords = JSON.stringify(fixture.features[0]!.geometry);
  const nombres = [...coords.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
  const lons = nombres.filter((_, i) => i % 2 === 0);
  const lats = nombres.filter((_, i) => i % 2 === 1);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

// --- Interception du reseau -------------------------------------------------

type Issue = { mode: 'succes'; corps: Fixture } | { mode: 'vide' } | { mode: 'panne' };

let issue: Issue = { mode: 'vide' };
let appels: string[] = [];
const fetchOriginal = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (entree: unknown) => {
    appels.push(String(entree));
    if (issue.mode === 'panne') throw new TypeError('fetch failed (simule)');
    const corps: Fixture =
      issue.mode === 'succes' ? issue.corps : { type: 'FeatureCollection', features: [] };
    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  appels = [];
  // Le client HTTP met les GET en cache : sans purge, la reponse d'un test servirait le suivant et
  // deux des quatre issues ne seraient jamais reellement exercees.
  viderCacheHttp();
});

/**
 * Convention de la suite : sans `DATABASE_URL`, les tests qui touchent la base s'ignorent au lieu
 * d'echouer. Ce fichier interroge la table `parcelle` — il la respecte donc, en le disant.
 */
let baseDisponible = false;

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : recherche par identifiant ignoree (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  baseDisponible = true;
  await requete(`DELETE FROM parcelle WHERE code_departement = $1`, [DEP]);
  await requete(
    `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                           contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation)
     VALUES ($1, $2, $3, $4, '000', 'ZT', '0003', 24615, 24000,
             ST_SetSRID(ST_MakeEnvelope(1.7, 48.1, 1.7001, 48.1001, 4326), 4326),
             ST_SetSRID(ST_MakePoint(1.70005, 48.10005), 4326), current_date)
     ON CONFLICT (idu) DO NOTHING`,
    [IDU_CONNUE, INSEE, COMMUNE, DEP],
  );
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  if (baseDisponible) await requete(`DELETE FROM parcelle WHERE code_departement = $1`, [DEP]);
  await pool.end().catch(() => undefined);
});

async function nbEnBase(idu: string): Promise<number> {
  const l = await requete<{ n: string }>(`SELECT count(*) AS n FROM parcelle WHERE idu = $1`, [idu]);
  return Number(l[0]!.n);
}

// --- Les quatre issues -----------------------------------------------------

test('ISSUE 1 : une parcelle connue en base n’appelle PAS le cadastre', async () => {
  if (ignorer()) return;
  issue = { mode: 'panne' }; // toute requete reseau ferait echouer le test de facon visible
  const r = await rechercher(IDU_CONNUE);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.idu, IDU_CONNUE);
  assert.deepEqual(
    appels,
    [],
    'la recherche d’une parcelle deja qualifiee ne doit declencher aucun appel externe : le repli ' +
      'cadastre est un repli, pas le chemin normal.',
  );
  assert.ok(r[0]!.centroide, 'une parcelle en base a une position');
  assert.ok(
    !(r[0]!.sousTitre ?? '').includes('a qualifier'),
    'une parcelle deja qualifiee ne doit pas etre annoncee « a qualifier »',
  );
});

test('ISSUE 2 : LE DEFAUT SIGNALE — une parcelle jamais qualifiee est desormais trouvee', async () => {
  if (ignorer()) return;
  issue = { mode: 'succes', corps: reponseCadastre() };
  const r = await rechercher(IDU_INCONNUE);

  assert.equal(r.length, 1, `« ${IDU_INCONNUE} » doit etre trouvee au cadastre, pas rendue introuvable`);
  const p = r[0]!;
  assert.equal(p.type, 'parcelle');
  assert.equal(p.idu, IDU_INCONNUE);
  assert.equal(p.codeInsee, INSEE);

  // La position est REELLE : elle vient de la geometrie de la source, pas d'un sentinelle.
  const [minLon, minLat, maxLon, maxLat] = bboxFixture();
  assert.ok(p.centroide, 'la parcelle doit porter une position');
  const [lon, lat] = p.centroide;
  assert.ok(lon >= minLon && lon <= maxLon, `longitude ${lon} hors de l’emprise de la parcelle`);
  assert.ok(lat >= minLat && lat <= maxLat, `latitude ${lat} hors de l’emprise de la parcelle`);
  assert.ok(p.bbox, 'l’emprise doit permettre de cadrer la carte sur la parcelle');

  // Et elle est annoncee pour ce qu'elle est : existante, pas encore etudiee.
  assert.match(p.sousTitre ?? '', /a qualifier/);
  assert.match(p.sousTitre ?? '', new RegExp(COMMUNE));

  // Une requete, ciblee sur cet identifiant. Pas un balayage.
  assert.equal(appels.length, 1, `${appels.length} appels externes pour une seule parcelle`);
  const url = new URL(appels[0]!);
  assert.match(url.pathname, /cadastre\/parcelle$/);
  assert.equal(url.searchParams.get('code_insee'), INSEE);
  assert.equal(url.searchParams.get('section'), 'ZT');
  assert.equal(url.searchParams.get('numero'), '0002');

  // ET RIEN N'A ETE ECRIT : une recherche est une lecture (audit 10, defaut B4).
  assert.equal(
    await nbEnBase(IDU_INCONNUE),
    0,
    'une recherche ne doit pas enregistrer la parcelle : c’est la qualification qui le fait, sur ' +
      'demande explicite.',
  );
});

test('ISSUE 2 bis : une reference saisie a la main mene a la meme parcelle', async () => {
  if (ignorer()) return;
  issue = { mode: 'succes', corps: reponseCadastre() };
  // « 99001 ZT 2 » : section sur deux caracteres, numero sur un seul. La composition de l'identifiant
  // doit completer a GAUCHE — « 2 » vaut 0002, et non 2000 qui designerait une autre parcelle.
  const r = await rechercher(`${INSEE} ZT 2`);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.idu, IDU_INCONNUE);
  assert.ok(r[0]!.centroide, 'une reference saisie a la main merite aussi une position reelle');
  assert.equal(new URL(appels[0]!).searchParams.get('numero'), '0002');
});

test('ISSUE 3 : un identifiant qui ne designe rien ne renvoie rien', async () => {
  if (ignorer()) return;
  issue = { mode: 'vide' };
  const r = await rechercher('99001000ZT9999');
  assert.deepEqual(
    r,
    [],
    'le cadastre a repondu qu’aucune parcelle ne porte cet identifiant : l’interface doit afficher ' +
      '« Aucun resultat », et non une entree « a qualifier » qui affirmerait une existence que ' +
      'personne n’a verifiee.',
  );
  assert.equal(appels.length, 1, 'le cadastre doit avoir ete reellement interroge');
});

test('ISSUE 4 : cadastre injoignable — un resultat sans position, et qui le dit', async () => {
  if (ignorer()) return;
  issue = { mode: 'panne' };
  const r = await rechercher(IDU_INCONNUE);

  assert.equal(r.length, 1, 'le chemin degrade doit rester exploitable : la qualification est possible');
  const p = r[0]!;
  assert.equal(p.idu, IDU_INCONNUE);
  assert.equal(
    p.centroide,
    null,
    'la position est INCONNUE. Ce champ valait auparavant [0, 0] — le golfe de Guinee presente comme ' +
      'une position reelle, avec un sentinelle a reconnaitre dans les deux moities de l’application.',
  );
  assert.equal(p.bbox, null);
  assert.match(
    p.sousTitre ?? '',
    /injoignable/,
    'l’utilisateur doit savoir que l’existence de la parcelle n’a PAS ete verifiee',
  );
  assert.ok(appels.length >= 1, 'le cadastre doit avoir ete tente');
  assert.equal(await nbEnBase(IDU_INCONNUE), 0);
});
