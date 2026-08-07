/**
 * Le cycle complet d'effacement des objets disparus, observe de bout en bout — audit 10, risque F4.
 *
 * CE QUI MANQUAIT. `disparus.test.ts` verifie la DECISION (fonction pure) et l'EFFET (le `DELETE`
 * contre PostgreSQL) sur des lignes que le test insere lui-meme. C'est necessaire et ce n'est pas
 * suffisant, parce que le mecanisme repose sur un CONTRAT entre deux morceaux de code qui ne se
 * connaissent pas :
 *
 *   - `effacerDisparus` declare disparue toute ligne dont `updated_at` precede le debut du run ;
 *   - chaque ingestion doit donc, en reecrivant une ligne deja presente, remettre `updated_at` a
 *     `now()`.
 *
 * Le second membre du contrat n'etait verifie nulle part. Une ingestion qui l'oublie ne casse rien de
 * visible : elle inserera et mettra a jour normalement. Mais au run suivant, TOUTES ses lignes
 * paraitront disparues. Le plafond de volumetrie les sauvera — 100 % depasse les 20 % — donc rien ne
 * sera efface ; simplement, l'effacement ne fonctionnera JAMAIS pour ce connecteur, et un
 * avertissement tombera a chaque ingestion sans que sa cause soit lisible. Un mecanisme de securite
 * qui refuse toujours est indistinguable d'un mecanisme qui marche, jusqu'au jour ou l'on compte sur
 * lui.
 *
 * VERIFIE ICI EN CONSTATANT LE FAIT, pas en relisant le code : deux ingestions successives sont
 * simulees sur un connecteur dedie, avec le vrai SQL de reecriture, et l'on observe qui survit.
 *
 * La verification a effectivement trouve un manquant : la reecriture du patrimoine CULTUREL
 * (`ingestion/index.ts`) ne remettait pas `updated_at`. Ce connecteur n'est pas encore soumis a
 * l'effacement, donc le defaut n'etait pas actif — c'etait un piege pose pour le jour ou on l'y
 * soumettrait. Corrige, et desormais garde par le test structurel de ce fichier.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, requete } from '../src/bdd.js';
import { effacerDisparus } from '../src/ingestion/disparus.js';

const CONNECTEUR = `test_cycle_${process.pid}`;
let baseDisponible = false;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete('SELECT 1');
    baseDisponible = true;
  } catch {
    baseDisponible = false;
  }
  if (baseDisponible) {
    await nettoyer();
    await preparer();
  }
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await pool.end().catch(() => undefined);
});

/**
 * Le connecteur doit exister dans `source_donnee` : `contrainte.connecteur` y est une cle etrangere.
 *
 * Un connecteur DEDIE, et nomme d'apres le processus. Deux raisons, apprises a l'audit 9 : le
 * plafond de volumetrie raisonne sur l'ensemble du connecteur, donc reutiliser un connecteur reel
 * noierait dix objets disparus dans des milliers de lignes et le garde-fou ne serait jamais atteint ;
 * et deux executions concurrentes du meme fichier se marcheraient dessus.
 */
