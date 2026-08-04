# Troisième audit — 4 août 2026

Audit demandé sans complaisance, du point de vue croisé du développement, de l'architecture,
du produit, de l'UX, de la qualité logicielle et du métier ENR.

**Avertissement sur l'impartialité.** J'audite du code que j'ai écrit, y compris les
vingt-sept corrections livrées depuis le premier audit. Le biais est réel et il s'est
manifesté deux fois : le premier audit s'est conclu sur un 66/100 que le deuxième a dû
corriger à 57, et **quatre des onze problèmes des deux audits précédents étaient des
régressions de mes propres corrections**. J'ai donc inversé la méthode : j'ai commencé par
attaquer le code écrit hier, puis les zones jamais examinées (export Shapefile, export PDF,
CSV, ingestion, tableau de bord). Chaque constat renvoie à un fichier et, quand c'est
possible, à une **exécution** — pas à une lecture de mémoire.

**Ce qui a été vérifié par exécution.** Le moteur de scoring, l'écriture Shapefile décodée
octet par octet contre la spécification ESRI de juillet 1998, la génération PDF sur trois
jeux dont un snapshot entièrement vide, le coût CPU de l'estimation de recouvrement, l'effet
chiffré du coefficient de tracé.

**Ce qui n'a pas pu être vérifié.** Aucune base PostgreSQL dans le conteneur d'audit : les
migrations 008 et 009, la trace des campagnes et l'IDOR sur les profils de pondération ne
sont validés que par le typage. Aucune mesure de temps de réponse HTTP réel, aucun test sur
les parcelles de la base de développement.

**Périmètre mesuré :** 22 000 lignes (TypeScript, TSX), 9 migrations SQL (787 lignes),
4 020 lignes de documentation, **6 fichiers de test (1 325 lignes, 78 tests)**, intégration
continue présente.

---

## A. Ce qui fonctionne bien

**1. L'écriture Shapefile est correcte, et c'est vérifié.** 398 lignes écrites à la main,
sans dépendance, pour un format binaire — le genre de code qui produit d'ordinaire des
fichiers illisibles. J'ai décodé l'archive produite :

```
.shp  code fichier 9994 OK | longueur déclarée 254 = réelle 254 | version 1000 | type 5
.shx  longueur déclarée 62 = réelle 62 | 3 entités
      entité 0 : offset 100, longueur 128 → dans .shp numéro=1 longueur=128  OK
      entité 1 : offset 236, longueur 128 → dans .shp numéro=2 longueur=128  OK
.dbf  en-tête 225, enregistrement 96, somme des champs + 1 = 96  OK
      terminateur 0x0D OK | marqueur de fin 0x1A OK
```

Les deux pièges classiques du format sont couverts : **collision de noms** tronqués à
10 caractères (`surface_calculee_m2`, `surface_cadastrale_m2`, `surface_cadastrale_ha`
donnent `SURFACE_CA`, `SURFACE_1`, `SURFACE_2` — aucun doublon) et **troncature UTF-8** en
milieu de caractère (254 octets déclarés, décodage strict sans erreur). Un fichier `.cpg`
déclare l'encodage, un `.prj` le système de coordonnées, un `LISEZ-MOI.txt` avertit de la
troncature des noms. Cela s'ouvre dans QGIS.

**2. Le rapport PDF est solide et robuste.** Trois générations testées : cas nominal solaire
(19,5 ko, 4 pages), méthanisation (15,7 ko, 3 pages) et **snapshot entièrement vide**
(16,8 ko, 4 pages) — aucune ne plante, toutes produisent un en-tête `%PDF-` et un `%%EOF`
valides. Le contenu est structuré et professionnel : synthèse chiffrée, limites de viabilité
motivées, carte d'identité, raccordement, et des seuils de procédure avec leur **fondement
légal et leur date d'entrée en vigueur** (« Code de l'urbanisme, art. R.421-1 et R.421-9,
décret n° 2023-1408 du 8 décembre 2023 — depuis le 2023-12-10 »). Les corrections d'hier y
sont visibles : « 11,27 ha implantables (12,00 ha au cadastre, soit 6 % déduits) », « régime
Agrivoltaïsme (présumé) », « moteur 1.2.0+27920b4d ».

