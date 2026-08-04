/**
 * Tests du referentiel metier.
 *
 * POURQUOI CE FICHIER EXISTE. Quatre audits, et `packages/core` n'avait AUCUN test — ratio
 * source/test de 0,00 sur 1 773 lignes. Or ce paquet porte le fondement de tout le reste : les
 * regles reglementaires avec leurs references juridiques et leurs dates d'entree en vigueur, le
 * catalogue des criteres, les ponderations par defaut, les avertissements, la palette.
 *
 * CE QUE CES TESTS PROTEGENT, ET CE QU'ILS NE PEUVENT PAS PROTEGER. Ils ne verifient pas qu'un
 * seuil est JURIDIQUEMENT juste — aucun test ne peut lire le Journal officiel. Ils verifient
 * l'integrite STRUCTURELLE du referentiel : qu'aucune regle ne circule sans reference ni date,
 * qu'aucun critere n'est reference sans exister, que les poids couvrent le catalogue, qu'aucun
 * identifiant ne collisionne. Ce sont exactement les fautes qu'une relecture ne voit pas et qui
 * font qu'une fiche affiche une contrainte sans pouvoir la fonder.
 *
 * L'argument commercial de cette application est la reglementation datee. Une regle sans date
 * n'est donc pas un detail de forme : c'est la promesse qui tombe.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVERTISSEMENTS,
  CIBLES_RUBRIQUES,
  CRITERES,
  FILIERES,
  FILIERES_META,
  COULEURS_SCORE,
  COULEURS_SCORE_REMPLISSAGE,
  LIBELLES_SCORE,
  DESCRIPTIONS_SCORE,
  COULEUR_REDHIBITOIRE,
  LIBELLE_REDHIBITOIRE,
  DESCRIPTION_REDHIBITOIRE,
  PONDERATIONS_DEFAUT,
  REFERENTIEL_DERNIERE_VERIFICATION,
  REGLES,
  REGLES_PAR_ID,
  STATUTS_PROSPECTION,
  snapshotVide,
  identiteDepuisIdu,
  COEFFICIENT_TRACE,
  lineaireRaccordementKm,
  volOiseauPourLineaireKm,
} from '../dist/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Regles reglementaires : la promesse de l'application
// ---------------------------------------------------------------------------

test('chaque regle porte une reference juridique et une date d’entree en vigueur', () => {
  const manquantes: string[] = [];
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    if (!r.reference || r.reference.trim().length < 8) manquantes.push(`${id} : reference`);
    if (!ISO_DATE.test(r.dateEntreeEnVigueur)) {
      manquantes.push(`${id} : date « ${r.dateEntreeEnVigueur} »`);
    }
    if (!r.libelle || r.libelle.trim() === '') manquantes.push(`${id} : libelle`);
  }
  assert.deepEqual(
    manquantes,
    [],
    "l'argument de l'application est la reglementation DATEE : une regle sans reference ni date " +
      'ne peut fonder aucune conclusion opposable',
  );
});

test('aucune date d’entree en vigueur n’est dans le futur ni absurde', () => {
  const aujourdhui = new Date(REFERENTIEL_DERNIERE_VERIFICATION);
  const anomalies: string[] = [];
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    const d = new Date(r.dateEntreeEnVigueur);
    if (Number.isNaN(d.getTime())) anomalies.push(`${id} : date illisible`);
    else if (d > aujourdhui) anomalies.push(`${id} : ${r.dateEntreeEnVigueur} posterieure a la verification`);
    // Aucun texte fondant un critere ENR ne precede la loi de 1976 sur la protection de la nature.
    else if (d.getFullYear() < 1976) anomalies.push(`${id} : ${r.dateEntreeEnVigueur} improbable`);
  }
  assert.deepEqual(anomalies, []);
});

test('aucun identifiant de regle n’est revendique par deux filieres', () => {
  /**
   * `REGLES_PAR_ID` aplatit les quatre tableaux par filiere en indexant sur `regle.id`, PAS sur
   * la cle d'objet. Les cles sont volontairement courtes a l'interieur de leur filiere
   * (`distance_habitation` existe en eolien ET en methanisation) et les `id` sont prefixes pour
   * etre globalement uniques (`eol_distance_habitation`, `metha_distance_habitation`).
   *
   * C'est donc l'unicite des `id` qui est l'invariant, et il est essentiel : une collision ferait
   * silencieusement disparaitre une regle de l'index, et la fiche citerait le texte d'une autre
   * filiere pour fonder un recul. Le recul eolien de 500 m de l'article L.515-44 se ferait
   * remplacer par les 200 m de l'arrete methanisation.
   */
  const vus = new Map<string, string>();
  const collisions: string[] = [];
  let total = 0;
  for (const [filiere, regles] of Object.entries(REGLES)) {
    for (const regle of Object.values(regles)) {
      total += 1;
      const deja = vus.get(regle.id);
      if (deja) collisions.push(`${regle.id} : ${deja} et ${filiere}`);
      else vus.set(regle.id, filiere);
    }
  }
  assert.deepEqual(collisions, []);
  assert.equal(
    Object.keys(REGLES_PAR_ID).length,
    total,
    "l'aplatissement ne doit perdre aucune regle",
  );
});

