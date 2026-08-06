/**
 * Modele de donnees partage entre le backend d'enrichissement et le moteur de scoring.
 *
 * Principe directeur : TOUT champ est nullable. Une donnee absente ne doit jamais etre
 * assimilee a une donnee favorable ni defavorable : elle produit un critere GRIS
 * ("donnee indisponible") et abaisse l'indice de couverture de donnees de la parcelle.
 */

import type { Filiere } from './filieres.js';

export type Feu = 'vert' | 'orange' | 'rouge' | 'gris';

/** Valeur juridique de la donnee affichee. */
export type ValeurJuridique = 'opposable' | 'indicative' | 'pre_reperage';

/** Tracabilite : chaque donnee affichee dans la fiche porte sa source et sa fraicheur. */
export interface SourceRef {
  /** Nom lisible de la source, ex. "IGN API Carto - module GPU". */
  nom: string;
  /** Identifiant technique du connecteur, ex. "apicarto_gpu". */
  connecteur: string;
  url?: string;
  /** Date de la donnee elle-meme (millesime), ex. "2023" pour le RPG 2023. */
  millesime?: string | null;
  /** Date de derniere mise a jour connue de la source. */
  dateMiseAJour?: string | null;
  /** Date a laquelle l'application a interroge la source. */
  dateInterrogation: string;
  valeurJuridique: ValeurJuridique;
  /** Avertissement specifique a cette source, affiche au clic sur le critere. */
  avertissement?: string;
}

// ---------------------------------------------------------------------------
// Rubriques de la fiche parcelle
// ---------------------------------------------------------------------------

export interface Identite {
  /** Identifiant unique parcellaire (IDU), ex. "283900000C0843". */
  idu: string;
  codeInsee: string;
  nomCommune: string;
  codeDepartement: string;
  /** Code EPCI si connu. */
  codeEpci?: string | null;
  nomEpci?: string | null;
  prefixe: string;
  section: string;
  numero: string;
  /** Contenance cadastrale en m2 (valeur declarative du cadastre). */
  contenanceM2: number | null;
  /** Surface calculee sur la geometrie projetee (Lambert-93), en m2. */
  surfaceCalculeeM2: number | null;
  /** Centroide [lon, lat] en WGS84. */
  centroide: [number, number] | null;
}

export interface ZoneUrbaInfo {
  /** Libelle du zonage, ex. "A", "Ap", "N", "1AUx". */
  libelle: string | null;
  /** Type de zone normalise GPU : U, AUc, AUs, A, N, Ah... */
  typeZone: string | null;
  /** Destination dominante. */
  destinationDominante: string | null;
  /** URL du reglement applicable sur le GPU. */
  urlReglement: string | null;
  /** Date d'approbation du document. */
  dateApprobation: string | null;
  /** Part de la parcelle couverte par ce zonage (0-1). */
  partRecouvrement: number | null;
}

export interface PrescriptionInfo {
  type: string | null;
  libelle: string | null;
  /** EBC (espace boise classe) = type "01" dans le standard CNIG. */
  estEbc: boolean;
  /** Emplacement reserve. */
  estEmplacementReserve: boolean;
}

export interface Urbanisme {
  /** Document d'urbanisme applicable : PLU, PLUi, CC (carte communale), RNU. */
  typeDocument: 'PLU' | 'PLUi' | 'POS' | 'CC' | 'RNU' | null;
  /** Le territoire est-il couvert par un document publie sur le GPU ? */
  couvertParGpu: boolean | null;
  zonages: ZoneUrbaInfo[];
  prescriptions: PrescriptionInfo[];
  /** Servitudes d'utilite publique recouvrant la parcelle (codes SUP). */
  servitudes: string[];
  /** Zone d'acceleration des ENR : la parcelle y figure-t-elle, et pour quelles filieres ? */
  zaer: {
    present: boolean | null;
    filieres: Filiere[];
    source: string | null;
    /** Date de la deliberation / arrete. */
    dateDeliberation: string | null;
  };
  /**
   * Presence dans le document-cadre departemental PV au sol (art. L.111-29 CU).
   * null = document-cadre non ingere pour ce departement (donnee indisponible, GRIS).
   */
  documentCadrePvSol: {
    /**
     * Le departement a-t-il arrete un document-cadre photovoltaique au sol ?
     *
     * TROIS ETATS, et non deux — audit 8, defaut D5. Ce champ etait un `boolean`, et son `false`
     * portait deux sens incompatibles : « la couche n'a pas ete ingeree pour ce departement » et
     * « ce departement n'a pas de document-cadre ». L'interface affichait « departement non
     * ingere » dans les deux cas. Or seule une trentaine de departements en ont arrete un : pour
     * tous les autres, l'absence de ligne est un FAIT VRAI presente comme un manque de donnees.
     *
     * `null` = on ne sait pas (couche non ingeree). `false` = le departement n'en a pas.
     * `true` = il en a un.
     */
    departementCouvert: boolean | null;
    parcelleEligible: boolean | null;
    dateArrete: string | null;
  };
}

