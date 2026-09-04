/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE L'APPLICATION PROPOSE D'ELLE-MEME — ET CE QU'ELLE REFUSE DE PROMETTRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `zonesAProspecter` est la reponse a « ou aller ? », la seule question que l'utilisateur se pose
 * en ouvrant l'outil et la seule a laquelle rien ne repondait. Elle porte quatre affirmations qui
 * peuvent se rompre en silence, et ce fichier les tient :
 *
 *   1. une zone trop petite pour la filiere n'est PAS proposee. Le minimum est celui du referentiel
 *      (1 ha en solaire, 10 en eolien) : proposer un mouchoir de poche ferait perdre le temps qu'on
 *      pretend faire gagner ;
 *   2. une zone designee pour une AUTRE filiere n'est pas proposee. Une ZAER methanisation n'est pas
 *      un terrain solaire ;
 *   3. une zone dont la deliberation ne precise pas le type d'implantation EST proposee, et dit
 *      qu'elle ne le precise pas. C'est la correction de la migration 016 : l'ancienne regle les
 *      ecartait toutes, soit 93 % des ZAER photovoltaiques dans l'Eure-et-Loir, sans que rien ne le
 *      signale a l'ecran ;
 *   4. « aucune zone » n'est pas « pas de donnee ». La reponse porte la couverture, sans quoi une
 *      liste vide sur un departement jamais ingere se lirait « il n'y a rien a prospecter ici ».
 *
 * Le territoire est le meme departement fictif que le reste des tests de base — en pleine mer, ou
 * aucune donnee reelle ne se trouve — pour ne rien affirmer sur des communes existantes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { zonesAProspecter } from '../src/services/zones.js';
import {
  creerCommunesFictives,
  supprimerCommunesFictives,
  DEP_LOCAL,
  INSEE_LOCAL,
  PT,
} from './aides/communes-fictives.js';

const SANS_BASE = !process.env['DATABASE_URL'];
const MARQUE = 'essai-zones/';

/**
 * Cree une ZAER carree de `cotesM` metres de cote, decalee vers l'est pour ne pas se superposer.
 *
 * Le carre est construit en degres a la latitude du point de test : a 47° N, un degre de longitude
 * vaut environ 75 km. La surface rendue par PostGIS en geographie est donc proche du carre voulu,
 * ce qui suffit — les tests portent sur des seuils, pas sur des surfaces au metre pres.
 */
async function creerZone(
  suffixe: string,
  cotesM: number,
  filieres: string[],
  implantationPrecisee: boolean,
  decalageM = 0,
): Promise<void> {
  const mParDegLon = 111320 * Math.cos((PT[1] * Math.PI) / 180);
  const dLon = cotesM / mParDegLon;
  const dLat = cotesM / 111320;
  const ouest = PT[0] + decalageM / mParDegLon;
  await requete(
    `INSERT INTO zaer (identifiant_source, code_insee, code_departement, filieres, geom,
                       est_demonstration, implantation_precisee, source_document)
     VALUES ($1, $2, $3, $4::text[],
             ST_Multi(ST_MakeEnvelope($5::float8, $6::float8, $7::float8, $8::float8, 4326)),
             false, $9, 'essai')
     ON CONFLICT (identifiant_source) WHERE identifiant_source IS NOT NULL DO UPDATE
       SET geom = EXCLUDED.geom, filieres = EXCLUDED.filieres,
           implantation_precisee = EXCLUDED.implantation_precisee`,
    [
      `${MARQUE}${suffixe}`,
      INSEE_LOCAL,
      DEP_LOCAL,
      filieres,
      ouest,
      PT[1],
      ouest + dLon,
      PT[1] + dLat,
      implantationPrecisee,
    ],
  );
}

