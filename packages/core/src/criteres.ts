/**
 * Catalogue des criteres ponderes et profils de ponderation par defaut.
 *
 * Les poids sont exprimes en valeurs brutes ; le moteur les normalise a somme 1 en ne
 * retenant que les criteres effectivement evaluables. Un poids a 0 signifie que le critere
 * n'intervient pas pour cette filiere (ex. gisement pour le stockage).
 *
 * L'utilisateur peut modifier ces poids via des curseurs : ce fichier ne fournit que les
 * valeurs par defaut.
 */

import type { Filiere } from './filieres.js';
import type { DefinitionCritere, ProfilPonderation } from './scoring-types.js';

function def(
  id: string,
  famille: DefinitionCritere['famille'],
  libelle: string,
  explication: string,
  unite?: string,
): DefinitionCritere {
  return { id, famille, libelle, explication, unite };
}

export const CRITERES: Record<string, DefinitionCritere> = Object.fromEntries(
  [
    // -- Raccordement ------------------------------------------------------
    def(
      'racc_distance_poste',
      'raccordement',
      'Distance au poste source',
      "Le cout de raccordement croit avec la longueur de la liaison. Au-dela d'une dizaine de kilometres, il devient generalement redhibitoire pour un projet de taille moyenne.",
      'km',
    ),
    def(
      'racc_capacite_residuelle',
      'raccordement',
      'Capacite residuelle du poste source',
      "Capacite d'accueil restante publiee par Capareseau. Une capacite nulle impose d'attendre un renforcement S3REnR. Valeur indicative et non engageante.",
      'MW',
    ),
    def(
      'racc_quote_part',
      'raccordement',
      'Quote-part S3REnR',
      "Contribution au financement des ouvrages mutualises, en EUR/kW. Varie fortement d'un schema regional a l'autre.",
      'EUR/kW',
    ),
    def(
      'racc_distance_reseau_gaz',
      'raccordement',
      'Distance au reseau gaz / point d\'injection',
      "Determine la faisabilite economique de l'injection de biomethane. Au-dela de 5 a 10 km, la cogeneration redevient l'option de reference.",
      'km',
    ),

    // -- Gisement ----------------------------------------------------------
    def(
      'gis_irradiation',
      'gisement',
      'Irradiation solaire',
      'Irradiation globale horizontale annuelle. Conditionne directement le productible et donc le tarif atteignable.',
      'kWh/m2/an',
    ),
    def(
      'gis_vent',
      'gisement',
      'Gisement de vent',
      "Vitesse moyenne du vent a 100 m. En dessous d'environ 5,5 m/s, la rentabilite d'un parc devient difficile a etablir.",
      'm/s',
    ),
    def(
      'gis_intrants',
      'gisement',
      'Densite d\'intrants methanisables',
      "Tonnage de matiere seche mobilisable dans un rayon de 15 km : effluents d'elevage (RPG + cheptel), CIVE, coproduits d'industries agroalimentaires. C'est le critere determinant de la filiere.",
      't MS/an',
    ),
    def(
      'gis_debouche_epandage',
      'gisement',
      'Debouche du digestat (surfaces d\'epandage)',
      "Surfaces d'epandage mobilisables a proximite. Sans plan d'epandage ni sortie du statut de dechet, le projet n'a pas de debouche pour son digestat.",
      'ha',
    ),

    // -- Urbanisme ---------------------------------------------------------
    def(
      'urb_zonage',
      'urbanisme',
      'Compatibilite du zonage d\'urbanisme',
      "Zonage PLU/PLUi ou carte communale. Certains zonages autorisent l'installation de plein droit, d'autres exigent une procedure de modification, d'autres l'interdisent.",
    ),
    def(
      'urb_zaer',
      'urbanisme',
      'Zone d\'acceleration des ENR',
      "L'inscription en ZAER pour la filiere concernee traduit un portage politique local favorable et allege l'instruction. Absence de ZAER n'est pas bloquant.",
    ),

    // -- Sol ---------------------------------------------------------------
    def(
      'sol_type',
      'sol',
      'Statut et nature du sol',
      'Terrain artificialise ou degrade, agricole exploite, inculte, ou naturel/forestier. Determine le regime juridique applicable et le niveau d\'opposition previsible.',
    ),
    def(
      'sol_culture_compatible',
      'sol',
      'Compatibilite du type de culture',
      "Toutes les cultures ne se pretent pas a l'agrivoltaisme. Les prairies, cultures maraicheres et arboricoles sont les plus favorables ; les grandes cultures mecanisees le sont moins.",
    ),
    def(
      'sol_potentiel_agronomique',
      'sol',
      'Potentiel agronomique',
      "Un sol a faible potentiel agronomique reduit le conflit d'usage et l'opposition de la profession agricole. Critere inverse : un tres bon sol penalise le projet.",
    ),
    def(
      'sol_foret',
      'sol',
      'Enjeu defrichement',
      "Toute surface boisee a defricher declenche une autorisation de defrichement, des mesures compensatoires et une forte sensibilite locale.",
    ),

    // -- Topographie -------------------------------------------------------
    def('topo_pente', 'topographie', 'Pente', "Au-dela d'environ 10 a 15 %, les surcouts de terrassement et de structures deviennent significatifs.", '%'),
    def('topo_orientation', 'topographie', 'Orientation', "Une orientation sud a sud-est/sud-ouest maximise le productible ; une orientation nord marquee le degrade fortement.", 'deg'),
    def('topo_planeite', 'topographie', 'Planeite', "Denivele total sur l'emprise. Une plateforme plane reduit les couts de genie civil, en particulier pour un BESS ou une unite de methanisation.", 'm'),
    def('topo_altitude', 'topographie', 'Altitude', "L'altitude conditionne l'accessibilite, les conditions de chantier et, pour l'eolien, le givre et la turbulence.", 'm'),

    // -- Surface -----------------------------------------------------------
    def('surf_utile', 'surface', 'Surface utile', "Surface reellement exploitable apres deduction des contraintes. Conditionne la puissance installable et donc l'atteinte du seuil de rentabilite.", 'ha'),
    def('surf_un_seul_tenant', 'surface', "Surface d'un seul tenant", "Un bloc continu evite les servitudes de passage, simplifie le raccordement interne et la maitrise fonciere.", 'ha'),
    def('surf_compacite', 'surface', 'Compacite de la parcelle', "Une forme compacte limite les lineaires de clotures et de cablage. Les parcelles en lanieres sont penalisantes.", ),

    // -- Environnement -----------------------------------------------------
    def('env_proximite_natura2000', 'environnement', 'Proximite Natura 2000', "La proximite (sans recouvrement) declenche une evaluation des incidences Natura 2000 et allonge l'instruction.", 'm'),
    def('env_znieff', 'environnement', 'ZNIEFF de type I / II', "Inventaire scientifique sans portee reglementaire directe, mais qui pese lourdement dans l'instruction et le contentieux.", 'm'),
    def('env_zone_humide', 'environnement', 'Zone humide', "Pre-reperage cartographique. Une zone humide avereee impose evitement, ou compensation a 100-200 % ; a confirmer imperativement par sondages pedologiques.", ),
    def('env_tvb', 'environnement', 'Trame verte et bleue', "Reservoir de biodiversite ou corridor ecologique identifie au SRADDET : opposabilite indirecte via le PLU.", ),
    def('env_especes_protegees', 'environnement', 'Pre-enjeu especes protegees', "Probabilite de presence d'especes protegees, estimee a partir des donnees d'occurrence. Conditionne le risque de derogation especes protegees.", ),

    // -- Patrimoine --------------------------------------------------------
    def('pat_monuments', 'patrimoine', 'Monuments historiques', "Distance au monument le plus proche et presence dans un perimetre de protection ou un PDA, declenchant l'avis de l'ABF.", 'm'),
    def('pat_sites', 'patrimoine', 'Sites classes et inscrits', "Un site classe impose une autorisation ministerielle. Un site inscrit, un avis de l'ABF.", 'm'),
    def('pat_archeologie', 'patrimoine', 'Sensibilite archeologique', "Zone de presomption de prescription archeologique : risque de diagnostic et de fouille preventive, impactant le calendrier.", ),

    // -- Risques -----------------------------------------------------------
    def('risq_inondation', 'risques', 'Risque inondation (PPRI)', "Un zonage rouge de PPRI interdit en principe les constructions ; un zonage bleu impose des prescriptions (transparence hydraulique, cote de plancher).", ),
    def('risq_incendie', 'risques', 'Risque incendie (PPRif / DFCI)', "Aleas feux de foret, obligations legales de debroussaillement, acces des engins de secours.", ),
    def('risq_technologique', 'risques', 'Risque technologique (PPRT)', "Perimetre de PPRT autour d'un site Seveso : maitrise de l'urbanisation, incompatible avec certaines installations.", ),
    def('risq_argiles_cavites', 'risques', 'Geotechnique (argiles, cavites, mouvements)', "Alea retrait-gonflement des argiles, cavites souterraines et mouvements de terrain : surcouts de fondations et de sondages.", ),
    def('risq_sites_pollues', 'risques', 'Sites et sols pollues', "Un ancien site industriel (CASIAS) peut etre une opportunite - terrain deja degrade - mais impose une etude de sols et un plan de gestion.", ),
    def('risq_aero_radar', 'risques', 'Servitudes aeronautiques et radars', "Distances minimales aux radars meteorologiques, civils et militaires, et servitudes de degagement aeronautique. Motif de refus fréquent en eolien.", 'km'),
    def('risq_karst', 'risques', 'Contexte karstique', "En contexte karstique, le risque de transfert direct de pollution vers la nappe rend une unite de methanisation difficilement acceptable.", ),

    // -- Distances reglementaires ------------------------------------------
    def('dist_habitation', 'distances_reglementaires', "Eloignement de l'habitat", "Distance a l'habitation la plus proche, mesuree sur le bati IGN. Au-dela du plancher reglementaire, chaque metre gagne reduit le risque d'opposition.", 'm'),
    def('dist_eau', 'distances_reglementaires', "Eloignement des cours d'eau et points d'eau", "35 m minimum pour une unite de methanisation et pour les epandages.", 'm'),
    def('dist_captage', 'distances_reglementaires', 'Perimetre de protection de captage', "Interdiction en perimetre immediat et rapproche ; prescriptions renforcees en perimetre eloigne.", 'm'),

    // -- Foncier -----------------------------------------------------------
    def('fonc_nb_proprietaires', 'foncier', 'Nombre de proprietaires', "Chaque proprietaire supplementaire, et a fortiori chaque indivision, allonge et fragilise la securisation fonciere.", ),
    def('fonc_maitrise', 'foncier', 'Facilite de maitrise fonciere', "Synthese : proprietaire unique, proprietaire public, indivision probable, exploitant distinct du proprietaire.", ),

    // -- Acces -------------------------------------------------------------
    def('acc_voirie', 'acces', 'Desserte routiere', "Distance a la voirie carrossable. Conditionne le cout de creation de piste et l'acheminement des composants.", 'm'),
    def('acc_poids_lourds', 'acces', 'Acces poids lourds', "Indispensable pour une unite de methanisation (rotations quotidiennes) et pour l'acheminement des conteneurs BESS.", ),
  ].map((d) => [d.id, d]),
);

