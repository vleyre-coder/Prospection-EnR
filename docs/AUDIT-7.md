# Septième audit complet — 5 août 2026

Audit conduit simultanément sous six angles : développeur senior, architecte logiciel, chef de
produit, expert UX/UI, expert QA, expert métier ENR. Neuf domaines vérifiés : moteur de scoring,
connecteurs de données externes, cohérence métier et conformité réglementaire, base de données et
migrations, API (validation, sécurité, RGPD), interface, exports et livrables, robustesse
d'exploitation, qualité technique et documentation.

**Méthode.** Aucune affirmation de ce rapport ne vient d'une lecture du code seule : chaque constat
est établi par exécution, mesure sur données réelles, ou vérification par mutation.

**Point de départ.** L'audit 6 a mis en place deux contrôles mécaniques permanents — vérifier que
les champs déclarés existent vraiment, et qu'aucun champ lu par le moteur n'est sans écrivain. Cet
audit a fait une chose simple : **appliquer le premier contrôle aux onze connecteurs qu'il ne
couvrait pas.** Il a trouvé, en une exécution, un défaut plus grave que tout ce que les six audits
précédents avaient identifié.

**Inventaire mesuré.** 25 004 lignes de source (2 127 core, 3 260 scoring, 13 481 API, 6 136
interface), 4 696 lignes de test, 6 539 lignes de documentation, 12 migrations, 31 commits.
307 tests, typage strict sur les quatre paquets, zéro échec.

---

## A. Ce qui fonctionne bien

**Les quatre corrections de l'audit 6 tiennent sur données réelles.** Vérifié par enrichissement
complet : `typeDocument = "PLUi"`, noms de sites Natura 2000 et ZNIEFF renseignés et **cohérents
avec la distance affichée**, 83 habitations dans les 500 m au lieu de 28, APPB alimenté avec une
absence constatée distinguée du silence, knock-out éolien des 500 m qui se déclenche.

**Les contrôles permanents fonctionnent — et l'un a servi immédiatement.** Le contrôle des champs
orphelins a trouvé `trameVerteBleue` dès sa première exécution. Le contrôle de contrat a été
renforcé après qu'une mutation a montré sa faiblesse. C'est le bon mécanisme : ce qui a manqué,
c'est son **périmètre**, pas son principe (voir C5).

**Les mappages de `cadastre/parcelle` et `rpg/v2` sont exacts.** Les douze propriétés déclarées pour
le cadastre et les quatre pour le RPG existent toutes dans les réponses réelles. Le défaut décrit en
B1 n'est pas un travers général : c'est un connecteur précis.

**La chaîne cadastre → enrichissement → scoring → livrable est saine.** Sur parcelles réelles :
zéro borne de vraisemblance violée, zéro erreur serveur, connecteurs en échec correctement remontés
et distingués des absences constatées.

**Les invariants de sécurité et RGPD tiennent** (revérifiés) : `AUTH_DESACTIVEE` refusé en
production, secret de signature jamais la valeur d'exemple, tuiles parcellaires authentifiées,
relais à catalogue fermé, données de propriétaire derrière habilitation + motif + journalisation.

**La reprise après perte de la table de suivi des migrations reste opérationnelle**, rejouée en CI.

---

## B. Problèmes critiques

### B1. La détection des PPR ne fonctionne pas — et l'application affirme « pas de PPRI » là où il y en a un

`georisques.ts` classe les plans de prévention des risques en lisant `libelle_risque_long` puis
`libelle_risque`. **Ces deux champs n'existent pas** dans la réponse de `gaspar/pprn`. Propriétés
réelles : `dateModification`, `departementPilote`, `etatRevision`, `idGaspar`, `libBassinRisques`,
**`libPpr`**, `listePprRevises`, `modeleProcedure`, `supExists`, `zonageReglementaire`.

`familleRisque()` reçoit donc toujours la chaîne vide, renvoie `null`, et la boucle `continue` :
**`parFamille` reste vide en toute circonstance.**

