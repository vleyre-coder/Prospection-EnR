/**
 * Tests des exports : CSV, GeoJSON et rapport PDF.
 *
 * POURQUOI CE FICHIER EXISTE. Trois audits successifs ont trouve quatre regressions, et
 * chaque fois hors du moteur de scoring - le seul composant qui etait teste. Deux d'entre
 * elles etaient dans ces exports : un statut « Score faible » sur une parcelle
 * reglementairement ecartee, et un « aucune declaration » agricole affirme a partir d'une
 * absence de donnee. Ces deux erreurs sortent de l'application par un fichier remis a un
 * tiers ; ce sont donc les plus couteuses, et les moins visibles a la relecture.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot, type ResultatScore } from '@enr/core';
import {
  csvResultats,
  ficheParcellePdf,
  geojsonParcelles,
  libelleRpg,
} from '../src/services/exports.js';
import type { LigneResultatFiltre } from '../src/services/recherche.js';
import type { ParcelleEnBase } from '../src/depots/parcelles.js';

// ---------------------------------------------------------------------------
// Fixtures minimales
// ---------------------------------------------------------------------------

function ligne(sur: Partial<LigneResultatFiltre> = {}): LigneResultatFiltre {
  return {
    idu: '01001000AA0001',
    nomCommune: 'Villeneuve',
    section: 'AA',
    numero: '0001',
    surfaceHa: 12.5,
    statutScore: 'vert',
    scoreGlobal: 78.4,
    nbKnockOutsBloquants: 0,
    statutProspection: null,
    distancePosteKm: 4.2,
    pentePct: 3.1,
    typeSol: 'terre_arable',
    centroide: [5.2231, 46.2044],
    ...sur,
  };
}

/**
 * Snapshot vide.
 *
 * Produit par le MEME constructeur que la production (`snapshotVide` de @enr/core) plutot
 * que recopie a la main : une fixture recopiee derive du type des qu'un champ change, et
 * le test devient alors vert sur une structure que la production ne produit plus.
 */
function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '01001000AA0001',
      codeInsee: '01001',
      nomCommune: 'Villeneuve',
      section: 'AA',
      numero: '0001',
      contenanceM2: 125000,
      surfaceCalculeeM2: 124800,
      centroide: [5.2231, 46.2044],
      codeDepartement: '01',
    },
    '2026-08-04T09:00:00.000Z',
  );
}

/**
 * Score vide. Type sans cast a dessein : un `as unknown as ResultatScore` laisserait
 * passer une fixture qui ne ressemble plus au type reel, et le test cesserait alors de
 * tester la production tout en restant vert.
 */
function scoreVide(): ResultatScore {
  return {
    idu: '01001000AA0001',
    filiere: 'solaire_sol',
    statut: 'gris',
    scoreGlobal: null,
    knockOuts: [],
    limitesViabilite: [],
    criteres: [],
    pointsForts: [],
    pointsVigilance: [],
    seuilsProcedure: [],
    couvertureDonnees: 0,
    regimeImplantation: null,
    ponderationsAppliquees: {},
    versionMoteur: 'test',
    dateCalcul: '2026-08-04T09:00:00.000Z',
    avertissements: [],
  };
}

const parcelle: ParcelleEnBase = {
  idu: '01001000AA0001',
  codeInsee: '01001',
  nomCommune: 'Villeneuve',
  section: 'AA',
  numero: '0001',
  contenanceM2: 125000,
  surfaceCalculeeM2: 124800,
  codeDepartement: '01',
  geometrie: { type: 'Polygon', coordinates: [[[5.22, 46.2], [5.23, 46.2], [5.23, 46.21], [5.22, 46.21], [5.22, 46.2]]] },
} as unknown as ParcelleEnBase;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test("le CSV distingue une parcelle ecartee d'une parcelle mal notee", () => {
  const csv = csvResultats([
    ligne({ statutScore: 'rouge', scoreGlobal: 31, nbKnockOutsBloquants: 0 }),
    ligne({ idu: '01001000AA0002', statutScore: 'rouge', scoreGlobal: 28, nbKnockOutsBloquants: 2 }),
  ]);
  const lignes = csv.trimEnd().split('\n');
  const entetes = lignes[0]!.split(';');
  const iEcartee = entetes.indexOf('Ecartee reglementairement');

  assert.ok(iEcartee > 0, 'la colonne doit exister');
  // Meme statut, meme ordre de grandeur de score : sans cette colonne les deux lignes
  // sont indiscernables, et rien ne dit que la seconde est juridiquement exclue.
  assert.equal(lignes[1]!.split(';')[iEcartee], 'non');
  assert.equal(lignes[2]!.split(';')[iEcartee], 'oui');
});

