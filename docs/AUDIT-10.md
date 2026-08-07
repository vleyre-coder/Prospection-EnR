# Dixième audit complet — le dernier centimètre, 7 août 2026

Audit conduit simultanément sous six angles : développeur senior, architecte logiciel, chef de
produit, expert UX/UI, expert QA, expert métier ENR. Neuf domaines vérifiés : moteur de scoring,
connecteurs de données externes, cohérence métier et conformité réglementaire, base de données et
migrations, API (validation, sécurité, RGPD), interface, exports et livrables, robustesse
d'exploitation, qualité technique et documentation.

**Méthode.** Aucune affirmation de ce rapport ne vient d'une lecture du code seule. Cet audit ajoute
un instrument que les neuf précédents n'avaient pas employé : **l'application a été lancée et pilotée
dans un vrai navigateur**, et ce qu'elle affiche a été comparé, champ par champ, à ce que l'API
renvoie. Le rapport PDF a été généré puis relu par extraction de texte. Chaque correction est vérifiée
par mutation.

**État de départ, mesuré avant d'ouvrir l'audit.** 574 tests, zéro échec ; zéro erreur de typage ;
26/26 mutations rattrapées ; arbre de travail propre et poussé.

**La question de cet audit.** Les neuf précédents portaient tous sur la DONNÉE et le CALCUL : la
valeur est-elle juste, a-t-elle une source, la réponse rendue est-elle celle que la donnée permet.
Celui-ci porte sur les derniers centimètres, ceux que personne n'avait mesurés : **entre le calcul
juste et l'œil de l'utilisateur, qu'est-ce qui se dégrade ?**

Le choix n'est pas arbitraire, il vient d'une mesure. Rapport lignes de test / lignes de source :

| Espace | Source | Tests | Ratio |
|---|---|---|---|
| `apps/api` | 16 902 | 7 748 | **0,46** |
| `packages/core` | 2 270 | 763 | 0,34 |
| `packages/scoring` | 3 562 | 983 | 0,28 |
| **`apps/web`** | **6 286** | **709** | **0,11** |

L'interface est quatre fois moins couverte que l'API, et c'est la seule partie que l'utilisateur
regarde. Les cinq fichiers de test de `apps/web` n'assemblent d'ailleurs aucun composant : ils
vérifient des fonctions pures et des propriétés du source. **Aucun test du projet n'avait jamais
affiché une page.**

**Résultat.** Quatre défauts confirmés et corrigés — dont un révélé par l'exécution de la
vérification elle-même — puis trois autres nés de mon propre travail et corrigés à leur tour (§H). Et un résultat qui compte autant : sur les six vérifications conduites dans le navigateur,
**quatre n'ont trouvé aucun défaut** — ce qui est une information, pas un vide.

---

## A. Ce qui fonctionne bien

**La fiche parcelle est fidèle à l'API, champ par champ.** Vérification automatisée sur une parcelle
réelle : les **29 critères** du score renvoyé par `/api/parcelles/:idu` voient leur `valeurAffichee`
reprise **à l'identique** dans le panneau rendu par le navigateur — aucune valeur reformatée en
chemin, aucune divergence. C'est exactement le défaut B4 de l'audit 8 (le tableau du PDF divergeait de
la synthèse) qui ne s'est PAS reproduit ailleurs.

**Le rapport PDF est fidèle à la fiche.** Le même score, le même statut, la même couverture, les
mêmes surfaces : « 61 », « Donnees manquantes », « 76 % », « 0,77 ha », « 0,52 ha implantables »
figurent dans les deux, identiques. Les trois limites de viabilité y sont reprises intégralement,
avec leur motif circonstancié.

**Le parcours au clavier est complet et le focus toujours visible.** Mesuré dans le navigateur :
40 tabulations, 30 cibles distinctes, **zéro élément recevant le focus sans contour ni ombre**, et
**zéro focus posé sur un élément non affiché** — le piège classique d'un panneau replié qui reste
tabulable. Rien à corriger.

