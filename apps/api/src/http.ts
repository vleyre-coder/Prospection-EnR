/**
 * Client HTTP pour les sources externes.
 *
 * Toutes les sources publiques francaises sont soumises a des limitations de debit non
 * documentees et a des indisponibilites regulieres. Ce client apporte donc :
 *   - un delai d'attente maximal par requete,
 *   - des tentatives successives avec attente exponentielle,
 *   - une limitation de concurrence par domaine,
 *   - un cache memoire a duree de vie courte,
 *   - une remontee d'erreur explicite (jamais de valeur inventee en cas d'echec).
 */

import { config } from './config.js';
import { journal } from './journal.js';

export class ErreurSource extends Error {
  constructor(
    readonly connecteur: string,
    readonly url: string,
    override readonly message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = 'ErreurSource';
  }
}

interface EntreeCache {
  valeur: unknown;
  expire: number;
}

const cache = new Map<string, EntreeCache>();

/**
 * Plafond du cache memoire.
 *
 * Sans plafond, une entree n'etait jamais supprimee : la duree de vie n'etait verifiee qu'a
 * la LECTURE, si bien qu'une reponse jamais relue restait en memoire indefiniment. Une
 * qualification de 1 000 parcelles emet une douzaine de requetes par parcelle, dont
 * plusieurs `FeatureCollection` de plusieurs dizaines de kilo-octets : le processus
 * grossissait de facon monotone jusqu'a l'echec d'allocation.
 */
const CACHE_MAX_ENTREES = 5000;

/** Supprime les entrees perimees, puis les plus anciennes si le plafond est depasse. */
function purgerCache(): void {
  const maintenant = Date.now();
  for (const [cle, entree] of cache) {
    if (entree.expire <= maintenant) cache.delete(cle);
  }
  if (cache.size <= CACHE_MAX_ENTREES) return;
  // `Map` conserve l'ordre d'insertion : les premieres cles sont les plus anciennes.
  const aRetirer = cache.size - CACHE_MAX_ENTREES;
  let i = 0;
  for (const cle of cache.keys()) {
    if (i >= aRetirer) break;
    cache.delete(cle);
    i += 1;
  }
}

/** Semaphores par domaine, pour ne pas saturer une source. */
const filesAttente = new Map<string, { actifs: number; attente: Array<() => void> }>();

