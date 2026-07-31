# Héberger l'application

## 1. La question qui décide de tout

Cette application n'est pas un site statique avec quelques appels d'API. Elle a besoin de
quatre choses qu'un hébergeur de sites statiques — Netlify, Vercel, Cloudflare Pages,
GitHub Pages — ne fournit pas :

| Besoin | Pourquoi | Netlify seul |
|---|---|---|
| **PostgreSQL + PostGIS** | les tuiles vectorielles sont générées en base par `ST_AsMVT` ; les recherches de proximité reposent sur des index GiST | ✗ (Netlify Database existe, mais elle ne remplace pas les trois autres points) |
| **Un processus permanent** | l'ingestion des 35 000 communes dure 5 à 10 minutes ; la qualification d'une emprise, plusieurs minutes | ✗ fonctions éphémères |
| **Un disque persistant** | le raster de gisement de vent fait 55 Mo et est lu en accès aléatoire, pixel par pixel | ✗ pas de système de fichiers persistant |
| **Des requêtes longues** | une vingtaine de sources officielles limitées à 1 req/s, soit 4 à 6 s par parcelle | ✗ les passerelles coupent bien avant |

**Conclusion :** l'**interface** peut vivre sur Netlify, exactement comme vos autres
applications. L'**API** a besoin d'un hébergeur qui sait faire tourner un conteneur.

Ce n'est pas une limite de conception : c'est ce que coûte le fait de servir du parcellaire
cadastral national et de générer des tuiles vectorielles à la volée.

---

## 2. Les trois options, du plus simple au plus proche de vos habitudes

### Option A — Sur votre poste (le plus simple, gratuit)

C'est ce que fait `./demarrer.sh`. L'application tourne sur votre PC, les données ne sortent
pas de la machine, aucun abonnement. Vous pouvez cloner le dépôt **n'importe où** — c'est un
dossier ordinaire :

```bash
cd ~/Documents/Projets          # ou D:\Projets sous Windows
git clone https://github.com/vleyre-coder/Prospection-EnR.git
cd Prospection-EnR
./demarrer.sh
```

Rien n'est lié à un emplacement particulier. Vous pouvez même avoir plusieurs copies : les
volumes Docker sont nommés d'après le dossier, donc deux copies dans deux dossiers
différents ont deux bases distinctes.

**Limite :** accessible seulement depuis ce poste. À plusieurs, il faut l'option B.

### Option B — Un seul service en ligne (recommandé pour un usage partagé)

L'image de l'API **embarque l'interface** : un seul service et une base suffisent, sous une
seule URL en HTTPS. Le dépôt contient un `render.yaml`, qui donne exactement l'expérience
que vous connaissez de Netlify — connecter le dépôt GitHub, une console web, un déploiement
automatique à chaque `git push` :

