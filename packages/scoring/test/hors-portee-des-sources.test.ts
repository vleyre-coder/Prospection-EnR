/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * TROIS FAÇONS DE NE PAS SAVOIR, ET ELLES NE SE COMPTENT PAS PAREIL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   - INDISPONIBLE : la donnée existe et n'a pas pu être lue pour CETTE parcelle — une source en
 *     panne, une parcelle hors couverture. Elle reste au dénominateur de couverture, parce qu'on
 *     aurait dû l'avoir. C'est ce qui fait basculer une filière en gris, et c'est justifié.
 *   - SANS SOURCE SUR LE TERRITOIRE : la couche existe mais n'est pas ingérée ici. Hors
 *     dénominateur — elle manque identiquement à toutes les parcelles d'ici, donc ne discrimine
 *     rien — et elle plafonne le statut à orange.
 *   - HORS DE PORTÉE DES SOURCES : aucune source nationale ne l'expose à la parcelle, et aucune
 *     ingestion ne le changera. Même traitement que la précédente, texte différent : il ne faut
 *     pas laisser croire qu'un `npm run ingest` y remédierait.
 *
 * ═══ CE QUE CE FICHIER GARDE
 *
 * Deux critères étaient classés INDISPONIBLES alors que le code qui les alimente met leur donnée à
 * `null` **délibérément, avec le raisonnement écrit** :
 *
 *   - `env_especes_protegees` — `preEnjeuEspeces` a été mis à `null` à l'audit 8 parce que sa
 *     dérivation comptait deux fois les mêmes couches (7,0 % du poids éolien en double comptage).
 *     Un enjeu espèces se détermine par un inventaire sur un cycle biologique complet.
 *   - `fonc_maitrise` — ses trois indicateurs sont nuls par construction : le nombre de comptes
 *     cadastraux n'est pas déductible de la structure parcellaire, et la donnée nominative n'est
 *     accessible par aucune API publique.
 *
 * Les compter comme indisponibles faisait chuter la couverture de la même quantité sur TOUTES les
 * parcelles de France, pour une donnée que personne ne peut obtenir par API.
 *
 * ═══ CE QUE CE CHANGEMENT NE DOIT PAS FAIRE, ET QUE CE FICHIER VÉRIFIE
 *
 * Il ne donne de note à personne, ne fait monter aucun score, et **ne peut rendre aucune parcelle
 * propice** : la limite `criteres_sans_source` plafonne le statut à orange précisément pour cela.
 * Un reclassement qui lèverait ce plafond transformerait une correction d'honnêteté en complaisance,
 * et c'est le seul risque réel de ce changement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '28390000ZL0030',
      codeInsee: '28390',
      nomCommune: 'Tillay-le-Péneux',
      prefixe: '000',
      section: 'ZL',
      numero: '0030',
      contenanceM2: 73100,
      surfaceCalculeeM2: 73100,
      centroide: [1.77236, 48.14363],
      codeDepartement: '28',
    },
    '2026-09-28T09:00:00.000Z',
  );
}

/** Les critères déclarés sans source, tels que le moteur les expose dans ses limites. */
function limiteSansSource(filiere: 'eolien_terrestre' | 'solaire_sol' | 'agrivoltaisme') {
  const r = calculerScore(snapshot(), filiere);
  return r.limitesViabilite.find((l) => l.id === 'criteres_sans_source');
}

test('L’ENJEU ESPECES EST DECLARE HORS DE PORTEE DES SOURCES, SUR LES TROIS FILIERES CONCERNEES', () => {
  for (const filiere of ['eolien_terrestre', 'solaire_sol', 'agrivoltaisme'] as const) {
    const r = calculerScore(snapshot(), filiere);
    const c = r.criteres.find((x) => x.id === 'env_especes_protegees');
    assert.ok(c, `${filiere} : critère absent`);
    assert.equal(c.note, null);
    assert.match(
      c.commentaire ?? '',
      /aucune source nationale/i,
      `${filiere} : le texte doit dire qu’aucune ingestion n’y remédiera`,
    );
    /*
     * ET IL DOIT DIRE OU CHERCHER. Un critère hors de portée des sources n'est pas une impasse :
     * c'est une tâche pour le développeur, et le document doit la nommer.
     */
    assert.match(c.commentaire ?? '', /inventaire|DREAL|LPO|INPN/i);
  }
});

test('LA MAITRISE FONCIERE AUSSI, ET ELLE DIT COMMENT L’OBTENIR', () => {
  const r = calculerScore(snapshot(), 'agrivoltaisme');
  const c = r.criteres.find((x) => x.id === 'fonc_maitrise');
  assert.ok(c);
  assert.equal(c.note, null);
  assert.match(c.commentaire ?? '', /aucune source nationale/i);
  assert.match(
    c.commentaire ?? '',
    /publicité foncière|DGFiP|mairie/i,
    'la donnée existe et s’obtient : le document doit dire par quelle voie',
  );
});

test('LE RECLASSEMENT SORT CES CRITERES DU DENOMINATEUR — C’EST TOUT SON EFFET', () => {
  /**
   * LA MESURE QUI JUSTIFIE LE CHANGEMENT. `couvertureDonnees` répond à « parmi ce qui était
   * connaissable ici, qu'a-t-on su ? ». Une donnée que personne ne peut obtenir par API n'était pas
   * connaissable : la compter au dénominateur faisait mentir le chiffre dans le sens pessimiste, et
   * pouvait faire basculer une filière entière en gris pour un manque que nul ne peut combler.
   *
   * Le second chiffre, lui, ne bouge pas : le sujet complet reste le sujet complet. C'est
   * exactement la raison d'être des deux chiffres.
   */
  const r = calculerScore(snapshot(), 'eolien_terrestre');
  assert.ok(
    r.couvertureDonnees >= r.couvertureCatalogue,
    'le mesurable ne peut pas être inférieur au sujet complet',
  );
});

