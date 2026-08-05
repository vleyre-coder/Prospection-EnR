/**
 * Connecteur milieux naturels - INPN / MNHN via API Carto module Nature.
 *
 * Chemins verifies (docs/API_CONTRACTS.md §5) : `natura-habitat`, `natura-oiseaux`,
 * `znieff1`, `znieff2`, `pn`, `pnr`, `rnn`, `rnc`, `rncf`.
 * `site-inscrit` et `site-classe` N'EXISTENT PAS sur ce module (404) : ils passent par le WFS.
 */

import type { MilieuxNaturels, ZonageNaturel } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import { bboxDe, bboxEnPolygone, elargirBbox, type GeoJsonGeometry } from '../geo.js';
import { geomParam, type FeatureCollection } from './base.js';
import {
  zonageDepuisFeatures,
  RAYON_ZONAGES_NATURELS_M,
  type FeatureZonage,
} from './distances.js';

const CONNECTEUR = 'apicarto_nature';

/**
 * Rayon d'analyse de la proximite des zonages naturels, en metres.
 * Repris de `distances.ts`, qui le partage avec le connecteur APPB et le moteur de scoring :
 * la fiche annonce « aucun site trouve dans un rayon de N km », donc la valeur doit etre unique.
 */
const RAYON_ANALYSE_M = RAYON_ZONAGES_NATURELS_M;

/**
 * Proprietes du module Nature d'API Carto.
 *
 * ATTENTION, LE NOM DU SITE CHANGE DE CHAMP SELON LA COUCHE. Verifie sur le service reel :
 *   - `natura-habitat` et `natura-oiseaux` : le nom est dans **`sitename`** ; ni `nom_site` ni
 *     `nom` n'existent. Les lire laissait le nom du site Natura 2000 TOUJOURS nul, sur la
 *     contrainte environnementale qui decide precisement d'une evaluation des incidences ;
 *   - `znieff1`, `znieff2`, `pn`, `pnr`, `rnn`, `rnc`, `rncf` : le nom est dans **`nom`** ;
 *   - le WFS PatriNat, lui, emploie `nom_site` — d'ou la confusion d'origine. Ce champ n'est
 *     donc PAS declare ici : ce module n'interroge qu'API Carto.
 */
interface ProprietesInpn {
  id_mnhn?: string | null;
  sitecode?: string | null;
  /** Couches Natura 2000 d'API Carto. */
  sitename?: string | null;
  /** Couches d'inventaire et de protection d'API Carto. */
  nom?: string | null;
  url?: string | null;
}

async function couche(chemin: string, geom: GeoJsonGeometry): Promise<FeatureCollection<ProprietesInpn>> {
  const url = avecParams(`${config.sources.apicarto}/nature/${chemin}`, { geom: geomParam(geom) });
  return jsonExterne<FeatureCollection<ProprietesInpn>>(url, { connecteur: CONNECTEUR });
}

/**
 * Nom du site, quel que soit le champ dans lequel la couche le range.
 *
 * Deux champs et pas trois : `nom_site` n'existe sur AUCUNE couche d'API Carto — c'est le WFS
 * PatriNat qui l'emploie, et le connecteur APPB le lit la-bas. Le declarer ici « au cas ou »
 * etait la defensive speculative qui a masque le defaut d'origine : un champ inexistant se lit
 * sans erreur, et rend simplement la valeur nulle pour toujours.
 */
function nomDuSite(p: ProprietesInpn): string | null {
  return p.sitename ?? p.nom ?? null;
}

function zonageDepuis(
  parcelle: GeoJsonGeometry,
  fc: FeatureCollection<ProprietesInpn> | null,
): ZonageNaturel {
  // `null` signifie « la couche n'a pas repondu » : ni recouvrement ni absence ne sont
  // etablis. A distinguer d'une reponse vide, qui est un constat d'absence.
  if (!fc) return { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };
  const feats: FeatureZonage[] = fc.features
    .filter((f) => f.geometry)
    .map((f) => ({ geometry: f.geometry as GeoJsonGeometry, nom: nomDuSite(f.properties) }));
  return zonageDepuisFeatures(parcelle, feats, RAYON_ANALYSE_M);
}

/**
 * Interroge les zonages naturels dans un rayon autour de la parcelle.
 *
 * On interroge sur une emprise ELARGIE, car la proximite (sans recouvrement) est un critere
 * a part entiere : elle declenche l'evaluation des incidences Natura 2000.
 */
