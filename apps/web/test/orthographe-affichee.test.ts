/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN MOT NE S'ECRIT PAS DE DEUX FACONS DANS LE TEXTE QUE L'UTILISATEUR LIT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER GARDE, et pourquoi ce garde-la et pas un autre. L'audit 12 a accentue le texte
 * de l'interface. Le probleme d'une telle passe n'est pas de la faire, c'est de la MAINTENIR : rien
 * n'empeche la ligne suivante d'ecrire « critere » a cote d'un « critère » deja corrige, et le
 * resultat — la meme phrase a moitie accentuee — se lit plus mal que l'ancien texte uniformement nu.
 *
 * TROIS GARDES ONT ETE ENVISAGES, DEUX ONT ETE REJETES :
 *
 *   1. un dictionnaire francais. Rejete : `fr.dic` ne contient que des LEMMES. « évalué », « estimé »,
 *      « tracé » n'y figurent pas — ils sont produits par les regles d'affixes. Un garde fonde sur le
 *      dictionnaire laisse donc passer precisement les participes, qui sont la majorite des cas.
 *   2. un vocabulaire ecrit a la main. Rejete : une liste figee derive. Elle ne couvre que ce qu'on y
 *      a pense, elle vieillit en silence, et rien ne signale ce qui lui manque.
 *   3. **la coherence interne du depot**, retenue. La regle n'a besoin d'aucune autorite exterieure :
 *      si « filière » existe dans un libelle affiche, alors « filiere » dans un autre libelle affiche
 *      est une INCOHERENCE, quelle que soit l'orthographe « correcte ». Le depot est sa propre
 *      reference, la regle se met a jour toute seule des qu'un mot accentue apparait, et elle ne dit
 *      jamais rien sur un mot dont une seule graphie existe.
 *
 * CE QUE CETTE REGLE NE COUVRE PAS, et il faut le dire pour ne pas la surestimer : un mot qui n'est
 * ECRIT QUE sans accent partout ne la declenche jamais. La mesure de l'audit 12 en a compte environ
 * mille, dont une large majorite sont des mots justes (« des », « pour », « parcelles ») ou des
 * identifiants, et une minorite de vrais manques. Ce garde tient la COHERENCE ; il ne tient pas
 * l'exhaustivite orthographique, qui reste un travail de relecture humaine.
 *
 * QUATRE REGLES MECANIQUES ECARTENT LE CODE DU TEXTE, chacune payee par un defaut reellement
 * rencontre pendant la passe :
 *
 *   - un litteral qui n'est qu'un identifiant (`'agrivoltaisme'`, `'/api/sante'`) — la valeur
 *     d'enumeration `'agrivoltaisme'` est comparee par `===` et exportee dans le CSV ; l'accentuer
 *     cassait le moteur. Elle etait passee a travers un premier filtre parce que le test portait sur
 *     le litteral APOSTROPHES COMPRISES ;
 *   - un mot collé a un `_` ou a un `-` (`enjeu_defrichement`, `BDTOPO_V3:batiment`) — clefs de
 *     criteres, identifiants de couches WFS ;
 *   - un fragment de SQL (`'s.filiere = $1'`) — nom de colonne ;
 *   - une valeur de `className` (`carte-ko derogeable`) — cette derniere a ete attrapee par une
 *     relecture a blanc, une ligne avant d'etre appliquee : `.carte-ko.derogeable` est une regle CSS.
 *
 * Les EXCEPTIONS restantes sont nommees une par une avec leur raison. Un second test interdit qu'une
 * exception survive a la disparition du cas qu'elle couvre : une liste d'exceptions qui ne se vide
 * jamais finit par autoriser n'importe quoi.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..', '..', '..');

/**
 * Les modules dont les litteraux sont du TEXTE LU PAR L'UTILISATEUR.
 *
 * Le glob des composants web se met a jour tout seul ; les modules de `core` sont nommes un par un
 * parce que ce paquet melange du texte (libelles, reglementation) et des structures (types, sources).
 */
