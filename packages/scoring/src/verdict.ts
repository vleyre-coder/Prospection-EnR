/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE VERDICT D'UNE PARCELLE — favorable, a instruire, defavorable
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * DEUX MOTEURS, DEUX QUESTIONS, ET IL NE FAUT PAS LES CONFONDRE. Le moteur de SCORE existant
 * classe les parcelles favorables entre elles : il repond « laquelle regarder d'abord ». Celui-ci
 * repond « celle-ci est-elle instruisable », a partir du referentiel de 292 contraintes. Un score
 * de 82/100 sur une parcelle en cœur de parc national n'a aucun sens ; un verdict « defavorable »
 * sans classement des favorables entre elles n'en a pas davantage. Les deux coexistent, et c'est
 * l'arbitrage retenu.
 *
 * LA REGLE D'AGREGATION, et pourquoi elle penche du cote prudent :
 *
 *   - UNE SEULE contrainte redhibitoire enfreinte AU SEUIL REGLEMENTAIRE suffit a rendre
 *     « defavorable ». Il n'y a pas de compensation : aucune qualite d'une parcelle ne rattrape
 *     une interdiction. Mais l'exigence propre a un developpeur, elle, ne rend JAMAIS une parcelle
 *     defavorable — voir `ecartsCahierDesCharges` ;
 *   - une contrainte penalisante enfreinte, ou une contrainte QU'ON N'A PAS PU EVALUER, rend « a
 *     instruire ». C'est le point le plus important de ce fichier : une donnee absente ne vaut
 *     PAS « rien a signaler ». Le contraire — conclure favorable sur ce qu'on n'a pas regarde —
 *     est exactement la faute qu'un outil de prospection ne doit jamais commettre, parce qu'elle
 *     est invisible : la parcelle sort en tete de liste, et rien ne dit qu'elle n'a pas ete
 *     examinee ;
 *   - « favorable » exige donc que TOUTE contrainte du classeur ait ete evaluee et respectee.
 *
 * LES CONTRAINTES `cadre` N'ENTRENT PAS DANS LE VERDICT. Ce sont les procedures applicables a tout
 * projet de la filiere — regime ICPE, permis de construire, etude d'impact, balisage. Les compter
 * mettrait CHAQUE parcelle « a instruire » pour un permis toujours requis, et le verdict cesserait
 * de distinguer quoi que ce soit. Elles sont rendues a part, pour le dossier.
 *
 * LA TRACABILITE EST DANS LE TYPE, PAS DANS UN COMMENTAIRE. Chaque contrainte evaluee rend le
 * seuil applique, SON ORIGINE (reglementaire ou developpeur), la valeur mesuree, le chemin d'ou
 * elle vient, le texte du classeur et sa reference. Sans quoi l'operateur ne peut pas repondre a
 * la seule question qui compte pour un developpeur : « pourquoi celle-la est-elle ecartee ? ».
 */

import {
  contraintesDeFiliere,
  seuilApplique,
  type ConditionSeuil,
  type ContrainteReferentiel,
  type FiliereReferentiel,
  type ModeInterrogation,
  type OrigineSeuil,
  type ParcelleSnapshot,
  type RaisonNonAutomatique,
  type SeuilApplique,
  type SeuilDeveloppeur,
} from '@enr/core';
import { correspondanceDe, type Correspondance } from './verdict-correspondances.js';

export type Verdict = 'favorable' | 'a_instruire' | 'defavorable';

/** Ce qu'on a pu conclure sur UNE contrainte. */
export type EtatContrainte =
  /** Mesuree, et le seuil est respecte. */
  | 'respectee'
  /** Mesuree, et le seuil n'est pas respecte. */
  | 'enfreinte'
  /** Non mesurable : pas de correspondance, ou la grandeur n'est pas renseignee. */
  | 'donnee_absente'
  /** Mesurable, mais le seuil du classeur ne tranche pas seul (approximatif, regimes multiples). */
  | 'a_verifier'
  /** Procedure applicable a tout projet : hors verdict. */
  | 'cadre';

