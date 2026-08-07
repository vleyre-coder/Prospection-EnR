/**
 * Une distance au plus proche n'est une mesure que si le disque qu'elle parcourt est ingere.
 *
 * POURQUOI CE FICHIER EXISTE — audit 9, defaut A3. L'audit 8 avait ferme le cas « la couche n'est
 * pas ingeree pour ce departement ». Il restait un cas voisin, et plus insidieux, propre a la
 * RECHERCHE DE PROXIMITE : chercher l'objet le plus proche d'un point revient a balayer un disque,
 * et ce disque ne s'arrete pas a la frontiere du departement de la parcelle. Mesure sur le
 * referentiel communal reel : le disque de 10 km autour d'un point de Beauce couvre deux
 * departements, celui de 60 km en couvre six.
 *
 * L'ingestion des postes sources, elle, parcourt les treize regions une par une et tolere l'echec de
 * l'une d'elles — elle enregistre alors le statut « partiel ». Si une region echoue, la table
 * contient toute la France sauf ses departements, et une parcelle voisine se voyait attribuer le
 * poste le plus proche de CEUX QUI RESTENT, a 60 ou 150 km. Cette distance etait notee comme une
 * mesure : la parcelle devenait rouge sur le critere le plus lourd du profil, pour un motif de
 * raccordement qui n'existe pas.
 *
 * C'est le defaut B1 de l'audit 8 retourne : non plus un faux VERT par absence de donnee, mais un
 * faux ROUGE par trou dans la donnee. Et il etait invisible, parce que le connecteur ne pouvait pas
 * ecrire de ligne de couverture : Capareseau ne publie pas le departement du poste, et l'ingestion
 * laissait `code_departement` vide.
 *
 * Le territoire de test est entierement fictif et place en pleine mer (voir
 * `aides/communes-fictives.ts`) : ces tests ne lisent ni n'ecrivent aucune donnee reelle, et ils
 * tournent donc a l'identique sur la base jetable de la CI, qui n'ingere pas les communes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { disqueEntierementCouvert, oublierPresenceCouches } from '../src/connecteurs/couches.js';
import { postesLesPlusProches, TYPE_COUVERTURE_POSTES } from '../src/connecteurs/locales.js';
import {
  creerCommunesFictives,
  declarerCouvertureFictive,
  DEP_LOCAL,
  DEP_VOISIN,
  PT,
  supprimerCommunesFictives,
  versEst,
  viderCouvertureFictive,
} from './aides/communes-fictives.js';

const PREFIXE_TEST = 'TEST-DISQUE-';

let baseDisponible = false;

async function declarer(dep: string): Promise<void> {
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, dep);
  oublierPresenceCouches();
}

async function vider(): Promise<void> {
  await viderCouvertureFictive();
  oublierPresenceCouches();
}

/** Insere un poste source fictif a `metres` du point de test, vers l'est. */
async function posteA(metres: number, suffixe: string): Promise<void> {
  await requete(
    `INSERT INTO poste_source (id, nom, gestionnaire, tension, geom, capacite_residuelle_mw,
                               etat_saturation, connecteur, date_donnee)
     VALUES ($1, $2, 'RTE', '63 kV', ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326), 20,
             'disponible', 'postes_sources', current_date)
     ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom`,
    [`${PREFIXE_TEST}${suffixe}`, `Poste de test ${suffixe}`, PT[0] + versEst(metres), PT[1]],
  );
}

async function supprimerPostes(): Promise<void> {
  await requete(`DELETE FROM poste_source WHERE id LIKE $1`, [`${PREFIXE_TEST}%`]);
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM commune LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await vider();
  await supprimerPostes();
});

after(async () => {
  if (baseDisponible) {
    await vider();
    await supprimerPostes();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test du disque ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('le territoire fictif a bien la geometrie que les tests supposent', async () => {
  if (ignorer()) return;
  // Sans cette verification, une erreur de fixture ferait passer tous les tests suivants pour la
  // mauvaise raison : « non couvert » parce que le voisin n'existe pas, plutot que parce qu'il
  // n'est pas declare.
  const deux = await requete<{ code_departement: string }>(
    `SELECT code_departement FROM commune
      WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326), $3)
      GROUP BY code_departement ORDER BY code_departement`,
    [PT[0], PT[1], versEst(10000)],
  );
  assert.deepEqual(
    deux.map((l) => l.code_departement),
    [DEP_VOISIN, DEP_LOCAL],
    'le disque de 10 km doit traverser les deux departements fictifs',
  );
  const un = await requete<{ code_departement: string }>(
    `SELECT code_departement FROM commune
      WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326), $3)
      GROUP BY code_departement`,
    [PT[0], PT[1], versEst(2000)],
  );
  assert.deepEqual(
    un.map((l) => l.code_departement),
    [DEP_LOCAL],
    'le disque de 2 km doit rester dans le departement local',
  );
});

test('un disque tenant dans un seul departement couvert est couvert', async () => {
  if (ignorer()) return;
  await vider();
  await declarer(DEP_LOCAL);
  assert.equal(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, PT, 2000), true);
});

test('un disque qui franchit une frontiere vers un departement non ingere ne l est pas', async () => {
  if (ignorer()) return;
  await vider();
  await declarer(DEP_LOCAL);
  // 10 km depuis ce point touchent le departement voisin, non declare : la reponse « c'est le plus
  // proche » engagerait une donnee qu'on n'a pas.
  assert.equal(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, PT, 10000), false);
  await declarer(DEP_VOISIN);
  assert.equal(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, PT, 10000), true);
});

