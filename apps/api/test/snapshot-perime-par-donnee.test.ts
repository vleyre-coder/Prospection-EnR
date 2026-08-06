/**
 * Un snapshot vieillit aussi par l'arrivee de la donnee, et pas seulement par son age.
 *
 * POURQUOI CE FICHIER EXISTE — audit 9, defaut A2. Le moteur de scoring ne lit jamais les couches
 * ingerees : il lit le SNAPSHOT, fige au moment de l'enrichissement. Deux mecanismes seulement le
 * renouvelaient, et aucun des deux ne pouvait voir un changement de donnee :
 *
 *   - `snapshotPerime` regarde l'AGE, 30 jours par defaut. Une ingestion faite ce matin ne rend pas
 *     plus vieux un snapshot d'hier.
 *   - `VERSION_MOTEUR` empreinte le code, le referentiel reglementaire et les baremes. Son propre
 *     commentaire precise qu'elle ne couvre pas la donnee. Le rescoring qu'elle declenche relit le
 *     meme snapshot perime et reproduit donc la meme valeur, fidelement.
 *
 * Mesure faite sur la base de developpement : 438 parcelles du departement 28 portaient un snapshot
 * de 11 h 48, les sites classes et inscrits ont ete ingeres a 19 h 38 — huit heures plus tard — et
 * rien dans l'application ne pouvait le detecter.
 *
 * Le sens de l'erreur n'est pas toujours prudent, et c'est ce qui rend le defaut grave. Un snapshot
 * pris AVANT l'arrivee d'une couche dit « inconnu », ce qui est honnete. Mais un snapshot pris quand
 * la couche existait deja dit `recouvre: false` — une absence CONSTATEE — et un site nouvellement
 * classe, une ZAER nouvellement deliberee ou un poste source nouvellement construit ne seront jamais
 * vus : une parcelle devenue redhibitoire reste verte.
 *
 * `idusARafraichir` etait par ailleurs appelee par PERSONNE. Son commentaire annonçait « pour les
 * jobs de rafraichissement » et ces jobs n'existaient pas : c'etait le quatrieme mecanisme du projet
 * ecrit puis oublie. Ces tests exercent donc les deux : la detection, et la selection du lot.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import {
  idusARafraichir,
  nbARafraichir,
  oublierDatesIngestion,
  snapshotDepasseParDonnee,
  snapshotPerime,
} from '../src/depots/parcelles.js';
import { DEP_LOCAL, PT, versEst } from './aides/communes-fictives.js';

const IDU = '99001000AA0001';
const INSEE = '99001';

let baseDisponible = false;

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM parcelle WHERE code_departement = $1`, [DEP_LOCAL]);
  await requete(`DELETE FROM couverture_ingestion WHERE code_departement = $1`, [DEP_LOCAL]);
  oublierDatesIngestion();
}

/** Cree la parcelle de test et son snapshot, horodate a `dateSnapshot`. */
async function parcelleAvecSnapshot(dateSnapshot: string): Promise<void> {
  await requete(
    `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                           contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation)
     VALUES ($1, $2, 'Commune fictive', $3, '000', 'AA', '1', 50000, 50000,
             ST_Multi(ST_MakeEnvelope($4::float8, $5::float8, $6::float8, $7::float8, 4326)),
             ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326), current_date)
     ON CONFLICT (idu) DO NOTHING`,
    [IDU, INSEE, DEP_LOCAL, PT[0], PT[1], PT[0] + versEst(200), PT[1] + 0.002],
  );
  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture, date_snapshot)
     VALUES ($1, '{}'::jsonb, ARRAY[]::text[], 1, $2::timestamptz)
     ON CONFLICT (idu) DO UPDATE SET date_snapshot = EXCLUDED.date_snapshot`,
    [IDU, dateSnapshot],
  );
}

/** Declare une ingestion dans le departement de la parcelle, horodatee a `date`. */
async function ingestionA(date: string): Promise<void> {
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets, date_ingestion)
     VALUES ('patrimoine_sites', 'site_classe', $1, 12, $2::timestamptz)
     ON CONFLICT (connecteur, type, code_departement)
       DO UPDATE SET date_ingestion = EXCLUDED.date_ingestion`,
    [DEP_LOCAL, date],
  );
  oublierDatesIngestion();
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM parcelle_snapshot LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await nettoyer();
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test de peremption ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('sans aucune ingestion declaree, un snapshot recent n est pas depasse', async () => {
  if (ignorer()) return;
  await nettoyer();
  assert.equal(await snapshotDepasseParDonnee(new Date().toISOString(), DEP_LOCAL), false);
});

