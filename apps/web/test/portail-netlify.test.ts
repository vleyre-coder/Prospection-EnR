/**
 * Le portail d'acces Netlify, execute.
 *
 * POURQUOI CE FICHIER EXISTE. Un portail d'authentification qui n'est pas execute n'est pas
 * un portail : c'est une intention. Trois choses en particulier ne se voient pas a la
 * lecture et sont donc verifiees ici en appelant le vrai code, avec de vrais objets
 * `Request` et `Response`, et pour finir a travers un vrai serveur HTTP :
 *
 *   1. LE DECODAGE DE L'EN-TETE. Base64, UTF-8, deux-points dans le mot de passe, casse du
 *      schema : quatre endroits ou une implementation approximative laisse passer, ou
 *      refuse, a tort.
 *   2. LA COMPARAISON DU COUPLE. Concatener identifiant et mot de passe sans separateur
 *      inviolable laisse « ab » + « cd » se faire passer pour « a » + « bcd ». Le test
 *      l'exige explicitement.
 *   3. L'EXCLUSION DE `/api/*`. Elle est declaree dans `config`, pas dans la fonction. Le
 *      test verifie a la fois qu'elle est declaree ET qu'elle est indispensable — c'est-a-dire
 *      que la fonction refuserait bel et bien une requete d'API porteuse d'un jeton `Bearer`.
 *      Sans cette seconde assertion, quelqu'un pourrait retirer l'exclusion en croyant
 *      qu'elle ne sert a rien, et rouvrir la boucle de deconnexion documentee dans Carte.tsx.
 *
 * CE QUE CE FICHIER NE PROUVE PAS, et qu'il faut savoir. Le runtime reel est Deno chez
 * Netlify ; ici c'est Node. Les API employees par le portail sont communes aux deux
 * (`Request`, `Response`, `crypto.subtle`, `atob`, `TextDecoder`), et `Netlify.env` est
 * simule ci-dessous. Restent hors de portee d'un test local : le routage `path` /
 * `excludedPath` et le plafond `rateLimit`, qui sont executes par la plateforme. Ils sont
 * verifies ici en tant que DECLARATION, pas en tant que comportement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import defautDuModule, {
  config,
  lireEnTeteBasic,
  lireReglages,
  portail,
  reponseRefus,
  verdict,
  type Reglages,
} from '../../../netlify/edge-functions/portail.ts';
import {
  DISTINCTS_MINIMAUX,
  LONGUEUR_MINIMALE,
  MARQUEURS_REFUSES,
  evaluer,
  proposer,
} from '../../../scripts/portail-mot-de-passe.mjs';

const REGLAGES: Reglages = { utilisateur: 'prospection', motDePasse: 'Tk9-fR2xQm7Ls4Bd8Wz1Hv' };

/** Compose l'en-tete exactement comme le fait un navigateur, UTF-8 compris. */
function enTeteBasic(utilisateur: string, motDePasse: string): string {
  const octets = new TextEncoder().encode(`${utilisateur}:${motDePasse}`);
  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return `Basic ${btoa(binaire)}`;
}

function requete(url: string, enTetes: Record<string, string> = {}): Request {
  return new Request(url, { headers: enTetes });
}

// --- 1. Decodage de l'en-tete -------------------------------------------------------------

test("l'en-tete Basic est decode, y compris ses cas penibles", () => {
  assert.equal(lireEnTeteBasic(null), null, 'aucun en-tete');
  assert.equal(lireEnTeteBasic(''), null, 'en-tete vide');
  assert.equal(lireEnTeteBasic('Basic'), null, 'schema sans valeur');
  assert.equal(lireEnTeteBasic('Bearer abc.def.ghi'), null, 'un jeton JWT n\'est pas du Basic');
  assert.equal(lireEnTeteBasic('Basic ***pas du base64***'), null, 'base64 invalide');
  assert.equal(lireEnTeteBasic(`Basic ${btoa('sansdeuxpoints')}`), null, 'pas de separateur');

  // La casse du schema est libre (RFC 7235). Un client qui envoie « basic » doit passer.
  assert.deepEqual(lireEnTeteBasic(enTeteBasic('u', 'p').replace('Basic', 'basic')), {
    utilisateur: 'u',
    motDePasse: 'p',
  });

  // Un mot de passe a le droit de contenir des deux-points : seule la PREMIERE occurrence
  // separe. Couper sur la derniere, ou sur toutes, tronquerait silencieusement le secret.
  assert.deepEqual(lireEnTeteBasic(enTeteBasic('agent', 'a:b:c')), {
    utilisateur: 'agent',
    motDePasse: 'a:b:c',
  });

  // Accents : le navigateur envoie les octets UTF-8, `atob` rend des octets, il faut decoder.
  assert.deepEqual(lireEnTeteBasic(enTeteBasic('éolien', 'clé-privée-àé')), {
    utilisateur: 'éolien',
    motDePasse: 'clé-privée-àé',
  });
});

