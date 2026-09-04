import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identiteDepuisIdu, snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore, calculerScoreSite } from '../dist/index.js';

function parcelleType(overrides: (s: ParcelleSnapshot) => void = () => {}): ParcelleSnapshot {
  const s = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  s.identite.contenanceM2 = 120000; // 12 ha
  s.identite.surfaceCalculeeM2 = 120000;
  s.identite.centroide = [1.75, 48.15];

  s.urbanisme.couvertParGpu = true;
  s.urbanisme.typeDocument = 'PLUi';
  s.urbanisme.zonages = [
    { libelle: 'A', typeZone: 'A', destinationDominante: null, urlReglement: null, dateApprobation: '2019-06-01', partRecouvrement: 1 },
  ];
  s.urbanisme.zaer = { present: false, filieres: [], source: 'test', dateDeliberation: null };
  s.urbanisme.documentCadrePvSol = { departementCouvert: true, parcelleEligible: true, dateArrete: '2024-05-01' };

  s.occupationSol.typeSol = 'agricole_exploite';
  s.occupationSol.rpg = {
    codeCulture: 'PPH',
    libelleCulture: 'Prairie permanente',
    codeGroupeCulture: '18',
    libelleGroupeCulture: 'Prairies permanentes',
    millesime: '2023',
    partRecouvrement: 0.95,
    anneesDeclareesConsecutives: 5,
  };
  s.occupationSol.inculteDepuis2013 = false;
  s.occupationSol.aop = { presente: false, viticole: false, appellations: [] };
  s.occupationSol.foret = { recouvre: false, partBoisee: 0, type: null };
  s.occupationSol.potentielAgronomique = 45;

  s.topographie = {
    pentePct: 3.2,
    penteMaxPct: 6.1,
    orientationDeg: 170,
    altitudeM: 135,
    deniveleM: 4,
    aleaArgiles: 'faible',
    cavitesProches: 0,
    mouvementsTerrain: 0,
  };

  s.eau.zoneHumide = 'non';
  s.eau.distanceCoursEauM = 850;
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: 2400 };
  s.eau.inondation = { zonagePpri: null, alea: 'nul', dansTri: false };
  s.eau.karst = false;

  s.milieux.natura2000Habitats = { recouvre: false, partRecouvrement: 0, distanceM: 6200, nom: 'Vallee de la Conie' };
  s.milieux.natura2000Oiseaux = { recouvre: false, partRecouvrement: 0, distanceM: 9000, nom: null };
  s.milieux.znieff1 = { recouvre: false, partRecouvrement: 0, distanceM: 3100, nom: null };
  s.milieux.znieff2 = { recouvre: false, partRecouvrement: 0, distanceM: 4000, nom: null };
  s.milieux.appb = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.milieux.reserveNaturelle = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.milieux.coeurParcNational = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.milieux.trameVerteBleue = { reservoir: false, corridor: false };
  s.milieux.preEnjeuEspeces = 25;
  s.milieux.sensibiliteAvifaune = 30;
  s.milieux.sensibiliteChiropteres = 35;

  s.patrimoine.monumentHistorique = { distanceM: 2800, dansPerimetreProtection: false, nom: 'Eglise Saint-Pierre' };
  s.patrimoine.siteClasse = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.patrimoine.siteInscrit = { recouvre: false, partRecouvrement: 0, distanceM: null, nom: null };
  s.patrimoine.covisibiliteIndice = 30;
  s.patrimoine.sensibiliteArcheologique = 'faible';

  s.risques.ppri = { present: false, zonage: null };
  s.risques.pprif = { present: false, zonage: null };
  s.risques.pprt = { present: false, zonage: null };
  s.risques.sitesPollues = 0;
  s.risques.radars = [{ type: 'radar meteorologique bande C', distanceKm: 48, distanceMinRequiseKm: 30 }];
  s.risques.servitudesAeronautiques = false;
  s.risques.faisceauxHertziens = false;
  s.risques.obligationDebroussaillement = false;

  s.raccordement.posteLePlusProche = {
    id: 'PS-TEST',
    nom: 'Poste de Janville',
    gestionnaire: 'Enedis',
    tension: '63 kV / 20 kV',
    distanceKm: 4.2,
    capaciteResiduelleMw: 32,
    etatSaturation: 'disponible',
    fileAttenteMw: 8,
    quotePartEurParKw: 45,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  };
  s.raccordement.reseauGaz = {
    // Les deux distances sont distinctes depuis l'audit 8 : la canalisation gouverne le
    // raccordement, le site d'injection existant n'est qu'un indicateur de territoire.
    distanceCanalisationKm: 3.5,
    distanceSiteInjectionKm: 18,
    gestionnaire: 'GRDF',
    capaciteInjectionNm3h: 250,
    reboursNecessaire: false,
  };

  s.gisement = {
    irradiationKwhM2An: 1280,
    productibleKwhKwcAn: 1180,
    ventVitesse100mMs: 6.4,
    intrantsMethaTonnesMsAn: 14000,
    elevagesRayon10km: 12,
    iaaRayon20km: 3,
    surfacesEpandageHa: 1600,
  };

  s.bati = {
    distanceHabitationM: 720,
    nbHabitationsRayon500m: 0,
    distanceZoneHabitatM: 900,
    densiteBati1km: 12,
  };
  s.acces = { distanceVoirieM: 120, accesPoidsLourds: true };
  s.foncier = {
    nbProprietairesEstime: 1,
    indivisionProbable: false,
    surfaceDunSeulTenantHa: 12,
    morcellementIndice: 20,
    proprietairePublic: false,
  };

  s.sources = {
    apicarto_cadastre: {
      nom: 'IGN API Carto - cadastre',
      connecteur: 'apicarto_cadastre',
      dateInterrogation: '2026-07-30T00:00:00.000Z',
      valeurJuridique: 'indicative',
    },
  };

  overrides(s);
  return s;
}

