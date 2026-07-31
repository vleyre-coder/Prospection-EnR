/**
 * Moteur de scoring.
 *
 * Deux mecanismes combines, conformement au cahier des charges :
 *   1. criteres redhibitoires (knock-out) -> ROUGE, score non calcule ;
 *   2. score pondere 0-100 sur les parcelles non ecartees -> VERT / ORANGE.
 *
 * Le resultat est toujours EXPLICABLE : chaque critere expose sa note, son poids, sa
 * contribution, sa valeur brute, sa source et son commentaire.
 */

import type {
  EvaluationCritere,
  Feu,
  Filiere,
  KnockOut,
  LimiteViabilite,
  OptionsScoring,
  ParcelleSnapshot,
  PointSynthese,
  ProfilPonderation,
  ResultatScore,
} from '@enr/core';
import { AVERTISSEMENTS_GLOBAUX, CRITERES, FILIERES_META, PONDERATIONS_DEFAUT } from '@enr/core';
import { EVALUATEURS, type ContexteEval } from './criteres-eval.js';
import { evaluerKnockOuts } from './knockouts.js';
import { construireSeuilsProcedure } from './seuils-procedure.js';
import { borne } from './notes.js';

export const VERSION_MOTEUR = '1.0.0';

/** Seuils de coloration du feu tricolore au niveau d'un critere individuel. */
const SEUIL_FEU_VERT = 70;
const SEUIL_FEU_ORANGE = 40;

function feuDepuisNote(note: number | null): Feu {
  if (note == null) return 'gris';
  if (note >= SEUIL_FEU_VERT) return 'vert';
  if (note >= SEUIL_FEU_ORANGE) return 'orange';
  return 'rouge';
}

/** Fusionne le profil par defaut de la filiere avec les surcharges utilisateur. */
export function resoudrePonderation(
  filiere: Filiere,
  surcharge?: Partial<ProfilPonderation>,
): ProfilPonderation {
  const defaut = PONDERATIONS_DEFAUT[filiere];
  return {
    filiere,
    poids: { ...defaut.poids, ...(surcharge?.poids ?? {}) },
    seuilVert: surcharge?.seuilVert ?? defaut.seuilVert,
    seuilOrange: surcharge?.seuilOrange ?? defaut.seuilOrange,
    seuilCouvertureDonnees: surcharge?.seuilCouvertureDonnees ?? defaut.seuilCouvertureDonnees,
  };
}

/** Surface retenue : geometrie projetee si disponible, sinon contenance cadastrale. */
function surfaceHectares(s: ParcelleSnapshot): number | null {
  const m2 = s.identite.surfaceCalculeeM2 ?? s.identite.contenanceM2;
  return m2 == null ? null : Math.round((m2 / 10000) * 10000) / 10000;
}

/**
 * Regime d'implantation photovoltaique, determine a partir de la nature du sol.
 * Il conditionne le cadre juridique et les seuils rappeles dans la fiche.
 */
export function determinerRegimeImplantation(s: ParcelleSnapshot, filiere: Filiere): string | null {
  if (filiere !== 'solaire_sol') return null;
  switch (s.occupationSol.typeSol) {
    case 'artificialise':
    case 'degrade':
      return 'pv_sol_terrain_degrade';
    case 'agricole_exploite':
      return 'agrivoltaisme';
    case 'inculte':
      return 'pv_sol_document_cadre';
    case 'naturel_forestier':
      return 'pv_sol_defrichement';
    default:
      return null;
  }
}

export const LIBELLES_REGIME: Record<string, string> = {
  pv_sol_terrain_degrade: 'Photovoltaique au sol sur terrain degrade ou artificialise',
  agrivoltaisme: 'Agrivoltaisme sur parcelle agricole exploitee',
  pv_sol_document_cadre: 'Photovoltaique au sol sur terrain inculte (document-cadre departemental)',
  pv_sol_defrichement: 'Photovoltaique au sol avec defrichement (fortement penalise)',
};

