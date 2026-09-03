/**
 * LE FILET DE L'OUTIL DE MUTATION, teste en le lancant pour de vrai.
 *
 * POURQUOI CE FICHIER EXISTE. `scripts/mutation.mjs` casse volontairement un fichier source,
 * lance les tests, puis le restaure dans un `finally`. Si le processus est TUE avant ce
 * `finally` — un depassement de delai suffit, et c'est arrive deux fois —, le fichier reste
 * casse sur le disque. Un marqueur `.mutation-en-cours` a donc ete ajoute : ecrit avant la
 * mutation, efface apres, et relu au demarrage pour reparer.
 *
 * Ce filet ne servait a rien, et seule l'execution l'a montre (audit 11). La restauration
 * etait placee APRES l'analyse de la ligne de commande, donc apres le `process.exit(1)` qui
 * sanctionne un `--filtre` sans correspondance. Or c'est precisement la commande qu'on tape
 * apres une interruption : on rejoue l'entree qui etait en vol. Constat mesure : le marqueur
 * etait en place, `scripts/portable/amorce.mjs` etait mute, l'outil sortait sans un mot et
 * laissait le fichier casse.
 *
 * D'ou la regle, et ce test la garde : **une reparation d'etat ne se place jamais derriere une
 * porte de sortie**. Le test lance le vrai script avec un filtre qui ne correspond a rien —
 * le chemin qui echouait — et exige la restauration quand meme.
 *
 * Le fichier a restaurer est place HORS du depot, dans un dossier temporaire : un test qui
 * reecrit un fichier source du projet pour verifier un outil serait un remede pire que le mal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MARQUEUR = join(RACINE, '.mutation-en-cours');
const SCRIPT = join(RACINE, 'scripts', 'mutation.mjs');

/** Lance le vrai script avec un filtre sans correspondance, et rend sa sortie. */
function lancer(): { sortie: string; code: number } {
  try {
    const sortie = execFileSync(
      'node',
      [SCRIPT, '--filtre', 'filtre-qui-ne-correspond-a-rien-du-tout'],
      { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { sortie, code: 0 };
  } catch (erreur) {
    const e = erreur as { stdout?: string; stderr?: string; status?: number };
    return { sortie: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? -1 };
  }
}

test('un fichier laisse mute par une interruption est restaure MEME sur un filtre vide', () => {
  assert.equal(
    existsSync(MARQUEUR),
    false,
    'une campagne de mutation semble en cours : ce test ne doit pas lui marcher dessus',
  );

  const dossier = mkdtempSync(join(tmpdir(), 'filet-mutation-'));
  const victime = join(dossier, 'source-mutee.mjs');
  const ORIGINAL = 'export const garde = true;\n';
  const MUTE = 'export const garde = false; /* mutation restee en place */\n';

  writeFileSync(victime, MUTE);
  writeFileSync(MARQUEUR, JSON.stringify({ fichier: victime, contenu: ORIGINAL }));

  try {
    const { sortie, code } = lancer();

    assert.equal(
      readFileSync(victime, 'utf8'),
      ORIGINAL,
      'le fichier devait etre restaure avant que le filtre ne fasse sortir le processus',
    );
    assert.equal(existsSync(MARQUEUR), false, 'le marqueur doit etre efface apres restauration');
    assert.match(
      sortie,
      /interrompue/i,
      'la restauration doit etre DITE : une reparation silencieuse laisse croire qu’il ne s’est rien passe',
    );
    // Le filtre sans correspondance reste une erreur : reparer ne veut pas dire tout accepter.
    assert.equal(code, 1, 'un filtre sans correspondance doit toujours sortir en erreur');
  } finally {
    rmSync(MARQUEUR, { force: true });
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('un marqueur illisible est avoue, pas ignore et pas jete en pile d’appels', () => {
  /**
   * Le processus peut mourir PENDANT l'ecriture du marqueur, qui reste alors tronque. On ne
   * sait plus quel contenu restaurer : le seul comportement honnete est de le dire et de
   * renvoyer l'utilisateur vers `git status`. Une exception brute lui montrerait une pile
   * d'appels sans lui apprendre qu'un fichier de son depot est volontairement casse.
   */
  assert.equal(existsSync(MARQUEUR), false, 'campagne en cours : test ecarte');
  writeFileSync(MARQUEUR, '{"fichier":"scripts/porta');
  try {
    const { sortie, code } = lancer();
    assert.match(sortie, /illisible/i, 'le marqueur illisible doit etre nomme comme tel');
    assert.match(sortie, /git checkout/, 'il faut donner la manoeuvre de reparation manuelle');
    assert.equal(code, 1, "l'outil doit refuser de continuer sur un etat qu'il ne sait pas reparer");
  } finally {
    rmSync(MARQUEUR, { force: true });
  }
});
