/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE TELECHARGEMENT DES EXPORTS — la methode HTTP, et ce qu'elle emporte
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. La fiche parcelle etait un simple lien : `<a href=…>`, et le
 * navigateur faisait le reste. Depuis qu'elle porte des cartes, le serveur telecharge une
 * vingtaine de tuiles a l'IGN avant de rendre le document — plusieurs secondes pendant lesquelles
 * un onglet BLANC s'ouvrait sans rien dire. Elle passe donc par le meme chemin que les autres
 * exports, ce qui permet au bouton d'annoncer qu'il travaille.
 *
 * CE QUE CE PASSAGE RISQUAIT DE CASSER, et que rien d'autre ne verrait. Ce chemin etait ecrit pour
 * des routes POST : il posait systematiquement `method: 'POST'`, un en-tete `Content-Type` et un
 * corps JSON. La fiche, elle, est une route GET. Une requete GET porteuse d'un corps est refusee,
 * et le seul symptome serait un export qui ne marche plus — dans un bouton qu'aucun test de rendu
 * ne clique, puisque `renderToStaticMarkup` n'execute pas les evenements.
 *
 * LA VERIFICATION SE FAIT DONC SUR L'APPEL LUI-MEME, avec un `fetch` d'emprunt : c'est la seule
 * facon de voir ce qui part sur le reseau sans navigateur.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

/** La requete telle qu'elle partirait, capturee sans reseau. */
interface Capture {
  url: string;
  init: RequestInit;
}

let captures: Capture[] = [];
let fetchOriginal: typeof globalThis.fetch;

/**
 * UN DOM MINIMAL. Le telechargement cree un `<a download>` et le clique — c'est la seule facon
 * d'imposer un nom de fichier depuis un blob. Rien de tout cela n'existe sous Node, et installer
 * jsdom pour trois methodes serait une dependance de plus a maintenir pour une ligne de code.
 */
function poserDomMinimal(): void {
  const lien = { href: '', download: '', click: () => {}, remove: () => {} };
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: () => lien,
    body: { appendChild: () => {} },
  };
  URL.createObjectURL = () => 'blob:essai';
  URL.revokeObjectURL = () => {};
}

before(() => {
  poserDomMinimal();
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    captures.push({ url: String(url), init });
    return new Response(new Blob([new Uint8Array([1, 2, 3])]), { status: 200 });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = fetchOriginal;
});

/** Importe le client APRES la pose du DOM : il lit `localStorage` au chargement. */
async function client(): Promise<typeof import('../src/api/client.js')['api']> {
  (globalThis as Record<string, unknown>)['localStorage'] ??= {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  return (await import('../src/api/client.js')).api;
}

test('LA FICHE PDF PART EN GET, ET SANS CORPS', async () => {
  /**
   * LES DEUX MOITIES COMPTENT.
   *
   * La METHODE : la route est un GET. Un POST y recevrait 404, et l'operateur lirait « export
   * impossible » sur une route qui fonctionne parfaitement.
   *
   * LE CORPS : une requete GET porteuse d'un corps est refusee par la pile HTTP avant meme
   * d'atteindre l'application. C'est la faute la plus facile a commettre en generalisant un
   * chemin ecrit pour des POST — il suffit d'oublier de retirer le `body`, qui vaudrait alors
   * « undefined » serialise en JSON.
   */
  captures = [];
  const api = await client();
  await api.telechargerFiche('28399000ZC0123', 'solaire_sol');

  assert.equal(captures.length, 1, 'un seul appel');
  const [envoi] = captures;
  assert.ok(envoi);
  assert.match(envoi.url, /\/api\/exports\/parcelle\/28399000ZC0123\.pdf\?filiere=solaire_sol$/);
  assert.equal(envoi.init.method, 'GET');
  assert.equal(envoi.init.body, undefined, 'un GET ne doit porter aucun corps');
  assert.equal(
    (envoi.init.headers as Record<string, string> | undefined)?.['Content-Type'],
    undefined,
    'un GET sans corps ne doit pas annoncer un type de contenu',
  );
});

test('LES EXPORTS A SELECTION PARTENT TOUJOURS EN POST, AVEC LEUR CORPS', async () => {
  /*
   * LE CONTRE-EXEMPLE, sans lequel le garde precedent serait satisfait par un client qui aurait
   * bascule TOUS les exports en GET — et perdu la liste des parcelles en chemin. Le dossier de
   * site raisonne sur une selection : elle ne tient pas dans une URL, et sa perte produirait un
   * document vide plutot qu'une erreur.
   */
  captures = [];
  const api = await client();
  await api.exporter('dossier', { idus: ['A', 'B'], filiere: 'solaire_sol' }, 'dossier.pdf');

  const [envoi] = captures;
  assert.ok(envoi);
  assert.equal(envoi.init.method, 'POST');
  assert.equal((envoi.init.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(envoi.init.body)), {
    idus: ['A', 'B'],
    filiere: 'solaire_sol',
  });
});
