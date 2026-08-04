/**
 * Tests de la file de qualification.
 *
 * POURQUOI. Une seule campagne peut s'executer a la fois — les sources publiques plafonnent a
 * une requete par seconde, deux campagnes simultanees seraient chacune plus lente que l'une
 * seule. Mais la seconde demande etait REFUSEE par un 409, obligeant l'utilisateur a revenir
 * a l'aveugle. Elle est desormais mise en file. Ce qui doit etre garanti :
 *   - une demande n'est jamais perdue ;
 *   - la file avance, y compris apres une campagne qui echoue ;
 *   - aucune campagne ne demarre en double.
 *
 * Les campagnes reelles interrogent des services externes : ces tests portent sur la MACHINE
 * A ETAT, avec un executeur injecte. C'est elle qui contient la logique risquee — le corps de
 * la campagne, lui, est deja exerce par la qualification unitaire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Reimplementation de la file, a l'identique de `services/qualification.ts`.
 *
 * Ce doublon est un pis-aller assume : la file y est couplee au travail reel (acces base,
 * appels HTTP) et n'est pas injectable en l'etat. Le test verifie donc l'ALGORITHME. Un
 * troisieme test, plus bas, lit le source pour verifier que les invariants structurels y sont
 * bien presents — c'est ce qui empeche le doublon de deriver silencieusement.
 */
const FILE_MAX = 5;

function creerFile(executer: (id: string, fini: () => void) => void) {
  const file: string[] = [];
  let enCours = false;
  let compteur = 0;
  const demarrees: string[] = [];

  function suivante(): void {
    if (enCours) return;
    const id = file.shift();
    if (id == null) return;
    enCours = true;
    demarrees.push(id);
    executer(id, () => {
      enCours = false;
      suivante();
    });
  }

  return {
    demarrees,
    get enCours() {
      return enCours;
    },
    get attente() {
      return [...file];
    },
    demander(): { accepte: boolean; id?: string; position?: number } {
      if (file.length >= FILE_MAX) return { accepte: false };
      compteur += 1;
      const id = `q${compteur}`;
      file.push(id);
      suivante();
      const rang = file.indexOf(id);
      return { accepte: true, id, position: rang === -1 ? 0 : rang + 1 };
    },
  };
}

test('la premiere demande demarre immediatement, en position 0', () => {
  const f = creerFile(() => undefined);
  const r = f.demander();
  assert.equal(r.accepte, true);
  assert.equal(r.position, 0, 'position 0 signifie « demarree », pas « en attente »');
  assert.equal(f.enCours, true);
  assert.deepEqual(f.demarrees, ['q1']);
});

test('la seconde demande est acceptee et mise en file, non refusee', () => {
  const f = creerFile(() => undefined);
  f.demander();
  const r = f.demander();
  assert.equal(r.accepte, true, "c'est le point de la correction : plus de refus");
  assert.equal(r.position, 1, 'prochaine a demarrer');
  assert.deepEqual(f.demarrees, ['q1'], 'mais elle ne demarre pas tant que la premiere tourne');
});

test('les positions refletent le rang reel dans la file', () => {
  const f = creerFile(() => undefined);
  f.demander();
  assert.equal(f.demander().position, 1);
  assert.equal(f.demander().position, 2);
  assert.equal(f.demander().position, 3);
});

test('la file avance dans l’ordre a la fin de chaque campagne', () => {
  const fins: Array<() => void> = [];
  const f = creerFile((_id, fini) => fins.push(fini));
  for (let i = 0; i < 4; i += 1) f.demander();

  assert.deepEqual(f.demarrees, ['q1']);
  fins.shift()!();
  assert.deepEqual(f.demarrees, ['q1', 'q2']);
  fins.shift()!();
  fins.shift()!();
  assert.deepEqual(f.demarrees, ['q1', 'q2', 'q3', 'q4'], 'FIFO strict');
});

test('une campagne qui echoue ne bloque pas la file derriere elle', () => {
  // C'est la raison pour laquelle l'enchainement est dans un `finally` : une erreur au milieu
  // d'une campagne laissait sinon toutes les demandes suivantes en attente indefinie.
  const f = creerFile((id, fini) => {
    try {
      if (id === 'q1') throw new Error('campagne interrompue');
    } finally {
      fini();
    }
  });
  assert.throws(() => f.demander(), /interrompue/);
  f.demander();
  assert.deepEqual(f.demarrees, ['q1', 'q2'], 'q2 doit avoir demarre malgre l’echec de q1');
});

test('aucune campagne ne demarre en double', () => {
  const f = creerFile(() => undefined);
  f.demander();
  // Cinq demandes de plus, chacune declenchant une tentative de demarrage.
  for (let i = 0; i < 4; i += 1) f.demander();
  assert.equal(f.demarrees.length, 1, 'une seule campagne occupe le debit');
});

