/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * L'OUTIL DE RECHERCHE PAR CRITERES, DE BOUT EN BOUT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QU'UN TEST DE RENDU NE PEUT PAS PROUVER, ET QUI EST POURTANT L'ESSENTIEL ICI. Les tests de
 * `apps/web/test/rendu-recherche-criteres.test.ts` rendent le composant avec des donnees POSEES : ils
 * verifient les phrases, pas la chaine. Or ce que le proprietaire demande est une chaine complete —
 * « je rentre mes criteres dans un outil de recherche, et la l'outil me scanne tout un departement
 * pour me sortir les parcelles propices ». Entre le formulaire et les parcelles il y a la
 * validation du corps JSON, quatre conditions SQL et un chemin JSONB, et chacun peut rompre sans
 * erreur :
 *
 *   - un champ absent de `filtresValides` fait REFUSER le corps entier en 400 : le formulaire
 *     cesse de fonctionner, et un test de rendu n'en voit rien ;
 *   - une condition SQL neutralisee rend la base entiere, presentee comme filtree.
 *
 * Seul un navigateur qui coche une case et lit le tableau qui s'ensuit le tranche.
 *
 * CE FICHIER MESURE DONC TROIS CHOSES : que le critere PART (aucune requete refusee), qu'il AGIT
 * (le nombre de resultats change dans le bon sens), et que l'ecran DIT sur quoi il porte.
 */

import { expect, test } from '@playwright/test';
import { seConnecter } from './aides.js';

/**
 * La case « uniquement en ZAER » du formulaire de balayage.
 *
 * DESIGNEE PAR SON ROLE, ET IL A FALLU LE MESURER. `getByLabel(/zone d.accélération/i)` renvoyait
 * DEUX elements : la case du formulaire, et le CURSEUR DE PONDERATION `p-urb_zaer` du panneau de
 * gauche, dont le libelle est « Zone d'accélération des ENR ». Playwright a refuse en mode strict,
 * ce qui est le bon comportement — mais un selecteur ambigu qui aurait par chance designe le
 * curseur aurait fait passer un test qui ne verifie rien. Le role tranche.
 */
const caseZaer = (page: import('@playwright/test').Page) =>
  page.getByRole('checkbox', { name: /Uniquement en zone d.accélération/i });

/** Passe a la vue « Recherche » et attend que le formulaire soit monte. */
async function ouvrirRecherche(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Recherche' }).click();
  await expect(page.getByRole('region', { name: 'Recherche de foncier par critères' })).toBeVisible();
  const borne = page.getByLabel('Limiter à la zone affichée');
  if (await borne.isChecked()) await borne.uncheck();
  await attendreResultats(page);
  await expect(page.getByRole('table')).toBeVisible();
}

/**
 * Attend que la recherche ait rendu son verdict — tableau OU message de liste vide.
 *
 * POURQUOI CETTE ATTENTE EXISTE, ET CE QU'ELLE N'EST PAS. Ce n'est pas une pause : c'est une
 * attente sur un ETAT OBSERVABLE, la disparition du tourniquet. Elle a ete ajoutee apres une mesure
 * et non par precaution — un `expect(getByRole('table')).toBeVisible()` pose juste apres le
 * decochage de la borne a expire au bout des 10 s par defaut, alors que la capture d'echec montrait
 * le tableau BIEN PRESENT avec ses 301 resultats. Cote serveur, mesure a part : la requete de liste
 * repond en 92 ms puis 46 ms, et `/api/territoires` en 21 ms. Le temps n'etait donc pas dans la
 * base mais dans le rendu de 300 lignes de dix colonnes par React, dans un conteneur charge.
 *
 * Attendre le tourniquet plutot que le tableau evite deux erreurs : accuser le serveur d'une
 * lenteur de rendu, et surtout confondre « encore en cours » avec « aucun resultat » — les deux se
 * presentent comme une absence de tableau.
 */
async function attendreResultats(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('.chargement')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('table, .vide').first()).toBeVisible({ timeout: 30_000 });
}

/** Nombre de lignes du tableau de resultats. */
async function nbLignes(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('tbody tr').count();
}