Vérifié en exécution, par le connecteur réel, sur cinq communes qui ont démontrablement des PPR :

| Commune | PPR réellement recensés à l'API | `ppri.present` | `pprif.present` | `pprt.present` | `inondation.alea` |
|---|---|---|---|---|---|
| Arles (13004) | `PPRN-I - SUB marine - Arles 2015` | **false** | false | false | **`nul`** |
| Aix-en-Provence (13001) | 6 PPR : I, MVT, RGA, IF | **false** | **false** | false | **`nul`** |
| Nice (06088) | 7 PPR : I, IF, MVT | **false** | **false** | false | **`nul`** |
| Montpellier (34172) | `PPRI_Lez_Mosson`, `PPRIF Montpellier` | **false** | **false** | false | **`nul`** |
| Lyon (69123) | `PPRI du Grand Lyon` | **false** | false | false | `fort` ¹ |

¹ Lyon obtient `fort` par le chemin `tri_zonage`, qui ne lit que la longueur de la réponse et
fonctionne. Le PPRI, lui, n'est pas vu.

**C'est le défaut le plus grave des sept audits, pour trois raisons.**

D'abord, ce n'est pas une valeur manquante mais une **valeur fausse affirmée** : la fiche écrit
« aléa inondation : nul » à Arles, commune soumise à un PPR submersion marine. Un `null` grise le
critère et se lit comme tel ; un `false` est un constat.

Ensuite, il porte sur un **risque réglementaire**, et dans le sens dangereux : `alea = nul` note le
critère 100 au lieu de 12 pour un aléa fort. Poids de `risq_inondation` : 3,8 % du score en solaire,
5 points sur 47 en BESS, 4 sur 48 en méthanisation. Avec `risq_incendie` et `risq_technologique`, la
famille « risques » pèse **10,5 % du score en BESS** et est intégralement faussée dans le sens
favorable.

Enfin, il concerne **toutes les parcelles de France**, depuis l'origine, sans qu'aucun test ni aucun
audit ne l'ait vu — parce que le code de classification est correct et que c'est la donnée qui
n'arrive jamais.

**Le défaut a deux étages.** Renommer le champ est nécessaire mais insuffisant : le classifieur
cherche les mots « inondation », « submersion », « crue », « forêt », « incendie », « mouvement »,
« argile ». Or le vocabulaire réel de `libPpr`, relevé sur huit communes, est **codé** :

| `libPpr` observé | Famille réelle | Le classifieur actuel trouverait |
|---|---|---|
| `PPRN-I - SUB marine - Arles 2015` | inondation | rien |
| `PPRI_Lez_Mosson` | inondation | rien |
| `PPRi-Lézarde` | inondation | rien |
| `PPRL-PANES` | inondation (littoral) | rien |
| `PER-I - BV Paillons [ Nice ] 1999` | inondation | rien |
| `PPRIF Montpellier` | incendie | rien |
| `PPRN-IF - Aix-en-Provence 2021` | incendie | rien |
| `PPRN-MVT - Nice 2020` | mouvement de terrain | rien |
| `PPRN-RGA - Aix-en-Provence 2012` | retrait-gonflement argiles | rien |
| `PPR Bordeaux (revision)` | indéterminé | rien |

La classification doit donc porter sur le **préfixe de type** (`PPRN-I`, `PPRI`, `PPRi`, `PPRL`,
`PER-I` → inondation ; `PPRN-IF`, `PPRIF` → incendie ; `PPRN-MVT` → mouvement ; `PPRN-RGA` →
argiles ; `PPRT` → technologique), avec repli sur les mots entiers, et **un cas indéterminé qui
reste indéterminé** — `PPR Bordeaux (revision)` ne doit pas être rangé au hasard.

### B2. La carte étiquette les sites Natura 2000 par leur code, et aucun lien de fiche INPN ne fonctionne

