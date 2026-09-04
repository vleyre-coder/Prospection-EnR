/**
 * Un rapport PDF par filiere, plus une parcelle ecartee : la relecture, rejouee a chaque execution.
 *
 * POURQUOI CE FICHIER EXISTE — audit 10, risque F2. Le rapport avait ete relu en entier une fois, sur
 * une parcelle agricole en Beauce, en solaire au sol. Cette relecture avait trouve le defaut B2 : sept
 * dates ISO par rapport. Mais les quatre filieres ne produisent pas les memes pages — la methanisation
 * ajoute ses rubriques IOTA, l'eolien ses distances d'eloignement — et une parcelle ECARTEE remplace la
 * synthese chiffree par des motifs eliminatoires. Trois familles de pages entieres n'avaient jamais ete
 * regardees, et le risque disait exactement cela.
 *
 * CE QUE LA RELECTURE DES QUATRE AUTRES A TROUVE. Deux defauts, tous deux de la famille « le rapport ne
 * dit pas la meme chose que la fiche » :
 *
 *   - « Occupation du sol : agricole_exploite » — la valeur d'enumeration brute, a la ligne suivant
 *     « Contenance cadastrale : 19,84 ha », dans le document remis a un proprietaire. La fiche affichait
 *     au meme instant « Terrain agricole exploite ». La table de libelles existait, complete et juste,
 *     dans `packages/scoring` ; elle n'etait simplement pas exportee.
 *   - « Fondement : eol_distance_habitation » — une cle de code donnee comme base juridique du rejet
 *     d'une parcelle. La fiche resout la meme cle et affiche « Code de l'environnement, art. L.515-44,
 *     en vigueur depuis le … ». Ce cas n'apparait que sur une parcelle ecartee : la seule relecture
 *     faite jusque-la portait sur une parcelle qui ne l'etait pas.
 *
 * Ces tests demandent une base peuplee. Sans `DATABASE_URL`, ils s'ignorent en le disant.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireServeur } from '../src/serveur.js';
import { pool, requete } from '../src/bdd.js';
import { FILIERES, FILIERES_META } from '@enr/core';
import { texteDuPdf } from './aides/texte-pdf.js';
import { effacerDepartement, lireFiches, reidentifier, semerFiche } from './aides/semer-fiches.js';
import { DEP_LOCAL, INSEE_LOCAL } from './aides/communes-fictives.js';

const SECRET = 'secret-de-test-uniquement';

/**
 * Les cas relus : les quatre filieres, prises du referentiel et non ecrites a la main.
 *
 * `attendu` est le libelle officiel de la filiere, tel que le rapport l'imprime en tete
 * (« Filiere etudiee : Eolien terrestre »). Il prouve que le rapport est bien celui de la filiere
 * demandee, et pas quatre fois le meme document.
 *
 * Ma premiere version cherchait un mot-cle de contenu — « Vent » pour l'eolien, « Irradiation » pour
 * le solaire. Elle echouait sur la parcelle ECARTEE : un rapport de rejet n'imprime pas les criteres,
 * il imprime les motifs eliminatoires. Le mot-cle etait donc absent pour une raison parfaitement
 * legitime, et le test accusait le code d'un defaut inexistant. L'en-tete, lui, est present partout.
 */
const CAS = FILIERES.map((f) => ({
  nom: FILIERES_META[f].libelleCourt,
  filiere: f as string,
  attendu: FILIERES_META[f].libelle,
}));

let app: Awaited<ReturnType<typeof construireServeur>> | null = null;
let entetes: Record<string, string> = {};
/** Filiere -> IDU d'une parcelle qualifiee dans cette filiere. */
const PARCELLES = new Map<string, string>();
/** Filiere -> IDU d'une parcelle ECARTEE (statut rouge) dans cette filiere, s'il en existe une. */
const ECARTEES = new Map<string, string>();

