# Audit de l'application — 1er août 2026

Audit demandé sans complaisance, du point de vue croisé du développement, de
l'architecture, du produit, de l'UX, de la qualité logicielle et du métier ENR.

**Avertissement sur l'impartialité.** Cet audit porte sur du code que j'ai écrit
moi-même. Le biais d'auto-complaisance est réel : je l'ai contré en cherchant des
*preuves* (lecture de code, requêtes en base, appels d'API) plutôt qu'en jugeant de
mémoire, et chaque constat ci-dessous renvoie à un fichier et une ligne. Plusieurs
défauts listés ont été **introduits par moi lors des dernières modifications** ; ils sont
signalés comme tels.

Périmètre mesuré : 21 726 lignes (TypeScript, TSX, SQL), 76 fichiers source,
2 fichiers de test (474 lignes), 0 intégration continue.

---

## État des corrections — mise à jour du 1er août 2026

Les **six corrections indispensables** listées en conclusion ont été implémentées. Le
constat d'audit ci-dessous est conservé en l'état : il documente ce qui était en défaut et
pourquoi. Chaque point corrigé porte un encadré « Corrigé ».

| # | Point | État | Vérification |
|---|---|---|---|
| B1 | Avifaune = chiroptères = espèces | **corrigé** | test « ne note plus la sensibilité avifaune ni chiroptères » |
| E1 | Knock-outs 500 m / 200 m mal référencés | **corrigé** | test « conserve une parcelle assez vaste pour tenir le recul de 500 m » |
| B6 | Données de démonstration en base | **corrigé** | 4 tests, dont un garde-fou sur toute lecture non filtrée |
| B2 | Biais optimiste sur données manquantes | **corrigé** | test « plafonne à orange … sous 90 % » |
| B5 | Indice de covisibilité inventé | **corrigé** | supprimé du catalogue ; la fiche indique qu'il relève d'une étude paysagère |
| B4 | Tuiles exposant le pipeline commercial | **corrigé** | 5 tests d'accès sur la route de tuiles |

**Défaut découvert pendant ces corrections, et corrigé.** `rescorerTout` supprimait tous les
scores d'une version antérieure du moteur, puis ne recalculait que les parcelles dont le
*snapshot* était périmé. Les parcelles en bonne santé — snapshot récent — perdaient donc leur
score sans jamais le retrouver : elles disparaissaient de la carte et des listes. Le défaut
était latent ; la montée de version qu'imposent les corrections ci-dessus l'aurait déclenché
au premier recalcul. La sélection porte désormais sur les parcelles privées de score à la
version courante, la suppression n'intervient qu'après, et le recalcul est lancé
automatiquement au démarrage — une correction du moteur qui n'atteint pas les parcelles déjà
qualifiées n'a corrigé que le code.

Couverture de test : **41 tests** (22 scoring, 19 API) contre 19 au moment de l'audit. Cela
ne referme pas C2 : il n'y a toujours pas d'intégration continue, et les corrections B4 et B6
sont vérifiées par des tests de structure, pas par un scénario de bout en bout sur une base
réelle.

---

## A. Ce qui fonctionne bien

Ces points ne sont pas de la politesse : ce sont des choix qui tiennent l'examen.

**A1. Le modèle de donnée refuse d'inventer.** Tous les champs de `ParcelleSnapshot`
sont nullables, et le moteur distingue trois états : critère non applicable, critère non
évalué (gris), critère évalué. Une donnée absente ne devient jamais une valeur
favorable. C'est la décision structurante de l'application, et elle est tenue partout —
y compris dans les connecteurs, qui laissent un champ à `null` plutôt que de deviner.

**A2. L'explicabilité est réelle.** `ResultatScore` porte la liste complète des critères
avec note, poids, contribution, valeur mesurée, source, millésime, valeur juridique et
règle réglementaire datée. On peut reconstituer un score à la main. C'est très
au-dessus de la pratique courante des outils de prospection.

**A3. La traçabilité et la péremption des sources sont instrumentées.**
`source_donnee` + `v_source_fraicheur` + `GET /api/sante` + bandeau d'interface : une
source périmée est signalée, pas silencieusement utilisée.

**A4. Le pipeline d'enrichissement dégrade proprement.** 18 connecteurs en parallèle
avec `catch` individuel ; un échec est consigné dans `connecteursEnEchec`, remonté à
l'interface et au rapport PDF. L'application ne s'effondre pas parce qu'un service
public est en panne.

**A5. Les contrats d'API ont été vérifiés, pas supposés.** `docs/API_CONTRACTS.md`
documente les pièges réels (padding `section`/`numero` à 2 et 4 caractères, clé PVGIS
`H(i)_y` entre parenthèses, trois enveloppes de réponse Géorisques distinctes). Ces
pièges avaient tous produit un bogue avant d'être documentés.

**A6. Le relais cartographique.** Fonds, glyphes et calques passent par l'API quand le
navigateur n'atteint pas `data.geopf.fr`, avec bascule automatique. Sur poste
d'entreprise filtrant, c'est la différence entre une carte et un écran vide.

**A7. L'instance s'initialise seule, sans secret ni mot de passe par défaut.**
Migrations, secret JWT, compte administrateur et données nationales sont mis en place au
premier démarrage ; à défaut de configuration, secret et mot de passe sont tirés au
hasard.

**A8. Le rapport PDF est livrable en l'état.** Structure, pagination, sources datées,
avertissements. C'est un document qu'on peut joindre à un dossier.

**A9. Les avertissements du cahier des charges sont réellement câblés** — interface,
PDF, exports GeoJSON et Shapefile. Ils ne sont pas décoratifs.

---

## B. Problèmes critiques

Ces sept points interdisent, en l'état, de fonder une décision professionnelle sur les
résultats.

### B1. Trois critères éoliens portent le même nombre

`apps/api/src/connecteurs/nature.ts:112-114`

```ts
milieux.preEnjeuEspeces = preEnjeuDerive(milieux);
milieux.sensibiliteAvifaune = milieux.preEnjeuEspeces;
milieux.sensibiliteChiropteres = milieux.preEnjeuEspeces;
```

`env_avifaune` (poids 8), `env_chiropteres` (6) et `env_especes_protegees` (4)
représentent **18 % du score éolien** et valent tous les trois le même indice, lui-même
dérivé de la seule proximité aux zonages. L'interface et le rapport les présentent comme
trois critères distincts.

Pour l'éolien, la sensibilité avifaune et chiroptères est **le** critère déterminant.
Ici, elle est triplée à partir d'un proxy faible, ce qui donne une apparence de rigueur
que l'analyse n'a pas. Un développeur éolien qui hiérarchise ses secteurs là-dessus se
trompera, et ne pourra pas défendre son classement.

**Correction :** supprimer les deux critères dupliqués, ou les alimenter par une vraie
source (couches de sensibilité avifaune régionales, atlas LPO/DREAL). Tant qu'aucune
donnée n'existe, le critère doit être **gris**, pas dérivé.

> **Corrigé.** `env_avifaune` et `env_chiropteres` sont retirés du catalogue et des pondérations. Les champs
> du snapshot restent, mais le connecteur les laisse à `null` : ils accueilleront un atlas DREAL
> ou LPO le jour où il sera ingéré. Le poids d'`env_especes_protegees` en éolien passe de 4 à 9,
> de sorte que l'enjeu écologique garde son importance sans être compté trois fois.

### B2. Le score est optimiste quand la donnée manque

`packages/scoring/src/index.ts:190` — `scoreBrut = sommePonderee / poidsRenseigne`

Les critères non évalués sont **exclus de la moyenne** au lieu d'être pénalisés. Le
garde-fou est le seuil de couverture, fixé à **0,5** (`packages/core/src/criteres.ts:288`).
Une parcelle dont la moitié des critères n'ont pas pu être évalués reçoit donc une
couleur verte ou orange, calculée uniquement sur les critères disponibles.

Le biais n'est pas neutre : les critères qui manquent sont structurellement ceux qui
portent la contrainte (environnement, patrimoine, risques — voir E4). **Une parcelle mal
documentée obtient un meilleur score qu'une parcelle bien documentée**, à qualité réelle
égale. Le classement de la vue liste, qui trie par score, est donc biaisé en faveur des
parcelles sur lesquelles on en sait le moins.

**Correction :** remonter le seuil de couverture à 0,8 par défaut, et introduire une
pénalité explicite d'incertitude (par exemple plafonner le statut à orange en deçà de
0,85 de couverture), sur le modèle des `LimiteViabilite` déjà en place.