test('une ingestion ANTERIEURE au snapshot ne le perime pas', async () => {
  if (ignorer()) return;
  await nettoyer();
  await ingestionA('2026-01-01T00:00:00Z');
  assert.equal(await snapshotDepasseParDonnee('2026-06-01T00:00:00Z', DEP_LOCAL), false);
});

test('une ingestion POSTERIEURE au snapshot le perime', async () => {
  if (ignorer()) return;
  await nettoyer();
  await ingestionA('2026-06-01T00:00:00Z');
  // Le cas mesure : huit heures d'ecart, un snapshot que l'age declare parfaitement valide.
  const snapshot = '2026-05-31T16:00:00Z';
  assert.equal(
    snapshotPerime(snapshot),
    true,
    'ce snapshot est aussi perime par l’age a la date des tests — le cas suivant isole la donnee',
  );
  assert.equal(await snapshotDepasseParDonnee(snapshot, DEP_LOCAL), true);
});

test('LE CAS MESURE : un snapshot de ce jour, une ingestion huit heures plus tard', async () => {
  if (ignorer()) return;
  await nettoyer();
  const snapshot = new Date(Date.now() - 9 * 3600 * 1000).toISOString();
  const ingestion = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
  await ingestionA(ingestion);

  // L'age ne voit rien : neuf heures, contre un seuil de trente jours.
  assert.equal(snapshotPerime(snapshot), false, 'la regle d’age ne peut pas voir ce retard');
  // La donnee, si.
  assert.equal(await snapshotDepasseParDonnee(snapshot, DEP_LOCAL), true);
});

test('une parcelle sans departement ne peut pas etre comparee a une ingestion', async () => {
  if (ignorer()) return;
  await nettoyer();
  await ingestionA(new Date().toISOString());
  // Prudence : sans departement, aucune ligne de couverture n'est comparable. On ne declare pas
  // perime ce qu'on ne sait pas situer — le rafraichissement viendra de la regle d'age.
  assert.equal(await snapshotDepasseParDonnee(new Date().toISOString(), null), false);
});

test('LE LOT A RAFRAICHIR retient la parcelle en retard sur la donnee', async () => {
  if (ignorer()) return;
  await nettoyer();
  /**
   * Snapshot de vingt jours : parfaitement valide au sens de l'age, dont le seuil est de trente
   * jours. Vingt et non neuf heures pour une raison de robustesse, apprise en executant ce test :
   * `idusARafraichir` classe les parcelles les plus en retard d'abord et borne le lot, et la base de
   * developpement contenait 438 parcelles dont le snapshot datait de la meme journee. Notre parcelle
   * arrivait donc au rang 380 et sortait du lot de 100 — un echec qui ne disait rien du code teste.
   * Une date nettement anterieure la place en tete quelle que soit la population presente.
   */
  await parcelleAvecSnapshot(new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString());

  // Aucune ingestion : la parcelle n'a rien a rafraichir.
  const avant = await idusARafraichir(5000);
  assert.equal(avant.includes(IDU), false, 'sans ingestion, la parcelle est a jour');
  const compteAvant = await nbARafraichir();

  // Ingestion posterieure au snapshot : la parcelle doit entrer dans le lot.
  await ingestionA(new Date(Date.now() - 1 * 3600 * 1000).toISOString());
  const apres = await idusARafraichir(5000);
  assert.equal(
    apres.includes(IDU),
    true,
    'apres une ingestion dans son departement, la parcelle doit etre reprise',
  );
  assert.equal(
    await nbARafraichir(),
    compteAvant + 1,
    'le compteur expose par /api/sante doit suivre exactement la population traitee',
  );
});
