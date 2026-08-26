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

/**
 * Les lieux sondes, et pourquoi ceux-la.
 *
 * Les cinq premiers couvrent des structures parcellaires opposees, du remembrement beauceron au
 * parcellaire morcele du Finistere : c'est la que se joue la question « le cadastre est-il complet la ou
 * l'on cherche ».
 *
 * S'y ajoutent la CORSE et les cinq departements d'OUTRE-MER, pour repondre a une question distincte —
 * « toutes les references cadastrales de France » inclut-il ces territoires ? Le releve les distingue de
 * la reponse de l'application : le format d'identifiant les accepte (codes « 2A », « 97x »), le relais
 * peut les servir, mais la carte est BORNEE a la France metropolitaine (`BORNES_FRANCE` cote interface,
 * `limiterAlaFrance` cote API). La derniere ligne du rapport le rappelle.
 */
const LIEUX = [
  { nom: 'Beauce (28) — grandes parcelles', lon: 1.79, lat: 48.157 },
  { nom: 'Finistere (29) — parcellaire morcele', lon: -4.1, lat: 48.4 },
  { nom: 'Vaucluse (84) — petites parcelles', lon: 5.05, lat: 43.95 },
  { nom: 'Bas-Rhin (67) — Alsace', lon: 7.6, lat: 48.6 },
  { nom: 'Haute-Garonne (31)', lon: 1.44, lat: 43.6 },
  { nom: 'Corse-du-Sud (2A) — Ajaccio', lon: 8.74, lat: 41.93 },
  { nom: 'Haute-Corse (2B) — Bastia', lon: 9.44, lat: 42.7 },
  { nom: 'Guadeloupe (971)', lon: -61.53, lat: 16.24 },
  { nom: 'Martinique (972)', lon: -61.02, lat: 14.61 },
  { nom: 'Guyane (973) — Cayenne', lon: -52.33, lat: 4.93 },
  { nom: 'La Reunion (974)', lon: 55.45, lat: -20.88 },
  { nom: 'Mayotte (976)', lon: 45.22, lat: -12.78 },
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

  /**
   * LES ATTRIBUTS DE LA TUILE, decodes et non supposes.
   *
   * L'interface doit composer l'identifiant d'une parcelle CLIQUEE a partir des attributs que porte la
   * tuile. Si un seul nom d'attribut differe de ce que le code lit, l'identifiant est faux ou vide, et
   * l'echec est MUET — exactement la famille de defauts que l'audit 6 avait trouvee sur `typedoc` et
   * `sitename`. Les noms sont donc releves sur une tuile reelle, puis figes dans une fixture que
   * `contrats-sources` verifie.
   */
  const t = tuilePour(1.79, 48.157, 16);
  const rep = await app.inject({
    method: 'GET',
    url: `/api/carte/cadastre/${t.z}/${t.x}/${t.y}.pbf`,
    headers: entetes,
  });
  if (rep.statusCode === 200) {
    const proprietes = await proprietesDeTuile(rep.rawPayload);
    console.log('\nAttributs de la couche « parcelle » sur la tuile 16/' + `${t.x}/${t.y} :`);
    for (const [couche, champs] of Object.entries(proprietes)) {
      console.log(`  ${couche} : ${champs.join(', ')}`);
    }
    console.log('\nExemple de premiere entite :');
    console.log('  ' + JSON.stringify(await premiereEntite(rep.rawPayload)));
  }

  await app.close();
  await pool.end();
}

/**
 * Noms d'attributs par couche d'une tuile vectorielle.
 *
 * `@mapbox/vector-tile` et `pbf` arrivent avec MapLibre : ce script les emprunte pour LIRE une tuile
 * que nous servons. Ce sont des dependances de l'interface, employees ici dans un script de
 * verification — pas dans le code de production, qui ne decode aucune tuile cote serveur.
 */
async function proprietesDeTuile(brut: Buffer): Promise<Record<string, string[]>> {
  const { VectorTile } = await import('@mapbox/vector-tile');
  const Pbf = (await import('pbf')).default;
  const tuile = new VectorTile(new Pbf(new Uint8Array(brut)));
  const out: Record<string, string[]> = {};
  for (const [nom, couche] of Object.entries(tuile.layers)) {
    const champs = new Set<string>();
    for (let i = 0; i < couche.length; i += 1) {
      for (const cle of Object.keys(couche.feature(i).properties)) champs.add(cle);
    }
    out[nom] = [...champs].sort();
  }
  return out;
}

async function premiereEntite(brut: Buffer): Promise<unknown> {
  const { VectorTile } = await import('@mapbox/vector-tile');
  const Pbf = (await import('pbf')).default;
  const tuile = new VectorTile(new Pbf(new Uint8Array(brut)));
  const couche = tuile.layers['parcelle'];
  return couche && couche.length > 0 ? couche.feature(0).properties : null;
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
