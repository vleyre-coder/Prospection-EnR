/**
 * Fonctions utilitaires de notation.
 *
 * Toutes les notes sont exprimees sur 0-100. Les courbes sont definies par paliers
 * lineaires par morceaux, ce qui les rend lisibles et documentables : chaque critere
 * peut expliquer sa courbe a l'utilisateur ("a 5 km on note 70, a 10 km on note 30").
 */

export type Palier = readonly [valeur: number, note: number];

/**
 * Interpolation lineaire par morceaux.
 * Les paliers doivent etre ordonnes par valeur croissante ; les notes peuvent etre
 * croissantes ou decroissantes.
 */
export function paliers(valeur: number | null | undefined, points: readonly Palier[]): number | null {
  if (valeur == null || Number.isNaN(valeur)) return null;
  if (points.length === 0) return null;

  const premier = points[0]!;
  const dernier = points[points.length - 1]!;
  if (valeur <= premier[0]) return borne(premier[1]);
  if (valeur >= dernier[0]) return borne(dernier[1]);

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (valeur >= a[0] && valeur <= b[0]) {
      const largeur = b[0] - a[0];
      if (largeur === 0) return borne(b[1]);
      const ratio = (valeur - a[0]) / largeur;
      return borne(a[1] + ratio * (b[1] - a[1]));
    }
  }
  return borne(dernier[1]);
}

export function borne(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

/** Note binaire : `vrai` -> noteVrai, `faux` -> noteFaux, null -> null. */
export function booleen(
  valeur: boolean | null | undefined,
  noteVrai: number,
  noteFaux: number,
): number | null {
  if (valeur == null) return null;
  return borne(valeur ? noteVrai : noteFaux);
}

/** Note issue d'un dictionnaire de correspondance ; valeur inconnue -> null. */
export function correspondance<T extends string>(
  valeur: T | null | undefined,
  table: Partial<Record<T, number>>,
  defaut: number | null = null,
): number | null {
  if (valeur == null) return null;
  const n = table[valeur];
  if (n == null) return defaut == null ? null : borne(defaut);
  return borne(n);
}

/**
 * Combine plusieurs sous-notes en prenant la plus penalisante (logique de contrainte :
 * la contrainte la plus forte gouverne).
 */
export function pire(...notes: Array<number | null>): number | null {
  const valides = notes.filter((n): n is number => n != null);
  if (valides.length === 0) return null;
  return borne(Math.min(...valides));
}

/** Combine plusieurs sous-notes en moyenne, en ignorant les valeurs manquantes. */
export function moyenne(...notes: Array<number | null>): number | null {
  const valides = notes.filter((n): n is number => n != null);
  if (valides.length === 0) return null;
  return borne(valides.reduce((a, b) => a + b, 0) / valides.length);
}

/**
 * Moyenne, ET la mention de ce qui a ete ignore.
 *
 * `moyenne` est muette sur les indicateurs absents : la moyenne de trois indicateurs dont un
 * seul est renseigne se presente comme la moyenne de trois. Un critere composite peut ainsi
 * afficher une note d'apparence solide construite sur un tiers de l'information, et rien dans
 * la fiche ne le dit.
 *
 * Le suffixe est vide quand tout est renseigne : on ne charge pas la lecture pour rien.
 */
export function moyenneTracee(...notes: Array<number | null>): {
  note: number | null;
  disponibles: number;
  total: number;
  /** « (2/3 indicateurs disponibles) », ou chaine vide si tout est renseigne. */
  suffixe: string;
} {
  const total = notes.length;
  const disponibles = notes.filter((n) => n != null).length;
  return {
    note: moyenne(...notes),
    disponibles,
    total,
    suffixe:
      disponibles === total || disponibles === 0
        ? ''
        : ` (${disponibles}/${total} indicateurs disponibles)`,
  };
}

/** Formate une distance en m ou km selon l'ordre de grandeur. */
export function formatDistance(m: number | null | undefined): string {
  if (m == null) return 'donnee indisponible';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

export function formatNombre(n: number | null | undefined, unite = '', decimales = 1): string {
  if (n == null) return 'donnee indisponible';
  return `${n.toFixed(decimales).replace('.', ',').replace(/,0$/, '')}${unite ? ` ${unite}` : ''}`;
}

export function formatBooleen(b: boolean | null | undefined, oui = 'Oui', non = 'Non'): string {
  if (b == null) return 'donnee indisponible';
  return b ? oui : non;
}


