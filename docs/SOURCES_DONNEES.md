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

## 3. Sources sans API nationale — ingestion territoriale

Ces couches n'existent pas sous forme consolidée. Leur absence est traitée comme **absence de
donnée** (critère gris), jamais comme absence de contrainte.

| Couche | Situation | Traitement |
|---|---|---|
| **ZAER** (zones d'accélération des ENR) | délibérations communales, pas de portail national consolidé | table `zaer`, ingestion territoire par territoire. `couverture_ingestion` distingue « hors ZAER » de « territoire non ingéré ». |
| **Document-cadre départemental PV au sol** (art. L.111-29 CU) | arrêtés préfectoraux départementaux | table `document_cadre_pv`. Un département non ingéré **n'écarte pas** une parcelle inculte : le knock-out ne se déclenche que si le département est ingéré **et** la parcelle absente de la liste. Certains documents-cadres procèdent par critères littéraux et non par cartographie : l'éligibilité reste alors à apprécier. |
| **Vent à 100 m** | ✅ **couvert** — voir §2.5 | raster national Global Wind Atlas, ingéré et échantillonné localement |
| **Intrants méthanisables** | aucune base nationale d'élevages ni de gisement | dérivés des couches locales `elevage`, `industrie_agroalimentaire` et `surface_agricole_commune` si elles sont ingérées, selon des ratios documentés dans le code. Gris sinon. |
| **Servitudes aéronautiques (T4, T5, T7)** | ⚠️ **partiellement couvert** — SUP du GPU, voir §2.6 | national mais publié territoire par territoire par les services de l'État |
| **Radars météorologiques et militaires** | pas de jeu national ouvert identifié | non couverts. Les positions du réseau ARAMIS de Météo-France ne sont pas publiées en open data réutilisable ; les seuils de consultation sont rappelés dans la fiche et l'avis du gestionnaire reste à solliciter. |
| **Périmètres de protection de captage** | ⚠️ **partiellement couvert** — SUP `AS1` du GPU, voir §2.6 | l'assiette est exposée, mais **pas la sous-catégorie** (immédiat, rapproché, éloigné), qui doit être lue sur l'arrêté de DUP du captage |
| **Données nominatives de propriétaires** | **aucune API publique ne les expose légalement** | table isolée `proprietaire_parcelle`, alimentée uniquement sur demande documentée auprès de la DGFiP ou de la mairie. Accès soumis à habilitation, motif obligatoire et journalisation stricte. |

Le nombre de propriétaires affiché est une **estimation** dérivée de la structure parcellaire,
pas une donnée de propriété.

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
