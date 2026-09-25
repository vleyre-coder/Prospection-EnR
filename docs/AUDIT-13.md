# Audit 13 — repasser l'application en entier : ce qui marche, ce qui ne marche pas

> **Demande.** « Je veux que tu me fasses un audit pour repasser en complet l'application, voir les
> défauts, ce qui fonctionne, ce qui ne fonctionne pas, afin que l'application soit parfaitement
> opérationnelle. Et repérer également des axes d'amélioration si nécessaire. Ou pas. »

Ce document rend compte de ce qui a été **mesuré**, de ce qui a été **corrigé**, et de ce qui
**reste**. Les chiffres viennent tous d'une exécution, jamais d'une estimation.

> **Ce document a été remesuré le 25/09/2026**, et deux de ses affirmations sont tombées. Les
> sections concernées portent la date de leur mesure ; §5 et §7.1 ont été réécrites. Le plus utile
> de ce qu'on y lit n'a pas été trouvé en relisant du code, mais **en refusant de recopier un
> chiffre déjà publié** : c'est en voulant refaire la mesure de §5 que deux défauts silencieux —
> un rescoring qui ne reprenait jamais une filière manquante, une capacité d'accueil ingérée mais
> illisible — sont apparus. Une section d'audit qu'on ne remesure jamais devient, en quelques
> semaines, une source d'erreurs aussi sûre qu'un commentaire périmé, avec l'autorité d'un
> document en plus.

---

## 0. Les trois faits les plus importants de cet audit

**1. La suite de bout en bout n'avait jamais été jouée dans ce dépôt.** Elle existait, elle était
écrite, elle était complète — et rien ne l'avait exercée. Jouée pour la première fois, elle a rendu
**26 succès et un échec**, et cet échec était un vrai défaut d'ergonomie introduit avec la cinquième
filière : le mot « Agrivoltaïsme » désignait **deux commandes différentes au même écran**.

**2. L'outil qui cherche les fautes d'orthographe était en panne, et en panne silencieuse.**
`scripts/orthographe-dictionnaire.mjs` prenait les apostrophes des commentaires français de sa
propre liste de modules pour des chemins de fichiers, et mourait sur un `ENOENT` **après** avoir
affiché une sortie qui ressemblait à un succès. Un outil de recherche en panne ne rend pas d'erreur
utile : **il rend zéro faute**, ce qui se lit comme « rien à corriger ». Il y avait 41 fautes dans
son périmètre.

**3. `couverture_ingestion` annonçait 2 830 postes sources sur 101 départements pendant que la
table `poste_source` était vide** — et rien, nulle part, ne comparait les deux. C'est la table sur
laquelle le moteur s'appuie pour distinguer « aucune contrainte trouvée ici » de « on n'a rien
regardé ici ». C'est-à-dire le défaut fondateur de ces treize audits, rouvert par une autre porte.

---

## 1. Ce qui fonctionne — vérifié, pas supposé

| Vérification | Résultat | Comment |
| --- | --- | --- |
| Typage des 5 projets | **vert** | `npm run typecheck` (les 4 espaces de travail + `netlify`) |
| Tests hors base | **1 097 verts, 0 rouge** | `npm test` |
| Tests avec base | **152 verts, 4 ignorés** | `npm run test:base` avec `DATABASE_URL` |
| Tests destructifs de migration | **4 verts** | base jetable + `TESTS_MIGRATIONS=1` |
| Bout en bout | **27 verts, 2 hors suite** | Chromium local + base semée |
| Captures de revue | **3 verts, 9 images** | `E2E_REVUE=1 --grep @revue` |
| Campagne de mutation complète | **297 / 297 attrapés, 0 survivant** | `--avec-e2e`, base semée + Chromium |
| Motifs de bout en bout | **9 joués, 9 attrapés** | jamais joués avant cet audit |

**Les 18 tests « ignorés » sont tous expliqués et tous verts** une fois qu'on leur donne ce qu'ils
demandent : 14 exigent une base de données, 4 sont les tests destructifs de migration, qui
suppriment la table de suivi et refusent donc de tourner sans autorisation explicite. Aucun ne
cachait un échec.

Ce qui fonctionne aussi, et qui mérite d'être nommé parce que c'est le cœur du produit :

