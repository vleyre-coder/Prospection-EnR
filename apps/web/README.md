# Interface cartographique — @enr/web

Application React + MapLibre GL de prospection fonciere ENR.

## Lancer

```bash
npm run dev -w @enr/web        # serveur de developpement sur http://localhost:5173
npm run build -w @enr/web      # build de production dans apps/web/dist
npm run preview -w @enr/web    # previsualisation du build
```

Le serveur de developpement proxifie `/api` vers `http://localhost:3000`. Pour viser une
autre instance : `URL_API=http://127.0.0.1:3010 npm run dev -w @enr/web`.

## Structure

```
src/
├─ api/client.ts          Client typé de l'API interne, erreurs normalisées en ErreurApi
├─ store/etat.ts          État global (Zustand) : filière, couches, pondérations, filtres
├─ utils/geometrie.ts     Distances, surfaces, cercles, formatage français
├─ components/
│  ├─ BarreSuperieure.tsx Sélecteur de filière, recherche unifiée, fond de carte, thème
│  ├─ PanneauGauche.tsx   Légende, filtres par filière, curseurs de pondération, couches
│  ├─ Carte.tsx           MapLibre : tuiles vectorielles, postes sources, dessin, mesure
│  ├─ FicheParcelle.tsx   Fiche exhaustive, traçabilité par critère, prospection, exports
│  ├─ VueListe.tsx        Tableau triable des résultats de filtres, export CSV
│  └─ TableauDeBord.tsx   Portefeuille : compteurs, pipeline, activité (SVG à la main)
├─ styles/global.css      Feuille unique, thèmes clair/sombre, feuille d'impression A4
└─ App.tsx                Assemblage, bandeaux d'avertissement, outils de carte
```

## Fonds de carte

Tuiles WMTS de la Géoplateforme IGN, sans clé d'API :

| Fond | Couche WMTS |
|---|---|
| Plan IGN | `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` (`image/png`) |
| Ortho-photographie | `ORTHOIMAGERY.ORTHOPHOTOS` (`image/jpeg`) |

Les deux emploient `TILEMATRIXSET=PM` et exigent l'attribution « © IGN — Géoplateforme »,
affichée en permanence. Si `data.geopf.fr` est injoignable (réseau restreint, proxy
d'entreprise), un message le signale et **le reste de l'application demeure utilisable** :
parcelles, scores, couches de contraintes et fiches proviennent de l'API interne.

## Deux dimensions visuelles, jamais confondues

- **Score de propice** → remplissage de la parcelle (vert / orange / rouge / gris).
- **État de prospection** → couleur et motif du contour (palette froide).

Le remplissage est calculé par expression de style MapLibre sur l'attribut `statut_score`
de la tuile. Changer de filière ne change que l'URL de la source ; déplacer un curseur de
pondération applique les nouveaux statuts par `setFeatureState`, sans retélécharger les
tuiles.

## Raccourcis clavier

| Touche | Effet |
|---|---|
| `1` à `4` | Changer de filière |
| `Échap` | Fermer la fiche et désactiver l'outil courant |
| `Maj` + clic | Ajouter une parcelle à la sélection (agrégation en site) |

## Impression

`@media print` déplie toutes les rubriques et tous les détails de critères, masque la carte
et les panneaux de navigation, et met la fiche en page sur A4. Le bouton « Imprimer » de la
fiche déclenche `window.print()`.
