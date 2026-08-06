# Sources de données

Ce document décrit **ce que l'application sait réellement**, source par source, et surtout
**ce qu'elle ne sait pas**. Les contrats techniques vérifiés (chemins, paramètres, formats de
réponse, pièges) figurent dans [API_CONTRACTS.md](API_CONTRACTS.md).

Chaque donnée affichée porte, dans la fiche parcelle, le nom de sa source, son millésime, la
date d'interrogation et sa **valeur juridique** :

| Valeur juridique | Signification |
|---|---|
| `opposable` | la donnée a une portée réglementaire (zonage PLU, Natura 2000, PPR) |
| `indicative` | la donnée éclaire la décision sans l'engager (cadastre, capacités de raccordement) |
| `pre_reperage` | la donnée ne fait que signaler un enjeu à confirmer sur le terrain (zones humides) |

---

## 1. Sources interrogées en temps réel

Interrogées à la volée lors de la qualification d'une parcelle, avec cache mémoire de
15 minutes. Aucune ingestion, donc aucune péremption possible.

| Donnée | Source | Ce qu'on en tire | Limites assumées |
|---|---|---|---|
| Parcellaire cadastral | IGN API Carto — Cadastre (PCI Express) | contours, contenance, IDU, commune | **contour indicatif, sans valeur juridique** ; surfaces différant de la contenance cadastrale |
| Zonage d'urbanisme | IGN API Carto — GPU | zonage PLU/PLUi/CC, prescriptions (EBC, emplacements réservés), servitudes, détection du RNU | ne contient que les documents **effectivement téléversés** par les collectivités : une commune absente du GPU n'est pas une commune sans PLU. Le **règlement écrit n'est pas lu** : l'application fournit son URL. |
| Occupation agricole | IGN API Carto — RPG, 5 millésimes | culture, groupe de culture, continuité d'exploitation | ne recense que les îlots **déclarés à la PAC**. Une parcelle absente peut relever d'un exploitant non déclarant. |
| AOP viticoles | INAO via WFS Géoplateforme | appellations recouvrant la parcelle | n'expose que la dénomination et le comité régional. Le module AOC de l'API Carto exige une clé FranceAgriMer privée : il est **inutilisable**. |
| Zonages naturels | INPN / MNHN via API Carto Nature | Natura 2000 (habitats et oiseaux), ZNIEFF I et II, réserves, parcs — recouvrement **et distance** | les ZNIEFF n'ont pas de portée réglementaire directe mais pèsent dans l'instruction |
| Risques | Géorisques (BRGM) | argiles, cavités, mouvements de terrain, PPRN, PPRT, TRI, sites pollués, ICPE | les PPR sont recensés **au niveau communal** : l'application signale la présence d'un PPR mais **ne peut pas déterminer le zonage applicable à la parcelle** (rouge, bleu…). Ce zonage reste à lire sur le règlement du PPR. |
| Topographie | IGN RGE ALTI | pente, orientation, altitude, dénivelé | estimés par régression du plan des altitudes sur une grille de 36 points. Un levé topographique reste nécessaire au dimensionnement. |
| Bâti, voirie, hydrographie | IGN BD TOPO (WFS) | distance à l'habitation la plus proche (seuils 500 m et 200 m), desserte, cours d'eau | les **constructions récentes et les permis en cours n'y figurent pas** : vérification de terrain indispensable avant de conclure sur un seuil réglementaire |
| Boisement | IGN BD Forêt V2 (WFS) | part boisée, type de formation, enjeu défrichement | part boisée approchée par rapport de surfaces, non par intersection exacte |
| Zones humides | Couche BCAE (WFS) | pré-repérage | **pré-repérage seulement.** Le caractère humide se détermine par sondages pédologiques et relevés floristiques (arrêté du 24 juin 2008 modifié). Les inventaires départementaux ne sont pas tous intégrés. |
| Irradiation et productible | PVGIS (Commission européenne, base SARAH2) | irradiation dans le plan des modules, productible annuel | angles optimaux ; ne remplace pas une étude de productible |
| Géocodage | Géoplateforme (`data.geopf.fr/geocodage`), repli sur `api-adresse.data.gouv.fr` | recherche d'adresses et de communes | l'ancien service est déprécié et renvoie fréquemment `503`, d'où le repli |

---

## 2. Sources ingérées par lots

Non interrogeables en temps réel à l'échelle nationale. Leur **fraîcheur est suivie** dans
`source_donnee` et exposée par `GET /api/sante`.