- **Le filet de l'outil de mutation a fonctionné pour de vrai.** J'ai interrompu une campagne en
  cours ; le marqueur `.mutation-en-cours` a survécu, un test a refusé de tourner tant qu'il était
  là, et la relance a restauré le fichier muté en l'annonçant. Le contenu enregistré était
  **octet pour octet** identique à ce que `git` avait restauré de son côté.
- **La base porte une clé étrangère `couverture_ingestion.connecteur → source_donnee`.** Une
  couverture ne peut pas décrire une source qui n'existe pas. Trouvée en écrivant un test qui
  essayait de l'enfreindre.
- **Le moteur n'a produit aucun faux vert** sur les 1 505 scores de la base, y compris là où la
  donnée manquait le plus.
- **Les 9 motifs de mutation de bout en bout, jamais joués jusqu'ici, sont tous attrapés.** Ils
  étaient exclus par défaut faute de navigateur, et personne n'avait jamais vérifié que les tests
  qu'ils visent tombent réellement. Ils tombent, les neuf : jeton des tuiles de calque, minuteur de
  l'écran d'ouverture, couche du cadastre complet, bouton du dossier sans sélection, case de
  sélection de ligne, troncature des titres du §12, dépliage du §12, levée de la restriction à
  l'emprise, route des territoires.

---

## 2. Ce qui ne fonctionne pas — et ce qui a été corrigé

### 2.1 « Agrivoltaïsme » désignait deux choses au même écran

Depuis que l'agrivoltaïsme est une **filière**, le mot vivait aussi comme **régime d'implantation**
du solaire au sol, sur une pastille du formulaire de recherche. Un opérateur qui clique la pastille
croit rappeler la filière ; il ne fait que restreindre la nature de sol cherchée.

La pastille est renommée par **ce qu'elle filtre** — « Terrain agricole exploité » — et une note
renvoie à la filière. L'identifiant `agrivoltaisme` du régime **ne bouge pas** : il est stocké,
exporté en CSV et lu par le moteur.

### 2.2 Quarante et une fautes dans du texte réellement affiché

Toutes de la même famille : **un participe passé écrit comme le verbe**, donc un mot français
valide qu'aucun dictionnaire ne refuse. « le projet est situe », « le foncier est destine »,
« aucun risque identifie ».

| Où | Fautes | Exemples |
| --- | --- | --- |
| `apps/api/src/connecteurs/base.ts` | **28** | « Sites classes et inscrits », « la capacite du reseau a l'instant du projet », « elle allege l'instruction » |
| Couperets, critères, règlementation | **9** | « Emplacement réserve », « Site classe », « Espace boisé classe » |
| Fiche parcelle, panneau gauche, carte | **4** | « les critères sont grises », « **Ou** en est votre démarchage », « est bloque depuis ce poste » |

**Le catalogue des connecteurs était hors du périmètre du garde.** C'est la cause principale : ses
champs `nom` et `avertissement` sont servis à l'interface par `sourceRef()` et s'affichent sous
chaque critère de la fiche, dans le panneau des calques, dans le bandeau « État des données » et
dans le dossier PDF. Il est entré au périmètre, ce qui a immédiatement révélé 23 fautes de plus
ailleurs sur les mêmes termes — **et ce sont des termes de droit** : « site classé » (art. L.341-1
C. env.) et « espace boisé classé » (art. L.113-1 C. urb.).

### 2.3 L'axe du tableau de bord affichait « 1, 1, 0 »

Trois graduations figées à 0, la moitié et le maximum, chaque libellé arrondi. Sur un portefeuille
d'**un seul lead**, `Math.round(0.5)` vaut 1 : le même nombre s'affichait à deux hauteurs
différentes, et un point valant 1 se lisait aussi bien au sommet qu'au milieu. **Ce n'est pas un cas
de coin** — c'est l'état du premier jour d'utilisation.

### 2.4 Deux zones d'une même commune se lisaient comme un doublon

Le titre d'une carte de zone est le nom de la **commune**, et une commune en désigne souvent
plusieurs. La liste affichait « Écrosnes (28) » en 2ᵉ position et « Écrosnes (28) » en 8ᵉ, surfaces
différentes, rien pour dire que ce sont deux zones. **Aucun autre champ ne les sépare** :
`nom_commune` est joint depuis la table des communes, donc identique par construction, et le nom
porté par la délibération ne vaut pas mieux — **7 664 zones pour 448 noms distincts**.

### 2.5 Une couverture annoncée sur une table vide — le défaut le plus grave

Mesuré sur la base de bout en bout :

