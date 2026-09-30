/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES CARTES DES DOCUMENTS — la geometrie, puis ce que le document en dit
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. Les deux documents remis a un tiers — la fiche parcelle et le dossier
 * de site — portent desormais des vues cartographiques. Une carte fausse ne se signale pas : elle
 * s'imprime, elle a l'air d'une carte, et c'est le lecteur qui decouvre sur le terrain que le
 * contour n'etait pas au bon endroit. Tout ce qui se verifie sans reseau est donc verifie ici.
 *
 * CE QUI N'EST PAS TESTE, ET POURQUOI. Le telechargement des tuiles demande la Geoplateforme. Un
 * test qui sortirait sur le reseau serait rouge un jour sur dix pour une raison etrangere au
 * depot, et vert le reste du temps sans rien prouver de plus. Les fonctions pures — projection,
 * cadrage, echelle, conversion des contours — portent en revanche toute l'arithmetique, et c'est
 * la que les fautes se logent.
 *
 * LA SEULE PARTIE RESEAU VERIFIEE ICI est celle qui ne demande pas le reseau : la forme de l'URL
 * (liste fermee, aucune entree utilisateur) et le controle de signature des octets recus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anneauxEnPoints,
  barreEchelle,
  construireFigure,
  elargirA,
  estFond,
  estImage,
  FONDS,
  metresParPixel,
  reunirGeometries,
  urlTuile,
  versPixelMonde,
  zoomPour,
} from '../src/services/carte-statique.js';
import { emprise } from '../src/services/exports.js';
import { bboxDe, type GeoJsonGeometry } from '../src/geo.js';

/** Un carre d'environ 260 m de cote, pres de Tillay-le-Peneux (28). */
const CARRE: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1.834, 48.162],
      [1.8375, 48.162],
      [1.8375, 48.1598],
      [1.834, 48.1598],
      [1.834, 48.162],
    ],
  ],
};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test('LA PROJECTION EST BIEN CELLE DES TUILES WEB MERCATOR', () => {
  /*
   * Les reperes de la projection, verifiables a la main. Au zoom 0, le monde entier tient dans une
   * tuile de 256 px : le point (0, 0) tombe donc en son centre exact.
   */
  const [x, y] = versPixelMonde(0, 0, 0);
  assert.equal(x, 128);
  assert.ok(Math.abs(y - 128) < 1e-9, `l’equateur doit tomber au milieu — obtenu ${y}`);

  // L'antimeridien ouest est l'origine des abscisses ; l'est, la largeur entiere.
  assert.equal(versPixelMonde(-180, 0, 0)[0], 0);
  assert.equal(versPixelMonde(180, 0, 0)[0], 256);

  // Et le nord est en HAUT : une latitude plus grande doit rendre une ordonnee plus PETITE. Le
  // signe de cet axe est la faute la plus banale de toute la cartographie raster, et elle produit
  // une carte a l'envers qui reste parfaitement plausible tant qu'on ne regarde pas le terrain.
  assert.ok(versPixelMonde(2.35, 48.86, 12)[1] < versPixelMonde(2.35, 43.3, 12)[1]);

  // Le zoom double la resolution a chaque cran.
  assert.equal(versPixelMonde(0, 0, 3)[0], versPixelMonde(0, 0, 2)[0] * 2);
});

test('LA LATITUDE EST BORNEE AU DOMAINE DE LA PROJECTION', () => {
  /*
   * La projection de Mercator diverge aux poles : sans bornage, `Math.tan(π/2)` rend l'infini et
   * la tuile calculee est `NaN`. Aucune parcelle francaise n'atteint ces latitudes, mais une
   * geometrie mal formee — une coordonnee inversee, lon/lat pris a l'envers — y arrive tout de
   * suite, et la faute se manifesterait alors en aval, sous la forme d'un cadre vide inexplicable.
   */
  for (const lat of [90, -90, 1000]) {
    const [, y] = versPixelMonde(0, lat, 10);
    assert.ok(Number.isFinite(y), `latitude ${lat} : ordonnee non finie`);
  }
});

