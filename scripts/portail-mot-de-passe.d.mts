/**
 * Declarations de types pour `portail-mot-de-passe.mjs`. Meme motif que les deux autres : importe
 * par `apps/web/test/portail-netlify.test.ts`, il arrivait en `any`. Ce module decide si un mot de
 * passe de portail est acceptable — le typer n'est pas cosmetique.
 */

/** Longueur minimale exigee d'un mot de passe de portail. */
export const LONGUEUR_MINIMALE: number;

/** Nombre minimal de caracteres DISTINCTS exiges. */
export const DISTINCTS_MINIMAUX: number;

/** Les fragments qui font refuser un mot de passe quel que soit le reste. */
export const MARQUEURS_REFUSES: readonly string[];

/**
 * Verdict sur un candidat.
 *
 * `probleme` est present exactement quand `ok` est faux, et il est ecrit pour etre affiche tel quel.
 */
export function evaluer(candidat: unknown): { ok: true } | { ok: false; probleme: string };

/** Un mot de passe tire au hasard : 24 octets en base64url, soit environ 144 bits. */
export function proposer(): string;
