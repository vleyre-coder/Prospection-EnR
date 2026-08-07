# Neuvième audit complet — audit à froid, 6 août 2026

Audit conduit simultanément sous six angles : développeur senior, architecte logiciel, chef de
produit, expert UX/UI, expert QA, expert métier ENR. Neuf domaines vérifiés : moteur de scoring,
connecteurs de données externes, cohérence métier et conformité réglementaire, base de données et
migrations, API (validation, sécurité, RGPD), interface, exports et livrables, robustesse
d'exploitation, qualité technique et documentation.

**Méthode.** Aucune affirmation de ce rapport ne vient d'une lecture du code seule. Chaque constat
est établi par exécution, mesure ou requête réelle contre PostgreSQL, et chaque correction est
vérifiée par mutation : on casse ce que le test prétend protéger, et on vérifie qu'il échoue.

**État de départ, mesuré avant d'ouvrir l'audit.** 533 tests, zéro échec ; zéro erreur de typage sur
les quatre paquets ; 14/14 mutations rattrapées ; arbre de travail propre. Cet audit ne part donc pas
d'un chantier en cours : il part d'un état que les huit audits précédents déclaraient sain.

**Ce qu'un audit « à froid » change.** Les audits 2 à 8 partaient chacun d'un fil laissé par le
précédent. Celui-ci n'en avait aucun : il fallait choisir où regarder sans indice. La question
retenue est celle que les huit précédents n'avaient jamais posée. Ils demandaient tous *« la valeur
calculée est-elle juste ? »*, puis *« existe-t-il une source capable de l'alimenter ? »*. Cet audit
demande : **« la réponse rendue à l'utilisateur est-elle celle que la donnée disponible permet, au
moment où il la lit ? »** Deux mots comptent dans cette phrase, et ce sont eux qui ont produit les
trois défauts critiques :

- **rendue** — une liste triée puis tronquée ne rend pas *le classement*, elle rend *un tirage parmi
  les ex æquo*. Trois audits avaient vérifié le calcul du score ; aucun n'avait vérifié que la liste
  qui l'affiche est reproductible ;
- **au moment où il la lit** — le score ne se calcule jamais sur les couches, mais sur un instantané
  figé à l'enrichissement. Rien ne reliait cet instantané à la date d'arrivée de la donnée.

**Inventaire mesuré.** 28 669 lignes de source (2 270 core, 3 562 scoring, 16 564 API, 6 273
interface), 9 496 lignes de test réparties en 34 fichiers pour l'API et 8 pour les paquets, 8 947
lignes de documentation, 14 migrations, 47 commits. Typage strict sur les quatre paquets, zéro échec.

**Résultat.** Sept défauts confirmés, dont trois critiques, tous mesurés puis corrigés. Puis une
relecture des corrections elles-mêmes (§H), qui en a trouvé quatre de plus — dont un critique, né de
la correction du §B3 — également corrigés. 26/26 mutations rattrapées après correction, contre 14
avant ; 574 tests, zéro échec.

---

## A. Ce qui fonctionne bien

**Les corrections de l'audit 8 tiennent, et l'une d'elles s'est vérifiée toute seule pendant cet
audit.** La garde générique `sourceEnEchec` fonctionne à l'échelle de la base réelle : les 438
parcelles de la base de développement portaient `postes_sources` dans leurs connecteurs en échec, et
tous les critères de raccordement ressortaient au gris — aucune distance inventée, aucun feu vert sur
une table vide. Le mécanisme `sansSource` plafonne bien à l'orange sans jamais éteindre une filière :
le cas `bess`, qui avait été cassé puis rattrapé par un test existant pendant l'audit 8, reste juste.

**La séparation entre péremption de la donnée et péremption du calcul est correctement conçue.**
`idusARafraichir` (donnée) et `idusSansScoreCourant` (calcul) sont deux populations distinctes, et le
commentaire qui les distingue explique un défaut réellement survenu. L'empreinte
`EMPREINTE_REFERENTIEL` couvre le code, les règles datées, les pondérations par défaut **et** les
barèmes de notation : un seuil réglementaire déplacé invalide bien les scores stockés. Le défaut §B2
ci-dessous ne contredit pas cette conception — il en révèle le trou : ni l'une ni l'autre de ces deux
notions ne couvre l'arrivée de la donnée.

**Les données de démonstration sont correctement confinées.** Vérifié table par table : seules `zaer`
et `document_cadre_pv` en contiennent, toutes deux portent `est_demonstration`, et les deux lectures
concernées filtrent dessus. `poste_source`, `point_injection_gaz` et `contrainte` n'ont aucune ligne
de démonstration — l'hypothèse d'un poste source fictif devenu distance de raccordement d'une
parcelle réelle a été testée et écartée.

