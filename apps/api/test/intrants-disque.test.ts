/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE SOMME D'HECTARES SUR UN DISQUE N'EST UNE MESURE QUE SI LE DISQUE ENTIER EST INGERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE FICHIER GARDE LE DEFAUT QUE L'INGESTION DU RPG A FAILLI INTRODUIRE, le 27/09/2026.
 *
 * Jusqu'a cette date, aucune des trois couches d'intrants methanisables n'etait alimentee : le
 * connecteur se contentait donc de demander « cette couche existe-t-elle quelque part ? », et la
 * reponse — non — suffisait a tout laisser gris. C'etait honnete parce que c'etait tout ou rien.
 *
 * L'ingestion du RPG change cela, et elle ne peut pas faire autrement : le registre national porte
 * environ neuf millions de parcelles, il s'ingere DEPARTEMENT PAR DEPARTEMENT. Des le premier
 * departement charge, la question « existe-t-elle quelque part ? » devient fausse.
 *
 * ═══ CE QUI SE SERAIT PASSE, ET POURQUOI PERSONNE NE L'AURAIT VU
 *
 * MESURE FAITE SUR LA BASE REELLE : les 301 parcelles du departement 28 sont TOUTES a moins de
 * 10 km d'une frontiere departementale. Pas une seule n'a son disque d'epandage entierement dans
 * son propre departement. En ingerant le seul 28, chacune aurait somme les hectares du 28 et ignore
 * ceux du 41, du 45 ou du 91 — puis affiche le resultat comme le potentiel d'epandage de son rayon
 * de 10 km.
 *
 * UN TOTAL D'HECTARES TROP BAS NE RESSEMBLE PAS A UNE ERREUR. Il ressemble a un territoire peu
 * agricole. Aucun message, aucun journal, aucune valeur aberrante : juste un critere qui passe de
 * GRIS — « on n'en sait rien » — a ORANGE — « on a regarde, c'est moyen » — sur une donnee amputee.
 * C'est le defaut A3 de l'audit 9 transpose d'une DISTANCE a une SOMME, et il y est plus grave :
 * une distance amputee s'ALLONGE et finit par paraitre suspecte, une somme amputee se contente de
 * retrecir, silencieusement et de facon parfaitement plausible.
 *
 * ═══ LE TERRITOIRE EST FICTIF ET EN PLEINE MER
 *
 * Le departement 99 s'arrete a 5 km a l'est du point d'essai, le 98 prend la suite. Un disque de
 * 10 km autour du point traverse donc les deux, par construction — et aucune donnee reelle n'entre
 * dans la mesure.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { intrantsMethanisation, oublierCouchesIntrantes } from '../src/connecteurs/gisement.js';
import {
  creerCommunesFictives,
  declarerCouvertureFictive,
  DEP_LOCAL,
  DEP_VOISIN,
  INSEE_LOCAL,
  PT,
  supprimerCommunesFictives,
  versEst,
  viderCouvertureFictive,
} from './aides/communes-fictives.js';

const CONNECTEUR = 'rpg_communal';
/** Hectares poses dans le departement du point, puis chez le voisin, a portee du disque de 10 km. */
const HA_LOCAL = 1200;
const HA_VOISIN = 800;

let baseDisponible = false;

