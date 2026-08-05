# Sixième audit complet — 5 août 2026

Audit conduit simultanément sous six angles : développeur senior, architecte logiciel, chef de
produit, expert UX/UI, expert QA, expert métier ENR. Neuf domaines vérifiés : moteur de scoring,
connecteurs de données externes, cohérence métier et conformité réglementaire, base de données et
migrations, API (validation, sécurité, RGPD), interface, exports et livrables, robustesse
d'exploitation, qualité technique et documentation.

**Méthode.** Comme aux audits précédents, aucune affirmation de ce rapport n'est tirée d'une simple
lecture du code : chaque constat est établi par exécution, mesure sur données réelles, ou
vérification par mutation. Les API officielles ont été interrogées directement pour comparer ce que
le code déclare lire à ce qu'elles renvoient réellement.

**Point de départ.** L'audit 5 concluait ainsi : « les connecteurs sont maintenant la dernière
grande zone sans test, et le seul moyen de sortir de cette boucle est de la couvrir avant qu'un
sixième audit ne le démontre une nouvelle fois. » Cet audit le démontre une nouvelle fois. Les cinq
défauts les plus sérieux ci-dessous sont tous dans la couche de transformation des connecteurs.

**Inventaire mesuré.** 24 726 lignes de source (2 127 core, 3 241 scoring, 13 222 API, 6 136
interface), 4 171 lignes de test, 5 927 lignes de documentation, 12 migrations, 30 commits.

> Rectification d'une mesure de ce rapport. Mon premier inventaire annonçait 19 698 lignes de
> source : il comptait les `.ts` et ignorait les `.tsx`, donc l'intégralité des composants React.
> Le ratio de test de l'interface que j'en tirais (0,18) était faux pour la même raison. La valeur
> réelle est **0,03**, identique à celle de l'audit 5 — qui avait donc raison.

---

## A. Ce qui fonctionne bien

**La correction de la troncature WFS tient sur données réelles.** Vérifié en fin d'audit par
enrichissement complet de parcelles réelles : distance à l'habitation 0 m et 1 m sur deux parcelles
mitoyennes de Tillay-le-Péneux, 28 habitations dans les 500 m, densité 18 bâtiments/km². Aucune
grandeur aberrante, aucune borne de vraisemblance violée, aucune erreur serveur.

**Le prédicat de troncature est isolé et testé.** `reponseTronquee` et `distanceDemontree` sont des
fonctions pures, vérifiables sans réseau, et leur suppression fait échouer les tests (vérifié par
mutation). C'est le bon modèle : la règle de décision est séparée de l'appel réseau.

**Le mappage de `gpu/zone-urba` et de `gpu/assiette-sup-s` est exact.** Les huit propriétés
déclarées pour le zonage et les deux pour les servitudes existent bien dans les réponses réelles.
Le défaut décrit en C1 n'est donc pas un travers général du projet mais deux erreurs localisées.

**Le connecteur Géorisques `/rga` traite correctement le piège documenté.** Vérifié sur quatre
points : `{"codeExposition":"3","exposition":"Exposition forte"}` en zone argileuse, corps vide en
HTTP 200 hors zone, correctement interprété comme aléa nul et non comme une panne.

**La reprise d'une base privée de sa table de suivi fonctionne.** Vérifié de bout en bout :
4 migrations suivies après l'échec → adoption des 8 manquantes → 12 suivies → passage suivant à
zéro. Et le refus sur base vierge est effectif, sans écriture parasite.

**Les invariants de sécurité tiennent.** `AUTH_DESACTIVEE` renvoie un 500 `configuration_invalide`
sur les routes protégées quand `NODE_ENV=production`. Le secret de signature n'est jamais la valeur
d'exemple en production : il est repris de l'environnement, sinon persisté en base, sinon volatil
avec avertissement explicite. Les tuiles parcellaires — celles qui portent `statut_prospection`,
donc le pipeline commercial — exigent un jeton, contrairement aux tuiles communales et de
contraintes. Le relais de calques s'appuie sur un catalogue fermé (`CALQUES_PAR_ID`).

**Le moteur de scoring reste sain.** 270 tests verts, typage strict sur les quatre paquets, aucune
régression. Le grisement à 71 % de couverture fonctionne comme prévu (seuil 80 %).

**Les paliers de score amortissent une partie des défauts de données.** Le plafonnement des
compteurs Géorisques décrit en C3 n'a aucun effet sur la note, parce que les courbes saturent bien
avant 50. Ce n'est pas un hasard heureux : c'est la conséquence d'un choix de calibration prudent.

---

## B. Problèmes critiques

### B1. Un knock-out réglementaire ne peut jamais se déclencher : l'APPB n'est alimenté par rien

`s.milieux.appb.recouvre` est lu par les knock-outs (`knockouts.ts:46`, « arrêté préfectoral de
protection de biotope »), déclaré dans les types, initialisé par `snapshotVide()`, borné dans
`bornes.ts`, et présent au catalogue des couches. **Aucun connecteur ne l'écrit jamais.**

Contrôle systématique : sur les 25 chemins du snapshot lus par les knock-outs, `s.milieux.appb` est
le seul qu'aucun connecteur ne renseigne. Vérifié aussi en exécution — sur les deux parcelles
réellement enrichies, `appb.recouvre = null`.

