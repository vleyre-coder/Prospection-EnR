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

interface ProprietesZonage {
  nom_site?: string | null;
  nom?: string | null;
  sitecode?: string | null;
  id_mnhn?: string | null;
  url_fiche?: string | null;
  /** Servitudes GPU. */
  categorie?: string | null;
  libelle?: string | null;
  nomsuplitt?: string | null;
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

/** Nom lisible d'un objet : les services n'utilisent pas tous le meme attribut. */
function nomDe(p: ProprietesZonage): string {
  return (
    p.nom_site ||
    p.nom ||
    p.nomsuplitt ||
    p.libelle ||
    p.sitecode ||
    'sans nom'
  );
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
          url: f.properties.url_fiche ?? null,
        },
      });
    }
  });

  return { features, echecs };
}
