# Quatrième audit complet — 4 août 2026

Audit mené après les corrections B1–B6, C1–C6, D et E issues du troisième audit.

**Méthode, et pourquoi elle change tout cette fois.** Les trois audits précédents raisonnaient
sur le code et sur des fixtures. Celui-ci a démarré un PostgreSQL 16 / PostGIS 3.4, appliqué
les dix migrations, lancé le serveur en `NODE_ENV=production`, créé un administrateur et un
utilisateur en lecture seule, **qualifié 49 parcelles réelles** en interrogeant les sources
publiques, puis lu les résultats : requêtes SQL, réponses HTTP, contenu binaire des exports, et
texte du rapport PDF extrait par `pdftotext`.

C'est cette différence de méthode qui explique le résultat de l'audit. **Le défaut le plus grave
trouvé ici était présent lors des trois audits précédents et aucun ne l'a vu**, parce qu'aucun
n'avait comparé les nombres produits par l'application à des parcelles réelles. Il ne s'agit pas
d'une régression : il s'agit d'une erreur de fond sur le chiffre que l'application met en avant.

---

## A. Ce qui fonctionne bien

**Le modèle de rôles est étanche.** Vérifié route par route avec un compte en lecture seule
réel : les trois lectures passent (recherche, leads, export CSV), les trois écritures sont
refusées en 403 (`lecture_seule`), les quatre routes d'administration sont refusées, et l'accès
aux données de propriétaires est refusé en 403 `non_habilite` malgré un motif valide. Aucun
contournement trouvé.

**L'isolement des données de propriétaires tient.** `proprietaire_parcelle` n'est lue qu'à deux
endroits : la route dédiée (habilitation + motif + journalisation stricte) et le script de
versement. Vérifié par recherche exhaustive dans les 12 157 lignes de l'API. Le CSV réel
(15 colonnes), le GeoJSON réel (14 propriétés) et le DBF du Shapefile réel (11 champs)
ne contiennent aucune mention de propriétaire. Les tuiles vectorielles non plus.

**La chaîne RGPD complète fonctionne**, versement compris. Testée de bout en bout : import CSV
refusé sans provenance et sans échéance, stockage, purge à échéance, champ `nominatif` effacé,
provenance conservée pour la redevabilité, purge inscrite au journal d'accès avec le décompte.

**`AUTH_DESACTIVEE` échoue fermé en production.** Toute route protégée répond
`configuration_invalide` plutôt que d'accorder un accès administrateur. Le secret JWT, s'il
n'est pas fourni, est tiré aléatoirement sur 32 octets et persisté en base : une installation
sans configuration n'a pas de secret faible, et le `ON CONFLICT` gère deux instances démarrant
ensemble.

**Le mécanisme d'invalidation des scores fonctionne, et je l'ai constaté par accident.** Des
scores semés avec `version_moteur = 'test'` ont été supprimés au démarrage suivant, exactement
comme prévu. Le moteur porte `1.3.0+4992efb4`, empreinte incluant désormais les barèmes.

**Les exports sont solides.** Shapefile conforme à la spécification ESRI, écrit sans dépendance,
avec `.prj`, `.cpg` et un `LISEZ-MOI.txt`. CSV avec BOM UTF-8, virgule décimale, échappement
correct. GeoJSON avec avertissement sur la valeur juridique des contours. PDF de 4 pages généré
depuis un snapshot réel comme depuis un snapshot entièrement vide.

**Le rapport PDF est de bon niveau éditorial.** Lu intégralement : verdict chiffré, limites de
viabilité motivées, synthèse atouts/vigilances, carte d'identité, seuils de procédure avec leur
fondement daté, traçabilité des sources et version du moteur. La correction B4 est effective :
le tableau Raccordement porte les deux distances et la note explicative.

**Les deux calculs déportés en SQL sont exacts.** Parts de recouvrement vérifiées sur quatre cas
de référence (1,00 / 0,00 / 0,50 / 0,25). Contiguïté : 5,95 m d'écart donnent un groupe, 223 m en
donnent deux.

