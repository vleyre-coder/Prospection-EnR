/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA DISTANCE AU POSTE LE PLUS PROCHE, DANS LE CALCUL DU POTENTIEL COMMUNAL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. `grandeursCommunales()` porte la requete la plus lourde du depot :
 * elle cherche, pour chacune des 34 875 communes, le poste source le plus proche. Elle n'etait
 * couverte par AUCUN test — et l'audit 13 l'a reecrite, parce qu'elle demandait 436 secondes.
 *
 * LA CAUSE DE CETTE LENTEUR tient en une ligne : les postes etaient rassembles dans une CTE, et
 * une CTE est MATERIALISEE — le resultat temporaire ne porte aucun index. L'operateur `<->` ne
 * pouvait donc pas s'appuyer sur `idx_poste_geom`, et le plan rendait un balayage complet des
 * 5 928 postes, suivi d'un tri, POUR CHAQUE commune. La reecriture interroge la table
 * directement : cout estime par le planificateur, 140 184 345 avant, 1 362 765 apres.
 *
 * CE QUE CE GARDE PROTEGE, et qui n'est PAS la vitesse — un test ne doit pas mesurer un temps sur
 * une machine dont il ne sait rien. Il protege les trois proprietes que la reecriture aurait pu
 * perdre, et qu'aucune mesure de duree ne verrait :
 *
 *   1. la distance rendue est bien celle du poste le PLUS PROCHE ;
 *   2. a egalite parfaite, le departage reste deterministe — c'est la raison du second etage de
 *      tri, l'index KNN ne sachant ordonner que par la distance ;
 *   3. un departement SANS couverture declaree rend `null`, et non la distance d'un poste
 *      lointain — la protection de l'audit 9, defaut A3.
 *
 * Le territoire est entierement fictif et place en pleine mer (voir `aides/communes-fictives.ts`) :
 * ces tests ne lisent ni n'ecrivent aucune donnee reelle.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { grandeursCommunales } from '../src/services/potentiel-communal.js';
import { TYPE_COUVERTURE_POSTES } from '../src/connecteurs/locales.js';
import {
  creerCommunesFictives,
  declarerCouvertureFictive,
  DEP_LOCAL,
  DEP_VOISIN,
  INSEE_LOCAL,
  INSEE_VOISIN,
  PT,
  supprimerCommunesFictives,
  versEst,
  viderCouvertureFictive,
} from './aides/communes-fictives.js';

const PREFIXE = 'TEST-POTENTIEL-';

/**
 * LE BORD EST DE LA COMMUNE LOCALE, en metres depuis `PT`.
 *
 * La commune fictive n'est pas un point : c'est une enveloppe qui s'etend de -20 000 m a +5 000 m
 * a l'est de `PT` (voir `creerCommunesFictives`). `ST_Distance` mesure depuis le POLYGONE, pas
 * depuis son centre — un poste pose a 5 000 m tombe donc exactement sur le bord, a distance nulle.
 * C'est ce qu'a rendu la premiere version de ce fichier : « obtenu 0 km ». Les postes sont donc
 * places au-dela, et la distance attendue se compte depuis le bord.
 */
const BORD_EST_M = 5_000;

/** La distance attendue, en km, pour un poste pose a `metres` a l'est de `PT`. */
function attendueKm(metres: number): number {
  return (metres - BORD_EST_M) / 1000;
}

let baseDisponible = false;

/** Insere un poste fictif a `metres` du point de test, vers l'est, dans le departement donne. */
async function posteA(metres: number, suffixe: string, dep: string): Promise<void> {
  await requete(
    `INSERT INTO poste_source (id, nom, gestionnaire, tension, geom, code_departement,
                               connecteur, date_donnee)
     VALUES ($1, $2, 'RTE', '63 kV', ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326), $5,
             'postes_sources', current_date)
     ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom,
                                    code_departement = EXCLUDED.code_departement`,
    [`${PREFIXE}${suffixe}`, `Poste fictif ${suffixe}`, PT[0] + versEst(metres), PT[1], dep],
  );
}

async function supprimerPostes(): Promise<void> {
  await requete(`DELETE FROM poste_source WHERE id LIKE $1`, [`${PREFIXE}%`]);
}

/** La distance rendue pour la commune de test, en kilometres. */
async function distanceLocale(): Promise<number | null> {
  const lignes = await grandeursCommunales();
  const ligne = lignes.find((l) => l.code_insee === INSEE_LOCAL);
  assert.ok(ligne, `la commune fictive ${INSEE_LOCAL} doit figurer dans le releve`);
  return ligne.distance_poste_km == null ? null : Number(ligne.distance_poste_km);
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM poste_source LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await viderCouvertureFictive();
  await supprimerPostes();
});