test('la file est bornee, et le refus au-dela est explicite', () => {
  const f = creerFile(() => undefined);
  f.demander(); // demarre
  for (let i = 0; i < FILE_MAX; i += 1) {
    assert.equal(f.demander().accepte, true, `demande ${i + 1} dans la file`);
  }
  assert.equal(f.demander().accepte, false, 'au-dela, refus plutot qu’accumulation');
  assert.equal(f.attente.length, FILE_MAX);
});

// ---------------------------------------------------------------------------
// Garde structurelle sur le service reel
// ---------------------------------------------------------------------------

test('le service reel porte bien les invariants testes ci-dessus', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('../src/services/qualification.ts', import.meta.url)),
    'utf8',
  );

  // 1. La file existe et est bornee.
  assert.match(source, /const FILE_MAX = \d+;/);
  assert.match(source, /file\.length >= FILE_MAX/, 'la borne doit etre appliquee');

  // 2. Un seul point fait avancer la file, ce qui interdit le double demarrage.
  assert.match(source, /function demarrerSuivanteSiLibre/);
  assert.match(source, /if \(etat\.enCours\) return;/, 'garde contre le demarrage en double');

  // 3. L'enchainement est dans le `finally` : une campagne en echec ne bloque pas la suite.
  const finallyBloc = /finally \{[\s\S]*?demarrerSuivanteSiLibre\(\);[\s\S]*?\}/.test(source);
  assert.ok(finallyBloc, "l'enchainement doit etre dans le finally, pas apres le try");

  // 4. Plus de retour `null` qui obligeait l'appelant a fabriquer un 409.
  assert.ok(
    !/lancerQualificationEmprise[\s\S]{0,400}: EtatQualification \| null/.test(source),
    'la fonction ne doit plus pouvoir refuser par un null',
  );
});

// ---------------------------------------------------------------------------
// Durabilite de la file
// ---------------------------------------------------------------------------

/**
 * Correction du quatrieme audit. Mesure : trois demandes acceptees et en attente avant l'arret du
 * serveur, ZERO apres le redemarrage — aucune trace en base, aucune ligne de journal, aucun
 * message. Trois utilisateurs a qui l'API avait repondu 202 « votre demande demarrera seule »
 * attendaient indefiniment.
 *
 * Le paradoxe etait net : la campagne EN COURS etait tracee et marquee interrompue au demarrage
 * suivant, mais les demandes ACCEPTEES ne l'etaient nulle part.
 */
test('la file est persistee et restauree au demarrage', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const lire = (p: string): string =>
    readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

  const migration = lire('../../../db/migrations/012_file_qualification.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS demande_qualification/);
  assert.match(migration, /demarree_le/, 'il faut distinguer une demande en attente d’une demarree');
  assert.match(migration, /abandonnee_le/, "un abandon doit etre explicite et motive");

  const service = lire('../src/services/qualification.ts');
  assert.match(service, /INSERT INTO demande_qualification/, 'la mise en file doit ecrire en base');
  assert.match(service, /export async function restaurerFile/);
  assert.match(
    service,
    /UPDATE demande_qualification SET demarree_le = now\(\)/,
    'une demande devenue campagne doit etre marquee, sinon elle repartirait au redemarrage',
  );

  const serveur = lire('../src/serveur.ts');
  assert.match(serveur, /restaurerFile\(\)/, 'le demarrage doit recharger la file');
  // L'ordre compte : cloturer la campagne interrompue AVANT de relancer la file, sinon
  // `restaurerFile` demarrerait une demande alors que l'etat porte encore une campagne ouverte.
  assert.ok(
    serveur.indexOf('signalerCampagnesInterrompues()') < serveur.indexOf('restaurerFile()'),
    'signalerCampagnesInterrompues doit preceder restaurerFile',
  );
});

test('le demarrage d’une demande reste synchrone, pour interdire le double depart', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const service = readFileSync(
    fileURLToPath(new URL('../src/services/qualification.ts', import.meta.url)),
    'utf8',
  );
  // La persistance a introduit de l'asynchrone dans ce chemin. `demarrerSuivanteSiLibre` doit
  // rester synchrone de bout en bout : un `await` entre la garde `etat.enCours` et sa pose
  // laisserait deux appels concurrents demarrer deux campagnes, ce que le quota partage interdit.
  const debut = service.indexOf('function demarrerSuivanteSiLibre');
  // Commentaires retires avant l'analyse : ils PARLENT de `await` pour expliquer son absence, et
  // les compter reviendrait a punir la documentation du choix.
  const corps = service
    .slice(debut, service.indexOf('\n}', debut))
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\bawait\b/.test(corps), 'aucun await dans demarrerSuivanteSiLibre');
  assert.match(corps, /void marquerDemarree/, 'le marquage doit etre lance sans etre attendu');
});