**La feuille de style d'impression existe et cible ce qu'il faut.** 10 règles sous `@media print`,
qui masquent la barre, le panneau gauche, la carte et les boutons d'action, et déplient les sections.
Le bouton « Imprimer » de la fiche produit donc un document lisible, et non une capture d'écran.

**Le CSV est correctement localisé.** Vérifié colonne par colonne : surface, score, pente, longitude
et latitude utilisent tous la virgule décimale, dans un fichier à séparateur point-virgule — donc
directement exploitable dans un tableur configuré en français.

**La limitation de débit est atomique.** Relecture sous l'angle de la concurrence : la lecture du
seau, le calcul du réapprovisionnement et le décrément du jeton se suivent sans aucun `await`. Deux
requêtes simultanées ne peuvent donc pas passer toutes les deux — le modèle d'exécution de Node le
garantit, et le code ne l'a pas cassé.

**L'exception documentée est une vraie exception.** Le rapport écrit les coordonnées
« 48.15761 N, 1.76966 E » avec un point décimal, et j'ai d'abord cru à un défaut. Le commentaire au
point d'emploi explique le choix : la paire est déjà séparée par une virgule, donc
« 48,15761 N, 1,75000 E » serait ambigu, et ces coordonnées sont faites pour être recopiées dans un
outil cartographique qui attend le point. **Ce n'est pas un défaut, et le corriger aurait été une
régression.**

---

## B. Défauts confirmés

### B1 — Le moteur écrivait des points décimaux dans des phrases françaises

**Le fait.** Le moteur ne renvoie pas seulement des nombres, il renvoie des **phrases**, et ces
phrases sont le livrable : elles s'affichent dans la fiche, elles sont imprimées telles quelles dans
le rapport remis à un propriétaire ou à un financeur, et elles partent dans les exports. Le projet
possède un formateur unique, `formatNombre`, qui écrit la virgule décimale. **Quatre endroits le
contournaient** et interpolaient le nombre brut, ce qui mélangeait les deux conventions dans une même
phrase :

> « La parcelle offre environ **0,14** ha implantables (**0,37** ha au cadastre), en dessous de la
> surface minimale indicative de **0.5** ha pour la filière Stockage. »

> « Puissance estimee **0.38** MWc : declaration prealable (estimation a raison de **0,5** MWc/ha). »

**La mesure.** Score recalculé sur les **439 parcelles réelles** de la base de développement × 4
filières, en inspectant chaque chaîne destinée à l'utilisateur :

| Champ | Occurrences |
|---|---|
| `seuil.pv_permis_construire.commentaire` | 435 |
| `avertissement` (dérivé des limites) | 78 |
| `limite.viab_surface_insuffisante.motif` | 73 |
| `limite.viab_surface_tres_insuffisante.motif` | 5 |
| **Total** | **591** |

**Pourquoi ce n'est pas seulement cosmétique.** Le document part à un propriétaire foncier, à une
collectivité, à un financeur. Une phrase qui écrit deux fois la virgule et une fois le point sur la
même ligne signale au lecteur attentif que personne n'a relu — et sur un outil d'aide à la décision,
la confiance dans le chiffre se construit aussi là.

**Correction.** Les quatre sites passent par `formatNombre`. Nouvelle mesure sur la même population :
**zéro occurrence**.

**Ce qui empêche le retour du défaut.** Un garde n'inspecte pas le code mais **les chaînes réellement
produites** : il calcule des scores sur des parcelles choisies pour atteindre les phrases à nombres,
puis refuse tout point décimal. Un nouveau critère, un nouveau seuil de procédure ou un nouveau motif
de knock-out serait pris immédiatement, sans que personne ait à se souvenir de la règle. Le garde
vérifie aussi qu'il atteint bien ces phrases — sinon il passerait à vide.

### B2 — Le rapport PDF mêlait deux conventions de date

