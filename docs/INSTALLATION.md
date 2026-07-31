# Installation et exploitation

Deux voies, selon l'usage :

| Voie | Pour qui | Prérequis | Durée |
|---|---|---|---|
| [1. Docker](#1-installation-en-une-commande-docker) | utiliser l'application | Docker Desktop | 5 min + 15 min de chargement |
| [2. Sources](#2-installation-pour-développer) | modifier le code | Node ≥ 20, PostgreSQL + PostGIS | 15 min |

Pour une **mise en ligne** — accès à plusieurs, HTTPS, nom de domaine, ou interface sur
Netlify avec l'API ailleurs — voir [HEBERGEMENT.md](HEBERGEMENT.md).

L'application **s'initialise elle-même** dans les deux cas : à son premier démarrage, elle
applique ses migrations, génère son secret de signature des jetons, crée un compte
administrateur et charge les données nationales manquantes. Il n'y a plus de séquence de
commandes à enchaîner.

---

## 1. Installation en une commande (Docker)

### 1.1 Installer Docker

- **Windows / macOS** : [Docker Desktop](https://docs.docker.com/get-docker/), puis le lancer.
- **Linux (Debian/Ubuntu)** : `sudo apt install docker.io docker-compose-plugin`

### 1.2 Récupérer et lancer

```bash
git clone https://github.com/vleyre-coder/Prospection-EnR.git
cd Prospection-EnR
./demarrer.sh
```

Sous Windows, dans PowerShell :

```powershell
git clone https://github.com/vleyre-coder/Prospection-EnR.git
cd Prospection-EnR
.\demarrer.ps1
```

> Si PowerShell refuse d'exécuter le script :
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

Le script vérifie Docker, crée un `.env` s'il n'existe pas, construit les images, attend que
l'application réponde et ouvre le navigateur sur <http://localhost:8080>.

L'équivalent direct, si vous préférez piloter Docker vous-même :

```bash
docker compose up -d --build
```

### 1.3 Ce qui se passe au premier démarrage

Dans l'ordre, et sans intervention :

1. **PostGIS démarre** et l'API l'attend ;
2. **le schéma est appliqué** (migrations `db/migrations/*.sql`, idempotentes) ;
3. **le secret de signature des jetons est généré** et conservé en base — vos sessions
   survivent aux redémarrages ;
4. **un compte administrateur est créé.** Si `ADMIN_EMAIL` et `ADMIN_MOT_DE_PASSE` sont
   renseignés dans `.env`, ce sont vos identifiants. Sinon un mot de passe est tiré au hasard
   et **affiché une seule fois** dans les journaux ;
5. **les données nationales sont chargées en arrière-plan**, dans cet ordre :

   | Étape | Volume | Durée | Sans elle |
   |---|---|---|---|
   | Contours communaux | ~35 000 communes | 5 à 10 min | la vue nationale est vide |
   | Postes sources | 3 119 postes | 2 min | les critères de raccordement restent gris |
   | Monuments historiques | 43 873 objets | 30 s | les critères patrimoine restent gris |
   | Sites d'injection biométhane | 836 sites | 30 s | critère de débouché gaz gris (méthanisation) |
   | Gisement de vent à 100 m | raster 55 Mo | 1 à 3 min | le critère de vent reste gris (éolien) |

   L'interface est utilisable pendant ce temps et affiche un bandeau d'avancement. Une étape
   en échec n'empêche pas les suivantes et n'invente aucune donnée : les critères concernés
   restent gris.

### 1.4 Récupérer le mot de passe administrateur

```bash
./demarrer.sh --journaux        # ou : docker compose logs api
```

Chercher le bloc `PREMIER DEMARRAGE`.

### 1.5 Commandes courantes

```bash
./demarrer.sh              # démarrer (ou redémarrer)
./demarrer.sh --etat       # état des conteneurs et avancement du chargement
./demarrer.sh --journaux   # suivre les journaux de l'API
./demarrer.sh --arreter    # arrêter, sans rien perdre
./demarrer.sh --effacer    # supprimer la base et repartir de zéro
```

### 1.6 Régler ce qui vous concerne

Tout est facultatif. Le fichier `.env` (créé depuis `.env.example`) place en premier les seules
lignes qui comptent :

| Variable | Rôle |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_MOT_DE_PASSE` | vos identifiants (mot de passe : 12 caractères minimum) |
| `PORT_WEB` | port de l'interface (8080 par défaut) |
| `POSTGRES_PASSWORD` | mot de passe PostgreSQL — à changer sur un serveur partagé |
| `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1` | derrière un proxy d'entreprise, **les deux** sont nécessaires |

Le fond de carte, lui, n'exige **aucune configuration côté poste** : les tuiles IGN sont
demandées en direct par le navigateur quand il y a accès, et la carte bascule
**automatiquement** sur le relais `/api/carte/fond/…` servi par l'API dans le cas contraire.
Seul le serveur a besoin d'atteindre `data.geopf.fr`.

### 1.7 Avant une mise en production

1. `SECRET_JWT` tiré au hasard (`openssl rand -hex 32`) et conservé **hors du dépôt** — le
   secret auto-généré convient à un poste de travail, pas à un service partagé.
2. `POSTGRES_PASSWORD` changé.
3. Terminaison TLS en amont, le reverse proxy transmettant `X-Forwarded-Proto`.
4. Sauvegarde PostgreSQL planifiée : la base contient le pipeline commercial, seule donnée
   non reconstituable depuis les sources publiques.
5. Comptes créés avec le rôle minimal (`lecture` par défaut), et
   `habiliteDonneesProprietaires` accordé uniquement aux personnes réellement concernées.

---

## 2. Installation pour développer

### 2.1 Prérequis

| Composant | Version | Remarque |
|---|---|---|
| Node.js | ≥ 20 (testé sur 22) | monorepo npm workspaces |
| PostgreSQL | ≥ 15 (testé sur 16) | |
| PostGIS | ≥ 3.3 (testé sur 3.4) | `ST_AsMVT`, `ST_TileEnvelope`, index GiST |
| Accès HTTPS sortant | — | `apicarto.ign.fr`, `data.geopf.fr`, `georisques.gouv.fr`, `capareseau.fr`, `re.jrc.ec.europa.eu`, `geo.api.gouv.fr`, `opendata.grdf.fr`, `globalwindatlas.info`, `www.data.gouv.fr`, `static.data.gouv.fr` |

Aucune clé d'API n'est requise.

### 2.2 Base de données

```bash
docker compose up -d bdd        # le plus simple
```

Ou sur une instance existante :

```bash
createuser enr --pwprompt
createdb -O enr prospection_enr
psql -d prospection_enr -c 'CREATE EXTENSION postgis;'
```

L'extension PostGIS est créée par la première migration : l'utilisateur doit en avoir le
droit, ou l'extension doit être pré-installée par l'administrateur.

### 2.3 Lancer

```bash
npm install
cp .env.example .env      # AUTH_DESACTIVEE=true : aucune connexion à faire en développement
npm run dev               # API :3000 · interface :5173, rechargement à chaud
```

Ouvrir <http://localhost:5173>. Le schéma et les données nationales se mettent en place au
premier démarrage de l'API, exactement comme en Docker.

Pour tester le mode production — interface compilée servie par l'API, un seul port :

```bash
npm run demarrer          # build puis démarrage, sur http://localhost:3000
```

### 2.4 Variables structurantes

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgres://enr:enr@localhost:5432/prospection_enr` | connexion PostGIS |
| `AUTH_DESACTIVEE` | `false` | `true` en développement : toute requête est traitée comme administrateur. **Le serveur refuse de servir les routes protégées si `NODE_ENV=production`.** |
| `SECRET_JWT` | généré au premier démarrage | à définir explicitement en production |
| `MIGRATIONS_AUTO` | `true` | applique les migrations au démarrage |
| `AMORCAGE_AUTO` | `true` | charge les données nationales manquantes au démarrage |
| `SERVIR_WEB` | `true` | sert `apps/web/dist` depuis l'API si le build existe |
| `HTTP_CONCURRENCE` | `4` | requêtes simultanées par domaine externe. La Géoplateforme limite à 1 req/s : ne pas augmenter sans raison. |
| `SNAPSHOT_MAX_AGE_JOURS` | `30` | âge au-delà duquel un snapshot de parcelle est recalculé |
| `QUALIF_SURFACE_MIN_M2` | `3000` | surface minimale d'une parcelle qualifiée à la demande |
| `ZOOM_MIN_PARCELLES` | `14` | zoom à partir duquel les parcelles sont servies |

### 2.5 Commandes manuelles

Utiles quand on veut piloter soi-même ce que le démarrage fait automatiquement :

```bash
npm run db:migrate                                  # migrations seules
npm run ingest -w @enr/api                          # tous les jobs d'ingestion
npm run ingest -w @enr/api -- postes_sources        # un job précis
npm run db:seed -w @enr/api -- locales              # exemples de ZAER et document-cadre
npm run db:seed -w @enr/api -- secteurs             # qualifie deux secteurs de démonstration
npm run rescorer -w @enr/api                        # recalcule les scores matérialisés
npm run typecheck && npm run test                   # vérifications
```

Jobs d'ingestion disponibles : `communes`, `postes_sources`, `patrimoine_culture`,
`reseau_gaz`, `vent_100m`.

Le script de migration trace chaque fichier appliqué avec son empreinte : une migration déjà
appliquée puis modifiée provoque une erreur explicite plutôt qu'un rejeu silencieux. Pour
corriger un schéma, créer une nouvelle migration.

---

## 3. Premier usage

1. Choisir une **filière** dans la barre supérieure — c'est le contrôle principal.
2. Rechercher une commune, puis zoomer jusqu'au niveau 14 : la carte passe de la vue
   communale au parcellaire.
3. Cliquer sur **Qualifier l'emprise** : les parcelles visibles dépassant la surface minimale
   sont récupérées au cadastre, enrichies par une vingtaine de sources et scorées pour les
   quatre filières. Compter **4 à 6 secondes par parcelle** — les sources officielles sont
   limitées en débit (1 req/s côté Géoplateforme). Les visites suivantes du même secteur sont
   instantanées.
4. Cliquer sur une parcelle pour ouvrir sa fiche.

Pour de grandes surfaces, préférer une pré-qualification par lots hors heures ouvrées :

```bash
curl -X POST http://localhost:8080/api/qualification/emprise \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $JETON" \
  -d '{"bbox":[1.70,48.10,1.80,48.20],"surfaceMinM2":10000}'
```

---

## 4. Exploitation courante

### Supervision

- `GET /api/sante` : état de la base, **avancement du chargement initial** et **fraîcheur de
  chaque source**. Le champ `sourcesPerimees` liste les sources dépassant leur périodicité ;
  l'interface l'affiche en bandeau. C'est la sonde à brancher sur votre supervision.
- `GET /api/admin/ingestions` (rôle `admin`) : historique et volumétrie par connecteur.
- `GET /api/admin/journal` (rôle `admin`) : journal d'accès (RGPD).

### Rafraîchissement

Voir [RAFRAICHISSEMENT.md](RAFRAICHISSEMENT.md) pour la périodicité de chaque source et
[SOURCES_DONNEES.md](SOURCES_DONNEES.md) pour leur nature et leurs limites.

```bash
docker compose exec api node dist/scripts/ingerer.js postes_sources
docker compose exec api node dist/scripts/rescorer.js
```

### Purge RGPD

```bash
curl -X POST http://localhost:8080/api/admin/purge-rgpd -H "Authorization: Bearer $JETON"
```

Efface les données nominatives de propriétaires arrivées à échéance
(`proprietaire_parcelle.purge_prevue_le`). À planifier mensuellement.

---

## 5. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| `docker: command not found` | Docker absent | installer Docker Desktop, puis relancer `./demarrer.sh` |
| « Docker ne répond pas » | Docker Desktop n'est pas lancé | le démarrer, puis relancer |
| Écran de connexion sans identifiants | mot de passe généré non noté | `./demarrer.sh --journaux`, chercher `PREMIER DEMARRAGE`. Sinon : définir `ADMIN_EMAIL` et `ADMIN_MOT_DE_PASSE` dans `.env` puis relancer — le compte est mis à jour. |
| Vue nationale vide | chargement des communes en cours ou en échec | attendre le bandeau d'avancement, ou `docker compose exec api node dist/scripts/ingerer.js communes` |
| Bandeau « chargement initial incomplet » | une étape d'ingestion a échoué | relancer l'étape nommée dans le bandeau |
| Message « fond servi via le relais de l'application » | `data.geopf.fr` bloqué depuis le **navigateur** | rien à faire : la carte bascule automatiquement sur le relais. Pour repasser en direct, autoriser `data.geopf.fr` sur les postes. |
| Message « fond injoignable, y compris depuis le serveur » | `data.geopf.fr` bloqué depuis le **serveur** aussi | autoriser `data.geopf.fr` en sortie, ou renseigner `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1` |
| `503 upstream connect error` sur une ingestion | Node ignore `HTTPS_PROXY` | ajouter `NODE_USE_ENV_PROXY=1` |
| `502 source_indisponible` | source externe momentanément en panne | comportement attendu : les critères concernés restent gris. Réessayer plus tard. |
| Qualification lente | limitation de débit des sources | normal. Réduire l'emprise ou augmenter `QUALIF_SURFACE_MIN_M2`. |
| Beaucoup de connecteurs en échec sur une grande emprise | saturation d'`apicarto.ign.fr` | abaisser `HTTP_CONCURRENCE` à 2 et relancer la qualification ; les parcelles déjà enrichies ne sont pas réinterrogées |
| `relation "parcelle" does not exist` | migrations non appliquées (`MIGRATIONS_AUTO=false`) | `npm run db:migrate` |
| `AUTH_DESACTIVEE est interdit en production` | garde-fou volontaire | retirer la variable et utiliser de vrais comptes |
| Port 8080 déjà utilisé | autre service local | changer `PORT_WEB` dans `.env`, puis relancer |

## 6. Structure du dépôt

```
demarrer.sh / .ps1  Lancement en une commande
packages/core       Référentiel partagé : filières, critères, réglementation datée,
                    avertissements, palette, modèle ParcelleSnapshot
packages/scoring    Moteur de scoring explicable (knock-outs, score pondéré, sites)
apps/api            API Fastify, connecteurs, ingestion, tuiles vectorielles, exports
apps/web            Interface React + MapLibre
db/migrations       Schéma PostgreSQL + PostGIS
docs                Documentation, dont les contrats d'API vérifiés
```
