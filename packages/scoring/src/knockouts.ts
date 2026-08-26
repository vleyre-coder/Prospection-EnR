/**
 * Criteres redhibitoires (knock-out).
 *
 * Une seule condition remplie suffit a ecarter la parcelle : le statut passe a ROUGE et
 * le score global n'est pas calcule (il serait trompeur).
 *
 * Deux knock-outs seulement sont qualifies de "derogeables" - c'est-a-dire qu'ils font
 * basculer la parcelle en ORANGE avec alerte forte plutot qu'en ROUGE - car le cahier des
 * charges les formule lui-meme de facon conditionnelle :
 *   - zonage d'urbanisme incompatible MAIS derogeable (procedure de modification, STECAL) ;
 *   - poste source sature MAIS avec un renforcement programme a l'horizon du projet.
 */

import type { Filiere, KnockOut, OptionsScoring, ParcelleSnapshot } from '@enr/core';
import { formatDistance, formatNombre } from './notes.js';
import { SRC } from './sources.js';
import { deportPossibleM, distanceAtteignableM } from './implantation.js';

interface CtxKo {
  filiere: Filiere;
  options: OptionsScoring;
  surfaceHa: number | null;
}

type RegleKo = (s: ParcelleSnapshot, ctx: CtxKo) => Omit<KnockOut, 'source'> | null;

function ko(
  id: string,
  libelle: string,
  motif: string,
  famille: KnockOut['famille'],
  regleLiee: string | null = null,
  derogeable = false,
): Omit<KnockOut, 'source'> {
  return { id, libelle, motif, famille, regleLiee, derogeable };
}

// ---------------------------------------------------------------------------
// Knock-outs communs a toutes les filieres
// ---------------------------------------------------------------------------

/**
 * LES IDENTIFIANTS SONT DES LITTERAUX, et c'etait un defaut.
 *
 * Ils etaient construits par interpolation (`ko_${suffixe}`), si bien que les trois knock-outs de
 * protection forte n'apparaissaient NULLE PART sous leur nom : ils manquaient a `IDS_KNOCK_OUTS`, donc
 * a la validation de `knockOutsDesactives` cote API. Consequence mesurable : il etait impossible de
 * desactiver le knock-out le plus severe de l'application — la requete etait refusee avec un
 * identifiant « inconnu ». Un identifiant construit echappe a toute enumeration.
 */
const koProtectionForte: RegleKo = (s) => {
  const candidats: Array<[string, boolean | null, string, string]> = [
    [
      'ko_coeur_parc_national',
      s.milieux.coeurParcNational.recouvre,
      'coeur de parc national',
      'commun_coeur_parc_national',
    ],
    [
      'ko_reserve_naturelle',
      s.milieux.reserveNaturelle.recouvre,
      'reserve naturelle',
      'commun_reserve_naturelle',
    ],
    ['ko_appb', s.milieux.appb.recouvre, 'arrete prefectoral de protection de biotope', 'commun_appb'],
  ];
  for (const [id, recouvre, libelle, regle] of candidats) {
    if (recouvre === true) {
      return ko(
        id,
        'Zone de protection forte',
        `La parcelle est recouverte par une ${libelle}. Ces zonages interdisent en pratique tout amenagement de production d'energie.`,
        'environnement',
        regle,
      );
    }
  }
  return null;
};

const koZoneHumide: RegleKo = (s) => {
  if (s.eau.zoneHumide === 'oui') {
    return ko(
      'ko_zone_humide',
      'Zone humide cartographiee',
      "La parcelle est identifiee comme zone humide dans les inventaires. La sequence eviter-reduire-compenser impose l'evitement en priorite ; une compensation de 100 a 200 % de la surface est rarement mobilisable. A confirmer par sondages pedologiques : une infirmation de terrain leve ce critere.",
      'environnement',
      'commun_zone_humide',
    );
  }
  return null;
};

const koPpriRouge: RegleKo = (s) => {
  const z = s.risques.ppri.zonage?.toLowerCase() ?? '';
  if (s.risques.ppri.present === true && (z.includes('rouge') || /^r/.test(z))) {
    return ko(
      'ko_ppri_rouge',
      'PPRI zone rouge',
      `La parcelle est en zone rouge du plan de prevention du risque inondation (${s.risques.ppri.zonage}), ou toute construction nouvelle est en principe interdite.`,
      'risques',
      'commun_ppr_zone_rouge',
    );
  }
  return null;
};

