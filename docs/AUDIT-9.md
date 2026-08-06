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
interface), 9 496 lignes de test réparties en 32 fichiers pour l'API et 8 pour les paquets, 8 947
lignes de documentation, 13 migrations, 47 commits. Typage strict sur les quatre paquets, zéro échec.

**Résultat.** Six défauts confirmés, dont trois critiques, tous mesurés puis corrigés ; un septième
confirmé et **non corrigé**, dont la raison est donnée en §D. 21/21 mutations rattrapées après
correction, contre 14 avant.

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

## D. Défaut confirmé et NON corrigé

### D1 — Une ingestion n'efface jamais ce qui a disparu de la source

**Le fait, vérifié.** Aucune des ingestions ne contient de `DELETE`. Elles sont toutes en
« insertion ou mise à jour » sur la clé naturelle. Un objet **retiré de la source** reste donc en base
indéfiniment, et continue d'être affirmé : un site déclassé reste un site classé, une délibération de
ZAER annulée reste une ZAER, un poste démonté reste un poste raccordable.

**Portée réelle.** Faible pour les sites protégés — un déclassement est rare. Non négligeable pour les
ZAER : les communes révisent et annulent régulièrement leurs délibérations, et la couche nationale
suit ces révisions. C'est donc un défaut de fond, pas une hypothèse d'école.

**Pourquoi il n'est pas corrigé dans cet audit, et ce que cela coûterait.** La correction demande
trois choses, dont aucune n'est acquise :

1. **un horodatage de mise à jour**, qui n'existe pas. `contrainte` et `zaer` n'ont que `created_at`,
   non touché par l'upsert : rien ne distingue aujourd'hui une ligne revue d'une ligne oubliée. Il
   faut une migration ;
2. **un contrat de complétude** remonté au point d'effacement. Le générateur de pagination WFS sait
   distinguer « dernière page atteinte » de « borne de sécurité atteinte », mais ne le dit pas à son
   appelant. Effacer sur une exécution incomplète supprimerait des objets réels ;
3. **un garde-fou de volumétrie.** Une source qui tronque silencieusement sa réponse ferait, sans ce
   garde, disparaître une couche entière. C'est exactement la famille de défauts que ces audits
   corrigent depuis huit itérations, et l'introduire par sa correction serait le pire résultat
   possible.

Il faut de plus prouver la correction sur **deux ingestions nationales complètes successives** — une
qui pose les objets, une qui en retire un — soit une vingtaine de minutes de réseau par couche. Livrer
un chemin de code destructeur validé seulement sur un jeu synthétique n'est pas défendable ; je
préfère le déclarer que le bâcler.

**Ce qui atténue le défaut en l'état.** Rien, et il faut le dire clairement : aucune alerte, aucun
indicateur. L'exploitant qui veut s'en prémunir doit aujourd'hui vider la couche avant de la
réingérer, ce qui la rend indisponible pendant l'opération.

**Recommandation.** Priorité 1 de la prochaine itération, avec le protocole de vérification ci-dessus.

---

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

**F3. D1 reste ouvert.** Voir §D.

**F4. Les postes sources restent hors du contrôle de complétude par région.** La couverture est
déduite des postes effectivement présents, non des régions effectivement téléchargées. Un département
réellement dépourvu de poste serait déclaré « inconnu » plutôt que « sans poste » — l'erreur va dans
le sens prudent, mais elle existe.

**F5. Les éléments de priorité 5 des audits précédents restent entiers**, parce qu'ils ne dépendent
pas du code : campagne de validation par un expert sur 50 parcelles réelles, devis de raccordement
réels pour recalibrer les paliers de distance, revue juridique du référentiel réglementaire, test
d'usage sur le poste d'un prospecteur.

---

## G. Améliorations classées par priorité

1. **Effacer ce qui a disparu de la source** (défaut D1), avec migration d'horodatage, contrat de
   complétude et garde-fou de volumétrie, prouvé sur deux ingestions nationales successives.
