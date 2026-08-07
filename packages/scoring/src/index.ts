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
import {
  AVERTISSEMENTS_GLOBAUX,
  CRITERES,
  FILIERES_META,
  PONDERATIONS_DEFAUT,
  REFERENTIEL_DERNIERE_VERIFICATION,
  REGLES_PAR_ID,
} from '@enr/core';
import {
  COURBE_DISTANCE_POSTE,
  COURBE_PENTE,
  EVALUATEURS,
  type ContexteEval,
} from './criteres-eval.js';
import { evaluerKnockOuts } from './knockouts.js';
import { construireSeuilsProcedure } from './seuils-procedure.js';
import { borne, formatNombre } from './notes.js';
import { BANDE_PERIMETRALE_M, surfaceUtileEstimee, surfaceUtileSiteHa } from './implantation.js';

/**
 * Version du moteur. A incrementer des que le calcul change : elle sert a invalider les
 * scores materialises (`invaliderVersionsAnterieures`).
 *
 * 1.4.0 : la pente n'est plus celle d'une regression mal conditionnee. Le critere de pente
 *   notait des valeurs jusqu'a 1 666 % sur 14 % des parcelles reelles, ce qui le mettait a
 *   0/100 au lieu de 99/100 — 8 a 12 points de score global, assez pour changer de couleur.
 *   Les snapshots sont repares par la migration 011, les scores par ce changement de version.
 *
 * 1.3.0 : les abscisses de COURBE_DISTANCE_POSTE sont recalees en kilometres de TRACE.
 *   Avant, le critere notait le lineaire majore de 35 % sur des courbes calibrees en vol
 *   d'oiseau : la majoration se payait deux fois (jusqu'a 16 points d'ecart en stockage).
 *   Les scores anterieurs ne sont donc pas comparables sur ce critere.
 */
export const VERSION_CODE_MOTEUR = '1.4.0';

/**
 * Empreinte du calcul, utilisee pour invalider les scores materialises.
 *
 * Elle ne peut pas se reduire au numero de version du code. Les seuils reglementaires, leurs
 * dates d'entree en vigueur et les ponderations par defaut vivent dans `@enr/core` et
 * changent SANS que le moteur soit modifie : un seuil qui evolue laissait alors en base des
 * scores calcules sous l'ancienne regle, reaffiches sans la moindre reserve. C'est
 * exactement le risque que l'application pretend ecarter, puisque son argument est la
 * reglementation datee.
 *
 * L'empreinte combine donc la version du code ET le contenu du referentiel. Toute evolution
 * de l'un ou de l'autre declenche le recalcul au demarrage suivant.
 *
 * Le hachage est volontairement fait a la main plutot qu'avec `node:crypto` : ce module est
 * partage avec l'interface, qui n'a pas acces aux modules Node.
 */
