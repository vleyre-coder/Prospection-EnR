# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Les versions suivent [SemVer](https://semver.org/lang/fr/) ; l'application n'a pas encore atteint
`1.0.0`, ce qui signifie que le format du snapshot et celui du score peuvent encore changer.

Chaque entrée qui corrige un défaut de fiabilité porte la référence de l'audit qui l'a trouvé, dans
`docs/AUDIT-N.md`. C'est délibéré : sur un outil d'aide à la décision, savoir **depuis quand** un
chiffre est juste importe autant que savoir qu'il l'est. Un rapport produit avant une correction
n'a pas la même valeur qu'un rapport produit après.

## [Non publié]

### Ajouté — l'interface est enfin testée, et elle avait un défaut (suites de l'audit 10)

- **Le premier test du projet qui affiche une page.** Le ratio lignes de test / lignes de source de
  `apps/web` était de **0,11**, quatre fois moins que l'API, sur la seule partie que l'utilisateur
  regarde ; les cinq fichiers de test existants n'assemblaient aucun composant. Les vrais composants
  sont désormais montés via `react-dom/server` — **aucune dépendance ajoutée** — sur des fiches
  **réelles** capturées depuis la base (`apps/api/scripts/capturer-fixtures-web.ts`) : quatre filières,
  une parcelle minuscule aux seuils franchis, et le cas **écarté** (l'éolien y est rouge, avec le recul
  de 500 m de l'article L.515-44 impossible à tenir). Ratio porté à **0,23**, 19 tests de rendu.

- **Le défaut trouvé en naissant : la fiche écrivait « poids 10.7 % » à trois lignes de « 19,05 ha ».**
  Le même défaut B1 de l'audit 10 — deux conventions typographiques dans une phrase française — mais à
  l'endroit où son garde ne regardait pas : celui-ci inspecte les chaînes produites par le **moteur**,
  et le poids des critères comme les distances de zonage sont mis en forme par l'interface elle-même.
  Mesuré sur les cinq fiches réelles : **142 occurrences, ramenées à 7** — les 7 restantes étant la
  version du moteur (`1.4.0`) et les rubriques IOTA (`2.1.5.0`), où le point est la bonne ponctuation.

- **La vérification par mutation couvre enfin l'interface.** Comptage avant : 30 mutations, 26 sur
  `apps/api`, 3 sur `packages/scoring`, 1 sur une migration, **0 sur `apps/web`**. Rien ne prouvait donc
  que les tests de l'interface ne soient pas décoratifs. Huit mutations ajoutées (38 au total), dont une
  qui mute le **harnais de test lui-même** : zustand sert délibérément l'état *initial* en rendu serveur,
  si bien que tout état posé par un test était silencieusement ignoré — de quoi rendre décoratives
  toutes les branches pilotées par le store.

### Corrigé — le rapport PDF ne disait pas la même chose que la fiche (risque F2 de l'audit 10)

Le rapport n'avait été relu en entier **qu'une fois**, sur une parcelle agricole en solaire. Les quatre
autres relectures ont trouvé deux défauts, tous deux dans le document remis à un propriétaire :

- **« Occupation du sol : agricole_exploite »** — la valeur d'énumération brute, à la ligne suivant
  « Contenance cadastrale : 19,84 ha », quand la fiche affichait au même instant « Terrain agricole
  exploité ». La table de libellés existait, complète et juste, dans `packages/scoring` ; elle n'était
  simplement pas exportée.
- **« Fondement : eol_distance_habitation »** — une clé de code donnée comme base juridique du rejet
  d'une parcelle, là où la fiche résout la même clé en « Code de l'environnement, art. L.515-44, en
  vigueur depuis le 25/06/2020 ». Ce cas n'apparaît que sur une parcelle **écartée** : la seule
  relecture faite jusque-là portait sur une parcelle qui ne l'était pas.

Les quatre filières et le cas écarté sont désormais relus **à chaque exécution**, avec un extracteur de
texte PDF écrit sans dépendance ni binaire externe (`zlib` suffit) — `pdftotext` aurait pu disparaître
d'une image de CI sans bruit.

### Corrigé — un piège posé pour plus tard dans l'effacement des objets disparus (risque F4)

Le cycle complet n'avait jamais été observé, seulement testé par morceaux. L'observer a révélé que le
mécanisme repose sur un **contrat non vérifié** : `effacerDisparus` déclare disparue toute ligne dont
`updated_at` précède le run, donc toute réécriture doit remettre `updated_at = now()`. La réécriture du
patrimoine **culturel** ne le faisait pas. Le connecteur n'étant pas encore soumis à l'effacement, le
défaut n'était pas actif — c'était un piège pour le jour où on l'y soumettrait : tous les monuments
seraient passés d'un coup pour disparus, le plafond de volumétrie les aurait sauvés, et la suppression
n'aurait alors **jamais** fonctionné pour ce connecteur sans que la cause soit lisible. Corrigé, et
couplé par un garde structurel : toute table soumise à l'effacement voit désormais ses réécritures
vérifiées. Le cycle lui-même est observé de bout en bout contre PostgreSQL (100 objets, 10 disparus →
10 effacés ; 100 republiés → 0 effacé ; 70 disparus → refus et couche intacte).

### Corrigé — un nombre magique dans un garde structurel

Le garde d'alimentation bornait à **900 caractères** la capture d'un `INSERT INTO contrainte`. Ajouter
dix lignes de commentaire dans la requête a repoussé le backtick fermant au-delà de la fenêtre : le
garde a annoncé « les monuments historiques doivent être ingérés », c'est-à-dire un défaut d'ingestion,
alors que rien de l'ingestion n'avait changé. Un nombre magique dans un garde ne se déclenche pas à
l'écriture mais le jour où quelqu'un allonge le code surveillé, et il accuse alors le mauvais coupable.
La borne était inutile : le littéral SQL est délimité par des backticks et n'en contient aucun.

### Corrigé — fidélité du livrable et exclusion des ingestions (audit 10)

- **Le moteur écrivait des points décimaux dans des phrases françaises** (audit 10, défaut B1). Le
  projet possède un formateur unique, `formatNombre`, qui écrit la virgule ; quatre endroits le
  contournaient et interpolaient le nombre brut, mêlant les deux conventions dans une même phrase :
  « La parcelle offre environ 0,14 ha implantables (0,37 ha au cadastre), en dessous de la surface
  minimale indicative de **0.5** ha » et « Puissance estimee **0.38** MWc … a raison de 0,5 MWc/ha ».
  Mesuré sur les 439 parcelles réelles de la base × 4 filières : **591 occurrences sur 4 champs**.
  Après correction : zéro. Ces phrases s'affichent dans la fiche, sont imprimées telles quelles dans
  le rapport remis à un propriétaire ou à un financeur, et partent dans les exports. Un garde inspecte
  désormais les chaînes **réellement produites** par le moteur, et non le code.

- **Le rapport PDF mêlait deux conventions de date** (audit 10, défaut B2). Il écrivait « rapport du
  07/08/2026 » en première page et « depuis le 2022-10-01 » dans le tableau des seuils de procédure —
  7 dates ISO par rapport. Le garde structurel posé à l'audit 5 sur la localisation du rapport ne
  surveillait que les `toFixed` décimaux : un garde partiel donne l'illusion de couvrir un sujet. Un
  second garde refuse maintenant toute interpolation de date sans mise en forme française.

- **Une ingestion nationale pouvait se lancer en parallèle d'elle-même** (audit 10, défaut B3).
  `lancerIngestion` est appelée depuis la route d'administration, le script `npm run ingest` et
  l'amorçage, et aucun des trois ne s'excluait des deux autres — alors que l'ingestion des ZAER lit
  1,09 million d'objets sur le WFS de la Géoplateforme en une vingtaine de minutes, sur un quota
  partagé par toute l'équipe. La protection existait déjà pour l'amorçage, avec la bonne
  justification, et n'avait jamais été étendue. Verrou consultatif par connecteur, non bloquant : le
  second appel est refusé immédiatement, et la route répond **409** et non 502 — une ingestion en
  cours est un conflit, pas une panne, et l'échec ne doit pas être inscrit au journal des sources.

- **La vérification par mutation pouvait détecter une régression sans pouvoir la rapporter**
  (audit 10, défaut H4). Le test d'exclusion des ingestions échouait correctement sous la mutation
  « le verrou n'est plus relâché » — mais la connexion du verrou restait sortie du pool, sa socket
  tenait la boucle d'événements, et le **processus ne sortait jamais**. Or `mutation.mjs` attend la
  sortie du processus, pas la fin des tests : mesuré **16 minutes sans borne en vue**, contre 2,3 s
  et un code 1 après correction. Une première tentative avait borné l'attente de `pool.end()` à
  3 secondes ; elle rendait la main à `after()` sans faire sortir le processus, donc ne corrigeait
  rien. Le teardown ne borne plus une durée, il diagnostique l'état — une connexion hors du pool à la
  fin du fichier ne peut venir que d'un verrou non rendu — le nomme et sort en échec. Aucun seuil de
  temps, donc aucune fragilité sur une machine lente.

- **Un test de contrôle d'accès lançait une campagne d'enrichissement réelle** (audit 10, défaut B4).
  Le test des rôles envoyait une emprise à la route de qualification pour vérifier qu'un compte
  prospection n'est pas refusé : le refus était bien testé, et la requête aboutissait ensuite pour de
  bon. Mesuré : **438 parcelles qualifiées et 138 snapshots réécrits en 5 minutes à chaque `npm
  test`**. Le test vérifie désormais l'autorisation sans emprise — la route répond 400, ce qui prouve
  exactement ce qui était visé, sans toucher aux données.

### Vérifié sans défaut (audit 10)

Premier audit à piloter l'application dans un vrai navigateur et à comparer l'écran à l'API :
les **29 critères** d'une fiche réelle affichent exactement la valeur renvoyée par l'API ; le rapport
PDF dit la même chose que la fiche ; le parcours clavier couvre 30 cibles avec un focus toujours
visible ; la feuille d'impression cible correctement ; le CSV est localisé de bout en bout. Ces
vérifications sont documentées dans `docs/AUDIT-10.md` §C.

### Corrigé — fiabilité de ce qui est rendu à l'écran (audit 9)

- **Une liste triée puis tronquée n'était pas une liste, c'était un tirage** (audit 9, défaut B1).
  Aucun des tris de l'application ne portait de départage : le tri s'arrêtait au score, à la surface
  ou à la date. Or le score est arrondi au dixième — 1 001 valeurs possibles sur 0-100 — donc les
  parcelles ex æquo se comptent par centaines dès qu'une campagne départementale est lancée. Mesuré
  sur 200 000 lignes, requête et données identiques, seul le plan PostgreSQL différant : **113 des
  300 parcelles rendues changent (38 %)** entre plan séquentiel et plan parallèle, 107 changent après
  la simple création d'un index. En pagination, **20 des 25 parcelles de la page 2 étaient déjà sur la
  page 1, et 21 des 50 meilleures n'apparaissaient sur aucune des deux**. Deux prospecteurs aux mêmes
  filtres n'obtenaient donc pas les mêmes parcelles, et le CSV exporté n'était pas reproductible.
  Départage par une colonne unique partout où un tri est tronqué ; coût mesuré : 0,95 ms → 1,01 ms sur
  200 000 lignes. Un garde structurel refuse désormais tout littéral SQL qui trie et tronque sans
  ordre total.

- **Un instantané ne vieillissait que par son âge, jamais par l'arrivée de la donnée** (audit 9,
  défaut B2). Le scoring ne lit pas les couches, il lit le snapshot figé à l'enrichissement. Ni la
  règle des 30 jours ni l'empreinte du moteur — qui couvre le code, le référentiel et les barèmes,
  mais pas la donnée — ne pouvaient voir une ingestion. Mesuré : **438 parcelles portant un snapshot
  de 11 h 48, sites classés et inscrits ingérés à 19 h 38**, aucune détection possible. Le sens de
  l'erreur n'est pas toujours prudent : un snapshot pris quand la couche existait déjà affirme une
  absence, et un site nouvellement classé ne sera jamais vu — une parcelle devenue rédhibitoire reste
  verte. `couverture_ingestion.date_ingestion` sert désormais de signal : la qualification et la fiche
  parcelle réenrichissent, `/api/sante` publie le retard, `POST /api/qualification/rafraichir` le
  résorbe par lots bornés, et l'interface l'affiche. Vérifié de bout en bout : **411 des 438 parcelles
  ont été reprises** par une campagne réelle, et le critère patrimonial est passé de « aucune source
  ingérée » à une absence réellement constatée.

