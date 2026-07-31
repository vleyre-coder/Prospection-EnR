/** Calculs geometriques cote client, pour les outils de mesure et les rayons. */

export type Position = [number, number];

const RAYON_TERRE_M = 6371008.8;

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function distanceM(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.sqrt(h));
}

export function longueurLigneM(points: Position[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += distanceM(points[i]!, points[i + 1]!);
  return total;
}

/**
 * Surface d'un anneau ferme, en hectares.
 * Formule spherique de l'aire d'un polygone geodesique : exacte a l'echelle d'un site.
 */
export function surfaceAnneauHa(anneau: Position[]): number {
  if (anneau.length < 4) return 0;
  let somme = 0;
  for (let i = 0; i < anneau.length - 1; i += 1) {
    const [x1, y1] = anneau[i]!;
    const [x2, y2] = anneau[i + 1]!;
    somme += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  const surfaceM2 = Math.abs((somme * RAYON_TERRE_M * RAYON_TERRE_M) / 2);
  return surfaceM2 / 10000;
}

/** Cercle geodesique approche, pour les rayons de raccordement. */
export function cercleGeodesique(centre: Position, rayonM: number, segments = 64): GeoJSON.Polygon {
  const anneau: Position[] = [];
  const dLat = rayonM / 111320;
  const dLon = rayonM / (111320 * Math.max(0.1, Math.cos(rad(centre[1]))));
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * 2 * Math.PI;
    anneau.push([centre[0] + dLon * Math.cos(a), centre[1] + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [anneau] };
}

// ---------------------------------------------------------------------------
// Formatage francais
// ---------------------------------------------------------------------------

const fmt = (n: number, d = 1): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function formatSurface(ha: number): string {
  if (ha < 1) return `${fmt(ha * 10000, 0)} m²`;
  return `${fmt(ha, 2)} ha`;
}

export function formatLongueur(m: number): string {
  if (m < 1000) return `${fmt(m, 0)} m`;
  return `${fmt(m / 1000, 2)} km`;
}

export function formatNombre(n: number | null | undefined, unite = '', decimales = 1): string {
  if (n == null) return '—';
  return `${fmt(n, decimales)}${unite ? ` ${unite}` : ''}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateHeure(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
