# Cinquième audit complet — 4 août 2026

Audit mené après les corrections du quatrième audit (B1–B6, C1–C6, priorités 1 à 4) et la pose
des bornes de vraisemblance.

**Méthode, identique à celle du quatrième audit, qui l'avait rendue nécessaire.** PostgreSQL 16 /
PostGIS 3.4 démarré, douze migrations appliquées puis rejouées, serveur lancé en
`NODE_ENV=production`, administrateur créé, **114 parcelles réelles qualifiées** en interrogeant
les sources publiques, puis lecture des résultats : requêtes SQL, réponses HTTP, WFS interrogé
directement, contenu binaire du DBF, texte du rapport PDF extrait par `pdftotext`.

Cette fois, la méthode a servi deux fois : elle a **confirmé** les corrections précédentes sur
données réelles, et elle a **trouvé** le défaut critique de cet audit — une troncature silencieuse
que ni la lecture du code ni les tests n'auraient révélée, parce qu'elle ne se manifeste qu'en
interrogeant un vrai service sur une vraie agglomération.

---

## A. Ce qui fonctionne bien

**La correction de la pente est vérifiée sur données réelles, et elle tient.** 114 parcelles
qualifiées, **zéro pente au-delà de 100 %** — le quatrième audit en trouvait 7 sur 49, jusqu'à
1 665,9 %. Les pentes s'étalent de 0,1 à 2,6 %, plausible en Beauce. **19 parcelles sur 114
(17 %)** ont basculé sur la mesure par paires, proportion cohérente avec les 14 % d'aberrantes
constatées avant correction : le repli s'applique exactement à la population concernée, et pas
au-delà.

**L'effet sur le score est visible dans le rapport.** Sur la parcelle 28382000YE0013, qui
affichait « Pente 205,1 % (max 1,2 %) » et une note de 0/100, le PDF réel donne maintenant
« Pente 1,2 % (estimation majorante) » notée **99/100**, avec l'explication du repli en
commentaire.

**Les bornes de vraisemblance sont en place et n'ont rien déclenché.** 63 bornes, appliquées au
point unique de sortie du pipeline d'enrichissement. Sur 114 parcelles réelles : **zéro anomalie**.
C'est le bon résultat — le filet ne sert pas de béquille au calcul. Les tests, eux, vérifient
qu'il attrape sept confusions d'unité classiques et qu'il laisse passer quatorze extrêmes réels
du territoire (coteau à 85 %, alpage à 2 800 m, delta du Rhône à -2 m, La Réunion à
2 100 kWh/m²/an).

**La réserve sur le modèle d'érosion se déclenche avec les vrais chiffres.** Le PDF réel porte
« ATTENTION : la déduction atteint 54 % de la surface cadastrale. Le modèle […] quitte ce régime
sous environ 1 ha ». Elle est apparue sur les deux parcelles sous 0,5 ha examinées.

**La validation des requêtes est effective.** Neuf entrées invalides mesurées contre le serveur en
production, neuf **HTTP 400** avec un motif exploitable : « Champ `limite` : valeur maximale 1000.
Reçu : number 100000. », « Champ(s) inconnu(s) : surfaceMinHA. Un filtre mal orthographié serait
ignoré en silence et élargirait le résultat sans le dire. » Les quatre entrées qui produisaient un
500 au quatrième audit sont toutes traitées.

**La file de qualification survit à un redémarrage**, mesuré : trois demandes en attente avant
l'arrêt, la deuxième démarre seule au redémarrage, la troisième reste en position 1. Le quatrième
audit mesurait zéro survivante.

**`/api/sante` ne ment plus.** Sous `AUTH_DESACTIVEE` en production, il répond `hors_service` et
liste la configuration fatale, là où il répondait `ok` sur une instance incapable de servir la
moindre route protégée.

**Une campagne interrompue est visible.** L'état expose `derniereCampagne`, et l'interface avertit
au chargement comme en fin de campagne. Un lot partiel ne ressemble plus à un lot complet.