- **La fiche parcelle n'appliquait pas la règle de péremption des 30 jours** (audit 9, défaut B2).
  Elle ne réenrichissait que si la parcelle était absente du cache ou si le rafraîchissement était
  demandé explicitement : une parcelle consultée une fois pouvait afficher indéfiniment l'état des
  sources à la date de sa première consultation.

- **Une distance au plus proche n'était pas une mesure** (audit 9, défaut B3). Chercher l'objet le
  plus proche revient à balayer un disque, et ce disque franchit les frontières départementales :
  mesuré sur le référentiel communal réel, 10 km couvrent deux départements, 60 km en couvrent six.
  L'ingestion des postes sources parcourt les treize régions et tolère l'échec de l'une d'elles, sans
  écrire aucune ligne de couverture — Capareseau ne publie pas le département. Une région manquante
  faisait donc attribuer aux parcelles voisines un poste à 90 ou 150 km, **noté comme une mesure** :
  faux ROUGE sur le critère le plus lourd du profil, l'inverse du défaut B1 de l'audit 8. Même faille
  pour le site d'injection gaz et pour le patrimoine au-delà d'une limite départementale, et cas
  extrême en outre-mer, que Capareseau ne couvre pas du tout. La distance n'est désormais rendue que
  si tous les départements traversés par le disque sont couverts ; l'ingestion des postes les rattache
  à leur commune par jointure spatiale et enregistre sa couverture.

