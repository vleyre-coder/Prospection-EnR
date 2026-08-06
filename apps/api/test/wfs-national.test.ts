/**
 * Traduction des vocabulaires codes des couches nationales.
 *
 * POURQUOI CE FICHIER EXISTE. Les audits 5 a 8 ont trouve la meme faute quatre fois : une valeur
 * codee traduite d'apres ce qu'on supposait qu'elle voulait dire, au lieu de ce qu'elle vaut
 * reellement dans les donnees. `libPpr` lu sous le nom `libelle_risque_long`, `sitename` lu sous le
 * nom `nom_site`, `du_type` lu sous le nom `typedoc`. Le code etait juste chaque fois ; la
 * traduction etait fausse.
 *
 * Les deux ingestions couvertes ici introduisent deux nouvelles traductions, donc deux nouvelles
 * occasions de refaire la faute. Les valeurs de reference ci-dessous ne sont pas inventees : elles
 * sont MESUREES sur les donnees reelles, en amont de l'ecriture du code.
 *
 *   `zaer:zaer`, 600 objets echantillonnes
 *     filiere         : SOLAIRE_PV 430, BIOMASSE 89, SOLAIRE_THERMIQUE 25, GEOTHERMIE 24,
 *                       EOLIEN 21, BIOMETHANE 5, HYDROELECTRICITE 5, vide 1
 *     detail_filiere1 : TOIT 293, vide 158, SOL 80, OMBRIERE 38, SURFACE 17, AUTRE 7,
 *                       METHANE_COGE 2, INJECTION 2, PROFONDE 2, NULL 1
 *
 *   `STE_Metropole`, 400 objets echantillonnes
 *     typesite        : Site inscrit 256, Site classe 136, Patrimoine mondial 4,
 *                       Grand Site de France 3, Projet Grand Site de France 1
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateFrancaiseEnIso,
  filieresZaer,
  FILIERES_SANS_ZAER,
  typeSite,
} from '../src/ingestion/wfs-national.js';

// ---------------------------------------------------------------------------
// ZAER
// ---------------------------------------------------------------------------

test('une ZAER photovoltaique EN TOITURE ne concerne pas la prospection fonciere', () => {
  /**
   * LE PIEGE PRINCIPAL de cette couche, et il est majoritaire : 293 des 430 ZAER photovoltaiques
   * echantillonnees portent sur des toitures. Traduire `SOLAIRE_PV` en `solaire_sol` sans lire
   * `detail_filiere1` ferait dire a l'application « cette parcelle est en zone d'acceleration pour le
   * solaire au sol » a propos de la toiture d'une maison de quartier — un argument reglementaire
   * inexistant, affiche comme un fait.
   */
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'TOIT'), []);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'OMBRIERE'), [], 'un ombrage de parking n’est pas du foncier');
  assert.deepEqual(filieresZaer('SOLAIRE_PV', ''), [], 'detail absent : on ne suppose pas le sol');
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'NULL'), [], 'la chaine « NULL » est un detail absent');
});

test('une ZAER photovoltaique AU SOL concerne bien la filiere solaire au sol', () => {
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'SOL'), ['solaire_sol']);
  assert.deepEqual(filieresZaer('SOLAIRE_PV', 'SURFACE'), ['solaire_sol']);
  // La casse et les espaces de la source ne doivent pas suffire a perdre une zone.
  assert.deepEqual(filieresZaer('solaire_pv', ' sol '), ['solaire_sol']);
});

test('les autres filieres du perimetre sont traduites', () => {
  assert.deepEqual(filieresZaer('EOLIEN', ''), ['eolien_terrestre']);
  assert.deepEqual(filieresZaer('BIOMETHANE', 'INJECTION'), ['methanisation']);
});

test('BIOMASSE n’est de la methanisation que si son detail l’est', () => {
  // `BIOMASSE` couvre surtout les chaufferies bois. Les ranger en methanisation ferait ressortir des
  // zones sans rapport avec une unite de digestion.
  assert.deepEqual(filieresZaer('BIOMASSE', ''), []);
  assert.deepEqual(filieresZaer('BIOMASSE', 'AUTRE'), []);
  assert.deepEqual(filieresZaer('BIOMASSE', 'METHANE_COGE'), ['methanisation']);
  assert.deepEqual(filieresZaer('BIOMASSE', 'INJECTION'), ['methanisation']);
});

test('les filieres hors perimetre sont ecartees sciemment, non par defaut', () => {
  for (const f of ['SOLAIRE_THERMIQUE', 'GEOTHERMIE', 'HYDROELECTRICITE']) {
    assert.deepEqual(filieresZaer(f, ''), [], f);
  }
});

test('un vocabulaire inconnu ou vide n’est jamais range par defaut', () => {
  // La regle qui rend impossible la classe de defaut des audits 5 a 8 : en cas de doute, rien.
  for (const f of ['', '   ', 'FILIERE_INVENTEE', 'SOLAIRE', 'PV']) {
    assert.deepEqual(filieresZaer(f, 'SOL'), [], JSON.stringify(f));
  }
  assert.deepEqual(filieresZaer(null, null), []);
  assert.deepEqual(filieresZaer(undefined, undefined), []);
});