test('chaque identifiant de regle porte le prefixe de sa filiere', () => {
  // C'est ce qui rend l'unicite STRUCTURELLE et non accidentelle : sans prefixe, la premiere
  // regle homonyme ajoutee dans une autre filiere ecraserait l'existante sans bruit.
  const prefixes: Record<string, readonly string[]> = {
    solaire_sol: ['pv', 'agri'],
    eolien_terrestre: ['eol'],
    bess: ['bess'],
    methanisation: ['metha'],
  };
  const fautes: string[] = [];
  for (const [filiere, regles] of Object.entries(REGLES)) {
    const attendus = prefixes[filiere] ?? [];
    for (const regle of Object.values(regles)) {
      if (!attendus.some((p) => regle.id.startsWith(`${p}_`))) {
        fautes.push(`${filiere}/${regle.id} : prefixe attendu parmi ${attendus.join(', ')}`);
      }
    }
  }
  assert.deepEqual(fautes, []);
});

test('une regle instable est signalee comme telle et commentee', () => {
  // `instable` declenche un avertissement renforce dans l'interface. Le poser sans expliquer
  // pourquoi laisse l'utilisateur devant une alerte qu'il ne peut pas interpreter.
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    if (r.instable) {
      assert.ok(
        r.commentaire && r.commentaire.length > 20,
        `${id} est declaree instable sans commentaire expliquant en quoi`,
      );
    }
  }
});

test('une regle chiffree porte son unite', () => {
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    if (r.valeur != null) {
      assert.ok(r.unite && r.unite.trim() !== '', `${id} porte une valeur ${r.valeur} sans unite`);
      assert.ok(Number.isFinite(r.valeur), `${id} : valeur non finie`);
    }
  }
});

test('les URL de reference pointent vers une source officielle', () => {
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    if (r.url) {
      assert.match(r.url, /^https:\/\//, `${id} : URL non securisee`);
      assert.match(
        r.url,
        /\.gouv\.fr|\.europa\.eu/,
        `${id} : ${r.url} n'est pas un domaine public francais ou europeen`,
      );
    }
  }
});

test('la date de derniere verification du referentiel est lisible et plausible', () => {
  assert.match(REFERENTIEL_DERNIERE_VERIFICATION, ISO_DATE);
  const d = new Date(REFERENTIEL_DERNIERE_VERIFICATION);
  assert.ok(!Number.isNaN(d.getTime()));
  assert.ok(d.getFullYear() >= 2024, 'un referentiel verifie avant 2024 serait perime');
});

// ---------------------------------------------------------------------------
// Criteres et ponderations : la coherence du catalogue
// ---------------------------------------------------------------------------

test('chaque critere du catalogue est complet', () => {
  const incomplets: string[] = [];
  for (const [id, c] of Object.entries(CRITERES)) {
    if (c.id !== id) incomplets.push(`${id} : id interne « ${c.id} » divergent`);
    if (!c.libelle) incomplets.push(`${id} : libelle`);
    if (!c.famille) incomplets.push(`${id} : famille`);
    // L'explication s'affiche au survol : c'est elle qui rend le score explicable, exigence
    // premiere du cahier des charges.
    if (!c.explication || c.explication.length < 30) incomplets.push(`${id} : explication trop courte`);
  }
  assert.deepEqual(incomplets, []);
});

test('chaque filiere pondere exactement les criteres qui existent', () => {
  for (const filiere of FILIERES) {
    const poids = PONDERATIONS_DEFAUT[filiere].poids;
    const inconnus = Object.keys(poids).filter((id) => !(id in CRITERES));
    assert.deepEqual(
      inconnus,
      [],
      `${filiere} pondere des criteres absents du catalogue : ${inconnus.join(', ')}`,
    );
  }
});

