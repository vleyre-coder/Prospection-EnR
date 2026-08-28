# L'application locale portable

> **État de ce chantier.** Le socle est construit et **vérifié par exécution** : la base
> embarquée s'initialise, démarre, applique les 15 migrations et produit de vraies tuiles
> vectorielles ; le garde qui empêche la base de partir sur GitHub est couvert par 9 tests et
> 4 mutations. **L'empaquetage Windows — le `.exe`, l'archive, la base pré-remplie — reste à
> faire**, et il ne pourra être éprouvé que sur un poste Windows. La section 5 dit exactement
> ce qui manque.

## 1. Ce que c'est

Un dossier posé sur le bureau. Dedans : l'application, ses deux moteurs, et vos données.

```
Prospection-EnR/
  Prospection-EnR.exe        double-clic : ouvre l'application dans le navigateur
  Mettre-a-jour.exe          récupère les dernières modifications depuis GitHub
  Pousser-vers-GitHub.exe    renvoie VOS modifications de code sur GitHub
  moteurs/
    node/                    Node.js — aucune installation
    postgres/                PostgreSQL + PostGIS — aucune installation
  application/               le code, compilé
  donnees/
    pgdata/                  LA BASE : vos parcelles, votre pipeline
    journal.txt
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

## 5. Ce qui reste à faire

| Reste | Pourquoi ce n'est pas fait |
|---|---|
| `scripts/portable/construire.mjs` : téléchargement, élagage et assemblage de l'archive | à écrire ; les binaires sont accessibles et pesés (PostgreSQL 323 Mo à élaguer, `node.exe` 83 Mo, PostGIS bundle 3.6.2) |
| Le `.exe` de lancement | produisible depuis Linux par injection dans `node.exe`, **mais non exécutable ici** : la vérification du double-clic devra se faire sur un poste Windows |
| La base pré-remplie | suppose une ingestion nationale complète (35 000 communes, 3 119 postes, 43 873 monuments) ; à produire puis à mesurer |
| `Mettre-a-jour.exe` / `Pousser-vers-GitHub.exe` | enveloppes autour de `scripts/portable/depot.mjs`, déjà écrit et testé |

**La limite honnête de ce chantier** : je ne peux ni produire ni éprouver un exécutable
Windows depuis cet environnement Linux. Tout ce qui est vérifiable sans Windows l'a été, en
exécution réelle ; le double-clic, lui, restera à confirmer sur votre poste.

## 6. Le risque qu'il faut assumer

Ce dossier contient des **données nominatives de propriétaires, en clair**. Une clé USB perdue
est une violation de données à notifier à la CNIL sous 72 heures. Trois mesures, par ordre
d'efficacité :

1. **Chiffrer le support** — BitLocker sur la clé USB (Windows Pro), ou VeraCrypt. C'est la
   seule mesure qui protège vraiment un support égaré.
2. **Ne pas multiplier les copies.** Chaque poste où le dossier séjourne est un endroit de plus
   où les données existent.
3. **Sauvegarder à part** : `donnees/pgdata` est la seule chose non reconstituable depuis les
   sources publiques.
