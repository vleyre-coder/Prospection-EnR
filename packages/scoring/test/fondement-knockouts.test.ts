/**
 * Le fondement juridique de chaque knock-out, verifie EN DECLENCHANT le knock-out.
 *
 * POURQUOI CE FICHIER EXISTE. Un knock-out ECARTE une parcelle, et son motif part dans le rapport PDF
 * remis au proprietaire, sous la mention « Fondement : … ». Deux defauts de cette famille ont deja ete
 * trouves :
 *
 *   - chantier C : « Fondement : eol_distance_habitation » — une cle de code donnee comme base juridique ;
 *   - verification de couverture : `ko_eol_servitude_aero` — une servitude aeronautique de degagement
 *     fondee sur l'arrete du 26 aout 2011 relatif aux RADARS. Deux contraintes distinctes, deux regimes
 *     distincts. La reference n'etait pas une cle technique cette fois : elle etait simplement FAUSSE, et
 *     rien ne pouvait le voir puisqu'elle appartenait bien a la famille eolienne.
 *
 * POURQUOI PAR EXECUTION, ET NON EN RELISANT LA SOURCE. Ma premiere version cherchait les appels `ko(...)`
 * dans le fichier et en extrayait les arguments par expression reguliere. Elle a echoue, et pour une
 * bonne raison : plusieurs knock-outs recoivent leur identifiant et leur fondement par VARIABLE — les
 * protections fortes et les plans de risque sont produits par des regles parametrees. Une lecture de
 * source ne voit que des litteraux, elle est donc aveugle a une partie du sujet. Declencher reellement
 * chaque knock-out et lire ce qu'il produit est insensible a la facon dont le code est ecrit.
 *
 * CE QUE CE FICHIER PEUT ET NE PEUT PAS FAIRE. Aucun test ne verifiera qu'un texte de loi regit bien la
 * contrainte a laquelle on le rattache : c'est un jugement juridique. Ce qu'il peut faire, et qu'il fait,
 * c'est interdire la DERIVE SILENCIEUSE — figer knock-out par knock-out le fondement attendu, exiger que
 * chaque identifiant declare soit REELLEMENT atteignable, et exiger que toute reference non validee par
 * un juriste soit marquee comme telle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identiteDepuisIdu,
  snapshotVide,
  REGLES_PAR_ID,
  type Filiere,
  type ParcelleSnapshot,
} from '@enr/core';
import { evaluerKnockOuts, IDS_KNOCK_OUTS } from '../dist/index.js';

/**
 * Fondement attendu par knock-out. `null` = aucune reference, volontairement.
 *
 * A tenir a jour : c'est le prix de la garde, et il est faible au regard de ce qu'elle protege — une
 * base juridique erronee dans un document remis a un tiers.
 */
const FONDEMENT_ATTENDU: Record<string, string | null> = {
  // --- Attributions par filiere ---
  ko_aop_viticole: 'pv_aop_viticole',
  ko_hors_document_cadre: 'pv_document_cadre',
  ko_eol_habitation_500: 'eol_distance_habitation',
  ko_eol_zone_habitat_500: 'eol_distance_habitation',
  ko_eol_mh_500: 'eol_monument_historique',
  ko_eol_radar: 'eol_radar',
  ko_metha_habitation_200: 'metha_distance_habitation',
  ko_metha_captage: 'metha_distance_eau',
  ko_metha_cours_eau: 'metha_distance_eau',
  ko_bess_acces_engins: 'bess_acces_engins',

  /**
   * --- Attributions COMMUNES, ajoutees sur decision du proprietaire ---
   *
   * Onze knock-outs ecartaient une parcelle — parfois definitivement — sans citer aucun texte. Le rapport
   * remis au proprietaire annoncait donc « Espace boise classe » comme un fait de nature, sans le
   * fondement qui permet de le verifier ou d'y chercher une derogation.
   *
   * Toutes portent `aValiderParJuriste` dans le referentiel, et un test ci-dessous l'exige : elles sont
   * PROPOSEES, pas validees.
   */
  ko_zone_humide: 'commun_zone_humide',
  ko_ppri_rouge: 'commun_ppr_zone_rouge',
  ko_pprif_rouge: 'commun_ppr_zone_rouge',
  ko_pprt_rouge: 'commun_pprt_zone_rouge',
  ko_ebc: 'commun_ebc',
  ko_emplacement_reserve: 'commun_emplacement_reserve',
  ko_zonage_naturel: 'commun_zone_n',
  ko_eol_site_classe: 'commun_site_classe',
  ko_coeur_parc_national: 'commun_coeur_parc_national',
  ko_reserve_naturelle: 'commun_reserve_naturelle',
  ko_appb: 'commun_appb',

  // --- Absences ASSUMEES ---
  // Corrige : citait l'arrete « radars », qui ne regit pas les servitudes de degagement. Reste a `null`
  // jusqu'a ce que le texte applicable soit etabli — une reference fausse est pire qu'aucune.
  ko_eol_servitude_aero: null,
  // La saturation d'un poste source est un fait de reseau, pas une regle de droit.
  ko_poste_sature: null,
};

