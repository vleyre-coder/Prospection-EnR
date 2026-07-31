-- 004 - Scores materialises par parcelle et par filiere, et couche communale agregee.

-- ---------------------------------------------------------------------------
-- Score materialise par (parcelle, filiere).
--
-- Le score est recalcule par batch lors des mises a jour de donnees, et a la volee
-- lorsque l'utilisateur modifie ses ponderations (le resultat n'est alors pas persiste
-- sous le profil par defaut).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_parcelle_filiere (
  idu               varchar(14) NOT NULL REFERENCES parcelle (idu) ON DELETE CASCADE,
  filiere           text NOT NULL CHECK (filiere IN ('solaire_sol', 'eolien_terrestre', 'bess', 'methanisation')),
  statut            text NOT NULL CHECK (statut IN ('vert', 'orange', 'rouge', 'gris')),
  score_global      numeric(5, 1),
  -- Resultat complet (criteres, knock-outs, synthese) : objet ResultatScore.
  detail            jsonb NOT NULL,
  couverture_donnees numeric(4, 3) NOT NULL DEFAULT 0,
  nb_knock_outs     integer NOT NULL DEFAULT 0,
  regime_implantation text,
  -- Profil de ponderation applique. 'defaut' pour le profil standard de la filiere.
  profil_ponderation text NOT NULL DEFAULT 'defaut',
  version_moteur    text NOT NULL,
  date_calcul       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idu, filiere, profil_ponderation)
);

CREATE INDEX IF NOT EXISTS idx_score_filiere_statut ON score_parcelle_filiere (filiere, statut);
CREATE INDEX IF NOT EXISTS idx_score_global ON score_parcelle_filiere (filiere, score_global DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_score_date ON score_parcelle_filiere (date_calcul);
CREATE INDEX IF NOT EXISTS idx_score_version ON score_parcelle_filiere (version_moteur);

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

-- ---------------------------------------------------------------------------
-- Couche communale agregee : c'est elle qui est servie a l'echelle nationale
-- (zoom < 14), ou le rendu parcellaire serait ni lisible ni performant.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commune_score_filiere (
  code_insee            varchar(5) NOT NULL REFERENCES commune (code_insee) ON DELETE CASCADE,
  filiere               text NOT NULL CHECK (filiere IN ('solaire_sol', 'eolien_terrestre', 'bess', 'methanisation')),
  -- Indicateur de potentiel 0-100, calcule sur des criteres disponibles a l'echelle communale
  -- (distance au poste source, gisement, part de sols favorables, contraintes majeures).
  potentiel             numeric(5, 1),
  statut                text CHECK (statut IN ('vert', 'orange', 'rouge', 'gris')),
  -- Surface estimee de terrains potentiellement propices, en ha.
  surface_propice_ha    numeric(12, 2),
  -- Nombre de parcelles deja qualifiees et leur repartition.
  nb_parcelles_qualifiees integer NOT NULL DEFAULT 0,
  nb_vert               integer NOT NULL DEFAULT 0,
  nb_orange             integer NOT NULL DEFAULT 0,
  nb_rouge              integer NOT NULL DEFAULT 0,
  nb_gris               integer NOT NULL DEFAULT 0,
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb,
  date_calcul           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code_insee, filiere)
);

CREATE INDEX IF NOT EXISTS idx_commune_score_filiere ON commune_score_filiere (filiere, potentiel DESC NULLS LAST);

-- Recalcule les compteurs communaux a partir des scores parcellaires connus.
CREATE OR REPLACE FUNCTION rafraichir_compteurs_communaux(p_filiere text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  nb integer;
BEGIN
  WITH agg AS (
    SELECT
      p.code_insee,
      s.filiere,
      count(*) AS total,
      count(*) FILTER (WHERE s.statut = 'vert')   AS nb_vert,
      count(*) FILTER (WHERE s.statut = 'orange') AS nb_orange,
      count(*) FILTER (WHERE s.statut = 'rouge')  AS nb_rouge,
      count(*) FILTER (WHERE s.statut = 'gris')   AS nb_gris,
      sum(COALESCE(p.surface_calculee_m2, p.contenance_m2)) FILTER (WHERE s.statut IN ('vert', 'orange'))
        / 10000.0 AS surface_propice_ha
    FROM score_parcelle_filiere s
    JOIN parcelle p ON p.idu = s.idu
    WHERE s.profil_ponderation = 'defaut'
      AND (p_filiere IS NULL OR s.filiere = p_filiere)
    GROUP BY p.code_insee, s.filiere
  )
  INSERT INTO commune_score_filiere AS c
    (code_insee, filiere, nb_parcelles_qualifiees, nb_vert, nb_orange, nb_rouge, nb_gris,
     surface_propice_ha, date_calcul)
  SELECT code_insee, filiere, total, nb_vert, nb_orange, nb_rouge, nb_gris,
         surface_propice_ha, now()
  FROM agg
  WHERE EXISTS (SELECT 1 FROM commune WHERE commune.code_insee = agg.code_insee)
  ON CONFLICT (code_insee, filiere) DO UPDATE SET
    nb_parcelles_qualifiees = EXCLUDED.nb_parcelles_qualifiees,
    nb_vert = EXCLUDED.nb_vert,
    nb_orange = EXCLUDED.nb_orange,
    nb_rouge = EXCLUDED.nb_rouge,
    nb_gris = EXCLUDED.nb_gris,
    surface_propice_ha = EXCLUDED.surface_propice_ha,
    date_calcul = now();

  SELECT count(*) INTO nb FROM commune_score_filiere
  WHERE (p_filiere IS NULL OR filiere = p_filiere);
  RETURN nb;
END;
$$;