- **Une pagination interrompue était enregistrée comme complète** (audit 9, défaut C1). L'ingestion
  des sites d'injection GRDF entoure toute sa pagination d'un seul `try/catch` : une erreur à la
  page 3 sur 9 en sortait et le statut enregistré restait « ok ». Un tiers des sites d'injection de
  France était déclaré complet, et la distance au site le plus proche — critère de raccordement de la
  méthanisation — se calculait dessus. Le statut devient « partiel » et aucune couverture n'est
  écrite.

- **Une ingestion n'effacait jamais ce qui avait disparu de la source** (audit 9, défaut D1). Toutes
  les ingestions sont en « insertion ou mise à jour » sur la clé naturelle : un objet retiré de la
  source restait en base indéfiniment et continuait d'être affirmé. Un site déclassé restait un site
  classé, une délibération de ZAER annulée restait une ZAER — et les communes révisent régulièrement
  leurs délibérations. Ce qui manquait n'était pas la requête de suppression mais le **droit** de
  supprimer : `created_at` n'est pas touché par la mise à jour, donc rien ne distinguait une ligne
  revue d'une ligne oubliée. Trois pièces indépendantes ont été posées — un horodatage de revue
  (migration 014), un contrat de complétude remonté par le générateur de pagination WFS (et exigé sur
  **toutes** les couches, métropole et outre-mer, sinon un échec sur la couche guadeloupéenne ferait
  supprimer les sites de Guadeloupe), et un **plafond de volumétrie de 20 %** au-delà duquel la
  suppression est refusée et journalisée. Une suppression mal gardée serait pire que le défaut
  qu'elle corrige : elle transformerait une source momentanément dégradée en effacement d'une couche
  entière. Les deux gardes sont vérifiées par mutation.