**Les index spatiaux sont tous présents.** Vérifié dans les migrations et dans la base : `commune`,
`parcelle`, `contrainte`, `zaer`, `document_cadre_pv`, `poste_source`, `point_injection_gaz`,
`canalisation_gaz` et `site` portent chacune un index GiST sur leur géométrie. Le défaut de
performance §C2 ne vient pas d'un index manquant, mais de requêtes écrites d'une façon qui les
empêche de servir — ce qui est un défaut différent, et moins visible.

**Le seau à jetons de limitation de débit et sa purge sont justes.** Le raisonnement du quatrième
audit, qui soupçonnait la purge d'être inopérante, avait déjà été réfuté par mutation ; la relecture à
froid confirme l'invariant : la taille croît d'exactement un par création, donc elle prend toutes les
valeurs entières, donc le multiple suivant est atteint au plus tard après 500 créations.

**La qualité rédactionnelle du code est réellement au service du lecteur.** Les commentaires portent
le *pourquoi*, la mesure, et souvent l'erreur commise avant la correction. Cet audit s'est appuyé
dessus pour choisir où chercher : c'est un bénéfice mesurable, pas un ornement.

---

## B. Défauts critiques

### B1 — Une liste triée puis tronquée n'était pas une liste, c'était un tirage

**Le fait.** Toutes les listes de l'application sont triées puis tronquées : la liste des parcelles,
le CSV qui en est exporté, les parcelles dessinées sur la carte, les leads, le journal d'accès RGPD,
les suggestions de recherche. **Aucune ne portait de départage** : le tri s'arrêtait au critère
demandé — le score, la surface, la date.

Or `ORDER BY score` ne définit aucun ordre entre parcelles de même score, et PostgreSQL est libre de
les rendre dans l'ordre qui l'arrange — ordre qu'il change avec le plan retenu.

**Pourquoi les ex æquo sont la règle et non l'exception.** Le score est arrondi au dixième : sur
l'intervalle 0-100 il n'existe que 1 001 valeurs possibles. Une campagne départementale de 200 000
parcelles compte donc quelques centaines de parcelles par valeur de score. Mesuré sur la base de
développement, pourtant réduite à 438 parcelles : **100 valeurs de score sont partagées par au moins
deux parcelles, la plus fréquente par onze.**

**Les mesures.** Sur 200 000 lignes, requête et données identiques, seul le plan différant :

| Situation | Effet mesuré |
|---|---|
| `LIMIT 300`, plan séquentiel puis plan parallèle | **113 des 300 parcelles rendues changent (38 %)** |
| `LIMIT 300`, avant puis après création d'un index | 107 des 300 changent (36 %) |
| `LIMIT 25 OFFSET 0` puis `OFFSET 25` | **20 des 25 parcelles de la page 2 étaient déjà sur la page 1** |
| Les 50 meilleures, vues par ces deux pages | **21 n'apparaissaient sur aucune des deux** |

La cause du second groupe de mesures est mécanique : le tri partiel « top-N » a une profondeur de
`OFFSET + LIMIT`, qui diffère d'une page à l'autre, donc les ex æquo retenus diffèrent aussi.

**Ce que cela signifie pour le métier.** Deux prospecteurs aux mêmes filtres n'obtenaient pas les
mêmes parcelles. Le même prospecteur n'obtenait pas deux fois la même liste, un `VACUUM` ou une
campagne de qualification suffisant à changer le plan. Et quatre parcelles sur dix du haut du
classement pouvaient rester invisibles — sans le moindre signe, puisque le total affiché, lui, était
juste. Le CSV exporté héritait du même tirage : un livrable transmis à un tiers n'était pas
reproductible.

C'est la famille de défauts des audits précédents — affirmer plus que ce que la donnée permet —
appliquée au **classement** plutôt qu'à une valeur.

**Correction.** Départage par une colonne unique partout où un tri est tronqué : `filtrerParcelles`
(les quatre tris), `parcellesDansEmprise`, `listerLeads`, `listerSites`, l'historique des leads, le
journal d'accès, `recherchePosteSource`, les postes et sites d'injection les plus proches, le rang
des objets patrimoniaux, la file de qualification et la dernière campagne. Coût mesuré sur 200 000
lignes : 0,95 ms sans départage, 1,01 ms avec.

Après correction, les mêmes mesures donnent **0 doublon et 0 omission**.

**Ce qui empêche le retour du défaut.** Un garde structurel refuse tout littéral SQL de l'API qui
trie **et** tronque sans finir par une colonne unique. Il ne protège pas seulement les requêtes
corrigées, il protège les prochaines : c'est lui qui a fait apparaître quatre tris tronqués auxquels
je n'avais pas pensé (`tache_qualification`, les deux requêtes gaz, le rang patrimonial).

### B2 — Un instantané ne vieillissait que par son âge, jamais par l'arrivée de la donnée

**Le fait.** Le moteur de scoring ne lit jamais les couches ingérées : il lit le **snapshot**, figé
au moment de l'enrichissement. Deux mécanismes seulement le renouvelaient, et aucun des deux ne
pouvait voir un changement de donnée :

