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

const koProtectionForte: RegleKo = (s) => {
  const candidats: Array<[string, boolean | null, string]> = [
    ['coeur_parc_national', s.milieux.coeurParcNational.recouvre, "coeur de parc national"],
    ['reserve_naturelle', s.milieux.reserveNaturelle.recouvre, "reserve naturelle"],
    ['appb', s.milieux.appb.recouvre, "arrete prefectoral de protection de biotope"],
  ];
  for (const [suffixe, recouvre, libelle] of candidats) {
    if (recouvre === true) {
      return ko(
        `ko_${suffixe}`,
        'Zone de protection forte',
        `La parcelle est recouverte par une ${libelle}. Ces zonages interdisent en pratique tout amenagement de production d'energie.`,
        'environnement',
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
    );
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
    );
  }
  const er = s.urbanisme.prescriptions.find((p) => p.estEmplacementReserve);
  if (er) {
    return ko(
      'ko_emplacement_reserve',
      'Emplacement reserve',
      `La parcelle est grevee d'un emplacement reserve (${er.libelle ?? 'objet non precise'}) au benefice d'une collectivite : le foncier est destine a un autre usage.`,
      'urbanisme',
      null,
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
        null,
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
  if (!dc.departementCouvert) return null; // donnee non ingeree : ne pas ecarter a tort
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

const koDistanceHabitation500: RegleKo = (s, ctx) => {
  const d = s.bati.distanceHabitationM;
  if (d == null) return null;

  // Redhibitoire seulement si le seuil reste hors d'atteinte MEME en implantant
  // l'aerogenerateur au point le plus eloigne de la parcelle.
  const atteignable = distanceAtteignableM(d, ctx.surfaceHa);
  if (atteignable < 500) {
    // Le deport est recalcule pour le message : il est la grandeur que l'utilisateur doit voir
    // pour comprendre pourquoi la parcelle est ecartee malgre une distance de bord acceptable.
    const deport = deportPossibleM(ctx.surfaceHa);
    return ko(
      'ko_eol_habitation_500',
      "Recul de 500 m impossible sur cette parcelle",
      `L'habitation la plus proche est a ${formatDistance(d)} du bord de la parcelle. Meme en implantant l'aerogenerateur au point le plus eloigne (deport maximal estime ${formatDistance(deport)} pour ${ctx.surfaceHa?.toFixed(1) ?? '?'} ha), le recul de 500 m exige par l'article L.515-44 du code de l'environnement ne peut pas etre atteint.`,
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
      `La parcelle est en site classe${s.patrimoine.siteClasse.nom ? ` (${s.patrimoine.siteClasse.nom})` : ''}. Un parc eolien y est incompatible avec l'objectif de conservation du site.`,
      'patrimoine',
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
    return ko(
      'ko_eol_servitude_aero',
      'Servitude aeronautique',
      "La parcelle est grevee d'une servitude aeronautique de degagement : la hauteur des aerogenerateurs y est incompatible.",
      'risques',
      'eol_radar',
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

const koMethaCaptage: RegleKo = (s) => {
  const c = s.eau.captageAep;
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

const COMMUNS: RegleKo[] = [koProtectionForte, koZoneHumide, koPpriRouge, koZonageIncompatible, koPosteSature];

const REGLES_KO: Record<Filiere, RegleKo[]> = {
  solaire_sol: [...COMMUNS, koDocumentCadre, koAopViticole],
  eolien_terrestre: [...COMMUNS, koDistanceHabitation500, koMonumentSiteClasse, koRadar],
  bess: [...COMMUNS],
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
