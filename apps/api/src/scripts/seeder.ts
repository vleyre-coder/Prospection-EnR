/**
 * Amorcage : cree un compte administrateur et qualifie un secteur de demonstration
 * avec de VRAIES donnees, en interrogeant les API officielles.
 *
 * Aucune donnee n'est inventee : le secteur de demonstration est reellement qualifie
 * par les connecteurs. Le seul cas ou des donnees sont injectees est celui des couches
 * qui n'ont aucune API nationale (ZAER, document-cadre) : elles sont alors clairement
 * marquees comme exemples, avec `source_document` explicite.
 */

import { pool, requete } from '../bdd.js';
import { journal } from '../journal.js';
import { assurerAdministrateur } from '../amorcage.js';
import { qualifierEmprise } from '../services/qualification.js';
import { ingererCommunes, ingererPostesSources, ingererPatrimoine } from '../ingestion/index.js';
import { synchroniserReferentiel } from '../depots/sources.js';

/** Secteurs de demonstration, choisis pour couvrir des contextes contrastes. */
const SECTEURS = [
  {
    nom: 'Beauce (Eure-et-Loir) - grandes cultures, faible relief',
    bbox: [1.735, 48.14, 1.775, 48.17] as [number, number, number, number],
    departement: '28',
  },
  {
    nom: 'Plaine du Rhone (Gard) - risque inondation, viticulture',
    bbox: [4.62, 43.78, 4.66, 43.81] as [number, number, number, number],
    departement: '30',
  },
];

/**
 * Exemples de ZAER et de document-cadre, pour les departements de demonstration.
 *
 * Ces donnees sont des EXEMPLES pedagogiques : aucune API nationale ne les publie, et
 * l'ingestion reelle se fait deliberation par deliberation. Elles portent
 * `est_demonstration = true` : le moteur les ecarte, elles ne servent qu'a l'affichage
 * cartographique.
 *
 * Aucune couverture d'ingestion n'est enregistree pour elles, volontairement. Enregistrer
 * une couverture ferait passer le connecteur de « on ne sait pas s'il existe une ZAER ici »
 * a « il n'y a pas de ZAER ici » : une affirmation d'absence fondee sur un jeu fictif.
 */
async function amorcerCouchesLocales(): Promise<void> {
  const MARQUE = 'EXEMPLE DE DEMONSTRATION - a remplacer par la deliberation officielle';

  for (const secteur of SECTEURS) {
    const [minLon, minLat, maxLon, maxLat] = secteur.bbox;
    // ZAER couvrant la moitie ouest du secteur, pour illustrer l'effet du critere.
    await requete(
      `INSERT INTO zaer (code_insee, nom_commune, filieres, geom, date_deliberation, source_document, attributs, est_demonstration)
       SELECT c.code_insee, c.nom, ARRAY['solaire_sol', 'bess'],
              ST_Multi(ST_Intersection(c.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))),
              '2024-09-01'::date, $5, '{"exemple": true}'::jsonb, true
         FROM commune c
        WHERE ST_Intersects(c.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
          AND NOT EXISTS (SELECT 1 FROM zaer z WHERE z.code_insee = c.code_insee)
        LIMIT 5`,
      [minLon, minLat, (minLon + maxLon) / 2, maxLat, MARQUE],
    );

    // Document-cadre departemental couvrant l'ensemble du secteur.
    await requete(
      `INSERT INTO document_cadre_pv (code_departement, date_arrete, url_arrete, geom, criteres_texte, est_demonstration)
       SELECT $1, '2024-05-15'::date, NULL,
              ST_Multi(ST_MakeEnvelope($2, $3, $4, $5, 4326)), $6, true
        WHERE NOT EXISTS (SELECT 1 FROM document_cadre_pv WHERE code_departement = $1)`,
      [secteur.departement, minLon, minLat, maxLon, maxLat, MARQUE],
    );
  }
  journal.info(
    'Couches locales de demonstration amorcees (marquees est_demonstration = true, ecartees du moteur)',
  );
}

async function main(): Promise<void> {
  const etapes = process.argv.slice(2);
  const tout = etapes.length === 0;

  await synchroniserReferentiel();
  await assurerAdministrateur();

  if (tout || etapes.includes('communes')) {
    journal.info('Ingestion des communes (contours nationaux) - plusieurs minutes');
    await ingererCommunes().catch((err: unknown) => journal.error({ err }, 'Ingestion des communes echouee'));
  }

  if (tout || etapes.includes('postes')) {
    journal.info('Ingestion des postes sources (Capareseau)');
    await ingererPostesSources().catch((err: unknown) =>
      journal.error({ err }, 'Ingestion des postes sources echouee'),
    );
  }

  if (tout || etapes.includes('patrimoine')) {
    journal.info('Ingestion du patrimoine (monuments historiques)');
    await ingererPatrimoine().catch((err: unknown) => journal.error({ err }, 'Ingestion du patrimoine echouee'));
  }

  if (tout || etapes.includes('locales')) {
    await amorcerCouchesLocales().catch((err: unknown) =>
      journal.error({ err }, 'Amorcage des couches locales echoue'),
    );
  }

  if (tout || etapes.includes('secteurs')) {
    for (const secteur of SECTEURS) {
      journal.info({ secteur: secteur.nom }, 'Qualification du secteur de demonstration');
      const r = await qualifierEmprise(secteur.bbox, { surfaceMinM2: 10000 }).catch((err: unknown) => {
        journal.error({ err, secteur: secteur.nom }, 'Qualification du secteur echouee');
        return null;
      });
      if (r) {
        journal.info(
          { secteur: secteur.nom, ...r },
          'Secteur qualifie',
        );
      }
    }
    // Compteurs communaux, pour la vue nationale.
    await requete(`SELECT rafraichir_compteurs_communaux()`);
  }

  journal.info('Amorcage termine');
  await pool.end();
}

main().catch((err) => {
  journal.error({ err }, 'Amorcage interrompu');
  process.exit(1);
});
