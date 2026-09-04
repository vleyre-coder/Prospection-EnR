/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES ZONES A PROSPECTER — CE QUE L'APPLICATION PROPOSE D'ELLE-MEME
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE DEFAUT QUE CE FICHIER CORRIGE, et il est de conception, pas d'implementation. Jusqu'ici
 * l'application ne proposait RIEN : pour voir quoi que ce soit il fallait zoomer au-dela du niveau
 * 14, lancer « Qualifier l'emprise » sur ce qu'on avait sous les yeux, puis regler des filtres et
 * des ponderations. Autrement dit l'utilisateur devait deja savoir ou chercher pour que l'outil lui
 * dise quoi penser de cet endroit-la. C'est l'inverse de ce qu'on attend d'une aide a la
 * prospection.
 *
 * Trois constats mesures, qui expliquent pourquoi :
 *
 *   1. `commune_score_filiere.potentiel` — la colonne prevue pour dire « va chercher la » — n'est
 *      ecrite par AUCUN code du depot. Sur une base entierement migree portant 34 875 communes,
 *      elle compte 0 ligne. La carte nationale, decrite dans `tuiles.ts` comme une « choroplethe
 *      sur l'indicateur de potentiel », est donc vide partout, a tous les zooms de 5 a 13 ;
 *   2. la seule agregation communale qui existe (fonction SQL de la migration 004) ne compte que
 *      les parcelles DEJA QUALIFIEES. C'est un retroviseur : elle colore ou l'on a travaille, pas
 *      ou il faudrait aller ;
 *   3. la table `zaer` — les zones d'acceleration, c'est-a-dire les surfaces que les communes ont
 *      elles-memes designees pour l'ENR depuis la loi APER — a son ingestion ecrite et sa
 *      migration prete, mais n'a jamais ete remplie : 0 ligne.
 *
 * CE QU'UNE ZONE EST ICI, ET POURQUOI CE CHOIX. Une ZAER est le seul objet national qui DESIGNE un
 * terrain pour l'ENR : elle est deliberee par la commune, publiee au WFS de la Geoplateforme
 * (1 089 671 objets), porte les filieres visees, et le moteur de scoring la traite deja comme
 * « l'argument reglementaire le plus utile de la prospection ». Proposer des ZAER, c'est proposer
 * des terrains dont la collectivite a deja dit qu'elle en voulait — ce qui est exactement ce qu'un
 * prospecteur cherche en premier.
 *
 * LE CLASSEMENT NE PEUT PAS PROMETTRE PLUS QUE LA DONNEE. Les attributs `puissance` et
 * `productible` du WFS sont massivement vides (verifie sur le departement 28 : `null` sur l'objet
 * de tete). Le classement ne s'appuie donc PAS dessus. Il s'appuie sur ce qui est toujours vrai
 * d'un polygone : sa SURFACE, ramenee a une surface utile par le meme modele d'erosion perimetrale
 * que le reste du moteur, et compare au minimum de la filiere. Le reste — nombre de parcelles deja
 * qualifiees dedans — sert a dire ce qui a deja ete regarde, pas a classer.
 *
 * ET SURTOUT : « AUCUNE ZONE » N'EST PAS « PAS DE DONNEE ». Une liste vide parce que la ZAER n'a
 * jamais ete ingeree sur ce territoire se lit « il n'y a rien a prospecter ici », ce qui est
 * exactement le genre d'affirmation que ce projet traque depuis dix audits. La reponse porte donc
 * la couverture : les departements pour lesquels une ingestion ZAER est enregistree, et ceux que
 * l'emprise demandee traverse. L'interface peut alors dire « rien ici » ou « on n'en sait rien »,
 * qui ne sont pas la meme phrase.
 */

import { FILIERES_META, type Filiere } from '@enr/core';
import { surfaceUtileEstimee } from '@enr/scoring';
import { requete } from '../bdd.js';

