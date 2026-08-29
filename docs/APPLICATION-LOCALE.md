# L'application locale portable

> **État de ce chantier.** L'archive est **fabriquée, lancée et mesurée** : 477 Mo décompressée,
> **188,9 Mo en ZIP**. La séquence complète de démarrage a été exécutée pour de vrai —
> `initdb`, moteur, schéma, API, interface servie, arrêt propre — et elle a livré trois
> défauts que la relecture n'aurait pas donnés. **Ce qui reste : le double-clic sur un poste
> Windows, et la base pré-remplie.** La section 7 le dit exactement.
>
> Fabrication : `node scripts/portable/construire.mjs`
>
> *La boucle GitHub et la version Netlify ont été écartées : ce document ne traite plus que
> l'application de bureau.*

## 1. Ce que c'est

Un dossier posé sur le bureau. Dedans : l'application, ses deux moteurs, et vos données.

```
Prospection-EnR/
  Prospection-EnR.exe        double-clic : ouvre l'application, avec son icône
  Prospection-EnR.cmd        le même lanceur, sans injection — le filet de secours
  Creer-un-raccourci.cmd     pose l'icône sur le bureau
  LISEZ-MOI.txt
  moteurs/
    node/node.exe            Node.js — aucune installation
    postgres/                PostgreSQL 16.4 + PostGIS 3.6.2 — aucune installation
  application/               l'application compilée et ses dépendances serveur
  donnees/
    pgdata/                  LA BASE : vos parcelles, votre pipeline
    amorce.sql.gz            données de référence, restaurées au premier lancement
    journal.txt              le détail technique du dernier démarrage
```

Copiez le dossier sur une clé USB, branchez-la sur un autre PC, double-cliquez : mêmes
données, aucune installation, aucun droit administrateur, aucune trace laissée sur le poste.

**« Local » ne veut pas dire « hors ligne ».** La qualification interroge une vingtaine d'API
officielles. Sans internet, seules les parcelles déjà en cache restent consultables.

## 2. Pourquoi PostgreSQL embarqué et pas une base « légère »

La question méritait d'être tranchée par la mesure plutôt que par l'habitude. J'ai testé
**PGlite** — PostgreSQL 18.3 + PostGIS 3.6 compilés en WebAssembly, 4 Mo, aucun processus
externe. Séduisant, et presque suffisant :

| | PGlite (WASM) | PostgreSQL embarqué |
|---|---|---|
| Les 15 migrations | 15/15 en 7,4 s | **15/15 en 0,4 s** |
| Premier démarrage | 14 s | **5,2 s** |
| Démarrages suivants | 5,0 s | **0,3 s** |
| 35 000 points géo insérés | 1,3 s | — |
| Proximité 50 km sur index GiST | 232 ms | — |
| **Tuiles vectorielles `ST_AsMVT`** | **échec : « Compiled without protobuf-c support »** | **56 octets produits** |

Le dernier point est éliminatoire : la carte de l'application est faite de tuiles générées en
base. Sans `ST_AsMVT`, il aurait fallu réécrire l'encodage des tuiles en JavaScript.

> **Une leçon de méthode, à mes dépens.** Mon premier contrôle interrogeait `pg_proc` et
> répondait « `ST_AsMVT` PRÉSENT ». C'était faux dans les faits : la fonction est bien au
> catalogue, mais elle lève une erreur dès qu'on l'appelle. Seule l'exécution l'a montré.

## 3. L'habillage de bureau

Trois choses demandées, trois choses faites — et chacune a demandé une vérification sur
l'artefact produit, pas sur l'intention.

### L'icône

Dessinée par `scripts/portable/faire-icone.py` : un fond bleu-nuit arrondi, une **parcelle**
(un quadrilatère irrégulier — un rectangle ferait « document », c'est l'irrégularité qui évoque
le cadastre) et un **soleil** ambre. Sept tailles, de 16 à 256 pixels.

La géométrie a été arrêtée **en regardant le rendu à 16 px**, la taille de la barre des tâches :
la première version collait la parcelle au soleil et les deux masses fusionnaient en une seule
tache. La parcelle a été descendue et rétrécie.

