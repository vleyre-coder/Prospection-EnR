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
const candidates = filtre || avecE2e ? MUTATIONS : MUTATIONS.filter((m) => !m.e2e);
const ecartees = MUTATIONS.length - candidates.length;
const A_JOUER = filtre
  ? candidates.filter((m) => `${m.audit} ${m.quoi} ${m.fichier}`.toLowerCase().includes(filtre.toLowerCase()))
  : candidates;
if (ecartees > 0) {
  console.log(
    `${ecartees} mutation(s) de bout en bout ecartee(s) : elles exigent un navigateur. ` +
      'Lancez `node scripts/mutation.mjs --avec-e2e` pour les inclure.\n',
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
    // Restaurer la source ne suffit pas : le `dist/` mute survivrait a l'execution et fausserait
    // toutes les mutations suivantes, ainsi que les tests lances ensuite.
    if (m.construire) {
      execFileSync('npm', ['run', 'build', '--workspace', m.construire], { stdio: 'pipe' });
    }
    rmSync(SAUVEGARDE, { force: true });
  }
  if (attrapee) {
    console.log(`OK   (${m.audit}) ${m.quoi}`);
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
