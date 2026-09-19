# Rapport de vérification — intégration du référentiel de contraintes

**Millésime du classeur** : 2026-09-18 · **empreinte des cellules** `6c672b8213566b1b`
**Date du relevé** : 19 septembre 2026 · **base de mesure** : 301 parcelles réelles relevées (`enr_e2e`)

---

## 0. Ce que ce rapport dit, et ce qu'il ne dit pas

Ce document **mesure**. Chaque nombre qu'il contient a été compté sur le code et sur les données
au moment de sa rédaction, jamais estimé. Les nombres sont figés par un test
(`packages/scoring/test/couverture-referentiel.test.ts`) : ils ne peuvent pas se périmer en
silence.

Ce qu'il ne dit pas, et qu'aucune mesure automatique ne dira : si une contrainte du classeur est
**juridiquement exacte**. L'application recopie le classeur ; elle ne le valide pas. La
vérification du contenu réglementaire reste un travail humain, et le §5 ci-dessous nomme
précisément les endroits où elle est indispensable avant toute décision.

---

## 1. Fidélité au référentiel

| Mesure | Valeur |
| --- | --- |
| Contraintes du classeur intégrées | **292** |
| Filières couvertes | **5** (éolien terrestre, solaire au sol, agrivoltaïsme, BESS, méthanisation) |
| Contraintes dont le seuil ne porte **aucun nombre** | **239** |
| Contraintes dont l'extraction numérique est **incomplète** | **58** |
| Rédhibitoires / pénalisantes / favorables / cadre | **133 / 134 / 11 / 14** |

**Le texte du seuil est toujours recopié, jamais reformulé.** C'est la règle la plus importante de
l'intégration, et elle explique les deux lignes « 239 » et « 58 ».

239 seuils sur 292 ne contiennent aucun nombre — « selon nature du monument », « interdit si le
règlement l'exclut », « aléa fort ». Ils sont affichés tels quels. 58 autres portent plus de
nombres que l'extraction n'en a convertis : régimes ICPE à double seuil
(« 100 m (Déclaration) / 200 m (Enregistrement-Autorisation) »), fourchettes (« 700-1000 m »),
multiples d'une grandeur du projet (« 3-5 × diamètre du rotor »). Pour ceux-là, **le texte reste
affiché en entier et la contrainte ne tranche aucun verdict automatique** : choisir un des deux
régimes ICPE à la place de l'opérateur, ce serait décider de la nature du dossier.

Une reformulation perdrait ce qui compte. « ≥ 500 m (modulable à la hausse) » n'est pas « au moins
500 m » : la modulation par le préfet disparaît dans la paraphrase, et c'est exactement ce que
l'opérateur doit pouvoir citer.

**Le millésime ne se redate pas tout seul.** Il est adossé à une empreinte des seules cellules du
classeur. Ni un commentaire réécrit, ni un champ calculé ajouté au module généré ne constituent
une relecture du classeur — deux redatations fausses ont eu lieu avant cette règle.

---

## 2. Les deux seuils (§2.3)

| | Mode 1 — carte | Mode 2 — cahier des charges |
| --- | --- | --- |
| Seuil appliqué | **toujours** `seuil_reglementaire` | `seuil_developpeur`, **sinon** `seuil_reglementaire` |
| Le seuil développeur peut-il assouplir ? | sans objet | **non** — refusé par le serveur |
| Où le choix est fait | `packages/core/src/seuils-developpeur.ts`, **et nulle part ailleurs** |

L'invariant tient parce qu'un seul endroit du code choisit entre les deux seuils. La fiche d'une
parcelle passe le mode littéral `'reglementaire'` ; aucun profil ne peut l'atteindre. Un opérateur
qui lirait « défavorable » sur une fiche lirait sinon l'exigence commerciale d'un développeur en
croyant lire le droit.

