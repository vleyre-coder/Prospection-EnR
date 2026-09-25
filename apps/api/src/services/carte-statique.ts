/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE CARTE DANS LE DOSSIER — composee cote serveur, a partir des tuiles de l'IGN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. Les deux documents remis a un tiers — la fiche parcelle et le
 * dossier de site — ne portaient que du texte. Or un developpeur qui qualifie un terrain regarde
 * d'abord OU il est : la forme de la parcelle, ses acces, son voisinage bati, la culture en place.
 * Ces choses ne se disent pas en tableau. Un dossier sans image oblige a rouvrir l'application
 * pour comprendre ce qu'il decrit, ce qui est l'aveu qu'il ne se suffit pas.
 *
 * ═══ CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 *
 * Il prepare une FIGURE : une liste de tuiles raster deja telechargees, leur position en points
 * PDF, et le contour de la parcelle converti dans le meme repere. Il ne dessine rien — c'est
 * `exports.ts` qui pose les images et trace le contour, parce que lui seul tient le document.
 *
 * LA SEPARATION N'EST PAS COSMETIQUE : la construction d'une figure fait des appels reseau, donc
 * elle est asynchrone, alors que les deux generateurs de PDF sont synchrones et rendent un flux
 * immediatement. Les rendre asynchrones aurait contamine leurs appelants et leurs tests. La route
 * prepare les figures, puis les passe ; si le reseau ne repond pas, elle passe `null` et le
 * document ECRIT qu'il n'a pas pu charger la carte, au lieu de laisser un cadre vide.
 *
 * ═══ AUCUNE BIBLIOTHEQUE D'IMAGE
 *
 * Assembler les tuiles en une seule image demanderait `sharp` ou equivalent. Ce n'est pas
 * necessaire : PDFKit sait poser plusieurs images et decouper a une zone. Chaque tuile est donc
 * posee a sa place, l'ensemble est clipe au cadre de la figure, et le contour est trace par-dessus
 * en vectoriel — donc net a toutes les echelles d'impression, ce qu'un assemblage raster ne serait
 * pas.
 *
 * ═══ LE RELAIS N'EST PAS UN PROXY
 *
 * L'URL est construite ici a partir d'une constante : aucune entree utilisateur n'y entre, et la
 * couche demandee appartient a une liste fermee. C'est la meme regle que pour le relais de tuiles
 * de `routes/carte.ts`, et elle vaut ici aussi — un composant qui accepterait une URL deviendrait
 * un proxy ouvert derriere une authentification.
 *
 * ET LA LISTE EST LA SEULE DU DEPOT. `routes/carte.ts` portait la sienne, identique ; deux listes
 * fermees qui disent la meme chose sont une liste fermee de moins le jour ou l'une bouge. Le relais
 * importe donc celle-ci. Une liste d'autorisation ne se recopie pas : elle s'audite a un endroit.
 */

import { avecParams } from '../http.js';
import { bboxDe, positions, type Bbox, type GeoJsonGeometry } from '../geo.js';

/** Cote d'une tuile WMTS de l'IGN, en pixels. */
const TUILE_PX = 256;

/**
 * SUR-ECHANTILLONNAGE. Un PDF compte en points, et un point vaut 1/72 de pouce : poser une tuile
 * de 256 px sur 256 points donne une carte a 72 dpi, c'est-a-dire une carte floue des qu'elle est
 * imprimee ou agrandie a l'ecran. On demande donc DEUX FOIS plus de pixels que de points et on
 * reduit a la pose : 144 dpi, pour un cout de quatre fois plus de tuiles sur la meme emprise.
 */
const FACTEUR_DEFAUT = 2;

/** Nombre maximal de tuiles telechargees pour une figure. Un cadre ne doit pas devenir une rafale. */
const PLAFOND_TUILES = 48;

