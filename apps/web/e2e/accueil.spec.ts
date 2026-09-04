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

test('l’écran d’ouverture apparaît, puis s’efface de lui-même', async ({ page }) => {
  await connexionBrute(page);
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();

  // Il s'efface seul : aucune attente arbitraire, on attend l'etat — sa disparition.
  await expect(accueil).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible();
});

test('LE TÉMOIN : sans aucune touche, l’animation est encore la peu après l’ouverture', async ({
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

test('l’écran d’ouverture ne revient pas dans la même session', async ({ page }) => {
  // Le reproche serait immediat s'il reapparaissait a chaque navigation : c'est la raison d'etre de la
  // cle de session.
  await connexionBrute(page);
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible();
  await expect(page.getByRole('status', { name: /ouverture de prospection/i })).toBeHidden();
});

test('L’ÉCRAN D’OUVERTURE N’EST PAS REMONTE au passage du chargement a l’application', async ({
  page,
}) => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * LA MUTATION QUE LES QUATRE TESTS CI-DESSUS NE VOYAIENT PAS — audit 11
   * ══════════════════════════════════════════════════════════════════════════════════════════
   *
   * `App.tsx` rend `Demarrage` a DEUX endroits : dans la branche de chargement et dans la
   * branche principale. React reconcilie par position ; si les deux structures ne s'alignent
   * pas, l'element change de parent au passage de l'une a l'autre, donc React le DEMONTE puis
   * le REMONTE. Ses deux minuteurs repartent de zero et ses ecouteurs sont reposes : l'animation
   * recommence au moment meme ou l'application devient prete, et une touche pressee avant la
   * transition est perdue. Le commentaire de la branche de chargement raconte ce defaut, et
   * l'alignement des deux structures le corrige.
   *
   * SAUF QUE RIEN NE LE VERIFIAIT. La mutation qui defait l'alignement — `Demarrage` sorti de
   * `div.application` dans un fragment — ne faisait echouer AUCUN des quatre tests
   * precedents : `1/2 mutations attrapees` dans le job de bout en bout. Et personne ne pouvait
   * le savoir, parce que ce job mourait avant, sur un refus de connexion (voir
   * `playwright.config.ts`). Une correction documentee, commentee sur vingt lignes, et sans
   * garde.
   *
   * POURQUOI LES QUATRE AUTRES NE POUVAIENT PAS LE VOIR. Ils observent l'ecran APRES la
   * transition, ou pressent une touche sans se soucier du moment. Or `Demarrage` abrege en
   * appelant `onTermine` tout de suite : une fois la touche prise en compte, l'ecran ne revient
   * jamais, remontage ou pas. Le symptome n'est visible que si l'on se place PENDANT le
   * chargement, et le seul moyen d'y etre a coup sur est de retenir la reponse du referentiel.
   *
   * CE QUE CE TEST AFFIRME, et pourquoi ce n'est pas un budget de temps. Mesurer « l'animation
   * a-t-elle recommence ? » demanderait un delai, donc une intermittence — le defaut le plus
   * couteux d'un parc de bout en bout. On observe donc la PROPRIETE que le correctif etablit :
   * aucun nouvel element d'accueil n'apparait au passage. Un observateur de mutations DOM,
   * installe juste avant la transition, compte les APPARITIONS. Zero attendu ; le remontage en
   * produit une. Aucun delai, aucune marge, aucune chance de passer par hasard.
   */
  let libererReferentiel: () => void = () => {};
  const referentielRetenu = new Promise<void>((resoudre) => {
    libererReferentiel = resoudre;
  });
  await page.route('**/api/referentiel*', async (route) => {
    await referentielRetenu;
    await route.continue();
  });

  await connexionBrute(page);

  // On est dans la branche de chargement, avec l'ecran d'ouverture par-dessus.
  await expect(page.getByText(/Chargement du référentiel/i)).toBeVisible({ timeout: 30_000 });
  const accueil = page.getByRole('status', { name: /ouverture de prospection/i });
  await expect(accueil).toBeVisible();

  // L'observateur est pose MAINTENANT : ce qui suit ne concerne plus que la transition.
  await page.evaluate(() => {
    const fenetre = window as unknown as { __apparitionsAccueil?: number };
    fenetre.__apparitionsAccueil = 0;
    new MutationObserver((lots) => {
      for (const lot of lots) {
        for (const noeud of lot.addedNodes) {
          if (!(noeud instanceof HTMLElement)) continue;
          if (noeud.matches('.accueil') || noeud.querySelector('.accueil')) {
            fenetre.__apparitionsAccueil = (fenetre.__apparitionsAccueil ?? 0) + 1;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  // La reponse arrive : l'application passe du chargement a la carte.
  libererReferentiel();
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible({ timeout: 30_000 });

  const apparitions = await page.evaluate(
    () => (window as unknown as { __apparitionsAccueil?: number }).__apparitionsAccueil ?? -1,
  );
  expect(
    apparitions,
    "l'écran d'ouverture a été remonte au passage du chargement a l'application : ses minuteurs " +
      'repartent de zéro, l’animation recommence, et une touche pressee avant la transition est ' +
      'perdue. Alignez la structure des deux branches de App.tsx.',
  ).toBe(0);
});
