/**
 * Mesure le debit de qualification, sur une emprise reelle.
 *
 * POURQUOI CE SCRIPT EXISTE. La feuille de route de l'audit 7 portait la mesure de charge en
 * item 20, et elle n'avait jamais ete faite : le debit de l'application etait une inconnue, alors
 * qu'il conditionne directement ce qu'un prospecteur peut demander. « Qualifie-moi cette commune »
 * est une question dont la reponse est un ordre de grandeur en heures, et personne ne le savait.
 *
 * CE QU'IL MESURE : le temps d'un enrichissement complet (une quinzaine d'appels externes) suivi
 * du scoring, parcelle par parcelle, en sequentiel. Les quantiles importent plus que la moyenne :
 * une parcelle en tissu dense declenche le repli d'emprise du connecteur WFS et coute nettement
 * plus cher que la mediane.
 *
 * CE QU'IL NE MESURE PAS : le debit sous concurrence. Les sources externes imposent leurs propres
 * limitations — 1 requete/seconde avec un burst de 30 pour la Geoplateforme — donc paralleliser
 * davantage ne multiplie pas le debit et risque de faire refuser les requetes. La mesure
 * sequentielle est le plancher honnete.
 *
 * USAGE
 *   npx tsx apps/api/src/scripts/mesurer-performance.ts \
 *     --bbox 1.740,48.145,1.765,48.165 [--parcelles 8] [--surface-min 10000]
 */

import { calculerScore } from '@enr/scoring';
import { pool } from '../bdd.js';
import { bboxDepuisChaine } from '../geo.js';
import { parcellesParEmprise } from '../connecteurs/cadastre.js';
import { enrichirParcelle } from '../enrichissement.js';

function arg(nom: string, defaut: string | null = null): string | null {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : defaut;
}

/** Quantile d'une serie deja triee. */
function quantile(triees: readonly number[], q: number): number {
  if (triees.length === 0) return 0;
  return triees[Math.min(triees.length - 1, Math.floor(q * triees.length))]!;
}

async function main(): Promise<void> {
  const brut = arg('--bbox');
  if (!brut) {
    process.stderr.write(
      'Usage : --bbox ouest,sud,est,nord [--parcelles 8] [--surface-min 10000]\n',
    );
    process.exit(1);
  }
  const bbox = bboxDepuisChaine(brut);
  if (!bbox) {
    process.stderr.write(`Emprise invalide : « ${brut} ».\n`);
    process.exit(1);
  }
  const nb = Number(arg('--parcelles', '8'));
  const surfaceMin = Number(arg('--surface-min', '10000'));

  const t0 = Date.now();
  const brutes = await parcellesParEmprise(bbox);
  const dureeCadastre = Date.now() - t0;
  const retenues = brutes
    .filter((p) => (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) >= surfaceMin)
    .slice(0, nb);

  process.stdout.write(
    `cadastre : ${brutes.length} parcelles en ${dureeCadastre} ms ` +
      `(${retenues.length} retenues au-dela de ${surfaceMin} m2)\n`,
  );
  if (retenues.length === 0) {
    process.stdout.write('Aucune parcelle retenue : elargissez l’emprise ou baissez --surface-min.\n');
    await pool.end();
    return;
  }

  const durees: number[] = [];
  for (const p of retenues) {
    const t = Date.now();
    const r = await enrichirParcelle(p);
    calculerScore(r.snapshot, 'solaire_sol');
    durees.push(Date.now() - t);
  }
  durees.sort((a, b) => a - b);
  const somme = durees.reduce((a, b) => a + b, 0);
  const parHeure = Math.round((3600 * durees.length) / (somme / 1000));

  process.stdout.write(
    `\nenrichissement + scoring, ${durees.length} parcelles, en sequentiel :\n` +
      `  min ${durees[0]} ms | mediane ${quantile(durees, 0.5)} ms | ` +
      `p90 ${quantile(durees, 0.9)} ms | max ${durees[durees.length - 1]} ms\n` +
      `  moyenne ${Math.round(somme / durees.length)} ms, soit ${parHeure} parcelles/heure\n`,
  );
  // Une commune moyenne compte de l'ordre de 1 500 parcelles au-dela d'un hectare. L'ordre de
  // grandeur en heures est ce qu'un utilisateur a besoin de savoir avant de lancer une campagne.
  process.stdout.write(
    `\nOrdre de grandeur : une commune (~1 500 parcelles > 1 ha) demanderait ` +
      `~${(1500 / parHeure).toFixed(1)} h.\n` +
      `L'écart entre la médiane et le p90 mesure le surcout du tissu dense, ou le connecteur WFS\n` +
      `doit resserrer son emprise pour obtenir une réponse complete.\n`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`Mesure interrompue : ${String(err)}\n`);
  process.exit(1);
});
