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
import { requete, tenterVerrou } from '../bdd.js';
import { enregistrerCouverture, enregistrerIngestion } from '../depots/sources.js';
import { oublierPresenceCouches } from '../connecteurs/couches.js';

import { ingererSitesProteges, ingererZaer } from './wfs-national.js';
import { entitesDepuisFlux, urlRessourceDataGouv } from './flux-geojson.js';
import { telechargerRaster } from '../connecteurs/vent.js';
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
    // Profil patient : une ingestion nationale ne doit pas etre jetee pour un 503 transitoire.
    // Constate a l'execution : l'ancienne attente de 1,2 seconde faisait abandonner apres zero objet.
    { connecteur: 'communes', timeoutMs: 30000, profilAttente: 'patient' },
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
        profilAttente: 'patient',
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
  // Jeu GRDF des sites d'injection de biomethane. Le nom exact du jeu a change au moins
  // une fois : on tente plusieurs identifiants connus, du plus recent au plus ancien,
  // plutot que d'echouer sur un seul.
  const candidats = [
    'les-sites-dinjection-de-biomethane-en-france',
    'sites-dinjection-de-biomethane',
    'sites-d-injection-de-biomethane-en-service',
  ];
  // Opendatasoft plafonne une page a 100 enregistrements ; le jeu en compte plus de 800.
  const PAGE = 100;

  let nbPoints = 0;
  let nbFermes = 0;
  /**
   * Pagination reellement terminee, ou interrompue en cours de route ?
   *
   * AUDIT 9, DEFAUT A4. Le `catch` ci-dessous entoure toute la boucle de pagination : une erreur a
   * la page 3 sur 9 en sortait, et comme `nbPoints > 0` le statut enregistre etait « ok ». Un tiers
   * des sites d'injection de France etait alors declare complet. La distance au site d'injection le
   * plus proche — le critere de raccordement de la methanisation — se calculait sur ce tiers, en
   * silence, et surestimait la distance sans que rien ne le signale.
   */
  let paginationComplete = false;
  for (const jeu of candidats) {
    try {
      let decalage = 0;
      let total = Infinity;
      while (decalage < total) {
        const url = avecParams(`${config.sources.opendataGrdf}/catalog/datasets/${jeu}/records`, {
          limit: PAGE,
          offset: decalage,
        });
        const rep = await jsonExterne<{
          total_count?: number;
          results?: Array<Record<string, unknown>>;
        }>(url, { connecteur: 'reseau_gaz', timeoutMs: 30000, profilAttente: 'patient' });

        const resultats = rep.results ?? [];
        if (resultats.length === 0) break;
        total = rep.total_count ?? resultats.length;

        for (const [index, r] of resultats.entries()) {
          const geo = extraireCoordonnees(r);
          if (!geo) continue;

          // Un site ferme n'offre plus de debouche d'injection : le retenir donnerait une
          // fausse proximite a un projet de methanisation.
          const ouvert = r['site_ouvert'];
          if (ouvert !== undefined && String(ouvert).toLowerCase() === 'false') {
            nbFermes += 1;
            continue;
          }

          const id = String(
            r['id_unique_projet'] ?? r['id'] ?? r['code'] ?? `${jeu}-${decalage + index}`,
          );
          await requete(
            `INSERT INTO point_injection_gaz
               (id, nom, gestionnaire, code_insee, code_departement, geom, capacite_nm3h,
                connecteur, date_donnee, updated_at)
             VALUES ($1, $2, 'GRDF', $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7,
                     'reseau_gaz', current_date, now())
             ON CONFLICT (id) DO UPDATE SET
               nom = EXCLUDED.nom, geom = EXCLUDED.geom, code_insee = EXCLUDED.code_insee,
               code_departement = EXCLUDED.code_departement,
               capacite_nm3h = EXCLUDED.capacite_nm3h, updated_at = now()`,
            [
              id,
              String(r['nom_du_projet'] ?? r['nom'] ?? r['nom_site'] ?? id).slice(0, 300),
              String(r['code_commune'] ?? r['current_code'] ?? r['code_insee'] ?? '').slice(0, 5) ||
                null,
              String(r['code_dep'] ?? '').slice(0, 3) || null,
              geo[0],
              geo[1],
              // Ce jeu publie une capacite de PRODUCTION annuelle en GWh/an, pas un debit
              // d'injection en Nm3/h. Convertir supposerait un nombre d'heures de
              // fonctionnement invente : la colonne reste nulle, et le critere de capacite
              // demeure gris plutot que faux. Seule la distance au point d'injection est
              // exploitee, et c'est elle qui compte pour le raccordement.
              nombreOuNull(r['capacite'] ?? r['capacite_injection'] ?? r['debit_max']),
            ],
          );
          nbPoints += 1;
        }
        decalage += PAGE;
      }
      // Sortie normale de la boucle de pagination : toutes les pages annoncees ont ete lues.
      paginationComplete = true;
      if (nbPoints > 0) break;
    } catch (err) {
      journal.debug({ err, jeu }, "Jeu de données GRDF indisponible, essai suivant");
    }
  }

  /**
   * Couverture departementale, et seulement si la pagination est allee au bout.
   *
   * C'est la condition qui autorise `reseauGaz()` a presenter la distance au site d'injection comme
   * une mesure (audit 9, defaut A3). Une pagination interrompue ne l'autorise pas : le site le plus
   * proche pourrait etre dans la moitie non lue. Aucune ligne de couverture n'est alors ecrite, et
   * le critere reste gris — reponse juste, la ou une distance surestimee penalisait la parcelle.
   */
  let nbDepartements = 0;
  if (nbPoints > 0 && paginationComplete) {
    const parDep = await requete<{ code_departement: string | null; n: number }>(
      `SELECT code_departement, count(*)::int AS n FROM point_injection_gaz
        WHERE connecteur = 'reseau_gaz' GROUP BY code_departement`,
    );
    for (const d of parDep) {
      if (d.code_departement) {
        await enregistrerCouverture('reseau_gaz', 'point_injection_gaz', d.code_departement, d.n);
        nbDepartements += 1;
      }
    }
    oublierPresenceCouches();
  }

  const statut = nbPoints === 0 ? 'echec' : paginationComplete ? 'ok' : 'partiel';
  await enregistrerIngestion(
    'reseau_gaz',
    statut,
    nbPoints > 0
      ? `${nbPoints} sites d'injection en service, ${nbFermes} sites fermes ecartes, ` +
        `${nbDepartements} departement(s) couvert(s)` +
        (paginationComplete ? '' : ' — PAGINATION INTERROMPUE, couverture non enregistree')
      : "Aucun jeu GRDF exploitable : vérifier les identifiants de jeux sur opendata.grdf.fr",
    nbPoints,
  );
  return { connecteur: 'reseau_gaz', nbPoints };
}