/** Une zone proposee a la prospection. */
export interface ZoneProposee {
  id: string;
  /** Nom porte par la deliberation, souvent celui de la commune. */
  nom: string | null;
  codeInsee: string | null;
  nomCommune: string | null;
  codeDepartement: string | null;
  /** Filieres visees par la deliberation. */
  filieres: string[];
  surfaceHa: number;
  /** Surface implantable estimee, bande perimetrale deduite. */
  surfaceUtileHa: number;
  dateDeliberation: string | null;
  /** Centre de la zone, pour recentrer la carte. */
  centre: [number, number];
  bbox: [number, number, number, number];
  /** Parcelles deja qualifiees dont le centroide tombe dans la zone. */
  nbParcellesQualifiees: number;
  nbPropices: number;
  /**
   * La deliberation precise-t-elle le type d'implantation ?
   *
   * `false` : la commune a designe la zone pour cette filiere sans dire si elle vise le sol ou la
   * toiture. La zone est proposee — c'est une piste reelle — mais l'interface doit le dire, et le
   * moteur de scoring n'en tire aucun argument reglementaire.
   */
  implantationPrecisee: boolean;
}

export interface ReponseZones {
  zones: ZoneProposee[];
  /**
   * Ce que l'on SAIT du territoire interroge, pour que l'interface ne confonde pas « rien » et
   * « on n'en sait rien ».
   */
  couverture: {
    /** Departements pour lesquels une ingestion ZAER est enregistree. */
    departementsIngeres: string[];
    /** La table `zaer` porte-t-elle au moins une ligne ? */
    donneePresente: boolean;
  };
  /** Surface utile minimale appliquee, en hectares. */
  surfaceUtileMinHa: number;
  /** Nombre de zones ecartees parce que trop petites pour la filiere. */
  nbTropPetites: number;
}

export interface OptionsZones {
  filiere: Filiere;
  /** Emprise [ouest, sud, est, nord]. Absente : tout le territoire ingere. */
  bbox?: [number, number, number, number] | undefined;
  limite: number;
}

/**
 * Ligne brute rendue par PostGIS. Les surfaces arrivent en m², les geometries en nombres.
 */
interface LigneZone {
  id: string;
  nom: string | null;
  code_insee: string | null;
  nom_commune: string | null;
  code_departement: string | null;
  filieres: string[] | null;
  implantation_precisee: boolean;
  surface_m2: string | null;
  centre_lon: number | null;
  centre_lat: number | null;
  ouest: number | null;
  sud: number | null;
  est: number | null;
  nord: number | null;
  nb_parcelles: string | null;
  nb_propices: string | null;
  date_deliberation: Date | string | null;
}

/**
 * Rend la date de deliberation en ISO court, ou `null`.
 *
 * La colonne est un `date` : le pilote la rend en `Date`, et `toISOString()` appliquerait un
 * decalage de fuseau capable de reculer la veille une deliberation du 1er janvier.
 */
function dateCourte(v: Date | string | null): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const mois = String(v.getMonth() + 1).padStart(2, '0');
  const jour = String(v.getDate()).padStart(2, '0');
  return `${v.getFullYear()}-${mois}-${jour}`;
}

/**
 * Les zones a prospecter pour une filiere, les plus grandes d'abord.
 *
 * POURQUOI LE TRI EST SUR LA SURFACE ET NON SUR UN SCORE. Un score de zone supposerait d'evaluer
 * la zone comme on evalue une parcelle — raccordement, gisement, contraintes — ce qui demande des
 * donnees qui ne sont pas ingerees a l'echelle nationale, et rendrait un nombre dont personne ne
 * pourrait dire d'ou il vient. La surface utile, elle, se deduit de la geometrie seule : elle est
 * toujours disponible, elle est le premier filtre qu'un prospecteur applique de toute facon, et
 * elle ne pretend rien de plus que ce qu'elle mesure.
 */
