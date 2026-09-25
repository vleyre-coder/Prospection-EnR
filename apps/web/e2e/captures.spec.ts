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
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ATTENDRE QUE LA CARTE AIT FINI DE SE PEINDRE, et non un delai au juge
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, audit 13. Ce fichier attendait 2 500 ms fixes, au motif — juste — qu'une
 * carte ne devient jamais « networkidle ». Mais en vue NATIONALE, MapLibre demande une trentaine de
 * tuiles, et le relais `/api/carte/fond/` les rend en 150 ms a une seconde chacune selon la charge
 * de l'IGN, sur deux connexions : la carte met de trois a quinze secondes a se peindre. La capture
 * partait avant.
 *
 * Le resultat n'etait pas une image imparfaite, c'etait une image FAUSSE : la capture de la vue
 * nationale montrait une France blanche, sans aucun fond, ou l'on pouvait croire a un relais casse.
 * Un outil dont le seul role est de donner a REGARDER l'interface, et qui la photographie a moitie
 * peinte, ne remplit pas son office — et il a fini par faire echouer sa propre suite, une fois sur
 * deux, pour un depassement de delai qui n'apprenait rien.
 *
 * LA REGLE RETENUE : la quiescence du RELAIS, pas celle du reseau. On attend qu'aucune tuile de fond
 * ne soit revenue depuis `CALME_MS`, ce qui est exactement « la carte a fini de charger ce qu'elle
 * avait a charger » — et reste vrai quand un service externe est lent, puisque c'est le retour des
 * reponses qui est observe, pas leur depart.
 *
 * IL FAUT AVOIR VU UNE PREMIERE TUILE AVANT DE PARLER DE CALME, et cette ligne est payee par un
 * second echec, de ma main, une heure apres le premier. Une mesure de quiescence seule confond deux
 * etats opposes : « plus rien n'arrive parce que tout est charge » et « rien n'est encore arrive ».
 * Depuis ce poste, l'IGN met environ une seconde par tuile ; la premiere revenait APRES la fenetre
 * de calme, la boucle sortait aussitot, et la capture montrait une carte entierement vide — plus
 * fausse encore que celle qu'elle corrigeait. C'est la meme faute que celle traquee dans toute
 * l'application : une absence prise pour un resultat.
 *
 * LA FENETRE DE CALME EST PLUS LARGE QUE L'INTERVALLE ENTRE DEUX TUILES, faute de quoi elle se
 * declenche au milieu du chargement : quand l'IGN rend une tuile en une seconde et que MapLibre
 * n'ouvre que deux connexions, l'ecart entre deux reponses frole la seconde en regime NORMAL. A
 * 1 500 ms, la vue nationale sortait tantot complete (1,7 Mo), tantot amputee (1,2 Mo), d'une
 * execution a l'autre ; a 2 500 ms, trois executions rendent 1,66, 1,51 et 1,67 Mo.
 *
 * CE QUI RESTE VRAI MALGRE CE REGLAGE, et qu'il faut savoir en lisant une capture : sur un reseau
 * lent, MapLibre peut renoncer a une tuile sans qu'aucune reponse ne l'annonce. Aucune mesure cote
 * reseau ne distingue alors « abandonnee » de « jamais demandee ». La vue nationale, qui en demande
 * une trentaine d'un coup, reste donc la plus exposee — et c'est pourquoi ce fichier reste un outil
 * de revue, qu'un humain regarde, et non un garde qui affirmerait quelque chose.
 *
 * Le plafond, lui, empeche une attente sans fin quand le relais ne repond jamais : on capture alors
 * ce qu'il y a, ce qui reste le comportement utile pour un outil de revue.
 */
const CALME_MS = 2500;
const GRACE_MS = 6000;
const PLAFOND_MS = 60_000;