test('aucun poids n’est nul, negatif ou absurde', () => {
  for (const filiere of FILIERES) {
    for (const [id, p] of Object.entries(PONDERATIONS_DEFAUT[filiere].poids)) {
      // Un poids nul revient a retirer le critere : autant ne pas le declarer, sinon il apparait
      // dans la fiche avec une contribution de zero et parait ignore par erreur.
      assert.ok(p > 0, `${filiere}/${id} : poids ${p}`);
      assert.ok(Number.isFinite(p) && p <= 100, `${filiere}/${id} : poids ${p} hors echelle`);
    }
  }
});

test('les seuils de coloration sont ordonnes et dans l’echelle', () => {
  for (const filiere of FILIERES) {
    const p = PONDERATIONS_DEFAUT[filiere];
    assert.ok(
      p.seuilOrange < p.seuilVert,
      `${filiere} : seuilOrange ${p.seuilOrange} doit rester sous seuilVert ${p.seuilVert}`,
    );
    assert.ok(p.seuilOrange >= 0 && p.seuilVert <= 100, `${filiere} : seuils hors 0-100`);
    assert.ok(
      p.seuilCouvertureDonnees > 0 && p.seuilCouvertureDonnees <= 1,
      `${filiere} : seuilCouvertureDonnees ${p.seuilCouvertureDonnees} doit etre une part`,
    );
  }
});

test('chaque filiere declare des surfaces et un rayon coherents', () => {
  for (const filiere of FILIERES) {
    const m = FILIERES_META[filiere];
    assert.ok(m.surfaceUtileMinHa > 0, `${filiere} : surface minimale nulle`);
    assert.ok(
      m.surfaceUtileOptimaleHa >= m.surfaceUtileMinHa,
      `${filiere} : optimale ${m.surfaceUtileOptimaleHa} sous le minimum ${m.surfaceUtileMinHa}`,
    );
    assert.ok(m.rayonRaccordementKm > 0, `${filiere} : rayon de raccordement nul`);
    assert.ok(m.libelle && m.libelleCourt, `${filiere} : libelles manquants`);
    assert.ok(m.couchesParDefaut.length > 0, `${filiere} : aucune couche par defaut`);
  }
});

test('les couches activees par defaut incluent toujours les parcelles', () => {
  // Une filiere qui ouvre sans la couche parcellaire donne une carte ou rien n'est cliquable :
  // l'utilisateur conclut que l'application est cassee.
  for (const filiere of FILIERES) {
    assert.ok(
      FILIERES_META[filiere].couchesParDefaut.includes('parcelles'),
      `${filiere} n'active pas la couche parcelles`,
    );
  }
});

// ---------------------------------------------------------------------------
// Avertissements : rattaches a quelque chose qui existe
// ---------------------------------------------------------------------------

test('chaque cible d’avertissement resout vers un critere ou une rubrique declaree', () => {
  /**
   * La fiche filtre les avertissements par egalite stricte sur l'identifiant du critere, ou sur
   * une rubrique. Une cible qui n'est ni l'un ni l'autre ne s'affiche donc JAMAIS, et rien ne le
   * signale : la reserve parait attachee alors qu'elle est morte.
   *
   * Sept cibles mortes ont survecu quatre audits, dont `env_avifaune` et `env_chiropteres` — des
   * criteres qui n'ont jamais existe. La reserve d'inventaire quatre saisons paraissait couvrir
   * ces enjeux ; elle ne s'affichait que sur `env_especes_protegees`.
   */
  const rubriques = new Set<string>(CIBLES_RUBRIQUES);
  const orphelins: string[] = [];
  for (const a of AVERTISSEMENTS) {
    for (const cible of a.cible ?? []) {
      if (!(cible in CRITERES) && !rubriques.has(cible)) orphelins.push(`${a.id} -> ${cible}`);
    }
  }
  assert.deepEqual(orphelins, []);
});

test('chaque avertissement contextuel s’affiche sur au moins un critere', () => {
  // Une reserve attachee uniquement a une rubrique reste visible, mais une reserve qui ne touche
  // aucun critere n'apparait pas au niveau ou la decision se prend.
  for (const a of AVERTISSEMENTS) {
    if (a.portee !== 'contextuel') continue;
    const criteres = (a.cible ?? []).filter((c) => c in CRITERES);
    assert.ok(criteres.length > 0, `${a.id} ne s'affiche sur aucun critere`);
  }
});

