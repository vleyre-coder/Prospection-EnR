/**
 * Evaluateurs de criteres ponderes.
 *
 * Chaque evaluateur transforme une (ou plusieurs) valeur brute du snapshot en note 0-100,
 * accompagnee de la valeur affichable, d'un commentaire explicatif et de la cle de source.
 *
 * Conventions :
 *   - retourner `null`                      -> critere NON APPLICABLE (exclu du calcul)
 *   - retourner `{ note: null, ... }`        -> donnee INDISPONIBLE (critere gris)
 */

import type { Filiere, OptionsScoring, ParcelleSnapshot, TypeSol } from '@enr/core';
import { FILIERES_META } from '@enr/core';
import {
  booleen,
  correspondance,
  formatBooleen,
  formatDistance,
  formatNombre,
  moyenne,
  moyenneTracee,
  paliers,
  pire,
  type Palier,
} from './notes.js';
import { SRC } from './sources.js';
import {
  COEFFICIENT_TRACE,
  deportPossibleM,
  lineaireRaccordementKm,
  surfaceUtileEstimee,
} from './implantation.js';

export interface ContexteEval {
  filiere: Filiere;
  options: OptionsScoring;
  /** Surface retenue pour la parcelle, en hectares (geometrie si dispo, sinon contenance). */
  surfaceHa: number | null;
}

export interface EvalBrute {
  note: number | null;
  valeurBrute: number | string | boolean | null;
  valeurAffichee: string;
  commentaire?: string | null;
  sourceKey?: string | null;
  reglesLiees?: string[];
  /**
   * Aucune SOURCE n'alimente ce critere sur ce territoire - a distinguer d'une donnee
   * manquante pour cette parcelle-ci.
   *
   * La difference est decisive pour la couverture. Un critere dont la source n'existe pas
   * manque a TOUTES les parcelles : le compter comme non renseigne fait chuter la couverture
   * de la meme quantite partout, ce qui ne discrimine rien et peut passer la filiere entiere
   * sous le seuil de grisement - c'est ce qui est arrive a la methanisation, rendue
   * integralement grise par 23,8 % de poids sans source.
   *
   * Un tel critere est donc EXCLU du denominateur de couverture, mais reste affiche en gris
   * et PLAFONNE le statut a orange : le classement redevient exploitable, sans qu'aucune
   * parcelle puisse etre declaree propice sur un enjeu qui n'a pas ete regarde.
   */
  sansSource?: boolean;
}

export type Evaluateur = (s: ParcelleSnapshot, ctx: ContexteEval) => EvalBrute | null;

const INDISPO = 'donnee indisponible';

function indispo(sourceKey?: string, commentaire?: string): EvalBrute {
  return {
    note: null,
    valeurBrute: null,
    valeurAffichee: INDISPO,
    commentaire: commentaire ?? "Aucune donnee exploitable pour ce critere : l'absence de donnee ne vaut pas absence de contrainte.",
    sourceKey: sourceKey ?? null,
  };
}

// ---------------------------------------------------------------------------
// Raccordement
// ---------------------------------------------------------------------------

/**
 * Courbes de distance au poste source, EN KILOMETRES DE TRACE.
 *
 * Ces paliers etaient a l'origine cales sur des distances a vol d'oiseau. Quand le critere
 * est passe a la notation du lineaire estime (vol d'oiseau majore de 35 %), les abscisses
 * n'ont pas suivi : chaque parcelle recevait donc la note d'une distance 35 % plus grande
 * que celle sur laquelle la courbe avait ete calee — une penalite double, invisible parce
 * qu'elle deforme le classement sans produire d'erreur apparente.
 *
 * Les abscisses sont donc multipliees par COEFFICIENT_TRACE. A parcelle identique, la note
 * redevient celle de la calibration d'origine, mais la courbe exprime desormais la
 * grandeur qu'elle note reellement.
 *
 * RESERVE, a lever avant tout usage decisionnel du classement : la calibration ABSOLUE
 * (ou placer 72/100 plutot que 60/100) n'est etablie sur aucun devis de raccordement reel.
 * Elle traduit une hierarchie plausible entre filieres — le stockage est bien plus
 * sensible au lineaire que l'eolien — pas un cout constate. Cf. docs/CALIBRATION.md.
 */
export const COURBE_DISTANCE_POSTE: Record<Filiere, readonly Palier[]> = {
  bess: [
    [0, 100],
    [1.35, 95],
    [2.7, 80],
    [6.75, 50],
    [10.8, 25],
    [16.2, 5],
    [27, 0],
  ],
  solaire_sol: [
    [0, 100],
    [2.7, 92],
    [6.75, 72],
    [10.8, 52],
    [16.2, 28],
    [27, 5],
    [40.5, 0],
  ],
  eolien_terrestre: [
    [0, 100],
    [4.05, 90],
    [10.8, 70],
    [20.25, 45],
    [33.75, 20],
    [54, 0],
  ],
  methanisation: [
    [0, 100],
    [4.05, 85],
    [10.8, 60],
    [20.25, 30],
    [33.75, 5],
    [54, 0],
  ],
};

const racc_distance_poste: Evaluateur = (s, ctx) => {
  const poste = s.raccordement.posteLePlusProche;
  if (!poste) return indispo(SRC.postes);

  // La note porte sur le LINEAIRE estime, pas sur la distance a vol d'oiseau : c'est le
  // lineaire qui se paie. Les abscisses de COURBE_DISTANCE_POSTE sont exprimees dans la
  // meme unite (cf. son commentaire), sans quoi la majoration se paierait deux fois.
  const lineaire = lineaireRaccordementKm(poste.distanceKm);
  const note = paliers(lineaire, COURBE_DISTANCE_POSTE[ctx.filiere]);

  return {
    note,
    valeurBrute: poste.distanceKm,
    valeurAffichee:
      `${formatNombre(lineaire, 'km')} de trace estime ` +
      `(${formatNombre(poste.distanceKm, 'km')} a vol d'oiseau) - ${poste.nom} (${poste.gestionnaire})`,
    commentaire:
      `Le lineaire est estime en majorant la distance a vol d'oiseau de ${Math.round((COEFFICIENT_TRACE - 1) * 100)} % : ` +
      `une liaison suit les emprises publiques et contourne le bati. ` +
      (lineaire > 10
        ? "A ce lineaire, le cout de la liaison risque de dominer le budget du projet."
        : "Lineaire compatible avec un raccordement economiquement raisonnable, sous reserve de l'etude du gestionnaire."),
    sourceKey: SRC.postes,
  };
};

const racc_capacite_residuelle: Evaluateur = (s, ctx) => {
  const poste = s.raccordement.posteLePlusProche;
  if (!poste) return indispo(SRC.postes);
  if (poste.capaciteResiduelleMw == null && poste.etatSaturation == null) return indispo(SRC.postes);

  // Un renforcement programme rattrape partiellement un poste sature.
  const renfort = poste.renforcement.prevu === true;
  const parEtat = correspondance(poste.etatSaturation, {
    disponible: 100,
    tendu: 55,
    sature: renfort ? 30 : 5,
  });
  const besoinMw = ctx.filiere === 'bess' ? 20 : ctx.filiere === 'eolien_terrestre' ? 20 : 10;
  const parCapacite =
    poste.capaciteResiduelleMw == null
      ? null
      : paliers(poste.capaciteResiduelleMw / besoinMw, [
          [0, renfort ? 30 : 5],
          [0.5, 45],
          [1, 70],
          [2, 90],
          [4, 100],
        ]);

  const note = parEtat != null && parCapacite != null ? pire(parEtat, parCapacite) : (parEtat ?? parCapacite);
  const morceaux: string[] = [];
  if (poste.capaciteResiduelleMw != null) morceaux.push(`${formatNombre(poste.capaciteResiduelleMw, 'MW')} residuels`);
  if (poste.etatSaturation) morceaux.push(poste.etatSaturation);
  if (poste.fileAttenteMw != null) morceaux.push(`file d'attente ${formatNombre(poste.fileAttenteMw, 'MW')}`);
  if (renfort) morceaux.push(`renforcement ${poste.renforcement.horizon ?? 'programme'}`);

  return {
    note,
    valeurBrute: poste.capaciteResiduelleMw,
    valeurAffichee: morceaux.join(' - ') || INDISPO,
    commentaire: renfort
      ? "Un renforcement est inscrit au S3REnR : le poste peut redevenir interessant a l'horizon de developpement du projet."
      : "Capacite issue de Capareseau : indicative, non engageante et evolutive au fil des demandes de raccordement.",
    sourceKey: SRC.postes,
  };
};

