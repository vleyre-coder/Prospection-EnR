/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE LE RELEVE D'UNE PARCELLE SAIT REPONDRE, CONTRAINTE PAR CONTRAINTE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE PROBLEME QUE CE FICHIER RESOUT. Le referentiel porte 292 contraintes, dont 196 declarees
 * evaluables depuis une couche nationale. Le releve d'une parcelle, lui, porte 64 grandeurs. Les
 * deux ne se rejoignent pas tout seuls : rien dans « Éloignement 500 m des habitations » ne dit
 * qu'il faut lire `bati.distanceHabitationM`, et rien n'empeche de le brancher sur la mauvaise
 * grandeur.
 *
 * POURQUOI CETTE TABLE EST ECRITE A LA MAIN, ENTREE PAR ENTREE. J'ai commence par rapprocher les
 * deux listes par motifs sur les noms — « monument », « pente », « habitation ». Le resultat
 * paraissait excellent : 90 contraintes rattachees en quelques lignes. Il etait FAUX, et faux en
 * silence :
 *
 *   - « Distances de sécurité tiers / limites » en BESS vaut « 7-12 m des limites » — la limite
 *     PARCELLAIRE, pas l'habitation. Le motif « tiers » le branchait sur la distance au bati, et
 *     toute parcelle a plus de 7 m d'une maison serait passee « conforme » sans que la distance
 *     aux limites ait ete regardee une seule fois ;
 *   - « Gisement mobilisable dans un rayon économique » vaut « ~15 km » — un RAYON de collecte.
 *     Le seul chemin voisin est un TONNAGE. Comparer 15 km a des tonnes de matiere seche ne
 *     produit pas une erreur : cela produit un verdict ;
 *   - « Proximité routes/autoroutes/voies ferrées » vise les axes a grande circulation, quand
 *     `acces.distanceVoirieM` mesure la voirie carrossable la plus proche — un chemin communal
 *     compte. Le rapprochement aurait ecarte du foncier sur une route qui n'est pas visee.
 *
 * Aucune de ces trois erreurs n'aurait leve d'exception. Une correspondance fausse ne se
 * distingue pas d'une correspondance juste : elle rend un nombre, il se compare, et le verdict
 * sort. C'est pour cela que chaque entree ci-dessous porte sa justification, et que
 * `verdict-correspondances.test.ts` exige que l'unite du chemin soit celle du seuil.
 *
 * CE QUI N'EST PAS RATTACHE RESTE A INSTRUIRE, ET SE COMPTE. Une contrainte sans correspondance
 * n'est pas ignoree : le moteur la rend `donnee_absente`, elle fait basculer la parcelle en « à
 * instruire », et le dossier la liste. Mieux vaut un « à instruire » honnete qu'un « favorable »
 * obtenu en n'ayant rien regarde.
 */

import type { FiliereReferentiel } from '@enr/core';

/**
 * Comment une contrainte se mesure sur une parcelle.
 *
 *   - `seuil`   : une grandeur du releve se compare au seuil applique ;
 *   - `presence`: la parcelle intersecte un zonage, ou non. Le seuil du classeur n'est alors pas
 *     un nombre mais une interdiction (« Interdiction », « Évaluation des incidences »), et c'est
 *     le RECOUVREMENT qui declenche la regle.
 */
export type ModeMesure =
  | 'seuil'
  | 'presence'
  /**
   * Un DRAPEAU du releve : un booleen, ou un mot d'une liste fermee.
   *
   * POURQUOI CE TROISIEME MODE EXISTE, et il fallait le mesurer pour s'en apercevoir. Le releve
   * porte 64 grandeurs numeriques — et AUSSI une vingtaine de champs qui ne sont pas des nombres :
   * « la parcelle est-elle en zone humide », « dans un perimetre de captage », « couverte par un
   * PPRI ». Le modele a deux modes ne savait pas les lire, et les contraintes correspondantes
   * restaient « non evaluees » alors que la donnee etait la, en base, depuis le debut.
   *
   * `null` reste `null` : une donnee absente n'est pas un drapeau baisse. C'est la meme regle que
   * pour un zonage jamais croise.
   */
  | 'drapeau';

