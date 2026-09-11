# Ce que l'application couvre, mesuré

> Trois questions du propriétaire, trois réponses **mesurées et non affirmées** : le cadastre est-il
> complet pour la France ? Les normes réglementaires sont-elles intégrées pour chacune des filières ?
> L'ergonomie peut-elle être améliorée ?
>
> Ce qui relève du **jugement juridique** est signalé comme tel : je peux mesurer ce que le code contient,
> je ne peux pas certifier la complétude d'un corpus de droit.

---

## 1. Le cadastre : complet, y compris outre-mer — mais l'application est bornée à la métropole

Mesure par `apps/api/scripts/verifier-relais-cadastre.ts`, sur une tuile réelle par territoire :

| Territoire | Tuile | Statut | Octets |
|---|---|---|---|
| Beauce (28) | 16/33093/22738 | 200 | 3 665 |
| Finistère (29) | 16/32021/22672 | 200 | 5 952 |
| Vaucluse (84) | 16/33687/23842 | 200 | 5 016 |
| Bas-Rhin (67) | 16/34151/22617 | 200 | 12 697 |
| Haute-Garonne (31) | 16/33030/23931 | 200 | 43 813 |
| **Corse-du-Sud (2A)** | 16/34359/24345 | 200 | 1 787 |
| **Haute-Corse (2B)** | 16/34486/24155 | 200 | 17 691 |
| **Guadeloupe (971)** | 16/21566/29771 | 200 | 112 121 |
| **Martinique (972)** | 16/21659/30079 | 200 | 1 619 |
| **Guyane (973)** | 16/23241/31869 | 200 | 32 472 |
| **La Réunion (974)** | 16/42862/36656 | 200 | 49 499 |
| **Mayotte (976)** | 16/41000/35114 | 200 | 65 877 |
| Pleine mer | 16/31875/22808 | **204** | 0 |
| Vue large (zoom 8) | 8/129/88 | **204** | 0 |

**12 territoires sur 12 servis.** Le format d'identifiant accepte également les codes corses (`2A004`) et
d'outre-mer (`97411`) — vérifié par `packages/core/test/composer-idu.test.ts`.

**MAIS l'application ne laisse pas y aller.** Deux bornes, toutes deux volontaires et documentées :

| Où | Quoi | Effet |
|---|---|---|
| `apps/web/src/components/Carte.tsx` — `BORNES_FRANCE` | `[-6,2 ; 40,5]` → `[10,6 ; 51,9]` | la carte refuse de naviguer hors métropole |
| `apps/api/src/geo.ts` — `limiterAlaFrance` | même emprise | toute qualification d'emprise hors métropole est refusée |

La Corse est **dans** ces bornes ; les cinq DOM sont **dehors**. Le cadastre ultramarin est donc servi par
le relais et inatteignable dans l'interface.

**Ce n'est pas un défaut, c'est un périmètre** — et c'est une décision qui vous appartient. L'ouvrir
demanderait plus que d'élargir deux constantes : il faudrait vérifier, source par source, laquelle couvre
l'outre-mer (le GPU et le RPG partiellement, le raster de vent métropolitain, PVGIS oui), sans quoi
l'application afficherait des critères gris en masse — ce que ces audits passent leur temps à combattre.

---

## 2. Les normes réglementaires : 25 règles, toutes câblées, toutes affichées

### Inventaire mesuré

`REGLES` porte 25 règles. Deux mesures indépendantes :