// --- 2. Verdict ---------------------------------------------------------------------------

test('sans mot de passe configure, le portail se retire au lieu de fermer le site', async () => {
  const issue = await verdict(requete('https://site.test/'), {
    utilisateur: 'prospection',
    motDePasse: '',
  });
  assert.equal(issue, 'inactif');
});

test('le bon couple ouvre, tout le reste refuse', async () => {
  const bon = enTeteBasic(REGLAGES.utilisateur, REGLAGES.motDePasse);
  assert.equal(
    await verdict(requete('https://site.test/', { Authorization: bon }), REGLAGES),
    'ouvert',
  );

  const refus: Array<[string, Record<string, string>]> = [
    ['aucun en-tete', {}],
    ['mot de passe faux', { Authorization: enTeteBasic(REGLAGES.utilisateur, 'Tk9-fR2xQm7Ls4Bd8Wz1Hw') }],
    ['identifiant faux', { Authorization: enTeteBasic('autre', REGLAGES.motDePasse) }],
    ['mot de passe vide', { Authorization: enTeteBasic(REGLAGES.utilisateur, '') }],
    ['en-tete Bearer', { Authorization: 'Bearer un.jeton.jwt' }],
  ];
  for (const [cas, enTetes] of refus) {
    assert.equal(await verdict(requete('https://site.test/', enTetes), REGLAGES), 'refuse', cas);
  }
});

test("un decalage entre identifiant et mot de passe ne doit pas passer", async () => {
  /**
   * LE DEFAUT QUE CE TEST INTERDIT. Comparer `utilisateur + motDePasse` sans separateur
   * inviolable rend « ab » + « cd » indistinguable de « a » + « bcd ». Quiconque connait
   * l'identifiant peut alors deplacer la frontiere et deviner un mot de passe plus court.
   */
  const reglages: Reglages = { utilisateur: 'ab', motDePasse: 'cdefghijklmnopqr' };
  const decale = enTeteBasic('a', `bcdefghijklmnopqr`);
  assert.equal(await verdict(requete('https://site.test/', { Authorization: decale }), reglages), 'refuse');
  // Temoin : le couple non decale, lui, passe. Sans ce temoin le test ci-dessus pourrait
  // reussir pour une mauvaise raison (des reglages tout simplement invalides).
  const exact = enTeteBasic(reglages.utilisateur, reglages.motDePasse);
  assert.equal(await verdict(requete('https://site.test/', { Authorization: exact }), reglages), 'ouvert');
});

// --- 3. Reponse de refus ------------------------------------------------------------------

test('le refus porte le defi HTTP, et ne se met pas en cache', async () => {
  const reponse = reponseRefus();
  assert.equal(reponse.status, 401);
  const defi = reponse.headers.get('WWW-Authenticate') ?? '';
  assert.match(defi, /^Basic realm="[^"]+"/, 'defi Basic avec un domaine nomme');
  assert.match(defi, /charset="UTF-8"/, 'sans charset, un mot de passe accentue est ambigu');
  assert.equal(reponse.headers.get('Cache-Control'), 'no-store');
  assert.match(reponse.headers.get('X-Robots-Tag') ?? '', /noindex/);
  const corps = await reponse.text();
  assert.match(corps, /Accès réservé/, 'une page lisible si le visiteur annule la boite de dialogue');
  /**
   * LA SEULE PAGE QU'UN INCONNU VERRA. Elle ne doit donc rien apprendre : ni le metier de
   * l'outil, ni le nom de la variable d'environnement, ni — l'identifiant par defaut etant
   * « prospection » — un candidat pour l'identifiant. La premiere version parlait
   * d'« application de prospection fonciere » et ce test l'a refusee.
   */
  assert.doesNotMatch(
    corps,
    /prospection|fonci|MOT_DE_PASSE|UTILISATEUR_SITE|EnR/i,
    'la page de refus ne doit rien apprendre a un inconnu',
  );
});