async function laisserPeindre(page: import('@playwright/test').Page): Promise<void> {
  let derniereTuile = 0;
  let nbTuiles = 0;
  /*
   * TOUTES LES TUILES, pas seulement le fond. Premiere version de ce garde : elle n'observait que
   * `/api/carte/fond/`, le relais raster. Les couches VECTORIELLES — communes, cadastre, parcelles
   * qualifiees — passent par `/api/carte/tuiles/`, et la capture du theme sombre montrait un
   * rectangle de fond nu au milieu de la France, la ou la tuile communale n'etait pas encore
   * arrivee. Un calme mesure sur une seule des deux familles n'est pas un calme.
   */
  const surReponse = (r: import('@playwright/test').Response): void => {
    if (!r.url().includes('/api/carte/')) return;
    derniereTuile = Date.now();
    nbTuiles += 1;
  };
  page.on('response', surReponse);
  try {
    /*
     * PREMIER TEMPS : LA CARTE A-T-ELLE SEULEMENT QUELQUE CHOSE A CHARGER ?
     *
     * Toutes les vues capturees ne demandent pas de tuiles. Ouvrir un panneau sur une carte deja
     * peinte n'en demande aucune : les precedentes sont en cache. Sans ce premier temps, la boucle
     * de quiescence attendait alors le plafond ENTIER — soixante secondes par capture — puis
     * ecrivait un avertissement alarmant sur une situation parfaitement normale. Mesure : une des
     * captures de la derniere execution a consomme le plafond avec zero tuile servie.
     *
     * Une attente de grace courte suffit a trancher : si rien n'est parti au bout de quelques
     * secondes, il n'y avait rien a attendre.
     */
    const graceFin = Date.now() + GRACE_MS;
    while (nbTuiles === 0 && Date.now() < graceFin) {
      await page.waitForTimeout(250);
    }
    if (nbTuiles === 0) return;

    // SECOND TEMPS : attendre que le flot se tarisse.
    const limite = Date.now() + PLAFOND_MS;
    while (Date.now() < limite) {
      await page.waitForTimeout(250);
      if (Date.now() - derniereTuile >= CALME_MS) return;
    }
    // Le plafond a ete atteint : on le DIT, sinon une capture amputee passerait pour un choix.
    process.stderr.write(
      `# capture : plafond de ${PLAFOND_MS} ms atteint apres ${nbTuiles} tuile(s) servie(s) — ` +
        'la vue capturee peut etre incomplete\n',
    );
  } finally {
    page.off('response', surReponse);
  }
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

  /*
   * 3 ter. LE BLOC DES EXPORTS.
   *
   * C'EST DESORMAIS LA PARTIE LA PLUS CHANGEANTE DE LA FICHE — quatre commandes la ou il y en
   * avait trois, et chacune porte maintenant un etat d'attente, puisque la preparation d'un
   * document illustre demande plusieurs secondes de reseau. Aucune capture ne la montrait : la
   * correction ne se relisait donc pas, ce qui est exactement le reproche que cet outil se fait a
   * lui-meme pour la vue « recherche ».
   */
  const exports = page.locator('.bloc-exports').first();
  if (await exports.count()) {
    await exports.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await exports
      .screenshot({ path: `${SORTIE}/12-exports.png`, timeout: 10_000 })
      .catch(() => undefined);
  }

  // 4. Liste.
  await ouvrirListe(page);
  await page.screenshot({ path: `${SORTIE}/04-liste.png` });

  /*
   * 4 bis. La liste AVEC une selection.
   *
   * L'etat par defaut ne montre ni le liseré des lignes retenues, ni le compteur, ni le bouton
   * « Dossier développeur » actif : trois choses de mise en page qui n'existent qu'une fois des
   * cases cochees, et qu'aucune capture ne donnait donc a relire.
   */
  const cases = page.locator('.tableau tbody input[type="checkbox"]');
  const aCocher = Math.min(2, await cases.count());
  for (let i = 0; i < aCocher; i += 1) await cases.nth(i).check();
  if (aCocher > 0) {
    await laisserPeindre(page);
    await page.screenshot({ path: `${SORTIE}/10-liste-selection.png` });
  }

  /*
   * 4 bis. LE FORMULAIRE DE RECHERCHE PAR CRITERES.
   *
   * CETTE VUE N'ETAIT CAPTUREE NULLE PART, et c'est un trou de l'outil de revue lui-meme : des
   * quatre vues de la barre — Carte, Liste, Recherche, Tableau de bord —, seule la troisieme
   * manquait. C'est pourtant celle ou l'operateur POSE ses criteres, donc celle qui oriente tout
   * le reste du travail. Un outil de revue qui ne montre pas une vue sur quatre laisse ses defauts
   * hors de portee du seul controle qui les verrait.
   *
   * Elle est aussi la vue ou vivent les pastilles de typologie, dont l'ambiguite « Agrivoltaisme »
   * a ete corrigee par cet audit : sans capture, la correction ne se relit pas.
   */
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: /recherche/i }).click();
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/11-recherche.png` });

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

  /*
   * REDIMENSIONNER, C'EST REDEMANDER DES TUILES. La capture etroite partait immediatement apres
   * le changement de taille : MapLibre venait de decouvrir une nouvelle emprise et n'avait pas
   * encore recu les tuiles correspondantes. L'image montrait une moitie de France coloree et
   * l'autre nue — un defaut de rendu apparent la ou il n'y avait qu'une capture trop rapide.
   */
  await page.setViewportSize({ width: 900, height: 800 });
  await laisserPeindre(page);
  await page.screenshot({ path: `${SORTIE}/08-etroit.png` });
});
