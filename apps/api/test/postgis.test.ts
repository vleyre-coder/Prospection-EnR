/**
 * Tests adosses a une vraie base PostGIS.
 *
 * POURQUOI ILS EXISTENT. Deux calculs metier ont ete deportes de JavaScript vers PostGIS :
 * la part de recouvrement d'une parcelle par un zonage, et le nombre de groupes de parcelles
 * jointives d'un site. Le premier gouverne le choix du zonage DOMINANT, dont depend un
 * knock-out ; le second gouverne la deduction de surface implantable d'un site. Une faute
 * dans ces requetes ne se voit ni au typage, ni aux tests unitaires : elle produit un nombre
 * plausible mais faux.
 *
 * COMMENT ILS S'EXECUTENT. Ils sont IGNORES si aucune base n'est joignable, plutot que de
 * faire echouer la suite sur un poste sans PostgreSQL. La CI, elle, fournit le service et les
 * execute : c'est la qu'ils protegent. Le mecanisme est explicite dans la sortie (« ignore :
 * base indisponible ») pour qu'un test silencieusement absent ne passe pas pour un test vert.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partCouverte, partsCouvertesExactes } from '../src/connecteurs/distances.js';
import { nbGroupesContigus } from '../src/depots/prospection.js';
import { requete } from '../src/bdd.js';
import type { GeoJsonGeometry } from '../src/geo.js';

/** Rectangle en WGS84, en coordonnees [ouest, est] x [sud, nord]. */
function rect(o: number, e: number, s: number, n: number): GeoJsonGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [o, s],
        [e, s],
        [e, n],
        [o, n],
        [o, s],
      ],
    ],
  };
}

/** Parcelle de reference : environ 370 m x 330 m en Beauce. */
const PARCELLE = rect(1.75, 1.755, 48.15, 48.153);

let baseDisponible: boolean | null = null;

async function base(): Promise<boolean> {
  if (baseDisponible != null) return baseDisponible;
  try {
    await requete('SELECT postgis_version()');
    baseDisponible = true;
  } catch {
    baseDisponible = false;
  }
  return baseDisponible;
}

test('les parts de recouvrement calculees par PostGIS sont exactes', async (t) => {
  if (!(await base())) return t.skip('ignore : base indisponible');

  const parts = await partsCouvertesExactes(PARCELLE, [
    rect(1.74, 1.77, 48.14, 48.16), // englobe la parcelle
    rect(1.8, 1.81, 48.2, 48.21), // disjointe
    rect(1.74, 1.7525, 48.14, 48.16), // moitie ouest
    rect(1.7525, 1.76, 48.1515, 48.16), // quart nord-est
    null, // geometrie absente
  ]);

  assert.equal(parts[0], 1, 'un zonage englobant couvre 100 %');
  assert.equal(parts[1], 0, 'un zonage disjoint couvre 0 %');
  assert.equal(parts[2], 0.5, 'la moitie ouest couvre 50 %');
  assert.equal(parts[3], 0.25, 'le quart nord-est couvre 25 %');
  assert.equal(parts[4], null, 'une geometrie absente reste inconnue, pas nulle en part');
});

test("PostGIS et l'echantillonnage concordent, l'exact remplace l'approche", async (t) => {
  if (!(await base())) return t.skip('ignore : base indisponible');

  // L'echantillonnage 40x40 etait la methode precedente. On verifie que le remplacement
  // n'a pas change les resultats, seulement leur cout et leur exactitude.
  const cibles = [
    rect(1.74, 1.77, 48.14, 48.16),
    rect(1.74, 1.7525, 48.14, 48.16),
    rect(1.7525, 1.76, 48.1515, 48.16),
    rect(1.751, 1.752, 48.1505, 48.1515),
  ];
  const exact = await partsCouvertesExactes(PARCELLE, cibles);
  for (let i = 0; i < cibles.length; i += 1) {
    const approche = partCouverte(PARCELLE, cibles[i]!);
    assert.ok(approche != null && exact[i] != null);
    assert.ok(
      Math.abs(exact[i]! - approche) <= 0.05,
      `cible ${i} : PostGIS ${exact[i]}, echantillonnage ${approche}`,
    );
  }
});

test('une liste de cibles vide ne declenche aucune requete', async () => {
  // Vrai meme sans base : le court-circuit precede l'acces.
  assert.deepEqual(await partsCouvertesExactes(PARCELLE, []), []);
});

test('la contiguite tolere une voirie et separe une vraie distance', async (t) => {
  if (!(await base())) return t.skip('ignore : base indisponible');

  const idus = ['991990000Z9001', '991990000Z9002', '991990000Z9003', '991990000Z9004'];
  await requete(`DELETE FROM parcelle WHERE idu = ANY($1)`, [idus]);
  try {
    // A et B partagent un bord. C est a 6 m de B (chemin d'exploitation). D est a 200 m.
    const geoms: Array<[string, number, number]> = [
      [idus[0]!, 1.75, 1.751],
      [idus[1]!, 1.751, 1.752],
      [idus[2]!, 1.75208, 1.753],
      [idus[3]!, 1.756, 1.757],
    ];
    for (const [idu, o, e] of geoms) {
      await requete(
        `INSERT INTO parcelle (idu, code_insee, code_departement, prefixe, section, numero,
                               nom_commune, geom, centroide)
         VALUES ($1::text, '99199', '99', '000', 'Z', substr($1::text, 11, 4), 'Test',
                 ST_Multi(ST_MakeEnvelope($2::float8, 48.15, $3::float8, 48.151, 4326)),
                 ST_SetSRID(ST_Point(($2::float8 + $3::float8) / 2, 48.1505), 4326))`,
        [idu, o, e],
      );
    }

    assert.equal(await nbGroupesContigus([idus[0]!, idus[1]!]), 1, 'deux parcelles jointives');
    assert.equal(
      await nbGroupesContigus([idus[0]!, idus[1]!, idus[2]!]),
      1,
      "un ecart de 6 m est une voirie franchissable, pas une rupture d'emprise",
    );
    assert.equal(
      await nbGroupesContigus([idus[0]!, idus[3]!]),
      2,
      '200 m separent deux emprises distinctes',
    );
    assert.equal(await nbGroupesContigus([idus[0]!]), 1, 'une parcelle seule est un groupe');
  } finally {
    await requete(`DELETE FROM parcelle WHERE idu = ANY($1)`, [idus]);
  }
});

test('une parcelle absente rend la contiguite inconnue plutot que fausse', async (t) => {
  if (!(await base())) return t.skip('ignore : base indisponible');

  // Compter les groupes sur un sous-ensemble donnerait un nombre optimiste : deux parcelles
  // dont une seule existe repondrait « 1 groupe », donc emprise unique, donc surface
  // implantable surestimee. `null` fait basculer le moteur sur l'hypothese prudente.
  assert.equal(await nbGroupesContigus(['000000000Z0001', '000000000Z0002']), null);
  assert.equal(await nbGroupesContigus([]), null, 'aucun IDU : rien a mesurer');
});