// ---------------------------------------------------------------------------
// Cadrage
// ---------------------------------------------------------------------------

test('LE CADRAGE RETIENT LE ZOOM LE PLUS DETAILLE QUI TIENNE ENCORE', () => {
  const bbox: [number, number, number, number] = [1.834, 48.1598, 1.8375, 48.162];

  /*
   * LA MESURE SE FAIT A MARGE NULLE, et c'est la premiere version de ce test qui l'a appris : a
   * marge 0,35 l'emprise BRUTE tient encore au zoom suivant, puisque c'est l'emprise ELARGIE qui
   * decide. Refaire le calcul sur l'emprise brute revenait donc a mesurer autre chose que ce que
   * la fonction fait, et le test echouait sur du code correct.
   */
  const z = zoomPour(bbox, 500, 344, 0);
  for (const [zi, doitTenir] of [
    [z, true],
    [z + 1, false],
  ] as const) {
    const [x1, y1] = versPixelMonde(bbox[0], bbox[3], zi);
    const [x2, y2] = versPixelMonde(bbox[2], bbox[1], zi);
    const tient = Math.abs(x2 - x1) <= 500 && Math.abs(y2 - y1) <= 344;
    if (doitTenir) assert.ok(tient, `au zoom ${zi} l’emprise devrait tenir`);
    else assert.ok(!tient, `au zoom ${zi} l’emprise devrait deborder : le cadrage est trop large`);
  }

  /*
   * ET LA MARGE SERT A QUELQUE CHOSE. Une parcelle collee aux bords de la vignette ne se lit pas :
   * on ne voit ni la route qui la dessert ni la parcelle voisine, c'est-a-dire ce qu'on regarde
   * une carte pour voir. Une marge ignoree ne se verrait nulle part ailleurs — la carte serait
   * simplement un peu moins utile, ce qui ne declenche aucune alerte.
   */
  assert.ok(
    zoomPour(bbox, 500, 344, 0.35) <= z,
    'la marge doit reculer d’au moins autant que le cadrage sans marge',
  );
  assert.ok(zoomPour(bbox, 500, 344, 4) < z, 'une marge large doit faire reculer le zoom');

  // Un cadre plus grand ne peut jamais rendre un zoom plus faible : la relation est monotone.
  assert.ok(zoomPour(bbox, 1000, 688) >= zoomPour(bbox, 500, 344));
});

test('LE CADRAGE NE DEPASSE JAMAIS LE ZOOM MAXIMAL', () => {
  /*
   * Une geometrie DEGENERE — un point, ou une parcelle minuscule — tient a tous les zooms. Sans
   * plafond, la boucle rendrait le premier essai, et un zoom 25 n'existe pas dans la pyramide de
   * l'IGN : toutes les tuiles reviendraient en erreur et la carte serait vide.
   */
  const point: [number, number, number, number] = [1.834, 48.162, 1.834, 48.162];
  assert.equal(zoomPour(point, 500, 344), 19);
  assert.equal(zoomPour(point, 500, 344, 0.35, 16), 16);
});

