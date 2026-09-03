# Audit 11 — l'intégration continue était rouge, et je disais le contraire

## 0. Le fait le plus important de cet audit

**Les trois jobs de la CI échouaient sur `0e15643`, et sur les sept livraisons précédentes.**
Runs 29 à 36 : `failure`, `failure`, `failure`, `failure`, `failure`, `failure`, `failure`,
`failure`.

Pendant ce temps j'annonçais « API 468 tests / 464 passent / 0 échec, typecheck propre » — des
chiffres exacts, obtenus localement, et qui ne prouvaient rien. Deux raisons, toutes deux de ma
responsabilité :

1. **je ne suis jamais allé regarder la CI.** Aucun des audits précédents ne l'a fait. C'est le
   seul endroit où le projet se vérifie sur une machine qui n'est pas la mienne, et il était
   ignoré ;
2. **ma base locale de référence, `enr_test`, est polluée** par des mois d'exécutions. Les
   tests qui dépendaient de données laissées par des exécutions antérieures y passaient. Sur une
   base fraîchement migrée, ils échouent.

Un rapport vert produit sur un banc d'essai qui ment est pire qu'aucun rapport : il autorise la
livraison. C'est la même famille de fautes que celle que ces audits corrigent depuis dix
itérations — **affirmer plus que ce que la mesure permet** — appliquée cette fois à mon propre
travail de vérification.

---

## 1. Ce qui rendait chaque job rouge

### Job « Typage, construction et tests » — la suite unitaire n'a pas tourné depuis huit livraisons

L'étape `Verifier le typage` était placée **avant** `Construire`. Or `apps/web` et `apps/api`
importent `@enr/core` et `@enr/scoring` par leurs types déclarés, c'est-à-dire par les
`dist/*.d.ts` de ces paquets. Sans construction préalable :

```
src/store/etat.ts(9,31): error TS2307: Cannot find module '@enr/core' or its corresponding type declarations.
```

…suivi d'une trentaine d'erreurs en cascade. Le job s'arrêtait là, et **les étapes `Construire`
et `Tester` étaient sautées**. Le tableau de bord affichait « typage en échec » ; la réalité était
que la suite unitaire complète — 724 tests — n'avait pas été exécutée en CI depuis huit
livraisons.

**Corrigé** : `Construire` passe avant `Verifier le typage`.

### Job « Migrations SQL et calculs PostGIS » — une course entre fichiers de test

Treize fichiers de test écrivent dans la même base et se partagent le **département fictif 99** :
la commune 99001, l'espace des IDU `99001000AA…`. Plusieurs commencent et finissent par un
ménage du genre `DELETE FROM parcelle WHERE code_departement = '99'`. Or `node --test` exécute
les **fichiers** en parallèle, dans des processus distincts : le ménage de l'un efface la
population de l'autre en pleine exécution.

Mesures, mêmes fichiers, même base neuve, un drapeau d'écart :

| | résultat | reproductible ? |
|---|---|---|
| en parallèle, exécution 1 | 51/57 | non |
| en parallèle, exécution 2 | 75/77 | non — **les tests en échec changent** |
| en série | 57/57 puis 77/77 | oui |

Le fait que les tests en échec changent d'une exécution à l'autre est la signature d'une course,
et c'est ce qui faisait ressembler la CI à une panne différente chaque fois.

**Le prix de la sérialisation a été mesuré, parce qu'un choix de conception se paie : 44 s contre
34 s sur les treize fichiers. Dix secondes.** Il n'existait donc aucun argument de vitesse pour
conserver la course — et le diagnostic « c'est le parallélisme », posé lors de la livraison
précédente puis laissé en l'état, n'avait aucune excuse.

**Corrigé** : un script `test:base` qui sérialise, le drapeau `--test-concurrency=1` sur les
quatre étapes de CI concernées, et surtout deux gardes, parce que le drapeau vit dans une
commande, donc loin des tests qui en dépendent :

- un **refus à l'exécution** : un fichier du territoire partagé lancé en parallèle avec une base
  s'arrête net et nomme la commande à utiliser ;
- un **garde structurel** (`test/serialisation-base.test.ts`) qui lit le répertoire de tests,
  `package.json` et `.github/workflows/ci.yml`, et exige que tout fichier touchant le territoire
  partagé figure dans les deux listes. C'est la protection contre le défaut qui a laissé 22
  tests rouges sans que personne le sache à la livraison précédente : une liste tenue à la main
  se périme en silence.

