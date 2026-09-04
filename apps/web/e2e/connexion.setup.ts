/**
 * Se connecter UNE FOIS pour toute la suite, et conserver la session.
 *
 * POURQUOI, ET C'EST L'APPLICATION QUI A RAISON. Ma premiere version connectait chaque specification
 * par le formulaire. La onzieme echouait, systematiquement, sans rapport avec ce qu'elle verifiait : la
 * route de connexion est limitee a **dix tentatives par quinze minutes et par adresse**, et onze
 * connexions en une minute atteignent le plafond.
 *
 * La tentation aurait ete de relever le plafond, ou de l'exempter en test. Ce serait affaiblir une
 * protection reelle — contre le bourrinage de mots de passe — pour arranger un outil de verification.
 * C'est exactement l'inversion a ne pas commettre : **le test s'adapte a l'application, jamais
 * l'inverse.**
 *
 * Le remede est aussi la pratique recommandee par Playwright et, accessoirement, bien plus rapide : une
 * connexion, un etat de session enregistre, et toutes les specifications en partent.
 *
 * L'ETAT DE SESSION NE PORTE QUE `localStorage`. `sessionStorage` n'y est pas conserve, ce qui tombe
 * bien : l'ecran d'ouverture se souvient d'avoir ete vu dans `sessionStorage`, donc chaque contexte le
 * revoit — et `accueil.spec.ts` peut l'observer sans avoir a se reconnecter.
 */

import { expect, test as setup } from '@playwright/test';
import { E2E, FICHIER_ETAT_SESSION } from '../playwright.config.js';

setup('connexion unique, session conservée', async ({ page }) => {
  await page.goto('/');

  const champEmail = page.getByLabel('Adresse électronique');
  await expect(champEmail).toBeVisible({ timeout: 30_000 });
  await champEmail.fill(E2E.email);
  await page.getByLabel('Mot de passe').fill(E2E.motDePasse);
  await page.getByRole('button', { name: /se connecter/i }).click();

  // La connexion n'est acquise que quand l'application est la : un formulaire qui reste affiche
  // signalerait un identifiant refuse, et il vaut mieux l'apprendre ici qu'au premier parcours.
  await expect(page.getByRole('group', { name: 'Vue' })).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: FICHIER_ETAT_SESSION });
});