**Le fait.** Le rapport écrit « rapport du 07/08/2026 » en première page, puis « Permis de construire
obligatoire … **depuis le 2022-10-01** » dans le tableau des seuils de procédure, et
« Referentiel reglementaire verifie le **2026-07-30** » en pied de document. Mesuré sur un rapport
réel : **7 dates au format ISO** dans un document par ailleurs francisé.

**Pourquoi le garde existant ne l'a pas vu, et c'est le plus intéressant.** L'audit 5 avait déjà
trouvé « 10.7 % » dans ce même rapport et posé un garde structurel — qui ne surveille que les
`toFixed` décimaux. Un garde qui surveille un seul motif donne l'illusion de couvrir un sujet : la
localisation du rapport paraissait tenue, alors qu'une moitié n'était pas regardée.

**Correction.** Les deux dates passent par `dateFr`. Vérifié sur un rapport régénéré : **zéro date
ISO**, « depuis le 01/10/2022 », « verifie le 30/07/2026 ». Un second garde structurel refuse
désormais toute interpolation dont le nom évoque une date sans mise en forme française.

### B3 — Une ingestion nationale pouvait se lancer en parallèle d'elle-même

**Le fait.** `lancerIngestion` est appelée depuis trois endroits — la route d'administration
`POST /api/admin/ingestions/:connecteur`, le script `npm run ingest`, et l'amorçage au démarrage — et
**aucun des trois ne s'excluait des deux autres**. La route n'avait ni verrou ni limitation de débit,
alors qu'elle déclenche le traitement le plus lourd du projet : l'ingestion des ZAER lit 1,09 million
d'objets sur le WFS de la Géoplateforme en une vingtaine de minutes. Deux appels rapprochés faisaient
donc deux fois le même téléchargement, sur un quota partagé par toute l'équipe, et le second
n'apportait rien.

**Ce qui rend le défaut instructif : la protection existait déjà, au bon endroit.** L'amorçage prend
un verrou consultatif, avec cette justification exacte — « en développement, `tsx watch` relance le
serveur à chaque sauvegarde. Sans ce verrou, une modification de code pendant l'ingestion des communes
en déclencherait une seconde en parallèle. » Le raisonnement était fait, écrit, appliqué à un
déclencheur, et jamais étendu aux deux autres.

**Pourquoi cela devient plus grave depuis l'audit 9.** L'ingestion efface désormais ce qui a disparu
de la source. Le raisonnement complet a été fait : les horodatages de revue rendent l'effacement sûr
même en concurrence, parce qu'une exécution ne peut supprimer que ce qu'aucune des deux n'a revu.
Il n'y a donc **pas** de perte de données — mais le doublement du téléchargement, lui, est réel.

**Correction.** Un verrou consultatif par connecteur, non bloquant : un second appel est refusé
**immédiatement** avec un motif explicite, et la route répond **409** et non 502 — une ingestion déjà
en cours n'est pas une panne, c'est un conflit, et l'échec ne doit pas être inscrit au journal des
sources, la source n'ayant rien fait de mal. Six tests contre PostgreSQL, dont deux vérifiés par
mutation.

### B4 — Un test de contrôle d'accès lançait une campagne réelle de 438 parcelles

**Le fait, découvert en exécutant la vérification de cet audit.** `acces-roles.test.ts` vérifie qu'un
compte de prospection n'est PAS refusé sur `POST /api/qualification/emprise`. Il envoyait pour cela une
emprise valide, avec ce commentaire : « la suite échoue faute de base, mais le refus de rôle n'a pas eu
lieu : c'est ce qu'on vérifie ». L'hypothèse était vraie quand le test a été écrit. Elle est fausse
depuis que la CI et le poste de développement fournissent une base.

**Ce que cela produisait, mesuré.** Avec `DATABASE_URL` défini, cet appel lance une **qualification
réelle de 438 parcelles** : 1 082 parcelles trouvées, 438 retenues, chacune enrichie par des appels au
cadastre, au GPU, à Géorisques et à l'altimétrie. Constaté en base pendant l'exécution : 138 snapshots
réécrits en cinq minutes, soit une dizaine de minutes pour la campagne entière — **à chaque
`npm test`**.