> **Corrigé.** Seuil de grisement porté de 0,5 à 0,8 pour les quatre filières. Entre 80 % et 90 % de
> couverture, le statut est plafonné à orange par une limite de viabilité explicite
> (`couverture_insuffisante`) qui affiche son motif : le vert affirme une conclusion, il exige
> une couverture qui la fonde. Version du moteur portée à 1.1.0.

### B3. Les scores matérialisés ne sont pas invalidés quand la réglementation change

`packages/scoring/src/index.ts:30` — seul `VERSION_MOTEUR` déclenche
`invaliderVersionsAnterieures`. Or `REFERENTIEL_DERNIERE_VERIFICATION` et les dates
d'entrée en vigueur des règles vivent dans `packages/core/src/reglementation.ts` et
peuvent changer **sans** que la version du moteur bouge.

L'argument de vente de l'application est la réglementation datée. Ici, un seuil qui
évolue laisse en base des scores calculés sous l'ancienne règle, affichés sans réserve.
C'est exactement le risque que l'application prétend écarter.

**Correction :** faire entrer l'empreinte du référentiel réglementaire dans la clé
d'invalidation, au même titre que la version du moteur.

### B4. Le pipeline commercial est exposé sans authentification

`apps/api/src/serveur.ts:101` exempte `/api/carte/tuiles/` de l'authentification. Or la
tuile parcellaire contient `statut_prospection` (`apps/api/src/services/tuiles.ts:60`) :
à prospecter, contact pris, **en négociation**, sécurisé.

