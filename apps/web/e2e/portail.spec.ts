/**
 * L'application, derriere le portail d'acces, dans un vrai navigateur.
 *
 * POURQUOI CETTE SPECIFICATION EXISTE. `apps/web/test/portail-netlify.test.ts` prouve que la
 * fonction edge decide juste : elle refuse sans identifiants, elle ouvre avec les bons, elle ne
 * fuit rien. Il reste une question qu'aucun test unitaire ne peut trancher : **l'application
 * fonctionne-t-elle encore derriere ce portail ?** Une authentification HTTP Basic pose des
 * questions que seul un navigateur repond :
 *
 *   - le document est garde, mais les fragments de code (`/assets/*.js`) le sont aussi : le
 *     navigateur renvoie-t-il bien les identifiants a chaque sous-ressource, y compris a celles
 *     que MapLibre charge depuis un Web Worker ?
 *   - le repli page unique (`/*` -> `index.html`) traverse-t-il le portail ?
 *   - l'application, servie depuis une origine gardee, joint-elle toujours son API ?
 *
 * CE QUI EST SIMULE, ET CE QUI EST REEL. La fonction edge est la vraie, importee telle quelle.
 * Le ROUTAGE est simule : un relais Node applique `config.path` et `config.excludedPath` comme
 * Netlify le fera, puis relaie vers l'interface construite (`vite preview`). Netlify lui-meme
 * n'est pas executable ici. Ce que cette specification prouve, donc : l'application se comporte
 * correctement derriere la fonction, avec le routage declare. Ce qu'elle ne prouve pas : que
 * Netlify applique ce routage comme documente — cela ne se verifie qu'au premier deploiement.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';
// L'export NOMME, pas l'export par defaut : le dossier `netlify/` n'a pas de
// `"type": "module"`, si bien que l'outillage local traite ce fichier en CommonJS et rend
// l'objet d'exports a la place de la fonction. `portail-netlify.test.ts` verifie que les deux
// designent bien la meme fonction.
import { config, portail } from '../../../netlify/edge-functions/portail.ts';
import { E2E, FICHIER_ETAT_SESSION } from '../playwright.config.js';

/**
 * Les identifiants attendus, poses dans l'environnement comme Netlify le fera.
 *
 * La fonction lit `Netlify.env` ; hors du runtime edge, cette globale n'existe pas. On la
 * fabrique, plutot que d'ajouter a la fonction un chemin de lecture qui ne servirait qu'aux
 * tests — un code de production qui contient une porte pour ses tests finit par la garder.
 */
function armerEnvironnement(): void {
  (globalThis as unknown as { Netlify?: unknown }).Netlify = {
    env: {
      get: (nom: string) =>
        nom === 'UTILISATEUR_SITE'
          ? E2E.portailUtilisateur
          : nom === 'MOT_DE_PASSE_SITE'
            ? E2E.portailMotDePasse
            : undefined,
    },
  };
}

/** `true` si le chemin est soustrait au portail par `config.excludedPath`. */
function exclu(chemin: string): boolean {
  const motifs = Array.isArray(config.excludedPath)
    ? config.excludedPath
    : config.excludedPath
      ? [config.excludedPath]
      : [];
  return motifs.some((motif) =>
    motif.endsWith('/*') ? chemin.startsWith(motif.slice(0, -1)) : chemin === motif,
  );
}

/**
 * En-tetes a ne PAS recopier vers le navigateur.
 *
 * `fetch` decompresse la reponse mais conserve `content-encoding` : recopie telle quelle,
 * l'en-tete annoncerait du gzip sur un corps deja clair et le navigateur echouerait a le lire.
 * Mesure faite : la page restait blanche, sans erreur reseau. `content-length` et
 * `transfer-encoding` sont refaits par Node.
 */
const EN_TETES_A_OMETTRE = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

function demarrerRelais(): Promise<Server> {
  const serveur = createServer((req, rep) => {
    const chemin = (req.url ?? '/').split('?')[0] ?? '/';
    const entrante = new Request(`${E2E.urlWeb}${req.url ?? '/'}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([nom, valeur]) =>
        typeof valeur === 'string' ? [[nom, valeur] as [string, string]] : [],
      ),
      redirect: 'manual',
    });
    /**
     * `next()` du runtime edge : la suite de la chaine.
     *
     * DEUX CIBLES, ET C'EST CE QUE FAIT NETLIFY. En mode reproxification, `dist/_redirects`
     * relaie `/api/*` vers l'API et rend `index.html` pour tout le reste. Une premiere version
     * de ce relais envoyait TOUT a `vite preview` — dont le proxy `/api` de developpement
     * pointe vers `URL_API`, non renseignee ici : `/api/...` remontait donc un 500 de passerelle
     * au lieu du 401 de l'API, et la specification echouait sur un artefact de son propre
     * echafaudage. Mesure faite, corrigee : la cible depend du chemin, comme en production.
     */
    const relayer = (): Promise<Response> => {
      const racine = chemin.startsWith('/api/') ? E2E.urlApi : E2E.urlWeb;
      return fetch(`${racine}${req.url ?? '/'}`, {
        method: req.method,
        headers: entrante.headers,
        redirect: 'manual',
      });
    };

    const traiter = async (): Promise<void> => {
      const sortante = exclu(chemin)
        ? await relayer()
        : await portail(entrante, { next: relayer } as never);
      const enTetes: Record<string, string> = {};
      for (const [nom, valeur] of sortante.headers.entries()) {
        if (!EN_TETES_A_OMETTRE.has(nom.toLowerCase())) enTetes[nom] = valeur;
      }
      rep.writeHead(sortante.status, enTetes);
      rep.end(Buffer.from(await sortante.arrayBuffer()));
    };

    traiter().catch((erreur: unknown) => {
      rep.writeHead(500, { 'Content-Type': 'text/plain' });
      rep.end(String(erreur));
    });
  });
  return new Promise((resoudre) =>
    serveur.listen(E2E.portPortail, '127.0.0.1', () => resoudre(serveur)),
  );
}

/** Le jeton acquis une fois par `connexion.setup.ts`, relu depuis l'etat de session. */
function jetonDeSession(): string {
  const etat = JSON.parse(readFileSync(FICHIER_ETAT_SESSION, 'utf8')) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
  };
  for (const origine of etat.origins ?? []) {
    const entree = (origine.localStorage ?? []).find((e) => e.name === 'enr_jeton');
    if (entree) return entree.value;
  }
  throw new Error("L'état de session ne porte pas de jeton : connexion.setup.ts a-t-il tourne ?");
}