/** Le detail d'une contrainte, tel que le dossier doit pouvoir l'imprimer. */
export interface ContrainteEvaluee {
  contrainteId: string;
  nom: string;
  categorie: string;
  /** Niveau du classeur : redhibitoire, penalisant, favorable, cadre. */
  caractere: ContrainteReferentiel['caractere'];
  etat: EtatContrainte;
  /** Texte du classeur, recopie. Toujours present, meme sans mesure. */
  seuilReglementaire: string;
  referenceReglementaire: string;
  coucheSig: string;
  /** Condition effectivement appliquee, `null` si rien n'a pu etre compare. */
  condition: ConditionSeuil | null;
  /** D'ou vient le seuil applique. */
  origineSeuil: OrigineSeuil;
  /** Condition reglementaire remplacee, quand un seuil developpeur s'est applique. */
  conditionReglementaire: ConditionSeuil | null;
  motifDeveloppeur: string | null;
  /** Valeur lue sur la parcelle, `null` si absente. */
  valeurMesuree: number | null;
  /** Chemin du releve d'ou vient la valeur, pour que la mesure soit verifiable. */
  cheminMesure: string | null;
  /** Ce qui empeche le seuil reglementaire de trancher seul. Vide s'il tranche. */
  raisons: RaisonNonAutomatique[];
}

export interface ResultatVerdict {
  filiere: FiliereReferentiel;
  verdict: Verdict;
  /** Mode d'interrogation employe : c'est lui qui decide du seuil applique. */
  mode: ModeInterrogation;
  /**
   * LA contrainte qui a fait basculer la parcelle, quand le verdict n'est pas « favorable ».
   *
   * Exigee par le cahier des charges, et c'est la premiere chose qu'un operateur cherche. Quand
   * plusieurs contraintes basculent, c'est la plus severe qui est nommee — une interdiction
   * prime une penalite, et lister vingt lignes sans en designer une ne repond pas a la question.
   */
  contrainteDecisive: ContrainteEvaluee | null;
  /** Toutes les contraintes du verdict, `cadre` exclues. */
  contraintes: ContrainteEvaluee[];
  /**
   * Contraintes ou l'exigence PROPRE AU DEVELOPPEUR n'est pas satisfaite.
   *
   * SEPAREES DU VERDICT, ET C'EST LE POINT. Ces parcelles ne sont pas « defavorables » : elles ne
   * correspondent pas au cahier des charges d'un projet precis, ce qui n'est pas la meme chose et
   * ne s'annonce pas de la meme facon. Voir le commentaire de `verdict` ci-dessus.
   *
   * Toujours vide en mode `reglementaire`.
   */
  ecartsCahierDesCharges: ContrainteEvaluee[];
  /** Les procedures applicables a tout projet, hors verdict. */
  cadres: ContrainteEvaluee[];
  /** Ce que le verdict a reellement pu regarder. */
  couverture: {
    total: number;
    respectees: number;
    enfreintes: number;
    aVerifier: number;
    /** Contraintes qu'aucune donnee n'a permis d'evaluer. Le dossier doit les lister. */
    donneesAbsentes: number;
  };
}

/** Lit une valeur numerique a un chemin pointe du releve. Rend `null` si absente ou non numerique. */
export function valeurAuChemin(snapshot: ParcelleSnapshot, chemin: string): number | null {
  let courant: unknown = snapshot;
  for (const segment of chemin.split('.')) {
    if (courant == null || typeof courant !== 'object') return null;
    courant = (courant as Record<string, unknown>)[segment];
  }
  return typeof courant === 'number' && Number.isFinite(courant) ? courant : null;
}

/** La condition est-elle satisfaite par la valeur mesuree ? */
export function conditionRespectee(condition: ConditionSeuil, valeur: number): boolean {
  switch (condition.operateur) {
    case 'min':
      return valeur >= condition.valeur;
    case 'min_strict':
      return valeur > condition.valeur;
    case 'max':
      return valeur <= condition.valeur;
    case 'max_strict':
      return valeur < condition.valeur;
    case 'egal':
      /*
       * `egal` ne veut pas dire « exactement cette valeur » mais « sens non etabli » — voir
       * `seuils-developpeur.ts`. On ne peut donc rien conclure, et l'appelant met la contrainte
       * « a verifier » plutot que de comparer a l'egalite stricte, qui ne serait vraie pour
       * personne et ecarterait toutes les parcelles en silence.
       */
      return false;
  }
}

