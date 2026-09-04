/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PROPOSER ET AFFIRMER NE DEMANDENT PAS LE MEME NIVEAU DE PREUVE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE LA MESURE A MONTRE. L'ingestion des zones d'acceleration n'inserait une ZAER
 * photovoltaique que si son attribut `detail_filiere1` disait explicitement « SOL ». L'intention
 * etait juste — 58 % des ZAER PV echantillonnees au national sont des TOITURES, et faire passer une
 * toiture pour un terrain serait un contresens. Mais la completude de cet attribut depend de la
 * facon dont chaque collectivite a redige sa deliberation :
 *
 *     detail_filiere1 des ZAER SOLAIRE_PV     national (5 000)   Eure-et-Loir (5 000)
 *     TOIT                                          2 890                  284
 *     SOL                                             827                   21
 *     OMBRIERE                                        640                    3
 *     (vide)                                          507                4 656
 *     AUTRE                                           136                   36
 *
 * Dans le 28, 93 % des ZAER PV n'ont AUCUN detail : la regle les ecartait toutes. L'ingestion du
 * departement retenait 799 zones sur 10 650, et le seul signe visible etait une ligne de journal.
 * L'application etait aveugle precisement la ou la source est moins precise, et elle ne le disait
 * pas. Apres correction : 7 664 zones, soit 9,6 fois plus.
 *
 * MAIS LA CORRECTION NE DOIT PAS SE PAYER EN AFFIRMATIONS. Une zone dont on ignore le type
 * d'implantation est une PISTE : la commune a designe ce terrain pour du photovoltaique sans dire
 * comment. Elle n'est PAS un argument reglementaire : ecrire « cette parcelle est en zone
 * d'acceleration » alors que la zone pourrait ne viser que des toitures ferait monter un score sur
 * une supposition.
 *
 * Ce fichier tient les deux bouts : la zone entre en base, et le critere de scoring l'ignore.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { implantationPv, filieresZaer } from '../src/ingestion/wfs-national.js';
import { zaer } from '../src/connecteurs/locales.js';
import { pool, requete } from '../src/bdd.js';
import {
  creerCommunesFictives,
  supprimerCommunesFictives,
  DEP_LOCAL,
  INSEE_LOCAL,
  PT,
} from './aides/communes-fictives.js';

const SANS_BASE = !process.env['DATABASE_URL'];
const MARQUE = 'essai-implantation/';

// --------------------------------------------------------------------------- lecture du vocabulaire

test('le detail d’implantation se lit en TROIS etats, pas deux', () => {
  // C'est la distinction qui manquait : « la deliberation dit toiture » et « la deliberation ne dit
  // rien » recevaient le meme traitement.
  assert.equal(implantationPv('SOL'), 'sol');
  assert.equal(implantationPv('SURFACE'), 'sol');
  assert.equal(implantationPv('TOIT'), 'hors_foncier');
  assert.equal(implantationPv('OMBRIERE'), 'hors_foncier');
  assert.equal(implantationPv(''), 'inconnue');
  assert.equal(implantationPv(null), 'inconnue');
  assert.equal(implantationPv('AUTRE'), 'inconnue');
});

test('la casse et les espaces de la source ne changent pas la lecture', () => {
  // Le vocabulaire vient de 1 089 671 deliberations redigees par autant de collectivites : la
  // normalisation n'est pas une precaution de style.
  assert.equal(implantationPv(' sol '), 'sol');
  assert.equal(implantationPv('Toit'), 'hors_foncier');
});

test('une ZAER photovoltaique sans detail est RETENUE, une toiture non', () => {
  assert.deepEqual(filieresZaer('SOLAIRE_PV', ''), ['solaire_sol']);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'AUTRE'), ['solaire_sol']);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'SOL'), ['solaire_sol']);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'TOIT'), []);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'OMBRIERE'), []);
});

test('les filieres hors perimetre restent ecartees', () => {
  // La correction ne doit pas devenir une porte ouverte : la geothermie et l'hydroelectricite sont
  // des filieres reelles, mais l'application n'en traite aucune.
  assert.deepEqual(filieresZaer('GEOTHERMIE', ''), []);
  assert.deepEqual(filieresZaer('HYDROELECTRICITE', 'SOL'), []);
  assert.deepEqual(filieresZaer('EOLIEN', ''), ['eolien_terrestre']);
  assert.deepEqual(filieresZaer('BIOMETHANE', ''), ['methanisation']);
});

// --------------------------------------------------------------------------- effet sur le scoring

before(async () => {
  if (SANS_BASE) return;
  await creerCommunesFictives();
  await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}%`]);
  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces)
     VALUES ('zaer_local', '[essai] zaer', 'api') ON CONFLICT (connecteur) DO NOTHING`,
  );
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ('zaer_local', 'zaer', $1, 1)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET nb_objets = 1`,
    [DEP_LOCAL],
  );
});

after(async () => {
  if (SANS_BASE) return;
  await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}%`]);
  await requete(`DELETE FROM couverture_ingestion WHERE code_departement = $1`, [DEP_LOCAL]);
  await supprimerCommunesFictives();
  await pool.end();
});

/** Pose une ZAER couvrant le point de test, precisee ou non. */
async function poserZone(precisee: boolean): Promise<void> {
  await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}%`]);
  const d = 0.01;
  await requete(
    `INSERT INTO zaer (identifiant_source, code_insee, code_departement, filieres, geom,
                       est_demonstration, implantation_precisee, source_document)
     VALUES ($1, $2, $3, ARRAY['solaire_sol']::text[],
             ST_Multi(ST_MakeEnvelope($4::float8, $5::float8, $6::float8, $7::float8, 4326)),
             false, $8, 'essai')`,
    [
      `${MARQUE}${precisee ? 'precisee' : 'inconnue'}`,
      INSEE_LOCAL,
      DEP_LOCAL,
      PT[0] - d,
      PT[1] - d,
      PT[0] + d,
      PT[1] + d,
      precisee,
    ],
  );
}

test('une zone CONFIRMEE au sol vaut l’argument reglementaire', { skip: SANS_BASE }, async () => {
  await poserZone(true);
  const r = await zaer(PT, DEP_LOCAL);
  assert.equal(r.present, true, 'une ZAER confirmee au sol doit etre vue par le critere');
  assert.ok(r.filieres.includes('solaire_sol'));
});

test('une zone dont l’implantation est INCONNUE ne vaut aucun argument', { skip: SANS_BASE }, async () => {
  /*
   * C'est la ligne qui separe « proposer » de « affirmer ». La zone existe, elle est proposee a la
   * prospection par `zonesAProspecter` — et le critere doit repondre « pas de ZAER ici », parce
   * qu'il n'a AUCUN moyen de savoir si la deliberation visait un terrain ou un toit.
   */
  await poserZone(false);
  const r = await zaer(PT, DEP_LOCAL);
  assert.equal(
    r.present,
    false,
    'une ZAER a implantation inconnue ne doit pas faire dire « parcelle en zone d’acceleration »',
  );
  assert.deepEqual(r.filieres, []);
});
