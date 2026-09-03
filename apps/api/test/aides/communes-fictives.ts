/**
 * Referentiel communal fictif, au large, pour tester la couverture d'un disque de recherche.
 *
 * POURQUOI CE FICHIER EXISTE. La verification introduite a l'audit 9 (defaut A3) resout le disque de
 * recherche sur la table `commune` : une distance au plus proche n'est une mesure que si tous les
 * departements que le disque traverse sont ingeres. Les tests qui l'exercent ont donc besoin d'un
 * referentiel communal — et la premiere version s'appuyait sur les communes REELLES, ce qui posait
 * deux problemes que la CI a immediatement montres :
 *
 *   1. la base de la CI n'ingere pas les communes : le disque ne trouvait aucun departement, donc
 *      « non couvert », donc les tests du patrimoine echouaient pour une raison etrangere a ce
 *      qu'ils verifient ;
 *   2. declarer une couverture inventee sur le 28 ou le 45 fait ecrire dans une table dont
 *      l'application se sert pour decider si elle peut affirmer quelque chose. Meme restaure, c'est
 *      une manipulation qu'un test ne devrait pas avoir a faire.
 *
 * La solution est un territoire fictif place en pleine mer, au large de la Bretagne, ou aucune
 * commune reelle ne peut se trouver : deux departements imaginaires (`99` et `98`) separes par une
 * frontiere nord-sud. Le point de test est dans le `99`, a 5 km de la frontiere. Les proprietes
 * geometriques utiles en decoulent, sans dependre d'aucune donnee reelle :
 *
 *   - un disque de 2 km autour du point ne touche que le `99` ;
 *   - un disque de 10 km touche le `99` ET le `98`.
 */

import { requete } from '../../src/bdd.js';

/** Departement fictif contenant le point de test. */
export const DEP_LOCAL = '99';
/** Departement fictif voisin, dont la frontiere est a 5 km a l'est du point de test. */
export const DEP_VOISIN = '98';
export const DEPS_FICTIFS = [DEP_LOCAL, DEP_VOISIN];

/** Point de test, en pleine mer : aucune commune reelle ne s'y trouve. */
export const PT: [number, number] = [-6.5, 47.0];

export const INSEE_LOCAL = '99001';
export const INSEE_VOISIN = '98001';

/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LE TERRITOIRE FICTIF EST PARTAGE, DONC IL DOIT ETRE PARCOURU EN SERIE
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE L'AUDIT 11 A MESURE, et c'est la cause de l'echec de l'integration continue depuis
 * huit livraisons. Treize fichiers de test ecrivent dans la MEME base et se partagent ce
 * territoire fictif : le departement 99, la commune 99001, l'espace des IDU `99001000AA…`.
 * Plusieurs d'entre eux commencent et finissent par un menage du genre
 * `DELETE FROM parcelle WHERE code_departement = '99'`.
 *
 * Or `node --test` execute les FICHIERS en parallele, dans des processus distincts. Le menage
 * de l'un efface donc la population de l'autre en pleine execution. Mesures faites sur une
 * base fraichement migree, memes fichiers, meme commande a un drapeau pres :
 *
 *   - en parallele : 51/57 puis 75/77 — et **les tests en echec changent d'une execution a
 *     l'autre**, ce qui est la signature d'une course et ce qui faisait ressembler la CI a une
 *     panne differente chaque fois ;
 *   - en serie     : 57/57 puis 77/77, de facon reproductible.
 *
 * Le prix de la serialisation a ete mesure, parce qu'un choix de conception se paie : 44 s
 * contre 34 s sur les treize fichiers. **Dix secondes.** Il n'existe donc aucun argument de
 * vitesse pour conserver la course, et le diagnostic « c'est le parallelisme » — pose lors de
 * la livraison precedente puis laisse en l'etat — n'avait aucune excuse a ne pas etre traite.
 *
 * POURQUOI UN GARDE PLUTOT QU'UN COMMENTAIRE. Le drapeau vit dans la commande, c'est-a-dire
 * loin des tests qui en dependent. Un fichier ajoute demain, ou une commande recopiee sans le
 * drapeau, ramenerait la course — en silence, et sous la forme d'un echec qui accuse le code
 * teste. Le garde transforme ce silence en refus qui nomme la commande a utiliser.
 */
export const DRAPEAU_SERIE = '--test-concurrency=1';

/**
 * Rend le message de refus si l'execution risque la course, `null` si tout va bien.
 *
 * Fonction PURE, et parametree, pour etre testable sans manipuler l'etat du processus.
 * Sans base de donnees il n'y a rien a partager : ces fichiers s'ignorent, et exiger la serie
 * ferait echouer un `npm test` ordinaire pour rien.
 */
