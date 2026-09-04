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
      "Centrale photovoltaïque au sol sur terrain dégradé, inculte ou en configuration agrivoltaique sur parcelle agricole exploitée.",
    icone: 'sun',
    critereRoi: "Régime d'implantation (dégradé / inculte / agricole) et irradiation",
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
      'Parc éolien terrestre soumis à autorisation environnementale (ICPE 2980), avec contrainte de 500 m des habitations.',
    icone: 'wind',
    critereRoi: "Éloignement de l'habitat (500 m minimum) et gisement de vent",
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
      "Installation de stockage d'électricité sur batteries, raccordée au réseau. Le gisement de ressource n'intervient pas.",
    icone: 'battery',
    critereRoi: 'Distance et capacité residuelle du poste source',
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
      "Unité de méthanisation agricole ou territoriale, en injection biomethane ou cogénération, soumise a ICPE 2781.",
    icone: 'leaf',
    critereRoi: "Densité d'intrants mobilisables et debouche (injection gaz ou épandage)",
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

/**
 * Filieres qu'aucune zone d'acceleration ne peut viser.
 *
 * POURQUOI CETTE CONSTANTE EXISTE, et pourquoi elle vit dans `@enr/core`. La loi APER cree des zones
 * d'acceleration pour la PRODUCTION d'energies renouvelables. Une batterie n'est pas un moyen de
 * production : aucune ZAER ne la vise, et aucune ne la visera.
 *
 * Tant que les ZAER n'etaient pas ingerees, le critere `urb_zaer` etait gris pour toutes les filieres
 * et la question ne se posait pas. L'ingestion nationale la pose : sans cette garde, une parcelle de
 * projet de stockage recevrait « Hors zone d'acceleration » (45/100) ou « En ZAER, mais pour d'autres
 * filieres » (60/100) — une PENALITE fabriquee, tiree d'un dispositif qui ne concerne pas la filiere.
 *
 * C'est la forme la plus insidieuse du defaut corrige a l'audit 8 : ici la donnee EXISTE et est juste,
 * et c'est son application a un objet qu'elle ne decrit pas qui produit un chiffre faux. Rendre une
 * couche disponible peut donc creer un defaut la ou son absence n'en creait pas.
 *
 * Partagee entre le moteur (qui doit declarer le critere sans source) et l'ingestion (qui documente
 * qu'aucune correspondance ne produit cette filiere) : une regle metier ecrite deux fois se
 * desynchronise.
 */
export const FILIERES_HORS_ZAER: readonly Filiere[] = ['bess'];
