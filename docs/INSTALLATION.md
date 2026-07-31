# Installation et exploitation

## 1. Prérequis

| Composant | Version | Remarque |
|---|---|---|
| Node.js | ≥ 20 (testé sur 22) | monorepo npm workspaces |
| PostgreSQL | ≥ 15 (testé sur 16) | |
| PostGIS | ≥ 3.3 (testé sur 3.4) | `ST_AsMVT`, `ST_TileEnvelope`, index GiST |
| Accès réseau sortant HTTPS | — | vers `apicarto.ign.fr`, `data.geopf.fr`, `georisques.gouv.fr`, `capareseau.fr`, `re.jrc.ec.europa.eu`, `geo.api.gouv.fr`, `www.data.gouv.fr`, `static.data.gouv.fr` |

**Derrière un proxy d'entreprise**, renseigner `HTTPS_PROXY` **et** `NODE_USE_ENV_PROXY=1` :
Node ignore `HTTPS_PROXY` par défaut, ce qui rend certaines sources injoignables sans erreur
explicite (réponse `503 upstream connect error` émise par le proxy). Le navigateur doit être
configuré séparément pour atteindre `data.geopf.fr` (fonds de carte).

Aucune clé d'API n'est requise pour les sources utilisées.

---

## 2. Installation locale

### 2.1 Base de données

```bash
# Avec Docker
docker compose up -d bdd

# Ou sur une instance PostgreSQL existante
createuser enr --pwprompt
createdb -O enr prospection_enr
psql -d prospection_enr -c 'CREATE EXTENSION postgis;'
```

L'extension PostGIS est créée par la première migration ; l'utilisateur doit donc en avoir
le droit (superutilisateur, ou extension pré-installée par l'administrateur).

### 2.2 Configuration

```bash
cp .env.example .env
# Générer un secret de signature de jetons
sed -i "s|^SECRET_JWT=.*|SECRET_JWT=$(openssl rand -hex 32)|" .env
```

Variables structurantes :

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgres://enr:enr@localhost:5432/prospection_enr` | connexion PostGIS |
| `AUTH_DESACTIVEE` | `false` | `true` en développement : toute requête est traitée comme administrateur. **Le serveur refuse de servir les routes protégées si `NODE_ENV=production`.** |
| `SECRET_JWT` | — | **obligatoire en production** |
| `HTTP_CONCURRENCE` | `4` | requêtes simultanées par domaine externe. La Géoplateforme limite à 1 req/s : ne pas augmenter sans raison. |
| `SNAPSHOT_MAX_AGE_JOURS` | `30` | âge au-delà duquel un snapshot de parcelle est recalculé |
| `QUALIF_SURFACE_MIN_M2` | `3000` | surface minimale d'une parcelle qualifiée à la demande |
| `ZOOM_MIN_PARCELLES` | `14` | zoom à partir duquel les parcelles sont servies |

### 2.3 Migrations et amorçage

```bash
npm install
npm run build                  # @enr/core, @enr/scoring, @enr/api, @enr/web
npm run db:migrate             # applique db/migrations/*.sql (idempotent)
```

Le script de migration trace chaque fichier appliqué avec son empreinte : une migration
déjà appliquée puis modifiée provoque une erreur explicite plutôt qu'un rejeu silencieux.
Pour corriger un schéma, créer une nouvelle migration.

Amorçage (chaque étape est indépendante et peut être relancée) :

```bash
# Compte administrateur (sans ces variables, aucun compte n'est créé)
ADMIN_EMAIL=vous@exemple.fr ADMIN_MOT_DE_PASSE='au moins 12 caracteres' npm run db:seed

# Ou étape par étape
npm run db:seed -w @enr/api -- communes     # ~35 000 communes avec contours (5 à 10 min)
npm run db:seed -w @enr/api -- postes       # 3 119 postes sources (Capareseau, ~2 min)
npm run db:seed -w @enr/api -- patrimoine   # monuments historiques
npm run db:seed -w @enr/api -- locales      # exemples de ZAER et document-cadre
npm run db:seed -w @enr/api -- secteurs     # qualifie deux secteurs de démonstration
```

L'ingestion des communes est **indispensable** : sans elle, la vue nationale (choroplèthe
communale sous le zoom 14) reste vide.

### 2.4 Lancement

```bash
npm run dev            # API sur :3000 et interface sur :5173
# ou séparément
npm run dev:api
npm run dev:web
```

Ouvrir <http://localhost:5173>.

---

## 3. Déploiement par conteneurs

```bash
export SECRET_JWT=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
docker compose up --build -d

# Migrations et amorçage dans le conteneur de l'API
docker compose exec api node dist/scripts/migrer.js
docker compose exec -e ADMIN_EMAIL=vous@exemple.fr -e ADMIN_MOT_DE_PASSE='…' api \
  node dist/scripts/seeder.js communes postes patrimoine
```

L'interface est servie par nginx sur le port `8080`, qui proxifie `/api` vers le conteneur
de l'API. Les deux images déclarent un `HEALTHCHECK` ; celui de l'API vérifie aussi que la
base répond.

