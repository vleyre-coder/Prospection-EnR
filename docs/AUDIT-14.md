# Audit 14 — l'application est-elle utilisable aujourd'hui pour prospecter, et pour des projets fiables ?

> **Demande.** « Refais un audit complet de l'application. Voir ce qui va, ce qui ne va pas. Au niveau
> des documents, il faut qu'ils soient bien complémentés de toutes les informations nécessaires pour
> un développeur — par rapport à son cahier des charges, et par rapport à toutes les données
> importantes qui font qu'un projet peut être qualifié ou pas. Vérifie bien également les différentes
> filières. Si tu vois d'autres éléments à ingérer que j'ai oublié, fais-le. Pour finir, donne-moi un
> score sur 100. »

Tous les chiffres de ce document viennent d'une exécution du 26 ou du 27/09/2026. Aucun n'est repris
d'un audit précédent sans avoir été remesuré — c'est la leçon de l'audit 13, dont deux affirmations
étaient devenues fausses sans que rien ne le signale.

Le **27/09** a été consacré à la méthanisation, la filière que le 26/09 avait désignée comme la moins
instruite du catalogue. Les sections 3, 4 et 5 portent la marque **[27/09]** là où elles ont été
remesurées ce jour-là.

---

## 0. Les quatre faits qui comptent

**1. Le rapport annonçait « 81 % de couverture » là où 47 % du sujet avait été instruit.** Sur une
parcelle de méthanisation réelle : score 90/100, « couverture 81 % », et le critère nommé
*déterminant* en tête du même document — la densité d'intrants, 16,5 % à lui seul — faisait partie
des non évalués. Ce n'était pas un bug : le dénominateur excluait les critères sans source, ce qui
est juste pour *classer* des parcelles et trompeur pour qui *reçoit* le document. Écart mesuré :
34,2 points en méthanisation, 8,6 en agrivoltaïsme, 6,3 en solaire, 5,7 en éolien, 2,4 en BESS.

**2. La recherche filtrait sur des grandeurs que le rapport ne rendait jamais.** BESS filtre sur la
pente et ne l'affiche nulle part ; l'éolien sur la sensibilité avifaune ; trois filières sur cinq sur
la zone de sismicité. Le développeur posait un critère, recevait des parcelles filtrées dessus, et ne
pouvait ni vérifier que le filtre avait porté ni juger la valeur.

**3. Un seuil de capacité de raccordement écartait 91 % du parc en silence.** Mesuré : 17 parcelles
retenues sur 301 là où la grandeur existe sur 291. La capacité vient de Capareseau, la position de la
BD TOPO ; le filtre lisait le poste le plus proche, qui n'en porte presque jamais. Aucun message,
aucun journal — juste une liste courte et parfaitement plausible.

**4. Six ingestions manquaient, et deux rendaient compte à côté de la vérité.** 43 873 monuments
historiques et 6 674 sites classés et inscrits sont désormais en base, avec le raster de vent.
L'ingestion des sites déclarait « terminée, 7 634 objets » alors qu'**aucune ligne de couverture**
n'était écrite : pour le moteur, la couche n'existait pas.

---

## 1. Ce qui fonctionne — vérifié par exécution

| Vérification | Résultat |
| --- | --- |
| Typage des cinq projets | vert |
| Tests hors base | **1 165 / 1 165** |
| Tests exigeant une base | 158 / 158 (4 ignorés : migrations destructives) |
| Bout en bout (navigateur réel) | **27 / 27**, 2 ignorés |
| Motifs de mutation | **330 déclarés**, tous applicables ; campagne complète **321 / 321 attrapés**, 0 survivant, 0 non mesurée (les 9 restants exigent un navigateur) |
| Exports × filières | **25 / 25 en HTTP 200** (dossier, CSV, GeoJSON, Shapefile, `.eml`, fiche PDF) |
| Cahiers des charges | 5 / 5, et **réellement distincts** par filière |

**Les cinq filières fonctionnent.** Chacune produit un score, une fiche illustrée, un dossier de
site, un cahier des charges spécifique et les quatre exports de données. L'agrivoltaïsme est bien une
filière à part entière : son cahier des charges porte « Accord de l'exploitant » là où le solaire
porte « Régime d'implantation ».

