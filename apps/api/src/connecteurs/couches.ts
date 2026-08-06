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

interface EntreeEnsemble {
  valeur: Set<string>;
  expire: number;
}

/** Cache distinct : la valeur est un ensemble de departements, pas un verdict par type. */
const cacheEnsembles = new Map<string, EntreeEnsemble>();

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

/**
 * Departements couverts pour un type, sous forme d'ensemble.
 *
 * Complete `couchesPresentesDansDepartement`, qui repond pour UN departement connu d'avance. Ici la
 * question vient dans l'autre sens : on dispose d'une liste de departements — ceux qu'un rayon de
 * recherche traverse — et il faut savoir s'ils sont TOUS couverts.
 */
async function departementsCouverts(type: string): Promise<Set<string>> {
  const k = cle('ensemble', [type]);
  const enCache = cacheEnsembles.get(k);
  if (enCache && enCache.expire > Date.now()) return enCache.valeur;

  try {
    const lignes = await requete<{ code_departement: string }>(
      `SELECT code_departement FROM couverture_ingestion
        WHERE type = $1 AND nb_objets > 0
        GROUP BY code_departement`,
      [type],
    );
    const valeur = new Set(lignes.map((l) => l.code_departement));
    cacheEnsembles.set(k, { valeur, expire: Date.now() + DUREE_CACHE_MS });
    return valeur;
  } catch {
    // Base injoignable : aucun departement n'est declare couvert, donc rien ne sera affirme.
    return new Set();
  }
}

/**
 * UNE DISTANCE AU PLUS PROCHE N'EST UNE MESURE QUE SI LE DISQUE QU'ELLE PARCOURT EST INGERE.
 *
 * POURQUOI CETTE FONCTION EXISTE — audit 9, defaut A3. `couchesPresentesDansDepartement` avait
 * ferme le cas du « type non ingere du tout », mais pas celui de la RECHERCHE DE PROXIMITE, qui est
 * different : chercher l'objet le plus proche d'un point revient a balayer un disque, et ce disque
 * ne s'arrete pas a la frontiere du departement de la parcelle.
 *
 * Le cas concret. L'ingestion des postes sources parcourt les treize regions une par une et tolere
 * l'echec de l'une d'elles — elle enregistre alors le statut « partiel ». Si l'Ile-de-France echoue,
 * la table contient toute la France sauf huit departements. Une parcelle en Seine-et-Marne se voit
 * alors attribuer le poste le plus proche... en region Centre, a 90 km, et cette distance est notee
 * comme une mesure : la parcelle devient ROUGE sur le critere le plus lourd du profil, pour une
 * raison de raccordement qui n'existe pas. C'est le defaut B1 de l'audit 8 retourne — non plus un
 * faux vert par absence de donnee, mais un faux rouge par TROU dans la donnee.
 *
 * La regle est donc : la distance `d` mesuree depuis `pt` n'est exploitable que si tous les
 * departements que le disque de rayon `d` autour de `pt` traverse sont couverts. Un departement
 * non couvert dans ce disque pourrait contenir un objet plus proche : `d` n'est alors pas une
 * distance, c'est une borne superieure, et le critere doit rester gris.
 *
 * Le disque est resolu sur `commune`, qui est ingeree pour la France entiere : un disque qui deborde
 * en mer ou a l'etranger ne rapporte aucun departement de ce cote, ce qui est correct — il n'y a pas
 * de poste source francais hors de France.
 */
export async function disqueEntierementCouvert(
  type: string,
  pt: readonly [number, number],
  rayonM: number,
): Promise<boolean> {
  try {
    const [couverts, traverses] = await Promise.all([
      departementsCouverts(type),
      requete<{ code_departement: string }>(
        /**
         * Recherche en ESPACE GEOMETRIQUE, avec une marge en degres, et non en geographie.
         *
         * `ST_DWithin(geom::geography, ...)` etait la formulation naturelle, et elle a ete mesuree :
         * 3 434 ms par appel. La cause est le transtypage, qui interdit l'usage de l'index GiST pose
         * sur `geom` et force la conversion des 34 875 multipolygones communaux a chaque parcelle.
         * En espace geometrique, l'index sert : 4,4 ms, soit 780 fois moins. Sur un lot de 500
         * parcelles, l'ecart est de 28 minutes.
         *
         * La marge est calculee sur le degre de LONGITUDE, le plus court aux latitudes francaises.
         * Le disque en degres devient donc une ellipse allongee nord-sud qui CONTIENT le disque
         * metrique demande : la verification porte sur un territoire un peu plus grand que
         * necessaire, ce qui exige un peu plus de couverture — l'erreur va dans le sens prudent.
         * Verifie sur ce point : a 45 km, la version geometrique retient 28, 41, 45, 78, 91 et
         * ecarte le 77, dont le bord est a 51,4 km.
         */
        `SELECT code_departement FROM commune
          WHERE code_departement IS NOT NULL
            AND ST_DWithin(
                  geom,
                  ST_SetSRID(ST_MakePoint($1, $2), 4326),
                  -- Le plancher sur le cosinus evite une marge infinie pres des poles ; aucun
                  -- territoire francais n'y est, mais une fonction ne doit pas dependre de cela.
                  $3 / (111320 * GREATEST(cos(radians($2)), 0.2))
                )
          GROUP BY code_departement`,
        [pt[0], pt[1], rayonM],
      ),
    ]);
    // Aucun departement traverse : le referentiel communal n'est pas ingere, ou le point est hors
    // de France. Dans les deux cas on ne peut rien garantir.
    if (traverses.length === 0) return false;
    return traverses.every((l) => couverts.has(l.code_departement));
  } catch {
    return false;
  }
}

/** Reinitialise le cache. A appeler apres toute ingestion. */
export function oublierPresenceCouches(): void {
  cache.clear();
  cacheEnsembles.clear();
}
