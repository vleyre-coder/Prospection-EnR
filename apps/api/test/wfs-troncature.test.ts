/**
 * Troncature silencieuse des reponses WFS.
 *
 * Le service plafonne `COUNT` a 5000 et, au-dela, renvoie un sous-ensemble arbitraire en
 * HTTP 200 sans le signaler autrement que par `numberMatched`. Mesure faite sur le service
 * reel : sur une emprise de 1500 m autour d'un point du centre d'Orleans, la couche batiment
 * annonce 15 892 objets et en renvoie 3000. La distance a l'habitation la plus proche calculee
 * sur ce sous-ensemble valait 373 m alors qu'elle est de 0 m — une erreur dans le sens
 * dangereux, puisqu'un eloignement surestime fait passer le knock-out des 500 m de l'eolien.
 *
 * Ces tests verrouillent les deux regles qui empechent ce faux : la detection de troncature
 * et le refus de toute distance non demontree par l'emprise couverte.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  distanceDemontree,
  estHabitation,
  reponseTronquee,
} from '../src/connecteurs/wfs.js';

const vide = { features: [] as never[] };
const avec = (n: number) => ({ features: Array.from({ length: n }, () => ({}) as never) });

// --- Detection de troncature -----------------------------------------------

test('numberMatched superieur au nombre renvoye signale une troncature', () => {
  assert.equal(reponseTronquee({ ...avec(3000), numberReturned: 3000, numberMatched: 15892 }, 5000), true);
});

test('numberMatched egal au nombre renvoye : reponse complete', () => {
  assert.equal(reponseTronquee({ ...avec(265), numberReturned: 265, numberMatched: 265 }, 5000), false);
});

test('une reponse complete au plafond exact reste complete si le total le confirme', () => {
  // Cas piegeux : 5000 objets renvoyes ET 5000 annonces. Se fier au seul remplissage du
  // plafond conduirait a rejeter une reponse pourtant exhaustive.
  assert.equal(reponseTronquee({ ...avec(5000), numberReturned: 5000, numberMatched: 5000 }, 5000), false);
});

test('totalFeatures sert de repli quand numberMatched est absent', () => {
  assert.equal(reponseTronquee({ ...avec(500), totalFeatures: 1200 }, 5000), true);
  assert.equal(reponseTronquee({ ...avec(500), totalFeatures: 500 }, 5000), false);
});

test('numberReturned absent : le decompte des features fait foi', () => {
  assert.equal(reponseTronquee({ ...avec(120), numberMatched: 2766 }, 2000), true);
  assert.equal(reponseTronquee({ ...avec(120), numberMatched: 120 }, 2000), false);
});

test('sans total annonce, une reponse pleine au plafond est presumee tronquee', () => {
  // Faute d'information, la prudence impose le faux positif plutot que le faux negatif.
  assert.equal(reponseTronquee(avec(2000), 2000), true);
  assert.equal(reponseTronquee(avec(1999), 2000), false);
});

test('une reponse vide n’est jamais tronquee', () => {
  assert.equal(reponseTronquee(vide, 5000), false);
  assert.equal(reponseTronquee({ ...vide, numberReturned: 0, numberMatched: 0 }, 5000), false);
});

test('un total incoherent (inferieur au renvoye) ne declenche pas de troncature', () => {
  assert.equal(reponseTronquee({ ...avec(10), numberReturned: 10, numberMatched: 4 }, 5000), false);
});

// --- Distance demontree ----------------------------------------------------

test('une distance inferieure au rayon couvert est conservee', () => {
  assert.equal(distanceDemontree(373, 1500), 373);
  assert.equal(distanceDemontree(17, 500), 17);
});

test('une distance nulle est conservee, et non confondue avec une absence', () => {
  // Regression : un test de verite (`if (d)`) au lieu d'un test de nullite ferait disparaitre
  // le cas le plus grave — une habitation sur la parcelle meme.
  assert.equal(distanceDemontree(0, 500), 0);
});

test('le rayon couvert est inclusif', () => {
  assert.equal(distanceDemontree(500, 500), 500);
});

test('une distance superieure au rayon couvert est rejetee', () => {
  // 1670 m trouves dans un coin de bbox alors que seuls 500 m sont couverts : rien ne prouve
  // qu'aucun objet plus proche n'existe hors emprise.
  assert.equal(distanceDemontree(1670, 500), null);
  assert.equal(distanceDemontree(1600, 1500), null);
});

test('une absence de mesure reste une absence', () => {
  assert.equal(distanceDemontree(null, 1500), null);
});

// --- Qualification des habitations ----------------------------------------

test('un usage declare habitation ou residentiel compte comme habitation', () => {
  assert.equal(estHabitation({ usage_1: 'Habitation' }), true);
  assert.equal(estHabitation({ usage_1: 'Annexe', usage_2: 'Résidentiel' }), true);
  assert.equal(estHabitation({ usage_1: 'Residentiel' }), true);
});

test('un batiment declarant des logements compte comme habitation malgre sa nature', () => {
  assert.equal(estHabitation({ nature: 'Bâtiment agricole', nombre_de_logements: 2 }), true);
});

test('les batiments agricoles, industriels et les serres ne sont pas des habitations', () => {
  assert.equal(estHabitation({ nature: 'Bâtiment agricole' }), false);
  assert.equal(estHabitation({ nature: 'Bâtiment industriel' }), false);
  assert.equal(estHabitation({ nature: 'Serre' }), false);
});

test('un usage renseigne mais non residentiel exclut l’habitation', () => {
  assert.equal(estHabitation({ usage_1: 'Industriel' }), false);
  assert.equal(estHabitation({ usage_1: 'Commercial et services' }), false);
});

test('un batiment sans usage ni nature est compte comme habitation par prudence', () => {
  // Choix deliberement pessimiste : mieux vaut un eloignement sous-estime qu'un knock-out
  // reglementaire manque.
  //
  // AUTOCRITIQUE. Ce test existait des l'audit 5 et il passait — mais il couvrait un cas qui se
  // produit 0,0 % du temps : BD TOPO n'ecrit jamais un usage vide, elle ecrit « Indifferencie ».
  // Il validait donc l'intention du commentaire, pas le comportement sur la donnee reelle. Les
  // tests qui suivent sont ecrits depuis la distribution mesuree, et non depuis le commentaire.
  assert.equal(estHabitation({}), true);
  assert.equal(estHabitation({ usage_1: null, usage_2: null, nature: null }), true);
});

/**
 * Correction (audit 6, B2). Distribution mesuree sur 5000 batiments reels de BD TOPO (Aveyron) :
 *
 *   usage_1 = "Residentiel"          55,8 %   -> habitation
 *   usage_1 = "Indifferencie"        33,9 %   -> ETAIT EXCLU, doit etre habitation
 *   autre usage explicite            10,3 %   -> exclu, a juste titre
 *   usage_1 ET usage_2 vides          0,0 %   -> le seul cas que couvrait la regle d'origine
 *
 * Le sens de l'erreur commande la regle : sous-compter les habitations SURESTIME la distance a
 * l'habitation la plus proche, donc ameliore la note et peut empecher le recul de 500 m de
 * l'article L.515-44 de se declencher. Sur-compter ne degrade qu'une note.
 */
