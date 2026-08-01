/**
 * Catalogue des calques cartographiques.
 *
 * Trois facons de servir une couche, choisies selon ce que le producteur publie
 * reellement — c'est la raison d'etre de ce fichier :
 *
 *   - `raster`  : image relayee depuis un service WMTS ou WMS officiel. Aucune ingestion,
 *                 donnee toujours a jour cote producteur, couverture nationale immediate.
 *                 C'est le mode a privilegier des qu'un service d'images existe : demander a
 *                 l'exploitant d'ingerer plusieurs gigaoctets de vecteur pour un simple
 *                 affichage serait absurde.
 *   - `vecteur_api` : GeoJSON interroge a la demande sur l'emprise visible (API Carto). Plus
 *                 couteux qu'une image, mais les objets sont cliquables et nommes. Reserve
 *                 aux zonages que personne ne publie en images : Natura 2000, reserves,
 *                 parcs.
 *   - `vecteur_base` : objets ingeres en base (monuments historiques).
 *
 * Chaque entree porte sa SOURCE et son MILLESIME, affiches dans l'interface : une contrainte
 * environnementale sans provenance datee n'est pas exploitable dans un dossier.
 *
 * Les identifiants de couches WMTS/WMS ont ete verifies contre les GetCapabilities de la
 * Geoplateforme le 2026-08-01. Un identifiant errone se traduirait par un calque
 * silencieusement vide.
 */

export type ModeCalque = 'raster' | 'vecteur_api' | 'vecteur_base';

export interface SourceCalque {
  /** Nom lisible du producteur et du jeu. */
  nom: string;
  /** Millesime ou periode de reference de la donnee. */
  millesime: string | null;
  /** Page de reference, pour que l'utilisateur puisse remonter a la donnee. */
  url: string | null;
  valeurJuridique: 'opposable' | 'indicative' | 'pre_reperage';
}

export interface DefinitionCalque {
  id: string;
  libelle: string;
  groupe: 'foret' | 'environnement' | 'patrimoine' | 'risques' | 'urbanisme' | 'agriculture';
  /** Couleur de reference dans la legende. */
  couleur: string;
  mode: ModeCalque;
  source: SourceCalque;
  /** Ce que montre le calque, en une phrase : la legende du producteur est souvent illisible. */
  legende: string;
  /** Reserve d'interpretation, affichee au survol. */
  avertissement?: string;
  /** Zoom minimal d'affichage : certains services ne produisent rien en vue nationale. */
  zoomMin?: number;
  /** Configuration du relais raster. */
  raster?:
    | { protocole: 'wmts'; couche: string; format: 'image/png' | 'image/jpeg' }
    | { protocole: 'wms'; couche: string; format: 'image/png'; version?: string };
  /** Chemin du module API Carto Nature, pour le mode `vecteur_api`. */
  cheminsApi?: string[];
  /** Type d'objet dans la table `contrainte`, pour le mode `vecteur_base`. */
  typeBase?: string;
}

const GEOPF = 'https://data.geopf.fr';

