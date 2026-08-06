/**
 * L'application ne doit rien AFFIRMER qu'elle ne sache pas.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 8 a trouve huit defauts qui forment une seule famille :
 * affirmer en l'absence de donnee. Aucun n'etait un defaut de calcul — le code lisait proprement une
 * table que rien ne remplissait, ou appliquait correctement une logique booleenne fausse. Aucun test
 * ecrit d'apres le code ne pouvait les voir, et sept audits les ont manques.
 *
 * Les cas rassembles ici sont donc ecrits d'apres la QUESTION, jamais d'apres l'implementation :
 * « que doit repondre l'application quand elle ne sait pas ? ». La reponse est toujours la meme :
 * `null`, jamais `false`, jamais `0`, jamais une note.
 *
 * Chaque test porte la reference du defaut de l'audit 8 qu'il verrouille, et plusieurs sont
 * verifies par mutation dans `scripts/mutation.mjs` : un test qui passe sans rien proteger est une
 * regression a part entiere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identiteDepuisIdu, snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore, sourceEnEchec } from '@enr/scoring';
import { contexteFoncier } from '../src/connecteurs/cadastre.js';
import { aleaInondation, famillesRisque, presenceFamille } from '../src/connecteurs/georisques.js';

function snapshot(): ParcelleSnapshot {
  const s = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  s.identite.centroide = [1.75, 48.15];
  s.identite.contenanceM2 = 120000;
  s.identite.surfaceCalculeeM2 = 120000;
  return s;
}

function critere(s: ParcelleSnapshot, id: string, filiere = 'solaire_sol' as const, options = {}) {
  const r = calculerScore(s, filiere, options);
  const c = r.criteres.find((c) => c.id === id);
  assert.ok(c, `le critere ${id} doit etre evalue pour la filiere ${filiere}`);
  return c;
}

// ---------------------------------------------------------------------------
// B1 — sites classes et inscrits : une couche jamais ingeree
// ---------------------------------------------------------------------------

test('B1 : une couche patrimoniale non ingeree ne produit pas de feu vert', () => {
  // C'etait le defaut le plus grave des huit audits. `patrimoine()` lisait la table `contrainte`
  // pour quatre types alors qu'un seul est ingere, et transformait les listes vides en absences
  // CONSTATEES : `pat_sites` valait 90/100 en vert avec la phrase « Aucun site classe ni inscrit
  // dans le rayon d'analyse », partout en France, sur zero donnee.
  const s = snapshot();
  const inconnu = { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };
  s.patrimoine.siteClasse = inconnu;
  s.patrimoine.siteInscrit = inconnu;

  const c = critere(s, 'pat_sites');
  assert.equal(c.note, null, 'aucune note ne peut etre attribuee sans donnee');
  assert.equal(c.feu, 'gris');
  assert.doesNotMatch(
    c.valeurAffichee ?? '',
    /aucun site/i,
    "l'application ne doit pas ecrire qu'il n'y a aucun site : elle ne le sait pas",
  );
});

test('B1 : une couche ingeree sans site dans le rayon reste une absence constatee', () => {
  // Le pendant indispensable du test precedent. Corriger B1 en grisant TOUJOURS le critere aurait
  // ete aussi faux dans l'autre sens : une couche ingeree qui ne trouve rien est une information,
  // et elle doit valoir un feu vert.
  const s = snapshot();
  const rien = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.patrimoine.siteClasse = rien;
  s.patrimoine.siteInscrit = rien;

  const c = critere(s, 'pat_sites');
  assert.equal(c.note, 90, 'une absence constatee dans le rayon vaut une bonne note, pas la note maximale');
  assert.equal(c.feu, 'vert');
  assert.match(c.valeurAffichee ?? '', /aucun site/i);
});

test('B1 : le knock-out eolien du site classe doit rester ATTEIGNABLE', () => {
  /**
   * Ce test ne verifie pas un calcul : il verifie qu'une regle n'est pas morte.
   *
   * `knockouts.ts` teste `s.patrimoine.siteClasse.recouvre === true`. Tant que le connecteur
   * retournait `false` en dur, cette condition etait structurellement inatteignable : un parc
   * eolien en site classe n'etait jamais signale, alors que l'article L. 341-10 du code de
   * l'environnement y impose une autorisation ministerielle speciale, jamais accordee.
   *
   * Un knock-out qui ne peut pas se declencher est une regression a part entiere, et elle est
   * invisible : tous les tests passent, la regle est ecrite, elle ne sert a rien.
   */
  const s = snapshot();
  s.patrimoine.siteClasse = { recouvre: true, partRecouvrement: 1, distanceM: 0, nom: 'Marais de Bourges' };

  const r = calculerScore(s, 'eolien_terrestre');
  const ko = r.knockOuts.find((k) => k.id === 'ko_eol_site_classe');
  assert.ok(ko, 'le knock-out doit se declencher sur une parcelle en site classe');
  assert.equal(ko.derogeable, false, 'un site classe n’est pas derogeable pour un parc eolien');
  assert.match(ko.motif, /Marais de Bourges/, 'le nom du site doit figurer dans le motif');
  assert.equal(r.statut, 'rouge');
  assert.equal(r.scoreGlobal, null, 'une parcelle ecartee ne porte pas de score');
});