test('chaque avertissement a un identifiant unique, une portee et un texte utile', () => {
  const vus = new Set<string>();
  for (const a of AVERTISSEMENTS) {
    assert.ok(!vus.has(a.id), `identifiant d'avertissement en doublon : ${a.id}`);
    vus.add(a.id);
    assert.ok(['global', 'contextuel'].includes(a.portee), `${a.id} : portee « ${a.portee} »`);
    assert.ok(a.texte.length > 40, `${a.id} : texte trop court pour etre actionnable`);
  }
});

test('un avertissement contextuel sans cible ne s’afficherait jamais', () => {
  for (const a of AVERTISSEMENTS) {
    if (a.portee === 'contextuel') {
      assert.ok(
        a.cible && a.cible.length > 0,
        `${a.id} est contextuel mais ne cible rien : il est invisible`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Palette : lisibilite du feu tricolore
// ---------------------------------------------------------------------------

test('la palette couvre les quatre feux, contour et remplissage', () => {
  for (const feu of ['vert', 'orange', 'rouge', 'gris'] as const) {
    assert.match(COULEURS_SCORE[feu], /^#[0-9a-f]{6}$/i, `couleur de ${feu}`);
    assert.match(COULEURS_SCORE_REMPLISSAGE[feu], /^#[0-9a-f]{6}$/i, `remplissage de ${feu}`);
    assert.ok(LIBELLES_SCORE[feu].trim() !== '', `libelle de ${feu}`);
    assert.ok(DESCRIPTIONS_SCORE[feu].length > 20, `description de ${feu} trop courte`);
  }
});

test('le redhibitoire est une cinquieme entree, distincte du rouge de score', () => {
  // C'est la distinction dont l'absence a produit le defaut le plus couteux du troisieme audit :
  // une parcelle exclue par le droit affichee « Score faible ».
  assert.notEqual(COULEUR_REDHIBITOIRE, COULEURS_SCORE.rouge);
  assert.notEqual(LIBELLE_REDHIBITOIRE, LIBELLES_SCORE.rouge);
  assert.ok(
    DESCRIPTION_REDHIBITOIRE.length > 30,
    'la description doit expliquer ce qui ecarte la parcelle',
  );
});

test('les quatre libelles de score sont distincts', () => {
  const libelles = Object.values(LIBELLES_SCORE);
  assert.equal(new Set(libelles).size, libelles.length, `libelles ambigus : ${libelles.join(' / ')}`);
});

// ---------------------------------------------------------------------------
// Statuts de prospection
// ---------------------------------------------------------------------------

test('les statuts de prospection sont uniques et non vides', () => {
  assert.ok(STATUTS_PROSPECTION.length >= 3);
  assert.equal(new Set(STATUTS_PROSPECTION).size, STATUTS_PROSPECTION.length);
  for (const s of STATUTS_PROSPECTION) assert.match(s, /^[a-z_]+$/, `statut « ${s} »`);
});

// ---------------------------------------------------------------------------
// Snapshot vide : le contrat de nullabilite
// ---------------------------------------------------------------------------

test('le snapshot vide n’invente aucune valeur', () => {
  /**
   * Principe directeur du modele : une donnee absente ne doit jamais etre assimilee a une donnee
   * favorable. Un `false` ou un `0` pose par erreur dans le snapshot vide se lirait comme
   * « pas de contrainte » ou « distance nulle » — l'erreur exacte que ce projet existe pour
   * ecarter. On parcourt donc l'objet entier a la recherche d'une valeur non nulle.
   */
  const s = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  const fautes: string[] = [];

  const parcourir = (v: unknown, chemin: string): void => {
    if (v == null) return;
    if (Array.isArray(v)) {
      if (v.length > 0) fautes.push(`${chemin} : tableau pre-rempli`);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, sv] of Object.entries(v)) parcourir(sv, `${chemin}.${k}`);
      return;
    }
    if (typeof v === 'boolean') fautes.push(`${chemin} = ${v}`);
    if (typeof v === 'number') fautes.push(`${chemin} = ${v}`);
  };

  // `identite`, `dateSnapshot` et `sources` portent legitimement des valeurs.
  for (const [cle, valeur] of Object.entries(s)) {
    if (cle === 'identite' || cle === 'dateSnapshot' || cle === 'sources') continue;
    parcourir(valeur, cle);
  }

  /**
   * Une seule exception, et elle est justifiee.
   *
   * `documentCadrePvSol.departementCouvert = false` n'affirme rien sur la parcelle : il dit que
   * le document-cadre du departement n'est PAS ingere dans notre base. C'est un fait sur notre
   * couverture de donnees, pas sur le territoire — et c'est precisement ce qui empeche le
   * knock-out de se declencher a tort. L'inconnu sur la parcelle, lui, reste porte par
   * `parcelleEligible: null`.
   */
  const attendues = ['urbanisme.documentCadrePvSol.departementCouvert = false'];
  assert.deepEqual(
    fautes,
    attendues,
    'un booleen ou un nombre dans le snapshot vide se lit comme une donnee constatee',
  );
});

test('l’identite est reconstituee correctement depuis un IDU', () => {
  const i = identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux');
  assert.equal(i.idu, '283900000C0843');
  assert.equal(i.codeInsee, '28390');
  assert.equal(i.codeDepartement, '28');
  assert.equal(i.prefixe, '000');
  // La section cadastrale occupe DEUX caracteres dans l'IDU, completee a gauche par un zero
  // quand elle n'en compte qu'un. La rendre en « C » demanderait de retirer ce zero, ce qui
  // casserait la reconstruction de l'IDU par concatenation.
  assert.equal(i.section, '0C');
  assert.equal(i.numero, '0843');
  assert.equal(i.nomCommune, 'Tillay-le-Peneux');
});

test('un IDU corse conserve sa lettre de departement', () => {
  // Les codes 2A et 2B sont le piege classique du decoupage d'un IDU : un `parseInt` les
  // ramenerait a 2, et la parcelle changerait de departement.
  const i = identiteDepuisIdu('2A004000AB0012', 'Ajaccio');
  assert.equal(i.codeDepartement, '2A');
  assert.equal(i.codeInsee, '2A004');
});

// ---------------------------------------------------------------------------
// Lineaire de raccordement : reciprocite
// ---------------------------------------------------------------------------

test('le coefficient de trace reste dans la fourchette observee', () => {
  // 1,3 a 1,6 sur les raccordements realises. Sortir de cette fourchette sans mesure nouvelle
  // reviendrait a changer le classement des parcelles sur une intuition.
  assert.ok(COEFFICIENT_TRACE >= 1.3 && COEFFICIENT_TRACE <= 1.6, `coefficient ${COEFFICIENT_TRACE}`);
});

test('la conversion trace / vol d’oiseau est reciproque', () => {
  // La carte dessine un cercle geodesique a partir d'un budget de lineaire : les deux sens
  // doivent se composer, sinon le rayon affiche ne correspond pas au filtre applique.
  for (const km of [0, 0.5, 4.2, 12, 40]) {
    const aller = lineaireRaccordementKm(km);
    const retour = volOiseauPourLineaireKm(aller);
    assert.ok(Math.abs(retour - km) < 0.01, `${km} km -> ${aller} -> ${retour}`);
  }
});

test('le lineaire estime majore toujours le vol d’oiseau', () => {
  for (const km of [0.1, 1, 5, 20]) {
    assert.ok(lineaireRaccordementKm(km) > km, `${km} km non majore`);
  }
  assert.equal(lineaireRaccordementKm(0), 0, 'un poste sur la parcelle ne demande aucun trace');
});

test('un IDU se reconstruit par concatenation de ses composants', () => {
  // C'est la raison pour laquelle la section garde son zero de tete : la fiche, les exports et les
  // requetes reconstituent l'IDU a partir des composants, et retirer le zero les casserait tous.
  for (const idu of ['283900000C0843', '2A004000AB0012', '971010000ZD0455']) {
    const i = identiteDepuisIdu(idu);
    assert.equal(
      `${i.codeInsee}${i.prefixe}${i.section}${i.numero}`,
      idu.slice(0, 14),
      `reconstruction de ${idu}`,
    );
  }
});

test('un departement d’outre-mer garde ses trois chiffres', () => {
  // 971 a 976 : un decoupage sur deux caracteres donnerait « 97 », qui n'est pas un departement.
  assert.equal(identiteDepuisIdu('971010000ZD0455').codeDepartement, '971');
  assert.equal(identiteDepuisIdu('974110000AB0001').codeDepartement, '974');
});