async function preparer(): Promise<void> {
  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces)
     VALUES ($1, 'Connecteur de test — cycle d''effacement', 'ingestion')
     ON CONFLICT (connecteur) DO NOTHING`,
    [CONNECTEUR],
  );
}

async function nettoyer(): Promise<void> {
  await requete('DELETE FROM contrainte WHERE connecteur = $1', [CONNECTEUR]);
  await requete('DELETE FROM source_donnee WHERE connecteur = $1', [CONNECTEUR]);
}

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : cycle d’effacement non observe (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/**
 * Une « ingestion » : le VRAI motif de reecriture, celui des connecteurs soumis a l'effacement.
 *
 * La clause `DO UPDATE` est volontairement recopiee de `wfs-national.ts`, `updated_at = now()`
 * compris : ce test doit exercer le contrat, pas une version simplifiee qui le respecterait par
 * construction.
 */
async function ingerer(identifiants: number[]): Promise<void> {
  await requete(
    `INSERT INTO contrainte
       (type, sous_type, nom, identifiant_source, geom, attributs, connecteur, code_departement,
        date_donnee)
     SELECT 'site_classe', 'site_classe', 'objet ' || d.i, d.i::text,
            ST_SetSRID(ST_MakePoint(1.0 + d.i / 1000.0, 48.0), 4326),
            '{}'::jsonb, $2, '28', current_date
       FROM unnest($1::int[]) AS d(i)
     ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
       nom = EXCLUDED.nom,
       geom = EXCLUDED.geom,
       attributs = EXCLUDED.attributs,
       updated_at = now()`,
    [identifiants, CONNECTEUR],
  );
}

async function presents(): Promise<number[]> {
  const l = await requete<{ identifiant_source: string }>(
    'SELECT identifiant_source FROM contrainte WHERE connecteur = $1 ORDER BY identifiant_source::int',
    [CONNECTEUR],
  );
  return l.map((r) => Number(r.identifiant_source));
}

const suite = (n: number, depuis = 1): number[] => Array.from({ length: n }, (_, i) => depuis + i);

test('LE CYCLE COMPLET : deux ingestions successives, les objets retires de la source disparaissent', async () => {
  if (ignorer()) return;
  await requete('DELETE FROM contrainte WHERE connecteur = $1', [CONNECTEUR]);

  // --- Ingestion 1 : la source publie 100 objets.
  await ingerer(suite(100));
  assert.equal((await presents()).length, 100, 'la premiere ingestion doit poser 100 objets');

  /**
   * L'horodatage de debut du SECOND run, pris avant toute reecriture.
   *
   * `pg_sleep` d'un instant separe les deux runs : `now()` est fige pour toute une transaction, et
   * sans separation les deux ingestions porteraient le meme horodatage — le test passerait alors
   * pour une raison qui n'a rien a voir avec ce qu'il verifie.
   */
  await requete('SELECT pg_sleep(0.05)');
  const debutRun2 = (await requete<{ t: Date }>('SELECT now() AS t'))[0]!.t;
  await requete('SELECT pg_sleep(0.05)');

  // --- Ingestion 2 : la source n'en publie plus que 90. Les objets 91 a 100 ont disparu.
  await ingerer(suite(90));

  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun2, true);
  assert.equal(r.supprimes, 10, `10 objets auraient du etre effaces, ${r.supprimes} l'ont ete — ${r.motif}`);

  const restants = await presents();
  assert.deepEqual(restants, suite(90), 'les 90 objets republies doivent survivre, et eux seuls');
});

test('LE CONTRAT INVERSE : un objet REVU ne doit jamais etre pris pour disparu', async () => {
  /**
   * Le sens le plus dangereux du mecanisme, et celui que rien ne verifiait. Si la reecriture ne
   * remet pas `updated_at`, les 100 objets republies passent pour disparus.
   */
  if (ignorer()) return;
  await requete('DELETE FROM contrainte WHERE connecteur = $1', [CONNECTEUR]);

  await ingerer(suite(100));
  await requete('SELECT pg_sleep(0.05)');
  const debutRun2 = (await requete<{ t: Date }>('SELECT now() AS t'))[0]!.t;
  await requete('SELECT pg_sleep(0.05)');

  // La source republie EXACTEMENT les memes objets : rien n'a disparu.
  await ingerer(suite(100));

  const perimes = await requete<{ n: number }>(
    'SELECT count(*)::int AS n FROM contrainte WHERE connecteur = $1 AND updated_at < $2',
    [CONNECTEUR, debutRun2],
  );
  assert.equal(
    perimes[0]?.n,
    0,
    'aucun objet republie ne doit garder un updated_at anterieur au run : la reecriture ne rafraichit pas la date',
  );

  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun2, true);
  assert.equal(r.supprimes, 0, 'une ingestion qui republie tout ne doit rien effacer');
  assert.equal((await presents()).length, 100, 'la couche doit etre intacte');
});