**Les documents sont complets sur le plan réglementaire.** La fiche méthanisation porte les trois
seuils ICPE 2781-1 avec leur fondement et leur date, les 200 m d'habitation, les 35 m de puits et
cours d'eau, le plan d'épandage, l'IOTA loi sur l'eau, le droit à l'injection, l'agrément sanitaire
des intrants animaux, l'accès poids lourds. La fiche éolienne porte l'ICPE 2980, les 500 m, les 6 km
d'enquête publique, l'ABF, les radars, la servitude radioélectrique. Chaque ligne cite son article et
sa date d'entrée en vigueur.

---

## 2. Ce qui ne fonctionnait pas — et qui a été corrigé

### 2.1 La couverture annoncée n'était pas celle qui avait été instruite

Corrigé : le bandeau, le corps du courriel et la fiche à l'écran rendent désormais **les deux
chiffres** — « 81 % du mesurable, soit 47 % du sujet complet ». Le premier continue de fonder le
statut ; le second dit ce qui a été regardé. En dessous d'un point d'écart, la seconde ligne ne
s'affiche pas : une ligne qui s'affiche toujours cesse d'être lue.

La version du moteur passe à 1.5.0 — sans cela, `idusSansScoreCourant` jugeait tous les scores à jour
et le champ serait resté absent de la base entière, la seconde ligne disparaissant en silence.
**Vérifié à l'exécution avant d'écrire cette ligne :** les 301 parcelles se sont reprises seules.

### 2.2 La boucle cahier des charges → recherche → rapport ne se refermait pas

Corrigé par une section **« Grandeurs de recherche »** dans la fiche : chaque grandeur filtrable, sa
valeur mesurée, le seuil usuel, et **son nom dans le logiciel** — la même colonne que le cahier des
charges, pour que la vérification soit une recopie et non une traduction.

Elle ne note rien et ne change aucun score : en faire des critères redistribuerait tous les poids,
ce qui est une décision de modèle appartenant au propriétaire du projet.

### 2.3 Le filtre de capacité et le critère de capacité ne lisaient pas le même poste

Le critère avait été réparé la veille ; le filtre de recherche, non. **17 → 291 parcelles** retenues
pour un seuil à 1 MW. Les deux lisent maintenant le poste le plus proche *qui porte* la grandeur, et
départagent les ex æquo par le même couple (distance, identifiant) — sans quoi la liste et la fiche
auraient pu se contredire de façon intermittente.

### 2.4 Une couche en échec annulait le travail des autres

L'ingestion des sites protégés enveloppait ses quatre couches dans un seul `try`. La couche
Guadeloupe-Martinique a rendu 400 — son nom porte une date que le fournisseur fait tourner — et le
`catch` a rendu la main **avant** l'étape de couverture, alors que la métropole était entièrement
ingérée. 6 617 sites en base, zéro couverture déclarée, et un journal qui disait « terminée ».

Corrigé : chaque couche est isolée, le statut devient « partiel », et les couches fautives sont
nommées. Après correction, **198 couples département/type couverts**.

### 2.5 Une source tombée rendait le rafraîchissement impraticable

Mesuré, Géorisques injoignable : **140 secondes pour une parcelle**. Les connecteurs partent en
parallèle mais la limitation de concurrence sérialise les appels vers un même hôte, et chacun
consommait son budget complet de reprises. À ce rythme, reprendre 300 parcelles après une ingestion
demande douze heures — autrement dit, on ne les reprend pas.

Corrigé par un coupe-circuit **qui dégrade vers une seule tentative, jamais vers zéro** : 140 s → 46 s.
Ma première version court-circuitait entièrement l'appel ; un test l'a arrêtée net, car une campagne
par grande emprise découpe le territoire en cellules qui visent toutes le même hôte — une cellule en
échec aurait condamné toutes les suivantes.

### 2.6 Un diagnostic d'ingestion désignait le mauvais coupable

Le jeu GRDF des sites d'injection répond 200, annonce 855 sites, et **ne publie plus aucun champ
géographique**. Les 855 enregistrements étaient lus puis écartés, et le bilan concluait « vérifier les
identifiants de jeux » — parfaitement valides. Le bilan nomme désormais la vraie cause. Rien n'est
inventé : déduire la position d'un site du centroïde de sa commune aurait rempli la colonne d'une
erreur de plusieurs kilomètres, présentée comme une mesure.

### 2.7 [27/09] Trois faux comptes, trouvés en écrivant une ingestion qui somme