const MODULES: readonly string[] = [
  'packages/scoring/src/criteres-eval.ts',
  'packages/scoring/src/implantation.ts',
  'packages/scoring/src/index.ts',
  'packages/scoring/src/knockouts.ts',
  'packages/scoring/src/notes.ts',
  'packages/scoring/src/seuils-procedure.ts',
  'packages/scoring/src/sources.ts',
  'packages/core/src/avertissements.ts',
  'packages/core/src/bornes.ts',
  'packages/core/src/criteres.ts',
  'packages/core/src/filieres.ts',
  'packages/core/src/palette.ts',
  'packages/core/src/reglementation.ts',
  'packages/core/src/types.ts',
  'apps/web/src/App.tsx',
  'apps/web/src/components/BandeauAvertissements.tsx',
  'apps/web/src/components/BarreSuperieure.tsx',
  'apps/web/src/components/Carte.tsx',
  'apps/web/src/components/Connexion.tsx',
  'apps/web/src/components/Demarrage.tsx',
  'apps/web/src/components/FicheParcelle.tsx',
  'apps/web/src/components/PanneauGauche.tsx',
  'apps/web/src/components/TableauDeBord.tsx',
  'apps/web/src/components/VueListe.tsx',
  'apps/web/src/utils/affichage.ts',
  'apps/api/src/enrichissement.ts',
  'apps/api/src/services/exports.ts',
];

/**
 * Les seuls endroits ou la graphie sans accent est JUSTE, avec la raison.
 *
 * Le numero de ligne est volontairement absent : il change a chaque edition du fichier et
 * transformerait ce garde en corvee. L'exception porte donc sur le couple (module, mot), ce qui
 * suffit ici — aucun de ces mots n'apparait deux fois dans son module avec des sens differents, et
 * le troisieme test le verifie.
 */
const EXCEPTIONS: ReadonlyArray<{ module: string; mot: string; raison: string }> = [
  { module: 'apps/web/src/App.tsx', mot: 'filiere', raison: "nom du parametre de requete des URL de tuiles (`?filiere=`)" },
  { module: 'apps/web/src/components/Carte.tsx', mot: 'filiere', raison: "nom du parametre de requete des URL de tuiles (`?filiere=`)" },
  { module: 'apps/web/src/App.tsx', mot: 'demarrage', raison: "chemin d'import `./components/Demarrage.js`" },
  { module: 'apps/web/src/App.tsx', mot: 'affiche', raison: "verbe : « l'avancement s'affiche en bas de la carte »" },
  { module: 'packages/core/src/bornes.ts', mot: 'acces', raison: 'chemin de champ `acces.distanceVoirieM`' },
  { module: 'packages/core/src/bornes.ts', mot: 'normalise', raison: 'verbe : « le calcul normalise dans [0, 360[ »' },
  { module: 'packages/core/src/reglementation.ts', mot: 'norme', raison: 'le NOM norme (« conformite a une norme »), pas le participe « normé »' },
  { module: 'packages/scoring/src/criteres-eval.ts', mot: 'prive', raison: 'verbe priver : « prive le projet du portage politique »' },
  { module: 'packages/core/src/bornes.ts', mot: 'foret', raison: 'chemin de champ `occupationSol.foret.partBoisee`' },
  { module: 'packages/core/src/reglementation.ts', mot: 'publie', raison: 'verbe publier : « aucune API nationale ne publie ces documents »' },
  { module: 'packages/scoring/src/criteres-eval.ts', mot: 'majore', raison: 'verbe majorer : « qui majore la pente moyenne réelle »' },
];

const GENRES: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

/**
 * Un litteral qui n'est qu'un identifiant, un chemin, une clef ou un motif d'URL.
 *
 * LES `*` ET LES `?` VIENNENT D'UN DEFAUT REEL, trouve par la campagne de mutation. Une passe
 * d'accentuation a transforme `page.route('**​/api/referentiel*')` en `'**​/api/référentiel*'`.
 * Le motif ne correspondait plus a aucune requete, donc la reponse du referentiel n'etait plus
 * retenue, donc le test qui EXIGE d'observer la transition pendant le chargement passait
 * trivialement — et la mutation qu'il est le seul a attraper redevenait invisible. Un test qui
 * passe pour la mauvaise raison est pire qu'un test rouge.
 */