test('L’ELARGISSEMENT COUVRE AU MOINS LE RAYON DEMANDE', () => {
  const large = elargirA([1.834, 48.1598, 1.8375, 48.162], 1200);
  const centreLat = (large[1] + large[3]) / 2;

  const demiHauteurM = ((large[3] - large[1]) / 2) * 111_320;
  const demiLargeurM = ((large[2] - large[0]) / 2) * 111_320 * Math.cos((centreLat * Math.PI) / 180);
  // Tolerance au micrometre : l'aller-retour degres/metres ne revient pas au bit pres, et un
  // manque de 2·10⁻¹³ m n'est pas un defaut de cadrage.
  assert.ok(demiHauteurM >= 1200 - 1e-6, `demi-hauteur ${demiHauteurM} m < 1200 m`);
  assert.ok(demiLargeurM >= 1200 - 1e-6, `demi-largeur ${demiLargeurM} m < 1200 m`);

  /*
   * ET LA CONVERSION DEPEND DE LA LATITUDE — en longitude seulement. Un degre de longitude vaut
   * 111 km a l'equateur et 74 km a Dunkerque : convertir avec la meme constante dans les deux sens
   * donnerait, en France, une vue moitie trop etroite en longitude. Deux latitudes suffisent a le
   * dire, et la faute serait invisible sur une seule.
   */
  const aLequateur = elargirA([0, 0, 0, 0], 1200);
  const auNord = elargirA([0, 60, 0, 60], 1200);
  assert.ok(
    auNord[2] - auNord[0] > (aLequateur[2] - aLequateur[0]) * 1.5,
    'le meme rayon doit couvrir plus de degres de longitude a 60° qu’a l’equateur',
  );

  // Une enveloppe DEJA plus large que le rayon n'est pas retrecie : le rayon est un minimum.
  const deja = elargirA([-1, 40, 1, 42], 10);
  assert.deepEqual(deja, [-1, 40, 1, 42]);
});

// ---------------------------------------------------------------------------
// Echelle
// ---------------------------------------------------------------------------

test('LA BARRE D’ECHELLE PORTE UNE VALEUR RONDE ET NE DEBORDE PAS', () => {
  for (const metresParPt of [0.4, 1.6, 3.2, 26, 300]) {
    const largeurMax = 170;
    const barre = barreEchelle(metresParPt, largeurMax);
    assert.ok(
      barre.longueurPts <= largeurMax + 1e-9,
      `une barre de ${barre.longueurPts} pt deborde de la largeur allouee (${largeurMax})`,
    );

    // La valeur affichee doit etre celle que la barre mesure vraiment. Une barre dont le libelle
    // ne correspond pas a la longueur est pire qu'une absence d'echelle : elle est lue.
    const valeur = Number(barre.libelle.replace(/ (k?m)$/, '').replace(',', '.'));
    const metres = barre.libelle.endsWith('km') ? valeur * 1000 : valeur;
    assert.ok(
      Math.abs(barre.longueurPts * metresParPt - metres) < 1e-6,
      `« ${barre.libelle} » ne mesure pas ${barre.longueurPts} pt a ${metresParPt} m/pt`,
    );

    // Et la valeur est ronde : 1, 2,5 ou 5 fois une puissance de dix.
    assert.ok(
      [1, 2.5, 5].some((m) => Number.isInteger(Math.log10(metres / m) + 1e-9) || Math.abs(Math.log10(metres / m) - Math.round(Math.log10(metres / m))) < 1e-9),
      `« ${barre.libelle} » n’est pas une valeur ronde`,
    );
  }
});

test('LA RESOLUTION AU SOL SUIT LE ZOOM ET LA LATITUDE', () => {
  // Reperes usuels de la pyramide Web Mercator : environ 2,4 m/px au zoom 16, a 48° de latitude.
  const m16 = metresParPixel(48, 16);
  assert.ok(m16 > 1 && m16 < 2.5, `2,4 m/px attendus autour du zoom 16 — obtenu ${m16}`);
  assert.ok(Math.abs(metresParPixel(48, 15) - m16 * 2) < 1e-9, 'un cran de zoom doit doubler');
  assert.ok(metresParPixel(60, 16) < m16, 'un pixel couvre moins de sol quand on monte en latitude');
});

// ---------------------------------------------------------------------------
// Contours
// ---------------------------------------------------------------------------

test('LES CONTOURS SONT CONVERTIS DANS LE REPERE DE LA VIGNETTE', () => {
  const anneaux = anneauxEnPoints(CARRE, 16, 0, 0);
  assert.equal(anneaux.length, 1, 'un polygone simple rend un anneau');
  assert.equal(anneaux[0]!.length, 5, 'les cinq sommets, anneau ferme');

  // Le facteur de sur-echantillonnage divise les coordonnees comme il divise les tuiles. Un
  // contour qui oublierait cette division serait trace deux fois trop loin du coin — c'est-a-dire
  // sur la parcelle du voisin, avec la meme allure de carte correcte.
  const moitie = anneauxEnPoints(CARRE, 16, 0, 0, 2);
  assert.ok(Math.abs(moitie[0]![0]![0] - anneaux[0]![0]![0] / 2) < 1e-9);
  assert.ok(Math.abs(moitie[0]![0]![1] - anneaux[0]![0]![1] / 2) < 1e-9);
});