describe('moteur de scoring', () => {
  it('note une parcelle favorable en vert pour les quatre filieres', () => {
    for (const filiere of ['solaire_sol', 'eolien_terrestre', 'bess', 'methanisation'] as const) {
      const r = calculerScore(parcelleType(), filiere);
      assert.equal(r.knockOuts.length, 0, `${filiere} ne devrait declencher aucun knock-out`);
      assert.ok(r.scoreGlobal != null, `${filiere} devrait produire un score`);
      assert.ok(r.couvertureDonnees > 0.9, `${filiere} : couverture ${r.couvertureDonnees}`);
      assert.equal(r.statut, 'vert', `${filiere} : statut ${r.statut} (score ${r.scoreGlobal})`);
    }
  });

  it('ecarte en rouge une habitation hors de portee du recul de 500 m en eolien, mais pas en solaire', () => {
    // Parcelle de 12 ha : deport possible ~195 m. Meme en implantant au plus loin, la
    // machine reste a 200 + 195 = 395 m < 500 m. Le recul est donc reellement impossible.
    const s = parcelleType((p) => {
      p.bati.distanceHabitationM = 200;
    });
    const eolien = calculerScore(s, 'eolien_terrestre');
    assert.equal(eolien.statut, 'rouge');
    assert.equal(eolien.scoreGlobal, null);
    assert.ok(eolien.knockOuts.some((k) => k.id === 'ko_eol_habitation_500'));

    const solaire = calculerScore(s, 'solaire_sol');
    assert.equal(solaire.knockOuts.length, 0);
    assert.equal(solaire.statut, 'vert');
  });

  it('ecarte la methanisation lorsque le recul de 200 m est hors de portee', () => {
    // Parcelle volontairement minuscule (0,2 ha, deport ~25 m) : 150 + 25 < 200.
    const r = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 2000;
        p.identite.surfaceCalculeeM2 = 2000;
        p.bati.distanceHabitationM = 150;
      }),
      'methanisation',
    );
    assert.equal(r.statut, 'rouge');
    assert.ok(r.knockOuts.some((k) => k.id === 'ko_metha_habitation_200'));
  });

  /**
   * Correction E1. Le recul reglementaire se mesure depuis l'AEROGENERATEUR, pas depuis la
   * limite de propriete. Mesurer depuis le bord ecartait du classement des parcelles
   * parfaitement implantables - un faux negatif silencieux, jamais reexamine.
   */
  it('conserve une parcelle assez vaste pour tenir le recul de 500 m, bord a 430 m', () => {
    const s = parcelleType((p) => {
      p.identite.contenanceM2 = 400000; // 40 ha -> deport possible ~357 m
      p.identite.surfaceCalculeeM2 = 400000;
      p.foncier.surfaceDunSeulTenantHa = 40;
      p.bati.distanceHabitationM = 430; // 430 + 357 = 787 m : le recul est tenable
    });
    const r = calculerScore(s, 'eolien_terrestre');
    assert.equal(
      r.knockOuts.filter((k) => k.id === 'ko_eol_habitation_500').length,
      0,
      'une parcelle de 40 ha peut porter la machine a plus de 500 m',
    );
    assert.notEqual(r.statut, 'rouge');

    // La meme distance sur une petite parcelle reste eliminatoire : le deport n'existe pas.
    const petite = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 15000; // 1,5 ha -> deport ~69 m
        p.identite.surfaceCalculeeM2 = 15000;
        p.bati.distanceHabitationM = 430;
      }),
      'eolien_terrestre',
    );
    assert.ok(petite.knockOuts.some((k) => k.id === 'ko_eol_habitation_500'));
  });

  /**
   * Correction B1. `env_avifaune` et `env_chiropteres` etaient alimentes par une derivation
   * des zonages : trois criteres d'apparence independante portaient le meme nombre, et
   * pesaient ensemble 18 % du score eolien. Ils ont ete retires du catalogue.
   */
  it('ne note plus la sensibilite avifaune ni chiropteres, faute de source', () => {
    const r = calculerScore(parcelleType(), 'eolien_terrestre');
    const ids = r.criteres.map((c) => c.id);
    assert.ok(!ids.includes('env_avifaune'), 'env_avifaune ne doit plus etre evalue');
    assert.ok(!ids.includes('env_chiropteres'), 'env_chiropteres ne doit plus etre evalue');
    assert.ok(!ids.includes('pat_covisibilite'), 'pat_covisibilite ne doit plus etre evalue');
    // Le critere conserve, lui, dit explicitement d'ou vient sa valeur.
    const especes = r.criteres.find((c) => c.id === 'env_especes_protegees');
    assert.ok(especes, 'env_especes_protegees reste evalue');
    assert.match(especes.commentaire ?? '', /zonage/i);
  });

  it('ecarte une AOP viticole en solaire et signale le knock-out', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.occupationSol.aop = { presente: true, viticole: true, appellations: ['Chablis'] };
      }),
      'solaire_sol',
    );
    assert.equal(r.statut, 'rouge');
    const k = r.knockOuts.find((x) => x.id === 'ko_aop_viticole');
    assert.ok(k);
    assert.equal(k.regleLiee, 'pv_aop_viticole');
    assert.match(k.motif, /Chablis/);
  });

  it('ecarte un terrain inculte absent du document-cadre departemental', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.occupationSol.typeSol = 'inculte';
        p.urbanisme.documentCadrePvSol = { departementCouvert: true, parcelleEligible: false, dateArrete: '2024-05-01' };
      }),
      'solaire_sol',
    );
    assert.equal(r.statut, 'rouge');
    assert.ok(r.knockOuts.some((k) => k.id === 'ko_hors_document_cadre'));
  });

  it("n'ecarte pas un terrain inculte lorsque le document-cadre n'est pas ingere", () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.occupationSol.typeSol = 'inculte';
        p.urbanisme.documentCadrePvSol = { departementCouvert: false, parcelleEligible: null, dateArrete: null };
      }),
      'solaire_sol',
    );
    assert.equal(r.knockOuts.length, 0);
    assert.equal(r.regimeImplantation, 'pv_sol_document_cadre');
  });

  it('traite un poste sature avec renforcement comme derogeable (orange, pas rouge)', () => {
    const avecRenfort = calculerScore(
      parcelleType((p) => {
        p.raccordement.posteLePlusProche!.etatSaturation = 'sature';
        p.raccordement.posteLePlusProche!.capaciteResiduelleMw = 0;
        p.raccordement.posteLePlusProche!.renforcement = { prevu: true, horizon: '2029', capaciteAttendueMw: 60 };
      }),
      'bess',
    );
    assert.equal(avecRenfort.statut, 'orange');
    assert.ok(avecRenfort.scoreGlobal != null);
    assert.ok(avecRenfort.knockOuts.some((k) => k.id === 'ko_poste_sature' && k.derogeable));

    const sansRenfort = calculerScore(
      parcelleType((p) => {
        p.raccordement.posteLePlusProche!.etatSaturation = 'sature';
        p.raccordement.posteLePlusProche!.capaciteResiduelleMw = 0;
      }),
      'bess',
    );
    assert.equal(sansRenfort.statut, 'rouge');
    assert.equal(sansRenfort.scoreGlobal, null);
  });

  it('passe en gris lorsque la couverture de donnees est insuffisante', () => {
    const s = snapshotVide(identiteDepuisIdu('283900000C0843'));
    s.identite.contenanceM2 = 100000;
    const r = calculerScore(s, 'solaire_sol');
    assert.equal(r.statut, 'gris');
    assert.ok(r.couvertureDonnees < 0.5);
    assert.ok(r.criteres.every((c) => c.note != null || c.feu === 'gris'));
  });

  /**
   * Correction B2. Entre le seuil de grisement (80 %) et 90 %, le score etait publie tel
   * quel : une parcelle pouvait ressortir VERTE - donc « a demarcher » - alors qu'un
   * cinquieme du poids des criteres n'avait pas pu etre evalue. Le vert affirme une
   * conclusion ; il exige une couverture qui la fonde. Entre les deux seuils, le statut est
   * desormais plafonne a orange, avec un motif qui dit pourquoi.
   */
  it('plafonne a orange une parcelle dont la couverture reste sous 90 %', () => {
    const s = parcelleType((p) => {
      p.topographie.pentePct = null;
      p.topographie.penteMaxPct = null;
      p.gisement.irradiationKwhM2An = null;
      p.gisement.productibleKwhKwcAn = null;
    });
    const r = calculerScore(s, 'solaire_sol');

    // La parcelle reste bien au-dessus du seuil de grisement : ce n'est pas un cas « gris ».
    assert.ok(
      r.couvertureDonnees >= 0.8 && r.couvertureDonnees < 0.9,
      `couverture attendue dans [0,80 ; 0,90[, obtenue ${r.couvertureDonnees}`,
    );
    assert.notEqual(r.statut, 'gris');
    assert.equal(r.statut, 'orange', 'le vert exige une couverture d’au moins 90 %');

    const limite = r.limitesViabilite.find((l) => l.id === 'couverture_insuffisante');
    assert.ok(limite, 'le plafonnement doit etre explicite, pas silencieux');
    assert.equal(limite.statutMaximal, 'orange');
    assert.match(limite.motif, /90/);

    // Le score reste calcule et affiche : on plafonne le STATUT, on n'efface pas l'analyse.
    assert.ok(r.scoreGlobal != null);

    // Controle a contrario : la meme parcelle complete repasse en vert.
    const complete = calculerScore(parcelleType(), 'solaire_sol');
    assert.ok(complete.couvertureDonnees >= 0.9);
    assert.equal(complete.statut, 'vert');
    assert.ok(!complete.limitesViabilite.some((l) => l.id === 'couverture_insuffisante'));
  });

  it('produit un score explicable : contributions coherentes avec le score global', () => {
    const r = calculerScore(parcelleType(), 'solaire_sol');
    const sommeContributions = r.criteres.reduce((a, c) => a + c.contribution, 0);
    const sommePoidsRenseignes = r.criteres.filter((c) => c.note != null).reduce((a, c) => a + c.poids, 0);
    // score = somme(note*poids) / somme(poids des criteres renseignes)
    assert.ok(Math.abs(sommeContributions / sommePoidsRenseignes - r.scoreGlobal!) < 0.5);
    assert.ok(r.pointsForts.length > 0);
    assert.ok(r.criteres.every((c) => c.valeurAffichee.length > 0));
  });

  it('rappelle les seuils de procedure dates par filiere', () => {
    const pv = calculerScore(parcelleType(), 'solaire_sol');
    assert.ok(pv.seuilsProcedure.some((s) => s.regleId === 'pv_permis_construire'));
    assert.ok(pv.seuilsProcedure.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.dateEntreeEnVigueur)));
    // 12 ha en agrivoltaisme -> environ 6 MWc -> permis de construire applicable
    assert.equal(pv.seuilsProcedure.find((s) => s.regleId === 'pv_permis_construire')?.applicable, true);

    const metha = calculerScore(parcelleType(), 'methanisation', { tonnageEnvisageTj: 55 });
    assert.equal(metha.seuilsProcedure.find((s) => s.regleId === 'metha_2781_e')?.applicable, true);
    assert.equal(metha.seuilsProcedure.find((s) => s.regleId === 'metha_2781_a')?.applicable, false);
  });

  it('permet de desactiver un knock-out en mode scenario, avec avertissement', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.bati.distanceHabitationM = 320;
      }),
      'eolien_terrestre',
      { knockOutsDesactives: ['ko_eol_habitation_500'] },
    );
    assert.equal(r.knockOuts.length, 0);
    assert.ok(r.avertissements.some((a) => /scenario derogatoire/.test(a)));
  });

  it('reagit au changement de ponderation', () => {
    const s = parcelleType((p) => {
      p.raccordement.posteLePlusProche!.distanceKm = 18;
    });
    const defaut = calculerScore(s, 'solaire_sol');
    const raccordementDominant = calculerScore(s, 'solaire_sol', {
      ponderation: { poids: { racc_distance_poste: 200 } },
    });
    assert.ok(
      raccordementDominant.scoreGlobal! < defaut.scoreGlobal!,
      `${raccordementDominant.scoreGlobal} devrait etre inferieur a ${defaut.scoreGlobal}`,
    );
  });

  it('consolide un site multi-parcelles en retirant les parcelles ecartees', () => {
    const bonne = parcelleType();
    const mauvaise = parcelleType((p) => {
      p.identite.idu = '283900000C0844';
      p.eau.zoneHumide = 'oui';
    });
    const site = calculerScoreSite([bonne, mauvaise], 'solaire_sol');
    assert.equal(site.surfaceTotaleHa, 24);
    assert.equal(site.knockOutsConsolides.length, 1);
    assert.ok(site.scoreGlobal != null);
    // La fragmentation penalise le score consolide par rapport a la seule bonne parcelle.
    const seule = calculerScore(bonne, 'solaire_sol');
    assert.ok(site.scoreGlobal! < seule.scoreGlobal!);
  });

  it('ne note pas le gisement pour le stockage', () => {
    const r = calculerScore(parcelleType(), 'bess');
    assert.ok(!r.criteres.some((c) => c.famille === 'gisement'));
    // Le raccordement doit dominer le score du BESS.
    const poidsRacc = r.criteres
      .filter((c) => c.famille === 'raccordement')
      .reduce((a, c) => a + c.poids, 0);
    assert.ok(poidsRacc > 0.35, `poids raccordement ${poidsRacc}`);
  });
});

