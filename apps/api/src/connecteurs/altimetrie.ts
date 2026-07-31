/**
 * Connecteur altimetrie - IGN RGE ALTI, service de calcul.
 *
 * Points verifies (docs/API_CONTRACTS.md §9) :
 *   - `resource=ign_rge_alti_wld` est la SEULE valeur acceptee, et le parametre est
 *     obligatoire (sinon HTTP 405) ;
 *   - GET plafonne vers 350 points (au-dela : HTTP 414) ; POST accepte 5000 points ;
 *   - limitation de debit de 1 requete/seconde.
 *
 * La pente est donc calculee en UN SEUL appel POST sur une grille de points echantillonnes
 * dans la parcelle, puis par regression du plan des altitudes.
 */

import type { Topographie } from '@enr/core';
import { config } from '../config.js';
import { jsonExterne } from '../http.js';
import { grilleDansGeometrie, penteDepuisSemis, type GeoJsonGeometry } from '../geo.js';

const CONNECTEUR = 'ign_alti';

interface ReponseElevation {
  elevations?: Array<{ lon: number; lat: number; z: number; acc?: string }>;
}

/** Altitude d'un ensemble de points. Un `z` a -99999 signale une absence de donnee MNT. */
async function altitudes(
  points: Array<[number, number]>,
): Promise<Array<{ lon: number; lat: number; z: number }> | null> {
  if (points.length === 0) return null;
  try {
    const rep = await jsonExterne<ReponseElevation>(
      `${config.sources.geoplateformeAlti}/elevation.json`,
      {
        connecteur: CONNECTEUR,
        methode: 'POST',
        corps: {
          lon: points.map((p) => p[0].toFixed(6)).join('|'),
          lat: points.map((p) => p[1].toFixed(6)).join('|'),
          resource: 'ign_rge_alti_wld',
          delimiter: '|',
          indent: 'false',
        },
        timeoutMs: 30000,
      },
    );
    const valides = (rep.elevations ?? []).filter((e) => Number.isFinite(e.z) && e.z > -1000);
    return valides.length > 0 ? valides : null;
  } catch {
    return null;
  }
}

/**
 * Calcule pente, orientation, altitude et denivele d'une parcelle.
 * Retourne des champs a null en cas d'echec : le critere devient gris, jamais favorable.
 */
export async function topographie(parcelle: GeoJsonGeometry): Promise<Partial<Topographie> | null> {
  // Grille 6x6 : au plus 36 points, largement sous la limite d'un POST, et suffisant pour
  // caracteriser la pente d'une parcelle.
  const points = grilleDansGeometrie(parcelle, 6);
  const cotes = await altitudes(points.map((p) => [p[0], p[1]]));
  if (!cotes) return null;

  const { pentePct, penteMaxPct, orientationDeg, deniveleM } = penteDepuisSemis(cotes);
  const altitudeMoyenne = cotes.reduce((a, c) => a + c.z, 0) / cotes.length;

  return {
    pentePct,
    penteMaxPct,
    orientationDeg,
    deniveleM,
    altitudeM: Math.round(altitudeMoyenne * 10) / 10,
  };
}
