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
    /*
     * LES DRAPEAUX AUSSI DOIVENT ETRE POSES. Ils ont ete ajoutes apres cette aide, et l'oubli s'est
     * vu immediatement : la contrainte PPRI devenait « non evaluee » et le « favorable » cessait
     * d'etre atteignable. C'est le test qui a rattrape la fixture, pas l'inverse.
     */
    s.risques.ppri.present = false;
    s.topographie.aleaArgiles = 'nul';
    s.urbanisme.zaer.present = true;
    s.risques.pprif.present = false;
    s.risques.pprt.present = false;
    // Zone 1 : une valeur CONNUE qui ne declenche pas, donc une contrainte respectee et non une
    // donnee manquante — c'est ce que la troisieme voie des drapeaux existe pour dire.
    s.risques.zoneSismique = 1;
    // `aucun` : la couche a repondu, et aucun etablissement SEVESO ne figure dans le rayon.
    s.risques.sevesoProche = { statut: 'aucun', distanceKm: null, nom: null };
    // Les faits du Geoportail : un document publie, aucun EBC, et une zone agricole. Les trois
    // sont des REPONSES — un PLUi n'est pas l'absence de document, et « pas d'EBC sur un
    // territoire couvert » n'est pas « on ne sait pas ».
    s.urbanisme.typeDocument = 'PLUi';
    s.urbanisme.couvertParGpu = true;
    s.urbanisme.presenceEbc = false;
    s.urbanisme.familleZoneDominante = 'A';
    s.risques.servitudesAeronautiques = false;
    s.risques.faisceauxHertziens = false;
    s.topographie.pentePct = 2;
    s.gisement.irradiationKwhM2An = 1350;
    s.acces.distanceVoirieM = 50;
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
      if (c.mode === 'drapeau') continue;
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

  it('les chemins des DRAPEAUX existent dans la forme du releve', () => {
    /*
     * UN DRAPEAU N'EST PAS UNE GRANDEUR, donc il ne figure pas dans les bornes physiques — le
     * controle d'unite ne peut pas s'y appliquer. Mais le laisser sans garde ouvrirait exactement
     * la porte que ce fichier ferme ailleurs : un chemin mal orthographie rend `null`, la
     * contrainte part en « non evaluee », et rien ne signale que la correspondance est morte.
     *
     * On verifie donc que la CLE existe dans la structure produite par `snapshotVide` — y compris
     * quand sa valeur est nulle, ce qui est le cas de tous les drapeaux d'un releve vierge.
     */
    const vide = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
    const cleExiste = (chemin: string): boolean => {
      let courant: unknown = vide;
      for (const segment of chemin.split('.')) {
        if (courant === null || typeof courant !== 'object') return false;
        if (!(segment in (courant as Record<string, unknown>))) return false;
        courant = (courant as Record<string, unknown>)[segment];
      }
      return true;
    };

    const drapeaux = CORRESPONDANCES.filter((c) => c.mode === 'drapeau');
    assert.ok(drapeaux.length > 0, 'le mode drapeau doit etre reellement employe');
    for (const c of drapeaux) {
      for (const chemin of c.chemins) {
        assert.ok(cleExiste(chemin), `${c.contrainteId} : « ${chemin} » n’existe pas au releve`);
      }
      assert.ok(
        c.cheminAbsence === undefined || cleExiste(c.cheminAbsence),
        `${c.contrainteId} : chemin d’absence « ${c.cheminAbsence} » inexistant`,
      );
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
     * 64 contraintes rattachees sur 292. Le chiffre est FIGE : le laisser flotter permettrait a une
     * correspondance retiree de disparaitre sans bruit — et le verdict se mettrait a conclure sur
     * moins de contraintes qu'avant, en silence, ce qui est precisement la faute que ce fichier
     * traque.
     *
     * IL EST PASSE DE 42 A 64 SANS QU'AUCUNE COUCHE NOUVELLE NE SOIT INGEREE, et c'est le resultat
     * le plus utile de ce chantier : 47 des 64 grandeurs du releve ne servaient a AUCUN verdict.
     * Les connecteurs remontaient `risques.ppri.present`, `topographie.pentePct` ou
     * `acces.distanceVoirieM` depuis l'origine — renseignes sur 301 parcelles sur 301 — et aucune
     * contrainte ne les lisait. Le goulot n'etait pas l'ingestion, c'etait cette table.
     *
     * Effet mesure sur la base de reference, en eolien : 230 parcelles « defavorable » contre 301
     * « a instruire » avant. Le recul de 500 m mord enfin, et les 71 parcelles qui restent sont
     * exactement celles mesurees a 500 m ou plus d'une habitation.
     *
     * Les quatre dernieres sont des ATOUTS (zones d'acceleration des ENR) : elles n'entrent pas
     * dans le verdict, mais elles etaient connues de l'application et dites nulle part.
     *
     * PUIS DE 73 A 91, EN DEUX TEMPS ET DE DEUX NATURES DIFFERENTES :
     *
     *   - +4 par INGESTION : zone sismique, etablissement SEVESO le plus proche. Trois faits que
     *     personne n'interrogeait, et qui demandent un appel de plus a Georisques ;
     *   - +14 par RATTACHEMENT de grandeurs deja relevees : type de document d'urbanisme (301/301
     *     depuis l'origine), servitudes aeronautiques et radioelectriques (273/301), famille de
     *     zonage, presence d'EBC.
     *
     * LA SECONDE SERIE CORRIGE UNE AFFIRMATION FAUSSE de ce commentaire. Il disait le gisement des
     * grandeurs dormantes « epuise » apres les 42 premieres correspondances. Mesure refaite :
     * 57 chemins renseignes sur 200 parcelles ou plus ne servaient a aucun verdict. La plupart
     * sont des champs secondaires (`.nom`, `.distanceM` d'un zonage deja lu par sa part de
     * recouvrement), mais pas tous — et une affirmation d'epuisement qu'on ne remesure pas est
     * exactement ce qui fait cesser de chercher.
     */
    assert.equal(CORRESPONDANCES.length, 91, `${CORRESPONDANCES.length} correspondances au lieu de 91`);
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

  it('UNE INFRACTION AU SEUIL REGLEMENTAIRE SUPPOSE UN SEUIL REGLEMENTAIRE', () => {
    /*
     * ═════════════════════════════════════════════════════════════════════════════════════════
     * CE QUE `defavorable` AFFIRME, ET CE QUI PEUT LE PORTER
     * ═════════════════════════════════════════════════════════════════════════════════════════
     *
     * La fiche ecrit, mot pour mot : « une contrainte redhibitoire du referentiel est enfreinte AU
     * SEUIL REGLEMENTAIRE ». C'est une affirmation sur le DROIT, remise a un proprietaire pour
     * justifier qu'on ecarte sa parcelle.
     *
     * Or le classeur range en redhibitoire trois criteres qu'aucun texte ne fonde — et pour cause,
     * ce sont des criteres economiques : « Gisement de vent ≥ ~5-6 m/s (selon machine) »,
     * « Surface / emprise nécessaire », « Accès poids lourds ». Deux d'entre eux sont rattaches au
     * moteur de verdict.
     *
     * CE QUI LES EMPECHE DE TRANCHER, ET CE QUE J'AVAIS D'ABORD CRU. J'ai ecrit une garde dans ce
     * moteur en pensant corriger un defaut ; la mutation correspondante y a survecu, parce que le
     * bloc etait inatteignable. `seuilApplique` annule DEJA la condition des qu'une raison existe,
     * et ces trois lignes en portent une autre : seuil approximatif, extraction incomplete. Mesure
     * faite ensuite : AUCUNE des 22 contraintes sans reference n'etait decisive.
     *
     * La protection existait donc, mais par accident. Ce test la rend explicite et verifiable, et
     * `aucun_fondement_cite` s'ajoute aux motifs — de sorte qu'une contrainte sans texte dont le
     * seuil serait par ailleurs ferme ne puisse plus, structurellement, fermer une parcelle.
     */
    const id = 'eolien_terrestre__gisement_de_vent';
    const contrainte = contrainteParId(id);
    assert.ok(contrainte, 'la contrainte temoin doit exister dans le referentiel');
    assert.equal(contrainte.caractere, 'redhibitoire', 'le classeur la classe bien redhibitoire');
    assert.equal(
      contrainte.referenceReglementaire.trim(),
      '\u2014',
      'et elle ne cite aucun texte : c’est tout le probleme',
    );

    // Un vent nettement sous le seuil du classeur : la mesure est FAITE, et elle ne passe pas.
    const faible = evaluerVerdict(
      parcelle((s) => {
        s.gisement.ventVitesse100mMs = 3;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const evaluee = faible.contraintes.find((c) => c.contrainteId === id);
    assert.ok(evaluee);
    assert.equal(
      evaluee.etat,
      'a_verifier',
      'une contrainte sans fondement ne peut pas etre declaree enfreinte',
    );
    assert.equal(evaluee.valeurMesuree, 3, 'la valeur mesuree est restituee : l’operateur juge');
    assert.ok(
      evaluee.raisons.includes('aucun_fondement_cite'),
      `la raison doit etre dite : ${evaluee.raisons.join(', ')}`,
    );
    assert.ok(
      !faible.contraintes.some((c) => c.contrainteId === id && c.etat === 'enfreinte'),
      'et elle ne doit peser sur aucun verdict',
    );

    /*
     * LE CONTRE-EXEMPLE, SANS LEQUEL CE TEST NE PROUVERAIT RIEN. Une regle qui ne laisserait plus
     * rien trancher serait pire que le defaut : le recul de 500 m, lui, porte un article et un
     * seuil ferme, et il DOIT continuer de rendre une parcelle defavorable.
     */
    const trop = evaluerVerdict(
      parcelle((s) => {
        s.bati.distanceHabitationM = 300;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const recul = trop.contraintes.find((c) => c.contrainteId === ID_RECUL);
    assert.ok(recul);
    assert.equal(recul.etat, 'enfreinte', 'un seuil ferme et fonde tranche toujours');
    assert.equal(trop.verdict, 'defavorable');
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
    // Et rien ne se perd entre les TROIS listes : contraintes, procedures, atouts.
    assert.equal(
      r.contraintes.length + r.cadres.length + r.atouts.length,
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

describe('un drapeau se lit en TROIS etats, jamais deux', () => {
  const ID_PPRI = 'eolien_terrestre__ppri_inondation';

  it('l’ABSENCE de plan sur la commune etablit que la contrainte est respectee', () => {
    /*
     * C'EST LE CAS LE PLUS FREQUENT, et il etait perdu. Sur la base de reference,
     * `risques.ppri.present` vaut `false` sur les 301 parcelles : le fait est connu, mesure, et la
     * contrainte etait pourtant comptee « non evaluee ».
     */
    const r = evaluerVerdict(
      parcelle((s) => {
        s.risques.ppri.present = false;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const ppri = r.contraintes.find((c) => c.contrainteId === ID_PPRI);
    assert.ok(ppri);
    assert.equal(ppri.etat, 'respectee');
  });

  it('un plan PRESENT sur la commune ne vaut PAS interdiction sur la parcelle', () => {
    /*
     * LA CONFUSION QU'IL FALLAIT EVITER. `present` est au niveau COMMUNE, `severitePlan` au niveau
     * PARCELLE. Traiter le premier comme un verdict rendrait redhibitoire toute parcelle d'une
     * commune dotee d'un PPRI — des milliers de parcelles constructibles ecartees d'un coup, sans
     * qu'aucune erreur ne soit levee.
     */
    const r = evaluerVerdict(
      parcelle((s) => {
        s.risques.ppri.present = true;
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const ppri = r.contraintes.find((c) => c.contrainteId === ID_PPRI);
    assert.ok(ppri);
    assert.equal(ppri.etat, 'a_verifier', 'un plan sur la commune ne dit rien de la parcelle');
    assert.notEqual(r.verdict, 'defavorable');
  });

  it('une severite d’INTERDICTION sur la parcelle, elle, tranche', () => {
    const r = evaluerVerdict(
      parcelle((s) => {
        s.risques.ppri.present = true;
        s.risques.ppri.severitePlan = 'interdiction_stricte';
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const ppri = r.contraintes.find((c) => c.contrainteId === ID_PPRI);
    assert.ok(ppri);
    assert.equal(ppri.etat, 'enfreinte');
    assert.equal(r.verdict, 'defavorable', 'la contrainte est redhibitoire au classeur');
  });

  it('« prescriptions » autorise sous conditions : ni infraction, ni feu vert', () => {
    const r = evaluerVerdict(
      parcelle((s) => {
        s.risques.ppri.present = true;
        s.risques.ppri.severitePlan = 'prescriptions';
      }),
      'eolien_terrestre',
      'reglementaire',
    );
    const ppri = r.contraintes.find((c) => c.contrainteId === ID_PPRI);
    assert.ok(ppri);
    assert.equal(ppri.etat, 'a_verifier');
  });

  it('rien du tout reste « non evaluee »', () => {
    const r = evaluerVerdict(parcelle(), 'eolien_terrestre', 'reglementaire');
    const ppri = r.contraintes.find((c) => c.contrainteId === ID_PPRI);
    assert.ok(ppri);
    assert.equal(ppri.etat, 'donnee_absente', 'sans donnee, on ne conclut pas');
  });
});

describe('un atout n’est pas une contrainte', () => {
  const ID_ZAER = 'solaire_sol__zones_d_acceleration_enr_zaenr';

  it('etre hors ZAEnR ne degrade PAS le verdict', () => {
    /*
     * LE DEFAUT QUE CE MODELE EMPECHE. Le classeur note ces lignes « favorable » — « en ZAEnR =
     * bonus » — et toutes les communes n'ont pas delibere. Compter l'absence de bonus parmi les
     * enfreintes ferait passer « a instruire » une parcelle simplement moins avantageuse, et
     * permettrait meme de la NOMMER comme contrainte decisive.
     *
     * Le germe existait deja : `methanisation__superficie_de_la_parcelle` etait rattachee et de
     * niveau favorable. Elle ne mordait pas encore — son seuil est au sens non etabli — mais elle
     * aurait mordu des qu'un seuil ferme lui aurait ete donne.
     */
    const dans = evaluerVerdict(
      parcelle((s) => {
        s.urbanisme.zaer.present = true;
      }),
      'solaire_sol',
      'reglementaire',
    );
    const hors = evaluerVerdict(
      parcelle((s) => {
        s.urbanisme.zaer.present = false;
      }),
      'solaire_sol',
      'reglementaire',
    );

    assert.equal(hors.verdict, dans.verdict, 'le bonus ne change pas la conformite au droit');
    assert.equal(hors.couverture.enfreintes, dans.couverture.enfreintes);
  });

  it('l’atout est tout de meme EVALUE et rendu, car le dossier s’en sert', () => {
    const dans = evaluerVerdict(
      parcelle((s) => {
        s.urbanisme.zaer.present = true;
      }),
      'solaire_sol',
      'reglementaire',
    );
    const zaer = dans.atouts.find((c) => c.contrainteId === ID_ZAER);
    assert.ok(zaer, 'la ZAEnR doit figurer parmi les atouts');
    assert.equal(zaer.etat, 'respectee', 'en ZAEnR, le bonus s’applique');

    const hors = evaluerVerdict(
      parcelle((s) => {
        s.urbanisme.zaer.present = false;
      }),
      'solaire_sol',
      'reglementaire',
    );
    assert.equal(hors.atouts.find((c) => c.contrainteId === ID_ZAER)?.etat, 'enfreinte');
  });

  it('aucune ligne « favorable » ne se retrouve parmi les contraintes du verdict', () => {
    const r = evaluerVerdict(parcelleSansRien('methanisation'), 'methanisation', 'reglementaire');
    for (const c of r.contraintes) {
      assert.notEqual(c.caractere, 'favorable', `${c.contrainteId} est un atout, pas une contrainte`);
    }
    // Et rien ne se perd entre les trois listes.
    assert.equal(
      r.contraintes.length + r.cadres.length + r.atouts.length,
      contraintesDeFiliere('methanisation').length,
    );
  });
});

describe('le meme alea, cinq seuils differents selon la filiere', () => {
  /*
   * LE CAS QUI MONTRE POURQUOI ON NE RECOPIE PAS UNE LIGNE POUR CINQ FILIERES. Le classeur retient
   * « Aléa fort » pour le retrait-gonflement des argiles en eolien, agrivoltaisme et methanisation
   * — ces projets se fondent profond — mais « Aléa moyen/fort » en solaire au sol et en BESS, ou
   * les structures sont legeres et posees.
   *
   * Aplatir les cinq sur un seuil unique trahirait le classeur DANS LES DEUX SENS : trop severe
   * pour trois filieres, trop permissif pour deux. Et l'ecart porte sur du reel — sur la base de
   * reference, 52 parcelles sur 301 sont en alea « moyen ».
   */
  const ALEA_MOYEN = (s: ParcelleSnapshot): void => {
    s.topographie.aleaArgiles = 'moyen';
  };
  const idRga = (filiere: string): string => `${filiere}__retrait_gonflement_des_argiles_rga`;

  it('un alea MOYEN penalise le solaire et le BESS, et eux seuls', () => {
    for (const filiere of ['solaire_sol', 'bess'] as const) {
      const r = evaluerVerdict(parcelle(ALEA_MOYEN), filiere, 'reglementaire');
      const rga = r.contraintes.find((c) => c.contrainteId === idRga(filiere));
      assert.ok(rga, `${filiere} : la contrainte RGA doit etre evaluee`);
      assert.equal(rga.etat, 'enfreinte', `${filiere} retient « Aléa moyen/fort »`);
    }

    for (const filiere of ['eolien_terrestre', 'agrivoltaisme', 'methanisation'] as const) {
      const r = evaluerVerdict(parcelle(ALEA_MOYEN), filiere, 'reglementaire');
      const rga = r.contraintes.find((c) => c.contrainteId === idRga(filiere));
      assert.ok(rga, `${filiere} : la contrainte RGA doit etre evaluee`);
      assert.equal(rga.etat, 'respectee', `${filiere} ne retient que « Aléa fort »`);
    }
  });

  it('un alea FORT penalise les cinq filieres', () => {
    for (const filiere of ['solaire_sol', 'bess', 'eolien_terrestre', 'agrivoltaisme', 'methanisation'] as const) {
      const r = evaluerVerdict(
        parcelle((s) => {
          s.topographie.aleaArgiles = 'fort';
        }),
        filiere,
        'reglementaire',
      );
      assert.equal(r.contraintes.find((c) => c.contrainteId === idRga(filiere))?.etat, 'enfreinte');
    }
  });

  it('un alea NUL n’en penalise aucune, et c’est un fait mesure', () => {
    for (const filiere of ['solaire_sol', 'eolien_terrestre'] as const) {
      const r = evaluerVerdict(
        parcelle((s) => {
          s.topographie.aleaArgiles = 'nul';
        }),
        filiere,
        'reglementaire',
      );
      const rga = r.contraintes.find((c) => c.contrainteId === idRga(filiere));
      // `respectee`, et non `donnee_absente` : « nul » est une reponse, pas une absence.
      assert.equal(rga?.etat, 'respectee');
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