**La purge du limiteur de débit fonctionne**, vérifiée en conditions : 600 seaux créés, aucun
purgeable car tous récents, puis après expiration de la fenêtre et 500 nouvelles créations, il
n'en reste que 500. Le compteur de créations, monotone, se déclenche bien là où
`seaux.size % 500` pouvait ne jamais le faire.

**Hygiène du code.** 0 `as any`, 0 `@ts-ignore`, 0 `catch` vide, 0 `TODO`, 5 `eslint-disable`
tous justifiés. 25 377 lignes de source, 2 383 lignes de test, 4 850 lignes de documentation.
Dix migrations idempotentes, rejouées deux fois depuis une base vierge.

---

## B. Problèmes critiques

### B1. Le calcul de pente est numériquement instable : 14 % des parcelles portent une valeur physiquement impossible

**C'est le défaut le plus grave des quatre audits, et il était là depuis le début.**

Sur les 49 parcelles réellement qualifiées, la pente médiane vaut 1,0 % — plausible en Beauce.
Mais **7 parcelles sur 49 (14 %) portent une pente supérieure à 100 %**, jusqu'à **1 665,9 %** :

| IDU | Surface | Pente stockée | Dénivelé | Pente plausible |
|---|---|---|---|---|
| 28221000ZL0108 | 2,26 ha | **1 665,9 %** | 1,8 m | ~1,2 % |
| 282120000A0001 | 0,42 ha | **1 420,2 %** | 2,5 m | ~0,7 % |
| 28382000YE0001 | 1,07 ha | **1 134,2 %** | 0,5 m | ~0,5 % |
| 28382000YE0012 | 1,27 ha | **703,8 %** | 2,0 m | ~1,1 % |
| 28382000ZW0108 | 7,49 ha | **679,1 %** | 2,9 m | ~0,8 % |

1,8 m de dénivelé sur 2,26 ha donnent environ 1,2 % de pente. La valeur stockée est fausse de
trois ordres de grandeur.

**La cause.** `penteDepuisSemis` (`apps/api/src/geo.ts:284`) ajuste un plan par moindres carrés
et se protège de la dégénérescence par `if (Math.abs(det) > 1e-6)`. Or `det = sxx·syy − sxy²`
où `x` et `y` sont en **mètres** : sa grandeur naturelle est de l'ordre de 10⁷ à 10⁹. Un seuil
absolu de 1e-6 sur une telle quantité ne teste rien. J'ai mesuré un `det` de **14,6** — donc
un conditionnement relatif de 2,3·10⁻⁹, complètement dégénéré — qui franchit la garde avec
sept ordres de grandeur de marge.

Reproduit en faisant varier l'extension latérale du semis, configuration produite par une
parcelle en lanière dont la grille de sondage ne retient qu'une bande de points :

| Extension latérale du semis | Pente calculée | Pente réelle (mesure par paires) |
|---|---|---|
| 55,5 m | 1,3 % | 1,3 % |
| 11,1 m | 6,5 % | 0,9 % |
| 2,2 m | 32,3 % | 0,8 % |
| 0,56 m | **129,4 %** | 0,8 % |

**Le plus troublant : la valeur juste est déjà dans le même objet.** `penteMaxPct`, calculée par
différences d'altitude entre paires de points distants de plus de 10 m, vaut 1,4 % là où
`pentePct` vaut 1 665,9 %. Le rapport PDF imprime littéralement « Pente 205,1 % (max 1,2 %) » :
deux nombres qui se contredisent d'un facteur 170, côte à côte, sans qu'aucun contrôle ne s'en
émeuve.

**L'impact métier, mesuré.** `topo_pente` pèse 6,1 % du score solaire. La note du critère passe
de **0/100 à 99/100** une fois la pente corrigée :

| IDU | Score avec pente aberrante | Score avec pente plausible | Écart |
|---|---|---|---|
| 28382000ZW0108 | 59,2 | 70,8 | **+11,6** |
| 282120000A0001 | 54,6 | 65,0 | **+10,4** |
| 28382000YE0001 | 59,4 | 68,3 | **+8,9** |
| 28221000ZL0108 | 60,6 | 68,8 | **+8,2** |

