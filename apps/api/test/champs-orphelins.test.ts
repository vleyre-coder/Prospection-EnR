/**
 * Aucun champ dont depend une decision ne doit rester sans ecrivain.
 *
 * POURQUOI CE FICHIER EXISTE. Le sixieme audit a decouvert que `s.milieux.appb` etait lu par un
 * knock-out, declare dans les types, initialise par `snapshotVide()`, borne dans `bornes.ts` et
 * present au catalogue des couches — mais ecrit par AUCUN connecteur. Le knock-out exigeant
 * `recouvre === true`, il ne pouvait mathematiquement jamais se declencher, alors qu'un arrete de
 * protection de biotope est une protection absolue et non derogeable (art. R.411-15 du code de
 * l'environnement).
 *
 * Le defaut etait invisible par construction : un knock-out ne s'affiche que lorsqu'il se
 * declenche, donc rien dans la fiche ne signalait que le controle n'avait pas eu lieu. Et aucun
 * test ecrit depuis le code ne pouvait le voir, puisque le code de knock-out etait correct — c'est
 * la donnee qui n'arrivait jamais.
 *
 * Ce test a ete ecrit APRES le defaut, et il aurait pu tourner des le premier audit.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), 'utf8');
}

/**
 * Concatene tout ce qui, cote API, peut ecrire dans un snapshot.
 *
 * `routes/` et `scripts/` en font partie et ne sont pas facultatifs : `foncier.proprietairePublic`
 * n'est alimente ni par un connecteur ni par l'enrichissement, mais par le versement manuel des
 * donnees de propriete (`scripts/verser-proprietaires.ts`) puis relu dans `routes/parcelles.ts`.
 * Ma premiere version de ce test l'ignorait et le signalait donc a tort comme orphelin.
 */
function sourcesEcrivant(): string {
  const dossiers = ['../src/connecteurs/', '../src/ingestion/', '../src/routes/', '../src/scripts/', '../src/depots/'];
  let texte = lire('../src/enrichissement.ts');
  for (const d of dossiers) {
    const base = new URL(d, import.meta.url);
    for (const f of readdirSync(base)) {
      if (f.endsWith('.ts')) texte += readFileSync(new URL(f, base), 'utf8');
    }
  }
  return texte;
}

/**
 * Tout ce qui peut LIRE un champ du snapshot : moteur, exports, et interface.
 *
 * `.tsx` INCLUS, et ce n'est pas un detail. Un `grep --include=*.ts` exclut les composants React,
 * donc toute l'interface. Cet angle mort m'a fait declarer a tort `icpeProches` et
 * `reseauxEnterres` « collectes et jamais lus » dans deux audits consecutifs, alors que
 * `FicheParcelle.tsx` les affiche l'un et l'autre. La meme cecite avait fausse un comptage de
 * lignes. Elle est desormais impossible ici : les extensions sont explicites.
 */
function sourcesLisant(): string {
  const cibles: Array<[string, readonly string[]]> = [
    ['../../../packages/scoring/src/', ['.ts']],
    ['../src/services/', ['.ts']],
    ['../src/routes/', ['.ts']],
    ['../../web/src/', ['.ts', '.tsx']],
    ['../../web/src/components/', ['.ts', '.tsx']],
  ];
  let texte = '';
  for (const [dossier, exts] of cibles) {
    const base = new URL(dossier, import.meta.url);
    let fichiers: string[] = [];
    try {
      fichiers = readdirSync(base);
    } catch {
      continue;
    }
    for (const f of fichiers) {
      if (exts.some((e) => f.endsWith(e))) {
        try {
          texte += readFileSync(new URL(f, base), 'utf8');
        } catch {
          /* repertoire : ignore */
        }
      }
    }
  }
  return texte;
}

