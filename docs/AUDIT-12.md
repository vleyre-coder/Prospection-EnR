# Audit 12 — l'interface était laide, et le français y était écrit de deux façons

> **Demande.** « Esthétiquement ce n'est pas très joli et pratique d'utilisation, peux-tu faire
> quelque chose tout en restant précis et exhaustif ». Ce document rend compte de ce qui a été
> changé, de ce qui a été mesuré, et de ce qui reste — sans arrondir.

## 0. Le fait le plus important de cet audit

**J'ai cassé l'intégration continue en corrigeant l'orthographe, et mon propre outil ne pouvait
pas le voir.**

La passe d'accentuation réécrit le texte à l'intérieur des littéraux de chaîne. Mon découpage
code / commentaire / chaîne connaît trois sortes de littéraux : `'`, `"` et l'accent grave. Un
**littéral d'expression régulière** n'en fait pas partie. Les messages ont donc été accentués
sans que les motifs qui les cherchent le soient :

| Où | Motif | Message devenu |
| --- | --- | --- |
| `apps/api/test/migrations.test.ts` | `/Adoption refusee/` | « Adoption refusée » |
| `apps/web/e2e/accueil.spec.ts` | `/Chargement du referentiel/i` | « Chargement du référentiel » |
| `packages/scoring/test/moteur.test.ts` | `/ECONOMIQUE et non reglementaire/` | « ÉCONOMIQUE et non réglementaire » |
| `packages/scoring/test/moteur.test.ts` | `/scenario derogatoire/` | « scénario dérogatoire » |
| `packages/scoring/test/moteur.test.ts` | `/5,7 km de trace estime/` | « 5,7 km de tracé estimé » |
| `packages/scoring/test/moteur.test.ts` | `/gisement\|debouche/` | « Débouché du digestat » |
| `apps/api/test/rapport-pdf.test.ts` | `/redhibitoire/i` | « Critères rédhibitoires » |
| `apps/api/test/exports.test.ts` | `'Ecartee reglementairement'` | en-tête CSV accentué |
| `apps/web/e2e/{aides,connexion.setup,portail}.ts` | `getByLabel('Adresse electronique')` | « Adresse électronique » |

Le typage ne pouvait rien dire — les deux côtés restent des chaînes valides. Et **cinq de ces huit
tests ne tournent pas dans un `npm test` ordinaire** : l'un exige `TESTS_MIGRATIONS=1` sur une base
jetable, un autre un navigateur, quatre une base de données. Seule la CI les exerce tous. C'est la
leçon de l'audit 11 qui se vérifie : la CI est le seul banc d'essai qui ne mente pas.

**Le balayage a ensuite porté sur la famille entière**, avec le compilateur TypeScript et non une
expression régulière : `SyntaxKind.RegularExpressionLiteral` sur tous les fichiers de test. Neuf
autres motifs contiennent encore une forme non accentuée, et **les neuf sont justes** — ils visent
des chaînes qui ne sont pas accentuées non plus, dont `origine_donnee` (colonne d'un CSV de
versement) et `purger_donnees_nominatives` (fonction SQL). Les accentuer casserait le code.

---

## 1. Ce que « exhaustif » veut dire pour des accents, et comment on le mesure

La question n'est pas *quels mots sont mal orthographiés* — c'est **quels mots l'utilisateur
voit**. Un littéral de chaîne peut être une phrase, un nom de colonne SQL, une valeur
d'énumération, un identifiant de couche WFS ou une classe CSS, et **la forme d'un mot court ne
permet pas de les distinguer**. Trois méthodes ont été essayées.

### 1.1 Le dictionnaire — rejeté, et la raison est instructive

`hunspell` est disponible (`/usr/share/hunspell/fr.dic`, 80 950 formes). Mais un `.dic` ne
contient que des **lemmes** : « évalué », « estimé », « tracé » n'y figurent pas, ils sont produits
par les règles d'affixes du `.aff`. Un garde fondé sur le dictionnaire laisse donc passer
précisément les participes — la majorité des cas réels.

Le vérificateur complet (`spylls`, réimplémentation de hunspell) applique bien les affixes, mais
`suggest()` sur 948 jetons n'a pas abouti en dix minutes ; la mesure a été abandonnée.

