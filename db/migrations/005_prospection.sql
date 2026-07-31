-- 005 - Pipeline de prospection : leads, sites, historique, documents.

-- ---------------------------------------------------------------------------
-- Sites : agregat de parcelles contigues, potentiellement multi-proprietaires,
-- score sur l'ensemble consolide.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom           text NOT NULL,
  filiere       text NOT NULL CHECK (filiere IN ('solaire_sol', 'eolien_terrestre', 'bess', 'methanisation')),
  -- Emprise dessinee par l'utilisateur, ou union des parcelles rattachees.
  geom          geometry(MultiPolygon, 4326),
  commentaire   text,
  score_global  numeric(5, 1),
  statut_score  text CHECK (statut_score IN ('vert', 'orange', 'rouge', 'gris')),
  surface_ha    numeric(12, 3),
  detail_score  jsonb,
  cree_par      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_geom ON site USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_site_filiere ON site (filiere);

CREATE TABLE IF NOT EXISTS site_parcelle (
  site_id uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
  idu     varchar(14) NOT NULL REFERENCES parcelle (idu) ON DELETE CASCADE,
  PRIMARY KEY (site_id, idu)
);

-- ---------------------------------------------------------------------------
-- Leads : etat de prospection d'une parcelle ou d'un site pour une filiere.
--
-- Le statut de prospection est une dimension DISTINCTE du score de propice :
-- il est rendu par le contour et une pastille, jamais par le remplissage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idu         varchar(14) REFERENCES parcelle (idu) ON DELETE CASCADE,
  site_id     uuid REFERENCES site (id) ON DELETE CASCADE,
  filiere     text NOT NULL CHECK (filiere IN ('solaire_sol', 'eolien_terrestre', 'bess', 'methanisation')),
  statut      text NOT NULL DEFAULT 'a_prospecter'
              CHECK (statut IN ('a_prospecter', 'contact_pris', 'en_negociation', 'securise', 'ecarte')),
  notes       text,
  assigne_a   uuid,
  -- Score au moment de la prise en prospection, pour mesurer la derive.
  score_initial numeric(5, 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Un lead porte soit une parcelle, soit un site, jamais les deux ni aucun.
  CONSTRAINT lead_cible_unique CHECK ((idu IS NULL) <> (site_id IS NULL))
);

-- Un seul lead par (parcelle, filiere) et par (site, filiere).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_parcelle_filiere
  ON lead (idu, filiere) WHERE idu IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_site_filiere
  ON lead (site_id, filiere) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_statut ON lead (filiere, statut);
CREATE INDEX IF NOT EXISTS idx_lead_assigne ON lead (assigne_a);

-- ---------------------------------------------------------------------------
-- Historique : chaque changement de statut et chaque contact est horodate et attribue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_evenement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        uuid NOT NULL REFERENCES lead (id) ON DELETE CASCADE,
  date           timestamptz NOT NULL DEFAULT now(),
  type           text NOT NULL CHECK (type IN ('creation', 'changement_statut', 'contact', 'note', 'document')),
  auteur         text NOT NULL,
  ancien_statut  text,
  nouveau_statut text,
  commentaire    text
);

CREATE INDEX IF NOT EXISTS idx_evenement_lead ON lead_evenement (lead_id, date DESC);

-- Journalise automatiquement tout changement de statut.
CREATE OR REPLACE FUNCTION trg_lead_historique()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_evenement (lead_id, type, auteur, nouveau_statut, commentaire)
    VALUES (NEW.id, 'creation', COALESCE(current_setting('app.utilisateur', true), 'systeme'),
            NEW.statut, 'Creation du lead');
  ELSIF TG_OP = 'UPDATE' AND OLD.statut IS DISTINCT FROM NEW.statut THEN
    INSERT INTO lead_evenement (lead_id, type, auteur, ancien_statut, nouveau_statut, commentaire)
    VALUES (NEW.id, 'changement_statut', COALESCE(current_setting('app.utilisateur', true), 'systeme'),
            OLD.statut, NEW.statut, NULL);
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_historique ON lead;
CREATE TRIGGER lead_historique
  AFTER INSERT ON lead
  FOR EACH ROW EXECUTE FUNCTION trg_lead_historique();

DROP TRIGGER IF EXISTS lead_historique_update ON lead;
CREATE TRIGGER lead_historique_update
  BEFORE UPDATE ON lead
  FOR EACH ROW EXECUTE FUNCTION trg_lead_historique();

-- ---------------------------------------------------------------------------
-- Documents joints (courriers, promesses de bail, plans).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES lead (id) ON DELETE CASCADE,
  nom         text NOT NULL,
  chemin      text NOT NULL,
  mime        text,
  taille_octets bigint,
  depose_par  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_lead ON document (lead_id);

-- ---------------------------------------------------------------------------
-- Vue de service des tuiles vectorielles : jointure parcelle + score + statut de prospection.
-- La coloration (remplissage) vient du score, le contour vient du statut de prospection :
-- les deux dimensions restent distinctes cote client.
CREATE OR REPLACE VIEW v_parcelle_carte AS
SELECT
  p.idu,
  p.geom,
  p.code_insee,
  p.nom_commune,
  p.section,
  p.numero,
  COALESCE(p.surface_calculee_m2, p.contenance_m2) AS surface_m2,
  s.filiere,
  s.statut          AS statut_score,
  s.score_global,
  s.couverture_donnees,
  s.nb_knock_outs,
  s.regime_implantation,
  l.statut          AS statut_prospection,
  l.assigne_a
FROM parcelle p
LEFT JOIN score_parcelle_filiere s
  ON s.idu = p.idu AND s.profil_ponderation = 'defaut'
LEFT JOIN lead l
  ON l.idu = p.idu AND l.filiere = s.filiere;