/** Poids par defaut, par filiere. Un critere absent du dictionnaire n'est pas evalue. */
const POIDS_DEFAUT: Record<Filiere, Record<string, number>> = {
  solaire_sol: {
    racc_distance_poste: 12,
    racc_capacite_residuelle: 10,
    gis_irradiation: 8,
    urb_zonage: 6,
    urb_zaer: 4,
    sol_type: 14,
    sol_culture_compatible: 5,
    sol_potentiel_agronomique: 4,
    sol_foret: 3,
    topo_pente: 8,
    topo_orientation: 4,
    topo_planeite: 2,
    surf_utile: 9,
    surf_un_seul_tenant: 4,
    surf_compacite: 2,
    env_proximite_natura2000: 5,
    env_znieff: 3,
    env_zone_humide: 4,
    env_especes_protegees: 3,
    env_tvb: 2,
    pat_monuments: 3,
    pat_sites: 2,
    pat_archeologie: 1,
    risq_inondation: 3,
    risq_argiles_cavites: 1,
    risq_sites_pollues: 1,
    fonc_nb_proprietaires: 4,
    fonc_maitrise: 2,
    acc_voirie: 2,
  },
  eolien_terrestre: {
    dist_habitation: 14,
    gis_vent: 14,
    surf_utile: 10,
    surf_un_seul_tenant: 8,
    racc_distance_poste: 9,
    racc_capacite_residuelle: 7,
    risq_aero_radar: 9,
    env_proximite_natura2000: 6,
    env_znieff: 3,
    env_zone_humide: 3,
    // Poids releve de 4 a 9 : ce critere porte desormais seul le pre-enjeu ecologique de
    // l'eolien, apres suppression des deux criteres qui n'en etaient qu'une copie.
    env_especes_protegees: 9,
    env_tvb: 2,
    pat_monuments: 5,
    pat_sites: 3,
    topo_altitude: 3,
    topo_pente: 3,
    sol_foret: 3,
    urb_zonage: 4,
    urb_zaer: 4,
    fonc_nb_proprietaires: 4,
    fonc_maitrise: 2,
    acc_voirie: 3,
  },
  bess: {
    racc_distance_poste: 22,
    racc_capacite_residuelle: 20,
    racc_quote_part: 4,
    surf_utile: 8,
    surf_compacite: 7,
    topo_planeite: 6,
    sol_type: 8,
    urb_zonage: 8,
    acc_poids_lourds: 7,
    acc_voirie: 3,
    dist_habitation: 6,
    risq_inondation: 5,
    risq_technologique: 3,
    risq_incendie: 3,
    risq_argiles_cavites: 2,
    env_zone_humide: 3,
    env_proximite_natura2000: 2,
    pat_monuments: 2,
    urb_zaer: 2,
    fonc_nb_proprietaires: 3,
  },
  methanisation: {
    gis_intrants: 18,
    racc_distance_reseau_gaz: 12,
    gis_debouche_epandage: 8,
    dist_habitation: 12,
    acc_poids_lourds: 9,
    dist_eau: 6,
    dist_captage: 6,
    urb_zonage: 6,
    surf_utile: 6,
    topo_planeite: 4,
    risq_inondation: 4,
    risq_karst: 5,
    racc_distance_poste: 3,
    env_zone_humide: 3,
    env_proximite_natura2000: 2,
    fonc_nb_proprietaires: 3,
    acc_voirie: 2,
  },
};