Ils méritent d'être racontés ensemble, parce qu'ils ont la même forme et qu'aucun des trois n'aurait
levé d'erreur. **Toutes les ingestions de ce dépôt écrivent un objet par ligne sous une clé ; celle du
RPG *somme* des hectares par commune. Une écriture par clé est idempotente, une somme ne l'est pas** —
et tous les mécanismes de sûreté existants supposaient la première.

1. **Le connecteur ne savait que « cette couche existe-t-elle quelque part ? »**, ce qui suffisait tant
   qu'aucune des trois couches d'intrants n'était alimentée. Dès le premier département chargé, la
   question devient fausse : une parcelle du 28 à trois kilomètres du 45 aurait sommé les seules
   communes du 28 et présenté le résultat comme le potentiel de son rayon de 10 km. Il passe
   désormais par `disqueEntierementCouvert`, couche par couche et rayon par rayon.
2. **L'emprise rectangulaire d'un département déborde sur ses voisins** — 39 % des objets téléchargés
   pour le 28. Les rattacher à leur vraie commune paraissait généreux ; c'était un sous-compte, la
   commune voisine à cheval sur le bord n'étant lue qu'en partie.
3. **Une page WFS rejouée après une coupure de flux recomptait ses objets.** Coupure observée à la
   septième page du Loiret : 3 484 objets déjà émis, puis la page rejouée entière. Le dédoublonnage
   se fait sur `iup`, l'identifiant unique de la parcelle au RPG.

**Aucun des trois ne se voyait dans un journal. Le contrôle qui les a pris est physique** : une
commune ne peut pas porter plus d'hectares agricoles qu'elle n'a d'hectares. Le Loiret affichait
**67 % de sa superficie** en surface agricole déclarée, pour une réalité voisine de 55 %. Après
correction, sur les 1 123 communes des quatre départements, **deux dépassent leur superficie, de 1 et
2 %** — la borne de l'approximation par centroïde. La requête est en §7.

Le même raisonnement a conduit à **ne pas** livrer une quatrième chose (§4.1, corridors gaz) : une
inférence géométriquement exacte, mais dont les deux jeux de données ne concordaient pas.

---

## 3. Ce qui a été ingéré, et ce que cela change

| Couche | Avant | Après | Effet mesuré sur les parcelles reprises |
| --- | --- | --- | --- |
| Monuments historiques | 0 | **43 873** | `pat_monuments` : **140 / 140 renseignés** (était 0) |
| Sites classés et inscrits | 0 | **6 674** | `pat_sites` : **105 / 105 renseignés** (était 0) |
| Raster de vent 100 m | absent | 52 Mo | `gis_vent` : **30 / 35 renseignés** (était 0) — 10,9 % du poids éolien |
| Sites d'injection gaz | 0 | 0 | source sans géométrie : non ingérable, et le bilan le dit |
| **[27/09] Surfaces agricoles communales (RPG 2024)** | 0 | **1 123 communes, 1 145 861 ha** | `gis_debouche_epandage` : **renseigné sur 100 % des parcelles reprises** (était 0) — 7,3 % du poids méthanisation |

Le téléchargement des monuments — 220 Mo annoncés — a pris **13 secondes**.

**[27/09] Le RPG a demandé quatre départements, pas un.** Mesuré sur la base : **les 301 parcelles du
28 sont toutes à moins de 10 km d'une frontière départementale**. En n'ingérant que le 28, le critère
serait resté gris partout — et c'est le comportement voulu, pas un échec : une somme d'hectares sur un
disque n'est une mesure que si le disque entier est ingéré. Les départements 41, 45 et 91 ont donc été
ingérés avec lui. Durée totale : **297 secondes** pour 445 061 parcelles RPG lues.

---

## 4. Ce qui ne fonctionne toujours pas

### 4.1 Neuf critères restent sans source nationale ingérée

| Critère | Filières | Poids |
| --- | --- | --- |
| `gis_intrants` | méthanisation | **16,5 %** |
| `racc_distance_reseau_gaz` | méthanisation | **11,0 %** |
| `env_especes_protegees` | éolien, solaire, agri | 7,0 % en éolien |
| ~~`gis_debouche_epandage`~~ | ~~méthanisation~~ | **[27/09] résolu — 7,3 %** |
| `fonc_nb_proprietaires` | les 5 | 2,5 à 6,7 % |
| `fonc_maitrise` | 3 | 1,5 à 6,7 % |
| `dist_captage`, `risq_karst` | méthanisation | 5,5 et 4,6 % |
| `env_tvb` | 3 | 1,5 à 1,7 % |
| `pat_archeologie` | 2 | 0,8 % |