### Job « Tests de bout en bout » — non reproduit, et je le dis

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4180/
  [setup] › e2e/connexion.setup.ts:25:1 › connexion unique, session conservee
  1 failed, 19 did not run
```

Le serveur web de prévisualisation n'a jamais répondu, en douze secondes — donc sans atteindre
aucun des délais configurés (120 s pour l'API, 180 s pour le web).

**Je n'ai pas reproduit cet échec** : ici la suite passe, 18 réussis / 2 ignorés en 47,7 s, y
compris avec `CI=1` (qui met `reuseExistingServer` à `false`, la seule différence de
configuration que j'aie identifiée). Je n'ai pas d'explication mesurée, et je ne vais pas en
inventer une. Le prochain passage de CI, avec les deux autres jobs réparés, produira un rapport
frais sur lequel travailler.

---

## 2. Défauts trouvés hors CI, tous mesurés

### A. Mon propre filet de sécurité était troué (`scripts/mutation.mjs`)

L'outil de mutation casse un fichier source, lance les tests, puis le restaure. À la livraison
précédente j'avais ajouté un marqueur `.mutation-en-cours` pour réparer après une interruption.
Il ne servait à rien dans le seul cas où on en a besoin : la restauration était placée **après**
l'analyse de la ligne de commande, donc après le `process.exit(1)` qui sanctionne un `--filtre`
sans correspondance — exactement la commande qu'on tape pour rejouer l'entrée interrompue.

Constaté à l'exécution : campagne tuée par un dépassement de délai, `scripts/portable/amorce.mjs`
resté muté, marqueur en place, et l'outil sortant **sans un mot**.

Règle retenue : *une réparation d'état ne se place jamais derrière une porte de sortie*. Ajouté
aussi : un marqueur illisible (processus tué pendant son écriture) est avoué et renvoie vers
`git status`, au lieu de lever une pile d'appels.

### B. `npm test` sans base ne pouvait pas passer — un défaut d'ordre dans une route

La CI lance `npm test` **sans** `DATABASE_URL`. Le test C7 (« un paramètre numérique malformé
produit 400, et jamais 500 ») échouait, et le fichier annonce en tête que « les cas ci-dessous
s'arrêtent avant tout accès à la base ».

Sondage des cinq routes, une par une, sans base :

| route | `?param=abc` sans base |
|---|---|
| `/api/carte/parcelles` (`limite`) | **400** |
| `/api/carte/parcelles` (`surfaceMin`) | **400** |
| `/api/carte/couche/...` (`limite`) | **400** |
| `/api/leads` (`limite`) | **400** |
| `/api/carte/postes-sources` (`rayonKm`) | **500** |

`nombreRequete(q.rayonKm, …)` était appelé une centaine de lignes après l'interrogation de
`poste_source`. Le refus arrivait bien, avec le bon code, mais **après avoir fait travailler la
base pour rien** — et sans base, le 500 remplaçait le 400 attendu. Le test accusait alors la
validation d'un défaut qui était un défaut d'ordre.

**Corrigé** : la validation passe en tête de route. Deux erreurs du test lui-même ont été
corrigées au passage : il rangeait `'  '` parmi les valeurs « absentes » (la route la refuse en
400, vérifié), et il exigeait « jamais 500 » y compris pour la valeur vide, qui interroge
nécessairement la base.

### C. `/api/sante` mentait sur l'application de bureau, et prescrivait la panne

Mesuré sur deux serveurs réellement lancés :

| configuration | `/api/sante` | route protégée |
|---|---|---|
| `AUTH_DESACTIVEE` + `MODE_BUREAU`, `HOTE=127.0.0.1` | `hors_service` | **200** |
| après correction | `ok` | 200 |
| `AUTH_DESACTIVEE` + `MODE_BUREAU`, `HOTE=0.0.0.0` | `hors_service` | 500 |

La sonde annonçait donc une panne totale à la seconde où les routes utiles répondaient. Et le
message ne se contentait pas d'être faux, il **prescrivait la panne** :

> AUTH_DESACTIVEE est actif en production : toutes les routes protegees repondent en erreur.
> **Retirez cette variable.**

Retirer `MODE_BUREAU`, c'est exactement ce qui fait rendre 500 à toutes les routes utiles de
l'application de bureau. Un fichier de diagnostic qui conseille de casser l'application est plus
nuisible qu'un silence.

Cause : le crochet `onRequest` connaissait l'exception `MODE_BUREAU`, la sonde ne la connaissait
pas. Deux lecteurs d'une même règle, deux verdicts.

**Corrigé** : les deux lisent désormais la même fonction. Le calcul est sorti de la route dans
une fonction pure `configurationsFatales()`, testée en quatre cas sans lancer de serveur — il
n'était exercé par aucun test parce qu'il exigeait un serveur avec un environnement préparé.
Ajouté : la sonde signale maintenant le cas réellement dangereux, `MODE_BUREAU` sur un hôte
joignable par le réseau, en nommant l'hôte fautif.

### D. Le port 3000 du lanceur de bureau — le défaut le plus probable chez l'utilisateur

Le lanceur servait l'application sur 3000, écrit en dur, et commençait par demander
`GET http://127.0.0.1:3000/api/sante` : si ça répondait 200, il concluait « l'application était
déjà ouverte ». Or 3000 est l'un des ports les plus disputés d'un poste de travail — Docker, un
serveur de développement, Grafana, n'importe quelle application Electron.

