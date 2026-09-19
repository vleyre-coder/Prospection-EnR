/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA FICHE PARCELLE EVALUE AU DROIT, ET RIEN NE PEUT L'EN FAIRE DEVIER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * L'INVARIANT, et pourquoi il se garde ici plutot qu'ailleurs. Le §2.3 du cahier des charges pose
 * que le mode 1 — la consultation d'une parcelle — evalue TOUJOURS au seuil reglementaire. Le
 * moteur sait le faire, et `packages/scoring/test/verdict.test.ts` le prouve. Ce qui n'est prouve
 * nulle part, c'est que la ROUTE l'appelle bien ainsi, et qu'aucun parametre ne permette d'en
 * changer.
 *
 * CE QUE COUTERAIT LA DERIVE. Un `?mode=developpeur` ajoute un jour « pour tester », ou un mode lu
 * dans la requete par commodite, et la fiche se mettrait a repondre selon le cahier des charges du
 * dernier developpeur consulte. L'operateur lirait « defavorable » sur une parcelle que le droit
 * autorise, et ecarterait du foncier instruisable en croyant lire la loi. Rien ne le signalerait :
 * la reponse serait un 200 parfaitement forme.
 *
 * POURQUOI UN GARDE STRUCTUREL. Un test fonctionnel demanderait une base, une parcelle qualifiee
 * et un profil — et il ne couvrirait que les parametres auxquels j'aurais pense. Lire la source
 * couvre la forme du code lui-meme : le mode est un litteral, il n'est pas lu de la requete, et
 * `evaluerVerdict` n'est appelee qu'a un seul endroit de cette route.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const ROUTE = resolve(ICI, '..', 'src', 'routes', 'parcelles.ts');

test('la fiche parcelle appelle le verdict au seuil REGLEMENTAIRE, en dur', () => {
  const source = readFileSync(ROUTE, 'utf8');

  const appels = [...source.matchAll(/evaluerVerdict\(([^)]*)\)/g)];
  assert.equal(appels.length, 1, `${appels.length} appels a evaluerVerdict dans la fiche, au lieu d’un`);

  const arguments_ = appels[0]?.[1] ?? '';
  assert.match(
    arguments_,
    /'reglementaire'/,
    'le mode doit etre le litteral `reglementaire` : la carte lit le droit, jamais un cahier des charges',
  );
  assert.doesNotMatch(
    arguments_,
    /\bmode\b|\bq\.|req\./,
    'le mode ne doit venir ni de la requete ni d’une variable : ce n’est pas un reglage',
  );
});

test('aucun parametre de la fiche ne s’appelle « mode »', () => {
  /*
   * Le controle precedent verifie l'appel ; celui-ci verifie qu'on n'a pas ouvert la porte en
   * amont. Un `mode` accepte dans la chaine de requete serait la premiere moitie de la derive,
   * meme s'il n'etait pas encore branche sur le verdict — et la seconde moitie s'ecrit en une
   * ligne, six mois plus tard, par quelqu'un qui ne connait pas cette regle.
   */
  const source = readFileSync(ROUTE, 'utf8');
  const fiche = source.slice(
    source.indexOf("app.get<{ Params: { idu: string } }>('/api/parcelles/:idu'"),
    source.indexOf("app.post<{ Params: { idu: string } }>('/api/parcelles/:idu/score'"),
  );
  assert.ok(fiche.length > 500, 'le decoupage de la route a echoue : le garde ne prouverait rien');

  // La route ne declare que `filiere` et `rafraichir`.
  const requete = /const q = req\.query as \{([^}]*)\}/.exec(fiche)?.[1] ?? '';
  assert.ok(requete.length > 0, 'la declaration de la chaine de requete est introuvable');
  assert.doesNotMatch(requete, /\bmode\b/, 'la fiche ne doit accepter aucun parametre `mode`');
  assert.doesNotMatch(requete, /seuil|profil/i, 'la fiche ne prend ni seuil ni profil en entree');
});

test('la fiche ne lit aucun seuil developpeur', () => {
  /*
   * Troisieme angle, et le plus direct : meme avec le bon mode, passer des seuils developpeur a
   * `evaluerVerdict` les ferait apparaitre dans `ecartsCahierDesCharges` et sur la fiche. Le mode
   * `reglementaire` les ignore pour le verdict, mais la fiche n'a aucune raison d'en connaitre.
   */
  const source = readFileSync(ROUTE, 'utf8');
  assert.doesNotMatch(
    source,
    /indexerSeuils|seuilsDeveloppeur|SeuilDeveloppeur/,
    'la fiche parcelle n’a pas a connaitre les seuils d’un developpeur',
  );
});
