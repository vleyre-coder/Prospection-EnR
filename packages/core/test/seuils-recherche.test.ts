/**
 * Tests de la table des seuils de recherche.
 *
 * POURQUOI ELLE EXISTE. La recherche par criteres n'exposait qu'une poignee des 43 criteres
 * evalues, et le CRITERE ROI de trois filieres sur quatre etait introuvable : l'irradiation en
 * solaire, la vitesse de vent en eolien, le tonnage d'intrants en methanisation. Un outil de
 * recherche qui ne sait pas chercher par le critere roi de sa filiere ne cherche pas.
 *
 * CE QUE CES TESTS PROTEGENT. Le mecanisme est generique — un chemin, un sens, une valeur — et sa
 * liste blanche est `BORNES_SNAPSHOT`. Un chemin qui n'y figure pas ne provoque AUCUNE erreur : il
 * rend `NULL` dans le JSONB, donc la condition est fausse, donc la recherche ne retient rien. Le
 * critere serait annonce dans le formulaire ET dans le cahier des charges remis au developpeur, et
 * ne retiendrait jamais une parcelle. C'est la faute la plus couteuse que cette table puisse
 * porter, et c'est celle que le premier test attrape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BORNES_SNAPSHOT } from '../src/bornes.js';
import { FILIERES, FILIERES_META } from '../src/filieres.js';
import { SEUILS_RECHERCHE, cheminsDesSeuils, seuilDe } from '../src/seuils-recherche.js';

test('CHAQUE SEUIL POINTE UNE GRANDEUR REELLEMENT DECLAREE', () => {
  /*
   * LE TEST CENTRAL. `gisement.iradiationKwhM2An`, avec une lettre en moins, viderait la liste en
   * silence : `#>>` sur une cle absente rend `NULL`, la condition devient fausse, et l'operateur
   * conclurait qu'aucune parcelle n'atteint le seuil demande.
   */
  const connus = new Set(BORNES_SNAPSHOT.map((b) => b.chemin));
  for (const filiere of FILIERES) {
    for (const s of SEUILS_RECHERCHE[filiere]) {
      assert.ok(
        connus.has(s.chemin),
        `${filiere} : « ${s.chemin} » n'est pas declare dans BORNES_SNAPSHOT — ce seuil ne ` +
          'retiendrait jamais aucune parcelle.',
      );
    }
  }
});

test('LA VALEUR USUELLE TIENT DANS LES BORNES PHYSIQUES DE SA GRANDEUR', () => {
  /*
   * L'usuel pre-remplit le cahier des charges et sert de suggestion dans le formulaire. Hors
   * bornes, il serait REFUSE par la validation de l'API au moment ou l'operateur le recopie : le
   * document proposerait une valeur que le logiciel n'accepte pas.
   */
  for (const filiere of FILIERES) {
    for (const s of SEUILS_RECHERCHE[filiere]) {
      const b = BORNES_SNAPSHOT.find((x) => x.chemin === s.chemin)!;
      assert.ok(
        s.usuel >= b.min && s.usuel <= b.max,
        `${filiere}/${s.chemin} : usuel ${s.usuel} hors de [${b.min}, ${b.max}] ${b.unite}`,
      );
    }
  }
});

test('L’UNITE ANNONCEE EST CELLE DE LA GRANDEUR', () => {
  /*
   * Deux tables, une seule verite. L'unite affichee vient de `SEUILS_RECHERCHE` — elle est ecrite
   * pour etre lue (« kWh/m²/an ») — et la borne physique porte la sienne, plus technique
   * (« kWh/m2/an »). Elles doivent decrire la MEME grandeur : comparer les chiffres et les lettres
   * en ignorant accents et exposants suffit a attraper un « km » pose sur des metres, qui ferait
   * saisir une valeur mille fois trop grande.
   */
  const reduire = (u: string): string =>
    u
      // La precision entre parentheses n'est qu'une aide de lecture : « part (0 a 1) » et « part »
      // designent la meme grandeur.
      .replace(/\([^)]*\)/g, '')
      .replace(/€/g, 'EUR')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[²³]/g, (c) => (c === '²' ? '2' : '3'))
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
  for (const filiere of FILIERES) {
    for (const s of SEUILS_RECHERCHE[filiere]) {
      const b = BORNES_SNAPSHOT.find((x) => x.chemin === s.chemin)!;
      /*
       * EGALITE EXACTE, et il a fallu une mutation pour l'imposer. Ma premiere version acceptait
       * qu'une unite en CONTIENNE l'autre : « km » contient « m », donc annoncer des kilometres
       * sur une grandeur exprimee en metres passait le test. Le cahier des charges aurait imprime
       * « Distance a la voirie au plus 500 km » chez le developpeur, et l'operateur aurait saisi
       * une valeur mille fois trop grande — sans qu'aucun controle ne la refuse, puisqu'elle reste
       * dans les bornes physiques de la grandeur.
       */
      assert.equal(
        reduire(s.unite),
        reduire(b.unite),
        `${filiere}/${s.chemin} : unite « ${s.unite} » contre « ${b.unite} » dans les bornes`,
      );
    }
  }
});

