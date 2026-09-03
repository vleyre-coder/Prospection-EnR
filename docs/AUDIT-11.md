# Audit 11 — l'intégration continue était rouge, et je disais le contraire

> **Issue de l'audit.** La CI est verte sur les trois jobs au run 40 — pour la première fois de
> l'histoire du dépôt. Tous les chiffres du §4 sont désormais relevés sur la machine de GitHub,
> plus sur la mienne. Neuf défauts ont été trouvés et corrigés, chacun avec sa mesure ; ce qui
> reste est au §3, sans fard.

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

### Job « Migrations SQL et calculs PostGIS » — deux défauts, dont un que j'ai d'abord mal lu

#### a) Une course entre fichiers de test

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

#### b) Le job était silencieusement tronqué par son plafond de durée

Après la correction ci-dessus, ce job restait rouge — et j'ai d'abord annoncé qu'il était vert,
parce que le filtre « jobs en échec » de l'API ne le listait pas. **Il ne l'était pas : il était
`cancelled`.** Un job qui dépasse `timeout-minutes` n'est pas rapporté comme `failure`, il est
rapporté comme annulé — donc il n'apparaît dans aucun filtre d'échecs et se lit comme un incident
d'infrastructure plutôt que comme une vérification qui n'a pas eu lieu.

Mesures sur deux exécutions consécutives, plafond à 10 minutes :

| exécution | durée du job | issue |
|---|---|---|
| run 38 | 10 min 13 s | `The operation was canceled` après **92 mutations sur 101** |
| run 39 | 9 min 37 s | idem |

La campagne de mutation demande à elle seule neuf à dix minutes et grossit à chaque audit. Le
plafond était donc atteint avant sa fin, et **les quatre étapes PostGIS qui suivent n'ont jamais
tourné en CI** — c'est-à-dire précisément les tests que ce job existe pour exécuter.

**Corrigé** : plafond porté à 30 minutes, avec la mesure inscrite à côté. Un plafond de durée est
une sécurité contre un blocage, pas un budget à serrer : le régler au ras de la mesure transforme
la moindre croissance en vérification perdue, sans un mot.

### Job « Tests de bout en bout » — une adresse d'écoute par défaut n'est pas une adresse

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4180/
  [setup] › e2e/connexion.setup.ts:25:1 › connexion unique, session conservee
  1 failed, 19 did not run
```

Douze secondes, et la suite passait chez moi — y compris avec `CI=1`. J'ai d'abord écrit dans ce
document que je n'avais pas d'explication mesurée. Elle tenait à **une ligne** du journal du
runner, quelques centaines de lignes plus haut que le résumé d'échec :

```
[WebServer]   ➜  Local:   http://localhost:4180/
```

`vite preview` s'attache par défaut à **`localhost`**, pas à `127.0.0.1`. Sur le runner GitHub,
`localhost` résout d'abord vers `::1` : le serveur n'écoutait donc **qu'en IPv6**, tandis que les
tests naviguent vers l'adresse IPv4 littérale de `E2E.urlWeb`. D'où un refus de connexion
immédiat. Sur ma machine, `localhost` résout vers `127.0.0.1` — et c'est tout ce qui séparait
« ça marche chez moi » de « rouge depuis huit livraisons ».

**Le second volet est plus insidieux** : la sonde de disponibilité était déclarée par `port`, ce
qui laisse Playwright choisir l'adresse qu'il interroge. Elle était donc **satisfaite** pendant
que le navigateur se faisait refuser la connexion. Une sonde qui n'interroge pas l'adresse que
les tests utilisent ne prouve rien — c'est la même faute de forme que celle du §2.G, vérifier la
présence d'une chose plutôt que la chose elle-même.

**Corrigé** : `--host 127.0.0.1` sur `vite preview`, et `url:` — l'adresse exacte — au lieu de
`port:` pour les deux serveurs. Vérifié : `Local: http://127.0.0.1:4180/`, 18 réussis / 2
ignorés. Un garde (`test/e2e-adresse-ecoute.test.ts`) relit la configuration et exige les deux
propriétés ; il ne lance aucun navigateur, ce qui lui permet de tourner dans la suite unitaire —
c'est-à-dire là où ce défaut aurait été vu huit livraisons plus tôt.

#### Et ce que ce job cachait : un test de bout en bout décoratif

La correction a rendu le job utilisable, et il a immédiatement livré autre chose. La suite
Playwright passe en CI — 18 réussis, 2 ignorés, 40,2 s, sur `http://127.0.0.1:4180/` — puis
l'étape suivante tombe :

```
OK    (bout en bout) les tuiles de calque repartent sans jeton, et leur 401 deconnecte l'utilisateur
ECHEC (bout en bout) : « l'ecran d'ouverture change de parent et son minuteur repart,
                        perdant la touche pressee » ne fait echouer AUCUN test.
1/2 mutations attrapees.
```

`App.tsx` rend `Demarrage` à deux endroits — branche de chargement et branche principale. React
réconcilie par position : si les deux structures ne s'alignent pas, l'élément change de parent au
passage de l'une à l'autre, donc React le **démonte puis le remonte**. Ses minuteurs repartent de
zéro, l'animation recommence au moment même où l'application devient prête, et une touche pressée
avant la transition est perdue. Le défaut est raconté sur vingt lignes de commentaire dans
`App.tsx`, la correction est en place — **et aucun test ne la gardait.** Personne ne pouvait le
savoir : le job mourait avant d'arriver là.

