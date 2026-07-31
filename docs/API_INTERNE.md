# API interne — contrat REST

Base : `/api`. Toutes les reponses sont en JSON UTF-8, sauf les tuiles vectorielles
(`application/vnd.mapbox-vector-tile`) et les exports (PDF, CSV, GeoJSON, Shapefile zip).

Authentification : `Authorization: Bearer <jwt>`. En developpement, `AUTH_DESACTIVEE=true`
injecte un utilisateur `admin` fictif pour toutes les requetes.

Erreurs : `{ "erreur": { "code": string, "message": string, "details"?: unknown } }`
avec les statuts HTTP usuels (400, 401, 403, 404, 422, 429, 502, 504).

---

## 1. Referentiel et sante

### `GET /api/sante`
```json
{
  "statut": "ok",
  "version": "0.1.0",
  "versionMoteur": "1.0.0",
  "baseDeDonnees": "ok",
  "sources": [
    { "connecteur": "apicarto_cadastre", "nom": "...", "modeAcces": "api",
      "perimee": false, "ageJours": null, "dernierStatut": "ok", "couverture": "nationale" }
  ],
  "sourcesPerimees": ["zaer_local"]
}
```

### `GET /api/referentiel`
Renvoie tout ce dont le frontend a besoin pour s'initialiser (aucun secret) :
```json
{
  "filieres": [ { "id": "solaire_sol", "libelle": "...", "critereRoi": "...", "icone": "sun",
                  "surfaceUtileMinHa": 1, "gisementPertinent": true, "couchesParDefaut": ["..."] } ],
  "criteres": { "racc_distance_poste": { "id": "...", "libelle": "...", "famille": "raccordement",
                                          "explication": "...", "unite": "km" } },
  "famillesLibelles": { "raccordement": "Raccordement" },
  "ponderationsDefaut": { "solaire_sol": { "filiere": "...", "poids": {}, "seuilVert": 65,
                                            "seuilOrange": 40, "seuilCouvertureDonnees": 0.5 } },
  "reglementation": { "solaire_sol": { "permis_construire": { "id": "...", "libelle": "...",
      "valeur": 3, "unite": "MWc", "reference": "...", "dateEntreeEnVigueur": "2023-12-10",
      "url": "...", "commentaire": "...", "instable": true } } },
  "referentielDerniereVerification": "2026-07-30",
  "avertissements": [ { "id": "aide_decision", "portee": "global", "niveau": "attention",
                        "titre": "...", "texte": "...", "cible": ["..."] } ],
  "palette": { "couleursScore": {}, "couleursScoreRemplissage": {}, "libellesScore": {},
               "descriptionsScore": {}, "couleursSaturation": {}, "libellesSaturation": {} },
  "statutsProspection": [ { "id": "a_prospecter", "libelle": "A prospecter",
                            "couleur": "#94a3b8", "motif": "aucun", "ordre": 0 } ],
  "couches": [ { "id": "natura2000_habitats", "libelle": "Natura 2000 - habitats",
                 "groupe": "environnement", "typeGeom": "polygone", "couleur": "#..." } ]
}
```

---

## 2. Carte

### `GET /api/carte/tuiles/parcelles/{z}/{x}/{y}.mvt?filiere=<f>&profil=defaut`
Tuile vectorielle des parcelles, disponible a partir du zoom **14**. Couche MVT nommee
`parcelles`. Attributs par entite :
`idu`, `section`, `numero`, `surface_m2`, `statut_score` (`vert|orange|rouge|gris`),
`score_global` (nombre ou null), `couverture_donnees`, `nb_knock_outs`,
`statut_prospection` (ou null), `regime_implantation`.
La coloration est faite **cote client** par expression de style, pour recolorer
instantanement au changement de filiere ou de ponderation.

En dessous du zoom 14, la reponse est `204 No Content` : utiliser la couche communale.

### `GET /api/carte/tuiles/communes/{z}/{x}/{y}.mvt?filiere=<f>`
Couche MVT `communes`, servie du zoom 5 au zoom 13. Attributs : `code_insee`, `nom`,
`potentiel` (0-100 ou null), `statut`, `surface_propice_ha`, `nb_parcelles_qualifiees`,
`nb_vert`, `nb_orange`, `nb_rouge`, `nb_gris`.

