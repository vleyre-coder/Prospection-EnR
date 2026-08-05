/**
 * Zonages d'inventaire et de protection sur une emprise, pour l'affichage cartographique.
 *
 * Distinct de `nature.ts`, qui interroge les memes services mais autour d'UNE parcelle pour
 * alimenter le scoring. Ici, on sert un calque : l'emprise est celle de l'ecran, la
 * geometrie est simplifiee, et un echec partiel doit etre signale plutot que masque - un
 * calque incomplet presente comme complet ferait conclure a l'absence de contrainte.
 */

import { config } from '../config.js';
import { journal } from '../journal.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxEnPolygone, type Bbox } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import type { DefinitionCalque } from '../calques.js';

/**
 * Proprietes des objets servis par les calques.
 *
 * ATTENTION, LE NOM DU SITE ET L'URL CHANGENT DE CHAMP SELON LA COUCHE. Verifie sur les services
 * reels, et cause de deux defauts corriges ici :
 *   - `natura-habitat` et `natura-oiseaux` : le nom est dans **`sitename`**. Ni `nom_site` ni
 *     `nom` n'existent. Le repli de `nomDe()` aboutissait donc sur `sitecode`, et la carte
 *     etiquetait les sites Natura 2000 « FR9301590 » au lieu de « Camargue » ;
 *   - `znieff1/2`, `pn`, `pnr`, `rnn`, `rnc`, `rncf` : le nom est dans **`nom`** ;
 *   - l'URL de fiche est dans **`url`**, jamais `url_fiche`. Mesure : `null` sur les six calques
 *     testes, sans exception — le lien vers la fiche INPN n'a jamais fonctionne.
 *
 * `nom_site` n'est PAS declare ici : il n'appartient qu'au WFS PatriNat, que ce module
 * n'interroge pas.
 */
interface ProprietesZonage {
  /** Couches Natura 2000 d'API Carto. */
  sitename?: string | null;
  /** Couches d'inventaire et de protection d'API Carto. */
  nom?: string | null;
  sitecode?: string | null;
  id_mnhn?: string | null;
  /** Fiche descriptive INPN. */
  url?: string | null;
  /** Servitudes GPU. */
  nomsuplitt?: string | null;
  nomass?: string | null;
}

export interface EntiteZonage {
  type: 'Feature';
  geometry: unknown;
  properties: {
    nom: string;
    calque: string;
    reference: string | null;
    url: string | null;
  };
}

/**
 * Nom lisible d'un objet : les services n'utilisent pas tous le meme attribut.
 *
 * `sitecode` reste en dernier recours, mais APRES les vrais noms. C'est ce repli qui produisait
 * « FR9301590 » sur la carte : les quatre champs testes avant lui etaient tous absents des
 * couches Natura 2000. Un code d'apparence technique passe pour une donnee, ce qui est pire
 * qu'un « sans nom » explicite — d'ou l'ordre, et d'ou le test qui le verrouille.
 */
function nomDe(p: ProprietesZonage): string {
  return p.sitename || p.nom || p.nomsuplitt || p.nomass || p.sitecode || 'sans nom';
}

async function moduleNature(chemin: string, bbox: Bbox): Promise<FeatureCollection<ProprietesZonage>> {
  const url = avecParams(`${config.sources.apicarto}/nature/${chemin}`, {
    geom: geomParam(bboxEnPolygone(bbox)),
  });
  return jsonExterne<FeatureCollection<ProprietesZonage>>(url, {
    connecteur: 'apicarto_nature',
    timeoutMs: 30000,
  });
}

/** Servitudes d'utilite publique du GPU, par categorie (ac1, ac2, ac4...). */
async function servitudeGpu(
  categorie: string,
  bbox: Bbox,
): Promise<FeatureCollection<ProprietesZonage>> {
  const url = avecParams(`${config.sources.apicarto}/gpu/assiette-sup-s`, {
    geom: geomParam(bboxEnPolygone(bbox)),
    categorie,
  });
  return jsonExterne<FeatureCollection<ProprietesZonage>>(url, {
    connecteur: 'apicarto_gpu',
    timeoutMs: 30000,
  });
}

/**
 * Interroge tous les modules d'un calque et fusionne les resultats.
 *
 * `Promise.allSettled` et non `Promise.all` : un module en echec ne doit pas vider le
 * calque entier, mais son echec est remonte pour que l'interface le dise.
 */
export async function zonagesSurEmprise(
  calque: DefinitionCalque,
  bbox: Bbox,
): Promise<{ features: EntiteZonage[]; echecs: string[] }> {
  const chemins = calque.cheminsApi ?? [];
  const resultats = await Promise.allSettled(
    chemins.map((c) =>
      c.startsWith('gpu:') ? servitudeGpu(c.slice(4), bbox) : moduleNature(c, bbox),
    ),
  );

  const features: EntiteZonage[] = [];
  const echecs: string[] = [];

  chemins.forEach((chemin, i) => {
    const r = resultats[i]!;
    if (r.status !== 'fulfilled') {
      echecs.push(chemin);
      journal.debug({ chemin, calque: calque.id }, 'Module de zonage indisponible');
      return;
    }
    for (const f of r.value.features ?? []) {
      if (!f.geometry) continue;
      features.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          nom: nomDe(f.properties),
          calque: calque.id,
          reference: f.properties.sitecode ?? f.properties.id_mnhn ?? null,
          url: f.properties.url ?? null,
        },
      });
    }
  });

  return { features, echecs };
}