L'icône est gravée dans l'exécutable, avec les métadonnées lues par l'explorateur. Sans elles,
le clic droit → Propriétés annonce « Node.js JavaScript Runtime, Node.js Foundation » : sur un
bureau, à côté d'Outlook, ça ne ressemble pas à un outil de travail mais à un fichier
téléchargé par erreur.

> **Un défaut que seule la relecture du binaire a donné.** `replaceIconsForResource` n'a pas
> *remplacé* l'icône de Node : il en a **ajouté** une dans une autre langue. Le binaire est
> sorti avec deux groupes concurrents — `id=1 lang=1033` (le logo vert de Node) et
> `id=1 lang=1036` (le nôtre). Windows choisit selon la langue du système : **sur un poste
> anglophone, c'est le logo de Node qui se serait affiché.** Invisible sur la machine de
> fabrication, invisible sur un Windows français. Les ressources d'icône existantes sont
> désormais supprimées avant l'ajout, et le binaire produit ne contient plus qu'un groupe.

### Le raccourci sur le bureau

Posé automatiquement à la première ouverture, et re-créable à volonté par
`Creer-un-raccourci.cmd`. Il passe par `WScript.Shell`, le mécanisme officiel de Windows, et
non par l'écriture directe d'un `.lnk` : ce format binaire ne se fabrique pas de façon fiable
depuis Linux, et **un `.lnk` mal formé est pire qu'absent** — l'icône apparaît, puis le
double-clic échoue sans message utile.

Un échec de création n'est jamais fatal : une application qui refuserait de démarrer parce
qu'elle n'a pas su décorer un bureau serait absurde.

### L'animation de démarrage

Entre le double-clic et la carte il s'écoule cinq secondes, une trentaine à la première
ouverture. Une fenêtre noire et muette pendant ce temps-là, ce n'est pas un problème
d'esthétique : c'est un utilisateur qui croit à une panne, ferme la fenêtre, et recommence.

```
  ┌──────────────────────────────────────────────┐
  │  Prospection EnR                             │
  │  aide a la decision fonciere                 │
  └──────────────────────────────────────────────┘
  ✓  Preparation de la base (une seule fois)  (0,9 s)
  ✓  Demarrage du moteur de donnees — port 54329  (0,3 s)
  ✓  Ouverture de la base applicative  (1,2 s)
  ✓  Application du schema  (0,4 s)
  ✓  Chargement des donnees de reference — 182 Mo  (4,1 s)
  ✓  Demarrage de l'application — http://127.0.0.1:3000  (2,1 s)
     Raccourci « Prospection EnR » place sur votre bureau.
```

Une roue tourne pendant chaque étape, la ligne se réécrit sur place, et le temps écoulé
s'affiche — c'est ce qui rend une lenteur diagnosticable. **Sans terminal**, aucun caractère
de contrôle n'est émis : la sortie va alors dans `donnees/journal.txt`, précisément le fichier
qu'on lit quand quelque chose a mal tourné, et un journal farci de codes d'échappement est
illisible au moment où il faudrait le lire.

Six tests couvrent ces propriétés, quatre mutations prouvent qu'ils ne sont pas décoratifs.

## 4. Aucun mot de passe : comment, et à quelles conditions

**Vous double-cliquez, l'application s'ouvre. Rien à saisir.** L'utilisateur a déjà ouvert sa
session Windows, la base est dans son dossier, le serveur n'écoute que sa propre machine :
un écran de connexion n'ajouterait aucune protection.

Mais ça ne pouvait pas se faire n'importe comment.

> **Le défaut le plus grave de ce chantier, et il n'a été trouvé qu'en lançant l'archive.**
> Le lanceur posait `NODE_ENV=production` — ce qui garde la politique CORS restrictive — et
> `AUTH_DESACTIVEE=true`. Or le serveur **refuse** cette combinaison, à juste titre : c'est le
> garde-fou qui empêche de mettre en ligne un serveur sans authentification.
>
> Résultat : l'interface s'affichait, `/api/sante` répondait 200, et **toutes les routes
> utiles rendaient 500** — `AUTH_DESACTIVEE est interdit en production`. Une carte vide et
> rien d'autre. Le défaut était invisible à la relecture (les deux variables sont correctes
> prises séparément) et invisible sur la route de santé.