Mesure, avec un service tiers quelconque placé sur 3000 :

```
VERDICT DU LANCEUR : « l'application etait deja ouverte » -> ouvre le navigateur, exit 0
CE QUI REPOND EN REALITE : {"service":"autre-chose"}
```

L'utilisateur double-clique, une page qui n'est pas la sienne s'ouvre, et **l'application ne
démarre jamais**. Aucun message, aucune trace, code de sortie 0 — le pire cas possible pour
quelqu'un qui n'a pas les moyens de diagnostiquer.

**Corrigé**, deux fautes distinctes :
1. la sonde lit la **réponse** et non le seul code HTTP (`estNotreApplication()`) ;
2. le port est **choisi** parmi les libres, comme cela se faisait déjà pour PostgreSQL, et noté
   dans `donnees/port.txt` — sans quoi le second double-clic ne saurait plus où trouver la
   fenêtre à ramener. Le port historique 3000 est sondé en second, pour ne pas démarrer un
   exemplaire par-dessus une installation antérieure à cette correction.

### E. « Detail technique dans donnees\journal.txt » — le fichier ne contenait pas l'erreur

La sortie d'erreur de l'API partait en `inherit`, c'est-à-dire sur une console qui se ferme ; le
journal ne recevait que les lignes de PostgreSQL. L'API est pourtant le composant qui échoue le
plus volontiers — migrations, port, base incomplète. Le message d'échec du lanceur lui-même n'y
était pas écrit non plus. Renvoyer quelqu'un vers un fichier qui ne contient pas la réponse est
une fausse piste, pas une aide.

**Corrigé** : la sortie d'erreur de l'API et l'échec du lanceur, pile comprise, vont dans le
journal.

### F. La fenêtre se fermait avant qu'on puisse lire l'échec

`Prospection-EnR.exe` est une application de console : lancée par un double-clic, Windows lui
alloue une fenêtre et la **détruit** à la fin du processus. Le message d'échec s'affichait puis
disparaissait dans la même seconde. Le lanceur en lot s'en protégeait déjà
(`if errorlevel 1 pause`) — mais c'est l'`.exe` que le raccourci du bureau appelle, donc celui
que tout le monde utilise.

**Corrigé** : une pause bornée, uniquement sur terminal interactif (attendre une touche dans un
tuyau ou en CI bloquerait indéfiniment, ce qui serait un défaut pire), avec un délai maximal —
une fenêtre oubliée retiendrait la base ouverte et son verrou.

### G. Un test qui lisait le texte du code

Le test « la sonde de santé signale une configuration fatale » faisait trois `assert.match` sur
la **source** de la route, dont un sur la chaîne littérale
`config.auth.desactivee && config.env === 'production'`. Conséquences, les deux advenues :

- **il n'a jamais attrapé le défaut C** : vérifier la *présence* d'une condition ne dit rien de
  sa *justesse* ;
- **il a cassé quand le code s'est amélioré** : la condition, déplacée dans une fonction pure et
  testable, ne s'écrivait plus à l'identique. Un test qui s'oppose aux corrections est une
  charge, pas une protection.

**Remplacé** par un test de comportement, avec témoin. `acces-roles.test.ts` contient d'autres
tests par filtrage de source (export Shapefile) : ils relèvent du même reproche et restent à
reprendre.