export function extraireCoordonnees(r: Record<string, unknown>): [number, number] | null {
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

/**
 * Convertit une valeur de jeu ouvert en nombre, ou `null`.
 *
 * ATTENTION AU PIEGE DE LA CHAINE VIDE. `Number('')` vaut **0**, et `0` est fini : sans garde
 * explicite, un champ vide devenait donc `0` au lieu de « inconnu ». Deux consequences reelles,
 * decouvertes par le test de ce module :
 *   - une capacite d'injection gaz non renseignee ressortait a 0 m3/h, ce qui se lit comme
 *     « aucune capacite » et non comme « capacite inconnue » ;
 *   - surtout, une longitude ou une latitude vide donnait `[0, 0]` — un point dans le golfe de
 *     Guinee, ingere en base comme une geometrie parfaitement valide, sur un jeu de 46 000
 *     monuments. Les bornes de vraisemblance ne l'auraient pas vu : elles couvrent les grandeurs
 *     du snapshot, pas les geometries ingerees.
 *
 * La virgule decimale francaise reste convertie : les jeux publies en France ecrivent « 1,75 ».
 */
export function nombreOuNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const brut = v.trim();
    // Chaine vide ou blanche : absence, pas zero.
    if (brut === '') return null;
    const n = Number(brut.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Patrimoine : monuments historiques
// ---------------------------------------------------------------------------

/**
 * Jeu de donnees national des immeubles proteges au titre des monuments historiques
 * (base Merimee, ministere de la Culture), publie sur data.gouv.fr.
 *
 * Le portail Opendatasoft `data.culture.gouv.fr` a ete ferme : il redirige desormais vers
 * une plateforme differente et son API Explore n'existe plus. L'ingestion passe donc par le
 * fichier GeoJSON national, dont l'URL est resolue a l'execution (elle porte un horodatage
 * qui change a chaque publication).
 *
 * Le fichier pese environ 220 Mo pour 46 000 entites : il est lu EN FLUX, entite par entite.
 */
const JEU_MONUMENTS = '65cb6f939898f97cedd0d6d4';

/** Le champ `nature_de_la_protection` distingue classement et inscription. */
export function sousTypeProtection(p: Record<string, unknown>): string {
  const texte = [p['typologie_de_la_protection'], p['date_et_typologie_de_la_protection']]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  if (texte.includes('class')) return 'classe';
  if (texte.includes('inscri')) return 'inscrit';
  return 'protege';
}

export async function ingererPatrimoine(): Promise<{
  connecteur: string;
  nbObjets: number;
  nbSansGeometrie: number;
  millesime: string | null;
}> {
  let nbObjets = 0;
  let nbSansGeometrie = 0;
  let millesime: string | null = null;

  try {
    const ressource = await urlRessourceDataGouv(JEU_MONUMENTS, 'geojson');
    millesime = ressource.derniereMaj;
    journal.info({ url: ressource.url, millesime }, 'Téléchargement du jeu monuments historiques');

    // Insertion par lots : une transaction par entite couterait des heures sur 46 000 objets.
    const lot: Array<[string, string, string, number, number, string, string | null]> = [];
    const viderLot = async (): Promise<void> => {
      if (lot.length === 0) return;
      await requete(
        `INSERT INTO contrainte
           (type, sous_type, nom, identifiant_source, geom, attributs, connecteur,
            code_departement, date_donnee)
         SELECT 'monument_historique', d.sous_type, d.nom, d.identifiant,
                ST_SetSRID(ST_MakePoint(d.lon, d.lat), 4326), d.attributs::jsonb,
                'patrimoine_culture', d.dep, current_date
           FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[],
                       $6::text[], $7::text[])
                AS d(sous_type, nom, identifiant, lon, lat, attributs, dep)
         ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
           sous_type = EXCLUDED.sous_type,
           nom = EXCLUDED.nom,
           geom = EXCLUDED.geom,
           attributs = EXCLUDED.attributs,
           code_departement = EXCLUDED.code_departement,
           date_donnee = EXCLUDED.date_donnee,
           -- REVUE PAR CETTE INGESTION. Sans cette ligne, rien ne distingue un objet reecrit d'un
           -- objet oublie : effacerDisparus compte comme « disparu de la source » toute ligne dont
           -- updated_at precede le debut du run.
           --
           -- Ce connecteur n'est PAS encore soumis a l'effacement : seuls zaer_local et
           -- patrimoine_sites le sont. Le defaut n'etait donc pas actif, c'etait un piege pose pour
           -- plus tard. Le jour ou quelqu'un branche l'effacement sur le patrimoine culturel, tous
           -- les monuments passeraient d'un coup pour disparus. Le plafond de volumetrie les
           -- sauverait (100 % depasse largement les 20 %), mais la suppression ne fonctionnerait
           -- alors JAMAIS pour ce connecteur, et l'avertissement tomberait a chaque ingestion sans
           -- que sa cause soit visible. Trouve en verifiant le risque F4 de l'audit 10.
           updated_at = now()`,
        [
          lot.map((l) => l[0]),
          lot.map((l) => l[1]),
          lot.map((l) => l[2]),
          lot.map((l) => l[3]),
          lot.map((l) => l[4]),
          lot.map((l) => l[5]),
          lot.map((l) => l[6]),
        ],
      );
      lot.length = 0;
    };

    for await (const entite of entitesDepuisFlux(ressource.url)) {
      const p = entite.properties ?? {};
      const g = entite.geometry;
      if (!g || g.type !== 'Point') {
        nbSansGeometrie += 1;
        continue;
      }
      const coords = g.coordinates as [number, number];
      if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
        nbSansGeometrie += 1;
        continue;
      }

      const identifiant = String(p['reference'] ?? p['identifiant_agregee'] ?? `${coords[0]},${coords[1]}`);
      const nom = String(
        p['titre_editorial_de_la_notice'] ?? p['denomination_de_l_edifice'] ?? identifiant,
      ).slice(0, 300);
      const dep = String(p['departement_format_numerique'] ?? '').padStart(2, '0').slice(0, 3) || null;

      // Seuls les attributs utiles a la fiche sont conserves : la notice Merimee compte
      // plus de soixante-dix champs, dont la plupart sont sans usage ici.
      const attributs = {
        reference: p['reference'] ?? null,
        commune: p['commune_forme_editoriale'] ?? p['commune_forme_index'] ?? null,
        adresse: p['adresse_forme_editoriale'] ?? null,
        protection: p['date_et_typologie_de_la_protection'] ?? null,
        denomination: p['denomination_de_l_edifice'] ?? null,
        siecle: p['format_abrege_du_siecle_de_construction'] ?? null,
        lien: p['liens_externes'] ?? null,
      };

      lot.push([
        sousTypeProtection(p),
        nom,
        identifiant,
        coords[0],
        coords[1],
        JSON.stringify(attributs),
        dep,
      ]);
      nbObjets += 1;

      if (lot.length >= 500) await viderLot();
      if (nbObjets % 5000 === 0) journal.info({ nbObjets }, 'Monuments historiques ingeres');
    }
    await viderLot();
  } catch (err) {
    journal.error({ err }, "Échec de l'ingestion du patrimoine");
    await enregistrerIngestion('patrimoine_culture', 'echec', (err as Error).message, nbObjets);
    return { connecteur: 'patrimoine_culture', nbObjets, nbSansGeometrie, millesime };
  }

  // Trace de couverture par departement : indispensable pour ne pas conclure a tort a
  // l'absence de monument dans un secteur non ingere.
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
    `${nbObjets} monuments, ${nbSansGeometrie} sans geometrie exploitable, ${parDep.length} departements`,
    nbObjets,
    millesime,
  );
  return { connecteur: 'patrimoine_culture', nbObjets, nbSansGeometrie, millesime };
}