**3. Le CSV est correctement échappé.** Guillemets doublés, encadrement dès qu'un champ
contient `;`, `"` ou un saut de ligne, BOM UTF-8 pour Excel français, virgule décimale.
Aucune colonne exportée n'est en texte libre : l'injection de formule Excel n'est donc pas
atteignable aujourd'hui — mais elle le deviendrait si l'on ajoutait les notes d'un lead.

**4. L'ingestion ne détruit rien.** Toutes les écritures passent par `ON CONFLICT … DO
UPDATE`. Aucun `TRUNCATE`, aucun `DELETE FROM` de masse : une ingestion interrompue laisse
la table dans son état précédent, elle ne la vide pas.

**5. Le moteur reste rigoureusement cohérent.** 43 critères, 43 évaluateurs, 43 critères
pondérés, zéro orphelin. **0** occurrence de `as any`, `@ts-ignore` ou `@ts-expect-error` sur
22 000 lignes. **0** catch silencieux. SQL entièrement paramétré.

**6. L'intégration continue existe enfin**, et elle fait la bonne chose dans le bon ordre :
typage, construction, puis tests — les tests de scoring s'exécutant contre `dist/`, les
lancer sans construire les ferait passer contre un build périmé, ce qui est déjà arrivé. Un
second job rejoue les migrations **deux fois** sur un PostGIS jetable, pour éprouver leur
idempotence : c'est le seul endroit où une faute n'apparaît ni au typage ni aux tests.

**7. Les vingt-sept corrections précédentes tiennent.** Vérifié par exécution : méthanisation
à 100 % de couverture et plafonnée orange, site de parcelles grises qui reste gris, déport
d'implantation, surface nette, linéaire majoré, tuiles parcellaires protégées.

**8. L'estimation de part couverte fait ce qu'elle prétend.** Deux zones couvrant la même
moitié d'une parcelle, l'une minuscule et l'autre immense, rendent la même part : le défaut
de rapport-de-tailles est réellement corrigé.

**9. Le tableau de bord se garde de la division par zéro** avant tout calcul de pourcentage.

**10. La documentation est au-dessus du lot** : 4 020 lignes, sources tracées avec leur
valeur juridique, et des commentaires qui expliquent le *pourquoi* — y compris les erreurs
passées, ce qui empêche de les refaire.

---

## B. Problèmes critiques

### B1. La liste affiche « Score faible » sur une parcelle réglementairement écartée

**Le plus grave, et c'est ma correction d'hier qui l'a produit.**

Hier, pour distinguer le rouge rédhibitoire du rouge de score faible, j'ai renommé
`LIBELLES_SCORE.rouge` de « Rédhibitoire / écarté » en « **Score faible** », et j'ai ajouté
une cinquième couleur sur la carte et dans la fiche.

Je n'ai pas traité la **liste**. `VueListe.tsx:190` affiche
`referentiel.palette.libellesScore[l.statutScore]`. Une parcelle rouge par knock-out y porte
donc désormais l'étiquette « Score faible » — **factuellement fausse**, alors qu'avant ma
correction elle affichait « Rédhibitoire / écarté », qui était juste.

Ma correction a amélioré deux surfaces et **dégradé la troisième**, celle qui sert à trier
avant d'appeler un propriétaire.

La cause structurelle : `LigneListe` (`api/client.ts:359-372`) ne porte pas `nbKnockOuts`, et
`services/recherche.ts` n'utilise `nb_knock_outs` que dans une clause `WHERE` (ligne 279) —
il n'est **jamais sélectionné ni renvoyé**. La liste n'a donc pas l'information, même si elle
voulait l'afficher.

**Correction :** ajouter `s.nb_knock_outs` au `SELECT` et à la ligne renvoyée, l'exposer dans
`LigneListe`, et afficher le libellé rédhibitoire quand il est non nul — dans la liste et
dans la colonne « Statut score » du CSV.

### B2. Un visiteur qui se connecte pour la première fois lit « Session expirée »

`api/client.ts:150` signale une session expirée sur **tout** 401, hors route de connexion.
Au premier chargement, `/api/auth/moi` répond 401 puisqu'aucun jeton n'existe : le bandeau
« **Session expirée — votre session a dépassé sa durée de validité** » s'affiche à quelqu'un
qui n'a jamais eu de session.

Régression de ma correction B4 d'hier, qui traitait le cas inverse (jeton périmé en cours
d'usage) sans distinguer « jeton absent » de « jeton refusé ».

**Correction :** ne signaler l'expiration que si un jeton était effectivement présent avant
l'appel.

### B3. Le PDF affirme une absence de déclaration agricole qu'il n'a pas constatée

`services/exports.ts:474` :
`snapshot.occupationSol.rpg.libelleCulture ?? 'aucune declaration'`.

Un `null` est rendu comme un **constat**. Or il couvre trois situations distinctes : la
parcelle n'est pas déclarée à la PAC ; le millésime RPG ne la couvre pas ; le connecteur
`apicarto_rpg` a échoué — cas explicitement prévu par `enrichissement.ts:164`
(`echecs.add('apicarto_rpg')`). Dans les trois cas le rapport imprime « aucune déclaration ».

C'est exactement la famille de défaut corrigée pour le gisement méthanisable au deuxième
audit, et elle survit dans le document que l'on transmet. Le reste du fichier fait pourtant
bien les choses : `ligne 308` rend `null` en « non renseigné ». La ligne 474 est l'exception.

### B4. Le PDF se contredit sur la distance au poste, dans le même document

Extrait du rapport généré :

```
SYNTHESE
  Vigilance   Distance au poste source   5,7 km de trace estime (4,2 km a vol d'oiseau) - Poste de Janville

RACCORDEMENT
  POSTE SOURCE          GESTIONNAIRE   DISTANCE
  Poste de Janville     Enedis         4,2 km
```

Deux nombres pour la même chose, à deux blocs d'intervalle, sans que le tableau
« Raccordement » précise lequel il donne. Un lecteur externe y verra une erreur de calcul.
Régression directe de ma correction E4 d'hier, qui n'a pas propagé le changement au tableau.

### B5. La fonction « données de propriétaires » ne fait toujours rien

`proprietaire_parcelle` n'est alimentée par aucun connecteur. Depuis hier la route dit
honnêtement `etatSource: 'non_alimentee'` et l'avertissement est explicite — l'utilisateur
n'est plus trompé. Mais la fonctionnalité reste vide, et tout l'appareillage RGPD
(habilitation, motif obligatoire, journalisation stricte) protège un tiroir vide. Le coût
n'est plus la tromperie, c'est la promesse non tenue.

### B6. La couverture de test ne va toujours pas là où sont les défauts

78 tests, contre 19 au premier audit — un vrai progrès. Mais **les quatre problèmes critiques
ci-dessus vivent tous dans des zones non testées** : le rendu de la liste, le contenu du PDF,
et le chemin d'authentification au premier chargement. Zéro test d'interface, zéro test sur
le contenu des exports, zéro test sur les connecteurs.

Le constat du deuxième audit se vérifie une troisième fois : les tests ajoutés protègent
exactement ce qui vient d'être corrigé, et les nouveaux défauts apparaissent dans ce qu'ils
ne couvrent pas.

---

## C. Problèmes importants

### C1. Le rayon de raccordement dessiné sur la carte contredit le score

Les constantes `rayonRaccordementKm` (5 km en stockage, 8 km en solaire, 12 km en éolien) sont
restées en **distance à vol d'oiseau**, alors que le score note désormais le **linéaire
estimé**. Mesuré :

| vol d'oiseau | tracé estimé | note stockage | note solaire |
|---|---|---|---|
| 4 km | 5,40 km | 46,7 | 69,3 |
| 6 km | 8,10 km | 24,5 | 51,4 |
| 8 km | 10,80 km | 11,0 | 35,2 |

Le cercle de 5 km présenté comme le « rayon économique » du stockage englobe donc des
parcelles que le moteur note autour de 35 — sous le seuil orange de 40, donc **rouges**. Deux
parties de l'interface disent le contraire l'une de l'autre, et l'utilisateur ne peut pas
savoir laquelle croire.

### C2. Le coefficient de tracé a été appliqué à des courbes non recalibrées

J'ai écrit dans `criteres-eval.ts` : « les courbes ci-dessus sont calées sur des distances de
tracé ». **Je ne peux pas étayer cette affirmation** : j'ai écrit ces courbes moi-même, à une
époque où l'entrée était la distance à vol d'oiseau.

Le raisonnement retenu est défendable — les seuils de coût cités dans la profession (« au-delà
de 10 km la liaison domine le budget ») portent sur du linéaire posé, donc du tracé — mais il
reste une hypothèse. Si les courbes intégraient déjà implicitement la sinuosité, la
majoration de 35 % la compte deux fois et pénalise tout le classement. L'écart mesuré est de
10 points de note sur un critère qui pèse 17,7 % en stockage.

**Ce qu'il faut faire :** trancher explicitement, en confrontant les paliers à des coûts de
raccordement réels sur des projets connus, et l'écrire. En l'état, un commentaire affirme ce
qui n'est pas établi.

### C3. La déduction de surface d'un site suppose une contiguïté que rien ne vérifie

Mesuré sur dix parcelles de 0,3 ha :

```
Érosion d'une parcelle de 0,3 ha : 0,191 ha nets (64 % conservés)
Somme des dix                    : 1,914 ha
Érosion de l'agrégat vu comme 3 ha : 2,639 ha (88 % conservés)
Écart                              : 0,726 ha, soit +38 %
```

Le site est érodé comme **un seul bloc compact**. C'est correct pour dix parcelles
contiguës — la clôture n'entoure que le périmètre extérieur — et nettement optimiste pour dix
parcelles dispersées, qui exigent chacune la leur.

Rien ne vérifie la contiguïté, alors que `surfaceDunSeulTenantHa` existe dans le snapshot et
donnerait la réponse. `calculerScoreSite` passe en outre `morcellementIndice = null`, donc la
valeur par défaut 30, ignorant le morcellement réel des parcelles agrégées.

### C4. L'estimation de recouvrement bloque la boucle d'événements

Mesuré :

```
zone de   50 sommets :  3,3 ms par appel
zone de  500 sommets : 11,8 ms par appel
zone de 2000 sommets : 36,0 ms par appel
```

`partCouverte` est du calcul synchrone : 1 600 tests point-dans-polygone par appel, environ
trois appels par parcelle (une zone d'urbanisme par zonage retourné). Sur une campagne de
500 parcelles, cela représente jusqu'à 54 secondes de boucle d'événements bloquée, par
tranches de 36 ms. Rapporté aux ~42 minutes d'une telle campagne c'est 2 % du temps, mais
chaque tranche retarde d'autant les tuiles demandées par la carte pendant ce temps.

### C5. Une seule qualification à la fois, pour tout le processus

`services/qualification.ts` conserve un état singleton en mémoire. Un second utilisateur
reçoit `null`, traduit en 409. La trace en base ajoutée hier permet de constater les
campagnes interrompues, mais pas d'en mener deux.

### C6. Aucune procédure de sauvegarde documentée

La base porte le seul état non reconstituable de l'application : les leads, les sites,
l'historique de prospection et le journal RGPD. Les parcelles et les scores se recalculent ;
le pipeline commercial, non. Aucun document ne dit comment le sauvegarder ni le restaurer.

---

## D. Problèmes secondaires

- **`moyenne()` reste muette sur ce qu'elle ignore**, sauf dans `fonc_maitrise` où c'est
  désormais affiché. Le procédé n'a pas été généralisé aux autres critères composites.
- **`dateCalcul` rend un résultat non reproductible** à l'octet : deux calculs identiques
  diffèrent, ce qui empêche toute comparaison par empreinte.
- **Les coefficients de pénalité de fragmentation** (`0,7 + 0,3 × part retenue`) sont
  documentés comme empiriques mais restent sans source, contrairement au reste du moteur.
- **Accessibilité de la carte** : `role="application"` sans aucun chemin clavier vers les
  parcelles. La vue liste est l'alternative accessible, mais rien ne l'annonce comme telle.
- **La purge du limiteur de débit** se déclenche sur `seaux.size % 500 === 0`, condition qui
  peut être franchie sans être vue si des entrées sont supprimées entre-temps. Sans
  conséquence à l'échelle visée, mais le mécanisme n'est pas garanti.
- **Le libellé `LIBELLES_SCORE.rouge`** est désormais « Score faible » partout, y compris là
  où le contexte ne dit pas s'il y a knock-out (voir B1). Le nommage aurait dû rester neutre.

---

## E. Erreurs métier

**E1. Un prospecteur lit « Score faible » sur une parcelle exclue par le droit** (B1). C'est
l'erreur métier la plus directe de cet audit : elle invite à retenter une parcelle que
l'article L.515-44 écarte.

**E2. Le rapport transmis affirme une absence de déclaration agricole** (B3). Sur une parcelle
dont le RPG n'a pas pu être interrogé, le document dit « aucune déclaration » — un
interlocuteur agricole relèvera l'erreur immédiatement.

**E3. Le rayon économique dessiné contredit la note** (C1). L'utilisateur cadre son secteur
sur un cercle, puis découvre que les parcelles à l'intérieur sont rouges.

**E4. La surface implantable d'un site suppose des parcelles jointives** (C3). Sur un site
dispersé, la surface annoncée est surestimée de près de 40 %, donc la puissance installable,
donc le chiffre d'affaires.

**E5. Les indicateurs dérivés restent des proxies**, désormais tous étiquetés : potentiel
agronomique (déduit du groupe de culture RPG), pré-enjeu espèces (déduit des zonages),
surface implantable (érosion modélisée), linéaire de raccordement (majoration forfaitaire),
part de zonage (échantillonnage). L'étiquetage est honnête et visible dans la fiche comme
dans le PDF. Il ne suffira pas pour un tiers, qui lira des mesures.

**E6. La méthanisation ne peut produire aucun « go ».** Le mécanisme « critère sans source »
la rend comparable et classable, mais plafonne toute parcelle à orange tant que les couches
d'élevages, d'IAA et de surfaces agricoles ne sont pas ingérées. C'est le comportement
honnête ; il faut savoir que la filière sert à hiérarchiser, jamais à décider.

---

## F. Risques

| Risque | Origine | Probabilité / gravité |
|---|---|---|
| **Démarcher une parcelle réglementairement exclue** | liste étiquetée « Score faible » (B1) | **élevée** — la liste est l'outil de tri quotidien |
| **Se faire contredire par un exploitant agricole** | « aucune déclaration » affirmée (B3) | élevée sur un rapport transmis |
| **Perdre la confiance de l'utilisateur dès l'ouverture** | « Session expirée » au premier accès (B2) | **certaine** — chaque nouvel utilisateur |
| **Voir une erreur de calcul dans le rapport** | 5,7 km et 4,2 km dans le même PDF (B4) | élevée sur une lecture attentive |
| **Cadrer un secteur sur un rayon trompeur** | rayon en vol d'oiseau, score en tracé (C1) | moyenne à élevée |
| **Surestimer un site de 40 %** | contiguïté supposée (C3) | moyenne — dépend de la dispersion réelle |
| **Pénaliser deux fois la sinuosité** | courbes non recalibrées (C2) | moyenne, et invisible : le classement se déforme sans erreur apparente |
| **Perdre le pipeline commercial** | aucune procédure de sauvegarde (C6) | faible probabilité, gravité maximale — c'est le seul état non reconstituable |
| **Ralentir la carte pendant une campagne** | boucle d'événements bloquée (C4) | moyenne, sans perte de données |
| **Régression silencieuse** | exports, interface et connecteurs non testés (B6) | **élevée** — quatre régressions en trois audits |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | Liste : « Score faible » sur une parcelle rédhibitoire (B1) | erreur métier directe sur l'outil de tri | **faible** — remonter `nb_knock_outs` | **critique** |
| 2 | « Session expirée » au premier accès (B2) | crédibilité, chaque nouvel utilisateur | **très faible** | **critique** |
| 3 | PDF : « aucune déclaration » affirmée (B3) | affirmation fausse dans un document transmis | **très faible** | **critique** |
| 4 | PDF : deux distances contradictoires (B4) | lu comme une erreur de calcul | **très faible** | **critique** |
| 5 | Rayon carte / score incohérents (C1) | deux parties de l'UI se contredisent | faible | **élevée** |
| 6 | Trancher la calibration des courbes de raccordement (C2) | classement possiblement doublement pénalisé | moyenne — demande des données de projets réels | **élevée** |
| 7 | Contiguïté d'un site non vérifiée (C3) | surestimation de 40 % sur site dispersé | moyenne | **élevée** |
| 8 | Tests d'export et d'interface (B6) | c'est là que naissent les régressions | élevée | **élevée** |
| 9 | Procédure de sauvegarde et de restauration (C6) | seul état non reconstituable | faible | **élevée** |
| 10 | Alimenter ou retirer la fonction propriétaires (B5) | promesse non tenue | faible (retirer) / élevée (alimenter) | **élevée** |
| 11 | Sortir `partCouverte` de la boucle d'événements (C4) | latence pendant les campagnes | moyenne | **moyenne** |
| 12 | Qualifications concurrentes (C5) | usage à plusieurs | moyenne | **moyenne** |
| 13 | Généraliser l'affichage des agrégats partiels (D) | couverture optimiste | faible | **moyenne** |
| 14 | Sourcer la pénalité de fragmentation (D) | chiffre indéfendable | faible | **moyenne** |
| 15 | Chemin clavier vers les parcelles (D) | accessibilité | moyenne | **faible** |
| 16 | Reproductibilité du résultat de score (D) | comparaison par empreinte | faible | **faible** |

---

## Note globale : 66 / 100

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | **62** | chemin parcelle solide et testé, exports Shapefile validés octet par octet, PDF robuste ; mais la liste étiquette faux une parcelle exclue, et le PDF affirme une non-déclaration qu'il n'a pas constatée |
| Qualité technique | **70** | CI en place et bien ordonnée, 78 tests, écriture Shapefile correcte sans dépendance, 0 échappatoire de typage, 0 catch silencieux ; mais aucun test d'export ni d'interface, et du calcul lourd sur la boucle d'événements |
| Qualité métier | **68** | reculs réglementaires, surface implantable, linéaire, régime présumé : tout est désormais correct et étiqueté ; restent la contradiction rayon/score, la contiguïté supposée et une calibration non établie |
| Ergonomie | **60** | légende à cinq entrées, fiche et PDF de bon niveau ; mais « Session expirée » au premier accès, libellé faux dans la liste, et un PDF qui se contredit |
| Robustesse | **68** | PDF qui survit à un snapshot vide, ingestion en upsert, limitation de débit, cache plafonné, campagnes tracées ; qualification mono-utilisateur, pas de sauvegarde |
| Professionnalisation | **66** | CI avec idempotence des migrations, 4 020 lignes de documentation qui expliquent le pourquoi ; pas de sauvegarde, pas de versionnement du référentiel au-delà de l'empreinte |

**Sur la coïncidence avec le 66/100 du premier audit.** Le chiffre est le même, sa valeur ne
l'est pas. Celui du premier audit était une estimation posée sans avoir examiné le chemin
« site », les exports ni les connecteurs — et le deuxième audit l'a ramené à 57. Celui-ci
s'appuie sur une validation binaire du Shapefile, trois générations de PDF, deux mesures de
performance et une simulation chiffrée du coefficient de tracé. Le logiciel a réellement
progressé de 57 à 66 ; il reste quatre défauts critiques, tous petits, et trois d'entre eux
sont des régressions de mes propres corrections.

---

## Conclusion

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un
> cadre professionnel sans risque majeur d'erreur ?**

**Pas encore — mais il ne reste que quatre corrections, et elles sont toutes petites.**

C'est un changement de nature par rapport aux deux audits précédents. Ceux-ci butaient sur des
défauts de conception : une filière entière inexploitable, un score de site qui contournait
tous les garde-fous, des chiffres fabriqués. Ces défauts sont traités. Ce qui reste relève de
la **finition** : deux libellés faux, un bandeau affiché au mauvais moment, un tableau non
mis à jour. Aucune ne demande plus d'une heure.

**Par usage, en l'état :**

- **Solaire, éolien, stockage, à l'échelle de la parcelle : oui comme outil de dégrossissage
  interne**, à condition de ne pas se fier à la colonne « Statut » de la liste, qui étiquette
  faux les parcelles rédhibitoires (B1). La fiche et la carte, elles, sont justes.
- **Méthanisation : pour hiérarchiser, oui ; pour décider, non.** Aucune parcelle ne peut
  ressortir propice tant que les couches d'intrants ne sont pas ingérées. C'est explicite et
  motivé dans l'interface.
- **À l'échelle du site : oui pour des parcelles jointives**, ce qui est le cas d'usage
  normal. Sur un site dispersé, la surface implantable est surestimée d'environ 40 % (C3).
- **Comme pièce transmise à un tiers : non.** Deux raisons précises, pas générales : le
  rapport affirme une absence de déclaration agricole qu'il n'a pas constatée (B3), et il
  donne deux distances contradictoires pour le même poste source (B4). Corrigées, le PDF
  devient défendable — sa structure, ses fondements légaux datés et sa traçabilité des sources
  sont déjà au niveau attendu.

### Corrections indispensables avant toute utilisation opérationnelle

Les quatre premières lignes du tableau G. Difficulté faible à très faible pour chacune :

1. **Remonter `nb_knock_outs` jusqu'à la liste** et y afficher le libellé rédhibitoire, dans
   la vue liste et dans le CSV.
2. **Ne signaler l'expiration de session que si un jeton existait** avant l'appel.
3. **Rendre « aucune déclaration » en « non renseigné »** quand le RPG n'a pas répondu.
4. **Aligner le tableau Raccordement du PDF** sur la synthèse : afficher le tracé estimé et
   le vol d'oiseau, ou dire lequel est donné.

### Ensuite, avant tout usage en équipe

Aligner les rayons affichés sur le linéaire estimé (5), trancher la calibration des courbes
de raccordement en la confrontant à des coûts réels (6), vérifier la contiguïté avant de
déduire la surface d'un site (7), et documenter la sauvegarde de la base (9) — c'est le seul
état que l'application ne sait pas reconstituer.

### Le point qui décidera de la durée de vie de l'outil

**Tester les exports et l'interface.** Trois audits, quatre régressions, et à chaque fois dans
la zone que les tests venaient de ne pas couvrir. Les 78 tests protègent le moteur, qui est
désormais la partie la plus fiable de l'application. Les défauts sont tous sortis d'ailleurs :
du rendu d'une liste, du contenu d'un PDF, d'un chemin d'authentification. Tant que la
couverture suivra les corrections au lieu de les précéder, le quatrième audit trouvera quatre
nouveaux défauts dans les zones que celui-ci n'a pas fait tester.
