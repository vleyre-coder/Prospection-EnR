/**
 * Connecteurs WFS de la Geoplateforme IGN.
 *
 * Pieges verifies (docs/API_CONTRACTS.md §8) :
 *   - `BBOX` s'exprime en `lon,lat` (et le `CQL_FILTER BBOX()` en `lat,lon`) : une inversion
 *     ne provoque AUCUNE erreur, seulement 0 feature en HTTP 200 ;
 *   - `COUNT` est plafonne a 5000 ;
 *   - la limitation de debit est de 1 requete/seconde avec un burst de 30 : les appels sont
 *     donc serialises par le limiteur de concurrence du client HTTP et mis en cache.
 */

import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxDe, elargirBbox, surfaceM2, type Bbox, type GeoJsonGeometry } from '../geo.js';
import type { FeatureCollection } from './base.js';
import { distanceMinEntreGeometries, recouvrement } from './distances.js';

/** Typenames verifies. */
export const TYPENAMES = {
  bati: 'BDTOPO_V3:batiment',
  troncon_route: 'BDTOPO_V3:troncon_de_route',
  cours_eau: 'BDTOPO_V3:cours_d_eau',
  poste_transformation: 'BDTOPO_V3:poste_de_transformation',
  foret: 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale',
  zones_humides: 'TOURBIERES_ZONES-HUMIDES.BCAE:bcae',
  aoc_viticole: 'AOC-VITICOLES:aire_parcellaire',
  znieff1: 'patrinat_znieff1:znieff1',
  rpg: 'RPG.LATEST:parcelles_graphiques',
} as const;

/** Plafond de `COUNT` impose par la Geoplateforme (verifie : au-dela, la valeur est ignoree). */
const COUNT_MAX_WFS = 5000;

/** Seuil d'eloignement de l'habitat le plus exigeant du referentiel (eolien, L.515-44). */
const RAYON_HABITAT_M = 500;

/** Reponse WFS accompagnee de l'information de troncature. */
export interface ReponseWfs<P> {
  fc: FeatureCollection<P>;
  /**
   * `true` lorsque le service annonce plus d'objets qu'il n'en a renvoye. Le sous-ensemble
   * renvoye est alors arbitraire : aucune grandeur qui suppose l'exhaustivite (distance
   * minimale, comptage, absence) n'est calculable dessus.
   */
  tronquee: boolean;
}

/**
 * La reponse est-elle tronquee ?
 *
 * Predicat isole pour etre verifiable sans reseau : c'est lui qui decide si une grandeur est
 * calculable, donc la moindre erreur ici se propage a tout le reste du connecteur.
 */
export function reponseTronquee(
  fc: Pick<FeatureCollection<unknown>, 'features' | 'numberMatched' | 'numberReturned' | 'totalFeatures'>,
  plafond: number,
): boolean {
  const renvoyes = fc.numberReturned ?? fc.features.length;
  const total = fc.numberMatched ?? fc.totalFeatures ?? null;
  // Le WFS 2.0.0 de la Geoplateforme renseigne numberMatched : on s'en sert en priorite.
  // Faute de total annonce, on considere qu'une reponse pleine au plafond est tronquee ;
  // c'est parfois un faux positif (exactement `plafond` objets), jamais un faux negatif.
  return total != null ? renvoyes < total : renvoyes >= plafond;
}

/**
 * Ne conserve une distance minimale que si l'emprise interrogee la demontre.
 *
 * Au-dela du rayon couvert, le minimum trouve n'est qu'un majorant : un objet plus proche
 * peut exister hors emprise. Or un majorant est ici optimiste — plus loin d'une habitation
 * ou d'un cours d'eau vaut une meilleure note — donc inexploitable.
 */
export function distanceDemontree(d: number | null, rayonCouvertM: number): number | null {
  return d != null && d <= rayonCouvertM ? d : null;
}