### 2.1 Postes sources et capacités de raccordement — le point dur

Il n'existe **aucune API nationale** fournissant des postes sources géolocalisés avec leurs
quotas S3REnR. Constats vérifiés :

- `opendata.enedis.fr` : catalogue Opendatasoft **hors service** (410) ;
- ODRE `postes-electriques-rte` : **sans coordonnées** ;
- `data.gouv.fr` : uniquement des jeux locaux ou ultramarins, aucun jeu national ;
- `capareseau.fr` : aucune API REST ni WFS.

Le seul chemin fiable est le couple d'endpoints non documentés `capareseau.fr/medias/<UUID>` :
un export CSV national (3 119 postes, toutes les données S3REnR) et un JSON par région
**avec coordonnées**, joignables par le champ `code`. Ces UUID **ne sont pas devinables** et
sont traités comme volatiles : le job les ré-extrait du HTML à chaque exécution.

Conséquences opérationnelles :

- ingestion **mensuelle** uniquement, par respect pour un service non contractuel ;
- si les UUID changent, le job échoue proprement, `source_donnee.dernier_statut` passe à
  `echec` et l'interface signale la source périmée. Les critères de raccordement redeviennent
  gris — jamais faussement favorables ;
- les capacités sont **indicatives et non engageantes** : seule une étude de raccordement,
  puis une proposition technique et financière du gestionnaire, engagent une capacité.

L'état de saturation n'est pas publié par Capareseau : il est **dérivé** de la capacité
disponible (`INFO_NA`, `*_CDR`) selon des seuils applicatifs documentés dans le code
(≤ 0 MW → saturé, < 10 MW → tendu, sinon disponible). Le taux de remplissage de l'enveloppe
S3REnR ne sert qu'en l'absence de capacité publiée : un poste peut avoir une enveloppe
presque consommée **et** des centaines de mégawatts disponibles par ailleurs.

Environ 1,5 % des enregistrements présentent des coordonnées inversées ; elles sont détectées
par contrôle de plausibilité (France métropolitaine et DROM), corrigées, ou reprojetées depuis
le Lambert-93. Un poste dont la position reste implausible est **ignoré** plutôt que mal placé.

### 2.2 Communes

`geo.api.gouv.fr`, département par département, avec contours. Socle de la vue nationale
agrégée : sans cette ingestion, la carte est vide sous le zoom 14.

### 2.3 Monuments historiques

Base des immeubles protégés (Ministère de la Culture). Le portail Opendatasoft plafonne à
10 000 enregistrements par pagination ; au-delà il faut passer par l'export. La couverture
réellement ingérée est tracée par département dans `couverture_ingestion`, ce qui permet de
distinguer « aucun monument » de « département non ingéré ».

Le **périmètre délimité des abords (PDA)** se substitue au rayon de 500 m lorsqu'il existe :
l'application applique le rayon par défaut et le signale.

### 2.4 Réseau gaz

Open data GRDF, jeu `les-sites-dinjection-de-biomethane-en-france` : 840 sites géolocalisés,
dont 836 en service. Les identifiants de jeux évoluent — le job en essaie plusieurs, du plus
récent au plus ancien, et échoue explicitement si aucun ne répond.

Ce jeu publie une **capacité de production annuelle en GWh/an**, pas un débit d'injection en
Nm³/h. La colonne `capacite_nm3h` reste donc nulle : convertir supposerait d'inventer un nombre
d'heures de fonctionnement. Seule la **distance au point d'injection** est exploitée par le
scoring, et c'est elle qui détermine la faisabilité du raccordement. Les sites fermés
(`site_ouvert = False`) sont écartés : les retenir donnerait un faux débouché.

GRTgaz et Teréga n'exposent pas de portail propre joignable ; leurs jeux passent par ODRE.

## 2.6 Calques cartographiques (affichage)

Distincts des sources de **scoring** : ces calques servent à *voir* les contraintes, pas à
les noter. Le catalogue complet est dans `apps/api/src/calques.ts`, avec pour chaque entrée
sa source, son millésime et sa valeur juridique — affichés dans l'interface.

Trois modes, choisis selon ce que le producteur publie réellement :

