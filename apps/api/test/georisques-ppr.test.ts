/**
 * Classification des plans de prevention des risques.
 *
 * POURQUOI CE FICHIER EXISTE. Le septieme audit a etabli que la detection des PPR n'avait jamais
 * fonctionne : le connecteur lisait `libelle_risque_long` puis `libelle_risque`, deux champs qui
 * n'existent pas dans la reponse de `gaspar/pprn`. Le champ reel est `libPpr`. `familleRisque`
 * recevait donc toujours la chaine vide, la table par famille restait vide en toute circonstance,
 * et l'application AFFIRMAIT — pas « ignorait », affirmait — `ppri.present = false`,
 * `pprif.present = false`, `pprt.present = false` et `inondation.alea = 'nul'`, sur toutes les
 * parcelles de France.
 *
 * Verifie par execution avant correction : Arles (PPRN-I submersion marine), Aix-en-Provence
 * (6 plans), Nice (7 plans), Montpellier (PPRI + PPRIF) ressortaient tous en « aucun PPR, alea
 * nul ». Une parcelle en zone rouge de PPRI pouvait ressortir verte.
 *
 * Le defaut avait deux etages, et les tests couvrent les deux : le nom du champ, et le fait que
 * le vocabulaire reel est CODE et non redige.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familleRisque, famillesRisque, zonesReglementaires } from '../src/connecteurs/georisques.js';

// ---------------------------------------------------------------------------
// Libelles reellement releves sur le service, commune par commune
// ---------------------------------------------------------------------------

/**
 * Chaque entree a ete relevee sur `gaspar/pprn` en aout 2026. Ce ne sont pas des exemples
 * inventes : c'est le vocabulaire que le service emploie.
 */
const LIBELLES_REELS: ReadonlyArray<[string, ReturnType<typeof familleRisque>]> = [
  // Inondation — aucun de ces libelles ne contient le mot « inondation ».
  ['PPRN-I - SUB marine - Arles 2015', 'inondation'],
  ['PPRN-I - BV Arc [ Aix-en-Provence ] 2020', 'inondation'],
  ['PPRN-I - Beaucaire', 'inondation'],
  ['PPRN-I - Montpellier', 'inondation'],
  ['PPRI_Lez_Mosson', 'inondation'],
  ['PPRI du Grand Lyon - secteur Lyon-Villeurbanne', 'inondation'],
  ['PPRi-Lézarde', 'inondation'],
  ['PPRL-PANES', 'inondation'],
  ['PER-I - BV Paillons [ Nice ] 1999', 'inondation'],
  // Incendie de foret.
  ['PPRIF Montpellier', 'incendie'],
  ['PPRN-IF - Aix-en-Provence 2021', 'incendie'],
  ['PPRN-IF - Nice 2017 [ MOD 1 - 2021 ]', 'incendie'],
  // Mouvement de terrain.
  ['PPRN-MVT - Nice 2020', 'mouvement'],
  ['PPRN-Mvt - Nice (Cimiez) 2008', 'mouvement'],
  // Retrait-gonflement des argiles.
  ['PPRN-RGA - Aix-en-Provence 2012', 'argiles'],
  // Seisme : famille reconnue, mais aucun critere du referentiel ne la porte.
  ['PPRN-S - seisme_Aix_en_Provence', 'seisme'],
  ['PPRN-S - Nice 2019', 'seisme'],
  // Indetermine : aucune nature lisible. Doit le rester.
  ['PPR Bordeaux (revision)', null],
];

for (const [libelle, attendu] of LIBELLES_REELS) {
  test(`« ${libelle} » -> ${attendu ?? 'indetermine'}`, () => {
    assert.equal(familleRisque(libelle), attendu);
  });
}

test('les sigles composes survivent : ne jamais decouper le libelle pour en extraire un sigle', () => {
  // Piege rencontre a l'ecriture : `'PPRN-I'.split(/[\s\-_]/)[0]` vaut `'pprn'`, et aucune regle
  // portant sur `pprn-i` ne s'applique alors. Ce test verrouille le comportement, pas la methode.
  assert.equal(familleRisque('PPRN-I'), 'inondation');
  assert.equal(familleRisque('PPRN-IF'), 'incendie');
  assert.equal(familleRisque('PPRN-MVT'), 'mouvement');
  assert.equal(familleRisque('PPRN-RGA'), 'argiles');
});