test('« Indifferencie » est traite comme indetermine, donc comme habitation', () => {
  assert.equal(estHabitation({ usage_1: 'Indifférencié', nature: 'Indifférenciée' }), true);
  assert.equal(estHabitation({ usage_1: 'Indifferencie', nature: 'Indifferenciee' }), true);
  // Combinaison la plus frequente apres le residentiel : 1291 batiments sur 5400 echantillonnes.
  assert.equal(
    estHabitation({ usage_1: 'Indifférencié', nature: 'Indifférenciée', nombre_de_logements: null }),
    true,
  );
});

test('un usage explicitement non residentiel exclut, meme sur nature indifferenciee', () => {
  // Ces quatre cas representent les 10,3 % correctement exclus : la correction ne doit pas les
  // requalifier en habitations, sans quoi toute parcelle en zone d'activite aurait une habitation
  // mitoyenne.
  for (const usage of ['Annexe', 'Commercial et services', 'Industriel', 'Agricole']) {
    assert.equal(
      estHabitation({ usage_1: usage, nature: 'Indifférenciée' }),
      false,
      `${usage} ne doit pas compter comme habitation`,
    );
  }
});

test('un usage indetermine mais une nature agricole ou industrielle exclut', () => {
  assert.equal(estHabitation({ usage_1: 'Indifférencié', nature: 'Bâtiment agricole' }), false);
  assert.equal(estHabitation({ usage_1: 'Indifférencié', nature: 'Bâtiment industriel' }), false);
  assert.equal(estHabitation({ usage_1: 'Indifférencié', nature: 'Serre' }), false);
});

test('des logements declares emportent la decision sur tout le reste', () => {
  // `nombre_de_logements > 0` est un fait, pas une presomption : il prime sur la nature.
  assert.equal(estHabitation({ usage_1: 'Indifférencié', nombre_de_logements: 3 }), true);
  assert.equal(estHabitation({ nature: 'Bâtiment agricole', nombre_de_logements: 2 }), true);
});

test('un usage secondaire residentiel suffit', () => {
  assert.equal(estHabitation({ usage_1: 'Commercial et services', usage_2: 'Résidentiel' }), true);
});

// --- Invariant structurel -------------------------------------------------

test('aucun appel a getFeature n’ignore l’indicateur de troncature', () => {
  // Le piege est d’ecrire `const { fc } = await getFeature(...)` : le code compile, les tests
  // metier passent, et la garde disparait en silence. On verifie donc que chaque appel soit
  // deconstruit avec `tronquee`, soit renvoie la reponse entiere — auquel cas le type impose
  // a l’appelant de traiter le cas.
  const source = readFileSync(new URL('../src/connecteurs/wfs.ts', import.meta.url), 'utf8');
  const appels = [...source.matchAll(/(.{0,80})await getFeature</g)];
  assert.ok(appels.length >= 5, `attendu au moins 5 appels, trouve ${appels.length}`);
  for (const [, avant] of appels) {
    const contexte = avant ?? '';
    const propage = /return\s*$/.test(contexte.trim()) || contexte.includes('tronquee');
    assert.ok(propage, `appel a getFeature sans prise en compte de la troncature : «${contexte.trim()}»`);
  }
});