Et là où le dictionnaire répond, il se trompe : sur les 36 mots qu'il a déclarés « certains »,
il proposait `mais → maïs`, `votre → vôtre`, `longue → longué`, `interroge → interrogé`. Trois
faux positifs sur dix.

### 1.2 Le texte réellement affiché — retenu comme mesure

Un relevé a été fait en pilotant un vrai navigateur sur huit vues (connexion, carte, recherche,
fiche, fiche dépliée, liste, tableau de bord, panneau de calques), en lisant
`document.body.innerText` **et** les attributs `title` / `aria-label` / `placeholder` / `alt` :
108 220 caractères.

**Résultat : 56 mots non accentués étaient à l'écran**, principalement dans la fiche parcelle, les
libellés de critères et les textes réglementaires. 429 occurrences leur correspondent dans les
sources ; 85 ont pu être rattachées à un fragment retrouvé mot pour mot dans le DOM.

Un piège a été trouvé au passage, et il valait la mesure : **le premier relevé donnait exactement
le même nombre d'octets après correction**. La fiche ne lit pas le code — elle lit un *snapshot*
stocké en base par le semis. Il a fallu re-semer pour mesurer le texte que le code produit
vraiment. Une mesure qui ne bouge pas quand on change le code ne mesure pas le code.

### 1.3 La cohérence interne — retenue comme règle

La règle qui a permis de finir n'a besoin d'aucune autorité extérieure :

> **Si « filière » est écrit dans un libellé affiché, alors « filiere » dans un autre libellé
> affiché est une incohérence** — quelle que soit l'orthographe « correcte ».

Le dépôt est sa propre référence. La règle se met à jour toute seule dès qu'un mot accentué
apparaît, et elle ne dit jamais rien d'un mot dont une seule graphie existe. Mesure initiale :
**139 occurrences, 60 mots**, dans le texte affiché.

---

## 2. Ce qui a été corrigé, et ce que la relecture a arrêté

| Passe | Occurrences | Refusées à la relecture |
| --- | --- | --- |
| Mots vus à l'écran (§1.2) | 256 | 8 |
| Même mot écrit deux fois (§1.3) | 128 | 11 |
| Queue de mots sans équivalent accentué | 167 | 1 |
| La préposition `à`, écrite `a` (§2.1) | 113 | 47 |
| **Total** | **664** | **67** |

**Les vingt refus sont la partie utile de ce tableau.** Chacun est un endroit où la forme sans
accent est juste, et où une passe automatique aurait cassé quelque chose :

- `?filiere=` — nom d'un paramètre de requête dans six URL de tuiles ;
- `'agrivoltaisme'` — **valeur d'énumération**, comparée par `===` dans le moteur et exportée dans
  la colonne `regime_implantation` du CSV. Elle avait franchi un premier filtre parce que mon test
  « ce littéral n'est-il qu'un identifiant ? » portait sur le littéral **apostrophes comprises** :
  `'agrivoltaisme'` échoue le test à cause des guillemets et passait donc pour du texte ;
- `carte-ko derogeable` — **liste de classes CSS**, attrapée sur une relecture à blanc une ligne
  avant d'être appliquée. `.carte-ko.derogeable` est une règle du fichier de style ;
