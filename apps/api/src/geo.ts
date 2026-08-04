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

/**
 * Analyse une emprise passee en parametre de requete.
 *
 * La validation ne se limitait qu'a « quatre nombres finis ». Une emprise inversee
 * (`minLon > maxLon`) produisait alors une enveloppe PostGIS vide et un resultat
 * silencieusement nul - indiscernable d'un secteur reellement sans objet. Une emprise
 * mondiale, elle, declenchait un balayage que seul un `LIMIT` bornait, et pas sur toutes
 * les routes.
 *
 * Les bornes sont donc verifiees ici, une fois pour toutes : coordonnees dans le domaine
 * geographique, ordre correct, et etendue plafonnee a celle du territoire couvert.
 */
/**
 * Regle de validite d'une emprise, partagee par TOUS les points d'entree.
 *
 * Elle vivait a l'interieur de `bboxDepuisChaine` et ne s'appliquait donc qu'aux chemins en
 * chaine de requete. Le corps JSON de la recherche — celui que l'interface utilise reellement —
 * ne passait par aucun controle : une emprise couvrant le monde entier etait acceptee, et le
 * plafond de deux fois la France ne servait a rien la ou il comptait.
 */
export function bboxValide(b: Bbox): boolean {
  const [minLon, minLat, maxLon, maxLat] = b;
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return false;
  // Domaine geographique valide.
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return false;
  // Ordre : une emprise inversee est une erreur d'appel, pas une emprise vide.
  if (minLon >= maxLon || minLat >= maxLat) return false;
  // Etendue : au-dela du double de la France metropolitaine, la requete n'a pas de sens
  // pour cette application et ne ferait que peser sur la base.
  const largeurMaxDeg = (FRANCE_METRO[2] - FRANCE_METRO[0]) * 2;
  const hauteurMaxDeg = (FRANCE_METRO[3] - FRANCE_METRO[1]) * 2;
  if (maxLon - minLon > largeurMaxDeg || maxLat - minLat > hauteurMaxDeg) return false;
  return true;
}

export function bboxDepuisChaine(s: string): Bbox | null {
  const p = s.split(',').map(Number);
  if (p.length !== 4) return null;
  const b = p as Bbox;
  return bboxValide(b) ? b : null;
}

/**
 * Emprise de la France metropolitaine, en degres.
 *
 * Sert de garde-fou a toute operation pilotee par l'emprise de l'ecran. MapLibre peut
 * renvoyer des bornes debordant largement le territoire — voire depassant 180 degres de
 * longitude en vue tres large — et une qualification lancee sur de telles bornes irait
 * chercher des parcelles a des centaines de kilometres de la zone de travail.
 */
export const FRANCE_METRO: Bbox = [-5.3, 41.3, 9.8, 51.2];

/** Intersection d'une emprise avec la France metropolitaine, ou `null` si disjointes. */
export function limiterAlaFrance(b: Bbox): Bbox | null {
  const ouest = Math.max(b[0], FRANCE_METRO[0]);
  const sud = Math.max(b[1], FRANCE_METRO[1]);
  const est = Math.min(b[2], FRANCE_METRO[2]);
  const nord = Math.min(b[3], FRANCE_METRO[3]);
  if (ouest >= est || sud >= nord) return null;
  return [ouest, sud, est, nord];
}

/** Vrai si le point est a l'interieur de l'emprise (bornes incluses). */
export function pointDansBbox(pt: Position, b: Bbox): boolean {
  return pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
}

/**
 * Decoupe une emprise en cellules d'au plus `cote` degres.
 *
 * Necessaire pour interroger le cadastre sur de grandes surfaces : API Carto n'accepte pas
 * une geometrie couvrant plusieurs communes et plafonne le nombre d'objets retournes. Une
 * emprise a l'echelle d'un canton est donc parcourue cellule par cellule.
 */
