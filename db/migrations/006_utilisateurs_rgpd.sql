-- 006 - Utilisateurs, roles, profils de ponderation et journalisation RGPD.

CREATE TABLE IF NOT EXISTS utilisateur (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  nom               text NOT NULL,
  mot_de_passe_hash text NOT NULL,
  role              text NOT NULL DEFAULT 'lecture'
                    CHECK (role IN ('admin', 'prospection', 'lecture')),
  -- Habilitation explicite a consulter les donnees nominatives de proprietaires (RGPD).
  habilite_donnees_proprietaires boolean NOT NULL DEFAULT false,
  actif             boolean NOT NULL DEFAULT true,
  derniere_connexion timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN utilisateur.role IS
  'admin : gestion des utilisateurs et des ingestions. prospection : ecriture sur les leads. lecture : consultation seule.';

-- ---------------------------------------------------------------------------
-- Profils de ponderation enregistres par l'utilisateur (curseurs).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profil_ponderation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             text NOT NULL,
  filiere         text NOT NULL CHECK (filiere IN ('solaire_sol', 'eolien_terrestre', 'bess', 'methanisation')),
  utilisateur_id  uuid REFERENCES utilisateur (id) ON DELETE CASCADE,
  -- true : profil partage a toute l'equipe.
  partage         boolean NOT NULL DEFAULT false,
  poids           jsonb NOT NULL,
  seuil_vert      numeric(5, 1) NOT NULL DEFAULT 65,
  seuil_orange    numeric(5, 1) NOT NULL DEFAULT 40,
  seuil_couverture numeric(4, 3) NOT NULL DEFAULT 0.5,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (utilisateur_id, filiere, nom)
);

-- ---------------------------------------------------------------------------
-- Donnees de proprietaires : table isolee, acces restreint et journalise.
--
-- RGPD : minimisation (on ne stocke que ce qui est necessaire a la prospection),
-- base legale = interet legitime du responsable de traitement, duree de conservation
-- limitee, aucune diffusion publique. Les donnees nominatives ne sont JAMAIS servies
-- dans les tuiles vectorielles ni dans les exports non habilites.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proprietaire_parcelle (
  idu                varchar(14) PRIMARY KEY REFERENCES parcelle (idu) ON DELETE CASCADE,
  -- Nombre de comptes cadastraux distincts (donnee non nominative).
  nb_comptes         integer,
  indivision         boolean,
  proprietaire_public boolean,
  -- Donnees nominatives, alimentees uniquement sur demande documentee (DGFiP / mairie).
  -- Restent NULL par defaut : aucune API publique ne les expose legalement.
  nominatif          jsonb,
  origine_donnee     text,
  -- Date au-dela de laquelle la donnee nominative doit etre purgee.
  purge_prevue_le    date,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN proprietaire_parcelle.nominatif IS
  'Donnees a caractere personnel. Acces reserve aux utilisateurs habilites, consultation journalisee.';

-- ---------------------------------------------------------------------------
-- Journal d'acces : trace toute consultation de donnee nominative et toute
-- action sensible (export, modification de statut, desactivation de knock-out).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_acces (
  id             bigserial PRIMARY KEY,
  date           timestamptz NOT NULL DEFAULT now(),
  utilisateur_id uuid REFERENCES utilisateur (id) ON DELETE SET NULL,
  email          text,
  action         text NOT NULL,
  cible          text,
  -- Motif declare par l'utilisateur pour l'acces aux donnees nominatives.
  motif          text,
  adresse_ip     inet,
  user_agent     text,
  details        jsonb
);

CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_acces (date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_utilisateur ON journal_acces (utilisateur_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_action ON journal_acces (action);

-- Purge automatique des donnees nominatives arrivees a echeance.
CREATE OR REPLACE FUNCTION purger_donnees_nominatives()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  nb integer;
BEGIN
  UPDATE proprietaire_parcelle
     SET nominatif = NULL, purge_prevue_le = NULL, updated_at = now()
   WHERE purge_prevue_le IS NOT NULL
     AND purge_prevue_le <= current_date
     AND nominatif IS NOT NULL;
  GET DIAGNOSTICS nb = ROW_COUNT;
  INSERT INTO journal_acces (action, cible, details)
  VALUES ('purge_rgpd', 'proprietaire_parcelle', jsonb_build_object('lignes_purgees', nb));
  RETURN nb;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recherches et exports sauvegardes (filtres parametrables par filiere).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filtre_sauvegarde (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom            text NOT NULL,
  filiere        text NOT NULL,
  utilisateur_id uuid REFERENCES utilisateur (id) ON DELETE CASCADE,
  criteres       jsonb NOT NULL,
  partage        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
