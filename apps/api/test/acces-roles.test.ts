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
  /**
   * Les deux autres routes de qualification, longtemps absentes de cette liste.
   *
   * `/api/qualification/parcelles` n'avait AUCUN controle de role : un compte en lecture seule
   * pouvait qualifier une liste d'identifiants jusqu'au plafond par appel, et epuiser le quota
   * partage par toute l'equipe. Le present fichier avait pourtant ete ecrit parce que « le role
   * lecture etait applique aux leads mais pas a la qualification » — il ne couvrait que la route
   * d'emprise, et la route soeur est restee ouverte.
   *
   * `/api/qualification/rafraichir`, ajoutee a l'audit 9, a reproduit exactement le meme oubli.
   * D'ou la fonction nommee `refuserLectureSeule` et le test structurel plus bas : un controle
   * qu'on recopie finit par etre oublie.
   */
  {
    nom: 'qualification d’une liste de parcelles',
    methode: 'POST',
    url: '/api/qualification/parcelles',
    corps: { idus: ['283900000C0843'], filiere: 'solaire_sol' },
  },
  {
    nom: 'rafraichissement des parcelles en retard',
    methode: 'POST',
    url: '/api/qualification/rafraichir',
    corps: {},
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
      /**
       * CHARGE UTILE VOLONTAIREMENT INCOMPLETE — audit 10, defaut B4.
       *
       * Ce test verifie une seule chose : que le controle de role ne se declenche PAS pour un compte
       * de prospection. Sa premiere version envoyait une emprise valide, en supposant que « la suite
       * echoue faute de base » — hypothese vraie a l'ecriture, fausse depuis que la CI et le poste de
       * developpement fournissent une base.
       *
       * Mesure : avec `DATABASE_URL` defini, cet appel lance une QUALIFICATION REELLE de 438
       * parcelles, soit une dizaine de minutes d'appels vers le cadastre, le GPU, Georisques et
       * l'altimetrie — a chaque `npm test`. Trois consequences, toutes contraires a ce que le projet
       * cherche a proteger : la suite passe de deux a douze minutes, le quota partage des services
       * publics est consomme par un test de controle d'acces, et 438 snapshots sont reecrits en base.
       *
       * `bbox` est donc omis : le controle de role s'execute AVANT la validation du corps, donc la
       * reponse est 400 et non 403. L'invariant teste est identique, et plus lisible.
       */
      payload: { filiere: 'solaire_sol' },
    });
    assert.notEqual(r.statusCode, 403, 'un compte de prospection ne doit pas etre refuse');
    assert.equal(r.statusCode, 400, 'la validation du corps prend le relais, sans rien lancer');
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

/**
 * Correction du quatrieme audit : la sonde de sante mentait sous configuration fatale.
 *
 * En production avec AUTH_DESACTIVEE, le serveur demarre, `/api/sante` repondait
 * `statut: 'ok'` et toute route protegee renvoyait 500 `configuration_invalide`. Un deploiement
 * passait au vert sur une instance entierement inoperante, et une bascule de trafic y envoyait
 * les utilisateurs.
 */
test('la sonde de sante signale une configuration fatale', async () => {
  /**
   * ════════════════════════════════════════════════════════════════════════════════════════
   * CE TEST LISAIT LE TEXTE DU CODE. IL EXERCE MAINTENANT SON COMPORTEMENT — audit 11.
   * ════════════════════════════════════════════════════════════════════════════════════════
   *
   * Version precedente : trois `assert.match` sur la SOURCE de `routes/referentiel.ts`,
   * cherchant les chaines `configurationsFatales`, `hors_service`, et litteralement
   * `config.auth.desactivee && config.env === 'production'`.
   *
   * Deux consequences, et les deux se sont produites.
   *
   *   1. **Il n'a jamais attrape le defaut.** La sonde declarait l'application de bureau
   *      `hors_service` avec le conseil « Retirez cette variable » — qui casse precisement
   *      l'application — pendant que ses routes protegees rendaient 200. Un test qui verifie
   *      la PRESENCE d'une condition ne peut rien dire de sa JUSTESSE.
   *   2. **Il a casse quand le code s'est ameliore.** La condition, deplacee dans une fonction
   *      pure et testable, ne s'ecrivait plus a l'identique : le test est passe au rouge alors
   *      que le comportement etait devenu correct. Un test qui s'oppose aux corrections est
   *      une charge, pas une protection.
   *
   * La regle qui en decoule, et qui vaut pour les autres tests par filtrage de source de ce
   * fichier : on affirme sur ce que le code FAIT. Les quatre cas de configuration sont
   * exerces un a un dans `mode-bureau.test.ts` ; ici on garde le cas d'origine du quatrieme
   * audit, celui qui a motive la sonde.
   */
  const { configurationsFatales } = await import('../src/config.js');

  const fatales = configurationsFatales({
    env: 'production',
    hote: '0.0.0.0',
    auth: { desactivee: true, modeBureau: false },
  });
  assert.equal(fatales.length, 1, 'AUTH_DESACTIVEE en production est une configuration fatale');
  assert.match(fatales[0] ?? '', /AUTH_DESACTIVEE/, 'la variable fautive doit etre nommee');

  // Le temoin, absent de la version par filtrage de source : une instance correctement
  // configuree ne doit rien signaler, sinon « configuration fatale » ne veut plus rien dire.
  assert.deepEqual(
    configurationsFatales({
      env: 'production',
      hote: '0.0.0.0',
      auth: { desactivee: false, modeBureau: false },
    }),
    [],
  );
});