/** Chemins `s.section.champ[.sous]` lus dans un fichier du moteur. */
function cheminsLus(source: string): Array<{ section: string; champ: string; complet: string }> {
  const vus = new Map<string, { section: string; champ: string; complet: string }>();
  for (const m of source.matchAll(/\bs\.([a-zA-Z]+)\.([a-zA-Z0-9]+)(?:\.([a-zA-Z0-9]+))?/g)) {
    const [, section, champ, sous] = m;
    if (!section || !champ) continue;
    const complet = `s.${section}.${champ}${sous ? `.${sous}` : ''}`;
    vus.set(complet, { section, champ, complet });
  }
  return [...vus.values()];
}

/**
 * Champs dont l'absence d'ecrivain est ASSUMEE et documentee.
 *
 * Y figurer n'est pas un laissez-passer : c'est un engagement a ce que la fiche ne laisse pas
 * croire que la contrainte a ete examinee. Toute entree porte sa raison.
 */
const ABSENCES_ASSUMEES: Record<string, string> = {
  's.milieux.trameVerteBleue':
    "Definie par les SRADDET regionaux, sans API nationale homogene. Le critere env_tvb est " +
    'declare `sansSource` : la fiche dit que l\'enjeu n\'a pas ete regarde, indique ou le ' +
    'chercher, et le statut est plafonne a orange.',
};

test('tout champ lu par un knock-out est ecrit par au moins un connecteur', () => {
  const ecrivains = sourcesEcrivant();
  const lus = cheminsLus(lire('../../../packages/scoring/src/knockouts.ts'));
  assert.ok(lus.length >= 20, `attendu au moins 20 chemins lus, trouve ${lus.length}`);

  const orphelins = lus.filter(
    ({ champ, complet }) =>
      !ABSENCES_ASSUMEES[complet] && !new RegExp(`\\b${champ}\\b`).test(ecrivains),
  );

  assert.deepEqual(
    orphelins.map((o) => o.complet).sort(),
    [],
    'un knock-out depend de champs qu’aucun connecteur ne renseigne : il ne peut donc jamais se ' +
      'declencher, et rien ne le signale a l’utilisateur. Alimentez le champ, ou retirez le ' +
      'knock-out et declarez l’absence dans ABSENCES_ASSUMEES en disant comment la fiche en informe.',
  );
});

test('l’APPB est bien alimente, et par une source declaree', () => {
  // Regression nommee : c'est le defaut d'origine.
  const ecrivains = sourcesEcrivant();
  assert.match(ecrivains, /snapshot\.milieux\.appb\s*=/, 'un connecteur doit ecrire snapshot.milieux.appb');
  assert.match(ecrivains, /patrinat_apb:apb/, 'le typename WFS PatriNat doit etre celui interroge');
  // Une source qui alimente le snapshot doit figurer au catalogue des connecteurs, sans quoi la
  // fiche afficherait une valeur sans provenance datee — donc non opposable.
  assert.match(lire('../src/connecteurs/base.ts'), /patrinat_appb:/, 'la source doit etre au catalogue');
});

test('tout champ lu par les evaluateurs de criteres est ecrit par au moins un connecteur', () => {
  // Meme controle, etendu aux criteres : un critere prive de donnee reste gris, ce qui est
  // visible — donc moins grave qu'un knock-out muet — mais reste un critere qui ne sert a rien.
  const ecrivains = sourcesEcrivant();
  const lus = cheminsLus(lire('../../../packages/scoring/src/criteres-eval.ts'));
  assert.ok(lus.length >= 50, `attendu au moins 50 chemins lus, trouve ${lus.length}`);

  const orphelins = lus.filter(
    ({ champ, complet }) =>
      !ABSENCES_ASSUMEES[complet] && !new RegExp(`\\b${champ}\\b`).test(ecrivains),
  );

  assert.deepEqual(
    orphelins.map((o) => o.complet).sort(),
    [],
    'un critere depend de champs qu’aucun connecteur ne renseigne : il restera gris indefiniment',
  );
});

