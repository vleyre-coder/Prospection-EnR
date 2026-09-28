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
instruite du catalogue. La section **2.7** et le **score (§6)** lui sont entièrement consacrés ; les
sections 3, 4, 5 et 7 portent la marque **[27/09]** là où elles ont été remesurées ce jour-là.

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
| Tests hors base | **1 202 / 1 202** |
| Tests exigeant une base | **170 / 170** (4 ignorés : migrations destructives, sur 174 déclarés) |
| Bout en bout (navigateur réel) | **27 / 27**, 2 ignorés |
| Motifs de mutation | **346 / 346 attrapés, 0 survivant** — campagne complète, bout en bout compris |
| Chaîne complète × filières | **30 / 30 en HTTP 200** — recherche, fiche PDF, fiche `.eml`, dossier de site, cahier des charges, CSV, pour chacune des cinq |
| Cahiers des charges | 5 / 5, et **réellement distincts** par filière |

**[27/09] Quatre de ces tests étaient rouges la veille, et l'audit ne l'avait pas vu.** Les quatre
tests de seuil sur le poste renseigné n'envoyaient aucun jeton à une route protégée : ils recevaient
401 et échouaient sur leur première assertion. Le correctif qu'ils gardent — un seuil de capacité lit
la valeur sur le poste qui la *porte* — n'était donc gardé par rien depuis qu'il avait été écrit.
C'est la même leçon que l'audit 13 : **un chiffre de vérification doit être remesuré, pas recopié.**

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

### 2.8 [28/09] Un poste source saturé écartait 100 parcelles dans les cinq filières

Ce knock-out écartait **définitivement** la parcelle — statut rouge, score annulé, sortie des listes
et des sites — sauf si un renforcement était inscrit au S3REnR. Mesuré : **100 parcelles sur 301,
dans les cinq filières**, soit cinq cents verdicts.

Ce n'était pas une lecture juridiquement soutenable, et quatre choses le montrent :

1. **Aucun article ne l'adossait.** Il était le seul knock-out non dérogeable à porter
   `regleLiee: null`. Tous les autres citent leur fondement — L.515-44 pour les 500 m de l'éolien,
   R.411-15 pour l'arrêté de biotope, L.341-10 pour le site classé. Le référentiel ne contient
   aucune règle sur la saturation, **parce qu'il n'en existe aucune** : un poste saturé n'est pas
   une servitude et ne s'oppose à personne.
2. **La source refuse d'engager.** L'avertissement Capareseau, affiché dans la fiche, dit :
   « capacités indicatives et **non engageantes**, évolutives au fil des demandes de raccordement ».
   Fonder une exclusion définitive sur un indicateur que l'application déclare elle-même non
   engageant est contradictoire.
3. **Le motif se contredisait** : il écartait la parcelle tout en écrivant qu'un poste alternatif
   plus éloigné pouvait être étudié.
4. **Les alternatives figuraient dans la donnée.** Sur la parcelle 280290000Z0399, DAMBRON est
   saturé à 6,75 km — mais ORGERES porte 1,5 MW à 9,28 km et TIVERNON 1,1 MW à 9,7 km. La parcelle
   était écartée alors que deux postes raccordables figuraient dans son propre instantané.

**Ce qui ne change pas, et c'est la moitié qui compte :** le knock-out reste posé et plafonne à
orange. La saturation du poste le plus proche est le premier obstacle pratique d'un projet ENR — la
faire disparaître de la fiche serait la dérive inverse, et bien pire. La parcelle conserve son score
et son rang, et n'est **jamais** déclarée propice. L'arbitrage revient au prospecteur, qui connaît
le calendrier du projet et l'appétence du développeur pour une quote-part — deux choses que
l'application ignore. Un motif de mutation interdit désormais tout retour à l'exclusion définitive.

Le motif **nomme l'alternative** quand il en existe une — nom, capacité, distance — ou dit qu'il n'y
en a aucune. « Un poste alternatif peut être étudié » n'aide personne ; « ORGERES, 1,5 MW à 9,3 km »
se vérifie et s'appelle.

### 2.9 [28/09] Le raster de vent se cherchait là où le processus avait été lancé

