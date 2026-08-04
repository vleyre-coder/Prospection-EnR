# Second audit — 1er août 2026 (après les six corrections critiques)

Audit demandé sans complaisance, du point de vue croisé du développement, de l'architecture,
du produit, de l'UX, de la qualité logicielle et du métier ENR.

**Avertissement sur l'impartialité.** Cet audit porte sur du code que j'ai écrit, y compris
les corrections livrées ce matin. Le biais d'auto-complaisance est réel et il s'est déjà
manifesté : le premier audit concluait à **66/100** après corrections. Ce chiffre était
surévalué, parce que je n'avais examiné ni le chemin « site », ni l'interaction entre le
nouveau seuil de couverture et les couches non ingérées, ni ce que les connecteurs
affichent réellement quand une couche est vide. Ces trois angles morts contiennent trois des
sept problèmes critiques ci-dessous, dont **deux que mes propres corrections ont créés**.
Chaque constat renvoie à un fichier, une ligne, et lorsque c'est possible à une exécution.

**Ce qui n'a pas pu être vérifié.** Le conteneur d'audit n'a pas de base PostgreSQL. Aucun
test de bout en bout, aucune mesure de temps de réponse réel, aucune vérification sur les
44 parcelles qualifiées de la base de développement. Les constats sur les performances SQL
sont donc des lectures de requêtes et d'index, pas des mesures. Tout ce qui relève du moteur
de scoring, en revanche, a été **exécuté** : les résultats chiffrés ci-dessous sortent de
simulations réelles.

> ## État des corrections — même jour, après cet audit
>
> Les **quatre corrections indispensables** (B1 à B4), les **trois autres points critiques**
> (B5 à B7) et les **problèmes importants C1 à C8** ont été implémentés. Le constat ci-dessous
> est conservé en l'état : il documente ce qui était en défaut et pourquoi.
>
> | Point | État | Vérification |
> |---|---|---|
> | B1 méthanisation structurellement grise | **corrigé** | mécanisme « critère sans source » : couverture 100 %, statut plafonné orange — 5 tests |
> | B2 score de site sans garde-fous | **corrigé** | 4 tests, dont « parcelles grises → site gris » |
> | B3 zéros affichés comme mesures | **corrigé** | `couchesIntrantsIngerees()` avant tout comptage |
> | B4 carte muette à l'expiration | **corrigé** | notification de session + bandeau « session expirée » |
> | B5 fonction propriétaires vide | **corrigé** | trois états explicites, dont `non_alimentee` |
> | B6 aucune CI | **corrigé** | `.github/workflows/ci.yml` ; 65 tests contre 41 |
> | B7 référentiel non lié à l'invalidation | **corrigé** | `VERSION_MOTEUR = 1.2.0+27920b4d` |
> | C1 zonage dominant arbitraire | **corrigé** | `partCouverte()` par échantillonnage — 7 tests |
> | C2 rouge KO / rouge score | **corrigé** | 5e entrée de légende, teinte distincte |
> | C3 liste hors emprise | **corrigé** | bbox transmis, bascule « Limiter à la zone affichée » |
> | C4 IDOR + rôle `lecture` | **corrigé** | 6 tests d'accès |
> | C5 fuite mémoire du cache | **corrigé** | plafond 5 000 entrées, purge amortie |
> | C6 état de qualification volatil | **corrigé** | table `tache_qualification`, campagnes interrompues signalées |
> | C7 aucune limitation de débit | **corrigé** | seau à jetons sur connexion, qualification, exports — 2 tests |
> | C8 deux « couverture » homonymes | **corrigé** | commentaires de colonnes, migration 009 |
>
> **Erreurs métier E3 à E7 et points secondaires (D), corrigés ensuite :**
>
> | Point | État | Vérification |
> |---|---|---|
> | E3 surface utile sans déduction | **corrigé** | érosion du contour, seuil économique sur la surface nette — 4 tests |
> | E4 distance poste à vol d'oiseau | **corrigé** | linéaire majoré de 35 %, les deux valeurs affichées — 2 tests |
> | E5 « aucun site à proximité » | **corrigé** | libellé « aucun site trouvé dans un rayon de 10 km » |
> | E6 potentiel agronomique en indice | **corrigé** | affiché « indice estimé … (proxy RPG) », commentaire explicite |
> | E7 régime PV déduit du seul type de sol | **corrigé** | libellés « présumé » + réserve affichée sous le régime |
> | D validation des emprises de requête | **corrigé** | ordre, domaine et étendue vérifiés — 7 tests |
> | D paquet frontend monolithique | **corrigé** | 1,12 Mo → 130 ko applicatif, MapLibre isolé et caché |
> | D `moyenne()` muette sur ce qu'elle ignore | **corrigé** | `fonc_maitrise` affiche « n/3 indicateurs disponibles » |
> | D accessibilité des états dynamiques | **corrigé** | `aria-live` sur l'avancement et les bandeaux de la carte |
> | D échec d'installation des couches jamais affiché | **corrigé** | bandeau `role="alert"` — le message était capturé sans être rendu |
>
> **78 tests** (37 scoring, 41 API) contre 19 au moment du premier audit.