const racc_quote_part: Evaluateur = (s) => {
  const q = s.raccordement.posteLePlusProche?.quotePartEurParKw;
  if (q == null) return indispo(SRC.postes);
  return {
    note: paliers(q, [
      [0, 100],
      [30, 85],
      [60, 65],
      [100, 40],
      [150, 15],
      [250, 0],
    ]),
    valeurBrute: q,
    valeurAffichee: `${formatNombre(q, 'EUR/kW', 0)}`,
    commentaire: "Quote-part du schema regional de raccordement, a integrer au budget de raccordement.",
    sourceKey: SRC.postes,
  };
};

const racc_distance_reseau_gaz: Evaluateur = (s) => {
  const d = s.raccordement.reseauGaz.distanceKm;
  if (d == null) return indispo(SRC.gaz);
  const base = paliers(d, [
    [0, 100],
    [1, 95],
    [3, 78],
    [5, 60],
    [8, 38],
    [12, 15],
    [20, 0],
  ]);
  const note =
    s.raccordement.reseauGaz.reboursNecessaire === true && base != null ? Math.max(0, base - 20) : base;
  return {
    note,
    valeurBrute: d,
    valeurAffichee: `${formatNombre(d, 'km')}${s.raccordement.reseauGaz.gestionnaire ? ` - ${s.raccordement.reseauGaz.gestionnaire}` : ''}${s.raccordement.reseauGaz.reboursNecessaire === true ? ' (rebours necessaire)' : ''}`,
    commentaire:
      d > 8
        ? "Au-dela de 8 km, l'injection devient difficile a financer meme avec le droit a l'injection : etudier la cogeneration."
        : "Distance compatible avec une injection, sous reserve de la capacite du reseau et du zonage de raccordement.",
    sourceKey: SRC.gaz,
    reglesLiees: ['metha_injection'],
  };
};

// ---------------------------------------------------------------------------
// Gisement
// ---------------------------------------------------------------------------

const gis_irradiation: Evaluateur = (s) => {
  const v = s.gisement.irradiationKwhM2An;
  if (v == null) return indispo(SRC.gisement);
  return {
    note: paliers(v, [
      [1000, 10],
      [1150, 35],
      [1300, 60],
      [1450, 80],
      [1600, 95],
      [1800, 100],
    ]),
    valeurBrute: v,
    valeurAffichee: formatNombre(v, 'kWh/m2/an', 0),
    commentaire:
      "Irradiation globale horizontale. L'ecart nord-sud en France metropolitaine represente environ 40 % de productible.",
    sourceKey: SRC.gisement,
  };
};

const gis_vent: Evaluateur = (s) => {
  const v = s.gisement.ventVitesse100mMs;
  if (v == null) return indispo(SRC.gisement);
  return {
    note: paliers(v, [
      [4, 0],
      [5, 20],
      [5.5, 40],
      [6, 60],
      [6.5, 78],
      [7, 90],
      [8, 100],
    ]),
    valeurBrute: v,
    valeurAffichee: formatNombre(v, 'm/s a 100 m'),
    commentaire:
      "En dessous de 5,5 m/s, la rentabilite d'un parc devient difficile a etablir hors contexte tarifaire favorable. A confirmer par une campagne de mesure.",
    sourceKey: SRC.gisement,
  };
};

/**
 * Marque un critere dont la source n'est pas ingeree sur ce territoire.
 * Le libelle affiche dit explicitement ce qui manque et ou le chercher.
 */
function sansSource(sourceKey: string, quoi: string, ou: string): EvalBrute {
  return {
    note: null,
    valeurBrute: null,
    valeurAffichee: 'non evalue - aucune source ingeree',
    commentaire: `${quoi} n'est alimente par aucune couche ingeree sur ce territoire. Ce n'est pas une absence constatee sur le terrain : l'enjeu n'a pas ete regarde. ${ou}`,
    sourceKey,
    sansSource: true,
  };
}

const gis_intrants: Evaluateur = (s) => {
  if (s.gisement.sourcesIntrantsIngerees === false) {
    return sansSource(
      SRC.gisement,
      "Le gisement d'intrants methanisables",
      'A etablir par un recensement des elevages, des industries agroalimentaires et des surfaces de CIVE dans un rayon de 15 km, puis par des lettres d’intention d’apporteurs.',
    );
  }
  const v = s.gisement.intrantsMethaTonnesMsAn;
  if (v == null) return indispo(SRC.gisement);
  const details: string[] = [formatNombre(v, 't MS/an', 0)];
  if (s.gisement.elevagesRayon10km != null) details.push(`${s.gisement.elevagesRayon10km} elevages < 10 km`);
  if (s.gisement.iaaRayon20km != null) details.push(`${s.gisement.iaaRayon20km} IAA < 20 km`);
  return {
    note: paliers(v, [
      [0, 0],
      [2000, 20],
      [5000, 45],
      [10000, 70],
      [18000, 88],
      [30000, 100],
    ]),
    valeurBrute: v,
    valeurAffichee: details.join(' - '),
    commentaire:
      "Estimation du gisement mobilisable dans un rayon de 15 km, a partir du RPG, du cheptel et des industries agroalimentaires. A confirmer par des lettres d'intention d'apporteurs.",
    sourceKey: SRC.gisement,
  };
};

const gis_debouche_epandage: Evaluateur = (s) => {
  if (s.gisement.sourcesIntrantsIngerees === false) {
    return sansSource(
      SRC.gisement,
      "Le debouche du digestat",
      'A etablir par un plan d’epandage, ou par une filiere de sortie du statut de dechet (digestat norme).',
    );
  }
  const v = s.gisement.surfacesEpandageHa;
  if (v == null) return indispo(SRC.gisement);
  return {
    note: paliers(v, [
      [0, 0],
      [200, 30],
      [500, 55],
      [1000, 78],
      [2000, 95],
      [4000, 100],
    ]),
    valeurBrute: v,
    valeurAffichee: formatNombre(v, 'ha', 0),
    commentaire:
      "Surfaces agricoles mobilisables pour l'epandage du digestat dans un rayon de 10 km. Alternative : sortie du statut de dechet (digestat normé).",
    sourceKey: SRC.gisement,
    reglesLiees: ['metha_plan_epandage'],
  };
};

// ---------------------------------------------------------------------------
// Urbanisme
// ---------------------------------------------------------------------------

/**
 * Compatibilite du zonage. Les regles reelles dependent du reglement ecrit de chaque PLU,
 * que l'application ne sait pas lire automatiquement : la note traduit une probabilite de
 * compatibilite, et le lien vers le reglement est systematiquement fourni.
 */
function noteZonage(typeZone: string | null, filiere: Filiere): number | null {
  if (!typeZone) return null;
  const t = typeZone.toUpperCase();
  const zoneActivite = /^(U|AUC|AUS|1AU|2AU)/.test(t) && /X|E|I|Y|Z/.test(t.slice(1));
  if (filiere === 'bess') {
    if (zoneActivite) return 100;
    if (t.startsWith('U')) return 80;
    if (t.startsWith('AU')) return 65;
    if (t.startsWith('A')) return 35;
    if (t.startsWith('N')) return 25;
    return 40;
  }
  if (filiere === 'methanisation') {
    if (zoneActivite) return 90;
    if (t.startsWith('A')) return 75; // installation liee a l'activite agricole
    if (t.startsWith('U')) return 60;
    if (t.startsWith('AU')) return 55;
    if (t.startsWith('N')) return 25;
    return 40;
  }
  if (filiere === 'eolien_terrestre') {
    if (t.startsWith('A')) return 75;
    if (t.startsWith('N')) return 45;
    if (t.startsWith('U') || t.startsWith('AU')) return 25;
    return 40;
  }
  // solaire au sol
  if (zoneActivite) return 85;
  if (t.startsWith('A')) return 55;
  if (t.startsWith('N')) return 25;
  if (t.startsWith('U')) return 70;
  if (t.startsWith('AU')) return 50;
  return 40;
}

