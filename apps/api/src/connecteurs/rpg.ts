/**
 * Connecteur RPG - registre parcellaire graphique (declarations PAC).
 *
 * Point verifie (docs/API_CONTRACTS.md §3) : le module fonctionne, mais il faut l'interroger
 * avec un POLYGONE et non un point isole. Le parametre `annee` est obligatoire ; les
 * millesimes 2018 a 2024 renvoient des donnees.
 *
 * Le RPG sert a deux choses :
 *   1. determiner le type de culture (compatibilite agrivoltaique) ;
 *   2. determiner si la parcelle est EXPLOITEE, en regardant l'historique des millesimes -
 *      ce qui conditionne le regime juridique applicable au photovoltaique au sol.
 */

import type { OccupationSol, TypeSol } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { surfaceM2, type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import { recouvrement } from './distances.js';
import { rpgParWfs } from './wfs.js';

const CONNECTEUR = 'apicarto_rpg';

/** Millesime le plus recent connu comme disponible, et profondeur d'historique analysee. */
const MILLESIME_COURANT = 2024;
const PROFONDEUR_HISTORIQUE = 5;

interface ProprietesRpg {
  id_parcel?: string;
  surf_parc?: number;
  code_cultu?: string | null;
  code_group?: string | null;
  culture_d1?: string | null;
  culture_d2?: string | null;
}

/** Libelles des groupes de culture RPG. */
export const GROUPES_CULTURE: Record<string, string> = {
  '1': 'Ble tendre',
  '2': 'Mais grain et ensilage',
  '3': 'Orge',
  '4': 'Autres cereales',
  '5': 'Colza',
  '6': 'Tournesol',
  '7': 'Autres oleagineux',
  '8': 'Proteagineux',
  '9': 'Plantes a fibres',
  '10': 'Semences',
  '11': 'Gel (surfaces sans production)',
  '12': 'Gel industriel',
  '14': 'Riz',
  '15': 'Legumineuses a grains',
  '16': 'Fourrage',
  '17': 'Estives et landes',
  '18': 'Prairies permanentes',
  '19': 'Prairies temporaires',
  '20': 'Vergers',
  '21': 'Vignes',
  '22': 'Fruits a coque',
  '23': 'Oliviers',
  '24': 'Autres cultures industrielles',
  '25': 'Legumes ou fleurs',
  '26': 'Canne a sucre',
  '27': 'Arboriculture',
  '28': 'Divers',
};

/**
 * Potentiel agronomique approche a partir du groupe de culture declare.
 * C'est un PROXY : les grandes cultures a haut rendement traduisent un bon sol, les
 * estives et landes un sol pauvre. Un vrai indice de potentiel exigerait la base sol
 * regionale (IGCS), qui n'a pas d'API nationale.
 */
const POTENTIEL_AGRONOMIQUE: Record<string, number> = {
  '1': 85,
  '2': 85,
  '3': 80,
  '4': 70,
  '5': 80,
  '6': 70,
  '7': 65,
  '8': 70,
  '9': 70,
  '10': 80,
  '11': 40,
  '12': 40,
  '14': 75,
  '15': 65,
  '16': 55,
  '17': 15,
  '18': 40,
  '19': 50,
  '20': 70,
  '21': 60,
  '22': 55,
  '23': 45,
  '24': 70,
  '25': 85,
  '26': 75,
  '27': 70,
  '28': 50,
};

async function interrogerMillesime(
  geom: GeoJsonGeometry,
  annee: number,
): Promise<FeatureCollection<ProprietesRpg> | null> {
  try {
    const url = avecParams(`${config.sources.apicarto}/rpg/v2`, {
      geom: geomParam(geom),
      annee,
      _limit: 200,
    });
    return await jsonExterne<FeatureCollection<ProprietesRpg>>(url, { connecteur: CONNECTEUR });
  } catch {
    return null;
  }
}

/**
 * Determine l'occupation du sol d'une parcelle.
 *
 * `typeSol` est deduit ainsi :
 *   - ilot RPG present sur le millesime recent            -> agricole_exploite
 *   - aucun ilot RPG sur toute la profondeur analysee     -> inculte (a confirmer)
 *   - couverture forestiere majoritaire                   -> naturel_forestier
 * La qualification "inculte ou non exploite depuis le 10 mars 2013" exige une profondeur
 * d'historique que le RPG en ligne ne couvre pas : elle est signalee comme A CONFIRMER par
 * photo-interpretation, jamais affirmee.
 */
export async function occupationSol(
  parcelle: GeoJsonGeometry,
  surfaceParcelleM2: number,
  foretInfo: { recouvre: boolean | null; partBoisee: number | null; type: string | null } | null,
  /**
   * Type de zone d'urbanisme dominant (U, AU, A, N...). Indispensable pour ne pas qualifier
   * d'"inculte" une parcelle simplement absente du RPG : un terrain en zone urbaine est
   * artificialise, pas une terre agricole delaissee - et le regime juridique applicable au
   * photovoltaique au sol en depend directement.
   */
  typeZoneDominant: string | null = null,
): Promise<{ occupation: Partial<OccupationSol>; echecs: string[] }> {
  const echecs: string[] = [];
  const occupation: Partial<OccupationSol> = {};

  // Millesime courant, puis historique pour apprecier la continuite d'exploitation.
  const annees = Array.from({ length: PROFONDEUR_HISTORIQUE }, (_, i) => MILLESIME_COURANT - i);
  const resultats = await Promise.all(annees.map((a) => interrogerMillesime(parcelle, a)));

  let millesimeUtilise: number | null = null;
  let featureRetenue: ProprietesRpg | null = null;
  let partRecouvrement: number | null = null;
  let anneesDeclarees = 0;

  for (let i = 0; i < resultats.length; i += 1) {
    const fc = resultats[i];
    if (!fc) continue;
    const recouvrantes = fc.features.filter(
      (f) => f.geometry && recouvrement(parcelle, [f.geometry as GeoJsonGeometry]).recouvre,
    );
    if (recouvrantes.length === 0) continue;
    anneesDeclarees += 1;
    if (featureRetenue == null) {
      millesimeUtilise = annees[i]!;
      // On retient l'ilot qui couvre la plus grande part de la parcelle.
      const triees = [...recouvrantes].sort(
        (a, b) => surfaceM2(b.geometry as GeoJsonGeometry) - surfaceM2(a.geometry as GeoJsonGeometry),
      );
      featureRetenue = triees[0]!.properties;
      const surfaceIlot = surfaceM2(triees[0]!.geometry as GeoJsonGeometry);
      partRecouvrement =
        surfaceParcelleM2 > 0
          ? Math.min(1, Math.round((surfaceIlot / surfaceParcelleM2) * 100) / 100)
          : null;
    }
  }

  // Distinction essentielle en aval : « le RPG dit qu'il n'y a pas de declaration » n'est
  // pas « le RPG n'a pas repondu ». La premiere autorise a ecrire « aucune declaration »
  // dans un rapport transmis a un tiers, la seconde impose « non renseigne ».
  let rpgIndisponible = false;
  const tousEchecs = resultats.every((r) => r == null);
  if (tousEchecs) {
    // Repli sur le WFS RPG.LATEST avant de renoncer.
    const wfs = await rpgParWfs(parcelle);
    if (wfs) {
      const recouvrantes = wfs.features.filter(
        (f) => f.geometry && recouvrement(parcelle, [f.geometry as GeoJsonGeometry]).recouvre,
      );
      if (recouvrantes.length > 0) {
        featureRetenue = recouvrantes[0]!.properties;
        millesimeUtilise = MILLESIME_COURANT;
        anneesDeclarees = 1;
      }
    } else {
      echecs.push('rpg');
      rpgIndisponible = true;
    }
  }

  const groupe = featureRetenue?.code_group ?? null;

  occupation.rpg = {
    codeCulture: featureRetenue?.code_cultu ?? null,
    libelleCulture: featureRetenue?.culture_d1 ?? null,
    codeGroupeCulture: groupe,
    libelleGroupeCulture: groupe ? (GROUPES_CULTURE[groupe] ?? null) : null,
    millesime: millesimeUtilise ? String(millesimeUtilise) : null,
    partRecouvrement,
    // `null` uniquement quand aucune source RPG n'a repondu. Le repli WFS reussi, lui,
    // renseigne bien une annee : il donnait auparavant `null` malgre sa declaration.
    anneesDeclareesConsecutives: rpgIndisponible ? null : anneesDeclarees,
  };

  occupation.potentielAgronomique = groupe ? (POTENTIEL_AGRONOMIQUE[groupe] ?? null) : null;

  // Type de sol.
  const partBoisee = foretInfo?.partBoisee ?? null;
  const zone = (typeZoneDominant ?? '').toUpperCase();
  const enZoneUrbaine = /^(U|AU)/.test(zone);

  let typeSol: TypeSol | null = null;
  if (featureRetenue && (partRecouvrement == null || partRecouvrement > 0.3)) {
    // Un ilot PAC recouvre la parcelle : elle est exploitee, meme en zone urbaine.
    typeSol = 'agricole_exploite';
  } else if (partBoisee != null && partBoisee > 0.5) {
    typeSol = 'naturel_forestier';
  } else if (enZoneUrbaine) {
    // Absente du RPG et situee en zone urbaine ou a urbaniser : terrain artificialise
    // ou constructible, et non une terre agricole delaissee.
    typeSol = 'artificialise';
  } else if (!tousEchecs && anneesDeclarees === 0) {
    // Absente du RPG en zone agricole ou naturelle : potentiellement inculte, mais le
    // caractere "non exploite depuis le 10 mars 2013" reste a demontrer (cf. ci-dessous).
    typeSol = 'inculte';
  }
  occupation.typeSol = typeSol;

  // La date de reference du 10 mars 2013 depasse la profondeur du RPG interrogeable :
  // on ne peut pas l'affirmer, seulement signaler qu'elle reste a demontrer.
  occupation.inculteDepuis2013 = null;

  occupation.foret = foretInfo ?? { recouvre: null, partBoisee: null, type: null };

  return { occupation, echecs };
}