/** Commune fictive : aucune donnee reelle ne porte le departement 99. */
/** Territoire fictif PARTAGE : importe, pour passer par le garde de serialisation (audit 11). */
const DEP_FICTIF = DEP_LOCAL;
const INSEE_FICTIF = INSEE_LOCAL;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  /**
   * LES CAS SONT SEMES, PLUS CHERCHES DANS LA BASE — et c'est un correctif, pas un choix initial.
   *
   * La version precedente les choisissait par requete : « la plus grande parcelle qualifiee dans chaque
   * filiere ». L'intention etait juste — ne jamais ecrire un identifiant en dur, travailler sur de la
   * donnee reelle — mais la PORTEE du test devenait une propriete de la machine. Verifie par mutation :
   *
   *   - base vierge fraichement migree, celle de la CI : aucune parcelle, le fichier s'ignorait en
   *     entier, et les deux mutations qui retablissent les defauts de cette relecture passaient. Le job
   *     de mutation de la CI echouait, en signalant a juste titre deux tests decoratifs ;
   *   - base semee pour les tests de bout en bout : une seule filiere, et la plus grande parcelle se
   *     trouvait n'avoir aucune nature de sol renseignee — la mutation qui replace le libelle par la cle
   *     d'enumeration ne produisait alors rien a trouver.
   *
   * La donnee semee reste REELLE : ce sont les fiches capturees pour les tests de rendu, avec leurs
   * geometries, leurs instantanes et leurs scores — dont la parcelle ECARTEE en eolien, le cas ou se
   * trouvait « Fondement : eol_distance_habitation ». Elles sont seulement REIDENTIFIEES vers une
   * commune fictive : un test ne doit jamais ecrire sur l'identifiant d'une parcelle veritable, qui
   * existerait dans la base de production de quelqu'un.
   */
  await effacerDepartement(DEP_FICTIF);
  for (const { fiche } of lireFiches()) {
    const semee = reidentifier(fiche, {
      codeInsee: INSEE_FICTIF,
      codeDepartement: DEP_FICTIF,
      nomCommune: 'Commune fictive de relecture',
    });
    await semerFiche(semee);
    const f = semee.score.filiere;
    if (!PARCELLES.has(f)) PARCELLES.set(f, semee.parcelle.idu);
    if (semee.score.statut === 'rouge' && !ECARTEES.has(f)) ECARTEES.set(f, semee.parcelle.idu);
  }
  if (PARCELLES.size === 0) return;
  app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@local',
      nom: 'test',
      role: 'lecture',
      habiliteDonneesProprietaires: false,
    })}`,
  };
  // La couverture reelle est ANNONCEE : un test qui reduit son perimetre en silence donne l'illusion
  // d'avoir tout regarde. C'est le reproche fait au garde de l'audit 5 (defaut B2 de l'audit 10).
  process.stderr.write(
    `# relecture PDF : ${PARCELLES.size}/${CAS.length} filieres couvertes (${[...PARCELLES.keys()].join(', ')})` +
      `, dont ${ECARTEES.size} avec une parcelle ecartee\n`,
  );
});

after(async () => {
  await app?.close();
  if (process.env['DATABASE_URL']) await effacerDepartement(DEP_FICTIF).catch(() => undefined);
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!app) {
    process.stderr.write('# base indisponible ou aucune parcelle qualifiee : relecture PDF ignoree\n');
    return true;
  }
  return false;
}

/** Les cas effectivement disponibles dans cette base. */
function casDisponibles(): Array<(typeof CAS)[number] & { idu: string }> {
  return CAS.flatMap((c) => {
    const idu = PARCELLES.get(c.filiere);
    return idu ? [{ ...c, idu }] : [];
  });
}

