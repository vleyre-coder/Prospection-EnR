/**
 * Controle d'acces par role, et limitation de debit.
 *
 * Deux failles corrigees ici :
 *   - le role `lecture` etait applique aux leads mais pas aux sites ni a la qualification :
 *     un compte en lecture seule pouvait creer et supprimer des sites, et lancer une
 *     qualification de masse consommant le quota partage aupres des services publics ;
 *   - aucune limitation de debit ENTRANTE n'existait, alors que la connexion est la seule
 *     route ou un attaquant non authentifie peut insister.
 *
 * Les cas testes s'arretent avant tout acces a la base : le refus intervient en
 * `preHandler`, donc aucune base n'est necessaire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireServeur } from '../src/serveur.js';
import { reinitialiserDebit } from '../src/debit.js';

const SECRET = 'secret-de-test-uniquement';

async function serveur() {
  const app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  return app;
}

type App = Awaited<ReturnType<typeof serveur>>;

function jeton(app: App, role: 'admin' | 'prospection' | 'lecture'): string {
  return app.jwt.sign({
    id: `00000000-0000-0000-0000-00000000000${role === 'lecture' ? 1 : 2}`,
    email: `${role}@local`,
    nom: role,
    role,
    habiliteDonneesProprietaires: false,
  });
}

function entetes(app: App, role: 'admin' | 'prospection' | 'lecture') {
  return { authorization: `Bearer ${jeton(app, role)}` };
}

/** Routes d'ecriture qui doivent toutes refuser un compte en lecture seule. */
const ECRITURES: Array<{ nom: string; methode: 'POST' | 'DELETE'; url: string; corps?: unknown }> = [
  {
    nom: 'creation de site',
    methode: 'POST',
    url: '/api/sites',
    corps: { nom: 'Site test', filiere: 'solaire_sol', idus: ['283900000C0843'] },
  },
  {
    nom: 'suppression de site',
    methode: 'DELETE',
    url: '/api/sites/11111111-1111-1111-1111-111111111111',
  },
  {
    nom: 'qualification d’emprise',
    methode: 'POST',
    url: '/api/qualification/emprise',
    corps: { bbox: [1.73, 48.14, 1.79, 48.18], filiere: 'solaire_sol' },
  },
  {
    nom: 'creation de lead',
    methode: 'POST',
    url: '/api/leads',
    corps: { idu: '283900000C0843', filiere: 'solaire_sol' },
  },
];

for (const cas of ECRITURES) {
  test(`un compte en lecture seule ne peut pas : ${cas.nom}`, async () => {
    const app = await serveur();
    try {
      const r = await app.inject({
        method: cas.methode,
        url: cas.url,
        headers: entetes(app, 'lecture'),
        ...(cas.corps ? { payload: cas.corps } : {}),
      });
      assert.equal(r.statusCode, 403, `${cas.nom} devrait etre refusee`);
      assert.equal(JSON.parse(r.body).erreur.code, 'lecture_seule');
    } finally {
      await app.close();
    }
  });
}

test('un compte de prospection franchit le controle de role', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/api/qualification/emprise',
      headers: entetes(app, 'prospection'),
      payload: { bbox: [1.73, 48.14, 1.79, 48.18], filiere: 'solaire_sol' },
    });
    // La suite echoue faute de base, mais le refus de role n'a pas eu lieu : c'est ce
    // qu'on verifie. Une regression le ferait retomber a 403.
    assert.notEqual(r.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('les routes d’administration restent fermees a un compte de prospection', async () => {
  const app = await serveur();
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/rescorer',
      headers: entetes(app, 'prospection'),
      payload: {},
    });
    assert.equal(r.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('la connexion est limitee en debit, pour contrer le bourrage d’identifiants', async () => {
  reinitialiserDebit();
  const app = await serveur();
  try {
    let vus429 = 0;
    let derniere = 0;
    // La limite est de 10 tentatives par quart d'heure. Les premieres echouent en 401 ou
    // 500 (pas de base), ce qui est sans importance : seul compte le basculement en 429.
    for (let i = 0; i < 14; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        payload: { email: 'inconnu@local', motDePasse: 'x'.repeat(12) },
      });
      derniere = r.statusCode;
      if (r.statusCode === 429) vus429 += 1;
    }
    assert.ok(vus429 > 0, 'la 11e tentative et les suivantes doivent etre refusees');
    assert.equal(derniere, 429);
  } finally {
    await app.close();
  }
});

test('la limitation de debit annonce le delai a respecter', async () => {
  reinitialiserDebit();
  const app = await serveur();
  try {
    let reponse = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: { email: 'a@local', motDePasse: 'x'.repeat(12) },
    });
    for (let i = 0; i < 14 && reponse.statusCode !== 429; i += 1) {
      reponse = await app.inject({
        method: 'POST',
        url: '/api/auth/connexion',
        payload: { email: 'a@local', motDePasse: 'x'.repeat(12) },
      });
    }
    assert.equal(reponse.statusCode, 429);
    assert.ok(reponse.headers['retry-after'], 'un en-tete Retry-After doit etre pose');
    assert.match(JSON.parse(reponse.body).erreur.message, /seconde/);
  } finally {
    await app.close();
  }
});
