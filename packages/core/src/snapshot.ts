/**
 * Fabrique de snapshot vide.
 *
 * Le pipeline d'enrichissement part d'un snapshot integralement a null, puis chaque
 * connecteur remplit les champs qu'il sait produire. Un connecteur en echec laisse donc
 * ses champs a null, ce qui produit des criteres GRIS plutot que des valeurs inventees.
 */

import type { Identite, ParcelleSnapshot, ZonageNaturel } from './types.js';

function zonageVide(): ZonageNaturel {
  return { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };
}

export function snapshotVide(identite: Identite, dateSnapshot = new Date().toISOString()): ParcelleSnapshot {
  return {
    identite,
    urbanisme: {
      typeDocument: null,
      couvertParGpu: null,
      zonages: [],
      prescriptions: [],
      servitudes: [],
      zaer: { present: null, filieres: [], source: null, dateDeliberation: null },
      documentCadrePvSol: { departementCouvert: false, parcelleEligible: null, dateArrete: null },
    },
    occupationSol: {
      typeSol: null,
      rpg: {
        codeCulture: null,
        libelleCulture: null,
        codeGroupeCulture: null,
        libelleGroupeCulture: null,
        millesime: null,
        partRecouvrement: null,
        anneesDeclareesConsecutives: null,
      },
      inculteDepuis2013: null,
      aop: { presente: null, viticole: null, appellations: [] },
      foret: { recouvre: null, partBoisee: null, type: null },
      potentielAgronomique: null,
    },
    topographie: {
      pentePct: null,
      penteMaxPct: null,
      orientationDeg: null,
      altitudeM: null,
      deniveleM: null,
      aleaArgiles: null,
      cavitesProches: null,
      mouvementsTerrain: null,
    },
    eau: {
      zoneHumide: null,
      distanceCoursEauM: null,
      captageAep: { dansPerimetre: null, type: null, distanceM: null },
      inondation: { zonagePpri: null, alea: null, dansTri: null },
      karst: null,
    },
    milieux: {
      natura2000Habitats: zonageVide(),
      natura2000Oiseaux: zonageVide(),
      znieff1: zonageVide(),
      znieff2: zonageVide(),
      appb: zonageVide(),
      reserveNaturelle: zonageVide(),
      coeurParcNational: zonageVide(),
      parcNaturelRegional: zonageVide(),
      trameVerteBleue: { reservoir: null, corridor: null },
      enjeuDefrichement: null,
      preEnjeuEspeces: null,
      sensibiliteAvifaune: null,
      sensibiliteChiropteres: null,
    },
    patrimoine: {
      monumentHistorique: { distanceM: null, dansPerimetreProtection: null, nom: null },
      siteClasse: zonageVide(),
      siteInscrit: zonageVide(),
      spr: zonageVide(),
      avisAbfRequis: null,
      covisibiliteIndice: null,
      sensibiliteArcheologique: null,
    },
    risques: {
      ppri: { present: null, zonage: null },
      pprif: { present: null, zonage: null },
      pprt: { present: null, zonage: null },
      radars: [],
      servitudesAeronautiques: null,
      faisceauxHertziens: null,
      reseauxEnterres: [],
      sitesPollues: null,
      icpeProches: null,
      obligationDebroussaillement: null,
    },
    raccordement: {
      posteLePlusProche: null,
      postesAlternatifs: [],
      reseauGaz: {
        distanceKm: null,
        gestionnaire: null,
        capaciteInjectionNm3h: null,
        reboursNecessaire: null,
      },
    },
    gisement: {
      irradiationKwhM2An: null,
      productibleKwhKwcAn: null,
      ventVitesse100mMs: null,
      intrantsMethaTonnesMsAn: null,
      elevagesRayon10km: null,
      iaaRayon20km: null,
      surfacesEpandageHa: null,
      sourcesIntrantsIngerees: null,
    },
    bati: {
      distanceHabitationM: null,
      nbHabitationsRayon500m: null,
      distanceZoneHabitatM: null,
      densiteBati1km: null,
    },
    acces: { distanceVoirieM: null, accesPoidsLourds: null },
    foncier: {
      nbProprietairesEstime: null,
      indivisionProbable: null,
      surfaceDunSeulTenantHa: null,
      morcellementIndice: null,
      proprietairePublic: null,
    },
    sources: {},
    dateSnapshot,
  };
}

/** Construit une identite minimale a partir d'un IDU (14 caracteres). */
export function identiteDepuisIdu(idu: string, nomCommune = ''): Identite {
  const codeInsee = idu.slice(0, 5);
  return {
    idu,
    codeInsee,
    nomCommune,
    codeDepartement: codeInsee.startsWith('97') ? codeInsee.slice(0, 3) : codeInsee.slice(0, 2),
    prefixe: idu.slice(5, 8),
    section: idu.slice(8, 10),
    numero: idu.slice(10, 14),
    contenanceM2: null,
    surfaceCalculeeM2: null,
    centroide: null,
    codeEpci: null,
    nomEpci: null,
  };
}
