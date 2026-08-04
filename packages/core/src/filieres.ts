/**
 * Filieres ENR couvertes par l'application.
 *
 * Le choix de la filiere pilote l'ensemble de l'application : couches affichees,
 * criteres evalues, ponderations par defaut, contenu de la fiche parcelle.
 */

export const FILIERES = ['solaire_sol', 'eolien_terrestre', 'bess', 'methanisation'] as const;

export type Filiere = (typeof FILIERES)[number];

/**
 * Coefficient de sinuosite entre la distance a vol d'oiseau et le lineaire reellement pose.
 *
 * Une liaison de raccordement ne va pas en ligne droite : elle suit les emprises publiques,
 * contourne le bati, les cours d'eau et les parcelles dont le passage n'a pas ete negocie.
 * Le rapport observe sur les raccordements realises se situe entre 1,3 et 1,6 ; 1,35 est
 * retenu comme valeur prudente.
 *
 * Place dans @enr/core, et non dans le moteur de scoring, parce que TROIS composants
 * doivent en donner la meme lecture : le moteur qui note le lineaire, les exports qui
 * l'impriment, et la carte qui dessine le rayon autour des postes. Un rayon trace en vol
 * d'oiseau autour d'un score calcule en trace fait cadrer un secteur sur une contrainte
 * qui n'est pas celle qui sera notee.
 */
export const COEFFICIENT_TRACE = 1.35;

/** Lineaire de raccordement estime, en kilometres, a partir de la distance a vol d'oiseau. */
export function lineaireRaccordementKm(distanceVolOiseauKm: number): number {
  return Math.round(distanceVolOiseauKm * COEFFICIENT_TRACE * 100) / 100;
}

/**
 * Distance a vol d'oiseau correspondant a un lineaire de trace donne.
 *
 * Reciproque de la precedente : la carte raisonne en distance geodesique (un cercle), mais
 * l'utilisateur choisit un budget de lineaire.
 */
export function volOiseauPourLineaireKm(lineaireKm: number): number {
  return lineaireKm / COEFFICIENT_TRACE;
}

export interface FiliereMeta {
  id: Filiere;
  libelle: string;
  libelleCourt: string;
  description: string;
  /** Emoji/icone utilise dans le selecteur de filiere. */
  icone: string;
  /** Le "critere roi" de la filiere, affiche en tete de la fiche. */
  critereRoi: string;
  /** Surface utile minimale, en hectares, en dessous de laquelle un projet est rarement finançable. */
  surfaceUtileMinHa: number;
  /** Surface au-dela de laquelle la filiere atteint sa pleine competitivite (plateau du score surface). */
  surfaceUtileOptimaleHa: number;
  /** Le gisement de ressource intervient-il dans le score ? (non pour le stockage) */
  gisementPertinent: boolean;
  /**
   * Rayon de raccordement economiquement raisonnable, en km, affiche par defaut autour des
   * postes sources.
   *
   * Il differe fortement d'une filiere a l'autre, parce que le cout de raccordement se
   * rapporte a la puissance evacuee : une centrale solaire de 20 MWc amortit plusieurs
   * kilometres de liaison, un parc eolien de 30 MW davantage encore, un stockage vit de
   * l'arbitrage et supporte mal l'eloignement, et une unite de methanisation raccordee au
   * gaz n'a pas le meme reseau de reference. Valeurs indicatives, ajustables par
   * l'utilisateur : elles ne remplacent pas une etude de raccordement.
   */
  rayonRaccordementKm: number;
  /** Couches cartographiques a activer par defaut pour cette filiere. */
  couchesParDefaut: string[];
}

export const FILIERES_META: Record<Filiere, FiliereMeta> = {
  solaire_sol: {
    id: 'solaire_sol',
    libelle: 'Solaire au sol / agrivoltaisme',
    libelleCourt: 'Solaire au sol',
    description:
      "Centrale photovoltaique au sol sur terrain degrade, inculte ou en configuration agrivoltaique sur parcelle agricole exploitee.",
    icone: 'sun',
    critereRoi: "Regime d'implantation (degrade / inculte / agricole) et irradiation",
    surfaceUtileMinHa: 1,
    surfaceUtileOptimaleHa: 20,
    gisementPertinent: true,
    // une centrale de 5 a 20 MWc amortit couramment 5 a 10 km de liaison
    rayonRaccordementKm: 8,
    couchesParDefaut: ['parcelles', 'postes_sources', 'zonage_urba', 'rpg', 'zaer', 'natura2000'],
  },
  eolien_terrestre: {
    id: 'eolien_terrestre',
    libelle: 'Eolien terrestre',
    libelleCourt: 'Eolien',
    description:
      'Parc eolien terrestre soumis a autorisation environnementale (ICPE 2980), avec contrainte de 500 m des habitations.',
    icone: 'wind',
    critereRoi: "Eloignement de l'habitat (500 m minimum) et gisement de vent",
    surfaceUtileMinHa: 10,
    surfaceUtileOptimaleHa: 80,
    gisementPertinent: true,
    // un parc de 20 a 40 MW supporte une liaison plus longue
    rayonRaccordementKm: 12,
    couchesParDefaut: [
      'parcelles',
      'postes_sources',
      'bati_500m',
      'contraintes_aero',
      'monuments_historiques',
      'natura2000',
    ],
  },
  bess: {
    id: 'bess',
    libelle: "Stockage par batteries (BESS)",
    libelleCourt: 'Stockage BESS',
    description:
      "Installation de stockage d'electricite sur batteries, raccordee au reseau. Le gisement de ressource n'intervient pas.",
    icone: 'battery',
    critereRoi: 'Distance et capacite residuelle du poste source',
    surfaceUtileMinHa: 0.5,
    surfaceUtileOptimaleHa: 3,
    gisementPertinent: false,
    // le stockage vit de l'arbitrage : le cout de liaison pese lourd sur des puissances modestes
    rayonRaccordementKm: 5,
    couchesParDefaut: ['parcelles', 'postes_sources', 'zonage_urba', 'zones_activite', 'risques'],
  },
  methanisation: {
    id: 'methanisation',
    libelle: 'Methanisation',
    libelleCourt: 'Methanisation',
    description:
      "Unite de methanisation agricole ou territoriale, en injection biomethane ou cogeneration, soumise a ICPE 2781.",
    icone: 'leaf',
    critereRoi: "Densite d'intrants mobilisables et debouche (injection gaz ou epandage)",
    surfaceUtileMinHa: 1,
    surfaceUtileOptimaleHa: 4,
    gisementPertinent: true,
    // l'injection se raisonne sur le reseau gaz ; ce rayon ne vaut que pour la cogeneration
    rayonRaccordementKm: 5,
    couchesParDefaut: ['parcelles', 'reseau_gaz', 'rpg', 'elevages', 'captages', 'bati_200m'],
  },
};

export function estFiliere(v: unknown): v is Filiere {
  return typeof v === 'string' && (FILIERES as readonly string[]).includes(v);
}