async function acquerir(domaine: string): Promise<() => void> {
  let f = filesAttente.get(domaine);
  if (!f) {
    f = { actifs: 0, attente: [] };
    filesAttente.set(domaine, f);
  }
  if (f.actifs >= config.http.concurrence) {
    await new Promise<void>((resolve) => f!.attente.push(resolve));
  }
  f.actifs += 1;
  return () => {
    f!.actifs -= 1;
    const suivant = f!.attente.shift();
    if (suivant) suivant();
  };
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OptionsRequete {
  connecteur: string;
  methode?: 'GET' | 'POST';
  corps?: unknown;
  enTetes?: Record<string, string>;
  /** Duree de vie du cache pour cette requete. 0 pour desactiver. */
  cacheTtlMs?: number;
  /** Nombre de tentatives, la premiere incluse. */
  tentatives?: number;
  /**
   * Profil d'attente entre deux tentatives.
   *
   * POURQUOI DEUX PROFILS, et pourquoi le defaut n'est pas le plus patient. L'attente etait de
   * 400 ms puis 800 ms, soit 1,2 seconde en tout. C'est le bon ordre de grandeur pour une coupure
   * reseau, et beaucoup trop court pour un 503 : un service qui repond 503 signale une surcharge, et
   * demande d'attendre. Constate a l'execution : l'ingestion des communes a abandonne apres
   * 1,2 seconde et zero objet, et celle des ZAER apres seize secondes.
   *
   * Mais allonger l'attente PARTOUT serait une faute symetrique. Les quatorze connecteurs interroges
   * pendant la qualification d'une parcelle doivent echouer VITE : le critere passe au gris, la
   * qualification continue, et l'echec est remonte. Bloquer trois minutes sur une parcelle parmi
   * plusieurs centaines rendrait une campagne interminable pour rien.
   *
   *   - `reactif` (defaut) : 400 ms, 800 ms. Pour les appels par parcelle.
   *   - `patient` : 5 s, 15 s, 45 s, 120 s. Pour les ingestions, ou l'alternative est de jeter
   *     l'intégralité d'un travail de plusieurs minutes.
   */
  profilAttente?: 'reactif' | 'patient';
  timeoutMs?: number;
}

/**
 * Effectue une requete JSON avec cache, tentatives et limitation de concurrence.
 * Leve une `ErreurSource` en cas d'echec definitif : l'appelant doit alors laisser les
 * champs concernes a null plutot que d'inventer une valeur.
 */
/**
 * Attentes en millisecondes, par profil. Voir `OptionsRequete.profilAttente`.
 *
 * Le profil patient est calibre sur le comportement REEL des services : les valeurs viennent des 503
 * essuyes en ingerant la couche nationale des ZAER, pas d'une progression theorique.
 */
export const ATTENTES_PAR_PROFIL = {
  reactif: [400, 800, 1_600, 3_200],
  patient: [5_000, 15_000, 45_000, 120_000],
} as const;

/** Nombre de tentatives par defaut selon le profil : une ingestion insiste davantage. */
const TENTATIVES_PAR_PROFIL = { reactif: 3, patient: 5 } as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * COUPE-CIRCUIT PAR HOTE — mesure le 26/09/2026 sur une qualification reelle
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE. Une parcelle qualifiee pendant que `georisques.gouv.fr` etait injoignable :
 * **140 secondes**, pour six points d'entree en echec. Le mecanisme n'est pas mysterieux — les
 * connecteurs partent en parallele, mais `acquerir(domaine)` SERIALISE les appels vers un meme
 * hote, et chacun consommait alors son budget complet de reprises. Six fois le meme mur.
 *
 * CE QUE CELA COUTE A L'EXPLOITANT. Apres une ingestion, il faut reprendre les parcelles pour
 * qu'elles voient la nouvelle donnee. A 140 secondes piece, 300 parcelles demandent douze heures —
 * autrement dit, on ne reprend pas. La lenteur d'un service tiers devient une impossibilite
 * d'exploiter la sienne.
 *
 * ═══ IL DEGRADE VERS UNE SEULE TENTATIVE, JAMAIS VERS ZERO
 *
 * Quand un hote a epuise son budget de reprises, il est note « fragile » pour une courte duree :
 * les appels suivants vers CE MEME hote n'ont plus droit qu'a UNE tentative, au lieu de rejouer
 * tout le budget. La requete part quand meme, pour de vrai.
 *
 * MA PREMIERE VERSION LES COURT-CIRCUITAIT ENTIEREMENT, et un test l'a arretee net. Une campagne
 * par grande emprise decoupe le territoire en cellules qui visent TOUTES le meme hote : une seule
 * cellule ayant epuise ses reprises aurait condamne toutes les suivantes pendant trente secondes,
 * transformant un secteur manquant en secteurs manquants par dizaines. Le remede etait pire que le
 * mal — et il ne se serait vu qu'en production, sur une carte avec des trous.
 *
 * La regle est donc : on ne supprime que la REPETITION, jamais l'essai. Un hote qui revient est
 * retrouve des la premiere requete suivante, sans que personne ait a redemarrer quoi que ce soit.
 *
 * LA DUREE EST COURTE — trente secondes — pour deux raisons opposees et egalement importantes :
 * assez longue pour couvrir la qualification en cours, assez breve pour qu'un service qui revient
 * soit reessaye sans que personne ait a redemarrer quoi que ce soit. Un coupe-circuit qui oublie
 * de se refermer est pire que pas de coupe-circuit.
 */
const PANNE_MS = 30_000;
const hotesFragiles = new Map<string, number>();

/** L'hote vient-il d'epuiser ses reprises ? Purge l'entree des qu'elle a expire. */
function hoteFragile(hote: string): boolean {
  const jusqua = hotesFragiles.get(hote);
  if (jusqua == null) return false;
  if (Date.now() >= jusqua) {
    hotesFragiles.delete(hote);
    return false;
  }
  return true;
}

/**
 * Remet tous les hotes en service.
 *
 * Exportee pour les TESTS, et pour eux seuls : sans cela, un test qui fait tomber un hote laisse
 * le suivant echouer immediatement pour une raison qui ne le concerne pas. C'est le genre de
 * couplage qui rend une suite verte ou rouge selon son ordre d'execution.
 */
export function reinitialiserCoupeCircuit(): void {
  hotesFragiles.clear();
}

export async function jsonExterne<T>(url: string, options: OptionsRequete): Promise<T> {
  const methode = options.methode ?? 'GET';
  const ttl = options.cacheTtlMs ?? (methode === 'GET' ? config.http.cacheTtlMs : 0);
  const cleCache = `${methode}:${url}:${options.corps ? JSON.stringify(options.corps) : ''}`;

  if (ttl > 0) {
    const hit = cache.get(cleCache);
    if (hit && hit.expire > Date.now()) return hit.valeur as T;
  }

  const domaine = new URL(url).host;
  const liberer = await acquerir(domaine);
  const profil = options.profilAttente ?? 'reactif';
  const tentativesVoulues =
    options.tentatives ??
    (options.profilAttente ? TENTATIVES_PAR_PROFIL[profil] : config.http.tentatives);
  /*
   * UNE SEULE TENTATIVE SI L'HOTE VIENT DE TOMBER. La requete part quand meme : on retire la
   * REPETITION, pas l'essai. Voir le bloc `hotesFragiles` pour ce que la premiere version cassait.
   */
  const tentatives = hoteFragile(domaine) ? 1 : tentativesVoulues;
  const timeoutMs = options.timeoutMs ?? config.http.timeoutMs;

  try {
    let derniereErreur: Error | null = null;
    for (let essai = 1; essai <= tentatives; essai += 1) {
      const controleur = new AbortController();
      const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
      try {
        const reponse = await fetch(url, {
          method: methode,
          signal: controleur.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Prospection-EnR/0.1 (application de prospection fonciere ENR)',
            ...(options.corps ? { 'Content-Type': 'application/json' } : {}),
            ...(options.enTetes ?? {}),
          },
          body: options.corps ? JSON.stringify(options.corps) : undefined,
        });

        if (reponse.status === 429 || reponse.status >= 500) {
          // `Retry-After` peut valoir un nombre de secondes ou une date HTTP : les deux formes sont
          // admises par la specification, et les services francais utilisent les deux.
          const brut = reponse.headers.get('retry-after');
          let retryAfterMs: number | undefined;
          if (brut) {
            const secondes = Number(brut.trim());
            if (Number.isFinite(secondes) && secondes >= 0) {
              retryAfterMs = secondes * 1000;
            } else {
              const date = Date.parse(brut);
              if (!Number.isNaN(date)) retryAfterMs = Math.max(0, date - Date.now());
            }
          }
          throw Object.assign(
            new ErreurSource(
              options.connecteur,
              url,
              `Reponse ${reponse.status} de la source`,
              reponse.status,
            ),
            retryAfterMs != null ? { retryAfterMs } : {},
          );
        }
        if (!reponse.ok) {
          // 4xx hors 429 : erreur definitive, inutile de reessayer.
          const texte = await reponse.text().catch(() => '');
          throw Object.assign(
            new ErreurSource(
              options.connecteur,
              url,
              `Reponse ${reponse.status} : ${texte.slice(0, 200)}`,
              reponse.status,
            ),
            { definitive: true },
          );
        }

        const contenu = reponse.headers.get('content-type') ?? '';
        const valeur = contenu.includes('json') ? await reponse.json() : await reponse.text();
        if (ttl > 0) {
          // Purge amortie : declenchee seulement quand le plafond est atteint, pour ne pas
          // parcourir la table a chaque reponse.
          if (cache.size >= CACHE_MAX_ENTREES) purgerCache();
          cache.set(cleCache, { valeur, expire: Date.now() + ttl });
        }
        return valeur as T;
      } catch (err) {
        derniereErreur = err as Error;
        if ((err as { definitive?: boolean }).definitive) break;
        if (essai < tentatives) {
          const paliers = ATTENTES_PAR_PROFIL[profil];
          /**
           * `Retry-After` est HONORE quand le service le fournit.
           *
           * C'est la seule indication fiable du delai a respecter : nos paliers sont une estimation,
           * l'en-tete est une consigne. Il est borne a cinq minutes pour qu'un service mal configure ne
           * fige pas une ingestion indefiniment.
           */
          const consigne = (err as { retryAfterMs?: number }).retryAfterMs;
          const attenteMs =
            consigne != null && consigne > 0
              ? Math.min(consigne, 300_000)
              : (paliers[essai - 1] ?? paliers[paliers.length - 1]!);
          // `info` et non `debug` sur le profil patient : une attente de deux minutes doit se voir dans
          // les journaux d'exploitation, sinon une ingestion lente parait bloquee.
          const consigner = profil === 'patient' ? journal.info : journal.debug;
          consigner.call(
            journal,
            { connecteur: options.connecteur, essai, attenteMs, profil, url: url.slice(0, 120) },
            'Nouvelle tentative vers une source externe',
          );
          await attendre(attenteMs);
        }
      } finally {
        clearTimeout(minuteur);
      }
    }
    /*
     * BUDGET EPUISE : l'hote est note en panne. Une erreur DEFINITIVE (4xx hors 429) n'y entre
     * pas — elle dit que CETTE requete est mauvaise, pas que le service est tombe. Couper l'hote
     * sur un 404 ferait passer pour injoignable un service qui repond parfaitement.
     */
    if (!(derniereErreur as { definitive?: boolean } | null)?.definitive) {
      const deja = hoteFragile(domaine);
      hotesFragiles.set(domaine, Date.now() + PANNE_MS);
      // Une seule fois par fenetre : sinon une campagne de trois cents cellules ecrit trois cents
      // lignes identiques, et l'avertissement se noie dans sa propre repetition.
      if (!deja) {
        journal.warn(
          { connecteur: options.connecteur, hote: domaine, fenetreMs: PANNE_MS },
          'Hote injoignable apres toutes les tentatives : les appels suivants n’auront qu’un essai',
        );
      }
    }
    throw derniereErreur instanceof ErreurSource
      ? derniereErreur
      : new ErreurSource(options.connecteur, url, derniereErreur?.message ?? 'Echec inconnu');
  } finally {
    liberer();
  }
}

/** Construit une URL avec parametres, en ignorant les valeurs nulles. */
export function avecParams(base: string, params: Record<string, string | number | undefined | null>): string {
  const u = new URL(base);
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur == null || valeur === '') continue;
    u.searchParams.set(cle, String(valeur));
  }
  return u.toString();
}

export function viderCacheHttp(): void {
  cache.clear();
}
