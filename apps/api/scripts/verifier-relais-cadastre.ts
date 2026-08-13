/**
 * Verifie que le relais cadastral sert de VRAIES tuiles, sur plusieurs regions de France.
 *
 * Plusieurs regions, deliberement : le signalement d'usage portait sur une parcelle introuvable, et la
 * question n'est pas « le relais repond-il » mais « le cadastre est-il complet la ou l'on cherche ».
 * Une seule tuile en Beauce ne prouverait rien pour la Bretagne ou le Sud-Est.
 */

import { construireServeur } from '../src/serveur.js';
import { pool } from '../src/bdd.js';

/** Coordonnees de tuile (z/x/y en schema XYZ) pour un point donne. */
function tuilePour(lon: number, lat: number, z: number): { z: number; x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x, y };
}

const LIEUX = [
  { nom: 'Beauce (28) — grandes parcelles', lon: 1.79, lat: 48.157 },
  { nom: 'Finistere (29) — parcellaire morcele', lon: -4.1, lat: 48.4 },
  { nom: 'Vaucluse (84) — petites parcelles', lon: 5.05, lat: 43.95 },
  { nom: 'Bas-Rhin (67) — Alsace', lon: 7.6, lat: 48.6 },
  { nom: 'Haute-Garonne (31)', lon: 1.44, lat: 43.6 },
  { nom: 'Pleine mer (hors cadastre)', lon: -4.9, lat: 47.9 },
];

async function principal(): Promise<void> {
  const app = await construireServeur({ secretJwt: 'secret-de-verification-uniquement' });
  await app.ready();
  const entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'verif@local',
      nom: 'verif',
      role: 'lecture',
      habiliteDonneesProprietaires: false,
    })}`,
  };

  console.log('lieu'.padEnd(38) + 'tuile'.padEnd(18) + 'statut'.padStart(7) + 'octets'.padStart(9));
  console.log('-'.repeat(72));

  let servies = 0;
  for (const l of LIEUX) {
    const t = tuilePour(l.lon, l.lat, 16);
    const rep = await app.inject({
      method: 'GET',
      url: `/api/carte/cadastre/${t.z}/${t.x}/${t.y}.pbf`,
      headers: entetes,
    });
    const taille = rep.statusCode === 200 ? rep.rawPayload.length : 0;
    if (rep.statusCode === 200 && taille > 500) servies += 1;
    console.log(
      l.nom.padEnd(38) +
        `${t.z}/${t.x}/${t.y}`.padEnd(18) +
        String(rep.statusCode).padStart(7) +
        String(taille).padStart(9),
    );
  }

  // Zoom trop large : le relais doit refuser, pour ne pas peser sur un bien commun.
  const large = tuilePour(2.3, 48.8, 8);
  const repLarge = await app.inject({
    method: 'GET',
    url: `/api/carte/cadastre/${large.z}/${large.x}/${large.y}.pbf`,
    headers: entetes,
  });
  console.log(`\nZoom 8 (vue large) : ${repLarge.statusCode} — attendu 204, le cadastre n'y est pas relaye.`);

  console.log(`\n${servies} lieu(x) sur ${LIEUX.length - 1} terrestres servis avec une tuile non vide.`);
  await app.close();
  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
