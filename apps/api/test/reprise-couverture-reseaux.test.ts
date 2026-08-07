/**
 * La correction de l'audit 9 ne doit pas griser une instance déjà en service.
 *
 * POURQUOI CE FICHIER EXISTE. Il ne teste pas un défaut de l'application : il teste un défaut que
 * **ma propre correction a créé**, et la migration qui le répare.
 *
 * L'enchaînement. Le défaut A3 de l'audit 9 a établi qu'une distance au plus proche n'est une mesure
 * que si tous les départements traversés par le disque de recherche sont ingérés ;
 * `postesLesPlusProches` consulte donc `couverture_ingestion` avant de rendre une distance. Mais ces
 * lignes de couverture n'existaient pas avant l'audit — c'était la cause même du défaut — et elles
 * n'apparaissent qu'à la prochaine ingestion. Sur une instance où les postes sont ingérés depuis des
 * mois, **tous les critères de raccordement, les plus lourds du profil, passeraient au gris au
 * déploiement**, et resteraient gris jusqu'à ce que l'exploitant relance l'ingestion — sans qu'aucun
 * message ne le lui dise.
 *
 * Une correction de fiabilité qui dégrade silencieusement le critère principal n'est pas une
 * correction. La migration 015 déduit donc la couverture du contenu des tables, avec sa provenance
 * écrite dans `source_document` pour qu'une couverture déduite reste distinguable d'une couverture
 * constatée.
 *
 * Ce test rejoue le scénario complet sur le territoire fictif : postes présents, aucune couverture,
 * puis application du SQL de la migration, et vérification que la distance redevient une mesure. Le
 * SQL est lu dans le fichier de migration lui-même : c'est lui l'artefact testé, pas une copie.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { oublierPresenceCouches } from '../src/connecteurs/couches.js';
import { postesLesPlusProches, TYPE_COUVERTURE_POSTES } from '../src/connecteurs/locales.js';
import {
  creerCommunesFictives,
  DEPS_FICTIFS,
  PT,
  supprimerCommunesFictives,
  versEst,
  viderCouvertureFictive,
} from './aides/communes-fictives.js';

const PREFIXE = 'TEST-REPRISE-';

let baseDisponible = false;
let sqlMigration = '';

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM poste_source WHERE id LIKE $1`, [`${PREFIXE}%`]);
  await viderCouvertureFictive();
  oublierPresenceCouches();
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  sqlMigration = readFileSync(
    fileURLToPath(new URL('../../../db/migrations/015_reprise_couverture_reseaux.sql', import.meta.url)),
    'utf8',
  );
  try {
    await requete(`SELECT 1 FROM poste_source LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}.`,
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await nettoyer();
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test de reprise ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('la migration 015 est bien celle qui reprend la couverture des reseaux', () => {
  // Garde de cohesion : si la migration etait renumerotee ou son contenu deplace, le test ci-dessous
  // passerait a vide en executant un SQL sans rapport.
  assert.match(sqlMigration, /INSERT INTO couverture_ingestion/);
  assert.match(sqlMigration, /'postes_sources', 'poste_source'/);
  assert.match(sqlMigration, /'reseau_gaz', 'point_injection_gaz'/);
  assert.match(sqlMigration, /reprise migration 015/);
});

test('LE SCENARIO DE MISE A NIVEAU : un poste ingere sans couverture redevient exploitable', async () => {
  if (ignorer()) return;
  await nettoyer();

  // 1. L'etat d'une instance deja en service : un poste en base, aucune ligne de couverture.
  //    `code_departement` est vide, exactement comme le laissait l'ingestion d'avant l'audit.
  await requete(
    `INSERT INTO poste_source (id, nom, gestionnaire, tension, geom, capacite_residuelle_mw,
                               etat_saturation, connecteur, date_donnee)
     VALUES ($1, 'Poste historique', 'RTE', '63 kV',
             ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326), 20, 'disponible',
             'postes_sources', current_date)
     ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, code_departement = NULL`,
    [`${PREFIXE}historique`, PT[0] + versEst(1500), PT[1]],
  );

  // 2. Le comportement introduit par l'audit 9 sans reprise : la distance n'est pas rendue.
  assert.deepEqual(
    await postesLesPlusProches(PT, 4),
    [],
    "sans couverture, la distance n'est pas une mesure — c'est le comportement de l'audit 9",
  );

  // 3. La migration de reprise, executee telle qu'elle est ecrite dans le depot.
  await requete(sqlMigration);
  oublierPresenceCouches();

  // 4. Le rattachement spatial a fonctionne : le poste sait desormais dans quel departement il est.
  const rattache = await requete<{ code_departement: string | null }>(
    `SELECT code_departement FROM poste_source WHERE id = $1`,
    [`${PREFIXE}historique`],
  );
  assert.equal(
    rattache[0]?.code_departement,
    DEPS_FICTIFS[0],
    'la jointure spatiale doit rattacher le poste a sa commune',
  );

  // 5. Et la distance redevient une mesure, sans qu'aucune ingestion n'ait ete relancee.
  const postes = await postesLesPlusProches(PT, 4);
  assert.equal(postes.length, 1, 'apres reprise, le poste doit etre rendu');
  assert.ok(
    postes[0]!.distanceKm > 1.4 && postes[0]!.distanceKm < 1.6,
    `distance attendue ~1,5 km, obtenue ${postes[0]!.distanceKm}`,
  );
});

test('la couverture deduite est reconnaissable comme telle', async () => {
  if (ignorer()) return;
  // Une couverture DEDUITE du contenu n'a pas la meme valeur qu'une couverture CONSTATEE par une
  // ingestion : l'exploitant doit pouvoir faire la difference, sinon la reprise devient une
  // affirmation silencieuse — exactement ce que ces audits corrigent.
  const lignes = await requete<{ source_document: string | null }>(
    `SELECT source_document FROM couverture_ingestion
      WHERE type = $1 AND code_departement = ANY($2)`,
    [TYPE_COUVERTURE_POSTES, DEPS_FICTIFS],
  );
  assert.ok(lignes.length > 0, 'la reprise du test precedent doit avoir laisse une ligne');
  for (const l of lignes) {
    assert.match(l.source_document ?? '', /reprise migration 015/);
  }
});

test('la reprise est rejouable sans effet de bord', async () => {
  if (ignorer()) return;
  // Les migrations sont appliquees au demarrage du serveur, et la porte de sortie `--adopter` peut
  // les rejouer. Une reprise qui doublerait les lignes ou ecraserait une couverture constatee par une
  // ingestion posterieure serait un defaut a son tour.
  const avant = await requete<{ n: number; source_document: string | null }>(
    `SELECT count(*)::int AS n, min(source_document) AS source_document FROM couverture_ingestion
      WHERE type = $1 AND code_departement = ANY($2)`,
    [TYPE_COUVERTURE_POSTES, DEPS_FICTIFS],
  );
  // Une ingestion posterieure remplace la ligne deduite par une ligne constatee.
  await requete(
    `UPDATE couverture_ingestion SET source_document = NULL, nb_objets = 42
      WHERE type = $1 AND code_departement = ANY($2)`,
    [TYPE_COUVERTURE_POSTES, DEPS_FICTIFS],
  );

  await requete(sqlMigration);

  const apres = await requete<{ n: number; nb_objets: number; source_document: string | null }>(
    `SELECT count(*)::int AS n, min(nb_objets) AS nb_objets, min(source_document) AS source_document
       FROM couverture_ingestion WHERE type = $1 AND code_departement = ANY($2)`,
    [TYPE_COUVERTURE_POSTES, DEPS_FICTIFS],
  );
  assert.equal(apres[0]?.n, avant[0]?.n, 'aucune ligne ne doit etre ajoutee au second passage');
  assert.equal(
    apres[0]?.nb_objets,
    42,
    'une couverture constatee par une ingestion ne doit pas etre ecrasee par la reprise',
  );
  assert.equal(apres[0]?.source_document, null, 'la provenance constatee doit survivre');
});
