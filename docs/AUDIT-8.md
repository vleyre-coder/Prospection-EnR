# Huitième audit complet — 6 août 2026

Audit conduit simultanément sous six angles : développeur senior, architecte logiciel, chef de
produit, expert UX/UI, expert QA, expert métier ENR. Neuf domaines vérifiés : moteur de scoring,
connecteurs de données externes, cohérence métier et conformité réglementaire, base de données et
migrations, API (validation, sécurité, RGPD), interface, exports et livrables, robustesse
d'exploitation, qualité technique et documentation.

**Méthode.** Aucune affirmation de ce rapport ne vient d'une lecture du code seule : chaque constat
est établi par exécution, mesure, ou requête réelle contre PostgreSQL. Les notes citées sont
obtenues en appelant `calculerScore` ; les erreurs HTTP en faisant parvenir la valeur fautive
jusqu'au serveur PostgreSQL.

**Ce que cet audit devait être, et est.** Les sept audits précédents ont chacun trouvé un défaut
grave puis l'ont corrigé, et le suivant en trouvait un autre. Cette itération devait cesser. Cet
audit a donc changé de question. Les précédents demandaient : *« ce que le code calcule est-il
juste ? »* Celui-ci demande : **« existe-t-il, en production, un chemin de données capable
d'alimenter ce que le code affiche ? »** La question est différente et la réponse est plus dure :
plusieurs critères notés, affichés et exportés depuis l'origine n'ont **aucune source**, et
affichent malgré cela un fait affirmé et un feu vert.

**Périmètre.** Cet audit est le premier à couvrir les quatre zones jamais examinées :
`connecteurs/locales.ts`, `connecteurs/vent.ts`, `connecteurs/gisement.ts` et les 44 routes HTTP.
C'est là que se trouvent la totalité des défauts majeurs ci-dessous. Les zones auditées six fois
n'ont produit aucun défaut nouveau — ce qui est l'information utile sur la méthode des audits
précédents : elles relisaient le code déjà relu.

**Inventaire mesuré.** 25 529 lignes de source (2 154 core, 3 307 scoring, 13 883 API, 6 185
interface), 6 087 lignes de test réparties en 28 fichiers, 7 106 lignes de documentation,
12 migrations, 37 commits. Typage strict sur les quatre paquets, zéro échec.

---

## A. Ce qui fonctionne bien

**Les corrections de l'audit 7 tiennent.** Le classement des familles de PPR d'après `libPpr`
fonctionne : les cinq communes de contrôle (Menton, Lyon, Paris, Montpellier, Bourges) ressortent
correctement, la pagination Géorisques est complète (148, 214 et 239 objets là où 100 étaient lus),
et les sept mutations du script de vérification sont toutes rattrapées par au moins un test.

**Le dispositif RGPD est le point le plus solide de l'application.** Vérifié ligne à ligne :
habilitation exigée, motif d'au moins cinq caractères en en-tête obligatoire, journalisation
*stricte* (l'échec d'écriture du journal refuse la consultation), et surtout **trois états** au lieu
de deux — `non_alimentee`, `sans_donnee_pour_cette_parcelle`, `renseignee` — avec un avertissement
explicite disant que l'absence d'information ne dit rien du propriétaire. C'est exactement le
raisonnement que le reste de l'application ne fait pas (voir B1 à B4).

**Les gardes de tuiles sont correctes.** `Number.isInteger` sur z/x/y, bornes de pyramide
(`x >= 2**z` → 204), zoom minimal respecté, `Cache-Control: private` + `Vary: Authorization` sur les
tuiles parcellaires qui portent le statut de prospection. Les relais de fond de carte, de glyphes et
de calques ont tous une liste fermée : aucun n'est un proxy ouvert.

**Le raisonnement « inconnu ≠ nul » est correctement tenu là où il a été écrit.** `reseauGaz`
retourne quatre `null` quand rien n'est trouvé. `zaer` retourne `present: null`. `vent.ts` retourne
`null` hors emprise, sur valeur de non-donnée et sur raster absent. `documentCadrePv` distingue
document littéral et document cartographié. Le problème n'est pas le principe : c'est qu'il n'a pas
été appliqué à `patrimoine()`, à `contexteFoncier()` ni à `intrantsMethanisation()`.

**Le contrôle des champs orphelins est sain dans le sens où il regarde.** Les 156 feuilles du
snapshot sont toutes citées quelque part dans l'API ou le moteur : aucun champ mort. Sa limite est
qu'il vérifie la *citation*, pas l'*alimentation* — c'est précisément l'angle mort que cet audit
exploite, et il faut le refermer (voir G, item 21).

**L'écriture atomique du raster de vent est juste** (`.partiel` puis `rename`), avec contrôle de
taille minimale : un raster tronqué par une interruption serait pire qu'aucun raster.

---

## B. Défauts critiques

### B1. Un critère est vert à 90/100 sur une couche qui n'est jamais ingérée

**Le fait.** `pat_sites` — « sites classés et inscrits » — vaut **90/100, feu VERT**, avec le libellé
**« Aucun site classé ni inscrit dans le rayon d'analyse »**, sur *toutes* les parcelles de France.

**La chaîne, vérifiée maillon par maillon.**

1. `locales.ts:232` lit la table `contrainte` pour quatre types :
   `monument_historique`, `site_classe`, `site_inscrit`, `spr`.
2. Il existe **un seul** `INSERT INTO contrainte` dans toute l'application
   (`ingestion/index.ts:287`), et il écrit **un seul** type littéral : `'monument_historique'`.
3. Le registre des jobs d'ingestion (`JOBS`) compte cinq entrées : `communes`, `postes_sources`,
   `reseau_gaz`, `patrimoine_culture`, `vent_100m`. Aucune ne produit de site classé, inscrit ou SPR.
4. Donc `lignes.filter(l => l.type === 'site_classe')` est **toujours vide**, et l'aide `zonage([])`
   retourne `{ recouvre: false, partRecouvrement: 0, distanceM: null, nom: null }` — une **absence
   affirmée**.
5. `noteProximiteZonage` reçoit `recouvre === false` et `distanceM == null`, et retourne **90**
   (`criteres-eval.ts:952`), avec le commentaire « la recherche dans le rayon n'a rien renvoyé ».
   Elle n'a rien renvoyé parce qu'il n'y a rien à renvoyer, jamais.

**Mesuré :**

```
solaire_sol        {"note":90,"feu":"vert","affiche":"Aucun site classe ni inscrit dans le rayon d'analyse"}
eolien_terrestre   {"note":90,"feu":"vert","affiche":"Aucun site classe ni inscrit dans le rayon d'analyse"}
```

**Deux conséquences, dont la seconde est la pire.**

*Le score.* Poids 1,53 % (solaire) et 2,34 % (éolien) : contribution de 1,38 et 2,11 points. Faible.

*Le knock-out.* `knockouts.ts:236` teste `s.patrimoine.siteClasse.recouvre === true`. Cette
condition est **structurellement inatteignable**. Le knock-out `ko_eol_site_classe` — un parc éolien
en site classé — **ne peut pas se déclencher**. Un site classé est protégé par l'article L. 341-10
du code de l'environnement : l'implantation y exige une autorisation ministérielle spéciale, jamais
accordée pour un parc éolien. L'application présenterait une telle parcelle comme compatible, avec
en outre la phrase écrite « aucun site classé ni inscrit dans le rayon d'analyse ».

*Effet de bord.* `avisAbfRequis` ne peut jamais devenir vrai par la voie site inscrit ou SPR, et
`couvertureDonnees` compte ce critère comme **couvert** : la couverture affichée est surévaluée.

**Gravité.** Maximale. C'est le défaut le plus grave des huit audits : les précédents trouvaient un
calcul faux sur une donnée réelle ; celui-ci est un **fait juridique affirmé, écrit noir sur blanc
dans un livrable transmis à des tiers, sur zéro donnée**.

### B2. Le nombre de propriétaires est une constante codée en dur, notée 100/100

**Le fait.** `cadastre.ts:246` retourne `nbProprietairesEstime: 1`. Littéralement. Pour toutes les
parcelles de France.