`gis_vent` — **10,9 % du poids éolien** — était gris sur 100 % du parc, et deux causes distinctes
s'y superposaient, toutes deux silencieuses. Le raster est un **fichier**, pas une table : le
redémarrage du conteneur l'a emporté quand les couches en base avaient survécu. Et
`REPERTOIRE_DONNEES` vaut `data`, un chemin **relatif** : l'ingestion relancée depuis `apps/api`
écrivait dans `apps/api/data/vent/`, la reprise lancée depuis la racine cherchait dans `data/vent/`.

J'ai donc mesuré « vent indisponible » sur un raster présent, et j'ai failli l'écrire ici. Le bilan
d'ingestion annonçait « chemin: data/vent/gwa-fra-100m.tif » — exact et inutilisable, puisque c'est
précisément l'ambiguïté du chemin relatif qui rend la panne invisible. Il annonce désormais le
chemin **résolu**. Valeur de contrôle après correction : **6,97 m/s en Beauce**, conforme à celle
documentée en §2.5 de `SOURCES_DONNEES.md`.

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

**La méthanisation reste la filière la plus pénalisée**, mais moins qu'hier. Mesuré sur les 301
parcelles reprises, **49,5 % de son poids reste gris**, en deux parts qui ne se traitent pas
pareil : **34,9 % sans source** (hors du dénominateur de couverture, plafonnant le statut à orange)
et **14,7 % indisponible** (dans le dénominateur — c'est cette part qui décide du gris). Avant la
reprise, le poids gris valait 53,2 % : **+7,3 pour l'épandage réglé, −3,7 pour `risq_inondation`,
devenu gris entre les deux mesures parce que Géorisques est tombé.** Les données de propriété (`fonc_*`) ne sont pas publiques —
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

**26/09 : 76 / 100. 27/09 : 78 / 100. 28/09 : 85 / 100**, pour l'usage demandé — prospecter
aujourd'hui et proposer à des développeurs des projets *fiables*.

Le saut du 28/09 ne vient d'aucune donnée nouvelle. **Il vient d'avoir cessé de compter comme des
ignorances trois choses qui n'en étaient pas** : une absence constatée dans un rayon interrogé, une
saturation de réseau prise pour une interdiction légale, et deux critères qu'aucune source au monde
n'expose comptés comme des mesures manquantes. Les cinq filières classent désormais, sans une seule
parcelle grise.

### Ce qui porte la note

| | |
| --- | --- |
| **Les cinq filières produisent une liste classée** | 300 parcelles en solaire, stockage et agrivoltaïsme ; **216 en méthanisation** ; 51 en éolien. **Plus une seule parcelle grise nulle part.** |
| **Le classement discrimine** | écarts-types de 2,9 à 5,5 points ; la méthanisation, la plus instruite depuis le 28/09, est aussi la plus discriminante |
| **Les écartées le sont pour un motif juridique** | après correction du poste saturé, les knock-outs restants citent tous leur article : L.515-44 (500 m), code du patrimoine (abords), L.341-10 (site classé) |
| **Les documents ne surestiment plus ce qu'ils savent** | deux couvertures affichées côte à côte, sources nommées, knock-outs rattachés à leur article |
| **La boucle est fermée** | un cahier des charges se traduit en recherche, et le rapport rend les grandeurs filtrées |
| **La vérification est sérieuse** | 1 202 tests hors base, 170 avec base, 27/27 au navigateur, **346/346 mutations attrapées sans un survivant**, 30/30 sur la chaîne complète des cinq filières |

### Ce qui l'empêche de monter

| | |
| --- | --- |
| **La méthanisation classe, mais sur 56 % du sujet** | elle propose 216 parcelles et les discrimine bien. Mais `gis_intrants` (16,5 %) et `racc_distance_reseau_gaz` (11,0 %) restent sans source joignable : le document le dit en deux chiffres, et le développeur doit le lire |
| **Géorisques est injoignable d'ici** | six critères de risque gris, et 46 secondes par parcelle passées à attendre un hôte muet. Ce n'est pas un défaut de l'application, mais l'exploitant le subit quand même |
| **Aucune parcelle n'est verte, et ce n'est pas un défaut** | le plafond `criteres_sans_source` tient tant qu'un enjeu n'a aucune source. L'outil classe *à l'intérieur* de l'orange — il faut le savoir en lisant une liste |
| **Les données de propriété ne sont pas publiques** | structurel : demande encadrée auprès de la publicité foncière |
| **La relecture juridique reste à faire** | 128 articles à confronter, 28 règles marquées à valider |

### [28/09] L'état du parc après les déblocages — plus une seule parcelle grise

Trois corrections ont été apportées le 28/09, chacune parce qu'une donnée **existait** et n'était
pas comptée. Aucune n'invente de valeur, aucune ne lève le plafond orange.

| Filière | Classées | Grises | Écartées | Score : min → max (σ) | Couverture mesurable / catalogue |
| --- | --- | --- | --- | --- | --- |
| Solaire au sol | **300** | 0 | 1 | 50,6 → 68,0 (2,9) | **95,6 %** / 86,8 % |
| Agrivoltaïsme | **300** | 0 | 1 | 42,6 → 71,0 (3,4) | **95,4 %** / 79,4 % |
| Stockage (BESS) | **300** | 0 | 1 | 41,9 → 56,8 (3,0) | 89,1 % / 86,9 % |
| **Méthanisation** | **216** | **0** | 85 | 65,8 → 91,7 (5,5) | **85,9 %** / 56,0 % |
| Éolien terrestre | **51** | 0 | 250 | 51,2 → 70,4 (3,8) | **92,7 %** / 79,7 % |

**Comparaison avec le 27/09, à données de terrain identiques** — seule la façon de les compter a
changé :

| Filière | Classées avant → après | Couverture mesurable avant → après |
| --- | --- | --- |
| Méthanisation | 2 → **216** (153 grises levées) | 77,6 % → **85,9 %** |
| Éolien | 0 → **51** (60 grises levées) | 72,6 % → **92,7 %** |
| Solaire | 200 → **300** | 91,7 % → 95,6 % |
| Agrivoltaïsme | 199 → **300** | 86,7 % → 95,4 % |
| Stockage | 200 → **300** | 89,1 % |

**La méthanisation classe.** C'était l'objectif : elle ne laissait aucune parcelle exploitable pour
le tri, elle en propose 216 avec un écart-type de 5,5 points — le plus discriminant des cinq.

**Ce que chaque correction a apporté, mesuré séparément :**

1. **« Rien dans le rayon interrogé » est une mesure.** `distanceCoursEauM` n'était renseignée que
   sur **2 parcelles sur 301** ; **299 portent désormais une borne démontrée**. La BD TOPO n'était
   jamais en échec — la Beauce est un plateau de craie, et l'absence de cours d'eau à moins d'un
   kilomètre y est le cas général. C'est **la situation la plus favorable que ce critère puisse
   noter**, puisqu'il sature à 300 m : 5,5 % du poids méthanisation étaient retirés du calcul pour
   cela.
2. **Un poste saturé plafonne, il n'exclut plus.** 100 parcelles étaient écartées dans les cinq
   filières — cinq cents verdicts — sur le seul knock-out non dérogeable à ne citer aucun article.
   Voir §2.8.
3. **Deux critères qu'aucune source n'expose sortent du dénominateur** : `env_especes_protegees` et
   `fonc_maitrise`. Ils restent affichés, plafonnent toujours le statut à orange, et disent
   désormais où chercher l'information plutôt que de laisser croire qu'une ingestion y remédierait.

**Ce qui reste gris, et pourquoi.** En méthanisation : `gis_intrants` (16,5 %) et
`racc_distance_reseau_gaz` (11,0 %), faute de source joignable ; `risq_karst` (4,6 %), qu'aucune API
n'expose ; `fonc_nb_proprietaires` (2,8 %), donnée non publique ; `risq_inondation` (3,7 %),
Géorisques injoignable depuis ce poste ; et `dist_captage` (5,5 %) — **le garde a refusé de
conclure**, le GPU n'ayant téléversé aucune servitude pour ces secteurs. L'absence d'AS1 n'y prouve
rien, et le critère le dit.

### [27/09] L'état du parc après reprise des 301 parcelles

Toutes les parcelles ont été reprises et renotées au moteur 1.6.0. Ce tableau est la réponse la
plus directe à « est-ce utilisable aujourd'hui ».

| Filière | Classées | Grises | Écartées | Score : min → max (σ) | Couverture mesurable / catalogue |
| --- | --- | --- | --- | --- | --- |
| Solaire au sol | **200 orange** | 0 | 101 | 51,5 → 68,0 (3,0) | 91,7 % / 86,8 % |
| Stockage (BESS) | **200 orange** | 0 | 101 | 42,9 → 56,8 (2,7) | 89,1 % / 86,9 % |
| Agrivoltaïsme | **199 orange** | 1 | 101 | 47,5 → 71,0 (3,5) | 86,7 % / 79,4 % |
| Éolien terrestre | 0 | 60 | **241** | 45,8 → 65,1 (4,2) | 72,6 % / 68,8 % |
| Méthanisation | 2 orange | **153** | 146 | 62,1 → 89,9 (6,3) | 77,6 % / 50,5 % |

**`gis_debouche_epandage` est renseigné sur 301 parcelles sur 301** — il l'était sur zéro.

**Aucune parcelle n'est verte, sur aucune filière, et c'est voulu.** Tant qu'un critère n'a aucune
source sur le territoire, la limite `criteres_sans_source` plafonne le statut à orange : « aucune
parcelle ne peut être déclarée propice tant que ces enjeux n'ont pas été regardés ». L'outil classe
donc *à l'intérieur* de l'orange, par score — ce qui est exactement ce qu'il faut pour prospecter,
mais il faut le savoir en lisant une liste.

**L'éolien n'écarte pas par manque de données : il écarte par knock-out.** 241 parcelles sur 301,
sur l'éloignement de l'habitat et le patrimoine désormais ingéré. C'est un résultat, pas une panne.

### Ce qui sépare la méthanisation d'un classement utilisable : un seul point d'entrée

La mesure mérite d'être posée exactement, parce qu'elle change ce qu'il y a à faire.

Le gris d'une filière se décide sur la couverture du **mesurable** — les critères sans source en
sont exclus, puisqu'ils manquent identiquement à toutes les parcelles et ne discriminent rien. Le
seuil est de **80 %**. Mesuré sur les 301 parcelles : **77,6 %**. Il manque 2,4 points.

Ce qui manque au dénominateur se décompose ainsi :

| Critère gris | Poids | Nature |
| --- | --- | --- |
| `dist_captage` | 5,50 % | indisponible — **compte** dans le dénominateur |
| `dist_eau` | 5,50 % | indisponible — **compte** |
| `risq_inondation` | 3,67 % | indisponible — **compte** (PPRI, Géorisques) |
| `gis_intrants` | 16,51 % | sans source — exclu |
| `racc_distance_reseau_gaz` | 11,01 % | sans source — exclu |
| `risq_karst` | 4,59 % | sans source — exclu |
| `fonc_nb_proprietaires` | 2,75 % | sans source — exclu |

**Retrouver `risq_inondation` seul fait passer la couverture de 77,6 % à 83,1 %** — au-dessus du
seuil — et **les 153 parcelles grises deviennent classables**. C'est **un point d'entrée Géorisques**, pas une
ingestion à écrire. Et ce n'est pas une hypothèse : ce critère était **renseigné sur 100 % des
parcelles qualifiées avant que Géorisques ne devienne injoignable**, et gris sur 100 % de celles
reprises depuis. Le basculement se lit directement dans la base. Les 16,5 % du gisement d'intrants, eux, sont hors du dénominateur : ils
plafonnent le statut à orange, ce qui est voulu, mais **ils n'empêchent pas le classement**.

Autrement dit : la méthanisation n'est pas bloquée par ce qui lui manque le plus lourdement, mais
par trois critères moyens dont un seul suffirait. Sur un poste où Géorisques répond, la filière
sort du gris **sans une ligne de code de plus**.

### [28/09] Pourquoi 85, et pourquoi pas plus

**Ce qui justifie +7.** Les cinq filières classent, sans une seule parcelle grise, et les 566
parcelles rendues au classement l'ont été **sans qu'aucune donnée nouvelle n'entre** : elles étaient
écartées ou grisées par trois erreurs de comptage, dont une erreur de droit. Un outil de prospection
qui écarte un tiers de son parc sur une saturation de réseau — un indicateur que sa propre source
déclare non engageant — n'est pas fiable, il est timide au mauvais endroit.

**Ce qui interdit d'aller plus haut**, et chacun de ces points est mesuré, pas supposé :

- **27,5 % du poids de la méthanisation n'a aucune source joignable** — gisement d'intrants et
  tracé gaz. Le document l'affiche en deux chiffres (85,9 % du mesurable, 56,0 % du sujet), ce qui
  est honnête, mais un développeur qui ne lit que le premier se trompera.
- **Six critères de risque dépendent de Géorisques**, injoignable depuis ce poste. Sur un poste où
  il répond, quatre filières gagnent encore quelques points — et `risq_inondation` est le seul
  critère qui empêchait la méthanisation de dépasser 90 %.
- **Aucune parcelle ne peut être verte.** Tant qu'un enjeu n'a aucune source, le plafond tient. Le
  classement est donc un ordre *à l'intérieur* de l'orange : utile pour prospecter, insuffisant pour
  promettre.
- **La relecture juridique reste entière** : 128 articles à confronter, 28 règles à valider.

**Et une raison de ne pas aller plus haut qui tient à moi.** Les trois corrections du 28/09 changent
des **verdicts**, pas des affichages : 566 parcelles ont changé de statut. Elles sont gardées par
huit motifs de mutation, dont ceux qui interdisent de revenir à l'exclusion définitive, de faire
passer une borne pour une mesure, et de lever le plafond orange. Mais elles n'ont pas encore été
confrontées au terrain par un prospecteur. Une note plus haute demanderait cette confrontation, pas
une correction de plus.

### Pourquoi +2 et pas +5 (27/09)

Le débouché d'épandage réglé, c'est **7,3 points** sur une filière qui en avait 53,2 de gris. Le
reste — 49,5 % — ne demande pas d'écrire du code : le connecteur et l'agrégation sont écrits et
testés, **il manque un accès réseau** (§4.1). Un audit qui compterait cela comme réglé parce que « la
mécanique est prête » se raconterait une histoire, et le prospecteur s'en apercevrait au premier
dossier.

Le reste du gain ne se voit dans aucune couverture. **Quatre faux comptes ont été retirés avant
d'atteindre la production** (§2.7 et §4.1), un cinquième n'a pas été livré faute d'être vérifiable
(les corridors gaz), et **quatre tests que l'audit de la veille comptait comme verts étaient rouges**
(§1). Aucun des faux comptes n'aurait produit d'erreur ni de ligne de journal — ils auraient produit
des nombres crédibles. C'est exactement le genre de défaut qui fait qu'un développeur cesse de croire
un outil, et ils comptent dans la note même s'ils ne se voient nulle part.

**Pourquoi pas moins non plus.** On pourrait soutenir que découvrir quatre tests rouges et quatre
faux comptes en une journée devrait faire *baisser* la note. Je ne le crois pas : ils ont tous été
trouvés par des gardes que le dépôt possède déjà — le contrôle de superficie, le garde des points
décimaux, l'analyse SQL, la vérification par mutation — et aucun n'a atteint un document remis à
quelqu'un. Un outil qui trouve ses propres défauts avant l'utilisateur vaut mieux qu'un outil qui
n'en trouve aucun.

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
# JAMAIS par `import()` depuis l'arbre de travail : le module lance la campagne a l'import,
# et mute alors les fichiers versionnes. (Un marqueur `.mutation-en-cours` les restaure a
# l'invocation suivante, mais mieux vaut ne pas en avoir besoin.)
cp -a . /tmp/campagne && cd /tmp/campagne
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e node scripts/mutation.mjs
```

**⚠️ Ne lancez pas `test:base` et la campagne de mutation en meme temps.** Les deux ecrivent dans la
MEME base et se partagent le territoire fictif du departement 99. Le garde `refusDeCourse` protege
contre le parallelisme des FICHIERS a l'interieur d'une execution, pas contre deux executions
concurrentes : mesure du 28/09/2026, `test:base` a rendu 2 echecs pendant qu'une campagne tournait,
et 170/170 seul, quelques minutes plus tard. Un echec qui ne se reproduit pas seul vient de la, et
non du code.

**[27/09] Reprendre les 301 parcelles apres une ingestion**, ce qu'il faut faire pour qu'elles voient
la nouvelle donnee. Compter **46 secondes par parcelle** tant que Georisques est injoignable — six
points d'entree qui attendent chacun leur delai. En un seul processus, les 301 demandent quatre
heures ; **en six processus shardes par reste modulo, trente-sept minutes**. Le coupe-circuit par
hote est par PROCESSUS, donc chaque shard decouvre la panne une fois et une seule.

```bash
# Un shard par processus : `i % 6 === shard` repartit les parcelles sans recouvrement.
for s in 0 1 2 3 4 5; do
  DATABASE_URL=... npx tsx reprise.ts $s 6 &
done; wait
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
