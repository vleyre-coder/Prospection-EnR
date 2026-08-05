/**
 * Qualifie les parcelles d'une emprise et ecrit les snapshots sur la sortie standard, en JSON.
 *
 * POURQUOI CE SCRIPT EXISTE. Il sert la campagne de validation par un expert
 * (`scripts/campagne-validation.mjs`), qui a besoin des snapshots bruts pour construire un
 * fichier de saisie. Il est aussi utile seul, pour inspecter ce que l'application produit sur un
 * territoire donne sans passer par l'interface.
 *
 * LE RESULTAT VA DANS UN FICHIER, pas sur la sortie standard. Premiere version : le JSON etait
 * ecrit sur stdout — mais `journal` y ecrit aussi, depuis tous les modules traverses par la
 * qualification, et le JSON n'etait analysable qu'en prenant la derniere ligne. Dependre d'une
 * position de ligne est fragile ; un chemin de fichier ne l'est pas.
 *
 * USAGE
 *   npx tsx apps/api/src/scripts/qualifier-emprise.ts --bbox 1.70,48.10,1.90,48.25 \\
 *     [--limite 30] [--sortie /tmp/snapshots.json]
 */

import { writeFileSync } from 'node:fs';
import { pool } from '../bdd.js';
import { bboxDepuisChaine } from '../geo.js';
import { qualifierEmprise } from '../services/qualification.js';
import { parcellesDansEmprise, snapshotParIdu } from '../depots/parcelles.js';

function arg(nom: string, defaut: string | null = null): string | null {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : defaut;
}

async function main(): Promise<void> {
  const brut = arg('--bbox');
  if (!brut) {
    process.stderr.write('Usage : --bbox ouest,sud,est,nord [--limite 30]\n');
    process.exit(1);
  }
  const bbox = bboxDepuisChaine(brut);
  if (!bbox) {
    process.stderr.write(`Emprise invalide : « ${brut} ».\n`);
    process.exit(1);
  }
  const limite = Number(arg('--limite', '30'));

  process.stderr.write(`Qualification de ${JSON.stringify(bbox)}, limite ${limite}...\n`);
  await qualifierEmprise(bbox);

  // On relit les snapshots enregistres plutot que de les capturer au vol : c'est exactement ce
  // que l'application servira, y compris apres assainissement par les bornes de vraisemblance.
  const parcelles = await parcellesDansEmprise(bbox, 0, limite);
  const snapshots = [];
  for (const p of parcelles) {
    const s = await snapshotParIdu(p.idu);
    if (s?.snapshot) snapshots.push(s.snapshot);
  }
  const chemin = arg('--sortie', 'snapshots-emprise.json')!;
  writeFileSync(chemin, JSON.stringify(snapshots), 'utf8');
  // Seule ligne de stdout : le chemin du resultat. Tout le reste est sur stderr.
  process.stdout.write(`${chemin}\n`);
  process.stderr.write(`${snapshots.length} snapshot(s) ecrit(s) dans ${chemin}\n`);
  await pool.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`Qualification interrompue : ${String(err)}\n`);
  process.exit(1);
});
