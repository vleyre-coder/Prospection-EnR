#!/usr/bin/env node
/**
 * Verification par mutation, sur les invariants les plus couteux a perdre.
 *
 * POURQUOI. Sept audits ont montre qu'un test peut passer sans rien proteger : mes propres tests
 * de `estHabitation` verifiaient un cas qui se produit 0,0 % du temps, et mon controle de contrat
 * ne couvrait que 3 connecteurs sur 14 sans le dire. La seule facon de savoir qu'un test protege
 * quelque chose est de casser ce qu'il pretend proteger et de verifier qu'il echoue.
 *
 * Ce script etait une manipulation manuelle a chaque audit. Il devient une etape de CI : chaque
 * mutation ci-dessous DOIT faire echouer au moins un test. Une mutation qui passe signale un test
 * decoratif, et c'est une regression aussi reelle qu'un bug.
 *
 * Ce n'est pas un outil de mutation generique : la liste est choisie, chaque entree correspond a
 * un defaut REELLEMENT survenu, et porte la reference de l'audit qui l'a trouve.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * COMMENT LE LANCER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   node scripts/mutation.mjs                    # tout sauf le bout en bout
 *   node scripts/mutation.mjs --avec-e2e         # la campagne complete
 *   node scripts/mutation.mjs --e2e-seulement    # les seuls motifs de bout en bout
 *   node scripts/mutation.mjs --filtre "audit 11"
 *
 * Les motifs de bout en bout exigent un navigateur (`E2E_CHROMIUM`) et une base semee
 * (`DATABASE_URL`) ; une quarantaine d'autres motifs exigent la base seule. Sans elle, ils sont
 * comptes comme non mesurables plutot que comme reussis.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE FAIRE TOURNER HORS DE L'ARBRE DE TRAVAIL — a lire avant une campagne complete
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Ce script MUTE un fichier source, lance les tests, puis le restaure. Pendant toute la duree de
 * la campagne, l'arbre de travail est donc SALE par construction, et un `git status` y voit un
 * fichier modifie qui est un bug volontaire. Deux consequences a connaitre :
 *
 *   - tout controle qui exige un arbre propre entre en conflit avec la campagne, et le reflexe de
 *     « commiter ce qui traine » pousserait la mutation elle-meme ;
 *   - une interruption laisse le fichier mute. Le marqueur `.mutation-en-cours` le nomme, et la
 *     commande suivante — quelle qu'elle soit — le restaure en l'annoncant.
 *
 * La reponse est de jouer la campagne sur une COPIE placee hors de l'arbre suivi :
 *
 *     cp -a . /chemin/hors/depot/campagne && cd /chemin/hors/depot/campagne
 *     readlink -f node_modules/@enr/core     # doit pointer DANS la copie
 *     DATABASE_URL=… E2E_CHROMIUM=… node scripts/mutation.mjs --avec-e2e
 *
 * Cela fonctionne sans rien reinstaller parce que les liens `node_modules/@enr/*` sont RELATIFS
 * (`../../packages/core`) : dans une copie, ils pointent vers les paquets de la copie. LA
 * VERIFICATION `readlink` N'EST PAS DECORATIVE — si le lien pointait hors de la copie, les tests
 * ne verraient aucune mutation et TOUS les motifs « survivraient » pour une raison sans rapport
 * avec ce qu'ils mesurent.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * `construire` : espace de travail a reconstruire avant de lancer les tests.
 *
 * Necessaire, et decouvert par ce script lui-meme. Les mutations portant sur `packages/core` ou
 * `packages/scoring` n'etaient attrapees par personne : les tests importent `@enr/scoring`, qui
 * resout vers `dist/`, si bien qu'une mutation de la SOURCE ne changeait rien au code execute. Les
 * deux mutations concernees passaient donc, et signalaient a tort des tests decoratifs. Un script de
 * verification par mutation qui se trompe sur son propre perimetre est le comble de l'ironie : il
 * faut le dire, et le corriger.
 *
 * `cwd` : repertoire depuis lequel lancer les tests, quand il ne peut pas etre la racine.
 *
 * Necessaire pour `apps/web`, et la raison est instructive. Les tests de rendu montent de vrais
 * composants, donc importent des fichiers `.tsx` ; la transformation JSX depend de
 * `"jsx": "react-jsx"`, declare dans `apps/web/tsconfig.json`. Il n'existe pas de `tsconfig.json` a
 * la racine du depot — seulement un `tsconfig.base.json` — si bien que `tsx` lance depuis la racine
 * ne trouve aucun reglage JSX et echoue sur « React is not defined ». Ce n'est pas un echec de test :
 * c'est un echec de chargement, et il aurait ete compte comme une mutation attrapee, ce qui est le
 * pire des cas — un faux vert dans l'outil meme qui traque les faux verts. Les chemins de `tests`
 * sont alors relatifs a ce `cwd`, comme le fait `npm run test -w @enr/web`.
 *
 * `commande` : commande a lancer au lieu de `npx tsx --test`, pour les mutations verifiees par un
 * test de BOUT EN BOUT. Celles-la portent le drapeau `e2e` et sont EXCLUES de l'execution par defaut :
 * elles exigent un navigateur et un serveur, que le job de CI des migrations n'a pas, et chacune coute
 * plusieurs minutes. Elles se lancent avec `--avec-e2e`, ou par `--filtre`.
 *
 * Les exclure est un choix a assumer plutot qu'a subir : il est donc ANNONCE en fin d'execution, avec
 * leur nombre. Un perimetre reduit en silence donne l'illusion d'avoir tout couvert — c'est le reproche
 * fait au garde de l'audit 5.
 *
 * @type {Array<{ audit: string, quoi: string, fichier: string, de: string, vers: string,
 *                construire?: string, cwd?: string, e2e?: boolean, commande?: string[],
 *                tests: string[] }>}
 */