Le commentaire immédiatement au-dessus décrit un algorithme : *« Estimation prudente : au moins un
propriétaire, et un de plus par tranche de 5 parcelles voisines de sections différentes. »*
**Cet algorithme n'est pas écrit.** Les variables `voisines` et `memeSection` sont bien calculées,
mais ne servent qu'à `surfaceBlocHa`. Le comptage par tranche de cinq n'existe nulle part.

**Mesuré :**

```
n = 1     note 100 vert | 1 proprietaire(s) estime(s)
n = 2     note 82  vert | 2 proprietaire(s) estime(s)
n = 5     note 45  orange
n = null  note null gris | donnee indisponible
```

`fonc_nb_proprietaires` vaut donc **100/100, VERT, « 1 propriétaire(s) estimé(s) »** partout. Poids :
3,05 % (solaire), 3,13 % (éolien), 2,42 % (bess), 2,75 % (méthanisation).

**Pourquoi c'est grave au-delà du score.** La maîtrise foncière est le premier facteur de mortalité
d'un projet ENR. Un prospecteur lit « 1 propriétaire » et en déduit une négociation simple. Sur une
parcelle en indivision successorale à onze ayants droit, la même mention s'affiche. Le critère
n'informe pas : il rassure faussement, et il le fait avec un chiffre précis, ce qui est plus
trompeur qu'un gris.

**Gravité.** Maximale, à égalité avec B1. Un commentaire décrivant du code qui n'existe pas est
aussi un défaut de revue : les sept audits précédents ont lu ce fichier.

### B3. Un échec de source Géorisques produit « aléa inondation nul », noté 100/100

**Le fait.** `georisques.ts:463` :

```ts
alea:
  triZonage == null && tri == null && pprn == null
    ? null
    : (triZonage?.objets.length ?? 0) > 0 ? 'fort'
      : parFamille.has('inondation') ? 'moyen'
        : 'nul',
```

Les trois conditions du `null` sont liées par **`&&`**. Il faut que les *trois* appels aient échoué
pour que l'aléa soit inconnu. Si l'appel TRI réussit et que l'appel `gaspar/pprn` **échoue**,
`parFamille` est vide et l'expression tombe sur `'nul'`.

**Mesuré :**

```
alea = nul    -> risq_inondation  note 100  VERT    « alea nul »
alea = moyen  -> risq_inondation  note  45  orange
alea = fort   -> risq_inondation  note  12  rouge
alea = null   -> risq_inondation  note null gris    « donnee indisponible »
```

Un échec de source produit donc la **meilleure note possible** sur le critère inondation. Poids :
2,29 % (solaire), 4,03 % (bess), 3,67 % (méthanisation).

**Et l'échec est bien détecté — sans rien empêcher.** `georisques.ts:375` fait
`if (pprn == null) echecs.push('georisques/gaspar/pprn')`. La liste remonte jusqu'à
`connecteursEnEchec`, et `exports.ts:716` l'imprime dans le PDF sous la forme « les critères qui en
dépendent sont restés non évalués ». Or **le moteur de scoring ne reçoit jamais cette liste** : elle
n'apparaît dans aucun fichier de `packages/scoring`. Le même PDF porte donc, sur la même page, un
feu vert « aléa nul » et une note de bas de page disant que la source a échoué et que le critère n'a
pas été évalué. Les deux se contredisent.

**Gravité.** Maximale. C'est la direction dangereuse de l'erreur : un silence de source devient une
affirmation favorable.

### B4. Un fait communal est présenté comme une mesure parcellaire — et coûte 55 points

Ce défaut avait été identifié en fin d'audit 7 et noté comme « effet score nul ». **C'était faux, et
je le corrige ici :** la mesure montre un effet réel.

**Le fait.** `parFamille.has('inondation') ? 'moyen'`. `parFamille` est construit à partir des plans
de prévention recensés par Géorisques **à l'échelle de la commune**. L'existence d'un PPRI sur la
commune devient donc « aléa moyen » sur *chaque parcelle* de cette commune, y compris celles situées
sur un plateau à trois kilomètres du moindre cours d'eau. 85 % des communes françaises ont un PPRN.

`risq_inondation` passe de 100 (nul) à **45, feu orange**, soit **−55 points sur le critère**. Effet
global : de l'ordre de 1 à 2 points de score selon la filière — modeste. Mais le critère apparaît en
**point de vigilance** sur la quasi-totalité des parcelles, ce qui noie la liste des vigilances
réelles sous un bruit systématique. Un signal présent partout n'est plus un signal.

**Le bon comportement.** `alea` doit valoir `null` (inconnu) quand un PPRI existe sur la commune sans
information parcellaire. Le critère conserve son signal par `zonagePpri` et par `parPpri` côté PPR,
qui sont, eux, des faits parcellaires.

### B5. Un PPRN dont le libellé n'est pas classable produit « pas de PPRI » — 30 % des cas

Report de l'audit 7, **non corrigé**, revérifié présent.

`georisques.ts:441` : `plan(pprn, famille)` retourne `present: parFamille.has(famille)`. Le cas
`pprn == null` (échec) donne bien `present: null`. Mais le cas **« un PPRN existe, et son libellé
n'entre dans aucune famille »** donne `present: false` — une absence affirmée là où la vérité est
« inconnu ».

Mesuré à l'audit 7 sur l'échantillon national : **30 % des communes ayant un PPRN ont au moins un
plan dont le libellé n'est pas classable** par `famillesRisque`. Sur celles-là, `ppri.present` vaut
`false` : l'application affirme l'absence d'un plan de prévention du risque d'inondation qu'elle
vient elle-même de lire.

**Le bon comportement.** Un plan non classable venant de `gaspar/pprn` doit rendre les familles
*naturelles* (`inondation`, `incendie`, `mouvement`, `argiles`, `séisme`) **`null`** et non `false`.
`pprt` n'est pas concerné : il est classé par provenance, pas par libellé. À faire en même temps,
enrichissements déterminés : `MT` → mouvement, `Pi` et `PPRNPi` → inondation, « multi » sans jetons
entre crochets → indéterminé, donc `null`.

### B6. La filière méthanisation n'a pas de données : 46 % de sa pondération est fausse ou grise

C'est le constat de synthèse, et il est spécifique à une filière offerte dans l'interface au même
rang que les trois autres.

| Critère | Poids | État réel |
|---|---|---|
| `gis_intrants` | 16,5 % | **Gris permanent** — les couches `elevage`, `industrie_agroalimentaire`, `surface_agricole_commune` ne sont ingérées par aucun job |
| `racc_distance_reseau_gaz` | 11,0 % | **Mesure autre chose** — voir ci-dessous |
| `gis_debouche_epandage` | 7,3 % | **Gris permanent** — même cause que `gis_intrants` |
| `risq_karst` | 4,6 % | **Gris permanent** — `karst: null` inconditionnel |
| `risq_inondation` | 3,7 % | Affecté par B3 et B4 |
| `fonc_nb_proprietaires` | 2,8 % | Constante codée en dur (B2) |
| **Total** | **45,9 %** | |

**Le détail sur le raccordement gaz, qui est le plus insidieux.** `reseauGaz()` interroge deux
tables : `point_injection_gaz` et `canalisation_gaz`. La table `canalisation_gaz` existe dans la
migration 003, elle est lue par `locales.ts:105` **et par la couche carte `/api/carte/reseau-gaz`** —
et elle n'est **peuplée par rien**, pas même par le jeu de démonstration. Seule
`point_injection_gaz` est alimentée, par le job `reseau_gaz`.

Conséquence métier : `reseauGaz.distanceKm` mesure la distance au **site d'injection de biométhane
existant le plus proche**, et non la distance au réseau de gaz. Ce sont deux grandeurs sans rapport :
il y a quelques centaines de sites d'injection en France et des dizaines de milliers de kilomètres de
canalisations. La distance retournée est donc structurellement très supérieure à la distance
pertinente, et la méthanisation est systématiquement pénalisée sur le critère qui pèse 11 % de sa
note. La couche « réseau gaz » de la carte, elle, n'affiche jamais aucune canalisation, sans le dire.

**Gravité.** Critique. Aucune décision de prospection méthanisation ne peut s'appuyer sur cette
filière en l'état. Le choix honnête, à court terme, est de la retirer de l'interface ou de l'afficher
comme non opérationnelle.