test('UN MULTI-POLYGONE REND TOUS SES ANNEAUX', () => {
  /*
   * Une parcelle en plusieurs morceaux existe, et un site en compte presque toujours plusieurs.
   * Ne tracer que le premier donnerait une carte ou une partie du projet n'apparait pas — et rien
   * dans le document ne dirait qu'il en manque.
   */
  const multi = reunirGeometries([CARRE, CARRE]);
  assert.equal(multi.type, 'MultiPolygon');
  assert.equal(anneauxEnPoints(multi, 16, 0, 0).length, 2);

  // Un multi-polygone dans l'entree est APLATI, pas imbrique d'un cran de plus : sinon la
  // profondeur croit a chaque reunion et les anneaux finissent hors de portee du parcours.
  const encore = reunirGeometries([multi, CARRE]);
  assert.equal(anneauxEnPoints(encore, 16, 0, 0).length, 3);
});

test('L’EMPRISE DES CONTOURS SE MESURE, ET VAUT NULL QUAND IL N’Y EN A PAS', () => {
  /*
   * C'est elle qui decide du cercle de reperage sur la vue large. Une emprise fausse ferait soit
   * disparaitre le reperage la ou il est necessaire, soit entourer une parcelle deja bien visible.
   */
  const e = emprise([
    [
      [10, 20],
      [30, 20],
      [30, 50],
      [10, 50],
    ],
  ]);
  assert.deepEqual(e, { cx: 20, cy: 35, largeur: 20, hauteur: 30 });
  assert.equal(emprise([]), null);
  assert.equal(emprise([[]]), null, 'un anneau vide ne doit pas rendre une emprise infinie');
});

// ---------------------------------------------------------------------------
// Le relais
// ---------------------------------------------------------------------------

test('L’URL DE TUILE NE PORTE QUE DES VALEURS DE LA LISTE FERMEE', () => {
  /*
   * LA REGLE QUI COMPTE : aucune entree utilisateur n'entre dans cette URL. Un composant serveur
   * qui accepterait une couche ou un hote depuis une requete deviendrait un proxy ouvert derriere
   * l'authentification de l'application — c'est-a-dire un moyen d'emprunter son adresse IP.
   */
  const url = urlTuile('ortho', 16, 33_112, 22_704);
  assert.ok(url.startsWith('https://data.geopf.fr/wmts?'), `hote inattendu : ${url}`);
  assert.match(url, /LAYER=ORTHOIMAGERY\.ORTHOPHOTOS/);
  assert.match(url, /TILEMATRIX=16(&|$)/);
  assert.match(url, /TILEROW=22704(&|$)/);
  assert.match(url, /TILECOL=33112(&|$)/);

  for (const fond of Object.keys(FONDS)) {
    assert.ok(estFond(fond), `« ${fond} » devrait etre reconnu`);
  }
  for (const intrus of ['', 'PLAN', 'constructor', 'toString', '__proto__']) {
    assert.ok(!estFond(intrus), `« ${intrus} » ne doit pas passer pour un fond`);
  }
});

