# Toutes les parcelles de France, et rien qui les cache

> Ce document n'est **pas un audit**. C'est le compte rendu d'un **signalement d'usage** : une parcelle
> précise, demandée par un collègue, était introuvable dans l'application — ni qualifiable, ni même
> visible en zoomant sur le parcellaire. La même exigence que les audits s'y applique : **aucune
> affirmation qui ne soit mesurée ou exécutée.**

---

## Le signalement, et ce qu'il révélait

> « Quand j'ai lancé la qualification, le logiciel n'a pas été capable de me qualifier la parcelle, et
> pire, quand je zoomais et que j'avais les zones parcellaires, la parcelle que mon collègue étudie
> n'apparaissait pas. Cela veut dire que toutes les parcelles de France n'apparaissent pas. »

La conclusion de l'utilisateur était **exacte**, et le diagnostic a trouvé non pas une cause mais
**cinq**, toutes de la même famille : l'application affirmait une couverture qu'elle n'avait pas.

| # | Cause | Effet | Visible avant ? |
|---|---|---|---|
| 1 | La couche parcellaire venait de **notre** table `parcelle`, qui ne contient que les parcelles déjà qualifiées | rien ne distinguait « pas de parcelle ici » de « parcelle pas encore étudiée » | non |
| 2 | La recherche par identifiant lisait **uniquement** `FROM parcelle WHERE idu = $1` | l'identifiant exact d'une parcelle jamais étudiée ne renvoyait **rien** | non |
| 3 | Aucun moyen de **désigner** une parcelle non qualifiée pour l'étudier | seul « Qualifier l'emprise » existait, avec ses deux filtres | non |
| 4 | Filtre de surface à 3 000 m², appliqué **en silence** à toute campagne d'emprise | **55 à 60 %** du parcellaire écarté en Beauce (mesuré) | non |
| 5 | Plafond de lot (1 500) et cellules en échec, **silencieux** tous les deux | une campagne partielle était indistinguable d'une campagne complète | non |

Les causes 4 et 5 sont les plus coûteuses : elles portent sur ce qui **n'est pas** à l'écran, donc sur
ce que personne ne peut vérifier.

### La mesure qui a chiffré la cause 4

`apps/api/scripts/diagnostic-parcelles-manquantes.ts`, sur trois communes réelles de la Beauce — une
région de **grandes** parcelles, donc le cas le plus favorable au filtre :

| Commune | Parcelles au cadastre | Écartées par le seuil de 3 000 m² | Part |
|---|---|---|---|
| Bazoches-les-Hautes (28) | 806 | 487 | **60 %** |
| Loigny-la-Bataille (28) | 689 | 377 | **55 %** |
| Tillay-le-Péneux (28) | 1 090 | 609 | **56 %** |

Ailleurs — Finistère, Vaucluse, Alsace — la part serait plus forte encore.

---

## Ce qui a été fait

### 1. Le cadastre complet s'affiche (fait précédemment, commit `01d4cbb`)

Relais des tuiles vectorielles du **Plan Cadastral Informatisé** de l'IGN
(`/api/carte/cadastre/{z}/{x}/{y}.pbf`), dessiné **sous** la couche qualifiée. Chaque parcelle de France
apparaît dès le zoom cadastral ; celles que nous avons étudiées gardent leur couleur de score.

Vérifié sur cinq régions, par `apps/api/scripts/verifier-relais-cadastre.ts` :

| Lieu | Tuile | Statut | Octets |
|---|---|---|---|
| Beauce (28) | 16/33093/22738 | 200 | 3 665 |
| Finistère (29) | 16/31418/22770 | 200 | 5 952 |
| Vaucluse (84) | 16/34206/23695 | 200 | 5 016 |
| Bas-Rhin (67) | 16/34151/22617 | 200 | 12 697 |
| Haute-Garonne (31) | 16/33030/23931 | 200 | 43 813 |
| Pleine mer | 16/31875/22808 | **204** | 0 |
| Vue large (zoom 8) | 8/129/88 | **204** | 0 |

Le relais a une destination **fixe** : aucun paramètre du client n'entre dans l'URL amont, il ne peut
donc pas devenir un proxy ouvert.

### 2. La recherche par identifiant interroge le cadastre

`parcelleDesignee` remplace la lecture unique en base. **Quatre issues, et elles se disent
différemment** — c'est le point :

| Situation | Réponse |
|---|---|
| connue en base | position et emprise réelles |
| inconnue en base, présente au cadastre | position et emprise réelles, mention « à qualifier » |
| **absente du cadastre** | **aucun résultat** — l'identifiant ne désigne rien |
| **cadastre injoignable** | un résultat **sans position**, qui dit que la source n'a pas répondu |

Et une garantie transversale : **une recherche n'écrit rien en base**. Le défaut B4 de l'audit 10 était
précisément un chemin de lecture qui déclenchait des écritures.

