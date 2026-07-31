/**
 * Connecteurs WFS de la Geoplateforme IGN.
 *
 * Pieges verifies (docs/API_CONTRACTS.md §8) :
 *   - `BBOX` s'exprime en `lon,lat` (et le `CQL_FILTER BBOX()` en `lat,lon`) : une inversion
 *     ne provoque AUCUNE erreur, seulement 0 feature en HTTP 200 ;
 *   - `COUNT` est plafonne a 5000 ;
 *   - la limitation de debit est de 1 requete/seconde avec un burst de 30 : les appels sont
 *     donc serialises par le limiteur de concurrence du client HTTP et mis en cache.
 */

import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxDe, elargirBbox, surfaceM2, type Bbox, type GeoJsonGeometry } from '../geo.js';
import type { FeatureCollection } from './base.js';
import { distanceMinEntreGeometries, recouvrement } from './distances.js';

/** Typenames verifies. */
export const TYPENAMES = {
  bati: 'BDTOPO_V3:batiment',
  troncon_route: 'BDTOPO_V3:troncon_de_route',
  cours_eau: 'BDTOPO_V3:cours_d_eau',
  poste_transformation: 'BDTOPO_V3:poste_de_transformation',
  foret: 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale',
  zones_humides: 'TOURBIERES_ZONES-HUMIDES.BCAE:bcae',
  aoc_viticole: 'AOC-VITICOLES:aire_parcellaire',
  znieff1: 'patrinat_znieff1:znieff1',
  rpg: 'RPG.LATEST:parcelles_graphiques',
} as const;

