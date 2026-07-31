/**
 * Recalcule les scores materialises.
 *
 * A lancer apres une mise a jour de donnees, une modification des ponderations par defaut
 * ou un changement de version du moteur de scoring.
 *
 *   npm run rescorer -w @enr/api                    # toutes les filieres
 *   npm run rescorer -w @enr/api -- solaire_sol     # une filiere
 */

import { estFiliere, FILIERES, type Filiere } from '@enr/core';
import { pool, requete } from '../bdd.js';
import { journal } from '../journal.js';
import { rescorerTout } from '../services/qualification.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filieres: Filiere[] = args.filter(estFiliere);
  const limite = Number(args.find((a) => /^\d+$/.test(a)) ?? 100000);

  const resultat = await rescorerTout(filieres.length > 0 ? filieres : [...FILIERES], limite);
  await requete(`SELECT rafraichir_compteurs_communaux()`);

  journal.info({ ...resultat, filieres: filieres.length > 0 ? filieres : 'toutes' }, 'Rescoring termine');
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Rescoring interrompu');
  process.exit(1);
});