Un APPB est une protection **absolue** au titre de l'article R.411-15 du code de l'environnement :
il n'est pas dérogeable par une modification du PLU, contrairement à un zonage N. Le knock-out
existe donc à juste titre — mais il ne peut mathématiquement jamais se déclencher, car il exige
`recouvre === true`.

C'est plus grave que l'absence de la vérification : la présence du knock-out dans le moteur laisse
croire que le contrôle est fait. Rien dans la fiche ne signale que cette contrainte n'a pas été
examinée, puisqu'un knock-out ne s'affiche que lorsqu'il se déclenche. Un prospecteur qui connaît
la liste des knock-outs conclura que l'APPB a été écarté.

> Nuance à porter au crédit du projet : la couche APPB n'est pas proposée dans le catalogue
> `CALQUES` (le seul fonctionnel), donc l'utilisateur ne peut pas la consulter et croire qu'elle
> est vide. L'illusion est dans le moteur, pas dans la carte.

### B2. La qualification des habitations exclut un tiers du bâti, et dans le sens dangereux

`estHabitation` (`wfs.ts`) porte ce commentaire : « les bâtiments agricoles, industriels et les
annexes ne sont pas des habitations, **mais un bâtiment de nature indéterminée est traité comme
habitation par prudence** ». La règle correspondante est `usages.every((u) => u === '')` : elle
n'accorde la prudence qu'aux bâtiments dont `usage_1` **et** `usage_2` sont vides.

Mesure sur 5 000 bâtiments réels de BD TOPO (Aveyron) :

| Cas | Part | Traitement actuel |
|---|---|---|
| `usage_1` **et** `usage_2` vides — seul cas où la prudence s'applique | **0,0 %** | habitation |
| `usage_1 = "Indifférencié"` | **33,9 %** | **exclu** |
| `usage_1` résidentiel / habitation | 55,8 % | habitation |
| autre usage explicite (commercial, agricole, annexe…) | 10,3 % | exclu, à juste titre |

La branche de prudence est donc **morte en pratique** : BD TOPO ne laisse jamais les deux usages
vides, elle écrit « Indifférencié ». Et « Indifférencié » est exactement le cas indéterminé que le
commentaire dit vouloir couvrir — un tiers du bâti, écarté du calcul.

Effet mesuré sur la distance à l'habitation la plus proche, en traitant « Indifférencié » comme
indéterminé :

| Lieu | Bâtiments | Retenus aujourd'hui → distance | Retenus par prudence → distance |
|---|---|---|---|
| Tillay-le-Péneux (28) | 167 | 44 → 5 m | 124 → 5 m |
| Village de Beauce (45) | 138 | 29 → **110 m** | 67 → **86 m** |
| Bourg de Sologne (41) | 62 | 17 → 0 m | 57 → 0 m |
| Village d'Aveyron (12) | 5 000 | 3 149 → 0 m | 4 339 → 0 m |

Le sens de l'erreur est celui qui compte : la distance actuelle est **toujours supérieure ou
égale** à la distance prudente, donc toujours plus favorable. C'est la même direction que la
troncature WFS corrigée hier, dans le même critère, pour une cause différente.

L'écart mesuré reste modeste en village (24 m sur un cas sur quatre) parce qu'un village contient
beaucoup de bâtiments explicitement résidentiels à proximité immédiate. **Le cas défavorable est
structurel et c'est précisément le cas éolien** : une parcelle isolée dont le seul bâti proche est
une habitation saisie sans usage. L'application conclut alors « aucune habitation trouvée » ou
annonce une distance très supérieure, et le recul de 500 m de l'article L.515-44 ne se déclenche
pas.

> Autocritique. Mes tests de `estHabitation` écrits hier vérifient que `estHabitation({})` vaut
> `true` — « un bâtiment sans usage ni nature est compté comme habitation par prudence ». Ce test
> passe, et il couvre un cas qui se produit **0,0 %** du temps. J'ai testé l'intention documentée
> au lieu de la distribution réelle des données. C'est le défaut de méthode que cet audit doit
> retenir : un test écrit depuis le commentaire, pas depuis la donnée, valide une fiction.

---

## C. Problèmes importants

### C1. Deux champs de connecteur sont mappés sur des noms que les API n'emploient pas

Contrôle systématique : pour sept points d'entrée, comparaison entre les propriétés déclarées par
les interfaces TypeScript des connecteurs et celles réellement présentes dans les réponses.

| Point d'entrée | Champ déclaré et **lu** | Nom réel | Conséquence |
|---|---|---|---|
| `gpu/document` | `typedoc` | **`du_type`** | `typeDocument` **toujours nul** |
| `nature/natura-habitat` | `nom_site`, `nom` | **`sitename`** | nom du site Natura 2000 **toujours nul** |
| `nature/natura-oiseaux` | `nom_site`, `nom` | **`sitename`** | idem |

Vérifié sur six communes : `du_type` vaut `PLU` ou `PLUi`, exactement les valeurs que la table
`TYPES_DOCUMENT` sait déjà traduire. La donnée est disponible, à un renommage près.

Conséquences visibles sur chaque fiche :

