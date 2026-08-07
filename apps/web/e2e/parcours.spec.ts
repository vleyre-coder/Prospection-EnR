/**
 * Le parcours reel, dans un vrai navigateur, contre la vraie API.
 *
 * CE QUE CE FICHIER EST SEUL A PROUVER. Les tests de rendu montent les composants un par un ; ils ne
 * disent rien de l'assemblage. Avant ce fichier, **aucun test du projet ne prouvait que l'application
 * demarre** : une erreur dans `main.tsx`, un import circulaire fatal, une variable
 * d'environnement figee de travers a la construction, une carte MapLibre qui leve — rien de tout cela
 * n'aurait fait echouer la CI.
 *
 * Le serveur d'interface est `vite preview`, donc le BUILD, et non `vite dev` : c'est le build qui part
 * en production, et ses modes d'echec lui sont propres.
 */

import { expect, test } from '@playwright/test';
import { ouvrirListe, ouvrirPremiereFiche, seConnecter, surveillerRequetes } from './aides.js';

test('l’application demarre, se connecte, et affiche la carte', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(m.text());
  });

  await seConnecter(page);

  // La carte est le coeur de l'application ; MapLibre y monte un canvas.
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  /**
   * AUCUNE ERREUR DE CONSOLE, et c'est une exigence a part entiere.
   *
   * L'audit 10 l'avait verifie a la main, une fois. Une erreur de console ne casse rien de visible —
   * une couche qui ne se charge pas, une propriete lue sur `undefined` dans un gestionnaire — mais elle
   * signale toujours quelque chose qui ne fonctionne pas comme prevu.
   *
   * Les echecs de tuiles sont tolerees : le fond cartographique est relaye vers un service externe, qui
   * peut etre injoignable depuis un runner de CI sans que l'application soit en faute.
   */
  const reelles = erreurs.filter((e) => !/tuile|tile|Failed to load resource|net::ERR/i.test(e));
  expect(reelles, `erreurs de console : ${reelles.join(' | ')}`).toEqual([]);
});