/**
 * ZONE ROUGE D'UN PPRIF, ET ZONE D'INTERDICTION D'UN PPRT — deux motifs qui manquaient.
 *
 * Mesure : seul le PPR INONDATION etait traite. Les deux autres plans etaient pourtant ingeres et
 * notes — `risq_incendie` et `risq_technologique` sont des criteres de toutes les filieres — mais leur
 * zone la plus severe ne pesait qu'en points, jamais en motif eliminatoire. Une parcelle en zone rouge
 * de PPRIF pouvait donc ressortir ORANGE, c'est-a-dire « a etudier », quand le reglement du plan y
 * interdit toute construction nouvelle.
 *
 * Le meme raisonnement s'applique aux trois plans, d'ou une regle unique parametree plutot que trois
 * copies : une regle ecrite trois fois se corrige une fois sur trois.
 */
const koPlanRisqueRouge: RegleKo = (s) => {
  const plans: Array<{
    id: string;
    plan: { present: boolean | null; zonage: string | null };
    libelle: string;
    quoi: string;
    regle: string;
  }> = [
    {
      id: 'ko_pprif_rouge',
      plan: s.risques.pprif,
      libelle: 'PPRIF zone rouge',
      quoi: "plan de prevention du risque d'incendie de foret",
      regle: 'commun_ppr_zone_rouge',
    },
    {
      id: 'ko_pprt_rouge',
      plan: s.risques.pprt,
      libelle: 'PPRT zone d’interdiction',
      quoi: 'plan de prevention des risques technologiques',
      regle: 'commun_pprt_zone_rouge',
    },
  ];
  for (const p of plans) {
    const z = p.plan.zonage?.toLowerCase() ?? '';
    // Meme lecture que pour le PPRI : « rouge » explicite, ou un zonage commencant par R. Les
    // reglements francais emploient l'un ou l'autre, jamais autre chose pour la zone la plus severe.
    if (p.plan.present === true && (z.includes('rouge') || /^r/.test(z))) {
      return ko(
        p.id,
        p.libelle,
        `La parcelle est en zone ${p.plan.zonage} du ${p.quoi}, ou toute construction nouvelle est en principe interdite. Le reglement du plan approuve fixe la portee exacte : le consulter avant de conclure, certains plans admettent des installations techniques non habitees.`,
        'risques',
        p.regle,
      );
    }
  }
  return null;
};

const koZonageIncompatible: RegleKo = (s, ctx) => {
  // EBC : espace boise classe. Interdiction de tout changement d'affectation du sol.
  const ebc = s.urbanisme.prescriptions.find((p) => p.estEbc);
  if (ebc) {
    return ko(
      'ko_ebc',
      'Espace boise classe',
      "La parcelle est grevee d'un espace boise classe : tout defrichement et tout changement d'affectation du sol compromettant la conservation des boisements est interdit. Le declassement suppose une revision du PLU.",
      'urbanisme',
      'commun_ebc',
    );
  }
  const er = s.urbanisme.prescriptions.find((p) => p.estEmplacementReserve);
  if (er) {
    return ko(
      'ko_emplacement_reserve',
      'Emplacement reserve',
      `La parcelle est grevee d'un emplacement reserve (${er.libelle ?? 'objet non precise'}) au benefice d'une collectivite : le foncier est destine a un autre usage.`,
      'urbanisme',
      'commun_emplacement_reserve',
      true,
    );
  }
  // Zonage naturel strict : incompatible mais derogeable (STECAL, modification du PLU).
  const zonages = s.urbanisme.zonages;
  if (zonages.length > 0) {
    const dominant = [...zonages].sort((a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0))[0]!;
    const t = (dominant.typeZone ?? dominant.libelle ?? '').toUpperCase();
    const enZaerPourFiliere = s.urbanisme.zaer.present === true && s.urbanisme.zaer.filieres.includes(ctx.filiere);
    if (/^N/.test(t) && !enZaerPourFiliere) {
      // La part reellement couverte est estimee par echantillonnage ; elle peut manquer sur
      // une parcelle trop etroite pour la grille. On le dit plutot que de laisser croire a
      // une mesure, car cette part est ce qui designe le zonage gouvernant.
      const part = dominant.partRecouvrement;
      const etendue =
        part == null
          ? "La part de la parcelle couverte par cette zone n'a pas pu etre estimee : verifiez le plan de zonage, la parcelle peut etre a cheval sur plusieurs zones."
          : part >= 0.95
            ? 'La zone couvre la totalite de la parcelle.'
            : `La zone couvre environ ${Math.round(part * 100)} % de la parcelle${
                zonages.length > 1
                  ? `, le reste relevant de ${zonages
                      .filter((z) => z !== dominant)
                      .map((z) => z.libelle ?? z.typeZone ?? '?')
                      .join(', ')} : une implantation sur la partie hors zone N peut etre envisageable.`
                  : '.'
              }`;
      return ko(
        'ko_zonage_naturel',
        'Zonage naturel (N)',
        `La parcelle est en zone ${dominant.libelle ?? t}, ou les installations de production d'energie ne sont generalement pas admises. ${etendue} Une implantation suppose un secteur de taille et de capacite d'accueil limitees (STECAL) ou une evolution du document d'urbanisme, soit 12 a 24 mois de procedure.`,
        'urbanisme',
        'commun_zone_n',
        true,
      );
    }
  }
  return null;
};