const urb_zonage: Evaluateur = (s, ctx) => {
  if (s.urbanisme.couvertParGpu === false) {
    return {
      note: 45,
      valeurBrute: 'RNU',
      valeurAffichee: "Aucun document d'urbanisme publie (RNU probable)",
      commentaire:
        "En l'absence de PLU, le reglement national d'urbanisme s'applique : le principe de constructibilite limitee rend l'instruction plus incertaine. A verifier en mairie et en DDT.",
      sourceKey: SRC.gpu,
    };
  }
  const zonages = s.urbanisme.zonages;
  if (zonages.length === 0) return indispo(SRC.gpu);

  // Le zonage dominant gouverne, mais un zonage secondaire tres defavorable penalise.
  const dominant = [...zonages].sort((a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0))[0]!;
  const notes = zonages.map((z) => noteZonage(z.typeZone ?? z.libelle, ctx.filiere));
  const note = moyenne(noteZonage(dominant.typeZone ?? dominant.libelle, ctx.filiere), pire(...notes));

  const libelles = zonages.map((z) => z.libelle ?? z.typeZone ?? '?').join(', ');

  /**
   * Le classement par part de recouvrement suppose que cette part est connue.
   *
   * Quand elle ne l'est pas — echec du calcul d'intersection — le tri ne discrimine rien et
   * le « dominant » n'est que le premier element dans l'ordre de reponse du service. Or ce
   * zonage gouverne un knock-out : le presenter comme dominant sans reserve serait affirmer
   * un fait tire de l'ordre d'un tableau. Le cas est benin sur une parcelle mono-zone, et
   * determinant sur une parcelle a cheval sur deux zonages.
   */
  const partInconnue = zonages.length > 1 && zonages.every((z) => z.partRecouvrement == null);

  return {
    note,
    valeurBrute: dominant.typeZone ?? dominant.libelle,
    valeurAffichee:
      `Zone ${libelles}${s.urbanisme.typeDocument ? ` (${s.urbanisme.typeDocument})` : ''}` +
      (partInconnue ? ' - zonage dominant indetermine' : ''),
    commentaire:
      "La compatibilite reelle depend du reglement ecrit de la zone, que l'application ne lit pas automatiquement. Consultez le reglement lie avant tout demarchage." +
      (partInconnue
        ? ` La part de la parcelle couverte par chacun des ${zonages.length} zonages n'a pas pu etre` +
          " calculee : celui retenu comme dominant l'est par l'ordre de reponse du service, pas par" +
          ' sa surface. A verifier au reglement graphique avant toute conclusion.'
        : ''),
    sourceKey: SRC.gpu,
  };
};

const urb_zaer: Evaluateur = (s, ctx) => {
  const z = s.urbanisme.zaer;
  if (z.present == null) return indispo(SRC.zaer, "Aucune ZAER ingeree pour ce territoire : couverture nationale encore partielle.");
  if (!z.present) {
    return {
      note: 45,
      valeurBrute: false,
      valeurAffichee: "Hors zone d'acceleration",
      commentaire:
        "L'absence de ZAER n'est pas bloquante mais prive le projet du portage politique local et de l'instruction allegee.",
      sourceKey: SRC.zaer,
    };
  }
  const pourFiliere = z.filieres.includes(ctx.filiere);
  return {
    note: pourFiliere ? 100 : 60,
    valeurBrute: true,
    valeurAffichee: pourFiliere
      ? `En ZAER pour ${FILIERES_META[ctx.filiere].libelleCourt}`
      : `En ZAER, mais pour d'autres filieres (${z.filieres.join(', ') || 'non precisees'})`,
    commentaire: pourFiliere
      ? "Inscription en zone d'acceleration pour la filiere : signal politique favorable."
      : "La parcelle est en ZAER mais pas pour cette filiere : verifier la deliberation.",
    sourceKey: SRC.zaer,
  };
};

// ---------------------------------------------------------------------------
// Sol
// ---------------------------------------------------------------------------

const NOTES_TYPE_SOL: Record<Filiere, Record<TypeSol, number>> = {
  solaire_sol: {
    artificialise: 100,
    degrade: 100,
    inculte: 75,
    agricole_exploite: 45,
    naturel_forestier: 10,
  },
  bess: {
    artificialise: 100,
    degrade: 95,
    inculte: 60,
    agricole_exploite: 35,
    naturel_forestier: 10,
  },
  methanisation: {
    artificialise: 90,
    degrade: 85,
    inculte: 70,
    agricole_exploite: 65,
    naturel_forestier: 15,
  },
  eolien_terrestre: {
    artificialise: 70,
    degrade: 80,
    inculte: 85,
    agricole_exploite: 80,
    naturel_forestier: 30,
  },
};

const LIBELLES_TYPE_SOL: Record<TypeSol, string> = {
  artificialise: 'Terrain artificialise',
  degrade: 'Terrain degrade (ancienne carriere, friche, decharge...)',
  inculte: 'Terrain inculte ou non exploite',
  agricole_exploite: 'Terrain agricole exploite',
  naturel_forestier: 'Espace naturel ou forestier',
};

const sol_type: Evaluateur = (s, ctx) => {
  const t = s.occupationSol.typeSol;
  if (t == null) return indispo(SRC.rpg);
  const note = NOTES_TYPE_SOL[ctx.filiere][t];
  const regles: string[] = [];
  if (ctx.filiere === 'solaire_sol') {
    if (t === 'inculte') regles.push('pv_document_cadre', 'pv_date_inculte');
    if (t === 'agricole_exploite') regles.push('agri_taux_couverture', 'agri_avis_cdpenaf');
  }
  return {
    note,
    valeurBrute: t,
    valeurAffichee: LIBELLES_TYPE_SOL[t],
    commentaire:
      t === 'inculte'
        ? "Le caractere inculte ou non exploite depuis le 10 mars 2013 doit etre demontre (historique RPG, photo-interpretation) et la parcelle doit figurer au document-cadre departemental."
        : t === 'agricole_exploite'
          ? "Terrain agricole exploite : le projet doit etre concu en agrivoltaisme, avec maintien d'une production agricole significative."
          : t === 'naturel_forestier'
            ? "Espace naturel ou forestier : defrichement, compensation et forte opposition previsibles."
            : "Terrain deja anthropise : configuration la plus favorable, sans conflit d'usage agricole.",
    sourceKey: SRC.rpg,
    reglesLiees: regles,
  };
};

/** Aptitude des groupes de culture RPG a l'agrivoltaisme. */
const NOTES_GROUPE_CULTURE: Record<string, number> = {
  '17': 95, // Estives et landes
  '18': 95, // Prairies permanentes
  '19': 90, // Prairies temporaires
  '11': 85, // Gel (surfaces sans production)
  '25': 80, // Legumes ou fleurs
  '20': 70, // Vergers
  '27': 70, // Arboriculture
  '22': 65, // Fruits a coque
  '23': 60, // Oliviers
  '16': 75, // Fourrage
  '15': 55, // Legumineuses a grains
  '8': 50, // Proteagineux
  '1': 45, // Ble tendre
  '3': 45, // Orge
  '4': 45, // Autres cereales
  '5': 40, // Colza
  '6': 40, // Tournesol
  '7': 40, // Autres oleagineux
  '2': 35, // Mais grain et ensilage
  '9': 40, // Plantes a fibres
  '10': 45, // Semences
  '14': 30, // Riz
  '24': 45, // Autres cultures industrielles
  '26': 30, // Canne a sucre
  '21': 5, // Vignes
  '28': 50, // Divers
};

