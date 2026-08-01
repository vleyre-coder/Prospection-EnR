# Architecture

## 1. Le problème d'échelle, et la décision qui en découle

Le parcellaire français compte environ **100 millions de parcelles**. Les pré-ingérer, puis
les enrichir avec une dizaine de sources et les scorer pour quatre filières, représenterait
plusieurs milliards d'appels externes vers des services limités à 1 requête par seconde. Ce
n'est pas réalisable, et ce serait inutile : un développeur ne prospecte jamais la France
entière, il travaille par secteurs.

L'application est donc construite sur une **qualification à la demande avec matérialisation** :

| Échelle | Ce qui est servi | Provenance |
|---|---|---|
| Zoom 5 à 13 (national, régional) | choroplèthe **communale** de potentiel | table `commune_score_filiere`, pré-calculée |
| Zoom ≥ 14 (parcellaire) | parcelles individuelles colorées par score | table `parcelle` + `score_parcelle_filiere`, remplies à la demande |

Une parcelle entre en base lorsqu'un utilisateur s'en approche ou la demande explicitement.
Son snapshot d'enrichissement et ses scores sont alors matérialisés, puis rafraîchis par lots.

Conséquence assumée : **la première visite d'un secteur est lente** (4 à 6 secondes par
parcelle), les suivantes sont instantanées. Pour de grandes surfaces, la pré-qualification
nocturne par lots est le mode d'emploi recommandé.

## 1 bis. Une instance s'initialise elle-même

Une application dont la mise en service demande huit commandes dans le bon ordre ne sera pas
mise en service. Le serveur porte donc sa propre initialisation, dans `amorcage.ts`, exécutée à
chaque démarrage et **idempotente** :

| Étape | Quand elle agit | Verrou |
|---|---|---|
| attente de PostgreSQL | la base peut démarrer après l'API (conteneurs) | — |
| migrations | une migration non appliquée existe | `pg_advisory_lock` |
| secret de signature des jetons | `SECRET_JWT` absent → tiré au hasard et conservé dans `parametre` | `ON CONFLICT` |
| compte administrateur | `ADMIN_*` fournis, ou **aucun** utilisateur en base | `ON CONFLICT` |
| données nationales | la donnée n'est pas là | `pg_try_advisory_lock` |

Deux décisions méritent d'être explicitées :

- **L'amorçage des données s'exécute après l'ouverture du port**, en arrière-plan. Charger
  35 000 communes prend cinq à dix minutes ; bloquer le démarrage rendrait l'application
  injoignable sans que l'utilisateur sache pourquoi. Son avancement est publié par
  `/api/sante` et affiché en bandeau, faute de quoi une carte vide serait indiscernable d'une
  panne.
- **La réussite d'une étape est jugée sur la présence effective de la donnée**, avec le même
  prédicat que celui qui permet de la sauter — pas sur l'absence d'exception. Un job peut se
  terminer proprement sans rien produire (jeu de données renommé côté fournisseur) ; l'annoncer
  comme réussi serait mensonger.

Le verrou non bloquant sur l'amorçage compte : en développement, `tsx watch` relance le serveur
à chaque sauvegarde, et sans lui une modification de code pendant l'ingestion des communes en
déclencherait une seconde en parallèle.

## 2. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web — React 18 + MapLibre GL                              │
│  Sélecteur de filière · carte · fiche · filtres · pondérations   │
└───────────────────────────┬─────────────────────────────────────┘
                            │  REST + tuiles vectorielles (MVT)
┌───────────────────────────▼─────────────────────────────────────┐
│  apps/api — Fastify                                             │
│  ┌───────────┐ ┌────────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │  routes   │ │  services  │ │  dépôts  │ │   ingestion     │  │
│  └───────────┘ └─────┬──────┘ └────┬─────┘ └────────┬────────┘  │
│                      │             │                │           │
│              enrichissement.ts     │                │           │
│                      │             │                │           │
│  ┌───────────────────▼──────────┐  │                │           │
│  │  connecteurs (11 sources)    │  │                │           │
│  │  client HTTP : concurrence,  │  │                │           │
│  │  tentatives, cache           │  │                │           │
│  └───────────────┬──────────────┘  │                │           │
└──────────────────┼─────────────────┼────────────────┼───────────┘
                   │                 │                │
       API publiques françaises   PostgreSQL + PostGIS
                                  (parcelles, snapshots, contraintes,
                                   postes sources, scores, prospection)
                            ▲