async function getFeature<P>(
  typename: string,
  bbox: Bbox,
  connecteur: string,
  count = 1000,
): Promise<FeatureCollection<P>> {
  // ATTENTION : ordre lon,lat pour le parametre BBOX du WFS.
  const url = avecParams(config.sources.geoplateformeWfs, {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typename,
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]},EPSG:4326`,
    COUNT: Math.min(count, 5000),
  });
  return jsonExterne<FeatureCollection<P>>(url, { connecteur, timeoutMs: 30000 });
}

// ---------------------------------------------------------------------------
// Bati : distances reglementaires a l'habitat
// ---------------------------------------------------------------------------

interface ProprietesBatiment {
  cleabs?: string;
  usage_1?: string | null;
  usage_2?: string | null;
  nature?: string | null;
  hauteur?: number | null;
  nombre_de_logements?: number | null;
}

/** Un batiment compte-t-il comme habitation au sens de l'article L.515-44 ? */
function estHabitation(p: ProprietesBatiment): boolean {
  const usages = [p.usage_1, p.usage_2].map((u) => (u ?? '').toLowerCase());
  if (usages.some((u) => u.includes('habitation') || u.includes('résidentiel') || u.includes('residentiel'))) {
    return true;
  }
  if ((p.nombre_de_logements ?? 0) > 0) return true;
  // Les batiments agricoles, industriels et les annexes ne sont pas des habitations,
  // mais un batiment de nature indeterminee est traite comme habitation par prudence.
  const nature = (p.nature ?? '').toLowerCase();
  if (nature.includes('agricole') || nature.includes('industriel') || nature.includes('serre')) return false;
  return usages.every((u) => u === '');
}

/**
 * Distances a l'habitat, calculees sur la BD TOPO.
 *
 * `rayonM` doit couvrir le seuil reglementaire de la filiere la plus exigeante (500 m pour
 * l'eolien) plus une marge, afin que la valeur affichee soit exploitable meme au-dela.
 */
export async function distancesBati(
  parcelle: GeoJsonGeometry,
  rayonM = 1500,
): Promise<{
  distanceHabitationM: number | null;
  nbHabitationsRayon500m: number | null;
  densiteBati1km: number | null;
} | null> {
  try {
    const bbox = elargirBbox(bboxDe(parcelle), rayonM);
    const fc = await getFeature<ProprietesBatiment>(TYPENAMES.bati, bbox, 'ign_bdtopo', 3000);

    const habitations = fc.features.filter((f) => f.geometry && estHabitation(f.properties));
    const geomsHabitation = habitations.map((f) => f.geometry as GeoJsonGeometry);

    const distanceHabitationM = distanceMinEntreGeometries(parcelle, geomsHabitation);

    const nbHabitationsRayon500m = geomsHabitation.filter((g) => {
      const d = distanceMinEntreGeometries(parcelle, [g]);
      return d != null && d <= 500;
    }).length;

    // Surface de la bbox d'analyse, en km2, pour normaliser la densite.
    const surfaceKm2 = surfaceM2({
      type: 'Polygon',
      coordinates: [
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[1]],
          [bbox[2], bbox[3]],
          [bbox[0], bbox[3]],
          [bbox[0], bbox[1]],
        ],
      ],
    }) / 1e6;

    return {
      distanceHabitationM,
      nbHabitationsRayon500m,
      densiteBati1km: surfaceKm2 > 0 ? Math.round(fc.features.length / surfaceKm2) : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Voirie : desserte et acces poids lourds
// ---------------------------------------------------------------------------

interface ProprietesRoute {
  cleabs?: string;
  nature?: string | null;
  importance?: string | null;
  largeur_de_chaussee?: number | null;
  nombre_de_voies?: number | null;
}

export async function acces(
  parcelle: GeoJsonGeometry,
): Promise<{ distanceVoirieM: number | null; accesPoidsLourds: boolean | null } | null> {
  try {
    const bbox = elargirBbox(bboxDe(parcelle), 1500);
    const fc = await getFeature<ProprietesRoute>(TYPENAMES.troncon_route, bbox, 'ign_bdtopo', 2000);
    const routes = fc.features.filter((f) => f.geometry);
    if (routes.length === 0) return { distanceVoirieM: null, accesPoidsLourds: null };

    const distanceVoirieM = distanceMinEntreGeometries(
      parcelle,
      routes.map((f) => f.geometry as GeoJsonGeometry),
    );

    // Une chaussee de 5 m ou plus, a moins de 500 m, rend un acces poids lourds plausible.
    const routesLarges = routes.filter((f) => {
      const l = f.properties.largeur_de_chaussee ?? 0;
      const nature = (f.properties.nature ?? '').toLowerCase();
      return l >= 5 || nature.includes('route à') || nature.includes('type autoroutier');
    });
    const distanceRouteLarge =
      routesLarges.length > 0
        ? distanceMinEntreGeometries(parcelle, routesLarges.map((f) => f.geometry as GeoJsonGeometry))
        : null;

    return {
      distanceVoirieM,
      accesPoidsLourds: distanceRouteLarge == null ? null : distanceRouteLarge <= 500,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hydrographie : seuil de 35 m pour la methanisation
// ---------------------------------------------------------------------------

export async function distanceCoursEau(parcelle: GeoJsonGeometry): Promise<number | null> {
  try {
    const bbox = elargirBbox(bboxDe(parcelle), 1000);
    const fc = await getFeature<{ cleabs?: string }>(TYPENAMES.cours_eau, bbox, 'ign_bdtopo', 1000);
    const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    if (geoms.length === 0) return null;
    return distanceMinEntreGeometries(parcelle, geoms);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BD Foret : enjeu defrichement
// ---------------------------------------------------------------------------

interface ProprietesForet {
  code_tfv?: string | null;
  tfv?: string | null;
  essence?: string | null;
}

export async function foret(
  parcelle: GeoJsonGeometry,
  surfaceParcelleM2: number,
): Promise<{ recouvre: boolean | null; partBoisee: number | null; type: string | null } | null> {
  try {
    const fc = await getFeature<ProprietesForet>(TYPENAMES.foret, bboxDe(parcelle), 'ign_bdforet', 500);
    const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    const { recouvre } = recouvrement(parcelle, geoms);
    if (!recouvre) return { recouvre: false, partBoisee: 0, type: null };

    // Part boisee approchee : on ne calcule pas l'intersection exacte cote client, on borne
    // par le rapport des surfaces des formations recouvrantes.
    const surfaceForet = geoms.reduce((a, g) => a + surfaceM2(g), 0);
    const part =
      surfaceParcelleM2 > 0 ? Math.min(1, Math.round((surfaceForet / surfaceParcelleM2) * 100) / 100) : null;
    return {
      recouvre: true,
      partBoisee: part,
      type: fc.features[0]?.properties.tfv ?? fc.features[0]?.properties.essence ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Zones humides (BCAE) : PRE-REPERAGE uniquement
// ---------------------------------------------------------------------------

export async function zoneHumide(
  parcelle: GeoJsonGeometry,
): Promise<'oui' | 'non' | 'a_confirmer' | null> {
  try {
    const bbox = elargirBbox(bboxDe(parcelle), 300);
    const fc = await getFeature<{ type_zone?: string | null }>(
      TYPENAMES.zones_humides,
      bbox,
      'zones_humides',
      1000,
    );
    const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    if (geoms.length === 0) {
      // Absence dans cet inventaire ne vaut pas absence de zone humide : les inventaires
      // departementaux ne sont pas tous integres a la couche BCAE.
      return 'non';
    }
    const { recouvre, distanceM } = recouvrement(parcelle, geoms);
    if (recouvre) {
      const effective = fc.features.some((f) =>
        (f.properties.type_zone ?? '').toLowerCase().includes('effective'),
      );
      return effective ? 'oui' : 'a_confirmer';
    }
    // Une zone humide a moins de 100 m impose de verifier l'extension reelle sur le terrain.
    return distanceM != null && distanceM < 100 ? 'a_confirmer' : 'non';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AOC viticoles (INAO)
// ---------------------------------------------------------------------------

export async function aocViticole(
  parcelle: GeoJsonGeometry,
): Promise<{ presente: boolean; viticole: boolean; appellations: string[] } | null> {
  try {
    const fc = await getFeature<{ denom?: string | null; crinao?: string | null }>(
      TYPENAMES.aoc_viticole,
      bboxDe(parcelle),
      'aoc_viticole',
      500,
    );
    const recouvrantes = fc.features.filter((f) => {
      if (!f.geometry) return false;
      return recouvrement(parcelle, [f.geometry as GeoJsonGeometry]).recouvre;
    });
    const appellations = [
      ...new Set(recouvrantes.map((f) => f.properties.denom).filter((d): d is string => Boolean(d))),
    ];
    return {
      presente: recouvrantes.length > 0,
      viticole: recouvrantes.length > 0,
      appellations,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// RPG via WFS : utilise en repli lorsque le module API Carto RPG echoue
// ---------------------------------------------------------------------------

export interface ProprietesRpgWfs {
  id_parcel?: string;
  surf_parc?: number;
  code_cultu?: string | null;
  code_group?: string | null;
  culture_d1?: string | null;
  culture_d2?: string | null;
}

export async function rpgParWfs(parcelle: GeoJsonGeometry): Promise<FeatureCollection<ProprietesRpgWfs> | null> {
  try {
    return await getFeature<ProprietesRpgWfs>(TYPENAMES.rpg, bboxDe(parcelle), 'apicarto_rpg', 200);
  } catch {
    return null;
  }
}
