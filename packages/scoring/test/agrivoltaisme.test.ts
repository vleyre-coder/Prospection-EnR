/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * L'AGRIVOLTAISME TRIE A L'INVERSE DU SOLAIRE AU SOL — et rien n'echoue s'il ne le fait pas
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE JOUE ICI. Les deux filieres partagent leurs criteres, leurs procedures et leurs
 * articles de loi. Elles partagent tout, SAUF ce qu'elles cherchent :
 *
 *   - le solaire au sol cherche un terrain que l'agriculture a QUITTE ;
 *   - l'agrivoltaisme cherche un terrain qu'elle OCCUPE ENCORE, et dont elle continuera de vivre.
 *     C'est la condition meme du regime (L.314-36 du code de l'energie), et le referentiel en tire
 *     cinq contraintes redhibitoires.
 *
 * Reprendre la table de notes du solaire au sol pour cette filiere-ci serait donc le defaut le
 * plus couteux possible — et il ne leverait AUCUNE erreur. Le classement remonterait en tete
 * exactement les parcelles ou le projet est impossible, et relegerait celles qu'il faut
 * prospecter. Un operateur lirait une liste triee, plausible, et entierement a l'envers.
 *
 * LE MEME PIEGE VAUT POUR LES KNOCK-OUTS ET POUR LES COMMENTAIRES : une regle ecrite pour une
 * filiere et servie a l'autre produit une phrase juste sur le mauvais objet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FILIERES, FILIERES_META, snapshotVide, type ParcelleSnapshot, type TypeSol } from '@enr/core';
import { calculerScore } from '../dist/index.js';

/** Un releve minimal dont seule la nature du sol varie. */
function surSol(t: TypeSol): ParcelleSnapshot {
  const s = snapshotVide('283900000A0094');
  s.occupationSol.typeSol = t;
  return s;
}

/** La note du critere de nature du sol pour une filiere et un sol donnes. */
function noteSol(t: TypeSol, filiere: 'solaire_sol' | 'agrivoltaisme'): number | null {
  const r = calculerScore(surSol(t), filiere, {});
  return r.criteres.find((c) => c.id === 'sol_type')?.note ?? null;
}

describe('la nature du sol se lit dans les deux sens', () => {
  it('UNE PARCELLE CULTIVEE EST LE MEILLEUR SITE AGRIVOLTAIQUE, ET LE MOINS BON EN SOLAIRE AU SOL', () => {
    const cultivee = { agri: noteSol('agricole_exploite', 'agrivoltaisme'), pv: noteSol('agricole_exploite', 'solaire_sol') };
    const artificielle = { agri: noteSol('artificialise', 'agrivoltaisme'), pv: noteSol('artificialise', 'solaire_sol') };

    assert.ok(cultivee.agri != null && artificielle.agri != null);
    assert.ok(cultivee.pv != null && artificielle.pv != null);

    /*
     * L'INVARIANT, ET IL EST STRICT. Ce n'est pas « l'agrivoltaisme aime un peu plus l'agricole » :
     * l'ordre des deux natures de sol doit etre RENVERSE d'une filiere a l'autre.
     */
    assert.ok(
      cultivee.agri > artificielle.agri,
      `agrivoltaisme : une parcelle cultivee (${cultivee.agri}) doit primer sur une parcelle ` +
        `artificialisee (${artificielle.agri}) — c'est la condition du regime`,
    );
    assert.ok(
      artificielle.pv > cultivee.pv,
      `solaire au sol : l'ordre doit etre l'inverse (${artificielle.pv} contre ${cultivee.pv})`,
    );
  });

  it('un terrain inculte releve du photovoltaique au sol, pas de l’agrivoltaisme', () => {
    /*
     * « Inculte » evoque un terrain disponible, et c'en est un — pour l'AUTRE filiere. Le
     * referentiel le rattache au regime B : « liste des terrains eligibles au PV au sol : non
     * exploite depuis ≥ 10 ans ». Sans production agricole a maintenir, le regime agrivoltaique ne
     * s'applique pas.
     */
    const inculte = noteSol('inculte', 'agrivoltaisme');
    const cultivee = noteSol('agricole_exploite', 'agrivoltaisme');
    assert.ok(inculte != null && cultivee != null);
    assert.ok(
      inculte < cultivee,
      `un terrain inculte (${inculte}) ne peut pas valoir une parcelle cultivee (${cultivee}) en ` +
        'agrivoltaisme : il n’y a pas d’activite agricole a maintenir',
    );

    // Et le commentaire le DIT, au lieu de laisser l'operateur deviner pourquoi la note est basse.
    const r = calculerScore(surSol('inculte'), 'agrivoltaisme', {});
    const c = r.criteres.find((x) => x.id === 'sol_type');
    assert.match(
      c?.commentaire ?? '',
      /photovoltaïque au sol/i,
      'le commentaire doit orienter vers la filiere qui convient',
    );
  });

  it('le commentaire d’une parcelle artificialisee ne dit pas l’inverse selon la filiere', () => {
    /*
     * « Terrain deja anthropise : configuration la plus favorable » est juste pour le solaire au
     * sol et FAUX pour l'agrivoltaisme. Une phrase ecrite pour une filiere et servie a l'autre est
     * le meme defaut que la table de notes, deplace dans le texte.
     */
    const agri = calculerScore(surSol('artificialise'), 'agrivoltaisme', {}).criteres.find(
      (x) => x.id === 'sol_type',
    );
    assert.doesNotMatch(
      agri?.commentaire ?? '',
      /la plus favorable/i,
      'une parcelle artificialisee n’est pas une configuration favorable en agrivoltaisme',
    );
  });
});

