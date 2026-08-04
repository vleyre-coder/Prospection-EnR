/**
 * Recherche unifiee et filtres parametrables.
 *
 * La recherche detecte le type de saisie (IDU, reference cadastrale, coordonnees, adresse,
 * commune, poste source) plutot que d'imposer a l'utilisateur de choisir un mode.
 */

import {
  COEFFICIENT_TRACE,
  lineaireRaccordementKm,
  type Feu,
  type Filiere,
  type StatutProspection,
  type TypeSol,
} from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { requete } from '../bdd.js';
import { normaliserNumero, normaliserSection } from '../connecteurs/cadastre.js';
import type { Bbox } from '../geo.js';

export interface ResultatRecherche {
  type: 'parcelle' | 'adresse' | 'commune' | 'coordonnees' | 'poste_source';
  libelle: string;
  sousTitre: string | null;
  centroide: [number, number];
  bbox: Bbox | null;
  idu: string | null;
  codeInsee: string | null;
}

const RE_IDU = /^[0-9]{2}[0-9A-B][0-9]{2}[0-9]{3}[0-9A-Z]{2}[0-9]{4}$/i;
const RE_REFERENCE = /^(\d{5})\s+([0-9A-Z]{1,2})\s+(\d{1,4})$/i;
const RE_COORDONNEES = /^(-?\d{1,3}[.,]\d+)\s*[,;]?\s+(-?\d{1,3}[.,]\d+)$/;

export async function rechercher(q: string, limite = 10): Promise<ResultatRecherche[]> {
  const texte = q.trim();
  if (texte.length < 2) return [];

  // 1. Identifiant unique de parcelle.
  if (RE_IDU.test(texte.replace(/\s/g, ''))) {
    const idu = texte.replace(/\s/g, '').toUpperCase();
    const r = await parcelleEnResultat(idu);
    if (r) return [r];
  }

  // 2. Reference cadastrale "insee section numero".
  const ref = RE_REFERENCE.exec(texte);
  if (ref) {
    const idu = `${ref[1]}000${normaliserSection(ref[2]!)}${normaliserNumero(ref[3]!)}`;
    const r = await parcelleEnResultat(idu);
    if (r) return [r];
    // La parcelle n'est pas en cache : on renvoie tout de meme un resultat exploitable,
    // la qualification a la demande la recuperera.
    return [
      {
        type: 'parcelle',
        libelle: `Parcelle ${normaliserSection(ref[2]!)} ${normaliserNumero(ref[3]!)}`,
        sousTitre: `Commune ${ref[1]} - a qualifier`,
        centroide: [0, 0],
        bbox: null,
        idu,
        codeInsee: ref[1]!,
      },
    ];
  }

  // 3. Coordonnees. On accepte les deux ordres et on tranche par plausibilite :
  // en France metropolitaine la latitude est comprise entre 41 et 52, la longitude
  // entre -5 et 10.
  const coord = RE_COORDONNEES.exec(texte);
  if (coord) {
    const a = Number(coord[1]!.replace(',', '.'));
    const b = Number(coord[2]!.replace(',', '.'));
    const aEstLatitude = a >= 40 && a <= 52 && (b < 40 || b > 52);
    const lat = aEstLatitude ? a : b;
    const lon = aEstLatitude ? b : a;
    return [
      {
        type: 'coordonnees',
        libelle: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        sousTitre: aEstLatitude ? 'latitude, longitude' : 'longitude, latitude (ordre inverse detecte)',
        centroide: [lon, lat],
        bbox: null,
        idu: null,
        codeInsee: null,
      },
    ];
  }

  // 4. Adresse, commune et poste source, en parallele.
  const [adresses, postes] = await Promise.all([
    rechercheAdresse(texte, limite).catch(() => []),
    recherchePosteSource(texte, 5).catch(() => []),
  ]);

  return [...postes, ...adresses].slice(0, limite);
}