---

## 3. Ce qui reste, et que je ne masque pas

| # | Sujet | État |
|---|---|---|
| 1 | **Job e2e de la CI** | Échec précis connu (`ERR_CONNECTION_REFUSED` sur 4180), **non reproduit ici**, non expliqué. À reprendre sur le prochain rapport de CI. |
| 2 | **Des tests appellent les vraies API publiques** | `acces-roles.test.ts` et `routes-validation.test.ts` déclenchent `POST /api/qualification/emprise`, soit une qualification RÉELLE — mesuré : 1 082 parcelles trouvées, 300 retenues. Conséquence : `DATABASE_URL=… npm test` a dépassé 9 min 50 s et j'ai dû l'interrompre. Un test ne devrait pas dépendre de la disponibilité d'un service public ni consommer son quota. **Non corrigé.** |
| 3 | **`enr_test`, ma base locale** | Polluée par des mois d'exécutions : c'est elle qui faisait tout paraître vert. Toute vérification future doit partir d'une base fraîchement migrée. |
| 4 | **Le double-clic sous Windows** | Toujours invérifiable depuis Linux. Deux lanceurs sont livrés pour que l'un rattrape l'autre. |
| 5 | **L'archive portable n'a pas été reconstruite** | Le redémarrage du conteneur a effacé `distribution/` et les caches ; la reconstruire demande ~400 Mo de téléchargements. Les corrections D, E et F du lanceur sont couvertes par des tests unitaires ; la séquence complète de lancement n'a pas été remesurée depuis. |
| 6 | **Bruit dans la CI** | Le contrôle de santé du service PostgreSQL se connecte en tant que `root` : `FATAL: role "root" does not exist` toutes les 5 secondes dans le journal du conteneur. Cosmétique, mais c'est la même faute que celle corrigée dans le lanceur — apprendre à ignorer des erreurs fatales de routine. |
| 7 | **Les 23 règles `aValiderParJuriste`** | Toujours en attente d'un juriste. Rien de technique ne peut y suppléer. |

---

## 4. État mesuré à la fin de l'audit

Sur une base **fraîchement migrée** (`enr_neuf`, 15 migrations, 26 tables métier) :

| Vérification | Résultat |
|---|---|
| `npm run build` | propre |
| `npm run typecheck` (après build, comme la CI corrigée) | 0 erreur |
| `npm test` API (sans base, comme la CI) | 479 tests, 471 passent, 0 échec, 8 ignorés |
| `npm run test:base` API (sérialisé, base neuve) | 80 tests, 76 passent, 0 échec, 4 ignorés |
| `npm test` core | 57 / 57 |
| `npm test` scoring | 67 / 67 |
| `npm test` web | 121 / 121 |
| Playwright bout en bout (local) | 18 réussis, 2 ignorés, 47,7 s |
| Campagne de mutation (hors navigateur) | **99 mutations, 99 attrapées, 0 test décoratif** |

## 5. Vérification par mutation

La liste compte désormais **102 entrées**, dont 3 exigent un navigateur. La campagne complète
hors navigateur rend **99 / 99 attrapées** : aucun test décoratif.

La campagne a par ailleurs fait son office sur elle-même. Deux mutations de la famille
`mode bureau` désignaient `apps/api/src/serveur.ts`, où `estBoucleLocale` ne vit plus : elle a
répondu « motif introuvable dans apps/api/src/serveur.ts — le code a changé » au lieu de les
compter comme attrapées. C'est exactement le comportement attendu d'un outil qui refuse de
s'auto-congratuler ; les deux entrées ont été repointées et sont de nouveau attrapées.

La famille `audit 11` compte **11 mutations, 11 attrapées**. Chacune rétablit un des défauts
ci-dessus et doit faire échouer au moins un test :

- la restauration après interruption supprimée ;
- un filtre sans correspondance qui sort en succès ;
- le refus de course qui ne refuse plus rien ;
- le refus calculé puis jeté sans être levé ;
- le rayon de raccordement redevenu un `Number()` non validé, après la requête ;
- la sonde de santé redevenue aveugle au mode bureau ;
- un mode bureau exposé au réseau plus signalé ;
- n'importe quel service sur le port repris pour « notre application déjà ouverte » ;
- un fichier de port abîmé cru sur parole ;
- la pause de lecture qui attend une touche même sans terminal ;
- la fenêtre d'échec qui ne se referme plus jamais.
