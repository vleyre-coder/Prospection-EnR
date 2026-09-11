/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE DOSSIER DE SITE — le seul livrable du depot dont les chiffres sont des SOMMES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI REND CE DOCUMENT DIFFERENT DE TOUS LES AUTRES EXPORTS, et ce que ce fichier garde.
 *
 * La fiche parcelle, le CSV, le GeoJSON, le Shapefile decrivent chacun des parcelles UNE PAR UNE.
 * Si l'un d'eux perd une ligne, le lecteur voit une ligne de moins : le defaut est visible. Le
 * dossier de site, lui, annonce en page une une SURFACE CUMULEE et une PUISSANCE — deux nombres
 * agreges. Perdre une parcelle en chemin n'y produit aucun trou : cela produit un chiffre plus
 * petit, parfaitement plausible, qu'un developpeur recopiera dans son modele economique.
 *
 * C'est la raison d'etre de la moitie de ces tests. Les exports GeoJSON et Shapefile ecartent en
 * silence les parcelles sans score — c'est defendable pour un fichier SIG, ou chaque objet se lit
 * seul. Applique ici, ce meme comportement fabriquerait un document faux qui a l'air juste. La
 * route refuse donc la selection entiere (409) plutot que de servir une somme incomplete, et le
 * test ci-dessous l'exige.
 *
 * L'AUTRE MOITIE garde la METHODE derriere les deux chiffres agreges :
 *
 *   - la surface utile d'un site n'est PAS la somme des surfaces utiles de ses parcelles — si
 *     elles sont jointives, les limites interieures ne portent pas de cloture. Le dossier doit
 *     dire laquelle des deux methodes il applique, et la contiguite doit etre MESUREE, pas
 *     supposee ;
 *   - la puissance ne se deduit d'une surface qu'en photovoltaique. Un dossier eolien qui
 *     afficherait des MWc serait un chiffre invente dans un document remis a un tiers.
 *
 * Ces tests demandent une base peuplee. Sans `DATABASE_URL`, ils s'ignorent en le disant.
 */

import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { construireServeur } from '../src/serveur.js';
import { pool, requete } from '../src/bdd.js';
import { texteDuPdf } from './aides/texte-pdf.js';
import { effacerDepartement, lireFiches, reidentifier, semerFiche } from './aides/semer-fiches.js';
import { nbGroupesContigus } from '../src/depots/prospection.js';
import { libelleTypeSol } from '@enr/core';
// Territoire fictif PARTAGE : l'importer passe par le garde de serialisation (audit 11), qui refuse
// une execution en parallele sur une base commune.
import { DEP_LOCAL, INSEE_LOCAL } from './aides/communes-fictives.js';

const SECRET = 'secret-de-test-uniquement';
const DEP_FICTIF = DEP_LOCAL;
const INSEE_FICTIF = INSEE_LOCAL;

let app: Awaited<ReturnType<typeof construireServeur>> | null = null;
let entetes: Record<string, string> = {};

/** Parcelles semees en solaire au sol : identifiant et surface en hectares. */
const SOLAIRE: Array<{ idu: string; surfaceHa: number; section: string; numero: string }> = [];
/** Une parcelle semee en eolien, pour le cas ou la puissance ne se deduit pas d'une surface. */
let iduEolien: string | null = null;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  await effacerDepartement(DEP_FICTIF);
  for (const { fiche } of lireFiches()) {
    const semee = reidentifier(fiche, {
      codeInsee: INSEE_FICTIF,
      codeDepartement: DEP_FICTIF,
      nomCommune: 'Commune fictive de dossier',
    });
    await semerFiche(semee);
    const p = semee.parcelle;
    if (semee.score.filiere === 'solaire_sol') {
      SOLAIRE.push({
        idu: p.idu,
        surfaceHa: (p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) / 10000,
        section: p.section,
        numero: p.numero,
      });
    }
    if (semee.score.filiere === 'eolien_terrestre' && iduEolien == null) iduEolien = p.idu;
  }
  if (SOLAIRE.length === 0) return;
  app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'test@local',
      nom: 'test',
      role: 'prospection',
      habiliteDonneesProprietaires: false,
    })}`,
  };
  process.stderr.write(`# dossier de site : ${SOLAIRE.length} parcelle(s) solaire semee(s)\n`);
});

