/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA CI JOUE BIEN TOUS LES MOTIFS DE MUTATION DE BOUT EN BOUT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, audit 13. Le job de bout en bout portait une etape intitulee « Verifier par
 * mutation que les tests de bout en bout protegent vraiment », et lancait :
 *
 *     node scripts/mutation.mjs --filtre "bout en bout"
 *
 * Or `--filtre` porte sur `audit + quoi + fichier`. Il ne retenait donc que les **deux** motifs
 * dont le champ `audit` vaut litteralement « bout en bout » — plus un motif sans aucun rapport,
 * dont le libelle contient ces mots et qui n'a meme pas besoin d'un navigateur. **Sept des neuf
 * motifs de bout en bout n'etaient jamais joues**, sous un intitule qui affirmait le contraire.
 *
 * POURQUOI C'EST GRAVE ICI PLUS QU'AILLEURS. Ces motifs sont les seuls a prouver que la suite de
 * bout en bout — la plus couteuse du depot, et la seule a exercer un vrai navigateur contre un
 * vrai serveur — n'est pas decorative. Un perimetre reduit en silence y donne l'illusion la plus
 * chere : celle d'avoir verifie ce que personne ne verifie.
 *
 * CE QUE CE GARDE VERIFIE, et pourquoi il lit le YAML plutot qu'une constante. La commande de CI
 * n'existe que dans `ci.yml` ; la recopier ici creerait deux verites a maintenir, et c'est
 * exactement la famille de derive qu'on corrige. Le garde lit donc le fichier reel et exige que la
 * commande couvre TOUS les motifs `e2e: true`, quelle que soit la facon dont elle s'y prend.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Les motifs de mutation declares comme exigeant un navigateur. */
function motifsE2e(): Array<{ audit: string; quoi: string; fichier: string }> {
  const source = readFileSync(resolve(RACINE, 'scripts', 'mutation.mjs'), 'utf8');
  const blocs = source.split(/\n {2}\{\n/).slice(1);
  const motifs: Array<{ audit: string; quoi: string; fichier: string }> = [];
  for (const bloc of blocs) {
    if (!/e2e:\s*true/.test(bloc)) continue;
    const audit = /audit:\s*'([^']+)'/.exec(bloc);
    const quoi = /quoi:\s*'([^']+)'/.exec(bloc);
    const fichier = /fichier:\s*'([^']+)'/.exec(bloc);
    if (audit && quoi && fichier) {
      motifs.push({ audit: audit[1]!, quoi: quoi[1]!, fichier: fichier[1]! });
    }
  }
  return motifs;
}

/** Les commandes `node scripts/mutation.mjs …` lancees par la CI. */
function commandesDeMutation(): string[] {
  const yml = readFileSync(resolve(RACINE, '.github', 'workflows', 'ci.yml'), 'utf8');
  return [...yml.matchAll(/run:\s*(node scripts\/mutation\.mjs[^\n]*)/g)].map((m) => m[1]!.trim());
}

test('LA LISTE DES MOTIFS DE BOUT EN BOUT EST BIEN LUE', () => {
  /*
   * Sans ce controle, une erreur de decoupage rendrait zero motif et les deux tests suivants
   * passeraient triomphalement sur un ensemble vide — la forme la plus pure du test decoratif.
   */
  const motifs = motifsE2e();
  assert.ok(
    motifs.length >= 9,
    `${motifs.length} motif(s) de bout en bout lus : le decoupage de mutation.mjs a change`,
  );
});

test('LA CI NE LAISSE AUCUN MOTIF DE BOUT EN BOUT DE COTE', () => {
  const commandes = commandesDeMutation();
  assert.ok(commandes.length > 0, 'aucune commande de mutation trouvee dans ci.yml');

  const couvreTout = commandes.some((c) => c.includes('--e2e-seulement') || c.includes('--avec-e2e'));
  assert.ok(
    couvreTout,
    'Aucune etape de CI ne joue les motifs de bout en bout dans leur ensemble.\n' +
      `Commandes trouvees :\n${commandes.map((c) => `  ${c}`).join('\n')}\n` +
      'Utilisez `--e2e-seulement` (job navigateur) ou `--avec-e2e` (campagne complete).',
  );
});

test('AUCUNE ETAPE NE PRETEND COUVRIR LE BOUT EN BOUT PAR UN FILTRE TEXTUEL', () => {
  /**
   * LE DEFAUT EXACT, interdit nommement. `--filtre "bout en bout"` cherche une chaine dans
   * `audit + quoi + fichier` : il attrape ce qui PARLE de bout en bout, pas ce qui EN EST. Deux
   * motifs sur neuf portaient cet audit ; les sept autres relevent de « parcelles manquantes »,
   * « audit 15 », « audit 18 » et « audit 21 », et n'ont aucune chaine commune.
   *
   * La mesure est refaite ici plutot que recopiee : si un jour les neuf motifs partageaient un
   * libelle, le filtre redeviendrait legitime et ce garde le dirait de lui-meme.
   */
  const motifs = motifsE2e();
  const attrapesParLeFiltre = motifs.filter((m) =>
    `${m.audit} ${m.quoi} ${m.fichier}`.toLowerCase().includes('bout en bout'),
  );
  assert.ok(
    attrapesParLeFiltre.length < motifs.length,
    'Le filtre « bout en bout » couvre maintenant tous les motifs : ce garde peut etre relu.',
  );

  for (const commande of commandesDeMutation()) {
    assert.ok(
      !/--filtre\s+"bout en bout"/.test(commande),
      'Une etape de CI filtre sur la chaine « bout en bout » : elle ne couvrirait que ' +
        `${attrapesParLeFiltre.length} des ${motifs.length} motifs. Utilisez --e2e-seulement.`,
    );
  }
});