const sol_culture_compatible: Evaluateur = (s, ctx) => {
  if (ctx.filiere !== 'solaire_sol') return null;
  if (s.occupationSol.typeSol && s.occupationSol.typeSol !== 'agricole_exploite') {
    return {
      note: 100,
      valeurBrute: 'non_agricole',
      valeurAffichee: 'Sans objet (terrain non exploite en agriculture)',
      commentaire: "Le critere ne s'applique qu'aux projets agrivoltaiques sur parcelle exploitee.",
      sourceKey: SRC.rpg,
    };
  }
  const groupe = s.occupationSol.rpg.codeGroupeCulture;
  if (!groupe) return indispo(SRC.rpg);
  const note = NOTES_GROUPE_CULTURE[groupe] ?? 50;
  return {
    note,
    valeurBrute: s.occupationSol.rpg.codeCulture ?? groupe,
    // `||` et non `??` : le RPG renvoie parfois un libelle vide plutot qu'absent, ce qui
    // produirait une valeur affichee reduite au seul millesime.
    valeurAffichee: `${s.occupationSol.rpg.libelleCulture || s.occupationSol.rpg.libelleGroupeCulture || `groupe de culture ${groupe}`}${s.occupationSol.rpg.millesime ? ` (RPG ${s.occupationSol.rpg.millesime})` : ''}`,
    commentaire:
      groupe === '21'
        ? "Vigne : implantation photovoltaique en principe exclue, a fortiori en aire parcellaire AOP."
        : note >= 80
          ? "Culture bien adaptee a l'agrivoltaisme : synergie elevage/ombrage documentee."
          : "Culture mecanisee : l'agrivoltaisme impose des inter-rangs larges et une hauteur importante, ce qui degrade l'economie du projet.",
    sourceKey: SRC.rpg,
    reglesLiees: ['agri_taux_couverture', 'agri_zone_temoin'],
  };
};

const sol_potentiel_agronomique: Evaluateur = (s) => {
  const p = s.occupationSol.potentielAgronomique;
  if (p == null) return indispo(SRC.rpg);
  // Critere inverse : un excellent sol agricole penalise le projet (conflit d'usage).
  return {
    note: paliers(p, [
      [0, 100],
      [30, 85],
      [50, 65],
      [70, 40],
      [90, 15],
      [100, 5],
    ]),
    valeurBrute: p,
    valeurAffichee: `Indice estime ${formatNombre(p, '', 0)}/100 (proxy RPG)`,
    commentaire:
      "Critere inverse : plus le potentiel agronomique est eleve, plus le conflit d'usage et " +
      "l'opposition de la profession agricole sont probables. ATTENTION : cet indice n'est pas " +
      "une mesure de la qualite du sol. Il est DEDUIT du groupe de culture declare au RPG, qui " +
      "reflete autant le choix de l'exploitant que l'aptitude du terrain. La qualite reelle " +
      "releve des bases regionales IGCS, sans API nationale.",
    sourceKey: SRC.rpg,
  };
};

const sol_foret: Evaluateur = (s) => {
  const f = s.occupationSol.foret;
  if (f.recouvre == null && f.partBoisee == null) return indispo(SRC.bdforet);
  const part = f.partBoisee ?? (f.recouvre ? 1 : 0);
  return {
    note: paliers(part, [
      [0, 100],
      [0.05, 90],
      [0.2, 60],
      [0.5, 25],
      [0.8, 8],
      [1, 0],
    ]),
    valeurBrute: part,
    valeurAffichee:
      part === 0 ? 'Aucun boisement' : `${Math.round(part * 100)} % boise${f.type ? ` (${f.type})` : ''}`,
    commentaire:
      part > 0
        ? "Un defrichement declenche une autorisation, une compensation (souvent 1 a 5 fois la surface) et une forte sensibilite locale."
        : "Aucun enjeu de defrichement identifie.",
    sourceKey: SRC.bdforet,
  };
};

// ---------------------------------------------------------------------------
// Topographie
// ---------------------------------------------------------------------------

export const COURBE_PENTE: Record<Filiere, readonly Palier[]> = {
  solaire_sol: [
    [0, 100],
    [3, 98],
    [7, 85],
    [10, 65],
    [15, 35],
    [20, 12],
    [30, 0],
  ],
  bess: [
    [0, 100],
    [2, 95],
    [4, 80],
    [7, 50],
    [10, 25],
    [15, 0],
  ],
  methanisation: [
    [0, 100],
    [2, 95],
    [5, 78],
    [8, 50],
    [12, 20],
    [18, 0],
  ],
  eolien_terrestre: [
    [0, 100],
    [5, 95],
    [10, 85],
    [15, 65],
    [22, 40],
    [30, 15],
    [40, 0],
  ],
};

const topo_pente: Evaluateur = (s, ctx) => {
  const p = s.topographie.pentePct;
  if (p == null) return indispo(SRC.alti);

  /**
   * Deux estimateurs possibles derriere ce nombre, et la distinction compte.
   *
   * La regression du plan des altitudes donne une pente MOYENNE. Quand le semis de points
   * degenere — parcelle en laniere, altimetrie partielle — elle est ecartee au profit de la
   * mesure par paires, qui retient la plus FORTE pente locale et majore donc la moyenne. Le
   * dire evite qu'une parcelle prudemment estimee soit ecartee comme si elle etait mesuree.
   *
   * Le max n'est affiche que s'il differe de la valeur retenue : quand la pente vient deja des
   * paires, les deux nombres sont identiques et les repeter n'informe personne.
   */
  const parPaires = s.topographie.penteEstimeeParPaires === true;
  const max = s.topographie.penteMaxPct;
  const afficheMax = max != null && !parPaires;

  return {
    note: paliers(p, COURBE_PENTE[ctx.filiere]),
    valeurBrute: p,
    valeurAffichee:
      `${formatNombre(p, '%')}` +
      (afficheMax ? ` (max ${formatNombre(max, '%')})` : '') +
      (parPaires ? ' (estimation majorante)' : ''),
    commentaire:
      (p > 12
        ? "Pente forte : surcouts de terrassement, contraintes d'acces engins et, pour le solaire, auto-ombrage."
        : 'Pente compatible avec une implantation standard.') +
      (parPaires
        ? " La regression du plan des altitudes n'etait pas exploitable sur cette parcelle (semis" +
          ' de points trop aligne) : la valeur retenue est la plus forte pente locale mesuree' +
          ' entre points distants, qui majore la pente moyenne reelle.'
        : ''),
    sourceKey: SRC.alti,
  };
};

const topo_orientation: Evaluateur = (s, ctx) => {
  if (ctx.filiere !== 'solaire_sol') return null;
  const o = s.topographie.orientationDeg;
  const pente = s.topographie.pentePct;
  if (o == null) return indispo(SRC.alti);
  // Sur terrain quasi plat, l'orientation du terrain naturel est sans effet.
  if (pente != null && pente < 3) {
    return {
      note: 95,
      valeurBrute: o,
      valeurAffichee: 'Terrain quasi plat : orientation sans incidence',
      commentaire: "Sur une pente inferieure a 3 %, les structures fixent librement l'azimut des modules.",
      sourceKey: SRC.alti,
    };
  }
  // 180 deg = plein sud = optimal ; 0/360 = nord = defavorable.
  const ecartAuSud = Math.abs(180 - ((o % 360) + 360) % 360);
  const note = paliers(ecartAuSud, [
    [0, 100],
    [45, 88],
    [75, 68],
    [100, 45],
    [135, 20],
    [180, 5],
  ]);
  const rose = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  const secteur = rose[Math.round((((o % 360) + 360) % 360) / 45) % 8]!;
  return {
    note,
    valeurBrute: o,
    valeurAffichee: `${secteur} (${Math.round(o)} deg)`,
    commentaire:
      ecartAuSud > 100
        ? "Versant oriente au nord : perte de productible significative sur terrain pentu."
        : "Orientation favorable au productible.",
    sourceKey: SRC.alti,
  };
};

const topo_planeite: Evaluateur = (s) => {
  const d = s.topographie.deniveleM;
  if (d == null) return indispo(SRC.alti);
  return {
    note: paliers(d, [
      [0, 100],
      [2, 95],
      [5, 82],
      [10, 60],
      [20, 30],
      [40, 5],
      [60, 0],
    ]),
    valeurBrute: d,
    valeurAffichee: `${formatNombre(d, 'm de denivele', 0)}`,
    commentaire: "Le denivele total conditionne le volume de terrassement necessaire pour obtenir une plateforme.",
    sourceKey: SRC.alti,
  };
};