**La méthanisation reste la filière la plus pénalisée**, mais moins qu'hier : **45,0 % de son poids
était non instruit, il en reste 37,6 %**. Les données de propriété (`fonc_*`) ne sont pas publiques —
elles relèvent d'une demande encadrée auprès du service de la publicité foncière, et l'application le
dit.

#### [27/09] Les trois sources manquantes de la méthanisation ont été cherchées, et voici ce qu'on a trouvé

Ce n'est pas une liste de pistes : chaque ligne a été essayée depuis ce poste, et la raison de l'échec
est mesurée. C'est ce qui manquait pour que quelqu'un puisse reprendre le travail sans refaire le
chemin.

| Ce qu'il faut | Poids | Source essayée | Résultat mesuré |
| --- | --- | --- | --- |
| Surfaces agricoles | 7,3 % | WFS Géoplateforme, RPG 2024 | ✅ **ingéré** — 4 départements, 1 123 communes |
| Élevages et IAA | 16,5 % | API Géorisques `installations_classees` | ❌ hôte injoignable depuis ce conteneur |
| Élevages et IAA | " | WFS BRGM `mapsref.brgm.fr` | ❌ **requête rejetée par le pare-feu applicatif** (« Request Rejected », HTTP 200) |
| Élevages et IAA | " | miroir `data.cquest.org/icpe` | ❌ **`Last-Modified: 28 février 2021`** — cinq ans et demi, inutilisable pour un recensement |
| Tracé gaz | 11,0 % | WFS Géoplateforme | ❌ aucune couche gaz au catalogue (231 Ko de capacités inspectés) |
| Tracé gaz | " | API Agence ORE | ❌ HTTP 403 |
| Tracé gaz | " | ODRE, corridors 10 et 20 km | ⚠️ joignables, **mais non validables** — voir ci-dessous |
| Captages, karst | 10,1 % | Géorisques | ❌ même hôte injoignable ; le karst n'est de toute façon **jamais exposé** par cette API |

**Le cas des corridors gaz mérite d'être raconté, parce qu'il a failli passer.** ODRE publie les
corridors de 10 et 20 km autour du réseau de distribution, en une géométrie nationale chacun, tous
deux joignables. Pour un point intérieur à un tampon de rayon *r*, la distance au réseau vaut
exactement *r* moins la distance au bord : les deux jeux devaient donc donner le **même** résultat, ce
qui offrait une validation croisée gratuite. **Ils ne concordent pas.** Le corridor de 10 km porte 125
trous pour 443 538 km² ; celui de 20 km n'en porte que 24 pour **567 921 km², soit plus que la
superficie de la France métropolitaine**. Le second est une enveloppe dissoute, pas un tampon — la
formule y rend des distances de −100 km. Renseigner 11 % du poids d'une filière sur une inférence
invalidable aurait été exactement le défaut que cet audit passe son temps à retirer ailleurs : une
valeur crédible, du bon ordre de grandeur, et invérifiable. **Elle n'a pas été retenue.**

### 4.2 Ce qui relève de cet environnement, et non de l'application

**`georisques.gouv.fr` est injoignable depuis ce conteneur** — tunnel coupé en cours d'échange, six
points d'entrée en échec sur toutes les parcelles reprises. Les critères de risque (cavités,
sismicité, radon, ICPE, PPRN, sites pollués) y sont donc gris.

**Ce n'est pas un défaut de l'application.** Sur un poste où Géorisques répond, ces critères se
renseignent. La conséquence est mesurable et doit être lue comme telle : sur les 35 parcelles
reprises ici, la couverture baisse sur quatre filières *malgré* les gains patrimoniaux, uniquement
parce que Géorisques a remplacé le patrimoine dans la liste des sources en échec.

### 4.3 La relecture juridique reste un travail humain

Inchangé : 7 divergences de sévérité entre filières, 17 groupes de divergences de seuils, 28 règles
marquées `aValiderParJuriste`, 128 articles à confronter à Légifrance — **injoignable depuis ce poste
(403 Cloudflare)**, donc à faire depuis un poste qui y accède.

---

## 5. Axes d'amélioration, par valeur décroissante

