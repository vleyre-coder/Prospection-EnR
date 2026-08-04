-- 010 - Distinguer les knock-outs bloquants des knock-outs derogeables.
--
-- POURQUOI. nb_knock_outs compte TOUS les criteres redhibitoires declenches, y compris
-- les deux qui sont derogeables (zonage d'urbanisme incompatible mais modifiable par
-- STECAL ou revision, zonage naturel strict). La fiche parcelle, elle, ne qualifie de
-- « redhibitoire » que les knock-outs NON derogeables — c'est la bonne semantique
-- metier : une parcelle en zone A avec un STECAL possible n'est pas exclue, elle est
-- conditionnee.
--
-- Consequence du decalage : la couche carte et le filtre « Exclure les parcelles
-- redhibitoires » testaient nb_knock_outs > 0 et ecartaient donc des parcelles que la
-- fiche presente comme instruisables. On separe les deux grandeurs plutot que de
-- changer le sens de la premiere, parce que le nombre total reste utile (il interdit
-- le vert, cf. moteur de scoring).

ALTER TABLE score_parcelle_filiere
  ADD COLUMN IF NOT EXISTS nb_knock_outs_bloquants integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN score_parcelle_filiere.nb_knock_outs IS
  'Nombre total de criteres redhibitoires declenches, derogeables inclus. Un seul suffit a interdire le statut vert.';
COMMENT ON COLUMN score_parcelle_filiere.nb_knock_outs_bloquants IS
  'Nombre de criteres redhibitoires NON derogeables. Seul ce compteur qualifie une parcelle de « reglementairement ecartee » : carte, filtre, liste et exports.';

-- Backfill depuis le detail JSONB deja stocke : le tableau knockOuts porte le drapeau
-- derogeable pour chaque entree, on n'a donc pas besoin de rescorer.
UPDATE score_parcelle_filiere
   SET nb_knock_outs_bloquants = (
         SELECT count(*)
           FROM jsonb_array_elements(COALESCE(detail -> 'knockOuts', '[]'::jsonb)) AS k
          WHERE COALESCE((k ->> 'derogeable')::boolean, false) = false
       )
 WHERE nb_knock_outs > 0
   AND nb_knock_outs_bloquants = 0;

CREATE INDEX IF NOT EXISTS idx_score_ko_bloquants
    ON score_parcelle_filiere (filiere, nb_knock_outs_bloquants);

-- La vue de service v_parcelle_carte n'est requetee par aucun code applicatif (le service
-- de tuiles construit son propre SQL), mais elle reste utilisable en psql : on l'aligne
-- pour qu'elle ne devienne pas une definition trompeuse. La nouvelle colonne est ajoutee
-- en fin de liste, seule position que CREATE OR REPLACE VIEW autorise.
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
  l.assigne_a,
  s.nb_knock_outs_bloquants
FROM parcelle p
LEFT JOIN score_parcelle_filiere s
  ON s.idu = p.idu AND s.profil_ponderation = 'defaut'
LEFT JOIN lead l
  ON l.idu = p.idu AND l.filiere = s.filiere;
