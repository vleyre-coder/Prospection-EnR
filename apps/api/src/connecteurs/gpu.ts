/**
 * Connecteur urbanisme - IGN API Carto, module GPU (Geoportail de l'Urbanisme).
 *
 * Fournit le zonage PLU/PLUi/carte communale, les prescriptions (dont EBC et emplacements
 * reserves) et les servitudes d'utilite publique recouvrant une parcelle.
 */

import type { PrescriptionInfo, Urbanisme, ZoneUrbaInfo } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { surfaceM2, type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';

const CONNECTEUR = 'apicarto_gpu';

interface ProprietesZoneUrba {
  libelle?: string | null;
  libelong?: string | null;
  typezone?: string | null;
  destdomi?: string | null;
  urlfic?: string | null;
  datappro?: string | null;
  partition?: string | null;
  idurba?: string | null;
}

interface ProprietesPrescription {
  typepsc?: string | null;
  libelle?: string | null;
  txt?: string | null;
  nature?: string | null;
}

interface ProprietesDocument {
  typedoc?: string | null;
  datappro?: string | null;
  partition?: string | null;
  nomreg?: string | null;
}

interface ProprietesMunicipality {
  partition?: string | null;
  insee?: string | null;
  is_rnu?: boolean | null;
}

/**
 * Codes de prescription du standard CNIG.
 * `01` = espace boise classe, `21` a `23` = emplacements reserves.
 */
function estEbc(typepsc: string | null | undefined): boolean {
  return typepsc === '01';
}

function estEmplacementReserve(typepsc: string | null | undefined): boolean {
  return typepsc != null && ['21', '22', '23'].includes(typepsc);
}

const TYPES_DOCUMENT: Record<string, Urbanisme['typeDocument']> = {
  PLU: 'PLU',
  PLUI: 'PLUi',
  PLUi: 'PLUi',
  POS: 'POS',
  CC: 'CC',
};

async function interroger<P>(chemin: string, geom: GeoJsonGeometry): Promise<FeatureCollection<P>> {
  const url = avecParams(`${config.sources.apicarto}/gpu/${chemin}`, { geom: geomParam(geom) });
  return jsonExterne<FeatureCollection<P>>(url, { connecteur: CONNECTEUR });
}

/**
 * Recupere l'ensemble des informations d'urbanisme d'une parcelle.
 * Chaque sous-appel echoue independamment : un echec laisse le champ correspondant a null
 * plutot que d'invalider tout le bloc.
 */
export async function urbanismeParcelle(
  geom: GeoJsonGeometry,
  surfaceParcelleM2: number,
): Promise<{ urbanisme: Partial<Urbanisme>; echecs: string[] }> {
  const echecs: string[] = [];
  const urbanisme: Partial<Urbanisme> = {};

  const [zones, prescriptions, documents, municipality, sups] = await Promise.allSettled([
    interroger<ProprietesZoneUrba>('zone-urba', geom),
    interroger<ProprietesPrescription>('prescription-surf', geom),
    interroger<ProprietesDocument>('document', geom),
    interroger<ProprietesMunicipality>('municipality', geom),
    interroger<{ suptype?: string | null; nomsuplitt?: string | null }>('assiette-sup-s', geom),
  ]);

  if (zones.status === 'fulfilled') {
    const surfaceRef = surfaceParcelleM2 > 0 ? surfaceParcelleM2 : null;
    urbanisme.zonages = zones.value.features.map<ZoneUrbaInfo>((f) => ({
      libelle: f.properties.libelle ?? f.properties.libelong ?? null,
      typeZone: f.properties.typezone ?? null,
      destinationDominante: f.properties.destdomi ?? null,
      urlReglement: f.properties.urlfic ?? null,
      dateApprobation: f.properties.datappro ?? null,
      // L'API renvoie la geometrie du zonage entier, pas l'intersection : la part de
      // recouvrement n'est donc qu'un ordre de grandeur, plafonnee a 1.
      partRecouvrement:
        surfaceRef && f.geometry
          ? Math.min(1, Math.round((surfaceM2(f.geometry as GeoJsonGeometry) / surfaceRef) * 100) / 100)
          : null,
    }));
  } else {
    echecs.push('gpu/zone-urba');
  }

  if (prescriptions.status === 'fulfilled') {
    urbanisme.prescriptions = prescriptions.value.features.map<PrescriptionInfo>((f) => ({
      type: f.properties.typepsc ?? null,
      libelle: f.properties.libelle ?? f.properties.txt ?? f.properties.nature ?? null,
      estEbc: estEbc(f.properties.typepsc),
      estEmplacementReserve: estEmplacementReserve(f.properties.typepsc),
    }));
  } else {
    echecs.push('gpu/prescription-surf');
  }

  if (documents.status === 'fulfilled') {
    const doc = documents.value.features[0]?.properties;
    const brut = (doc?.typedoc ?? '').toUpperCase();
    urbanisme.typeDocument = TYPES_DOCUMENT[brut] ?? (brut ? 'PLU' : null);
  } else {
    echecs.push('gpu/document');
  }

  if (municipality.status === 'fulfilled') {
    const m = municipality.value.features[0]?.properties;
    // Une commune presente dans le GPU avec is_rnu = true releve du reglement national.
    if (m?.is_rnu === true) {
      urbanisme.typeDocument = 'RNU';
      urbanisme.couvertParGpu = false;
    } else {
      urbanisme.couvertParGpu = municipality.value.features.length > 0;
    }
  } else {
    echecs.push('gpu/municipality');
  }

  if (sups.status === 'fulfilled') {
    urbanisme.servitudes = sups.value.features
      .map((f) => f.properties.suptype ?? f.properties.nomsuplitt)
      .filter((s): s is string => Boolean(s));
  } else {
    echecs.push('gpu/assiette-sup-s');
  }

  return { urbanisme, echecs };
}

/**
 * Distance a la zone destinee a l'habitation la plus proche (zonages U et AU du document
 * d'urbanisme) - necessaire pour l'application du seuil eolien de 500 m, qui vise aussi
 * les zones destinees a l'habitation et non seulement le bati existant.
 */
export async function distanceZoneHabitat(
  geom: GeoJsonGeometry,
  empriseElargie: GeoJsonGeometry,
): Promise<number | null> {
  try {
    const fc = await interroger<ProprietesZoneUrba>('zone-urba', empriseElargie);
    const habitat = fc.features.filter((f) => {
      const t = (f.properties.typezone ?? '').toUpperCase();
      const d = (f.properties.destdomi ?? '').toUpperCase();
      return /^(U|AU)/.test(t) && !/X|E|I|Y|Z/.test(t.slice(1)) && !d.includes('ACTIVITE');
    });
    if (habitat.length === 0) return null;
    const { distanceMinEntreGeometries } = await import('./distances.js');
    return distanceMinEntreGeometries(
      geom,
      habitat.map((f) => f.geometry as GeoJsonGeometry).filter(Boolean),
    );
  } catch {
    return null;
  }
}