8 à 12 points de score global. Sur un seuil de propice à 70, la parcelle ZW0108 passe de 59,2 à
70,8 : elle **change de couleur**, d'orange à verte. Une parcelle plate et exploitable est
écartée du tri quotidien.

Aucune borne de vraisemblance n'est appliquée avant stockage, et **aucun test ne couvre
`penteDepuisSemis`** — c'est pourquoi le défaut a traversé trois audits.

Le sens de l'erreur est pessimiste, ce qui est moins dangereux qu'optimiste : on perd des
opportunités, on n'en fabrique pas. Cela n'atténue pas le fait que le chiffre mis en avant par
l'application est faux sur une parcelle sur sept.

### B2. Le corps de requête de la recherche part sans validation dans le constructeur SQL

`apps/api/src/routes/divers.ts:41` :

```ts
return filtrerParcelles({ ...corps, filiere: corps.filiere } as FiltresParcelles);
```

Le corps est diffusé tel quel avec un `as`, qui ne vérifie rien à l'exécution. Quatre entrées
client mesurées, toutes en **HTTP 500** :

| Corps envoyé | Réponse en développement | Réponse en production |
|---|---|---|
| `{"limite": -5}` | 500 `LIMIT must not be negative` | 500 `Erreur interne du serveur` |
| `{"decalage": -10}` | 500 `OFFSET must not be negative` | 500 `Erreur interne du serveur` |
| `{"surfaceMinHa": "abc"}` | 500 `invalid input syntax for type integer: "abc"` | 500 `Erreur interne du serveur` |
| `{"statutsScore": "pas_un_tableau"}` | 500 `malformed array literal` | 500 `Erreur interne du serveur` |

Deux conséquences. Une erreur de saisie est signalée comme une panne serveur : l'utilisateur ne
peut pas savoir quoi corriger, et une supervision réveille une astreinte pour une faute de
frappe. En développement, le message brut de PostgreSQL remonte au client — la production le
masque, ce qui limite la divulgation au seul poste de développement.

**`limite` n'est pas plafonnée.** `params.push(f.limite ?? 200, ...)` utilise la valeur brute :
`{"limite": 100000}` est accepté. Sur une base nationale, un seul appel authentifié lit toute la
table. Le limiteur de débit ne couvre pas cette route.

Aucune injection SQL : tout passe par des paramètres, et un `tri` arbitraire retombe sur l'ordre
par défaut — vérifié avec `"tri": "score_desc; DROP TABLE parcelle"`.

### B3. Une campagne interrompue est invisible pour l'utilisateur

`derniereCampagne()` (`services/qualification.ts:397`) est exportée et **appelée par personne**.
Aucune route ne l'expose.

Scénario mesuré. Campagne de 1 500 parcelles lancée, arrivée à 49 traitées, serveur redémarré.
En base, la trace est correcte : `interrompue=true`, message « Qualification : 49/1500 parcelle(s)
[interrompue par un arrêt du serveur] », et le journal du serveur avertit. Mais
`/api/qualification/etat` répond :

```json
{ "enCours": false, "phase": "aucune", "message": null, "fileAttente": [] }
```

L'utilisateur ne peut pas distinguer « ma campagne s'est arrêtée à 49 sur 1 500 » de « aucune
campagne n'a jamais tourné ». Et la carte, elle, affiche bien 49 nouvelles parcelles qualifiées :
**un lot partiel ressemble exactement à un lot complet**. C'est la classe d'erreur que cette
application existe pour écarter. Le troisième audit notait que « la trace en base permet de
constater les campagnes interrompues » : c'est vrai pour qui lit la base en SQL, faux pour
l'utilisateur.

### B4. La file de qualification ne survit pas à un redémarrage, et le dit à personne

La file ajoutée hier est un tableau en mémoire. Mesuré : trois demandes acceptées et en attente
avant l'arrêt, **zéro après le redémarrage**. Aucune trace en base, aucune ligne de journal,
aucun message. Trois utilisateurs à qui l'API a répondu 202 « votre demande démarrera seule »
attendront indéfiniment.

