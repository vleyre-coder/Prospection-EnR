/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CALCUL DU POTENTIEL COMMUNAL — remplir la carte nationale, sans rien affirmer de faux
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE SERVICE ECRIT. `commune_score_filiere.potentiel`, `statut` et `detail`, pour les
 * 34 875 communes et les quatre filieres. La colonne existait depuis l'origine et n'etait ecrite
 * par aucun code : la vue nationale de la carte etait donc vide, aux zooms 5 a 13, alors que sa
 * legende annoncait « potentiel par commune ».
 *
 * LE BAREME N'EST PAS ICI. Il vit dans `@enr/scoring` (`potentielCommunal`), avec les courbes de la
 * fiche parcelle. Recopier une regle de notation en SQL est la facon la plus sure de faire diverger
 * la carte et la fiche : ce service ne fait que LIRE des grandeurs et ECRIRE des resultats.
 *
 * ═══ LA COUVERTURE, ET LA LIMITE QU'ELLE LAISSE
 *
 * `postesLesPlusProches` refuse de rendre une distance tant que le disque balaye n'est pas
 * entierement ingere — c'est le garde qui empeche d'annoncer « le plus proche » sur une base trouee.
 * Rejouer ce test disque par disque sur 34 875 communes serait hors de prix.
 *
 * La regle appliquee ici est donc plus grossiere, et il faut dire dans quel SENS elle se trompe :
 * seuls les postes situes dans un departement COUVERT sont candidats. Si le poste reellement le plus
 * proche se trouve juste de l'autre cote d'une frontiere non ingeree, la distance retenue est plus
 * GRANDE que la vraie, et la commune parait donc MOINS interessante qu'elle ne l'est. On perd une
 * occasion ; on ne fabrique pas une promesse. C'est le sens d'erreur acceptable, et le seul.
 */

import type { Filiere } from '@enr/core';
import { FILIERES } from '@enr/core';
import { potentielCommunal } from '@enr/scoring';
import { requete } from '../bdd.js';
import { journal } from '../journal.js';
import { TYPE_COUVERTURE_POSTES } from '../connecteurs/locales.js';

/** Communes ecrites par requete : un `INSERT` de 34 875 lignes epuiserait les parametres liables. */
const TAILLE_LOT = 500;

interface LigneCommune {
  code_insee: string;
  /** Distance au poste source le plus proche situe dans un departement couvert, en km. */
  distance_poste_km: number | null;
  /** Habitants par kilometre carre. `null` si la population ou la surface manque. */
  densite_hab_km2: number | null;
}

export interface ResultatPotentiel extends Record<string, unknown> {
  communes: number;
  filieres: number;
  notees: number;
  grises: number;
  sansPoste: number;
  dureeMs: number;
}

/**
 * Lit, pour chaque commune, les deux grandeurs dont depend l'indicateur.
 *
 * LA DISTANCE EST MESUREE DEPUIS LE TERRITOIRE, pas depuis le centroide. Une commune de 60 km2
 * traversee par une ligne peut avoir son centroide a 5 km d'un poste et sa limite a 200 m : c'est
 * la limite qui compte, puisque c'est la qu'on cherchera du foncier. `<->` sur la geometrie sert
 * l'index, et `ST_Distance` en geographie donne les metres.
 */
/**
 * Exportee pour son garde : `potentiel-communal-distance.test.ts` verifie les trois proprietes que
 * la reecriture de l'audit 13 aurait pu perdre — le plus proche, le departage deterministe, et le
 * `null` d'un departement non couvert. Aucune mesure de duree ne les aurait vues.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE COMMUNE DONT LE DEPARTEMENT N'EST PAS INGERE N'EST PAS MESUREE — audit 13
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SANS CE FILTRE, la requete rendait pour elle la distance au poste le plus proche PARMI LES
 * DEPARTEMENTS COUVERTS, ou qu'il soit. Mesure sur le territoire d'essai : 173 km. La commune
 * etait alors peinte en rouge sur la carte nationale — « loin du reseau » — alors que son poste
 * reel est peut-etre a deux kilometres et simplement pas encore ingere.
 *
 * C'est le defaut A3 de l'audit 9, corrige pour les PARCELLES et reste ouvert pour les communes :
 * un faux rouge par trou dans la donnee, qui se lit comme une mesure. Et il ne se voit qu'en
 * couverture PARTIELLE — c'est-a-dire pendant tout un deploiement progressif, jamais sur une base
 * complete comme celle qui sert aux essais.
 *
 * `NULL` est la reponse juste : l'appelant en fait une commune GRISE, qui dit « on n'a pas regarde
 * ici ». Le cas residuel — un departement couvert dont le VOISIN ne l'est pas — rend une distance
 * pessimiste et non optimiste : on manque un poste plus proche, on n'en invente aucun. C'est
 * `disqueEntierementCouvert` qui le ferme pour les parcelles, au prix d'un controle par point que
 * 34 875 communes ne supporteraient pas.
 */
