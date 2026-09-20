# Dossier de relecture juridique du référentiel

**Millésime du classeur** : 2026-09-18 · **292 contraintes** · **20 septembre 2026**

---

## 0. Ce que ce document est, et ce qu'il n'est pas

**Ce n'est pas une validation juridique.** Elle n'a pas eu lieu, et rien ici ne la remplace.
L'application est un rapporteur fidèle du classeur : elle recopie ses seuils sans les reformuler,
et elle n'a aucun moyen de savoir si un seuil est juste.

**C'est le travail préparatoire à cette validation** : le classement des 292 références, le repérage
des endroits où le classeur se contredit lui-même, et l'ordre dans lequel les relire.

Il ne raccourcit pas la relecture — 292 lignes restent 292 lignes — mais il l'**ordonne**, et il
isole les endroits où le classeur est en contradiction avec lui-même : **25 contraintes** réparties
en 8 groupes où le même intitulé reçoit une sévérité différente selon la filière. Ce sont elles
qu'il faut ouvrir en premier, parce qu'au moins l'une des deux lectures y est nécessairement
fausse.

**Ce qui n'a pas pu être fait ici, et pourquoi.** Chaque référence aurait dû être ouverte sur
Légifrance, comme cela avait été fait pour les 52 règles de procédure
(`packages/core/test/references-legifrance.test.ts`). Légifrance est inaccessible depuis
l'environnement d'exécution : un contrôle Cloudflare renvoie un HTTP 403 à toute requête. Les
constats ci-dessous portent donc sur la **cohérence interne** du classeur, qui se vérifie sans
réseau, et non sur l'exactitude des textes cités.

---

## 1. État des références : ce que le classeur cite

| Nature de la référence | Contraintes | |
| --- | --- | --- |
| **Article numéroté** d'un code (« Art. L515-44 C. env. ») | **128** | vérifiable sur Légifrance |
| **Texte daté** sans numéro d'article (« Arrêté 26/08/2011 », « Décret 2010-1255 ») | **32** | vérifiable |
| **Doctrine, guide, jurisprudence, consultation** (« Doctrine ERC », « Guide EDD ; SNCF Réseau ») | **40** | non opposable en soi |
| **Autre** (« C. urbanisme », « Droit civil / rural », « Enedis », « VNF ») | **70** | à préciser |
| **Aucune référence** (cellule vide ou « — ») | **22** | à statuer |
| **Total** | **292** | |

Deux enseignements immédiats.

**44 % des contraintes citent un article précis.** Les 56 % restantes renvoient à un texte non
numéroté, à une doctrine, à un interlocuteur — ou à rien. Ce n'est pas nécessairement une faute :
« Consultation DGAC/SNA » décrit exactement ce qui doit être fait pour une servitude aéronautique.
Mais une **contrainte rédhibitoire** fondée sur une doctrine n'a pas la même force qu'une contrainte
fondée sur un article, et le document remis à un propriétaire ne fait aujourd'hui pas la différence.

**50 des 133 contraintes rédhibitoires ne citent aucun article numéroté.** Ce sont elles qui
écartent une parcelle. Avec les 25 contraintes en contradiction interne (§2.2) et les 57 que le
classeur seuille différemment selon la filière (§2.3), le périmètre à trancher en priorité compte
**123 contraintes distinctes sur 292** — soit 42 % du classeur. Le reste est du travail mécanique
de vérification d'articles.

---

## 2. Le chemin critique, dans l’ordre

### 2.1 Les 3 rédhibitoires sans aucun fondement

| Filière | Contrainte | Seuil du classeur |
| --- | --- | --- |
| Éolien | Gisement de vent | ≥ ~5-6 m/s (selon machine) |
| BESS | Surface / emprise nécessaire | ~0,3 à 1 ha pour un projet type de dizaines de MW/MWh |
| BESS | Accès poids lourds / logistique | Desserte PL + retournement |

Ces trois lignes n'ont pas de référence parce qu'**il n'y en a pas** : ce sont des critères
économiques, pas des interdictions. Un terrain peu venté n'est pas un terrain interdit.

Le classeur les range pourtant en **rédhibitoire**, et deux d'entre elles sont rattachées au
moteur de verdict. Une parcelle à 3 m/s de vent pourrait donc ressortir « défavorable — une
contrainte rédhibitoire du référentiel est enfreinte au seuil réglementaire », c'est-à-dire une
affirmation sur le droit, dans un document remis à un propriétaire.

