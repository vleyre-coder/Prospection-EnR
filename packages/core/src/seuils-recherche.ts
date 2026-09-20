/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES SEUILS QU'UN DEVELOPPEUR DONNE REELLEMENT, PAR FILIERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER CORRIGE, ET C'ETAIT LE PLUS GROS TROU DE LA RECHERCHE. L'application evalue
 * 43 criteres, et la recherche par criteres n'en laissait regler qu'une poignee : surface, pente,
 * distance au poste, capacite residuelle, nature du sol, zonage, ZAER, type d'agriculture. Le
 * CRITERE ROI de trois filieres sur quatre etait INTROUVABLE :
 *
 *   - « une irradiation d'au moins 1 300 kWh/m²/an » — inexprimable, alors que le moteur la note ;
 *   - « du vent a au moins 6 m/s a 100 m » — inexprimable ;
 *   - « au moins 15 000 t MS/an d'intrants dans le rayon » — inexprimable ;
 *   - « a moins de 2 km d'une canalisation de gaz » — inexprimable.
 *
 * Un outil de recherche qui ne sait pas chercher par le critere roi de sa filiere ne cherche pas.
 *
 * POURQUOI UNE TABLE DE SEUILS PLUTOT QUE VINGT-CINQ CHAMPS DE FILTRE. L'ecriture naive aurait
 * ajoute `irradiationMinKwhM2An`, `ventMinMs`, `intrantsMinTonnes`, `distanceGazMaxKm`… soit un
 * champ par grandeur, dans le type, dans la validation, dans le SQL, dans le client et dans le
 * formulaire. Cinq endroits a tenir en phase pour CHAQUE grandeur, et un oubli quelque part donne
 * un critere annonce et pas applique — le defaut muet que ce depot passe son temps a traquer.
 *
 * Le mecanisme retenu est un filtre GENERIQUE sur une grandeur du snapshot, dont la liste blanche
 * est `BORNES_SNAPSHOT` — 64 grandeurs numeriques deja declarees avec leur chemin, leurs bornes
 * physiques et leur unite. Rien a dupliquer : la table qui empeche une valeur absurde d'ENTRER en
 * base est celle qui autorise a la CHERCHER.
 *
 * CE FICHIER-CI EST LA COUCHE METIER PAR-DESSUS : parmi ces 64 grandeurs, lesquelles un
 * developpeur nomme, pour quelle filiere, dans quel sens, et avec quel ordre de grandeur usuel.
 * C'est ce qui fait la difference entre une liste de 64 chemins techniques et un formulaire
 * utilisable.
 *
 * IL SERT DEUX LECTEURS, ET C'EST LA RAISON DE SON EXISTENCE SEPAREE :
 *   - le FORMULAIRE de recherche, qui propose les seuils de la filiere choisie ;
 *   - le CAHIER DES CHARGES Word remis au developpeur, qui liste les memes seuils avec une case a
 *     remplir. Les deux doivent nommer les memes grandeurs, faute de quoi le developpeur
 *     renseignerait un critere que l'outil ne sait pas appliquer.
 */

import type { Filiere } from './filieres.js';

/** Sens de la contrainte : un plancher ou un plafond. */
export type SensSeuil = 'min' | 'max';

export interface SeuilRecherche {
  /** Chemin pointe dans le snapshot. DOIT figurer dans `BORNES_SNAPSHOT` — verifie par test. */
  chemin: string;
  /** Libelle metier, tel qu'il s'affiche dans le formulaire et dans le cahier des charges. */
  libelle: string;
  /** `min` : la valeur doit etre au moins celle-ci. `max` : au plus. */
  sens: SensSeuil;
  unite: string;
  /**
   * Ordre de grandeur usuel, a titre INDICATIF. Il pre-remplit le cahier des charges pour donner
   * au developpeur un point de depart, et n'est jamais applique tout seul : aucun seuil n'est
   * actif tant qu'il n'a pas ete saisi.
   */
  usuel: number;
  /** Ce que ce seuil decide pour le projet. Affiche en infobulle et dans le cahier des charges. */
  aide: string;
}