```
couverture_ingestion   postes_geopf / poste_source : 2 830 objets, 101 départements
poste_source           0 ligne
```

`couverture_ingestion` est exactement la table sur laquelle le moteur s'appuie pour séparer « aucune
contrainte trouvée ici » de « on n'a rien regardé ici ». `couchesPresentesDansDepartement()` la lit
pour le patrimoine, `zones.ts` et `potentiel-communal.ts` la lisent aussi. **Une ligne de couverture
qui survit à la disparition de ses données fait dire à l'application « regardé, rien trouvé » — un
feu vert — là où il n'y a rien du tout.**

**Ce qui a sauvé le cas mesuré, et pourquoi cela ne suffisait pas :** le critère
`racc_distance_poste` ne consulte pas la couverture, il répond `indispo` dès qu'aucun poste n'est
trouvé. Les 1 505 scores sont donc justes. Mais la protection tenait à ce qu'un critère ait été
écrit d'une façon plutôt qu'une autre — c'est-à-dire à rien. **Le patrimoine, lui, consulte bel et
bien la couverture.**

`couverturesIncoherentes()` compare désormais chaque couverture à sa cible, et `GET /api/sante` la
rend. Elle ne compare **pas** les comptes, ni département par département : un écart de comptage a
mille raisons légitimes, et un garde qui accuse à tort finit désactivé. Elle ne signale que le cas
sans ambiguïté possible — la couverture annonce des objets, la cible est entièrement vide.

---

## 3. Ce que la campagne de mutation m'a appris sur mes propres correctifs

**Mon premier motif de mutation sur l'axe du tableau de bord a SURVÉCU.** Le test ne tombait pas
quand je cassais la branche des petits comptages, parce qu'un `new Set` rattrapait le doublon
derrière. Vérification faite sur la plage `[4, 100 000]` : **les trois repères sont toujours
distincts dès que le maximum atteint 4**, donc le `Set` ne pouvait servir que dans des cas que la
première branche traitait déjà. **Deux protections dont aucune n'était nécessaire** — exactement le
motif du bloc mort de `verdict.ts` à l'audit précédent. Le `Set` a été retiré, la garantie tient à
une règle écrite, et le motif vise désormais le plancher `Math.max(1, …)`, qui porte le cas du
portefeuille vide.

**Une correction automatique a failli casser l'ingestion.** Ma passe d'accentuation a transformé
`if (t === 'site classe')` en `if (t === 'site classé')` dans `typeSite()` — une comparaison faite
**après** avoir retiré les accents de la valeur source. Le commentaire juste au-dessus explique
pourquoi le littéral doit rester nu. Accenté, il n'aurait plus jamais correspondu : **les 136
« Site classé » de la couche STE auraient été silencieusement écartés à chaque ingestion**, soit
précisément le défaut que ce fichier avait été écrit pour corriger. Rendu à sa graphie nue avant le
commit, et huit commentaires accentués au passage ont été rendus à la convention du dépôt.

---

## 4. Trois mesures qui ont conclu « ne rien changer »

Un audit qui ne produit que des changements est un audit qui n'a pas mesuré.

**Comparaison croisée entre modules pour l'orthographe** — 104 conflits sur 28 mots distincts,
**zéro vraie faute** : uniquement des couples verbe/participe, des chemins de champ
(`bati.distanceHabitationM`) et des paramètres d'URL (`?filiere=`). Le garde reste par module.

**Squelettes portant deux graphies accentuées** — 15 sur 851. Une seule était fautive
(« emplacements réserves » pour « réservés »), et le garde ne peut structurellement pas la voir
puisqu'il oppose « accentué » à « nu », pas deux accentuations entre elles. Corriger la seule
occurrence a coûté moins qu'un garde de plus.

**Balayage hunspell, une fois réparé** — 1 944 mots distincts, 267 refusés, **6 manques d'accent
apparents et tous légitimes** : chemins de champ, nom du paquet `@enr/core`, paramètre de requête
des tuiles, nom de couche WFS `BDTOPO_V3:batiment`.

---

## 5. Ce qui manquait à la donnée — et ce qui a été débloqué depuis

> **Section remesurée le 25/09/2026.** Sa première rédaction annonçait « seize critères jamais
> résolus » et « aucune parcelle ne peut ressortir propice sur trois des cinq filières ». Ces deux
> affirmations sont devenues fausses, et il a fallu deux corrections pour le voir.