/** Les regles redigees pendant ce chantier, sans relecture juridique. */
const A_VALIDER = [
  'bess_acces_engins',
  'bess_effets_domino',
  'bess_raccordement_s3renr',
  'commun_appb',
  'commun_coeur_parc_national',
  'commun_ebc',
  'commun_emplacement_reserve',
  'commun_ppr_zone_rouge',
  'commun_pprt_zone_rouge',
  'commun_reserve_naturelle',
  'commun_site_classe',
  'commun_zone_humide',
  'commun_zone_n',
];

// ---------------------------------------------------------------------------
// Declenchement de chaque knock-out
// ---------------------------------------------------------------------------

function vide(): ParcelleSnapshot {
  return snapshotVide(identiteDepuisIdu('28390000ZT0001', 'Commune de test'));
}

/** Un zonage qui RECOUVRE la parcelle, forme attendue par les regles de protection. */
function recouvrant(nom: string): ParcelleSnapshot['milieux']['appb'] {
  return { recouvre: true, partRecouvrement: 1, distanceM: 0, nom };
}

function prescription(
  champ: 'estEbc' | 'estEmplacementReserve',
): ParcelleSnapshot['urbanisme']['prescriptions'][number] {
  return {
    type: null,
    libelle: 'Prescription de test',
    estEbc: champ === 'estEbc',
    estEmplacementReserve: champ === 'estEmplacementReserve',
  };
}

function posteSature(): NonNullable<ParcelleSnapshot['raccordement']['posteLePlusProche']> {
  return {
    id: 'P1',
    nom: 'Poste de test',
    gestionnaire: 'Enedis',
    tension: '63 kV / 20 kV',
    distanceKm: 2,
    capaciteResiduelleMw: 0,
    etatSaturation: 'sature',
    fileAttenteMw: null,
    quotePartEurParKw: null,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  };
}

/**
 * Un cas par knock-out : la filiere qui l'evalue, et la modification MINIMALE du snapshot qui le
 * declenche. Minimale a dessein — un snapshot qui declenche deux regles ne prouverait rien sur la
 * seconde, puisque la premiere l'emporte.
 */