/** Pose une commune porteuse de surface agricole a `metresEst` du point d'essai. */
async function poserSurface(
  identifiant: string,
  dep: string,
  metresEst: number,
  ha: number,
): Promise<void> {
  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces)
     VALUES ($1, '[essai] RPG agrege par commune', 'ingestion')
     ON CONFLICT (connecteur) DO NOTHING`,
    [CONNECTEUR],
  );
  await requete(
    `INSERT INTO contrainte (type, nom, identifiant_source, geom, attributs, connecteur, code_departement)
     VALUES ('surface_agricole_commune', $1, $1,
             ST_SetSRID(ST_MakePoint($2, $3), 4326),
             jsonb_build_object('surface_ha', $4::numeric, 'nb_parcelles', 10), $5, $6)
     ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
       attributs = EXCLUDED.attributs, geom = EXCLUDED.geom`,
    [identifiant, PT[0] + versEst(metresEst), PT[1], ha, CONNECTEUR, dep],
  );
}

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM contrainte WHERE connecteur = $1 AND code_departement = ANY($2)`, [
    CONNECTEUR,
    [DEP_LOCAL, DEP_VOISIN],
  ]);
  await viderCouvertureFictive();
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM contrainte LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await nettoyer();
  // A 1 km a l'est : dans le 99. A 7 km : chez le voisin 98, et dans le disque de 10 km.
  await poserSurface('essai-local', DEP_LOCAL, 1000, HA_LOCAL);
  await poserSurface('essai-voisin', DEP_VOISIN, 7000, HA_VOISIN);
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : disque d’intrants ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('UN DEPARTEMENT MANQUANT DANS LE DISQUE LAISSE LA SOMME GRISE, PAS AMPUTEE', async () => {
  if (ignorer()) return;
  await viderCouvertureFictive();
  // Seul le departement du point est declare ingere ; le voisin, traverse par le disque, ne l'est pas.
  await declarerCouvertureFictive(CONNECTEUR, 'surface_agricole_commune', DEP_LOCAL, 1);
  oublierCouchesIntrantes();

  const r = await intrantsMethanisation(PT, INSEE_LOCAL);

  /*
   * LA VALEUR INTERDITE EST 1200, PAS UNE VALEUR ABSURDE. C'est tout le propos : sans le garde, la
   * fonction aurait rendu les 1 200 hectares du 99 — un nombre credible, du bon ordre de grandeur,
   * et faux d'un tiers. L'assertion nomme donc ce qu'elle refuse.
   */
  assert.notEqual(
    r.surfacesEpandageHa,
    HA_LOCAL,
    'la somme du seul departement ingere ne doit jamais etre presentee comme le potentiel du disque',
  );
  assert.equal(
    r.surfacesEpandageHa,
    null,
    'un disque qui deborde sur un departement non ingere ne se somme pas : il reste inconnu',
  );
});

test('LE DISQUE ENTIEREMENT COUVERT SE SOMME, ET IL SOMME LES DEUX DEPARTEMENTS', async () => {
  if (ignorer()) return;
  /**
   * LA MOITIE SANS LAQUELLE LE GARDE NE VAUT RIEN. Un garde qui repondrait toujours `null` passerait
   * le test precedent sans rien apporter : le critere resterait gris pour toujours, et l'ingestion
   * du RPG n'aurait servi a rien. Il faut donc prouver que la donnee ARRIVE des que le disque est
   * couvert — et qu'elle porte bien les hectares du VOISIN, qui sont la raison d'etre du rayon.
   */
  await declarerCouvertureFictive(CONNECTEUR, 'surface_agricole_commune', DEP_LOCAL, 1);
  await declarerCouvertureFictive(CONNECTEUR, 'surface_agricole_commune', DEP_VOISIN, 1);
  oublierCouchesIntrantes();

  const r = await intrantsMethanisation(PT, INSEE_LOCAL);
  assert.equal(
    r.surfacesEpandageHa,
    HA_LOCAL + HA_VOISIN,
    'le disque couvert somme les deux departements, frontiere comprise',
  );
});

test('LES DEUX AUTRES COUCHES RESTENT INCONNUES : UNE COUCHE NE REPOND PAS POUR SA VOISINE', async () => {
  if (ignorer()) return;
  /*
   * Le RPG n'alimente que les surfaces. Si sa couverture valait pour les trois couches, le
   * connecteur affirmerait « 0 elevage, 0 IAA » sur un territoire ou rien n'a ete recense — et le
   * total d'intrants, calcule sur ces zeros, deviendrait une estimation chiffree tiree du vide.
   */
  await declarerCouvertureFictive(CONNECTEUR, 'surface_agricole_commune', DEP_LOCAL, 1);
  await declarerCouvertureFictive(CONNECTEUR, 'surface_agricole_commune', DEP_VOISIN, 1);
  oublierCouchesIntrantes();

  const r = await intrantsMethanisation(PT, INSEE_LOCAL);
  assert.equal(r.elevagesRayon10km, null, 'aucun recensement d’elevages : inconnu, et non zero');
  assert.equal(r.iaaRayon20km, null, 'aucun recensement d’IAA : inconnu, et non zero');
  assert.equal(
    r.intrantsMethaTonnesMsAn,
    null,
    'le total ne se calcule pas sur deux couches manquantes : ce serait une borne inferieure presentee comme une estimation',
  );
  assert.equal(r.sourcesIntrantsIngerees, false);
});