const koPosteSature: RegleKo = (s) => {
  const p = s.raccordement.posteLePlusProche;
  if (!p) return null;
  const sature = p.etatSaturation === 'sature' || (p.capaciteResiduelleMw != null && p.capaciteResiduelleMw <= 0);
  if (!sature) return null;
  const renfort = p.renforcement.prevu === true;
  return ko(
    'ko_poste_sature',
    'Poste source sature',
    renfort
      ? `Le poste source ${p.nom} est sature, mais un renforcement est inscrit au S3REnR${p.renforcement.horizon ? ` a l'horizon ${p.renforcement.horizon}` : ''}${p.renforcement.capaciteAttendueMw != null ? ` (+${formatNombre(p.renforcement.capaciteAttendueMw, 'MW')})` : ''}. La parcelle reste interessante si le calendrier du projet s'aligne sur celui du renforcement.`
      : `Le poste source ${p.nom} est sature et aucun renforcement n'est programme au S3REnR. Sans perspective de capacite a l'horizon du projet, le raccordement est bloquant. Un poste alternatif plus eloigne peut etre etudie.`,
    'raccordement',
    null,
    renfort,
  );
};

// ---------------------------------------------------------------------------
// Solaire au sol / agrivoltaisme
// ---------------------------------------------------------------------------

const koDocumentCadre: RegleKo = (s) => {
  const t = s.occupationSol.typeSol;
  const dc = s.urbanisme.documentCadrePvSol;
  if (t !== 'inculte') return null;
  // `null` = couche non ingeree, `false` = le departement n'a pas de document-cadre. Dans les deux
  // cas il n'y a pas de liste d'eligibilite opposable, donc pas de knock-out (audit 8, D5).
  if (dc.departementCouvert !== true) return null;
  if (dc.parcelleEligible === false) {
    return ko(
      'ko_hors_document_cadre',
      'Hors document-cadre departemental',
      `La parcelle est un terrain inculte ou non exploite en zone agricole, mais ne figure pas sur la liste des terrains eligibles du document-cadre departemental${dc.dateArrete ? ` (arrete du ${dc.dateArrete})` : ''}. L'implantation d'une centrale photovoltaique au sol y est donc interdite.`,
      'urbanisme',
      'pv_document_cadre',
    );
  }
  return null;
};

const koAopViticole: RegleKo = (s) => {
  if (s.occupationSol.aop.viticole === true) {
    return ko(
      'ko_aop_viticole',
      'Aire parcellaire AOP viticole',
      `La parcelle est comprise dans une aire parcellaire delimitee d'appellation d'origine protegee viticole${s.occupationSol.aop.appellations.length ? ` (${s.occupationSol.aop.appellations.join(', ')})` : ''}. L'INAO s'oppose en principe a l'artificialisation de ces aires.`,
      'sol',
      'pv_aop_viticole',
    );
  }
  return null;
};



