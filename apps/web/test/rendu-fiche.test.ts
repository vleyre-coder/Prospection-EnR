/**
 * LE PREMIER TEST DU PROJET QUI AFFICHE UNE PAGE.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 10 a mesure le rapport lignes de test / lignes de source par
 * espace : 0,46 pour l'API, 0,34 pour le noyau, 0,28 pour le scoring, et **0,11 pour l'interface** —
 * quatre fois moins que l'API, sur la seule partie que l'utilisateur regarde. Les cinq fichiers de
 * test de `apps/web` n'assemblaient aucun composant : ils verifiaient des fonctions pures et des
 * proprietes du source.
 *
 * Ce que cela coutait, concretement. Les deux defauts de forme de l'audit 10 — les points decimaux
 * dans les phrases francaises (B1) et les dates ISO du rapport (B2) — vivaient dans du texte
 * REELLEMENT AFFICHE. Ils ont ete trouves en pilotant un navigateur a la main, une fois, sur une
 * parcelle. Rien ne les empechait de revenir le lendemain.
 *
 * CE QUE CE FICHIER A TROUVE EN NAISSANT. Le premier rendu a revele que la fiche ecrivait
 * « poids 10.7 % · note 45/100 » a trois lignes de « 19,05 ha » : le meme defaut B1, sur CHAQUE
 * critere de CHAQUE fiche — mesure, 142 occurrences sur les cinq fiches capturees — a l'endroit
 * precis ou le garde de l'audit 10 ne regardait pas. Ce garde inspecte les chaines produites par le
 * MOTEUR ; le poids et les distances de zonage sont mis en forme par l'interface elle-meme. Un garde
 * qui couvre une moitie du chemin laisse passer l'autre, et il donne l'illusion d'avoir traite le
 * sujet — c'est deja la lecon de B2.
 *
 * SUR QUELLES DONNEES. Sur des fiches REELLES, capturees depuis la base par
 * `apps/api/scripts/capturer-fixtures-web.ts` : quatre filieres sur une meme parcelle, plus une
 * parcelle minuscule dont les seuils de surface sont franchis, plus le cas ECARTE (l'eolien sur cette
 * parcelle est rouge, avec le recul de 500 m de l'article L.515-44 impossible a tenir). Une fixture
 * ecrite a la main ne contiendrait que les cas auxquels j'ai pense ; les defauts vivent dans les
 * autres.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { FicheParcelle } from '../src/components/FicheParcelle.js';
import { CAS, fiche, referentiel, rendre, texte } from './aides/rendu.js';

/** Rend la fiche d'un cas capture et renvoie le HTML et le texte lu par l'utilisateur. */
function afficher(nom: string): { html: string; texte: string; f: ReturnType<typeof fiche> } {
  const cas = CAS.find((c) => c.nom === nom);
  assert.ok(cas, `cas capture inconnu : ${nom}`);
  const f = fiche(cas.nom);
  const html = rendre(
    h(FicheParcelle, { idu: cas.idu, filiere: cas.filiere, referentiel }),
    [[['fiche', cas.idu, cas.filiere], f]],
  );
  return { html, texte: texte(html), f };
}

/**
 * Toute suite de chiffres separee par des points, prise entiere.
 *
 * Le lookbehind et le lookahead sont indispensables : sans eux, `2.1.5.0` produirait trois
 * correspondances de deux groupes chacune et serait signale a tort.
 */
