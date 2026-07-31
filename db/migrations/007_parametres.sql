-- 007 - Parametres internes de l'instance.
--
-- Sert a persister ce que l'application peut generer elle-meme plutot que d'exiger
-- de l'exploitant une manipulation manuelle : au premier demarrage, le secret de
-- signature des jetons est tire au hasard et conserve ici. Une installation sans
-- SECRET_JWT est donc securisee par defaut, et les sessions survivent aux
-- redemarrages du serveur.
--
-- Cette table n'est jamais exposee par l'API.

CREATE TABLE IF NOT EXISTS parametre (
  cle        text PRIMARY KEY,
  valeur     text NOT NULL,
  cree_le    timestamptz NOT NULL DEFAULT now(),
  maj_le     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE parametre IS
  'Parametres internes generes par l''instance (secret de signature, etc.). Ne jamais exposer.';
