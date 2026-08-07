/**
 * Aides communes aux tests de bout en bout.
 *
 * Trois regles y sont appliquees, et elles expliquent la forme du code plus bas.
 *
 * 1. **Aucune attente arbitraire.** Pas un seul `waitForTimeout`. Chaque attente porte sur un etat
 *    OBSERVABLE — un element visible, une reponse recue. C'est la seule discipline qui empeche un parc
 *    de tests de bout en bout de devenir intermittent, et l'intermittence est ce qui fait qu'on cesse
 *    de les lancer.
 * 2. **Les selecteurs passent par les roles et les libelles**, pas par les classes CSS. Une classe est
 *    un detail de presentation : un test qui s'y accroche casse au premier remaniement de style, ce qui
 *    apprend a ignorer ses echecs. Un role et un libelle sont ce que l'utilisateur percoit.
 * 3. **La connexion passe par le vrai formulaire.** `AUTH_DESACTIVEE` aurait ete plus court, mais il
 *    donne un administrateur habilite aux donnees de proprietaire et court-circuite l'ecran que
 *    l'utilisateur voit en premier.
 */

import { expect, type Page, type Request } from '@playwright/test';

/**
 * Clé de session marquant l'ecran d'ouverture comme deja vu.
 *
 * L'animation d'accueil se superpose a l'application pendant deux secondes et abrege au premier clic
 * ou a la premiere touche. Elle a fait echouer six specifications avant d'etre comprise : les clics
 * partaient dans le vide, avec pour seul symptome un depassement de delai sur `locator.click` — un
 * message qui n'oriente vers rien.
 *
 * Elle est donc neutralisee dans les parcours, et couverte par une specification dediee
 * (`accueil.spec.ts`) : la desactiver sans la tester ailleurs reviendrait a retirer de la couverture un
 * composant que tout utilisateur voit en premier.
 */
const CLE_ACCUEIL_VU = 'enr_accueil_vu';

/**
 * Ouvre l'application, session DEJA acquise.
 *
 * LA CONNEXION N'A PLUS LIEU ICI. Elle est faite une fois par `e2e/connexion.setup.ts`, dont l'etat de
 * session est reinjecte dans chaque contexte : la route de connexion est limitee a dix tentatives par
 * quinze minutes, et onze specifications qui se connectaient chacune atteignaient le plafond — la
 * onzieme echouait alors pour une raison etrangere a ce qu'elle verifiait. Relever le plafond aurait
 * affaibli une protection reelle pour arranger un outil de verification : le test s'adapte a
 * l'application, jamais l'inverse.
 *
 * Si le formulaire apparait malgre tout, c'est un ECHEC et non un cas a rattraper silencieusement :
 * cela signifie que l'etat de session n'a pas ete pris, et un parcours qui se reconnecte tout seul
 * masquerait la cause.
 *
 * `neutraliserAccueil` a `false` laisse l'ecran d'ouverture apparaitre, et `attendreApplication` a
 * `false` rend la main avant que la barre de vues soit la : `accueil.spec.ts` vient observer cette
 * animation, et attendre l'application rendrait l'observation dependante de la vitesse de la machine.
 */
export async function seConnecter(
  page: Page,
  {
    neutraliserAccueil = true,
    attendreApplication = true,
  }: { neutraliserAccueil?: boolean; attendreApplication?: boolean } = {},
): Promise<void> {
  if (neutraliserAccueil) {
    await page.addInitScript((cle: string) => {
      sessionStorage.setItem(cle, '1');
    }, CLE_ACCUEIL_VU);
  }
  await page.goto('/');

  if (!attendreApplication) return;

  const champEmail = page.getByLabel('Adresse electronique');
  const barreVues = page.getByRole('group', { name: 'Vue' });

  /**
   * Attendre que l'application ait TRANCHE, puis exiger qu'elle soit authentifiee.
   *
   * Trois etats sont possibles juste apres `goto` : l'ecran de chargement, le formulaire de connexion,
   * ou l'application. Interroger l'un des trois trop tot donnait des echecs intermittents selon la
   * charge de la machine — le mode de defaillance le plus couteux d'un parc de tests de bout en bout,
   * parce qu'il apprend a ignorer les echecs.
   */
  await expect(champEmail.or(barreVues).first()).toBeVisible({ timeout: 30_000 });
  await expect(
    champEmail,
    'le formulaire de connexion est apparu : l’etat de session n’a pas ete pris',
  ).toBeHidden();
  await expect(barreVues).toBeVisible({ timeout: 30_000 });
}

