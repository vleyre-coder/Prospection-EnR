/**
 * Servitudes d'utilite publique (SUP) du Geoportail de l'Urbanisme.
 *
 * Le GPU est bien une API NATIONALE pour ces servitudes : elles y sont publiees par
 * categorie, selon la nomenclature du Conseil national de l'information geolocalisee.
 * Sa couverture est en revanche PARTIELLE - seules figurent les servitudes effectivement
 * televersees par les services de l'Etat et les collectivites. L'absence d'une categorie
 * sur un territoire ne prouve donc pas l'absence de servitude, d'ou la trace de couverture.
 *
 * Categories exploitees ici :
 *   AS1        perimetres de protection des captages d'eau potable
 *   T4, T5     servitudes aeronautiques de balisage et de degagement
 *   PT1 a PT3  servitudes radioelectriques (centres d'emission, faisceaux hertziens)
 *   I3, I4     canalisations de gaz et ouvrages electriques
 *   AC1, AC2   monuments historiques et sites proteges
 *   PM1 a PM3  plans de prevention des risques
 */

import type { Eau, Risques } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxDe, bboxEnPolygone, elargirBbox, type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import { recouvrement } from './distances.js';

const CONNECTEUR = 'apicarto_gpu';

interface ProprietesSup {
  suptype?: string | null;
  nomsuplitt?: string | null;
  /**
   * Identifiant de l'assiette. `idsup` etait declare ici et n'existe pas dans la reponse : il
   * n'etait pas lu, donc sans consequence, mais une propriete declaree qui n'existe pas fait
   * croire a un contrat verifie. C'est le voisinage exact ou se cachait le defaut des PPR.
   */
  idass?: string | null;
}

export interface Servitude {
  categorie: string;
  libelle: string | null;
  /** La servitude recouvre-t-elle la parcelle ? */
  recouvre: boolean;
  /** Distance en m si elle ne la recouvre pas. */
  distanceM: number | null;
}

/** Perimetre de protection de captage : la sous-categorie n'est pas exposee par le GPU. */
const CATEGORIES_CAPTAGE = ['as1'];
const CATEGORIES_AERONAUTIQUE = ['t4', 't5', 't7'];
const CATEGORIES_RADIOELECTRIQUE = ['pt1', 'pt2', 'pt3'];
const CATEGORIES_RESEAUX = ['i1', 'i3', 'i4', 'i6'];

/**
 * Recupere les servitudes recouvrant la parcelle et celles situees dans un rayon proche.
 *
 * Le rayon elargi sert aux servitudes dont la seule proximite compte : un perimetre de
 * captage voisin impose des prescriptions bien avant d'etre recouvert.
 */
export async function servitudes(
  parcelle: GeoJsonGeometry,
  rayonM = 1000,
): Promise<{ liste: Servitude[]; eau: Partial<Eau>; risques: Partial<Risques> } | null> {
  try {
    const emprise = bboxEnPolygone(elargirBbox(bboxDe(parcelle), rayonM));
    const url = avecParams(`${config.sources.apicarto}/gpu/assiette-sup-s`, {
      geom: geomParam(emprise),
    });
    const fc = await jsonExterne<FeatureCollection<ProprietesSup>>(url, {
      connecteur: CONNECTEUR,
      timeoutMs: 30000,
    });

    const liste: Servitude[] = [];
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const categorie = (f.properties.suptype ?? '').toLowerCase();
      if (!categorie) continue;
      const { recouvre, distanceM } = recouvrement(parcelle, [f.geometry as GeoJsonGeometry]);
      liste.push({
        categorie,
        libelle: f.properties.nomsuplitt?.trim() || null,
        recouvre: recouvre === true,
        distanceM,
      });
    }

    const parCategorie = (categories: string[]): Servitude[] =>
      liste.filter((s) => categories.includes(s.categorie));

    // --- Captages d'eau potable ------------------------------------------
    const captages = parCategorie(CATEGORIES_CAPTAGE);
    const captageRecouvrant = captages.find((s) => s.recouvre);
    const captagePlusProche = [...captages]
      .filter((s) => s.distanceM != null)
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))[0];

    const eau: Partial<Eau> = {
      captageAep: {
        dansPerimetre: captageRecouvrant != null ? true : captages.length > 0 ? false : null,
        // Le GPU expose l'assiette de la servitude sans distinguer les perimetres
        // immediat, rapproche et eloigne : la sous-categorie doit etre lue sur l'arrete
        // de declaration d'utilite publique du captage. On ne l'invente pas.
        type: null,
        distanceM: captageRecouvrant ? 0 : (captagePlusProche?.distanceM ?? null),
      },
    };

    // --- Aeronautique, radioelectrique, reseaux --------------------------
    const aero = parCategorie(CATEGORIES_AERONAUTIQUE);
    const radio = parCategorie(CATEGORIES_RADIOELECTRIQUE);
    const reseaux = parCategorie(CATEGORIES_RESEAUX);

    const risques: Partial<Risques> = {
      // `false` seulement si l'on a effectivement recu des servitudes pour ce secteur :
      // sinon la couverture du GPU est inconnue et le critere doit rester gris.
      servitudesAeronautiques:
        aero.some((s) => s.recouvre) ? true : liste.length > 0 ? false : null,
      faisceauxHertziens: radio.some((s) => s.recouvre) ? true : liste.length > 0 ? false : null,
      reseauxEnterres: reseaux
        .filter((s) => s.recouvre)
        .map((s) => s.libelle ?? libelleCategorie(s.categorie)),
    };

    return { liste, eau, risques };
  } catch {
    return null;
  }
}

const LIBELLES: Record<string, string> = {
  as1: "Perimetre de protection de captage d'eau potable",
  t4: 'Servitude aeronautique de balisage',
  t5: 'Servitude aeronautique de degagement',
  t7: "Servitude relative aux installations exterieures a un aerodrome",
  pt1: 'Servitude de protection contre les perturbations electromagnetiques',
  pt2: 'Servitude de protection contre les obstacles radioelectriques',
  pt3: 'Servitude relative aux communications telephoniques et telegraphiques',
  i1: "Servitude relative aux canalisations d'hydrocarbures",
  i3: 'Servitude relative aux canalisations de gaz',
  i4: 'Servitude relative aux ouvrages electriques',
  i6: "Servitude relative a l'exploitation miniere",
  ac1: 'Servitude de protection des monuments historiques',
  ac2: 'Servitude de protection des sites et monuments naturels',
  pm1: 'Plan de prevention des risques naturels ou technologiques',
};

export function libelleCategorie(categorie: string): string {
  return LIBELLES[categorie.toLowerCase()] ?? `Servitude ${categorie.toUpperCase()}`;
}
