/**
 * Nomenclature administrative : regions et departements, avec leurs noms.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FICHIER GENERE — NE PAS MODIFIER A LA MAIN. Regenerer avec `node scripts/territoires.mjs`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Source : API Geo de l'Etat (geo.api.gouv.fr), qui republie le Code officiel geographique de
 * l'INSEE. Releve du 2026-09-10 : 18 regions, 101 departements.
 *
 * A QUOI CETTE TABLE SERT. L'outil de recherche par criteres balaie « tout un departement » ou
 * « toute une region » : il lui faut les noms a afficher et la correspondance region -> departements
 * pour construire le selecteur. La BASE, elle, reste la seule autorite sur ce qui est REELLEMENT
 * interrogeable : `commune.code_region` et `commune.code_departement` disent quels territoires
 * ont ete ingeres. Cette table nomme, elle ne prouve pas la presence de donnees.
 *
 * CE QU'ELLE NE COUVRE PAS. Les collectivites d'outre-mer sans code departement (Polynesie,
 * Nouvelle-Caledonie, Saint-Pierre-et-Miquelon, Wallis-et-Futuna, Saint-Barthelemy,
 * Saint-Martin) n'y figurent pas : l'API Geo ne les publie pas comme departements, et le cadastre
 * comme le reseau electrique y relevent de regimes distincts que l'application ne modelise pas.
 */

export interface Region {
  code: string;
  nom: string;
}

export interface Departement {
  code: string;
  nom: string;
  /** Region de rattachement. Toujours presente dans `REGIONS` — verifie par test. */
  codeRegion: string;
}

/** Date du releve de la source, au format ISO. */
export const TERRITOIRES_RELEVE_LE = '2026-09-10';

export const REGIONS: readonly Region[] = [
  { code: '01', nom: 'Guadeloupe' },
  { code: '02', nom: 'Martinique' },
  { code: '03', nom: 'Guyane' },
  { code: '04', nom: 'La Réunion' },
  { code: '06', nom: 'Mayotte' },
  { code: '11', nom: 'Île-de-France' },
  { code: '24', nom: 'Centre-Val de Loire' },
  { code: '27', nom: 'Bourgogne-Franche-Comté' },
  { code: '28', nom: 'Normandie' },
  { code: '32', nom: 'Hauts-de-France' },
  { code: '44', nom: 'Grand Est' },
  { code: '52', nom: 'Pays de la Loire' },
  { code: '53', nom: 'Bretagne' },
  { code: '75', nom: 'Nouvelle-Aquitaine' },
  { code: '76', nom: 'Occitanie' },
  { code: '84', nom: 'Auvergne-Rhône-Alpes' },
  { code: '93', nom: 'Provence-Alpes-Côte d\'Azur' },
  { code: '94', nom: 'Corse' },
];