// ---------------------------------------------------------------------------
// B2 — nombre de proprietaires
// ---------------------------------------------------------------------------

test('B2 : un nombre de proprietaires inconnu ne vaut pas « un seul proprietaire »', () => {
  // `cadastre.ts` retournait `nbProprietairesEstime: 1` litteralement, pour toutes les parcelles de
  // France, sous un commentaire decrivant un algorithme jamais ecrit. Le critere valait donc
  // 100/100, feu VERT, « 1 proprietaire(s) estime(s) » — sur le facteur qui decide le plus souvent
  // de la mort d'un projet.
  const s = snapshot();
  s.foncier.nbProprietairesEstime = null;

  const c = critere(s, 'fonc_nb_proprietaires');
  assert.equal(c.note, null);
  assert.equal(c.feu, 'gris');
  assert.doesNotMatch(c.valeurAffichee ?? '', /\b1 proprietaire/i);
});

test('B2 : le connecteur cadastral n’INVENTE pas un proprietaire unique', async () => {
  /**
   * Le test precedent verifie le moteur ; celui-ci verifie la SOURCE, et c'est lui qui compte.
   * Griser le critere sans corriger le connecteur aurait laisse le `1` en dur dans le snapshot, donc
   * dans les exports GeoJSON, CSV et Shapefile, qui lisent le snapshot et non le score.
   *
   * `contexteFoncier` fait un appel reseau pour le voisinage, protege par un `catch` : la fonction
   * repond meme hors ligne, et c'est bien la valeur du champ qui est verifiee ici, pas l'appel.
   */
  const carre = 0.002; // ~150 m de cote a cette latitude
  const foncier = await contexteFoncier({
    idu: '283900000C0843',
    codeInsee: '28383',
    nomCommune: 'Tillay-le-Peneux',
    codeDepartement: '28',
    section: 'C',
    numero: '0843',
    prefixe: '000',
    contenanceM2: 120000,
    surfaceCalculeeM2: 120000,
    centroide: [1.75, 48.15],
    dateRecuperation: new Date().toISOString(),
    geometrie: {
      type: 'Polygon',
      coordinates: [
        [
          [1.75, 48.15],
          [1.75 + carre, 48.15],
          [1.75 + carre, 48.15 + carre],
          [1.75, 48.15 + carre],
          [1.75, 48.15],
        ],
      ],
    },
  } as Parameters<typeof contexteFoncier>[0]);

  assert.equal(
    foncier.nbProprietairesEstime,
    null,
    'aucune API publique n’expose le nombre de comptes cadastraux : la valeur doit rester inconnue',
  );
  assert.equal(foncier.indivisionProbable, null);
  // La mesure geometrique, elle, doit continuer d'exister : elle ne dependait pas de la donnee
  // nominative, et la corriger n'avait aucune raison de la supprimer.
  assert.ok(
    foncier.surfaceDunSeulTenantHa != null && foncier.surfaceDunSeulTenantHa > 0,
    'la surface d’un seul tenant est une mesure geometrique et doit rester renseignee',
  );
  assert.ok(
    foncier.morcellementIndice != null && foncier.morcellementIndice >= 0,
    'l’indice de morcellement est calcule sur la geometrie et doit rester renseigne',
  );
});

