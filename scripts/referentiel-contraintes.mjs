#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * GENERATION DU REFERENTIEL DE CONTRAINTES depuis le classeur fourni
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SOURCE DE VERITE : `referentiel/Contraintes_EnR_parcelles_France.xlsx`, 292 contraintes sur cinq
 * filieres. Ce script le lit et produit `packages/core/src/contraintes-referentiel.ts`, qui est
 * COMMITTE — meme discipline que la nomenclature des territoires :
 *
 *   - aucune dependance nouvelle : un .xlsx est un ZIP de XML, lu ici avec `node:zlib` seul. Le
 *     depot compte onze dependances et s'installe sans reseau chez l'utilisateur final ;
 *   - aucune lecture de classeur a l'execution : le serveur ne depend pas d'un fichier binaire ;
 *   - le referentiel est DIFFABLE dans git. Une revision du classeur se relit ligne a ligne dans
 *     la revue de code, au lieu de changer en silence dans un fichier opaque.
 *
 * Usage : node scripts/referentiel-contraintes.mjs [--verifier]
 *   sans option : reecrit le module ;
 *   --verifier  : compare sans ecrire, et sort en code 1 si le classeur a change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLASSEUR = path.join(RACINE, 'referentiel/Contraintes_EnR_parcelles_France.xlsx');
const CIBLE = path.join(RACINE, 'packages/core/src/contraintes-referentiel.ts');

// ---------------------------------------------------------------------------
// Lecture du classeur (OOXML, sans dependance)
// ---------------------------------------------------------------------------

/** Lit une archive ZIP : nom -> contenu texte. Deflate brut ou stocke, ce qu'Excel produit. */
function lireZip(archive) {
  const parties = new Map();
  let i = 0;
  while (i + 30 <= archive.length && archive.readUInt32LE(i) === 0x04034b50) {
    const methode = archive.readUInt16LE(i + 8);
    const drapeaux = archive.readUInt16LE(i + 6);
    let tailleCompressee = archive.readUInt32LE(i + 18);
    const tailleNom = archive.readUInt16LE(i + 26);
    const tailleExtra = archive.readUInt16LE(i + 28);
    const nom = archive.subarray(i + 30, i + 30 + tailleNom).toString('utf8');
    const debut = i + 30 + tailleNom + tailleExtra;
    if ((drapeaux & 0x08) !== 0 && tailleCompressee === 0) {
      throw new Error(`Entree ${nom} avec descripteur de donnees : non pris en charge.`);
    }
    const donnees = archive.subarray(debut, debut + tailleCompressee);
    parties.set(nom, methode === 8 ? inflateRawSync(donnees) : Buffer.from(donnees));
    i = debut + tailleCompressee;
  }
  return parties;
}

/** Extrait le texte d'un fragment XML, entites comprises. */
function texteXml(fragment) {
  return fragment
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** « BC12 » -> indice 0-base de la colonne. */
function indiceColonne(ref) {
  const lettres = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function lireClasseur(chemin) {
  const parties = lireZip(readFileSync(chemin));

  const partagees = [];
  const ss = parties.get('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      partagees.push(texteXml(m[1]));
    }
  }

  /*
   * L'ORDRE DES ATTRIBUTS N'EST PAS GARANTI, et ce classeur le prouve : il ecrit `Target` AVANT
   * `Id`, la ou la plupart des producteurs font l'inverse. Une expression qui les attend dans un
   * ordre fixe ne trouve alors rien, et les feuilles se resolvent sur `undefined`. Chaque balise
   * est donc isolee d'abord, ses attributs lus ensuite.
   */
  const rels = new Map();
  for (const balise of parties
    .get('xl/_rels/workbook.xml.rels')
    .toString('utf8')
    .matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(balise[0])?.[1];
    const cible = /\bTarget="([^"]+)"/.exec(balise[0])?.[1];
    if (id && cible) rels.set(id, cible);
  }

  const classeur = parties.get('xl/workbook.xml').toString('utf8');
  const feuilles = [];
  for (const m of classeur.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    let cible = (rels.get(m[2]) ?? '').replace(/^\//, '');
    if (!cible.startsWith('xl/')) cible = `xl/${cible}`;
    feuilles.push([texteXml(m[1]), cible]);
  }

  const resultat = new Map();
  for (const [nom, cible] of feuilles) {
    const xml = parties.get(cible).toString('utf8');
    const lignes = [];
    for (const ligne of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cellules = new Map();
      for (const c of ligne[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1];
        if (!ref) continue;
        const type = /t="([^"]+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1];
        let valeur;
        if (type === 's' && v != null) valeur = partagees[Number(v)] ?? '';
        else if (type === 'inlineStr') valeur = texteXml(c[2]);
        else valeur = v == null ? '' : texteXml(v);
        if (valeur !== '') cellules.set(indiceColonne(ref), valeur);
      }
      if (cellules.size > 0) {
        const largeur = Math.max(...cellules.keys()) + 1;
        lignes.push(Array.from({ length: largeur }, (_, i) => cellules.get(i) ?? ''));
      }
    }
    resultat.set(nom, lignes);
  }
  return resultat;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Feuille du classeur -> identifiant de filiere dans l'application. */