describe('les knock-outs d’une filiere ne debordent pas sur l’autre', () => {
  it('LE DOCUMENT-CADRE DEPARTEMENTAL NE BLOQUE PAS UN PROJET AGRIVOLTAIQUE', () => {
    /*
     * Il gouverne la liste des terrains eligibles au photovoltaique AU SOL — le regime B, celui
     * qui n'est precisement pas l'agrivoltaisme. L'y appliquer emettrait un blocage tire d'un
     * dispositif qui ne concerne pas la filiere : la donnee est juste, son application est fausse.
     */
    const s = surSol('inculte');
    s.urbanisme.documentCadrePvSol.departementCouvert = true;
    s.urbanisme.documentCadrePvSol.parcelleEligible = false;

    const pv = calculerScore(s, 'solaire_sol', {}).knockOuts.map((k) => k.id);
    const agri = calculerScore(s, 'agrivoltaisme', {}).knockOuts.map((k) => k.id);

    assert.ok(
      pv.includes('ko_hors_document_cadre'),
      'le solaire au sol doit bien etre bloque : c’est son regime',
    );
    assert.ok(
      !agri.includes('ko_hors_document_cadre'),
      'l’agrivoltaisme ne doit pas heriter du blocage d’un regime qui n’est pas le sien',
    );
  });

  it('L’AOP VITICOLE NE BLOQUE PAS UN PROJET AGRIVOLTAIQUE', () => {
    /*
     * L'opposition de l'INAO vise l'ARTIFICIALISATION des aires delimitees, qu'un projet
     * agrivoltaique ne produit pas : la vigne reste. Et le referentiel le confirme — sur les 52
     * contraintes d'agrivoltaisme, aucune ne porte sur une AOP, alors que le solaire au sol en
     * porte une.
     */
    const s = surSol('agricole_exploite');
    s.occupationSol.aop.presente = true;
    s.occupationSol.aop.viticole = true;

    assert.ok(calculerScore(s, 'solaire_sol', {}).knockOuts.some((k) => k.id === 'ko_aop_viticole'));
    assert.ok(
      !calculerScore(s, 'agrivoltaisme', {}).knockOuts.some((k) => k.id === 'ko_aop_viticole'),
      'aucune contrainte AOP n’existe en agrivoltaisme dans le referentiel',
    );
  });
});

describe('ce qui s’imprime dans un document remis a un tiers', () => {
  it('AUCUNE VALEUR D’ENUMERATION BRUTE NE TIENT LIEU DE NOM D’ENTREPRISE', () => {
    /*
     * « Poste de transformation 90 kV (autre_grd) » s'imprimait dans la SYNTHESE du rapport remis
     * a un proprietaire — une cle de code donnee pour un nom de gestionnaire. Le cas ne s'etait
     * jamais vu parce que les parcelles relues avaient RTE ou Enedis pour poste le plus proche ;
     * 1 967 postes du jeu national tombent pourtant dans cette troisieme valeur.
     */
    const s = surSol('agricole_exploite');
    s.raccordement.posteLePlusProche = {
      id: 'essai',
      nom: 'Poste de transformation 90 kV',
      tension: '90 kV',
      enProjet: false,
      distanceKm: 7.37,
      gestionnaire: 'autre_grd',
      renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
      fileAttenteMw: null,
      etatSaturation: null,
      quotePartEurParKw: null,
      capaciteResiduelleMw: null,
    };
    const c = calculerScore(s, 'agrivoltaisme', {}).criteres.find(
      (x) => x.id === 'racc_distance_poste',
    );
    assert.ok(c, 'le critere de distance au poste doit etre evalue');
    assert.doesNotMatch(
      c.valeurAffichee ?? '',
      /autre_grd/,
      `valeur d’enumeration brute affichee : « ${c.valeurAffichee} »`,
    );
    assert.match(c.valeurAffichee ?? '', /gestionnaire de distribution/);
  });
});

describe('la filiere est complete, pas seulement declaree', () => {
  it('les cinq filieres du referentiel ont leurs metadonnees et leurs ponderations', () => {
    /*
     * Le compilateur tient deja les `Record<Filiere, …>`. Ce test tient ce qu'il ne voit pas : une
     * filiere declaree dont le score ne se calcule pas, ou se calcule a vide.
     */
    assert.equal(FILIERES.length, 5);
    for (const f of FILIERES) {
      assert.ok(FILIERES_META[f].libelle.length > 0, `${f} : pas de libelle`);
      const r = calculerScore(surSol('agricole_exploite'), f, {});
      assert.ok(r.criteres.length > 0, `${f} : aucun critere evalue`);
      assert.ok(
        r.seuilsProcedure.length > 0,
        `${f} : aucune procedure annoncee — un dossier muet sur ses autorisations`,
      );
    }
  });
});
