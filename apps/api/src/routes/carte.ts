/** Routes cartographiques : tuiles vectorielles et couches GeoJSON. */

import type { FastifyInstance } from 'fastify';
import { estFiliere, type Filiere } from '@enr/core';
import { config } from '../config.js';
import { requete } from '../bdd.js';
import { avecParams } from '../http.js';
import { bboxDepuisChaine, cercle } from '../geo.js';
import { CALQUES_PAR_ID, urlRasterAmont } from '../calques.js';
import { zonagesSurEmprise } from '../connecteurs/zonages.js';
import * as tuiles from '../services/tuiles.js';
import * as depotParcelles from '../depots/parcelles.js';
import * as depotScores from '../depots/scores.js';
import * as depotProspection from '../depots/prospection.js';
import { erreur } from './erreurs.js';
import { entierRequete, nombreRequete } from '../validation.js';

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
 * Zoom a partir duquel le cadastre complet est relaye.
 *
 * Aligne sur `config.carte.zoomMinParcelles` : les deux couches parcellaires — le cadastre entier et
 * nos parcelles qualifiees — doivent apparaitre au MEME zoom. Un decalage produirait le pire des
 * affichages : des parcelles colorees flottant sans leur voisinage cadastral, ou l'inverse.
 */
const ZOOM_MIN_CADASTRE = config.carte.zoomMinParcelles;

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
        return erreur(rep, 400, 'tuile_invalide', 'Coordonnées de tuile invalides');
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
        req.log.warn({ err, fond: req.params.fond, z, x, y }, 'Relais de tuile IGN en échec');
        return erreur(
          rep,
          502,
          'fond_indisponible',
          "Le service de tuiles IGN est injoignable depuis le serveur.",
        );
      }
    },
  );

  /**
   * Relais du CADASTRE COMPLET, en tuiles vectorielles.
   *
   * POURQUOI CETTE ROUTE EXISTE — signalement d'usage, et le defaut le plus grave trouve depuis
   * l'audit 8. Un prospecteur cherchait une parcelle precise, demandee par un collegue. Il n'a pu ni la
   * qualifier, ni meme LA VOIR en zoomant sur le parcellaire. Sa conclusion etait juste : toutes les
   * parcelles de France n'apparaissaient pas.
   *
   * La cause tient a l'architecture. La couche parcellaire de l'application est servie depuis NOTRE
   * table `parcelle`, qui ne contient que les parcelles deja qualifiees — le commentaire de
   * `config.carte.zoomMinParcelles` le disait explicitement : « seules les parcelles effectivement
   * qualifiees sont en base ». Une parcelle jamais qualifiee n'existait donc nulle part dans
   * l'application : invisible sur la carte, introuvable dans la liste, impossible a designer.
   *
   * S'y ajoutait un filtre de surface a 3 000 m2 applique EN SILENCE a toute qualification d'emprise.
   * Mesure sur trois communes reelles de la Beauce — une region de GRANDES parcelles :
   * Bazoches-les-Hautes 487 parcelles ecartees sur 806 (60 %), Loigny-la-Bataille 377 sur 689 (55 %),
   * Tillay-le-Peneux 609 sur 1 090 (56 %). Ailleurs, la part serait plus forte encore.
   *
   * CE QUE CETTE ROUTE CHANGE. Le Plan Cadastral Informatise est publie par l'IGN en tuiles
   * vectorielles, pour la France entiere. Relaye ici, il fait apparaitre CHAQUE parcelle des le zoom
   * cadastral, qualifiee ou non. La couche qualifiee reste dessinee par-dessus, avec ses couleurs de
   * score : on distingue donc d'un coup d'oeil ce qui a ete etudie de ce qui ne l'a pas ete — au lieu
   * de confondre « pas de parcelle » avec « parcelle pas encore regardee ».
   *
   * Pourquoi un relais et non un appel direct du navigateur : la meme raison que pour le fond de carte.
   * Dans un reseau d'entreprise filtrant les sorties, `data.geopf.fr` est injoignable depuis le poste
   * alors que le serveur y accede. Et la destination est FIXE — aucun parametre du client n'entre dans
   * l'URL amont — donc le relais ne peut pas devenir un proxy ouvert.
   */
  app.get<{ Params: { z: string; x: string; y: string } }>(
    '/api/carte/cadastre/:z/:x/:y.pbf',
    async (req, rep) => {
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 21) {
        return erreur(rep, 400, 'tuile_invalide', 'Coordonnées de tuile invalides');
      }
      const max = 2 ** z;
      if (x < 0 || y < 0 || x >= max || y >= max) return rep.code(204).send();

      /**
       * En dessous du zoom cadastral, on ne relaie rien.
       *
       * Ce n'est pas une optimisation de confort : une tuile de cadastre en vue nationale pese des
       * megaoctets pour un rendu illisible, et le service amont est un bien commun. Le client affiche
       * la couche communale a ces echelles.
       */
      if (z < ZOOM_MIN_CADASTRE) return rep.code(204).send();

      const url = `https://data.geopf.fr/tms/1.0.0/PCI/${z}/${x}/${y}.pbf`;
      try {
        const reponse = await fetch(url, {
          headers: {
            Accept: 'application/vnd.mapbox-vector-tile',
            'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!reponse.ok) {
          // Hors emprise cadastrale (mer, etranger), l'IGN repond 404 : la carte ne doit rien
          // afficher, et ce n'est pas une erreur applicative.
          if (reponse.status === 404 || reponse.status === 400) return rep.code(204).send();
          return erreur(
            rep,
            502,
            'cadastre_indisponible',
            `Le service de tuiles cadastrales IGN a repondu ${reponse.status}.`,
          );
        }
        const tuile = Buffer.from(await reponse.arrayBuffer());
        return rep
          .header('Content-Type', 'application/vnd.mapbox-vector-tile')
          // Le millesime du PCI change deux fois par an : un cache d'une journee est sans risque et
          // epargne le service amont.
          .header('Cache-Control', 'public, max-age=86400')
          .send(tuile);
      } catch (err) {
        req.log.warn({ err, z, x, y }, 'Relais de tuile cadastrale en échec');
        return erreur(
          rep,
          502,
          'cadastre_indisponible',
          'Le service de tuiles cadastrales IGN est injoignable depuis le serveur.',
        );
      }
    },
  );

  /**
   * Relais des polices d'etiquettes (glyphes SDF).
   *
   * MapLibre exige une source de glyphes pour tout libelle affiche sur la carte - les
   * numeros de parcelle en particulier. Sans relais, ces libelles disparaitraient
   * exactement dans le cas ou le fond de carte disparait aussi : un reseau filtrant. La
   * liste des polices est fermee, pour ne pas transformer l'API en proxy ouvert.
   */
  const POLICES_AUTORISEES = new Set(['Open Sans Regular', 'Open Sans Bold']);

  app.get<{ Params: { police: string; plage: string } }>(
    '/api/carte/polices/:police/:plage.pbf',
    async (req, rep) => {
      const police = decodeURIComponent(req.params.police);
      if (!POLICES_AUTORISEES.has(police)) {
        return erreur(rep, 404, 'police_inconnue', `Police non relayee : ${police}`);
      }
      // Les plages de glyphes sont de la forme 0-255, 256-511, ...
      if (!/^\d{1,6}-\d{1,6}$/.test(req.params.plage)) {
        return erreur(rep, 400, 'plage_invalide', 'Plage de glyphes invalide');
      }

      const url =
        'https://data.geopf.fr/annexes/ressources/vectorTiles/fonts/' +
        `${encodeURIComponent(police)}/${req.params.plage}.pbf`;
      try {
        const reponse = await fetch(url, {
          headers: { 'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)' },
          signal: AbortSignal.timeout(20000),
        });
        if (!reponse.ok) {
          // Une plage sans glyphe est normale : MapLibre en demande bien plus qu'il n'en
          // existe. Repondre 204 evite de faire echouer le rendu de la carte.
          if (reponse.status === 404) return rep.code(204).send();
          return erreur(rep, 502, 'polices_indisponibles', `Le service de polices a repondu ${reponse.status}.`);
        }
        return rep
          .header('Content-Type', 'application/x-protobuf')
          .header('Cache-Control', 'public, max-age=2592000, immutable')
          .send(Buffer.from(await reponse.arrayBuffer()));
      } catch (err) {
        req.log.warn({ err, police, plage: req.params.plage }, 'Relais de police en échec');
        return erreur(rep, 502, 'polices_indisponibles', 'Le service de polices est injoignable depuis le serveur.');
      }
    },
  );

  // --- Tuiles vectorielles des parcelles ----------------------------------
  app.get<{ Params: ParamsTuile }>('/api/carte/tuiles/parcelles/:z/:x/:y.mvt', async (req, rep) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    if (![z, x, y].every(Number.isInteger)) return erreur(rep, 400, 'tuile_invalide', 'Coordonnées de tuile invalides');

    if (!tuiles.zoomValidePourParcelles(z)) {
      // En dessous du zoom minimal, le rendu parcellaire n'est ni lisible ni performant :
      // le client doit utiliser la couche communale.
      return rep.code(204).send();
    }

    const tuile = await tuiles.tuileParcelles({ z, x, y }, filiereDepuis(req.query));
    return rep
      .header('Content-Type', 'application/vnd.mapbox-vector-tile')
      // `private` et non `public` : la tuile contient le statut de prospection, propre a
      // l'organisation. Un cache partage (proxy d'entreprise, CDN) ne doit pas la stocker
      // ni la resservir a un autre porteur de jeton.
      .header('Cache-Control', 'private, max-age=60')
      .header('Vary', 'Authorization')
      .send(tuile);
  });

  // --- Tuiles vectorielles des communes (vue nationale) -------------------
  app.get<{ Params: ParamsTuile }>('/api/carte/tuiles/communes/:z/:x/:y.mvt', async (req, rep) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    if (![z, x, y].every(Number.isInteger)) return erreur(rep, 400, 'tuile_invalide', 'Coordonnées de tuile invalides');
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
      // `Number(q.surfaceMin)` valait NaN sur une saisie non numerique, et ce NaN partait en
      // parametre SQL : erreur 500 la ou 400 est la reponse juste (audit 8, C7).
      nombreRequete(q.surfaceMin, 'surfaceMin', { defaut: 0, max: 1e9 }),
      entierRequete(q.limite, 'limite', {
        defaut: config.carte.limiteParcelles,
        min: 1,
        max: config.carte.limiteParcelles,
      }),
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

    /**
     * LE RAYON EST VALIDE ICI, AVANT LA REQUETE — et il ne l'etait pas.
     *
     * `nombreRequete` etait appele une centaine de lignes plus bas, apres l'interrogation de
     * `poste_source`. Le refus arrivait donc bien, avec le bon code 400, mais APRES avoir fait
     * travailler la base pour rien : un appel fautif coutait un aller-retour SQL complet.
     *
     * Ce n'est pas une optimisation, c'est ce qui a rendu un test impossible a satisfaire. Le
     * fichier `routes-validation.test.ts` annonce en tete que « les cas ci-dessous s'arretent
     * avant tout acces a la base, donc aucune base n'est necessaire », et la CI lance
     * precisement `npm test` SANS base. Sur cette seule route l'affirmation etait fausse : la
     * requete partait, echouait sur « database does not exist », et le 500 remplacait le 400
     * attendu. Le test accusait alors la validation d'un defaut qui etait un defaut d'ORDRE.
     * Constate a l'audit 11 en sondant les cinq routes une a une : quatre refusaient en 400
     * sans base, celle-ci rendait 500.
     *
     * `0` sert de sentinelle « non demande », le rayon minimal utile etant strictement positif.
     */
    const rayonDemande = nombreRequete(q.rayonKm, 'rayonKm', { defaut: 0, max: 500 });

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

    // Rayons de raccordement economique indicatifs, calcules a la demande. La validation de
    // `rayonKm` a lieu en tete de route, avant toute requete — voir le commentaire la-bas.
    const rayonKm = rayonDemande > 0 ? rayonDemande : null;
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
        "Capacités indicatives issues de Capareseau et des données ouvertes des gestionnaires. Non engageantes : seule une étude de raccordement puis une proposition technique et financiere engagent une capacité.",
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

  /**
   * Types de contraintes que cette route accepte de servir.
   *
   * LISTE FERMEE — audit 8, defaut D6. Le type demande partait directement en parametre SQL : aucune
   * injection n'etait possible, les requetes etant parametrees, mais rien ne bornait ce qu'un appelant
   * pouvait extraire de la table `contrainte`. Les trois relais externes (fond de carte, glyphes,
   * calques) ont tous une liste fermee, precisement pour ne pas devenir des proxys ouverts ; cette
   * route interne, elle, servait la table entiere. Aujourd'hui `contrainte` ne porte que des
   * monuments historiques, donc rien ne fuit — mais le jour ou elle portera une couche a diffusion
   * restreinte, cette route la servirait sans habilitation.
   *
   * La liste est celle des couches effectivement affichables par l'interface. Y ajouter une entree
   * doit etre un geste conscient.
   */
  const COUCHES_CARTE_AUTORISEES: ReadonlySet<string> = new Set([
    'monument_historique',
    'site_classe',
    'site_inscrit',
    'spr',
    'elevage',
    'industrie_agroalimentaire',
  ]);

  // --- Couche de contraintes generique en GeoJSON -------------------------
  app.get<{ Params: { type: string } }>('/api/carte/couche/:type', async (req, rep) => {
    const q = req.query as { bbox?: string; limite?: string };
    const type = req.params.type;
    if (!COUCHES_CARTE_AUTORISEES.has(type)) {
      return erreur(
        rep,
        404,
        'couche_inconnue',
        `Couche inconnue ou non diffusable : ${type}. Couches servies : ${[...COUCHES_CARTE_AUTORISEES].join(', ')}.`,
      );
    }
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
      [
        type,
        bbox[0],
        bbox[1],
        bbox[2],
        bbox[3],
        entierRequete(q.limite, 'limite', { defaut: 2000, min: 1, max: 5000 }),
      ],
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

  /**
   * Relais des calques d'images (WMTS et WMS officiels).
   *
   * Meme raison que pour le fond de carte : le navigateur d'un poste d'entreprise n'atteint
   * pas toujours `data.geopf.fr`, alors que le serveur y accede. Passer par l'API rend les
   * calques disponibles partout, et permet un cache commun a toute l'equipe.
   *
   * La liste des calques est fermee (catalogue `CALQUES`) : le relais ne doit pas devenir un
   * proxy ouvert.
   */
  app.get<{ Params: { id: string; z: string; x: string; y: string } }>(
    '/api/carte/calque/:id/:z/:x/:y',
    async (req, rep) => {
      const calque = CALQUES_PAR_ID[req.params.id];
      if (!calque || calque.mode !== 'raster') {
        return erreur(rep, 404, 'calque_inconnu', `Calque image inconnu : ${req.params.id}`);
      }
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 21) {
        return erreur(rep, 400, 'tuile_invalide', 'Coordonnées de tuile invalides');
      }
      const max = 2 ** z;
      if (x < 0 || y < 0 || x >= max || y >= max) return rep.code(204).send();

      const url = urlRasterAmont(calque, z, x, y);
      if (!url) return erreur(rep, 500, 'calque_mal_configure', 'Calque sans source image');

      try {
        const reponse = await fetch(url, {
          headers: {
            Accept: 'image/png,image/*',
            'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
          },
          signal: AbortSignal.timeout(25000),
        });
        if (!reponse.ok) {
          // Hors emprise ou hors millesime, les services repondent 400 ou 404 : ce n'est pas
          // une panne, il n'y a simplement rien a dessiner.
          if (reponse.status === 404 || reponse.status === 400) return rep.code(204).send();
          return erreur(
            rep,
            502,
            'calque_indisponible',
            `Le service du calque ${calque.id} a repondu ${reponse.status}.`,
          );
        }
        const type = reponse.headers.get('content-type') ?? 'image/png';
        // Un service WMS signale ses erreurs par un document XML avec un code 200 : le
        // relayer tel quel afficherait un damier d'images cassees.
        if (type.includes('xml') || type.includes('html')) return rep.code(204).send();

        return rep
          .header('Content-Type', type)
          .header('Cache-Control', 'public, max-age=604800')
          .send(Buffer.from(await reponse.arrayBuffer()));
      } catch (err) {
        req.log.warn({ err, calque: calque.id, z, x, y }, 'Relais de calque en échec');
        return erreur(rep, 502, 'calque_indisponible', 'Le service du calque est injoignable.');
      }
    },
  );

  /**
   * Calques vectoriels interroges a la demande sur l'emprise visible.
   *
   * Natura 2000, ZNIEFF, reserves et parcs ne sont publies en images par aucun service
   * fiable : ils sont donc demandes a API Carto pour l'emprise affichee. Le cout est celui
   * d'un appel par calque et par deplacement, ce qui reste acceptable a l'echelle d'un
   * secteur de travail et evite d'imposer une ingestion nationale.
   */
  app.get<{ Params: { id: string } }>('/api/carte/zonage/:id', async (req, rep) => {
    const calque = CALQUES_PAR_ID[req.params.id];
    if (!calque || calque.mode !== 'vecteur_api') {
      return erreur(rep, 404, 'calque_inconnu', `Calque vectoriel inconnu : ${req.params.id}`);
    }
    const q = req.query as { bbox?: string };
    const bbox = bboxDepuisChaine(q.bbox ?? '');
    if (!bbox) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` requis');

    // Emprise bornee : au-dela, les services renvoient des reponses de plusieurs mega-octets
    // que le navigateur ne saurait pas dessiner utilement.
    const etendue = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (etendue > 4) {
      return rep.send({
        type: 'FeatureCollection',
        features: [],
        tropLarge: true,
        message: 'Emprise trop large pour ce calque : zoomez pour l\'afficher.',
      });
    }

    const resultat = await zonagesSurEmprise(calque, bbox);
    return {
      type: 'FeatureCollection',
      features: resultat.features,
      source: calque.source,
      partiel: resultat.echecs.length > 0,
      echecs: resultat.echecs,
    };
  });
}
