/**
 * Lance un ou plusieurs jobs d'ingestion.
 *
 *   npm run ingest -w @enr/api                       # tous les jobs
 *   npm run ingest -w @enr/api -- postes_sources     # un job precis
 */

import { pool } from '../bdd.js';
import { journal } from '../journal.js';
import { JOBS, lancerIngestion } from '../ingestion/index.js';

async function main(): Promise<void> {
  const demandes = process.argv.slice(2);
  const connecteurs = demandes.length > 0 ? demandes : Object.keys(JOBS);

  const inconnus = connecteurs.filter((c) => !JOBS[c]);
  if (inconnus.length > 0) {
    journal.error(
      { inconnus, disponibles: Object.keys(JOBS) },
      "Connecteur(s) inconnu(s)",
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }

  let echecs = 0;
  for (const c of connecteurs) {
    try {
      await lancerIngestion(c);
    } catch (err) {
      echecs += 1;
      journal.error({ err, connecteur: c }, "Job d'ingestion en échec");
    }
  }

  if (echecs > 0) process.exitCode = 1;
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Ingestion interrompue');
  process.exit(1);
});
