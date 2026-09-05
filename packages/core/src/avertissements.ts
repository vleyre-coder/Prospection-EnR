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
  /**
   * Identifiants auxquels rattacher l'avertissement contextuel.
   *
   * Chaque cible est soit un identifiant de critere du catalogue, soit une RUBRIQUE de la fiche
   * declaree dans `CIBLES_RUBRIQUES`. Une cible qui n'est ni l'un ni l'autre ne s'affiche jamais :
   * la fiche filtre par egalite stricte, donc un identifiant inexistant fait disparaitre la
   * reserve en silence. Un test du referentiel refuse desormais ce cas.
   */
  cible?: string[];
  niveau: 'info' | 'attention';
}

/**
 * Rubriques de la fiche pouvant porter un avertissement, en plus des criteres.
 *
 * La fiche affiche les avertissements a deux niveaux : au critere deplie, et en tete de rubrique.
 * Cette liste est la seule source de verite des cibles de rubrique valides — sans elle, rien ne
 * distinguait une rubrique legitime d'un identifiant obsolete, et sept cibles mortes ont
 * survecu quatre audits en donnant a croire que des reserves s'affichaient la ou elles ne
 * s'affichaient pas.
 */
export const CIBLES_RUBRIQUES = ['identite', 'foncier'] as const;

export const AVERTISSEMENTS: Avertissement[] = [
  {
    id: 'aide_decision',
    portee: 'global',
    niveau: 'attention',
    titre: "Aide à la décision, pas une garantie de faisabilité",
    texte:
      "Les scores et indicateurs présentés sont une aide à la priorisation de la prospection. Ils ne constituent en aucun cas une garantie de faisabilité d'un projet. Chaque donnée doit être re-vérifiée au moment du dépôt du dossier et à l'échelon départemental, auprès des services instructeurs compétents.",
  },
  {
    id: 'cadastre_indicatif',
    portee: 'contextuel',
    niveau: 'attention',
    titre: "Le contour cadastral n'a pas de valeur juridique",
    texte:
      "Les contours parcellaires proviennent du Plan Cadastral Informatisé. Ils sont fournis à titre indicatif et n'ont pas de valeur juridique : seul un document d'arpentage établi par un géomètre-expert fait foi. Les surfaces calculées sur ces contours peuvent différer de la contenance cadastrale.",
    // `parcelles` retire : ce n'est ni un critere, ni une rubrique de la fiche.
    cible: ['identite', 'surf_utile', 'surf_un_seul_tenant'],
  },
  {
    id: 'seuils_evolutifs',
    portee: 'global',
    niveau: 'attention',
    titre: 'Les seuils réglementaires évoluent',
    texte:
      "Les seuils applicables aux projets ENR changent fréquemment : les seuils solaires ont été modifiés deux fois en deux ans. Chaque seuil affiché par l'application porte la date d'entrée en vigueur de la règle appliquée et la date de dernière vérification du référentiel. Vérifiez la version en vigueur à la date de votre dépôt.",
  },
  {
    id: 'capareseau_indicatif',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Capacités de raccordement indicatives',
    texte:
      "Les capacités d'accueil et états de saturation proviennent de Capareseau et des données ouvertes des gestionnaires de réseau. Ils sont indicatifs, évoluent en continu au fil des demandes de raccordement, et ne sont pas engageants : seule une étude de raccordement, puis une proposition technique et financière du gestionnaire, engagent une capacité.",
    // `postes_sources` retire : la rubrique Raccordement cible `racc_capacite_residuelle`.
    cible: ['racc_distance_poste', 'racc_capacite_residuelle', 'racc_quote_part'],
  },
  {
    id: 'zone_humide_terrain',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Zone humide : pre-repérage à confirmer sur le terrain',
    texte:
      "La cartographie des zones humides est un pré-repérage. Le caractère humide d'une parcelle se détermine par sondages pédologiques et relevés floristiques, selon l'arrêté du 24 juin 2008 modifié. Une parcelle non cartographiée peut être humide, et inversement.",
    // `zones_humides` retire : la rubrique cible directement le critere.
    cible: ['env_zone_humide'],
  },
  {
    id: 'especes_terrain',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Espèces protégées : inventaires de terrain indispensables',
    texte:
      "Les indicateurs de sensibilité espèces, avifaune et chiroptères sont dérives de données d'occurrence et de zonages d'inventaire. Ils ne remplacent pas un cycle biologique complet d'inventaires de terrain, seul à permettre d'apprécier le risque de dérogation espèces protégées.",
    /**
     * `env_avifaune` et `env_chiropteres` retires : ces criteres n'ont JAMAIS existe dans le
     * catalogue. L'intention — rattacher la reserve d'inventaire quatre saisons aux criteres
     * avifaune et chiropteres — n'a pas ete suivie de leur creation. La reserve reste attachee
     * a `env_especes_protegees`, qui est le critere reellement evalue ; si des criteres dedies
     * sont ajoutes un jour, il faudra les rattacher ici.
     */
    cible: ['env_especes_protegees'],
  },
  {
    id: 'documents_locaux',
    portee: 'contextuel',
    niveau: 'info',
    titre: 'Documents-cadres et ZAER : couverture partielle',
    texte:
      "Les zones d'accélération des ENR et les documents-cadres departementaux relatifs au photovoltaïque au sol ne font pas l'objet d'une API nationale consolidée. Leur couverture dans l'application est départementale et partielle : l'absence d'information ne vaut pas absence de contrainte.",
    // `zaer` et `documentCadrePvSol` retires : le premier double le critere `urb_zaer`, le
    // second est un nom de champ du snapshot et non un identifiant d'affichage.
    cible: ['urb_zaer'],
  },
  {
    id: 'donnees_proprietaires',
    portee: 'contextuel',
    niveau: 'attention',
    titre: 'Données de propriétaires : accès restreint',
    texte:
      "Les informations relatives aux propriétaires sont des données à caractère personnel. Leur consultation est journalisée et réservée aux utilisateurs habilités, dans le cadre de la finalité de prospection foncière déclarée. Toute diffusion en dehors de ce cadre est interdite.",
    cible: ['foncier', 'fonc_nb_proprietaires', 'fonc_maitrise'],
  },
];

export const AVERTISSEMENTS_GLOBAUX = AVERTISSEMENTS.filter((a) => a.portee === 'global');

/**
 * NOTE. Une fonction `avertissementsPourCible` a existe ici et n'a jamais ete appelee : la fiche
 * filtre en ligne, avec une condition supplementaire sur la portee que cette fonction n'avait
 * pas. Deux implementations d'une meme regle, dont une morte, valent moins qu'une seule vivante —
 * elle a donc ete retiree plutot que dupliquee. Le test du referentiel verifie que chaque cible
 * resout vers un critere ou une rubrique declaree, ce que la fonction ne garantissait pas.
 */
