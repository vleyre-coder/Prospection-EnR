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

import { readFileSync, writeFileSync } from 'node:fs';
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
 * @type {Array<{ audit: string, quoi: string, fichier: string, de: string, vers: string,
 *                construire?: string, cwd?: string, tests: string[] }>}
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
    de: '  if (!(await disqueEntierementCouvert(TYPE_COUVERTURE_POSTES, pt, plusProche.distance_m))) {\n    return [];\n  }',
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
    de: 'surface minimale indicative de ${ha(min)} ha pour la filiere',
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
    de: "  const liberer = await tenterVerrou(cleVerrouIngestion(connecteur));\n  if (!liberer) {\n    journal.warn({ connecteur }, 'Ingestion refusee : une autre est en cours pour ce connecteur');\n    throw new ErreurIngestionEnCours(connecteur);\n  }",
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
];

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
const A_JOUER = filtre
  ? MUTATIONS.filter((m) => `${m.audit} ${m.quoi} ${m.fichier}`.toLowerCase().includes(filtre.toLowerCase()))
  : MUTATIONS;
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
  writeFileSync(m.fichier, original.replace(m.de, m.vers));
  let attrapee = false;
  try {
    // Les paquets sont consommes construits : sans cette etape, muter la source ne change rien au
    // code execute par les tests, et la mutation passe en signalant a tort un test decoratif.
    if (m.construire) {
      execFileSync('npm', ['run', 'build', '--workspace', m.construire], { stdio: 'pipe' });
    }
    execFileSync('npx', ['tsx', '--test', ...m.tests], {
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
process.exit(echecs > 0 ? 1 : 0);