async function rapport(filiere: string, iduCible: string): Promise<string> {
  const rep = await app!.inject({
    method: 'GET',
    url: `/api/exports/parcelle/${iduCible}.pdf?filiere=${filiere}`,
    headers: entetes,
  });
  assert.equal(rep.statusCode, 200, `${filiere} : ${rep.statusCode} ${rep.body.slice(0, 200)}`);
  const texte = texteDuPdf(rep.rawPayload);
  assert.ok(
    texte.length > 3000,
    `${filiere} : texte extrait suspicieusement court (${texte.length} car.) — l'extraction a peut-etre echoue, et le garde passerait alors a vide`,
  );
  return texte;
}

/**
 * Nombres a point decimal, hors les deux notations ou le point est la bonne ponctuation.
 *
 * Un nombre decimal francais a exactement DEUX groupes de chiffres autour d'un point ; les versions
 * (`1.4.0`) et les rubriques IOTA (`2.1.5.0`) en ont trois ou quatre. Compter les groupes suffit donc,
 * sans nommer aucune valeur.
 *
 * S'ajoute UNE exception nommee, documentee a l'audit 10 : les coordonnees WGS84. Le rapport ecrit
 * « 48.15654 N, 1.79017 E », et le point y est correct — la paire est separee par une virgule, et un
 * separateur decimal virgule donnerait « 48,15654, 1,79017 », illisible pour l'humain comme pour
 * l'outil cartographique ou ces coordonnees sont destinees a etre collees. L'exception est reconnue a
 * sa STRUCTURE (un nombre suivi d'un point cardinal), pas a sa valeur.
 */
function pointsDecimaux(t: string): string[] {
  const sansCoordonnees = t.replace(/\d+\.\d+\s*[NSEW]\b/g, ' ');
  return [...sansCoordonnees.matchAll(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g)]
    .map((m) => m[0])
    .filter((s) => s.split('.').length === 2);
}

test('LA PORTEE EST EXIGEE, plus seulement annoncee', () => {
  /**
   * LE GARDE QUI MANQUAIT, et son absence a casse la CI. Ce fichier annoncait sa portee reduite sur la
   * sortie d'erreur — c'est ce qui a permis de comprendre le probleme — mais il PASSAIT quand cette
   * portee tombait a zero. Une garde qui disparait sans faire echouer quoi que ce soit ne garde rien.
   *
   * Maintenant que les cas sont semes et non cherches, la portee ne depend plus de la base : elle
   * depend des fixtures, qui sont dans le depot. L'exiger est donc legitime, et cela verrouille les deux
   * conditions sans lesquelles les defauts de cette relecture redeviendraient invisibles — les QUATRE
   * filieres, et AU MOINS UNE parcelle ecartee.
   */
  if (ignorer()) return;
  assert.deepEqual(
    CAS.map((c) => c.filiere).filter((f) => !PARCELLES.has(f)),
    [],
    'filiere(s) sans cas semé : les fixtures ne couvrent plus les quatre filieres, et la relecture ' +
      'perd des pages entieres (rubriques IOTA de la methanisation, eloignements de l’eolien).',
  );
  assert.ok(
    ECARTEES.size > 0,
    'aucune parcelle ECARTEE parmi les fixtures : c’est le cas ou se trouvait « Fondement : ' +
      'eol_distance_habitation », une cle de code donnee comme base juridique dans un document remis ' +
      'a un proprietaire. Sans lui, ce defaut redevient invisible.',
  );
});

test('les quatre filieres produisent chacune leur propre rapport', async () => {
  if (ignorer()) return;
  for (const cas of casDisponibles()) {
    const t = await rapport(cas.filiere, cas.idu);
    assert.ok(
      t.includes(cas.attendu),
      `${cas.nom} : « ${cas.attendu} » attendu dans le rapport, absent — le rapport n'est peut-etre pas celui de cette filiere`,
    );
  }
});