**Le référentiel métier est enfin testé** — 46 tests, ratio passé de 0,00 à 0,36. Ils ont trouvé
sept cibles d'avertissement mortes, une règle `instable` sans motif et une abstraction jamais
adoptée. L'unicité des identifiants de règles est désormais **structurelle** : chaque règle porte
le préfixe de sa filière, ce qu'un test vérifie, de sorte que le recul éolien de 500 m ne peut
plus être écrasé par les 200 m de la méthanisation.

**Le schéma du DBF est stable.** Les largeurs sont déclarées depuis le domaine
(`COMMUNE: 40`, `REGIME: 22`, `SECTION: 2`) et non plus déduites du lot exporté : deux exports
sont désormais fusionnables sans troncature. Le DBF réel porte `NB_KO_BLOQ` et `ECARTEE`, et le
`LISEZ-MOI` explique la différence.

**Le modèle de rôles et l'isolement RGPD tiennent**, revérifiés : trois lectures passent, trois
écritures et quatre routes d'administration en 403, données de propriétaires en 403 `non_habilite`
malgré un motif valide. `proprietaire_parcelle` n'est lue qu'à deux endroits sur 12 977 lignes
d'API.

**Performance des tuiles, mesurée sur données réelles** : 115 ms au zoom 12 (33 ko), 29 ms au
zoom 14, 17 ms au zoom 16.

**Zéro erreur serveur** (`level: 50`) sur toute la durée de l'audit, incluant 114 qualifications
et une centaine de requêtes.

**Hygiène.** 0 `as any`, 0 `@ts-ignore`, 0 `catch` vide, 0 `TODO`, 6 `eslint-disable` justifiés.
24 477 lignes de source, 3 789 lignes de test, 5 349 lignes de documentation, 12 migrations
idempotentes vérifiées.

---

## B. Problèmes critiques

### B1. Le connecteur WFS tronque silencieusement, et cela peut annuler un knock-out légal

**C'est le défaut le plus grave de cet audit, et il ne pouvait être trouvé qu'en interrogeant le
service réel.**

`apps/api/src/connecteurs/wfs.ts` interroge la Géoplateforme avec un paramètre `COUNT` plafonné,
puis traite la réponse comme complète. Le WFS, lui, renvoie **`numberMatched`** — le nombre total
d'objets correspondant à la requête. Ce champ n'est jamais lu.

Mesuré directement contre le service, sur une emprise urbaine (Orléans, environ 5,5 × 4,4 km) :

| Emprise | `COUNT` demandé | Objets rendus | `numberMatched` | Perte |
|---|---|---|---|---|
| Centre-bourg rural (3 × 3 km) | 3 000 | 187 | 187 | aucune |
| **Agglomération** | **3 000** | **3 000** | **25 180** | **88 %** |
| Agglomération, plafond porté à 5 000 | 5 000 | 5 000 | 25 180 | 80 % |

**La conséquence métier.** `distancesBati` calcule `distanceHabitationM` comme la distance minimale
entre la parcelle et l'ensemble des habitations retournées. Sur un sous-ensemble arbitraire de
12 %, **l'habitation la plus proche peut être absente** — et la distance ressort alors **trop
grande**.

C'est la direction dangereuse. `ko_eol_habitation_500` écarte une parcelle lorsque le recul de
500 m de l'article L.515-44 du code de l'environnement ne peut pas être atteint. Une distance
surestimée fait **échouer le knock-out** : une parcelle que la loi exclut apparaît instruisable.
`nbHabitationsRayon500m` est sous-estimé pour la même raison.

En milieu rural le défaut ne se manifeste pas (187 objets sur 3 000 possibles). Il se manifeste en
périurbain et en urbain — **précisément là où le recul de 500 m est déterminant**.

**Ce qui rend le constat plus lourd.** Le connecteur cadastre, dans le même répertoire, lit
`numberMatched` et pagine (`cadastre.ts:134`). Le savoir-faire est présent à côté et n'a pas été
appliqué aux **cinq** appels WFS : bâti (3 000), tronçons de route (2 000), cours d'eau (1 000),
forêt (500), RPG (200). Les deux derniers portent sur l'emprise de la seule parcelle et sont sans
risque réel ; les trois premiers portent sur une emprise élargie.