Trois conséquences, et chacune contredit un principe que le projet défend ailleurs :

- la suite passe d'environ deux minutes à douze, et **un test lent est un test qu'on finit par ne plus
  lancer** — exactement le raisonnement que j'ai appliqué à mon propre test du verrou (§H1) ;
- le **quota partagé** des services publics est consommé par un test de contrôle d'accès, alors que le
  projet a construit profils de reprise, pauses entre pages et limitation de débit pour le ménager ;
- 438 snapshots et leurs scores sont réécrits en base par un simple `npm test`.

**Correction.** `bbox` est omis de la charge utile. Le contrôle de rôle s'exécute AVANT la validation
du corps : la réponse est donc 400 et non 403, l'invariant testé est identique, et rien n'est lancé.
Le test assère désormais les deux codes — pas 403, et bien 400 — ce qui rend l'intention plus lisible
qu'avant. Vérifié : les 14 tests du fichier passent en quelques secondes.

**Pourquoi cela figure en §B et non en §H.** Ce n'est pas un défaut que j'ai introduit : il dormait
depuis l'audit 3, quand la CI n'avait pas de base. Il a été révélé par la vérification de cet audit —
ce qui est une façon légitime de trouver un défaut, et vaut d'être noté : **exécuter la vérification
est aussi une mesure.**

---

## C. Ce qui a été vérifié sans rien trouver

Une section utile, parce qu'un audit doit dire où il a regardé, pas seulement ce qu'il a trouvé.
Chaque ligne est une vérification exécutée, pas une intuition.

| Vérification | Instrument | Résultat |
|---|---|---|
| Fidélité fiche ↔ API, 29 critères | navigateur + comparaison automatique | conforme |
| Fidélité PDF ↔ fiche | extraction de texte du PDF | conforme |
| Erreurs JavaScript à l'usage | console du navigateur | aucune |
| Tuiles cartographiques | proxy et API interrogés | 200, 2 773 octets ; les abandons observés sont des annulations de MapLibre au déplacement de la carte, pas des échecs |
| Focus clavier | 40 tabulations mesurées | 30 cibles, focus toujours visible |
| Feuille d'impression | inspection du CSSOM rendu | 10 règles, ciblage correct |
| Localisation du CSV | analyse colonne par colonne | virgule décimale partout |
| Atomicité de la limitation de débit | relecture sous l'angle de la concurrence | pas d'`await` dans la section critique |
| Effacement concurrent des objets disparus | raisonnement sur les horodatages de revue | sûr, pas de perte de données |

---

## D. Améliorations relevées, non traitées

**D1. Les exports portent des valeurs d'énumération brutes.** Le CSV écrit `gris` et `a_prospecter`
là où l'interface affiche « Données manquantes » et « À prospecter ». Les en-têtes sont en français
soigné, les valeurs non : un destinataire externe n'a pas la clé de lecture. Correction simple —
traduire à l'export — mais elle change le format d'un fichier que l'utilisateur peut déjà consommer
dans ses propres tableurs et modèles. **C'est sa décision, pas la mienne** : la signaler vaut mieux
que casser silencieusement un format en place.

**D2. La longitude est exportée avec 16 décimales** (`1,7455783348199738`), soit une précision
affichée de l'ordre du nanomètre pour une donnée dont la précision réelle est métrique. Sans
conséquence de calcul, mais c'est de la fausse précision dans un livrable. Même remarque que D1 sur le
changement de format.

**D3. Le ratio de couverture de l'interface reste à 0,11.** Cet audit ajoute des vérifications
conduites dans le navigateur, mais elles ne sont pas des tests automatisés : Playwright n'est pas une
dépendance du projet, et l'y ajouter est une décision d'outillage qui engage la CI. La question à
trancher est : veut-on des tests de bout en bout dans la CI, avec le coût de maintenance associé ?