test('le souligne ne casse pas la limite de mot', () => {
  // Second piege rencontre : `_` est un caractere de MOT en expression reguliere, donc
  // `\bppri\b` ne matche pas `ppri_lez_mosson`. Le libelle doit etre normalise avant comparaison.
  assert.equal(familleRisque('PPRI_Lez_Mosson'), 'inondation');
  assert.equal(familleRisque('PPRN-S - seisme_Aix_en_Provence'), 'seisme');
});

test('l’ordre des regles est significatif : IF, MVT, RGA et S avant I', () => {
  // `PPRIF` contient `PPRI`. Si l'inondation etait testee d'abord, tous les plans incendie
  // seraient classes inondation — et le critere incendie resterait muet.
  assert.equal(familleRisque('PPRIF'), 'incendie');
  assert.equal(familleRisque('PPRI'), 'inondation');
  assert.notEqual(familleRisque('PPRN-IF - quelque part'), 'inondation');
  assert.notEqual(familleRisque('PPRN-S - quelque part'), 'inondation');
});

test('le repli sur les mots entiers reste actif', () => {
  // Un service qui redigerait ses libelles doit continuer a etre comprehensible.
  assert.equal(familleRisque("Plan de prevention du risque d'inondation de la Loire"), 'inondation');
  assert.equal(familleRisque('Risque incendie de foret du massif des Maures'), 'incendie');
  assert.equal(familleRisque('Risque technologique - site Seveso'), 'technologique');
  assert.equal(familleRisque('Glissement de terrain'), 'mouvement');
  assert.equal(familleRisque('Retrait-gonflement des argiles'), 'argiles');
});

test('un libelle vide ou absent n’est jamais range', () => {
  assert.equal(familleRisque(''), null);
  assert.equal(familleRisque('   '), null);
  assert.equal(familleRisque(null), null);
  assert.equal(familleRisque(undefined), null);
});

test('un libelle de nature inconnue reste indetermine, et n’est pas range par defaut', () => {
  // La tentation serait de compter comme inondation, la famille la plus frequente. Ce serait
  // affirmer une nature de risque sur une supposition, dans un document transmis a un tiers.
  assert.equal(familleRisque('PPR Bordeaux (revision)'), null);
  assert.equal(familleRisque('Vallée de la chimie'), null);
  assert.equal(familleRisque('Plan communal 2019'), null);
});

// ---------------------------------------------------------------------------
// Zones reglementaires
// ---------------------------------------------------------------------------

/** Codes normalises releves sur le service : 01 precaution, 02 prescriptions, 03 interdiction, 04 stricte. */
const zone = (code: string, nom: string) => ({ code, libelle: '', nom, codeZone: nom });

test('la severite retenue est la plus forte des zones du plan', () => {
  // Releve reel a Arles : BLEU (02), PORTUAIRE (03), ROUGE (04).
  const arles = {
    zonageReglementaire: {
      zoneRegExists: true,
      listTypeReg: [zone('02', 'BLEU'), zone('03', 'PORTUAIRE'), zone('04', 'ROUGE')],
    },
  };
  const r = zonesReglementaires(arles);
  assert.equal(r.severiteMax, 'interdiction_stricte');
  assert.deepEqual(r.libelles, ['BLEU', 'PORTUAIRE', 'ROUGE']);
});

test('un plan limite a des prescriptions n’est pas presente comme interdisant', () => {
  // Releve reel : PPRN-RGA Aix-en-Provence, une seule zone BLEU (02).
  const r = zonesReglementaires({
    zonageReglementaire: { zoneRegExists: true, listTypeReg: [zone('02', 'BLEU')] },
  });
  assert.equal(r.severiteMax, 'prescriptions');
});

test('la zone de precaution hors alea est distinguee', () => {
  // Releve reel a Montpellier : « Zone de precaution elargie » (01).
  const r = zonesReglementaires({
    zonageReglementaire: { zoneRegExists: true, listTypeReg: [zone('01', 'Zone de précaution élargie')] },
  });
  assert.equal(r.severiteMax, 'precaution');
});