### B2. Les connecteurs restent presque entièrement non testés, et c'est là que sont les défauts

| Connecteur | Lignes | Fichiers de test le mentionnant |
|---|---|---|
| `wfs.ts` | 312 | **0** |
| `cadastre.ts` | 271 | **0** |
| `gisement.ts` | 208 | **0** |
| `georisques.ts` | 194 | **0** |
| `gpu.ts` | 188 | **0** |
| `servitudes.ts` | 146 | **0** |
| `zonages.ts` | 120 | **0** |

Soit **1 439 lignes de transformation de données sans aucun test**, sur les onze connecteurs qui
alimentent la totalité du snapshot.

Le schéma des cinq audits se reproduit à l'identique, et il est maintenant localisé sans
ambiguïté : le moteur de scoring est testé (ratio 0,28), le référentiel l'est (0,36), les exports
et la validation le sont, l'interface a ses décisions d'affichage couvertes. **Le défaut critique
de cet audit vit dans le seul gros bloc qui ne l'est pas.**

Ratios par zone : `packages/core` 0,36 — `packages/scoring` 0,28 — `apps/api` 0,15 —
`apps/web` 0,03.

---

## C. Problèmes importants

### C1. Ma correction de la pente fait perdre un critère sans nécessité

`topo_orientation` (`criteres-eval.ts`) est structuré ainsi :

```ts
const o = s.topographie.orientationDeg;
const pente = s.topographie.pentePct;
if (o == null) return indispo(SRC.alti);          // <- sortie avant le raccourci
if (pente != null && pente < 3) { /* note 95 : terrain plat, orientation sans incidence */ }
```

Quand la régression est écartée, l'orientation devient `null` — à raison, elle vient du même
calcul. Le critère passe donc au gris. Mais **le code sait déjà que l'orientation est sans objet
sur un terrain plat**, et toutes les parcelles concernées le sont : pentes de 0,1 à 2,6 %.

Mesuré : **19 parcelles sur 114 (17 %)** perdent `topo_orientation` pour cette seule raison, ce qui
abaisse leur couverture de données et donc leur possibilité d'être déclarées propices. Le
raccourci « terrain plat » est inatteignable dans exactement le cas où il s'appliquerait.

Le défaut est structurel et préexistant ; ma correction de la pente l'a rendu conséquent.

### C2. Le séparateur décimal reste faux dans la même page que celle que j'ai corrigée

Le quatrième audit relevait « 0.14 ha » à sept lignes de « 0,14 ha ». C'est corrigé. Mais le PDF
réel, dans le tableau détaillé des critères, affiche la colonne des poids en **`10.7 %`, `6.9 %`,
`6.1 %`, `0.8 %`** — avec un point.