test('AUCUNE PARCELLE NE DEVIENT PROPICE : LE PLAFOND ORANGE TIENT', () => {
  /**
   * LE SEUL RISQUE REEL DE CE CHANGEMENT, et le garde qui l'interdit.
   *
   * Sortir un critère du dénominateur fait monter la couverture. Si ce mouvement suffisait à lever
   * le plafond, une correction d'honnêteté deviendrait une complaisance : la parcelle passerait
   * verte parce qu'on a cessé de compter ce qu'on ignore. La limite `criteres_sans_source` existe
   * pour cela, et elle doit rester déclenchée sur ces filières.
   */
  for (const filiere of ['eolien_terrestre', 'solaire_sol', 'agrivoltaisme'] as const) {
    const limite = limiteSansSource(filiere);
    assert.ok(limite, `${filiere} : la limite « critères sans source » doit être posée`);
    assert.equal(
      limite.statutMaximal,
      'orange',
      `${filiere} : aucune parcelle ne peut être déclarée propice sur un enjeu que personne n’a regardé`,
    );
    const r = calculerScore(snapshot(), filiere);
    assert.notEqual(r.statut, 'vert', `${filiere} : le plafond doit tenir sur le statut rendu`);
  }
});

test('LA LIMITE NOMME LES CRITERES CONCERNES, ELLE NE SE CONTENTE PAS DE LES COMPTER', () => {
  /*
   * Un plafond sans motif lisible est un plafond qu'on lève sans réfléchir. Le libellé doit porter
   * les libellés des critères, pour que le lecteur sache ce qui reste à regarder.
   */
  const limite = limiteSansSource('eolien_terrestre');
  assert.ok(limite);
  assert.match(limite.motif, /espèces|Maîtrise foncière|propriétaires/i);
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN KNOCK-OUT NON DÉROGEABLE DOIT CITER SON ARTICLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un knock-out non dérogeable ÉCARTE la parcelle : statut rouge, score annulé, sortie des listes et
 * des sites. C'est le verdict le plus lourd de l'application, et il n'est légitime que s'il traduit
 * une **interdiction** — pas une difficulté, pas un coût, pas un indicateur défavorable.
 *
 * Au 28/09/2026, deux knock-outs non dérogeables ne citaient aucune règle. Ce n'était pas un oubli
 * de documentation, c'était le symptôme :
 *
 *   - `ko_poste_sature` écartait 100 parcelles sur 301 dans les cinq filières sur une saturation de
 *     réseau, que le référentiel ne régit pas parce qu'aucun texte ne la régit ;
 *   - `ko_eol_servitude_aero` affirmait l'incompatibilité d'un aérogénérateur avec une servitude
 *     aéronautique, alors que l'application connaît l'assiette de la servitude mais **pas la cote
 *     de hauteur qu'elle autorise** — et son motif renvoyait au plan de servitudes dans la phrase
 *     suivante.
 *
 * La surcharge de `ko()` rend désormais ce cas inécrivable : sans `regleLiee`, un knock-out ne peut
 * être que dérogeable. Ce test le vérifie sur les knock-outs RÉELLEMENT PRODUITS, parce qu'une
 * garantie de type se contourne par un `as` et que celle-ci mérite les deux.
 */
test('AUCUN KNOCK-OUT N’ECARTE UNE PARCELLE SANS CITER SON FONDEMENT', () => {
  const sansFondement: string[] = [];
  let observes = 0;

  for (const filiere of ['methanisation', 'eolien_terrestre', 'solaire_sol', 'bess', 'agrivoltaisme'] as const) {
    for (const declencheur of declencheurs()) {
      const s = snapshot();
      declencheur(s);
      for (const k of calculerScore(s, filiere).knockOuts) {
        observes += 1;
        if (!k.derogeable && !k.regleLiee) sansFondement.push(`${filiere}/${k.id}`);
      }
    }
  }

  /*
   * UN TEST QUI N'OBSERVE RIEN NE GARDE RIEN. Si les déclencheurs cessaient de déclencher — un
   * champ renommé, un seuil déplacé — la boucle passerait à vide et ce garde deviendrait décoratif
   * sans que rien ne le dise.
   */
  assert.ok(observes >= 5, `aucun knock-out déclenché (${observes}) : les déclencheurs ne déclenchent plus`);
  assert.deepEqual(
    [...new Set(sansFondement)],
    [],
    'un knock-out qui écarte définitivement doit dire de quel droit — sinon il plafonne à orange',
  );
});

/** Situations qui déclenchent des knock-outs de familles différentes. */
function declencheurs(): Array<(s: ParcelleSnapshot) => void> {
  return [
    (s) => {
      s.raccordement.posteLePlusProche = {
        id: 'X',
        nom: 'POSTE SATURE',
        gestionnaire: 'RTE',
        tension: 'HTA',
        distanceKm: 5,
        capaciteResiduelleMw: 0,
        etatSaturation: 'sature',
        fileAttenteMw: null,
        quotePartEurParKw: null,
        renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
        enProjet: false,
      };
      s.raccordement.postesAlternatifs = [];
    },
    // Habitation trop proche : le recul reglementaire devient inatteignable, quelle que soit la
    // surface. C'est le knock-out le plus lourd de l'eolien et de la methanisation.
    (s) => {
      s.bati.distanceHabitationM = 10;
      s.identite.contenanceM2 = 5000;
    },
    (s) => {
      s.risques.servitudesAeronautiques = true;
    },
    (s) => {
      s.patrimoine.siteClasse.recouvre = true;
    },
    (s) => {
      s.bati.distanceZoneHabitatM = 50;
    },
  ];
}
