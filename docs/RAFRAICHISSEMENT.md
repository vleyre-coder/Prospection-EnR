# Rafraîchissement des données

## 1. Deux régimes

| Régime | Sources | Rafraîchissement |
|---|---|---|
| **Temps réel** | cadastre, GPU, RPG, AOP, INPN, Géorisques, altimétrie, BD TOPO, BD Forêt, zones humides, PVGIS, géocodage | aucun job. Interrogation à la qualification, cache mémoire de 15 min. Un snapshot de parcelle est réinterrogé au-delà de `SNAPSHOT_MAX_AGE_JOURS` (30 j par défaut). |
| **Ingestion par lots** | postes sources, communes, patrimoine, réseau gaz, ZAER, document-cadre | jobs planifiés, périodicité ci-dessous. |

## 2. Périodicité recommandée

| Connecteur | Périodicité | Commande | Pourquoi |
|---|---|---|---|
| `postes_sources` | **mensuelle** | `npm run ingest -w @enr/api -- postes_sources` | les capacités évoluent en continu au fil des demandes de raccordement. Endpoints non contractuels : ne pas interroger plus souvent. |
| `communes` | annuelle | `npm run ingest -w @enr/api -- communes` | fusions et changements de contours |
| `patrimoine_culture` | semestrielle | `npm run ingest -w @enr/api -- patrimoine_culture` | nouvelles protections |
| `vent_100m` | annuelle | `npm run ingest -w @enr/api -- vent_100m` | raster Global Wind Atlas (55 Mo), republié à chaque nouvelle version du modèle |
| `reseau_gaz` | trimestrielle | `npm run ingest -w @enr/api -- reseau_gaz` | nouveaux sites d'injection |
| `zaer_local` | trimestrielle | ingestion manuelle | au fil des délibérations |
| `document_cadre_local` | semestrielle | ingestion manuelle | au fil des arrêtés préfectoraux |
| Rescoring | après un changement de moteur, de référentiel ou de barème | `npm run rescorer -w @enr/api` | les scores matérialisés ne se recalculent pas d'eux-mêmes |
| Réenrichissement | **après chaque ingestion** | bandeau « parcelles en retard sur la donnée », ou `POST /api/qualification/rafraichir` | voir §5.1 : `rescorer` NE réinterroge aucune source, donc il reproduit la valeur d'avant l'ingestion |
| Purge RGPD | mensuelle | `POST /api/admin/purge-rgpd` | données nominatives arrivées à échéance |

## 3. Planification

`crontab` (heures creuses, sources publiques à ménager) :

```cron
# Postes sources : le 1er du mois à 3 h, puis rescoring
0 3 1 * *  cd /opt/prospection-enr && npm run ingest -w @enr/api -- postes_sources >> /var/log/enr-ingest.log 2>&1
0 5 1 * *  cd /opt/prospection-enr && npm run rescorer -w @enr/api >> /var/log/enr-ingest.log 2>&1

# Patrimoine et réseau gaz : le 2 du mois
0 3 2 * *  cd /opt/prospection-enr && npm run ingest -w @enr/api -- patrimoine_culture reseau_gaz >> /var/log/enr-ingest.log 2>&1

# Communes et raster de vent : le 15 janvier
0 2 15 1 * cd /opt/prospection-enr && npm run ingest -w @enr/api -- communes vent_100m >> /var/log/enr-ingest.log 2>&1

# Snapshots perimes : dimanche 2 h. `rescorer` ne reinterroge AUCUNE source (voir §5.1) : ce qui
# reprend les parcelles en retard sur la donnee est la route de rafraichissement.
0 2 * * 0  cd /opt/prospection-enr && npm run rescorer -w @enr/api >> /var/log/enr-ingest.log 2>&1
0 3 * * 0  curl -fsS -X POST -H "Authorization: Bearer $JETON_ADMIN" -H 'Content-Type: application/json' \
             -d '{"limite":500}' http://localhost:3000/api/qualification/rafraichir >> /var/log/enr-ingest.log 2>&1

# Purge RGPD : le 1er du mois
30 1 1 * * curl -fsS -X POST -H "Authorization: Bearer $JETON_ADMIN" http://localhost:3000/api/admin/purge-rgpd
```

En conteneurs, préfixer par `docker compose exec -T api` et appeler les scripts compilés
(`node dist/scripts/ingerer.js …`).

Les jobs peuvent aussi être déclenchés par l'API (rôle `admin`) :

```bash
curl -X POST -H "Authorization: Bearer $JETON" \
  http://localhost:3000/api/admin/ingestions/postes_sources
```

## 4. Surveillance de la fraîcheur

Chaque job met à jour `source_donnee` (date de dernière ingestion réussie, statut, message,
volumétrie). La vue `v_source_fraicheur` calcule le dépassement de périodicité.

```bash
curl -s localhost:3000/api/sante | jq '.sourcesPerimees'
```

Une source périmée est affichée **en bandeau dans l'interface**, avec la liste des connecteurs
concernés. C'est la sonde à brancher sur la supervision :

```bash
# Sortie non nulle si au moins une source est périmée
curl -fsS localhost:3000/api/sante | jq -e '.sourcesPerimees | length == 0' > /dev/null
```

Un job en échec **ne remet pas à jour** `date_derniere_ingestion` : la source reste signalée
comme périmée jusqu'à une exécution réussie. Les données précédentes sont conservées — mieux
vaut une donnée datée et signalée qu'une absence de donnée.

## 5. Recalcul des scores