Le commentaire du code dit « elles ne contiennent aucune donnée nominative ». C'est vrai
et hors sujet : ce n'est pas une donnée personnelle, c'est du renseignement
concurrentiel. Toute personne atteignant le serveur peut cartographier les parcelles sur
lesquelles l'entreprise négocie.

**Correction :** retirer `statut_prospection` de la tuile publique et le servir par une
tuile authentifiée distincte, ou authentifier les tuiles par jeton en paramètre d'URL.

> **Corrigé.** La route `/api/carte/tuiles/parcelles/` exige désormais un jeton ; les tuiles communales
> (compteurs agrégés) et de contraintes (zonages publics) restent ouvertes. Le client attache le
> jeton via `transformRequest`, évalué sur le fil principal et transmis au worker avec la
> requête. La réponse passe en `Cache-Control: private` avec `Vary: Authorization`, pour qu'aucun
> cache partagé ne la resserve à un autre porteur de jeton.

### B5. Un indice de covisibilité inventé

`apps/api/src/connecteurs/locales.ts:276` :
`covisibiliteIndice = min(100, nombre de monuments × 6)`

La covisibilité dépend de la topographie, des masques, des distances et de
l'appréciation de l'ABF. Compter les monuments et multiplier par six produit un nombre
qui n'a aucun contenu, présenté comme un indice sur 100. Un chiffre faux est pire qu'une
case grise : il se cite en réunion.

**Correction :** supprimer l'indice, conserver la distance au monument le plus proche et
le nombre de monuments dans le rayon — des faits vérifiables.

> **Corrigé.** Le critère `pat_covisibilite` est supprimé et le connecteur ne fabrique plus l'indice. La
> fiche affiche « non évalué — relève d'une étude paysagère » plutôt qu'une case vide.

### B6. Les données de démonstration cohabitent avec les données réelles

`apps/api/src/scripts/seeder.ts:40` insère une ZAER et un document-cadre fictifs dans
`zaer` et `document_cadre_pv`, distingués uniquement par un champ texte
`source_document = 'EXEMPLE DE DEMONSTRATION…'`.

Le moteur de scoring, lui, ne lit pas ce champ : il traite la ZAER fictive comme une
vraie. Un utilisateur ayant lancé `db:seed` obtient donc, sur deux départements, des
parcelles présentées comme situées en zone d'accélération ENR — un argument
réglementaire majeur — **qui est faux**.

**Correction :** colonne `est_demonstration boolean` filtrée par toutes les lectures, ou
schéma séparé. Un jeu de démonstration ne doit jamais être indiscernable du réel au
niveau du moteur.

