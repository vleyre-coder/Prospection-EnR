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
import { assainirSnapshot, snapshotVide, type AnomalieBorne } from '@enr/core';
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
import { acces, aocViticole, appb, distanceCoursEau, distancesBati, foret, zoneHumide } from './connecteurs/wfs.js';
import { libelleCategorie, servitudes } from './connecteurs/servitudes.js';
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
  /**
   * Grandeurs trouvees hors bornes de vraisemblance et ramenees a « donnee indisponible ».
   *
   * Remonte jusqu'a l'appelant pour que la supervision les compte : une campagne qui en produit
   * beaucoup signale un connecteur ou un calcul qui a derive, pas des parcelles atypiques.
   */
  anomaliesBornes: AnomalieBorne[];
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
    rServitudes,
    rAppb,
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
    servitudes(geom).catch(() => null),
    // Arrete de protection de biotope : le knock-out existait, la donnee non.
    appb(geom),
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
  // Les servitudes d'utilite publique du GPU completent Georisques : elles apportent les
  // perimetres de captage, les servitudes aeronautiques et radioelectriques, et les reseaux,
  // que Georisques n'expose pas. Elles sont fusionnees APRES lui pour avoir la priorite sur
  // les champs qu'il laisse a null.
  if (rServitudes) {
    if (rServitudes.eau.captageAep?.dansPerimetre != null) {
      snapshot.eau.captageAep = rServitudes.eau.captageAep;
    }
    if (rServitudes.risques.servitudesAeronautiques != null) {
      snapshot.risques.servitudesAeronautiques = rServitudes.risques.servitudesAeronautiques;
    }
    if (rServitudes.risques.faisceauxHertziens != null) {
      snapshot.risques.faisceauxHertziens = rServitudes.risques.faisceauxHertziens;
    }
    if ((rServitudes.risques.reseauxEnterres ?? []).length > 0) {
      snapshot.risques.reseauxEnterres = rServitudes.risques.reseauxEnterres!;
    }
    // Les categories recouvrantes enrichissent la liste des servitudes affichee dans la fiche.
    const categories = rServitudes.liste
      .filter((s) => s.recouvre)
      .map((s) => s.libelle ?? libelleCategorie(s.categorie));
    if (categories.length > 0) {
      snapshot.urbanisme.servitudes = [
        ...new Set([...(snapshot.urbanisme.servitudes ?? []), ...categories]),
      ];
    }
  } else {
    echecs.add('gpu/assiette-sup-s');
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

  // --- Arrete de protection de biotope -------------------------------------
  // Source distincte du module Nature (WFS PatriNat), donc echec distinct : une reserve
  // naturelle indisponible ne doit pas faire passer l'APPB pour verifie, ni l'inverse.
  if (rAppb) {
    snapshot.milieux.appb = rAppb;
    sources.patrinat_appb = sourceRef('patrinat_appb');
  } else {
    echecs.add('patrinat_appb');
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

  /**
   * Dernier controle avant que le snapshot ne devienne une donnee.
   *
   * C'est le point unique par lequel passe tout ce que l'application persiste : la borne posee ici
   * couvre les onze connecteurs a la fois, alors qu'un controle par connecteur en oublierait un.
   *
   * Ce garde-fou existe parce qu'une pente de 1 666 % a ete ecrite en base, y a survecu trois
   * audits et faussait le score de 14 % des parcelles. Le calcul fautif est corrige, mais le
   * PROBLEME etait qu'aucun controle ne s'opposait a l'ecriture d'une valeur impossible. Un test
   * verifie ce qu'on a pense a verifier ; une borne attrape le connecteur qui changera d'unite
   * l'annee prochaine.
   *
   * Une anomalie est journalisee en `warn` et non en `error` : la parcelle reste exploitable, le
   * critere concerne passe simplement au gris. Mais elle doit etre VUE — c'est le signal qu'un
   * connecteur ou un calcul a derive.
   */
  const anomalies = assainirSnapshot(snapshot);
  if (anomalies.length > 0) {
    journal.warn(
      {
        idu: parcelle.idu,
        anomalies: anomalies.map((a) => `${a.chemin} = ${a.valeur} ${a.unite} (borne ${a.min}..${a.max})`),
      },
      'Grandeurs hors bornes de vraisemblance : ramenees a « donnee indisponible ». ' +
        'Verifiez le connecteur ou le calcul concerne.',
    );
  }

  const dureeMs = Date.now() - debut;
  journal.debug(
    { idu: parcelle.idu, dureeMs, echecs: [...echecs], anomaliesBornes: anomalies.length },
    'Parcelle enrichie',
  );

  return { snapshot, connecteursEnEchec: [...echecs], dureeMs, anomaliesBornes: anomalies };
}

/** Part des blocs de donnees effectivement renseignes, pour supervision. */
export function couvertureSnapshot(snapshot: ParcelleSnapshot): number {
  const total = Object.keys(CONNECTEURS).length;
  const renseignes = Object.keys(snapshot.sources).length;
  return total === 0 ? 0 : Math.round((renseignes / total) * 1000) / 1000;
}
