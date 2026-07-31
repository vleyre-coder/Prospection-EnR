/**
 * Referentiel reglementaire date.
 *
 * ATTENTION (exigence produit non negociable) : les seuils reglementaires ENR evoluent
 * frequemment - les seuils solaires ont change deux fois en deux ans. Chaque regle porte
 * donc :
 *   - sa reference juridique (article, decret, arrete),
 *   - sa date d'entree en vigueur,
 *   - la date de derniere verification manuelle du referentiel.
 *
 * L'interface DOIT afficher `dateEntreeEnVigueur` et `derniereVerification` a cote de tout
 * seuil presente a l'utilisateur. Aucune valeur de ce fichier ne dispense d'une verification
 * au moment du depot du dossier, ni d'une verification a l'echelon departemental.
 */

/** Date de derniere revue manuelle de l'ensemble du referentiel de ce fichier. */
export const REFERENTIEL_DERNIERE_VERIFICATION = '2026-07-30';

export interface RegleReglementaire {
  id: string;
  libelle: string;
  /** Valeur du seuil, si la regle est un seuil chiffre. */
  valeur?: number;
  unite?: string;
  /** Reference juridique exacte. */
  reference: string;
  /** Date d'entree en vigueur du texte applique. */
  dateEntreeEnVigueur: string;
  /** URL de reference (Legifrance de preference). */
  url?: string;
  /** Precision / cas particuliers. */
  commentaire?: string;
  /**
   * true si la regle est connue pour etre instable ou declinee a l'echelon local :
   * l'interface doit alors afficher un avertissement renforce.
   */
  instable?: boolean;
}

const LEGIFRANCE = 'https://www.legifrance.gouv.fr';

// ---------------------------------------------------------------------------
// Solaire au sol / agrivoltaisme
// ---------------------------------------------------------------------------