┌───────────────────────────┴─────────────────────────────────────┐
│  packages/scoring — moteur explicable                            │
│  packages/core — référentiel partagé (types, filières, règles)    │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Paquets partagés

### `packages/core`

Le contrat entre toutes les couches. Il ne contient **aucune logique d'accès aux données** :

- `filieres.ts` — les quatre filières, leur critère roi, leurs seuils économiques ;
- `types.ts` — `ParcelleSnapshot`, dont **tous les champs sont nullables** : c'est ce qui
  garantit qu'une donnée absente produise un critère gris et jamais une valeur inventée ;
- `criteres.ts` — catalogue des 46 critères et profils de pondération par défaut, avec un
  garde-fou au chargement du module qui rejette toute référence à un critère inexistant ;
- `reglementation.ts` — référentiel juridique **daté** ;
- `avertissements.ts` — les avertissements non négociables, globaux et contextuels ;
- `palette.ts` — les deux palettes, volontairement disjointes.

### `packages/scoring`

Fonction pure : `calculerScore(snapshot, filiere, options) → ResultatScore`. Aucun accès
réseau ni base, donc entièrement testable. Voir [SCORING.md](SCORING.md).

## 4. Backend

### 4.1 Connecteurs

Un fichier par famille de sources, tous bâtis sur `http.ts` qui apporte :

- **limitation de concurrence par domaine** (sémaphore) — indispensable face à la limite de
  1 req/s de la Géoplateforme ;
- **tentatives étagées** avec attente exponentielle, sans réessayer les 4xx définitifs ;
- **cache mémoire** à durée de vie courte ;
- **erreur typée** `ErreurSource` : l'appelant sait quelle source a échoué et laisse ses
  champs à `null` plutôt que d'inventer.

Le catalogue `connecteurs/base.ts` décrit chaque source : mode d'accès, valeur juridique,
couverture géographique, périodicité, avertissement. C'est lui qui alimente la traçabilité
affichée dans la fiche et la table `source_donnee`.

### 4.2 Pipeline d'enrichissement

`enrichissement.ts` appelle 17 connecteurs **en parallèle et indépendamment** (`Promise.all`
avec `catch` individuel), puis enchaîne les deux dépendances réelles : l'occupation du sol a
besoin de la couverture forestière **et** du zonage d'urbanisme, l'analyse foncière a besoin du
voisinage cadastral.

L'échec d'un connecteur n'invalide jamais le snapshot : il est consigné dans
`connecteursEnEchec`, remonté à l'interface et visible en bas de la fiche.

### 4.3 Tuiles vectorielles

Générées par PostGIS (`ST_AsMVT`, `ST_TileEnvelope`). Décision structurante : **la tuile porte
le statut, pas la couleur**. La coloration est faite côté client par expression de style
MapLibre, ce qui permet de recolorer instantanément au changement de filière ou de pondération
sans retélécharger une seule tuile.

La couche communale applique une **simplification dépendante du zoom**
(`ST_SimplifyPreserveTopology`), sans quoi la vue nationale transférerait des dizaines de
mégaoctets de contours.

### 4.4 Exports

- **PDF** : pdfkit, mise en page A4, avec les sources, leur fraîcheur et les avertissements ;
- **CSV** : point-virgule, BOM UTF-8, virgule décimale — ouverture directe dans Excel FR ;
- **GeoJSON** : avec un bloc `metadata` portant l'avertissement de valeur juridique ;
- **Shapefile** : écriture SHP/SHX/DBF/PRJ/CPG **autonome**, sans dépendance. Les
  bibliothèques JavaScript disponibles sont abandonnées ou orientées navigateur ; le format
  est stable et publiquement spécifié. L'archive inclut un fichier « LISEZ-MOI » rappelant les
  avertissements et la troncature des noms de champs à 10 caractères imposée par le DBF.

## 5. Base de données