- **« Document d'urbanisme : non renseigné »**, systématiquement. Or la distinction porte : un POS
  est caduc depuis la loi ALUR, une carte communale n'a pas de règlement graphique de même nature
  qu'un PLU, et le régime applicable au photovoltaïque au sol en dépend. Le critère de zonage
  affiche « Zone A » là où il devrait afficher « Zone A (PLUi) ».
- **Aucun nom de site Natura 2000**, jamais. La fiche annonce « Recouvrement Natura 2000 » ou
  « 3,9 km » sans dire de quel site il s'agit. C'est la contrainte environnementale qui décide de
  la nécessité d'une évaluation des incidences : sans le nom du site, le rapport ne permet pas
  d'ouvrir le dossier, et le prospecteur doit refaire la recherche à la main.

Vérifié en exécution sur une parcelle réelle : `natura hab : recouvre=false d=3850 nom=null`, là où
le même appel pour la ZNIEFF renvoie bien un nom.

Cinq autres propriétés sont déclarées dans les interfaces sans exister dans les réponses
(`gpu/document.nomreg` et `.datappro`, `gpu/municipality.partition`, `nature.url_fiche`,
`nature.id_mnhn` pour Natura et `nature.sitecode` pour les ZNIEFF). Celles-là ne sont jamais lues
par le code : elles n'ont aucun effet, mais elles font croire à un contrat vérifié qui ne l'est pas.

### C2. Le nom de zonage naturel affiché n'est pas celui dont la distance est affichée

`zonageDepuis` (`nature.ts`) prend le nom sur `fc.features[0]`, avec ce commentaire : « Le site le
plus proche, pour l'afficher dans la fiche ». Or `features[0]` est le premier élément de l'ordre de
réponse de l'API, sur une emprise de **10 km**, tandis que `distanceM` est le minimum sur
l'ensemble des sites. Les deux valeurs sont ensuite concaténées par le critère comme si elles
décrivaient le même objet : `` `${formatDistance(plusProche.distanceM)} - ${plusProche.nom}` ``.

Mesure sur cinq localisations réelles, couche ZNIEFF de type I (où les noms, eux, se résolvent
correctement) :

| Lieu | ZNIEFF dans 10 km | Distance affichée | Nom affiché | Site réellement le plus proche |
|---|---|---|---|---|
| Camargue (13) | 10 | 0 m | MARAIS DE MEYRANNE ET DES CHANOINES | **SYSTÈME DU VACCARÈS** |
| Brenne (36) | 26 | 0 m | Étangs Purais, Étang de la Touche | **Étangs du Ralé et Perculeux** |
| Sologne (41) | 15 | 1 846 m | ETANG DE MALZONE | **ETANG DES BROSSES** |
| Vercors (26) | 14 | 0 m | Mare du château de Vassieux | **Plateau d'Ambel et Forêt de Lente** |
| Landes (40) | 1 | 1 285 m | ANCIENNES MINES DE LIGNITE D'ARJUZANX | ANCIENNES MINES DE LIGNITE D'ARJUZANX |

**Quatre cas sur cinq.** Le seul cas correct est celui où une seule ZNIEFF existe dans le rayon.
Contrairement à C1, ce n'est pas une donnée manquante mais une **donnée fausse** sur un document
destiné à un tiers : « ZNIEFF I : 1 846 m — ETANG DE MALZONE » désigne un étang qui n'est pas
celui-là. Un écologue relisant le rapport le verra immédiatement, et cela discréditera l'ensemble.

### C3. Géorisques : trois compteurs plafonnés à 50, sans pagination

`formeA` et `formeB` (`georisques.ts`) demandent `page_size: 50` / `pageSize: 50` et renvoient
`rep.data ?? []` / `rep.content ?? []`, sans jamais lire `results`, `total_pages`, `totalElements`
ni `totalPages`. Les longueurs de ces listes servent directement de **compteurs** au snapshot.

Mesures sur l'API réelle :

| Grandeur | Requête | Total annoncé | Renvoyé |
|---|---|---|---|
| `mouvementsTerrain` | Menton (06083) | **148** | 50 |
| `icpeProches` | Paris centre, 2 000 m | **199** | 50 |
| `icpeProches` | Marseille, 2 000 m | **161** | 50 |
| `sitesPollues` | Lyon, 500 m | **214** | 50 |
| `sitesPollues` | Lille, 500 m | **62** | 50 |
| `cavitesProches` | quatre sites karstiques ou miniers | ≤ 2 | complet |

C'est la même classe de défaut que la troncature WFS corrigée hier, dans un autre connecteur —
et cette fois `docs/API_CONTRACTS.md` **documente déjà** les champs de pagination (ligne 478 :
`{"results":37,…,"total_pages":19,…}`) sans que le code les lise. La documentation était en avance
sur le code.

**Ampleur réelle, à ne pas exagérer : l'effet sur la note est nul.** Les courbes de score saturent
au dernier palier bien avant 50 — 8 mouvements de terrain, 12 cavités, 12 sites pollués. Une valeur
de 50 et une valeur de 148 donnent la même note. Ce qui reste faux, c'est la **valeur affichée** :
la fiche écrit « 50 mouvement(s) de terrain » là où il y en a 148, et ce 50 revient à l'identique
sur toutes les communes concernées — un lecteur attentif y verra le plafond qu'il est.