### 5.1 Deux défauts trouvés en voulant simplement refaire la mesure

**Le rescoring ne reprenait jamais une filière manquante.** `idusSansScoreCourant` exigeait qu'il
n'existe *aucun* score à la version courante du moteur, toutes filières confondues. Une parcelle
notée sur quatre filières et pas sur la cinquième était donc jugée à jour. Mesuré : 299 parcelles
sur 301 avaient perdu leur score solaire, `rescorerTout` a répondu « nbParcelles: 0 ». Après
correction, la même commande a repris les 299 parcelles et réécrit 1 495 scores. **Le cas qui
compte n'est pas une base d'essai, c'est l'ajout d'une filière** : le jour où l'agrivoltaïsme est
devenu la cinquième, tout le parc portait déjà quatre scores à la version courante, et la nouvelle
filière serait restée vide partout. La panne est silencieuse — une parcelle sans score sort de la
carte et des listes sans erreur ni compteur.

**La capacité d'accueil était ingérée mais illisible.** Les postes viennent de deux sources qui ne
portent pas la même chose : la BD TOPO donne la *position* de tous les postes, Capareseau la
*capacité d'accueil* d'une partie. Les critères `racc_capacite_residuelle` et `racc_quote_part` ne
lisaient que `posteLePlusProche` — presque toujours un poste BD TOPO, sans capacité. Résultat :
gris sur 301 parcelles sur 301, **alors que les 301 portaient un poste alternatif renseigné dans le
même instantané**, à quelques centaines de mètres de plus. La donnée était ingérée, stockée, et à
un champ du critère qui la réclamait.

Les critères lisent désormais le poste renseigné le plus proche — et **le document nomme ce poste**
dès qu'il n'est pas le plus proche : la capacité d'un poste n'est pas celle d'un autre, et une
substitution muette ferait lire, sur la ligne « poste le plus proche » d'un dossier remis à un
tiers, un chiffre qui n'est pas le sien.

### 5.2 Ce que cela change, mesuré sur les 301 parcelles

| Filière | Verdicts avant | Verdicts après | Couverture avant | après |
| --- | --- | --- | --- | --- |
| **BESS** | **301 gris** | **300 orange, 1 rouge** | 78,2 % | **98,3 %** |
| Solaire au sol | 299 orange, 1 gris, 1 rouge | 300 orange, 1 rouge | 85,1 % | **93,2 %** |
| Agrivoltaïsme | 296 orange, 5 gris | 299 orange, 1 gris, 1 rouge | 81,5 % | **88,2 %** |
| Éolien terrestre | 91 gris, 210 rouge | 91 gris, 210 rouge | 68,6 % | **74,6 %** |
| Méthanisation | 216 orange, 85 rouge | 216 orange, 85 rouge | 81,1 % | 81,1 % |

**Aucune donnée nouvelle n'a été ingérée : seule la lecture a changé.** La filière BESS était
entièrement grise à 1,8 point du seuil de couverture, `racc_capacite_residuelle` y pesant 20 % de
la note.

Couverture des critères effectivement résolus, après correction :

| Filière | Résolus / évalués | Couverture |
| --- | --- | --- |
| BESS | 5 116 / 5 719 | **89,5 %** |
| Solaire au sol | 6 608 / 8 729 | **75,7 %** |
| Agrivoltaïsme | 6 313 / 8 424 | **74,9 %** |
| Éolien terrestre | 4 487 / 6 622 | **67,8 %** |
| Méthanisation | 3 012 / 5 117 | **58,9 %** |

### 5.3 Ce qui reste non résolu, et qui demande vraiment une ingestion

**Treize critères** ne sont résolus sur aucune des 301 parcelles — contre seize à la première
rédaction : `racc_distance_poste` l'est désormais sur 301/301 et les cinq filières grâce à
l'ingestion des postes, et `racc_capacite_residuelle` et `racc_quote_part` grâce à la correction
ci-dessus.

| Critère | Filières concernées |
| --- | --- |
| `fonc_nb_proprietaires` | les 5 |
| `pat_monuments` | 4 |
| `env_especes_protegees`, `env_tvb`, `fonc_maitrise`, `pat_sites` | 3 |
| `pat_archeologie` | 2 |
| `dist_captage`, `gis_debouche_epandage`, `gis_intrants`, `gis_vent`, `racc_distance_reseau_gaz`, `risq_karst` | 1 chacun |