export const IDENTIFIANT = /^[a-z0-9_.:/*?=&-]+$/;
/** Un litteral qui porte du SQL : ses mots sont des noms de colonnes. */
export const SQL = /\b(SELECT|FROM|WHERE|INSERT|UPDATE|JOIN)\b/;

export function sansAccent(mot: string): string {
  return mot.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function estAccentue(mot: string): boolean {
  return /[À-ÿ]/.test(mot);
}

/** Le mot est-il colle a un `_` ou a un `-`, donc morceau d'identifiant ? */
export function colleAUnSeparateur(avant: string, apres: string): boolean {
  return avant === '_' || apres === '_' || avant === '-' || apres === '-';
}

interface Occurrence {
  module: string;
  mot: string;
  ligne: number;
  contexte: string;
}

interface Releve {
  /** Clefs desaccentuees des mots ecrits AVEC accent quelque part dans le texte affiche. */
  accentues: Map<string, Set<string>>;
  /** Mots ecrits SANS accent, un par occurrence. */
  nus: Occurrence[];
}

/** Une valeur de `className` est du CSS, jamais du texte lu. */
function estClassName(noeud: ts.Node, src: ts.SourceFile): boolean {
  const parent: ts.Node | undefined = noeud.parent;
  if (!parent) return false;
  if (ts.isJsxAttribute(parent)) return parent.name.getText(src) === 'className';
  if (
    ts.isJsxExpression(parent) ||
    ts.isTemplateExpression(parent) ||
    ts.isBinaryExpression(parent) ||
    ts.isConditionalExpression(parent)
  ) {
    return estClassName(parent, src);
  }
  return false;
}

export function relever(modules: readonly string[], racine: string): Releve {
  const accentues = new Map<string, Set<string>>();
  const nus: Occurrence[] = [];
  for (const module of modules) {
    const chemin = resolve(racine, module);
    const texte = readFileSync(chemin, 'utf8');
    const src = ts.createSourceFile(
      chemin,
      texte,
      ts.ScriptTarget.Latest,
      true,
      module.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visite = (noeud: ts.Node): void => {
      if (GENRES.has(noeud.kind) && !estClassName(noeud, src)) {
        let debut = noeud.getStart(src);
        let contenu = texte.slice(debut, noeud.getEnd());
        // Les delimiteurs sont retires AVANT le test d'identifiant : `'agrivoltaisme'` echoue le
        // test a cause des apostrophes et passerait pour du texte affiche.
        if (noeud.kind !== ts.SyntaxKind.JsxText) {
          const fin =
            noeud.kind === ts.SyntaxKind.TemplateHead || noeud.kind === ts.SyntaxKind.TemplateMiddle
              ? -2
              : -1;
          contenu = contenu.slice(1, fin);
          debut += 1;
        }
        const code = IDENTIFIANT.test(contenu.trim()) || SQL.test(contenu);
        for (const m of contenu.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{2,}/g)) {
          const mot = m[0];
          const bas = mot.toLowerCase();
          const clef = sansAccent(bas);
          const index = m.index;
          if (estAccentue(mot)) {
            const deja = accentues.get(clef) ?? new Set<string>();
            deja.add(bas);
            accentues.set(clef, deja);
            continue;
          }
          if (code) continue;
          if (colleAUnSeparateur(contenu[index - 1] ?? '', contenu[index + mot.length] ?? '')) continue;
          nus.push({
            module,
            mot: bas,
            ligne: src.getLineAndCharacterOfPosition(debut + index).line + 1,
            contexte: contenu
              .slice(Math.max(0, index - 40), index + mot.length + 40)
              .replace(/\s+/g, ' '),
          });
        }
      }
      ts.forEachChild(noeud, visite);
    };
    visite(src);
  }
  return { accentues, nus };
}

/** Les occurrences ou le meme mot existe aussi, ailleurs, en version accentuee. */
export function incoherences(releve: Releve): Occurrence[] {
  return releve.nus.filter((o) => releve.accentues.has(sansAccent(o.mot)));
}

const excepte = (o: Occurrence): boolean =>
  EXCEPTIONS.some((e) => e.module === o.module && e.mot === o.mot);

test('aucun mot du texte affiche ne s’ecrit a la fois avec et sans accent', () => {
  const releve = relever(MODULES, RACINE);
  const restantes = incoherences(releve).filter((o) => !excepte(o));
  const rapport = restantes
    .map((o) => {
      const graphies = [...(releve.accentues.get(sansAccent(o.mot)) ?? [])].join(' / ');
      return `  ${o.module}:${o.ligne}  « ${o.mot} » alors que « ${graphies} » est ecrit ailleurs\n      ${o.contexte}`;
    })
    .join('\n');
  assert.equal(
    restantes.length,
    0,
    `${restantes.length} mot(s) du texte affiche s'ecrivent de deux facons :\n${rapport}\n` +
      "Accentuez l'occurrence, ou — si la graphie nue est juste (verbe, nom de parametre, clef) — " +
      'ajoutez-la a EXCEPTIONS avec sa raison.',
  );
});

test('chaque exception couvre un cas qui existe encore', () => {
  const releve = relever(MODULES, RACINE);
  const reelles = incoherences(releve);
  const mortes = EXCEPTIONS.filter(
    (e) => !reelles.some((o) => o.module === e.module && o.mot === e.mot),
  );
  assert.deepEqual(
    mortes.map((e) => `${e.module} « ${e.mot} »`),
    [],
    "Ces exceptions ne correspondent plus a rien : le texte a change. Retirez-les, sinon la liste " +
      "finit par autoriser ce que personne n'a relu.",
  );
});

test('une exception ne couvre jamais deux occurrences de sens different', () => {
  const releve = relever(MODULES, RACINE);
  const reelles = incoherences(releve);
  // Une exception porte sur (module, mot). Si le meme mot apparait plusieurs fois dans le meme
  // module, l'exception les couvre TOUTES — ce qui n'est acceptable que si elles ont le meme sens.
  // Les URL de tuiles de `Carte.tsx` en sont le cas legitime : cinq fois le meme `?filiere=`.
  const CONNUS: Record<string, number> = {
    'apps/web/src/components/Carte.tsx|filiere': 5,
    // Les trois occurrences sont le MEME verbe, relues une par une : « le RPG ne publie pas
    // l'identité de l'exploitant », « aucune API nationale ne publie ces documents »,
    // « aucune donnée nationale ne publie les périmètres ». Aucune n'est le participe.
    'packages/core/src/reglementation.ts|publie': 3,
  };
  const compte = new Map<string, number>();
  for (const o of reelles.filter(excepte)) {
    const clef = `${o.module}|${o.mot}`;
    compte.set(clef, (compte.get(clef) ?? 0) + 1);
  }
  const trop = [...compte].filter(([clef, n]) => n > (CONNUS[clef] ?? 1));
  assert.deepEqual(
    trop.map(([clef, n]) => `${clef} : ${n} occurrences`),
    [],
    'Une exception couvre plus d’occurrences que declare : relisez-les une par une, elles peuvent ' +
      'ne pas avoir le meme sens, puis mettez CONNUS a jour.',
  );
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN SELECTEUR CHERCHE DU TEXTE AFFICHE : IL DOIT DONC S'ECRIRE COMME LUI
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CETTE PASSE A CASSE, deux fois, et la seconde apres avoir cru la famille fermee.
 * `getByLabel('Adresse electronique')` cherchait un libelle devenu « Adresse électronique » :
 * l'unique test de connexion de bout en bout echouait, et avec lui les vingt autres, qui en
 * dependent. Le typage ne peut rien voir — les deux cotes sont des chaines valides — et la suite
 * de bout en bout ne tourne ni dans `npm test` ni sans navigateur.
 *
 * POURQUOI CE GARDE-LA EST LEGITIME ALORS QU'UN AUTRE A ETE REJETE. La meme regle appliquee a
 * TOUS les litteraux d'expression reguliere des tests a ete mesuree : 22 signalements, dont une
 * majorite de faux positifs (`sur` contre `sûr`, des motifs qui visent du code source ou des clefs
 * JSON). Elle n'a pas ete livree. Restreinte aux SELECTEURS, elle ne signale que du texte affiche
 * — c'est la definition meme de `getByLabel` / `getByText` — et la mesure le confirme : trois
 * signalements, trois vrais.
 */
const CHERCHEURS: ReadonlySet<string> = new Set([
  'getByLabel',
  'getByText',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
  'getByRole',
]);

test('aucun selecteur ne cherche un texte que l’interface n’ecrit plus', () => {
  const { accentues } = relever(MODULES, RACINE);
  const fichiers = readdirSync(resolve(RACINE, 'apps/web/e2e'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `apps/web/e2e/${f}`);
  assert.ok(fichiers.length >= 5, `seulement ${fichiers.length} fichiers de bout en bout trouves`);

  const perimes: string[] = [];
  for (const module of fichiers) {
    const chemin = resolve(RACINE, module);
    const texte = readFileSync(chemin, 'utf8');
    const src = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visite = (noeud: ts.Node): void => {
      if (
        ts.isCallExpression(noeud) &&
        ts.isPropertyAccessExpression(noeud.expression) &&
        CHERCHEURS.has(noeud.expression.name.getText(src))
      ) {
        const litteraux: ts.Node[] = [];
        const collecte = (x: ts.Node): void => {
          if (
            ts.isStringLiteral(x) ||
            ts.isNoSubstitutionTemplateLiteral(x) ||
            x.kind === ts.SyntaxKind.RegularExpressionLiteral
          ) {
            litteraux.push(x);
          }
          ts.forEachChild(x, collecte);
        };
        for (const a of noeud.arguments) collecte(a);
        for (const l of litteraux) {
          const brut = l.getText(src);
          for (const m of brut.matchAll(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ]{2,}/g)) {
            const mot = m[0];
            if (estAccentue(mot)) continue;
            const graphies = accentues.get(sansAccent(mot.toLowerCase()));
            if (!graphies) continue;
            const ligne = src.getLineAndCharacterOfPosition(l.getStart(src)).line + 1;
            perimes.push(
              `${module}:${ligne}  ${brut}  — « ${mot} », mais l'interface ecrit « ${[...graphies].join(' / ')} »`,
            );
          }
        }
      }
      ts.forEachChild(noeud, visite);
    };
    visite(src);
  }
  assert.deepEqual(
    perimes,
    [],
    `Ces selecteurs cherchent un texte que l'interface n'ecrit plus :\n${perimes.join('\n')}\n` +
      'La suite de bout en bout ne tourne pas dans `npm test` : sans ce garde, la panne ne se voit ' +
      "qu'en integration continue.",
  );
});

test('les quatre regles mecaniques ecartent bien le code du texte', () => {
  assert.ok(IDENTIFIANT.test('agrivoltaisme'), "la valeur d'enumeration est un identifiant");
  assert.ok(IDENTIFIANT.test('/api/sante'), 'un chemin de route est un identifiant');
  assert.ok(!IDENTIFIANT.test('Terrain agricole exploité'), 'une phrase n’est pas un identifiant');
  assert.ok(!IDENTIFIANT.test('Debouche du digestat'), 'une majuscule suffit a trahir du texte');
  assert.ok(SQL.test('s.filiere = $1 SELECT'), 'le SQL est reconnu');
  assert.ok(colleAUnSeparateur('_', 'x'), 'un mot colle a un souligne est un identifiant');
  assert.ok(colleAUnSeparateur('x', '-'), 'un mot colle a un tiret est un identifiant');
  assert.ok(!colleAUnSeparateur(' ', ' '), 'un mot entoure d’espaces est du texte');
});

test('la mesure porte sur des modules qui existent et contiennent du texte', () => {
  const releve = relever(MODULES, RACINE);
  assert.ok(
    releve.accentues.size > 300,
    `seulement ${releve.accentues.size} mots accentues releves : la mesure ne lit plus le texte`,
  );
  assert.ok(releve.nus.length > 100, `seulement ${releve.nus.length} mots nus releves`);
  for (const m of MODULES) {
    assert.equal(relative(RACINE, resolve(RACINE, m)), m, `${m} doit etre un chemin du depot`);
  }
});
