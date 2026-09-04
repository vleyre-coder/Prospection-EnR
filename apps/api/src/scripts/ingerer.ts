/**
 * Lance un ou plusieurs jobs d'ingestion.
 *
 *   npm run ingest -w @enr/api                       # tous les jobs
 *   npm run ingest -w @enr/api -- postes_sources     # un job precis
 *   npm run ingest -w @enr/api -- zaer_local:28,45   # un job, limite a des departements
 *
 * LA FORME `job:departements` EXISTE POUR UNE RAISON PRECISE. La couche nationale des zones
 * d'acceleration porte 1 089 671 objets : tant que l'ingestion etait tout-ou-rien, la seule facon
 * d'avoir la moindre zone en base etait de tout ingerer, ce qui revenait en pratique a n'en avoir
 * aucune. Or l'application propose ces zones comme reponse a « ou prospecter » : elle a besoin
 * qu'on puisse allumer un departement en quelques minutes.
 */

import { pool } from '../bdd.js';
import { journal } from '../journal.js';
import { JOBS, lancerIngestion } from '../ingestion/index.js';

async function main(): Promise<void> {
  const demandes = process.argv.slice(2);
  /*
   * `zaer_local:28,45` se lit « ce job, sur ces departements ». Le decoupage est fait ici, au plus
   * pres de la ligne de commande, pour que `JOBS` reste une table de jobs et non une table de jobs
   * parametres.
   */
  const demandees = demandes.map((d) => {
    const [nom, deps] = d.split(':');
    return {
      nom: nom ?? d,
      departements: deps ? deps.split(',').map((x) => x.trim()).filter((x) => x !== '') : undefined,
    };
  });
  const connecteurs =
    demandees.length > 0 ? demandees : Object.keys(JOBS).map((nom) => ({ nom, departements: undefined }));

  const inconnus = connecteurs.filter((c) => !JOBS[c.nom]).map((c) => c.nom);
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
      await lancerIngestion(c.nom, c.departements);
    } catch (err) {
      echecs += 1;
      journal.error({ err, connecteur: c.nom }, "Job d'ingestion en échec");
    }
  }

  if (echecs > 0) process.exitCode = 1;
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Ingestion interrompue');
  process.exit(1);
});
