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
import { couchesPresentes, oublierPresenceCouches } from './couches.js';
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
 * Types de contraintes alimentant l'estimation du gisement methanisable.
 *
 * Les TROIS sont independantes : chacune a son propre etat d'ingestion, et il faut le savoir couche
 * par couche (voir `couchesIntrantsIngerees`).
 */
const COUCHES_INTRANTS = ['elevage', 'industrie_agroalimentaire', 'surface_agricole_commune'] as const;

/**
 * Ces couches sont-elles ingerees ? UNE REPONSE PAR COUCHE.
 *
 * Question decisive, et distincte du comptage lui-meme : `count(*)` ne renvoie jamais `null`, il
 * renvoie 0. Sans ce test prealable, une base ou aucune couche d'elevages n'a jamais ete chargee
 * produisait « 0 elevage a moins de 10 km » — un constat de terrain, alors que la bonne reponse est
 * « on n'en sait rien ». Le prospecteur ecartait un secteur sur une donnee inexistante.
 *
 * CE RAISONNEMENT ETAIT JUSTE ET L'IMPLEMENTATION LE TRAHISSAIT (audit 8, D1). La version
 * precedente posait UNE seule question pour TROIS couches :
 *
 *     SELECT EXISTS (SELECT 1 FROM contrainte WHERE type = ANY($1)) AS presente
 *
 * Une base ou une seule des trois couches serait ingeree repondait donc `true`, et le code affirmait
 * alors « 0 IAA » et « 0 ha d'epandage » comme des absences reelles sur le territoire — exactement
 * ce que le commentaire ci-dessus disait vouloir eviter. Une question posee globalement ne peut pas
 * repondre par couche.
 */
export async function couchesIntrantsIngerees(): Promise<Record<string, boolean>> {
  return couchesPresentes(COUCHES_INTRANTS);
}

/** Reinitialise le cache, apres une ingestion. */
export function oublierCouchesIntrantes(): void {
  oublierPresenceCouches();
}

/** Rendements documentes de l'estimation. Sortis du corps de fonction pour etre citables. */
export const RENDEMENTS_INTRANTS = {
  /** t MS/an d'effluents mobilisables par exploitation d'elevage. */
  parElevage: 250,
  /** t MS/an par industrie agroalimentaire. */
  parIaa: 800,
  /** t MS/an de CIVE par hectare de surface agricole a proximite. */
  parHectare: 0.4,
} as const;

export interface Intrants {
  intrantsMethaTonnesMsAn: number | null;
  elevagesRayon10km: number | null;
  iaaRayon20km: number | null;
  surfacesEpandageHa: number | null;
  sourcesIntrantsIngerees: boolean | null;
}

/**
 * Agrege les comptages en tenant compte de l'etat d'ingestion COUCHE PAR COUCHE.
 *
 * Fonction pure, exportee pour etre testable sans base : les deux defauts qu'elle corrige sont des
 * confusions entre `null` et `0`, et le seul moyen de prouver qu'elles sont mortes est d'enumerer
 * les combinaisons d'ingestion partielle.
 *
 * REGLE. Un comptage n'est retenu que si SA couche est ingeree — sinon il vaut `null`, jamais `0`.
 * Et le total n'est calcule que si les TROIS couches le sont : un total partiel serait une borne
 * inferieure presentee comme une estimation, ce qui est la meme faute sous une autre forme. Le
 * detail des couches disponibles reste expose, parce qu'il informe sans rien affirmer de faux.
 */
export function agregerIntrants(
  presence: Record<string, boolean>,
  comptes: { elevages: number | null; iaa: number | null; surfacesHa: number | null },
): Intrants {
  const elevages = presence['elevage'] ? (comptes.elevages ?? 0) : null;
  const iaa = presence['industrie_agroalimentaire'] ? (comptes.iaa ?? 0) : null;
  // `sum()` renvoie NULL sur un ensemble vide, la ou `count()` renvoie 0 : sur une couche ingeree,
  // une somme nulle est bien une absence de surface, et vaut donc 0. Sur une couche absente, elle
  // vaut `null`. La version precedente ecrivait `surfaces == null ? 0 : ...`, ce qui rendait les
  // deux cas indiscernables.
  const surfaces = presence['surface_agricole_commune'] ? (comptes.surfacesHa ?? 0) : null;

  const toutesIngerees = elevages != null && iaa != null && surfaces != null;
  const total = toutesIngerees
    ? Math.round(
        elevages * RENDEMENTS_INTRANTS.parElevage +
          iaa * RENDEMENTS_INTRANTS.parIaa +
          surfaces * RENDEMENTS_INTRANTS.parHectare,
      )
    : null;

  return {
    intrantsMethaTonnesMsAn: total,
    elevagesRayon10km: elevages,
    iaaRayon20km: iaa,
    surfacesEpandageHa: surfaces == null ? null : Math.round(surfaces),
    sourcesIntrantsIngerees: toutesIngerees,
  };
}

/** Aucune couche, aucun comptage : le releve vide, avec le motif. */
function intrantsVides(sourcesIngerees: boolean | null): Intrants {
  return {
    intrantsMethaTonnesMsAn: null,
    elevagesRayon10km: null,
    iaaRayon20km: null,
    surfacesEpandageHa: null,
    sourcesIntrantsIngerees: sourcesIngerees,
  };
}

/**
 * Gisement d'intrants methanisables et debouches, estimes a partir des couches locales ingerees
 * (elevages et industries agroalimentaires recensees en ICPE, RPG agrege par commune).
 *
 * `sourcesIntrantsIngerees` distingue les situations que le moteur doit traiter differemment :
 * `false` = les trois couches ne sont pas toutes la, l'enjeu n'a pas ete regarde en entier ;
 * `true` avec des comptages nuls = territoire reellement depourvu.
 */
export async function intrantsMethanisation(pt: Position, codeInsee: string): Promise<Intrants> {
  void codeInsee;
  const presence = await couchesPresentes(COUCHES_INTRANTS);
  // Aucune des trois couches : rien a compter, et on le dit. Un comptage a zero sur une table vide
  // serait indiscernable d'un comptage a zero sur un territoire sans elevage.
  if (!COUCHES_INTRANTS.some((t) => presence[t])) return intrantsVides(false);

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
    // Requete aboutie mais sans ligne : anomalie, pas une absence de couche.
    if (!r) return intrantsVides(null);

    return agregerIntrants(presence, {
      elevages: r.elevages,
      iaa: r.iaa,
      surfacesHa: r.surfaces_ha,
    });
  } catch {
    // Echec de la requete alors que des couches existent : donnee indisponible pour cette parcelle,
    // ce qui n'est pas la meme chose qu'une source absente.
    return intrantsVides(null);
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