describe('limites de viabilite economique', () => {
  it('plafonne a orange une parcelle sous la surface minimale de la filiere', () => {
    // 0,45 ha pour du solaire au sol (minimum indicatif : 1 ha).
    const r = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 4500;
        p.identite.surfaceCalculeeM2 = 4500;
      }),
      'solaire_sol',
    );
    assert.equal(r.knockOuts.length, 0, 'aucune contrainte reglementaire ne doit etre declenchee');
    assert.ok(r.scoreGlobal != null, 'le score reste calcule');
    assert.equal(r.statut, 'orange', `statut ${r.statut} (score ${r.scoreGlobal})`);
    assert.equal(r.limitesViabilite[0]?.id, 'viab_surface_insuffisante');
    assert.match(r.limitesViabilite[0]!.motif, /ECONOMIQUE et non reglementaire/);
  });

  it('plafonne a rouge une parcelle tres largement sous le seuil', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 850;
        p.identite.surfaceCalculeeM2 = 850;
      }),
      'solaire_sol',
    );
    assert.equal(r.statut, 'rouge');
    // Le score reste renseigne : la parcelle est ecartee pour raison economique, pas
    // reglementaire, et l'utilisateur doit pouvoir le constater.
    assert.ok(r.scoreGlobal != null);
    assert.equal(r.knockOuts.length, 0);
    assert.equal(r.limitesViabilite[0]?.id, 'viab_surface_tres_insuffisante');
  });

  it('ne plafonne pas une parcelle de 2 ha en stockage (minimum 0,5 ha)', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 20000;
        p.identite.surfaceCalculeeM2 = 20000;
      }),
      'bess',
    );
    assert.equal(r.limitesViabilite.length, 0);
    assert.equal(r.statut, 'vert');
  });

  it('conserve dans un site les parcelles trop petites seules', () => {
    // Six parcelles de 0,2 ha : chacune est ecartee seule (moins du quart du minimum
    // de 1 ha), mais l'ensemble atteint 1,2 ha, soit une taille exploitable.
    const petites = Array.from({ length: 6 }, (_, i) =>
      parcelleType((p) => {
        p.identite.idu = `283900000C08${String(50 + i).padStart(2, '0')}`;
        p.identite.contenanceM2 = 2000;
        p.identite.surfaceCalculeeM2 = 2000;
      }),
    );
    for (const p of petites) {
      assert.equal(calculerScore(p, 'solaire_sol').statut, 'rouge', 'chaque parcelle est rouge seule');
    }
    const site = calculerScoreSite(petites, 'solaire_sol');
    assert.equal(site.surfaceTotaleHa, 1.2);
    assert.equal(site.knockOutsConsolides.length, 0);
    // Le site agrege reste evalue : c'est la raison d'etre de l'agregation.
    assert.ok(site.scoreGlobal != null, 'le site doit rester score');
    assert.notEqual(site.statut, 'rouge', `statut du site : ${site.statut}`);
  });

  it('retire du site les parcelles frappees d\'un knock-out reglementaire', () => {
    const bonne = parcelleType();
    const humide = parcelleType((p) => {
      p.identite.idu = '283900000C0899';
      p.eau.zoneHumide = 'oui';
    });
    const site = calculerScoreSite([bonne, humide], 'solaire_sol');
    assert.equal(site.knockOutsConsolides.length, 1);
    assert.equal(site.knockOutsConsolides[0]?.id, 'ko_zone_humide');
  });
});