**Avant toute mise en production :**

1. `NODE_ENV=production` et `AUTH_DESACTIVEE` absent ou `false`.
2. `SECRET_JWT` tiré au hasard et conservé hors du dépôt.
3. Terminaison TLS en amont (le reverse proxy doit transmettre `X-Forwarded-Proto`).
4. Sauvegarde de PostgreSQL planifiée : la base contient le pipeline commercial, seule
   donnée non reconstituable depuis les sources publiques.
5. Créer les comptes avec le rôle minimal (`lecture` par défaut) et n'accorder
   `habiliteDonneesProprietaires` qu'aux personnes réellement concernées.

---

## 4. Premier usage

1. Choisir une filière dans la barre supérieure (contrôle principal).
2. Rechercher une commune, puis zoomer jusqu'au niveau 14 : la carte passe de la vue
   communale au parcellaire.
3. Cliquer sur **Qualifier l'emprise** : les parcelles visibles dépassant la surface
   minimale sont récupérées au cadastre, enrichies par une dizaine de sources et scorées
   pour les quatre filières. Compter environ **4 à 6 secondes par parcelle** — les sources
   officielles sont limitées en débit (1 req/s côté Géoplateforme).
4. Cliquer sur une parcelle pour ouvrir sa fiche.

Pour de grandes surfaces, préférer une pré-qualification par lots hors heures ouvrées :

```bash
curl -X POST http://localhost:3000/api/qualification/emprise \
  -H 'Content-Type: application/json' \
  -d '{"bbox":[1.70,48.10,1.80,48.20],"surfaceMinM2":10000}'
```

---

## 5. Exploitation courante

```bash
npm run ingest                          # tous les jobs d'ingestion
npm run ingest -w @enr/api -- postes_sources
npm run rescorer -w @enr/api            # recalcule les scores matérialisés
npm run rescorer -w @enr/api -- solaire_sol
npm run test                            # tests du moteur de scoring
```

Voir [RAFRAICHISSEMENT.md](RAFRAICHISSEMENT.md) pour la périodicité de chaque source et
[SOURCES_DONNEES.md](SOURCES_DONNEES.md) pour leur nature et leurs limites.

### Supervision

- `GET /api/sante` : état de la base et **fraîcheur de chaque source**. Le champ
  `sourcesPerimees` liste les sources dépassant leur périodicité ; l'interface l'affiche en
  bandeau. C'est la sonde à brancher sur votre supervision.
- `GET /api/admin/ingestions` (rôle `admin`) : historique et volumétrie par connecteur.
- `GET /api/admin/journal` (rôle `admin`) : journal d'accès (RGPD).

### Purge RGPD

```bash
curl -X POST http://localhost:3000/api/admin/purge-rgpd -H "Authorization: Bearer $JETON"
```

Efface les données nominatives de propriétaires arrivées à échéance
(`proprietaire_parcelle.purge_prevue_le`). À planifier mensuellement.

---

## 6. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| `relation "parcelle" does not exist` | migrations non appliquées | `npm run db:migrate` |
| Carte grise, message « fond cartographique IGN injoignable » | `data.geopf.fr` bloqué depuis le **navigateur** | configurer le proxy du navigateur ; l'application reste utilisable (parcelles, scores et couches viennent de l'API) |
| Vue nationale vide sous le zoom 14 | communes non ingérées | `npm run ingest -w @enr/api -- communes` |
| Critères de raccordement gris | postes sources non ingérés | `npm run ingest -w @enr/api -- postes_sources` |
| Critères patrimoine gris | patrimoine non ingéré | `npm run ingest -w @enr/api -- patrimoine_culture` |
| `503 upstream connect error` sur une ingestion | `HTTPS_PROXY` non pris en compte par Node | ajouter `NODE_USE_ENV_PROXY=1` |
| `502 source_indisponible` | source externe momentanément en panne | comportement attendu : les critères concernés restent gris. Réessayer plus tard. |
| Qualification lente | limitation de débit des sources | normal. Réduire l'emprise ou augmenter `QUALIF_SURFACE_MIN_M2`. |
| Beaucoup de connecteurs en échec sur une grande emprise | saturation d'`apicarto.ign.fr` | abaisser `HTTP_CONCURRENCE` à 2 et relancer la qualification ; les parcelles déjà enrichies ne sont pas réinterrogées |
| `AUTH_DESACTIVEE est interdit en production` | garde-fou volontaire | retirer la variable et créer de vrais comptes |

## 7. Structure du dépôt

```
packages/core       Référentiel partagé : filières, critères, réglementation datée,
                    avertissements, palette, modèle ParcelleSnapshot
packages/scoring    Moteur de scoring explicable (knock-outs, score pondéré, sites)
apps/api            API Fastify, connecteurs, ingestion, tuiles vectorielles, exports
apps/web            Interface React + MapLibre
db/migrations       Schéma PostgreSQL + PostGIS
docs                Documentation, dont les contrats d'API vérifiés
```