// ---------------------------------------------------------------------------
// Gisement de vent
// ---------------------------------------------------------------------------

/**
 * Telecharge le raster national de vitesse de vent a 100 m (Global Wind Atlas).
 *
 * Environ 55 Mo, republie a l'occasion des nouvelles versions du modele : une ingestion
 * annuelle suffit.
 */
export async function ingererVent(): Promise<{ connecteur: string; octets: number; chemin: string }> {
  const r = await telechargerRaster();
  await enregistrerIngestion(
    'vent_100m',
    'ok',
    `Raster Global Wind Atlas a 100 m, ${Math.round(r.octets / 1_048_576)} Mo`,
    null,
  );
  return { connecteur: 'vent_100m', ...r };
}

// ---------------------------------------------------------------------------
// Registre des jobs
// ---------------------------------------------------------------------------

export const JOBS: Record<string, () => Promise<Record<string, unknown>>> = {
  communes: ingererCommunes,
  postes_sources: ingererPostesSources,
  reseau_gaz: ingererReseauGaz,
  patrimoine_culture: ingererPatrimoine,
  vent_100m: ingererVent,
  // Ajoutes a l'audit 8 : ces deux couches etaient LUES par l'application et ecrites par personne.
  // `patrimoine_sites` ferme le defaut B1 par la donnee plutot que par le gris, et rend le knock-out
  // eolien du site classe reellement atteignable. `zaer_local` rend renseigne l'argument
  // reglementaire le plus utile de la prospection depuis la loi APER.
  patrimoine_sites: ingererSitesProteges,
  zaer_local: ingererZaer,
};