`exports.ts:632` : `` `${(c.poids * 100).toFixed(1)} %` ``. Le même défaut, dans le même document,
sur une colonne que je n'avais pas regardée. C'est la troisième fois qu'une correction locale
laisse subsister la même faute ailleurs (libellé de score dans le Shapefile, cibles
d'avertissement, séparateur décimal).

### C3. `densiteBati1km` ne mesure pas ce que son nom annonce

Le champ est documenté « densité de bâtiments dans un rayon de 1 km ». Le calcul divise
`fc.features.length` par la surface de la bbox d'analyse — la parcelle élargie de 1 500 m, soit
environ 11 km², non un rayon de 1 km (3,14 km²). Il compte de plus **tous** les bâtiments et non
les seules habitations.

S'y ajoute la troncature de B1 : au-delà de 3 000 objets la valeur **sature** autour de 270 et ne
peut plus croître. En zone dense, l'indicateur d'urbanisation est donc plafonné là où il devrait
être maximal.

### C4. L'interface reste à un ratio de test de 0,03

6 136 lignes, 195 lignes de test. Ce qui est couvert l'est bien — les décisions d'affichage
extraites dans `utils/affichage`, avec deux gardes qui lisent le source des composants pour vérifier
qu'ils passent par elles. Mais tout le reste — la carte, ses 1 200 lignes d'expressions MapLibre,
les panneaux, le magasin d'état — n'a aucune couverture.

Le troisième audit avait produit trois de ses quatre défauts critiques dans l'interface. Le
mécanisme de protection posé depuis est bon et ciblé ; il est étroit.

### C5. Une installation fraîche produit une carte entièrement grise, et l'explication est enfouie

Les 114 parcelles qualifiées ressortent **toutes en gris**, couverture de 0,63 à 0,79. La cause est
unique : la table `poste_source` est vide, donc les trois critères de raccordement — 17 % du poids
en solaire — sont gris, et la couverture tombe sous le seuil.

Le diagnostic **existe** : la fiche liste `connecteursEnEchec: ['patrimoine_culture',
'postes_sources']`, la limite de viabilité dit « Seuls 71 % du poids des critères ont pu être
évalués (8 critère(s) sans donnée) », et `/api/sante` expose l'avancement de l'amorçage. Mais
l'utilisateur doit **ouvrir une fiche** pour l'apprendre. Devant une carte grise, la première
hypothèse est que l'application est cassée, pas qu'une couche nationale manque.

---

## D. Problèmes secondaires

- **Trois amorces de test subsistent sans emploi** : `viderCacheHttp`, `oublierCouchesIntrantes`,
  et `avertissementsPourCible` a été retirée. `nbSeaux` est désormais testée. Le nombre d'exports
  morts est passé de 9 à 3.
- **Les courbes définies à l'intérieur d'un évaluateur** (Natura 2000, argiles, karst) restent hors
  de `EMPREINTE_REFERENTIEL` : les modifier n'invalide pas les scores sans incrémentation manuelle
  de la version. Documenté dans `CALIBRATION.md`, non corrigé.
- **Le champ du jeton s'appelle `token`**, seul anglicisme d'une API intégralement française.
- **Une parcelle grise affiche un score chiffré** (63,7 sur 100 avec le libellé « Données
  manquantes »). Les deux informations sont présentes ; le chiffre attire l'œil.
- **La borne d'altitude ne rattrape pas une confusion pieds/mètres** : 423 m est une altitude
  plausible en France. C'est dit explicitement dans le test plutôt que passé sous silence, mais la
  limite reste.
- **`penteMaxPct` retombe sur `pentePct`** quand aucune paire n'est distante de plus de 10 m : sur
  une très petite parcelle, la valeur de contrôle devient la valeur contrôlée.

---

## E. Erreurs métier

**E1. Une parcelle que la loi exclut peut apparaître instruisable** (B1). En périurbain, la
troncature du WFS surestime la distance à l'habitation et le knock-out du recul de 500 m de
l'article L.515-44 ne se déclenche pas. C'est la seule erreur métier de cet audit dont la direction
soit dangereuse, et elle porte sur une exclusion légale.

**E2. Un secteur périurbain paraît moins urbanisé qu'il ne l'est** (C3). L'indicateur de densité
sature, ce qui rend un fond de vallée bâti indiscernable d'une plaine agricole.

**E3. Une parcelle plate perd son critère d'orientation** (C1). 17 % des parcelles voient leur
couverture abaissée sans raison de fond, ce qui réduit leur chance d'atteindre le statut propice.

**E4. Un rapport transmis mélange les séparateurs décimaux** (C2). Sur une pièce française, la
colonne des poids en « 10.7 % » se remarque.

**E5. La surface implantable d'une parcelle sous 1 ha reste un ordre de grandeur pessimiste**, mais
elle le dit maintenant explicitement dans la fiche et dans le PDF.

**E6. Les indicateurs dérivés restent des proxies**, tous étiquetés, tous documentés réserve par
réserve dans `CALIBRATION.md`.

**E7. La méthanisation ne peut produire aucun « go »** tant que les couches d'intrants ne sont pas
ingérées. Comportement voulu et explicite.

---

## F. Risques

| Risque | Origine | Probabilité / gravité |
|---|---|---|
| **Démarcher une parcelle exclue par la loi** | troncature WFS (B1) | moyenne en périurbain, **gravité maximale** — c'est une exclusion légale manquée |
| **Régression silencieuse dans un connecteur** | 1 439 lignes non testées (B2) | **élevée** — cinq audits, le défaut critique s'y trouve à chaque fois |
| **Sous-estimer l'urbanisation d'un secteur** | densité saturée (C3) | moyenne, sans gravité juridique |
| **Écarter une parcelle propice** | orientation perdue (C1) | **certaine sur 17 % des parcelles**, gravité faible (perte d'opportunité) |
| **Se faire remarquer sur un livrable** | séparateur décimal (C2) | élevée à la lecture, gravité faible |
| **Conclure à une panne devant une carte grise** | amorçage incomplet (C5) | élevée à la première installation, aucune perte de données |
| **Comparer deux générations de scores** | courbes internes hors empreinte (D) | faible, et documentée |
| **Perdre le pipeline commercial** | procédure de sauvegarde documentée ET testée | faible probabilité, gravité maximale — mais le risque est traité |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | Troncature WFS non détectée (B1) | un knock-out légal peut ne pas se déclencher | **faible** — lire `numberMatched`, paginer ou marquer la valeur non fiable | **1** |
| 2 | Raccourci « terrain plat » inatteignable (C1) | 17 % des parcelles perdent un critère | **très faible** — deux lignes à permuter | **1** |
| 3 | Séparateur décimal du tableau des poids (C2) | soin du livrable | **très faible** | **1** |
| 4 | Connecteurs non testés (B2) | mode de défaillance dominant du projet | moyenne à élevée | 2 |
| 5 | `densiteBati1km` ne mesure pas son nom (C3) | indicateur trompeur en zone dense | faible | 2 |
| 6 | Carte grise sans explication visible (C5) | première impression d'une panne | faible — un bandeau lisant `/api/sante` | 2 |
| 7 | Interface à 0,03 de couverture (C4) | régressions d'affichage | élevée | 3 |
| 8 | Courbes internes hors empreinte (D) | scores incomparables en silence | faible | 3 |
| 9 | Calibration absolue non établie | classement fin non défendable | dépend de devis réels | 4 |

---

## Note globale : 74 / 100

| Critère | Note | Δ | Justification |
|---|---|---|---|
| Fiabilité des résultats | **68** | +14 | la pente est juste sur 114 parcelles réelles là où 14 % étaient fausses de trois ordres de grandeur ; 63 bornes de vraisemblance protègent désormais des dérives à venir ; mais la troncature WFS peut annuler un knock-out légal en périurbain |
| Qualité technique | **74** | +6 | corps de requête validé en liste blanche, référentiel testé, code mort adopté ou retiré, CI avec service PostGIS ; mais 1 439 lignes de connecteurs sans test et `numberMatched` ignoré sur cinq appels |
| Qualité métier | **76** | +6 | pente correcte, réserve du modèle d'érosion, cibles d'avertissement toutes résolues, unicité des règles rendue structurelle ; la troncature reste une erreur métier |
| Ergonomie | **72** | +10 | 400 explicites au lieu de 500, campagne interrompue visible, file visible, lien d'évitement, séparateur décimal presque partout ; carte grise mal expliquée et colonne des poids encore fautive |
| Robustesse | **78** | +12 | file durable vérifiée par redémarrage, sonde de santé honnête, purge RGPD branchée et testée, bornes de vraisemblance, sauvegarde documentée et testée par exécution, zéro erreur serveur sur tout l'audit |
| Professionnalisation | **78** | +8 | 5 349 lignes de documentation qui expliquent le pourquoi, CI à deux jobs, 240 tests, et une erreur de mon quatrième audit corrigée explicitement dans le code et dans le test plutôt que laissée en place |

**Sur la progression, 65 → 74.** Elle est réelle et vérifiée sur données réelles, pas déduite du
diff. Le chiffre principal de l'application était faux sur une parcelle sur sept ; il est juste sur
114 sur 114. Ce qui reste de plus grave est **plus étroit** que ce qui a été corrigé : la troncature
WFS ne mord qu'en périurbain, là où la pente aberrante frappait partout.

**Ce qui empêche d'aller plus haut** n'est pas une liste de petits défauts, c'est un déséquilibre :
les connecteurs représentent le tiers du code applicatif et n'ont aucun test. Tant qu'il en sera
ainsi, chaque audit y trouvera son défaut critique — c'est arrivé cinq fois.

---

## Conclusion

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un cadre
> professionnel sans risque majeur d'erreur ?**

**Oui pour la prospection rurale, avec une réserve précise en périurbain. Non encore comme pièce
opposable.**

C'est le premier des cinq audits qui ne répond pas « non » tout court, et la raison est
vérifiable : le calcul qui gouverne le classement est juste sur 114 parcelles réelles, les réserves
s'affichent là où elles doivent, les erreurs de saisie sont refusées avec leur motif, une campagne
interrompue se voit, et un garde-fou protège désormais des dérives que personne n'a imaginées.

**Par usage, en l'état :**

- **Solaire, éolien, stockage en milieu rural : oui**, comme outil de tri et de dégrossissage. Le
  score est juste, ses réserves sont explicites, et les parcelles écartées par le droit sont
  distinguées des parcelles mal notées dans la liste, le CSV, le GeoJSON et le Shapefile.
- **En périurbain et en zone bâtie dense : à ne pas utiliser pour l'éolien** avant la correction
  n° 1. La distance à l'habitation peut être surestimée, et c'est elle qui fonde le recul de 500 m.
  Les autres filières sont moins exposées — le recul de 200 m de la méthanisation subit le même
  biais, le solaire et le stockage n'ont pas de knock-out de recul à l'habitation.
- **Méthanisation : pour hiérarchiser, oui ; pour décider, non.** Inchangé.
- **À l'échelle du site : oui pour des parcelles jointives**, la contiguïté étant mesurée et la
  dispersion signalée. Sous 1 ha par parcelle, la surface implantable est un ordre de grandeur
  pessimiste, et le dit.
- **Comme pièce transmise à un tiers : presque.** Il reste la colonne des poids en séparateur
  anglais (C2), qui est cosmétique mais visible. Le fond — fondements légaux datés, traçabilité des
  sources, réserves explicites, distinction de l'exclusion juridique — est au niveau attendu.
- **En exploitation multi-utilisateurs : oui.** File durable, rôles étanches, journalisation RGPD,
  limitation de débit, sauvegarde documentée et testée.

### Corrections indispensables avant utilisation en périurbain

Les trois premières lignes du tableau G, difficulté faible à très faible :

1. **Lire `numberMatched` dans le connecteur WFS.** Trois options selon le cas : paginer comme le
   fait déjà le connecteur cadastre, réduire l'emprise, ou marquer la valeur comme non fiable et la
   ramener à `null` — ce qui grise le critère plutôt que de l'affirmer faux. La troisième est la
   plus rapide et la plus honnête.
2. **Permuter deux lignes dans `topo_orientation`** pour que le raccourci « terrain plat »
   s'applique avant le test de nullité.
3. **Passer la colonne des poids du PDF par `formatNombre`.**

### Le point de méthode, à nouveau, et il n'a pas changé de nature

**Tester les connecteurs.** Le quatrième audit concluait qu'il fallait faire tourner le logiciel
sur des données réelles et regarder les nombres ; c'est fait, et cela a payé deux fois — la
confirmation des corrections et la découverte de B1.

Le constat suivant est plus précis. Sur cinq audits, le défaut critique s'est trouvé cinq fois dans
la zone la moins couverte au moment de l'audit : le moteur (audits 1-2), l'interface et les exports
(audit 3), un calcul géométrique de l'API (audit 4), un connecteur (audit 5). À chaque fois la zone
a été couverte ensuite, et le défaut suivant est apparu dans la zone d'après. **Les connecteurs
sont maintenant la dernière grande zone sans test, et le seul moyen de sortir de cette boucle est
de la couvrir avant qu'un sixième audit ne le démontre une nouvelle fois.**

Ce qu'il faut y tester n'est pas l'appel réseau — il n'y a rien à en dire — mais la
**transformation** : un jeu de réponses réelles enregistrées, passé aux fonctions de mapping, et
les champs du snapshot vérifiés un à un. Une réponse WFS tronquée fait partie de ce jeu.