test('aucun en-tete du refus ne sort de l\'ASCII', () => {
  /**
   * LE DEFAUT QUE CE TEST INTERDIT, ET QU'IL A TROUVE. Le domaine d'authentification portait
   * un tiret cadratin. Un en-tete HTTP ne transporte que des octets latin-1 : la construction
   * de la reponse levait `Cannot convert argument to a ByteString`, et la fonction edge
   * renvoyait 500 a chaque visite non authentifiee. Un portail qui plante ne protege rien et
   * ne laisse entrer personne — et rien, dans le code, ne le laissait voir.
   *
   * `new Response` leve deja de lui-meme : ce test rend la raison explicite, et couvre les
   * en-tetes qu'on ajouterait demain.
   */
  for (const [nom, valeur] of reponseRefus().headers.entries()) {
    assert.doesNotMatch(valeur, /[^\x20-\x7e]/, `en-tete ${nom} hors ASCII imprimable : ${valeur}`);
  }
});

test("l'export par defaut et l'export nomme sont la meme fonction", () => {
  /**
   * Netlify ne lit que l'export par defaut ; les tests appellent l'export nomme, parce que
   * l'interoperabilite CommonJS de l'outillage local rend l'objet d'exports a la place de la
   * fonction. Les deux doivent donc rester la MEME chose, sans quoi ce fichier testerait du
   * code que Netlify n'execute pas.
   */
  assert.equal(typeof portail, 'function');
  const defaut = defautDuModule as unknown as Record<string, unknown>;
  const resolu = typeof defaut === 'function' ? defaut : defaut['default'];
  assert.equal(resolu, portail, "l'export par defaut doit etre la fonction testee");
});

// --- 4. La fonction complete, avec l'environnement Netlify simule -------------------------

/** Faux `context` : seul `next()` est employe par le portail. */
function contexteFactice(): { contexte: { next: () => Promise<Response> }; appels: () => number } {
  let appels = 0;
  return {
    contexte: {
      next: async () => {
        appels += 1;
        return new Response('<!doctype html>interface', { status: 200 });
      },
    },
    appels: () => appels,
  };
}

async function avecEnvironnement<T>(
  variables: Record<string, string>,
  action: () => Promise<T>,
): Promise<T> {
  const global = globalThis as unknown as { Netlify?: unknown };
  const precedent = global.Netlify;
  global.Netlify = { env: { get: (nom: string) => variables[nom] } };
  try {
    return await action();
  } finally {
    if (precedent === undefined) delete global.Netlify;
    else global.Netlify = precedent;
  }
}

test('les reglages sont lus dans Netlify.env, avec un identifiant par defaut', async () => {
  // Hors du runtime Netlify, la variable globale n'existe pas : ne pas lever a l'import.
  assert.deepEqual(lireReglages(), { utilisateur: 'prospection', motDePasse: '' });

  await avecEnvironnement({ MOT_DE_PASSE_SITE: 'x'.repeat(20) }, async () => {
    assert.deepEqual(lireReglages(), { utilisateur: 'prospection', motDePasse: 'x'.repeat(20) });
  });
  await avecEnvironnement({ UTILISATEUR_SITE: '  agent  ', MOT_DE_PASSE_SITE: 'y' }, async () => {
    assert.deepEqual(lireReglages(), { utilisateur: 'agent', motDePasse: 'y' });
  });
});