test("le Shapefile distingue une parcelle ecartee d'une parcelle mal notee", async () => {
  // Meme defaut que dans la liste et le CSV, survivant dans le format le plus souvent remis a un
  // tiers — geometre, bureau d'etudes, consultant SIG.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const routes = readFileSync(
    fileURLToPath(new URL('../src/routes/divers.ts', import.meta.url)),
    'utf8',
  );
  assert.match(routes, /nb_ko_bloq:/, 'le DBF doit porter le compteur de knock-outs bloquants');
  assert.match(routes, /ecartee:/, 'et une colonne lisible sans calcul');
  assert.match(
    routes,
    /filter\(\(k\) => !k\.derogeable\)/,
    'seuls les knock-outs NON derogeables qualifient une parcelle d’ecartee',
  );

  const shapefile = readFileSync(
    fileURLToPath(new URL('../src/services/shapefile.ts', import.meta.url)),
    'utf8',
  );
  assert.match(
    shapefile,
    /NB_KO_BLOQ/,
    'le LISEZ-MOI doit expliquer la difference : un DBF se lit sans documentation externe',
  );
});

// ---------------------------------------------------------------------------
// La limitation de debit ne doit pas etre contournable par un en-tete
// ---------------------------------------------------------------------------

test('la limitation de debit resiste a un X-Forwarded-For forge', async () => {
  /**
   * DEFAUT TROUVE APRES L'AUDIT 8, par relecture des zones nouvellement corrigees.
   *
   * Le serveur declarait `trustProxy: true`, ce qui fait prendre a Fastify l'entree la PLUS A GAUCHE
   * de `X-Forwarded-For` — c'est-a-dire une valeur entierement fournie par le client. La limitation de
   * debit indexe ses seaux sur `req.ip` pour les appels non authentifies : elle etait donc
   * contournable en changeant un en-tete a chaque requete.
   *
   * MESURE AVANT CORRECTION : 429 apres 11 tentatives en conditions normales, JAMAIS en 60 tentatives
   * en variant `X-Forwarded-For`. C'etait la seule protection de la seule route qu'un attaquant non
   * authentifie peut marteler — celle dont le commentaire en tete de ce fichier dit qu'elle a ete
   * ajoutee precisement pour cela.
   *
   * `trustProxy: 1` ne suffisait PAS : sans relais reel, `X-Forwarded-For` ne contient qu'une entree,
   * celle du client, et un saut de confiance la retient. La valeur sure par defaut est donc 0, et un
   * deploiement derriere un relais doit declarer combien il en a.
   */
  const app = await serveur();
  reinitialiserDebit();
  const corps = { email: 'inexistant@local', motDePasse: 'faux' };

  let refuseeApres = 0;
  for (let i = 0; i < 60; i += 1) {
    const rep = await app.inject({
      method: 'POST',
      url: '/api/auth/connexion',
      payload: corps,
      // Une adresse differente a chaque tentative : si elle etait prise en compte, chaque requete
      // aurait son propre seau et le quota ne serait jamais atteint.
      headers: { 'x-forwarded-for': `203.0.113.${i}` },
    });
    if (rep.statusCode === 429) {
      refuseeApres = i + 1;
      break;
    }
  }
  await app.close();

  assert.ok(
    refuseeApres > 0,
    'la limitation de debit n’a jamais refuse en 60 tentatives avec un X-Forwarded-For variable : ' +
      'elle est contournable par un en-tete, et ne protege donc pas la route de connexion.',
  );
  assert.ok(
    refuseeApres <= 20,
    `refus au bout de ${refuseeApres} tentatives : le quota doit etre celui d’un seul appelant.`,
  );
});

/**
 * Garde structurel : toute route de qualification refuse explicitement la lecture seule.
 *
 * Les cas ci-dessus protegent les routes qui existent aujourd'hui. Celui-ci protege les prochaines.
 * L'histoire justifie la difference : le controle etait ecrit en clair dans la route d'emprise, la
 * route soeur `/api/qualification/parcelles` ne l'avait jamais eu, et la route de rafraichissement
 * ajoutee a l'audit 9 a reproduit l'oubli. Trois occasions, deux manquees.
 *
 * La regle verifiee est mecanique : toute declaration `app.post('/api/qualification/...')` doit
 * appeler `refuserLectureSeule` dans le corps qui suit.
 */
test('toute route de qualification appelle refuserLectureSeule', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('../src/routes/parcelles.ts', import.meta.url)),
    'utf8',
  );

  const declarations = [...source.matchAll(/app\.post\(\s*'(\/api\/qualification\/[^']+)'/g)];
  assert.ok(
    declarations.length >= 3,
    `attendu au moins trois routes de qualification, trouve ${declarations.length} — ` +
      'le motif de recherche ne correspond plus au code',
  );

  const sansControle: string[] = [];
  for (const d of declarations) {
    // Le corps de la route va de sa declaration a la declaration suivante, ou a la fin du fichier.
    const debut = d.index ?? 0;
    const suivante = source.indexOf("app.post('/api", debut + 10);
    const corps = source.slice(debut, suivante === -1 ? source.length : suivante);
    // `/estimation` ne consomme aucun quota : elle compte des parcelles en base, sans rien
    // interroger a l'exterieur. C'est la seule exception, et elle est nommee.
    if (d[1] === '/api/qualification/estimation') continue;
    if (!corps.includes('refuserLectureSeule')) sansControle.push(d[1]!);
  }

  assert.deepEqual(
    sansControle,
    [],
    'ces routes de qualification consomment le quota des sources publiques sans refuser un compte ' +
      `en lecture seule : ${sansControle.join(', ')}`,
  );
});
