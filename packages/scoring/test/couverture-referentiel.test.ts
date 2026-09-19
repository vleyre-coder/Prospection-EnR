/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE RAPPORT DE VERIFICATION NE DOIT PAS POUVOIR SE PERIMER EN SILENCE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `docs/VERIFICATION-REFERENTIEL.md` annonce ce que l'application evalue et ce qu'elle laisse a
 * l'operateur. C'est le document sur lequel se fonde une decision de terrain : savoir que le
 * verdict d'une filiere repose sur onze contraintes raccordees et non sur les cinquante-quatre du
 * classeur change ce qu'on en fait.
 *
 * UN CHIFFRE ECRIT A LA MAIN SE PERIME DES LA PROCHAINE CORRESPONDANCE AJOUTEE, et rien ne le
 * signale : un tableau faux se lit exactement comme un tableau juste. Le rapport deviendrait alors
 * PIRE que son absence, puisqu'il inspire confiance.
 *
 * Ce fichier recompte donc tout depuis le referentiel et la table de correspondances, et exige que
 * le document dise la meme chose. Ajouter une correspondance sans mettre le rapport a jour casse
 * la suite — c'est voulu, et c'est le seul moyen de tenir un document de ce genre honnete.
 *
 * CE QU'IL NE VERIFIE PAS : la prose. Un test ne peut pas dire si l'explication d'un refus est
 * juste. Il tient les nombres, qui sont ce qui se perime.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { CONTRAINTES_REFERENTIEL, MILLESIME_REFERENTIEL } from '@enr/core';
import type { FiliereReferentiel } from '@enr/core';
import { CORRESPONDANCES } from '../dist/index.js';

const RAPPORT = readFileSync(
  new URL('../../../docs/VERIFICATION-REFERENTIEL.md', import.meta.url),
  'utf8',
);

/** Libelle du rapport pour chaque filiere, tel qu'il doit apparaitre dans la colonne de gauche. */
const LIBELLES: ReadonlyArray<readonly [FiliereReferentiel, string]> = [
  ['eolien_terrestre', 'Éolien terrestre'],
  ['solaire_sol', 'Solaire au sol'],
  ['agrivoltaisme', 'Agrivoltaïsme'],
  ['bess', 'BESS'],
  ['methanisation', 'Méthanisation'],
];

interface Compte {
  total: number;
  auto: number;
  raccordees: number;
  autoNonRaccordees: number;
  manuel: number;
}

function recenser(): Map<FiliereReferentiel, Compte> {
  const couvertes = new Set(CORRESPONDANCES.map((c) => c.contrainteId));
  const par = new Map<FiliereReferentiel, Compte>();
  for (const c of CONTRAINTES_REFERENTIEL) {
    const p = par.get(c.filiere) ?? { total: 0, auto: 0, raccordees: 0, autoNonRaccordees: 0, manuel: 0 };
    p.total += 1;
    if (c.modeEvaluation === 'auto_sig') p.auto += 1;
    else p.manuel += 1;
    if (couvertes.has(c.id)) p.raccordees += 1;
    else if (c.modeEvaluation === 'auto_sig') p.autoNonRaccordees += 1;
    par.set(c.filiere, p);
  }
  return par;
}

/**
 * Les nombres d'une ligne de tableau Markdown commencant par `libelle`.
 *
 * La premiere cellule — le libelle — est retiree avant le comptage : elle est du texte, et un
 * chiffre qui s'y trouverait fausserait la lecture. Les separateurs sont libres (`|`, `/`, gras),
 * parce que le rapport ecrit tantot une colonne par nombre, tantot « 133 / 134 / 11 / 14 ».
 */
function ligneChiffree(libelle: string): number[] {
  const ligne = RAPPORT.split('\n').find((l) => l.startsWith(`| ${libelle} |`));
  assert.ok(ligne, `le rapport doit comporter une ligne « ${libelle} »`);
  const valeurs = ligne.slice(ligne.indexOf('|', 1));
  // L'espace fine insecable separe les milliers dans le rapport : elle fait partie du nombre.
  return [...valeurs.matchAll(/\d[\d  ]*/g)].map((m) =>
    Number(m[0].replace(/[ \s]/g, '')),
  );
}

