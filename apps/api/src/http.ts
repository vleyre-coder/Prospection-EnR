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
  timeoutMs?: number;
}

/**
 * Effectue une requete JSON avec cache, tentatives et limitation de concurrence.
 * Leve une `ErreurSource` en cas d'echec definitif : l'appelant doit alors laisser les
 * champs concernes a null plutot que d'inventer une valeur.
 */
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
  const tentatives = options.tentatives ?? config.http.tentatives;
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
          throw new ErreurSource(
            options.connecteur,
            url,
            `Reponse ${reponse.status} de la source`,
            reponse.status,
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
          const attenteMs = 400 * 2 ** (essai - 1);
          journal.debug(
            { connecteur: options.connecteur, essai, attenteMs, url: url.slice(0, 120) },
            'Nouvelle tentative vers une source externe',
          );
          await attendre(attenteMs);
        }
      } finally {
        clearTimeout(minuteur);
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
