-- Les ZAER dont la deliberation ne precise pas le type d'implantation.
--
-- CE QUE LA MESURE A MONTRE. L'ingestion des zones d'acceleration n'inserait une ZAER
-- photovoltaique que si son attribut `detail_filiere1` disait explicitement « SOL ». La regle est
-- juste dans son intention : 58 % des ZAER PV echantillonnees au national sont des TOITURES, et
-- faire passer une toiture pour un terrain serait un contresens de prospection.
--
-- Mais la completude de cet attribut varie ENORMEMENT d'un departement a l'autre, parce qu'elle
-- depend de la facon dont chaque collectivite a rempli sa deliberation. Mesure sur la source :
--
--     detail_filiere1 des ZAER SOLAIRE_PV     national (5 000)   Eure-et-Loir (5 000)
--     TOIT                                          2 890                  284
--     SOL                                             827                   21
--     OMBRIERE                                        640                    3
--     (vide)                                          507                4 656
--     AUTRE                                           136                   36
--
-- Dans le 28, 93 % des ZAER PV n'ont AUCUN detail. La regle les ecartait donc toutes, en silence :
-- l'ingestion de ce departement a retenu 799 zones sur 10 650, et le seul signe visible etait une
-- ligne de journal. L'application se trouvait aveugle precisement la ou la source est moins
-- precise — et elle ne le disait pas.
--
-- CE QUE CETTE MIGRATION CHANGE. Trois etats au lieu de deux :
--
--   - la deliberation dit « au sol »          -> zone retenue, implantation PRECISEE ;
--   - la deliberation dit « toiture »/« ombriere » -> zone toujours ecartee, ce n'est pas du foncier ;
--   - la deliberation ne dit rien             -> zone retenue, implantation NON PRECISEE.
--
-- Le troisieme cas est une PISTE, pas une certitude : la commune a designe ce terrain pour du
-- photovoltaique sans dire comment. C'est exactement ce qu'un prospecteur veut voir, a condition
-- qu'on lui dise ce qu'on ignore.
--
-- POURQUOI UNE COLONNE ET NON UN CHAMP DE `attributs`. Elle est INTERROGEE, et par deux
-- consommateurs qui n'en veulent pas la meme chose : la liste des zones a prospecter les propose,
-- le critere `urb_zaer` du moteur de scoring doit continuer a les EXCLURE — sans quoi une zone dont
-- on ignore le type d'implantation vaudrait le meme argument reglementaire qu'une zone confirmee au
-- sol, et le score monterait sur une supposition. Un predicat de scoring ne se cache pas dans du
-- jsonb.

ALTER TABLE zaer
  ADD COLUMN IF NOT EXISTS implantation_precisee boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN zaer.implantation_precisee IS
  'false : la deliberation designe la zone pour cette filiere sans preciser le type d''implantation '
  '(detail_filiere1 vide ou « AUTRE »). La zone est proposee a la prospection, mais n''ouvre AUCUN '
  'argument reglementaire au scoring.';

-- Index partiel : les deux consommateurs interrogent presque toujours l'un des deux sous-ensembles,
-- et les zones non precisees sont minoritaires au national (10 % environ), majoritaires dans
-- certains departements. Un index partiel sur le cas rare au national sert les deux lectures sans
-- alourdir les ecritures d'ingestion.
CREATE INDEX IF NOT EXISTS idx_zaer_implantation_indeterminee
  ON zaer (code_departement)
  WHERE implantation_precisee = false;
