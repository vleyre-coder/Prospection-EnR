/**
 * Declarations de types pour `amorce.mjs`. Meme motif qu'`animation.d.mts` et `depot.d.mts` : ce
 * module est importe par un test et, sans declaration, arrivait en `any`. Le test ne verifiait
 * donc plus aucune signature de ce garde — celui qui decide quelles tables partent dans une
 * archive distribuee, et lesquelles ne doivent JAMAIS en sortir (donnees nominatives, comptes,
 * secret de signature des jetons).
 *
 * Ecrites a la main, et il faut dire pourquoi : ces scripts doivent rester du JavaScript pur. Ils
 * tournent chez l'utilisateur final, sans etape de construction.
 */

/** La racine du depot, resolue depuis l'emplacement du script. */
export const RACINE: string;

/** Tables embarquees dans l'archive, avec le motif de leur presence. */
export const TABLES_EMBARQUEES: Record<string, string>;

/** Tables ECARTEES de l'archive, avec le motif de leur exclusion. */
export const TABLES_ECARTEES: Record<string, string>;

/**
 * Les tables reellement declarees par le schema, lues dans `db/migrations`.
 *
 * Le schema est la seule source de verite : une liste recopiee a la main se desynchronise a la
 * premiere migration, et en silence.
 */
export function tablesDuSchema(dossier?: string): string[];

/** Repartit des tables entre embarquees, ecartees, et celles dont personne n'a tranche. */
export function classer(tables?: readonly string[]): {
  embarquees: string[];
  ecartees: string[];
  /** Non vide = une migration a ajoute une table sans decider de son sort. */
  nonClassees: string[];
};

/** Verifie le contenu d'une archive d'amorce : ce qu'elle porte, et ce qu'elle n'aurait pas du. */
export function verifierAmorce(chemin: string): Promise<{
  tablesTrouvees: string[];
  /** Non vide = l'archive porte une table ecartee. Aucune ne doit en sortir. */
  fautes: string[];
  octetsDecompresses: number;
}>;