**Périmètre mesuré :** 21 648 lignes (TypeScript, TSX), 8 migrations SQL (741 lignes),
3 365 lignes de documentation, **4 fichiers de test (770 lignes, 41 tests)**, **0 intégration
continue**.

---

## A. Ce qui fonctionne bien

Ces points ne sont pas de la politesse. Ce sont des choix qui tiennent l'examen, et plusieurs
sont au-dessus de la moyenne de ce qu'on voit en outil métier interne.

**1. Le catalogue de critères est rigoureusement cohérent.** Vérifié par exécution :
43 critères définis, 43 évaluateurs, 43 critères pondérés, **zéro** orphelin dans un sens
comme dans l'autre. C'est important car `index.ts:166` ignore silencieusement un critère
pondéré sans évaluateur — une faute de frappe le ferait disparaître du score *et* du
dénominateur de couverture, sans aucune alerte. Le risque existe ; il n'est pas réalisé.

**2. Hygiène de typage exemplaire.** `grep` sur l'ensemble des sources : **0** occurrence de
`as any`, `@ts-ignore` ou `@ts-expect-error`. TypeScript strict avec
`noUncheckedIndexedAccess`. Le typecheck et le build passent proprement sur les quatre
paquets. Sur 21 648 lignes, c'est rare.

**3. Aucun catch silencieux.** **0** occurrence de `catch {}` ou `.catch(() => {})`. Toute
erreur est journalisée ou remontée. C'est ce qui a permis de diagnostiquer les régressions
passées.

**4. Aucune injection SQL trouvée.** Toutes les requêtes sont paramétrées. Le seul
constructeur dynamique (`services/recherche.ts:255-320`) assemble des fragments constants et
pousse les valeurs dans `params` ; l'ordre de tri est choisi dans un ensemble fermé de
littéraux. J'ai cherché spécifiquement l'interpolation de chaînes dans du SQL : les quatre
occurrences trouvées interpolent des constantes de module, jamais une entrée utilisateur.

**5. Le client HTTP sortant est sérieux** (`http.ts`). Délai maximal, tentatives avec
distinction 4xx définitif / 429 et 5xx retentables, sémaphore de concurrence par domaine,
et surtout : `ErreurSource` explicite plutôt qu'une valeur par défaut. La règle « jamais de
valeur inventée en cas d'échec » est tenue au niveau du transport.

**6. La dégradation par connecteur est correcte.** `connecteurs/nature.ts:77` utilise
`Promise.allSettled` sur les huit couches INPN : une couche en échec laisse les sept autres
renseignées et s'inscrit dans `echecs`, qui remonte jusqu'à la fiche. Un service indisponible
ne fait pas échouer la qualification.

**7. Le chemin RGPD de lecture est bien construit** (`routes/parcelles.ts:151-203`) :
habilitation vérifiée, motif circonstancié d'au moins 5 caractères exigé en en-tête, et
`journaliserStrict` appelé **avant** la lecture — sans trace, pas de consultation. L'ordre
des opérations est le bon. (Ce que la fonctionnalité renvoie est un autre sujet : voir B5.)

**8. Les relais ne sont pas des proxys ouverts.** `calques.ts:356-405` construit les URL
amont à partir d'une constante `GEOPF` codée en dur et d'un catalogue fermé
(`CALQUES_PAR_ID`) ; un identifiant inconnu renvoie 404 avant toute requête sortante. Même
discipline pour le fond de carte et les polices.

**9. Le schéma de base est correctement indexé.** Index GiST sur toutes les géométries,
clés primaires composites cohérentes (`score_parcelle_filiere` sur `(idu, filiere,
profil_ponderation)`), index uniques partiels sur `lead` empêchant deux leads pour une même
parcelle et filière, index de tri sur `(filiere, score_global DESC NULLS LAST)`.

**10. Le scoring est réellement explicable.** Chaque critère expose note, poids normalisé,
contribution, valeur brute, valeur affichée, commentaire, source datée et règles liées. Les
courbes sont des paliers linéaires par morceaux (`notes.ts`), lisibles et documentables. La
cohérence arithmétique contributions / score global est vérifiée par test.