**Le durcissement seul est accepté**, et le sens du seuil doit être établi pour le vérifier. Quatre
contraintes mesurées portent un opérateur `egal`, qui ne veut pas dire « exactement » mais « sens
non établi par le classeur » : l'opérateur doit alors fournir le sens, et il n'est jamais supposé.
Une version antérieure faisait ce contrôle à l'envers — elle refusait 300 m comme un
assouplissement et acceptait 700 m comme un durcissement — parce qu'elle lisait la colonne
« Caractère » (quand la règle se déclenche) au lieu de la colonne « Seuil » (ce que la parcelle
doit satisfaire).

**Un écart au cahier des charges ne dégrade jamais le verdict.** Une parcelle à 250 m d'une
habitation est légalement conforme au régime ICPE de 200 m ; si le développeur en demande 400, cela
apparaît dans `ecartsCahierDesCharges`, pas dans le verdict. Confondre les deux ferait dire à
l'application que la loi interdit ce qu'un client préfère éviter.

---

## 3. Ce que le moteur tranche réellement

Le verdict est rendu par le référentiel ; le score pondéré, inchangé, sert au classement. Les deux
cohabitent sans que l'un touche à l'autre.

| Filière | Contraintes | Classées `auto_sig` | Raccordées au relevé | `auto_sig` non raccordées | Vérification manuelle |
| --- | --- | --- | --- | --- | --- |
| Éolien terrestre | 83 | 54 | **18** | 36 | 29 |
| Solaire au sol | 60 | 48 | **15** | 33 | 12 |
| Agrivoltaïsme | 52 | 31 | **12** | 19 | 21 |
| BESS | 43 | 27 | **11** | 16 | 16 |
| Méthanisation | 54 | 36 | **17** | 19 | 18 |
| **Total** | **292** | **196** | **73** | **123** | **96** |

Les 73 correspondances sont **écrites à la main, une par une, avec sa justification**. Une version
antérieure les déduisait par expression régulière : elle produisait 90 rattachements faux, dont
« rayon de 15 km » vers un tonnage, « 7 m des limites séparatives » vers la distance à l'habitation,
et « axes à grande circulation » vers n'importe quelle chaussée. Un rattachement faux est pire
qu'une absence : il rend un verdict sur la mauvaise grandeur, avec l'assurance d'une mesure.

**Aucune contrainte classée « vérification manuelle » n'est évaluée automatiquement** (0 sur 96) :
le classeur lui-même les a écartées, et passer outre serait trahir sa propre qualification.

### Effet mesuré sur 301 parcelles réelles

| Filière | Verdicts | Contraintes pesées par parcelle | dont **résolues par une donnée** |
| --- | --- | --- | --- |
| Éolien terrestre | 230 défavorable · 71 à instruire | 76 | **12** |
| Solaire au sol | 301 à instruire | 54 | **8** |
| Agrivoltaïsme | 301 à instruire | 48 | **7** |
| BESS | 301 à instruire | 41 | **7** |
| Méthanisation | 301 à instruire | 48 | **7** |

Deux choses se lisent dans ce tableau, et la seconde est la plus utile.

**Le verdict discrimine là où la donnée existe.** Avant le raccordement, les 301 parcelles
ressortaient « à instruire » dans les cinq filières, sans une seule infraction relevée. En éolien,
230 sont désormais écartées : ce sont exactement celles qui se trouvent à moins de 500 m d'une
habitation, et les 71 restantes sont exactement celles qui sont au-delà.

**Les quatre autres filières ne discriminent pas encore, et le tableau le dit au lieu de le
masquer.** Leurs contraintes rédhibitoires reposent presque toutes sur le GPU et Géorisques, qui ne
sont pas encore relevés (§5). Une parcelle « à instruire » dans ces filières signifie « rien ne
l'écarte parmi les 7 à 8 contraintes que je sais mesurer », et non « rien ne l'écarte ».

---

## 4. Traçabilité

Chaque contrainte évaluée porte, dans la fiche comme dans le dossier PDF :