test('un plan sans zonage expose ne produit pas de severite inventee', () => {
  // Releve reel : PPRN-IF Aix-en-Provence, `zoneRegExists: false`, `listTypeReg: []`.
  assert.equal(zonesReglementaires({ zonageReglementaire: { zoneRegExists: false, listTypeReg: [] } }).severiteMax, null);
  assert.equal(zonesReglementaires({ zonageReglementaire: null }).severiteMax, null);
  assert.equal(zonesReglementaires({}).severiteMax, null);
});

test('un code inconnu ne devient pas une severite', () => {
  // Code 07 « Non Identifie », releve a Nice : ne doit produire aucune severite.
  assert.equal(zonesReglementaires({
    zonageReglementaire: { zoneRegExists: true, listTypeReg: [zone('07', 'NR_NR')] },
  }).severiteMax, null);
});

test('les plans technologiques sont classes par leur PROVENANCE, pas par leur libelle', () => {
  // Defaut rencontre a l'ecriture de la correction, et decouvert par le journal que j'y avais
  // ajoute : en fusionnant `gaspar/pprn` et `gaspar/pprt` avant de classer, on perd le fait que
  // TOUT plan renvoye par `gaspar/pprt` est technologique par construction du point d'entree.
  // Le PPRT de Lyon s'appelle « Vallee de la chimie » et ne porte aucun sigle : il ressortait
  // absent. Aucun test purement unitaire ne peut le voir, d'ou ce controle sur la source.
  const source = readFileSync(new URL('../src/connecteurs/georisques.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /for \(const p of pprt\?\.objets \?\? \[\]\) classer\(p, \['technologique'\]\)/,
    "les plans de gaspar/pprt doivent etre classes technologique sans consulter leur libelle",
  );
  assert.match(
    source,
    /for \(const p of pprn\?\.objets \?\? \[\]\) classer\(p, famillesRisque\(p\.libPpr\)\)/,
    'les plans de gaspar/pprn se classent au libelle, ce point d’entree melangeant les familles',
  );
  // Et le champ lu doit rester `libPpr` : c'est le defaut d'origine. On depouille les
  // commentaires d'abord — ils citent volontairement l'ancien nom pour expliquer la correction,
  // et ma premiere version de cette assertion se declenchait sur sa propre documentation.
  const codeSeul = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(
    !/libelle_risque/.test(codeSeul),
    'libelle_risque n’existe pas dans la reponse du service : le champ est libPpr',
  );
  assert.match(codeSeul, /libPpr/, 'le libelle doit etre lu dans libPpr');
});

// ---------------------------------------------------------------------------
// Plans multirisques
// ---------------------------------------------------------------------------

test('un plan multirisque compte dans CHACUNE de ses familles', () => {
  // Releve reel a Menton : « PER-Multi [ MVT & S ] - Menton 2001 ». Le type n'est pas dans le
  // sigle de tete mais dans une liste entre crochets. La premiere version du classifieur
  // renvoyait une famille unique et laissait donc ce plan indetermine — decouvert par le journal
  // ajoute a la correction, sur une commune reelle.
  assert.deepEqual(famillesRisque('PER-Multi [ MVT & S ] - Menton 2001').sort(), ['mouvement', 'seisme']);
});

test('les jetons nus ne sont interpretes que dans un contexte multirisque', () => {
  // Hors crochets, un « s » isole matcherait n'importe quel mot : la regle doit rester confinee.
  assert.deepEqual(famillesRisque('Plan de secteur s de la ville'), []);
  assert.deepEqual(famillesRisque('PER-Multi [ I ] - ailleurs'), ['inondation']);
  assert.deepEqual(famillesRisque('PPR-Multi [ IF, MVT ] - ailleurs').sort(), ['incendie', 'mouvement']);
});

test('familleRisque ne choisit pas arbitrairement parmi plusieurs familles', () => {
  // Renvoyer « mouvement » pour un plan qui couvre aussi le seisme serait une affirmation
  // partielle presentee comme complete.
  assert.equal(familleRisque('PER-Multi [ MVT & S ] - Menton 2001'), null);
  assert.equal(familleRisque('PPRN-MVT - Nice 2020'), 'mouvement');
});

test('le repli sur les mots entiers n’ecrase pas un sigle deja reconnu', () => {
  // « PPRN-IF - incendie et inondation » : le sigle dit incendie. Le repli ne doit pas s'ajouter
  // et faire croire a un plan inondation.
  assert.deepEqual(famillesRisque('PPRN-IF - massif forestier'), ['incendie']);
});
