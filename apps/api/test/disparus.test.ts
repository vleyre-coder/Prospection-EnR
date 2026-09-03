/**
 * Effacer ce qui a disparu de la source, et refuser de le faire quand on n'en est pas sûr.
 *
 * POURQUOI CE FICHIER EXISTE — audit 9, défaut D1. Aucune ingestion ne contenait de `DELETE` : un
 * objet retiré de la source restait en base indéfiniment et continuait d'être affirmé. Un site
 * déclassé restait un site classé, une délibération de ZAER annulée restait une ZAER — et les
 * communes révisent régulièrement leurs délibérations.
 *
 * LA PARTIE RISQUÉE N'EST PAS LA SUPPRESSION, C'EST LE DROIT DE SUPPRIMER. Une suppression mal gardée
 * est pire que le défaut qu'elle corrige : elle transforme une source momentanément dégradée en
 * effacement d'une couche entière — c'est-à-dire exactement la famille de fautes que ces audits
 * corrigent depuis huit itérations, affirmer une absence qu'on n'a pas constatée. Ce fichier teste
 * donc d'abord la PORTE, branche par branche, puis la suppression elle-même contre PostgreSQL.
 *
 * Ce qui n'est pas couvert ici, et qui doit l'être par une exécution réelle : la fiabilité du signal
 * de complétude remonté par le générateur WFS. Le test vérifie que `complete: false` interdit toute
 * suppression ; il ne peut pas vérifier que la Géoplateforme ne ment pas sur sa dernière page. C'est
 * la raison du plafond de volumétrie, qui ne dépend d'aucun signal externe.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import {
  conditionCible,
  effacerDisparus,
  PART_SUPPRESSION_MAX,
  suppressionAutorisee,
} from '../src/ingestion/disparus.js';
import { DEP_LOCAL } from './aides/communes-fictives.js';

// ---------------------------------------------------------------------------
// La porte : fonction pure, testée branche par branche, sans base ni réseau
// ---------------------------------------------------------------------------

test('une pagination incomplete interdit toute suppression', () => {
  const d = suppressionAutorisee({ complete: false, nbEnBase: 1000, nbDisparus: 1 });
  assert.equal(d.autorisee, false);
  assert.match(d.motif, /incomplete/);
});

test('aucun objet disparu : la suppression est autorisee et sans effet', () => {
  const d = suppressionAutorisee({ complete: true, nbEnBase: 1000, nbDisparus: 0 });
  assert.equal(d.autorisee, true);
});

test('une base vide apres ingestion est un etat anormal, pas une autorisation', () => {
  // Le cas qui viderait tout : la source repond, la pagination se declare complete, et pourtant
  // rien n'a ete insere. Autoriser la suppression reviendrait a effacer la couche entiere.
  const d = suppressionAutorisee({ complete: true, nbEnBase: 0, nbDisparus: 5000 });
  assert.equal(d.autorisee, false);
  assert.match(d.motif, /anormal/);
});

test('une part disparue sous le plafond est autorisee', () => {
  // 10 % sur 1 000 objets : une revision plausible.
  const d = suppressionAutorisee({ complete: true, nbEnBase: 1000, nbDisparus: 100 });
  assert.equal(d.autorisee, true);
  assert.match(d.motif, /10 %/);
});

test('une part disparue au-dela du plafond est refusee, avec son chiffre', () => {
  // 30 % : une source tronquee est plus probable qu'une revision de cette ampleur.
  const d = suppressionAutorisee({ complete: true, nbEnBase: 1000, nbDisparus: 300 });
  assert.equal(d.autorisee, false);
  assert.match(d.motif, /30 %/);
  assert.match(d.motif, /plafond/);
});

test('le plafond est exactement a la valeur annoncee, et la borne est stricte', () => {
  // Le seuil se lit dans la documentation d'exploitation : il ne doit pas deriver en silence.
  assert.equal(PART_SUPPRESSION_MAX, 0.2);
  // Pile au plafond : autorise. Un objet de plus : refuse.
  assert.equal(suppressionAutorisee({ complete: true, nbEnBase: 1000, nbDisparus: 200 }).autorisee, true);
  assert.equal(suppressionAutorisee({ complete: true, nbEnBase: 1000, nbDisparus: 201 }).autorisee, false);
});

// ---------------------------------------------------------------------------
// La suppression, contre PostgreSQL
// ---------------------------------------------------------------------------

/**
 * CONNECTEUR DEDIE AU TEST, cree puis supprime.
 *
 * Premiere version : le connecteur reel `patrimoine_sites`, avec un type et un departement fictifs.
 * La verification l'a immediatement pris en defaut, et pour une raison qui compte. Le garde-fou de
 * volumetrie raisonne sur TOUT le connecteur, ce qui est le comportement juste — mais la base
 * contenait 6 617 sites reels, si bien que les 18 objets « disparus » du test representaient 0,27 %
 * et non 90 % : la suppression etait autorisee, et le scenario teste n'etait plus celui qu'on
 * croyait. Un test qui partage sa population avec les donnees reelles ne peut pas tester un seuil.
 */