> **Corrigé.** Migration 008 : colonne `est_demonstration` sur `zaer` et `document_cadre_pv`, avec reprise des
> enregistrements déjà posés. Toutes les lectures du moteur filtrent dessus. L'amorçage
> n'enregistre plus de couverture d'ingestion pour ces exemples : sans cela, le connecteur
> serait passé de « on ne sait pas s'il existe une ZAER ici » à « il n'y a pas de ZAER ici » —
> une affirmation d'absence fondée sur un jeu fictif, aussi trompeuse que l'affirmation de
> présence corrigée.

### B7. La fonctionnalité « données de propriétaires » est une coquille

`proprietaire_parcelle` n'est **écrite nulle part** : aucun `INSERT` dans tout le code.
La route `/api/parcelles/:idu/proprietaire` exige une habilitation, un motif d'accès et
une journalisation stricte — puis renvoie systématiquement des `null`.

Tout l'appareillage RGPD est correct mais entoure le vide. L'utilisateur croit disposer
d'une fonction de recherche de propriétaire ; il n'en a aucune.

**Correction :** soit retirer la route et la table de l'interface, soit implémenter
l'import documenté (demande DGFiP / mairie) avec sa traçabilité.

---

## C. Problèmes importants

**C1. Doublon de couches — défaut que j'ai introduit.** Huit identifiants existent dans
les deux systèmes parallèles `couches` (table `contrainte`) et `calques` (catalogue) :
`natura2000_habitats`, `natura2000_oiseaux`, `znieff1`, `znieff2`, `reserve_naturelle`,
`parc_national`, `parc_naturel_regional`, `monument_historique`. Le panneau les affiche
**deux fois** : une version grisée « indisponible » et une version fonctionnelle. C'est
exactement la confusion que la demande n°6 visait à supprimer. À corriger en priorité :
supprimer les entrées correspondantes de `COUCHES`.

**C2. Couverture de test dérisoire.** 474 lignes de test pour 21 726 lignes de code, soit
**2,2 %**. Aucun test d'intégration d'API, aucun test de composant, aucune intégration
continue. Le moteur de scoring est testé (19 cas) ; tout le reste — connecteurs, routes,
tuiles, exports, interface — ne l'est pas. Chaque modification est un pari.

**C3. La qualification ne passe pas à l'échelle et ne reprend pas.** Traitement
séquentiel parcelle par parcelle (`qualification.ts:101`), environ 5 s l'unité : 1 500
parcelles = 2 heures. L'état d'avancement est un **singleton en mémoire**
(`qualification.ts:250`) : un redémarrage du serveur perd le suivi, et deux instances
derrière un répartiteur de charge afficheraient des états divergents. Les parcelles déjà
traitées sont en base, donc rien n'est perdu — mais la campagne ne reprend pas seule.

**C4. La vue liste n'est pas bornée géographiquement.** Le filtre accepte une `bbox`
(`recherche.ts:266`) mais l'interface ne la transmet jamais : la liste affiche toute la
base. C'est très probablement l'origine de la confusion « Nogent et Gueugnon » signalée
en usage : deux secteurs qualifiés à des moments différents apparaissent ensemble, ce qui
donne l'impression d'une qualification hors zone.

**C5. Le rouge confond deux notions.** Un critère rédhibitoire (fait juridique) et un
score bas (jugement économique) produisent la même couleur. Pour un professionnel,
« rédhibitoire » a un sens précis. La légende l'explique, mais la carte ne le distingue
pas — et c'est la carte qu'on regarde.

**C6. Cache de snapshot uniforme à 30 jours.** Une révision de PLU, un nouveau document
d'urbanisme ou une capacité de raccordement mise à jour ne sont pas reflétés avant
expiration. La granularité devrait suivre la volatilité de chaque source.

**C7. Aucune limitation de débit.** Pas de `@fastify/rate-limit`. Les relais de tuiles,
de polices et de calques sont non authentifiés : ils constituent un amplificateur de
bande passante utilisable par un tiers.

**C8. `window.alert` / `confirm` / `prompt`** — 8 occurrences, dont la création de site
et la confirmation de campagne. Bloquant, non stylé, impossible à copier : inadapté à un
outil professionnel.

---

## D. Problèmes secondaires

- **Texte sans accents** dans une large partie de l'interface et des messages
  (« redhibitoire », « propice a demarcher »). Sur un outil destiné à des clients
  français, cela dégrade la perception de sérieux. Le code peut rester en ASCII ; les
  chaînes affichées, non.