export interface Correspondance {
  contrainteId: string;
  mode: ModeMesure;
  /**
   * Chemins du releve. Un seul pour un `seuil` ; un ou plusieurs pour une `presence`, parce que
   * plusieurs lignes du classeur regroupent des zonages que le releve tient separes — « Réserves
   * naturelles, APB, cœurs de parcs » en est une seule contrainte et trois couches.
   */
  chemins: readonly string[];
  /**
   * Unite attendue du chemin, verifiee contre `BORNES_SNAPSHOT` par le test.
   *
   * Vaut `'drapeau'` pour le mode du meme nom : ces champs ne sont pas des grandeurs et ne
   * figurent donc pas dans les bornes physiques.
   */
  unite: string;
  /**
   * Valeurs qui DECLENCHENT la regle, pour un drapeau non booleen.
   *
   * `eau.zoneHumide` vaut « oui », « non » ou « a_confirmer » : seul le premier declenche, et
   * « a_confirmer » doit partir en verification plutot que d'etre compte pour un non. Absent pour
   * un booleen, ou `true` declenche.
   */
  valeursDeclenchantes?: readonly string[];
  /** Valeurs qui laissent la contrainte EN SUSPENS plutot que respectee ou enfreinte. */
  valeursIncertaines?: readonly string[];
  /**
   * Drapeau seulement : le chemin dont `false` ETABLIT l'absence du risque.
   *
   * POURQUOI IL FAUT TROIS ETATS, ET NON DEUX. `risques.ppri.present` dit si un plan existe sur la
   * COMMUNE ; `risques.ppri.severitePlan` dit ce que le plan impose a la PARCELLE. Traiter le
   * premier comme un verdict rendrait redhibitoire toute parcelle d'une commune dotee d'un PPRI —
   * des milliers de parcelles constructibles ecartees d'un coup.
   *
   * La lecture juste est donc :
   *   - severite « interdiction » ou « interdiction stricte » -> enfreinte ;
   *   - plan ABSENT de la commune (`present === false`) -> respectee, et c'est un fait etabli ;
   *   - plan present mais severite inconnue -> a verifier, pas enfreinte ;
   *   - rien du tout -> donnee absente.
   *
   * Mesure sur la base de reference : `present === false` sur les 301 parcelles. Sans cette
   * troisieme voie, 301 contraintes resteraient « non evaluees » alors que la reponse est connue.
   */
  cheminAbsence?: string;
  /** Pourquoi ce chemin et pas un autre. Lu en revue, pas decoratif. */
  justification: string;
}

/** Suffixe des chemins de recouvrement : une part de surface, entre 0 et 1. */
const PART = 'partRecouvrement';

/**
 * Fabrique les correspondances d'une famille de plans de prevention.
 *
 * Une par filiere, toutes lues de la meme facon : la severite du plan sur la parcelle tranche, et
 * l'ABSENCE de plan sur la commune etablit que la contrainte est respectee.
 */
function ppr(famille: string, racine: string, contraintes: readonly string[]): Correspondance[] {
  return contraintes.map((contrainteId) => ({
    contrainteId,
    mode: 'drapeau' as const,
    chemins: [`${racine}.severitePlan`],
    unite: 'drapeau',
    /*
     * Le classeur dit « zone rouge = inconstructible ». Les deux severites d'interdiction en sont
     * la traduction ; « prescriptions » et « precaution » autorisent sous conditions et ne peuvent
     * donc pas valoir infraction — mais elles ne valent pas non plus feu vert.
     */
    valeursDeclenchantes: ['interdiction_stricte', 'interdiction'],
    valeursIncertaines: ['prescriptions', 'precaution'],
    cheminAbsence: `${racine}.present`,
    justification:
      `Plan de prevention ${famille} : la severite appliquee a la parcelle tranche, et l'absence ` +
      'de plan sur la commune etablit l’absence de risque. Le simple fait qu’un plan existe sur la ' +
      'commune ne dit rien de la parcelle, et ne peut pas valoir interdiction.',
  }));
}