**L'application se comporte ici exactement comme elle doit** : elle refuse de déclarer une parcelle
propice tant que la couverture est insuffisante, et elle le dit à l'écran. La méthanisation et
l'éolien restent les deux filières où le manque d'ingestion pèse le plus.

### 5.4 La leçon de méthode

Les deux défauts de 5.1 ne se voyaient dans **aucun test et sur aucun écran**. Ils ont été trouvés
en voulant refaire une mesure déjà publiée, c'est-à-dire en refusant de recopier un chiffre. Une
section d'audit qui n'est jamais remesurée devient, en quelques semaines, une source d'erreurs
aussi sûre qu'un commentaire périmé — avec l'autorité d'un document en plus.

---

## 6. Le référentiel : où en est la couverture

Millésime `2026-09-18`, empreinte du classeur `6c672b8213566b1b`, **292 contraintes**.

| Caractère | Nombre | | Mode d'évaluation | Nombre |
| --- | --- | --- | --- | --- |
| Rédhibitoire | **133** | | `auto_sig` | **196** |
| Pénalisant | **135** | | `verification_manuelle` | **96** |
| Favorable | 11 | | | |
| Cadre (procédure) | 13 | | | |

**91 correspondances** relient le référentiel au moteur — 41 par drapeau, 26 par présence, 24 par
seuil — et couvrent **86 des 268 contraintes qui pèsent au verdict**. Les 182 restantes se
répartissent en 101 `auto_sig` (une couche SIG existe, la correspondance reste à écrire) et 81
`verification_manuelle` (aucune donnée nationale ne les porte : elles resteront un travail humain).

Par faisabilité : 198 relèvent de l'open data national, 28 du départemental ou régional, 29 sont à
créer ou modéliser, 37 sont des critères de projet.

**Relecture juridique** (dossier `docs/RELECTURE-JURIDIQUE.md`) : 128 contraintes citent un article
numéroté, 32 un texte daté, 40 de la doctrine ou un guide — non opposables en soi —, 70 une
référence à préciser, et **22 n'en citent aucune**. Rappel mesuré à l'audit précédent, qui vaut
toujours : **aucune des contraintes sans référence n'a jamais été décisive** dans un verdict
défavorable, et la raison `aucun_fondement_cite` rend cette protection explicite plutôt
qu'accidentelle.

---

## 7. Axes d'amélioration

Classés par rapport valeur / risque, et **aucun n'est engagé** — ce sont des propositions.

### 7.1 Ingérer les couches qui manquent — toujours le premier levier, mais pas le seul

> **Remesuré le 25/09/2026.** Le point 1 est **fait**, et il a révélé que l'ingestion n'était que
> la moitié du travail : voir §5.1. La donnée de capacité était ingérée depuis plusieurs jours et
> restait illisible pour le moteur, faute d'être cherchée au bon endroit. **Avant de conclure
> qu'une couche manque, il vaut la peine de vérifier qu'elle n'est pas déjà là.**

Restent deux ingestions, et c'est bien le premier levier sur les critères qu'elles portent :

1. ~~**Postes sources**~~ — fait. `racc_distance_poste` est résolu sur 301/301 et les cinq
   filières ; `racc_capacite_residuelle` et `racc_quote_part` l'ont été par la correction de
   lecture décrite en §5.1, sans aucune ingestion supplémentaire.
2. **Patrimoine** (`pat_sites`, `pat_monuments`, `pat_archeologie`) — l'ingestion WFS nationale
   existe et fonctionne ; elle n'a pas été passée sur le département 28. **Mesuré le 25/09 : la
   table `contrainte` est entièrement vide**, et le connecteur `patrimoine_culture` figure donc
   « en échec » sur les 301 parcelles. Ce n'est pas une panne : c'est une couche jamais ingérée,
   et le rapport le dit désormais en ces termes (§7.7).
3. **INPN / trame verte et bleue** (`env_especes_protegees`, `env_tvb`) — 16 correspondances en
   attente d'après le relevé de l'audit précédent.

### 7.2 Une colonne toujours vide devrait le dire

« Tracé estimé » est vide sur les 301 lignes **et** sert de clé de tri. Cliquer son en-tête ne fait
rien, sans un mot d'explication. Une mention « aucune donnée de poste source ingérée sur ce
territoire » sous l'en-tête coûterait quelques lignes et éviterait une conclusion fausse.

### 7.3 Le bandeau d'incohérence de couverture