---

## E. Erreurs métier

**E1. Un document mal localisé abîme la crédibilité de chiffres justes.** Les défauts B1 et B2 ne
faussent aucun calcul. Ils portent sur le seul objet que voit un tiers — le rapport de parcelle — et
sur un outil d'aide à la décision, l'apparence de rigueur fait partie de la valeur. Un propriétaire
qui remarque « 0.5 ha » et « 0,14 ha » dans la même phrase n'en conclura pas que le formateur a été
contourné : il en conclura que le document n'a pas été relu.

**E2. Doubler une ingestion nationale, c'est doubler la consommation d'un quota qui n'est pas à
nous.** Les services de la Géoplateforme, de GRDF et de Capareseau sont partagés. Le projet a
construit tout un appareillage pour les ménager — profils de reprise, pauses entre pages, limitation
de débit sortante — et laissait le déclencheur le plus lourd sans protection. Ce n'est pas un défaut
de fiabilité, c'est un défaut de civilité technique, et il se paie en blocages.

---

## F. Risques résiduels

**F1. Les vérifications du navigateur ne sont pas rejouées par la CI.** Elles ont été conduites une
fois, sur une parcelle. Voir D3.

**F2. Un seul rapport PDF a été relu en entier.** Les dates et nombres vérifiés sont ceux d'une
parcelle agricole en Beauce. Une parcelle déclenchant un knock-out, ou une filière méthanisation avec
son tableau d'intrants, produirait d'autres phrases.

**F3. Les éléments de priorité 5 hérités restent entiers** : campagne de validation par un expert sur
50 parcelles réelles, devis de raccordement réels pour recalibrer les paliers de distance, revue
juridique du référentiel réglementaire, test d'usage sur le poste d'un prospecteur.