/**
 * Correction B1. Un critere dont la SOURCE n'existe pas sur le territoire manque
 * identiquement a toutes les parcelles : le compter comme non renseigne faisait chuter la
 * couverture de la meme quantite partout. En methanisation, les 23,8 % de poids sans source
 * plaçaient la couverture maximale a 76 %, sous le seuil de grisement de 80 % : la filiere
 * entiere etait grise, sur tout le territoire.
 */
describe('criteres sans source nationale', () => {
  /** Parcelle methanisable correcte, sur un territoire sans couche d'intrants ingeree. */
  function sansIntrants(): ParcelleSnapshot {
    return parcelleType((p) => {
      p.gisement.intrantsMethaTonnesMsAn = null;
      p.gisement.surfacesEpandageHa = null;
      p.gisement.elevagesRayon10km = null;
      p.gisement.iaaRayon20km = null;
      p.gisement.sourcesIntrantsIngerees = false;
    });
  }

  it('exclut du denominateur de couverture, plutot que de griser la filiere entiere', () => {
    const r = calculerScore(sansIntrants(), 'methanisation');
    assert.equal(
      r.couvertureDonnees,
      1,
      'la couverture porte sur les criteres evaluables, pas sur ceux qui n’ont pas de source',
    );
    assert.notEqual(r.statut, 'gris', 'la filiere doit rester exploitable');
    assert.ok(r.scoreGlobal != null, 'le score doit rester calcule et comparable');
  });

  it('plafonne malgre tout le statut a orange, et le dit', () => {
    const r = calculerScore(sansIntrants(), 'methanisation');
    assert.equal(r.statut, 'orange', 'aucune parcelle propice sur un enjeu jamais regarde');
    const limite = r.limitesViabilite.find((l) => l.id === 'criteres_sans_source');
    assert.ok(limite, 'le plafonnement doit etre explicite');
    assert.equal(limite.statutMaximal, 'orange');
    assert.match(limite.motif, /gisement|Gisement|debouche|Debouche/);
  });

  it('affiche les criteres concernes en gris, avec leur poids reel', () => {
    const r = calculerScore(sansIntrants(), 'methanisation');
    const intrants = r.criteres.find((c) => c.id === 'gis_intrants');
    assert.ok(intrants, 'le critere reste visible dans la fiche');
    assert.equal(intrants.note, null);
    assert.equal(intrants.feu, 'gris');
    // 18 / 109 du catalogue methanisation : la part affichee doit rester celle du sujet,
    // pas une part gonflee par l'exclusion du denominateur de couverture.
    assert.ok(
      Math.abs(intrants.poids - 0.165) < 0.005,
      `poids affiche ${intrants.poids}, attendu ~0,165`,
    );
    assert.match(intrants.valeurAffichee, /aucune source/i);
  });

  it('les parts affichees de tous les criteres somment bien a 100 %', () => {
    const r = calculerScore(sansIntrants(), 'methanisation');
    const somme = r.criteres.reduce((a, c) => a + c.poids, 0);
    assert.ok(Math.abs(somme - 1) < 0.02, `somme des parts affichees : ${somme}`);
  });

  it('une source ingeree qui ne trouve rien reste un constat, pas une absence de source', () => {
    // Couches presentes, comptages nuls : c'est une vraie absence sur le territoire, qui
    // doit etre notee (mal) et non plafonner le statut.
    const r = calculerScore(
      parcelleType((p) => {
        p.gisement.intrantsMethaTonnesMsAn = 0;
        p.gisement.surfacesEpandageHa = 0;
        p.gisement.elevagesRayon10km = 0;
        p.gisement.iaaRayon20km = 0;
        p.gisement.sourcesIntrantsIngerees = true;
      }),
      'methanisation',
    );
    assert.ok(!r.limitesViabilite.some((l) => l.id === 'criteres_sans_source'));
    const intrants = r.criteres.find((c) => c.id === 'gis_intrants');
    assert.equal(intrants?.note, 0, 'un gisement nul se note zero, il ne se tait pas');
  });
});