`couverturesIncoherentes()` est aujourd'hui exposée par `GET /api/sante`, c'est-à-dire lue par un
outil de déploiement. Un opérateur ne la verra pas. La remonter dans le bandeau « État des
données », à côté des « 7 source(s) à rafraîchir », la mettrait sous les yeux de qui peut agir.

### 7.4 Deux encarts couvrent 40 % de la carte en fenêtre étroite

À 900 px de large, la note du relais cartographique et l'explication de la vue nationale
s'empilent au centre de la carte. Les deux sont utiles ; leur superposition ne l'est pas. Les
fusionner, ou les replier en une pastille cliquable sous ce seuil de largeur, rendrait la carte
lisible sur un portable.

### 7.5 La suite de bout en bout n'est jouée par personne

C'est le constat n° 1 de cet audit, et la correction d'un échec ne le règle pas. Elle demande un
navigateur et une base semée ; elle n'est donc jouée ni par `npm test`, ni par la campagne de
mutation par défaut. **Tant qu'elle n'est pas dans un enchaînement automatique, elle se re-cassera
en silence** — c'est exactement ce qui vient d'arriver.

Le même raisonnement vaut pour les 9 motifs de mutation de bout en bout : ils viennent d'être joués
pour la première fois et passent tous, mais rien ne les rejouera. Un point pratique relevé en les
jouant : `--filtre` porte sur `audit + quoi + fichier`, et les neuf n'ont aucune chaîne commune —
il faut donc les appeler un par un, ou lancer la campagne entière. Un drapeau `--e2e-seulement`
les rendrait jouables en une commande d'une vingtaine de minutes, ce qui est la différence entre
une vérification qu'on fait et une qu'on remet.

### 7.5 bis Faire tourner la campagne hors de l'arbre de travail

La campagne mute un fichier source, lance les tests, puis le restaure. Pendant toute sa durée,
**l'arbre de travail est donc sale par construction**, et un `git status` y voit un fichier modifié
qui est un bug volontaire. C'est une gêne réelle : tout contrôle qui exige un arbre propre entre en
conflit avec elle, et le réflexe de « commiter ce qui traîne » pousserait la mutation elle-même.

La campagne finale de cet audit a donc été jouée sur une **copie du dépôt placée hors de l'arbre
suivi**, ce qui l'a laissé propre de bout en bout. C'est possible sans rien réinstaller parce que
les liens `node_modules/@enr/*` sont **relatifs** (`../../packages/core`) : dans une copie, ils
pointent vers les paquets de la copie. Une vérification s'impose avant de lancer plusieurs heures —
que `@enr/core` s'y résolve bien, sans quoi les tests ne verraient aucune mutation et **les 297
motifs « survivraient » pour une raison sans rapport**.

Documenter cette façon de faire dans l'en-tête de `scripts/mutation.mjs` éviterait de la
redécouvrir.

### 7.6 Ce qui reste du travail juridique, et qui n'est pas automatisable

Inchangé depuis le dossier précédent, rappelé pour mémoire : 7 divergences de sévérité entre
filières pour une même contrainte, 17 groupes de divergences de seuils, 28 règles marquées
`aValiderParJuriste`, et 128 articles à confronter à Légifrance — **injoignable depuis ce poste**
(403 Cloudflare), donc à faire depuis un poste qui y accède.

### 7.7 Les documents remis à un tiers — ce qui a été fait le 24 et le 25/09

Cet axe n'était pas prévu : il vient d'une demande du propriétaire du projet, « générer un pdf ou
mail résumant toutes les informations parcellaires avec texte et images ». Ce qui a été livré, et
ce que la relecture des documents réellement produits a fait remonter :

| Fait | Défaut qu'il corrige |
| --- | --- |
| Trois vues cartographiques dans la fiche et le dossier (plan, photo aérienne, vue large) | un dossier sans image oblige à rouvrir l'application pour comprendre ce qu'il décrit |
| Un brouillon de courriel `.eml` avec la fiche en pièce jointe | une fiche de six pages arrivant sans un mot ne s'ouvre pas |
| Les boutons d'export se désactivent pendant la préparation | chaque clic relançait une génération complète côté serveur |
| « Couches non ingérées sur ce territoire », distinct de « sources non interrogeables » | le rapport promettait qu'une relance compléterait une couche jamais ingérée — faux, et imprimé |
| Le nom de la source au lieu de sa clef technique | « patrimoine_culture » s'imprimait tel quel dans un document remis |
| « Emplacement réservé : foncier affecté » | deux participes sans accent dans un libellé du référentiel |
| « MW résiduels » | texte affiché sans accent, invisible au garde d'orthographe faute de graphie à comparer |