const FILIERES = new Map([
  ['Éolien', 'eolien_terrestre'],
  ['Solaire au sol', 'solaire_sol'],
  ['Agrivoltaïsme', 'agrivoltaisme'],
  ['Stockage batterie (BESS)', 'bess'],
  ['Méthanisation', 'methanisation'],
]);

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES NIVEAUX DE CARACTERE — et pourquoi il y en a QUATRE et non trois
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La note de synthese decrit trois niveaux : redhibitoire, penalisant, favorable. Le classeur en
 * porte un quatrieme, sous les libelles « Cadre procedural », « Cadre (acceptabilite) »,
 * « Cadre (dimensionne reculs) », « Cadre (cout) », « Cadre dimensionnant (emprise) » et
 * « Variable » — QUATORZE contraintes en tout.
 *
 * POURQUOI NE PAS LES RAMENER A « PENALISANT », comme la grille a trois niveaux l'imposerait. Ces
 * quatorze lignes sont le regime ICPE, le permis de construire, l'etude d'impact, l'enquete
 * publique, le balisage aerien, la loi sur l'eau, le demantelement. Elles s'appliquent a TOUT
 * projet de la filiere, sans exception : les compter comme une penalite mettrait CHAQUE parcelle
 * « a instruire » pour un permis qui est toujours requis. Le verdict cesserait de distinguer quoi
 * que ce soit.
 *
 * `cadre` n'entre donc PAS dans le verdict. Il s'affiche dans le dossier, sous les procedures
 * applicables, ou il a sa place — c'est une information que le developpeur doit avoir, pas un
 * motif d'ecarter un terrain.
 */
const NIVEAUX = [
  [/^r[ée]dhibitoire/i, 'redhibitoire'],
  [/^p[ée]nalisant/i, 'penalisant'],
  [/^tr[èe]s p[ée]nalisant/i, 'penalisant'],
  [/^favorable/i, 'favorable'],
  [/^cadre/i, 'cadre'],
  /*
   * ═════════════════════════════════════════════════════════════════════════════════════════
   * « VARIABLE » N'EST PAS « CADRE », ET LES CONFONDRE FAISAIT DISPARAITRE UNE CONTRAINTE
   * ═════════════════════════════════════════════════════════════════════════════════════════
   *
   * DEFAUT DE CET EXTRACTEUR, trouve en relisant les contradictions internes du classeur. Le
   * libelle « Variable » n'apparait qu'UNE SEULE FOIS dans les 292 lignes : sur les servitudes
   * d'utilite publique en agrivoltaisme. Les quatre autres filieres portent la meme contrainte,
   * avec la meme couche et le meme seuil « Selon SUP », en REDHIBITOIRE.
   *
   * Le ranger en `cadre` avait une consequence qui ne se voyait nulle part : `cadre` n'entre pas
   * dans le verdict — a juste titre, puisqu'il designe le permis de construire, l'etude d'impact,
   * le regime ICPE, c'est-a-dire ce qui s'applique a TOUT projet. L'agrivoltaisme ignorait donc
   * SILENCIEUSEMENT les servitudes d'utilite publique, et sa fiche n'en disait pas un mot.
   *
   * « Cadre procedural » dit « ceci s'applique toujours ». « Variable » dit « le niveau depend du
   * cas ». Ce sont deux choses opposees : la premiere est une information, la seconde est une
   * contrainte dont on ne sait pas encore la force.
   *
   * POURQUOI `penalisant` ET PAS `redhibitoire`. Aligner sur les quatre autres filieres serait
   * commode et ce serait inventer : le classeur n'ecrit pas « Rédhibitoire » sur cette ligne. On
   * retient donc le niveau le plus BAS qui entre encore dans le verdict — la contrainte est
   * comptee, affichee et instruite, mais elle n'ecarte aucune parcelle a elle seule. L'arbitrage
   * entre les deux lectures revient au juriste, et il est nomme au §2.2 de
   * `docs/RELECTURE-JURIDIQUE.md`.
   */
  [/^variable/i, 'penalisant'],
];