Le paradoxe est net : la campagne *en cours* est tracée en base et marquée interrompue, mais les
demandes *acceptées* ne le sont nulle part. J'ai construit la file sans lui donner la durabilité
que le mécanisme voisin possédait déjà.

### B5. Le Shapefile ne distingue pas une parcelle écartée par le droit d'une parcelle mal notée

Le DBF réel porte 11 champs : `IDU, CODE_INSEE, COMMUNE, SECTION, NUMERO, SURFACE_HA, STATUT,
SCORE, COUVERTURE, NB_KO, REGIME`. `NB_KO` vient de `score.knockOuts.length`
(`routes/divers.ts:120`), soit le total **dérogeables inclus**.

C'est exactement le défaut B1 du troisième audit, survivant dans le format le plus souvent remis
à un tiers — géomètre, bureau d'études, consultant SIG. J'ai corrigé le CSV et le GeoJSON hier
et laissé le Shapefile de côté : c'est le seul export que mes nouveaux tests ne couvraient pas.
Trois audits, et la même conclusion se répète à l'identique.

### B6. La supervision annonce une instance saine alors qu'elle ne peut rien servir

En production avec `AUTH_DESACTIVEE=true`, le serveur démarre, `/api/sante` répond **200 avec
`statut: "ok"` et `baseDeDonnees: "ok"`**, et toute route protégée répond 500
`configuration_invalide`. Rien dans la réponse de santé ne mentionne la configuration.

Un déploiement passe donc au vert sur une instance entièrement inopérante, et une bascule de
trafic y envoie les utilisateurs. Le choix d'échouer à la requête plutôt qu'au démarrage est
défendable — cela échoue fermé — mais il faut alors que la sonde de santé le sache.

---

## C. Problèmes importants

### C1. Le seuil d'étendue de qualification est comparé sans marge, sur une frontière flottante

Six emprises **mathématiquement identiques** (1° × 0,5°, soit exactement `ETENDUE_MAX_DEG2`),
décalées seulement en longitude :

| Emprise | Largeur calculée | Étendue | Verdict |
|---|---|---|---|
| 1,71 → 2,71 | 1 | 0,5 | acceptée |
| 1,72 → 2,72 | 0,999 999 999 999 999 8 | 0,499 999 999 999 999 9 | acceptée |
| **1,74 → 2,74** | **1,000 000 000 000 000 2** | **0,500 000 000 000 000 1** | **refusée 422** |
| 1,75 → 2,75 | 1 | 0,5 | acceptée |

Le test `etendue > 0,5` bascule sur le dernier bit de la soustraction. Pour l'utilisateur, la
même vue de carte est acceptée puis refusée « emprise trop vaste » selon une fraction de degré
de panoramique, sans raison visible. C'est la troisième occurrence du même schéma après les
2,999 999 999 999 999 6 ha du site et l'accumulation de surfaces : **un flottant non arrondi
comparé à un seuil rond**.

### C2. La validation d'emprise ajoutée au troisième audit ne s'applique pas là où l'interface passe

`bboxDepuisChaine` valide le domaine, l'ordre et l'étendue. Mais elle ne sert qu'aux chemins en
chaîne de requête. Le chemin réellement emprunté par la vue liste — le corps JSON de
`POST /api/recherche/parcelles` — n'appelle rien. Mesuré sur 40 parcelles semées en deux zones
distantes :

| bbox envoyée | Résultat |
|---|---|
| `[1.74, 48.14, 1.79, 48.16]` (zone A) | 20 — correct |
| `[1.79, 48.16, 1.74, 48.14]` (**inversée**) | 20 — accepté silencieusement |
| `[200, 90, 201, 91]` (**hors domaine**) | 0 — accepté, renvoie vide |
| `[-180, -90, 180, 90]` (**monde entier**) | 40 — accepté, plafond d'étendue non appliqué |

L'emprise inversée donne le bon résultat parce que `ST_MakeEnvelope` normalise les coins : la
conséquence est bénigne. L'emprise mondiale, elle, contourne le plafond de deux fois la France
que la validation était censée imposer.

### C3. La couverture de test reste très inégale, et c'est là que sont les défauts