export const REGLES_SOLAIRE: Record<string, RegleReglementaire> = {
  permis_construire: {
    id: 'pv_permis_construire',
    libelle: 'Permis de construire obligatoire au-dela de 3 MWc',
    valeur: 3,
    unite: 'MWc',
    reference: "Code de l'urbanisme, art. R.421-1 et R.421-9 (decret n°2023-1408 du 8 decembre 2023)",
    dateEntreeEnVigueur: '2023-12-10',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006074075/LEGISCTA000006188342`,
    commentaire:
      "En dessous de 3 MWc : declaration prealable. Le seuil a ete releve (auparavant 250 kWc) : verifier la version applicable a la date de depot.",
    instable: true,
  },
  eval_env_systematique: {
    id: 'pv_eval_env_systematique',
    libelle: 'Evaluation environnementale systematique au-dela de 3 MWc',
    valeur: 3,
    unite: 'MWc',
    reference: "Code de l'environnement, art. R.122-2, annexe, rubrique 30",
    dateEntreeEnVigueur: '2022-10-01',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000045908546`,
    commentaire: 'Examen au cas par cas entre 300 kWc et 3 MWc.',
    instable: true,
  },
  eval_env_cas_par_cas: {
    id: 'pv_eval_env_cas_par_cas',
    libelle: 'Examen au cas par cas de 300 kWc a 3 MWc',
    valeur: 0.3,
    unite: 'MWc',
    reference: "Code de l'environnement, art. R.122-2, annexe, rubrique 30",
    dateEntreeEnVigueur: '2022-10-01',
    instable: true,
  },
  document_cadre_departemental: {
    id: 'pv_document_cadre',
    libelle:
      "Implantation en zone agricole sur terres incultes ou non exploitees : conditionnee au document-cadre departemental",
    reference: "Code de l'urbanisme, art. L.111-29 (loi APER n°2023-175 du 10 mars 2023, art. 54)",
    dateEntreeEnVigueur: '2023-03-11',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000047305234`,
    commentaire:
      "Le document-cadre est arrete par le prefet apres avis de la CDPENAF et de la chambre d'agriculture. Hors liste du document-cadre : implantation non autorisee. Aucune API nationale ne publie ces documents : ingestion departement par departement obligatoire.",
    instable: true,
  },
  date_reference_inculte: {
    id: 'pv_date_inculte',
    libelle: 'Terrain repute inculte ou non exploite depuis le 10 mars 2013',
    reference: "Code de l'urbanisme, art. L.111-29 (loi APER du 10 mars 2023)",
    dateEntreeEnVigueur: '2023-03-11',
    commentaire:
      "La periode de reference est de 10 ans anterieurs a la promulgation de la loi APER, soit une non-exploitation continue depuis le 10 mars 2013. A justifier par photo-interpretation et historique RPG.",
  },
  agri_taux_couverture: {
    id: 'agri_taux_couverture',
    libelle: 'Agrivoltaisme : taux de couverture maximal de 40 % de la parcelle',
    valeur: 40,
    unite: '%',
    reference: "Decret n°2024-318 du 8 avril 2024, art. 2 ; Code de l'energie art. R.314-108 et s.",
    dateEntreeEnVigueur: '2024-04-09',
    url: `${LEGIFRANCE}/jorf/id/JORFTEXT000049397549`,
    commentaire:
      "Presomption de conformite en dessous de 40 % de taux de couverture. Au-dela, demonstration renforcee du maintien de la production agricole.",
    instable: true,
  },
  agri_zone_temoin: {
    id: 'agri_zone_temoin',
    libelle: "Agrivoltaisme : zone temoin d'au moins 5 % de la surface",
    valeur: 5,
    unite: '%',
    reference: 'Decret n°2024-318 du 8 avril 2024',
    dateEntreeEnVigueur: '2024-04-09',
    commentaire:
      "Zone temoin exigee pour le suivi agronomique. Dispense possible pour les installations de moins de 1 ha ou en cas de referentiel agronomique existant.",
  },
  agri_avis_cdpenaf: {
    id: 'agri_avis_cdpenaf',
    libelle: 'Avis de la CDPENAF requis pour les projets agrivoltaiques',
    reference: "Code de l'urbanisme, art. L.111-30 ; decret n°2024-318 du 8 avril 2024",
    dateEntreeEnVigueur: '2024-04-09',
  },
  aop_viticole: {
    id: 'pv_aop_viticole',
    libelle: "Aire parcellaire delimitee d'AOP viticole : implantation photovoltaique exclue",
    reference:
      "Code rural et de la peche maritime, art. L.641-5 et s. ; doctrines INAO relatives aux installations photovoltaiques",
    dateEntreeEnVigueur: '2023-03-11',
    commentaire:
      "L'INAO est consulte et s'oppose en principe a l'artificialisation des aires parcellaires delimitees AOP, en particulier viticoles. Traite comme redhibitoire par defaut, parametrable.",
    instable: true,
  },
};

// ---------------------------------------------------------------------------
// Eolien terrestre
// ---------------------------------------------------------------------------

export const REGLES_EOLIEN: Record<string, RegleReglementaire> = {
  distance_habitation: {
    id: 'eol_distance_habitation',
    libelle:
      "Eloignement minimal de 500 m des constructions a usage d'habitation et des zones destinees a l'habitation",
    valeur: 500,
    unite: 'm',
    reference: "Code de l'environnement, art. L.515-44",
    dateEntreeEnVigueur: '2010-07-13',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000031748036`,
    commentaire:
      "Distance mesuree depuis le mat de l'aerogenerateur. Le prefet peut imposer une distance superieure au vu de l'etude d'impact. 500 m est un plancher, pas une cible.",
  },
  icpe_2980: {
    id: 'eol_icpe_2980',
    libelle:
      "ICPE rubrique 2980 : autorisation environnementale des que un aerogenerateur depasse 50 m de hauteur de mat",
    valeur: 50,
    unite: 'm de mat',
    reference: "Code de l'environnement, nomenclature ICPE rubrique 2980",
    dateEntreeEnVigueur: '2011-08-23',
    commentaire:
      "Declaration pour les parcs dont les mats sont < 50 m et la puissance totale >= 20 MW. En pratique, tout parc contemporain releve de l'autorisation environnementale unique.",
  },
  rayon_enquete_publique: {
    id: 'eol_rayon_enquete',
    libelle: "Rayon d'affichage de l'enquete publique : 6 km",
    valeur: 6,
    unite: 'km',
    reference: "Code de l'environnement, art. R.181-36 et annexe de l'art. R.511-9 (rubrique 2980)",
    dateEntreeEnVigueur: '2017-03-01',
    commentaire:
      "Toutes les communes dont une partie du territoire est a moins de 6 km du projet sont consultees : indicateur d'acceptabilite a anticiper.",
  },
  monument_historique: {
    id: 'eol_monument_historique',
    libelle:
      'Perimetre de protection des monuments historiques : 500 m par defaut (ou PDA), avis de l\'ABF',
    valeur: 500,
    unite: 'm',
    reference: 'Code du patrimoine, art. L.621-30 et L.632-1',
    dateEntreeEnVigueur: '2016-07-08',
    commentaire:
      "Le perimetre delimite des abords (PDA) se substitue au rayon de 500 m lorsqu'il existe. La covisibilite peut porter bien au-dela.",
  },
  radar: {
    id: 'eol_radar',
    libelle: 'Distances minimales aux radars meteorologiques et de l\'aviation civile',
    reference:
      "Arrete du 26 aout 2011 modifie relatif aux installations de production d'electricite utilisant l'energie mecanique du vent, art. 4",
    dateEntreeEnVigueur: '2011-08-27',
    commentaire:
      "Ordres de grandeur : 30 km (radar meteo bande C), 20 km (bande S), 10 km (radar de l'aviation civile), 5 km (radar portuaire), avec avis possible en deca. Consultation obligatoire de Meteo-France, la DGAC et l'armee.",
    instable: true,
  },
};

