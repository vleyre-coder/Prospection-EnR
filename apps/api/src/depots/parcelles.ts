/** Depot des parcelles et de leurs snapshots d'enrichissement. */

import type { ParcelleSnapshot } from '@enr/core';
import { requete, requeteUne } from '../bdd.js';
import { config } from '../config.js';
import type { ParcelleBrute } from '../connecteurs/cadastre.js';
import type { Bbox, GeoJsonGeometry } from '../geo.js';

export interface ParcelleEnBase {
  idu: string;
  codeInsee: string;
  nomCommune: string | null;
  codeDepartement: string;
  prefixe: string;
  section: string;
  numero: string;
  contenanceM2: number | null;
  surfaceCalculeeM2: number | null;
  geometrie: GeoJsonGeometry;
  centroide: [number, number];
  dateRecuperation: string;
}

interface LigneParcelle {
  idu: string;
  code_insee: string;
  nom_commune: string | null;
  code_departement: string;
  prefixe: string;
  section: string;
  numero: string;
  contenance_m2: number | null;
  surface_calculee_m2: number | null;
  geometrie: string;
  centroide: string;
  date_recuperation: Date;
}

function versParcelle(l: LigneParcelle): ParcelleEnBase {
  const centroide = JSON.parse(l.centroide) as { coordinates: [number, number] };
  return {
    idu: l.idu,
    codeInsee: l.code_insee,
    nomCommune: l.nom_commune,
    codeDepartement: l.code_departement,
    prefixe: l.prefixe,
    section: l.section,
    numero: l.numero,
    contenanceM2: l.contenance_m2,
    surfaceCalculeeM2: l.surface_calculee_m2,
    geometrie: JSON.parse(l.geometrie) as GeoJsonGeometry,
    centroide: centroide.coordinates,
    dateRecuperation: l.date_recuperation.toISOString(),
  };
}

const SELECT_PARCELLE = `
  SELECT idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
         contenance_m2, surface_calculee_m2,
         ST_AsGeoJSON(geom) AS geometrie,
         ST_AsGeoJSON(centroide) AS centroide,
         date_recuperation
    FROM parcelle`;

export async function parcelleParIdu(idu: string): Promise<ParcelleEnBase | null> {
  const l = await requeteUne<LigneParcelle>(`${SELECT_PARCELLE} WHERE idu = $1`, [idu]);
  return l ? versParcelle(l) : null;
}

export async function parcellesParIdus(idus: string[]): Promise<ParcelleEnBase[]> {
  if (idus.length === 0) return [];
  const lignes = await requete<LigneParcelle>(`${SELECT_PARCELLE} WHERE idu = ANY($1)`, [idus]);
  return lignes.map(versParcelle);
}

/**
 * Enregistre ou met a jour une parcelle.
 *
 * La surface de reference est recalculee par PostGIS en Lambert-93, plus fiable que
 * l'approximation faite cote application lors de la recuperation.
 */
export async function enregistrerParcelle(p: ParcelleBrute): Promise<void> {
  await requete(
    `INSERT INTO parcelle
       (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
        contenance_m2, geom, centroide, surface_calculee_m2, date_recuperation, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($9), 4326))),
             ST_PointOnSurface(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($9), 4326))),
             ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($9), 4326), 2154)),
             now(), now())
     ON CONFLICT (idu) DO UPDATE SET
       nom_commune = EXCLUDED.nom_commune,
       contenance_m2 = EXCLUDED.contenance_m2,
       geom = EXCLUDED.geom,
       centroide = EXCLUDED.centroide,
       surface_calculee_m2 = EXCLUDED.surface_calculee_m2,
       date_recuperation = now(),
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
      JSON.stringify(p.geometrie),
    ],
  );
}

export async function enregistrerParcelles(parcelles: ParcelleBrute[]): Promise<number> {
  let n = 0;
  for (const p of parcelles) {
    await enregistrerParcelle(p);
    n += 1;
  }
  return n;
}

/** Parcelles en cache dans une emprise, avec filtre de surface minimale. */
export async function parcellesDansEmprise(
  bbox: Bbox,
  surfaceMinM2 = 0,
  limite = config.carte.limiteParcelles,
): Promise<ParcelleEnBase[]> {
  const lignes = await requete<LigneParcelle>(
    `${SELECT_PARCELLE}
      WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        AND COALESCE(surface_calculee_m2, contenance_m2, 0) >= $5
      -- Departage par l'IDU : la limite decide quelles parcelles la carte affiche, et sans ordre
      -- total il le decidait differemment d'un plan a l'autre. Une parcelle visible disparaissait
      -- au rafraichissement suivant sans que rien n'ait change (audit 9, defaut A1).
      ORDER BY COALESCE(surface_calculee_m2, contenance_m2) DESC, idu ASC
      LIMIT $6`,
    [bbox[0], bbox[1], bbox[2], bbox[3], surfaceMinM2, limite],
  );
  return lignes.map(versParcelle);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function snapshotParIdu(
  idu: string,
): Promise<{ snapshot: ParcelleSnapshot; connecteursEnEchec: string[]; dateSnapshot: string } | null> {
  const l = await requeteUne<{
    snapshot: ParcelleSnapshot;
    connecteurs_en_echec: string[];
    date_snapshot: Date;
  }>(
    `SELECT snapshot, connecteurs_en_echec, date_snapshot FROM parcelle_snapshot WHERE idu = $1`,
    [idu],
  );
  if (!l) return null;
  return {
    snapshot: l.snapshot,
    connecteursEnEchec: l.connecteurs_en_echec,
    dateSnapshot: l.date_snapshot.toISOString(),
  };
}

export async function enregistrerSnapshot(
  idu: string,
  snapshot: ParcelleSnapshot,
  connecteursEnEchec: string[],
  couverture: number,
): Promise<void> {
  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture, date_snapshot)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (idu) DO UPDATE SET
       snapshot = EXCLUDED.snapshot,
       connecteurs_en_echec = EXCLUDED.connecteurs_en_echec,
       couverture = EXCLUDED.couverture,
       date_snapshot = now()`,
    [idu, JSON.stringify(snapshot), connecteursEnEchec, couverture],
  );
}

