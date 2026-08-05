/**
 * Transformation des reponses reelles en champs de snapshot.
 *
 * POURQUOI CE FICHIER EXISTE. Trois audits de suite ont trouve leur defaut critique au meme
 * endroit et pour la meme raison : un champ lu sous un nom que la source n'emploie pas.
 *
 *   Audit 5 : troncature WFS non detectee — distance a l'habitation fausse de deux ordres de
 *             grandeur, dans le sens favorable.
 *   Audit 6 : `typedoc` au lieu de `du_type`, `nom_site` au lieu de `sitename` — deux valeurs
 *             toujours nulles.
 *   Audit 7 : `libelle_risque_long` au lieu de `libPpr` — la detection des PPR n'avait JAMAIS
 *             fonctionne, et l'application affirmait « pas de PPRI, alea nul » partout en France.
 *
 * Le point commun : le code etait juste, les tests etaient justes, et la donnee n'arrivait pas.
 * Aucun test ecrit depuis le code ne peut voir cela — il verifie que le code lit bien le champ
 * qu'il lit. Ce qui l'attrape, c'est de faire passer une REPONSE REELLE dans la transformation et
 * de regarder ce qui sort.
 *
 * COMMENT. `fixtures/reponses/` porte des reponses capturees sur les services de production,
 * tronquees a quelques objets et dont les geometries sont decimees pour rester versionnables. Les
 * PROPRIETES sont intactes : c'est la transformation proprietes -> snapshot qu'on verifie ici.
 * L'exactitude geometrique, elle, est couverte par `postgis.test.ts`.
 *
 * Ces tests ne touchent pas le reseau : ils tournent partout, y compris hors ligne.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { famillesRisque, zonesReglementaires } from '../src/connecteurs/georisques.js';
import { estHabitation } from '../src/connecteurs/wfs.js';
import { zonageDepuisFeatures, type FeatureZonage } from '../src/connecteurs/distances.js';
import type { GeoJsonGeometry } from '../src/geo.js';

/** Charge une reponse enregistree. */
function reponse<T = Record<string, unknown>>(nom: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/reponses/${nom}.json`, import.meta.url), 'utf8'),
  ) as T;
}

interface Fc {
  features?: Array<{ geometry: GeoJsonGeometry | null; properties: Record<string, unknown> }>;
}
interface EnvA {
  data?: Array<Record<string, unknown>>;
}
interface EnvB {
  content?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Georisques : les PPR
// ---------------------------------------------------------------------------

test('Arles : le PPR submersion marine est vu comme un risque inondation', () => {
  // Reponse reelle de gaspar/pprn?codeInsee=13004. C'est LE cas qui prouvait le defaut : avant
  // correction, cette commune ressortait « pas de PPRI, alea inondation nul ».
  const plans = reponse<EnvB>('georisques-pprn-arles').content ?? [];
  assert.equal(plans.length, 1, 'la fixture doit porter le plan reel');
  const libelle = plans[0]!['libPpr'] as string;
  assert.match(libelle, /SUB marine/, 'libelle reel attendu');
  assert.deepEqual(famillesRisque(libelle), ['inondation']);
  // Et son zonage reglementaire comporte bien une zone d'interdiction stricte.
  assert.equal(zonesReglementaires(plans[0]!).severiteMax, 'interdiction_stricte');
});

test('Aix-en-Provence : les cinq familles du meme point d’entree sont distinguees', () => {
  const plans = reponse<EnvB>('georisques-pprn-aix').content ?? [];
  assert.ok(plans.length >= 4, `attendu au moins 4 plans, trouve ${plans.length}`);
  const familles = new Set(plans.flatMap((p) => famillesRisque(p['libPpr'] as string)));
  // gaspar/pprn melange les familles : le libelle est le seul discriminant.
  assert.ok(familles.has('inondation'), 'PPRN-I attendu');
  assert.ok(familles.has('incendie'), 'PPRN-IF attendu');
  assert.ok(familles.has('mouvement'), 'PPRN-MVT attendu');
  assert.ok(familles.has('argiles'), 'PPRN-RGA attendu');
});

test('Lyon : un PPRT sans sigle dans son libelle reste technologique', () => {
  // « Vallee de la chimie » ne porte aucun sigle. Sa famille vient de son POINT D'ENTREE.
  const plans = reponse<EnvB>('georisques-pprt-lyon').content ?? [];
  assert.equal(plans.length, 1);
  const libelle = plans[0]!['libPpr'] as string;
  assert.deepEqual(
    famillesRisque(libelle),
    [],
    'le libelle seul ne permet pas de conclure : c’est bien la provenance qui doit trancher',
  );
});

test('Menton : le plan multirisque compte dans ses deux familles', () => {
  const plans = reponse<EnvB>('georisques-pprn-menton').content ?? [];
  const multi = plans.find((p) => /multi/i.test(String(p['libPpr'])));
  assert.ok(multi, 'la fixture doit porter le plan multirisque reel');
  assert.deepEqual(famillesRisque(multi['libPpr'] as string).sort(), ['mouvement', 'seisme']);
});

test('l’ancien nom de champ ne ramene plus rien, et c’est bien le defaut d’origine', () => {
  // Demonstration directe : sur la reponse reelle, `libelle_risque_long` est absent. Lire ce champ
  // faisait recevoir la chaine vide au classifieur, donc AUCUNE famille, donc « pas de PPRI ».
  const plans = reponse<EnvB>('georisques-pprn-arles').content ?? [];
  assert.equal(plans[0]!['libelle_risque_long'], undefined);
  assert.equal(plans[0]!['libelle_risque'], undefined);
  assert.deepEqual(famillesRisque(plans[0]!['libelle_risque_long'] as string | undefined), []);
});

test('Lille : l’alea argiles se lit dans codeExposition', () => {
  const rga = reponse<{ codeExposition?: string; exposition?: string }>('georisques-rga-lille');
  assert.equal(rga.codeExposition, '3');
  assert.match(rga.exposition ?? '', /forte/i);
});

// ---------------------------------------------------------------------------
// GPU : le type de document d'urbanisme
// ---------------------------------------------------------------------------

test('le type de document se lit dans du_type, et pas dans typedoc', () => {
  const doc = reponse<Fc>('gpu-document-beauce').features?.[0]?.properties ?? {};
  assert.equal(doc['du_type'], 'PLUi', 'valeur reelle attendue');
  assert.equal(doc['typedoc'], undefined, 'le champ que le connecteur lisait n’existe pas');
  assert.equal(doc['datappro'], undefined, 'ni la date d’approbation, qui vient de zone-urba');
});

test('la date d’approbation appartient a zone-urba, et peut y etre nulle', () => {
  const z = reponse<Fc>('gpu-zone-urba-beauce').features?.[0]?.properties ?? {};
  // Le CONTRAT est que le champ existe sur ce point d'entree — c'est ce qu'un test de
  // transformation doit verifier. Sa VALEUR depend de la commune : releve reel, `datappro` vaut
  // `null` sur ce zonage alors que `typezone` est renseigne. Assertion posee sur la presence de
  // la cle, donc, et non sur son contenu : autrement le test dependrait du territoire capture.
  assert.ok('datappro' in z, 'datappro doit exister sur zone-urba');
  assert.ok(typeof z['typezone'] === 'string' && z['typezone'].length > 0, 'typezone attendu et renseigne');
  // Consequence metier a connaitre : une date d'approbation nulle est normale, donc la fiche ne
  // doit jamais presenter son absence comme une anomalie.
  assert.ok(z['datappro'] === null || typeof z['datappro'] === 'string');
});

test('is_rnu distingue une commune au reglement national', () => {
  const m = reponse<Fc>('gpu-municipality-beauce').features?.[0]?.properties ?? {};
  assert.equal(typeof m['is_rnu'], 'boolean');
  assert.equal(m['partition'], undefined, 'partition n’existe pas sur ce point d’entree');
});

// ---------------------------------------------------------------------------
// Nature : le nom du site, et le fait qu'il change de champ selon la couche
// ---------------------------------------------------------------------------

test('Natura 2000 : le nom est dans sitename, jamais dans nom ni nom_site', () => {
  const p = reponse<Fc>('nature-natura-habitat-camargue').features?.[0]?.properties ?? {};
  assert.ok(typeof p['sitename'] === 'string' && (p['sitename'] as string).length > 0);
  assert.equal(p['nom'], undefined);
  assert.equal(p['nom_site'], undefined);
  assert.equal(p['url_fiche'], undefined, 'la fiche INPN est dans `url`');
  assert.ok(typeof p['url'] === 'string');
});

test('ZNIEFF : le nom est dans nom, et sitename n’existe pas', () => {
  const p = reponse<Fc>('nature-znieff1-camargue').features?.[0]?.properties ?? {};
  assert.ok(typeof p['nom'] === 'string' && (p['nom'] as string).length > 0);
  assert.equal(p['sitename'], undefined, 'les deux couches ne rangent pas le nom au meme endroit');
});

test('WFS PatriNat : le nom est dans nom_site — un troisieme emplacement', () => {
  const p = reponse<Fc>('wfs-apb-rennes').features?.[0]?.properties ?? {};
  assert.ok(typeof p['nom_site'] === 'string' && (p['nom_site'] as string).length > 0);
  assert.equal(p['sitename'], undefined);
  assert.equal(p['nom'], undefined);
});

test('le nom retenu est celui du site le plus proche, sur des geometries reelles', () => {
  // Deux ZNIEFF reelles de Camargue. La parcelle est placee pres de la seconde de la liste :
  // le nom retenu doit etre le sien, pas celui de `features[0]`.
  const feats = reponse<Fc>('nature-znieff1-camargue').features ?? [];
  assert.ok(feats.length >= 2, 'deux zonages au moins sont necessaires pour que le test ait un sens');
  const zonages: FeatureZonage[] = feats
    .filter((f) => f.geometry)
    .map((f) => ({ geometry: f.geometry as GeoJsonGeometry, nom: f.properties['nom'] as string }));

  // Un point tres eloigne : le nom doit accompagner la distance minimale, quel que soit l'ordre.
  const loin: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [[[3.0, 43.0], [3.001, 43.0], [3.001, 43.001], [3.0, 43.001], [3.0, 43.0]]],
  };
  const r = zonageDepuisFeatures(loin, zonages, 500_000);
  assert.ok(r.distanceM != null, 'une distance doit etre mesuree');
  // Le nom rendu doit etre celui du zonage qui realise ce minimum, verifie zonage par zonage.
  const distances = zonages.map((z) => ({
    nom: z.nom,
    d: zonageDepuisFeatures(loin, [z], 500_000).distanceM,
  }));
  const plusProche = distances.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity))[0]!;
  assert.equal(r.nom, plusProche.nom);
  assert.equal(r.distanceM, plusProche.d);
});

// ---------------------------------------------------------------------------
// Cadastre et RPG
// ---------------------------------------------------------------------------

test('cadastre : les champs de reconstitution de l’IDU sont tous presents', () => {
  const p = reponse<Fc>('cadastre-parcelle-beauce').features?.[0]?.properties ?? {};
  for (const champ of ['idu', 'numero', 'section', 'code_dep', 'nom_com', 'code_insee', 'contenance']) {
    assert.ok(p[champ] !== undefined, `${champ} attendu`);
  }
  // La section cadastrale est sur DEUX caracteres, zero non significatif compris : la
  // reconstitution de l'IDU en depend.
  assert.equal(String(p['section']).length, 2);
});

test('RPG : le code de culture et le code de groupe sont presents', () => {
  const p = reponse<Fc>('rpg-v2-beauce').features?.[0]?.properties ?? {};
  assert.ok(typeof p['code_cultu'] === 'string');
  assert.ok(typeof p['code_group'] === 'string');
});

// ---------------------------------------------------------------------------
// BD TOPO : la qualification des habitations, sur du bati reel
// ---------------------------------------------------------------------------

test('sur du bati reel, « Indifferencie » est compte comme habitation', () => {
  // 40 batiments reels d'un village de Beauce. Avant correction, tout `usage_1` valant
  // « Indifferencie » etait ecarte — un tiers du bati a l'echelle nationale.
  const feats = reponse<Fc>('wfs-batiment-village').features ?? [];
  assert.ok(feats.length >= 20, `echantillon trop petit : ${feats.length}`);
  const indifferencies = feats.filter((f) => /indiff/i.test(String(f.properties['usage_1'])));
  assert.ok(indifferencies.length > 0, 'la fixture doit contenir des usages indetermines');
  for (const f of indifferencies) {
    const nature = String(f.properties['nature'] ?? '');
    // Sauf nature explicitement agricole ou industrielle, un usage indetermine compte.
    if (!/agricole|industriel|serre/i.test(nature)) {
      assert.equal(
        estHabitation(f.properties as never),
        true,
        `usage indetermine + nature « ${nature} » doit compter comme habitation`,
      );
    }
  }
});

test('sur du bati reel, un usage explicitement non residentiel reste ecarte', () => {
  const feats = reponse<Fc>('wfs-batiment-village').features ?? [];
  const exclus = feats.filter((f) =>
    /annexe|commercial|industriel|agricole|sportif|religieux/i.test(String(f.properties['usage_1'])),
  );
  for (const f of exclus) {
    // Sauf logements declares, qui sont un fait et priment sur l'usage.
    if (((f.properties['nombre_de_logements'] as number) ?? 0) === 0) {
      assert.equal(estHabitation(f.properties as never), false, `${f.properties['usage_1']} ne doit pas compter`);
    }
  }
});

test('la part d’habitations retenue sur un village reel reste plausible', () => {
  // Garde-fou de calibration : si une future modification faisait basculer tout le bati d'un cote
  // ou de l'autre, ce test le verrait. Mesure sur l'echantillon : entre 40 % et 95 %.
  const feats = reponse<Fc>('wfs-batiment-village').features ?? [];
  const part = feats.filter((f) => estHabitation(f.properties as never)).length / feats.length;
  assert.ok(part > 0.4 && part < 0.95, `part d'habitations implausible : ${(part * 100).toFixed(0)} %`);
});