### Corrigé — défauts créés par les corrections de l'audit 9 (relecture, §H du rapport)

- **La correction du contrôle de couverture grisait toute instance déjà en service** (audit 9, §H1).
  `postesLesPlusProches` et `reseauGaz` consultent désormais `couverture_ingestion` avant de rendre une
  distance, mais ces connecteurs n'y écrivaient aucune ligne avant l'audit — c'était la cause du
  défaut — et les lignes n'apparaissent qu'à la prochaine ingestion. Sur une instance où les postes
  sont ingérés depuis des mois, **tous les critères de raccordement passaient au gris au
  déploiement**, sans message. La migration 015 déduit la couverture du contenu des tables, rattache
  les postes à leur commune par jointure spatiale, et inscrit la provenance dans `source_document`
  pour qu'une couverture déduite reste distinguable d'une couverture constatée. Un test rejoue le
  scénario de mise à niveau de bout en bout.

- **Le compteur de retard exécutait une sous-requête corrélée par parcelle** (audit 9, §H2). Mesuré :
  **2 973 ms sur 200 000 parcelles**, pour une requête que `/api/sante` exécute à chaque chargement de
  l'interface. Avec l'agrégation préalable : **108 ms**. C'est exactement le défaut C2 — une requête
  qui empêche PostgreSQL de travailler — commis dans le commit qui corrigeait C2.

- **Deux routes de qualification ne refusaient pas les comptes en lecture seule** (audit 9, §H3).
  `POST /api/qualification/parcelles` ne l'avait **jamais** eu : un compte en lecture seule pouvait
  qualifier une liste d'identifiants jusqu'au plafond par appel et épuiser le quota partagé par
  l'équipe. `POST /api/qualification/rafraichir`, ajoutée à l'audit 9, a reproduit l'oubli. Le contrôle
  est désormais nommé (`refuserLectureSeule`), un test structurel exige sa présence sur toute route de
  qualification, et l'interface masque le bouton pour un compte qui recevrait un 403.

- **Une couverture à comptage nul valait « inconnu » au lieu de « regardé »** (audit 9, §H4, risque
  F4). Un département réellement dépourvu de l'objet cherché ne portait aucune ligne exploitable, et le
  contrôle du disque grisait le critère de toutes les parcelles à portée de sa frontière — pour une
  donnée pourtant complète. L'ingestion des postes pose désormais la couverture sur les départements
  des régions effectivement téléchargées, comptage nul compris, et la lecture ne conditionne plus le
  verdict à un comptage non nul : une ligne n'existe que si une ingestion l'a écrite, son existence
  prouve donc le regard.

### Ajouté — gardes de vérification

- **Tout littéral SQL du projet est analysé par PostgreSQL** (`PREPARE`, sans exécution). Les requêtes
  d'ingestion ne s'exécutent qu'après plusieurs minutes de téléchargement : une faute de syntaxe y
  restait invisible jusqu'à l'échec d'une ingestion réelle. Une apostrophe inversée placée dans un
  commentaire SQL a cassé trois fois son littéral au cours de ces audits.
- **Le garde structurel des tris couvre aussi les migrations**, une vue qui trie puis tronque ayant
  exactement le même défaut qu'une requête applicative — avec la particularité d'être invisible depuis
  le code.

### Performance (audit 9)

- **Les filtres de proximité empêchaient l'usage des index qu'ils avaient** (audit 9, défaut C2).
  Écrits `ST_DWithin(geom::geography, …)`, ils forçaient le parcours complet de la table et la
  conversion de chaque géométrie. Mesures par appel, et ces requêtes sont appelées une fois par
  parcelle : **3 434 ms → 4,4 ms** pour les départements d'un disque sur 34 875 communes, **847 ms →
  8,4 ms** pour les objets patrimoniaux dans 10 km. Sur un lot de 500 parcelles, l'écart dépasse la
  demi-heure. Un préfiltre en espace géométrique précède désormais le filtre métrique exact ; la marge
  en degrés est calculée sur le degré de longitude, donc le préfiltre retient toujours un peu plus que
  le rayon demandé, jamais moins.

### Sécurité

- **La limitation de débit était contournable par un simple en-tête** (audit 8, seconde passe). Le
  serveur déclarait `trustProxy: true`, ce qui fait prendre à Fastify l'entrée la plus à gauche de
  `X-Forwarded-For` — entièrement fournie par le client. Or la limitation indexe ses seaux sur
  `req.ip` pour les appels non authentifiés. Mesuré sur la route de connexion : **429 après 11
  tentatives** en conditions normales, **jamais en 60** en variant l'en-tête. C'était la seule
  protection de la seule route qu'un attaquant non authentifié peut marteler. `trustProxy: 1` ne
  suffisait pas non plus : sans relais réel, `X-Forwarded-For` ne contient qu'une entrée, celle du
  client. Le nombre de relais de confiance est désormais configurable
  (`RELAIS_DE_CONFIANCE`) et vaut **0 par défaut** : `req.ip` est alors l'adresse de la connexion
  TCP, non falsifiable. Un déploiement derrière un reverse proxy doit déclarer ses sauts.

