-- 015 - Reprise de la couverture des reseaux, pour ne pas griser une instance deja en service.
--
-- POURQUOI CETTE MIGRATION EXISTE : ELLE REPARE UN DEFAUT QUE LA CORRECTION PRECEDENTE A CREE.
--
-- L'audit 9 (defaut A3) a etabli qu'une distance au plus proche n'est une mesure que si tous les
-- departements traverses par le disque de recherche sont ingeres. `postesLesPlusProches` et
-- `reseauGaz` verifient donc desormais `couverture_ingestion` avant de rendre une distance.
--
-- Or ces deux connecteurs n'ecrivaient AUCUNE ligne de couverture avant cet audit : c'etait la cause
-- meme du defaut. Les lignes n'apparaissent donc qu'a la PROCHAINE ingestion. Consequence sur une
-- instance deja en service, ou les postes sont ingeres depuis des mois : tous les criteres de
-- raccordement — les plus lourds du profil — passeraient au GRIS au deploiement, et resteraient gris
-- jusqu'a ce que l'exploitant relance l'ingestion, sans qu'aucun message ne le lui dise. Une
-- correction de fiabilite qui degrade silencieusement le critere principal n'est pas une correction.
--
-- La reprise deduit donc la couverture du CONTENU des tables : un departement ou des postes sont
-- presents a bien ete ingere. C'est exactement l'etat de connaissance d'avant l'audit, ni plus ni
-- moins : la migration ne pretend pas mesurer une completude, elle restitue ce que l'application
-- supposait implicitement. La provenance est ecrite dans `source_document`, afin qu'un exploitant
-- puisse distinguer une couverture DEDUITE d'une couverture CONSTATEE par une ingestion.
--
-- La prochaine ingestion de chaque connecteur remplacera ces lignes par des lignes constatees, avec
-- leur date reelle et leur volumetrie reelle.

-- 1. Les postes sources n'ont pas de departement : Capareseau ne le publie pas. Jointure spatiale sur
--    `commune`, la seule methode fiable, identique a celle que l'ingestion applique desormais.
--    Si `commune` est vide (premiere installation), rien n'est rattache et rien n'est deduit : le
--    critere reste gris, ce qui est le comportement juste — on ne sait pas ou sont ces postes.
UPDATE poste_source p
   SET code_insee = com.code_insee,
       nom_commune = com.nom,
       code_departement = com.code_departement
  FROM commune com
 WHERE p.code_departement IS NULL
   AND ST_Intersects(com.geom, p.geom);

-- 2. Couverture deduite des postes presents.
INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets, source_document)
SELECT 'postes_sources', 'poste_source', code_departement, count(*),
       'reprise migration 015 : couverture DEDUITE du contenu, non constatee par une ingestion'
  FROM poste_source
 WHERE code_departement IS NOT NULL
 GROUP BY code_departement
ON CONFLICT (connecteur, type, code_departement) DO NOTHING;

-- 3. Meme reprise pour les sites d'injection de gaz, qui portent deja leur departement (publie par
--    la source). La distance au site d'injection est le critere de raccordement de la methanisation.
INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets, source_document)
SELECT 'reseau_gaz', 'point_injection_gaz', code_departement, count(*),
       'reprise migration 015 : couverture DEDUITE du contenu, non constatee par une ingestion'
  FROM point_injection_gaz
 WHERE code_departement IS NOT NULL
 GROUP BY code_departement
ON CONFLICT (connecteur, type, code_departement) DO NOTHING;

COMMENT ON COLUMN couverture_ingestion.source_document IS
  'Provenance de la ligne. Renseigne « reprise migration 015 » pour les couvertures DEDUITES du '
  'contenu des tables lors de la mise a niveau de l''audit 9, par opposition aux couvertures '
  'constatees par une ingestion, qui portent leur volumetrie et leur date reelles.';