/** Evalue une contrainte de type `presence` : la parcelle touche-t-elle l'un des zonages ? */
function evaluerPresence(
  snapshot: ParcelleSnapshot,
  correspondance: Correspondance,
): { etat: EtatContrainte; valeur: number | null; chemin: string | null } {
  let mesureTrouvee = false;
  for (const chemin of correspondance.chemins) {
    const part = valeurAuChemin(snapshot, chemin);
    if (part === null) continue;
    mesureTrouvee = true;
    // Le premier zonage touche suffit : les chemins d'une meme contrainte sont en OU.
    if (part > 0) return { etat: 'enfreinte', valeur: part, chemin };
  }
  /*
   * Aucune part renseignee = la parcelle n'a pas ete croisee avec ces couches. Ce n'est PAS
   * « aucun zonage » : un releve incomplet et une parcelle hors zonage donnent tous deux zero
   * resultat, et les confondre ferait declarer conforme ce qui n'a pas ete regarde.
   */
  if (!mesureTrouvee) return { etat: 'donnee_absente', valeur: null, chemin: null };
  return { etat: 'respectee', valeur: 0, chemin: correspondance.chemins[0] ?? null };
}

/** Lit une valeur BRUTE (non numerique) a un chemin pointe. */
function brutAuChemin(snapshot: ParcelleSnapshot, chemin: string): unknown {
  let courant: unknown = snapshot;
  for (const segment of chemin.split('.')) {
    if (courant == null || typeof courant !== 'object') return null;
    courant = (courant as Record<string, unknown>)[segment];
  }
  return courant ?? null;
}

/**
 * Evalue un DRAPEAU : un booleen, ou un mot d'une liste fermee.
 *
 * Voir `Correspondance.cheminAbsence` pour la raison d'etre des trois etats. En resume : un plan
 * de prevention declare sur la COMMUNE n'est pas un verdict sur la PARCELLE, et son absence, elle,
 * en est un.
 */
function evaluerDrapeau(
  snapshot: ParcelleSnapshot,
  correspondance: Correspondance,
): { etat: EtatContrainte; valeur: number | null; chemin: string | null } {
  const chemin = correspondance.chemins[0] ?? null;
  if (chemin === null) return { etat: 'donnee_absente', valeur: null, chemin: null };

  const valeur = brutAuChemin(snapshot, chemin);
  const declenchantes = correspondance.valeursDeclenchantes;
  const incertaines = correspondance.valeursIncertaines ?? [];

  if (valeur !== null && valeur !== undefined) {
    if (typeof valeur === 'boolean') {
      return { etat: valeur ? 'enfreinte' : 'respectee', valeur: valeur ? 1 : 0, chemin };
    }
    const mot = String(valeur);
    if (incertaines.includes(mot)) return { etat: 'a_verifier', valeur: null, chemin };
    if (declenchantes && declenchantes.includes(mot)) {
      return { etat: 'enfreinte', valeur: null, chemin };
    }
    /*
     * Une valeur connue qui ne declenche pas EST une reponse : « zone humide : non » etablit que
     * la parcelle n'y est pas. La confondre avec une donnee absente perdrait un fait mesure.
     */
    return { etat: 'respectee', valeur: null, chemin };
  }

  // Le drapeau lui-meme est nul : l'absence du risque peut malgre tout etre etablie ailleurs.
  if (correspondance.cheminAbsence) {
    const presence = brutAuChemin(snapshot, correspondance.cheminAbsence);
    if (presence === false) return { etat: 'respectee', valeur: 0, chemin: correspondance.cheminAbsence };
    if (presence === true) return { etat: 'a_verifier', valeur: 1, chemin: correspondance.cheminAbsence };
  }
  return { etat: 'donnee_absente', valeur: null, chemin };
}

