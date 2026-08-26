/**
 * Les autorisations transversales, et l'honnetete de leur applicabilite.
 *
 * POURQUOI CE FICHIER EXISTE. Quatre autorisations decident du CALENDRIER d'un projet ENR et
 * n'apparaissaient nulle part dans l'application : defrichement, especes protegees, evaluation des
 * incidences Natura 2000, archeologie preventive. Les taire revient a laisser un prospecteur promettre
 * une date qu'il ne tiendra pas — et pour le defrichement, a ignorer une compensation qui peut atteindre
 * plusieurs fois la surface defrichee.
 *
 * CE QUE CE FICHIER VERROUILLE, et c'est plus subtil que leur simple presence :
 *
 *   1. les quatre procedures sont rappelees sur les QUATRE filieres — elles ne dependent pas de la
 *      technologie, et une regle transversale oubliee sur une seule filiere est le mode de defaillance
 *      le plus discret ;
 *   2. leur applicabilite est CALCULEE quand la donnee existe, et laissee a `null` sinon. C'est le point
 *      important : `preEnjeuEspeces` et `sensibiliteArcheologique` sont mis a `null` par les connecteurs,
 *      DELIBEREMENT — le premier portait une valeur inventee, retiree a l'audit 6. Annoncer « non
 *      applicable » sur une donnee absente serait exactement le defaut fondateur de ces audits, et il
 *      serait invisible : une ligne verte « non applicable » ne reveille personne.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILIERES, identiteDepuisIdu, snapshotVide, type Filiere, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

const TRANSVERSALES = [
  'commun_defrichement',
  'commun_especes_protegees',
  'commun_natura2000_incidences',
  'commun_archeologie_preventive',
];

function snapshot(poser: (s: ParcelleSnapshot) => void = () => undefined): ParcelleSnapshot {
  const s = snapshotVide(identiteDepuisIdu('28390000ZT0001', 'Commune de test'));
  s.identite.surfaceCalculeeM2 = 200_000;
  poser(s);
  return s;
}

function seuils(s: ParcelleSnapshot, filiere: Filiere): Map<string, boolean | null> {
  const r = calculerScore(s, filiere, {});
  return new Map(r.seuilsProcedure.map((x) => [x.regleId, x.applicable]));
}

test('LES QUATRE AUTORISATIONS TRANSVERSALES sont rappelees sur les quatre filieres', () => {
  const manquants: string[] = [];
  for (const f of FILIERES) {
    const presents = seuils(snapshot(), f);
    for (const id of TRANSVERSALES) {
      if (!presents.has(id)) manquants.push(`${f} : ${id}`);
    }
  }
  assert.deepEqual(
    manquants,
    [],
    `autorisation(s) transversale(s) absente(s) : ${manquants.join(' ; ')}. Elles ne dependent pas de ` +
      'la filiere : les oublier sur une seule laisse croire que la procedure n’existe pas.',
  );
});

test('LE DEFRICHEMENT SUIT LA MESURE : boise -> applicable, non boise -> non, inconnu -> a verifier', () => {
  /**
   * `enjeuDefrichement` est la SEULE des quatre a etre reellement mesuree — l'enrichissement la deduit
   * de la couverture forestiere ingeree. Elle etait pourtant exploitee par AUCUNE regle de scoring :
   * une donnee collectee et jetee.
   */
  const boise = seuils(
    snapshot((s) => {
      s.milieux.enjeuDefrichement = true;
      s.occupationSol.foret = { recouvre: true, partBoisee: 0.6, type: null };
    }),
    'solaire_sol',
  );
  assert.equal(boise.get('commun_defrichement'), true);

  const nu = seuils(
    snapshot((s) => {
      s.milieux.enjeuDefrichement = false;
    }),
    'solaire_sol',
  );
  assert.equal(nu.get('commun_defrichement'), false);

  // Couche forestiere non ingeree : on ne conclut pas.
  assert.equal(seuils(snapshot(), 'solaire_sol').get('commun_defrichement'), null);
});