- `snapshotPerime` regarde l'**âge**, 30 jours par défaut. Une ingestion faite ce matin ne rend pas
  plus vieux un snapshot d'hier ;
- `VERSION_MOTEUR` empreinte le **code**, le référentiel réglementaire et les barèmes. Son propre
  commentaire précise qu'elle ne couvre pas la donnée. Le rescoring qu'elle déclenche relit le même
  snapshot périmé et reproduit donc, fidèlement, la même valeur.

À quoi s'ajoutait un troisième trou : **la fiche parcelle n'appliquait même pas la règle des 30
jours.** Elle ne réenrichissait que si la parcelle était absente du cache ou si le rafraîchissement
était demandé explicitement. Une parcelle consultée une fois pouvait afficher indéfiniment l'état des
sources à la date de sa première consultation.

**La mesure.** Sur la base de développement : **438 parcelles du département 28 portaient un snapshot
de 11 h 48 ; les sites classés et inscrits ont été ingérés à 19 h 38** — huit heures plus tard. Ces
438 parcelles continuaient à répondre « aucune source ingérée » sur le patrimoine alors que la donnée
était en base, et rien dans l'application ne pouvait le détecter : ni l'âge (huit heures contre un
seuil de trente jours), ni l'empreinte du moteur.

**Pourquoi c'est critique et pas seulement gênant.** Le sens de l'erreur n'est pas toujours prudent.
Un snapshot pris *avant* l'arrivée d'une couche dit « inconnu », ce qui est honnête. Mais un snapshot
pris quand la couche existait déjà dit `recouvre: false` — une absence **constatée** — et un site
nouvellement classé, une ZAER nouvellement délibérée ou un poste source nouvellement construit ne
seront jamais vus. **Une parcelle devenue rédhibitoire reste verte**, et le mécanisme censé rattraper
les corrections (le rescoring par version de moteur) la recalcule à l'identique en toute confiance.

**Un mécanisme écrit puis oublié, le quatrième du projet.** `idusARafraichir` existait depuis
longtemps, son commentaire annonçait « pour les jobs de rafraîchissement »… et **elle n'était appelée
par personne**. Ces jobs n'existaient pas. Rien ne reprenait donc jamais une parcelle dont la donnée
avait vieilli, sauf à la consulter une par une.

**Correction.** `couverture_ingestion.date_ingestion` était le signal manquant : la table est déjà
tenue par département et par type, aucun schéma nouveau n'était nécessaire. Un snapshot antérieur à
la dernière ingestion touchant son département est désormais dépassé par la donnée, et cela agit à
quatre endroits :

1. `qualifierIdus` réenrichit — toute campagne, toute emprise, toute requalification répare ;
2. la fiche parcelle réenrichit à l'ouverture, sur l'âge **comme** sur la donnée. Le coût est assumé :
   servir un fait obsolète en le présentant comme actuel coûte plus cher que quelques secondes ;
3. `/api/sante` publie le nombre de parcelles en retard — le retard était jusque-là **invisible** ;
4. `POST /api/qualification/rafraichir` reprend un lot borné, soumis à la même limitation de débit
   que la qualification, et l'interface l'expose par un bandeau qui dit le retard et propose de le
   résorber.

**Vérification de bout en bout, observée pendant cet audit.** La suite de tests comporte une campagne
de qualification réelle sur l'emprise de Beauce. Elle a réenrichi **411 des 438 parcelles** parce que
leur snapshot précédait l'ingestion — ce qu'aucune version antérieure du code n'aurait fait. Le
critère patrimonial est passé de `recouvre: null` avec « aucune source ingérée » à `recouvre: false`,
un constat réel, et `patrimoine_culture` a quitté la liste des connecteurs en échec. `postes_sources`
y reste, la table étant vide : le raccordement demeure gris, ce qui est la réponse juste.

**Ce qui reste hors du champ de la correction.** Le déclenchement du rafraîchissement en lot reste une
décision de l'utilisateur, et non un travail de fond. Ce n'est pas un oubli : un rafraîchissement
consomme le quota des API publiques exactement comme une campagne, et un travail de fond viendrait
concurrencer les campagnes de l'utilisateur sur ce même quota, sans qu'il l'ait demandé.

### B3 — Une distance au plus proche n'était pas une mesure

**Le fait.** L'audit 8 avait fermé le cas « la couche n'est pas ingérée pour ce département ». Il
restait un cas voisin, propre à la **recherche de proximité** : chercher l'objet le plus proche d'un
point revient à balayer un disque, et **ce disque ne s'arrête pas à la frontière du département de la
parcelle**.

Mesuré sur le référentiel communal réel, depuis un point de Beauce : le disque de 10 km couvre deux
départements, celui de 45 km en couvre cinq, celui de 60 km en couvre six.