before(async () => {
  if (SANS_BASE) return;
  await creerCommunesFictives();
  await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}%`]);
  // 400 m de cote = 16 ha : au-dessus du minimum solaire (1 ha) et du minimum eolien (10 ha).
  await creerZone('grande-precisee', 400, ['solaire_sol'], true, 0);
  // 300 m = 9 ha : au-dessus du minimum solaire, EN DESSOUS du minimum eolien.
  await creerZone('moyenne-imprecise', 300, ['solaire_sol'], false, 3000);
  // 50 m = 0,25 ha : sous le minimum de toutes les filieres, ecartee des le SQL.
  await creerZone('minuscule', 50, ['solaire_sol'], true, 6000);
  /*
   * 110 m = 1,21 ha BRUT, soit 0,96 ha UTILE apres erosion perimetrale — mesure :
   * `surfaceUtileEstimee(1.2, null, 'solaire_sol')` rend 0,955 ha.
   *
   * C'est la seule bande ou le filtre TypeScript decide seul : le filtre SQL, qui porte sur la
   * surface BRUTE, la laisse passer. Sans ce cas d'essai, retirer le filtre fin ne faisait echouer
   * aucun test — la campagne de mutation l'a montre, et c'est ce qui a fait ajouter cette zone.
   */
  await creerZone('sous-le-seuil-apres-erosion', 110, ['solaire_sol'], true, 12000);
  // Designee pour une autre filiere.
  await creerZone('methanisation', 400, ['methanisation'], true, 9000);
});

after(async () => {
  if (SANS_BASE) return;
  await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}%`]);
  await requete(`DELETE FROM couverture_ingestion WHERE code_departement = $1`, [DEP_LOCAL]);
  await supprimerCommunesFictives();
  await pool.end();
});

/** Les zones d'essai rendues, dans l'ordre du service. */
async function zonesDEssai(filiere: 'solaire_sol' | 'eolien_terrestre' | 'methanisation') {
  const r = await zonesAProspecter({ filiere, limite: 200 });
  return {
    ...r,
    zones: r.zones.filter((z) => z.codeDepartement === DEP_LOCAL),
  };
}

test('une zone trop petite pour la filiere n’est pas proposee', { skip: SANS_BASE }, async () => {
  const r = await zonesDEssai('solaire_sol');
  const noms = r.zones.map((z) => z.surfaceHa);
  assert.ok(
    r.zones.every((z) => z.surfaceUtileHa >= r.surfaceUtileMinHa),
    `une zone sous le minimum de ${r.surfaceUtileMinHa} ha a ete proposee : ${noms.join(', ')}`,
  );
  // La minuscule (0,25 ha) et celle qui passe sous le seuil APRES erosion (1,21 ha brut,
  // 0,96 ha utile) doivent avoir disparu ; les deux autres rester.
  assert.equal(r.zones.length, 2, `attendu 2 zones solaires, obtenu ${r.zones.length}`);
  assert.ok(
    r.zones.every((z) => z.surfaceHa > 1.3),
    'la zone de 1,21 ha brut tombe sous le minimum une fois la bande perimetrale deduite : ' +
      'elle ne doit pas etre proposee',
  );
});

test('le minimum applique est celui de la filiere, pas un seuil unique', { skip: SANS_BASE }, async () => {
  /*
   * 10 ha en eolien contre 1 ha en solaire. La zone de 9 ha passe en solaire et doit tomber en
   * eolien — sans quoi le seuil serait code en dur quelque part au lieu d'etre lu du referentiel,
   * et l'outil proposerait des terrains ou aucune machine ne tient.
   */
  const solaire = await zonesAProspecter({ filiere: 'solaire_sol', limite: 5 });
  const eolien = await zonesAProspecter({ filiere: 'eolien_terrestre', limite: 5 });
  assert.equal(solaire.surfaceUtileMinHa, 1);
  assert.equal(eolien.surfaceUtileMinHa, 10);
});

test('une zone designee pour une autre filiere n’est pas proposee', { skip: SANS_BASE }, async () => {
  const solaire = await zonesDEssai('solaire_sol');
  const metha = await zonesDEssai('methanisation');
  assert.ok(
    solaire.zones.every((z) => z.filieres.includes('solaire_sol')),
    'une zone hors filiere a ete proposee en solaire',
  );
  assert.equal(metha.zones.length, 1, 'la zone methanisation doit etre proposee en methanisation');
  assert.ok(metha.zones[0]!.filieres.includes('methanisation'));
});