/**
 * Correction B2. `calculerScoreSite` recalculait un statut a partir des seuls seuils vert et
 * orange : ni le seuil de couverture, ni le plafond d'incertitude, ni les limites de
 * viabilite, ni la regle « un knock-out derogeable interdit le vert » ne s'y appliquaient.
 * Deux parcelles individuellement grises produisaient un site VERT a 95/100 - et le site est
 * precisement l'objet que l'on presente en comite.
 */
describe('score de site : les garde-fous de la parcelle s’appliquent aussi', () => {
  /** Parcelle a la couverture tres faible : seuls quelques criteres favorables sont connus. */
  function maigre(idu: string): ParcelleSnapshot {
    const s = snapshotVide(identiteDepuisIdu(idu, 'Tillay-le-Peneux'));
    s.identite.contenanceM2 = 300000;
    s.identite.surfaceCalculeeM2 = 300000;
    s.identite.centroide = [1.75, 48.15];
    s.raccordement.posteLePlusProche = {
      id: 'P', nom: 'Poste', gestionnaire: 'Enedis', tension: '63 kV',
      distanceKm: 1, capaciteResiduelleMw: 90, etatSaturation: 'disponible',
      fileAttenteMw: 0, quotePartEurParKw: 10,
      renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null }, enProjet: false,
    };
    s.gisement.irradiationKwhM2An = 1500;
    s.gisement.productibleKwhKwcAn = 1400;
    s.foncier.surfaceDunSeulTenantHa = 30;
    return s;
  }

  it('un site de parcelles grises ne devient pas vert', () => {
    const parcelle = calculerScore(maigre('A'), 'solaire_sol');
    assert.equal(parcelle.statut, 'gris', 'pre-requis : la parcelle seule est bien grise');

    const site = calculerScoreSite([maigre('A'), maigre('B')], 'solaire_sol');
    assert.equal(site.statut, 'gris', 'agreger deux inconnues ne produit pas une certitude');
  });

  it('le site expose sa couverture et ses plafonds, pour que l’interface puisse avertir', () => {
    const site = calculerScoreSite([maigre('A'), maigre('B')], 'solaire_sol');
    assert.equal(typeof site.couvertureDonnees, 'number');
    assert.ok(site.couvertureDonnees < 0.5);
    assert.ok(Array.isArray(site.limitesViabilite));
  });

  it('un knock-out derogeable sur une parcelle retenue interdit le vert au site', () => {
    // Poste sature avec renforcement programme : knock-out derogeable, pas bloquant.
    const avecDerogation = parcelleType((p) => {
      p.raccordement.posteLePlusProche!.etatSaturation = 'sature';
      p.raccordement.posteLePlusProche!.renforcement = {
        prevu: true, horizon: '2029', capaciteAttendueMw: 40,
      };
    });
    const site = calculerScoreSite([avecDerogation, parcelleType()], 'solaire_sol');
    assert.notEqual(site.statut, 'vert');
  });

  it('la surface insuffisante s’apprecie sur le SITE, non parcelle par parcelle', () => {
    // Dix parcelles de 0,3 ha : chacune est sous le seuil solaire de 1 ha, le site fait 3 ha.
    const petites = Array.from({ length: 10 }, (_, i) =>
      parcelleType((p) => {
        p.identite.contenanceM2 = 3000;
        p.identite.surfaceCalculeeM2 = 3000;
        p.foncier.surfaceDunSeulTenantHa = 3;
      }),
    );
    const seule = calculerScore(petites[0]!, 'solaire_sol');
    assert.ok(
      seule.limitesViabilite.some((l) => l.id.startsWith('viab_surface')),
      'pre-requis : la parcelle seule est bien sous le seuil',
    );

    const site = calculerScoreSite(petites, 'solaire_sol');
    assert.ok(
      !site.limitesViabilite.some((l) => l.id.startsWith('viab_surface')),
      'c’est la raison d’etre de l’agregation : 3 ha au total passent le seuil de 1 ha',
    );
  });
});

