# Contrats d'API — géodonnées ouvertes françaises (prospection EnR)

**Date de vérification : 2026-07-30.** Toutes les requêtes ci-dessous ont été exécutées réellement
avec `curl -s --max-time 40` depuis cet environnement, sauf mentions explicites `UNVERIFIED` ou
`NON FONCTIONNEL`. Les points de test utilisés sont :

| Point | lon | lat | Contexte |
|---|---|---|---|
| Beauce / Tillay-le-Péneux (28390) | 1.75 | 48.15 | rural, grande culture |
| Parcelle agricole Beauce | 1.7468534 | 48.1560157 | intérieur d'une parcelle RPG |
| Lyon (69123) | 4.83 | 45.75 | PLUi dense, SUP nombreuses |
| Beaucaire (30032) | 4.6432 | 43.8085 | risque inondation Rhône |
| Camargue | 4.55 | 43.5 | Natura 2000 / ZNIEFF / PNR / RNN |
| Cévennes | 3.6 | 44.2 | Parc national |
| Bourgogne (Chorey-lès-Beaune) | 4.85 | 47.05 | AOP viticole |
| Carte communale (Dordogne, 24507) | 1.20 | 45.30 | test `secteur-cc` |

Conventions transverses :

- Toutes les géométries `geom` de l'API Carto sont du **GeoJSON en EPSG:4326**, en **lon, lat**,
  URL-encodé pour les requêtes GET, ou passé comme **objet JSON** (pas comme chaîne) dans le corps
  pour les requêtes POST.
- Les modules API Carto renvoient un `FeatureCollection` enrichi de champs GeoServer :
  `type`, `features`, `totalFeatures`, `numberMatched`, `numberReturned`, `timeStamp`, `crs`.
  Une réponse vide est `{"type":"FeatureCollection","features":[],"totalFeatures":0,"numberMatched":0,"numberReturned":0,"timeStamp":"…","crs":null}` — **HTTP 200**, pas 404.

---

## 1. IGN API Carto — module Cadastre