const topo_altitude: Evaluateur = (s) => {
  const a = s.topographie.altitudeM;
  if (a == null) return indispo(SRC.alti);
  return {
    note: paliers(a, [
      [0, 95],
      [200, 100],
      [600, 90],
      [900, 70],
      [1200, 45],
      [1600, 15],
      [2000, 0],
    ]),
    valeurBrute: a,
    valeurAffichee: formatNombre(a, 'm', 0),
    commentaire:
      a > 900
        ? "Altitude elevee : givre, turbulence, acces hivernal et couts de chantier majores."
        : "Altitude sans contrainte particuliere.",
    sourceKey: SRC.alti,
  };
};

// ---------------------------------------------------------------------------
// Surface et parcellaire
// ---------------------------------------------------------------------------

const surf_utile: Evaluateur = (s, ctx) => {
  const brute = ctx.surfaceHa;
  if (brute == null) return indispo(SRC.cadastre);

  // La note porte sur la surface reellement IMPLANTABLE, pas sur la surface cadastrale :
  // reculs, piste peripherique et acces des secours en retirent couramment 15 a 30 %.
  const utile = surfaceUtileEstimee(brute, s.foncier.morcellementIndice, ctx.filiere);
  const ha = utile?.netteHa ?? brute;
  const meta = FILIERES_META[ctx.filiere];
  const min = meta.surfaceUtileMinHa;
  const opt = meta.surfaceUtileOptimaleHa;

  // Pour le BESS, une parcelle beaucoup trop grande n'apporte rien et coute cher a maitriser.
  const courbe: Palier[] =
    ctx.filiere === 'bess'
      ? [
          [0, 0],
          [min * 0.6, 25],
          [min, 65],
          [opt * 0.6, 95],
          [opt, 100],
          [opt * 3, 80],
          [opt * 8, 55],
        ]
      : [
          [0, 0],
          [min * 0.5, 15],
          [min, 45],
          [opt * 0.4, 75],
          [opt, 95],
          [opt * 2.5, 100],
        ];

  const deduction =
    utile && utile.coefficient < 0.995
      ? ` (${formatNombre(brute, 'ha', 2)} au cadastre, soit ${Math.round((1 - utile.coefficient) * 100)} % deduits)`
      : '';

  return {
    note: paliers(ha, courbe),
    valeurBrute: ha,
    valeurAffichee: `${formatNombre(ha, 'ha', 2)} implantables${deduction}`,
    commentaire:
      `${utile?.detail ?? ''} Seuil economique indicatif pour la filiere : ` +
      `${formatNombre(min, 'ha', 1)} minimum, ${formatNombre(opt, 'ha', 0)} pour une pleine ` +
      `competitivite. Ces seuils sont economiques, non reglementaires.`,
    sourceKey: SRC.cadastre,
  };
};

const surf_un_seul_tenant: Evaluateur = (s, ctx) => {
  const bloc = s.foncier.surfaceDunSeulTenantHa;
  if (bloc == null) return indispo(SRC.foncier);
  const meta = FILIERES_META[ctx.filiere];
  return {
    note: paliers(bloc, [
      [0, 0],
      [meta.surfaceUtileMinHa, 40],
      [meta.surfaceUtileOptimaleHa * 0.5, 70],
      [meta.surfaceUtileOptimaleHa, 92],
      [meta.surfaceUtileOptimaleHa * 2, 100],
    ]),
    valeurBrute: bloc,
    valeurAffichee: `${formatNombre(bloc, 'ha', 2)} d'un seul tenant`,
    commentaire:
      "Un bloc continu evite les servitudes de passage et simplifie fortement la maitrise fonciere et le cablage interne.",
    sourceKey: SRC.foncier,
  };
};

const surf_compacite: Evaluateur = (s) => {
  const i = s.foncier.morcellementIndice;
  if (i == null) return indispo(SRC.cadastre);
  return {
    note: paliers(i, [
      [0, 100],
      [25, 85],
      [50, 60],
      [75, 30],
      [100, 5],
    ]),
    valeurBrute: i,
    valeurAffichee: `Indice de morcellement ${formatNombre(i, '', 0)}/100`,
    commentaire:
      "Les parcelles en lanieres ou tres decoupees augmentent les lineaires de clotures et de cablage, et compliquent l'implantation.",
    sourceKey: SRC.cadastre,
  };
};

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

/**
 * Note de proximite d'un zonage naturel. Le recouvrement est traite par les knock-outs
 * lorsqu'il s'agit d'une protection forte ; ici on note la PROXIMITE (effet sur l'instruction).
 */
/**
 * Rayon dans lequel les zonages naturels sont recherches (aligne sur le connecteur).
 * Au-dela, l'application ne sait rien : elle ne conclut donc pas a l'absence, elle constate
 * qu'aucun site n'a ete trouve DANS ce rayon.
 */
const RAYON_ANALYSE_ZONAGES_M = 10000;

function noteProximiteZonage(
  z: { recouvre: boolean | null; distanceM: number | null; partRecouvrement: number | null },
  courbe: readonly Palier[],
): number | null {
  if (z.recouvre === true) return 5;
  // `recouvre === false` avec une distance inconnue signifie que la recherche dans le rayon
  // d'analyse n'a rien renvoye. La note reste volontairement en deça du maximum : le rayon
  // est fini, et un zonage situe juste au-dela n'aurait pas ete vu.
  if (z.distanceM == null) return z.recouvre === false ? 90 : null;
  return paliers(z.distanceM, courbe);
}

const COURBE_NATURA: readonly Palier[] = [
  [0, 10],
  [300, 30],
  [1000, 55],
  [2000, 75],
  [5000, 92],
  [10000, 100],
];

const env_proximite_natura2000: Evaluateur = (s) => {
  const h = s.milieux.natura2000Habitats;
  const o = s.milieux.natura2000Oiseaux;
  const note = pire(noteProximiteZonage(h, COURBE_NATURA), noteProximiteZonage(o, COURBE_NATURA));
  if (note == null) return indispo(SRC.nature);
  const plusProche = [h, o]
    .filter((z) => z.distanceM != null || z.recouvre)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))[0];
  return {
    note,
    valeurBrute: plusProche?.distanceM ?? null,
    valeurAffichee:
      h.recouvre || o.recouvre
        ? `Recouvrement Natura 2000${plusProche?.nom ? ` - ${plusProche.nom}` : ''}`
        : plusProche?.distanceM != null
          ? `${formatDistance(plusProche.distanceM)}${plusProche.nom ? ` - ${plusProche.nom}` : ''}`
          : `Aucun site trouve dans un rayon de ${RAYON_ANALYSE_ZONAGES_M / 1000} km`,
    commentaire:
      "Toute proximite declenche une evaluation des incidences Natura 2000, meme sans recouvrement. Un recouvrement rend le projet tres difficile a autoriser.",
    sourceKey: SRC.nature,
  };
};

const env_znieff: Evaluateur = (s) => {
  const courbe: readonly Palier[] = [
    [0, 25],
    [200, 45],
    [800, 70],
    [2000, 88],
    [5000, 100],
  ];
  const note = pire(
    noteProximiteZonage(s.milieux.znieff1, courbe),
    // Les ZNIEFF de type II sont de vastes ensembles : moins discriminantes.
    s.milieux.znieff2.recouvre === true ? 60 : noteProximiteZonage(s.milieux.znieff2, courbe),
  );
  if (note == null) return indispo(SRC.nature);
  return {
    note,
    valeurBrute: s.milieux.znieff1.distanceM,
    valeurAffichee: s.milieux.znieff1.recouvre
      ? `Recouvrement ZNIEFF I${s.milieux.znieff1.nom ? ` - ${s.milieux.znieff1.nom}` : ''}`
      : s.milieux.znieff2.recouvre
        ? 'Recouvrement ZNIEFF II'
        : formatDistance(s.milieux.znieff1.distanceM),
    commentaire:
      "Les ZNIEFF n'ont pas de portee reglementaire directe mais pesent lourdement dans l'instruction et le contentieux.",
    sourceKey: SRC.nature,
  };
};