export const CALQUES: DefinitionCalque[] = [
  // ------------------------------------------------------------------ forets
  {
    id: 'forets_publiques',
    libelle: 'Forets publiques (domaniales et communales)',
    groupe: 'foret',
    couleur: '#15803d',
    mode: 'raster',
    raster: { protocole: 'wms', couche: 'FORETS.PUBLIQUES', format: 'image/png' },
    source: {
      nom: 'ONF / IGN - Forets publiques',
      millesime: '2024',
      url: 'https://geoservices.ign.fr/',
      valeurJuridique: 'indicative',
    },
    legende:
      'Forets relevant du regime forestier : domaniales (Etat) et des collectivites. Un projet y est en pratique exclu.',
    avertissement:
      "Le regime forestier interdit en pratique tout projet ENR au sol : le defrichement d'une foret publique suppose une distraction du regime forestier, procedure longue et rarement accordee.",
  },
  {
    id: 'bd_foret',
    libelle: 'Couvert forestier (BD Foret v2)',
    groupe: 'foret',
    couleur: '#166534',
    mode: 'raster',
    raster: { protocole: 'wmts', couche: 'LANDCOVER.FORESTINVENTORY.V2', format: 'image/png' },
    source: {
      nom: 'IGN - BD Foret version 2',
      millesime: '2006-2019',
      url: 'https://geoservices.ign.fr/bdforet',
      valeurJuridique: 'indicative',
    },
    legende:
      'Formations vegetales boisees de plus de 0,5 ha, publiques comme privees, par type de peuplement.',
    avertissement:
      "Millesime departemental etale sur 2006-2019 : une coupe rase ou un boisement recent n'y figure pas. Le defrichement d'un bois prive reste soumis a autorisation.",
  },
  {
    id: 'forets_anciennes',
    libelle: 'Forets anciennes',
    groupe: 'foret',
    couleur: '#14532d',
    mode: 'raster',
    raster: { protocole: 'wms', couche: 'IGNF_FORETS-ANCIENNES', format: 'image/png' },
    source: {
      nom: 'IGN - Forets anciennes',
      millesime: '2023',
      url: 'https://geoservices.ign.fr/',
      valeurJuridique: 'indicative',
    },
    legende:
      'Boisements presents deja sur la carte d\'etat-major du XIXe siecle : sols forestiers a forte valeur ecologique.',
    avertissement:
      "L'anciennete d'un boisement pese lourdement dans l'instruction d'une demande de defrichement.",
  },
  {
    id: 'debroussaillement',
    libelle: 'Obligations legales de debroussaillement',
    groupe: 'foret',
    couleur: '#ea580c',
    mode: 'raster',
    raster: { protocole: 'wms', couche: 'DEBROUSSAILLEMENT', format: 'image/png' },
    source: {
      nom: 'IGN / DGPE - Zonage informatif des OLD',
      millesime: '2024',
      url: 'https://geoservices.ign.fr/',
      valeurJuridique: 'indicative',
    },
    legende: 'Secteurs ou le debroussaillement est obligatoire aux abords des constructions.',
    avertissement: 'Zonage informatif : seul l\'arrete prefectoral en vigueur fait foi.',
  },

  // ----------------------------------------------------------- environnement
  {
    id: 'natura2000_habitats',
    libelle: 'Natura 2000 - directive Habitats (ZSC/SIC)',
    groupe: 'environnement',
    couleur: '#15803d',
    mode: 'vecteur_api',
    cheminsApi: ['natura-habitat'],
    zoomMin: 9,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'opposable',
    },
    legende: 'Sites designes au titre de la directive Habitats-Faune-Flore.',
    avertissement:
      "Tout projet, meme hors site, declenche une evaluation des incidences Natura 2000 des lors qu'il est susceptible d'affecter le site.",
  },
  {
    id: 'natura2000_oiseaux',
    libelle: 'Natura 2000 - directive Oiseaux (ZPS)',
    groupe: 'environnement',
    couleur: '#22c55e',
    mode: 'vecteur_api',
    cheminsApi: ['natura-oiseaux'],
    zoomMin: 9,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'opposable',
    },
    legende: 'Zones de protection speciale designees au titre de la directive Oiseaux.',
    avertissement:
      "Enjeu majeur pour l'eolien : la sensibilite avifaune conditionne l'acceptabilite du projet.",
  },
  {
    id: 'znieff1',
    libelle: 'ZNIEFF de type I',
    groupe: 'environnement',
    couleur: '#65a30d',
    mode: 'vecteur_api',
    cheminsApi: ['znieff1'],
    zoomMin: 9,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'indicative',
    },
    legende: 'Secteurs de superficie limitee abritant des especes ou des habitats remarquables.',
    avertissement:
      "Les ZNIEFF n'ont pas de portee reglementaire directe, mais pesent lourdement dans l'instruction et le contentieux.",
  },
  {
    id: 'znieff2',
    libelle: 'ZNIEFF de type II',
    groupe: 'environnement',
    couleur: '#a3e635',
    mode: 'vecteur_api',
    cheminsApi: ['znieff2'],
    zoomMin: 9,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'indicative',
    },
    legende: 'Grands ensembles naturels riches et peu modifies.',
  },
  {
    id: 'reserve_naturelle',
    libelle: 'Reserves naturelles (nationales et de Corse)',
    groupe: 'environnement',
    couleur: '#047857',
    mode: 'vecteur_api',
    cheminsApi: ['rnn', 'rnc'],
    zoomMin: 8,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'opposable',
    },
    legende: 'Protection forte : tout projet y est exclu.',
    avertissement: 'Protection reglementaire forte : critere redhibitoire dans le scoring.',
  },
  {
    id: 'parc_national',
    libelle: 'Parcs nationaux',
    groupe: 'environnement',
    couleur: '#065f46',
    mode: 'vecteur_api',
    cheminsApi: ['pn'],
    zoomMin: 7,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'opposable',
    },
    legende: "Coeur de parc : protection forte. Aire d'adhesion : reglement propre au parc.",
  },
  {
    id: 'parc_naturel_regional',
    libelle: 'Parcs naturels regionaux',
    groupe: 'environnement',
    couleur: '#5eead4',
    mode: 'vecteur_api',
    cheminsApi: ['pnr'],
    zoomMin: 7,
    source: {
      nom: 'INPN / MNHN via IGN API Carto module Nature',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'indicative',
    },
    legende: "Perimetre de charte : pas d'interdiction generale, mais des prescriptions locales.",
    avertissement:
      "La charte du parc peut encadrer strictement l'eolien et le photovoltaique au sol. La consulter avant tout demarchage.",
  },
  {
    id: 'zones_humides_bcae',
    libelle: 'Zones humides et tourbieres (BCAE 2)',
    groupe: 'environnement',
    couleur: '#0891b2',
    mode: 'raster',
    raster: { protocole: 'wmts', couche: 'TOURBIERES_ZONES-HUMIDES.BCAE', format: 'image/png' },
    source: {
      nom: 'IGN / ASP - zonage BCAE 2',
      millesime: '2024',
      url: 'https://geoservices.ign.fr/',
      valeurJuridique: 'pre_reperage',
    },
    legende: 'Zones humides et tourbieres protegees au titre de la conditionnalite PAC.',
    avertissement:
      "Pre-reperage : le caractere humide se determine par sondages pedologiques et releves floristiques (arrete du 24 juin 2008 modifie). Ce calque ne remplace pas une etude de terrain.",
  },
  {
    id: 'clc_zones_humides',
    libelle: 'Zones humides et surfaces en eau (Corine Land Cover HR)',
    groupe: 'environnement',
    couleur: '#0e7490',
    mode: 'raster',
    // WMS et non WMTS : cette couche Copernicus n'est pas pre-tuilee en projection PM.
    raster: { protocole: 'wms', couche: 'LANDCOVER.HR.WAW.CLC15', format: 'image/png' },
    source: {
      nom: 'Copernicus / IGN - CLC haute resolution',
      millesime: '2015',
      url: 'https://land.copernicus.eu/',
      valeurJuridique: 'pre_reperage',
    },
    legende: 'Couche haute resolution (20 m) des zones humides et surfaces en eau permanentes.',
    avertissement: 'Millesime 2015, resolution 20 m : reperage d\'ensemble, pas de delimitation.',
  },
  {
    id: 'znieff1_raster',
    libelle: 'ZNIEFF I et II - vue d\'ensemble (image)',
    groupe: 'environnement',
    couleur: '#84cc16',
    mode: 'raster',
    raster: { protocole: 'wmts', couche: 'Patrinat_ZNIEFF1', format: 'image/png' },
    source: {
      nom: 'PatriNat (OFB / MNHN / CNRS) via IGN',
      millesime: 'mise a jour continue',
      url: 'https://inpn.mnhn.fr/',
      valeurJuridique: 'indicative',
    },
    legende:
      "Meme donnee que le calque vectoriel ZNIEFF, servie en image : utile pour balayer un departement entier sans attendre.",
  },

  // -------------------------------------------------------------- patrimoine
  {
    id: 'monument_historique',
    libelle: 'Monuments historiques',
    groupe: 'patrimoine',
    couleur: '#7c3aed',
    mode: 'vecteur_base',
    typeBase: 'monument_historique',
    source: {
      nom: 'Ministere de la Culture - base Merimee (via data.gouv.fr)',
      millesime: '2024',
      url: 'https://www.data.gouv.fr/',
      valeurJuridique: 'opposable',
    },
    legende:
      'Edifices classes ou inscrits. Le perimetre de protection couvre par defaut 500 m autour du monument.',
    avertissement:
      "Le perimetre delimite des abords (PDA) se substitue au rayon de 500 m lorsqu'il existe : l'application applique le rayon par defaut et le signale.",
  },
  {
    id: 'sites_patrimoniaux',
    libelle: 'Sites classes, inscrits et perimetres ABF',
    groupe: 'patrimoine',
    couleur: '#6d28d9',
    mode: 'vecteur_api',
    // Servitudes d'utilite publique du GPU : AC1 monuments historiques, AC2 sites,
    // AC4 sites patrimoniaux remarquables.
    cheminsApi: ['gpu:ac1', 'gpu:ac2', 'gpu:ac4'],
    zoomMin: 11,
    source: {
      nom: 'Geoportail de l\'Urbanisme - servitudes AC1 / AC2 / AC4',
      millesime: 'selon versement des services instructeurs',
      url: 'https://www.geoportail-urbanisme.gouv.fr/',
      valeurJuridique: 'opposable',
    },
    legende:
      "Servitudes de protection du patrimoine : abords de monuments (AC1), sites classes et inscrits (AC2), sites patrimoniaux remarquables (AC4).",
    avertissement:
      "La couverture du Geoportail de l'Urbanisme depend du versement par chaque service instructeur : une absence de servitude n'est pas une garantie d'absence de protection.",
  },
];