`zonages.ts` — le connecteur qui alimente les calques cartographiques — porte le **même défaut de
champ** que `nature.ts` avait avant l'audit 6, avec une conséquence différente parce que son repli
n'est pas le même. `nomDe()` lit `nom_site || nom || nomsuplitt || libelle || sitecode`. Sur les
couches Natura 2000, les quatre premiers sont absents ; **le repli aboutit donc sur `sitecode`.**

Mesuré sur l'emprise de Camargue, par le connecteur réel :

| Calque | Noms affichés sur la carte | Attendu |
|---|---|---|
| `natura2000_habitats` | **`"FR9301590"`, `"FR9301592"`** | « Camargue », « Petit Rhône » |
| `natura2000_oiseaux` | **`"FR9310019"`** | « Camargue » |
| `znieff1` | `"SYSTÈME DU VACCARÈS"` … | correct |
| `parc_naturel_regional` | `"Camargue"` | correct |

Un code `FR9301590` n'est pas « sans nom » : c'est une chaîne d'apparence technique qui passe pour
une donnée. Sur la contrainte environnementale qui décide d'une évaluation des incidences, l'étiquette
de la carte est illisible pour un prospecteur — et les ZNIEFF, elles, s'affichent correctement, ce
qui rend l'anomalie d'autant plus déroutante.

Second défaut dans la même fonction : `url: f.properties.url_fiche ?? null`. Le champ réel est
**`url`**. Mesuré : **`null` sur les six calques testés, sans exception.** Le lien vers la fiche INPN
— la pièce qui permet de vérifier la contrainte à la source — n'a jamais fonctionné sur aucun calque.

---

## C. Problèmes importants

### C1. Le zonage réglementaire du PPR est exposé par l'API, et le code affirme le contraire

`georisques.ts:150` porte ce commentaire, et met le champ à `null` en conséquence :

> « Le zonage reglementaire n'est pas expose par l'API : il reste a lire sur le PPR. »

C'est faux. `gaspar/pprn` renvoie `zonageReglementaire`, qui contient `zoneRegExists` et
`listTypeReg` — la liste des zones du PPR avec leur code de sévérité normalisé :

| Code | Libellé | Exemple relevé (Arles) |
|---|---|---|
| `01` | Prescriptions hors zone d'aléa | « Zone de précaution élargie » (Z2) |
| `02` | Prescriptions | « BLEU » (B2) |
| `03` | Interdiction | « PORTUAIRE » (P) |
| `04` | **Interdiction stricte** | « ROUGE » (RH) |

La prudence du commentaire est **partiellement** fondée, et il faut le dire précisément : l'API ne
donne pas la zone applicable **à la parcelle**, et il restera nécessaire de lire le plan. Mais elle
donne la nature des zones que le PPR contient, ce qui est une information matérielle — un PPR
comportant une zone d'« Interdiction stricte » n'a pas le même profil qu'un PPR limité à des
prescriptions. Cette information est jetée, et la justification écrite dans le code est inexacte.

### C2. Géorisques plafonne trois compteurs à 50, sans pagination — reporté de l'audit 6

Inchangé. `page_size: 50` / `pageSize: 50` sans lecture de `results`, `total_pages`,
`totalElements`. Mesures : Menton 148 mouvements de terrain annoncés pour 50 renvoyés, Lyon 214 sites
pollués, Paris 199 ICPE. **Effet sur la note : nul**, les courbes saturent avant 50. Ce qui reste
faux est la valeur affichée, et le fait qu'un « 50 » identique revienne sur toutes les communes
concernées.

### C3. Deux catalogues de couches se contredisent dans l'interface — reporté de l'audit 6

Inchangé. 18 des 21 entrées de `COUCHES` sont grisées sous une note affirmant qu'elles « ne peuvent
rien afficher », alors que **7 d'entre elles sont pleinement fonctionnelles** dans le panneau
`CALQUES`, sous le même nom.

