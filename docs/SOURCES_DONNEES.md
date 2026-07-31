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

Open data GRDF. Les identifiants de jeux évoluent : le job en essaie plusieurs et échoue
explicitement si aucun ne répond. GRTgaz et Teréga n'exposent pas de portail propre
joignable ; leurs jeux passent par ODRE.

---

## 3. Sources sans API nationale — ingestion territoriale

Ces couches n'existent pas sous forme consolidée. Leur absence est traitée comme **absence de
donnée** (critère gris), jamais comme absence de contrainte.

| Couche | Situation | Traitement |
|---|---|---|
| **ZAER** (zones d'accélération des ENR) | délibérations communales, pas de portail national consolidé | table `zaer`, ingestion territoire par territoire. `couverture_ingestion` distingue « hors ZAER » de « territoire non ingéré ». |
| **Document-cadre départemental PV au sol** (art. L.111-29 CU) | arrêtés préfectoraux départementaux | table `document_cadre_pv`. Un département non ingéré **n'écarte pas** une parcelle inculte : le knock-out ne se déclenche que si le département est ingéré **et** la parcelle absente de la liste. Certains documents-cadres procèdent par critères littéraux et non par cartographie : l'éligibilité reste alors à apprécier. |
| **Vent à 100 m** | ni le Global Wind Atlas ni l'atlas éolien français n'exposent d'API stable | un raster doit être ingéré localement (`contrainte` de type `vent_100m`). En son absence, le critère est **gris** : inventer une vitesse de vent conduirait à des décisions de prospection erronées. |
| **Intrants méthanisables** | aucune base nationale d'élevages ni de gisement | dérivés des couches locales `elevage`, `industrie_agroalimentaire` et `surface_agricole_commune` si elles sont ingérées, selon des ratios documentés dans le code. Gris sinon. |
| **Radars et servitudes aéronautiques** | non exposés par Géorisques | non couverts. Le critère est gris et les seuils de consultation (Météo-France, DGAC, armée) sont rappelés dans la fiche. |
| **Périmètres de protection de captage** | données ARS hétérogènes | non couverts de façon homogène ; critère gris. |
| **Données nominatives de propriétaires** | **aucune API publique ne les expose légalement** | table isolée `proprietaire_parcelle`, alimentée uniquement sur demande documentée auprès de la DGFiP ou de la mairie. Accès soumis à habilitation, motif obligatoire et journalisation stricte. |

Le nombre de propriétaires affiché est une **estimation** dérivée de la structure parcellaire,
pas une donnée de propriété.

---

## 4. Indicateurs dérivés — à lire comme tels

Certains critères n'ont pas de source directe et sont **calculés** par l'application. Ils sont
présentés avec une valeur juridique `indicative` et un avertissement explicite :

| Indicateur | Mode de calcul | Ce qu'il ne remplace pas |
|---|---|---|
| Pré-enjeu espèces, avifaune, chiroptères | proximité et recouvrement des zonages d'inventaire et de protection | un cycle biologique complet d'inventaires de terrain |
| Indice de covisibilité | densité patrimoniale à proximité | une analyse de bassin visuel (MNT et occupation du sol) |
| Potentiel agronomique | proxy dérivé du groupe de culture RPG | la base sol régionale (IGCS), sans API nationale |
| Indice de morcellement | rapport périmètre / périmètre du cercle équivalent | — |
| Surface d'un seul tenant | agrégation des parcelles contiguës de même section | une analyse de propriété réelle |

---

## 5. Ce qui ne doit jamais être déduit d'une absence de donnée

Règle appliquée dans tout le moteur : **un connecteur en échec ou une couche non ingérée
produit un critère GRIS**, jamais un critère favorable. Conséquences visibles :

- la fiche affiche « donnée indisponible » et la couverture de données de la parcelle baisse ;
- sous le seuil de couverture (50 % par défaut), la parcelle entière passe en **gris** et
  aucun score n'est présenté comme fiable ;
- les connecteurs en échec sont listés en bas de la fiche ;
- un knock-out ne se déclenche jamais sur une donnée absente.
