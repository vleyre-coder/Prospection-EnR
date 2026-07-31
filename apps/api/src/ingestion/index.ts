/**
 * Jobs d'ingestion.
 *
 * Deux familles de sources coexistent :
 *   - les API temps reel (cadastre, GPU, RPG, INPN, Georisques, altimetrie) : interrogees
 *     a la volee lors de la qualification, avec cache. Rien a ingerer.
 *   - les couches a ingerer : postes sources, communes, reseau gaz, patrimoine, ZAER,
 *     documents-cadres. Ce sont elles que gerent les jobs ci-dessous.
 *
 * Chaque job met a jour `source_donnee` (fraicheur, statut) et, lorsque la couverture est
 * territoriale, `couverture_ingestion` - afin de pouvoir distinguer "aucune contrainte" de
 * "territoire non ingere".
 */

import { avecParams, jsonExterne } from '../http.js';
import { journal } from '../journal.js';
import { config } from '../config.js';
import { requete } from '../bdd.js';
import { enregistrerCouverture, enregistrerIngestion } from '../depots/sources.js';
export { ingererPostesSources } from './postes-sources.js';
import { ingererPostesSources } from './postes-sources.js';

// ---------------------------------------------------------------------------
// Communes : socle de la vue nationale agregee
// ---------------------------------------------------------------------------

interface CommuneApi {
  code: string;
  nom: string;
  codeDepartement: string;
  codeRegion?: string;
  codeEpci?: string;
  population?: number;
  contour?: { type: string; coordinates: unknown };
}

export async function ingererCommunes(): Promise<{ connecteur: string; nbCommunes: number }> {
  // Le contour est demande explicitement : sans lui, la couche nationale ne peut pas etre
  // rendue. Le jeu complet pese quelques dizaines de megaoctets, d'ou l'ingestion par
  // departement pour rester sous les limites de memoire et de delai.
  const departements = await jsonExterne<Array<{ code: string; nom: string }>>(
    `${config.sources.geoApiGouv}/departements`,
    { connecteur: 'communes', timeoutMs: 30000 },
  );

  let nbCommunes = 0;
  for (const dep of departements) {
    try {
      const url = avecParams(`${config.sources.geoApiGouv}/departements/${dep.code}/communes`, {
        fields: 'code,nom,codeDepartement,codeRegion,codeEpci,population,contour',
        format: 'json',
      });
      const communes = await jsonExterne<CommuneApi[]>(url, {
        connecteur: 'communes',
        timeoutMs: 60000,
      });

      for (const c of communes) {
        if (!c.contour) continue;
        await requete(
          `INSERT INTO commune
             (code_insee, nom, code_departement, code_region, code_epci, population,
              geom, centroide, surface_ha, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))),
                   ST_PointOnSurface(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))),
                   ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), 2154)) / 10000.0,
                   now())
           ON CONFLICT (code_insee) DO UPDATE SET
             nom = EXCLUDED.nom, code_epci = EXCLUDED.code_epci,
             population = EXCLUDED.population, geom = EXCLUDED.geom,
             centroide = EXCLUDED.centroide, surface_ha = EXCLUDED.surface_ha,
             updated_at = now()`,
          [
            c.code,
            c.nom,
            c.codeDepartement,
            c.codeRegion ?? null,
            c.codeEpci ?? null,
            c.population ?? null,
            JSON.stringify(c.contour),
          ],
        );
        nbCommunes += 1;
      }
      journal.info({ departement: dep.code, communes: communes.length }, 'Departement ingere');
    } catch (err) {
      journal.warn({ err, departement: dep.code }, "Echec d'ingestion d'un departement");
    }
  }

  await enregistrerIngestion('communes', nbCommunes > 0 ? 'ok' : 'echec', null, nbCommunes);
  return { connecteur: 'communes', nbCommunes };
}

// ---------------------------------------------------------------------------
// Reseau gaz : sites d'injection biomethane
// ---------------------------------------------------------------------------

export async function ingererReseauGaz(): Promise<{ connecteur: string; nbPoints: number }> {
  // Jeu GRDF des sites d'injection de biomethane. Le nom exact du jeu evolue : on tente
  // plusieurs identifiants connus, plutot que d'echouer sur un seul.
  const candidats = [
    'sites-dinjection-de-biomethane',
    'sites-d-injection-de-biomethane-en-service',
    'liste-des-sites-dinjection-de-biomethane',
  ];

  let nbPoints = 0;
  for (const jeu of candidats) {
    try {
      const url = avecParams(`${config.sources.opendataGrdf}/catalog/datasets/${jeu}/records`, {
        limit: 100,
      });
      const rep = await jsonExterne<{
        total_count?: number;
        results?: Array<Record<string, unknown>>;
      }>(url, { connecteur: 'reseau_gaz', timeoutMs: 30000 });

      const resultats = rep.results ?? [];
      if (resultats.length === 0) continue;

      for (const [index, r] of resultats.entries()) {
        const geo = extraireCoordonnees(r);
        if (!geo) continue;
        const id = String(r['id'] ?? r['code'] ?? `${jeu}-${index}`);
        await requete(
          `INSERT INTO point_injection_gaz
             (id, nom, gestionnaire, code_insee, geom, capacite_nm3h, connecteur, date_donnee, updated_at)
           VALUES ($1, $2, 'GRDF', $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6,
                   'reseau_gaz', current_date, now())
           ON CONFLICT (id) DO UPDATE SET
             nom = EXCLUDED.nom, geom = EXCLUDED.geom,
             capacite_nm3h = EXCLUDED.capacite_nm3h, updated_at = now()`,
          [
            id,
            String(r['nom'] ?? r['nom_site'] ?? r['denomination'] ?? id),
            String(r['code_commune'] ?? r['code_insee'] ?? '').slice(0, 5) || null,
            geo[0],
            geo[1],
            nombreOuNull(r['capacite'] ?? r['capacite_injection'] ?? r['debit_max']),
          ],
        );
        nbPoints += 1;
      }
      if (nbPoints > 0) break;
    } catch (err) {
      journal.debug({ err, jeu }, "Jeu de donnees GRDF indisponible, essai suivant");
    }
  }

  await enregistrerIngestion(
    'reseau_gaz',
    nbPoints > 0 ? 'ok' : 'echec',
    nbPoints > 0
      ? `${nbPoints} sites d'injection`
      : "Aucun jeu GRDF exploitable : verifier les identifiants de jeux sur opendata.grdf.fr",
    nbPoints,
  );
  return { connecteur: 'reseau_gaz', nbPoints };
}