### `GET /api/carte/parcelles?bbox=minLon,minLat,maxLon,maxLat&filiere=<f>&limite=2000`
Meme contenu en GeoJSON (utile pour le debug, les tests et les exports d'emprise).
Declenche la recuperation a la demande des parcelles absentes du cache si
`qualifier=true` est passe (voir §4).

### `GET /api/carte/postes-sources?bbox=&rayonKm=5&gestionnaire=&etat=`
```json
{ "type": "FeatureCollection", "features": [
  { "type": "Feature", "geometry": { "type": "Point", "coordinates": [2.1, 48.3] },
    "properties": { "id": "PS-...", "nom": "Poste de Janville", "gestionnaire": "Enedis",
      "tension": "63 kV / 20 kV", "capaciteResiduelleMw": 32, "etatSaturation": "disponible",
      "fileAttenteMw": 8, "quotePartEurParKw": 45, "enProjet": false,
      "renforcement": { "prevu": false, "horizon": null, "capaciteAttendueMw": null },
      "dateDonnee": "2026-06-01", "source": "opendata_reseaux" } }
] }
```
`rayonKm` ajoute une seconde FeatureCollection dans `rayons` : cercles de raccordement
economique indicatif autour de chaque poste.

### `GET /api/carte/reseau-gaz?bbox=`
`{ "pointsInjection": FeatureCollection, "canalisations": FeatureCollection }`

### `GET /api/carte/couche/:type?bbox=&limite=`
Couche de contraintes generique en GeoJSON. `:type` parmi les `couches[].id` du referentiel.
Chaque feature porte `nom`, `type`, `sousType`, `millesime`, `source`.

---

## 3. Fiche parcelle

### `GET /api/parcelles/:idu?filiere=<f>&rafraichir=false`
```json
{
  "parcelle": { "idu": "283900000C0843", "codeInsee": "28390", "nomCommune": "...",
                "section": "0C", "numero": "0843", "contenanceM2": 852,
                "surfaceCalculeeM2": 851.3, "geometrie": { "type": "MultiPolygon", "...": [] },
                "centroide": [1.75, 48.15], "dateRecuperation": "2026-07-30T..." },
  "snapshot": { "identite": {}, "urbanisme": {}, "occupationSol": {}, "topographie": {},
                "eau": {}, "milieux": {}, "patrimoine": {}, "risques": {}, "raccordement": {},
                "gisement": {}, "bati": {}, "acces": {}, "foncier": {}, "sources": {},
                "dateSnapshot": "..." },
  "score": { "idu": "...", "filiere": "solaire_sol", "statut": "vert", "scoreGlobal": 72.4,
             "knockOuts": [], "criteres": [], "pointsForts": [], "pointsVigilance": [],
             "seuilsProcedure": [], "couvertureDonnees": 0.93, "regimeImplantation": "agrivoltaisme",
             "ponderationsAppliquees": {}, "versionMoteur": "1.0.0", "dateCalcul": "...",
             "avertissements": [] },
  "lead": { "id": "...", "statut": "contact_pris", "notes": "...", "historique": [] } | null,
  "connecteursEnEchec": ["zonesHumides"]
}
```
`rafraichir=true` force la re-interrogation de tous les connecteurs (ignore le cache).

### `POST /api/parcelles/:idu/score`
Recalcul a la volee avec des ponderations modifiees (curseurs). N'ecrit pas en base.
```json
{ "filiere": "solaire_sol",
  "ponderation": { "poids": { "racc_distance_poste": 25 }, "seuilVert": 70 },
  "options": { "knockOutsDesactives": [], "puissanceEnvisageeMw": 8, "tonnageEnvisageTj": null } }
```
Reponse : objet `ResultatScore`.

### `POST /api/parcelles/scores`
Recalcul par lot pour une liste d'IDU (recoloration de la carte apres deplacement de
curseurs). Corps : `{ "idus": [...], "filiere": "...", "ponderation": {...} }`.
Reponse : `{ "scores": { "<idu>": { "statut": "vert", "scoreGlobal": 72.4 } } }`.

### `GET /api/parcelles/:idu/proprietaire`
Reserve aux utilisateurs habilites. Exige un en-tete `X-Motif-Acces`. Chaque appel est
journalise. Reponse : `{ "nbComptes": 1, "indivision": false, "proprietairePublic": false,
"nominatif": null | {...}, "avertissement": "..." }`.

---

## 4. Qualification a la demande

### `POST /api/qualification/emprise`
Recupere les parcelles d'une emprise depuis l'API Carto, les enrichit et les score.
```json
{ "bbox": [1.74, 48.14, 1.76, 48.16], "filiere": "solaire_sol", "surfaceMinM2": 10000 }
```
Reponse : `{ "nbParcelles": 42, "nbEnrichies": 42, "nbEchecs": 0, "duree_ms": 8123 }`.
Operation potentiellement longue : le frontend affiche une progression et re-interroge
les tuiles a la fin.

### `POST /api/qualification/parcelles`
Meme chose pour une liste d'IDU explicite.

---

