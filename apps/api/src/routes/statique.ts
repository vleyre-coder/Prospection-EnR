/**
 * Service de l'interface web par l'API.
 *
 * En developpement, Vite sert l'interface sur son propre port avec le rechargement a
 * chaud : ce module ne fait alors rien. Mais pour une simple mise en service locale,
 * demander a l'utilisateur de lancer deux processus et de retenir deux ports est une
 * complication inutile — des lors que `apps/web/dist` existe, l'API le sert elle-meme
 * et une seule adresse suffit.
 *
 * En deploiement par conteneurs, nginx garde ce role : il apporte la compression et le
 * cache d'entetes que Fastify n'a pas ici.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Emplacement du build de l'interface, ou `null` s'il n'y en a pas.
 * Candidats du plus explicite au plus courant.
 */
export function repertoireInterface(): string | null {
  if (!config.web.servirStatique) return null;

  const candidats = [
    config.web.repertoireStatique,
    // Depuis apps/api/dist/routes/ ou apps/api/src/routes/ vers apps/web/dist.
    join(ici, '..', '..', '..', 'web', 'dist'),
    // Image de conteneur ou l'interface est copiee a cote de l'API.
    join(ici, '..', 'public'),
  ].filter((c) => c.length > 0);

  for (const c of candidats) {
    const abs = resolve(c);
    if (existsSync(join(abs, 'index.html'))) return abs;
  }
  return null;
}

/**
 * Options de @fastify/static. L'enregistrement lui-meme reste dans le serveur, qui pose
 * aussi le repli page unique : les deux doivent rester coherents.
 *
 * `cacheControl: false` est indispensable : laisse actif, le plugin ecrit son propre
 * `Cache-Control: public, max-age=0` APRES `setHeaders`, et les assets ne seraient jamais
 * mis en cache par le navigateur.
 */
export function optionsStatique(racine: string): {
  root: string;
  index: string[];
  cacheControl: false;
  setHeaders: (rep: { setHeader: (k: string, v: string) => void }, chemin: string) => void;
} {
  return {
    root: racine,
    index: ['index.html'],
    cacheControl: false,
    setHeaders: (rep, chemin) => {
      // Les fichiers d'assets sont versionnes par empreinte : ils sont immuables. Le
      // document HTML, lui, ne doit jamais etre mis en cache, sinon un deploiement
      // continuerait de servir les anciens assets.
      const immuable = chemin.includes(`${sep}assets${sep}`) || chemin.includes('/assets/');
      rep.setHeader(
        'Cache-Control',
        immuable ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  };
}
