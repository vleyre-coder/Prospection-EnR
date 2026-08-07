/**
 * Capture des fiches REELLES, pour servir de fixtures aux tests de rendu de l'interface.
 *
 * POURQUOI CE SCRIPT EXISTE. Les tests de rendu ajoutes a `apps/web/test` montent les vrais
 * composants React et verifient le HTML reellement produit. La question est : sur quelles donnees ?
 *
 * Une fixture ecrite a la main ne prouverait presque rien. Elle contiendrait ce que j'imagine d'une
 * fiche, donc les cas auxquels j'ai pense — et les defauts vivent dans les autres. Les quatre
 * defauts de l'audit 10 le montrent : B1 n'apparaissait que sur certaines valeurs de surface, B2 que
 * sur les seuils de procedure d'une filiere. Une fixture inventee les aurait tous manques.
 *
 * Ce script prend donc la reponse EXACTE de la route, pour de vraies parcelles de la base, via
 * `app.inject()` — le meme chemin de code que sert un navigateur, sans serveur a demarrer ni reseau.
 *
 * Les fixtures sont commitees : un test qui depend d'une base locale ne tourne pas en CI, et le but
 * est precisement que ces verifications soient rejouees a chaque fois. Les regenerer se fait par
 * `npx tsx apps/api/scripts/capturer-fixtures-web.ts` avec `DATABASE_URL` pointant sur une base
 * peuplee.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construireServeur } from '../src/serveur.js';
import { pool } from '../src/bdd.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const DESTINATION = resolve(ICI, '../../web/test/fixtures');

/**
 * Les cas captures, et la raison de chacun.
 *
 * Le risque F2 de l'audit 10 est explicite : un seul rapport avait ete relu en entier, sur une
 * parcelle agricole en Beauce. Les quatre filieres ne produisent pas les memes phrases — la
 * methanisation a son tableau d'intrants, l'eolien ses distances d'eloignement — et une parcelle
 * ecartee en produit d'autres encore. Chacun de ces cas est donc capture.
 */
const CAS = [
  { nom: 'grande-solaire', idu: '283900000A0094', filiere: 'solaire_sol', pourquoi: 'parcelle de 19,84 ha : cas nominal, celui deja relu' },
  { nom: 'grande-eolien', idu: '283900000A0094', filiere: 'eolien_terrestre', pourquoi: 'meme parcelle, criteres d\'eloignement et de vent' },
  { nom: 'grande-bess', idu: '283900000A0094', filiere: 'bess', pourquoi: 'meme parcelle, profil stockage' },
  { nom: 'grande-methanisation', idu: '283900000A0094', filiere: 'methanisation', pourquoi: 'meme parcelle, tableau d\'intrants et debouches' },
  { nom: 'minuscule-solaire', idu: '283900000C0843', filiere: 'solaire_sol', pourquoi: 'parcelle de 0,09 ha : LA PARCELLE ECARTEE, seuils de surface franchis' },
] as const;

const SECRET = 'secret-de-capture-uniquement';

