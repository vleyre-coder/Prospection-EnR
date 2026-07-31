/**
 * Ecriture de Shapefile (ESRI) pour l'export des selections de parcelles.
 *
 * Implementation autonome, sans dependance : les bibliotheques JavaScript disponibles pour
 * ce format sont soit abandonnees, soit orientees navigateur. Le format est stable et
 * publiquement specifie (ESRI Shapefile Technical Description, juillet 1998).
 *
 * Perimetre volontairement restreint au type Polygon (type 5), qui couvre les parcelles
 * cadastrales et les emprises de sites - les seules geometries que l'application exporte.
 *
 * Produit une archive ZIP (stockage sans compression) contenant .shp, .shx, .dbf, .prj
 * et .cpg, afin que le fichier s'ouvre directement dans QGIS et ArcGIS.
 */

import { deflateRawSync, crc32 } from 'node:zlib';

type Anneau = Array<[number, number]>;

export interface EntiteShapefile {
  /** Anneaux du polygone. Le sens de rotation est normalise a l'ecriture. */
  anneaux: Anneau[];
  attributs: Record<string, string | number | null>;
}

const TYPE_POLYGONE = 5;

/** WGS84 : les geometries de l'application sont en EPSG:4326. */
const PRJ_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Aire signee d'un anneau : positive en sens horaire dans le repere Shapefile. */
function aireSignee(anneau: Anneau): number {
  let somme = 0;
  for (let i = 0; i < anneau.length - 1; i += 1) {
    const [x1, y1] = anneau[i]!;
    const [x2, y2] = anneau[i + 1]!;
    somme += x1 * y2 - x2 * y1;
  }
  return somme / 2;
}

/**
 * Normalise les anneaux : le contour exterieur doit etre en sens HORAIRE et les trous en
 * sens antihoraire. GeoJSON impose la convention inverse, d'ou l'inversion systematique.
 */
function normaliserAnneaux(anneaux: Anneau[]): Anneau[] {
  return anneaux.map((anneau, index) => {
    const ferme =
      anneau.length > 0 &&
      (anneau[0]![0] !== anneau[anneau.length - 1]![0] ||
        anneau[0]![1] !== anneau[anneau.length - 1]![1])
        ? [...anneau, anneau[0]!]
        : [...anneau];
    const aire = aireSignee(ferme);
    const doitEtreHoraire = index === 0;
    // Dans le repere Shapefile (Y vers le haut), une aire signee negative correspond au
    // sens horaire.
    const estHoraire = aire < 0;
    return estHoraire === doitEtreHoraire ? ferme : ferme.reverse();
  });
}

/** Extrait les anneaux d'une geometrie GeoJSON Polygon ou MultiPolygon. */
export function anneauxDepuisGeoJson(geom: { type: string; coordinates: unknown }): Anneau[] {
  if (geom.type === 'Polygon') return geom.coordinates as Anneau[];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as Anneau[][]).flat();
  return [];
}

