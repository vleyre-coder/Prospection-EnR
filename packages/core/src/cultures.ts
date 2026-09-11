/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * GROUPES DE CULTURE DU RPG, ET LES FAMILLES QU'UN DEVELOPPEUR CHERCHE REELLEMENT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CETTE TABLE A CHANGE DE PAQUET. Elle vivait dans `apps/api/src/connecteurs/rpg.ts`,
 * ou elle ne servait qu'a nommer le groupe declare au moment de la qualification. Deux besoins
 * l'en ont sortie :
 *
 *   - la RECHERCHE par criteres. « Je veux du foncier d'elevage » ou « je veux des vignes » se
 *     traduit en une selection de groupes de culture, et cette traduction doit se faire dans le
 *     navigateur, ou le connecteur n'est pas installe ;
 *   - le DOSSIER remis au developpeur, qui doit dire quelle agriculture est declaree sur chaque
 *     parcelle — c'est la premiere question posee sur un projet agrivoltaique.
 *
 * ET ELLE Y A GAGNE SES ACCENTS. Ces libelles sont AFFICHES — dans la fiche, dans le dossier, et
 * desormais dans le formulaire de recherche — mais `connecteurs/rpg.ts` n'a jamais fait partie du
 * perimetre du garde d'orthographe. « Ble tendre », « Mais grain et ensilage », « Proteagineux »,
 * « Legumineuses a grains », « Estives et landes » et « Canne a sucre » circulaient donc sans
 * accent dans du texte lu par l'operateur. Ici, le garde les relit.
 *
 * ATTENTION AUX INSTANTANES DEJA CALCULES : ils portent le libelle tel qu'il etait a l'ingestion,
 * accents compris ou non. C'est pourquoi l'affichage et la recherche passent par le CODE
 * (`codeGroupeCulture`), qui ne bouge pas, et non par le libelle stocke.
 *
 * Source : nomenclature des groupes de culture du Registre parcellaire graphique (IGN / ASP),
 * stable depuis le millesime 2015.
 */

/** Libelle officiel de chaque groupe de culture du RPG, par son code. */
export const GROUPES_CULTURE: Record<string, string> = {
  '1': 'Blé tendre',
  '2': 'Maïs grain et ensilage',
  '3': 'Orge',
  '4': 'Autres céréales',
  '5': 'Colza',
  '6': 'Tournesol',
  '7': 'Autres oléagineux',
  '8': 'Protéagineux',
  '9': 'Plantes à fibres',
  '10': 'Semences',
  '11': 'Gel (surfaces sans production)',
  '12': 'Gel industriel',
  '14': 'Riz',
  '15': 'Légumineuses à grains',
  '16': 'Fourrage',
  '17': 'Estives et landes',
  '18': 'Prairies permanentes',
  '19': 'Prairies temporaires',
  '20': 'Vergers',
  '21': 'Vignes',
  '22': 'Fruits à coque',
  '23': 'Oliviers',
  '24': 'Autres cultures industrielles',
  '25': 'Légumes ou fleurs',
  '26': 'Canne à sucre',
  '27': 'Arboriculture',
  '28': 'Divers',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES FAMILLES : le vocabulaire du developpeur, pas celui de la PAC
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI ELLES EXISTENT. Un developpeur ne demande pas « les groupes 16, 17, 18 et 19 » : il
 * demande « de l'elevage », parce que c'est la question qui decide de son projet. Un
 * agrivoltaisme sur prairie pature se monte avec un eleveur, sur une duree compatible avec un
 * cheptel ; un agrivoltaisme sur grandes cultures se discute en hauteur de structure et en passage
 * d'engins ; une vigne appelle des persiennes et une AOC. Ce sont trois metiers differents.
 *
 * Proposer les 27 groupes bruts dans un selecteur ferait porter cette traduction a l'operateur, a
 * chaque recherche, de memoire. Les familles la font une fois, ici, ou elle se relit.
 *
 * CE QU'ELLES NE SONT PAS : une classification agronomique. C'est un regroupement d'USAGE pour la
 * prospection. Le detail reste accessible — la fiche et le dossier affichent toujours le groupe
 * exact declare, et non la famille.
 */
export interface FamilleCulture {
  id: string;
  libelle: string;
  /** Ce que la famille signifie pour un projet, en une phrase. Affichee en infobulle. */
  aide: string;
  /** Codes de groupe RPG couverts. */
  groupes: readonly string[];
}

export const FAMILLES_CULTURE: readonly FamilleCulture[] = [
  {
    id: 'elevage',
    libelle: 'Élevage et prairies',
    aide: "Prairies, fourrage, estives et landes : le foncier d'un agrivoltaïsme sur pâture, monté avec un éleveur.",
    groupes: ['16', '17', '18', '19'],
  },
  {
    id: 'grandes_cultures',
    libelle: 'Grandes cultures',
    aide: "Céréales, oléagineux, protéagineux : agrivoltaïsme de plein champ, avec contrainte de hauteur et de passage d'engins.",
    groupes: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '14', '15', '24'],
  },
  {
    id: 'vignes_vergers',
    libelle: 'Vignes, vergers et oliviers',
    aide: 'Cultures pérennes : structures spécifiques, et très souvent une AOP à vérifier avant toute démarche.',
    groupes: ['20', '21', '22', '23', '27'],
  },
  {
    id: 'maraichage',
    libelle: 'Maraîchage et légumes',
    aide: 'Légumes, fleurs, canne à sucre : parcelles généralement petites et à forte valeur ajoutée.',
    groupes: ['25', '26'],
  },
  {
    id: 'sans_production',
    libelle: 'Gel et surfaces sans production',
    aide: "Surfaces déclarées à la PAC mais sans production : le foncier agricole le plus facilement mobilisable, sans perte d'exploitation.",
    groupes: ['11', '12'],
  },
  {
    id: 'divers',
    libelle: 'Divers',
    aide: 'Groupe résiduel du RPG : à ouvrir au cas par cas, la déclaration ne dit pas ce qui est cultivé.',
    groupes: ['28'],
  },
];

/** Libelle d'un groupe de culture, ou son code s'il est inconnu — jamais `undefined` a l'ecran. */
export function libelleGroupeCulture(code: string | null | undefined): string | null {
  if (code == null || code === '') return null;
  return GROUPES_CULTURE[code] ?? code;
}

/**
 * Famille d'usage d'un groupe de culture, ou `null` si le groupe n'est rattache a aucune.
 *
 * Rendre `null` plutot que « divers » est deliberé : un groupe ajoute demain au RPG et oublie ici
 * doit se voir, pas se fondre dans une famille fourre-tout.
 */
export function familleDuGroupe(code: string | null | undefined): FamilleCulture | null {
  if (code == null || code === '') return null;
  return FAMILLES_CULTURE.find((f) => f.groupes.includes(code)) ?? null;
}

/**
 * Groupes de culture couverts par une liste de familles, dedoublonnes.
 *
 * C'est la traduction qui part au SQL. Calculee et non recopiee : une reciproque ecrite a la main
 * cesse de l'etre au premier groupe ajoute, et le filtre renverrait alors moins que ce qu'il
 * annonce — sans erreur, sans message.
 */
export function groupesDesFamilles(ids: readonly string[]): string[] {
  const vus = new Set<string>();
  for (const id of ids) {
    const f = FAMILLES_CULTURE.find((x) => x.id === id);
    for (const g of f?.groupes ?? []) vus.add(g);
  }
  return [...vus].sort((a, b) => Number(a) - Number(b));
}
