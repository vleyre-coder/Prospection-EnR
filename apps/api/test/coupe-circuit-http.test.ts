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
 *   0. ON NE SUPPRIME QUE LA REPETITION, JAMAIS L'ESSAI. Ma premiere version court-circuitait
 *      entierement l'appel, et un test l'a arretee net : une campagne par grande emprise decoupe
 *      le territoire en cellules qui visent TOUTES le meme hote. Une seule cellule ayant epuise
 *      ses reprises aurait condamne toutes les suivantes pendant trente secondes, transformant un
 *      secteur manquant en secteurs manquants par dizaines. Le remede etait pire que le mal, et il
 *      ne se serait vu qu'en production, sur une carte avec des trous.
 *
 *   1. UN HOTE FRAGILE N'A PLUS DROIT QU'A UNE TENTATIVE. Sans quoi la correction n'existe pas.
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
/** Le serveur d'essai repond-il 503 ? Bascule pendant un test pour simuler une panne puis un retour. */
let panneServeur = false;

before(async () => {
  serveur = createServer((req, rep) => {
    requetesRecues += 1;
    if (panneServeur) {
      // 503 : erreur NON definitive, donc reessayable — le cas que le coupe-circuit vise.
      rep.writeHead(503, { 'Content-Type': 'application/json' });
      rep.end('{"erreur":"indisponible"}');
      return;
    }
    if ((req.url ?? '').startsWith('/inconnu')) {
      rep.writeHead(404, { 'Content-Type': 'application/json' });
      rep.end('{"erreur":"inconnu"}');
      return;
    }
    rep.writeHead(200, { 'Content-Type': 'application/json' });
    rep.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  port = (serveur.address() as { port: number }).port;
});

after(async () => {
  await new Promise<void>((resolve) => serveur.close(() => resolve()));
});

test('UN HOTE FRAGILE N’A PLUS DROIT QU’A UNE TENTATIVE, MAIS IL Y A DROIT', async () => {
  /*
   * LE COMPTAGE SE FAIT SUR UN VRAI SERVEUR, parce que c'est la seule facon de prouver combien de
   * requetes sont REELLEMENT parties. Le serveur repond 503 — une erreur non definitive, donc
   * susceptible d'etre reessayee — ce qui est exactement le cas que le coupe-circuit vise.
   */
  reinitialiserCoupeCircuit();
  panneServeur = true;
  const url = `http://127.0.0.1:${port}/instable`;

  requetesRecues = 0;
  await assert.rejects(jsonExterne(url, { connecteur: 'essai', tentatives: 3 }));
  assert.equal(requetesRecues, 3, 'le premier appel paie son budget : c’est lui qui constate');

  // Second appel vers le MEME hote : une seule tentative, et elle part pour de vrai.
  requetesRecues = 0;
  await assert.rejects(jsonExterne(`${url}?autre=1`, { connecteur: 'essai', tentatives: 3 }));
  assert.equal(requetesRecues, 1, 'l’hote fragile garde UNE tentative, et une seule');
});

test('UN HOTE QUI REVIENT EST RETROUVE DES LA REQUETE SUIVANTE', async () => {
  /**
   * LA MOITIE QU'ON OUBLIE. Un coupe-circuit qui ne se referme pas transforme une panne de dix
   * secondes en panne de trente, et personne ne comprend pourquoi le service « marche » sans que
   * l'application le voie. Comme l'hote fragile conserve une tentative, son retour est constate
   * a la premiere requete suivante — sans attendre la fin de la fenetre.
   */
  reinitialiserCoupeCircuit();
  panneServeur = true;
  await assert.rejects(
    jsonExterne(`http://127.0.0.1:${port}/x`, { connecteur: 'essai', tentatives: 2 }),
  );

  panneServeur = false;
  const r = await jsonExterne<{ ok: boolean }>(`http://127.0.0.1:${port}/y`, {
    connecteur: 'essai',
    cacheTtlMs: 0,
  });
  assert.deepEqual(r, { ok: true }, 'le service revenu doit etre vu immediatement');
});

test('UN AUTRE HOTE N’EST PAS EMPORTE PAR LA PANNE DU PREMIER', async () => {
  /*
   * Si le coupe-circuit etait global plutot que par hote, la panne d'une source en eteindrait dix —
   * et une parcelle perdrait tous ses criteres pour la defaillance d'un seul service.
   */
  reinitialiserCoupeCircuit();
  panneServeur = false;
  await assert.rejects(
    jsonExterne(`${HOTE_MORT}/a`, { connecteur: 'essai', tentatives: 1, timeoutMs: 500 }),
  );

  /*
   * L'AUTRE HOTE REPOND NORMALEMENT, et c'est la meilleure preuve : il n'est ni court-circuite ni
   * degrade. Un coupe-circuit global aurait fait echouer cet appel pour une panne qui ne le
   * concerne pas — et une parcelle aurait perdu tous ses criteres pour la defaillance d'un seul
   * service.
   */
  requetesRecues = 0;
  const r = await jsonExterne<{ ok: boolean }>(`http://127.0.0.1:${port}/x`, {
    connecteur: 'essai',
    cacheTtlMs: 0,
  });
  assert.deepEqual(r, { ok: true });
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

  await assert.rejects(jsonExterne(`${url}?autre=1`, { connecteur: 'essai' }));
  assert.equal(requetesRecues, 2, 'le second appel doit avoir atteint le serveur');

  /**
   * ET LA PREUVE QUI COMPTE VRAIMENT : l'hote n'est pas devenu fragile.
   *
   * Les deux comptes ci-dessus valent 1 et 2 que l'hote soit marque ou non — un 404 ne se
   * reessaie pas, donc la degradation ne s'y voit pas. La verification par mutation l'a montre :
   * marquer l'hote fragile sur un 404 ne faisait echouer aucun test.
   *
   * Il faut donc un appel qui, LUI, se reessaierait : le serveur bascule en 503. Si le 404
   * precedent avait rendu l'hote fragile, cet appel n'aurait droit qu'a une tentative au lieu de
   * trois — et tout service repondant une seule fois 404 priverait de reprises tous les appels
   * suivants, sur une simple faute de parametre.
   */
  panneServeur = true;
  requetesRecues = 0;
  await assert.rejects(
    jsonExterne(`http://127.0.0.1:${port}/apres-404`, { connecteur: 'essai', tentatives: 3 }),
  );
  assert.equal(requetesRecues, 3, 'un 404 anterieur ne doit avoir prive personne de ses reprises');
  panneServeur = false;
});
