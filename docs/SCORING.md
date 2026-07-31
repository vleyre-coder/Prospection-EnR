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
| Éolien | habitation ou zone d'habitat à moins de 500 m (art. L.515-44 CE) ; site classé ; monument historique à moins de 500 m ; périmètre radar bloquant ; servitude aéronautique |
| Méthanisation | habitation à moins de 200 m ; périmètre de protection de captage immédiat ou rapproché ; cours d'eau à moins de 35 m |

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

## 3. Couverture de données et statut gris

```
couverture = Σ poids des critères renseignés / Σ poids des critères applicables
```

Sous le seuil (50 % par défaut), la parcelle passe en **gris** quel que soit son score : les
données disponibles ne suffisent pas à conclure. L'interface affiche « l'absence de donnée ne
vaut pas absence de contrainte ».

Au-dessus du seuil mais sous 80 %, un avertissement énumère les critères non évalués.

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

`packages/scoring/test/moteur.test.ts` — 19 tests couvrant :

- une parcelle favorable notée verte pour les quatre filières ;
- l'asymétrie des seuils d'éloignement (une habitation à 320 m écarte l'éolien, pas le solaire) ;
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