**11. Les six corrections de ce matin tiennent.** Vérifiées par exécution : avifaune et
chiroptères absents du catalogue, covisibilité supprimée, déport d'implantation appliqué
(une parcelle de 40 ha au bord à 430 m n'est plus écartée, la même distance sur 1,5 ha reste
éliminatoire), tuiles parcellaires protégées (5 tests), données de démonstration filtrées
avec un garde-fou anti-régression que j'ai vérifié par mutation.

**12. La documentation et l'installation sont au-dessus du lot.** 3 365 lignes, sources
tracées avec leur valeur juridique, procédures Windows / Docker / sans Docker. Ce n'est pas
cosmétique : c'est ce qui rend l'outil transmissible.

**13. Peu de dépendances, toutes courantes.** 12 dépendances directes côté API
(Fastify, pg, pino, pdfkit, geotiff). Pas de dette de supply chain exotique.

---

## B. Problèmes critiques

Les sept points ci-dessous empêchent une utilisation professionnelle fiable en l'état.

### B1. La filière méthanisation est structurellement inutilisable — grise partout en France

**Le plus grave, et c'est ma correction de ce matin qui l'a provoqué.**

`gis_intrants` pèse 16,5 % du score méthanisation, `gis_debouche_epandage` 7,3 %. Ensemble :
**23,8 %**. Or les deux dépendent de trois types de contraintes —  `elevage`,
`industrie_agroalimentaire`, `surface_agricole_commune` — qui ne sont **jamais ingérés** :
`grep` sur l'ensemble du code ne trouve aucune écriture de ces types, seulement la lecture
dans `connecteurs/gisement.ts:95-101` et deux déclarations de couches dans
`routes/referentiel.ts:57-58`.

Conséquence arithmétique : la couverture méthanisation ne peut jamais dépasser 76,2 %. Le
seuil de grisement que j'ai porté de 0,5 à 0,8 ce matin est donc **structurellement
inatteignable**.

Exécuté sur une parcelle par ailleurs parfaitement documentée :

```
solaire_sol        couverture 100.0%  statut vert    score 79.8
eolien_terrestre   couverture 100.0%  statut vert    score 76.8
bess               couverture 100.0%  statut vert    score 75.9
methanisation      couverture  76.1%  statut gris    score 92.3
   gris : gis_intrants(16.5%), gis_debouche_epandage(7.3%)
```

Toute parcelle, partout, en méthanisation : **grise**. La filière est morte dans l'outil.

Noter aussi le score de 92,3 — le plus élevé des quatre — obtenu précisément parce que les
deux critères manquants sont ceux qui pénalisent. Avant ma correction, ce 92,3 s'affichait
comme un score valide. L'ancien comportement était faussement optimiste, le nouveau est un
écran noir : les deux sont faux, dans des directions opposées.

**Correction :** ingérer les couches (BDTOPO / ICPE / RPG agrégé), ou retirer ces deux
critères du profil méthanisation et redistribuer leur poids, comme cela a été fait pour
avifaune et chiroptères. La troisième voie — abaisser le seuil pour la seule méthanisation —
serait un pansement : elle rétablirait le score optimiste de 92,3.

### B2. Le score de site contourne tous les garde-fous

`packages/scoring/src/index.ts:342-401`. `calculerScoreSite` recalcule un statut à partir des
seuls seuils vert / orange (`ligne 391-398`). Il n'applique **ni** le seuil de couverture,
**ni** le plafond d'incertitude à 90 %, **ni** les limites de viabilité, **ni** la règle
« un knock-out dérogeable interdit le vert ». Il n'expose même pas `couvertureDonnees` ni
`limitesViabilite` dans son résultat : l'interface ne *peut pas* avertir.

Exécuté :

```
PARCELLE seule   : couverture 33% | statut gris | score 95
  limites        : couverture_insuffisante

SITE des memes 2 parcelles : statut vert | score 95
  -> le site expose-t-il la couverture ? NON
  -> le site expose-t-il les limites ? NON
```

**Deux parcelles individuellement GRISES deviennent un site VERT à 95/100.** Agréger deux
inconnues produit une certitude. C'est exactement le défaut B2 du premier audit, que je n'ai
corrigé que sur le chemin parcelle en croyant l'avoir traité.

Le site est l'objet que l'on présente en comité d'investissement. C'est le pire endroit où
laisser cette faille.

### B3. Des zéros affichés comme des mesures là où rien n'a été ingéré