test('la fonction ne relaie la requete que si le portail est franchi', async () => {
  const variables = {
    UTILISATEUR_SITE: REGLAGES.utilisateur,
    MOT_DE_PASSE_SITE: REGLAGES.motDePasse,
  };

  await avecEnvironnement(variables, async () => {
    const refuse = contexteFactice();
    const r1 = await portail(requete('https://site.test/'), refuse.contexte as never);
    assert.equal(r1.status, 401);
    assert.equal(refuse.appels(), 0, "une requete refusee ne doit pas atteindre le site");

    const passe = contexteFactice();
    const r2 = await portail(
      requete('https://site.test/', {
        Authorization: enTeteBasic(REGLAGES.utilisateur, REGLAGES.motDePasse),
      }),
      passe.contexte as never,
    );
    assert.equal(r2.status, 200);
    assert.equal(passe.appels(), 1);
    assert.match(await r2.text(), /interface/);
  });

  // Sans mot de passe : le site reste servi. Le garde-fou contre cet etat est dans
  // scripts/netlify-build.sh, teste plus bas.
  await avecEnvironnement({}, async () => {
    const ouvert = contexteFactice();
    const r = await portail(requete('https://site.test/'), ouvert.contexte as never);
    assert.equal(r.status, 200);
    assert.equal(ouvert.appels(), 1);
  });
});

// --- 5. Declaration : ce que la plateforme executera --------------------------------------

test("`/api/*` est exclu, et cette exclusion est indispensable", async () => {
  assert.equal(config.path, '/*', 'le portail doit couvrir tout le site');
  const exclus = Array.isArray(config.excludedPath) ? config.excludedPath : [config.excludedPath];
  assert.ok(exclus.includes('/api/*'), '`/api/*` doit etre exclu du portail');

  /**
   * LA RAISON, EXECUTEE. L'interface pose `Authorization: Bearer <jeton>` sur chaque appel
   * a son origine — client.ts et transformerRequete dans Carte.tsx. L'authentification
   * Basic emploie le meme en-tete. Si `/api/*` n'etait pas exclu, la fonction verrait un
   * `Bearer` la ou elle attend un `Basic`, repondrait 401, et l'interface prendrait ce 401
   * pour une session expiree : boucle de deconnexion sur une session valide.
   *
   * Le test le demontre au lieu de l'affirmer.
   */
  const avecJeton = requete('https://site.test/api/parcelles', {
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
  });
  assert.equal(
    await verdict(avecJeton, REGLAGES),
    'refuse',
    'si /api etait soumis au portail, tout appel authentifie recevrait 401',
  );
});

test('le plafond par IP est declare, et large assez pour un premier affichage', () => {
  const plafond = config.rateLimit;
  assert.ok(plafond, 'un portail a mot de passe partage sans plafond est une cible');
  assert.ok(plafond.windowSize >= 1 && plafond.windowSize <= 180, 'Netlify borne la fenetre a 180 s');
  assert.deepEqual(plafond.aggregateBy, ['ip', 'domain'], 'la seule agregation offerte sur tous les forfaits');
  /**
   * La fonction voit passer TOUTES les ressources statiques. Un premier affichage en demande
   * une dizaine, et plusieurs postes partagent souvent une seule adresse IP en sortie. Un
   * plafond serre transformerait le portail en panne intermittente.
   */
  const parMinute = (plafond.windowLimit / plafond.windowSize) * 60;
  assert.ok(parMinute >= 120, `plafond trop serre pour un bureau : ${parMinute}/min`);
  assert.ok(parMinute <= 1200, `plafond trop large pour freiner quoi que ce soit : ${parMinute}/min`);
});

// --- 6. L'exigence sur le mot de passe ----------------------------------------------------