---

## C. Défauts importants

### C1. Part de la pondération non fiable, par filière

Même exercice que B6, étendu aux quatre filières. Un critère est compté « non fiable » s'il est
gris en permanence, faux par affirmation, doublon d'un autre, ou hors échelle.

| Filière | Non fiable | Détail |
|---|---|---|
| `methanisation` | **45,9 %** | voir B6 |
| `eolien_terrestre` | **24,1 %** | `risq_aero_radar` 7,0 % (gris) + `env_especes_protegees` 7,0 % (doublon, C2) + `fonc_nb_proprietaires` 3,1 % + `urb_zaer` 3,1 % + `pat_sites` 2,3 % + `env_tvb` 1,6 % |
| `solaire_sol` | **17,4 %** | `fonc_nb_proprietaires` 3,05 % + `urb_zaer` 3,05 % + `sol_potentiel_agronomique` 3,05 % (C3) + `env_especes_protegees` 2,3 % + `risq_inondation` 2,29 % + `pat_sites` 1,53 % + `env_tvb` 1,53 % + `pat_archeologie` 0,76 % |
| `bess` | **8,0 %** | `risq_inondation` 4,03 % + `fonc_nb_proprietaires` 2,42 % + `urb_zaer` 1,6 % |

Le cas `urb_zaer` mérite un mot. Les zones d'accélération des ENR sont **l'argument réglementaire le
plus utile de la prospection depuis la loi APER**. Le connecteur est écrit, correct, et retourne
`present: null` — parce qu'aucun job n'ingère de ZAER, et parce que `couverture_ingestion` ne
contient jamais de ligne `zaer` (voir C4). Les tables `zaer` et `document_cadre_pv` ne sont peuplées
que par `scripts/seeder.ts`, avec `est_demonstration = true`, valeur que les requêtes écartent
explicitement. Le critère est donc gris pour toujours, sans être déclaré `sansSource` — il pénalise
donc la couverture affichée.

### C2. `env_especes_protegees` recompte des critères déjà comptés

`nature.ts:149` : `milieux.preEnjeuEspeces = preEnjeuDerive(milieux)`. `preEnjeuDerive` agrège la
proximité de Natura 2000 habitats, Natura 2000 oiseaux, ZNIEFF 1, réserve naturelle et cœur de parc
national.

Or `env_proximite_natura2000` note déjà les deux Natura 2000 (3,8 % solaire, 4,7 % éolien) et
`env_znieff` note déjà les ZNIEFF (2,3 %). `env_especes_protegees` est donc, pour l'essentiel, une
**seconde lecture des mêmes couches sous un autre nom** : 2,3 % (solaire) et **7,0 % (éolien)** de
pondération en double comptage.

Le fichier montre que ce raisonnement a déjà été mené : le commentaire lignes 151-158 explique que
`sensibiliteAvifaune` et `sensibiliteChiropteres` valaient une *copie* de `preEnjeuEspeces`, que
cela faisait trois critères d'apparence indépendante portant le même nombre, et qu'ils ont donc été
mis à `null`. **La correction s'est arrêtée un cran trop tôt** : elle a supprimé les copies, pas
l'original, qui est lui-même une dérivation. Le nom du critère aggrave le problème : « espèces
protégées » suggère un inventaire faune-flore, alors qu'aucune donnée d'espèce n'est lue.

### C3. Le « potentiel agronomique » est une constante par groupe de culture

`rpg.ts:220` : `occupation.potentielAgronomique = POTENTIEL_AGRONOMIQUE[groupe] ?? null`. C'est une
table nationale figée, indexée sur le **groupe de culture déclaré au RPG**.

Un groupe de culture est une déclaration administrative de l'exploitant pour une campagne. Le
potentiel agronomique d'un sol dépend de sa texture, de sa profondeur, de sa réserve utile et de son
hydromorphologie. Deux parcelles voisines déclarées « prairies permanentes », l'une sur limon
profond et l'autre sur dalle calcaire, reçoivent la même note. Poids 3,05 % du solaire — c'est-à-dire
autant que le nombre de propriétaires, et pour une raison analogue : une valeur plausible sans
mesure derrière.

### C4. `couverture_ingestion` : un seul connecteur sur quinze l'alimente

C'est le mécanisme central annoncé par l'application pour distinguer « aucune contrainte » de
« département non ingéré ». Le commentaire SQL de la table le dit explicitement, et trois modules le
répètent en tête de fichier.

`enregistrerCouverture()` est appelée depuis **un seul endroit** : `ingestion/index.ts:376`, avec
`connecteur = 'patrimoine_culture'` et `type = 'monument_historique'`.

Conséquences directes :

- `zaer()` teste `couverture_ingestion WHERE type = 'zaer'` : toujours zéro, donc
  `departementIngere` toujours faux (voir C1).
- `patrimoine()` teste `WHERE connecteur = 'patrimoine_culture'` **sans filtre de département**,
  alors que la table est justement clé-primairée par département. Une base ingérée pour le seul
  département 45 conclut donc, sur une parcelle du 06, à une absence constatée de monument. Le
  garde-fou existe, la requête ne l'utilise pas.
- Les treize autres connecteurs adossés à la base n'ont aucune trace de couverture.

### C5. `patrimoine()` tronque à 200 objets, pour quatre types confondus

`locales.ts:235` : `ORDER BY distance_m LIMIT 200`, sur une requête qui couvre les quatre types
patrimoniaux dans un rayon de 10 km. Les 200 lignes sont ensuite réparties par `filter`.

Si 200 monuments historiques se trouvent dans les 10 km — ce qui est le cas autour de Nice, Bordeaux,
Lyon ou Paris, où la densité dépasse 30 monuments au km² contre 0,08 en moyenne nationale —
**les trois autres types reçoivent zéro ligne** et sont déclarés absents alors qu'ils ont seulement
été tronqués. C'est le même défaut que la troncature WFS corrigée à l'audit 5, réintroduit ici par
un `LIMIT` partagé entre types. L'application vise des terrains ruraux, ce qui limite l'exposition,
mais les couronnes périurbaines sont précisément un gisement de friches recherché.

### C6. `avisAbfRequis` s'annule si aucun monument n'est trouvé

`locales.ts:274` :

```ts
avisAbfRequis:
  distanceMhM == null ? null
    : distanceMhM <= 500 || siteInscrit.some(s => s.contient) || spr.some(s => s.contient),
```

Le court-circuit sur `distanceMhM == null` s'exécute **avant** l'examen du site inscrit et du SPR.
Une parcelle située à l'intérieur d'un site inscrit ou d'un SPR, sans monument historique dans les
10 km, obtient `avisAbfRequis: null` au lieu de `true`. L'avis de l'ABF est requis par le site
inscrit seul (article L. 341-1) : la condition n'a pas besoin d'un monument.

Défaut latent aujourd'hui — B1 fait que les sites ne sont jamais peuplés — mais il se réveillerait
dès l'ingestion des sites, c'est-à-dire au moment même où on croirait avoir corrigé B1.

### C7. Une valeur de `limite` non numérique produit une erreur 500

Cinq routes convertissent un paramètre de requête sans le valider :

| Emplacement | Paramètre |
|---|---|
| `carte.ts:236` | `limite` de `/api/carte/parcelles` |
| `carte.ts:235` | `surfaceMin` de `/api/carte/parcelles` |
| `carte.ts:330` | `rayonKm` de `/api/carte/postes-sources` |
| `carte.ts:426` | `limite` de `/api/carte/couche/:type` |
| `divers.ts:411` | `limite` de `/api/admin/journal` |
| `prospection.ts:29` | `limite` de `/api/leads` |

`Math.min(Number('abc'), 5000)` vaut `NaN`, qui part tel quel en paramètre SQL. Vérifié contre le
serveur PostgreSQL réel :

```
valeur NaN       -> ERREUR invalid input syntax for type bigint: "NaN"
valeur Infinity  -> ERREUR invalid input syntax for type bigint: "Infinity"
valeur -5        -> ERREUR LIMIT must not be negative
```

