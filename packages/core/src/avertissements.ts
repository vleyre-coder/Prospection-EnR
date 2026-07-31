/**
 * Avertissements produit non negociables (cahier des charges, section 12).
 *
 * Ces textes doivent etre affiches dans l'application : bandeau permanent pour les
 * avertissements globaux, et au niveau du critere concerne pour les avertissements
 * contextuels. Ils ne sont pas parametrables et ne doivent pas pouvoir etre masques
 * definitivement par l'utilisateur.
 */

export interface Avertissement {
  id: string;
  /** 'global' : bandeau permanent. 'contextuel' : attache a un critere ou une couche. */
  portee: 'global' | 'contextuel';
  titre: string;
  texte: string;
  /** Criteres ou couches auxquels rattacher l'avertissement contextuel. */
  cible?: string[];
  niveau: 'info' | 'attention';
}

export const AVERTISSEMENTS: Avertissement[] = [
  {
    id: 'aide_decision',
    portee: 'global',
    niveau: 'attention',
    titre: "Aide a la decision, pas une garantie de faisabilite",
    texte:
      "Les scores et indicateurs presentes sont une aide a la priorisation de la prospection. Ils ne constituent en aucun cas une garantie de faisabilite d'un projet. Chaque donnee doit etre re-verifiee au moment du depot du dossier et a l'echelon departemental, aupres des services instructeurs competents.",
  },
  {
    id: 'cadastre_indicatif',
    portee: 'contextuel',
    niveau: 'attention',
    titre: "Le contour cadastral n'a pas de valeur juridique",
    texte:
      "Les contours parcellaires proviennent du Plan Cadastral Informatise. Ils sont fournis a titre indicatif et n'ont pas de valeur juridique : seul un document d'arpentage etabli par un geometre-expert fait foi. Les surfaces calculees sur ces contours peuvent differer de la contenance cadastrale.",
    cible: ['parcelles', 'identite', 'surf_utile', 'surf_un_seul_tenant'],
  },
  {
    id: 'seuils_evolutifs',
    portee: 'global',
    niveau: 'attention',
    titre: 'Les seuils reglementaires evoluent',
    texte:
      "Les seuils applicables aux projets ENR changent frequemment : les seuils solaires ont ete modifies deux fois en deux ans. Chaque seuil affiche par l'application porte la date d'entree en vigueur de la regle appliquee et la date de derniere verification du referentiel. Verifiez la version en vigueur a la date de votre depot.",
  },
  {
    id: 'capareseau_indicatif',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Capacites de raccordement indicatives',
    texte:
      "Les capacites d'accueil et etats de saturation proviennent de Capareseau et des donnees ouvertes des gestionnaires de reseau. Ils sont indicatifs, evoluent en continu au fil des demandes de raccordement, et ne sont pas engageants : seule une etude de raccordement, puis une proposition technique et financiere du gestionnaire, engagent une capacite.",
    cible: ['postes_sources', 'racc_distance_poste', 'racc_capacite_residuelle', 'racc_quote_part'],
  },
  {
    id: 'zone_humide_terrain',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Zone humide : pre-reperage a confirmer sur le terrain',
    texte:
      "La cartographie des zones humides est un pre-reperage. Le caractere humide d'une parcelle se determine par sondages pedologiques et releves floristiques, selon l'arrete du 24 juin 2008 modifie. Une parcelle non cartographiee peut etre humide, et inversement.",
    cible: ['env_zone_humide', 'zones_humides'],
  },
  {
    id: 'especes_terrain',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Especes protegees : inventaires de terrain indispensables',
    texte:
      "Les indicateurs de sensibilite especes, avifaune et chiropteres sont derives de donnees d'occurrence et de zonages d'inventaire. Ils ne remplacent pas un cycle biologique complet d'inventaires de terrain, seul a permettre d'apprecier le risque de derogation especes protegees.",
    cible: ['env_especes_protegees', 'env_avifaune', 'env_chiropteres'],
  },
  {
    id: 'documents_locaux',
    portee: 'contextuel',
    niveau: 'info',
    titre: 'Documents-cadres et ZAER : couverture partielle',
    texte:
      "Les zones d'acceleration des ENR et les documents-cadres departementaux relatifs au photovoltaique au sol ne font pas l'objet d'une API nationale consolidee. Leur couverture dans l'application est departementale et partielle : l'absence d'information ne vaut pas absence de contrainte.",
    cible: ['urb_zaer', 'zaer', 'documentCadrePvSol'],
  },
  {
    id: 'donnees_proprietaires',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Donnees de proprietaires : acces restreint',
    texte:
      "Les informations relatives aux proprietaires sont des donnees a caractere personnel. Leur consultation est journalisee et reservee aux utilisateurs habilites, dans le cadre de la finalite de prospection fonciere declaree. Toute diffusion en dehors de ce cadre est interdite.",
    cible: ['foncier', 'fonc_nb_proprietaires', 'fonc_maitrise'],
  },
];

export const AVERTISSEMENTS_GLOBAUX = AVERTISSEMENTS.filter((a) => a.portee === 'global');

export function avertissementsPourCible(cible: string): Avertissement[] {
  return AVERTISSEMENTS.filter((a) => a.cible?.includes(cible));
}
