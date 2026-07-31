/**
 * Chargement du fichier `.env`.
 *
 * La documentation d'installation demande de copier `.env.example` en `.env` : il faut donc
 * que ce fichier soit effectivement lu, sinon les reglages qu'on y ecrit n'ont aucun effet
 * et le diagnostic est deroutant.
 *
 * Deux garanties :
 *   - **l'environnement prime sur le fichier** (semantique de `process.loadEnvFile`), ce qui
 *     laisse Docker et les ordonnanceurs maitres de leurs variables ;
 *   - la recherche remonte l'arborescence, pour que `npm run dev -w @enr/api` (lance depuis
 *     apps/api) trouve le meme `.env` que `npm run dev` a la racine.
 *
 * Aucune dependance : `process.loadEnvFile` est fourni par Node depuis la version 20.12.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function trouverFichierEnv(): string | null {
  const explicite = process.env['ENV_FILE'];
  if (explicite) return existsSync(explicite) ? resolve(explicite) : null;

  let repertoire = process.cwd();
  // Quatre niveaux suffisent : apps/api -> apps -> racine du depot.
  for (let i = 0; i < 4; i += 1) {
    const candidat = join(repertoire, '.env');
    if (existsSync(candidat)) return candidat;
    const parent = resolve(repertoire, '..');
    if (parent === repertoire) break;
    repertoire = parent;
  }
  return null;
}

/** Chemin du `.env` charge, ou `null`. Consigne au demarrage pour lever toute ambiguite. */
export const fichierEnvCharge: string | null = (() => {
  const fichier = trouverFichierEnv();
  if (!fichier) return null;
  try {
    process.loadEnvFile(fichier);
    return fichier;
  } catch {
    // Un `.env` illisible ou mal forme ne doit pas empecher le demarrage : les valeurs par
    // defaut et l'environnement suffisent a servir l'application.
    return null;
  }
})();