const MUTATIONS = [
  {
    audit: 'audit 5',
    quoi: 'la troncature WFS n’est plus detectee',
    fichier: 'apps/api/src/connecteurs/distances.ts',
    de: 'return d != null && d <= rayonCouvertM ? d : null;',
    vers: 'return d;',
    tests: ['apps/api/test/wfs-troncature.test.ts', 'apps/api/test/zonage-naturel.test.ts'],
  },
  {
    audit: 'audit 6',
    quoi: '« Indifferencie » est de nouveau exclu des habitations',
    fichier: 'apps/api/src/connecteurs/wfs.ts',
    de: "return v === '' || v.startsWith('indiff');",
    vers: "return v === '';",
    tests: ['apps/api/test/wfs-troncature.test.ts', 'apps/api/test/transformation-connecteurs.test.ts'],
  },
  {
    audit: 'audit 6',
    quoi: 'le nom du zonage revient au premier objet renvoye',
    fichier: 'apps/api/src/connecteurs/distances.ts',
    de: 'nom: distanceRetenue == null ? null : (plusProche?.nom ?? null),',
    vers: 'nom: feats[0]?.nom ?? null,',
    tests: ['apps/api/test/zonage-naturel.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'les PPR incendie sont classes avant d’etre distingues des PPR inondation',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "if (/\\bppr[nt]?-?if\\b|\\bpprif\\b/.test(l)) trouvees.add('incendie');",
    vers: '// mutation',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'le souligne casse de nouveau la limite de mot des sigles de PPR',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "const l = brut.toLowerCase().replace(/_/g, ' ');",
    vers: 'const l = brut.toLowerCase();',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'les PPRT sont classes au libelle plutot qu’a leur provenance',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "for (const p of pprt?.objets ?? []) classer(p, ['technologique']);",
    vers: 'for (const p of pprt?.objets ?? []) classer(p, famillesRisque(p.libPpr));',
    tests: ['apps/api/test/georisques-ppr.test.ts'],
  },
  {
    audit: 'audit 7',
    quoi: 'une chaine vide redevient zero a l’ingestion',
    fichier: 'apps/api/src/ingestion/index.ts',
    de: "if (brut === '') return null;",
    vers: '// mutation',
    tests: ['apps/api/test/ingestion.test.ts'],
  },

  // --- Audit 8 : la famille « affirmer en l'absence de donnee » -------------
  //
  // Ces sept mutations retablissent chacune un des defauts de l'audit 8. Elles sont le seul moyen
  // de savoir que les gardes ajoutees protegent vraiment : la particularite de cette famille de
  // defauts est que le code fautif COMPILE, PASSE les tests, et ne plante jamais — il affirme
  // simplement une chose fausse. Un test decoratif y serait indetectable autrement.
  {
    audit: 'audit 8',
    quoi: 'une couche patrimoniale non ingeree redevient une absence constatee',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    // `presence` est devenu `exploitable` a l'audit 9 : le verdict porte desormais sur tout le
    // disque de recherche et non sur le seul departement de la parcelle. L'invariant teste est le
    // meme — une couche dont on ne sait rien ne produit pas d'absence constatee.
    de: "if (!exploitable[type]) return { recouvre: null, partRecouvrement: null, distanceM: null, nom: null };",
    vers: '// mutation',
    tests: ['apps/api/test/patrimoine-couches.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'le critere des sites classes redonne 90/100 en vert sans donnee',
    fichier: 'packages/scoring/src/criteres-eval.ts',
    de: 'return z.recouvre === false ? 90 : null;',
    vers: 'return 90;',
    construire: '@enr/scoring',
    tests: ['apps/api/test/audit8-affirmations.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'le nombre de proprietaires redevient 1 en dur',
    fichier: 'apps/api/src/connecteurs/cadastre.ts',
    de: 'nbProprietairesEstime: null,',
    vers: 'nbProprietairesEstime: 1,',
    tests: ['apps/api/test/audit8-affirmations.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'un echec de source ne grise plus le critere qui en depend',
    fichier: 'packages/scoring/src/index.ts',
    de: 'const brut = brutEvalue.note != null && sourceEnEchec(brutEvalue.sourceKey, enEchec)',
    vers: 'const brut = false',
    construire: '@enr/scoring',
    tests: ['apps/api/test/audit8-affirmations.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'un PPRI communal redevient un alea parcellaire mesure',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "if (!args.pprnConnu || args.ppriSurLaCommune || args.planIndetermine) return null;",
    vers: "if (args.ppriSurLaCommune) return 'moyen';",
    tests: ['apps/api/test/audit8-affirmations.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'un PPRN illisible redevient une absence de PPRI',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: 'if (args.incertainSiIndetermine && args.aIndetermine) return null;',
    vers: '// mutation',
    tests: ['apps/api/test/audit8-affirmations.test.ts'],
  },
  {
    audit: 'audit 8',
    quoi: 'une couche d’intrants absente redevient un comptage a zero',
    fichier: 'apps/api/src/connecteurs/gisement.ts',
    de: "const iaa = presence['industrie_agroalimentaire'] ? (comptes.iaa ?? 0) : null;",
    vers: 'const iaa = comptes.iaa ?? 0;',
    tests: ['apps/api/test/gisement-intrants.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'la liste des parcelles retrouve un tri sans ordre total',
    fichier: 'apps/api/src/services/recherche.ts',
    de: 'const ordre = `${critere}, p.idu ASC`;',
    vers: 'const ordre = critere;',
    tests: ['apps/api/test/pagination-stable.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'un tri tronque perd son departage sans que le garde structurel ne bronche',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    de: 'ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326), id\n      LIMIT $3',
    vers: 'ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)\n      LIMIT $3',
    tests: ['apps/api/test/pagination-stable.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'une distance au plus proche est de nouveau rendue sur un disque partiellement ingere',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    de: '  if (!(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, pt, plusProche.distance_m))) {\n    return { postes: [], connecteurs: [] };\n  }',
    vers: '  void plusProche;',
    tests: ['apps/api/test/couverture-disque.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'le patrimoine revient au controle du seul departement de la parcelle',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    de: '  const typesIngeres = TYPES_PATRIMOINE.filter((t) => exploitable[t]);',
    vers: '  const typesIngeres = TYPES_PATRIMOINE.filter((t) => presence[t] === true);',
    tests: ['apps/api/test/patrimoine-couches.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'le disque de recherche est declare couvert sans verification',
    fichier: 'apps/api/src/connecteurs/couches.ts',
    de: '    if (traverses.length === 0) return false;\n    return traverses.every((l) => couverts.has(l.code_departement));',
    vers: '    return true;',
    tests: ['apps/api/test/couverture-disque.test.ts', 'apps/api/test/patrimoine-couches.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'un snapshot redevient insensible a l’arrivee de la donnee',
    fichier: 'apps/api/src/depots/parcelles.ts',
    de: '  return new Date(dateSnapshot).getTime() < derniere;',
    vers: '  return false;',
    tests: ['apps/api/test/snapshot-perime-par-donnee.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'le lot a rafraichir oublie de comparer le snapshot a la derniere ingestion',
    fichier: 'apps/api/src/depots/parcelles.ts',
    // La sous-requete correlee a ete remplacee par une jointure agregee a la relecture de l'audit 9 :
    // elle coutait 2 973 ms sur 200 000 parcelles, pour une requete que /api/sante execute a chaque
    // interrogation. L'invariant teste est le meme — le lot doit comparer le snapshot a l'ingestion.
    de: '\n      OR s.date_snapshot < d.le',
    vers: '',
    tests: ['apps/api/test/snapshot-perime-par-donnee.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'une pagination incomplete autorise de nouveau l’effacement des objets non revus',
    fichier: 'apps/api/src/ingestion/disparus.ts',
    de: '  if (!complete) {',
    vers: '  if (false) {',
    tests: ['apps/api/test/disparus.test.ts'],
  },
  {
    audit: 'audit 9',
    quoi: 'le plafond de volumetrie ne garde plus contre l’effacement d’une couche entiere',
    fichier: 'apps/api/src/ingestion/disparus.ts',
    de: '  if (part > partMax) {',
    vers: '  if (false) {',
    tests: ['apps/api/test/disparus.test.ts'],
  },

  // --- Relecture de l'audit 9 : les defauts que ses propres corrections ont crees -----------
  {
    audit: 'audit 9 (relecture)',
    quoi: 'la reprise de couverture des reseaux ne repare plus une instance deja en service',
    fichier: 'db/migrations/015_reprise_couverture_reseaux.sql',
    de: "SELECT 'postes_sources', 'poste_source', code_departement, count(*),",
    vers: "SELECT 'postes_sources', 'poste_source', code_departement, count(*) WHERE false AND true,",
    tests: ['apps/api/test/reprise-couverture-reseaux.test.ts'],
  },
  {
    audit: 'audit 9 (relecture)',
    quoi: 'une couverture a comptage nul redevient « inconnu » au lieu de « regarde »',
    fichier: 'apps/api/src/connecteurs/couches.ts',
    de: "        WHERE type = $1\n        GROUP BY code_departement",
    vers: "        WHERE type = $1 AND nb_objets > 0\n        GROUP BY code_departement",
    tests: ['apps/api/test/couverture-disque.test.ts'],
  },
  {
    audit: 'audit 9 (relecture)',
    quoi: 'une route de qualification perd son refus des comptes en lecture seule',
    fichier: 'apps/api/src/routes/parcelles.ts',
    de: "    // Ce controle MANQUAIT : un compte en lecture seule pouvait qualifier une liste\n    // d'identifiants jusqu'au plafond par appel, et epuiser le quota partage par l'equipe.\n    const refus = refuserLectureSeule(req, rep);\n    if (refus) return refus;\n",
    vers: '',
    tests: ['apps/api/test/acces-roles.test.ts'],
  },

  // --- Audit 10 : la fidelite du livrable et l'exclusion des ingestions ---------------------
  {
    audit: 'audit 10',
    quoi: 'un seuil de surface redevient un nombre a point decimal dans une phrase francaise',
    fichier: 'packages/scoring/src/index.ts',
    de: 'surface minimale indicative de ${ha(min)} ha pour la filière',
    vers: 'surface minimale indicative de ${min} ha pour la filiere',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/typographie.test.ts'],
  },
  {
    audit: 'audit 10',
    quoi: 'une date du rapport PDF redevient une date ISO',
    fichier: 'apps/api/src/services/exports.ts',
    de: 'depuis le ${dateFr(s.dateEntreeEnVigueur)}',
    vers: 'depuis le ${s.dateEntreeEnVigueur}',
    tests: ['apps/api/test/exports.test.ts'],
  },
  {
    audit: 'audit 10',
    quoi: 'deux ingestions du meme connecteur peuvent de nouveau tourner en parallele',
    fichier: 'apps/api/src/ingestion/index.ts',
    de: "  const liberer = await tenterVerrou(cleVerrouIngestion(connecteur));\n  if (!liberer) {\n    journal.warn({ connecteur }, 'Ingestion refusée : une autre est en cours pour ce connecteur');\n    throw new ErreurIngestionEnCours(connecteur);\n  }",
    vers: '  const liberer = async (): Promise<void> => undefined;',
    tests: ['apps/api/test/ingestion-exclusive.test.ts'],
  },
  {
    audit: 'audit 10',
    quoi: 'le verrou d’ingestion n’est plus relache quand le travail leve',
    fichier: 'apps/api/src/ingestion/index.ts',
    de: '  try {\n    return await travail();\n  } finally {\n    await liberer();\n  }',
    vers: '  return await travail();',
    tests: ['apps/api/test/ingestion-exclusive.test.ts'],
  },

  /**
   * MUTATIONS DE L'INTERFACE.
   *
   * Elles n'existaient pas, et le comptage etait sans appel : sur 30 mutations, 26 portaient sur
   * `apps/api`, 3 sur `packages/scoring`, 1 sur une migration, et **zero sur `apps/web`**. Rien ne
   * prouvait donc que les tests de l'interface ne soient pas decoratifs — sur la seule partie que
   * l'utilisateur regarde, et celle dont le ratio de couverture etait le plus faible du depot.
   *
   * Chacune remet un defaut qui a reellement existe, et qui serait aujourd'hui invisible : aucune
   * ne fait planter la page, toutes la font mentir.
   *
   * Elles sont etiquetees « suites audit 10 » et non « audit 11 » : ce travail n'est pas un audit
   * mais la mise en oeuvre des chantiers que l'audit 10 avait laisses ouverts (§D3, §F2, §F4).
   */
  /**
   * BOUT EN BOUT : les deux defauts que seuls un navigateur et une authentification reelle peuvent
   * reveler. Marquees `e2e`, donc ecartees de l'execution par defaut.
   */
  {
    audit: 'bout en bout',
    quoi: 'les tuiles de calque repartent sans jeton, et leur 401 deconnecte l’utilisateur',
    fichier: 'apps/web/src/components/Carte.tsx',
    de: "  if (jeton && url.startsWith(`${RACINE_ABSOLUE}/api/`)) {",
    vers: "  if (jeton && url.startsWith(`${RACINE_ABSOLUE}/api/carte/tuiles/parcelles/`)) {",
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/parcours.spec.ts'],
    tests: ['e2e/parcours.spec.ts'],
  },
  {
    audit: 'bout en bout',
    quoi: 'l’ecran d’ouverture change de parent et son minuteur repart, perdant la touche pressee',
    fichier: 'apps/web/src/App.tsx',
    de: "      <div className=\"application\">\n        {accueil && <Demarrage onTermine={() => setAccueil(false)} />}\n        <div className=\"chargement\" style={{ margin: 'auto' }}>\n          <span className=\"tourniquet\" />\n          Chargement du référentiel\u2026\n        </div>\n      </div>",
    vers: "      <>\n        {accueil && <Demarrage onTermine={() => setAccueil(false)} />}\n        <div className=\"application\">\n          <div className=\"chargement\" style={{ margin: 'auto' }}>\n            <span className=\"tourniquet\" />\n            Chargement du référentiel\u2026\n          </div>\n        </div>\n      </>",
    cwd: 'apps/web',
    e2e: true,
    // Les DEUX versions compilent : la mutation doit faire echouer un test sur le COMPORTEMENT,
    // jamais sur une erreur de syntaxe — un echec de compilation serait compte comme une mutation
    // attrapee, donc un faux vert dans l'outil meme qui traque les faux verts.
    commande: ['playwright', 'test', 'e2e/accueil.spec.ts'],
    tests: ['e2e/accueil.spec.ts'],
  },

  /**
   * CHANGEMENT DE FORMAT DES EXPORTS, decide par le proprietaire du projet.
   *
   * Deux mutations, une par moitie du changement. Aucune des deux ne fait planter un export : elles le
   * font simplement redevenir illisible, ou faussement precis.
   */
  {
    audit: 'format exports',
    quoi: 'le CSV redonne les cles d’enumeration au lieu des libelles',
    fichier: 'apps/api/src/services/exports.ts',
    de: "        : (l.statutScore ? LIBELLES_SCORE[l.statutScore] : ''),",
    vers: "        : (l.statutScore ?? ''),",
    tests: ['apps/api/test/exports.test.ts'],
  },
  {
    audit: 'format exports',
    quoi: 'les coordonnees du CSV reprennent toute la precision du flottant',
    fichier: 'apps/api/src/services/exports.ts',
    de: "  const coordonnee = (n: number): string => n.toFixed(DECIMALES_COORDONNEES).replace('.', ',');",
    vers: "  const coordonnee = (n: number): string => String(n).replace('.', ',');",
    tests: ['apps/api/test/exports.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'une ingestion soumise a l’effacement cesse de marquer ses lignes comme revues',
    fichier: 'apps/api/src/ingestion/wfs-national.ts',
    de: "         -- Voir audit 9, defaut D1 : sans cette ligne, rien ne distingue un objet revu d'un objet\n         -- disparu de la source.\n         updated_at = now()`,",
    vers: "         code_departement = EXCLUDED.code_departement`,",
    tests: ['apps/api/test/effacement-cycle.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'le rapport PDF redonne la cle d’enumeration au lieu du libelle de la nature du sol',
    fichier: 'apps/api/src/services/exports.ts',
    de: "        ? (LIBELLES_TYPE_SOL[snapshot.occupationSol.typeSol] ?? snapshot.occupationSol.typeSol)",
    vers: '        ? snapshot.occupationSol.typeSol',
    tests: ['apps/api/test/rapport-pdf.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'le fondement juridique d’un rejet redevient un identifiant interne',
    fichier: 'apps/api/src/services/exports.ts',
    de: '      const regle = k.regleLiee ? REGLES_PAR_ID[k.regleLiee] : undefined;',
    vers: '      const regle = undefined;',
    tests: ['apps/api/test/rapport-pdf.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'le poids d’un critere redevient un nombre a point decimal dans la fiche',
    fichier: 'apps/web/src/components/FicheParcelle.tsx',
    de: "poids {formatNombre(critere.poids * 100, '%', 1)}",
    vers: 'poids {(critere.poids * 100).toFixed(1)} %',
    cwd: 'apps/web',
    tests: ['test/rendu-fiche.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'une distance de zonage redevient un nombre a point decimal',
    fichier: 'apps/web/src/components/FicheParcelle.tsx',
    de: "        : formatNombre(z.distanceM / 1000, 'km', 1)}",
    vers: '        : `${(z.distanceM / 1000).toFixed(1)} km`}',
    cwd: 'apps/web',
    tests: ['test/rendu-fiche.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'les avertissements de la section 12 cessent d’etre affiches',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: "    (a) => a.portee === 'global' && !etat.avertissementsMasques.includes(a.id),",
    vers: "    (a) => a.portee === 'jamais' && !etat.avertissementsMasques.includes(a.id),",
    cwd: 'apps/web',
    tests: ['test/rendu-bandeau.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'un compte en lecture seule se voit de nouveau proposer un rafraichissement voue au 403',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: "  const peutRafraichir = role === 'admin' || role === 'prospection';",
    vers: '  const peutRafraichir = true;',
    cwd: 'apps/web',
    tests: ['test/rendu-bandeau.test.ts'],
  },
  {
    audit: 'suites audit 10',
    quoi: 'l’etat pose par un test de rendu redevient silencieusement ignore',
    fichier: 'apps/web/test/aides/rendu.ts',
    de: '  Object.assign(courant, ETAT_PAR_DEFAUT, partiel);',
    vers: '  Object.assign(courant, ETAT_PAR_DEFAUT);',
    cwd: 'apps/web',
    tests: ['test/rendu-bandeau.test.ts', 'test/rendu-liste-tableau.test.ts'],
  },

  // --- Signalement d'usage : toutes les parcelles de France doivent etre atteignables -------------
  {
    audit: 'parcelles manquantes',
    quoi: 'la recherche par identifiant redevient aveugle a toute parcelle non qualifiee',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '  const enBase = await parcelleEnResultat(idu);\n  if (enBase) return enBase;',
    vers: '  const enBase = await parcelleEnResultat(idu);\n  return enBase;',
    tests: ['apps/api/test/recherche-parcelle-inconnue.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'une position inconnue redevient le sentinelle [0, 0] — le golfe de Guinee',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "      sousTitre: `${idu} - cadastre injoignable, existence non verifiee - a qualifier`,\n      centroide: null,",
    vers: "      sousTitre: `${idu} - cadastre injoignable, existence non verifiee - a qualifier`,\n      centroide: [0, 0],",
    tests: ['apps/api/test/recherche-parcelle-inconnue.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'un identifiant absent du cadastre redevient une parcelle affirmee « a qualifier »',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '  if (!brute) return null;\n\n  return {\n    type: \'parcelle\',\n    libelle: `Parcelle ${brute.section} ${brute.numero}`,',
    vers: '  if (!brute) {\n    return {\n      type: \'parcelle\',\n      libelle: `Parcelle ${section} ${numero}`,\n      sousTitre: `${idu} - a qualifier`,\n      centroide: null,\n      bbox: null,\n      idu,\n      codeInsee,\n    };\n  }\n\n  return {\n    type: \'parcelle\',\n    libelle: `Parcelle ${brute.section} ${brute.numero}`,',
    tests: ['apps/api/test/recherche-parcelle-inconnue.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'un numero de parcelle court est complete a DROITE — « 2 » devient 2000',
    fichier: 'packages/core/src/snapshot.ts',
    de: "  const numero = parties.numero.trim().padStart(4, '0').slice(-4);",
    vers: "  const numero = parties.numero.trim().padEnd(4, '0').slice(-4);",
    construire: '@enr/core',
    tests: ['packages/core/test/composer-idu.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'cliquer une parcelle DEJA qualifiee relance une qualification par-dessus sa fiche',
    fichier: 'apps/web/src/utils/clic-cadastre.ts',
    de: "  if (arg.parcelleQualifieeSousLeCurseur) return { action: 'ignorer' };",
    vers: '  // depart retire',
    cwd: 'apps/web',
    tests: ['test/clic-cadastre.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'un clic de mesure ou de selection declenche aussi une qualification',
    fichier: 'apps/web/src/utils/clic-cadastre.ts',
    de: "  if (arg.outil !== 'aucun') return { action: 'ignorer' };",
    vers: '  // depart retire',
    cwd: 'apps/web',
    tests: ['test/clic-cadastre.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'une tuile qui n’identifie pas la parcelle mene quand meme a une qualification',
    fichier: 'apps/web/src/utils/clic-cadastre.ts',
    de: "  const idu = iduDepuisTuile(arg.proprietes);\n  if (!idu) {",
    vers: "  const idu = iduDepuisTuile(arg.proprietes) ?? '00000000000000';\n  if (false) {",
    cwd: 'apps/web',
    tests: ['test/clic-cadastre.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'le gestionnaire du cadastre est branche sans jamais etre debranche',
    fichier: 'apps/web/src/components/Carte.tsx',
    de: "      m.off('click', 'cadastre-surface', surClicCadastre);\n",
    vers: '',
    cwd: 'apps/web',
    tests: ['test/clic-cadastre.test.ts'],
  },
  {
    /**
     * LA MUTATION QUI REPRODUIT LE SIGNALEMENT LUI-MEME : la couche du cadastre complet disparait, et
     * seules les parcelles deja qualifiees restent visibles. C'est l'etat exact de l'application quand
     * le prospecteur n'a pas trouve la parcelle de son collegue.
     *
     * Le zoom minimal est porte a 22 plutot que la couche supprimee : les deux couches de style qui
     * s'appuient sur la source resteraient sinon sans source, et MapLibre leverait — un echec de
     * chargement, non un echec de comportement, et la mutation serait comptee attrapee pour la
     * mauvaise raison.
     */
    audit: 'parcelles manquantes',
    quoi: 'la couche du cadastre complet cesse d’etre demandee : retour a l’etat du signalement',
    fichier: 'apps/web/src/components/Carte.tsx',
    de: "      tiles: [`${RACINE_ABSOLUE}/api/carte/cadastre/{z}/{x}/{y}.pbf`],\n      minzoom: ZOOM_MIN_PARCELLES,",
    vers: "      tiles: [`${RACINE_ABSOLUE}/api/carte/cadastre/{z}/{x}/{y}.pbf`],\n      minzoom: 22,",
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/cadastre.spec.ts'],
    tests: ['e2e/cadastre.spec.ts'],
  },
  {
    /**
     * La relecture des rapports PDF choisissait ses cas dans la base : sa portee dependait donc de la
     * machine, et tombait a zero sur une base vierge — celle de la CI. Les cas sont desormais semes
     * depuis les fixtures, et la portee est EXIGEE. Cette mutation verifie que l'exigence tient.
     */
    audit: 'parcelles manquantes',
    quoi: 'la relecture PDF accepte de nouveau de ne couvrir aucune filiere',
    fichier: 'apps/api/test/rapport-pdf.test.ts',
    de: '  if (PARCELLES.size === 0) return;\n  app = await construireServeur({ secretJwt: SECRET });',
    vers: '  PARCELLES.clear();\n  ECARTEES.clear();\n  app = await construireServeur({ secretJwt: SECRET });',
    tests: ['apps/api/test/rapport-pdf.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'les quatre autorisations transversales disparaissent des quatre filieres',
    fichier: 'packages/scoring/src/seuils-procedure.ts',
    de: '  const out: Array<SeuilProcedure | null> = [...proceduresTransversales(s)];',
    vers: '  const out: Array<SeuilProcedure | null> = [];',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/procedures-transversales.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'le defrichement cesse de suivre la couverture forestiere mesuree',
    fichier: 'packages/scoring/src/seuils-procedure.ts',
    de: "      'defrichement',\n      s.milieux.enjeuDefrichement,",
    vers: "      'defrichement',\n      null,",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/procedures-transversales.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'l’enjeu especes protegees s’affirme « non applicable » sur une donnee absente',
    fichier: 'packages/scoring/src/seuils-procedure.ts',
    de: "    seuilCommun('especes_protegees', null),",
    vers: "    seuilCommun('especes_protegees', false),",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/procedures-transversales.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'l’evaluation Natura 2000 ne se declenche plus que sur recouvrement, jamais sur proximite',
    fichier: 'packages/scoring/src/seuils-procedure.ts',
    de: '            return d == null ? null : d <= 5000 ? true : false;',
    vers: '            return d == null ? null : false;',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/procedures-transversales.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'l’eolien reperd le motif du faisceau hertzien, pourtant mesure',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  eolien_terrestre: [...COMMUNS, koDistanceHabitation500, koMonumentSiteClasse, koRadar, koEolFaisceauHertzien],',
    vers: '  eolien_terrestre: [...COMMUNS, koDistanceHabitation500, koMonumentSiteClasse, koRadar],',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'la methanisation reperd le motif de l’acces poids lourds quotidien',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  methanisation: [...COMMUNS, koMethaHabitation200, koMethaCaptage, koMethaCoursEau, koMethaAccesEngins],',
    vers: '  methanisation: [...COMMUNS, koMethaHabitation200, koMethaCaptage, koMethaCoursEau],',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'le knock-out du captage AEP redevient inatteignable sur de la donnee reelle',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  if (c.dansPerimetre === true && c.type == null) {',
    vers: "  if (c.dansPerimetre === true && c.type === 'jamais_produit_par_le_connecteur') {",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'le recul de 500 m cesse d’examiner la zone d’habitat faute de batiment mesure',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  const atteignable = d == null ? null : distanceAtteignableM(d, ctx.surfaceHa);\n  if (d != null && atteignable != null && atteignable < 500) {',
    vers: '  if (d == null) return null;\n  const atteignable = distanceAtteignableM(d, ctx.surfaceHa);\n  if (atteignable < 500) {',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'le stockage reperd son unique motif eliminatoire propre',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  bess: [...COMMUNS, koBessAccesEngins],',
    vers: '  bess: [...COMMUNS],',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'les protections fortes disparaissent de la liste des identifiants desactivables',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: "  'ko_coeur_parc_national',\n",
    vers: '',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'une reference proposee se presente comme verifiee par un juriste',
    fichier: 'packages/core/src/reglementation.ts',
    // Reancrage apres le releve Legifrance du 7 septembre 2026 : le commentaire de cette regle a
    // ete corrige, et l'ancien motif portait sa derniere phrase.
    de: "      'noter aussi, lu au même endroit : pour un projet relevant de l’article L.181-1, l’autorisation ' +\n      'environnementale tient lieu de cette autorisation spéciale.',\n    aValiderParJuriste: true,",
    vers: "      'noter aussi, lu au même endroit : pour un projet relevant de l’article L.181-1, l’autorisation ' +\n      'environnementale tient lieu de cette autorisation spéciale.',",
    construire: '@enr/core',
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'couverture',
    quoi: 'une servitude aeronautique se refonde sur l’arrete « radars », qui ne la regit pas',
    fichier: 'packages/scoring/src/knockouts.ts',
    construire: '@enr/scoring',
    de: "      \"La parcelle est grevée d'une servitude aéronautique de dégagement : la hauteur des aérogénérateurs y est incompatible. Le plan de servitudes applicable est à vérifier auprès du gestionnaire de l'aérodrome ou de la DGAC.\",\n      'risques',\n    );",
    vers: "      \"La parcelle est grevée d'une servitude aéronautique de dégagement : la hauteur des aérogénérateurs y est incompatible. Le plan de servitudes applicable est à vérifier auprès du gestionnaire de l'aérodrome ou de la DGAC.\",\n      'risques',\n      'eol_radar',\n    );",
    tests: ['packages/scoring/test/fondement-knockouts.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'une cellule d’emprise en echec redevient invisible pour l’utilisateur',
    fichier: 'apps/api/src/connecteurs/cadastre.ts',
    de: '      cellulesEnEchec += 1;',
    vers: '      // compte retire',
    tests: ['apps/api/test/couverture-campagne.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'les parcelles ecartees par le filtre de surface cessent d’etre comptees',
    fichier: 'apps/api/src/connecteurs/cadastre.ts',
    de: '          if (!parIdu.has(p.idu)) ecarteesSurface += 1;',
    vers: '          // compte retire',
    tests: ['apps/api/test/couverture-campagne.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'l’arret au plafond de lot ne signale plus les secteurs non interroges',
    fichier: 'apps/api/src/connecteurs/cadastre.ts',
    de: '      plafondAtteint = true;\n      cellulesSautees = cellules.length - i;',
    vers: '      plafondAtteint = false;',
    tests: ['apps/api/test/couverture-campagne.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'une couverture complete declenche quand meme un avertissement',
    fichier: 'apps/api/src/services/qualification.ts',
    de: '  if (morceaux.length === 0) return null;',
    vers: "  if (morceaux.length === 0) morceaux.push('rien');",
    tests: ['apps/api/test/couverture-campagne.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'l’avertissement de couverture cesse de dire comment contourner la troncature',
    fichier: 'apps/api/src/services/qualification.ts',
    de: "    'Une parcelle precise peut toujours être qualifiée en la cliquant sur le cadastre, ou par sa ' +\n    'référence dans la recherche.'",
    vers: "    ''",
    tests: ['apps/api/test/couverture-campagne.test.ts'],
  },
  {
    audit: 'parcelles manquantes',
    quoi: 'le prefixe de commune absorbee redevient « 000 » en dur',
    fichier: 'packages/core/src/snapshot.ts',
    de: "  const prefixe = (parties.prefixe ?? '000').trim().padStart(3, '0').slice(-3);",
    vers: "  const prefixe = '000';",
    construire: '@enr/core',
    tests: ['packages/core/test/composer-idu.test.ts'],
  },
  // --- Portail d'acces Netlify -----------------------------------------------------------
  //
  // Un portail d'authentification est le pire endroit pour un test decoratif : il est vert
  // aussi longtemps que personne n'essaie d'entrer. Les sept mutations ci-dessous cassent
  // chacune une propriete que le portail est CENSE garantir.
  {
    audit: 'portail netlify',
    quoi: 'le portail laisse entrer sans verifier le mot de passe',
    fichier: 'netlify/edge-functions/portail.ts',
    de: "  return (await coupleValide(presente, reglages)) ? 'ouvert' : 'refuse';",
    vers: "  return 'ouvert';",
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: 'le couple identifiant/mot de passe est compare sans separateur',
    fichier: 'netlify/edge-functions/portail.ts',
    de: "const SEPARATEUR = '\\u0000';",
    vers: "const SEPARATEUR = '';",
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: 'le defi HTTP reprend un caractere hors ASCII et fait planter la fonction',
    fichier: 'netlify/edge-functions/portail.ts',
    de: "const DOMAINE_AUTH = 'Prospection EnR - acces reserve';",
    vers: "const DOMAINE_AUTH = 'Prospection EnR — acces reserve';",
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: 'la page de refus reapprend a un inconnu ce que garde le portail',
    fichier: 'netlify/edge-functions/portail.ts',
    de: "  <p>Cette application n'est pas publique.",
    vers: "  <p>Cette application de prospection fonciere n'est pas publique.",
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: '`/api/*` cesse d’etre exclu du portail',
    fichier: 'netlify/edge-functions/portail.ts',
    de: "  excludedPath: ['/api/*'],",
    vers: '  excludedPath: [],',
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: 'le plafond par IP devient si serre qu’il coupe un premier affichage',
    fichier: 'netlify/edge-functions/portail.ts',
    de: '    windowLimit: 300,',
    vers: '    windowLimit: 3,',
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  {
    audit: 'portail netlify',
    quoi: 'l’exigence de variete du mot de passe ne s’applique plus',
    fichier: 'scripts/portail-mot-de-passe.mjs',
    de: '  if (distincts < DISTINCTS_MINIMAUX) {',
    vers: '  if (false) {',
    cwd: 'apps/web',
    tests: ['test/portail-netlify.test.ts'],
  },
  // --- Garde d'envoi de l'application locale ----------------------------------------------
  //
  // La faute que ce garde empeche est la seule du depot qu'on ne puisse PAS corriger apres
  // coup : un fichier de base pousse sur GitHub reste dans l'historique et dans toutes les
  // copies clonees. Les quatre mutations ci-dessous cassent chacune une des quatre proprietes
  // qui le rendent efficace.
  {
    audit: 'application locale',
    quoi: 'les chemins Windows echappent au garde faute de normalisation',
    fichier: 'scripts/portable/depot.mjs',
    de: "    const chemin = brut.replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
    vers: "    const chemin = brut.replace(/^\\.\\//, '');",
    cwd: 'apps/web',
    tests: ['test/portable-depot.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'le dossier de la base n’est plus reconnu comme interdit',
    fichier: 'scripts/portable/depot.mjs',
    de: '    motif: /^donnees\\//,',
    vers: '    motif: /^__jamais_rencontre__\\//,',
    cwd: 'apps/web',
    tests: ['test/portable-depot.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'l’exception des jeux d’essai disparait et bloque le travail ordinaire',
    fichier: 'scripts/portable/depot.mjs',
    de: '      (i) => i.motif.test(chemin) && !(i.saufSi && i.saufSi.test(chemin)),',
    vers: '      (i) => i.motif.test(chemin),',
    cwd: 'apps/web',
    tests: ['test/portable-depot.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'un fichier interdit n’arrete plus l’envoi',
    fichier: 'scripts/portable/depot.mjs',
    de: "  if (refuses.length > 0 && !forcer) return { action: 'refuser', autorises, refuses };",
    vers: "  if (false) return { action: 'refuser', autorises, refuses };",
    cwd: 'apps/web',
    tests: ['test/portable-depot.test.ts'],
  },
  // --- Ecran de demarrage de l'application de bureau ---------------------------------------
  //
  // Une animation cassee ne fait rien planter : elle rend seulement l'attente illisible, ou le
  // journal impossible a relire. C'est exactement le genre de regression qui traverse des mois
  // sans etre vue. Chacune des quatre mutations casse une propriete verifiee.
  {
    audit: 'application locale',
    quoi: 'les codes d’echappement partent aussi sans terminal',
    fichier: 'scripts/portable/animation.mjs',
    de: "    if (this.interactif) this.ecrire('\\r\\u001b[2K');",
    vers: "    this.ecrire('\\r\\u001b[2K');",
    cwd: 'apps/web',
    tests: ['test/portable-animation.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'la roue retient le processus en vie',
    fichier: 'scripts/portable/animation.mjs',
    de: "    if (typeof this.minuterie.unref === 'function') this.minuterie.unref();",
    vers: '    /* mutation : plus de unref */',
    cwd: 'apps/web',
    tests: ['test/portable-animation.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'l’ecran de demarrage avale l’erreur pour rester joli',
    fichier: 'scripts/portable/animation.mjs',
    de: '      throw erreur;',
    vers: '      return undefined;',
    cwd: 'apps/web',
    tests: ['test/portable-animation.test.ts'],
  },
  {
    audit: 'application locale',
    quoi: 'les durees perdent leur changement de precision',
    fichier: 'scripts/portable/animation.mjs',
    de: "  return s < 10 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s)} s`;",
    vers: "  return `${s.toFixed(1).replace('.', ',')} s`;",
    cwd: 'apps/web',
    tests: ['test/portable-animation.test.ts'],
  },
  // --- Mode bureau : pas de mot de passe sur un poste, et rien de plus --------------------
  //
  // Ce garde est le seul qui autorise une API sans authentification. S'il cede, une
  // installation joignable depuis le reseau sert les donnees de proprietaires a qui les
  // demande. Les deux mutations attaquent sa piece portante.
  {
    audit: 'mode bureau',
    quoi: 'n’importe quelle adresse passe pour la boucle locale',
    // `estBoucleLocale` a demenage de `serveur.ts` vers `config.ts` a l'audit 11, pour que la
    // sonde `/api/sante` puisse la lire sans import circulaire. La campagne l'a signale
    // elle-meme — « motif introuvable » — au lieu de laisser la mutation passer pour attrapee.
    fichier: 'apps/api/src/config.ts',
    de: '  return octets[0] === 127;',
    vers: '  return true;',
    tests: ['apps/api/test/mode-bureau.test.ts'],
  },
  {
    audit: 'mode bureau',
    quoi: 'le controle par prefixe revient, et un nom de domaine passe',
    fichier: 'apps/api/src/config.ts',
    de: '  if (!v4) return false;',
    vers: "  if (!v4) return h.startsWith('127.');",
    tests: ['apps/api/test/mode-bureau.test.ts'],
  },
  // --- Amorce nationale : ce que l'archive distribuee embarque ----------------------------
  //
  // La faute que ces gardes empechent n'a aucun rattrapage : un fichier distribue ne se
  // reprend pas. Une table de trop, et ce sont des donnees nominatives de proprietaires — ou
  // le secret de signature des jetons — diffusees en autant de copies que de telechargements.
  {
    audit: 'amorce',
    quoi: 'le secret de signature n’est plus ecarte de l’amorce',
    fichier: 'scripts/portable/amorce.mjs',
    de: "  parametre: 'secret de signature des jetons (« Ne jamais exposer », dit le schema)',",
    vers: '  // mutation : classement retire',
    tests: ['apps/api/test/amorce-nationale.test.ts'],
  },
  {
    audit: 'amorce',
    quoi: 'une table inconnue est embarquee au lieu d’exiger une decision',
    fichier: 'scripts/portable/amorce.mjs',
    de: '    else nonClassees.push(t);',
    vers: '    else embarquees.push(t);',
    tests: ['apps/api/test/amorce-nationale.test.ts'],
  },
  {
    audit: 'amorce',
    quoi: 'le controle ne voit plus les tables ecrites sans prefixe de schema',
    fichier: 'scripts/portable/amorce.mjs',
    de: "        const copie = /^COPY\\s+(?:public\\.)?([a-z_][a-z0-9_]*)/i.exec(ligne);",
    vers: "        const copie = /^COPY\\s+public\\.([a-z_][a-z0-9_]*)/i.exec(ligne);",
    tests: ['apps/api/test/amorce-nationale.test.ts'],
  },
  {
    audit: 'amorce',
    quoi: 'les tables interdites trouvees dans le fichier ne sont plus signalees',
    fichier: 'scripts/portable/amorce.mjs',
    de: '        if (interdites.includes(table)) fautes.push(table);',
    vers: '        /* mutation : faute avalee */',
    tests: ['apps/api/test/amorce-nationale.test.ts'],
  },

  // --------------------------------------------------------- audit 11 : le filet de cet outil ---
  /**
   * CES DEUX ENTREES MUTENT CE FICHIER-CI, et c'est volontaire. Le filet contre l'interruption
   * est du code comme un autre : il a ete ecrit une fois, place au mauvais endroit, et n'a
   * protege personne pendant un commit entier. Il doit donc etre verifie par les memes moyens
   * que le reste. L'execution en cours a deja charge sa propre source, la mutation ne la
   * derange pas ; et si elle etait interrompue, la restauration au demarrage la reparerait.
   */
  {
    audit: 'audit 11',
    quoi: 'la restauration apres interruption est purement et simplement supprimee',
    fichier: 'scripts/mutation.mjs',
    de: '\nrestaurerApresInterruption();\n',
    vers: '\n/* mutation : plus aucune reparation au demarrage */\n',
    tests: ['apps/web/test/mutation-filet.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/mutation-filet.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'un filtre sans correspondance sort en succes et laisse croire que tout va bien',
    fichier: 'scripts/mutation.mjs',
    de: '  if (A_JOUER.length === 0) process.exit(1);',
    vers: '  if (A_JOUER.length === 0) process.exit(0);',
    tests: ['apps/web/test/mutation-filet.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/mutation-filet.test.ts'],
  },

  /**
   * LA COURSE ENTRE FICHIERS DE TEST, qui a rendu la CI rouge huit livraisons de suite.
   * Ces mutations verifient les deux moities du remede : la fonction qui decide du refus, et
   * son BRANCHEMENT — un garde calcule puis ignore serait le pire des deux mondes.
   */
  {
    audit: 'audit 11',
    quoi: 'le refus de course ne refuse plus jamais rien',
    fichier: 'apps/api/test/aides/communes-fictives.ts',
    de: '  if (!env.DATABASE_URL) return null;',
    vers: '  return null; // mutation : garde neutralise',
    tests: ['apps/api/test/serialisation-base.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/serialisation-base.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'le refus est calcule puis jete a la poubelle, sans etre leve',
    fichier: 'apps/api/test/aides/communes-fictives.ts',
    de: 'if (refus) throw new Error(refus);',
    vers: 'if (refus) void refus; // mutation : garde debranche',
    tests: ['apps/api/test/serialisation-base.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/serialisation-base.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'le rayon de raccordement redevient un Number() non valide, apres la requete',
    fichier: 'apps/api/src/routes/carte.ts',
    de: "    const rayonDemande = nombreRequete(q.rayonKm, 'rayonKm', { defaut: 0, max: 500 });",
    vers: '    const rayonDemande = Number(q.rayonKm ?? 0); // mutation : plus aucune validation',
    tests: ['apps/api/test/routes-validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/routes-validation.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'la sonde de sante redevient aveugle au mode bureau et prescrit de casser l’application',
    fichier: 'apps/api/src/config.ts',
    de: '  if (c.env === \'production\' && !bureauRecevable) {',
    vers: "  if (c.env === 'production') {",
    tests: ['apps/api/test/mode-bureau.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/mode-bureau.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'un mode bureau expose au reseau n’est plus signale par la sonde',
    fichier: 'apps/api/src/config.ts',
    de: '  if (c.auth.modeBureau && !estBoucleLocale(c.hote)) {',
    vers: '  if (false) {',
    tests: ['apps/api/test/mode-bureau.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/mode-bureau.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'n’importe quel service sur le port redevient « notre application deja ouverte »',
    fichier: 'scripts/portable/lanceur.mjs',
    de: '  return typeof corps.versionMoteur === \'string\' && typeof corps.baseDeDonnees === \'string\';',
    vers: '  return true; // mutation : tout 200 vaut acquiescement',
    tests: ['apps/web/test/portable-port.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/portable-port.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'un fichier de port abime est cru sur parole',
    fichier: 'scripts/portable/lanceur.mjs',
    de: '    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;',
    vers: '    return port; // mutation : aucune validation du port relu',
    tests: ['apps/web/test/portable-port.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/portable-port.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'la pause de lecture attend une touche meme sans terminal, donc pour toujours',
    fichier: 'scripts/portable/animation.mjs',
    de: "  if (!sortie.isTTY || !entree.isTTY) return Promise.resolve('non interactif');",
    vers: '  // mutation : la pause vaut aussi hors terminal',
    tests: ['apps/web/test/portable-animation.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/portable-animation.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'la fenetre laissee sur un echec ne se ferme plus jamais, et retient la base',
    fichier: 'scripts/portable/animation.mjs',
    de: "    const minuterie = setTimeout(() => finir('delai'), plafondMs);",
    vers: '    const minuterie = null; // mutation : plus aucun delai maximal',
    tests: ['apps/web/test/portable-animation.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/portable-animation.test.ts'],
  },

  /**
   * L'ADRESSE D'ECOUTE DU SERVEUR DE TEST. Ces deux mutations retablissent le defaut qui a
   * rendu le job de bout en bout rouge huit livraisons de suite : un serveur attache a
   * `localhost` — donc a `::1` sur un runner GitHub — pendant que les tests visent 127.0.0.1.
   * Elles n'exigent aucun navigateur : le garde lit la configuration.
   */
  {
    audit: 'audit 11',
    quoi: 'le serveur de previsualisation reprend une adresse d’ecoute par defaut',
    fichier: 'apps/web/playwright.config.ts',
    de: ' --strictPort --host 127.0.0.1`,',
    vers: ' --strictPort`,',
    tests: ['apps/web/test/e2e-adresse-ecoute.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/e2e-adresse-ecoute.test.ts'],
  },
  {
    audit: 'audit 11',
    quoi: 'la sonde de disponibilite redevient un simple numero de port',
    fichier: 'apps/web/playwright.config.ts',
    de: '      url: `${E2E.urlWeb}/`,',
    vers: '      port: PORT_WEB,',
    tests: ['apps/web/test/e2e-adresse-ecoute.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/e2e-adresse-ecoute.test.ts'],
  },

  // ─── audit 12 : la coherence orthographique du texte affiche ─────────────────────────────────
  {
    audit: 'audit 12',
    quoi: "un libelle affiche perd son accent alors que le meme mot reste accentue ailleurs",
    fichier: 'packages/core/src/criteres.ts',
    de: "Sensibilité archéologique",
    vers: "Sensibilite archéologique",
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 12',
    quoi: "la regle qui distingue une valeur de className du texte affiche est levee",
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: "  if (ts.isJsxAttribute(parent)) return parent.name.getText(src) === 'className';",
    vers: '  if (ts.isJsxAttribute(parent)) return false;',
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 12',
    quoi: "la regle qui ecarte les litteraux identifiants est levee : `'agrivoltaisme'` repasse pour du texte",
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: "export const IDENTIFIANT = /^[a-z0-9_.:/*?=&-]+$/;",
    vers: 'export const IDENTIFIANT = /^$/;',
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 12',
    quoi: 'les delimiteurs ne sont plus retires avant le test d’identifiant (le defaut reellement commis)',
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: '          contenu = contenu.slice(1, fin);',
    vers: '          contenu = contenu.slice(0, fin);',
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },

  // ─── audit 13 : le retrait des avertissements du §12 est definitif et reversible ────────────
  {
    audit: 'audit 13',
    quoi: 'le retrait d’un avertissement redevient valable pour la seule session',
    fichier: 'apps/web/src/store/etat.ts',
    de: '  avertissementsMasques: prefs.avertissementsMasques ?? [],',
    vers: '  avertissementsMasques: [],',
    tests: ['apps/web/test/avertissements-persistance.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/avertissements-persistance.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'le retrait n’est plus ecrit dans le stockage : il meurt avec l’onglet',
    fichier: 'apps/web/src/store/etat.ts',
    de: `      const suivant = { ...e, avertissementsMasques: [...e.avertissementsMasques, id] };
      enregistrerPreferences(suivant);`,
    vers: '      const suivant = { ...e, avertissementsMasques: [...e.avertissementsMasques, id] };',
    tests: ['apps/web/test/avertissements-persistance.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/avertissements-persistance.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'le rappel vide l’ecran mais pas le stockage : les avertissements reviennent au chargement',
    fichier: 'apps/web/src/store/etat.ts',
    de: `      const suivant = { ...e, avertissementsMasques: [] };
      enregistrerPreferences(suivant);`,
    vers: '      const suivant = { ...e, avertissementsMasques: [] };',
    tests: ['apps/web/test/avertissements-persistance.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/avertissements-persistance.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'retirer deux fois le meme avertissement le compte deux fois, et le compteur ment',
    fichier: 'apps/web/src/store/etat.ts',
    de: '      if (e.avertissementsMasques.includes(id)) return {};',
    vers: '      // mutation',
    tests: ['apps/web/test/avertissements-persistance.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/avertissements-persistance.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'le bouton promet de nouveau un masquage limite a la session',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    // Reindente avec le repliement du §12 : le bouton est descendu d'un niveau dans le JSX.
    de: '                  Retirer\n                </button>',
    vers: '                  Masquer\n                </button>',
    tests: ['apps/web/test/rendu-bandeau.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-bandeau.test.ts'],
  },

  // ─── audit 13 : les zones que l'application propose d'elle-meme ─────────────────────────────
  {
    audit: 'audit 13',
    quoi: 'une zone trop petite pour la filiere redevient proposable',
    fichier: 'apps/api/src/services/zones.ts',
    de: '    if (surfaceUtileHa < surfaceUtileMinHa) {',
    vers: '    if (false) {',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'le seuil de surface redevient le meme pour toutes les filieres',
    fichier: 'apps/api/src/services/zones.ts',
    de: '  const surfaceUtileMinHa = FILIERES_META[o.filiere].surfaceUtileMinHa;',
    vers: '  const surfaceUtileMinHa = 1;',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'les zones designees pour une AUTRE filiere sont proposees aussi',
    fichier: 'apps/api/src/services/zones.ts',
    de: '      WHERE $1 = ANY(z.filieres)',
    vers: '      WHERE ($1 IS NOT NULL OR true)',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'la couverture d’ingestion n’est plus rendue : une liste vide se lit « rien a prospecter »',
    fichier: 'apps/api/src/services/zones.ts',
    de: `    departementsIngeres: couverts.map((c) => c.code_departement),`,
    vers: '    departementsIngeres: [],',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'une ZAER dont l’implantation est inconnue redevient ecartee, comme une toiture',
    fichier: 'apps/api/src/ingestion/wfs-national.ts',
    de: `      return implantationPv(d) === 'hors_foncier' ? [] : ['solaire_sol'];`,
    vers: `      return implantationPv(d) === 'sol' ? ['solaire_sol'] : [];`,
    tests: ['apps/api/test/zaer-implantation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/zaer-implantation.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'une implantation inconnue ouvre l’argument reglementaire comme une zone confirmee au sol',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    de: '          AND implantation_precisee',
    vers: '          AND (implantation_precisee OR true)',
    tests: ['apps/api/test/zaer-implantation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/zaer-implantation.test.ts'],
  },

  {
    audit: 'audit 13',
    quoi: 'une liste vide se lit « rien a prospecter » alors que rien n’a ete ingere',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '    if (!donnees.couverture.donneePresente) {',
    vers: '    if (false) {',
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'la reserve « implantation non precisee » disparait de l’ecran',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '          {!zone.implantationPrecisee && (',
    vers: '          {false && (',
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 13',
    quoi: 'la liste affiche la surface BRUTE la ou la surface utile decide',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '          <strong>{formatNombre(zone.surfaceUtileHa, \'ha\', 1)}</strong> utiles sur{\' \'}',
    vers: '          <strong>{formatNombre(zone.surfaceHa, \'ha\', 1)}</strong> utiles sur{\' \'}',
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },

  // ─── audit 14 : pas de surprise quand on contacte un proprietaire ──────────────────────────
  {
    audit: 'audit 14',
    quoi: 'une parcelle cultivee cesse de poser la question du fermier',
    fichier: 'packages/scoring/src/avant-contact.ts',
    construire: '@enr/scoring',
    de: '  if (exploitee) {',
    vers: '  if (false) {',
    tests: ['packages/scoring/test/avant-contact.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 14',
    quoi: 'la gravite du bail rural cesse de dependre de la filiere : la terre part ou reste, meme alerte',
    fichier: 'packages/scoring/src/avant-contact.ts',
    construire: '@enr/scoring',
    de: "      gravite: agrivoltaisme || FILIERES_COMPATIBLES_AGRICULTURE.has(filiere) ? 'delai' : 'arret',",
    vers: "      gravite: 'arret',",
    tests: ['packages/scoring/test/avant-contact.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 14',
    quoi: 'l’absence de donnee de propriete redevient un silence, donc « un seul proprietaire »',
    fichier: 'packages/scoring/src/avant-contact.ts',
    construire: '@enr/scoring',
    de: '  } else if (nb == null) {',
    vers: '  } else if (false) {',
    tests: ['packages/scoring/test/avant-contact.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 14',
    quoi: 'une parcelle sans acces a la voirie ne signale plus le tiers dans la boucle',
    fichier: 'packages/scoring/src/avant-contact.ts',
    construire: '@enr/scoring',
    de: '  if (distanceVoirie != null && distanceVoirie > 0) {',
    vers: '  if (false) {',
    tests: ['packages/scoring/test/avant-contact.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 14',
    quoi: 'un proprietaire public redevient un proprietaire comme un autre',
    fichier: 'packages/scoring/src/avant-contact.ts',
    construire: '@enr/scoring',
    de: '  if (s.foncier.proprietairePublic === true) {',
    vers: '  if (false) {',
    tests: ['packages/scoring/test/avant-contact.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },

  // ─── audit 15 : le dossier de site remis a un developpeur ──────────────────────────────────
  //
  // Les mutations qui touchent la BASE portent `commande` avec DATABASE_URL herite de
  // l'environnement : sans base, le test s'ignore et la mutation « passe » a tort. Le script
  // le signale deja globalement ; ces entrees ne se jouent utilement qu'avec une base.
  {
    audit: 'audit 15',
    quoi: 'la puissance eolienne redevient une densite MW par hectare',
    fichier: 'packages/scoring/src/puissance.ts',
    construire: '@enr/scoring',
    de: "  if (filiere === 'eolien_terrestre') {\n    return {\n      mwc: null,",
    vers: "  if (filiere === 'eolien_terrestre') {\n    return {\n      mwc: (surfaceUtileHa ?? 0) * 0.1,",
    tests: ['packages/scoring/test/puissance.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 15',
    quoi: 'l’agrivoltaisme reprend la densite pleine : la couverture plafonnee est oubliee',
    fichier: 'packages/scoring/src/puissance.ts',
    construire: '@enr/scoring',
    de: 'const DENSITE_AGRIVOLTAISME_MWC_PAR_HA = 0.5;',
    vers: 'const DENSITE_AGRIVOLTAISME_MWC_PAR_HA = 1.0;',
    tests: ['packages/scoring/test/puissance.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 15',
    quoi: 'une surface utile nulle ou absente produit quand meme un chiffre de MWc',
    fichier: 'packages/scoring/src/puissance.ts',
    construire: '@enr/scoring',
    de: '    if (surfaceUtileHa == null || !Number.isFinite(surfaceUtileHa) || surfaceUtileHa <= 0) {',
    vers: '    if (false) {',
    tests: ['packages/scoring/test/puissance.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 15',
    quoi: 'le dossier de site laisse tomber en silence les parcelles non qualifiees, et sa somme devient fausse',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '    if (manquantes.length > 0) {',
    vers: '    if (false) {',
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'le plafond du dossier passe a celui des exports SIG : vingt mille parcelles dans un PDF',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '  const MAX_PARCELLES_DOSSIER = 100;',
    vers: '  const MAX_PARCELLES_DOSSIER = 20_000;',
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'la contiguite mesuree est remplacee par une supposition d’emprise unique',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '    const nbGroupesContigus = await depotProspection.nbGroupesContigus(\n      retenues.map((l) => l.parcelle.idu),\n    );',
    vers: '    const nbGroupesContigus = 1;',
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'la section raccordement redevient conditionnelle : elle disparait quand aucun poste n’est renseigne',
    fichier: 'apps/api/src/services/exports.ts',
    de: "  titreSection(doc, 'Raccordement électrique', 90);\n  if (avecPoste.length === 0) {",
    vers: "  if (avecPoste.length > 0) titreSection(doc, 'Raccordement électrique', 90);\n  if (avecPoste.length === 0 && false) {",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'un texte francais correct est « repare » comme s’il etait doublement encode',
    fichier: 'apps/api/src/texte.ts',
    de: "  if (relu === s || relu.includes('\ufffd')) return texte;",
    vers: '  if (relu === s) return texte;',
    tests: ['apps/api/test/double-encodage.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/double-encodage.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'les parcelles ECARTEES regonflent la surface et la puissance annoncees en page une',
    fichier: 'apps/api/src/services/exports.ts',
    de: '  const exploitables = parcelles.filter((p) => !p.score.knockOuts.some((k) => !k.derogeable));',
    vers: '  const exploitables = parcelles;',
    tests: ['apps/api/test/dossier-ecartees.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/dossier-ecartees.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'le second chiffre s’affiche TOUJOURS, meme sans parcelle ecartee : on apprend a ne plus le lire',
    fichier: 'apps/api/src/services/exports.ts',
    de: '  const partiel = exploitables.length < parcelles.length;',
    vers: '  const partiel = true;',
    tests: ['apps/api/test/dossier-ecartees.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/dossier-ecartees.test.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'le plafond de l’interface s’ecarte de celui de l’API : le bouton promet ce que la route refuse',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '  const MAX_DOSSIER = 100;',
    vers: '  const MAX_DOSSIER = 250;',
    tests: ['apps/web/test/plafond-dossier.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/plafond-dossier.test.ts'],
  },
  // ─── audit 16 : les postes sources deduits de la BD TOPO ───────────────────────────────────
  {
    audit: 'audit 16',
    // Le CONTACT devient une PROXIMITE de 500 m. C'est la derive plausible — « elargissons un peu,
    // les geometries sont approximatives » — et elle fait entrer les 920 postes sans ligne, c'est-a-dire
    // les transformateurs de distribution. Muter le JOIN en LEFT JOIN, ma premiere idee, ne retablit
    // AUCUN defaut : le `HAVING min(...) <= seuil` ecarte deja les lignes nulles.
    quoi: 'le contact avec une ligne HTB devient une proximite de 500 m : un transformateur de rue devient un poste source',
    fichier: 'apps/api/src/ingestion/postes-geopf.ts',
    de: '         JOIN ing_ligne_geopf l ON ST_Intersects(p.g2154, l.g2154)\n        GROUP BY p.cleabs, p.geom',
    vers: '         JOIN ing_ligne_geopf l ON ST_DWithin(p.g2154, l.g2154, 500)\n        GROUP BY p.cleabs, p.geom',
    tests: ['apps/api/test/postes-geopf.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/postes-geopf.test.ts'],
  },
  {
    audit: 'audit 16',
    quoi: 'le seuil de tension monte au 400 kV : le reseau de transport passe pour un point d’injection',
    fichier: 'apps/api/src/ingestion/postes-geopf.ts',
    de: 'const KV_MAX_POSTE_SOURCE = 150;',
    vers: 'const KV_MAX_POSTE_SOURCE = 400;',
    tests: ['apps/api/test/postes-geopf.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/postes-geopf.test.ts'],
  },
  {
    audit: 'audit 16',
    quoi: 'une capacite d’accueil est inventee pour les postes deduits de la BD TOPO',
    fichier: 'apps/api/src/ingestion/postes-geopf.ts',
    de: '              NULL, NULL, false, $2, current_date',
    vers: '              50, \'disponible\', false, $2, current_date',
    tests: ['apps/api/test/postes-geopf.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/postes-geopf.test.ts'],
  },
  {
    audit: 'audit 16',
    quoi: 'le connecteur d’origine cesse de remonter avec les postes : la fiche citerait Capareseau pour une donnee BD TOPO',
    fichier: 'apps/api/src/connecteurs/locales.ts',
    de: "    connecteurs: [...new Set(lignes.map((l) => l.connecteur).filter((c): c is string => c != null))],",
    vers: '    connecteurs: [],',
    tests: ['apps/api/test/postes-geopf.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/postes-geopf.test.ts'],
  },
  // ─── audit 17 : le potentiel communal, qui colore la carte nationale ───────────────────────
  {
    audit: 'audit 17',
    quoi: 'la disponibilite fonciere est ignoree : Paris redevient un terrain de prospection',
    fichier: 'packages/scoring/src/potentiel-commune.ts',
    construire: '@enr/scoring',
    de: '  const axes = { raccordement, foncier };',
    vers: '  const axes = { raccordement };',
    tests: ['packages/scoring/test/potentiel-commune.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 17',
    quoi: 'le facteur limitant devient une moyenne : un axe nul se compense par un axe excellent',
    fichier: 'packages/scoring/src/potentiel-commune.ts',
    construire: '@enr/scoring',
    de: '  const [nomLimitant, axeLimitant] = notees.reduce((a, b) => (b[1].note < a[1].note ? b : a));\n  const potentiel = Math.round(axeLimitant.note * 10) / 10;',
    vers: '  const [nomLimitant, axeLimitant] = notees.reduce((a, b) => (b[1].note < a[1].note ? b : a));\n  const potentiel =\n    Math.round((notees.reduce((t, e) => t + e[1].note, 0) / notees.length) * 10) / 10;',
    tests: ['packages/scoring/test/potentiel-commune.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 17',
    quoi: 'un axe manquant n’empeche plus de conclure : l’absence de poste source se lit « vert »',
    fichier: 'packages/scoring/src/potentiel-commune.ts',
    construire: '@enr/scoring',
    de: '  if (manquants.length > 0) {',
    vers: '  if (manquants.length > 1) {',
    tests: ['packages/scoring/test/potentiel-commune.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 17',
    quoi: 'le bareme de raccordement cesse de dependre de la filiere : quatre cartes identiques',
    fichier: 'packages/scoring/src/potentiel-commune.ts',
    construire: '@enr/scoring',
    de: 'COURBE_DISTANCE_POSTE[filiere]),',
    vers: "COURBE_DISTANCE_POSTE['solaire_sol']),",
    tests: ['packages/scoring/test/potentiel-commune.test.ts'],
    cwd: 'packages/scoring',
    commande: ['npm', 'test'],
  },
  // ─── audit 18 : le tri des zones, et le repliement du §12 ──────────────────────────────────
  {
    audit: 'audit 18',
    // LA DERIVE LA PLUS NATURELLE : « les plus grandes d'abord », qui parait evidemment juste.
    // Mesure sur un departement reel : 24 zones sur 7 664 couvrent plus de la moitie de leur
    // commune, et elles monopolisaient les quarante lignes du panneau.
    quoi: 'le tri redevient « les plus grandes d’abord » : les designations communales reprennent la tete de liste',
    fichier: 'apps/api/src/services/zones.ts',
    de: '     ORDER BY (COALESCE(r.part_commune, 0) > 0.5), r.surface_m2 DESC, r.id',
    vers: '     ORDER BY r.surface_m2 DESC, r.id',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 18',
    // Le sens du doute s'inverse : une part de commune INCONNUE devient une designation
    // territoriale presumee, et un site parfaitement valide est relegue en fin de liste parce que
    // sa commune manque en base. C'est l'erreur qui coute une occasion sans rien signaler.
    quoi: 'une part de commune inconnue est traitee comme une designation territoriale : le site disparait sur un doute',
    fichier: 'apps/api/src/services/zones.ts',
    de: '     ORDER BY (COALESCE(r.part_commune, 0) > 0.5), r.surface_m2 DESC, r.id',
    vers: '     ORDER BY (COALESCE(r.part_commune, 1) > 0.5), r.surface_m2 DESC, r.id',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 18',
    quoi: 'le seuil de designation territoriale monte a 95 % : une zone couvrant 58 % de sa commune passe pour un site',
    fichier: 'apps/api/src/services/zones.ts',
    de: '        l.part_commune == null ? null : Number(l.part_commune) > 0.5,',
    vers: '        l.part_commune == null ? null : Number(l.part_commune) > 0.95,',
    tests: ['apps/api/test/zones.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/zones.test.ts'],
  },
  {
    audit: 'audit 18',
    quoi: 'la distance au poste source disparait du panneau : on propose une zone sans le chiffre qui decide de son economie',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: "          {zone.distancePosteKm != null && (\n            <>\n              {' \u00b7 '}",
    vers: "          {false && (\n            <>\n              {' \u00b7 '}",
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 18',
    // `formatNombre(null)` rend un tiret ; avec `?? 0` il rend « 0 km ». Une zone sans poste ingere
    // se presenterait donc comme la mieux raccordee de la liste — le faux positif confiant.
    quoi: 'une distance de poste inconnue s’affiche « 0 km » : la zone la moins renseignee parait la mieux raccordee',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: "          {zone.distancePosteKm != null && (\n            <>\n              {' \u00b7 '}\n              <span title=\"Distance \u00e0 vol d\u2019oiseau du poste source le plus proche. La capacit\u00e9 d\u2019accueil, elle, reste inconnue : elle se demande au gestionnaire de r\u00e9seau.\">\n                poste \u00e0 <strong>{formatNombre(zone.distancePosteKm, 'km', 1)}</strong>",
    vers: "          {true && (\n            <>\n              {' \u00b7 '}\n              <span title=\"Distance \u00e0 vol d\u2019oiseau du poste source le plus proche. La capacit\u00e9 d\u2019accueil, elle, reste inconnue : elle se demande au gestionnaire de r\u00e9seau.\">\n                poste \u00e0 <strong>{formatNombre(zone.distancePosteKm ?? 0, 'km', 1)}</strong>",
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 18',
    quoi: 'l’etiquette de designation communale disparait : l’operateur part chercher un proprietaire pour 576 ha qui n’ont jamais ete un site',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '          {zone.designationCommunale === true && (',
    vers: '          {false && (',
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 18',
    // L'etiquette devient permanente : elle ne distingue plus rien, et elle qualifie de
    // « designation territoriale » un site de 40 ha. Une etiquette toujours vraie est un bruit.
    quoi: 'l’etiquette de designation communale s’affiche sur toutes les zones : elle ne distingue plus rien',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '          {zone.designationCommunale === true && (',
    vers: '          {zone.designationCommunale !== undefined && (',
    tests: ['apps/web/test/rendu-zones.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 18',
    // LE DEFAUT QUE LE REPLIEMENT POUVAIT INTRODUIRE, et la forme sous laquelle il serait arrive :
    // un libelle generique dans le `<summary>`, parce qu'il est plus court et plus joli. Il ne reste
    // alors RIEN de la mise en garde a l'ecran — le §12 devient un tiroir qu'on n'ouvre jamais.
    quoi: 'les titres du §12 sont remplaces par un libelle generique : plus rien de la mise en garde n’est lisible sans deplier',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: '                  <strong>{a.titre}</strong>',
    vers: '                  <strong>Avertissements</strong>',
    tests: ['apps/web/test/rendu-bandeau.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-bandeau.test.ts'],
  },
  {
    audit: 'audit 18',
    // LA DERIVE QUI SUIT UN REPLIEMENT : « le texte est long, abregeons-le puisqu'il est deplie ».
    // Le §12 perd alors la moitie de sa phrase, y compris la partie qui engage — « re-verifiee au
    // moment du depot du dossier et a l'echelon departemental » — et personne ne s'en apercoit.
    quoi: 'le texte du §12 est abrege dans le corps deplie : la clause perd la partie qui engage',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: '                <strong>{a.titre}.</strong> {a.texte}{\' \'}',
    vers: '                <strong>{a.titre}.</strong> {a.texte.slice(0, 40)}{\' \'}',
    tests: ['apps/web/test/rendu-bandeau.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-bandeau.test.ts'],
  },
  // ─── audit 18 : le releve des references Legifrance ────────────────────────────────────────
  {
    audit: 'audit 18',
    /*
     * LE DEFAUT REEL, REMIS A L'IDENTIQUE. C'est l'URL que le referentiel portait avant le releve
     * du 7 septembre 2026 pour `commun_site_classe` : elle ouvrait l'article L.415-1 du code de
     * l'environnement — l'habilitation des agents a constater les infractions — sous une regle qui
     * annonce L.341-10. Vingt-cinq des vingt-six URL etaient dans ce cas, et le seul test qui les
     * regardait verifiait leur DOMAINE.
     */
    quoi: 'l’URL du site classe revient a celle qui ouvrait l’habilitation des agents au lieu de l’autorisation spéciale',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: 'url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000033036041`,',
    vers: 'url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000006833752`,',
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 18',
    // Le lien reste juste, c'est la REFERENCE qui derive : la regle annoncerait R.151-23 alors que
    // le lien ouvre R.151-24. C'est le rapprochement lien/reference qui doit l'attraper, et lui
    // seul — aucun autre test du depot ne compare ces deux champs.
    quoi: 'la reference de la zone N derive d’un article : le lien n’ouvre plus ce que la regle annonce',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: '"Code de l\'urbanisme, art. R.151-24 et R.151-25 (zones naturelles et forestières) ; art. L.151-13 "',
    vers: '"Code de l\'urbanisme, art. R.151-23 et R.151-25 (zones naturelles et forestières) ; art. L.151-13 "',
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 18',
    // « On a verifie les references, retirons le marquage » : la derive exacte que le releve rend
    // tentante. Le releve etablit que les textes existent et traitent du sujet, PAS qu'ils sont le
    // bon fondement d'un refus opposable — cela ne se verifie pas, cela se signe.
    quoi: 'le releve Legifrance est pris pour une revue juridique : une regle perd son marquage « a valider »',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: "      'urgence, prolongation d’une autorisation existante.',\n    aValiderParJuriste: true,",
    vers: "      'urgence, prolongation d’une autorisation existante.',",
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 18',
    // Une regle en attente de revue juridique sans lien vers son texte : six l'etaient avant le
    // releve, dont `bess_raccordement_s3renr`, qui justifie a lui seul que le raccordement pese
    // 42 % du score du stockage.
    quoi: 'une regle a valider perd le lien vers son texte : le juriste devrait chercher l’article lui-meme',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: '    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000036436150`,',
    vers: '    // mutation : lien retire',
    tests: ['packages/core/test/referentiel.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  // ─── audit 19 : l'orthographe du francais affiche, et le typage des tests ──────────────────
  {
    audit: 'audit 19',
    /*
     * LE DEFAUT REEL, REMIS A L'IDENTIQUE. « lactoserum » figurait ainsi dans le referentiel, dans
     * la liste des intrants d'origine animale d'une regle de methanisation. Le garde de COHERENCE
     * ne pouvait pas le voir : le mot n'etait ecrit qu'une fois, donc il paraissait coherent. Il a
     * fallu confronter le texte affiche au dictionnaire francais pour le trouver, avec 85 autres.
     */
    quoi: 'un mot du referentiel reperd son accent : « lactoserum » revient dans une regle de methanisation',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: 'matières stercoraires, lactosérum.',
    vers: 'matières stercoraires, lactoserum.',
    tests: ['apps/web/test/orthographe-dictionnaire.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-dictionnaire.test.ts'],
  },
  {
    audit: 'audit 19',
    // Un LIBELLE DE BOUTON, celui qu'on lit apres une erreur d'API. C'est la categorie la plus
    // visible des 161 occurrences corrigees, et celle qu'un relecteur presse laisse passer.
    quoi: 'le bouton de reprise se reecrit « Reessayer », sans accent, sur l’ecran d’erreur',
    fichier: 'apps/web/src/App.tsx',
    de: 'Réessayer',
    vers: 'Reessayer',
    tests: ['apps/web/test/orthographe-dictionnaire.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-dictionnaire.test.ts'],
  },
  {
    audit: 'audit 19',
    /*
     * LA DERIVE QUI A LAISSE LE TROU OUVERT DIX-SEPT AUDITS, et elle ne fait echouer AUCUN autre
     * test : retirer `test/**` de l'`include` rend `npm run typecheck` VERT en cessant de regarder.
     * Six erreurs de typage vivaient ainsi dans les tests, dont trois modules types `any` en
     * silence — l'un decide si un mot de passe de portail est acceptable.
     */
    quoi: 'le perimetre du typage cesse de couvrir les tests : `typecheck` redevient vert en cessant de regarder',
    fichier: 'apps/web/tsconfig.json',
    de: '"include": ["src/**/*", "test/**/*", "e2e/**/*"]',
    vers: '"include": ["src/**/*"]',
    tests: ['apps/web/test/typage-des-tests.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/typage-des-tests.test.ts'],
  },
  {
    audit: 'audit 19',
    // `allowImportingTsExtensions` n'est licite qu'avec `noEmit`. Retirer le second rend la
    // configuration entiere refusee par TypeScript, avec un message qui n'explique pas le lien.
    quoi: '`noEmit` disparait alors que `allowImportingTsExtensions` reste : la configuration devient illicite',
    fichier: 'apps/web/tsconfig.json',
    de: '    "noEmit": true,\n',
    vers: '',
    tests: ['apps/web/test/typage-des-tests.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/typage-des-tests.test.ts'],
  },
  // ─── audit 20 : le second releve Legifrance, et les absences de lien motivees ──────────────
  {
    audit: 'audit 20',
    /*
     * LE DEFAUT REEL, REMIS A L'IDENTIQUE. `metha_injection` citait L.446-1 du code de l'energie
     * pour le « droit a l'injection ». Releve du 9 septembre 2026 : L.446-1 traite du BILAN CARBONE
     * des appels d'offres biogaz. Le droit a l'injection est a L.453-9. La regle n'etait meme pas
     * marquee « a valider » : elle se presentait comme verifiee.
     */
    quoi: 'le droit a l’injection se refonde sur L.446-1, qui traite du bilan carbone des appels d’offres',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: '      "Code de l\'énergie, art. L.453-9 (droit à l\'injection : les gestionnaires de réseaux " +',
    vers: '      "Code de l\'énergie, art. L.446-1 (droit à l\'injection : les gestionnaires de réseaux " +',
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 20',
    // LA DERIVE QUE LE SECOND RELEVE A REFUSE DE COMMETTRE : poser sur une regle de securite
    // incendie du stockage l'arrete des ateliers de charge d'accumulateurs au plomb. Le lien serait
    // sur legifrance.gouv.fr, ouvrirait un vrai texte, et parlerait d'autre chose.
    quoi: 'la regle de securite incendie du stockage recoit l’arrete des ateliers de charge : un lien vrai, sur le mauvais texte',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: "      \"Arrêté ministériel de prescriptions générales applicables à la rubrique 2925 ; référentiels DREAL / SDIS ; guide FFB-ADEME stockage stationnaire\",\n    dateEntreeEnVigueur: '2022-06-30',",
    vers: "      \"Arrêté ministériel de prescriptions générales applicables à la rubrique 2925 ; référentiels DREAL / SDIS ; guide FFB-ADEME stockage stationnaire\",\n    dateEntreeEnVigueur: '2022-06-30',\n    url: `${LEGIFRANCE}/loda/id/JORFTEXT000000584145`,",
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 20',
    // Une regle « non reglementaire » a laquelle on prete l'autorite d'un lien Legifrance. C'est le
    // faux positif de credibilite : le lecteur voit un lien officiel sous une simple recommandation.
    quoi: 'une recommandation technique recoit un lien Legifrance, et parait ainsi reglementaire',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: "    reference: 'Recommandation technique - non réglementaire',\n    dateEntreeEnVigueur: '2024-01-01',",
    vers: "    reference: 'Recommandation technique - non réglementaire',\n    dateEntreeEnVigueur: '2024-01-01',\n    url: `${LEGIFRANCE}/codes/article_lc/LEGIARTI000006838668`,",
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 20',
    // Le lien reste juste, c'est la reference qui derive : la regle annoncerait la rubrique sans
    // nommer l'article R.511-9 que le lien ouvre. C'est le rapprochement lien/reference qui doit
    // l'attraper — celui-la meme qui aurait attrape les cinq liens trompeurs du premier releve.
    quoi: 'une rubrique ICPE cesse de nommer l’article de nomenclature que son lien ouvre',
    fichier: 'packages/core/src/reglementation.ts',
    construire: '@enr/core',
    de: '      "Code de l\'environnement, art. R.511-9 (nomenclature des installations classées), " +\n      \'rubrique 2980\',',
    vers: "      \"Code de l'environnement, nomenclature ICPE rubrique 2980\",",
    tests: ['packages/core/test/references-legifrance.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  /*
   * BOUT EN BOUT : la chaine case a cocher -> bouton -> fichier. Ecartees de l'execution par
   * defaut (navigateur requis) ; leur motif est confronte au code a chaque campagne.
   */
  {
    audit: 'audit 15',
    quoi: 'le bouton du dossier reste actif sans selection : l’envoi part vide et revient en 400',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '            disabled={selection.length === 0 || selection.length > MAX_DOSSIER}',
    vers: '            disabled={selection.length > MAX_DOSSIER}',
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/dossier-site.spec.ts'],
    tests: ['e2e/dossier-site.spec.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'cocher une ligne ouvre la fiche au lieu de la retenir : la selection devient impossible',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '                  <td onClick={(e) => e.stopPropagation()}>',
    vers: '                  <td>',
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/dossier-site.spec.ts'],
    tests: ['e2e/dossier-site.spec.ts'],
  },
  {
    audit: 'audit 15',
    quoi: 'le double encodage n’est plus repare : le libelle de servitude repart casse dans le dossier',
    fichier: 'apps/api/src/texte.ts',
    de: '  if (!/[\u00c3\u00c2]/.test(s)) return texte;',
    vers: '  return texte;\n  // eslint-disable-next-line no-unreachable\n  if (!/[\u00c3\u00c2]/.test(s)) return texte;',
    tests: ['apps/api/test/double-encodage.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/double-encodage.test.ts'],
  },
  {
    audit: 'audit 18',
    /*
     * LE DEFAUT QUE J'AVAIS REELLEMENT ECRIT, remis a l'identique.
     *
     * Ma premiere version du bandeau replie portait `white-space: nowrap; text-overflow: ellipsis`
     * sur les titres, pour garantir une ligne unique. Les titres sont ce qui RESTE visible du §12
     * apres repliement : les couper aux trois points fait disparaitre la protection sans le dire.
     * Le defaut etait invisible aux largeurs ou j'avais mesure — les titres occupent 608 px et
     * tiennent jusqu'a 820 px — et aurait attendu la premiere fenetre etroite. Seul un navigateur
     * peut le voir : `scrollWidth > clientWidth` est le seul signe observable d'une troncature.
     */
    quoi: 'les titres du §12 se tronquent aux trois points sur une fenetre etroite : la protection disparait sans le dire',
    fichier: 'apps/web/src/styles/global.css',
    de: '.titres-avertissements {\n  min-width: 0;\n}',
    vers: '.titres-avertissements {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}',
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/ergonomie.spec.ts'],
    tests: ['e2e/ergonomie.spec.ts'],
  },
  {
    audit: 'audit 18',
    // Le §12 s'ouvre deplie : mesure d'avant, 235 px de chrome a 1280 x 800, soit 29 % de la
    // fenetre avant la moindre parcelle. C'est l'etat que le proprietaire a signale trois fois.
    quoi: 'le §12 s’ouvre deplie : le chrome reprend 235 px, soit 29 % de la fenetre a 1280 x 800',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: '        <details className="bandeau bandeau-repliable bandeau-garde">',
    vers: '        <details className="bandeau bandeau-repliable bandeau-garde" open>',
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/ergonomie.spec.ts'],
    tests: ['e2e/ergonomie.spec.ts'],
  },
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * AUDIT 21 — L'OUTIL DE RECHERCHE PAR CRITERES
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * TOUS LES DEFAUTS VISES ICI SONT MUETS. Aucun ne produit d'erreur, aucun ne change un type :
   * un chemin JSONB faux rend `NULL` et la condition devient fausse, un COALESCE inverse invente
   * une donnee, un filtre neutralise elargit le resultat, une couverture absente laisse
   * « 0 resultat » se lire « rien a prospecter ». Ce sont exactement les fautes qu'une relecture
   * ne voit pas et qu'un test doit donc attraper.
   */
  {
    audit: 'audit 21',
    /*
     * LE SENS DU COALESCE. Une parcelle dont le snapshot ne porte pas l'information ZAER serait
     * PRESUMEE en zone d'acceleration. Le prospecteur partirait defendre devant une commune un
     * argument reglementaire qui n'existe pas. Le sens d'erreur acceptable est de perdre une
     * occasion, jamais d'en inventer une.
     */
    quoi: 'une parcelle sans snapshot est presumee en ZAER : l’outil invente un argument reglementaire',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "      `COALESCE((sn.snapshot -> 'urbanisme' -> 'zaer' ->> 'present')::boolean, false) = true`,",
    vers: "      `COALESCE((sn.snapshot -> 'urbanisme' -> 'zaer' ->> 'present')::boolean, true) = true`,",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    // Le Geoportail de l'urbanisme ne normalise pas `typezone` : une commune publie `AUc`, une
    // autre `AUC`. Comparer les casses brutes ferait manquer la moitie du foncier concerne, sans
    // rien signaler — le filtre resterait annonce a l'ecran.
    quoi: 'le zonage du PLU se compare a la casse : la moitie du foncier disparait en silence',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "          WHERE upper(z ->> 'typeZone') = ANY($?)",
    vers: "          WHERE z ->> 'typeZone' = ANY($?)",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    // Un filtre de territoire neutralise rend PLUS que ce qui est demande : l'operateur croit
    // balayer un departement et lit la base entiere. C'est le sens d'erreur inacceptable pour un
    // outil de tri, et il ne se voit sur aucun ecran.
    quoi: 'la liste de departements ne filtre plus rien : on croit balayer un departement, on lit toute la base',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "  if (f.codesDepartement?.length) ajouter('p.code_departement = ANY($?)', f.codesDepartement);",
    vers: "  if (f.codesDepartement?.length) ajouter('($? IS NOT NULL)', f.codesDepartement);",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * REGION ET DEPARTEMENTS S'ADDITIONNENT AU LIEU DE SE CUMULER. « La region 99, mais seulement
     * le departement 98 » rendrait alors toute la region. Elargir en silence est plus grave que
     * rendre trop peu : l'operateur ne peut pas savoir que sa restriction n'a pas ete appliquee.
     */
    quoi: 'region et departements s’additionnent : une restriction demandee est ignoree, le resultat s’elargit',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '  return codes.filter((c) => explicites.has(c)).sort();',
    vers: '  return [...new Set([...codes, ...explicites])].sort();',
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * LA COUVERTURE SUBIT LES CRITERES DE L'UTILISATEUR. Elle vaudrait alors toujours le nombre de
     * resultats : « 1 parcelle retenue sur 1 qualifiee » se lit comme un territoire entierement
     * exploite, et le bandeau cesse d'informer tout en restant affiche. Une garde qui parle encore
     * mais ne dit plus rien est pire qu'une garde absente.
     */
    quoi: 'la couverture est mesuree APRES les criteres : le denominateur egale le resultat, le bandeau ne dit plus rien',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "  const departements = await departementsDuTerritoire(f);\n  const restreint = departements.length > 0;",
    vers: "  const departements = await departementsDuTerritoire(f);\n  const restreint = false;",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    // `communesDuTerritoire` a 0 au lieu de `null` : le bandeau afficherait « 0 commune sur 0 »,
    // soit une couverture nulle sur une recherche parfaitement valide portant sur toute la base.
    quoi: 'une recherche sans territoire annonce une couverture de 0 commune sur 0',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '    communesDuTerritoire: restreint ? (communes[0]?.n ?? 0) : null,',
    vers: '    communesDuTerritoire: communes[0]?.n ?? 0,',
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    // Le selecteur annonce 0 parcelle qualifiee sans qu'aucune filiere n'ait ete precisee : une
    // absence CONSTATEE la ou rien n'a ete mesure. C'est le defaut de famille de tous les audits
    // precedents, applique au selecteur de territoire.
    quoi: 'le selecteur de territoires annonce 0 parcelle sans filiere : une absence constatee sans mesure',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '    parcellesQualifiees: filiere ? (parcParDep.get(d.code) ?? 0) : null,',
    vers: '    parcellesQualifiees: parcParDep.get(d.code) ?? 0,',
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * LE CHAMP DISPARAIT DE LA VALIDATION. Ajouter un filtre a `FiltresParcelles` sans l'ajouter a
     * `filtresValides` ne provoque aucune erreur de typage : le champ est simplement absent de
     * l'objet rendu. Deux consequences, toutes deux muettes — le filtre est ignore, et
     * `refuserInconnus()` refuse le corps en 400, donc le formulaire cesse de fonctionner.
     */
    quoi: 'un critere de balayage n’est plus valide : il est ignore, et le corps entier devient refuse',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "    enZaerSeulement: l.booleen('enZaerSeulement'),",
    vers: "    enZaerSeulement: undefined,",
    tests: ['apps/api/test/validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/validation.test.ts'],
  },
  {
    audit: 'audit 21',
    // Sans normalisation en majuscules, un `a` saisi ne trouverait jamais une zone `A` : le SQL
    // compare `upper()` d'un cote, la valeur brute de l'autre.
    quoi: 'les codes de territoire et de zonage ne sont plus mis en majuscules : la comparaison SQL devient bancale',
    fichier: 'apps/api/src/validation.ts',
    de: '      vus.add(e.trim().toUpperCase());\n    }\n    return [...vus].sort();',
    vers: '      vus.add(e.trim());\n    }\n    return [...vus].sort();',
    tests: ['apps/api/test/validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/validation.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * LA RECIPROQUE RENVOIE TOUT. « Cherche-moi de l'agrivoltaisme » retiendrait alors toutes les
     * natures de sol : le critere serait annonce sur une pastille enfoncee et ne filtrerait rien.
     * Un critere qui ne s'applique pas est plus trompeur qu'un critere absent.
     */
    quoi: 'la typologie d’implantation ne filtre plus rien : la pastille est enfoncee, le critere ne s’applique pas',
    fichier: 'packages/core/src/types.ts',
    construire: '@enr/core',
    de: '  return (Object.keys(REGIME_PAR_TYPE_SOL) as TypeSol[]).filter(\n    (t) => REGIME_PAR_TYPE_SOL[t] === regime,\n  );',
    vers: '  return Object.keys(REGIME_PAR_TYPE_SOL) as TypeSol[];',
    tests: ['packages/core/test/regimes-implantation.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 21',
    // Un departement rattache a une region absente disparaitrait de tous les selecteurs, sans le
    // moindre message : l'operateur croirait la region balayee alors qu'un de ses departements
    // n'aurait jamais ete propose.
    quoi: 'un departement pointe une region qui n’existe pas : il disparait de tous les selecteurs',
    fichier: 'packages/core/src/territoires.ts',
    construire: '@enr/core',
    de: "  { code: '28', nom: 'Eure-et-Loir', codeRegion: '24' },",
    vers: "  { code: '28', nom: 'Eure-et-Loir', codeRegion: '99' },",
    tests: ['packages/core/test/territoires.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 21',
    /*
     * LE BANDEAU DE COUVERTURE DISPARAIT. C'est le defaut d'origine restaure : la vue rendrait a
     * nouveau « 0 resultat » et « Aucune parcelle ne correspond aux filtres » sur un departement
     * jamais qualifie — deux phrases exactes, et la conclusion la plus couteuse qu'un outil de
     * prospection puisse faire tirer.
     */
    quoi: 'le bandeau de couverture ne s’affiche plus : « 0 resultat » redevient indistinguable de « jamais balaye »',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '  if (!couverture || !Array.isArray(couverture.departementsDemandes)) return null;',
    vers: '  if (true) return null;\n  // eslint-disable-next-line no-unreachable\n  if (!couverture || !Array.isArray(couverture.departementsDemandes)) return null;',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },
  {
    audit: 'audit 21',
    // La reserve « territoire partiellement qualifie » ne s'affiche plus jamais : le resultat
    // passerait pour un inventaire alors qu'il n'est qu'un plancher.
    quoi: 'la reserve « partiellement qualifie » disparait : un echantillon se lit comme un inventaire',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '      {partCommunes != null && partCommunes < 90 && (',
    vers: '      {partCommunes != null && partCommunes < 0 && (',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * LE SEUIL DE SURFACE PASSE POUR UN SEUIL DE PROJET. Un projet de 20 ha s'assemble couramment
     * avec huit parcelles de 2,5 ha : un operateur qui saisit « 20 ha » en croyant decrire son
     * projet ferait disparaitre tout le foncier reellement mobilisable, et concluerait que le
     * territoire n'a rien a offrir. La note est la seule chose qui l'en empeche.
     */
    quoi: 'le seuil de surface ne dit plus qu’il porte sur la parcelle et non sur le projet',
    fichier: 'apps/web/src/components/FormulaireBalayage.tsx',
    de: '            Seuil appliqué à chaque parcelle cadastrale, pas au projet',
    vers: '            Seuil appliqué au projet',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },
  {
    audit: 'audit 21',
    // « jamais balaye » remplace par un 0 : l'operateur lirait une absence CONSTATEE de foncier
    // propice la ou aucune parcelle n'a jamais ete evaluee.
    quoi: 'un departement jamais balaye affiche « 0 » : une absence de mesure se lit comme une absence de foncier',
    fichier: 'apps/web/src/components/FormulaireBalayage.tsx',
    de: "        {n == null ? '' : n === 0 ? 'jamais balayé' : formatNombre(n, '', 0)}",
    vers: "        {n == null ? '' : formatNombre(n, '', 0)}",
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },

  /*
   * BOUT EN BOUT POUR L'OUTIL DE RECHERCHE. Ces deux defauts ne sont visibles QUE dans un
   * navigateur : le premier est une contradiction d'etat entre deux commandes, le second une
   * rupture entre le client et une route. Ni le typage ni un test de rendu ne peuvent les voir.
   * Ecartees de l'execution par defaut ; leur motif est confronte au code a chaque campagne.
   */
  {
    audit: 'audit 21',
    /*
     * DEUX DEMANDES CONTRADICTOIRES, ET C'EST LA MAUVAISE QUI GAGNE. « Balaie le departement 28 »
     * et « limite a la zone affichee » ne peuvent pas etre vraies ensemble ; en SQL la seconde
     * gagne, et le balayage ne porte alors que sur l'ecran. Rien ne le signale : le bandeau annonce
     * le departement, le tableau montre trois parcelles, et l'operateur conclut que le departement
     * n'a que trois parcelles propices.
     */
    quoi: 'choisir un territoire ne leve plus la restriction a l’emprise : le balayage ne porte que sur l’ecran',
    fichier: 'apps/web/src/components/FormulaireBalayage.tsx',
    de: '    if (etat.limiterALEmprise) etat.basculerLimiteEmprise();',
    vers: '    // mutation : la borne reste posee',
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/recherche-criteres.spec.ts'],
    tests: ['e2e/recherche-criteres.spec.ts'],
  },
  {
    audit: 'audit 21',
    // Une rupture entre le client et la route : le selecteur de territoires resterait vide, et
    // l'operateur ne pourrait plus balayer aucun departement. Aucun typage ne relie une chaine
    // d'URL a une route Fastify — seul un navigateur contre un vrai serveur le voit.
    quoi: 'le client interroge une route de territoires qui n’existe pas : le selecteur reste vide, sans message',
    fichier: 'apps/web/src/api/client.ts',
    de: "      `/api/territoires${filiere ? `?filiere=${filiere}` : ''}`,",
    vers: "      `/api/territoire${filiere ? `?filiere=${filiere}` : ''}`,",
    cwd: 'apps/web',
    e2e: true,
    commande: ['playwright', 'test', 'e2e/recherche-criteres.spec.ts'],
    tests: ['e2e/recherche-criteres.spec.ts'],
  },

  {
    audit: 'audit 21',
    /*
     * LE PERIMETRE DE MESURE PREND DU RETARD, ET LE CONTROLE CONTINUE DE PASSER. `MODULES_TEXTE`
     * est une liste ecrite a la main : un composant ajoute apres elle sort du garde d'orthographe
     * sans qu'aucun test ne baisse. Deux fichiers y avaient reellement echappe — `PanneauZones.tsx`
     * et `FormulaireBalayage.tsx` — et rien ne l'avait signale. C'est la pire forme de regression
     * pour une garde : elle se presente comme un succes.
     */
    quoi: 'un composant de l’interface sort du perimetre du garde d’orthographe, sans qu’aucun test ne baisse',
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: "  'apps/web/src/components/FormulaireBalayage.tsx',\n",
    vers: '',
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 21',
    /*
     * LE GARDE DES SELECTEURS LIT-IL ENCORE L'OPTION `name` ? La question n'est pas rhetorique :
     * je viens d'ecarter le PREMIER argument de `getByRole` de la mesure, parce que c'est un role
     * ARIA et non du texte (`getByRole('region', ...)` faisait accuser « region » d'etre une
     * graphie perimee de « région »). Ecarter un argument de trop aurait aveugle le garde sans
     * qu'aucun test ne le dise. Cette mutation de-accentue un selecteur reel : si elle survit,
     * l'exclusion est allee trop loin.
     */
    quoi: 'un selecteur de bout en bout perd ses accents : le garde doit le voir malgre l’exclusion des roles ARIA',
    fichier: 'apps/web/e2e/recherche-criteres.spec.ts',
    de: "  await expect(page.getByRole('region', { name: 'Recherche de foncier par critères' })).toBeVisible();\n  const borne",
    vers: "  await expect(page.getByRole('region', { name: 'Recherche de foncier par criteres' })).toBeVisible();\n  const borne",
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * AUDIT 22 — LE TYPE D'AGRICULTURE, ET LE DOSSIER QUI LE DIT
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   */
  {
    audit: 'audit 22',
    /*
     * LE FILTRE LIT LE LIBELLE AU LIEU DU CODE. Le libelle est fige dans l'instantane a la date de
     * qualification, avec la nomenclature et les accents de l'epoque — six de ces libelles ont
     * circule sans accent. Le resultat dependrait donc de la DATE a laquelle chaque parcelle a ete
     * qualifiee, ce qui est indefendable pour un outil de tri.
     */
    quoi: 'le type d’agriculture se cherche par libelle : le resultat depend de la date de qualification',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "      `(sn.snapshot -> 'occupationSol' -> 'rpg' ->> 'codeGroupeCulture') = ANY($?)`,",
    vers: "      `(sn.snapshot -> 'occupationSol' -> 'rpg' ->> 'libelleGroupeCulture') = ANY($?)`,",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 22',
    /*
     * UNE PARCELLE SANS DECLARATION PAC EST PRESUMEE AGRICOLE. Demander « de l'elevage » et
     * recevoir une friche non declaree ferait deplacer un developpeur pour rien. L'absence de
     * declaration se cherche par la NATURE DU SOL, qui est la question differente qu'elle pose.
     */
    quoi: 'une parcelle sans declaration PAC est retenue par un critere d’agriculture',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "  if (f.groupesCulture?.length) {",
    vers: "  if (f.groupesCulture?.length && false) {",
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 22',
    // Le champ disparait de la validation : le critere est ignore en silence, et `refuserInconnus`
    // refuse le corps entier en 400 — le formulaire cesse de fonctionner.
    quoi: 'le critere d’agriculture n’est plus valide : il est ignore, et le corps entier devient refuse',
    fichier: 'apps/api/src/services/recherche.ts',
    de: "    groupesCulture: l.listeCodes('groupesCulture', {",
    vers: "    groupesCulture: undefined && l.listeCodes('groupesCulture', {",
    tests: ['apps/api/test/validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/validation.test.ts'],
  },
  {
    audit: 'audit 22',
    /*
     * UNE FAMILLE PERD UN GROUPE. « Elevage » cesse de couvrir les prairies permanentes : le
     * foncier existe en base et devient introuvable par le formulaire, sans erreur ni message.
     * C'est le defaut muet type de ce depot, applique au vocabulaire metier.
     */
    quoi: 'la famille « elevage » perd les prairies permanentes : le foncier existe et devient introuvable',
    fichier: 'packages/core/src/cultures.ts',
    construire: '@enr/core',
    de: "    groupes: ['16', '17', '18', '19'],",
    vers: "    groupes: ['16', '17', '19'],",
    tests: ['packages/core/test/cultures.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 22',
    // Un groupe inconnu tombe dans « Divers » au lieu de se signaler : un groupe ajoute demain au
    // RPG et oublie dans les familles se fondrait dans un fourre-tout, et personne ne le saurait.
    quoi: 'un groupe de culture inconnu se fond dans « Divers » au lieu de se signaler',
    fichier: 'packages/core/src/cultures.ts',
    construire: '@enr/core',
    de: "  return FAMILLES_CULTURE.find((f) => f.groupes.includes(code)) ?? null;",
    vers: "  return FAMILLES_CULTURE.find((f) => f.groupes.includes(code)) ?? FAMILLES_CULTURE[5]!;",
    tests: ['packages/core/test/cultures.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 22',
    /*
     * L'ACCENT REPERDU. Ces libelles sont affiches — fiche, dossier PDF, formulaire de recherche —
     * et ils ont circule six ans sans accent parce que `connecteurs/rpg.ts` n'etait pas dans le
     * perimetre du garde d'orthographe. Cette mutation verifie qu'ils y sont bien desormais.
     */
    quoi: 'un libelle de groupe de culture reperd son accent dans du texte affiche',
    fichier: 'packages/core/src/cultures.ts',
    construire: '@enr/core',
    de: "  '2': 'Maïs grain et ensilage',",
    vers: "  '2': 'Mais grain et ensilage',",
    tests: ['packages/core/test/cultures.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 22',
    /*
     * LA SECTION AGRICULTURE DISPARAIT DU DOSSIER. C'est l'etat d'avant ce chantier restaure : le
     * dossier remis au developpeur portait l'acces, le raccordement, l'urbanisme, l'eau, les
     * milieux et la topographie, et RIEN sur ce qui est cultive — la premiere question d'un projet
     * agrivoltaique.
     */
    quoi: 'le dossier developpeur ne dit plus quelle agriculture est declaree sur les parcelles',
    fichier: 'apps/api/src/services/exports.ts',
    de: "  titreSection(doc, 'Occupation du sol et agriculture', 90);",
    vers: "  titreSection(doc, 'Occupation du sol', 90);",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 22',
    // Le dossier confond « aucune declaration PAC » — un constat, et meme un argument favorable en
    // solaire au sol — avec « donnee indisponible », qui est un aveu d'ignorance. Les ecrire l'un
    // pour l'autre transforme une ignorance en affirmation.
    quoi: 'le dossier confond « aucune declaration PAC » et « donnee indisponible »',
    fichier: 'apps/api/src/services/exports.ts',
    de: "            (annees == null ? 'donnée indisponible (RPG non consulté)' : 'aucune déclaration PAC'),",
    vers: "            'aucune déclaration PAC',",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 22',
    // Le formulaire propose les 27 groupes bruts du RPG : la traduction metier retombe sur
    // l'operateur, a chaque recherche, de memoire.
    quoi: 'le formulaire cesse de proposer les familles d’usage et le type d’agriculture disparait',
    fichier: 'apps/web/src/components/FormulaireBalayage.tsx',
    de: '          <h3>Type d&apos;agriculture</h3>',
    vers: '          <h3>Agriculture</h3>',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },
  {
    audit: 'audit 22',
    /*
     * LA LISTE DES HOMOGRAPHES DESARME LE GARDE. Chaque entree desactive le controle sur ce mot
     * dans TOUS les modules : c'est la derogation la plus large du fichier. Une entree perimee —
     * dont la graphie accentuee n'existe plus — masquerait une vraie faute apparue depuis.
     */
    quoi: 'un homographe perime reste declare et desarme le garde sur un mot qui n’existe plus',
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: "    nu: 'mais',\n    accentue: 'maïs',",
    vers: "    nu: 'cote',\n    accentue: 'côte',",
    tests: ['apps/web/test/orthographe-affichee.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/orthographe-affichee.test.ts'],
  },

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * AUDIT 23 — LES SEUILS, ET LE CAHIER DES CHARGES WORD
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   */
  {
    audit: 'audit 23',
    /*
     * LE CHEMIN JSONB DEVIE D'UNE LETTRE. `#>>` sur une cle absente rend `NULL`, la condition
     * devient fausse, et la recherche ne retient RIEN — sans erreur, sans message. Le critere
     * serait annonce dans le formulaire ET dans le cahier des charges remis au developpeur, et
     * n'aurait jamais retenu une seule parcelle.
     */
    quoi: 'le critere roi du solaire pointe une grandeur qui n’existe pas : la recherche ne retient plus rien',
    fichier: 'packages/core/src/seuils-recherche.ts',
    construire: '@enr/core',
    de: "      chemin: 'gisement.irradiationKwhM2An',",
    vers: "      chemin: 'gisement.iradiationKwhM2An',",
    tests: ['packages/core/test/seuils-recherche.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 23',
    /*
     * LE SENS DU SEUIL S'INVERSE. Le formulaire afficherait « Distance a l'habitation AU PLUS
     * 500 m » et retiendrait exactement le foncier que l'article L.515-44 interdit. C'est le
     * defaut le plus couteux de cette table, et le plus difficile a voir en relecture.
     */
    quoi: 'le recul eolien s’inverse : l’outil retient le foncier que la loi interdit',
    fichier: 'packages/core/src/seuils-recherche.ts',
    construire: '@enr/core',
    de: "      libelle: \"Distance à l'habitation minimale\",\n      sens: 'min',\n      unite: 'm',\n      usuel: 500,",
    vers: "      libelle: \"Distance à l'habitation minimale\",\n      sens: 'max',\n      unite: 'm',\n      usuel: 500,",
    tests: ['packages/core/test/seuils-recherche.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 23',
    // Une unite fausse fait saisir une valeur mille fois trop grande, et le cahier des charges
    // l'imprime telle quelle chez le developpeur.
    quoi: 'un seuil annonce une unite qui n’est pas celle de sa grandeur',
    fichier: 'packages/core/src/seuils-recherche.ts',
    construire: '@enr/core',
    de: "      libelle: 'Distance à la voirie maximale',\n      sens: 'max',\n      unite: 'm',\n      usuel: 500,",
    vers: "      libelle: 'Distance à la voirie maximale',\n      sens: 'max',\n      unite: 'km',\n      usuel: 500,",
    tests: ['packages/core/test/seuils-recherche.test.ts'],
    cwd: 'packages/core',
    commande: ['npm', 'test'],
  },
  {
    audit: 'audit 23',
    /*
     * UNE GRANDEUR INCONNUE PASSE LA VALIDATION. Sans la liste blanche, un chemin libre part dans
     * `#>>` et la recherche annonce un critere qu'elle n'applique jamais.
     */
    quoi: 'la liste blanche des grandeurs saute : un chemin invente atteint le SQL',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '    const borne = BORNES_SNAPSHOT.find((b) => b.chemin === chemin);\n    if (!borne) {',
    vers: '    const borne = BORNES_SNAPSHOT.find((b) => b.chemin === chemin) ?? BORNES_SNAPSHOT[0]!;\n    if (false) {',
    tests: ['apps/api/test/validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/validation.test.ts'],
  },
  {
    audit: 'audit 23',
    // Les bornes physiques ne sont plus verifiees : un vent moyen de 40 m/s devient une recherche
    // legitime, et l'operateur n'a aucun moyen de savoir qu'il s'est trompe d'unite.
    quoi: 'les bornes physiques ne sont plus verifiees : une valeur absurde devient une recherche',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '      if (v < borne.min || v > borne.max) {',
    vers: '      if (false) {',
    tests: ['apps/api/test/validation.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/validation.test.ts'],
  },
  {
    audit: 'audit 23',
    /*
     * UNE PARCELLE NON MESUREE EST PRESUMEE CONFORME. Un seuil qu'on ne peut pas verifier serait
     * repute satisfait : l'outil remonterait du foncier dont on ignore tout, presente comme
     * repondant au critere. C'est l'inverse exact du principe de tout ce depot.
     */
    quoi: 'une parcelle dont la grandeur n’est pas mesuree est presumee satisfaire le seuil',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '        `(sn.snapshot #>> $${params.length - 1}::text[])::numeric >= $${params.length}`,',
    vers: '        `COALESCE((sn.snapshot #>> $${params.length - 1}::text[])::numeric, 1e9) >= $${params.length}`,',
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 23',
    /*
     * LE DIAGNOSTIC PAR SEUIL DISPARAIT. C'est « 0 resultat ment » restaure sous sa forme
     * nouvelle : un seuil sur une grandeur jamais renseignee vide la liste, et rien ne distingue
     * plus cette cause de « aucune parcelle ne convient ».
     */
    quoi: 'le diagnostic par seuil disparait : une grandeur jamais mesuree redevient indistinguable d’un resultat vide',
    fichier: 'apps/api/src/services/recherche.ts',
    de: '  const seuils = f.seuils ?? [];\n  if (seuils.length === 0) return [];',
    vers: '  const seuils = f.seuils ?? [];\n  if (true) return [];',
    tests: ['apps/api/test/recherche-territoire.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/recherche-territoire.test.ts'],
  },
  {
    audit: 'audit 23',
    // Le meme diagnostic, mais cote ecran : le bandeau cesse de nommer la grandeur non mesuree.
    quoi: 'l’ecran n’avertit plus qu’un seuil porte sur une grandeur jamais mesuree',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '  if (jamaisMesures.length > 0) {',
    vers: '  if (false) {',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },
  {
    audit: 'audit 23',
    /*
     * L'ESPERLUETTE N'EST PLUS ECHAPPEE. Un seul `&` nu rend le .docx illisible par Word — « le
     * contenu pose probleme », sans dire lequel. Les libelles viennent de sources externes qui en
     * charrient (« Eau & milieux »), et aucun typage ne protege de cela.
     */
    quoi: 'l’esperluette n’est plus echappee : Word refuse d’ouvrir le cahier des charges',
    fichier: 'apps/api/src/services/docx.ts',
    de: "    .replace(/&/g, '&amp;')",
    vers: '    .replace(/&/g, String.fromCharCode(38))',
    tests: ['apps/api/test/cahier-des-charges.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/cahier-des-charges.test.ts'],
  },
  {
    audit: 'audit 23',
    // `w:tblGrid` est exige par la specification Office Open XML : sans lui, Word signale un
    // contenu illisible et n'ouvre pas le document.
    quoi: 'la grille des tableaux disparait du .docx : le document ne s’ouvre plus',
    fichier: 'apps/api/src/services/docx.ts',
    de: '`<w:tblGrid>${grille}</w:tblGrid>${enTete}${corps}</w:tbl>`',
    vers: '`${enTete}${corps}</w:tbl>`',
    tests: ['apps/api/test/cahier-des-charges.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/cahier-des-charges.test.ts'],
  },
  {
    audit: 'audit 23',
    /*
     * LA COLONNE DES IDENTIFIANTS TECHNIQUES DISPARAIT. C'est ce qui rend le document exploitable
     * au retour : sans elle, chaque ligne doit etre RETRADUITE de memoire vers le formulaire, et
     * c'est exactement la qu'un critere se perd.
     */
    quoi: 'le cahier des charges perd la colonne qui nomme chaque grandeur dans le logiciel',
    fichier: 'apps/api/src/services/cahier-des-charges.ts',
    de: "      entetes: ['Critère', 'Sens', 'Unité', 'Usuel', 'Valeur demandée', 'Grandeur dans le logiciel'],",
    vers: "      entetes: ['Critère', 'Sens', 'Unité', 'Usuel', 'Valeur demandée', 'Code'],",
    tests: ['apps/api/test/cahier-des-charges.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/cahier-des-charges.test.ts'],
  },
  {
    audit: 'audit 23',
    /*
     * LE DOCUMENT CESSE DE DIRE QUE DES REGLES ATTENDENT UN JURISTE. Il partirait chez un tiers
     * avec l'apparence d'un cadre reglementaire valide — l'exact contraire de ce que le referentiel
     * de ce depot affirme depuis quatre audits.
     */
    quoi: 'le cahier des charges ne signale plus les regles non validees par un juriste',
    fichier: 'apps/api/src/services/cahier-des-charges.ts',
    de: "      texte: `${aValider.length} de ces ${toutes.length} règles n'ont pas encore été validées par un juriste. Elles sont signalées « à valider » ci-dessous et ne doivent pas être opposées telles quelles.`,",
    vers: "      texte: `Le référentiel compte ${toutes.length} règles applicables à cette filière.`,",
    tests: ['apps/api/test/cahier-des-charges.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/cahier-des-charges.test.ts'],
  },
  {
    audit: 'audit 23',
    // Le document cesse d'avouer qu'il ne se reimporte pas : l'operateur attendrait une reprise
    // automatique qui n'existe pas, et croirait ses criteres appliques.
    quoi: 'le cahier des charges n’avoue plus qu’il ne se reimporte pas automatiquement',
    fichier: 'apps/api/src/services/cahier-des-charges.ts',
    de: '        "Ce cahier des charges ne se réimporte pas automatiquement',
    vers: '        "Ce cahier des charges se reprend automatiquement',
    tests: ['apps/api/test/cahier-des-charges.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/cahier-des-charges.test.ts'],
  },
  {
    audit: 'audit 23',
    // Le formulaire cesse de dire que la valeur grise n'est qu'un ordre de grandeur : l'operateur
    // croirait le seuil applique, et conclurait a tort sur le contenu du territoire.
    quoi: 'la valeur usuelle grisee passe pour un filtre actif',
    fichier: 'apps/web/src/components/FormulaireBalayage.tsx',
    de: '            Les valeurs en gris sont des <strong>ordres de grandeur usuels</strong>, pas des',
    vers: '            Valeurs indicatives, pas des',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 24 — seuil reglementaire contre seuil developpeur
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 24',
    /*
     * LE MODE 1 CESSE D'ETRE REGLEMENTAIRE. C'est l'inversion du §2.3, et elle est parfaitement
     * muette : aucune erreur, aucun journal. La fiche d'une parcelle se mettrait a repondre selon
     * le profil du dernier developpeur ouvert, et l'operateur ecarterait du foncier constructible
     * en croyant lire le droit.
     */
    quoi: 'la carte evalue au seuil developpeur au lieu du seuil reglementaire',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: "  if (mode === 'reglementaire') return base;",
    vers: "  if (mode === 'reglementaire' && seuilsDeveloppeur.size === 0) return base;",
    tests: ['packages/core/test/seuils-developpeur.test.ts'],
    cwd: 'packages/core',
    commande: ['tsx', '--test', 'test/seuils-developpeur.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * LA REFERENCE REDEVIENT LE DECLENCHEUR DE LA REGLE au lieu de l'exigence du classeur. Les
     * deux sont des `ConditionSeuil` valides et decrivent la meme limite en s'opposant terme a
     * terme : « ≥ 500 m » contre « < 500 m ». Le controle de durcissement part alors a l'envers,
     * et accepte 300 m sur un recul legal de 500 m.
     */
    quoi: 'la condition de reference redevient le declencheur de la regle, pas l’exigence',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: '  const premier = contrainte.seuilsNumeriques[0];\n  return premier',
    vers: '  const premier = contrainte.regles.find((r) => r.condition)?.condition ?? contrainte.seuilsNumeriques[0];\n  return premier',
    tests: ['packages/core/test/seuils-developpeur.test.ts'],
    cwd: 'packages/core',
    commande: ['tsx', '--test', 'test/seuils-developpeur.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * UN SEUIL PARTIELLEMENT LU TRANCHE A NOUVEAU. « 100 m (Déclaration) / 200 m
     * (Enregistrement-Autorisation) » reprendrait sa valeur de « = 100 m » ferme, alors que le
     * seuil applicable depend du regime ICPE. Faux dans les deux sens, et sans un mot.
     */
    quoi: 'une extraction incomplete ne met plus la contrainte en verification manuelle',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: "  if (!contrainte.extractionComplete) raisons.push('extraction_incomplete');",
    vers: '  // mutation',
    tests: ['packages/core/test/seuils-developpeur.test.ts'],
    cwd: 'packages/core',
    commande: ['tsx', '--test', 'test/seuils-developpeur.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * LE SENS EST DEVINE au lieu d'etre demande. Mesure sur le classeur : les cas ou il n'est pas
     * etabli vont dans les deux sens — « 500 m des monuments » veut dire au moins, « 0,5 ha de
     * defrichement » veut dire au plus. Un defaut se tromperait environ une fois sur deux.
     */
    quoi: 'le sens d’un seuil ambigu est devine « au moins » au lieu d’etre demande',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: "  return conditionReglementaire(contrainte)?.operateur === 'egal';",
    vers: '  return false;',
    tests: ['packages/core/test/seuils-developpeur.test.ts'],
    cwd: 'packages/core',
    commande: ['tsx', '--test', 'test/seuils-developpeur.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * L'EMPREINTE DU CLASSEUR CESSE DE COUVRIR LES SEUILS. Une revision du classeur qui ne
     * toucherait que la colonne « Seuil » passerait alors pour identique, et le referentiel
     * garderait son ancien millesime : un controle affirme sans avoir eu lieu.
     */
    quoi: 'l’empreinte du classeur ne couvre plus la colonne des seuils',
    fichier: 'scripts/referentiel-contraintes.mjs',
    de: "      [filiere, categorie, nom, description, seuil, caractere, reference, couche, type].join('\\u001f'),",
    vers: "      [filiere, categorie, nom, description, caractere, reference, couche, type].join('\\u001f'),",
    /*
     * Le controle est le generateur lui-meme en mode `--verifier` : il recalcule l'empreinte et
     * sort en code 1 si elle ne correspond plus a celle du module. Un test unitaire ne pourrait
     * pas l'attraper — il lit le module COMMITTE, que muter le generateur ne change pas.
     */
    tests: ['scripts/referentiel-contraintes.mjs --verifier'],
    cwd: '.',
    commande: ['node', 'scripts/referentiel-contraintes.mjs', '--verifier'],
  },
  {
    audit: 'audit 24',
    /*
     * UN SEUIL PLUS PERMISSIF QUE LA REGLEMENTATION PASSE. La recherche remonterait du foncier que
     * le droit interdit, dans un dossier remis a un tiers. Le cahier des charges declare le seuil
     * reglementaire immuable — sans ce refus, il devient modifiable par la fenetre.
     */
    quoi: 'un seuil developpeur peut assouplir la reglementation',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: '      return valeurDeveloppeur < reglementaire.valeur;',
    vers: '      return false;',
    tests: ['packages/core/test/seuils-developpeur.test.ts'],
    cwd: 'packages/core',
    commande: ['tsx', '--test', 'test/seuils-developpeur.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * LE REMPLACEMENT D'UN PROFIL DEVIENT UNE FUSION. Le seuil que l'operateur vient de retirer de
     * l'ecran reste en base : il le croit supprime, et la recherche continue de l'appliquer.
     */
    quoi: 'remplacer un profil conserve les seuils retires de l’ecran',
    fichier: 'apps/api/src/depots/profils.ts',
    de: '      await client.query(`DELETE FROM seuil_developpeur WHERE profil_id = $1`, [id]);',
    vers: '      // mutation',
    tests: ['apps/api/test/profils-seuils.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/profils-seuils.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * L'UNITE REDEVIENT CELLE DU CLIENT. « 400 » en km la ou la contrainte se mesure en metres :
     * un facteur mille accepte sans bruit, qui vide ou remplit la recherche selon le sens.
     */
    quoi: 'l’unite d’un seuil n’est plus recopiee du referentiel',
    fichier: 'apps/api/src/routes/profils.ts',
    de: "  return conditionDeReference(contrainte)?.unite ?? '';",
    vers: "  return '';",
    tests: ['apps/api/test/profils-seuils.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/profils-seuils.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * UNE CONTRAINTE D'UNE AUTRE FILIERE EST ACCEPTEE. Le formulaire parait coherent, l'identifiant
     * existe — et le seuil est enregistre pour ne jamais servir, pendant que le developpeur croit
     * son exigence prise en compte.
     */
    quoi: 'un seuil peut porter sur une contrainte d’une autre filiere',
    fichier: 'apps/api/src/routes/profils.ts',
    de: '    if (contrainte.filiere !== filiere) {',
    vers: '    if (false) {',
    tests: ['apps/api/test/profils-seuils.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/profils-seuils.test.ts'],
  },
  {
    audit: 'audit 24',
    /*
     * LE PANNEAU CESSE DE DIRE QUE LA CARTE RESTE REGLEMENTAIRE. C'est la phrase qui empeche
     * l'operateur de croire la fiche parcelle influencee par le profil ouvert — soit exactement le
     * contresens que le §2.3 existe pour eviter.
     */
    quoi: 'le panneau des profils ne dit plus que la fiche reste evaluee au seuil reglementaire',
    fichier: 'apps/web/src/components/PanneauProfils.tsx',
    de: '            fiche d’une parcelle reste évaluée au seuil réglementaire.',
    vers: '            recherche tient compte de vos exigences.',
    tests: ['apps/web/test/rendu-profils.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-profils.test.ts'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 25 — le moteur de verdict
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 25',
    /*
     * LA FAUTE QUE TOUT CE MOTEUR EXISTE POUR EMPECHER : conclure « favorable » sur ce qu'on n'a
     * pas regarde. La parcelle sort en tete de liste, part dans un dossier remis a un tiers, et
     * rien ne dit que quarante-neuf de ses cinquante-deux contraintes n'ont jamais ete evaluees.
     */
    quoi: 'une contrainte non evaluee cesse d’empecher le verdict « favorable »',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "      : enfreintesReglementaires.length > 0 || aVerifier.length > 0 || absentes.length > 0",
    vers: "      : enfreintesReglementaires.length > 0 || aVerifier.length > 0",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * UN ZONAGE JAMAIS CROISE PASSE POUR UN ZONAGE ABSENT. La distinction la plus facile a perdre
     * du moteur : une parcelle hors de tout zonage et une parcelle jamais croisee avec les couches
     * donnent le meme « aucun recouvrement ». Les confondre declare conforme ce qui n'a pas ete
     * regarde — et le fait pour les contraintes REDHIBITOIRES, celles qui interdisent.
     */
    quoi: 'un zonage jamais croise est compte comme un zonage absent',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "  if (!mesureTrouvee) return { etat: 'donnee_absente', valeur: null, chemin: null };",
    vers: '  // mutation',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * UN ECART AU CAHIER DES CHARGES REDEVIENT UNE PARCELLE DEFAVORABLE. C'est le defaut que mon
     * premier moteur portait : a 250 m des habitations, une parcelle conforme au droit (100 m en
     * declaration, 200 m en enregistrement) ressortait « defavorable » parce qu'un developpeur
     * exigeait 400 m. L'operateur annonce alors l'inverse de ce que dit la loi.
     */
    quoi: 'une exigence de developpeur non tenue rend la parcelle « defavorable »',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "  const bloquantes = enfreintesReglementaires.filter((c) => c.caractere === 'redhibitoire');",
    vers: "  const bloquantes = enfreintes.filter((c) => c.caractere === 'redhibitoire');",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * LES PROCEDURES REDEVIENNENT DES CONTRAINTES. Un permis de construire est requis pour TOUT
     * projet : le compter comme une penalite met chaque parcelle « a instruire » pour une
     * formalite universelle, et le verdict cesse de distinguer quoi que ce soit.
     */
    quoi: 'les lignes « cadre » entrent dans le verdict',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    if (etat === 'cadre') cadres.push(evaluee);",
    vers: '    if (false) cadres.push(evaluee);',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * UN SEUIL QUI NE TRANCHE PAS SE MET A TRANCHER. `egal` ne veut pas dire « exactement cette
     * valeur » mais « sens non etabli » : le comparer a l'egalite stricte n'est vrai pour personne
     * et viderait la liste en silence.
     */
    quoi: 'un seuil au sens non etabli est compare a l’egalite stricte',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "  if (applique.condition.operateur === 'egal') return { etat: 'a_verifier', valeur, chemin };",
    vers: '  // mutation',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * LA CONTRAINTE DECISIVE DEVIENT UNE LACUNE PLUTOT QU'UN FAIT. Nommer « non evaluée » comme
     * cause quand une interdiction est par ailleurs constatee envoie l'operateur chercher au
     * mauvais endroit.
     */
    quoi: 'la contrainte decisive n’est plus l’infraction constatee',
    fichier: 'packages/scoring/src/verdict.ts',
    de: '    enfreintesReglementaires.length > 0\n      ? enfreintesReglementaires',
    vers: '    false\n      ? enfreintesReglementaires',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * UNE CORRESPONDANCE SE BRANCHE SUR UNE GRANDEUR D'UNE AUTRE UNITE. C'est l'erreur reelle que
     * le rapprochement par motifs produisait : comparer un rayon de 15 km a un tonnage ne leve
     * rien, cela rend un verdict.
     */
    quoi: 'une contrainte est branchee sur une grandeur d’une autre unite',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: "    chemins: ['raccordement.posteLePlusProche.distanceKm'],\n    unite: 'km',",
    vers: "    chemins: ['raccordement.posteLePlusProche.capaciteResiduelleMw'],\n    unite: 'km',",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 25',
    /*
     * L'EXPLICATION CESSE DE NOMMER LE SEUIL REGLEMENTAIRE REMPLACE. Sans cette moitie de phrase,
     * l'operateur ne peut pas dire au developpeur que l'ecart vient de SA propre exigence, donc
     * qu'il est negociable.
     */
    quoi: 'l’explication ne rappelle plus ce que la reglementation demande',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "          ? ` — la réglementation, elle, demande « ${c.seuilReglementaire} »`",
    vers: "          ? ''",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 26 — le verdict branche sur le mode 1
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 26',
    /*
     * LA FICHE SE MET A LIRE UN CAHIER DES CHARGES. C'est l'inversion du §2.3 cote route : la
     * parcelle repondrait selon le profil du dernier developpeur consulte, et l'operateur
     * ecarterait du foncier instruisable en croyant lire la loi. La reponse resterait un 200
     * parfaitement forme.
     */
    quoi: 'la fiche parcelle laisse la requete choisir le mode d’evaluation',
    fichier: 'apps/api/src/routes/parcelles.ts',
    de: "      verdict: evaluerVerdict(snapshot.snapshot, filiere, 'reglementaire'),",
    vers: "      verdict: evaluerVerdict(snapshot.snapshot, filiere, (q as { mode?: 'reglementaire' | 'developpeur' }).mode ?? 'reglementaire'),",
    tests: ['apps/api/test/verdict-mode1.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/verdict-mode1.test.ts'],
  },
  {
    audit: 'audit 26',
    /*
     * L'ECRAN CESSE DE DIRE QUE « NON EVALUEE » EST UNE LACUNE. Le referentiel depasse largement
     * ce que le releve mesure : sans cette phrase, un « à instruire » se lit comme un jugement
     * porte sur la parcelle alors que c'est un aveu sur la donnee, et l'operateur regle le mauvais
     * probleme.
     */
    quoi: 'la fiche ne dit plus qu’une contrainte « non evaluee » est une lacune de donnee',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: '          Les contraintes « non évaluées » ne sont pas des contraintes absentes&nbsp;: la donnée',
    vers: '          Contraintes sans incidence relevée&nbsp;: la donnée',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  {
    audit: 'audit 26',
    /*
     * L'ECRAN CESSE DE DIRE QUE LA FICHE EST REGLEMENTAIRE. Meme contresens que ci-dessus, du cote
     * de l'interface : l'operateur croira sa fiche influencee par le profil ouvert.
     */
    quoi: 'la fiche n’annonce plus qu’elle evalue au seuil reglementaire',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: '        Évalué au <strong>seuil réglementaire</strong>. Les exigences propres à un développeur',
    vers: '        Évalué selon les critères en vigueur. Les exigences propres à un développeur',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  {
    audit: 'audit 26',
    /*
     * LE CHEMIN DE LA MESURE DISPARAIT. Sans lui, un chiffre faux est indiscernable d'un chiffre
     * juste : l'operateur n'a aucun moyen de remonter a la source de ce qu'on lui affirme.
     */
    quoi: 'la mesure affichee n’indique plus d’ou elle vient',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: '          <span className="verdict-chemin">({c.cheminMesure})</span>',
    vers: '          <span className="verdict-chemin" />',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  {
    audit: 'audit 26',
    /*
     * LES CONTRAINTES RESPECTEES REMONTENT EN TETE DE LISTE. L'operateur defile alors sur ce dont
     * il n'a rien a faire avant d'atteindre ce qui pose probleme.
     */
    quoi: 'les contraintes a lire ne viennent plus avant celles qui vont bien',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: '  const triees = [...verdict.contraintes].sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat]);',
    vers: '  const triees = [...verdict.contraintes];',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  {
    audit: 'audit 26',
    /*
     * L'ECRAN CESSE DE DISTINGUER « A INSTRUIRE FAUTE DE DONNEE » DE « A INSTRUIRE PARCE QUE ÇA
     * COINCE ». Mesure sur 200 parcelles reelles en solaire : 200 « à instruire », 0 enfreinte,
     * 51 contraintes non evaluees sur 56. Sans la nuance, la totalite du foncier parait mediocre
     * alors que la phrase juste est « nous n'avons pas regarde ».
     */
    quoi: 'l’ecran ne distingue plus une lacune de donnee d’une contrainte qui coince',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: "  const faute = enfreintes > 0 || aVerifier > 0;",
    vers: '  const faute = true;',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 27 — le mode 2, la recherche au seuil du developpeur
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 27',
    /*
     * UN SEUIL QUE RIEN NE SAIT MESURER EST APPLIQUE QUAND MEME, sur la premiere grandeur venue.
     * C'est exactement l'erreur que la table de correspondance ecrite a la main existe pour
     * empecher : une condition fabriquee rend un nombre, il se compare, et la liste se restreint
     * sur une grandeur qui n'a rien a voir.
     */
    quoi: 'un seuil sans correspondance est applique sur une grandeur arbitraire',
    fichier: 'apps/api/src/services/profil-en-filtres.ts',
    de: "      ignores.push({ contrainteId: s.contrainteId, nom: contrainte.nom, raison: 'grandeur_non_mesuree' });\n      continue;\n    }\n    if (correspondance.mode !== 'seuil') {",
    vers: "      seuils.push({ chemin: 'bati.distanceHabitationM', min: s.valeur });\n      continue;\n    }\n    if (correspondance.mode !== 'seuil') {",
    tests: ['apps/api/test/recherche-profil.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/recherche-profil.test.ts'],
  },
  {
    audit: 'audit 27',
    /*
     * LES SEUILS NON APPLIQUES SONT TUS. L'operateur croit son filtre actif, remet un dossier, et
     * personne ne sait que l'exigence du developpeur n'a jamais ete verifiee. 250 des 292
     * contraintes sont dans ce cas : ce n'est pas un cas limite.
     */
    quoi: 'la recherche ne dit plus quels seuils du profil n’ont pas ete appliques',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '          seuilsIgnores: traduction.ignores.map((i) => ({ ...i, message: expliquerIgnore(i) })),',
    vers: '          seuilsIgnores: [],',
    tests: ['apps/api/test/recherche-profil.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/recherche-profil.test.ts'],
  },
  {
    audit: 'audit 27',
    /*
     * LE SEUIL DU PROFIL N'ATTEINT PLUS LE SQL. La recherche rend alors exactement le meme
     * resultat qu'un balayage sans profil, et l'operateur remet au developpeur un dossier qui ne
     * respecte pas son cahier des charges — sans qu'aucun message ne le signale.
     */
    quoi: 'les seuils du profil n’entrent pas dans les conditions de recherche',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '        seuils: [...(filtres.seuils ?? []), ...traduction.seuils],',
    vers: '        seuils: filtres.seuils,',
    tests: ['apps/api/test/recherche-profil.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/recherche-profil.test.ts'],
  },
  {
    audit: 'audit 27',
    /*
     * UN PROFIL D'UNE AUTRE FILIERE EST ACCEPTE. Aucune de ses contraintes ne produit de
     * condition : la recherche rend le meme resultat que sans profil, et l'operateur croit le
     * cahier des charges applique.
     */
    quoi: 'un profil d’une autre filiere est applique a vide au lieu d’etre refuse',
    fichier: 'apps/api/src/routes/divers.ts',
    de: '      if (profil.filiere !== filtres.filiere) {',
    vers: '      if (false) {',
    tests: ['apps/api/test/recherche-profil.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/recherche-profil.test.ts'],
  },
  {
    audit: 'audit 27',
    /*
     * LE SENS D'UN SEUIL AMBIGU EST DEVINE « au moins ». Mesure sur le classeur : les cas ou le
     * sens n'est pas etabli vont dans les deux sens. Deviner se tromperait environ une fois sur
     * deux, en silence, et inverserait la contrainte.
     */
    quoi: 'la traduction devine le sens d’un seuil que le classeur n’etablit pas',
    fichier: 'apps/api/src/services/profil-en-filtres.ts',
    de: "    const sens = sensReglementaire(contrainte) ?? s.sens ?? null;",
    vers: "    const sens = sensReglementaire(contrainte) ?? s.sens ?? 'min';",
    tests: ['apps/api/test/recherche-profil.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/recherche-profil.test.ts'],
  },
  {
    audit: 'audit 27',
    /*
     * LE BANDEAU CESSE DE DIRE CE QUI N'A PAS ETE APPLIQUE. Meme faute que cote serveur, du cote
     * de l'ecran : l'operateur tient sa liste pour plus filtree qu'elle ne l'est.
     */
    quoi: 'le bandeau du cahier des charges masque les seuils non appliques',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: '            {seuilsIgnores.length} non appliqué{seuilsIgnores.length > 1 ? \'s\' : \'\'}',
    vers: '            {0} seuil supplémentaire',
    tests: ['apps/web/test/rendu-recherche-criteres.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-recherche-criteres.test.ts'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 28 — le typage des tests de l'API
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 28',
    /*
     * LE PERIMETRE DE TYPAGE SE RETRECIT. C'est le mode de defaillance qui a laisse les cinquante
     * fichiers de test de ce paquet non compiles pendant dix-sept audits : le typage reste vert et
     * la couverture tombe a zero, sans un mot. Un test qui se trompe de type ne prouve plus ce
     * qu'il annonce.
     */
    quoi: 'les tests de l’API sortent du perimetre du compilateur',
    fichier: 'apps/api/tsconfig.test.json',
    de: '"src/**/*",\n    "test/**/*"',
    vers: '"src/**/*"',
    tests: ['apps/api/test/typage-des-tests.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/typage-des-tests.test.ts'],
  },
  {
    audit: 'audit 28',
    /*
     * LA CONFIGURATION DE TYPAGE EXISTE MAIS N'EST PLUS LANCEE. Troisieme mecanisme ecrit puis
     * oublie du depot : correct, complet, et jamais execute. L'integration continue appelle
     * `typecheck` ; c'est donc cette commande qui doit porter les deux configurations.
     */
    quoi: 'la commande typecheck cesse de verifier les tests',
    fichier: 'apps/api/package.json',
    de: '"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json"',
    vers: '"typecheck": "tsc -p tsconfig.json --noEmit"',
    tests: ['apps/api/test/typage-des-tests.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/typage-des-tests.test.ts'],
  },
  {
    audit: 'audit 28',
    /*
     * LA CONSTRUCTION PERD SA RACINE. TypeScript deduit alors une racine commune a `src` et
     * `test`, la sortie part dans `dist/src/serveur.js`, et `main` ne resout plus rien : le paquet
     * construit sans erreur et ne demarre pas.
     */
    quoi: 'la configuration de construction perd `rootDir`',
    fichier: 'apps/api/tsconfig.json',
    de: '"rootDir": "src",',
    vers: '',
    tests: ['apps/api/test/typage-des-tests.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/typage-des-tests.test.ts'],
  },
  {
    audit: 'audit 28',
    /*
     * LE GARDE DE DEBIT REDEVIENT UN HOOK A RAPPEL. Les deux types s'enregistrent aussi bien
     * aupres de Fastify, mais `preHandlerHookHandler` declare un troisieme parametre `done` que
     * la fonction rendue ne prend pas — et quinze appels corrects redeviennent des erreurs.
     */
    quoi: 'le limiteur de debit ment sur le nombre de parametres qu’il rend',
    fichier: 'apps/api/src/debit.ts',
    de: 'export function limiterDebit(options: OptionsDebit): preHandlerAsyncHookHandler {',
    vers: 'export function limiterDebit(options: OptionsDebit): preHandlerHookHandler {',
    /*
     * LE CONTROLE EST `tsc`, ET IL NE POUVAIT PAS ETRE AUTRE CHOSE. Ma premiere ecriture lancait
     * `tsx --test test/debit.test.ts` — et la mutation survivait, forcement : `tsx` EFFACE les
     * types sans les verifier. Aucun test execute par lui ne peut attraper une regression de
     * typage. C'est precisement pourquoi les tests de ce paquet ont pu se tromper de type pendant
     * dix-sept audits sans que rien ne bronche, et pourquoi le compilateur doit les voir.
     */
    tests: ['apps/api/tsconfig.test.json (tsc)'],
    cwd: 'apps/api',
    commande: ['tsc', '-p', 'tsconfig.test.json'],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 29 — le dossier remis au developpeur avoue ce qu'il n'a pas regarde
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 29',
    /*
     * LE DOSSIER CESSE DE LISTER CE QU'IL N'A PAS PU EVALUER. Il part chez un developpeur qui
     * engage des frais d'etude sur sa foi. Mesure sur des parcelles reelles : 51 contraintes non
     * evaluees sur 56, aucune enfreinte. Un document qui enumere ce qu'il sait sans enumerer ce
     * qu'il ignore laisse conclure que le reste va bien.
     */
    quoi: 'le dossier ne liste plus les contraintes qu’il n’a pas pu evaluer',
    fichier: 'apps/api/src/services/exports.ts',
    de: "      if (c.etat !== 'donnee_absente' && c.etat !== 'a_verifier') continue;",
    vers: '      continue;',
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 29',
    /*
     * LE DOSSIER PRESUME RESPECTEES LES CONTRAINTES NON EVALUEES. C'est la phrase qui empeche de
     * lire une lacune comme un feu vert ; sans elle, « non évaluée » passe pour « rien a
     * signaler ».
     */
    quoi: 'le dossier ne refuse plus de presumer respectees les contraintes non evaluees',
    fichier: 'apps/api/src/services/exports.ts',
    de: "          'nationale homogène ne les mesure, ou le seuil réglementaire dépend du projet. Elles ne ' +\n          'sont pas réputées respectées. La colonne « source » indique où les instruire.',",
    vers: "          'nationale homogène ne les mesure. La colonne « source » indique où les instruire.',",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 29',
    /*
     * LE DOSSIER PRESENTE UNE LACUNE DE DONNEE COMME UN MOTIF DE REJET. Defaut reel, vu en
     * relisant le PDF rendu : le moteur retombe sur la contrainte non evaluee la plus severe
     * faute d'infraction, et la colonne l'annoncait comme « décisive » — arbitrairement choisie
     * parmi cinquante et une lacunes.
     */
    quoi: 'le dossier nomme une lacune de donnee dans la colonne des infractions',
    fichier: 'apps/api/src/services/exports.ts',
    de: "        v.resultat.contrainteDecisive?.etat === 'enfreinte'\n          ? v.resultat.contrainteDecisive.nom\n          : '-',",
    vers: "        v.resultat.contrainteDecisive?.nom ?? '-',",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 29',
    /*
     * MEME DEFAUT A L'ECRAN. « Contrainte décisive » sur une parcelle dont rien n'est enfreint
     * fait lire un motif de rejet la ou il n'y a qu'une donnee manquante.
     */
    quoi: 'la fiche annonce une lacune comme « contrainte decisive »',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: "            {verdict.contrainteDecisive.etat === 'enfreinte'\n              ? `Contrainte décisive : ${verdict.contrainteDecisive.nom}`\n              : `Premier point à instruire : ${verdict.contrainteDecisive.nom}`}",
    vers: '            {`Contrainte décisive : ${verdict.contrainteDecisive.nom}`}',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  {
    audit: 'audit 29',
    /*
     * LE DOSSIER CESSE DE DIRE QUE SON VERDICT EST CELUI DU DROIT. Un document remis a un tiers
     * ne peut pas laisser croire que son verdict vient des exigences commerciales d'un autre
     * developpeur.
     */
    quoi: 'le dossier n’annonce plus que son verdict est reglementaire',
    fichier: 'apps/api/src/services/exports.ts',
    de: "      'Évalué au seuil réglementaire du référentiel de contraintes, jamais au cahier des charges ' +\n        'd’un développeur. ",
    vers: "      'Évalué selon le référentiel de contraintes. ",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 30 — les couches deja mesurees, enfin lues par le verdict
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 30',
    /*
     * UN PLAN PRESENT SUR LA COMMUNE REDEVIENT UNE INTERDICTION SUR LA PARCELLE. `present` est au
     * niveau COMMUNE, `severitePlan` au niveau PARCELLE : confondre les deux rend redhibitoire
     * toute parcelle d'une commune dotee d'un PPRI — des milliers de parcelles constructibles
     * ecartees d'un coup, sans qu'aucune erreur ne soit levee.
     */
    quoi: 'un plan de prevention sur la commune vaut interdiction sur la parcelle',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    if (presence === true) return { etat: 'a_verifier', valeur: 1, chemin: correspondance.cheminAbsence };",
    vers: "    if (presence === true) return { etat: 'enfreinte', valeur: 1, chemin: correspondance.cheminAbsence };",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 30',
    /*
     * L'ABSENCE DE PLAN CESSE D'ETRE UN FAIT. Sur la base de reference, `present === false` sur les
     * 301 parcelles : le fait est connu et mesure. Le perdre remettrait 301 contraintes en « non
     * evaluee » — exactement l'etat dont ce chantier sortait.
     */
    quoi: 'l’absence de plan sur la commune n’etablit plus rien',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    if (presence === false) return { etat: 'respectee', valeur: 0, chemin: correspondance.cheminAbsence };",
    vers: '    // mutation',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 30',
    /*
     * UNE VALEUR INCERTAINE PASSE POUR UN FEU VERT. « prescriptions » autorise SOUS CONDITIONS :
     * la compter pour un respect ferait declarer conforme une parcelle que le plan contraint.
     */
    quoi: 'une severite « prescriptions » est comptee comme un respect',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    if (incertaines.includes(mot)) return { etat: 'a_verifier', valeur: nombre, chemin };",
    vers: '    // mutation',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 30',
    /*
     * LA COUVERTURE SE RETRECIT EN SILENCE. Une correspondance retiree fait conclure le verdict sur
     * moins de contraintes qu'avant, sans un mot — et « favorable » devient plus facile a obtenir.
     */
    quoi: 'des correspondances disparaissent sans que le compte ne bronche',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: "    'eolien_terrestre__ppri_inondation',\n    'solaire_sol__ppri_inondation',",
    vers: "    'solaire_sol__ppri_inondation',",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 30',
    /*
     * UN CHEMIN DE DRAPEAU MAL ORTHOGRAPHIE. Il rend `null`, la contrainte part en « non evaluee »,
     * et rien ne signale que la correspondance est morte : c'est la panne la plus silencieuse que
     * cette table puisse porter.
     */
    quoi: 'un chemin de drapeau ne designe plus rien dans le releve',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: '    chemins: [`${racine}.severitePlan`],',
    vers: '    chemins: [`${racine}.severiteDuPlan`],',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 31 — un atout n'est pas une contrainte
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 31',
    /*
     * LES LIGNES « favorable » REDEVIENNENT DES CONTRAINTES. « En ZAEnR = bonus », et toutes les
     * communes n'ont pas delibere : compter l'absence de bonus parmi les enfreintes ferait passer
     * « a instruire » une parcelle simplement moins avantageuse, et permettrait meme de la NOMMER
     * comme contrainte decisive.
     */
    quoi: 'une ligne « favorable » degrade le verdict comme une contrainte',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    else if (contrainte.caractere === 'favorable') atouts.push(evaluee);",
    vers: '    // mutation',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 31',
    /*
     * LA POLARITE D'UN ATOUT S'INVERSE. Pour `urbanisme.zaer.present`, c'est l'ABSENCE qui prive du
     * bonus. Lire le drapeau a l'endroit ferait declarer « acquis » un atout dont la parcelle ne
     * beneficie pas — et « absent » celui dont elle beneficie.
     */
    quoi: 'la polarite d’un atout est lue a l’envers',
    fichier: 'packages/scoring/src/verdict.ts',
    de: '      const declenche = valeur === (correspondance.declencheSi ?? true);',
    vers: '      const declenche = valeur;',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 31',
    /*
     * LE DOSSIER CESSE DE DIRE QU'UN ATOUT NE JUGE PAS LA CONFORMITE. Sans la phrase, « hors
     * ZAEnR » se lit comme un manquement, alors que c'est seulement un argument de moins.
     */
    quoi: 'le dossier ne dit plus qu’un atout n’entre pas dans le verdict',
    fichier: 'apps/api/src/services/exports.ts',
    de: "        'Éléments favorables relevés par le référentiel. Ils n’entrent pas dans le verdict — ne pas ' +\n          'en bénéficier n’est pas un défaut — mais ils pèsent sur l’acceptabilité d’un projet.',",
    vers: "        'Éléments favorables relevés par le référentiel pour ces parcelles.',",
    tests: ['apps/api/test/dossier-site.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/dossier-site.test.ts'],
  },
  {
    audit: 'audit 31',
    /*
     * MEME PHRASE A L'ECRAN, meme contresens.
     */
    quoi: 'la fiche ne dit plus qu’un atout absent n’est pas un defaut',
    fichier: 'apps/web/src/components/BlocVerdict.tsx',
    de: '            Éléments favorables du référentiel. Ils n’entrent pas dans le verdict&nbsp;: ne pas en\n            bénéficier n’est pas un défaut.',
    vers: '            Éléments favorables du référentiel.',
    tests: ['apps/web/test/rendu-verdict.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-verdict.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 32 — le meme alea, cinq seuils differents
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 32',
    /*
     * LES CINQ FILIERES SONT APLATIES SUR UN SEUIL UNIQUE. Le classeur retient « Aléa fort » en
     * eolien, agrivoltaisme et methanisation, mais « Aléa moyen/fort » en solaire et en BESS. Les
     * confondre trahit le classeur DANS LES DEUX SENS : trop severe pour trois filieres, trop
     * permissif pour deux. Sur la base de reference, l'ecart porte sur 52 parcelles.
     */
    quoi: 'le seuil d’alea argiles devient le meme pour les cinq filieres',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: "  ...rga(['solaire_sol', 'bess'], ['moyen', 'fort'], 'Aléa moyen/fort'),",
    vers: "  ...rga(['solaire_sol', 'bess'], ['fort'], 'Aléa fort'),",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 32',
    /*
     * ET DANS L'AUTRE SENS : les trois filieres qui ne retiennent que l'alea fort se mettent a
     * penaliser l'alea moyen. 52 parcelles ecartees a tort, sans qu'aucune erreur ne soit levee.
     */
    quoi: 'les filieres qui ne retiennent que l’alea fort penalisent l’alea moyen',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: "  ...rga(['eolien_terrestre', 'agrivoltaisme', 'methanisation'], ['fort'], 'Aléa fort'),",
    vers: "  ...rga(['eolien_terrestre', 'agrivoltaisme', 'methanisation'], ['moyen', 'fort'], 'Aléa moyen/fort'),",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 32',
    /*
     * UNE VALEUR CONNUE QUI NE DECLENCHE PAS CESSE D'ETRE UNE REPONSE. « alea nul » ETABLIT que la
     * parcelle n'est pas concernee ; le confondre avec une donnee absente remettrait 249 parcelles
     * en « non evaluee » alors que la reponse est mesuree.
     */
    quoi: 'une valeur connue qui ne declenche pas repasse pour une donnee absente',
    fichier: 'packages/scoring/src/verdict.ts',
    de: "    return { etat: 'respectee', valeur: nombre, chemin };\n  }\n\n  // Le drapeau lui-meme est nul",
    vers: "    return { etat: 'donnee_absente', valeur: nombre, chemin };\n  }\n\n  // Le drapeau lui-meme est nul",
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 33 — les deux courriers : ce qu'ils affirment, et ce qu'ils gardent
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 33',
    /*
     * LA PARENTHESE QUI A DEJA COUTE LA CONTENANCE ENTIERE. `a ?? b == null ? x : y` se lit
     * `(a ?? (b == null)) ? x : y` : avec une surface renseignee la condition vaut `124800`, donc
     * vrai, donc `null`. La contenance ne s'imprimait jamais — et rien ne le signalait, puisqu'une
     * designation sans contenance reste une phrase correcte.
     */
    quoi: 'la contenance disparait de la designation cadastrale, sans erreur',
    fichier: 'apps/api/src/services/courriers.ts',
    de: '  const surface = p.surfaceCalculeeM2 ?? p.contenanceM2;\n  const ha = surface == null ? null',
    vers: '  const surface = p.surfaceCalculeeM2;\n  const ha = p.surfaceCalculeeM2 ?? p.contenanceM2 == null ? null',
    tests: ['apps/api/test/courriers.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * LE PIRE DEFAUT POSSIBLE DE CE MODULE : faire citer au courrier un article de loi que
     * personne n'a verifie. Le depot n'en tient AUCUNE source sure — il ecrit seulement que la
     * donnee « s'obtient apres demande documentee ». Le courrier part sur papier a en-tete.
     */
    quoi: 'le courrier invente un fondement juridique precis',
    fichier: 'apps/api/src/services/courriers.ts',
    de: "    `Fondement de la demande : ${trou('à compléter et à vérifier auprès du service saisi')}.`,",
    vers: "    `Fondement de la demande : article L. 107 A du livre des procédures fiscales.`,",
    tests: ['apps/api/test/courriers.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * UN MONTANT AVANCE PAR UN GENERATEUR ENGAGE L'EXPEDITEUR. Le loyer est un element de
     * negociation que seul le developpeur fixe ; un modele qui le suggere fait signer une offre.
     */
    quoi: 'le premier contact avance un ordre de grandeur de loyer',
    fichier: 'apps/api/src/services/courriers.ts',
    de: "    'À ce stade, il s’agit d’une étude préalable : aucune décision n’est prise, et rien ne vous ' +",
    vers: "    'À ce stade, il s’agit d’une étude préalable (de l’ordre de 3 000 € par hectare et par an) : ' +\n      'aucune décision n’est prise, et rien ne vous ' +",
    tests: ['apps/api/test/courriers.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * LE REPLI D'EN-TETE COMPTE EN OCTETS, PAS EN CARACTERES — et la nuance a survecu a une
     * premiere correction. Vingt-quatre caracteres accentues font 48 octets, donc 64 de base64,
     * donc 76 avec l'habillage, donc 85 une fois « Subject: » devant. Le repli existait, et la
     * ligne depassait quand meme.
     */
    quoi: 'le budget d’un mot encode se compte en caracteres et non en octets',
    fichier: 'apps/api/src/services/courriers.ts',
    de: "      const taille = Buffer.byteLength(caracteres[fin]!, 'utf8');",
    vers: '      const taille = 1;',
    tests: ['apps/api/test/courriers.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * LE NOM DU PROPRIETAIRE RESTE SUR LE POSTE. Il y dormirait sans trace, sans effacement et
     * sans rapport avec la parcelle ouverte — jusqu'a reapparaitre dans le courrier suivant,
     * adresse a quelqu'un d'autre. C'est le genre d'ajout qui se fait par commodite (« on garde
     * aussi l'adresse, c'est plus pratique ») et qui ne se voit qu'une fois le courrier parti.
     */
    quoi: 'le nom du destinataire entre dans ce que le poste memorise',
    fichier: 'apps/web/src/components/BlocCourriers.tsx',
    de: "export const CHAMPS_MEMORISES = ['expediteur', 'signataire', 'qualite', 'coordonnees', 'projet'] as const;",
    vers: "export const CHAMPS_MEMORISES = ['expediteur', 'signataire', 'qualite', 'coordonnees', 'projet', 'destinataire', 'adresse'] as const;",
    tests: ['apps/web/test/rendu-courriers.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * LE `mailto:` TRONQUE EN SILENCE. Le client ouvre un brouillon qui a l'air complet, et la
     * phrase manquante ne se decouvre qu'a la reception. Sans plafond, le raccourci est offert
     * pour n'importe quelle longueur.
     */
    quoi: 'le lien de messagerie est offert quelle que soit la longueur du courrier',
    fichier: 'apps/web/src/components/BlocCourriers.tsx',
    de: '  return url.length <= PLAFOND ? url : null;',
    vers: '  return url;',
    tests: ['apps/web/test/rendu-courriers.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/rendu-courriers.test.ts'],
  },
  {
    audit: 'audit 33',
    /*
     * LE GARDE D'ACCESSIBILITE NE REFUSE PLUS RIEN. La correction de son decoupage a ASSOUPLI son
     * critere — il accepte desormais `{libelle}` — et un assouplissement mal borne transforme un
     * garde en decoration. On verifie donc qu'un bouton reellement muet est encore attrape.
     */
    quoi: 'le garde de nom accessible accepte un bouton sans aucun contenu',
    fichier: 'apps/web/test/accessibilite.test.ts',
    de: "    if (expression.startsWith('/*')) continue;",
    vers: "    if (expression.startsWith('/*')) return true;",
    tests: ['apps/web/test/accessibilite.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/accessibilite.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 34 — le rapport de verification ne doit pas pouvoir se perimer en silence
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 34',
    /*
     * LE RAPPORT SURESTIME CE QUE L'APPLICATION EVALUE. C'est le document sur lequel se fonde une
     * decision de terrain : savoir que le verdict eolien repose sur 18 contraintes raccordees et
     * non sur les 54 classees automatisables change ce qu'on en fait. Un tableau faux se lit
     * exactement comme un tableau juste — il est donc PIRE que l'absence de rapport.
     */
    quoi: 'le rapport annonce plus de contraintes raccordees qu’il n’y en a',
    fichier: 'docs/VERIFICATION-REFERENTIEL.md',
    de: '| Éolien terrestre | 83 | 54 | **24** | 30 | 29 |',
    vers: '| Éolien terrestre | 83 | 54 | **30** | 24 | 29 |',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/couverture-referentiel.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/couverture-referentiel.test.ts'],
  },
  {
    audit: 'audit 34',
    /*
     * UNE CORRESPONDANCE RETIREE DU CODE, ET LE RAPPORT QUI CONTINUE D'ANNONCER L'ANCIEN COMPTE.
     * C'est la derive normale d'un document tenu a la main : le code bouge, le tableau reste. Le
     * test doit lier les deux dans CE sens-la aussi, et pas seulement quand c'est le document qu'on
     * edite.
     */
    quoi: 'une correspondance disparait du code sans que le rapport ne bouge',
    fichier: 'packages/scoring/src/verdict-correspondances.ts',
    de: "    'methanisation__ppri_inondation',",
    vers: '',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/couverture-referentiel.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/couverture-referentiel.test.ts'],
  },
  {
    audit: 'audit 34',
    /*
     * LE RAPPORT ANNONCE UN MILLESIME QUI N'EST PLUS CELUI DU CLASSEUR INTEGRE. Il decrirait alors
     * un autre referentiel que celui que l'application applique, et rien dans sa lecture ne le
     * revelerait.
     */
    quoi: 'le rapport reste date d’un millesime anterieur du classeur',
    fichier: 'docs/VERIFICATION-REFERENTIEL.md',
    de: '**Millésime du classeur** : 2026-09-18',
    vers: '**Millésime du classeur** : 2026-08-04',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/couverture-referentiel.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/couverture-referentiel.test.ts'],
  },
  {
    audit: 'audit 34',
    /*
     * LE README EST CE QUE TOUT LE MONDE LIT. Sa phrase de couverture oriente l'usage bien plus que
     * le rapport, que personne n'ouvre avant d'en avoir besoin — et c'est donc elle qui derivera en
     * premier si rien ne la tient. « 219 sur 292 tranchees » ferait croire l'inverse de la realite.
     */
    quoi: 'le README annonce une couverture inverse de la realite',
    fichier: 'README.md',
    de: 'de fonder une décision sur un verdict — 91 contraintes sur 292 sont raccordées au relevé, les\n201 autres sont affichées',
    vers: 'de fonder une décision sur un verdict — 201 contraintes sur 292 sont raccordées au relevé, les\n91 autres sont affichées',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/couverture-referentiel.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/couverture-referentiel.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 35 — l'agrivoltaisme trie a l'inverse du solaire au sol
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 35',
    /*
     * LE DEFAUT LE PLUS COUTEUX DE CETTE FILIERE, et il ne leve aucune erreur. L'agrivoltaisme
     * exige une production agricole maintenue (L.314-36) ; sur une parcelle artificialisee il n'y
     * a plus d'agriculture a maintenir. Reprendre la table du solaire au sol remonterait en tete
     * du classement exactement les parcelles ou le projet est impossible, et relegerait celles
     * qu'il faut prospecter.
     */
    quoi: 'l’agrivoltaisme reprend la table de nature du sol du solaire au sol',
    fichier: 'packages/scoring/src/criteres-eval.ts',
    de: '  agrivoltaisme: {\n    agricole_exploite: 100,\n    inculte: 25,\n    degrade: 15,\n    artificialise: 10,\n    naturel_forestier: 5,\n  },',
    vers: '  agrivoltaisme: {\n    artificialise: 100,\n    degrade: 100,\n    inculte: 75,\n    agricole_exploite: 45,\n    naturel_forestier: 10,\n  },',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/agrivoltaisme.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/agrivoltaisme.test.ts'],
  },
  {
    audit: 'audit 35',
    /*
     * UNE FILIERE SANS REGLES DE PROCEDURE N'ANNONCE AUCUNE AUTORISATION. C'est le defaut qu'a
     * revele l'ouverture de la filiere : `REGLES` etait un `Record<string, …>`, l'agrivoltaisme en
     * etait absent, `seuil()` rendait `null` pour chacune de ses regles — ni permis de construire,
     * ni evaluation environnementale, ni compensation agricole. Un dossier muet sur ses
     * autorisations, sans une erreur nulle part.
     */
    quoi: 'l’agrivoltaisme perd toutes ses regles de procedure',
    fichier: 'packages/core/src/reglementation.ts',
    de: '  agrivoltaisme: REGLES_SOLAIRE,\n  eolien_terrestre: REGLES_EOLIEN,',
    vers: '  agrivoltaisme: {},\n  eolien_terrestre: REGLES_EOLIEN,',
    construire: '@enr/core',
    tests: ['packages/scoring/test/procedures-transversales.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/procedures-transversales.test.ts'],
  },
  {
    audit: 'audit 35',
    /*
     * LE DOCUMENT-CADRE DEPARTEMENTAL REMIS A L'AGRIVOLTAISME. Il gouverne la liste des terrains
     * eligibles au photovoltaique AU SOL — le regime B, celui qui n'est precisement pas
     * l'agrivoltaisme. L'y appliquer emettrait un blocage tire d'un dispositif qui ne concerne pas
     * la filiere : la donnee est juste, son application est fausse.
     */
    quoi: 'le knock-out du document-cadre s’applique aussi a l’agrivoltaisme',
    fichier: 'packages/scoring/src/knockouts.ts',
    de: '  agrivoltaisme: [...COMMUNS],',
    vers: '  agrivoltaisme: [...COMMUNS, koDocumentCadre, koAopViticole],',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/agrivoltaisme.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/agrivoltaisme.test.ts'],
  },
  {
    audit: 'audit 35',
    /*
     * UNE ICONE INEXISTANTE NE LEVE RIEN : `Icone` retombe sur le soleil. Le selecteur afficherait
     * alors deux soleils identiques pour le solaire au sol et l'agrivoltaisme, dans la barre ou il
     * faut precisement les distinguer — et l'operateur prospecterait la mauvaise filiere.
     */
    quoi: 'une filiere annonce une icone qui n’existe pas',
    fichier: 'packages/core/src/filieres.ts',
    de: "    icone: 'sprout',",
    vers: "    icone: 'pousse',",
    construire: '@enr/core',
    tests: ['apps/web/test/filieres-interface.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/filieres-interface.test.ts'],
  },
  {
    audit: 'audit 35',
    /*
     * LA VALEUR D'ENUMERATION BRUTE DANS LA SYNTHESE DU RAPPORT. « Poste de transformation 90 kV
     * (autre_grd) » — une cle de code donnee pour un nom d'entreprise, dans le document remis a un
     * proprietaire. Elle ne s'etait jamais vue parce que les parcelles relues avaient RTE ou Enedis
     * pour poste le plus proche ; 1 967 postes du jeu national tombent pourtant dans ce cas.
     */
    quoi: 'le gestionnaire de reseau s’imprime en valeur d’enumeration brute',
    fichier: 'packages/scoring/src/criteres-eval.ts',
    de: "${poste.nom} (${libelleGestionnaire(poste.gestionnaire)})`,",
    vers: '${poste.nom} (${poste.gestionnaire})`,',
    construire: '@enr/scoring',
    tests: ['packages/scoring/test/agrivoltaisme.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/agrivoltaisme.test.ts'],
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // AUDIT 36 — Georisques, GPU, et le fondement d'un verdict defavorable
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  {
    audit: 'audit 36',
    /*
     * `Number('')` VAUT ZERO. Une reponse vide de Georisques passerait donc pour une zone sismique
     * nulle — hors de l'echelle legale, qui commence a 1 — et la contrainte conclurait « respectee »
     * sur une donnee absente. C'est la direction dangereuse de l'erreur.
     */
    quoi: 'un classement communal vide passe pour la zone zero',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: '  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;',
    vers: '  return Number.isInteger(n) && n <= max ? n : null;',
    tests: ['apps/api/test/georisques-aleas.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/georisques-aleas.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * UN STATUT SEVESO ILLISIBLE REPLIE SUR LE SEUIL LE PLUS BAS. Le repli est tentant — « au moins
     * on signale quelque chose » — et il fait passer une lacune de lecture pour une mesure, dans le
     * sens rassurant puisque le seuil bas est le moins severe.
     */
    quoi: 'un statut SEVESO illisible se replie sur le seuil bas',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "  if (v.includes('bas')) return 'seuil_bas';\n  return null;",
    vers: "  return 'seuil_bas';",
    tests: ['apps/api/test/georisques-aleas.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/georisques-aleas.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * « AUCUN » REDEVIENT `null`, ET LA CONTRAINTE NE TRANCHE PLUS JAMAIS. Sans le troisieme etat,
     * « la couche n'a pas repondu » et « aucun etablissement SEVESO dans le rayon » s'ecrivent
     * pareil : la contrainte du classeur reste eternellement « non evaluee » alors que la reponse
     * est mesuree.
     */
    quoi: 'l’absence mesuree d’etablissement SEVESO se confond avec un echec d’appel',
    fichier: 'apps/api/src/connecteurs/georisques.ts',
    de: "  return meilleur ?? { statut: 'aucun', distanceKm: null, nom: null };",
    vers: '  return meilleur ?? { statut: null, distanceKm: null, nom: null };',
    tests: ['apps/api/test/georisques-aleas.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/georisques-aleas.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * « 1AUx » RANGE EN ZONE AGRICOLE. Le test de prefixe ecrit dans l'ordre alphabetique — « A »
     * avant « AU » — fait passer toutes les zones A URBANISER pour des terres agricoles, sur la
     * donnee qui gouverne la constructibilite. Rien ne leve, rien ne se voit.
     */
    quoi: 'les zones a urbaniser sont rangees en zone agricole',
    fichier: 'apps/api/src/connecteurs/gpu.ts',
    de: "  if (nu.startsWith('AU')) return 'AU';\n  if (nu.startsWith('U')) return 'U';\n  if (nu.startsWith('A')) return 'A';",
    vers: "  if (nu.startsWith('A')) return 'A';\n  if (nu.startsWith('U')) return 'U';",
    tests: ['apps/api/test/gpu-zonage.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/gpu-zonage.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * SANS DOCUMENT PUBLIE, « AUCUN EBC » DEVIENT UNE REPONSE. La couche rend une liste vide aussi
     * bien pour un territoire sans espace boise classe que pour un territoire dont le document
     * n'est pas publie au Geoportail. Les confondre fait conclure « respectee » — sur une
     * contrainte REDHIBITOIRE, donc dans le sens favorable — a une question jamais posee.
     */
    quoi: 'sans document d’urbanisme, l’absence d’EBC passe pour une reponse',
    fichier: 'apps/api/src/connecteurs/gpu.ts',
    de: '  return couvertParGpu === true ? false : null;',
    vers: '  return false;',
    tests: ['apps/api/test/gpu-zonage.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/gpu-zonage.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * LE ZONAGE DOMINANT DEVIENT LE PREMIER RENDU. L'ordre de la reponse du GPU n'est pas un ordre
     * de surface : une langue de zone N couvrant 5 % de la parcelle deciderait du reglement a
     * consulter, si elle arrive en tete.
     */
    quoi: 'le zonage dominant est le premier rendu et non le plus etendu',
    fichier: 'apps/api/src/connecteurs/gpu.ts',
    de: '    if (meilleure == null || part > meilleure.part) meilleure = { famille, part };',
    vers: '    if (meilleure == null) meilleure = { famille, part };',
    tests: ['apps/api/test/gpu-zonage.test.ts'],
    cwd: 'apps/api',
    commande: ['tsx', '--test', 'test/gpu-zonage.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * LA LIGNE QUI PORTE TOUTE LA PROTECTION, et elle tient en trois mots.
     *
     * `etabli ? reglementaire : null` : des qu'une raison existe — seuil approximatif, extraction
     * incomplete, aucun fondement cite — la condition est annulee et la contrainte part en
     * verification au lieu de trancher. La supprimer fait trancher « Gisement de vent
     * ≥ ~5-6 m/s (selon machine) » : une parcelle a 3 m/s ressort « defavorable », c'est-a-dire
     * juridiquement fermee, sur un ordre de grandeur economique — dans un document remis a un
     * proprietaire.
     *
     * J'AVAIS D'ABORD ECRIT CETTE GARDE UNE SECONDE FOIS dans le moteur de verdict, en croyant
     * corriger un defaut. Cette mutation-ci l'a survecu : le bloc etait inatteignable, puisque
     * la condition etait deja nulle. Il a ete retire, et la mutation vise desormais la ligne qui
     * fait vraiment le travail.
     */
    quoi: 'un seuil non etabli tranche quand meme le verdict',
    fichier: 'packages/core/src/seuils-developpeur.ts',
    de: '    condition: etabli ? reglementaire : null,',
    vers: '    condition: reglementaire,',
    construire: '@enr/core',
    tests: ['packages/scoring/test/verdict.test.ts'],
    cwd: 'packages/scoring',
    commande: ['node', '--test', '--experimental-strip-types', 'test/verdict.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * « VARIABLE » REDEVIENT « CADRE », ET UNE FILIERE CESSE DE VOIR LES SERVITUDES.
     *
     * `cadre` n'entre jamais dans le verdict — a juste titre, puisqu'il designe le permis de
     * construire, l'etude d'impact, le regime ICPE, c'est-a-dire ce qui s'applique a TOUT projet.
     * Y ranger le libelle « Variable », qui n'apparait qu'une fois dans les 292 lignes, faisait
     * disparaitre les servitudes d'utilite publique de l'agrivoltaisme — sans un mot dans la
     * fiche, alors que les quatre autres filieres les traitent en redhibitoire.
     */
    quoi: 'le libelle « Variable » du classeur est range avec les « Cadre »',
    fichier: 'scripts/referentiel-contraintes.mjs',
    de: "  [/^variable/i, 'penalisant'],",
    vers: "  [/^variable/i, 'cadre'],",
    /*
     * LE REFERENTIEL EST GENERE : muter l'extracteur ne change rien tant qu'on ne le rejoue pas.
     * `construire` ne suffit donc pas — la regeneration precede la compilation, et c'est elle qui
     * porte la mutation jusqu'au module que les tests lisent.
     */
    avant: ['node', 'scripts/referentiel-contraintes.mjs'],
    construire: '@enr/core',
    tests: ['packages/core/test/contraintes-referentiel.test.ts'],
    cwd: 'packages/core',
    commande: ['node', '--test', '--experimental-strip-types', 'test/contraintes-referentiel.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * LE DOSSIER DE RELECTURE ANNONCE UN COMPTE FAUX. Le cout n'est pas le meme que pour le rapport
     * de verification : c'est du temps de juriste passe sur une divergence deja resolue — ou, pire,
     * une divergence qu'on ne lui signale plus.
     */
    quoi: 'le dossier de relecture sous-estime les redhibitoires sans article',
    fichier: 'docs/RELECTURE-JURIDIQUE.md',
    de: '| **Total** | **50** | sur 133 rédhibitoires |',
    vers: '| **Total** | **12** | sur 133 rédhibitoires |',
    construire: '@enr/core',
    tests: ['packages/core/test/relecture-juridique.test.ts'],
    cwd: 'packages/core',
    commande: ['node', '--test', '--experimental-strip-types', 'test/relecture-juridique.test.ts'],
  },
  {
    audit: 'audit 36',
    /*
     * LE DOSSIER CESSE DE DIRE CE QU'IL N'EST PAS. Il ressemble a un audit juridique : il classe des
     * references, cite des articles et conclut. Sans le refus ecrit, un lecteur presse le prend pour
     * la validation elle-meme — et l'application ferait autorite la ou elle n'a rien verifie.
     */
    quoi: 'le dossier de relecture se presente comme une validation juridique',
    fichier: 'docs/RELECTURE-JURIDIQUE.md',
    de: "**Ce n'est pas une validation juridique.**",
    vers: '**Validation juridique du référentiel.**',
    construire: '@enr/core',
    tests: ['packages/core/test/relecture-juridique.test.ts'],
    cwd: 'packages/core',
    commande: ['node', '--test', '--experimental-strip-types', 'test/relecture-juridique.test.ts'],
  },

  {
    audit: 'audit 13 (revue complete)',
    /*
     * LE DEFAUT D'ORIGINE, vu sur la capture du tableau de bord : trois graduations figees a 0, la
     * moitie et le maximum, chaque libelle arrondi. Sur un portefeuille d'UN lead — l'etat du
     * premier jour — `Math.round(0.5)` vaut 1, et l'axe affichait 1, 1, 0 : le meme nombre a deux
     * hauteurs, un point valant 1 lisible aussi bien au sommet qu'au milieu.
     *
     * LE MOTIF VISE LE PLANCHER, et non la branche des petits comptages, parce que c'est lui qui
     * porte encore quelque chose. La premiere version de ce motif cassait `haut <= 3` et SURVIVAIT
     * — un `new Set` rattrapait le doublon derriere. Les deux protections se couvraient l'une
     * l'autre sans qu'aucune soit necessaire ; le Set a ete retire, et ce qui reste se mesure. Sans
     * le plancher, un portefeuille VIDE replie l'axe sur la seule graduation 0 et le graphique perd
     * son cadre le jour ou il est le plus regarde : le premier.
     */
    quoi: 'l’axe du graphique d’activite perd son cadre sur un portefeuille vide',
    fichier: 'apps/web/src/components/TableauDeBord.tsx',
    de: '  const haut = Math.max(1, Math.round(maxi));',
    vers: '  const haut = Math.round(maxi);',
    cwd: 'apps/web',
    tests: ['test/rendu-liste-tableau.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * DEUX ZONES D'UNE MEME COMMUNE REDEVIENNENT UN DOUBLON APPARENT. Le titre d'une carte est le
     * nom de la commune, et une commune en designe souvent plusieurs : sans le rang, la liste
     * affiche « Écrosnes (28) » deux fois, a des places eloignees, avec des surfaces differentes et
     * rien pour dire que ce sont deux zones. Aucun autre champ ne les separe — 7 664 zones pour
     * 448 noms distincts sur la base de bout en bout.
     */
    quoi: 'deux zones d’une meme commune se relisent comme un doublon d’affichage',
    fichier: 'apps/web/src/components/PanneauZones.tsx',
    de: '    if (ids.length < 2) continue;',
    vers: '    if (ids.length < 999) continue;',
    cwd: 'apps/web',
    tests: ['test/rendu-zones.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LE CATALOGUE DES CONNECTEURS RESSORT DU GARDE D'ORTHOGRAPHE. Ses champs `nom` et
     * `avertissement` sont servis a l'interface par `sourceRef()` : ils s'affichent sous chaque
     * critere de la fiche, dans le panneau des calques et dans le dossier PDF. Hors perimetre, ils
     * portaient 28 fautes d'accent lues par l'operateur a longueur de journee.
     */
    quoi: 'le catalogue des connecteurs ressort du perimetre du garde d’orthographe',
    fichier: 'apps/web/test/orthographe-affichee.test.ts',
    de: "  'apps/api/src/connecteurs/base.ts',\n];",
    vers: '];',
    cwd: 'apps/web',
    tests: ['test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LE BALAYAGE ORTHOGRAPHIQUE REDEVIENT MUET. Son perimetre est lu dans la liste du garde ; sans
     * le retrait des commentaires, les apostrophes francaises de ces commentaires passent pour des
     * chemins de module et le script meurt sur un ENOENT, APRES une sortie qui ressemble a un
     * succes. Un outil de recherche en panne ne rend pas d'erreur utile : il rend zero faute.
     */
    quoi: 'le balayage orthographique reprend les apostrophes des commentaires pour des chemins de module',
    fichier: 'scripts/orthographe-dictionnaire.mjs',
    de: "  const sansCommentaires = bloc[1].replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\/\\/[^\\n]*/g, '');",
    vers: '  const sansCommentaires = bloc[1];',
    tests: ['apps/web/test/garde-balayage-orthographe.test.ts'],
    cwd: 'apps/web',
    commande: ['tsx', '--test', 'test/garde-balayage-orthographe.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * UNE COUVERTURE ANNONCEE SUR UNE CIBLE VIDE CESSE D'ETRE VUE. `couverture_ingestion` est la
     * table sur laquelle le moteur s'appuie pour separer « aucune contrainte trouvee ici » de « on
     * n'a rien regarde ici ». Mesure sur la base de bout en bout : elle annoncait 2 830 postes
     * sources sur 101 departements quand `poste_source` etait vide. Une ligne de couverture qui
     * survit a la disparition de ses donnees fait dire « regarde, rien trouve » — un feu vert — la
     * ou il n'y a rien : le defaut C1 de l'audit 8, reouvert par une autre porte.
     *
     * La mutation rend le garde aveugle en inversant sa condition : il ne signale plus que les
     * couvertures dont la cible EXISTE, c'est-a-dire les saines.
     */
    quoi: 'une couverture annoncee sur une table vide cesse d’etre signalee',
    fichier: 'apps/api/src/depots/sources.ts',
    de: '    if (presence?.existe === false) {',
    vers: '    if (presence?.existe === true) {',
    cwd: 'apps/api',
    tests: ['test/couverture-sans-donnee.test.ts'],
    commande: ['tsx', '--test', '--test-concurrency=1', 'test/couverture-sans-donnee.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LA CARTE CESSE DE SUIVRE LE THEME DU RESTE DE L'ECRAN. Le reglage a trois valeurs, et la
     * regle est ecrite deux fois : une en CSS, une en TypeScript, parce que MapLibre peint ses
     * tuiles dans un canevas et que l'assombrissement du fond se regle en JavaScript. La mutation
     * retire l'exclusion du forcage en clair — `:root:not([data-theme='clair'])` — et la carte
     * s'assombrit alors sous un habillage clair, sur les seuls postes dont le systeme est sombre.
     * Rien ne plante, aucun type ne bronche, et le defaut ne se voit que chez la moitie des gens.
     */
    quoi: 'la carte s’assombrit sous un habillage clair quand le systeme est sombre',
    fichier: 'apps/web/src/utils/theme.ts',
    de: "  if (theme === 'clair') return false;",
    vers: '  // mutation : le forcage en clair ne protege plus rien',
    cwd: 'apps/web',
    tests: ['test/theme-carte.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * L'OPERATEUR CESSE D'ETRE AVERTI QU'UNE COUCHE EST ANNONCEE SANS DONNEES. Le controle
     * resterait dans `GET /api/sante` — mais une sonde de deploiement est lue par qui deploie, pas
     * par qui prospecte. Celui qui decide verrait une absence de contrainte la ou il n'y a aucune
     * donnee, sans rien a l'ecran pour le lui dire.
     */
    quoi: 'le bandeau cesse de dire qu’une couche est annoncee sans donnees',
    fichier: 'apps/web/src/components/BandeauAvertissements.tsx',
    de: '  const incoherentes = couverturesIncoherentes.length > 0;',
    vers: '  const incoherentes = false;',
    cwd: 'apps/web',
    tests: ['test/rendu-bandeau.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * UN SEUL MOIS DE DONNEES CESSE DE SE VOIR. Avec un seul releve, le pas horizontal vaut 0 et
     * le chemin se reduit a un « M » sans « L » : SVG ne trace pas un segment de longueur nulle.
     * Sans les points, le graphique rend alors un cadre vide avec ses graduations — exactement ce
     * que rend un portefeuille SANS activite. Deux etats opposes rendus a l'identique.
     */
    quoi: 'un releve unique redevient invisible sur le graphique d’activite',
    fichier: 'apps/web/src/components/TableauDeBord.tsx',
    de: "        {(['nouveaux', 'securises'] as const).map((cle) =>",
    vers: "        {([] as const).map((cle: 'nouveaux' | 'securises') =>",
    cwd: 'apps/web',
    tests: ['test/rendu-liste-tableau.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LA LISTE REDIT « SCORE FAIBLE » POUR UNE PARCELLE TROP PETITE. Le rouge a trois causes ; la
     * pastille n'en nommait que deux. Mesure : la parcelle 0C 0843 affichait « Score faible » a
     * cote d'un score de 72,7, pendant qu'une voisine a 70,3 affichait « Sous conditions ». Le
     * defaut B1 de l'audit 7 sous une autre forme — la fiche le dit, la liste ne le remonte pas.
     */
    quoi: 'la liste redit « score faible » pour une parcelle ecartee sur sa taille',
    fichier: 'apps/web/src/utils/affichage.ts',
    de: "  if (statutScore === 'rouge' && limiteViabilite) {",
    vers: "  if (false && statutScore === 'rouge' && limiteViabilite) {",
    cwd: 'apps/web',
    tests: ['test/rendu-liste-tableau.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LE DEFAUT REPRODUIT TEL QUEL. Le garde comparait des squelettes EXACTS : « regardes » et
     * « regardé » n'en faisaient pas un seul, et accentuer le singulier quelque part ne disait
     * rien du pluriel ailleurs. Quatre fautes vivaient dans cet angle mort, toutes dans du texte
     * affiche — « ces enjeux n'ont pas été regardes », « Propriétaires estimes », « coûts de
     * chantier majores », « (300 affiches) ».
     *
     * CE MOTIF REMET LA FAUTE, plutot que de casser la regle qui la detecte. Un motif qui retire
     * la regle est bien attrape, mais par le test de VIVACITE des exceptions — celles des pluriels
     * ne couvriraient plus rien — c'est-a-dire pour une raison de comptabilite interne, sans
     * prouver que le garde protege un texte lu. Remettre la faute le prouve.
     */
    quoi: 'un participe pluriel reperd son accent dans du texte affiche',
    fichier: 'packages/scoring/src/index.ts',
    de: "        `ne peut être déclarée propice tant que ces enjeux n'ont pas été regardés.`,",
    vers: "        `ne peut être déclarée propice tant que ces enjeux n'ont pas été regardes.`,",
    cwd: 'apps/web',
    tests: ['test/orthographe-affichee.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LA COLONNE « TRACE ESTIME » REDEVIENT MUETTE QUAND ELLE EST VIDE. Sur un territoire sans
     * postes ingeres, elle rend « — » sur chaque ligne et sert de clef de tri : cliquer son
     * en-tete ne change rien, sans un mot. Deux causes produisent le meme tiret — couche non
     * ingeree, parcelle non requalifiee — et aucune n'est « aucun poste a proximite ».
     */
    quoi: 'une cellule de trace estime vide cesse de dire pourquoi elle l’est',
    fichier: 'apps/web/src/components/VueListe.tsx',
    de: "                        ? 'Distance au poste source non renseignée : soit la couche des postes ' +",
    vers: '                        ? undefined && (',
    cwd: 'apps/web',
    tests: ['test/rendu-liste-tableau.test.ts'],
  },
  {
    audit: 'audit 13 (revue complete)',
    /*
     * LE TABLEAU DE BORD REDIT « Donnees manquantes 301 » SANS DIRE LESQUELLES. Mesure : le seuil
     * de grisement vaut 80 % de couverture ; le BESS plafonne a 78,2 % sur les 301 parcelles, et
     * un seul critere — la capacite residuelle du poste source — porte 16,4 % du poids. Il a
     * fallu quatre requetes SQL pour l'etablir : personne ne l'etablirait depuis l'interface.
     */
    quoi: 'le tableau de bord cesse de dire ce qui manque aux parcelles grises',
    fichier: 'apps/web/src/components/TableauDeBord.tsx',
    de: '  if (nbGrises === 0 || criteres.length === 0) return null;',
    vers: '  return null;',
    cwd: 'apps/web',
    tests: ['test/rendu-liste-tableau.test.ts'],
  },
];

/**
 * FILET CONTRE L'INTERRUPTION, ajoute apres un incident reel.
 *
 * Le `finally` de la boucle restaure le fichier mute — sauf si le processus est TUE avant d'y
 * arriver. C'est arrive : une execution arretee par un depassement de delai a laisse
 * `scripts/portable/animation.mjs` avec deux mutations encore appliquees. Symptome a
 * l'execution suivante : « motif introuvable » sur ces deux entrees, c'est-a-dire un message
 * qui accuse le CODE d'avoir change alors que c'est l'outil qui l'avait abime. Sans relecture
 * attentive, un fichier volontairement casse partait au commit.
 *
 * Une copie de sauvegarde est donc ecrite sur le disque AVANT chaque mutation et effacee
 * apres. Si elle existe au demarrage, c'est qu'une execution precedente a ete interrompue :
 * on restaure, on le dit, et on continue.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE BLOC EST TOUT EN HAUT, ET PAS APRES L'ANALYSE DE LA LIGNE DE COMMANDE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Il y etait, et le filet ne servait a rien dans le seul cas ou on en a besoin. L'audit 11 l'a
 * montre a l'execution : une campagne tuee par un depassement de delai avait laisse
 * `scripts/portable/amorce.mjs` mute et le marqueur en place ; l'execution suivante — un
 * `--filtre` qui ne correspondait a rien, exactement ce qu'on tape pour rejouer l'entree
 * interrompue — sortait sur `process.exit(1)` AVANT d'atteindre la restauration. Le fichier
 * restait casse, et l'outil n'en disait pas un mot.
 *
 * La regle qui en decoule : une reparation d'etat ne se place jamais derriere une porte de
 * sortie. Elle vient avant tout ce qui peut terminer le processus.
 */
const SAUVEGARDE = '.mutation-en-cours';

function restaurerApresInterruption() {
  if (!existsSync(SAUVEGARDE)) return;
  let marqueur;
  try {
    marqueur = JSON.parse(readFileSync(SAUVEGARDE, 'utf8'));
  } catch (erreur) {
    /**
     * Le marqueur lui-meme peut etre tronque : le processus peut mourir PENDANT son ecriture.
     * On ne sait alors plus quel contenu restaurer, et l'aveu vaut mieux qu'une exception
     * brute — qui laisserait l'utilisateur devant une pile d'appels sans savoir qu'un fichier
     * de son depot est volontairement casse.
     */
    console.error(
      `${SAUVEGARDE} est illisible (${erreur.message}).\n` +
        'Une execution precedente a ete interrompue et la restauration automatique est ' +
        'impossible.\nControlez le depot a la main : `git status` puis `git checkout -- ' +
        '<fichier>`, et supprimez ' +
        `${SAUVEGARDE}.`,
    );
    process.exit(1);
  }
  const { fichier, contenu } = marqueur;
  writeFileSync(fichier, contenu);
  rmSync(SAUVEGARDE);
  console.log(
    `Execution precedente interrompue : ${fichier} a ete restaure avant de continuer.\n`,
  );
}

restaurerApresInterruption();

/**
 * Filtre optionnel : `node scripts/mutation.mjs --filtre "audit 11"`.
 *
 * La liste depasse la trentaine d'entrees et l'execution complete demande une quinzaine de minutes.
 * Sans moyen de rejouer un sous-ensemble, la tentation est de muter a la main pendant le
 * developpement — ce qui a deja laisse deux fois un fichier source mute apres une interruption
 * (audit 10, §H2). Le filtre supprime la tentation ; la CI, elle, continue de tout executer.
 */
const iFiltre = process.argv.indexOf('--filtre');
const filtre = iFiltre >= 0 ? (process.argv[iFiltre + 1] ?? '') : null;
const avecE2e = process.argv.includes('--avec-e2e');
/**
 * `--e2e-seulement` : ne jouer QUE les motifs de bout en bout.
 *
 * POURQUOI CE DRAPEAU EXISTE, audit 13. Les neuf motifs de bout en bout sont exclus par defaut
 * faute de navigateur, et ils n'avaient donc jamais ete joues dans ce depot. Pour les jouer, il
 * fallait ou bien les appeler UN PAR UN — `--filtre` porte sur `audit + quoi + fichier`, et les
 * neuf n'ont aucune chaine commune —, ou bien lancer la campagne entiere. C'est la difference
 * entre une verification qu'on fait et une qu'on remet : les neuf se jouent en une vingtaine de
 * minutes, la campagne complete en trois quarts d'heure a plusieurs heures selon la machine.
 */
const e2eSeulement = process.argv.includes('--e2e-seulement');
const candidates = e2eSeulement
  ? MUTATIONS.filter((m) => m.e2e)
  : filtre || avecE2e
    ? MUTATIONS
    : MUTATIONS.filter((m) => !m.e2e);
const ecartees = MUTATIONS.length - candidates.length;
const A_JOUER = filtre
  ? candidates.filter((m) => `${m.audit} ${m.quoi} ${m.fichier}`.toLowerCase().includes(filtre.toLowerCase()))
  : candidates;
/*
 * LE MESSAGE DIT CE QUI A ETE ECARTE, ET NON L'INVERSE. Ecrit pour le seul cas par defaut, il
 * annoncait « 289 mutations de bout en bout ecartees » sous `--e2e-seulement`, alors que ce sont
 * les 289 AUTRES qui le sont. Un perimetre reduit annonce a l'envers est pire qu'un perimetre
 * reduit en silence : il donne une fausse assurance.
 */
if (ecartees > 0) {
  console.log(
    e2eSeulement
      ? `${ecartees} mutation(s) hors bout en bout ecartee(s) : --e2e-seulement ne joue que ` +
          'les motifs qui exigent un navigateur.\n'
      : `${ecartees} mutation(s) de bout en bout ecartee(s) : elles exigent un navigateur. ` +
          'Lancez `node scripts/mutation.mjs --avec-e2e` pour toute la campagne, ou ' +
          '`--e2e-seulement` pour ces seules mutations.\n',
  );
}

/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LE MOTIF DES MUTATIONS ECARTEES EST VERIFIE QUAND MEME
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TROIS FOIS DE SUITE j'ai livre une mutation dont le motif ne se trouvait plus, et les trois
 * fois c'est l'integration continue qui l'a dit — jamais la machine de developpement. La cause
 * est toujours la meme : les mutations de bout en bout exigent un navigateur, donc un
 * `node scripts/mutation.mjs` ordinaire les ECARTE, donc leurs motifs ne sont JAMAIS confrontes
 * au code avant le `git push`. La CI, elle, les joue.
 *
 * Or verifier qu'un motif existe encore ne demande AUCUN navigateur : c'est une recherche de
 * chaine dans un fichier. Seule l'execution du test en a besoin.
 *
 * ET LE CONTROLE PORTE SUR TOUTES LES MUTATIONS, pas seulement sur les ecartees — parce que la
 * premiere version de ce garde, restreinte aux ecartees, a laisse passer le cas suivant le jour
 * meme : une passe de correction du texte a invalide le motif d'une mutation ORDINAIRE, et la
 * campagne l'a signale au bout de vingt minutes, une fois arrivee a elle. Le motif de chaque
 * mutation est verifie avant d'en jouer une seule : une lecture de fichier par mutation, contre
 * vingt minutes pour apprendre qu'il fallait corriger une ligne.
 */
const ECARTEES = candidates === MUTATIONS ? [] : MUTATIONS.filter((m) => m.e2e);
let motifsPerdus = 0;
for (const m of MUTATIONS) {
  if (readFileSync(m.fichier, 'utf8').includes(m.de)) continue;
  const jouee = A_JOUER.includes(m);
  console.error(`ECHEC (${m.audit}) : motif introuvable dans ${m.fichier}.`);
  console.error(`  « ${m.quoi} »`);
  console.error(
    jouee
      ? '  Le code a change : mettez la mutation a jour, ou retirez-la si l\'invariant a disparu.'
      : "  Cette mutation n'est meme pas jouee ici (navigateur requis ou filtre), mais son motif " +
        'se verifie sans : il a change, et la CI la jouera.',
  );
  console.error(`  Motif attendu :\n${m.de}\n`);
  motifsPerdus += 1;
}
if (motifsPerdus === 0) {
  // Un controle silencieux est un controle dont on ne sait pas s'il a tourne.
  console.log(`Les ${MUTATIONS.length} motifs de mutation s'appliquent tous au code actuel.\n`);
} else {
  console.error(
    `${motifsPerdus} mutation(s) ne s'appliquent plus au code. Corrigez-les avant de livrer : ` +
      'la CI les joue, elle.',
  );
  // ARRET IMMEDIAT, et non a la fin. La campagne dure vingt minutes ; ces motifs doivent etre
  // corriges puis la campagne relancee de toute facon, donc jouer les cent autres mutations
  // avant d'annoncer l'echec ne renseigne sur rien et coute le temps qui fait qu'on ne la
  // relance pas. Le message ci-dessus dit deja tout ce qu'il y a a savoir.
  process.exit(1);
}
if (filtre) {
  console.log(`Filtre « ${filtre} » : ${A_JOUER.length} mutation(s) sur ${MUTATIONS.length}.\n`);
  if (A_JOUER.length === 0) process.exit(1);
}

let echecs = 0;
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN TEST QUI NE S'EST PAS EXECUTE N'EST PAS UN TEST DECORATIF
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Les suites qui demandent une base s'IGNORENT ELLES-MEMES sans `DATABASE_URL`. Ce lanceur
 * concluait alors « ne fait echouer AUCUN test — les tests sont donc decoratifs sur ce point », ce
 * qui est faux, et faux dans le sens qui use la confiance : on part relire un test parfaitement
 * bon. C'est le defaut que cet outil traque, retourne contre lui. Constate sur la mutation « le
 * dossier ne dit plus qu'un atout n'entre pas dans le verdict » : signalee decorative sans base,
 * attrapee avec.
 *
 * DEUX DETECTIONS ONT ETE ESSAYEES, ET LA PREMIERE NE MARCHAIT PAS. Compter « # pass 0 » semblait
 * evident — et c'est faux : ces suites ne se declarent pas `skipped`, elles RETOURNENT tot. Le
 * fichier affiche donc « # pass 13 » en n'ayant rien verifie. Un signal plausible et vide, soit
 * exactement ce que ce fichier existe pour debusquer.
 *
 * LA DETECTION RETENUE NE DEVINE RIEN : elle lit la liste de `test:base`, qui EST la definition de
 * « ce qui demande une base ». Une suite ajoutee la-bas devient automatiquement connue ici, sans
 * qu'aucune declaration parallele ne soit a tenir en phase.
 */
const TESTS_AVEC_BASE = (() => {
  const paquet = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
  const script = paquet.scripts?.['test:base'] ?? '';
  return new Set(
    [...script.matchAll(/test\/[\w.-]+\.test\.ts/g)].map((m) => `apps/api/${m[0]}`),
  );
})();

/** La mutation ne peut-elle etre mesuree que sur une base peuplee ? */
function exigeUneBase(m) {
  return (m.tests ?? []).some((t) => TESTS_AVEC_BASE.has(t));
}

for (const m of A_JOUER) {
  const original = readFileSync(m.fichier, 'utf8');
  if (!original.includes(m.de)) {
    console.error(`\nECHEC (${m.audit}) : motif introuvable dans ${m.fichier}.`);
    console.error(`  Le code a change : mettez la mutation a jour, ou retirez-la si l'invariant a disparu.`);
    console.error(`  Motif attendu : ${m.de}`);
    echecs += 1;
    continue;
  }
  writeFileSync(SAUVEGARDE, JSON.stringify({ fichier: m.fichier, contenu: original }));
  writeFileSync(m.fichier, original.replace(m.de, m.vers));
  let attrapee = false;
  try {
    /*
     * UNE ETAPE AVANT LA CONSTRUCTION, pour les sources qui en GENERENT d'autres.
     *
     * `scripts/referentiel-contraintes.mjs` produit `contraintes-referentiel.ts` : muter
     * l'extracteur ne change rien tant qu'on ne l'a pas rejoue, et la mutation passerait en
     * signalant a tort un test decoratif. C'est la meme raison que `construire`, un cran plus
     * haut dans la chaine.
     */
    if (m.avant) execFileSync(m.avant[0], m.avant.slice(1), { stdio: 'pipe' });
    // Les paquets sont consommes construits : sans cette etape, muter la source ne change rien au
    // code execute par les tests, et la mutation passe en signalant a tort un test decoratif.
    if (m.construire) {
      execFileSync('npm', ['run', 'build', '--workspace', m.construire], { stdio: 'pipe' });
    }
    const argv = m.commande ?? ['tsx', '--test', ...m.tests];
    execFileSync('npx', argv, {
      stdio: 'pipe',
      ...(m.cwd ? { cwd: m.cwd } : {}),
    });
  } catch {
    attrapee = true;
  } finally {
    writeFileSync(m.fichier, original);
    /*
     * SYMETRIQUE, ET C'EST INDISPENSABLE. Restaurer l'extracteur ne restaure pas le fichier qu'il
     * a genere : `contraintes-referentiel.ts` resterait mute dans l'arbre de travail, et toutes
     * les mutations suivantes — comme les tests lances ensuite — porteraient sur un referentiel
     * faux. Le rejouer remet le fichier genere en accord avec la source restauree.
     */
    if (m.avant) execFileSync(m.avant[0], m.avant.slice(1), { stdio: 'pipe' });
    // Restaurer la source ne suffit pas : le `dist/` mute survivrait a l'execution et fausserait
    // toutes les mutations suivantes, ainsi que les tests lances ensuite.
    if (m.construire) {
      execFileSync('npm', ['run', 'build', '--workspace', m.construire], { stdio: 'pipe' });
    }
    rmSync(SAUVEGARDE, { force: true });
  }
  if (attrapee) {
    console.log(`OK   (${m.audit}) ${m.quoi}`);
  } else if (exigeUneBase(m) && !process.env['DATABASE_URL']) {
    console.error(`\nNON MESUREE (${m.audit}) : « ${m.quoi} ».`);
    console.error(
      `  ${m.tests.join(', ')} figure dans « test:base » : sans DATABASE_URL, la suite se retourne\n` +
        "  tot sans rien verifier. Le motif n'a donc PAS ete mesure. Relancez avec une base :\n" +
        '    DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e node scripts/mutation.mjs',
    );
    echecs += 1;
  } else {
    console.error(`\nECHEC (${m.audit}) : « ${m.quoi} » ne fait echouer AUCUN test.`);
    console.error(`  Les tests ${m.tests.join(', ')} sont donc decoratifs sur ce point.`);
    echecs += 1;
  }
}

console.log(`\n${A_JOUER.length - echecs}/${A_JOUER.length} mutations attrapees.`);

/**
 * LA MENTION DES ECARTEES EST REPETEE ICI, et ce n'est pas de la redondance.
 *
 * Elle est deja affichee au debut. Mais une campagne dure vingt minutes : le debut a defile
 * depuis longtemps quand le resultat s'affiche, et c'est cette DERNIERE ligne qu'on lit, qu'on
 * copie dans un message de livraison et qu'on presente comme la preuve. « 105/105 » sans
 * qualificatif se lit « tout est verifie » — alors que trois mutations n'ont pas ete jouees.
 * Le chiffre doit donc porter sa propre limite.
 */
if (ECARTEES.length > 0) {
  console.log(
    `Ce chiffre ne couvre PAS ${ECARTEES.length} mutation(s) de bout en bout sur ` +
      `${MUTATIONS.length} : elles exigent un navigateur et n'ont pas ete jouees. ` +
      'Leur motif, lui, vient d\'etre confronte au code.\n' +
      'Pour les jouer : `node scripts/mutation.mjs --avec-e2e` (base semee + navigateur requis).',
  );
}
process.exit(echecs > 0 || motifsPerdus > 0 ? 1 : 0);