// ---------------------------------------------------------------------------
// Stockage par batteries (BESS)
// ---------------------------------------------------------------------------

export const REGLES_BESS: Record<string, RegleReglementaire> = {
  icpe_2925_2: {
    id: 'bess_icpe_2925_2',
    libelle:
      "ICPE rubrique 2925-2 : declaration pour les installations de stockage d'electricite de puissance > 600 kW",
    valeur: 600,
    unite: 'kW',
    reference: "Code de l'environnement, nomenclature ICPE rubrique 2925, alinea 2",
    dateEntreeEnVigueur: '2022-06-30',
    commentaire:
      "Rubrique dediee aux dispositifs de stockage d'energie electrochimique. La doctrine des DREAL evolue : certains projets sont requalifies en autorisation selon la masse de matieres dangereuses (rubriques 1450, 4801). A confirmer aupres de la DREAL.",
    instable: true,
  },
  securite_incendie: {
    id: 'bess_securite_incendie',
    libelle: "Plan de defense incendie (PDI) et distances d'eloignement internes",
    reference:
      "Arrete ministériel de prescriptions generales applicables a la rubrique 2925 ; referentiels DREAL / SDIS ; guide FFB-ADEME stockage stationnaire",
    dateEntreeEnVigueur: '2022-06-30',
    commentaire:
      "Prevoir : PDI, besoins en eau d'extinction, rétention des eaux d'extinction, distances entre conteneurs, voie engins pompiers. Le SDIS departemental impose ses propres exigences.",
    instable: true,
  },
  chimie_lfp: {
    id: 'bess_chimie_lfp',
    libelle: 'Chimie LFP (lithium fer phosphate) recommandee',
    reference: 'Recommandation technique - non reglementaire',
    dateEntreeEnVigueur: '2024-01-01',
    commentaire:
      "La chimie LFP reduit fortement le risque d'emballement thermique par rapport aux chimies NMC, et facilite l'instruction ICPE et l'avis du SDIS.",
  },
};

// ---------------------------------------------------------------------------
// Methanisation
// ---------------------------------------------------------------------------

