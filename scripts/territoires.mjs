#!/usr/bin/env node
/**
 * Regenere `packages/core/src/territoires.ts` depuis l'API Geo de l'Etat.
 *
 * POURQUOI UNE TABLE GENEREE ET COMMITTEE, plutot qu'un appel en direct. L'outil de recherche par
 * criteres doit proposer « toute une region » ou « tout un departement » : il faut donc les NOMS,
 * et la base ne les porte pas — la table `commune` ne stocke que `code_region` et
 * `code_departement`. Trois solutions etaient possibles :
 *
 *   1. appeler geo.api.gouv.fr a chaque ouverture du selecteur. Refuse : le selecteur de territoire
 *      deviendrait indisponible chaque fois que l'API l'est, pour une nomenclature qui change une
 *      fois par decennie ;
 *   2. ecrire les 101 departements a la main. Refuse : ce serait une liste non verifiee, et la
 *      consigne de ce depot est qu'aucune affirmation ne repose sur la memoire ;
 *   3. generer la table depuis la source officielle, la committer, et DATER le releve. Retenu.
 *
 * Le fichier produit porte la date du releve et le nombre d'entrees. Un test de coherence
 * (`packages/core/test/territoires.test.ts`) verifie ensuite la table sans reseau : chaque
 * departement pointe une region existante, aucun code en double, et les comptes annonces sont les
 * comptes reels.
 *
 * Usage : node scripts/territoires.mjs [--verifier]
 *   sans option : reecrit le fichier ;
 *   --verifier  : compare sans ecrire, et sort en code 1 si la source a change.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CIBLE = path.join(RACINE, 'packages/core/src/territoires.ts');
const BASE = 'https://geo.api.gouv.fr';

async function lire(chemin) {
  const r = await fetch(`${BASE}${chemin}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`);
  return r.json();
}

/** Ordre stable : par code, pour que deux generations successives ne produisent pas de diff. */
const parCode = (a, b) => a.code.localeCompare(b.code, 'fr');

const echapper = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function rendre(regions, departements, leReleve) {
  const lignesRegions = regions
    .map((r) => `  { code: '${r.code}', nom: '${echapper(r.nom)}' },`)
    .join('\n');
  const lignesDeps = departements
    .map(
      (d) =>
        `  { code: '${d.code}', nom: '${echapper(d.nom)}', codeRegion: '${d.codeRegion}' },`,
    )
    .join('\n');

  return `/**
 * Nomenclature administrative : regions et departements, avec leurs noms.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FICHIER GENERE — NE PAS MODIFIER A LA MAIN. Regenerer avec \`node scripts/territoires.mjs\`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Source : API Geo de l'Etat (geo.api.gouv.fr), qui republie le Code officiel geographique de
 * l'INSEE. Releve du ${leReleve} : ${regions.length} regions, ${departements.length} departements.
 *
 * A QUOI CETTE TABLE SERT. L'outil de recherche par criteres balaie « tout un departement » ou
 * « toute une region » : il lui faut les noms a afficher et la correspondance region -> departements
 * pour construire le selecteur. La BASE, elle, reste la seule autorite sur ce qui est REELLEMENT
 * interrogeable : \`commune.code_region\` et \`commune.code_departement\` disent quels territoires
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
  /** Region de rattachement. Toujours presente dans \`REGIONS\` — verifie par test. */
  codeRegion: string;
}

/** Date du releve de la source, au format ISO. */
export const TERRITOIRES_RELEVE_LE = '${leReleve}';

export const REGIONS: readonly Region[] = [
${lignesRegions}
];

export const DEPARTEMENTS: readonly Departement[] = [
${lignesDeps}
];

const PAR_CODE_REGION = new Map(REGIONS.map((r) => [r.code, r]));
const PAR_CODE_DEPARTEMENT = new Map(DEPARTEMENTS.map((d) => [d.code, d]));

/** Nom de la region, ou son code quand elle est inconnue — jamais \`undefined\` a l'affichage. */
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
 * sous-requete sur \`commune\`, et non avec cette table : la base est la seule a savoir quels
 * departements portent effectivement des communes ingerees.
 */
export function departementsDeRegion(codeRegion: string): readonly Departement[] {
  return DEPARTEMENTS.filter((d) => d.codeRegion === codeRegion);
}
`;
}

const [regions, departements] = await Promise.all([
  lire('/regions?fields=nom,code'),
  lire('/departements?fields=nom,code,codeRegion'),
]);

if (!Array.isArray(regions) || regions.length < 15) {
  throw new Error(`Releve des regions invraisemblable : ${JSON.stringify(regions).slice(0, 200)}`);
}
if (!Array.isArray(departements) || departements.length < 95) {
  throw new Error(`Releve des departements invraisemblable : ${departements.length} entrees`);
}
for (const d of departements) {
  if (!regions.some((r) => r.code === d.codeRegion)) {
    throw new Error(`Departement ${d.code} rattache a une region absente : ${d.codeRegion}`);
  }
}

regions.sort(parCode);
departements.sort(parCode);

const ancien = await readFile(CIBLE, 'utf8').catch(() => null);
// La date du releve est reprise de l'ancien fichier quand le CONTENU n'a pas change : dater a
// nouveau une table identique ferait croire a une verification qui n'en est pas une.
const dateAncienne = ancien?.match(/TERRITOIRES_RELEVE_LE = '([\d-]+)'/)?.[1] ?? null;
const aujourdHui = new Date().toISOString().slice(0, 10);

const sansDate = (t) => (t ?? '').replace(/Releve du [\d-]+/, '').replace(/RELEVE_LE = '[\d-]+'/, '');
const candidat = rendre(regions, departements, aujourdHui);
const inchange = ancien != null && sansDate(candidat) === sansDate(ancien);
const contenu = inchange && dateAncienne ? rendre(regions, departements, dateAncienne) : candidat;

if (process.argv.includes('--verifier')) {
  if (inchange) {
    console.log(`Table des territoires a jour (releve du ${dateAncienne}).`);
    process.exit(0);
  }
  console.error('La nomenclature a CHANGE depuis le dernier releve. Relancer sans --verifier.');
  process.exit(1);
}

await writeFile(CIBLE, contenu, 'utf8');
console.log(
  `${CIBLE} : ${regions.length} regions, ${departements.length} departements` +
    (inchange ? ` (inchange, releve du ${dateAncienne} conserve)` : ` (releve du ${aujourdHui})`),
);