const CHAINE_POINTEE = /(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g;

/**
 * Les points decimaux d'un texte, hors notations ou le point est la bonne ponctuation.
 *
 * LA REGLE EST STRUCTURELLE, PAS UNE LISTE D'EXCEPTIONS, et c'est deliberé : une liste d'exceptions
 * grossit a chaque faux positif jusqu'a excuser un vrai defaut. Un nombre decimal francais a
 * exactement DEUX groupes de chiffres autour d'un point. Les deux notations legitimes rencontrees
 * dans la fiche en ont trois ou quatre :
 *
 *   - la version du moteur, `1.4.0+b24e3f16` — trois groupes, notation semantique ;
 *   - les rubriques de la nomenclature IOTA, `2.1.5.0` et `3.3.1.0` (code de l'environnement,
 *     art. R.214-1) — quatre groupes, et le point y est la notation officielle : une virgule serait
 *     une faute de citation.
 *
 * Compter les groupes separe donc les deux familles sans avoir a nommer aucune valeur.
 */
function pointsDecimaux(t: string): string[] {
  return [...t.matchAll(CHAINE_POINTEE)]
    .map((m) => m[0])
    .filter((s) => s.split('.').length === 2);
}

test('LE DEFAUT TROUVE PAR CE FICHIER : aucune fiche n’ecrit un nombre a point decimal', () => {
  const fautes: string[] = [];
  for (const cas of CAS) {
    for (const s of pointsDecimaux(afficher(cas.nom).texte)) {
      fautes.push(`${cas.nom} : « ${s} »`);
    }
  }
  assert.deepEqual(
    fautes,
    [],
    `La fiche melange deux conventions typographiques. Utilisez formatNombre, jamais toFixed.\n${fautes.join('\n')}`,
  );
});

test('aucune fiche n’affiche une date au format ISO', () => {
  // Pendant du garde pose sur le rapport PDF a l'audit 10 (defaut B2), applique cette fois a ce que
  // l'ecran montre. La fiche et le rapport doivent dire la meme date de la meme facon.
  for (const cas of CAS) {
    const trouvees = afficher(cas.nom).texte.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    assert.deepEqual(trouvees, [], `${cas.nom} affiche des dates ISO : ${trouvees.join(', ')}`);
  }
});

test('LE CAS ECARTE : les motifs eliminatoires sont lisibles, et aucun score n’est presente comme un verdict', () => {
  /**
   * L'eolien sur la parcelle 283900000A0094 est le cas le plus severe des cinq : statut rouge,
   * `scoreGlobal` a `null`, DEUX knock-outs — la zone N du document d'urbanisme, et le recul de 500 m
   * de l'article L.515-44 qui ne peut pas etre atteint meme en implantant l'aerogenerateur au point
   * le plus eloigne de la parcelle.
   *
   * C'est exactement la situation ou une fiche trompeuse coute le plus cher : un prospecteur qui
   * verrait un chiffre engagerait du temps sur une parcelle juridiquement fermee.
   */
  const { texte: t, f } = afficher('grande-eolien');
  assert.equal(f.score.statut, 'rouge', 'le cas capture doit bien etre une parcelle ecartee');
  assert.equal(f.score.scoreGlobal, null, 'une parcelle ecartee n’a pas de score');

  const kos = f.score.knockOuts ?? [];
  assert.ok(kos.length >= 2, `le cas doit porter au moins deux knock-outs, il en porte ${kos.length}`);
  for (const ko of kos) {
    // Le motif complet, pas seulement un libelle : c'est le motif qui dit POURQUOI, et sans lui la
    // parcelle est ecartee sans explication utilisable.
    assert.ok(
      t.includes(ko.motif.slice(0, 80)),
      `motif eliminatoire absent de l’affichage : ${ko.motif.slice(0, 80)}…`,
    );
  }
  assert.ok(/L\.515-44/.test(t), 'la base legale du recul doit etre citee a l’ecran');
});

test('les limites de viabilite sont toutes affichees, sur les cinq fiches', () => {
  /**
   * Une limite de viabilite n'est pas eliminatoire : elle plafonne le statut. C'est donc exactement
   * le genre d'information qu'une interface peut « perdre » sans que rien ne casse — le score
   * s'affiche, la fiche est complete, et la reserve a disparu.
   *
   * La parcelle minuscule en porte trois, dont « Surface tres insuffisante » : 0,03 ha implantables.
   */
  for (const cas of CAS) {
    const { texte: t, f } = afficher(cas.nom);
    for (const limite of f.score.limitesViabilite ?? []) {
      assert.ok(
        t.includes(limite.motif.slice(0, 80)),
        `${cas.nom} : limite de viabilite absente de l’affichage — ${limite.libelle}`,
      );
    }
  }
});

test('une donnee absente ne ressemble jamais a un critere satisfait', () => {
  /**
   * La regle fondatrice du projet, verifiee ici sur le rendu et non plus sur une fonction pure.
   * C'est le defaut B1 de l'audit 8 — le plus grave des dix audits — ou `pat_sites` valait 90/100 en
   * vert, avec la phrase « Aucun site classe ni inscrit dans le rayon d'analyse », partout en France,
   * sur zero donnee.
   *
   * NOTE SUR UNE ERREUR QUE J'AI FAITE EN ECRIVANT CE TEST, parce qu'elle se reproduira : j'avais
   * pris `critere.valeur == null` pour « pas de donnee ». C'est faux. `valeur` est le champ
   * NUMERIQUE, nul pour tout critere qualitatif — « 1473 kWh/m2/an » et « 49 m - Beauce et vallee de
   * la Conie » ont tous deux `valeur` a `null` et une donnee parfaitement reelle. Le signal
   * d'absence, c'est le FEU GRIS. Le test verifiait donc une propriete qui n'existe pas, et il
   * echouait pour la bonne raison.
   *
   * Les deux sens sont verifies, car ils peuvent se casser separement :
   *   - un critere gris ne doit porter aucune note (une note, c'est un jugement) ;
   *   - un critere qui AFFICHE une absence doit etre gris (sinon le feu dement le texte).
   */
  for (const cas of CAS) {
    const { texte: t, f } = afficher(cas.nom);
    const criteres = f.score.criteres ?? [];
    const gris = criteres.filter((c) => c.feu === 'gris');
    assert.ok(gris.length > 0, `${cas.nom} : aucun critere gris, le cas ne prouverait rien`);

    for (const c of gris) {
      assert.equal(
        c.note,
        null,
        `${cas.nom} : « ${c.libelle} » est gris mais porte une note de ${c.note} — une absence de donnee ne se note pas`,
      );
      assert.ok(
        (c.valeurAffichee ?? '').trim() !== '',
        `${cas.nom} : « ${c.libelle} » est gris et n’affiche rien du tout`,
      );
    }

    for (const c of criteres) {
      if (!/indisponible|non evalue|non renseign/i.test(c.valeurAffichee ?? '')) continue;
      assert.equal(
        c.feu,
        'gris',
        `${cas.nom} : « ${c.libelle} » affiche « ${c.valeurAffichee} » mais son feu est ${c.feu} — le feu dement le texte`,
      );
    }

    assert.ok(
      /donnee indisponible|non evalue/.test(t),
      `${cas.nom} : ${gris.length} criteres sont gris et rien ne le dit a l’ecran`,
    );
  }
});

test('les avertissements contextuels sont rattaches a la fiche, les globaux n’y sont pas', () => {
  /**
   * Le referentiel distingue deux portees, et le partage est deliberé : 2 avertissements GLOBAUX —
   * la section 12 du cahier des charges — vivent dans le bandeau de `App`, et 6 CONTEXTUELS sont
   * rattaches a la rubrique qu'ils concernent.
   *
   * Les deux sens comptent. Un contextuel manquant, et une reserve disparait la ou elle sert. Un
   * global recopie dans la fiche, et l'avertissement le plus important de l'outil se dilue en
   * repetition — ce que l'on cesse de lire.
   */
  const contextuels = referentiel.avertissements.filter((a) => a.portee === 'contextuel');
  const globaux = referentiel.avertissements.filter((a) => a.portee === 'global');
  assert.ok(contextuels.length > 0 && globaux.length > 0, 'le referentiel doit porter les deux portees');

  for (const cas of CAS) {
    const { texte: t } = afficher(cas.nom);

    // Ces deux-la valent pour toute parcelle : la surface vient toujours du cadastre, et la reserve
    // sur les donnees de proprietaire est une exigence RGPD, pas une commodite d'affichage.
    for (const id of ['cadastre_indicatif', 'donnees_proprietaires']) {
      const a = contextuels.find((x) => x.id === id);
      assert.ok(a, `avertissement contextuel « ${id} » absent du referentiel`);
      assert.ok(
        t.includes(a.texte.slice(0, 60)),
        `${cas.nom} : avertissement contextuel « ${id} » absent de la fiche`,
      );
    }

    for (const a of globaux) {
      assert.ok(
        !t.includes(a.texte.slice(0, 60)),
        `${cas.nom} : l’avertissement global « ${a.id} » est recopie dans la fiche ; sa place est le bandeau §12`,
      );
    }
  }
});

test('les cinq fiches reelles rendent sans lever, et produisent une page substantielle', () => {
  // Garde de non-regression le plus simple et pas le moins utile : une exception dans le rendu d'une
  // filiere ne se verrait aujourd'hui qu'en ouvrant la fiche a la main.
  for (const cas of CAS) {
    const { html, texte: t } = afficher(cas.nom);
    assert.ok(html.length > 20_000, `${cas.nom} : rendu suspicieusement court (${html.length} car.)`);
    assert.ok(t.includes('Fiche parcelle'), `${cas.nom} : l’en-tete de la fiche manque`);
    assert.ok(t.includes(cas.idu), `${cas.nom} : l’IDU n’apparait pas sur la fiche`);
  }
});
