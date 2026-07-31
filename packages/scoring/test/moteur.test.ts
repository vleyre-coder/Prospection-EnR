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

  it('ecarte en rouge une habitation a moins de 500 m en eolien, mais pas en solaire', () => {
    const s = parcelleType((p) => {
      p.bati.distanceHabitationM = 320;
    });
    const eolien = calculerScore(s, 'eolien_terrestre');
    assert.equal(eolien.statut, 'rouge');
    assert.equal(eolien.scoreGlobal, null);
    assert.ok(eolien.knockOuts.some((k) => k.id === 'ko_eol_habitation_500'));

    const solaire = calculerScore(s, 'solaire_sol');
    assert.equal(solaire.knockOuts.length, 0);
    assert.equal(solaire.statut, 'vert');
  });

  it('ecarte la methanisation en dessous de 200 m des habitations', () => {
    const r = calculerScore(
      parcelleType((p) => {
        p.bati.distanceHabitationM = 150;
      }),
      'methanisation',
    );
    assert.equal(r.statut, 'rouge');
    assert.ok(r.knockOuts.some((k) => k.id === 'ko_metha_habitation_200'));
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
