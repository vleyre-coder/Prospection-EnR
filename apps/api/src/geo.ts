/** Utilitaires geometriques : bbox, surfaces, distances, echantillonnage. */

export type Position = [number, number];
export type Bbox = [number, number, number, number];

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface Polygone {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygone {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

const RAYON_TERRE_M = 6371008.8;

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distance orthodromique entre deux points WGS84, en metres. */
export function distanceM(a: Position, b: Position): number {
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const lat1 = radians(a[1]);
  const lat2 = radians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.sqrt(h));
}

/** Aplatit toutes les positions d'une geometrie GeoJSON. */
export function positions(geom: GeoJsonGeometry): Position[] {
  const out: Position[] = [];
  const parcourir = (n: unknown): void => {
    if (!Array.isArray(n)) return;
    if (typeof n[0] === 'number' && typeof n[1] === 'number') {
      out.push([n[0], n[1]]);
      return;
    }
    for (const enfant of n) parcourir(enfant);
  };
  parcourir(geom.coordinates);
  return out;
}

export function bboxDe(geom: GeoJsonGeometry): Bbox {
  const pts = positions(geom);
  if (pts.length === 0) return [0, 0, 0, 0];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function centroideDe(geom: GeoJsonGeometry): Position {
  const pts = positions(geom);
  if (pts.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of pts) {
    sx += lon;
    sy += lat;
  }
  return [sx / pts.length, sy / pts.length];
}

/**
 * Surface approchee d'un anneau en projection equirectangulaire locale, en m2.
 * Suffisant pour un pre-dimensionnement ; la surface de reference est calculee par
 * PostGIS en Lambert-93 (`ST_Area(ST_Transform(geom, 2154))`).
 */
function surfaceAnneauM2(anneau: Position[], latRef: number): number {
  const mParDegLat = 111132.92 - 559.82 * Math.cos(2 * radians(latRef));
  const mParDegLon = 111412.84 * Math.cos(radians(latRef)) - 93.5 * Math.cos(3 * radians(latRef));
  let somme = 0;
  for (let i = 0; i < anneau.length - 1; i += 1) {
    const [x1, y1] = anneau[i]!;
    const [x2, y2] = anneau[i + 1]!;
    somme += x1 * mParDegLon * (y2 * mParDegLat) - x2 * mParDegLon * (y1 * mParDegLat);
  }
  return Math.abs(somme / 2);
}

export function surfaceM2(geom: GeoJsonGeometry): number {
  const latRef = centroideDe(geom)[1];
  if (geom.type === 'Polygon') {
    const anneaux = geom.coordinates as Position[][];
    if (anneaux.length === 0) return 0;
    const exterieur = surfaceAnneauM2(anneaux[0]!, latRef);
    const trous = anneaux.slice(1).reduce((a, r) => a + surfaceAnneauM2(r, latRef), 0);
    return Math.max(0, exterieur - trous);
  }
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as Position[][][]).reduce(
      (a, poly) => a + surfaceM2({ type: 'Polygon', coordinates: poly }),
      0,
    );
  }
  return 0;
}

/** Point dans un anneau (algorithme du rayon). */
function dansAnneau(pt: Position, anneau: Position[]): boolean {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i, i += 1) {
    const [xi, yi] = anneau[i]!;
    const [xj, yj] = anneau[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

export function pointDansGeometrie(pt: Position, geom: GeoJsonGeometry): boolean {
  const polys: Position[][][] =
    geom.type === 'Polygon'
      ? [geom.coordinates as Position[][]]
      : geom.type === 'MultiPolygon'
        ? (geom.coordinates as Position[][][])
        : [];
  for (const poly of polys) {
    if (poly.length === 0) continue;
    if (!dansAnneau(pt, poly[0]!)) continue;
    const dansTrou = poly.slice(1).some((trou) => dansAnneau(pt, trou));
    if (!dansTrou) return true;
  }
  return false;
}

/**
 * Echantillonne une grille de points a l'interieur d'une geometrie.
 * Utilise pour le calcul de pente : on interroge le MNT sur cette grille.
 */
export function grilleDansGeometrie(geom: GeoJsonGeometry, cote = 5): Position[] {
  const [minLon, minLat, maxLon, maxLat] = bboxDe(geom);
  const pts: Position[] = [];
  for (let i = 0; i < cote; i += 1) {
    for (let j = 0; j < cote; j += 1) {
      const lon = minLon + ((maxLon - minLon) * (i + 0.5)) / cote;
      const lat = minLat + ((maxLat - minLat) * (j + 0.5)) / cote;
      const pt: Position = [lon, lat];
      if (pointDansGeometrie(pt, geom)) pts.push(pt);
    }
  }
  // Une parcelle tres etroite peut ne contenir aucun point de grille : on retombe alors
  // sur le centroide et les sommets, plutot que de renoncer au calcul de pente.
  if (pts.length < 3) {
    const c = centroideDe(geom);
    const sommets = positions(geom).slice(0, 8);
    return [c, ...sommets];
  }
  return pts;
}

/** Elargit une bbox d'un nombre de metres donne. */
export function elargirBbox(b: Bbox, metres: number): Bbox {
  const latMoy = (b[1] + b[3]) / 2;
  const dLat = metres / 111320;
  const dLon = metres / (111320 * Math.max(0.1, Math.cos(radians(latMoy))));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export function bboxDepuisChaine(s: string): Bbox | null {
  const p = s.split(',').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  return [p[0]!, p[1]!, p[2]!, p[3]!];
}

export function bboxEnPolygone(b: Bbox): Polygone {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [b[0], b[1]],
        [b[2], b[1]],
        [b[2], b[3]],
        [b[0], b[3]],
        [b[0], b[1]],
      ],
    ],
  };
}

