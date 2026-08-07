/**
 * Relit un CSV, un GeoJSON et un Shapefile REELS, et rapporte ce qu'ils contiennent.
 *
 * POURQUOI. Le changement de format des exports — libelles au lieu de cles d'enumeration, coordonnees
 * bornees — est un changement CASSANT decide par le proprietaire du projet. Il ne se verifie pas en
 * relisant le code : il se verifie en ouvrant les fichiers produits, sur de vraies parcelles.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { construireServeur } from '../src/serveur.js';
import { pool } from '../src/bdd.js';

const SORTIE = process.env['SORTIE_EXPORTS'] ?? '/tmp/exports-enr';
const SECRET = 'secret-de-relecture-uniquement';

async function principal(): Promise<void> {
  const app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  mkdirSync(SORTIE, { recursive: true });
  const entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'relecture@local',
      nom: 'relecture',
      role: 'lecture',
      habiliteDonneesProprietaires: false,
    })}`,
  };

  // Le CSV accepte les filtres de recherche ; le GeoJSON et le Shapefile prennent une LISTE D'IDU.
  const corps = { filiere: 'solaire_sol', limite: 30 };
  const idus = (
    await import('../src/services/recherche.js')
  ).filtrerParcelles({ filiere: 'solaire_sol', limite: 30 }, 5000);
  const listeIdus = (await idus).resultats.map((r) => r.idu);
  const corpsGeo = { filiere: 'solaire_sol', idus: listeIdus };
  console.log(`${listeIdus.length} IDU pour le GeoJSON et le Shapefile\n`);

  // --- CSV
  const csv = await app.inject({
    method: 'POST',
    url: '/api/exports/csv',
    headers: entetes,
    payload: corps,
  });
  console.log(`CSV : ${csv.statusCode}`);
  if (csv.statusCode === 200) {
    writeFileSync(resolve(SORTIE, 'parcelles.csv'), csv.body);
    const lignes = csv.body.split('\n').filter((l) => l.trim() !== '');
    console.log(`  ${lignes.length - 1} lignes de donnees`);
    console.log(`  en-tetes : ${lignes[0]}`);
    for (const l of lignes.slice(1, 4)) console.log(`  ${l}`);
    const cles = [...new Set(csv.body.match(/(?<=;|^)[a-z]+_[a-z_]+(?=;|$)/gm) ?? [])];
    console.log(`  cles d'enumeration restantes : ${cles.length ? cles.join(', ') : 'aucune'}`);
    const trop = [...new Set(csv.body.match(/\d+,\d{8,}/g) ?? [])];
    console.log(`  nombres a plus de 7 decimales : ${trop.length ? trop.join(', ') : 'aucun'}`);
  } else {
    console.log(`  ${csv.body.slice(0, 200)}`);
  }

  // --- GeoJSON
  const gj = await app.inject({
    method: 'POST',
    url: '/api/exports/geojson',
    headers: entetes,
    payload: corpsGeo,
  });
  console.log(`\nGeoJSON : ${gj.statusCode}`);
  if (gj.statusCode === 200) {
    writeFileSync(resolve(SORTIE, 'parcelles.geojson'), gj.body);
    const j = gj.json() as { features?: Array<{ properties: Record<string, unknown> }> };
    const props = j.features?.[0]?.properties ?? {};
    console.log(`  ${j.features?.length ?? 0} entites`);
    for (const cle of ['statut_score', 'statut_score_libelle', 'regime_implantation', 'regime_implantation_libelle']) {
      console.log(`  ${cle.padEnd(28)} = ${JSON.stringify(props[cle])}`);
    }
  } else {
    console.log(`  ${gj.body.slice(0, 200)}`);
  }

  // --- Shapefile : on lit les noms de champs du DBF, sans dependance.
  const shp = await app.inject({
    method: 'POST',
    url: '/api/exports/shapefile',
    headers: entetes,
    payload: corpsGeo,
  });
  console.log(`\nShapefile : ${shp.statusCode}`);
  if (shp.statusCode === 200) {
    const chemin = resolve(SORTIE, 'parcelles.zip');
    writeFileSync(chemin, shp.rawPayload);
    console.log(`  ${shp.rawPayload.length} octets`);
    try {
      const liste = execFileSync('unzip', ['-l', chemin], { encoding: 'utf8' });
      console.log(`  contenu : ${(liste.match(/\S+\.(shp|dbf|shx|prj|cpg)/g) ?? []).join(', ')}`);
    } catch {
      console.log('  (unzip indisponible, archive ecrite quand meme)');
    }
  } else {
    console.log(`  ${shp.body.slice(0, 200)}`);
  }

  console.log(`\nSortie : ${SORTIE}`);
  await app.close();
  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