/**
 * Corrections E3 et E4 : deux grandeurs surestimees, chacune pesant lourd dans le score.
 *
 * E3 - la surface notee etait la surface CADASTRALE, sans deduire reculs, piste
 * peripherique ni acces des secours. L'ecart courant est de 15 a 30 %, d'autant plus fort
 * que la parcelle est petite ou decoupee.
 * E4 - la distance au poste etait celle du vol d'oiseau, alors qu'une liaison suit les
 * emprises publiques. Le critere pese jusqu'a 17,7 % du score (stockage).
 */
describe('surestimations corrigees : surface implantable et lineaire de raccordement', () => {
  it('deduit une bande perimetrale de la surface cadastrale', () => {
    const r = calculerScore(parcelleType(), 'solaire_sol');
    const surf = r.criteres.find((c) => c.id === 'surf_utile');
    assert.ok(surf, 'le critere de surface doit etre evalue');
    // 12 ha au cadastre, indice de morcellement 20 : la surface nette est inferieure.
    assert.ok(
      (surf.valeurBrute as number) < 12,
      `surface notee ${surf.valeurBrute} ha, elle devrait etre inferieure aux 12 ha cadastraux`,
    );
    assert.match(surf.valeurAffichee, /implantables/);
    assert.match(surf.valeurAffichee, /au cadastre/);
  });

  it('ne deduit rien en eolien, ou la surface se raisonne en positions de machines', () => {
    const r = calculerScore(parcelleType(), 'eolien_terrestre');
    const surf = r.criteres.find((c) => c.id === 'surf_utile');
    assert.equal(surf?.valeurBrute, 12, "aucune bande perimetrale n'a de sens pour un parc");
  });

  it('penalise davantage une parcelle decoupee, a surface cadastrale egale', () => {
    const compacte = calculerScore(
      parcelleType((p) => {
        p.foncier.morcellementIndice = 0;
      }),
      'solaire_sol',
    );
    const enLanieres = calculerScore(
      parcelleType((p) => {
        p.foncier.morcellementIndice = 100;
      }),
      'solaire_sol',
    );
    const a = compacte.criteres.find((c) => c.id === 'surf_utile')!.valeurBrute as number;
    const b = enLanieres.criteres.find((c) => c.id === 'surf_utile')!.valeurBrute as number;
    assert.ok(
      b < a,
      `une parcelle en lanieres (${b} ha) doit offrir moins que la meme compacte (${a} ha)`,
    );
  });

  it('applique le seuil economique a la surface implantable, non a la surface cadastrale', () => {
    // 0,65 ha au cadastre en solaire (minimum 1 ha) : brut = 65 % du seuil, donc aucune
    // limite ; net = environ 0,57 ha, soit sous les 60 % qui declenchent le plafonnement.
    const r = calculerScore(
      parcelleType((p) => {
        p.identite.contenanceM2 = 6500;
        p.identite.surfaceCalculeeM2 = 6500;
      }),
      'solaire_sol',
    );
    const limite = r.limitesViabilite.find((l) => l.id.startsWith('viab_surface'));
    assert.ok(limite, 'le seuil doit se juger sur la surface implantable');
    assert.match(limite.motif, /implantables/);
    assert.match(limite.motif, /au cadastre/);
  });

  it('note le lineaire de raccordement estime, et non la distance a vol d’oiseau', () => {
    const r = calculerScore(parcelleType(), 'bess');
    const racc = r.criteres.find((c) => c.id === 'racc_distance_poste');
    assert.ok(racc);
    // 4,2 km a vol d'oiseau -> 5,67 km de trace estime.
    assert.match(racc.valeurAffichee, /5,7 km de trace estime/);
    assert.match(racc.valeurAffichee, /4,2 km a vol d'oiseau/);
    // La valeur brute reste la mesure, pas l'estimation : c'est elle qui est tracable.
    assert.equal(racc.valeurBrute, 4.2);
  });

  it('le lineaire majore abaisse la note par rapport au vol d’oiseau', () => {
    // En stockage, la courbe est raide : 4,2 km note ~57, 5,67 km note ~45.
    const proche = calculerScore(
      parcelleType((p) => {
        p.raccordement.posteLePlusProche!.distanceKm = 4.2;
      }),
      'bess',
    );
    const noteAvecTrace = proche.criteres.find((c) => c.id === 'racc_distance_poste')!.note!;
    // Note qu'aurait donnee la distance a vol d'oiseau, obtenue en placant le poste
    // suffisamment pres pour que le trace estime vaille 4,2 km : 4,2 / 1,35 = 3,11 km.
    const equivalent = calculerScore(
      parcelleType((p) => {
        p.raccordement.posteLePlusProche!.distanceKm = 3.11;
      }),
      'bess',
    );
    const noteVolOiseau = equivalent.criteres.find((c) => c.id === 'racc_distance_poste')!.note!;
    assert.ok(
      noteAvecTrace < noteVolOiseau,
      `le trace majore doit penaliser : ${noteAvecTrace} devrait etre sous ${noteVolOiseau}`,
    );
  });
});

/**
 * Correction C3. La deduction de surface d'un site supposait une contiguite que rien ne
 * verifiait : le modele d'erosion perimetrale s'applique a UNE forme, et l'appliquer a la
 * somme des surfaces suppose une emprise unique. Sur dix parcelles de 0,3 ha dispersees,
 * l'erreur atteint 44 % — dans le sens de la surestimation, celui qui fait perdre des
 * visites.
 */
describe('contiguite d’un site', () => {
  const petites = (n: number): ParcelleSnapshot[] =>
    Array.from({ length: n }, (_, i) =>
      parcelleType((p) => {
        p.identite.idu = `283900000C09${String(10 + i).padStart(2, '0')}`;
        p.identite.contenanceM2 = 3000;
        p.identite.surfaceCalculeeM2 = 3000;
      }),
    );

  it('un site jointif garde le modele d’emprise unique', () => {
    const site = calculerScoreSite(petites(10), 'solaire_sol', {}, 1);
    assert.equal(site.nbGroupesContigus, 1);
    assert.equal(site.surfaceTotaleHa, 3);
    // Une seule bande perimetrale a deduire : environ 87 % de la surface cadastrale.
    assert.ok(site.surfaceUtileHa > 2.5, `surface utile ${site.surfaceUtileHa}`);
    assert.ok(
      !site.limitesViabilite.some((l) => l.id === 'site_disperse' || l.id === 'contiguite_inconnue'),
      'aucune reserve de dispersion sur un site jointif',
    );
  });

  it('un site disperse deduit une bande par groupe, et le dit', () => {
    const site = calculerScoreSite(petites(10), 'solaire_sol', {}, 10);
    // Dix clotures, dix pistes : la surface implantable chute nettement.
    assert.ok(site.surfaceUtileHa < 2, `surface utile ${site.surfaceUtileHa}`);
    const reserve = site.limitesViabilite.find((l) => l.id === 'site_disperse');
    assert.ok(reserve, 'la dispersion doit etre signalee');
    assert.equal(reserve!.statutMaximal, 'orange');
    // Le motif doit porter les deux chiffres : sans eux, la reserve n'est pas actionnable.
    assert.match(reserve!.motif, /10 groupes/);
    assert.match(reserve!.motif, /ha au cadastre/);
  });

  it('le site jointif offre plus de surface implantable que le meme site disperse', () => {
    const jointif = calculerScoreSite(petites(10), 'solaire_sol', {}, 1);
    const disperse = calculerScoreSite(petites(10), 'solaire_sol', {}, 10);
    assert.equal(jointif.surfaceTotaleHa, disperse.surfaceTotaleHa);
    assert.ok(
      jointif.surfaceUtileHa > disperse.surfaceUtileHa * 1.3,
      `l'ecart doit etre substantiel : ${jointif.surfaceUtileHa} vs ${disperse.surfaceUtileHa}`,
    );
  });

  it('une contiguite inconnue est traitee comme dispersee, et signalee', () => {
    const site = calculerScoreSite(petites(10), 'solaire_sol', {}, null);
    const disperse = calculerScoreSite(petites(10), 'solaire_sol', {}, 10);
    // Prudence : en l'absence d'information, on ne suppose pas la configuration favorable.
    assert.equal(site.surfaceUtileHa, disperse.surfaceUtileHa);
    const reserve = site.limitesViabilite.find((l) => l.id === 'contiguite_inconnue');
    assert.ok(reserve, "l'ignorance doit etre dite, pas masquee");
    assert.equal(reserve!.statutMaximal, 'orange');
  });

  it('une parcelle unique est contigue avec elle-meme, sans reserve', () => {
    const site = calculerScoreSite([parcelleType()], 'solaire_sol', {}, 1);
    assert.ok(
      !site.limitesViabilite.some((l) => l.id === 'contiguite_inconnue'),
      'une parcelle seule ne pose pas de question de contiguite',
    );
  });
});

/**
 * Points secondaires du troisieme audit.
 */
describe('reproductibilite et transparence', () => {
  it('deux calculs des memes entrees produisent le meme objet', () => {
    // `dateCalcul` rendait le resultat different a chaque appel : impossible de comparer deux
    // calculs par empreinte, donc impossible de detecter une derive du moteur ou d'eviter une
    // reecriture inutile en base.
    const p = parcelleType();
    const t = '2026-08-04T09:00:00.000Z';
    const a = calculerScore(p, 'solaire_sol', {}, t);
    const b = calculerScore(p, 'solaire_sol', {}, t);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'le resultat doit etre reproductible');
  });

  it('sans horodatage impose, le calcul reste horodate a l’instant courant', () => {
    const avant = Date.now();
    const r = calculerScore(parcelleType(), 'solaire_sol');
    const t = new Date(r.dateCalcul).getTime();
    assert.ok(t >= avant && t <= Date.now(), `dateCalcul hors bornes : ${r.dateCalcul}`);
  });

  it('un critere composite dit combien d’indicateurs ont servi', () => {
    const partiel = calculerScore(
      parcelleType((p) => {
        // Un seul des trois indicateurs de maitrise fonciere est renseigne.
        p.foncier.nbProprietairesEstime = 1;
        p.foncier.indivisionProbable = null;
        p.foncier.proprietairePublic = null;
      }),
      'solaire_sol',
    );
    const c = partiel.criteres.find((x) => x.id === 'fonc_maitrise');
    assert.ok(c, 'le critere doit etre evalue');
    assert.match(c!.valeurAffichee, /1\/3 indicateurs disponibles/);
    assert.match(c!.commentaire ?? '', /moins assuree/);
  });

  it('un critere composite complet n’ajoute aucune mention inutile', () => {
    const complet = calculerScore(
      parcelleType((p) => {
        p.foncier.nbProprietairesEstime = 1;
        p.foncier.indivisionProbable = false;
        p.foncier.proprietairePublic = false;
      }),
      'solaire_sol',
    );
    const c = complet.criteres.find((x) => x.id === 'fonc_maitrise')!;
    assert.ok(
      !/indicateurs disponibles/.test(c.valeurAffichee),
      'ne pas charger la lecture quand tout est renseigne',
    );
  });

  it('un zonage dominant indetermine est signale comme tel', () => {
    // Deux zonages, aucune part de recouvrement calculee : le « dominant » n'est alors que le
    // premier dans l'ordre de reponse du service, et il gouverne un knock-out.
    const r = calculerScore(
      parcelleType((p) => {
        p.urbanisme.couvertParGpu = true;
        p.urbanisme.zonages = [
          { libelle: 'A', typeZone: 'A', destinationDominante: null, urlReglement: null, dateApprobation: null, partRecouvrement: null },
          { libelle: 'N', typeZone: 'N', destinationDominante: null, urlReglement: null, dateApprobation: null, partRecouvrement: null },
        ];
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'urb_zonage')!;
    assert.match(c.valeurAffichee, /dominant indetermine/);
    assert.match(c.commentaire ?? '', /ordre de réponse du service/);
  });

  it('un zonage dominant etabli sur les surfaces n’est pas signale', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.urbanisme.couvertParGpu = true;
        p.urbanisme.zonages = [
          { libelle: 'A', typeZone: 'A', destinationDominante: null, urlReglement: null, dateApprobation: null, partRecouvrement: 0.8 },
          { libelle: 'N', typeZone: 'N', destinationDominante: null, urlReglement: null, dateApprobation: null, partRecouvrement: 0.2 },
        ];
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'urb_zonage')!;
    assert.ok(!/indetermine/.test(c.valeurAffichee));
  });
});