export type TypeSol = 'artificialise' | 'degrade' | 'agricole_exploite' | 'inculte' | 'naturel_forestier';

export interface OccupationSol {
  /** Classification synthetique retenue par le moteur pour determiner le regime PV. */
  typeSol: TypeSol | null;
  /** Registre parcellaire graphique. */
  rpg: {
    /** Code culture RPG, ex. "BTH" (ble tendre d'hiver). */
    codeCulture: string | null;
    libelleCulture: string | null;
    codeGroupeCulture: string | null;
    libelleGroupeCulture: string | null;
    /** Millesime du RPG utilise. */
    millesime: string | null;
    /** Part de la parcelle cadastrale couverte par un ilot RPG (0-1). */
    partRecouvrement: number | null;
    /** Nombre de millesimes consecutifs avec declaration PAC (proxy d'exploitation). */
    anneesDeclareesConsecutives: number | null;
  };
  /** Inculte ou non exploite depuis le 10 mars 2013 (art. L.111-29 CU). */
  inculteDepuis2013: boolean | null;
  /** Appellations d'origine recouvrant la parcelle. */
  aop: {
    presente: boolean | null;
    viticole: boolean | null;
    appellations: string[];
  };
  /** Couverture forestiere (BD Foret). */
  foret: {
    recouvre: boolean | null;
    /** Part boisee (0-1). */
    partBoisee: number | null;
    type: string | null;
  };
  /** Potentiel agronomique estime, 0-100 (100 = tres bon sol agricole). */
  potentielAgronomique: number | null;
}

export interface Topographie {
  /** Pente moyenne en %. */
  pentePct: number | null;
  /**
   * Vrai lorsque la pente n'a PAS pu etre obtenue par regression du plan des altitudes et
   * qu'elle est estimee par differences entre paires de points.
   *
   * La distinction doit remonter jusqu'a la fiche : la mesure par paires retient la plus forte
   * pente locale, elle MAJORE donc la pente moyenne. Presenter les deux comme equivalentes
   * ferait passer une approximation prudente pour une mesure.
   */
  penteEstimeeParPaires: boolean | null;
  /** Pente maximale en %. */
  penteMaxPct: number | null;
  /** Orientation dominante en degres (0 = nord, 180 = sud). */
  orientationDeg: number | null;
  altitudeM: number | null;
  /** Denivele total sur la parcelle, en m (indicateur de planeite). */
  deniveleM: number | null;
  /** Alea retrait-gonflement des argiles : faible / moyen / fort. */
  aleaArgiles: 'nul' | 'faible' | 'moyen' | 'fort' | null;
  /** Nombre de cavites souterraines recensees dans un rayon de 500 m. */
  cavitesProches: number | null;
  /** Mouvements de terrain recenses a proximite. */
  mouvementsTerrain: number | null;
}

export interface Eau {
  /** Zone humide : pre-reperage cartographique, JAMAIS une conclusion. */
  zoneHumide: 'oui' | 'non' | 'a_confirmer' | null;
  /** Distance au cours d'eau le plus proche, en m. */
  distanceCoursEauM: number | null;
  /** Perimetre de protection de captage AEP. */
  captageAep: {
    dansPerimetre: boolean | null;
    type: 'immediat' | 'rapproche' | 'eloigne' | null;
    distanceM: number | null;
  };
  /** Zone inondable / PPRI. */
  inondation: {
    /** Zonage reglementaire PPRI si connu. */
    zonagePpri: string | null;
    /** Alea : nul / faible / moyen / fort. */
    alea: 'nul' | 'faible' | 'moyen' | 'fort' | null;
    /** Territoire a risque important d'inondation. */
    dansTri: boolean | null;
  };
  /** Contexte karstique (enjeu majeur pour la methanisation). */
  karst: boolean | null;
}

/** Element de zonage naturel : recouvrement ET distance sont distingues. */
export interface ZonageNaturel {
  recouvre: boolean | null;
  /** Part de la parcelle recouverte (0-1). */
  partRecouvrement: number | null;
  /** Distance au zonage le plus proche, en m (0 si recouvrement). */
  distanceM: number | null;
  /** Nom du site le plus proche. */
  nom: string | null;
}