- **Base URL** : `https://apicarto.ign.fr`
- **Spec OpenAPI (source de vérité)** : `GET https://apicarto.ign.fr/api/doc/cadastre.yml` (v2.10.3, YAML — le JSON n'existe pas)
- **Méthodes** : `GET` **et** `POST` sur tous les chemins. Pas de clé d'API.

### Chemins

| Chemin | Objet |
|---|---|
| `/api/cadastre/commune` | contour communal |
| `/api/cadastre/parcelle` | parcelles cadastrales (polygones) |
| `/api/cadastre/localisant` | centroïde/localisant de parcelle (MultiPoint) |
| `/api/cadastre/division` | divisions parcellaires (source BD Parcellaire) |
| `/api/cadastre/feuille` | feuilles parcellaires (source PCI Express) — **non listé dans la consigne mais existe** |

### Paramètres

| Param | commune | parcelle | localisant | division / feuille | Format |
|---|---|---|---|---|---|
| `code_insee` | ✔ | ✔ | ✔ | ✔ | `\d{5}` |
| `code_dep` | ✔ | — | — | ✔ | `\d{2,3}` |
| `code_com` | — | — | — | ✔ | `\d{2,3}` |
| `section` | — | ✔ | ✔ | ✔ | **exactement 2 caractères** (`0C`, `ZO`) |
| `numero` | — | ✔ | ✔ | — | **exactement 4 caractères** (`0843`) |
| `code_arr` | — | ✔ | ✔ | ✔ | `\d{3}` (Paris/Lyon/Marseille), sinon `000` |
| `com_abs` | — | ✔ | — | — | `\d{3}` |
| `geom` | ✔ | ✔ | ✔ | ✔ | GeoJSON URL-encodé |
| `_limit` | 1–500 | 1–1000 | 1–1000 | 1–1000 | entier |
| `_start` | ✔ | ✔ | ✔ | ✔ | offset (0-based) |
| `source_ign` | ✔ | ✔ | ✔ | — | `PCI` (défaut) ou `BDP` |

Tous les paramètres sont `required: false`, mais il faut au moins un critère.

**Padding strict** — `section=C&numero=843` renvoie **HTTP 400** :

```json
{"code":400,"message":{"section":{"msg":"Le numéro de section est sur 2 caractères",…},
                       "numero":{"msg":"Le numéro de parcelle est sur 4 caractères",…}}}
```

### Exemples vérifiés

```bash
# 1a. parcelle par identifiant cadastral
curl -s "https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=28390&section=0C&numero=0843"
# → numberMatched=1

# 1b. parcelle contenant un point
curl -s -G "https://apicarto.ign.fr/api/cadastre/parcelle" \
  --data-urlencode 'geom={"type":"Point","coordinates":[1.75,48.15]}'
# → numberMatched=1, la même parcelle 283900000C0843

# 1c. POST avec un polygone (geom = OBJET JSON, pas une chaîne)
curl -s -X POST "https://apicarto.ign.fr/api/cadastre/parcelle" \
  -H "Content-Type: application/json" \
  -d '{"geom":{"type":"Polygon","coordinates":[[[1.748,48.148],[1.752,48.148],[1.752,48.152],[1.748,48.152],[1.748,48.148]]]}}'
# → numberMatched=88

# 1d. pagination
curl -s "https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=28390&_limit=2&_start=5"
# → ["283900000C0103","283900000C0107"]
```

### Formes de réponse réelles (properties)

`parcelle` (geometry = `MultiPolygon`, `geometry_name`=`geom`, `id`=`parcelle.<n>`) :

```json
{"gid":87815072,"numero":"0843","feuille":2,"section":"0C","code_dep":"28",
 "nom_com":"Tillay-le-Péneux","code_com":"390","com_abs":"000","code_arr":"000",
 "idu":"283900000C0843","contenance":852,"code_insee":"28390"}
```

- `localisant` : mêmes clés **sans** `contenance`, geometry = `MultiPoint`.
- `commune` : `{"gid","nom_com","code_dep","code_insee"}`, geometry = `MultiPolygon`.
- `division` : `{"feuille","section","code_dep","nom_com","code_com","com_abs","echelle","edition"(int),"code_arr","code_insee"}` — pas de `gid`.
- `feuille` : idem + `gid`, `edition` étant une **date** (`"2026-03-01"`).
- `source_ign=BDP` : mêmes clés mais **sans** `gid`, `idu`, `contenance`.

⚠️ Le schéma OpenAPI documente `insee` / `nom_commune` : la réponse réelle utilise
`code_insee` / `nom_com`. **Se fier à la réponse, pas au YAML.**

### Plafonds observés

- `_limit` sans effet au-delà de 1000 : `?code_insee=28390` (1090 parcelles) →
  `numberMatched=1090`, `numberReturned=1000`. `_limit=1001` est accepté mais plafonné.
  → **paginer avec `_start` par pas de 1000**.

---

## 2. IGN API Carto — module GPU (Géoportail de l'Urbanisme)

- **Base URL** : `https://apicarto.ign.fr`
- **Spec** : `GET https://apicarto.ign.fr/api/doc/gpu.yml` (v2.10.3)
- **Méthodes** : `GET` et `POST`. Pas de clé.
- **Paramètres** : `geom` (GeoJSON), `partition` (format `<DU|PSMV>_<INSEE|SIREN>`),
  `insee` (**uniquement** sur `/municipality`), `categorie` (uniquement sur `assiette-sup-*` et
  `generateur-sup-*`, ex. `AC2`). **Pas de `_limit` / `_start` sur ce module.**

> ⚠️ **`/document` : le type de document est dans `du_type`, pas dans `typedoc`.** Propriétés
> réelles de ce point d'entrée : `du_type`, `gpu_doc_id`, `gpu_status`, `gpu_timestamp`,
> `grid_name`, `grid_title`, `id`, `name`, `partition`. Ni `typedoc`, ni `datappro`, ni `nomreg`
> n'y figurent — la date d'approbation vient de `zone-urba`, qui la porte bien sous `datappro`.
>
> Valeurs de `du_type` observées sur six communes : **`PLU`**, **`PLUi`**. Le champ `name`
> transporte en outre le type et la date d'approbation, par exemple `75056_PLU_20260616`.
>
> Lire `typedoc` laissait `typeDocument` **toujours nul**, et chaque fiche affichait « Document
> d'urbanisme : non renseigné ». Un type inconnu doit rester nul et non être requalifié en `PLU` :
> un PSMV ou un SCOT présenté comme un PLU est une affirmation fausse sur un document transmis.
>
> `/municipality` : propriétés réelles `insee`, `is_coastline`, `is_deleted`, `is_rnu`, `name`.
> Pas de `partition`.

### Chemins existants (17, tous testés → HTTP 200)

`municipality`, `document`, `zone-urba`, `secteur-cc`, `prescription-surf`, `prescription-lin`,
`prescription-pct`, `info-surf`, `info-lin`, `info-pct`, `acte-sup`,
`assiette-sup-s`, `assiette-sup-l`, `assiette-sup-p`,
`generateur-sup-s`, `generateur-sup-l`, `generateur-sup-p`.

`acte-sup` accepte **uniquement `partition`** (pas de `geom`) et renvoie des features à
`geometry: null` (`geometry_name`=`the_geom`).

### Exemples vérifiés

```bash
# 2a. statut réglementaire de la commune
curl -s "https://apicarto.ign.fr/api/gpu/municipality?insee=28390"
# properties → {"insee":"28390","name":"TILLAY-LE-PENEUX","is_rnu":false,"is_deleted":false,"is_coastline":false}

# 2b. document d'urbanisme applicable en un point
curl -s -G "https://apicarto.ign.fr/api/gpu/document" \
  --data-urlencode 'geom={"type":"Point","coordinates":[1.75,48.15]}'

# 2c. zonage PLU en un point
curl -s -G "https://apicarto.ign.fr/api/gpu/zone-urba" \
  --data-urlencode 'geom={"type":"Point","coordinates":[4.83,45.75]}'

# 2d. zonage sur une parcelle entière (POST recommandé)
curl -s -X POST "https://apicarto.ign.fr/api/gpu/zone-urba" -H "Content-Type: application/json" \
  -d '{"geom":{"type":"Polygon","coordinates":[[[1.748,48.148],[1.752,48.148],[1.752,48.152],[1.748,48.152],[1.748,48.148]]]}}'
# → 7 features : Ua, Ua, Nj, Njp, N, Nj, A

# 2e. SUP électricité (I4) — supports et câbles
curl -s -G "https://apicarto.ign.fr/api/gpu/generateur-sup-l" \
  --data-urlencode 'geom={"type":"Polygon","coordinates":[[[4.82,45.74],[4.85,45.74],[4.85,45.77],[4.82,45.77],[4.82,45.74]]]}'
# → suptype "i4", typegen "Supports et câbles"

# 2f. filtre par catégorie de SUP
curl -s -G "https://apicarto.ign.fr/api/gpu/assiette-sup-s" --data-urlencode 'geom={…Point…}' -d 'categorie=AC2'
```

### Properties réelles

**`document`** :
```json
{"gid":26339,"id":"7d1f3cc4…","grid_name":"200070159","grid_title":"PLUI COEUR DE BEAUCE",
 "name":"200070159_PLUi_20260202","gpu_doc_id":"7d1f3cc4…","gpu_status":"production",
 "gpu_timestamp":"2026-06-10T12:33:08.110Z","partition":"DU_200070159","du_type":"PLUi"}
```
`du_type` observés : `PLU`, `PLUi`, `CC`, (`PSMV` attendu).

**`zone-urba`** (21 clés) :
`gid`, `gpu_doc_id`, `gpu_status`, `gpu_timestamp`, `partition`, **`libelle`** (ex. `Ua`, `UCe1b`),
**`libelong`** (texte long), **`typezone`** (`U`, `AU`, `A`, `N`), **`destdomi`**, `nomfic`,
**`urlfic`**, `insee`, **`datappro`**, `datvalid`, `idurba`, `idzone`, `lib_idzone`, `formdomi`,
`destoui`, `destcdt`, `destnon`, `symbole`.
⚠️ `destdomi`, `datappro`, `insee`, `urlfic` sont **souvent `null` ou `""`** (Lyon comme Beauce) :
ne pas en dépendre. `datvalid` (`"20260326"`, AAAAMMJJ) est plus fiable que `datappro`.

**`secteur-cc`** (carte communale) :
`gid`, `gpu_doc_id`, `gpu_status`, `gpu_timestamp`, `partition`, `libelle` (`U`), `libelong`,
**`typesect`** (`"01"`), `fermreco`, `destdomi` (`"01"`), `nomfic`, `urlfic`, `insee`, `datappro`,
`datvalid`, `idurba`, `lib_idzone`, `symbole`.

**`prescription-surf` / `-lin`** :
`gid`, `gpu_doc_id`, `gpu_status`, `gpu_timestamp`, `partition`, **`libelle`**, `txt`,
**`typepsc`** (code numérique `"02"`, `"18"`, `"24"`…), `nomfic`, `urlfic`, `insee`, `datappro`,
`datvalid`, `idurba`, **`stypepsc`**, `idpsc`, `lib_idpsc`, `nature`, `symbole`.
`prescription-pct` ajoute **`angle`**.

**`info-surf` / `-lin` / `-pct`** : `libelle`, `txt`, **`typeinf`**, `typep`, `nomfic`, `urlfic`,
`insee`, `idurba`, `datvalid`, **`stypeinf`**, `stypep`, `idinfo`, `lib_idinfo`, `nature`, `symbole`.

**`assiette-sup-s`** : `suptype` (`ac2`), `partition` (`130006729_SUP_R84_AC2`), `fichier`, `idass`,
`idgen`, `nomass`, `typeass`, `modegeoass`, `paramcalc`, `srcgeoass`, `datesrcass`, `angle1`,
`angle2`, `rayon`, `h`, `href`, `xdebut`, `xfinal`, `ydebut`, `yfinal`, `largeur`,
**`nomsuplitt`**, `nomreg`, `urlreg`.

**`generateur-sup-s` / `-l`** : `suptype`, `partition`, `fichier`, `idgen`, `idsup`, `nomgen`,
**`typegen`**, `modegenere`, `srcgeogen`, `datesrcgen`, `refbdext`, `idbdext`, `adresse`, `type`,
**`id_gaspar`**, **`code_alea`**, `croisement`, `type_gest`, `type_voie`, `url_grisq`, `url_grisk`,
**`nomsuplitt`**, `nomreg`, `urlreg`.

**`acte-sup`** : `partition`, `idacte`, `nomacte`, `reference`, `typeacte`, `fichier`, `decision`,
`datedecis`, `datepub`, `aplan`.

### Pièges

- `?partition=DU_200046977` **sans `geom`** renvoie tout le document : **16,5 Mo / 4487 features**
  pour le PLUi du Grand Lyon. À réserver à l'ingestion batch, jamais en temps réel.
- `/municipality?geom=<point>` peut renvoyer **2 features** (limites communales jointives). Filtrer.
- Zone hors document (`5.50,44.30`, `3.30,45.10`) → `document` renvoie 0 feature : commune au RNU
  ou non couverte. Toujours interroger `municipality` d'abord (`is_rnu`).

---

## 3. IGN API Carto — module RPG (parcelles agricoles) — **FONCTIONNEL**

Le module **n'est pas cassé**. Le `FeatureCollection` vide obtenu avec `annee=2023` en Beauce
provient du **point de test lui-même** : `1.75,48.15` tombe sur une parcelle cadastrale bâtie du
village de Tillay-le-Péneux, pas sur une parcelle déclarée à la PAC.

- **Base URL** : `https://apicarto.ign.fr`
- **Chemins** : `/api/rpg/v1` (millésimes **2010–2014**), `/api/rpg/v2` (millésimes **2015–2024**)
- **Méthodes** : `GET` et `POST`
- **Spec** : `https://apicarto.ign.fr/api/doc/rpg.yml`

| Param | Requis | Notes |
|---|---|---|
| `annee` | **oui** | v1 : 2010–2014 ; v2 : 2015–2024. Hors plage → `400 {"code":400,"message":"Année Invalide : Valeur uniquement entre 2015 et 2024"}` |
| `geom` | **oui** | GeoJSON. Absent → `400 {"geom":{"msg":"Invalid value","location":"body"}}` |
| `code_cultu` | non | filtre code culture, ex. `BTH` |
| `_limit` | non | 1–1000 |
| `_start` | non | offset |

### Millésimes qui renvoient effectivement des données

Polygone test `[[1.745,48.145],[1.755,48.145],[1.755,48.155],[1.745,48.155]]` :

| annee | point `1.75,48.15` | polygone 1 km² |
|---|---|---|
| 2018 | 0 | **31** |
| 2019 | 0 | **37** |
| 2020 | 0 | **33** |
| 2021 | 0 | **33** |
| 2022 | 0 | **29** |
| 2023 | 0 | **31** |
| 2024 | 0 | **38** |

→ **Tous les millésimes 2018–2024 fonctionnent.** Un `Point` fonctionne aussi, à condition qu'il
tombe dans une parcelle PAC :

```bash
curl -s -G "https://apicarto.ign.fr/api/rpg/v2" -d 'annee=2023' \
  --data-urlencode 'geom={"type":"Point","coordinates":[1.7468534,48.1560157]}'
# → 1 feature
```

**Recommandation opérationnelle** : pour un site de prospection, interroger avec le **polygone de
la parcelle cadastrale** (ou un buffer), pas avec un point.

### Properties v2 (2015+) — exactes

```json
{"culture_d1":"","code_cultu":"MIS","code_group":"2","culture_d2":"","surf_parc":20,"id_parcel":"582975"}
```
`id` de feature = `parcelles_graphiques.<n>`, geometry = `MultiPolygon`. `surf_parc` est en **ha**.
`culture_d1` / `culture_d2` sont fréquemment des chaînes vides.

### Properties v1 (2010–2014) — exactes

```json
{"num_ilot":"028-1798423","commune":"28390","forme_juri":"NR","surf_decla":"81.33",
 "dep_rattac":"028","surf_graph":"26.59","surf_cultu":"7.00","code_cultu":"01","nom_cultu":"BLE TENDRE"}
```
⚠️ `dep_rattac` (le YAML dit `dep_rattach`) et `surf_graph` (absent du YAML).

### Alternative WFS (recommandée pour l'ingestion batch)

`https://data.geopf.fr/wfs/ows` expose : `RPG.2010`…`RPG.2014:rpg_<annee>`,
`RPG.2015`…`RPG.2024:parcelles_graphiques`, `RPG.LATEST:parcelles_graphiques`,
`RPG.2022|2023|2024|LATEST:codes_cultures`, `RPG.2023:ilots_de_reference`,
`RPG.2024|LATEST:ilots_anonymes`.

```bash
curl -s "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature\
&TYPENAMES=RPG.LATEST:parcelles_graphiques&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326\
&BBOX=1.745,48.150,1.755,48.160,EPSG:4326&COUNT=1"
# properties → {"id_parcel":"6267094","surf_parc":0.02,"code_cultu":"PPH","code_group":"18",
#               "culture_d1":null,"culture_d2":null,"cat_cult_p":"PP"}
```
Le WFS ajoute **`cat_cult_p`** (absent de l'API Carto). Table de correspondance des codes :

```bash
curl -s ".../wfs/ows?…&TYPENAMES=RPG.2024:codes_cultures&OUTPUTFORMAT=application/json&COUNT=3"
# → 147 entrées {"code":"ACP","libelle":"Autre culture pérenne"}
```

---

## 4. IGN API Carto — module AOC/AOP — **BLOQUÉ (clé privée requise)** → utiliser le fallback WFS

### Ce qui existe réellement

**Un seul chemin, en POST uniquement** : `POST https://apicarto.ign.fr/api/aoc/appellation-viticole`.

- `GET /api/aoc/appellation-viticole` → **404** `Cannot GET /api/aoc/appellation-viticole`
- `/api/aoc/aire-parcellaire` → **404** (GET et POST)
- `/api/aoc/aire` → **404** (GET et POST)

### Paramètres (spec `https://apicarto.ign.fr/api/doc/aoc.yml`)

| Param | Requis |
|---|---|
| `geom` | oui — GeoJSON |
| `source` | oui — `prd` ou `qlf` |
| `apikey` | **oui** |

### Pourquoi c'est bloqué

Sans `apikey` / `source` → **400** :
```json
{"code":400,"message":{"source":{"msg":"Invalid value",…},"apikey":{"msg":"Invalid value",…}}}
```
Avec `apikey=test&source=prd` → **500** encapsulant un **401 Unauthorized** :
```json
{"type":"error","message":"<h1>Error 401</h1><p>Unauthorized access</p>"}
```

Le changelog du module l'explique : « utilisation du **flux WFS privé de FranceAgriMer** ».
**Statut : NON UTILISABLE sans convention FranceAgriMer.** Aucune clé publique n'existe.

### ✅ Fallback vérifié — WFS INAO sur data.geopf.fr

Couche **`AOC-VITICOLES:aire_parcellaire`** — « Délimitation parcellaire AOC viticole », producteur
**INAO**, CRS natif **EPSG:2154**, emprise France entière.

```bash
curl -s "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature\
&TYPENAMES=AOC-VITICOLES:aire_parcellaire&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326\
&BBOX=4.84,47.04,4.86,47.06,EPSG:4326&COUNT=1"
```
→ `numberMatched=230`, properties :
```json
{"gml_id":"aire_parcellaire.20074",
 "denom":"Bourgogne,Bourgogne Côte d'Or,Bourgogne Passe-tout-grains,Bourgogne aligoté,Bourgogne mousseux,Chorey-lès-Beaune,Chorey-lès-Beaune ou Chorey-lès-Beaune Côte de Beaune,Coteaux Bourguignons ou Bourgogne grand ordinaire ou Bourgogne ordinaire,Crémant de Bourgogne,Côte de Beaune-Villages",
 "crinao":null}
```

Vérifié aussi en Languedoc : `BBOX=2.5,43.2,3.5,43.8,EPSG:4326` → `numberMatched=18802`,
`denom` = `"Clairette du Languedoc,Clairette du Languedoc Cabrières"`, `"Corbières,Languedoc"`.

**Schéma exact** (`REQUEST=DescribeFeatureType`) : `gml_id` (string), **`denom`** (string, liste
d'appellations séparées par des virgules), **`crinao`** (string, **toujours `null` dans les
échantillons testés**), `geom` (géométrie).

⚠️ **Il n'y a pas les champs `appellation` / `insee` / `type` / `segment` / `granularite` /
`instruction_obligatoire`** du schéma API Carto. Seuls `denom` + `crinao` sont disponibles en open data.

⚠️ **Piège CRS** : le `CQL_FILTER` avec `BBOX(geom, …)` ou `INTERSECTS(geom, POINT(…))` en degrés
renvoie **0 feature** (les coordonnées CQL sont interprétées dans le CRS natif EPSG:2154).
**Utiliser le paramètre `BBOX=…,EPSG:4326`**, qui est reprojeté correctement.

---

## 5. IGN API Carto — module Nature (INPN)

- **Base URL** : `https://apicarto.ign.fr`
- **Spec** : `https://apicarto.ign.fr/api/doc/nature.yml`
- **Méthodes** : `GET` et `POST`

### Chemins — ce qui existe / n'existe pas

| Chemin | Statut | Clé identifiante |
|---|---|---|
| `/api/nature/natura-habitat` (SIC/ZSC, directive Habitats) | ✔ vérifié | `sitecode` |
| `/api/nature/natura-oiseaux` (ZPS, directive Oiseaux) | ✔ vérifié | `sitecode` |
| `/api/nature/znieff1` | ✔ vérifié | `id_mnhn` |
| `/api/nature/znieff2` | ✔ vérifié | `id_mnhn` |
| `/api/nature/pn` (parc national) | ✔ vérifié | `id_mnhn` |
| `/api/nature/pnr` (parc naturel régional) | ✔ vérifié | `id_mnhn` |
| `/api/nature/rnn` (réserve naturelle nationale) | ✔ vérifié | `id_mnhn` |
| `/api/nature/rnc` (réserve naturelle de Corse) | ✔ vérifié | `id_mnhn` |
| `/api/nature/rncf` (réserve nat. de chasse et faune sauvage) | ✔ vérifié | `id_mnhn` |
| `/api/nature/site-inscrit` | ❌ **404** `Cannot GET /api/nature/site-inscrit` |
| `/api/nature/site-classe` | ❌ **404** `Cannot GET /api/nature/site-classe` |
| `/api/nature/appb`, `/apb`, `/biotope`, `/protection-biotope` | ❌ **404** — voir §8, la couche est au WFS PatriNat |

> ⚠️ **Le nom du site n'est PAS dans le même champ selon la couche.** Piège vérifié sur le
> service réel, et cause d'un défaut resté trois audits sans être vu :
>
> | Couche | Champ du nom | Champ identifiant |
> |---|---|---|
> | `natura-habitat`, `natura-oiseaux` | **`sitename`** | `sitecode` |
> | `znieff1`, `znieff2`, `pn`, `pnr`, `rnn`, `rnc`, `rncf` | **`nom`** | `id_mnhn` |
> | WFS PatriNat (`patrinat_*`, voir §8) | **`nom_site`** | `id_mnhn` |
>
> Ni `nom_site` ni `nom` n'existent sur les couches Natura 2000 : les lire rendait le nom du site
> **toujours nul**, sans erreur ni journal — sur la contrainte qui décide précisément d'une
> évaluation des incidences. De même, `url_fiche` n'existe pas sur ce module : le champ est `url`.
>
> Garde permanente : `apps/api/test/contrats-sources.test.ts` vérifie, contre des propriétés
> capturées sur les services réels, que toute propriété déclarée par un connecteur existe
> vraiment. **Ne jamais compléter la fixture à la main** : elle ne vaut que parce qu'elle vient
> du service.

Paramètres communs : `geom`, `_limit` (1–1000), `_start`, + `sitecode` (natura-*) ou `id_mnhn` (autres).

⚠️ Le paramètre `sitecode` sur `natura-habitat` **est cassé** — il est transmis tel quel au WFS amont
qui ne connaît pas cette colonne :
```json
{"type":"error","message":"…<ows:ExceptionText>Illegal property name: sitecode for feature type patrinat_sic:sic</ows:ExceptionText>…"}
```
`id_mnhn` fonctionne bien : `?id_mnhn=930012425` sur `znieff1` → 1 feature.

### Exemple vérifié (Camargue)

```bash
for ep in natura-habitat natura-oiseaux znieff1 znieff2 pnr rnn; do
  curl -s -G "https://apicarto.ign.fr/api/nature/$ep" \
    --data-urlencode 'geom={"type":"Point","coordinates":[4.55,43.5]}'
done
```
→ 1 feature chacun (Camargue). `pn` → 0 ici, **vérifié à 1 feature** en Cévennes (`3.6,44.2`).
`rnc` / `rncf` → 0 en Camargue, **vérifiés** via `?_limit=2` (7 et 11 features au total).

### Properties — socle commun INPN (identique sur toutes les couches)

```json
{"id_local":"13136156","date_crea":"2024-12-19Z","modif_adm":"2024-11-21Z","modif_geo":"2023-06-07Z",
 "surf_off":null,"acte_deb":null,"acte_fin":null,"gest_site":"DREAL PACA","operateur":"DREAL PACA",
 "precision":"25000","src_geom":"BD TOPO","src_annee":null,"marin":"F","p1_nature":"T",
 "p4_geologi":null,"id_mnhn":"930012425","area_sig":16088.44,"cd_sig":"I032G2930012425",
 "territoire":"METROP","url":"https://inpn.mnhn.fr/zone/znieff/930012425","nom":"SYSTÈME DU VACCARÈS"}
```

**Variations du libellé et de l'identifiant selon la couche** :

| Couche | Champ nom | Champ id | Champ URL |
|---|---|---|---|
| `natura-habitat`, `natura-oiseaux` | **`sitename`** | **`sitecode`** (`FR9301592`) — *pas* de `id_mnhn` | `url` |
| `znieff1`, `znieff2` | `nom` | `id_mnhn` (`930012425`) | `url` |
| `pn`, `pnr`, `rnn`, `rnc` | `nom` | `id_mnhn` (`FR3300004`) | `url` |
| `rncf` | **`nom_site`** | `id_mnhn` (`FR5100001`) | **`url_fiche`** — *pas* de `territoire`/`url` |

`marin` : `F` (terrestre) / `M` (marin ou mixte). `area_sig` en **hectares**.

### Alternative WFS (couches INPN plus nombreuses sur data.geopf.fr)

`patrinat_sic:sic`, `patrinat_zps:zps`, `patrinat_znieff1:znieff1`, `patrinat_znieff2:znieff2`,
`patrinat_znieff1_mer`, `patrinat_znieff2_mer`, `patrinat_pn:parc_national`, `patrinat_pnr:pnr`,
`patrinat_pnm:pnm`, `patrinat_rnn:rnn`, `patrinat_rnr:rnr`, `patrinat_rnc:pnm`,
`patrinat_rncfs:rncfs`, **`patrinat_sc:sc` (sites classés)**, `patrinat_apb:apb` (arrêtés de
protection de biotope), `patrinat_ramsar:ramsar`, `patrinat_cen:cen`, `patrinat_cdl`,
`patrinat_bios:bios`, `patrinat_zpr:zpr`, `patrinat_rb:rb`, `patrinat_geoparc`, `patrinat_inpg`.

**`patrinat_apb:apb` est la SEULE source des arrêtés de protection de biotope**, le module Nature
d'API Carto renvoyant 404 sur toutes les orthographes plausibles. C'est une contrainte majeure :
un APPB est une protection **absolue** au titre de l'article R.411-15 du code de l'environnement,
non dérogeable par une modification du document d'urbanisme, contrairement à un zonage N.
Vérifié : `TYPENAMES=patrinat_apb:apb&BBOX=-1.80,48.00,-1.50,48.30,EPSG:4326` → `numberMatched=2`,
`nom_site = "Nidification du balbuzard pêcheur en forêt de Rennes"`, `id_mnhn = "FR3801169"`.
Attention, ce WFS emploie **`nom_site`** là où API Carto emploie `sitename` ou `nom` (voir §5).

Vérifié : `TYPENAMES=patrinat_znieff1:znieff1&BBOX=4.54,43.49,4.56,43.51,EPSG:4326` →
`numberMatched=1`, properties identiques + **`nom_site`** et **`url_fiche`** (au lieu de `nom`/`url`).

`patrinat_sc:sc` est le **substitut du `site-classe` manquant** de l'API Carto — `UNVERIFIED`
(typename présent dans les GetCapabilities, requête non exécutée).

---

## 6. Géorisques API

- **Base URL v1 (ouverte, sans clé)** : `https://georisques.gouv.fr/api/v1`
  (alias `https://www.georisques.gouv.fr/api/v1` — même réponse, vérifié).
- **Base URL v2** : `https://georisques.gouv.fr/api/v2` — **exige une clé** :
  ```json
  {"code":"401","message":"Inscription gratuite obligatoire pour pouvoir accéder aux APIs. Voir www.georisques.gouv.fr/inscription/"}
  ```
  Auth : header `Authorization` (`securitySchemes: {"Bearer token": {"type":"apiKey","name":"Authorization","in":"header"}}`). **UNVERIFIED** (pas de clé dans cet environnement).
- **Specs OpenAPI** :
  `https://www.georisques.gouv.fr/api/v3/api-docs/georisques-api-v1` (v1.12.2, 30 chemins)
  `https://www.georisques.gouv.fr/api/v3/api-docs/georisques-api-v2` (39 chemins)
- **Méthode** : `GET` uniquement partout.

### Paramètres transverses

- `latlon=<lon>,<lat>` — **lon d'abord**, séparateur décimal `.`
- `rayon=<mètres>` — **plafonné à 10 000 m** (au-delà, aucune erreur : la valeur est simplement écrêtée ou ignorée — testé à 20 000 m → 196 pages de résultats)
- `code_insee` — liste séparée par virgules (⚠️ **sauf** `gaspar/ppr*` qui utilise `codeInsee`, singulier, + `longitude`/`latitude` séparés)
- `page` (défaut 1), `page_size` (défaut 10)
- `region`, `departement` (ou `code_region`/`code_departement` sur `ssp*`)

### Enveloppe de réponse (2 formes distinctes !)

**Forme A — la majorité** :
```json
{"results":37,"page":1,"total_pages":19,"data":[…],"response_code":null,"message":null,"next":"…","previous":null}
```

**Forme B — `gaspar/pprn|pprt|pprm` (pagination Spring)** :
```json
{"totalElements":1,"totalPages":1,"pageNumber":0,"pageSize":3,"content":[…]}
```
⚠️ `pageNumber` est **0-based** ici, contre `page` 1-based ailleurs.

**Forme C — `rga` : objet nu, pas de pagination.**

### Endpoints vérifiés

| Sujet | Chemin v1 | Requête testée | Résultat |
|---|---|---|---|
| Retrait-gonflement argiles | `/rga` | `?latlon=4.65,43.81` | `{"codeExposition":"2","exposition":"Exposition moyenne"}` |
| Cavités souterraines | `/cavites` | `?code_insee=30032&page_size=2` | 5 résultats |
| Installations classées (ICPE) | `/installations_classees` | `?code_insee=30032&page_size=2` | 37 résultats |
| ICPE par rayon | `/installations_classees` | `?latlon=1.75,48.15&rayon=10000` | 34 résultats |
| Risques recensés (Gaspar) | `/gaspar/risques` | `?code_insee=30032` | 1 résultat |
| PPRN | `/gaspar/pprn` | `?codeInsee=30032` | 1 (forme B) |
| PPRN détail | `/gaspar/pprn/{idGaspar}` | `/30DDTM20130005` | objet complet |
| TRI (commune) | `/gaspar/tri` | `?code_insee=30032` | 2 résultats |
| TRI zonage (point) | `/tri_zonage` | `?latlon=4.633,43.79` | 1 résultat |
| CATNAT | `/gaspar/catnat` | `?code_insee=30032` | 17 résultats |
| AZI | `/gaspar/azi` | `?code_insee=30032` | 2 résultats |
| Sites pollués CASIAS | `/ssp/casias` | `?code_insee=30032` | 55 résultats |
| SSP consolidé (CASIAS+BASOL+SIS+SUP) | `/ssp` | `?code_insee=30032` | objet à 4 sous-blocs |
| Radon | `/radon` | `?code_insee=28390` (**code_insee requis**) | `classe_potentiel:"1"` |
| Mouvements de terrain | `/mvt` | `?code_insee=30032` | 5 résultats |
| Zonage sismique | `/zonage_sismique` | `?code_insee=28390` | `code_zone:"1"` |

Autres chemins v1 non testés (existent dans la spec, **UNVERIFIED**) : `/ssp/instructions`,
`/ssp/conclusions_sup`, `/ssp/conclusions_sis`, `/old` (obligations légales de débroussaillement),
`/installations_nucleaires`, `/gaspar/pprt`, `/gaspar/pprm`, `/gaspar/papi`, `/gaspar/dicrim`,
`/gaspar/tim`, `/csv/installations_classees`, `/resultats_rapport_risque`, `/rapport_pdf`.

**Chemins v1 supprimés en v2** : `/tri_zonage`, `/resultats_rapport_risque`, `/rapport_pdf`.
→ pour le zonage TRI, **rester en v1**.

### Champs de réponse exacts

**`/rga`** — objet nu : `codeExposition` (`"1"`/`"2"`/`"3"`), `exposition`.
⚠️ Hors zone argileuse (`latlon=1.75,48.15`) → **HTTP 200 avec corps VIDE (0 octet)**, pas de JSON.
Le parseur doit gérer ce cas.

**`/cavites`** : `identifiant`, `type`, `nom`, `reperage_geo`, `region{code,nom}`,
`departement{code,nom}`, `code_insee`, `longitude`, `latitude`.

**`/installations_classees`** (31 champs) : `raisonSociale`, `adresse1..3`, `codePostal`,
`codeInsee`, `commune`, `codeNaf`, **`longitude`**, **`latitude`**, `bovins`, `porcs`, `volailles`,
`carriere`, **`eolienne`**, `industrie`, `prioriteNationale`, `statutSeveso`, `ied`, `etatActivite`,
**`codeAIOT`**, `siret`, `coordonneeXAIOT`, `coordonneeYAIOT`, `systemeCoordonneesAIOT` (`"2154"`),
`serviceAIOT`, **`regime`** (`Autorisation`/`Enregistrement`/…), `date_maj`, `inspections`,
`documentsHorsInspection`, `rubriques`.

**`/gaspar/risques`** : `risques_detail[]{num_risque, libelle_risque_long, zone_sismicite}`,
`code_insee`, `libelle_commune`.

**`/gaspar/pprn`** (`content[]`) : `idGaspar`, `libPpr`, `modeleProcedure` (`PPRN-I`),
`libBassinRisques`, `etatRevision`, **`supExists`**, **`zonageReglementaire{zoneRegExists, listTypeReg[]}`**,
`departementPilote{…}`, `dateModification`, `listePprRevises[]`.
Le détail `/gaspar/pprn/{idGaspar}` ajoute `communes[]{nom, codeInsee, lienPpr, aleas[]{codeGaspar, libelle, dateApprobation, datePrescription, sousAlea[]…}}`.

**`/gaspar/tri`** : `code_national_tri`, `libelle_tri`, `liste_libelle_risque[]`,
`libelle_bassin_risques`, `date_arrete_pcb`, `date_arrete_carte`, `date_arrete_pcb_local`,
`date_arrete_prefet_parties_prenantes`, `date_arrete_approbation`, `date_arrete_national`,
`code_insee`, `libelle_commune`.

**`/tri_zonage`** : `code_national_tri`, `identifiant_tri`, `libelle_tri`, `cours_deau`,
**`typeInondation{code,libelle}`**, **`scenario{code,libelle}`** (`02Moy` = « aléa de moyenne
probabilité »), dates d'arrêtés, `code_insee`. **C'est l'endpoint « suis-je en zone inondable ».**

**`/ssp/casias`** : `identifiant_ssp`, `identifiant_casias`, `nom_etablissement`,
`activite_principale`, `adresse`, `adresse_lieudit`, `code_insee`, `nom_commune`, `statut`,
`fiche_risque` (URL), `date_maj`, **`geom{type:"Point",coordinates:[lon,lat]}`**.

**`/ssp`** : objet à 4 clés `casias`, `basol`, `sis`, `sup` — chacune une pagination de forme A.

**`/radon`** : `classe_potentiel` (`"1"`–`"3"`), `code_insee`, `libelle_commune`.

**`/mvt`** : `identifiant`, `type`, `region{}`, `departement{}`, `code_insee`, **`fiabilite`**
(`Faible`/`Moyen`/`Fort`), `lieu`, `commentaire_lieu`, `date_debut`, `precision_date`,
`commentaire_mvt`, `longitude`, `latitude`, `precision_lieu`, `date_maj`.

**`/zonage_sismique`** : `code_insee`, `libelle_commune`, `code_zone`, `zone_sismicite`
(`"1 - TRES FAIBLE"`).

**`/gaspar/catnat`** : `code_national_catnat`, `date_debut_evt`, `date_fin_evt`,
`date_publication_arrete`, `date_publication_jo`, `libelle_risque_jo`, `code_insee`, `libelle_commune`.

### Fiabilité observée

`/tri_zonage` a renvoyé une fois `HTTP 000` (timeout côté serveur) puis a fonctionné au retry.
**Prévoir un retry avec backoff.** Aucun header `RateLimit-*` n'est exposé (passerelle Kong :
`x-kong-upstream-latency`, `x-kong-request-id`).

---

## 7. Postes sources électriques & capacité de raccordement

### 7.a ❌ `opendata.enedis.fr` — catalogue Opendatasoft **HORS SERVICE**

Le portail Enedis a migré. L'endpoint catalogue renvoie **HTTP 410** :
```
GET https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets?limit=1
→ 410 "Cette couche de compatibilité pour la version d'API précédente ne supporte pas cette requête."
```
Idem pour `/catalog/datasets/{id}` (métadonnées) et `/catalog/exports/json`.
`data.enedis.fr` redirige vers une 404. `/api/records/1.0/search/` (ODS v1) → 404.

**Ce qui marche encore** : `GET https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets/{dataset_id}/records`
→ **impossible de découvrir les `dataset_id`** via l'API ; il faut les extraire du HTML de
`https://opendata.enedis.fr/`. Ids confirmés : `poste-electrique` (976 678 postes de
distribution HTA/BT, `geometry` en chaîne JSON — **ce ne sont PAS des postes sources**),
`reseau-hta`, `registre-national-installation-production-stockage-electricite-agrege-311225`,
`previsions-des-profils-dynamiques`, `courbes-de-charges-fictives-*`,
`bilan-electrique-demi-heure-en-jplus4`.
Testés et **inexistants** : `poste-source`, `postes-source`, `postes-sources`,
`capacite-d-accueil-des-postes-sources`, `capacites-d-accueil-s3renr`, `s3renr`,
`position-geographique-des-postes-source`.

### 7.b ✅ ODRE (RTE/GRTgaz) — `https://odre.opendatasoft.com` — Explore v2.1 pleinement fonctionnel

Alias identique : `https://opendata.reseaux-energies.fr`. **187 datasets.** Catalogue interrogeable :
```bash
curl -s "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets?limit=100&select=dataset_id"
curl -s "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets?limit=20&where=search(%22poste%22)&select=dataset_id"
```

**Dataset `postes-electriques-rte`** — « Sites électriques RTE et points de piquage (au 16 juin 2026) », 5042 records :
```bash
curl -s "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/postes-electriques-rte/records?limit=1"
# → {"code_poste":"FRAIS","nom_poste":"FRAISES","fonction":"Poste de transformation",
#    "etat":"EN EXPLOITATION","tension":"225kV","departement":"Marne"}
```
⚠️ **AUCUNE géométrie** — les 6 champs du dataset sont tous `text` (vérifié via
`/catalog/datasets/postes-electriques-rte` → `fields`). `select=geo_point_2d` →
`400 ODSQLError: Unknown field: geo_point_2d`. **Ne convient pas pour un géo-appariement.**

**Dataset `registre-national-installation-production-stockage-electricite-agrege`** (au 30/06/2026) —
le seul dataset ODS qui rattache des installations à un **poste source nommé** :
```bash
curl -s "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/\
registre-national-installation-production-stockage-electricite-agrege/records\
?select=nominstallation,postesource,codes3renr,filiere,puismaxinstallee,tensionraccordement,commune,codeinseecommune\
&where=codedepartement%3D%2228%22%20AND%20postesource%20IS%20NOT%20NULL\
&order_by=puismaxinstallee%20DESC&limit=3"
```
→ `total_count=904`, ex. :
```json
{"nominstallation":"NIVOUV01 - ADP 01 DE LA CENTRALE SOLAIRE PHOTOVOLTAIQUE DE NIVOUVILLE",
 "postesource":"NIVOU","codes3renr":null,"filiere":"Solaire","puismaxinstallee":88000.0,
 "tensionraccordement":"90 kV","commune":"Châteaudun","codeinseecommune":"28088"}
```
Champs complets (38) : `dateraccordement`, `codeinseecommune`, `departement`,
`energieannuelleglissanteinjectee`, `coderegion`, `commune`, `codeiris`, `tensionraccordement`,
`codetechnologie`, `maxpuis`, `datemiseenservice_format_date`, `filiere`, `codedepartement`,
`puismaxinstallee` (**kW**), `technologie`, `productible`, `nbinstallations`, `energiestockable`,
`codefiliere`, `nominstallation`, `codeepci`, `energieannuelleglissantesoutiree`, `region`,
`datemiseenservice`, `capacitereservoir`, `epci`, `codeeicresourceobject`,
`codeinseecommuneimplantation`, **`codes3renr`**, `datederaccordement`, `datedebutversion`,
**`postesource`**, `moderaccordement`, `codecombustible`, `combustible`, `typestockage`,
`puismaxraccharge`, `puismaxcharge`, `puismaxrac`, `puismaxinstalleedischarge`, `nbgroupes`,
`regime`, `hauteurchute`, `debitmaximal`, `codegestionnaire`, `gestionnaire`.
Millésimes disponibles : suffixes `-311217` … `-311225`.

**Autres datasets ODRE utiles (vérifiés)** :
- `contraintes-region` (407 records) — contraintes résiduelles sur le RPT à 3–5 ans, avec
  `poste_1/2/3` + `pourcentage_1/2/3`, `puissance_max_de_l_ouvrage`, `perennite`, `geom`, `centroid`.
  ⚠️ `geom` et `centroid` sont **`null`** dans l'échantillon.
- `suivi-projet-raccordement-enr` (193) — MW en développement par région × filière × réseau.
- `lignes-aeriennes-rte-nv`, `lignes-souterraines-rte-nv` — tracés (géo, `UNVERIFIED`).
- `postes-electriques-region-tension` — comptages par région/tension.
- `energies-et-puissances-regionales-liees-au-contraintes`.

### 7.c ✅ capareseau.fr — **PAS uniquement HTML** : deux endpoints JSON/CSV exploitables

`https://www.capareseau.fr/` est une SPA Leaflet, mais elle charge ses données via des endpoints
`/medias/<UUID>` documentés nulle part. **Aucune API REST, aucun WFS** :
`/api` → 404, `/geoserver/ows?...GetCapabilities` → 404.

**Découverts et vérifiés** :

| Endpoint | Content-Type | Contenu |
|---|---|---|
| `/medias/5EBB636A-753C-D8DF-4271-68EE9ACF3CD2` | `application/json` | 3131 entrées d'autocomplétion (communes → `/region/<code>`) |
| `/medias/95AF2FD6-3A2C-0531-D8D1-DB6849C86B96` | CSV `;` UTF-8-BOM | **export NATIONAL — 3119 postes sources** avec toutes les données S3REnR |
| `/medias/<UUID par région>` | `application/json` | postes de la région **avec coordonnées** |

Les 2 premiers UUID sont **identiques sur toutes les pages région** (donc stables à court terme) ;
le troisième est propre à chaque région. **Ils ne sont pas devinables** : les re-extraire du HTML
de `https://www.capareseau.fr/region/<codeInseeRegion>` via
`grep -oE "/medias/[A-F0-9-]{20,40}"`. Traiter ces UUID comme **volatiles**.

```bash
# CSV national des capacités S3REnR (3119 postes)
curl -sL "https://www.capareseau.fr/medias/95AF2FD6-3A2C-0531-D8D1-DB6849C86B96" -o capacites.csv
```
En-tête (31 colonnes, ligne 2 = libellés longs, données à partir de la ligne 3) :
`Code;Nom;S3REnR;TXA;INFO_TX;INFO_ESS3R;INFO_NA;INFO_CR;INFO_TRF;INFO_QP;INFO_FAS3R;RTE_CDR;RTE_TVX;RTE_ESS3R;RTE_FAS3R;GRD1_FAS3R;GRD1_CDR;GRD1_ESS3R;GRD1_PTRE;GRD1_TRE;GRD1_TVX;GRD2_*;GRDHTB_*`

Sémantique (ligne 2 du CSV) : `TXA` = taux d'affectation des capacités réservées ;
`INFO_TX` = taux de remplissage de la capacité réservée ; `INFO_ESS3R` = puissance des projets en
service du S3REnR en cours ; **`INFO_NA` = capacité réservée S3REnR restant à affecter (MW)** ;
**`INFO_CR` = capacité réservée aux EnR au titre du S3REnR (MW)** ;
**`INFO_QP` = quote-part unitaire actualisée (k€/MW)** ; `*_CDR` = capacité disponible pour le
raccordement ; `*_TVX` = travaux prévus.

```bash
# JSON géolocalisé par région (ex. Bretagne, /region/53)
curl -sL "https://www.capareseau.fr/medias/BC1BE503-3BC1-7DB8-C3A7-890F7A511FD0"
```
→ tableau de 166 objets :
```json
{"project":"0","X_l93":226147,"Y_l93":6866821,"territory_name":"Bretagne","name":"LANNION",
 "code":"LANNI","u_max":3,"updated":"13/06/2026","htb_type":"HTA / HTB1",
 "infoTxAttributesMissing":false,"grd1":{"asset":"…","name":"Enedis"},"grd2":{…},"grdHTB":{…},
 "X":-3.449250859354488,"Y":48.72726125388231,
 "values":{"GRD1_TVX":"","GRD2_TVX":"","GRDHTB_CDR":"","GRDHTB_TVX":"","RTE_TVX":"",
           "INFO_QP":"82.22  k€/MW","INFO_CR":"19","INFO_TRF":"","RTE_CDR":"16.3",
           "INFO_NA":"16.3","GRD1_CDR":"16.3","INFO_ESS3R":"1.3","INFO_FAS3R":"1.4","INFO_TX":"14 %"},
 "region_avg_info_tx":39.4}
```
**`X`/`Y` = lon/lat WGS84 ; `X_l93`/`Y_l93` = Lambert-93.** `code` est la clé de jointure avec
`postesource` du registre ODRE et `code_poste` de `postes-electriques-rte`.

⚠️ Endpoints **non contractuels** (pas de CGU d'API, `meta robots noindex,nofollow`). À scraper avec
parcimonie (1 fois/mois), en re-résolvant les UUID, et **ne pas** intégrer en temps réel.

### 7.d Postes sources géolocalisés — sources alternatives vérifiées

- **WFS IGN `BDTOPO_V3:poste_de_transformation`** (voir §8) : géolocalisé mais `toponyme` **null**
  dans l'échantillon et pas de niveau de tension → utile pour la distance, pas pour l'identification.
- **data.gouv.fr** (via `https://www.data.gouv.fr/api/1/datasets/?q=poste%20source`) : 8 jeux, tous
  locaux ou ultramarins — `postes-sources` (EDF SEI), `postes-sources-{martinique,corse-1,guyane,guadeloupe}`,
  `postes-source-et-postes-de-repartition-hta-hta-en-pays-de-la-loire`,
  `postes-sources-denedis-en-haute-loire`, `postes-sources-distribution`.
  **Aucun jeu national métropolitain.** Recherche `S3REnR` sur data.gouv.fr → **0 résultat**.

**Conclusion §7** : le seul chemin fiable vers des **postes sources géolocalisés avec quotas
S3REnR** est le couple **capareseau.fr (`/medias/…`)** + **registre ODRE** pour le contexte
d'installations. À ingérer en batch mensuel.

---

## 8. IGN BD TOPO / BD Forêt / RPG / zones humides via WFS

- **Base URL** : `https://data.geopf.fr/wfs/ows` (alias `https://data.geopf.fr/wfs/wfs`)
- **GetCapabilities** : `?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities` → 5,1 Mo,
  **800 typenames distincts**. Pas de clé d'API.

### Requête de référence vérifiée (bâtiments BD TOPO)

```bash
curl -s "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature\
&TYPENAMES=BDTOPO_V3:batiment\
&OUTPUTFORMAT=application/json\
&SRSNAME=EPSG:4326\
&BBOX=1.748,48.148,1.752,48.152,EPSG:4326\
&COUNT=2"
```
→ `numberMatched=107`, `numberReturned=2`.

⚠️⚠️ **Ordre des axes du paramètre `BBOX`** : avec `EPSG:4326` ce serveur attend
**`minLon,minLat,maxLon,maxLat`** (ordre X,Y — non conforme à la convention EPSG:4326 lat/lon).
`BBOX=48.148,1.748,48.152,1.752,EPSG:4326` renvoie **0 feature** silencieusement.
`urn:ogc:def:crs:OGC:1.3:CRS84` donne le même résultat que `EPSG:4326` — le préférer pour lever
l'ambiguïté.

⚠️ **`CQL_FILTER` : ordre inverse !** `BBOX(geometrie, minLat, minLon, maxLat, maxLon)` →
`BBOX(geometrie,48.10,1.70,48.20,1.80)` = 2253 features ; en lon/lat = 0.
`CQL_FILTER` **et** le paramètre `BBOX` ne peuvent **pas** coexister (→ HTTP 500). Tout mettre
dans le CQL :
```bash
...&CQL_FILTER=BBOX(geometrie,48.10,1.70,48.20,1.80)%20AND%20usage_1%3D%27Agricole%27
# → numberMatched=154, nature "Silo"
```

**Pagination** : `COUNT` est plafonné à **5000** (`COUNT=20000` sur une bbox à 28 955 features →
`numberReturned=5000`). Utiliser `STARTINDEX` (0-based, vérifié). `RESULTTYPE=hits` donne le
compte sans les géométries (réponse XML même si `OUTPUTFORMAT=application/json`).
`REQUEST=DescribeFeatureType&TYPENAMES=…` donne le schéma XSD exact (vérifié).

> ⚠️ **Troncature silencieuse — piège majeur.** Au-delà de `COUNT`, le service renvoie un
> sous-ensemble **arbitraire** en HTTP 200, sans avertissement autre que l'écart entre
> `numberReturned` et `numberMatched`. Mesures faites sur le service réel (couche `batiment`,
> emprise de 1500 m autour d'un point de centre-ville) :
>
> | Emprise | `numberReturned` / `numberMatched` | Distance à l'habitation la plus proche |
> |---|---|---|
> | Orléans centre, 1500 m, `COUNT=3000` | 3 000 / 15 892 | **373 m** (faux) |
> | Orléans centre, 500 m, `COUNT=5000` | 3 343 / 3 343 | **0 m** (exact) |
> | Bourges centre, 1500 m, `COUNT=3000` | 3 000 / 16 234 | **558 m** (faux) |
> | Bourges centre, 500 m, `COUNT=5000` | 3 262 / 3 262 | **0 m** (exact) |
>
> L'erreur va toujours dans le sens dangereux : un sous-ensemble ne peut que **surestimer** une
> distance minimale, donc surestimer la note. À 558 m annoncés, le knock-out des 500 m de
> l'éolien ne se déclenche pas alors qu'une habitation est sur la parcelle.
>
> Règle appliquée dans `apps/api/src/connecteurs/wfs.ts` : toute réponse est testée
> (`reponseTronquee`), et si elle est tronquée on **réduit l'emprise** jusqu'à obtenir une
> réponse complète — une réponse complète sur un rayon *r* reste exacte pour toute distance
> ≤ *r*. À défaut, la grandeur est ramenée à `null`. Vérifié : à `COUNT=5000`, l'emprise de
> 500 m est complète partout où elle a été mesurée, Paris 11ᵉ compris (2 027 objets).
> Volume : 4,3 Mo de JSON pour 5 000 bâtiments, soit **522 ko sur le fil** (gzip ~8:1).

### `BDTOPO_V3:batiment` — properties exactes (28 champs)

```json
{"cleabs":"BATIMENT0000002012615958","nature":"Indifférenciée","usage_1":"Indifférencié",
 "usage_2":null,"construction_legere":false,"etat_de_l_objet":"En service",
 "date_creation":"2018-08-30T15:54:21.681Z","date_modification":"2022-12-15T18:45:49.336Z",
 "date_d_apparition":null,"date_de_confirmation":null,"sources":null,"identifiants_sources":"",
 "methode_d_acquisition_planimetrique":"BDParcellaire recalée",
 "methode_d_acquisition_altimetrique":"Interpolation bâti BDTopo",
 "precision_planimetrique":3,"precision_altimetrique":2.5,
 "nombre_de_logements":0,"nombre_d_etages":0,"materiaux_des_murs":null,
 "materiaux_de_la_toiture":null,"hauteur":4.1,
 "altitude_minimale_sol":135.3,"altitude_minimale_toit":139.2,
 "altitude_maximale_toit":142.5,"altitude_maximale_sol":136.5,
 "origine_du_batiment":"Cadastre","appariement_fichiers_fonciers":null,
 "identifiants_rnb":"YBMJ4PQ21HWC/Z1D7ZQVRCZM1"}
```
- **`nombre_d_etages`** (pas `etage`), **`hauteur`** en m, `usage_1`/`usage_2`
  (`Indifférencié`, `Agricole`, `Industriel`, `Résidentiel`, `Commercial et services`…),
  `nature` (`Indifférenciée`, `Silo`, `Serre`, `Hangar`…).
- `geometry_name` = **`geometrie`**, `geometry.type` = `MultiPolygon` avec **coordonnées 3D**
  (`[lon, lat, z]`).
- `identifiants_rnb` = clés du Référentiel National des Bâtiments.

### Autres typenames vérifiés (tous en `BBOX=…,EPSG:4326`)

| Typename | Test | `numberMatched` | Properties |
|---|---|---|---|
| `LANDCOVER.FORESTINVENTORY.V2:formation_vegetale` (**BD Forêt V2**) | `1.70,48.10,1.80,48.20` | 67 | `id`, **`code_tfv`** (`FF1-00`), **`tfv`**, `tfv_g11`, `essence` |
| `BDFORETV1_BDD_FXX_LAMB93_20140403:resu_bdv1_shape` (**BD Forêt V1**) | idem | 35 | `dep`, `cycle`, `anref`, `tfifn`, `libelle`, `libelle2`, `typn`, `nom_typn` |
| `TOURBIERES_ZONES-HUMIDES.BCAE:bcae` (**zones humides BCAE**) | `1.0,46.5,1.5,47.0` | 413 | `cog_region`, `cog_departement`, `cog_commune`, **`type_zone`** (`"zone humide effective"`) |
| `patrinat_znieff1:znieff1` | `4.54,43.49,4.56,43.51` | 1 | socle INPN + `nom_site`, `url_fiche` |
| `BDTOPO_V3:poste_de_transformation` | `1.60,48.05,1.90,48.25` | 5 | `cleabs`, `toponyme` (**null**), `importance`, `etat_de_l_objet`, dates, méthodes/précisions |
| `RPG.LATEST:parcelles_graphiques` | `1.745,48.150,1.755,48.160` | 21 | `id_parcel`, `surf_parc`, `code_cultu`, `code_group`, `culture_d1/2`, `cat_cult_p` |
| `RPG.2024:codes_cultures` | (sans bbox) | 147 | `code`, `libelle` |
| `AOC-VITICOLES:aire_parcellaire` | `4.84,47.04,4.86,47.06` | 230 | `gml_id`, `denom`, `crinao` |

⚠️ `TOURBIERES_ZONES-HUMIDES.BCAE:bcae` renvoie **0** en Beauce (`1.70,48.10,1.80,48.20`) : la
couche est incomplète, pas cassée. Vérifié à 413 features dans la Brenne.

### Autres typenames pertinents pour l'EnR (présents dans GetCapabilities, `UNVERIFIED`)

`BDTOPO_V3:ligne_electrique`, `BDTOPO_V3:pylone`, `BDTOPO_V3:canalisation`,
`BDTOPO_V3:zone_de_vegetation`, `BDTOPO_V3:haie`, `BDTOPO_V3:foret_publique`,
`BDTOPO_V3:parc_ou_reserve`, `BDTOPO_V3:zone_d_activite_ou_d_interet`,
`POTENTIEL.EOLIEN.REGLEMENTAIRE:cartepotentieleolien_2023_enjeu_{0..4}_metropole_drom_wgs84`,
`OFB.ZONES.EXCLUES:zones_exclues_aires_acceleration_eolien_terrestre`,
`projets_zones_acceleration_energies_renouvelables_zaer_wfs:fus_epci_ddt_portail_publication`,
`igngpf_4902_20260309_tables_sans_tirets:parcs_photovoltaiques`,
`POTENTIEL.HYDRO:potentiel_hydroelectrique`,
`IGNF_RPG_PARCELLES-AGRICOLES-CATEGORISEES_2024:parcelles_agricole_categorisees_2024`,
`IGNF_RPG_PRAIRIES-PERMANENTES_2024:prairies_permanentes_2024`,
`ADMINEXPRESS-COG-CARTO-PE.LATEST:commune`, `wfs_sup:servitude`, `wfs_sup:servitude_acte_sup`,
`PROTECTEDAREAS.PRSF:prsf`, `patrinat_sc:sc`, `patrinat_apb:apb`, `patrinat_ramsar:ramsar`.

### Rate limit

Headers renvoyés sur `/wfs/ows` : `x-ratelimit-limit-second: 1`, `ratelimit-limit: 30`.
→ **~1 req/s soutenu, burst 30.** Sérialiser les appels.

---

## 9. IGN altimétrie (RGE ALTI) — calcul de pente

- **Base URL** : `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest`
  (`GET https://data.geopf.fr/altimetrie/` → `{"message":"API Géoplateforme - Calcul altimétrique version 0.32.1"}`)
- **Chemins** : `/elevation.json` et **`/elevationLine.json`** (existe bien).
  Variantes `.xml` documentées mais non testées.
- **Méthodes** : `GET` **et `POST` (JSON)**. `POST` en `application/x-www-form-urlencoded` → **500**.
- Pas de clé d'API.

### Paramètres

| Param | Requis | Notes |
|---|---|---|
| `lon` | oui | liste séparée par `\|` |
| `lat` | oui | liste séparée par `\|`, **même cardinalité** que `lon` |
| `resource` | **oui** | **`ign_rge_alti_wld` est la SEULE valeur acceptée** |
| `delimiter` | non | défaut `\|` |
| `zonly` | non | `true` → `{"elevations":[135.33,135.61]}` (tableau de nombres) |
| `measures` | non | `true` → ajoute `measures[]{z, source_name, source_measure, acc, title}` |
| `indent` | non | `false` pour compacter |
| `sampling` | `elevationLine` | nombre de points échantillonnés le long de la polyligne |

**`resource` est obligatoire** : sans lui → **HTTP 405** `Error 405 Unsupported Request` (et non 400).
Valeurs rejetées (`400 BAD_PARAMETER … is not an accepted resource`) : `ign_rge_alti_pack_wld`,
`rge_alti`, `ign_rge_alti_wld_ldd`.

### Exemples vérifiés

```bash
# 9a. multi-points (grille de pente)
curl -s "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json\
?lon=1.75|1.76|1.77&lat=48.15|48.16|48.17&resource=ign_rge_alti_wld&delimiter=|&indent=false"
```
```json
{"elevations":[{"lon":1.75,"lat":48.15,"z":135.33,"acc":"Variable suivant la source de mesure"},
               {"lon":1.76,"lat":48.16,"z":135.61,"acc":"…"},
               {"lon":1.77,"lat":48.17,"z":126.1,"acc":"…"}]}
```

```bash
# 9b. profil en long, 5 échantillons
curl -s ".../elevationLine.json?lon=1.75|1.80&lat=48.15|48.20&sampling=5&resource=ign_rge_alti_wld"
```
```json
{"elevations":[{"lon":1.75,"lat":48.15,"z":135.33,"acc":"…"}, … 5 points …],
 "height_differences":{"positive":15.000000000000014,"negative":13.720000000000013}}
```
`height_differences` (dénivelés cumulés + / −) n'existe **que** sur `elevationLine`.

```bash
# 9c. POST JSON — indispensable au-delà de ~350 points
curl -s -X POST ".../elevation.json" -H 'Content-Type: application/json' \
  -d '{"lon":"1.75|1.76","lat":"48.15|48.16","resource":"ign_rge_alti_wld","zonly":"true"}'
```

### Limites mesurées

| Mode | Limite |
|---|---|
| `GET /elevation.json` | **~350 points** OK ; 400 → **HTTP 414 Request-URI Too Long** (limite d'URL, pas d'API) |
| `POST /elevation.json` | **5000 points max** — 5001 → `400 {"code":"BAD_PARAMETER","description":"The number of [lon] and [lat] values cannot be greater than 5000"}` |
| `GET /elevationLine.json` | `sampling=5000` accepté et servi (5000 points renvoyés) |

Rate limit : `x-ratelimit-limit-second: 1`, `ratelimit-limit: 5`. **Très strict** (5 req en burst).
→ Regrouper le maximum de points par requête POST, et espacer les appels.

**Recette pente** : grille 3×3 (ou 5×5) centrée sur le site, POST unique avec `zonly=true`,
puis gradient par différences finies. Une grille 5×5 = 25 points = 1 seule requête.

---

## 10. Réseau gaz / injection biométhane

### 10.a ✅ GRDF — `https://opendata.grdf.fr` (Opendatasoft Explore v2.1, complet)

Catalogue interrogeable (21 datasets) :
```bash
curl -s "https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets?limit=100&select=dataset_id"
```

**`les-sites-dinjection-de-biomethane-en-france`** — 840 records, géolocalisés :
```bash
curl -s "https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/\
les-sites-dinjection-de-biomethane-en-france/records?limit=1"
```
```json
{"annee_mes":2018,"nom_du_projet":"ISDND TRIGONE à Pavie (32)","site":"ISDND","commune":"Pavie",
 "code_commune":"32307","current_code":"32307","coordonnees":{"lon":0.589203146,"lat":43.605492007},
 "code_epci":"200066926","nom_epci":"…","departement":"Gers","region":"Occitanie",
 "date_de_mes":"2018-05-14","grx_demandeur":"GRDF","type_de_reseau":"Distribution",
 "capacite_de_production_gwh_an":9.3849,"gestionnaire_de_registre":"TEREGA",
 "ndeg_de_pitd_pitp":"GD8400","code_dep":"32",
 "augmentation_prevue":"Aucune augmentation supplémentaire prévue","id_unique_projet":10,
 "date_de_fermeture_du_site":null,"site_ouvert":"True","procede":"Méthanisation"}
```
(Dataset **également disponible sur ODRE** sous `points-dinjection-de-biomethane-en-france`,
mêmes 23 champs, même `total_count=840`.)

**`capacite-et-quantite-dinjection-de-biomethane`** — 2994 records (série annuelle par site) :
`id_unique_projet`, `annee`, `region`, `code_insee_region`, `departement`,
`code_insee_departement`, `epci`, `code_insee_epci`, `commune`, `code_insee_commune`,
`nom_iris_de_raccordement`, `code_insee_iris_de_raccordement`, `nom_de_l_installation`,
`typologie` (`Agricole autonome`…), `date_de_mise_en_service`,
**`capacite_d_injection_au_31_12_en_nm3_h`**, **`quantite_annuelle_injectee_en_mwh`**,
`statut` (`Définitive`), **`geolocalisation{lon,lat}`**.

**`cartographie-du-reseau-grdf-en-service`** — **3 749 284 records** (tronçons du réseau de
distribution) : `geo_point_2d{lon,lat}`, `geo_shape` (Feature GeoJSON `LineString`),
`etat_serv` (`"En service"`), `propane`, `code_insee_administratif`,
`nom_de_commune_administratif`, `code_departement_administratif`, `departement_administratif`,
`region_administrative`. **C'est le jeu qui répond à « à quelle distance du réseau gaz suis-je ».**

Filtre géospatial vérifié :
```bash
curl -s "https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/\
cartographie-du-reseau-grdf-en-service/records\
?select=etat_serv,code_insee_administratif,geo_point_2d\
&where=distance(geo_point_2d%2C%20GEOM%27POINT(4.6432%2043.8085)%27%2C%20500m)&limit=2"
# → total_count=435 tronçons dans 500 m
```

Autres ids GRDF : `indicateur-mensuel-gaz-renouvelable-des-territoires-par-{region,departement}`,
`quantite-definitive-journaliere-injectee-de-biomethane`,
`quantites-journalieres-provisoires-injectees-de-biomethane-agregees-a-la-maille1`,
`repartition-des-potentiels-de-gaz-verts-a-horizon-2050-par-departement`,
`repartition-des-potentiels-de-methanisation-a-horizon-2050-par-canton-decret-nde`,
`consommation-annuelle-de-gaz-par-{iris,epci,region,departement}-et-code-naf`,
`quantites-acheminees-journalieres-provisoires`, `correction_climatique_grdf`,
`stations-gnv-publiques-en-france`, `production-mensuelle-de-biomethane-par-region-2013-a-2020`,
`perspectives-gaz-2022-scenario-de-consommation-de-gaz-a-l-horizon-2050`,
`quantites-definitives-acheminees-journalieres-a-la-maille-france`, `codes-et-libelles-naf-niveau-2`,
`consommation-annuelle-de-gaz-par-departement-par-code-naf-2011-a-2019`.

### 10.b ❌ GRTgaz / Teréga : pas de portail propre — ✅ tout passe par ODRE

`https://opendata.grtgaz.com` et `https://opendata.terega.fr` → **connexion impossible**
(`HTTP 000`, DNS/TLS non résolus). `https://www.grtgaz.com/api/explore/…` → 404.
Les données GRTgaz (rebaptisé **NaTran**) et Teréga sont publiées sur **ODRE**
(`https://odre.opendatasoft.com`). Ids pertinents (existence confirmée par le catalogue,
requêtes de records **UNVERIFIED** sauf mention) :

| Besoin | dataset_id (ODRE) |
|---|---|
| Zonage de raccordement / proximité réseau transport | `corridor_grt_10_km-nat-grtgaz`, `corridor_grt_20_km-nat-grtgaz` |
| Proximité réseau **distribution** | `corridor_grd_10_km-nat-grtgaz`, `corridor_grd_20_km-nat-grtgaz` |
| Tracé du réseau | `trace-du-reseau-grt-250` (NaTran), `terega-trace-du-reseau` |
| **Cartographie d'accès aux réseaux méthane renouvelable** | `cartographie-acces-biomethane` |
| Droit à l'injection | `prod-droit-injec-biom-grtgaz` |
| Sites de rebours (localisation + capacité) | `sites-rebours-grtgaz` |
| Capacités réservées au registre — par **département** | `capacites-annuelles-d-injection-de-biomethane-reservees-par-departement` |
| Capacités réservées — par **région** (✔ vérifié, 156 records) | `registre-biomethane-region` |
| Capacités réservées — par **trimestre** | `registre-biomethane-trimestre` |
| Production quotidienne par site | `production-definitive-et-journaliere-de-biomethane-tout-reseau` |
| Production **annuelle par site** raccordé | `production-annuelle-de-biomethane-par-site-raccorde-au-reseau-de-transport-et-de` |
| Potentiels 2050 | `potentiels-enr-2050`, `potentiels-methanisation-2050-dpt`, `repartition-des-potentiels-de-methanisation-a-horizon-2050-a-la-maille-{regionale,par-canton}` |
| Indicateurs gaz renouvelable prospectifs | `prod-igr-prosp-{dpt,epci,reg,national}-grtgaz`, `igra-{dep,epci,reg,nat}`, `igrm-*`, `igrp_2030_2035` |
| Projets pyrogazéification / gazéification hydrothermale | `projet-commerciaux-et-demonstrateurs-en-france-de-pyrogazeification`, `projets-ami-gh-2024`, `projets_dev_gh-eur-grtgaz` |

`registre-biomethane-region` vérifié : `date`, `code_insee_region`, `region`, `nb_sites`,
`nombre_de_projets_sans_ics`, **`capacite`** (Nm³/h), **`capacite_gwh`**, `geo_shape_region`
(Feature GeoJSON complet — **volumineux**, à exclure via `select`), `geo_point_region`.

---

## 11. Géocodage / recherche administrative

### 11.a `api-adresse.data.gouv.fr` — ⚠️ **DÉPRÉCIÉ** (mais fonctionnel)

Headers de réponse observés :
```
x-api-deprecated: true
x-api-new-host: https://data.geopf.fr/geocodage/
x-api-old-host: https://api-adresse.data.gouv.fr
x-ratelimit-limit-second: 1 / ratelimit-limit: 50
```
**Nouvel hôte à utiliser : `https://data.geopf.fr/geocodage/`** — mêmes chemins, mêmes réponses
(vérifié à l'octet près sur `/search` et `/reverse`).

| Chemin | Params |
|---|---|
| `/search/` (ou `/search`) | `q` (requis), `limit` (défaut 5), `autocomplete` (0/1), `type` (`housenumber`\|`street`\|`locality`\|`municipality`), `postcode`, `citycode`, `lat`+`lon` (biais de proximité) |
| `/reverse/` | `lon`, `lat` (requis), `type`, `limit`, `index` (`address`\|`poi`\|`parcel`) |
| `/completion` | `text`, `maximumResponses` — **format différent** : `{"status":"OK","results":[{x,y,city,kind,zipcode,street,fulltext,classification,…}]}` |
| `POST /search/csv/` | multipart : `data=@fichier.csv`, `columns=<col>` (répétable), `postcode=<col>`, `citycode=<col>` — **géocodage en masse** |

```bash
curl -s "https://data.geopf.fr/geocodage/search?q=8%20boulevard%20du%20port&limit=1"
```
Réponse : `{"type":"FeatureCollection","features":[…],"query":"…"}` (⚠️ pas de `limit`/`attribution`
au niveau racine). `properties` d'un `housenumber` :
```json
{"label":"8 Boulevard du Port 95000 Cergy","score":0.9708954545454545,"housenumber":"8",
 "id":"95127_1448_00008","banId":"8e6b04d7-f6fd-48a1-80be-4ec984a286e8",
 "name":"8 Boulevard du Port","postcode":"95000","citycode":"95127",
 "x":631468.28,"y":6881710.34,"city":"Cergy","context":"95, Val-d'Oise, Île-de-France",
 "type":"housenumber","importance":0.67985,"depcode":"95","street":"Boulevard du Port",
 "_type":"address"}
```
`geometry` = `Point` en WGS84 ; `x`/`y` sont en **Lambert-93 (EPSG:2154)**.
`/reverse` ajoute **`distance`** (mètres) et peut renvoyer `oldcitycode`/`oldcity`.

⚠️ `?q=mairie&citycode=28390&type=municipality` → **0 feature** : `type` filtre la nature du
résultat, il ne remplace pas une requête pertinente.

**Géocodage en masse vérifié** :
```bash
printf 'adresse,cp\n8 boulevard du port,95000\nmairie,28140\n' > in.csv
curl -s -X POST "https://data.geopf.fr/geocodage/search/csv/" \
  -F data=@in.csv -F columns=adresse -F postcode=cp
```
→ CSV : colonnes d'entrée + `longitude,latitude,result_score,result_score_next,result_label,
result_type,result_id,result_banId,result_housenumber,result_name,result_street,result_postcode,
result_city,result_context,result_citycode,result_oldcitycode,result_oldcity,result_district,
result_status`. `result_status` = `ok` / `not-found` / `skipped`.

### 11.b `https://geo.api.gouv.fr` — API Découpage administratif

| Chemin | Params clés |
|---|---|
| `/communes` | `code`, `codePostal`, `nom`, `codeDepartement`, `codeRegion`, `codeEpci`, `lat`+`lon` (**commune contenant le point**), `boost`, `limit`, `fields`, `format` (`json`\|`geojson`) |
| `/departements`, `/regions`, `/epci` | `code`, `nom`, `fields` |
| `/communes/{code}`, `/departements/{code}/communes`, … | sous-ressources |

**La réponse est un tableau nu (pas un FeatureCollection)** quand `format` est absent.
`fields` est **obligatoire** pour obtenir `centre`, `contour`, `bbox`, `surface`, `population`.

```bash
curl -s "https://geo.api.gouv.fr/communes?code=28390\
&fields=nom,code,codesPostaux,codeEpci,codeDepartement,codeRegion,population,surface,centre,contour,bbox"
```
```json
[{"nom":"Tillay-le-Péneux","code":"28390","codesPostaux":["28140"],"codeEpci":"200070159",
  "codeDepartement":"28","codeRegion":"24","population":316,"surface":2233.44,
  "centre":{"type":"Point","coordinates":[1.7592,48.1562]},
  "contour":{"type":"Polygon","coordinates":[…]},"bbox":{"type":"Polygon","coordinates":[…]}}]
```
`surface` en **hectares**. `_score` est ajouté sur les recherches par `nom`.

**Point → commune (très utile en prospection)** :
```bash
curl -s "https://geo.api.gouv.fr/communes?lat=48.15&lon=1.75&fields=nom,code,population,codeDepartement"
# → [{"nom":"Tillay-le-Péneux","code":"28390","population":316,"codeDepartement":"28"}]
```
Aucun header de rate limit exposé.

---

## Synthèse

| # | Source | Base URL | Vérifié ? | Rate limit / quota | Usage recommandé |
|---|---|---|---|---|---|
| 1 | API Carto Cadastre | `https://apicarto.ign.fr/api/cadastre` | ✅ intégralement (5 chemins, GET+POST, pagination) | aucun header ; plafond **1000 features/réponse** | **Temps réel** — identification parcellaire à la demande |
| 2 | API Carto GPU | `https://apicarto.ign.fr/api/gpu` | ✅ 17/17 chemins | aucun header ; `?partition=` seul ⇒ 16 Mo | **Temps réel avec `geom`** ; batch par `partition` |
| 3 | API Carto RPG | `https://apicarto.ign.fr/api/rpg/{v1,v2}` | ✅ **fonctionnel**, millésimes 2018–2024 testés | 1000 features/réponse | **Temps réel** avec polygone parcellaire ; WFS `RPG.LATEST` pour le batch |
| 4 | API Carto AOC | `https://apicarto.ign.fr/api/aoc/appellation-viticole` | ❌ **401 — apikey FranceAgriMer privée** | — | **Inutilisable.** Fallback : WFS `AOC-VITICOLES:aire_parcellaire` ✅ |
| 5 | API Carto Nature (INPN) | `https://apicarto.ign.fr/api/nature` | ✅ 9/11 (`site-inscrit`/`site-classe` = **404**) ; `sitecode` cassé sur natura-* | aucun header | **Temps réel** ; WFS `patrinat_*` pour les couches manquantes |
| 6 | Géorisques v1 | `https://georisques.gouv.fr/api/v1` | ✅ 16 endpoints testés (v2 = 401, clé gratuite requise) | aucun header ; `rayon` ≤ 10 km ; timeouts sporadiques | **Temps réel avec retry** ; migrer vers v2 avec clé |
| 7a | Enedis Open Data | `https://opendata.enedis.fr/api/explore/v2.1` | ⚠️ **catalogue 410** ; `/datasets/{id}/records` OK | — | Batch, ids à extraire du HTML |
| 7b | ODRE (RTE/NaTran) | `https://odre.opendatasoft.com/api/explore/v2.1` | ✅ 187 datasets ; `postes-electriques-rte` **sans géo** | `x-ratelimit-limit: 10 000 000/j` | **Batch** (registre, contraintes RPT) |
| 7c | capareseau.fr | `https://www.capareseau.fr/medias/<UUID>` | ✅ CSV national 3119 postes + JSON régional géolocalisé | non contractuel, `noindex` | **Batch mensuel uniquement** ; UUID à re-résoudre depuis le HTML |
| 8 | WFS Géoplateforme | `https://data.geopf.fr/wfs/ows` | ✅ 8 typenames testés (BDTOPO batiment, BDForêt V1+V2, RPG, BCAE, ZNIEFF, AOC, poste_de_transformation) | **`1 req/s`, burst 30** ; `COUNT` ≤ 5000 | **Batch/ingestion** ; ponctuel en temps réel avec cache |
| 9 | Altimétrie RGE ALTI | `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest` | ✅ `elevation.json` + `elevationLine.json`, GET & POST | **`1 req/s`, burst 5** ; **5000 pts/POST**, ~350/GET | **Temps réel**, 1 POST par site (grille 5×5) |
| 10a | GRDF Open Data | `https://opendata.grdf.fr/api/explore/v2.1` | ✅ catalogue + 3 datasets clés (réseau 3,7 M tronçons) | quota ODS journalier généreux | **Batch** pour le réseau ; `where=distance(...)` en temps réel possible |
| 10b | GRTgaz / Teréga | (hôtes propres **injoignables**) → `https://odre.opendatasoft.com` | ⚠️ ids confirmés, records `UNVERIFIED` (sauf `registre-biomethane-region` ✅) | idem ODRE | **Batch** |
| 11a | Géocodage BAN | `https://data.geopf.fr/geocodage` (ex-`api-adresse.data.gouv.fr`, **déprécié**) | ✅ `/search`, `/reverse`, `/completion`, `POST /search/csv/` | **`1 req/s`, burst 50** | **Temps réel** unitaire ; `/search/csv/` pour le batch |
| 11b | Découpage administratif | `https://geo.api.gouv.fr` | ✅ `/communes` par `code` et par `lat`+`lon` | aucun header | **Temps réel** ; référentiel à mettre en cache local |

### Points d'attention critiques à retenir

1. **`BBOX` du WFS data.geopf.fr en `lon,lat`** ; **`CQL_FILTER BBOX()` en `lat,lon`**. Les deux ne
   peuvent pas coexister (HTTP 500). Une erreur d'ordre est **silencieuse** (0 feature, HTTP 200).
2. **Cadastre : padding strict** `section` = 2 car., `numero` = 4 car., sinon HTTP 400.
3. **RPG n'est pas cassé** : interroger avec un **polygone**, pas un point isolé sur du bâti.
4. **AOC/AOP : n'écrire aucun code contre `/api/aoc/`** — passer directement par
   `AOC-VITICOLES:aire_parcellaire` (mais uniquement `denom` + `crinao`).
5. **Géorisques `/rga` renvoie un corps vide (0 octet) avec HTTP 200** hors zone argileuse.
6. **Géorisques `/gaspar/ppr*` a une enveloppe et une pagination différentes** (`content`,
   `pageNumber` 0-based, `codeInsee` camelCase).
7. **`postes-electriques-rte` (ODRE) n'a pas de coordonnées.** Le seul poste-source géolocalisé
   avec quotas S3REnR vient de capareseau.fr, via des UUID volatiles.
8. **Rate limits Géoplateforme très bas (1 req/s)** : sérialiser, mettre en cache agressivement,
   et privilégier de gros POST (altimétrie) ou de grosses bbox (WFS) plutôt que des appels unitaires.
