/**
 * Connecteur cadastre - IGN API Carto, module Cadastre (PCI Express).
 *
 * Contraintes verifiees (docs/API_CONTRACTS.md §1) :
 *   - `section` fait exactement 2 caracteres, `numero` exactement 4 : padding obligatoire,
 *     sinon HTTP 400 ;
 *   - la reponse plafonne a 1000 features : pagination par `_start` ;
 *   - les proprietes reelles sont `code_insee` / `nom_com` (et non `insee` / `nom_commune`
 *     comme l'indique le schema OpenAPI).
 */

import { config } from '../config.js';
import { journal } from '../journal.js';
import { avecParams, jsonExterne } from '../http.js';
import {
  bboxEnPolygone,
  decouperBbox,
  surfaceM2,
  centroideDe,
  type Bbox,
  type GeoJsonGeometry,
} from '../geo.js';
import { composerIdu, identiteDepuisIdu } from '@enr/core';
import { geomParam, type FeatureCollection } from './base.js';

const CONNECTEUR = 'apicarto_cadastre';

export interface ProprietesParcelle {
  gid?: number;
  idu?: string;
  numero: string;
  feuille?: number;
  section: string;
  code_dep: string;
  nom_com: string;
  code_com: string;
  com_abs: string;
  code_arr: string;
  contenance?: number;
  code_insee: string;
}

export interface ParcelleBrute {
  idu: string;
  codeInsee: string;
  nomCommune: string;
  codeDepartement: string;
  prefixe: string;
  section: string;
  numero: string;
  contenanceM2: number | null;
  surfaceCalculeeM2: number;
  geometrie: GeoJsonGeometry;
  centroide: [number, number];
}

/** Complete section et numero au format exige par l'API. */
export function normaliserSection(section: string): string {
  return section.trim().toUpperCase().padStart(2, '0').slice(-2);
}

export function normaliserNumero(numero: string): string {
  return numero.trim().padStart(4, '0').slice(-4);
}

function versParcelle(f: FeatureCollection<ProprietesParcelle>['features'][number]): ParcelleBrute | null {
  const p = f.properties;
  if (!f.geometry) return null;
  /**
   * L'IDU est reconstitue lorsque la source ne le fournit pas.
   *
   * `composerIdu` et non une interpolation directe : la version precedente concatenait les champs
   * bruts, si bien qu'une source rendant la section « A » plutot que « 0A » produisait un IDU de
   * TREIZE caracteres — correspondant a aucune parcelle, et sans que rien ne le signale. La regle vit
   * desormais dans `@enr/core`, partagee avec la recherche et l'interface.
   */
  const idu = p.idu ?? composerIdu({
    codeInsee: p.code_insee,
    prefixe: p.com_abs,
    section: p.section,
    numero: p.numero,
  });
  /**
   * Les composants sont RELUS depuis l'IDU, et non recopies de la source.
   *
   * Sans cela, la fiche pouvait porter `section: 'A'` alors que son IDU disait « 0A » : deux verites
   * pour la meme parcelle, dont l'une ne permet pas de la retrouver. Relire l'IDU rend la
   * contradiction impossible par construction — quelle que soit la forme sous laquelle la source
   * ecrit ses champs.
   */
  const parties = identiteDepuisIdu(idu);
  const geometrie = f.geometry as GeoJsonGeometry;
  return {
    idu,
    codeInsee: p.code_insee,
    nomCommune: p.nom_com,
    codeDepartement: p.code_dep,
    prefixe: parties.prefixe,
    section: parties.section,
    numero: parties.numero,
    contenanceM2: p.contenance ?? null,
    surfaceCalculeeM2: Math.round(surfaceM2(geometrie)),
    geometrie,
    centroide: centroideDe(geometrie),
  };
}