async function parcelleEnResultat(idu: string): Promise<ResultatRecherche | null> {
  const lignes = await requete<{
    idu: string;
    nom_commune: string | null;
    section: string;
    numero: string;
    code_insee: string;
    lon: number;
    lat: number;
    minlon: number;
    minlat: number;
    maxlon: number;
    maxlat: number;
  }>(
    `SELECT idu, nom_commune, section, numero, code_insee,
            ST_X(centroide) AS lon, ST_Y(centroide) AS lat,
            ST_XMin(geom) AS minlon, ST_YMin(geom) AS minlat,
            ST_XMax(geom) AS maxlon, ST_YMax(geom) AS maxlat
       FROM parcelle WHERE idu = $1`,
    [idu],
  );
  const l = lignes[0];
  if (!l) return null;
  return {
    type: 'parcelle',
    libelle: `Parcelle ${l.section} ${l.numero}`,
    sousTitre: `${l.nom_commune ?? l.code_insee} - ${l.idu}`,
    centroide: [l.lon, l.lat],
    bbox: [l.minlon, l.minlat, l.maxlon, l.maxlat],
    idu: l.idu,
    codeInsee: l.code_insee,
  };
}

interface ProprietesAdresse {
  label?: string;
  context?: string;
  type?: string;
  citycode?: string;
  city?: string;
  postcode?: string;
}

interface ReponseGeocodage {
  features: Array<{
    geometry: { coordinates: [number, number] };
    properties: ProprietesAdresse;
  }>;
}

/**
 * Geocodage via la Geoplateforme, avec repli sur api-adresse.data.gouv.fr.
 *
 * Les deux services partagent la meme API (Base Adresse Nationale) mais l'ancien host est
 * deprecie et repond regulierement 503 : le repli evite qu'une indisponibilite ponctuelle
 * prive l'utilisateur de la recherche.
 */
async function rechercheAdresse(q: string, limite: number): Promise<ResultatRecherche[]> {
  const params = { q, limit: limite, autocomplete: 1 };
  let fc: ReponseGeocodage;
  try {
    fc = await jsonExterne<ReponseGeocodage>(
      avecParams(`${config.sources.adresse}/search`, params),
      { connecteur: 'geocodage' },
    );
  } catch {
    fc = await jsonExterne<ReponseGeocodage>(
      avecParams(`${config.sources.adresseRepli}/search/`, params),
      { connecteur: 'geocodage' },
    );
  }

  return fc.features.map((f) => ({
    type: f.properties.type === 'municipality' ? ('commune' as const) : ('adresse' as const),
    libelle: f.properties.label ?? '',
    sousTitre: f.properties.context ?? null,
    centroide: f.geometry.coordinates,
    bbox: null,
    idu: null,
    codeInsee: f.properties.citycode ?? null,
  }));
}

async function recherchePosteSource(q: string, limite: number): Promise<ResultatRecherche[]> {
  const lignes = await requete<{
    id: string;
    nom: string;
    gestionnaire: string;
    etat_saturation: string | null;
    capacite_residuelle_mw: number | null;
    lon: number;
    lat: number;
  }>(
    `SELECT id, nom, gestionnaire, etat_saturation, capacite_residuelle_mw,
            ST_X(geom) AS lon, ST_Y(geom) AS lat
       FROM poste_source
      WHERE nom ILIKE '%' || $1 || '%'
      ORDER BY length(nom)
      LIMIT $2`,
    [q, limite],
  );
  return lignes.map((l) => ({
    type: 'poste_source' as const,
    libelle: `Poste ${l.nom}`,
    sousTitre: `${l.gestionnaire}${l.etat_saturation ? ` - ${l.etat_saturation}` : ''}${
      l.capacite_residuelle_mw != null ? ` - ${l.capacite_residuelle_mw} MW disponibles` : ''
    }`,
    centroide: [l.lon, l.lat] as [number, number],
    bbox: null,
    idu: null,
    codeInsee: null,
  }));
}

// ---------------------------------------------------------------------------
// Filtres parametrables par filiere
// ---------------------------------------------------------------------------