test('le mot de passe du portail est exige, mesure, et propose', () => {
  assert.equal(evaluer('').ok, false, 'vide');
  assert.equal(evaluer(undefined).ok, false, 'absent');
  assert.equal(evaluer('  MotDePasseAvecEspace ').ok, false, 'espaces de bord');

  /**
   * Le temoin d'abord : un mot de passe exactement a la limite de longueur doit PASSER.
   * Sans lui, tous les refus ci-dessous pourraient venir d'une fonction qui refuse tout.
   * Le premier temoin ecrit ici — 15 fois « x » plus « ! » — echouait d'ailleurs : il faisait
   * bien 16 caracteres, mais deux caracteres distincts. Le seuil de variete a fait son travail
   * sur le test lui-meme.
   */
  const limite = 'Ab3-Kd9!Zq2Wm7Rt';
  assert.equal(limite.length, LONGUEUR_MINIMALE, 'le temoin doit etre pile a la limite');
  assert.equal(evaluer(limite).ok, true, 'temoin de longueur');
  assert.equal(evaluer(limite.slice(0, -1)).ok, false, 'un caractere de moins, et c\'est refuse');

  // Longueur suffisante mais variete nulle : refuse. C'est le piege que la seule longueur
  // ne voit pas.
  assert.equal(evaluer('a'.repeat(40)).ok, false, 'un seul caractere repete');
  const presqueVarie = 'abcdefghi'.padEnd(30, 'a'); // 9 distincts, 30 de long
  assert.equal(new Set(presqueVarie).size, DISTINCTS_MINIMAUX - 1, 'le cas limite est bien limite');
  assert.equal(evaluer(presqueVarie).ok, false, 'un caractere distinct de moins que le seuil');

  for (const marqueur of MARQUEURS_REFUSES) {
    const candidat = `Xy7-${marqueur}-Qz2Bd4Wm9`;
    assert.ok(candidat.length >= LONGUEUR_MINIMALE, `le cas de ${marqueur} doit tester le marqueur, pas la longueur`);
    assert.equal(evaluer(candidat).ok, false, `« ${marqueur} » doit etre refuse`);
  }

  // Ce que le script propose doit passer son propre examen — sinon le message d'erreur du
  // build donnerait une valeur que le build suivant refuserait.
  for (let i = 0; i < 200; i += 1) {
    const propose = proposer();
    const v = evaluer(propose);
    assert.equal(v.ok, true, `proposition refusee : ${propose} (${v.probleme})`);
  }
});

// --- 7. A travers un vrai serveur HTTP ----------------------------------------------------

test('le portail tient a travers un vrai aller-retour HTTP', async () => {
  /**
   * Les tests ci-dessus appellent la fonction avec des objets `Request` construits a la main.
   * Celui-ci fait passer les en-tetes par une vraie socket : c'est le seul moyen de verifier
   * que le defi et le couple survivent a l'encodage, a la casse des noms d'en-tete et au
   * transport, et non seulement a nos conventions de test.
   */
  const serveur = createServer((req, rep) => {
    const url = `http://${req.headers.host ?? 'local'}${req.url ?? '/'}`;
    const entrante = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([nom, valeur]) =>
        typeof valeur === 'string' ? [[nom, valeur] as [string, string]] : [],
      ),
    });
    // Toute erreur est traduite en 500 : une exception non rattrapee ici laisserait le
    // serveur ouvert et le test suspendu au lieu d'echouer — mesure faite, la premiere
    // version de ce test ne rendait jamais la main.
    void avecEnvironnement(
      { UTILISATEUR_SITE: REGLAGES.utilisateur, MOT_DE_PASSE_SITE: REGLAGES.motDePasse },
      async () => {
        const sortante = await portail(entrante, contexteFactice().contexte as never);
        rep.writeHead(sortante.status, Object.fromEntries(sortante.headers.entries()));
        rep.end(await sortante.text());
      },
    ).catch((erreur: unknown) => {
      rep.writeHead(500, { 'Content-Type': 'text/plain' });
      rep.end(String(erreur));
    });
  });

  await new Promise<void>((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const port = (serveur.address() as AddressInfo).port;
  const racine = `http://127.0.0.1:${port}`;

  try {
    const sansAuth = await fetch(racine);
    assert.equal(sansAuth.status, 401);
    assert.match(sansAuth.headers.get('www-authenticate') ?? '', /^Basic realm=/);
    await sansAuth.text();

    const mauvais = await fetch(racine, {
      headers: { Authorization: enTeteBasic(REGLAGES.utilisateur, 'mauvais-mot-de-passe-ici') },
    });
    assert.equal(mauvais.status, 401);
    await mauvais.text();

    // L'URL a identifiants intégrés, exactement ce que fait un navigateur apres la boite
    // de dialogue : c'est la forme reelle du succes.
    const bon = await fetch(racine, {
      headers: { Authorization: enTeteBasic(REGLAGES.utilisateur, REGLAGES.motDePasse) },
    });
    assert.equal(bon.status, 200);
    assert.match(await bon.text(), /interface/);
  } finally {
    // `close()` seul ne suffit pas : `fetch` (undici) garde ses connexions ouvertes, et le
    // serveur attend indefiniment qu'elles se ferment. Mesure : le test ne rendait jamais la
    // main. Il faut donc couper les sockets avant d'attendre la fermeture.
    serveur.closeAllConnections();
    await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
  }
});
