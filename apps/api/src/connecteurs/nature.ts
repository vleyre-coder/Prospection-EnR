/**
 * Connecteur milieux naturels - INPN / MNHN via API Carto module Nature.
 *
 * Chemins verifies (docs/API_CONTRACTS.md §5) : `natura-habitat`, `natura-oiseaux`,
 * `znieff1`, `znieff2`, `pn`, `pnr`, `rnn`, `rnc`, `rncf`.
 * `site-inscrit` et `site-classe` N'EXISTENT PAS sur ce module (404) : ils passent par le WFS.
 */

import type { MilieuxNaturels, ZonageNaturel } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxDe, bboxEnPolygone, elargirBbox, type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import { recouvrement } from './distances.js';

const CONNECTEUR = 'apicarto_nature';

/** Rayon d'analyse de la proximite des zonages naturels, en metres. */
const RAYON_ANALYSE_M = 10000;

interface ProprietesInpn {
  id_mnhn?: string | null;
  sitecode?: string | null;
  nom_site?: string | null;
  nom?: string | null;
  url_fiche?: string | null;
}

async function couche(chemin: string, geom: GeoJsonGeometry): Promise<FeatureCollection<ProprietesInpn>> {
  const url = avecParams(`${config.sources.apicarto}/nature/${chemin}`, { geom: geomParam(geom) });
  return jsonExterne<FeatureCollection<ProprietesInpn>>(url, { connecteur: CONNECTEUR });
}

function zonageDepuis(
  parcelle: GeoJsonGeometry,
  fc: FeatureCollection<ProprietesInpn> | null,
): ZonageNaturel {
  if (!fc) return { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };
  const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
  const { recouvre, distanceM } = recouvrement(parcelle, geoms);
  // Le site le plus proche, pour l'afficher dans la fiche.
  const nom =
    fc.features.length > 0
      ? (fc.features[0]!.properties.nom_site ?? fc.features[0]!.properties.nom ?? null)
      : null;
  return {
    recouvre,
    partRecouvrement: recouvre ? 1 : 0,
    distanceM,
    nom,
  };
}

/**
 * Interroge les zonages naturels dans un rayon autour de la parcelle.
 *
 * On interroge sur une emprise ELARGIE, car la proximite (sans recouvrement) est un critere
 * a part entiere : elle declenche l'evaluation des incidences Natura 2000.
 */
export async function milieuxNaturels(
  parcelle: GeoJsonGeometry,
): Promise<{ milieux: Partial<MilieuxNaturels>; echecs: string[] }> {
  const emprise = bboxEnPolygone(elargirBbox(bboxDe(parcelle), RAYON_ANALYSE_M));
  const echecs: string[] = [];

  const chemins = [
    'natura-habitat',
    'natura-oiseaux',
    'znieff1',
    'znieff2',
    'pn',
    'pnr',
    'rnn',
    'rnc',
  ] as const;

  const resultats = await Promise.allSettled(chemins.map((c) => couche(c, emprise)));
  const parChemin: Record<string, FeatureCollection<ProprietesInpn> | null> = {};
  chemins.forEach((c, i) => {
    const r = resultats[i]!;
    if (r.status === 'fulfilled') {
      parChemin[c] = r.value;
    } else {
      parChemin[c] = null;
      echecs.push(`nature/${c}`);
    }
  });

  // Les reserves naturelles nationales, regionales et de Corse sont regroupees :
  // toutes constituent une protection forte au sens du scoring.
  const reserves: FeatureCollection<ProprietesInpn> | null =
    parChemin['rnn'] || parChemin['rnc']
      ? {
          type: 'FeatureCollection',
          features: [...(parChemin['rnn']?.features ?? []), ...(parChemin['rnc']?.features ?? [])],
        }
      : null;

  const milieux: Partial<MilieuxNaturels> = {
    natura2000Habitats: zonageDepuis(parcelle, parChemin['natura-habitat'] ?? null),
    natura2000Oiseaux: zonageDepuis(parcelle, parChemin['natura-oiseaux'] ?? null),
    znieff1: zonageDepuis(parcelle, parChemin['znieff1'] ?? null),
    znieff2: zonageDepuis(parcelle, parChemin['znieff2'] ?? null),
    reserveNaturelle: zonageDepuis(parcelle, reserves),
    coeurParcNational: zonageDepuis(parcelle, parChemin['pn'] ?? null),
    parcNaturelRegional: zonageDepuis(parcelle, parChemin['pnr'] ?? null),
  };

  // Pre-enjeu especes : indicateur derive, faute de donnee d'occurrence exploitable en
  // temps reel. Il combine la proximite des zonages d'inventaire et de protection.
  // C'est une ESTIMATION, signalee comme telle dans la fiche.
  milieux.preEnjeuEspeces = preEnjeuDerive(milieux);
  milieux.sensibiliteAvifaune = milieux.preEnjeuEspeces;
  milieux.sensibiliteChiropteres = milieux.preEnjeuEspeces;

  return { milieux, echecs };
}

/**
 * Indicateur 0-100 derive de la proximite des zonages naturels.
 * Volontairement prudent : en l'absence totale de donnee, il vaut null (critere gris).
 */
function preEnjeuDerive(m: Partial<MilieuxNaturels>): number | null {
  const zonages = [
    m.natura2000Habitats,
    m.natura2000Oiseaux,
    m.znieff1,
    m.reserveNaturelle,
    m.coeurParcNational,
  ].filter((z): z is ZonageNaturel => z != null && (z.recouvre != null || z.distanceM != null));

  if (zonages.length === 0) return null;

  let score = 0;
  for (const z of zonages) {
    if (z.recouvre) {
      score += 40;
    } else if (z.distanceM != null) {
      if (z.distanceM < 500) score += 25;
      else if (z.distanceM < 2000) score += 15;
      else if (z.distanceM < 5000) score += 7;
    }
  }
  return Math.min(100, score);
}
