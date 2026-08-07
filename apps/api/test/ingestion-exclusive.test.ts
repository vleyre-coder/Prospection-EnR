/**
 * Une ingestion nationale ne doit pas se lancer en parallèle d'elle-même.
 *
 * POURQUOI CE FICHIER EXISTE — audit 10, défaut B3. `lancerIngestion` est appelée depuis trois
 * endroits : la route d'administration `POST /api/admin/ingestions/:connecteur`, le script
 * `npm run ingest`, et l'amorçage au démarrage. Aucun des trois ne s'excluait des deux autres, et la
 * route n'avait ni verrou ni limitation de débit — alors qu'elle déclenche le traitement le plus
 * lourd du projet : l'ingestion des ZAER lit 1,09 million d'objets sur le WFS de la Géoplateforme, en
 * une vingtaine de minutes. Deux appels rapprochés faisaient donc deux fois le même téléchargement,
 * sur un quota partagé par toute l'équipe, et le second n'apportait rien.
 *
 * Ce qui rend le défaut instructif : la protection existait déjà, au bon endroit, et n'avait jamais
 * été étendue. L'amorçage prend un verrou consultatif avec cette justification exacte — « en
 * développement, `tsx watch` relance le serveur à chaque sauvegarde. Sans ce verrou, une modification
 * de code pendant l'ingestion des communes en déclencherait une seconde en parallèle. » Le
 * déclenchement manuel, lui, n'en avait aucun.
 *
 * CE QUE CES TESTS VÉRIFIENT contre PostgreSQL : le verrou est réellement pris, il est réellement
 * relâché même quand le job échoue, et deux connecteurs différents ne se bloquent pas l'un l'autre.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete, tenterVerrou } from '../src/bdd.js';
import {
  avecVerrouIngestion,
  cleVerrouIngestion,
  ErreurIngestionEnCours,
  lancerIngestion,
} from '../src/ingestion/index.js';

let baseDisponible = false;

/**
 * Noms de connecteurs PROPRES A CETTE EXECUTION, pour les cas qui n'ont pas besoin d'un vrai job.
 *
 * Observé en enchaînant deux vérifications par mutation : un verrou consultatif n'est rendu qu'à la
 * FERMETURE de sa connexion, et un processus qui vient de finir peut mettre un instant à être
 * récolté par PostgreSQL. Une exécution qui reprend aussitôt les mêmes noms trouvait donc le verrou
 * encore pris et échouait — pour une raison étrangère à ce qu'elle teste. Un identifiant unique par
 * processus supprime toute interférence entre exécutions successives.
 */
