/**
 * Tests de bout en bout : la decision prise par le proprietaire du projet apres l'audit 10 (§G1).
 *
 * CE QU'ILS APPORTENT, ET QUE RIEN D'AUTRE N'APPORTE. Les tests de rendu montent les composants un a
 * un et verifient le texte produit ; ils ne disent rien de l'assemblage. **Aucun test ne prouve
 * aujourd'hui que l'application demarre.** Les six verifications navigateur de l'audit 10 — l'ecran
 * contre l'API sur 29 criteres, le parcours clavier, la feuille d'impression — ont ete conduites une
 * fois, a la main, sur une parcelle. Ce fichier les convertit en garde permanent.
 *
 * CE QU'ILS COUTENT, et il faut l'ecrire pour que la decision reste eclairee. Les tests de bout en bout
 * sont les plus fragiles du metier : ils dependent d'un navigateur, d'un serveur, d'une base peuplee et
 * du temps. Trois choix limitent cette fragilite :
 *
 *   1. **Ils ne font pas partie de `npm test`.** Un `npm test` doit rester rapide et sans
 *      infrastructure. Ceux-ci vivent dans `npm run e2e` et dans un job de CI distinct.
 *   2. **Ils s'arretent net si la base est vide**, avec un message qui le dit. Un test de bout en bout
 *      qui s'ignore en silence est pire qu'absent : il donne l'illusion d'une couverture.
 *   3. **Aucune attente arbitraire.** Pas de `waitForTimeout` : uniquement des attentes sur un etat
 *      observable. C'est la seule discipline qui empeche un parc de tests de devenir intermittent.
 *
 * LE NAVIGATEUR N'EST PAS TELECHARGE ICI. `PLAYWRIGHT_BROWSERS_PATH` designe une installation
 * existante dans cet environnement ; la CI, elle, appelle `npx playwright install chromium` dans son
 * propre job.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT_WEB = Number(process.env['E2E_PORT_WEB'] ?? 4180);
const PORT_API = Number(process.env['E2E_PORT_API'] ?? 3180);

/**
 * Le secret de signature et les identifiants du compte d'essai.
 *
 * Ecrits ici et nulle part ailleurs : ils ne valent que pour un serveur lance sur un port d'essai,
 * contre une base d'essai. `SECRET_JWT` est obligatoire hors developpement, d'ou sa presence.
 */
export const E2E = {
  portWeb: PORT_WEB,
  portApi: PORT_API,
  urlWeb: `http://127.0.0.1:${PORT_WEB}`,
  urlApi: `http://127.0.0.1:${PORT_API}`,
  secretJwt: 'secret-de-bout-en-bout-uniquement-non-production',
  email: 'e2e@local',
  motDePasse: 'motdepasse-e2e-1234',
} as const;

/**
 * Fichier d'etat de session, produit une fois par `e2e/connexion.setup.ts`.
 *
 * Il porte le jeton dans `localStorage`. Il est ignore par git : c'est un artefact d'execution, et il
 * contient un jeton — meme d'essai, un jeton n'a pas sa place dans un depot.
 */
export const FICHIER_ETAT_SESSION = './e2e/.auth/etat.json';

const baseDeDonnees =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/enr';

export default defineConfig({
  testDir: './e2e',
  // Les specifications partagent une base : les executer en parallele les ferait interferer sur les
  // memes parcelles. Le gain de temps ne vaut pas l'intermittence.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E.urlWeb,
    // La trace n'est conservee qu'a la premiere reprise : c'est ce qui rend un echec de CI
    // diagnosticable sans avoir a le reproduire localement.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    /**
     * Chemin du navigateur, seulement s'il est fourni — et au niveau GLOBAL.
     *
     * Playwright attend un build de Chromium precis, identifie par une revision liee a sa propre
     * version. Certains environnements fournissent un Chromium PREINSTALLE d'une autre revision :
     * Playwright refuse alors de demarrer et reclame `playwright install`, ce qui retelechargerait
     * 150 Mo pour rien.
     *
     * Place au niveau du projet, ce reglage ne s'appliquait pas au projet `setup`, qui a son propre
     * `use` : la connexion echouait donc avant tout le reste. Un reglage d'environnement vaut pour
     * TOUS les projets — sa place est ici.
     *
     * `E2E_CHROMIUM` reste VIDE en CI, ou `npx playwright install chromium` pose la revision exacte
     * attendue : le chemin par defaut est alors le bon, et rien n'est detourne.
     */
    ...(process.env['E2E_CHROMIUM']
      ? { launchOptions: { executablePath: process.env['E2E_CHROMIUM'] } }
      : {}),
  },

  projects: [
    /**
     * UNE SEULE CONNEXION POUR TOUTE LA SUITE.
     *
     * La route de connexion est limitee a dix tentatives par quinze minutes : onze specifications qui se
     * connectent chacune atteignaient le plafond, et la onziere echouait pour une raison etrangere a ce
     * qu'elle verifie. Relever le plafond aurait affaibli une protection reelle pour arranger un outil
     * de verification — l'inversion a ne pas commettre.
     */
    { name: 'setup', testMatch: /connexion\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: FICHIER_ETAT_SESSION,
      },
    },
  ],

  /**
   * Deux serveurs : l'API, puis l'interface construite et servie par `vite preview`.
   *
   * `vite preview` et non `vite dev` : c'est le BUILD qui part en production, et un test de bout en
   * bout qui n'exercerait que le serveur de developpement laisserait passer toute erreur propre au
   * bundle (imports dynamiques, decoupage des chunks, variables d'environnement figees a la
   * construction).
   *
   * AUTH_DESACTIVEE n'est PAS utilise. Ce mode donne un administrateur habilite aux donnees de
   * proprietaire, ce qu'un test n'a aucune raison d'obtenir : le parcours passe par le vrai formulaire
   * de connexion, avec un compte de LECTURE cree par `e2e/global-setup.ts`. Le garde qui interdit
   * AUTH_DESACTIVEE en production reste donc intact et non sollicite.
   */
  webServer: [
    {
      command: 'npx tsx src/serveur.ts',
      cwd: '../api',
      port: PORT_API,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        DATABASE_URL: baseDeDonnees,
        PORT: String(PORT_API),
        SECRET_JWT: E2E.secretJwt,
        NODE_ENV: 'test',
        AUTH_DESACTIVEE: 'false',
        /**
         * L'amorcage automatique est COUPE, et ce n'est pas un detail.
         *
         * Au demarrage, le serveur ingere les communes et le patrimoine depuis les API officielles.
         * Le laisser faire ici, c'est telecharger des dizaines de megaoctets a chaque execution des
         * tests, consommer le quota de services publics partages, et exposer la CI a chaque 503 d'un
         * tiers. La base d'essai est semee separement, hors reseau, par `scripts/semer-e2e.ts`.
         */
        AMORCAGE_AUTO: 'false',
        // L'origine de l'interface doit etre declaree, sinon le navigateur bloque les requetes.
        ORIGINES_AUTORISEES: E2E.urlWeb,
      },
    },
    {
      command: `npm run build && npx vite preview --port ${PORT_WEB} --strictPort`,
      cwd: '.',
      port: PORT_WEB,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { VITE_URL_API: `http://127.0.0.1:${PORT_API}` },
    },
  ],

  globalSetup: './e2e/global-setup.ts',
});