Au passage, un mensonge de type supprimé : `centroide` valait `[0, 0]` — le golfe de Guinée — quand la
position était inconnue, et **les deux moitiés de l'application** comparaient à ce sentinelle. Le champ
est désormais `[number, number] | null`, et le compilateur oblige chaque lecteur à traiter le cas.

Une règle de domaine dédoublée a aussi été unifiée : la composition d'un identifiant cadastral existait
**à trois endroits**, dont deux versions fautives — l'une sans normalisation (une section « A » au lieu
de « 0A » produisait un identifiant de **treize** caractères, qui ne correspond à aucune parcelle),
l'autre avec un préfixe `000` **écrit en dur** (faux pour une commune fusionnée, où le préfixe désigne la
commune absorbée). `composerIdu` vit maintenant dans `@enr/core`, partagée par l'API et l'interface.

### 3. Cliquer une parcelle du cadastre la qualifie

Le chemin serveur existait (`POST /api/qualification/parcelles`, **sans** filtre de surface ni plafond)
et **n'était appelé par personne**. Il manquait la désignation.

L'identifiant de la parcelle cliquée est tiré des attributs de la tuile, **relevés sur une tuile réelle**
et non supposés — la couche `parcelle` du PCI sert `code_arr, code_com, code_dep, code_insee, com_abs,
contenance, feuille, fid, gid, idu, nom_com, numero, section` (tuile 16/33093/22738, 13/08/2026). La liste
est figée dans `apps/api/test/fixtures/proprietes-sources.json` et surveillée par `contrats-sources` :
lire un attribut inexistant ne lève aucune erreur et rend la valeur nulle **pour toujours**, c'est la
famille de défauts de l'audit 6.

Trois décisions, testées : ignorer le clic quand une parcelle **déjà qualifiée** est sous le curseur
(MapLibre notifie les deux couches, sans ce départ une consultation relancerait une qualification),
ignorer quand un **outil de dessin** est actif, et **refuser en le disant** quand la tuile n'identifie pas
la parcelle.

### 4. Les trois troncatures silencieuses sont affichées

| Troncature | Avant | Maintenant |
|---|---|---|
| Filtre de surface | silencieux | annoncé **avant** de lancer (nombre estimé + seuil en hectares), puis compté dans le compte rendu |
| Plafond de lot | `slice(0, 1500)` muet | secteurs non interrogés comptés, parcelles retenues mais non qualifiées comptées |
| Cellules en échec | `journal.warn` seulement | comptées et remontées à l'écran |

La phrase est composée **par le serveur** (`avertissementCouverture`), qui seul sait ce qui a été tronqué,
et elle **dit quoi faire** : cliquer la parcelle sur le cadastre, ou la chercher par sa référence. Une
couverture complète ne produit **aucun** avertissement — un bandeau affiché à chaque campagne serait
ignoré dans le mois, et le vrai cas passerait alors inaperçu.

La couverture est publiée **dès la fin de la phase de récupération**, pas à la fin de la campagne : une
campagne dure des dizaines de minutes, et l'apprendre à la fin ne servirait plus à rien.

---

## Les deux défauts que ce chantier a trouvés dans l'outillage

Aucun des deux n'est lié au signalement. Tous deux ont été trouvés en **vérifiant** ce chantier, et le
second cassait la CI.

### A. Un test qui échouait pour une raison étrangère à ce qu'il vérifie

`apps/api/test/reprise-couverture-reseaux.test.ts` lisait son fichier de migration **derrière** la garde
`DATABASE_URL`, alors que la vérification de cohésion qu'il en tire n'a besoin d'aucune base. Sans cette
variable — cas d'une machine où la base est joignable par l'URL par défaut de `config.ts` — ce fichier
était **le seul de la suite à échouer**. Lecture sortie de la garde.

### B. Une garde dont la portée dépendait de la machine — et le job de mutation de la CI échouait

C'est le défaut sérieux. `apps/api/test/rapport-pdf.test.ts` choisissait ses parcelles **par une
requête** : « la plus grande parcelle qualifiée dans chaque filière ». L'intention était juste — ne jamais
écrire un identifiant en dur, travailler sur de la donnée réelle — mais sa conséquence ne l'était pas.

| Base | Filières couvertes | Parcelle écartée | Les 2 mutations correspondantes |
|---|---|---|---|
| ma base de développement | 4/4 | 1 | **attrapées** |
| base semée pour les tests de bout en bout | 1/4 | 0 | **non attrapées** |
| base vierge fraîchement migrée — **celle de la CI** | 0/4 | 0 | **non attrapées** |

Sur base vierge, le fichier s'ignorait en entier ; les mutations qui rétablissent « Occupation du sol :
`agricole_exploite` » et « Fondement : `eol_distance_habitation` » — deux défauts d'un document remis à un
propriétaire — passaient donc sans être vues, et `scripts/mutation.mjs` signalait à juste titre deux tests
décoratifs. **Le job de mutation de la CI échouait depuis le commit `562c20f`.**

