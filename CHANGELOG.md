# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Les versions suivent [SemVer](https://semver.org/lang/fr/) ; l'application n'a pas encore atteint
`1.0.0`, ce qui signifie que le format du snapshot et celui du score peuvent encore changer.

Chaque entrée qui corrige un défaut de fiabilité porte la référence de l'audit qui l'a trouvé, dans
`docs/AUDIT-N.md`. C'est délibéré : sur un outil d'aide à la décision, savoir **depuis quand** un
chiffre est juste importe autant que savoir qu'il l'est. Un rapport produit avant une correction
n'a pas la même valeur qu'un rapport produit après.

## [Non publié]

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
