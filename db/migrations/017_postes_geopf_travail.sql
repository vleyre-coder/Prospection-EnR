-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- TABLES DE TRAVAIL DE L'INGESTION DES POSTES DEDUITS DE LA BD TOPO
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI DES TABLES PERMANENTES PLUTOT QUE CREEES A LA VOLEE. Le connecteur les creait lui-meme
-- au debut de chaque ingestion, ce qui marchait — mais rendait son SQL INVERIFIABLE. Le depot tient
-- un garde (`sql-analysable.test.ts`) qui soumet chaque litteral SQL a PostgreSQL pour analyse : une
-- requete portant sur une table qui n'existe pas encore echoue en « relation does not exist », et
-- c'est le garde tout entier qui perd sa valeur si on lui ouvre une exception.
--
-- Les declarer ici les rend analysables, documentees et visibles dans le schema. Elles sont VIDES
-- en dehors d'une ingestion : le connecteur les vide avant de les remplir, et les revide apres.
--
-- Elles ne portent aucune donnee de prospection et aucune donnee personnelle : ce sont deux couches
-- publiques de la BD TOPO, retenues le temps d'un croisement geometrique.

CREATE TABLE IF NOT EXISTS ing_poste_geopf (
  cleabs  text PRIMARY KEY,
  geom    geometry(MultiPolygon, 4326) NOT NULL,
  -- Lambert-93 : le croisement se fait en metres, et un cast `::geography` empecherait l'index
  -- GiST de servir. Mesure : 23 minutes en geographie contre 12 secondes en projete.
  g2154   geometry(MultiPolygon, 2154)
);

CREATE TABLE IF NOT EXISTS ing_ligne_geopf (
  cleabs       text PRIMARY KEY,
  voltage      text,
  gestionnaire text,
  geom         geometry(Geometry, 4326) NOT NULL,
  g2154        geometry(Geometry, 2154)
);

CREATE INDEX IF NOT EXISTS idx_ing_poste_geopf_g2154 ON ing_poste_geopf USING gist (g2154);
CREATE INDEX IF NOT EXISTS idx_ing_ligne_geopf_g2154 ON ing_ligne_geopf USING gist (g2154);
