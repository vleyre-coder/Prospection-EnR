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

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requete } from '../src/bdd.js';
import { pool } from '../src/bdd.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(ICI, '../../web/test/fixtures');

interface Fiche {
  parcelle: {
    idu: string;
    codeInsee: string;
    nomCommune: string | null;
    codeDepartement: string;
    prefixe: string;
    section: string;
    numero: string;
    contenanceM2: number | null;
    surfaceCalculeeM2: number | null;
    geometrie: unknown;
    centroide: [number, number];
  };
  snapshot: unknown;
  connecteursEnEchec: string[];
  score: {
    filiere: string;
    statut: string;
    scoreGlobal: number | null;
    couvertureDonnees: number;
    knockOuts: Array<{ derogeable: boolean }>;
    regimeImplantation: string | null;
    versionMoteur: string;
    dateCalcul: string;
  };
}

async function principal(): Promise<void> {
  const fichiers = readdirSync(FIXTURES).filter((f) => f.startsWith('fiche-') && f.endsWith('.json'));
  if (fichiers.length === 0) {
    throw new Error(
      `Aucune fixture dans ${FIXTURES}. Regenerez-les avec ` +
        '`npx tsx apps/api/scripts/capturer-fixtures-web.ts` contre une base peuplee.',
    );
  }

  let parcelles = 0;
  let scores = 0;

  for (const f of fichiers) {
    const fiche = JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as Fiche;
    const p = fiche.parcelle;

    await requete(
      `INSERT INTO parcelle
         (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
          contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)),
               ST_SetSRID(ST_MakePoint($11, $12), 4326), now(), now())
       ON CONFLICT (idu) DO UPDATE SET
         nom_commune = EXCLUDED.nom_commune,
         geom = EXCLUDED.geom,
         centroide = EXCLUDED.centroide,
         updated_at = now()`,
      [
        p.idu,
        p.codeInsee,
        p.nomCommune,
        p.codeDepartement,
        p.prefixe,
        p.section,
        p.numero,
        p.contenanceM2,
        p.surfaceCalculeeM2,
        JSON.stringify(p.geometrie),
        p.centroide[0],
        p.centroide[1],
      ],
    );
    parcelles += 1;

    /**
     * L'instantane est date de MAINTENANT, deliberement.
     *
     * La route de la fiche re-enrichit une parcelle dont l'instantane est perime (audit 9, defaut A2)
     * — et re-enrichir signifie appeler les API externes. Un instantane frais evite donc au parcours de
     * declencher exactement ce que ce script cherche a eviter.
     */
    await requete(
      `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture, date_snapshot)
       VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (idu) DO UPDATE SET
         snapshot = EXCLUDED.snapshot,
         connecteurs_en_echec = EXCLUDED.connecteurs_en_echec,
         couverture = EXCLUDED.couverture,
         date_snapshot = now()`,
      [p.idu, JSON.stringify(fiche.snapshot), fiche.connecteursEnEchec, fiche.score.couvertureDonnees],
    );

    const s = fiche.score;
    await requete(
      `INSERT INTO score_parcelle_filiere
         (idu, filiere, statut, score_global, detail, couverture_donnees, nb_knock_outs,
          nb_knock_outs_bloquants, regime_implantation, profil_ponderation, version_moteur, date_calcul)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'defaut', $10, now())
       ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET
         statut = EXCLUDED.statut,
         score_global = EXCLUDED.score_global,
         detail = EXCLUDED.detail,
         couverture_donnees = EXCLUDED.couverture_donnees,
         nb_knock_outs = EXCLUDED.nb_knock_outs,
         nb_knock_outs_bloquants = EXCLUDED.nb_knock_outs_bloquants,
         regime_implantation = EXCLUDED.regime_implantation,
         version_moteur = EXCLUDED.version_moteur,
         date_calcul = now()`,
      [
        p.idu,
        s.filiere,
        s.statut,
        s.scoreGlobal,
        JSON.stringify(s),
        s.couvertureDonnees,
        s.knockOuts.length,
        s.knockOuts.filter((k) => !k.derogeable).length,
        s.regimeImplantation,
        s.versionMoteur,
      ],
    );
    scores += 1;
    console.log(`${f} : ${p.idu} en ${s.filiere} (${s.statut}, score ${String(s.scoreGlobal)})`);
  }

  console.log(`\n${parcelles} parcelle(s) semee(s), ${scores} score(s), aucun appel reseau.`);
  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
