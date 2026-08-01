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
    distanceKm: 3.5,
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
