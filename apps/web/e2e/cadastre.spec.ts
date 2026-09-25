/**
 * La couche cadastrale est-elle REELLEMENT demandee par le navigateur ?
 *
 * POURQUOI CE FICHIER EXISTE — signalement d'usage. Une parcelle etait invisible parce que la carte ne
 * montrait que les parcelles DEJA qualifiees. Le correctif ajoute une couche relayant le Plan Cadastral
 * Informatise, qui couvre la France entiere. Or une source MapLibre declaree dans le style et jamais
 * demandee ne se distingue pas, a l'ecran, d'une source absente : les deux donnent une carte sans
 * parcelles. C'est exactement le mode de defaillance qui a produit le signalement.
 *
 * CE QUI EST OBSERVE : la REQUETE. Un test de bout en bout ne peut pas juger d'un pixel de contour gris,
 * mais il peut constater que le navigateur demande bien `/api/carte/cadastre/{z}/{x}/{y}.pbf` des que la
 * carte atteint le zoom parcellaire, et qu'il ne le fait PAS en vue nationale.
 *
 * CE QUI N'EST PAS OBSERVE, et il faut le dire : le contenu des tuiles. Le relais interroge
 * `data.geopf.fr`, injoignable depuis un runner de CI ; la reponse sera donc une erreur, et c'est sans
 * consequence pour ce que ce fichier verifie. La completude du cadastre est mesuree separement, par
 * `apps/api/scripts/verifier-relais-cadastre.ts`, sur cinq regions de France.
 */

import { expect, test } from '@playwright/test';
import { seConnecter } from './aides.js';

/**
 * Requetes de tuiles parties du navigateur, avec leur zoom : le CADASTRE, et le FOND DE CARTE.
 *
 * ═══ POURQUOI LE FOND EST SUIVI ALORS QUE LE TEST NE PORTE QUE SUR LE CADASTRE
 *
 * Ce test a echoue une fois sur trois executions, et l'artefact de l'echec a ete efface par la
 * reprise : impossible de savoir POURQUOI. Or l'echec « aucune tuile cadastrale apres cadrage »
 * recouvre deux causes de nature opposee :
 *
 *   1. la carte n'a jamais atteint le zoom parcellaire — le cadrage a echoue, ou l'animation n'a
 *      pas eu le temps d'aboutir. Le cadastre a raison de se taire, et ce n'est pas son defaut ;
 *   2. la carte y est arrivee et la couche cadastrale est restee muette. C'est le defaut que ce
 *      fichier existe pour attraper.
 *
 * Le fond de carte, lui, est demande a CHAQUE deplacement et porte son zoom dans l'URL. Le suivre
 * ne change rien a ce que le test accepte — il ne fait que rendre son echec lisible du premier
 * coup. Allonger un delai pour faire taire un symptome qu'on n'a pas diagnostique aurait ete
 * l'inverse : moins d'echecs, et plus rien pour comprendre le jour ou il revient.
 */
function suivreCadastre(page: import('@playwright/test').Page): {
  zooms: number[];
  zoomsFond: number[];
} {
  const zooms: number[] = [];
  const zoomsFond: number[] = [];
  page.on('request', (r) => {
    const m = /\/api\/carte\/cadastre\/(\d+)\/\d+\/\d+\.pbf/.exec(r.url());
    if (m) zooms.push(Number(m[1]));
    const f = /\/api\/carte\/fond\/[a-z]+\/(\d+)\/\d+\/\d+/.exec(r.url());
    if (f) zoomsFond.push(Number(f[1]));
  });
  return { zooms, zoomsFond };
}

test('EN VUE NATIONALE, aucune tuile cadastrale n’est demandée', async ({ page }) => {
  /**
   * Le garde-fou compte autant que la couche. Une tuile de cadastre en vue nationale pese des
   * megaoctets pour un rendu illisible, et le service amont est un bien commun : le relais refuse en
   * dessous du zoom parcellaire, et la source declare le meme plancher pour que la demande ne parte
   * meme pas.
   */
  const suivi = suivreCadastre(page);
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  // L'application s'ouvre cadree sur la France entiere : le zoom y est tres inferieur au plancher.
  expect(
    suivi.zooms,
    'des tuiles cadastrales ont été demandees en vue nationale : le plancher de zoom ne tient pas',
  ).toEqual([]);
});

test('AU ZOOM PARCELLAIRE, le navigateur demande les tuiles du cadastre COMPLET', async ({ page }) => {
  const suivi = suivreCadastre(page);
  await seConnecter(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();

  /**
   * On atteint le zoom parcellaire par la RECHERCHE, comme un utilisateur : taper la reference de la
   * parcelle semee, choisir le resultat, et laisser l'application cadrer dessus. Manipuler la carte par
   * du code injecte prouverait moins — c'est le chemin reel qui doit fonctionner.
   */
  const champ = page.getByRole('searchbox', { name: 'Recherche' });
  await champ.fill('28390 0A 94');
  const resultat = page.getByRole('option').first();
  await expect(resultat).toBeVisible({ timeout: 15_000 });
  await resultat.click();

  try {
    await expect.poll(() => suivi.zooms.length, { timeout: 20_000 }).toBeGreaterThan(0);
  } catch (err) {
    /*
     * LE MESSAGE DIT LAQUELLE DES DEUX CAUSES S'EST PRODUITE. Sans lui, l'echec se lit « aucune
     * tuile cadastrale » et laisse croire a un defaut de la couche, alors que la carte n'a
     * peut-etre jamais atteint le zoom ou elle se declenche.
     */
    const atteint = suivi.zoomsFond.length > 0 ? Math.max(...suivi.zoomsFond) : null;
    throw new Error(
      'Aucune tuile cadastrale demandée après cadrage sur une parcelle.\n' +
        (atteint == null
          ? 'Et AUCUNE tuile de fond non plus : la carte n’a rien chargé — le cadrage lui-même a ' +
            'échoué, et le cadastre n’est pas en cause.'
          : atteint < 12
            ? `La carte n’a atteint que le zoom ${atteint}, en dessous du plancher parcellaire (12) : ` +
              'le cadrage n’a pas abouti dans le délai imparti, et le cadastre a raison de se taire.'
            : `La carte a bien atteint le zoom ${atteint}, au-delà du plancher parcellaire : la couche ` +
              'du cadastre complet n’est donc pas active, et les parcelles non qualifiées restent ' +
              'invisibles. C’est le défaut que ce fichier surveille.'),
      { cause: err },
    );
  }

  // Et toutes au zoom parcellaire ou au-dela : le plancher s'applique aussi ici.
  expect(Math.min(...suivi.zooms)).toBeGreaterThanOrEqual(12);
});
