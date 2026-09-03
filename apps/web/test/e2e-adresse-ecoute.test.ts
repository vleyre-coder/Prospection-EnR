/**
 * UNE ADRESSE D'ECOUTE PAR DEFAUT N'EST PAS UNE ADRESSE.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * LE DEFAUT QUE CE FICHIER GARDE — audit 11
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le job de bout en bout de la CI echouait depuis huit livraisons, en douze secondes :
 *
 *     Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4180/
 *     1 failed, 19 did not run
 *
 * Et il passait en local, y compris en forçant `CI=1`. La ligne qui a tout expliqué etait dans
 * la sortie du serveur, dans le journal du runner :
 *
 *     [WebServer]   ➜  Local:   http://localhost:4180/
 *
 * `vite preview` s'attache par defaut a **`localhost`** et non a `127.0.0.1`. Sur le runner
 * GitHub, `localhost` resout d'abord vers `::1` : le serveur n'ecoutait donc qu'en IPv6, tandis
 * que les tests naviguent vers l'adresse IPv4 litterale de `E2E.urlWeb`. Sur ma machine,
 * `localhost` resout vers `127.0.0.1` — et c'est tout ce qui separait « ca marche chez moi » de
 * « rouge depuis huit livraisons ».
 *
 * Second volet du meme defaut, et il est plus insidieux : la sonde de disponibilite etait
 * declaree par `port`, ce qui laisse Playwright choisir l'adresse qu'il interroge. Elle etait
 * donc SATISFAITE pendant que le navigateur se faisait refuser la connexion. Une sonde qui
 * n'interroge pas l'adresse que les tests utilisent ne prouve rien.
 *
 * Ce fichier verifie les deux proprietes en lisant la configuration reelle. Il ne lance aucun
 * navigateur : c'est justement ce qui lui permet de tourner dans la suite unitaire, la ou le
 * defaut aurait ete vu huit livraisons plus tot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E } from '../playwright.config.js';

const RACINE_WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = readFileSync(join(RACINE_WEB, 'playwright.config.ts'), 'utf8');

/**
 * Les deux blocs `webServer`, decoupes sur `command:`, IDENTIFIES PAR LEUR RANG.
 *
 * Le rang et non le contenu, et c'est une lecon de la premiere execution de ce fichier : un
 * `find(b => b.includes('vite preview'))` rendait le bloc de l'API, parce que le long
 * commentaire qui precede la commande du serveur web — et qui parle de `vite preview` — tombe
 * dans le bloc precedent. Le test echouait donc en accusant la configuration, qui etait juste.
 * Reconnaitre un bloc a un mot qui peut apparaitre dans une phrase voisine ne marche pas.
 */
function blocsServeur(): { api: string; web: string } {
  const debut = CONFIG.indexOf('webServer: [');
  assert.notEqual(debut, -1, 'la configuration doit declarer des webServer');
  const blocs = CONFIG.slice(debut).split(/^ {6}command:/m).slice(1);
  assert.equal(blocs.length, 2, `deux serveurs attendus, ${blocs.length} trouve(s)`);
  const [api, web] = blocs as [string, string];
  // Temoin de l'ordre : si les deux entrees etaient inversees, tous les controles suivants
  // porteraient sur le mauvais serveur en passant au vert.
  assert.match(api.split('\n')[0] ?? '', /tsx src\/serveur\.ts/, "le premier serveur est l'API");
  assert.match(web.split('\n')[0] ?? '', /vite preview/, 'le second est la previsualisation web');
  return { api, web };
}

test('les adresses de test sont litterales et en IPv4', () => {
  /**
   * Le temoin de tout le reste. Si `E2E.urlWeb` valait `http://localhost:...`, la resolution
   * suivrait celle du serveur et le defaut n'existerait pas — mais on perdrait la maitrise de
   * ce qui est reellement teste, et le passage IPv4/IPv6 deviendrait invisible.
   */
  for (const url of [E2E.urlWeb, E2E.urlApi, E2E.urlPortail]) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/, `adresse non litterale : ${url}`);
  }
});

test('le serveur web s’attache EXPLICITEMENT a l’adresse que les tests visent', () => {
  const { web } = blocsServeur();
  assert.match(
    web,
    /--host 127\.0\.0\.1/,
    "sans `--host 127.0.0.1`, `vite preview` s'attache a `localhost` — donc a `::1` sur un " +
      'runner GitHub — et le navigateur, qui vise 127.0.0.1, se fait refuser la connexion. ' +
      'Constate en CI : rouge huit livraisons de suite, vert en local.',
  );
});

test('la sonde de disponibilite interroge l’adresse des tests, et pas une autre', () => {
  /**
   * `port:` laisse Playwright decider quelle adresse il interroge ; `url:` l'oblige a
   * interroger celle qu'on nomme. La difference n'est pas theorique : avec `port`, la sonde
   * etait satisfaite et les tests refuses.
   */
  const { api, web } = blocsServeur();
  for (const [nom, bloc] of [['API', api], ['serveur web', web]] as const) {
    assert.match(bloc, /^\s*url: `/m, `${nom} : la disponibilite doit etre sondee par \`url\``);
    assert.doesNotMatch(
      bloc,
      /^\s*port: /m,
      `${nom} : \`port\` laisse Playwright choisir l'adresse sondee, ce qui a masque le defaut`,
    );
  }
});

test('les deux sondes visent bien les adresses declarees dans E2E', () => {
  // Ceinture : `url` ne sert a rien s'il pointe ailleurs que les tests.
  const { api, web } = blocsServeur();
  assert.match(web, /url: `\$\{E2E\.urlWeb\}/, 'la sonde web doit viser E2E.urlWeb');
  assert.match(api, /url: `\$\{E2E\.urlApi\}/, 'la sonde API doit viser E2E.urlApi');
});