test('aucune couverture du tout : rien n est couvert', async () => {
  if (ignorer()) return;
  await vider();
  assert.equal(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, PT, 2000), false);
});

test('un poste proche dans un departement couvert est rendu', async () => {
  if (ignorer()) return;
  await vider();
  await supprimerPostes();
  await declarer(DEP_LOCAL);
  await posteA(1500, 'proche');
  const postes = await postesLesPlusProches(PT, 4);
  assert.equal(postes.length, 1, 'le poste declare et couvert doit etre rendu');
  assert.ok(
    postes[0]!.distanceKm > 1.4 && postes[0]!.distanceKm < 1.6,
    `distance attendue ~1,5 km, obtenue ${postes[0]!.distanceKm}`,
  );
});

test('LE CAS DU FAUX ROUGE : un poste lointain hors des departements ingeres n est pas rendu', async () => {
  if (ignorer()) return;
  await vider();
  await supprimerPostes();
  await declarer(DEP_LOCAL);
  // Le seul poste de la base est a 30 km, donc au-dela de la frontiere, dans un departement non
  // declare. Avant correction, il devenait « le poste le plus proche, a 30 km » et le critere de
  // raccordement virait la parcelle au rouge sur une donnee absente.
  await posteA(30000, 'lointain');
  assert.deepEqual(
    await postesLesPlusProches(PT, 4),
    [],
    'une distance mesuree sur un disque partiellement ingere ne doit pas etre rendue',
  );

  // Et la meme distance redevient exploitable des que tout le disque est declare : le mecanisme
  // n'est pas un refus des grandes distances, mais un controle de la donnee.
  await declarer(DEP_VOISIN);
  const apres = await postesLesPlusProches(PT, 4);
  assert.equal(apres.length, 1, 'disque entierement couvert : la distance est une mesure');
  assert.ok(
    apres[0]!.distanceKm > 29 && apres[0]!.distanceKm < 31,
    `distance attendue ~30 km, obtenue ${apres[0]!.distanceKm}`,
  );
});

test('un poste dans un departement non couvert reste invisible meme proche', async () => {
  if (ignorer()) return;
  await vider();
  await supprimerPostes();
  // Aucun departement declare : meme un poste a 1,5 km ne suffit pas, car on ne sait pas si la
  // couche a ete ingeree ici. C'est la difference entre « pas de poste » et « pas regarde ».
  await posteA(1500, 'proche');
  assert.deepEqual(await postesLesPlusProches(PT, 4), []);
});

/**
 * « On a regardé ici » n'est pas « on a trouvé quelque chose ici » — risque F4 de l'audit 9.
 *
 * La couverture des postes était déduite des postes OBSERVÉS. Un département réellement dépourvu de
 * poste source n'aurait donc porté aucune ligne, et le contrôle du disque aurait grisé le critère de
 * raccordement de toutes les parcelles à portée de sa frontière — pour une donnée qui, elle, était
 * bien complète. L'ingestion pose désormais la couverture sur les départements des régions
 * effectivement téléchargées, comptage nul compris, et la lecture ne conditionne plus le verdict à un
 * comptage non nul.
 */
test('une couverture a comptage nul vaut « regarde », pas « inconnu »', async () => {
  if (ignorer()) return;
  await vider();
  await supprimerPostes();
  // Le departement voisin est declare AVEC ZERO objet : c'est le cas d'une region telechargee dont un
  // departement n'a effectivement aucun poste.
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_LOCAL, 3);
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_VOISIN, 0);
  oublierPresenceCouches();

  assert.equal(
    await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, PT, 10000),
    true,
    'un departement declare sans aucun poste reste un departement REGARDE',
  );

  // Et la distance mesuree redevient exploitable, alors qu'elle traverse ce departement.
  await posteA(1500, 'proche');
  const postes = await postesLesPlusProches(PT, 4);
  assert.equal(postes.length, 1, 'la distance doit etre rendue');
});