`connecteurs/gisement.ts:88-125`. La requête compte les élevages et les IAA avec `count(*)`,
qui ne renvoie **jamais** `null` — il renvoie 0. Le garde-fou de la ligne 108,
`if (elevages == null && iaa == null && surfaces == null) return vide()`, est donc **du code
mort** : la condition ne peut pas être vraie quand la requête aboutit.

Résultat : la fiche affiche « 0 élevages < 10 km » et « 0 IAA < 20 km » comme des
constatations, alors qu'aucune couche d'élevages ni d'IAA n'existe en base. Un prospecteur
lit « aucun gisement d'effluents à proximité » là où la bonne réponse est « on n'en sait
rien ». C'est précisément la faute que l'application affiche en bandeau vouloir éviter :
*l'absence de donnée ne vaut pas absence de contrainte* — ici, absence de ressource.

**Correction :** distinguer « couche non ingérée » de « comptage nul », par un test
d'existence de la couche (comme le fait déjà `couverture_ingestion` pour les ZAER).

### B4. L'expiration du jeton rend la carte muette — régression que j'ai introduite

Depuis ma correction B4 de ce matin, les tuiles parcellaires exigent un jeton. Le jeton dure
12 h (`config.ts:47`). À l'expiration, MapLibre reçoit des 401 ; le gestionnaire d'erreur
(`Carte.tsx:267-290`) les envoie dans `console.warn` et rien d'autre. `estNonAuthentifie`
n'est traité qu'à un seul endroit, `App.tsx:95`, sur la requête `/api/auth/moi`.

Un utilisateur qui laisse l'application ouverte la nuit la retrouve le matin avec **une carte
vide sans message**, jusqu'à ce qu'une autre requête JSON déclenche la reconnexion. Avant ma
correction, les tuiles étant publiques, ce cas n'existait pas.

Mes cinq tests d'accès vérifient que le serveur renvoie bien 401. Aucun ne vérifie que le
client s'en remet — j'ai testé la moitié sécurité de la correction et ignoré la moitié
utilisabilité.

**Correction :** faire remonter les 401 de tuile vers le store d'authentification pour
déclencher la reconnexion, et afficher un bandeau « session expirée » plutôt qu'une carte
vide.

### B5. La fonctionnalité « données de propriétaires » reste une coquille

La table `proprietaire_parcelle` (migration 006) n'est **écrite nulle part** : `grep` ne
trouve qu'une lecture (`routes/parcelles.ts:192`) et une purge RGPD. La route renvoie donc
systématiquement `nbComptes: null, indivision: null, nominatif: null`, accompagnés d'un
avertissement de trois lignes.

Tout l'appareillage RGPD — habilitation, motif, journalisation stricte — protège un tiroir
vide. Le coût est double : l'utilisateur croit la fonction disponible, et la journalisation
donne l'illusion d'une conformité éprouvée qui n'a jamais servi.

Inchangé depuis le premier audit.

### B6. Aucune intégration continue, et une couverture de test qui reste marginale

41 tests pour 21 648 lignes. Aucun fichier dans `.github/workflows`. Rien n'empêche un
`git push` de casser le moteur.

Les 41 tests couvrent le moteur de scoring parcelle (22), les emprises (10), l'accès aux
tuiles (5) et les données de démonstration (4). **Zéro test** sur : le score de site (d'où
B2), les connecteurs, les routes d'API hors tuiles, les dépôts, l'export PDF, l'interface.
Les tests que j'ai ajoutés ce matin protègent les corrections de ce matin — ils ne protègent
pas le reste.

Preuve que le sujet n'est pas théorique : ce matin, les tests de scoring tournaient contre
`dist/` sans que rien ne garantisse que `dist/` était à jour. Deux tests passaient au vert
contre un build périmé.

### B7. Le référentiel réglementaire n'est toujours pas lié à l'invalidation des scores

Seule `VERSION_MOTEUR` déclenche le recalcul. `REFERENTIEL_DERNIERE_VERIFICATION` et les
dates d'entrée en vigueur vivent dans `packages/core/src/reglementation.ts` et peuvent
changer sans que la version du moteur bouge. Un seuil réglementaire qui évolue laisse en base
des scores calculés sous l'ancienne règle, affichés sans réserve.

L'argument de vente de l'application est la réglementation datée. Inchangé depuis le premier
audit — le mécanisme de recalcul automatique ajouté ce matin en fournit la moitié : il ne
manque que l'empreinte du référentiel dans la clé.

---

## C. Problèmes importants

### C1. Le « zonage dominant » d'urbanisme est choisi sur un critère qui n'a pas de sens

`connecteurs/gpu.ts:100-105` calcule `partRecouvrement` comme **surface du zonage entier /
surface de la parcelle**, plafonné à 1. Ce n'est pas une part de recouvrement : c'est un
rapport de tailles. Une zone A de 500 ha sur une parcelle de 1 ha donne 500 → plafonné à 1.