**Pourquoi le cas partiel n'est pas hypothétique.** L'ingestion des postes sources parcourt les treize
régions une par une et **tolère explicitement l'échec de l'une d'elles** : elle enregistre alors le
statut « partiel ». Et elle n'écrivait **aucune ligne de couverture**, faute de département —
Capareseau ne le publie pas, et l'insertion laissait la colonne vide. Personne ne pouvait donc
distinguer « aucun poste à moins de 90 km » de « la région n'a pas été ingérée ».

**Ce que cela produisait.** Si l'Île-de-France échoue, la table contient toute la France sauf huit
départements. Une parcelle de Seine-et-Marne se voit alors attribuer le poste le plus proche de ceux
qui restent — en région Centre, à 90 km — et cette distance est notée comme une mesure. **La parcelle
devient rouge sur le critère le plus lourd du profil, pour un motif de raccordement qui n'existe
pas.** C'est le défaut B1 de l'audit 8 retourné : non plus un faux vert par absence de donnée, mais
un **faux rouge par trou dans la donnée**. La même faille valait pour le site d'injection gaz, et
pour le patrimoine dès que le rayon de 10 km franchit une limite départementale — un site classé à
3 km de l'autre côté restait invisible, et son absence était affirmée.

Cas limite fermé par la même correction : les départements d'outre-mer, que Capareseau ne couvre pas.
Une parcelle guadeloupéenne se voyait attribuer le poste métropolitain le plus proche, à plus de
6 000 km, noté comme une mesure. Elle est désormais grise.

**Correction.** `disqueEntierementCouvert(type, point, rayon)` exige que **tous** les départements
traversés par le disque soient couverts. Sinon la distance n'est pas une mesure mais une borne
supérieure, et le critère reste gris. Le disque est résolu sur `commune`, ingérée pour la France
entière : un disque qui déborde en mer ou à l'étranger ne rapporte aucun département de ce côté, ce
qui est correct. L'ingestion des postes rattache désormais chaque poste à sa commune par jointure
spatiale — la méthode déjà éprouvée pour les sites protégés — et enregistre sa couverture.

Le mécanisme n'est pas un refus des grandes distances : la même distance de 30 km redevient
exploitable dès que tout le disque est déclaré. C'est un contrôle de la donnée, pas du résultat.

---

## C. Défauts importants

### C1 — Une pagination interrompue était enregistrée comme complète

L'ingestion des sites d'injection GRDF est paginée, et toute la boucle est entourée d'un seul
`try/catch`. Une erreur à la page 3 sur 9 en sortait, et comme des points avaient déjà été insérés,
le statut enregistré était **« ok »**. Un tiers des sites d'injection de France était déclaré
complet. La distance au site d'injection le plus proche — le critère de raccordement de la
méthanisation — se calculait alors sur ce tiers, en silence, et surestimait la distance.

Le contraste avec les ingestions écrites à l'audit 8 est net : celles-là vérifient la complétude de
leur pagination et le disent. Celle-ci ne le faisait pas.

**Correction.** Le statut devient « partiel » lorsque la pagination n'est pas allée au bout, et
**aucune ligne de couverture n'est écrite** dans ce cas — ce qui, combiné à B3, laisse le critère gris
plutôt que faux.

### C2 — Les filtres de proximité empêchaient l'usage des index qu'ils avaient

Les filtres spatiaux étaient écrits `ST_DWithin(geom::geography, …)`. Le transtypage en `geography`
interdit l'usage de l'index GiST posé sur `geom` : la requête parcourt donc la table entière en
convertissant chaque géométrie. Mesures :

| Requête | Formulation d'origine | Avec préfiltre géométrique |
|---|---|---|
| Départements d'un disque, sur 34 875 communes | **3 434 ms** | **4,4 ms** (780 fois moins) |
| Objets patrimoniaux dans 10 km, sur 6 617 sites | **847 ms** | **8,4 ms** (100 fois moins) |
| Comptage des intrants de méthanisation | trois balayages complets par parcelle | idem |

Ces requêtes sont appelées **une fois par parcelle**. Sur un lot de 500 parcelles, l'écart dépasse la
demi-heure — et la table patrimoniale ne contient ici que 6 617 objets, contre plusieurs dizaines de
milliers avec les monuments historiques ingérés nationalement.

**Correction.** Un préfiltre en espace géométrique devant le filtre métrique exact. La marge en
degrés est calculée sur le degré de **longitude**, le plus court aux latitudes françaises : le
préfiltre retient donc toujours un peu plus que le rayon demandé, jamais moins, et le filtre métrique
tranche exactement sur les quelques candidats restants. Le résultat est inchangé — seule sa durée
l'est. Vérifié : à 45 km depuis le point de contrôle, la version géométrique retient les cinq
départements attendus et écarte bien le sixième, dont le bord est à 51,4 km.

---

## D. Défauts secondaires

### D1 — Une ingestion n'effaçait jamais ce qui avait disparu de la source