const env_zone_humide: Evaluateur = (s) => {
  const zh = s.eau.zoneHumide;
  if (zh == null) return indispo(SRC.zonesHumides);
  const note = correspondance(zh, { non: 100, a_confirmer: 45, oui: 5 });
  return {
    note,
    valeurBrute: zh,
    valeurAffichee:
      zh === 'oui' ? 'Zone humide cartographiee' : zh === 'a_confirmer' ? 'A confirmer (pre-reperage)' : 'Hors zone humide cartographiee',
    commentaire:
      "Pre-reperage cartographique uniquement. Le caractere humide se determine par sondages pedologiques et releves floristiques (arrete du 24 juin 2008 modifie).",
    sourceKey: SRC.zonesHumides,
  };
};

const env_tvb: Evaluateur = (s) => {
  const t = s.milieux.trameVerteBleue;
  if (t.reservoir == null && t.corridor == null) return indispo(SRC.nature);
  const note = t.reservoir ? 25 : t.corridor ? 55 : 95;
  return {
    note,
    valeurBrute: t.reservoir ? 'reservoir' : t.corridor ? 'corridor' : 'hors_tvb',
    valeurAffichee: t.reservoir
      ? 'Reservoir de biodiversite'
      : t.corridor
        ? 'Corridor ecologique'
        : 'Hors trame verte et bleue',
    commentaire:
      "La trame verte et bleue du SRADDET est prise en compte par les PLU : une implantation en reservoir sera contestee.",
    sourceKey: SRC.nature,
  };
};

const env_especes_protegees: Evaluateur = (s) => {
  const p = s.milieux.preEnjeuEspeces;
  if (p == null) return indispo(SRC.nature);
  return {
    note: paliers(p, [
      [0, 100],
      [25, 80],
      [50, 55],
      [75, 28],
      [100, 5],
    ]),
    valeurBrute: p,
    valeurAffichee: `Pre-enjeu ${formatNombre(p, '', 0)}/100 (derive des zonages)`,
    commentaire:
      "Indicateur DERIVE de la proximite et du recouvrement des zonages d'inventaire et de " +
      "protection - ce n'est pas une donnee d'inventaire. Il ne dit rien des especes " +
      "reellement presentes et ne remplace pas des inventaires sur un cycle biologique " +
      "complet. Pour l'eolien, la sensibilite avifaune et chiropteres doit etre etablie " +
      "par les atlas regionaux DREAL ou LPO, qu'aucune API nationale n'expose.",
    sourceKey: SRC.nature,
  };
};



// ---------------------------------------------------------------------------
// Patrimoine
// ---------------------------------------------------------------------------

const pat_monuments: Evaluateur = (s, ctx) => {
  const mh = s.patrimoine.monumentHistorique;
  if (mh.distanceM == null && mh.dansPerimetreProtection == null) return indispo(SRC.patrimoine);
  // L'eolien est visible de tres loin : la courbe est bien plus etalee.
  const courbe: readonly Palier[] =
    ctx.filiere === 'eolien_terrestre'
      ? [
          [0, 0],
          [500, 15],
          [1500, 40],
          [3000, 65],
          [6000, 88],
          [10000, 100],
        ]
      : [
          [0, 10],
          [500, 45],
          [1000, 70],
          [2000, 88],
          [4000, 100],
        ];
  const base = mh.distanceM != null ? paliers(mh.distanceM, courbe) : null;
  const note = mh.dansPerimetreProtection === true ? pire(base ?? 30, 30) : base;
  return {
    note,
    valeurBrute: mh.distanceM,
    valeurAffichee: `${formatDistance(mh.distanceM)}${mh.nom ? ` - ${mh.nom}` : ''}${mh.dansPerimetreProtection ? ' (dans le perimetre de protection)' : ''}`,
    commentaire:
      mh.dansPerimetreProtection === true
        ? "Dans un perimetre de protection : avis de l'architecte des batiments de France requis, susceptible d'etre defavorable."
        : "Hors perimetre de protection, mais la covisibilite peut porter bien au-dela de 500 m.",
    sourceKey: SRC.patrimoine,
    reglesLiees: ctx.filiere === 'eolien_terrestre' ? ['eol_monument_historique'] : [],
  };
};

const pat_sites: Evaluateur = (s) => {
  const courbe: readonly Palier[] = [
    [0, 5],
    [500, 40],
    [1500, 70],
    [3000, 90],
    [6000, 100],
  ];
  const note = pire(
    noteProximiteZonage(s.patrimoine.siteClasse, courbe),
    noteProximiteZonage(s.patrimoine.siteInscrit, courbe),
  );
  if (note == null) return indispo(SRC.patrimoine);

  const distance = s.patrimoine.siteClasse.distanceM ?? s.patrimoine.siteInscrit.distanceM;
  // Lorsque la couche est ingeree et qu'aucun site n'est trouve dans le rayon d'analyse, la
  // distance est nulle : c'est une absence de site, non une absence de donnee. Le libelle
  // doit le dire, sans quoi un feu vert s'afficherait avec la mention « indisponible ».
  const libelle = s.patrimoine.siteClasse.recouvre
    ? `Site classe - ${s.patrimoine.siteClasse.nom ?? 'sans nom'}`
    : s.patrimoine.siteInscrit.recouvre
      ? `Site inscrit - ${s.patrimoine.siteInscrit.nom ?? 'sans nom'}`
      : distance != null
        ? formatDistance(distance)
        : "Aucun site classe ni inscrit dans le rayon d'analyse";

  return {
    note,
    valeurBrute: distance,
    valeurAffichee: libelle,
    commentaire:
      "Un site classe impose une autorisation ministerielle speciale ; un site inscrit, un avis de l'ABF.",
    sourceKey: SRC.patrimoine,
  };
};


const pat_archeologie: Evaluateur = (s) => {
  const a = s.patrimoine.sensibiliteArcheologique;
  if (a == null) return indispo(SRC.patrimoine);
  const note = correspondance(a, { faible: 95, moyenne: 65, forte: 30 });
  return {
    note,
    valeurBrute: a,
    valeurAffichee: `Sensibilite ${a}`,
    commentaire:
      "Une zone de presomption de prescription archeologique implique un diagnostic, voire une fouille preventive : plusieurs mois de calendrier.",
    sourceKey: SRC.patrimoine,
  };
};

// ---------------------------------------------------------------------------
// Risques
// ---------------------------------------------------------------------------

function noteZonagePpr(zonage: string | null, present: boolean | null): number | null {
  if (present == null && zonage == null) return null;
  if (present === false) return 100;
  if (!zonage) return 45;
  const z = zonage.toLowerCase();
  if (z.includes('rouge') || z.startsWith('r')) return 5;
  if (z.includes('bleu') || z.startsWith('b')) return 50;
  if (z.includes('jaune') || z.includes('orange')) return 35;
  if (z.includes('blanc') || z.includes('vert')) return 90;
  return 45;
}

const risq_inondation: Evaluateur = (s) => {
  const parPpri = noteZonagePpr(s.risques.ppri.zonage, s.risques.ppri.present);
  const parAlea = correspondance(s.eau.inondation.alea, { nul: 100, faible: 75, moyen: 45, fort: 12 });
  const note = pire(parPpri, parAlea);
  if (note == null) return indispo(SRC.georisques);
  const morceaux: string[] = [];
  if (s.risques.ppri.present) morceaux.push(`PPRI${s.risques.ppri.zonage ? ` zone ${s.risques.ppri.zonage}` : ''}`);
  if (s.eau.inondation.alea) morceaux.push(`alea ${s.eau.inondation.alea}`);
  if (s.eau.inondation.dansTri) morceaux.push('TRI');
  return {
    note,
    valeurBrute: s.risques.ppri.zonage,
    valeurAffichee: morceaux.join(' - ') || 'Aucun risque inondation identifie',
    commentaire:
      "Un zonage rouge de PPRI interdit en principe les constructions nouvelles. Un zonage bleu impose des prescriptions (transparence hydraulique, cote de plancher).",
    sourceKey: SRC.georisques,
  };
};