Or `criteres-eval.ts:352` et `knockouts.ts:111` trient sur ce champ pour désigner le
« zonage dominant ». Comme presque toute zone de PLU est plus grande qu'une parcelle, la
valeur vaut 1 pour quasiment toutes les zones retournées : le tri est indifférent et le
« dominant » est en pratique **le premier renvoyé par l'API**.

Conséquence métier : pour une parcelle à cheval sur une zone U et une zone N, le knock-out
`ko_zonage_naturel` (dérogeable, plafonne à orange) se déclenche ou non selon l'ordre de
réponse d'un service tiers. Le critère `urb_zonage` est partiellement protégé — il combine le
dominant avec `pire(...)` de toutes les zones — mais le knock-out, lui, ne dépend que du
dominant.

**Correction :** calculer la vraie part d'intersection (le code de `distances.ts` sait déjà
faire de la géométrie), ou à défaut retenir la zone la plus défavorable plutôt qu'une zone
arbitraire.

### C2. Sur la carte, « réglementairement impossible » et « score médiocre » sont le même rouge

La tuile transporte `nb_knock_outs` (`services/tuiles.ts:60`). L'interface ne le lit
**jamais** : `grep -i knock` sur `apps/web/src` ne trouve aucun usage cartographique. Une
parcelle écartée par l'article L.515-44 et une parcelle notée 38/100 s'affichent
identiquement.

La fiche, elle, présente très bien les knock-outs. Mais la décision de terrain — « où
j'envoie le prospecteur » — se prend sur la carte et la liste, pas dans la fiche. Les deux
rouges n'appellent pas la même action : l'un est définitif, l'autre est une question de
priorité.

### C3. La liste n'est pas bornée à l'emprise affichée

`FiltresRecherche` accepte un `bbox` (`api/client.ts:332`) et l'API le gère
(`services/recherche.ts:266`). `VueListe.tsx:26` construit ses filtres sans jamais le
renseigner. La liste montre donc toutes les parcelles qualifiées de la base, quelle que soit
la zone regardée.

C'est la cause la plus probable du symptôme signalé au départ — des parcelles de Nogent et de
Gueugnon présentées ensemble. Le garde-fou d'emprise ajouté côté qualification a traité une
autre porte que celle qui était ouverte.

### C4. Deux failles de contrôle d'accès

**IDOR sur les pondérations.** `routes/divers.ts:230` :
`DELETE FROM profil_ponderation WHERE id = $1`, sans aucune vérification de propriété.
N'importe quel utilisateur authentifié peut supprimer le profil de pondération de n'importe
quel autre, en connaissant son identifiant.

**Le rôle `lecture` n'est pas cohérent.** `routes/prospection.ts` protège les leads
(lignes 40, 98, 135 : `if (req.utilisateur?.role === 'lecture')`) mais **pas** la création de
site (ligne 154), **pas** la suppression de site (ligne 199), et **pas**
`POST /api/qualification/emprise` (`routes/parcelles.ts:208`). Un compte en lecture seule
peut donc créer et supprimer des sites, et lancer une qualification de masse qui consomme le
quota des API publiques.

### C5. Fuite mémoire dans le cache HTTP

`http.ts:33` : `const cache = new Map()`. Une entrée n'est jamais supprimée — la TTL n'est
vérifiée qu'à la lecture, et `viderCacheHttp()` (ligne 168) est **exporté mais jamais appelé**
nulle part.

Une qualification de 1 000 parcelles émet une douzaine de requêtes par parcelle, dont
plusieurs `FeatureCollection` de plusieurs dizaines de kilo-octets. Le processus conserve
tout, indéfiniment. Sur un serveur qui tourne des semaines, c'est une croissance monotone
jusqu'à l'échec d'allocation.

### C6. L'état de qualification est un singleton en mémoire

`services/qualification.ts:251`. Conséquences : une seule qualification à la fois pour tout
le processus (`lancerQualificationEmprise` renvoie `null` si occupé — un second utilisateur
est refusé sans explication métier) ; l'état est perdu au redémarrage, laissant un lot
partiellement qualifié sans trace ; aucune reprise possible.

Acceptable pour un poste unique, bloquant dès qu'une deuxième personne utilise l'outil.

### C7. Aucune limitation de débit sur l'API

Aucun `@fastify/rate-limit`, aucun compteur maison. Le seul contrôle de débit existant est
*sortant* (vers les sources publiques). Les routes coûteuses —
`POST /api/qualification/emprise`, les exports, les tuiles — sont accessibles sans plafond à
tout porteur de jeton.