L'erreur pg ne porte pas de `statusCode`, donc `serveur.ts:172` renvoie **500 `erreur_interne`** là
où 400 est la réponse juste. Aucune injection possible — les requêtes sont paramétrées — mais un
paramètre malformé ne doit pas produire une erreur serveur.

### C8. `validation.ts` a été écrit pour les routes et n'y est pas utilisé

Le module `validation.ts` fournit `ErreurValidation` et un lecteur `Lecteur` de 140 lignes, conçu
pour valider les corps de requête. Mesuré :

- routes déclarant un `schema:` Fastify : **0 sur 44** ;
- routes appelant `lecteur(` : **0 sur 44** ;
- appels de `lecteur(` dans toute l'application : **1**, dans `services/recherche.ts`.

Les 21 routes mutantes (POST, PUT, DELETE) lisent donc `req.body as { … }` — une assertion de type
qui ne vérifie rien à l'exécution. `/api/exports/csv` fait exception en passant par
`filtresValides`, et c'est justement la seule route d'export correctement bornée.

### C9. Deux routes d'export acceptent une liste d'identifiants sans plafond, avec une requête par élément

`/api/exports/geojson` et `/api/exports/shapefile` valident `Array.isArray(corps.idus)` et la
longueur non nulle — rien d'autre. Aucun plafond, alors que `/api/exports/csv` en a un
(`LIMITE_MAX_EXPORT`). Puis `chargerPourExport` :

```ts
const parcelles = await depotParcelles.parcellesParIdus(idus.map(i => i.toUpperCase()));
for (const parcelle of parcelles) {
  const score = await depotScores.scoreParcelle(parcelle.idu, filiere);  // une requête par parcelle
}
```

Trois défauts en cinq lignes : pas de plafond ; une requête SQL séquentielle par parcelle (N+1) ;
`i.toUpperCase()` sur un élément non-chaîne lève un `TypeError` non intercepté, donc un 500. La
limitation de débit (30 requêtes par 10 minutes) ne borne pas la taille d'une requête.

### C10. 7 routes sur 44 sont citées dans un test

Mesuré en confrontant les chaînes de route à l'ensemble des fichiers de test. Sont citées :
`/api/auth/connexion`, `/api/sante`, `/api/leads`, `/api/sites`, `/api/qualification/emprise`,
`/api/admin/rescorer`, et les tuiles. Et « citée » est généreux : citer n'est pas exercer.

Non couvertes, notamment : **`/api/parcelles/:idu/proprietaire`** (la route RGPD, dont toute la
valeur est dans ses trois refus), `/api/admin/purge-rgpd`, `/api/admin/utilisateurs`, et **les quatre
routes d'export** — c'est-à-dire les livrables transmis à des tiers.

L'infrastructure existe pourtant : `acces-roles.test.ts` construit un vrai serveur avec
`construireServeur` et l'interroge par `app.inject`. Écrire ces tests coûte peu ; ils n'ont pas été
écrits.

---

## D. Défauts secondaires

### D1. `couchesIntrantsIngerees()` : un test d'existence pour trois couches

`gisement.ts:95` : `SELECT EXISTS (SELECT 1 FROM contrainte WHERE type = ANY($1))` sur les trois
types `elevage`, `industrie_agroalimentaire`, `surface_agricole_commune`. Une seule réponse pour
trois couches indépendantes.

Si un jour une seule des trois est ingérée, la fonction retourne `true` et le code affirme alors
`iaaRayon20km: 0` et `surfacesEpandageHa: 0` comme des **absences réelles sur le territoire**, avec
`sourcesIntrantsIngerees: true` — en contradiction directe avec le commentaire situé deux lignes plus
haut, qui dit que c'est exactement ce qu'il ne faut pas faire. Sans effet aujourd'hui (aucune des
trois n'est ingérée, voir B6), mais le défaut se déclenchera au premier pas de la correction de B6.

Second point sur la même fonction : `surfacesEpandageHa: surfaces == null ? 0 : Math.round(surfaces)`
transforme un `SUM` SQL nul en zéro affirmé.

### D2. Le raster de vent ne redevient jamais lisible sans redémarrage

`vent.ts:42` : `chargementEchoue` passe à `true` au premier constat d'absence du fichier, et rien ne
le remet à `false` dans le processus serveur. `telechargerRaster()` le réinitialise, mais elle
s'exécute dans le processus d'ingestion, pas dans le serveur.

Séquence réelle : le serveur démarre avant l'ingestion du raster → premier appel à `ventA100m` →
`chargementEchoue = true` → l'ingestion télécharge les 55 Mo → **le serveur continue de retourner
`null` indéfiniment**. `gis_vent` pèse 10,9 % de la note éolienne. La séquence n'a rien
d'exceptionnel : c'est l'ordre naturel d'une première installation.

### D3. Aucune vérification du système de coordonnées du raster de vent

`ventA100m` calcule `Math.floor((pt[0] - origine[0]) / resolution[0])` en supposant que le GeoTIFF
est en degrés WGS 84. Rien ne le vérifie : ni `image.getGeoKeys()`, ni un contrôle de vraisemblance
sur l'origine. Si le Global Wind Atlas republie son raster France en projection métrique — ce qui est
courant et hors de notre contrôle —, l'indice de pixel sort de l'emprise et la fonction retourne
`null` en silence, ou pire, désigne un pixel valide mais faux. Le contrôle de téléchargement porte
sur la taille du fichier (« au moins 1 Mo »), pas sur sa géoréférence.

### D4. La fixture PVGIS a été capturée sans les paramètres que le code envoie

`solaire()` envoie `optimalangles: 1`. Ma fixture de contrat a été enregistrée **sans** ce paramètre.
Comparaison des deux réponses réelles :

| Champ | Avec `optimalangles=1` | Sans | Écart |
|---|---|---|---|
| `H(i)_y` (kWh/m²/an) | 1 474,6 | 1 261,1 | +16,9 % |
| `E_y` (kWh/kWc/an) | 1 183,95 | 994,84 | +19,0 % |

Les **noms** de champs sont identiques dans les deux cas (`E_d, E_m, E_y, H(i)_d, H(i)_m, H(i)_y,
SD_m, SD_y, l_aoi, l_spec, l_tg, l_total`), donc le test de contrat n'est pas invalidé : ce qu'il
vérifie est exact. Mais une fixture qui n'utilise pas les paramètres de production ne prouve rien
au-delà du nommage — elle ne verrait pas, par exemple, un champ qui n'apparaît que sous certains
paramètres. C'est un défaut de **mon propre dispositif de contrôle**, pas du code applicatif, et il
appelle une règle : une fixture de contrat se capture avec la requête exacte que la production émet.

### D5. `documentCadrePv` confond « non ingéré » et « pas de document-cadre »

`departementCouvert: boolean` — pas de troisième état. `locales.ts:202` retourne `false` quand aucune
ligne n'existe, et `FicheParcelle.tsx:728` l'affiche « département non ingéré ».

Or seuls une trentaine de départements ont réellement arrêté un document-cadre photovoltaïque. Pour
les autres, l'absence de ligne est un **fait vrai** affiché comme un manque de données, et
réciproquement un département ingéré sans document afficherait la même chose. Le knock-out
`koDocumentCadre` traite correctement le cas (`if (!dc.departementCouvert) return null`), donc le
score est juste ; c'est l'affichage qui dit une chose fausse dans la moitié des cas.

### D6. `/api/carte/couche/:type` n'a pas de liste fermée

Le type demandé part en paramètre SQL — pas d'injection — mais aucune liste blanche ne limite les
types exposés. Aujourd'hui la table `contrainte` ne contient que des monuments historiques, donc rien
ne fuit. Le jour où elle portera une couche sensible, cette route la servira sans habilitation. Les
trois relais externes ont tous une liste fermée ; cette route interne, non.

### D7. `/api/exports/geojson` ne renvoie pas 404 sur une sélection vide

`shapefile` le fait, `geojson` non : il renvoie une `FeatureCollection` vide avec un `Content-Disposition`
de téléchargement. L'utilisateur reçoit un fichier qui s'ouvre sur rien, sans message.

### D8. Le ratio de test de l'interface reste à 0,10