const CAS: Array<{
  id: string;
  filiere: Filiere;
  surfaceHa?: number;
  poser: (s: ParcelleSnapshot) => void;
}> = [
  // --- Communs ---
  {
    id: 'ko_coeur_parc_national',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.milieux.coeurParcNational = recouvrant('Parc de test');
    },
  },
  {
    id: 'ko_reserve_naturelle',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.milieux.reserveNaturelle = recouvrant('Reserve de test');
    },
  },
  {
    id: 'ko_appb',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.milieux.appb = recouvrant('Biotope de test');
    },
  },
  {
    id: 'ko_zone_humide',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.eau.zoneHumide = 'oui';
    },
  },
  {
    id: 'ko_ppri_rouge',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.risques.ppri = { present: true, zonage: 'Rouge', severitePlan: null };
    },
  },
  {
    id: 'ko_pprif_rouge',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.risques.pprif = { present: true, zonage: 'Rouge', severitePlan: null };
    },
  },
  {
    id: 'ko_pprt_rouge',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.risques.pprt = { present: true, zonage: 'Rouge', severitePlan: null };
    },
  },
  {
    id: 'ko_ebc',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.urbanisme.prescriptions = [prescription('estEbc')];
    },
  },
  {
    id: 'ko_emplacement_reserve',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.urbanisme.prescriptions = [prescription('estEmplacementReserve')];
    },
  },
  {
    id: 'ko_zonage_naturel',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.urbanisme.zonages = [
        {
          libelle: 'N',
          typeZone: 'N',
          destinationDominante: null,
          urlReglement: null,
          dateApprobation: null,
          partRecouvrement: 1,
        },
      ];
    },
  },
  {
    id: 'ko_poste_sature',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.raccordement.posteLePlusProche = posteSature();
    },
  },

  // --- Solaire au sol ---
  {
    id: 'ko_hors_document_cadre',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.occupationSol.typeSol = 'inculte';
      s.urbanisme.documentCadrePvSol = {
        departementCouvert: true,
        parcelleEligible: false,
        dateArrete: '2024-01-15',
      };
    },
  },
  {
    id: 'ko_aop_viticole',
    filiere: 'solaire_sol',
    poser: (s) => {
      s.occupationSol.aop = { presente: true, viticole: true, appellations: ['Test'] };
    },
  },

  // --- Eolien terrestre ---
  {
    /**
     * Parcelle minuscule : le recul de 500 m reste hors d'atteinte MEME en implantant l'aerogenerateur
     * au point le plus eloigne. C'est la condition exacte du knock-out, et elle est deliberee : sur une
     * grande parcelle, une habitation proche du bord n'ecarte pas le projet.
     */
    id: 'ko_eol_habitation_500',
    filiere: 'eolien_terrestre',
    surfaceHa: 0.5,
    poser: (s) => {
      s.bati.distanceHabitationM = 120;
    },
  },
  {
    id: 'ko_eol_zone_habitat_500',
    filiere: 'eolien_terrestre',
    surfaceHa: 0.5,
    poser: (s) => {
      s.bati.distanceZoneHabitatM = 100;
    },
  },
  {
    id: 'ko_eol_mh_500',
    filiere: 'eolien_terrestre',
    surfaceHa: 0.5,
    poser: (s) => {
      s.patrimoine.monumentHistorique = {
        distanceM: 150,
        dansPerimetreProtection: true,
        nom: 'Monument de test',
      };
    },
  },
  {
    id: 'ko_eol_site_classe',
    filiere: 'eolien_terrestre',
    poser: (s) => {
      s.patrimoine.siteClasse = recouvrant('Site de test');
    },
  },
  {
    id: 'ko_eol_radar',
    filiere: 'eolien_terrestre',
    poser: (s) => {
      s.risques.radars = [{ type: 'radar meteorologique', distanceKm: 4, distanceMinRequiseKm: 20 }];
    },
  },
  {
    id: 'ko_eol_servitude_aero',
    filiere: 'eolien_terrestre',
    poser: (s) => {
      s.risques.servitudesAeronautiques = true;
    },
  },

  // --- Methanisation ---
  {
    id: 'ko_metha_habitation_200',
    filiere: 'methanisation',
    surfaceHa: 0.5,
    poser: (s) => {
      s.bati.distanceHabitationM = 40;
    },
  },
  {
    id: 'ko_metha_captage',
    filiere: 'methanisation',
    poser: (s) => {
      s.eau.captageAep = { dansPerimetre: true, type: 'rapproche', distanceM: 20 };
    },
  },
  {
    id: 'ko_metha_cours_eau',
    filiere: 'methanisation',
    surfaceHa: 0.2,
    poser: (s) => {
      s.eau.distanceCoursEauM = 5;
    },
  },

  // --- Stockage BESS ---
  {
    id: 'ko_bess_acces_engins',
    filiere: 'bess',
    poser: (s) => {
      s.acces.accesPoidsLourds = false;
      s.acces.distanceVoirieM = 900;
    },
  },
];

function declencher(cas: (typeof CAS)[number]): ReturnType<typeof evaluerKnockOuts> {
  const s = vide();
  cas.poser(s);
  return evaluerKnockOuts(s, {
    filiere: cas.filiere,
    options: {},
    surfaceHa: cas.surfaceHa ?? 20,
  });
}

// ---------------------------------------------------------------------------
// Les invariants
// ---------------------------------------------------------------------------

test('la table couvre TOUS les knock-outs declares, et rien de plus', () => {
  // Sans cela, un knock-out ajoute echapperait a la garde en silence — le mode de defaillance de tous
  // les controles par liste maintenue a la main.
  assert.deepEqual(
    Object.keys(FONDEMENT_ATTENDU).sort(),
    [...IDS_KNOCK_OUTS].sort(),
    'la table des fondements et la liste des identifiants ont divergé : completez FONDEMENT_ATTENDU en ' +
      'decidant explicitement si le nouveau knock-out porte une base juridique ou non.',
  );
});

