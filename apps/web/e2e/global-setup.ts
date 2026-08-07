/**
 * Preparation des tests de bout en bout : verifier la base, et creer le compte d'essai.
 *
 * DEUX RESPONSABILITES, ET LA PREMIERE EST LA PLUS IMPORTANTE.
 *
 * 1. **Refuser de tourner sur une base vide, bruyamment.** Ces tests ouvrent une fiche de parcelle et
 *    comparent l'ecran a l'API : sans parcelle qualifiee, ils n'auraient rien a comparer. Le reflexe
 *    serait de les ignorer — c'est exactement ce qu'il ne faut pas faire. Un test de bout en bout qui
 *    s'ignore en silence laisse croire a une couverture qui n'existe pas, et c'est le reproche adresse
 *    a plusieurs gardes de ce projet depuis l'audit 5. Le lancement echoue donc, avec la raison et la
 *    commande qui repare.
 *
 * 2. **Creer un compte de LECTURE**, et passer par le vrai formulaire de connexion dans les specs.
 *    `AUTH_DESACTIVEE` aurait ete plus court : il donne un administrateur habilite aux donnees de
 *    proprietaire. Un test n'a aucune raison d'obtenir cette habilitation, et le mode sans
 *    authentification ne ferait pas passer le parcours par l'ecran de connexion — qui est la premiere
 *    chose que voit un utilisateur.
 *
 * Le hachage vient de `apps/api` et n'est pas recopie ici : un hachage recopie derive du jour ou le
 * parametrage change, et le compte cesse alors de fonctionner sans que la cause soit lisible.
 */

import { Client } from 'pg';
import { hacherMotDePasse } from '../../api/src/mots-de-passe.js';
import { E2E } from '../playwright.config.js';

async function principal(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/enr';
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Base de donnees injoignable pour les tests de bout en bout (${url}).\n` +
        `  Cause : ${(err as Error).message}\n` +
        '  Ces tests exigent une base peuplee : ils ne peuvent pas etre ignores sans mentir sur la couverture.',
    );
  }

  try {
    const { rows } = await client.query<{ parcelles: string; scores: string }>(
      `SELECT (SELECT count(*) FROM parcelle_snapshot) AS parcelles,
              (SELECT count(*) FROM score_parcelle_filiere) AS scores`,
    );
    const parcelles = Number(rows[0]?.parcelles ?? 0);
    const scores = Number(rows[0]?.scores ?? 0);
    if (parcelles === 0 || scores === 0) {
      throw new Error(
        `Base joignable mais vide : ${parcelles} instantane(s), ${scores} score(s).\n` +
          '  Les tests de bout en bout ouvrent une fiche reelle et comparent l’ecran a l’API.\n' +
          '  Peuplez la base avant de les lancer :\n' +
          '    npm run db:migrate && npm run db:seed\n' +
          '    npm run ingest --workspace @enr/api -- communes\n' +
          '    npx tsx apps/api/src/scripts/qualifier-emprise.ts <bbox> solaire_sol',
      );
    }

    /**
     * Le compte d'essai, en LECTURE SEULE et sans habilitation aux donnees de proprietaire.
     *
     * `ON CONFLICT` plutot qu'une suppression prealable : le compte survit d'une execution a l'autre,
     * et son mot de passe est reecrit a chaque fois — deux executions ne peuvent donc pas diverger
     * sur des identifiants.
     */
    await client.query(
      `INSERT INTO utilisateur (email, nom, mot_de_passe_hash, role, habilite_donnees_proprietaires, actif)
       VALUES ($1, 'Compte de bout en bout', $2, 'lecture', false, true)
       ON CONFLICT (email) DO UPDATE SET
         mot_de_passe_hash = EXCLUDED.mot_de_passe_hash,
         role = 'lecture',
         habilite_donnees_proprietaires = false,
         actif = true`,
      [E2E.email, hacherMotDePasse(E2E.motDePasse)],
    );

    process.stdout.write(
      `# bout en bout : base prete (${parcelles} instantanes, ${scores} scores), compte ${E2E.email} en lecture\n`,
    );
  } finally {
    await client.end();
  }
}

export default principal;