- `acces.distanceVoirieM` — chemin de champ ; `./components/Demarrage.js` — chemin d'import ;
- des **verbes** : « prive le projet du portage politique », « le calcul normalise dans [0, 360[ »,
  « l'avancement s'affiche en bas de la carte », « conformité à une **norme** » (le nom, pas le
  participe) ;
- une **flexion** que la machine ne pouvait pas deviner : « réellement presentes » est un féminin
  pluriel — « présentes » — alors que la seule graphie accentuée présente ailleurs dans le dépôt
  était « présentés ».

Trois erreurs de la passe **précédente** ont aussi été trouvées et corrigées : le verbe *relever*
écrit « relevé » au lieu de « relève » (« la décision relevé de l'autorité environnementale »,
« la rubrique 2781-2 relevé de l'autorisation », « l'unité relevé du règlement sanitaire »).

### 2.1 La préposition `à`, et pourquoi c'était la faute la plus visible

Les passes ci-dessus ne portent que sur des mots de trois lettres ou plus. Or le texte affiché
comptait **157 « a » isolés contre 115 « à »** — « aide a la décision », « a vérifier », « Accès
poids lourds a créer », « ICPE a proximité ». Pour un lecteur français c'est la faute qui saute
le plus aux yeux, et c'était la moitié des prépositions du produit.

**Deux familles ont été écartées mécaniquement, et la première aurait fait des dégâts :**

- **23 « a » qui ne sont pas des mots** : `#16a34a`, `#0f172a`, `#a16207` (couleurs) et
  `M3 8h11a3 3 0 1 0-3-3`, `M4 20V13a8 8 0 0 1 16 0v7Z` (tracés SVG des icônes). Le motif
  « un `a` isolé » les attrape tous, parce que les chiffres ne sont pas des lettres. Règle
  retenue : un `a` collé à un chiffre, ou précédé d'un `#`, n'est jamais la préposition ;
- **5 locutions latines** : `a fortiori`, `a minima`, qui ne s'accentuent pas en français.

**19 restent le verbe *avoir*** — « le seuil a été relevé », « qui a refondé le régime », « la loi
APER a par ailleurs ouvert ». Aucune règle sûre ne les distingue de la préposition ; ils sont
nommés un par un par leur contexte. Une heuristique fondée sur le sujet grammatical en avait
trouvé 12 sur 19 : elle a servi à trier la relecture, pas à décider.

Deux pièges de plus, trouvés à la relecture : `n&apos;a` — l'entité HTML fait que le `a` n'est plus
précédé d'une apostrophe, donc le verbe passait pour une préposition ; et `jusqu'a`, exclu par la
même règle d'apostrophe alors qu'il fallait bien `jusqu'à` (trois occurrences, corrigées à part).

---

## 3. Deux valeurs d'énumération s'affichaient telles quelles, et le libellé existait en triple

Relevé sur une capture de la vue Liste : la colonne « Nature du sol » affichait `artificialise` et
`agricole exploite` — la valeur d'énumération, dont on avait seulement remplacé les soulignés par
des espaces. La fiche faisait de même : « Type de sol retenu : agricole_exploite », souligné
compris.

**Et la table de libellés existait déjà — deux fois.** `LIBELLES_TYPE_SOL` vivait dans
`@enr/scoring`, d'où un audit précédent l'avait tirée pour réparer exactement ce défaut dans le
rapport PDF, en écrivant dans son commentaire : « un libellé est une décision de vocabulaire ; il
ne doit exister qu'à un seul endroit ». Le panneau de filtres en gardait pourtant une **troisième**
copie, plus courte.

La cause mécanique de la copie est simple : **`@enr/web` ne dépend pas de `@enr/scoring`**. La
table a donc été déplacée dans `@enr/core`, que tout le monde importe, avec deux longueurs — une
pastille de filtre ne peut pas porter « Terrain dégradé (ancienne carrière, friche, décharge…) »,
une fiche et un PDF ont la place de l'écrire. Quatre appelants, un vocabulaire.

---

## 4. Le garde, et la preuve qu'il n'est pas décoratif

`apps/web/test/orthographe-affichee.test.ts` applique la règle du §1.3 sur 27 modules d'affichage
(le glob des composants web se met à jour tout seul) avec quatre règles mécaniques qui écartent le
code du texte — littéral identifiant, mot collé à un `_` ou un `-`, fragment de SQL, valeur de
`className` — et neuf exceptions nommées avec leur raison.

Trois tests le rendent difficile à contourner : une exception qui ne correspond plus à rien fait
échouer la suite (une liste d'exceptions qui ne se vide jamais finit par autoriser n'importe quoi),
une exception ne peut pas couvrir silencieusement plus d'occurrences qu'annoncé, et les quatre
règles mécaniques sont elles-mêmes testées.

**Quatre mutations le vérifient, toutes attrapées** — dont celle qui reproduit le défaut réellement
commis :

| Mutation | Attrapée |
| --- | --- |
| un libellé affiché perd son accent alors que le même mot reste accentué ailleurs | oui |
| la règle qui distingue une valeur de `className` du texte affiché est levée | oui |
| la règle qui écarte les littéraux identifiants est levée | oui |
| les délimiteurs ne sont plus retirés avant le test d'identifiant | oui |

Il a payé sa place le jour même : le déplacement de la table du §3 écrivait « carrière » dans
`@enr/core` alors que `packages/scoring/src/index.ts` gardait « carriere ». Le garde l'a signalé
avant la livraison.

### Un second garde, celui-là restreint aux sélecteurs

La même passe a cassé la connexion de bout en bout : `getByLabel('Adresse electronique')` cherchait
un libellé devenu « Adresse électronique ». Un seul test échouait — celui qui ouvre la session —
et **les vingt autres n'ont pas tourné**, puisqu'ils en dépendent.

Un sélecteur `getByLabel` / `getByText` / `getByPlaceholder` cherche **du texte affiché, par
définition**. La règle du §1.3 y est donc sans bruit, et la mesure le confirme : **trois
signalements, trois vrais**, tous le même libellé. Le garde est livré.

### Un garde qui a été écrit puis jeté

La même règle appliquée aux **littéraux d'expression régulière** des tests — la famille du §0, qui
a coûté quatre CI rouges — a été mesurée : 22 signalements, dont environ dix-huit faux positifs
(`sur` contre `sûr`, des motifs qui visent du code source ou des clefs JSON, des suffixes
d'identifiants). Un garde qui crie au loup une fois sur cinq apprend à l'équipe à l'ignorer. Il
n'a pas été livré, et la protection de cette famille reste ce qu'elle est : **ces tests tournent en
CI**, ce qui est justement ce qui les a fait voir.

---

## 5. Ergonomie : quatre points, mesurés

1. **Les deux avertissements du §12** ne s'empilent plus sur toute la largeur. Ils doivent rester
   affichés en entier — l'audit 8 les désigne comme « la seule protection du lecteur » contre deux
   défauts connus du référentiel — donc la seule variable est le nombre de lignes. Hauteurs
   mesurées au navigateur (`offsetHeight`), pas estimées à l'œil :

   | largeur | `auto-fit` | deux colonnes | empilé |
   | --- | --- | --- | --- |
   | 1 600 | 88 px | 88 px | 102 px |
   | 1 280 | 106 px | 106 px | 102 px |
   | 1 200 | — | 106 px | 138 px |
   | 900 | 160 px | 138 px | 138 px |

   Première version : `repeat(auto-fit, minmax(340px, 1fr))` — **mauvaise**, et j'avais annoncé un
   gain de « 130 px → 85 px » sans l'avoir mesuré. `auto-fit` découpe autant de pistes que la
   largeur le permet : quatre pistes de 400 px sur un écran de 1 600 alors qu'il n'y a que deux
   avertissements, chacun se repliant sur cinq lignes. Deux colonnes franches au-delà de 1 200 px
   gagnent 14 px au-delà de 1 400 et 32 px entre 1 200 et 1 280, et **perdent 4 px** dans la bande
   1 280–1 400. Ce solde est accepté. Conclusion honnête : ce bloc ne peut pas beaucoup maigrir.
2. **Le score de la vue Liste** porte une jauge de la couleur de son statut, sous le nombre : la
   colonne se lit d'un coup d'œil au lieu d'exiger la comparaison de deux entiers.
3. **Le panneau de filtres disparaît en vue « Tableau de bord »**, où il ne filtrait rien.
4. **« Se déconnecter »** est séparé des bascules d'affichage par un filet, et son `title` rappelle
   qui est connecté et avec quel rôle — il était collé à « Sombre », donc cliquable par erreur.

---

## 6. Ce qui reste, et que je ne masque pas

- **La queue orthographique.** Environ **1 000 mots distincts** du texte affiché restent sans
  accent alors qu'ils sont inconnus du dictionnaire. La grande majorité sont **justes** (« des »,
  « pour », « parcelles » — le `.dic` ne contient que des lemmes) ou sont des identifiants
  (`button`, `flex`, `legiarti`, `distanceVoirieM`). Une minorité sont de vrais manques :
  `evalue`, `estime`, `identifie`, `sature`, `calcule`, `ingere`, `rapproche`, `designe`, `cree`.
  Ils ne déclenchent pas le garde du §4 parce qu'**aucune autre graphie n'existe** — le texte est
  uniformément nu, donc cohérent. Les traiter demande une relecture humaine mot par mot : la forme
  d'un mot court ne dit pas s'il est un verbe, un participe ou une clef, et trois heuristiques
  successives ont chacune cassé du code avant d'être abandonnées.
- **Le texte affiché n'est relevé que sur une parcelle et huit vues.** Les écrans d'erreur, les
  campagnes de qualification en cours, les états de chargement et les autres filières n'y sont pas
  passés. Le garde du §4, lui, est statique et couvre les 27 modules en entier.
- **Rien n'a été fait sur la disposition générale.** La demande parlait d'esthétique et de
  praticité ; ce qui a été livré est du texte lisible et quatre points d'ergonomie. Une refonte de
  la mise en page (densité de la fiche, hiérarchie des sections, navigation entre parcelles) n'a
  pas été entreprise et reste à décider.
- **Une colonne du CSV change de nom.** `Ecartee reglementairement` devient
  `Écartée réglementairement`. Si quelqu'un a un tableur ou un script qui vise cet en-tête au
  caractère près, il casse. Les quatorze autres colonnes ne bougent pas, et la plupart étaient
  déjà accentuées (`Numéro`, `Tracé estimé poste source (km)`) : c'était la seule qui détonnait.
  Le choix est assumé, mais il devait être dit et non découvert.
- **Les fixtures de rendu précèdent plusieurs audits**, et c'est une découverte de cet audit, pas
  une de ses corrections. `apps/web/test/fixtures/fiche-*.json` contient un `snapshot` (la donnée
  réelle, toujours valable) **et** un `score` figé, capturé il y a plusieurs itérations. Recalculé
  avec le moteur d'aujourd'hui, ce score garde ses valeurs (68,2 reste 68,2, les statuts ne
  bougent pas) mais gagne 4 000 caractères : un `regleLiee` passe de `null` à `commun_zone_n`, des
  `seuilsProcedure` manquants apparaissent (le défrichement). Autrement dit **les tests de rendu
  exercent un produit qui n'existe plus**, et le semis de bout en bout affiche à l'écran le texte
  non accentué de ces fixtures — ce que montrent les captures de cette livraison, alors que le
  moteur, lui, produit le texte corrigé. Les regénérer changerait la donnée d'entrée de trois
  fichiers de test : c'est une décision à part, qui doit s'accompagner d'une relecture de ce que
  ces tests affirment. Elle n'a pas été prise ici.
- **Une correction de texte invalide tous les scores stockés.** Mesuré : `VERSION_MOTEUR` passe de
  `1.4.0+c8ab3e7c` à `1.4.0+8d10d0f8`. L'empreinte couvre `REGLES_PAR_ID`, dont les libellés ont
  été accentués — donc `invaliderVersionsAnterieures` va purger la table des scores et tout
  recalculer. C'est **voulu** : l'empreinte automatique a été préférée à une incrémentation
  manuelle par un audit précédent, précisément parce qu'on oublie d'incrémenter. Mais il faut le
  savoir avant de livrer sur une base peuplée : le coût d'un re-calcul complet est le prix d'une
  correction purement cosmétique. Le bon côté est qu'il n'y a rien à faire pour que le texte
  corrigé atteigne les utilisateurs.
- **Hérité et toujours ouvert** : l'ingestion nationale réelle pour produire l'amorce livrable ;
  les 23 règles marquées `aValiderParJuriste` ; le double-clic Windows, invérifiable depuis Linux.

---

## 7. État mesuré à la fin de l'audit

| Vérification | Résultat |
| --- | --- |
| Construction, typage | propres |
| `@enr/core` | 57 / 57 |
| `@enr/scoring` | 67 / 67 |
| `@enr/api` | 471 passent, 0 échec, 8 ignorés |
| `@enr/web` | 131 / 131 (125 avant, +6 pour les gardes du §4) |
| Lot sérialisé sur base fraîche (`test:base`) | 76 passent, 0 échec, 4 ignorés |
| `migrations.test.ts` avec `TESTS_MIGRATIONS=1` sur base jetable | 4 / 4 (3 / 4 avant) |
| Bout en bout, Chromium réel, base semée | 19 passent, 2 ignorés |
| Campagne de mutation, avec base de données | **105 / 105** |
| Mots du texte affiché écrits de deux façons | **0**, hors 13 occurrences relues et nommées |
| Sélecteurs cherchant un texte que l'interface n'écrit plus | **0** |

Une remarque sur la campagne de mutation, parce qu'elle a failli me faire annoncer un faux
résultat : lancée **sans** `DATABASE_URL`, elle rend `85 / 105`. Les vingt « échecs » sont des
mutations dont les tests s'ignorent faute de base — ils ne prouvent rien du code. Avec la base,
c'est 105 / 105. C'est la même leçon que l'audit 11 : un banc d'essai incomplet ne donne pas un
résultat partiel, il donne un résultat faux.