export function refusDeCourse(
  execArgv: readonly string[],
  env: { DATABASE_URL?: string | undefined },
): string | null {
  if (!env.DATABASE_URL) return null;
  if (execArgv.includes(DRAPEAU_SERIE)) return null;
  return (
    'Ces tests ecrivent dans une base partagee et se partagent le departement fictif ' +
    `${DEP_LOCAL} : executes en parallele, ils s'effacent mutuellement leurs donnees et ` +
    'rendent des echecs qui changent a chaque fois.\n' +
    `Relancez-les en serie : \`npm run test:base --workspace @enr/api\` (qui ajoute ${DRAPEAU_SERIE}).\n` +
    "Mesure de l'audit 11 : 77/77 en serie, 75/77 puis 51/57 en parallele, pour dix secondes " +
    'de difference.'
  );
}

const refus = refusDeCourse(process.execArgv, process.env);
if (refus) throw new Error(refus);

/** Metres par degre de longitude a la latitude du point de test. */
const M_PAR_DEG_LON = 111320 * Math.cos((PT[1] * Math.PI) / 180);

/** Convertit une distance en metres vers l'est en degres de longitude. */
export function versEst(metres: number): number {
  return metres / M_PAR_DEG_LON;
}

/**
 * Cree les deux communes fictives, si elles n'existent pas deja.
 *
 * Chacune est un rectangle de 40 km de haut. Le `99` va de 20 km a l'ouest du point jusqu'a 5 km a
 * l'est ; le `98` prend la suite jusqu'a 60 km a l'est. La frontiere est donc a exactement 5 km.
 */
export async function creerCommunesFictives(): Promise<void> {
  const dLat = 20000 / 111320;
  const bornes: Array<[string, string, number, number]> = [
    [INSEE_LOCAL, DEP_LOCAL, -20000, 5000],
    [INSEE_VOISIN, DEP_VOISIN, 5000, 60000],
  ];
  for (const [insee, dep, ouestM, estM] of bornes) {
    await requete(
      `INSERT INTO commune (code_insee, nom, code_departement, geom, centroide, surface_ha)
       VALUES ($1, $2, $3,
               ST_Multi(ST_MakeEnvelope($4::float8, $5::float8, $6::float8, $7::float8, 4326)),
               ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326), 1000)
       ON CONFLICT (code_insee) DO UPDATE SET geom = EXCLUDED.geom,
                                             code_departement = EXCLUDED.code_departement`,
      [
        insee,
        `Commune fictive ${insee}`,
        dep,
        PT[0] + versEst(ouestM),
        PT[1] - dLat,
        PT[0] + versEst(estM),
        PT[1] + dLat,
      ],
    );
  }
}

export async function supprimerCommunesFictives(): Promise<void> {
  await requete(`DELETE FROM commune WHERE code_insee = ANY($1)`, [[INSEE_LOCAL, INSEE_VOISIN]]);
}

/**
 * Declare une couche ingeree pour un departement fictif.
 *
 * LE DEFAUT QUE CETTE FONCTION PORTAIT, et il rendait 23 tests dependants de l'HISTOIRE de la
 * base. `couverture_ingestion.connecteur` est une cle etrangere vers `source_donnee` — table
 * peuplee par `synchroniserReferentiel()` au DEMARRAGE DU SERVEUR, jamais par les tests. Sur
 * une base ou le serveur avait deja tourne, l'insertion passait ; sur une base fraichement
 * migree, elle echouait sur `couverture_ingestion_connecteur_fkey`.
 *
 * Consequence mesuree : `DATABASE_URL=... npm test` rendait 23 echecs sur une base neuve et
 * zero sur une base deja utilisee, sans qu'aucun message n'oriente vers la cause. Et la CI
 * n'en voyait rien : elle lance `npm test` SANS `DATABASE_URL`, donc ces tests s'y ignorent —
 * ils etaient rouges depuis un moment sans que personne le sache.
 *
 * Le remede suit la regle deja appliquee deux fois dans ce depot : **un test etablit sa propre
 * precondition**. Le connecteur est donc cree s'il manque, avec des valeurs minimales et un
 * libelle qui dit d'ou il vient — pour qu'une ligne d'essai retrouvee en base ne passe pas
 * pour une source reelle.
 */
export async function declarerCouvertureFictive(
  connecteur: string,
  type: string,
  dep: string,
  nbObjets = 1,
): Promise<void> {
  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces)
     VALUES ($1, $2, 'api')
     ON CONFLICT (connecteur) DO NOTHING`,
    [connecteur, `[essai] connecteur fictif ${connecteur}`],
  );
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET nb_objets = EXCLUDED.nb_objets`,
    [connecteur, type, dep, nbObjets],
  );
}

/** Efface toute couverture posee sur les departements fictifs. */
export async function viderCouvertureFictive(): Promise<void> {
  await requete(`DELETE FROM couverture_ingestion WHERE code_departement = ANY($1)`, [
    DEPS_FICTIFS,
  ]);
}