function empreinte(valeur: string): string {
  // FNV-1a 32 bits, suffisant pour detecter un changement de contenu - ce n'est pas un
  // usage cryptographique.
  let h = 0x811c9dc5;
  for (let i = 0; i < valeur.length; i += 1) {
    h ^= valeur.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const EMPREINTE_REFERENTIEL = empreinte(
  JSON.stringify({
    regles: REGLES_PAR_ID,
    verification: REFERENTIEL_DERNIERE_VERIFICATION,
    ponderations: PONDERATIONS_DEFAUT,
    criteres: Object.keys(CRITERES).sort(),
    // Les baremes de notation entrent dans l'empreinte, et pas seulement le referentiel
    // reglementaire : une courbe deplacee change TOUS les scores de la filiere concernee.
    // Sans cette ligne, l'invalidation dependait d'une incrementation manuelle de
    // VERSION_CODE_MOTEUR — et la premiere fois qu'on l'oublie, la base contient deux
    // generations de scores melangees, sans aucun signe visible.
    baremes: { COURBE_DISTANCE_POSTE, COURBE_PENTE, BANDE_PERIMETRALE_M },
  }),
);

/**
 * Identifiant complet du calcul, ecrit dans `score_parcelle_filiere.version_moteur`.
 * Exemple : `1.4.0+3f2a91b7`.
 */
export const VERSION_MOTEUR = `${VERSION_CODE_MOTEUR}+${EMPREINTE_REFERENTIEL}`;

/**
 * Couverture de donnees minimale pour qu'une parcelle puisse etre declaree PROPICE.
 *
 * Distincte de `seuilCouvertureDonnees`, qui decide du grisement. En dessous de ce
 * seuil-ci, la parcelle reste affichable et comparable, mais plafonnee a orange.
 */
const SEUIL_COUVERTURE_POUR_VERT = 0.9;

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

/**
 * La source d'un critere fait-elle partie des connecteurs en echec ?
 *
 * Comparaison par prefixe dans les DEUX sens, chacun repondant a un cas reel :
 *   - `georisques` (cle du critere) prefixe `georisques/gaspar/pprn` (echec signale) : le
 *     connecteur precise le point d'entree fautif, le critere ne connait que le connecteur ;
 *   - `zaer_local` (echec signale) prefixe `zaer_local/ingestion` si un jour un connecteur
 *     signalait plus large que la cle du critere.
 *
 * La comparaison exige une frontiere de segment (`/`) pour ne pas faire correspondre `zaer_local`
 * a un hypothetique `zaer_local_bis`.
 */
export function sourceEnEchec(
  sourceKey: string | null | undefined,
  enEchec: readonly string[],
): boolean {
  if (!sourceKey) return false;
  return enEchec.some(
    (e) =>
      e === sourceKey ||
      e.startsWith(`${sourceKey}/`) ||
      sourceKey.startsWith(`${e}/`),
  );
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
  pv_sol_terrain_degrade: 'Photovoltaique au sol sur terrain degrade ou artificialise (presume)',
  agrivoltaisme: 'Agrivoltaisme sur parcelle agricole exploitee (presume)',
  pv_sol_document_cadre: 'Photovoltaique au sol sur terrain inculte (document-cadre departemental)',
  pv_sol_defrichement: 'Photovoltaique au sol avec defrichement (fortement penalise)',
};

/**
 * Reserve attachee au regime d'implantation, affichee avec lui.
 *
 * Le regime est DEDUIT d'une classification d'occupation du sol. Or la qualification d'un
 * terrain en « degrade » au sens du decret n° 2023-1408 du 29 decembre 2023 suppose
 * d'etablir l'historique du site - ancienne carriere, decharge, friche industrielle, terrain
 * pollue - ce qu'aucune couche d'occupation du sol ne dit. De meme, « exploitee » au sens du
 * regime agrivoltaique s'apprecie sur l'activite agricole reelle, pas sur une declaration PAC.
 *
 * Le regime affiche oriente donc la lecture ; il ne la tranche pas.
 */
export const RESERVE_REGIME =
  "Regime PRESUME, deduit de la nature du sol observee. Le classement en terrain degrade au " +
  "sens du decret du 29 decembre 2023 suppose d'etablir l'historique du site (ancienne " +
  "carriere, decharge, friche, pollution), et le caractere agricole exploite s'apprecie sur " +
  "l'activite reelle. A confirmer avant tout depot.";

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
  surfaceCadastraleHa: number | null,
  morcellementIndice: number | null = null,
  /**
   * Surface implantable imposee par l'appelant. Le score de SITE la calcule autrement — la
   * deduction depend de la contiguite des parcelles, information que cette fonction n'a pas.
   */
  surfaceUtileHaImposee: number | null = null,
): LimiteViabilite[] {
  const limites: LimiteViabilite[] = [];
  if (surfaceCadastraleHa == null) return limites;

  // Le seuil economique porte sur la surface IMPLANTABLE, pas sur la surface cadastrale :
  // c'est elle qui determine la puissance installable, donc le chiffre d'affaires.
  const utile =
    surfaceUtileHaImposee != null
      ? null
      : surfaceUtileEstimee(surfaceCadastraleHa, morcellementIndice, filiere);
  const surfaceHa = surfaceUtileHaImposee ?? utile?.netteHa ?? surfaceCadastraleHa;

  const meta = FILIERES_META[filiere];
  const min = meta.surfaceUtileMinHa;

  // Virgule decimale, comme partout ailleurs dans l'application. Ces motifs sortaient en
  // « 0.14 ha » avec un point, a sept lignes d'un « 0,14 ha » de la synthese, dans la meme page
  // du meme rapport transmis a un tiers francais.
  const ha = (v: number): string => v.toFixed(2).replace('.', ',');

  /**
   * L'erosion perimetrale sort de son domaine de validite sur les petites parcelles.
   *
   * Le modele deduit une bande le long du contour. Sur une parcelle de 0,3 ha — environ 55 m de
   * cote — une bande de 5 m consomme plus de la MOITIE de la surface : mesure sur un rapport
   * reel, « 0,14 ha implantables (0,31 ha au cadastre, soit 54 % deduits) ». Le calcul est
   * coherent avec lui-meme, mais 54 % n'est plus une estimation utilisable : c'est l'indication
   * que la formule a quitte le regime ou elle a un sens.
   *
   * On ne corrige pas le nombre — il n'y a rien de plus juste a mettre — on le DIT. Un chiffre
   * presente comme un constat alors qu'il sort du domaine de son modele est plus trompeur qu'un
   * chiffre accompagne de sa reserve.
   */
  const partDeduite =
    surfaceCadastraleHa > 0 ? 1 - surfaceHa / surfaceCadastraleHa : 0;
  const reserveModele =
    partDeduite > 0.4
      ? ` ATTENTION : la deduction atteint ${Math.round(partDeduite * 100)} % de la surface` +
        ` cadastrale. Le modele d'erosion perimetrale suppose une emprise dont le contour est` +
        ` petit devant l'aire ; il quitte ce regime sous environ 1 ha et la surface implantable` +
        ` annoncee n'y est plus qu'un ordre de grandeur pessimiste. A trancher sur plan de masse.`
      : '';

  if (surfaceHa < min * 0.25) {
    limites.push({
      id: 'viab_surface_tres_insuffisante',
      libelle: 'Surface tres insuffisante',
      motif:
        `La parcelle offre environ ${ha(surfaceHa)} ha implantables (${ha(surfaceCadastraleHa)} ha ` +
        `au cadastre), soit moins du quart de la surface minimale indicative de ${ha(min)} ha pour la ` +
        `filiere ${meta.libelleCourt}. Un projet autonome y est exclu ; elle ne presente d'interet ` +
        `qu'agregee a des parcelles voisines au sein d'un site.${reserveModele}`,
      statutMaximal: 'rouge',
    });
  } else if (surfaceHa < min * 0.6) {
    limites.push({
      id: 'viab_surface_insuffisante',
      libelle: 'Surface insuffisante seule',
      motif:
        `La parcelle offre environ ${ha(surfaceHa)} ha implantables (${ha(surfaceCadastraleHa)} ha ` +
        `au cadastre), en dessous de la surface minimale indicative de ${ha(min)} ha pour la filiere ` +
        `${meta.libelleCourt}. Seuil ECONOMIQUE et non reglementaire : a regrouper avec des ` +
        `parcelles voisines pour atteindre une taille finançable.${reserveModele}`,
      statutMaximal: 'orange',
    });
  }

  return limites;
}

export function calculerScore(
  snapshot: ParcelleSnapshot,
  filiere: Filiere,
  options: OptionsScoring = {},
  /**
   * Horodatage du calcul. Injectable pour que deux calculs des MEMES entrees produisent le
   * MEME objet : sans cela, `dateCalcul` differe a chaque appel et deux resultats ne peuvent
   * pas etre compares par empreinte — ni pour detecter une derive du moteur, ni pour eviter
   * une reecriture inutile en base. La valeur par defaut reste l'instant courant, qui est le
   * comportement voulu en production.
   */
  dateCalcul: string = new Date().toISOString(),
): ResultatScore {
  const ponderation = resoudrePonderation(filiere, options.ponderation);
  const surfaceHa = surfaceHectares(snapshot);
  const ctx: ContexteEval = { filiere, options, surfaceHa };
  const regimeImplantation = determinerRegimeImplantation(snapshot, filiere);

  // -- 1. Criteres redhibitoires -------------------------------------------
  const knockOuts: KnockOut[] = evaluerKnockOuts(snapshot, { filiere, options, surfaceHa });
  const bloquants = knockOuts.filter((k) => !k.derogeable);
  const limitesViabilite = evaluerLimitesViabilite(filiere, surfaceHa, snapshot.foncier.morcellementIndice);

  // -- 2. Criteres ponderes ------------------------------------------------
  /**
   * Les echecs de source, normalises une fois pour toutes les iterations.
   *
   * Les connecteurs signalent leurs echecs au point d'entree pres (`georisques/gaspar/pprn`), alors
   * que les criteres portent la cle du connecteur (`georisques`). La comparaison se fait donc par
   * prefixe, dans les deux sens : une cle de critere qui prefixe un echec, ou l'inverse.
   */
  const enEchec = (options.connecteursEnEchec ?? []).filter((e) => e.length > 0);

  const criteres: EvaluationCritere[] = [];
  const criteresSansSource: string[] = [];
  /** Denominateur d'AFFICHAGE : inclut les criteres sans source, pour que les parts affichees somment a 100 %. */
  let poidsTotalCatalogue = 0;
  /** Denominateur de COUVERTURE : exclut les criteres sans source. */
  let poidsTotalApplicable = 0;
  let poidsRenseigne = 0;
  let sommePonderee = 0;

  for (const [id, poidsBrut] of Object.entries(ponderation.poids)) {
    if (poidsBrut <= 0) continue;
    const definition = CRITERES[id];
    const evaluateur = EVALUATEURS[id];
    if (!definition || !evaluateur) continue;

    const brutEvalue = evaluateur(snapshot, ctx);
    if (brutEvalue === null) continue; // critere non applicable a cette filiere / configuration

    /**
     * GARDE GENERIQUE : un critere dont la source a echoue ne peut pas porter de note.
     *
     * Voir `OptionsScoring.connecteursEnEchec`. Cette garde ne remplace pas la correction des
     * connecteurs — elle la rend non critique. Un connecteur qui laisse derriere lui une valeur
     * par defaut ne peut plus la faire noter : le critere passe au gris avec un motif explicite.
     *
     * Un critere DEJA sans note n'est pas touche : il est deja gris, et son commentaire (« aucune
     * source ingeree ») est plus informatif que « source en echec ».
     */
    const brut = brutEvalue.note != null && sourceEnEchec(brutEvalue.sourceKey, enEchec)
      ? {
          ...brutEvalue,
          note: null,
          valeurAffichee: 'non evalue - source en echec',
          commentaire:
            `La source ${brutEvalue.sourceKey} n'a pas repondu lors de la qualification de cette parcelle. ` +
            `La valeur qui figurait dans le releve n'est pas retenue : une donnee par defaut notee ` +
            `comme une mesure serait pire qu'une absence de note. Relancer la qualification lorsque ` +
            `la source est de nouveau disponible.` +
            (brutEvalue.commentaire ? ` — ${brutEvalue.commentaire}` : ''),
        }
      : brutEvalue;

    // Critere dont la SOURCE n'existe pas sur ce territoire : hors denominateur de
    // couverture (il manque identiquement a toutes les parcelles, il ne discrimine rien),
    // mais affiche en gris et plafonnant le statut. Voir `EvalBrute.sansSource`.
    poidsTotalCatalogue += poidsBrut;

    if (brut.sansSource === true) {
      criteresSansSource.push(CRITERES[id]?.libelle ?? id);
    } else {
      poidsTotalApplicable += poidsBrut;
      if (brut.note != null) {
        poidsRenseigne += poidsBrut;
        sommePonderee += brut.note * poidsBrut;
      }
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
  //
  // La part affichee se rapporte au catalogue COMPLET de la filiere, criteres sans source
  // inclus : un critere gris qui vaut 16,5 % du sujet doit afficher 16,5 %, sans quoi son
  // absence parait plus lourde qu'elle ne l'est et les parts ne somment plus a 100 %.
  // Le rapport contribution / poids est inchange par le choix du denominateur, donc le
  // score reste la moyenne ponderee des criteres renseignes.
  const poidsAffichage = poidsTotalCatalogue || 1;
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

  /**
   * Plafond d'INCERTITUDE.
   *
   * Le score est une moyenne des seuls criteres evalues : les criteres non renseignes sont
   * exclus, pas penalises. Cela introduit un biais optimiste, et il n'est pas neutre - les
   * criteres qui manquent sont structurellement ceux qui portent la contrainte
   * (environnement, patrimoine, risques). Sans correctif, une parcelle mal documentee
   * obtenait un meilleur score qu'une parcelle bien documentee de qualite egale, et
   * remontait donc en tete du classement.
   *
   * Une parcelle ne peut donc etre declaree PROPICE que si l'essentiel de son poids a
   * reellement ete evalue. Entre le seuil de grisement et ce seuil, le statut est plafonne
   * a orange : « peut-etre, mais on ne sait pas assez ».
   */
  if (criteresSansSource.length > 0) {
    limitesViabilite.push({
      id: 'criteres_sans_source',
      libelle: 'Enjeux determinants non evalues, faute de source',
      motif:
        `${criteresSansSource.length} critere(s) n'ont aucune source ingeree sur ce territoire : ` +
        `${criteresSansSource.join(', ')}. Ils sont exclus du calcul plutot que comptes comme ` +
        `manquants - sans quoi la filiere entiere basculerait en gris, ce qui n'aiderait a ` +
        `rien. Le score reste donc comparable d'une parcelle a l'autre, mais aucune parcelle ` +
        `ne peut etre declaree propice tant que ces enjeux n'ont pas ete regardes.`,
      statutMaximal: 'orange',
    });
  }

  if (couvertureDonnees < SEUIL_COUVERTURE_POUR_VERT) {
    limitesViabilite.push({
      id: 'couverture_insuffisante',
      libelle: 'Couverture de donnees insuffisante pour conclure',
      motif:
        `Seuls ${Math.round(couvertureDonnees * 100)} % du poids des criteres ont pu etre evalues ` +
        `(${criteres.filter((c) => c.note == null).length} critere(s) sans donnee). Le score est ` +
        `calcule sur les seuls criteres renseignes : il est donc optimiste, car les donnees ` +
        `manquantes sont le plus souvent celles qui portent une contrainte. La parcelle ne peut ` +
        `pas etre classee propice tant que la couverture n'atteint pas ` +
        `${Math.round(SEUIL_COUVERTURE_POUR_VERT * 100)} %.`,
      statutMaximal: 'orange',
    });
  }

  // Application des plafonds : ils ne modifient pas le score, mais empechent une parcelle
  // non finançable ou insuffisamment documentee d'apparaitre comme propice.
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
    dateCalcul,
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
  /**
   * Nombre de groupes de parcelles jointives, calcule par l'appelant (qui seul dispose des
   * geometries). 1 = une seule emprise. `null` = inconnu, traite comme disperse : la
   * deduction de surface est alors prudente plutot que flatteuse.
   */
  nbGroupesContigus: number | null = null,
  /**
   * Connecteurs en echec, PAR PARCELLE (indexes par IDU).
   *
   * Une liste unique pour tout le site serait fausse dans les deux sens : appliquee a toutes les
   * parcelles, elle grise des criteres qui ont bien ete mesures sur celles dont la source a repondu ;
   * ignoree, elle laisse noter des valeurs par defaut. Un site se qualifie parcelle par parcelle, et
   * ses echecs se suivent de la meme facon.
   */
  echecsParIdu: Readonly<Record<string, readonly string[]>> = {},
): {
  statut: Feu;
  scoreGlobal: number | null;
  surfaceTotaleHa: number;
  /** Surface implantable estimee du site, deduite selon sa contiguite reelle. */
  surfaceUtileHa: number;
  /** Nombre de groupes de parcelles jointives, tel que fourni. */
  nbGroupesContigus: number | null;
  parcelles: ResultatScore[];
  knockOutsConsolides: KnockOut[];
  /** Couverture moyenne des parcelles retenues, ponderee par la surface. */
  couvertureDonnees: number;
  /** Plafonds appliques au statut du site, avec leur motif. */
  limitesViabilite: LimiteViabilite[];
} {
  const parcelles = snapshots.map((s) =>
    calculerScore(s, filiere, {
      ...options,
      connecteursEnEchec: echecsParIdu[s.identite.idu] ?? options.connecteursEnEchec ?? [],
    }),
  );

  // Arrondi a 4 decimales (le metre carre) : sommer dix parcelles de 0,3 ha en binaire
  // produit 2,9999999999999996 ha, valeur qui ressortait telle quelle dans la reponse de
  // l'API et dans les comparaisons de seuil.
  const arrondiHa = (v: number): number => Math.round(v * 10000) / 10000;
  const surfaceTotaleHa = arrondiHa(
    snapshots.reduce((acc, s) => acc + (surfaceHectares(s) ?? 0), 0),
  );

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
  const surfaceRetenueHa = arrondiHa(
    snapshots
      .filter((_, i) => !estExclue(parcelles[i]!))
      .reduce((acc, s) => acc + (surfaceHectares(s) ?? 0), 0),
  );

  if (retenues.length === 0) {
    return {
      statut: 'rouge',
      scoreGlobal: null,
      surfaceTotaleHa,
      surfaceUtileHa: 0,
      nbGroupesContigus,
      parcelles,
      knockOutsConsolides,
      couvertureDonnees: 0,
      limitesViabilite: [],
    };
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

  /**
   * Penalite de fragmentation : un site dont une partie est ecartee perd en coherence.
   *
   * `0,7 + 0,3 x part retenue` : un site intact garde 100 % de sa note, un site ampute de la
   * moitie de sa surface en perd 15 %, un site reduit a rien tombe a 70 %.
   *
   * FONDEMENT : aucun, au sens ou le reste du moteur en a un. Ce n'est ni un seuil
   * reglementaire, ni une mesure — c'est un jugement, et le seul du moteur a s'appliquer
   * MULTIPLICATIVEMENT au score global plutot qu'a un critere. Il traduit l'idee qu'un
   * perimetre troue coute en etudes, en negociation et en implantation, sans que ce cout ait
   * ete chiffre. Le plancher a 0,7 borne la penalite pour qu'elle ne remplace pas les
   * criteres : c'est un ajustement, pas un verdict.
   *
   * A confronter a des projets reels avant d'en tirer un classement fin. Cf.
   * docs/CALIBRATION.md, section « jugement ».
   */
  const FRAGMENTATION_PLANCHER = 0.7;
  const partRetenue = surfaceTotaleHa === 0 ? 1 : surfaceRetenueHa / surfaceTotaleHa;
  const scoreAjuste =
    scoreGlobal == null
      ? null
      : borne(scoreGlobal * (FRAGMENTATION_PLANCHER + (1 - FRAGMENTATION_PLANCHER) * partRetenue));

  const ponderation = resoudrePonderation(filiere, options.ponderation);

  /**
   * Couverture du site : moyenne des couvertures des parcelles retenues, ponderee par leur
   * surface. Une grande parcelle mal documentee compte davantage qu'une petite bien
   * documentee, ce qui est le comportement attendu - c'est elle qui portera l'installation.
   */
  let couvSomme = 0;
  let couvPoids = 0;
  for (let i = 0; i < parcelles.length; i += 1) {
    const p = parcelles[i]!;
    if (estExclue(p)) continue;
    const ha = surfaceHectares(snapshots[i]!) ?? 0;
    couvSomme += p.couvertureDonnees * ha;
    couvPoids += ha;
  }
  const couvertureDonnees = couvPoids === 0 ? 0 : Math.round((couvSomme / couvPoids) * 1000) / 1000;

  /**
   * Limites de viabilite du SITE.
   *
   * Elles ne sont pas la simple reunion de celles des parcelles : l'insuffisance de surface
   * d'une parcelle isolee est precisement ce que l'agregation vient resoudre, et la reporter
   * sur le site contredirait sa raison d'etre. On la reevalue donc sur la surface RETENUE du
   * site. Les autres limites - couverture, enjeux sans source - se propagent, car agreger
   * des parcelles n'apporte aucune information nouvelle sur ce que l'on ignore.
   */
  const indexRetenues = parcelles.map((p, i) => (estExclue(p) ? -1 : i)).filter((i) => i >= 0);
  const utileSite = surfaceUtileSiteHa(
    indexRetenues.map((i) => surfaceHectares(snapshots[i]!)),
    indexRetenues.map((i) => snapshots[i]!.foncier.morcellementIndice),
    filiere,
    nbGroupesContigus,
  );
  const limitesViabilite: LimiteViabilite[] = evaluerLimitesViabilite(
    filiere,
    surfaceRetenueHa,
    null,
    utileSite.netteHa,
  );

  // Un site en plusieurs morceaux disjoints n'est pas une installation, c'en est plusieurs :
  // chaque groupe porte son raccordement, sa cloture et son poste de livraison. Le dire, et
  // plafonner a orange, plutot que de laisser un score eleve masquer la dispersion.
  if (nbGroupesContigus != null && nbGroupesContigus > 1) {
    limitesViabilite.push({
      id: 'site_disperse',
      libelle: `Site en ${nbGroupesContigus} groupes disjoints`,
      motif:
        `Les parcelles retenues ne forment pas une emprise continue mais ${nbGroupesContigus} ` +
        `groupes separes. Chacun demanderait sa propre cloture, sa propre piste et son propre ` +
        `raccordement : le site n'est pas un projet mais plusieurs. La surface implantable est ` +
        `estimee groupe par groupe (${formatNombre(utileSite.netteHa, 'ha', 2)} sur ` +
        `${formatNombre(utileSite.bruteHa, 'ha', 2)} au cadastre) et non comme une emprise unique, qui ` +
        `l'aurait surestimee. A rapprocher d'un regroupement effectivement jointif.`,
      statutMaximal: 'orange',
    });
  } else if (nbGroupesContigus == null && snapshots.length > 1) {
    limitesViabilite.push({
      id: 'contiguite_inconnue',
      libelle: 'Contiguite des parcelles non verifiee',
      motif:
        `La disposition geometrique des parcelles n'a pas ete verifiee. La surface implantable ` +
        `est donc deduite parcelle par parcelle (${formatNombre(utileSite.netteHa, 'ha', 2)} sur ` +
        `${formatNombre(utileSite.bruteHa, 'ha', 2)} au cadastre), hypothese prudente : si les parcelles ` +
        `sont jointives, la surface reelle est superieure.`,
      statutMaximal: 'orange',
    });
  }

  const sansSource = [
    ...new Set(
      parcelles
        .filter((p) => !estExclue(p))
        .flatMap((p) => p.limitesViabilite.filter((l) => l.id === 'criteres_sans_source')),
    ),
  ];
  if (sansSource.length > 0) limitesViabilite.push(sansSource[0]!);

  if (couvertureDonnees < SEUIL_COUVERTURE_POUR_VERT) {
    limitesViabilite.push({
      id: 'couverture_insuffisante',
      libelle: 'Couverture de donnees insuffisante pour conclure',
      motif:
        `La couverture moyenne des parcelles retenues, ponderee par leur surface, atteint ` +
        `${Math.round(couvertureDonnees * 100)} %. Agreger des parcelles mal documentees ne ` +
        `produit pas un site documente : le site ne peut pas etre declare propice tant que la ` +
        `couverture n'atteint pas ${Math.round(SEUIL_COUVERTURE_POUR_VERT * 100)} %.`,
      statutMaximal: 'orange',
    });
  }

  let statut: Feu;
  if (scoreAjuste == null || couvertureDonnees < ponderation.seuilCouvertureDonnees) {
    statut = 'gris';
  } else if (scoreAjuste >= ponderation.seuilVert) {
    // Un knock-out derogeable sur une parcelle retenue interdit le vert au site, comme il
    // l'interdit a la parcelle.
    const derogeable = parcelles.some((p) => !estExclue(p) && p.knockOuts.length > 0);
    statut = derogeable ? 'orange' : 'vert';
  } else if (scoreAjuste >= ponderation.seuilOrange) {
    statut = 'orange';
  } else {
    statut = 'rouge';
  }

  const ordreStatut: Record<Feu, number> = { vert: 3, orange: 2, rouge: 1, gris: 0 };
  for (const limite of limitesViabilite) {
    if (statut !== 'gris' && ordreStatut[statut] > ordreStatut[limite.statutMaximal]) {
      statut = limite.statutMaximal;
    }
  }

  return {
    statut,
    scoreGlobal: scoreAjuste,
    surfaceTotaleHa,
    surfaceUtileHa: utileSite.netteHa,
    nbGroupesContigus,
    parcelles,
    knockOutsConsolides,
    couvertureDonnees,
    limitesViabilite,
  };
}

export { EVALUATEURS } from './criteres-eval.js';
export { evaluerKnockOuts , IDS_KNOCK_OUTS, type IdKnockOut } from './knockouts.js';
export { construireSeuilsProcedure, puissancePvEstimeeMwc } from './seuils-procedure.js';
// Reexportes pour que les exports (PDF, CSV) presentent exactement les grandeurs notees :
// un rapport qui affiche le vol d'oiseau la ou le score juge le trace se contredit.
export {
  COEFFICIENT_TRACE,
  deportPossibleM,
  lineaireRaccordementKm,
  surfaceUtileEstimee,
  surfaceUtileSiteHa,
} from './implantation.js';
export * from './notes.js';
export { SRC } from './sources.js';
