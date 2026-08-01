-- 009 - Tracer les campagnes de qualification, et clarifier le vocabulaire de couverture.

-- ---------------------------------------------------------------------------
-- Campagnes de qualification.
--
-- L'avancement n'existait qu'en memoire du processus. Trois consequences : un redemarrage
-- pendant un lot de 500 parcelles laissait le travail a moitie fait sans aucune trace ;
-- l'utilisateur ne pouvait pas savoir qu'une campagne avait ete interrompue ; et rien ne
-- permettait de constater apres coup ce qui avait ete lance, par qui, ni sur quelle emprise.
--
-- La table ne remplace pas l'etat en memoire, qui reste la source de verite pendant le
-- traitement : elle en conserve la trace, et permet de reperer au demarrage les campagnes
-- restees ouvertes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tache_qualification (
  id              bigserial PRIMARY KEY,
  -- Emprise demandee, apres normalisation.
  bbox            jsonb NOT NULL,
  phase           text NOT NULL DEFAULT 'recuperation'
                  CHECK (phase IN ('recuperation', 'enrichissement', 'terminee')),
  total           integer NOT NULL DEFAULT 0,
  traitees        integer NOT NULL DEFAULT 0,
  echecs          integer NOT NULL DEFAULT 0,
  message         text,
  -- Auteur de la demande, pour savoir qui a consomme le quota partage.
  utilisateur_id  uuid,
  debut_le        timestamptz NOT NULL DEFAULT now(),
  -- NULL tant que la campagne n'est pas achevee.
  fin_le          timestamptz,
  -- Vrai lorsque le serveur s'est arrete avant la fin : marque au demarrage suivant.
  interrompue     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tache_qualif_debut ON tache_qualification (debut_le DESC);
-- Retrouve instantanement les campagnes restees ouvertes, au demarrage.
CREATE INDEX IF NOT EXISTS idx_tache_qualif_ouverte ON tache_qualification (fin_le)
  WHERE fin_le IS NULL;

-- ---------------------------------------------------------------------------
-- Vocabulaire : deux grandeurs differentes portaient le nom de « couverture ».
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN parcelle_snapshot.couverture IS
  'Part des CONNECTEURS ayant repondu (nb sources renseignees / nb connecteurs). A ne pas confondre avec score_parcelle_filiere.couverture_donnees, qui est la part du POIDS DES CRITERES evaluee et qui, elle, pilote le grisement et le plafonnement du statut.';

COMMENT ON COLUMN score_parcelle_filiere.couverture_donnees IS
  'Part du POIDS DES CRITERES applicables effectivement evaluee, entre 0 et 1. Sous 0,80 la parcelle est grise ; sous 0,90 son statut est plafonne a orange. Les criteres sans source nationale sont exclus du denominateur et plafonnent separement.';