| Mode | Principe | Calques |
|---|---|---|
| **Image relayée** | tuile WMTS ou WMS officielle, reproxifiée par l'API | forêts publiques ONF, BD Forêt v2, forêts anciennes, OLD, zones humides BCAE, CLC zones humides, ZNIEFF (vue d'ensemble) |
| **Vecteur à la demande** | GeoJSON interrogé sur l'emprise visible | Natura 2000 habitats et oiseaux, ZNIEFF I et II, réserves naturelles, parcs nationaux et régionaux, sites classés/inscrits et périmètres ABF (SUP `AC1`/`AC2`/`AC4` du GPU) |
| **Base** | objets ingérés | monuments historiques |

Pourquoi ce panachage plutôt qu'une ingestion générale : demander à l'exploitant d'ingérer
plusieurs gigaoctets de vecteur national pour un simple affichage serait disproportionné, et
la donnée serait périmée dès l'ingestion. Une image officielle est toujours à jour côté
producteur. Le vecteur n'est retenu que là où personne ne publie d'images fiables — et là,
il apporte en prime des objets nommés et cliquables.

Comme le fond de carte, les images passent par le relais de l'API (`/api/carte/calque/…`) :
elles restent donc disponibles sur un poste dont le navigateur n'atteint pas
`data.geopf.fr`. La liste des calques relayés est fermée.

**Les identifiants de couches WMTS/WMS ont été vérifiés** contre les `GetCapabilities` de la
Géoplateforme. Un identifiant erroné produirait un calque silencieusement vide — le pire des
cas, puisqu'il se lirait comme une absence de contrainte.

### 2.5 Gisement de vent — Global Wind Atlas

Le Global Wind Atlas (DTU Wind Energy / Banque mondiale) publie, par pays, un raster GeoTIFF
des vitesses moyennes de vent. Pour la France, le fichier à 100 m couvre le territoire au pas
de **250 m** (8 055 × 4 143 pixels, 55 Mo).

Ce n'est pas une API d'interrogation ponctuelle : le fichier est téléchargé par un job
d'ingestion annuel, puis échantillonné localement pixel par pixel. La lecture est en accès
aléatoire — une requête d'un seul pixel ne charge que la tuile concernée, le fichier n'est
jamais monté en mémoire en entier.

Valeurs de contrôle relevées : 6,97 m/s en Beauce, 6,96 m/s dans la vallée du Rhône,
7,05 m/s sur la côte bretonne, 4,23 m/s dans une vallée alpine abritée.

**Limite** : c'est un modèle de réanalyse, avec une incertitude de l'ordre de 0,5 m/s, et
davantage en terrain complexe. Il ne remplace pas une campagne de mesure sur site — mais il
suffit largement à écarter un secteur peu venté avant tout déplacement.

### 2.6 Servitudes d'utilité publique — le Géoportail de l'Urbanisme

Le GPU **est** une API nationale pour les servitudes d'utilité publique, publiées par
catégorie selon la nomenclature du CNIG. L'application exploite :

| Catégorie | Objet | Champ alimenté |
|---|---|---|
| `AS1` | périmètres de protection des captages d'eau potable | `eau.captageAep` |
| `T4`, `T5`, `T7` | servitudes aéronautiques de balisage et de dégagement | `risques.servitudesAeronautiques` |
| `PT1` à `PT3` | servitudes radioélectriques (émission, faisceaux hertziens) | `risques.faisceauxHertziens` |
| `I1`, `I3`, `I4`, `I6` | hydrocarbures, gaz, ouvrages électriques, mines | `risques.reseauxEnterres` |
| `AC1`, `AC2`, `AC4` | monuments historiques, sites, patrimoine | corrobore la rubrique patrimoine |
| `PM1` à `PM3` | plans de prévention des risques | corrobore Géorisques |

**Sa couverture est partielle** : seules figurent les servitudes effectivement téléversées par
les services de l'État et les collectivités. Conséquence directement visible dans le code : un
champ ne passe à `false` que si des SUP ont été reçues pour le secteur ; si la réponse est
vide, il reste à `null` et le critère est **gris**. L'absence d'une catégorie sur un territoire
ne prouve pas l'absence de servitude.

---

### 2.7 ZAER et sites protégés — deux couches nationales longtemps ignorées

Ajoutées à l'audit 8, qui a montré que les deux étaient **lues par l'application et écrites par
personne**. Le catalogue des sources annonçait « aucune API nationale consolidée » pour les ZAER ;
c'était inexact, et cette croyance a laissé gris l'argument réglementaire le plus utile de la
prospection depuis la loi APER.