**Ce que la relecture des documents a appris, et qui vaut au-delà de ces documents** : cinq des
sept lignes ci-dessus n'ont été trouvées qu'en *ouvrant un PDF réellement généré* et en le lisant.
Aucun test ne les voyait, et aucune ne se serait vue à la relecture du code. La filière BESS, en
particulier, n'avait jamais produit un seul rapport avant le 25/09 — elle était entièrement grise.

---

## 8. Ce que cet audit a ajouté au filet

| Ajout | Ce qu'il empêche |
| --- | --- |
| `apps/api/src/connecteurs/base.ts` au périmètre du garde d'orthographe | qu'un texte affiché sous chaque critère reparte sans ses accents |
| `apps/web/test/garde-balayage-orthographe.test.ts` | que l'outil de recherche de fautes retombe en panne muette |
| `graduations()` + son garde sur `[0, 200]` | que l'axe du tableau de bord redouble un libellé |
| `rangsParTitre()` + 2 tests | que deux zones d'une commune se relisent comme un doublon |
| `couverturesIncoherentes()` + 3 tests | qu'une couverture annoncée sans données passe pour une absence constatée |
| 5 nouveaux motifs de mutation | que ces cinq gardes deviennent décoratifs |
| `carte-statique.ts` + 13 tests + 4 motifs | qu'une carte se trace au mauvais endroit, ou qu'un cadre vide passe pour un terrain rase |
| `idusSansScoreCourant(version, filières)` + 3 tests + 1 motif | qu'une filière ajoutée reste vide sur tout le parc, sans erreur ni compteur |
| `posteRenseigne()` + 5 tests + 2 motifs | que la capacité d'accueil redevienne illisible, ou qu'elle soit substituée en silence |
| `noteParcelle()` + 5 tests + 3 motifs | qu'une situation de propriété parte dans un courriel, ou qu'une pièce jointe se tronque |
| `sourcesIndisponibles()` + 2 tests + 1 motif | que le rapport promette qu'une relance complétera une couche jamais ingérée |
| `fluxDeContenu()` dans l'aide de lecture des PDF + 1 motif | qu'un test échoue sur un document correct, dès qu'il porte des images |
| **323 motifs de mutation au total** | — |

Le balayage orthographique a par ailleurs été rendu **importable** : il s'exécutait à l'import, donc
ne pouvait être testé que par un test exigeant hunspell — c'est-à-dire par aucun, et c'est ainsi que
sa panne a pu durer.

---

## 9. Reproduire les mesures

```bash
# Typage et tests hors base
npm run typecheck && npm test

# Tests exigeant une base
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e npm run test:base -w @enr/api

# Tests destructifs de migration, sur une base jetable
createdb enr_jetable && psql -d enr_jetable -c 'CREATE EXTENSION postgis'
DATABASE_URL=postgres://…/enr_jetable TESTS_MIGRATIONS=1 \
  npx tsx --test --test-concurrency=1 test/migrations.test.ts

# Bout en bout, et les captures de revue
cd apps/web
DATABASE_URL=… E2E_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
E2E_REVUE=1 … npx playwright test --grep @revue

# Recherche de fautes nouvelles (demande hunspell + hunspell-fr)
node scripts/orthographe-dictionnaire.mjs

# Campagne de mutation complete, y compris les 9 motifs de bout en bout.
# Jouee sur une COPIE hors de l'arbre suivi : la campagne mute un fichier a la fois, et
# laisserait sinon l'arbre sale pendant toute sa duree. Les liens node_modules/@enr/* sont
# relatifs, donc une copie est auto-coherente — a verifier avant de lancer plusieurs heures.
cp -a . /chemin/hors/depot/campagne && cd /chemin/hors/depot/campagne
readlink -f node_modules/@enr/core   # doit pointer DANS la copie
DATABASE_URL=… E2E_CHROMIUM=… node scripts/mutation.mjs --avec-e2e
```

**Résultat du 20 septembre 2026 : 297 / 297 attrapés, 0 survivant, 0 échec.** Si une campagne est
interrompue, le marqueur `.mutation-en-cours` nomme le fichier resté muté ; la commande suivante le
restaure en l'annonçant, quelle qu'elle soit.