test('CHAQUE FILIERE PROPOSE DES SEUILS, ET LE PREMIER EST SON CRITERE ROI', () => {
  /*
   * L'ORDRE N'EST PAS COSMETIQUE : il decide de ce que l'operateur regle en premier, et le premier
   * seuil est celui qui elimine le plus. Le lien avec `critereRoi` est verifie par un mot-cle
   * plutot que par une egalite : `critereRoi` est une phrase destinee a l'affichage, pas un
   * identifiant, et l'y contraindre rendrait les deux tables impossibles a faire evoluer.
   */
  const ROI: Record<string, string> = {
    solaire_sol: 'irradiation',
    eolien_terrestre: 'vent',
    bess: 'capacite',
    methanisation: 'intrants',
  };
  for (const filiere of FILIERES) {
    const liste = SEUILS_RECHERCHE[filiere];
    assert.ok(liste.length >= 5, `${filiere} : ${liste.length} seuils, c'est trop peu pour chercher`);
    const premier = liste[0]!;
    const attendu = ROI[filiere]!;
    assert.ok(
      premier.chemin.toLowerCase().includes(attendu) ||
        premier.libelle
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .includes(attendu),
      `${filiere} : le premier seuil est « ${premier.libelle} » (${premier.chemin}), alors que le ` +
        `critere roi annonce est « ${FILIERES_META[filiere].critereRoi} »`,
    );
  }
});

test('AUCUN SEUIL EN DOUBLE DANS UNE FILIERE', () => {
  // Deux seuils sur la meme grandeur se cumuleraient en SQL, et le second passerait pour ignore.
  for (const filiere of FILIERES) {
    const chemins = SEUILS_RECHERCHE[filiere].map((s) => s.chemin);
    assert.equal(new Set(chemins).size, chemins.length, `${filiere} : grandeur en double`);
  }
});

test('CHAQUE SEUIL DIT CE QU’IL DECIDE POUR LE PROJET', () => {
  /*
   * L'aide n'est pas decorative : elle est reprise telle quelle dans le cahier des charges Word
   * remis au developpeur, sous « Ce que chaque seuil decide ». Une aide absente ou tronquee
   * laisserait une ligne du document sans justification, et un seuil qu'on ne sait pas justifier
   * est un seuil qu'on regle au hasard.
   */
  for (const filiere of FILIERES) {
    for (const s of SEUILS_RECHERCHE[filiere]) {
      assert.ok(s.libelle.trim().length > 8, `${filiere}/${s.chemin} : libelle trop court`);
      assert.ok(
        s.aide.length > 50,
        `${filiere}/${s.chemin} : aide trop courte pour informer — « ${s.aide} »`,
      );
      assert.ok(s.unite.trim().length > 0, `${filiere}/${s.chemin} : unite manquante`);
      assert.ok(s.sens === 'min' || s.sens === 'max', `${filiere}/${s.chemin} : sens invalide`);
    }
  }
});

test('LES ACCESSEURS RENDENT CE QU’ILS ANNONCENT', () => {
  const chemins = cheminsDesSeuils();
  assert.equal(new Set(chemins).size, chemins.length, 'les chemins doivent etre dedoublonnes');
  for (const filiere of FILIERES) {
    for (const s of SEUILS_RECHERCHE[filiere]) {
      assert.ok(chemins.includes(s.chemin));
      assert.equal(seuilDe(filiere, s.chemin)?.libelle, s.libelle);
    }
  }
  // Un chemin inconnu rend `null`, et surtout pas le premier seuil de la liste : un repli
  // silencieux ferait afficher le mauvais libelle a cote de la bonne valeur.
  assert.equal(seuilDe('solaire_sol', 'grandeur.inexistante'), null);
});

test('LE SENS DU SEUIL EST CELUI QUE LE METIER ATTEND', () => {
  /*
   * UN SENS INVERSE EST LE DEFAUT LE PLUS COUTEUX DE CETTE TABLE, et le plus difficile a voir : le
   * formulaire afficherait « Distance a l'habitation au plus 500 m » et retiendrait exactement le
   * foncier que la loi interdit. Les quatre temoins sont ceux ou l'erreur serait la plus grave.
   */
  assert.equal(seuilDe('eolien_terrestre', 'bati.distanceHabitationM')?.sens, 'min');
  assert.equal(seuilDe('solaire_sol', 'gisement.irradiationKwhM2An')?.sens, 'min');
  assert.equal(seuilDe('solaire_sol', 'foncier.nbProprietairesEstime')?.sens, 'max');
  assert.equal(seuilDe('methanisation', 'raccordement.reseauGaz.distanceCanalisationKm')?.sens, 'max');
  // Et le recul eolien reste au minimum legal de l'article L.515-44.
  assert.equal(seuilDe('eolien_terrestre', 'bati.distanceHabitationM')?.usuel, 500);
});