Les scores sont matérialisés dans `score_parcelle_filiere` sous le profil `defaut`. Ils
doivent être recalculés dans trois cas :

1. **après une ingestion** : une nouvelle capacité de poste change le critère roi du stockage ;
2. **après une modification des pondérations par défaut** ou du référentiel réglementaire ;
3. **après un changement de version du moteur** (`VERSION_MOTEUR`) : `rescorerTout` supprime
   d'abord les scores produits par une version antérieure, ce qui évite de mélanger des
   résultats issus de règles différentes.

```bash
npm run rescorer -w @enr/api                 # toutes les filières
npm run rescorer -w @enr/api -- solaire_sol  # une filière
```

Le recalcul rafraîchit aussi les compteurs communaux
(`rafraichir_compteurs_communaux()`), qui alimentent la choroplèthe de la vue nationale.

Les pondérations **personnalisées par l'utilisateur** ne sont jamais matérialisées : elles
sont calculées à la volée (`POST /api/parcelles/scores`) et appliquées côté carte par
`setFeatureState`. Déplacer un curseur ne déclenche donc aucun recalcul de masse.

### 5.1 Recalculer ne suffit pas : après une ingestion, il faut RÉENRICHIR

Ajouté à l'audit 9, où la confusion entre les deux a produit un défaut critique. Le cas 1 ci-dessus
— « après une ingestion » — **ne se traite pas par `rescorer`**. `rescorer` recalcule à partir du
snapshot déjà stocké, sans interroger aucune source : après une ingestion, il reproduit donc
fidèlement la valeur d'avant. La distinction est la suivante :

| Besoin | Ce qu'il faut lancer | Ce que ça touche |
|---|---|---|
| Le moteur, le référentiel ou un barème a changé | `npm run rescorer` | recalcul à partir des snapshots existants, hors ligne |
| Une couche a été ingérée ou mise à jour | **réenrichissement** | les sources sont réinterrogées, le snapshot est réécrit |

Comment le réenrichissement se déclenche, du plus automatique au plus explicite :

1. **ouvrir la fiche d'une parcelle** la réenrichit si son snapshot précède la dernière ingestion de
   son département, ou dépasse `SNAPSHOT_MAX_AGE_JOURS` ;
2. **toute campagne de qualification** (emprise, liste d'IDU) réenrichit les parcelles concernées
   selon la même règle ;
3. **`POST /api/qualification/rafraichir`**, exposé dans l'interface par le bandeau « parcelles en
   retard sur la donnée », reprend un lot borné. `restant` indique s'il faut rappeler.

Le nombre de parcelles en retard est publié par `/api/sante`, champ `parcellesARafraichir`. **C'est
l'indicateur à regarder après chaque ingestion** : tant qu'il est non nul, la carte et les listes
affichent l'état d'avant pour ces parcelles.

Le rafraîchissement en lot n'est pas un travail de fond, et c'est délibéré : il consomme le quota des
API publiques exactement comme une campagne de qualification, et le déclencher tout seul viendrait
concurrencer les campagnes de l'utilisateur sur ce même quota.

### 5.2 Ce qu'une ingestion efface, et quand elle refuse de le faire

Ajouté à l'audit 9. Les ingestions nationales des ZAER et des sites protégés effacent désormais les
objets qu'elles n'ont pas revus — un site déclassé, une délibération annulée. Deux conditions
indépendantes doivent être réunies, sinon **rien n'est effacé** :

1. la pagination doit être allée au bout de **toutes** les couches (métropole et outre-mer) ;
2. la part disparue doit rester sous **20 %** du jeu du connecteur.

Un refus est journalisé et repris dans le compte rendu d'ingestion, avec son chiffre. **Un refus
signifie que la couche contient des objets périmés** : vérifier la source, puis relancer. Ce
comportement est volontairement conservateur — une couche contenant des objets périmés signalés vaut
mieux qu'une couche vidée en silence par une source momentanément tronquée.

L'ingestion des postes sources n'est pas concernée : elle procède région par région et tolère l'échec
de l'une d'elles, si bien qu'un objet disparu y serait indiscernable d'une région non lue.

## 6. Effet du rafraîchissement sur le pipeline commercial

Un lead conserve le score qu'avait la parcelle **au moment de sa prise en prospection**
(`lead.score_initial`). La fiche compare ce score au score courant et signale un écart
notable : c'est ainsi qu'un chargé de prospection apprend qu'un poste source s'est saturé ou
qu'un zonage a changé depuis sa première visite.

Le rafraîchissement ne modifie **jamais** les statuts de prospection, les notes ni
l'historique : les données métier saisies par les équipes sont indépendantes des données
sources.

## 7. Budget d'appels et limitations de débit

| Source | Limitation constatée | Précaution appliquée |
|---|---|---|
| `data.geopf.fr` (WFS, altimétrie) | **1 req/s**, rafale de 30 | concurrence limitée par domaine, cache 15 min, un seul POST altimétrique par parcelle (36 points) |
| `apicarto.ign.fr` | non documentée | concurrence limitée ; sur de grandes emprises, abaisser `HTTP_CONCURRENCE` à 2 |
| `georisques.gouv.fr` | non documentée, indisponibilités sporadiques | 3 tentatives avec attente exponentielle |
| `capareseau.fr` | non contractuel | ingestion mensuelle uniquement |
| ODRE / Opendatasoft | 10 millions de requêtes par jour | sans objet |

Une qualification représente environ **25 à 30 appels externes par parcelle**, soit 4 à
6 secondes. Pour un département entier, prévoir une pré-qualification par lots nocturne
plutôt qu'une qualification interactive.
