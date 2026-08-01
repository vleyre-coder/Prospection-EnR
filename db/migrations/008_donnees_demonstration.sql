-- 008 - Distinguer les donnees de demonstration des donnees reelles.
--
-- Le jeu d'amorçage insere une ZAER et un document-cadre fictifs pour que l'application
-- soit demontrable sans attendre l'ingestion d'un arrete prefectoral. Ils n'etaient
-- distingues que par un champ texte `source_document`, que le moteur de scoring ne lit
-- pas : une parcelle etait donc presentee comme situee en zone d'acceleration ENR - un
-- argument reglementaire majeur - alors que la zone n'existe pas.
--
-- Un indicateur booleen explicite permet aux lectures de les ecarter par defaut. Un jeu
-- de demonstration ne doit jamais etre indiscernable du reel au niveau du moteur.

ALTER TABLE zaer ADD COLUMN IF NOT EXISTS est_demonstration boolean NOT NULL DEFAULT false;
ALTER TABLE document_cadre_pv ADD COLUMN IF NOT EXISTS est_demonstration boolean NOT NULL DEFAULT false;

-- Reprise des enregistrements deja poses par l'amorçage des versions precedentes.
UPDATE zaer SET est_demonstration = true
 WHERE source_document LIKE 'EXEMPLE DE DEMONSTRATION%';
-- `document_cadre_pv` n'a pas de colonne `source_document` : l'amorçage y ecrit la
-- marque dans `criteres_texte`.
UPDATE document_cadre_pv SET est_demonstration = true
 WHERE criteres_texte LIKE 'EXEMPLE DE DEMONSTRATION%';

CREATE INDEX IF NOT EXISTS idx_zaer_demonstration ON zaer (est_demonstration);
CREATE INDEX IF NOT EXISTS idx_doccadre_demonstration ON document_cadre_pv (est_demonstration);

COMMENT ON COLUMN zaer.est_demonstration IS
  'Vrai pour les donnees d''exemple. Les lectures du moteur les ecartent : elles ne doivent jamais fonder une conclusion reglementaire.';
COMMENT ON COLUMN document_cadre_pv.est_demonstration IS
  'Vrai pour les donnees d''exemple. Les lectures du moteur les ecartent.';