test('B2 : un nombre de proprietaires connu est note normalement', () => {
  const s = snapshot();
  s.foncier.nbProprietairesEstime = 6;
  const c = critere(s, 'fonc_nb_proprietaires');
  assert.ok(c.note != null && c.note < 50, 'six proprietaires doivent degrader la note');
});

// ---------------------------------------------------------------------------
// B3 — un echec de source ne peut pas produire de note
// ---------------------------------------------------------------------------

test('B3 : la garde generique grise tout critere dont la source a echoue', () => {
  /**
   * La garde qui rend la classe entiere impossible.
   *
   * La liste des connecteurs en echec existait depuis longtemps, remontait jusqu'au PDF, et
   * n'atteignait jamais le moteur de scoring. Un connecteur pouvait donc echouer, laisser une
   * valeur par defaut derriere lui, et cette valeur etait notee comme une mesure. Cas mesure : un
   * echec de `gaspar/pprn` produisait « alea nul » note 100/100 en VERT, dans le meme document que
   * la note de bas de page annoncant l'echec.
   */
  const s = snapshot();
  s.eau.inondation = { zonagePpri: null, alea: 'nul', dansTri: false };

  const sansEchec = critere(s, 'risq_inondation');
  assert.equal(sansEchec.note, 100, 'sans echec, un alea nul vaut la note maximale');

  for (const echecs of [['georisques'], ['georisques/gaspar/pprn']]) {
    const avecEchec = critere(s, 'risq_inondation', 'solaire_sol', { connecteursEnEchec: echecs });
    assert.equal(avecEchec.note, null, `echec ${echecs[0]} : la note doit disparaitre`);
    assert.equal(avecEchec.feu, 'gris');
    assert.match(avecEchec.valeurAffichee ?? '', /echec/i);
  }
});

test('B3 : la garde ne touche pas les criteres d’une autre source', () => {
  // Une garde trop large serait un defaut symetrique : elle griserait des criteres reellement
  // mesures, et degraderait la couverture sans motif.
  const s = snapshot();
  s.eau.inondation = { zonagePpri: null, alea: 'nul', dansTri: false };
  s.topographie.pentePct = 3;

  const c = critere(s, 'risq_inondation', 'solaire_sol', { connecteursEnEchec: ['apicarto_rpg'] });
  assert.equal(c.note, 100, "un echec du RPG ne concerne pas l'inondation");
});

test('B3 : la comparaison des cles de source exige une frontiere de segment', () => {
  // `zaer_local` ne doit pas correspondre a `zaer_local_bis` : une correspondance par simple
  // prefixe de chaine griserait des criteres voisins par accident.
  assert.equal(sourceEnEchec('georisques', ['georisques/gaspar/pprn']), true);
  assert.equal(sourceEnEchec('georisques/gaspar/pprn', ['georisques']), true);
  assert.equal(sourceEnEchec('georisques', ['georisques']), true);
  assert.equal(sourceEnEchec('zaer_local', ['zaer_local_bis']), false);
  assert.equal(sourceEnEchec('zaer_local_bis', ['zaer_local']), false);
  assert.equal(sourceEnEchec(null, ['georisques']), false);
  assert.equal(sourceEnEchec('georisques', []), false);
});

// ---------------------------------------------------------------------------
// B4 — un fait communal n'est pas une mesure parcellaire
// ---------------------------------------------------------------------------

test('B4 : un PPRI communal ne produit plus un alea parcellaire « moyen »', () => {
  /**
   * `alea` valait `'moyen'` des lors qu'un PPR d'inondation pesait sur la COMMUNE. 85 % des communes
   * francaises ont un PPRN : le critere passait a 45/100, feu orange, sur chaque parcelle de ces
   * communes — y compris sur un plateau a trois kilometres du moindre cours d'eau. Le critere
   * apparaissait en point de vigilance presque partout, et un signal present partout n'est plus un
   * signal.
   */
  assert.equal(
    aleaInondation({
      zonageTriConnu: true,
      dansZonageTri: false,
      triConnu: true,
      pprnConnu: true,
      ppriSurLaCommune: true,
      planIndetermine: false,
    }),
    null,
    'un PPRI communal empeche de conclure, il ne mesure pas',
  );
});

test('B4 : le zonage TRI, qui est une geometrie, etablit bien un alea fort', () => {
  assert.equal(
    aleaInondation({
      zonageTriConnu: true,
      dansZonageTri: true,
      triConnu: true,
      pprnConnu: true,
      ppriSurLaCommune: true,
      planIndetermine: false,
    }),
    'fort',
  );
});