export const REGLES_METHANISATION: Record<string, RegleReglementaire> = {
  icpe_2781_declaration: {
    id: 'metha_2781_d',
    libelle: 'ICPE 2781-1 : declaration en dessous de 30 t/j de matieres traitees',
    valeur: 30,
    unite: 't/j',
    reference: "Code de l'environnement, nomenclature ICPE rubrique 2781-1",
    dateEntreeEnVigueur: '2021-06-24',
    commentaire: 'Matiere vegetale brute, effluents d\'elevage, matieres stercoraires, lactoserum.',
  },
  icpe_2781_enregistrement: {
    id: 'metha_2781_e',
    libelle: 'ICPE 2781-1 : enregistrement de 30 a 100 t/j',
    valeur: 100,
    unite: 't/j',
    reference: "Code de l'environnement, nomenclature ICPE rubrique 2781-1",
    dateEntreeEnVigueur: '2021-06-24',
  },
  icpe_2781_autorisation: {
    id: 'metha_2781_a',
    libelle: 'ICPE 2781-1 : autorisation environnementale au-dela de 100 t/j',
    valeur: 100,
    unite: 't/j',
    reference: "Code de l'environnement, nomenclature ICPE rubrique 2781-1",
    dateEntreeEnVigueur: '2021-06-24',
    commentaire:
      'La rubrique 2781-2 (autres dechets, notamment biodechets et boues) releve de l\'autorisation quel que soit le tonnage au-dela de 100 t/j, avec un regime plus contraignant.',
  },
  distance_habitation: {
    id: 'metha_distance_habitation',
    libelle: "Eloignement de 200 m des habitations et locaux occupes par des tiers",
    valeur: 200,
    unite: 'm',
    reference:
      "Arrete ministériel du 12 aout 2010 (rubrique 2781-1, enregistrement) et arrete du 10 novembre 2009, art. relatif aux distances d'eloignement",
    dateEntreeEnVigueur: '2010-08-13',
    commentaire:
      "Distance mesuree depuis les ouvrages de stockage et de traitement. Des amenagements sont possibles pour les installations en declaration ; l'acceptabilite locale reste le facteur limitant.",
    instable: true,
  },
  distance_eau: {
    id: 'metha_distance_eau',
    libelle: "Eloignement de 35 m des puits, forages, sources et berges des cours d'eau",
    valeur: 35,
    unite: 'm',
    reference:
      "Arrete du 12 aout 2010 (rubrique 2781) ; programme d'actions national nitrates, arrete du 19 decembre 2011",
    dateEntreeEnVigueur: '2010-08-13',
    commentaire:
      "S'applique aux ouvrages de stockage et aux epandages. Interdiction totale dans les perimetres de protection immediate et rapprochee des captages AEP.",
  },
  plan_epandage: {
    id: 'metha_plan_epandage',
    libelle: "Plan d'epandage ou sortie du statut de dechet du digestat",
    reference:
      "Arrete du 22 octobre 2020 relatif au socle commun des matieres fertilisantes ; art. R.211-25 et s. du Code de l'environnement",
    dateEntreeEnVigueur: '2020-10-23',
    commentaire:
      "Deux voies : plan d'epandage (digestat = dechet, surfaces contractualisees necessaires) ou homologation / conformite a une norme (digestat = produit, commercialisable).",
  },
  iota: {
    id: 'metha_iota',
    libelle: 'Declaration ou autorisation IOTA au titre de la loi sur l\'eau',
    reference: "Code de l'environnement, art. R.214-1, rubriques 2.1.5.0 et 3.3.1.0",
    dateEntreeEnVigueur: '2006-12-30',
    commentaire:
      "Rejet d'eaux pluviales (surface interceptee) et assechement de zone humide : verifier le franchissement des seuils IOTA.",
  },
  injection: {
    id: 'metha_injection',
    libelle: 'Injection de biomethane : droit a l\'injection et rebours',
    reference:
      "Code de l'energie, art. L.446-1 et s. ; decret n°2019-1043 du 11 octobre 2019 relatif au droit a l'injection",
    dateEntreeEnVigueur: '2019-10-13',
    commentaire:
      "Le droit a l'injection permet de faire financer une partie des renforcements de reseau par le tarif. Verifier le zonage de raccordement (GRDF/GRTgaz/Terega) et la capacite du reseau, y compris en rebours.",
  },
};

export const REGLES: Record<string, Record<string, RegleReglementaire>> = {
  solaire_sol: REGLES_SOLAIRE,
  eolien_terrestre: REGLES_EOLIEN,
  bess: REGLES_BESS,
  methanisation: REGLES_METHANISATION,
};

/** Toutes les regles, indexees par identifiant, pour affichage dans la fiche. */
export const REGLES_PAR_ID: Record<string, RegleReglementaire> = Object.values(REGLES)
  .flatMap((groupe) => Object.values(groupe))
  .reduce<Record<string, RegleReglementaire>>((acc, regle) => {
    acc[regle.id] = regle;
    return acc;
  }, {});
