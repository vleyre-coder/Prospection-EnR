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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN KNOCK-OUT NON DEROGEABLE DOIT CITER SON ARTICLE — GARANTI PAR LE TYPE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un knock-out non derogeable ECARTE la parcelle : statut rouge, score annule, sortie des listes et
 * des sites. C'est le verdict le plus lourd que rende l'application, et il n'est legitime que s'il
 * traduit une interdiction — pas une difficulte, pas un cout, pas un indicateur defavorable.
 *
 * POURQUOI CETTE SURCHARGE EXISTE. Au 28/09/2026, un seul knock-out non derogeable ne citait aucune
 * regle : `ko_poste_sature`. Ce n'etait pas un oubli de documentation, c'etait le symptome — le
 * referentiel ne contient aucune regle sur la saturation parce qu'il n'en existe aucune, et ce
 * knock-out ecartait pourtant 100 parcelles sur 301 dans les cinq filieres. L'absence de fondement
 * etait visible dans la signature de l'appel, et personne ne la lisait.
 *
 * Le type la rend desormais impossible a ecrire : **sans `regleLiee`, un knock-out ne peut etre que
 * derogeable**. Un futur auteur qui voudrait ecarter definitivement une parcelle devra nommer
 * l'article qui l'y autorise — ou admettre qu'il n'en a pas, et se contenter du plafond orange.
 *
 * Ce n'est pas une contrainte de forme : c'est la question « de quel droit ? » posee a la
 * compilation.
 */