async function getFeature<P>(
  typename: string,
  bbox: Bbox,
  connecteur: string,
  count = 1000,
): Promise<ReponseWfs<P>> {
  const plafond = Math.min(count, COUNT_MAX_WFS);
  // ATTENTION : ordre lon,lat pour le parametre BBOX du WFS.
  const url = avecParams(config.sources.geoplateformeWfs, {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typename,
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]},EPSG:4326`,
    COUNT: plafond,
  });
  const fc = await jsonExterne<FeatureCollection<P>>(url, { connecteur, timeoutMs: 30000 });
  return { fc, tronquee: reponseTronquee(fc, plafond) };
}

/** Reponse exhaustive sur un rayon connu autour de la parcelle. */
interface ReponseEtagee<P> {
  fc: FeatureCollection<P>;
  /**
   * Rayon, en metres autour de la parcelle, sur lequel la reponse est exhaustive : la bbox
   * interrogee contient le tampon de ce rayon, donc tout objet situe a une distance
   * inferieure ou egale y figure.
   */
  rayonCouvertM: number;
  bbox: Bbox;
}

/**
 * Interrogation a emprise degressive.
 *
 * Le WFS tronque silencieusement les reponses volumineuses : en centre-ville, la couche
 * batiment annonce 15 000 objets sur une emprise de 1500 m et n'en renvoie que 3000, choisis
 * dans un ordre non documente. Calculer une distance minimale sur ce sous-ensemble donne un
 * resultat faux, et faux dans le sens dangereux (trop grand, donc trop favorable).
 *
 * On retente donc sur des emprises de plus en plus petites jusqu'a obtenir une reponse
 * complete. Une reponse complete sur un petit rayon reste exacte pour toute grandeur dont la
 * valeur est inferieure a ce rayon : ce qui est au-dela est, par construction, plus loin.
 * Si aucune emprise ne tient dans le plafond, on renonce (`null`) plutot que d'affirmer faux.
 */
async function getFeatureEtage<P>(
  typename: string,
  parcelle: GeoJsonGeometry,
  connecteur: string,
  rayonsM: readonly number[],
  count: number,
): Promise<ReponseEtagee<P> | null> {
  const bboxParcelle = bboxDe(parcelle);
  for (const rayonM of rayonsM) {
    const bbox = elargirBbox(bboxParcelle, rayonM);
    const { fc, tronquee } = await getFeature<P>(typename, bbox, connecteur, count);
    if (!tronquee) return { fc, rayonCouvertM: rayonM, bbox };
  }
  return null;
}

/** Surface, en km2, de l'emprise reellement interrogee — pour normaliser une densite. */
function surfaceBboxKm2(bbox: Bbox): number {
  return (
    surfaceM2({
      type: 'Polygon',
      coordinates: [
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[1]],
          [bbox[2], bbox[3]],
          [bbox[0], bbox[3]],
          [bbox[0], bbox[1]],
        ],
      ],
    }) / 1e6
  );
}

// ---------------------------------------------------------------------------
// Bati : distances reglementaires a l'habitat
// ---------------------------------------------------------------------------

interface ProprietesBatiment {
  cleabs?: string;
  usage_1?: string | null;
  usage_2?: string | null;
  nature?: string | null;
  hauteur?: number | null;
  nombre_de_logements?: number | null;
}

/** Un batiment compte-t-il comme habitation au sens de l'article L.515-44 ? */
export function estHabitation(p: ProprietesBatiment): boolean {
  const usages = [p.usage_1, p.usage_2].map((u) => (u ?? '').toLowerCase());
  if (usages.some((u) => u.includes('habitation') || u.includes('résidentiel') || u.includes('residentiel'))) {
    return true;
  }
  if ((p.nombre_de_logements ?? 0) > 0) return true;
  // Les batiments agricoles, industriels et les annexes ne sont pas des habitations,
  // mais un batiment de nature indeterminee est traite comme habitation par prudence.
  const nature = (p.nature ?? '').toLowerCase();
  if (nature.includes('agricole') || nature.includes('industriel') || nature.includes('serre')) return false;
  return usages.every((u) => u === '');
}

/**
 * Distances a l'habitat, calculees sur la BD TOPO.
 *
 * `rayonM` doit couvrir le seuil reglementaire de la filiere la plus exigeante (500 m pour
 * l'eolien) plus une marge, afin que la valeur affichee soit exploitable meme au-dela.
 *
 * En milieu dense le WFS tronque la couche batiment : on se replie alors sur l'emprise
 * reglementaire de 500 m, complete, qui suffit a trancher tous les seuils du referentiel.
 * Toute grandeur non demontrable sur l'emprise reellement couverte est rendue a `null` :
 * un critere grise est exploitable, un critere faux ne l'est pas.
 */
export async function distancesBati(
  parcelle: GeoJsonGeometry,
  rayonM = 1500,
): Promise<{
  distanceHabitationM: number | null;
  nbHabitationsRayon500m: number | null;
  densiteBati1km: number | null;
} | null> {
  try {
    // Paliers : l'emprise large pour la valeur la plus informative, puis le rayon
    // reglementaire (complet partout ou mesure, y compris Paris 11e), puis un dernier
    // recours qui sauve au moins la distance a l'habitation la plus proche.
    const rayons = [rayonM, RAYON_HABITAT_M, 200].filter(
      (r, i, t) => r <= rayonM && t.indexOf(r) === i,
    );
    const r = await getFeatureEtage<ProprietesBatiment>(
      TYPENAMES.bati,
      parcelle,
      'ign_bdtopo',
      rayons,
      COUNT_MAX_WFS,
    );
    if (!r) {
      return { distanceHabitationM: null, nbHabitationsRayon500m: null, densiteBati1km: null };
    }

    const habitations = r.fc.features.filter((f) => f.geometry && estHabitation(f.properties));
    const geomsHabitation = habitations.map((f) => f.geometry as GeoJsonGeometry);

    const distanceHabitationM = distanceDemontree(
      distanceMinEntreGeometries(parcelle, geomsHabitation),
      r.rayonCouvertM,
    );

    const nbHabitationsRayon500m =
      r.rayonCouvertM >= RAYON_HABITAT_M
        ? geomsHabitation.filter((g) => {
            const d = distanceMinEntreGeometries(parcelle, [g]);
            return d != null && d <= RAYON_HABITAT_M;
          }).length
        : null;

    // Densite rapportee a l'emprise reellement interrogee et complete : le denominateur suit
    // le rayon retenu, faute de quoi un repli sur 500 m diviserait la densite par dix.
    const surfaceKm2 = surfaceBboxKm2(r.bbox);

    return {
      distanceHabitationM,
      nbHabitationsRayon500m,
      densiteBati1km: surfaceKm2 > 0 ? Math.round(r.fc.features.length / surfaceKm2) : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Voirie : desserte et acces poids lourds
// ---------------------------------------------------------------------------

interface ProprietesRoute {
  cleabs?: string;
  nature?: string | null;
  importance?: string | null;
  largeur_de_chaussee?: number | null;
  nombre_de_voies?: number | null;
}

export async function acces(
  parcelle: GeoJsonGeometry,
): Promise<{ distanceVoirieM: number | null; accesPoidsLourds: boolean | null } | null> {
  try {
    // Meme troncature qu'en couche batiment sur les grandes agglomerations (2766 troncons
    // annonces pour 2000 renvoyes a Orleans) : emprise degressive jusqu'a 500 m, rayon qui
    // porte aussi le test d'acces poids lourds.
    const r = await getFeatureEtage<ProprietesRoute>(
      TYPENAMES.troncon_route,
      parcelle,
      'ign_bdtopo',
      [1500, RAYON_HABITAT_M],
      COUNT_MAX_WFS,
    );
    if (!r) return { distanceVoirieM: null, accesPoidsLourds: null };

    const routes = r.fc.features.filter((f) => f.geometry);
    if (routes.length === 0) return { distanceVoirieM: null, accesPoidsLourds: null };

    const distanceVoirieM = distanceDemontree(
      distanceMinEntreGeometries(parcelle, routes.map((f) => f.geometry as GeoJsonGeometry)),
      r.rayonCouvertM,
    );

    // Une chaussee de 5 m ou plus, a moins de 500 m, rend un acces poids lourds plausible.
    const routesLarges = routes.filter((f) => {
      const l = f.properties.largeur_de_chaussee ?? 0;
      const nature = (f.properties.nature ?? '').toLowerCase();
      return l >= 5 || nature.includes('route à') || nature.includes('type autoroutier');
    });
    const distanceRouteLarge =
      routesLarges.length > 0
        ? distanceMinEntreGeometries(parcelle, routesLarges.map((f) => f.geometry as GeoJsonGeometry))
        : null;
    // Le test « a moins de 500 m » n'a de sens que si les 500 m sont couverts en entier.
    const couvre500 = r.rayonCouvertM >= 500;

    return {
      distanceVoirieM,
      accesPoidsLourds:
        distanceRouteLarge == null || !couvre500 ? null : distanceRouteLarge <= 500,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hydrographie : seuil de 35 m pour la methanisation
// ---------------------------------------------------------------------------

export async function distanceCoursEau(parcelle: GeoJsonGeometry): Promise<number | null> {
  try {
    // Le seuil reglementaire structurant est de 35 m (methanisation) : un repli sur 200 m
    // reste largement suffisant pour le trancher.
    const r = await getFeatureEtage<{ cleabs?: string }>(
      TYPENAMES.cours_eau,
      parcelle,
      'ign_bdtopo',
      [1000, 200],
      COUNT_MAX_WFS,
    );
    if (!r) return null;
    const geoms = r.fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    if (geoms.length === 0) return null;
    return distanceDemontree(distanceMinEntreGeometries(parcelle, geoms), r.rayonCouvertM);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BD Foret : enjeu defrichement
// ---------------------------------------------------------------------------

interface ProprietesForet {
  code_tfv?: string | null;
  tfv?: string | null;
  essence?: string | null;
}

export async function foret(
  parcelle: GeoJsonGeometry,
  surfaceParcelleM2: number,
): Promise<{ recouvre: boolean | null; partBoisee: number | null; type: string | null } | null> {
  try {
    const { fc, tronquee } = await getFeature<ProprietesForet>(
      TYPENAMES.foret,
      bboxDe(parcelle),
      'ign_bdforet',
      COUNT_MAX_WFS,
    );
    const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    const { recouvre } = recouvrement(parcelle, geoms);
    // L'emprise est ici celle de la parcelle : il n'y a pas de rayon a reduire. On applique
    // donc la seule regle sure face a une troncature : un recouvrement constate reste vrai
    // (il suffit d'une formation), une absence constatee ne prouve plus rien.
    if (!recouvre) {
      return tronquee ? null : { recouvre: false, partBoisee: 0, type: null };
    }

    // Part boisee approchee : on ne calcule pas l'intersection exacte cote client, on borne
    // par le rapport des surfaces des formations recouvrantes. Tronquee, cette somme est
    // sous-estimee, donc optimiste sur l'enjeu defrichement : on prefere ne rien afficher.
    const surfaceForet = geoms.reduce((a, g) => a + surfaceM2(g), 0);
    const part =
      tronquee || surfaceParcelleM2 <= 0
        ? null
        : Math.min(1, Math.round((surfaceForet / surfaceParcelleM2) * 100) / 100);
    return {
      recouvre: true,
      partBoisee: part,
      type: fc.features[0]?.properties.tfv ?? fc.features[0]?.properties.essence ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Zones humides (BCAE) : PRE-REPERAGE uniquement
// ---------------------------------------------------------------------------

export async function zoneHumide(
  parcelle: GeoJsonGeometry,
): Promise<'oui' | 'non' | 'a_confirmer' | null> {
  try {
    const bbox = elargirBbox(bboxDe(parcelle), 300);
    const { fc, tronquee } = await getFeature<{ type_zone?: string | null }>(
      TYPENAMES.zones_humides,
      bbox,
      'zones_humides',
      COUNT_MAX_WFS,
    );
    const geoms = fc.features.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean);
    if (geoms.length === 0) {
      // Absence dans cet inventaire ne vaut pas absence de zone humide : les inventaires
      // departementaux ne sont pas tous integres a la couche BCAE.
      return 'non';
    }
    const { recouvre, distanceM } = recouvrement(parcelle, geoms);
    if (recouvre) {
      const effective = fc.features.some((f) =>
        (f.properties.type_zone ?? '').toLowerCase().includes('effective'),
      );
      return effective ? 'oui' : 'a_confirmer';
    }
    // Tronquee, la reponse ne permet plus de conclure a l'absence : le sous-ensemble renvoye
    // peut omettre la zone recouvrante. Un faux « non » ici ferait sauter un knock-out.
    if (tronquee) return null;
    // Une zone humide a moins de 100 m impose de verifier l'extension reelle sur le terrain.
    return distanceM != null && distanceM < 100 ? 'a_confirmer' : 'non';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AOC viticoles (INAO)
// ---------------------------------------------------------------------------

export async function aocViticole(
  parcelle: GeoJsonGeometry,
): Promise<{ presente: boolean; viticole: boolean; appellations: string[] } | null> {
  try {
    const { fc, tronquee } = await getFeature<{ denom?: string | null; crinao?: string | null }>(
      TYPENAMES.aoc_viticole,
      bboxDe(parcelle),
      'aoc_viticole',
      COUNT_MAX_WFS,
    );
    const recouvrantes = fc.features.filter((f) => {
      if (!f.geometry) return false;
      return recouvrement(parcelle, [f.geometry as GeoJsonGeometry]).recouvre;
    });
    // Une aire recouvrante trouvee reste vraie malgre une troncature ; une absence, non.
    if (recouvrantes.length === 0 && tronquee) return null;
    const appellations = [
      ...new Set(recouvrantes.map((f) => f.properties.denom).filter((d): d is string => Boolean(d))),
    ];
    return {
      presente: recouvrantes.length > 0,
      viticole: recouvrantes.length > 0,
      appellations,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// RPG via WFS : utilise en repli lorsque le module API Carto RPG echoue
// ---------------------------------------------------------------------------

export interface ProprietesRpgWfs {
  id_parcel?: string;
  surf_parc?: number;
  code_cultu?: string | null;
  code_group?: string | null;
  culture_d1?: string | null;
  culture_d2?: string | null;
}

export async function rpgParWfs(
  parcelle: GeoJsonGeometry,
): Promise<ReponseWfs<ProprietesRpgWfs> | null> {
  try {
    // L'ancien plafond de 200 etait atteignable sur une grande parcelle : porte au maximum
    // du service. La troncature est remontee a l'appelant, qui seul sait si l'ilot cherche a
    // ete trouve — une absence sur reponse tronquee ne vaut pas « aucune declaration ».
    return await getFeature<ProprietesRpgWfs>(
      TYPENAMES.rpg,
      bboxDe(parcelle),
      'apicarto_rpg',
      COUNT_MAX_WFS,
    );
  } catch {
    return null;
  }
}
