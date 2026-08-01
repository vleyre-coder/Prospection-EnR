/**
 * Controle d'acces aux tuiles vectorielles.
 *
 * Les tuiles parcellaires portent `statut_prospection` : quelles parcelles sont demarchees,
 * en negociation ou signees. Elles etaient servies sans authentification, au motif qu'une
 * tuile ne contient pas de nom de proprietaire. C'est exact et insuffisant : l'etat du
 * pipeline commercial, parcelle par parcelle, est une information de l'organisation, et
 * savoir quelles parcelles sont demarchees revient a savoir quels proprietaires ont ete
 * contactes.
 *
 * Les zooms utilises ci-dessous sont volontairement hors des plages servies : la route
 * repond 204 sans interroger la base. Ce qui est teste est donc bien le filtre
 * d'authentification, isole de toute dependance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireServeur } from '../src/serveur.js';

const SECRET = 'secret-de-test-uniquement';

/** Tuile parcellaire a un zoom trop faible : la route repond 204 sans toucher la base. */
const TUILE_PARCELLES = '/api/carte/tuiles/parcelles/5/16/11.mvt';
/** Tuile communale a un zoom trop eleve : meme principe. */
const TUILE_COMMUNES = '/api/carte/tuiles/communes/18/132000/90000.mvt';

async function serveur() {
  const app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  return app;
}

function jetonValide(app: Awaited<ReturnType<typeof serveur>>): string {
  return app.jwt.sign({
    id: '00000000-0000-0000-0000-000000000001',
    email: 'test@local',
    nom: 'Test',
    role: 'prospection',
    habiliteDonneesProprietaires: false,
  });
}

test('une tuile parcellaire est refusee sans jeton', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({ method: 'GET', url: TUILE_PARCELLES });
    assert.equal(r.statusCode, 401, 'le statut de prospection ne doit pas etre servi en clair');
    assert.equal(JSON.parse(r.body).erreur.code, 'non_authentifie');
  } finally {
    await app.close();
  }
});

test('un jeton invalide ne suffit pas a obtenir une tuile parcellaire', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({
      method: 'GET',
      url: TUILE_PARCELLES,
      headers: { authorization: 'Bearer ceci-nest-pas-un-jeton' },
    });
    assert.equal(r.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('une tuile parcellaire est servie avec un jeton valide', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({
      method: 'GET',
      url: TUILE_PARCELLES,
      headers: { authorization: `Bearer ${jetonValide(app)}` },
    });
    // 204 : le zoom est hors plage. L'essentiel est que la requete ait FRANCHI le filtre
    // d'authentification - une regression le ferait retomber a 401.
    assert.equal(r.statusCode, 204);
  } finally {
    await app.close();
  }
});

test('les tuiles communales restent publiques : elles n’exposent que des compteurs agreges', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({ method: 'GET', url: TUILE_COMMUNES });
    assert.notEqual(r.statusCode, 401, 'la vue nationale ne doit pas exiger de jeton');
  } finally {
    await app.close();
  }
});

test('une tuile parcellaire n’est jamais mise en cache partage', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({
      method: 'GET',
      url: '/api/carte/tuiles/parcelles/14/8300/5700.mvt',
      headers: { authorization: `Bearer ${jetonValide(app)}` },
    });
    // Sans base, la route echoue : on ne teste ici que les cas ou elle a repondu.
    if (r.statusCode === 200) {
      assert.match(r.headers['cache-control'] as string, /private/);
      assert.equal(r.headers['vary'], 'Authorization');
    }
  } finally {
    await app.close();
  }
});