/** Recupere une parcelle par sa reference cadastrale. */
export async function parcelleParReference(
  codeInsee: string,
  section: string,
  numero: string,
): Promise<ParcelleBrute | null> {
  const url = avecParams(`${config.sources.apicarto}/cadastre/parcelle`, {
    code_insee: codeInsee,
    section: normaliserSection(section),
    numero: normaliserNumero(numero),
    _limit: 5,
  });
  const fc = await jsonExterne<FeatureCollection<ProprietesParcelle>>(url, { connecteur: CONNECTEUR });
  for (const f of fc.features) {
    const p = versParcelle(f);
    if (p) return p;
  }
  return null;
}

/** Recupere une parcelle par son identifiant unique (14 caracteres). */
export async function parcelleParIdu(idu: string): Promise<ParcelleBrute | null> {
  if (idu.length !== 14) return null;
  return parcelleParReference(idu.slice(0, 5), idu.slice(8, 10), idu.slice(10, 14));
}

/**
 * Recupere toutes les parcelles intersectant une geometrie, en paginant par pas de 1000
 * (plafond dur de l'API).
 */
export async function parcellesParGeometrie(
  geom: GeoJsonGeometry,
  limite = config.carte.limiteParcelles,
): Promise<ParcelleBrute[]> {
  const out: ParcelleBrute[] = [];
  const pas = 1000;
  for (let debut = 0; debut < limite; debut += pas) {
    const url = avecParams(`${config.sources.apicarto}/cadastre/parcelle`, {
      geom: geomParam(geom),
      _limit: pas,
      _start: debut,
    });
    const fc = await jsonExterne<FeatureCollection<ProprietesParcelle>>(url, { connecteur: CONNECTEUR });
    for (const f of fc.features) {
      const p = versParcelle(f);
      if (p) out.push(p);
    }
    const total = fc.numberMatched ?? fc.totalFeatures ?? out.length;
    if (fc.features.length < pas || out.length >= total) break;
  }
  return out;
}

export async function parcellesParEmprise(bbox: Bbox, limite?: number): Promise<ParcelleBrute[]> {
  return parcellesParGeometrie(bboxEnPolygone(bbox), limite);
}

/**
 * Ce qu'une recuperation d'emprise a REELLEMENT ramene — et ce qu'elle a laisse de cote.
 *
 * POURQUOI CE TYPE EXISTE. Cette fonction ne rendait qu'une liste de parcelles, et perdait en route
 * trois informations qui changent la lecture du resultat : les cellules dont la recuperation a echoue
 * (journalisees en avertissement, invisibles pour l'utilisateur), les parcelles ecartees par le filtre
 * de surface (plus de la moitie du parcellaire dans certaines regions), et l'atteinte du plafond de lot
 * (les cellules suivantes ne sont pas interrogees du tout).
 *
 * Le resultat etait donc indistinguable d'une couverture complete. Un prospecteur concluait « il n'y a
 * rien d'interessant dans ce secteur » quand la verite etait « ce secteur n'a pas ete regarde ». C'est
 * la faute fondatrice de tous ces audits — affirmer plus que ce que la donnee permet — appliquee a la
 * COUVERTURE.
 */
export interface RecuperationEmprise {
  parcelles: ParcelleBrute[];
  /** Cellules de la grille couvrant l'emprise demandee. */
  cellulesTotal: number;
  /** Cellules dont la recuperation a echoue : leur parcellaire manque. */
  cellulesEnEchec: number;
  /** Cellules jamais interrogees, la recuperation s'etant arretee au plafond. */
  cellulesSautees: number;
  /** Parcelles vues au cadastre mais ecartees par le filtre de surface minimale. */
  ecarteesSurface: number;
  /** Vrai si le plafond de lot a interrompu la recuperation avant la fin de l'emprise. */
  plafondAtteint: boolean;
}

/**
 * Parcelles d'une grande emprise, recuperees cellule par cellule.
 *
 * API Carto ne repond pas a une geometrie couvrant plusieurs communes, et plafonne le
 * nombre d'objets par requete : demander l'emprise entiere d'un seul coup renverrait une
 * liste tronquee, sans qu'on le sache. Le decoupage rend la troncature impossible et
 * permet de rendre compte de l'avancement.
 *
 * Les cellules se recouvrant sur leurs bords, la deduplication par IDU est indispensable.
 */
