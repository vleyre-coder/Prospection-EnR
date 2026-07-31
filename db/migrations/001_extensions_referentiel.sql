-- 001 - Extensions, schemas et referentiel des sources de donnees.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Referentiel des sources : porte la FRAICHEUR de chaque source, exigence de
-- tracabilite du cahier des charges. Une source perimee doit declencher une alerte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_donnee (
  connecteur            text PRIMARY KEY,
  nom                   text NOT NULL,
  url                   text,
  -- 'api' : interrogeable en temps reel ; 'ingestion' : necessite un job batch.
  mode_acces            text NOT NULL CHECK (mode_acces IN ('api', 'ingestion', 'manuel')),
  -- Millesime de la donnee (ex. '2023' pour le RPG 2023).
  millesime             text,
  -- Date de mise a jour connue cote fournisseur.
  date_maj_source       date,
  -- Date de la derniere ingestion / du dernier rafraichissement reussi.
  date_derniere_ingestion timestamptz,
  -- Periodicite attendue, en jours. Au-dela, la source est consideree perimee.
  periodicite_jours     integer,
  -- Valeur juridique de la donnee, affichee dans la fiche.
  valeur_juridique      text NOT NULL DEFAULT 'indicative'
                        CHECK (valeur_juridique IN ('opposable', 'indicative', 'pre_reperage')),
  -- Couverture geographique : 'nationale', 'departementale', 'partielle'.
  couverture            text NOT NULL DEFAULT 'nationale',
  avertissement         text,
  dernier_statut        text CHECK (dernier_statut IN ('ok', 'echec', 'partiel')),
  dernier_message       text,
  nb_enregistrements    bigint
);

COMMENT ON TABLE source_donnee IS
  'Registre de tracabilite et de fraicheur des sources. Alimente le bandeau d''alerte de peremption.';

-- Vue de supervision : quelles sources sont perimees ?
CREATE OR REPLACE VIEW v_source_fraicheur AS
SELECT
  connecteur,
  nom,
  mode_acces,
  millesime,
  date_derniere_ingestion,
  periodicite_jours,
  couverture,
  dernier_statut,
  CASE
    WHEN mode_acces = 'api' THEN false
    WHEN date_derniere_ingestion IS NULL THEN true
    WHEN periodicite_jours IS NULL THEN false
    ELSE date_derniere_ingestion < now() - (periodicite_jours || ' days')::interval
  END AS perimee,
  CASE
    WHEN date_derniere_ingestion IS NULL THEN NULL
    ELSE EXTRACT(day FROM now() - date_derniere_ingestion)::integer
  END AS age_jours
FROM source_donnee;

-- ---------------------------------------------------------------------------
-- Communes : socle de la vue nationale agregee.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commune (
  code_insee       varchar(5) PRIMARY KEY,
  nom              text NOT NULL,
  code_departement varchar(3) NOT NULL,
  code_region      varchar(2),
  code_epci        varchar(9),
  nom_epci         text,
  population       integer,
  surface_ha       numeric(12, 2),
  geom             geometry(MultiPolygon, 4326),
  centroide        geometry(Point, 4326),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commune_geom ON commune USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_commune_centroide ON commune USING gist (centroide);
CREATE INDEX IF NOT EXISTS idx_commune_dep ON commune (code_departement);
CREATE INDEX IF NOT EXISTS idx_commune_nom ON commune USING gin (to_tsvector('french', nom));
