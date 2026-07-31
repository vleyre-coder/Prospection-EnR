/**
 * Connecteurs adosses aux couches ingerees en base (PostGIS).
 *
 * Ces couches ne sont pas interrogeables en temps reel a l'echelle nationale : elles sont
 * ingerees par des jobs batch (voir src/ingestion/) puis interrogees ici par proximite
 * spatiale, ce qui est a la fois rapide et fiable.
 *
 * Regle constante : lorsqu'une couche n'a pas ete ingeree pour le territoire concerne, on
 * retourne null (critere GRIS) et non une absence de contrainte. La table
 * `couverture_ingestion` permet de distinguer les deux cas.
 */

import type {
  EtatSaturation,
  Filiere,
  Patrimoine,
  PosteSourceRef,
  Raccordement,
  Urbanisme,
} from '@enr/core';
import { requete } from '../bdd.js';
import type { Position } from '../geo.js';

// ---------------------------------------------------------------------------
// Postes sources
// ---------------------------------------------------------------------------

interface LignePoste {
  id: string;
  nom: string;
  gestionnaire: 'RTE' | 'Enedis' | 'autre_grd';
  tension: string | null;
  distance_m: number;
  capacite_residuelle_mw: number | null;
  etat_saturation: EtatSaturation | null;
  file_attente_mw: number | null;
  quote_part_eur_par_kw: number | null;
  renforcement_prevu: boolean;
  renforcement_horizon: string | null;
  renforcement_capacite_mw: number | null;
  en_projet: boolean;
}

function versPosteRef(l: LignePoste): PosteSourceRef {
  return {
    id: l.id,
    nom: l.nom,
    gestionnaire: l.gestionnaire,
    tension: l.tension,
    distanceKm: Math.round((l.distance_m / 1000) * 100) / 100,
    capaciteResiduelleMw: l.capacite_residuelle_mw,
    etatSaturation: l.etat_saturation,
    fileAttenteMw: l.file_attente_mw,
    quotePartEurParKw: l.quote_part_eur_par_kw,
    renforcement: {
      prevu: l.renforcement_prevu,
      horizon: l.renforcement_horizon,
      capaciteAttendueMw: l.renforcement_capacite_mw,
    },
    enProjet: l.en_projet,
  };
}

/**
 * Les postes sources les plus proches d'un point, tries par distance.
 * Les postes en projet sont inclus : un poste en construction peut etre la cible de
 * raccordement d'un projet dont le calendrier s'y aligne.
 */
export async function postesLesPlusProches(pt: Position, nombre = 4): Promise<PosteSourceRef[]> {
  const lignes = await requete<LignePoste>(
    `SELECT id, nom, gestionnaire, tension,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
            capacite_residuelle_mw, etat_saturation, file_attente_mw, quote_part_eur_par_kw,
            renforcement_prevu, renforcement_horizon, renforcement_capacite_mw, en_projet
       FROM poste_source
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT $3`,
    [pt[0], pt[1], nombre],
  );
  return lignes.map(versPosteRef);
}

// ---------------------------------------------------------------------------
// Reseau gaz
// ---------------------------------------------------------------------------