**Le fait, vérifié.** Aucune ingestion ne contenait de `DELETE`. Elles sont toutes en « insertion ou
mise à jour » sur la clé naturelle. Un objet **retiré de la source** restait donc en base
indéfiniment, et continuait d'être affirmé : un site déclassé restait un site classé, une
délibération de ZAER annulée restait une ZAER, un poste démonté restait un poste raccordable.

**Portée réelle.** Faible pour les sites protégés — un déclassement est rare. Non négligeable pour
les ZAER : les communes révisent et annulent régulièrement leurs délibérations, et la couche
nationale suit ces révisions.

**Ce qui manquait n'était pas la requête de suppression, c'était le droit de supprimer.** Une
suppression mal gardée est bien pire que le défaut qu'elle corrige : elle transforme une source
momentanément dégradée en effacement d'une couche entière — c'est-à-dire exactement la famille de
fautes que ces audits corrigent depuis huit itérations, affirmer une absence qu'on n'a pas constatée.
Trois pièces ont donc été posées, et elles sont indépendantes :

1. **Un horodatage de revue** (migration 014). `contrainte` et `zaer` n'avaient que `created_at`, non
   touché par la mise à jour : une ligne revue à chaque exécution depuis un an portait toujours la
   date de sa première insertion. `updated_at` est désormais écrit à l'insertion **comme** à la mise à
   jour, et les lignes déjà en base reprennent leur date de création — ce qui les rend candidates à la
   suppression si la source ne les contient plus, le comportement voulu.
2. **Un contrat de complétude remonté à l'appelant.** Le générateur de pagination WFS savait déjà
   distinguer « dernière page atteinte » de « borne de sécurité atteinte », mais ne le disait qu'au
   journal. Il porte maintenant un drapeau qui part à faux et ne passe à vrai que sur la seule sortie
   qui prouve la complétude. Pour les sites, réparti sur plusieurs couches — métropole et outre-mer —
   **toutes** doivent être complètes : sinon un échec sur la couche guadeloupéenne ferait supprimer
   les sites de Guadeloupe.
3. **Un plafond de volumétrie**, fixé à 20 %. Une révision annuelle ne retire pas un objet sur cinq ;
   au-delà, l'hypothèse la plus probable n'est pas que la source a changé, c'est que la lecture s'est
   mal passée. Le refus est journalisé avec son chiffre et repris dans le compte rendu d'ingestion :
   mieux vaut une couche contenant des objets périmés, signalés, qu'une couche vidée en silence.

La décision est isolée dans une fonction pure, `suppressionAutorisee` : ce sont ses branches qui
portent le risque, pas la requête `DELETE`. Treize tests la couvrent, dont cinq contre PostgreSQL, et
les deux gardes sont vérifiées par mutation — les désarmer fait échouer respectivement 2 et 3 tests.

**Ce qui reste hors de portée d'un test, et pourquoi le plafond existe.** Aucun test ne peut vérifier
que la Géoplateforme ne se trompe pas sur sa dernière page. Le plafond de volumétrie est précisément
la garde qui ne dépend d'aucun signal externe : même si le contrat de complétude était trompé, une
disparition massive serait refusée. La vérification sur deux ingestions nationales successives — une
qui pose les objets, une qui en retire — reste à faire en exploitation ; elle confirmerait le
comportement, elle ne conditionne pas la sûreté.

**Un défaut découvert en écrivant son propre test.** La première version du test utilisait le
connecteur réel `patrimoine_sites` avec un type et un département fictifs. Le garde-fou raisonne sur
**tout** le connecteur — ce qui est le comportement juste — mais la base contenait 6 617 sites réels :
les 18 objets « disparus » du test représentaient 0,27 % et non 90 %, la suppression était autorisée,
et le scénario testé n'était plus celui qu'on croyait. Un test qui partage sa population avec les
données réelles ne peut pas tester un seuil. Le test crée désormais son propre connecteur.

**Ce qui n'est pas couvert.** Les postes sources restent hors du dispositif : leur ingestion procède
région par région et tolère l'échec de l'une d'elles, et la couverture est déduite des postes
observés, non des régions téléchargées. Un « objet disparu » y serait indiscernable d'une région non
lue. Voir §G.1.

## E. Erreurs métier

**E1. Un faux rouge coûte plus cher qu'un faux gris, et le raccordement était le seul critère à
pouvoir en produire un.** Les huit audits précédents ont traqué les faux verts — une parcelle
présentée comme propice alors que la donnée manque. Le défaut B3 produisait l'inverse : une parcelle
écartée pour une distance de raccordement qui n'existait pas. En prospection foncière, les deux
erreurs ne se paient pas au même endroit. Un faux vert se découvre à l'instruction, tard et cher. Un
faux rouge ne se découvre **jamais** : la parcelle n'est pas visitée, personne ne va vérifier, et le
gisement est perdu en silence. C'est l'erreur la plus coûteuse que ce type d'outil puisse commettre,
et elle était structurelle.