test('une implantation non precisee est proposee, ET signalee', { skip: SANS_BASE }, async () => {
  /*
   * LE POINT DE LA MIGRATION 016. Mesure sur la source : dans l'Eure-et-Loir, 93 % des ZAER
   * photovoltaiques n'ont aucun detail d'implantation, contre 10 % au national. L'ancienne regle
   * les ecartait toutes : l'ingestion du departement retenait 799 zones sur 10 650, et le seul
   * signe visible etait une ligne de journal. Les proposer sans dire ce qu'on ignore serait l'exces
   * inverse.
   */
  const r = await zonesDEssai('solaire_sol');
  const imprecise = r.zones.find((z) => !z.implantationPrecisee);
  assert.ok(imprecise, 'la zone a implantation non precisee doit etre proposee');
  const precise = r.zones.find((z) => z.implantationPrecisee);
  assert.ok(precise, 'la zone a implantation precisee doit rester proposee');
});

test('LA COUVERTURE EST RENDUE : « aucune zone » n’est pas « pas de donnee »', { skip: SANS_BASE }, async () => {
  /*
   * Sans cette reponse, une liste vide ment. Le test verifie que la couverture SUIT l'ingestion :
   * elle ne connait pas le departement fictif tant que rien n'y a ete enregistre, et le connait
   * ensuite.
   */
  const avant = await zonesAProspecter({ filiere: 'solaire_sol', limite: 1 });
  assert.ok(
    !avant.couverture.departementsIngeres.includes(DEP_LOCAL),
    'le departement fictif ne doit pas etre annonce comme ingere avant de l’avoir ete',
  );

  await requete(
    `INSERT INTO source_donnee (connecteur, nom, mode_acces) VALUES ('zaer_local', '[essai] zaer', 'api')
     ON CONFLICT (connecteur) DO NOTHING`,
  );
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ('zaer_local', 'zaer', $1, 3)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET nb_objets = 3`,
    [DEP_LOCAL],
  );
  const apres = await zonesAProspecter({ filiere: 'solaire_sol', limite: 1 });
  assert.ok(
    apres.couverture.departementsIngeres.includes(DEP_LOCAL),
    'le departement ingere doit apparaitre dans la couverture',
  );
  assert.equal(apres.couverture.donneePresente, true);
});

test('l’emprise restreint la proposition', { skip: SANS_BASE }, async () => {
  // Une emprise a l'ouest du territoire fictif ne doit rien rendre : la proposition suit ce que
  // l'utilisateur regarde des qu'il lui donne une emprise.
  const ailleurs = await zonesAProspecter({
    filiere: 'solaire_sol',
    bbox: [PT[0] - 5, PT[1] - 5, PT[0] - 4, PT[1] - 4],
    limite: 50,
  });
  assert.equal(
    ailleurs.zones.filter((z) => z.codeDepartement === DEP_LOCAL).length,
    0,
    'une emprise eloignee ne doit proposer aucune zone du territoire fictif',
  );
});

test('chaque zone porte de quoi y aller et de quoi decider', { skip: SANS_BASE }, async () => {
  const r = await zonesDEssai('solaire_sol');
  const z = r.zones[0];
  assert.ok(z, 'au moins une zone attendue');
  // Le centre sert a recentrer la carte : sans lui, la liste ne mene nulle part.
  assert.equal(z.centre.length, 2);
  assert.ok(Number.isFinite(z.centre[0]) && Number.isFinite(z.centre[1]));
  // Le centre doit tomber DANS l'emprise de la zone, pas a cote.
  assert.ok(z.centre[0] >= z.bbox[0] && z.centre[0] <= z.bbox[2], 'centre hors de son emprise');
  assert.ok(z.centre[1] >= z.bbox[1] && z.centre[1] <= z.bbox[3], 'centre hors de son emprise');
  assert.ok(z.surfaceHa > 0 && z.surfaceUtileHa > 0);
  assert.ok(z.surfaceUtileHa <= z.surfaceHa, 'la surface utile ne peut pas depasser la brute');
});