/** Signalee quand une ingestion du meme connecteur est deja en cours. */
export class ErreurIngestionEnCours extends Error {
  constructor(public readonly connecteur: string) {
    super(
      `Une ingestion du connecteur ${connecteur} est deja en cours. ` +
        'Attendez sa fin : la lancer deux fois consomme deux fois le quota des sources publiques.',
    );
    this.name = 'ErreurIngestionEnCours';
  }
}

/**
 * Cle de verrou consultatif propre a un connecteur.
 *
 * Un entier stable derive du nom, dans une plage reservee aux ingestions pour ne pas heurter les
 * verrous nommes du demarrage (864 202 pour l'amorcage, 864 203 pour le rescoring).
 */
export function cleVerrouIngestion(connecteur: string): number {
  let h = 0;
  for (const c of connecteur) h = (h * 31 + c.charCodeAt(0)) % 1_000_000;
  return 865_000_000 + h;
}

/**
 * Lance un job d'ingestion, UNE SEULE A LA FOIS PAR CONNECTEUR.
 *
 * POURQUOI CE VERROU — audit 10, defaut B3. Cette fonction est appelee depuis trois endroits : la
 * route d'administration `POST /api/admin/ingestions/:connecteur`, le script `npm run ingest`, et
 * l'amorcage au demarrage. Aucun des trois ne s'excluait des deux autres, et la route n'avait ni
 * verrou ni limitation de debit — alors qu'elle declenche le traitement le plus lourd du projet :
 * l'ingestion des ZAER lit 1,09 million d'objets sur le WFS de la Geoplateforme en une vingtaine de
 * minutes. Deux appels rapproches faisaient donc deux fois le meme telechargement, sur un quota
 * partage par toute l'equipe, et le second n'apportait rien.
 *
 * L'amorcage possedait deja un verrou (`tenterVerrou(864_202)`) avec cette justification exacte :
 * « en developpement, `tsx watch` relance le serveur a chaque sauvegarde ». La protection existait
 * donc, au bon endroit, et n'avait jamais ete etendue au declenchement manuel.
 *
 * Le verrou est CONSULTATIF et NON BLOQUANT : un second appel echoue immediatement avec un motif
 * explicite, plutot que d'attendre vingt minutes derriere le premier.
 */
