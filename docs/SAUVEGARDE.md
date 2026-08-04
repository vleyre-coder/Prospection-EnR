# Sauvegarde et restauration

## Ce qui est perdu si la base disparaît

C'est la question qui détermine tout le reste, et la réponse n'est pas « tout » :

| Donnée | Reconstituable ? | Comment |
|---|---|---|
| Parcelles cadastrales | **Oui** | Ré-ingestion PCI / API Carto |
| Contraintes (zonages, milieux, risques) | **Oui** | Ré-ingestion des sources publiques |
| Snapshots de qualification | **Oui** | Nouvelle qualification d'emprise |
| Scores | **Oui** | Recalcul automatique au démarrage |
| Postes sources, réseaux | **Oui** | Ré-ingestion Capareseau / GRDF |
| **Leads et statuts de prospection** | **NON** | — |
| **Sites constitués** | **NON** | — |
| **Historique des leads** (`lead_evenement`) | **NON** | — |
| **Documents déposés sur un lead** | **NON** | Les fichiers sont hors base, cf. dernière section |
| **Comptes utilisateurs** | **NON** | — |
| **Journal d'accès** (`journal_acces`) | **NON** | Obligation RGPD |
| **Filtres sauvegardés, paramètres, profils de pondération** | **NON** | — |
| **Données de propriétaires** (`proprietaire_parcelle`) | **NON** | Table non alimentée à ce jour |