**E2. Une liste non reproductible ruine la valeur d'un outil de prospection, même si chaque score
est juste.** Le métier consiste à parcourir un classement de haut en bas jusqu'à épuisement du temps
disponible. Un classement dont le haut change à chaque consultation ne se parcourt pas : le
prospecteur croit avancer alors qu'il revoit les mêmes parcelles et en manque d'autres. Le défaut B1
n'attaquait pas le calcul, il attaquait l'**usage** — et aucune vérification du calcul ne pouvait le
voir.

**E3. Une ingestion n'a de valeur que si elle atteint les parcelles déjà qualifiées.** Le cas mesuré
en B2 est le pire scénario d'exploitation : l'utilisateur lance une ingestion, elle réussit, la base
contient la donnée, les journaux le confirment… et sa carte ne change pas. Il en conclut soit que
l'ingestion a échoué, soit qu'il n'y a rien à trouver. Les deux conclusions sont fausses.

---

## F. Risques résiduels

**F1. Le rafraîchissement reste manuel, et cela se voit.** Le retard est publié et un bouton le
résorbe par lots, mais rien ne le fait tout seul. C'est un choix — le quota des API publiques est
partagé — et non un oubli. Le risque subsiste qu'un exploitant ignore le bandeau.

**F2. La couverture par département est une approximation à la maille du département.** Un
département déclaré couvert l'est parce qu'au moins un objet y a été ingéré. Une ingestion qui aurait
réussi sur la moitié d'un département passerait pour complète. La maille disponible est celle de
`couverture_ingestion` ; descendre plus fin demanderait un modèle de couverture géométrique, ce qui
n'est pas justifié aujourd'hui.

**F3. La suppression des objets disparus n'a pas encore été observée sur deux ingestions nationales
successives.** Les gardes sont testées, dont le plafond de volumétrie qui ne dépend d'aucun signal
externe ; ce qui reste à confirmer en exploitation est la fidélité du signal de complétude de la
Géoplateforme. Le risque est borné par le plafond, non par la confiance dans la source.

**F4. Traité par la relecture, voir §H4.** La couverture des postes est désormais posée sur les
départements des régions effectivement téléchargées, comptage nul compris. Ce qui subsiste est plus
étroit : un poste démonté reste indiscernable d'une région non lue, donc les postes restent hors du
dispositif d'effacement des objets disparus (§G.2).

**F5. Les éléments de priorité 5 des audits précédents restent entiers**, parce qu'ils ne dépendent
pas du code : campagne de validation par un expert sur 50 parcelles réelles, devis de raccordement
réels pour recalibrer les paliers de distance, revue juridique du référentiel réglementaire, test
d'usage sur le poste d'un prospecteur.

---

## G. Améliorations classées par priorité

1. **Observer un cycle complet d'effacement sur deux ingestions nationales successives**, pour
   confirmer le signal de complétude de la Géoplateforme (risque F3).
2. **Faire entrer les postes sources dans le dispositif d'effacement des objets disparus.** Leur
   couverture est désormais posée par région téléchargée (§H4), ce qui lève l'obstacle ; il reste à
   distinguer un poste démonté d'une région non lue.
3. **Mesurer le coût réel du réenrichissement à l'ouverture d'une fiche** sur une instance chargée, et
   décider s'il faut le rendre asynchrone avec affichage immédiat de l'ancien état daté.
4. **Les quatre éléments de priorité 5 hérités** (F5), qui ne dépendent pas du code.

---

## H. Relecture de mes propres corrections

Cette section n'existe dans aucun des huit audits précédents, et c'est un manque : chacun corrigeait
des défauts sans jamais vérifier que ses corrections n'en créaient pas. La question posée ici est
donc : **qu'est-ce que la correction de l'audit 9 a cassé ?** Quatre défauts, dont un critique, tous
mesurés puis corrigés à leur tour.

### H1 — La correction du disque grisait toute instance déjà en service (critique)

Le contrôle de couverture introduit en §B3 consulte `couverture_ingestion` avant de rendre une
distance. Or les deux connecteurs concernés n'y écrivaient **aucune ligne** avant cet audit — c'était
la cause même du défaut — et les lignes n'apparaissent qu'à la prochaine ingestion.

Conséquence sur une instance où les postes sont ingérés depuis des mois : **tous les critères de
raccordement, les plus lourds du profil, passaient au gris au déploiement**, et le restaient jusqu'à
ce que l'exploitant relance l'ingestion, sans qu'aucun message ne le lui dise. Une correction de
fiabilité qui dégrade silencieusement le critère principal n'est pas une correction — c'est le même
défaut déplacé.

