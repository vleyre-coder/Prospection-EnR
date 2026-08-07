/** Format d'erreur unifie de l'API. */

import type { FastifyReply } from 'fastify';

export function erreur(
  rep: FastifyReply,
  statut: number,
  code: string,
  message: string,
  details?: unknown,
): FastifyReply {
  return rep.code(statut).send({ erreur: { code, message, details } });
}

/**
 * Refuse un compte en lecture seule sur une operation qui consomme le quota des API publiques.
 *
 * POURQUOI CETTE FONCTION EXISTE PLUTOT QU'UN `if` RECOPIE. Le controle etait ecrit en clair dans
 * `/api/qualification/emprise`, avec son commentaire, et **il manquait dans
 * `/api/qualification/parcelles`** : un compte en lecture seule pouvait donc qualifier une liste
 * d'identifiants jusqu'au plafond par appel, et epuiser le quota partage par toute l'equipe. Le
 * fichier `acces-roles.test.ts` avait ete ecrit precisement parce que « le role lecture etait
 * applique aux leads mais pas a la qualification »... et il ne couvrait que la route d'emprise.
 *
 * En ajoutant `/api/qualification/rafraichir`, j'ai reproduit le meme oubli. Un controle qu'on
 * recopie finit par etre oublie : nomme, il se voit dans la liste des routes, et un test structurel
 * peut exiger sa presence sur toute route de qualification.
 *
 * Renvoie la reponse d'erreur si le compte est en lecture seule, `null` sinon.
 */
export function refuserLectureSeule(
  req: { utilisateur?: { role: string } },
  rep: FastifyReply,
): FastifyReply | null {
  if (req.utilisateur?.role === 'lecture') {
    return erreur(
      rep,
      403,
      'lecture_seule',
      'Votre compte est en lecture seule : cette operation consomme le quota des sources publiques.',
    );
  }
  return null;
}