### C4. Deux catalogues de couches coexistent dans l'interface, et se contredisent

L'interface affiche **deux** panneaux : « Couches » (catalogue `COUCHES`, 21 entrées, lues depuis
la base) et « Calques cartographiques » (catalogue `CALQUES`, 16 entrées, avec état, source et
millésime). Seuls trois types de `COUCHES` sont alimentés par une ingestion
(`monument_historique`, `postes_sources`, `reseau_gaz`) : **18 des 21 entrées sont donc grisées**,
avec cette note explicative :

> « N couche(s) grisée(s) : aucune donnée ingérée pour l'instant, **elles ne peuvent donc rien
> afficher sur la carte**. »

Or **7 de ces couches grisées sont pleinement fonctionnelles dans l'autre panneau**, sous le même
nom, en `mode: 'vecteur_api'` : `natura2000_habitats`, `natura2000_oiseaux`, `znieff1`, `znieff2`,
`reserve_naturelle`, `parc_national`, `parc_naturel_regional`.

L'utilisateur voit donc « Natura 2000 — habitats » deux fois : une fois désactivé avec une note
affirmant qu'il ne peut rien afficher, une fois actif et fonctionnel. La note est factuellement
fausse pour ces sept-là. Le catalogue `COUCHES` a été remplacé par `CALQUES` sans être retiré.

### C5. L'interface reste à 0,03 de couverture, et l'ingestion à 0

Ratio lignes de test / lignes de source, mesuré :

| Zone | Source | Test | Ratio |
|---|---|---|---|
| `packages/core` | 2 127 | 763 | 0,36 |
| `packages/scoring` | 3 241 | 980 | 0,30 |
| `apps/api` | 13 222 | 2 233 | 0,17 |
| **`apps/web`** | **6 136** | **195** | **0,03** |
| **Total** | **24 726** | **4 171** | **0,17** |

Inchangé depuis l'audit 5. Les trois plus gros fichiers de l'interface — `Carte.tsx` (1 334
lignes), `FicheParcelle.tsx` (1 189), `PanneauGauche.tsx` (818) — portent l'essentiel de ce que
l'utilisateur voit, et la contradiction de C4 s'y trouve.

Dans l'API, `src/ingestion` (865 lignes) n'est cité par **aucun** fichier de test. C'est le code
qui écrit en base les postes sources, le réseau gaz et 46 000 monuments historiques.

---

## D. Problèmes secondaires