**F4. Le cycle complet d'effacement des objets disparus n'a toujours pas été observé** sur deux
ingestions nationales successives (hérité de l'audit 9, §F3).

---

## G. Améliorations classées par priorité

1. **Trancher la question des tests de bout en bout** (D3). Les vérifications de cet audit montrent
   ce qu'ils apporteraient ; leur coût de maintenance est réel et la décision revient au propriétaire
   du projet.
2. **Traduire les valeurs d'énumération dans les exports** (D1) et **borner la précision des
   coordonnées** (D2), après accord sur le changement de format.
3. **Observer un cycle complet d'effacement sur deux ingestions nationales successives** (F4).
4. **Relire un rapport PDF pour chacune des quatre filières et pour une parcelle écartée** (F2).
5. **Les quatre éléments de priorité 5 hérités** (F3), qui ne dépendent pas du code.

---

## H. Relecture de mes propres corrections

Section instaurée à l'audit 9 et reconduite : sur onze corrections de l'audit précédent, quatre
avaient introduit un défaut. Elle est donc systématique désormais.

### H1 — Mon test rendait la vérification par mutation inexploitable

Le test du verrou d'ingestion vérifiait le relâchement en cas d'échec en lançant **un vrai job**.
Sans réseau, ce job épuise le profil de reprise « patient » : **plus de trois minutes par exécution**,
et autant à chaque passage du script de mutation. Un test lent est un test qu'on finit par ne plus
lancer.

Pire, et découvert en l'exécutant : sous la mutation « le verrou n'est plus relâché », le fichier ne
se contentait pas d'échouer — **il se figeait**. Un verrou consultatif garde sa connexion sortie du
pool, donc `pool.end()` l'attendait indéfiniment. Mesuré : 110 secondes jusqu'au délai de garde. Le
script de mutation, lui, n'a pas de délai de garde : il aurait bloqué la CI au lieu de signaler une
régression.

Trois corrections, toutes sur mon propre travail :

- **`avecVerrouIngestion` extraite** de `lancerIngestion` : le même chemin de code se vérifie
  désormais sans réseau, en lui passant un travail qui lève. Le fichier tourne en quelques secondes.
- **L'attente de fermeture du pool est bornée** à 3 secondes : un test qui échoue doit rendre la main.
  *Cette correction-là était fausse, et la vérification par mutation l'a démontrée quelques minutes
  plus tard — voir **H4**.*
- **Les noms de connecteurs des cas purement verrouillage sont uniques par processus.** Observé en
  enchaînant deux mutations : un verrou n'est rendu qu'à la fermeture de sa connexion, et une
  exécution qui reprenait aussitôt les mêmes noms trouvait le verrou encore pris — elle échouait pour
  une raison étrangère à ce qu'elle teste. Deux exécutions consécutives passent maintenant 6/6.

### H2 — Un fichier source est resté muté après une interruption

Mon enchaînement de mutations a été coupé par un délai d'exécution **avant sa ligne de restauration**,
laissant `ingestion/index.ts` sans son verrou. Vérifié puis restauré, et l'état final contrôlé par
comparaison avec la sauvegarde. Aucune conséquence sur le dépôt — rien n'avait été committé — mais
c'est la deuxième fois de ces audits qu'une mutation manuelle survit à son exécution : le script
`mutation.mjs`, qui restaure dans un `finally`, est le bon outil, et les mutations à la main devraient
lui être confiées systématiquement.

### H3 — Ma correction du verrou a créé un cycle d'imports

Pour étendre la protection aux ingestions manuelles, j'ai importé `tenterVerrou` depuis
`ingestion/index.ts`. Or cette fonction vivait dans `amorcage.ts`, que `ingestion/index.ts` est déjà
importé par : le cycle `ingestion → amorcage → ingestion` était constitué.

Il est inoffensif **ici** — la fonction n'est appelée qu'à l'exécution, jamais pendant l'évaluation du
module, et les six tests du verrou passent. Mais un cycle d'imports est une dette qui se paie plus
tard, le jour où quelqu'un lira un binding au moment de l'initialisation et obtiendra `undefined` sans
comprendre pourquoi.

La correction n'est pas de contourner le cycle mais de le supprimer : un verrou consultatif est une
primitive de base de données, sa place est dans `bdd.ts`, que tous les modules importent et qui
n'importe aucun d'eux. `tenterVerrou` y est déplacée, avec la raison écrite à son point d'emploi.
Vérifié : `ingestion → amorcage` n'existe plus, et les six tests passent toujours.

### H4 — Ma correction de H1 ne corrigeait pas H1

**Le défaut le plus instructif de cet audit, et c'est le mien.**

J'avais borné à 3 secondes l'attente de `pool.end()`, écrit « un test qui échoue doit rendre la main »,
et déclaré H1 réglé. La vérification par mutation, lancée ensuite sur les trente mutations, s'est figée
sur la trentième — celle qui retire le relâchement du verrou. **Seize minutes** avant que je l'arrête,
sans borne en vue.

La cause est exactement celle que j'avais crue traitée, un cran plus bas. Borner l'attente rend la main
à `after()` : le fichier signalait donc bien l'échec, `not ok 5`, correctement. Mais la connexion restée
sortie du pool garde sa **socket ouverte**, la socket tient la boucle d'événements, et le processus ne
**sort** jamais. `execFileSync` dans `mutation.mjs` attend la sortie du processus, pas la fin des tests.
J'avais borné la mauvaise chose : le symptôme visible, pas la condition qui bloque.

Conséquence pratique, et elle est sévère : la mutation était bel et bien attrapée, et **personne ne
pouvait le savoir**. Un outil de vérification qui détecte correctement une régression puis se fige
avant de la rapporter est indistinguable, vu de la CI, d'un outil cassé.

La correction ne borne plus une durée — elle **diagnostique l'état**. `pool.totalCount - pool.idleCount`
est le nombre de connexions hors du pool ; à la fin de ce fichier, une connexion hors du pool ne peut
venir que d'un verrou non rendu. Le teardown nomme alors la condition sur `stderr` et sort en code 1.
Aucun seuil de temps, donc aucune fragilité sur une machine lente : sur une exécution saine le compte
vaut zéro et la fermeture est attendue normalement.

Mesuré, la mutation appliquée puis restaurée par comparaison d'empreinte :

| | Avant H4 | Après H4 |
|---|---|---|
| Mutation attrapée | oui (`not ok 5`) | oui (`not ok 5`) |
| Sortie du processus | **jamais** (arrêté à 16 min) | **2,3 s**, code 1 |
| Diagnostic imprimé | aucun | « 1 connexion hors du pool […] Sortie forcée » |

Et l'exécution saine reste inchangée : 6/6 en 2,3 s.

**Note de méthode sur ce défaut.** Il n'a été trouvé que parce que la vérification par mutation a été
relancée **en entier après** les corrections, au lieu de faire confiance aux mutations passées avant.
C'est précisément ce que la demande exigeait — vérifier que les corrections n'ont pas créé de nouveaux
défauts — et le seul défaut critique restant de cet audit est celui-là.

### Ce que cette section dit de la méthode

Trois des quatre défauts trouvés ici ne portent pas sur l'application mais sur **l'outillage de
vérification**, et c'est une catégorie nouvelle. Un test lent, un test qui se fige, un test qui
interfère avec sa propre exécution précédente, un test qui détecte sans pouvoir le dire : aucun
n'aurait fait échouer la CI aujourd'hui, et tous auraient rendu la vérification inopérante demain.
Vérifier que l'on n'a rien cassé inclut donc de vérifier que ce qui vérifie fonctionne encore.

H4 ajoute une leçon plus dure : **une correction n'est acquise que mesurée sur le cas qu'elle visait.**
H1 décrivait exactement le bon scénario, la correction paraissait suivre du diagnostic, et elle ne
traitait pas le scénario. Entre « j'ai compris la cause » et « j'ai vérifié l'effet », il y a la place
pour un défaut entier.

Le seul qui porte sur l'application, H3, est d'une autre nature et mérite d'être noté à part : la correction était juste, son
emplacement ne l'était pas. Étendre une protection existante en l'important depuis un module qui vous
importe déjà est le geste le plus naturel du monde, et il faut se demander à chaque fois si la fonction
est au bon endroit avant de la réutiliser ailleurs.

---

## Score

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | 79/100 | Les défauts de cet audit ne faussent aucun calcul : la fiche est fidèle à l'API sur les 29 critères, le PDF fidèle à la fiche. C'est la première fois qu'un audit ne trouve aucune erreur de valeur. Ce qui plafonne la note reste inchangé : aucune validation par un expert sur des parcelles réelles, et un cycle d'effacement jamais observé. |
| Qualité technique | 76/100 | 30 mutations rattrapées, gardes structurels sur les tris, le SQL, la typographie et les dates. Retiré, et lourdement : le garde de l'audit 5 sur la localisation du rapport surveillait un seul motif et laissait passer les dates pendant cinq audits ; un test de contrôle d'accès lançait une campagne réelle de dix minutes à chaque `npm test` depuis l'audit 3 (B4) ; et mon propre outillage de test a produit **quatre** défauts (§H), dont un — H4 — où la correction annoncée ne corrigeait pas le défaut décrit et rendait la vérification par mutation muette pendant seize minutes. C'est la note la plus basse de l'audit, et elle est méritée : l'outillage de vérification est la zone la moins tenue du projet. |
| Qualité métier | 79/100 | Le raisonnement métier n'a été pris en défaut sur aucun point cet audit. Retiré : les livrables portaient encore deux conventions typographiques, et les exports montrent des valeurs d'énumération brutes à des destinataires externes (D1). |
| Ergonomie | 82/100 | Mesuré et non plus supposé : parcours clavier complet, focus toujours visible, feuille d'impression correcte, aucune erreur de console à l'usage. Retiré : l'interface reste couverte à 0,11, et rien dans la CI ne rejoue ces vérifications. |
| Robustesse | 83/100 | Les ingestions ne peuvent plus se doubler, le verrou est relâché même en échec, le refus est immédiat et distingué d'une panne. Retiré : F2 et F4 restent ouverts. |
| Professionnalisation | 81/100 | Dix rapports d'audit, CI qui exécute tests, mutations et vérifications de base contre PostGIS. Retiré : la décision sur les tests de bout en bout est encore à prendre, et deux améliorations de format attendent l'accord du propriétaire. |

**Score global : 80/100** (audit 9 : 78, audit 8 : 56, audit 7 : 67).

La hausse tient à une raison précise, et il faut la dire pour qu'elle ne soit pas surinterprétée :
**cet audit est le premier à ne trouver aucune erreur de valeur.** Les quatre défauts corrigés portent
sur la forme du livrable, sur la civilité technique envers des services partagés, et sur l'outillage de
vérification — pas sur un chiffre faux. Ce n'est pas que le regard s'est adouci : c'est que le regard s'est déplacé vers une
zone que neuf audits n'avaient pas éclairée, et qu'il l'a trouvée en meilleur état que la donnée.

Le global reste à 80 alors que la qualité technique perd deux points, parce que H4 n'a touché aucun
calcul : la vérification par mutation était devenue muette, pas fausse — elle détectait la régression
et ne pouvait pas la rapporter. La distinction compte pour lire ce chiffre. **Un lecteur qui voudrait
un seul indicateur de ce qui reste à faire doit regarder la ligne « qualité technique », 76, et non le
global.** C'est la seule note qui baisse depuis l'audit 9, et elle mesure exactement ce dont dépend la
crédibilité de tous les autres : la capacité de ce projet à prouver ce qu'il affirme.

---

## Réponse à la question posée

> **« Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un cadre
> professionnel sans risque majeur d'erreur ? »**

**Oui pour le pré-filtrage de foncier et la constitution d'un portefeuille de pistes, aux trois
conditions déjà énoncées à l'audit 9 — dont une s'allège — et non pour fonder seule une décision
d'investissement ou un engagement contractuel.**

Ce que cet audit ajoute, et qui n'avait jamais été vérifié : **ce que l'écran affiche est bien ce que
le moteur a calculé**, les 29 critères d'une fiche réelle le prouvent, et **le rapport remis à un
tiers dit la même chose que l'écran**. Les neuf audits précédents avaient établi que le calcul était
juste ; celui-ci établit que rien ne se perd entre le calcul et le lecteur.

Les conditions :

1. **Lire le bandeau « parcelles en retard sur la donnée » et le résorber après chaque ingestion.**
   Inchangé.
2. **Lire le compte rendu d'ingestion**, qui indique combien d'objets disparus ont été effacés et,
   le cas échéant, pourquoi l'effacement a été refusé. *Allégé depuis l'audit 9* : une ingestion ne
   peut plus se doubler, donc la recommandation de recharger une couche entière plutôt que de la
   réingérer par-dessus n'a plus lieu d'être.
3. **Ne jamais traiter un feu vert comme une conclusion.** Inchangé, et c'est la condition qui ne
   s'allégera pas : l'application classe et écarte, elle n'instruit pas. Les avertissements du §12
   restent la lecture obligatoire de toute fiche, et la validation par un expert sur 50 parcelles
   réelles — préparée depuis quatre audits, jamais exécutée — reste la condition d'un usage pleinement
   confiant.

Un mot sur la trajectoire, puisque c'est le dixième audit. Les défauts ont changé de nature : erreurs
de calcul (audits 2 à 4), absence de source présentée comme un constat (5 à 8), infidélité entre la
donnée et la réponse rendue (9), et cette fois la forme du livrable et l'outillage de vérification
lui-même. **Chaque itération a dû changer de question pour trouver quelque chose**, et c'est le seul
enseignement de méthode qui vaille pour la suivante : relire le même code plus attentivement ne
produit plus rien.