/** Passe a la vue liste, en levant la restriction a l'emprise de la carte. */
export async function ouvrirListe(page: Page): Promise<void> {
  await page.getByRole('group', { name: 'Vue' }).getByRole('button', { name: 'Liste' }).click();

  /**
   * La liste se borne par defaut a l'emprise affichee — c'est une correction voulue (une liste qui
   * presentait des parcelles a 200 km de la carte n'avait aucun sens). Un test qui demarre sur une
   * carte centree ailleurs verrait donc une liste vide, pour une raison parfaitement legitime. On leve
   * la borne explicitement plutot que de deplacer la carte, ce qui serait plus fragile.
   */
  const borne = page.getByLabel('Limiter a la zone affichee');
  if (await borne.isChecked()) await borne.uncheck();

  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();
}

/**
 * Ouvre la fiche de la premiere parcelle de la liste, et renvoie la reponse d'API correspondante.
 *
 * La reponse est capturee AU VOL, telle que le navigateur l'a recue. C'est le point entier de ces
 * tests : comparer l'ecran a ce que l'API a REELLEMENT renvoye, et non a ce qu'un second appel
 * renverrait — deux appels peuvent differer, et la comparaison perdrait alors sa valeur de preuve.
 */
export async function ouvrirPremiereFiche(page: Page): Promise<{
  idu: string;
  fiche: FicheApi;
}> {
  const premiere = page.locator('tbody tr').first();
  const attente = page.waitForResponse(
    (r) => /\/api\/parcelles\/[^/?]+\?/.test(r.url()) && r.status() === 200,
  );
  await premiere.click();
  const reponse = await attente;
  const fiche = (await reponse.json()) as FicheApi;
  await expect(page.getByRole('heading', { name: /fiche parcelle/i })).toBeVisible();
  return { idu: fiche.parcelle.idu, fiche };
}

export interface CritereApi {
  id: string;
  libelle: string;
  valeurAffichee: string;
  feu: string;
  note: number | null;
  poids: number;
}

export interface FicheApi {
  parcelle: { idu: string; nomCommune: string | null; section: string; numero: string };
  score: {
    statut: string;
    scoreGlobal: number | null;
    criteres: CritereApi[];
    knockOuts: Array<{ libelle: string; motif: string }>;
    limitesViabilite: Array<{ libelle: string; motif: string }>;
  };
}

/**
 * Requetes reseau parties du navigateur, METHODE COMPRISE.
 *
 * La methode et non le chemin, et la nuance a fait echouer une specification. Ma premiere version
 * reperait les ecritures a leur URL, avec un motif incluant `qualification` : elle signalait donc
 * `GET /api/qualification/etat`, qui est une route de LECTURE — elle rapporte l'avancement d'une
 * campagne. Le test accusait le code d'un defaut inexistant.
 *
 * Une ecriture se reconnait a son verbe, pas a son chemin. C'est aussi plus sur : une route d'ecriture
 * ajoutee demain sous un nom imprevu sera couverte sans qu'on ait a penser a elargir un motif.
 */
export function surveillerRequetes(page: Page): {
  requetes: Array<{ methode: string; url: string }>;
} {
  const requetes: Array<{ methode: string; url: string }> = [];
  page.on('request', (r: Request) => {
    if (r.url().includes('/api/')) requetes.push({ methode: r.method(), url: r.url() });
  });
  return { requetes };
}