export async function milieuxNaturels(
  parcelle: GeoJsonGeometry,
): Promise<{ milieux: Partial<MilieuxNaturels>; echecs: string[] }> {
  const emprise = bboxEnPolygone(elargirBbox(bboxDe(parcelle), RAYON_ANALYSE_M));
  const echecs: string[] = [];

  const chemins = [
    'natura-habitat',
    'natura-oiseaux',
    'znieff1',
    'znieff2',
    'pn',
    'pnr',
    'rnn',
    'rnc',
    // Reserves nationales de chasse et faune sauvage. L'en-tete de ce fichier les annonce
    // comme verifiees depuis l'origine, mais elles n'etaient pas interrogees : la couche
    // etait donc hors couverture alors que la documentation la disait couverte.
    'rncf',
  ] as const;

  const resultats = await Promise.allSettled(chemins.map((c) => couche(c, emprise)));
  const parChemin: Record<string, FeatureCollection<ProprietesInpn> | null> = {};
  chemins.forEach((c, i) => {
    const r = resultats[i]!;
    if (r.status === 'fulfilled') {
      parChemin[c] = r.value;
    } else {
      parChemin[c] = null;
      echecs.push(`nature/${c}`);
    }
  });

  // Les reserves naturelles nationales, de Corse, et de chasse et faune sauvage sont
  // regroupees : toutes constituent une protection forte au sens du scoring.
  //
  // La fusion n'est consideree comme complete que si TOUTES les couches ont repondu. La
  // version precedente se contentait d'une seule (`rnn' || 'rnc'`) : si `rnn` echouait et que
  // `rnc` repondait a vide, la fusion produisait une collection vide traitee comme une reponse
  // complete, donc `reserveNaturelle.recouvre = false` — une absence AFFIRMEE sur une donnee
  // manquante, alors qu'une reserve naturelle nationale est un knock-out.
  const cheminsReserves = ['rnn', 'rnc', 'rncf'] as const;
  const reservesCompletes = cheminsReserves.every((c) => parChemin[c] != null);
  const reserves: FeatureCollection<ProprietesInpn> | null = reservesCompletes
    ? {
        type: 'FeatureCollection',
        features: cheminsReserves.flatMap((c) => parChemin[c]?.features ?? []),
      }
    : null;

  const milieux: Partial<MilieuxNaturels> = {
    natura2000Habitats: zonageDepuis(parcelle, parChemin['natura-habitat'] ?? null),
    natura2000Oiseaux: zonageDepuis(parcelle, parChemin['natura-oiseaux'] ?? null),
    znieff1: zonageDepuis(parcelle, parChemin['znieff1'] ?? null),
    znieff2: zonageDepuis(parcelle, parChemin['znieff2'] ?? null),
    reserveNaturelle: zonageDepuis(parcelle, reserves),
    coeurParcNational: zonageDepuis(parcelle, parChemin['pn'] ?? null),
    parcNaturelRegional: zonageDepuis(parcelle, parChemin['pnr'] ?? null),
  };

  // Pre-enjeu especes : indicateur derive, faute de donnee d'occurrence exploitable en
  // temps reel. Il combine la proximite des zonages d'inventaire et de protection.
  // C'est une ESTIMATION, signalee comme telle dans la fiche.
  milieux.preEnjeuEspeces = preEnjeuDerive(milieux);

  // Avifaune et chiropteres restent NULS, volontairement.
  //
  // Ils valaient auparavant une copie de `preEnjeuEspeces`, ce qui donnait trois criteres
  // d'apparence independante portant le meme nombre - et pesant ensemble 18 % du score
  // eolien, sur le critere qui decide precisement de l'acceptabilite d'un parc. Une
  // sensibilite avifaune ou chiropteres se determine par des inventaires sur un cycle
  // biologique complet, ou a defaut par les atlas regionaux DREAL / LPO, dont aucun n'est
  // expose par une API nationale. En l'absence de source, le critere doit rester gris.
  milieux.sensibiliteAvifaune = null;
  milieux.sensibiliteChiropteres = null;

  return { milieux, echecs };
}

/**
 * Indicateur 0-100 derive de la proximite des zonages naturels.
 * Volontairement prudent : en l'absence totale de donnee, il vaut null (critere gris).
 */
function preEnjeuDerive(m: Partial<MilieuxNaturels>): number | null {
  const zonages = [
    m.natura2000Habitats,
    m.natura2000Oiseaux,
    m.znieff1,
    m.reserveNaturelle,
    m.coeurParcNational,
  ].filter((z): z is ZonageNaturel => z != null && (z.recouvre != null || z.distanceM != null));

  if (zonages.length === 0) return null;

  let score = 0;
  for (const z of zonages) {
    if (z.recouvre) {
      score += 40;
    } else if (z.distanceM != null) {
      if (z.distanceM < 500) score += 25;
      else if (z.distanceM < 2000) score += 15;
      else if (z.distanceM < 5000) score += 7;
    }
  }
  return Math.min(100, score);
}
