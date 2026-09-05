/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * « PAS DE SURPRISE QUAND ON CONTACTE UN PROPRIETAIRE »
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ce fichier tient une exigence formulee par le proprietaire du projet, et elle ne se mesure pas
 * en points : une parcelle peut afficher 82/100 et le premier appel s'arreter net. Les quatre
 * causes les plus banales d'arret n'existaient nulle part dans le depot avant cet audit —
 * « fermage », « eviction », « preemption », « enclave » : zero occurrence, recherche faite.
 *
 * Ce que ce fichier verifie, et pourquoi chaque point compte :
 *
 *   1. une parcelle CULTIVEE fait apparaitre la question du fermier. C'est la surprise la plus
 *      frequente : le proprietaire dit oui, l'exploitant dit non — et l'outil disposait deja de la
 *      donnee (declaration PAC) sans jamais en tirer la consequence ;
 *   2. la gravite SUIT LA FILIERE. En methanisation ou en agrivoltaisme l'exploitation continue :
 *      le bail s'avenante. En solaire au sol la terre quitte l'usage agricole : l'accord du preneur
 *      est une condition. Une gravite unique ferait crier au loup dans un cas et sous-estimer
 *      l'autre ;
 *   3. l'ABSENCE de donnee de propriete est elle-meme un point. Sans cela, une fiche muette se lit
 *      « un seul proprietaire », c'est-a-dire le cas le plus simple, alors qu'on n'en sait rien ;
 *   4. aucun point n'AFFIRME. Le RPG est anonymise, aucune source nationale ne publie les
 *      perimetres SAFER : un texte qui conclurait « bail rural en cours » serait la faute meme que
 *      ce projet traque.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Le paquet CONSTRUIT, comme les autres tests de ce dossier : la suite tourne sous
// `node --test --experimental-strip-types`, qui ne resout pas `../src/*.js` vers du TypeScript.
import { verificationsAvantContact } from '../dist/index.js';
import { identiteDepuisIdu, snapshotVide } from '@enr/core';
import type { ParcelleSnapshot } from '@enr/core';

/** Snapshot minimal, modifie champ par champ selon le cas teste. */
function snap(modif: (s: ParcelleSnapshot) => void): ParcelleSnapshot {
  // Departement 99, en pleine mer : le meme territoire fictif que le reste des tests du depot.
  const s = snapshotVide(identiteDepuisIdu('99001000AA0001'));
  modif(s);
  return s;
}

const ids = (v: { id: string }[]): string[] => v.map((x) => x.id);

test('une parcelle cultivee fait apparaitre la question du fermier', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.occupationSol.rpg.anneesDeclareesConsecutives = 5;
    }),
    'solaire_sol',
  );
  const bail = v.find((x) => x.id === 'bail_rural');
  assert.ok(bail, `le point « bail_rural » doit apparaitre — obtenu : ${ids(v).join(', ')}`);
  assert.ok(bail.question.length > 0, 'le point doit porter une question a poser');
  assert.equal(bail.regleLiee, 'commun_bail_rural', 'il doit citer sa reference juridique');
});

test('une parcelle NON cultivee ne fait pas crier au loup', () => {
  // Un terrain artificialise n'a pas de preneur : soulever le bail rural partout viderait le point
  // de son sens, et l'operateur cesserait de le lire.
  const v = verificationsAvantContact(
    snap((s) => {
      s.occupationSol.rpg.anneesDeclareesConsecutives = 0;
      s.occupationSol.rpg.partRecouvrement = 0;
      s.occupationSol.typeSol = 'artificialise';
      s.foncier.nbProprietairesEstime = 1;
    }),
    'solaire_sol',
  );
  assert.ok(!ids(v).includes('bail_rural'));
  assert.ok(!ids(v).includes('preemption_safer'), 'pas de terre agricole, pas de SAFER');
});

test('LA GRAVITE SUIT LA FILIERE : la terre part, ou elle reste', () => {
  /*
   * En solaire au sol, la terre quitte l'usage agricole : sans l'accord du preneur, il n'y a pas de
   * projet — d'ou « arret ». En methanisation, l'exploitation se poursuit : le bail s'avenante, ce
   * qui coute du temps, pas le projet — d'ou « delai ». Une gravite unique serait fausse dans les
   * deux sens a la fois.
   */
  const cultivee = (f: 'solaire_sol' | 'methanisation') =>
    verificationsAvantContact(
      snap((s) => {
        s.occupationSol.rpg.anneesDeclareesConsecutives = 3;
      }),
      f,
    ).find((x) => x.id === 'bail_rural');

  assert.equal(cultivee('solaire_sol')?.gravite, 'arret');
  assert.equal(cultivee('methanisation')?.gravite, 'delai');
});

test('l’agrivoltaisme laisse l’exploitation en place : le bail s’avenante', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.occupationSol.rpg.anneesDeclareesConsecutives = 3;
    }),
    'solaire_sol',
    { regimeImplantation: 'agrivoltaisme' },
  );
  const bail = v.find((x) => x.id === 'bail_rural');
  assert.equal(bail?.gravite, 'delai');
  assert.ok(
    /avenanter|se poursuit/.test(bail?.texte ?? ''),
    'le texte doit dire que l’exploitation continue',
  );
});