function extraireCoordonnees(r: Record<string, unknown>): [number, number] | null {
  for (const cle of ['geo_point_2d', 'geo_point', 'coordonnees', 'geolocalisation']) {
    const v = r[cle];
    if (v && typeof v === 'object' && 'lon' in v && 'lat' in v) {
      const o = v as { lon: number; lat: number };
      if (Number.isFinite(o.lon) && Number.isFinite(o.lat)) return [o.lon, o.lat];
    }
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) {
      // Opendatasoft renvoie [lat, lon] dans ce format historique.
      return [v[1] as number, v[0] as number];
    }
  }
  const lon = nombreOuNull(r['longitude'] ?? r['lon'] ?? r['x']);
  const lat = nombreOuNull(r['latitude'] ?? r['lat'] ?? r['y']);
  return lon != null && lat != null ? [lon, lat] : null;
}

function nombreOuNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Patrimoine : monuments historiques
// ---------------------------------------------------------------------------

export async function ingererPatrimoine(): Promise<{ connecteur: string; nbObjets: number }> {
  // Base des immeubles proteges au titre des monuments historiques (Ministere de la Culture,
  // portail Opendatasoft).
  const url = avecParams(
    'https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/liste-des-immeubles-proteges-au-titre-des-monuments-historiques/records',
    { limit: 100 },
  );

  let nbObjets = 0;
  try {
    let offset = 0;
    // L'API Opendatasoft plafonne a 100 enregistrements par page et 10 000 au total :
    // au-dela il faut l'export, que l'on n'utilise pas ici pour rester econome.
    while (offset < 10000) {
      const rep = await jsonExterne<{ results?: Array<Record<string, unknown>>; total_count?: number }>(
        `${url}&offset=${offset}`,
        { connecteur: 'patrimoine_culture', timeoutMs: 30000 },
      );
      const resultats = rep.results ?? [];
      if (resultats.length === 0) break;

      for (const r of resultats) {
        const geo = extraireCoordonnees(r);
        if (!geo) continue;
        const id = String(r['reference'] ?? r['id'] ?? `${geo[0]},${geo[1]}`);
        const dep = String(r['departement'] ?? r['code_departement'] ?? '').slice(0, 3) || null;
        await requete(
          `INSERT INTO contrainte
             (type, sous_type, nom, identifiant_source, geom, attributs, connecteur, code_departement, date_donnee)
           VALUES ('monument_historique', $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326),
                   $6, 'patrimoine_culture', $7, current_date)
           ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
             nom = EXCLUDED.nom, geom = EXCLUDED.geom, attributs = EXCLUDED.attributs`,
          [
            String(r['nature_protection'] ?? r['protection'] ?? 'inscrit').slice(0, 80),
            String(r['appellation_courante'] ?? r['denomination'] ?? id).slice(0, 300),
            id,
            geo[0],
            geo[1],
            JSON.stringify(r),
            dep,
          ],
        );
        nbObjets += 1;
      }
      offset += resultats.length;
      if (rep.total_count != null && offset >= rep.total_count) break;
    }
  } catch (err) {
    journal.warn({ err }, "Echec de l'ingestion du patrimoine");
  }

  // Trace de couverture par departement : indispensable pour ne pas conclure a tort a
  // l'absence de monument.
  const parDep = await requete<{ code_departement: string | null; n: number }>(
    `SELECT code_departement, count(*)::int AS n FROM contrainte
      WHERE connecteur = 'patrimoine_culture' GROUP BY code_departement`,
  );
  for (const d of parDep) {
    if (d.code_departement) {
      await enregistrerCouverture('patrimoine_culture', 'monument_historique', d.code_departement, d.n);
    }
  }

  await enregistrerIngestion(
    'patrimoine_culture',
    nbObjets > 0 ? 'ok' : 'echec',
    `${nbObjets} monuments`,
    nbObjets,
  );
  return { connecteur: 'patrimoine_culture', nbObjets };
}

// ---------------------------------------------------------------------------
// Registre des jobs
// ---------------------------------------------------------------------------

export const JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  communes: ingererCommunes,
  postes_sources: ingererPostesSources,
  reseau_gaz: ingererReseauGaz,
  patrimoine_culture: ingererPatrimoine,
};

export async function lancerIngestion(connecteur: string): Promise<Record<string, unknown>> {
  const job = JOBS[connecteur];
  if (!job) {
    throw new Error(
      `Aucun job d'ingestion pour "${connecteur}". Jobs disponibles : ${Object.keys(JOBS).join(', ')}`,
    );
  }
  journal.info({ connecteur }, 'Debut d\'ingestion');
  const debut = Date.now();
  const resultat = await job();
  journal.info({ connecteur, dureeMs: Date.now() - debut, ...resultat }, 'Ingestion terminee');
  return { ...resultat, dureeMs: Date.now() - debut };
}