test('CHAQUE IDENTIFIANT DECLARE EST REELLEMENT ATTEIGNABLE', () => {
  /**
   * L'invariant que la relecture de source ne pouvait pas porter, et le plus utile des trois : un
   * identifiant inscrit dans `IDS_KNOCK_OUTS` sans regle qui le produise est une promesse vide — la route
   * l'accepte dans `knockOutsDesactives`, l'utilisateur croit neutraliser une regle, et il ne se passe
   * rien. Le defaut inverse existait aussi : trois protections fortes etaient produites sans figurer dans
   * la liste, donc impossibles a desactiver.
   */
  const couverts = new Set(CAS.map((c) => c.id));
  assert.deepEqual(
    [...IDS_KNOCK_OUTS].filter((id) => !couverts.has(id)),
    [],
    'identifiant(s) declare(s) sans cas de declenchement : ajoutez-en un, ou retirez-les de la liste.',
  );

  const manquants: string[] = [];
  for (const cas of CAS) {
    const produits = declencher(cas).map((k) => k.id);
    if (!produits.includes(cas.id)) {
      manquants.push(`${cas.id} (${cas.filiere}) : obtenu ${produits.join(', ') || 'aucun knock-out'}`);
    }
  }
  assert.deepEqual(
    manquants,
    [],
    `knock-out(s) declare(s) mais non declenche(s) par leur propre cas : ${manquants.join(' ; ')}`,
  );
});

test('chaque knock-out porte EXACTEMENT le fondement attendu', () => {
  const ecarts: string[] = [];
  for (const cas of CAS) {
    const produit = declencher(cas).find((k) => k.id === cas.id);
    if (!produit) continue; // signale par le test precedent
    const attendu = FONDEMENT_ATTENDU[cas.id] ?? null;
    if ((produit.regleLiee ?? null) !== attendu) {
      ecarts.push(`${cas.id} : ${produit.regleLiee ?? 'aucun'} au lieu de ${attendu ?? 'aucun'}`);
    }
  }
  assert.deepEqual(
    ecarts,
    [],
    `fondement(s) juridique(s) modifie(s) sans decision : ${ecarts.join(' ; ')}. Une base juridique ` +
      "erronee part dans le rapport remis au proprietaire, sous la mention « Fondement : … » : c'est " +
      'le defaut qui a rendu ce fichier necessaire.',
  );
});

test('tout fondement cite EXISTE dans le referentiel', () => {
  // Une cle qui ne resout pas laisse la fiche et le rapport sans aucun fondement affiche, en silence :
  // le champ est simplement absent du rendu. C'est le mode de defaillance le plus discret.
  const fantomes = Object.values(FONDEMENT_ATTENDU)
    .filter((r): r is string => r != null)
    .filter((r) => REGLES_PAR_ID[r] == null);
  assert.deepEqual(
    fantomes,
    [],
    `fondement(s) cite(s) mais absent(s) du referentiel : ${fantomes.join(', ')}`,
  );
});

test('LES REFERENCES NON VALIDEES PAR UN JURISTE SONT MARQUEES COMME TELLES', () => {
  /**
   * L'invariant d'honnetete de ce chantier. Les references communes et les trois nouvelles regles du
   * stockage ont ete redigees a la demande du proprietaire, a partir des textes que je peux nommer avec
   * confiance — mais je ne suis pas juriste. Les laisser se confondre avec les regles relues reviendrait
   * a affirmer une verification qui n'a pas eu lieu.
   *
   * Le marquage ne disparaitra donc qu'avec une validation explicite, et ce test la rendra visible : il
   * faudra le modifier pour la declarer.
   */
  const nonMarquees = A_VALIDER.filter((id) => REGLES_PAR_ID[id]?.aValiderParJuriste !== true);
  assert.deepEqual(
    nonMarquees,
    [],
    `regle(s) proposee(s) presentee(s) comme verifiee(s) : ${nonMarquees.join(', ')}. Une reference ` +
      'redigee sans relecture juridique doit le dire, dans la fiche comme dans le rapport.',
  );

  // Et l'inverse : le marquage doit rester exceptionnel et enumere, pour qu'il garde son sens.
  const marquees = Object.values(REGLES_PAR_ID)
    .filter((r) => r.aValiderParJuriste === true)
    .map((r) => r.id)
    .sort();
  assert.deepEqual(
    marquees,
    [...A_VALIDER].sort(),
    'la liste des regles a valider a change : declarez-la ici, ou retirez le marquage apres validation.',
  );
});

test('toute regle a valider porte un commentaire qui dit quoi verifier', () => {
  // Un marquage sans explication laisse l'utilisateur devant une alerte qu'il ne peut pas interpreter —
  // le meme reproche que celui deja fait a `instable`.
  for (const r of Object.values(REGLES_PAR_ID)) {
    if (r.aValiderParJuriste !== true) continue;
    assert.ok(
      (r.commentaire ?? '').length > 80,
      `${r.id} : marquee a valider sans commentaire utile. Dire ce qui est certain et ce qui ne l'est pas.`,
    );
  }
});
