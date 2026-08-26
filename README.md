# Prospection EnR

Application web de **prospection foncière** pour développeurs de projets d'énergies
renouvelables en France. L'utilisateur choisit une filière ; la carte colore les parcelles
selon un score de propice explicable, signale l'état de saturation des postes sources, et
fournit au clic une fiche de qualification exhaustive et traçable.

**Objectif : identifier et prioriser, filière par filière, les parcelles à démarcher en
prenant le moins de risque possible** — réglementaire, environnemental, technique et de
raccordement.

## Filières couvertes

| Filière | Critère déterminant |
|---|---|
| Solaire au sol / agrivoltaïsme | régime d'implantation (dégradé / inculte / agricole) et irradiation |
| Éolien terrestre | éloignement de l'habitat (500 m minimum) et gisement de vent |
| Stockage par batteries (BESS) | distance et capacité résiduelle du poste source |
| Méthanisation | densité d'intrants et débouché (injection ou épandage) |

Le changement de filière recolore instantanément la carte et adapte critères, couches et
filtres.

## Ce que fait l'application

- **Carte de France interactive** : plan IGN et ortho-photographie commutables, du niveau
  national jusqu'à la parcelle cadastrale.
- **Coloration par score** : vert (propice), orange (sous conditions), rouge (rédhibitoire),
  **gris (données manquantes)** — avec une légende permanente.
- **Postes sources** : les 3 119 postes français, symbole distinct par gestionnaire, couleur
  selon la saturation, capacité résiduelle, file d'attente, quote-part S3REnR, travaux
  programmés, et rayon de raccordement économique paramétrable.
- **Fiche parcelle exhaustive** : identité, urbanisme, occupation du sol, topographie, eau et
  zones humides, milieux naturels, patrimoine, risques, raccordement, foncier — avec un feu
  tricolore par critère et, au clic, la **source, son millésime, sa date d'interrogation et sa
  valeur juridique**.
- **Pipeline de prospection** : statut, notes, historique horodaté, agrégation de parcelles en
  sites avec score consolidé.
- **Filtres paramétrables** par filière, vue liste triable, tableau de bord de portefeuille.
- **Exports** : fiche PDF, GeoJSON, Shapefile, CSV.
- **Dessin et mesure** : périmètre, distance, surface, création de site.

## Démarrage

### Sur Windows, sans Docker ni Git — voie recommandée

