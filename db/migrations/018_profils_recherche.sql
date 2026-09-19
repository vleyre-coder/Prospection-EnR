-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 018 — PROFILS DE RECHERCHE, ET SEUILS DEVELOPPEUR
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- CE QUE C'EST. Un developpeur remet un cahier des charges : « methanisation, au moins 400 m de
-- toute habitation, 15 ha minimum, Grand Est ». Un profil enregistre cette demande pour qu'elle
-- soit rejouable — un developpeur revient, et retaper ses criteres a chaque fois garantit qu'on
-- finira par en oublier un.
--
-- POURQUOI LES SEUILS SONT ATTACHES AU PROFIL, ET NON GLOBAUX. Un seuil developpeur n'est pas une
-- correction du referentiel : c'est l'exigence d'UN projet. Deux developpeurs demandent 400 m et
-- 250 m de la meme chose le meme mois, et les deux ont raison chez eux. Un reglage global forcerait
-- le second a defaire celui du premier, en silence, pour tous les autres.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET NE DOIT PAS FAIRE. Elle ne stocke aucun seuil
-- REGLEMENTAIRE. Ceux-la vivent dans `packages/core/src/contraintes-referentiel.ts`, genere depuis
-- le classeur et committe ; les mettre en base les rendrait modifiables par une requete, alors que
-- le cahier des charges les declare immuables. La base ne porte donc que ce qui est editable.
--
-- AUCUNE DONNEE PERSONNELLE ICI. Un profil porte des criteres de recherche et le nom commercial
-- d'un developpeur, pas des proprietaires. Les donnees de propriete restent dans leur propre
-- perimetre, avec leur journalisation.

CREATE TABLE IF NOT EXISTS profil_recherche (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom          text NOT NULL,
  -- Les cinq filieres du referentiel, agrivoltaisme compris : c'est de lui que viennent les
  -- contraintes parametrables, donc c'est sa liste qui fait foi ici.
  filiere      text NOT NULL CHECK (filiere IN (
                 'eolien_terrestre', 'solaire_sol', 'agrivoltaisme', 'bess', 'methanisation')),
  -- Nom du developpeur demandeur. Facultatif : un profil peut etre un modele interne.
  developpeur  text,
  -- Criteres de recherche, dans la forme que la route de recherche valide deja. Stockes en jsonb
  -- et RE-VALIDES a la relecture : un profil enregistre avant une evolution des filtres ne doit
  -- pas pouvoir injecter un champ devenu inconnu.
  criteres     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes        text,
  cree_par     text,
  cree_le      timestamptz NOT NULL DEFAULT now(),
  maj_le       timestamptz NOT NULL DEFAULT now()
);

-- Unicite du nom, insensible a la casse.
--
-- POURQUOI L'IMPOSER. Le nom est la SEULE chose qu'un operateur lit dans la liste des profils.
-- « Methanisation Dev X » et « methanisation dev x » cote a cote, il ouvrira l'un pour l'autre et
-- lancera une recherche sur les criteres d'un autre developpeur sans s'en apercevoir. La route
-- rend 409 avec le nom en conflit plutot que de laisser passer le doublon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profil_recherche_nom ON profil_recherche (lower(nom));

CREATE INDEX IF NOT EXISTS idx_profil_recherche_filiere ON profil_recherche (filiere, maj_le DESC);

-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seuil_developpeur (
  profil_id    uuid NOT NULL REFERENCES profil_recherche (id) ON DELETE CASCADE,
  -- Identifiant de contrainte du referentiel, ex.
  -- « methanisation__distance_d_implantation_aux_tiers_habitations_erp ».
  --
  -- PAS DE CLE ETRANGERE : la table de reference n'existe pas en base, et ne doit pas y exister
  -- (voir l'en-tete). La route verifie l'identifiant contre le referentiel embarque et refuse un
  -- inconnu. La relecture signale en plus les seuils devenus orphelins apres une revision du
  -- classeur, plutot que de les faire disparaitre sans bruit.
  contrainte_id text NOT NULL,
  valeur        numeric NOT NULL,
  unite         text NOT NULL,
  -- Sens de l'exigence. NULL quand le classeur l'ETABLIT lui-meme (« ≥ 500 m ») : il est alors
  -- recopie a la lecture, et le laisser saisir permettrait d'inverser une contrainte. Renseigne
  -- seulement quand le classeur ne porte aucun symbole de comparaison, cas ou aucun defaut n'est
  -- defendable — « 500 m des monuments » veut dire au moins, « 0,5 ha de defrichement » au plus.
  sens          text CHECK (sens IN ('min', 'max')),
  -- Pourquoi le developpeur durcit. Repris tel quel dans le dossier qui lui est remis : c'est ce
  -- qui permet a l'operateur de lui dire « ecartee par VOTRE exigence, pas par la reglementation ».
  motif         text NOT NULL DEFAULT '',
  maj_par       text,
  maj_le        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profil_id, contrainte_id)
);

COMMENT ON TABLE profil_recherche IS
  'Cahier des charges d''un developpeur, rejouable. Ne contient aucune donnee personnelle de proprietaire.';

COMMENT ON TABLE seuil_developpeur IS
  'Seuils propres a un projet, qui ne peuvent que DURCIR le referentiel. Le seuil reglementaire n''est pas stocke en base : il est immuable et vit dans le code genere depuis le classeur.';

COMMENT ON COLUMN seuil_developpeur.sens IS
  'NULL quand le classeur etablit le sens (il est alors recopie). Renseigne seulement quand le classeur ne porte aucun symbole de comparaison.';
