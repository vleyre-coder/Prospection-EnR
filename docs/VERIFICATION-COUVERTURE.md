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
