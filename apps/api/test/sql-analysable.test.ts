/**
 * Tout le SQL du projet doit être analysable par PostgreSQL, y compris celui qu'aucun test n'atteint.
 *
 * POURQUOI CE FICHIER EXISTE. Les requêtes d'ingestion ne s'exécutent qu'après un téléchargement
 * réseau de plusieurs minutes — 1,09 million d'objets pour les ZAER. Une faute de syntaxe y reste donc
 * invisible jusqu'à ce qu'une ingestion réelle échoue, très loin de la modification qui l'a causée.
 * Ce n'est pas une hypothèse : au cours de ces audits, **une apostrophe inversée placée dans un
 * commentaire SQL a cassé trois fois le littéral qui la contenait** — deux fois avec une erreur de
 * compilation TypeScript, une fois sans, parce qu'elle terminait le gabarit sur une frontière
 * syntaxiquement valide.
 *
 * Le garde demande à PostgreSQL d'ANALYSER chaque littéral SQL du projet, sans l'exécuter, par
 * `PREPARE`. C'est le seul juge qui compte : ni le typage TypeScript ni la relecture ne voient une
 * parenthèse manquante dans une chaîne de caractères.
 *
 * CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS. Seules les erreurs de SYNTAXE sont retenues
 * (`42601`), et les colonnes ou tables inconnues (`42703`, `42P01`), qui sont des fautes tout aussi
 * réelles. Les échecs d'inférence de type de paramètre (`42P18`) sont ignorés : ils dépendent du
 * contexte d'appel, pas de la justesse de la requête. Le garde est donc strict sur ce qu'il affirme
 * et muet sur le reste — un test qui échoue au hasard serait pire qu'un test absent.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/bdd.js';

/** Codes d'erreur PostgreSQL qui designent une requete reellement fautive. */
const FAUTES = new Set([
  '42601', // syntaxe
  '42703', // colonne inconnue
  '42P01', // table inconnue
  '42883', // fonction inconnue
]);

let baseDisponible = false;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    const c = await pool.connect();
    c.release();
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ce test ne doit pas passer a vide.',
      { cause: err },
    );
  }
  baseDisponible = true;
});

after(async () => {
  await pool.end().catch(() => undefined);
});

/** Litteraux SQL du projet, avec leur origine, pour que le message d'echec soit exploitable. */
async function litterauxSql(): Promise<Array<{ fichier: string; sql: string }>> {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = fileURLToPath(new URL('../src/', import.meta.url));

  function fichiers(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) return fichiers(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  }

  const out: Array<{ fichier: string; sql: string }> = [];
  for (const f of fichiers(racine)) {
    const source = readFileSync(f, 'utf8');
    for (const brut of source.match(/`[^`]*`/g) ?? []) {
      const sql = brut.slice(1, -1);
      // Une requete construite par interpolation ne peut pas etre analysee telle quelle : le
      // fragment interpole manque. Ces requetes sont couvertes par les tests qui les executent.
      if (sql.includes('${')) continue;
      const debut = sql.replace(/^\s*(--[^\n]*\n\s*)*/, '').slice(0, 12).toUpperCase();
      if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/.test(debut)) continue;
      /**
       * Ecarter les MENTIONS de SQL dans la prose des commentaires.
       *
       * Trouve en executant ce garde pour la premiere fois : il signalait trois « erreurs de syntaxe »
       * dans `disparus.ts`, qui etaient les mots `DELETE` cites entre apostrophes inversees dans ses
       * commentaires. Un garde qui signale sa propre documentation ne serait pas lu longtemps. Une
       * requete reelle du projet tient sur plusieurs lignes ou depasse quarante caracteres ; une
       * mention en prose, non.
       */
      if (!/\s/.test(sql.trim())) continue;
      if (!sql.includes('\n') && sql.trim().length < 40) continue;
      out.push({ fichier: f.slice(racine.length), sql });
    }
  }
  return out;
}

test('tout litteral SQL est analysable par PostgreSQL', async () => {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : analyse SQL ignoree (DATABASE_URL requis)\n');
    return;
  }
  const litteraux = await litterauxSql();
  // Un garde qui n'inspecte rien ne protege rien : le projet contient des dizaines de requetes.
  assert.ok(
    litteraux.length >= 30,
    `attendu au moins 30 litteraux SQL, trouve ${litteraux.length} — le motif d'extraction ne ` +
      'correspond plus au code',
  );

  const fautifs: string[] = [];
  const client = await pool.connect();
  try {
    for (const [i, l] of litteraux.entries()) {
      try {
        // `PREPARE` analyse et planifie sans executer. Chaque nom est unique, et la transaction est
        // annulee ensuite : rien n'est laisse derriere.
        await client.query('BEGIN');
        await client.query(`PREPARE analyse_${i} AS ${l.sql}`);
        await client.query('ROLLBACK');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = (err as { code?: string }).code ?? '';
        if (FAUTES.has(code)) {
          fautifs.push(
            `${l.fichier} [${code}] ${(err as Error).message}\n    ${l.sql.slice(0, 160).replace(/\s+/g, ' ')}`,
          );
        }
      }
    }
  } finally {
    client.release();
  }

  assert.deepEqual(
    fautifs,
    [],
    `${fautifs.length} requete(s) refusee(s) par PostgreSQL :\n  ${fautifs.join('\n  ')}`,
  );
});