1. sur [render.com](https://render.com) : **New → Blueprint**, connecter ce dépôt ;
2. Render lit `render.yaml` et crée le service Docker + la base PostgreSQL (région
   **Frankfurt**) ;
3. avant le premier démarrage, renseigner `ADMIN_EMAIL` et `ADMIN_MOT_DE_PASSE` dans les
   variables du service — sinon le mot de passe généré n'est visible que dans les journaux ;
4. le premier démarrage applique le schéma et charge les données nationales en arrière-plan.

À prévoir : le plan `basic-256mb` de la base et le plan `starter` du service sont payants
(quelques euros par mois chacun). Le plan gratuit de Render ne conviendrait pas : la base
gratuite expire au bout de 30 jours et le service gratuit s'endort, ce qui interromprait
l'ingestion.

La même image se déploie sur **Railway**, **Fly.io**, **Scalingo** (hébergeur français) ou
un simple **VPS** avec `docker compose up -d`. Le seul point à vérifier chez un hébergeur
est la disponibilité de **PostGIS** : c'est le cas chez Render, chez Supabase et chez Neon,
pas chez tous.

### Option C — Interface sur Netlify, API ailleurs

Si vous voulez garder votre chaîne Netlify, c'est possible : le dépôt contient un
`netlify.toml` et un script de construction dédié.

1. déployer d'abord l'API (option B) et noter son URL, par exemple
   `https://enr-api.onrender.com` ;
2. sur Netlify : **Add new site → Import from GitHub**, choisir ce dépôt. `netlify.toml` est
   détecté, aucune commande à saisir ;
3. dans **Site configuration → Environment variables**, ajouter :

   ```
   URL_API = https://enr-api.onrender.com
   ```

Netlify construit alors `apps/web` et **reproxifie `/api` vers votre API** : pour le
navigateur tout vient de la même origine, il n'y a aucun CORS à régler.

> **Une limite à connaître.** Les passerelles des hébergeurs statiques coupent les requêtes
> longues, de l'ordre de la trentaine de secondes. La qualification d'une emprise peut
> durer plusieurs minutes : elle échouerait à travers le proxy. Deux issues.

**Issue 1 — appel direct de l'API.** Ajouter `APPEL_DIRECT=1` aux variables Netlify.
L'interface appelle alors l'API sur son propre domaine, sans proxy et sans limite de durée.
Il faut en échange autoriser l'origine du site côté API :

```
ORIGINES_AUTORISEES=https://votre-site.netlify.app
```

**Issue 2 — qualifier par lots côté serveur**, hors de l'interface, ce qui est de toute
façon la bonne pratique pour de grandes surfaces :

```bash
curl -X POST https://enr-api.onrender.com/api/qualification/emprise \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $JETON" \
  -d '{"bbox":[1.70,48.10,1.80,48.20],"surfaceMinM2":10000}'
```

Franchement : l'option C ajoute une plateforme, un domaine et un réglage CORS sans rien
apporter que l'option B ne fasse déjà. Elle ne se justifie que si vous tenez à héberger
l'interface avec vos autres sites.

---

## 3. Récapitulatif

| | A — poste local | B — un service | C — Netlify + API |
|---|---|---|---|
| Coût | gratuit | ~10 €/mois | ~10 €/mois |
| Accessible à plusieurs | non | oui | oui |
| Nombre de plateformes | 0 | 1 | 2 |
| HTTPS et nom de domaine | non | oui | oui |
| Requêtes longues | oui | oui | non, sauf `APPEL_DIRECT=1` |
| Données hors de vos murs | non | oui | oui |

---

## 4. Données personnelles : ce que le choix d'hébergement engage

L'application peut contenir des **données nominatives de propriétaires** (table isolée,
habilitation explicite, journalisation stricte). Trois conséquences concrètes :

1. **Héberger dans l'Union européenne.** `render.yaml` fixe la région `frankfurt`. Sur un
   autre hébergeur, vérifier la région avant création : elle n'est pas modifiable ensuite.
2. **Le sous-traitant doit être identifié** dans votre registre de traitements, avec un
   accord de sous-traitance. Un hébergeur américain, même en région européenne, demande un
   examen supplémentaire.
3. **L'option A évite entièrement la question** : rien ne quitte le poste. C'est un argument
   sérieux pour un usage individuel.

---

## 5. Sauvegardes

La base contient la seule donnée non reconstituable depuis les sources publiques : **votre
pipeline commercial** (leads, statuts, historiques, notes, sites). Tout le reste se
retélécharge.

```bash
# Sauvegarde (les deux options)
docker compose exec -T bdd pg_dump -U enr prospection_enr | gzip > sauvegarde-$(date +%F).sql.gz

# Restauration
gunzip -c sauvegarde-2026-07-31.sql.gz | docker compose exec -T bdd psql -U enr prospection_enr
```

Sur un hébergeur managé, activer les sauvegardes automatiques de la base — et vérifier une
fois qu'une restauration fonctionne réellement.

---

## Sources

- [Render — extensions PostgreSQL supportées, dont PostGIS](https://render.com/docs/postgresql-extensions)
- [Render — référence du fichier Blueprint](https://render.com/docs/blueprint-spec)
- [Render — types d'instances PostgreSQL](https://render.com/docs/postgresql-refresh)
- [Netlify — vue d'ensemble des Functions (environnement éphémère)](https://docs.netlify.com/build/functions/overview/)
- [Netlify — Background Functions, limite de 15 minutes](https://docs.netlify.com/build/functions/background-functions/)
- [Neon — extension PostGIS](https://neon.com/docs/extensions/postgis)
- [Netlify Database, propulsée par Neon](https://neon.com/blog/netlify-db-powered-by-neon)
