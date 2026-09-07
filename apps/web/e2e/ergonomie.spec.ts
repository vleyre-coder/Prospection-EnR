/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * L'ENCOMBREMENT DE L'ECRAN, MESURE — et les titres du §12, qui ne doivent jamais etre coupes
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. Le proprietaire du projet a signale trois fois que l'affichage etait
 * « surchargé ». Les trois fois, la reponse a ete un remaniement ; les trois fois, rien n'a ete
 * MESURE, et rien n'empechait le chrome de regagner du terrain au remaniement suivant. Un jugement
 * d'ergonomie qui ne se mesure pas se re-argumente indefiniment.
 *
 * L'ETAT AVANT, mesure au navigateur juste apres la connexion, avant toute donnee :
 *
 *     1600 x 1000 : barre 98 + §12  88 + etat 31 = 217 px, soit 22 % de la fenetre
 *     1280 x  800 : barre 98 + §12 106 + etat 31 = 235 px, soit 29 % de la fenetre
 *
 * L'ETAT APRES le repliement du §12, meme protocole :
 *
 *     1600 x 1000 : barre 98 + §12 30 + etat 30 = 158 px (16 %)   carte 842 px
 *     1280 x  800 : barre 98 + §12 30 + etat 30 = 158 px (20 %)   carte 642 px
 *     1024 x  768 : barre 95 + §12 30 + etat 30 = 155 px (20 %)   carte 613 px
 *      820 x  700 : barre 95 + §12 30 + etat 30 = 155 px (22 %)   carte 545 px
 *
 * ═══ LE DEFAUT QUE CE FICHIER A TROUVE, ET QUI ETAIT LE MIEN
 *
 * Ma premiere version du bandeau replie portait `white-space: nowrap; text-overflow: ellipsis` sur
 * les titres, pour garantir une seule ligne. Les titres sont ce qui RESTE visible du §12 apres le
 * repliement : les couper aux trois points, c'est faire disparaitre la protection sans le dire. Le
 * defaut ne se voyait pas aux largeurs ou je mesurais — les titres occupent 608 px, et ils tiennent
 * jusqu'a 820 px de large. Il aurait attendu la premiere fenetre etroite.
 *
 * D'ou la forme de la premiere verification : elle balaye SIX largeurs, dont deux ou le texte ne
 * tient pas sur une ligne, et exige qu'aucune ne tronque. Apres correction, mesure : 30 px de haut
 * de 1600 a 820, 48 px (deux lignes) a 640 et 480, et `scrollWidth === clientWidth` partout.
 *
 * ═══ CE QUE CES SEUILS SONT
 *
 * Des PLAFONDS DE NON-REGRESSION, pas des cibles. Ils sont poses 12 px au-dessus de la mesure, de
 * quoi absorber une variation de police sans laisser passer une ligne entiere. Un echec ici ne veut
 * pas dire « c'est laid » : il veut dire que le chrome a repris de la place sur la carte, et que
 * quelqu'un doit dire si c'est voulu.
 */

import { expect, test } from '@playwright/test';
import { seConnecter } from './aides.js';

/** Les deux titres du §12, tels que `packages/core/src/avertissements.ts` les ecrit. */
const TITRES_GARDE = [
  'Aide à la décision, pas une garantie de faisabilité',
  'Les seuils réglementaires évoluent',
] as const;

/**
 * Largeurs balayees. Les deux dernieres sont sous le point ou les titres tiennent sur une ligne :
 * c'est precisement la que le defaut de troncature vivait, donc c'est la qu'il faut regarder.
 */
const LARGEURS = [1600, 1280, 1024, 820, 640, 480] as const;

