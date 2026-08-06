-- Ingestion nationale des ZAER et des sites classes / inscrits.
--
-- POURQUOI CETTE MIGRATION. L'audit 8 a trouve que six couches etaient LUES en base et ecrites par
-- aucune ingestion. Deux d'entre elles portaient les defauts les plus graves des huit audits :
--
--   - `site_classe` et `site_inscrit` faisaient valoir au critere `pat_sites` 90/100 en feu VERT
--     avec la phrase « Aucun site classe ni inscrit dans le rayon d'analyse », partout en France, sur
--     zero donnee — et rendaient le knock-out eolien du site classe structurellement inatteignable ;
--   - `zaer` laissait gris en permanence l'argument reglementaire le plus utile de la prospection
--     depuis la loi APER.
--
-- Une source nationale exploitable existe pour les deux, sur le WFS de la Geoplateforme :
-- `zaer:zaer` (1 089 671 objets) et `sites_*_gpkg_*_wfs:STE_*` (7 753 objets en metropole). Le
-- correctif immediat de l'audit 8 avait rendu ces couches GRISES, ce qui etait honnete ; cette
-- migration permet de les rendre RENSEIGNEES, ce qui est mieux.
--
-- Les deux tables recoivent ce qui manquait pour une ingestion idempotente et tracable : une cle
-- naturelle de la source, et le departement, sans lequel `couverture_ingestion` ne peut rien dire.

-- ---------------------------------------------------------------------------
-- ZAER
-- ---------------------------------------------------------------------------

-- Identifiant de la source. La cle primaire `id` est un `bigserial` : sans cle naturelle, une
-- seconde ingestion dupliquait chaque zone au lieu de la mettre a jour.
ALTER TABLE zaer ADD COLUMN IF NOT EXISTS identifiant_source text;
ALTER TABLE zaer ADD COLUMN IF NOT EXISTS code_departement varchar(3);

-- L'unicite ne porte que sur les lignes issues d'une source identifiee : les zones du jeu de
-- demonstration n'en ont pas, et deux `NULL` ne sont pas egaux en SQL de toute facon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zaer_identifiant
  ON zaer (identifiant_source)
  WHERE identifiant_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zaer_departement ON zaer (code_departement);

COMMENT ON COLUMN zaer.identifiant_source IS
  'Cle naturelle de la source WFS (couche + identifiant), pour une ingestion idempotente.';
COMMENT ON COLUMN zaer.code_departement IS
  'Departement, indispensable a couverture_ingestion : sans lui, une base ingeree pour un seul '
  'departement conclurait a l''absence de ZAER sur tous les autres.';

-- ---------------------------------------------------------------------------
-- Sites classes, inscrits et assimiles
-- ---------------------------------------------------------------------------
--
-- Les sites vont dans la table `contrainte`, comme les monuments historiques : meme nature d'objet
-- (une protection patrimoniale surfacique ou ponctuelle), meme lecture par `patrimoine()`.
--
-- La contrainte d'unicite existante est `(connecteur, type, identifiant_source)`, ce qui suffit :
-- le nouveau connecteur `patrimoine_sites` ne peut pas entrer en collision avec
-- `patrimoine_culture`.

-- Rien a creer : la table `contrainte` accueille les sites tels quels. Cette section documente
-- l'intention, pour qu'une relecture du schema ne cherche pas une table absente.
COMMENT ON TABLE contrainte IS
  'Couches spatiales de contraintes (environnement, risques, patrimoine, urbanisme local). '
  'Types ingeres : monument_historique (connecteur patrimoine_culture), site_classe, site_inscrit '
  '(connecteur patrimoine_sites). Les types lus sans etre ingeres sont declares dans '
  'apps/api/test/alimentation.test.ts, qui echoue si un type est lu sans ecrivain ni declaration.';
