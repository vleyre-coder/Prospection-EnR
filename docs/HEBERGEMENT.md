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
git clone https://github.com/Llegender/Prospection_EnR.git
cd Prospection_EnR
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
   URL_API           = https://enr-api.onrender.com
   MOT_DE_PASSE_SITE = <au moins 16 caractères tirés au hasard>
   ```

Netlify construit alors `apps/web` et **reproxifie `/api` vers votre API** : pour le
navigateur tout vient de la même origine, il n'y a aucun CORS à régler.

`MOT_DE_PASSE_SITE` arme le **portail d'accès** décrit au §6. Sans cette variable, la
construction **échoue** avec un message qui propose une valeur à copier : on ne publie pas
une interface de prospection en public par distraction. Pour publier sciemment un site
public, ajouter `PORTAIL_DESACTIVE=1` plutôt que de laisser la variable vide.

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

Franchement : l'option C ajoute une plateforme, un domaine et un réglage CORS. Elle apporte
**une** chose que l'option B ne fait pas — un portail d'accès devant l'interface, décrit au
§6, qui empêche qu'un inconnu voie même l'écran de connexion — au prix d'un second mot de
passe à saisir. Sur la performance, l'option B reste devant : en `APPEL_DIRECT=1`, le chemin
des tuiles paie environ 2,3 fois plus de requêtes qu'en origine unique — mesure faite sur la
configuration de bout en bout de ce dépôt, 89 préflights `OPTIONS` pour 69 `GET` de tuiles,
parce que l'en-tête `Authorization` rend chaque requête de tuile non simple au sens CORS.
Choisissez C si vous tenez à héberger l'interface avec vos autres sites, ou si le fait que
l'écran de connexion soit public vous dérange.

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
| Interface non publique | oui (poste local) | non — l'écran de connexion est public | oui, portail §6 |
| Nombre de mots de passe à saisir | 1 | 1 | 2 (portail, puis application) |

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

## 6. Sécuriser l'accès au site publié sur Netlify

### 6.1 D'abord, ce qu'un portail Netlify peut et ne peut pas faire

C'est le point qui décide de tout le reste, et il faut le dire avant de parler d'outils :
**Netlify n'héberge que l'interface.** L'API et sa base tournent ailleurs et restent
joignables à leur propre URL, qu'un portail existe ou non sur Netlify.

| Ce qui est protégé | Par quoi |
|---|---|
| L'existence de l'outil, sa carte, ses écrans, son aspect | le portail Netlify (§6.2) |
| Les **données** — parcelles, statuts de prospection, propriétaires | l'authentification de l'**API** : connexion, jetons JWT, rôles, habilitation explicite pour les données de propriétaires, journalisation des consultations |

Autrement dit, le portail est une **porte de rue**, pas la serrure du coffre. Il s'ajoute à
l'authentification de l'application ; il ne la remplace pas, et il ne peut pas la remplacer :
un mot de passe partagé ne dit pas **qui** a consulté **quoi**, alors que le RGPD l'exige sur
les données nominatives de propriétaires. Ce qui tient cette exigence, c'est l'API.

Ce que le portail apporte quand même, et ce n'est pas rien : sans lui, l'écran de connexion
de votre outil de prospection est public. N'importe qui — un concurrent, un moteur de
recherche — voit qu'il existe, sur quel domaine, avec quelles filières, et peut essayer des
mots de passe sur le formulaire de l'application. Avec lui, il ne voit rien.

### 6.2 Les trois outils possibles, et lequel est retenu

| Outil | Forfait Netlify requis | Retenu |
|---|---|---|
| **Password protection** intégrée (réglage du tableau de bord) | **Pro** — « basic password protection for your entire site is available on all Pro plans » | non : payant, et le mot de passe vit dans le tableau de bord, hors du dépôt |
| **Role-based access control** avec JWT (Netlify Identity, Auth0, Okta) | **Enterprise** | non : hors de proportion, et l'application a déjà ses rôles |
| **Fonction edge d'authentification HTTP Basic** écrite dans le dépôt | **tous**, y compris gratuit | **oui** |

Le portail retenu est donc `netlify/edge-functions/portail.ts`. Il est versionné avec le
reste du code, revu comme le reste du code, et testé : `apps/web/test/portail-netlify.test.ts`
l'exécute — décodage de l'en-tête, comparaison du couple, réponse de refus, et un vrai
aller-retour HTTP.

Si vous passez un jour au forfait Pro, la protection intégrée de Netlify devient une
alternative légitime : elle fait la même chose, un cran plus simple à administrer. Le portail
du dépôt reste préférable sur un point — il est relu et testé avec le code.

### 6.3 Mise en route

Dans **Site configuration → Environment variables** :

```
MOT_DE_PASSE_SITE = <au moins 16 caractères, tirés au hasard>
UTILISATEUR_SITE  = prospection            (optionnel ; « prospection » par défaut)
```

Pour obtenir une valeur acceptable :

```bash
node scripts/portail-mot-de-passe.mjs --proposer
```

Trois points à connaître :

1. **La construction refuse de produire un site sans portail.** Pas de `MOT_DE_PASSE_SITE`,
   pas de site — sauf `PORTAIL_DESACTIVE=1`, qui construit en affichant un avertissement.
   C'est le même choix que `AUTH_DESACTIVEE` côté API : l'absence d'authentification doit
   être une décision, jamais un oubli.
2. **La robustesse du mot de passe est vérifiée**, pas espérée : au moins 16 caractères, au
   moins 10 caractères distincts, et aucun marqueur des listes d'attaque (`azerty`,
   `motdepasse`, `123456`…). Un mot de passe partagé n'a pas d'autre défense que sa longueur.
3. **Laissez la variable active sur tous les contextes de déploiement.** Les Deploy Previews
   et les branches sont servis sur des URL publiques ; sans la variable, ils seraient ouverts
   alors que la production est fermée.

### 6.4 Ce que le visiteur voit

Le navigateur affiche sa boîte de dialogue d'identification. Une fois franchie, l'application
demande **sa propre** connexion : deux mots de passe, donc. C'est le coût de la solution C —
le portail ne connaît pas les comptes de l'application, et l'application ne connaît pas le
portail. **L'option B n'a pas ce coût** : l'API sert elle-même l'interface, sur une seule
origine, avec un seul formulaire de connexion et des comptes nominatifs. Si le double mot de
passe vous gêne, c'est un argument de plus pour l'option B, pas pour retirer le portail.

Si le visiteur annule la boîte de dialogue, il reçoit une page « Accès réservé » qui ne dit
**rien** de ce qu'elle garde : ni le métier de l'outil, ni le nom de l'identifiant, ni celui
des variables. C'est la seule page qu'un inconnu verra.

### 6.5 Ce qui reste hors de portée du portail

Trois limites, énoncées plutôt que dissimulées :

- **`/api/*` est exclu du portail, et doit l'être.** En mode reproxification, l'interface pose
  elle-même un en-tête `Authorization: Bearer <jeton>` sur chaque appel à son origine — c'est
  le même en-tête que celui de l'authentification Basic. Soumettre `/api/*` au portail ferait
  répondre 401 à tous les appels d'API après connexion, et l'application prendrait ce 401 pour
  une session expirée : boucle de déconnexion sur une session valide. Cette exclusion ne coûte
  rien : le même chemin est de toute façon ouvert à l'URL propre de l'API, où les jetons JWT le
  gardent.
- **La force brute n'est que freinée.** Un plafond de 300 requêtes par minute et par adresse IP
  est déclaré dans la fonction (`rateLimit`, disponible sur tous les forfaits quand la règle est
  écrite dans le code). Il se contourne avec plusieurs adresses. Ce qui rend l'attaque sans
  espoir, c'est la longueur du mot de passe — d'où la vérification du §6.3.
- **Aucune trace nominative.** Le portail ne sait pas qui entre. La traçabilité exigée sur les
  données de propriétaires est tenue par l'API, et par elle seule.

### 6.6 Deux réglages qui accompagnent le portail

- `X-Robots-Tag: noindex, nofollow, noarchive` dans `netlify.toml`, et un `robots.txt` qui
  interdit tout. Un outil interne n'a rien à faire dans un index. L'en-tête tient même lorsque
  `PORTAIL_DESACTIVE=1`, et couvre les robots qui ne lisent pas `robots.txt`.
- En mode `APPEL_DIRECT=1`, `ORIGINES_AUTORISEES` côté API doit contenir **exactement** l'URL
  de votre site Netlify, et rien d'autre : c'est ce qui empêche une page tierce d'appeler votre
  API depuis le navigateur d'un de vos utilisateurs connecté.

---

## Sources

- [Render — extensions PostgreSQL supportées, dont PostGIS](https://render.com/docs/postgresql-extensions)
- [Render — référence du fichier Blueprint](https://render.com/docs/blueprint-spec)
- [Render — types d'instances PostgreSQL](https://render.com/docs/postgresql-refresh)
- [Netlify — vue d'ensemble des Functions (environnement éphémère)](https://docs.netlify.com/build/functions/overview/)
- [Netlify — Background Functions, limite de 15 minutes](https://docs.netlify.com/build/functions/background-functions/)
- [Neon — extension PostGIS](https://neon.com/docs/extensions/postgis)
- [Netlify Database, propulsée par Neon](https://neon.com/blog/netlify-db-powered-by-neon)
- [Netlify — Password Protection, réservée aux forfaits Pro](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/)
- [Netlify — Project visibility (« password protected » : Pro uniquement)](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Netlify — Role-based access control avec JWT (Enterprise)](https://docs.netlify.com/manage/security/secure-access-to-sites/role-based-access-control/)
- [Netlify — API des fonctions edge (`context.next`, `Netlify.env`, `config.path` / `excludedPath`)](https://docs.netlify.com/build/edge-functions/api/)
- [Netlify — limites des fonctions edge (50 ms de CPU par requête)](https://docs.netlify.com/build/edge-functions/limits/)
- [Netlify — plafonds de requêtes déclarés dans le code, sur tous les forfaits](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [RFC 7235 — authentification HTTP, schéma `Basic` insensible à la casse](https://www.rfc-editor.org/rfc/rfc7235)