/**
 * Seuils proposes par filiere, dans l'ordre ou un developpeur les enonce.
 *
 * L'ORDRE N'EST PAS COSMETIQUE : le premier de chaque liste est le critere roi de la filiere, tel
 * que `FILIERES_META[...].critereRoi` le nomme. C'est celui qu'on regle en premier et celui qui
 * elimine le plus.
 */
export const SEUILS_RECHERCHE: Record<Filiere, readonly SeuilRecherche[]> = {
  solaire_sol: [
    {
      chemin: 'gisement.irradiationKwhM2An',
      libelle: 'Irradiation globale horizontale minimale',
      sens: 'min',
      unite: 'kWh/m²/an',
      usuel: 1250,
      aide: "Conditionne directement le productible, donc le tarif atteignable. En France métropolitaine la grandeur va d'environ 1 000 kWh/m²/an au nord à 1 750 au sud.",
    },
    {
      chemin: 'foncier.surfaceDunSeulTenantHa',
      libelle: "Surface d'un seul tenant minimale",
      sens: 'min',
      unite: 'ha',
      usuel: 5,
      aide: "Une emprise morcelée coûte en clôture, en pistes et en câblage. C'est la surface réellement exploitable, distincte de la somme des parcelles.",
    },
    {
      chemin: 'foncier.nbProprietairesEstime',
      libelle: 'Nombre de propriétaires maximal',
      sens: 'max',
      unite: 'comptes',
      usuel: 3,
      aide: "Chaque propriétaire supplémentaire est une négociation de plus, et un droit de veto de plus. C'est souvent ce qui décide de la faisabilité avant tout critère technique.",
    },
    {
      chemin: 'acces.distanceVoirieM',
      libelle: 'Distance à la voirie maximale',
      sens: 'max',
      unite: 'm',
      usuel: 500,
      aide: "Au-delà, il faut créer une piste d'accès et en négocier le passage avec des tiers.",
    },
    {
      chemin: 'topographie.altitudeM',
      libelle: 'Altitude maximale',
      sens: 'max',
      unite: 'm',
      usuel: 1000,
      aide: 'En altitude, la neige, le gel et la difficulté de chantier pèsent sur le coût et sur la disponibilité.',
    },
    {
      chemin: 'raccordement.posteLePlusProche.quotePartEurParKw',
      libelle: 'Quote-part S3REnR maximale',
      sens: 'max',
      unite: '€/kW',
      usuel: 100,
      aide: "Contribution au schéma régional de raccordement, due en plus du coût de raccordement propre. Elle varie d'un facteur dix selon la région.",
    },
    {
      chemin: 'patrimoine.monumentHistorique.distanceM',
      libelle: 'Distance au monument historique minimale',
      sens: 'min',
      unite: 'm',
      usuel: 500,
      aide: "500 m est le rayon de protection par défaut de l'article L.621-30 ; au-delà, la covisibilité peut encore être opposée.",
    },
    {
      chemin: 'occupationSol.foret.partBoisee',
      libelle: 'Part boisée maximale',
      sens: 'max',
      unite: 'part (0 à 1)',
      usuel: 0.1,
      aide: 'Au-delà, un défrichement est à prévoir : autorisation, compensation, et une pénalité forte au score.',
    },
  ],

  /**
   * Agrivoltaïsme — et ses seuils ne sont PAS ceux du solaire au sol.
   *
   * La différence n'est pas d'intensité, elle est de nature. Le solaire au sol cherche un terrain
   * que l'agriculture a quitté ; l'agrivoltaïsme cherche un terrain que l'agriculture occupe
   * ENCORE, et dont elle continuera de vivre — c'est la condition même du régime (L.314-36 du code
   * de l'énergie). Les deux filières trient donc en sens opposé sur la même donnée.
   *
   * Deux conséquences visibles ici : l'irradiation compte moins (l'agrivoltaïsme se joue d'abord
   * sur l'accord de l'exploitant et sur la doctrine départementale, pas sur le productible), et la
   * surface d'un seul tenant est plus basse — un îlot cultivé de 5 ha est une opération normale.
   */
  agrivoltaisme: [
    {
      chemin: 'foncier.nbProprietairesEstime',
      libelle: 'Nombre de propriétaires maximal',
      sens: 'max',
      unite: 'comptes',
      usuel: 2,
      aide: "Le critère roi de la filière. Il faut l'accord du propriétaire ET celui de l'exploitant — le référentiel en fait une contrainte rédhibitoire (« Statut du foncier / bail rural / fermage : accords exploitant + propriétaire »). Chaque compte supplémentaire est un droit de veto de plus.",
    },
    {
      chemin: 'foncier.surfaceDunSeulTenantHa',
      libelle: "Surface d'un seul tenant minimale",
      sens: 'min',
      unite: 'ha',
      usuel: 3,
      aide: "Plus basse qu'en solaire au sol : l'installation s'insère dans un îlot cultivé et n'a pas à en occuper toute la surface. Le référentiel plafonne d'ailleurs la couverture au sol à 40 % sans technologie éprouvée.",
    },
    {
      chemin: 'gisement.irradiationKwhM2An',
      libelle: 'Irradiation globale horizontale minimale',
      sens: 'min',
      unite: 'kWh/m²/an',
      usuel: 1200,
      aide: "Le productible compte, mais il n'arbitre pas : un projet agrivoltaïque se décide sur l'accord de l'exploitant, l'avis de la CDPENAF et la doctrine départementale bien avant l'ensoleillement.",
    },
    {
      chemin: 'acces.distanceVoirieM',
      libelle: 'Distance à la voirie maximale',
      sens: 'max',
      unite: 'm',
      usuel: 500,
      aide: "Au-delà, il faut créer une piste d'accès — et la faire cohabiter avec le passage des engins agricoles, qui reste prioritaire.",
    },
    {
      chemin: 'topographie.pentePct',
      libelle: 'Pente moyenne maximale',
      sens: 'max',
      unite: '%',
      usuel: 10,
      aide: "Une pente forte complique à la fois l'implantation des structures et le travail des engins sous les panneaux, alors que la poursuite de l'exploitation est la condition du régime.",
    },
    {
      chemin: 'raccordement.posteLePlusProche.quotePartEurParKw',
      libelle: 'Quote-part S3REnR maximale',
      sens: 'max',
      unite: '€/kW',
      usuel: 100,
      aide: "Contribution au schéma régional de raccordement, due en plus du coût de raccordement propre. Elle varie d'un facteur dix selon la région.",
    },
    {
      chemin: 'patrimoine.monumentHistorique.distanceM',
      libelle: 'Distance au monument historique minimale',
      sens: 'min',
      unite: 'm',
      usuel: 500,
      aide: "500 m est le rayon de protection par défaut de l'article L.621-30 ; au-delà, la covisibilité peut encore être opposée.",
    },
  ],

  eolien_terrestre: [
    {
      chemin: 'gisement.ventVitesse100mMs',
      libelle: 'Vitesse de vent minimale à 100 m',
      sens: 'min',
      unite: 'm/s',
      usuel: 6,
      aide: "Moyenne annuelle. En dessous d'environ 5,5 m/s, un parc n'atteint généralement pas son équilibre économique.",
    },
    {
      chemin: 'bati.distanceHabitationM',
      libelle: "Distance à l'habitation minimale",
      sens: 'min',
      unite: 'm',
      usuel: 500,
      aide: "500 m est le minimum légal de l'article L.515-44 du code de l'environnement. Les préfets imposent couramment davantage.",
    },
    {
      chemin: 'foncier.surfaceDunSeulTenantHa',
      libelle: "Surface d'un seul tenant minimale",
      sens: 'min',
      unite: 'ha',
      usuel: 20,
      aide: "Un parc a besoin d'inter-distances entre machines et de plateformes de montage : la surface d'un seul tenant compte plus que la surface totale.",
    },
    {
      chemin: 'foncier.nbProprietairesEstime',
      libelle: 'Nombre de propriétaires maximal',
      sens: 'max',
      unite: 'comptes',
      usuel: 5,
      aide: 'Chaque propriétaire est une négociation et un droit de veto. Un parc en compte souvent plusieurs, mais le nombre reste le premier facteur de délai.',
    },
    {
      chemin: 'topographie.altitudeM',
      libelle: 'Altitude maximale',
      sens: 'max',
      unite: 'm',
      usuel: 1200,
      aide: "Au-delà, l'acheminement des éléments de mât et de pale devient le facteur limitant du projet.",
    },
    {
      chemin: 'acces.distanceVoirieM',
      libelle: 'Distance à la voirie maximale',
      sens: 'max',
      unite: 'm',
      usuel: 1000,
      aide: "Les convois exceptionnels imposent des rayons de giration et des pentes que toute voirie ne permet pas : la distance n'est qu'un premier tri.",
    },
    {
      chemin: 'milieux.sensibiliteAvifaune',
      libelle: 'Sensibilité avifaune maximale',
      sens: 'max',
      unite: '/100',
      usuel: 60,
      aide: "Indice de pré-repérage. Il ne remplace aucun inventaire : l'étude d'impact reste due, et c'est elle qui tranche.",
    },
    {
      chemin: 'patrimoine.monumentHistorique.distanceM',
      libelle: 'Distance au monument historique minimale',
      sens: 'min',
      unite: 'm',
      usuel: 1000,
      aide: "Au-delà du rayon de 500 m, la covisibilité porte bien plus loin pour une machine de 150 m de haut : c'est le premier motif de refus en éolien.",
    },
    {
      chemin: 'risques.zoneSismique',
      libelle: 'Zone de sismicité maximale',
      sens: 'max',
      unite: 'zone',
      usuel: 2,
      aide: "Classement communal de l'article D.563-8-1 du code de l'environnement, de 1 (très faible) à 5 (forte). Le référentiel pénalise les zones 3 à 5 : au-delà, les règles parasismiques renchérissent les fondations et les structures.",
    },
  ],

  bess: [
    {
      chemin: 'raccordement.posteLePlusProche.capaciteResiduelleMw',
      libelle: 'Capacité résiduelle du poste minimale',
      sens: 'min',
      unite: 'MW',
      usuel: 10,
      aide: "C'est le critère roi du stockage : sans capacité au poste, il n'y a pas de projet, quelle que soit la qualité du terrain.",
    },
    {
      chemin: 'raccordement.posteLePlusProche.distanceKm',
      libelle: 'Distance au poste source maximale',
      sens: 'max',
      unite: 'km',
      usuel: 3,
      aide: "Le stockage vit de l'arbitrage et supporte mal l'éloignement : le raccordement pèse lourd dans un modèle sans production propre.",
    },
    {
      chemin: 'raccordement.posteLePlusProche.quotePartEurParKw',
      libelle: 'Quote-part S3REnR maximale',
      sens: 'max',
      unite: '€/kW',
      usuel: 80,
      aide: 'Due en plus du coût de raccordement propre, et variable dans un rapport de un à dix selon la région.',
    },
    {
      chemin: 'acces.distanceVoirieM',
      libelle: 'Distance à la voirie maximale',
      sens: 'max',
      unite: 'm',
      usuel: 300,
      aide: 'Les conteneurs arrivent par poids lourd une fois, mais la maintenance revient : un accès direct évite une servitude.',
    },
    {
      chemin: 'bati.distanceHabitationM',
      libelle: "Distance à l'habitation minimale",
      sens: 'min',
      unite: 'm',
      usuel: 100,
      aide: "Pas de distance nationale opposable, mais l'acceptabilité et l'étude de dangers ICPE la font systématiquement discuter.",
    },
    {
      chemin: 'foncier.nbProprietairesEstime',
      libelle: 'Nombre de propriétaires maximal',
      sens: 'max',
      unite: 'comptes',
      usuel: 2,
      aide: "L'emprise d'un stockage est petite : au-delà de deux propriétaires, le coût de négociation devient disproportionné à la surface.",
    },
    {
      chemin: 'topographie.pentePct',
      libelle: 'Pente maximale',
      sens: 'max',
      unite: '%',
      usuel: 3,
      aide: "Une plateforme de conteneurs se veut plane : au-delà, le terrassement devient un poste de coût à part entière.",
    },
    {
      chemin: 'risques.zoneSismique',
      libelle: 'Zone de sismicité maximale',
      sens: 'max',
      unite: 'zone',
      usuel: 2,
      aide: "Classement communal de l'article D.563-8-1 du code de l'environnement, de 1 (très faible) à 5 (forte). Le référentiel pénalise les zones 3 à 5 : au-delà, les règles parasismiques renchérissent les fondations et les structures.",
    },
  ],

  methanisation: [
    {
      chemin: 'gisement.intrantsMethaTonnesMsAn',
      libelle: 'Intrants mobilisables minimaux',
      sens: 'min',
      unite: 't MS/an',
      usuel: 8000,
      aide: "Tonnage de matière sèche estimé dans un rayon de 10 km. C'est le critère roi : sans gisement, l'unité ne tourne pas.",
    },
    {
      chemin: 'raccordement.reseauGaz.distanceCanalisationKm',
      libelle: 'Distance à la canalisation de gaz maximale',
      sens: 'max',
      unite: 'km',
      usuel: 3,
      aide: "Au-delà, l'injection devient hors de prix et le projet bascule vers la cogénération, qui est un autre modèle économique.",
    },
    {
      chemin: 'gisement.elevagesRayon10km',
      libelle: 'Nombre d’élevages dans le rayon minimal',
      sens: 'min',
      unite: 'élevages',
      usuel: 10,
      aide: 'Les effluents sont la base du plan d’approvisionnement : un bassin d’élevage dense sécurise le gisement sur la durée.',
    },
    {
      chemin: 'gisement.surfacesEpandageHa',
      libelle: "Surfaces d'épandage disponibles minimales",
      sens: 'min',
      unite: 'ha',
      usuel: 500,
      aide: "Le digestat doit trouver preneur : sans plan d'épandage, l'autorisation ICPE n'aboutit pas.",
    },
    {
      chemin: 'acces.distanceVoirieM',
      libelle: 'Distance à la voirie maximale',
      sens: 'max',
      unite: 'm',
      usuel: 200,
      aide: "Plusieurs allers-retours de poids lourds par jour pendant vingt ans : l'accès conditionne l'autorisation, la voie engins du SDIS et l'acceptabilité.",
    },
    {
      chemin: 'bati.distanceHabitationM',
      libelle: "Distance à l'habitation minimale",
      sens: 'min',
      unite: 'm',
      usuel: 200,
      aide: "200 m est la distance de l'arrêté du 12 août 2010 pour les installations soumises à autorisation. Les odeurs restent le premier motif d'opposition.",
    },
    {
      chemin: 'eau.distanceCoursEauM',
      libelle: "Distance au cours d'eau minimale",
      sens: 'min',
      unite: 'm',
      usuel: 35,
      aide: "35 m des puits, forages, sources et berges : distance de l'arrêté du 12 août 2010.",
    },
    {
      chemin: 'foncier.nbProprietairesEstime',
      libelle: 'Nombre de propriétaires maximal',
      sens: 'max',
      unite: 'comptes',
      usuel: 2,
      aide: "L'unité tient sur une emprise réduite : le montage se simplifie fortement avec un seul propriétaire, souvent l'exploitant porteur.",
    },
    {
      chemin: 'risques.zoneSismique',
      libelle: 'Zone de sismicité maximale',
      sens: 'max',
      unite: 'zone',
      usuel: 2,
      aide: "Classement communal de l'article D.563-8-1 du code de l'environnement, de 1 (très faible) à 5 (forte). Le référentiel pénalise les zones 3 à 5 : au-delà, les règles parasismiques renchérissent les fondations et les structures.",
    },
  ],
};

/** Tous les seuils declares, toutes filieres confondues, dedoublonnes par chemin. */
export function cheminsDesSeuils(): string[] {
  const vus = new Set<string>();
  for (const liste of Object.values(SEUILS_RECHERCHE)) {
    for (const s of liste) vus.add(s.chemin);
  }
  return [...vus].sort();
}

/** Le seuil declare pour une filiere et un chemin, ou `null`. */
export function seuilDe(filiere: Filiere, chemin: string): SeuilRecherche | null {
  return SEUILS_RECHERCHE[filiere].find((s) => s.chemin === chemin) ?? null;
}