export interface MilieuxNaturels {
  natura2000Habitats: ZonageNaturel;
  natura2000Oiseaux: ZonageNaturel;
  znieff1: ZonageNaturel;
  znieff2: ZonageNaturel;
  /** Arrete prefectoral de protection de biotope. */
  appb: ZonageNaturel;
  reserveNaturelle: ZonageNaturel;
  /** Coeur de parc national (protection forte). */
  coeurParcNational: ZonageNaturel;
  parcNaturelRegional: ZonageNaturel;
  /** Trame verte et bleue : reservoir ou corridor. */
  trameVerteBleue: {
    reservoir: boolean | null;
    corridor: boolean | null;
  };
  /** Enjeu defrichement (surface boisee a defricher). */
  enjeuDefrichement: boolean | null;
  /** Pre-enjeu especes protegees, 0-100 (100 = enjeu tres fort). */
  preEnjeuEspeces: number | null;
  /** Sensibilite avifaune / chiropteres, 0-100 (enjeu eolien). */
  sensibiliteAvifaune: number | null;
  sensibiliteChiropteres: number | null;
}

export interface Patrimoine {
  monumentHistorique: {
    /** Distance au monument le plus proche, en m. */
    distanceM: number | null;
    dansPerimetreProtection: boolean | null;
    nom: string | null;
  };
  siteClasse: ZonageNaturel;
  siteInscrit: ZonageNaturel;
  /** Site patrimonial remarquable. */
  spr: ZonageNaturel;
  /** Avis de l'architecte des batiments de France requis. */
  avisAbfRequis: boolean | null;
  /** Indice de covisibilite estime, 0-100 (100 = tres exposee). */
  covisibiliteIndice: number | null;
  /** Sensibilite archeologique (zone de presomption de prescription). */
  sensibiliteArcheologique: 'faible' | 'moyenne' | 'forte' | null;
}

/**
 * Severite maximale des zones qu'un plan de prevention CONTIENT.
 *
 * A ne pas confondre avec la zone applicable a la parcelle : l'API Georisques expose la liste des
 * zones du plan (`zonageReglementaire.listTypeReg`, codes 01 a 04), pas leur geometrie. Savoir
 * qu'un plan comporte une zone d'interdiction stricte renseigne sur le profil de risque ; savoir
 * dans laquelle tombe la parcelle exige le reglement graphique.
 */
export type SeveritePlanPpr =
  | 'interdiction_stricte'
  | 'interdiction'
  | 'prescriptions'
  | 'precaution';

export interface PlanPrevention {
  /** Un plan de cette famille existe-t-il sur la commune ? `null` si la source n'a pas repondu. */
  present: boolean | null;
  /**
   * Zone reglementaire applicable A LA PARCELLE (rouge, bleu...). Reste `null` : l'API n'expose
   * pas la geometrie des zones. Ne jamais y verser une severite de plan, que le moteur lit comme
   * une couleur de zone.
   */
  zonage: string | null;
  /** Severite maximale des zones que le plan contient. */
  severitePlan: SeveritePlanPpr | null;
}

export interface Risques {
  ppri: PlanPrevention;
  pprif: PlanPrevention;
  pprt: PlanPrevention;
  /** Radars (meteo, aviation civile, militaire) : distance au plus proche. */
  radars: Array<{ type: string; distanceKm: number; distanceMinRequiseKm: number | null }>;
  /** Servitudes aeronautiques : la parcelle est-elle dans un cone/degagement ? */
  servitudesAeronautiques: boolean | null;
  faisceauxHertziens: boolean | null;
  /** Reseaux enterres traversant la parcelle (gaz, electricite HTB, oleoduc). */
  reseauxEnterres: string[];
  /** Sites et sols pollues (CASIAS/BASIAS, ex-BASOL) : nombre dans un rayon de 500 m. */
  sitesPollues: number | null;
  /** ICPE existantes a proximite (utile pour la methanisation et le BESS). */
  icpeProches: number | null;
  /** Obligation legale de debroussaillement / zone DFCI. */
  obligationDebroussaillement: boolean | null;
}

export type EtatSaturation = 'disponible' | 'tendu' | 'sature';

