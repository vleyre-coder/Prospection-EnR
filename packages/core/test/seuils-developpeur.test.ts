/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * QUEL SEUIL S'APPLIQUE — l'invariant §2.3, et le cas nomme par le §9.2
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CES TESTS SONT LES PLUS IMPORTANTS DE L'ETAPE. La regle « Mode 1 au reglementaire,
 * Mode 2 au developpeur sinon reglementaire » est INVISIBLE a l'usage : une inversion ne provoque
 * aucune erreur, aucun ecran rouge, aucune ligne de journal. Elle produit simplement des verdicts
 * faux — et faux dans le sens le plus couteux, puisqu'un seuil developpeur exigeant applique par
 * erreur a la carte ecarte du foncier parfaitement constructible, pendant que l'operateur croit
 * lire le droit.
 *
 * Le cas nomme par le cahier des charges au §9.2 est rejoue tel quel : methanisation, distance aux
 * tiers, « 100 m (Déclaration) / 200 m (Enregistrement-Autorisation) » au classeur contre 400 m
 * chez le developpeur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRAINTES_REFERENTIEL,
  contrainteParId,
  type ContrainteReferentiel,
} from '../src/contraintes-referentiel.js';
import {
  assouplit,
  conditionDeReference,
  contraintesParametrables,
  indexerSeuils,
  raisonsNonAutomatique,
  sensRequis,
  seuilApplique,
  type SeuilDeveloppeur,
} from '../src/seuils-developpeur.js';

/** Le cas nomme par le §9.2 du cahier des charges. */
const ID_TIERS = 'methanisation__distance_d_implantation_aux_tiers_habitations_erp';

function contrainte(id: string): ContrainteReferentiel {
  const c = contrainteParId(id);
  assert.ok(c, `contrainte introuvable : ${id}`);
  return c;
}

const SEUIL_400: SeuilDeveloppeur = {
  contrainteId: ID_TIERS,
  valeur: 400,
  unite: 'm',
  sens: 'min',
  motif: 'Politique interne : 400 m de toute habitation',
};

test('§9.2 — LE MODE 1 IGNORE LE SEUIL DEVELOPPEUR, MEME QUAND IL EST SAISI', () => {
  const c = contrainte(ID_TIERS);
  const index = indexerSeuils([SEUIL_400]);

  const mode1 = seuilApplique(c, 'reglementaire', index);

  assert.equal(mode1.origine, 'reglementaire', 'la carte lit le droit, jamais le cahier des charges');
  assert.equal(mode1.motifDeveloppeur, null);
  assert.equal(mode1.conditionReglementaire, null, 'rien n’est remplace, donc rien n’est a montrer');
  // Le texte du classeur est porte meme quand il ne tranche pas : c'est lui que l'operateur lit.
  assert.equal(mode1.texteReglementaire, '100 m (Déclaration) / 200 m (Enregistrement-Autorisation)');
});

test('§9.2 — LE MODE 2 APPLIQUE LES 400 m DU DEVELOPPEUR, ET DIT LESQUELS', () => {
  const c = contrainte(ID_TIERS);
  const mode2 = seuilApplique(c, 'developpeur', indexerSeuils([SEUIL_400]));

  assert.equal(mode2.origine, 'developpeur');
  assert.deepEqual(mode2.condition, { operateur: 'min', valeur: 400, unite: 'm' });
  assert.equal(mode2.motifDeveloppeur, SEUIL_400.motif);

  /*
   * CE QUE LE VERDICT DOIT POUVOIR DIRE, mot pour mot : « ecartee par VOTRE exigence de 400 m ; la
   * reglementation, elle, demande 100 m ». Sans `conditionReglementaire`, la seconde moitie de la
   * phrase serait perdue et l'operateur ne saurait pas qu'il peut negocier.
   */
  assert.deepEqual(mode2.conditionReglementaire, { operateur: 'egal', valeur: 100, unite: 'm' });
  assert.equal(mode2.texteReglementaire, '100 m (Déclaration) / 200 m (Enregistrement-Autorisation)');

  /*
   * ET IL DOIT DIRE AUSSI QUE LA CONFORMITE N'EST PAS ACQUISE. Filtrer a 400 m est legitime — le
   * developpeur a donne un nombre ferme — mais le seuil REGLEMENTAIRE, lui, depend du regime ICPE
   * et n'est pas etabli par le classeur. Une parcelle retenue ici n'est pas pour autant declaree
   * conforme, et le dossier doit porter la contrainte en verification.
   */
  assert.equal(mode2.reglementaireEtabli, false);
  assert.deepEqual(mode2.raisons, ['extraction_incomplete']);
});