/**
 * Execute `travail` sous verrou exclusif pour ce connecteur, ou refuse.
 *
 * EXTRAITE POUR ETRE TESTABLE EN QUELQUES MILLISECONDES, et c'est la seule raison. La partie risquee
 * de ce mecanisme n'est pas la prise du verrou, c'est sa LIBERATION quand le travail echoue : un
 * verrou consultatif est tenu par une connexion dediee, donc un `finally` manquant laisserait le
 * connecteur bloque jusqu'au redemarrage du serveur — la correction serait alors pire que le defaut
 * qu'elle repare.
 *
 * Ma premiere version testait cette liberation en lancant un vrai job d'ingestion, qui echoue faute
 * de reseau apres avoir epuise le profil de reprise « patient » : plus de trois minutes par
 * execution, et autant a chaque verification par mutation. Un test lent est un test qu'on finit par
 * ne plus lancer. Avec cette fonction, le meme chemin de code se verifie instantanement en lui
 * passant un travail qui leve.
 */
export async function avecVerrouIngestion<T>(
  connecteur: string,
  travail: () => Promise<T>,
): Promise<T> {
  const liberer = await tenterVerrou(cleVerrouIngestion(connecteur));
  if (!liberer) {
    journal.warn({ connecteur }, 'Ingestion refusée : une autre est en cours pour ce connecteur');
    throw new ErreurIngestionEnCours(connecteur);
  }
  try {
    return await travail();
  } finally {
    await liberer();
  }
}

export async function lancerIngestion(connecteur: string): Promise<Record<string, unknown>> {
  const job = JOBS[connecteur];
  if (!job) {
    throw new Error(
      `Aucun job d'ingestion pour "${connecteur}". Jobs disponibles : ${Object.keys(JOBS).join(', ')}`,
    );
  }

  return avecVerrouIngestion(connecteur, async () => {
    journal.info({ connecteur }, 'Debut d\'ingestion');
    const debut = Date.now();
    const resultat = await job();
    journal.info({ connecteur, dureeMs: Date.now() - debut, ...resultat }, 'Ingestion terminee');
    return { ...resultat, dureeMs: Date.now() - debut };
  });
}
