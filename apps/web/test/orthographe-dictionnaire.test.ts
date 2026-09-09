/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * LE TEXTE AFFICHÉ CONFRONTÉ AU DICTIONNAIRE FRANÇAIS — le relevé du 8 septembre 2026
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══ CE QUE LE GARDE VOISIN NE POUVAIT PAS VOIR
 *
 * `orthographe-affichee.test.ts` vérifie une COHÉRENCE : qu'aucun mot ne s'écrive à la fois avec et
 * sans accent. C'est un garde utile, et il a attrapé de vraies fautes. Mais il a un angle mort
 * structurel : **un mot écrit sans accent PARTOUT lui paraît cohérent.** « lactoserum », « hypothese »,
 * « chaussee », « Precision » ne l'ont jamais fait échouer, parce qu'aucune graphie accentuée ne leur
 * répondait ailleurs dans le dépôt.
 *
 * ═══ CE QUI A ÉTÉ MESURÉ, ET AVEC QUOI
 *
 * Les mêmes 27 modules de texte affiché ont été confrontés au dictionnaire français de hunspell
 * (paquet `hunspell-fr`, 81 161 formes). Protocole : tout mot sans accent d'un littéral affiché est
 * soumis à hunspell ; s'il est REFUSÉ et qu'une graphie accentuée du même squelette est, elle,
 * acceptée, c'est la signature d'un accent manquant. Résultat du 8 septembre 2026 :
 *
 *     1 831 mots distincts dans le texte affiché
 *       306 refusés par hunspell
 *        86 dont le refus s'explique par un accent manquant   ← 161 occurrences
 *
 * Après correction, le même protocole rend **5 mots et 33 occurrences**, et les cinq sont légitimes :
 * `acces` et `bati` sont des chemins de champ (`bati.distanceHabitationM`), `core` est le nom du
 * paquet `@enr/core`, `demarrage` un chemin d'import, `filiere` le paramètre de requête des URL de
 * tuiles. Aucun n'est du français lu par un opérateur.
 *
 * ═══ CE QUE CE FICHIER EST, ET POURQUOI IL N'APPELLE PAS HUNSPELL
 *
 * Le dictionnaire était l'INSTRUMENT ; ce garde est le CONSTAT. Appeler hunspell depuis la suite de
 * tests aurait fait dépendre celle-ci d'un paquet système : verte sur une machine, ignorée sur une
 * autre, et rouge nulle part pour une bonne raison. Ce dépôt a déjà tranché ce genre d'arbitrage — le
 * relevé Légifrance ne va pas sur le réseau, pour le même motif.
 *
 * Ce fichier fige donc les 87 graphies corrigées et interdit leur retour dans le texte affiché. Le
 * balayage complet, lui, vit dans `scripts/orthographe-dictionnaire.mjs` : il demande `hunspell` et se
 * lance à la main quand on veut chercher de NOUVELLES fautes, pas empêcher le retour des anciennes.
 *
 * ═══ SI CE TEST VOUS BLOQUE SUR UN MOT LÉGITIME
 *
 * Certaines de ces graphies sont justes dans d'autres phrases : « l'application calcule », « la règle
 * précise que », « le rapport présente ». Le garde ne peut pas trancher entre le verbe et le
 * participe — c'est justement ce qui fait qu'un humain doit regarder. Ajoutez alors une entrée à
 * `TOLERES` avec la phrase exacte et la raison. C'est la même discipline que les `EXCEPTIONS` du
 * garde voisin, et le second test interdit qu'une tolérance survive au cas qu'elle couvre.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MODULES_TEXTE, relever } from './orthographe-affichee.test.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..', '..', '..');

/**
 * Les 87 graphies corrigées le 8 septembre 2026, qui ne doivent pas revenir dans le texte affiché.
 *
 * Elles sont dérivées mécaniquement du diff de la correction, et non recopiées à la main : une liste
 * de ce genre, écrite de mémoire, oublie toujours l'entrée qui compte.
 */
const CORRIGEES: readonly string[] = [
  'ALIENATIONS', 'Agreger', 'Demarrez', 'Etape', 'Precision', 'Preparation', 'Reessayer',
  'Reessayez', 'adaptee', 'aerienne', 'agree', 'agregee', 'allege', 'assuree', 'calcule', 'chaussee',
  'concernees', 'concu', 'consolide', 'constatee', 'contactee', 'cree', 'datee', 'decide',
  'declares', 'declenchant', 'deduits', 'definis', 'delimite', 'demarre', 'demarrera', 'demontre',
  'departementaux', 'depassent', 'depense', 'deport', 'derive', 'desactives', 'documentees',
  'elargi', 'eligibles', 'envisagee', 'etablis', 'etudie', 'evaluables', 'evalue', 'eventuelle',
  'evite', 'evolue', 'evolutive', 'expiree', 'genere', 'grisee', 'hypothese', 'imperative',
  'implante', 'indetermine', 'indiquee', 'ingere', 'installees', 'lactoserum', 'negocier',
  'obsoletes', 'paysagere', 'penalise', 'pese', 'pesent', 'precise', 'precisees', 'pres',
  'presente', 'preventive', 'protegent', 'recommandee', 'reduisait', 'reflete', 'regionaux',
  'rejete', 'renseignes', 'repond', 'represente', 'requalifies', 'resultats', 'retabli', 'seche',
  'surestimee', 'terminees',
];

