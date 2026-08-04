# Calibration du moteur de notation — ce qui est établi, ce qui ne l'est pas

Ce document existe pour une raison précise : **un score de 72/100 a l'apparence d'une
mesure**. Il s'affiche avec une décimale, il classe des parcelles les unes par rapport aux
autres, il alimente un rapport PDF. Rien dans sa présentation n'indique lesquelles de ses
composantes reposent sur un texte réglementaire, lesquelles sur une donnée mesurée, et
lesquelles sur un jugement d'ingénieur qui n'a jamais été confronté à un chiffre réel.

La distinction est opérationnelle : on peut opposer à un tiers un critère fondé sur un
article du code de l'urbanisme, on ne peut pas lui opposer une courbe plausible.

## Trois niveaux de fondement

| Niveau | Ce que ça veut dire | Peut-on s'y fier ? |
|---|---|---|
| **Réglementaire** | Le seuil vient d'un texte daté, cité dans `REGLES_PAR_ID` | Oui, sous réserve de la version du texte |
| **Mesuré** | La valeur vient d'une source publique identifiée (IGN, GPU, RPG, Capareseau…) | Oui pour la valeur ; la fraîcheur est indiquée dans `/api/sante` |
| **Jugement** | La forme de la courbe traduit une hiérarchie plausible, sans référence externe | **Non pour décider** — utilisable pour trier |

Le score global mélange les trois. C'est inévitable — un critère de raccordement n'a pas de
seuil légal — mais cela doit être su.

## Ce qui relève du jugement, et n'est donc pas établi

### 1. Les courbes de distance au poste source

`COURBE_DISTANCE_POSTE` dans `packages/scoring/src/criteres-eval.ts`.

**Ce qui est fondé.** La hiérarchie entre filières. Un stockage vit de l'arbitrage sur des
puissances modestes et amortit mal une liaison ; un parc éolien de 30 MW en amortit
davantage ; la méthanisation se raccorde au réseau de gaz et le poste source ne la concerne
qu'en cogénération. Cet ordre est solide.

**Ce qui ne l'est pas.** Les ordonnées. Rien n'établit qu'un tracé de 6,75 km en solaire
vaut 72/100 plutôt que 60 ou 80. Aucun devis de raccordement réel n'a été confronté à la
courbe.

**Conséquence pratique.** Le **classement relatif** de deux parcelles par leur raccordement
est utilisable. La **valeur absolue** du sous-score ne l'est pas, et il ne faut donc pas
écarter une parcelle sur ce seul critère.

**Comment lever la réserve.** Rassembler dix à quinze devis de raccordement réels (ou
propositions techniques et financières d'Enedis / RTE) avec, pour chacun : la filière, la
puissance, le linéaire posé et le coût de raccordement. Tracer coût/MW en fonction du
linéaire. Placer 50/100 au linéaire où le raccordement atteint la part du budget que
l'entreprise juge rédhibitoire. C'est un après-midi de travail dès que les devis existent.

### 2. Le coefficient de tracé

`COEFFICIENT_TRACE = 1,35` dans `packages/core/src/filieres.ts`.

Le rapport entre linéaire posé et distance à vol d'oiseau est observé entre 1,3 et 1,6 sur
les raccordements réalisés. 1,35 est retenu comme valeur prudente, mais c'est une valeur
prudente **choisie**, pas mesurée sur le portefeuille de l'entreprise.

**Note importante sur l'historique.** Les abscisses de `COURBE_DISTANCE_POSTE` ont été
recalées par ce coefficient le 4 août 2026. Avant cette correction, le critère notait le
linéaire majoré sur des courbes calibrées en vol d'oiseau : la majoration se payait deux
fois. L'écart atteignait 16 points (BESS à 10 km à vol d'oiseau : 4,1/100 au lieu de 15/100).
Si vous comparez des scores calculés avant et après cette date, ils ne sont pas comparables
sur ce critère. Deux mécanismes garantissent que la base ne mélange pas les deux
générations : `VERSION_CODE_MOTEUR` est passé à `1.3.0`, et les barèmes de notation
(`COURBE_DISTANCE_POSTE`, `COURBE_PENTE`, `BANDE_PERIMETRALE_M`) entrent désormais dans
`EMPREINTE_REFERENTIEL` — de sorte qu'une future modification de courbe déclenche seule le
recalcul, sans dépendre du fait qu'on ait pensé à incrémenter la version à la main.

