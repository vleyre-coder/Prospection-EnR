/**
 * Lecture en flux d'un GeoJSON volumineux.
 *
 * Certaines couches nationales ne sont publiees que sous forme de fichier complet : la base
 * des monuments historiques pese par exemple 220 Mo pour 46 000 entites. Un `JSON.parse`
 * global demanderait plusieurs gigaoctets de memoire ; on extrait donc les entites une a une
 * au fil du telechargement, en ne conservant dans le tampon que la portion non encore
 * consommee.
 *
 * L'extraction est faite par suivi de profondeur d'accolades, en tenant compte des chaines
 * et des echappements : c'est suffisant et exact pour la structure d'un GeoJSON, sans
 * dependance a une bibliotheque de parsing incremental.
 */

import { jsonExterne } from '../http.js';

export interface EntiteGeoJson {
  type: string;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

/**
 * Parcourt les entites d'un `FeatureCollection` distant.
 *
 * @param url URL du fichier GeoJSON.
 * @param signal Permet d'interrompre le telechargement.
 */
/**
 * Automate d'extraction des entites d'un tableau `features`, sur un flux de morceaux.
 *
 * SEPARE DU TELECHARGEMENT, et c'est le point : c'est un analyseur JSON incremental ecrit a la
 * main, avec un etat de chaine, d'echappement et de profondeur. Un defaut y corrompt 46 000
 * objets en silence, et il n'etait couvert par aucun test parce qu'il etait soude a `fetch`.
 * Sous cette forme, il se verifie avec des morceaux decoupes a la main — y compris aux endroits
 * ou un tel automate casse : au milieu d'une chaine, d'un echappement, ou d'une accolade.
 *
 * Tolerant par choix : une entite illisible est ignoree plutot que d'interrompre l'ingestion
 * entiere. Le compteur d'entites ignorees est de la responsabilite de l'appelant.
 */
export async function* entitesDepuisMorceaux(
  morceaux: AsyncIterable<string>,
): AsyncGenerator<EntiteGeoJson> {
  let tampon = '';
  let position = 0;
  let dansTableau = false;
  let profondeur = 0;
  let debutEntite = -1;
  let dansChaine = false;
  let echappement = false;
  let termine = false;
  let vu = false;

  for await (const morceau of morceaux) {
    if (termine) break;
    vu = true;
    tampon += morceau;

    // Localisation du tableau `features`, une seule fois.
    if (!dansTableau) {
      const cle = tampon.indexOf('"features"');
      if (cle === -1) {
        // La cle n'est pas encore arrivee : on conserve un tampon borne, le temps qu'elle
        // apparaisse (l'en-tete d'un GeoJSON est court).
        if (tampon.length > 1_000_000) {
          throw new Error("Le document ne contient pas de tableau `features`");
        }
        continue;
      }
      const crochet = tampon.indexOf('[', cle);
      if (crochet === -1) continue;
      dansTableau = true;
      tampon = tampon.slice(crochet + 1);
      position = 0;
    }

    // Extraction des entites completes presentes dans le tampon.
    const entites: string[] = [];
    while (position < tampon.length) {
      const c = tampon[position]!;

      if (dansChaine) {
        if (echappement) echappement = false;
        else if (c === '\\') echappement = true;
        else if (c === '"') dansChaine = false;
        position += 1;
        continue;
      }

      if (c === '"') {
        dansChaine = true;
        position += 1;
        continue;
      }

      if (c === '{') {
        if (profondeur === 0) debutEntite = position;
        profondeur += 1;
        position += 1;
        continue;
      }

      if (c === '}') {
        profondeur -= 1;
        position += 1;
        if (profondeur === 0 && debutEntite >= 0) {
          entites.push(tampon.slice(debutEntite, position));
          debutEntite = -1;
          // La portion consommee est liberee : le tampon reste de taille bornee.
          tampon = tampon.slice(position);
          position = 0;
        }
        continue;
      }

      // Fin du tableau `features` au niveau superieur.
      if (c === ']' && profondeur === 0) {
        termine = true;
        break;
      }

      position += 1;
    }

    for (const brut of entites) {
      try {
        yield JSON.parse(brut) as EntiteGeoJson;
      } catch {
        // Entite illisible : on l'ignore plutot que d'interrompre toute l'ingestion.
      }
    }
  }

  if (vu && !dansTableau) {
    throw new Error("Le document ne contient pas de tableau `features`");
  }
}

/** Morceaux de texte d'une reponse HTTP, decodes en UTF-8 au fil de l'eau. */
async function* morceauxHttp(url: string, signal?: AbortSignal): AsyncGenerator<string> {
  const reponse = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/geo+json, application/json',
      'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
    },
  });
  if (!reponse.ok || !reponse.body) {
    throw new Error(`Telechargement impossible (${reponse.status}) : ${url}`);
  }
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (value) yield decodeur.decode(value, { stream: true });
    if (done) {
      const reste = decodeur.decode();
      if (reste) yield reste;
      return;
    }
  }
}

/**
 * Entites d'un GeoJSON distant, lues EN FLUX.
 *
 * Le fichier national des monuments historiques pese environ 220 Mo pour 46 000 entites : le
 * charger en memoire n'est pas envisageable.
 */
export async function* entitesDepuisFlux(
  url: string,
  signal?: AbortSignal,
): AsyncGenerator<EntiteGeoJson> {
  yield* entitesDepuisMorceaux(morceauxHttp(url, signal));
}

/**
 * Resout l'URL d'une ressource d'un jeu de donnees data.gouv.fr.
 *
 * Les URL de ressources portent un horodatage et changent a chaque publication : les
 * resoudre a l'execution evite qu'une mise a jour du jeu ne casse l'ingestion.
 */
export async function urlRessourceDataGouv(
  idJeu: string,
  format: string,
): Promise<{ url: string; derniereMaj: string | null }> {
  // data.gouv.fr renvoie regulierement des 503 transitoires : on passe par le client HTTP de
  // l'application, avec le profil PATIENT. Le profil reactif attend 1,2 seconde en tout, ce qui
  // convient a un appel par parcelle mais fait abandonner une ingestion nationale pour rien.
  const jeu = await jsonExterne<{
    last_update?: string;
    resources?: Array<{ format?: string; url?: string }>;
  }>(`https://www.data.gouv.fr/api/1/datasets/${idJeu}/`, {
    connecteur: 'data_gouv',
    profilAttente: 'patient',
    timeoutMs: 30000,
  });
  const ressource = jeu.resources?.find((r) => (r.format ?? '').toLowerCase() === format.toLowerCase());
  if (!ressource?.url) {
    throw new Error(`Aucune ressource au format ${format} dans le jeu ${idJeu}`);
  }
  return { url: ressource.url, derniereMaj: jeu.last_update?.slice(0, 10) ?? null };
}
