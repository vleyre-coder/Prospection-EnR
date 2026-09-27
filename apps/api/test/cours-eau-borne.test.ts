/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE CONNECTEUR DISTINGUE « JE N'AI RIEN VU » DE « JE N'AI PAS PU REGARDER »
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE LA VERIFICATION PAR MUTATION A MONTRE. Le garde des seuils de recherche couvrait bien la
 * lecture de la borne, mais il sème les instantanés directement en base : il ne fait jamais tourner
 * le connecteur. Remettre `auDelaDeM: null` dans `distanceCoursEau` ne faisait donc échouer aucun
 * test — la correction tenait à une ligne que rien ne gardait.
 *
 * ═══ CE QUI EST MESURÉ ICI
 *
 * La BD TOPO répond, et ne rend aucun cours d'eau dans le rayon interrogé. C'est le cas de **299
 * parcelles sur 301** dans la base du 28/09/2026 — la Beauce est un plateau de craie. Le connecteur
 * doit alors rendre le RAYON, pas `null` : la requête a abouti et la couche est nationalement
 * complète, donc la distance dépasse ce rayon. C'est une mesure.
 *
 * Et symétriquement : quand la requête échoue, il ne doit rendre AUCUNE borne. Confondre les deux
 * transformerait une panne de réseau en constat de terrain, ce qui est la faute que tout ce dépôt
 * s'emploie à empêcher.
 *
 * ═══ AUCUN RÉSEAU N'EST NÉCESSAIRE
 *
 * `globalThis.fetch` est remplacé le temps du test. C'est ce qui permet de choisir exactement la
 * réponse du service — impossible autrement — et de compter les appels réellement partis.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { distanceCoursEau } from '../src/connecteurs/wfs.js';
import { reinitialiserCoupeCircuit, viderCacheHttp } from '../src/http.js';
import type { GeoJsonGeometry } from '../src/geo.js';

/** Parcelle fictive, en pleine mer : aucune donnée réelle n'entre dans la mesure. */
const PARCELLE: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-6.5, 47.0],
      [-6.496, 47.0],
      [-6.496, 47.004],
      [-6.5, 47.004],
      [-6.5, 47.0],
    ],
  ],
};

const fetchOriginal = globalThis.fetch;

/** Remplace le réseau par une réponse choisie, et compte les appels partis. */
function poserReponse(corps: unknown, statut = 200): { appels: () => number } {
  let appels = 0;
  globalThis.fetch = (async () => {
    appels += 1;
    return new Response(JSON.stringify(corps), {
      status: statut,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { appels: () => appels };
}

beforeEach(() => {
  reinitialiserCoupeCircuit();
  /**
   * LE CACHE HTTP DOIT ETRE VIDE ENTRE DEUX CAS, et l'oublier m'a coute une fausse alerte.
   *
   * Les trois cas interrogent la MEME parcelle fictive, donc la meme URL. Sans ce nettoyage, la
   * reponse vide du premier cas etait resservie aux deux suivants : le cas « la requete echoue »
   * recevait une collection vide mise en cache et concluait a une borne. J'ai cru un instant que le
   * produit fabriquait une absence constatee a partir d'une panne — c'etait le test qui se
   * repondait a lui-meme.
   */
  viderCacheHttp();
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

test('AUCUN COURS D’EAU DANS LE RAYON : LE CONNECTEUR REND LA BORNE, PAS NULL', async () => {
  const compteur = poserReponse({ type: 'FeatureCollection', features: [], numberMatched: 0 });

  const r = await distanceCoursEau(PARCELLE);

  assert.ok(compteur.appels() > 0, 'le service doit avoir été réellement interrogé');
  assert.equal(r.distanceM, null, 'aucune distance n’a été mesurée, et il ne faut pas en inventer');
  /*
   * 1 000 m est le premier rayon interrogé par `distanceCoursEau`. La réponse n'étant pas tronquée,
   * elle est exhaustive sur ce rayon : la distance réelle le dépasse.
   */
  assert.equal(r.auDelaDeM, 1000, 'la borne doit être le rayon réellement couvert');
});

test('LA REQUETE EN ECHEC NE REND AUCUNE BORNE', async () => {
  /**
   * LE GARDE-FOU QUI COMPTE LE PLUS DANS CE FICHIER. Si une panne produisait une borne, une source
   * injoignable se lirait « aucun cours d'eau à moins d'un kilomètre » — une absence CONSTATÉE
   * fabriquée à partir de rien, sur le critère qui porte le recul réglementaire de 35 m.
   */
  poserReponse({ erreur: 'indisponible' }, 503);

  const r = await distanceCoursEau(PARCELLE);
  assert.deepEqual(
    r,
    { distanceM: null, auDelaDeM: null },
    'une panne doit rester une panne : ni distance, ni borne',
  );
});

test('UN COURS D’EAU TROUVE REND UNE DISTANCE, ET AUCUNE BORNE', async () => {
  /*
   * Les deux champs sont exclusifs. Les renseigner ensemble laisserait l'appelant choisir, et deux
   * lecteurs choisiraient différemment — la fiche et le filtre finiraient par ne plus dire la même
   * chose de la même parcelle.
   */
  poserReponse({
    type: 'FeatureCollection',
    numberMatched: 1,
    features: [
      {
        type: 'Feature',
        properties: { cleabs: 'essai' },
        // Un segment proche de la parcelle fictive, à l'est.
        geometry: { type: 'LineString', coordinates: [[-6.494, 47.0], [-6.494, 47.004]] },
      },
    ],
  });

  const r = await distanceCoursEau(PARCELLE);
  assert.notEqual(r.distanceM, null, 'une géométrie trouvée doit donner une distance');
  assert.equal(r.auDelaDeM, null, 'une distance mesurée exclut toute borne');
  assert.ok((r.distanceM ?? 0) > 0 && (r.distanceM ?? 0) < 1000);
});

test('UNE REPONSE TRONQUEE A TOUS LES RAYONS NE REND AUCUNE BORNE', async () => {
  /**
   * LE CAS QUE LA VERIFICATION PAR MUTATION A REVELE, et qui n'est pas celui qu'on imagine.
   *
   * Une requête en ÉCHEC lève une exception et n'atteint jamais le code des bornes. Le chemin qui
   * l'atteint est celui-ci : le service répond, mais **tronque sa réponse à tous les rayons**. Le
   * WFS le fait silencieusement sur les emprises denses — 15 000 objets annoncés, 3 000 rendus,
   * choisis dans un ordre non documenté.
   *
   * Rien n'est alors exhaustif : ni la distance, ni une borne. Conclure « aucun cours d'eau à moins
   * d'un kilomètre » parce qu'on n'a vu qu'un échantillon reviendrait à fabriquer une absence
   * constatée à partir d'une réponse incomplète — et ce serait pire ici qu'ailleurs, puisque la
   * troncature frappe précisément les secteurs DENSES, donc les plus susceptibles de porter un
   * cours d'eau.
   */
  poserReponse({
    type: 'FeatureCollection',
    // Le service annonce plus d'objets qu'il n'en rend : la réponse est tronquée, à tous les rayons.
    numberMatched: 9999,
    numberReturned: 1,
    features: [
      {
        type: 'Feature',
        properties: { cleabs: 'essai' },
        geometry: { type: 'LineString', coordinates: [[-6.3, 47.0], [-6.3, 47.004]] },
      },
    ],
  });

  const r = await distanceCoursEau(PARCELLE);
  assert.deepEqual(
    r,
    { distanceM: null, auDelaDeM: null },
    'une réponse tronquée ne démontre rien : ni distance, ni borne',
  );
});