/** Evalue une contrainte de type `seuil`. */
function evaluerSeuil(
  snapshot: ParcelleSnapshot,
  correspondance: Correspondance,
  applique: SeuilApplique,
): { etat: EtatContrainte; valeur: number | null; chemin: string | null } {
  const chemin = correspondance.chemins[0] ?? null;
  if (chemin === null) return { etat: 'donnee_absente', valeur: null, chemin: null };

  const valeur = valeurAuChemin(snapshot, chemin);
  if (valeur === null) return { etat: 'donnee_absente', valeur: null, chemin };

  /*
   * Pas de condition applicable : le classeur ne tranche pas (seuil approximatif, regimes
   * multiples, sens non etabli) et aucun seuil developpeur n'est venu le fixer. La grandeur est
   * pourtant mesuree, donc on la RESTITUE — l'operateur peut juger sur piece — mais le moteur
   * s'abstient.
   */
  if (applique.condition === null) return { etat: 'a_verifier', valeur, chemin };
  if (applique.condition.operateur === 'egal') return { etat: 'a_verifier', valeur, chemin };

  return {
    etat: conditionRespectee(applique.condition, valeur) ? 'respectee' : 'enfreinte',
    valeur,
    chemin,
  };
}

/** Severite d'un niveau, pour designer la contrainte decisive. */
const SEVERITE: Record<ContrainteReferentiel['caractere'], number> = {
  redhibitoire: 3,
  penalisant: 2,
  favorable: 1,
  cadre: 0,
};

/**
 * Evalue une parcelle contre le referentiel de sa filiere.
 *
 * `mode` decide du seuil applique, et c'est l'unique entree qui le fasse : `'reglementaire'` pour
 * la carte, `'developpeur'` pour la recherche. Voir `seuils-developpeur.ts`, §2.3.
 */
export function evaluerVerdict(
  snapshot: ParcelleSnapshot,
  filiere: FiliereReferentiel,
  mode: ModeInterrogation,
  seuilsDeveloppeur: ReadonlyMap<string, SeuilDeveloppeur> = new Map(),
): ResultatVerdict {
  const contraintes: ContrainteEvaluee[] = [];
  const cadres: ContrainteEvaluee[] = [];

  for (const contrainte of contraintesDeFiliere(filiere)) {
    const applique = seuilApplique(contrainte, mode, seuilsDeveloppeur);
    const correspondance = correspondanceDe(contrainte.id);

    let etat: EtatContrainte = 'donnee_absente';
    let valeurMesuree: number | null = null;
    let cheminMesure: string | null = null;

    if (contrainte.caractere === 'cadre') {
      etat = 'cadre';
    } else if (correspondance) {
      const mesure =
        correspondance.mode === 'presence'
          ? evaluerPresence(snapshot, correspondance)
          : correspondance.mode === 'drapeau'
            ? evaluerDrapeau(snapshot, correspondance)
            : evaluerSeuil(snapshot, correspondance, applique);
      etat = mesure.etat;
      valeurMesuree = mesure.valeur;
      cheminMesure = mesure.chemin;
    }

    const evaluee: ContrainteEvaluee = {
      contrainteId: contrainte.id,
      nom: contrainte.nom,
      categorie: contrainte.categorie,
      caractere: contrainte.caractere,
      etat,
      seuilReglementaire: contrainte.seuilReglementaire,
      referenceReglementaire: contrainte.referenceReglementaire,
      coucheSig: contrainte.coucheSig,
      condition: applique.condition,
      origineSeuil: applique.origine,
      conditionReglementaire: applique.conditionReglementaire,
      motifDeveloppeur: applique.motifDeveloppeur,
      valeurMesuree,
      cheminMesure,
      raisons: applique.raisons,
    };

    if (etat === 'cadre') cadres.push(evaluee);
    else contraintes.push(evaluee);
  }

  const enfreintes = contraintes.filter((c) => c.etat === 'enfreinte');
  const aVerifier = contraintes.filter((c) => c.etat === 'a_verifier');
  const absentes = contraintes.filter((c) => c.etat === 'donnee_absente');

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * DEUX SORTES D'ECART, ET UNE SEULE FAIT LE VERDICT
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * CE QUE MON PREMIER JET FAISAIT, ET POURQUOI C'ETAIT FAUX. Il rendait « defavorable » des
   * qu'une contrainte de niveau redhibitoire etait enfreinte — sans regarder QUEL seuil avait ete
   * enfreint. Consequence mesuree sur le cas du §9.2 : une parcelle a 250 m des habitations,
   * parfaitement conforme au droit (100 m en declaration, 200 m en enregistrement), ressortait
   * « defavorable » parce qu'un developpeur exigeait 400 m chez lui. L'operateur aurait annonce
   * « ce terrain est defavorable » quand la loi dit l'inverse — et le developpeur suivant, moins
   * exigeant, n'aurait jamais vu la parcelle.
   *
   * Le verdict ne repond donc qu'a la question reglementaire, et ne compte que les seuils
   * reglementaires. L'ecart au cahier des charges est rendu a part : il sert a filtrer en mode 2,
   * jamais a declarer une parcelle inconstructible.
   */
  const ecartsCahierDesCharges = enfreintes.filter((c) => c.origineSeuil === 'developpeur');
  const enfreintesReglementaires = enfreintes.filter((c) => c.origineSeuil === 'reglementaire');
  const bloquantes = enfreintesReglementaires.filter((c) => c.caractere === 'redhibitoire');

  const verdict: Verdict =
    bloquantes.length > 0
      ? 'defavorable'
      : enfreintesReglementaires.length > 0 || aVerifier.length > 0 || absentes.length > 0
        ? 'a_instruire'
        : 'favorable';

  /*
   * La contrainte DECISIVE. Une enfreinte prime toujours une simple absence de donnee : c'est un
   * fait etabli contre une lacune, et c'est ce que l'operateur doit annoncer en premier. A
   * egalite, le niveau le plus severe l'emporte.
   */
  const candidates =
    enfreintesReglementaires.length > 0
      ? enfreintesReglementaires
      : ecartsCahierDesCharges.length > 0
        ? ecartsCahierDesCharges
        : [...aVerifier, ...absentes];
  const contrainteDecisive =
    candidates.length === 0
      ? null
      : candidates.reduce((a, b) => (SEVERITE[b.caractere] > SEVERITE[a.caractere] ? b : a));

  return {
    filiere,
    verdict,
    mode,
    contrainteDecisive,
    contraintes,
    ecartsCahierDesCharges,
    cadres,
    couverture: {
      total: contraintes.length,
      respectees: contraintes.filter((c) => c.etat === 'respectee').length,
      enfreintes: enfreintes.length,
      aVerifier: aVerifier.length,
      donneesAbsentes: absentes.length,
    },
  };
}

