/**
 * Le CSV REELLEMENT TELECHARGE par le navigateur, apres le changement de format.
 *
 * POURQUOI CE FICHIER, alors que `apps/api/test/exports.test.ts` verifie deja `csvResultats`. Parce
 * qu'entre la fonction qui produit la chaine et le fichier qui atterrit dans le dossier de
 * telechargements de l'utilisateur, il y a une route, un en-tete `Content-Disposition`, un
 * `Content-Type`, une reponse relayee par `fetch`, un `Blob`, et un lien clique par le code. Chacun de
 * ces maillons a deja casse au moins une fois dans la vie de ce projet.
 *
 * C'est aussi la seule preuve DE BOUT EN BOUT du changement de format decide par le proprietaire : ce
 * qui est verifie ici n'est pas le retour d'une fonction, c'est le contenu du fichier livre.
 */

import { expect, test } from '@playwright/test';
import { ouvrirListe, seConnecter } from './aides.js';

test('LE CHANGEMENT DE FORMAT, PROUVE SUR LE FICHIER LIVRE : le CSV telecharge est lisible en francais', async ({
  page,
}) => {
  await seConnecter(page);
  await ouvrirListe(page);

  const attente = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter en CSV' }).click();
  const telechargement = await attente;

  expect(telechargement.suggestedFilename()).toMatch(/\.csv$/);
  const flux = await telechargement.createReadStream();
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(Buffer.from(m as Buffer));
  const csv = Buffer.concat(morceaux).toString('utf8');

  // --- Le fichier est bien un CSV francais exploitable
  expect(csv.charCodeAt(0), 'la BOM UTF-8 est indispensable a Excel FR').toBe(0xfeff);
  const lignes = csv.trimEnd().split('\n');
  expect(lignes.length, 'le fichier doit contenir au moins une ligne de donnees').toBeGreaterThan(1);
  const entetes = lignes[0]!.replace('﻿', '').split(';');
  for (const attendu of ['IDU', 'Commune', 'Statut score', 'Longitude', 'Latitude']) {
    expect(entetes, `colonne « ${attendu} » manquante`).toContain(attendu);
  }

  // --- AUCUNE cle d'enumeration : le garde est structurel, il ne nomme aucune valeur
  const cellules = lignes.slice(1).flatMap((l) => l.split(';'));
  const cles = [...new Set(cellules.filter((c) => /^[a-z]+(?:_[a-z0-9]+)+$/.test(c)))];
  expect(
    cles,
    `cles d’enumeration encore livrees telles quelles : ${cles.join(', ')}`,
  ).toEqual([]);

  // --- Les coordonnees sont bornees
  const trop = [...new Set(csv.match(/\d+,\d{8,}/g) ?? [])];
  expect(trop, `nombres a precision excessive : ${trop.join(', ')}`).toEqual([]);

  const iLon = entetes.indexOf('Longitude');
  const premiere = lignes[1]!.split(';');
  expect(
    premiere[iLon],
    `longitude « ${premiere[iLon]} » : virgule decimale et six decimales attendues`,
  ).toMatch(/^-?\d+,\d{6}$/);

  // --- Et le statut est bien un libelle lisible, pris dans la liste des libelles connus
  const iStatut = entetes.indexOf('Statut score');
  const statuts = new Set(lignes.slice(1).map((l) => l.split(';')[iStatut]));
  const connus = new Set([
    'Propice',
    'Sous conditions / a etudier',
    'Score faible',
    'Donnees manquantes',
    'Redhibitoire',
    '',
  ]);
  for (const s of statuts) {
    expect(connus.has(s ?? ''), `statut inattendu dans le CSV livre : « ${s} »`).toBe(true);
  }
});