interface Enveloppe {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

function enveloppeDe(anneaux: Anneau[]): Enveloppe {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const anneau of anneaux) {
    for (const [x, y] of anneau) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return Number.isFinite(xmin) ? { xmin, ymin, xmax, ymax } : { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
}

/** En-tete commun aux fichiers .shp et .shx (100 octets). */
function enTete(longueurMots: number, enveloppe: Enveloppe): Buffer {
  const b = Buffer.alloc(100);
  b.writeInt32BE(9994, 0); // code fichier
  b.writeInt32BE(longueurMots, 24); // longueur totale, en mots de 16 bits
  b.writeInt32LE(1000, 28); // version
  b.writeInt32LE(TYPE_POLYGONE, 32);
  b.writeDoubleLE(enveloppe.xmin, 36);
  b.writeDoubleLE(enveloppe.ymin, 44);
  b.writeDoubleLE(enveloppe.xmax, 52);
  b.writeDoubleLE(enveloppe.ymax, 60);
  return b;
}

/** Enregistrement polygone du .shp (hors en-tete d'enregistrement). */
function contenuPolygone(anneaux: Anneau[]): Buffer {
  const normalises = normaliserAnneaux(anneaux);
  const nbPoints = normalises.reduce((a, r) => a + r.length, 0);
  const enveloppe = enveloppeDe(normalises);

  const taille = 4 + 32 + 4 + 4 + 4 * normalises.length + 16 * nbPoints;
  const b = Buffer.alloc(taille);
  let o = 0;
  b.writeInt32LE(TYPE_POLYGONE, o);
  o += 4;
  b.writeDoubleLE(enveloppe.xmin, o);
  o += 8;
  b.writeDoubleLE(enveloppe.ymin, o);
  o += 8;
  b.writeDoubleLE(enveloppe.xmax, o);
  o += 8;
  b.writeDoubleLE(enveloppe.ymax, o);
  o += 8;
  b.writeInt32LE(normalises.length, o);
  o += 4;
  b.writeInt32LE(nbPoints, o);
  o += 4;

  let indice = 0;
  for (const anneau of normalises) {
    b.writeInt32LE(indice, o);
    o += 4;
    indice += anneau.length;
  }
  for (const anneau of normalises) {
    for (const [x, y] of anneau) {
      b.writeDoubleLE(x, o);
      o += 8;
      b.writeDoubleLE(y, o);
      o += 8;
    }
  }
  return b;
}

interface ChampDbf {
  nom: string;
  type: 'C' | 'N';
  longueur: number;
  decimales: number;
}

/**
 * Deduit le schema DBF des attributs.
 * Les noms de champs sont tronques a 10 caracteres : c'est une limite du format DBF, pas
 * un choix - elle doit etre documentee a l'utilisateur.
 */
function schemaDbf(entites: EntiteShapefile[]): ChampDbf[] {
  const cles = [...new Set(entites.flatMap((e) => Object.keys(e.attributs)))];
  const utilises = new Set<string>();
  return cles.map((cle) => {
    let nom = cle
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .slice(0, 10)
      .toUpperCase();
    // Desambiguisation en cas de collision apres troncature.
    let suffixe = 1;
    const base = nom.slice(0, 8);
    while (utilises.has(nom)) {
      nom = `${base}${suffixe}`.slice(0, 10);
      suffixe += 1;
    }
    utilises.add(nom);

    const valeurs = entites.map((e) => e.attributs[cle]).filter((v) => v != null);
    const numerique = valeurs.length > 0 && valeurs.every((v) => typeof v === 'number');
    if (numerique) {
      const aDesDecimales = valeurs.some((v) => !Number.isInteger(v as number));
      return { nom, type: 'N' as const, longueur: 18, decimales: aDesDecimales ? 4 : 0 };
    }
    const longueurMax = Math.min(
      254,
      Math.max(1, ...valeurs.map((v) => Buffer.byteLength(String(v), 'utf8'))),
    );
    return { nom, type: 'C' as const, longueur: longueurMax, decimales: 0 };
  });
}

function ecrireDbf(entites: EntiteShapefile[], champs: ChampDbf[]): Buffer {
  const tailleEnTete = 32 + 32 * champs.length + 1;
  const tailleEnregistrement = 1 + champs.reduce((a, c) => a + c.longueur, 0);
  const total = tailleEnTete + tailleEnregistrement * entites.length + 1;
  const b = Buffer.alloc(total, 0x20);

  const maintenant = new Date();
  b[0] = 0x03; // dBase III sans memo
  b[1] = maintenant.getFullYear() - 1900;
  b[2] = maintenant.getMonth() + 1;
  b[3] = maintenant.getDate();
  b.writeInt32LE(entites.length, 4);
  b.writeInt16LE(tailleEnTete, 8);
  b.writeInt16LE(tailleEnregistrement, 10);
  // Page de code 65001 (UTF-8), doublee par un fichier .cpg pour les lecteurs anciens.
  b[29] = 0x00;

  let o = 32;
  for (const c of champs) {
    b.write(c.nom.padEnd(11, '\0').slice(0, 11), o, 11, 'latin1');
    b.write(c.type, o + 11, 1, 'latin1');
    b[o + 16] = c.longueur;
    b[o + 17] = c.decimales;
    o += 32;
  }
  b[o] = 0x0d; // fin de descripteur de champs
  o += 1;

  for (const e of entites) {
    b[o] = 0x20; // enregistrement non supprime
    o += 1;
    for (const c of champs) {
      const brut = e.attributs[
        Object.keys(e.attributs).find(
          (k) =>
            k
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/[^A-Za-z0-9_]/g, '_')
              .slice(0, 10)
              .toUpperCase() === c.nom,
        ) ?? c.nom
      ];
      let valeur: string;
      if (brut == null) {
        valeur = ''.padEnd(c.longueur, ' ');
      } else if (c.type === 'N') {
        valeur = Number(brut).toFixed(c.decimales).slice(0, c.longueur).padStart(c.longueur, ' ');
      } else {
        valeur = String(brut).slice(0, c.longueur).padEnd(c.longueur, ' ');
      }
      b.write(valeur, o, c.longueur, 'utf8');
      o += c.longueur;
    }
  }
  b[total - 1] = 0x1a; // marqueur de fin de fichier
  return b;
}

function ecrireShpEtShx(entites: EntiteShapefile[]): { shp: Buffer; shx: Buffer } {
  const contenus = entites.map((e) => contenuPolygone(e.anneaux));
  const enveloppeGlobale = enveloppeDe(entites.flatMap((e) => e.anneaux));

  const morceauxShp: Buffer[] = [];
  const morceauxShx: Buffer[] = [];
  let decalageMots = 50; // en mots de 16 bits, apres l'en-tete de 100 octets

  contenus.forEach((contenu, i) => {
    const enTeteEnr = Buffer.alloc(8);
    enTeteEnr.writeInt32BE(i + 1, 0); // numero d'enregistrement, 1-based
    enTeteEnr.writeInt32BE(contenu.length / 2, 4); // longueur du contenu, en mots
    morceauxShp.push(enTeteEnr, contenu);

    const enrShx = Buffer.alloc(8);
    enrShx.writeInt32BE(decalageMots, 0);
    enrShx.writeInt32BE(contenu.length / 2, 4);
    morceauxShx.push(enrShx);

    decalageMots += 4 + contenu.length / 2;
  });

  const corpsShp = Buffer.concat(morceauxShp);
  const corpsShx = Buffer.concat(morceauxShx);

  return {
    shp: Buffer.concat([enTete((100 + corpsShp.length) / 2, enveloppeGlobale), corpsShp]),
    shx: Buffer.concat([enTete((100 + corpsShx.length) / 2, enveloppeGlobale), corpsShx]),
  };
}

// ---------------------------------------------------------------------------
// Archive ZIP
// ---------------------------------------------------------------------------

interface FichierZip {
  nom: string;
  contenu: Buffer;
}

function dateMsDos(d: Date): { heure: number; date: number } {
  return {
    heure: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Archive ZIP minimale (deflate), suffisante pour QGIS et ArcGIS. */
export function zipper(fichiers: FichierZip[]): Buffer {
  const maintenant = new Date();
  const { heure, date } = dateMsDos(maintenant);
  const entrees: Buffer[] = [];
  const central: Buffer[] = [];
  let decalage = 0;

  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, 'utf8');
    const compresse = deflateRawSync(f.contenu, { level: 6 });
    const somme = crc32(f.contenu);

    const enTeteLocal = Buffer.alloc(30);
    enTeteLocal.writeUInt32LE(0x04034b50, 0);
    enTeteLocal.writeUInt16LE(20, 4); // version minimale
    enTeteLocal.writeUInt16LE(0x0800, 6); // noms de fichiers en UTF-8
    enTeteLocal.writeUInt16LE(8, 8); // methode deflate
    enTeteLocal.writeUInt16LE(heure, 10);
    enTeteLocal.writeUInt16LE(date, 12);
    enTeteLocal.writeUInt32LE(somme, 14);
    enTeteLocal.writeUInt32LE(compresse.length, 18);
    enTeteLocal.writeUInt32LE(f.contenu.length, 22);
    enTeteLocal.writeUInt16LE(nom.length, 26);
    entrees.push(enTeteLocal, nom, compresse);

    const enTeteCentral = Buffer.alloc(46);
    enTeteCentral.writeUInt32LE(0x02014b50, 0);
    enTeteCentral.writeUInt16LE(20, 4);
    enTeteCentral.writeUInt16LE(20, 6);
    enTeteCentral.writeUInt16LE(0x0800, 8);
    enTeteCentral.writeUInt16LE(8, 10);
    enTeteCentral.writeUInt16LE(heure, 12);
    enTeteCentral.writeUInt16LE(date, 14);
    enTeteCentral.writeUInt32LE(somme, 16);
    enTeteCentral.writeUInt32LE(compresse.length, 20);
    enTeteCentral.writeUInt32LE(f.contenu.length, 24);
    enTeteCentral.writeUInt16LE(nom.length, 28);
    enTeteCentral.writeUInt32LE(decalage, 42);
    central.push(enTeteCentral, nom);

    decalage += enTeteLocal.length + nom.length + compresse.length;
  }

  const corpsCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(corpsCentral.length, 12);
  fin.writeUInt32LE(decalage, 16);

  return Buffer.concat([...entrees, corpsCentral, fin]);
}

/**
 * Construit l'archive Shapefile complete.
 * `nomCouche` sert de nom de base aux quatre fichiers de l'archive.
 */
export function archiveShapefile(entites: EntiteShapefile[], nomCouche = 'parcelles'): Buffer {
  if (entites.length === 0) {
    throw new Error('Aucune entite a exporter');
  }
  const champs = schemaDbf(entites);
  const { shp, shx } = ecrireShpEtShx(entites);
  const dbf = ecrireDbf(entites, champs);

  return zipper([
    { nom: `${nomCouche}.shp`, contenu: shp },
    { nom: `${nomCouche}.shx`, contenu: shx },
    { nom: `${nomCouche}.dbf`, contenu: dbf },
    { nom: `${nomCouche}.prj`, contenu: Buffer.from(PRJ_WGS84, 'latin1') },
    { nom: `${nomCouche}.cpg`, contenu: Buffer.from('UTF-8', 'latin1') },
    {
      nom: 'LISEZ-MOI.txt',
      contenu: Buffer.from(
        [
          "Export Shapefile - application de prospection fonciere ENR",
          '',
          `Date d'export : ${new Date().toISOString()}`,
          'Systeme de coordonnees : WGS84 (EPSG:4326)',
          '',
          'AVERTISSEMENTS',
          "- Les contours parcellaires proviennent du Plan Cadastral Informatise : ils sont",
          "  indicatifs et n'ont aucune valeur juridique. Seul un document d'arpentage etabli",
          '  par un geometre-expert fait foi.',
          "- Les scores sont une aide a la decision, pas une garantie de faisabilite. Chaque",
          '  donnee doit etre re-verifiee au moment du depot et a l\'echelon departemental.',
          '- Les capacites de raccordement sont indicatives et non engageantes.',
          '',
          'NOTE TECHNIQUE',
          '- Le format DBF limite les noms de champs a 10 caracteres : certains noms ont ete',
          "  tronques. Le fichier GeoJSON exporte depuis l'application conserve les noms complets.",
        ].join('\n'),
        'utf8',
      ),
    },
  ]);
}
