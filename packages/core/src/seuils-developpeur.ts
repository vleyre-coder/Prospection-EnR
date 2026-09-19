/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * SEUIL REGLEMENTAIRE, SEUIL DEVELOPPEUR — et lequel des deux s'applique
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LA REGLE, telle que le cahier des charges la pose au §2.3, et elle ne souffre aucune nuance :
 *
 *   - le seuil REGLEMENTAIRE est IMMUABLE. Il vient du classeur, personne ne le modifie depuis
 *     l'application, et aucune route n'expose de quoi le faire ;
 *   - le seuil DEVELOPPEUR est EDITABLE. Il traduit le cahier des charges d'un projet precis :
 *     « le developpeur X veut 400 m des habitations la ou la reglementation en exige 100 » ;
 *   - le MODE 1 (consultation d'une parcelle sur la carte) evalue TOUJOURS au seuil
 *     reglementaire. Toujours, quel que soit le profil ouvert par ailleurs ;
 *   - le MODE 2 (recherche multicriteres) evalue au seuil developpeur QUAND IL EXISTE pour la
 *     contrainte, et au seuil reglementaire sinon.
 *
 * POURQUOI LE MODE 1 NE DOIT JAMAIS BOUGER. C'est la seule vue qui reponde a la question « cette
 * parcelle est-elle constructible au regard du droit ». Si un profil de recherche pouvait la
 * durcir, un operateur qui consulte une parcelle apres avoir travaille sur le profil d'un
 * developpeur exigeant la verrait « defavorable » sans qu'aucune regle de droit ne s'y oppose — et
 * il ecarterait du foncier parfaitement instruisable, en croyant lire la reglementation.
 *
 * DEUX QUESTIONS DISTINCTES, ET C'EST LA CLE DE TOUT CE MODULE. « Cette parcelle est-elle
 * conforme au droit ? » et « cette parcelle correspond-elle au cahier des charges de ce
 * developpeur ? » n'ont ni la meme reponse ni la meme autorite. Un seuil developpeur repond a la
 * seconde et n'a aucun pouvoir sur la premiere : il ne rend rien conforme, et ne peut rien rendre
 * non conforme. C'est pourquoi `SeuilApplique` porte a la fois la condition appliquee ET l'etat
 * du seuil reglementaire, sans jamais fondre les deux.
 *
 * ENFIN, LA TRACABILITE. Tout ce que ce module rend porte `origine`, le texte reglementaire
 * d'origine et — quand un seuil developpeur s'applique — la condition reglementaire qu'il
 * remplace. Un verdict qui ne dirait pas quel seuil l'a produit serait inutilisable : l'operateur
 * doit pouvoir repondre « ecartee par VOTRE exigence de 400 m, la reglementation en demande 100 ».
 */

import type { ConditionSeuil, ContrainteReferentiel } from './contraintes-referentiel.js';
// Meme notion, deja nommee pour les seuils de recherche : « au moins » ou « au plus ». La
// redeclarer donnerait deux types identiques que rien n'obligerait a rester d'accord.
import type { SensSeuil } from './seuils-recherche.js';

/**
 * Le mode d'interrogation, qui decide du seuil applique.
 *
 * Ce n'est pas un detail d'interface : c'est l'entree dont depend le verdict. Un appelant doit
 * dire lequel des deux il veut, jamais l'omettre.
 */
export type ModeInterrogation = 'reglementaire' | 'developpeur';

/** D'ou vient le seuil effectivement applique. Accompagne tout verdict. */
export type OrigineSeuil = 'reglementaire' | 'developpeur';

/**
 * Un seuil pose par un developpeur pour une contrainte, dans un profil de recherche.
 *
 * POURQUOI `sens` EST FACULTATIF ICI ET OBLIGATOIRE LA-BAS. Quand le classeur porte un symbole de
 * comparaison — « ≥ 500 m », « < 10 % » — le sens est ETABLI : on le recopie, et laisser
 * l'operateur en choisir un autre lui permettrait d'inverser une contrainte sans s'en apercevoir.
 * Quand le classeur n'en porte pas, mon extracteur ecrit `egal`, qui ne veut pas dire « exactement
 * cette valeur » mais « sens non etabli » — et il n'existe pas de defaut raisonnable :
 *
 *   « 500 m par défaut (ou PDA) »        monuments historiques  -> au moins
 *   « Seuil départemental (0,5-4 ha) »   defrichement           -> au plus
 *   « ~0,3 à 1 ha pour un projet type »  emprise BESS           -> au moins
 *   « Rayon type ~15-30 km »             gisement methanisation -> au plus
 *
 * Deviner reviendrait a se tromper une fois sur deux, en silence. Le sens est donc demande a
 * l'operateur dans ce cas precis, et refuse dans l'autre. Voir `sensRequis()`.
 */
export interface SeuilDeveloppeur {
  contrainteId: string;
  valeur: number;
  /** Recopiee de la contrainte : un seuil developpeur ne change pas d'unite en cours de route. */
  unite: string;
  /** Requis si et seulement si `sensRequis(contrainte)`. Recopie du reglementaire sinon. */
  sens?: SensSeuil;
  /** Pourquoi le developpeur durcit. Libre, repris tel quel dans le dossier remis. */
  motif: string;
}

/**
 * Pourquoi le VERDICT REGLEMENTAIRE d'une contrainte ne peut pas etre automatique.
 *
 * Ces raisons portent sur le seuil reglementaire et sur lui seul. Deux d'entre elles n'empechent
 * pas un seuil developpeur de s'appliquer — voir `seuilApplique`.
 */
export type RaisonNonAutomatique =
  | 'aucun_seuil_numerique'
  | 'seuil_approximatif'
  | 'extraction_incomplete'
  | 'pas_de_couche_nationale';

/** Le seuil effectivement applique a une contrainte, avec sa provenance. */
export interface SeuilApplique {
  contrainteId: string;
  origine: OrigineSeuil;
  /** `null` : rien a comparer, la contrainte part en verification manuelle. */
  condition: ConditionSeuil | null;
  /** Texte du classeur, TOUJOURS porte — meme quand un seuil developpeur s'applique. */
  texteReglementaire: string;
  /** Condition reglementaire remplacee. Non nulle seulement si `origine === 'developpeur'`. */
  conditionReglementaire: ConditionSeuil | null;
  /** Motif saisi par le developpeur. Non nul seulement si `origine === 'developpeur'`. */
  motifDeveloppeur: string | null;
  /**
   * Le seuil REGLEMENTAIRE est-il etabli de facon ferme ?
   *
   * `false` n'empeche pas de filtrer au seuil du developpeur — sa valeur a lui, elle, est ferme —
   * mais interdit d'en tirer une conclusion sur la CONFORMITE de la parcelle. Le dossier doit
   * alors porter la contrainte en « a verifier », meme si la recherche l'a retenue.
   */
  reglementaireEtabli: boolean;
  /** Vide si et seulement si `reglementaireEtabli`. Dit ce qui manque. */
  raisons: RaisonNonAutomatique[];
}

/**
 * La condition reglementaire qu'un seuil developpeur remplace, ou `null`.
 *
 * ELLE VIENT DE LA COLONNE « SEUIL », ET DE NULLE PART AILLEURS. C'est la colonne que le classeur
 * consacre a enoncer l'exigence, et elle est toujours redigee du point de vue de la parcelle :
 * « ≥ 500 m », « 100 m (Déclaration) / 200 m ». Un seuil developpeur se compare a celle-la.
 *
 * POURQUOI PAS LES CONDITIONS PORTEES PAR LES REGLES, que ma premiere version preferait. Elles
 * n'ont pas le meme sens : `regles[].condition` dit QUAND LA REGLE SE DECLENCHE, pas ce que la
 * parcelle doit respecter. Pour le recul eolien, la colonne « Seuil » donne « ≥ 500 m » — une
 * exigence — tandis que la regle redhibitoire donne « < 500 m » — un declencheur d'exclusion. Les
 * deux decrivent la meme limite en s'opposant terme a terme, et les melanger inverse le controle
 * de durcissement : mon propre test a refuse 300 m comme un durcissement et accepte 700 m comme un
 * assouplissement, exactement a l'envers.
 *
 * La branche supprimee ne couvrait d'ailleurs RIEN : mesure sur le classeur, zero contrainte porte
 * une regle chiffree sans nombre dans la colonne « Seuil ». Elle n'apportait que son ambiguite.
 */
function conditionReglementaire(contrainte: ContrainteReferentiel): ConditionSeuil | null {
  const premier = contrainte.seuilsNumeriques[0];
  return premier
    ? { operateur: premier.operateur, valeur: premier.valeur, unite: premier.unite }
    : null;
}

/**
 * Ce qui empeche le seuil REGLEMENTAIRE de trancher tout seul.
 *
 * Les quatre raisons ne sont pas exclusives — une contrainte peut en cumuler plusieurs, et le
 * dossier gagne a toutes les dire.
 */
export function raisonsNonAutomatique(contrainte: ContrainteReferentiel): RaisonNonAutomatique[] {
  const raisons: RaisonNonAutomatique[] = [];
  if (contrainte.modeEvaluation !== 'auto_sig') raisons.push('pas_de_couche_nationale');
  if (conditionReglementaire(contrainte) === null) raisons.push('aucun_seuil_numerique');
  if (contrainte.seuilsNumeriques.some((s) => s.approximatif)) raisons.push('seuil_approximatif');
  if (!contrainte.extractionComplete) raisons.push('extraction_incomplete');
  return raisons;
}

/**
 * La grandeur est-elle MESURABLE sur une parcelle, independamment du seuil ?
 *
 * C'est la question qu'un seuil developpeur ne peut pas resoudre : aucune exigence de developpeur
 * ne fournit une couche SIG qui n'existe pas, ni un nombre la ou le classeur n'en porte aucun.
 * Les deux autres raisons — seuil approximatif, extraction incomplete — portent sur la VALEUR
 * reglementaire, que le developpeur remplace justement par la sienne.
 */
function mesurable(contrainte: ContrainteReferentiel): boolean {
  return contrainte.modeEvaluation === 'auto_sig' && conditionReglementaire(contrainte) !== null;
}

/**
 * Le sens doit-il etre saisi par l'operateur ?
 *
 * Vrai quand le classeur ne porte aucun symbole de comparaison, cas ou mon extracteur ecrit
 * `egal` faute de mieux. Voir le commentaire de `SeuilDeveloppeur.sens`.
 */
export function sensRequis(contrainte: ContrainteReferentiel): boolean {
  return conditionReglementaire(contrainte)?.operateur === 'egal';
}

/** Sens d'une condition reglementaire, ou `null` quand il n'est pas etabli. */
export function sensReglementaire(contrainte: ContrainteReferentiel): SensSeuil | null {
  const op = conditionReglementaire(contrainte)?.operateur;
  if (op === 'min' || op === 'min_strict') return 'min';
  if (op === 'max' || op === 'max_strict') return 'max';
  return null;
}

/**
 * Un seuil developpeur ASSOUPLIT-IL la reglementation ?
 *
 * LE CAS QU'IL FAUT EMPECHER. La reglementation impose « ≥ 500 m des habitations ». Un profil
 * saisi avec 300 m ferait remonter, dans la recherche, des parcelles que le droit interdit — et
 * l'operateur constituerait un dossier de prospection sur du foncier inconstructible. Le cahier
 * des charges dit que le seuil reglementaire est immuable ; l'accepter comme borne basse sans le
 * dire reviendrait a le rendre modifiable par la fenetre.
 *
 * REND `false` QUAND LE SENS N'EST PAS ETABLI, et c'est voulu : sur un `egal` on ignore de quel
 * cote se trouve l'assouplissement, donc on ne peut rien refuser sans risquer de refuser un
 * durcissement legitime. La contrainte reste alors marquee `reglementaireEtabli: false`, ce qui
 * dit a l'operateur que la conformite n'est pas acquise — c'est la reponse honnete, la ou une
 * interdiction arbitraire ne serait qu'une devinette a l'envers.
 */
export function assouplit(reglementaire: ConditionSeuil, valeurDeveloppeur: number): boolean {
  switch (reglementaire.operateur) {
    case 'min':
    case 'min_strict':
      return valeurDeveloppeur < reglementaire.valeur;
    case 'max':
    case 'max_strict':
      return valeurDeveloppeur > reglementaire.valeur;
    case 'egal':
      return false;
  }
}

/**
 * Le seuil a appliquer a une contrainte, dans un mode donne.
 *
 * C'EST LA FONCTION QUE LE §2.3 DECRIT, et le reste du moteur ne doit pas refaire ce calcul
 * ailleurs. Un appelant qui choisirait lui-meme entre les deux seuils finirait par oublier le
 * mode, et le Mode 1 cesserait d'etre reglementaire sans que personne ne le voie.
 *
 * Le seuil developpeur est ignore — mais VISIBLEMENT, le resultat restant marque
 * `origine: 'reglementaire'` — en mode 1, en l'absence de saisie, et quand la grandeur n'est pas
 * mesurable.
 */
export function seuilApplique(
  contrainte: ContrainteReferentiel,
  mode: ModeInterrogation,
  seuilsDeveloppeur: ReadonlyMap<string, SeuilDeveloppeur>,
): SeuilApplique {
  const reglementaire = conditionReglementaire(contrainte);
  const raisons = raisonsNonAutomatique(contrainte);
  const etabli = raisons.length === 0;
  const base: SeuilApplique = {
    contrainteId: contrainte.id,
    origine: 'reglementaire',
    condition: etabli ? reglementaire : null,
    texteReglementaire: contrainte.seuilReglementaire,
    conditionReglementaire: null,
    motifDeveloppeur: null,
    reglementaireEtabli: etabli,
    raisons,
  };

  if (mode === 'reglementaire') return base;

  const saisi = seuilsDeveloppeur.get(contrainte.id);
  if (!saisi || reglementaire === null || !mesurable(contrainte)) return base;

  /*
   * Sens applique : celui du classeur quand il est etabli, celui de l'operateur sinon.
   *
   * Si le sens est requis et absent, on N'APPLIQUE PAS le seuil : appliquer `egal` comparerait la
   * distance d'une parcelle a l'egalite stricte avec 400 m, qui n'est vraie pour personne, et
   * viderait le resultat en silence. Mieux vaut ignorer une saisie incomplete que produire zero
   * parcelle sans raison lisible — la validation de la route refuse ce cas en amont.
   */
  const sens = sensReglementaire(contrainte) ?? saisi.sens ?? null;
  if (sens === null) return base;

  return {
    ...base,
    origine: 'developpeur',
    condition: { operateur: sens, valeur: saisi.valeur, unite: reglementaire.unite },
    conditionReglementaire: reglementaire,
    motifDeveloppeur: saisi.motif,
  };
}

/** Index par identifiant de contrainte, forme attendue par `seuilApplique`. */
export function indexerSeuils(
  seuils: readonly SeuilDeveloppeur[],
): ReadonlyMap<string, SeuilDeveloppeur> {
  return new Map(seuils.map((s) => [s.contrainteId, s]));
}

/**
 * Les contraintes qu'un developpeur peut effectivement parametrer.
 *
 * L'interface en a besoin pour ne PAS proposer les 292 lignes : offrir un champ de saisie sur une
 * contrainte qui ne sera jamais mesuree promet un effet qui ne viendra pas.
 *
 * Le critere est `mesurable` — une couche nationale ET un nombre de reference — et NON
 * « le seuil reglementaire est ferme ». Une contrainte dont le seuil reglementaire est ambigu est
 * precisement celle ou l'exigence du developpeur sert le plus : « 100 m (Déclaration) / 200 m
 * (Enregistrement-Autorisation) » ne tranche rien tout seul, « 400 m » tranche.
 */
export function contraintesParametrables(
  contraintes: readonly ContrainteReferentiel[],
): ContrainteReferentiel[] {
  return contraintes.filter(mesurable);
}

/** Condition reglementaire d'une contrainte, exposee pour l'edition et les tests. */
export function conditionDeReference(contrainte: ContrainteReferentiel): ConditionSeuil | null {
  return conditionReglementaire(contrainte);
}
