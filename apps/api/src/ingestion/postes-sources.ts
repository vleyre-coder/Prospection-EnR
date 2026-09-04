/**
 * Ingestion des postes sources et de leurs capacites de raccordement.
 *
 * Constat documente (docs/API_CONTRACTS.md §7) : il n'existe AUCUNE API nationale
 * fournissant des postes sources geolocalises avec leurs quotas S3REnR.
 *   - `opendata.enedis.fr` : catalogue hors service ;
 *   - ODRE `postes-electriques-rte` : pas de coordonnees ;
 *   - data.gouv.fr : uniquement des jeux locaux ou ultramarins.
 *
 * Le seul chemin fiable est capareseau.fr, qui expose deux ressources non contractuelles
 * sous `/medias/<UUID>` :
 *   - un CSV national (3119 postes) avec toutes les donnees S3REnR, SANS coordonnees ;
 *   - un JSON par region, AVEC coordonnees, joignable au CSV par le champ `code`.
 *
 * Ces UUID ne sont pas devinables et doivent etre re-extraits du HTML a chaque ingestion :
 * ils sont traites comme volatiles. L'ingestion est mensuelle et deliberement econome.
 */

import { jsonExterne } from '../http.js';
import { journal } from '../journal.js';
import { requete } from '../bdd.js';
import { enregistrerCouverture, enregistrerIngestion } from '../depots/sources.js';
import { oublierPresenceCouches } from '../connecteurs/couches.js';

const BASE = 'https://www.capareseau.fr';

/** Codes INSEE des regions metropolitaines et ultramarines couvertes par Capareseau. */
const REGIONS = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94'];

interface PosteRegional {
  code?: string;
  name?: string;
  X?: number;
  Y?: number;
  X_l93?: number;
  Y_l93?: number;
  htb_type?: string;
  project?: string;
  u_max?: number;
  updated?: string;
  territory_name?: string;
  grd1?: { name?: string };
  grdHTB?: { name?: string };
  values?: Record<string, string>;
}

/** Extrait les UUID `/medias/...` du HTML d'une page region. */
async function uuidsDepuisPage(url: string): Promise<string[]> {
  const html = await jsonExterne<string>(url, {
    connecteur: 'postes_sources',
    profilAttente: 'patient',
    cacheTtlMs: 0,
    timeoutMs: 30000,
  });
  const texte = typeof html === 'string' ? html : JSON.stringify(html);
  const trouves = texte.match(/\/medias\/[A-F0-9-]{20,40}/gi) ?? [];
  return [...new Set(trouves)];
}

/** Convertit une valeur Capareseau ("16.3", "82.22  k€/MW", "14 %") en nombre. */
function nombreDepuis(v: string | undefined): number | null {
  if (!v) return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ''));
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Deduit l'etat de saturation.
 *
 * `INFO_NA` est la capacite reservee S3REnR restant a affecter ; `*_CDR` la capacite
 * disponible pour le raccordement. Les seuils sont applicatifs et documentes : Capareseau
 * ne publie pas d'etat normalise.
 */
function etatSaturation(
  capaciteMw: number | null,
  tauxRemplissage: number | null,
): 'disponible' | 'tendu' | 'sature' | null {
  // La capacite reellement disponible pour le raccordement gouverne : c'est elle qui
  // determine si un projet peut se raccorder. Le taux de remplissage ne decrit que le
  // remplissage de l'enveloppe reservee au S3REnR - un poste peut avoir une enveloppe
  // S3REnR presque consommee ET des centaines de megawatts disponibles par ailleurs.
  if (capaciteMw != null) {
    if (capaciteMw <= 0) return 'sature';
    if (capaciteMw < 10) return 'tendu';
    return 'disponible';
  }
  // Capacite inconnue : le taux de remplissage est le seul indice disponible.
  if (tauxRemplissage != null) {
    if (tauxRemplissage >= 95) return 'sature';
    if (tauxRemplissage >= 75) return 'tendu';
    return 'disponible';
  }
  return null;
}