- **`icpeProches` est collecté, tronqué, stocké, et jamais lu.** Aucune lecture dans le scoring, les
  exports ou l'interface — vérifié par recherche exhaustive. Il coûte une requête Géorisques par
  parcelle sur un rayon de 2 000 m (jusqu'à 199 objets annoncés). Même classe que les cibles
  d'avertissement mortes nettoyées à l'audit 4. `reseauxEnterres` n'est lu nulle part non plus.
- **Un échec de `rnn` peut être masqué par `rnc`.** `reserves` fusionne les deux couches sous
  `parChemin['rnn'] || parChemin['rnc']` : si `rnn` échoue et que `rnc` répond à vide, la fusion
  produit une collection vide traitée comme une réponse complète, donc `reserveNaturelle.recouvre =
  false` — une absence affirmée sur une donnée manquante. L'échec est bien enregistré dans
  `echecs`, mais le champ, lui, affirme.
- **`rncf` est documenté comme vérifié et n'est pas interrogé.** L'en-tête de `nature.ts` liste
  `rncf` parmi les chemins vérifiés ; la liste `chemins` en compte huit et ne l'inclut pas. Les
  réserves de chasse et faune sauvage sont donc hors couverture.
- **`partRecouvrement: recouvre ? 1 : 0`** pour les zonages naturels affirme 100 % de recouvrement
  dès qu'il y en a un, là où `gpu.ts` calcule l'intersection exacte en PostGIS. Sans effet
  aujourd'hui — vérifié, aucun critère ni knock-out ne lit ce champ pour les milieux naturels —
  mais c'est une valeur fausse en base, prête à être utilisée de bonne foi.
- **Import dynamique inutile** de `./distances.js` dans `distanceZoneHabitat`, alors que le module
  est déjà importé statiquement en tête de `gpu.ts`.
- **La clé `PLUi` de `TYPES_DOCUMENT` est inatteignable** : la valeur est passée en majuscules avant
  la recherche, donc seule `PLUI` peut correspondre. Sans conséquence, la table contient les deux.
- **Le repli `?? (brut ? 'PLU' : null)`** attribuerait « PLU » à tout type de document inconnu.
  Inatteignable aujourd'hui puisque `brut` est toujours vide (C1), mais le jour où `du_type` sera lu
  correctement, ce repli transformera un `SCOT` ou un `PSMV` en `PLU` en silence.

---

## E. Erreurs métier

| Constat | Nature de l'erreur | Portée |
|---|---|---|
| L'APPB n'est jamais vérifié alors qu'un knock-out l'annonce | protection absolue (R.411-15 CE) non examinée, et rien ne le dit | toutes filières |
| Un tiers du bâti est écarté de la qualification « habitation » | recul de 500 m (L.515-44) sous-évalué, dans le sens favorable | **éolien** au premier chef |
| Le type de document d'urbanisme est toujours « non renseigné » | un POS caduc ne se distingue pas d'un PLU en vigueur | photovoltaïque au sol |
| Le nom du site Natura 2000 n'est jamais donné | l'évaluation des incidences ne peut pas être ouverte depuis le rapport | toutes filières |
| Le nom de ZNIEFF affiché désigne un autre site que la distance affichée | donnée fausse sur un livrable transmis | toutes filières |
| Les compteurs de risques plafonnent à 50 | valeur affichée fausse, note inchangée | toutes filières |
| `rncf` hors couverture | réserves de chasse et faune sauvage non examinées | toutes filières |

---

## F. Risques

| Risque | Cause | Probabilité et gravité |
|---|---|---|
| **Démarcher une parcelle exclue par la loi** | habitations sous-comptées (B2) | faible en village, **réelle sur parcelle isolée** — et c'est le cas éolien ; gravité maximale |
| **Conclure qu'une contrainte absolue est écartée** | APPB jamais vérifié (B1) | **certaine** — le contrôle n'existe pas ; gravité maximale, atténuée par la rareté des APPB |
| **Perdre la confiance d'un tiers technique** | nom de ZNIEFF erroné (C2) | **4 cas sur 5** dès qu'il y a plusieurs sites ; gravité réputationnelle élevée |
| **Refaire à la main une recherche déjà faite** | nom Natura 2000 et type de document nuls (C1) | **certaine, sur chaque fiche** ; gravité faible mais coût récurrent |
| **Régression silencieuse dans un connecteur** | couche de transformation non testée | **élevée — sixième audit, sixième fois** |
| **Erreur d'affichage non détectée** | interface à 0,03 (C5) | élevée ; C4 en est l'illustration |
| **Corruption d'une ingestion non détectée** | 865 lignes sans test | moyenne ; gravité élevée (écrit en base) |
| **Perdre le pipeline commercial** | procédure de sauvegarde documentée, testée, et reprise après perte de la table de suivi | faible ; risque traité |
| **Relais de tuiles utilisé par un tiers** | `/api/carte/fond/` et `/api/carte/polices/` sans authentification | moyenne ; gravité faible — catalogue fermé, limitation de débit, tuiles IGN publiques |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | « Indifférencié » exclu des habitations (B2) | un knock-out légal peut ne pas se déclencher | **très faible** — élargir un prédicat de trois lignes | **1** |
| 2 | APPB jamais alimenté (B1) | contrainte absolue non examinée en silence | faible si l'on retire le knock-out en le disant ; moyenne si l'on ingère la couche INPN | **1** |
| 3 | `du_type` et `sitename` (C1) | deux champs nuls sur chaque fiche | **très faible** — deux renommages | **1** |
| 4 | Nom de zonage naturel non aligné sur la distance (C2) | donnée fausse sur un livrable | **faible** — trier avant de prendre le nom | **1** |
| 5 | Pagination Géorisques (C3) | valeurs affichées fausses | faible — lire `results`, paginer ou marquer non fiable | 2 |
| 6 | Couche de transformation non testée | mode de défaillance dominant, six audits de suite | moyenne — jeu de réponses réelles enregistrées | 2 |
| 7 | Deux catalogues de couches contradictoires (C4) | l'interface se contredit devant l'utilisateur | faible — retirer le catalogue remplacé | 2 |
| 8 | `icpeProches` et `reseauxEnterres` morts (D) | requête inutile par parcelle | très faible | 3 |
| 9 | Échec `rnn` masqué, `rncf` absent (D) | absence affirmée sur donnée manquante | faible | 3 |
| 10 | Interface à 0,03, ingestion à 0 (C5) | régressions d'affichage et d'ingestion | élevée | 3 |
| 11 | Calibration absolue non établie | classement fin non défendable | dépend de devis réels | 4 |

---

## Note globale : 76 / 100

| Critère | Note | Δ | Justification |
|---|---|---|---|
| Fiabilité des résultats | **70** | +2 | la troncature WFS — pire défaut de l'audit 5 — est corrigée et vérifiée sur données réelles ; mais deux défauts nouvellement prouvés rouvrent partiellement la même plaie, dans le même critère et dans la même direction dangereuse : habitations sous-comptées d'un tiers, APPB jamais vérifié |
| Qualité technique | **78** | +4 | prédicat de troncature isolé et testé par mutation, reprise de migrations éprouvée, 270 tests, tests structurels qui attrapent les régressions invisibles ; mais la couche de mappage porte trois noms de champs inexistants et cinq déclarations mortes |
| Qualité métier | **74** | −2 | la note baisse parce que la couverture réglementaire réelle est moins bonne qu'on ne le croyait : APPB non examiné, POS non distingué d'un PLU, Natura 2000 non nommé, ZNIEFF mal nommée. Les défauts préexistaient ; c'est la connaissance qu'on en a qui change |
| Ergonomie | **72** | 0 | séparateur décimal corrigé partout et gardé par un test, critère d'orientation rendu à 17 % des parcelles ; mais deux panneaux de couches se contredisent sur sept entrées, et le document d'urbanisme est « non renseigné » sur chaque fiche |
| Robustesse | **82** | +4 | une base privée de sa table de suivi est désormais récupérable, procédure testée en CI ; une étape de CI qui ne prouvait rien a été remplacée par une qui prouve quelque chose ; zéro erreur serveur sur tout l'audit, zéro borne violée |
| Professionnalisation | **79** | +1 | 5 927 lignes de documentation, contrat d'API enrichi des mesures de troncature, CI à deux jobs avec des vérifications réelles, autocritique explicite d'un test que j'ai écrit hier ; mais `API_CONTRACTS.md` documentait la pagination Géorisques que le code ignore — une documentation débranchée du code |

**Pourquoi la note monte alors que l'audit trouve plus de défauts.** Ce n'est pas une contradiction :
la note décrit le logiciel, pas mon degré d'information. Le pire défaut connu de l'audit 5 est
corrigé et vérifié ; les défauts découverts ici étaient déjà présents et sont, sauf B2, de moindre
gravité. Ce qui baisse, c'est la qualité métier — parce qu'elle mesure la couverture réglementaire
effective, et que celle-ci est désormais connue comme incomplète.

---

## Conclusion

### Cette application est-elle suffisamment fiable pour un usage professionnel sans risque majeur d'erreur ?

**Non pour l'éolien. Oui pour le solaire au sol et le stockage, avec les réserves ci-dessous. Pas
encore comme pièce transmise en l'état à un tiers.**

- **Éolien : non, et pour la deuxième fois consécutive sur le même critère.** Le recul de 500 m de
  l'article L.515-44 repose sur `distanceHabitationM`, qui écarte 33,9 % du bâti dans le sens
  favorable. Sur une parcelle isolée dont le seul bâti proche est une habitation saisie sans usage —
  le cas de prospection éolienne typique — l'application peut annoncer l'absence d'habitation là où
  il y en a une. La correction est de trois lignes ; elle doit précéder tout usage éolien.
- **Solaire au sol et stockage : oui pour hiérarchiser et pour préparer une décision.** Ces filières
  n'ont pas de knock-out de recul à l'habitation, et le plafonnement des compteurs de risques
  n'altère pas les notes. Réserve à porter : l'APPB n'est pas examiné, et le type de document
  d'urbanisme n'est pas connu, ce qui pèse sur la qualification du régime applicable au PV au sol.
- **Méthanisation : pour hiérarchiser, oui ; pour décider, non.** Inchangé depuis trois audits.
- **À l'échelle du site : oui pour des parcelles jointives**, la contiguïté étant mesurée et la
  dispersion signalée.
- **Comme pièce transmise à un tiers : non, à cause d'un seul point.** Le fond est au niveau —
  fondements légaux datés, traçabilité des sources, réserves explicites, exclusion juridique
  distinguée du score, séparateur décimal correct. Mais le rapport peut nommer une ZNIEFF qui n'est
  pas celle dont il donne la distance (4 cas sur 5). Une donnée fausse dans un document technique
  coûte plus que dix données manquantes : elle met en cause tout le reste.
- **En exploitation multi-utilisateurs : oui.** File durable, rôles étanches, journalisation RGPD,
  limitation de débit, sauvegarde documentée et testée, reprise après perte de la table de suivi.

### Corrections indispensables avant utilisation opérationnelle

Les quatre premières lignes du tableau G. Difficulté très faible à faible, aucune ne touche
l'architecture :

1. **Élargir `estHabitation` au cas « Indifférencié »**, c'est-à-dire appliquer réellement la
   prudence que son commentaire annonce. À faire d'abord : c'est la seule des quatre qui puisse
   causer une faute juridique.
2. **Trancher sur l'APPB** : soit ingérer la couche INPN et alimenter `s.milieux.appb`, soit retirer
   le knock-out et signaler explicitement dans la fiche que cette contrainte n'est pas couverte. Ce
   qui n'est pas acceptable, c'est un knock-out qui ne peut pas se déclencher.
3. **Renommer deux champs** : `typedoc` → `du_type`, et `nom_site`/`nom` → `sitename` pour les deux
   couches Natura 2000.
4. **Prendre le nom du zonage naturel sur le site le plus proche**, et non sur `features[0]`.

### Le point de méthode, et il a changé de nature

Les cinq audits précédents concluaient tous de la même façon : le défaut critique se trouve dans la
zone la moins couverte par les tests, il faut la couvrir. Cet audit permet d'être plus précis, parce
que la nature des défauts trouvés a changé.

Les défauts B1, C1 et C2 ne sont pas des erreurs de logique. Ce sont des **erreurs de contrat** :
un champ lu sous un nom que la source n'emploie pas, un champ jamais écrit, un champ dont le
commentaire décrit autre chose que le code. Aucun test unitaire écrit depuis le code ne les
attrape — j'en ai la démonstration dans mes propres tests d'hier, qui vérifient
`estHabitation({}) === true`, un cas qui se produit 0,0 % du temps. **Un test écrit depuis
l'intention valide l'intention.**

Ce qui les attrape, c'est la confrontation à la donnée réelle. Trois contrôles mécaniques, tous
exécutés dans cet audit et tous productifs, devraient devenir permanents :

1. **Comparer les propriétés déclarées aux propriétés réellement renvoyées**, point d'entrée par
   point d'entrée. C'est ce contrôle qui a produit C1 en une exécution.
2. **Vérifier qu'aucun champ lu par le moteur n'est écrit par personne.** Ce contrôle, appliqué aux
   25 chemins des knock-outs, a produit B1 — et il aurait pu tourner dès le premier audit.
3. **Mesurer la distribution réelle des valeurs sur lesquelles un prédicat métier discrimine**,
   plutôt que de tester les cas que le commentaire décrit. C'est ce qui a produit B2.

Ces trois contrôles ne demandent pas de couvrir 13 000 lignes de connecteurs. Ils demandent un jeu
de réponses réelles enregistrées et trois assertions. C'est la réponse concrète à la boucle que les
cinq audits précédents décrivaient sans la casser.

---

## Suite donnée — corrections de priorité 1 appliquées

Les quatre corrections indispensables sont faites, vérifiées sur les services réels, et gardées par
des tests dont l'échec a été vérifié par mutation. Deux contrôles mécaniques permanents ont été mis
en place, ceux-là mêmes que la section « point de méthode » réclamait — et l'un d'eux a
immédiatement trouvé un défaut supplémentaire.

### 1. `estHabitation` applique désormais la prudence qu'il annonçait

`usageIndetermine()` traite « Indifférencié » comme un usage indéterminé, au même titre que la
chaîne vide. La règle est réordonnée : un usage explicitement non résidentiel exclut d'abord, la
nature tranche ensuite, et l'indéterminé compte comme habitation en dernier ressort. Le
raisonnement est écrit dans le code : **sous-compter surestime la distance, donc améliore la note et
peut empêcher le recul de 500 m de se déclencher ; sur-compter ne dégrade qu'une note.**

Effet mesuré sur parcelle réelle (283900000C0843, Tillay-le-Péneux) : **28 → 83 habitations dans les
500 m**, soit le tiers de bâti qui était écarté. Et pour l'éolien, le knock-out
`ko_eol_habitation_500` se déclenche — vérifié en exécution, statut rouge, score nul.

Les tests de ce prédicat ont été **réécrits depuis la distribution mesurée** et non depuis le
commentaire. L'ancien test, qui vérifiait `estHabitation({}) === true`, est conservé mais porte
désormais son autocritique : il couvrait un cas qui se produit 0,0 % du temps.

### 2. L'APPB est alimenté, et le knock-out peut se déclencher

La couche est absente du module Nature d'API Carto — 404 sur `appb`, `apb`,
`arrete-protection-biotope`, `protection-biotope`, `biotope`. Elle existe au WFS PatriNat sous
`patrinat_apb:apb`. Nouveau connecteur `appb()` dans `wfs.ts`, emprise dégressive 10 km puis 2 km,
source déclarée au catalogue avec son avertissement juridique (R.411-15 CE, protection absolue et
non dérogeable). Le nombre de sources du référentiel passe de 18 à 19.

Vérifié sur le service réel : forêt de Rennes → `recouvre=false, distance=3 226 m, nom="Nidification
du balbuzard pêcheur en forêt de Rennes"`. En Beauce → réponse complète et vide, donc
`recouvre=false, distance=null` : une **absence constatée**, et non plus un `null` indistinct.

### 3. Deux champs renommés, et deux valeurs qui n'étaient jamais renseignées

| Connecteur | Avant | Après | Effet vérifié |
|---|---|---|---|
| `gpu/document` | `typedoc` | **`du_type`** | `typeDocument = "PLUi"` ; la fiche affiche « Zone Ua (PLUi) » au lieu de « Zone Ua » |
| `nature/natura-*` | `nom_site` puis `nom` | **`sitename`** puis `nom` | « Recouvrement Natura 2000 — Beauce et vallée de la Conie » au lieu du seul « Recouvrement Natura 2000 » |

Le repli qui requalifiait tout type inconnu en `PLU` est supprimé : un type non répertorié reste
nul et fait l'objet d'un avertissement journalisé. Présenter un PSMV ou un SCOT comme un PLU serait
une affirmation fausse sur un document transmis à un tiers.

`nom_site` a par ailleurs été **retiré** des propriétés déclarées par `nature.ts` : ce champ
n'existe sur aucune couche d'API Carto, et le déclarer « au cas où » est exactement la défensive
spéculative qui a masqué le défaut d'origine — un champ inexistant se lit sans erreur et rend la
valeur nulle pour toujours. Le connecteur APPB, lui, le lit là où il existe vraiment.

### 4. Le nom du zonage naturel vient du site le plus proche

`zonageDepuisFeatures()` (dans `distances.ts`, partagée par le connecteur Nature et le connecteur
APPB) calcule la distance entité par entité et retient le nom de celle qui réalise le minimum. Un
recouvrement l'emporte et court-circuite. Le nom ne survit jamais seul : si la distance n'est pas
démontrée par l'emprise couverte, les deux disparaissent ensemble — un nom sans distance
désignerait un site sans dire où il est.

Vérification sur les cas mêmes que l'audit avait mesurés comme faux :

| Lieu | Avant (nom de `features[0]`) | Après (nom du plus proche) |
|---|---|---|
| Sologne (41), 1 846 m | ETANG DE MALZONE | **ETANG DES BROSSES** |
| Camargue (13), 0 m | MARAIS DE MEYRANNE ET DES CHANOINES | **SYSTÈME DU VACCARÈS** |
| Brenne (36), 0 m | Étangs Purais, Étang de la Touche | **Étangs du Ralé et Perculeux** |
| Beauce (28), 2 072 m | TERRAIN MILITAIRE DE BOUARD ET VALLEE DE FONTENAY | **Pelouses sèches de Saint-Florentin** |

Deux corrections secondaires ont été faites dans la même fonction : `partRecouvrement` ne vaut plus
`1` dès qu'il y a un recouvrement — valeur fausse dès qu'une parcelle n'est qu'en partie dans le
zonage — mais `null`, c'est-à-dire inconnu ; et `0` reste affirmé quand il n'y a pas de
recouvrement, ce qui est exact.

### Les deux contrôles permanents, et ce que l'un d'eux a trouvé

**`apps/api/test/contrats-sources.test.ts`** — les champs déclarés existent-ils vraiment ? Une
fixture (`fixtures/proprietes-sources.json`) porte les propriétés réellement renvoyées par
quinze points d'entrée, capturées sur les services de production. Le test vérifie deux choses :
que tout champ dont le code dépend y figure, et que **toute propriété déclarée par une interface
`Proprietes*` existe dans au moins une réponse réelle** de ce connecteur.

La seconde assertion a été ajoutée après une vérification par mutation qui a montré la faiblesse de
la première : reverser le connecteur à `typedoc` ne faisait échouer que le typage, parce que le test
s'appuyait sur une table tenue à la main. Les interfaces sont désormais des contrats vérifiés, pas
des déclarations d'intention. Mutation rejouée : les deux dérives sont attrapées par le test seul.

**`apps/api/test/champs-orphelins.test.ts`** — un champ dont dépend une décision est-il écrit par
quelqu'un ? Contrôle sur les 25 chemins lus par les knock-outs et les 50+ lus par les évaluateurs.
Ce test aurait attrapé l'APPB, et il aurait pu tourner dès le premier audit.

Il a trouvé du premier coup un défaut que cet audit n'avait pas vu : **`s.milieux.trameVerteBleue`
n'est écrit par aucun connecteur**, et le critère `env_tvb` restait donc gris indéfiniment, en
prétendant dépendre du module Nature qui ne porte pas cette donnée. La trame verte et bleue est
définie par les SRADDET régionaux, sans API nationale homogène : l'absence est structurelle. Le
critère est désormais déclaré `sansSource`, mécanisme déjà présent dans le projet et fait pour ce
cas — la fiche dit explicitement que l'enjeu n'a pas été regardé et où le chercher, le critère ne
pénalise plus la couverture de données, et **le statut est plafonné à orange** : aucune parcelle ne
peut ressortir propice sur une continuité écologique que personne n'a examinée. Vérifié en
exécution : `criteres_sans_source` apparaît bien dans les limites de viabilité.

Le test interdit que la liste des absences assumées devienne un tapis : toute entrée doit porter une
raison de plus de soixante caractères **et** s'appuyer sur `sansSource`.

> Ma première version de ce test signalait aussi `s.foncier.proprietairePublic` comme orphelin.
> C'était un faux positif : il ne scannait que `connecteurs/` et `enrichissement.ts`, alors que ce
> champ est alimenté par le versement manuel des données de propriété (`scripts/`) puis relu dans
> `routes/`. Le périmètre a été élargi, et la raison est écrite dans le test.

### Corrections secondaires prises au passage

- **`rncf` est désormais interrogé.** L'en-tête de `nature.ts` l'annonçait comme vérifié depuis
  l'origine sans qu'il figure dans la liste des chemins : les réserves nationales de chasse et faune
  sauvage étaient hors couverture alors que la documentation les disait couvertes.
- **La fusion des réserves n'affirme plus une absence sur une donnée manquante.** Elle exigeait
  qu'une seule des couches réponde (`rnn || rnc`) : si `rnn` échouait et que `rnc` répondait à vide,
  le résultat était `reserveNaturelle.recouvre = false` — une absence affirmée là où une réserve
  naturelle nationale est un knock-out. Les trois couches doivent maintenant toutes avoir répondu.

### État après corrections

| | Avant | Après |
|---|---|---|
| Tests | 270 | **307** (46 core, 53 scoring, 193 api, 15 web) |
| Habitations comptées dans les 500 m (parcelle réelle) | 28 | **83** |
| Knock-out éolien des 500 m sur cette parcelle | ne se déclenchait pas | **se déclenche** |
| Knock-out APPB | ne pouvait jamais se déclencher | alimenté, absence constatée distinguée du silence |
| Type de document d'urbanisme | toujours nul | `PLUi` / `PLU` |
| Nom du site Natura 2000 | toujours nul | renseigné |
| Nom du zonage naturel affiché | site arbitraire (4 cas sur 5 faux) | site le plus proche |
| Critère trame verte et bleue | gris silencieux | `sansSource`, statut plafonné à orange |
| Sources déclarées au référentiel | 18 | 19 |

Ce qui reste ouvert : les lignes 5 à 11 du tableau G. La pagination Géorisques (C3) n'a pas été
traitée — son effet sur la note est nul et seule la valeur affichée est fausse — non plus que la
duplication des deux catalogues de couches (C4) ni la couverture de l'interface (C5).
