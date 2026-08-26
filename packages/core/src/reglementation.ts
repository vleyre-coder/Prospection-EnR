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
  /**
   * `true` : REFERENCE PROPOSEE, PAS ENCORE VALIDEE PAR UN JURISTE.
   *
   * POURQUOI CE CHAMP EXISTE. Le referentiel portait jusqu'ici une seule date de revue globale
   * (`REFERENTIEL_DERNIERE_VERIFICATION`), qui affirme implicitement que TOUTE regle du fichier a ete
   * relue. Des references ont ete ajoutees depuis, sur decision du proprietaire, pour combler des
   * knock-outs qui ecartaient une parcelle sans citer aucun texte — mais elles n'ont pas ete relues par
   * un juriste. Les faire passer pour verifiees en les melangeant aux autres serait exactement la faute
   * que ce projet traque : affirmer plus que ce que l'on sait.
   *
   * L'interface et le rapport PDF DOIVENT donc le dire. Un test l'exige, et un autre interdit qu'une
   * regle perde ce marquage sans qu'une date de validation le remplace.
   */
  aValiderParJuriste?: boolean;
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
    commentaire:
      "La rubrique 30 de l'annexe a l'article R.122-2 a ete remaniee plusieurs fois depuis 2020 " +
      "et les bornes de puissance declenchant l'examen au cas par cas ont bouge a chaque " +
      "revision. La decision releve en outre de l'autorite environnementale, qui apprecie la " +
      "sensibilite du milieu au-dela du seul seuil de puissance : deux projets de meme puissance " +
      "peuvent recevoir des reponses differentes. A confirmer aupres de la DREAL avant tout depot.",
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
  /**
   * DEUX PROCEDURES QUI DECIDENT DU CALENDRIER, et qui manquaient au solaire.
   *
   * La compensation agricole collective se decouvre souvent trop tard : c'est une etude prealable, avec
   * un delai d'instruction et une contribution financiere, declenchee par un seuil de surface fixe
   * DEPARTEMENT par DEPARTEMENT. Et les garanties de demantelement conditionnent l'accord du proprietaire
   * autant que celui de l'administration.
   */
  compensation_agricole: {
    id: 'pv_compensation_agricole',
    libelle: 'Etude prealable de compensation agricole collective',
    reference:
      'Code rural et de la peche maritime, art. L.112-1-3 ; decret n°2016-1190 du 31 aout 2016 ; art. ' +
      'D.112-1-18 et suivants',
    dateEntreeEnVigueur: '2016-12-01',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000031104466`,
    commentaire:
      "Due lorsqu'un projet soustrait durablement des terres a l'usage agricole au-dela d'un seuil de " +
      'surface fixe par ARRETE PREFECTORAL — de l\'ordre de un a cinq hectares selon les departements, ' +
      "sans regle nationale. L'etude chiffre l'effet sur l'economie agricole du territoire et propose des " +
      'mesures de compensation collective, souvent une contribution a un fonds. Compter plusieurs mois. Une ' +
      'installation agrivoltaique qui maintient une production agricole significative peut y echapper : ' +
      "c'est precisement l'un des interets du regime.",
    instable: true,
    aValiderParJuriste: true,
  },
  demantelement: {
    id: 'pv_demantelement',
    libelle: 'Demantelement, remise en etat et garanties financieres',
    reference:
      "Code de l'urbanisme, art. L.111-29 (loi APER) ; decret n°2024-318 du 8 avril 2024 (reversibilite " +
      "de l'installation agrivoltaique) ; Code de l'energie, art. R.314-108 et suivants",
    dateEntreeEnVigueur: '2024-04-09',
    commentaire:
      "L'obligation de remise en etat est systematique ; ce qui varie, c'est l'exigence de GARANTIES " +
      'FINANCIERES, que le prefet ou la collectivite peut imposer, et le contenu de la promesse de bail. ' +
      "Pour l'agrivoltaisme, la reversibilite fait partie des conditions du regime lui-meme : une " +
      "installation non reversible n'est pas agrivoltaique, et perd le benefice du dispositif. C'est " +
      'souvent la premiere question du proprietaire.',
    aValiderParJuriste: true,
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
  /**
   * DEUX AJOUTS POUR L'EOLIEN, tous deux appuyes sur une donnee que l'application MESURE ou sur un
   * regime qu'elle connait deja.
   */
  faisceaux_hertziens: {
    id: 'eol_faisceaux_hertziens',
    libelle: 'Servitude de protection d’un centre radioelectrique',
    reference:
      'Code des postes et des communications electroniques, art. L.54 a L.56-1 (servitudes de protection ' +
      'des centres radioelectriques d’emission et de reception)',
    dateEntreeEnVigueur: '2004-06-11',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006070987/LEGISCTA000006112875`,
    commentaire:
      "Ces servitudes protegent les liaisons hertziennes contre les obstacles : un aerogenerateur de plus " +
      "de cent metres en travers d'un faisceau est en principe incompatible. Elles sont annexees au " +
      "document d'urbanisme et publiees comme servitudes d'utilite publique. Un deplacement de machine " +
      "suffit parfois a degager le faisceau, d'ou un caractere derogeable plutot que bloquant : c'est " +
      "une contrainte d'implantation, dont l'issue se juge sur un plan de masse.",
    instable: true,
    aValiderParJuriste: true,
  },
  autorisation_environnementale: {
    id: 'eol_autorisation_environnementale',
    libelle: 'Autorisation environnementale : etude d’impact et enquete publique',
    reference:
      "Code de l'environnement, art. L.181-1 et suivants (autorisation environnementale unique) ; " +
      'art. L.122-1 (evaluation environnementale) ; art. L.123-1 et suivants (enquete publique)',
    dateEntreeEnVigueur: '2017-03-01',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006074220/LEGISCTA000033929019`,
    commentaire:
      "Un parc eolien relevant de l'autorisation au titre de la rubrique 2980 est instruit dans le cadre de " +
      "l'autorisation environnementale UNIQUE : elle absorbe l'etude d'impact, l'evaluation des incidences " +
      "Natura 2000, la derogation especes protegees si elle est necessaire, le defrichement et le permis de " +
      "construire. C'est une bonne nouvelle de procedure — un seul dossier, un seul recours — et une " +
      'mauvaise de calendrier : compter de dix-huit a trente-six mois entre le depot et la decision, plus le ' +
      'contentieux.',
    aValiderParJuriste: true,
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
  /**
   * LES TROIS REGLES SUIVANTES ETOFFENT LA FILIERE LA PLUS MINCE DU REFERENTIEL.
   *
   * Mesure : le stockage portait 3 regles, contre 8 et 9 pour la methanisation et le solaire, et l'une
   * des trois etait explicitement non reglementaire. Surtout, `REGLES_KO` lui donnait `[...COMMUNS]` :
   * AUCUN motif eliminatoire propre au stockage. Une batterie ne pouvait donc jamais etre ecartee pour
   * une raison qui lui soit propre.
   *
   * Ce qui est ajoute ici reste au niveau que je peux defendre : le REGIME applicable et la contrainte
   * PHYSIQUE, pas un seuil chiffre que je ne saurais pas verifier. Les distances d'eloignement de la
   * rubrique 2925 en particulier ne sont pas transcrites : elles figurent dans l'arrete de prescriptions
   * generales, elles varient selon le regime, et une valeur fausse serait pire que son absence.
   */
  acces_engins: {
    id: 'bess_acces_engins',
    libelle: 'Voie engins et acces poids lourds : condition d’exploitation et d’intervention',
    reference:
      "Arrete de prescriptions generales applicable a la rubrique 2925 (voie engins, aire de mise en " +
      'station) ; reglement departemental de defense exterieure contre l’incendie (art. R.2225-7 du code ' +
      'general des collectivites territoriales)',
    dateEntreeEnVigueur: '2015-02-17',
    commentaire:
      "Deux exigences se cumulent et sont souvent sous-estimees en prospection. L’EXPLOITATION : les " +
      'conteneurs arrivent par semi-remorque et pesent plusieurs dizaines de tonnes, ce qui suppose une ' +
      'voie carrossable jusqu’a la parcelle. L’INTERVENTION : le SDIS exige une voie engins praticable et ' +
      'une ressource en eau dimensionnee, sans quoi son avis est defavorable. La date retenue est celle du ' +
      'decret du 27 fevrier 2015 relatif a la defense exterieure contre l’incendie ; le reglement ' +
      'departemental applicable est celui du departement du projet.',
    instable: true,
    aValiderParJuriste: true,
  },
  effets_domino: {
    id: 'bess_effets_domino',
    libelle: 'Voisinage industriel : examen des effets domino',
    reference:
      "Code de l'environnement, art. R.181-13 et R.512-46-4 (contenu du dossier : etude des effets " +
      'domino) ; art. L.515-15 a L.515-19 pour le voisinage d’un site Seveso seuil haut',
    dateEntreeEnVigueur: '2017-03-01',
    commentaire:
      "Un stockage electrochimique implante pres d’une installation a risque est instruit sous l’angle des " +
      'effets domino, dans les deux sens : ce que le site voisin peut declencher sur les batteries, et ' +
      'l’inverse. C’est un motif d’instruction longue plus qu’un refus, mais il se decide tot — d’ou son ' +
      'interet en prospection.',
    aValiderParJuriste: true,
  },
  raccordement_s3renr: {
    id: 'bess_raccordement_s3renr',
    libelle: 'Raccordement : le stockage n’a pas de priorite au titre du S3REnR',
    reference:
      "Code de l'energie, art. L.321-7 et D.321-10 et suivants (schemas regionaux de raccordement au " +
      'reseau des energies renouvelables)',
    dateEntreeEnVigueur: '2012-04-21',
    commentaire:
      "Point de methode propre a cette filiere, et la raison pour laquelle le raccordement pese 42 % du " +
      'score du stockage : les capacites reservees par un S3REnR sont destinees aux installations de ' +
      'PRODUCTION d’energie renouvelable. Un stockage pur ne s’inscrit pas necessairement dans cette ' +
      'reservation et peut se voir appliquer le regime de droit commun, avec un cout et un delai ' +
      'differents. A confirmer aupres du gestionnaire de reseau AVANT toute promesse au proprietaire.',
    instable: true,
    aValiderParJuriste: true,
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
  /**
   * DEUX AJOUTS POUR LA METHANISATION. Le premier est le plus souvent oublie en prospection : un intrant
   * d'origine animale fait entrer l'unite dans le champ sanitaire europeen, avec un agrement distinct de
   * l'ICPE. Le second porte sur l'acces, qui pese 9 points au profil de cette filiere — le trafic est
   * QUOTIDIEN, contrairement aux autres filieres.
   */
  sous_produits_animaux: {
    id: 'metha_sous_produits_animaux',
    libelle: 'Intrants d’origine animale : agrement sanitaire',
    reference:
      'Reglement (CE) n°1069/2009 du 21 octobre 2009 (sous-produits animaux) et reglement (UE) ' +
      "n°142/2011 ; Code rural et de la peche maritime, art. L.226-1 et suivants",
    dateEntreeEnVigueur: '2011-03-04',
    commentaire:
      "Des qu'un intrant contient des sous-produits animaux — lisier, fumier, contenus stomacaux, dechets " +
      "de decoupe — l'unite releve du reglement sanitaire europeen, en plus de l'ICPE. Consequences " +
      'concretes : agrement sanitaire delivre par la DDPP, hygienisation ou pasteurisation selon la ' +
      "categorie des matieres, et tracabilite. Le rappel est declenche ici par la presence d'elevages dans " +
      "le rayon d'approvisionnement, qui rend ces intrants probables ; la nature reelle du plan " +
      "d'approvisionnement seule permet de conclure.",
    aValiderParJuriste: true,
  },
  acces_engins: {
    id: 'metha_acces_engins',
    libelle: 'Acces poids lourds : trafic quotidien d’approvisionnement',
    reference:
      "Arrete ministériel du 12 aout 2010 (rubrique 2781, voies d'acces et de circulation) ; reglement " +
      'departemental de defense exterieure contre l’incendie (art. R.2225-7 du code general des ' +
      'collectivites territoriales)',
    dateEntreeEnVigueur: '2010-08-13',
    commentaire:
      "La difference avec les autres filieres est le CARACTERE QUOTIDIEN du trafic : une unite de quelques " +
      "dizaines de tonnes par jour represente plusieurs allers-retours de poids lourds chaque jour, sur " +
      "toute la duree d'exploitation. L'acces conditionne donc l'autorisation ET l'acceptabilite locale — " +
      "c'est l'un des premiers motifs d'opposition des riverains. S'y ajoute la voie engins exigee par le " +
      'SDIS.',
    instable: true,
    aValiderParJuriste: true,
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

// ---------------------------------------------------------------------------
// Regles communes a toutes les filieres
// ---------------------------------------------------------------------------

/**
 * Les contraintes qui ne dependent pas de la filiere : urbanisme, eau, risques, sites proteges.
 *
 * POURQUOI CE GROUPE EXISTE. Sept knock-outs ecartaient une parcelle — parfois definitivement — sans
 * citer aucun texte. Le rapport PDF remis au proprietaire annoncait donc « Zone humide cartographiee »
 * ou « Espace boise classe » comme un fait de nature, sans le fondement qui permet de le contester, de
 * le verifier, ou d'y chercher une derogation. C'est une perte pour l'utilisateur comme pour le
 * proprietaire.
 *
 * TOUTES CES REGLES PORTENT `aValiderParJuriste`. Elles ont ete redigees a la demande du proprietaire,
 * a partir des textes que je peux nommer avec confiance — mais je ne suis pas juriste, et une reference
 * juridique dans un document remis a un tiers merite une relecture par quelqu'un qui l'est. Le
 * marquage est visible dans la fiche et dans le rapport ; il ne disparaitra qu'avec une validation
 * explicite, ce qu'un test verrouille.
 *
 * CE QUI EST DELIBEREMENT ABSENT : la valeur chiffree. Un seuil (1 ha pour la rubrique 3.3.1.0, par
 * exemple) se verifie plus difficilement qu'un article, et se perime plus vite. Ces regles nomment le
 * REGIME applicable, pas le seuil.
 */
export const REGLES_COMMUNES: Record<string, RegleReglementaire> = {
  coeur_parc_national: {
    id: 'commun_coeur_parc_national',
    libelle: 'Coeur de parc national : travaux soumis a autorisation speciale',
    reference:
      "Code de l'environnement, art. L.331-4 et L.331-4-1 (reglementation du coeur de parc national)",
    dateEntreeEnVigueur: '2006-04-16',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000022478094`,
    commentaire:
      "Dans le coeur d’un parc national, les travaux sont interdits sauf autorisation speciale de " +
      'l’etablissement du parc, et la reglementation propre a chaque parc peut aller plus loin. La date ' +
      'retenue est celle de la loi du 14 avril 2006 qui a refonde le regime.',
    aValiderParJuriste: true,
  },
  reserve_naturelle: {
    id: 'commun_reserve_naturelle',
    libelle: 'Reserve naturelle : modification de l’etat ou de l’aspect interdite',
    reference:
      "Code de l'environnement, art. L.332-3 (reglementation de la reserve) et L.332-9 (interdiction de " +
      'modifier l’etat ou l’aspect des lieux, sauf autorisation speciale)',
    dateEntreeEnVigueur: '2000-09-21',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000022479113`,
    commentaire:
      "L’article L.332-9 pose une interdiction de principe de detruire ou modifier l’etat ou l’aspect de " +
      'la reserve ; l’acte de classement fixe le detail. Une derogation existe mais reste exceptionnelle ' +
      'et n’a jamais, a ma connaissance, porte un projet de production d’energie.',
    aValiderParJuriste: true,
  },
  appb: {
    id: 'commun_appb',
    libelle: 'Arrete prefectoral de protection de biotope : interdictions fixees par l’arrete',
    reference: "Code de l'environnement, art. R.411-15 a R.411-17 (protection des biotopes)",
    dateEntreeEnVigueur: '1977-09-27',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006074220/LEGISCTA000006189070`,
    commentaire:
      "La portee depend ENTIEREMENT de l’arrete prefectoral : certains interdisent toute activite, " +
      'd’autres seulement certaines pratiques a certaines periodes. Lire l’arrete plutot que conclure du ' +
      'zonage. La date retenue est celle du decret du 25 novembre 1977 qui a cree le dispositif.',
    instable: true,
    aValiderParJuriste: true,
  },
  zone_humide: {
    id: 'commun_zone_humide',
    libelle: 'Zone humide : evitement prioritaire et procedure au titre de la loi sur l’eau',
    reference:
      "Code de l'environnement, art. L.211-1 (definition) et R.214-1, rubrique 3.3.1.0 (assechement, " +
      'mise en eau, impermeabilisation) ; art. L.163-1 (obligations de compensation)',
    dateEntreeEnVigueur: '2019-07-26',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000038846010`,
    commentaire:
      "La date retenue est celle de la loi du 24 juillet 2019, qui a retabli le caractere ALTERNATIF des " +
      'criteres pedologique et floristique : un seul des deux suffit a caracteriser la zone humide, ce qui ' +
      'a elargi le champ. Un inventaire cartographique n’est pas opposable en lui-meme — seul un sondage ' +
      'pedologique conclut — mais il fonde la presomption et donc la charge de la preuve.',
    instable: true,
    aValiderParJuriste: true,
  },
  ppr_zone_rouge: {
    id: 'commun_ppr_zone_rouge',
    libelle: 'Zone rouge d’un plan de prevention des risques naturels',
    reference:
      "Code de l'environnement, art. L.562-1 et R.562-1 et suivants (plans de prevention des risques " +
      'naturels previsibles : inondation, incendie de foret, mouvement de terrain)',
    dateEntreeEnVigueur: '1995-02-03',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000033034238`,
    commentaire:
      "L'interdiction n'est PAS portee par le code : elle l'est par le REGLEMENT du plan approuve, qui " +
      'varie d’un departement a l’autre et parfois d’une zone a l’autre du meme plan. Le code rend ce ' +
      'reglement opposable et l’annexe au document d’urbanisme. Consulter le reglement de la zone avant ' +
      'toute conclusion : certains plans admettent des installations techniques non habitees.',
    instable: true,
    aValiderParJuriste: true,
  },
  pprt_zone_rouge: {
    id: 'commun_pprt_zone_rouge',
    libelle: 'Zone d’interdiction d’un plan de prevention des risques technologiques',
    reference:
      "Code de l'environnement, art. L.515-15 a L.515-19 (plans de prevention des risques " +
      'technologiques autour des installations Seveso seuil haut)',
    dateEntreeEnVigueur: '2003-08-01',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000031210232`,
    commentaire:
      'Institue par la loi du 30 juillet 2003. Comme pour un plan naturel, la portee exacte est celle du ' +
      'reglement du plan : les zones les plus exposees interdisent toute construction nouvelle, les ' +
      'suivantes l’autorisent sous prescriptions. Un stockage de batteries a proximite d’un site Seveso ' +
      'appelle en outre l’examen des effets domino par la DREAL.',
    instable: true,
    aValiderParJuriste: true,
  },
  ebc: {
    id: 'commun_ebc',
    libelle: 'Espace boise classe : defrichement rejete de plein droit',
    reference: "Code de l'urbanisme, art. L.113-1 et L.113-2 (espaces boises classes)",
    dateEntreeEnVigueur: '2016-01-01',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006074075/LEGISCTA000031211122`,
    commentaire:
      "Le classement entraine le REJET DE PLEIN DROIT de toute demande de defrichement (art. L.113-2) : " +
      'ce n’est pas une appreciation de l’administration, c’est une consequence automatique. Le ' +
      'declassement suppose une revision ou une modification du PLU, avec enquete publique. La date ' +
      'retenue est celle de la recodification du livre Ier ; le dispositif lui-meme est bien plus ancien ' +
      '(ex-article L.130-1).',
    aValiderParJuriste: true,
  },
  emplacement_reserve: {
    id: 'commun_emplacement_reserve',
    libelle: 'Emplacement reserve : foncier affecte a un autre usage',
    reference:
      "Code de l'urbanisme, art. L.151-41 (emplacements reserves) ; art. L.152-2 (droit de delaissement " +
      'du proprietaire)',
    dateEntreeEnVigueur: '2016-01-01',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000031211183`,
    commentaire:
      "La reserve n’interdit pas materiellement d’occuper le terrain, elle le DESTINE a un equipement, une " +
      'voie ou un espace vert au benefice d’une collectivite : un projet privé de longue duree y est ' +
      'incompatible en pratique. Elle peut etre levee par modification du PLU, ou tomber si la ' +
      'collectivite renonce.',
    aValiderParJuriste: true,
  },
  zone_n: {
    id: 'commun_zone_n',
    libelle: 'Zone naturelle et forestiere (N) : constructibilite tres limitee',
    reference:
      "Code de l'urbanisme, art. R.151-24 et R.151-25 (zones naturelles et forestieres) ; art. L.151-13 " +
      '(secteurs de taille et de capacite d’accueil limitees)',
    dateEntreeEnVigueur: '2016-01-01',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000031720483`,
    commentaire:
      "Deux voies existent et elles n’ont pas le meme cout : le STECAL de l’article L.151-13, qui suppose " +
      'une modification du PLU et l’avis de la CDPENAF, ou une revision du zonage. Compter 12 a 24 mois. ' +
      'La loi APER a par ailleurs ouvert des possibilites en zone d’acceleration, ce que le moteur prend ' +
      'en compte lorsque la parcelle y figure pour la filiere etudiee.',
    instable: true,
    aValiderParJuriste: true,
  },
  /**
   * LES QUATRE PROCEDURES SUIVANTES SONT COMMUNES AUX QUATRE FILIERES, et aucune n'etait citee.
   *
   * Elles ne sont pas des motifs eliminatoires — ce sont des AUTORISATIONS a obtenir, dont le delai et
   * le cout se decident tot. Les taire revient a laisser un prospecteur promettre un calendrier qu'il ne
   * tiendra pas.
   *
   * Leur applicabilite est calculee QUAND LA DONNEE EXISTE, et laissee a « a verifier » sinon. La
   * nuance n'est pas cosmetique : `preEnjeuEspeces` et `sensibiliteArcheologique` sont mis a `null` par
   * les connecteurs, deliberement — le premier valait une valeur inventee, retiree a l'audit 6. Une
   * procedure annoncee « non applicable » sur une donnee absente serait exactement le defaut fondateur
   * de ces audits.
   */
  defrichement: {
    id: 'commun_defrichement',
    libelle: 'Autorisation de defrichement, et compensation',
    reference:
      'Code forestier, art. L.341-1 (definition), L.341-3 (autorisation prealable) et L.341-6 ' +
      '(compensation en nature ou financiere)',
    dateEntreeEnVigueur: '2012-07-01',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000025244092/LEGISCTA000025247458`,
    commentaire:
      "Le defrichement est le changement de destination d'un terrain boise, meme sans coupe : poser des " +
      'panneaux sous couvert suffit a le constituer. L\'autorisation est instruite par la DDT, et la ' +
      'compensation — jusqu\'a plusieurs fois la surface defrichee, ou son equivalent financier — pese ' +
      'lourdement sur le bilan. Un terrain boise a plus de 5 % declenche ici le rappel, sur la base de la ' +
      'couverture forestiere mesuree. Les seuils de dispense sont fixes par arrete PREFECTORAL et varient ' +
      'd\'un departement a l\'autre.',
    instable: true,
    aValiderParJuriste: true,
  },
  especes_protegees: {
    id: 'commun_especes_protegees',
    libelle: 'Especes protegees : interdiction, et derogation exceptionnelle',
    reference:
      "Code de l'environnement, art. L.411-1 (interdictions) et L.411-2 (derogation, dite « derogation " +
      'especes protegees ») ; art. R.411-6 et suivants (procedure)',
    dateEntreeEnVigueur: '2000-09-21',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000033033465`,
    commentaire:
      "L'interdiction est de PRINCIPE : la derogation n'est possible qu'a trois conditions cumulatives — " +
      "absence de solution alternative, raison imperative d'interet public majeur, et maintien de l'etat " +
      'de conservation des populations. C\'est le motif de contentieux le plus frequent contre les projets ' +
      'ENR. Aucune source nationale ne permet de le prejuger a la parcelle : l\'application ne l\'affirme ' +
      'donc jamais et laisse « a verifier ». Seul un inventaire faune-flore sur quatre saisons conclut.',
    aValiderParJuriste: true,
  },
  natura2000_incidences: {
    id: 'commun_natura2000_incidences',
    libelle: 'Evaluation des incidences Natura 2000',
    reference:
      "Code de l'environnement, art. L.414-4 et R.414-19 a R.414-23 (evaluation des incidences sur les " +
      'sites Natura 2000)',
    dateEntreeEnVigueur: '2010-04-11',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000022478059`,
    commentaire:
      "L'evaluation est due meme lorsque le projet est situe HORS du site, des lors qu'il est susceptible " +
      "de l'affecter : la proximite suffit a la declencher, et une liste locale arretee par le prefet peut " +
      "l'imposer au-dela de la liste nationale. Une conclusion d'incidence significative sans mesure " +
      'suffisante bloque le projet.',
    instable: true,
    aValiderParJuriste: true,
  },
  archeologie_preventive: {
    id: 'commun_archeologie_preventive',
    libelle: 'Archeologie preventive : diagnostic et fouille eventuelle',
    reference:
      'Code du patrimoine, art. L.522-1 et suivants ; art. R.523-1 et R.523-4 (zones de presomption de ' +
      'prescription archeologique)',
    dateEntreeEnVigueur: '2004-02-24',
    url: `${LEGIFRANCE}/codes/section_lc/LEGITEXT000006074236/LEGISCTA000006159940`,
    commentaire:
      "Le service regional de l'archeologie peut prescrire un diagnostic sur un projet d'emprise " +
      "importante, et une fouille si le diagnostic est positif : compter plusieurs mois et un cout a la " +
      "charge de l'amenageur. Les zones de presomption sont arretees par le prefet de region et ne sont " +
      'pas publiees de facon homogene : l\'application ne les connait pas et laisse « a verifier ».',
    aValiderParJuriste: true,
  },
  site_classe: {
    id: 'commun_site_classe',
    libelle: 'Site classe : autorisation speciale de l’autorite ministerielle',
    reference:
      "Code de l'environnement, art. L.341-1 (classement) et L.341-10 (travaux soumis a autorisation " +
      'speciale)',
    dateEntreeEnVigueur: '2000-09-21',
    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000006833752`,
    commentaire:
      "En site classe, aucun travail modifiant l’etat ou l’aspect des lieux ne peut etre entrepris sans " +
      'autorisation SPECIALE, delivree au niveau ministeriel apres avis de la commission superieure des ' +
      'sites : c’est une procedure lourde, dont l’issue est defavorable pour un amenagement de production ' +
      'd’energie dans la quasi-totalite des cas. La date retenue est celle de l’entree en vigueur du code ' +
      'de l’environnement, qui a recodifie la loi du 2 mai 1930.',
    aValiderParJuriste: true,
  },
};

export const REGLES: Record<string, Record<string, RegleReglementaire>> = {
  commun: REGLES_COMMUNES,
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
