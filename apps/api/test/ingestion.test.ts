/**
 * Ingestion : l'automate de lecture en flux, et les conversions de champs.
 *
 * POURQUOI CE FICHIER EXISTE. `apps/api/src/ingestion` comptait 865 lignes citees par AUCUN test,
 * releve a l'audit 6 puis a l'audit 7. C'est le code qui ECRIT en base : postes sources, reseau
 * gaz, et 46 000 monuments historiques lus dans un fichier de 220 Mo.
 *
 * La piece la plus exposee est `entitesDepuisMorceaux` : un analyseur JSON incremental ecrit a la
 * main, avec un etat de chaine, d'echappement et de profondeur d'accolades. Un defaut y corrompt
 * des dizaines de milliers d'objets sans rien signaler. Il etait intestable parce que soude a
 * `fetch` ; il en a ete separe pour ce fichier.
 *
 * Les tests decoupent le flux AUX ENDROITS OU UN TEL AUTOMATE CASSE : au milieu d'une chaine,
 * juste apres un antislash d'echappement, entre les deux caracteres d'une accolade fermante et de
 * la virgule suivante, et caractere par caractere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitesDepuisMorceaux } from '../src/ingestion/flux-geojson.js';
import { extraireCoordonnees, nombreOuNull, sousTypeProtection } from '../src/ingestion/index.js';

/** Transforme une chaine en flux de morceaux de taille fixe. */
async function* parTaille(texte: string, taille: number): AsyncGenerator<string> {
  for (let i = 0; i < texte.length; i += taille) yield texte.slice(i, i + taille);
}

/** Transforme une chaine en flux de morceaux aux coupures imposees. */
async function* auxCoupures(texte: string, coupures: number[]): AsyncGenerator<string> {
  let precedent = 0;
  for (const c of [...coupures, texte.length]) {
    yield texte.slice(precedent, c);
    precedent = c;
  }
}

async function collecter(flux: AsyncIterable<string>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of entitesDepuisMorceaux(flux)) out.push(e);
  return out;
}

// Un GeoJSON representatif : accolades imbriquees, chaine contenant des accolades et des
// crochets, guillemet echappe, accent, et une entite sans geometrie.
const DOC = JSON.stringify({
  type: 'FeatureCollection',
  name: 'monuments',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1.75, 48.15] }, properties: { nom: 'Église Saint-Martin', note: 'accolade { et crochet ] dans une chaine' } },
    { type: 'Feature', geometry: null, properties: { nom: 'Maison dite « la Tour »', cite: 'un \\"guillemet\\" echappe' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { nom: 'Enceinte' } },
  ],
});

test('les trois entites sont extraites en un seul morceau', async () => {
  const e = await collecter(parTaille(DOC, DOC.length));
  assert.equal(e.length, 3);
});

test('le decoupage ne change rien, quelle que soit la taille des morceaux', async () => {
  for (const taille of [1, 2, 3, 7, 13, 64, 512]) {
    const e = await collecter(parTaille(DOC, taille));
    assert.equal(e.length, 3, `taille de morceau ${taille}`);
  }
});

test('une coupure au milieu d’une chaine ne perd pas d’entite', async () => {
  // La chaine « accolade { et crochet ] dans une chaine » est le piege : ses accolades et
  // crochets ne doivent JAMAIS etre comptes comme structure.
  const i = DOC.indexOf('accolade {') + 9;
  const e = await collecter(auxCoupures(DOC, [i]));
  assert.equal(e.length, 3);
});

test('une coupure juste apres un antislash d’echappement conserve l’etat', async () => {
  // Cas le plus retors : l'automate doit se souvenir qu'il attend le caractere echappe.
  const i = DOC.indexOf('\\"guillemet') + 1;
  assert.ok(i > 0, 'la fixture doit contenir un guillemet echappe');
  const e = await collecter(auxCoupures(DOC, [i]));
  assert.equal(e.length, 3);
});

