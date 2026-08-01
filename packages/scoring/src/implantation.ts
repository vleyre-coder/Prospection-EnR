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