/**
 * Fabrique les correspondances de pente.
 *
 * Le classeur donne des fourchettes approximatives — « > ~10-15 % », « < ~3-5 % » — donc aucune ne
 * tranche seule : la contrainte part en verification. Elle n'en est pas moins utile a rattacher,
 * puisque la valeur MESUREE est alors restituee a l'operateur au lieu d'un « non evaluee » muet.
 */
function pente(contraintes: readonly string[]): Correspondance[] {
  return contraintes.map((contrainteId) => ({
    contrainteId,
    mode: 'seuil' as const,
    chemins: ['topographie.pentePct'],
    unite: '%',
    justification:
      'Pente moyenne de la parcelle, calculee sur le MNT RGE ALTI et renseignee sur toute la base ' +
      'de reference. C’est la grandeur que le classeur nomme, avec des fourchettes qui ne ' +
      'tranchent pas seules.',
  }));
}

/** Raccourci d'ecriture pour les zonages, tous mesures de la meme facon. */
function presence(
  contrainteId: string,
  couches: readonly string[],
  justification: string,
): Correspondance {
  return {
    contrainteId,
    mode: 'presence',
    chemins: couches.map((c) => `${c}.${PART}`),
    unite: 'part',
    justification,
  };
}

/**
 * LES CORRESPONDANCES, contrainte par contrainte.
 *
 * L'ordre suit les filieres du referentiel. Les contraintes absentes de cette table sont celles
 * dont le releve ne porte pas la grandeur : elles restent a instruire, et le moteur le dit.
 */
