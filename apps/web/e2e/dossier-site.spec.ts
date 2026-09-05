/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE DOSSIER DE SITE, DU CLIC AU FICHIER — la chaine que rien d'autre ne traverse
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE LES AUTRES TESTS COUVRENT DEJA, ET CE QU'ILS NE PEUVENT PAS COUVRIR.
 * `apps/api/test/dossier-site.test.ts` verifie le CONTENU du PDF, jusqu'a la somme des surfaces —
 * mais par `app.inject`, c'est-a-dire sans navigateur, sans selection et sans bouton. Or entre le
 * document produit et le fichier qui atterrit chez l'operateur, il y a une case a cocher, un etat
 * partage, un bouton desactive tant que la selection est vide, un `fetch` avec jeton, un `Blob` et
 * un lien clique par le code. Aucun de ces maillons n'est exerce ailleurs, et le premier d'entre
 * eux — la case a cocher — n'existait pas il y a une heure.
 *
 * LE PIEGE PARTICULIER DE CE BOUTON, et la raison pour laquelle son etat DESACTIVE est teste avant
 * son etat actif : il agit sur `idusSelectionnes`, un etat qui vit dans le magasin et survit aux
 * changements de vue. Un bouton actif sans selection enverrait un corps `idus: []`, que la route
 * refuse en 400 — l'operateur verrait « Export impossible » sans comprendre qu'il lui manquait une
 * case a cocher.
 */

import { expect, test } from '@playwright/test';
import { ouvrirListe, seConnecter } from './aides.js';

test('LA CHAINE COMPLETE : cocher deux parcelles produit un dossier PDF telecharge', async ({
  page,
}) => {
  await seConnecter(page);
  await ouvrirListe(page);

  const bouton = page.getByRole('button', { name: /Dossier développeur/ });

  // --- Sans selection, la commande existe mais ne part pas
  await expect(
    bouton,
    'le bouton doit rester visible sans selection : une commande qui apparait seulement une fois ' +
      'la bonne case cochee ne se decouvre jamais',
  ).toBeVisible();
  await expect(
    bouton,
    'sans selection, le bouton doit etre desactive : un envoi vide serait refuse en 400 et ' +
      'l’operateur ne saurait pas qu’il lui manquait une case',
  ).toBeDisabled();

  // --- On retient deux parcelles
  const cases = page.locator('.tableau tbody input[type="checkbox"]');
  const total = await cases.count();
  expect(total, 'la base de bout en bout doit porter au moins deux parcelles qualifiees').toBeGreaterThan(1);
  await cases.nth(0).check();
  await cases.nth(1).check();

  // Le compteur dit ce qui partira : c'est la seule verification possible AVANT l'envoi.
  await expect(bouton).toContainText('(2)');
  await expect(bouton).toBeEnabled();

  // --- Et le fichier arrive
  const attente = page.waitForEvent('download');
  await bouton.click();
  const telechargement = await attente;
  expect(telechargement.suggestedFilename()).toMatch(/^dossier-site-.*\.pdf$/);

  const flux = await telechargement.createReadStream();
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(Buffer.from(m as Buffer));
  const pdf = Buffer.concat(morceaux);

  /*
   * Le contenu est verifie ailleurs, en extrayant le texte. Ici on verifie ce qui ne peut se
   * verifier qu'ici : que le navigateur a recu un PDF entier, et non une page d'erreur JSON
   * servie avec le bon nom de fichier — le cas exact ou l'operateur croit tenir son dossier.
   */
  expect(pdf.subarray(0, 5).toString('latin1'), 'en-tete PDF attendu').toBe('%PDF-');
  expect(pdf.subarray(-1024).toString('latin1'), 'le PDF doit etre complet (%%EOF)').toContain('%%EOF');
  expect(pdf.length, 'un dossier de deux parcelles fait plusieurs pages').toBeGreaterThan(10_000);

  // --- « vider » rend le bouton inoffensif : l'operateur peut defaire sa selection
  await page.getByRole('button', { name: 'vider' }).click();
  await expect(bouton).toBeDisabled();
});