| Zone | Lignes de source | Lignes de test | Ratio |
|---|---|---|---|
| `packages/scoring` | 3 173 | 902 | 0,28 |
| `apps/api` | 12 157 | 1 286 | 0,11 |
| `apps/web` | 6 075 | 195 | 0,03 |
| `packages/core` | 1 773 | **0** | **0,00** |

146 tests, contre 78 au troisième audit et 19 au premier. Mais **B1 vit dans `apps/api/src/geo.ts`,
non couvert**, et `packages/core` — qui porte le référentiel réglementaire, les pondérations et
les avertissements, c'est-à-dire tout le fondement métier — n'a aucun test.

### C4. Neuf fonctions exportées ne sont appelées par personne

Recherche exhaustive sur les quatre paquets, tests inclus :

`derniereCampagne`, `nbSeaux`, `viderCacheHttp`, `oublierCouchesIntrantes`,
`empreinteReferentiel`, `avertissementsPourCible`, `distanceAtteignableM`, `haToM2`, `m2ToHa`.

Deux sont graves, et c'est un schéma, pas un accident :

- `derniereCampagne` → B3, l'interruption invisible.
- `nbSeaux`, que j'ai ajoutée hier avec le commentaire « exposé pour les tests », puis dont je
  n'ai pas écrit le test. J'ai vérifié la purge dans cet audit : elle est correcte. Elle ne
  l'était que par chance.

C'est la **troisième fois** en deux jours que le motif se répète : `purger_donnees_nominatives()`
écrite en migration 006 et jamais appelée, `derniereCampagne` écrite et jamais exposée, `nbSeaux`
exposée et jamais testée. Écrire le mécanisme et oublier de le brancher est devenu le mode de
défaillance dominant du projet.

### C5. Le modèle d'érosion périmétrale devient absurde sur les petites parcelles

Le rapport réel d'une parcelle de 0,31 ha annonce « 0,14 ha implantables (0,31 ha au cadastre,
soit **54 % déduits** ) ». La bande de 5 m appliquée au périmètre d'un disque équivalent consomme
plus de la moitié d'une parcelle de 55 m de côté. Le modèle est cohérent avec lui-même, mais
54 % n'est pas une estimation utilisable : c'est l'indication que la formule sort de son domaine
de validité en dessous d'environ 1 ha.

Rien ne le signale, et le chiffre alimente une limite de viabilité présentée comme un constat.

### C6. Le rapport mélange les séparateurs décimaux dans une même page

Page 1 du PDF réel, à sept lignes d'intervalle :

- Limites de viabilité : « environ **0.14** ha implantables (**0.31** ha au cadastre) »
- Synthèse : « **0,14** ha implantables (**0,31** ha au cadastre, soit 54 % déduits) »

Les motifs de `evaluerLimitesViabilite` utilisent `toFixed(2)` sans conversion en virgule, alors
que tout le reste du document passe par `formatNombre`. Sur une pièce transmise à un tiers
français, c'est visible.

---

## D. Problèmes secondaires

- **Le champ du jeton s'appelle `token`** dans la réponse de connexion, seul anglicisme d'une API
  intégralement en français (`motDePasse`, `utilisateur`, `filiere`). Sans conséquence, mais
  c'est la première chose que lit un intégrateur.
- **Une parcelle grise affiche un score.** Le PDF réel montre « 51 sur 100 » avec le libellé
  « Données manquantes » et une couverture de 74 %. Les deux informations sont présentes, mais un
  score chiffré à côté d'un statut « insuffisant » invite à retenir le chiffre.
- **`penteMaxPct` retombe sur `pentePct`** quand aucune paire de points n'est distante de plus de
  10 m : sur une petite parcelle, la valeur de contrôle devient la valeur contrôlée, ce qui
  supprime le dernier garde-fou possible sur B1.
- **`avertissementsPourCible` est morte mais son comportement est reproduit en ligne** dans
  `FicheParcelle.tsx:456`, avec une condition supplémentaire sur la portée. Duplication sans
  conséquence fonctionnelle.
- **La vue `v_parcelle_carte`** reste requêtée par aucun code applicatif. Alignée sur le nouveau
  schéma hier, elle demeure du code que rien ne protège.