export interface FiltresParcelles {
  filiere: Filiere;
  bbox?: Bbox;
  codeDepartement?: string;
  codeInsee?: string;
  surfaceMinHa?: number;
  surfaceMaxHa?: number;
  distancePosteMaxKm?: number;
  capacitePosteMinMw?: number;
  penteMaxPct?: number;
  scoreMin?: number;
  statutsScore?: Feu[];
  statutsProspection?: StatutProspection[];
  typesSol?: TypeSol[];
  exclureNatura2000?: boolean;
  exclureZoneHumide?: boolean;
  exclureAop?: boolean;
  exclureKnockOuts?: boolean;
  tri?: 'score_desc' | 'score_asc' | 'surface_desc' | 'distance_poste_asc';
  limite?: number;
  decalage?: number;
}

export interface LigneResultatFiltre {
  idu: string;
  nomCommune: string | null;
  section: string;
  numero: string;
  surfaceHa: number | null;
  statutScore: Feu | null;
  scoreGlobal: number | null;
  /**
   * Nombre de criteres redhibitoires NON derogeables. Remonte jusqu'au client parce que
   * le statut seul ne distingue pas une parcelle mal notee d'une parcelle
   * reglementairement exclue : les deux sont rouges.
   */
  nbKnockOutsBloquants: number;
  statutProspection: StatutProspection | null;
  /** Vol d'oiseau, tel que mesure. */
  distancePosteKm: number | null;
  /** Lineaire de trace estime : la grandeur notee, et celle qui se paie. */
  lineaireRaccordementKm: number | null;
  pentePct: number | null;
  typeSol: string | null;
  centroide: [number, number];
}

/**
 * Recherche filtree sur les parcelles qualifiees.
 *
 * Les criteres portant sur le snapshot (pente, type de sol, zone humide...) sont evalues
 * directement en JSONB : cela evite de dupliquer ces colonnes tout en restant indexable.
 */