test('le stockage n’est couvert par aucune ZAER, et c’est documente', () => {
  /**
   * La loi APER porte sur les zones d'acceleration de la PRODUCTION d'energies renouvelables. Une
   * batterie n'est pas un moyen de production : aucune ZAER ne la vise. Le critere `urb_zaer` de la
   * filiere `bess` ne pourra donc jamais etre renseigne par cette source, quelle que soit la qualite
   * de l'ingestion — ce n'est pas un defaut, et il faut que ce soit ecrit quelque part de verifiable.
   */
  assert.ok(FILIERES_SANS_ZAER.includes('bess'));
  // Aucune valeur de la source ne doit produire `bess`.
  const valeurs = [
    'SOLAIRE_PV', 'EOLIEN', 'BIOMASSE', 'BIOMETHANE', 'SOLAIRE_THERMIQUE', 'GEOTHERMIE',
    'HYDROELECTRICITE', '',
  ];
  const details = ['TOIT', 'SOL', 'OMBRIERE', 'SURFACE', 'AUTRE', 'METHANE_COGE', 'INJECTION', 'PROFONDE', ''];
  for (const f of valeurs) {
    for (const d of details) {
      assert.ok(
        !filieresZaer(f, d).includes('bess'),
        `aucune ZAER ne doit produire la filiere bess (${f} / ${d})`,
      );
    }
  }
});

test('toutes les valeurs mesurees de la source sont traitees sans exception', () => {
  // Verification de couverture : le classifieur ne doit lever aucune erreur sur le vocabulaire reel,
  // y compris sur les valeurs qu'il ecarte.
  const mesurees: Array<[string, string]> = [
    ['SOLAIRE_PV', 'TOIT'], ['SOLAIRE_PV', ''], ['SOLAIRE_PV', 'SOL'], ['SOLAIRE_PV', 'OMBRIERE'],
    ['SOLAIRE_PV', 'SURFACE'], ['BIOMASSE', 'AUTRE'], ['BIOMASSE', 'METHANE_COGE'],
    ['SOLAIRE_THERMIQUE', ''], ['GEOTHERMIE', 'PROFONDE'], ['EOLIEN', ''],
    ['BIOMETHANE', 'INJECTION'], ['HYDROELECTRICITE', ''], ['', ''], ['SOLAIRE_PV', 'NULL'],
  ];
  for (const [f, d] of mesurees) {
    const r = filieresZaer(f, d);
    assert.ok(Array.isArray(r), `${f} / ${d}`);
    // Une zone ne peut viser qu'une filiere de l'application au plus, par construction de la source.
    assert.ok(r.length <= 1, `${f} / ${d} ne doit pas produire plusieurs filieres`);
  }
});

// ---------------------------------------------------------------------------
// Sites proteges
// ---------------------------------------------------------------------------

test('seuls les sites classes et inscrits sont des sites proteges', () => {
  assert.equal(typeSite('Site classé'), 'site_classe');
  assert.equal(typeSite('Site inscrit'), 'site_inscrit');
});

test('les labels ne sont PAS des sites proteges', () => {
  /**
   * L'erreur symetrique, et tout aussi grave. « Grand Site de France » est un label attribue a des
   * ensembles deja classes ; « Patrimoine mondial » releve de l'UNESCO. Ni l'un ni l'autre n'a de
   * portee reglementaire propre au sens des articles L. 341-1 et L. 341-10 du code de
   * l'environnement. Les ranger en `site_classe` declencherait un knock-out eolien NON DEROGEABLE sur
   * un label — l'application ecarterait des parcelles parfaitement implantables.
   */
  assert.equal(typeSite('Patrimoine mondial'), null);
  assert.equal(typeSite('Grand Site de France'), null);
  assert.equal(typeSite('Projet Grand Site de France'), null);
});

test('l’accentuation et la casse de la source ne font pas perdre un site', () => {
  // « Site classé » est accentue dans la source. Comparer sans normaliser ferait ecarter la totalite
  // des sites classes au moindre changement d'encodage — en silence, et avec un feu vert a la cle.
  assert.equal(typeSite('site classe'), 'site_classe');
  assert.equal(typeSite('SITE CLASSÉ'), 'site_classe');
  assert.equal(typeSite('  Site Inscrit  '), 'site_inscrit');
});

test('une valeur inconnue n’est pas rangee par defaut', () => {
  for (const v of ['', '   ', 'Site remarquable', 'ZPPAUP', 'SPR', null, undefined]) {
    assert.equal(typeSite(v), null, JSON.stringify(v));
  }
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('une date francaise est convertie sans ambiguite de calendrier', () => {
  /**
   * `datecrea` vaut `10/12/1975` dans la source. Passee telle quelle a PostgreSQL, elle depend du
   * `DateStyle` du serveur : le 10 decembre en francais, le 12 octobre en anglais. Une date de
   * classement fausse de deux mois est sans consequence pratique — mais une date qui change selon la
   * configuration du serveur est un defaut de reproductibilite, et le meme piege sur une date
   * d'arrete de PPR en aurait une.
   */
  assert.equal(dateFrancaiseEnIso('10/12/1975'), '1975-12-10');
  assert.equal(dateFrancaiseEnIso('01/01/2024'), '2024-01-01');
  assert.equal(dateFrancaiseEnIso(' 28/02/1930 '), '1930-02-28');
});

test('une date absente ou d’un autre format vaut null, jamais une date inventee', () => {
  for (const v of ['', '1975-12-10', '10/12/75', 'inconnue', null, undefined, 42, {}]) {
    assert.equal(dateFrancaiseEnIso(v), null, JSON.stringify(v));
  }
});