// ---------------------------------------------------------------------------
// Eolien terrestre
// ---------------------------------------------------------------------------

/**
 * LE RECUL DE 500 M : deux grandeurs INDEPENDANTES, et elles ne l'etaient pas.
 *
 * DEFAUT TROUVE en declenchant chaque knock-out un par un. La fonction commencait par
 * `if (d == null) return null` sur la distance au BATIMENT le plus proche, et sortait donc avant
 * d'examiner la distance a la ZONE D'HABITAT. Or l'article L.515-44 vise les habitations ET les zones
 * destinees a l'habitation : ce sont deux contraintes distinctes, et la seconde s'applique meme quand
 * aucun batiment n'a ete mesure.
 *
 * Le cas n'est pas theorique : une parcelle en lisiere d'une zone U encore non batie a
 * `distanceHabitationM` a null — aucun batiment dans le rayon de recherche de la BD TOPO — et une zone
 * d'habitat a moins de 500 m. Le knock-out le plus structurant de la filiere eolienne ne se declenchait
 * pas, et rien ne le signalait.
 */
const koDistanceHabitation500: RegleKo = (s, ctx) => {
  const d = s.bati.distanceHabitationM;

  // Redhibitoire seulement si le seuil reste hors d'atteinte MEME en implantant
  // l'aerogenerateur au point le plus eloigne de la parcelle.
  const atteignable = d == null ? null : distanceAtteignableM(d, ctx.surfaceHa);
  if (d != null && atteignable != null && atteignable < 500) {
    // Le deport est recalcule pour le message : il est la grandeur que l'utilisateur doit voir
    // pour comprendre pourquoi la parcelle est ecartee malgre une distance de bord acceptable.
    const deport = deportPossibleM(ctx.surfaceHa);
    return ko(
      'ko_eol_habitation_500',
      "Recul de 500 m impossible sur cette parcelle",
      `L'habitation la plus proche est a ${formatDistance(d)} du bord de la parcelle. Meme en implantant l'aerogenerateur au point le plus eloigne (deport maximal estime ${formatDistance(deport)} pour ${ctx.surfaceHa != null ? formatNombre(ctx.surfaceHa, 'ha') : 'surface inconnue'}), le recul de 500 m exige par l'article L.515-44 du code de l'environnement ne peut pas etre atteint.`,
      'distances_reglementaires',
      'eol_distance_habitation',
    );
  }
  const dz = s.bati.distanceZoneHabitatM;
  if (dz != null && dz < 500) {
    return ko(
      'ko_eol_zone_habitat_500',
      "Zone destinee a l'habitation a moins de 500 m",
      `Une zone du document d'urbanisme destinee a l'habitation est a ${formatDistance(dz)}. Le seuil de 500 m s'applique aussi aux zones destinees a l'habitation, et non seulement au bati existant.`,
      'distances_reglementaires',
      'eol_distance_habitation',
    );
  }
  return null;
};

const koMonumentSiteClasse: RegleKo = (s) => {
  if (s.patrimoine.siteClasse.recouvre === true) {
    return ko(
      'ko_eol_site_classe',
      'Site classe',
      `La parcelle est en site classe${s.patrimoine.siteClasse.nom ? ` (${s.patrimoine.siteClasse.nom})` : ''}. Un parc eolien y est incompatible avec l'objectif de conservation du site : tout travail y suppose une autorisation speciale delivree au niveau ministeriel.`,
      'patrimoine',
      'commun_site_classe',
    );
  }
  const d = s.patrimoine.monumentHistorique.distanceM;
  if (d != null && d < 500) {
    return ko(
      'ko_eol_mh_500',
      'Monument historique a moins de 500 m',
      `Le monument historique le plus proche${s.patrimoine.monumentHistorique.nom ? ` (${s.patrimoine.monumentHistorique.nom})` : ''} est a ${formatDistance(d)}. Une implantation dans le perimetre de protection recueillera un avis defavorable de l'architecte des batiments de France.`,
      'patrimoine',
      'eol_monument_historique',
    );
  }
  return null;
};