test('LE FORMULAIRE DE CRITERES EST ATTEIGNABLE ET PORTE LES QUATRE CRITERES DEMANDES', async ({
  page,
}) => {
  await seConnecter(page);
  await ouvrirRecherche(page);

  // Les quatre entrees nommees dans la demande : surface, territoire, typologie, zone.
  await expect(page.getByLabel('Surface minimale par parcelle (ha)')).toBeVisible();
  await expect(page.getByLabel('Région')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agrivoltaïsme' })).toBeVisible();
  await expect(caseZaer(page)).toBeVisible();

  /*
   * LE SELECTEUR DE REGIONS EST ALIMENTE PAR L'API, non code en dur dans l'interface. Un selecteur
   * vide serait la signature d'une route `/api/territoires` cassee — et l'operateur ne pourrait
   * plus balayer aucun territoire, sans le moindre message.
   */
  const options = page.getByLabel('Région').locator('option');
  // 18 regions plus l'entree « toute la base ».
  expect(await options.count()).toBe(19);
  await expect(options.filter({ hasText: 'Centre-Val de Loire' })).toHaveCount(1);
});

test('UN CRITERE DE TERRITOIRE PART REELLEMENT, ET RESTREINT LE RESULTAT', async ({ page }) => {
  await seConnecter(page);

  /*
   * L'ECOUTE EST PASSIVE, comme dans `ouvrirListe` et pour la meme raison : elle enregistre au vol
   * ce que l'API a repondu, sans ajouter d'attente au chemin de succes. Ce qu'elle sert a prouver
   * est le point le plus facile a casser sans le voir — un champ absent de `filtresValides` fait
   * repondre 400 « champ inconnu », et le tableau se vide comme s'il n'y avait rien a trouver.
   */
  const statuts: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/recherche/parcelles')) statuts.push(r.status());
  });

  await ouvrirRecherche(page);
  const avant = await nbLignes(page);
  expect(avant, 'la base semee doit porter des parcelles qualifiees').toBeGreaterThan(0);

  /*
   * UN DEPARTEMENT OU LA BASE SEMEE N'A RIEN. Le jeu de bout en bout est seme sur un seul secteur :
   * un autre departement doit donc rendre zero ligne ET afficher le bandeau qui dit pourquoi. C'est
   * la verification la plus importante de ce fichier, parce que c'est le contresens d'origine.
   */
  const jamaisBalaye = page
    .locator('.balayage-dep')
    .filter({ hasText: 'jamais balayé' })
    .first();
  await expect(jamaisBalaye).toBeVisible();
  const nomJamaisBalaye = (await jamaisBalaye.textContent()) ?? '';
  await jamaisBalaye.locator('input[type="checkbox"]').check();

  await attendreResultats(page);
  await expect(page.locator('.couverture')).toBeVisible();
  await expect(page.locator('.couverture')).toContainText(/jamais été qualifié/i);
  expect(
    await nbLignes(page),
    `le departement « ${nomJamaisBalaye.trim()} » est annonce sans parcelle : la liste doit etre vide`,
  ).toBe(0);

  /*
   * ET AUCUNE REQUETE N'A ETE REFUSEE. Un 400 signalerait que le critere n'est pas valide cote
   * serveur : le tableau se serait vide pour une raison ETRANGERE au territoire, et le bandeau
   * aurait alors menti dans l'autre sens.
   */
  expect(statuts.length, 'au moins une recherche doit avoir ete emise').toBeGreaterThan(0);
  expect(
    statuts.filter((s) => s !== 200),
    'toute reponse non-200 signifie que le critere de territoire est refuse par la validation',
  ).toEqual([]);
});

test('« UNIQUEMENT EN ZAER » ET LE ZONAGE DU PLU SONT ACCEPTES PAR LE SERVEUR', async ({ page }) => {
  await seConnecter(page);

  const refus: Array<{ statut: number; corps: string }> = [];
  page.on('response', (r) => {
    if (!r.url().includes('/api/recherche/parcelles') || r.status() === 200) return;
    void r
      .text()
      .then((corps) => refus.push({ statut: r.status(), corps: corps.slice(0, 200) }))
      .catch(() => undefined);
  });

  await ouvrirRecherche(page);
  const total = await nbLignes(page);

  // 1. ZAER.
  await caseZaer(page).check();
  await attendreResultats(page);
  const enZaer = await nbLignes(page);
  expect(enZaer, 'un filtre ne peut pas ELARGIR le resultat').toBeLessThanOrEqual(total);
  await caseZaer(page).uncheck();
  await attendreResultats(page);

  // 2. Zonage du PLU, replie par defaut : il faut l'ouvrir, ce qui verifie aussi le pliage.
  await page.getByRole('button', { name: /le zonage du PLU/ }).click();
  await page.getByRole('button', { name: 'A — agricole' }).click();
  await attendreResultats(page);
  expect(await nbLignes(page)).toBeLessThanOrEqual(total);

  expect(
    refus,
    'un 400 signifie que `filtresValides` ne connait pas le critere : le formulaire est alors ' +
      'inutilisable, et rien a l’ecran ne le dit',
  ).toEqual([]);
});

test('CHOISIR UN TERRITOIRE LEVE LA RESTRICTION A L’EMPRISE DE LA CARTE', async ({ page }) => {
  await seConnecter(page);
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Recherche' }).click();
  await expect(page.getByRole('region', { name: 'Recherche de foncier par critères' })).toBeVisible();

  /*
   * DEUX DEMANDES CONTRADICTOIRES. « Balaie tout le departement » et « limite a la zone affichee »
   * ne peuvent pas etre vraies ensemble, et en SQL c'est la seconde qui gagne : le balayage ne
   * porterait que sur l'ecran, silencieusement. Choisir un territoire doit donc lever la borne.
   *
   * Le test la COCHE d'abord, pour ne pas dependre de l'etat par defaut ni d'une preference
   * enregistree.
   */
  const borne = page.getByLabel('Limiter à la zone affichée');
  if (!(await borne.isChecked())) await borne.check();
  await expect(borne).toBeChecked();

  // Par VALEUR et non par libelle : le libelle porte le nombre de parcelles qualifiees
  // (« Centre-Val de Loire — 301 parc. »), qui depend de la base semee. 24 est le code INSEE de
  // la region, stable.
  await page.getByLabel('Région').selectOption('24');
  await expect(borne).not.toBeChecked();
  // Et le pied de formulaire cesse d'annoncer la restriction.
  await expect(page.locator('.balayage-pied')).not.toContainText(/limité à la zone affichée/i);
});