export async function zonesAProspecter(o: OptionsZones): Promise<ReponseZones> {
  const surfaceUtileMinHa = FILIERES_META[o.filiere].surfaceUtileMinHa;

  const params: unknown[] = [o.filiere];
  let filtreEmprise = '';
  if (o.bbox) {
    params.push(o.bbox[0], o.bbox[1], o.bbox[2], o.bbox[3]);
    filtreEmprise = `AND z.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)`;
  }
  // Surface brute minimale, en m² : condition NECESSAIRE pour que la surface utile atteigne le
  // minimum de la filiere, puisque l'erosion perimetrale ne fait que retrancher.
  params.push(surfaceUtileMinHa * 10000);
  const posSurfaceMin = params.length;
  params.push(o.limite);
  const posLimite = params.length;

  /*
   * LA SURFACE EST CALCULEE EN GEOGRAPHIE, pas en degres carres. `ST_Area(geom)` sur du 4326 rend
   * une aire en degres, qui n'a aucun sens physique et varie du simple au double entre Dunkerque
   * et Perpignan. `::geography` rend des metres carres.
   *
   * Les parcelles deja qualifiees sont comptees par une jointure laterale plutot qu'un GROUP BY :
   * sans elle, une zone sans parcelle disparaissait de la liste — or c'est precisement celle-la
   * qu'il faut proposer.
   */
  /*
   * LA LIMITE EST APPLIQUEE AVANT LE COMPTAGE DES PARCELLES, et ce n'est pas un detail : la
   * premiere version comptait les parcelles de CHAQUE zone candidate avant de trier, soit un
   * `ST_Intersects` sur toute la table `parcelle` pour les 7 664 zones d'un departement. Mesure sur
   * donnee reelle : 3 033 ms, au point que le journal la signalait comme « requete SQL lente ».
   * C'est une page d'accueil : elle ne peut pas couter trois secondes.
   *
   * Le filtre de surface passe lui aussi en SQL, sur la surface BRUTE. C'est licite parce que la
   * surface utile est toujours INFERIEURE a la brute : une zone dont le brut est deja sous le
   * minimum de la filiere ne peut pas repasser au-dessus apres erosion perimetrale. Le filtre exact
   * — sur la surface utile — reste applique ensuite, en TypeScript, avec le meme modele que le reste
   * du moteur.
   */
  const sql = `
    WITH candidates AS (
      SELECT
        z.id,
        z.attributs->>'nom'      AS nom,
        z.code_insee,
        z.code_departement,
        z.filieres,
        z.implantation_precisee,
        z.date_deliberation,
        z.geom,
        -- LA SURFACE EST CALCULEE EN GEOGRAPHIE, pas en degres carres. ST_Area sur du 4326 rend
        -- une aire en degres, sans signification physique, qui varie du simple au double entre
        -- Dunkerque et Perpignan. Le transtypage en geography rend des metres carres.
        ST_Area(z.geom::geography) AS surface_m2
      FROM zaer z
      WHERE $1 = ANY(z.filieres)
        AND z.est_demonstration = false
        ${filtreEmprise}
    ),
    retenues AS (
      SELECT * FROM candidates
       WHERE surface_m2 >= $${posSurfaceMin}
       -- L'IDENTIFIANT CLOT LE TRI, et ce n'est pas une precaution theorique : deux zones de meme
       -- surface — cas frequent, les deliberations decoupent souvent des rectangles identiques —
       -- s'ordonneraient sinon au gre du plan d'execution. La troncature ferait alors apparaitre et
       -- disparaitre des zones d'un appel a l'autre, sans qu'aucune donnee ait change.
       ORDER BY surface_m2 DESC, id
       LIMIT $${posLimite}
    )
    SELECT r.id::text, r.nom, r.code_insee, c.nom AS nom_commune, r.code_departement, r.filieres,
           r.implantation_precisee, r.date_deliberation, r.surface_m2,
           ST_X(ST_PointOnSurface(r.geom)) AS centre_lon,
           ST_Y(ST_PointOnSurface(r.geom)) AS centre_lat,
           ST_XMin(r.geom) AS ouest, ST_YMin(r.geom) AS sud,
           ST_XMax(r.geom) AS est,   ST_YMax(r.geom) AS nord,
           COALESCE(p.nb_parcelles, 0)::text AS nb_parcelles,
           COALESCE(p.nb_propices, 0)::text  AS nb_propices
      FROM retenues r
      LEFT JOIN commune c ON c.code_insee = r.code_insee
      -- Jointure LATERALE et non GROUP BY : sans elle, une zone sans aucune parcelle qualifiee
      -- disparaissait de la liste — or c'est precisement celle-la qu'il faut proposer.
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS nb_parcelles,
               count(*) FILTER (WHERE s.statut IN ('vert', 'orange'))::int AS nb_propices
          FROM parcelle pa
          LEFT JOIN score_parcelle_filiere s
            ON s.idu = pa.idu AND s.filiere = $1 AND s.profil_ponderation = 'defaut'
         WHERE ST_Intersects(pa.centroide, r.geom)
      ) p ON true
     ORDER BY r.surface_m2 DESC, r.id`;

  const lignes = await requete<LigneZone>(sql, params);

  let nbTropPetites = 0;
  const zones: ZoneProposee[] = [];
  for (const l of lignes) {
    const surfaceHa = Number(l.surface_m2 ?? 0) / 10000;
    if (!Number.isFinite(surfaceHa) || surfaceHa <= 0) continue;
    /*
     * Le meme modele d'erosion perimetrale que pour une parcelle : une zone n'est pas implantable
     * jusqu'a son bord. L'indice de morcellement est `null` — une ZAER est un polygone unique
     * delibere, elle n'a pas de morcellement cadastral — et la fonction retombe alors sur la seule
     * deduction perimetrale, ce qui est exactement ce qu'on veut ici.
     */
    const utile = surfaceUtileEstimee(surfaceHa, null, o.filiere);
    const surfaceUtileHa = utile?.netteHa ?? surfaceHa;
    if (surfaceUtileHa < surfaceUtileMinHa) {
      nbTropPetites += 1;
      continue;
    }
    if (l.centre_lon == null || l.centre_lat == null) continue;
    zones.push({
      id: l.id,
      nom: l.nom,
      codeInsee: l.code_insee,
      nomCommune: l.nom_commune,
      codeDepartement: l.code_departement,
      filieres: l.filieres ?? [],
      surfaceHa: Math.round(surfaceHa * 100) / 100,
      surfaceUtileHa: Math.round(surfaceUtileHa * 100) / 100,
      dateDeliberation: dateCourte(l.date_deliberation),
      centre: [l.centre_lon, l.centre_lat],
      bbox: [l.ouest ?? 0, l.sud ?? 0, l.est ?? 0, l.nord ?? 0],
      nbParcellesQualifiees: Number(l.nb_parcelles ?? 0),
      nbPropices: Number(l.nb_propices ?? 0),
      implantationPrecisee: l.implantation_precisee !== false,
    });
  }

  return {
    zones,
    couverture: await couvertureZaer(),
    surfaceUtileMinHa,
    nbTropPetites,
  };
}

/**
 * Ce que l'on sait du territoire pour la ZAER.
 *
 * SANS CETTE REPONSE, UNE LISTE VIDE MENT. « Aucune zone » sur un departement jamais ingere se lit
 * « il n'y a rien a prospecter ici ». La couverture permet a l'interface de distinguer les deux, et
 * de dire laquelle des deux phrases elle a le droit de prononcer.
 */
export async function couvertureZaer(): Promise<ReponseZones['couverture']> {
  const [couverts, presence] = await Promise.all([
    requete<{ code_departement: string }>(
      `SELECT DISTINCT code_departement
         FROM couverture_ingestion
        WHERE connecteur = 'zaer_local' AND code_departement IS NOT NULL
        ORDER BY code_departement`,
    ),
    requete<{ existe: boolean }>(`SELECT EXISTS (SELECT 1 FROM zaer) AS existe`),
  ]);
  return {
    departementsIngeres: couverts.map((c) => c.code_departement),
    donneePresente: presence[0]?.existe === true,
  };
}
