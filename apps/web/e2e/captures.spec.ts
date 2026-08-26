/**
 * Captures d'ecran des vues principales — outil de revue, pas de verification.
 *
 * POURQUOI CE FICHIER EXISTE. Juger l'ergonomie et l'esthetique d'une interface suppose de la REGARDER.
 * Ce fichier produit les images ; il n'affirme rien et n'echoue que si une vue ne s'affiche pas du tout.
 * Il est marque `@revue` pour rester hors de la suite ordinaire : `npx playwright test --grep @revue`.
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

  // 3. La fiche seule.
  const fiche = page.locator('.panneau-droit, .fiche').first();
  await fiche.screenshot({ path: `${SORTIE}/03-fiche.png` }).catch(() => undefined);

  // 4. Liste.
  await ouvrirListe(page);
  await page.screenshot({ path: `${SORTIE}/04-liste.png` });

  // 5. Tableau de bord.
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: /tableau/i }).click();
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/05-tableau-de-bord.png` });

  // 6. Panneau gauche (couches, filtres) sur la carte.
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: /carte/i }).click();
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
