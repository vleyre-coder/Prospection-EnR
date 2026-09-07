/**
 * Recalcule le potentiel communal, pour toutes les filieres ou celles nommees.
 *
 *   npm run potentiel -w @enr/api
 *   npm run potentiel -w @enr/api -- solaire_sol eolien_terrestre
 *
 * A LANCER APRES l'ingestion des communes ET celle des postes sources : l'indicateur exige les
 * deux, et rend une commune GRISE tant qu'il en manque un. Une carte nationale entierement grise
 * apres ce script signale donc un ordre de commandes, pas un mauvais territoire.
 */

import { estFiliere, type Filiere } from '@enr/core';
import { pool } from '../bdd.js';
import { journal } from '../journal.js';
import { calculerPotentielCommunal } from '../services/potentiel-communal.js';

async function main(): Promise<void> {
  const demandees = process.argv.slice(2);
  const inconnues = demandees.filter((f) => !estFiliere(f));
  if (inconnues.length > 0) {
    journal.error({ inconnues }, 'Filiere(s) inconnue(s)');
    process.exitCode = 1;
    await pool.end();
    return;
  }
  const resultat = await calculerPotentielCommunal(
    demandees.length > 0 ? (demandees as Filiere[]) : undefined,
  );
  if (resultat.communes === 0) {
    journal.warn(
      {},
      'Aucune commune en base : lancez `npm run ingest -w @enr/api -- communes` avant ce script.',
    );
  }
  await pool.end();
}

await main();