| Espace | Source | Test | Ratio |
|---|---|---|---|
| `packages/core` | 2 154 | 763 | 0,35 |
| `packages/scoring` | 3 307 | 980 | 0,30 |
| `apps/api` | 13 883 | 3 730 | 0,27 |
| `apps/web` | 6 185 | 614 | **0,10** |

Progrès réel depuis 0,03 (audits 5-7), grâce à `geometrie.test.ts`, `etat.test.ts` et
`accessibilite.test.ts`. Mais les 614 lignes couvrent la géométrie, le formatage et l'état ; aucun
composant n'est monté, aucune interaction testée. `FicheParcelle.tsx` — le composant qui décide de ce
que le prospecteur lit — n'a aucun test.

---

## E. Erreurs métier

**E1. Un site classé ne bloque pas un parc éolien** (B1). L'article L. 341-10 exige une autorisation
ministérielle spéciale. Le knock-out est écrit et inatteignable.

**E2. Un avis d'ABF requis par un site inscrit seul n'est pas signalé** (C6). L'article L. 341-1
n'exige aucun monument à proximité.

**E3. « Aléa inondation nul » sur une commune couverte par un PPRI** (B3, B5). Sur les 30 % de
communes à PPRN non classable, et sur tout échec de l'appel `gaspar/pprn`.

**E4. « Aléa moyen » sur toutes les parcelles d'une commune à PPRI** (B4). Un plan communal n'est pas
un zonage parcellaire ; 85 % des communes sont concernées.

**E5. La distance au réseau gaz est la distance à un site d'injection** (B6). Deux ordres de grandeur
d'écart. Pénalise systématiquement la méthanisation sur 11 % de sa note.

**E6. Le potentiel agronomique est déduit d'une déclaration PAC** (C3). Le groupe de culture déclaré
n'est pas la qualité du sol.

**E7. Un propriétaire unique est affirmé partout** (B2). La maîtrise foncière est le premier facteur
de mortalité d'un projet ; le critère rassure sans information.

**E8. Les ZAER, argument réglementaire majeur depuis la loi APER, sont grises en permanence** (C1).
Le connecteur est correct ; il n'y a pas de job d'ingestion.

**E9. L'enjeu « espèces protégées » ne lit aucune donnée d'espèce** (C2). C'est une dérivation de la
proximité des zonages, déjà notée ailleurs — double comptage de 7 % sur l'éolien.

---

## F. Risques d'exploitation

**F1. Un livrable peut se contredire.** Un PDF portant un feu vert « aléa nul » et une note de bas de
page « source Géorisques en échec, critères non évalués » est un document indéfendable devant un
propriétaire ou un service instructeur (B3).

**F2. La couverture de données affichée est surévaluée.** `pat_sites` compte comme couvert alors
qu'aucune donnée n'existe ; `urb_zaer`, `pat_archeologie`, `risq_karst`, `risq_aero_radar` sont gris
sans être déclarés `sansSource`, ce qui déforme l'indicateur dans les deux sens.

**F3. Une première installation laisse l'éolien sans gisement de vent** (D2), silencieusement,
jusqu'au premier redémarrage.

**F4. Le raster de vent dépend de la stabilité d'un format tiers non vérifié** (D3).

**F5. Deux routes d'export sont un vecteur d'épuisement mémoire** (C9). Non authentifié n'est pas en
cause — la route l'est —, mais un compte légitime peut saturer le serveur par accident.

**F6. 37 routes sur 44 peuvent régresser sans qu'aucun test ne le voie** (C10), dont la route RGPD
et les quatre exports.

**F7. Les invariants de sécurité, revérifiés, tiennent.** `AUTH_DESACTIVEE` refusée en production,
`SECRET_JWT` obligatoire hors développement, `.env` hors dépôt, tuiles parcellaires authentifiées et
non mises en cache partagé, trois relais à liste fermée, avertissements du §12 en place. Aucun défaut
de sécurité nouveau trouvé dans cet audit.

---

## G. Améliorations, par priorité

### Priorité 1 — l'application affirme des faits qu'elle ne connaît pas

| # | Action | Problème | Difficulté |
|---|---|---|---|
| 1 | Rendre `patrimoine()` honnête sur les couches absentes : `site_classe`, `site_inscrit`, `spr` → `recouvre: null`, `partRecouvrement: null` tant qu'aucune ingestion ne les alimente ; `noteProximiteZonage` doit rendre `null`, donc gris, et non 90 | B1 | Faible |
| 2 | Déclarer `pat_sites` `sansSource` (statut plafonné à orange, exclu de la pénalité de couverture) jusqu'à l'ingestion réelle | B1 | Faible |
| 3 | Écrire un test nommé qui échoue si `ko_eol_site_classe` reste inatteignable — un knock-out qui ne peut pas se déclencher est une régression en soi | B1, E1 | Faible |
| 4 | Remplacer `nbProprietairesEstime: 1` par `null`, ou implémenter l'algorithme que le commentaire décrit — mais pas garder les deux | B2, E7 | Faible |
| 5 | Découpler les trois conditions du `null` de `alea` : chaque source manquante rend son propre verdict inconnu, jamais `'nul'` | B3, E3 | Faible |
| 6 | Faire de `alea` un `null` quand un PPRI existe sur la commune sans information parcellaire ; ne jamais dériver un aléa parcellaire d'un fait communal | B4, E4 | Faible |
| 7 | Rendre `null` (et non `false`) les familles naturelles quand un PPRN existe mais n'est pas classable ; ajouter les libellés déterminés (`MT`, `Pi`, `PPRNPi`) ; « multi » sans jetons → indéterminé | B5 | Moyenne |
| 8 | Transmettre `connecteursEnEchec` au moteur de scoring et forcer au gris tout critère dont la source a échoué — c'est la garde générique qui rend impossible toute la classe B3 | B3, F1 | Moyenne |

### Priorité 2 — la filière méthanisation et les couches manquantes

| # | Action | Problème | Difficulté |
|---|---|---|---|
| 9 | Décider et assumer le sort de la méthanisation : soit ingérer les couches (élevages et IAA depuis l'inventaire ICPE, surfaces agricoles depuis le RPG agrégé, canalisations depuis les tracés GRTgaz/GRDF ouverts), soit marquer la filière non opérationnelle dans l'interface | B6 | Élevée |
| 10 | Corriger `racc_distance_reseau_gaz` : la distance doit être celle d'une canalisation, jamais celle d'un site d'injection ; à défaut de canalisations ingérées, le critère doit être gris | B6, E5 | Moyenne |
| 11 | Écrire un job d'ingestion des ZAER (les délibérations sont publiées par les préfectures et agrégées par département) ; à défaut, déclarer `urb_zaer` `sansSource` | C1, E8 | Élevée |
| 12 | Ingérer les sites classés, inscrits et SPR (Atlas des patrimoines / INPN), ce qui referme B1 par la donnée et non par le gris | B1 | Élevée |
| 13 | Supprimer `env_especes_protegees` ou le rebaser sur une vraie donnée d'espèce ; en attendant, ne pas facturer 7 % de l'éolien à une dérivation de critères déjà comptés | C2, E9 | Moyenne |
| 14 | Retirer `sol_potentiel_agronomique` de la pondération, ou le renommer en ce qu'il est (« groupe de culture déclaré ») et le repondérer en conséquence | C3, E6 | Faible |

### Priorité 3 — les gardes structurelles qui empêchent la classe entière

| # | Action | Problème | Difficulté |
|---|---|---|---|
| 15 | Appeler `enregistrerCouverture()` depuis **tous** les connecteurs adossés à la base, et filtrer par département dans `patrimoine()` comme le fait déjà `zaer()` | C4 | Moyenne |
| 16 | Séparer le test d'existence par couche dans `couchesIntrantsIngerees()` : un booléen par type, jamais un `ANY` global ; et `surfacesEpandageHa` à `null`, pas à 0 | D1 | Faible |
| 17 | Une requête `LIMIT` par type patrimonial, ou un `LIMIT` par type via `ROW_NUMBER() OVER (PARTITION BY type)`, et remonter la troncature comme le fait déjà `reponseTronquee` pour le WFS | C5 | Faible |
| 18 | Réordonner `avisAbfRequis` : examiner site inscrit et SPR avant tout court-circuit sur l'absence de monument | C6, E2 | Faible |
| 19 | Réinitialiser `chargementEchoue` sur un intervalle, ou tester l'existence du fichier à chaque appel (un `existsSync` coûte moins qu'une lecture de tuile) | D2 | Faible |
| 20 | Vérifier les clés géographiques du raster à l'ouverture, et refuser un raster dont l'origine n'est pas plausible en degrés | D3 | Faible |
| 21 | **Étendre le contrôle des champs orphelins à l'alimentation, pas seulement à la citation** : pour chaque feuille du snapshot, exiger qu'un chemin de production puisse lui donner une valeur non nulle, sinon la déclarer explicitement sans source. C'est le contrôle qui aurait trouvé B1, B2 et B6 sans cet audit | B1, B2, B6 | Moyenne |
| 22 | Capturer les fixtures de contrat avec la requête exacte émise en production, et vérifier dans le test que l'URL de la fixture correspond aux paramètres du code | D4 | Faible |

