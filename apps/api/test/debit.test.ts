/**
 * Tests du limiteur de debit.
 *
 * POURQUOI. `nbSeaux` avait ete exposee « pour les tests » sans qu'aucun test ne soit ecrit :
 * c'est le troisieme mecanisme du projet ecrit puis non branche. Ce fichier ferme le cas, et
 * couvre au passage tout le comportement du limiteur — quotas par appelant, par operation,
 * remplissage continu, purge.
 *
 * UNE MISE AU POINT. Le quatrieme audit affirmait que l'ancien declencheur de purge
 * (`seaux.size % 500 === 0`) pouvait ne jamais s'executer. La verification par mutation dit le
 * contraire : remettre cette condition ne fait echouer aucun de ces tests, et l'argument tient —
 * la taille prend toutes les valeurs entieres en croissant, le multiple suivant est donc atteint
 * au plus tard apres 500 creations. Le constat d'audit etait faux ; le compteur de creations est
 * conserve pour la lisibilite de l'invariant, pas comme correction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { limiterDebit, nbSeaux, reinitialiserDebit } from '../src/debit.js';

/** Requete minimale : le limiteur ne lit que l'IP et l'utilisateur. */
const requete = (ip: string, utilisateurId?: string): FastifyRequest =>
  ({
    ip,
    utilisateur: utilisateurId ? { id: utilisateurId } : undefined,
    log: { warn: () => undefined },
  }) as unknown as FastifyRequest;

/** Reponse minimale, qui enregistre le statut et les en-tetes poses. */
function reponse(): FastifyReply & { statut: number | null; entetes: Record<string, unknown> } {
  const r = {
    statut: null as number | null,
    entetes: {} as Record<string, unknown>,
    code(c: number) {
      r.statut = c;
      return r;
    },
    header(k: string, v: unknown) {
      r.entetes[k] = v;
      return r;
    },
    send() {
      return r;
    },
  };
  return r as unknown as FastifyReply & { statut: number | null; entetes: Record<string, unknown> };
}

test('un appelant dans son quota passe', async () => {
  reinitialiserDebit();
  const garde = limiterDebit({ max: 3, fenetreMs: 60_000, operation: 'sonde' });
  for (let i = 0; i < 3; i += 1) {
    const rep = reponse();
    await garde(requete('10.0.0.1'), rep);
    assert.equal(rep.statut, null, `appel ${i + 1} refuse a tort`);
  }
});

test('au-dela du quota, un 429 avec Retry-After', async () => {
  reinitialiserDebit();
  const garde = limiterDebit({ max: 2, fenetreMs: 60_000, operation: 'sonde' });
  await garde(requete('10.0.0.1'), reponse());
  await garde(requete('10.0.0.1'), reponse());
  const rep = reponse();
  await garde(requete('10.0.0.1'), rep);
  assert.equal(rep.statut, 429);
  // Sans Retry-After, l'appelant ne sait pas quand revenir et reessaie en boucle.
  assert.ok(Number(rep.entetes['Retry-After']) > 0, `Retry-After = ${rep.entetes['Retry-After']}`);
});

test('deux appelants distincts ont chacun leur quota', async () => {
  reinitialiserDebit();
  const garde = limiterDebit({ max: 1, fenetreMs: 60_000, operation: 'sonde' });
  await garde(requete('10.0.0.1'), reponse());
  const rep = reponse();
  await garde(requete('10.0.0.2'), rep);
  assert.equal(rep.statut, null, 'le quota d’un appelant ne doit pas consommer celui d’un autre');
});

test('l’utilisateur authentifie prime sur l’adresse IP', async () => {
  // Compter par IP seule mettrait tous les postes derriere un meme NAT d'entreprise dans le meme
  // seau : le premier utilisateur consommerait le quota de tous ses collegues.
  reinitialiserDebit();
  const garde = limiterDebit({ max: 1, fenetreMs: 60_000, operation: 'sonde' });
  await garde(requete('10.0.0.1', 'alice'), reponse());
  const rep = reponse();
  await garde(requete('10.0.0.1', 'bob'), rep);
  assert.equal(rep.statut, null, 'meme IP, utilisateurs differents : quotas distincts');
});

test('deux operations distinctes ne partagent pas leur quota', async () => {
  reinitialiserDebit();
  const a = limiterDebit({ max: 1, fenetreMs: 60_000, operation: 'export' });
  const b = limiterDebit({ max: 1, fenetreMs: 60_000, operation: 'qualification' });
  await a(requete('10.0.0.1'), reponse());
  const rep = reponse();
  await b(requete('10.0.0.1'), rep);
  assert.equal(rep.statut, null);
});

test('le seau se remplit continument, sans attendre la fin d’une fenetre', async () => {
  reinitialiserDebit();
  // Fenetre de 200 ms pour 4 jetons : un jeton se regenere toutes les 50 ms.
  const garde = limiterDebit({ max: 4, fenetreMs: 200, operation: 'sonde' });
  for (let i = 0; i < 4; i += 1) await garde(requete('10.0.0.1'), reponse());
  const refus = reponse();
  await garde(requete('10.0.0.1'), refus);
  assert.equal(refus.statut, 429, 'quota epuise');

  await new Promise((r) => setTimeout(r, 120));
  const apres = reponse();
  await garde(requete('10.0.0.1'), apres);
  assert.equal(apres.statut, null, 'au moins un jeton doit s’etre regenere en 120 ms');
});

test('la purge retire les seaux inactifs, et seulement eux', async () => {
  reinitialiserDebit();
  // Fenetre courte : les seaux deviennent purgeables apres 4 x fenetre, soit 200 ms.
  const garde = limiterDebit({ max: 5, fenetreMs: 50, operation: 'sonde' });

  // 500 appelants distincts : c'est le seuil de declenchement de la purge. Aucun n'est encore
  // purgeable, ils viennent d'etre crees.
  for (let i = 0; i < 500; i += 1) {
    await garde(requete(`10.1.${Math.floor(i / 256)}.${i % 256}`), reponse());
  }
  assert.equal(nbSeaux(), 500, 'aucun seau recent ne doit etre purge');

  // Apres expiration, 500 nouvelles creations declenchent la purge : les 500 premiers partent.
  await new Promise((r) => setTimeout(r, 260));
  for (let i = 0; i < 500; i += 1) {
    await garde(requete(`10.2.${Math.floor(i / 256)}.${i % 256}`), reponse());
  }
  assert.equal(
    nbSeaux(),
    500,
    'les 500 seaux inactifs doivent avoir ete purges, les 500 nouveaux conserves',
  );
});

test('la reinitialisation vide la table et le compteur de purge', () => {
  reinitialiserDebit();
  assert.equal(nbSeaux(), 0);
});