describe('le rapport de verification dit ce que le code fait', () => {
  it('le tableau par filiere est exact, colonne par colonne', () => {
    const par = recenser();
    for (const [filiere, libelle] of LIBELLES) {
      const attendu = par.get(filiere);
      assert.ok(attendu, `aucune contrainte pour ${filiere}`);
      assert.deepEqual(
        ligneChiffree(libelle),
        [attendu.total, attendu.auto, attendu.raccordees, attendu.autoNonRaccordees, attendu.manuel],
        `ligne « ${libelle} » du rapport : contraintes, auto_sig, raccordees, non raccordees, ` +
          'verification manuelle',
      );
    }
  });

  it('les totaux du rapport sont ceux du referentiel', () => {
    const par = [...recenser().values()];
    const somme = (f: (c: Compte) => number): number => par.reduce((n, c) => n + f(c), 0);
    assert.deepEqual(ligneChiffree('**Total**'), [
      somme((c) => c.total),
      somme((c) => c.auto),
      somme((c) => c.raccordees),
      somme((c) => c.autoNonRaccordees),
      somme((c) => c.manuel),
    ]);
  });

  it('les mesures de fidelite au referentiel sont exactes', () => {
    const sansNombre = CONTRAINTES_REFERENTIEL.filter((c) => c.seuilsNumeriques.length === 0).length;
    const incompletes = CONTRAINTES_REFERENTIEL.filter((c) => !c.extractionComplete).length;
    assert.deepEqual(ligneChiffree('Contraintes du classeur intégrées'), [292]);
    assert.deepEqual(ligneChiffree('Contraintes dont le seuil ne porte **aucun nombre**'), [
      sansNombre,
    ]);
    // Apostrophe DROITE : c'est la convention des fichiers de `docs/`, ou elle est employee sans
    // exception. L'apostrophe typographique est reservee au texte affiche par l'application.
    assert.deepEqual(ligneChiffree("Contraintes dont l'extraction numérique est **incomplète**"), [
      incompletes,
    ]);

    const parCaractere = (nom: string): number =>
      CONTRAINTES_REFERENTIEL.filter((c) => c.caractere === nom).length;
    assert.deepEqual(ligneChiffree('Rédhibitoires / pénalisantes / favorables / cadre'), [
      parCaractere('redhibitoire'),
      parCaractere('penalisant'),
      parCaractere('favorable'),
      parCaractere('cadre'),
    ]);
  });

  it('le millesime annonce est celui du module genere', () => {
    /*
     * Un rapport qui date d'un millesime anterieur decrit un autre classeur. Et le millesime ne
     * doit pas se redater tout seul : deux redatations fausses ont eu lieu avant que l'empreinte
     * des cellules ne soit adossee au module.
     */
    assert.ok(
      RAPPORT.includes(MILLESIME_REFERENTIEL),
      `le rapport doit annoncer le millesime ${MILLESIME_REFERENTIEL}`,
    );
  });

  it('aucune contrainte classee « verification manuelle » n’est evaluee automatiquement', () => {
    /*
     * LE REFUS QUI FONDE LE §3 DU RAPPORT. Le classeur a lui-meme ecarte ces 96 contraintes faute
     * de couche nationale homogene. En rattacher une reviendrait a rendre un verdict que la source
     * du referentiel dit impossible a rendre — et le rapport affirme que le compte est nul.
     */
    const couvertes = new Set(CORRESPONDANCES.map((c) => c.contrainteId));
    const fautives = CONTRAINTES_REFERENTIEL.filter(
      (c) => couvertes.has(c.id) && c.modeEvaluation !== 'auto_sig',
    ).map((c) => c.id);
    assert.deepEqual(fautives, []);
    assert.match(RAPPORT, /0 sur 96/, 'le rapport doit annoncer ce compte, et il doit rester nul');
  });

  it('le README annonce la meme couverture que le rapport', () => {
    /*
     * LE README EST CE QUE TOUT LE MONDE LIT, et le rapport ce que personne n'ouvre avant d'en
     * avoir besoin. La phrase du README — « 73 contraintes sur 292 sont tranchees
     * automatiquement » — est donc celle qui oriente l'usage, et c'est celle qui derivera en
     * premier si rien ne la tient.
     */
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    const total = CONTRAINTES_REFERENTIEL.length;
    const raccordees = new Set(CORRESPONDANCES.map((c) => c.contrainteId)).size;
    assert.match(
      readme,
      new RegExp(`${raccordees} contraintes sur ${total} sont tranchées automatiquement`),
      `le README doit annoncer ${raccordees} contraintes tranchees sur ${total}`,
    );
    assert.match(
      readme,
      new RegExp(`les\\s+${total - raccordees}\\s+autres sont affichées`),
      `et ${total - raccordees} affichees sans verdict`,
    );
  });

  it('toute correspondance vise une contrainte qui existe', () => {
    // Une contrainte renommee dans le classeur laisserait une correspondance orpheline, qui
    // n'evaluerait plus rien — sans erreur, et sans que le nombre de correspondances bouge.
    const connus = new Set(CONTRAINTES_REFERENTIEL.map((c) => c.id));
    const orphelines = CORRESPONDANCES.filter((c) => !connus.has(c.contrainteId)).map(
      (c) => c.contrainteId,
    );
    assert.deepEqual(orphelines, []);
  });
});