/** Severite, pour retenir le niveau dominant d'une contrainte a plusieurs regles. */
const SEVERITE = { redhibitoire: 3, penalisant: 2, favorable: 1, cadre: 0 };

/**
 * Type d'integration normalise sur quatre valeurs, depuis 30 libelles bruts.
 *
 * L'ORDRE DES TESTS COMPTE. « Open data national + Departemental » doit tomber dans
 * `open_data_national` : la couche nationale existe, la surcouche locale l'affine. A l'inverse,
 * « Critere projet + Open data (voisinage) » reste un critere projet — c'est le projet qui decide,
 * la donnee ne fait qu'eclairer. Ranger l'un pour l'autre changerait ce que l'application promet
 * d'automatiser.
 */
function typeIntegration(brut) {
  const t = brut.toLowerCase();
  if (t.startsWith('critère projet')) return 'critere_projet';
  if (t.startsWith('open data national')) return 'open_data_national';
  if (t.startsWith('départemental')) return 'departemental_regional';
  if (t.startsWith('à créer') || t.startsWith('à surveiller')) return 'a_creer_modeliser';
  throw new Error(`Type d'integration non reconnu : « ${brut} »`);
}

/**
 * Un type d'integration donne-t-il une evaluation automatique ?
 *
 * Seule une couche nationale homogene le permet. Tout le reste — doctrine departementale, couche a
 * modeliser, critere de projet — est marque `verification_manuelle` : le dossier le liste
 * explicitement, avec la valeur reglementaire de reference et la source a consulter, et le verdict
 * ne le tranche jamais tout seul.
 */
function modeEvaluation(type, brut) {
  if (type !== 'open_data_national') return 'verification_manuelle';
  // Les variantes « (buffer a creer) », « (a calculer) », « (a recomposer) » restent automatisables
  // — la couche existe, il reste un calcul a faire — mais pas « (vérification) », qui dit le
  // contraire de son nom : la donnee oriente, un humain tranche.
  return /vérification|non géométrique/i.test(brut) ? 'verification_manuelle' : 'auto_sig';
}

/**
 * Decoupe un caractere composite en une regle par niveau.
 *
 * CENT DES 292 CONTRAINTES SONT COMPOSITES (34 %), et c'est ce que la note de synthese demande de
 * modeliser : « Rédhibitoire (<500 m) / Pénalisant » n'est pas une exclusion binaire, c'est un
 * buffer d'interdiction DANS un buffer de coordination. Les ecraser en une valeur unique ferait
 * perdre l'un des deux — et lequel qu'on perde, le resultat est faux : garder le redhibitoire seul
 * ecarte du foncier instruisable, garder le penalisant seul laisse passer du foncier interdit.
 *
 * LES PARENTHESES SONT MASQUEES AVANT DECOUPAGE, et c'est indispensable : trois libelles portent un
 * separateur A L'INTERIEUR d'une parenthese — « Rédhibitoire (emprises/trouées) / Pénalisant
 * (3 km) », « Rédhibitoire si aucun service (→ requalif. PV sol) ». Decouper sans masquer les
 * casserait en fragments qui ne commencent par aucun niveau connu.
 */
