/**
 * Gisement de vent - Global Wind Atlas (DTU Wind Energy / Banque mondiale).
 *
 * Le Global Wind Atlas publie, par pays, un raster GeoTIFF des vitesses moyennes de vent
 * a 10, 50, 100, 150 et 200 m. Pour la France, le fichier a 100 m couvre le territoire au
 * pas de 250 m (8055 x 4143 pixels, environ 55 Mo).
 *
 * Ce n'est pas une API d'interrogation ponctuelle : le fichier est telecharge par un job
 * d'ingestion, puis echantillonne localement pixel par pixel. La bibliotheque `geotiff` lit
 * le BigTIFF en acces aleatoire, si bien qu'une lecture d'un seul pixel ne charge que la
 * tuile concernee - le fichier n'est jamais monte en memoire en entier.
 *
 * Le handle d'image est conserve entre les appels : la qualification d'une emprise fait des
 * centaines de lectures.
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fromFile, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import { config } from '../config.js';
import { journal } from '../journal.js';
import type { Position } from '../geo.js';

/** Hauteur de reference : celle qui compte pour un aerogenerateur contemporain. */
export const HAUTEUR_M = 100;

export const CHEMIN_RASTER = join(config.donnees.repertoire, 'vent', `gwa-fra-${HAUTEUR_M}m.tif`);

const URL_GWA = `https://globalwindatlas.info/api/gis/country/FRA/wind-speed/${HAUTEUR_M}`;

interface Raster {
  image: GeoTIFFImage;
  fichier: GeoTIFF;
  origine: [number, number];
  resolution: [number, number];
  largeur: number;
  hauteur: number;
}

let raster: Raster | null = null;

/**
 * Instant avant lequel il est inutile de retenter l'ouverture.
 *
 * POURQUOI UNE DATE ET NON UN BOOLEEN — audit 8, defaut D2. La version precedente tenait un
 * `chargementEchoue: boolean` mis a `true` au premier constat d'absence du fichier, et rien ne le
 * remettait a `false` dans le processus SERVEUR : `telechargerRaster()` le reinitialisait bien, mais
 * elle s'execute dans le processus d'INGESTION.
 *
 * La sequence fautive n'avait rien d'exceptionnel — c'est l'ordre naturel d'une premiere
 * installation : le serveur demarre avant l'ingestion, un premier appel a `ventA100m` constate
 * l'absence du fichier, l'ingestion telecharge ensuite les 55 Mo, et le serveur continue de
 * repondre `null` indefiniment. `gis_vent` pese 10,9 % de la note eolienne : la filiere restait
 * privee de son premier critere jusqu'au redemarrage suivant, sans aucun signal.
 *
 * Une nouvelle tentative periodique corrige cela sans rendre l'echec couteux : un `existsSync`
 * coute infiniment moins qu'une lecture de tuile, et l'intervalle evite de journaliser en boucle.
 */
let prochaineTentative = 0;
const DELAI_NOUVELLE_TENTATIVE_MS = 60 * 1000;

/**
 * Le geoereferencement du raster est-il celui que le calcul de pixel suppose ?
 *
 * `ventA100m` calcule `(pt[0] - origine[0]) / resolution[0]` en supposant des DEGRES WGS 84. Rien ne
 * le verifiait (audit 8, defaut D3). Si le Global Wind Atlas republie son raster France en
 * projection metrique — ce qui est courant et hors de notre controle —, l'indice de pixel sort de
 * l'emprise et la fonction retourne `null` en silence, ou pire, designe un pixel valide mais faux.
 * Le controle de telechargement portait sur la TAILLE du fichier, pas sur sa geoereference.
 *
 * Le test ne cherche pas a valider un code EPSG (les GeoTIFF du GWA n'en portent pas toujours un
 * explicite) : il verifie que l'origine et la resolution sont plausibles en degres pour la France.
 * Une origine a 500 000 ou une resolution de 250 sont sans ambiguite metriques.
 */
export function georeferencementPlausible(
  origine: [number, number],
  resolution: [number, number],
): { ok: true } | { ok: false; motif: string } {
  const [ox, oy] = origine;
  const [rx, ry] = resolution;
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(rx) || !Number.isFinite(ry)) {
    return { ok: false, motif: 'origine ou résolution non finie' };
  }
  // La France metropolitaine et l'outre-mer restent dans les bornes du systeme geographique.
  if (Math.abs(ox) > 180 || Math.abs(oy) > 90) {
    return { ok: false, motif: `origine (${ox}, ${oy}) hors bornes geographiques : raster projete ?` };
  }
  // Le pas du GWA France vaut environ 0,0025 deg (250 m). Un pas superieur a 1 deg ne decrirait plus
  // un raster utilisable, et un pas de 250 signalerait des metres.
  const pas = Math.max(Math.abs(rx), Math.abs(ry));
  if (pas === 0 || pas > 1) {
    return { ok: false, motif: `resolution ${rx} x ${ry} incompatible avec des degres` };
  }
  return { ok: true };
}