- **atteignabilité** — chaque règle est-elle référencée par le moteur ? **25/25.**
- **affichage réel** — combien atteignent l'écran sur une fiche réelle ? Compté sur les quatre fixtures
  capturées (réponses d'API véritables) :

| Filière | Règles | Seuils de procédure affichés | Critères | Knock-outs spécifiques |
|---|---|---|---|---|
| Solaire au sol / agrivoltaïsme | 9 | 6 (3 conditionnels : AOP, document-cadre, date inculte) | 29 | 2 |
| Éolien terrestre | 5 | 5 | 22 | 4 |
| Méthanisation | 8 | 8 | 17 | 3 |
| **Stockage BESS** | **3** | 3 | 19 | **0** |

L'agrivoltaïsme n'est pas une filière séparée : c'est un **régime d'implantation** du solaire au sol
(dégradé / inculte / agricole), avec ses trois règles propres — taux de couverture, zone témoin, avis
CDPENAF, toutes rattachées au décret n° 2024-318 du 8 avril 2024. Le choix est défendable : mêmes critères
physiques, même raccordement, seul le régime change. Il mérite d'être su.

### Trois constats qui appellent une décision

> **Suite donnée, à votre demande.** Les trois constats ci-dessous ont été traités : la section 4 de ce
> document rend compte du travail et de ce qu'il a lui-même révélé. Les constats restent écrits tels
> qu'ils étaient, parce qu'ils décrivent l'état trouvé.

**A. Le stockage BESS est la filière la plus mince, et de loin.** Trois règles contre huit ou neuf, dont
une explicitement marquée « Recommandation technique — non réglementaire » (chimie LFP). Surtout :
**aucun knock-out spécifique**. `REGLES_KO` donne `bess: [...COMMUNS]` — un projet BESS ne peut donc jamais
être écarté pour un motif propre au stockage, seulement par les sept motifs communs (zone humide, PPRI
rouge, EBC, emplacement réservé, zonage naturel, poste saturé, protection forte).

**B. Un fondement juridique est faux, et il s'imprime dans le rapport remis au propriétaire.** Le
knock-out `ko_eol_servitude_aero` — servitude aéronautique de dégagement — cite `eol_radar`, c'est-à-dire
l'arrêté du 26 août 2011 relatif aux **radars**. Ce texte ne régit pas les servitudes de dégagement. C'est
exactement la famille du défaut « Fondement : eol_distance_habitation » corrigé au chantier C : une clé
technique ou un texte étranger donné comme base juridique d'un rejet.

**Corrigé ici en retirant l'attribution fausse**, et non en la remplaçant : substituer une référence que je
ne peux pas vérifier serait le même défaut avec un meilleur déguisement. Le knock-out reste, son motif
reste, sa base juridique est à établir par un juriste.

**C. Dix knock-outs sur vingt ne portent aucune référence juridique.** Certains n'en ont pas besoin
(`ko_poste_sature` est technique). Six sont pourtant de nature juridique et pourraient en porter une :

| Knock-out | Texte qui le fonde, à faire valider |
|---|---|
| `ko_zone_humide` | code de l'environnement, art. L.211-1 ; R.214-1 rubrique 3.3.1.0 |
| `ko_ppri_rouge` | code de l'environnement, art. L.562-1 (règlement du PPRN) |
| `ko_ebc` | code de l'urbanisme, art. L.113-1 et L.113-2 |
| `ko_emplacement_reserve` | code de l'urbanisme, art. L.151-41 |
| `ko_zonage_naturel` | selon le zonage : L.331-4 (cœur de parc), L.332-9 (réserve), R.411-15 (APPB) |
| `ko_eol_site_classe` | code de l'environnement, art. L.341-10 |

Je ne les ai **pas** ajoutées. Les inscrire relèverait de l'autorité juridique que je n'ai pas, dans un
outil dont les rapports partent chez des propriétaires ; et le référentiel porte précisément un champ
`derniereVerification` pour dire qui a vérifié quoi. C'est une liste à soumettre, pas un correctif à
appliquer seul.

### Ce que je ne peux pas certifier

La **complétude** du corpus. Des contraintes sont calculées et affichées comme critères sans porter de
règle : défrichement, espèces protégées, sensibilité archéologique, évaluation des incidences Natura 2000,
faisceaux hertziens, compensation agricole collective, loi Littoral et loi Montagne. Sont-elles absentes
par oubli ou par choix de périmètre ? Cela demande un avis de spécialiste — c'est l'item de priorité 5
« revue juridique du référentiel réglementaire », toujours ouvert.

---

## 3. Ergonomie : sept défauts mesurés sur capture, six corrigés

Méthode : `apps/web/e2e/captures.spec.ts` (marqué `@revue`, hors suite ordinaire) photographie les vues
dans un vrai navigateur, en 1 600 × 1 000, en 900 × 800 et en thème sombre. **Regarder plutôt que
supposer.**

| # | Défaut observé | Correctif |
|---|---|---|
| 1 | **Quatre bandeaux = 200 px sur 1 000**, un cinquième de l'écran avant la moindre donnée | les deux alertes de fraîcheur réunies en **une ligne dépliable** ; les deux avertissements du §12 restent ouverts et entiers |
| 2 | **La légende occupait tout le panneau gauche** (> 700 px, ouverte, en tête) : filtres, calques et couches hors de vue, sans rien d'actionnable à l'écran | ordre inversé — filtres d'abord, légende **fermée** en dernier ; complète et à un clic |
| 3 | Le résumé de filière prenait 110 px pour trois paragraphes qu'on lit une fois | critère déterminant visible, le reste replié |
| 4 | **La fiche restait affichée en vue liste**, amputant le tableau de 470 px : dix colonnes dans 800 px, cellules sur deux lignes, dernière colonne coupée | la fiche n'est montée qu'en vue carte ; **le tableau passe de 800 à 1 250 px, 12 lignes visibles → 21** |
| 5 | **Quatre boutons d'outils empilés au milieu de la carte**, par-dessus le parcellaire examiné | une **barre horizontale** unique en haut à gauche, centre libre |
| 6 | **Deux bulles de statut au même `bottom: 34px`** : elles se recouvraient exactement, et les décalages étaient corrigés à la main en style en ligne | une **pile** — n'importe quel nombre de messages s'empile sans décalage à maintenir |
| 7 | **En 900 px, « Sombre » et « Quitter » étaient coupés hors de l'écran** ; « Tableau de bord » se cassait en trois lignes même en 1 600 px | la barre se replie (`flex-wrap`, hauteur minimale) ; libellés `nowrap` |
| 8 | La recherche, entrée la plus utilisée, était le champ **le plus étroit** : ~200 px au lieu de 380, « Parcelle 0A 0094 » tronqué en « Parcelle 0A » | largeur protégée (`flex-shrink: 0`, minimum 220 px) |

Et un défaut trouvé en cherchant les autres : **l'attribution IGN de la carte flottait par-dessus le
tableau de la liste**. `visibility: hidden` sur le conteneur de la carte se laisse annuler par un
descendant — la feuille de style de MapLibre le fait sur certains contrôles. `opacity: 0` ne peut pas
l'être, et conserve la mise en page, donc aucun redimensionnement au retour sur la carte.

### Ce qui n'était PAS un défaut

Le thème sombre. Je l'ai d'abord cru non appliqué en lisant la capture trop vite ; vérification faite, il
l'est correctement, partout, y compris sur les bandeaux et le panneau — `prefers-color-scheme` et
`data-theme` sont tous deux traités.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm run build` | 0 erreur |
| tests de rendu `apps/web` | 82/82 |
| tests de bout en bout, navigateur réel | 15/15 |
| mutations touchant l'interface (`--filtre "audit 10"`) | 12/12 attrapées |

La mutation « les avertissements de la section 12 cessent d'être affichés » est toujours attrapée : le
remaniement des bandeaux n'a pas affaibli la clause non négociable.


---

## 4. Suite donnée : étoffer le BESS, et fonder les knock-outs

Les deux chantiers demandés après la lecture des constats ci-dessus.

### Les références juridiques : proposées, pas validées

Onze knock-outs écartaient une parcelle sans citer aucun texte. Ils en portent désormais un — **et le
disent comme tel.**

| Knock-out | Fondement ajouté |
|---|---|
| `ko_zone_humide` | c. env., art. L.211-1 et R.214-1 rubr. 3.3.1.0 ; L.163-1 |
| `ko_ppri_rouge`, `ko_pprif_rouge` | c. env., art. L.562-1 et R.562-1 et s. |
| `ko_pprt_rouge` | c. env., art. L.515-15 à L.515-19 |
| `ko_ebc` | c. urb., art. L.113-1 et L.113-2 |
| `ko_emplacement_reserve` | c. urb., art. L.151-41 ; L.152-2 |
| `ko_zonage_naturel` | c. urb., art. R.151-24, R.151-25 ; L.151-13 (STECAL) |
| `ko_eol_site_classe` | c. env., art. L.341-1 et L.341-10 |
| `ko_coeur_parc_national` | c. env., art. L.331-4 et L.331-4-1 |
| `ko_reserve_naturelle` | c. env., art. L.332-3 et L.332-9 |
| `ko_appb` | c. env., art. R.411-15 à R.411-17 |

**Je ne suis pas juriste, et le référentiel le dit maintenant explicitement.** Un champ
`aValiderParJuriste` marque ces treize règles ; la fiche affiche « référence à faire valider par un
juriste » à côté du texte, et le rapport PDF l'imprime dans le document remis au propriétaire. Un test
verrouille le marquage : il ne disparaîtra qu'en le retirant à la main, ce qui est le geste par lequel
quelqu'un déclare avoir validé.

Chaque commentaire de règle distingue ce qui est certain de ce qui ne l'est pas. Le plus important :
pour un PPR, **l'interdiction n'est pas portée par le code mais par le règlement du plan approuvé**, qui
varie d'un département à l'autre — le commentaire le dit, et invite à le lire.

Une seule référence reste absente, volontairement : `ko_eol_servitude_aero`. Le texte qui fonde une
servitude aéronautique de dégagement n'est pas celui que je saurais nommer avec assez de certitude, et
une référence fausse est pire qu'aucune — c'est le défaut que ce chantier venait corriger.

### Le BESS : de 3 règles et 0 motif éliminatoire à 6 et 1

| | Avant | Après |
|---|---|---|
| Règles réglementaires | 3 (dont 1 non réglementaire) | **6** |
| Seuils affichés sur une fiche | 3 | **6** |
| Knock-outs propres à la filière | **0** | **1** |

Les trois règles ajoutées restent au niveau que je peux défendre — le **régime** applicable, pas un seuil
chiffré que je ne saurais pas vérifier. Les distances d'éloignement de la rubrique 2925 ne sont
délibérément **pas** transcrites : elles figurent dans l'arrêté de prescriptions générales, elles varient
selon le régime, et une valeur fausse serait pire que son absence.

- **`bess_acces_engins`** — voie engins et accès poids lourds. Deux exigences se cumulent : la livraison
  des conteneurs par semi-remorque, et la voie engins que le SDIS exige pour intervenir.
- **`bess_effets_domino`** — voisinage industriel, examiné dans les deux sens. Évalué seulement quand
  `icpeProches` est renseigné ; sinon laissé à « à vérifier ».
- **`bess_raccordement_s3renr`** — **le point de méthode le plus coûteux à découvrir tard** : les
  capacités réservées par un S3REnR visent les installations de *production*. Un stockage pur peut
  relever du droit commun, avec un coût et un délai différents. C'est aussi la raison pour laquelle le
  raccordement pèse 42 % du score de cette filière.

Le knock-out `ko_bess_acces_engins` est **dérogeable** — orange avec alerte forte, jamais rouge : un
accès se crée, c'est un coût et un délai, pas une impossibilité de droit.

### Trois défauts que ce chantier a révélés

Le premier est de méthode. Ma première version du test relisait la **source** pour en extraire les
arguments passés à `ko(...)`. Elle était aveugle à la moitié du sujet : plusieurs knock-outs reçoivent
leur identifiant et leur fondement **par variable**. Remplacée par une vérification **par exécution** —
déclencher réellement chaque knock-out et lire ce qu'il produit — qui a immédiatement trouvé les deux
suivants.

**A. `ko_metha_captage` était inatteignable en production.** La condition exigeait
`type === 'immediat' || type === 'rapproche'`. Or le connecteur des servitudes écrit `type: null`, et il a
raison : le GPU expose l'assiette de la servitude sans distinguer les périmètres, et le code refuse de
l'inventer. La condition ne pouvait donc **jamais** être vraie sur de la donnée réelle : une unité de
méthanisation dans un périmètre de protection de captage n'était jamais écartée.

Corrigé sans rien supposer : le knock-out se déclenche sur le fait établi — la parcelle **est** dans un
périmètre — et son caractère dépend de ce que l'on sait. Sous-périmètre connu → rédhibitoire ;
sous-périmètre inconnu → dérogeable, avec un motif qui dit d'aller lire l'arrêté de DUP.

**B. Le recul éolien de 500 m n'examinait pas la zone d'habitat sans bâtiment mesuré.** La fonction
sortait sur `if (d == null) return null` avant de tester la distance à la **zone destinée à
l'habitation** — alors que l'article L.515-44 vise les deux. Cas réel : une parcelle en lisière d'une zone
U encore non bâtie a `distanceHabitationM` à null, et une zone d'habitat à moins de 500 m. Le knock-out le
plus structurant de la filière ne se déclenchait pas.

**C. Trois knock-outs étaient absents de `IDS_KNOCK_OUTS`.** Les protections fortes — cœur de parc
national, réserve naturelle, APPB — recevaient leur identifiant par interpolation (`ko_${suffixe}`), donc
invisible à toute énumération. Conséquence : **il était impossible de désactiver le knock-out le plus
sévère de l'application**, la route refusant l'identifiant comme inconnu. Les identifiants sont désormais
des littéraux, et un test exige que chaque identifiant déclaré soit **réellement atteignable**.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm run build` | 0 erreur |
| `npm test`, base vierge | **656 tests, 0 échec**, 4 ignorés (destructifs) |
| `packages/scoring` | 61/61, dont 6 invariants de fondement juridique |
| Tests de bout en bout | 15/15 |
| Mutations du chantier (`--filtre couverture`) | **10/10 attrapées** |
| Relecture des rapports PDF, 4 filières + écartée | 6/6 |

Les 22 knock-outs déclarés sont chacun **déclenchés par un cas de test** et leur fondement lu sur le
résultat : c'est ce qui a permis de trouver les défauts A et B.

### Ce qui reste à faire, et qui n'est pas de mon ressort

**Faire relire les treize règles marquées `aValiderParJuriste`.** Elles sont utiles en l'état — mieux vaut
un texte nommé et signalé comme à vérifier qu'un refus sans motif — mais elles partent dans un document
remis à un propriétaire. La liste est dans `packages/core/src/reglementation.ts`, groupe `REGLES_COMMUNES`
et trois entrées `bess_*` ; le test `fondement-knockouts` l'énumère.


---

## 5. Étoffement des trois autres filières

Même méthode que pour le stockage : n'ajouter que ce que l'application **mesure**, rester au niveau du
**régime applicable** plutôt que du seuil chiffré, et marquer toute référence non relue par un juriste.

### Le référentiel, avant et après

| Groupe | Avant | Après |
|---|---|---|
| **commun** (nouveau) | — | **14** |
| solaire / agrivoltaïsme | 9 | **11** |
| éolien terrestre | 5 | **7** |
| stockage BESS | 3 | **6** |
| méthanisation | 8 | **10** |
| **total** | **25** | **48** |

Seuils de procédure réellement affichés sur une fiche : solaire 3 → **9**, éolien 5 → **11**, BESS 3 →
**10**, méthanisation 8 → **14**.

### Quatre autorisations transversales, qui n'apparaissaient nulle part

Elles décident du **calendrier** d'un projet, et aucune n'était citée — sur aucune des quatre filières.

| Procédure | Référence | Applicabilité |
|---|---|---|
| Défrichement et compensation | c. forestier L.341-1, L.341-3, L.341-6 | **calculée** — couverture forestière mesurée |
| Espèces protégées | c. env. L.411-1, L.411-2, R.411-6 et s. | toujours « à vérifier » |
| Incidences Natura 2000 | c. env. L.414-4, R.414-19 à R.414-23 | **calculée** — recouvrement **ou** proximité ≤ 5 km |
| Archéologie préventive | c. patrimoine L.522-1 et s., R.523-1, R.523-4 | toujours « à vérifier » |

Les deux « à vérifier » ne sont pas une faiblesse, c'est la seule réponse honnête : `preEnjeuEspeces` et
`sensibiliteArcheologique` sont mis à `null` **par les connecteurs, délibérément** — le premier portait
une valeur inventée, retirée à l'audit 6. Annoncer « non applicable » sur une donnée absente serait le
défaut fondateur de ces audits, et le plus dangereux de tous : **une ligne verte ne réveille personne.**
Un test verrouille les deux.

Pour Natura 2000, le point de droit qui compte est verrouillé lui aussi : l'évaluation est due **même hors
du site** dès lors que le projet est susceptible de l'affecter. Conclure « non » sur la seule absence de
recouvrement serait faux.

### Et un défaut que ce chantier a révélé

**`milieux.enjeuDefrichement` était mesuré et jeté.** L'enrichissement le calcule depuis la couverture
forestière ingérée (`enrichissement.ts`), et **aucune règle de scoring ne le lisait**. Une donnée
collectée, stockée, et exploitée par personne — alors qu'un défrichement porte une compensation pouvant
atteindre plusieurs fois la surface défrichée.

En cherchant, j'ai vérifié les cinq autres champs du même profil : `sensibiliteAvifaune`,
`sensibiliteChiropteres`, `preEnjeuEspeces`, `inculteDepuis2013` et `covisibiliteIndice` sont mis à `null`
**explicitement**, avec leur motif — ils portaient des valeurs inventées, retirées aux audits précédents.
Ce sont donc des absences assumées, pas des oublis. `enjeuDefrichement` était le seul vrai gâchis.

### Par filière

**Solaire / agrivoltaïsme (+2).** `pv_compensation_agricole` — étude préalable de compensation agricole
collective (c. rural L.112-1-3, décret n° 2016-1190) : le seuil de surface est fixé **par arrêté
préfectoral**, entre un et cinq hectares selon les départements, donc l'application se prononce sur ce
qu'elle sait — la nature du sol — et jamais sur la surface. Une configuration agrivoltaïque maintenant une
production significative peut en dispenser, ce qui est l'un des intérêts du régime.
`pv_demantelement` — remise en état et garanties financières ; pour l'agrivoltaïsme la **réversibilité est
une condition du régime lui-même**, et c'est souvent la première question du propriétaire.

**Éolien (+2, dont un motif éliminatoire).** `eol_faisceaux_hertziens` (CPCE L.54 à L.56-1) : `risques.faisceauxHertziens`
était **mesuré** et n'alimentait qu'un critère noté. Un aérogénérateur de plus de cent mètres en travers
d'un faisceau protégé est en principe incompatible — c'est plus que quelques points. Nouveau knock-out
**`ko_eol_faisceau_hertzien`**, dérogeable : le faisceau se dégage souvent en déplaçant la machine.
`eol_autorisation_environnementale` (c. env. L.181-1 et s., L.122-1, L.123-1 et s.) : l'autorisation
unique absorbe étude d'impact, incidences Natura 2000, dérogation espèces, défrichement et permis de
construire — bonne nouvelle de procédure, mauvaise de calendrier.

**Méthanisation (+2, dont un motif éliminatoire).** `metha_sous_produits_animaux` (règlement CE
1069/2009, règlement UE 142/2011, c. rural L.226-1 et s.) : dès qu'un intrant contient des sous-produits
animaux, l'unité relève du régime sanitaire européen **en plus** de l'ICPE — agrément DDPP, hygiénisation,
traçabilité. Déclenché par la présence d'élevages dans le rayon d'approvisionnement, qui rend ces intrants
probables ; c'est un indice, et le commentaire le dit.
`metha_acces_engins` + nouveau knock-out **`ko_metha_acces_engins`**, dérogeable. Le même fait mesuré n'a
pas le même poids selon la filière : pour un stockage les conteneurs arrivent une fois, pour une unité de
méthanisation c'est **plusieurs allers-retours de poids lourds chaque jour pendant vingt ans**. L'accès
conditionne l'autorisation, la voie engins du SDIS, et l'acceptabilité — premier motif d'opposition des
riverains sur cette filière.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm run build` | 0 erreur |
| `npm test`, base vierge | **662 tests, 0 échec**, 4 ignorés |
| `packages/scoring` | 67/67, dont 6 nouveaux invariants de procédure |
| Tests de bout en bout | 15/15 |
| Mutations du chantier (`--filtre couverture`) | **16/16 attrapées** |

Les **25 knock-outs** déclarés sont chacun déclenchés par un cas de test, et leur fondement relu sur le
résultat.

### Ce qui reste

**23 règles portent `aValiderParJuriste`** — les 14 communes, plus deux par filière ajoutées ici et trois
pour le stockage. C'est le seul point qui n'avance pas sans vous : elles sont utiles en l'état, mais elles
s'impriment dans un document remis à un propriétaire. La liste s'obtient par le test
`fondement-knockouts` ou en filtrant le référentiel sur ce champ.

---

## 6. « Est-ce qu'au niveau de toutes les couches on est bon ? » — mesuré, et non

> Deux questions du propriétaire, le 10 septembre 2026 : les **couches** sont-elles bonnes, et les
> **règles** d'intégration juridique, foncière et urbanistique le sont-elles pour les quatre filières ?
> Voici ce que la mesure dit. Elle ne dit pas « oui ».

### 6.1 Les couches : 21 connecteurs déclarés, 2 réellement ingérés

Relevé sur la base `enr_e2e` (`source_donnee` × `couverture_ingestion`) :

| Connecteur `ingestion` | Départements ingérés | Objets |
|---|---|---|
| `postes_geopf` | **101** | 2 830 |
| `zaer_local` | **1** | 7 664 |
| `postes_sources` | 0 | 0 |
| `patrimoine_culture` | 0 | 0 |
| `patrimoine_sites` | 0 | 0 |
| `reseau_gaz` | 0 | 0 |
| `vent_100m` | 0 | 0 |

**Cinq connecteurs d'ingestion sur sept n'ont jamais tourné.** Les 14 sources interrogées en temps
réel (cadastre, GPU, RPG, INAO, INPN, Géorisques, RGE ALTI…) fonctionnent, elles, à chaque
qualification — c'est pour cela que l'application est utilisable aujourd'hui. Mais une couche jamais
ingérée n'est pas une couche vide : c'est une couche **inconnue**, et l'application le déclare
critère par critère plutôt que de conclure à l'absence d'enjeu.

### 6.2 Ce que cela coûte, critère par critère

Moyenne des critères sans note (« gris ») sur les 301 parcelles qualifiées de la base de référence :

| Filière | Critères pondérés | Gris en moyenne |
|---|---|---|
| Solaire au sol | 29 | **8,0** |
| Éolien terrestre | 22 | **8,1** |
| Méthanisation | 17 | **7,0** |
| Stockage BESS | 19 | **4,0** |

Les huit critères systématiquement gris en solaire, avec leur cause — et les trois causes sont de
natures très différentes :

| Critère | Cause |
|---|---|
| `fonc_maitrise`, `fonc_nb_proprietaires` | **gris par conception** : les données de propriété exigent une habilitation et un motif ; l'absence est honnêtement déclarée |
| `env_especes_protegees` | **gris par conception** : aucune donnée nationale ne publie de périmètre d'espèces protégées à l'échelle parcellaire |
| `env_tvb`, `pat_archeologie`, `pat_monuments`, `pat_sites` | **l'ingestion n'a jamais tourné** (`patrimoine_culture`, `patrimoine_sites`) |
| `racc_capacite_residuelle` | **la source refuse le relais** : Capareseau répond 502 à travers ce réseau |

### 6.3 Les règles : 52 déclarées, 50 avec lien vérifié, **28 sans signature de juriste**

| Mesure | Valeur |
|---|---|
| Règles réglementaires déclarées | 52 |
| Portant une URL Legifrance **ouverte et relue** | **50** (deux refusées avec motif écrit) |
| Portant `aValiderParJuriste` | **28** |
| `REFERENTIEL_DERNIERE_VERIFICATION` | `2026-07-30` — **volontairement non avancée** |

Les deux relevés Legifrance (7 et 9 septembre 2026) ont ouvert les 52 liens un par un et corrigé
**7 erreurs de fond** : un décret cité à la mauvaise date, un article de code voisin de celui visé,
un intitulé d'arrêté faux, quatre rubriques ICPE ne nommant pas l'article de nomenclature.

**Ce qui n'est pas bon, et ne peut pas l'être sans vous.** Les 28 règles `aValiderParJuriste` sont
utiles en l'état — elles portent leur référence, leur date d'entrée en vigueur et leur lien — mais
elles **s'impriment dans un document remis à un propriétaire foncier**. Aucun test ne peut lire le
Journal officiel : la date de dernière vérification du référentiel n'a donc **pas** été avancée, et
elle ne le sera que par une relecture juridique. C'est le seul point du projet qui n'avance pas par
le code.

### 6.4 Réponse courte

- **Les couches : non.** Deux ingestions sur sept ont tourné ; quatre critères patrimoniaux et
  environnementaux sont gris pour cette seule raison, et un cinquième parce que la source refuse le
  relais. Ce qui est bon, c'est que **rien n'est présenté comme une absence d'enjeu** : le gris est
  déclaré, compté et affiché.
- **Les règles : structurellement oui, juridiquement non.** Les 52 règles sont câblées, datées,
  liées et testées ; 28 attendent une signature. Le premier point est vérifiable et vérifié ; le
  second n'est pas un problème d'informatique.

---

## 7. L'outil de recherche par critères

> « Il faudrait qu'un développeur me donne des critères de recherche bien précis — tant d'hectares
> minimum, dans telle zone, de telle typologie — que je puisse le rentrer dans un outil de recherche,
> et là l'outil me scanne tout un département ou toute une région pour me sortir toutes les parcelles
> propices selon ces critères. »

Une quatrième vue, **Recherche**, part des critères et non de la carte. Quatre entrées, dans l'ordre
où elles ont été demandées : surface minimale, territoire (un département, plusieurs, ou une région
entière), typologie d'implantation, zone (ZAER et zonage du PLU).

### Ce qui rend l'outil honnête plutôt qu'impressionnant

**Il ne balaie pas le cadastre : il balaie ce qui a été qualifié.** Un département compte des
centaines de milliers de parcelles cadastrales, une campagne de qualification en couvre quelques
milliers. Sans précaution, une recherche sur un département jamais balayé répond « 0 résultat » et
« Aucune parcelle ne correspond aux filtres » : deux phrases exactes, et une conclusion **fausse** —
l'opérateur en déduit qu'il n'y a rien à prospecter, et passe au département suivant. Aucun message
d'erreur ne l'aurait signalé, le serveur répondant 200.

Trois dispositifs l'empêchent :

| Où | Quoi |
|---|---|
| Sélecteur de territoire | chaque département porte son nombre de parcelles **déjà qualifiées**, et « jamais balayé » plutôt que « 0 » |
| Bandeau de couverture | « 12 parcelles retenues sur 301 qualifiées — 40 communes sur 365 (11 %) », et sous 90 % : « ce résultat est un minimum, pas un inventaire » |
| Territoire jamais qualifié | message distinct, qui invite à **qualifier** et non à revoir les critères |

Les deux comptes de la couverture sont pris **sans les critères de l'utilisateur** — sinon le
dénominateur vaudrait toujours le résultat, et le bandeau resterait affiché sans plus rien dire.

### Trois décisions de conception, avec leur raison

1. **Les critères sont cumulés, jamais additionnés.** « La région Centre-Val de Loire, mais seulement
   l'Eure-et-Loir » rend le seul 28. Élargir en silence est le sens d'erreur inacceptable pour un
   outil de tri : l'opérateur ne peut pas savoir que sa restriction n'a pas été appliquée.
2. **La typologie se traduit en natures de sol**, parce que le régime d'implantation
   (agrivoltaïsme, terrain dégradé…) est **déduit** de la nature du sol et n'est pas une donnée
   cherchable en soi. La table `REGIME_PAR_TYPE_SOL` est descendue de `@enr/scoring` dans
   `@enr/core` pour que l'interface et le moteur en donnent la même lecture.
3. **La nomenclature des territoires est générée et datée**, pas écrite de mémoire :
   `node scripts/territoires.mjs` la relève sur geo.api.gouv.fr — 18 régions, 101 départements — et
   `packages/core/test/territoires.test.ts` la vérifie hors réseau.

### Vérification

| Contrôle | Résultat |
|---|---|
| `npm run build`, `npm run typecheck` | 0 erreur |
| `@enr/core` | 78/78 (dont 14 nouveaux) |
| `@enr/scoring` | 91/91 |
| `@enr/api` | 519/519 (dont 17 nouveaux) |
| `@enr/web` | 172/172 (dont 13 nouveaux) |
| `test:base`, base fraîchement migrée | 118/118, 4 ignorés |
| Bout en bout | 27/27, 2 ignorés (`@revue`) |
| Mutations du chantier (`--filtre "audit 21"`) | **19/19 attrapées** |

### Ce que le chantier a trouvé au passage

- **Un défaut que j'avais écrit** : le bandeau de couverture déstructurait `couverture` sans
  précaution. Sur une réponse ne la portant pas — capture de référence antérieure, cache du
  navigateur — la vue **entière** disparaissait. Attrapé par quatre tests de rendu existants.
- **Un trou dans le garde d'orthographe** : son périmètre est une liste écrite à la main, et deux
  composants y avaient échappé (`PanneauZones.tsx`, `FormulaireBalayage.tsx`) sans qu'aucun test ne
  baisse. Un test structurel compare maintenant la liste au répertoire des composants.
- **Une vraie faute d'orthographe** révélée par ce périmètre élargi : « 10 m/s sur les cotes les plus
  exposées » dans `packages/core/src/bornes.ts`, où il s'agit bien du littoral.
- **Un faux positif du même garde** : `getByRole('region', …)` faisait accuser le mot « region »
  d'être une graphie périmée de « région », alors que c'est un identifiant ARIA. Un garde qui accuse
  à tort finit désactivé : le premier argument de `getByRole` est désormais écarté de la mesure, et
  une mutation vérifie que l'option `name` continue, elle, d'être relue.

---

## 8. La chaîne complète : des critères au dossier remis au développeur

> « Le développeur me donne des critères : une surface, un type de terrain — agricole, industriel
> abandonné, ou agricole avec un type d'agriculture bien spécifique, ça peut être aussi de
> l'élevage — ou une zone d'accélération. Et le type de projet. Ensuite je lance la recherche dans
> une région, et en fonction des cadastres remontés je sélectionne un certain nombre de cadastres
> pour avoir toutes les informations qui peuvent intéresser le développeur : la distance au poste,
> le type d'agriculture, le PLU, la topographie — pour constituer un dossier que je lui remets et
> qu'il qualifie de son côté. »

Trois maillons. **Deux existaient, un manquait** — et le manquant n'était pas celui qu'on croyait.

### 8.1 Ce qui existait déjà

| Maillon | État | Où |
|---|---|---|
| Sélectionner des cadastres dans les résultats | **existait** | case à cocher par ligne, plafond de 100 |
| Constituer le dossier à remettre | **existait** | bouton « Dossier développeur » → PDF de 13 sections |
| Distance au poste, PLU, topographie, eau, milieux, accès | **existait** | sections dédiées du dossier |

La vue « Recherche » partage le tableau de résultats de la vue « Liste » : les cases à cocher, la
sélection et le bouton de dossier y fonctionnent à l'identique. Le maillon 3 était donc déjà en
place — vérifié de bout en bout (`e2e/dossier-site.spec.ts`).

### 8.2 Le vrai manque : le type d'agriculture, nulle part

Mesuré sur la base de référence : `snapshot.occupationSol.rpg.codeGroupeCulture` est **renseigné**,
avec 14 groupes distincts sur les 301 parcelles. La donnée était là. Elle n'était :

- **ni cherchable** : `typesSol` ne connaît que « agricole exploité ». Une prairie pâturée et un
  champ de blé y sont la même chose, alors que ce sont deux projets, deux interlocuteurs et deux
  types de structure. « De l'élevage » était donc inexprimable ;
- **ni dans le dossier** : les 13 sections portaient l'accès, le raccordement, l'urbanisme, l'eau,
  les milieux et la topographie, mais `occupationSol` n'y était lu **que pour la part boisée**. Le
  développeur qui recevait le dossier devait retourner au RPG lui-même, parcelle par parcelle.

**Corrigé aux trois niveaux :**

| Niveau | Ce qui a été fait |
|---|---|
| Recherche | critère `groupesCulture`, proposé en **familles d'usage** (élevage et prairies, grandes cultures, vignes et vergers, maraîchage, gel, divers) — un développeur demande « de l'élevage », pas « les groupes 16, 17, 18 et 19 » |
| Formulaire | le **type de projet** (filière) devient une entrée du formulaire, et non plus seulement un réglage de la barre du haut |
| Dossier | nouvelle section **« Occupation du sol et agriculture »** : nature du sol, culture déclarée avec son groupe, années consécutives de déclaration, part de la parcelle couverte par l'îlot PAC, AOP |

### 8.3 Trois décisions qui décident de la fiabilité

1. **Le filtre porte sur le CODE, jamais sur le libellé.** Le libellé est figé dans l'instantané à
   la date de qualification ; filtrer dessus ferait dépendre le résultat de la date à laquelle
   chaque parcelle a été qualifiée. Les codes du RPG sont stables depuis le millésime 2015. Le test
   de base sème volontairement un libellé **faux** à côté d'un code juste pour le prouver.
2. **Une parcelle sans déclaration PAC n'est jamais retenue** par le critère d'agriculture. Aucun
   `COALESCE` : demander « de l'élevage » et recevoir une friche non déclarée ferait déplacer un
   développeur pour rien. L'absence de déclaration se cherche par « terrain inculte ».
3. **Le dossier distingue « aucune déclaration PAC » de « donnée indisponible ».** La première est
   un constat — et même un argument favorable en solaire au sol. La seconde est un aveu
   d'ignorance. Les écrire l'une pour l'autre transforme une ignorance en affirmation, dans un
   document remis à un tiers.

### 8.4 Ce que le chantier a trouvé au passage

- **Six libellés affichés sans accent depuis l'origine** : « Ble tendre », « Mais grain et
  ensilage », « Proteagineux », « Legumineuses a grains », « Estives et landes », « Canne a sucre ».
  La table vivait dans `apps/api/src/connecteurs/rpg.ts`, **hors du périmètre du garde
  d'orthographe**. Descendue dans `@enr/core`, elle y est désormais relue.
- **Le postulat du garde d'orthographe est faux pour les homographes.** Il suppose qu'un mot écrit
  des deux façons est une faute ; « mais » (conjonction) et « maïs » (la culture) sont deux mots
  sans rapport. L'arrivée de « maïs » a fait accuser **32 conjonctions** sur six modules. Une liste
  d'homographes, documentée et bornée à cinq entrées, corrige la règle plutôt que d'empiler des
  exceptions qui auraient dit « le verbe mais ».
- **Un de mes propres tests passait trivialement** : mon assertion sur les trois états de la
  déclaration PAC était une disjonction toujours vraie. La mutation qui effondre les deux états a
  survécu et l'a montré. Le test fabrique désormais le cas — aucune fixture ne porte
  `anneesDeclareesConsecutives: null` (mesure : 294 parcelles à 5 ans, 3 à zéro, 3 à trois ans, 1 à
  quatre).

### 8.5 Vérification

| Contrôle | Résultat |
|---|---|
| `npm run build`, `npm run typecheck` | 0 erreur |
| `@enr/core` | 85/85 (+7) |
| `@enr/scoring` | 91/91 |
| `@enr/api` | 525/525 (+6) |
| `@enr/web` | 179/179 (+5) |
| `test:base`, base fraîchement migrée | 123/123, 4 ignorés |
| Bout en bout | 27/27, 2 ignorés (`@revue`) |
| Mutations du chantier (`--filtre "audit 22"`) | **10/10 attrapées** |

### 8.6 Ce qui reste vrai, et qu'il faut redire

Le type de terrain « industriel abandonné » est couvert par la typologie **« Terrain dégradé /
artificialisé »**, qui est un régime **présumé** : le classement en terrain dégradé au sens du
décret n° 2023-1408 suppose d'établir l'historique du site — ancienne carrière, décharge, friche,
pollution — ce qu'aucune couche d'occupation du sol ne dit. La recherche oriente ; elle ne qualifie
pas.

Et le RPG paraît avec environ **deux ans de décalage** : « prairie permanente » relevé sur le
millésime 2023 n'affirme rien sur ce qui pousse aujourd'hui. Le formulaire et le dossier le disent
tous les deux.