### C8. Deux grandeurs différentes portent le même nom de « couverture »

`enrichissement.ts:313` calcule `couvertureSnapshot` = connecteurs ayant répondu / connecteurs
totaux, stockée dans `parcelle_snapshot.couverture`. `index.ts:200` calcule
`couvertureDonnees` = poids des critères renseignés / poids applicables, affichée dans la
fiche. Deux nombres différents, deux dénominateurs différents, un seul mot. Le second pilote
désormais le grisement et le plafond à orange ; le premier ne pilote rien mais reste stocké.

---

## D. Problèmes secondaires

- **`bboxDepuisChaine` ne valide pas** (`geo.ts:178`) : ni l'ordre (`minLon < maxLon`), ni la
  taille. Une emprise inversée produit une enveloppe vide et un résultat silencieusement nul ;
  une emprise mondiale déclenche un balayage borné seulement par un `LIMIT` présent sur
  certaines routes et absent sur d'autres.
- **Paquet frontend monolithique** : 1,12 Mo de JavaScript (318 ko compressés) en un seul
  fragment, sans découpage. Le premier chargement transporte MapLibre, pdfkit côté client,
  React Query et toute l'application avant le premier pixel.
- **Accessibilité mince** : 25 attributs `aria-*` et 8 `role=` pour 42 boutons sur
  5 616 lignes de TSX. Aucun `alt` (mais aucune balise `<img>` non plus). Navigation clavier
  non vérifiable sans exécution.
- **`dateCalcul: new Date().toISOString()`** dans le résultat de score : deux calculs
  identiques ne produisent pas un objet identique, ce qui complique toute comparaison ou tout
  test de non-régression par empreinte.
- **La pénalité de fragmentation de site** `0,7 + 0,3 × partRetenue` (`index.ts:388`) est un
  choix non sourcé et non documenté, contrairement au reste du moteur qui justifie ses
  courbes.
- **`moyenne()` masque les sous-données manquantes** (`notes.ts:76`) : un critère composite
  dont 2 des 3 sous-valeurs manquent renvoie une note, et compte donc comme « renseigné » dans
  la couverture. La couverture affichée est structurellement optimiste par rapport à la
  couverture réelle.
- **Le message « aucune qualification possible, une autre est en cours »** n'existe pas :
  l'API renvoie `null`, à charge de l'interface de l'interpréter.

---

## E. Erreurs métier

**E1. Gisement méthanisation fabriqué à partir de rien.** Voir B1 et B3. Les coefficients de
conversion eux-mêmes (250 t MS/an par élevage, 800 par IAA, 0,4 t MS/ha de CIVE,
`gisement.ts:115-118`) sont des ordres de grandeur plausibles mais non sourcés, appliqués à
des comptages qui n'existent pas. Un chiffre non sourcé multiplié par un comptage inexistant
reste un chiffre affiché.

**E2. Le zonage d'urbanisme dominant est arbitraire.** Voir C1. En droit de l'urbanisme, la
zone qui gouverne est celle qui couvre la partie constructible du projet, pas la plus vaste
du voisinage.

**E3. La surface utile n'est pas déduite.** `surf_utile` note la surface cadastrale brute.
Aucune déduction des reculs, des servitudes, des accès, des bandes de sécurité incendie ni
des zones humides internes. Sur un terrain de 12 ha, l'écart courant entre surface cadastrale
et surface réellement implantable est de 15 à 30 %. Le critère pèse 6,9 % en solaire, 7,8 %
en éolien.

**E4. La distance au poste source est à vol d'oiseau.** Le linéaire réel de raccordement suit
les voiries et les servitudes : le coefficient usuel est de 1,3 à 1,6. Le critère pèse
17,7 % en BESS et 9,2 % en solaire — l'écart n'est pas cosmétique, il déplace le classement.

**E5. Un zonage naturel non recouvrant mais à distance inconnue est noté 90/100.**
`criteres-eval.ts:800` : `if (z.distanceM == null) return z.recouvre === false ? 90 : null`.
Le cas se produit quand la requête sur un rayon de 10 km ne renvoie rien, ce qui est
défendable. Mais 90 est une note *affirmative* posée sur une absence de résultat, et le
libellé affiché est « Aucun site à proximité » — une conclusion, pas un constat de recherche
infructueuse.

**E6. Le potentiel agronomique est un proxy du groupe de culture RPG.** Il ne mesure pas la
qualité agronomique du sol, qui relève des bases IGCS régionales. Correctement étiqueté dans
la documentation, mais affiché comme une note sur 100 dans la fiche.