### Ajouté — sources de données

- **Les zones d'accélération des ENR et les sites classés / inscrits sont désormais ingérés**
  (audit 8). Deux couches nationales existent sur le WFS de la Géoplateforme, et le catalogue des
  sources annonçait pourtant « aucune API nationale consolidée » pour les ZAER : cette croyance a
  laissé gris depuis l'origine l'argument réglementaire le plus utile de la prospection depuis la loi
  APER. 6 617 sites classés et inscrits sont chargés (2 612 classés, 4 005 inscrits) ; les ZAER
  représentent 1,09 million de zones. Les deux vocabulaires ont été **mesurés avant** d'écrire la
  moindre correspondance, et chacun cachait un piège : **68 % des ZAER photovoltaïques portent sur des
  toitures** et ne concernent pas le foncier ; « Grand Site de France » et « Patrimoine mondial » sont
  des **labels** sans portée réglementaire propre, dont l'assimilation à un site classé aurait
  déclenché un knock-out éolien non dérogeable à tort.

### Corrigé — l'application n'affirme plus ce qu'elle ne sait pas

Les huit défauts de priorité 1 de l'audit 8 forment une seule famille : le code lit proprement une
source qui n'existe pas, et transforme son silence en fait affirmé. Aucun n'était un défaut de
calcul, et aucun test écrit d'après le code ne pouvait les voir.

- **Un critère valait 90/100 en feu VERT sur une couche que rien n'ingérait** (audit 8). `pat_sites`
  affichait « Aucun site classé ni inscrit dans le rayon d'analyse », partout en France, sur zéro
  donnée : `patrimoine()` lisait la table `contrainte` pour quatre types dont un seul est ingéré, et
  rendait les listes vides en absences constatées. Le knock-out éolien du site classé était du même
  coup **structurellement inatteignable**, alors qu'un site classé impose une autorisation
  ministérielle spéciale jamais accordée pour un parc éolien. La présence est désormais évaluée par
  type et par département, le plafond de lignes est par type, et un test nommé échoue si le knock-out
  redevient inatteignable.
- **Le nombre de propriétaires était la constante `1`, en dur** (audit 8), sous un commentaire
  décrivant un algorithme jamais écrit. Le critère valait 100/100 en vert, « 1 propriétaire(s)
  estimé(s) », sur le premier facteur de mortalité d'un projet. La valeur est `null` et le critère
  déclaré sans source.
- **Un échec de source produisait le meilleur score possible** (audit 8). Les trois conditions du
  `null` de l'aléa d'inondation étaient liées par `&&` : un échec de `gaspar/pprn` donnait « aléa
  nul », noté 100/100. La liste des connecteurs en échec existait et remontait jusqu'au PDF sans
  jamais atteindre le moteur, si bien qu'un même document portait un feu vert et une note disant que
  la source avait échoué. Le moteur la reçoit maintenant et grise tout critère concerné.
- **Un plan de prévention communal devenait un aléa parcellaire** (audit 8). L'existence d'un PPRI sur
  la commune valait « aléa moyen » sur chaque parcelle, soit 85 % des communes françaises, y compris
  sur un plateau à trois kilomètres du moindre cours d'eau. Un aléa est une grandeur parcellaire.
- **Un PPRN au libellé illisible valait « pas de PPRI »** (audit 8), sur 30 % des communes qui en ont
  un. La provenance décide désormais : `gaspar/pprn` se classe au libellé, donc un plan illisible rend
  les familles naturelles incertaines ; `gaspar/pprt` est technologique par construction.
- **La « distance au réseau gaz » était la distance à un site d'injection existant** (audit 8), la
  table des canalisations n'étant peuplée par rien : quelques centaines de points contre des dizaines
  de milliers de kilomètres de canalisations. La méthanisation était systématiquement pénalisée sur
  11 % de sa note. Les deux grandeurs portent maintenant deux noms distincts.
- **Un critère recomptait ce qui était déjà compté** (audit 8). `env_especes_protegees`, 7 % de la
  note éolienne, était une dérivation de la proximité des zonages déjà notés par
  `env_proximite_natura2000` et `env_znieff`.
- **Quatre critères gris en permanence** (ZAER, archéologie, karst, radars et servitudes
  aéronautiques) affichaient « donnée indisponible », ce qui laisse croire à une panne passagère, et
  pesaient sur la pénalité de couverture. Ils disent maintenant qu'aucune source n'est ingérée, et où
  chercher la donnée.
- **Six paramètres de requête produisaient une erreur 500** (audit 8), vérifié contre PostgreSQL :
  `Number('abc')` valait `NaN`, qui partait tel quel en paramètre SQL. Une faute d'appel vaut 400.