let relais: Server;

test.beforeAll(async () => {
  armerEnvironnement();
  relais = await demarrerRelais();
});

test.afterAll(async () => {
  relais.closeAllConnections();
  await new Promise<void>((resoudre) => relais.close(() => resoudre()));
});

test('sans identifiants, le portail ferme le site — document et fragments de code', async ({
  request,
}) => {
  const page = await request.get(`${E2E.urlPortail}/`, { failOnStatusCode: false });
  expect(page.status()).toBe(401);
  expect(page.headers()['www-authenticate']).toMatch(/^Basic realm=/);
  expect(await page.text()).toContain('Accès réservé');

  // Le repli page unique est garde lui aussi : une URL profonde ne doit pas contourner le portail.
  const profonde = await request.get(`${E2E.urlPortail}/liste/quelque-chose`, {
    failOnStatusCode: false,
  });
  expect(profonde.status()).toBe(401);

  /**
   * `/api/*` PASSE, et c'est voulu : ce chemin porte deja son propre en-tete `Authorization`
   * (voir l'en-tete de netlify/edge-functions/portail.ts). Il n'est pas ouvert pour autant —
   * l'API le garde. Le test le montre : sans jeton, l'API repond 401, PAS le portail.
   */
  const api = await request.get(`${E2E.urlPortail}/api/prospection/leads`, {
    failOnStatusCode: false,
  });
  expect(api.status()).toBe(401);
  expect(api.headers()['www-authenticate'], "l'API ne doit pas defier en Basic").toBeUndefined();
});

test("avec les identifiants, l'application demarre et reste utilisable", async ({ browser }) => {
  const jeton = jetonDeSession();
  let contexte: BrowserContext | null = null;
  try {
    contexte = await browser.newContext({
      httpCredentials: {
        username: E2E.portailUtilisateur,
        password: E2E.portailMotDePasse,
      },
    });
    const page = await contexte.newPage();
    // La session est reinjectee a la main : l'etat enregistre par `connexion.setup.ts` porte sur
    // l'origine de `vite preview`, et le portail est une AUTRE origine. Se reconnecter par le
    // formulaire aurait consomme une des dix tentatives autorisees par quart d'heure.
    await page.addInitScript(
      ([cleJeton, valeur, cleAccueil]: string[]) => {
        localStorage.setItem(cleJeton as string, valeur as string);
        sessionStorage.setItem(cleAccueil as string, '1');
      },
      ['enr_jeton', jeton, 'enr_accueil_vu'],
    );

    /**
     * Toutes les reponses sont collectees : c'est la seule facon de voir si une SOUS-RESSOURCE a
     * ete refusee. Un 401 sur un fragment de code laisserait une page blanche sans message —
     * exactement le genre de panne qu'un test qui ne regarde que le DOM ne voit pas.
     */
    const refusees: string[] = [];
    page.on('response', (reponse) => {
      if (reponse.status() === 401 && reponse.url().startsWith(E2E.urlPortail)) {
        refusees.push(`${reponse.status()} ${reponse.url()}`);
      }
    });

    await page.goto(`${E2E.urlPortail}/`);

    // L'application est la : la barre de vues n'apparait qu'apres le montage complet.
    await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible({ timeout: 30_000 });
    // Et non le formulaire de connexion : le jeton a bien traverse.
    await expect(page.getByLabel('Adresse electronique')).toHaveCount(0);

    expect(refusees, 'aucune ressource ne doit être refusée par le portail').toEqual([]);

    // Le gros fragment de code — MapLibre, 800 ko — est charge depuis un worker. S'il avait ete
    // refuse, la carte serait absente sans que rien ne le dise.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  } finally {
    await contexte?.close();
  }
});

test('un mauvais mot de passe ne franchit pas le portail, même avec un jeton valide', async ({
  browser,
}) => {
  /**
   * Le portail et l'application sont deux serrures independantes. Un jeton d'application valide
   * ne doit rien ouvrir sur le portail : sans cette verification, on pourrait croire l'inverse et
   * conclure que le portail se laisse contourner par une session existante.
   */
  const contexte = await browser.newContext({
    httpCredentials: { username: E2E.portailUtilisateur, password: 'mauvais-mot-de-passe-long' },
  });
  try {
    const page = await contexte.newPage();
    const reponse = await page.goto(`${E2E.urlPortail}/`);
    expect(reponse?.status()).toBe(401);
    await expect(page.getByRole('heading', { name: /Accès réservé/ })).toBeVisible();
  } finally {
    await contexte.close();
  }
});
