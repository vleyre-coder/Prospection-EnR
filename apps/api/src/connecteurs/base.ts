/** Socle commun des connecteurs de sources externes. */

import type { SourceRef, ValeurJuridique } from '@enr/core';

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: string; coordinates: unknown } | null;
    properties: P;
  }>;
  totalFeatures?: number;
  numberMatched?: number;
  numberReturned?: number;
}

export interface DescriptionConnecteur {
  connecteur: string;
  nom: string;
  url: string;
  modeAcces: 'api' | 'ingestion' | 'manuel';
  valeurJuridique: ValeurJuridique;
  couverture: 'nationale' | 'departementale' | 'partielle';
  /** Periodicite attendue de rafraichissement, en jours. null pour les API temps reel. */
  periodiciteJours: number | null;
  millesime?: string | null;
  avertissement?: string;
}

/** Catalogue des connecteurs, aligne sur docs/API_CONTRACTS.md (contrats verifies). */
export const CONNECTEURS: Record<string, DescriptionConnecteur> = {
  apicarto_cadastre: {
    connecteur: 'apicarto_cadastre',
    nom: 'IGN API Carto - module Cadastre (PCI Express)',
    url: 'https://apicarto.ign.fr/api/cadastre',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Le contour cadastral est indicatif et n'a pas de valeur juridique : seul un document d'arpentage etabli par un geometre-expert fait foi.",
  },
  apicarto_gpu: {
    connecteur: 'apicarto_gpu',
    nom: "IGN API Carto - module GPU (Geoportail de l'Urbanisme)",
    url: 'https://apicarto.ign.fr/api/gpu',
    modeAcces: 'api',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Le GPU ne contient que les documents effectivement televerses par les collectivites. Une commune absente du GPU n'est pas une commune sans document d'urbanisme : verifier en mairie.",
  },
  apicarto_rpg: {
    connecteur: 'apicarto_rpg',
    nom: 'IGN API Carto - module RPG (registre parcellaire graphique)',
    url: 'https://apicarto.ign.fr/api/rpg',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 365,
    avertissement:
      "Le RPG recense les ilots declares a la PAC. Une parcelle absente du RPG n'est pas necessairement non exploitee : elle peut relever d'un exploitant non declarant.",
  },
  aoc_viticole: {
    connecteur: 'aoc_viticole',
    nom: 'INAO - aires parcellaires AOC viticoles (WFS Geoplateforme)',
    url: 'https://data.geopf.fr/wfs/ows?TYPENAMES=AOC-VITICOLES:aire_parcellaire',
    modeAcces: 'api',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: 180,
    avertissement:
      "Le module AOC de l'API Carto exige une cle FranceAgriMer privee : cette couche passe par le WFS de la Geoplateforme, qui n'expose que la denomination et le comite regional.",
  },
  apicarto_nature: {
    connecteur: 'apicarto_nature',
    nom: 'INPN / MNHN - zonages de protection (via API Carto module Nature)',
    url: 'https://apicarto.ign.fr/api/nature',
    modeAcces: 'api',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Les zonages d'inventaire (ZNIEFF) n'ont pas de portee reglementaire directe, mais pesent dans l'instruction et le contentieux.",
  },
  georisques: {
    connecteur: 'georisques',
    nom: 'Georisques (BRGM / MTE)',
    url: 'https://georisques.gouv.fr/api/v1',
    modeAcces: 'api',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Les zonages reglementaires de PPR sont recenses au niveau communal : le zonage applicable a la parcelle doit etre lu sur le reglement du PPR lui-meme.",
  },
  ign_alti: {
    connecteur: 'ign_alti',
    nom: 'IGN RGE ALTI - service de calcul altimetrique',
    url: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Pente et orientation sont estimees par regression sur une grille de points cotes du MNT. Un leve topographique reste necessaire au stade du dimensionnement.",
  },
  ign_bdtopo: {
    connecteur: 'ign_bdtopo',
    nom: 'IGN BD TOPO (batiments, voirie, hydrographie)',
    url: 'https://data.geopf.fr/wfs/ows?TYPENAMES=BDTOPO_V3:batiment',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 180,
    avertissement:
      "Les distances a l'habitat sont calculees sur le bati de la BD TOPO. Les constructions recentes et les permis en cours n'y figurent pas : verification de terrain indispensable.",
  },
  ign_bdforet: {
    connecteur: 'ign_bdforet',
    nom: 'IGN BD Foret V2',
    url: 'https://data.geopf.fr/wfs/ows?TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 365,
  },
  zones_humides: {
    connecteur: 'zones_humides',
    nom: 'Zones humides (BCAE / inventaires DREAL)',
    url: 'https://data.geopf.fr/wfs/ows?TYPENAMES=TOURBIERES_ZONES-HUMIDES.BCAE:bcae',
    modeAcces: 'api',
    valeurJuridique: 'pre_reperage',
    couverture: 'partielle',
    periodiciteJours: 365,
    avertissement:
      "Pre-reperage uniquement. Le caractere humide se determine par sondages pedologiques et releves floristiques (arrete du 24 juin 2008 modifie). Les inventaires departementaux ne sont pas tous ingeres.",
  },
  postes_sources: {
    connecteur: 'postes_sources',
    nom: 'Capareseau (RTE, Enedis et autres GRD) - capacites de raccordement',
    url: 'https://www.capareseau.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 30,
    avertissement:
      "Capacites indicatives et non engageantes, evolutives au fil des demandes de raccordement. Seule une etude de raccordement puis une proposition technique et financiere du gestionnaire engagent une capacite.",
  },
  reseau_gaz: {
    connecteur: 'reseau_gaz',
    nom: 'GRDF / GRTgaz / Terega - reseau gaz et injection biomethane',
    url: 'https://opendata.grdf.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 90,
    avertissement:
      "La faisabilite d'une injection depend du zonage de raccordement et de la capacite du reseau a l'instant du projet, y compris en rebours. A confirmer aupres du gestionnaire.",
  },
  gisement: {
    connecteur: 'gisement',
    nom: 'PVGIS (Commission europeenne) et estimations de gisement',
    url: 'https://re.jrc.ec.europa.eu/api/v5_2',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Irradiation et productible issus de PVGIS (base SARAH2). Le gisement de vent et la densite d'intrants methanisables sont des ESTIMATIONS derivees de donnees indirectes : ils ne remplacent ni une campagne de mesure de vent, ni une etude de gisement d'intrants.",
  },
  zaer_local: {
    connecteur: 'zaer_local',
    nom: "Zones d'acceleration des ENR (deliberations communales)",
    url: 'https://www.data.gouv.fr',
    modeAcces: 'manuel',
    valeurJuridique: 'indicative',
    couverture: 'partielle',
    periodiciteJours: 90,
    avertissement:
      "Aucune API nationale consolidee : ingestion territoire par territoire. L'absence d'information ne vaut pas absence de ZAER.",
  },
  document_cadre_local: {
    connecteur: 'document_cadre_local',
    nom: 'Documents-cadres departementaux photovoltaique au sol (art. L.111-29 CU)',
    url: 'https://www.data.gouv.fr',
    modeAcces: 'manuel',
    valeurJuridique: 'opposable',
    couverture: 'departementale',
    periodiciteJours: 180,
    avertissement:
      "Arretes prefectoraux departementaux, sans API nationale. Un departement non ingere produit une donnee GRISE et non une absence de contrainte.",
  },
  patrimoine_culture: {
    connecteur: 'patrimoine_culture',
    nom: 'Ministere de la Culture - monuments historiques et sites proteges',
    url: 'https://data.culture.gouv.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: 180,
    avertissement:
      "Le perimetre delimite des abords (PDA) se substitue au rayon de 500 m lorsqu'il existe. La covisibilite peut porter bien au-dela du perimetre de protection.",
  },
  foncier_cadastre: {
    connecteur: 'foncier_cadastre',
    nom: 'Analyse fonciere derivee du parcellaire cadastral',
    url: 'https://apicarto.ign.fr/api/cadastre',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Le nombre de proprietaires est ESTIME a partir de la structure parcellaire : les donnees nominatives ne sont pas accessibles par API et relevent d'une demande aupres de la DGFiP ou de la mairie.",
  },
};

/** Construit la reference de source a joindre a chaque donnee affichee (tracabilite). */
export function sourceRef(
  connecteur: string,
  extras: { millesime?: string | null; dateMiseAJour?: string | null } = {},
): SourceRef {
  const d = CONNECTEURS[connecteur];
  if (!d) {
    return {
      nom: connecteur,
      connecteur,
      dateInterrogation: new Date().toISOString(),
      valeurJuridique: 'indicative',
    };
  }
  return {
    nom: d.nom,
    connecteur: d.connecteur,
    url: d.url,
    millesime: extras.millesime ?? d.millesime ?? null,
    dateMiseAJour: extras.dateMiseAJour ?? null,
    dateInterrogation: new Date().toISOString(),
    valeurJuridique: d.valeurJuridique,
    avertissement: d.avertissement,
  };
}

/** Encode une geometrie GeoJSON pour le parametre `geom` de l'API Carto. */
export function geomParam(geom: unknown): string {
  return JSON.stringify(geom);
}