async function ouvrirRaster(): Promise<Raster | null> {
  if (raster) return raster;
  if (Date.now() < prochaineTentative) return null;
  prochaineTentative = Date.now() + DELAI_NOUVELLE_TENTATIVE_MS;

  if (!existsSync(CHEMIN_RASTER)) {
    // Raster non ingere : le critere restera gris, ce qui est le comportement attendu. La prochaine
    // tentative aura lieu dans une minute, si bien qu'une ingestion posterieure au demarrage du
    // serveur est prise en compte sans redemarrage.
    journal.debug(
      { chemin: CHEMIN_RASTER },
      "Raster de vent absent : lancer `npm run ingest -- vent_100m`",
    );
    return null;
  }
  try {
    const fichier = await fromFile(CHEMIN_RASTER);
    const image = await fichier.getImage();
    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution();
    const origine: [number, number] = [ox as number, oy as number];
    const resolution: [number, number] = [rx as number, ry as number];

    const verdict = georeferencementPlausible(origine, resolution);
    if (!verdict.ok) {
      // Un raster mal geoereference produirait des vitesses de vent PLAUSIBLES sur les mauvaises
      // parcelles. Mieux vaut un critere gris qu'une valeur fausse : on refuse le fichier.
      journal.error(
        { chemin: CHEMIN_RASTER, origine, resolution, motif: verdict.motif },
        'Raster de vent refuse : geoereferencement incompatible avec un échantillonnage en degrés. ' +
          'Le critère de gisement éolien restera non evalue.',
      );
      return null;
    }

    raster = {
      fichier,
      image,
      origine,
      resolution,
      largeur: image.getWidth(),
      hauteur: image.getHeight(),
    };
    journal.info(
      { largeur: raster.largeur, hauteur: raster.hauteur, pasDeg: Math.abs(raster.resolution[0]) },
      'Raster de vent charge',
    );
    return raster;
  } catch (err) {
    journal.warn({ err, chemin: CHEMIN_RASTER }, 'Raster de vent illisible');
    return null;
  }
}

/**
 * Vitesse moyenne du vent a 100 m au point donne, en m/s.
 * Retourne `null` hors emprise, sur une valeur sans donnee, ou si le raster n'est pas ingere.
 */
export async function ventA100m(pt: Position): Promise<number | null> {
  const r = await ouvrirRaster();
  if (!r) return null;

  const x = Math.floor((pt[0] - r.origine[0]) / r.resolution[0]);
  const y = Math.floor((pt[1] - r.origine[1]) / r.resolution[1]);
  if (x < 0 || y < 0 || x >= r.largeur || y >= r.hauteur) return null;

  try {
    const bandes = await r.image.readRasters({ window: [x, y, x + 1, y + 1] });
    const bande = bandes[0] as ArrayLike<number> | undefined;
    const v = bande?.[0];
    if (v == null || !Number.isFinite(v)) return null;
    // Le Global Wind Atlas code l'absence de donnee (mer, hors pays) par une valeur
    // negative ou tres grande.
    if (v <= 0 || v > 25) return null;
    return Math.round(v * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * Telecharge le raster national. A relancer annuellement : le Global Wind Atlas est
 * republie a l'occasion de nouvelles versions de son modele.
 */
export async function telechargerRaster(): Promise<{ octets: number; chemin: string }> {
  await mkdir(dirname(CHEMIN_RASTER), { recursive: true });

  const reponse = await fetch(URL_GWA, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)' },
  });
  if (!reponse.ok) {
    throw new Error(`Telechargement du raster de vent impossible (${reponse.status})`);
  }
  const contenu = Buffer.from(await reponse.arrayBuffer());
  if (contenu.length < 1_000_000) {
    throw new Error(`Raster de vent suspect : ${contenu.length} octets seulement`);
  }

  // Ecriture atomique : un raster tronque par une interruption serait pire qu'aucun raster.
  const temporaire = `${CHEMIN_RASTER}.partiel`;
  await writeFile(temporaire, contenu);
  await rename(temporaire, CHEMIN_RASTER);

  // Invalidation du handle en cache, et remise a zero du delai de nouvelle tentative : un
  // telechargement reussi doit etre pris en compte immediatement, sans attendre la minute suivante.
  raster = null;
  prochaineTentative = 0;

  return { octets: contenu.length, chemin: CHEMIN_RASTER };
}