- **Le limiteur de débit sur la qualification (6/h) est partagé par utilisateur**, alors que le
  quota réellement contraint est celui des sources publiques, qui est global. Deux utilisateurs
  peuvent donc consommer douze campagnes par heure là où la limitation en visait six.

---

## E. Erreurs métier

**E1. Une parcelle plate est présentée comme un terrain à 1 666 % de pente** (B1). Sur les
49 parcelles réelles, sept sont concernées, et le score global perd 8 à 12 points. La plus
touchée passe sous le seuil de propice : elle sort du tri quotidien alors qu'elle est
exploitable. C'est l'erreur métier la plus lourde des quatre audits.

**E2. Un rapport transmis affiche deux pentes contradictoires** (B1). « Pente 205,1 % (max
1,2 %) » dans le même tableau. Un interlocuteur technique — exploitant, géomètre, bureau
d'études — relèvera immédiatement l'incohérence, et la crédibilité de tout le document en
souffre, y compris de ses parties justes.

**E3. Un fichier Shapefile remis à un tiers ne dit pas qu'une parcelle est juridiquement
exclue** (B5). Le destinataire lit `NB_KO = 1` sans savoir si le critère est dérogeable.

**E4. Un lot de qualification partiel est indiscernable d'un lot complet** (B3, B4). Le
prospecteur croit son secteur traité alors qu'un tiers seulement l'a été, et conclut à l'absence
de parcelles intéressantes sur une zone jamais interrogée.

**E5. La surface implantable d'une petite parcelle est amputée de plus de la moitié** (C5), sans
que rien n'indique que le modèle sort de son domaine.

**E6. Les indicateurs dérivés restent des proxies**, tous étiquetés, et désormais documentés
réserve par réserve dans `docs/CALIBRATION.md`. L'étiquetage est honnête. Il ne suffira pas pour
un tiers, qui lira des mesures.

**E7. La méthanisation ne peut produire aucun « go »** tant que les couches d'intrants ne sont
pas ingérées. Comportement voulu, explicite dans l'interface.

---

## F. Risques

| Risque | Origine | Probabilité / gravité |
|---|---|---|
| **Écarter une parcelle exploitable** | pente aberrante (B1) | **certaine** — 14 % des parcelles, mesuré |
| **Perdre sa crédibilité sur un rapport** | deux pentes contradictoires (B1) | **élevée** — visible en première page |
| **Prospecter un secteur cru traité** | lot partiel invisible (B3) | **élevée** dès le premier redémarrage |
| **Voir une demande de qualification disparaître** | file volatile (B4) | **certaine** à chaque redémarrage |
| **Router du trafic vers une instance morte** | santé mensongère (B6) | moyenne, dépend du déploiement |
| **Réveiller une astreinte pour une faute de frappe** | 500 sur entrée client (B2) | élevée, sans gravité |
| **Extraire toute la base en un appel** | `limite` non plafonnée (B2) | faible — accès interne authentifié |
| **Être bloqué au hasard sur une emprise** | seuil flottant (C1) | moyenne, sans perte de données |
| **Surestimer une petite parcelle à l'envers** | érosion hors domaine (C5) | moyenne sous 1 ha |
| **Régression silencieuse** | `core` non testé, `web` à 0,03 (C3) | **élevée** — quatre audits, quatre fois le même constat |

---

## G. Axes d'amélioration, par priorité

