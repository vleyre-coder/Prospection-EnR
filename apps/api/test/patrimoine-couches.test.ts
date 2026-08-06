/**
 * `patrimoine()` face a une base partiellement ingeree.
 *
 * POURQUOI CE FICHIER EXISTE. Le defaut le plus grave des huit audits vivait dans cette fonction, et
 * aucun test ne pouvait le voir parce qu'aucun test ne touchait la base. Il tenait en trois fautes
 * superposees :
 *
 *   1. quatre types patrimoniaux etaient lus, un seul est ingere, et les trois listes vides
 *      devenaient des absences CONSTATEES — `pat_sites` valait 90/100 en vert avec la phrase
 *      « Aucun site classe ni inscrit dans le rayon d'analyse », partout en France ;
 *   2. le controle de couverture interrogeait `couverture_ingestion` SANS filtre de departement,
 *      alors que la table est clé-primairée par departement : une base ingeree pour le seul
 *      departement 45 affirmait sur une parcelle du 06 ;
 *   3. un `LIMIT 200` etait partage par les quatre types : autour d'une ville dense, les 200 lignes
 *      pouvaient etre entierement consommees par des monuments historiques, et les trois autres
 *      types etaient declares absents alors qu'ils avaient seulement ete tronques.
 *
 * Les tests s'executent sur une base jetable et n'y touchent qu'a travers un departement fictif
 * (`99`) et un connecteur fictif, pour ne jamais interferer avec des donnees reelles. Ils
 * s'ignorent proprement si aucune base n'est disponible.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { oublierPresenceCouches } from '../src/connecteurs/couches.js';
import { patrimoine } from '../src/connecteurs/locales.js';

/** Departement fictif : aucune donnee reelle ne porte ce code. */
const DEP = '99';
const CONNECTEUR = 'patrimoine_culture';
/** Un point quelconque, en Beauce, loin de toute donnee reelle du jeu de demonstration. */
const PT: [number, number] = [1.75, 48.15];

let baseDisponible = false;

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM contrainte WHERE code_departement = $1`, [DEP]);
  await requete(`DELETE FROM couverture_ingestion WHERE code_departement = $1`, [DEP]);
  oublierPresenceCouches();
}

/**
 * Egalite de distance a la tolerance de la conversion.
 *
 * `inserer()` convertit des metres en degres par un facteur constant, alors que PostGIS mesure la
 * distance sur l'ellipsoide : l'ecart est de l'ordre de 0,3 %. Mes premieres assertions comparaient a
 * l'egalite stricte et echouaient sur 2 808 au lieu de 2 800 — un faux echec, qui aurait pousse a
 * « corriger » du code juste. Ce qui est teste ici est le RANG et la PRESENCE des objets, pas la
 * precision geodesique, qui a son propre fichier de tests.
 */
function distanceProche(obtenu: number | null | undefined, attendu: number, message: string): void {
  assert.ok(obtenu != null, `${message} : distance absente`);
  const ecart = Math.abs(obtenu - attendu) / attendu;
  assert.ok(ecart < 0.01, `${message} : attendu ~${attendu} m, obtenu ${obtenu} m`);
}

/** Insere un objet patrimonial a `metres` du point de test, vers l'est. */
async function inserer(
  type: string,
  nom: string,
  metres: number,
  identifiant: string,
): Promise<void> {
  // 1 degre de longitude vaut environ 74,4 km a 48 deg de latitude.
  const dLon = metres / (111195 * Math.cos((48.15 * Math.PI) / 180));
  await requete(
    `INSERT INTO contrainte (type, nom, identifiant_source, geom, connecteur, code_departement, date_donnee)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, current_date)
     ON CONFLICT (connecteur, type, identifiant_source) DO NOTHING`,
    [type, nom, identifiant, PT[0] + dLon, PT[1], CONNECTEUR, DEP],
  );
}

/** Declare la couche `type` ingeree pour le departement de test. */
async function declarerCouverture(type: string, nbObjets = 1): Promise<void> {
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET nb_objets = EXCLUDED.nb_objets`,
    [CONNECTEUR, type, DEP, nbObjets],
  );
  oublierPresenceCouches();
}

/**
 * UN TEST DE BASE QUI PASSE A VIDE EST UN TEST DECORATIF.
 *
 * Premiere version de ce bloc : un `try/catch` qui mettait `baseDisponible` a `false` sur n'importe
 * quelle erreur. La verification par mutation l'a immediatement pris en defaut — le serveur
 * PostgreSQL local etait tombe, les six tests passaient en affichant « base indisponible », et la
 * mutation qui retablissait le defaut le plus grave de l'audit 8 n'etait attrapee par personne.
 *
 * La regle retenue distingue les deux situations :
 *   - `DATABASE_URL` absent : la machine n'a pas de base, on s'ignore explicitement ;
 *   - `DATABASE_URL` present mais injoignable : c'est une PANNE, pas une dispense. Le test echoue,
 *     avec le motif de connexion.
 */
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
  await nettoyer();
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    // Un test ignore doit se voir : un `skip` silencieux se confond avec un test qui passe.
    process.stderr.write('# base indisponible : test patrimoine ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('un departement sans aucune couverture ne produit AUCUN constat', async () => {
  if (ignorer()) return;
  await nettoyer();
  // Rien de declare pour le departement 99 : la fonction doit refuser de repondre, et non
  // repondre « rien ».
  assert.equal(await patrimoine(PT, DEP), null);
});