Pourquoi les quatre tests existants ne pouvaient pas le voir : ils observent l'écran *après* la
transition, ou pressent une touche sans se soucier du moment. Or `Demarrage` abrège en appelant
`onTermine` tout de suite — une fois la touche prise en compte, l'écran ne revient jamais,
remontage ou pas. Le symptôme n'existe que **pendant** le chargement.

**Corrigé** par un cinquième test qui retient la réponse de `/api/referentiel` — donc qui se place
à coup sûr dans la phase de chargement — pose un observateur de mutations DOM juste avant la
transition, et exige **zéro apparition** d'un nouvel écran d'accueil. Pas de budget de temps, donc
pas d'intermittence : on affirme la propriété que le correctif établit, et non un symptôme
chronométré. Mesure : 6/6 sur le code correct, et la mutation est désormais attrapée — famille
`bout en bout` à **2/2**.

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
| 1 | **Les trois jobs de la CI** | **Verts au run 40.** Plus rien à confirmer sur ce point. |
| 2 | **Des tests appellent les vraies API publiques** | `acces-roles.test.ts` et `routes-validation.test.ts` déclenchent `POST /api/qualification/emprise`, soit une qualification RÉELLE — mesuré : 1 082 parcelles trouvées, 300 retenues. Conséquence : `DATABASE_URL=… npm test` a dépassé 9 min 50 s et j'ai dû l'interrompre. Un test ne devrait pas dépendre de la disponibilité d'un service public ni consommer son quota. **Non corrigé.** |
| 3 | **`enr_test`, ma base locale** | Polluée par des mois d'exécutions : c'est elle qui faisait tout paraître vert. Toute vérification future doit partir d'une base fraîchement migrée. |
| 4 | **Le double-clic sous Windows** | Toujours invérifiable depuis Linux. Deux lanceurs sont livrés pour que l'un rattrape l'autre. |
| 5 | **L'archive portable n'a pas été reconstruite** | Le redémarrage du conteneur a effacé `distribution/` et les caches ; la reconstruire demande ~400 Mo de téléchargements. Les corrections D, E et F du lanceur sont couvertes par des tests unitaires ; la séquence complète de lancement n'a pas été remesurée depuis. |
| 6 | **Bruit dans la CI** | Le contrôle de santé du service PostgreSQL se connecte en tant que `root` : `FATAL: role "root" does not exist` toutes les 5 secondes dans le journal du conteneur. Cosmétique, mais c'est la même faute que celle corrigée dans le lanceur — apprendre à ignorer des erreurs fatales de routine. |
| 7 | **Les 23 règles `aValiderParJuriste`** | Toujours en attente d'un juriste. Rien de technique ne peut y suppléer. |

---

## 4. État mesuré à la fin de l'audit

### Sur la machine de GitHub — run 40, les trois jobs verts

C'est la mesure qui compte, et c'est celle qui manquait à tous les audits précédents.

| Job | Résultat |
|---|---|
| Typage, construction et tests | **succès** — build, typecheck 0 erreur, puis API 479 / 471 passent / 0 échec / 8 ignorés, core 57/57, scoring 67/67, web 125/125 |
| Migrations SQL et calculs PostGIS | **succès** en 18 min 13 s — campagne de mutation **101/101 attrapées** (elle s'arrêtait à 92), puis PostGIS 5/5, patrimoine 7/7, lot sérialisé de 11 fichiers **64/64**, migrations 4/4. **Les quatre dernières étapes n'avaient jamais tourné en CI.** |
| Tests de bout en bout | **succès** — 19 réussis / 2 ignorés en 36,6 s, et la vérification par mutation **2/2** (elle était à 1/2) |

### Localement, sur une base fraîchement migrée

`enr_neuf`, 15 migrations, 26 tables métier — et non `enr_test`, que des mois d'exécutions ont
peuplée et qui faisait tout paraître vert.

| Vérification | Résultat |
|---|---|
| `npm run build` | propre |
| `npm run typecheck` (après build, comme la CI corrigée) | 0 erreur |
| `npm test` API (sans base, comme la CI) | 479 tests, 471 passent, 0 échec, 8 ignorés |
| `npm run test:base` API (sérialisé, base neuve) | 80 tests, 76 passent, 0 échec, 4 ignorés |
| `npm test` core / scoring / web | 57/57, 67/67, 125/125 |
| Playwright bout en bout | 18 réussis / 2 ignorés, 47,9 s |
| Campagne de mutation (hors navigateur) | 101 / 101 attrapées |
| Campagne de mutation (avec navigateur) | 2 / 2 attrapées — 1/2 avant cet audit |

## 5. Vérification par mutation

La liste compte désormais **104 entrées**, dont 3 exigent un navigateur. La campagne complète
hors navigateur rend **101 / 101 attrapées** : aucun test décoratif.

La campagne a par ailleurs fait son office sur elle-même. Deux mutations de la famille
`mode bureau` désignaient `apps/api/src/serveur.ts`, où `estBoucleLocale` ne vit plus : elle a
répondu « motif introuvable dans apps/api/src/serveur.ts — le code a changé » au lieu de les
compter comme attrapées. C'est exactement le comportement attendu d'un outil qui refuse de
s'auto-congratuler ; les deux entrées ont été repointées et sont de nouveau attrapées.

La famille `audit 11` compte **13 mutations, 13 attrapées**. Chacune rétablit un des défauts
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
- la fenêtre d'échec qui ne se referme plus jamais ;
- le serveur de prévisualisation revenu à une adresse d'écoute par défaut ;
- la sonde de disponibilité redevenue un simple numéro de port.