| Table | Rôle |
|---|---|
| `source_donnee` + vue `v_source_fraicheur` | traçabilité et **péremption** de chaque source |
| `couverture_ingestion` | distingue « aucune contrainte » de « territoire non ingéré » |
| `commune`, `commune_score_filiere` | socle et agrégats de la vue nationale |
| `parcelle` | cache parcellaire à la demande |
| `parcelle_snapshot` | snapshot d'enrichissement en JSONB |
| `contrainte` | couches spatiales génériques, index GiST |
| `zaer`, `document_cadre_pv` | couches sans API nationale |
| `poste_source`, `point_injection_gaz`, `canalisation_gaz` | réseaux |
| `score_parcelle_filiere` | scores matérialisés par filière et profil |
| `site`, `site_parcelle` | agrégats de parcelles |
| `lead`, `lead_evenement`, `document` | pipeline commercial |
| `utilisateur`, `profil_ponderation`, `filtre_sauvegarde` | comptes et préférences |
| `parametre` | secrets générés par l'instance, jamais exposés |
| `proprietaire_parcelle` | **table isolée** de données à caractère personnel |
| `journal_acces` | journalisation RGPD |

Deux choix méritent explication :

- **`parcelle_snapshot` en JSONB** : le modèle d'enrichissement évolue au rythme des sources
  disponibles. Le stocker en colonnes imposerait une migration à chaque nouvelle donnée. Les
  filtres portant sur le snapshot (pente, type de sol, distance au poste) interrogent
  directement le JSONB, ce qui reste indexable si le besoin s'en fait sentir.
- **Historique par trigger** : `trg_lead_historique` journalise tout changement de statut au
  niveau de la base, avec l'utilisateur transmis par `set_config('app.utilisateur')`. Un
  historique commercial ne doit pas pouvoir être contourné par un chemin de code oublié.

## 5 bis. Deux garde-fous appris à l'usage

**L'emprise pilote tout, donc elle doit être bornée.** La qualification part des bornes
affichées par MapLibre. Trois façons dont cela dérape : `getBounds()` peut renvoyer des
longitudes hors de [-180, 180] quand le monde est répété ; une vue large déborde largement
le territoire couvert ; une emprise régionale représente des semaines de traitement.
`normaliserEmprise` refuse ou rogne dans ces trois cas, et un **verrou de bordure** écarte
ensuite toute parcelle dont le centroïde tombe hors de l'emprise — un service peut toujours
renvoyer des objets débordants. Côté carte, `maxBounds` et `renderWorldCopies: false`
suppriment le problème à la source. Tests : `apps/api/test/emprise.test.ts`.

**Une absence de donnée n'est pas une valeur.** `ST_AsMVT` omet purement et simplement les
attributs nuls. Une commune sans parcelle qualifiée n'a donc pas d'attribut
`nb_parcelles_qualifiees`, un test `== 0` est faux, `to-number` rend 0, et le ratio 0
peignait la commune en **rouge** : la France entière apparaissait rédhibitoire au lancement,
alors que rien n'avait été analysé. Toute expression de style lisant un attribut de tuile
doit donc distinguer *absent* de *zéro* avec `has`. Même principe pour les parcelles : sans
score, elles ne sont pas colorées du tout — le gris reste réservé au statut « données
manquantes » d'une parcelle réellement analysée.

## 6. Frontend

Voir [apps/web/README.md](../apps/web/README.md). Deux points d'architecture :

- **la carte reste montée en permanence**, masquée par `visibility` lorsque l'utilisateur passe
  en liste ou en tableau de bord : la démonter perdrait le contexte WebGL et la position de
  navigation ;
- **le fond de carte a deux chemins**. Les tuiles IGN sont demandées en direct par le
  navigateur — chemin le plus court, servi par le réseau de diffusion de la Géoplateforme.
  Quand ces appels échouent (réseau filtrant, proxy que le navigateur ne traverse pas), la
  carte bascule **automatiquement** sur le relais `/api/carte/fond/:fond/:z/:x/:y` de l'API,
  qui reproxifie les tuiles avec un cache d'une semaine. La liste des fonds relayés est
  fermée, pour que le relais ne devienne pas un proxy ouvert ;