**E7. Le régime d'implantation photovoltaïque est déduit du seul type de sol.**
`determinerRegimeImplantation` (`index.ts:80-95`) mappe `typeSol` vers un régime juridique.
La qualification réelle d'un terrain en « dégradé » au sens du décret du 29 décembre 2023
suppose un examen du passé du site, pas une classification d'occupation du sol.

---

## F. Risques

| Risque | Origine | Probabilité / gravité |
|---|---|---|
| **Abandonner la méthanisation à tort** | filière entièrement grise (B1) | **certaine** — l'outil ne rend aucun résultat exploitable |
| **Présenter un site vert non fondé en comité** | le score de site ignore couverture et plafonds (B2) | **élevée** — c'est l'objet que l'on présente |
| **Conclure « pas d'effluents à proximité »** | zéros affichés comme mesures (B3) | élevée — décision d'écarter un secteur sur une donnée inexistante |
| **Perdre confiance dans l'outil** | carte vide sans message à l'expiration du jeton (B4) | élevée — l'utilisateur conclut à une panne |
| **Écarter ou retenir une parcelle sur un zonage arbitraire** | « dominant » mal défini (C1) | moyenne — dépend de l'ordre de réponse d'un tiers |
| **Envoyer un prospecteur sur une parcelle rédhibitoire** | rouge indistinct sur la carte (C2) | moyenne |
| **Travailler sur une liste hors sujet** | liste non bornée à l'emprise (C3) | élevée — déjà constaté à l'usage |
| **Perte de travail** | état de qualification en mémoire, aucune reprise (C6) | moyenne — un redémarrage pendant un lot de 500 parcelles |
| **Suppression du profil d'un collègue** | IDOR sur les pondérations (C4) | faible en interne, réelle en équipe |
| **Indisponibilité du serveur** | fuite mémoire du cache HTTP (C5), aucune limitation de débit (C7) | moyenne sur un service qui tourne en continu |
| **Régression silencieuse** | aucune CI, 41 tests (B6) | **élevée** — trois régressions déjà constatées en une semaine |
| **Appliquer une règle périmée** | référentiel non lié à l'invalidation (B7) | moyenne, mais fatale en crédibilité |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | Méthanisation structurellement grise (B1) | filière inutilisable | faible si l'on retire les 2 critères ; élevée si l'on ingère les couches | **critique** |
| 2 | Le score de site contourne les garde-fous (B2) | site vert non fondé | faible — réutiliser la logique de plafonnement | **critique** |
| 3 | Zéros affichés comme mesures (B3) | décision sur donnée inexistante | faible | **critique** |
| 4 | Carte muette à l'expiration du jeton (B4) | outil perçu en panne | faible | **critique** |
| 5 | Zonage dominant arbitraire (C1) | knock-out non déterministe | moyenne | **élevée** |
| 6 | Liste non bornée à l'emprise (C3) | travail hors sujet | **très faible** — passer le bbox | **élevée** |
| 7 | Rouge KO / rouge score indistincts (C2) | contresens métier sur la carte | faible — l'attribut est déjà dans la tuile | **élevée** |
| 8 | Contrôle d'accès : IDOR et rôle `lecture` (C4) | intégrité des données d'équipe | faible | **élevée** |
| 9 | Intégration continue + tests du site et des connecteurs (B6) | régressions | élevée | **élevée** |
| 10 | Fonction propriétaires vide (B5) | promesse non tenue | faible (retirer) ou élevée (implémenter) | **élevée** |
| 11 | Référentiel non lié à l'invalidation (B7) | règle périmée appliquée | moyenne | **élevée** |
| 12 | Fuite mémoire du cache HTTP (C5) | indisponibilité à terme | **très faible** | **moyenne** |
| 13 | État de qualification persistant et reprise (C6) | usage à plusieurs | moyenne | **moyenne** |
| 14 | Surface utile sans déduction (E3) | surestimation systématique | moyenne | **moyenne** |
| 15 | Distance poste à vol d'oiseau (E4) | classement faussé | faible (coefficient) | **moyenne** |
| 16 | Limitation de débit (C7) | abus de service | faible | **moyenne** |
| 17 | Validation des emprises (D) | requêtes inutiles | faible | **moyenne** |
| 18 | Unifier le vocabulaire « couverture » (C8) | confusion | faible | **faible** |
| 19 | Découpage du paquet frontend (D) | premier chargement | moyenne | **faible** |
| 20 | Accessibilité (D) | conformité, confort | moyenne | **faible** |

---