test('SEULS DES OCTETS D’IMAGE SONT POSES DANS LE DOCUMENT', () => {
  /**
   * LE DEFAUT EVITE. PDFKit n'accepte que le PNG et le JPEG, et il LEVE sur tout le reste. Hors
   * emprise, la Geoplateforme repond parfois 200 avec un XML d'exception ; le poser dans le
   * document ferait echouer la generation ENTIERE du dossier, pour une tuile de bord — un export
   * en erreur 500 la ou il manquait un coin de carte.
   *
   * Le controle porte sur la SIGNATURE des octets, et non sur l'en-tete annonce : c'est
   * precisement le cas ou le serveur annonce autre chose que ce qu'il envoie.
   */
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49]);
  assert.ok(estImage(png));
  assert.ok(estImage(jpeg));

  assert.ok(!estImage(Buffer.from('<?xml version="1.0"?><ExceptionReport/>')));
  assert.ok(!estImage(Buffer.from('')), 'une reponse vide n’est pas une image');
  assert.ok(!estImage(Buffer.from([0x89, 0x50])), 'quelques octets ne suffisent pas a decider');
  assert.ok(!estImage(Buffer.from('GIF89a et la suite')), 'le GIF n’est pas accepte par PDFKit');
});

// ---------------------------------------------------------------------------
// Le refus, qui ne demande pas le reseau
// ---------------------------------------------------------------------------

test('UNE GEOMETRIE SANS COORDONNEE N’ATTEINT MEME PAS LE RESEAU', async () => {
  /**
   * LA FAUTE EVITEE. `bboxDe` rend `[0, 0, 0, 0]` quand elle ne trouve aucune position — une
   * enveloppe parfaitement valide, au large du golfe de Guinee. Sans ce controle, le dossier
   * demanderait des tuiles de l'ocean Atlantique, et rien, ni dans le document ni dans les
   * journaux, ne dirait que la geometrie etait vide.
   *
   * ═══ POURQUOI LE TEST COMPTE LES APPELS AU LIEU DE REGARDER LE RESULTAT
   *
   * PREMIERE VERSION, ET CE QU'ELLE NE PROUVAIT PAS. Elle se contentait d'exiger `null`. La
   * verification par mutation l'a dit tout de suite : en supprimant le garde, le test restait
   * VERT. La raison est instructive — la Geoplateforme ne couvre pas le golfe de Guinee, elle
   * repond 404, toutes les tuiles reviennent nulles, et la figure vaut `null` de toute facon. Le
   * test mesurait donc la couverture de l'IGN, pas le garde du depot.
   *
   * LA PROPRIETE REELLE est que le refus intervient AVANT le premier appel : une geometrie vide
   * ne doit produire aucune requete sortante. C'est ce qui se compte, et c'est ce qui tient si
   * l'IGN etend un jour son emprise ou change son code de reponse.
   */
  const vraiFetch = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    appels += 1;
    return vraiFetch(...args);
  }) as typeof fetch;

  try {
    for (const vide of [
      { type: 'Polygon', coordinates: [] },
      { type: 'MultiPolygon', coordinates: [[]] },
      { type: 'Polygon', coordinates: null },
    ] as GeoJsonGeometry[]) {
      assert.equal(
        await construireFigure(vide, { fond: 'plan', largeur: 250, hauteur: 172 }),
        null,
        `une geometrie vide (${JSON.stringify(vide.coordinates)}) ne doit pas produire de figure`,
      );
    }
  } finally {
    globalThis.fetch = vraiFetch;
  }

  assert.equal(appels, 0, `${appels} requete(s) sortante(s) pour une geometrie vide`);
});

// ---------------------------------------------------------------------------
// Calques thematiques
// ---------------------------------------------------------------------------

/** Un PNG de 1×1 pixel : la plus petite image valide que le code accepte. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Une parcelle fictive en Beauce, la ou les couches thematiques existent. */
const PARCELLE_ESSAI: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1.772, 48.143],
      [1.776, 48.143],
      [1.776, 48.146],
      [1.772, 48.146],
      [1.772, 48.143],
    ],
  ],
};

/**
 * Remplace le reseau : les tuiles de FOND repondent, celles de CALQUE suivent `calqueRepond`.
 * Rend aussi les zooms demandes, ce qui permet de verifier le plafonnement sans deviner.
 */