const risq_incendie: Evaluateur = (s) => {
  const parPprif = noteZonagePpr(s.risques.pprif.zonage, s.risques.pprif.present);
  const parOld = booleen(s.risques.obligationDebroussaillement, 55, 100);
  const note = pire(parPprif, parOld);
  if (note == null) return indispo(SRC.georisques);
  return {
    note,
    valeurBrute: s.risques.pprif.zonage,
    valeurAffichee: s.risques.pprif.present
      ? `PPRif${s.risques.pprif.zonage ? ` zone ${s.risques.pprif.zonage}` : ''}`
      : s.risques.obligationDebroussaillement
        ? 'Obligation legale de debroussaillement'
        : 'Aucun risque incendie identifie',
    commentaire:
      "Le risque feux de foret impose des obligations de debroussaillement, des acces engins et un avis du SDIS, particulierement structurant pour un BESS.",
    sourceKey: SRC.georisques,
  };
};

const risq_technologique: Evaluateur = (s) => {
  const note = noteZonagePpr(s.risques.pprt.zonage, s.risques.pprt.present);
  if (note == null) return indispo(SRC.georisques);
  return {
    note,
    valeurBrute: s.risques.pprt.zonage,
    valeurAffichee: s.risques.pprt.present
      ? `PPRT${s.risques.pprt.zonage ? ` zone ${s.risques.pprt.zonage}` : ''}`
      : 'Hors PPRT',
    commentaire: "Un PPRT restreint fortement l'implantation de nouvelles installations, a fortiori d'un stockage.",
    sourceKey: SRC.georisques,
  };
};

const risq_argiles_cavites: Evaluateur = (s) => {
  const parArgiles = correspondance(s.topographie.aleaArgiles, { nul: 100, faible: 90, moyen: 65, fort: 35 });
  const parCavites =
    s.topographie.cavitesProches == null
      ? null
      : paliers(s.topographie.cavitesProches, [
          [0, 100],
          [1, 70],
          [3, 45],
          [6, 20],
          [12, 5],
        ]);
  const parMvt =
    s.topographie.mouvementsTerrain == null
      ? null
      : paliers(s.topographie.mouvementsTerrain, [
          [0, 100],
          [1, 75],
          [3, 50],
          [8, 20],
        ]);
  const note = pire(parArgiles, parCavites, parMvt);
  if (note == null) return indispo(SRC.georisques);
  const morceaux: string[] = [];
  if (s.topographie.aleaArgiles) morceaux.push(`argiles : alea ${s.topographie.aleaArgiles}`);
  if (s.topographie.cavitesProches != null) morceaux.push(`${s.topographie.cavitesProches} cavite(s) < 500 m`);
  if (s.topographie.mouvementsTerrain != null) morceaux.push(`${s.topographie.mouvementsTerrain} mouvement(s) de terrain`);
  return {
    note,
    valeurBrute: s.topographie.aleaArgiles,
    valeurAffichee: morceaux.join(' - ') || 'Aucun alea geotechnique identifie',
    commentaire:
      "Alea fort de retrait-gonflement ou cavites : surcout de fondations, campagne geotechnique renforcee (G2 AVP a minima).",
    sourceKey: SRC.georisques,
  };
};

const risq_sites_pollues: Evaluateur = (s, ctx) => {
  const n = s.risques.sitesPollues;
  if (n == null) return indispo(SRC.georisques);
  // Pour le solaire et le BESS, une friche polluee est aussi une opportunite (terrain degrade).
  const opportuniste = ctx.filiere === 'solaire_sol' || ctx.filiere === 'bess';
  const note = opportuniste
    ? paliers(n, [
        [0, 80],
        [1, 85],
        [3, 70],
        [6, 50],
        [12, 30],
      ])
    : paliers(n, [
        [0, 100],
        [1, 75],
        [3, 55],
        [6, 35],
        [12, 15],
      ]);
  return {
    note,
    valeurBrute: n,
    valeurAffichee: n === 0 ? 'Aucun site recense < 500 m' : `${n} site(s) recense(s) < 500 m`,
    commentaire: opportuniste
      ? "Un ancien site industriel peut constituer un terrain degrade eligible, mais impose une etude de sols et un plan de gestion."
      : "La proximite de sols pollues complique l'instruction et peut interdire certains usages.",
    sourceKey: SRC.georisques,
  };
};

const risq_aero_radar: Evaluateur = (s, ctx) => {
  if (ctx.filiere !== 'eolien_terrestre') return null;
  if (s.risques.radars.length === 0 && s.risques.servitudesAeronautiques == null) {
    return indispo(SRC.georisques);
  }
  let note = 100;
  const details: string[] = [];
  for (const r of s.risques.radars) {
    const requis = r.distanceMinRequiseKm;
    if (requis != null) {
      const ratio = r.distanceKm / requis;
      const n = paliers(ratio, [
        [0, 0],
        [0.8, 5],
        [1, 40],
        [1.3, 70],
        [2, 95],
        [3, 100],
      ]);
      if (n != null) note = Math.min(note, n);
      details.push(`${r.type} a ${formatNombre(r.distanceKm, 'km')} (requis ${formatNombre(requis, 'km')})`);
    } else {
      details.push(`${r.type} a ${formatNombre(r.distanceKm, 'km')}`);
    }
  }
  if (s.risques.servitudesAeronautiques === true) {
    note = Math.min(note, 20);
    details.push('servitude aeronautique');
  }
  if (s.risques.faisceauxHertziens === true) {
    note = Math.min(note, 55);
    details.push('faisceau hertzien');
  }
  return {
    note,
    valeurBrute: s.risques.radars[0]?.distanceKm ?? null,
    valeurAffichee: details.join(' - ') || 'Aucune contrainte aeronautique identifiee',
    commentaire:
      "Les distances aux radars sont des seuils de consultation : un avis defavorable de Meteo-France, de la DGAC ou de l'armee est bloquant en pratique.",
    sourceKey: SRC.georisques,
    reglesLiees: ['eol_radar'],
  };
};

const risq_karst: Evaluateur = (s, ctx) => {
  if (ctx.filiere !== 'methanisation') return null;
  if (s.eau.karst == null) return indispo(SRC.georisques);
  return {
    note: booleen(s.eau.karst, 15, 100),
    valeurBrute: s.eau.karst,
    valeurAffichee: formatBooleen(s.eau.karst, 'Contexte karstique', 'Hors contexte karstique'),
    commentaire:
      "En contexte karstique, le risque de transfert direct de pollution vers la nappe rend l'instruction tres difficile et impose des mesures d'etancheite renforcees.",
    sourceKey: SRC.georisques,
  };
};

// ---------------------------------------------------------------------------
// Distances reglementaires
// ---------------------------------------------------------------------------

const dist_habitation: Evaluateur = (s, ctx) => {
  const dBord = s.bati.distanceHabitationM;
  if (dBord == null) return indispo(SRC.bdtopo);

  // Le recul se mesure depuis l'installation : la note porte donc sur la distance
  // ATTEIGNABLE en implantant au point le plus eloigne de la parcelle, pas sur la
  // distance du bord. Sans cela, une parcelle vaste mais bordee par une habitation
  // serait notee comme une micro-parcelle collee a cette meme habitation.
  const soumisARecul = ctx.filiere === 'eolien_terrestre' || ctx.filiere === 'methanisation';
  const deport = soumisARecul ? deportPossibleM(ctx.surfaceHa) : 0;
  const d = dBord + deport;

  let courbe: readonly Palier[];
  let regles: string[] = [];
  if (ctx.filiere === 'eolien_terrestre') {
    // 500 m est un plancher legal : au-dela, chaque metre reduit le risque d'opposition.
    courbe = [
      [0, 0],
      [500, 35],
      [700, 60],
      [1000, 82],
      [1500, 95],
      [2500, 100],
    ];
    regles = ['eol_distance_habitation'];
  } else if (ctx.filiere === 'methanisation') {
    courbe = [
      [0, 0],
      [200, 40],
      [350, 65],
      [500, 85],
      [800, 97],
      [1200, 100],
    ];
    regles = ['metha_distance_habitation'];
  } else {
    // BESS : eloignement souhaitable de l'habitat dense (risque incendie, acceptabilite).
    courbe = [
      [0, 20],
      [100, 45],
      [200, 70],
      [400, 90],
      [800, 100],
    ];
  }
  return {
    note: paliers(d, courbe),
    valeurBrute: dBord,
    valeurAffichee:
      `${formatDistance(dBord)} du bord` +
      (deport > 0 ? `, jusqu'a ${formatDistance(d)} en implantant au plus loin` : '') +
      (s.bati.nbHabitationsRayon500m != null
        ? ` - ${s.bati.nbHabitationsRayon500m} habitation(s) < 500 m`
        : ''),
    commentaire:
      ctx.filiere === 'eolien_terrestre'
        ? "500 m est un plancher legal, pas une cible : la plupart des projets autorises se situent au-dela de 700 m. Distance mesuree sur le bati IGN, a verifier sur le terrain (batiments recents, permis en cours)."
        : ctx.filiere === 'methanisation'
          ? "200 m des habitations et locaux occupes par des tiers. L'acceptabilite locale (odeurs, trafic) reste le facteur limitant au-dela du seuil."
          : "L'eloignement de l'habitat dense facilite l'instruction ICPE et l'avis du SDIS.",
    sourceKey: SRC.bdtopo,
    reglesLiees: regles,
  };
};