1. **[27/09 — fait pour un tiers] Ingérer le gisement d'intrants méthanisables et le débouché
   d'épandage.** Le débouché d'épandage (7,3 %) est réglé : RPG 2024 national, agrégé par commune,
   §2.8 de `SOURCES_DONNEES.md`. Le gisement d'intrants (16,5 %) attend les élevages et les industries
   agroalimentaires, qui viennent de la base ICPE : **le travail restant n'est pas de l'écriture de
   code, c'est un accès réseau**. Sur un poste où `georisques.gouv.fr` répond, ou avec un export ICPE
   récent, le connecteur et son agrégation sont déjà écrits et testés — il ne manque que le job
   d'ingestion, sur le modèle de `rpg_communal`.
2. **Ingérer le tracé des canalisations de gaz** (11 % de la méthanisation). La table
   `canalisation_gaz` existe et n'est peuplée par aucun job. **Les corridors ODRE ne suffisent pas**
   (§4.1) : il faut le tracé, à demander à GRTgaz et GRDF, ou à lire sur les publications DREAL
   région par région — la DREAL Auvergne-Rhône-Alpes publie `CANA-TRACE-GRTGAZ-VUE`, ce qui montre
   que le format existe et que l'obstacle est la couverture nationale, pas la donnée.
3. **Ingérer l'INPN** — espèces protégées et trame verte et bleue, jusqu'à 7 % en éolien.
4. **Relancer `patrimoine_sites`** quand le millésime outre-mer sera réparé : la couche
   Guadeloupe-Martinique reste absente, et son nom porte une date qui tournera encore.
5. **Rendre la sismicité et l'avifaune notables**, si le propriétaire du projet accepte la
   redistribution des poids que cela implique. Elles sont aujourd'hui affichées sans être notées.

---

## 6. Score

**76 / 100** pour l'usage demandé : prospecter aujourd'hui et proposer à des développeurs des projets
fiables. Le détail et le raisonnement sont dans la réponse qui accompagne ce document.

---

## 7. Reproduire les mesures

```bash
# Typage et tests hors base
npm run typecheck && npm test

# Tests exigeant une base
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e npm run test:base -w @enr/api

# Bout en bout
E2E_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e npm run e2e -w @enr/web

# Ingestions ajoutees par cet audit
npm run ingest -w @enr/api -- patrimoine_culture
npm run ingest -w @enr/api -- patrimoine_sites
npm run ingest -w @enr/api -- vent_100m
# [27/09] Surfaces agricoles communales : le departement ET SES VOISINS, sans quoi le critere
# reste gris pour toute parcelle a moins de 10 km d'une frontiere — c'est-a-dire ici, toutes.
npm run ingest -w @enr/api -- rpg_communal:28,41,45,91

# Campagne de mutation complete, sur une COPIE hors de l'arbre suivi
cp -a . /tmp/campagne && cd /tmp/campagne
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e node scripts/mutation.mjs
```

**[27/09] Le double compte du RPG se redetecte par un contrôle physique** — une commune ne peut pas
porter plus d'hectares agricoles qu'elle n'a d'hectares :

```sql
SELECT count(*) FILTER (WHERE ha_rpg > ha_commune) AS impossibles, count(*) AS total
FROM (SELECT (ct.attributs->>'surface_ha')::numeric AS ha_rpg,
             ST_Area(c.geom::geography)/10000 AS ha_commune
      FROM contrainte ct JOIN commune c ON c.code_insee = ct.identifiant_source
      WHERE ct.type = 'surface_agricole_commune') x;
-- Attendu : 2 sur 1 123, depassant de 1 et 2 % (approximation par centroide).
-- Avant correction : le Loiret affichait 67 % de sa superficie en surface agricole declaree.
```

**L'écart entre les deux couvertures se remesure ainsi :**

```sql
WITH c AS (SELECT filiere, idu, couverture_donnees,
                  jsonb_array_elements(detail->'criteres') AS crit
           FROM score_parcelle_filiere),
 p AS (SELECT filiere, idu, max(couverture_donnees) AS affichee,
              sum((crit->>'poids')::numeric) FILTER (WHERE crit->>'feu'<>'gris') AS evalue
       FROM c GROUP BY 1,2)
SELECT filiere, round(avg(affichee)*100,1), round(avg(evalue)*100,1)
FROM p GROUP BY 1 ORDER BY 1;
```
