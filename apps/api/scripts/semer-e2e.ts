/**
 * Sème une base d'essai pour les tests de bout en bout — SANS AUCUN APPEL RESEAU.
 *
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI PAS `npm run seed`. Le semeur du projet qualifie un secteur de
 * demonstration en interrogeant les VRAIES API officielles. C'est le bon choix pour une installation :
 * aucune donnee n'est inventee. C'en serait un tres mauvais pour la CI, et pour trois raisons :
 *
 *   1. **Le quota.** Chaque execution consommerait le quota de services publics gratuits partages par
 *      toute l'equipe, a chaque push. C'est precisement le reproche adresse au defaut B4 de l'audit 10,
 *      ou un test de controle d'acces lancait une campagne de 438 parcelles a chaque `npm test`. Une
 *      des specifications de bout en bout verifie meme qu'aucune ecriture ne part du navigateur : il
 *      serait absurde que le semis fasse en gros ce qu'elle interdit en detail.
 *   2. **L'intermittence.** La Geoplateforme a deja repondu 503 quatre fois d'affilee, et un 400 en
 *      plein milieu d'une couche. Une CI qui echoue pour une panne chez un tiers apprend a ignorer ses
 *      echecs — c'est la maladie mortelle des tests de bout en bout.
 *   3. **Le determinisme.** Ces tests comparent l'ecran a l'API critere par critere. Sur une donnee qui
 *      change entre deux executions, un ecart ne se distinguerait pas d'une regression.
 *
 * LA DONNEE SEMEE EST REELLE POUR AUTANT. Elle vient des fixtures capturees pour les tests de rendu
 * (`apps/web/test/fixtures/fiche-*.json`), c'est-a-dire de reponses d'API veritables, sur de vraies
 * parcelles, geometries comprises. Rien n'est invente ici : ce script recopie, il ne fabrique pas.
 *
 * Idempotent : rejouable sans nettoyage prealable.
 */

import { pool } from '../src/bdd.js';
import { lireFiches, semerFiche } from '../test/aides/semer-fiches.js';

/**
 * L'insertion elle-meme vit dans `test/aides/semer-fiches.ts`, et non ici.
 *
 * Elle etait ecrite deux fois — ce script, puis la relecture des rapports PDF, qui a besoin des memes
 * fiches en base. Une regle ecrite deux fois se corrige une fois sur deux ; celle-ci porte trois
 * insertions liees et un choix subtil (l'instantane date de maintenant, pour ne pas declencher le
 * re-enrichissement de l'audit 9). Elle est donc unique, et ce script n'en est plus qu'un appelant.
 */
async function principal(): Promise<void> {
  const fiches = lireFiches();
  for (const { fichier, fiche } of fiches) {
    await semerFiche(fiche);
    const s = fiche.score;
    console.log(
      `${fichier} : ${fiche.parcelle.idu} en ${s.filiere} (${s.statut}, score ${String(s.scoreGlobal)})`,
    );
  }
  console.log(`\n${fiches.length} parcelle(s) semee(s) avec leur score, aucun appel reseau.`);
  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