- **Deux exports acceptaient une liste sans plafond, avec une requête SQL par parcelle** (audit 8),
  alors que l'export CSV était borné. La limitation de débit borne la fréquence, pas la taille.
- Également corrigés : un test d'existence global pour trois couches d'intrants indépendantes ; un
  raster de vent qui ne redevenait jamais lisible sans redémarrage ; l'absence de tout contrôle du
  géoréférencement de ce raster ; le document-cadre PV confondant « non ingéré » et « pas de
  document-cadre » ; une route de couche sans liste fermée ; un export GeoJSON muet sur sélection
  vide ; un « potentiel agronomique » renommé pour ce qu'il est, un proxy du groupe de culture
  déclaré ; et une chaîne d'espaces qui s'affichait comme une cellule vide plutôt que comme une
  absence.

### Corrigé — seconde passe, après les corrections de l'audit 8

- **Les mouvements de terrain étaient comptés par COMMUNE et notés comme une mesure locale** (audit 8,
  seconde passe). Le champ est documenté « à proximité » et noté sur une échelle locale — 1 mouvement
  vaut 75/100, 8 en valent 20 — mais le connecteur interrogeait Géorisques par code commune. Mesuré
  sur Nice : **28 mouvements à l'échelle de la commune contre un seul dans le kilomètre**, soit
  55 points d'écart sur le critère, sur chaque parcelle de la commune. Le point d'entrée accepte un
  rayon, comme celui des cavités.
- **Trois rayons étaient annoncés pour le même nombre de cavités** : 1 000 m demandé au service, 500 m
  documenté dans le type, « < 500 m » affiché par le moteur donc par le PDF, « < 1 km » affiché à
  l'écran. Le rapport transmis à un tiers et l'écran donnaient deux périmètres différents pour un seul
  chiffre. Le rayon est maintenant une constante utilisée par la requête et par les libellés.
- **Une chaîne d'espaces s'affichait comme une cellule vide** plutôt que comme une absence : la garde
  était `v === ''`, qui ne rattrape pas `'   '`, et plusieurs sources produisent l'espace.
- **L'ingestion des ZAER allait fabriquer une pénalité sur la filière stockage.** Aucune ZAER ne vise
  une batterie — la loi APER porte sur la production — mais avec la couche ingérée, chaque parcelle de
  projet de stockage aurait reçu « Hors zone d'accélération » (45/100). Rendre une couche disponible
  peut donc créer un défaut là où son absence n'en créait pas. Le critère est retiré du profil de la
  filière : `null`, et non `sansSource`, qui aurait plafonné toute la filière à orange — un enjeu non
  regardé et un enjeu non applicable sont deux choses différentes.
- **Deux défauts d'ingestion trouvés à l'exécution réelle** : `unnest` sur un tableau
  multidimensionnel aplatit les listes, si bien qu'aucune filière de ZAER n'était insérée ; et une
  reprise de sept secondes sur un service qui répond 503 sous charge faisait abandonner toute
  l'ingestion après zéro objet. Les paliers vont désormais jusqu'à deux minutes, avec une respiration
  entre les pages pour ne pas provoquer la surcharge.

### Corrigé — validation des routes (troisième passe)

- **Les 21 routes mutantes valident désormais leur corps** (audit 8, item 24). `validation.ts`
  fournissait un lecteur écrit pour les routes, et une seule fonction de l'application l'appelait ;
  les routes lisaient `req.body as { … }`, une assertion de type qui ne vérifie rien à l'exécution.
  Toutes passent par `lecteur()` avec refus des champs inconnus : `{ note: … }` au lieu de
  `{ notes: … }` répondait 201 et perdait la saisie sans un mot.
- **Les poids d'une pondération n'étaient pas validés**, ni à l'enregistrement ni au calcul. Une clé
  inconnue était persistée puis ignorée par le moteur ; un poids négatif inversait la contribution du
  critère — le score MONTAIT quand le critère se dégradait ; `NaN` rendait le score global vide sur une
  parcelle bien renseignée.
- **Un identifiant de knock-out inconnu passait sans bruit** : l'utilisateur croyait explorer un
  scénario dérogatoire qui n'était pas appliqué. La liste est fermée et dérivée des règles elles-mêmes.
- **Un rôle invalide était ramené à `lecture` en silence** : `"Admin"` créait un compte en lecture
  seule, et l'administrateur le découvrait plus tard sans moyen de savoir pourquoi.
- **Le corps de la route de connexion n'était pas borné** — route publique, où un `email` ou un
  `motDePasse` de plusieurs mégaoctets partait en requête SQL et dans la fonction de hachage.
- Également corrigés : la `limite` de `/api/admin/rescorer` partait en `LIMIT` SQL sans borne ; les
  identifiants de parcelle et les géométries n'étaient vérifiés dans aucune route ; les routes de
  création de site et de qualification par lot n'avaient pas de plafond.

### Corrigé — une régression introduite par la validation, et le test qui manquait