/** Profils de ponderation par defaut, exposes a l'API et modifiables par l'utilisateur. */
export const PONDERATIONS_DEFAUT: Record<Filiere, ProfilPonderation> = {
  solaire_sol: {
    filiere: 'solaire_sol',
    poids: POIDS_DEFAUT.solaire_sol,
    seuilVert: 65,
    seuilOrange: 40,
    seuilCouvertureDonnees: 0.8,
  },
  eolien_terrestre: {
    filiere: 'eolien_terrestre',
    poids: POIDS_DEFAUT.eolien_terrestre,
    seuilVert: 65,
    seuilOrange: 40,
    seuilCouvertureDonnees: 0.8,
  },
  bess: {
    filiere: 'bess',
    poids: POIDS_DEFAUT.bess,
    seuilVert: 65,
    seuilOrange: 40,
    seuilCouvertureDonnees: 0.8,
  },
  methanisation: {
    filiere: 'methanisation',
    poids: POIDS_DEFAUT.methanisation,
    seuilVert: 65,
    seuilOrange: 40,
    seuilCouvertureDonnees: 0.8,
  },
};

// Garde-fou : toute reference a un critere inexistant est une erreur de developpement.
for (const [filiere, poids] of Object.entries(POIDS_DEFAUT)) {
  for (const id of Object.keys(poids)) {
    if (!CRITERES[id]) {
      throw new Error(`Ponderation ${filiere} : critere inconnu "${id}"`);
    }
  }
}