test('LA VERIFICATION DE L’AUDIT 10, RENDUE PERMANENTE : l’ecran affiche exactement ce que l’API renvoie', async ({
  page,
}) => {
  /**
   * L'audit 10 a compare les 29 criteres d'une fiche reelle a la reponse de l'API et n'a trouve aucun
   * ecart. C'etait sa conclusion la plus forte — « rien ne se perd entre le calcul et le lecteur » —
   * et elle reposait sur une verification manuelle, faite une fois, sur une parcelle.
   *
   * Ici, la reponse est capturee AU VOL pendant que la fiche s'ouvre, puis chaque critere est cherche
   * a l'ecran avec sa valeur. Aucun second appel : deux appels pourraient differer, et la comparaison
   * perdrait sa valeur de preuve.
   */
  await seConnecter(page);
  await ouvrirListe(page);
  const { fiche } = await ouvrirPremiereFiche(page);

  const criteres = fiche.score.criteres;
  expect(criteres.length, 'la fiche capturee doit porter des criteres').toBeGreaterThan(10);

  const texte = ((await page.locator('aside, .fiche, main').last().textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );

  const manquants: string[] = [];
  for (const c of criteres) {
    if (!texte.includes(c.libelle)) manquants.push(`libelle « ${c.libelle} »`);
    // La valeur affichee est ce que le prospecteur lit : c'est elle qui doit correspondre, pas la
    // valeur numerique brute.
    else if (c.valeurAffichee && !texte.includes(c.valeurAffichee)) {
      manquants.push(`valeur de « ${c.libelle} » : attendu « ${c.valeurAffichee} »`);
    }
  }
  expect(
    manquants,
    `${manquants.length} ecart(s) entre l’ecran et l’API sur ${criteres.length} criteres`,
  ).toEqual([]);
});

test('les motifs eliminatoires et les limites de viabilite atteignent l’ecran', async ({ page }) => {
  // Une parcelle peut etre ecartee sans qu'aucun chiffre ne le dise : ce sont les motifs qui portent
  // l'information, et ils ne doivent pas pouvoir disparaitre d'un rendu.
  await seConnecter(page);
  await ouvrirListe(page);
  const { fiche } = await ouvrirPremiereFiche(page);

  const texte = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');
  for (const ko of fiche.score.knockOuts) {
    expect(texte, `motif eliminatoire absent : ${ko.libelle}`).toContain(ko.motif.slice(0, 60));
  }
  for (const l of fiche.score.limitesViabilite) {
    expect(texte, `limite de viabilite absente : ${l.libelle}`).toContain(l.motif.slice(0, 60));
  }
});

test('la fiche n’ecrit aucun nombre a point decimal ni aucune date ISO', async ({ page }) => {
  /**
   * Le meme garde que les tests de rendu, mais applique cette fois a la page REELLEMENT rendue par un
   * navigateur, apres exécution des effets. Il attrape ce qu'un rendu serveur ne peut pas voir : une
   * valeur mise en forme dans un `useEffect`, ou par une bibliotheque tierce.
   */
  await seConnecter(page);
  await ouvrirListe(page);
  await ouvrirPremiereFiche(page);

  const texte = ((await page.locator('body').innerText()) ?? '').replace(/\s+/g, ' ');
  const decimaux = [...texte.matchAll(/(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g)]
    .map((m) => m[0])
    .filter((s) => s.split('.').length === 2);
  expect(decimaux, `nombres a point decimal a l’ecran : ${decimaux.join(', ')}`).toEqual([]);

  const iso = [...new Set(texte.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  expect(iso, `dates ISO a l’ecran : ${iso.join(', ')}`).toEqual([]);
});

test('LE CLAVIER SEUL SUFFIT, et le focus reste visible', async ({ page }) => {
  /**
   * Verifie a la main a l'audit 10 : 40 tabulations, 30 cibles, zero focus invisible. Rendu permanent.
   *
   * Le critere retenu n'est pas « un anneau de focus existe » — une regle CSS peut exister et etre
   * invisible — mais **l'element focalise a un contour dessine** : `outline` non nul, ou `box-shadow`,
   * ou une bordure. C'est mesure sur le style CALCULE, donc sur ce que le navigateur peint reellement.
   */
  await seConnecter(page);

  const invisibles: string[] = [];
  const cibles = new Set<string>();

  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const etat = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      const contour =
        (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
        (s.boxShadow !== 'none' && s.boxShadow !== '') ||
        parseFloat(s.borderTopWidth) > 0;
      return {
        cle: `${e.tagName}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').slice(0, 30)}`,
        contour,
        visible: e.offsetParent !== null || s.position === 'fixed',
      };
    });
    if (!etat) continue;
    cibles.add(etat.cle);
    if (etat.visible && !etat.contour) invisibles.push(etat.cle);
  }

  expect(cibles.size, 'le parcours clavier doit atteindre au moins dix cibles').toBeGreaterThan(9);
  expect(
    invisibles,
    `${invisibles.length} cible(s) focalisee(s) sans contour visible : ${invisibles.join(' | ')}`,
  ).toEqual([]);
});

test('la feuille d’impression deplie les sections et masque les commandes', async ({ page }) => {
  /**
   * Le rapport imprime depuis le navigateur est un livrable : il part chez un proprietaire. Une
   * section repliee a l'ecran doit s'imprimer DEPLIEE, sans quoi le document remis est incomplet — et
   * personne ne s'en apercoit avant de l'avoir imprime.
   */
  await seConnecter(page);
  await ouvrirListe(page);
  await ouvrirPremiereFiche(page);

  await page.emulateMedia({ media: 'print' });
  // Une regle d'impression doit exister et cibler : on verifie l'effet, pas la presence du CSS.
  const details = page.locator('details').first();
  if (await details.count()) {
    const ouvertEnImpression = await details.evaluate(
      (d) => getComputedStyle(d.querySelector('details > *:not(summary)') ?? d).display !== 'none',
    );
    expect(ouvertEnImpression, 'les sections doivent etre depliees a l’impression').toBe(true);
  }
  await page.emulateMedia({ media: 'screen' });
});

test('aucune requete inattendue ne part du navigateur pendant le parcours', async ({ page }) => {
  /**
   * Le defaut B4 de l'audit 10 etait un test qui declenchait une campagne d'enrichissement reelle —
   * 438 parcelles, 138 instantanes reecrits, a chaque `npm test`. Un test de bout en bout peut faire
   * la meme chose sans le vouloir : ouvrir une fiche declenche une qualification si l'instantane est
   * perime, et une qualification consomme le quota de sources publiques partagees par toute l'equipe.
   *
   * Le parcours ne doit donc solliciter que des routes de LECTURE. Ce n'est pas seulement une
   * precaution technique, c'est de la civilite envers des services publics gratuits.
   */
  const { requetes } = surveillerRequetes(page);
  await seConnecter(page);
  await ouvrirListe(page);
  await ouvrirPremiereFiche(page);

  /**
   * Une ecriture se reconnait a son VERBE. Deux exceptions, et une seule est legitime :
   *
   *   - `POST /api/auth/connexion` : se connecter est un POST, et c'est le point de depart du parcours ;
   *   - `POST /api/recherche/parcelles` : la recherche est un POST parce que ses filtres ne tiennent pas
   *     dans une URL. C'est une LECTURE deguisee en POST, et il faut le dire plutot que de laisser le
   *     verbe mentir sur la nature de l'operation.
   */
  const lecturesEnPost = /\/api\/(auth\/connexion|recherche\/)/;
  const ecritures = requetes.filter(
    (r) => r.methode !== 'GET' && r.methode !== 'HEAD' && !lecturesEnPost.test(r.url),
  );
  expect(
    ecritures,
    `le parcours de lecture a sollicite des ecritures : ${ecritures.map((r) => `${r.methode} ${r.url}`).join(' | ')}`,
  ).toEqual([]);
});
