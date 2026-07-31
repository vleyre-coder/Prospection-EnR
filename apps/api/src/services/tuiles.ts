/**
 * Tuiles vectorielles (MVT) servies par PostGIS.
 *
 * Deux couches, selon le zoom - c'est ce qui rend l'application fluide a l'echelle nationale :
 *   - zoom >= 14  : parcelles cadastrales individuelles ;
 *   - zoom 5 a 13 : communes, en choroplethe sur l'indicateur de potentiel.
 *
 * La coloration n'est PAS faite ici : la tuile porte le statut et le score, et le style
 * MapLibre les traduit en couleur cote client. C'est ce qui permet de recolorer
 * instantanement au changement de filiere ou de ponderation.
 */

import type { Filiere } from '@enr/core';
import { pool } from '../bdd.js';
import { config } from '../config.js';

export interface CoordonneesTuile {
  z: number;
  x: number;
  y: number;
}

/** Enveloppe d'une tuile en EPSG:3857, calculee par PostGIS. */
const ENVELOPPE = 'ST_TileEnvelope($1, $2, $3)';

export function zoomValidePourParcelles(z: number): boolean {
  return z >= config.carte.zoomMinParcelles;
}

export function zoomValidePourCommunes(z: number): boolean {
  return z <= config.carte.zoomMaxCommunes;
}

/**
 * Tuile des parcelles, avec le score de la filiere demandee et le statut de prospection.
 *
 * Les deux dimensions restent distinctes dans les attributs (`statut_score` pour le
 * remplissage, `statut_prospection` pour le contour), conformement a l'exigence de ne pas
 * confondre propice et prospecte.
 */
export async function tuileParcelles(
  t: CoordonneesTuile,
  filiere: Filiere,
  profil = 'defaut',
): Promise<Buffer> {
  const sql = `
    WITH bornes AS (SELECT ${ENVELOPPE} AS geom),
    donnees AS (
      SELECT
        p.idu,
        p.section,
        p.numero,
        p.nom_commune,
        round(COALESCE(p.surface_calculee_m2, p.contenance_m2)::numeric) AS surface_m2,
        s.statut          AS statut_score,
        s.score_global,
        s.couverture_donnees,
        s.nb_knock_outs,
        s.regime_implantation,
        l.statut          AS statut_prospection,
        ST_AsMVTGeom(
          ST_Transform(p.geom, 3857),
          bornes.geom,
          4096, 64, true
        ) AS geom
      FROM parcelle p
      CROSS JOIN bornes
      LEFT JOIN score_parcelle_filiere s
        ON s.idu = p.idu AND s.filiere = $4 AND s.profil_ponderation = $5
      LEFT JOIN lead l
        ON l.idu = p.idu AND l.filiere = $4
      WHERE ST_Transform(p.geom, 3857) && bornes.geom
    )
    SELECT ST_AsMVT(donnees, 'parcelles', 4096, 'geom') AS tuile
      FROM donnees WHERE geom IS NOT NULL`;

  const res = await pool.query<{ tuile: Buffer }>(sql, [t.z, t.x, t.y, filiere, profil]);
  return res.rows[0]?.tuile ?? Buffer.alloc(0);
}

/** Tuile communale, servie a l'echelle nationale. */
export async function tuileCommunes(t: CoordonneesTuile, filiere: Filiere): Promise<Buffer> {
  const sql = `
    WITH bornes AS (SELECT ${ENVELOPPE} AS geom),
    donnees AS (
      SELECT
        c.code_insee,
        c.nom,
        c.code_departement,
        cs.potentiel,
        cs.statut,
        cs.surface_propice_ha,
        cs.nb_parcelles_qualifiees,
        cs.nb_vert,
        cs.nb_orange,
        cs.nb_rouge,
        cs.nb_gris,
        ST_AsMVTGeom(
          ST_Transform(
            -- Simplification dependante du zoom : indispensable pour la fluidite nationale.
            CASE WHEN $1 < 9 THEN ST_SimplifyPreserveTopology(c.geom, 0.005)
                 WHEN $1 < 12 THEN ST_SimplifyPreserveTopology(c.geom, 0.001)
                 ELSE c.geom END,
            3857),
          bornes.geom, 4096, 16, true
        ) AS geom
      FROM commune c
      CROSS JOIN bornes
      LEFT JOIN commune_score_filiere cs
        ON cs.code_insee = c.code_insee AND cs.filiere = $4
      WHERE ST_Transform(c.geom, 3857) && bornes.geom
    )
    SELECT ST_AsMVT(donnees, 'communes', 4096, 'geom') AS tuile
      FROM donnees WHERE geom IS NOT NULL`;

  const res = await pool.query<{ tuile: Buffer }>(sql, [t.z, t.x, t.y, filiere]);
  return res.rows[0]?.tuile ?? Buffer.alloc(0);
}

/** Tuile d'une couche de contraintes (environnement, risques, patrimoine). */
export async function tuileContraintes(t: CoordonneesTuile, types: string[]): Promise<Buffer> {
  const sql = `
    WITH bornes AS (SELECT ${ENVELOPPE} AS geom),
    donnees AS (
      SELECT
        c.type, c.sous_type, c.nom, c.millesime,
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), bornes.geom, 4096, 32, true) AS geom
      FROM contrainte c
      CROSS JOIN bornes
      WHERE c.type = ANY($4) AND ST_Transform(c.geom, 3857) && bornes.geom
    )
    SELECT ST_AsMVT(donnees, 'contraintes', 4096, 'geom') AS tuile
      FROM donnees WHERE geom IS NOT NULL`;

  const res = await pool.query<{ tuile: Buffer }>(sql, [t.z, t.x, t.y, types]);
  return res.rows[0]?.tuile ?? Buffer.alloc(0);
}