Correction : la migration 015 déduit la couverture du contenu des tables, rattache les postes à leur
commune par jointure spatiale, et écrit la provenance dans `source_document` pour qu'une couverture
**déduite** reste distinguable d'une couverture **constatée**. Un test rejoue le scénario complet de
mise à niveau : poste présent sans couverture → distance non rendue → migration → distance rendue,
sans qu'aucune ingestion n'ait été relancée. La reprise est vérifiée rejouable, et elle n'écrase pas
une couverture qu'une ingestion postérieure aurait constatée.

### H2 — J'ai commis dans la correction du §C2 la faute que le §C2 corrigeait

`nbARafraichir`, écrite pour rendre le retard visible dans `/api/sante`, comparait chaque snapshot à
une **sous-requête corrélée** sur `couverture_ingestion`, évaluée une fois par parcelle. Mesure :
**2 973 ms sur 200 000 parcelles** — pour une requête que la sonde de santé exécute à chaque
chargement de l'interface. Avec l'agrégation préalable : **108 ms**, vingt-sept fois moins, résultat
identique.

C'est exactement le défaut C2 — une requête écrite d'une façon qui empêche PostgreSQL de travailler
efficacement — commis dans le commit qui corrigeait C2. La leçon est que la mesure doit accompagner
l'écriture, pas seulement l'audit.

### H3 — Une route de qualification sans contrôle de rôle, et je l'ai reproduit

En ajoutant `POST /api/qualification/rafraichir`, je n'ai pas repris le refus des comptes en lecture
seule. La vérification a montré que **`POST /api/qualification/parcelles` ne l'avait jamais eu non
plus** : un compte en lecture seule pouvait qualifier une liste d'identifiants jusqu'au plafond par
appel, et épuiser le quota partagé par toute l'équipe. Le fichier `acces-roles.test.ts` avait pourtant
été écrit parce que « le rôle lecture était appliqué aux leads mais pas à la qualification » — il ne
couvrait que la route d'emprise, et la route sœur est restée ouverte pendant tout ce temps.

Trois occasions de poser ce contrôle, deux manquées. Un contrôle qu'on recopie finit par être oublié :
il est désormais nommé (`refuserLectureSeule`), les trois routes l'appellent, un test structurel exige
sa présence sur toute route de qualification, et l'interface n'affiche plus le bouton de
rafraîchissement à un compte qui recevrait un 403.

### H4 — « On a regardé ici » n'est pas « on a trouvé quelque chose ici » (risque F4 traité)

La couverture était déduite des objets **observés**, et la lecture exigeait `nb_objets > 0`. Un
département réellement dépourvu de l'objet cherché ne portait donc aucune ligne exploitable, et le
contrôle du disque grisait le critère de toutes les parcelles à portée de sa frontière — pour une
donnée qui, elle, était complète.

L'ingestion des postes pose désormais la couverture sur les départements des **régions effectivement
téléchargées**, comptage nul compris, et la lecture ne conditionne plus le verdict à un comptage non
nul : l'existence de la ligne prouve le regard, puisqu'une ligne n'existe que si une ingestion l'a
écrite. Le changement est sans effet sur les données existantes — aucune ligne à zéro n'existait.

### Deux gardes ajoutés par cette relecture

- **Tout littéral SQL du projet est analysé par PostgreSQL** (`PREPARE`, sans exécution). Les requêtes
  d'ingestion ne s'exécutent qu'après plusieurs minutes de téléchargement : une faute de syntaxe y
  restait invisible jusqu'à l'échec d'une ingestion réelle. Ce n'est pas théorique — une apostrophe
  inversée dans un commentaire SQL a cassé trois fois son littéral au cours de ces audits.
- **Le garde structurel des tris couvre aussi les migrations**, vérifié en y déposant une vue fautive
  temporaire pour s'assurer qu'il la voyait.

### Ce que cette section dit de la méthode

Les quatre défauts ci-dessus ont un point commun : **aucun n'aurait été trouvé par la relecture du
diff.** H1 demande de se demander ce qui se passe sur une base qui existe déjà ; H2 demande une mesure
à l'échelle ; H3 demande de comparer une route neuve à ses sœurs ; H4 demande de distinguer deux
formulations qui se ressemblent. Un audit qui ne s'applique pas à lui-même laisse passer, par
construction, tout ce que la correction introduit — et sur les quatre trouvés ici, un était critique.

---