Les deux mauvaises réponses possibles méritent d'être dites, parce qu'elles étaient
tentantes :

- **basculer en `NODE_ENV=development`** — c'est ce que fait `demarrer.bat`. Mais en
  développement la politique CORS accepte **toutes** les origines : n'importe quelle page web
  visitée par l'utilisateur aurait alors pu lire ses données de propriétaires sur
  `127.0.0.1:3000` ;
- **affaiblir le garde-fou de production**, qui protège un vrai serveur.

La réponse retenue nomme la situation au lieu de la déguiser : **`MODE_BUREAU`**, accepté
uniquement si le serveur n'écoute que la **boucle locale**. Sur `0.0.0.0` — le défaut, et le
cas de tout hébergement — le drapeau ne donne rien. C'est cette seconde condition qui a du
mordant : elle porte sur ce que la machine expose réellement, pas sur une variable qu'on
recopie d'un fichier de configuration à l'autre.

> **Un piège évité de justesse.** Ma première version testait la boucle locale par
> `startsWith('127.')`. Elle acceptait `127.0.0.1.exemple.fr` — un nom de domaine que son
> propriétaire fait pointer où il veut, y compris sur une adresse publique. Le serveur se
> serait cru local tout en étant joignable par tout le monde, **sans authentification**.
> Trouvé par le test, pas par la relecture. L'adresse est désormais validée, pas préfixée.

Vérifié sur l'application lancée, après correction :

| | |
|---|---|
| `/api/auth/moi` | **200** — « Poste local », rôle admin, aucun mot de passe saisi |
| `/api/leads`, `/api/carte/parcelles`, `/api/carte/postes-sources` | **200** |
| `/api/carte/tuiles/parcelles/...` (tuiles protégées) | **200** |
| Requête depuis `https://site-malveillant.fr` | **refusée** — aucun en-tête CORS renvoyé |
| Requête depuis `http://127.0.0.1:3000` | acceptée |

## 5. Trois autres défauts que l'exécution a livrés

Aucun n'était visible à la relecture. Tous ont été trouvés en lançant réellement la séquence
complète sur une arborescence portable.

**1. Le lanceur se tuait après avoir tout réussi.** L'ouverture du navigateur appelait `spawn`
sans écouter l'événement `error`. Le programme d'ouverture absent, Node a relancé l'erreur
comme un événement non géré : la fenêtre s'est fermée une seconde après avoir annoncé
« L'application est ouverte » — alors que la base tournait et que l'interface répondait 200.
L'utilisateur aurait conclu à une panne totale pour un échec purement cosmétique.

**2. Le deuxième double-clic affichait « le démarrage a échoué ».** C'est le geste le plus
courant sur un bureau : on ne voit pas la fenêtre derrière les autres, on reclique. Le second
lancement butait sur `lock file "postmaster.pid" already exists`. Désormais il constate que
l'application répond, ramène simplement la fenêtre, et sort.

**3. Un `FATAL` inscrit au journal à chaque démarrage.** `pg_isready` se connectait sous le nom
du compte du système, qui n'existe pas comme rôle : PostgreSQL répondait — tout ce que
`pg_isready` demande — mais journalisait `FATAL: role "..." does not exist`. Laisser une erreur
fatale de routine dans le fichier de diagnostic, c'est apprendre à ignorer les erreurs fatales.
Vérifié après correction : **zéro `FATAL`** dans le journal d'une base neuve.

## 6. Le poids de l'archive, et comment il a été obtenu

| Poste | Poids |
|---|---|
| `moteurs/postgres` | 259,6 Mo |
| `moteurs/node` | 83,0 Mo |
| `application` (clone + build + dépendances serveur) | 56,9 Mo |
| `Prospection-EnR.exe` | 83,2 Mo |
| **Total décompressé** | **482,7 Mo** |
| **Archive ZIP** | **191,8 Mo** |

Trois élagages, chacun appuyé sur une mesure :

