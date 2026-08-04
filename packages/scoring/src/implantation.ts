/**
 * Geometrie d'implantation : de quelle marge dispose-t-on a l'interieur d'une parcelle ?
 *
 * Les reculs reglementaires — 500 m pour un aerogenerateur (art. L.515-44 du code de
 * l'environnement), 200 m pour une unite de methanisation soumise a enregistrement ou
 * autorisation — se mesurent depuis l'INSTALLATION, jamais depuis la limite de la parcelle.
 *
 * Confondre les deux a une consequence couteuse et invisible : une parcelle dont le bord
 * est a 430 m d'une habitation peut parfaitement accueillir une machine a 520 m, mais elle
 * etait ecartee du classement, donc jamais examinee. L'erreur ne produit pas un faux
 * positif qu'on remarque, mais un faux negatif qu'on ne voit pas.
 */

/**
 * Deport maximal plausible, en metres, entre le bord d'une parcelle et le point
 * d'implantation le plus eloigne.
 *
 * Approximation par le rayon du disque de meme surface. Elle est volontairement
 * CONSERVATRICE : une parcelle reelle n'est jamais circulaire, et le deport reellement
 * disponible dans la direction utile est au mieux egal a cette valeur, souvent inferieur
 * pour une parcelle en lanieres. Elle ne remplace donc pas une etude d'implantation, et le
 * motif affiche le dit.
 *
 * Ordres de grandeur : 1 ha -> 56 m, 10 ha -> 178 m, 80 ha -> 505 m.
 */
export function deportPossibleM(surfaceHa: number | null | undefined): number {
  if (surfaceHa == null || !Number.isFinite(surfaceHa) || surfaceHa <= 0) return 0;
  return Math.sqrt((surfaceHa * 10000) / Math.PI);
}

/**
 * Distance maximale atteignable entre l'installation et la contrainte, compte tenu du
 * deport possible a l'interieur de la parcelle.
 */
export function distanceAtteignableM(
  distanceBordM: number,
  surfaceHa: number | null | undefined,
): number {
  return distanceBordM + deportPossibleM(surfaceHa);
}

// ---------------------------------------------------------------------------
// Surface reellement implantable
// ---------------------------------------------------------------------------

/**
 * Largeur de la bande perdue le long du perimetre, en metres, par filiere.
 *
 * Elle regroupe ce qui est systematiquement soustrait a la surface cadastrale : cloture et
 * son recul, piste peripherique de circulation, bande d'acces des services d'incendie et de
 * secours. Ce sont des ORDRES DE GRANDEUR de conception, non des seuils reglementaires - les
 * prescriptions reelles figurent dans l'avis du SDIS et, pour les ICPE, dans l'arrete
 * ministeriel applicable.
 *
 * L'eolien fait exception : la surface d'un parc ne se raisonne pas en emprise continue mais
 * en positions de machines, et une bande perimetrale n'a pas de sens. La deduction y est donc
 * nulle, et le critere de surface conserve son role de proxy de capacite d'accueil.
 */
export const BANDE_PERIMETRALE_M: Record<string, number> = {
  solaire_sol: 5,
  bess: 7,
  methanisation: 5,
  eolien_terrestre: 0,
};

export interface SurfaceUtile {
  /** Surface cadastrale de depart, en hectares. */
  bruteHa: number;
  /** Surface estimee reellement implantable, en hectares. */
  netteHa: number;
  /** Part conservee, entre 0 et 1. */
  coefficient: number;
  /** Explication de la deduction, affichable telle quelle. */
  detail: string;
}

/**
 * Estime la surface reellement implantable a partir de la surface cadastrale.
 *
 * Le critere de surface notait jusqu'ici la surface CADASTRALE brute, sans deduire ni les
 * reculs, ni la piste peripherique, ni la bande d'acces incendie. Sur une parcelle de taille
 * courante, l'ecart entre surface cadastrale et surface implantable va de 15 a 30 % : le
 * critere surestimait donc systematiquement, et d'autant plus fortement que la parcelle est
 * petite ou decoupee - c'est-a-dire precisement la ou la decision est serree.
 *
 * Modele : erosion du contour d'une largeur `r`. Pour une forme convexe, l'aire erodee vaut
 * `A - P.r + pi.r^2`, ou `P` est le perimetre. Le perimetre n'etant pas porte par le
 * snapshot, il est reconstruit a partir du cercle de meme surface (`P0 = 2.racine(pi.A)`)
 * majore par l'indice de morcellement : une parcelle en lanieres a un perimetre bien
 * superieur a celui du disque equivalent, et perd donc davantage.
 *
 * L'estimation est volontairement PRUDENTE et ne remplace pas un plan de masse. Elle est
 * affichee comme une estimation, a cote de la surface cadastrale.
 */
export function surfaceUtileEstimee(
  surfaceHa: number | null | undefined,
  morcellementIndice: number | null | undefined,
  filiere: string,
): SurfaceUtile | null {
  if (surfaceHa == null || !Number.isFinite(surfaceHa) || surfaceHa <= 0) return null;

  const r = BANDE_PERIMETRALE_M[filiere] ?? 0;
  if (r === 0) {
    return {
      bruteHa: surfaceHa,
      netteHa: surfaceHa,
      coefficient: 1,
      detail:
        "Aucune deduction : la surface d'un parc eolien se raisonne en positions de machines, non en emprise continue.",
    };
  }

  const aM2 = surfaceHa * 10000;
  const perimetreDisque = 2 * Math.sqrt(Math.PI * aM2);
  // Indice 0 = compacte, 100 = tres decoupee. Un indice de 50 majore le perimetre de moitie.
  const majoration = 1 + Math.min(100, Math.max(0, morcellementIndice ?? 30)) / 100;
  const perimetre = perimetreDisque * majoration;

  const netteM2 = aM2 - perimetre * r + Math.PI * r * r;
  // Une parcelle trop etroite est entierement consommee par la bande : la surface nette
  // tombe a zero, ce qui est le resultat correct et non un cas a masquer.
  const netteHa = Math.max(0, netteM2) / 10000;
  const coefficient = netteHa / surfaceHa;

  return {
    bruteHa: surfaceHa,
    netteHa: Math.round(netteHa * 10000) / 10000,
    coefficient: Math.round(coefficient * 1000) / 1000,
    detail:
      `Estimation : ${Math.round(coefficient * 100)} % de la surface cadastrale, apres deduction ` +
      `d'une bande perimetrale de ${r} m (cloture, piste de circulation, acces des secours). ` +
      `Ordre de grandeur de conception, a confirmer par un plan de masse et l'avis du SDIS.`,
  };
}

// ---------------------------------------------------------------------------
// Lineaire de raccordement
// ---------------------------------------------------------------------------

// COEFFICIENT_TRACE et lineaireRaccordementKm vivent desormais dans @enr/core : la carte
// en a besoin autant que le moteur, et deux definitions auraient fini par diverger.
export { COEFFICIENT_TRACE, lineaireRaccordementKm } from '@enr/core';
