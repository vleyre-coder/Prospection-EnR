/**
 * Connecteur gisement - ressource energetique.
 *
 * Irradiation et productible : PVGIS (Commission europeenne, base SARAH2), verifie.
 *
 * Vent et intrants methanisables : AUCUNE API nationale ouverte ne les expose de facon
 * exploitable a la parcelle. Ces deux indicateurs sont donc des ESTIMATIONS derivees, et
 * l'application les presente comme telles (source a valeur juridique "indicative",
 * avertissement explicite). Ils ne remplacent ni une campagne de mesure de vent, ni une
 * etude de gisement d'intrants.
 */

import type { Gisement } from '@enr/core';
import { avecParams, jsonExterne } from '../http.js';
import type { Position } from '../geo.js';
import { requete } from '../bdd.js';
import { ventA100m } from './vent.js';

const CONNECTEUR = 'gisement';

interface ReponsePvgis {
  outputs?: {
    // ATTENTION : la cle d'irradiation dans le plan des modules est litteralement
    // "H(i)_y", parentheses incluses - et non "H_i_y".
    totals?: { fixed?: Record<string, number | undefined> };
  };
  inputs?: {
    location?: { elevation?: number };
    mounting_system?: { fixed?: { slope?: { value?: number }; azimuth?: { value?: number } } };
  };
}

/** Irradiation dans le plan des modules et productible annuel, via PVGIS. */
export async function solaire(
  pt: Position,
): Promise<{ irradiationKwhM2An: number | null; productibleKwhKwcAn: number | null }> {
  try {
    // Plan incline optimise : c'est la configuration de reference d'une centrale au sol.
    const url = avecParams('https://re.jrc.ec.europa.eu/api/v5_2/PVcalc', {
      lat: pt[1].toFixed(4),
      lon: pt[0].toFixed(4),
      peakpower: 1,
      loss: 14,
      optimalangles: 1,
      outputformat: 'json',
    });
    const rep = await jsonExterne<ReponsePvgis>(url, { connecteur: CONNECTEUR, timeoutMs: 30000 });
    const fixed = rep.outputs?.totals?.fixed;
    const irradiation = fixed?.['H(i)_y'];
    const productible = fixed?.['E_y'];
    return {
      irradiationKwhM2An: irradiation != null ? Math.round(irradiation) : null,
      productibleKwhKwcAn: productible != null ? Math.round(productible) : null,
    };
  } catch {
    return { irradiationKwhM2An: null, productibleKwhKwcAn: null };
  }
}

/**
 * Gisement de vent a 100 m, echantillonne sur le raster du Global Wind Atlas.
 *
 * Contrairement a ce qui etait initialement suppose, une source nationale exploitable
 * existe : le Global Wind Atlas publie un GeoTIFF par pays, au pas de 250 m pour la France.
 * Il est ingere par un job dedie puis lu localement (voir connecteurs/vent.ts).
 *
 * Il ne remplace pas une campagne de mesure : c'est un modele de reanalyse, avec une
 * incertitude de l'ordre de 0,5 m/s en terrain complexe.
 */
export async function vent(pt: Position): Promise<number | null> {
  return ventA100m(pt);
}

/** Types de contraintes alimentant l'estimation du gisement methanisable. */
const COUCHES_INTRANTS = ['elevage', 'industrie_agroalimentaire', 'surface_agricole_commune'];

/**
 * Ces couches sont-elles ingerees ?
 *
 * Question decisive, et distincte du comptage lui-meme : `count(*)` ne renvoie jamais
 * `null`, il renvoie 0. Sans ce test prealable, une base ou aucune couche d'elevages n'a
 * jamais ete chargee produisait « 0 elevage a moins de 10 km » - un constat de terrain,
 * alors que la bonne reponse est « on n'en sait rien ». Le prospecteur ecartait un secteur
 * sur une donnee inexistante.
 *
 * Le resultat est mis en cache : la reponse ne change qu'apres une ingestion, et la question
 * serait posee une fois par parcelle sur des lots de plusieurs centaines.
 */
let cacheCouches: { valeur: boolean; expire: number } | null = null;

