/**
 * Validation des corps de requete, avant qu'ils n'atteignent le constructeur SQL.
 *
 * POURQUOI CE MODULE EXISTE. La route de recherche faisait
 * `filtrerParcelles({ ...corps } as FiltresParcelles)` : un `as` ne verifie rien a l'execution,
 * et le corps JSON partait tel quel dans le SQL. Quatre entrees client mesurees produisaient
 * chacune un **HTTP 500** :
 *
 *   {"limite": -5}                    -> LIMIT must not be negative
 *   {"decalage": -10}                 -> OFFSET must not be negative
 *   {"surfaceMinHa": "abc"}           -> invalid input syntax for type integer
 *   {"statutsScore": "pas_un_tableau"} -> malformed array literal
 *
 * Deux problemes distincts. Une faute de saisie signalee comme une panne serveur : l'utilisateur
 * ne peut pas savoir quoi corriger, et une supervision reveille une astreinte. Et `limite`
 * n'etait pas plafonnee : `{"limite": 100000}` etait accepte, soit une lecture de toute la table
 * en un appel sur une base nationale.
 *
 * PRINCIPE RETENU : liste blanche, et refus explicite. Un champ inconnu est REFUSE plutot
 * qu'ignore — un filtre mal orthographie qui passe en silence donne un resultat plus large que
 * demande, ce qui est la pire des reponses possibles pour un outil de tri. Aucune coercition
 * non plus : `"12"` n'est pas 12. Accepter une chaine numerique aujourd'hui obligerait a deviner
 * demain si `"1e3"`, `"12,5"` ou `" 12 "` en sont aussi.
 */

/** Erreur de validation. Portee jusqu'a la route, qui la rend en 400 avec son motif. */
export class ErreurValidation extends Error {
  constructor(
    readonly champ: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurValidation';
  }
}

const refus = (champ: string, attendu: string, recu: unknown): never => {
  const vu =
    recu === undefined
      ? 'absent'
      : typeof recu === 'object'
        ? JSON.stringify(recu).slice(0, 60)
        : `${typeof recu} ${JSON.stringify(recu)}`;
  throw new ErreurValidation(champ, `Champ \`${champ}\` : ${attendu}. Recu : ${vu}.`);
};

/**
 * Lecteur de champs a liste blanche.
 *
 * Il retient les cles consultees, ce qui permet de refuser en fin de course toute cle du corps
 * qui n'a ete lue par personne.
 */
export class Lecteur {
  private readonly vues = new Set<string>();

  constructor(private readonly corps: Record<string, unknown>) {}

  private brut(champ: string): unknown {
    this.vues.add(champ);
    return this.corps[champ];
  }

  /** Nombre fini, avec bornes inclusives facultatives. */
  nombre(champ: string, options: { min?: number; max?: number; entier?: boolean } = {}): number | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) return refus(champ, 'nombre attendu', v);
    if (options.entier && !Number.isInteger(v)) return refus(champ, 'entier attendu', v);
    if (options.min !== undefined && v < options.min) {
      return refus(champ, `valeur minimale ${options.min}`, v);
    }
    if (options.max !== undefined && v > options.max) {
      return refus(champ, `valeur maximale ${options.max}`, v);
    }
    return v;
  }

  booleen(champ: string): boolean | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'boolean') return refus(champ, 'booleen attendu (true ou false)', v);
    return v;
  }

  /** Chaine non vide, longueur bornee, eventuellement contrainte par une expression. */
  texte(
    champ: string,
    options: { max?: number; motif?: RegExp; description?: string } = {},
  ): string | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') return refus(champ, 'chaine attendue', v);
    const t = v.trim();
    if (t === '') return undefined;
    if (options.max !== undefined && t.length > options.max) {
      return refus(champ, `au plus ${options.max} caracteres`, v);
    }
    if (options.motif && !options.motif.test(t)) {
      return refus(champ, options.description ?? `format attendu ${String(options.motif)}`, v);
    }
    return t;
  }

  /** Valeur appartenant a un ensemble ferme. */
  parmi<T extends string>(champ: string, valeurs: readonly T[]): T | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || !(valeurs as readonly string[]).includes(v)) {
      return refus(champ, `une valeur parmi ${valeurs.join(', ')}`, v);
    }
    return v as T;
  }

  /** Tableau non vide de valeurs appartenant a un ensemble ferme. */
  listeParmi<T extends string>(champ: string, valeurs: readonly T[], maxElements = 50): T[] | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) return refus(champ, 'tableau attendu', v);
    if (v.length === 0) return undefined;
    if (v.length > maxElements) return refus(champ, `au plus ${maxElements} elements`, v.length);
    for (const e of v) {
      if (typeof e !== 'string' || !(valeurs as readonly string[]).includes(e)) {
        return refus(champ, `elements parmi ${valeurs.join(', ')}`, e);
      }
    }
    return v as T[];
  }

  /** Tableau de chaines libres, borne en nombre et en longueur. */
  listeTexte(champ: string, maxElements: number, maxLongueur: number): string[] | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) return refus(champ, 'tableau attendu', v);
    if (v.length === 0) return undefined;
    if (v.length > maxElements) return refus(champ, `au plus ${maxElements} elements`, v.length);
    for (const e of v) {
      if (typeof e !== 'string' || e.length === 0 || e.length > maxLongueur) {
        return refus(champ, `chaines de 1 a ${maxLongueur} caracteres`, e);
      }
    }
    return v as string[];
  }

  /**
   * Emprise geographique, validee comme partout ailleurs dans l'application.
   *
   * La meme validation existait dans `bboxDepuisChaine`, mais elle ne servait qu'aux chemins en
   * chaine de requete : le corps JSON — celui que l'interface utilise reellement — ne passait
   * par aucun controle, et une emprise couvrant le monde entier etait acceptee.
   */
  bbox(champ: string, valider: (b: [number, number, number, number]) => boolean): [number, number, number, number] | undefined {
    const v = this.brut(champ);
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v) || v.length !== 4) {
      return refus(champ, 'tableau de 4 nombres [ouest, sud, est, nord]', v);
    }
    for (const n of v) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return refus(champ, '4 nombres finis', n);
    }
    const b = v as [number, number, number, number];
    if (!valider(b)) {
      return refus(
        champ,
        'emprise invalide : coordonnees hors domaine, bornes inversees, ou etendue superieure au double de la France metropolitaine',
        b,
      );
    }
    return b;
  }

  /**
   * Refuse toute cle du corps qui n'a pas ete lue.
   *
   * C'est la partie du controle qui protege de l'erreur la plus insidieuse : un filtre mal
   * orthographie — `surfaceMinHA`, `exclureNatura2000s` — serait sinon ignore en silence, et la
   * liste renverrait plus de parcelles que demande sans que rien ne le signale.
   */
  refuserInconnus(sauf: readonly string[] = []): void {
    const inconnues = Object.keys(this.corps).filter(
      (c) => !this.vues.has(c) && !sauf.includes(c),
    );
    if (inconnues.length > 0) {
      throw new ErreurValidation(
        inconnues[0]!,
        `Champ(s) inconnu(s) : ${inconnues.join(', ')}. Un filtre mal orthographie serait ignore ` +
          'en silence et elargirait le resultat sans le dire.',
      );
    }
  }
}

