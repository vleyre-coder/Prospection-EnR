/**
 * Tests des decisions d'affichage de l'interface.
 *
 * Ce fichier est la reponse au constat repete des trois audits : les tests protegeaient le
 * moteur de scoring, et les defauts apparaissaient ailleurs — dans le choix d'un libelle,
 * dans le message associe a une donnee absente, dans le declenchement d'un bandeau. Ces
 * decisions ne sont pas du rendu : ce sont des fonctions de l'etat vers un texte. Elles sont
 * donc extraites dans `utils/affichage` et testees ici, sans DOM ni rendu React.
 *
 * Chacun des cas ci-dessous correspond a un defaut REELLEMENT survenu, pas a un scenario
 * imagine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estSessionExpiree,
  etiquetteStatut,
  libelleCultureRpg,
  type PaletteAffichage,
} from '../src/utils/affichage.js';

const PALETTE: PaletteAffichage = {
  couleursScore: { vert: '#16a34a', orange: '#ea580c', rouge: '#dc2626', gris: '#9ca3af' },
  libellesScore: {
    vert: 'Propice',
    orange: 'A instruire',
    rouge: 'Score faible',
    gris: 'Donnees insuffisantes',
  },
  couleurRedhibitoire: '#7f1d1d',
  libelleRedhibitoire: 'Redhibitoire / ecarte',
  descriptionRedhibitoire: 'Un critere reglementaire non derogeable ecarte la parcelle.',
};

// ---------------------------------------------------------------------------
// Etiquette de statut — defaut B1 du troisieme audit
// ---------------------------------------------------------------------------

test('une parcelle ecartee par le droit ne porte pas le libelle « Score faible »', () => {
  const e = etiquetteStatut('rouge', 1, PALETTE);
  assert.ok(e);
  assert.equal(e!.libelle, 'Redhibitoire / ecarte');
  assert.equal(e!.couleur, PALETTE.couleurRedhibitoire);
  assert.equal(e!.redhibitoire, true);
  // L'infobulle porte le motif : sans elle, le libelle affirme sans expliquer.
  assert.equal(e!.titre, PALETTE.descriptionRedhibitoire);
});

test('une parcelle simplement mal notee garde le libelle de score', () => {
  const e = etiquetteStatut('rouge', 0, PALETTE);
  assert.equal(e!.libelle, 'Score faible');
  assert.equal(e!.redhibitoire, false);
  assert.equal(e!.titre, undefined, 'rien a expliquer : la note parle d’elle-meme');
});

test('les deux parcelles rouges sont distinguables, ce qui est tout l’objet', () => {
  const ecartee = etiquetteStatut('rouge', 2, PALETTE)!;
  const malNotee = etiquetteStatut('rouge', 0, PALETTE)!;
  assert.notEqual(ecartee.libelle, malNotee.libelle);
  assert.notEqual(ecartee.couleur, malNotee.couleur);
});

test('un knock-out bloquant prime sur un statut favorable', () => {
  // Cas theorique — le moteur ne laisse pas passer un vert avec knock-out — mais l'etiquette
  // ne doit pas dependre de cette garantie pour etre correcte.
  assert.equal(etiquetteStatut('vert', 1, PALETTE)!.redhibitoire, true);
  assert.equal(etiquetteStatut('gris', 1, PALETTE)!.redhibitoire, true);
});

test('une parcelle non scoree n’affiche aucune etiquette', () => {
  // Pas d'etiquette « gris » par defaut : une parcelle non qualifiee n'a pas de statut, et
  // en inventer un ferait croire a une evaluation.
  assert.equal(etiquetteStatut(null, 0, PALETTE), null);
  assert.equal(etiquetteStatut(null, 3, PALETTE), null);
});

// ---------------------------------------------------------------------------
// Culture RPG — defaut B3 du troisieme audit
// ---------------------------------------------------------------------------

const rpg = (sur: Partial<Parameters<typeof libelleCultureRpg>[0]> = {}) => ({
  libelleCulture: null,
  libelleGroupeCulture: null,
  anneesDeclareesConsecutives: null,
  ...sur,
});

test('un RPG non consulte ne se lit pas « aucune declaration »', () => {
  const r = libelleCultureRpg(rpg());
  assert.match(r.texte, /indisponible/);
  assert.equal(r.absent, true, 'doit s’afficher comme une lacune, pas comme un constat');
});

test('un RPG consulte sans ilot affirme l’absence de declaration', () => {
  const r = libelleCultureRpg(rpg({ anneesDeclareesConsecutives: 0 }));
  assert.equal(r.texte, 'aucune déclaration PAC');
  // Pas un « absent » : c'est une information, et meme un atout en solaire au sol.
  assert.equal(r.absent, false);
});

test('une culture declaree prime, et le groupe sert de repli', () => {
  assert.equal(
    libelleCultureRpg(rpg({ libelleCulture: 'Ble tendre d’hiver', anneesDeclareesConsecutives: 5 }))
      .texte,
    'Ble tendre d’hiver',
  );
  assert.equal(
    libelleCultureRpg(rpg({ libelleGroupeCulture: 'Cereales', anneesDeclareesConsecutives: 3 }))
      .texte,
    'Cereales',
  );
});

test('une culture connue reste affichee meme si l’historique manque', () => {
  // Le repli WFS renseignait la culture sans le nombre d'annees : la culture doit primer.
  const r = libelleCultureRpg(rpg({ libelleCulture: 'Prairie permanente' }));
  assert.equal(r.texte, 'Prairie permanente');
  assert.equal(r.absent, false);
});

// ---------------------------------------------------------------------------
// Session expiree — defaut B2 du troisieme audit
// ---------------------------------------------------------------------------

test('le premier appel sans jeton ne declenche pas « Session expiree »', () => {
  // C'est exactement le scenario du defaut : /api/auth/moi est emis au chargement, avant
  // toute connexion, et repond 401.
  assert.equal(estSessionExpiree(401, false, '/api/auth/moi'), false);
});

test('un 401 avec un jeton en poche est bien une expiration', () => {
  assert.equal(estSessionExpiree(401, true, '/api/auth/moi'), true);
  assert.equal(estSessionExpiree(401, true, '/api/carte/tuiles/parcelles/14/8300/5700.mvt'), true);
});

test('un mot de passe faux n’est pas une session expiree', () => {
  assert.equal(estSessionExpiree(401, true, '/api/auth/connexion'), false);
  assert.equal(estSessionExpiree(401, false, '/api/auth/connexion'), false);
});

test('les autres codes d’erreur ne concernent pas la session', () => {
  for (const statut of [200, 400, 403, 404, 429, 500, 502]) {
    assert.equal(
      estSessionExpiree(statut, true, '/api/recherche/parcelles'),
      false,
      `le statut ${statut} ne doit pas deconnecter`,
    );
  }
  // 403 en particulier : role insuffisant, la session est valide.
  assert.equal(estSessionExpiree(403, true, '/api/prospection/leads'), false);
});

// ---------------------------------------------------------------------------
// Garde contre la reintroduction du defaut dans le JSX
// ---------------------------------------------------------------------------

/**
 * Les tests ci-dessus verifient la REGLE. Rien ne garantit que le composant l'utilise :
 * remettre `libellesScore[statutScore]` directement dans la vue liste ferait revenir le
 * defaut B1 sans faire echouer un seul test.
 *
 * Cette garde lit le source du composant. C'est grossier, et c'est assume : elle est bien
 * moins couteuse qu'une infrastructure de rendu, et elle ferme precisement la porte par
 * laquelle le defaut est deja entre une fois.
 */
test('la vue liste passe par etiquetteStatut et non par la palette directement', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('../src/components/VueListe.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(source, /etiquetteStatut\(/, 'la vue liste doit appeler la regle partagee');
  assert.ok(
    !/palette\.libellesScore\[/.test(source),
    'lire libellesScore directement contourne la distinction redhibitoire / score faible',
  );
});

test('la fiche parcelle passe par libelleCultureRpg', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(new URL('../src/components/FicheParcelle.tsx', import.meta.url)),
    'utf8',
  );

  assert.match(source, /libelleCultureRpg\(/);
  assert.ok(
    !/rpg\.libelleCulture \?\?\s*'aucune/.test(source),
    "affirmer « aucune declaration » depuis un null est le defaut B3",
  );
});