Les six dernières lignes sont le patrimoine de l'application. Tout le reste est un cache,
long à reconstruire (plusieurs heures d'ingestion nationale) mais reconstructible sans perte.

**Conséquence sur la stratégie.** Une sauvegarde complète est confortable mais lourde ; une
sauvegarde du seul patrimoine est légère et suffit à ne rien perdre d'irremplaçable. Les deux
sont décrites ci-dessous. Si vous n'en mettez qu'une en place, mettez la seconde — elle tient
en quelques mégaoctets et se restaure en une minute.

Le journal d'accès aux données de propriétaires mérite une mention à part : il matérialise la
traçabilité que le RGPD impose. Le perdre, c'est perdre la preuve que les consultations ont
été motivées et habilitées.

## Sauvegarde complète

```bash
# Adapter l'URL a votre installation ; elle est dans .env sous DATABASE_URL.
export DATABASE_URL="postgres://enr:motdepasse@localhost:5432/prospection_enr"

pg_dump --format=custom --compress=9 \
        --file="sauvegarde-enr-$(date +%F).dump" \
        "$DATABASE_URL"
```

`--format=custom` et non du SQL brut : le format permet une restauration sélective (table par
table) et se restaure en parallèle. La compression divise la taille par cinq à dix.

Ordre de grandeur : la base d'un département entièrement qualifié pèse quelques gigaoctets,
dont l'essentiel en géométries cadastrales — c'est-à-dire dans la partie reconstituable.

## Sauvegarde du seul patrimoine

```bash
pg_dump --format=custom --compress=9 \
        --table=lead --table=lead_evenement --table=document \
        --table=site --table=site_parcelle \
        --table=utilisateur --table=journal_acces \
        --table=parametre --table=profil_ponderation --table=filtre_sauvegarde \
        --table=proprietaire_parcelle \
        --file="patrimoine-enr-$(date +%F).dump" \
        "$DATABASE_URL"
```

> **Vérifiez cette liste** avant de vous y fier : elle doit couvrir toutes les tables non
> reconstituables. Comparez-la au schéma courant :
>
> ```bash
> psql "$DATABASE_URL" -c "\dt"
> ```
>
> Une table applicative ajoutée après la rédaction de ce document ne sera pas sauvegardée par
> la commande ci-dessus. C'est la faiblesse structurelle d'une liste explicite, et la raison
> pour laquelle la sauvegarde complète reste préférable si la place le permet.

## Automatisation

Sauvegarde quotidienne à 2 h, rétention de 30 jours :

```cron
0 2 * * * /usr/local/bin/sauvegarde-enr.sh >> /var/log/sauvegarde-enr.log 2>&1
```

```bash
#!/bin/bash
# /usr/local/bin/sauvegarde-enr.sh
set -euo pipefail

DEST=/var/sauvegardes/enr
URL="postgres://enr:motdepasse@localhost:5432/prospection_enr"
mkdir -p "$DEST"

FICHIER="$DEST/enr-$(date +%F-%H%M).dump"
pg_dump --format=custom --compress=9 --file="$FICHIER" "$URL"

# Une sauvegarde jamais relue n'est pas une sauvegarde : on verifie que l'archive est
# lisible et qu'elle contient bien les tables non reconstituables.
pg_restore --list "$FICHIER" | grep -q ' TABLE DATA public lead ' \
  || { echo "ECHEC : la table lead est absente de $FICHIER"; exit 1; }

find "$DEST" -name 'enr-*.dump' -mtime +30 -delete
echo "$(date -Is) sauvegarde OK : $FICHIER ($(du -h "$FICHIER" | cut -f1))"
```

La vérification `pg_restore --list` est le point important. Une sauvegarde qui échoue
silencieusement — disque plein, mot de passe changé, table renommée — produit un fichier qui
paraît normal jusqu'au jour de la restauration.

**Le fichier doit sortir de la machine.** Une sauvegarde sur le même disque que la base ne
protège que de l'erreur humaine, pas de la panne matérielle ni du chiffrement par rançongiciel.
Copiez-la sur un stockage distinct (`rclone`, `rsync` vers un autre hôte, stockage objet).

**Le dump contient des données personnelles** : comptes utilisateurs, journal d'accès, et
noms de propriétaires si `proprietaire_parcelle` est un jour alimentée. Il relève du même régime de protection que
la base — accès restreint, et chiffrement si le stockage est externalisé.

## Restauration

### Base entière, sur une instance vierge

```bash
createdb prospection_enr
psql -d prospection_enr -c "CREATE EXTENSION postgis;"

pg_restore --dbname=prospection_enr --jobs=4 --no-owner \
           sauvegarde-enr-2026-08-04.dump
```

`--jobs=4` restaure en parallèle. `--no-owner` évite un échec si le rôle propriétaire n'existe
pas sur la nouvelle instance.

L'extension PostGIS doit être créée **avant** : le dump contient des colonnes `geometry` que
PostgreSQL ne sait pas typer sans elle.

### Patrimoine seul, sur une base déjà en service

```bash
pg_restore --dbname="$DATABASE_URL" --data-only --no-owner \
           --table=lead --table=lead_evenement --table=document \
           --table=site --table=site_parcelle \
           patrimoine-enr-2026-08-04.dump
```

`--data-only` : le schéma existe déjà. Attention, les lignes sont **ajoutées**, ce qui peut
violer une clé primaire si les mêmes leads sont déjà présents. Videz les tables cibles d'abord
si vous restaurez par-dessus des données existantes :

```sql
BEGIN;
TRUNCATE document, lead_evenement, site_parcelle, site, lead CASCADE;
COMMIT;
```

### Après restauration

1. **Relancer les migrations** — la sauvegarde peut précéder une migration :
   ```bash
   npm run migrate --workspace @enr/api
   ```
2. **Démarrer l'API.** Elle détecte au démarrage que les scores ont été calculés par une autre
   version du moteur et les recalcule seule (`rescorerSiVersionObsolete`). Rien à faire.
3. **Vérifier l'état des sources** sur `/api/sante` : les millésimes restaurés peuvent être
   périmés, et l'application le signalera.
4. **Contrôler ce qui compte** :
   ```sql
   SELECT count(*) FROM lead;
   SELECT count(*) FROM site;
   SELECT count(*) FROM journal_acces;
   ```

## Tester la restauration

Une procédure de restauration jamais exécutée est une hypothèse, pas une garantie. **Une fois
par trimestre**, restaurez la dernière sauvegarde sur une base jetable :

```bash
createdb enr_test_restauration
psql -d enr_test_restauration -c "CREATE EXTENSION postgis;"
pg_restore --dbname=enr_test_restauration --jobs=4 --no-owner derniere.dump

psql -d enr_test_restauration -c "SELECT count(*) FROM lead;"
psql -d enr_test_restauration -c "SELECT count(*) FROM site;"

dropdb enr_test_restauration
```

Quinze minutes par trimestre. C'est le seul moyen de savoir que la sauvegarde fonctionne
avant d'en avoir besoin.

## Ce que la sauvegarde ne couvre pas

- **Le fichier `.env`** — il porte `SECRET_JWT` et les identifiants de base. Il n'est pas dans
  le dépôt (à raison) et n'est pas dans le dump. Le conserver séparément, dans un gestionnaire
  de secrets ou un coffre. Perdre `SECRET_JWT` invalide toutes les sessions en cours ; ce n'est
  pas grave. Perdre les identifiants de base sans les avoir notés ailleurs, si.
- **Les fichiers ingérés localement** (archives Shapefile, exports téléchargés). Ils sont
  re-téléchargeables depuis les sources publiques.
- **Les pièces jointes des leads.** La table `document` porte un `chemin` : le fichier lui-même
  est sur le disque, pas dans la base. Sauvegarder la base sans ce répertoire produit des
  références vers des fichiers absents. Le chemin de stockage est celui configuré pour les
  dépôts de documents ; il doit être inclus dans la sauvegarde système ou copié séparément :

  ```bash
  # Le repertoire referencé par document.chemin, a adapter a votre installation.
  psql "$DATABASE_URL" -tAc "SELECT DISTINCT regexp_replace(chemin, '/[^/]+$', '') FROM document;"
  ```