/**
 * Limites de viabilite economique.
 *
 * Une parcelle nettement sous la surface minimale de la filiere est licite mais ne peut pas
 * porter un projet finançable seule. Elle ne doit donc jamais s'afficher en VERT - ce serait
 * envoyer un prospecteur demarcher un proprietaire pour rien - tout en restant visible et
 * mobilisable dans un regroupement de parcelles.
 */
function evaluerLimitesViabilite(
  filiere: Filiere,
  surfaceHa: number | null,
): LimiteViabilite[] {
  const limites: LimiteViabilite[] = [];
  if (surfaceHa == null) return limites;

  const meta = FILIERES_META[filiere];
  const min = meta.surfaceUtileMinHa;

  if (surfaceHa < min * 0.25) {
    limites.push({
      id: 'viab_surface_tres_insuffisante',
      libelle: 'Surface tres insuffisante',
      motif: `La parcelle mesure ${surfaceHa.toFixed(2)} ha, soit moins du quart de la surface minimale indicative de ${min} ha pour la filiere ${meta.libelleCourt}. Un projet autonome y est exclu ; elle ne presente d'interet qu'agregee a des parcelles voisines au sein d'un site.`,
      statutMaximal: 'rouge',
    });
  } else if (surfaceHa < min * 0.6) {
    limites.push({
      id: 'viab_surface_insuffisante',
      libelle: 'Surface insuffisante seule',
      motif: `La parcelle mesure ${surfaceHa.toFixed(2)} ha, en dessous de la surface minimale indicative de ${min} ha pour la filiere ${meta.libelleCourt}. Seuil ECONOMIQUE et non reglementaire : a regrouper avec des parcelles voisines pour atteindre une taille finançable.`,
      statutMaximal: 'orange',
    });
  }

  return limites;
}

