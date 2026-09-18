/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE REFERENTIEL DE CONTRAINTES — 292 lignes recopiees, pas paraphrasees
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. `contraintes-referentiel.ts` est genere depuis le classeur
 * `referentiel/Contraintes_EnR_parcelles_France.xlsx` puis COMMITTE. Le generateur verifie
 * beaucoup de choses, mais il ne tourne pas en integration continue : sans lui, rien ne
 * garantirait plus que ce qu'on embarque correspond au classeur.
 *
 * CE QUE CES TESTS PROTEGENT, ET C'EST LE §9.1 DU CAHIER DES CHARGES : que le nombre de
 * contraintes par filiere corresponde EXACTEMENT au classeur, et qu'aucun champ de seuil ou de
 * reference n'ait ete tronque. Une contrainte perdue en chemin ne provoque aucune erreur : le
 * verdict se calcule sans elle, et rend une parcelle favorable qui ne l'est pas. C'est la faute la
 * plus couteuse que cette chaine puisse porter, et elle est parfaitement muette.
 *
 * CE QU'ILS NE PROTEGENT PAS. Ils ne disent pas si un seuil est JURIDIQUEMENT juste — aucun test
 * ne lit le Journal officiel. Ils verifient la fidelite de la RECOPIE et la coherence de la
 * normalisation, qui sont les deux choses qu'un programme peut garantir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRAINTES_REFERENTIEL,
  FILIERES_REFERENTIEL,
  MILLESIME_REFERENTIEL,
  contrainteParId,
  contraintesDeFiliere,
} from '../src/contraintes-referentiel.js';

/**
 * Les comptes annonces par le cahier des charges, figes ici.
 *
 * Ils viennent du prompt ET du classeur, qui concordent : 83 + 60 + 52 + 43 + 54 = 292. Les figer
 * est tout l'objet du §9.1 — une feuille tronquee a l'import passerait sinon inapercue.
 */
const ATTENDUS: Record<string, number> = {
  eolien_terrestre: 83,
  solaire_sol: 60,
  agrivoltaisme: 52,
  bess: 43,
  methanisation: 54,
};

test('§9.1 — LE COMPTE PAR FILIERE CORRESPOND EXACTEMENT AU CLASSEUR', () => {
  assert.equal(CONTRAINTES_REFERENTIEL.length, 292);
  for (const filiere of FILIERES_REFERENTIEL) {
    assert.equal(
      contraintesDeFiliere(filiere).length,
      ATTENDUS[filiere],
      `${filiere} : ${contraintesDeFiliere(filiere).length} contraintes au lieu de ${ATTENDUS[filiere]}`,
    );
  }
  // Et l'agrivoltaisme est bien une filiere a part entiere, pas un regime du solaire.
  assert.equal(FILIERES_REFERENTIEL.length, 5);
  assert.ok(FILIERES_REFERENTIEL.includes('agrivoltaisme'));
});

