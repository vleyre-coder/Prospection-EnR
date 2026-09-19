/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE MOTEUR DE VERDICT — et la faute qu'il existe pour rendre impossible
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LA FAUTE. Conclure « favorable » sur ce qu'on n'a pas regarde. Elle est parfaitement muette : la
 * parcelle sort en tete de liste, part dans un dossier remis a un developpeur, et rien nulle part
 * ne dit que quarante-neuf des cinquante-deux contraintes de sa filiere n'ont jamais ete evaluees.
 * Une donnee absente doit donc valoir « a instruire », jamais « rien a signaler » — et c'est ce que
 * la moitie de ce fichier verifie, sous plusieurs angles, parce qu'un seul angle laisserait passer
 * la regression par un autre.
 *
 * L'AUTRE MOITIE porte sur la TRACABILITE, qui est une demande explicite du cahier des charges :
 * un verdict doit dire quel seuil a ete applique, d'ou il vient, et lequel a fait basculer la
 * parcelle. Sans quoi l'operateur ne peut pas repondre a la seule question qu'un developpeur pose :
 * « pourquoi celle-la est-elle ecartee, et est-ce negociable ? ».
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BORNES_SNAPSHOT,
  CONTRAINTES_REFERENTIEL,
  contrainteParId,
  contraintesDeFiliere,
  identiteDepuisIdu,
  indexerSeuils,
  snapshotVide,
  type ParcelleSnapshot,
} from '@enr/core';
import {
  CORRESPONDANCES,
  conditionRespectee,
  evaluerVerdict,
  expliquerContrainte,
  valeurAuChemin,
} from '../dist/index.js';

/** Le cas nomme par le §9.2 du cahier des charges. */
const ID_TIERS = 'methanisation__distance_d_implantation_aux_tiers_habitations_erp';
/** Recul eolien : seuil ferme (« ≥ 500 m »), donc il tranche seul. */
const ID_RECUL = 'eolien_terrestre__eloignement_500_m_des_habitations';
/** Interdiction en cœur de parc national : redhibitoire, de type presence. */
const ID_COEUR = 'eolien_terrestre__parc_national_c_ur';

function parcelle(regler: (s: ParcelleSnapshot) => void = () => {}): ParcelleSnapshot {
  const s = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  regler(s);
  return s;
}

/**
 * Une parcelle dont TOUTES les contraintes rattachees sont renseignees et respectees.
 *
 * Elle existe pour un seul test — celui qui exige qu'un « favorable » soit atteignable. Sans lui,
 * un moteur qui repondrait « a instruire » a tout et n'importe quoi passerait tous les autres
 * tests de ce fichier sans qu'aucun ne bronche.
 */
function parcelleSansRien(filiere: 'eolien_terrestre' | 'methanisation'): ParcelleSnapshot {
  return parcelle((s) => {
    s.bati.distanceHabitationM = 2000;
    s.bati.distanceZoneHabitatM = 2000;
    s.patrimoine.monumentHistorique.distanceM = 3000;
    s.gisement.ventVitesse100mMs = 7;
    s.eau.distanceCoursEauM = 500;
    s.foncier.surfaceDunSeulTenantHa = 20;
    s.raccordement.reseauGaz.distanceCanalisationKm = 0.5;
    /*
     * `posteLePlusProche` est NULL dans un releve vierge, et non un objet aux champs nuls : une
     * parcelle peut n'avoir aucun poste connu. Le moteur traverse ce null sans broncher — c'est
     * teste plus bas — mais un test qui ecrirait dedans planterait, ce qu'il a fait.
     */
    s.raccordement.posteLePlusProche = {
      nom: 'Poste de test',
      distanceKm: 1,
      capaciteResiduelleMw: 40,
      fileAttenteMw: 0,
      quotePartEurParKw: 60,
      tauxAffectation: null,
      codeGestionnaire: null,
      dateEtat: null,
    } as (typeof s.raccordement)['posteLePlusProche'];
    for (const couche of [
      s.milieux.natura2000Habitats,
      s.milieux.natura2000Oiseaux,
      s.milieux.znieff1,
      s.milieux.znieff2,
      s.milieux.appb,
      s.milieux.reserveNaturelle,
      s.milieux.coeurParcNational,
      s.milieux.parcNaturelRegional,
      s.patrimoine.spr,
    ]) {
      couche.partRecouvrement = 0;
    }
    void filiere;
  });
}

