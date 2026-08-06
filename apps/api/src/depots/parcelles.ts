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

/**
 * UN SNAPSHOT VIEILLIT AUSSI PAR L'ARRIVEE DE LA DONNEE, ET PAS SEULEMENT PAR SON AGE.
 *
 * POURQUOI — audit 9, defaut A2. Le scoring ne lit jamais les couches : il lit le SNAPSHOT, fige au
 * moment de l'enrichissement. Deux mecanismes seulement le renouvelaient, et aucun des deux ne
 * pouvait voir un changement de donnee :
 *
 *   - `snapshotPerime` regarde l'AGE (30 jours par defaut). Une ingestion faite ce matin ne rend
 *     pas plus vieux un snapshot d'hier ;
 *   - `VERSION_MOTEUR` empreinte le CODE, le referentiel reglementaire et les baremes — son
 *     commentaire dit explicitement qu'elle ne couvre pas la donnee. Le rescoring qu'elle declenche
 *     recalcule fidelement a partir du meme snapshot perime, donc il reproduit la meme valeur.
 *
 * Mesure faite sur cette base : 438 parcelles du departement 28 portaient un snapshot de 11 h 48,
 * les sites classes et inscrits ont ete ingeres a 19 h 38 — huit heures plus tard — et rien dans
 * l'application ne pouvait le detecter. Ces parcelles continuaient a repondre « aucune source
 * ingeree » sur le patrimoine alors que la donnee etait la.
 *
 * Le sens de l'erreur n'est pas toujours prudent, et c'est ce qui rend le defaut grave. Un snapshot
 * pris AVANT l'arrivee d'une couche dit « inconnu », ce qui est honnete ; mais un snapshot pris
 * quand la couche existait deja dit `recouvre: false` — une absence CONSTATEE — et un site
 * nouvellement classe, une ZAER nouvellement deliberee ou un poste source nouvellement construit ne
 * seront jamais vus. Une parcelle devenue redhibitoire reste verte.
 *
 * `couverture_ingestion.date_ingestion` est le signal qui manquait : la table est deja tenue par
 * departement et par type. Un snapshot antorieur a la derniere ingestion touchant son departement
 * est donc depasse par la donnee, sans qu'aucun schema nouveau soit necessaire.
 */
export async function snapshotDepasseParDonnee(
  dateSnapshot: string,
  codeDepartement: string | null,
): Promise<boolean> {
  if (!codeDepartement) return false;
  const derniere = await derniereIngestionDepartement(codeDepartement);
  if (derniere == null) return false;
  return new Date(dateSnapshot).getTime() < derniere;
}

/**
 * Date de la derniere ingestion touchant un departement, en millisecondes.
 *
 * Mise en cache : la question est posee une fois par parcelle sur des lots de plusieurs centaines,
 * et la reponse ne change qu'a l'ingestion suivante. Le cache est volontairement court — une
 * ingestion en cours doit etre prise en compte sans redemarrer le serveur.
 */
const DUREE_CACHE_INGESTION_MS = 60 * 1000;
const cacheIngestion = new Map<string, { valeur: number | null; expire: number }>();

async function derniereIngestionDepartement(codeDepartement: string): Promise<number | null> {
  const enCache = cacheIngestion.get(codeDepartement);
  if (enCache && enCache.expire > Date.now()) return enCache.valeur;

  const lignes = await requete<{ derniere: Date | null }>(
    `SELECT max(date_ingestion) AS derniere FROM couverture_ingestion WHERE code_departement = $1`,
    [codeDepartement],
  ).catch(() => [] as Array<{ derniere: Date | null }>);
  const brut = lignes[0]?.derniere ?? null;
  const valeur = brut == null ? null : brut.getTime();
  cacheIngestion.set(codeDepartement, { valeur, expire: Date.now() + DUREE_CACHE_INGESTION_MS });
  return valeur;
}

/** Vide le cache des dates d'ingestion. Utilise par les tests et apres une ingestion. */
export function oublierDatesIngestion(): void {
  cacheIngestion.clear();
}

/**
 * Condition SQL commune a `idusARafraichir` et `nbARafraichir` : snapshot absent, trop vieux, ou
 * anterieur a la derniere ingestion touchant le departement de la parcelle.
 *
 * Ecrite une fois et partagee, pour que le compteur affiche par `/api/sante` et la population
 * effectivement traitee ne puissent pas diverger.
 */
const CONDITION_A_RAFRAICHIR = `
    s.idu IS NULL
 OR s.date_snapshot < now() - ($1 || ' days')::interval
 OR s.date_snapshot < (
      SELECT max(ci.date_ingestion) FROM couverture_ingestion ci
       WHERE ci.code_departement = p.code_departement
    )`;

/**
 * IDU dont le snapshot est absent, perime par l'age, ou depasse par une ingestion.
 *
 * Les parcelles les plus en retard d'abord : un lot borne doit traiter en priorite celles dont
 * l'ecart avec la donnee est le plus grand.
 */
export async function idusARafraichir(limite = 500): Promise<string[]> {
  const lignes = await requete<{ idu: string }>(
    `SELECT p.idu
       FROM parcelle p
       LEFT JOIN parcelle_snapshot s ON s.idu = p.idu
      WHERE ${CONDITION_A_RAFRAICHIR}
      ORDER BY s.date_snapshot ASC NULLS FIRST, p.idu ASC
      LIMIT $2`,
    [config.cache.snapshotMaxAgeJours, limite],
  );
  return lignes.map((l) => l.idu);
}

/**
 * Combien de parcelles attendent un rafraichissement.
 *
 * Expose par `/api/sante`. Sans ce compteur, le retard entre la donnee ingeree et les parcelles
 * deja qualifiees etait purement invisible : l'utilisateur n'avait aucun moyen de savoir que sa
 * carte affichait l'etat d'avant l'ingestion.
 */
export async function nbARafraichir(): Promise<number> {
  const lignes = await requete<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM parcelle p
       LEFT JOIN parcelle_snapshot s ON s.idu = p.idu
      WHERE ${CONDITION_A_RAFRAICHIR}`,
    [config.cache.snapshotMaxAgeJours],
  );
  return lignes[0]?.n ?? 0;
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
