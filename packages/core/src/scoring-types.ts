/**
 * Types de sortie du moteur de scoring.
 *
 * Exigence produit : le score doit etre EXPLICABLE. Le moteur ne renvoie donc jamais
 * un simple nombre, mais la liste complete des criteres evalues, leur note, leur poids,
 * leur contribution au score final, la source de la donnee et, le cas echeant, le motif
 * de mise a l'ecart.
 */

import type { Filiere } from './filieres.js';
import type { Feu, SourceRef } from './types.js';

/** Familles de criteres, telles qu'affichees dans la fiche parcelle. */
export const FAMILLES_CRITERES = [
  'raccordement',
  'gisement',
  'urbanisme',
  'sol',
  'topographie',
  'surface',
  'environnement',
  'patrimoine',
  'risques',
  'distances_reglementaires',
  'foncier',
  'acces',
] as const;

export type FamilleCritere = (typeof FAMILLES_CRITERES)[number];

export const FAMILLES_LIBELLES: Record<FamilleCritere, string> = {
  raccordement: 'Raccordement',
  gisement: 'Gisement / ressource',
  urbanisme: 'Urbanisme',
  sol: 'Statut et nature du sol',
  topographie: 'Topographie',
  surface: 'Surface et parcellaire',
  environnement: 'Sensibilite environnementale',
  patrimoine: 'Contraintes patrimoniales',
  risques: 'Risques',
  distances_reglementaires: 'Distances reglementaires',
  foncier: 'Foncier',
  acces: 'Acces et desserte',
};

/** Definition statique d'un critere ponderé. */
export interface DefinitionCritere {
  id: string;
  libelle: string;
  famille: FamilleCritere;
  /** Explication affichee au survol : ce que mesure le critere et pourquoi il compte. */
  explication: string;
  /** Unite de la valeur brute, pour affichage. */
  unite?: string;
}

/** Resultat de l'evaluation d'un critere pondere pour une parcelle donnee. */
export interface EvaluationCritere {
  id: string;
  libelle: string;
  famille: FamilleCritere;
  /** Note normalisee 0-100, ou null si la donnee est indisponible. */
  note: number | null;
  /** Poids applique (0-1, normalise sur l'ensemble des criteres evalues). */
  poids: number;
  /** Contribution au score global, en points de score. */
  contribution: number;
  /** Feu tricolore du critere (gris si donnee indisponible). */
  feu: Feu;
  /** Valeur brute mesuree. */
  valeurBrute: number | string | boolean | null;
  /** Valeur formatee pour affichage, ex. "3,2 km" ou "Zone A - agricole". */
  valeurAffichee: string;
  /** Commentaire explicatif contextuel, ex. "Au-dela de 10 km, cout de raccordement redhibitoire". */
  commentaire: string | null;
  /** Source de la donnee utilisee (tracabilite). */
  source: SourceRef | null;
  /** Identifiants de regles reglementaires liees, pour affichage des seuils dates. */
  reglesLiees: string[];
}

/** Critere redhibitoire declenche (knock-out). */
export interface KnockOut {
  id: string;
  libelle: string;
  /** Motif circonstancie, affiche en tete de la fiche. */
  motif: string;
  famille: FamilleCritere;
  /** Identifiant de la regle reglementaire fondant le knock-out. */
  regleLiee: string | null;
  source: SourceRef | null;
  /**
   * Un knock-out "derogeable" n'ecarte pas definitivement la parcelle : il la fait
   * basculer en ORANGE avec une alerte forte, plutot qu'en ROUGE.
   */
  derogeable: boolean;
}

/** Seuil de procedure a rappeler dans la fiche (ICPE, PC, evaluation environnementale...). */
export interface SeuilProcedure {
  regleId: string;
  libelle: string;
  reference: string;
  dateEntreeEnVigueur: string;
  /** Applicable au vu des caracteristiques estimees de la parcelle. */
  applicable: boolean | null;
  commentaire: string | null;
}

export interface PointSynthese {
  critereId: string;
  libelle: string;
  /** Valeur affichee du critere. */
  valeur: string;
  /** Contribution en points (positive pour un point fort, negative en relatif). */
  impact: number;
}

/** Resultat complet du scoring d'une parcelle pour une filiere. */
export interface ResultatScore {
  idu: string;
  filiere: Filiere;
  /** Statut de coloration de la parcelle sur la carte. */
  statut: Feu;
  /** Score global 0-100. null si la parcelle est ecartee (rouge) ou si les donnees manquent. */
  scoreGlobal: number | null;
  /** Criteres redhibitoires declenches. Non vide => statut rouge (ou orange si derogeable). */
  knockOuts: KnockOut[];
  /** Detail critere par critere. */
  criteres: EvaluationCritere[];
  /** Les 3 principaux points forts. */
  pointsForts: PointSynthese[];
  /** Les 3 principaux points de vigilance. */
  pointsVigilance: PointSynthese[];
  /** Seuils de procedure applicables, avec leur date. */
  seuilsProcedure: SeuilProcedure[];
  /**
   * Indice de couverture de donnees, 0-1 : part du poids total portee par des criteres
   * effectivement renseignes. En dessous du seuil de fiabilite, le statut passe a GRIS.
   */
  couvertureDonnees: number;
  /** Regime d'implantation retenu (specifique solaire), ex. "agrivoltaisme". */
  regimeImplantation: string | null;
  /** Ponderations effectivement appliquees (tracabilite du calcul). */
  ponderationsAppliquees: Record<string, number>;
  /** Version du moteur de scoring, pour invalidation du cache. */
  versionMoteur: string;
  dateCalcul: string;
  /** Avertissements a afficher au-dessus de la fiche. */
  avertissements: string[];
}

/** Profil de ponderation, modifiable par l'utilisateur via des curseurs. */
export interface ProfilPonderation {
  filiere: Filiere;
  /** Poids brut par identifiant de critere. Ils sont normalises a la somme 1 au calcul. */
  poids: Record<string, number>;
  /** Seuil de score en dessous duquel la parcelle est ORANGE plutot que VERTE. */
  seuilVert: number;
  /** Seuil de score en dessous duquel la parcelle est ROUGE plutot que ORANGE. */
  seuilOrange: number;
  /** Couverture de donnees minimale en dessous de laquelle la parcelle est GRISE. */
  seuilCouvertureDonnees: number;
}

/** Options de calcul transmises par l'API. */
export interface OptionsScoring {
  /** Profil de ponderation a appliquer (sinon profil par defaut de la filiere). */
  ponderation?: Partial<ProfilPonderation>;
  /**
   * Desactive certains knock-outs, ex. pour explorer un scenario derogatoire.
   * L'interface doit signaler clairement que le mode est degrade.
   */
  knockOutsDesactives?: string[];
  /** Puissance envisagee, en MWc / MW, pour determiner les seuils de procedure. */
  puissanceEnvisageeMw?: number | null;
  /** Tonnage envisage en t/j, pour la methanisation. */
  tonnageEnvisageTj?: number | null;
}