## 5. Filtres et liste

### `POST /api/recherche/parcelles`
Filtres parametrables par filiere (§F7 du cahier des charges).
```json
{
  "filiere": "solaire_sol",
  "emprise": { "bbox": [..] } ,
  "surfaceMinHa": 5, "surfaceMaxHa": 60,
  "distancePosteMaxKm": 8,
  "capacitePosteMinMw": 5,
  "pentemaxPct": 10,
  "statutsScore": ["vert", "orange"],
  "statutsProspection": ["a_prospecter"],
  "scoreMin": 60,
  "exclureNatura2000": true,
  "exclureZoneHumide": true,
  "exclureAop": true,
  "typesSol": ["degrade", "inculte"],
  "codeDepartement": "28",
  "tri": "score_desc",
  "limite": 200, "decalage": 0
}
```
Reponse : `{ "total": 137, "resultats": [ { "idu", "nomCommune", "section", "numero",
"surfaceHa", "statutScore", "scoreGlobal", "statutProspection", "distancePosteKm",
"pentePct", "typeSol", "centroide" } ] }`.

---

## 6. Pipeline de prospection

- `GET /api/leads?filiere=&statut=&assigneA=&limite=` → `{ "total", "resultats": [Lead] }`
- `POST /api/leads` → corps `{ "idu"|"siteId", "filiere", "statut", "notes" }` → `Lead`
- `GET /api/leads/:id` → `Lead` avec `historique`
- `PATCH /api/leads/:id` → `{ "statut"?, "notes"?, "assigneA"? }` → `Lead`
- `POST /api/leads/:id/evenements` → `{ "type": "contact"|"note", "commentaire" }`
- `DELETE /api/leads/:id`
- `GET /api/tableau-de-bord?filiere=` → compteurs par statut, surface securisee,
  evolution sur 12 mois.

## 7. Sites (agregation de parcelles)

- `POST /api/sites` → `{ "nom", "filiere", "idus": [...] }` ou `{ "nom", "filiere", "geometrie": Polygon }`
  → cree le site, rattache les parcelles intersectees, calcule le score consolide.
- `GET /api/sites?filiere=` / `GET /api/sites/:id` / `PATCH /api/sites/:id` / `DELETE /api/sites/:id`
- `GET /api/sites/:id/score?filiere=` → score consolide + score de chaque parcelle.

## 8. Recherche

### `GET /api/recherche?q=<texte>&limite=10`
Recherche unifiee. Detecte automatiquement le type de saisie :
- IDU 14 caracteres → parcelle ;
- `commune section numero` (ex. `28390 0C 843`) → parcelle ;
- coordonnees `48.15, 1.75` ou `1.75 48.15` → point ;
- sinon → adresse (api-adresse.data.gouv.fr) et commune (geo.api.gouv.fr).
```json
{ "resultats": [ { "type": "parcelle"|"adresse"|"commune"|"coordonnees"|"poste_source",
  "libelle": "...", "sousTitre": "...", "centroide": [lon, lat],
  "bbox": [minLon, minLat, maxLon, maxLat] | null, "idu": "..." | null,
  "codeInsee": "..." | null } ] }
```

## 9. Exports

- `GET /api/exports/parcelle/:idu.pdf?filiere=` → fiche parcelle imprimable (PDF).
- `POST /api/exports/geojson` → `{ "idus": [...], "filiere": "..." }` → GeoJSON.
- `POST /api/exports/shapefile` → meme corps → archive ZIP.
- `POST /api/exports/csv` → meme corps que `/api/recherche/parcelles` → CSV point-virgule,
  encodage UTF-8 avec BOM (compatible Excel FR).

Tout export est journalise (`journal_acces`).

## 10. Ponderations et filtres sauvegardes

- `GET /api/ponderations?filiere=` → profils par defaut + profils enregistres.
- `POST /api/ponderations` → `{ "nom", "filiere", "poids", "seuilVert", "seuilOrange", "partage" }`
- `DELETE /api/ponderations/:id`
- `GET|POST|DELETE /api/filtres`

## 11. Authentification

- `POST /api/auth/connexion` → `{ "email", "motDePasse" }` → `{ "token", "utilisateur" }`
- `GET /api/auth/moi` → `{ "id", "email", "nom", "role", "habiliteDonneesProprietaires" }`

## 12. Administration (role `admin`)

- `GET /api/admin/ingestions` → etat et historique des jobs.
- `POST /api/admin/ingestions/:connecteur` → declenche un rafraichissement.
- `POST /api/admin/rescorer` → `{ "filiere"?: "...", "toutes": true }` → recalcul par batch.
- `GET /api/admin/journal?limite=` → journal d'acces.
