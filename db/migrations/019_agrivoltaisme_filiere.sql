-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 019 — L'AGRIVOLTAISME DEVIENT UNE FILIERE, ET LA BASE DOIT L'ACCEPTER
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- CE QUE CETTE MIGRATION CORRIGE. Cinq tables contraignent leur colonne `filiere` a une liste de
-- quatre valeurs, ecrite en dur au moment de leur creation. L'application en connait desormais
-- cinq. Sans cette migration, tout ce qui touche a l'agrivoltaisme echouerait a l'ECRITURE, et
-- seulement a l'ecriture : la qualification d'une parcelle, la creation d'un lead, d'un site, d'un
-- profil de ponderation. La lecture, elle, continuerait de marcher — c'est le pire des cas de
-- figure, puisque l'interface proposerait la filiere sans rien pouvoir en enregistrer.
--
-- POURQUOI UNE LISTE EN DUR PLUTOT QU'UN TYPE ENUM. C'est le choix des migrations 004 a 006, et il
-- est conserve : un `CHECK` se remplace par un `ALTER TABLE`, la ou un type enum PostgreSQL se
-- modifie par `ALTER TYPE ... ADD VALUE`, qui ne peut pas s'executer dans une transaction avec
-- d'autres instructions sur les tables concernees. Changer de mecanisme ici demanderait de
-- reecrire cinq colonnes sur une base de production ; le jeu n'en vaut pas la chandelle.
--
-- `profil_recherche` (migration 018) N'EST PAS TOUCHEE : elle acceptait deja les cinq filieres du
-- referentiel, parce qu'elle a ete ecrite apres l'integration du classeur. C'est d'ailleurs ce
-- decalage qui a rendu l'incoherence visible — un profil de recherche agrivoltaique pouvait
-- s'enregistrer, et la parcelle qu'il designait ne pouvait pas etre scoree.
--
-- AUCUNE DONNEE N'EST MODIFIEE. La contrainte est elargie, jamais restreinte : aucune ligne
-- existante ne peut devenir invalide.

BEGIN;

ALTER TABLE score_parcelle_filiere DROP CONSTRAINT IF EXISTS score_parcelle_filiere_filiere_check;
ALTER TABLE score_parcelle_filiere ADD CONSTRAINT score_parcelle_filiere_filiere_check
  CHECK (filiere IN ('solaire_sol', 'agrivoltaisme', 'eolien_terrestre', 'bess', 'methanisation'));

ALTER TABLE commune_score_filiere DROP CONSTRAINT IF EXISTS commune_score_filiere_filiere_check;
ALTER TABLE commune_score_filiere ADD CONSTRAINT commune_score_filiere_filiere_check
  CHECK (filiere IN ('solaire_sol', 'agrivoltaisme', 'eolien_terrestre', 'bess', 'methanisation'));

ALTER TABLE site DROP CONSTRAINT IF EXISTS site_filiere_check;
ALTER TABLE site ADD CONSTRAINT site_filiere_check
  CHECK (filiere IN ('solaire_sol', 'agrivoltaisme', 'eolien_terrestre', 'bess', 'methanisation'));

ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_filiere_check;
ALTER TABLE lead ADD CONSTRAINT lead_filiere_check
  CHECK (filiere IN ('solaire_sol', 'agrivoltaisme', 'eolien_terrestre', 'bess', 'methanisation'));

ALTER TABLE profil_ponderation DROP CONSTRAINT IF EXISTS profil_ponderation_filiere_check;
ALTER TABLE profil_ponderation ADD CONSTRAINT profil_ponderation_filiere_check
  CHECK (filiere IN ('solaire_sol', 'agrivoltaisme', 'eolien_terrestre', 'bess', 'methanisation'));

COMMIT;