- **l'interface peut être servie par l'API**. Dès que `apps/web/dist` existe, Fastify le sert
  avec un repli page unique : une installation locale n'a alors qu'un port à ouvrir. En
  déploiement par conteneurs, nginx garde ce rôle — il apporte la compression et le cache
  d'en-têtes que Fastify n'a pas ici ;
- **l'écran de connexion n'apparaît que lorsqu'il sert.** Le frontend interroge
  `/api/auth/moi` ; en développement (`AUTH_DESACTIVEE`) l'API répond une identité et l'écran
  est sauté, en production un 401 le déclenche ;
- **les couches métier sont installées sur `style.load`, pas sur `load`**. MapLibre n'émet
  `load` que lorsque toutes les sources du style sont résolues : un fond de carte injoignable
  privait donc l'utilisateur des parcelles, des scores et des contraintes. Un filet de sécurité
  temporisé garantit l'installation en toute circonstance, et l'échec du fond est signalé.

## 7. Sécurité et RGPD

- **Authentification** JWT, mots de passe en scrypt avec sel par utilisateur, comparaison en
  temps constant. Message d'erreur identique que le compte existe ou non.
- **Rôles** : `admin`, `prospection`, `lecture`. Le rôle `lecture` ne peut pas modifier le
  pipeline.
- **`AUTH_DESACTIVEE`** facilite le développement mais le serveur **refuse de servir les routes
  protégées si `NODE_ENV=production`**.
- **Aucun secret ni mot de passe par défaut.** À défaut de `SECRET_JWT`, un secret aléatoire est
  généré et conservé en base ; à défaut d'`ADMIN_MOT_DE_PASSE`, et seulement si la base ne
  contient aucun utilisateur, un mot de passe aléatoire est généré et affiché **une seule fois**
  dans les journaux. Une installation sans configuration reste ainsi utilisable sans jamais
  reposer sur une valeur devinable.
- **Données de propriétaires** : table isolée, habilitation explicite par utilisateur, motif
  d'accès obligatoire en en-tête, et **journalisation stricte** — si la trace ne peut pas être
  écrite, l'accès est refusé. La journalisation courante (exports, modifications) est au
  contraire tolérante : elle ne doit pas faire échouer l'action métier.
- **Minimisation et durée de conservation** : `purge_prevue_le` et la fonction
  `purger_donnees_nominatives()`.
- Les données nominatives ne sont **jamais** servies dans les tuiles vectorielles ni dans les
  exports non habilités.

## 8. Limites connues

1. **Qualification lente à grande échelle** — conséquence directe des limitations de débit des
   sources publiques. Atténuée par la pré-qualification par lots et le cache.
2. **Le règlement écrit des PLU n'est pas lu.** La compatibilité d'un zonage est une
   *probabilité*, pas une conclusion ; l'URL du règlement est systématiquement fournie.
3. **Le zonage réglementaire des PPR n'est pas disponible** par API : l'application signale la
   présence d'un PPR, pas la couleur de la zone.
4. **Le vent est désormais couvert** par le raster Global Wind Atlas (250 m), et les
   **servitudes aéronautiques, radioélectriques et les périmètres de captage** par les SUP du
   GPU — avec la réserve que la couverture du GPU est territoriale. Restent non couverts : les
   **positions des radars météorologiques et militaires** (aucun jeu national ouvert
   réutilisable identifié) et la **densité d'intrants méthanisables** (pas de base nationale
   d'élevages).
5. **ZAER et documents-cadres** exigent une ingestion territoire par territoire.
6. **Le bundle frontend dépasse 1 Mo** (MapLibre GL), soit 304 ko compressés. Un découpage en
   segments serait possible mais la carte est nécessaire dès le premier écran.

## 9. Évolutions naturelles

- pré-génération des tuiles parcellaires pour les départements prioritaires ;
- ingestion des rasters de vent et des couches d'élevage, pour lever les deux critères gris qui
  pèsent le plus (éolien et méthanisation) ;
- lecture assistée des règlements de PLU ;
- alertes sur événement : nouvelle capacité de raccordement, nouvelle ZAER, renforcement mis en
  service ;
- suivi du calendrier S3REnR poste par poste.