export async function parcellesParGrandeEmprise(
  bbox: Bbox,
  options: {
    coteCellule?: number;
    limite?: number;
    surfaceMinM2?: number;
    onProgres?: (fait: number, total: number, trouvees: number) => void;
  } = {},
): Promise<RecuperationEmprise> {
  const cellules = decouperBbox(bbox, options.coteCellule ?? 0.05);
  const limite = options.limite ?? 20000;
  const surfaceMin = options.surfaceMinM2 ?? 0;
  const parIdu = new Map<string, ParcelleBrute>();
  let cellulesEnEchec = 0;
  let cellulesSautees = 0;
  let ecarteesSurface = 0;
  let plafondAtteint = false;

  for (const [i, cellule] of cellules.entries()) {
    if (parIdu.size >= limite) {
      // Le plafond de lot interrompt la recuperation : les cellules restantes ne sont PAS
      // interrogees, et l'emprise demandee n'est donc pas couverte en entier.
      plafondAtteint = true;
      cellulesSautees = cellules.length - i;
      break;
    }
    try {
      const lot = await parcellesParGeometrie(bboxEnPolygone(cellule));
      for (const p of lot) {
        // Le filtre de surface est applique ici : inutile de conserver en memoire des
        // micro-parcelles qui seront ecartees ensuite.
        if ((p.surfaceCalculeeM2 ?? p.contenanceM2 ?? 0) < surfaceMin) {
          // Comptees, et non seulement ignorees : c'est la moitie du parcellaire dans certaines
          // regions, et l'utilisateur doit savoir que sa campagne ne les a pas vues.
          if (!parIdu.has(p.idu)) ecarteesSurface += 1;
          continue;
        }
        parIdu.set(p.idu, p);
      }
    } catch (err) {
      // Une cellule en echec ne doit pas annuler l'emprise entiere : le reste du secteur
      // reste exploitable. Mais l'echec est COMPTE et remonte a l'appelant, pas seulement
      // journalise : un secteur manquant se lit comme un secteur sans parcelle interessante.
      cellulesEnEchec += 1;
      journal.warn({ err, cellule }, "Cellule d'emprise non recuperee");
    }
    options.onProgres?.(i + 1, cellules.length, parIdu.size);
  }

  return {
    parcelles: [...parIdu.values()],
    cellulesTotal: cellules.length,
    cellulesEnEchec,
    cellulesSautees,
    ecarteesSurface,
    plafondAtteint,
  };
}

/** Contour communal, utilise par la vue nationale agregee et la recherche. */
export async function commune(codeInsee: string): Promise<{
  codeInsee: string;
  nom: string;
  codeDepartement: string;
  geometrie: GeoJsonGeometry;
} | null> {
  const url = avecParams(`${config.sources.apicarto}/cadastre/commune`, {
    code_insee: codeInsee,
    _limit: 1,
  });
  const fc = await jsonExterne<FeatureCollection<{ nom_com: string; code_dep: string; code_insee: string }>>(
    url,
    { connecteur: CONNECTEUR },
  );
  const f = fc.features[0];
  if (!f?.geometry) return null;
  return {
    codeInsee: f.properties.code_insee,
    nom: f.properties.nom_com,
    codeDepartement: f.properties.code_dep,
    geometrie: f.geometry as GeoJsonGeometry,
  };
}

/**
 * Estimation fonciere derivee du parcellaire.
 *
 * Les donnees nominatives de propriete ne sont accessibles par aucune API publique : on
 * estime donc le nombre de proprietaires et la surface d'un seul tenant a partir de la
 * structure parcellaire (parcelles contigues de meme section), ce qui est un PROXY.
 */