after(async () => {
  await app?.close();
  if (process.env['DATABASE_URL']) await effacerDepartement(DEP_FICTIF).catch(() => undefined);
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!app) {
    process.stderr.write('# base indisponible ou aucune fixture solaire : dossier de site ignore\n');
    return true;
  }
  return false;
}

async function dossier(
  idus: string[],
  filiere = 'solaire_sol',
): Promise<{ code: number; texte: string; corps: string }> {
  const rep = await app!.inject({
    method: 'POST',
    url: '/api/exports/dossier',
    headers: entetes,
    payload: { idus, filiere },
  });
  return {
    code: rep.statusCode,
    corps: rep.body.slice(0, 400),
    texte: rep.statusCode === 200 ? texteDuPdf(rep.rawPayload) : '',
  };
}

/** Nombre francais tel que le dossier l'imprime : « 12,34 ha ». */
const ha = (v: number): string => `${v.toFixed(2).replace('.', ',')} ha`;

/**
 * Presence d'une phrase, insensible aux espaces et a la casse.
 *
 * POURQUOI CETTE PRECAUTION, mesuree et non prophylactique. `texteDuPdf` restitue les chaines dans
 * l'ordre du DESSIN, et pdfkit decoupe un paragraphe justifie en segments dont les espaces de fin
 * de ligne n'existent pas dans le flux : la phrase ressort en
 * « labandepérimétraleestdéduiteparcellepar parcelle ». Mes deux premieres assertions echouaient
 * pour cette seule raison — le document etait juste, le test lisait mal. Les titres de section, eux,
 * sont mis en capitales par `titreSection`, d'ou la casse ignoree.
 *
 * Ce que cela COUTE : le test ne verifie plus l'espacement rendu. C'est acceptable, `texteDuPdf`
 * documentant lui-meme qu'il ne reconstitue aucune mise en page.
 */
const sansEspaces = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
const contient = (texte: string, phrase: string): boolean =>
  sansEspaces(texte).includes(sansEspaces(phrase));

/** Le plafond REEL, lu dans la route : jamais recopie ici. */
function plafondDeLaSource(): number {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/routes/divers.ts'),
    'utf8',
  );
  const m = /const MAX_PARCELLES_DOSSIER = (\d+);/.exec(source);
  assert.ok(m, 'plafond `MAX_PARCELLES_DOSSIER` introuvable dans la route');
  return Number(m![1]);
}

test('LA PORTEE EST EXIGEE : au moins deux parcelles solaires semees', () => {
  /*
   * Un dossier d'UNE parcelle ne teste rien de ce qui distingue ce document d'une fiche : ni la
   * somme des surfaces, ni la deduplication des points a lever, ni la mesure de contiguite (qui
   * rend 1 sans requete des qu'il n'y a qu'une parcelle). Si les fixtures tombent a une seule
   * parcelle solaire, ce fichier deviendrait decoratif sans que rien n'echoue.
   */
  if (ignorer()) return;
  assert.ok(
    SOLAIRE.length >= 2,
    `${SOLAIRE.length} parcelle(s) solaire dans les fixtures : le dossier de site ne serait plus ` +
      "verifie sur ce qui le distingue d'une fiche parcelle — la somme des surfaces et la contiguite.",
  );
});