const dist_eau: Evaluateur = (s, ctx) => {
  if (ctx.filiere !== 'methanisation') return null;
  const d = s.eau.distanceCoursEauM;
  if (d == null) return indispo(SRC.bdtopo);
  return {
    note: paliers(d, [
      [0, 0],
      [35, 45],
      [75, 70],
      [150, 90],
      [300, 100],
    ]),
    valeurBrute: d,
    valeurAffichee: formatDistance(d),
    commentaire:
      "35 m minimum des puits, forages, sources et berges des cours d'eau, pour les ouvrages comme pour les epandages.",
    sourceKey: SRC.bdtopo,
    reglesLiees: ['metha_distance_eau'],
  };
};

const dist_captage: Evaluateur = (s) => {
  const c = s.eau.captageAep;
  if (c.dansPerimetre == null && c.distanceM == null) return indispo(SRC.georisques);
  if (c.dansPerimetre === true) {
    const note = correspondance(c.type, { immediat: 0, rapproche: 8, eloigne: 40 }, 15);
    return {
      note,
      valeurBrute: c.type,
      valeurAffichee: `Perimetre de protection ${c.type ?? 'non precise'}`,
      commentaire:
        "Interdiction en perimetre immediat et rapproche ; prescriptions renforcees en perimetre eloigne. Se reporter a l'arrete prefectoral de DUP du captage.",
      sourceKey: SRC.georisques,
      reglesLiees: ['metha_distance_eau'],
    };
  }
  return {
    note: paliers(c.distanceM ?? 5000, [
      [0, 10],
      [200, 45],
      [500, 70],
      [1000, 88],
      [2000, 100],
    ]),
    valeurBrute: c.distanceM,
    valeurAffichee: `Hors perimetre${c.distanceM != null ? ` - ${formatDistance(c.distanceM)} du plus proche` : ''}`,
    commentaire: "Hors perimetre de protection de captage identifie.",
    sourceKey: SRC.georisques,
  };
};

// ---------------------------------------------------------------------------
// Foncier et acces
// ---------------------------------------------------------------------------

const fonc_nb_proprietaires: Evaluateur = (s) => {
  const n = s.foncier.nbProprietairesEstime;
  if (n == null) return indispo(SRC.foncier);
  const base = paliers(n, [
    [1, 100],
    [2, 82],
    [3, 68],
    [5, 45],
    [8, 25],
    [15, 8],
  ]);
  const note = s.foncier.indivisionProbable === true && base != null ? Math.max(0, base - 20) : base;
  return {
    note,
    valeurBrute: n,
    valeurAffichee: `${n} proprietaire(s) estime(s)${s.foncier.indivisionProbable ? ' - indivision probable' : ''}`,
    commentaire:
      "Estimation issue du nombre de comptes cadastraux. Chaque indivision ajoute un risque de blocage difficile a lever.",
    sourceKey: SRC.foncier,
  };
};

const fonc_maitrise: Evaluateur = (s) => {
  /**
   * Ce critere agrege trois indicateurs, dont chacun peut manquer.
   *
   * Les `null` sont passes TELS QUELS a `moyenneTracee` au lieu d'etre filtres en amont :
   * c'est ce qui permet de connaitre le denominateur reel. Le comptage precedent codait le
   * total en dur (`TOTAL_INDICATEURS = 3`), valeur qui aurait cesse d'etre juste au premier
   * indicateur ajoute — sans que rien ne le signale.
   *
   * La moyenne des seuls indicateurs disponibles reste la bonne operation, mais elle est
   * MUETTE sur ce qu'elle ignore : au niveau du critere, la couverture le compte comme
   * pleinement renseigne alors qu'un seul des trois indicateurs a pu etre lu.
   */
  const { note, disponibles, total, suffixe } = moyenneTracee(
    s.foncier.nbProprietairesEstime == null
      ? null
      : s.foncier.nbProprietairesEstime === 1
        ? 100
        : s.foncier.nbProprietairesEstime <= 3
          ? 70
          : 40,
    s.foncier.indivisionProbable == null ? null : s.foncier.indivisionProbable ? 35 : 90,
    s.foncier.proprietairePublic == null ? null : s.foncier.proprietairePublic ? 60 : 85,
  );
  if (note == null) return indispo(SRC.foncier);

  const morceaux: string[] = [];
  if (s.foncier.proprietairePublic) morceaux.push('proprietaire public');
  if (s.foncier.indivisionProbable) morceaux.push('indivision probable');

  return {
    note,
    valeurBrute: null,
    valeurAffichee:
      (morceaux.length ? morceaux.join(' - ') : 'Configuration fonciere simple') + suffixe,
    commentaire:
      "Un proprietaire public impose une mise en concurrence (convention d'occupation, AOT) mais offre une meilleure securite juridique." +
      (suffixe
        ? ` Note etablie sur ${disponibles} indicateur(s) sur ${total} : elle est moins assuree que la couverture globale ne le laisse paraitre.`
        : ''),
    sourceKey: SRC.foncier,
  };
};

const acc_voirie: Evaluateur = (s) => {
  const d = s.acces.distanceVoirieM;
  if (d == null) return indispo(SRC.bdtopo);
  return {
    note: paliers(d, [
      [0, 100],
      [100, 92],
      [300, 75],
      [600, 50],
      [1200, 22],
      [2500, 0],
    ]),
    valeurBrute: d,
    valeurAffichee: formatDistance(d),
    commentaire:
      "Distance a la voirie carrossable : conditionne le cout de creation de piste et l'acheminement des composants.",
    sourceKey: SRC.bdtopo,
  };
};

const acc_poids_lourds: Evaluateur = (s) => {
  const a = s.acces.accesPoidsLourds;
  if (a == null) return indispo(SRC.bdtopo);
  return {
    note: booleen(a, 100, 25),
    valeurBrute: a,
    valeurAffichee: formatBooleen(a, 'Acces poids lourds plausible', 'Acces poids lourds a creer'),
    commentaire:
      "Une unite de methanisation genere plusieurs rotations de poids lourds par jour : la traversee de bourg est un facteur de rejet majeur.",
    sourceKey: SRC.bdtopo,
  };
};

// ---------------------------------------------------------------------------
// Registre
// ---------------------------------------------------------------------------

export const EVALUATEURS: Record<string, Evaluateur> = {
  racc_distance_poste,
  racc_capacite_residuelle,
  racc_quote_part,
  racc_distance_reseau_gaz,
  gis_irradiation,
  gis_vent,
  gis_intrants,
  gis_debouche_epandage,
  urb_zonage,
  urb_zaer,
  sol_type,
  sol_culture_compatible,
  sol_potentiel_agronomique,
  sol_foret,
  topo_pente,
  topo_orientation,
  topo_planeite,
  topo_altitude,
  surf_utile,
  surf_un_seul_tenant,
  surf_compacite,
  env_proximite_natura2000,
  env_znieff,
  env_zone_humide,
  env_tvb,
  env_especes_protegees,
  pat_monuments,
  pat_sites,
  pat_archeologie,
  risq_inondation,
  risq_incendie,
  risq_technologique,
  risq_argiles_cavites,
  risq_sites_pollues,
  risq_aero_radar,
  risq_karst,
  dist_habitation,
  dist_eau,
  dist_captage,
  fonc_nb_proprietaires,
  fonc_maitrise,
  acc_voirie,
  acc_poids_lourds,
};
