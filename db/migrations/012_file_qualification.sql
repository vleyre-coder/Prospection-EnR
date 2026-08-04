-- 012 - Rendre durable la file d'attente de qualification.
--
-- POURQUOI. La file etait un tableau en memoire. Mesure : trois demandes acceptees et en attente
-- avant l'arret du serveur, ZERO apres le redemarrage — aucune trace en base, aucune ligne de
-- journal, aucun message. Trois utilisateurs a qui l'API avait repondu 202 « votre demande
-- demarrera seule » attendaient indefiniment.
--
-- Le paradoxe etait net : la campagne EN COURS etait tracee dans `tache_qualification` et marquee
-- interrompue au demarrage suivant, mais les demandes ACCEPTEES ne l'etaient nulle part. La file
-- avait ete construite sans la durabilite que le mecanisme voisin possedait deja.
--
-- CHOIX D'UNE TABLE DEDIEE plutot qu'une phase 'en_attente' dans `tache_qualification` : cette
-- derniere trace ce qui a ETE FAIT — elle porte des compteurs de progression, une date de debut,
-- un drapeau d'interruption. Une demande en attente n'a rien de tout cela ; elle porte au
-- contraire des donnees que la campagne n'a pas (ses options de lancement). Les melanger
-- obligerait a rendre nullable la moitie des colonnes des deux cotes.

CREATE TABLE IF NOT EXISTS demande_qualification (
  id              bigserial PRIMARY KEY,
  -- Emprise demandee, normalisee des la mise en file : une emprise irrecevable doit lever
  -- immediatement, pas une heure plus tard au fond de la file.
  bbox            jsonb NOT NULL,
  -- Options de lancement, telles qu'elles seront passees au moteur de qualification.
  options         jsonb NOT NULL DEFAULT '{}'::jsonb,
  utilisateur_id  uuid,
  demandee_le     timestamptz NOT NULL DEFAULT now(),
  -- Renseigne au moment ou la demande quitte la file pour devenir une campagne. La ligne est
  -- CONSERVEE : elle permet de dire a l'utilisateur que sa demande a bien ete traitee, et de
  -- reconstituer l'ordre reel de passage.
  demarree_le     timestamptz,
  -- Renseigne si la demande est abandonnee sans avoir demarre, avec son motif.
  abandonnee_le   timestamptz,
  motif_abandon   text
);

-- La file, dans son ordre de traitement : ni demarree, ni abandonnee.
CREATE INDEX IF NOT EXISTS idx_demande_qualif_file
    ON demande_qualification (demandee_le)
 WHERE demarree_le IS NULL AND abandonnee_le IS NULL;

CREATE INDEX IF NOT EXISTS idx_demande_qualif_utilisateur
    ON demande_qualification (utilisateur_id, demandee_le DESC);

COMMENT ON TABLE demande_qualification IS
  'File d''attente des qualifications d''emprise. Une seule campagne s''execute a la fois : les sources publiques plafonnent a une requete par seconde, donc deux campagnes simultanees finiraient toutes deux plus tard que l''une seule. Les demandes suivantes attendent leur tour ici, et y survivent a un redemarrage.';

COMMENT ON COLUMN demande_qualification.demarree_le IS
  'Non NULL une fois la demande devenue campagne. La ligne est conservee pour tracer l''ordre de passage reel.';
