/**
 * Typographie française des chaînes produites par le moteur.
 *
 * POURQUOI CE FICHIER EXISTE — audit 10, défaut B1. Le moteur ne renvoie pas seulement des nombres :
 * il renvoie des PHRASES, et ces phrases sont le livrable. Elles s'affichent dans la fiche parcelle,
 * elles sont imprimées telles quelles dans le rapport PDF remis à un propriétaire ou à un financeur,
 * et elles partent dans les exports.
 *
 * Le moteur dispose de `formatNombre` et `formatDistance`, qui écrivent la virgule décimale. Quatre
 * endroits les contournaient et interpolaient le nombre brut. Le résultat mélangeait les deux
 * conventions **dans une même phrase** :
 *
 *   « La parcelle offre environ 0,14 ha implantables (0,37 ha au cadastre), en dessous de la surface
 *     minimale indicative de 0.5 ha pour la filière Stockage. »
 *
 * Mesure avant correction, sur les 439 parcelles réelles de la base de développement et les quatre
 * filières : **591 occurrences réparties sur 4 champs**. Après : zéro.
 *
 * CE QUE CE TEST GARDE, et pourquoi il vaut mieux qu'une relecture. Il n'inspecte pas le code, il
 * inspecte les chaînes RÉELLEMENT PRODUITES. Un nouveau critère, un nouveau seuil de procédure ou un
 * nouveau motif de knock-out qui interpolerait un nombre brut serait pris immédiatement, sans que
 * personne ait à se souvenir de la règle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILIERES, identiteDepuisIdu, snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

/**
 * Un point décimal entre deux chiffres. Les versions de logiciel (« PLU 2.1 »), les numéros
 * d'articles et les adresses IP passeraient aussi, mais le moteur n'en produit pas : le motif reste
 * donc volontairement large, et c'est ce qui en fait un garde utile.
 */
const POINT_DECIMAL = /\d\.\d/;

/**
 * Snapshots choisis pour ATTEINDRE les phrases à nombres.
 *
 * Une parcelle « vide » ne déclenche ni limite de viabilité ni seuil de procédure : le test passerait
 * à vide. Il faut donc une surface petite (pour les deux limites de surface) et une puissance
 * estimable (pour les seuils de procédure du photovoltaïque).
 */
function cas(): Array<{ nom: string; snapshot: ParcelleSnapshot }> {
  const petite = snapshotVide(identiteDepuisIdu('283900000C0843', 'Tillay-le-Peneux'));
  petite.identite.contenanceM2 = 3_700;
  petite.identite.surfaceCalculeeM2 = 3_700;

  const minuscule = snapshotVide(identiteDepuisIdu('283900000C0844', 'Tillay-le-Peneux'));
  minuscule.identite.contenanceM2 = 900;
  minuscule.identite.surfaceCalculeeM2 = 900;

  const moyenne = snapshotVide(identiteDepuisIdu('28390000ZK0001', 'Tillay-le-Peneux'));
  moyenne.identite.contenanceM2 = 7_700;
  moyenne.identite.surfaceCalculeeM2 = 7_700;
  moyenne.occupationSol.typeSol = 'agricole_exploite';

  const grande = snapshotVide(identiteDepuisIdu('28390000ZT0001', 'Tillay-le-Peneux'));
  grande.identite.contenanceM2 = 671_400;
  grande.identite.surfaceCalculeeM2 = 671_400;

  return [
    { nom: 'parcelle minuscule', snapshot: minuscule },
    { nom: 'parcelle petite', snapshot: petite },
    { nom: 'parcelle moyenne agricole', snapshot: moyenne },
    { nom: 'grande parcelle', snapshot: grande },
  ];
}

/** Toutes les chaînes destinées à l'utilisateur, avec leur provenance. */
function chainesVisibles(s: ReturnType<typeof calculerScore>): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  for (const c of s.criteres) {
    out.push([`critere ${c.id} / valeurAffichee`, c.valeurAffichee]);
    out.push([`critere ${c.id} / commentaire`, c.commentaire]);
    out.push([`critere ${c.id} / libelle`, c.libelle]);
  }
  for (const k of s.knockOuts) out.push([`knock-out ${k.id} / motif`, k.motif]);
  for (const v of s.limitesViabilite) out.push([`limite ${v.id} / motif`, v.motif]);
  for (const p of s.seuilsProcedure) out.push([`seuil ${p.regleId} / commentaire`, p.commentaire]);
  for (const a of s.avertissements) out.push(['avertissement', a]);
  for (const p of [...s.pointsForts, ...s.pointsVigilance]) {
    out.push([`point ${p.critereId} / valeur`, p.valeur]);
  }
  return out;
}

test('aucune chaine affichee ne melange le point et la virgule decimale', () => {
  const fautives: string[] = [];
  let examinees = 0;
  for (const { nom, snapshot } of cas()) {
    for (const f of FILIERES) {
      for (const [ou, texte] of chainesVisibles(calculerScore(snapshot, f))) {
        if (typeof texte !== 'string' || texte === '') continue;
        examinees += 1;
        if (POINT_DECIMAL.test(texte)) {
          fautives.push(`[${nom} / ${f}] ${ou} : « ${texte.slice(0, 130)} »`);
        }
      }
    }
  }
  // Un garde qui n'examine rien ne protege rien.
  assert.ok(examinees > 200, `attendu plus de 200 chaines examinees, obtenu ${examinees}`);
  assert.deepEqual(
    fautives,
    [],
    `${fautives.length} chaine(s) affichent un point decimal dans un texte francais :\n  ` +
      fautives.slice(0, 12).join('\n  '),
  );
});

test('les phrases a nombres sont bien atteintes par les cas de test', () => {
  /**
   * Le test precedent ne vaut que si les phrases fautives sont REELLEMENT produites. Sans ce
   * controle, retirer par megarde la petite surface des cas ferait passer le garde a vide : plus
   * aucune limite de viabilite, donc plus aucune phrase a verifier.
   */
  const trouvees = new Set<string>();
  for (const { snapshot } of cas()) {
    for (const f of FILIERES) {
      const s = calculerScore(snapshot, f);
      for (const v of s.limitesViabilite) trouvees.add(v.id);
      for (const p of s.seuilsProcedure) if (p.commentaire) trouvees.add(p.regleId);
    }
  }
  for (const attendu of ['viab_surface_insuffisante', 'viab_surface_tres_insuffisante']) {
    assert.ok(trouvees.has(attendu), `le cas « ${attendu} » n'est atteint par aucun snapshot de test`);
  }
  assert.ok(
    [...trouvees].some((t) => t.startsWith('pv_')),
    'aucun seuil de procedure photovoltaique commente n’est atteint',
  );
});