/**
 * Enveloppes de plausibilite (lon min, lat min, lon max, lat max) pour la France et les DROM.
 * Une partie des enregistrements Capareseau presente des coordonnees inversees : on les
 * detecte et on les corrige, plutot que de placer des postes au milieu de l'ocean.
 */
const ENVELOPPES: Array<[number, number, number, number]> = [
  [-5.5, 41.0, 10.0, 51.5], // France metropolitaine
  [-61.9, 14.3, -60.7, 16.6], // Guadeloupe et Martinique
  [-55.0, 2.0, -51.0, 6.0], // Guyane
  [55.1, -21.5, 56.0, -20.8], // La Reunion
  [44.9, -13.1, 45.4, -12.6], // Mayotte
];

function dansFrance(lon: number, lat: number): boolean {
  return ENVELOPPES.some(([lo1, la1, lo2, la2]) => lon >= lo1 && lon <= lo2 && lat >= la1 && lat <= la2);
}

/**
 * Determine la position d'un poste.
 * Retourne `null` lorsque aucune interpretation ne donne un point plausible : mieux vaut
 * ignorer un poste que le placer au mauvais endroit et fausser un calcul de distance.
 */
function resoudrePosition(
  p: PosteRegional,
): { lon: number; lat: number; correction: 'aucune' | 'inversion' | 'lambert93' } | null {
  const { X, Y } = p;
  if (typeof X === 'number' && typeof Y === 'number') {
    if (dansFrance(X, Y)) return { lon: X, lat: Y, correction: 'aucune' };
    // Coordonnees inversees dans la source.
    if (dansFrance(Y, X)) return { lon: Y, lat: X, correction: 'inversion' };
  }
  // Repli sur les coordonnees Lambert-93, reprojetees par PostGIS a l'insertion.
  if (typeof p.X_l93 === 'number' && typeof p.Y_l93 === 'number' && p.X_l93 > 0 && p.Y_l93 > 0) {
    return { lon: p.X_l93, lat: p.Y_l93, correction: 'lambert93' };
  }
  return null;
}

function gestionnaireDepuis(p: PosteRegional): 'RTE' | 'Enedis' | 'autre_grd' {
  const noms = [p.grd1?.name, p.grdHTB?.name].filter(Boolean).join(' ').toLowerCase();
  if (noms.includes('enedis')) return 'Enedis';
  if (noms.includes('rte')) return 'RTE';
  // Un poste source est un ouvrage de transformation HTB/HTA : en l'absence de GRD
  // identifie, il est rattache a RTE, gestionnaire du reseau amont.
  return noms.length > 0 ? 'autre_grd' : 'RTE';
}