export function calculerScore(
  snapshot: ParcelleSnapshot,
  filiere: Filiere,
  options: OptionsScoring = {},
): ResultatScore {
  const ponderation = resoudrePonderation(filiere, options.ponderation);
  const surfaceHa = surfaceHectares(snapshot);
  const ctx: ContexteEval = { filiere, options, surfaceHa };
  const regimeImplantation = determinerRegimeImplantation(snapshot, filiere);

  // -- 1. Criteres redhibitoires -------------------------------------------
  const knockOuts: KnockOut[] = evaluerKnockOuts(snapshot, { filiere, options, surfaceHa });
  const bloquants = knockOuts.filter((k) => !k.derogeable);
  const limitesViabilite = evaluerLimitesViabilite(filiere, surfaceHa);

  // -- 2. Criteres ponderes ------------------------------------------------
  const criteres: EvaluationCritere[] = [];
  let poidsTotalApplicable = 0;
  let poidsRenseigne = 0;
  let sommePonderee = 0;

  for (const [id, poidsBrut] of Object.entries(ponderation.poids)) {
    if (poidsBrut <= 0) continue;
    const definition = CRITERES[id];
    const evaluateur = EVALUATEURS[id];
    if (!definition || !evaluateur) continue;

    const brut = evaluateur(snapshot, ctx);
    if (brut === null) continue; // critere non applicable a cette filiere / configuration

    poidsTotalApplicable += poidsBrut;
    if (brut.note != null) {
      poidsRenseigne += poidsBrut;
      sommePonderee += brut.note * poidsBrut;
    }

    criteres.push({
      id,
      libelle: definition.libelle,
      famille: definition.famille,
      note: brut.note,
      poids: poidsBrut, // normalise plus bas
      contribution: 0, // calcule plus bas
      feu: feuDepuisNote(brut.note),
      valeurBrute: brut.valeurBrute,
      valeurAffichee: brut.valeurAffichee,
      commentaire: brut.commentaire ?? null,
      source: brut.sourceKey ? (snapshot.sources[brut.sourceKey] ?? null) : null,
      reglesLiees: brut.reglesLiees ?? [],
    });
  }

  // Normalisation des poids et calcul des contributions.
  const poidsAffichage = poidsTotalApplicable || 1;
  for (const c of criteres) {
    c.poids = Math.round((c.poids / poidsAffichage) * 10000) / 10000;
    c.contribution = c.note == null ? 0 : Math.round(c.note * c.poids * 100) / 100;
  }

  const couvertureDonnees =
    poidsTotalApplicable === 0 ? 0 : Math.round((poidsRenseigne / poidsTotalApplicable) * 1000) / 1000;
  const scoreBrut = poidsRenseigne === 0 ? null : borne(sommePonderee / poidsRenseigne);

  // -- 3. Statut de coloration --------------------------------------------
  let statut: Feu;
  let scoreGlobal: number | null;

  if (bloquants.length > 0) {
    statut = 'rouge';
    scoreGlobal = null; // un score sur une parcelle ecartee serait trompeur
  } else if (scoreBrut == null || couvertureDonnees < ponderation.seuilCouvertureDonnees) {
    statut = 'gris';
    scoreGlobal = scoreBrut;
  } else if (scoreBrut < ponderation.seuilOrange) {
    statut = 'rouge';
    scoreGlobal = scoreBrut;
  } else if (scoreBrut < ponderation.seuilVert) {
    statut = 'orange';
    scoreGlobal = scoreBrut;
  } else {
    // Un knock-out derogeable ne peut pas laisser une parcelle en vert.
    statut = knockOuts.length > 0 ? 'orange' : 'vert';
    scoreGlobal = scoreBrut;
  }

  // Application des plafonds de viabilite economique : ils ne modifient pas le score, mais
  // empechent une parcelle non finançable d'apparaitre comme propice.
  const ordreStatut: Record<Feu, number> = { vert: 3, orange: 2, rouge: 1, gris: 0 };
  for (const limite of limitesViabilite) {
    if (statut !== 'gris' && ordreStatut[statut] > ordreStatut[limite.statutMaximal]) {
      statut = limite.statutMaximal;
    }
  }

  // -- 4. Synthese ---------------------------------------------------------
  const evalues = criteres.filter((c) => c.note != null);
  const pointsForts: PointSynthese[] = [...evalues]
    .filter((c) => c.note! >= SEUIL_FEU_VERT)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map(toPointSynthese);

  // Un point de vigilance est un critere dont la note est basse ET dont le poids est
  // significatif : on classe par "manque a gagner" = (100 - note) * poids.
  const pointsVigilance: PointSynthese[] = [...evalues]
    .filter((c) => c.note! < SEUIL_FEU_VERT)
    .sort((a, b) => (100 - b.note!) * b.poids - (100 - a.note!) * a.poids)
    .slice(0, 3)
    .map((c) => ({
      critereId: c.id,
      libelle: c.libelle,
      valeur: c.valeurAffichee,
      impact: -Math.round((100 - c.note!) * c.poids * 100) / 100,
    }));

  // Les criteres gris a fort poids sont eux aussi des points de vigilance.
  const grisImportants = criteres
    .filter((c) => c.note == null && c.poids >= 0.05)
    .sort((a, b) => b.poids - a.poids)
    .slice(0, 3 - pointsVigilance.length)
    .map((c) => ({
      critereId: c.id,
      libelle: `${c.libelle} : donnee manquante`,
      valeur: c.valeurAffichee,
      impact: 0,
    }));

  const avertissements = AVERTISSEMENTS_GLOBAUX.map((a) => a.texte);
  if (couvertureDonnees < 0.8) {
    avertissements.push(
      `Couverture de donnees de ${Math.round(couvertureDonnees * 100)} % : ${criteres.filter((c) => c.note == null).length} critere(s) n'ont pu etre evalues. L'absence de donnee ne vaut pas absence de contrainte.`,
    );
  }
  for (const limite of limitesViabilite) {
    avertissements.push(`${limite.libelle} : ${limite.motif}`);
  }
  if ((options.knockOutsDesactives?.length ?? 0) > 0) {
    avertissements.push(
      `Mode scenario derogatoire : ${options.knockOutsDesactives!.length} critere(s) redhibitoire(s) ont ete desactives manuellement. Le resultat ne reflete pas le cadre reglementaire en vigueur.`,
    );
  }

  return {
    idu: snapshot.identite.idu,
    filiere,
    statut,
    scoreGlobal,
    knockOuts,
    limitesViabilite,
    criteres: criteres.sort((a, b) => b.poids - a.poids),
    pointsForts,
    pointsVigilance: [...pointsVigilance, ...grisImportants].slice(0, 3),
    seuilsProcedure: construireSeuilsProcedure(snapshot, filiere, options, surfaceHa, regimeImplantation),
    couvertureDonnees,
    regimeImplantation,
    ponderationsAppliquees: Object.fromEntries(criteres.map((c) => [c.id, c.poids])),
    versionMoteur: VERSION_MOTEUR,
    dateCalcul: new Date().toISOString(),
    avertissements,
  };
}