test('le dossier porte les six themes demandes pour un developpeur', async () => {
  if (ignorer()) return;
  const { code, texte, corps } = await dossier(SOLAIRE.map((p) => p.idu));
  assert.equal(code, 200, corps);

  /*
   * LA LISTE VIENT DE LA DEMANDE, mot pour mot : « la distance par rapport aux transports, la
   * puissance estimative du projet [...], le PLU, les zones inondables et les zones forestieres
   * [...] egalement les elements topographiques ». Chaque entree ci-dessous est l'une d'elles.
   */
  for (const attendu of [
    'Accès et transports',
    'Raccordement électrique',
    'Urbanisme applicable',
    'Eau et inondation',
    'Milieux naturels et boisement',
    'Topographie et sous-sol',
    'Puissance estimée',
    'Surface utile estimée',
  ]) {
    assert.ok(
      contient(texte, attendu),
      `« ${attendu} » absent du dossier : le document ne repond plus a la demande qui l'a fait naitre`,
    );
  }
});

test('LA SOMME EST LA SOMME : aucune parcelle n’est perdue en chemin', async () => {
  if (ignorer()) return;
  const { code, texte, corps } = await dossier(SOLAIRE.map((p) => p.idu));
  assert.equal(code, 200, corps);

  const total = SOLAIRE.reduce((s, p) => s + p.surfaceHa, 0);
  assert.ok(
    contient(texte, ha(total)),
    `surface cadastrale cumulee « ${ha(total)} » absente du dossier. C'est le defaut le plus ` +
      `dangereux de ce document : une somme incomplete n'a pas l'air d'une erreur, elle a l'air ` +
      `d'un site plus petit. Surfaces attendues : ${SOLAIRE.map((p) => ha(p.surfaceHa)).join(' + ')}`,
  );
  for (const p of SOLAIRE) {
    assert.ok(
      texte.includes(p.idu),
      `parcelle ${p.idu} absente du tableau du dossier alors qu'elle est dans la selection`,
    );
  }
});

test('UNE PARCELLE NON QUALIFIEE FAIT ECHOUER LA DEMANDE, elle n’est pas ignoree', async () => {
  if (ignorer()) return;
  /*
   * L'identifiant est syntaxiquement valide et n'existe pas en base — exactement le cas d'une
   * selection faite avant une requalification. Les exports GeoJSON et Shapefile le laisseraient
   * tomber en silence ; ici, le silence produirait une surface cumulee fausse.
   */
  const inexistante = `${DEP_FICTIF}${INSEE_FICTIF.slice(2)}000ZZ9999`;
  const { code, corps } = await dossier([...SOLAIRE.map((p) => p.idu), inexistante]);
  assert.equal(
    code,
    409,
    `une parcelle non qualifiee a ete servie sans erreur (${code}) : le dossier a donc ete produit ` +
      `sur une selection amputee, avec une surface et une puissance cumulees fausses. Reponse : ${corps}`,
  );
  assert.ok(
    corps.includes(inexistante),
    `l'erreur doit NOMMER la ou les parcelles en cause, sinon l'operateur ne sait pas quoi corriger : ${corps}`,
  );
});

test('la selection est plafonnee : un dossier n’est pas un departement', async () => {
  if (ignorer()) return;
  const premier = SOLAIRE[0]!;
  /*
   * LE PLAFOND EST LU DANS LA SOURCE, plus ecrit en dur ici. La premiere version fabriquait
   * 26 identifiants pour un plafond de 25 : le jour ou le plafond a change — mesure a l'appui —
   * ce test a commence a envoyer 26 identifiants sous une limite de 100, donc a verifier que la
   * route accepte, en croyant verifier qu'elle refuse. Un test qui vieillit dans ce sens-la ne
   * fait aucun bruit.
   */
  const plafond = plafondDeLaSource();
  const trop = Array.from(
    { length: plafond + 1 },
    (_, i) => `${premier.idu.slice(0, 10)}${String(i).padStart(4, '0')}`,
  );
  const { code, corps } = await dossier(trop);
  assert.equal(code, 400, `plafond de ${plafond} non applique : ${code} ${corps}`);

  // Et EXACTEMENT au plafond, la route ne refuse pas sur le nombre : elle va chercher les
  // parcelles, n'en trouve pas, et repond 409. Sans cette moitie, un plafond tombe a zero
  // passerait le test ci-dessus.
  const pile = trop.slice(0, plafond);
  const { code: codePile } = await dossier(pile);
  assert.equal(
    codePile,
    409,
    `a ${plafond} identifiants exactement, la route doit passer le controle de nombre (409 sur ` +
      `l'absence des parcelles), et non refuser sur le plafond`,
  );
});