test('une couche non ingeree vaut « inconnu », et non « absent »', async () => {
  if (ignorer()) return;
  await nettoyer();
  // Seuls les monuments historiques sont ingeres — la situation reelle de l'application.
  await inserer('monument_historique', 'Eglise Saint-Pierre', 2800, 'MH-1');
  await declarerCouverture('monument_historique');

  const r = await patrimoine(PT, DEP);
  assert.ok(r, 'la couche des monuments est ingeree : la fonction doit repondre');

  distanceProche(r.monumentHistorique?.distanceM, 2800, 'le monument ingere est bien mesure');
  assert.equal(r.monumentHistorique?.nom, 'Eglise Saint-Pierre');
  assert.equal(r.monumentHistorique?.dansPerimetreProtection, false);

  // LE DEFAUT : ces trois lignes valaient `recouvre: false, partRecouvrement: 0`.
  for (const [libelle, z] of [
    ['site classe', r.siteClasse],
    ['site inscrit', r.siteInscrit],
    ['SPR', r.spr],
  ] as const) {
    assert.equal(z?.recouvre, null, `${libelle} : couche non ingeree, donc inconnue`);
    assert.equal(z?.partRecouvrement, null, `${libelle} : aucune part ne peut etre affirmee`);
    assert.equal(z?.distanceM, null);
  }
});

test('une couche ingeree sans objet dans le rayon vaut « absent »', async () => {
  if (ignorer()) return;
  await nettoyer();
  // La distinction inverse, tout aussi necessaire : declarer la couche ingeree pour le departement
  // alors qu'aucun objet n'est dans le rayon d'analyse est une absence CONSTATEE.
  await inserer('monument_historique', 'Eglise', 2800, 'MH-1');
  await declarerCouverture('monument_historique');
  await declarerCouverture('site_classe', 12); // ingeree pour le departement...
  await inserer('site_classe', 'Vallee lointaine', 40000, 'SC-1'); // ...mais hors rayon de 10 km

  const r = await patrimoine(PT, DEP);
  assert.equal(r?.siteClasse?.recouvre, false, 'couche ingeree, rien dans le rayon : absence constatee');
  assert.equal(r?.siteClasse?.partRecouvrement, 0);
});

test('le plafond de lignes est par TYPE, et non partage entre les types', async () => {
  if (ignorer()) return;
  await nettoyer();
  /**
   * Le defaut de troncature, reproduit a l'identique.
   *
   * L'ancienne requete faisait `ORDER BY distance_m LIMIT 200` sur les quatre types confondus. On
   * insere donc 60 monuments PLUS PROCHES qu'un site inscrit unique et plus lointain : avec un
   * plafond partage et un tri par distance, un plafond de 40 aurait ete entierement consomme par
   * les monuments, et le site inscrit aurait disparu — declare absent alors qu'il existe.
   */
  await declarerCouverture('monument_historique', 60);
  await declarerCouverture('site_inscrit', 1);
  for (let i = 0; i < 60; i += 1) {
    await inserer('monument_historique', `Monument ${i}`, 100 + i, `MH-${i}`);
  }
  await inserer('site_inscrit', 'Centre ancien', 5000, 'SI-1');

  const r = await patrimoine(PT, DEP);
  assert.equal(
    r?.siteInscrit?.nom,
    'Centre ancien',
    'le site inscrit doit survivre a 60 monuments plus proches',
  );
  distanceProche(r?.siteInscrit?.distanceM, 5000, 'distance au site inscrit');
  distanceProche(r?.monumentHistorique?.distanceM, 100, 'le monument le plus proche reste le bon');
});

test('l’avis de l’ABF est requis par un site inscrit SEUL, sans monument a proximite', async () => {
  if (ignorer()) return;
  await nettoyer();
  /**
   * L'ordre des conditions comptait. L'ancienne expression etait
   *
   *     distanceMhM == null ? null : distanceMhM <= 500 || siteInscrit.some(...) || spr.some(...)
   *
   * et le court-circuit sur l'absence de monument s'executait AVANT l'examen du site inscrit. Une
   * parcelle a l'interieur d'un site inscrit, sans monument dans les 10 km, obtenait `null` au lieu
   * de `true` — alors que l'article L. 341-1 n'exige aucun monument.
   */
  await declarerCouverture('site_inscrit', 1);
  await requete(
    `INSERT INTO contrainte (type, nom, identifiant_source, geom, connecteur, code_departement, date_donnee)
     VALUES ('site_inscrit', 'Bourg ancien', 'SI-2',
             ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.01), $3, $4, current_date)
     ON CONFLICT (connecteur, type, identifiant_source) DO NOTHING`,
    [PT[0], PT[1], CONNECTEUR, DEP],
  );

  const r = await patrimoine(PT, DEP);
  assert.equal(r?.siteInscrit?.recouvre, true, 'la parcelle est dans le site inscrit');
  assert.equal(
    r?.avisAbfRequis,
    true,
    "un site inscrit suffit a requerir l'avis de l'ABF, meme sans monument",
  );
  assert.equal(
    r?.monumentHistorique?.dansPerimetreProtection,
    null,
    'la couche des monuments n’etant pas ingeree, on ne peut rien en dire',
  );
});

test('l’avis de l’ABF reste inconnu quand aucun motif n’est etabli ni ecarte', async () => {
  if (ignorer()) return;
  await nettoyer();
  // Seuls les monuments sont ingeres, et aucun n'est a moins de 500 m. Le motif « monument » est
  // donc ecarte, mais les motifs « site inscrit » et « SPR » ne sont ni etablis ni ecartes : le
  // verdict doit rester inconnu, et non basculer a `false`.
  await inserer('monument_historique', 'Chapelle', 3000, 'MH-A');
  await declarerCouverture('monument_historique');

  const r = await patrimoine(PT, DEP);
  assert.equal(r?.avisAbfRequis, null, 'un motif inconnu empeche de conclure a l’absence d’avis');
});
