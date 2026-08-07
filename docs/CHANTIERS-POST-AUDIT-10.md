# Chantiers d'après l'audit 10

> Ce document n'est **pas un audit**. C'est le compte rendu des quatre chantiers que l'audit 10 avait
> laissés ouverts et qui ne dépendaient de personne d'autre que du code : §D3 (l'interface non
> couverte), §F2 (un seul rapport PDF relu), §F4 (le cycle d'effacement jamais observé), et l'absence
> de mutations sur `apps/web`. La même exigence s'y applique : **aucune affirmation qui ne soit
> mesurée ou exécutée.**

---

## Résumé

Quatre chantiers menés, **six défauts trouvés et corrigés** — dont aucun n'était visible avant que
l'outillage ne soit construit. Deux d'entre eux touchaient un livrable remis à un tiers.

| # | Défaut | Où | Visible avant ? |
|---|---|---|---|
| 1 | « poids **10.7** % » à trois lignes de « 19,05 ha » | fiche, 29 critères × chaque parcelle | non |
| 2 | « **7.8** km » sur les distances de zonage | fiche | non |
| 3 | « Occupation du sol : **agricole_exploite** » | rapport PDF remis au propriétaire | non |
| 4 | « Fondement : **eol_distance_habitation** » | rapport PDF, parcelle écartée | non |
| 5 | Réécriture du patrimoine culturel sans `updated_at` | ingestion — piège latent | non |
| 6 | Borne de 900 caractères dans un garde structurel | outillage | non |

Et un piège d'outillage désamorcé avant de produire quoi que ce soit de faux : **zustand sert l'état
*initial* en rendu serveur**, si bien que tout état posé par un test de rendu était silencieusement
ignoré.

---

## Chantier A — Monter réellement les composants

### Le constat de départ, mesuré

| Espace | Source | Tests | Ratio |
|---|---|---|---|
| `apps/api` | 17 013 | 7 997 | 0,47 |
| `packages/core` | 2 270 | 763 | 0,33 |
| `packages/scoring` | 3 566 | 1 116 | 0,31 |
| **`apps/web`** | **6 330** | **709** | **0,11** |

Quatre fois moins que l'API, sur la seule partie que l'utilisateur regarde. Et les cinq fichiers
existants n'assemblaient aucun composant : ils vérifiaient des fonctions pures et des propriétés du
source. **Aucun test du projet n'avait jamais affiché une page.**

### Le choix technique, et ce qu'il ne couvre pas

`react-dom/server` est déjà une dépendance de l'application. `renderToStaticMarkup` exécute la vraie
phase de rendu de React sur l'arbre réel de composants — **aucune dépendance ajoutée**, ni jsdom, ni
testing-library, ni navigateur.

Il faut dire ce que cela ne couvre pas : le rendu serveur n'exécute pas les `useEffect`, ne déclenche
aucun événement, et ne peut donc rien dire des clics ni des transitions d'état. Il couvre exactement
une chose — **le texte qu'un composant produit à partir d'un état donné** — et c'est précisément là que
vivaient les défauts de l'audit 10. Les interactions restent du ressort des tests de bout en bout, dont
la décision revient au propriétaire du projet.

### Les fixtures sont réelles, et c'est le point

Une fixture écrite à la main ne contiendrait que les cas auxquels j'ai pensé ; les défauts vivent dans
les autres. `apps/api/scripts/capturer-fixtures-web.ts` prend la réponse **exacte** de la route, via
`app.inject()`, pour de vraies parcelles :

| Cas | Ce qu'il apporte |
|---|---|
| 4 filières sur une parcelle de 19,84 ha | les quatre profils de critères |
| parcelle de 0,09 ha | trois limites de viabilité, dont « surface très insuffisante » |
| **éolien sur la grande parcelle** | **le cas ÉCARTÉ** : rouge, score `null`, 2 knock-outs |
| liste solaire (50 sur 439) + liste éolienne | la vue la plus consultée, avec le cas à knock-out |
| tableau de bord | les agrégats |

### Le défaut trouvé au premier rendu

```
… Statut et nature du sol   Terrain agricole exploite   poids 10.7 % · note 45/100 …
… Surface utile             19,05 ha implantables       …
```

Deux conventions typographiques à trois lignes d'écart. C'est **le défaut B1 de l'audit 10**, à
l'endroit où son garde ne regardait pas : ce garde inspecte les chaînes produites par le **moteur**, or
le poids des critères et les distances de zonage sont mis en forme par l'interface elle-même, avec
`toFixed` au lieu de `formatNombre` — qui était pourtant importé dans le même fichier.

**Mesuré sur les cinq fiches réelles : 142 occurrences → 7.** Les 7 restantes sont légitimes : la
version du moteur (`1.4.0+b24e3f16`) et les rubriques IOTA (`2.1.5.0`, `3.3.1.0`, art. R.214-1), où le
point est la notation officielle.

Le garde posé n'est pas une liste d'exceptions — une liste grossit à chaque faux positif jusqu'à
excuser un vrai défaut. Il est **structurel** : un nombre décimal français a exactement **deux** groupes
de chiffres autour d'un point ; les versions et les nomenclatures en ont trois ou quatre. Compter les
groupes suffit, sans nommer aucune valeur.

### Le piège d'outillage, et pourquoi il méritait d'être traité et non contourné

Un test masquait un avertissement §12 puis vérifiait sa disparition. Il échouait. La cause n'est pas
dans l'application : **zustand v5 passe `getInitialState` comme instantané serveur** à
`useSyncExternalStore`, délibérément, pour garantir l'absence d'écart d'hydratation. En rendu serveur,
`useEtat.setState(...)` n'a donc **aucun effet sur ce qui est rendu**.

C'est un producteur de tests décoratifs : toute branche pilotée par le store se serait rendue avec
l'état par défaut, en silence. Réassigner `useEtat.getInitialState` ne sert à rien — `create()` fait
`Object.assign(hook, api)`, donc la propriété du hook est une copie tandis que le rendu appelle celle de
l'`api` interne. Ce qui marche s'appuie sur une propriété vérifiable : `setState` **remplace** l'objet
d'état, donc tant que personne ne l'appelle, l'état courant *est* l'objet initial ; le muter en place le
rend visible aux deux instantanés. La condition « tant que personne n'a appelé `setState` » n'est pas
supposée : elle est **vérifiée à chaque rendu et sa rupture lève**.

### Résultat

**Ratio 0,11 → 0,23**, 19 tests de rendu répartis sur trois fichiers. Le bandeau §12 a dû être extrait
d'`App.tsx` vers `components/` : il n'était joignable qu'en montant `App`, donc la carte MapLibre, donc
un navigateur — il était par construction hors d'atteinte de tout test, alors qu'il porte la clause non
négociable de l'outil.

---

## Chantier B — Étendre la vérification par mutation à l'interface

**Comptage avant**, mesuré et non supposé :

| Espace | Mutations |
|---|---|
| `apps/api` | 26 |
| `packages/scoring` | 3 |
| `db/migrations` | 1 |
| **`apps/web`** | **0** |

Rien ne prouvait donc que les tests de l'interface ne soient pas décoratifs — sur la partie la moins
couverte du dépôt. **Huit mutations ajoutées** (42 au total après les deux décisions), dont une qui mute le **harnais de test
lui-même** (« l'état posé par un test de rendu redevient silencieusement ignoré ») : elle verrouille
exactement le piège zustand ci-dessus.

Deux ajustements ont été nécessaires, chacun instructif :

- **`cwd` par mutation.** Les tests de rendu importent des `.tsx`, dont la transformation JSX dépend de
  `apps/web/tsconfig.json`. Il n'existe pas de `tsconfig.json` à la racine : lancé depuis la racine,
  `tsx` échoue sur « React is not defined ». Ce n'est pas un échec de test mais un échec de
  **chargement**, et il aurait été compté comme une mutation attrapée — un faux vert dans l'outil même
  qui traque les faux verts.
- **Un filtre `--filtre`.** Quarante mutations demandent une quinzaine de minutes. Sans moyen d'en rejouer un
  sous-ensemble, la tentation est de muter à la main pendant le développement, ce qui a déjà laissé deux
  fois un fichier source muté après une interruption (audit 10, §H2).

---

## Chantier C — Relire un rapport PDF par filière et une parcelle écartée

Le risque F2 disait exactement le bon problème : le rapport n'avait été relu **qu'une fois**, sur une
parcelle agricole en solaire. C'est cette relecture qui avait trouvé le défaut B2 (sept dates ISO par
rapport). Trois familles de pages n'avaient jamais été regardées.

Les quatre autres relectures ont trouvé **deux défauts, tous deux de la famille « le rapport ne dit pas
la même chose que la fiche »** — la famille que l'audit 10 avait déclarée close après un seul document.

| | Le rapport écrivait | La fiche affichait |
|---|---|---|
| Occupation du sol | `agricole_exploite` | Terrain agricole exploité |
| Fondement du rejet | `eol_distance_habitation` | Code de l'environnement, art. L.515-44, en vigueur depuis le 25/06/2020 |

Le premier apparaît à la ligne suivant « Contenance cadastrale : 19,84 ha ». La table de libellés
existait, complète et juste, dans `packages/scoring` — elle n'était simplement pas exportée. Le second
n'apparaît **que sur une parcelle écartée**, et la seule relecture faite jusque-là portait sur une
parcelle qui ne l'était pas.

Ce qui a été vérifié sans rien trouver, sur les cinq rapports : **zéro date ISO** (B2 tient sur toutes
les filières, pas seulement celle qui avait été relue) et zéro nombre à point décimal hors les
coordonnées WGS84 — exception documentée à l'audit 10, la paire étant séparée par une virgule.

La relecture est maintenant **rejouée à chaque exécution**, avec un extracteur de texte PDF écrit sans
dépendance ni binaire externe. `pdftotext` aurait fait l'affaire, mais il n'est pas installé partout :
en faire une dépendance de CI, c'est accepter que la vérification saute silencieusement le jour où
l'image change. `zlib` suffit — les flux sont en Flate, et pdfkit écrit ses chaînes en hexadécimal.

*Note sur une erreur commise en l'écrivant.* La première version ne lisait que les chaînes littérales
`(texte)` et extrayait donc **zéro caractère**. Un garde typographique sur un texte vide ne trouve aucune
faute et se déclare satisfait : le test décoratif parfait. C'est pour cela que l'extraction est appelée
derrière un contrôle de longueur minimale — une extraction qui échoue doit se voir, pas se taire. C'est
ce contrôle qui a signalé la panne.

---

## Chantier D — Observer le cycle d'effacement des objets disparus

Le risque F4 était ouvert depuis l'audit 9. Ce qui manquait n'était pas un test de plus : le mécanisme
repose sur un **contrat entre deux morceaux de code qui ne se connaissent pas.**

- `effacerDisparus` déclare disparue toute ligne dont `updated_at` précède le début du run ;
- chaque ingestion doit donc, en réécrivant une ligne, remettre `updated_at = now()`.

**Le second membre n'était vérifié nulle part.** La réécriture du patrimoine **culturel** ne le
respectait pas. Le connecteur n'étant pas encore soumis à l'effacement, le défaut n'était pas actif —
c'était un piège pour le jour où on l'y soumettrait : tous les monuments seraient passés d'un coup pour
disparus, le plafond de volumétrie les aurait sauvés (100 % dépasse largement 20 %), et la suppression
n'aurait alors **jamais** fonctionné pour ce connecteur, avec un avertissement tombant à chaque
ingestion sans que sa cause soit lisible. *Un mécanisme de sécurité qui refuse toujours est
indistinguable d'un mécanisme qui marche, jusqu'au jour où l'on compte sur lui.*

Le cycle est désormais observé de bout en bout contre PostgreSQL :

| Scénario | Attendu | Observé |
|---|---|---|
| 100 objets, la source n'en republie que 90 | 10 effacés, 90 intacts | conforme |
| 100 objets, la source republie les 100 | 0 effacé, 0 ligne périmée | conforme |
| 100 objets, la source n'en republie que 30 | refus, couche entière préservée | conforme, motif citant le plafond |

Et un **garde structurel** couple les deux membres du contrat : toute table soumise à l'effacement voit
désormais chacune de ses réécritures vérifiée. C'est ce garde qui portera le prochain oubli, pas une
relecture.

---

## Le défaut que ces chantiers ont causé

**Un nombre magique dans un garde structurel.** Le garde d'alimentation bornait à **900 caractères** la
capture d'un `INSERT INTO contrainte`. Les dix lignes de commentaire ajoutées au chantier D ont repoussé
le backtick fermant au-delà de la fenêtre : le garde a annoncé « les monuments historiques doivent être
ingérés », c'est-à-dire un défaut d'ingestion, alors que rien de l'ingestion n'avait changé.

Un nombre magique dans un garde ne se déclenche pas à l'écriture, mais le jour où quelqu'un allonge le
code surveillé — et il accuse alors le mauvais coupable. La borne était de surcroît inutile : le
littéral SQL est délimité par des backticks et n'en contient aucun.

*Et une rechute à signaler* : ma première version du commentaire du chantier D contenait des backticks à
l'intérieur d'un littéral SQL, ce qui termine le littéral. C'est la troisième fois de ces audits. Le
garde structurel l'a attrapée immédiatement — ce qui est exactement ce qu'on lui demande.

---

## Vérification

| | |
|---|---|
| Construction | 0 erreur TypeScript |
| Suite complète | **617 tests, 0 échec** sur base fraîche (583 avant ces chantiers) |
| Tests exigeant PostgreSQL | 9 fichiers, tous verts, tous ajoutés à la CI |
| Vérification par mutation | **42/42 attrapées** (40 par défaut + 2 de bout en bout) |
| Tests de bout en bout | **12/12**, 44 s, sur le parcours exact de la CI |
| Ratio de couverture `apps/web` | **0,11 → 0,23** |

---

## Les deux décisions du propriétaire, prises et appliquées

### Décision 2 — Le format des exports

**Changement cassant, assumé et documenté.** Le CSV livrait `gris`, `a_prospecter`,
`agricole_exploite` — le vocabulaire interne du code — et une longitude à dix-sept chiffres
significatifs. Il livre désormais « Données manquantes », « À prospecter », « Terrain agricole
exploité », et six décimales (≈ 7 cm en longitude). Un filtre construit sur les anciennes valeurs ne
les trouvera plus : c'est le prix, et il était connu avant d'être payé.

Deux choix méritent d'être justifiés :

- **Une absence reste une case vide.** `null` sur le statut de prospection signifie « aucun suivi
  ouvert » ; inventer un libellé pour une absence est la faute fondatrice de ces audits, sous sa forme
  la plus bénigne.
- **Le GeoJSON et le Shapefile ne changent pas, ils s'enrichissent.** Ces formats sont consommés par
  des programmes et des SIG, où une clé stable est exactement ce qu'on veut — la remplacer casserait
  toute règle de symbologie. Mais un SIG affiche aussi sa table d'attributs à un humain. Les libellés
  sont donc **ajoutés à côté** des clés, sans rien retirer. L'asymétrie avec le CSV n'est pas une
  incohérence : c'est le destinataire qui tranche.

### Décision 1 — Les tests de bout en bout

**12 spécifications, 44 secondes, un job de CI dédié.** Elles convertissent en garde permanent les six
vérifications navigateur que l'audit 10 avait faites à la main, une fois, sur une parcelle. Et elles
sont seules à prouver une chose élémentaire : **que l'application démarre.**

#### Deux défauts trouvés, dont un sérieux

**Une boucle de déconnexion sur session valide.** `transformRequest` n'attachait le jeton qu'aux tuiles
`/api/carte/tuiles/parcelles/`. Toutes les autres ressources authentifiées de la carte partaient sans
jeton — au premier chef les **calques**. L'API répondait 401, et le gestionnaire d'erreur de la carte
traite tout 401 venant de notre origine comme une session expirée. Mesuré dans un vrai navigateur :
quelques centaines de millisecondes après la connexion, quatre 401, « Session expirée », retour au
formulaire.

Le filtre étroit avait une bonne raison, écrite à l'époque : ne jamais envoyer notre jeton à un tiers.
Cette raison est intacte — la condition reste ancrée sur `RACINE_ABSOLUE`, notre origine. **Ce qui était
trop étroit, c'était le chemin, pas l'origine.**

**L'écran d'ouverture repartait de zéro.** Rendu à deux endroits d'`App`, sous des parents différents.
React reconcilie par position : au passage du chargement à l'application, le composant était démonté
puis remonté, son minuteur redémarrait, et une touche pressée avant la transition était perdue — alors
que le composant promet « toute touche ou tout clic abrège : personne ne doit subir une animation ».

#### Trois erreurs de conception que j'ai commises, et ce qu'elles enseignent

Elles valent d'être écrites, parce que ce sont les modes de défaillance qui font abandonner un parc de
tests de bout en bout.

1. **Onze connexions ont atteint le plafond anti-bourrinage** (dix par quinze minutes). La onzième
   spécification échouait, systématiquement, sans rapport avec ce qu'elle vérifiait. La tentation était
   de relever le plafond ou de l'exempter en test : **ce serait affaiblir une protection réelle pour
   arranger un outil de vérification.** Une seule connexion, réutilisée — qui est aussi la pratique
   recommandée, et trois fois plus rapide.
2. **J'interrogeais le formulaire avant que l'application ait tranché** entre chargement, connexion et
   application. Deux spécifications échouaient de façon intermittente selon la charge de la machine.
   Et j'ai reproduit le défaut à l'identique dans une seconde copie de la routine de connexion :
   *deux copies d'une même logique se corrigent une fois sur deux.*
3. **Mon premier job de CI semait avec `npm run seed`**, qui qualifie un secteur en interrogeant les
   VRAIES API officielles. La CI aurait consommé à chaque push le quota de services publics partagés —
   exactement le reproche du défaut B4 de l'audit 10 — et échoué à chaque 503 d'un tiers. Le semis se
   fait désormais hors réseau, depuis les fixtures déjà capturées : donnée réelle, aucun appel.

#### Un incident local, à signaler

Mes premières exécutions e2e ont tourné contre la base de développement avec l'amorçage automatique
encore actif : le serveur y a ingéré 102 départements de monuments historiques. Cinq tests de
couverture de disque, qui lisent précisément cette table, sont devenus rouges — **sur l'état de la
base, pas sur le code**. Vérifié : les mêmes tests passent sur une base fraîche, et le diff ne touche
aucune logique de couverture. `AMORCAGE_AUTO=false` est désormais posé dans la configuration e2e, avec
la raison écrite à côté.

---

## Ce qui reste, et qui ne dépend pas du code

Inchangé, et c'est le plafond réel :

1. **La campagne de validation sur des parcelles réelles.** L'outil est prêt
   (`scripts/campagne-validation.mjs`) depuis quatre audits ; il ne manque que quelqu'un pour ouvrir les
   plans et remplir la seconde colonne. C'est le seul chantier qui transformerait « le calcul est
   correct » en « le résultat est juste sur le terrain ».
2. **Une revue juridique du référentiel** par quelqu'un qui engage sa signature.
3. **Des devis de raccordement réels** pour étalonner les paliers de distance.
4. **Un test d'usage sur le poste d'un prospecteur.**

Les deux décisions qui appartenaient au propriétaire sont désormais **prises et appliquées** — voir la
section qui précède.
