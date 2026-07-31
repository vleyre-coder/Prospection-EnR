/**
 * Pipeline d'enrichissement : transforme une parcelle cadastrale en `ParcelleSnapshot`
 * complet, pret a etre score.
 *
 * Principes :
 *   - tous les connecteurs sont appeles en parallele et INDEPENDAMMENT : l'echec de l'un
 *     n'invalide pas les autres ;
 *   - un connecteur en echec laisse ses champs a null, ce qui produit des criteres GRIS ;
 *   - chaque bloc de donnees porte sa source (tracabilite) ;
 *   - la liste des connecteurs en echec est remontee a l'appelant et affichee dans la fiche.
 */

import type { Identite, ParcelleSnapshot, SourceRef } from '@enr/core';
import { snapshotVide } from '@enr/core';
import { journal } from './journal.js';
import { bboxDe, elargirBbox, bboxEnPolygone, type GeoJsonGeometry, type Position } from './geo.js';
import { CONNECTEURS, sourceRef } from './connecteurs/base.js';
import type { ParcelleBrute } from './connecteurs/cadastre.js';
import { contexteFoncier } from './connecteurs/cadastre.js';
import { distanceZoneHabitat, urbanismeParcelle } from './connecteurs/gpu.js';
import { occupationSol } from './connecteurs/rpg.js';
import { milieuxNaturels } from './connecteurs/nature.js';
import { risquesEtEau } from './connecteurs/georisques.js';
import { topographie } from './connecteurs/altimetrie.js';
import { gisementComplet } from './connecteurs/gisement.js';
import { acces, aocViticole, distanceCoursEau, distancesBati, foret, zoneHumide } from './connecteurs/wfs.js';
import {
  documentCadrePv,
  patrimoine,
  postesLesPlusProches,
  reseauGaz,
  zaer,
} from './connecteurs/locales.js';

export interface ResultatEnrichissement {
  snapshot: ParcelleSnapshot;
  connecteursEnEchec: string[];
  dureeMs: number;
}

function identiteDepuisBrute(p: ParcelleBrute): Identite {
  return {
    idu: p.idu,
    codeInsee: p.codeInsee,
    nomCommune: p.nomCommune,
    codeDepartement: p.codeDepartement,
    codeEpci: null,
    nomEpci: null,
    prefixe: p.prefixe,
    section: p.section,
    numero: p.numero,
    contenanceM2: p.contenanceM2,
    surfaceCalculeeM2: p.surfaceCalculeeM2,
    centroide: p.centroide,
  };
}

/**
 * Enrichit une parcelle en interrogeant l'ensemble des sources.
 *
 * L'ordre d'appel n'est pas anodin : la couverture forestiere est necessaire au calcul du
 * type de sol, et la geometrie de la parcelle est necessaire partout. Les appels reellement
 * independants sont donc regroupes en une seule vague parallele, et seuls le RPG (qui depend
 * de la foret) et le foncier sont enchaines.
 */