**Comment lever la réserve.** Relever le rapport linéaire/vol d'oiseau sur les
raccordements déjà réalisés par l'entreprise. Dix cas suffisent à savoir si 1,35 est
prudent ou optimiste sur le type de territoire prospecté ; en zone de bocage ou de relief,
1,5 serait plus juste.

### 3. La bande périmétrale et la surface implantable

`BANDE_PERIMETRALE_M` dans `packages/scoring/src/implantation.ts` : 5 m en solaire, 7 m en
stockage, 5 m en méthanisation, 0 en éolien.

Ces valeurs correspondent aux pistes périphériques et aux reculs de clôture couramment
demandés. Elles sont plausibles, non normatives : le recul réel dépend du règlement de la
zone, du SDIS pour l'accès pompiers, et de la configuration.

**Comment lever la réserve.** Comparer la surface implantable estimée à la surface
réellement clôturée sur trois à cinq centrales déjà construites.

### 4. Le potentiel agronomique dérivé du RPG

`POTENTIEL_AGRONOMIQUE` dans le connecteur RPG associe un indice 0-100 à un groupe de
culture. **C'est un proxy**, et l'interface le dit (« Indice estimé …/100 (proxy RPG) »).
Le groupe de culture déclaré renseigne sur l'usage, pas sur la qualité du sol : une prairie
sur limon profond et une prairie sur sol squelettique portent le même code.

**Comment lever la réserve.** Une étude pédologique, parcelle par parcelle. Hors de portée
d'un outil de dégrossissage — la bonne réponse est de ne jamais présenter cet indice comme
une mesure, ce que fait déjà le libellé.

### 5. Les pondérations par défaut

`PONDERATIONS_DEFAUT`. Elles traduisent une doctrine de prospection : ce qui tue un projet
en premier pèse le plus. Cette doctrine est discutable et **doit** être discutée par
l'équipe qui utilise l'outil — c'est précisément pourquoi les curseurs existent.

Elles ne sont pas un défaut du logiciel : un profil de pondération est un choix
d'entreprise, pas un paramètre technique. Mais un score calculé avec les pondérations
livrées n'est **pas** un score neutre.

## Ce qui est établi et opposable

Pour équilibrer, voici ce qui ne relève pas du jugement :

- **Les reculs réglementaires** (habitations en éolien, périmètres de monuments
  historiques, captages AEP) : textes datés, cités, avec leur référence dans la fiche.
- **Les knock-outs** : chacun est adossé à une règle de `REGLES_PAR_ID` avec sa date
  d'entrée en vigueur. Un knock-out non dérogeable est une exclusion juridique, pas une
  mauvaise note.
- **Les seuils de procédure** (ICPE, permis, évaluation environnementale) : rubriques et
  seuils cités.
- **Les surfaces cadastrales** : contenance et surface calculée, issues du PCI — indicatives
  au sens juridique (le cadastre n'est pas un document de bornage) mais mesurées, pas
  estimées.
- **Les distances mesurées** : vol d'oiseau au poste, à l'habitation, au réseau. Ce sont des
  mesures géométriques sur des géométries publiques.

## Règle de lecture

> Un score sert à **ordonner** des parcelles pour décider laquelle visiter en premier.
> Il ne sert pas à **justifier** une décision auprès d'un tiers. Ce qui justifie, ce sont
> les knock-outs, les reculs réglementaires et les seuils de procédure — tous cités avec
> leur texte dans la fiche et dans le rapport.

## Version

Ce document décrit l'état au 4 août 2026, moteur `1.3.0+4992efb4`. Toute modification d'une
courbe ou d'une pondération doit s'y refléter, et fait changer `EMPREINTE_REFERENTIEL` — ce
qui déclenche un recalcul au démarrage et rend les anciens scores explicitement périmés
plutôt que silencieusement incomparables.

Les courbes définies *à l'intérieur* d'un évaluateur (Natura 2000, argiles, karst…) ne sont
pas encore couvertes par l'empreinte : les remonter au niveau module, comme
`COURBE_DISTANCE_POSTE`, est la façon de les y faire entrer. En attendant, une modification
de l'une d'elles impose d'incrémenter `VERSION_CODE_MOTEUR` à la main.
