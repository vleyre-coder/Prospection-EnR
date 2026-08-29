/**
 * L'ecran de demarrage de l'application de bureau, execute.
 *
 * POURQUOI TESTER UNE ANIMATION. Parce qu'elle a un role, et que ce role est trahi en silence
 * quand elle casse. Entre le double-clic et la carte il s'ecoule cinq secondes, une trentaine
 * a la premiere ouverture ; une fenetre noire pendant ce temps-la fait fermer la fenetre et
 * recommencer. Trois proprietes, donc, et aucune ne se verifie a l'oeil :
 *
 *   1. **Sans terminal, aucun caractere de controle.** La sortie est alors redirigee vers
 *      `journal.txt` — precisement le fichier qu'on lit quand quelque chose a mal tourne. Un
 *      journal farci de codes d'echappement est illisible au moment ou il faudrait le lire.
 *   2. **Une etape en echec ne se maquille pas.** L'erreur doit etre RELANCEE, pas avalee pour
 *      que l'ecran reste joli.
 *   3. **La roue ne retient pas le processus.** Une minuterie non liberee empeche l'application
 *      de rendre la main, et le symptome — une fenetre qui ne se ferme pas — n'oriente vers
 *      rien.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGES, Progression, banniere, duree } from '../../../scripts/portable/animation.mjs';

/** Flux d'ecriture minimal, qui retient tout ce qu'on lui envoie. */
function fluxFactice(): { write: (t: string) => boolean; texte: () => string } {
  const morceaux: string[] = [];
  return { write: (t: string) => (morceaux.push(t), true), texte: () => morceaux.join('') };
}

test('sans terminal, la sortie ne contient AUCUN caractere de controle', async () => {
  const flux = fluxFactice();
  let t = 1000;
  const p = new Progression({
    sortie: flux as never,
    interactif: false,
    maintenant: () => (t += 400),
  });
  await p.pendant('Preparation de la base', async () => undefined);
  await p.pendant('Demarrage du moteur', async () => 'port 54329');
  p.note('Une precision hors etape');

  const sortie = flux.texte();
  assert.doesNotMatch(sortie, /[\u001b\r]/, `codes de controle : ${JSON.stringify(sortie)}`);
  // Une ligne par etape, et l'etape est nommee avant d'etre finie : c'est ce qui rend un
  // blocage diagnosticable dans le journal.
  assert.match(sortie, /\.\.\. Preparation de la base\n/);
  assert.match(sortie, /✓ {2}Preparation de la base {2}\(0,4 s\)\n/);
  assert.match(sortie, /✓ {2}Demarrage du moteur — port 54329/);
  assert.match(sortie, /Une precision hors etape\n/);
});

test('sur un terminal, la ligne est reecrite sur place', async () => {
  const flux = fluxFactice();
  const p = new Progression({ sortie: flux as never, interactif: true, maintenant: () => 0 });
  p.demarrer('Chargement');
  p.reussi();
  const sortie = flux.texte();
  // Retour chariot + effacement de ligne : sans eux, chaque image de la roue laisserait une
  // ligne derriere elle et la fenetre defilerait sans fin.
  assert.match(sortie, /\r\u001b\[2K/);
  assert.ok(sortie.includes(IMAGES[0] as string), 'la premiere image de la roue doit etre peinte');
  assert.match(sortie, /✓ {2}Chargement/);
});

test('une etape en echec affiche une croix ET relance l’erreur', async () => {
  const flux = fluxFactice();
  const p = new Progression({ sortie: flux as never, interactif: false, maintenant: () => 0 });
  await assert.rejects(
    () => p.pendant('Demarrage du moteur', async () => {
      throw new Error('PostgreSQL ne repond pas\nligne suivante ignoree');
    }),
    /PostgreSQL ne repond pas/,
  );
  const sortie = flux.texte();
  assert.match(sortie, /✗ {2}Demarrage du moteur — PostgreSQL ne repond pas\n/);
  assert.doesNotMatch(sortie, /ligne suivante ignoree/, 'une seule ligne a l’ecran');
  assert.doesNotMatch(sortie, /✓/, 'aucune coche ne doit apparaitre sur un echec');
});

test('la roue ne retient pas le processus en vie', () => {
  /**
   * `unref()` sur la minuterie. Sans lui, l'application ne rendrait jamais la main : la
   * fenetre resterait ouverte apres la fermeture, et le symptome n'orienterait vers rien.
   */
  const flux = fluxFactice();
  const p = new Progression({ sortie: flux as never, interactif: true, maintenant: () => 0 });
  p.demarrer('Attente');
  /**
   * `finally` obligatoire, et la verification par mutation l'a impose. La premiere version
   * assertait puis appelait `p.reussi()`. En mutant `unref()`, l'assertion echouait AVANT
   * l'arret de la roue : l'intervalle restait actif, le processus de test ne rendait jamais la
   * main, et le script de mutation s'arretait sur un depassement de delai au lieu de compter
   * une mutation attrapee. Un test qui suspend le banc d'essai quand il echoue est presque
   * aussi nuisible qu'un test absent — on finit par le retirer.
   */
  try {
    const minuterie = (p as unknown as { minuterie: { hasRef?: () => boolean } }).minuterie;
    assert.ok(minuterie, 'une minuterie doit tourner pendant une etape');
    assert.equal(minuterie.hasRef?.(), false, 'la minuterie doit etre liberee (unref)');
  } finally {
    p.arreter();
  }
  p.reussi();
  assert.equal((p as unknown as { minuterie: unknown }).minuterie, null, 'et arretee ensuite');
});

test('les durees se lisent en francais et changent de precision', () => {
  assert.equal(duree(400), '0,4 s');
  assert.equal(duree(5200), '5,2 s');
  // Au-dela de dix secondes, la decimale n'apprend plus rien et encombre.
  assert.equal(duree(12400), '12 s');
  assert.equal(duree(59800), '60 s');
});

test('le bandeau tient dans une fenetre de console etroite', () => {
  /**
   * Une console Windows fait 80 colonnes par defaut. Un bandeau plus large se replierait et
   * afficherait un cadre casse a chaque ouverture — le tout premier ecran de l'application.
   */
  for (const ligne of banniere().split('\n')) {
    assert.ok([...ligne].length <= 78, `ligne trop large (${[...ligne].length}) : ${ligne}`);
  }
  assert.match(banniere(), /Prospection EnR/);
});