test('SANS SAISIE, LE MODE 2 RETOMBE SUR LE REGLEMENTAIRE', () => {
  const c = contrainte('eolien_terrestre__eloignement_500_m_des_habitations');
  const vide = seuilApplique(c, 'developpeur', indexerSeuils([]));

  assert.equal(vide.origine, 'reglementaire');
  assert.deepEqual(vide.condition, { operateur: 'min', valeur: 500, unite: 'm' });
  assert.equal(vide.reglementaireEtabli, true);
  assert.deepEqual(vide.raisons, []);

  // Un seuil saisi pour UNE AUTRE contrainte ne doit pas deteindre sur celle-ci.
  const ailleurs = seuilApplique(c, 'developpeur', indexerSeuils([SEUIL_400]));
  assert.equal(ailleurs.origine, 'reglementaire');
});

test('LA REFERENCE EST L’EXIGENCE DU CLASSEUR, PAS LE DECLENCHEUR DE LA REGLE', () => {
  /*
   * DEUX LECTURES DE LA MEME LIMITE, ET UNE SEULE EST COMPARABLE A UNE EXIGENCE DE DEVELOPPEUR.
   * Le recul eolien porte « ≥ 500 m » en colonne « Seuil » — ce que la parcelle doit respecter —
   * et « Rédhibitoire (<500 m) » en colonne « Caractère » — quand la regle exclut. Les deux
   * s'opposent terme a terme.
   *
   * Ma premiere version prenait la seconde, et le controle de durcissement partait a l'envers :
   * 300 m passait pour un durcissement, 700 m pour un assouplissement. Ce test fige la lecture
   * retenue, parce que rien d'autre ne signalerait l'inversion — les deux formes sont des
   * `ConditionSeuil` parfaitement valides.
   */
  const c = contrainte('eolien_terrestre__eloignement_500_m_des_habitations');
  assert.deepEqual(
    c.regles[0]?.condition,
    { operateur: 'max_strict', valeur: 500, unite: 'm' },
    'la regle redhibitoire porte bien la forme opposee, c’est tout l’enjeu',
  );

  const applique = seuilApplique(
    c,
    'developpeur',
    indexerSeuils([{ contrainteId: c.id, valeur: 700, unite: 'm', motif: 'Marge de negociation' }]),
  );

  assert.equal(applique.origine, 'developpeur');
  assert.deepEqual(applique.conditionReglementaire, { operateur: 'min', valeur: 500, unite: 'm' });
  // Sens ETABLI par le classeur (« ≥ ») : il est recopie, pas redemande.
  assert.equal(sensRequis(c), false);
  assert.deepEqual(applique.condition, { operateur: 'min', valeur: 700, unite: 'm' });
});

test('UNE CONTRAINTE SANS COUCHE NATIONALE RESTE MANUELLE, MEME AVEC UN SEUIL SAISI', () => {
  /*
   * C'est la limite que le seuil developpeur ne peut pas franchir, et il faut qu'elle tienne : la
   * raison est du cote de la DONNEE. Aucune exigence de developpeur ne fabrique la couche SIG qui
   * manque, et appliquer sa valeur sur une grandeur qu'on ne sait pas mesurer produirait un
   * verdict tire de rien.
   */
  const manuelle = CONTRAINTES_REFERENTIEL.find(
    (c) => c.modeEvaluation === 'verification_manuelle' && c.seuilsNumeriques.length > 0,
  );
  assert.ok(manuelle, 'le referentiel doit contenir une contrainte manuelle avec un nombre');

  const applique = seuilApplique(
    manuelle,
    'developpeur',
    indexerSeuils([{ contrainteId: manuelle.id, valeur: 1, unite: 'm', sens: 'min', motif: 'x' }]),
  );

  assert.equal(applique.origine, 'reglementaire');
  assert.equal(applique.condition, null);
  assert.ok(applique.raisons.includes('pas_de_couche_nationale'));
});