test('LES TITRES DU §12 NE SONT JAMAIS TRONQUES, a aucune largeur', async ({ page }) => {
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  const titres = page.locator('.titres-avertissements');
  await expect(
    titres,
    'le bandeau du §12 doit etre affiche a la connexion — c’est la clause non negociable',
  ).toBeVisible();

  for (const titre of TITRES_GARDE) {
    await expect(
      titres,
      `le titre « ${titre} » doit rester visible SANS deplier : c’est lui qui porte la mise en garde`,
    ).toContainText(titre);
  }

  for (const largeur of LARGEURS) {
    await page.setViewportSize({ width: largeur, height: 700 });
    // Attente sur un etat observable : la largeur repercutee, jamais un delai.
    await expect
      .poll(async () => (await titres.boundingBox())?.width != null)
      .toBe(true);

    const m = await titres.evaluate((e) => ({
      client: e.clientWidth,
      scroll: e.scrollWidth,
      hauteur: Math.round(e.getBoundingClientRect().height),
      // Le texte reellement rendu : si un `text-overflow` coupait, il resterait entier ici, d'ou la
      // comparaison de largeurs plutot qu'une comparaison de chaines.
      texte: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }));

    /*
     * `scrollWidth > clientWidth` est le SEUL signe observable d'un `text-overflow: ellipsis` : le
     * texte du DOM reste entier, seul son rendu est coupe. Une comparaison de `textContent` aurait
     * donc passe alors que la moitie de l'avertissement etait invisible — c'est exactement comme
     * cela que mon defaut a survecu a une premiere serie de mesures.
     */
    expect(
      m.scroll,
      `a ${largeur} px de large, les titres du §12 sont tronques (${m.scroll} px de texte dans ` +
        `${m.client} px) : la protection disparait sans le dire`,
    ).toBeLessThanOrEqual(m.client + 1);

    for (const titre of TITRES_GARDE) {
      expect(m.texte, `titre « ${titre} » absent a ${largeur} px`).toContain(titre);
    }

    // Deux lignes au maximum : au-dela, le repliement n'aurait plus d'objet.
    expect(
      m.hauteur,
      `a ${largeur} px, les titres occupent ${m.hauteur} px — plus de deux lignes`,
    ).toBeLessThanOrEqual(52);
  }
});

test('LE CHROME NE REPREND PAS LA PLACE DE LA CARTE', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  const m = await page.evaluate(() => {
    const h = (s: string): number => {
      const e = document.querySelector(s);
      return e ? Math.round(e.getBoundingClientRect().height) : 0;
    };
    const carte = document.querySelector('canvas.maplibregl-canvas');
    return {
      barre: h('.barre-superieure') || h('header'),
      garde: h('.bandeau-garde'),
      etat: h('.bandeau-etat'),
      carte: carte ? Math.round(carte.getBoundingClientRect().height) : 0,
      fenetre: window.innerHeight,
    };
  });

  const chrome = m.barre + m.garde + m.etat;

  /*
   * PLAFOND MESURE : 158 px a 1280 x 800 (barre 98 + §12 30 + etat 30). Le seuil est a 170, soit
   * 12 px de marge — assez pour une variation de police, pas assez pour une ligne de texte.
   *
   * L'ETAT D'AVANT AURAIT ECHOUE ICI : 235 px. C'est le point du test.
   */
  expect(
    chrome,
    `chrome avant la carte : barre ${m.barre} + §12 ${m.garde} + etat ${m.etat} = ${chrome} px ` +
      `(mesure de reference 158 px). Si c’est voulu, la mesure de l’en-tete de ce fichier doit ` +
      `etre refaite et le seuil deplace explicitement.`,
  ).toBeLessThanOrEqual(170);

  // La carte doit garder au moins les trois quarts de la fenetre : c'est l'outil, le reste est du cadre.
  expect(
    m.carte / m.fenetre,
    `la carte n’occupe que ${((m.carte / m.fenetre) * 100).toFixed(0)} % de la fenetre`,
  ).toBeGreaterThan(0.75);
});

test('LE TEXTE ENTIER DU §12 EST A UN CLIC, et il ne demande pas de JavaScript', async ({ page }) => {
  await seConnecter(page);

  /*
   * POURQUOI UN `<details>` ET NON UN ETAT REACT. Le repliement est fait par l'element HTML, pas par
   * une variable d'etat : le texte est dans le document, atteignable par la recherche du navigateur
   * et par un lecteur d'ecran, et il se deplie meme si le script de la page a echoue. Un bloc
   * `{ouvert && <p>…</p>}` aurait rendu la protection dependante du bon fonctionnement du script —
   * pour un texte dont l'audit 8 dit qu'il est « la seule protection du lecteur ».
   */
  const bloc = page.locator('details.bandeau-garde');
  await expect(bloc).toBeVisible();
  await expect(bloc, 'le §12 doit s’ouvrir replie : c’est tout l’objet de la mesure').not.toHaveAttribute(
    'open',
    '',
  );

  const detail = bloc.locator('.bandeau-detail');
  await expect(detail, 'le texte complet ne doit pas etre visible avant le clic').toBeHidden();

  await bloc.locator('summary').click();
  await expect(detail).toBeVisible();

  // Le texte complet, pas seulement le titre : c'est ce que le repliement doit rendre accessible.
  await expect(detail).toContainText('Ils ne constituent en aucun cas une garantie de faisabilité');
  await expect(detail).toContainText('les seuils solaires ont été modifiés deux fois en deux ans');

  // Et le retrait definitif reste offert pour chacun des deux.
  await expect(detail.getByRole('button', { name: 'Retirer' })).toHaveCount(TITRES_GARDE.length);
});