function poserReseau(calqueRepond: boolean): { zooms: () => number[]; restaurer: () => void } {
  const vrai = globalThis.fetch;
  const zooms: number[] = [];
  globalThis.fetch = (async (entree: Parameters<typeof fetch>[0]) => {
    const url = String(entree);
    const z = Number(new URL(url).searchParams.get('TILEMATRIX'));
    if (Number.isFinite(z)) zooms.push(z);
    // Le fond passe par `wmts` avec une couche de FONDS ; les calques ont leur propre couche.
    const estFond = /LAYER=(GEOGRAPHICALGRIDSYSTEMS|ORTHOIMAGERY)/.test(url);
    if (!estFond && !calqueRepond) return new Response('non', { status: 404 });
    return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch;
  return { zooms: () => zooms, restaurer: () => { globalThis.fetch = vrai; } };
}

test('UN CALQUE QUI NE REPOND PAS SUPPRIME LA FIGURE, IL NE LAISSE PAS LE FOND NU', async () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LE GARDE LE PLUS IMPORTANT DE CE CHANTIER
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * Une vue thematique dont le calque n'arrive pas montre le fond seul — un plan, une
   * photographie — sous une legende qui annonce « Zonage du document d'urbanisme » ou « Milieux ».
   * Le lecteur y lit une ABSENCE DE CONTRAINTE. C'est le defaut que tout ce depot combat, pose sur
   * le support le plus difficile a dementir : une image dans un dossier remis a un developpeur, qui
   * la regardera avant de lire une seule ligne de texte.
   *
   * Une figure absente, elle, se lit comme ce qu'elle est : une vue qu'on n'a pas pu produire — et
   * `blocCartes` ecrit la phrase qui le dit.
   */
  const reseau = poserReseau(false);
  try {
    const sansCalque = await construireFigure(PARCELLE_ESSAI, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
    });
    assert.notEqual(sansCalque, null, 'sans calque demandé, le fond seul reste une figure valide');

    const avecCalque = await construireFigure(PARCELLE_ESSAI, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
      calques: ['plu'],
      legende: 'Zonage du document d’urbanisme',
    });
    assert.equal(
      avecCalque,
      null,
      'un calque muet doit supprimer la figure, sans quoi le fond nu passe pour une absence de zonage',
    );
  } finally {
    reseau.restaurer();
  }
});

test('LE CALQUE SE POSE SUR LA MEME GRILLE QUE LE FOND, TUILE POUR TUILE', async () => {
  const reseau = poserReseau(true);
  try {
    const f = await construireFigure(PARCELLE_ESSAI, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
      calques: ['plu'],
    });
    assert.ok(f);
    assert.equal(
      f.surcouches.length,
      f.tuiles.length,
      'un calque complet couvre exactement les tuiles du fond',
    );
    /*
     * ET AUX MEMES COORDONNEES. Un decalage d'une seule tuile poserait le zonage d'urbanisme du
     * secteur voisin sur la parcelle — une erreur invisible a la lecture, et grave.
     */
    for (const [i, t] of f.surcouches.entries()) {
      assert.equal(t.x, f.tuiles[i]!.x);
      assert.equal(t.y, f.tuiles[i]!.y);
      assert.equal(t.taille, f.tuiles[i]!.taille);
    }
  } finally {
    reseau.restaurer();
  }
});

/**
 * Une PETITE parcelle — environ 40 m de cote — dont le cadrage naturel se cale bien au-dessus du
 * plafond des calques.
 *
 * LE CHOIX DE LA TAILLE EST LE TEST. Avec la parcelle ordinaire, large de 300 m, le cadrage tombe
 * de lui-meme au zoom 16 : retirer le plafond ne changeait donc rien, et la verification par
 * mutation l'a dit — le motif survivait. Un garde qui ne distingue pas le code du hasard des
 * fixtures ne garde rien.
 */
const PARCELLE_PETITE: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1.7720, 48.1430],
      [1.7725, 48.1430],
      [1.7725, 48.1434],
      [1.7720, 48.1434],
      [1.7720, 48.1430],
    ],
  ],
};

