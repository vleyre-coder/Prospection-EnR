# Moteur de scoring

## 1. Principe : un score explicable

Le moteur ne renvoie jamais un simple nombre. Pour chaque parcelle et chaque filière il
produit, dans `ResultatScore` :

- le **statut** de coloration (vert / orange / rouge / gris) ;
- le **score global** 0–100, ou `null` si la parcelle est écartée pour motif réglementaire ;
- la liste des **critères rédhibitoires** déclenchés, avec leur motif circonstancié et la
  règle juridique datée qui les fonde ;
- les **limites de viabilité économique** éventuelles ;
- le **détail de chaque critère** : note, poids normalisé, contribution, valeur brute, valeur
  affichée, commentaire, source et règles liées ;
- les **trois points forts** et **trois points de vigilance** ;
- les **seuils de procédure** applicables avec leur date d'entrée en vigueur ;
- la **couverture de données** et les pondérations effectivement appliquées.

Un utilisateur doit toujours pouvoir répondre à la question « pourquoi cette parcelle est-elle
verte ? » en dépliant la fiche.

## 2. Trois mécanismes, dans cet ordre

### 2.1 Critères rédhibitoires — knock-outs

Une seule condition remplie suffit à écarter la parcelle : le statut passe à **rouge** et le
score n'est **pas** calculé — un score sur une parcelle réglementairement écartée serait
trompeur.

Communs aux quatre filières :

| Knock-out | Fondement |
|---|---|
| Zone de protection forte (cœur de parc national, réserve naturelle, APPB) | recouvrement |
| Zone humide cartographiée | séquence éviter-réduire-compenser |
| PPRI zone rouge | interdiction de construire |
| Espace boisé classé | interdiction de changement d'affectation du sol |
| Poste source saturé | absence de capacité |
| Emplacement réservé | foncier destiné à un autre usage |
| Zonage naturel (N) | installations non admises |

Spécifiques :

| Filière | Knock-outs supplémentaires |
|---|---|
| Solaire au sol | hors document-cadre départemental (terrain inculte) ; aire parcellaire AOP viticole |
| Éolien | recul de 500 m vers une habitation ou une zone d'habitat **hors d'atteinte** (art. L.515-44 CE) ; site classé ; monument historique à moins de 500 m ; périmètre radar bloquant ; servitude aéronautique |
| Méthanisation | recul de 200 m vers une habitation **hors d'atteinte** ; périmètre de protection de captage immédiat ou rapproché ; cours d'eau à moins de 35 m |

**« Hors d'atteinte » et non « bord à moins de 500 m ».** Le recul réglementaire se mesure
depuis l'installation, jamais depuis la limite de propriété. Le moteur ajoute donc à la
distance mesurée au bord un **déport possible** à l'intérieur de la parcelle, approché par le
rayon du disque de même surface (1 ha → 56 m, 10 ha → 178 m, 40 ha → 357 m) : une parcelle de
40 ha dont le bord est à 430 m peut porter une machine à 787 m, elle n'est pas écartée. Cette
approximation est conservatrice — une parcelle réelle n'est pas circulaire — et ne remplace
pas une étude d'implantation ; le motif affiché le dit.

**Deux knock-outs sont « dérogeables »** et font basculer en orange avec alerte forte plutôt
qu'en rouge — parce que le cahier des charges les formule lui-même de façon conditionnelle :

1. **zonage incompatible mais dérogeable** (zone N, emplacement réservé) : une procédure de
   modification du PLU ou un STECAL peut lever l'obstacle, au prix de 12 à 24 mois ;
2. **poste source saturé mais avec un renforcement programmé au S3REnR** : la parcelle
   redevient intéressante si le calendrier du projet s'aligne sur celui du renforcement.

Un knock-out ne se déclenche **jamais** sur une donnée absente. Exemple : un terrain inculte
dans un département dont le document-cadre n'est pas ingéré n'est pas écarté ; il conserve son
score et le critère reste gris.

### 2.2 Score pondéré

Sur les parcelles non écartées, 46 critères répartis en 12 familles. Chaque critère produit
une note 0–100 par **interpolation linéaire par paliers**, ce qui rend la courbe lisible et
documentable : « à 5 km on note 72, à 10 km on note 40 ».

```
score = Σ (note_i × poids_i) / Σ poids_i        sur les seuls critères renseignés
```

Les poids sont normalisés à 1 sur les critères **applicables** à la filière et à la
configuration. Un critère non applicable (le gisement pour le stockage, l'orientation pour la
méthanisation) est exclu du calcul, pas noté zéro.

Les seuils par défaut : ≥ 65 → vert, ≥ 40 → orange, sinon rouge. Modifiables par l'utilisateur.

### 2.3 Limites de viabilité économique

Distinctes des knock-outs : la parcelle est **licite** mais un projet ne peut pas y être
financé en l'état. Elles ne remettent pas le score à zéro, elles **plafonnent le statut**.

| Condition | Plafond |
|---|---|
| Surface < 25 % du minimum de la filière | rouge |
| Surface < 60 % du minimum de la filière | orange |