- **Paquet frontend de 1,12 Mo** (318 ko compressés), sans découpage. Premier chargement
  lent sur connexion médiocre.
- `filtre_sauvegarde` : table déclarée, fonctionnalité jamais implémentée.
- Pas de sauvegarde automatisée ; la procédure existe mais reste manuelle.
- Pas d'historique des changements de score : impossible de justifier a posteriori
  pourquoi une parcelle est passée de verte à orange.
- Quatre `catch` silencieux côté interface, commentés mais sans remontée à l'utilisateur.

---

## E. Erreurs métier

**E1. Les distances réglementaires sont mesurées depuis la mauvaise référence.**
*(Corrigé : le moteur ajoute un déport d'implantation, approché par le rayon du disque de même
surface, avant de comparer au recul de 500 m ou 200 m. Une parcelle de 40 ha dont le bord est à
430 m n'est plus écartée ; la même distance sur 1,5 ha reste éliminatoire. La valeur affichée
distingue « du bord » et « en implantant au plus loin ».)*

`knockouts.ts:184` — le knock-out des 500 m éolien utilise `distanceHabitationM`,
c'est-à-dire la distance entre **la parcelle** et l'habitation la plus proche. L'article
L.515-44 impose 500 m entre **l'aérogénérateur** et l'habitation. Une éolienne étant
implantée en retrait à l'intérieur de la parcelle, une parcelle à 430 m peut parfaitement
accueillir une machine à 520 m.

Conséquence directe : **l'application écarte des parcelles viables**. Sur de l'éolien,
c'est une perte commerciale sèche, et elle est invisible puisque la parcelle disparaît du
classement. Même défaut pour la méthanisation (200 m, `knockouts.ts:259`).

**Correction :** transformer ces knock-outs en critères pénalisants avec la mention
« implantation contrainte », et ne conserver le caractère rédhibitoire que si la parcelle
est trop petite pour loger le recul (surface et forme).

**E2. « Surface utile » = surface cadastrale totale.** `criteres-eval.ts:714` note la
surface sans déduire reculs, accès, servitudes ni zones exclues. Sur une parcelle
allongée ou grevée, la surface réellement exploitable peut être inférieure de moitié. Le
terme « utile » est donc trompeur.

**E3. Distance au poste source à vol d'oiseau.** Le coût de raccordement dépend du
linéaire de câble réellement posable (voirie, franchissements, servitudes), couramment
1,3 à 1,8 fois la distance directe. Le critère et le rayon économique sous-estiment donc
systématiquement le coût.