export async function ingererPostesSources(): Promise<{
  connecteur: string;
  nbPostes: number;
  nbRegionsTraitees: number;
  nbRegionsEnEchec: number;
  nbPositionsCorrigees: number;
  nbPositionsRejetees: number;
}> {
  let nbPostes = 0;
  let nbRegionsTraitees = 0;
  let nbRegionsEnEchec = 0;
  let nbPositionsCorrigees = 0;
  let nbPositionsRejetees = 0;
  /**
   * Regions REELLEMENT telechargees, et non regions ou des postes ont ete trouves.
   *
   * La difference est le risque F4 de l'audit 9. Deduire la couverture des postes observes revient a
   * confondre « on a regarde ici » avec « on a trouve quelque chose ici » : un departement
   * reellement depourvu de poste serait alors declare inconnu, et toutes les parcelles a portee de sa
   * frontiere verraient leur critere de raccordement grise sans raison. La couverture est donc posee
   * sur les departements des regions dont le telechargement a abouti, comptage nul compris.
   */
  const regionsReussies: string[] = [];

  for (const region of REGIONS) {
    try {
      const uuids = await uuidsDepuisPage(`${BASE}/region/${region}`);
      // Les deux premiers UUID sont communs a toutes les pages (autocompletion et CSV
      // national) : le JSON regional geolocalise est l'un des autres.
      let postes: PosteRegional[] = [];
      for (const chemin of uuids) {
        const donnees = await jsonExterne<unknown>(`${BASE}${chemin}`, {
          connecteur: 'postes_sources',
    profilAttente: 'patient',
          cacheTtlMs: 0,
          timeoutMs: 40000,
        }).catch(() => null);
        if (Array.isArray(donnees) && donnees.length > 0) {
          const premier = donnees[0] as PosteRegional;
          // On reconnait le jeu regional a la presence de coordonnees.
          if (premier && typeof premier.X === 'number' && typeof premier.Y === 'number') {
            postes = donnees as PosteRegional[];
            break;
          }
        }
      }

      if (postes.length === 0) {
        nbRegionsEnEchec += 1;
        journal.warn({ region, uuids: uuids.length }, 'Aucun jeu de postes géolocalisés trouve');
        continue;
      }

      for (const p of postes) {
        if (!p.code) continue;
        const position = resoudrePosition(p);
        if (!position) {
          nbPositionsRejetees += 1;
          journal.debug({ code: p.code, X: p.X, Y: p.Y }, 'Poste sans position plausible, ignore');
          continue;
        }
        if (position.correction !== 'aucune') nbPositionsCorrigees += 1;
        const v = p.values ?? {};
        const capacite = nombreDepuis(v['INFO_NA']) ?? nombreDepuis(v['RTE_CDR']) ?? nombreDepuis(v['GRD1_CDR']);
        const capaciteReservee = nombreDepuis(v['INFO_CR']);
        const tauxRemplissage = nombreDepuis(v['INFO_TX']);
        const fileAttente = nombreDepuis(v['INFO_FAS3R']);
        // La quote-part est publiee en k€/MW : conversion en €/kW (rapport de 1 pour 1).
        const quotePart = nombreDepuis(v['INFO_QP']);
        const travaux = [v['RTE_TVX'], v['GRD1_TVX'], v['GRD2_TVX'], v['GRDHTB_TVX']]
          .filter((t) => t && t.trim() !== '')
          .join(' ; ');

        await requete(
          `INSERT INTO poste_source
             (id, nom, gestionnaire, tension, geom, capacite_residuelle_mw, capacite_s3renr_mw,
              etat_saturation, file_attente_mw, quote_part_eur_par_kw, renforcement_prevu,
              renforcement_horizon, en_projet, connecteur, date_donnee, updated_at)
           VALUES ($1, $2, $3, $4,
                   CASE WHEN $16 = 'lambert93'
                        THEN ST_Transform(ST_SetSRID(ST_MakePoint($5, $6), 2154), 4326)
                        ELSE ST_SetSRID(ST_MakePoint($5, $6), 4326) END,
                   $7, $8, $9, $10, $11, $12, $13, $14, 'postes_sources', $15, now())
           ON CONFLICT (id) DO UPDATE SET
             nom = EXCLUDED.nom,
             gestionnaire = EXCLUDED.gestionnaire,
             tension = EXCLUDED.tension,
             geom = EXCLUDED.geom,
             capacite_residuelle_mw = EXCLUDED.capacite_residuelle_mw,
             capacite_s3renr_mw = EXCLUDED.capacite_s3renr_mw,
             etat_saturation = EXCLUDED.etat_saturation,
             file_attente_mw = EXCLUDED.file_attente_mw,
             quote_part_eur_par_kw = EXCLUDED.quote_part_eur_par_kw,
             renforcement_prevu = EXCLUDED.renforcement_prevu,
             renforcement_horizon = EXCLUDED.renforcement_horizon,
             en_projet = EXCLUDED.en_projet,
             date_donnee = EXCLUDED.date_donnee,
             updated_at = now()`,
          [
            p.code,
            p.name ?? p.code,
            gestionnaireDepuis(p),
            p.htb_type ?? null,
            position.lon,
            position.lat,
            capacite,
            capaciteReservee,
            etatSaturation(capacite, tauxRemplissage),
            fileAttente,
            quotePart,
            travaux.length > 0,
            travaux.length > 0 ? travaux.slice(0, 120) : null,
            p.project === '1',
            dateDepuisFrancais(p.updated),
            position.correction,
          ],
        );
        nbPostes += 1;
      }
      nbRegionsTraitees += 1;
      regionsReussies.push(region);
      journal.info({ region, postes: postes.length }, 'Region Capareseau ingeree');
    } catch (err) {
      nbRegionsEnEchec += 1;
      journal.warn({ err, region }, 'Échec de l\'ingestion d\'une région Capareseau');
    }
  }

  /**
   * RATTACHEMENT AU DEPARTEMENT ET COUVERTURE — audit 9, defaut A3.
   *
   * Capareseau ne publie pas le departement du poste, et l'insertion laissait donc
   * `code_departement` vide : ce connecteur n'ecrivait AUCUNE ligne dans `couverture_ingestion`.
   * Personne ne pouvait alors distinguer « aucun poste a moins de 90 km » de « la region n'a pas
   * ete ingeree » — alors que la boucle ci-dessus tolere explicitement l'echec d'une region. Une
   * region manquante faisait attribuer aux parcelles voisines le poste le plus proche de ceux
   * qui restaient, a 90 ou 150 km, note comme une mesure : faux ROUGE sur le critere le plus
   * lourd du profil.
   *
   * Le rattachement se fait par jointure spatiale sur `commune`, comme pour les sites proteges :
   * c'est la seule methode fiable, un identifiant de poste ne portant pas de code geographique.
   */
  if (nbPostes > 0) {
    const rattaches = await requete<{ n: number }>(
      `WITH maj AS (
         UPDATE poste_source p
            SET code_insee = com.code_insee,
                nom_commune = com.nom,
                code_departement = com.code_departement
           FROM commune com
          WHERE p.connecteur = 'postes_sources'
            AND ST_Intersects(com.geom, p.geom)
          RETURNING 1
       )
       SELECT count(*)::int AS n FROM maj`,
    );

    /**
     * Couverture posee sur les departements des REGIONS TELECHARGEES, comptage nul compris.
     *
     * `commune` porte le code de region : c'est ce qui permet de passer de « treize regions
     * demandees, onze abouties » a la liste des departements sur lesquels l'application a le droit
     * d'affirmer. Une region en echec ne pose aucune ligne, donc ses departements restent inconnus et
     * les distances qui les traversent restent grises — ce qui est exactement le but.
     *
     * Si `commune` est vide, aucun departement n'est resolu et rien n'est pose : le critere reste
     * gris. Il faut le dire, sinon l'exploitant croirait l'ingestion exploitable.
     */
    const parDep = await requete<{ code_departement: string; n: number }>(
      `SELECT com.code_departement,
              count(p.id)::int AS n
         FROM commune com
         LEFT JOIN poste_source p
                ON p.connecteur = 'postes_sources' AND p.code_departement = com.code_departement
        WHERE com.code_region = ANY($1)
        GROUP BY com.code_departement`,
      [regionsReussies],
    );
    for (const d of parDep) {
      await enregistrerCouverture('postes_sources', 'poste_source', d.code_departement, d.n);
    }
    oublierPresenceCouches();
    if (parDep.length === 0) {
      journal.warn(
        { nbPostes, regionsReussies: regionsReussies.length },
        'Postes ingérés mais aucun département resolu : table `commune` vide ou codes de région ' +
          'absents. Aucune couverture posée, donc critères de raccordement gris. Lancer ' +
          '`npm run ingest -- communes` puis relancer cette ingestion.',
      );
    }
    journal.info(
      { rattaches: rattaches[0]?.n ?? 0, departementsCouverts: parDep.length },
      'Postes sources rattaches a leur departement',
    );
  }

  const statut = nbPostes === 0 ? 'echec' : nbRegionsEnEchec > 0 ? 'partiel' : 'ok';
  await enregistrerIngestion(
    'postes_sources',
    statut,
    `${nbPostes} postes, ${nbRegionsTraitees}/${REGIONS.length} regions, ` +
      `${nbPositionsCorrigees} position(s) corrigee(s), ${nbPositionsRejetees} rejetee(s)`,
    nbPostes,
  );

  return {
    connecteur: 'postes_sources',
    nbPostes,
    nbRegionsTraitees,
    nbRegionsEnEchec,
    nbPositionsCorrigees,
    nbPositionsRejetees,
  };
}

/** Convertit une date "13/06/2026" en date ISO. */
function dateDepuisFrancais(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