export async function reseauGaz(pt: Position): Promise<Raccordement['reseauGaz']> {
  const [injection, canalisation] = await Promise.all([
    requete<{
      distance_m: number;
      gestionnaire: 'GRDF' | 'GRTgaz' | 'Terega' | 'autre' | null;
      capacite_nm3h: number | null;
      rebours_necessaire: boolean | null;
    }>(
      `SELECT ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
              gestionnaire, capacite_nm3h, rebours_necessaire
         FROM point_injection_gaz
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1`,
      [pt[0], pt[1]],
    ),
    requete<{ distance_m: number; gestionnaire: string | null }>(
      `SELECT ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
              gestionnaire
         FROM canalisation_gaz
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        LIMIT 1`,
      [pt[0], pt[1]],
    ),
  ]);

  const inj = injection[0];
  const can = canalisation[0];

  // On retient le point de raccordement le plus proche, qu'il s'agisse d'un poste
  // d'injection existant ou d'une canalisation sur laquelle se piquer.
  if (!inj && !can) {
    return { distanceKm: null, gestionnaire: null, capaciteInjectionNm3h: null, reboursNecessaire: null };
  }
  const distanceInj = inj?.distance_m ?? Infinity;
  const distanceCan = can?.distance_m ?? Infinity;
  const plusProcheEstInjection = distanceInj <= distanceCan;

  return {
    distanceKm: Math.round((Math.min(distanceInj, distanceCan) / 1000) * 100) / 100,
    gestionnaire: plusProcheEstInjection
      ? (inj?.gestionnaire ?? null)
      : ((can?.gestionnaire as Raccordement['reseauGaz']['gestionnaire']) ?? null),
    capaciteInjectionNm3h: plusProcheEstInjection ? (inj?.capacite_nm3h ?? null) : null,
    reboursNecessaire: plusProcheEstInjection ? (inj?.rebours_necessaire ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// ZAER
// ---------------------------------------------------------------------------

/**
 * Zone d'acceleration des ENR.
 * Retourne `present: null` si aucune ZAER n'a ete ingeree pour le departement : l'absence
 * de donnee ne vaut pas absence de ZAER.
 */
export async function zaer(pt: Position, codeDepartement: string): Promise<Urbanisme['zaer']> {
  const [couverture, zones] = await Promise.all([
    requete<{ n: number }>(
      `SELECT count(*)::int AS n FROM couverture_ingestion
        WHERE type = 'zaer' AND code_departement = $1`,
      [codeDepartement],
    ),
    requete<{ filieres: string[]; date_deliberation: string | null; source_document: string | null }>(
      `SELECT filieres, date_deliberation, source_document
         FROM zaer
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
      [pt[0], pt[1]],
    ),
  ]);

  const departementIngere = (couverture[0]?.n ?? 0) > 0;
  if (!departementIngere && zones.length === 0) {
    return { present: null, filieres: [], source: null, dateDeliberation: null };
  }
  if (zones.length === 0) {
    return { present: false, filieres: [], source: null, dateDeliberation: null };
  }
  const filieres = [...new Set(zones.flatMap((z) => z.filieres))] as Filiere[];
  return {
    present: true,
    filieres,
    source: zones[0]!.source_document,
    dateDeliberation: zones[0]!.date_deliberation,
  };
}

// ---------------------------------------------------------------------------
// Document-cadre departemental photovoltaique au sol
// ---------------------------------------------------------------------------

export async function documentCadrePv(
  pt: Position,
  codeDepartement: string,
): Promise<Urbanisme['documentCadrePvSol']> {
  const lignes = await requete<{
    id: number;
    date_arrete: string | null;
    a_geometrie: boolean;
    contient: boolean;
  }>(
    `SELECT id, date_arrete,
            (geom IS NOT NULL) AS a_geometrie,
            COALESCE(ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)), false) AS contient
       FROM document_cadre_pv
      WHERE code_departement = $3`,
    [pt[0], pt[1], codeDepartement],
  );

  if (lignes.length === 0) {
    // Departement non ingere : on ne peut ni valider ni ecarter.
    return { departementCouvert: false, parcelleEligible: null, dateArrete: null };
  }
  const avecGeometrie = lignes.filter((l) => l.a_geometrie);
  if (avecGeometrie.length === 0) {
    // Le document-cadre existe mais procede par criteres litteraux, non cartographies :
    // l'eligibilite reste a apprecier au cas par cas.
    return { departementCouvert: true, parcelleEligible: null, dateArrete: lignes[0]!.date_arrete };
  }
  return {
    departementCouvert: true,
    parcelleEligible: avecGeometrie.some((l) => l.contient),
    dateArrete: avecGeometrie[0]!.date_arrete,
  };
}

// ---------------------------------------------------------------------------
// Patrimoine (monuments historiques, sites)
// ---------------------------------------------------------------------------

export async function patrimoine(pt: Position, rayonM = 10000): Promise<Partial<Patrimoine> | null> {
  const lignes = await requete<{
    type: string;
    nom: string | null;
    distance_m: number;
    contient: boolean;
  }>(
    `SELECT type, nom,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
            ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS contient
       FROM contrainte
      WHERE type IN ('monument_historique', 'site_classe', 'site_inscrit', 'spr')
        AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
      ORDER BY distance_m
      LIMIT 200`,
    [pt[0], pt[1], rayonM],
  );

  if (lignes.length === 0) {
    // Aucune donnee patrimoniale ingeree pour ce secteur : on ne conclut pas.
    const couverture = await requete<{ n: number }>(
      `SELECT count(*)::int AS n FROM couverture_ingestion WHERE connecteur = 'patrimoine_culture'`,
    );
    if ((couverture[0]?.n ?? 0) === 0) return null;
  }

  const mh = lignes.filter((l) => l.type === 'monument_historique');
  const siteClasse = lignes.filter((l) => l.type === 'site_classe');
  const siteInscrit = lignes.filter((l) => l.type === 'site_inscrit');
  const spr = lignes.filter((l) => l.type === 'spr');

  const zonage = (l: typeof lignes) =>
    l.length === 0
      ? { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null }
      : {
          recouvre: l[0]!.contient,
          partRecouvrement: l[0]!.contient ? 1 : 0,
          distanceM: Math.round(l[0]!.distance_m),
          nom: l[0]!.nom,
        };

  const distanceMhM = mh.length > 0 ? Math.round(mh[0]!.distance_m) : null;

  return {
    monumentHistorique: {
      distanceM: distanceMhM,
      // Le perimetre de protection est de 500 m par defaut, sauf PDA delimite.
      dansPerimetreProtection: distanceMhM == null ? null : distanceMhM <= 500,
      nom: mh[0]?.nom ?? null,
    },
    siteClasse: zonage(siteClasse),
    siteInscrit: zonage(siteInscrit),
    spr: zonage(spr),
    avisAbfRequis:
      distanceMhM == null
        ? null
        : distanceMhM <= 500 || siteInscrit.some((s) => s.contient) || spr.some((s) => s.contient),
    // La covisibilite reelle exige une analyse de bassin visuel (MNT + occupation du sol) :
    // on n'expose qu'un indicateur derive de la densite patrimoniale a proximite.
    covisibiliteIndice: lignes.length === 0 ? null : Math.min(100, lignes.length * 6),
    sensibiliteArcheologique: null,
  };
}