### C4. L'interface reste à 0,03 de couverture, et l'ingestion à 0 — reporté de l'audit 6

| Zone | Source | Test | Ratio |
|---|---|---|---|
| `packages/core` | 2 127 | 763 | 0,36 |
| `packages/scoring` | 3 260 | 980 | 0,30 |
| `apps/api` | 13 481 | 2 758 | **0,20** (0,17 à l'audit 6) |
| **`apps/web`** | **6 136** | **195** | **0,03** |

`apps/api/src/ingestion` : 865 lignes, cité par aucun test, et c'est le code qui écrit en base les
postes sources, le réseau gaz et 46 000 monuments historiques.

### C5. Mon propre contrôle de contrat ne couvrait que 3 connecteurs sur 14 — et c'est ce qui a laissé passer B1 et B2

Le contrôle mis en place hier surveille `gpu.ts`, `nature.ts` et `wfs.ts`. Onze connecteurs restaient
hors périmètre, dont `georisques.ts` (B1) et `zonages.ts` (B2). Les deux défauts auraient été trouvés
en une exécution — je l'ai vérifié en étendant le contrôle à la main aujourd'hui.

C'est une critique de mon travail d'hier, et elle est structurelle : **une garde partielle donne la
sensation d'une garde**. J'ai écrit dans l'audit 6 que ces contrôles devaient « devenir permanents »,
et j'en ai livré une version qui couvrait 21 % des connecteurs sans le dire.

---

## D. Problèmes secondaires

- **Quatre champs déclarés inexistants dans `georisques.ts`**, sans effet parce que seules les
  longueurs de listes sont lues : `id_cavite` (réel : `identifiant`), `id_mvt` (`identifiant`),
  `nom_usuel` (`nom_etablissement`), `raison_sociale` (`codeAIOT`, `commune`…). Aucune conséquence
  aujourd'hui, mais ils font croire à un contrat vérifié — et c'est exactement dans ce voisinage que
  B1 se cachait.
- **`idsup` déclaré dans `servitudes.ts` et inexistant** (réels : `idass`, `idgen`, `nomass`).
- **`icpeProches` toujours collecté, tronqué, stocké, jamais lu.** Une requête Géorisques par
  parcelle sur un rayon de 2 000 m, jusqu'à 199 objets annoncés, pour rien.
- **`obligationDebroussaillement` ne vaut jamais `false`** : `parFamille.has('incendie') ? true :
  null`. Une absence de PPRIF ne produit donc jamais un « pas d'obligation », ce qui est défendable
  (l'obligation vient aussi d'arrêtés préfectoraux) mais rend le champ binaire-ou-nul.
- **L'APPB apparaît dans l'interface mais pas dans le PDF** hors déclenchement du knock-out :
  `FicheParcelle.tsx` lit `milieux.appb`, `exports.ts` ne le lit pas. Un APPB à 200 m est visible à
  l'écran et absent du rapport transmis.
- **`PPR Bordeaux (revision)`** montre qu'un libellé peut ne porter aucun type : la correction de B1
  doit prévoir un cas indéterminé explicite, et non un rangement par défaut.

---

## E. Erreurs métier

| Constat | Nature | Portée |
|---|---|---|
| PPRI / PPRIF / PPRT jamais détectés, aléa inondation affirmé nul | **valeur fausse affirmée** sur un risque réglementaire | toutes filières, toute la France |
| Zones réglementaires du PPR disponibles et jetées | information matérielle perdue | toutes filières |
| Sites Natura 2000 étiquetés par leur code sur la carte | livrable illisible sur la contrainte majeure | toutes filières |
| Aucun lien de fiche INPN fonctionnel | la contrainte n'est pas vérifiable à la source | toutes filières |
| Compteurs de risques plafonnés à 50 | valeur affichée fausse, note inchangée | toutes filières |
| `rncf`, APPB : couverture désormais assurée | — | corrigé à l'audit 6 |

---

## F. Risques

| Risque | Cause | Probabilité et gravité |
|---|---|---|
| **Présenter comme propice une parcelle en zone rouge de PPRI** | B1 | **certaine** dès qu'un PPRI existe ; gravité maximale — le projet est irrecevable |
| **Surnoter systématiquement la famille « risques »** | B1 | certaine ; jusqu'à 10,5 % du score en BESS |
| **Perdre la confiance d'un lecteur technique** | B2 (codes au lieu de noms) | élevée dès qu'un site Natura 2000 est proche |
| **Régression silencieuse dans un connecteur non surveillé** | C5 — 11 connecteurs hors contrôle | **élevée : c'est le mécanisme qui a produit B1 et B2** |
| **Erreur d'affichage non détectée** | interface à 0,03 | élevée |
| **Corruption d'ingestion non détectée** | 865 lignes sans test | moyenne ; gravité élevée |
| **Perte du pipeline commercial** | sauvegarde documentée, testée, reprise éprouvée | faible ; traité |

---

## Note globale : 74 / 100

| Critère | Note | Δ | Justification |
|---|---|---|---|
| Fiabilité des résultats | **62** | −8 | le recul à l'habitation et la troncature WFS sont réglés et vérifiés ; mais la détection des PPR n'a jamais fonctionné, sur toutes les parcelles, avec une valeur fausse affirmée sur un risque réglementaire — plus grave que tout ce que les six audits précédents avaient trouvé |
| Qualité technique | **80** | +2 | 307 tests, deux contrôles mécaniques, fixtures capturées sur les services réels, mutation systématique ; mais la garde ne couvrait que 3 connecteurs sur 14, ce qui est précisément pourquoi B1 a survécu |
| Qualité métier | **66** | −8 | PPR non détectés, zones réglementaires disponibles et jetées, Natura 2000 étiqueté par code, liens de source inopérants |
| Ergonomie | **74** | +2 | type de document et noms de sites renseignés, orientation rendue, séparateur décimal correct ; mais la carte affiche des codes, les liens ne marchent pas, deux catalogues se contredisent |
| Robustesse | **82** | 0 | inchangé : file durable, sonde honnête, reprise de migrations, zéro erreur serveur, zéro borne violée |
| Professionnalisation | **80** | +1 | 6 539 lignes de documentation, contrats d'API enrichis des mesures, autocritique explicite de ma garde trop étroite |

**Pourquoi la note baisse alors que le logiciel s'est amélioré.** Les corrections de l'audit 6 sont
réelles et vérifiées. Mais le 76 de l'audit 6 reposait sur un connecteur que je n'avais pas examiné :
il était surévalué. Ce qui change ici n'est pas la qualité du logiciel, c'est l'exactitude de sa
mesure. Je préfère un 74 défendable à un 76 confortable.

---

## Conclusion

### Cette application est-elle suffisamment fiable pour un usage professionnel sans risque majeur d'erreur ?

**Non, dans l'état, pour aucune filière — et pour une seule raison : B1.**

C'est la première fois en sept audits que je réponds non sans réserve de filière. Le motif est
précis : l'application **affirme** l'absence de PPRI, de PPRIF et de PPRT, et un aléa inondation nul,
sur des communes où ces plans existent. Ce n'est pas une donnée manquante qu'un prospecteur
compenserait par prudence, c'est un constat faux inscrit dans un document transmis. Une parcelle en
zone rouge de PPRI peut aujourd'hui ressortir verte.

La correction est petite — un nom de champ et un classifieur de préfixes — et elle est la première
chose à faire. Après elle, la réponse redevient celle de l'audit 6 : oui pour le solaire au sol et le
stockage avec réserves, oui pour l'éolien depuis la correction du recul à l'habitation, non pour la
méthanisation au-delà de la hiérarchisation.

---

## Feuille de route vers 100 / 100

C'est la demande explicite : la liste complète de ce qui reste. Je la donne entière, avec une
estimation d'effort et le gain attendu par critère. Deux avertissements d'abord, parce qu'ils
changent la lecture du tableau.

**Premier avertissement : 100/100 n'est pas atteignable par le code seul.** Trois des six critères
plafonnent sans apport extérieur :
- la **fiabilité** ne se démontre pas, elle se mesure — il faut une campagne de validation où un
  expert vérifie à la main les champs d'un échantillon de parcelles, et cela demande du temps humain
  que je ne peux pas produire ;
- la **qualité métier** plafonne sans **calibration absolue** : les paliers de coût de raccordement,
  de potentiel agronomique et de gisement méthanisable sont aujourd'hui des ordres de grandeur
  raisonnés, pas des valeurs adossées à des devis réels et à des décisions de gestionnaire ;
- l'**ergonomie** plafonne sans test utilisateur réel.

Le code seul mène, à mon estimation, autour de **92-94**. Les derniers points sont organisationnels.

**Second avertissement : 100 ne serait pas un état stable.** L'application dépend de 19 sources
externes qui changent sans préavis — B1 et B2 sont des dérives de contrat, pas des fautes de logique.
Un 100 signifierait « aucun défaut connu à cette date », et la seule chose qui le maintiendrait est
que les contrôles automatiques couvrent **toutes** les sources. C'est pourquoi l'item 3 ci-dessous
compte plus que son gain immédiat ne le suggère.

### Priorité 1 — indispensable avant tout usage (gain : +10 environ)

| # | Action | Effort | Critères visés |
|---|---|---|---|
| 1 | **Lire `libPpr` et classer sur le préfixe de type** (`PPRN-I`, `PPRI`, `PPRi`, `PPRL`, `PER-I` → inondation ; `PPRN-IF`, `PPRIF` → incendie ; `PPRN-MVT` → mouvement ; `PPRN-RGA` → argiles ; `PPRT` → technologique), avec un cas indéterminé qui reste indéterminé | **faible** | fiabilité +8, métier +6 |
| 2 | **Lire `sitename` et `url` dans `zonages.ts`** — deux renommages, comme à l'audit 6 mais dans le connecteur cartographique | **très faible** | ergonomie +4, métier +2 |
| 3 | **Étendre le contrôle de contrat aux 14 connecteurs**, et corriger tout ce qu'il signale | **faible** — le mécanisme existe, il faut capturer les fixtures manquantes | technique +6, fiabilité +4 |

### Priorité 2 — nécessaire pour un livrable irréprochable (gain : +6 environ)

| # | Action | Effort | Critères visés |
|---|---|---|---|
| 4 | **Exploiter `zonageReglementaire.listTypeReg`** : afficher les zones que le PPR contient et signaler l'existence d'une zone d'interdiction stricte, en disant explicitement que la zone de la parcelle reste à lire sur le plan | faible | métier +4 |
| 5 | **Paginer Géorisques** (lire `results` / `totalElements`, paginer ou marquer non fiable) | faible | fiabilité +2, ergonomie +1 |
| 6 | **Supprimer le catalogue `COUCHES`**, remplacé par `CALQUES` | très faible | ergonomie +3 |
| 7 | **Aligner le PDF et l'interface** : APPB, et tout champ visible à l'écran mais absent du rapport | faible | ergonomie +2, métier +1 |
| 8 | **Nettoyer les champs morts** : `icpeProches`, `reseauxEnterres`, et les six propriétés déclarées inexistantes | très faible | technique +2 |

### Priorité 3 — sortir du mode de défaillance dominant (gain : +8 environ)

| # | Action | Effort | Critères visés |
|---|---|---|---|
| 9 | **Tester la couche de transformation des connecteurs** avec un jeu de réponses réelles enregistrées : passer chaque réponse aux fonctions de mapping et vérifier les champs du snapshot un à un. C'est la zone où le défaut critique s'est trouvé aux audits 5, 6 et 7 | moyenne | technique +6, fiabilité +4 |
| 10 | **Tester l'interface** — 6 136 lignes à 0,03. Priorité aux trois gros fichiers : `Carte.tsx`, `FicheParcelle.tsx`, `PanneauGauche.tsx` | **élevée** | technique +5, ergonomie +4 |
| 11 | **Tester l'ingestion** — 865 lignes, 0 test, écrit en base | moyenne | technique +3, robustesse +3 |
| 12 | **Généraliser la mutation** : faire de la vérification par mutation une étape de CI sur les fichiers critiques, et non un geste manuel d'audit | moyenne | technique +4 |

### Priorité 4 — ce qui demande un apport extérieur (gain : +8 environ, non réalisable par le code)

| # | Action | Ce qu'il faut fournir | Critères visés |
|---|---|---|---|
| 13 | **Campagne de validation** : 30 à 50 parcelles réelles, chaque champ du snapshot vérifié à la main par un expert, écarts documentés | temps d'expert ENR | **fiabilité +12** — c'est le seul item qui la démontre au lieu de l'argumenter |
| 14 | **Calibration absolue** : adosser les paliers de raccordement à des devis Enedis/RTE réels, le potentiel agronomique à des références locales, le gisement méthanisable à des contrats d'approvisionnement | devis et décisions réels | métier +10 |
| 15 | **Revue réglementaire datée** : faire valider le référentiel (seuils, articles, régimes) par un juriste, et inscrire la date et le nom du valideur | revue juridique | métier +6, professionnalisation +4 |
| 16 | **Test utilisateur** : trois prospecteurs, une session d'observation, sans assistance | temps utilisateur | ergonomie +6 |
| 17 | **Audit d'accessibilité** (clavier, contraste, lecteur d'écran) | outillage ou prestataire | ergonomie +3 |

