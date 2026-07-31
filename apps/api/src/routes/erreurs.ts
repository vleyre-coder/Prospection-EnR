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