async function principal(): Promise<void> {
  const app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  mkdirSync(DESTINATION, { recursive: true });

  /**
   * Un compte de LECTURE, deliberement.
   *
   * La fiche capturee est celle que voit le profil le moins privilegie : aucune donnee de
   * proprietaire n'y figure, et les fixtures peuvent donc etre commitees sans question RGPD. Le
   * jeton n'est signe qu'ici, avec un secret de capture qui n'ouvre rien d'autre.
   */
  const entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'capture@local',
      nom: 'capture',
      role: 'lecture',
      habiliteDonneesProprietaires: false,
    })}`,
  };

  const referentiel = await app.inject({ method: 'GET', url: '/api/referentiel', headers: entetes });
  if (referentiel.statusCode !== 200) {
    throw new Error(`Referentiel indisponible : ${referentiel.statusCode} ${referentiel.body.slice(0, 200)}`);
  }
  writeFileSync(
    resolve(DESTINATION, 'referentiel.json'),
    `${JSON.stringify(referentiel.json(), null, 2)}\n`,
  );
  console.log('referentiel.json ecrit');

  const index: Array<{ nom: string; idu: string; filiere: string; pourquoi: string }> = [];
  for (const cas of CAS) {
    const rep = await app.inject({
      method: 'GET',
      url: `/api/parcelles/${cas.idu}?filiere=${cas.filiere}`,
      headers: entetes,
    });
    if (rep.statusCode !== 200) {
      throw new Error(`${cas.nom} : ${rep.statusCode} ${rep.body.slice(0, 300)}`);
    }
    writeFileSync(
      resolve(DESTINATION, `fiche-${cas.nom}.json`),
      `${JSON.stringify(rep.json(), null, 2)}\n`,
    );
    const f = rep.json() as { score?: { note?: number; knockOuts?: unknown[] } };
    console.log(
      `fiche-${cas.nom}.json ecrit — note ${f.score?.note ?? '?'}, ${f.score?.knockOuts?.length ?? 0} knock-out(s)`,
    );
    index.push({ nom: cas.nom, idu: cas.idu, filiere: cas.filiere, pourquoi: cas.pourquoi });
  }

  writeFileSync(resolve(DESTINATION, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  /**
   * La liste et le tableau de bord, sur la filiere solaire.
   *
   * La liste est capturee SANS emprise et triee par score : c'est la vue la plus chargee, et celle
   * qui a porte le defaut B1 de l'audit 7 — les knock-outs ne remontaient pas jusqu'a elle, si bien
   * qu'une parcelle juridiquement fermee s'y presentait avec un score ordinaire.
   */
  const liste = await app.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    headers: entetes,
    payload: { filiere: 'solaire_sol', tri: 'score_desc', limite: 50 },
  });
  if (liste.statusCode !== 200) {
    throw new Error(`liste : ${liste.statusCode} ${liste.body.slice(0, 300)}`);
  }
  writeFileSync(resolve(DESTINATION, 'liste-solaire.json'), `${JSON.stringify(liste.json(), null, 2)}\n`);
  const l = liste.json() as { total: number; resultats: unknown[] };
  console.log(`liste-solaire.json ecrit — ${l.resultats.length} lignes sur ${l.total}`);

  /**
   * La liste eolienne, capturee parce qu'elle contient LE cas qui compte.
   *
   * Une seule parcelle du jeu est qualifiee en eolien, et c'est celle qui est ecartee : statut rouge,
   * un knock-out bloquant. C'est exactement la ligne que le defaut B1 de l'audit 7 laissait passer
   * pour une parcelle ordinaire.
   */
  const listeEolien = await app.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    headers: entetes,
    payload: { filiere: 'eolien_terrestre', tri: 'score_desc', limite: 50 },
  });
  if (listeEolien.statusCode !== 200) {
    throw new Error(`liste eolien : ${listeEolien.statusCode} ${listeEolien.body.slice(0, 300)}`);
  }
  writeFileSync(
    resolve(DESTINATION, 'liste-eolien.json'),
    `${JSON.stringify(listeEolien.json(), null, 2)}\n`,
  );
  const le = listeEolien.json() as {
    resultats: Array<{ nbKnockOutsBloquants: number }>;
  };
  console.log(
    `liste-eolien.json ecrit — ${le.resultats.length} ligne(s), ${le.resultats.filter((x) => x.nbKnockOutsBloquants > 0).length} avec knock-out bloquant`,
  );

  const bord = await app.inject({
    method: 'GET',
    url: '/api/tableau-de-bord?filiere=solaire_sol',
    headers: entetes,
  });
  if (bord.statusCode !== 200) {
    throw new Error(`tableau de bord : ${bord.statusCode} ${bord.body.slice(0, 300)}`);
  }
  writeFileSync(
    resolve(DESTINATION, 'tableau-de-bord-solaire.json'),
    `${JSON.stringify(bord.json(), null, 2)}\n`,
  );
  console.log('tableau-de-bord-solaire.json ecrit');

  await app.close();
  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