/** Cercle geodesique approche, pour les rayons de raccordement. */
export function cercle(centre: Position, rayonM: number, segments = 64): Polygone {
  const anneau: Position[] = [];
  const dLat = rayonM / 111320;
  const dLon = rayonM / (111320 * Math.max(0.1, Math.cos(radians(centre[1]))));
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * 2 * Math.PI;
    anneau.push([centre[0] + dLon * Math.cos(angle), centre[1] + dLat * Math.sin(angle)]);
  }
  return { type: 'Polygon', coordinates: [anneau] };
}

/**
 * Pente moyenne et maximale a partir d'un semis de points cotes.
 * La pente est estimee par regression du plan des altitudes : plus robuste que des
 * differences deux a deux sur un semis irregulier.
 */
export function penteDepuisSemis(
  points: Array<{ lon: number; lat: number; z: number }>,
): { pentePct: number | null; penteMaxPct: number | null; orientationDeg: number | null; deniveleM: number | null } {
  const valides = points.filter((p) => Number.isFinite(p.z));
  if (valides.length < 3) return { pentePct: null, penteMaxPct: null, orientationDeg: null, deniveleM: null };

  const latRef = valides.reduce((a, p) => a + p.lat, 0) / valides.length;
  const mParDegLat = 111132.92 - 559.82 * Math.cos(2 * radians(latRef));
  const mParDegLon = 111412.84 * Math.cos(radians(latRef));

  const lonRef = valides.reduce((a, p) => a + p.lon, 0) / valides.length;
  const zRef = valides.reduce((a, p) => a + p.z, 0) / valides.length;

  // Regression lineaire z = a*x + b*y + c (moindres carres, systeme normal 2x2).
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  for (const p of valides) {
    const x = (p.lon - lonRef) * mParDegLon;
    const y = (p.lat - latRef) * mParDegLat;
    const z = p.z - zRef;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  let pentePct: number | null = null;
  let orientationDeg: number | null = null;
  if (Math.abs(det) > 1e-6) {
    const a = (sxz * syy - syz * sxy) / det; // dz/dx
    const b = (syz * sxx - sxz * sxy) / det; // dz/dy
    pentePct = Math.round(Math.sqrt(a * a + b * b) * 1000) / 10;
    // Azimut de la ligne de plus grande pente descendante : 0 = nord, 180 = sud.
    const azimut = (Math.atan2(-a, -b) * 180) / Math.PI;
    orientationDeg = Math.round(((azimut % 360) + 360) % 360);
  }

  const zs = valides.map((p) => p.z);
  const deniveleM = Math.round((Math.max(...zs) - Math.min(...zs)) * 10) / 10;

  // Pente maximale locale : plus forte pente entre paires de points proches.
  let penteMax = 0;
  for (let i = 0; i < valides.length; i += 1) {
    for (let j = i + 1; j < valides.length; j += 1) {
      const p = valides[i]!;
      const q = valides[j]!;
      const d = distanceM([p.lon, p.lat], [q.lon, q.lat]);
      if (d < 10) continue;
      const pente = (Math.abs(p.z - q.z) / d) * 100;
      if (pente > penteMax) penteMax = pente;
    }
  }

  return {
    pentePct,
    penteMaxPct: penteMax > 0 ? Math.round(penteMax * 10) / 10 : pentePct,
    orientationDeg,
    deniveleM,
  };
}