export interface PosteSourceRef {
  id: string;
  nom: string;
  gestionnaire: 'RTE' | 'Enedis' | 'autre_grd';
  /** Tension du poste, ex. "63 kV / 20 kV". */
  tension: string | null;
  distanceKm: number;
  /** Capacite d'accueil residuelle en MW (Capareseau : valeur indicative). */
  capaciteResiduelleMw: number | null;
  etatSaturation: EtatSaturation | null;
  /** Puissance des projets en file d'attente, en MW. */
  fileAttenteMw: number | null;
  /** Quote-part S3REnR en EUR/kW. */
  quotePartEurParKw: number | null;
  /** Renforcement ou creation programme au titre du S3REnR. */
  renforcement: {
    prevu: boolean | null;
    /** Horizon de mise en service, ex. "2028". */
    horizon: string | null;
    capaciteAttendueMw: number | null;
  };
  /** Poste en projet (non encore en service). */
  enProjet: boolean | null;
}

export interface Raccordement {
  posteLePlusProche: PosteSourceRef | null;
  /** Les 3 postes les plus proches, pour comparaison dans la fiche. */
  postesAlternatifs: PosteSourceRef[];
  /** Reseau gaz (methanisation en injection). */
  /**
   * Reseau de gaz — DEUX GRANDEURS DISTINCTES, et non une seule.
   *
   * POURQUOI CETTE SEPARATION — audit 8, defaut B6/E5. Il n'y avait qu'un `distanceKm`, alimente par
   * « le point de raccordement le plus proche, poste d'injection existant ou canalisation ». Or la
   * table `canalisation_gaz` n'est peuplee par AUCUN job : seuls les points d'injection le sont. La
   * valeur retournee etait donc, en pratique, toujours la distance au SITE D'INJECTION DE BIOMETHANE
   * EXISTANT le plus proche.
   *
   * Ce sont deux grandeurs sans rapport : il y a quelques centaines de sites d'injection en France et
   * des dizaines de milliers de kilometres de canalisations. La distance retournee etait donc
   * structurellement tres superieure a la distance pertinente, et la methanisation systematiquement
   * penalisee sur le critere qui pese 11 % de sa note — sans que rien ne le signale.
   *
   * Les confondre etait le glissement de sens habituel de ce projet : deux choses differentes sous un
   * meme nom. Elles portent desormais deux noms.
   */
  reseauGaz: {
    /**
     * Distance a la CANALISATION de gaz la plus proche, en km. C'est la grandeur pertinente pour un
     * raccordement en injection. `null` quand la couche des canalisations n'est pas ingeree — ce qui
     * est le cas par defaut : aucun job ne l'alimente.
     */
    distanceCanalisationKm: number | null;
    /**
     * Distance au SITE D'INJECTION de biomethane existant le plus proche, en km. Ce n'est PAS une
     * distance de raccordement : c'est un indicateur de maturite de la filiere sur le territoire,
     * utile a la prospection commerciale mais sans valeur pour dimensionner un raccordement.
     */
    distanceSiteInjectionKm: number | null;
    gestionnaire: 'GRDF' | 'GRTgaz' | 'Terega' | 'autre' | null;
    /** Capacite d'injection disponible en Nm3/h, sur le site d'injection le plus proche. */
    capaciteInjectionNm3h: number | null;
    /** Rebours necessaire pour injecter. */
    reboursNecessaire: boolean | null;
  };
}

export interface Gisement {
  /** Irradiation globale horizontale, kWh/m2/an (PVGIS / ADEME). */
  irradiationKwhM2An: number | null;
  /** Productible specifique estime, kWh/kWc/an. */
  productibleKwhKwcAn: number | null;
  /** Vitesse moyenne du vent a 100 m, m/s. */
  ventVitesse100mMs: number | null;
  /** Densite d'intrants methanisables mobilisables dans un rayon de 15 km, t MS/an. */
  intrantsMethaTonnesMsAn: number | null;
  /** Nombre d'exploitations d'elevage dans un rayon de 10 km. */
  elevagesRayon10km: number | null;
  /** Industries agroalimentaires dans un rayon de 20 km. */
  iaaRayon20km: number | null;
  /** Surfaces d'epandage potentiellement disponibles dans un rayon de 10 km, en ha. */
  surfacesEpandageHa: number | null;
  /**
   * Les couches alimentant le gisement methanisable (elevages, industries agroalimentaires,
   * surfaces agricoles communales) sont-elles ingerees pour ce territoire ?
   *
   * Distinction indispensable : sans elle, un comptage `count(*)` renvoie 0 la ou aucune
   * couche n'existe, et la fiche affiche « 0 elevage a moins de 10 km » comme un constat de
   * terrain. `false` signifie « on ne sait pas », jamais « il n'y en a pas ».
   */
  sourcesIntrantsIngerees: boolean | null;
}

