/**
 * Declarations de types pour `animation.mjs`.
 *
 * POURQUOI CE FICHIER EXISTE. `apps/web/tsconfig.json` n'incluait que `src/**\/*` : les tests
 * n'etaient PAS types, et personne ne l'avait mesure. Une fois `test/**\/*` inclus, TypeScript a
 * rendu six erreurs, dont trois `TS7016` — trois modules `.mjs` importes par des tests sans aucune
 * declaration, donc silencieusement typés `any`. Un test qui manipule un `any` ne verifie plus les
 * signatures de ce qu'il appelle : la valeur de preuve du test s'arrete au comportement.
 *
 * Les declarations sont ECRITES A LA MAIN et non generees, parce que les scripts portables doivent
 * rester du JavaScript pur — ils tournent sur la machine de l'utilisateur final, sans etape de
 * construction. C'est un choix assume du depot ; ce fichier en paie le prix sans le remettre en
 * cause.
 */

/** Les dix images de la roue d'attente, dans l'ordre. */
export const IMAGES: readonly string[];

/** Une duree en millisecondes, mise en forme a la francaise (« 0,4 s », « 12 s »). */
export function duree(ms: number): string;

/** Le bandeau d'ouverture, sur trois lignes. */
export function banniere(largeur?: number): string;

/** Le flux de sortie minimal dont l'animation a besoin. */
interface FluxSortie {
  write(texte: string): unknown;
  isTTY?: boolean;
}

/**
 * Le flux d'entree minimal dont l'attente de touche a besoin.
 *
 * TOUT EST OPTIONNEL, ET CE N'EST PAS UN RELACHEMENT. `attendreLecture` rend la main avant de rien
 * appeler quand l'un des deux flux n'est pas un terminal ; ce n'est qu'au-dela de ce garde qu'elle
 * exige `once`, `resume`, `pause` et `removeListener`. TypeScript ne sait pas exprimer « ces
 * membres sont requis SI `isTTY` est vrai », et un test legitime passe `{ isTTY: false }` seul.
 * Exiger les cinq membres refuserait donc un appel correct.
 */
interface FluxEntree {
  isTTY?: boolean;
  setRawMode?(actif: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
  /** `once` et non `on` : l'ecouteur est retire des la premiere touche. */
  once?(evenement: 'data', ecouteur: () => void): unknown;
  removeListener?(evenement: 'data', ecouteur: () => void): unknown;
}

export class Progression {
  constructor(options?: {
    sortie?: FluxSortie;
    /** `null` : deduit de `sortie.isTTY`. Force a `true` ou `false` par les tests. */
    interactif?: boolean | null;
    /** Horloge injectable, pour que les tests ne dependent pas du temps reel. */
    maintenant?: () => number;
  });
  ecrire(texte: string): void;
  effacerLigne(): void;
  demarrer(libelle: string): void;
  peindre(): void;
  arreter(): void;
  reussi(precision?: string): void;
  echoue(raison?: string): void;
  note(texte: string): void;
  /**
   * Enveloppe une promesse : roue pendant, coche apres, croix si elle casse.
   *
   * Rend le resultat de la tache, et RELANCE son erreur : c'est ce qui permet d'ecrire
   * `const { pgdata } = await progression.pendant(...)` dans les scripts portables.
   */
  pendant<T>(libelle: string, tache: () => Promise<T>): Promise<T>;
}

/**
 * Attend une touche, et rend la RAISON de son retour.
 *
 * `'non interactif'` quand l'un des deux flux n'est pas un terminal — le cas de l'integration
 * continue, ou attendre une touche bloquerait indefiniment. `'touche'` ou `'delai'` sinon.
 */
export function attendreLecture(
  entree?: FluxEntree,
  sortie?: FluxSortie,
  plafondMs?: number,
): Promise<'non interactif' | 'touche' | 'delai'>;
