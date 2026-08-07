/**
 * L'ecran d'ouverture : il apparait une fois par session, et il ne doit jamais retenir personne.
 *
 * POURQUOI IL MERITE SA PROPRE SPECIFICATION. Les parcours le neutralisent, parce qu'il se superpose a
 * l'application et faisait echouer six tests avec pour seul symptome un depassement de delai sur un
 * clic. Le neutraliser sans le tester ailleurs retirerait de la couverture le composant que TOUT
 * utilisateur voit en premier — et une animation bloquante qui n'abrege plus est un defaut
 * particulierement penible : elle ne casse rien, elle fait juste attendre, a chaque session, tout le
 * monde.
 *
 * Le commentaire du composant est explicite sur l'intention : « Toute touche ou tout clic abrege :
 * personne ne doit subir une animation. » C'est cette promesse qui est verifiee ici.
 */

import { expect, test, type Page } from '@playwright/test';
import { seConnecter } from './aides.js';

/**
 * Connexion SANS neutraliser l'accueil : c'est lui qu'on vient observer.
 *
 * L'aide partagee est reutilisee, avec l'option qui laisse l'animation apparaitre. Ma premiere version
 * avait ici sa propre routine de connexion — et elle a reproduit a l'identique le defaut corrige dans
 * l'aide : interroger le formulaire avant que l'application ait tranche entre chargement, connexion et
 * application. Deux copies d'une meme logique se corrigent une fois sur deux.
 */
async function connexionBrute(page: Page): Promise<void> {
  await seConnecter(page, { neutraliserAccueil: false, attendreApplication: false });
}

test('l’ecran d’ouverture apparait, puis s’efface de lui-meme', async ({ page }) => {
  await connexionBrute(page);
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();

  // Il s'efface seul : aucune attente arbitraire, on attend l'etat — sa disparition.
  await expect(accueil).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible();
});

test('LA PROMESSE DU COMPOSANT : une touche abrege l’animation', async ({ page }) => {
  await connexionBrute(page);
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();

  await page.keyboard.press('Escape');
  // Nettement plus court que la duree de l'animation : si la touche n'abregeait rien, l'attente
  // echouerait avant que l'animation ne se termine d'elle-meme.
  await expect(accueil).toBeHidden({ timeout: 1500 });
});

test('l’ecran d’ouverture ne revient pas dans la meme session', async ({ page }) => {
  // Le reproche serait immediat s'il reapparaissait a chaque navigation : c'est la raison d'etre de la
  // cle de session.
  await connexionBrute(page);
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible();
  await expect(page.getByRole('status', { name: /ouverture de prospection/i })).toBeHidden();
});