function toPointSynthese(c: EvaluationCritere): PointSynthese {
  return {
    critereId: c.id,
    libelle: c.libelle,
    valeur: c.valeurAffichee,
    impact: c.contribution,
  };
}

/** Score consolide d'un site = agregat de plusieurs parcelles contigues. */
export function calculerScoreSite(
  snapshots: ParcelleSnapshot[],
  filiere: Filiere,
  options: OptionsScoring = {},
): {
  statut: Feu;
  scoreGlobal: number | null;
  surfaceTotaleHa: number;
  parcelles: ResultatScore[];
  knockOutsConsolides: KnockOut[];
} {
  const parcelles = snapshots.map((s) => calculerScore(s, filiere, options));
  const surfaceTotaleHa = snapshots.reduce((acc, s) => acc + (surfaceHectares(s) ?? 0), 0);

  // Un knock-out sur une parcelle du site n'ecarte pas le site : il en retire la parcelle.
  // Le site est ecarte si les parcelles restantes ne suffisent plus a atteindre la surface utile.
  //
  // Point important : une parcelle ecartee UNIQUEMENT pour insuffisance de surface est
  // conservee dans le site. C'est precisement la raison d'etre de l'agregation : dix
  // parcelles de 0,3 ha ne sont finançables qu'ensemble. Seuls les knock-outs reglementaires
  // bloquants retirent une parcelle du site.
  const knockOutsConsolides = parcelles.flatMap((p) => p.knockOuts.filter((k) => !k.derogeable));
  const estExclue = (p: ResultatScore): boolean => p.knockOuts.some((k) => !k.derogeable);
  const retenues = parcelles.filter((p) => !estExclue(p));
  const surfaceRetenueHa = snapshots
    .filter((_, i) => !estExclue(parcelles[i]!))
    .reduce((acc, s) => acc + (surfaceHectares(s) ?? 0), 0);

  if (retenues.length === 0) {
    return { statut: 'rouge', scoreGlobal: null, surfaceTotaleHa, parcelles, knockOutsConsolides };
  }

  // Moyenne ponderee par la surface des parcelles retenues.
  let somme = 0;
  let poids = 0;
  for (let i = 0; i < parcelles.length; i += 1) {
    const p = parcelles[i]!;
    if (estExclue(p) || p.scoreGlobal == null) continue;
    const ha = surfaceHectares(snapshots[i]!) ?? 0;
    somme += p.scoreGlobal * ha;
    poids += ha;
  }
  const scoreGlobal = poids === 0 ? null : borne(somme / poids);

  // Penalite de fragmentation : un site dont une partie est ecartee perd en coherence.
  const partRetenue = surfaceTotaleHa === 0 ? 1 : surfaceRetenueHa / surfaceTotaleHa;
  const scoreAjuste = scoreGlobal == null ? null : borne(scoreGlobal * (0.7 + 0.3 * partRetenue));

  const ponderation = resoudrePonderation(filiere, options.ponderation);
  const statut: Feu =
    scoreAjuste == null
      ? 'gris'
      : scoreAjuste >= ponderation.seuilVert
        ? 'vert'
        : scoreAjuste >= ponderation.seuilOrange
          ? 'orange'
          : 'rouge';

  return { statut, scoreGlobal: scoreAjuste, surfaceTotaleHa, parcelles, knockOutsConsolides };
}

export { EVALUATEURS } from './criteres-eval.js';
export { evaluerKnockOuts } from './knockouts.js';
export { construireSeuilsProcedure, puissancePvEstimeeMwc } from './seuils-procedure.js';
export * from './notes.js';
export { SRC } from './sources.js';