/**
 * Correction (audit 5, C1). Le raccourci « terrain plat » de `topo_orientation` etait place
 * APRES le test de nullite de l'orientation : une parcelle plate dont l'orientation etait
 * inconnue perdait le critere alors que sa platitude suffit a conclure.
 *
 * Le cas n'est pas theorique. Depuis que l'ajustement de plan rejette les regressions mal
 * conditionnees (audit 4), l'orientation est mise a `null` tout en laissant une pente issue
 * du repli par paires — soit 17 % des parcelles mesurees sur un echantillon reel.
 */
describe('topo_orientation — platitude et orientation inconnue', () => {
  it('conclut sur la platitude meme sans orientation connue', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.topographie.pentePct = 1.4;
        p.topographie.orientationDeg = null;
        p.topographie.penteEstimeeParPaires = true;
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'topo_orientation')!;
    assert.equal(c.note, 95, "la platitude suffit a noter le critere");
    assert.equal(c.feu === 'gris', false, 'le critere ne doit plus etre grise');
    assert.match(c.valeurAffichee, /plat/);
    assert.equal(c.valeurBrute, null, "la valeur brute reste absente : rien n'est invente");
  });

  it('reste indisponible si ni l’orientation ni la pente ne sont connues', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.topographie.pentePct = null;
        p.topographie.orientationDeg = null;
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'topo_orientation')!;
    assert.equal(c.note, null);
    assert.equal(c.feu, 'gris');
  });

  it('note l’orientation lorsque la pente la rend determinante', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.topographie.pentePct = 9;
        p.topographie.orientationDeg = 180;
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'topo_orientation')!;
    assert.equal(c.note, 100, 'plein sud sur pente franche');
    assert.match(c.valeurAffichee, /sud/);
  });

  it('penalise une orientation nord sur pente franche', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.topographie.pentePct = 9;
        p.topographie.orientationDeg = 0;
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'topo_orientation')!;
    assert.equal(c.note, 5);
  });

  it('une pente franche sans orientation connue laisse le critere indisponible', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.topographie.pentePct = 9;
        p.topographie.orientationDeg = null;
      }),
      'solaire_sol',
    );
    const c = r.criteres.find((x) => x.id === 'topo_orientation')!;
    assert.equal(c.note, null, "sur pente franche, l'orientation ne peut pas etre devinee");
    assert.equal(c.feu, 'gris');
  });
});