Le score reste affiché : l'utilisateur doit pouvoir constater qu'une parcelle est écartée pour
motif économique et non réglementaire. Et surtout, ces parcelles **restent mobilisables au sein
d'un site** : dix parcelles de 0,2 ha ne sont finançables qu'ensemble, et l'agrégation ne
retire du site que les parcelles frappées d'un knock-out réglementaire bloquant.

### Le site est soumis aux mêmes garde-fous que la parcelle

`calculerScoreSite` appliquait autrefois les seuls seuils vert et orange. Ni le seuil de
couverture, ni le plafond d'incertitude, ni les limites de viabilité, ni la règle « un
knock-out dérogeable interdit le vert » ne s'y appliquaient — si bien que **deux parcelles
individuellement grises produisaient un site vert à 95/100**. Agréger deux inconnues ne
produit pas une certitude, et le site est précisément l'objet que l'on présente en comité.

Le site expose désormais sa propre `couvertureDonnees` — moyenne des parcelles retenues,
pondérée par leur surface — et ses propres `limitesViabilite`, et il leur est soumis. Une
seule limite ne se propage pas : l'**insuffisance de surface**, qui est réévaluée sur la
surface retenue du site. C'est la raison d'être de l'agrégation : dix parcelles de 0,3 ha
sont chacune sous le seuil de 1 ha, le site de 3 ha ne l'est pas.

## 3. Couverture de données et statut gris

```
couverture = Σ poids des critères renseignés / Σ poids des critères applicables
```

Trois régimes, et non deux :

| Couverture | Statut | Raison |
|---|---|---|
| < 80 % | **gris**, quel que soit le score | les données disponibles ne suffisent pas à conclure |
| 80 % à 90 % | plafonné à **orange**, score affiché | il reste trop d'inconnu pour affirmer « propice » |
| ≥ 90 % | statut libre, **vert** possible | la conclusion est fondée |

Le seuil de grisement était à 50 %. Une parcelle dont la moitié du poids des critères n'avait
pas pu être évaluée sortait donc avec un score publié — et pouvait ressortir verte, c'est-à-dire
« à démarcher ». Le vert affirme une conclusion ; il exige désormais une couverture qui la
fonde. Entre les deux seuils, le plafonnement est explicite : il apparaît dans les limites de
viabilité avec son motif, pas en silence.

L'interface rappelle dans tous les cas que « l'absence de donnée ne vaut pas absence de
contrainte », et énumère les critères non évalués.

### Critères sans source nationale

Un quatrième cas se distingue des trois précédents : un critère dont **la source n'existe
pas** sur le territoire, et qui manque donc identiquement à *toutes* les parcelles.

Le compter comme non renseigné fait chuter la couverture de la même quantité partout : cela
ne discrimine rien, et peut faire passer une filière entière sous le seuil. C'est exactement
ce qui est arrivé à la méthanisation — `gis_intrants` (16,5 %) et `gis_debouche_epandage`
(7,3 %) dépendent de couches d'élevages, d'industries agroalimentaires et de surfaces
agricoles qui ne sont ingérées nulle part, soit 23,8 % du poids. La couverture plafonnait à
76 %, sous le seuil de 80 % : **toute parcelle, partout en France, ressortait grise.**

Un tel critère est donc :

- **exclu du dénominateur de couverture** — le score redevient calculable et comparable d'une
  parcelle à l'autre sur ce qui *peut* être su ;
- **affiché en gris** dans la fiche, avec sa part réelle du sujet et un commentaire disant où
  chercher l'information (atlas DREAL, plan d'épandage, lettres d'intention…) ;
- **plafonnant le statut à orange**, via la limite `criteres_sans_source` : aucune parcelle ne
  peut être déclarée propice sur un enjeu que personne n'a regardé.

Le jour où les couches sont ingérées, le critère redevient ordinaire et le plafond disparaît
de lui-même. Le connecteur distingue pour cela « aucune couche » de « comptage nul » : sans
cette distinction, `count(*)` renvoyait 0 et la fiche affichait « 0 élevage à moins de
10 km » comme un constat de terrain.

## 4. Règles propres à chaque filière

### 4.1 Solaire au sol et agrivoltaïsme

Le **régime d'implantation** est déterminé à partir de la nature du sol, et conditionne le
cadre juridique rappelé dans la fiche :

| Nature du sol | Régime | Cadre |
|---|---|---|
| artificialisé, dégradé | PV au sol sur terrain dégradé | configuration la plus favorable |
| agricole exploité | agrivoltaïsme | décret n° 2024-318 : couverture ≤ 40 %, zone témoin ≥ 5 %, avis CDPENAF |
| inculte ou non exploité | PV au sol sous document-cadre | art. L.111-29 CU ; hors document-cadre : rédhibitoire |
| naturel ou forestier | PV au sol avec défrichement | fortement pénalisé |

La nature du sol se déduit du RPG **croisé avec le zonage d'urbanisme** : une parcelle absente
du RPG en zone U ou AU est artificialisée, pas une terre agricole délaissée — la distinction
change le régime juridique applicable.

Le caractère « inculte ou non exploité depuis le 10 mars 2013 » dépasse la profondeur
d'historique du RPG interrogeable : il est signalé **à démontrer** (photo-interprétation,
historique RPG), jamais affirmé.