test('LE GARDE-FOU EN CONDITIONS REELLES : une source qui s’effondre ne vide pas la couche', async () => {
  if (ignorer()) return;
  await requete('DELETE FROM contrainte WHERE connecteur = $1', [CONNECTEUR]);

  await ingerer(suite(100));
  await requete('SELECT pg_sleep(0.05)');
  const debutRun2 = (await requete<{ t: Date }>('SELECT now() AS t'))[0]!.t;
  await requete('SELECT pg_sleep(0.05)');

  // La source ne renvoie plus que 30 objets : 70 % de disparition. Bien plus probablement une panne
  // qu'une revision.
  await ingerer(suite(30));

  const r = await effacerDisparus({ table: 'contrainte', connecteur: CONNECTEUR }, debutRun2, true);
  assert.equal(r.supprimes, 0, 'une disparition de 70 % doit etre refusee');
  assert.match(r.motif, /plafond/, `le motif doit nommer le plafond : « ${r.motif} »`);
  assert.equal((await presents()).length, 100, 'la couche doit rester entiere');
});

test('LE GARDE STRUCTUREL : toute table soumise a l’effacement voit ses reecritures rafraichir updated_at', () => {
  /**
   * Le test le plus important du fichier, parce qu'il porte sur le code qui n'existe pas encore.
   *
   * Les trois tests precedents observent le cycle sur un connecteur d'essai. Ils ne diraient rien
   * d'une ingestion ajoutee demain qui oublierait `updated_at = now()` dans sa clause `DO UPDATE` —
   * or c'est exactement l'oubli qui a ete trouve sur le patrimoine culturel en ecrivant ce fichier.
   *
   * La regle verifiee est celle du contrat : dans TOUTE source d'ingestion, un `INSERT` sur une table
   * soumise a l'effacement, s'il comporte un `DO UPDATE SET`, doit y remettre `updated_at`. La regle
   * s'applique aussi aux tables pas encore soumises a l'effacement mais susceptibles de l'etre, car
   * c'est precisement la que le piege se pose.
   */
  const ici = dirname(fileURLToPath(import.meta.url));
  const dossier = resolve(ici, '../src/ingestion');
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.ts'));
  assert.ok(fichiers.length >= 3, `le dossier d’ingestion semble vide : ${fichiers.length} fichier(s)`);

  const TABLES = ['contrainte', 'zaer'];
  const fautes: string[] = [];
  let controles = 0;

  for (const f of fichiers) {
    const source = readFileSync(join(dossier, f), 'utf8');
    for (const table of TABLES) {
      // Chaque INSERT sur la table, jusqu'a la fin du litteral SQL qui le porte.
      const inserts = source.split(new RegExp(`INSERT\\s+INTO\\s+${table}\\b`)).slice(1);
      for (const apres of inserts) {
        const litteral = apres.split('`')[0] ?? '';
        if (!/DO\s+UPDATE\s+SET/i.test(litteral)) continue; // Insertion pure : rien a rafraichir.
        controles += 1;
        const clause = litteral.slice(litteral.search(/DO\s+UPDATE\s+SET/i));
        if (!/\bupdated_at\s*=\s*now\(\)/i.test(clause)) {
          fautes.push(`${f} : INSERT INTO ${table} ... DO UPDATE SET sans « updated_at = now() »`);
        }
      }
    }
  }

  assert.ok(
    controles >= 3,
    `${controles} reecriture(s) inspectee(s) : trop peu pour que ce garde prouve quoi que ce soit. ` +
      'Le decoupage des litteraux SQL a probablement cesse de fonctionner.',
  );
  assert.deepEqual(
    fautes,
    [],
    `Une reecriture ne marque pas ses lignes comme revues. Toute ligne non marquee sera comptee ` +
      `« disparue de la source » au run suivant.\n${fautes.join('\n')}`,
  );
});