test('le CSV echappe les separateurs et les guillemets', () => {
  const csv = csvResultats([ligne({ nomCommune: 'Saint-Jean; dit "le Haut"' })]);
  const ligneDonnee = csv.trimEnd().split('\n')[1]!;
  assert.ok(ligneDonnee.includes('"Saint-Jean; dit ""le Haut"""'));
  // Le champ echappe ne doit pas augmenter le nombre de colonnes. Compte relatif aux
  // en-tetes et non a un nombre fige : ajouter une colonne est legitime, en decaler une
  // ne l'est pas.
  const champs = (l: string): number => l.match(/(^|;)("([^"]|"")*"|[^;]*)/g)?.length ?? 0;
  assert.equal(champs(ligneDonnee), champs(csv.trimEnd().split('\n')[0]!));
});

test('le CSV utilise la virgule decimale, lisible par Excel francais', () => {
  const csv = csvResultats([ligne({ surfaceHa: 12.5, scoreGlobal: 78.4 })]);
  assert.ok(csv.includes(';12,5;'));
  assert.ok(csv.includes(';78,4;'));
});

test('le CSV commence par une BOM UTF-8', () => {
  // Sans BOM, Excel lit les accents en Latin-1 et « Ecartee » devient illisible.
  assert.equal(csvResultats([ligne()]).charCodeAt(0), 0xfeff);
});

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

test('le GeoJSON porte le compteur de knock-outs bloquants', () => {
  const fc = geojsonParcelles([
    {
      parcelle,
      score: {
        ...scoreVide(),
        knockOuts: [
          { id: 'a', libelle: 'A', motif: 'm', famille: 'urbanisme', regleLiee: null, source: null, derogeable: false },
          { id: 'b', libelle: 'B', motif: 'm', famille: 'urbanisme', regleLiee: null, source: null, derogeable: true },
        ],
      },
    },
  ]) as { features: Array<{ properties: Record<string, unknown> }> };

  const p = fc.features[0]!.properties;
  assert.equal(p['nb_knock_outs'], 2, 'total, derogeables inclus');
  assert.equal(p['nb_ko_bloquants'], 1, 'seuls les non derogeables');
});

test("le GeoJSON porte l'avertissement sur la valeur juridique des contours", () => {
  const fc = geojsonParcelles([{ parcelle, score: null }]) as {
    metadata: { avertissement: string };
  };
  assert.match(fc.metadata.avertissement, /sans valeur juridique/i);
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Concatene le flux PDF pour pouvoir en inspecter le contenu. */
async function pdf(snapshot: ParcelleSnapshot, score = scoreVide()): Promise<Buffer> {
  const flux = ficheParcellePdf(parcelle, snapshot, score);
  const morceaux: Buffer[] = [];
  for await (const m of flux) morceaux.push(Buffer.from(m as Buffer));
  return Buffer.concat(morceaux);
}

test('le rapport se genere sur un snapshot entierement vide', async () => {
  const buf = await pdf(snapshot());
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.subarray(-1024).toString('latin1').includes('%%EOF'));
});

test("« aucune declaration » n'est ecrit que si le RPG a effectivement repondu", () => {
  const base = snapshot().occupationSol.rpg;

  // RPG injoignable : aucune affirmation possible sur l'usage agricole.
  assert.equal(libelleRpg({ ...base, anneesDeclareesConsecutives: null }), 'non renseigne (RPG non consulte)');

  // RPG joignable, aucun ilot recouvrant : l'absence de declaration est un CONSTAT, et
  // c'est meme un argument favorable en solaire au sol. Elle doit donc etre affirmee.
  assert.equal(libelleRpg({ ...base, anneesDeclareesConsecutives: 0 }), 'aucune declaration PAC');

  // Declaration presente : le libelle de culture primait deja.
  assert.equal(
    libelleRpg({ ...base, libelleCulture: 'Ble tendre d\'hiver', anneesDeclareesConsecutives: 5 }),
    'Ble tendre d\'hiver',
  );
});

test('le rapport pagine et numerote', async () => {
  const buf = await pdf(snapshot());
  // /Count n indique le nombre de pages de l'arbre de pages.
  const m = /\/Count (\d+)/.exec(buf.toString('latin1'));
  assert.ok(m, 'le catalogue doit declarer un nombre de pages');
  assert.ok(Number(m![1]) >= 1);
});