export function decouperBbox(b: Bbox, cote = 0.05): Bbox[] {
  const [ouest, sud, est, nord] = b;
  const cellules: Bbox[] = [];
  for (let x = ouest; x < est; x += cote) {
    for (let y = sud; y < nord; y += cote) {
      cellules.push([x, y, Math.min(x + cote, est), Math.min(y + cote, nord)]);
    }
  }
  // Une emprise plus petite qu'une cellule doit malgre tout produire une cellule.
  return cellules.length > 0 ? cellules : [b];
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
 * Pente maximale physiquement plausible sur une parcelle cadastrale francaise, en pourcents.
 *
 * 100 % vaut 45 degres. Aucune parcelle cadastrale exploitable en France metropolitaine n'est
 * a 45 degres de pente moyenne : au-dela, on est sur une falaise, pas sur un terrain. La borne
 * ne sert donc pas a « corriger » une pente forte, elle sert a REFUSER un resultat de calcul
 * qui ne decrit pas un terrain.
 *
 * Sans elle, une regression mal conditionnee produisait des valeurs jusqu'a 1 666 % — mesure
 * sur 7 parcelles reelles sur 49 — et le critere de pente, qui pese 6,1 % du score solaire,
 * tombait a 0/100 au lieu de 99/100. Soit 8 a 12 points de score global, assez pour faire
 * changer une parcelle de couleur.
 */
const PENTE_MAX_PLAUSIBLE_PCT = 100;

/**
 * Conditionnement relatif minimal du systeme normal de la regression.
 *
 * Le determinant `sxx.syy - sxy^2` a la dimension de (m^2)^2 : sur une parcelle ordinaire il
 * vaut 1e7 a 1e9. Le tester contre une constante ABSOLUE — c'etait `> 1e-6` — ne teste donc
 * rien : un determinant de 14,6, soit un conditionnement relatif de 2,3e-9 et un systeme
 * completement degenere, franchissait la garde avec sept ordres de grandeur de marge.
 *
 * Le rapport `det / (sxx.syy)` est lui sans dimension et vaut 1 pour un semis parfaitement
 * reparti, 0 pour un semis aligne. 1e-4 ecarte les configurations ou la direction transverse
 * est si etroite que le gradient qu'on y mesure n'a plus de sens — typiquement une parcelle en
 * laniere dont la grille de sondage ne retient qu'une bande de points.
 */
const CONDITIONNEMENT_MIN = 1e-4;

/**
 * Etendue quadratique minimale du semis dans CHAQUE direction, en metres.
 *
 * Le conditionnement relatif ne suffit pas, et c'est contre-intuitif : quand toutes les
 * latitudes du semis sont egales — degenerescence totale — `sxy` vaut 0 et le rapport
 * `det / (sxx.syy)` vaut exactement 1, soit le MEILLEUR conditionnement possible. Le ratio
 * mesure la correlation entre les deux directions, pas l'etendue de chacune.
 *
 * Il faut donc exiger separement que le nuage ait une extension reelle dans les deux
 * directions. 8 m est le seuil en dessous duquel un gradient n'est de toute facon pas mesurable
 * a partir du RGE ALTI : le pas du raster est metrique et les altitudes sont quantifiees au
 * decimetre, donc sur 8 m le bruit domine le signal.
 */
const ETENDUE_MIN_M = 8;

/**
 * Tolerance du controle croise entre la regression et la mesure par paires.
 *
 * Pour un plan de gradient `g`, deux points quelconques donnent |dz|/d = g.|cos t| <= g : la
 * plus forte pente locale mesuree entre paires APPROCHE `g` par le bas, et ne peut pas le
 * depasser franchement. Une regression qui rend 6,5 % la ou les paires mesurent 0,9 % ne decrit
 * donc pas un plan — c'est le cas reel qui produisait les pentes a 1 666 %.
 *
 * Le controle est asymetrique a dessein : le bruit altimetrique peut faire MONTER la mesure par
 * paires au-dessus de `g` sans que ce soit anormal. On ne borne donc que le sens qui trahit une
 * regression parasite.
 */
const TOLERANCE_CROISEE = 1.5;

/**
 * Pente moyenne et maximale a partir d'un semis de points cotes.
 *
 * DEUX ESTIMATEURS, et c'est delibere. La regression du plan des altitudes est la meilleure
 * estimation quand le semis est bien reparti : elle utilise tous les points et lisse le bruit
 * altimetrique. Mais elle devient arbitrairement fausse quand le semis degenere. La mesure par
 * paires de points distants, elle, est grossiere mais ne peut pas exploser : elle est bornee
 * par le denivele divise par la distance.
 *
 * On prend donc la regression quand elle est fiable, et on retombe sur la mesure par paires
 * sinon — plutot que de publier un nombre dont on sait qu'il ne decrit rien. Le champ
 * `penteEstimeeParPaires` dit lequel des deux a servi, pour que la fiche ne presente pas une
 * approximation comme une regression.
 */
export function penteDepuisSemis(
  points: Array<{ lon: number; lat: number; z: number }>,
): {
  pentePct: number | null;
  penteMaxPct: number | null;
  orientationDeg: number | null;
  deniveleM: number | null;
  /** Vrai si la regression a ete ecartee et la pente estimee par paires de points. */
  penteEstimeeParPaires: boolean;
} {
  const valides = points.filter((p) => Number.isFinite(p.z));
  if (valides.length < 3) {
    return {
      pentePct: null,
      penteMaxPct: null,
      orientationDeg: null,
      deniveleM: null,
      penteEstimeeParPaires: false,
    };
  }

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

  // Trois conditions, aucune suffisante seule (voir les constantes) :
  //   1. etendue reelle du nuage dans les deux directions ;
  //   2. conditionnement relatif, sans dimension ;
  //   3. controle croise contre la mesure par paires, applique plus bas.
  const nbPoints = valides.length;
  const etendueX = Math.sqrt(sxx / nbPoints);
  const etendueY = Math.sqrt(syy / nbPoints);
  const echelle = sxx * syy;
  const bienConditionne =
    etendueX >= ETENDUE_MIN_M &&
    etendueY >= ETENDUE_MIN_M &&
    echelle > 0 &&
    Math.abs(det) / echelle > CONDITIONNEMENT_MIN;

  let penteRegression: number | null = null;
  let orientationDeg: number | null = null;
  if (bienConditionne) {
    const a = (sxz * syy - syz * sxy) / det; // dz/dx
    const b = (syz * sxx - sxz * sxy) / det; // dz/dy
    penteRegression = Math.round(Math.sqrt(a * a + b * b) * 1000) / 10;
    // Azimut de la ligne de plus grande pente descendante : 0 = nord, 180 = sud.
    const azimut = (Math.atan2(-a, -b) * 180) / Math.PI;
    orientationDeg = Math.round(((azimut % 360) + 360) % 360);
  }

  const zs = valides.map((p) => p.z);
  const deniveleM = Math.round((Math.max(...zs) - Math.min(...zs)) * 10) / 10;

  /**
   * Pente par paires de points distants.
   *
   * Estimateur de repli, et estimateur de controle. Il est grossier — il retient la plus forte
   * pente locale, donc majore la pente moyenne — mais il est BORNE par construction : le
   * quotient d'un denivele reel par une distance d'au moins 10 m ne peut pas exploser.
   *
   * `etendueM` est conservee pour distinguer « aucune paire assez distante » (parcelle
   * minuscule, on ne sait pas) de « toutes les paires sont a plat » (pente nulle, on sait).
   */
  let penteParPaires = 0;
  let paires = 0;
  for (let i = 0; i < valides.length; i += 1) {
    for (let j = i + 1; j < valides.length; j += 1) {
      const p = valides[i]!;
      const q = valides[j]!;
      const d = distanceM([p.lon, p.lat], [q.lon, q.lat]);
      if (d < 10) continue;
      paires += 1;
      const pente = (Math.abs(p.z - q.z) / d) * 100;
      if (pente > penteParPaires) penteParPaires = pente;
    }
  }
  const penteParPairesConnue = paires > 0 ? Math.round(penteParPaires * 10) / 10 : null;

  /**
   * Choix de l'estimateur publie. Trois conditions cumulatives.
   *
   * La plausibilite (<= 100 %) et le controle croise contre la mesure par paires sont des
   * garde-fous SUR LE RESULTAT et non sur le conditionnement du systeme : ils attrapent les cas
   * ou le systeme paraissait acceptable et ou le resultat ne decrit pourtant pas un terrain.
   * C'est le controle croise qui fait le plus de travail — il compare deux estimations de la
   * meme grandeur, ce qu'aucune inspection du systeme normal ne peut faire.
   *
   * Le plancher a 1 % dans le controle croise evite d'ecarter une regression legitime sur un
   * terrain quasi plat, ou les deux estimateurs sont dans le bruit de l'altimetrie.
   */
  const regressionUtilisable =
    penteRegression != null &&
    penteRegression <= PENTE_MAX_PLAUSIBLE_PCT &&
    (penteParPairesConnue == null ||
      penteRegression <= Math.max(1, penteParPairesConnue * TOLERANCE_CROISEE));

  let pentePct: number | null;
  let parPaires: boolean;
  if (regressionUtilisable) {
    pentePct = penteRegression;
    parPaires = false;
  } else {
    // Repli. `null` si meme la mesure par paires est indisponible : le critere sera GRIS,
    // ce qui est le comportement correct — l'absence de donnee n'est pas une pente nulle.
    pentePct = penteParPairesConnue;
    parPaires = penteParPairesConnue != null;
    // L'orientation vient de la meme regression : si elle est ecartee, l'orientation l'est aussi.
    orientationDeg = null;
  }

  return {
    pentePct,
    // La pente maximale reste la mesure par paires. Quand elle est indisponible, elle vaut la
    // pente retenue plutot que d'inventer un maximum inferieur a la moyenne.
    penteMaxPct: penteParPairesConnue ?? pentePct,
    orientationDeg,
    deniveleM,
    penteEstimeeParPaires: parPaires,
  };
}
