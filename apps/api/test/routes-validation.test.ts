/**
 * Les routes HTTP, la ou personne ne regardait.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 8 a mesure la couverture des 44 routes de l'API : **7 etaient
 * citees dans un test**, et « citee » est genereux — citer n'est pas exercer. N'etaient couvertes ni
 * la route RGPD (dont toute la valeur tient dans ses trois refus), ni la purge RGPD, ni la creation
 * d'utilisateur, ni AUCUNE des quatre routes d'export, c'est-a-dire les livrables transmis a des
 * tiers.
 *
 * L'infrastructure existait pourtant : `acces-roles.test.ts` construit un vrai serveur et l'interroge
 * par `app.inject`. Ces tests coutaient peu ; ils n'avaient simplement pas ete ecrits. Deux familles
 * de defauts en ont profite.
 *
 *   C7 — six routes convertissaient un parametre de requete par `Number()` sans le valider. Une
 *   valeur non numerique produisait `NaN`, qui partait tel quel en parametre SQL. Verifie contre le
 *   serveur PostgreSQL : « invalid input syntax for type bigint: "NaN" ». L'erreur `pg` ne portant pas
 *   de `statusCode`, le gestionnaire global repondait **500 erreur_interne** la ou 400 est la reponse
 *   juste. Un client ne pouvait pas distinguer « j'ai mal appele » de « le serveur est casse ».
 *
 *   C9 — les exports GeoJSON et Shapefile acceptaient une liste d'identifiants SANS PLAFOND, alors
 *   que l'export CSV en a un. La limitation de debit borne la FREQUENCE, pas la TAILLE : un seul
 *   appel pouvait demander 500 000 identifiants. Les elements n'etaient pas typés non plus, si bien
 *   qu'un element non-chaine levait un `TypeError` non intercepte — encore un 500 sur une faute
 *   d'appel.
 *
 * Les cas ci-dessous s'arretent avant tout acces a la base : les refus interviennent en
 * `preHandler` ou a la validation, donc aucune base n'est necessaire.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireServeur } from '../src/serveur.js';
import { reinitialiserDebit } from '../src/debit.js';

const SECRET = 'secret-de-test-uniquement';

type App = Awaited<ReturnType<typeof construireServeur>>;

let partage: App | null = null;

/** Un seul serveur pour tout le fichier : le construire coute plus que les tests eux-memes. */
async function serveur(): Promise<App> {
  if (!partage) {
    partage = await construireServeur({ secretJwt: SECRET });
    await partage.ready();
  }
  reinitialiserDebit();
  return partage;
}

after(async () => {
  await partage?.close();
});

type Role = 'admin' | 'prospection' | 'lecture';

function entetes(app: App, role: Role, habilite = false): Record<string, string> {
  const jeton = app.jwt.sign({
    id: '00000000-0000-0000-0000-000000000002',
    email: `${role}@local`,
    nom: role,
    role,
    habiliteDonneesProprietaires: habilite,
  });
  return { authorization: `Bearer ${jeton}` };
}

// ---------------------------------------------------------------------------
// C7 — un parametre malforme vaut 400, jamais 500
// ---------------------------------------------------------------------------

/**
 * Les six routes qui convertissaient un parametre sans le valider, et le parametre concerne.
 *
 * La bbox est fournie valide partout : ce qui est teste est le parametre numerique, et une bbox
 * invalide court-circuiterait la validation avant de l'atteindre.
 */
const PARAMETRES_NUMERIQUES: Array<{ url: string; parametre: string }> = [
  { url: '/api/carte/parcelles?bbox=1.7,48.1,1.8,48.2', parametre: 'limite' },
  { url: '/api/carte/parcelles?bbox=1.7,48.1,1.8,48.2', parametre: 'surfaceMin' },
  { url: '/api/carte/postes-sources?bbox=1.7,48.1,1.8,48.2', parametre: 'rayonKm' },
  { url: '/api/carte/couche/monument_historique?bbox=1.7,48.1,1.8,48.2', parametre: 'limite' },
  { url: '/api/leads?', parametre: 'limite' },
];

