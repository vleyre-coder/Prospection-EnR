/**
 * Tests de la validation des corps de requete.
 *
 * POURQUOI. La route de recherche diffusait le corps JSON dans le constructeur SQL avec un
 * `as FiltresParcelles`, qui ne verifie rien a l'execution. Quatre entrees client mesurees
 * produisaient chacune un HTTP 500 : une faute de saisie etait presentee comme une panne
 * serveur, l'utilisateur ne pouvait pas savoir quoi corriger, et une supervision reveillait une
 * astreinte. `limite` n'etait pas plafonnee : un appel pouvait lire toute la table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtresValides, LIMITE_MAX, LIMITE_MAX_EXPORT } from '../src/services/recherche.js';
import { ErreurValidation } from '../src/validation.js';

const base = { filiere: 'solaire_sol' };

/** Verifie qu'un corps est refuse par une ErreurValidation dont le message porte le motif. */
function refuse(corps: unknown, motif: RegExp, limiteMax?: number): void {
  assert.throws(
    () => filtresValides(corps, limiteMax),
    (err: unknown) => {
      assert.ok(err instanceof ErreurValidation, `attendu ErreurValidation, recu ${String(err)}`);
      assert.match(err.message, motif);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// Les quatre entrees qui produisaient un 500
// ---------------------------------------------------------------------------

test('une limite negative est refusee, pas transmise au SQL', () => {
  refuse({ ...base, limite: -5 }, /limite.*minimale 1/);
});

test('un decalage negatif est refuse', () => {
  refuse({ ...base, decalage: -10 }, /decalage.*minimale 0/);
});

test('une surface non numerique est refusee sans coercition', () => {
  // Accepter "12" obligerait a decider demain du sort de "1e3", "12,5" ou " 12 ".
  refuse({ ...base, surfaceMinHa: 'abc' }, /surfaceMinHa.*nombre attendu/);
  refuse({ ...base, surfaceMinHa: '12' }, /surfaceMinHa.*nombre attendu/);
});

test('une liste de statuts qui n’est pas un tableau est refusee', () => {
  refuse({ ...base, statutsScore: 'rouge' }, /statutsScore.*tableau attendu/);
});

// ---------------------------------------------------------------------------
// Plafond de pagination
// ---------------------------------------------------------------------------

test('la limite est plafonnee, et le plafond est dit', () => {
  refuse({ ...base, limite: 100000 }, new RegExp(`maximale ${LIMITE_MAX}`));
  assert.equal(filtresValides({ ...base, limite: LIMITE_MAX }).limite, LIMITE_MAX);
});

test('les exports ont leur propre plafond, plus haut', () => {
  // Un export a besoin de plus de lignes qu'une page de liste : c'est son objet. Le plafond doit
  // etre explicite, sinon soit la liste laisse tout lire, soit l'export est tronque en silence.
  assert.ok(LIMITE_MAX_EXPORT > LIMITE_MAX);
  assert.equal(filtresValides({ ...base, limite: 5000 }, LIMITE_MAX_EXPORT).limite, 5000);
  refuse({ ...base, limite: 5000 }, new RegExp(`maximale ${LIMITE_MAX}`));
});

test('une limite non entiere est refusee', () => {
  refuse({ ...base, limite: 12.5 }, /limite.*entier attendu/);
});

// ---------------------------------------------------------------------------
// Le piege le plus insidieux : un filtre ignore en silence
// ---------------------------------------------------------------------------

test('un champ inconnu est REFUSE et non ignore', () => {
  // Un filtre mal orthographie qui passe en silence donne un resultat plus LARGE que demande,
  // ce qui est la reponse la plus trompeuse possible pour un outil de tri.
  refuse({ ...base, surfaceMinHA: 12 }, /inconnu.*surfaceMinHA/);
  refuse({ ...base, exclureAOP: true }, /inconnu.*exclureAOP/);
});

test('un corps qui n’est pas un objet est refuse', () => {
  refuse(null, /objet JSON/);
  refuse('filiere=solaire', /objet JSON/);
  refuse([1, 2, 3], /objet JSON/);
});

// ---------------------------------------------------------------------------
// Emprise : la meme regle que partout ailleurs
// ---------------------------------------------------------------------------

test('une emprise inversee est refusee', () => {
  refuse({ ...base, bbox: [1.79, 48.16, 1.74, 48.14] }, /bbox.*emprise invalide/);
});

test('une emprise hors domaine geographique est refusee', () => {
  refuse({ ...base, bbox: [200, 90, 201, 91] }, /bbox.*emprise invalide/);
});

test('une emprise couvrant le monde entier est refusee', () => {
  // Le plafond de deux fois la France existait dans `bboxDepuisChaine`, mais ne s'appliquait
  // qu'aux chemins en chaine de requete : le corps JSON, celui que l'interface utilise, passait
  // sans aucun controle.
  refuse({ ...base, bbox: [-180, -90, 180, 90] }, /bbox.*emprise invalide/);
});

test('une emprise de travail normale est acceptee', () => {
  const f = filtresValides({ ...base, bbox: [1.74, 48.14, 1.79, 48.16] });
  assert.deepEqual(f.bbox, [1.74, 48.14, 1.79, 48.16]);
});

test('une emprise mal formee est refusee', () => {
  refuse({ ...base, bbox: [1, 2, 3] }, /bbox.*4 nombres/);
  refuse({ ...base, bbox: 'oui' }, /bbox.*4 nombres/);
  refuse({ ...base, bbox: [1, 2, 3, Number.NaN] }, /bbox.*finis/);
});

// ---------------------------------------------------------------------------
// Coherence et valeurs closes
// ---------------------------------------------------------------------------

test('un intervalle de surface inverse est refuse, plutot que de rendre vide', () => {
  // Sans ce controle, la reponse est « aucune parcelle ne correspond », ce qui se lit comme un
  // constat sur le territoire alors que c'est la demande qui est contradictoire.
  refuse({ ...base, surfaceMinHa: 50, surfaceMaxHa: 10 }, /superieure a la maximale/);
});

test('une filiere invalide ou absente est refusee', () => {
  refuse({}, /filiere.*requis/);
  refuse({ filiere: 'nucleaire' }, /filiere/);
});

test('un tri hors liste est refuse au lieu de retomber en silence', () => {
  refuse({ ...base, tri: 'score_desc; DROP TABLE parcelle' }, /tri.*valeur parmi/);
  assert.equal(filtresValides({ ...base, tri: 'surface_desc' }).tri, 'surface_desc');
});

test('un statut de score hors liste est refuse', () => {
  refuse({ ...base, statutsScore: ['vert', 'violet'] }, /statutsScore.*elements parmi/);
  assert.deepEqual(filtresValides({ ...base, statutsScore: ['vert', 'rouge'] }).statutsScore, [
    'vert',
    'rouge',
  ]);
});

test('un booleen doit etre un booleen', () => {
  refuse({ ...base, exclureAop: 'oui' }, /exclureAop.*booléen/);
  refuse({ ...base, exclureAop: 1 }, /exclureAop.*booléen/);
  assert.equal(filtresValides({ ...base, exclureAop: true }).exclureAop, true);
});

test('un code departement invalide est refuse, la Corse acceptee', () => {
  refuse({ ...base, codeDepartement: 'ABC' }, /codeDepartement/);
  assert.equal(filtresValides({ ...base, codeDepartement: '2A' }).codeDepartement, '2A');
  assert.equal(filtresValides({ ...base, codeDepartement: '971' }).codeDepartement, '971');
});

test('une pente filtree au-dela du plausible est refusee', () => {
  // Aligne sur la borne du calcul de pente : au-dela de 100 % on n'est plus sur un terrain.
  refuse({ ...base, penteMaxPct: 1666 }, /penteMaxPct.*maximale 100/);
});

test('un filtre vide ne produit aucune contrainte fantome', () => {
  const f = filtresValides(base) as Record<string, unknown>;
  assert.equal(f['filiere'], 'solaire_sol');
  for (const [cle, valeur] of Object.entries(f)) {
    if (cle === 'filiere') continue;
    assert.equal(valeur, undefined, `${cle} devrait rester indefini, vaut ${String(valeur)}`);
  }
});

test('une liste vide est traitee comme absente, non comme « aucun statut »', () => {
  // `statut = ANY('{}')` ne correspond a rien : un filtre vide ne doit pas vider le resultat.
  assert.equal(filtresValides({ ...base, statutsScore: [] }).statutsScore, undefined);
});
