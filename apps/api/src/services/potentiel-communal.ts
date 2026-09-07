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
async function grandeursCommunales(): Promise<LigneCommune[]> {
  return requete<LigneCommune>(
    `WITH deps_couverts AS (
       SELECT DISTINCT code_departement
         FROM couverture_ingestion
        WHERE type = $1
     ),
     postes AS (
       -- L'identifiant voyage avec la geometrie : il sert d'ordre de secours ci-dessous.
       SELECT p.id, p.geom
         FROM poste_source p
         JOIN deps_couverts d ON d.code_departement = p.code_departement
     )
     SELECT c.code_insee,
            (SELECT round((ST_Distance(c.geom::geography, q.geom::geography) / 1000.0)::numeric, 3)
               -- Departage par identifiant : deux postes exactement equidistants existent (postes
               -- jumeles sur un meme site). La distance retenue serait la meme, mais un tri sans
               -- ordre total est une troncature au hasard, et le garde pagination-stable la refuse
               -- a juste titre — c'est ce genre d'oubli qui rend un resultat non reproductible.
               FROM postes q ORDER BY c.geom <-> q.geom, q.id LIMIT 1) AS distance_poste_km,
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
