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

/**
 * Gisement d'intrants methanisables et debouches, estimes a partir des donnees locales
 * ingerees (RPG agrege par commune, elevages, industries agroalimentaires recensees en
 * ICPE). En l'absence de ces couches, les champs restent a null.
 */
export async function intrantsMethanisation(
  pt: Position,
  codeInsee: string,
): Promise<{
  intrantsMethaTonnesMsAn: number | null;
  elevagesRayon10km: number | null;
  iaaRayon20km: number | null;
  surfacesEpandageHa: number | null;
}> {
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
    if (!r) return vide();

    const elevages = r.elevages;
    const iaa = r.iaa;
    const surfaces = r.surfaces_ha;

    // Aucune couche ingeree : on ne devine pas.
    if (elevages == null && iaa == null && surfaces == null) return vide();

    // Estimation grossiere et documentee : 250 t MS/an d'effluents mobilisables par
    // exploitation d'elevage, 800 t MS/an par industrie agroalimentaire, et 0,4 t MS/ha
    // de CIVE sur les surfaces agricoles a proximite.
    const intrants =
      (elevages ?? 0) * 250 + (iaa ?? 0) * 800 + (surfaces ?? 0) * 0.4;

    return {
      intrantsMethaTonnesMsAn: intrants > 0 ? Math.round(intrants) : null,
      elevagesRayon10km: elevages,
      iaaRayon20km: iaa,
      surfacesEpandageHa: surfaces == null ? null : Math.round(surfaces),
    };
  } catch {
    return vide();
  }

  function vide(): {
    intrantsMethaTonnesMsAn: null;
    elevagesRayon10km: null;
    iaaRayon20km: null;
    surfacesEpandageHa: null;
  } {
    void codeInsee;
    return {
      intrantsMethaTonnesMsAn: null,
      elevagesRayon10km: null,
      iaaRayon20km: null,
      surfacesEpandageHa: null,
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