export async function contexteFoncier(
  parcelle: ParcelleBrute,
): Promise<{
  nbProprietairesEstime: number | null;
  indivisionProbable: boolean | null;
  surfaceDunSeulTenantHa: number | null;
  morcellementIndice: number | null;
}> {
  // On examine le voisinage immediat : les parcelles contigues de meme section
  // appartiennent frequemment au meme compte cadastral.
  const voisines = await parcellesParGeometrie(parcelle.geometrie, 200).catch(() => []);
  const memeSection = voisines.filter((v) => v.section === parcelle.section);
  const surfaceBlocHa =
    memeSection.reduce((a, v) => a + v.surfaceCalculeeM2, parcelle.surfaceCalculeeM2) / 10000;

  // Indice de morcellement : rapport perimetre / perimetre du cercle equivalent.
  const surface = parcelle.surfaceCalculeeM2;
  const perimetreCercle = 2 * Math.PI * Math.sqrt(surface / Math.PI);
  const perimetre = perimetreApproche(parcelle.geometrie);
  const compacite = perimetre > 0 ? perimetreCercle / perimetre : 1;
  const morcellementIndice = Math.max(0, Math.min(100, Math.round((1 - compacite) * 100)));

  return {
    /**
     * NULL, et non 1 — audit 8, defaut B2.
     *
     * Cette ligne valait `1`. Litteralement, pour toutes les parcelles de France. Le commentaire
     * qui l'accompagnait decrivait un algorithme — « au moins un proprietaire, et un de plus par
     * tranche de 5 parcelles voisines de sections differentes » — qui n'a jamais ete ecrit : les
     * variables `voisines` et `memeSection` ne servent qu'a `surfaceBlocHa`. Le critere
     * `fonc_nb_proprietaires` valait donc 100/100, feu VERT, « 1 proprietaire(s) estime(s) », sur
     * chaque parcelle qualifiee.
     *
     * C'est le pire endroit possible pour un chiffre invente : la maitrise fonciere est le premier
     * facteur de mortalite d'un projet ENR, et une parcelle en indivision successorale a onze
     * ayants droit affichait la meme mention rassurante qu'une parcelle a proprietaire unique.
     *
     * POURQUOI PAS L'ALGORITHME PLUTOT QUE NULL. Le nombre de comptes cadastraux n'est pas
     * deductible de la structure parcellaire : deux parcelles contigues de meme section
     * appartiennent souvent au meme compte, mais souvent n'est pas toujours, et l'ecart n'est ni
     * borne ni mesurable sans la donnee nominative. Un proxy dont on ne peut pas evaluer l'erreur
     * n'a pas sa place sur ce critere. La donnee existe et s'obtient : elle se verse dans
     * `proprietaire_parcelle` apres demande documentee aupres de la DGFiP ou de la mairie, et le
     * critere est declare sans source jusque-la.
     *
     * Elle n'est deliberement PAS lue ici depuis `proprietaire_parcelle` : le snapshot alimente
     * les tuiles et les exports, alors que l'acces aux donnees de propriete est reserve, motive et
     * journalise. Faire entrer un comptage issu de cette table dans le snapshot contournerait tout
     * le dispositif.
     */
    nbProprietairesEstime: null,
    indivisionProbable: null, // non determinable sans donnee nominative
    surfaceDunSeulTenantHa: Math.round(surfaceBlocHa * 100) / 100,
    morcellementIndice,
  };
}

function perimetreApproche(geom: GeoJsonGeometry): number {
  const anneaux: number[][][] =
    geom.type === 'Polygon'
      ? (geom.coordinates as number[][][])
      : geom.type === 'MultiPolygon'
        ? (geom.coordinates as number[][][][]).flat()
        : [];
  let total = 0;
  for (const anneau of anneaux) {
    for (let i = 0; i < anneau.length - 1; i += 1) {
      const a = anneau[i]!;
      const b = anneau[i + 1]!;
      const dLat = (b[1]! - a[1]!) * 111132;
      const dLon = (b[0]! - a[0]!) * 111320 * Math.cos((a[1]! * Math.PI) / 180);
      total += Math.sqrt(dLat * dLat + dLon * dLon);
    }
  }
  return total;
}