function ko(
  id: string,
  libelle: string,
  motif: string,
  famille: KnockOut['famille'],
  /** Obligatoire : un knock-out qui ecarte definitivement doit dire de quel droit. */
  regleLiee: string,
  derogeable?: false,
): Omit<KnockOut, 'source'>;
function ko(
  id: string,
  libelle: string,
  motif: string,
  famille: KnockOut['famille'],
  /** Facultatif ici : un knock-out derogeable plafonne le statut, il n'ecarte personne. */
  regleLiee: string | null,
  derogeable: true,
): Omit<KnockOut, 'source'>;
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
      'cœur de parc national',
      'commun_coeur_parc_national',
    ],
    [
      'ko_reserve_naturelle',
      s.milieux.reserveNaturelle.recouvre,
      'réserve naturelle',
      'commun_reserve_naturelle',
    ],
    ['ko_appb', s.milieux.appb.recouvre, 'arrêté préfectoral de protection de biotope', 'commun_appb'],
  ];
  for (const [id, recouvre, libelle, regle] of candidats) {
    if (recouvre === true) {
      return ko(
        id,
        'Zone de protection forte',
        `La parcelle est recouverte par une ${libelle}. Ces zonages interdisent en pratique tout aménagement de production d'énergie.`,
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
      'Zone humide cartographiée',
      "La parcelle est identifiée comme zone humide dans les inventaires. La séquence éviter-réduire-compenser impose l'évitement en priorité ; une compensation de 100 à 200 % de la surface est rarement mobilisable. À confirmer par sondages pédologiques : une infirmation de terrain lève ce critère.",
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
      `La parcelle est en zone rouge du plan de prévention du risque inondation (${s.risques.ppri.zonage}), ou toute construction nouvelle est en principe interdite.`,
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
      quoi: "plan de prévention du risque d'incendie de forêt",
      regle: 'commun_ppr_zone_rouge',
    },
    {
      id: 'ko_pprt_rouge',
      plan: s.risques.pprt,
      libelle: 'PPRT zone d’interdiction',
      quoi: 'plan de prévention des risques technologiques',
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
        `La parcelle est en zone ${p.plan.zonage} du ${p.quoi}, ou toute construction nouvelle est en principe interdite. Le règlement du plan approuve fixe la portée exacte : le consulter avant de conclure, certains plans admettent des installations techniques non habitées.`,
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
      'Espace boisé classé',
      "La parcelle est grevée d'un espace boisé classé : tout défrichement et tout changement d'affectation du sol compromettant la conservation des boisements est interdit. Le déclassement suppose une révision du PLU.",
      'urbanisme',
      'commun_ebc',
    );
  }
  const er = s.urbanisme.prescriptions.find((p) => p.estEmplacementReserve);
  if (er) {
    return ko(
      'ko_emplacement_reserve',
      'Emplacement réservé',
      `La parcelle est grevée d'un emplacement réservé (${er.libelle ?? 'objet non précisé'}) au bénéfice d'une collectivité : le foncier est destiné à un autre usage.`,
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
          ? "La part de la parcelle couverte par cette zone n'a pas pu être estimée : vérifiez le plan de zonage, la parcelle peut être à cheval sur plusieurs zones."
          : part >= 0.95
            ? 'La zone couvre la totalité de la parcelle.'
            : `La zone couvre environ ${Math.round(part * 100)} % de la parcelle${
                zonages.length > 1
                  ? `, le reste relevant de ${zonages
                      .filter((z) => z !== dominant)
                      .map((z) => z.libelle ?? z.typeZone ?? '?')
                      .join(', ')} : une implantation sur la partie hors zone N peut être envisageable.`
                  : '.'
              }`;
      return ko(
        'ko_zonage_naturel',
        'Zonage naturel (N)',
        `La parcelle est en zone ${dominant.libelle ?? t}, ou les installations de production d'énergie ne sont généralement pas admises. ${etendue} Une implantation suppose un secteur de taille et de capacité d'accueil limitées (STECAL) ou une évolution du document d'urbanisme, soit 12 à 24 mois de procédure.`,
        'urbanisme',
        'commun_zone_n',
        true,
      );
    }
  }
  return null;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * POSTE SOURCE SATURE — UN OBSTACLE MAJEUR, ET JAMAIS UNE INTERDICTION
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE KNOCK-OUT ECARTAIT DEFINITIVEMENT LA PARCELLE — statut rouge, score annule, sortie des listes
 * et des sites — sauf si un renforcement etait programme. Mesure du 28/09/2026 : il se declenchait
 * sur **100 parcelles sur 301, dans les CINQ filieres**, soit cinq cents verdicts.
 *
 * CE N'EST PAS UNE LECTURE JURIDIQUEMENT SOUTENABLE, et quatre choses le montrent :
 *
 *   1. AUCUN ARTICLE NE L'ADOSSE. Ce knock-out est le seul non derogeable a porter
 *      `regleLiee: null`. Tous les autres citent leur fondement — L.515-44 pour les 500 m de
 *      l'eolien, R.411-15 pour l'arrete de biotope, L.341-10 pour le site classe. Le referentiel
 *      ne contient aucune regle sur la saturation, parce qu'il n'en existe aucune : la saturation
 *      d'un poste n'est pas une servitude, elle ne s'oppose a personne.
 *   2. LA SOURCE ELLE-MEME REFUSE D'ENGAGER. L'avertissement du connecteur Capareseau, affiche
 *      dans la fiche, dit : « Capacites indicatives et NON ENGAGEANTES, evolutives au fil des
 *      demandes de raccordement. Seule une etude de raccordement puis une proposition technique et
 *      financiere du gestionnaire engagent une capacite. » Fonder une exclusion definitive sur un
 *      indicateur que l'application declare non engageant est contradictoire.
 *   3. LE MOTIF SE CONTREDISAIT LUI-MEME : il ecartait la parcelle tout en ecrivant « un poste
 *      alternatif plus eloigne peut etre etudie ».
 *   4. LES ALTERNATIVES EXISTENT DANS LA DONNEE. Sur la parcelle 280290000Z0399, DAMBRON est
 *      sature a 6,75 km — mais ORGERES porte 1,5 MW a 9,28 km et TIVERNON 1,1 MW a 9,7 km. La
 *      parcelle etait ecartee alors que deux postes raccordables figuraient dans son instantane.
 *
 * CE QUI CHANGE, ET CE QUI NE CHANGE PAS. Le knock-out reste — la saturation du poste le plus
 * proche est le premier obstacle pratique d'un projet, et elle doit se voir dans la fiche, dans le
 * dossier et dans la liste. Il devient DEROGEABLE : la parcelle conserve son score et son rang, et
 * reste plafonnee a orange, donc jamais declaree propice. L'arbitrage revient au prospecteur, qui
 * dispose du calendrier du projet et de l'appetence du developpeur pour une quote-part — deux
 * choses que l'application ne connait pas.
 *
 * ET LE MOTIF NOMME DESORMAIS L'ALTERNATIVE quand il en existe une : sa distance et sa capacite.
 * « Un poste alternatif peut etre etudie » n'aide personne ; « ORGERES, 1,5 MW a 9,3 km » se
 * verifie et s'appelle.
 */
const koPosteSature: RegleKo = (s) => {
  const p = s.raccordement.posteLePlusProche;
  if (!p) return null;
  const sature = p.etatSaturation === 'sature' || (p.capaciteResiduelleMw != null && p.capaciteResiduelleMw <= 0);
  if (!sature) return null;

  const renfort = p.renforcement.prevu === true;
  /*
   * Le poste raccordable le plus proche parmi les alternatifs : capacite residuelle strictement
   * positive et non sature. A egalite de distance, l'identifiant departage — meme ordre total que
   * le moteur et le filtre de recherche, sans quoi la fiche et la liste pourraient retenir chacune
   * le sien.
   */
  const alternatif = s.raccordement.postesAlternatifs
    .filter((a) => a.capaciteResiduelleMw != null && a.capaciteResiduelleMw > 0 && a.etatSaturation !== 'sature')
    .reduce<(typeof s.raccordement.postesAlternatifs)[number] | null>(
      (meilleur, a) =>
        meilleur == null ||
        a.distanceKm < meilleur.distanceKm ||
        (a.distanceKm === meilleur.distanceKm && a.id < meilleur.id)
          ? a
          : meilleur,
      null,
    );

  const suite = renfort
    ? `, mais un renforcement est inscrit au S3REnR${p.renforcement.horizon ? ` à l'horizon ${p.renforcement.horizon}` : ''}${p.renforcement.capaciteAttendueMw != null ? ` (+${formatNombre(p.renforcement.capaciteAttendueMw, 'MW')})` : ''}. La parcelle reste intéressante si le calendrier du projet s'aligne sur celui du renforcement.`
    : ` et aucun renforcement n'est inscrit au S3REnR.`;
  const recours = alternatif
    ? ` Poste raccordable le plus proche : ${alternatif.nom}, ${formatNombre(alternatif.capaciteResiduelleMw ?? 0, 'MW')} disponibles à ${formatNombre(alternatif.distanceKm, 'km')} — le linéaire supplémentaire et la quote-part sont à chiffrer.`
    : ` Aucun poste alternatif porteur de capacité dans l'instantané : le raccordement est à instruire avec le gestionnaire avant tout engagement.`;

  return ko(
    'ko_poste_sature',
    'Poste source saturé',
    `Le poste source ${p.nom} est saturé${suite}${recours} Les capacités de Capareseau sont indicatives et non engageantes : seule une étude de raccordement, puis une proposition technique et financière du gestionnaire, engagent une capacité.`,
    'raccordement',
    null,
    /*
     * TOUJOURS DEROGEABLE. La saturation n'est adossee a aucun article, et la source se declare
     * elle-meme non engageante : elle ne peut pas fonder une exclusion definitive. Elle plafonne le
     * statut a orange, ce qui est la severite juste — un obstacle majeur, pas une interdiction.
     */
    true,
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
      'Hors document-cadre départemental',
      `La parcelle est un terrain inculte ou non exploité en zone agricole, mais ne figure pas sur la liste des terrains éligibles du document-cadre départemental${dc.dateArrete ? ` (arrêté du ${dc.dateArrete})` : ''}. L'implantation d'une centrale photovoltaïque au sol y est donc interdite.`,
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
      `La parcelle est comprise dans une aire parcellaire délimitée d'appellation d'origine protégée viticole${s.occupationSol.aop.appellations.length ? ` (${s.occupationSol.aop.appellations.join(', ')})` : ''}. L'INAO s'oppose en principe à l'artificialisation de ces aires.`,
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
 * `if (d == null) return null` sur la distance au BÂTIMENT le plus proche, et sortait donc avant
 * d'examiner la distance à la ZONE D'HABITAT. Or l'article L.515-44 vise les habitations ET les zones
 * destinées à l'habitation : ce sont deux contraintes distinctes, et la seconde s'applique même quand
 * aucun bâtiment n'a été mesure.
 *
 * Le cas n'est pas théorique : une parcelle en lisière d'une zone U encore non batie a
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
    const déport = deportPossibleM(ctx.surfaceHa);
    return ko(
      'ko_eol_habitation_500',
      "Recul de 500 m impossible sur cette parcelle",
      `L'habitation la plus proche est à ${formatDistance(d)} du bord de la parcelle. Même en implantant l'aérogénérateur au point le plus éloigné (déport maximal estimé ${formatDistance(déport)} pour ${ctx.surfaceHa != null ? formatNombre(ctx.surfaceHa, 'ha') : 'surface inconnue'}), le recul de 500 m exige par l'article L.515-44 du code de l'environnement ne peut pas être atteint.`,
      'distances_reglementaires',
      'eol_distance_habitation',
    );
  }
  const dz = s.bati.distanceZoneHabitatM;
  if (dz != null && dz < 500) {
    return ko(
      'ko_eol_zone_habitat_500',
      "Zone destinée à l'habitation à moins de 500 m",
      `Une zone du document d'urbanisme destinée à l'habitation est à ${formatDistance(dz)}. Le seuil de 500 m s'applique aussi aux zones destinées à l'habitation, et non seulement au bâti existant.`,
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
      'Site classé',
      `La parcelle est en site classé${s.patrimoine.siteClasse.nom ? ` (${s.patrimoine.siteClasse.nom})` : ''}. Un parc éolien y est incompatible avec l'objectif de conservation du site : tout travail y suppose une autorisation spéciale.`,
      'patrimoine',
      'commun_site_classe',
    );
  }
  const d = s.patrimoine.monumentHistorique.distanceM;
  if (d != null && d < 500) {
    return ko(
      'ko_eol_mh_500',
      'Monument historique à moins de 500 m',
      `Le monument historique le plus proche${s.patrimoine.monumentHistorique.nom ? ` (${s.patrimoine.monumentHistorique.nom})` : ''} est à ${formatDistance(d)}. Une implantation dans le périmètre de protection recueillera un avis défavorable de l'architecte des bâtiments de France.`,
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
        'Périmètre radar bloquant',
        `La parcelle est à ${formatNombre(r.distanceKm, 'km')} d'un ${r.type}, en deçà de la distance minimale de ${formatNombre(r.distanceMinRequiseKm, 'km')}. L'avis du gestionnaire (Meteo-France, DGAC ou armée) sera défavorable.`,
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
    /**
     * DEROGEABLE DEPUIS LE 28/09/2026, et c'est la contrainte de type qui a pose la question.
     *
     * Ce knock-out ecartait definitivement la parcelle sans citer aucun article — le seul cas
     * restant apres la correction du poste sature. La surcharge de `ko()` l'a rendu inecrivable, ce
     * qui a oblige a trancher plutot qu'a laisser courir.
     *
     * CE QUE L'APPLICATION SAIT : une servitude T4/T5 recouvre la parcelle. CE QU'ELLE NE SAIT PAS :
     * la HAUTEUR que cette servitude autorise — le GPU publie l'assiette, pas la cote. Or c'est la
     * hauteur qui decide. Affirmer « la hauteur des aerogenerateurs y est incompatible » etait donc
     * une inference, et le motif le reconnaissait dans la phrase suivante en renvoyant au plan de
     * servitudes : la meme contradiction que celle du poste sature — ecarter la parcelle tout en
     * disant qu'il faut aller verifier.
     *
     * La contrainte reste LOURDE et s'affiche comme telle ; elle plafonne le statut a orange au lieu
     * d'annuler le score. Le jour ou la cote de la servitude sera lisible, ce knock-out pourra
     * redevenir excluant — en citant enfin son fondement.
     */
    return ko(
      'ko_eol_servitude_aero',
      'Servitude aéronautique',
      "La parcelle est grevée d'une servitude aéronautique de dégagement. Ces servitudes plafonnent la hauteur des ouvrages, et un aérogénérateur les dépasse presque toujours — mais la cote autorisée n'est pas publiée avec l'assiette : elle est à lire sur le plan de servitudes, auprès du gestionnaire de l'aérodrome ou de la DGAC, avant tout engagement.",
      'risques',
      null,
      true,
    );
  }
  return null;
};

/**
 * SERVITUDE RADIOELECTRIQUE : une contrainte d'implantation, pas une interdiction de droit.
 *
 * `risques.faisceauxHertziens` est MESURE — le connecteur des servitudes le renseigne depuis les
 * servitudes d'utilite publique du Geoportail de l'urbanisme — et n'etait exploite que par un critere
 * note. Or un aerogenerateur de plus de cent metres en travers d'un faisceau protege est en principe
 * incompatible : c'est plus qu'une penalite de quelques points.
 *
 * DEROGEABLE, et c'est la lecture juste : le faisceau se degage souvent en deplacant la machine, la ou
 * une protection forte ou un espace boise classe ne se contourne pas. La parcelle ressort donc en orange
 * avec alerte forte, et le motif dit ce qu'il faut verifier.
 */
const koEolFaisceauHertzien: RegleKo = (s) => {
  if (s.risques.faisceauxHertziens !== true) return null;
  return ko(
    'ko_eol_faisceau_hertzien',
    'Servitude radioélectrique',
    "La parcelle est grevée d'une servitude de protection d'un centre radioélectrique. Un aérogénérateur de plus de cent mètres en travers d'un faisceau protégé y est en principe incompatible. Un déplacement de machine peut suffire à dégager la liaison : la contrainte se juge sur un plan de masse, après consultation du gestionnaire du faisceau.",
    'risques',
    'eol_faisceaux_hertziens',
    true,
  );
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
    const déport = deportPossibleM(ctx.surfaceHa);
    return ko(
      'ko_metha_habitation_200',
      "Recul de 200 m impossible sur cette parcelle",
      `L'habitation la plus proche est à ${formatDistance(d)} du bord de la parcelle. Même en implantant l'unité au point le plus éloigné (déport maximal estimé ${formatDistance(déport)}), le recul de 200 m exige des installations soumises à enregistrement ou autorisation ne peut pas être atteint.`,
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
 * `type === 'immediat' || type === 'rapproche'`. Or le connecteur des servitudes écrit `type: null`, et
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
      'Périmètre de protection de captage',
      "La parcelle est dans un périmètre de protection d'un captage d'eau destinée à la consommation humaine. Le sous-périmètre — immédiat, rapproché ou éloigné — n'est pas publié par le Géoportail de l'urbanisme : il se lit sur l'arrêté de déclaration d'utilité publique du captage. En périmètre immédiat toute activité est interdite ; en périmètre rapproché l'arrêté fixe les interdictions, qui visent presque toujours le stockage d'effluents. A vérifier avant toute autre dépense.",
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
      'Périmètre de protection de captage',
      `La parcelle est dans le périmètre de protection ${c.type} d'un captage d'eau destinée à la consommation humaine, ou une installation de méthanisation est interdite.`,
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
      "Cours d'eau à moins de 35 m",
      `Le cours d'eau le plus proche est à ${formatDistance(d)}, en deçà du seuil réglementaire de 35 m applicable aux ouvrages de stockage et de traitement.`,
      'distances_reglementaires',
      'metha_distance_eau',
    );
  }
  return null;
};

// ---------------------------------------------------------------------------
// Composition par filiere
// ---------------------------------------------------------------------------

/**
 * ACCES POIDS LOURDS EN METHANISATION : le trafic est QUOTIDIEN, et c'est ce qui change tout.
 *
 * Le meme fait mesure — `acces.accesPoidsLourds` a `false` — n'a pas le même poids selon la filière.
 * Pour un stockage, les conteneurs arrivent une fois ; pour une unité de méthanisation, ce sont
 * plusieurs allers-retours de poids lourds CHAQUE JOUR pendant vingt ans. L'accès conditionne donc
 * l'autorisation ET l'acceptabilité locale, premier motif d'opposition des riverains sur cette filière.
 *
 * Le critère `acc_poids_lourds` pese deja 9 points au profil de la methanisation — le plus fort des
 * quatre filieres. Mais neuf points sur cent ne disent pas « inexploitable » : le knock-out le dit,
 * en restant derogeable puisqu'un acces se cree.
 */
const koMethaAccesEngins: RegleKo = (s) => {
  if (s.acces.accesPoidsLourds !== false) return null;
  return ko(
    'ko_metha_acces_engins',
    'Aucun accès poids lourds',
    `Aucun accès poids lourds n'a été identifié depuis le réseau routier${
      s.acces.distanceVoirieM != null ? ` (voirie la plus proche à ${formatDistance(s.acces.distanceVoirieM)})` : ''
    }. Une unité de méthanisation génère plusieurs allers-retours de poids lourds par jour pendant toute son exploitation : l'accès conditionne l'autorisation, la voie engins exigée par le SDIS, et l'acceptabilité par les riverains. Un accès peut être créé, mais son coût et son tracé doivent être établis avant tout engagement.`,
    'acces',
    'metha_acces_engins',
    true,
  );
};

// ---------------------------------------------------------------------------
// Stockage par batteries (BESS)
// ---------------------------------------------------------------------------

/**
 * LE PREMIER MOTIF ELIMINATOIRE PROPRE AU STOCKAGE.
 *
 * Mesure : `REGLES_KO` donnait `bess: [...COMMUNS]`. La filière n'avait AUCUN motif qui lui soit propre,
 * et ses trois règles réglementaires ne pouvaient donc jamais écarter une parcelle — elles n'existaient
 * qu'en rappel de procédure. Une batterie ne se distinguait d'une centrale solaire, du point de vue des
 * critères éliminatoires, par rien.
 *
 * L'accès des engins est le bon premier candidat, pour deux raisons. Il est PROPRE à la filière : les
 * conteneurs arrivent par semi-remorque et pesent des dizaines de tonnes, la ou des modules
 * photovoltaïques se manutentionnent autrement. Et il est MESURE : `acces.accesPoidsLourds` vient du
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
    'Aucun accès poids lourds',
    `Aucun accès poids lourds n'a été identifié depuis le réseau routier${
      s.acces.distanceVoirieM != null ? ` (voirie la plus proche à ${formatDistance(s.acces.distanceVoirieM)})` : ''
    }. Deux exigences s'y opposent : la livraison des conteneurs, qui arrivent par semi-remorque, et la voie engins que le SDIS exige pour l'intervention. Un accès peut être créé — élargissement, convention de passage, renforcement de chaussée — mais le coût et le délai doivent être chiffrés avant toute promesse au propriétaire.`,
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
 * dérogatoire en neutralisant une règle. Les routes acceptaient n'importe quelle chaine : un
 * identifiant mal orthographie — `ko_ppri_rouges` — était accepte sans bruit, et l'utilisateur croyait
 * explorer un scenario qui n'était pas applique. La liste ferme l'ensemble.
 *
 * Elle est vérifiée par un test qui relit les appels `ko(...)` de ce fichier : une regle ajoutee sans
 * etre inscrite ici, ou inscrite sans exister, fait echouer la construction. Une liste maintenue a la
 * main se perime — c'est ce qui est arrive au contrôle de contrat de l'audit 7.
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
  'ko_eol_faisceau_hertzien',
  'ko_eol_habitation_500',
  'ko_eol_mh_500',
  'ko_eol_radar',
  'ko_eol_servitude_aero',
  'ko_eol_site_classe',
  'ko_eol_zone_habitat_500',
  'ko_hors_document_cadre',
  'ko_metha_acces_engins',
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
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * AGRIVOLTAISME : LES COMMUNS, ET RIEN DE PLUS — c'est une decision, pas un oubli
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * DEUX KNOCK-OUTS DU SOLAIRE AU SOL SONT ECARTES, chacun pour une raison de fond :
   *
   *   - `koDocumentCadre` ne vaut que pour un terrain INCULTE, et le document-cadre departemental
   *     gouverne le REGIME B (« liste des terrains eligibles au photovoltaique au sol : non
   *     exploite depuis ≥ 10 ans »). Ce regime est precisement celui qui n'est PAS
   *     l'agrivoltaisme. L'appliquer ici emettrait un blocage tire d'un dispositif qui ne concerne
   *     pas la filiere — la forme la plus insidieuse de defaut, ou la donnee est juste et son
   *     application fausse.
   *
   *   - `koAopViticole` se fonde sur l'opposition de l'INAO a l'ARTIFICIALISATION des aires
   *     delimitees. Un projet agrivoltaique ne les artificialise pas : la vigne reste. Et le
   *     referentiel le confirme — sur les 52 contraintes d'agrivoltaisme, AUCUNE ne porte sur une
   *     AOP, alors que le solaire au sol en porte une.
   *
   * ET AUCUN KNOCK-OUT AGRONOMIQUE N'EST AJOUTE, alors que la filiere en aurait cinq candidats
   * evidents — activite agricole significative, service rendu, perte de rendement ≤ 10 %, zone
   * temoin, couverture ≤ 40 %. LE CLASSEUR LES CLASSE TOUTES LES HUIT EN VERIFICATION MANUELLE.
   * Aucune ne se lit sur une parcelle : elles portent sur le PROJET (son plan de masse, son suivi
   * agronomique, ses accords), pas sur le terrain.
   *
   * Le seul indice parcellaire disponible — « la parcelle est-elle exploitee ? » — vient de la
   * presence d'un ilot au RPG, et le connecteur ecrit lui-meme que l'absence d'ilot reste « a
   * confirmer ». En faire un knock-out ecarterait definitivement les parcelles d'un exploitant qui
   * ne declare pas. C'est `sol_type` qui porte cette information, gradue et commente, et c'est le
   * bon niveau de severite pour une donnee de cette qualite.
   */
  agrivoltaisme: [...COMMUNS],
  eolien_terrestre: [...COMMUNS, koDistanceHabitation500, koMonumentSiteClasse, koRadar, koEolFaisceauHertzien],
  bess: [...COMMUNS, koBessAccesEngins],
  methanisation: [...COMMUNS, koMethaHabitation200, koMethaCaptage, koMethaCoursEau, koMethaAccesEngins],
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