- **Le recalcul avec pondérations personnalisées aurait répondu 400 à chaque appel.** En câblant la
  validation, j'ai lu les options de simulation au niveau racine du corps, alors que l'interface envoie
  `{ filiere, ponderation, options }` — un objet `options` **imbriqué** — depuis toujours. `options`
  était donc refusé comme clé inconnue. Aucun des 17 tests de route ne l'aurait vu : ils vérifiaient
  que les mauvaises formes sont refusées, pas que les bonnes sont acceptées. Un test **rejoue désormais
  les charges utiles exactes du client**, méthode par méthode. Ajouter une validation, c'est figer un
  contrat — et le contrat à respecter est celui que les appelants utilisent déjà.

### Corrigé — la reprise sur surcharge de service

- **La reprise sur 503 durait 1,2 seconde pour toutes les ingestions.** Le client HTTP réessayait trois
  fois avec 400 ms puis 800 ms : le bon ordre de grandeur pour une coupure réseau, beaucoup trop court
  pour un 503, qui signale une surcharge et demande d'attendre. Constaté deux fois à l'exécution :
  l'ingestion des ZAER a abandonné après seize secondes et zéro objet, celle des communes après
  1,2 seconde. J'avais corrigé cela dans **un** module au lieu de la couche partagée — trois ingestions
  sur cinq restaient exposées. Deux profils explicites existent désormais : `reactif` (défaut, appels
  par parcelle, le critère grise vite) et `patient` (ingestions, jusqu'à deux minutes). Allonger
  l'attente partout aurait été une faute symétrique : à 1 000 parcelles et un service en surcharge, cela
  ferait cinquante heures d'attente pour des critères qui doivent simplement griser.
- **L'en-tête `Retry-After` est désormais honoré**, sous ses deux formes admises (secondes ou date
  HTTP), borné à cinq minutes. Nos paliers sont une estimation ; l'en-tête est une consigne.

### Ajouté — contrôles permanents

- **Un contrôle d'ALIMENTATION, et non plus seulement de citation** (audit 8, item 21). Le contrôle
  des champs orphelins vérifiait que le nom d'un champ apparaît dans un connecteur ; celui-ci vérifie
  qu'un chemin de production peut lui donner une valeur. Trois règles : toute couche lue en base est
  ingérée ou son absence est déclarée ; tout champ structurellement nul est déclaré et non subi ; aucun
  connecteur ne renseigne un champ mesurable par une constante. C'est le contrôle qui aurait trouvé
  quatre des défauts ci-dessus sans audit, et **il a trouvé deux choses à sa première exécution**.
- **La vérification par mutation passe de 7 à 14 mutations**, 14/14 rattrapées. Le script avait
  lui-même un défaut de périmètre : les mutations portant sur `packages/scoring` n'étaient attrapées
  par personne, les tests important le paquet **construit**. Il reconstruit désormais l'espace muté.
- **Les routes HTTP sont testées** : 7 des 44 étaient citées dans un test, dont aucune des quatre
  routes d'export ni la route RGPD. Douze cas couvrent maintenant les trois refus de la route des
  propriétaires, les routes d'administration, les plafonds d'export et la cohérence du format
  d'erreur.
- **Un contrôle STRUCTUREL de la validation des routes** : un test relit la source et exige que chaque
  bloc de route mutante lisant `req.body` appelle un validateur reconnu, et que toute lecture brute
  soit déclarée avec sa raison. Vérifier champ par champ par des appels HTTP se dégraderait dès le
  premier champ ajouté ; ce contrôle ne peut pas se périmer en silence.
- **Les fixtures de contrat sont capturées avec les paramètres de production**, et un test vérifie la
  correspondance code / fixture dans les deux sens. La fixture PVGIS avait été capturée sans
  `optimalangles=1`, soit 17 % d'écart sur les valeurs.

### Audité

- **Huitième audit complet** (`docs/AUDIT-8.md`), premier à couvrir les quatre zones jamais
  examinées : `connecteurs/locales.ts`, `connecteurs/vent.ts`, `connecteurs/gisement.ts` et les
  44 routes HTTP. Il change la question posée : les sept précédents vérifiaient si les calculs
  étaient justes sur les données reçues, celui-ci vérifie s'il existe un chemin de production
  capable de fournir ces données. 34 défauts relevés, tous établis par exécution ou par requête
  réelle, dont huit de priorité 1 appartenant à une seule famille — *affirmer en l'absence de
  donnée*. Deux critères notés et affichés reposent sur zéro donnée (`pat_sites` à 90/100 vert sur
  des couches qu'aucun job n'ingère ; `fonc_nb_proprietaires` à 100/100 vert sur une constante codée
  en dur), un knock-out réglementaire est structurellement inatteignable, et de 8 % (bess) à 46 %
  (méthanisation) de la pondération repose sur une donnée absente, un doublon ou une grandeur hors
  échelle. Score 56/100, contre 67 à l'audit 7 : la baisse ne vient d'aucune régression — le code
  est meilleur — mais du périmètre honnête de la mesure. Aucune correction n'est encore appliquée ;
  le rapport est le périmètre du chantier final.

### Corrigé — fiabilité