### Priorité 5 — professionnalisation (gain : +4 environ)

| # | Action | Effort |
|---|---|---|
| 18 | Versions publiées, journal des modifications, étiquettes git | faible |
| 19 | Faire échouer la CI quand `REFERENTIEL_DERNIERE_VERIFICATION` dépasse son délai de revue | très faible |
| 20 | Mesurer la performance et la charge (qualification d'une grande emprise, tuiles en vue nationale) | moyenne |
| 21 | Observabilité : alerte quand une source se dégrade silencieusement — un connecteur qui renvoie 200 et des valeurs nulles | moyenne |

### Trajectoire réaliste

| Étape | Note attendue |
|---|---|
| Aujourd'hui | **74** |
| Après priorité 1 | **84** — et l'application redevient utilisable professionnellement |
| Après priorité 2 | **90** — le livrable est irréprochable |
| Après priorité 3 | **94** — plafond du code seul |
| Après priorité 4 et 5 | **98-100** — dépend d'apports extérieurs, et le dernier point est une question de discipline, pas de développement |

### Le point de méthode

Les trois derniers audits ont trouvé leur défaut critique au même endroit et pour la même raison :
un champ lu sous un nom que la source n'emploie pas. Audit 5, la troncature WFS. Audit 6,
`typedoc` et `sitename`. Audit 7, `libelle_risque_long` et `url_fiche`.

Ce n'est plus une observation, c'est un diagnostic : **le projet n'a pas de problème de logique, il a
un problème de contrat.** Le code est juste, les tests sont justes, et la donnée n'arrive pas. Aucun
test écrit depuis le code ne peut le voir.

La conséquence pratique est l'item 3, et il est plus important que son gain de six points ne le
laisse croire. Tant qu'un seul connecteur reste hors du contrôle de contrat, le huitième audit
trouvera son défaut critique dans celui-là. J'en ai la démonstration : hier j'ai écrit ce contrôle,
je l'ai limité à trois connecteurs, et le défaut du jour était dans le quatrième.