| # | Problème | Impact | Difficulté | Priorité |
|---|---|---|---|---|
| 1 | Pente instable, 14 % des parcelles fausses (B1) | **le chiffre principal de l'application est faux** | **faible** — garde relative + borne de vraisemblance | **1** |
| 2 | Corps de requête non validé, 500 sur entrée client (B2) | erreurs illisibles, `limite` non bornée | faible | **1** |
| 3 | Campagne interrompue invisible (B3) | lot partiel pris pour complet | **très faible** — exposer `derniereCampagne` | **1** |
| 4 | Shapefile sans knock-outs bloquants (B5) | pièce remise à un tiers ambiguë | **très faible** — une ligne | **1** |
| 5 | File de qualification volatile (B4) | demandes acceptées perdues | moyenne — persister en base | 2 |
| 6 | Santé mensongère sous configuration fatale (B6) | déploiement vert sur instance morte | faible | 2 |
| 7 | Seuil d'étendue sur frontière flottante (C1) | refus arbitraire | très faible | 2 |
| 8 | Validation d'emprise non appliquée au corps JSON (C2) | plafond d'étendue contourné | faible | 2 |
| 9 | Érosion périmétrale hors domaine sous 1 ha (C5) | surface implantable non crédible | faible | 3 |
| 10 | Séparateur décimal mélangé dans le PDF (C6) | soin du livrable | très faible | 3 |
| 11 | `packages/core` sans aucun test (C3) | le fondement métier n'est pas protégé | moyenne | 3 |
| 12 | Neuf exports morts, trois mécanismes non branchés (C4) | mode de défaillance dominant du projet | faible par cas | 3 |
| 13 | Calibration absolue non établie | classement fin non défendable | dépend de devis réels | 4 |

---

## Note globale : 65 / 100

| Critère | Note | Justification |
|---|---|---|
| Fiabilité des résultats | **54** | rôles étanches, isolement RGPD vérifié, exports exacts, invalidation des scores fonctionnelle ; mais le chiffre mis en avant est faux sur 14 % des parcelles réelles, de trois ordres de grandeur, avec 8 à 12 points de score global et un changement de couleur |
| Qualité technique | **68** | 0 échappatoire de typage, CI avec base PostGIS, 146 tests, migrations idempotentes vérifiées ; mais une garde numérique inopérante depuis l'origine, un corps de requête diffusé sans validation dans le constructeur SQL, et `core` sans test |
| Qualité métier | **70** | reculs réglementaires, contiguïté, tracé/vol d'oiseau alignés partout, régime présumé, chaîne RGPD complète, calibration documentée réserve par réserve ; mais la pente est une erreur métier directe et l'érosion sort de son domaine sur les petites parcelles |
| Ergonomie | **62** | libellés de liste corrigés, bandeau de session corrigé, file visible, lien d'évitement, PDF cohérent ; mais une campagne interrompue n'affiche rien, une demande en file disparaît en silence, une faute de frappe donne « Erreur interne », et la même emprise est acceptée ou refusée au hasard |
| Robustesse | **66** | sauvegarde documentée **et testée par exécution**, purge RGPD branchée et vérifiée, interruption tracée en base, file enchaînée dans un `finally`, PDF résistant à un snapshot vide ; mais file non durable et santé mensongère |
| Professionnalisation | **70** | `CALIBRATION.md` et `SAUVEGARDE.md` sont d'un vrai niveau et vérifiés commande par commande, CI étendue à un service PostGIS, 4 850 lignes de documentation qui expliquent le pourquoi ; mais trois mécanismes écrits et non branchés en deux jours révèlent un problème de méthode, pas de compétence |

**Pourquoi la note baisse d'un point malgré quatorze corrections livrées.** Les quatre
corrections indispensables du troisième audit sont faites et vérifiées, six points importants
aussi. Le logiciel s'est réellement amélioré. Mais cet audit est le premier à avoir comparé les
nombres produits à des parcelles réelles, et il a trouvé, sur le critère qui compte le plus, une
erreur plus grave que toutes celles corrigées. Les notes de fiabilité des trois audits
précédents — 62, puis 62 — étaient **surévaluées**, non par complaisance mais par méthode : on ne
trouve pas une instabilité numérique en lisant du code, on la trouve en regardant des résultats.

Le chiffre de 65 décrit donc un logiciel meilleur qu'hier, mieux connu qu'hier, et dont on sait
désormais que le défaut principal n'était pas là où les trois premiers audits le cherchaient.

---

## Conclusion

> **Cette application est-elle aujourd'hui suffisamment fiable pour être utilisée dans un cadre
> professionnel sans risque majeur d'erreur ?**

**Non — et pour une raison différente des trois fois précédentes.**