test('une coupure entre l’accolade fermante et la virgule suivante ne duplique rien', async () => {
  const i = DOC.indexOf('},{');
  const e = await collecter(auxCoupures(DOC, [i + 1]));
  assert.equal(e.length, 3);
});

test('les accolades dans une chaine ne sont pas comptees comme structure', async () => {
  const e = (await collecter(parTaille(DOC, 5))) as Array<{ properties: { note?: string } }>;
  const avecNote = e.find((x) => x.properties.note != null);
  assert.equal(avecNote?.properties.note, 'accolade { et crochet ] dans une chaine');
});

test('les accents survivent au decoupage, y compris octet par octet', async () => {
  // Un caractere multi-octets coupe en deux entre deux morceaux serait remplace par un caractere
  // de substitution. Le decodage se fait en amont, mais la garde vaut d'etre posee.
  const e = (await collecter(parTaille(DOC, 1))) as Array<{ properties: { nom?: string } }>;
  assert.ok(e.some((x) => x.properties.nom === 'Église Saint-Martin'));
});

test('une entite sans geometrie est rendue, pas ignoree', async () => {
  // L'ingestion des monuments compte les entites sans geometrie : les jeter ici masquerait un
  // probleme de qualite de la source.
  const e = (await collecter(parTaille(DOC, 32))) as Array<{ geometry: unknown }>;
  assert.equal(e.filter((x) => x.geometry === null).length, 1);
});

test('une entite illisible est ignoree sans interrompre le flux', async () => {
  // Tolerance deliberee : une entite corrompue au milieu de 46 000 ne doit pas tout arreter.
  const casse = '{"type":"FeatureCollection","features":[{"a":1},{"b":,},{"c":3}]}';
  const e = await collecter(parTaille(casse, 8));
  assert.equal(e.length, 2, 'les deux entites valides doivent passer');
});

test('un document sans tableau features est signale, et non traite en silence', async () => {
  await assert.rejects(
    () => collecter(parTaille('{"type":"Feature","properties":{}}', 8)),
    /features/,
  );
});

test('un tableau features vide ne rend rien et ne leve pas', async () => {
  const e = await collecter(parTaille('{"type":"FeatureCollection","features":[]}', 4));
  assert.deepEqual(e, []);
});

test('ce qui suit le tableau features est ignore', async () => {
  const doc = '{"features":[{"a":1}],"bbox":[0,0,1,1],"crs":{"type":"name"}}';
  const e = await collecter(parTaille(doc, 3));
  assert.equal(e.length, 1, 'ni le bbox ni le crs ne doivent etre pris pour des entites');
});

// ---------------------------------------------------------------------------
// Conversions de champs
// ---------------------------------------------------------------------------

test('les coordonnees Opendatasoft en tableau sont [lat, lon] et doivent etre inversees', () => {
  // Piege documente dans le code : ce format historique met la latitude d'abord. Ne pas
  // l'inverser place les objets a l'autre bout de la France, ou en mer.
  assert.deepEqual(extraireCoordonnees({ geo_point_2d: [48.15, 1.75] }), [1.75, 48.15]);
});

test('les coordonnees en objet {lon, lat} sont prises telles quelles', () => {
  assert.deepEqual(extraireCoordonnees({ geo_point_2d: { lon: 1.75, lat: 48.15 } }), [1.75, 48.15]);
});

test('les quatre cles de geolocalisation sont acceptees', () => {
  for (const cle of ['geo_point_2d', 'geo_point', 'coordonnees', 'geolocalisation']) {
    assert.deepEqual(extraireCoordonnees({ [cle]: { lon: 3, lat: 44 } }), [3, 44]);
  }
});

test('le repli sur longitude/latitude, lon/lat et x/y fonctionne', () => {
  assert.deepEqual(extraireCoordonnees({ longitude: 1.5, latitude: 47 }), [1.5, 47]);
  assert.deepEqual(extraireCoordonnees({ lon: 1.5, lat: 47 }), [1.5, 47]);
  assert.deepEqual(extraireCoordonnees({ x: 1.5, y: 47 }), [1.5, 47]);
});

