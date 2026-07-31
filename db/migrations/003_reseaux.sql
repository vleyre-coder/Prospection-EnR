-- 003 - Reseaux : postes sources electriques et reseau gaz.

-- ---------------------------------------------------------------------------
-- Postes sources RTE / Enedis / autres GRD.
--
-- AVERTISSEMENT : les capacites d'accueil issues de Capareseau et des donnees ouvertes
-- des gestionnaires sont INDICATIVES et NON ENGAGEANTES. Seule une etude de raccordement
-- puis une proposition technique et financiere engagent une capacite.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poste_source (
  id                      text PRIMARY KEY,
  nom                     text NOT NULL,
  gestionnaire            text NOT NULL CHECK (gestionnaire IN ('RTE', 'Enedis', 'autre_grd')),
  -- Ex. '63 kV / 20 kV'.
  tension                 text,
  code_insee              varchar(5),
  nom_commune             text,
  code_departement        varchar(3),
  geom                    geometry(Point, 4326) NOT NULL,
  -- Capacite d'accueil residuelle publiee, en MW.
  capacite_residuelle_mw  numeric(10, 3),
  -- Capacite reservee au titre du S3REnR, en MW.
  capacite_s3renr_mw      numeric(10, 3),
  etat_saturation         text CHECK (etat_saturation IN ('disponible', 'tendu', 'sature')),
  -- Puissance des projets en file d'attente, en MW.
  file_attente_mw         numeric(10, 3),
  -- Quote-part du schema regional, en EUR/kW.
  quote_part_eur_par_kw   numeric(10, 2),
  -- Renforcement / creation inscrit au S3REnR.
  renforcement_prevu      boolean NOT NULL DEFAULT false,
  renforcement_horizon    text,
  renforcement_capacite_mw numeric(10, 3),
  -- Poste en projet, non encore en service.
  en_projet               boolean NOT NULL DEFAULT false,
  connecteur              text REFERENCES source_donnee (connecteur),
  date_donnee             date,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poste_geom ON poste_source USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_poste_etat ON poste_source (etat_saturation);
CREATE INDEX IF NOT EXISTS idx_poste_dep ON poste_source (code_departement);
CREATE INDEX IF NOT EXISTS idx_poste_nom ON poste_source USING gin (to_tsvector('french', nom));

COMMENT ON COLUMN poste_source.capacite_residuelle_mw IS
  'Capacite indicative issue de Capareseau / open data gestionnaires. Non engageante.';

-- Etat de saturation derive lorsqu''il n''est pas publie explicitement.
-- Seuils par defaut, parametrables au niveau applicatif.
CREATE OR REPLACE FUNCTION deduire_etat_saturation(capacite_mw numeric)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN capacite_mw IS NULL THEN NULL
    WHEN capacite_mw <= 0 THEN 'sature'
    WHEN capacite_mw < 10 THEN 'tendu'
    ELSE 'disponible'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Reseau gaz : points d'injection biomethane et canalisations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS point_injection_gaz (
  id                    text PRIMARY KEY,
  nom                   text,
  gestionnaire          text CHECK (gestionnaire IN ('GRDF', 'GRTgaz', 'Terega', 'autre')),
  code_insee            varchar(5),
  code_departement      varchar(3),
  geom                  geometry(Point, 4326) NOT NULL,
  -- Capacite d'injection disponible, en Nm3/h.
  capacite_nm3h         numeric(10, 2),
  -- Le raccordement necessite-t-il un poste de rebours ?
  rebours_necessaire    boolean,
  -- Zonage de raccordement (droit a l'injection).
  zonage_raccordement   text,
  connecteur            text REFERENCES source_donnee (connecteur),
  date_donnee           date,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_injection_geom ON point_injection_gaz USING gist (geom);

CREATE TABLE IF NOT EXISTS canalisation_gaz (
  id            bigserial PRIMARY KEY,
  gestionnaire  text,
  -- 'transport' (GRTgaz/Terega) ou 'distribution' (GRDF).
  niveau        text CHECK (niveau IN ('transport', 'distribution')),
  diametre_mm   integer,
  geom          geometry(MultiLineString, 4326) NOT NULL,
  connecteur    text REFERENCES source_donnee (connecteur),
  date_donnee   date
);

CREATE INDEX IF NOT EXISTS idx_canalisation_geom ON canalisation_gaz USING gist (geom);