function decouperCaractere(brut) {
  const masques = [];
  const masque = brut.replace(/\([^)]*\)/g, (m) => {
    masques.push(m);
    return `\u0001${masques.length - 1}\u0001`;
  });
  const restaurer = (s) => s.replace(/\u0001(\d+)\u0001/g, (_, i) => masques[Number(i)]);

  /*
   * ON NE COUPE QU'AVANT UN MOT-CLE DE NIVEAU, et jamais sur un separateur seul.
   *
   * MA PREMIERE ECRITURE decoupait sur « / », « a » et « -> », ce qui paraissait evident et
   * cassait QUATRE libelles sur cinq d'un genre precis : le separateur y appartient a la phrase.
   *
   *   « Rédhibitoire en A/N pur / Favorable en U/AU éco »  -> « N pur » et « AU éco »
   *   « Rédhibitoire si trop loin/cher »                   -> « cher »
   *   « Favorable à surveiller (ne s'applique pas) »       -> « surveiller (...) »
   *
   * Aucun de ces fragments ne commence par un niveau : le script s'est arrete, ce qui est le bon
   * comportement — il refuse de deviner. Mais la regle elle-meme etait fausse. Chercher les
   * DEBUTS de niveau, et couper la, est a la fois plus simple et exact : « A/N » et
   * « à surveiller » ne commencent aucun niveau, donc ils ne coupent rien.
   */
  const MOT_CLE = /(?:très\s+)?(?:rédhibitoire|pénalisant|favorable|cadre|variable)/gi;
  const debuts = [...masque.matchAll(MOT_CLE)].map((m) => m.index ?? 0);
  if (debuts.length === 0) throw new Error(`Aucun niveau reconnu dans « ${brut} »`);
  if (debuts[0] !== 0) {
    throw new Error(`Le caractere ne commence pas par un niveau : « ${brut} »`);
  }

  const fragments = debuts
    .map((debut, i) => masque.slice(debut, debuts[i + 1] ?? masque.length))
    // Le separateur reste colle a la fin du fragment precedent : on le retire ici.
    .map((f) => restaurer(f).replace(/[\s/→]+$/u, '').replace(/\s+à$/u, '').trim())
    .filter((f) => f !== '');

  const regles = [];
  for (const fragment of fragments) {
    const trouve = NIVEAUX.find(([motif]) => motif.test(fragment));
    if (!trouve) {
      throw new Error(`Fragment de caractere non reconnu : « ${fragment} » (dans « ${brut} »)`);
    }
    regles.push({
      caractere: trouve[1],
      libelle: fragment,
      condition: conditionNumerique(fragment),
    });
  }
  if (regles.length === 0) throw new Error(`Caractere vide : « ${brut} »`);
  return regles;
}

/** Unites reconnues, de la plus longue a la plus courte pour que « t/j » l'emporte sur « t ». */
const UNITES = [
  'kWh/m²/an', 'kWh/kWc/an', 'Nm3/h', 'Nm³/h', 't MS/an', 'MWc', 'MWh', 'm/s', 't/j', 'kV',
  'MW', 'kW', 'ha', 'km', 'm²', '%', 'm', 't',
];

/**
 * Extrait les conditions numeriques d'un texte, en gardant l'ordre d'apparition.
 *
 * LE TEXTE D'ORIGINE EST TOUJOURS CONSERVE a cote — c'est une exigence du prompt, et elle est
 * juste : 207 des 292 seuils n'ont AUCUN nombre (« Interdit hors liste du document-cadre »,
 * « Avis conforme de l'ABF »). Une extraction numerique qui pretendrait les resumer les
 * trahirait. Le nombre sert au calcul quand il existe ; le texte sert toujours a l'affichage et
 * au dossier remis au developpeur.
 */
function conditionNumerique(texte) {
  const unites = UNITES.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const motif = new RegExp(
    `(≥|≤|<|>|=|au-delà de|à partir de)?\\s*~?(\\d+(?:[.,]\\d+)?)\\s*(?:-\\s*\\d+(?:[.,]\\d+)?)?\\s*(${unites})\\b`,
    'gi',
  );
  const m = motif.exec(texte);
  if (!m) return null;
  const OPERATEURS = { '≥': 'min', '≤': 'max', '<': 'max_strict', '>': 'min_strict', '=': 'egal' };
  const brutOperateur = (m[1] ?? '').trim();
  return {
    operateur:
      OPERATEURS[brutOperateur] ?? (/au-delà|à partir/i.test(brutOperateur) ? 'min' : 'egal'),
    valeur: Number(m[2].replace(',', '.')),
    unite: m[3],
  };
}

/** Toutes les conditions numeriques d'un seuil, pas seulement la premiere. */
function seuilsNumeriques(texte) {
  const trouves = [];
  for (const morceau of texte.split(/\s*;\s*/)) {
    const c = conditionNumerique(morceau);
    if (c) trouves.push({ ...c, texte: morceau.trim(), approximatif: estApproximatif(morceau) });
  }
  return trouves;
}