test('EN EOLIEN, AUCUN NOMBRE DE MW N’EST ANNONCE', async () => {
  if (ignorer()) return;
  if (!iduEolien) {
    process.stderr.write('# aucune fixture eolienne : cas de la puissance non deductible ignore\n');
    return;
  }
  const { code, texte, corps } = await dossier([iduEolien], 'eolien_terrestre');
  assert.equal(code, 200, corps);
  assert.ok(
    contient(texte, 'non déductible d’une surface') || contient(texte, "non déductible d'une surface"),
    'le dossier eolien doit dire que la puissance ne se deduit pas d’une surface. La puissance d’un ' +
      'parc est un nombre de machines multiplie par leur puissance unitaire : une densite MW/ha ' +
      'appliquee mecaniquement produit un chiffre faux avec l’air d’etre calcule.',
  );
  assert.ok(
    !/\d\s*MWc/.test(texte),
    `un nombre de MWc figure dans un dossier EOLIEN : ${/\S*\s*\S*\s*MWc/.exec(texte)?.[0] ?? ''}`,
  );
});

test('la methode de surface utile est ECRITE, pas seulement appliquee', async () => {
  if (ignorer()) return;
  const { code, texte, corps } = await dossier(SOLAIRE.map((p) => p.idu));
  assert.equal(code, 200, corps);
  /*
   * Les deux methodes possibles, et le dossier doit nommer celle qu'il a retenue. Sans cette
   * phrase, deux dossiers portant la meme surface cadastrale afficheraient deux surfaces utiles
   * differentes sans que rien n'explique l'ecart — qui peut atteindre 38 % sur un site a trois
   * parcelles.
   */
  assert.ok(
    contient(texte, 'emprise unique') || contient(texte, 'parcelle par parcelle'),
    'la methode de calcul de la surface utile n’est pas ecrite dans le dossier',
  );
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LA CONTIGUITE RESTITUEE EST CELLE QUI A ETE MESUREE — verifiee contre la base, pas contre
   * une phrase possible
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * CE QUE MA PREMIERE VERSION ACCEPTAIT, et la mutation l'a montre : elle se contentait de voir
   * l'une des trois phrases possibles. Remplacer l'appel a `nbGroupesContigus` par la constante
   * `1` — donc supposer un site d'un seul tenant sans rien mesurer — ne la faisait pas echouer.
   * Or c'est precisement la substitution la plus couteuse : le modele « emprise unique » deduit la
   * bande perimetrale d'un seul contour, et surestime la surface utile de pres de 40 % sur un site
   * disperse. Le test « verifiait » la ligne la plus dangereuse du document en n'exigeant rien.
   *
   * La verite de reference est prise EN BASE, sur les memes parcelles : le test ne suppose donc
   * rien de la geometrie des fixtures et resterait juste si elles devenaient jointives.
   */
  const groupes = await nbGroupesContigus(SOLAIRE.map((p) => p.idu));
  const attendu =
    groupes == null
      ? { emprise: 'contiguïté indéterminée', methode: 'parcelle par parcelle' }
      : groupes === 1
        ? { emprise: 'un seul tenant', methode: 'emprise unique' }
        : { emprise: `${groupes} emprises séparées`, methode: 'parcelle par parcelle' };
  assert.ok(
    contient(texte, attendu.emprise),
    `contiguite mesuree en base : ${String(groupes)} groupe(s), le dossier doit ecrire ` +
      `« ${attendu.emprise} » — introuvable. Le lecteur ne peut pas savoir si le site est d’un ` +
      `seul tenant ou disperse, alors que cela change la surface utile ET l’acces a negocier.`,
  );
  assert.ok(
    contient(texte, attendu.methode),
    `la methode annoncee ne correspond pas a la contiguite mesuree (${String(groupes)} groupe(s)) : ` +
      `« ${attendu.methode} » attendu`,
  );
});