Le test annonçait pourtant sa portée réduite sur la sortie d'erreur — c'est ce qui a permis de comprendre.
Mais **annoncer ne suffit pas quand la portée tombe à zéro** : une garde qui disparaît sans rien faire
échouer ne garde rien.

Corrigé en deux temps : les cas sont désormais **semés** depuis les fixtures capturées (donnée réelle,
géométries comprises, réidentifiée vers le département fictif 99 pour ne jamais écrire sur une parcelle
véritable), et la portée est **exigée** par un test — les quatre filières, et au moins une parcelle
écartée. Vérifié : sur base entièrement vide, 4/4 filières couvertes et les deux mutations attrapées.

L'insertion, écrite deux fois (ce test et `scripts/semer-e2e.ts`), vit maintenant à un seul endroit :
`apps/api/test/aides/semer-fiches.ts`.

---

## Vérification

Tout ce qui suit a été **exécuté**, pas relu.

Toutes les exécutions ci-dessous ont eu lieu sur une base **vierge fraîchement migrée** — celle qui
reproduit la CI — et non sur ma base de développement. C'est ce qui a révélé le défaut B.

| Contrôle | Résultat |
|---|---|
| `npm run build` (4 espaces) | 0 erreur |
| `npm test`, base vierge, `AMORCAGE_AUTO=false` | **650 tests, 0 échec**, 4 ignorés |
| les 4 ignorés (destructifs) avec `TESTS_MIGRATIONS=1` | **4/4** |
| `scripts/mutation.mjs` en entier, base vierge | **55/55 attrapées** |
| les 3 mutations à navigateur (`--avec-e2e`) | **3/3 attrapées** |
| Tests de bout en bout, navigateur réel | **15/15** |
| Relais cadastral, 5 régions + mer + zoom large | 5 tuiles servies, 2 × 204 |
| Attributs de la tuile PCI, décodés sur une tuile réelle | 13 champs relevés, figés en fixture |

Tests ajoutés : **5 fichiers, 32 tests**, et 14 mutations nouvelles.

| Fichier | Tests | Ce qu'il est seul à prouver |
|---|---|---|
| `apps/api/test/recherche-parcelle-inconnue.test.ts` | 5 | les quatre issues d'une recherche par identifiant, et l'absence d'écriture |
| `apps/api/test/couverture-campagne.test.ts` | 8 | les trois troncatures comptées, et la phrase qui les dit |
| `apps/web/test/clic-cadastre.test.ts` | 6 | les trois décisions d'un clic sur le cadastre |
| `packages/core/test/composer-idu.test.ts` | 11 | la composition d'un identifiant, y compris les cas qui font échouer les versions naïves |
| `apps/web/e2e/cadastre.spec.ts` | 2 | que le navigateur **demande réellement** les tuiles du cadastre, et pas en vue nationale |

### Une intermittence observée, et corrigée

`e2e/accueil.spec.ts` a échoué **une fois** pendant cette vérification — pendant que deux suites
tournaient en concurrence et que le relais IGN accumulait des délais de connexion — puis repassé seule.
La cause : la promesse « une touche abrège l'animation » était prouvée par un budget de **1 500 ms**, à
comparer aux 2 000 ms de l'animation, soit 500 ms de marge.

Une intermittence est le pire défaut d'un parc de tests de bout en bout : elle apprend à ignorer les
échecs. Et allonger le budget aurait affaibli ce que le test prouve. La démonstration a donc été
**scindée** : un témoin établit que l'écran est encore là 400 ms après l'ouverture — une assertion que la
lenteur ne peut que **renforcer** — et le test de la touche attend alors largement, sans rien perdre de sa
force.

Les deux tests d'API qui simulent une source le font en remplaçant `fetch`, avec des réponses
**construites depuis la réponse réelle capturée** : les noms de champs viennent donc de la source. Aucun
appel réseau n'est fait par la suite de tests.

---

## Ce qui reste non couvert, et qu'il faut dire

- **Le rendu du clic**, de bout en bout : qu'une qualification part réellement et que la fiche s'ouvre
  demanderait un navigateur, une carte rendue **et** des tuiles cadastrales servies par l'IGN — donc du
  réseau, ce que la suite s'interdit. La décision est testée, le câblage est vérifié par un contrôle
  structurel, le reste ne l'est pas.
- **Le seuil de 3 000 m² lui-même** reste la valeur par défaut. Il n'est plus silencieux, et une parcelle
  précise est toujours atteignable par le clic ou la recherche ; mais le bon seuil pour une région donnée
  est un choix métier, pas une décision de code. `QUALIF_SURFACE_MIN_M2=0` le supprime.
- **La part de parcellaire écartée hors Beauce** n'est pas mesurée. Trois communes d'une même région ne
  font pas une statistique nationale.