describe('la table de correspondance', () => {
  it('ne branche une contrainte que sur une grandeur de la MEME unite', () => {
    /*
     * LE GARDE LE PLUS IMPORTANT DE CE FICHIER, et il vient d'une erreur reelle. Rapprocher les
     * deux listes par motifs sur les noms paraissait excellent — 90 contraintes rattachees en
     * quelques lignes — et produisait des correspondances fausses qui ne levaient rien :
     * « rayon économique de 15 km » branche sur un TONNAGE, « 7 m des limites parcellaires »
     * branche sur la distance a l'habitation. Une correspondance fausse rend un nombre, il se
     * compare, et le verdict sort.
     */
    const bornes = new Map(BORNES_SNAPSHOT.map((b) => [b.chemin, b]));
    for (const c of CORRESPONDANCES) {
      for (const chemin of c.chemins) {
        const borne = bornes.get(chemin);
        assert.ok(borne, `${c.contrainteId} : chemin inconnu du releve « ${chemin} »`);
        assert.equal(
          borne.unite,
          c.unite,
          `${c.contrainteId} : « ${chemin} » est en ${borne.unite}, la correspondance annonce ${c.unite}`,
        );
      }
    }
  });

  it('ne rattache que des contraintes reelles, evaluables, et jamais deux fois', () => {
    const vus = new Set<string>();
    for (const c of CORRESPONDANCES) {
      const contrainte = contrainteParId(c.contrainteId);
      assert.ok(contrainte, `contrainte inconnue : ${c.contrainteId}`);
      assert.equal(
        contrainte.modeEvaluation,
        'auto_sig',
        `${c.contrainteId} n'a pas de couche nationale : la rattacher promet une mesure impossible`,
      );
      // Une contrainte `cadre` est une procedure applicable a tout projet, pas un jugement sur la
      // parcelle. La rattacher la ferait entrer dans le verdict, qu'elle mettrait a plat.
      assert.notEqual(contrainte.caractere, 'cadre', `${c.contrainteId} est une procedure, pas une contrainte`);
      assert.ok(!vus.has(c.contrainteId), `correspondance en double : ${c.contrainteId}`);
      vus.add(c.contrainteId);
      assert.ok(c.chemins.length > 0, `${c.contrainteId} : aucun chemin`);
      assert.ok(c.justification.length > 20, `${c.contrainteId} : justification absente ou trop courte`);
    }
  });

  it('annonce une couverture qui ne se surestime pas', () => {
    /*
     * 42 contraintes rattachees sur 292. Le chiffre est FIGE, et volontairement modeste : il dit
     * ce que le releve sait reellement mesurer aujourd'hui. Le laisser flotter permettrait a une
     * correspondance retiree de disparaitre sans bruit — et le verdict se mettrait a conclure sur
     * moins de contraintes qu'avant, en silence, ce qui est precisement la faute que ce fichier
     * traque.
     */
    assert.equal(CORRESPONDANCES.length, 42, `${CORRESPONDANCES.length} correspondances au lieu de 42`);
    // Et chaque filiere en a au moins une : un verdict qui ne regarderait rien pour une filiere
    // entiere rendrait « a instruire » a tout, ce qui ne distingue rien.
    for (const f of ['eolien_terrestre', 'solaire_sol', 'agrivoltaisme', 'bess', 'methanisation'] as const) {
      assert.ok(
        CORRESPONDANCES.some((c) => c.contrainteId.startsWith(`${f}__`)),
        `aucune correspondance pour ${f}`,
      );
    }
  });
});