/**
 * Phrase d'explication d'une contrainte, pour l'ecran et pour le dossier.
 *
 * ELLE DOIT NOMMER LE SEUIL APPLIQUE ET SON ORIGINE, sans quoi l'operateur ne peut pas dire a un
 * developpeur si c'est le droit ou sa propre exigence qui ecarte la parcelle — et donc s'il y a
 * matiere a negocier. C'est la demande explicite du cahier des charges.
 */
export function expliquerContrainte(c: ContrainteEvaluee): string {
  const mesure =
    c.valeurMesuree === null
      ? 'non mesurée'
      : `mesuré ${c.valeurMesuree} ${c.condition?.unite ?? ''}`.trim();

  switch (c.etat) {
    case 'respectee':
      return `${c.nom} : respectée (${mesure}), seuil ${origine(c)}.`;
    case 'enfreinte':
      return (
        `${c.nom} : non respectée (${mesure}), seuil ${origine(c)}` +
        (c.origineSeuil === 'developpeur' && c.conditionReglementaire
          ? ` — la réglementation, elle, demande « ${c.seuilReglementaire} »`
          : '') +
        '.'
      );
    case 'a_verifier':
      return (
        `${c.nom} : à vérifier — le référentiel indique « ${c.seuilReglementaire} », ` +
        `qui ne tranche pas seul (${mesure}).`
      );
    case 'donnee_absente':
      return `${c.nom} : non évaluée, donnée absente. Référentiel : « ${c.seuilReglementaire} ».`;
    case 'cadre':
      return `${c.nom} : procédure applicable au projet — « ${c.seuilReglementaire} ».`;
  }
}

function origine(c: ContrainteEvaluee): string {
  if (c.condition === null) return 'non établi';
  const sens = c.condition.operateur.startsWith('min') ? 'au moins' : 'au plus';
  const qui = c.origineSeuil === 'developpeur' ? 'développeur' : 'réglementaire';
  return `${qui} (${sens} ${c.condition.valeur} ${c.condition.unite})`;
}