2. **Descendre le contrôle de complétude des postes sources à la région téléchargée** plutôt qu'aux
   départements observés (risque F4).
3. **Étendre le garde structurel des tris** aux requêtes de l'interface et des scripts, pas seulement
   à `apps/api/src`.
4. **Mesurer le coût réel du réenrichissement à l'ouverture d'une fiche** sur une instance chargée, et
   décider s'il faut le rendre asynchrone avec affichage immédiat de l'ancien état daté.
5. **Les quatre éléments de priorité 5 hérités** (F5), qui ne dépendent pas du code.

---

## Score

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | 74/100 | Les trois défauts critiques touchaient tous la fiabilité de ce qui est **rendu**, non de ce qui est calculé : un classement non reproductible, un état de la donnée périmé sans le dire, une distance mesurée sur un disque incomplet. Corrigés et vérifiés par mutation. Ce qui plafonne la note : D1 reste ouvert, et la validation par un expert sur des parcelles réelles n'a toujours pas eu lieu. |
| Qualité technique | 82/100 | Typage strict sans échec, 21 mutations toutes rattrapées, garde structurel qui protège les futurs tris, tests de base qui refusent de passer à vide. Retiré : deux défauts de performance d'un facteur 100 à 780 vivaient dans du code écrit à l'audit précédent, et aucune mesure ne les avait vus. |
| Qualité métier | 78/100 | Le raisonnement métier est juste et daté ; la distinction faux vert / faux rouge est désormais traitée des deux côtés. Retiré : le faux rouge structurel du raccordement a survécu à huit audits, et l'obsolescence d'un instantané après ingestion n'avait jamais été posée comme une question métier. |
| Ergonomie | 76/100 | Le retard sur la donnée est visible et actionnable, la fiche se répare à l'ouverture, la traçabilité porte la date d'interrogation des sources. Retiré : rien n'avertit *dans* la fiche que la parcelle vient d'être réenrichie, et le bandeau est le seul indicateur du retard. |
| Robustesse | 79/100 | Reprise HTTP à deux profils, pagination vérifiée, statut « partiel » désormais honnête sur l'ingestion gaz, couverture refusée sur une exécution incomplète. Retiré : D1, et la couverture à la maille du département (F2). |
| Professionnalisation | 80/100 | 8 947 lignes de documentation, neuf rapports d'audit, CI qui exécute les tests de base et la vérification par mutation contre PostgreSQL, journalisation exploitable. Retiré : le rafraîchissement reste manuel, et l'exploitant doit savoir lire un bandeau. |

**Score global : 78/100.**

Le score baisse d'un point par rapport à l'audit 8 malgré six corrections. C'est volontaire et c'est
l'information la plus utile de ce rapport : un audit à froid, en changeant de question, a trouvé trois
défauts critiques dans du code que huit audits déclaraient sain. La note antérieure était donc trop
haute, non parce que les corrections d'alors étaient fausses, mais parce que la question posée était
trop étroite. Ce qui a été vérifié huit fois ne l'a été que sous un angle.

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
2. **Recharger une couche entière plutôt que la réingérer par-dessus lorsque la source a retiré des
   objets** (défaut D1), tant que la correction annoncée en §G.1 n'est pas faite.
3. **Ne jamais traiter un feu vert comme une conclusion.** L'application classe et écarte ; elle
   n'instruit pas. Les avertissements du §12 du cahier des charges restent la lecture obligatoire de
   toute fiche, et la validation par un expert sur 50 parcelles réelles — préparée, jamais exécutée —
   reste la condition d'un usage pleinement confiant.

Ce que cet audit établit accessoirement, et qui mérite d'être dit sans complaisance : **huit audits
successifs ont pu déclarer saine une application dont le classement n'était pas reproductible.** La
leçon n'est pas que ces audits étaient mauvais, mais qu'aucun n'avait interrogé le chemin entre le
score et l'écran. La méthode qui a produit ces trois défauts — changer de question plutôt que
relire le même code plus attentivement — est le seul acquis de cet audit qui vaille pour le suivant.