/** Couches autorisees. Liste FERMEE, et unique : le relais de `routes/carte.ts` lit celle-ci. */
export const FONDS = {
  plan: { couche: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png', type: 'image/png' },
  ortho: { couche: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg', type: 'image/jpeg' },
} as const;

export type Fond = keyof typeof FONDS;

/** Le fond demande appartient-il a la liste fermee ? */
export function estFond(v: unknown): v is Fond {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FONDS, v);
}

/** Une tuile posee dans le repere de la figure, en points PDF. */
export interface TuilePosee {
  donnees: Buffer;
  x: number;
  y: number;
  taille: number;
}

/** Tout ce dont le PDF a besoin pour dessiner la carte, et rien de plus. */
export interface FigureCarte {
  fond: Fond;
  largeur: number;
  hauteur: number;
  tuiles: TuilePosee[];
  /** Contours de la parcelle, en points PDF relatifs au coin haut-gauche de la figure. */
  anneaux: Array<Array<[number, number]>>;
  /** Echelle : longueur en points d'une barre, et ce qu'elle represente au sol. */
  echelle: { longueurPts: number; libelle: string };
  attribution: string;
  /** Zoom WMTS retenu, utile au diagnostic et aux tests. */
  zoom: number;
  /** Ce que la vignette montre, ecrit sous elle. Deux vues du meme fond n'ont pas le meme objet. */
  legende: string;
  /**
   * Etendue reellement couverte au sol, [largeur, hauteur] en metres.
   *
   * ELLE N'EST PAS CELLE QU'ON A DEMANDEE, et c'est tout l'interet de la porter. `rayonMiniM`
   * demande un carre ; le cadre, lui, a les proportions de la vignette, et le zoom est choisi pour
   * que le carre tienne dans les DEUX dimensions. Une vue large de 196 points sur 511 demandee
   * avec un rayon de 2,5 km montre donc 26 km de large. Une legende qui annoncerait « 5 km » serait
   * fausse d'un facteur cinq — c'est le genre d'affirmation qu'un dossier remis a un tiers ne peut
   * pas se permettre, et elle a bien ete imprimee une fois avant d'etre mesuree ici.
   */
  etendueM: [number, number];
}

/** Legende par defaut, quand la vue est cadree sur l'objet lui-meme. */
const LEGENDE_DEFAUT: Record<Fond, string> = {
  plan: 'Plan IGN — situation et accès',
  ortho: 'Photographie aérienne — occupation du sol',
};

/** Coordonnee en pixels « monde » a un zoom donne, origine en haut a gauche. */
export function versPixelMonde(lon: number, lat: number, zoom: number): [number, number] {
  const n = TUILE_PX * 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const phi = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
  return [x, y];
}

/**
 * Le zoom le plus DETAILLE auquel l'enveloppe tient encore dans le cadre.
 *
 * `marge` elargit l'enveloppe avant le calcul : une parcelle collee aux bords de la figure ne se
 * lit pas — on ne voit ni la route qui la dessert ni la parcelle voisine, c'est-a-dire ce qu'on
 * regarde une carte pour voir.
 */
export function zoomPour(
  bbox: Bbox,
  largeurPx: number,
  hauteurPx: number,
  marge = 0.35,
  zoomMax = 19,
): number {
  const [o, s, e, n] = bbox;
  // L'enveloppe est elargie UNE FOIS, puis mesuree telle quelle a chaque zoom.
  const padLon = ((e - o) * marge) / 2;
  const padLat = ((n - s) * marge) / 2;
  for (let z = zoomMax; z >= 0; z--) {
    const [x1, y1] = versPixelMonde(o - padLon, n + padLat, z);
    const [x2, y2] = versPixelMonde(e + padLon, s - padLat, z);
    if (Math.abs(x2 - x1) <= largeurPx && Math.abs(y2 - y1) <= hauteurPx) return z;
  }
  return 0;
}

/** Longueur au sol d'un pixel, en metres, au centre de la figure. */
export function metresParPixel(lat: number, zoom: number): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Une barre d'echelle « ronde » : 100 m, 250 m, 500 m, 1 km…
 *
 * Une barre de « 187 m » est exacte et illisible. On cherche donc la plus grande valeur d'une
 * suite 1 / 2,5 / 5 qui tienne dans la largeur allouee.
 */
export function barreEchelle(
  metresParPt: number,
  largeurMaxPts: number,
): { longueurPts: number; libelle: string } {
  const metresMax = metresParPt * largeurMaxPts;
  const paliers: number[] = [];
  for (let e = 0; e <= 6; e++) for (const m of [1, 2.5, 5]) paliers.push(m * 10 ** e);
  const choisi = [...paliers].reverse().find((p) => p <= metresMax) ?? paliers[0]!;
  const libelle = choisi >= 1000 ? `${choisi / 1000} km` : `${choisi} m`;
  return { longueurPts: choisi / metresParPt, libelle };
}

/** L'URL WMTS d'une tuile. Exportee pour etre verifiee sans reseau. */
export function urlTuile(fond: Fond, z: number, x: number, y: number): string {
  const conf = FONDS[fond];
  return avecParams('https://data.geopf.fr/wmts', {
    SERVICE: 'WMTS',
    VERSION: '1.0.0',
    REQUEST: 'GetTile',
    LAYER: conf.couche,
    STYLE: 'normal',
    TILEMATRIXSET: 'PM',
    FORMAT: conf.format,
    TILEMATRIX: z,
    TILEROW: y,
    TILECOL: x,
  });
}

/** Telecharge une tuile WMTS. Rend `null` sur toute reponse qui n'est pas une image. */
async function tuile(fond: Fond, z: number, x: number, y: number): Promise<Buffer | null> {
  const conf = FONDS[fond];
  try {
    const rep = await fetch(urlTuile(fond, z, x, y), {
      headers: {
        Accept: conf.type,
        'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!rep.ok) return null;
    const recu = Buffer.from(await rep.arrayBuffer());
    /*
     * PDFKit n'accepte que du PNG et du JPEG, et il LEVE sur tout le reste. Hors emprise, la
     * Geoplateforme repond parfois 200 avec un XML d'exception ; le poser dans le document ferait
     * echouer la generation entiere du dossier, pour une tuile de bord. On verifie donc la
     * signature du fichier plutot que l'entete annonce.
     */
    return estImage(recu) ? recu : null;
  } catch {
    return null;
  }
}

/** Signature PNG ou JPEG en tete de fichier — le seul controle que PDFKit fera lui-meme. */
export function estImage(donnees: Buffer): boolean {
  if (donnees.length < 8) return false;
  const png = donnees[0] === 0x89 && donnees[1] === 0x50 && donnees[2] === 0x4e && donnees[3] === 0x47;
  const jpeg = donnees[0] === 0xff && donnees[1] === 0xd8 && donnees[2] === 0xff;
  return png || jpeg;
}

/**
 * Prepare la figure. Rend `null` si AUCUNE tuile n'a pu etre chargee.
 *
 * `null` plutot qu'une figure vide : le document doit pouvoir ecrire « la carte n'a pas pu etre
 * chargee » plutot que d'imprimer un cadre blanc, qu'un lecteur prendrait pour un terrain nu.
 * Une figure PARTIELLE, elle, est rendue : mieux vaut trois quarts de carte qu'aucune, et le
 * manque se voit.
 */
export async function construireFigure(
  geometrie: GeoJsonGeometry,
  options: {
    fond: Fond;
    largeur: number;
    hauteur: number;
    facteur?: number;
    /**
     * Demi-etendue minimale de la vue, en metres. C'est ce qui distingue la vue de SITUATION de
     * la vue d'ENVIRONNEMENT : cadree sur la parcelle, une carte ne montre que la parcelle, et un
     * developpeur a besoin de savoir ce qu'il y a autour — le hameau le plus proche, la ligne
     * haute tension, la lisiere de bois, la route qui dessert.
     */
    rayonMiniM?: number;
    legende?: string;
  },
): Promise<FigureCarte | null> {
  const { fond, largeur, hauteur } = options;
  const facteur = options.facteur ?? FACTEUR_DEFAUT;

  /*
   * UNE GEOMETRIE VIDE NE FAIT PAS UNE CARTE. `bboxDe` rend `[0, 0, 0, 0]` quand elle ne trouve
   * aucune position — une enveloppe parfaitement valide, au large du golfe de Guinee. Sans ce
   * controle, le dossier porterait une carte de l'ocean Atlantique avec l'aplomb d'une vraie.
   */
  if (positions(geometrie).length === 0) return null;
  const bbox = options.rayonMiniM
    ? elargirA(bboxDe(geometrie), options.rayonMiniM)
    : bboxDe(geometrie);

  // Tout le calcul se fait en PIXELS, et la figure est rendue en POINTS : d'ou les divisions.
  const largeurPx = largeur * facteur;
  const hauteurPx = hauteur * facteur;
  // Une vue d'environnement porte deja son recul dans son rayon : lui ajouter la marge de
  // respiration la ferait reculer deux fois, et la parcelle y deviendrait un point.
  const zoom = zoomPour(bbox, largeurPx, hauteurPx, options.rayonMiniM ? 0.04 : 0.35);
  const centreLon = (bbox[0] + bbox[2]) / 2;
  const centreLat = (bbox[1] + bbox[3]) / 2;

  // Le coin haut-gauche de la figure, en pixels monde.
  const [cx, cy] = versPixelMonde(centreLon, centreLat, zoom);
  const originX = cx - largeurPx / 2;
  const originY = cy - hauteurPx / 2;

  const xMin = Math.floor(originX / TUILE_PX);
  const xMax = Math.floor((originX + largeurPx) / TUILE_PX);
  const yMin = Math.floor(originY / TUILE_PX);
  const yMax = Math.floor((originY + hauteurPx) / TUILE_PX);
  const max = 2 ** zoom;

  const demandes: Array<Promise<TuilePosee | null>> = [];
  for (let tx = xMin; tx <= xMax; tx++) {
    for (let ty = yMin; ty <= yMax; ty++) {
      if (tx < 0 || ty < 0 || tx >= max || ty >= max) continue;
      // Garde-fou : un cadre demesure ne doit pas se traduire en centaines d'appels a l'IGN.
      if (demandes.length >= PLAFOND_TUILES) break;
      demandes.push(
        tuile(fond, zoom, tx, ty).then((donnees) =>
          donnees
            ? {
                donnees,
                x: (tx * TUILE_PX - originX) / facteur,
                y: (ty * TUILE_PX - originY) / facteur,
                taille: TUILE_PX / facteur,
              }
            : null,
        ),
      );
    }
  }
  const tuiles = (await Promise.all(demandes)).filter((t): t is TuilePosee => t !== null);
  if (tuiles.length === 0) return null;

  const anneaux = anneauxEnPoints(geometrie, zoom, originX, originY, facteur);
  // Une figure se lit en points : l'echelle doit donc se compter en points, pas en pixels.
  const metresParPt = metresParPixel(centreLat, zoom) * facteur;
  return {
    fond,
    largeur,
    hauteur,
    tuiles,
    anneaux,
    echelle: barreEchelle(metresParPt, largeur / 3),
    attribution: '© IGN — Géoplateforme',
    zoom,
    legende: options.legende ?? LEGENDE_DEFAUT[fond],
    etendueM: [largeur * metresParPt, hauteur * metresParPt],
  };
}

/**
 * Elargit une enveloppe pour qu'elle couvre au moins `rayonM` metres de part et d'autre du centre.
 *
 * `metresParDegre` varie avec la latitude en longitude et pas en latitude : c'est la raison des
 * deux formules. Une seule conversion donnerait, en France, une vue 50 % trop large d'un cote.
 */
export function elargirA(bbox: Bbox, rayonM: number): Bbox {
  const [o, s, e, n] = bbox;
  const centreLon = (o + e) / 2;
  const centreLat = (s + n) / 2;
  const dLat = rayonM / 111_320;
  const dLon = rayonM / (111_320 * Math.max(Math.cos((centreLat * Math.PI) / 180), 0.01));
  return [
    Math.min(o, centreLon - dLon),
    Math.min(s, centreLat - dLat),
    Math.max(e, centreLon + dLon),
    Math.max(n, centreLat + dLat),
  ];
}

/**
 * Reunit plusieurs geometries en un seul multi-polygone, pour cartographier un SITE.
 *
 * Un dossier de site porte plusieurs parcelles, et la carte doit les montrer TOUTES avec leur
 * emprise commune — une vue par parcelle ne dit rien de la forme du projet, qui est justement ce
 * qu'on cherche a voir. Ce n'est pas une union topologique : les contours restent distincts, ce
 * qui est voulu, car la limite entre deux parcelles voisines est une information du dossier.
 */
export function reunirGeometries(geometries: GeoJsonGeometry[]): GeoJsonGeometry {
  const polygones: unknown[] = [];
  for (const g of geometries) {
    if (!Array.isArray(g.coordinates)) continue;
    if (g.type === 'MultiPolygon') polygones.push(...g.coordinates);
    else polygones.push(g.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: polygones };
}

/** Convertit les contours de la geometrie dans le repere de la figure, en points. */
export function anneauxEnPoints(
  g: GeoJsonGeometry,
  zoom: number,
  originX: number,
  originY: number,
  facteur = 1,
): Array<Array<[number, number]>> {
  const sortie: Array<Array<[number, number]>> = [];
  const anneau = (coords: unknown[]): void => {
    const points: Array<[number, number]> = [];
    for (const p of coords) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return;
      const [x, y] = versPixelMonde(p[0], p[1], zoom);
      points.push([(x - originX) / facteur, (y - originY) / facteur]);
    }
    if (points.length >= 3) sortie.push(points);
  };
  const parcourir = (c: unknown, profondeur: number): void => {
    if (!Array.isArray(c)) return;
    // Un anneau est un tableau de couples : on le reconnait a ses elements numeriques.
    if (Array.isArray(c[0]) && typeof (c[0] as unknown[])[0] === 'number') {
      anneau(c);
      return;
    }
    if (profondeur > 4) return;
    for (const sous of c) parcourir(sous, profondeur + 1);
  };
  parcourir(g.coordinates, 0);
  return sortie;
}