const CONNECTEUR = 'test_disparus';
const TYPE = 'site_classe';
/** Territoire fictif PARTAGE : importe, pour passer par le garde de serialisation (audit 11). */
const DEP = DEP_LOCAL;
const PREFIXE = 'TEST-DISPARUS-';

let baseDisponible = false;

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM contrainte WHERE connecteur = $1`, [CONNECTEUR]);
  await requete(`DELETE FROM contrainte WHERE identifiant_source LIKE $1`, [`${PREFIXE}%`]);
}

/** Insere `n` objets, dont les `anciens` premiers portent une date de revue ancienne. */
async function inserer(n: number, anciens: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await requete(
      `INSERT INTO contrainte (type, nom, identifiant_source, geom, connecteur, code_departement,
                               date_donnee, updated_at)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4::float8, 47.0), 4326), $5, $6, current_date, $7)
       ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [
        TYPE,
        `Site de test ${i}`,
        `${PREFIXE}${i}`,
        -6.5 + i * 0.001,
        CONNECTEUR,
        DEP,
        // Les « anciens » n'ont pas ete revus par l'execution simulee ; les autres l'ont ete.
        i < anciens ? new Date('2020-01-01T00:00:00Z') : new Date(),
      ],
    );
  }
}

async function compter(): Promise<number> {
  const l = await requete<{ n: number }>(
    `SELECT count(*)::int AS n FROM contrainte WHERE identifiant_source LIKE $1`,
    [`${PREFIXE}%`],
  );
  return l[0]?.n ?? 0;
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT updated_at FROM contrainte LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la colonne updated_at est absente ou la base injoignable : ` +
        `${(err as Error).message}. Appliquer la migration 014.`,
      { cause: err },
    );
  }
  baseDisponible = true;
  // Le connecteur de test doit exister : `contrainte.connecteur` porte une cle etrangere.
  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces) VALUES ($1, 'Connecteur de test', 'ingestion')
     ON CONFLICT (connecteur) DO NOTHING`,
    [CONNECTEUR],
  );
  await nettoyer();
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await requete(`DELETE FROM source_donnee WHERE connecteur = $1`, [CONNECTEUR]);
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test des disparus ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('les objets non revus par une ingestion complete sont effaces', async () => {
  if (ignorer()) return;
  await nettoyer();
  // 20 objets dont 2 non revus : 10 %, sous le plafond.
  await inserer(20, 2);
  const debutRun = new Date(Date.now() - 60_000);
  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun, true);
  assert.equal(r.supprimes, 2, r.motif);
  assert.equal(await compter(), 18);
});

test('les objets non revus SURVIVENT a une ingestion incomplete', async () => {
  if (ignorer()) return;
  await nettoyer();
  await inserer(20, 2);
  const debutRun = new Date(Date.now() - 60_000);
  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun, false);
  assert.equal(r.supprimes, 0);
  assert.equal(await compter(), 20, 'une lecture partielle ne doit rien effacer');
});