export async function filtrerParcelles(
  f: FiltresParcelles,
): Promise<{ total: number; resultats: LigneResultatFiltre[] }> {
  const conditions: string[] = ['s.filiere = $1', `s.profil_ponderation = 'defaut'`];
  const params: unknown[] = [f.filiere];

  const ajouter = (sql: string, valeur: unknown): void => {
    params.push(valeur);
    conditions.push(sql.replace('$?', `$${params.length}`));
  };

  if (f.bbox) {
    params.push(f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]);
    conditions.push(
      `p.geom && ST_MakeEnvelope($${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length}, 4326)`,
    );
  }
  if (f.codeDepartement) ajouter('p.code_departement = $?', f.codeDepartement);
  if (f.codeInsee) ajouter('p.code_insee = $?', f.codeInsee);
  if (f.surfaceMinHa != null) ajouter('COALESCE(p.surface_calculee_m2, p.contenance_m2) >= $? * 10000', f.surfaceMinHa);
  if (f.surfaceMaxHa != null) ajouter('COALESCE(p.surface_calculee_m2, p.contenance_m2) <= $? * 10000', f.surfaceMaxHa);
  if (f.scoreMin != null) ajouter('s.score_global >= $?', f.scoreMin);
  if (f.statutsScore?.length) ajouter('s.statut = ANY($?)', f.statutsScore);
  if (f.statutsProspection?.length) ajouter('l.statut = ANY($?)', f.statutsProspection);
  // Les knock-outs derogeables (STECAL, modification de PLU) ne justifient pas d'ecarter
  // une parcelle de la liste : seuls les bloquants le font.
  if (f.exclureKnockOuts) conditions.push('s.nb_knock_outs_bloquants = 0');

  if (f.distancePosteMaxKm != null) {
    // Le seuil saisi est un budget de LINEAIRE de trace, comme le rayon dessine sur la
    // carte et comme la grandeur notee par le critere de raccordement. Le snapshot ne
    // stocke que le vol d'oiseau : c'est donc lui qu'on majore, en SQL, pour rester
    // indexable et n'avoir aucune ligne a filtrer cote applicatif.
    ajouter(
      `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric` +
        ` * ${COEFFICIENT_TRACE} <= $?`,
      f.distancePosteMaxKm,
    );
  }
  if (f.capacitePosteMinMw != null) {
    ajouter(
      `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'capaciteResiduelleMw')::numeric >= $?`,
      f.capacitePosteMinMw,
    );
  }
  if (f.penteMaxPct != null) {
    ajouter(`(sn.snapshot -> 'topographie' ->> 'pentePct')::numeric <= $?`, f.penteMaxPct);
  }
  if (f.typesSol?.length) {
    ajouter(`(sn.snapshot -> 'occupationSol' ->> 'typeSol') = ANY($?)`, f.typesSol);
  }
  if (f.exclureZoneHumide) {
    conditions.push(`COALESCE(sn.snapshot -> 'eau' ->> 'zoneHumide', 'non') <> 'oui'`);
  }
  if (f.exclureAop) {
    conditions.push(`COALESCE((sn.snapshot -> 'occupationSol' -> 'aop' ->> 'presente')::boolean, false) = false`);
  }
  if (f.exclureNatura2000) {
    conditions.push(
      `COALESCE((sn.snapshot -> 'milieux' -> 'natura2000Habitats' ->> 'recouvre')::boolean, false) = false
       AND COALESCE((sn.snapshot -> 'milieux' -> 'natura2000Oiseaux' ->> 'recouvre')::boolean, false) = false`,
    );
  }

  const where = conditions.join(' AND ');
  const base = `
    FROM score_parcelle_filiere s
    JOIN parcelle p ON p.idu = s.idu
    LEFT JOIN parcelle_snapshot sn ON sn.idu = s.idu
    LEFT JOIN lead l ON l.idu = s.idu AND l.filiere = s.filiere
    WHERE ${where}`;

  const totalLignes = await requete<{ n: number }>(`SELECT count(*)::int AS n ${base}`, params);

  const ordre =
    f.tri === 'score_asc'
      ? 's.score_global ASC NULLS LAST'
      : f.tri === 'surface_desc'
        ? 'COALESCE(p.surface_calculee_m2, p.contenance_m2) DESC'
        : f.tri === 'distance_poste_asc'
          ? `(sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric ASC NULLS LAST`
          : 's.score_global DESC NULLS LAST';

  params.push(f.limite ?? 200, f.decalage ?? 0);

  const lignes = await requete<{
    idu: string;
    nom_commune: string | null;
    section: string;
    numero: string;
    surface_m2: number | null;
    statut: Feu | null;
    score_global: number | null;
    nb_knock_outs_bloquants: number;
    statut_prospection: StatutProspection | null;
    distance_poste_km: number | null;
    pente_pct: number | null;
    type_sol: string | null;
    lon: number;
    lat: number;
  }>(
    `SELECT p.idu, p.nom_commune, p.section, p.numero,
            COALESCE(p.surface_calculee_m2, p.contenance_m2) AS surface_m2,
            s.statut, s.score_global, COALESCE(s.nb_knock_outs_bloquants, 0)::int AS nb_knock_outs_bloquants,
            l.statut AS statut_prospection,
            (sn.snapshot -> 'raccordement' -> 'posteLePlusProche' ->> 'distanceKm')::numeric AS distance_poste_km,
            (sn.snapshot -> 'topographie' ->> 'pentePct')::numeric AS pente_pct,
            (sn.snapshot -> 'occupationSol' ->> 'typeSol') AS type_sol,
            ST_X(p.centroide) AS lon, ST_Y(p.centroide) AS lat
     ${base}
     ORDER BY ${ordre}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    total: totalLignes[0]?.n ?? 0,
    resultats: lignes.map((l) => ({
      idu: l.idu,
      nomCommune: l.nom_commune,
      section: l.section,
      numero: l.numero,
      surfaceHa: l.surface_m2 == null ? null : Math.round((l.surface_m2 / 10000) * 100) / 100,
      statutScore: l.statut,
      scoreGlobal: l.score_global,
      nbKnockOutsBloquants: l.nb_knock_outs_bloquants,
      statutProspection: l.statut_prospection,
      distancePosteKm: l.distance_poste_km,
      lineaireRaccordementKm:
        l.distance_poste_km == null ? null : lineaireRaccordementKm(l.distance_poste_km),
      pentePct: l.pente_pct,
      typeSol: l.type_sol,
      centroide: [l.lon, l.lat] as [number, number],
    })),
  };
}