| Couche WFS | Objets | Table |
|---|---|---|
| `zaer:zaer` | 1 089 671 | `zaer` |
| `sites_metropole_gpkg_*:STE_Metropole` + 3 couches d'outre-mer | 7 753 en métropole | `contrainte`, types `site_classe` et `site_inscrit` |

**Les deux vocabulaires sont codés, et les deux cachent un piège.** Ils ont été mesurés sur les
données réelles avant d'écrire la moindre correspondance — c'est la leçon des audits 5 à 8, où le
défaut n'était jamais dans le calcul mais dans la traduction d'un vocabulaire supposé.

- **68 % des ZAER photovoltaïques portent sur des TOITURES** (`detail_filiere1 = TOIT`, 293 sur 430
  échantillonnées). Traduire `SOLAIRE_PV` en `solaire_sol` sans lire le détail ferait dire à
  l'application « cette parcelle est en zone d'accélération pour le solaire au sol » à propos de la
  toiture d'une maison de quartier. Seuls `SOL` et `SURFACE` sont retenus ; `OMBRIERE` désigne un
  ombrage de parking, qui ne se prospecte pas comme du foncier.
- **`typesite` compte cinq valeurs, dont trois sont des LABELS** : « Patrimoine mondial » (UNESCO),
  « Grand Site de France » et « Projet Grand Site de France » n'ont pas de portée réglementaire propre
  au sens des articles L. 341-1 et L. 341-10. Les ranger en site classé déclencherait un knock-out
  éolien **non dérogeable à tort**.
- **Le stockage (`bess`) n'est couvert par aucune ZAER** : la loi APER porte sur la *production*. Le
  critère restera sans source pour cette filière, quelle que soit la qualité de l'ingestion.

Une valeur non reconnue n'est jamais rangée par défaut : elle est journalisée et l'objet n'est pas
ingéré. Mieux vaut une zone ignorée qu'une zone mal classée.

**Deux pièges d'ingestion, trouvés à l'exécution réelle.** `idsup` n'est pas unique — un site est
découpé en parties, 24 pour le site d'Alésia — donc les parties sont **réunies** et non dédupliquées,
ce qui aurait perdu 23 géométries sur 24 en silence. Et le département n'est pas lisible dans `idsup`
(`AC2-130010002-447` : `130010002` est un identifiant *national*, dont les deux premiers caractères
valent `13` pour tout le pays) : il est déduit par jointure spatiale sur `commune`. Sans la table des
communes, aucune couverture n'est enregistrée et l'ingestion le **dit**.

Commandes : `npm run ingest -- patrimoine_sites` puis `npm run ingest -- zaer_local`. La seconde
demande environ une heure. La table `commune` doit être ingérée avant la première.

## 3. Sources sans API nationale — ingestion territoriale

Ces couches n'existent pas sous forme consolidée. Leur absence est traitée comme **absence de
donnée** (critère gris), jamais comme absence de contrainte.