/** Prepare un lecteur, en refusant d'emblee un corps qui n'est pas un objet. */
export function lecteur(corps: unknown, ou = 'corps de requete'): Lecteur {
  if (corps == null || typeof corps !== 'object' || Array.isArray(corps)) {
    throw new ErreurValidation(ou, `Le ${ou} doit etre un objet JSON.`);
  }
  return new Lecteur(corps as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Parametres de requete (chaine de requete)
// ---------------------------------------------------------------------------

/**
 * Entier borne lu dans la chaine de requete.
 *
 * POURQUOI CETTE FONCTION EXISTE — audit 8, defaut C7. Six routes ecrivaient
 * `Math.min(Number(q.limite ?? 2000), 5000)`. Or `Number('abc')` vaut `NaN`, `Math.min(NaN, 5000)`
 * vaut `NaN`, et ce `NaN` partait tel quel en parametre SQL. Verifie contre le serveur PostgreSQL :
 *
 *     valeur NaN       -> invalid input syntax for type bigint: "NaN"
 *     valeur Infinity  -> invalid input syntax for type bigint: "Infinity"
 *     valeur -5        -> LIMIT must not be negative
 *
 * L'erreur `pg` ne porte pas de `statusCode`, si bien que le gestionnaire global repondait
 * **500 erreur_interne** la ou 400 est la reponse juste. Aucune injection n'etait possible — les
 * requetes sont parametrees — mais un parametre malforme ne doit pas produire une erreur serveur.
 *
 * Le plafond est applique en SILENCE et non par un refus : un client qui demande 100 000 lignes
 * exprime une intention legitime, mal calibree. En revanche une valeur qui n'est pas un entier est
 * une ERREUR d'appel, et se signale comme telle — la confondre avec la valeur par defaut cacherait
 * une faute de programmation cote client.
 */
export function entierRequete(
  brut: unknown,
  champ: string,
  options: { defaut: number; min?: number; max: number },
): number {
  if (brut === undefined || brut === null || brut === '') return options.defaut;
  if (typeof brut !== 'string' && typeof brut !== 'number') {
    return refus(champ, 'entier attendu', brut);
  }
  // `Number(' ')` vaut 0 et `Number([])` vaut 0 : on exige une ecriture explicite d'entier.
  const texte = String(brut).trim();
  if (!/^-?\d+$/.test(texte)) {
    return refus(champ, 'entier attendu (chiffres uniquement)', brut);
  }
  const v = Number(texte);
  if (!Number.isSafeInteger(v)) return refus(champ, 'entier hors des bornes representables', brut);
  const min = options.min ?? 0;
  if (v < min) return refus(champ, `valeur minimale ${min}`, brut);
  return Math.min(v, options.max);
}

/**
 * Nombre fini borne lu dans la chaine de requete.
 * Meme raisonnement que `entierRequete`, pour les grandeurs continues (rayons, surfaces).
 */
export function nombreRequete(
  brut: unknown,
  champ: string,
  options: { defaut: number; min?: number; max: number },
): number {
  if (brut === undefined || brut === null || brut === '') return options.defaut;
  if (typeof brut !== 'string' && typeof brut !== 'number') {
    return refus(champ, 'nombre attendu', brut);
  }
  const texte = String(brut).trim();
  if (!/^-?\d+(\.\d+)?$/.test(texte)) return refus(champ, 'nombre attendu', brut);
  const v = Number(texte);
  if (!Number.isFinite(v)) return refus(champ, 'nombre fini attendu', brut);
  const min = options.min ?? 0;
  if (v < min) return refus(champ, `valeur minimale ${min}`, brut);
  return Math.min(v, options.max);
}
