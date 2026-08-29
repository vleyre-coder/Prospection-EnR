#!/usr/bin/env node
/**
 * L'ecran de demarrage de l'application de bureau.
 *
 * POURQUOI CE FICHIER EXISTE. Entre le double-clic et la carte, il se passe cinq secondes au
 * mieux, une trentaine a la premiere ouverture : PostgreSQL s'initialise, le schema s'applique,
 * les donnees de reference se restaurent. Une fenetre noire et muette pendant ce temps-la, ce
 * n'est pas un detail d'esthetique — c'est un utilisateur qui se demande si ca a plante, qui
 * ferme la fenetre, et qui recommence. L'attente doit se VOIR et se comprendre.
 *
 * DEUX RENDUS, ET C'EST NECESSAIRE. Sur un vrai terminal, une roue tourne et la ligne se
 * reecrit sur place. Ailleurs — sortie redirigee vers un fichier, journal d'integration
 * continue — les memes codes d'echappement produiraient un charabia illisible, et le fichier
 * de journal est justement ce qu'on lit quand quelque chose s'est mal passe. Le rendu sans
 * terminal ecrit donc une ligne par etape, sans un seul caractere de controle.
 *
 * Ce module ne connait rien de PostgreSQL ni de l'application : il recoit des libelles et des
 * promesses. C'est ce qui le rend testable sans rien demarrer.
 */

/** Roue d'attente. Braille : dense, fluide, et rendue par les polices de console de Windows 10+. */
export const IMAGES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const CADENCE_MS = 90;

/** Nettoie une duree pour l'affichage : « 0,4 s », « 12 s ». */
export function duree(ms) {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s)} s`;
}

/**
 * Le bandeau d'ouverture.
 *
 * Volontairement sobre : trois lignes. Une banniere en lettres d'art occuperait la moitie de
 * la fenetre et repousserait hors de vue les messages qui comptent — ceux qui disent ce qui se
 * passe et, le cas echeant, ce qui a echoue.
 */
export function banniere(largeur = 46) {
  const trait = '─'.repeat(largeur);
  return [
    '',
    `  ┌${trait}┐`,
    `  │  ${'Prospection EnR'.padEnd(largeur - 3)} │`,
    `  │  ${'aide a la decision fonciere'.padEnd(largeur - 3)} │`,
    `  └${trait}┘`,
    '',
  ].join('\n');
}

/**
 * Suit une suite d'etapes et les affiche.
 *
 * @param {{ sortie?: NodeJS.WriteStream, interactif?: boolean, maintenant?: () => number }} options
 */
export class Progression {
  constructor({ sortie = process.stdout, interactif = null, maintenant = Date.now } = {}) {
    this.sortie = sortie;
    // `isTTY` decide seul du rendu. Le parametre n'existe que pour les tests, qui doivent
    // pouvoir exercer les DEUX rendus sans dependre de l'environnement d'execution.
    this.interactif = interactif ?? Boolean(sortie.isTTY);
    this.maintenant = maintenant;
    this.minuterie = null;
    this.image = 0;
    this.libelle = '';
    this.debut = 0;
  }

  ecrire(texte) {
    this.sortie.write(texte);
  }

  /**
   * Efface la ligne courante. Sans terminal, il n'y a rien a effacer.
   *
   * Le code d'echappement est ecrit `\\u001b` et non colle litteralement : un caractere de
   * controle brut dans un source se perd au premier outil qui nettoie, et devient invisible
   * a la relecture. Le portail Netlify avait deja fourni la lecon avec un octet nul.
   */
  effacerLigne() {
    if (this.interactif) this.ecrire('\r\u001b[2K');
  }

  demarrer(libelle) {
    this.libelle = libelle;
    this.debut = this.maintenant();
    if (!this.interactif) {
      this.ecrire(`  ... ${libelle}\n`);
      return;
    }
    this.image = 0;
    this.peindre();
    this.minuterie = setInterval(() => {
      this.image = (this.image + 1) % IMAGES.length;
      this.peindre();
    }, CADENCE_MS);
    // Ne pas retenir le processus en vie pour une animation : si tout le reste est fini,
    // l'application doit rendre la main, pas tourner indefiniment sur sa roue.
    if (typeof this.minuterie.unref === 'function') this.minuterie.unref();
  }

  peindre() {
    this.effacerLigne();
    this.ecrire(`  ${IMAGES[this.image]}  ${this.libelle}`);
  }

  arreter() {
    if (this.minuterie) {
      clearInterval(this.minuterie);
      this.minuterie = null;
    }
  }

  /** Etape reussie. Le temps ecoule est affiche : c'est ce qui rend une lenteur diagnosticable. */
  reussi(precision = '') {
    const t = duree(this.maintenant() - this.debut);
    this.arreter();
    this.effacerLigne();
    const suffixe = precision ? ` — ${precision}` : '';
    this.ecrire(`  ✓  ${this.libelle}${suffixe}  (${t})\n`);
  }

  /** Etape en echec. */
  echoue(raison = '') {
    this.arreter();
    this.effacerLigne();
    this.ecrire(`  ✗  ${this.libelle}${raison ? ` — ${raison}` : ''}\n`);
  }

  /** Information hors etape, sans roue ni chronometre. */
  note(texte) {
    this.arreter();
    this.effacerLigne();
    this.ecrire(`     ${texte}\n`);
  }

  /**
   * Enveloppe une promesse : roue pendant, coche apres, croix si ca casse.
   *
   * L'erreur est RELANCEE apres l'affichage de la croix. Un ecran de demarrage qui avalerait
   * l'erreur pour rester joli serait exactement le contraire de ce qu'on veut.
   */
  async pendant(libelle, tache) {
    this.demarrer(libelle);
    try {
      const resultat = await tache();
      this.reussi(typeof resultat === 'string' ? resultat : '');
      return resultat;
    } catch (erreur) {
      this.echoue(erreur instanceof Error ? erreur.message.split('\n')[0] : String(erreur));
      throw erreur;
    }
  }
}