Les audits 1 et 2 butaient sur des défauts de conception : une filière inexploitable, un score
de site contournant tous les garde-fous, des chiffres fabriqués. L'audit 3 butait sur de la
finition : des libellés faux, un bandeau mal placé. **Celui-ci bute sur un calcul faux**, et
c'est plus grave, parce que c'est le calcul que l'utilisateur regarde.

La bonne nouvelle est que les quatre corrections de priorité 1 sont toutes petites — la plus
lourde est une ligne de garde numérique et une borne de vraisemblance. La mauvaise est qu'elles
n'auraient jamais été trouvées par les méthodes des trois premiers audits.

**Par usage, en l'état :**

- **Solaire, éolien, stockage à l'échelle de la parcelle : non, plus qu'avant.** Le classement
  est faussé sur une parcelle sur sept, et rien ne signale lesquelles. C'est un recul par rapport
  au verdict du troisième audit — non pas parce que le logiciel a régressé, mais parce que ce
  qu'on en sait a changé.
- **Méthanisation : pour hiérarchiser, oui ; pour décider, non.** Inchangé, explicite dans
  l'interface.
- **À l'échelle du site : oui pour des parcelles jointives**, la contiguïté étant désormais
  mesurée et la dispersion signalée. Sous 1 ha par parcelle, la surface implantable n'est pas
  crédible (C5).
- **Comme pièce transmise à un tiers : non.** Deux raisons précises : un rapport qui affiche deux
  pentes contradictoires (B1) et un Shapefile qui ne dit pas qu'une parcelle est juridiquement
  exclue (B5). Le reste du rapport — structure, fondements légaux datés, traçabilité — est au
  niveau attendu.
- **En exploitation multi-utilisateurs : pas encore.** Une demande en file disparaît à chaque
  redémarrage sans le dire (B4), et une campagne interrompue est invisible (B3).

### Corrections indispensables avant toute utilisation opérationnelle

Les quatre premières lignes du tableau G, toutes de difficulté faible à très faible :

1. **Rendre la garde de pente relative** (`det > ε·sxx·syy` au lieu de `> 1e-6`), **borner la
   pente au vraisemblable** et, quand la régression est mal conditionnée, **retomber sur la
   mesure par paires** — qui est déjà calculée et juste. Puis **rescorer** : la version du moteur
   doit changer, sinon les 14 % de parcelles fausses restent en base.
2. **Valider le corps de la recherche** avant de le passer au SQL : types, bornes, `limite`
   plafonnée, et un 400 explicite au lieu d'un 500.
3. **Exposer `derniereCampagne`** et l'afficher : une campagne interrompue doit se voir, avec son
   décompte.
4. **Ajouter le compteur de knock-outs bloquants au DBF du Shapefile.**

### Ensuite, avant tout usage en équipe

Persister la file de qualification (5), faire dire à `/api/sante` qu'une configuration est
fatale (6), donner une marge au seuil d'étendue (7), et appliquer la validation d'emprise au
corps JSON (8).

### Le point de méthode qui décidera de la suite

**Faire tourner le logiciel sur des données réelles, et regarder les nombres.**

Trois audits ont lu du code, exécuté des tests et fabriqué des fixtures. Ils ont trouvé de vrais
défauts et le logiciel en est nettement meilleur. Mais aucun n'avait qualifié une parcelle réelle
et lu la valeur produite — et le défaut le plus grave était là depuis le début, visible en
première page du premier rapport généré.

Deux conséquences concrètes, plus utiles que d'ajouter des tests unitaires :

- **Une borne de vraisemblance sur chaque grandeur physique du snapshot**, appliquée à
  l'écriture. Une pente de 1 666 %, une altitude négative en Beauce, une distance d'habitation de
  400 km : ces valeurs doivent être refusées ou marquées, pas stockées. Un test unitaire vérifie
  ce qu'on a pensé à vérifier ; une borne de vraisemblance attrape ce qu'on n'a pas imaginé.
- **Une campagne de qualification réelle, sur un secteur connu de l'utilisateur, dont les
  résultats sont relus à la main.** Une demi-journée. C'est le seul contrôle qui aurait trouvé ce
  défaut, et c'est celui qui trouvera le suivant.
