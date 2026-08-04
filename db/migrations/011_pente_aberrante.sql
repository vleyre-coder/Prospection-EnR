-- 011 - Corriger les pentes aberrantes deja stockees dans les snapshots.
--
-- POURQUOI CETTE MIGRATION EXISTE. Le calcul de pente (`penteDepuisSemis`) se protegeait de la
-- degenerescence du systeme normal par `Math.abs(det) > 1e-6`. Ce determinant a la dimension de
-- (m^2)^2 : sur une parcelle ordinaire il vaut 1e7 a 1e9, et un seuil absolu de 1e-6 ne teste
-- donc rien. Mesure sur 49 parcelles reelles : 7 d'entre elles (14 %) portaient une pente
-- superieure a 100 %, jusqu'a 1 666 % pour 1,8 m de denivele sur 2,26 ha.
--
-- Le code est corrige. Mais la pente est une donnee de SNAPSHOT, pas de score : recalculer les
-- scores ne la corrigerait pas, il les recalculerait sur la meme valeur fausse. Il faut donc
-- reparer les snapshots.
--
-- POURQUOI PAS UNE RE-QUALIFICATION. Re-interroger l'altimetrie pour chaque parcelle prendrait
-- plusieurs secondes par parcelle et solliciterait inutilement la Geoplateforme. Or la valeur
-- juste est DEJA en base : `penteMaxPct`, la plus forte pente locale mesuree entre paires de
-- points distants, est bornee par construction et n'a jamais ete affectee. C'est exactement la
-- valeur sur laquelle le code corrige retombe.
--
-- On applique donc le meme repli que le code : pentePct <- penteMaxPct, orientation ecartee
-- (elle vient de la meme regression), et `penteEstimeeParPaires` a true pour que la fiche
-- presente la valeur comme une estimation majorante et non comme une regression.
--
-- Les parcelles dont la pente est plausible ne sont pas touchees.

UPDATE parcelle_snapshot
   SET snapshot = jsonb_set(
         jsonb_set(
           jsonb_set(
             snapshot,
             '{topographie,pentePct}',
             COALESCE(snapshot -> 'topographie' -> 'penteMaxPct', 'null'::jsonb)
           ),
           '{topographie,orientationDeg}',
           'null'::jsonb
         ),
         '{topographie,penteEstimeeParPaires}',
         'true'::jsonb
       )
 WHERE (snapshot -> 'topographie' ->> 'pentePct') IS NOT NULL
   AND (snapshot -> 'topographie' ->> 'pentePct')::numeric > 100;

-- Cas residuel : une pente aberrante sans penteMaxPct exploitable devient NULL par le COALESCE
-- ci-dessus. Le critere passera GRIS, ce qui est le comportement correct — l'absence de donnee
-- n'est pas une pente nulle. On retire alors le drapeau, qui n'aurait plus de sens.
UPDATE parcelle_snapshot
   SET snapshot = jsonb_set(snapshot, '{topographie,penteEstimeeParPaires}', 'null'::jsonb)
 WHERE (snapshot -> 'topographie' ->> 'pentePct') IS NULL
   AND (snapshot -> 'topographie' ->> 'penteEstimeeParPaires') = 'true';

-- Les snapshots restants, jamais passes par le code corrige, n'ont pas la cle du tout. On la
-- pose a `false` : leur pente vient bien d'une regression, et elle est plausible puisque les
-- aberrantes viennent d'etre traitees.
UPDATE parcelle_snapshot
   SET snapshot = jsonb_set(snapshot, '{topographie,penteEstimeeParPaires}', 'false'::jsonb)
 WHERE NOT (snapshot -> 'topographie' ? 'penteEstimeeParPaires');

-- Les scores calcules sur les anciennes valeurs sont perimes. La version du moteur change dans
-- le meme lot de corrections (1.4.0), ce qui declenche le recalcul au demarrage suivant : rien
-- a faire ici, mais c'est la raison pour laquelle cette migration seule ne suffit pas.
COMMENT ON TABLE parcelle_snapshot IS
  'Snapshot des donnees collectees par parcelle. Migration 011 : les pentes superieures a 100 % ont ete remplacees par la mesure par paires, la regression ayant produit des valeurs aberrantes jusqu''a 1 666 %.';
