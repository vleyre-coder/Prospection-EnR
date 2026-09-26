/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE COUPE-CIRCUIT PAR HOTE — ce qu'il economise, et ce qu'il ne doit jamais masquer
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, le 26/09/2026, sur une qualification reelle pendant que
 * `georisques.gouv.fr` etait injoignable depuis ce poste : **140 secondes pour une parcelle**, six
 * points d'entree en echec. Le mecanisme n'a rien de mysterieux — les connecteurs partent en
 * parallele, mais la limitation de concurrence SERIALISE les appels vers un meme hote, et chacun
 * consommait alors son budget complet de reprises. Six fois le meme mur.
 *
 * Apres correction, sur les parcelles suivantes du meme lot : **11 s, puis 8,7 s**. La premiere
 * paie encore le budget — c'est elle qui decouvre la panne — les suivantes non.
 *
 * CE QUE CELA CHANGE POUR L'EXPLOITANT : apres une ingestion, il faut reprendre les parcelles pour
 * qu'elles voient la nouvelle donnee. A 140 secondes piece, 300 parcelles demandent douze heures,
 * c'est-a-dire qu'on ne les reprend pas. La lenteur d'un service tiers devenait une impossibilite
 * d'exploiter la sienne.
 *
 * ═══ CE QUE CE FICHIER GARDE, ET POURQUOI CHAQUE MOITIE COMPTE
 *
 *   1. UN HOTE TOMBE EST COURT-CIRCUITE. Sans quoi la correction n'existe pas.
 *
 *   2. UN 4xx NE COUPE RIEN. Une erreur definitive dit que CETTE requete est mauvaise, pas que le
 *      service est tombe. Couper l'hote sur un 404 ferait passer pour injoignable un service qui
 *      repond parfaitement — et griserait des criteres entiers sur une faute de parametre.
 *
 *   3. UN AUTRE HOTE N'EST PAS AFFECTE. Le coupe-circuit est par hote ; s'il etait global, la
 *      panne d'une source en eteindrait dix.
 *
 * ═══ AUCUN RESEAU N'EST NECESSAIRE
 *
 * L'hote tombe est un port ferme sur la boucle locale — refus de connexion immediat, deterministe,
 * et qui ne depend d'aucun service tiers. L'hote qui repond 4xx est un serveur HTTP minimal monte
 * pour le test, ce qui permet en prime de COMPTER ses requetes : c'est la seule facon de prouver
 * que le second appel l'a bien atteint au lieu d'etre court-circuite.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { jsonExterne, reinitialiserCoupeCircuit } from '../src/http.js';

/** Un port ferme sur la boucle locale : toute connexion y est refusee sur-le-champ. */
const HOTE_MORT = 'http://127.0.0.1:1';

let serveur: Server;
let port = 0;
let requetesRecues = 0;

before(async () => {
  serveur = createServer((_req, rep) => {
    requetesRecues += 1;
    rep.writeHead(404, { 'Content-Type': 'application/json' });
    rep.end('{"erreur":"inconnu"}');
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  port = (serveur.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

test('UN HOTE TOMBE EST COURT-CIRCUITE DES LE DEUXIEME APPEL', async () => {
  reinitialiserCoupeCircuit();

  // Premier appel : il paie le budget de reprises, et c'est normal — c'est lui qui constate.
  await assert.rejects(
    jsonExterne(`${HOTE_MORT}/a`, { connecteur: 'essai', tentatives: 2, timeoutMs: 500 }),
    (err: Error) => {
      assert.doesNotMatch(err.message, /court-circuite/, 'le premier appel constate, il ne court-circuite pas');
      return true;
    },
  );

  /*
   * Second appel vers le MEME hote : il doit echouer en nommant le court-circuit. On verifie le
   * MESSAGE et non une duree — un test qui mesure un temps sur une machine dont il ne sait rien
   * echoue un jour sur dix pour une raison etrangere a ce qu'il verifie.
   */
  await assert.rejects(jsonExterne(`${HOTE_MORT}/b`, { connecteur: 'essai' }), (err: Error) => {
    assert.match(err.message, /court-circuite/);
    assert.match(err.message, /127\.0\.0\.1:1/, 'le message doit nommer l’hote en cause');
    return true;
  });
});

test('UN AUTRE HOTE N’EST PAS EMPORTE PAR LA PANNE DU PREMIER', async () => {
  /*
   * Si le coupe-circuit etait global plutot que par hote, la panne d'une source en eteindrait dix —
   * et une parcelle perdrait tous ses criteres pour la defaillance d'un seul service.
   */
  reinitialiserCoupeCircuit();
  await assert.rejects(
    jsonExterne(`${HOTE_MORT}/a`, { connecteur: 'essai', tentatives: 1, timeoutMs: 500 }),
  );

  requetesRecues = 0;
  await assert.rejects(
    jsonExterne(`http://127.0.0.1:${port}/x`, { connecteur: 'essai', tentatives: 1 }),
  );
  assert.equal(requetesRecues, 1, 'l’autre hote doit avoir ete reellement interroge');
});

test('UN 4xx NE COUPE PAS L’HOTE : LA REQUETE EST MAUVAISE, PAS LE SERVICE', async () => {
  /**
   * LE GARDE-FOU LE PLUS IMPORTANT DE CE FICHIER. Une erreur definitive signale un probleme de
   * REQUETE — un identifiant inconnu, un parametre hors domaine. Le service, lui, repond
   * parfaitement. Couper l'hote dessus reviendrait a griser tous les criteres qui en dependent
   * parce qu'une seule parcelle a pose une mauvaise question.
   *
   * On le prouve en COMPTANT les requetes recues : si l'hote avait ete coupe, le second appel
   * n'atteindrait jamais le serveur.
   */
  reinitialiserCoupeCircuit();
  const url = `http://127.0.0.1:${port}/inconnu`;

  requetesRecues = 0;
  await assert.rejects(jsonExterne(url, { connecteur: 'essai' }));
  const apresPremier = requetesRecues;
  assert.equal(apresPremier, 1, 'un 4xx ne se reessaie pas : une seule requete');

  await assert.rejects(jsonExterne(`${url}?autre=1`, { connecteur: 'essai' }), (err: Error) => {
    assert.doesNotMatch(err.message, /court-circuite/, 'un 404 ne doit pas couper l’hote');
    return true;
  });
  assert.equal(requetesRecues, 2, 'le second appel doit avoir atteint le serveur');
});