test('LES ESPECES PROTEGEES ET L’ARCHEOLOGIE RESTENT « A VERIFIER », toujours', () => {
  /**
   * L'invariant d'honnetete de ce fichier. Aucune source nationale ne prejuge ces deux enjeux a la
   * parcelle : les connecteurs mettent les champs a `null` a dessein. Une applicabilite affirmee — dans
   * un sens ou dans l'autre — serait une invention, et la plus dangereuse des trois formes possibles,
   * puisqu'un « non applicable » rassure.
   */
  for (const f of FILIERES) {
    const p = seuils(
      snapshot((s) => {
        // Meme en posant tout ce que l'on peut poser autour, la reponse doit rester « a verifier ».
        s.milieux.enjeuDefrichement = true;
        s.occupationSol.typeSol = 'agricole_exploite';
      }),
      f,
    );
    assert.equal(p.get('commun_especes_protegees'), null, `${f} : especes protegees`);
    assert.equal(p.get('commun_archeologie_preventive'), null, `${f} : archeologie preventive`);
  }
});

test('L’EVALUATION NATURA 2000 est due au recouvrement ET a la proximite', () => {
  // Le point de droit qui compte : l'evaluation est due meme HORS du site, des lors que le projet est
  // susceptible de l'affecter. Conclure « non » sur la seule absence de recouvrement serait faux.
  const dedans = seuils(
    snapshot((s) => {
      s.milieux.natura2000Habitats = { recouvre: true, partRecouvrement: 1, distanceM: 0, nom: 'Site' };
    }),
    'eolien_terrestre',
  );
  assert.equal(dedans.get('commun_natura2000_incidences'), true);

  const proche = seuils(
    snapshot((s) => {
      s.milieux.natura2000Oiseaux = { recouvre: false, partRecouvrement: 0, distanceM: 1200, nom: 'Site' };
    }),
    'eolien_terrestre',
  );
  assert.equal(proche.get('commun_natura2000_incidences'), true, 'a 1,2 km, l’evaluation reste due');

  const loin = seuils(
    snapshot((s) => {
      s.milieux.natura2000Oiseaux = { recouvre: false, partRecouvrement: 0, distanceM: 30_000, nom: 'Site' };
    }),
    'eolien_terrestre',
  );
  assert.equal(loin.get('commun_natura2000_incidences'), false, 'a 30 km, elle ne l’est plus');

  assert.equal(
    seuils(snapshot(), 'eolien_terrestre').get('commun_natura2000_incidences'),
    null,
    'couche non ingeree : on ne conclut pas',
  );
});

test('CHAQUE FILIERE PORTE SES PROPRES RAPPELS, et pas ceux des autres', () => {
  /**
   * Sans cela, un rappel ajoute au mauvais bloc passerait inapercu : il s'afficherait simplement sur une
   * filiere qui ne le concerne pas, ce qui use la confiance dans tous les autres.
   */
  const attendus: Record<Filiere, string[]> = {
    solaire_sol: ['pv_compensation_agricole', 'pv_demantelement'],
    eolien_terrestre: ['eol_faisceaux_hertziens', 'eol_autorisation_environnementale'],
    bess: ['bess_acces_engins', 'bess_effets_domino', 'bess_raccordement_s3renr'],
    methanisation: ['metha_sous_produits_animaux', 'metha_acces_engins'],
  };
  const fautes: string[] = [];
  for (const f of FILIERES) {
    const presents = seuils(snapshot(), f);
    for (const id of attendus[f]) {
      if (!presents.has(id)) fautes.push(`${f} : ${id} absent`);
    }
    for (const [autre, ids] of Object.entries(attendus)) {
      if (autre === f) continue;
      for (const id of ids) {
        if (presents.has(id)) fautes.push(`${f} : ${id} ne devrait pas y figurer`);
      }
    }
  }
  assert.deepEqual(fautes, [], fautes.join(' ; '));
});

test('la compensation agricole suit la nature du sol, jamais la puissance', () => {
  // Le seuil de surface est fixe par arrete PREFECTORAL : l'application ne peut pas trancher sur la
  // surface, et ne le pretend pas. Elle se prononce sur ce qu'elle sait — la nature du sol.
  const agricole = seuils(
    snapshot((s) => {
      s.occupationSol.typeSol = 'agricole_exploite';
    }),
    'solaire_sol',
  );
  assert.equal(agricole.get('pv_compensation_agricole'), true);

  const artificialise = seuils(
    snapshot((s) => {
      s.occupationSol.typeSol = 'artificialise';
    }),
    'solaire_sol',
  );
  assert.equal(artificialise.get('pv_compensation_agricole'), false);

  assert.equal(seuils(snapshot(), 'solaire_sol').get('pv_compensation_agricole'), null);
});
