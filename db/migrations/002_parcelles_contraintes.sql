-- 002 - Parcelles cadastrales, snapshots d'enrichissement et couches de contraintes.

-- ---------------------------------------------------------------------------
-- Parcelles.
--
-- Strategie d'echelle nationale : les parcelles ne sont PAS pre-ingerees pour la France
-- entiere (environ 100 millions d'objets). Elles sont recuperees a la demande par emprise
-- via l'API Carto Cadastre au-dela du zoom 14, puis mises en cache ici. La vue nationale
-- s'appuie sur la couche communale agregee (voir 004_scoring.sql).
--
-- AVERTISSEMENT : le contour cadastral est indicatif et n'a pas de valeur juridique.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parcelle (
  idu                 varchar(14) PRIMARY KEY,
  code_insee          varchar(5) NOT NULL,
  nom_commune         text,
  code_departement    varchar(3) NOT NULL,
  prefixe             varchar(3) NOT NULL,
  section             varchar(2) NOT NULL,
  numero              varchar(4) NOT NULL,
  -- Contenance cadastrale declarative, en m2.
  contenance_m2       integer,
  -- Surface calculee sur la geometrie projetee en Lambert-93, en m2.
  surface_calculee_m2 numeric(14, 2),
  geom                geometry(MultiPolygon, 4326) NOT NULL,
  centroide           geometry(Point, 4326) NOT NULL,
  -- Date de recuperation depuis l'API Carto (fraicheur du cache).
  date_recuperation   timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcelle_geom ON parcelle USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_parcelle_centroide ON parcelle USING gist (centroide);
CREATE INDEX IF NOT EXISTS idx_parcelle_insee ON parcelle (code_insee);
CREATE INDEX IF NOT EXISTS idx_parcelle_recherche ON parcelle (code_insee, section, numero);
CREATE INDEX IF NOT EXISTS idx_parcelle_date_recup ON parcelle (date_recuperation);

COMMENT ON COLUMN parcelle.geom IS
  'Contour issu du Plan Cadastral Informatise. Indicatif, sans valeur juridique.';

-- ---------------------------------------------------------------------------
-- Snapshot d'enrichissement : resultat consolide de tous les connecteurs pour
-- une parcelle. Stocke en JSONB pour absorber l'evolution du modele sans migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parcelle_snapshot (
  idu             varchar(14) PRIMARY KEY REFERENCES parcelle (idu) ON DELETE CASCADE,
  -- Objet ParcelleSnapshot complet (voir packages/core/src/types.ts).
  snapshot        jsonb NOT NULL,
  -- Connecteurs ayant echoue lors de la constitution du snapshot.
  connecteurs_en_echec text[] NOT NULL DEFAULT '{}',
  -- Part des criteres renseignes, tous connecteurs confondus (0-1).
  couverture      numeric(4, 3),
  date_snapshot   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date ON parcelle_snapshot (date_snapshot);

-- ---------------------------------------------------------------------------
-- Couches de contraintes spatiales.
--
-- Une seule table generique indexee GiST : les couches sont nombreuses, de volumes tres
-- inegaux, et le moteur les interroge toujours de la meme facon (recouvrement + distance).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contrainte (
  id            bigserial PRIMARY KEY,
  -- Type normalise, ex. 'natura2000_habitats', 'znieff1', 'ppri', 'monument_historique'.
  type          text NOT NULL,
  sous_type     text,
  nom           text,
  -- Identifiant d'origine chez le fournisseur (pour les mises a jour incrementales).
  identifiant_source text,
  geom          geometry(Geometry, 4326) NOT NULL,
  -- Attributs bruts du fournisseur, conserves pour la tracabilite.
  attributs     jsonb NOT NULL DEFAULT '{}'::jsonb,
  connecteur    text NOT NULL REFERENCES source_donnee (connecteur),
  -- Millesime / date de la donnee, affichee dans la fiche.
  millesime     text,
  date_donnee   date,
  -- Couverture : une contrainte ingeree departement par departement doit etre tracee.
  code_departement varchar(3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connecteur, type, identifiant_source)
);

CREATE INDEX IF NOT EXISTS idx_contrainte_geom ON contrainte USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_contrainte_type ON contrainte (type);
CREATE INDEX IF NOT EXISTS idx_contrainte_type_geom ON contrainte USING gist (geom) WHERE geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contrainte_dep ON contrainte (code_departement);

COMMENT ON TABLE contrainte IS
  'Couches spatiales de contraintes (environnement, risques, patrimoine, urbanisme local).';

-- ---------------------------------------------------------------------------
-- Couverture d'ingestion par departement : permet de distinguer
-- "aucune contrainte" de "departement non ingere" (GRIS et non VERT).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS couverture_ingestion (
  connecteur       text NOT NULL REFERENCES source_donnee (connecteur),
  type             text NOT NULL,
  code_departement varchar(3) NOT NULL,
  date_ingestion   timestamptz NOT NULL DEFAULT now(),
  nb_objets        integer NOT NULL DEFAULT 0,
  source_document  text,
  PRIMARY KEY (connecteur, type, code_departement)
);

COMMENT ON TABLE couverture_ingestion IS
  'Sait-on quelque chose de ce departement pour cette couche ? Distingue absence de contrainte et absence de donnee.';

-- ---------------------------------------------------------------------------
-- Zones d'acceleration des ENR (ZAER) : ingestion departementale, couverture partielle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zaer (
  id                bigserial PRIMARY KEY,
  code_insee        varchar(5),
  nom_commune       text,
  -- Filieres visees par la deliberation (valeurs de type Filiere).
  filieres          text[] NOT NULL DEFAULT '{}',
  geom              geometry(MultiPolygon, 4326) NOT NULL,
  date_deliberation date,
  source_document   text,
  attributs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zaer_geom ON zaer USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_zaer_insee ON zaer (code_insee);

-- ---------------------------------------------------------------------------
-- Document-cadre departemental pour le photovoltaique au sol (art. L.111-29 CU).
-- Aucune API nationale : ingestion arrete par arrete.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_cadre_pv (
  id               bigserial PRIMARY KEY,
  code_departement varchar(3) NOT NULL,
  date_arrete      date,
  url_arrete       text,
  -- Emprises des terrains listes comme eligibles. Peut etre NULL si le document-cadre
  -- ne procede pas par cartographie mais par criteres litteraux.
  geom             geometry(MultiPolygon, 4326),
  -- Criteres litteraux, lorsque le document-cadre ne cartographie pas.
  criteres_texte   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_cadre_geom ON document_cadre_pv USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_doc_cadre_dep ON document_cadre_pv (code_departement);