export async function enrichirParcelle(parcelle: ParcelleBrute): Promise<ResultatEnrichissement> {
  const debut = Date.now();
  const geom = parcelle.geometrie;
  const centroide: Position = parcelle.centroide;
  const echecs = new Set<string>();

  const snapshot = snapshotVide(identiteDepuisBrute(parcelle));
  const sources: Record<string, SourceRef> = {
    apicarto_cadastre: sourceRef('apicarto_cadastre'),
  };

  // --- Vague 1 : tous les appels independants -------------------------------
  const [
    rUrbanisme,
    rForet,
    rMilieux,
    rRisques,
    rTopo,
    rGisement,
    rBati,
    rAcces,
    rCoursEau,
    rZoneHumide,
    rAoc,
    rPostes,
    rGaz,
    rZaer,
    rDocCadre,
    rPatrimoine,
    rZoneHabitat,
  ] = await Promise.all([
    urbanismeParcelle(geom, parcelle.surfaceCalculeeM2).catch((e) => {
      journal.warn({ err: e, idu: parcelle.idu }, 'Echec urbanisme');
      return null;
    }),
    foret(geom, parcelle.surfaceCalculeeM2),
    milieuxNaturels(geom).catch(() => null),
    risquesEtEau(centroide, parcelle.codeInsee).catch(() => null),
    topographie(geom),
    gisementComplet(centroide, parcelle.codeInsee).catch(() => null),
    distancesBati(geom),
    acces(geom),
    distanceCoursEau(geom),
    zoneHumide(geom),
    aocViticole(geom),
    postesLesPlusProches(centroide).catch(() => null),
    reseauGaz(centroide).catch(() => null),
    zaer(centroide, parcelle.codeDepartement).catch(() => null),
    documentCadrePv(centroide, parcelle.codeDepartement).catch(() => null),
    patrimoine(centroide).catch(() => null),
    distanceZoneHabitat(geom, bboxEnPolygone(elargirBbox(bboxDe(geom), 1000))),
  ]);

  // --- Urbanisme ------------------------------------------------------------
  if (rUrbanisme) {
    Object.assign(snapshot.urbanisme, rUrbanisme.urbanisme);
    rUrbanisme.echecs.forEach((e) => echecs.add(e));
    sources.apicarto_gpu = sourceRef('apicarto_gpu');
  } else {
    echecs.add('apicarto_gpu');
  }
  if (rZaer) {
    snapshot.urbanisme.zaer = rZaer;
    sources.zaer_local = sourceRef('zaer_local');
  } else {
    echecs.add('zaer_local');
  }
  if (rDocCadre) {
    snapshot.urbanisme.documentCadrePvSol = rDocCadre;
    sources.document_cadre_local = sourceRef('document_cadre_local', {
      dateMiseAJour: rDocCadre.dateArrete,
    });
  } else {
    echecs.add('document_cadre_local');
  }

  // --- Occupation du sol (depend de la couche foret) ------------------------
  // Le zonage dominant est necessaire pour classer correctement le type de sol.
  const zonageDominant =
    [...(snapshot.urbanisme.zonages ?? [])].sort(
      (a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0),
    )[0] ?? null;
  const rOccupation = await occupationSol(
    geom,
    parcelle.surfaceCalculeeM2,
    rForet,
    zonageDominant?.typeZone ?? zonageDominant?.libelle ?? null,
  ).catch(() => null);
  if (rOccupation) {
    Object.assign(snapshot.occupationSol, rOccupation.occupation);
    rOccupation.echecs.forEach((e) => echecs.add(e));
    sources.apicarto_rpg = sourceRef('apicarto_rpg', {
      millesime: rOccupation.occupation.rpg?.millesime ?? null,
    });
  } else {
    echecs.add('apicarto_rpg');
  }
  if (rForet) {
    sources.ign_bdforet = sourceRef('ign_bdforet');
  } else {
    echecs.add('ign_bdforet');
  }
  if (rAoc) {
    snapshot.occupationSol.aop = rAoc;
    sources.aoc_viticole = sourceRef('aoc_viticole');
  } else {
    echecs.add('aoc_viticole');
  }

  // --- Topographie ---------------------------------------------------------
  if (rTopo) {
    Object.assign(snapshot.topographie, rTopo);
    sources.ign_alti = sourceRef('ign_alti');
  } else {
    echecs.add('ign_alti');
  }

  // --- Risques, eau, geotechnique -----------------------------------------
  if (rRisques) {
    Object.assign(snapshot.risques, rRisques.risques);
    Object.assign(snapshot.eau, rRisques.eau);
    Object.assign(snapshot.topographie, rRisques.topographie);
    rRisques.echecs.forEach((e) => echecs.add(e));
    sources.georisques = sourceRef('georisques');
  } else {
    echecs.add('georisques');
  }
  if (rZoneHumide !== null) {
    snapshot.eau.zoneHumide = rZoneHumide;
    sources.zones_humides = sourceRef('zones_humides');
  } else {
    echecs.add('zones_humides');
  }
  if (rCoursEau !== null) {
    snapshot.eau.distanceCoursEauM = rCoursEau;
  }

  // --- Milieux naturels ----------------------------------------------------
  if (rMilieux) {
    Object.assign(snapshot.milieux, rMilieux.milieux);
    rMilieux.echecs.forEach((e) => echecs.add(e));
    sources.apicarto_nature = sourceRef('apicarto_nature');
    // L'enjeu defrichement decoule de la couverture forestiere.
    snapshot.milieux.enjeuDefrichement =
      rForet?.recouvre == null ? null : rForet.recouvre && (rForet.partBoisee ?? 0) > 0.05;
  } else {
    echecs.add('apicarto_nature');
  }

  // --- Patrimoine ----------------------------------------------------------
  if (rPatrimoine) {
    Object.assign(snapshot.patrimoine, rPatrimoine);
    sources.patrimoine_culture = sourceRef('patrimoine_culture');
  } else {
    echecs.add('patrimoine_culture');
  }

  // --- Raccordement --------------------------------------------------------
  if (rPostes && rPostes.length > 0) {
    snapshot.raccordement.posteLePlusProche = rPostes[0]!;
    snapshot.raccordement.postesAlternatifs = rPostes.slice(1);
    sources.postes_sources = sourceRef('postes_sources');
  } else {
    echecs.add('postes_sources');
  }
  if (rGaz) {
    snapshot.raccordement.reseauGaz = rGaz;
    sources.reseau_gaz = sourceRef('reseau_gaz');
  } else {
    echecs.add('reseau_gaz');
  }

  // --- Gisement ------------------------------------------------------------
  if (rGisement) {
    Object.assign(snapshot.gisement, rGisement);
    sources.gisement = sourceRef('gisement');
  } else {
    echecs.add('gisement');
  }

  // --- Bati et acces -------------------------------------------------------
  if (rBati) {
    Object.assign(snapshot.bati, rBati);
    sources.ign_bdtopo = sourceRef('ign_bdtopo');
  } else {
    echecs.add('ign_bdtopo');
  }
  snapshot.bati.distanceZoneHabitatM = rZoneHabitat;
  if (rAcces) {
    Object.assign(snapshot.acces, rAcces);
  }

  // --- Foncier -------------------------------------------------------------
  const rFoncier = await contexteFoncier(parcelle).catch(() => null);
  if (rFoncier) {
    Object.assign(snapshot.foncier, rFoncier);
    sources.foncier_cadastre = sourceRef('foncier_cadastre');
  } else {
    echecs.add('foncier_cadastre');
  }

  snapshot.sources = sources;
  snapshot.dateSnapshot = new Date().toISOString();

  const dureeMs = Date.now() - debut;
  journal.debug(
    { idu: parcelle.idu, dureeMs, echecs: [...echecs] },
    'Parcelle enrichie',
  );

  return { snapshot, connecteursEnEchec: [...echecs], dureeMs };
}

/** Part des blocs de donnees effectivement renseignes, pour supervision. */
export function couvertureSnapshot(snapshot: ParcelleSnapshot): number {
  const total = Object.keys(CONNECTEURS).length;
  const renseignes = Object.keys(snapshot.sources).length;
  return total === 0 ? 0 : Math.round((renseignes / total) * 1000) / 1000;
}