export interface Bati {
  /** Distance a l'habitation la plus proche (BD TOPO, batiments d'habitation), en m. */
  distanceHabitationM: number | null;
  /** Nombre de batiments d'habitation dans un rayon de 500 m. */
  nbHabitationsRayon500m: number | null;
  /** Distance a la zone destinee a l'habitation la plus proche (zonage U/AU du PLU), en m. */
  distanceZoneHabitatM: number | null;
  /** Densite de batiments dans un rayon de 1 km (proxy d'urbanisation). */
  densiteBati1km: number | null;
}

export interface Acces {
  /** Distance a la voirie carrossable la plus proche, en m. */
  distanceVoirieM: number | null;
  /** Acces poids lourds plausible (route de largeur suffisante a moins de 500 m). */
  accesPoidsLourds: boolean | null;
}

export interface Foncier {
  /** Nombre de proprietaires estime (issu du nombre de comptes cadastraux si accessible). */
  nbProprietairesEstime: number | null;
  indivisionProbable: boolean | null;
  /** Surface du bloc de parcelles contigues du meme proprietaire, en ha. */
  surfaceDunSeulTenantHa: number | null;
  /** Indice de morcellement 0-100 (100 = tres morcele). */
  morcellementIndice: number | null;
  /** Proprietaire public (commune, Etat, SNCF...) : demarche differente. */
  proprietairePublic: boolean | null;
}

/**
 * Objet complet d'entree du moteur de scoring.
 * Produit par le pipeline d'enrichissement a partir des connecteurs de donnees.
 */
export interface ParcelleSnapshot {
  identite: Identite;
  urbanisme: Urbanisme;
  occupationSol: OccupationSol;
  topographie: Topographie;
  eau: Eau;
  milieux: MilieuxNaturels;
  patrimoine: Patrimoine;
  risques: Risques;
  raccordement: Raccordement;
  gisement: Gisement;
  bati: Bati;
  acces: Acces;
  foncier: Foncier;
  /** Sources utilisees, indexees par identifiant de connecteur. */
  sources: Record<string, SourceRef>;
  /** Date de constitution du snapshot. */
  dateSnapshot: string;
}

// ---------------------------------------------------------------------------
// Pipeline de prospection
// ---------------------------------------------------------------------------

export const STATUTS_PROSPECTION = [
  'a_prospecter',
  'contact_pris',
  'en_negociation',
  'securise',
  'ecarte',
] as const;

export type StatutProspection = (typeof STATUTS_PROSPECTION)[number];

export interface StatutProspectionMeta {
  id: StatutProspection;
  libelle: string;
  /** Couleur du contour / de la pastille - volontairement distincte de la palette de score. */
  couleur: string;
  /** Motif de contour utilise sur la carte. */
  motif: 'aucun' | 'pointille' | 'tiret' | 'plein' | 'hachure';
  ordre: number;
}

export const STATUTS_PROSPECTION_META: Record<StatutProspection, StatutProspectionMeta> = {
  a_prospecter: { id: 'a_prospecter', libelle: 'A prospecter', couleur: '#94a3b8', motif: 'aucun', ordre: 0 },
  contact_pris: { id: 'contact_pris', libelle: 'Contact pris', couleur: '#6366f1', motif: 'pointille', ordre: 1 },
  en_negociation: { id: 'en_negociation', libelle: 'En negociation', couleur: '#8b5cf6', motif: 'tiret', ordre: 2 },
  securise: { id: 'securise', libelle: 'Securise', couleur: '#0ea5e9', motif: 'plein', ordre: 3 },
  ecarte: { id: 'ecarte', libelle: 'Ecarte', couleur: '#78716c', motif: 'hachure', ordre: 4 },
};

export interface Lead {
  id: string;
  idu: string | null;
  siteId: string | null;
  filiere: Filiere;
  statut: StatutProspection;
  /** Notes libres du charge de prospection. */
  notes: string | null;
  /**
   * Score au moment de la prise en prospection. Compare au score courant, il revele la
   * derive due a l'evolution des donnees sources (nouvelle capacite de poste, nouveau
   * zonage, nouveau millesime RPG).
   */
  scoreInitial: number | null;
  /** Historique horodate des changements de statut et des contacts. */
  historique: LeadEvenement[];
  assigneA: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadEvenement {
  id: string;
  date: string;
  type: 'changement_statut' | 'contact' | 'note' | 'document' | 'creation';
  auteur: string;
  ancienStatut?: StatutProspection | null;
  nouveauStatut?: StatutProspection | null;
  commentaire: string | null;
}