La compatibilité agrivoltaïque est notée par groupe de culture RPG : prairies, estives et
maraîchage favorables ; grandes cultures mécanisées pénalisées ; vigne quasi exclue.

Le potentiel agronomique est un **critère inverse** : un excellent sol agricole pénalise le
projet, parce qu'il accroît le conflit d'usage et l'opposition de la profession agricole.

### 4.2 Éolien terrestre

500 m est un **plancher légal, pas une cible** : la courbe de notation continue de progresser
jusqu'à 1 500 m, car la plupart des parcs autorisés se situent au-delà de 700 m.

Le seuil s'applique aussi aux **zones destinées à l'habitation** du document d'urbanisme, et
pas seulement au bâti existant : l'application interroge donc les zonages U et AU du GPU dans
un rayon élargi.

La courbe de proximité des monuments historiques est nettement plus étalée que pour les autres
filières : un aérogénérateur est visible de très loin.

### 4.3 Stockage par batteries

Le gisement n'intervient pas — aucun critère de la famille `gisement` n'est évalué. Le
raccordement pèse plus de 40 % du score normalisé.

La courbe de surface est **non monotone** : une parcelle beaucoup trop grande n'apporte rien et
coûte cher à maîtriser. L'optimum est de 1 à 3 ha.

### 4.4 Méthanisation

Deux critères rois : la **densité d'intrants** et le **débouché** (injection ou épandage).
L'un et l'autre dépendent de couches locales ; en leur absence, ils sont gris.

Au-delà de 8 km du réseau gaz, l'injection devient difficile à financer même avec le droit à
l'injection : la fiche invite alors à étudier la cogénération.

## 5. Agrégation en sites

`calculerScoreSite` consolide plusieurs parcelles :

1. les parcelles frappées d'un **knock-out réglementaire bloquant** sont retirées du site ;
2. les parcelles écartées **pour la seule insuffisance de surface** sont conservées : c'est la
   raison d'être de l'agrégation ;
3. le score consolidé est la moyenne pondérée par la surface des parcelles retenues ;
4. une **pénalité de fragmentation** s'applique lorsqu'une partie du site a été retirée :
   `score × (0,7 + 0,3 × part retenue)`, car un site troué perd en cohérence d'implantation.

## 6. Personnalisation

L'utilisateur peut modifier les poids critère par critère et les seuils de coloration. Ces
pondérations ne sont **jamais matérialisées** en base : elles sont calculées à la volée et
appliquées côté carte par `setFeatureState`, ce qui recolore instantanément sans retélécharger
les tuiles. Les profils peuvent être enregistrés et partagés à l'équipe.

Un **mode scénario dérogatoire** permet de désactiver certains knock-outs pour explorer une
hypothèse. L'interface signale alors explicitement que le résultat ne reflète pas le cadre
réglementaire en vigueur.

## 7. Référentiel réglementaire daté

Chaque seuil porte sa référence juridique, sa date d'entrée en vigueur et un indicateur
d'instabilité. Le référentiel entier porte une date de dernière vérification manuelle
(`REFERENTIEL_DERNIERE_VERIFICATION`), affichée dans la fiche et dans le PDF.

C'est une exigence de fond : les seuils solaires ont changé deux fois en deux ans. Une valeur
sans date n'est pas exploitable pour décider.

## 8. Tests

`packages/scoring/test/moteur.test.ts` — 31 tests couvrant :

- une parcelle favorable notée verte pour les quatre filières ;
- l'asymétrie des seuils d'éloignement (une habitation proche écarte l'éolien, pas le solaire) ;
- le déport d'implantation : une parcelle de 40 ha au bord à 430 m est conservée, la même
  distance sur 1,5 ha reste éliminatoire ;
- l'absence des critères avifaune, chiroptères et covisibilité, faute de source ;
- le plafonnement à orange entre 80 % et 90 % de couverture ;
- les critères sans source : exclusion du dénominateur, plafond à orange, part affichée
  correcte, et distinction d'avec un comptage réellement nul ;
- le score de site : parcelles grises → site gris, knock-out dérogeable → pas de vert,
  surface appréciée sur le site et non parcelle par parcelle ;
- AOP viticole, document-cadre départemental présent ou non ingéré ;
- poste saturé avec et sans renforcement programmé (orange contre rouge) ;
- bascule en gris sous le seuil de couverture ;
- cohérence arithmétique entre contributions et score global ;
- réaction au changement de pondération ;
- limites de viabilité et conservation des petites parcelles dans un site ;
- absence de critère de gisement pour le stockage et domination du raccordement.

```bash
npm run test -w @enr/scoring
```

`apps/api/test/` — 34 tests : emprises de qualification, accès aux tuiles, données de
démonstration, part de recouvrement des zonages, contrôle d'accès par rôle et limitation de
débit.

L'ensemble est vérifié à chaque poussée par `.github/workflows/ci.yml`, qui enchaîne typage,
construction et tests, puis rejoue les migrations SQL deux fois sur une base PostGIS jetable
pour vérifier leur idempotence.