| Couche | Situation | Traitement |
|---|---|---|
| **ZAER** (zones d'accélération des ENR) | ✅ **couvert depuis l'audit 8** — voir §2.7 | couche nationale `zaer:zaer` du WFS Géoplateforme, 1 089 671 zones. La ligne précédente de ce tableau disait « pas de portail national consolidé » : c'était faux, et cette croyance a laissé le critère gris depuis l'origine. |
| **Sites classés et inscrits** | ✅ **couvert depuis l'audit 8** — voir §2.7 | couches `STE` du WFS Géoplateforme, 6 617 sites (2 612 classés, 4 005 inscrits) plus l'outre-mer. Les **SPR ne sont pas** dans cette couche et restent non ingérés. |
| **Document-cadre départemental PV au sol** (art. L.111-29 CU) | arrêtés préfectoraux départementaux | table `document_cadre_pv`. Un département non ingéré **n'écarte pas** une parcelle inculte : le knock-out ne se déclenche que si le département est ingéré **et** la parcelle absente de la liste. Certains documents-cadres procèdent par critères littéraux et non par cartographie : l'éligibilité reste alors à apprécier. |
| **Vent à 100 m** | ✅ **couvert** — voir §2.5 | raster national Global Wind Atlas, ingéré et échantillonné localement |
| **Intrants méthanisables** | aucune base nationale d'élevages ni de gisement | dérivés des couches locales `elevage`, `industrie_agroalimentaire` et `surface_agricole_commune` si elles sont ingérées, selon des ratios documentés dans le code. Gris sinon. |
| **Servitudes aéronautiques (T4, T5, T7)** | ⚠️ **partiellement couvert** — SUP du GPU, voir §2.6 | national mais publié territoire par territoire par les services de l'État |
| **Radars météorologiques et militaires** | pas de jeu national ouvert identifié | non couverts. Les positions du réseau ARAMIS de Météo-France ne sont pas publiées en open data réutilisable ; les seuils de consultation sont rappelés dans la fiche et l'avis du gestionnaire reste à solliciter. |
| **Périmètres de protection de captage** | ⚠️ **partiellement couvert** — SUP `AS1` du GPU, voir §2.6 | l'assiette est exposée, mais **pas la sous-catégorie** (immédiat, rapproché, éloigné), qui doit être lue sur l'arrêté de DUP du captage |
| **Données nominatives de propriétaires** | **aucune API publique ne les expose légalement** | table isolée `proprietaire_parcelle`, alimentée uniquement sur demande documentée auprès de la DGFiP ou de la mairie. Accès soumis à habilitation, motif obligatoire et journalisation stricte. |

**Le nombre de propriétaires n'est plus affiché du tout tant que rien n'est versé.** Il valait la
constante `1`, en dur, pour toutes les parcelles de France, sous un commentaire décrivant un
algorithme jamais écrit (audit 8) : le critère affichait « 1 propriétaire(s) estimé(s) » avec un feu
vert à 100/100, sur le premier facteur de mortalité d'un projet. Le nombre de comptes cadastraux
n'est pas déductible de la structure parcellaire — deux parcelles contiguës de même section
appartiennent souvent au même compte, mais l'écart n'est ni borné ni mesurable sans la donnée
nominative. Un proxy dont on ne peut pas évaluer l'erreur n'a pas sa place sur ce critère.

### 3.1 Obtenir et verser les données de propriété

C'est la seule couche que l'application ne peut pas aller chercher elle-même. La chaîne
complète existe côté lecture — habilitation, motif obligatoire, journalisation stricte,
avertissements, purge automatique à échéance — mais la table reste vide jusqu'à ce que
quelqu'un l'alimente. Voici comment.

**1. Obtenir les données.** Deux voies, selon le besoin :

- **Service de la publicité foncière (DGFiP)** — consultation du fichier immobilier au titre de
  l'article L.107 A du code général des impôts. La demande porte sur des parcelles identifiées
  et doit énoncer sa finalité. La réponse est nominative.
- **Mairie** — les communes disposent de la matrice cadastrale et peuvent communiquer des
  informations de propriété dans le cadre du code des relations entre le public et
  l'administration. C'est souvent la voie la plus rapide sur un petit nombre de parcelles.

Dans les deux cas, **conservez la référence de la demande** : c'est elle qui justifie la
détention et qui permet de répondre à un exercice de droit d'accès.

**2. Verser le résultat.** Le fichier reçu se met au format suivant, puis :

```bash
npm run verser:proprietaires --workspace @enr/api -- proprietaires-2026-05.csv
```

```csv
idu;nb_comptes;indivision;proprietaire_public;nominatif;origine_donnee;purge_prevue_le
283900000C0843;2;oui;non;{"noms":["DUPONT Jean"]};Demande DGFiP du 12/05/2026 ref 2026-0412;2027-05-12
```

Le script **refuse tout le fichier** si une seule ligne est irrecevable — un versement partiel
de données personnelles laisserait la base dans un état que personne n'a décrit. Deux colonnes
sont obligatoires et c'est délibéré :

- `origine_donnee` : sans provenance documentée, la détention n'est pas justifiable.
- `purge_prevue_le` : une donnée personnelle conservée sans échéance est conservée
  illicitement. Alignez la date sur la durée de votre démarche de prospection.

**3. La purge s'exécute seule.** Au démarrage du serveur puis une fois par jour, le champ
`nominatif` des enregistrements arrivés à échéance est effacé. La provenance et les indicateurs
non nominatifs (nombre de comptes, indivision) sont conservés, et la purge est inscrite au
journal d'accès avec le nombre de lignes traitées.

**Ce que l'application ne fera jamais.** Ces données ne sortent ni dans les tuiles
vectorielles, ni dans les exports CSV, Shapefile, GeoJSON ou PDF, ni dans aucune réponse
accessible à un utilisateur non habilité. Elles ne sont lisibles que sur une consultation
explicite, avec motif saisi, et cette consultation est journalisée.

---

## 4. Indicateurs dérivés — à lire comme tels

Certains critères n'ont pas de source directe et sont **calculés** par l'application. Ils sont
présentés avec une valeur juridique `indicative` et un avertissement explicite :

| Indicateur | Mode de calcul | Ce qu'il ne remplace pas |
|---|---|---|
| Pré-enjeu espèces protégées | proximité et recouvrement des zonages d'inventaire et de protection | un cycle biologique complet d'inventaires de terrain |
| Potentiel agronomique | proxy dérivé du groupe de culture RPG — affiché « indice estimé … (proxy RPG) » | la base sol régionale (IGCS), sans API nationale |
| Surface implantable | érosion du contour d'une bande périmétrale, périmètre reconstruit et majoré par le morcellement | un plan de masse et l'avis du SDIS |
| Linéaire de raccordement | distance à vol d'oiseau majorée de 35 % | l'étude de raccordement du gestionnaire de réseau |
| Part couverte par un zonage d'urbanisme | échantillonnage de ~400 points dans la parcelle | une intersection géométrique exacte |
| Régime d'implantation photovoltaïque | déduit de la nature du sol observée, affiché « présumé » | l'examen de l'historique du site (décret du 29 décembre 2023) |
| Indice de morcellement | rapport périmètre / périmètre du cercle équivalent | — |
| Surface d'un seul tenant | agrégation des parcelles contiguës de même section | une analyse de propriété réelle |

### Trois indicateurs retirés

**Sensibilité avifaune** et **sensibilité chiroptères** étaient dérivées des mêmes zonages que
le pré-enjeu espèces. Trois critères d'apparence indépendante portaient donc le même nombre, et
pesaient ensemble 18 % du score éolien — la proximité d'une ZNIEFF était comptée trois fois.
Aucune source nationale ne publie ces sensibilités à la parcelle : les champs restent vides et
la fiche indique qu'ils relèvent d'un atlas DREAL ou LPO, plutôt que d'afficher une case
blanche qui se lit « rien à signaler ».

L'**indice de covisibilité** était calculé comme `6 × nombre de monuments dans un rayon`, borné
à 100. Ce nombre ne mesure aucune covisibilité : deux monuments derrière une crête donnaient 12,
un seul monument en vis-à-vis direct donnait 6. Il est supprimé ; la covisibilité relève d'une
étude paysagère.

---

## 5. Ce qui ne doit jamais être déduit d'une absence de donnée

Règle appliquée dans tout le moteur : **un connecteur en échec ou une couche non ingérée
produit un critère GRIS**, jamais un critère favorable. Conséquences visibles :

- la fiche affiche « donnée indisponible » et la couverture de données de la parcelle baisse ;
- sous le seuil de couverture (50 % par défaut), la parcelle entière passe en **gris** et
  aucun score n'est présenté comme fiable ;
- les connecteurs en échec sont listés en bas de la fiche ;
- un knock-out ne se déclenche jamais sur une donnée absente.

### 3.2 Intrants méthanisables — recherche de source menée, et pourquoi elle n'aboutit pas

Cette section existe pour qu'on ne refasse pas la recherche. `gis_intrants` pèse **16,5 % de la note
méthanisation** et reste déclaré sans source ; voici ce qui a été établi par mesure, et ce qu'il
faudrait pour changer cela.

**La classification ICPE est disponible, et fiable.** L'API Géorisques `installations_classees`
expose, sur chaque installation, trois booléens `bovins`, `porcs`, `volailles`, un `codeNaf`, et la
liste de ses `rubriques`. Mesuré sur deux territoires :

| Territoire | Installations dans 20 km | Élevages | IAA (NAF 10/11) | IAA (rubrique 22xx) |
|---|---|---|---|---|
| Beauce (1,75 / 48,15) | 196 | 3 | 4 | 12 |
| Bretagne (−1,68 / 48,11) | 896 (300 lus) | 4 | 9 | 9 |

Deux enseignements pour l'implémentation, le jour où elle se fera :

- **`industrie: true` ne veut PAS dire agroalimentaire** — 69 installations sur 196 en Beauce, en
  incluant l'énergie (NAF 35), les carrières (08) et les déchets (38). Le bon critère est le code
  NAF 10 ou 11, **combiné par OU** avec une rubrique 22xx : sur 9 + 9 installations en Bretagne,
  seules 3 satisfont les deux. Prendre l'un ou l'autre seul en perdrait les deux tiers.
- **`etatActivite` vaut `None` pour 57 % des installations.** On ne peut donc pas filtrer sur « en
  exploitation » sans écarter la majorité des inconnues. Seul `En fin d'exploitation` doit être
  exclu : une installation qui ferme n'est pas un fournisseur d'intrants.

**Ce qui manque est le VECTEUR, pas la donnée.** Deux voies, toutes deux fermées à ce jour :

- *par appel* — l'API interroge par point et rayon. Un comptage à 10 km pour les élevages et 20 km
  pour les IAA demande **dix à vingt requêtes paginées par parcelle** (896 installations dans 20 km
  autour de Rennes, par pages de 100), sur un quota public limité à une requête par seconde et
  partagé par toute l'équipe — celui que la limitation de débit de la qualification existe précisément
  pour protéger. Mettre ce comptage en cache par commune reviendrait à présenter un fait communal
  comme une mesure parcellaire : le défaut corrigé deux fois à l'audit 8 ;
- *par fichier* — les deux jeux nationaux référencés sur data.gouv (« Base des installations classées
  (ICPE) », `icpe.geojson.gz`, et « ICPE — France métropolitaine et DROM ») datent tous deux de
  **2021**, et le serveur de fichiers de Géorisques refuse l'accès direct (403). Une base ICPE de cinq
  ans pour compter des fournisseurs d'intrants raisonnerait sur des installations fermées et
  ignorerait les nouvelles.

**Décision.** Le critère reste `sansSource`, et la fiche dit où chercher. Le jour où un export national
daté est publié, l'ingestion est un travail court : le classifieur est décrit ci-dessus, le job se
calque sur `ingererSitesProteges`, et le reste du dispositif — couverture par département, comptage
par couche, agrégation qui refuse les totaux partiels — est déjà en place.

**Ce qu'il ne faut PAS utiliser.** La couche WFS `REPARTITION.POTENTIEL.METHANISATION.2050` existe et
est tentante : 3 690 objets, un champ `potentiel_t`. Elle est inexploitable pour ce critère, et pour
deux raisons cumulées — c'est une **projection à 2050**, non un gisement mobilisable aujourd'hui, et
elle est découpée **par canton**, non à la parcelle. L'employer serait commettre en une fois les deux
erreurs que l'audit 8 a corrigées : un fait de mauvaise nature, à la mauvaise échelle. Elle peut servir
de calque d'orientation sur la carte, à condition d'être étiquetée pour ce qu'elle est.

### 3.3 Réseau de gaz — pourquoi la distance de raccordement reste grise

Même démarche, même conclusion, et il faut la dire pour la même raison.

`racc_distance_reseau_gaz` pèse 11 % de la note méthanisation et attend la distance à une
**canalisation**. La table `canalisation_gaz` n'est peuplée par rien.

La couche `BDTOPO_V3:canalisation` du WFS Géoplateforme paraît répondre. Elle ne répond pas :
**8 156 objets** au niveau national, dont les seules natures relevées sur 8 000 objets échantillonnés
sont `Autres matières premières` (85 %) et `Hydrocarbures` (15 %). Aucune valeur « gaz ». Et l'ordre de
grandeur suffit à trancher : le seul réseau de transport de GRTgaz dépasse 32 000 km. Cette couche
décrit des canalisations remarquables de la BD TOPO, pas le réseau gazier.

GRTgaz publie son réseau de transport sur son propre portail ; GRDF ne publie pas la distribution. À
défaut, le critère reste `sansSource` et renvoie vers le gestionnaire — ce qui est de toute façon le
passage obligé, la capacité d'injection et le zonage de raccordement ne se déduisant d'aucune
géométrie.

### 3.4 Sites patrimoniaux remarquables — absents de la couche ingérée

La couche `STE` du WFS Géoplateforme, désormais ingérée (§2.7), ne porte **que** les sites classés et
inscrits. Les SPR n'y figurent pas, et aucune couche SPR n'existe sur ce service — la seule couche
patrimoniale voisine est `patrinat_bpm:Bien_patrimoine_mondial_UNESCO`, qui relève d'un tout autre
dispositif. Les SPR restent donc déclarés non ingérés, et `patrimoine()` retourne `recouvre: null` pour
ce type : le critère ne conclut pas, et ne prétend pas conclure.