const propre = (nom: string): string => `${nom}-test-${process.pid}`;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}.`,
      { cause: err },
    );
  }
  baseDisponible = true;
});

after(async () => {
  /**
   * UN TEST QUI ECHOUE DOIT RENDRE LA MAIN — et ma première tentative ne le garantissait pas.
   *
   * Un verrou consultatif non relâché garde sa connexion SORTIE du pool : `pool.end()` l'attend
   * alors indéfiniment. Or c'est exactement l'état que produit la mutation « le verrou n'est plus
   * relâché » — celle que ce fichier doit attraper. Mesuré la première fois : 110 s de blocage
   * jusqu'au délai de garde.
   *
   * J'avais borné l'ATTENTE par un `Promise.race` de 3 s. Insuffisant, et la vérification par
   * mutation l'a prouvé en se figeant seize minutes sur cette mutation-là : borner l'attente rend la
   * main à `after()`, mais la socket de la connexion restée sortie tient la boucle d'événements
   * ouverte, et le processus ne SORT jamais. `execFileSync` bloquait donc pour toujours. Le test
   * signalait correctement la régression — personne ne pouvait le lire.
   *
   * La correction ne borne plus une durée, elle DIAGNOSTIQUE l'état : `totalCount - idleCount` est le
   * nombre de connexions hors du pool, et une connexion hors du pool à la fin du fichier ne peut
   * venir que d'un verrou non rendu. Aucun seuil de temps, donc aucune fragilité sur une machine
   * lente : sur une exécution saine ce compte vaut zéro et la fermeture est attendue normalement.
   * Quand il ne vaut pas zéro, l'état EST le défaut — on le nomme et on sort en échec.
   */
  const sorties = pool.totalCount - pool.idleCount;
  if (sorties > 0) {
    process.stderr.write(
      `# ${sorties} connexion(s) hors du pool a la fin du fichier : un verrou consultatif n'a pas ete\n` +
        `# relache. pool.end() attendrait indefiniment, et le processus ne sortirait jamais. Sortie forcee.\n`,
    );
    // Fermeture au mieux, puis sortie en echec : le verdict est deja l'echec, et il doit etre lisible.
    await Promise.race([
      pool.end().catch(() => undefined),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
    process.exit(1);
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test d’exclusion ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('la cle de verrou est stable, propre au connecteur, et hors des plages reservees', () => {
  // Stable : deux appels donnent la meme cle, sinon le verrou ne protegerait rien.
  assert.equal(cleVerrouIngestion('zaer_local'), cleVerrouIngestion('zaer_local'));
  // Distincte : ingerer les communes ne doit pas bloquer les ZAER.
  assert.notEqual(cleVerrouIngestion('zaer_local'), cleVerrouIngestion('communes'));
  // Hors des verrous nommes du demarrage : 864 202 (amorcage) et 864 203 (rescoring).
  for (const c of ['zaer_local', 'communes', 'patrimoine_sites', 'postes_sources', 'reseau_gaz']) {
    const cle = cleVerrouIngestion(c);
    assert.ok(cle > 865_000_000, `${c} : la cle ${cle} sort de la plage reservee aux ingestions`);
    assert.notEqual(cle, 864_202);
    assert.notEqual(cle, 864_203);
  }
});

test('un connecteur inconnu est refuse AVANT de prendre le verrou', async () => {
  if (ignorer()) return;
  // Ordre important : prendre un verrou pour un nom qui n'existe pas le laisserait pris jusqu'a la
  // fin du processus, puisque rien ne le relacherait.
  await assert.rejects(() => lancerIngestion('connecteur_qui_nexiste_pas'), /Aucun job d'ingestion/);
  // La preuve que le verrou n'a pas ete pris : on peut le prendre maintenant.
  const liberer = await tenterVerrou(cleVerrouIngestion('connecteur_qui_nexiste_pas'));
  assert.ok(liberer, 'le verrou d’un connecteur inconnu ne doit pas avoir ete pris');
  await liberer();
});

test('LE CAS MESURE : une seconde ingestion du meme connecteur est refusee immediatement', async () => {
  if (ignorer()) return;
  // Le verrou est pris « de l'exterieur » pour simuler une premiere ingestion en cours, sans avoir a
  // lancer un telechargement de vingt minutes.
  const premier = await tenterVerrou(cleVerrouIngestion('communes'));
  assert.ok(premier, 'le verrou doit etre libre au depart');
  try {
    const debut = Date.now();
    await assert.rejects(() => lancerIngestion('communes'), ErreurIngestionEnCours);
    // Non bloquant : le refus est immediat, il n'attend pas la fin de la premiere.
    assert.ok(Date.now() - debut < 2000, 'le refus doit etre immediat, pas une attente');
  } finally {
    await premier!();
  }
});

test('deux connecteurs differents ne se bloquent pas', async () => {
  if (ignorer()) return;
  const a = await tenterVerrou(cleVerrouIngestion(propre('communes')));
  assert.ok(a);
  const b = await tenterVerrou(cleVerrouIngestion(propre('zaer_local')));
  assert.ok(b, 'un connecteur ne doit pas bloquer un autre');
  await a!();
  await b!();
});

test('LE POINT LE PLUS RISQUE : le verrou est relache meme si le travail leve', async () => {
  if (ignorer()) return;
  /**
   * Un verrou consultatif est tenu par une connexion dediee : sans `finally`, un job qui leve une
   * exception laisse le connecteur bloque jusqu'au redemarrage du serveur. La correction serait alors
   * PIRE que le defaut qu'elle repare, puisqu'elle empecherait toute ingestion ulterieure.
   *
   * Ma premiere version de ce test lancait un vrai job pour le verifier : plus de trois minutes, le
   * temps que le profil de reprise « patient » epuise ses tentatives reseau. D'ou l'extraction de
   * `avecVerrouIngestion`, qui expose exactement le meme chemin de code sans reseau.
   */
  const boum = new Error('echec simule du job');
  const nom = propre('communes');
  await assert.rejects(
    () => avecVerrouIngestion(nom, async () => { throw boum; }),
    (e: unknown) => e === boum,
  );
  const liberer = await tenterVerrou(cleVerrouIngestion(nom));
  assert.ok(liberer, 'le verrou doit avoir ete relache malgre l’exception');
  await liberer();
});

test('le travail ne s’execute pas du tout si le verrou est deja pris', async () => {
  if (ignorer()) return;
  const nom = propre('patrimoine_sites');
  const premier = await tenterVerrou(cleVerrouIngestion(nom));
  assert.ok(premier);
  let execute = false;
  try {
    await assert.rejects(
      () => avecVerrouIngestion(nom, async () => { execute = true; return 1; }),
      ErreurIngestionEnCours,
    );
  } finally {
    await premier!();
  }
  assert.equal(execute, false, 'le travail ne doit pas avoir commence : c’est tout l’objet du verrou');
});
