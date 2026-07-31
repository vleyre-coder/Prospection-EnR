/** Routes cartographiques : tuiles vectorielles et couches GeoJSON. */

import type { FastifyInstance } from 'fastify';
import { estFiliere, type Filiere } from '@enr/core';
import { config } from '../config.js';
import { requete } from '../bdd.js';
import { avecParams } from '../http.js';
import { bboxDepuisChaine, cercle } from '../geo.js';
import * as tuiles from '../services/tuiles.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import * as depotProspection from '../depots/prospection.js';
import { erreur } from './erreurs.js';

interface ParamsTuile {
  z: string;
  x: string;
  y: string;
}

function filiereDepuis(q: unknown): Filiere {
  const f = (q as { filiere?: string } | undefined)?.filiere;
  return estFiliere(f) ? f : 'solaire_sol';
}

/**
 * Fonds de carte autorises par le relais.
 *
 * Liste FERMEE : le relais ne doit pas devenir un proxy ouvert vers n'importe quelle
 * ressource distante.
 */
const FONDS_AUTORISES: Record<string, { couche: string; format: string; type: string }> = {
  plan: { couche: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', type: 'image/png' },
  ortho: { couche: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', type: 'image/jpeg' },
};

export async function routesCarte(app: FastifyInstance): Promise<void> {
  /**
   * Relais des tuiles du fond de carte IGN.
   *
   * Les tuiles WMTS sont normalement demandees directement par le navigateur. Dans un reseau
   * d'entreprise filtrant les sorties, ou derriere un proxy que le navigateur ne traverse pas,
   * `data.geopf.fr` devient injoignable et la carte reste vide alors que tout le reste
   * fonctionne. Ce relais fait passer les tuiles par l'API : le serveur a, lui, un acces
   * sortant maitrise. Le client y bascule automatiquement lorsqu'il detecte l'echec des
   * appels directs.
   *
   * L'attribution « © IGN — Geoplateforme » reste obligatoire et demeure affichee cote client.
   */
  app.get<{ Params: { fond: string; z: string; x: string; y: string } }>(
    '/api/carte/fond/:fond/:z/:x/:y',
    async (req, rep) => {
      const conf = FONDS_AUTORISES[req.params.fond];
      if (!conf) {
        return erreur(rep, 404, 'fond_inconnu', `Fond inconnu : ${req.params.fond}`);
      }
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 21) {
        return erreur(rep, 400, 'tuile_invalide', 'Coordonnees de tuile invalides');
      }
      // Bornes de la pyramide : evite de relayer des requetes absurdes.
      const max = 2 ** z;
      if (x < 0 || y < 0 || x >= max || y >= max) {
        return rep.code(204).send();
      }

      const url = avecParams('https://data.geopf.fr/wmts', {
        SERVICE: 'WMTS',
        VERSION: '1.0.0',
        REQUEST: 'GetTile',
        LAYER: conf.couche,
        STYLE: 'normal',
        TILEMATRIXSET: 'PM',
        FORMAT: conf.format,
        TILEMATRIX: z,
        TILEROW: y,
        TILECOL: x,
      });

      try {
        const reponse = await fetch(url, {
          headers: {
            Accept: conf.type,
            'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!reponse.ok) {
          // Une tuile absente n'est pas une erreur applicative : hors emprise, l'IGN
          // repond 404 et la carte doit simplement ne rien afficher.
          if (reponse.status === 404 || reponse.status === 400) return rep.code(204).send();
          return erreur(
            rep,
            502,
            'fond_indisponible',
            `Le service de tuiles IGN a repondu ${reponse.status}.`,
          );
        }
        const tuile = Buffer.from(await reponse.arrayBuffer());
        return rep
          .header('Content-Type', reponse.headers.get('content-type') ?? conf.type)
          // Les tuiles IGN sont stables : un cache long evite de relayer deux fois la
          // meme tuile pour toute l'equipe.
          .header('Cache-Control', 'public, max-age=604800, immutable')
          .send(tuile);
      } catch (err) {
        req.log.warn({ err, fond: req.params.fond, z, x, y }, 'Relais de tuile IGN en echec');
        return erreur(
          rep,
          502,
          'fond_indisponible',
          "Le service de tuiles IGN est injoignable depuis le serveur.",
        );
      }
    },
  );

  // --- Tuiles vectorielles des parcelles ----------------------------------
  app.get<{ Params: ParamsTuile }>('/api/carte/tuiles/parcelles/:z/:x/:y.mvt', async (req, rep) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    if (![z, x, y].every(Number.isInteger)) return erreur(rep, 400, 'tuile_invalide', 'Coordonnees de tuile invalides');

    if (!tuiles.zoomValidePourParcelles(z)) {
      // En dessous du zoom minimal, le rendu parcellaire n'est ni lisible ni performant :
      // le client doit utiliser la couche communale.
      return rep.code(204).send();
    }

    const tuile = await tuiles.tuileParcelles({ z, x, y }, filiereDepuis(req.query));
    return rep
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', 'public, max-age=60')
      .send(tuile);
  });

  // --- Tuiles vectorielles des communes (vue nationale) -------------------
  app.get<{ Params: ParamsTuile }>('/api/carte/tuiles/communes/:z/:x/:y.mvt', async (req, rep) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    if (![z, x, y].every(Number.isInteger)) return erreur(rep, 400, 'tuile_invalide', 'Coordonnees de tuile invalides');
    if (!tuiles.zoomValidePourCommunes(z)) return rep.code(204).send();

    const tuile = await tuiles.tuileCommunes({ z, x, y }, filiereDepuis(req.query));
    return rep
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', 'public, max-age=600')
      .send(tuile);
  });

  // --- Tuiles des couches de contraintes ----------------------------------
  app.get<{ Params: ParamsTuile }>('/api/carte/tuiles/contraintes/:z/:x/:y.mvt', async (req, rep) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const types = String((req.query as { types?: string }).types ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (types.length === 0) return erreur(rep, 400, 'types_manquants', 'Parametre `types` requis');

    const tuile = await tuiles.tuileContraintes({ z, x, y }, types);
    return rep
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      .header('Cache-Control', 'public, max-age=3600')
      .send(tuile);
  });

  // --- Parcelles en GeoJSON (debug, exports d'emprise) --------------------
  app.get('/api/carte/parcelles', async (req, rep) => {
    const q = req.query as { bbox?: string; filiere?: string; limite?: string; surfaceMin?: string };
    const bbox = bboxDepuisChaine(q.bbox ?? '');
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` requis : minLon,minLat,maxLon,maxLat');

    const filiere = filiereDepuis(q);
    const parcelles = await depotParcelles.parcellesDansEmprise(
      bbox,
      q.surfaceMin ? Number(q.surfaceMin) : 0,
      Math.min(Number(q.limite ?? config.carte.limiteParcelles), config.carte.limiteParcelles),
    );
    const idus = parcelles.map((p) => p.idu);
    const [scores, prospection] = await Promise.all([
      depotScores.statutsParIdus(idus, filiere),
      depotProspection.statutsProspectionParIdus(idus, filiere),
    ]);

    return {
      type: 'FeatureCollection',
      features: parcelles.map((p) => ({
        type: 'Feature',
        geometry: p.geometrie,
        properties: {
          idu: p.idu,
          section: p.section,
          numero: p.numero,
          nom_commune: p.nomCommune,
          surface_m2: p.surfaceCalculeeM2 ?? p.contenanceM2,
          statut_score: scores[p.idu]?.statut ?? null,
          score_global: scores[p.idu]?.scoreGlobal ?? null,
          statut_prospection: prospection[p.idu] ?? null,
        },
      })),
    };
  });

  // --- Postes sources ------------------------------------------------------
  app.get('/api/carte/postes-sources', async (req, rep) => {
    const q = req.query as { bbox?: string; rayonKm?: string; gestionnaire?: string; etat?: string };
    const bbox = bboxDepuisChaine(q.bbox ?? '-5.5,41,10,51.5');
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` invalide');

    const conditions = ['geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)'];
    const params: unknown[] = [bbox[0], bbox[1], bbox[2], bbox[3]];
    if (q.gestionnaire) {
      params.push(q.gestionnaire);
      conditions.push(`gestionnaire = $${params.length}`);
    }
    if (q.etat) {
      params.push(q.etat.split(','));
      conditions.push(`etat_saturation = ANY($${params.length})`);
    }

    const lignes = await requete<{
      id: string;
      nom: string;
      gestionnaire: string;
      tension: string | null;
      capacite_residuelle_mw: number | null;
      etat_saturation: string | null;
      file_attente_mw: number | null;
      quote_part_eur_par_kw: number | null;
      renforcement_prevu: boolean;
      renforcement_horizon: string | null;
      renforcement_capacite_mw: number | null;
      en_projet: boolean;
      date_donnee: Date | null;
      lon: number;
      lat: number;
    }>(
      `SELECT id, nom, gestionnaire, tension, capacite_residuelle_mw, etat_saturation,
              file_attente_mw, quote_part_eur_par_kw, renforcement_prevu, renforcement_horizon,
              renforcement_capacite_mw, en_projet, date_donnee,
              ST_X(geom) AS lon, ST_Y(geom) AS lat
         FROM poste_source WHERE ${conditions.join(' AND ')}
         LIMIT 5000`,
      params,
    );

    const features = lignes.map((l) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [l.lon, l.lat] },
      properties: {
        id: l.id,
        nom: l.nom,
        gestionnaire: l.gestionnaire,
        tension: l.tension,
        capaciteResiduelleMw: l.capacite_residuelle_mw,
        etatSaturation: l.etat_saturation,
        fileAttenteMw: l.file_attente_mw,
        quotePartEurParKw: l.quote_part_eur_par_kw,
        enProjet: l.en_projet,
        renforcement: {
          prevu: l.renforcement_prevu,
          horizon: l.renforcement_horizon,
          capaciteAttendueMw: l.renforcement_capacite_mw,
        },
        dateDonnee: l.date_donnee?.toISOString().slice(0, 10) ?? null,
        source: 'postes_sources',
      },
    }));

    // Rayons de raccordement economique indicatifs, calcules a la demande.
    const rayonKm = q.rayonKm ? Number(q.rayonKm) : null;
    const rayons =
      rayonKm && rayonKm > 0
        ? {
            type: 'FeatureCollection' as const,
            features: lignes.map((l) => ({
              type: 'Feature' as const,
              geometry: cercle([l.lon, l.lat], rayonKm * 1000),
              properties: { id: l.id, nom: l.nom, rayonKm, etatSaturation: l.etat_saturation },
            })),
          }
        : null;

    return {
      type: 'FeatureCollection',
      features,
      rayons,
      avertissement:
        "Capacites indicatives issues de Capareseau et des donnees ouvertes des gestionnaires. Non engageantes : seule une etude de raccordement puis une proposition technique et financiere engagent une capacite.",
    };
  });

  // --- Reseau gaz ----------------------------------------------------------
  app.get('/api/carte/reseau-gaz', async (req, rep) => {
    const bbox = bboxDepuisChaine((req.query as { bbox?: string }).bbox ?? '-5.5,41,10,51.5');
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` invalide');

    const [points, lignes] = await Promise.all([
      requete<{
        id: string;
        nom: string | null;
        gestionnaire: string | null;
        capacite_nm3h: number | null;
        rebours_necessaire: boolean | null;
        lon: number;
        lat: number;
      }>(
        `SELECT id, nom, gestionnaire, capacite_nm3h, rebours_necessaire,
                ST_X(geom) AS lon, ST_Y(geom) AS lat
           FROM point_injection_gaz
          WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326) LIMIT 5000`,
        [bbox[0], bbox[1], bbox[2], bbox[3]],
      ),
      requete<{ id: number; gestionnaire: string | null; niveau: string | null; geometrie: string }>(
        `SELECT id, gestionnaire, niveau, ST_AsGeoJSON(ST_Simplify(geom, 0.0005)) AS geometrie
           FROM canalisation_gaz
          WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326) LIMIT 5000`,
        [bbox[0], bbox[1], bbox[2], bbox[3]],
      ),
    ]);

    return {
      pointsInjection: {
        type: 'FeatureCollection',
        features: points.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: {
            id: p.id,
            nom: p.nom,
            gestionnaire: p.gestionnaire,
            capaciteNm3h: p.capacite_nm3h,
            reboursNecessaire: p.rebours_necessaire,
          },
        })),
      },
      canalisations: {
        type: 'FeatureCollection',
        features: lignes.map((l) => ({
          type: 'Feature',
          geometry: JSON.parse(l.geometrie),
          properties: { id: l.id, gestionnaire: l.gestionnaire, niveau: l.niveau },
        })),
      },
    };
  });

  // --- Couche de contraintes generique en GeoJSON -------------------------
  app.get<{ Params: { type: string } }>('/api/carte/couche/:type', async (req, rep) => {
    const q = req.query as { bbox?: string; limite?: string };
    const bbox = bboxDepuisChaine(q.bbox ?? '');
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` requis');

    const lignes = await requete<{
      nom: string | null;
      type: string;
      sous_type: string | null;
      millesime: string | null;
      connecteur: string;
      geometrie: string;
    }>(
      `SELECT nom, type, sous_type, millesime, connecteur,
              ST_AsGeoJSON(ST_Simplify(geom, 0.0002)) AS geometrie
         FROM contrainte
        WHERE type = $1 AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
        LIMIT $6`,
      [req.params.type, bbox[0], bbox[1], bbox[2], bbox[3], Math.min(Number(q.limite ?? 2000), 5000)],
    );

    return {
      type: 'FeatureCollection',
      features: lignes.map((l) => ({
        type: 'Feature',
        geometry: JSON.parse(l.geometrie),
        properties: {
          nom: l.nom,
          type: l.type,
          sousType: l.sous_type,
          millesime: l.millesime,
          source: l.connecteur,
        },
      })),
    };
  });
}
