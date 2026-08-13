/**
 * La couche cadastrale est-elle REELLEMENT demandee par le navigateur ?
 *
 * POURQUOI CE FICHIER EXISTE — signalement d'usage. Une parcelle etait invisible parce que la carte ne
 * montrait que les parcelles DEJA qualifiees. Le correctif ajoute une couche relayant le Plan Cadastral
 * Informatise, qui couvre la France entiere. Or une source MapLibre declaree dans le style et jamais
 * demandee ne se distingue pas, a l'ecran, d'une source absente : les deux donnent une carte sans
 * parcelles. C'est exactement le mode de defaillance qui a produit le signalement.
 *
 * CE QUI EST OBSERVE : la REQUETE. Un test de bout en bout ne peut pas juger d'un pixel de contour gris,
 * mais il peut constater que le navigateur demande bien `/api/carte/cadastre/{z}/{x}/{y}.pbf` des que la
 * carte atteint le zoom parcellaire, et qu'il ne le fait PAS en vue nationale.
 *
 * CE QUI N'EST PAS OBSERVE, et il faut le dire : le contenu des tuiles. Le relais interroge
 * `data.geopf.fr`, injoignable depuis un runner de CI ; la reponse sera donc une erreur, et c'est sans
 * consequence pour ce que ce fichier verifie. La completude du cadastre est mesuree separement, par
 * `apps/api/scripts/verifier-relais-cadastre.ts`, sur cinq regions de France.
 */

import { expect, test } from '@playwright/test';
import { seConnecter } from './aides.js';

/** Requetes de tuiles cadastrales parties du navigateur, avec leur zoom. */
function suivreCadastre(page: import('@playwright/test').Page): { zooms: number[] } {
  const zooms: number[] = [];
  page.on('request', (r) => {
    const m = /\/api\/carte\/cadastre\/(\d+)\/\d+\/\d+\.pbf/.exec(r.url());
    if (m) zooms.push(Number(m[1]));
  });
  return { zooms };
}

test('EN VUE NATIONALE, aucune tuile cadastrale n’est demandee', async ({ page }) => {
  /**
   * Le garde-fou compte autant que la couche. Une tuile de cadastre en vue nationale pese des
   * megaoctets pour un rendu illisible, et le service amont est un bien commun : le relais refuse en
   * dessous du zoom parcellaire, et la source declare le meme plancher pour que la demande ne parte
   * meme pas.
   */
  const suivi = suivreCadastre(page);
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  // L'application s'ouvre cadree sur la France entiere : le zoom y est tres inferieur au plancher.
  expect(
    suivi.zooms,
    'des tuiles cadastrales ont ete demandees en vue nationale : le plancher de zoom ne tient pas',
  ).toEqual([]);
});

test('AU ZOOM PARCELLAIRE, le navigateur demande les tuiles du cadastre COMPLET', async ({ page }) => {
  const suivi = suivreCadastre(page);
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  /**
   * On atteint le zoom parcellaire par la RECHERCHE, comme un utilisateur : taper la reference de la
   * parcelle semee, choisir le resultat, et laisser l'application cadrer dessus. Manipuler la carte par
   * du code injecte prouverait moins — c'est le chemin reel qui doit fonctionner.
   */
  const champ = page.getByRole('searchbox', { name: 'Recherche' });
  await champ.fill('28390 0A 94');
  const resultat = page.getByRole('option').first();
  await expect(resultat).toBeVisible({ timeout: 15_000 });
  await resultat.click();

  await expect
    .poll(() => suivi.zooms.length, {
      message:
        'aucune tuile cadastrale demandee apres cadrage sur une parcelle : la couche du cadastre ' +
        'complet n’est pas active, et les parcelles non qualifiees restent invisibles',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // Et toutes au zoom parcellaire ou au-dela : le plancher s'applique aussi ici.
  expect(Math.min(...suivi.zooms)).toBeGreaterThanOrEqual(12);
});