test('un proprietaire public change d’interlocuteur, pas de negociation de gre a gre', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.foncier.proprietairePublic = true;
      s.foncier.nbProprietairesEstime = 1;
    }),
    'bess',
  );
  const p = v.find((x) => x.id === 'proprietaire_public');
  assert.ok(p, `attendu « proprietaire_public » — obtenu : ${ids(v).join(', ')}`);
  assert.equal(p.regleLiee, 'commun_proprietaire_public');
  // Et il remplace le point « plusieurs comptes » : une commune n'est pas une indivision.
  assert.ok(!ids(v).includes('plusieurs_proprietaires'));
});

test('plusieurs comptes cadastraux : l’accord doit etre unanime', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.foncier.nbProprietairesEstime = 4;
      s.foncier.indivisionProbable = true;
    }),
    'solaire_sol',
  );
  const p = v.find((x) => x.id === 'plusieurs_proprietaires');
  assert.ok(p);
  assert.ok(p.titre.includes('4'), 'le nombre doit etre dit, pas seulement « plusieurs »');
  assert.ok(/indivision/i.test(p.texte));
});

test('L’ABSENCE DE DONNEE EST UN POINT, pas un silence', () => {
  /*
   * Sans cette ligne, une fiche sans information de propriete se lit « un seul proprietaire » —
   * le cas le plus simple — alors que l'application n'en sait rien. C'est exactement la confusion
   * entre « rien » et « on n'en sait rien » que le reste du projet combat.
   */
  const v = verificationsAvantContact(
    snap((s) => {
      s.foncier.nbProprietairesEstime = null;
      s.foncier.proprietairePublic = null;
    }),
    'solaire_sol',
  );
  const p = v.find((x) => x.id === 'propriete_inconnue');
  assert.ok(p, `attendu « propriete_inconnue » — obtenu : ${ids(v).join(', ')}`);
  assert.ok(/on ne sait pas/i.test(p.texte), 'le texte doit dire l’ignorance en toutes lettres');
});

test('une parcelle qui ne touche aucune voirie annonce un tiers dans la boucle', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.acces.distanceVoirieM = 180;
      s.foncier.nbProprietairesEstime = 1;
    }),
    'solaire_sol',
  );
  const p = v.find((x) => x.id === 'acces_par_un_tiers');
  assert.ok(p);
  assert.equal(p.gravite, 'arret');
  assert.ok(p.texte.includes('180'), 'la distance mesuree doit etre dite');
  assert.equal(p.regleLiee, 'commun_parcelle_enclavee');
});

test('une parcelle en bord de voirie ne declenche pas le point d’acces', () => {
  const v = verificationsAvantContact(
    snap((s) => {
      s.acces.distanceVoirieM = 0;
      s.foncier.nbProprietairesEstime = 1;
    }),
    'solaire_sol',
  );
  assert.ok(!ids(v).includes('acces_par_un_tiers'));
});

test('AUCUN POINT N’AFFIRME ce que la donnee ne dit pas', () => {
  /*
   * Le RPG est anonymise et aucune source nationale ne publie les perimetres SAFER. Un texte qui
   * ecrirait « bail rural en cours » ou « la SAFER preemptera » ferait exactement ce que dix audits
   * ont corrige ailleurs : affirmer plus que ce que la mesure permet.
   */
  const v = verificationsAvantContact(
    snap((s) => {
      s.occupationSol.rpg.anneesDeclareesConsecutives = 7;
      s.occupationSol.typeSol = 'agricole_exploite';
      s.acces.distanceVoirieM = 50;
      s.foncier.nbProprietairesEstime = 3;
    }),
    'solaire_sol',
  );
  assert.ok(v.length >= 4, `attendu au moins 4 points — obtenu : ${ids(v).join(', ')}`);
  for (const p of v) {
    assert.ok(
      !/bail rural en cours|la SAFER préemptera|le fermier refusera/i.test(p.texte),
      `« ${p.id} » affirme ce que la donnee ne montre pas : ${p.texte.slice(0, 120)}`,
    );
    assert.ok(p.question.length > 10, `« ${p.id} » doit porter une question exploitable`);
    assert.ok(p.titre.length > 0 && p.texte.length > 80);
  }
});

test('chaque reference citee existe reellement dans le referentiel', async () => {
  // Une reference juridique inventee serait pire qu'aucune : elle ferait croire a une verification.
  const { REGLES_PAR_ID } = await import('@enr/core');
  const v = verificationsAvantContact(
    snap((s) => {
      s.occupationSol.rpg.anneesDeclareesConsecutives = 2;
      s.acces.distanceVoirieM = 90;
      s.foncier.proprietairePublic = true;
    }),
    'solaire_sol',
  );
  const citees = v.map((p) => p.regleLiee).filter((r): r is string => r != null);
  assert.ok(citees.length >= 3, `attendu au moins 3 references — obtenu ${citees.length}`);
  for (const r of citees) {
    assert.ok(REGLES_PAR_ID[r], `la regle « ${r} » n’existe pas dans le referentiel`);
  }
});