/** Valeurs qui produisaient toutes une erreur 500 avant correction. */
const VALEURS_FAUTIVES = ['abc', '-5', '1e400', 'NaN', '', '1.5.2', '  '];

test('C7 : un parametre numerique malforme produit 400, et jamais 500', async () => {
  const app = await serveur();
  for (const { url, parametre } of PARAMETRES_NUMERIQUES) {
    for (const valeur of VALEURS_FAUTIVES) {
      const separateur = url.includes('?') && !url.endsWith('?') ? '&' : '';
      const rep = await app.inject({
        method: 'GET',
        url: `${url}${separateur}${parametre}=${encodeURIComponent(valeur)}`,
        headers: entetes(app, 'prospection'),
      });
      assert.notEqual(
        rep.statusCode,
        500,
        `${url} avec ${parametre}=${JSON.stringify(valeur)} ne doit jamais produire une erreur serveur ` +
          `(recu ${rep.statusCode} : ${rep.body.slice(0, 200)})`,
      );
      // Une chaine vide est traitee comme « parametre absent » : la valeur par defaut s'applique.
      // Toutes les autres sont des fautes d'appel, et doivent etre refusees comme telles.
      if (valeur.trim() !== '') {
        assert.equal(
          rep.statusCode,
          400,
          `${url} avec ${parametre}=${JSON.stringify(valeur)} doit etre refuse (recu ${rep.statusCode})`,
        );
        const corps = rep.json() as { erreur?: { code?: string; details?: { champ?: string } } };
        assert.equal(corps.erreur?.code, 'requete_invalide');
        assert.equal(corps.erreur?.details?.champ, parametre, 'le champ fautif doit etre nomme');
      }
    }
  }
});

test('C7 : un parametre numerique valide est accepte, et le plafond s’applique en silence', async () => {
  // Le pendant du test precedent : une validation trop zelee qui refuserait une valeur legitime
  // serait une regression symetrique. Un plafond depasse n'est PAS une faute d'appel — c'est une
  // intention mal calibree, qu'on borne sans refuser.
  const app = await serveur();
  for (const valeur of ['1', '50', '999999']) {
    const rep = await app.inject({
      method: 'GET',
      url: `/api/leads?limite=${valeur}`,
      headers: entetes(app, 'prospection'),
    });
    assert.notEqual(rep.statusCode, 400, `limite=${valeur} est legitime et ne doit pas etre refusee`);
  }
});

// ---------------------------------------------------------------------------
// D6 — la route de couche generique a une liste fermee
// ---------------------------------------------------------------------------

test('D6 : la route de couche refuse un type hors liste', async () => {
  // Le type partait directement en parametre SQL : aucune injection possible, les requetes etant
  // parametrees, mais rien ne bornait ce qu'un appelant pouvait extraire de la table `contrainte`.
  const app = await serveur();
  for (const type of ['proprietaire_parcelle', 'inconnu', 'parcelle', '']) {
    const rep = await app.inject({
      method: 'GET',
      url: `/api/carte/couche/${encodeURIComponent(type)}?bbox=1.7,48.1,1.8,48.2`,
      headers: entetes(app, 'prospection'),
    });
    assert.ok(
      rep.statusCode === 404 || rep.statusCode === 400,
      `le type « ${type} » doit etre refuse (recu ${rep.statusCode})`,
    );
  }
});

// ---------------------------------------------------------------------------
// C9 — les exports sont bornes, et leurs elements types
// ---------------------------------------------------------------------------

const EXPORTS_PAR_IDUS = ['/api/exports/geojson', '/api/exports/shapefile'];

test('C9 : un export sans identifiants est refuse', async () => {
  const app = await serveur();
  for (const url of EXPORTS_PAR_IDUS) {
    for (const corps of [{}, { idus: [] }, { idus: null }, { idus: 'ABC' }, { idus: {} }]) {
      const rep = await app.inject({
        method: 'POST',
        url,
        headers: entetes(app, 'prospection'),
        payload: { ...corps, filiere: 'solaire_sol' },
      });
      assert.equal(
        rep.statusCode,
        400,
        `${url} avec ${JSON.stringify(corps)} doit etre refuse (recu ${rep.statusCode})`,
      );
    }
  }
});