**E4. Le champ environnemental repose sur des proxies.** Au-delà de B1, les zones humides
sont un pré-repérage (l'application le dit), les ZNIEFF sont d'inventaire, et l'enjeu
espèces protégées — celui qui fait tomber les projets au contentieux — n'a aucune source.
Ce n'est pas un défaut de l'application, c'est l'état de la donnée ouverte ; mais la
conséquence doit être assumée : **l'application ne présélectionne pas le risque
environnemental**, elle en donne un aperçu.

**E5. Le règlement écrit des PLU n'est pas lu.** Documenté, mais il faut mesurer la
portée : la compatibilité d'un zonage agricole avec du photovoltaïque dépend presque
entièrement de l'écrit. Le critère « compatibilité du zonage » est donc une probabilité,
pas une conclusion.

**E6. Le zonage réglementaire des PPR est inaccessible.** L'application signale la
présence d'un PPRI, pas la couleur de la zone. Une parcelle en zone bleue est
constructible sous prescriptions, une parcelle en zone rouge ne l'est pas : la différence
est totale, et l'application ne la voit pas.

---

## F. Risques

| Risque | Mécanisme | Gravité |
|---|---|---|
| **Écarter à tort un secteur éolien** | knock-out 500 m mesuré depuis la parcelle (E1) | élevée — perte commerciale invisible |
| **Prioriser une parcelle mal documentée** | biais optimiste sur données manquantes (B2) | élevée — le classement est faussé |
| **Défendre un chiffre indéfendable** | indices dérivés ou inventés (B1, B5) présentés comme des mesures | élevée — perte de crédibilité en réunion |
| **Conclure sur une ZAER inexistante** | données de démonstration indiscernables (B6) | élevée — argument réglementaire faux |
| **Appliquer une règle abrogée** | scores non invalidés au changement de référentiel (B3) | moyenne à élevée |
| **Fuite du pipeline commercial** | tuiles non authentifiées (B4) | élevée si l'instance est exposée |
| **Régression silencieuse** | 2,2 % de couverture de test, pas d'intégration continue (C2) | élevée dans la durée |
| **Perte de données** | sauvegarde non automatisée ; le pipeline commercial est la seule donnée non reconstituable | moyenne |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | ~~Avifaune = chiroptères = espèces (B1)~~ **corrigé** | fausse le cœur du score éolien | faible (supprimer 2 critères) | **critique** |
| 2 | ~~Knock-outs 500 m / 200 m mal référencés (E1)~~ **corrigé** | écarte des parcelles viables | moyenne | **critique** |
| 3 | ~~Données de démonstration en base (B6)~~ **corrigé** | conclusion réglementaire fausse | faible | **critique** |
| 4 | ~~Biais optimiste sur données manquantes (B2)~~ **corrigé** | classement faussé | faible (seuils) | **critique** |
| 5 | ~~Indice de covisibilité inventé (B5)~~ **corrigé** | chiffre sans contenu | faible | **critique** |
| 6 | ~~Tuiles exposant le pipeline (B4)~~ **corrigé** | fuite concurrentielle | faible | **critique** |
| 7 | Doublon couches/calques (C1) | interface incohérente | faible | **élevée** |
| 8 | Scores non invalidés au changement de règle (B3) | règle périmée appliquée | moyenne | **élevée** |
| 9 | Fonction propriétaires vide (B7) | promesse non tenue | faible (retirer) ou élevée (implémenter) | **élevée** |
| 10 | Couverture de test et intégration continue (C2) | régressions | élevée | **élevée** |
| 11 | Liste non bornée à l'emprise (C4) | confusion d'usage | faible | **élevée** |
| 12 | Distinguer rédhibitoire et score bas (C5) | contresens métier | faible | **moyenne** |
| 13 | Reprise de campagne et état persistant (C3) | exploitation à l'échelle | moyenne | **moyenne** |
| 14 | Surface utile sans déduction (E2) | surestimation | moyenne | **moyenne** |
| 15 | Distance poste à vol d'oiseau (E3) | sous-estimation du coût | faible (coefficient) | **moyenne** |
| 16 | Limitation de débit (C7) | abus de service | faible | **moyenne** |
| 17 | Boîtes de dialogue natives (C8) | perception amateur | faible | **moyenne** |
| 18 | Accentuation de l'interface (D) | perception | faible mais fastidieux | **faible** |
| 19 | Découpage du paquet frontend (D) | premier chargement | moyenne | **faible** |
| 20 | Historique des scores (D) | justification a posteriori | moyenne | **faible** |

---

## Note globale : 54 / 100

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | **45** | moteur bien construit, mais trois biais réels : proxies dupliqués, optimisme sur données manquantes, référentiel non lié aux scores |
| Qualité technique | **62** | code typé, structuré, commenté sur le « pourquoi » ; mais 2,2 % de tests, aucune intégration continue, état en mémoire |
| Qualité métier | **50** | traçabilité et avertissements exemplaires ; distances réglementaires mal référencées, indices inventés |
| Ergonomie | **60** | sélecteur de filière, légende, fiche et rapport PDF de bon niveau ; doublons de couches, dialogues natifs, liste non bornée |
| Robustesse | **55** | dégradation propre des connecteurs, garde-fous d'emprise testés ; pas de reprise, pas de limitation de débit |
| Professionnalisation | **55** | documentation et installation remarquables ; pas de CI, pas de versionnement du référentiel, pas de sauvegarde automatisée |

---

## Conclusion

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un
> cadre professionnel sans risque majeur d'erreur ?**

**Non.** Elle est utilisable comme **outil de dégrossissage interne**, à condition que
l'utilisateur connaisse ses limites. Elle ne l'est pas comme outil de décision, et encore
moins comme pièce transmise à un tiers — client, investisseur ou service instructeur —
car plusieurs chiffres qu'elle affiche ne sont pas défendables.

La raison n'est pas l'architecture, qui est saine, ni la traçabilité, qui est meilleure
que la moyenne du marché. Elle tient à **quelques points précis où l'application affiche
une précision qu'elle n'a pas** : trois critères éoliens qui sont le même nombre, un
indice de covisibilité arithmétique, un score qui s'améliore quand la donnée manque, des
distances réglementaires mesurées depuis la parcelle au lieu de l'installation, et un jeu
de démonstration indiscernable du réel.

**Corrections indispensables avant tout usage opérationnel** — les six premières lignes
du tableau G, soit environ deux à trois jours de travail. *Les six ont été implémentées ; voir
« Verdict révisé » en fin de document.* :

1. supprimer `env_avifaune` et `env_chiropteres`, ou les passer en gris tant qu'aucune
   source réelle ne les alimente ;
2. supprimer l'indice de covisibilité ;
3. requalifier les knock-outs 500 m et 200 m en critères pénalisants, avec le caractère
   rédhibitoire réservé aux parcelles trop petites pour loger le recul ;
4. porter le seuil de couverture à 0,8 et plafonner le statut en cas de couverture faible ;
5. marquer et filtrer les données de démonstration ;
6. retirer `statut_prospection` des tuiles non authentifiées.

**Ensuite, et avant tout usage en équipe** : lier l'invalidation des scores au référentiel
réglementaire (8), supprimer le doublon de couches (7), et retirer ou implémenter la
fonction propriétaires (9).

**À moyen terme**, le point qui décidera de la durée de vie de l'outil est la couverture
de test et l'intégration continue (10). En l'état, chaque évolution peut casser
silencieusement un calcul — et les deux régressions rencontrées cette semaine (coloration
rouge généralisée, tuiles vectorielles muettes) en sont la démonstration : toutes deux
sont passées inaperçues jusqu'à l'usage réel.

---

## Verdict révisé — après les six corrections critiques

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un
> cadre professionnel sans risque majeur d'erreur ?**

**Comme outil de dégrossissage et de priorisation interne : oui désormais.** Les six points
qui faisaient afficher à l'application une précision qu'elle n'avait pas sont traités. Elle
n'invente plus de chiffre, ne triple plus un enjeu, n'écarte plus une parcelle implantable, ne
publie plus un vert sur une donnée trop lacunaire, ne présente plus une ZAER fictive comme
réelle, et n'expose plus le pipeline commercial.

**Comme pièce transmise à un tiers — client, investisseur, service instructeur : toujours
non**, et pour des raisons différentes de celles de l'audit initial :

- **B3** subsiste : un seuil réglementaire peut changer sans que la version du moteur bouge,
  laissant en base des scores calculés sous l'ancienne règle. C'est le point le plus gênant
  pour un document transmis, puisque l'argument de vente est la réglementation datée.
- **B7** subsiste : la fonction « données de propriétaires » reste une coquille.
- **C2** subsiste largement : 41 tests et toujours aucune intégration continue. Les tests
  ajoutés couvrent les corrections, pas le reste du moteur.
- Les indicateurs dérivés restants (potentiel agronomique, surface d'un seul tenant, distance à
  vol d'oiseau) demeurent des proxies. Ils sont désormais honnêtement étiquetés, mais un
  destinataire externe les lira comme des mesures.

**Note révisée : 66 / 100** (contre 54).

| Critère | Avant | Après | Ce qui a changé |
|---|---|---|---|
| Fiabilité des résultats | 45 | **70** | proxies dupliqués supprimés, biais optimiste corrigé, jeu de démonstration écarté ; reste B3 |
| Qualité technique | 62 | **66** | 41 tests contre 19, dont un garde-fou anti-régression ; toujours pas de CI |
| Qualité métier | 50 | **72** | distances réglementaires correctement référencées, plus aucun indice inventé |
| Ergonomie | 60 | **61** | inchangée, hormis l'affichage explicite des indicateurs sans source |
| Robustesse | 55 | **62** | recalcul automatique des scores obsolètes, défaut de `rescorerTout` corrigé |
| Professionnalisation | 55 | **58** | documentation à jour ; ni CI, ni versionnement du référentiel, ni sauvegarde |

**Prochaine correction à prioriser :** B3 — faire entrer l'empreinte du référentiel
réglementaire dans la clé d'invalidation des scores. Le mécanisme de recalcul automatique
ajouté pendant ces corrections en constitue la moitié : il ne manque que l'empreinte.