/** Un snapshot est perime au-dela de l'age configure : les sources evoluent. */
export function snapshotPerime(dateSnapshot: string): boolean {
  const age = Date.now() - new Date(dateSnapshot).getTime();
  return age > config.cache.snapshotMaxAgeJours * 24 * 3600 * 1000;
}

/** IDU dont le snapshot est absent ou perime, pour les jobs de rafraichissement. */
export async function idusARafraichir(limite = 500): Promise<string[]> {
  const lignes = await requete<{ idu: string }>(
    `SELECT p.idu
       FROM parcelle p
       LEFT JOIN parcelle_snapshot s ON s.idu = p.idu
      WHERE s.idu IS NULL
         OR s.date_snapshot < now() - ($1 || ' days')::interval
      LIMIT $2`,
    [config.cache.snapshotMaxAgeJours, limite],
  );
  return lignes.map((l) => l.idu);
}

/**
 * IDU disposant d'un snapshot mais d'aucun score a la version courante du moteur.
 *
 * C'est la population exacte a recalculer apres une montee de version : le recalcul se fait
 * a partir du snapshot deja stocke, sans reinterroger la moindre source.
 *
 * A ne pas confondre avec `idusARafraichir`, qui designe les parcelles dont la DONNEE est
 * perimee. Piloter le rescoring sur ce dernier critere effacait les scores des parcelles en
 * bonne sante - snapshot recent, donc absentes de la liste - sans jamais les recalculer :
 * elles disparaissaient de la carte et des listes.
 */
export async function idusSansScoreCourant(version: string, limite = 5000): Promise<string[]> {
  const lignes = await requete<{ idu: string }>(
    `SELECT s.idu
       FROM parcelle_snapshot s
      WHERE NOT EXISTS (
              SELECT 1 FROM score_parcelle_filiere sc
               WHERE sc.idu = s.idu AND sc.version_moteur = $1)
      LIMIT $2`,
    [version, limite],
  );
  return lignes.map((l) => l.idu);
}

/** Nombre de scores calcules par une version anterieure du moteur. */
export async function nbScoresObsoletes(version: string): Promise<number> {
  const lignes = await requete<{ n: number }>(
    `SELECT count(*)::int AS n FROM score_parcelle_filiere WHERE version_moteur <> $1`,
    [version],
  );
  return lignes[0]?.n ?? 0;
}

/**
 * Declenche la purge des donnees nominatives arrivees a echeance.
 *
 * La fonction SQL `purger_donnees_nominatives()` existait depuis la migration 006 mais
 * n'etait appelee PAR AUCUN CODE. Tant que la table restait vide, l'oubli etait sans effet ;
 * il aurait produit une conservation illicite des le premier versement de donnees reelles —
 * exactement au moment ou plus personne ne l'aurait cherche.
 *
 * Appelee au demarrage puis une fois par jour. Le declencheur n'est pas critique en precision
 * — une purge est due a la journee, pas a la seconde — mais il doit exister.
 */
export async function purgerDonneesNominatives(): Promise<number> {
  const l = await requeteUne<{ nb: number }>(`SELECT purger_donnees_nominatives() AS nb`);
  return l?.nb ?? 0;
}