const koRadar: RegleKo = (s) => {
  for (const r of s.risques.radars) {
    if (r.distanceMinRequiseKm != null && r.distanceKm < r.distanceMinRequiseKm) {
      return ko(
        'ko_eol_radar',
        'Perimetre radar bloquant',
        `La parcelle est a ${formatNombre(r.distanceKm, 'km')} d'un ${r.type}, en deca de la distance minimale de ${formatNombre(r.distanceMinRequiseKm, 'km')}. L'avis du gestionnaire (Meteo-France, DGAC ou armee) sera defavorable.`,
        'risques',
        'eol_radar',
      );
    }
  }
  if (s.risques.servitudesAeronautiques === true) {
    /**
     * AUCUN FONDEMENT JURIDIQUE ATTACHE, et c'est un correctif — pas un oubli.
     *
     * Ce knock-out citait `eol_radar`, c'est-a-dire l'arrete du 26 aout 2011 relatif aux RADARS. Ce
     * texte ne regit pas les servitudes aeronautiques de degagement : deux contraintes distinctes,
     * deux regimes distincts. La reference fausse s'imprimait dans le rapport PDF remis au
     * proprietaire, sous la mention « Fondement : … » — exactement la famille du defaut
     * « Fondement : eol_distance_habitation » corrige au chantier C.
     *
     * La reference est RETIREE plutot que remplacee : substituer un texte que je ne peux pas verifier
     * serait le meme defaut sous un meilleur deguisement. Le motif reste, il est exact et suffit a
     * ecarter la parcelle ; sa base juridique est a etablir par un juriste, avec les cinq autres
     * knock-outs de nature juridique qui n'en portent pas (voir docs/VERIFICATION-COUVERTURE.md).
     */
    return ko(
      'ko_eol_servitude_aero',
      'Servitude aeronautique',
      "La parcelle est grevee d'une servitude aeronautique de degagement : la hauteur des aerogenerateurs y est incompatible. Le plan de servitudes applicable est a verifier aupres du gestionnaire de l'aerodrome ou de la DGAC.",
      'risques',
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// Methanisation
// ---------------------------------------------------------------------------

const koMethaHabitation200: RegleKo = (s, ctx) => {
  const d = s.bati.distanceHabitationM;
  if (d == null) return null;

  // Meme raisonnement que pour l'eolien : le recul de 200 m se mesure depuis
  // l'installation, pas depuis la limite parcellaire.
  const atteignable = distanceAtteignableM(d, ctx.surfaceHa);
  if (atteignable < 200) {
    const deport = deportPossibleM(ctx.surfaceHa);
    return ko(
      'ko_metha_habitation_200',
      "Recul de 200 m impossible sur cette parcelle",
      `L'habitation la plus proche est a ${formatDistance(d)} du bord de la parcelle. Meme en implantant l'unite au point le plus eloigne (deport maximal estime ${formatDistance(deport)}), le recul de 200 m exige des installations soumises a enregistrement ou autorisation ne peut pas etre atteint.`,
      'distances_reglementaires',
      'metha_distance_habitation',
    );
  }
  return null;
};

/**
 * CAPTAGE AEP : le knock-out etait INATTEIGNABLE EN PRODUCTION.
 *
 * DEFAUT TROUVE en declenchant chaque knock-out un par un. La condition exigeait
 * `type === 'immediat' || type === 'rapproche'`. Or le connecteur des servitudes ecrit `type: null`, et
 * il a raison de le faire : le GPU expose l'assiette de la servitude sans distinguer les perimetres
 * immediat, rapproche et eloigne — la sous-categorie se lit sur l'arrete de declaration d'utilite
 * publique, et le code refuse de l'inventer.
 *
 * Consequence : la condition ne pouvait JAMAIS etre vraie sur de la donnee reelle. Une unite de
 * methanisation dans un perimetre de protection de captage n'etait donc jamais ecartee, alors que c'est
 * l'une des incompatibilites les plus nettes de la filiere.
 *
 * LE CORRECTIF NE SUPPOSE RIEN. Le knock-out se declenche sur le fait etabli — la parcelle EST dans un
 * perimetre de protection — et son caractere depend de ce que l'on sait :
 *   - sous-perimetre connu (immediat ou rapproche) : REDHIBITOIRE, l'interdiction est certaine ;
 *   - sous-perimetre inconnu : DEROGEABLE, c'est-a-dire orange avec alerte forte, et le motif dit
 *     d'aller lire l'arrete. C'est la seule formulation qui n'affirme ni plus ni moins que le su.
 */
const koMethaCaptage: RegleKo = (s) => {
  const c = s.eau.captageAep;
  if (c.dansPerimetre === true && c.type == null) {
    return ko(
      'ko_metha_captage',
      'Perimetre de protection de captage',
      "La parcelle est dans un perimetre de protection d'un captage d'eau destinee a la consommation humaine. Le sous-perimetre — immediat, rapproche ou eloigne — n'est pas publie par le Geoportail de l'urbanisme : il se lit sur l'arrete de declaration d'utilite publique du captage. En perimetre immediat toute activite est interdite ; en perimetre rapproche l'arrete fixe les interdictions, qui visent presque toujours le stockage d'effluents. A verifier avant toute autre depense.",
      // Meme famille que les deux autres reculs de la methanisation : c'est bien une distance
      // reglementaire, meme lorsque le sous-perimetre reste a etablir.
      'distances_reglementaires',
      'metha_distance_eau',
      true,
    );
  }
  if (c.dansPerimetre === true && (c.type === 'immediat' || c.type === 'rapproche')) {
    return ko(
      'ko_metha_captage',
      'Perimetre de protection de captage',
      `La parcelle est dans le perimetre de protection ${c.type} d'un captage d'eau destinee a la consommation humaine, ou une installation de methanisation est interdite.`,
      'distances_reglementaires',
      'metha_distance_eau',
    );
  }
  return null;
};

const koMethaCoursEau: RegleKo = (s) => {
  const d = s.eau.distanceCoursEauM;
  if (d != null && d < 35) {
    return ko(
      'ko_metha_cours_eau',
      "Cours d'eau a moins de 35 m",
      `Le cours d'eau le plus proche est a ${formatDistance(d)}, en deca du seuil reglementaire de 35 m applicable aux ouvrages de stockage et de traitement.`,
      'distances_reglementaires',
      'metha_distance_eau',
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// Composition par filiere
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stockage par batteries (BESS)
// ---------------------------------------------------------------------------

/**
 * LE PREMIER MOTIF ELIMINATOIRE PROPRE AU STOCKAGE.
 *
 * Mesure : `REGLES_KO` donnait `bess: [...COMMUNS]`. La filiere n'avait AUCUN motif qui lui soit propre,
 * et ses trois regles reglementaires ne pouvaient donc jamais ecarter une parcelle — elles n'existaient
 * qu'en rappel de procedure. Une batterie ne se distinguait d'une centrale solaire, du point de vue des
 * criteres eliminatoires, par rien.
 *
 * L'acces des engins est le bon premier candidat, pour deux raisons. Il est PROPRE a la filiere : les
 * conteneurs arrivent par semi-remorque et pesent des dizaines de tonnes, la ou des modules
 * photovoltaiques se manutentionnent autrement. Et il est MESURE : `acces.accesPoidsLourds` vient du
 * reseau routier de la BD TOPO, il n'est pas suppose.
 *
 * DEROGEABLE, et c'est la nuance qui compte : un acces se cree — elargissement, convention de passage,
 * renforcement de chaussee. C'est un cout et un delai, pas une impossibilite de droit. La parcelle
 * ressort donc en ORANGE avec alerte forte, jamais en rouge.
 */
const koBessAccesEngins: RegleKo = (s) => {
  if (s.acces.accesPoidsLourds !== false) return null;
  return ko(
    'ko_bess_acces_engins',
    'Aucun acces poids lourds',
    `Aucun acces poids lourds n'a ete identifie depuis le reseau routier${
      s.acces.distanceVoirieM != null ? ` (voirie la plus proche a ${formatDistance(s.acces.distanceVoirieM)})` : ''
    }. Deux exigences s'y opposent : la livraison des conteneurs, qui arrivent par semi-remorque, et la voie engins que le SDIS exige pour l'intervention. Un acces peut etre cree — elargissement, convention de passage, renforcement de chaussee — mais le cout et le delai doivent etre chiffres avant toute promesse au proprietaire.`,
    'acces',
    'bess_acces_engins',
    true,
  );
};

const COMMUNS: RegleKo[] = [
  koProtectionForte,
  koZoneHumide,
  koPpriRouge,
  koPlanRisqueRouge,
  koZonageIncompatible,
  koPosteSature,
];

/**
 * Identifiants de toutes les regles redhibitoires.
 *
 * POURQUOI CETTE LISTE EXISTE. `OptionsScoring.knockOutsDesactives` permet d'explorer un scenario
 * derogatoire en neutralisant une regle. Les routes acceptaient n'importe quelle chaine : un
 * identifiant mal orthographie — `ko_ppri_rouges` — etait accepte sans bruit, et l'utilisateur croyait
 * explorer un scenario qui n'etait pas applique. La liste ferme l'ensemble.
 *
 * Elle est verifiee par un test qui relit les appels `ko(...)` de ce fichier : une regle ajoutee sans
 * etre inscrite ici, ou inscrite sans exister, fait echouer la construction. Une liste maintenue a la
 * main se perime — c'est ce qui est arrive au controle de contrat de l'audit 7.
 */
export const IDS_KNOCK_OUTS = [
  'ko_aop_viticole',
  // Les trois protections fortes MANQUAIENT a cette liste : leurs identifiants etaient construits par
  // interpolation, donc invisibles a toute enumeration. Il etait impossible de desactiver le knock-out
  // le plus severe de l'application — la route refusait l'identifiant comme inconnu.
  'ko_appb',
  'ko_bess_acces_engins',
  'ko_coeur_parc_national',
  'ko_ebc',
  'ko_emplacement_reserve',
  'ko_eol_habitation_500',
  'ko_eol_mh_500',
  'ko_eol_radar',
  'ko_eol_servitude_aero',
  'ko_eol_site_classe',
  'ko_eol_zone_habitat_500',
  'ko_hors_document_cadre',
  'ko_metha_captage',
  'ko_metha_cours_eau',
  'ko_metha_habitation_200',
  'ko_poste_sature',
  'ko_ppri_rouge',
  'ko_pprif_rouge',
  'ko_pprt_rouge',
  'ko_reserve_naturelle',
  'ko_zonage_naturel',
  'ko_zone_humide',
] as const;

export type IdKnockOut = (typeof IDS_KNOCK_OUTS)[number];

const REGLES_KO: Record<Filiere, RegleKo[]> = {
  solaire_sol: [...COMMUNS, koDocumentCadre, koAopViticole],
  eolien_terrestre: [...COMMUNS, koDistanceHabitation500, koMonumentSiteClasse, koRadar],
  bess: [...COMMUNS, koBessAccesEngins],
  methanisation: [...COMMUNS, koMethaHabitation200, koMethaCaptage, koMethaCoursEau],
};

/**
 * Evalue tous les knock-outs de la filiere. Les knock-outs desactives par l'utilisateur
 * (mode scenario derogatoire) sont ignores mais restes traces dans le resultat.
 */
export function evaluerKnockOuts(s: ParcelleSnapshot, ctx: CtxKo): KnockOut[] {
  const desactives = new Set(ctx.options.knockOutsDesactives ?? []);
  const resultats: KnockOut[] = [];
  for (const regle of REGLES_KO[ctx.filiere]) {
    const r = regle(s, ctx);
    if (!r) continue;
    if (desactives.has(r.id)) continue;
    resultats.push({ ...r, source: sourcePourFamille(s, r.famille) });
  }
  return resultats;
}

function sourcePourFamille(s: ParcelleSnapshot, famille: KnockOut['famille']) {
  const cle =
    famille === 'urbanisme'
      ? SRC.gpu
      : famille === 'environnement'
        ? SRC.nature
        : famille === 'risques'
          ? SRC.georisques
          : famille === 'raccordement'
            ? SRC.postes
            : famille === 'patrimoine'
              ? SRC.patrimoine
              : famille === 'distances_reglementaires'
                ? SRC.bdtopo
                : SRC.cadastre;
  return s.sources[cle] ?? null;
}
