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
import { couchesPresentesDansDepartement, disqueEntierementCouvert } from './couches.js';

/**
 * Types de `couverture_ingestion` correspondant aux couches interrogees par proximite.
 *
 * Nommes ici plutot qu'en clair dans chaque requete : le lien entre la table lue et la ligne de
 * couverture qui l'autorise doit se voir d'un coup d'oeil.
 */
export const TYPE_COUVERTURE_POSTES = 'poste_source';
export const TYPE_COUVERTURE_INJECTION = 'point_injection_gaz';

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
 *
 * Les postes en projet sont inclus : un poste en construction peut etre la cible de
 * raccordement d'un projet dont le calendrier s'y aligne.
 *
 * RENVOIE UNE LISTE VIDE PLUTOT QU'UNE DISTANCE DOUTEUSE — audit 9, defaut A3. L'ingestion des
 * postes parcourt les treize regions une a une et tolere l'echec de l'une d'elles. Il faut donc
 * verifier que le disque balaye par la recherche est entierement ingere : sinon le poste trouve
 * n'est pas le plus proche, seulement le plus proche de ceux qu'on a. La liste vide fait passer
 * `postes_sources` dans les connecteurs en echec, et tous les criteres de raccordement au gris —
 * ce qui est la reponse juste, la ou une distance inventee virait la parcelle au rouge.
 */
export async function postesLesPlusProches(pt: Position, nombre = 4): Promise<PosteSourceRef[]> {
  const lignes = await requete<LignePoste>(
    `SELECT id, nom, gestionnaire, tension,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
            capacite_residuelle_mw, etat_saturation, file_attente_mw, quote_part_eur_par_kw,
            renforcement_prevu, renforcement_horizon, renforcement_capacite_mw, en_projet
       FROM poste_source
      -- Departage par l'identifiant : deux postes exactement equidistants existent (postes jumeles
      -- sur un meme site), et sans ordre total la limite en retenait un au hasard (audit 9, A1).
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326), id
      LIMIT $3`,
    [pt[0], pt[1], nombre],
  );
  const plusProche = lignes[0];
  if (!plusProche) return [];

  // Le disque a verifier est celui de la distance RETENUE, et non un rayon fixe : c'est exactement
  // l'etendue sur laquelle la reponse « c'est le plus proche » engage la donnee.
  if (!(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, pt, plusProche.distance_m))) {
    return [];
  }
  return lignes.map(versPosteRef);
}

// ---------------------------------------------------------------------------
// Reseau gaz
// ---------------------------------------------------------------------------

