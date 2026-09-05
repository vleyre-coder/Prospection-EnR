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
      "Le coût de raccordement croit avec la longueur de la liaison. Au-delà d'une dizaine de kilomètres, il devient généralement rédhibitoire pour un projet de taille moyenne.",
      'km',
    ),
    def(
      'racc_capacite_residuelle',
      'raccordement',
      'Capacité résiduelle du poste source',
      "Capacité d'accueil restante publiée par Capareseau. Une capacité nulle impose d'attendre un renforcement S3REnR. Valeur indicative et non engageante.",
      'MW',
    ),
    def(
      'racc_quote_part',
      'raccordement',
      'Quote-part S3REnR',
      "Contribution au financement des ouvrages mutualises, en EUR/kW. Varie fortement d'un schéma régional à l'autre.",
      'EUR/kW',
    ),
    def(
      'racc_distance_reseau_gaz',
      'raccordement',
      'Distance au réseau gaz / point d\'injection',
      "Détermine la faisabilité économique de l'injection de biométhane. Au-delà de 5 à 10 km, la cogénération redevient l'option de référence.",
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
      "Vitesse moyenne du vent à 100 m. En dessous d'environ 5,5 m/s, la rentabilité d'un parc devient difficile à établir.",
      'm/s',
    ),
    def(
      'gis_intrants',
      'gisement',
      'Densité d\'intrants méthanisables',
      "Tonnage de matière seche mobilisable dans un rayon de 15 km : effluents d'élevage (RPG + cheptel), CIVE, coproduits d'industries agroalimentaires. C'est le critère déterminant de la filière.",
      't MS/an',
    ),
    def(
      'gis_debouche_epandage',
      'gisement',
      'Débouché du digestat (surfaces d\'épandage)',
      "Surfaces d'épandage mobilisables à proximité. Sans plan d'épandage ni sortie du statut de déchet, le projet n'a pas de débouché pour son digestat.",
      'ha',
    ),

    // -- Urbanisme ---------------------------------------------------------
    def(
      'urb_zonage',
      'urbanisme',
      'Compatibilité du zonage d\'urbanisme',
      "Zonage PLU/PLUi ou carte communale. Certains zonages autorisent l'installation de plein droit, d'autres exigent une procédure de modification, d'autres l'interdisent.",
    ),
    def(
      'urb_zaer',
      'urbanisme',
      'Zone d\'accélération des ENR',
      "L'inscription en ZAER pour la filière concernée traduit un portage politique local favorable et allege l'instruction. Absence de ZAER n'est pas bloquant.",
    ),

    // -- Sol ---------------------------------------------------------------
    def(
      'sol_type',
      'sol',
      'Statut et nature du sol',
      'Terrain artificialisé ou dégradé, agricole exploité, inculte, ou naturel/forestier. Détermine le régime juridique applicable et le niveau d\'opposition prévisible.',
    ),
    def(
      'sol_culture_compatible',
      'sol',
      'Compatibilité du type de culture',
      "Toutes les cultures ne se prêtent pas à l'agrivoltaïsme. Les prairies, cultures maraîchères et arboricoles sont les plus favorables ; les grandes cultures mécanisées le sont moins.",
    ),
    def(
      'sol_potentiel_agronomique',
      'sol',
      // NOMME POUR CE QU'IL EST — audit 8, defaut C3/E6. Le libelle etait « Potentiel agronomique »,
      // ce qui annonce une qualite de sol. La valeur vient en realite d'une table nationale figee
      // indexee sur le GROUPE DE CULTURE declare au RPG : deux parcelles voisines declarees
      // « prairies permanentes », l'une sur limon profond et l'autre sur dalle calcaire, recoivent
      // la meme note. Un groupe de culture est une declaration administrative pour une campagne ; le
      // potentiel agronomique depend de la texture, de la profondeur, de la reserve utile et de
      // l'hydromorphologie du sol, qu'aucune source nationale n'expose a la parcelle.
      'Potentiel agronomique (d’après la culture déclarée)',
      "Estimé d'après le GROUPE DE CULTURE déclaré au RPG, et non d'une mesure faite sur le sol : c'est un proxy, non une analyse pédologique. Un sol à faible potentiel réduit le conflit d'usage et l'opposition de la profession agricole. Critère inverse : un très bon sol penalise le projet. À confirmer par une étude de sol ou l'avis de la chambre d'agriculture.",
    ),
    def(
      'sol_foret',
      'sol',
      'Enjeu défrichement',
      "Toute surface boisée à défricher déclenche une autorisation de défrichement, des mesures compensatoires et une forte sensibilité locale.",
    ),

    // -- Topographie -------------------------------------------------------
    def('topo_pente', 'topographie', 'Pente', "Au-delà d'environ 10 à 15 %, les surcoûts de terrassement et de structures deviennent significatifs.", '%'),
    def('topo_orientation', 'topographie', 'Orientation', "Une orientation sud à sud-est/sud-ouest maximise le productible ; une orientation nord marquée le dégradé fortement.", 'deg'),
    def('topo_planeite', 'topographie', 'Planéité', "Dénivelé total sur l'emprise. Une plateforme plane réduit les coûts de génie civil, en particulier pour un BESS ou une unité de méthanisation.", 'm'),
    def('topo_altitude', 'topographie', 'Altitude', "L'altitude conditionne l'accessibilité, les conditions de chantier et, pour l'éolien, le givre et la turbulence.", 'm'),

    // -- Surface -----------------------------------------------------------
    def('surf_utile', 'surface', 'Surface utile', "Surface réellement exploitable après déduction des contraintes. Conditionne la puissance installable et donc l'atteinte du seuil de rentabilité.", 'ha'),
    def('surf_un_seul_tenant', 'surface', "Surface d'un seul tenant", "Un bloc continu evite les servitudes de passage, simplifie le raccordement interne et la maîtrise foncière.", 'ha'),
    def('surf_compacite', 'surface', 'Compacité de la parcelle', "Une forme compacte réduit les linéaires de clôtures et de câblage. Les parcelles en lanières sont pénalisantes.", ),

    // -- Environnement -----------------------------------------------------
    def('env_proximite_natura2000', 'environnement', 'Proximité Natura 2000', "La proximité (sans recouvrement) déclenche une évaluation des incidences Natura 2000 et allonge l'instruction.", 'm'),
    def('env_znieff', 'environnement', 'ZNIEFF de type I / II', "Inventaire scientifique sans portée réglementaire directe, mais qui pese lourdement dans l'instruction et le contentieux.", 'm'),
    def('env_zone_humide', 'environnement', 'Zone humide', "Pre-repérage cartographique. Une zone humide avereee impose évitement, ou compensation à 100-200 % ; à confirmer impérativement par sondages pédologiques.", ),
    def('env_tvb', 'environnement', 'Trame verte et bleue', "Réservoir de biodiversité ou corridor écologique identifie au SRADDET : opposabilité indirecte via le PLU.", ),
    def('env_especes_protegees', 'environnement', 'Pre-enjeu espèces protégées', "Probabilité de présence d'espèces protégées, estimée à partir des données d'occurrence. Conditionne le risque de dérogation espèces protégées.", ),

    // -- Patrimoine --------------------------------------------------------
    def('pat_monuments', 'patrimoine', 'Monuments historiques', "Distance au monument le plus proche et présence dans un périmètre de protection ou un PDA, declenchant l'avis de l'ABF.", 'm'),
    def('pat_sites', 'patrimoine', 'Sites classes et inscrits', "Un site classe impose une autorisation ministérielle. Un site inscrit, un avis de l'ABF.", 'm'),
    def('pat_archeologie', 'patrimoine', 'Sensibilité archéologique', "Zone de présomption de prescription archéologique : risque de diagnostic et de fouille preventive, impactant le calendrier.", ),

    // -- Risques -----------------------------------------------------------
    def('risq_inondation', 'risques', 'Risque inondation (PPRI)', "Un zonage rouge de PPRI interdit en principe les constructions ; un zonage bleu impose des prescriptions (transparence hydraulique, cote de plancher).", ),
    def('risq_incendie', 'risques', 'Risque incendie (PPRif / DFCI)', "Aléas feux de forêt, obligations légales de débroussaillement, accès des engins de secours.", ),
    def('risq_technologique', 'risques', 'Risque technologique (PPRT)', "Périmètre de PPRT autour d'un site Seveso : maîtrise de l'urbanisation, incompatible avec certaines installations.", ),
    def('risq_argiles_cavites', 'risques', 'Géotechnique (argiles, cavités, mouvements)', "Aléa retrait-gonflement des argiles, cavités souterraines et mouvements de terrain : surcoûts de fondations et de sondages.", ),
    def('risq_sites_pollues', 'risques', 'Sites et sols pollues', "Un ancien site industriel (CASIAS) peut être une opportunité - terrain déjà dégradé - mais impose une étude de sols et un plan de gestion.", ),
    def('risq_aero_radar', 'risques', 'Servitudes aéronautiques et radars', "Distances minimales aux radars météorologiques, civils et militaires, et servitudes de dégagement aéronautique. Motif de refus fréquent en éolien.", 'km'),
    def('risq_karst', 'risques', 'Contexte karstique', "En contexte karstique, le risque de transfert direct de pollution vers la nappe rend une unité de méthanisation difficilement acceptable.", ),

    // -- Distances reglementaires ------------------------------------------
    def('dist_habitation', 'distances_reglementaires', "Éloignement de l'habitat", "Distance à l'habitation la plus proche, mesurée sur le bati IGN. Au-delà du plancher réglementaire, chaque mètre gagne réduit le risque d'opposition.", 'm'),
    def('dist_eau', 'distances_reglementaires', "Éloignement des cours d'eau et points d'eau", "35 m minimum pour une unité de méthanisation et pour les épandages.", 'm'),
    def('dist_captage', 'distances_reglementaires', 'Périmètre de protection de captage', "Interdiction en périmètre immédiat et rapproche ; prescriptions renforcées en périmètre éloigné.", 'm'),

    // -- Foncier -----------------------------------------------------------
    def('fonc_nb_proprietaires', 'foncier', 'Nombre de propriétaires', "Chaque propriétaire supplémentaire, et a fortiori chaque indivision, allonge et fragilise la sécurisation foncière.", ),
    def('fonc_maitrise', 'foncier', 'Facilité de maîtrise foncière', "Synthèse : propriétaire unique, propriétaire public, indivision probable, exploitant distinct du propriétaire.", ),

    // -- Acces -------------------------------------------------------------
    def('acc_voirie', 'acces', 'Desserte routière', "Distance à la voirie carrossable. Conditionne le coût de création de piste et l'acheminement des composants.", 'm'),
    def('acc_poids_lourds', 'acces', 'Accès poids lourds', "Indispensable pour une unité de méthanisation (rotations quotidiennes) et pour l'acheminement des conteneurs BESS.", ),
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
    // `urb_zaer` N'EST PAS AU PROFIL DU STOCKAGE, et son retrait est un choix documente.
    //
    // La loi APER cree des zones d'acceleration pour la PRODUCTION d'energies renouvelables : aucune
    // ne vise une batterie. Le critere valait 2 points de ponderation, et avec l'ingestion nationale
    // des ZAER il aurait produit « Hors zone d'acceleration » (45/100) sur chaque parcelle de projet
    // de stockage — une penalite fabriquee, tiree d'un dispositif qui ne concerne pas la filiere.
    //
    // Le declarer ici tout en le rendant non applicable dans le moteur ferait annoncer au catalogue
    // un critere qu'il n'evalue pas, et les parts affichees ne sommeraient plus a 100 %.
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
      throw new Error(`Pondération ${filiere} : critère inconnu "${id}"`);
    }
  }
}
