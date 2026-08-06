-- 014 - Savoir ce qu'une ingestion a REVU, pour pouvoir effacer ce qui a disparu de la source.
--
-- POURQUOI - audit 9, defaut D1. Aucune ingestion ne contenait de DELETE : toutes sont en
-- « insertion ou mise a jour » sur la cle naturelle. Un objet RETIRE de la source restait donc en
-- base indefiniment et continuait d'etre affirme. Un site declasse restait un site classe. Une
-- deliberation de ZAER annulee restait une ZAER — et les communes revisent regulierement leurs
-- deliberations, donc le cas n'est pas d'ecole.
--
-- Ce qui manquait pour le corriger n'etait pas la requete de suppression, c'etait le MOYEN DE
-- DISTINGUER une ligne revue d'une ligne oubliee. `created_at` ne sert a rien ici : il n'est pas
-- touche par la mise a jour, donc une ligne vue a chaque execution depuis un an porte toujours la
-- date de sa premiere insertion.
--
-- `updated_at` est donc ajoute et mis a `now()` a l'insertion COMME a la mise a jour. Une execution
-- qui va au bout de sa pagination peut alors effacer ce qu'elle n'a pas revu — sous les deux
-- conditions portees par `ingestion/disparus.ts` : pagination prouvee complete, et volumetrie
-- supprimee sous un plafond, faute de quoi une source qui tronque silencieusement sa reponse
-- effacerait une couche entiere.

ALTER TABLE contrainte ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE zaer ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Reprise des lignes deja en base : leur derniere revue connue est leur creation. Cela les rend
-- candidates a la suppression a la prochaine ingestion complete si la source ne les contient plus,
-- ce qui est precisement le comportement voulu.
UPDATE contrainte SET updated_at = created_at WHERE updated_at < created_at;
UPDATE zaer SET updated_at = created_at WHERE updated_at < created_at;

-- Index : la suppression selectionne par (connecteur, updated_at) sur une table qui compte des
-- dizaines de milliers de lignes, et le comptage prealable fait de meme.
CREATE INDEX IF NOT EXISTS idx_contrainte_connecteur_maj ON contrainte (connecteur, updated_at);
CREATE INDEX IF NOT EXISTS idx_zaer_maj ON zaer (updated_at) WHERE est_demonstration = false;

COMMENT ON COLUMN contrainte.updated_at IS
  'Derniere fois que l''ingestion a REVU cet objet dans la source. Mis a jour a l''insertion comme '
  'a la mise a jour. Une ligne dont la date precede le debut de la derniere ingestion complete a '
  'disparu de la source (audit 9, defaut D1).';

COMMENT ON COLUMN zaer.updated_at IS
  'Derniere fois que l''ingestion a REVU cette zone dans la source. Voir contrainte.updated_at.';
