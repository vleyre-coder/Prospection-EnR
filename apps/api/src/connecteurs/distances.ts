/**
 * Calculs de distance entre une parcelle et un ensemble d'objets geographiques.
 *
 * Les distances sont calculees sur les sommets et les segments des geometries, en metres,
 * avec une approximation locale equirectangulaire. L'erreur est inferieure au metre a
 * l'echelle d'une parcelle, ce qui est suffisant pour un pre-reperage - mais les seuils
 * reglementaires (500 m eolien, 200 m methanisation) doivent etre re-verifies sur un fond
 * topographique au stade du dimensionnement.
 */

import { distanceM, pointDansGeometrie, positions, type GeoJsonGeometry, type Position } from '../geo.js';

/** Distance d'un point a un segment, en metres. */
function distancePointSegment(p: Position, a: Position, b: Position): number {
  const latRef = (a[1] + b[1]) / 2;
  const cos = Math.cos((latRef * Math.PI) / 180);
  const px = p[0] * cos;
  const py = p[1];
  const ax = a[0] * cos;
  const ay = a[1];
  const bx = b[0] * cos;
  const by = b[1];

  const dx = bx - ax;
  const dy = by - ay;
  const longueur2 = dx * dx + dy * dy;
  if (longueur2 === 0) return distanceM(p, a);

  let t = ((px - ax) * dx + (py - ay) * dy) / longueur2;
  t = Math.max(0, Math.min(1, t));
  const projection: Position = [(ax + t * dx) / cos, ay + t * dy];
  return distanceM(p, projection);
}

/** Segments d'une geometrie (anneaux de polygones, lignes). */
function segments(geom: GeoJsonGeometry): Array<[Position, Position]> {
  const out: Array<[Position, Position]> = [];
  const ajouterLigne = (ligne: Position[]): void => {
    for (let i = 0; i < ligne.length - 1; i += 1) {
      out.push([ligne[i]!, ligne[i + 1]!]);
    }
  };
  const parcourir = (n: unknown, profondeur: number): void => {
    if (!Array.isArray(n) || n.length === 0) return;
    const premier = n[0];
    if (Array.isArray(premier) && typeof premier[0] === 'number') {
      ajouterLigne(n as Position[]);
      return;
    }
    if (typeof premier === 'number') return;
    for (const enfant of n) parcourir(enfant, profondeur + 1);
  };
  parcourir(geom.coordinates, 0);
  return out;
}

/**
 * Distance minimale entre une geometrie de reference et une liste de geometries cibles.
 * Retourne 0 en cas de recouvrement, null si la liste est vide.
 */
export function distanceMinEntreGeometries(
  reference: GeoJsonGeometry,
  cibles: GeoJsonGeometry[],
): number | null {
  if (cibles.length === 0) return null;
  const ptsRef = positions(reference);
  if (ptsRef.length === 0) return null;

  let min = Infinity;
  for (const cible of cibles) {
    // Recouvrement : un sommet de la reference est dans la cible, ou inversement.
    if (ptsRef.some((p) => pointDansGeometrie(p, cible))) return 0;
    const ptsCible = positions(cible);
    if (ptsCible.some((p) => pointDansGeometrie(p, reference))) return 0;

    const segsCible = segments(cible);
    for (const p of ptsRef) {
      for (const [a, b] of segsCible) {
        const d = distancePointSegment(p, a, b);
        if (d < min) min = d;
      }
      if (segsCible.length === 0) {
        for (const q of ptsCible) {
          const d = distanceM(p, q);
          if (d < min) min = d;
        }
      }
    }
    // Cas symetrique : la cible peut etre un point, la reference un polygone.
    const segsRef = segments(reference);
    for (const q of ptsCible) {
      for (const [a, b] of segsRef) {
        const d = distancePointSegment(q, a, b);
        if (d < min) min = d;
      }
    }
  }
  return Number.isFinite(min) ? Math.round(min) : null;
}

/**
 * Part d'une geometrie de reference reellement couverte par une geometrie cible, entre 0 et 1.
 *
 * Estimation par echantillonnage regulier : une grille de points est tiree dans l'emprise de
 * la reference, on ne garde que ceux qui tombent dedans, et on compte ceux qui tombent aussi
 * dans la cible. Avec ~400 points utiles, l'incertitude est de l'ordre de 2 a 3 points de
 * pourcentage - largement suffisant pour departager deux zonages d'urbanisme, et sans
 * dependance a une bibliotheque de geometrie.
 *
 * Ce que cela remplace : `surface(zone) / surface(parcelle)`, plafonne a 1, qui n'etait pas
 * une part de recouvrement mais un rapport de tailles. Comme presque toute zone de PLU est
 * plus vaste qu'une parcelle, la valeur valait 1 pour quasiment toutes les zones et le
 * « zonage dominant » se reduisait a l'ordre de reponse du service - alors qu'il gouverne un
 * knock-out.
 */
export function partCouverte(
  reference: GeoJsonGeometry,
  cible: GeoJsonGeometry,
  cote = 40,
): number | null {
  const pts = positions(reference);
  if (pts.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || maxLon === minLon || maxLat === minLat) return null;

  let dedans = 0;
  let couverts = 0;
  for (let i = 0; i < cote; i += 1) {
    // Demi-pas : les points tombent au centre des cellules, jamais sur les bords, ce qui
    // evite les faux positifs sur une limite de parcelle partagee avec la zone.
    const lon = minLon + ((i + 0.5) / cote) * (maxLon - minLon);
    for (let j = 0; j < cote; j += 1) {
      const lat = minLat + ((j + 0.5) / cote) * (maxLat - minLat);
      if (!pointDansGeometrie([lon, lat], reference)) continue;
      dedans += 1;
      if (pointDansGeometrie([lon, lat], cible)) couverts += 1;
    }
  }

  // Parcelle trop etroite pour que la grille tombe dedans : on ne devine pas.
  if (dedans < 20) return null;
  return Math.round((couverts / dedans) * 100) / 100;
}

/** Recouvrement d'une geometrie de reference par une liste de geometries. */
export function recouvrement(
  reference: GeoJsonGeometry,
  cibles: GeoJsonGeometry[],
): { recouvre: boolean; distanceM: number | null } {
  if (cibles.length === 0) return { recouvre: false, distanceM: null };
  const d = distanceMinEntreGeometries(reference, cibles);
  return { recouvre: d === 0, distanceM: d };
}