test('LE GARDE-FOU : une disparition massive est refusee, et la couche reste intacte', async () => {
  if (ignorer()) return;
  await nettoyer();
  // 20 objets dont 18 non revus : 90 %. C'est le profil d'une source tronquee, pas d'une revision.
  await inserer(20, 18);
  const debutRun = new Date(Date.now() - 60_000);
  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun, true);
  assert.equal(r.supprimes, 0);
  assert.match(r.motif, /plafond/);
  assert.equal(await compter(), 20, 'aucun objet ne doit disparaitre sur un refus');
});

test('une ingestion qui a tout revu ne supprime rien', async () => {
  if (ignorer()) return;
  await nettoyer();
  await inserer(20, 0);
  const debutRun = new Date(Date.now() - 60_000);
  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun, true);
  assert.equal(r.supprimes, 0);
  assert.equal(await compter(), 20);
});

test('la suppression ne touche que le connecteur vise', async () => {
  if (ignorer()) return;
  await nettoyer();
  await inserer(20, 2);
  // Un objet d'un AUTRE connecteur, lui aussi non revu : il ne doit pas etre emporte.
  await requete(
    `INSERT INTO contrainte (type, nom, identifiant_source, geom, connecteur, code_departement,
                             date_donnee, updated_at)
     VALUES ('monument_historique', 'Temoin', $1, ST_SetSRID(ST_MakePoint(-6.4, 47.0), 4326),
             'patrimoine_sites', $2, current_date, '2020-01-01T00:00:00Z')
     ON CONFLICT (connecteur, type, identifiant_source) DO NOTHING`,
    [`${PREFIXE}temoin`, DEP],
  );
  const debutRun = new Date(Date.now() - 60_000);
  await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun, true);
  const temoin = await requete<{ n: number }>(
    `SELECT count(*)::int AS n FROM contrainte WHERE identifiant_source = $1`,
    [`${PREFIXE}temoin`],
  );
  assert.equal(temoin[0]?.n, 1, "l'objet d'un autre connecteur doit survivre");
});

/**
 * La cible `zaer` a sa propre condition, et elle doit épargner les zones de démonstration.
 *
 * `zaer` ne porte pas de colonne `connecteur` : le périmètre y est défini par
 * `est_demonstration = false`. C'est la branche la plus dangereuse du module — une erreur y
 * effacerait le jeu de démonstration, qui ne vient d'aucune source et ne peut donc pas en avoir
 * disparu.
 *
 * POURQUOI CE TEST NE VA PAS JUSQU'AU `DELETE`, et c'est un choix documenté. La première version
 * insérait deux ZAER, une réelle et une de démonstration, et vérifiait laquelle survivait. Elle a
 * échoué — pour une raison instructive : la base d'exécution contient 58 321 ZAER réelles dont
 * l'horodatage de revue précède l'exécution simulée, si bien que la part « disparue » atteignait
 * 100 % et que le garde-fou de volumétrie refusait, correctement, toute suppression. Rendre le
 * scénario observable aurait exigé soit de bousculer l'horodatage de 58 000 lignes réelles, soit de
 * les supprimer : un test n'a pas à faire cela. La condition étant PARTAGÉE par le comptage et par
 * le `DELETE`, la vérifier directement couvre exactement ce qui est en jeu.
 */
test('le perimetre des ZAER exclut les zones de demonstration', () => {
  const c = conditionCible({ table: 'zaer', connecteur: 'zaer_local' });
  assert.equal(c.where, 'est_demonstration = false');
  assert.deepEqual(c.params, [], 'la condition ZAER ne prend aucun parametre');
});

test('le perimetre de `contrainte` est le connecteur, et lui seul', () => {
  const c = conditionCible({ table: 'contrainte', connecteur: 'patrimoine_sites' });
  assert.equal(c.where, 'connecteur = $1');
  assert.deepEqual(c.params, ['patrimoine_sites']);
});