test('§9.1 — AUCUN CHAMP DE SEUIL NI DE REFERENCE N’A ETE TRONQUE', () => {
  /*
   * Le classeur ne porte AUCUNE cellule vide sur ses 2 336 cases — mesure faite a l'inspection.
   * Un champ vide ici signifierait donc une perte a l'import, pas une lacune de la source.
   */
  for (const c of CONTRAINTES_REFERENTIEL) {
    for (const [nom, valeur] of [
      ['categorie', c.categorie],
      ['nom', c.nom],
      ['description', c.description],
      ['seuilReglementaire', c.seuilReglementaire],
      ['caractereBrut', c.caractereBrut],
      ['referenceReglementaire', c.referenceReglementaire],
      ['coucheSig', c.coucheSig],
      ['typeIntegrationBrut', c.typeIntegrationBrut],
    ] as const) {
      assert.ok(valeur.trim().length > 0, `${c.id} : champ « ${nom} » vide`);
    }
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LA TRONCATURE SE DETECTE SUR LA LONGUEUR, PAS SUR LES POINTS DE SUSPENSION
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * MA PREMIERE ECRITURE refusait toute chaine finissant par « … », en la declarant tronquee. Elle
   * a accuse un import PARFAITEMENT CORRECT : deux cellules du classeur finissent par des points
   * de suspension parce que leur auteur enumere — « carrieres, mines, ISDND, sites pollues,
   * delaisses, plans d'eau artificiels… ». C'est de la ponctuation francaise, pas une coupure.
   *
   * Un garde qui accuse a tort finit desactive, et il aurait fallu ajouter deux exceptions pour un
   * controle qui ne prouvait rien. Le vrai signe d'une troncature a l'import est une longueur qui
   * tombe PILE sur un plafond classique — 255, 256, 1024, 32767 — parce qu'aucun redacteur n'ecrit
   * une phrase de trois cent vingt-sept caracteres exactement. Mesure du classeur : la description
   * la plus longue fait 220 caracteres, aucun champ n'atteint un plafond.
   */
  const PLAFONDS = [255, 256, 512, 1024, 2048, 32767];
  for (const c of CONTRAINTES_REFERENTIEL) {
    for (const [nom, valeur] of [
      ['description', c.description],
      ['seuilReglementaire', c.seuilReglementaire],
      ['referenceReglementaire', c.referenceReglementaire],
      ['coucheSig', c.coucheSig],
    ] as const) {
      assert.ok(
        !PLAFONDS.includes(valeur.length),
        `${c.id} : « ${nom} » fait exactement ${valeur.length} caracteres — longueur de troncature`,
      );
    }
  }
});

test('LES IDENTIFIANTS SONT UNIQUES ET STABLES', () => {
  // Un identifiant en double ferait silencieusement disparaitre une contrainte de tout index.
  const ids = CONTRAINTES_REFERENTIEL.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiant de contrainte en double');
  for (const c of CONTRAINTES_REFERENTIEL) {
    assert.match(c.id, /^[a-z_]+__[a-z0-9_]+$/, `identifiant hors format : ${c.id}`);
    assert.ok(c.id.startsWith(`${c.filiere}__`), `${c.id} ne porte pas sa filiere`);
    assert.equal(contrainteParId(c.id)?.nom, c.nom);
  }
  assert.equal(contrainteParId('inexistant'), null, 'un identifiant inconnu rend null, pas undefined');
});

test('CHAQUE CONTRAINTE PORTE AU MOINS UNE REGLE, ET SON NIVEAU DOMINANT', () => {
  const SEVERITE: Record<string, number> = { redhibitoire: 3, penalisant: 2, favorable: 1, cadre: 0 };
  for (const c of CONTRAINTES_REFERENTIEL) {
    assert.ok(c.regles.length >= 1, `${c.id} : aucune regle`);
    const pire = c.regles.reduce((a, b) => (SEVERITE[b.caractere]! > SEVERITE[a.caractere]! ? b : a));
    assert.equal(
      c.caractere,
      pire.caractere,
      `${c.id} : niveau dominant « ${c.caractere} » alors que la regle la plus severe est « ${pire.caractere} »`,
    );
    // Le libelle de chaque regle est un fragment REEL du caractere d'origine.
    for (const r of c.regles) {
      assert.ok(
        c.caractereBrut.includes(r.libelle.replace(/\s+$/, '')),
        `${c.id} : la regle « ${r.libelle} » n'apparait pas dans « ${c.caractereBrut} »`,
      );
    }
  }
});

test('LES CARACTERES COMPOSITES SONT ECLATES EN PLUSIEURS REGLES', () => {
  /*
   * C'EST LA DEMANDE CENTRALE DE LA NOTE DE SYNTHESE : « Rédhibitoire (<500 m) / Pénalisant » est un
   * buffer d'interdiction DANS un buffer de coordination, pas une exclusion binaire. Les ecraser en
   * une valeur unique fait perdre l'un des deux, et le resultat est faux dans les deux sens :
   * garder le redhibitoire seul ecarte du foncier instruisable, garder le penalisant seul laisse
   * passer du foncier interdit.
   *
   * 94 contraintes sur 292 (32 %) sont dans ce cas. Le chiffre est fige : une regression du
   * decoupage les ramenerait a une regle chacune, sans qu'aucun autre test ne bronche.
   */
  const composites = CONTRAINTES_REFERENTIEL.filter((c) => c.regles.length > 1);
  assert.equal(composites.length, 94, `${composites.length} contraintes composites au lieu de 94`);

  // Le temoin le plus explicite du cahier des charges : le recul eolien de 500 m.
  const recul = CONTRAINTES_REFERENTIEL.find(
    (c) => c.filiere === 'eolien_terrestre' && c.nom.includes('500 m des habitations'),
  );
  assert.ok(recul, 'la contrainte de recul de 500 m doit exister');
  assert.equal(recul.regles.length, 2, 'elle porte un buffer d’interdiction ET un buffer de coordination');
  assert.equal(recul.regles[0]?.caractere, 'redhibitoire');
  assert.deepEqual(recul.regles[0]?.condition, { operateur: 'max_strict', valeur: 500, unite: 'm' });
  assert.equal(recul.regles[1]?.caractere, 'penalisant');
});

test('LA NORMALISATION NE PERD NI NE FABRIQUE DE NIVEAU', () => {
  /*
   * Quatre niveaux, et le quatrieme est assume : `cadre` couvre les quatorze lignes qui ne jugent
   * pas la parcelle mais decrivent une procedure applicable a tout projet — regime ICPE, permis de
   * construire, etude d'impact, balisage. Les ramener a « penalisant » mettrait CHAQUE parcelle
   * « a instruire » pour un permis toujours requis, et le verdict cesserait de distinguer quoi que
   * ce soit.
   */
  const comptes = new Map<string, number>();
  for (const c of CONTRAINTES_REFERENTIEL) {
    comptes.set(c.caractere, (comptes.get(c.caractere) ?? 0) + 1);
  }
  assert.deepEqual(
    Object.fromEntries([...comptes].sort()),
    { cadre: 14, favorable: 11, penalisant: 134, redhibitoire: 133 },
  );

  // Et chaque niveau normalise est coherent avec le libelle d'origine de sa regle.
  const DEBUT: Record<string, RegExp> = {
    redhibitoire: /^r[ée]dhibitoire/i,
    penalisant: /^(très\s+)?p[ée]nalisant/i,
    favorable: /^favorable/i,
    cadre: /^(cadre|variable)/i,
  };
  for (const c of CONTRAINTES_REFERENTIEL) {
    for (const r of c.regles) {
      assert.match(
        r.libelle,
        DEBUT[r.caractere]!,
        `${c.id} : « ${r.libelle} » classe en « ${r.caractere} »`,
      );
    }
  }
});

test('LE TYPE D’INTEGRATION EST NORMALISE SUR QUATRE VALEURS', () => {
  const comptes = new Map<string, number>();
  for (const c of CONTRAINTES_REFERENTIEL) {
    comptes.set(c.typeIntegration, (comptes.get(c.typeIntegration) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...comptes].sort()), {
    a_creer_modeliser: 29,
    critere_projet: 37,
    departemental_regional: 28,
    open_data_national: 198,
  });

  /*
   * L'ORDRE DE CLASSEMENT COMPTE, et deux temoins le prouvent. « Open data national +
   * Departemental » doit rester automatisable — la couche nationale existe, la surcouche locale
   * l'affine. « Critere projet + Open data (voisinage) » doit rester un critere de projet : c'est
   * le projet qui decide, la donnee ne fait qu'eclairer. Ranger l'un pour l'autre changerait ce que
   * l'application promet d'automatiser.
   */
  const mixte = CONTRAINTES_REFERENTIEL.find((c) => c.typeIntegrationBrut === 'Open data national + Départemental');
  assert.equal(mixte?.typeIntegration, 'open_data_national');
  const projet = CONTRAINTES_REFERENTIEL.find((c) =>
    c.typeIntegrationBrut.startsWith('Critère projet + Open data'),
  );
  assert.equal(projet?.typeIntegration, 'critere_projet');
});

test('SEULES LES COUCHES NATIONALES SONT EVALUEES AUTOMATIQUEMENT', () => {
  /*
   * 96 contraintes sur 292 restent en verification manuelle, et c'est une information que
   * l'operateur doit avoir : le dossier les liste explicitement, avec leur valeur reglementaire et
   * la source a consulter. Les faire passer pour automatiques serait la faute de famille de ce
   * depot — presenter une absence de mesure comme un constat.
   */
  const auto = CONTRAINTES_REFERENTIEL.filter((c) => c.modeEvaluation === 'auto_sig');
  assert.equal(auto.length, 196);
  for (const c of auto) {
    assert.equal(
      c.typeIntegration,
      'open_data_national',
      `${c.id} est evaluee automatiquement sans couche nationale`,
    );
  }
  for (const c of CONTRAINTES_REFERENTIEL) {
    if (c.typeIntegration !== 'open_data_national') {
      assert.equal(c.modeEvaluation, 'verification_manuelle', `${c.id} devrait etre manuelle`);
    }
  }
});

test('UN SEUIL EXTRAIT D’UN TEXTE VAGUE EST MARQUE APPROXIMATIF', () => {
  /*
   * DEFAUT TROUVE EN RELISANT LA SORTIE DU GENERATEUR. « ~ quelques km (GRDF) / ~1 km (NATRAN)
   * selon cout » produit un « 1 km » d'apparence ferme, que la source ne pretend pas fixer. Laisser
   * ce nombre trancher un verdict ferait ecarter du foncier sur une valeur inventee par
   * l'extraction.
   *
   * 12 seuils sur 69 sont dans ce cas. Le moteur de verdict les traite en verification manuelle.
   */
  const numeriques = CONTRAINTES_REFERENTIEL.flatMap((c) => c.seuilsNumeriques);
  assert.equal(numeriques.length, 69, 'nombre de conditions numeriques extraites');
  assert.equal(numeriques.filter((s) => s.approximatif).length, 12);

  const gaz = CONTRAINTES_REFERENTIEL.find((c) => c.nom.includes('distance au réseau gaz'));
  assert.ok(gaz, 'la contrainte de distance au reseau gaz doit exister');
  assert.ok(
    gaz.seuilsNumeriques.every((s) => s.approximatif),
    'un seuil « ~ quelques km … selon cout » ne doit jamais passer pour ferme',
  );
  // Et le TEXTE d'origine est toujours la : c'est lui qui part dans le dossier.
  assert.ok(gaz.seuilReglementaire.includes('quelques km'));
});

test('LE TEXTE D’ORIGINE DU SEUIL EST TOUJOURS CONSERVE', () => {
  /*
   * 223 des 292 seuils ne portent AUCUNE condition numerique exploitable — « Interdit hors liste du
   * document-cadre », « Avis conforme de l'ABF ». Une extraction qui pretendrait les resumer les
   * trahirait ; le texte reste donc la source de verite de l'affichage et du dossier.
   */
  const sansNombre = CONTRAINTES_REFERENTIEL.filter((c) => c.seuilsNumeriques.length === 0);
  assert.ok(sansNombre.length > 200, `${sansNombre.length} seuils sans condition numerique`);
  for (const c of sansNombre) {
    assert.ok(c.seuilReglementaire.trim().length > 0, `${c.id} : seuil vide`);
  }
  // Et chaque condition extraite cite le morceau de texte dont elle vient.
  for (const c of CONTRAINTES_REFERENTIEL) {
    for (const s of c.seuilsNumeriques) {
      assert.ok(s.texte.trim().length > 0, `${c.id} : condition sans texte source`);
      assert.ok(
        c.seuilReglementaire.includes(s.texte),
        `${c.id} : le texte « ${s.texte} » ne vient pas du seuil d'origine`,
      );
    }
  }
});

test('LE MILLESIME EST DATE ET PLAUSIBLE', () => {
  assert.match(MILLESIME_REFERENTIEL, /^\d{4}-\d{2}-\d{2}$/);
  // Le classeur annonce un cadre « a jour 2024-2026 » : un millesime anterieur decrirait autre chose.
  assert.ok(MILLESIME_REFERENTIEL >= '2024-01-01', 'millesime anterieur au cadre decrit');
});
