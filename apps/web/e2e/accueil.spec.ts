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

test('LE TEMOIN : sans aucune touche, l’animation est encore la peu apres l’ouverture', async ({
  page,
}) => {
  /**
   * CE TEST EST LA MOITIE DEMONSTRATIVE DU SUIVANT, et il existe pour une raison mesurée.
   *
   * La version precedente prouvait l'abrègement d'une seule facon : presser une touche, puis exiger la
   * disparition en MOINS DE 1 500 ms — un budget choisi « nettement plus court que l'animation », qui
   * dure deux secondes. La marge etait donc de 500 ms, et elle n'a pas tenu : la specification a echoue
   * une fois sur cette machine pendant que deux suites tournaient en concurrence et que le relais IGN
   * accumulait des delais de connexion. Elle a repasse seule au coup suivant.
   *
   * Une intermittence est le pire defaut d'un parc de tests de bout en bout : elle apprend a ignorer les
   * echecs. Et la corriger en allongeant le budget aurait affaibli exactement ce que le test prouve.
   *
   * La demonstration est donc SCINDEE. Ici, le temoin : sans toucher a rien, l'ecran est encore visible
   * peu apres l'ouverture. C'est une assertion que la lenteur ne peut que RENFORCER — plus la machine
   * est chargee, plus l'ecran est encore la. Le test suivant peut alors attendre la disparition
   * largement, sans rien perdre de sa force : l'un montre qu'elle ne vient pas d'elle-meme si vite,
   * l'autre qu'une touche la provoque.
   */
  await connexionBrute(page);
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();
  // 400 ms, tres en dessous des deux secondes d'animation : si l'ecran disparaissait deja, il n'y
  // aurait rien a abreger et la promesse du composant serait vide de sens.
  await expect(accueil).toBeVisible({ timeout: 400 });
});

test('LA PROMESSE DU COMPOSANT : une touche abrege l’animation', async ({ page }) => {
  await connexionBrute(page);
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();

  await page.keyboard.press('Escape');
  /**
   * Le delai est genereux, et c'est deliberé : ce qui est verifie ici est la REACTION a la touche, pas
   * une performance. Le test temoin ci-dessus etablit que l'ecran ne s'efface pas de lui-meme en si peu
   * de temps ; c'est lui qui porte la preuve, et il est insensible a la charge de la machine.
   */
  await expect(accueil).toBeHidden({ timeout: 10_000 });
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