after(async () => {
  if (baseDisponible) {
    await viderCouvertureFictive();
    await supprimerPostes();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : potentiel communal ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('LA DISTANCE RENDUE EST CELLE DU POSTE LE PLUS PROCHE', async () => {
  if (ignorer()) return;
  await supprimerPostes();
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_LOCAL);

  /*
   * TROIS POSTES, ET LE PLUS PROCHE N'EST PAS LE PREMIER INSERE. Sans cette precaution, un plan
   * qui rendrait simplement la premiere ligne trouvee passerait le test pour la mauvaise raison.
   */
  await posteA(45_000, 'C', DEP_LOCAL);
  await posteA(15_000, 'A', DEP_LOCAL);
  await posteA(25_000, 'B', DEP_LOCAL);

  const d = await distanceLocale();
  assert.ok(d != null, 'une distance doit etre rendue quand la couverture est declaree');
  const attendue = attendueKm(15_000);
  assert.ok(
    Math.abs(d - attendue) < 0.3,
    `le poste le plus proche doit rendre ${attendue} km depuis le bord — obtenu ${d} km`,
  );
});

test('A EGALITE PARFAITE, LE DEPARTAGE RESTE DETERMINISTE', async () => {
  if (ignorer()) return;
  await supprimerPostes();
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_LOCAL);

  /**
   * DEUX POSTES EXACTEMENT EQUIDISTANTS — des postes jumeles sur un meme site, ce qui existe
   * reellement. La distance retenue est la meme dans les deux cas ; ce qui compte est que le
   * resultat NE CHANGE PAS d'une execution a l'autre.
   *
   * C'est la seule raison du second etage de tri dans la requete : l'index KNN ne sait ordonner
   * que par la distance, et un tri sans ordre total est une troncature au hasard. La reecriture
   * de l'audit 13 aurait pu perdre cette propriete sans que rien ne le signale — aucune mesure de
   * duree ne l'aurait vue.
   */
  await posteA(30_000, 'JUMEAU-2', DEP_LOCAL);
  await posteA(30_000, 'JUMEAU-1', DEP_LOCAL);

  const mesures = [await distanceLocale(), await distanceLocale(), await distanceLocale()];
  assert.equal(
    new Set(mesures.map((m) => String(m))).size,
    1,
    `trois executions rendent des distances differentes : ${mesures.join(', ')}`,
  );
  assert.ok(mesures[0] != null && Math.abs(mesures[0] - attendueKm(30_000)) < 0.3);
});

test('UNE COMMUNE DONT LE DEPARTEMENT N’EST PAS COUVERT N’EST PAS MESUREE', async () => {
  if (ignorer()) return;
  await supprimerPostes();
  await viderCouvertureFictive();

  /**
   * LE DEFAUT MESURE, audit 13, et MA PREMIERE VERSION DE CE TEST SE TROMPAIT DE PROPRIETE.
   *
   * J'attendais `null` des que la couverture fictive etait retiree. La base a rendu **173 km** :
   * la requete cherchait le poste le plus proche PARMI TOUS LES DEPARTEMENTS COUVERTS, et 101
   * departements reels le sont. La commune fictive, en pleine mer, recevait donc la distance d'un
   * poste breton — et aurait ete peinte en ROUGE sur la carte nationale, « loin du reseau », alors
   * que personne n'avait regarde chez elle.
   *
   * C'est le defaut A3 de l'audit 9 — un faux rouge par trou dans la donnee — corrige pour les
   * parcelles et reste ouvert pour les communes. Il ne se voit qu'en couverture PARTIELLE, donc
   * pendant tout un deploiement progressif, et jamais sur une base complete.
   *
   * La requete filtre desormais sur le departement de la commune elle-meme.
   */
  await posteA(20_000, 'VOISIN', DEP_VOISIN);

  const sansCouverture = await distanceLocale();
  assert.equal(
    sansCouverture,
    null,
    `le departement de la commune n'est pas couvert : aucune distance ne doit etre rendue — ` +
      `obtenu ${sansCouverture}`,
  );

  /*
   * ET LE CONTRE-EXEMPLE : des que le departement de la commune est declare couvert, la mesure
   * reprend — et elle retient bien le poste du departement VOISIN, lui aussi declare. Sans ce
   * second volet, on aurait pu tout griser et croire le garde satisfait.
   */
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_LOCAL);
  await declarerCouvertureFictive('postes_sources', TYPE_COUVERTURE_POSTES, DEP_VOISIN);
  const apres = await distanceLocale();
  assert.ok(
    apres != null && Math.abs(apres - attendueKm(20_000)) < 0.3,
    `une fois les deux departements couverts, le poste voisin doit etre retenu — obtenu ${apres}`,
  );
  assert.ok(INSEE_VOISIN.length > 0);
});