- **La détection des plans de prévention des risques ne fonctionnait pas** (audit 7). Le connecteur
  lisait `libelle_risque_long` puis `libelle_risque` ; le champ réel est `libPpr`. L'application
  **affirmait** « pas de PPRI, pas de PPRIF, pas de PPRT, aléa inondation nul » sur toutes les
  parcelles de France. Vérifié sur cinq communes qui en ont : Arles (submersion marine), Aix
  (6 plans), Nice (7), Montpellier, Lyon. Une parcelle en zone rouge de PPRI pouvait ressortir
  verte. La classification porte désormais sur le sigle de type, le vocabulaire réel étant codé
  (`PPRN-I`, `PPRI`, `PPRi`, `PPRL`, `PER-I`, `PPRIF`, `PPRN-MVT`, `PPRN-RGA`, `PPRN-S`) et non
  rédigé ; un plan multirisque compte dans chacune de ses familles ; un libellé illisible reste
  indéterminé plutôt que rangé par défaut.
- **Un tiers du bâti était exclu de la qualification des habitations** (audit 6), dans le sens
  favorable. `usage_1 = "Indifférencié"` représente 33,9 % du bâti mesuré et était écarté, alors
  que la règle de prudence documentée ne s'appliquait qu'aux usages vides — soit 0,0 % des cas.
  Effet mesuré : 28 → 83 habitations dans les 500 m sur une parcelle réelle, et le knock-out du
  recul de 500 m (art. L.515-44) se déclenche désormais.
- **Le WFS tronquait ses réponses en silence** (audit 5). En tissu dense, la distance à
  l'habitation la plus proche était fausse de deux ordres de grandeur — 558 m annoncés à Bourges
  pour 0 m réels — et toujours dans le sens favorable. Emprise dégressive et refus de toute
  distance non démontrée.
- **Une pente pouvait atteindre 1 665 %** (audit 4), sur 14 % des parcelles, par ajustement de plan
  mal conditionné.
- **L'arrêté de protection de biotope n'était alimenté par aucune source** (audit 6) : le knock-out
  existait mais ne pouvait mathématiquement jamais se déclencher, alors qu'un APPB est une
  protection absolue et non dérogeable (art. R.411-15 du code de l'environnement).
- **Une chaîne vide devenait zéro à l'ingestion** (audit 7). `Number('')` vaut 0 : une coordonnée
  non renseignée produisait `[0, 0]`, un point dans le golfe de Guinée, ingéré comme une géométrie
  valide sur un jeu de 46 000 monuments.
- **Les compteurs de risques plafonnaient à 50** (audits 6 et 7), faute de pagination : Menton
  annonçait 148 mouvements de terrain, Lyon 214 sites pollués. Sans effet sur la note — les courbes
  saturent avant — mais la valeur affichée était fausse.

### Corrigé — exactitude des livrables

- **Le nom du site Natura 2000 était toujours nul** (audit 6) et la carte étiquetait ces sites par
  leur **code** (audit 7) : « FR9301590 » au lieu de « Camargue ». Champ réel : `sitename`.
- **Aucun lien vers une fiche INPN ne fonctionnait** (audit 7), sur aucun calque : le champ est
  `url`, pas `url_fiche`.
- **Le nom de zonage naturel affiché désignait un autre site que la distance affichée** (audit 6),
  dans 4 cas sur 5 mesurés.
- **Le type de document d'urbanisme était toujours « non renseigné »** (audit 6). Champ réel :
  `du_type`.
- **Le séparateur décimal était un point** dans la colonne des poids du rapport et dans quatre
  autres textes (audit 5).

### Ajouté

- **Zones réglementaires des PPR** : la sévérité maximale des zones que le plan contient est
  exploitée, avec sa portée dite explicitement — ce n'est pas la zone applicable à la parcelle,
  qui reste à lire sur le règlement graphique.
- **Veille sur la dégradation silencieuse des sources** (`services/veille-sources.ts`) : un champ
  dont le taux de renseignement s'effondre sur un lot signale un contrat rompu, même si tout
  répond HTTP 200. C'est le signal qui manquait aux audits 5, 6 et 7.
- **Contrôles permanents en CI** : contrats des sources externes vérifiés contre des propriétés
  capturées en production, champs orphelins dans les deux sens, vérification par mutation, et
  échec de la CI si le référentiel réglementaire n'a pas été revu depuis 180 jours.
- **Instruments de calibration** : `scripts/campagne-validation.mjs` prépare et dépouille une
  campagne de vérification par un expert ; `docs/CALIBRATION.md` porte les emplacements de saisie
  des données réelles qui manquent (devis de raccordement, décisions de gestionnaire, rendements
  locaux, revue juridique datée, test utilisateur).
- **Reprise d'une base privée de sa table de suivi des migrations** (`migrate -- --adopter`).

### Modifié

- Le catalogue de couches ne contient plus que celles qu'une ingestion alimente : 18 des
  21 entrées étaient grisées, dont 7 fonctionnaient dans l'autre panneau sous le même nom.

## Méthode de publication

Une version se publie quand les trois conditions sont réunies :

1. la CI est verte, **mutation comprise** — une mutation qui passe signale un test décoratif ;
2. aucun défaut de fiabilité connu n'est ouvert, ou chacun est déclaré ici avec son effet ;
3. `REFERENTIEL_DERNIERE_VERIFICATION` a moins de 180 jours.

Le numéro de version est porté par `package.json` et une étiquette git `vX.Y.Z`.