### Priorité 4 — API, validation, tests

| # | Action | Problème | Difficulté |
|---|---|---|---|
| 23 | Valider tous les paramètres numériques de requête : entier fini, borné, positif → 400 et non 500 | C7 | Faible |
| 24 | Faire passer les 21 routes mutantes par `Lecteur`, ou déclarer un `schema:` Fastify sur chacune — le module de validation existe déjà et ne sert qu'une fois | C8 | Moyenne |
| 25 | Plafonner `idus` sur les exports GeoJSON et Shapefile au même seuil que le CSV ; vérifier le type de chaque élément ; remplacer la boucle N+1 par une requête unique | C9 | Faible |
| 26 | Couvrir par `app.inject` les routes non testées, en commençant par `/api/parcelles/:idu/proprietaire` (les trois refus), `/api/admin/purge-rgpd` et les quatre exports | C10, F6 | Moyenne |
| 27 | Fermer la liste des types de `/api/carte/couche/:type` | D6 | Faible |
| 28 | Aligner `geojson` sur `shapefile` : 404 sur sélection vide | D7 | Faible |
| 29 | Donner un troisième état à `documentCadrePvSol` (`null` = non ingéré, `false` = pas de document-cadre) et corriger l'affichage | D5 | Faible |
| 30 | Monter `FicheParcelle` dans un test et vérifier que chaque état (gris, orange, vert, knock-out dérogeable) rend le texte attendu | D8 | Moyenne |

### Priorité 5 — ce qui ne dépend pas du code

| # | Action | Pourquoi |
|---|---|---|
| 31 | Campagne de validation par un expert foncier ENR sur 50 parcelles réelles (`scripts/campagne-validation.mjs` est prêt) | Aucune calibration de pondération n'a été confrontée à un jugement métier |
| 32 | Devis réels de raccordement pour recalibrer les paliers de distance au poste | Les paliers sont raisonnés, pas mesurés |
| 33 | Relecture juridique du référentiel réglementaire et des avertissements du §12 | Des documents sont transmis à des tiers |
| 34 | Test d'usage sur poste de prospecteur, sur territoire réel | Aucun test utilisateur n'a eu lieu |

---

## Score

Notation sévère, sur six critères. Rappel de l'audit 7 pour situer l'évolution.

| Critère | Audit 7 | Audit 8 | Justification |
|---|---|---|---|
| Fiabilité des résultats | 62 | **48** | En baisse, et c'est le constat central. Les défauts de calcul de l'audit 7 sont corrigés ; ce que cet audit révèle est plus grave et n'était pas compté : de 8 % (bess) à 46 % (méthanisation) de la pondération repose sur une donnée absente, une constante codée en dur, un doublon ou une grandeur hors échelle. Deux critères affichent un feu vert et une phrase affirmative sur zéro donnée. Un knock-out réglementaire est inatteignable. |
| Qualité technique | 76 | **74** | Le typage strict, les 28 fichiers de test, la vérification par mutation, la CI à sept étapes et le contrôle de contrat sur 29 endpoints sont solides. En léger retrait parce que trois défauts découverts ici sont des défauts d'ingénierie élémentaires : un commentaire décrivant du code inexistant, un module de validation écrit et non branché, un `&&` là où il fallait un `\|\|`. |
| Qualité métier | 55 | **44** | Le raisonnement métier est juste là où il est écrit — la nuance sur les PPR, les régimes d'implantation, la sinuosité de raccordement, le refus d'inventer un indice de covisibilité. Mais sept erreurs métier subsistent (E1 à E9), dont trois portent sur des faits juridiques affirmés à tort, et une filière entière n'est pas exploitable. |
| Ergonomie | 70 | **70** | Inchangé. L'interface est cohérente, le vocabulaire français juste, la distinction gris/orange/vert lisible, les avertissements présents. Elle affiche fidèlement ce qu'on lui donne — y compris les affirmations fausses, ce qui n'est pas son défaut. Ratio de test 0,10 : en progrès, encore bas. |
| Robustesse | 66 | **62** | Migrations vérifiées en CI avec porte de sortie, écriture atomique du raster, limitation de débit, journalisation, gestion des échecs de source. En retrait : cinq paramètres produisent un 500, deux exports sont sans plafond avec une boucle N+1, le raster de vent ne se recharge jamais, et 37 routes sur 44 peuvent régresser sans qu'un test le voie. |
| Professionnalisation | 72 | **74** | 7 106 lignes de documentation à jour, huit audits archivés, CHANGELOG, contrats d'API documentés, procédures d'installation, sauvegarde et rafraîchissement, veille automatique des champs de source. En hausse : la documentation dit maintenant ce qui n'est pas couvert. |

### Score global : **56 / 100** (audit 7 : 67)

**Le score baisse, et il faut lire pourquoi.** Aucune régression n'a été introduite : le code est
meilleur qu'à l'audit 7, toutes les corrections tiennent, aucun défaut de sécurité nouveau. Ce qui a
changé, c'est la **question posée**. Les sept audits précédents vérifiaient si les calculs étaient
justes sur les données reçues. Celui-ci a vérifié s'il existait des données à recevoir. La réponse
révèle des défauts qui étaient là depuis le premier jour, invisibles à toute relecture de code et à
tout test écrit d'après le code — parce que le code, sur ces points, est correct : il lit
proprement une table que rien ne remplit.

Le score de 67 de l'audit 7 était donc **surévalué**, non par complaisance mais par angle mort. 56
est la note de la même application mesurée sur un périmètre honnête.

---

## Réponse à la question permanente

> *« Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un cadre
> professionnel sans risque majeur d'erreur ? »*

**Non — et pour la première fois depuis l'audit 5, la raison n'est plus un défaut de calcul mais un
défaut de données présenté comme un fait.**

Il y a une différence de nature entre les défauts des audits précédents et ceux-ci. Un critère gris
protège son lecteur : il dit « je ne sais pas ». Un critère faux mais plausible peut être rattrapé
par un prospecteur expérimenté qui trouve le résultat étrange. Mais **un critère vert accompagné
d'une phrase affirmative sur une donnée inexistante ne peut pas être rattrapé** : « Aucun site classé
ni inscrit dans le rayon d'analyse » et « 1 propriétaire estimé » sont des affirmations qu'aucun
lecteur ne peut mettre en doute, parce qu'elles sont formulées comme des constats de recherche.

Ce qui est utilisable aujourd'hui, en le sachant :

- Le **cadastre**, le **RPG**, le **GPU**, les **zonages naturels**, les **postes sources**, le
  **gisement solaire** et les **risques d'origine Géorisques** sont mesurés sur données réelles et
  vérifiés par contrat sur 29 endpoints. C'est le socle, et il est bon.
- La **filière bess** est la moins atteinte (8 % de pondération non fiable).
- Le **dispositif RGPD** est exemplaire et peut être présenté à un DPO.
- Les **avertissements du §12** doivent rester affichés : ils sont aujourd'hui la seule protection du
  lecteur contre B1 et B2.

Ce qui ne doit pas être utilisé pour décider :

- La **méthanisation**, entièrement (46 % de pondération non fiable).
- Les critères **patrimoine sites**, **nombre de propriétaires**, **ZAER**, **espèces protégées**,
  **potentiel agronomique**, et **inondation** hors zonage TRI.