export async function couchesIntrantsIngerees(): Promise<boolean> {
  if (cacheCouches && cacheCouches.expire > Date.now()) return cacheCouches.valeur;
  try {
    const rows = await requete<{ presente: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM contrainte WHERE type = ANY($1)) AS presente`,
      [COUCHES_INTRANTS],
    );
    const valeur = rows[0]?.presente === true;
    cacheCouches = { valeur, expire: Date.now() + 5 * 60 * 1000 };
    return valeur;
  } catch {
    // Base injoignable : on ne peut pas affirmer que la couche existe.
    return false;
  }
}

/** Reinitialise le cache, apres une ingestion. */
export function oublierCouchesIntrantes(): void {
  cacheCouches = null;
}

/**
 * Gisement d'intrants methanisables et debouches, estimes a partir des couches locales
 * ingerees (elevages et industries agroalimentaires recensees en ICPE, RPG agrege par
 * commune).
 *
 * `sourcesIntrantsIngerees` distingue les deux situations que le moteur doit traiter
 * differemment : `false` = aucune couche, l'enjeu n'a pas ete regarde ; `true` avec des
 * comptages nuls = territoire reellement depourvu.
 */
export async function intrantsMethanisation(
  pt: Position,
  codeInsee: string,
): Promise<{
  intrantsMethaTonnesMsAn: number | null;
  elevagesRayon10km: number | null;
  iaaRayon20km: number | null;
  surfacesEpandageHa: number | null;
  sourcesIntrantsIngerees: boolean | null;
}> {
  // Aucune couche ingeree : on ne compte rien, et on le dit. Un comptage a zero sur une
  // table vide serait indiscernable d'un comptage a zero sur un territoire sans elevage.
  if (!(await couchesIntrantsIngerees())) return vide(false);

  try {
    const rows = await requete<{
      elevages: number | null;
      iaa: number | null;
      surfaces_ha: number | null;
    }>(
      `WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS g)
       SELECT
         (SELECT count(*) FROM contrainte c, pt
           WHERE c.type = 'elevage' AND ST_DWithin(c.geom::geography, pt.g, 10000)) AS elevages,
         (SELECT count(*) FROM contrainte c, pt
           WHERE c.type = 'industrie_agroalimentaire' AND ST_DWithin(c.geom::geography, pt.g, 20000)) AS iaa,
         (SELECT sum((c.attributs->>'surface_ha')::numeric) FROM contrainte c, pt
           WHERE c.type = 'surface_agricole_commune' AND ST_DWithin(c.geom::geography, pt.g, 10000)) AS surfaces_ha`,
      [pt[0], pt[1]],
    );
    const r = rows[0];
    if (!r) return vide(true);

    // Les couches EXISTENT (verifie plus haut) : un comptage a zero est ici une vraie
    // absence sur le territoire, et peut donc etre affiche comme telle.
    const elevages = r.elevages ?? 0;
    const iaa = r.iaa ?? 0;
    const surfaces = r.surfaces_ha;

    // Estimation grossiere et documentee : 250 t MS/an d'effluents mobilisables par
    // exploitation d'elevage, 800 t MS/an par industrie agroalimentaire, et 0,4 t MS/ha
    // de CIVE sur les surfaces agricoles a proximite.
    const intrants =
      elevages * 250 + iaa * 800 + (surfaces ?? 0) * 0.4;

    return {
      intrantsMethaTonnesMsAn: Math.round(intrants),
      elevagesRayon10km: elevages,
      iaaRayon20km: iaa,
      surfacesEpandageHa: surfaces == null ? 0 : Math.round(surfaces),
      sourcesIntrantsIngerees: true,
    };
  } catch {
    // Echec de la requete alors que les couches existent : donnee indisponible pour cette
    // parcelle, ce qui n'est pas la meme chose qu'une source absente.
    return vide(true);
  }

  function vide(sourcesIngerees: boolean): {
    intrantsMethaTonnesMsAn: null;
    elevagesRayon10km: null;
    iaaRayon20km: null;
    surfacesEpandageHa: null;
    sourcesIntrantsIngerees: boolean;
  } {
    void codeInsee;
    return {
      intrantsMethaTonnesMsAn: null,
      elevagesRayon10km: null,
      iaaRayon20km: null,
      surfacesEpandageHa: null,
      sourcesIntrantsIngerees: sourcesIngerees,
    };
  }
}

export async function gisementComplet(pt: Position, codeInsee: string): Promise<Partial<Gisement>> {
  const [pv, v, metha] = await Promise.all([
    solaire(pt),
    vent(pt),
    intrantsMethanisation(pt, codeInsee),
  ]);
  return {
    ...pv,
    ventVitesse100mMs: v,
    ...metha,
  };
}