1. **Les dossiers de développement de PostgreSQL** : 919,8 → 119,7 Mo. `include`, `doc`,
   `symbols`, `pgAdmin 4` et `StackBuilder` ne servent ni à exécuter ni à interroger la base.
2. **Les dépendances de l'interface** : 137,5 → 50,5 Mo de `node_modules`. `--omit=dev` seul
   installait encore maplibre-gl (41 Mo), jsts (13 Mo), @turf (9,6 Mo), @maplibre (9,2 Mo) et
   @tanstack (4,9 Mo) — alors que l'interface est **déjà compilée** et ne charge plus aucun
   paquet à l'exécution. L'installation est donc restreinte aux trois espaces serveur.
3. **Ce qu'aucun chemin d'exécution n'atteint** : 401,0 → 259,6 Mo. Sur les 275 binaires livrés
   par le paquet PostGIS, **40 seulement** sont atteignables depuis les programmes réellement
   invoqués. Les 235 autres — GDAL (34,8 Mo), SFCGAL (11,3 Mo), wxWidgets et GTK pour une
   interface graphique de chargement de shapefiles, pgRouting, MobilityDB — pèsent 114,7 Mo.
   S'y ajoutent 24,1 Mo de scripts SQL d'extensions jamais créées et 2,6 Mo de données GDAL
   devenues orphelines.

Le troisième élagage n'est pas une devinette sur les noms de fichiers : c'est une **fermeture
transitive des tables d'importation** réelles, imports différés compris. Elle a confirmé deux
choses utiles au passage :

- `postgis-3.dll` n'importe **ni GDAL ni SFCGAL** — mais bien `libprotobuf-c-1.dll`, c'est-à-dire
  exactement ce qui manquait à PGlite pour produire des tuiles ;
- `icudt67.dll` (27 Mo) **est** atteignable. Le retirer sur la foi de son nom aurait tué
  PostgreSQL.

Si l'application se plaignait d'une DLL manquante sur un poste, reconstruisez avec
`--sans-elagage-fin` : l'archive complète fait 624 Mo, et le fait savoir.

## 7. Ce qui reste à faire

| Reste | Pourquoi |
|---|---|
| **Le double-clic** | Je ne peux ni lancer ni éprouver un exécutable Windows depuis un environnement Linux. C'est la seule vérification qui vaille, et elle vous revient. L'archive contient donc **deux** lanceurs : `Prospection-EnR.exe` (injection SEA dans `node.exe`) et `Prospection-EnR.cmd`, qui fait la même chose sans dépendre d'aucune injection. Si l'un échoue, l'autre reste. |
| **La base pré-remplie** | `--amorce <dump.sql.gz>` embarque un `pg_dump` que le premier lancement restaure. Le dump reste à produire : il suppose une ingestion nationale complète (35 000 communes, 3 119 postes, 43 873 monuments). Sans lui l'archive fonctionne, mais le premier démarrage télécharge les données (5 à 10 minutes). |
| **Le premier envoi** | Le dossier livré est bien une copie de travail git (62 commits, 280 fichiers suivis, origine réglée par `--depot`), et le garde a été éprouvé depuis l'intérieur. Seul le `git push` réel reste à faire : il demande votre jeton d'accès. |

> **Un mot sur l'avertissement de signature.** L'injection SEA modifie `node.exe`, dont la
> signature Microsoft devient invalide — l'outil le dit (« signature seems corrupted »).
> Windows peut afficher un écran SmartScreen au premier lancement. C'est attendu, et c'est une
> raison de plus de garder le `.cmd` sous la main.

## 8. Le risque qu'il faut assumer

Ce dossier contient des **données nominatives de propriétaires, en clair**. Une clé USB perdue
est une violation de données à notifier à la CNIL sous 72 heures. Trois mesures, par ordre
d'efficacité :

1. **Chiffrer le support** — BitLocker sur la clé USB (Windows Pro), ou VeraCrypt. C'est la
   seule mesure qui protège vraiment un support égaré.
2. **Ne pas multiplier les copies.** Chaque poste où le dossier séjourne est un endroit de plus
   où les données existent.
3. **Sauvegarder à part** : `donnees/pgdata` est la seule chose non reconstituable depuis les
   sources publiques.