export const CALQUES_PAR_ID: Record<string, DefinitionCalque> = Object.fromEntries(
  CALQUES.map((c) => [c.id, c]),
);

/** URL amont d'une tuile raster relayee. */
export function urlRasterAmont(
  calque: DefinitionCalque,
  z: number,
  x: number,
  y: number,
): string | null {
  const r = calque.raster;
  if (!r) return null;

  if (r.protocole === 'wmts') {
    const p = new URLSearchParams({
      SERVICE: 'WMTS',
      VERSION: '1.0.0',
      REQUEST: 'GetTile',
      LAYER: r.couche,
      STYLE: 'normal',
      TILEMATRIXSET: 'PM',
      FORMAT: r.format,
      TILEMATRIX: String(z),
      TILEROW: String(y),
      TILECOL: String(x),
    });
    return `${GEOPF}/wmts?${p.toString()}`;
  }

  // WMS : le service ne connait pas les tuiles, il faut lui donner l'emprise de la tuile
  // en metres (EPSG:3857). C'est la conversion inverse du schema de tuilage spherique.
  const COTE = 20037508.342789244;
  const n = 2 ** z;
  const pas = (2 * COTE) / n;
  const ouest = -COTE + x * pas;
  const est = ouest + pas;
  const nord = COTE - y * pas;
  const sud = nord - pas;
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: r.version ?? '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: r.couche,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: `${ouest},${sud},${est},${nord}`,
    WIDTH: '256',
    HEIGHT: '256',
    FORMAT: r.format,
    TRANSPARENT: 'true',
  });
  return `${GEOPF}/wms-r/wms?${p.toString()}`;
}