/**
 * Le texte d'ou vient ce nombre porte-t-il une APPROXIMATION ?
 *
 * DEFAUT REEL, TROUVE EN RELISANT LA SORTIE. « ~ quelques km (GRDF) / ~1 km (NATRAN) selon cout »
 * donne un `1 km` parfaitement exploitable en apparence — et totalement faux comme seuil : le
 * texte dit « quelques kilometres, selon le cout ». Laisser ce nombre piloter un verdict
 * automatique ferait ecarter du foncier sur une valeur que la source ne pretend pas fixer.
 *
 * Le nombre est donc conserve — il reste utile pour ordonner et pour pre-remplir — mais marque.
 * Le moteur de verdict traite un seuil approximatif comme une VERIFICATION MANUELLE, jamais comme
 * une regle qui tranche.
 */
function estApproximatif(texte) {
  return /~|environ|quelques|selon|variable|ordre de|à confirmer|voire|souvent/i.test(texte);
}

/**
 * L'extraction a-t-elle lu TOUS les nombres que porte le texte du seuil ?
 *
 * DEUXIEME DEFAUT DE MEME NATURE, trouve en preparant le seuil developpeur. Le cas nomme par le
 * cahier des charges lui-meme — methanisation, distance aux tiers — porte
 * « 100 m (Déclaration) / 200 m (Enregistrement-Autorisation) » et ressort avec UNE condition :
 * « = 100 m ». Le seuil reglementaire applicable depend en realite du regime ICPE, donc du
 * tonnage, donc du projet. Trancher un verdict sur « = 100 m » serait faux dans les deux sens :
 * trop permissif pour un projet en enregistrement, et faussement ferme pour tout le monde.
 *
 * La mesure est volontairement brutale et ne cherche pas a etre fine : si le texte contient plus
 * de nombres que l'extraction n'a produit de conditions, l'extraction est INCOMPLETE. Mesure sur
 * le classeur : 58 contraintes sur 292. Elles restent affichees avec leur texte integral, mais ne
 * tranchent aucun verdict automatique — exactement comme un seuil approximatif.
 *
 * Le sens de l'erreur est le bon : une contrainte a tort declaree incomplete part en verification
 * manuelle, ce qui est prudent. L'inverse — un nombre partiel qui tranche — ne se rattrape pas.
 */
function extractionComplete(texte, conditions) {
  const nombres = texte.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return nombres.length <= conditions.length;
}

/** Identifiant stable, derive du nom. Une collision est signalee, jamais resolue en silence. */
function identifiant(filiere, nom, vus) {
  const base = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 52);
  let id = `${filiere}__${base}`;
  if (vus.has(id)) {
    let n = 2;
    while (vus.has(`${id}_${n}`)) n += 1;
    id = `${id}_${n}`;
  }
  vus.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Rendu du module
// ---------------------------------------------------------------------------

const echapper = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

