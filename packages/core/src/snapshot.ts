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
      penteEstimeeParPaires: null,
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
      ppri: { present: null, zonage: null, severitePlan: null },
      pprif: { present: null, zonage: null, severitePlan: null },
      pprt: { present: null, zonage: null, severitePlan: null },
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
        distanceCanalisationKm: null,
        distanceSiteInjectionKm: null,
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

/**
 * Compose un IDU a partir de ses quatre composants — l'inverse de `identiteDepuisIdu`.
 *
 * POURQUOI CETTE FONCTION EXISTE ICI, et pas dans le connecteur cadastre. La regle de composition
 * etait ecrite a TROIS endroits du depot, dont une version fautive :
 *
 *   - `versParcelle` (connecteurs/cadastre) : `${code_insee}${prefixe}${section}${numero}`, sans
 *     aucune normalisation. Une source qui renvoie la section « A » au lieu de « 0A » produisait donc
 *     un IDU de 13 caracteres, qui ne correspondait a aucune parcelle ;
 *   - la recherche (services/recherche) : `${insee}000${normaliserSection(s)}${normaliserNumero(n)}`,
 *     avec un prefixe « 000 » ECRIT EN DUR — faux pour les communes fusionnees, ou le prefixe designe
 *     la commune absorbee ;
 *   - et desormais l'interface, qui doit composer l'IDU d'une parcelle cliquee sur le cadastre.
 *
 * Une regle de domaine ecrite trois fois se corrige une fois sur trois. Elle vit donc ici, dans le
 * noyau que l'API et l'interface partagent tous deux.
 *
 * LE FORMAT, tel que le definit le Plan Cadastral Informatise : 14 caracteres, soit le code INSEE de
 * la commune (5), le prefixe de commune absorbee (3), la section (2, completee a gauche par un zero
 * quand elle ne compte qu'une lettre) et le numero de parcelle (4, complete a gauche par des zeros).
 */
export function composerIdu(parties: {
  codeInsee: string;
  /** Prefixe de commune absorbee. « 000 » pour une commune qui n'a jamais fusionne. */
  prefixe?: string | null;
  section: string;
  numero: string;
}): string {
  const insee = parties.codeInsee.trim().toUpperCase().padStart(5, '0').slice(-5);
  const prefixe = (parties.prefixe ?? '000').trim().padStart(3, '0').slice(-3);
  const section = parties.section.trim().toUpperCase().padStart(2, '0').slice(-2);
  const numero = parties.numero.trim().padStart(4, '0').slice(-4);
  return `${insee}${prefixe}${section}${numero}`;
}

/**
 * Attributs qu'une tuile du Plan Cadastral Informatise porte sur une parcelle.
 *
 * RELEVES SUR UNE TUILE REELLE, et non supposes : la couche `parcelle` de
 * `data.geopf.fr/tms/1.0.0/PCI` sert `code_arr, code_com, code_dep, code_insee, com_abs, contenance,
 * feuille, fid, gid, idu, nom_com, numero, section` (mesure du 13/08/2026, tuile 16/33093/22738). La
 * liste est figee dans `apps/api/test/fixtures/proprietes-sources.json` et surveillee par
 * `contrats-sources` : lire un attribut inexistant ne leve aucune erreur et rend la valeur nulle POUR
 * TOUJOURS — c'est la famille de defauts de l'audit 6.
 */
export interface ProprietesTuileParcelle {
  idu?: string | null;
  code_insee?: string | null;
  com_abs?: string | null;
  section?: string | null;
  numero?: string | null;
  nom_com?: string | null;
  contenance?: number | null;
}

/**
 * Identifiant d'une parcelle designee sur une tuile cadastrale, ou `null` si la tuile n'en dit pas
 * assez.
 *
 * POURQUOI CETTE FONCTION EXISTE. Cliquer une parcelle du cadastre pour la qualifier suppose de savoir
 * LAQUELLE a ete cliquee. La tuile porte generalement `idu` tout fait ; quand il manque, l'identifiant
 * se recompose de ses quatre composants. C'est exactement ce que fait le connecteur cadastre cote
 * serveur, et c'est la raison pour laquelle cette regle vit dans le noyau partage plutot qu'en double.
 *
 * `null` PLUTOT QU'UN IDENTIFIANT APPROXIMATIF : un identifiant de treize caracteres, ou compose d'un
 * champ manquant, ne designe aucune parcelle. La qualification echouerait sans que l'utilisateur
 * comprenne pourquoi ; mieux vaut ne rien proposer et le dire.
 */
export function iduDepuisTuile(proprietes: ProprietesTuileParcelle): string | null {
  const brut = (proprietes.idu ?? '').trim().toUpperCase();
  if (brut.length === 14) return brut;

  const codeInsee = (proprietes.code_insee ?? '').trim();
  const section = (proprietes.section ?? '').trim();
  const numero = (proprietes.numero ?? '').trim();
  if (!codeInsee || !section || !numero) return null;

  const idu = composerIdu({ codeInsee, prefixe: proprietes.com_abs, section, numero });
  return idu.length === 14 ? idu : null;
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