test('toute absence assumee est declaree sansSource, et non simplement grisee', () => {
  // La liste ABSENCES_ASSUMEES ne doit pas devenir un tapis sous lequel glisser des champs
  // manquants. Un critere prive de source doit le DIRE et plafonner le statut, sinon une parcelle
  // peut ressortir propice sur un enjeu que personne n'a regarde.
  const criteres = lire('../../../packages/scoring/src/criteres-eval.ts');
  for (const [chemin, raison] of Object.entries(ABSENCES_ASSUMEES)) {
    assert.ok(
      raison.length > 60,
      `${chemin} : la raison doit expliquer pourquoi la source n'existe pas, pas seulement affirmer qu'elle manque`,
    );
    assert.match(
      raison,
      /sansSource/,
      `${chemin} : une absence assumee doit s'appuyer sur le mecanisme sansSource`,
    );
  }
  // Verification nommee pour le seul cas actuel.
  const tvb = criteres.slice(criteres.indexOf('const env_tvb'), criteres.indexOf('const env_especes_protegees'));
  assert.match(tvb, /sansSource\(/, 'env_tvb doit se declarer sansSource et non indispo');
});

// ---------------------------------------------------------------------------
// Sens inverse : de la donnee collectee que personne ne lit
// ---------------------------------------------------------------------------

/**
 * Champs du snapshot ecrits par un connecteur et lus par PERSONNE.
 *
 * C'est le controle symetrique du precedent, et il valait d'etre ecrit : sans lui, la seule facon
 * de detecter une collecte inutile est un `grep` a la main — et c'est precisement un `grep`
 * incomplet (`--include=*.ts`, donc sans les `.tsx` de l'interface) qui m'a fait declarer a tort
 * `icpeProches` et `reseauxEnterres` morts dans deux audits consecutifs.
 *
 * Une collecte inutile n'est pas benigne : chaque champ coute une requete externe par parcelle.
 */
const COLLECTES_ASSUMEES: Record<string, string> = {
  // Renseignes pour l'affichage seul, sans critere associe : c'est un choix, pas un oubli.
};

test('aucun champ collecte n’est ignore de tous les lecteurs', () => {
  const lecteurs = sourcesLisant();
  assert.ok(lecteurs.length > 50_000, `les sources lisantes semblent incompletes (${lecteurs.length} caracteres)`);

  // Champs ecrits explicitement dans le snapshot par l'enrichissement ou un connecteur.
  const ecrits = new Set<string>();
  for (const m of sourcesEcrivant().matchAll(/snapshot\.[a-zA-Z]+\.([a-zA-Z0-9]+)\s*=/g)) {
    if (m[1]) ecrits.add(m[1]);
  }
  assert.ok(ecrits.size >= 5, `attendu au moins 5 champs ecrits, trouve ${ecrits.size}`);

  const jamaisLus = [...ecrits].filter(
    (champ) => !COLLECTES_ASSUMEES[champ] && !new RegExp(`\\b${champ}\\b`).test(lecteurs),
  );
  assert.deepEqual(
    jamaisLus.sort(),
    [],
    'champ(s) collecte(s) que ni le moteur, ni les exports, ni l’interface ne lisent : chaque ' +
      'champ coute une requete externe par parcelle. Supprimez la collecte, ou declarez-la dans ' +
      'COLLECTES_ASSUMEES avec sa raison.',
  );
});

test('les lecteurs incluent bien l’interface, `.tsx` compris', () => {
  // Garde contre la regression de l'angle mort : si ce test passait sans les `.tsx`, le controle
  // ci-dessus signalerait a tort tout champ affiche mais non score.
  const lecteurs = sourcesLisant();
  assert.match(lecteurs, /icpeProches/, 'FicheParcelle.tsx affiche icpeProches : il doit etre vu');
  assert.match(lecteurs, /reseauxEnterres/, 'FicheParcelle.tsx affiche reseauxEnterres');
});