**Elle ne le fait pas, et la vérification a corrigé ce que j'avais d'abord écrit ici.** J'ai
annoncé un défaut et une correction ; la mesure a montré qu'il n'y avait pas de défaut. Le moteur
annule la condition d'une contrainte dès qu'une raison l'empêche de trancher seule — et les trois
lignes en portent toutes une autre : leur seuil est approximatif (« ~5-6 », « selon machine ») ou
son extraction est incomplète. **Mesure : aucune des 22 contraintes sans référence n'était
décisive.** La protection existait donc déjà — mais **par accident**, au titre d'un autre motif.

**Ce qui a été fait, du coup.** L'absence de fondement devient un motif à part entière
(`aucun_fondement_cite`), au même titre que le seuil approximatif. Trois conséquences : une
contrainte sans texte dont le seuil serait par ailleurs ferme ne peut plus, **structurellement**,
rendre une parcelle défavorable ; la raison est dite dans la fiche au lieu d'être masquée par une
autre ; et une mutation vérifie que la ligne qui porte cette protection ne peut pas disparaître.

→ *Reste à trancher par un juriste : faut-il maintenir ces lignes en « rédhibitoire » dans le
classeur, ou les reclasser en critère économique ? Le score les traite déjà comme telles, et il le
fait mieux parce qu'il nuance au lieu de trancher.*

### 2.2 Les 25 contraintes, en 8 groupes, que le classeur traite différemment selon la filière

Même intitulé, même texte cité, **sévérité différente**. Ces divergences sont peut-être toutes
justifiées — un parc éolien et une centrale au sol n'ont pas le même rapport à la loi Montagne —
mais elles ne sont nulle part motivées, et trois d'entre elles changent le verdict.

| Contrainte | Traitement selon la filière | Enjeu |
| --- | --- | --- |
| **Servitudes d'utilité publique** | rédhibitoire en éolien / solaire / BESS / méthanisation, **pénalisant en agrivoltaïsme** | Même seuil « Selon SUP » dans les cinq filières. **La moitié de cette divergence était de mon fait** — *cf.* l'encadré ci-dessous. |
| **Loi Montagne** | pénalisant en éolien, rédhibitoire en solaire et agrivoltaïsme | Même article cité (L.122-1 s. C. urb.) |
| **Espèces protégées** | rédhibitoire en solaire / agri / métha, **pénalisant en BESS** | Même article (L.411-1/-2 C. env.) |
| **Feux de forêt (PPRif / OLD)** | pénalisant en éolien, rédhibitoire en solaire et agri | Même code forestier |
| **Feux de forêt (OLD / PPRif)** — ligne distincte | rédhibitoire en BESS, pénalisant en méthanisation | **Deux intitulés pour la même chose**, avec des sévérités croisées |
| **Maîtrise foncière** | rédhibitoire en éolien et BESS, **pénalisant en solaire** | Même « Accords signés » |
| **ZAN / artificialisation** | **favorable** en éolien, **pénalisant** en BESS | Sens opposé |
| **Enquête publique / participation** | `cadre` en solaire, pénalisant en agri et métha | Même « Selon EE » |

**Le cas des SUP était à moitié un défaut d'extraction, et il est corrigé.** Le classeur n'écrit pas
« Cadre » sur la ligne agrivoltaïsme : il écrit **« Variable »**, un libellé qui n'apparaît **qu'une
seule fois dans les 292 lignes**. Mon extracteur le rangeait avec les « Cadre procédural », « Cadre
(acceptabilité) », « Cadre (coût) » — c'est-à-dire avec le permis de construire, l'étude d'impact et
le régime ICPE, qui s'appliquent à **tout** projet et n'entrent donc jamais dans le verdict.

Conséquence, invisible nulle part : **l'agrivoltaïsme ignorait silencieusement les servitudes
d'utilité publique**, et sa fiche n'en disait pas un mot. « Cadre procédural » dit « ceci s'applique
toujours » ; « Variable » dit « le niveau dépend du cas ». Ce sont deux choses opposées.

La ligne est désormais **pénalisante** : comptée, affichée, instruite — mais elle n'écarte aucune
parcelle à elle seule. Aligner sur le rédhibitoire des quatre autres filières aurait été commode et
aurait été **inventer**, puisque le classeur n'écrit pas ce mot-là. → *La divergence subsiste donc,
et c'est bien au juriste de la trancher : pénalisant ou rédhibitoire ?*