test('des coordonnees absentes ou non finies rendent null, jamais 0', () => {
  // Rendre [0, 0] placerait l'objet dans le golfe de Guinee, et un point au large passerait
  // les bornes de vraisemblance sans etre detecte.
  assert.equal(extraireCoordonnees({}), null);
  assert.equal(extraireCoordonnees({ longitude: 'abc', latitude: 'def' }), null);
  assert.equal(extraireCoordonnees({ geo_point_2d: { lon: Infinity, lat: 48 } }), null);
  assert.equal(extraireCoordonnees({ geo_point_2d: [48.15] }), null);
});

test('la virgule decimale francaise est convertie', () => {
  // Les jeux publies en France ecrivent « 1,75 ». `Number('1,75')` vaut NaN.
  assert.equal(nombreOuNull('1,75'), 1.75);
  assert.equal(nombreOuNull('1.75'), 1.75);
  assert.equal(nombreOuNull(1.75), 1.75);
});

test('nombreOuNull distingue zero d’une absence', () => {
  assert.equal(nombreOuNull(0), 0);
  assert.equal(nombreOuNull('0'), 0);
  assert.equal(nombreOuNull(''), null);
  assert.equal(nombreOuNull(null), null);
  assert.equal(nombreOuNull(undefined), null);
  assert.equal(nombreOuNull('abc'), null);
  assert.equal(nombreOuNull(NaN), null);
});

test('le classement d’un monument distingue classement et inscription', () => {
  // La distinction porte : un monument classe impose l'accord de l'architecte des batiments de
  // France sur un perimetre plus large qu'un monument inscrit.
  assert.equal(sousTypeProtection({ typologie_de_la_protection: 'Classé au titre des MH' }), 'classe');
  assert.equal(sousTypeProtection({ typologie_de_la_protection: 'Inscrit au titre des MH' }), 'inscrit');
  assert.equal(sousTypeProtection({ date_et_typologie_de_la_protection: '1990 : inscription' }), 'inscrit');
  // Ni l'un ni l'autre : « protege » est le repli, jamais une invention.
  assert.equal(sousTypeProtection({}), 'protege');
  assert.equal(sousTypeProtection({ typologie_de_la_protection: 'Site patrimonial remarquable' }), 'protege');
});

test('une chaine vide n’est pas zero : c’est une absence', () => {
  // `Number('')` vaut 0, et 0 est fini. Sans garde explicite, un champ vide devenait donc 0.
  // Defaut reel decouvert par ce fichier de test, avec deux consequences mesurees ci-dessous.
  assert.equal(nombreOuNull(''), null);
  assert.equal(nombreOuNull('   '), null);
  assert.equal(nombreOuNull('\t\n'), null);
});

test('une coordonnee vide ne place pas l’objet dans le golfe de Guinee', () => {
  // Consequence la plus grave du piege precedent : `[0, 0]` est une geometrie parfaitement
  // valide, ingeree en base sans rien declencher, sur un jeu de 46 000 monuments. Les bornes de
  // vraisemblance ne l'auraient pas vue : elles couvrent le snapshot, pas les geometries ingerees.
  assert.equal(extraireCoordonnees({ longitude: '', latitude: '' }), null);
  assert.equal(extraireCoordonnees({ longitude: '  ', latitude: '48.15' }), null);
  assert.equal(extraireCoordonnees({ lon: '', lat: '' }), null);
  // Et un zero EXPLICITE reste un zero : le meridien de Greenwich existe.
  assert.deepEqual(extraireCoordonnees({ longitude: 0, latitude: 48.15 }), [0, 48.15]);
  assert.deepEqual(extraireCoordonnees({ longitude: '0', latitude: '48.15' }), [0, 48.15]);
});

test('une capacite d’injection vide reste inconnue, et non nulle', () => {
  // « 0 m3/h » se lit comme « aucune capacite » ; « inconnu » se lit comme ce qu'il est.
  assert.equal(nombreOuNull(''), null);
  assert.equal(nombreOuNull('0'), 0, 'une capacite explicitement nulle reste zero');
});