test('aucune date ISO ni point decimal dans le dossier', async () => {
  if (ignorer()) return;
  const { code, texte, corps } = await dossier(SOLAIRE.map((p) => p.idu));
  assert.equal(code, 200, corps);

  const iso = [...new Set(texte.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  assert.deepEqual(iso, [], `dates ISO dans le dossier — ${iso.join(', ')}`);

  /*
   * Meme regle que la relecture des rapports (audit 10, defaut B2) : un nombre decimal francais a
   * deux groupes de chiffres autour d'un point ; les versions (`1.4.0`) et les rubriques IOTA en
   * ont trois ou plus. Les URL de reglement d'urbanisme sont exclues : le point y est correct.
   */
  const sansUrl = texte.replace(/https?:\/\/\S+/g, ' ');
  const points = [...sansUrl.matchAll(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g)]
    .map((m) => m[0])
    .filter((s) => s.split('.').length === 2);
  assert.deepEqual(points, [], `points decimaux dans le dossier — ${points.join(', ')}`);
});

test('LE DOSSIER DIT QUELLE AGRICULTURE EST DECLAREE SUR CHAQUE PARCELLE', async () => {
  if (ignorer()) return;
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * CE QUI MANQUAIT AU DOSSIER, ET C'EST UNE DEMANDE EXPLICITE
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * Le dossier remis au developpeur portait l'acces, le raccordement, l'urbanisme, l'eau, les
   * milieux et la topographie — mais RIEN sur l'agriculture. `occupationSol` n'y etait lu que
   * pour la part boisee. Or c'est la premiere question d'un projet agrivoltaique : qu'est-ce qui
   * est cultive, depuis quand, et sur quelle part de la parcelle. Sans ce tableau, le developpeur
   * qui recoit le dossier doit retourner au RPG lui-meme, parcelle par parcelle.
   */
  const { code, texte, corps } = await dossier(SOLAIRE.map((p) => p.idu));
  assert.equal(code, 200, corps);

  assert.ok(
    contient(texte, 'Occupation du sol et agriculture'),
    'la section d’occupation du sol doit exister dans le dossier',
  );
  // Les quatre colonnes qui repondent chacune a une question du developpeur.
  for (const entete of ['Nature du sol', 'Culture déclarée', 'Déclarée', 'AOP']) {
    assert.ok(contient(texte, entete), `colonne « ${entete} » absente de la section agriculture`);
  }

  /*
   * ET LE CONTENU DOIT VENIR DE LA BASE, non d'un gabarit. Les fixtures solaires portent une
   * nature de sol : le libelle correspondant doit se lire dans le dossier. Sans cette
   * verification, une section vide passerait le test precedent.
   */
  const lignes = await requete<{ t: string | null }>(
    `SELECT DISTINCT snapshot -> 'occupationSol' ->> 'typeSol' AS t
       FROM parcelle_snapshot WHERE idu = ANY($1)`,
    [SOLAIRE.map((p) => p.idu)],
  );
  const naturesAttendues = lignes.map((l) => l.t).filter((t): t is string => t != null);
  if (naturesAttendues.length > 0) {
    // Le libelle COURT : la colonne fait 17 % de la largeur, le libelle long y passerait sur
    // trois lignes. C'est celui que la section rend, donc celui qu'il faut chercher.
    const libelles = naturesAttendues.map((t) => libelleTypeSol(t) ?? t);
    assert.ok(
      libelles.some((l) => contient(texte, l)),
      `aucune des natures de sol de la base (${libelles.join(', ')}) n’apparait dans le dossier : ` +
        'la section est presente mais vide.',
    );
  }

});

test('LE DOSSIER NE CONFOND PAS « AUCUNE DECLARATION PAC » ET « DONNEE INDISPONIBLE »', async () => {
  if (ignorer()) return;
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * DEUX PHRASES QUI NE DISENT PAS LA MEME CHOSE — et ma premiere version ne les distinguait pas
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * « Aucune declaration PAC » est un CONSTAT : le RPG a repondu, et aucun ilot ne recouvre la
   * parcelle. C'est meme un argument FAVORABLE en solaire au sol, puisqu'il oriente vers le regime
   * du terrain inculte plutot que vers l'agrivoltaisme. « Donnee indisponible » est un AVEU
   * d'ignorance : le RPG n'a pas repondu, et on ne sait rien. Ecrire la premiere a la place de la
   * seconde transforme une ignorance en affirmation, dans un document remis a un tiers.
   *
   * POURQUOI CE TEST FABRIQUE SON CAS. Aucune fixture ne porte
   * `anneesDeclareesConsecutives: null` — mesure sur la base de reference : 294 parcelles a 5 ans,
   * 3 a zero, 3 a trois ans, 1 a quatre. Ma premiere ecriture se contentait donc d'une disjonction
   * qui passait trivialement, et la mutation qui EFFONDRE les deux etats a survecu. Le cas est
   * desormais ETABLI par le test, ce qui est la seule facon de le rendre discriminant.
   */
  const cible = SOLAIRE[0]!;
  const avant = await requete<{ snapshot: unknown }>(
    `SELECT snapshot FROM parcelle_snapshot WHERE idu = $1`,
    [cible.idu],
  );
  assert.ok(avant[0], 'la parcelle de test doit porter un instantane');

  try {
    // RPG muet : ni culture, ni groupe, ni annees. C'est l'etat produit par un connecteur en echec.
    await requete(
      `UPDATE parcelle_snapshot
          SET snapshot = jsonb_set(snapshot, '{occupationSol,rpg}', $2::jsonb, true)
        WHERE idu = $1`,
      [
        cible.idu,
        JSON.stringify({
          codeCulture: null,
          libelleCulture: null,
          codeGroupeCulture: null,
          libelleGroupeCulture: null,
          millesime: null,
          partRecouvrement: null,
          anneesDeclareesConsecutives: null,
        }),
      ],
    );

    const { code, texte, corps } = await dossier([cible.idu]);
    assert.equal(code, 200, corps);
    assert.ok(
      contient(texte, 'donnée indisponible'),
      'le RPG n’a pas repondu : le dossier doit l’avouer, et non ecrire « aucune declaration PAC », ' +
        'qui ferait passer une ignorance pour un constat favorable.',
    );
    assert.ok(
      !contient(texte, 'aucune déclaration PAC'),
      'le dossier annonce une absence de declaration alors que le RPG n’a pas ete consulte',
    );

    // ET LE CAS INVERSE, pour que le test ne puisse pas passer en ecrivant toujours la meme
    // phrase : RPG consulte, zero annee declaree.
    await requete(
      `UPDATE parcelle_snapshot
          SET snapshot = jsonb_set(snapshot, '{occupationSol,rpg,anneesDeclareesConsecutives}', '0'::jsonb, true)
        WHERE idu = $1`,
      [cible.idu],
    );
    const apres = await dossier([cible.idu]);
    assert.equal(apres.code, 200, apres.corps);
    assert.ok(
      contient(apres.texte, 'aucune déclaration PAC'),
      'RPG consulte sans ilot recouvrant : c’est un constat, et le dossier doit l’ecrire comme tel',
    );
    assert.ok(
      !contient(apres.texte, 'donnée indisponible'),
      'le dossier avoue une ignorance alors que le RPG a bien repondu',
    );
  } finally {
    await requete(`UPDATE parcelle_snapshot SET snapshot = $2::jsonb WHERE idu = $1`, [
      cible.idu,
      JSON.stringify(avant[0]!.snapshot),
    ]);
  }
});
