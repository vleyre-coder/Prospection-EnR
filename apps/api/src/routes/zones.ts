/**
 * La route qui repond « ou aller prospecter ».
 *
 * POURQUOI ELLE N'EXISTAIT PAS. Toutes les routes de carte repondent a la question « que sais-tu de
 * CET endroit ? » — une emprise, une tuile, une parcelle. Aucune ne repondait a « quel endroit ? ».
 * L'utilisateur devait donc apporter lui-meme la reponse a la seule question qu'il se pose en
 * arrivant. Le raisonnement complet, et les trois mesures qui l'etablissent, sont en tete de
 * `services/zones.ts`.
 *
 * LA VALIDATION PRECEDE TOUT ACCES A LA BASE, et ce n'est pas un detail de style : l'audit 11 a
 * montre qu'une route validant APRES sa requete rend 500 la ou elle devrait rendre 400 des que la
 * base est absente — et la CI lance `npm test` sans base. Le test de validation accusait alors la
 * validation d'un defaut qui etait un defaut d'ordre.
 */

import type { FastifyInstance } from 'fastify';
import { estFiliere } from '@enr/core';
import { bboxDepuisChaine } from '../geo.js';
import { entierRequete } from '../validation.js';
import { zonesAProspecter } from '../services/zones.js';
import { erreur } from './erreurs.js';

/** Plafond de zones rendues. Au-dela, la liste ne se lit plus et la carte ne s'y retrouve plus. */
const LIMITE_MAX = 200;
const LIMITE_DEFAUT = 50;

export async function routesZones(app: FastifyInstance): Promise<void> {
  app.get('/api/zones', async (req, rep) => {
    const q = req.query as { filiere?: string; bbox?: string; limite?: string };

    if (!estFiliere(q.filiere)) {
      return erreur(
        rep,
        400,
        'filiere_invalide',
        'Parametre `filiere` requis : solaire_sol, eolien_terrestre, bess ou methanisation',
      );
    }
    /*
     * L'EMPRISE EST FACULTATIVE, ET C'EST VOULU. A l'ouverture, l'application n'a pas encore
     * d'emprise utile : elle montre la France entiere. Exiger une bbox obligerait l'interface a en
     * inventer une, donc a restreindre la proposition avant meme que l'utilisateur ait regarde.
     * Sans bbox, la route propose sur tout le territoire ingere.
     */
    let bbox: [number, number, number, number] | undefined;
    if (q.bbox != null && q.bbox !== '') {
      const lu = bboxDepuisChaine(q.bbox);
      if (!lu) return erreur(rep, 400, 'bbox_invalide', 'Parametre `bbox` invalide');
      bbox = lu;
    }
    const limite = entierRequete(q.limite, 'limite', {
      defaut: LIMITE_DEFAUT,
      min: 1,
      max: LIMITE_MAX,
    });

    return zonesAProspecter({ filiere: q.filiere, bbox, limite });
  });
}