## Score

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | 77/100 | Les trois défauts critiques touchaient tous la fiabilité de ce qui est **rendu**, non de ce qui est calculé : un classement non reproductible, un état de la donnée périmé sans le dire, une distance mesurée sur un disque incomplet. Corrigés et vérifiés par mutation. Ce qui plafonne la note : la validation par un expert sur des parcelles réelles n'a toujours pas eu lieu, et un cycle d'effacement n'a pas encore été observé en exploitation. |
| Qualité technique | 79/100 | Typage strict sans échec, 26 mutations toutes rattrapées, gardes structurels sur les tris et sur l'analysabilité de tout le SQL, tests de base qui refusent de passer à vide. Retiré, et lourdement : deux défauts de performance d'un facteur 100 à 780 vivaient dans du code écrit à l'audit précédent sans qu'aucune mesure ne les voie — et la relecture du §H a montré que **la correction de l'un d'eux reproduisait exactement la même faute**, plus une régression critique et deux contrôles d'accès manquants. Corriger sans mesurer ni comparer aux routes sœurs reste le point faible de ce projet. |
| Qualité métier | 78/100 | Le raisonnement métier est juste et daté ; la distinction faux vert / faux rouge est désormais traitée des deux côtés. Retiré : le faux rouge structurel du raccordement a survécu à huit audits, et l'obsolescence d'un instantané après ingestion n'avait jamais été posée comme une question métier. |
| Ergonomie | 76/100 | Le retard sur la donnée est visible et actionnable, la fiche se répare à l'ouverture, la traçabilité porte la date d'interrogation des sources. Retiré : rien n'avertit *dans* la fiche que la parcelle vient d'être réenrichie, et le bandeau est le seul indicateur du retard. |
| Robustesse | 82/100 | Reprise HTTP à deux profils, pagination vérifiée et désormais remontée à l'appelant, statut « partiel » honnête sur l'ingestion gaz, couverture refusée sur une exécution incomplète, effacement des objets disparus gardé par deux conditions indépendantes. Retiré : la couverture à la maille du département (F2), les postes sources hors du dispositif d'effacement (F4). |
| Professionnalisation | 80/100 | 8 947 lignes de documentation, neuf rapports d'audit, CI qui exécute les tests de base et la vérification par mutation contre PostgreSQL, journalisation exploitable. Retiré : le rafraîchissement reste manuel, et l'exploitant doit savoir lire un bandeau. |

**Score global : 78/100.**

L'audit 8 avait conclu à **56/100**, l'audit 7 à 67. La hausse à 78 ne dit pas que l'application est
soudain devenue meilleure de vingt-deux points : elle dit que l'audit 8 notait un état où le critère
patrimonial valait 90/100 en vert sur zéro donnée, et que cet état n'existe plus.

**Une mise au point sur ce paragraphe, parce qu'elle illustre le défaut que ce rapport traque.** Sa
première version affirmait « le score baisse d'un point par rapport à l'audit 8 » — je l'avais écrit
sans ouvrir `AUDIT-8.md`. Le chiffre réel y est 56. L'affirmation était donc fausse, et de la manière
exacte que les neuf audits reprochent au code : une valeur présentée comme mesurée alors qu'elle
n'avait pas de source. Un rapport qui exige des preuves du code se les doit à lui-même ; la correction
est plus utile ici que son effacement.

Ce que le chiffre ne dit pas, et qui compte davantage : **sur onze corrections, quatre ont introduit un
défaut, dont un critique** (§H). Un audit qui ne se relit pas produit donc, lui aussi, une note trop
haute — et la note ci-dessus n'est crédible que parce que cette relecture a eu lieu.

---

## Réponse à la question posée

> **« Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un cadre
> professionnel sans risque majeur d'erreur ? »**

**Oui pour l'usage auquel elle est destinée — le pré-filtrage de foncier et la constitution d'un
portefeuille de pistes — à trois conditions explicites, et non pour fonder seule une décision
d'investissement ou un engagement contractuel.**

Ce qu'on peut désormais affirmer, parce qu'il a été mesuré : la liste des parcelles et le CSV qui en
est exporté sont reproductibles ; un critère dont la source manque, a échoué, ou n'est pas ingérée sur
tout le territoire que la question balaie, ressort au gris et non en vert ni en rouge ; et une
ingestion atteint les parcelles déjà qualifiées, ce qui n'était pas le cas avant cet audit.

Les trois conditions :

1. **Lire le bandeau « parcelles en retard sur la donnée » et le résorber après chaque ingestion.**
   Sans cela, la carte affiche l'état d'avant — visiblement, désormais, mais il faut regarder.
2. **Lire le compte rendu d'ingestion**, qui indique désormais combien d'objets disparus ont été
   effacés — et, le cas échéant, pourquoi l'effacement a été refusé. Un refus signifie que la couche
   contient des objets périmés.
3. **Ne jamais traiter un feu vert comme une conclusion.** L'application classe et écarte ; elle
   n'instruit pas. Les avertissements du §12 du cahier des charges restent la lecture obligatoire de
   toute fiche, et la validation par un expert sur 50 parcelles réelles — préparée, jamais exécutée —
   reste la condition d'un usage pleinement confiant.

Ce que cet audit établit accessoirement, et qui mérite d'être dit sans complaisance : **huit audits
successifs ont pu déclarer saine une application dont le classement n'était pas reproductible.** La
leçon n'est pas que ces audits étaient mauvais, mais qu'aucun n'avait interrogé le chemin entre le
score et l'écran. La méthode qui a produit ces trois défauts — changer de question plutôt que
relire le même code plus attentivement — est le seul acquis de cet audit qui vaille pour le suivant.