/**
 * Reseau de gaz : la canalisation la plus proche, et le site d'injection le plus proche.
 *
 * LES DEUX SONT RENVOYEES SEPAREMENT — audit 8, defaut B6/E5. La version precedente retenait « le
 * point de raccordement le plus proche, poste d'injection existant ou canalisation », et n'en
 * exposait qu'une seule distance. Comme la table `canalisation_gaz` n'est peuplee par aucun job,
 * cette distance unique etait toujours celle d'un SITE D'INJECTION EXISTANT : quelques centaines de
 * points en France, contre des dizaines de milliers de kilometres de canalisations. La grandeur
 * affichee etait donc structurellement bien superieure a la distance de raccordement reelle, et la
 * methanisation etait penalisee sur 11 % de sa note sans que rien ne le dise.
 *
 * Chaque distance vaut `null` si SA couche est vide : le critere reste gris plutot que faux.
 */
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
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326), id
        LIMIT 1`,
      [pt[0], pt[1]],
    ),
    requete<{ distance_m: number; gestionnaire: string | null }>(
      `SELECT ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m,
              gestionnaire
         FROM canalisation_gaz
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326), id
        LIMIT 1`,
      [pt[0], pt[1]],
    ),
  ]);

  const inj = injection[0];
  const can = canalisation[0];
  const enKm = (m: number | undefined): number | null =>
    m == null ? null : Math.round((m / 1000) * 100) / 100;

  // Meme regle que pour les postes sources (audit 9, defaut A3) : la distance au site d'injection le
  // plus proche n'est une mesure que si le disque qu'elle parcourt est ingere. L'ingestion GRDF est
  // paginee et une interruption en cours de pagination laisse une France partielle.
  const injectionFiable =
    inj == null ? false : await disqueEntierementCouvert(TYPE_COUVERTURE_INJECTION, pt, inj.distance_m);

  return {
    distanceCanalisationKm: enKm(can?.distance_m),
    distanceSiteInjectionKm: injectionFiable ? enKm(inj?.distance_m) : null,
    // Le gestionnaire de la canalisation prime : c'est lui qui instruira le raccordement. A defaut,
    // celui du site d'injection donne une indication du territoire.
    gestionnaire:
      (can?.gestionnaire as Raccordement['reseauGaz']['gestionnaire'] | undefined) ??
      inj?.gestionnaire ??
      null,
    // Capacite et rebours sont des proprietes du SITE d'injection, pas de la canalisation.
    capaciteInjectionNm3h: inj?.capacite_nm3h ?? null,
    reboursNecessaire: inj?.rebours_necessaire ?? null,
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
        -- Les zones de demonstration sont ecartees : une ZAER fictive vaudrait un
        -- argument reglementaire majeur qui n'existe pas.
        WHERE est_demonstration = false
          /*
           * ET LES ZONES DONT L'IMPLANTATION N'EST PAS PRECISEE, pour la meme raison.
           *
           * Depuis la migration 016, une ZAER photovoltaique dont la deliberation ne dit pas si
           * elle vise le sol ou la toiture est ingeree — elle vaut une piste de prospection, et en
           * ecarter 93 % dans certains departements rendait l'application aveugle. Mais elle ne
           * vaut PAS un argument reglementaire : affirmer « cette parcelle est en zone
           * d'acceleration » alors que la zone pourrait ne viser que des toitures ferait monter un
           * score sur une supposition. Proposer et affirmer ne demandent pas le meme niveau de
           * preuve, et c'est cette ligne qui tient la difference.
           */
          AND implantation_precisee
          AND ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
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
      WHERE est_demonstration = false
        AND code_departement = $3`,
    [pt[0], pt[1], codeDepartement],
  );

  if (lignes.length === 0) {
    /**
     * Aucune ligne pour ce departement. Deux causes indiscernables ici, et il faut les distinguer
     * (audit 8, D5) : soit la couche n'a pas ete ingeree, soit le departement n'a pas arrete de
     * document-cadre — ce qui est le cas de la grande majorite d'entre eux.
     *
     * `couverture_ingestion` tranche : si le departement y figure pour ce type, on SAIT qu'il a ete
     * regarde, et l'absence de ligne est une absence reelle de document-cadre.
     */
    const couverture = await couchesPresentesDansDepartement(['document_cadre_pv'], codeDepartement);
    return {
      departementCouvert: couverture['document_cadre_pv'] ? false : null,
      parcelleEligible: null,
      dateArrete: null,
    };
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

/** Les quatre types patrimoniaux lus ici. Ils n'ont PAS le meme etat d'ingestion. */
export const TYPES_PATRIMOINE = [
  'monument_historique',
  'site_classe',
  'site_inscrit',
  'spr',
] as const;

export async function patrimoine(
  pt: Position,
  codeDepartement: string,
  rayonM = 10000,
): Promise<Partial<Patrimoine> | null> {
  /**
   * Presence PAR TYPE, et par departement.
   *
   * Ancien comportement, corrige a l'audit 8 : un seul controle global, declenche uniquement
   * lorsque la requete ne renvoyait AUCUNE ligne, et sans filtre de departement. Les trois types
   * jamais ingeres (`site_classe`, `site_inscrit`, `spr`) produisaient donc des absences
   * CONSTATEES des lors qu'un seul monument historique etait trouve — c'est-a-dire presque
   * toujours. Le critere `pat_sites` valait 90/100 en vert avec la phrase « aucun site classe ni
   * inscrit dans le rayon d'analyse », sur zero donnee.
   */
  const presence = await couchesPresentesDansDepartement(TYPES_PATRIMOINE, codeDepartement);

  /**
   * ET LA COUVERTURE DU DISQUE, PAS SEULEMENT DU DEPARTEMENT — audit 9, defaut A3.
   *
   * Le controle par departement fermait le cas « couche jamais ingeree ici », mais la recherche
   * porte sur un rayon de 10 km, qui franchit une frontiere departementale des que la parcelle en
   * est a moins de 10 km — soit une grande partie du territoire. Un site classe situe a 3 km, de
   * l'autre cote de la limite, dans un departement non ingere, restait invisible, et l'absence
   * etait affirmee au lieu d'etre inconnue. Le disque est verifie type par type : une couche peut
   * etre complete la ou une autre ne l'est pas.
   */
  const disques = await Promise.all(
    TYPES_PATRIMOINE.map(async (t) =>
      presence[t] === true ? disqueEntierementCouvert(t, pt, rayonM) : false,
    ),
  );
  /**
   * Verdict final par type : « on peut affirmer quelque chose sur cette couche ici ».
   *
   * C'est LUI et non `presence` qui commande les trois etats plus bas. Une premiere version de ce
   * correctif ne changeait que le filtre des types interroges en laissant `presence` decider de
   * l'affichage : la couche etait alors exclue de la requete tout en etant declaree presente, donc
   * une liste vide devenait une absence constatee — le defaut de l'audit 8 reintroduit par sa
   * propre correction.
   */
  const exploitable = Object.fromEntries(
    TYPES_PATRIMOINE.map((t, i) => [t, disques[i] === true]),
  ) as Record<(typeof TYPES_PATRIMOINE)[number], boolean>;
  const typesIngeres = TYPES_PATRIMOINE.filter((t) => exploitable[t]);
  if (typesIngeres.length === 0) return null;

  /**
   * UN PLAFOND PAR TYPE, et non un plafond partage.
   *
   * L'ancienne requete plafonnait a 200 lignes pour les quatre types confondus. Autour de Nice,
   * Bordeaux ou Lyon, ou la densite depasse 30 monuments au km2 contre 0,08 en moyenne nationale,
   * les 200 lignes pouvaient etre entierement consommees par des monuments historiques : les trois
   * autres types etaient alors declares absents alors qu'ils avaient seulement ete tronques.
   * C'est le meme defaut que la troncature WFS corrigee a l'audit 5.
   *
   * `ROW_NUMBER() OVER (PARTITION BY type)` donne a chaque type son propre plafond. Seules les
   * 40 occurrences les plus proches de chaque type sont retenues : au-dela, ni la distance
   * minimale ni le recouvrement ne changent.
   */
  const lignes = await requete<{
    type: string;
    nom: string | null;
    distance_m: number;
    contient: boolean;
    rang: number;
  }>(
    `WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g),
          proches AS (
       SELECT c.type, c.nom,
              ST_Distance(c.geom::geography, pt.g::geography) AS distance_m,
              ST_Intersects(c.geom, pt.g) AS contient,
              row_number() OVER (
                PARTITION BY c.type
                -- Departage : le rang decide de la troncature a 40 objets par type, il doit donc
                -- etre reproductible entre deux appels (audit 9, A1).
                ORDER BY c.geom <-> pt.g, c.identifiant_source
              ) AS rang
         FROM contrainte c, pt
        WHERE c.type = ANY($3)
          -- PREFILTRE EN ESPACE GEOMETRIQUE, puis filtre metrique exact.
          --
          -- Le seul filtre geographique a ete mesure a 847 ms par parcelle sur 6 617 objets : le
          -- transtypage en geography interdit l'usage de l'index GiST et force la conversion de
          -- toute la table a chaque appel. Avec les monuments historiques ingeres nationalement,
          -- l'ordre de grandeur passe a plusieurs secondes par parcelle. Le prefiltre en degres
          -- utilise l'index et ramene le tout a 8,4 ms, soit cent fois moins.
          --
          -- La marge en degres est calculee sur le degre de longitude, le plus court aux latitudes
          -- francaises : le prefiltre retient donc un peu PLUS que le rayon demande, jamais moins.
          -- Le filtre metrique qui suit tranche exactement, sur ces quelques candidats.
          AND ST_DWithin(c.geom, pt.g, $4 / (111320 * GREATEST(cos(radians($2)), 0.2)))
          AND ST_DWithin(c.geom::geography, pt.g::geography, $4)
     )
     SELECT type, nom, distance_m, contient, rang FROM proches
      WHERE rang <= 40
      ORDER BY type, distance_m, nom`,
    [pt[0], pt[1], typesIngeres, rayonM],
  );

  const mh = lignes.filter((l) => l.type === 'monument_historique');
  const siteClasse = lignes.filter((l) => l.type === 'site_classe');
  const siteInscrit = lignes.filter((l) => l.type === 'site_inscrit');
  const spr = lignes.filter((l) => l.type === 'spr');

  /**
   * Trois etats, et non deux.
   *
   * Couche non exploitable sur le disque de recherche -> `recouvre: null` (critere GRIS). Couche
   * complete sur tout le disque et rien dedans -> `recouvre: false` (absence constatee, vert legitime).
   */
  const zonage = (type: (typeof TYPES_PATRIMOINE)[number], l: typeof lignes) => {
    if (!exploitable[type]) return { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };
    if (l.length === 0) return { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
    return {
      recouvre: l[0]!.contient,
      partRecouvrement: l[0]!.contient ? 1 : 0,
      distanceM: Math.round(l[0]!.distance_m),
      nom: l[0]!.nom,
    };
  };

  const mhIngere = exploitable['monument_historique'];
  const distanceMhM = mh.length > 0 ? Math.round(mh[0]!.distance_m) : null;

  /**
   * L'avis de l'ABF est requis par PLUSIEURS motifs independants.
   *
   * Ancien comportement : `distanceMhM == null ? null : distanceMhM <= 500 || siteInscrit... `.
   * Le court-circuit sur l'absence de monument s'executait AVANT l'examen du site inscrit et du
   * SPR. Une parcelle a l'interieur d'un site inscrit, sans monument dans les 10 km, obtenait
   * `null` au lieu de `true` — alors que l'article L. 341-1 n'exige aucun monument.
   *
   * Chaque motif est donc evalue separement, et l'inconnu ne se propage que si AUCUN motif n'est
   * etabli : un seul motif vrai suffit a conclure `true`, meme si les autres sont inconnus.
   */
  const motifs: Array<boolean | null> = [
    mhIngere ? (distanceMhM != null && distanceMhM <= 500) : null,
    exploitable['site_inscrit'] ? siteInscrit.some((s) => s.contient) : null,
    exploitable['spr'] ? spr.some((s) => s.contient) : null,
  ];
  const avisAbfRequis = motifs.some((m) => m === true)
    ? true
    : motifs.every((m) => m === false)
      ? false
      : null;

  return {
    monumentHistorique: {
      distanceM: distanceMhM,
      // Le perimetre de protection est de 500 m par defaut, sauf PDA delimite.
      dansPerimetreProtection: !mhIngere || distanceMhM == null ? null : distanceMhM <= 500,
      nom: mh[0]?.nom ?? null,
    },
    siteClasse: zonage('site_classe', siteClasse),
    siteInscrit: zonage('site_inscrit', siteInscrit),
    spr: zonage('spr', spr),
    avisAbfRequis,
    // La covisibilite reelle exige une analyse de bassin visuel (MNT + occupation du sol) :
    // on n'expose qu'un indicateur derive de la densite patrimoniale a proximite.
    // Aucun indice de covisibilite n'est calcule : il valait « nombre de monuments x 6 »,
    // une arithmetique sans contenu presentee comme une mesure sur 100. La covisibilite
    // depend du relief, des masques, des distances et de l'appreciation de l'ABF. Seuls
    // les faits verifiables sont conserves : distance au monument et nombre dans le rayon.
    covisibiliteIndice: null,
    sensibiliteArcheologique: null,
  };
}
