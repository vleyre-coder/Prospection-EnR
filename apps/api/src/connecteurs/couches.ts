/**
 * Presence des couches ingerees, type par type.
 *
 * POURQUOI CE MODULE EXISTE. L'audit 8 a trouve le defaut le plus grave des huit audits, et sa
 * cause tient en une phrase : `patrimoine()` lisait la table `contrainte` pour quatre types
 * (`monument_historique`, `site_classe`, `site_inscrit`, `spr`) alors qu'un seul est ingere, et
 * transformait les trois listes vides en absences CONSTATEES. Le critere `pat_sites` valait donc
 * 90/100, feu vert, avec la phrase « Aucun site classe ni inscrit dans le rayon d'analyse », partout
 * en France, sur zero donnee. Le knock-out eolien du site classe etait, du meme coup,
 * structurellement inatteignable.
 *
 * `gisement.ts` portait la meme faute sous une autre forme : UN seul `EXISTS ... type = ANY(...)`
 * pour TROIS couches. Une base ou une seule des trois serait ingeree affirmerait zero sur les deux
 * autres — exactement ce que le commentaire du fichier disait vouloir eviter.
 *
 * La lecon est generale : **une question posee globalement ne peut pas repondre par couche.** Ce
 * module ne repond donc jamais par un booleen unique, mais par un verdict PAR TYPE.
 *
 * DEUX GRANULARITES, et il faut les deux.
 *
 *   - `couchesPresentes` repond « cette couche existe-t-elle quelque part ? ». C'est la question
 *     minimale, et elle suffit a ne pas affirmer sur une couche absente.
 *   - `couchesPresentesDansDepartement` repond « sait-on quelque chose de CE departement pour cette
 *     couche ? », en s'appuyant sur `couverture_ingestion`. C'est la bonne question : une base
 *     ingeree pour le seul departement 45 ne doit rien affirmer sur une parcelle du 06. L'ancien
 *     `patrimoine()` interrogeait `couverture_ingestion` SANS filtre de departement, alors que la
 *     table est precisement clé-primairée par departement.
 *
 * Le resultat est mis en cache : la reponse ne change qu'apres une ingestion, et la question serait
 * posee une fois par parcelle sur des lots de plusieurs centaines.
 */

import { requete } from '../bdd.js';

/** Duree de cache. Une ingestion appelle `oublierPresenceCouches()` et n'attend donc pas. */
const DUREE_CACHE_MS = 5 * 60 * 1000;

interface Entree {
  valeur: Record<string, boolean>;
  expire: number;
}

const cache = new Map<string, Entree>();

function cle(prefixe: string, types: readonly string[], departement?: string): string {
  return `${prefixe}|${departement ?? ''}|${[...types].sort().join(',')}`;
}

/**
 * Toutes les couches demandees a `false` : la reponse prudente.
 *
 * Utilisee quand la base est injoignable. On ne peut alors PAS affirmer qu'une couche existe,
 * donc chaque critere concerne restera gris — ce qui est le comportement voulu.
 */
function aucune(types: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(types.map((t) => [t, false]));
}

/**
 * Pour chaque type demande : la couche contient-elle au moins un objet ?
 *
 * Une seule requete pour tous les types : la question est posee par parcelle, et un aller-retour
 * par type multiplierait les requetes sans rien apporter.
 */
export async function couchesPresentes(
  types: readonly string[],
): Promise<Record<string, boolean>> {
  const k = cle('globale', types);
  const enCache = cache.get(k);
  if (enCache && enCache.expire > Date.now()) return enCache.valeur;

  try {
    const lignes = await requete<{ type: string }>(
      `SELECT type FROM contrainte WHERE type = ANY($1) GROUP BY type`,
      [[...types]],
    );
    const presents = new Set(lignes.map((l) => l.type));
    const valeur = Object.fromEntries(types.map((t) => [t, presents.has(t)]));
    cache.set(k, { valeur, expire: Date.now() + DUREE_CACHE_MS });
    return valeur;
  } catch {
    return aucune(types);
  }
}

/**
 * Pour chaque type demande : sait-on quelque chose de ce departement ?
 *
 * S'appuie sur `couverture_ingestion`, dont c'est la raison d'etre. Un type absent de la table
 * pour ce departement vaut `false` — « on n'a pas regarde ici » — et non « il n'y a rien ici ».
 */
export async function couchesPresentesDansDepartement(
  types: readonly string[],
  codeDepartement: string,
): Promise<Record<string, boolean>> {
  const k = cle('departement', types, codeDepartement);
  const enCache = cache.get(k);
  if (enCache && enCache.expire > Date.now()) return enCache.valeur;

  try {
    const lignes = await requete<{ type: string }>(
      `SELECT type FROM couverture_ingestion
        WHERE type = ANY($1) AND code_departement = $2 AND nb_objets > 0
        GROUP BY type`,
      [[...types], codeDepartement],
    );
    const presents = new Set(lignes.map((l) => l.type));
    const valeur = Object.fromEntries(types.map((t) => [t, presents.has(t)]));
    cache.set(k, { valeur, expire: Date.now() + DUREE_CACHE_MS });
    return valeur;
  } catch {
    return aucune(types);
  }
}

/** Reinitialise le cache. A appeler apres toute ingestion. */
export function oublierPresenceCouches(): void {
  cache.clear();
}