export async function grandeursCommunales(): Promise<LigneCommune[]> {
  return requete<LigneCommune>(
    /*
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     * LE PLUS PROCHE POSTE, PAR L'INDEX — et non par un balayage complet a chaque commune
     * ═══════════════════════════════════════════════════════════════════════════════════════════
     *
     * CE QUI A ETE MESURE, audit 13. Cette requete demandait **436 secondes**, et le journal la
     * signalait lui-meme comme lente a chaque execution. La cause tient en une ligne : les postes
     * etaient rassembles dans une CTE, et une CTE est MATERIALISEE — le resultat temporaire ne
     * porte aucun index. L'operateur `<->` ne pouvait donc pas s'appuyer sur `idx_poste_geom`, et
     * le plan rendait, POUR CHACUNE des 34 875 communes, un balayage complet des 5 928 postes
     * suivi d'un tri. Cout estime par le planificateur : 140 184 345.
     *
     * LA REECRITURE interroge `poste_source` directement, ce qui rend l'index KNN utilisable :
     * `Index Scan using idx_poste_geom ... Order By: (geom <-> c.geom)`. Cout estime : 1 362 765,
     * soit cent fois moins.
     *
     * POURQUOI DEUX ETAGES, et non un seul. L'index KNN ne sait trier que par la DISTANCE. Or le
     * departage par identifiant reste indispensable : deux postes exactement equidistants existent
     * — des postes jumeles sur un meme site —, la distance retenue serait la meme, mais un tri sans
     * ordre total est une troncature au hasard, que le garde `pagination-stable` refuse a juste
     * titre. L'etage interne prend donc les huit plus proches PAR L'INDEX, et l'etage externe les
     * re-trie par (distance, identifiant). Huit est large : il faudrait neuf postes exactement
     * equidistants d'une meme commune pour que l'ordre total redevienne partiel.
     *
     * VERIFIE AVANT D'ETRE APPLIQUE : les deux formulations rendent la meme distance sur les 400
     * premieres communes, a la troisieme decimale, sans un seul ecart.
     */
    `WITH deps_couverts AS (
       SELECT DISTINCT code_departement
         FROM couverture_ingestion
        WHERE type = $1
     )
     SELECT c.code_insee,
            -- Voir le commentaire de cette fonction : une commune hors couverture n'est pas mesuree,
            -- mais elle RESTE dans le releve. L'ecarter laisserait sa ligne precedente en place,
            -- donc une couleur perimee sur la carte nationale — l'inverse du but recherche.
            CASE WHEN c.code_departement NOT IN (SELECT code_departement FROM deps_couverts)
                 THEN NULL
                 ELSE (SELECT round((ST_Distance(c.geom::geography, q2.geom::geography) / 1000.0)::numeric, 3)
                         FROM (SELECT q.id, q.geom
                                 FROM poste_source q
                                WHERE q.code_departement IN (SELECT code_departement FROM deps_couverts)
                                ORDER BY c.geom <-> q.geom
                                LIMIT 8) q2
                        ORDER BY c.geom <-> q2.geom, q2.id
                        LIMIT 1)
            END AS distance_poste_km,
            CASE WHEN c.population IS NULL OR c.surface_ha IS NULL OR c.surface_ha <= 0 THEN NULL
                 ELSE round((c.population / c.surface_ha * 100)::numeric, 2) END AS densite_hab_km2
       FROM commune c
      ORDER BY c.code_insee`,
    [TYPE_COUVERTURE_POSTES],
  );
}

/**
 * Recalcule le potentiel de toutes les communes, pour toutes les filieres.
 *
 * IDEMPOTENT : chaque ligne est un upsert sur (code_insee, filiere). Les compteurs de parcelles
 * qualifiees, ecrits par `rafraichir_compteurs_communaux`, ne sont PAS touches — ce sont deux
 * informations distinctes qui cohabitent dans la meme table : ce qu'on a deja qualifie, et ce que
 * le territoire vaut a priori.
 */
export async function calculerPotentielCommunal(
  filieres: readonly Filiere[] = FILIERES,
): Promise<ResultatPotentiel> {
  const debut = Date.now();
  const lignes = await grandeursCommunales();
  const sansPoste = lignes.filter((l) => l.distance_poste_km == null).length;
  let notees = 0;
  let grises = 0;

  for (const filiere of filieres) {
    for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
      const lot = lignes.slice(i, i + TAILLE_LOT);
      const valeurs: unknown[] = [];
      const morceaux: string[] = [];
      for (const l of lot) {
        const r = potentielCommunal(
          {
            // `numeric` traverse `pg` en chaine : sans cette conversion, `Number.isFinite` echoue
            // sur une valeur parfaitement valide et l'axe passe a `null` en silence.
            distancePosteKm: l.distance_poste_km == null ? null : Number(l.distance_poste_km),
            densiteHabKm2: l.densite_hab_km2 == null ? null : Number(l.densite_hab_km2),
          },
          filiere,
        );
        if (r.potentiel == null) grises += 1;
        else notees += 1;
        const base = valeurs.length;
        morceaux.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`);
        valeurs.push(
          l.code_insee,
          filiere,
          r.potentiel,
          r.statut,
          JSON.stringify({
            potentiel: {
              axes: r.axes,
              facteurLimitant: r.facteurLimitant,
              methode: r.methode,
              calculeLe: new Date().toISOString(),
            },
          }),
        );
      }
      if (morceaux.length === 0) continue;
      /*
       * `detail` est FUSIONNE et non remplace : la colonne est partagee avec d'autres ecritures, et
       * un `SET detail = EXCLUDED.detail` effacerait ce qu'elles y ont mis. L'operateur `||` de
       * jsonb ecrase la seule clef `potentiel`.
       */
      await requete(
        `INSERT INTO commune_score_filiere (code_insee, filiere, potentiel, statut, detail)
         VALUES ${morceaux.join(', ')}
         ON CONFLICT (code_insee, filiere) DO UPDATE SET
           potentiel = EXCLUDED.potentiel,
           statut = EXCLUDED.statut,
           detail = commune_score_filiere.detail || EXCLUDED.detail,
           date_calcul = now()`,
        valeurs,
      );
    }
  }

  const resultat: ResultatPotentiel = {
    communes: lignes.length,
    filieres: filieres.length,
    notees,
    grises,
    sansPoste,
    dureeMs: Date.now() - debut,
  };
  journal.info(resultat, 'Potentiel communal recalcule');
  return resultat;
}