test('C9 : un export au-dela du plafond est refuse, et le plafond est nomme', async () => {
  /**
   * Le defaut : aucun plafond, alors que l'export CSV en avait un. La limitation de debit
   * (30 requetes par 10 minutes) borne la frequence, pas la taille — un seul appel pouvait demander
   * un demi-million d'identifiants et epuiser la memoire du serveur.
   */
  const app = await serveur();
  const trop = Array.from({ length: 60_000 }, (_, i) => `28390000${String(i).padStart(6, '0')}`);
  for (const url of EXPORTS_PAR_IDUS) {
    const rep = await app.inject({
      method: 'POST',
      url,
      headers: entetes(app, 'prospection'),
      payload: { idus: trop, filiere: 'solaire_sol' },
    });
    assert.equal(rep.statusCode, 400, `${url} doit refuser 60 000 identifiants`);
    const corps = rep.json() as { erreur?: { message?: string } };
    assert.match(
      corps.erreur?.message ?? '',
      /maximum \d+/,
      'le message doit indiquer le plafond, sans quoi l’appelant ne peut pas corriger',
    );
  }
});

test('C9 : un element non-chaine est refuse, et ne provoque pas d’erreur serveur', async () => {
  // `idus.map((i) => i.toUpperCase())` sur un element non-chaine levait un TypeError non intercepte,
  // donc une erreur 500 sur une faute d'appel.
  const app = await serveur();
  for (const url of EXPORTS_PAR_IDUS) {
    for (const idus of [[42], [null], [{}], ['283900000C0843', 7], [''], ['   ']]) {
      const rep = await app.inject({
        method: 'POST',
        url,
        headers: entetes(app, 'prospection'),
        payload: { idus, filiere: 'solaire_sol' },
      });
      assert.equal(
        rep.statusCode,
        400,
        `${url} avec ${JSON.stringify(idus)} doit etre refuse (recu ${rep.statusCode})`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// RGPD — les trois refus de la route des proprietaires
// ---------------------------------------------------------------------------

const URL_PROPRIETAIRE = '/api/parcelles/283900000C0843/proprietaire';

test('RGPD : un compte non habilite est refuse, avec le motif', async () => {
  /**
   * Toute la valeur de cette route tient dans ses refus, et aucun n'etait teste. Le dispositif est le
   * plus solide de l'application — habilitation, motif obligatoire, journalisation stricte — et il
   * n'avait aucun filet.
   */
  const app = await serveur();
  const rep = await app.inject({
    method: 'GET',
    url: URL_PROPRIETAIRE,
    headers: { ...entetes(app, 'prospection', false), 'x-motif-acces': 'prospection fonciere Beauce' },
  });
  assert.equal(rep.statusCode, 403);
  const corps = rep.json() as { erreur?: { code?: string } };
  assert.equal(corps.erreur?.code, 'non_habilite');
});

test('RGPD : un acces habilite sans motif circonstancie est refuse', async () => {
  const app = await serveur();
  for (const motif of [undefined, '', '   ', 'abc', 'x']) {
    const rep = await app.inject({
      method: 'GET',
      url: URL_PROPRIETAIRE,
      headers: {
        ...entetes(app, 'prospection', true),
        ...(motif === undefined ? {} : { 'x-motif-acces': motif }),
      },
    });
    assert.equal(
      rep.statusCode,
      400,
      `motif ${JSON.stringify(motif)} doit etre refuse (recu ${rep.statusCode})`,
    );
    const corps = rep.json() as { erreur?: { code?: string } };
    assert.equal(corps.erreur?.code, 'motif_requis');
  }
});

test('RGPD : le role admin ne dispense PAS de l’habilitation', async () => {
  // Verification explicite : etre administrateur de l'application n'est pas etre habilite a consulter
  // des donnees nominatives de propriete. Ce sont deux droits distincts, et les confondre serait la
  // faille la plus probable de ce dispositif.
  const app = await serveur();
  const rep = await app.inject({
    method: 'GET',
    url: URL_PROPRIETAIRE,
    headers: { ...entetes(app, 'admin', false), 'x-motif-acces': 'audit interne du registre' },
  });
  assert.equal(rep.statusCode, 403, "un admin non habilite ne doit pas acceder aux donnees nominatives");
});

// ---------------------------------------------------------------------------
// Routes d'administration
// ---------------------------------------------------------------------------

const ROUTES_ADMIN: Array<{ methode: 'GET' | 'POST'; url: string; corps?: unknown }> = [
  { methode: 'GET', url: '/api/admin/ingestions' },
  { methode: 'GET', url: '/api/admin/journal' },
  { methode: 'POST', url: '/api/admin/purge-rgpd', corps: {} },
  {
    methode: 'POST',
    url: '/api/admin/utilisateurs',
    corps: { email: 'x@local', nom: 'X', role: 'lecture', motDePasse: 'motdepasse-long' },
  },
  { methode: 'POST', url: '/api/admin/ingestions/communes', corps: {} },
];

test('les routes d’administration refusent les roles non administrateurs', async () => {
  const app = await serveur();
  for (const { methode, url, corps } of ROUTES_ADMIN) {
    for (const role of ['lecture', 'prospection'] as const) {
      const rep = await app.inject({
        method: methode,
        url,
        headers: entetes(app, role),
        ...(corps === undefined ? {} : { payload: corps }),
      });
      assert.equal(rep.statusCode, 403, `${methode} ${url} doit refuser le role ${role}`);
      const j = rep.json() as { erreur?: { code?: string } };
      assert.equal(j.erreur?.code, 'role_insuffisant');
    }
  }
});

test('les routes d’administration refusent un appel non authentifie', async () => {
  const app = await serveur();
  for (const { methode, url, corps } of ROUTES_ADMIN) {
    const rep = await app.inject({
      method: methode,
      url,
      ...(corps === undefined ? {} : { payload: corps }),
    });
    assert.equal(rep.statusCode, 401, `${methode} ${url} doit exiger une authentification`);
  }
});

// ---------------------------------------------------------------------------
// Coherence du format d'erreur
// ---------------------------------------------------------------------------

test('toute erreur de l’API porte un code et un message exploitables', async () => {
  /**
   * Un format d'erreur incoherent oblige le client a deviner. Ce test parcourt un echantillon de
   * refus de nature differente — authentification, role, validation, ressource inconnue — et verifie
   * qu'ils se lisent tous de la meme facon.
   */
  const app = await serveur();
  const cas: Array<{ methode: 'GET' | 'POST'; url: string; entetes?: Record<string, string>; corps?: unknown }> = [
    { methode: 'GET', url: '/api/admin/journal' },
    { methode: 'GET', url: '/api/admin/journal', entetes: {} },
    { methode: 'GET', url: '/api/carte/couche/inconnu?bbox=1,48,2,49' },
    { methode: 'GET', url: '/api/carte/parcelles?bbox=pas-une-bbox' },
    { methode: 'GET', url: '/api/carte/parcelles?bbox=1,48,2,49&limite=abc' },
    { methode: 'POST', url: '/api/exports/geojson', corps: { filiere: 'solaire_sol' } },
  ];
  for (const c of cas) {
    const rep = await app.inject({
      method: c.methode,
      url: c.url,
      headers: c.entetes ?? entetes(app, 'prospection'),
      ...(c.corps === undefined ? {} : { payload: c.corps }),
    });
    assert.ok(rep.statusCode >= 400, `${c.url} devait echouer, recu ${rep.statusCode}`);
    const j = rep.json() as { erreur?: { code?: string; message?: string } };
    assert.ok(j.erreur, `${c.url} : la reponse doit porter un objet \`erreur\``);
    assert.ok(
      typeof j.erreur?.code === 'string' && j.erreur.code.length > 0,
      `${c.url} : code d'erreur manquant`,
    );
    assert.ok(
      typeof j.erreur?.message === 'string' && j.erreur.message.length > 10,
      `${c.url} : message d'erreur absent ou trop court pour etre utile`,
    );
  }
});