test('LE DEFAUT B2 DE L’AUDIT 10, sur TOUTES les filieres : aucune date ISO', async () => {
  if (ignorer()) return;
  for (const cas of casDisponibles()) {
    const iso = [...new Set((await rapport(cas.filiere, cas.idu)).match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
    assert.deepEqual(iso, [], `${cas.nom} : dates ISO dans le rapport — ${iso.join(', ')}`);
  }
});

test('LE DEFAUT B1 DE L’AUDIT 10, sur TOUTES les filieres : aucun nombre a point decimal', async () => {
  if (ignorer()) return;
  for (const cas of casDisponibles()) {
    const fautes = pointsDecimaux(await rapport(cas.filiere, cas.idu));
    assert.deepEqual(fautes, [], `${cas.nom} : nombres a point decimal — ${fautes.join(', ')}`);
  }
});

test('LE DEFAUT TROUVE PAR CETTE RELECTURE : aucune cle technique ne tient lieu de libelle', async () => {
  /**
   * Le rapport est remis a un proprietaire ou a un financeur. Une valeur d'enumeration en minuscules
   * separee par des soulignes y est un accident de fabrication, pas une information.
   *
   * UNE exception, et elle est justifiee : le NOM D'UN CONNECTEUR en echec, par exemple
   * `postes_sources`. C'est l'identifiant reel du connecteur, il est le meme dans la fiche, et c'est
   * lui qu'on cite pour demander de l'aide. Le remplacer par un libelle rendrait le message moins
   * actionnable, pas plus.
   */
  if (ignorer()) return;
  const connecteurs = new Set(
    (await requete<{ connecteur: string }>('SELECT connecteur FROM source_donnee')).map(
      (l) => l.connecteur,
    ),
  );
  for (const cas of casDisponibles()) {
    const t = await rapport(cas.filiere, cas.idu);
    const cles = [...new Set(t.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [])].filter(
      (c) => !connecteurs.has(c),
    );
    assert.deepEqual(
      cles,
      [],
      `${cas.nom} : cles techniques affichees telles quelles — ${cles.join(', ')}`,
    );
  }
});

test('LE CAS ECARTE : un rapport de parcelle rejetee porte ses motifs et leur base juridique', async () => {
  /**
   * Le cas le plus important du fichier, et celui que la relecture unique de l'audit 10 n'avait pas
   * couvert : sur une parcelle ECARTEE, la synthese chiffree cede la place aux motifs eliminatoires,
   * et c'est la que se trouvait « Fondement : eol_distance_habitation » — une cle de code donnee comme
   * base juridique du rejet, dans le document remis a un proprietaire.
   *
   * Ce que ce test exige n'est donc pas un article precis — cela dependrait des donnees — mais la
   * PROPRIETE : tout fondement cite doit etre une reference lisible, accompagnee de sa date d'entree
   * en vigueur au format francais, jamais un identifiant interne.
   */
  if (ignorer()) return;
  if (ECARTEES.size === 0) {
    process.stderr.write('# aucune parcelle ecartee dans cette base : cas ecarte non couvert\n');
    return;
  }
  for (const [filiere, iduEcartee] of ECARTEES) {
    const t = await rapport(filiere, iduEcartee);
    assert.ok(/rédhibitoire/i.test(t), `${filiere} : la section des criteres redhibitoires doit exister`);

    const fondements = [...t.matchAll(/Fondement\s*:\s*([^\n]{0,120})/g)].map((m) => m[1]!.trim());
    assert.ok(fondements.length > 0, `${filiere} : une parcelle ecartee doit citer au moins un fondement`);
    for (const f of fondements) {
      assert.ok(
        !/^[a-z0-9]+(?:_[a-z0-9]+)+/.test(f),
        `${filiere} : le fondement est un identifiant interne et non une reference — « ${f} »`,
      );
      assert.ok(
        /en vigueur depuis le \d{2}\/\d{2}\/\d{4}/.test(f),
        `${filiere} : le fondement doit porter sa date d’entree en vigueur au format francais — « ${f} »`,
      );
    }
  }
});