- Tout **PDF ou export** portant un critère vert alors que la page mentionne un connecteur en échec.

**Ce que cet audit apporte de plus que les précédents.** Les huit défauts de priorité 1 sont tous
d'une seule et même famille — *affirmer en l'absence de donnée* — et l'item 21 est la garde qui rend
cette famille impossible : exiger, pour chaque champ du snapshot, qu'un chemin de production sache
lui donner une valeur, sinon le déclarer sans source. C'est mécanique, c'est vérifiable en CI, et
c'est ce qui manquait aux sept contrôles précédents. Une fois ce contrôle en place et les
priorités 1 à 3 traitées, l'application n'aura plus de défaut de cette classe à découvrir — ce qui
est précisément l'objet du chantier final.

**Périmètre de cet audit, pour qu'il soit clos.** Toutes les zones du dépôt ont été examinées :
`packages/core`, `packages/scoring`, les 14 connecteurs, l'ingestion, les dépôts, les services, les
44 routes, les 12 migrations, l'interface, les exports, la CI et les scripts. Les quatre zones qui
n'avaient jamais été auditées l'ont été et ont produit tous les défauts majeurs ci-dessus. Aucun
angle n'est laissé de côté volontairement. Les seules limites connues et assumées de cet audit sont
les items de priorité 5, qui ne dépendent pas du code : ils exigent un expert métier, des devis
réels, une relecture juridique et des utilisateurs.

---

# Suites données à l'audit 8 — 6 août 2026

Les priorités 1 à 4 ont été traitées. Cette section n'est pas un résumé : elle enregistre **ce qui a
été fait, ce qui a été trouvé en le faisant, et ce qui reste ouvert**. Trois défauts nouveaux sont
apparus pendant les corrections, dont deux dans mes propres dispositifs de contrôle.

## Priorité 1 — les huit affirmations sans donnée

Toutes corrigées, chacune vérifiée par exécution **puis** par mutation. Le fichier
`apps/api/test/audit8-affirmations.test.ts` (20 cas) verrouille l'ensemble, et
`scripts/mutation.mjs` passe de 7 à 14 mutations, **14/14 rattrapées**.

| # | État | Vérification |
|---|---|---|
| 1-2 | **corrigé** | `pat_sites` passe de `90 / vert / « Aucun site classé ni inscrit »` à `null / gris / « non évalué - aucune source ingérée »`. Le cas légitime — couche ingérée, rien dans le rayon — vaut toujours 90 : les deux tests sont symétriques. |
| 3 | **corrigé** | Test nommé qui échoue si `ko_eol_site_classe` redevient inatteignable. |
| 4 | **corrigé** | `nbProprietairesEstime` passe de `1` en dur à `null`, critère `sansSource`. Un test appelle le **connecteur**, pas seulement le moteur : griser le critère sans corriger la source aurait laissé le `1` dans les exports, qui lisent le snapshot. |
| 5-6 | **corrigé** | `aleaInondation()` extraite et testée par énumération des combinaisons. Un échec de `gaspar/pprn` ne peut plus produire « aléa nul ». |
| 7 | **corrigé** | `presenceFamille()` extraite. La provenance décide : un plan illisible de `gaspar/pprn` rend les familles naturelles **incertaines**, `gaspar/pprt` n'est pas concerné. Sigles ajoutés : `MT`, `Pi`, `PPRNPi`. |
| 8 | **corrigé** | `connecteursEnEchec` atteint le moteur. Garde générique : tout critère dont la source a échoué passe au gris, quelle que soit la valeur restée dans le snapshot. Câblée aux six points d'appel du scoring, y compris le rescoring hors ligne et le score consolidé de site — où les échecs sont suivis **par parcelle**, une liste unique pour le site grisant à tort des critères réellement mesurés. |

## Priorité 2 — la donnée manquante existe réellement

**Le correctif de priorité 1 rendait ces couches grises, ce qui était honnête. Deux sources
nationales existent, et elles sont maintenant ingérées.** Le catalogue des sources annonçait
« aucune API nationale consolidée » pour les ZAER : c'était faux, et cette croyance a laissé le
critère gris depuis l'origine.

- **`zaer:zaer`** sur le WFS de la Géoplateforme — 1 089 671 zones, avec filière, détail de filière,
  commune, productible et puissance.
- **couches `STE`** — 7 753 sites en métropole, plus trois couches d'outre-mer. **6 617 sites classés
  et inscrits déjà chargés** (2 612 classés, 4 005 inscrits).

Les deux vocabulaires ont été **mesurés sur les données réelles avant d'écrire une ligne de
correspondance**, et chacun cachait un piège de la même famille que le défaut `libPpr` de l'audit 7 :

1. **68 % des ZAER photovoltaïques portent sur des TOITURES** (`detail_filiere1 = TOIT`, 293 sur 430
   échantillonnées). Traduire `SOLAIRE_PV` en `solaire_sol` sans lire le détail aurait fait dire à
   l'application « cette parcelle est en zone d'accélération pour le solaire au sol » à propos de la
   toiture d'une maison de quartier.
2. **« Grand Site de France » et « Patrimoine mondial » sont des LABELS**, non des sites protégés au
   sens des articles L. 341-1 et L. 341-10. Les ranger en `site_classe` aurait déclenché un knock-out
   éolien **non dérogeable à tort** — l'erreur symétrique de celle corrigée, et aussi grave.

Une valeur non reconnue n'est jamais rangée par défaut : elle est journalisée et l'objet n'est pas
ingéré. Mieux vaut une zone ignorée qu'une zone mal classée.

**Deux défauts trouvés par l'exécution réelle de l'ingestion**, invisibles à toute relecture :