test('B4 : un alea nul exige que TOUTES les sources aient repondu', () => {
  const base = {
    zonageTriConnu: true,
    dansZonageTri: false,
    triConnu: true,
    pprnConnu: true,
    ppriSurLaCommune: false,
    planIndetermine: false,
  };
  assert.equal(aleaInondation(base), 'nul', 'tout est connu et rien ne pese : alea nul');

  // Chaque source manquante, prise seule, doit suffire a rendre l'alea inconnu. C'est le defaut B3
  // sous sa forme d'origine : les conditions etaient liees par `&&`, si bien qu'il fallait que les
  // TROIS appels echouent pour que l'alea soit inconnu.
  for (const [champ, valeur] of [
    ['zonageTriConnu', false],
    ['triConnu', false],
    ['pprnConnu', false],
    ['planIndetermine', true],
  ] as const) {
    assert.equal(
      aleaInondation({ ...base, [champ]: valeur }),
      null,
      `${champ} = ${valeur} doit rendre l'alea inconnu, et non « nul »`,
    );
  }
});

// ---------------------------------------------------------------------------
// B5 — un PPRN illisible n'est pas une absence de PPRI
// ---------------------------------------------------------------------------

test('B5 : un plan dont le libelle est illisible rend la famille naturelle INCERTAINE', () => {
  /**
   * Mesure de l'audit 7 : 30 % des communes ayant un PPRN ont au moins un plan dont le libelle
   * n'est pas classable (« PPR Bordeaux (revision) » est le cas reel). Sur celles-la,
   * `ppri.present` valait `false` : l'application affirmait l'absence d'un plan de prevention du
   * risque d'inondation qu'elle venait elle-meme de lire.
   */
  assert.equal(
    presenceFamille({
      listeRecue: true,
      aFamille: false,
      aIndetermine: true,
      incertainSiIndetermine: true,
    }),
    null,
  );
});

test('B5 : la provenance classe le PPRT, donc aucun libelle illisible ne le rend incertain', () => {
  // `gaspar/pprt` ne renvoie que des plans technologiques, par construction du point d'entree :
  // « Vallee de la chimie » (Lyon) n'en porte aucun sigle et doit pourtant compter. Aucun libelle
  // n'entre dans la decision, donc aucun plan illisible ne peut la rendre incertaine.
  assert.equal(
    presenceFamille({
      listeRecue: true,
      aFamille: false,
      aIndetermine: true,
      incertainSiIndetermine: false,
    }),
    false,
  );
});

test('B5 : les trois autres verdicts de presence restent nets', () => {
  const args = { aIndetermine: false, incertainSiIndetermine: true };
  assert.equal(presenceFamille({ ...args, listeRecue: false, aFamille: false }), null, 'appel en echec');
  assert.equal(presenceFamille({ ...args, listeRecue: true, aFamille: true }), true, 'plan identifie');
  assert.equal(presenceFamille({ ...args, listeRecue: true, aFamille: false }), false, 'absence constatee');
});

// ---------------------------------------------------------------------------
// B5 bis — les sigles ajoutes, et ceux qui doivent rester indetermines
// ---------------------------------------------------------------------------

test('B5 : les sigles MT, Pi et PPRNPi sont reconnus', () => {
  // Trois ecritures relevees dans Gaspar que le classifieur ne reconnaissait pas, et qui tombaient
  // donc dans les 30 % d'indetermines.
  assert.deepEqual(famillesRisque('PPRN-MT - Digne 2011'), ['mouvement']);
  assert.deepEqual(famillesRisque('PPRNPi - Bassin de la Save'), ['inondation']);
  assert.deepEqual(famillesRisque('PPR - Pi - Garonne aval'), ['inondation']);
});

test('B5 : un plan multirisque sans jetons entre crochets reste indetermine', () => {
  // « PER-Multi [ MVT & S ] » se classe par ses jetons ; « PER-Multi - Menton » n'en a aucun. Ranger
  // le second au hasard serait pire que le laisser indetermine : `presenceFamille` en fera un `null`,
  // donc un critere gris, et non une absence affirmee.
  assert.deepEqual(famillesRisque('PER-Multi - Menton 2001'), []);
  assert.deepEqual(famillesRisque('PER-Multi [ MVT & S ] - Menton 2001').sort(), ['mouvement', 'seisme']);
});