## Note globale : 57 / 100

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | **48** | le chemin parcelle est désormais solide et testé ; mais une filière sur quatre ne rend aucun résultat, le chemin site contourne tous les garde-fous, et des zéros inventés sont présentés comme des mesures |
| Qualité technique | **64** | typage strict sans échappatoire, aucun catch silencieux, SQL entièrement paramétré, catalogue cohérent ; mais aucune CI, 41 tests pour 21 648 lignes, fuite mémoire, état en mémoire |
| Qualité métier | **56** | traçabilité, avertissements et reculs réglementaires désormais exemplaires ; zonage dominant mal défini, gisement méthanisation fabriqué, surface utile non déduite |
| Ergonomie | **57** | fiche, légende et rapport PDF de bon niveau ; mais rouge indistinct, liste hors emprise, carte muette à l'expiration |
| Robustesse | **52** | dégradation par connecteur exemplaire, garde-fous d'emprise testés ; fuite mémoire, singleton, pas de reprise, pas de limitation de débit |
| Professionnalisation | **57** | documentation et installation remarquables ; pas de CI, pas de versionnement du référentiel, pas de sauvegarde automatisée |

**Sur la baisse par rapport au 66/100 annoncé ce matin.** Ce 66 n'était pas justifié. Je
l'avais posé après avoir corrigé six défauts, sans avoir examiné le chemin « site », ni
l'effet du nouveau seuil de couverture sur les filières dont des couches manquent, ni ce que
les connecteurs affichent quand une table est vide. Deux des quatre problèmes critiques
ci-dessus sont des conséquences directes de mes corrections. Le 57 d'aujourd'hui n'est pas une
dégradation du logiciel : c'est une mesure plus honnête du même logiciel, à laquelle
s'ajoutent deux régressions réelles.

---

## Conclusion

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un
> cadre professionnel sans risque majeur d'erreur ?**

**Non — et la réponse se décompose par usage.**

**Méthanisation : inutilisable.** Aucune parcelle ne peut ressortir autrement que grise.
Ce n'est pas un risque d'erreur, c'est une absence de résultat.

**Solaire, éolien, BESS, à l'échelle de la parcelle : oui comme outil de dégrossissage
interne**, à condition de savoir que la surface utile est surestimée, que la distance au
poste est à vol d'oiseau, et que le zonage d'urbanisme affiché peut ne pas être celui qui
gouverne. Le travail réglementaire à la parcelle — reculs, knock-outs, traçabilité des
sources, refus de conclure sur une donnée absente — est solide et désormais testé.

**À l'échelle du site : non.** Tant que `calculerScoreSite` ignore la couverture et les
plafonds, un site vert ne prouve rien. C'est précisément l'objet que l'on présente à un
comité.

**Comme pièce transmise à un tiers : non.** Plusieurs chiffres affichés ne sont pas
défendables devant quelqu'un qui les interroge — le gisement méthanisation, la surface utile,
le zonage dominant — et rien ne garantit qu'un score affiché a été calculé sous la
réglementation en vigueur.

### Corrections indispensables avant toute utilisation opérationnelle

Les quatre premières lignes du tableau G. Elles sont toutes de difficulté faible, sauf la
première si l'on choisit d'ingérer les couches plutôt que de retirer les critères :

1. **Traiter le gisement méthanisation** — retirer `gis_intrants` et `gis_debouche_epandage`
   du profil et redistribuer leur poids, ou ingérer les trois couches manquantes. Ne pas se
   contenter d'abaisser le seuil, qui rétablirait un score optimiste.
2. **Appliquer au score de site la même logique de plafonnement qu'au score de parcelle**, et
   exposer `couvertureDonnees` et `limitesViabilite` dans son résultat.
3. **Distinguer « couche non ingérée » de « comptage nul »** dans le connecteur gisement.
4. **Traiter les 401 de tuile** : reconnexion et bandeau explicite, pas une carte vide.

### Ensuite, avant tout usage en équipe

Borner la liste à l'emprise (6 — quelques lignes, et c'est le symptôme signalé au départ),
distinguer les deux rouges sur la carte (7 — l'attribut est déjà transporté), corriger les
deux failles de contrôle d'accès (8), et appeler `viderCacheHttp()` périodiquement (12 — une
ligne).

### Le point qui décidera de la durée de vie de l'outil

L'intégration continue et une couverture de test qui sorte du moteur parcelle (9). Le
raisonnement du premier audit se vérifie : les tests ajoutés ce matin protègent exactement ce
qui a été corrigé ce matin, et les deux défauts critiques découverts aujourd'hui vivent dans
les zones non testées — le score de site et les connecteurs. Tant que la couverture suit les
corrections au lieu de les précéder, chaque correction continuera de déplacer le défaut
plutôt que de le supprimer.