- **`idsup` n'est pas unique.** Un site est découpé en autant de lignes que de parties : 24 pour le
  site d'Alésia, 16 pour le Val Suzon. PostgreSQL a refusé net (`ON CONFLICT DO UPDATE command cannot
  affect row a second time`). Le réflexe — dédupliquer sur la clé — aurait **perdu 23 géométries sur
  24 en silence**, exactement la classe de défaut que cette ingestion corrige. Les parties sont donc
  **réunies** (`ST_Collect` dans le lot, `ST_Union` sur conflit), opération associative et idempotente.
- **Le département n'est pas lisible dans `idsup`.** `AC2-130010002-447` : `130010002` est un
  identifiant *national* de servitude, et ses deux premiers caractères valent `13` pour tout le pays.
  Les 6 617 sites se sont retrouvés dans les Bouches-du-Rhône, ce qui **annulait tout l'intérêt de la
  correction** — `patrimoine()` filtre la couverture par département, donc 95 départements auraient
  continué d'afficher un critère gris. Le rattachement se fait désormais par jointure spatiale sur
  `commune`, et l'ingestion **dit** quand la table des communes est vide plutôt que de laisser croire
  à une ingestion complète.

Autres items de priorité 2 :

| # | État |
|---|---|
| 10 | **corrigé** — `reseauGaz` expose `distanceCanalisationKm` et `distanceSiteInjectionKm`, deux grandeurs qui n'ont plus le même nom. Le changement de type a fait remonter les cinq consommateurs (moteur, seuils de procédure, PDF, fiche), tous corrigés. Le critère est gris tant que les canalisations ne sont pas ingérées. |
| 13 | **corrigé** — `preEnjeuEspeces` passe à `null` et `preEnjeuDerive()` est supprimée. Le double comptage de 7 % sur l'éolien disparaît. |
| 14 | **corrigé** — le critère s'intitule désormais « Potentiel agronomique (d'après la culture déclarée) » et son commentaire dit que c'est un proxy du groupe de culture PAC, non une analyse pédologique. |
| 9, 12 | **traités par la donnée** (voir ci-dessus) plutôt que par le gris. |
| 11 | **corrigé** — job `zaer_local` écrit et enregistré. Reste à lancer sur l'instance de production : 1,09 million de zones, environ une heure. |

## Priorité 3 — les gardes structurelles

| # | État |
|---|---|
| 15 | **corrigé** — nouveau module `connecteurs/couches.ts` : présence **par type** et **par département**. `patrimoine()` filtrait la couverture sans filtre départemental alors que la table est clé-primairée par département. Les deux nouvelles ingestions enregistrent leur couverture, celle des sites **par département ET par type** — un département n'ayant que des sites inscrits ne doit pas laisser affirmer l'absence de site classé. |
| 16 | **corrigé** — `agregerIntrants()` extraite et testée sur les **huit combinaisons** d'ingestion partielle. Un comptage n'existe que si sa couche est ingérée ; le total n'existe que si les trois le sont, un total partiel étant une borne inférieure présentée comme une estimation. |
| 17 | **corrigé** — plafond **par type** via `ROW_NUMBER() OVER (PARTITION BY type)`, avec un test qui reproduit le défaut : 60 monuments plus proches qu'un site inscrit unique. |
| 18 | **corrigé** — les trois motifs de l'avis ABF sont évalués séparément. Un site inscrit seul, sans monument dans les 10 km, donne bien `true`. |
| 19 | **corrigé** — le drapeau booléen devient une date de prochaine tentative. La séquence fautive était l'ordre naturel d'une première installation : serveur démarré avant l'ingestion, raster jamais rechargé, 10,9 % de la note éolienne perdus jusqu'au redémarrage. |
| 20 | **corrigé** — le géoréférencement du raster est vérifié à l'ouverture. Un raster projeté est refusé plutôt que d'échantillonner le mauvais pixel en silence. |
| 21 | **corrigé, et c'est le plus important** — voir ci-dessous. |
| 22 | **corrigé** — fixture PVGIS capturée avec les paramètres de production, et un test vérifie que **la table des paramètres attendus correspond au code**, dans les deux sens. |

### Item 21 — le contrôle qui rend la famille impossible

`apps/api/test/alimentation.test.ts` pose la question que sept audits n'avaient pas posée : **existe-t-il
un chemin de production capable d'alimenter ce que le code affiche ?** Trois contrôles mécaniques :

1. **toute couche lue en base est ingérée, ou son absence est déclarée** — le contrôle qui aurait
   trouvé B1. Il existe un seul `INSERT INTO contrainte` dans tout le dépôt, et six types étaient lus ;
2. **tout champ structurellement nul est déclaré, et jamais subi** — celui qui aurait trouvé B2, C1 et
   C2, avec le contrôle inverse : un champ déclaré nul qui reçoit désormais une valeur doit sortir de la
   liste, sinon le critère resterait gris sur une donnée disponible ;
3. **aucun connecteur ne renseigne un champ mesurable par une constante** — celui qui aurait trouvé B2
   directement.

**Il a trouvé deux choses à sa première exécution** (`zaer` lu sans écrivain, `inculteDepuis2013`
structurellement nul), toutes deux légitimes et désormais déclarées avec leur motif.

## Priorité 4 — API et tests

| # | État |
|---|---|
| 23 | **corrigé** — `entierRequete()` et `nombreRequete()` dans `validation.ts`, appliquées aux six routes. `ErreurValidation` est traduite en **400** par le gestionnaire global, et non plus en 500. |
| 24 | **partiellement corrigé** — le gestionnaire global rend désormais toute `ErreurValidation` en 400, ce qui rend l'usage du lecteur possible sans câblage par route. Les corps des 21 routes mutantes ne passent pas encore tous par `Lecteur` : c'est le reste ouvert le plus net. |
| 25 | **corrigé** — `idusValides()` : plafond aligné sur l'export CSV, type de chaque élément vérifié, doublons écartés, et une **seule** requête SQL pour tous les scores au lieu d'une par parcelle. |
| 26 | **corrigé** — `routes-validation.test.ts`, 12 cas : les trois refus de la route RGPD (dont « admin ne dispense pas de l'habilitation »), les routes d'administration, les plafonds d'export, les 400 sur paramètre malformé, et la cohérence du format d'erreur. |
| 27 | **corrigé** — liste fermée sur `/api/carte/couche/:type`. |
| 28 | **corrigé** — `geojson` renvoie 404 sur sélection vide, comme le Shapefile. |
| 29 | **corrigé** — `departementCouvert` a trois états. L'affichage distingue « département non ingéré » de « aucun document-cadre départemental », qui est un fait vrai pour la majorité des départements. |
| 30 | **corrigé autrement qu'annoncé** — voir ci-dessous. |

### Item 30 — pourquoi le composant n'est pas monté

Première tentative : monter `val()` avec `jsdom` et `@testing-library/react`. Le montage échoue sur
`import.meta.env.VITE_URL_API` — le composant importe le client d'API, indisponible hors de Vite.

Deux issues : simuler l'environnement Vite, ou **extraire la décision**. La seconde est meilleure, et
c'est celle que l'en-tête de `utils/affichage.ts` prescrit depuis sa création : *une fonction de l'état
vers un texte est de la logique métier, pas du rendu.* `valeurAffichable()` y descend donc, testée
sans DOM. Les deux dépendances ajoutées pour la première tentative ont été retirées — une dépendance
non utilisée est un défaut à son tour.

**Un défaut trouvé en écrivant ce test :** la garde était `v === ''`, qui ne rattrape pas `'   '`. Une
chaîne d'espaces produisait une cellule visuellement vide, indiscernable d'un défaut de rendu — et
plusieurs sources en produisent (`gestnom` des sites, `commentaire` des ZAER, plusieurs champs de
Géorisques valent l'espace plutôt que la chaîne vide).

## Défauts trouvés dans mes propres dispositifs de contrôle

Trois, et ils méritent d'être écrits parce qu'un contrôle qui se trompe sur son périmètre est pire
qu'aucun contrôle : il rassure.

1. **`scripts/mutation.mjs` ne pouvait pas attraper les mutations du moteur.** Les tests importent
   `@enr/scoring`, qui résout vers `dist/` : muter la source ne changeait rien au code exécuté. Les
   deux mutations concernées passaient et **signalaient à tort des tests décoratifs**. Le script
   reconstruit désormais l'espace de travail muté, avant et après.
2. **Le test de base de `patrimoine()` passait à vide.** Un `try/catch` mettait `baseDisponible` à
   `false` sur n'importe quelle erreur ; le serveur PostgreSQL local est tombé pendant la session, les
   six tests sont passés en affichant « base indisponible », et la mutation du défaut le plus grave
   n'était attrapée par personne. Le test échoue maintenant si `DATABASE_URL` est défini mais
   injoignable, et la CI fournit la base.
3. **La fixture PVGIS avait été capturée sans les paramètres de production** (`optimalangles=1`, 17 %
   d'écart sur les valeurs). Recapturée, et un test vérifie la correspondance code / fixture dans les
   deux sens.

## Ce qui reste ouvert

- **Lancer les deux ingestions sur l'instance de production.** Les sites sont chargés ici (6 617) ; les
  ZAER représentent 1,09 million de zones, soit environ une heure. Tant que ce n'est pas fait, les
  critères restent gris — ce qui est le comportement correct, mais pas le comportement souhaitable.
- **Les SPR** ne sont pas dans la couche `STE` : ils restent non ingérés et déclarés comme tels.
- **Les corps des 21 routes mutantes** ne passent pas tous par `Lecteur` (item 24).
- **Les couches d'intrants méthanisation** (élevages et IAA depuis l'inventaire ICPE, surfaces
  agricoles depuis le RPG agrégé, tracés de canalisations GRTgaz/GRDF) restent à ingérer. La filière
  n'est pas exploitable d'ici là, et le dit maintenant sur chacun de ses critères.
- **Les quatre items de priorité 5**, qui ne dépendent pas du code : campagne de validation par un
  expert foncier, devis réels de raccordement, relecture juridique, test d'usage.

## Score après corrections

Je ne le renote pas ici. Le rapport ci-dessus a été écrit avant les corrections, et un score
réévalué par l'auteur des corrections, le même jour, sur le même périmètre, n'aurait aucune valeur
d'audit — c'est exactement le biais d'auto-complaisance que l'audit 1 signalait en tête. Ce qui est
vérifiable et suffit : **14/14 mutations rattrapées, zéro échec sur la suite, et trois contrôles
mécaniques permanents qui échouent si l'un des défauts revient.** Un audit 9 conduit à froid dira le
reste.
