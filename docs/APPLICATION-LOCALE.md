# L'application locale portable

> **État de ce chantier.** L'archive est **fabriquée et mesurée** : 482,7 Mo décompressée,
> **191,8 Mo en ZIP**. Tout ce qui était vérifiable sans Windows l'a été en exécution réelle —
> la base s'initialise et produit de vraies tuiles vectorielles, le dossier livré est une copie
> de travail git fonctionnelle, le garde d'envoi refuse ce qu'il doit refuser. **Ce qui reste :
> le double-clic sur un poste Windows, et la base pré-remplie.** La section 6 le dit exactement.
>
> Fabrication : `node scripts/portable/construire.mjs --depot <url-de-votre-depot>`

## 1. Ce que c'est

Un dossier posé sur le bureau. Dedans : l'application, ses deux moteurs, et vos données.

```
Prospection-EnR/
  Prospection-EnR.exe        double-clic : ouvre l'application dans le navigateur
  Prospection-EnR.cmd        le meme lanceur, sans injection — le filet de secours
  Mettre-a-jour.cmd          récupère les dernières modifications depuis GitHub
  Pousser-vers-GitHub.cmd    renvoie VOS modifications sur GitHub
  LISEZ-MOI.txt
  moteurs/
    node/node.exe            Node.js — aucune installation
    postgres/                PostgreSQL 16.4 + PostGIS 3.6.2 — aucune installation
  application/               copie de travail git : sources, historique, et le build
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

## 3. La boucle GitHub

Trois gestes, sans ligne de commande :

| Action | Ce qu'elle fait |
|---|---|
| **Mettre-a-jour** | `git pull --ff-only` puis reconstruction. En avance rapide seulement : une fusion automatique que personne ne relit produirait des conflits silencieux. |
| **Pousser-vers-GitHub** | trie les fichiers, refuse ceux qui ne doivent pas partir, puis commit et push. |

### Ce qui ne partira jamais sur GitHub

`scripts/portable/depot.mjs` refuse l'envoi — et explique pourquoi — dès qu'un de ces chemins
apparaît :

| Motif | Raison |
|---|---|
| `donnees/`, `pgdata/` | la base : pipeline commercial et données de propriétaires |
| `.env` | `SECRET_JWT`, mots de passe |
| `jeton-*.txt` | jeton d'accès GitHub |
| `*.dump`, `*.sql.gz`, `*.bak` | sauvegardes de base |
| `exports/`, `*.csv`, `*.geojson`, `*.shp` | exports pouvant nommer des propriétaires |

Deux propriétés du garde méritent d'être connues, parce qu'elles sont délibérées :

1. **Un seul fichier interdit bloque tout l'envoi.** Écarter le fichier fautif pour envoyer le
   reste serait pire : ça habituerait à voir passer des avertissements, jusqu'au jour où l'un
   d'eux compterait.
2. **Les chemins Windows sont normalisés avant comparaison.** Sans cela,
   `donnees\pgdata\base\1\2601` échapperait au motif `^donnees/` — le garde serait inopérant
   exactement sur la plateforme qu'il protège. Un test l'exige, une mutation le prouve.

Un `.gitignore` seul ne suffisait pas : il se contourne d'un `git add -f`, ne suit pas un
dossier renommé, et n'avertit de rien quand il agit.

**Et la première protection n'est ni l'un ni l'autre : c'est la disposition des dossiers.**
`donnees/` est à la racine de l'archive, tandis que la copie de travail git est
`application/`. La base est donc **hors du champ de vision de git**, structurellement. Le
garde couvre ce que cette disposition ne couvre pas : un `.env`, un export, une sauvegarde ou
des données déposées par erreur *à l'intérieur* de `application/`.

### Pourquoi c'est irréversible, et donc pourquoi le garde existe

Un fichier poussé sur GitHub **reste dans l'historique** et dans toutes les copies clonées,
même supprimé ensuite. C'est la seule faute de ce dépôt qu'on ne puisse pas corriger après
coup. D'où un garde exécuté, testé et muté, plutôt qu'une ligne de configuration.

## 4. Relier le dossier à GitHub

Une archive ZIP téléchargée depuis GitHub **ne contient pas l'historique** : on ne peut rien
pousser depuis un dossier obtenu ainsi. Le dossier portable doit être une vraie copie de
travail. `Pousser-vers-GitHub` le détecte et le dit.

L'authentification passe par un **jeton d'accès personnel** (GitHub n'accepte plus les mots de
passe de compte depuis août 2021) : Settings → Developer settings → Personal access tokens,
portée `repo`. Le gestionnaire d'identifiants de Windows le retient après la première saisie.

## 5. Le poids de l'archive, et comment il a été obtenu

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

## 6. Ce qui reste à faire

| Reste | Pourquoi |
|---|---|
| **Le double-clic** | Je ne peux ni lancer ni éprouver un exécutable Windows depuis un environnement Linux. C'est la seule vérification qui vaille, et elle vous revient. L'archive contient donc **deux** lanceurs : `Prospection-EnR.exe` (injection SEA dans `node.exe`) et `Prospection-EnR.cmd`, qui fait la même chose sans dépendre d'aucune injection. Si l'un échoue, l'autre reste. |
| **La base pré-remplie** | `--amorce <dump.sql.gz>` embarque un `pg_dump` que le premier lancement restaure. Le dump reste à produire : il suppose une ingestion nationale complète (35 000 communes, 3 119 postes, 43 873 monuments). Sans lui l'archive fonctionne, mais le premier démarrage télécharge les données (5 à 10 minutes). |
| **Le premier envoi** | Le dossier livré est bien une copie de travail git (62 commits, 280 fichiers suivis, origine réglée par `--depot`), et le garde a été éprouvé depuis l'intérieur. Seul le `git push` réel reste à faire : il demande votre jeton d'accès. |

> **Un mot sur l'avertissement de signature.** L'injection SEA modifie `node.exe`, dont la
> signature Microsoft devient invalide — l'outil le dit (« signature seems corrupted »).
> Windows peut afficher un écran SmartScreen au premier lancement. C'est attendu, et c'est une
> raison de plus de garder le `.cmd` sous la main.

## 7. Le risque qu'il faut assumer

Ce dossier contient des **données nominatives de propriétaires, en clair**. Une clé USB perdue
est une violation de données à notifier à la CNIL sous 72 heures. Trois mesures, par ordre
d'efficacité :

1. **Chiffrer le support** — BitLocker sur la clé USB (Windows Pro), ou VeraCrypt. C'est la
   seule mesure qui protège vraiment un support égaré.
2. **Ne pas multiplier les copies.** Chaque poste où le dossier séjourne est un endroit de plus
   où les données existent.
3. **Sauvegarder à part** : `donnees/pgdata` est la seule chose non reconstituable depuis les
   sources publiques.
