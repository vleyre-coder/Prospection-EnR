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
import { createHash } from 'node:crypto';
import {
  CONTRAINTES_REFERENTIEL,
  EMPREINTE_CLASSEUR,
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
   * 239 des 292 seuils ne portent AUCUNE condition numerique exploitable — « Interdit hors liste du
   * document-cadre », « Avis conforme de l'ABF ». Une extraction qui pretendrait les resumer les
   * trahirait ; le texte reste donc la source de verite de l'affichage et du dossier.
   *
   * LE COMPTE EST FIGE, ET NON « PLUS DE 200 ». La borne lache laissait trois chiffres differents
   * circuler dans les commentaires du depot pour la meme mesure — 207, 223, 239 — sans qu'aucun
   * test ne bronche. Un commentaire faux se propage : il sert de reference a la relecture
   * suivante.
   */
  const sansNombre = CONTRAINTES_REFERENTIEL.filter((c) => c.seuilsNumeriques.length === 0);
  assert.equal(sansNombre.length, 239, `${sansNombre.length} seuils sans condition numerique`);
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

test('UN SEUIL DONT TOUS LES NOMBRES N’ONT PAS ETE LUS EST MARQUE COMME TEL', () => {
  /*
   * POURQUOI CE CHAMP EXISTE. Le cas que le cahier des charges cite lui-meme au §9.2 —
   * methanisation, distance aux tiers — porte « 100 m (Déclaration) / 200 m
   * (Enregistrement-Autorisation) » et ressort de l'extraction avec UNE condition : « = 100 m ».
   * Le seuil reglementaire applicable depend du regime ICPE, donc du tonnage, donc du projet.
   * Trancher un verdict sur « = 100 m » serait faux dans les deux sens : trop permissif pour un
   * projet en enregistrement, faussement ferme pour tous les autres.
   *
   * Le marqueur est volontairement grossier — plus de nombres dans le texte que de conditions
   * extraites — et le sens de son erreur est le bon : une contrainte declaree incomplete a tort
   * part en verification manuelle, ce qui est prudent. L'inverse ne se rattrape pas.
   */
  const incompletes = CONTRAINTES_REFERENTIEL.filter((c) => !c.extractionComplete);
  assert.equal(incompletes.length, 58, `${incompletes.length} extractions incompletes au lieu de 58`);

  // Le marqueur doit DIRE LA VERITE sur chaque ligne, dans les deux sens.
  for (const c of CONTRAINTES_REFERENTIEL) {
    const nombres = (c.seuilReglementaire.match(/\d+(?:[.,]\d+)?/g) ?? []).length;
    assert.equal(
      c.extractionComplete,
      nombres <= c.seuilsNumeriques.length,
      `${c.id} : ${nombres} nombres dans « ${c.seuilReglementaire} » pour ${c.seuilsNumeriques.length} conditions`,
    );
  }

  // Le temoin nomme par le §9.2.
  const tiers = contrainteParId('methanisation__distance_d_implantation_aux_tiers_habitations_erp');
  assert.ok(tiers);
  assert.equal(tiers.extractionComplete, false, 'le cas a deux regimes ICPE ne peut pas trancher seul');
});

test('L’EMPREINTE DU CLASSEUR CHANGE AVEC LE CLASSEUR, ET AVEC LUI SEUL', () => {
  /*
   * ELLE SEULE DECIDE DU REDATAGE, et c'est le fruit de deux faux redatages observes. Comparer les
   * deux fichiers generes redatait le referentiel des qu'un COMMENTAIRE changeait ; comparer le
   * seul tableau des contraintes le redatait des qu'on y ajoutait un champ CALCULE. Ni l'un ni
   * l'autre n'est une verification du classeur, et un millesime avance a tort affirme un controle
   * qui n'a pas eu lieu — exactement ce que le garde devait empecher.
   *
   * L'empreinte ne couvre donc que les huit cellules de chacune des 292 lignes, telles que lues.
   */
  assert.match(EMPREINTE_CLASSEUR, /^[0-9a-f]{16}$/);

  /*
   * Elle est RECALCULABLE ici : le test refait la somme a partir des champs recopies du classeur,
   * et la compare a celle qu'a ecrite le generateur. Une empreinte figee a la main — ou laissee en
   * arriere apres une revision du classeur — ne passerait pas.
   */
  const cellules = CONTRAINTES_REFERENTIEL.map((c) =>
    [
      c.filiere,
      c.categorie,
      c.nom,
      c.description,
      c.seuilReglementaire,
      c.caractereBrut,
      c.referenceReglementaire,
      c.coucheSig,
      c.typeIntegrationBrut,
    ].join('\u001f'),
  ).join('\u001e');
  const recalculee = createHash('sha256').update(cellules).digest('hex').slice(0, 16);
  assert.equal(
    recalculee,
    EMPREINTE_CLASSEUR,
    'l’empreinte ne correspond plus aux cellules embarquees : regenerer le referentiel',
  );
});
