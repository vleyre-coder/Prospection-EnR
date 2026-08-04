/**
 * Limitation de debit des routes couteuses.
 *
 * Le seul controle de debit existant etait SORTANT, vers les sources publiques. Rien ne
 * bornait les requetes ENTRANTES : un porteur de jeton pouvait enchainer les qualifications
 * d'emprise ou les exports sans plafond, epuisant le quota que l'application partage avec
 * toute l'equipe aupres de la Geoplateforme.
 *
 * Implementation volontairement minimale - un seau a jetons en memoire - plutot qu'une
 * dependance supplementaire : l'application tourne en un seul processus, souvent sur le
 * poste de l'utilisateur, et un compteur partage exigerait Redis pour un besoin qui n'existe
 * pas encore. La limite est donc par processus ; c'est explicite et suffisant a cette
 * echelle.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { erreur } from './routes/erreurs.js';

interface Seau {
  jetons: number;
  dernierRemplissage: number;
}

const seaux = new Map<string, Seau>();

/**
 * Purge periodique, declenchee au comptage plutot que par un minuteur.
 *
 * Un `setInterval` maintiendrait le processus eveille et compliquerait les tests. Le
 * declencheur precedent, `seaux.size % 500 === 0`, n'etait PAS garanti : la taille de la
 * table peut franchir un multiple de 500 sans jamais valoir exactement ce multiple au moment
 * du test, si des entrees ont ete supprimees entre-temps. La purge pouvait donc ne jamais
 * s'executer. On compte desormais les creations, ce qui est monotone.
 */
const PURGE_TOUS_LES_N_SEAUX = 500;
let creationsDepuisPurge = 0;

/** Retire les seaux pleins et inactifs, pour que la table ne croisse pas indefiniment. */
function purger(maintenant: number, intervalleMs: number): void {
  creationsDepuisPurge = 0;
  for (const [cle, seau] of seaux) {
    if (maintenant - seau.dernierRemplissage > intervalleMs * 4) seaux.delete(cle);
  }
}

/** Nombre de seaux en memoire. Expose pour les tests de purge. */
export function nbSeaux(): number {
  return seaux.size;
}

/**
 * Identite retenue pour le comptage : l'utilisateur authentifie de preference, l'adresse IP
 * a defaut. Compter par IP seule mettrait tous les postes derriere un meme NAT d'entreprise
 * dans le meme seau.
 */
function cleAppelant(req: FastifyRequest): string {
  return req.utilisateur?.id ?? `ip:${req.ip}`;
}

export interface OptionsDebit {
  /** Nombre d'operations autorisees par fenetre. */
  max: number;
  /** Duree de la fenetre, en millisecondes. */
  fenetreMs: number;
  /** Nom affiche dans le message d'erreur. */
  operation: string;
}

/**
 * Garde de debit, a poser en `preHandler`.
 *
 * Le seau se remplit continument plutot que par paliers : un utilisateur qui a consomme son
 * quota recupere un jeton au bout de `fenetreMs / max`, sans attendre la fin d'une fenetre
 * entiere. Cela evite l'a-coup ou tout le monde repart en meme temps.
 */
export function limiterDebit(options: OptionsDebit): preHandlerHookHandler {
  const { max, fenetreMs, operation } = options;
  const parJetonMs = fenetreMs / max;

  return async function gardeDebit(req: FastifyRequest, rep: FastifyReply) {
    const maintenant = Date.now();
    const cle = `${operation}:${cleAppelant(req)}`;
    let seau = seaux.get(cle);

    if (!seau) {
      seau = { jetons: max, dernierRemplissage: maintenant };
      seaux.set(cle, seau);
      creationsDepuisPurge += 1;
      if (creationsDepuisPurge >= PURGE_TOUS_LES_N_SEAUX) purger(maintenant, fenetreMs);
    } else {
      const gagnes = (maintenant - seau.dernierRemplissage) / parJetonMs;
      if (gagnes >= 1) {
        seau.jetons = Math.min(max, seau.jetons + Math.floor(gagnes));
        seau.dernierRemplissage = maintenant;
      }
    }

    if (seau.jetons < 1) {
      const attenteS = Math.max(
        1,
        Math.ceil((parJetonMs - (maintenant - seau.dernierRemplissage)) / 1000),
      );
      rep.header('Retry-After', String(attenteS));
      await erreur(
        rep,
        429,
        'debit_depasse',
        `Trop de demandes de type « ${operation} ». Reessayez dans ${attenteS} seconde(s). Cette limite protege le quota partage aupres des services publics de donnees.`,
      );
      return;
    }

    seau.jetons -= 1;
  };
}

/** Remet les compteurs a zero. Reserve aux tests. */
export function reinitialiserDebit(): void {
  seaux.clear();
  creationsDepuisPurge = 0;
}
