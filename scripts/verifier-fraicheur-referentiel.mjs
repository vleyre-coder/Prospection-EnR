#!/usr/bin/env node
/**
 * Echoue si le referentiel reglementaire n'a pas ete revu depuis trop longtemps.
 *
 * POURQUOI. `REFERENTIEL_DERNIERE_VERIFICATION` porte la date a laquelle les seuils, les articles
 * de loi et les regimes d'autorisation ont ete confrontes aux textes en vigueur. C'est la seule
 * garantie que l'application ne raisonne pas sur du droit perime — et une date n'a de valeur que
 * si quelque chose la surveille. Sans ce controle, elle vieillit en silence et personne ne le voit.
 *
 * Le seuil est volontairement bas : le droit de l'urbanisme et de l'environnement bouge vite
 * (loi APER, decrets d'application, revisions de PLU). Six mois est une limite haute, pas un
 * objectif.
 */

import { readFileSync } from 'node:fs';

const DELAI_MAX_JOURS = 180;
const FICHIER = 'packages/core/src/reglementation.ts';

const source = readFileSync(FICHIER, 'utf8');
const m = /REFERENTIEL_DERNIERE_VERIFICATION = '(\d{4}-\d{2}-\d{2})'/.exec(source);
if (!m) {
  console.error(`ECHEC : REFERENTIEL_DERNIERE_VERIFICATION introuvable dans ${FICHIER}.`);
  process.exit(1);
}

const verification = new Date(`${m[1]}T00:00:00Z`);
if (Number.isNaN(verification.getTime())) {
  console.error(`ECHEC : date de verification illisible (« ${m[1]} »).`);
  process.exit(1);
}

const jours = Math.floor((Date.now() - verification.getTime()) / 86_400_000);
if (jours < 0) {
  console.error(`ECHEC : la date de verification (${m[1]}) est dans le futur.`);
  process.exit(1);
}

console.log(`Referentiel reglementaire verifie le ${m[1]}, il y a ${jours} jour(s).`);
if (jours > DELAI_MAX_JOURS) {
  console.error(
    `\nECHEC : le referentiel n'a pas ete revu depuis ${jours} jours (limite ${DELAI_MAX_JOURS}).\n\n` +
      "Ce n'est pas une formalite : l'application affiche des seuils et des articles de loi dans\n" +
      "des documents transmis a des tiers. Reprenez docs/REFERENTIEL.md, confrontez chaque regle\n" +
      'au texte en vigueur, puis mettez la date a jour dans ' + FICHIER + '.',
  );
  process.exit(1);
}
const reste = DELAI_MAX_JOURS - jours;
if (reste <= 30) {
  console.log(`Avertissement : revue a prevoir dans ${reste} jour(s).`);
}