test('LE ZOOM EST PLAFONNE PAR LE CALQUE LE PLUS CONTRAIGNANT', async () => {
  /**
   * MESURE DU 30/09/2026, zoom par zoom sur la tuile de la parcelle d'essai : le RPG, les zones
   * humides et la BD Forêt s'arrêtent au 16, les courbes de niveau au 18. Une vue cadrée sur une
   * parcelle se cale au 19 — au-delà du plafond, ces services ne rendent rien, la règle ci-dessus
   * supprimait la figure, et le dossier perdait ses vues thématiques sans que rien ne l'explique.
   */
  const reseau = poserReseau(true);
  try {
    /*
     * LA REFERENCE : sans calque, cette petite parcelle se cadre bien au-dela de 16. C'est ce qui
     * rend le plafond observable — et ce qui manquait a la premiere version de ce test.
     */
    const sansCalque = await construireFigure(PARCELLE_PETITE, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
    });
    assert.ok(sansCalque);
    assert.ok(
      sansCalque.zoom > 16,
      `le fixture doit se cadrer au-delà du plafond pour que le test ait un sens (${sansCalque.zoom})`,
    );

    const rpg = await construireFigure(PARCELLE_PETITE, {
      fond: 'ortho',
      largeur: 250,
      hauteur: 172,
      calques: ['rpg'],
    });
    assert.ok(rpg);
    assert.equal(rpg.zoom, 16, `le RPG n'est pré-tuilé que jusqu'au 16, figure au ${rpg.zoom}`);

    const courbes = await construireFigure(PARCELLE_PETITE, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
      calques: ['courbes'],
    });
    assert.ok(courbes);
    assert.equal(courbes.zoom, 18, `les courbes montent au 18, figure au ${courbes.zoom}`);

    /*
     * DEUX CALQUES : C'EST LE PLUS CONTRAIGNANT QUI DECIDE. Retenir le plus permissif rendrait le
     * second muet, donc supprimerait la figure — la vue « milieux » en porte deux.
     */
    const deux = await construireFigure(PARCELLE_PETITE, {
      fond: 'ortho',
      largeur: 250,
      hauteur: 172,
      calques: ['courbes', 'rpg'],
    });
    assert.ok(deux);
    assert.equal(deux.zoom, 16, `le plus contraignant des deux impose 16, figure au ${deux.zoom}`);
  } finally {
    reseau.restaurer();
  }
});

test('SANS CALQUE DEMANDE, RIEN NE CHANGE — NI SURCOUCHE, NI PLAFOND', async () => {
  /*
   * LE CONTRE-EXEMPLE. Si le plafond des calques s'appliquait aussi aux vues ordinaires, le plan et
   * la photographie perdraient trois niveaux de zoom, et la parcelle deviendrait illisible.
   */
  const reseau = poserReseau(true);
  try {
    const f = await construireFigure(PARCELLE_ESSAI, { fond: 'plan', largeur: 250, hauteur: 172 });
    assert.ok(f);
    assert.deepEqual(f.surcouches, []);
    /*
     * LE ZOOM ATTENDU SE RECALCULE, il ne se devine pas : celui d'une vue depend de la taille de la
     * parcelle, et affirmer « plus de 16 » ferait dependre le test du fixture plutot que du code.
     * Ce qui se verifie ici est que le plafond des calques n'est PAS applique.
     */
    const attendu = zoomPour(bboxDe(PARCELLE_ESSAI), 250 * 2, 172 * 2, 0.35);
    assert.equal(f.zoom, attendu, 'sans calque, le zoom reste celui du cadrage, sans plafond');

    // Et la preuve par la difference : la meme geometrie AVEC un calque plafonne a 16 descend.
    const avec = await construireFigure(PARCELLE_ESSAI, {
      fond: 'plan',
      largeur: 250,
      hauteur: 172,
      calques: ['rpg'],
    });
    assert.ok(avec);
    assert.ok(avec.zoom <= f.zoom, 'le plafond ne peut que baisser le zoom, jamais le monter');
  } finally {
    reseau.restaurer();
  }
});