test('LE SENS N’EST DEMANDE QUE LA OU LE CLASSEUR NE LE DONNE PAS', () => {
  /*
   * POURQUOI CE TEST EXISTE. Mon extracteur ecrit `egal` quand le texte ne porte aucun symbole de
   * comparaison — ce qui ne veut PAS dire « exactement cette valeur ». Les quatre exemples
   * mesures dans le classeur vont dans les deux sens :
   *
   *   « 500 m par défaut (ou PDA) »       monuments historiques  -> au moins
   *   « Seuil départemental (0,5-4 ha) »  defrichement           -> au plus
   *
   * Un defaut se tromperait donc environ une fois sur deux, en silence. Le sens est demande a
   * l'operateur dans ce cas, et refuse dans l'autre — ou le recopier est la seule facon de ne pas
   * laisser inverser une contrainte.
   */
  const parametrables = contraintesParametrables(CONTRAINTES_REFERENTIEL);
  assert.ok(parametrables.length > 0);

  for (const c of parametrables) {
    const op = conditionDeReference(c)?.operateur;
    assert.equal(
      sensRequis(c),
      op === 'egal',
      `${c.id} : sens demande ${sensRequis(c)} pour un operateur ${op}`,
    );
  }

  // Sans le sens requis, la saisie est IGNOREE plutot qu'appliquee de travers.
  const ambigu = parametrables.find(sensRequis);
  assert.ok(ambigu, 'le classeur doit contenir un seuil au sens non etabli');
  const sansSens = seuilApplique(
    ambigu,
    'developpeur',
    indexerSeuils([{ contrainteId: ambigu.id, valeur: 42, unite: 'm', motif: 'sans sens' }]),
  );
  assert.equal(sansSens.origine, 'reglementaire', 'une saisie incomplete ne doit pas trancher');
});

test('UN SEUIL DEVELOPPEUR NE PEUT QUE DURCIR', () => {
  /*
   * Le cahier des charges dit le seuil reglementaire immuable. L'accepter comme borne basse sans
   * le verifier le rendrait modifiable par la fenetre : un profil saisi a 300 m sur un recul legal
   * de 500 m ferait remonter du foncier que le droit interdit, dans un dossier de prospection.
   */
  const recul = conditionDeReference(contrainte('eolien_terrestre__eloignement_500_m_des_habitations'));
  assert.ok(recul);
  // « ≥ 500 m » : exiger PLUS que 500 m durcit, exiger moins assouplit — et doit etre refuse.
  assert.equal(assouplit(recul, 300), true);
  assert.equal(assouplit(recul, 700), false);

  // Sens inverse : « au plus 10 % de pente » — assouplir, c'est monter.
  assert.equal(assouplit({ operateur: 'max', valeur: 10, unite: '%' }, 15), true);
  assert.equal(assouplit({ operateur: 'max', valeur: 10, unite: '%' }, 6), false);

  // Sens non etabli : on ne refuse rien, faute de savoir de quel cote se trouve l'assouplissement.
  assert.equal(assouplit({ operateur: 'egal', valeur: 100, unite: 'm' }, 50), false);
});

test('LES CONTRAINTES PARAMETRABLES SONT CELLES QU’ON SAIT MESURER', () => {
  const parametrables = contraintesParametrables(CONTRAINTES_REFERENTIEL);

  /*
   * 25 sur 292, et le chiffre est fige : proposer un champ de saisie sur une contrainte qui ne
   * sera jamais mesuree promet un effet qui ne viendra pas, et en retirer une silencieusement
   * priverait l'operateur d'un levier sans que rien ne le dise.
   */
  assert.equal(parametrables.length, 25, `${parametrables.length} contraintes parametrables au lieu de 25`);

  for (const c of parametrables) {
    assert.equal(c.modeEvaluation, 'auto_sig', `${c.id} n’a pas de couche nationale`);
    assert.ok(conditionDeReference(c), `${c.id} n’a aucun nombre de reference`);
    assert.ok(
      !raisonsNonAutomatique(c).includes('pas_de_couche_nationale'),
      `${c.id} : raison contradictoire`,
    );
  }

  // Au moins une par filiere : un profil de recherche vide ne servirait a rien.
  for (const f of ['eolien_terrestre', 'solaire_sol', 'agrivoltaisme', 'bess', 'methanisation']) {
    assert.ok(
      parametrables.some((c) => c.filiere === f),
      `aucune contrainte parametrable pour ${f}`,
    );
  }

  // Le cas du §9.2 en fait partie, bien que son seuil reglementaire soit ambigu : c'est
  // precisement la ou l'exigence du developpeur sert le plus.
  assert.ok(parametrables.some((c) => c.id === ID_TIERS));
});