### 2.3 Les 57 contraintes, en 18 groupes, dont le seuil varie selon la filière

Elles sont listées par le test qui accompagne ce document. **Une a déjà été tranchée et vérifiée** :
le retrait-gonflement des argiles, « Aléa fort » en éolien / agrivoltaïsme / méthanisation contre
« Aléa moyen/fort » en solaire et BESS. La différence est réelle et appliquée telle quelle — 52
parcelles pénalisées dans deux filières, aucune dans les trois autres. Les 17 autres n'ont pas été
examinées.

### 2.4 Les 50 rédhibitoires qui ne citent aucun article numéroté

Ce sont les contraintes qui **écartent une parcelle** sans pouvoir désigner l'article qui le
justifie. Elles se répartissent ainsi :

| Nature de la référence | Rédhibitoires | Exemple |
| --- | --- | --- |
| Texte daté sans numéro d'article | **13** | « Arrêté 26/08/2011 » |
| Code ou interlocuteur cités sans article | **28** | « C. urbanisme », « Droit civil / rural », « Enedis », « VNF » |
| Doctrine, guide, jurisprudence | **6** | « Doctrine régionale éolien-biodiversité » |
| Aucune référence | **3** | *cf. §2.1* |
| **Total** | **50** | sur 133 rédhibitoires |

Les 28 « code ou interlocuteur » sont le lot le plus embarrassant : « C. urbanisme » ne désigne
rien de précis, et « Enedis » n'est pas une source de droit. Une doctrine régionale ou un guide
DREAL **ne sont pas opposables de la même façon qu'un article** — et le dossier remis à un
propriétaire ne fait aujourd'hui aucune différence entre « Art. L515-44 C. env. » et « Doctrine
régionale éolien-biodiversité ». → *À trancher : compléter la référence, ou afficher la nature de
la source à côté de la contrainte ?*

---

## 3. Ce que la relecture n'aura pas à refaire

Les **52 règles de procédure** de `packages/core/src/reglementation.ts` — permis de construire,
évaluation environnementale, ICPE, compensation agricole — ont déjà fait l'objet de deux relevés,
les 7 et 9 septembre 2026, au cours desquels **chaque URL a été ouverte une par une**. Le premier
relevé a trouvé 20 liens morts et 5 liens qui ouvraient un texte sans rapport ; le second a comblé
18 des 20 absences. 50 liens sur 52 sont aujourd'hui vérifiés, et un test fige chaque relevé.

**28 de ces 52 règles restent marquées `aValiderParJuriste`** et doivent être signées. Le compte est
monté de 27 à 28 au cours de la vérification, ce qui est le bon sens de variation : on a découvert
qu'on ne savait pas quel texte fondait `bess_securite_incendie`.

---

## 4. Ordre de travail proposé

1. **§2.1** — statuer sur les 3 lignes sans fondement (une heure).
2. **§2.2** — les 8 divergences de sévérité. Celle des SUP est désormais réduite à une vraie
   question de fond (pénalisant ou rédhibitoire ?) et non plus à un silence.
3. **§2.3** — les 17 groupes de seuils divergents non encore examinés.
4. **§2.4** — les 50 rédhibitoires sans article numéroté, en commençant par les 28 qui ne citent
   qu'un code ou un interlocuteur.
5. **Les 22 contraintes sans référence** (dont les 3 du §2.1) : leur en donner une, ou acter qu'il
   n'y en a pas.
6. **Les 128 articles numérotés**, à ouvrir sur Légifrance — travail mécanique, qui n'a pas pu être
   fait ici et qui devrait l'être sur un poste ayant accès au site.
7. **Les 28 règles `aValiderParJuriste`** de `reglementation.ts`.

---

## 5. Ce qui empêche ce document de se périmer

Les chiffres des §1 et §2 sont **recomptés** par
`packages/core/test/relecture-juridique.test.ts`, qui les compare à ce fichier. Une contrainte
ajoutée, une référence corrigée ou une divergence résolue fait échouer la suite tant que le
document n'a pas suivi. C'est la même discipline que pour le rapport de vérification : un dossier de
relecture qui affiche des comptes faux fait perdre plus de temps qu'il n'en fait gagner.
