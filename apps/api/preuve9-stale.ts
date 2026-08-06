import { requete } from './src/bdd.js';
import { patrimoine } from './src/connecteurs/locales.js';
import { calculerScore } from '@enr/scoring';
import type { ParcelleSnapshot } from '@enr/core';

async function main() {
  const [l] = await requete<{ idu: string; snapshot: ParcelleSnapshot; ech: string[]; dep: string; lon: number; lat: number; d: Date }>(
    `SELECT s.idu, s.snapshot, s.connecteurs_en_echec AS ech, p.code_departement AS dep,
            ST_X(p.centroide) AS lon, ST_Y(p.centroide) AS lat, s.date_snapshot AS d
       FROM parcelle_snapshot s JOIN parcelle p ON p.idu = s.idu
      WHERE (s.snapshot -> 'patrimoine' -> 'siteClasse' ->> 'recouvre') IS NULL
      ORDER BY s.idu LIMIT 1`,
  );
  console.log('IDU', l.idu, 'dep', l.dep, 'snapshot du', l.d.toISOString());

  const stocke = calculerScore(l.snapshot, 'solaire_sol', { connecteursEnEchec: l.ech });
  const cs = stocke.criteres.find((c) => c.id === 'pat_sites');
  console.log('AVEC LE SNAPSHOT STOCKE   pat_sites note =', cs?.note, '| feu =', cs?.feu, '|', cs?.valeurAffichee);
  console.log('                          statut =', stocke.statut, '| score =', stocke.scoreGlobal);

  // Meme parcelle, patrimoine relu MAINTENANT dans la base (la couche a ete ingeree depuis).
  const frais = await patrimoine([l.lon, l.lat], l.dep);
  const s2 = JSON.parse(JSON.stringify(l.snapshot)) as ParcelleSnapshot;
  Object.assign(s2.patrimoine, frais);
  const apres = calculerScore(s2, 'solaire_sol', { connecteursEnEchec: l.ech });
  const ca = apres.criteres.find((c) => c.id === 'pat_sites');
  console.log('AVEC LA DONNEE DU JOUR    pat_sites note =', ca?.note, '| feu =', ca?.feu, '|', ca?.valeurAffichee);
  console.log('                          statut =', apres.statut, '| score =', apres.scoreGlobal);
  process.exit(0);
}
void main();