export const DEPARTEMENTS: readonly Departement[] = [
  { code: '01', nom: 'Ain', codeRegion: '84' },
  { code: '02', nom: 'Aisne', codeRegion: '32' },
  { code: '03', nom: 'Allier', codeRegion: '84' },
  { code: '04', nom: 'Alpes-de-Haute-Provence', codeRegion: '93' },
  { code: '05', nom: 'Hautes-Alpes', codeRegion: '93' },
  { code: '06', nom: 'Alpes-Maritimes', codeRegion: '93' },
  { code: '07', nom: 'Ardèche', codeRegion: '84' },
  { code: '08', nom: 'Ardennes', codeRegion: '44' },
  { code: '09', nom: 'Ariège', codeRegion: '76' },
  { code: '10', nom: 'Aube', codeRegion: '44' },
  { code: '11', nom: 'Aude', codeRegion: '76' },
  { code: '12', nom: 'Aveyron', codeRegion: '76' },
  { code: '13', nom: 'Bouches-du-Rhône', codeRegion: '93' },
  { code: '14', nom: 'Calvados', codeRegion: '28' },
  { code: '15', nom: 'Cantal', codeRegion: '84' },
  { code: '16', nom: 'Charente', codeRegion: '75' },
  { code: '17', nom: 'Charente-Maritime', codeRegion: '75' },
  { code: '18', nom: 'Cher', codeRegion: '24' },
  { code: '19', nom: 'Corrèze', codeRegion: '75' },
  { code: '21', nom: 'Côte-d\'Or', codeRegion: '27' },
  { code: '22', nom: 'Côtes-d\'Armor', codeRegion: '53' },
  { code: '23', nom: 'Creuse', codeRegion: '75' },
  { code: '24', nom: 'Dordogne', codeRegion: '75' },
  { code: '25', nom: 'Doubs', codeRegion: '27' },
  { code: '26', nom: 'Drôme', codeRegion: '84' },
  { code: '27', nom: 'Eure', codeRegion: '28' },
  { code: '28', nom: 'Eure-et-Loir', codeRegion: '24' },
  { code: '29', nom: 'Finistère', codeRegion: '53' },
  { code: '2A', nom: 'Corse-du-Sud', codeRegion: '94' },
  { code: '2B', nom: 'Haute-Corse', codeRegion: '94' },
  { code: '30', nom: 'Gard', codeRegion: '76' },
  { code: '31', nom: 'Haute-Garonne', codeRegion: '76' },
  { code: '32', nom: 'Gers', codeRegion: '76' },
  { code: '33', nom: 'Gironde', codeRegion: '75' },
  { code: '34', nom: 'Hérault', codeRegion: '76' },
  { code: '35', nom: 'Ille-et-Vilaine', codeRegion: '53' },
  { code: '36', nom: 'Indre', codeRegion: '24' },
  { code: '37', nom: 'Indre-et-Loire', codeRegion: '24' },
  { code: '38', nom: 'Isère', codeRegion: '84' },
  { code: '39', nom: 'Jura', codeRegion: '27' },
  { code: '40', nom: 'Landes', codeRegion: '75' },
  { code: '41', nom: 'Loir-et-Cher', codeRegion: '24' },
  { code: '42', nom: 'Loire', codeRegion: '84' },
  { code: '43', nom: 'Haute-Loire', codeRegion: '84' },
  { code: '44', nom: 'Loire-Atlantique', codeRegion: '52' },
  { code: '45', nom: 'Loiret', codeRegion: '24' },
  { code: '46', nom: 'Lot', codeRegion: '76' },
  { code: '47', nom: 'Lot-et-Garonne', codeRegion: '75' },
  { code: '48', nom: 'Lozère', codeRegion: '76' },
  { code: '49', nom: 'Maine-et-Loire', codeRegion: '52' },
  { code: '50', nom: 'Manche', codeRegion: '28' },
  { code: '51', nom: 'Marne', codeRegion: '44' },
  { code: '52', nom: 'Haute-Marne', codeRegion: '44' },
  { code: '53', nom: 'Mayenne', codeRegion: '52' },
  { code: '54', nom: 'Meurthe-et-Moselle', codeRegion: '44' },
  { code: '55', nom: 'Meuse', codeRegion: '44' },
  { code: '56', nom: 'Morbihan', codeRegion: '53' },
  { code: '57', nom: 'Moselle', codeRegion: '44' },
  { code: '58', nom: 'Nièvre', codeRegion: '27' },
  { code: '59', nom: 'Nord', codeRegion: '32' },
  { code: '60', nom: 'Oise', codeRegion: '32' },
  { code: '61', nom: 'Orne', codeRegion: '28' },
  { code: '62', nom: 'Pas-de-Calais', codeRegion: '32' },
  { code: '63', nom: 'Puy-de-Dôme', codeRegion: '84' },
  { code: '64', nom: 'Pyrénées-Atlantiques', codeRegion: '75' },
  { code: '65', nom: 'Hautes-Pyrénées', codeRegion: '76' },
  { code: '66', nom: 'Pyrénées-Orientales', codeRegion: '76' },
  { code: '67', nom: 'Bas-Rhin', codeRegion: '44' },
  { code: '68', nom: 'Haut-Rhin', codeRegion: '44' },
  { code: '69', nom: 'Rhône', codeRegion: '84' },
  { code: '70', nom: 'Haute-Saône', codeRegion: '27' },
  { code: '71', nom: 'Saône-et-Loire', codeRegion: '27' },
  { code: '72', nom: 'Sarthe', codeRegion: '52' },
  { code: '73', nom: 'Savoie', codeRegion: '84' },
  { code: '74', nom: 'Haute-Savoie', codeRegion: '84' },
  { code: '75', nom: 'Paris', codeRegion: '11' },
  { code: '76', nom: 'Seine-Maritime', codeRegion: '28' },
  { code: '77', nom: 'Seine-et-Marne', codeRegion: '11' },
  { code: '78', nom: 'Yvelines', codeRegion: '11' },
  { code: '79', nom: 'Deux-Sèvres', codeRegion: '75' },
  { code: '80', nom: 'Somme', codeRegion: '32' },
  { code: '81', nom: 'Tarn', codeRegion: '76' },
  { code: '82', nom: 'Tarn-et-Garonne', codeRegion: '76' },
  { code: '83', nom: 'Var', codeRegion: '93' },
  { code: '84', nom: 'Vaucluse', codeRegion: '93' },
  { code: '85', nom: 'Vendée', codeRegion: '52' },
  { code: '86', nom: 'Vienne', codeRegion: '75' },
  { code: '87', nom: 'Haute-Vienne', codeRegion: '75' },
  { code: '88', nom: 'Vosges', codeRegion: '44' },
  { code: '89', nom: 'Yonne', codeRegion: '27' },
  { code: '90', nom: 'Territoire de Belfort', codeRegion: '27' },
  { code: '91', nom: 'Essonne', codeRegion: '11' },
  { code: '92', nom: 'Hauts-de-Seine', codeRegion: '11' },
  { code: '93', nom: 'Seine-Saint-Denis', codeRegion: '11' },
  { code: '94', nom: 'Val-de-Marne', codeRegion: '11' },
  { code: '95', nom: 'Val-d\'Oise', codeRegion: '11' },
  { code: '971', nom: 'Guadeloupe', codeRegion: '01' },
  { code: '972', nom: 'Martinique', codeRegion: '02' },
  { code: '973', nom: 'Guyane', codeRegion: '03' },
  { code: '974', nom: 'La Réunion', codeRegion: '04' },
  { code: '976', nom: 'Mayotte', codeRegion: '06' },
];

const PAR_CODE_REGION = new Map(REGIONS.map((r) => [r.code, r]));
const PAR_CODE_DEPARTEMENT = new Map(DEPARTEMENTS.map((d) => [d.code, d]));

/** Nom de la region, ou son code quand elle est inconnue — jamais `undefined` a l'affichage. */
export function nomRegion(code: string): string {
  return PAR_CODE_REGION.get(code)?.nom ?? code;
}

/** Nom du departement, ou son code quand il est inconnu. */
export function nomDepartement(code: string): string {
  return PAR_CODE_DEPARTEMENT.get(code)?.nom ?? code;
}

/**
 * Departements d'une region, tries par code.
 *
 * SERT UNIQUEMENT A CONSTRUIRE L'INTERFACE. Le filtrage cote serveur resout la region par
 * sous-requete sur `commune`, et non avec cette table : la base est la seule a savoir quels
 * departements portent effectivement des communes ingerees.
 */
export function departementsDeRegion(codeRegion: string): readonly Departement[] {
  return DEPARTEMENTS.filter((d) => d.codeRegion === codeRegion);
}