export const CORRESPONDANCES: readonly Correspondance[] = [
  // ─── Éolien terrestre ────────────────────────────────────────────────────────────────────
  {
    contrainteId: 'eolien_terrestre__eloignement_500_m_des_habitations',
    mode: 'seuil',
    chemins: ['bati.distanceHabitationM'],
    unite: 'm',
    justification:
      "Le recul de l'article L515-44 se mesure depuis les constructions a usage d'habitation. " +
      "`bati.distanceHabitationM` est la distance au bati d'habitation le plus proche, en metres, " +
      'soit exactement la grandeur du seuil.',
  },
  {
    contrainteId: 'eolien_terrestre__zones_a_urbaniser_habitat_u_au',
    mode: 'seuil',
    chemins: ['bati.distanceZoneHabitatM'],
    unite: 'm',
    justification:
      'Le meme recul vise AUSSI les zones destinees a l’habitation, qui ne portent pas forcement ' +
      'de bati. Deux grandeurs distinctes du releve, deux contraintes distinctes du classeur : les ' +
      'confondre laisserait passer une parcelle collee a une zone AU encore nue.',
  },
  {
    contrainteId: 'eolien_terrestre__monuments_historiques_abords_pda_500_m',
    mode: 'seuil',
    chemins: ['patrimoine.monumentHistorique.distanceM'],
    unite: 'm',
    justification:
      'Rayon des abords, en metres, depuis le monument le plus proche. Le classeur precise « ou ' +
      'PDA » : un perimetre delimite remplace alors les 500 m, ce que le releve ne porte pas — la ' +
      'contrainte reste donc marquee comme non etablie de facon ferme.',
  },
  {
    contrainteId: 'eolien_terrestre__gisement_de_vent',
    mode: 'seuil',
    chemins: ['gisement.ventVitesse100mMs'],
    unite: 'm/s',
    justification:
      'Vitesse moyenne annuelle a 100 m, la grandeur meme du seuil « ≥ ~5-6 m/s ». Le tilde du ' +
      'classeur la rend approximative, donc elle ne tranche pas seule.',
  },
  presence(
    'eolien_terrestre__natura_2000_zps_oiseaux',
    ['milieux.natura2000Oiseaux'],
    'ZPS = directive Oiseaux. Le releve tient les deux directives separees, et le classeur aussi : ' +
      'la ZPS est redhibitoire en eolien quand la ZSC ne l’est pas.',
  ),
  presence(
    'eolien_terrestre__natura_2000_zsc_sic_habitats',
    ['milieux.natura2000Habitats'],
    'ZSC / SIC = directive Habitats, penalisant et non redhibitoire. Voir la ligne ZPS ci-dessus.',
  ),
  presence(
    'eolien_terrestre__znieff_type_i',
    ['milieux.znieff1'],
    'ZNIEFF de type I seulement : le classeur la distingue du type II en eolien, avec un commentaire ' +
      '« souvent quasi redhibitoire » que le type II ne porte pas. Les fondre perdrait cet ecart.',
  ),
  presence(
    'eolien_terrestre__znieff_type_ii',
    ['milieux.znieff2'],
    'ZNIEFF de type II seulement, tenue separee du type I par le classeur en eolien.',
  ),
  presence(
    'eolien_terrestre__arrete_de_protection_biotope_geotope_habitats_appb_a',
    ['milieux.appb'],
    'Arretes de protection de biotope, de geotope et d’habitats : trois arretes de meme famille, ' +
      'portes par une seule couche du releve, celle que le classeur vise.',
  ),
  presence(
    'eolien_terrestre__parc_national_c_ur',
    ['milieux.coeurParcNational'],
    'Le CŒUR de parc, et lui seul — l’aire d’adhesion est une autre contrainte, penalisante.',
  ),
  presence(
    'eolien_terrestre__parc_naturel_regional_pnr',
    ['milieux.parcNaturelRegional'],
    'Compatibilite avec la charte du PNR : le recouvrement dit si la charte s’applique.',
  ),
  presence(
    'eolien_terrestre__sites_patrimoniaux_remarquables_spr',
    ['patrimoine.spr'],
    'Site patrimonial remarquable : avis de l’ABF des que la parcelle y est incluse.',
  ),

  // ─── Solaire au sol ──────────────────────────────────────────────────────────────────────
  {
    contrainteId: 'solaire_sol__monuments_historiques_abords_500_m_pda',
    mode: 'seuil',
    chemins: ['patrimoine.monumentHistorique.distanceM'],
    unite: 'm',
    justification: 'Meme grandeur qu’en eolien : distance au monument le plus proche, en metres.',
  },
  {
    contrainteId: 'solaire_sol__surface_minimale_compacite',
    mode: 'seuil',
    chemins: ['foncier.surfaceDunSeulTenantHa'],
    unite: 'ha',
    justification:
      'Le classeur dit « ≥ ~3-5 ha D’UN SEUL TENANT ». C’est bien la surface d’un seul tenant qu’il ' +
      'faut lire, pas la contenance cadastrale : huit parcelles contigues de 1 ha font un projet, ' +
      'et une parcelle de 4 ha coupee par une route n’en fait pas un.',
  },
  presence(
    'solaire_sol__c_urs_de_parcs_nationaux',
    ['milieux.coeurParcNational'],
    'Le CŒUR du parc, et lui seul : l’aire d’adhesion releve d’un autre regime, et le releve tient ' +
      'les deux separes.',
  ),
  presence(
    'solaire_sol__appb_aphn_apg',
    ['milieux.appb'],
    'APPB, APHN et APG sont trois arretes de meme famille ; le releve les porte sous une seule ' +
      'couche de protection de biotope, qui est celle que le classeur vise.',
  ),
  presence(
    'solaire_sol__natura_2000_zps_zsc_sic',
    ['milieux.natura2000Oiseaux', 'milieux.natura2000Habitats'],
    'Le classeur regroupe ici les deux directives en UNE contrainte, la ou l’eolien les separe. ' +
      'Les deux couches du releve sont donc lues ensemble : l’une ou l’autre declenche.',
  ),
  presence(
    'solaire_sol__znieff_i_ii',
    ['milieux.znieff1', 'milieux.znieff2'],
    'Les deux types en une contrainte, contrairement a l’eolien qui les distingue.',
  ),
  presence(
    'solaire_sol__sites_patrimoniaux_remarquables_spr',
    ['patrimoine.spr'],
    'Site patrimonial remarquable : avis conforme de l’ABF.',
  ),

  // ─── Agrivoltaisme ───────────────────────────────────────────────────────────────────────
  {
    contrainteId: 'agrivoltaisme__monuments_historiques_500_m_pda',
    mode: 'seuil',
    chemins: ['patrimoine.monumentHistorique.distanceM'],
    unite: 'm',
    justification: 'Distance au monument le plus proche, en metres.',
  },
  presence(
    'agrivoltaisme__natura_2000_zps_zsc',
    ['milieux.natura2000Oiseaux', 'milieux.natura2000Habitats'],
    'Les deux directives en une contrainte.',
  ),
  presence(
    'agrivoltaisme__reserves_naturelles_c_urs_de_parcs_nationaux',
    ['milieux.reserveNaturelle', 'milieux.coeurParcNational'],
    'Une contrainte du classeur, deux couches du releve : reserve naturelle OU cœur de parc.',
  ),
  presence(
    'agrivoltaisme__appb_arrete_protection_biotope',
    ['milieux.appb'],
    'Arrete de protection de biotope : le releve porte son recouvrement sous cette seule couche.',
  ),
  presence(
    'agrivoltaisme__znieff_i_ii',
    ['milieux.znieff1', 'milieux.znieff2'],
    'Le classeur regroupe ici les deux types en une contrainte : les deux couches sont donc lues ' +
      'en OU, l’une ou l’autre declenche.',
  ),
  presence(
    'agrivoltaisme__sites_patrimoniaux_remarquables_spr',
    ['patrimoine.spr'],
    'Site patrimonial remarquable : l’avis de l’ABF est requis des que la parcelle y est incluse, ' +
      'donc c’est bien le recouvrement qui declenche.',
  ),

  // ─── Stockage batterie (BESS) ────────────────────────────────────────────────────────────
  {
    contrainteId: 'bess__proximite_d_un_poste_source_rte_enedis',
    mode: 'seuil',
    chemins: ['raccordement.posteLePlusProche.distanceKm'],
    unite: 'km',
    justification:
      'Le classeur dit « < ~2 km A VOL D’OISEAU d’un poste source », et le releve porte cette ' +
      'distance en kilometres — meme unite, meme mode de mesure. Le lineaire reellement pose est ' +
      'une autre grandeur, majoree par le coefficient de trace, et ce n’est pas celle visee ici.',
  },
  {
    contrainteId: 'bess__monuments_historiques_abords_500_m_pda',
    mode: 'seuil',
    chemins: ['patrimoine.monumentHistorique.distanceM'],
    unite: 'm',
    justification: 'Distance au monument le plus proche, en metres.',
  },
  {
    contrainteId: 'bess__surface_emprise_necessaire',
    mode: 'seuil',
    chemins: ['foncier.surfaceDunSeulTenantHa'],
    unite: 'ha',
    justification:
      'Emprise necessaire au projet : c’est une surface utilisable d’un seul tenant, pas une ' +
      'contenance cadastrale eclatee.',
  },
  presence(
    'bess__natura_2000_zps_zsc',
    ['milieux.natura2000Oiseaux', 'milieux.natura2000Habitats'],
    'Les deux directives en une contrainte.',
  ),
  presence(
    'bess__znieff_i_ii',
    ['milieux.znieff1', 'milieux.znieff2'],
    'Les deux types en une contrainte : les deux couches sont lues en OU.',
  ),
  presence(
    'bess__reserves_naturelles_appb',
    ['milieux.reserveNaturelle', 'milieux.appb'],
    'Une contrainte, deux couches : reserve naturelle OU arrete de protection de biotope.',
  ),
  presence(
    'bess__sites_patrimoniaux_remarquables_spr',
    ['patrimoine.spr'],
    'Site patrimonial remarquable : le recouvrement declenche l’avis de l’ABF.',
  ),

  // ─── Methanisation ───────────────────────────────────────────────────────────────────────
  {
    contrainteId: 'methanisation__distance_d_implantation_aux_tiers_habitations_erp',
    mode: 'seuil',
    chemins: ['bati.distanceHabitationM'],
    unite: 'm',
    justification:
      'Distance d’implantation aux tiers, mesuree depuis les habitations et ERP. Le seuil ' +
      'REGLEMENTAIRE depend du regime ICPE — 100 m en declaration, 200 m en enregistrement — et le ' +
      'classeur porte les deux dans la meme cellule : la grandeur est mesurable, la valeur ' +
      'applicable ne l’est pas. C’est le cas ou un seuil developpeur tranche ce que le referentiel ' +
      'laisse ouvert.',
  },
  {
    contrainteId: 'methanisation__distance_aux_ressources_en_eau',
    mode: 'seuil',
    chemins: ['eau.distanceCoursEauM'],
    unite: 'm',
    justification:
      'Les 35 m se mesurent depuis les cours d’eau. La seconde moitie de la contrainte — ' +
      'l’interdiction en perimetre rapproche de captage — porte sur une AUTRE couche et n’est pas ' +
      'couverte par ce chemin : la contrainte reste donc non etablie de facon ferme.',
  },
  {
    contrainteId: 'methanisation__injection_biomethane_distance_au_reseau_gaz',
    mode: 'seuil',
    chemins: ['raccordement.reseauGaz.distanceCanalisationKm'],
    unite: 'km',
    justification:
      'Distance a la canalisation de gaz, en kilometres. Le classeur donne « ~ quelques km / ~1 km ' +
      'selon cout » : approximatif, donc jamais seul a trancher.',
  },
  {
    contrainteId: 'methanisation__superficie_de_la_parcelle',
    mode: 'seuil',
    chemins: ['foncier.surfaceDunSeulTenantHa'],
    unite: 'ha',
    justification: 'Superficie utilisable pour l’unite, d’un seul tenant.',
  },
  {
    contrainteId: 'methanisation__monuments_historiques_abords_500_m_pda',
    mode: 'seuil',
    chemins: ['patrimoine.monumentHistorique.distanceM'],
    unite: 'm',
    justification: 'Distance au monument le plus proche, en metres.',
  },
  {
    contrainteId: 'methanisation__acceptabilite_sociale_distance_de_confort',
    mode: 'seuil',
    chemins: ['bati.distanceHabitationM'],
    unite: 'm',
    justification:
      'Distance de confort aux habitations, explicitement NON reglementaire (« 300-500 m ' +
      '(confort) »). Meme grandeur que la distance ICPE, autre finalite : le classeur la classe a ' +
      'part, et le dossier doit pouvoir dire laquelle des deux a ecarte la parcelle.',
  },
  presence(
    'methanisation__natura_2000_zsc_zps',
    ['milieux.natura2000Habitats', 'milieux.natura2000Oiseaux'],
    'Les deux directives en une contrainte.',
  ),
  presence(
    'methanisation__znieff_i_ii',
    ['milieux.znieff1', 'milieux.znieff2'],
    'Les deux types en une contrainte : les deux couches sont lues en OU.',
  ),
  presence(
    'methanisation__reserves_naturelles_apb_c_urs_de_parcs',
    ['milieux.reserveNaturelle', 'milieux.appb', 'milieux.coeurParcNational'],
    'Une contrainte, trois couches : reserve naturelle, APB, ou cœur de parc national.',
  ),
  presence(
    'methanisation__sites_patrimoniaux_remarquables_spr',
    ['patrimoine.spr'],
    'Site patrimonial remarquable : le recouvrement declenche l’avis de l’ABF.',
  ),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // PLANS DE PREVENTION DES RISQUES — trois etats, jamais deux
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  //
  // MESURE QUI A MOTIVE TOUT CE BLOC. 47 des 64 grandeurs du releve ne servaient a AUCUN verdict.
  // Le goulot n'etait donc pas l'ingestion : les connecteurs remontent `risques.ppri.present`
  // depuis l'origine, renseigne sur 301 parcelles sur 301, et aucune contrainte ne le lisait.
  ...ppr('inondation', 'risques.ppri', [
    'eolien_terrestre__ppri_inondation',
    'solaire_sol__ppri_inondation',
    'agrivoltaisme__ppri_pprn_inondation',
    'bess__ppri_inondation',
    'methanisation__ppri_inondation',
  ]),
  ...ppr('incendie de foret', 'risques.pprif', [
    'eolien_terrestre__feux_de_foret_pprif_old',
    'solaire_sol__feux_de_foret_pprif_old',
    'agrivoltaisme__feux_de_foret_pprif_old',
    'bess__feux_de_foret_old_pprif',
    'methanisation__feux_de_foret_old_pprif',
  ]),
  ...ppr('technologique', 'risques.pprt', [
    'eolien_terrestre__pprt_sites_seveso',
    'solaire_sol__pprt_seveso',
    'bess__pprt_seveso_voisins',
    'methanisation__pprt_seveso_voisinage',
  ]),

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // GRANDEURS DEJA MESUREES, ET QUE PERSONNE NE LISAIT
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  ...pente([
    'eolien_terrestre__topographie_pente',
    'solaire_sol__pente_et_orientation_du_terrain',
    'agrivoltaisme__pente_orientation',
    'methanisation__topographie_terrain_plat',
    'methanisation__pente_des_parcelles_d_epandage',
  ]),
  {
    contrainteId: 'solaire_sol__gisement_solaire_irradiation',
    mode: 'seuil',
    chemins: ['gisement.irradiationKwhM2An'],
    unite: 'kWh/m2/an',
    justification:
      'Irradiation globale horizontale, le critere roi de la filiere, mesuree sur toute la base. Le ' +
      'classeur donne des ordres de grandeur par zone (« Sud >1400, Nord ~1000-1100 ») : la valeur ' +
      'est restituee et la contrainte part en verification, plutot que de trancher sur une fourchette.',
  },
  {
    contrainteId: 'solaire_sol__acces_et_voirie',
    mode: 'seuil',
    chemins: ['acces.distanceVoirieM'],
    unite: 'm',
    justification:
      'Distance a la voirie carrossable la plus proche. Le classeur dit « desserte PL » sans ' +
      'chiffre : la mesure est restituee pour que l’operateur juge, sans qu’aucun seuil ne soit invente.',
  },
  {
    contrainteId: 'agrivoltaisme__acces_desserte_distance_route',
    mode: 'seuil',
    chemins: ['acces.distanceVoirieM'],
    unite: 'm',
    justification: 'Meme grandeur qu’en solaire au sol : distance a la voirie carrossable.',
  },
  /*
   * ZONE HUMIDE : DELIBEREMENT NON RATTACHEE, et il faut dire pourquoi.
   *
   * Le releve porte `eau.zoneHumide`, renseigne sur la totalite de la base — la tentation etait
   * forte. Mais les cinq contraintes « zones humides » du classeur sont classees VERIFICATION
   * MANUELLE par le classeur lui-meme, qui renvoie aux criteres pedologiques et floristiques de
   * l'arrete du 24/06/2008. La source du releve se decrit d'ailleurs comme un « pre-reperage, a
   * confirmer ».
   *
   * Les rattacher ferait trancher une question que ni la donnee ni le referentiel ne tranchent :
   * une parcelle sortirait « respectee » sur un pre-reperage negatif, la ou un sondage
   * pedologique conclura l'inverse. Le garde de la table refuse d'ailleurs toute correspondance
   * vers une contrainte non `auto_sig` — c'est lui qui a rattrape cette entree.
   */
];

const PAR_ID = new Map(CORRESPONDANCES.map((c) => [c.contrainteId, c]));

/** Correspondance d'une contrainte, ou `null` — la contrainte reste alors a instruire. */
export function correspondanceDe(contrainteId: string): Correspondance | null {
  return PAR_ID.get(contrainteId) ?? null;
}

/** Nombre de contraintes rattachees, par filiere. Sert au rapport de couverture. */
export function couvertureParFiliere(): Record<FiliereReferentiel, number> {
  const comptes = {
    eolien_terrestre: 0,
    solaire_sol: 0,
    agrivoltaisme: 0,
    bess: 0,
    methanisation: 0,
  } as Record<FiliereReferentiel, number>;
  for (const c of CORRESPONDANCES) {
    const filiere = c.contrainteId.split('__')[0] as FiliereReferentiel;
    if (filiere in comptes) comptes[filiere] += 1;
  }
  return comptes;
}