test('B5 : les sigles deja couverts ne regressent pas', () => {
  // Releves reels des audits 7 et 8. Ils restent ici parce qu'un ajout de regle peut en casser un
  // autre : `MT` a du etre insere sans casser `MVT`, et `Pi` sans casser `PPRIF`.
  const cas: Array<[string, string[]]> = [
    ['PPRN-I - SUB marine - Arles 2015', ['inondation']],
    ['PPRI_Lez_Mosson', ['inondation']],
    ['PPRi-Lezarde', ['inondation']],
    ['PPRL-PANES', ['inondation']],
    ['PER-I - BV Paillons [ Nice ] 1999', ['inondation']],
    ['PPRIF Montpellier', ['incendie']],
    ['PPRN-IF - Aix-en-Provence 2021', ['incendie']],
    ['PPRN-MVT - Nice 2020', ['mouvement']],
    ['PPRN-RGA - Aix-en-Provence 2012', ['argiles']],
    ['PPRN-S - seisme_Aix_en_Provence', ['seisme']],
    ['PPR Bordeaux (revision)', []],
  ];
  for (const [libelle, attendu] of cas) {
    assert.deepEqual(famillesRisque(libelle).sort(), [...attendu].sort(), libelle);
  }
});

// ---------------------------------------------------------------------------
// C1 — les criteres sans source doivent le DIRE, et ne pas peser sur la couverture
// ---------------------------------------------------------------------------

test('C1 : les criteres structurellement gris sont declares sans source', () => {
  /**
   * Quatre criteres sont gris en permanence parce qu'aucune source ne les alimente : les ZAER (aucun
   * job d'ingestion), la sensibilite archeologique (arretes DRAC non publies nationalement), le
   * contexte karstique (absent de Georisques) et les radars et servitudes aeronautiques (DGAC et
   * Meteo-France). Ils affichaient « donnee indisponible », ce qui laisse croire a une panne
   * passagere, et pesaient sur la penalite de couverture — alors qu'un critere qui manque
   * identiquement a toutes les parcelles ne discrimine rien.
   *
   * Un critere `sansSource` doit dire OU chercher la donnee : c'est ce qui le distingue d'un aveu
   * d'impuissance.
   */
  const attendus: Array<[string, 'solaire_sol' | 'eolien_terrestre' | 'methanisation']> = [
    ['urb_zaer', 'solaire_sol'],
    ['pat_archeologie', 'solaire_sol'],
    ['risq_aero_radar', 'eolien_terrestre'],
    ['risq_karst', 'methanisation'],
  ];
  for (const [id, filiere] of attendus) {
    const c = critere(snapshot(), id, filiere);
    assert.equal(c.note, null, `${id} doit etre gris`);
    assert.match(c.valeurAffichee ?? '', /aucune source/i, `${id} doit se dire sans source`);
    assert.ok(
      (c.commentaire ?? '').length > 80,
      `${id} doit indiquer ou chercher la donnee, pas seulement qu'elle manque`,
    );
  }
});

test('C1 : un critere sans source ne degrade pas la couverture de donnees', () => {
  // La couverture mesure ce qui a pu etre evalue parmi ce qui EST evaluable. Y compter des criteres
  // dont la source n'existe pas ferait passer toutes les parcelles pour mal renseignees.
  const s = snapshot();
  s.eau.inondation = { zonagePpri: null, alea: 'nul', dansTri: false };
  const r = calculerScore(s, 'solaire_sol');

  const gris = r.criteres.filter((c) => c.note == null);
  assert.ok(gris.length > 0, 'le snapshot de test est volontairement peu renseigne');
  assert.ok(
    r.couvertureDonnees > 0,
    'un seul critere renseigne doit donner une couverture non nulle',
  );
  // Les parts affichees doivent sommer a 100 % : le denominateur d'affichage inclut les criteres
  // sans source, faute de quoi leur absence parait plus lourde qu'elle ne l'est.
  const somme = r.criteres.reduce((a, c) => a + c.poids, 0);
  assert.ok(Math.abs(somme - 1) < 0.01, `les parts doivent sommer a 100 %, obtenu ${somme}`);
});