/**
 * Les endroits où l'une de ces graphies est JUSTE, avec la raison.
 *
 * Vide au moment du relevé : les 161 occurrences ont toutes été corrigées, aucune n'était légitime
 * dans une chaîne affichée. La liste existe pour les phrases à venir, où le verbe non accentué sera
 * la bonne orthographe.
 */
const TOLERES: ReadonlyArray<{ module: string; mot: string; raison: string }> = [];

const tolere = (module: string, mot: string): boolean =>
  TOLERES.some((t) => t.module === module && t.mot === mot);

test('AUCUNE DES 87 GRAPHIES CORRIGÉES NE REVIENT DANS LE TEXTE AFFICHÉ', () => {
  const releve = relever(MODULES_TEXTE, RACINE);
  const interdites = new Set(CORRIGEES.map((m) => m.toLowerCase()));

  const retours = releve.nus.filter(
    (o) => interdites.has(o.mot.toLowerCase()) && !tolere(o.module, o.mot),
  );

  const rapport = retours
    .map((o) => `  ${o.module}:${o.ligne}  « ${o.mot} »\n      ${o.contexte}`)
    .join('\n');

  assert.equal(
    retours.length,
    0,
    `${retours.length} graphie(s) sans accent corrigée(s) le 8 septembre 2026 sont revenues dans ` +
      `le texte affiché :\n${rapport}\n` +
      'Accentuez l’occurrence. Si la graphie nue est la bonne dans cette phrase — le verbe plutôt ' +
      'que le participe : « l’application calcule », « la règle précise que » — ajoutez-la à ' +
      'TOLERES avec la phrase exacte et la raison.',
  );
});

test('une tolérance ne survit pas au cas qu’elle couvre', () => {
  /*
   * Une liste de tolérances qui ne se vide jamais finit par autoriser n'importe quoi. Le garde voisin
   * porte le même test sur ses EXCEPTIONS, et c'est lui qui a fait retirer trois entrées mortes.
   */
  const releve = relever(MODULES_TEXTE, RACINE);
  const presentes = new Set(releve.nus.map((o) => `${o.module}|${o.mot}`));
  const mortes = TOLERES.filter((t) => !presentes.has(`${t.module}|${t.mot}`));
  assert.deepEqual(
    mortes.map((t) => `${t.module} : « ${t.mot} »`),
    [],
    'tolérance(s) qui ne couvrent plus aucune occurrence — retirez-les',
  );
});

test('la liste des graphies corrigées est cohérente avec elle-même', () => {
  // Un doublon ou une entrée vide passerait inaperçu et affaiblirait le garde en silence.
  const vues = new Set<string>();
  for (const m of CORRIGEES) {
    assert.ok(m.trim().length >= 4, `entrée trop courte : « ${m} »`);
    assert.ok(
      m.normalize('NFD') === m.normalize('NFD').replace(/[̀-ͯ]/g, ''),
      `« ${m} » porte déjà un accent : la liste ne recense que les graphies NUES à interdire`,
    );
    const clef = m.toLowerCase();
    assert.ok(!vues.has(clef), `« ${m} » figure deux fois`);
    vues.add(clef);
  }
  /*
   * 87 et non 88 : le relevé comptait « derive » et « DERIVE » comme deux entrées (« Pré-enjeu
   * 0/100 (dérivé des zonages) » et « Indicateur DÉRIVÉ de la proximité »). La comparaison étant
   * insensible à la casse, la seule entrée minuscule barre les deux — garder les deux ferait échouer
   * le test de doublon, à juste titre.
   */
  assert.equal(CORRIGEES.length, 87, 'le relevé du 8 septembre 2026 portait 88 graphies, dont deux ne différaient que par la casse');
});

test('le script de balayage complet existe, et dit ce qu’il demande', () => {
  /*
   * Le garde ci-dessus empêche un RETOUR ; il ne cherche pas de nouvelle faute. Cette recherche-là
   * demande le dictionnaire, donc un paquet système, donc elle ne peut pas vivre dans la suite de
   * tests. Le script doit exister — sans lui, la méthode qui a trouvé ces 86 mots serait perdue avec
   * ce commentaire.
   */
  const script = readFileSync(resolve(RACINE, 'scripts/orthographe-dictionnaire.mjs'), 'utf8');
  assert.match(script, /hunspell/, 'le script doit nommer l’outil qu’il demande');
  assert.match(script, /hunspell-fr/, 'et le paquet à installer, sans quoi l’échec n’oriente vers rien');
});
