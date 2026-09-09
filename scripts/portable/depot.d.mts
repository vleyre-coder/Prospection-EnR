/**
 * Declarations de types pour `depot.mjs`. Meme motif que `animation.d.mts` : ce module est importe
 * par un test, et sans declaration il arrivait en `any` — le test ne verifiait donc plus les
 * signatures de ce garde, celui qui empeche d'envoyer `donnees/` ou un `.env` sur GitHub.
 */

/** La racine du depot, resolue depuis l'emplacement du script. */
export const RACINE: string;

/** Un chemin interdit et la raison de son interdiction. */
export interface Interdit {
  motif: RegExp;
  raison: string;
}

/** Les chemins qui ne doivent jamais partir : base de donnees, secrets, jetons. */
export const INTERDITS: readonly Interdit[];

/** Un chemin refuse, avec la raison qui l'a fait refuser. */
export interface Refuse {
  chemin: string;
  raison: string;
}

/** Repartit des chemins entre autorises et refuses. Les barres obliques inverses sont normalisees. */
export function trier(chemins: readonly string[]): {
  autorises: string[];
  refuses: Refuse[];
};

/**
 * Ce qu'il faut faire de ces chemins.
 *
 * `'refuser'` des qu'un chemin est interdit et que `forcer` est faux ; `'rien'` s'il n'y a rien a
 * envoyer ; `'envoyer'` sinon.
 */
export function decider(
  chemins: readonly string[],
  options?: { forcer?: boolean },
): { action: 'refuser' | 'rien' | 'envoyer'; autorises: string[]; refuses: Refuse[] };

export function estUnDepotGit(): boolean;
export function cheminsModifies(): string[];
export function brancheCourante(): string;

/** Le journal minimal attendu : `console` en satisfait le contrat. */
interface Journal {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function mettreAJour(options?: { journal?: Journal }): unknown;
export function pousser(options?: {
  message?: string;
  forcer?: boolean;
  journal?: Journal;
}): unknown;