function rendre(contraintes, millesime, parFiliere, empreinteClasseur) {
  const lignes = contraintes
    .map(
      (c) =>
        `  {\n` +
        `    id: '${c.id}',\n` +
        `    filiere: '${c.filiere}',\n` +
        `    categorie: '${echapper(c.categorie)}',\n` +
        `    nom: '${echapper(c.nom)}',\n` +
        `    description: '${echapper(c.description)}',\n` +
        `    seuilReglementaire: '${echapper(c.seuilReglementaire)}',\n` +
        `    seuilsNumeriques: ${JSON.stringify(c.seuilsNumeriques)},\n` +
        `    extractionComplete: ${c.extractionComplete},\n` +
        `    caractere: '${c.caractere}',\n` +
        `    caractereBrut: '${echapper(c.caractereBrut)}',\n` +
        `    regles: ${JSON.stringify(c.regles)},\n` +
        `    referenceReglementaire: '${echapper(c.referenceReglementaire)}',\n` +
        `    coucheSig: '${echapper(c.coucheSig)}',\n` +
        `    typeIntegration: '${c.typeIntegration}',\n` +
        `    typeIntegrationBrut: '${echapper(c.typeIntegrationBrut)}',\n` +
        `    modeEvaluation: '${c.modeEvaluation}',\n` +
        `  },`,
    )
    .join('\n');

  const comptes = [...parFiliere.entries()]
    .map(([f, n]) => ` *   ${f.padEnd(18)} ${String(n).padStart(3)}`)
    .join('\n');

  return `/**
 * Referentiel des contraintes d'eligibilite des parcelles, cinq filieres.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FICHIER GENERE — NE PAS MODIFIER A LA MAIN.
 * Regenerer avec \`node scripts/referentiel-contraintes.mjs\`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SOURCE DE VERITE : \`referentiel/Contraintes_EnR_parcelles_France.xlsx\`, millesime ${millesime}.
 * ${contraintes.length} contraintes :
${comptes}
 *
 * CE QUE CE REFERENTIEL EST, ET CE QU'IL N'EST PAS. Il porte le VERDICT reglementaire d'une
 * parcelle — favorable, a instruire, defavorable — avec, pour chaque contrainte, le seuil
 * applique, sa reference et sa source. Il ne remplace pas le moteur de score : celui-ci CLASSE les
 * parcelles favorables entre elles. Les deux repondent a deux questions differentes, et les
 * confondre ferait perdre l'une des deux.
 *
 * Aucune valeur n'est paraphrasee : seuils, references et sources sont recopies du classeur. Les
 * champs \`*Brut\` conservent le libelle d'origine a cote de sa forme normalisee, pour que la
 * normalisation reste verifiable sans rouvrir le classeur.
 */

/** Filieres du referentiel. L'agrivoltaisme y est une filiere a part entiere. */
export const FILIERES_REFERENTIEL = [
  'eolien_terrestre',
  'solaire_sol',
  'agrivoltaisme',
  'bess',
  'methanisation',
] as const;

export type FiliereReferentiel = (typeof FILIERES_REFERENTIEL)[number];

/**
 * Niveau d'une regle.
 *
 * QUATRE VALEURS, LA OU LA NOTE DE SYNTHESE EN DECRIT TROIS. \`cadre\` couvre les quatorze lignes du
 * classeur qui ne sont pas un jugement sur la parcelle mais une procedure applicable a tout projet
 * de la filiere — regime ICPE, permis de construire, etude d'impact, balisage. Les compter comme
 * une penalite mettrait CHAQUE parcelle « a instruire » pour un permis toujours requis, et le
 * verdict cesserait de distinguer quoi que ce soit. \`cadre\` n'entre donc pas dans le verdict ; il
 * s'affiche dans le dossier, sous les procedures applicables.
 */
export type CaractereContrainte = 'redhibitoire' | 'penalisant' | 'favorable' | 'cadre';

/** Faisabilite data, qui conditionne l'ordre de construction de l'application. */
export type TypeIntegration =
  | 'open_data_national'
  | 'departemental_regional'
  | 'a_creer_modeliser'
  | 'critere_projet';

/** Une condition numerique extraite d'un texte de seuil. */
export interface ConditionSeuil {
  /** \`min\` : au moins. \`max\` : au plus. \`*_strict\` : bornes ouvertes. */
  operateur: 'min' | 'max' | 'min_strict' | 'max_strict' | 'egal';
  valeur: number;
  unite: string;
}

export interface SeuilNumerique extends ConditionSeuil {
  /** Le morceau de texte d'ou la condition est extraite, pour l'afficher tel quel. */
  texte: string;
  /**
   * Le texte source porte une approximation (« ~ », « quelques », « selon le cout »).
   *
   * Le nombre reste exploitable pour ordonner ou pre-remplir, mais il NE DOIT PAS trancher un
   * verdict : « ~ quelques km (GRDF) / ~1 km (NATRAN) selon cout » donne un « 1 km » d'apparence
   * ferme que la source ne pretend pas fixer. Le moteur de verdict le traite en verification
   * manuelle.
   */
  approximatif: boolean;
}

/**
 * Une regle de la contrainte : un niveau, et la condition qui le declenche.
 *
 * Une contrainte a caractere composite en porte PLUSIEURS : « Rédhibitoire (<500 m) / Pénalisant »
 * devient un buffer d'interdiction a 500 m dans un buffer de coordination. C'est le cas de
 * ${contraintes.filter((c) => c.regles.length > 1).length} des ${contraintes.length} contraintes.
 */
export interface RegleContrainte {
  caractere: CaractereContrainte;
  /** Fragment d'origine du caractere, ex. « Rédhibitoire (<500 m) ». */
  libelle: string;
  /** Condition numerique lue dans le fragment, quand il en porte une. */
  condition: ConditionSeuil | null;
}

export interface ContrainteReferentiel {
  id: string;
  filiere: FiliereReferentiel;
  categorie: string;
  nom: string;
  description: string;
  /** Texte d'origine du seuil. Toujours conserve : ${contraintes.filter((c) => c.seuilsNumeriques.length === 0).length} seuils sur ${contraintes.length} n'ont aucun nombre. */
  seuilReglementaire: string;
  /** Conditions numeriques extraites du seuil, dans l'ordre d'apparition. */
  seuilsNumeriques: SeuilNumerique[];
  /**
   * \`false\` quand le texte du seuil porte plus de nombres que l'extraction n'en a converti.
   *
   * ${contraintes.filter((c) => !c.extractionComplete).length} contraintes sur ${contraintes.length} : regimes ICPE a deux seuils
   * (« 100 m (Déclaration) / 200 m (Enregistrement-Autorisation) »), fourchettes (« 700-1000 m »),
   * multiples d'une grandeur du projet (« 3-5 × diamètre du rotor »). Le texte reste affiche en
   * entier ; la contrainte ne tranche simplement aucun verdict automatique.
   */
  extractionComplete: boolean;
  /** Niveau dominant, le plus severe des regles. */
  caractere: CaractereContrainte;
  caractereBrut: string;
  regles: RegleContrainte[];
  referenceReglementaire: string;
  coucheSig: string;
  typeIntegration: TypeIntegration;
  typeIntegrationBrut: string;
  /** \`auto_sig\` si une couche nationale homogene existe, sinon \`verification_manuelle\`. */
  modeEvaluation: 'auto_sig' | 'verification_manuelle';
}

/** Millesime du classeur dont ce module est issu. */
export const MILLESIME_REFERENTIEL = '${millesime}';

/**
 * Empreinte des cellules du classeur, telles que lues.
 *
 * Elle seule decide si le referentiel doit etre redate : ni un commentaire reecrit, ni un champ
 * calcule ajoute ici ne constituent une verification du classeur.
 */
export const EMPREINTE_CLASSEUR = '${empreinteClasseur}';

export const CONTRAINTES_REFERENTIEL: readonly ContrainteReferentiel[] = [
${lignes}
];

const PAR_ID = new Map(CONTRAINTES_REFERENTIEL.map((c) => [c.id, c]));

/** Contraintes d'une filiere, dans l'ordre du classeur. */
export function contraintesDeFiliere(filiere: FiliereReferentiel): ContrainteReferentiel[] {
  return CONTRAINTES_REFERENTIEL.filter((c) => c.filiere === filiere);
}

/** Une contrainte par son identifiant, ou \`null\` — jamais \`undefined\` chez l'appelant. */
export function contrainteParId(id: string): ContrainteReferentiel | null {
  return PAR_ID.get(id) ?? null;
}
`;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const feuilles = lireClasseur(CLASSEUR);
const contraintes = [];
const vus = new Set();
const parFiliere = new Map();
/** Cellules du classeur, telles que lues, dans l'ordre. Sert a dater le referentiel. */
const cellulesSource = [];

for (const [nomFeuille, filiere] of FILIERES) {
  const lignes = feuilles.get(nomFeuille);
  if (!lignes) throw new Error(`Feuille absente du classeur : « ${nomFeuille} »`);
  // Ligne 0 : titre de la feuille. Ligne 1 : en-tetes. Les donnees commencent a la ligne 2.
  const donnees = lignes.slice(2);
  parFiliere.set(filiere, donnees.length);

  for (const brute of donnees) {
    const l = [...brute, '', '', '', '', '', '', '', ''];
    const [categorie, nom, description, seuil, caractere, reference, couche, type] = l;
    for (const [i, champ] of [
      ['Catégorie', categorie],
      ['Contrainte', nom],
      ['Description', description],
      ['Seuil', seuil],
      ['Caractère', caractere],
      ['Référence', reference],
      ['Couche SIG', couche],
      ["Type d'intégration", type],
    ]) {
      if (String(champ).trim() === '') {
        throw new Error(`Champ « ${i} » vide pour « ${nom} » (${filiere}).`);
      }
    }

    cellulesSource.push(
      [filiere, categorie, nom, description, seuil, caractere, reference, couche, type].join('\u001f'),
    );

    const conditions = seuilsNumeriques(seuil);
    const regles = decouperCaractere(caractere);
    const dominant = regles.reduce((a, b) => (SEVERITE[b.caractere] > SEVERITE[a.caractere] ? b : a));
    const typeNormalise = typeIntegration(type);

    contraintes.push({
      id: identifiant(filiere, nom, vus),
      filiere,
      categorie,
      nom,
      description,
      seuilReglementaire: seuil,
      seuilsNumeriques: conditions,
      extractionComplete: extractionComplete(seuil, conditions),
      caractere: dominant.caractere,
      caractereBrut: caractere,
      regles,
      referenceReglementaire: reference,
      coucheSig: couche,
      typeIntegration: typeNormalise,
      typeIntegrationBrut: type,
      modeEvaluation: modeEvaluation(typeNormalise, type),
    });
  }
}

/**
 * Millesime : repris du fichier precedent quand le CONTENU n'a pas change.
 * Redater un referentiel identique ferait croire a une verification qui n'a pas eu lieu.
 */
const ancien = (() => {
  try {
    return readFileSync(CIBLE, 'utf8');
  } catch {
    return null;
  }
})();
const millesimeAncien = /MILLESIME_REFERENTIEL = '([\d-]+)'/.exec(ancien ?? '')?.[1] ?? null;
const aujourdHui = new Date().toISOString().slice(0, 10);

/**
 * Le millesime date LE CLASSEUR, donc il se compare sur LES CELLULES DU CLASSEUR.
 *
 * DEUX FAUX REDATAGES OBSERVES, ET POURQUOI LA COMPARAISON A DEMENAGE DEUX FOIS.
 *
 *   1. La premiere version comparait les deux fichiers generes en entier. En rendant calculables
 *      deux nombres que j'avais figes a la main dans un commentaire (« 100 des 292 composites »
 *      pour 94, « 207 seuils sans nombre » pour 239), j'ai vu le millesime sauter a la date du
 *      jour sans qu'une seule contrainte ait bouge : ma prose datait le referentiel.
 *   2. Restreindre la comparaison au tableau `CONTRAINTES_REFERENTIEL` ne suffisait pas : ajouter
 *      `extractionComplete` — un champ CALCULE a partir du classeur, pas lu dedans — l'a redate
 *      une seconde fois. Un changement de code enrichissant le referentiel n'est pas une
 *      verification du referentiel.
 *
 * La seule chose qui doive dater ce module est donc ce qui vient du classeur et rien d'autre :
 * les huit cellules de chacune de ses 292 lignes, telles que lues. L'empreinte est ECRITE dans le
 * module genere, ce qui rend la comparaison independante de tout le reste du rendu.
 *
 * Pas une empreinte des octets du .xlsx : un simple reenregistrement par Excel les change sans
 * qu'aucun contenu ne bouge, et redaterait pour rien.
 */
const empreinteClasseur = createHash('sha256').update(cellulesSource.join('\u001e')).digest('hex').slice(0, 16);
const empreinteAncienne = /EMPREINTE_CLASSEUR = '([0-9a-f]+)'/.exec(ancien ?? '')?.[1] ?? null;
/**
 * Fichier genere AVANT que l'empreinte existe : on ne peut pas comparer, donc on ne redate pas.
 *
 * Redater serait affirmer une verification du classeur que rien n'etaye. Conserver le millesime
 * n'affirme rien de plus que ce qui etait deja ecrit. Cette branche ne sert qu'une fois — des la
 * premiere regeneration, l'empreinte est dans le module — et elle le dit a voix haute.
 */
if (ancien != null && empreinteAncienne == null) {
  console.warn(
    'Module genere avant l\'empreinte du classeur : millesime conserve, classeur non compare.',
  );
}
const inchange = empreinteAncienne == null ? ancien != null : empreinteAncienne === empreinteClasseur;
const candidat = rendre(contraintes, aujourdHui, parFiliere, empreinteClasseur);
const contenu =
  inchange && millesimeAncien
    ? rendre(contraintes, millesimeAncien, parFiliere, empreinteClasseur)
    : candidat;

if (process.argv.includes('--verifier')) {
  if (inchange) {
    console.log(`Referentiel a jour (millesime ${millesimeAncien}).`);
    process.exit(0);
  }
  console.error('Le classeur a CHANGE depuis la derniere generation. Relancer sans --verifier.');
  process.exit(1);
}

writeFileSync(CIBLE, contenu, 'utf8');

const composites = contraintes.filter((c) => c.regles.length > 1).length;
const auto = contraintes.filter((c) => c.modeEvaluation === 'auto_sig').length;
console.log(
  `${CIBLE}\n` +
    `  ${contraintes.length} contraintes : ` +
    [...parFiliere.entries()].map(([f, n]) => `${f}=${n}`).join(' ') +
    `\n  ${composites} a caractere composite (plusieurs regles)` +
    `\n  ${auto} evaluables automatiquement, ${contraintes.length - auto} en verification manuelle` +
    (inchange ? `\n  (inchange, millesime ${millesimeAncien} conserve)` : `\n  (millesime ${aujourdHui})`),
);
