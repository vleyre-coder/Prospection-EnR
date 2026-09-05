/**
 * Captures d'ecran des vues principales — outil de revue, pas de verification.
 *
 * POURQUOI CE FICHIER EXISTE. Juger l'ergonomie et l'esthetique d'une interface suppose de la REGARDER.
 * Ce fichier produit les images ; il n'affirme rien et n'echoue que si une vue ne s'affiche pas du tout.
 * Il est marque `@revue` pour rester hors de la suite ordinaire :
 * `E2E_REVUE=1 npx playwright test --grep @revue`.
 *
 * LA MARQUE NE SUFFISAIT PAS, et c'est le portail d'acces qui l'a revele. `npx playwright test`
 * n'applique aucune exclusion : ce fichier tournait donc dans la suite ordinaire, et dans le job
 * de bout en bout de la CI, alors que son en-tete affirmait le contraire depuis sa creation. Une
 * affirmation sans mecanisme est un defaut a part entiere — d'autant qu'elle portait sur un
 * fichier qui ECHOUAIT (voir le commentaire de la capture 3). `test.skip` ci-dessous applique
 * enfin ce que cet en-tete promet.
 */

import { expect, test } from '@playwright/test';
import { ouvrirListe, seConnecter } from './aides.js';

const SORTIE = 'captures';

/**
 * Une carte ne devient JAMAIS « networkidle » : elle recharge des tuiles a chaque mouvement, et le
 * relais du fond attend parfois un service externe. Ce fichier ne verifie rien — il produit des images
 * pour une revue humaine — donc une pause fixe y est legitime, la ou elle serait proscrite dans un test.
 */
async function laisserPeindre(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForTimeout(2500);
}

test.setTimeout(180_000);

/**
 * Hors de la suite ordinaire, pour de bon.
 *
 * `E2E_REVUE=1` est exige en plus de `--grep @revue` : c'est ce qui rend l'exclusion effective
 * quand la suite entiere est lancee sans filtre, tout en laissant la revue disponible d'une
 * commande. Un fichier de captures d'ecran n'a rien a garder — le faire echouer la CI, c'est
 * apprendre a l'equipe a ignorer un job rouge.
 */
test.skip(
  () => process.env['E2E_REVUE'] !== '1',
  'Outil de revue : E2E_REVUE=1 npx playwright test --grep @revue',
);

test('@revue captures des vues principales', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seConnecter(page);

  // 1. Carte, vue nationale (ce que l'on voit en arrivant).
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/01-carte-nationale.png` });

  // 2. Carte cadree sur une parcelle connue, avec sa fiche ouverte.
  const champ = page.getByRole('searchbox', { name: 'Recherche' });
  await champ.fill('28390 0A 94');
  const resultat = page.getByRole('option').first();
  await expect(resultat).toBeVisible({ timeout: 15_000 });
  await resultat.click();
  await expect(page.getByRole('heading', { name: /fiche parcelle/i })).toBeVisible({ timeout: 20_000 });
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/02-carte-fiche.png` });

  /**
   * 3. La fiche seule.
   *
   * LE `timeout` EST INDISPENSABLE, et son absence a fait echouer tout ce test. Aucune
   * `actionTimeout` n'est configuree dans ce depot : une action sans delai propre dispose donc de
   * TOUT le budget du test — ici 180 s. Une capture d'element attend que l'element soit stable
   * deux images de suite ; la fiche ne l'etait pas, la capture a consomme les 180 s, le `.catch`
   * a avale l'echec en silence, et l'action SUIVANTE — le clic sur « Liste » — a echoue sur un
   * budget deja epuise, avec pour seul symptome « Target page has been closed » a 130 lignes de
   * la vraie cause. Mesure : le meme clic, isole, aboutit en 2,2 s sur un bouton parfaitement
   * degage. Un `.catch` sans delai borne est un piege : il transforme une lenteur en panne
   * lointaine.
   */
  const fiche = page.locator('.panneau-droit, .fiche').first();
  await fiche
    .screenshot({ path: `${SORTIE}/03-fiche.png`, timeout: 10_000 })
    .catch(() => undefined);

  /*
   * 3 bis. Le bloc « Avant d'appeler le propriétaire ».
   *
   * Il vit bas dans la fiche — juste avant le bloc de prospection, la ou l'operateur passe a
   * l'acte — donc invisible sur une capture du haut de panneau. Or c'est precisement le bloc que
   * l'on veut relire : il porte ce que la parcelle reserve, et la question a poser.
   */
  const avant = page.locator('.avant-contact').first();
  if (await avant.count()) {
    await avant.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page
      .locator('.panneau-droite')
      .screenshot({ path: `${SORTIE}/09-avant-contact.png`, timeout: 10_000 })
      .catch(() => undefined);
  }

  // 4. Liste.
  await ouvrirListe(page);
  await page.screenshot({ path: `${SORTIE}/04-liste.png` });

  // 5. Tableau de bord.
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: /tableau/i }).click();
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/05-tableau-de-bord.png` });

  /*
   * 6. Panneau gauche sur la carte.
   *
   * L'ATTENTE N'EST PAS COSMETIQUE ICI. Le panneau interroge « les zones a prospecter » a chaque
   * montage, et il se remonte au retour depuis le tableau de bord — ou il n'est pas affiche. La
   * capture prise dans la foulee du clic montrait « Recherche des zones… » et non la liste : elle
   * documentait la latence, pas l'interface. La liste elle-meme est attendue explicitement, ce qui
   * vaut mieux qu'un delai fixe.
   */
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: /carte/i }).click();
  await page
    .locator('.liste-zones, .vide')
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined);
  await page.screenshot({ path: `${SORTIE}/06-carte-panneau.png` });
});

test('@revue capture en thème sombre et en écran étroit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/07-sombre.png` });

  await page.setViewportSize({ width: 900, height: 800 });
  await page.screenshot({ path: `${SORTIE}/08-etroit.png` });
});