describe('une donnee absente ne vaut jamais « rien a signaler »', () => {
  it('un releve vide rend « a instruire », jamais « favorable »', () => {
    const r = evaluerVerdict(parcelle(), 'methanisation', 'reglementaire');

    assert.equal(r.verdict, 'a_instruire');
    assert.ok(r.couverture.donneesAbsentes > 0, 'un releve vide doit laisser des contraintes non evaluees');
    assert.equal(r.couverture.enfreintes, 0, 'rien n’est enfreint : rien n’a ete mesure');
    // Et le compte dit la verite : total = somme des etats.
    const { total, respectees, enfreintes, aVerifier, donneesAbsentes } = r.couverture;
    assert.equal(respectees + enfreintes + aVerifier + donneesAbsentes, total);
  });

  it('un zonage NON CROISE ne compte pas comme un zonage ABSENT', () => {
    /*
     * LA DISTINCTION LA PLUS FACILE A PERDRE DE TOUT LE MOTEUR. Une parcelle hors de tout zonage et
     * une parcelle jamais croisee avec les couches donnent le meme « aucun recouvrement ». Les
     * confondre declarerait conforme ce qui n'a pas ete regarde — et le ferait pour les contraintes
     * REDHIBITOIRES, celles qui interdisent.
     */
    const jamaisCroisee = evaluerVerdict(parcelle(), 'eolien_terrestre', 'reglementaire');
    const coeur = jamaisCroisee.contraintes.find((c) => c.contrainteId === ID_COEUR);
    assert.ok(coeur);
    assert.equal(coeur.etat, 'donnee_absente', 'une part non renseignee n’est pas un zonage absent');

    const croisee = evaluerVerdict(
      parcelle((s) => {
        s.milieux.coeurParcNational.partRecouvrement = 0;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const coeurMesure = croisee.contraintes.find((c) => c.contrainteId === ID_COEUR);
    assert.ok(coeurMesure);
    assert.equal(coeurMesure.etat, 'respectee', 'une part mesuree a zero est un zonage reellement absent');
  });

  it('« favorable » reste atteignable quand tout est mesure et respecte', () => {
    /*
     * Le test qui empeche les precedents de devenir vides de sens. Un moteur qui repondrait
     * « a instruire » a tout les passerait tous — et ne servirait a rien.
     */
    const r = evaluerVerdict(parcelleSansRien('eolien_terrestre'), 'eolien_terrestre', 'reglementaire');
    const nonEvaluees = r.contraintes.filter((c) => c.etat === 'donnee_absente');

    // Toutes les contraintes RATTACHEES sont evaluees ; celles qui ne le sont pas restent a
    // instruire, et c'est le comportement voulu — le referentiel depasse ce que le releve mesure.
    const rattachees = new Set(CORRESPONDANCES.map((c) => c.contrainteId));
    for (const c of r.contraintes) {
      if (rattachees.has(c.contrainteId)) {
        assert.notEqual(c.etat, 'donnee_absente', `${c.contrainteId} est rattachee mais non evaluee`);
      }
    }
    assert.ok(nonEvaluees.length > 0, 'le referentiel couvre plus que ce que le releve mesure, et le dit');
    assert.ok(r.couverture.respectees >= 9, `seulement ${r.couverture.respectees} contraintes respectees`);
  });
});

describe('les procedures ne sont pas des contraintes', () => {
  it('les lignes « cadre » sont rendues a part et n’entrent pas dans le verdict', () => {
    /*
     * Un permis de construire est requis pour TOUT projet. Le compter comme une penalite mettrait
     * chaque parcelle « a instruire » pour une formalite universelle, et le verdict cesserait de
     * distinguer quoi que ce soit.
     */
    const r = evaluerVerdict(parcelleSansRien('eolien_terrestre'), 'eolien_terrestre', 'reglementaire');

    assert.ok(r.cadres.length > 0, 'la filiere porte des procedures applicables a tout projet');
    for (const c of r.cadres) assert.equal(c.etat, 'cadre');
    for (const c of r.contraintes) assert.notEqual(c.caractere, 'cadre');
    // Et rien ne se perd entre les deux listes.
    assert.equal(
      r.contraintes.length + r.cadres.length,
      contraintesDeFiliere('eolien_terrestre').length,
    );
  });
});

describe('l’agregation ne compense jamais une interdiction', () => {
  it('une seule contrainte redhibitoire enfreinte rend « defavorable »', () => {
    const r = evaluerVerdict(
      parcelle((s) => {
        s.milieux.coeurParcNational.partRecouvrement = 0.4;
      }),
      'eolien_terrestre',
      'reglementaire',
    );

    assert.equal(r.verdict, 'defavorable');
    assert.equal(r.contrainteDecisive?.contrainteId, ID_COEUR);
    assert.equal(r.contrainteDecisive?.caractere, 'redhibitoire');
  });

  it('la contrainte decisive est une ENFREINTE, pas une simple lacune', () => {
    /*
     * Un fait etabli prime une donnee manquante. Nommer « non evaluée » comme cause quand une
     * interdiction est par ailleurs constatee ferait chercher l'operateur au mauvais endroit.
     */
    const r = evaluerVerdict(
      parcelle((s) => {
        s.milieux.coeurParcNational.partRecouvrement = 1;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    assert.equal(r.contrainteDecisive?.etat, 'enfreinte');
    assert.ok(r.couverture.donneesAbsentes > 0, 'il reste par ailleurs des lacunes, et c’est le sel du test');
  });

  it('un seuil penalisant enfreint rend « a instruire », pas « defavorable »', () => {
    const contrainte = CONTRAINTES_REFERENTIEL.find(
      (c) => c.id === 'eolien_terrestre__znieff_type_i',
    );
    assert.ok(contrainte);
    assert.equal(contrainte.caractere, 'penalisant');

    const r = evaluerVerdict(
      parcelle((s) => {
        s.milieux.znieff1.partRecouvrement = 0.8;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    assert.notEqual(r.verdict, 'defavorable', 'une ZNIEFF I n’interdit pas, elle alourdit l’instruction');
    assert.equal(r.verdict, 'a_instruire');
  });
});

describe('§2.3 — le verdict dit quel seuil l’a produit', () => {
  it('le mode 1 evalue au reglementaire, meme avec un seuil developpeur saisi', () => {
    const seuils = indexerSeuils([
      { contrainteId: ID_RECUL, valeur: 1500, unite: 'm', motif: 'Politique interne' },
    ]);
    const s = parcelle((x) => {
      x.bati.distanceHabitationM = 800;
    });

    const mode1 = evaluerVerdict(s, 'eolien_terrestre', 'reglementaire', seuils);
    const recul = mode1.contraintes.find((c) => c.contrainteId === ID_RECUL);
    assert.ok(recul);

    // 800 m respecte les 500 m du droit, et doit rester respecte malgre l'exigence de 1 500 m.
    assert.equal(recul.origineSeuil, 'reglementaire');
    assert.equal(recul.etat, 'respectee');
    assert.deepEqual(recul.condition, { operateur: 'min', valeur: 500, unite: 'm' });
  });

  it('le mode 2 evalue au seuil developpeur, et nomme les DEUX valeurs', () => {
    const seuils = indexerSeuils([
      { contrainteId: ID_RECUL, valeur: 1500, unite: 'm', motif: 'Politique interne : 1,5 km' },
    ]);
    const s = parcelle((x) => {
      x.bati.distanceHabitationM = 800;
    });

    const mode2 = evaluerVerdict(s, 'eolien_terrestre', 'developpeur', seuils);
    const recul = mode2.contraintes.find((c) => c.contrainteId === ID_RECUL);
    assert.ok(recul);

    assert.equal(recul.origineSeuil, 'developpeur');
    assert.equal(recul.etat, 'enfreinte', '800 m ne satisfait pas une exigence de 1 500 m');
    assert.deepEqual(recul.condition, { operateur: 'min', valeur: 1500, unite: 'm' });
    // LA moitie de phrase qui rend l'ecart negociable : ce que le droit demande, lui.
    assert.deepEqual(recul.conditionReglementaire, { operateur: 'min', valeur: 500, unite: 'm' });
    assert.equal(recul.motifDeveloppeur, 'Politique interne : 1,5 km');

    const phrase = expliquerContrainte(recul);
    assert.match(phrase, /seuil développeur \(au moins 1500 m\)/);
    assert.match(phrase, /la réglementation, elle, demande/);
  });

  it('§9.2 — methanisation, 100 / 200 m au classeur contre 400 m developpeur', () => {
    const s = parcelle((x) => {
      x.bati.distanceHabitationM = 250;
    });

    /*
     * Au seuil reglementaire, la contrainte NE TRANCHE PAS : le classeur porte deux regimes ICPE
     * dans la meme cellule, et le seuil applicable depend du tonnage, donc du projet. Conclure
     * « respectee » sur 250 m serait faux pour un projet en enregistrement.
     */
    const mode1 = evaluerVerdict(s, 'methanisation', 'reglementaire');
    const tiers1 = mode1.contraintes.find((c) => c.contrainteId === ID_TIERS);
    assert.ok(tiers1);
    assert.equal(tiers1.etat, 'a_verifier');
    assert.equal(tiers1.valeurMesuree, 250, 'la grandeur est mesuree, meme si le seuil ne tranche pas');
    assert.match(expliquerContrainte(tiers1), /à vérifier/);

    // L'exigence du developpeur, elle, est ferme : elle tranche ce que le referentiel laisse ouvert.
    const seuils = indexerSeuils([
      { contrainteId: ID_TIERS, valeur: 400, unite: 'm', sens: 'min', motif: '400 m de toute habitation' },
    ]);
    const mode2 = evaluerVerdict(s, 'methanisation', 'developpeur', seuils);
    const tiers2 = mode2.contraintes.find((c) => c.contrainteId === ID_TIERS);
    assert.ok(tiers2);
    assert.equal(tiers2.etat, 'enfreinte');
    assert.equal(tiers2.origineSeuil, 'developpeur');

    /*
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     * UN ECART AU CAHIER DES CHARGES N'EST PAS UNE PARCELLE DEFAVORABLE
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     *
     * La contrainte est de niveau REDHIBITOIRE au classeur, et mon premier moteur en concluait
     * « defavorable » — sans regarder quel seuil avait ete enfreint. Or a 250 m cette parcelle est
     * parfaitement conforme au droit : 100 m en declaration, 200 m en enregistrement. Seule
     * l'exigence de 400 m du developpeur n'est pas satisfaite.
     *
     * L'operateur aurait donc annonce « ce terrain est defavorable » quand la loi dit l'inverse,
     * et le developpeur suivant — moins exigeant — n'aurait jamais vu la parcelle. Le verdict ne
     * repond qu'a la question reglementaire ; l'ecart au cahier des charges se dit a part.
     */
    assert.notEqual(mode2.verdict, 'defavorable', 'seule l’exigence du developpeur n’est pas tenue');
    assert.equal(mode2.verdict, 'a_instruire');
    assert.deepEqual(
      mode2.ecartsCahierDesCharges.map((c) => c.contrainteId),
      [ID_TIERS],
      'l’ecart doit etre nomme, pour que la recherche puisse filtrer dessus',
    );
    assert.equal(
      mode2.contrainteDecisive?.contrainteId,
      ID_TIERS,
      'c’est bien elle que l’operateur doit citer',
    );

    // Et le mode 1 ne connait aucun ecart de ce genre : il ne lit pas le cahier des charges.
    assert.deepEqual(mode1.ecartsCahierDesCharges, []);
  });
});

describe('conformite au droit et adequation au cahier des charges sont deux axes', () => {
  it('une infraction au seuil REGLEMENTAIRE rend « defavorable »', () => {
    /*
     * Le pendant du test du §9.2 : ici c'est bien le droit qui n'est pas respecte — 300 m la ou
     * l'article L515-44 en exige 500 — et la parcelle est reellement inconstructible.
     */
    const r = evaluerVerdict(
      parcelle((s) => {
        s.bati.distanceHabitationM = 300;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    assert.equal(r.verdict, 'defavorable');
    assert.equal(r.contrainteDecisive?.contrainteId, ID_RECUL);
    assert.deepEqual(r.ecartsCahierDesCharges, [], 'aucun cahier des charges n’est en jeu');
  });

  it('un durcissement developpeur n’aggrave jamais le verdict reglementaire', () => {
    /*
     * La meme parcelle, evaluee dans les deux modes, doit rendre le MEME verdict reglementaire.
     * Un profil ouvert ne doit pas pouvoir rendre une parcelle « moins conforme » qu'elle ne l'est.
     */
    const s = parcelle((x) => {
      x.bati.distanceHabitationM = 800;
    });
    const seuils = indexerSeuils([
      { contrainteId: ID_RECUL, valeur: 1500, unite: 'm', motif: 'Politique interne' },
    ]);

    const mode1 = evaluerVerdict(s, 'eolien_terrestre', 'reglementaire', seuils);
    const mode2 = evaluerVerdict(s, 'eolien_terrestre', 'developpeur', seuils);

    assert.equal(mode2.verdict, mode1.verdict, 'le verdict reglementaire ne bouge pas avec le profil');
    assert.equal(mode2.ecartsCahierDesCharges.length, 1, 'mais l’ecart au cahier des charges est dit');
    assert.equal(mode2.ecartsCahierDesCharges[0]?.contrainteId, ID_RECUL);
  });
});

describe('un seuil au sens non etabli ne tranche pas', () => {
  it('les abords de monument historique partent « a verifier », jamais « enfreinte »', () => {
    /*
     * TROUVE PAR MUTATION, ET LE DEFAUT ETAIT ENORME. Retirer la garde `egal` de `evaluerSeuil`
     * ne faisait echouer aucun test — alors que la branche couvre SIX contraintes rattachees,
     * dont les abords de monuments historiques des cinq filieres.
     *
     * Sans elle, la comparaison retombe sur l'egalite stricte : une parcelle serait « conforme »
     * uniquement si le monument le plus proche se trouve a 500,000 m — et « en infraction »
     * partout ailleurs. Autrement dit, la quasi-totalite du foncier francais ecarte sur les
     * monuments historiques, sans qu'aucune erreur ne soit levee.
     *
     * Le classeur dit « 500 m par défaut (ou PDA) » : il ne precise pas si c'est un plancher ou
     * un plafond, et un perimetre delimite peut remplacer les 500 m. Le moteur s'abstient donc, et
     * restitue la mesure pour que l'operateur juge sur piece.
     */
    const ID_MH = 'eolien_terrestre__monuments_historiques_abords_pda_500_m';

    for (const distance of [120, 500, 4000]) {
      const r = evaluerVerdict(
        parcelle((s) => {
          s.patrimoine.monumentHistorique.distanceM = distance;
        }),
        'eolien_terrestre',
        'reglementaire',
      );
      const mh = r.contraintes.find((c) => c.contrainteId === ID_MH);
      assert.ok(mh, 'la contrainte des abords doit etre evaluee');
      assert.equal(mh.etat, 'a_verifier', `a ${distance} m, le moteur ne doit pas trancher`);
      assert.equal(mh.valeurMesuree, distance, 'la mesure est restituee, meme sans conclusion');
      assert.match(expliquerContrainte(mh), /à vérifier/);
    }
  });
});

describe('les primitives de mesure', () => {
  it('lit un chemin pointe, et rend null plutot que de deviner', () => {
    const s = parcelle((x) => {
      x.bati.distanceHabitationM = 42;
    });
    assert.equal(valeurAuChemin(s, 'bati.distanceHabitationM'), 42);
    assert.equal(valeurAuChemin(s, 'bati.chemin.inexistant'), null);
    assert.equal(valeurAuChemin(s, 'identite.nomCommune'), null, 'une chaine n’est pas une mesure');
  });

  it('compare dans le bon sens, bornes ouvertes comprises', () => {
    assert.equal(conditionRespectee({ operateur: 'min', valeur: 500, unite: 'm' }, 500), true);
    assert.equal(conditionRespectee({ operateur: 'min_strict', valeur: 500, unite: 'm' }, 500), false);
    assert.equal(conditionRespectee({ operateur: 'max', valeur: 10, unite: '%' }, 10), true);
    assert.equal(conditionRespectee({ operateur: 'max_strict', valeur: 10, unite: '%' }, 10), false);
    /*
     * `egal` ne veut pas dire « exactement cette valeur » mais « sens non etabli ». Le comparer a
     * l'egalite stricte ne serait vrai pour personne et viderait la liste en silence : le moteur
     * met la contrainte « a verifier » au lieu de conclure.
     */
    assert.equal(conditionRespectee({ operateur: 'egal', valeur: 100, unite: 'm' }, 100), false);
  });
});
