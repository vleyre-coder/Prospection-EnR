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
      "Le contour cadastral est indicatif et n'a pas de valeur juridique : seul un document d'arpentage établi par un géomètre-expert fait foi.",
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
      "Le GPU ne contient que les documents effectivement téléversés par les collectivités. Une commune absente du GPU n'est pas une commune sans document d'urbanisme : vérifier en mairie.",
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
      "Le RPG recense les ilots déclarés à la PAC. Une parcelle absente du RPG n'est pas nécessairement non exploitée : elle peut relever d'un exploitant non déclarant.",
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
      "Le module AOC de l'API Carto exige une clé FranceAgriMer privée : cette couche passe par le WFS de la Geoplateforme, qui n'expose que la dénomination et le comite régional.",
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
      "Les zonages d'inventaire (ZNIEFF) n'ont pas de portée réglementaire directe, mais pesent dans l'instruction et le contentieux.",
  },
  patrinat_appb: {
    connecteur: 'patrinat_appb',
    nom: 'INPN / PatriNat - arrêtés de protection de biotope (WFS Geoplateforme)',
    url: 'https://data.geopf.fr/wfs/ows?TYPENAMES=patrinat_apb:apb',
    modeAcces: 'api',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Un arrêté de protection de biotope est une protection ABSOLUE (art. R.411-15 du code de l'environnement) : contrairement à un zonage N, il n'est pas derogeable par une modification du document d'urbanisme. La couche est absente du module Nature d'API Carto, d'ou cette source distincte.",
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
      "Les zonages réglementaires de PPR sont recenses au niveau communal : le zonage applicable à la parcelle doit être lu sur le règlement du PPR lui-même.",
  },
  ign_alti: {
    connecteur: 'ign_alti',
    nom: 'IGN RGE ALTI - service de calcul altimétrique',
    url: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Pente et orientation sont estimées par régression sur une grille de points cotes du MNT. Un leve topographique reste nécessaire au stade du dimensionnement.",
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
      "Les distances a l'habitat sont calculées sur le bati de la BD TOPO. Les constructions récentes et les permis en cours n'y figurent pas : vérification de terrain indispensable.",
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
      "Pre-repérage uniquement. Le caractère humide se determine par sondages pédologiques et relevés floristiques (arrêté du 24 juin 2008 modifie). Les inventaires departementaux ne sont pas tous ingérés.",
  },
  postes_sources: {
    connecteur: 'postes_sources',
    nom: 'Capareseau (RTE, Enedis et autres GRD) - capacités de raccordement',
    url: 'https://www.capareseau.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 30,
    avertissement:
      "Capacités indicatives et non engageantes, evolutives au fil des demandes de raccordement. Seule une étude de raccordement puis une proposition technique et financiere du gestionnaire engagent une capacité.",
  },
  reseau_gaz: {
    connecteur: 'reseau_gaz',
    nom: 'GRDF / GRTgaz / Terega - réseau gaz et injection biomethane',
    url: 'https://opendata.grdf.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 90,
    avertissement:
      "La faisabilité d'une injection dépend du zonage de raccordement et de la capacité du réseau a l'instant du projet, y compris en rebours. À confirmer auprès du gestionnaire.",
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
      "Irradiation et productible issus de PVGIS (base SARAH2). Le gisement de vent et la densité d'intrants methanisables sont des ESTIMATIONS dérivées de données indirectes : ils ne remplacent ni une campagne de mesure de vent, ni une étude de gisement d'intrants.",
  },
  vent_100m: {
    connecteur: 'vent_100m',
    nom: 'Global Wind Atlas - vitesse moyenne du vent a 100 m',
    url: 'https://globalwindatlas.info',
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 365,
    avertissement:
      "Modèle de réanalyse au pas de 250 m (DTU Wind Energy / Banque mondiale). Incertitude de l'ordre de 0,5 m/s, davantage en terrain complexe : ne remplace pas une campagne de mesure sur site.",
  },
  zaer_local: {
    connecteur: 'zaer_local',
    nom: "Zones d'accélération des ENR (WFS Geoplateforme, couche nationale zaer:zaer)",
    url: 'https://data.geopf.fr/wfs/ows',
    // Etait `manuel` avec la mention « aucune API nationale consolidee ». C'etait faux depuis la
    // publication de la couche nationale, et cette croyance a laisse le critere gris pour toujours :
    // le connecteur etait ecrit et correct, aucun job ne l'alimentait (audit 8, C1/E8).
    modeAcces: 'ingestion',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: 90,
    avertissement:
      "Une ZAER ne cree aucun droit à construire : elle allege l'instruction et signale un portage " +
      'politique local. ATTENTION, la filière de la zone doit être lue : 68 % des ZAER ' +
      'photovoltaïques recensées portent sur des TOITURES et ne concernent pas le foncier. Les ' +
      'zones de stockage (batteries) ne sont pas couvertes par le dispositif de la loi APER.',
  },
  patrimoine_sites: {
    connecteur: 'patrimoine_sites',
    nom: 'Sites classes et inscrits (WFS Geoplateforme, couches STE)',
    url: 'https://data.geopf.fr/wfs/ows',
    modeAcces: 'ingestion',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: 180,
    avertissement:
      'Un site classe impose une autorisation ministerielle spéciale (art. L. 341-10 du code de ' +
      "l'environnement), jamais accordée pour un parc éolien ; un site inscrit, un avis de " +
      "l'architecte des bâtiments de France (art. L. 341-1). Les labels « Grand Site de France » et " +
      '« Patrimoine mondial » ne sont PAS ingérés comme des sites protégés : ils n\'ont pas de ' +
      'portée réglementaire propre. Les sites patrimoniaux remarquables (SPR) ne sont pas couverts ' +
      'par cette couche.',
  },
  document_cadre_local: {
    connecteur: 'document_cadre_local',
    nom: 'Documents-cadres departementaux photovoltaïque au sol (art. L.111-29 CU)',
    url: 'https://www.data.gouv.fr',
    modeAcces: 'manuel',
    valeurJuridique: 'opposable',
    couverture: 'departementale',
    periodiciteJours: 180,
    avertissement:
      "Arrêtés prefectoraux departementaux, sans API nationale. Un département non ingere produit une donnée GRISE et non une absence de contrainte.",
  },
  patrimoine_culture: {
    connecteur: 'patrimoine_culture',
    nom: 'Ministère de la Culture - monuments historiques et sites protégés',
    url: 'https://data.culture.gouv.fr',
    modeAcces: 'ingestion',
    valeurJuridique: 'opposable',
    couverture: 'nationale',
    periodiciteJours: 180,
    avertissement:
      "Le périmètre delimite des abords (PDA) se substitue au rayon de 500 m lorsqu'il existe. La covisibilité peut porter bien au-delà du périmètre de protection.",
  },
  foncier_cadastre: {
    connecteur: 'foncier_cadastre',
    nom: 'Analyse fonciere dérivée du parcellaire cadastral',
    url: 'https://apicarto.ign.fr/api/cadastre',
    modeAcces: 'api',
    valeurJuridique: 'indicative',
    couverture: 'nationale',
    periodiciteJours: null,
    avertissement:
      "Le nombre de propriétaires est ESTIME à partir de la structure parcellaire : les données nominatives ne sont pas accessibles par API et relevent d'une demande auprès de la DGFiP ou de la mairie.",
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