1. installer **[Node.js](https://nodejs.org/fr/download)** (Suivant jusqu'au bout) ;
2. installer **[PostgreSQL](https://www.postgresql.org/download/windows/)** en cochant
   **PostGIS** dans le Stack Builder, à la fin de l'installation ;
3. sur cette page GitHub : bouton vert **`< > Code` → Download ZIP**, extraire, puis
   **déplacer le dossier en `C:\Prospection_EnR`** — un `&` ou un chemin trop long dans
   l'emplacement fait échouer la compilation ;
4. double-cliquer sur **`demarrer.bat`**.

Le navigateur s'ouvre sur <http://localhost:3000>. Marche à suivre détaillée, écran par
écran : **[docs/WINDOWS.md](docs/WINDOWS.md)**.

### Avec Docker, si vous l'avez déjà

Aucune autre installation — ni Node, ni PostgreSQL.

```bash
git clone https://github.com/Llegender/Prospection_EnR.git
cd Prospection_EnR
./demarrer.sh          # sous Windows : .\demarrer.ps1
```

L'application s'ouvre sur <http://localhost:8080>. Le mot de passe administrateur généré
s'affiche avec `./demarrer.sh --journaux` ; pour choisir vos identifiants, renseignez
`ADMIN_EMAIL` et `ADMIN_MOT_DE_PASSE` dans `.env` avant le premier lancement.

| | |
|---|---|
| Suivre le chargement | `./demarrer.sh --journaux` |
| État de l'installation | `./demarrer.sh --etat` |
| Arrêter (sans rien perdre) | `./demarrer.sh --arreter` |
| Repartir de zéro | `./demarrer.sh --effacer` |

### Sur macOS ou Linux, sans Docker

Node.js 20+ et PostgreSQL avec PostGIS ([Postgres.app](https://postgresapp.com) l'inclut),
puis `./demarrer-sans-docker.sh`.

### Dans tous les cas

Au premier lancement, l'application applique son schéma, crée son compte administrateur et
charge les données nationales — 35 000 communes, 3 119 postes sources, 43 873 monuments,
gisement de vent — **en arrière-plan** : l'interface est utilisable immédiatement et affiche
l'avancement.

Puis : choisir une filière, rechercher une commune, zoomer au niveau 14, cliquer sur
**Qualifier l'emprise**, et cliquer sur une parcelle.

Dépannage : [docs/INSTALLATION.md](docs/INSTALLATION.md). Mise en ligne pour un accès à
plusieurs : [docs/HEBERGEMENT.md](docs/HEBERGEMENT.md) — dont, si l'interface est publiée sur
Netlify, le **portail d'accès** qui la ferme au public
([§6](docs/HEBERGEMENT.md#6-sécuriser-laccès-au-site-publié-sur-netlify)). Ce portail protège
l'interface ; ce sont les comptes et les jetons de l'API qui protègent les données.

## Données

Toutes les données proviennent d'**API et jeux ouverts officiels français**, sans clé d'API :
IGN API Carto (cadastre, GPU, RPG), WFS Géoplateforme (BD TOPO, BD Forêt, AOC INAO, zones
humides), INPN, Géorisques, RGE ALTI, Capareseau, PVGIS, geo.api.gouv.fr.

Les contrats techniques ont été **vérifiés endpoint par endpoint** :
[docs/API_CONTRACTS.md](docs/API_CONTRACTS.md). La nature, les limites et les manques de chaque
source : [docs/SOURCES_DONNEES.md](docs/SOURCES_DONNEES.md).

S'y ajoutent le **Global Wind Atlas** pour le gisement de vent (raster national à 250 m) et
les **servitudes d'utilité publique du GPU** (captages `AS1`, aéronautique `T4`/`T5`,
radioélectrique `PT1`-`PT3`, réseaux `I3`/`I4`).

Trois couches n'ont **aucune source nationale réutilisable** : ZAER et documents-cadres
départementaux PV au sol (délibérations et arrêtés, à ingérer territoire par territoire),
densité d'intrants méthanisables, et positions des radars météorologiques. En leur absence les
critères correspondants restent **gris**, jamais favorables.

## Architecture

Monorepo npm workspaces.

```
packages/core       Référentiel partagé : filières, 46 critères, réglementation datée,
                    avertissements, palette, modèle ParcelleSnapshot (tout nullable)
packages/scoring    Moteur de scoring explicable — fonction pure, 19 tests
apps/api            Fastify · 11 connecteurs · tuiles vectorielles PostGIS · exports
apps/web            React 18 + MapLibre GL
db/migrations       PostgreSQL + PostGIS
```

À l'échelle nationale, les parcelles ne sont **pas** pré-ingérées : la carte sert une
choroplèthe communale sous le zoom 14, et les parcelles sont qualifiées à la demande au-delà,
puis mises en cache avec leurs scores. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Le moteur de scoring et ses règles par filière : [docs/SCORING.md](docs/SCORING.md).
Le contrat de l'API interne : [docs/API_INTERNE.md](docs/API_INTERNE.md).
La procédure de rafraîchissement : [docs/RAFRAICHISSEMENT.md](docs/RAFRAICHISSEMENT.md).

## Avertissements — à lire avant tout usage

Ces avertissements sont affichés dans l'application, dans les fiches PDF et dans les exports.
Ils ne sont pas des précautions de style :

1. **Les résultats sont une aide à la décision, pas une garantie de faisabilité.** Chaque
   donnée doit être re-vérifiée au moment du dépôt du dossier et à l'échelon départemental,
   auprès des services instructeurs.
2. **Le contour cadastral n'a pas de valeur juridique.** Seul un document d'arpentage établi
   par un géomètre-expert fait foi.
3. **Les seuils réglementaires évoluent** — les seuils solaires ont changé deux fois en deux
   ans. Chaque seuil affiché porte sa date d'entrée en vigueur et la date de dernière
   vérification du référentiel.
4. **Les capacités de raccordement Capareseau sont indicatives et non engageantes** tant qu'une
   étude de raccordement, puis une proposition technique et financière du gestionnaire, n'ont
   pas confirmé une capacité.
5. **Une zone humide ou une espèce protégée doit être confirmée par étude de terrain**
   (sondages pédologiques, inventaires sur un cycle biologique complet). La donnée
   cartographique n'est qu'un pré-repérage.
6. **L'absence de donnée ne vaut pas absence de contrainte.** Un critère gris signifie que
   l'application ne sait pas, et rien de plus.

## Données personnelles

Les données de propriétaires sont isolées dans une table dédiée, soumises à habilitation
explicite, à un motif d'accès obligatoire et à une journalisation stricte : si la trace ne peut
pas être écrite, l'accès est refusé. Elles ne sont jamais servies dans les tuiles vectorielles
ni dans les exports non habilités, et une fonction de purge applique les durées de
conservation. Aucune API publique n'expose légalement ces données : elles ne peuvent provenir
que d'une demande documentée auprès de la DGFiP ou de la mairie.

## Tests et vérifications

```bash
npm run typecheck     # tous les paquets
npm run test          # moteur de scoring (19 tests)
npm run build         # y compris le build de production du frontend
```

Le moteur a été validé sur données réelles : parcelles de la Beauce (Eure-et-Loir) et de la
plaine du Rhône (Gard) qualifiées via les API officielles, 3 119 postes sources ingérés depuis
Capareseau, exports PDF et Shapefile contrôlés structurellement, interface vérifiée dans
Chromium.