- **le texte du seuil du classeur**, recopié (`seuilReglementaire`) ;
- **la référence réglementaire** (`referenceReglementaire`) ;
- **la couche SIG attendue** (`coucheSig`) — y compris quand elle n'est pas interrogée : c'est
  alors la source que l'opérateur doit aller consulter ;
- **la condition effectivement appliquée** (`condition`), et son origine (`origineSeuil`) ;
- en mode 2, **la condition réglementaire remplacée** et **le motif du développeur** ;
- **la valeur mesurée et le chemin du relevé d'où elle vient** (`cheminMesure`), pour que la mesure
  soit re-vérifiable ;
- **ce qui empêche le seuil de trancher seul** (`raisons`), quand c'est le cas.

Le dossier téléchargeable comporte une section **« À vérifier manuellement »** qui nomme chaque
contrainte non tranchée, son niveau, son seuil au référentiel et la source à consulter. C'est la
contrepartie du §3 : un dossier qui tairait ce qu'il n'a pas regardé serait plus dangereux qu'un
dossier vide.

---

## 5. Ce qui n'est pas automatisable, et pourquoi

### 5.1 Les 96 contraintes que le classeur lui-même classe en vérification manuelle

Elles ne sont pas un manque de l'application. Le classeur les a qualifiées ainsi parce qu'aucune
couche nationale homogène ne permet de trancher : servitudes d'utilité publique « selon nature »,
règlements de PLU (« interdit si le règlement l'exclut »), zones humides — que le classeur renvoie
lui-même en vérification —, classements communaux au titre de la loi montagne. Elles sont
affichées, avec leur seuil et leur source, et jamais comptées comme respectées.

### 5.2 Les 123 contraintes `auto_sig` pas encore raccordées

Celles-ci sont un **travail d'ingestion restant**, pas une impossibilité. Le gisement, par couche :

| Couche SIG | Contraintes en attente |
| --- | --- |
| GPU (Géoportail de l'urbanisme) | 20 |
| Géorisques | 16 |
| INPN | 7 |
| INPN / DREAL | 5 |
| Caparéseau | 5 |
| IGN BD TOPO | 4 |
| INPN / Fédération PNR | 4 |
| Communes loi Littoral | 3 |
| RPG | 3 |
| Conservatoire du littoral, UNESCO, périmètres SCoT, zones de montagne, ANFR Cartoradio, RTE Open Data, autres | 56 |

Chacune demande un connecteur, des champs de relevé nouveaux, une migration de schéma et une
requalification des parcelles déjà relevées. **Aucune ne s'obtient en écrivant une correspondance
de plus** : le raccordement de 42 à 73 correspondances s'est fait sans ingérer une seule couche
nouvelle, parce que 47 des 64 grandeurs déjà relevées ne servaient à aucun verdict. Ce gisement-là
est épuisé.

### 5.3 Les refus explicites

Quelques champs du relevé **existent** et ne sont délibérément pas raccordés, chacun pour une
raison mesurée :

- **cavités souterraines** — le relevé donne une proximité, le classeur demande un aléa ; ce ne
  sont pas la même grandeur ;
- **EBC** — les prescriptions du GPU, dont les espaces boisés classés relèvent, ne sont renseignées
  que sur **5 des 301 parcelles** relevées. Un verdict rendu sur 1,7 % de couverture tromperait sur
  les 98,3 % restants, et il tromperait dans le sens rassurant ;
- **PPRI au niveau communal** — `risques.ppri.present` vaut pour la commune, `severitePlan` pour la
  parcelle. Rattacher le premier rendrait toute parcelle d'une commune sous PPRI rédhibitoire ;
  c'est pour ce cas qu'un état à trois valeurs existe (absent / présent mais non qualifié / mesuré).

---

## 6. Non-régression des deux modes existants

Les deux outils antérieurs — la recherche classique sur la carte et le score pondéré — sont
inchangés. Le verdict s'ajoute, il ne remplace rien : aucun poids, aucun knock-out, aucun palier de
note n'a été modifié. Les suites de `@enr/scoring` et de `@enr/core` qui les couvrent passent à
l'identique.

Le mode 2 filtre **en SQL**, jamais après pagination : un filtre appliqué après la troncature
rendrait des pages incomplètes et un décompte faux. Les seuils qu'il ne sait pas traduire en
condition SQL sont retournés dans `ignores` et **affichés à l'opérateur**, plutôt que d'être
silencieusement omis — un filtre que l'on croit actif et qui ne l'est pas est pire qu'un filtre
refusé.

---

## 7. Robustesse et données personnelles

- **Une source indisponible ne vaut jamais « pas de contrainte ».** Elle produit un état
  `donnee_absente` visible, et la couverture du relevé est affichée.
- **Aucun fondement juridique n'est inventé** dans les courriers générés : le dépôt ne tient
  aucune source sûre sur la procédure d'obtention de l'identité d'un propriétaire, le courrier
  laisse donc un espace nommé plutôt qu'une référence non vérifiée (§8).
- **Données de propriétaires** : saisie libre et persistée, selon l'arbitrage retenu. Elles
  n'entrent dans aucune tuile cartographique ni dans aucun export non demandé, la préparation d'un
  courrier nominatif est journalisée, et le poste de l'opérateur ne conserve que le bloc de
  signature de l'expéditeur — liste close, filtrée à l'écriture comme à la lecture.

---

## 8. Vérification exécutée

| Contrôle | Résultat |
| --- | --- |
| `tsc --noEmit` (4 espaces de travail + tests + Netlify) | propre |
| `npm run build` | propre |
| `@enr/core` | 114 tests |
| `@enr/scoring` | 128 tests |
| `@enr/api` (sans base) | 604 tests |
| `@enr/web` | 207 tests |
| `@enr/api` sur base **vierge** (`enr_base24`) | 149 tests |
| `@enr/api` sur base **de référence** (`enr_e2e`, 34 875 communes, 301 parcelles) | 149 tests |
| Campagne de mutation | **277 motifs**, tous applicables au code courant |

**Ces nombres-ci sont ceux de l'exécution du 19 septembre 2026, et ils ne sont pas verrouillés** :
un test de plus les périme, et c'est normal. Ce qui est verrouillé, ce sont les tableaux des §1 et
§3 — la couverture du référentiel — que `packages/scoring/test/couverture-referentiel.test.ts`
recompte et compare à ce document. C'est là que la dérive serait trompeuse, pas sur un compteur de
tests.

Les deux exécutions sur base — l'une vierge, l'autre peuplée — ne sont pas une redondance : un test
qui s'appuie sur des données préexistantes passe sur la seconde et échoue sur la première, et c'est
la première que la CI construit. Ce cas s'est produit et a été corrigé en semant les parcelles dont
le test a besoin.

La **campagne de mutation** est le seul contrôle qui mesure les tests eux-mêmes : chaque motif
introduit un défaut réel dans le code et exige qu'un test le rattrape. Elle a débusqué, entre
autres, un test qui n'assertait qu'un en-tête de colonne sans regarder la cellule, un garde
d'accessibilité qui mesurait le corps des gestionnaires d'événements au lieu des libellés de
boutons, et une règle couvrant les monuments historiques des cinq filières qu'aucun test ne
protégeait.

---

## 9. Ce qui reste à faire

1. **Ingérer le GPU et Géorisques** (36 contraintes à elles deux) : c'est le seul chantier qui
   ferait discriminer les quatre filières aujourd'hui non discriminantes.
2. **Agrivoltaïsme comme filière applicative à part entière** : elle existe dans le référentiel et
   dans les profils de recherche, mais pas encore dans les pondérations, les knock-outs et le
   sélecteur de l'interface.
3. **Relecture juridique du classeur** par un humain compétent. L'application en est un fidèle
   rapporteur ; elle n'en est pas la garantie.
