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
  DEP_VOISIN,
  INSEE_LOCAL,
  INSEE_VOISIN,
  PT,
  versEst,
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
  /**
   * Commune et departement de rattachement. Par defaut le territoire fictif principal.
   *
   * Le parametre existe pour le test du tri : il faut y rattacher des zones a une commune dont on
   * connait la surface, et une a une commune INCONNUE — `zaer.code_insee` ne porte aucune cle
   * etrangere, donc le cas se produit reellement en base.
   */
  rattachement: { insee: string | null; dep: string } = { insee: INSEE_LOCAL, dep: DEP_LOCAL },
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
           code_insee = EXCLUDED.code_insee,
           implantation_precisee = EXCLUDED.implantation_precisee`,
    [
      `${MARQUE}${suffixe}`,
      rattachement.insee,
      rattachement.dep,
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

/**
 * Les zones d'essai rendues, dans l'ordre du service.
 *
 * ═══ L'EMPRISE EST BORNEE, ET CE N'EST PAS COSMETIQUE
 *
 * CE QUI NE MARCHAIT PLUS. Cette fonction appelait `zonesAProspecter({ limite: 200 })` sans
 * emprise, puis filtrait le departement fictif dans le resultat. Or le service trie PUIS tronque :
 * sur une base portant des zones REELLES, les zones fictives — 16 ha et 9 ha — tombent hors de la
 * fenetre des 200 plus grandes, et deux tests de ce fichier echouent pour une raison etrangere a
 * ce qu'ils verifient.
 *
 * MESURE dans cet environnement, sur la base des tests de bout en bout (Eure-et-Loir ingere) :
 * 174 zones solaires de plus de 16 ha, et les deux tests en question echouent — code de production
 * INCHANGE, verifie en remisant la modification en cours. Ils ne passaient donc que sur une base
 * fraiche, et rien ne le disait.
 *
 * Ce n'est pas un defaut d'apparat : un test dont la reussite depend de ce que la base contient ce
 * jour-la n'a pas de valeur de preuve, et le premier a en payer le prix est celui qui le voit
 * echouer sans comprendre pourquoi. L'emprise du territoire fictif — 25 km d'ouest en est autour
 * du point d'essai — rend le resultat independant du contenu de la base.
 */
async function zonesDEssai(filiere: 'solaire_sol' | 'eolien_terrestre' | 'methanisation') {
  const r = await zonesAProspecter({
    filiere,
    bbox: [PT[0] + versEst(-2000), PT[1] - 0.05, PT[0] + versEst(20000), PT[1] + 0.1],
    limite: 200,
  });
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

test(
  'UNE DESIGNATION A L’ECHELLE DE LA COMMUNE PASSE APRES LES SITES, et elle est marquee',
  { skip: SANS_BASE },
  async () => {
    /*
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     * LE DEFAUT MESURE : les quarante lignes du panneau, monopolisees par ce qui n'est pas un site
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     *
     * Le tri etait « la plus grande d'abord ». Distribution des 7 664 zones d'un departement reel :
     *
     *     < 1 ha            5 683 zones      50 - 200 ha    118
     *     1 - 10 ha         1 460            200 - 1000 ha   51
     *     10 - 50 ha          337            > 1000 ha       15
     *
     * et 24 de ces zones couvrent PLUS DE LA MOITIE de leur commune, dont 14 plus de 80 %. Une
     * commune qui designe 80 % de son territoire n'a pas designe un site : elle a pris une
     * deliberation d'echelle communale. Le tri par surface les mettait en tete, elles remplissaient
     * la liste, et l'operateur ne voyait jamais un site de 10 a 100 ha — le seul objet qu'il cherche.
     *
     * CE TEST EST LE GARDE DE CE TRI. Trois zones sur la commune voisine, dont la surface declaree
     * est de 1 000 ha :
     *
     *   - « territoriale » : 2 400 m de cote, soit environ 576 ha, donc 58 % de la commune ;
     *   - « site » : 700 m de cote, environ 49 ha — bien plus PETIT, et pourtant attendu AVANT ;
     *   - « sans-commune » : 300 m, rattachee a un code INSEE absent de `commune`. Sa part est donc
     *     inconnue, et elle doit rester dans le premier groupe : releguer sur un DOUTE reviendrait a
     *     cacher un site chaque fois que la commune manque.
     */
    const AILLEURS = { insee: INSEE_VOISIN, dep: DEP_VOISIN };
    await creerZone('tri-territoriale', 2400, ['solaire_sol'], true, 20000, AILLEURS);
    await creerZone('tri-site', 700, ['solaire_sol'], true, 30000, AILLEURS);
    await creerZone('tri-sans-commune', 300, ['solaire_sol'], true, 36000, {
      insee: '99999',
      dep: DEP_VOISIN,
    });

    /*
     * L'EMPRISE EST DONNEE, et ce n'est pas un detail de commodite.
     *
     * `zonesAProspecter` trie PUIS tronque a `limite`. Sur une base qui porte des zones reelles —
     * mesure sur celle de cet environnement : 174 zones solaires de plus de 16 ha — les zones
     * fictives tombent hors de la fenetre et le test echoue pour une raison etrangere a ce qu'il
     * verifie. Deux tests plus haut dans ce fichier ont ce defaut et ne passent que sur une base
     * fraiche ; celui-ci borne l'emprise au territoire fictif, et devient vrai sur n'importe quelle
     * base.
     */
    const bbox: [number, number, number, number] = [
      PT[0] + versEst(15000),
      PT[1] - 0.05,
      PT[0] + versEst(45000),
      PT[1] + 0.1,
    ];
    const r = await zonesAProspecter({ filiere: 'solaire_sol', bbox, limite: 500 });
    const nos = r.zones.filter((z) => z.codeDepartement === DEP_VOISIN);
    assert.equal(nos.length, 3, `trois zones attendues sur le territoire voisin, obtenu ${nos.length}`);

    const territoriale = nos.find((z) => z.designationCommunale === true);
    assert.ok(
      territoriale,
      'la zone de 576 ha sur une commune de 1 000 ha doit etre marquee « designation communale »',
    );
    assert.ok(
      territoriale.surfaceHa > 400,
      `surface attendue autour de 576 ha, obtenue ${territoriale.surfaceHa}`,
    );

    const site = nos.find((z) => z.surfaceHa > 30 && z.surfaceHa < 100);
    assert.ok(site, 'la zone de 49 ha doit etre proposee');
    assert.equal(
      site.designationCommunale,
      false,
      '49 ha sur 1 000 ha ne fait pas une designation d’echelle communale',
    );

    const sansCommune = nos.find((z) => z.codeInsee === '99999');
    assert.ok(sansCommune, 'la zone rattachee a une commune inconnue doit etre proposee');
    assert.equal(
      sansCommune.designationCommunale,
      null,
      'une part de commune INCONNUE doit se dire `null`, et non se deviner en `false`',
    );

    /*
     * L'ASSERTION QUI PORTE LE TRI. Sans elle, tout ce qui precede se contenterait de verifier une
     * etiquette — la mutation du `ORDER BY` passerait sans bruit.
     */
    const iTerritoriale = nos.indexOf(territoriale);
    const iSite = nos.indexOf(site);
    const iSansCommune = nos.indexOf(sansCommune);
    assert.ok(
      iSite < iTerritoriale,
      `le site de ${site.surfaceHa} ha doit passer AVANT la designation de ` +
        `${territoriale.surfaceHa} ha (rangs ${iSite} et ${iTerritoriale})`,
    );
    assert.ok(
      iSansCommune < iTerritoriale,
      'une zone dont la part de commune est inconnue ne doit pas etre releguee : ' +
        `rangs ${iSansCommune} et ${iTerritoriale}`,
    );

    // Et la distance au poste source est rendue, ou franchement absente — jamais un zero trompeur.
    for (const z of nos) {
      assert.ok(
        z.distancePosteKm === null || (Number.isFinite(z.distancePosteKm) && z.distancePosteKm > 0),
        `distancePosteKm doit etre un nombre positif ou null, obtenu ${z.distancePosteKm}`,
      );
    }

    await requete(`DELETE FROM zaer WHERE identifiant_source LIKE $1`, [`${MARQUE}tri-%`]);
  },
);

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
