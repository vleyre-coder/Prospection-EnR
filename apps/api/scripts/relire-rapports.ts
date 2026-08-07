/**
 * Relit un rapport PDF pour CHAQUE filiere et pour une parcelle ecartee.
 *
 * POURQUOI CE SCRIPT EXISTE — audit 10, risque F2. Le rapport avait ete relu en entier une fois, sur
 * une parcelle agricole en Beauce, en solaire au sol. C'est la relecture qui a trouve le defaut B2
 * (sept dates ISO par rapport). Mais les quatre filieres ne produisent pas les memes pages : la
 * methanisation ajoute son tableau d'intrants et ses rubriques IOTA, l'eolien ses distances
 * d'eloignement, et une parcelle ECARTEE remplace la synthese chiffree par des motifs eliminatoires.
 * Trois familles de phrases entieres n'avaient donc jamais ete regardees.
 *
 * Le script genere les rapports par `app.inject()` — la route reelle, sans serveur — extrait leur
 * texte avec `pdftotext`, et rapporte ce qui s'y trouve. Il ne conclut pas : il MESURE, et c'est le
 * rapport d'audit qui conclut.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { construireServeur } from '../src/serveur.js';
import { pool } from '../src/bdd.js';

const SORTIE = process.env['SORTIE_RAPPORTS'] ?? '/tmp/rapports-enr';
const SECRET = 'secret-de-relecture-uniquement';

const CAS = [
  { nom: 'solaire', idu: '283900000A0094', filiere: 'solaire_sol' },
  { nom: 'eolien-ecartee', idu: '283900000A0094', filiere: 'eolien_terrestre' },
  { nom: 'bess', idu: '283900000A0094', filiere: 'bess' },
  { nom: 'methanisation', idu: '283900000A0094', filiere: 'methanisation' },
  { nom: 'minuscule', idu: '283900000C0843', filiere: 'solaire_sol' },
] as const;

/** Suites de chiffres separees par des points, prises entieres (cf. le garde de l'interface). */
const CHAINE_POINTEE = /(?<![\d.])\d+(?:\.\d+)+(?![\d.])/g;

function pointsDecimaux(t: string): string[] {
  return [...t.matchAll(CHAINE_POINTEE)].map((m) => m[0]).filter((s) => s.split('.').length === 2);
}

async function principal(): Promise<void> {
  const app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
  mkdirSync(SORTIE, { recursive: true });
  const entetes = {
    authorization: `Bearer ${app.jwt.sign({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'relecture@local',
      nom: 'relecture',
      role: 'lecture',
      habiliteDonneesProprietaires: false,
    })}`,
  };

  let fautes = 0;
  for (const cas of CAS) {
    const rep = await app.inject({
      method: 'GET',
      url: `/api/exports/parcelle/${cas.idu}.pdf?filiere=${cas.filiere}`,
      headers: entetes,
    });
    if (rep.statusCode !== 200) {
      console.log(`${cas.nom} : ECHEC ${rep.statusCode} ${rep.body.slice(0, 200)}`);
      fautes += 1;
      continue;
    }
    const chemin = resolve(SORTIE, `${cas.nom}.pdf`);
    writeFileSync(chemin, rep.rawPayload);
    execFileSync('pdftotext', ['-layout', chemin, `${chemin}.txt`]);
    const t = readFileSync(`${chemin}.txt`, 'utf8');

    const decimaux = pointsDecimaux(t);
    const iso = [...new Set(t.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
    const pages = (t.match(/\f/g) ?? []).length + 1;
    if (decimaux.length > 0 || iso.length > 0) fautes += 1;

    console.log(
      `${cas.nom.padEnd(16)} ${String(rep.rawPayload.length).padStart(7)} o  ${String(pages).padStart(2)} p  ` +
        `${String(t.length).padStart(6)} car.  points decimaux ${String(decimaux.length).padStart(2)}  dates ISO ${String(iso.length).padStart(2)}` +
        (decimaux.length ? `  → ${[...new Set(decimaux)].slice(0, 6).join(' | ')}` : '') +
        (iso.length ? `  → ${iso.slice(0, 4).join(' | ')}` : ''),
    );
  }

  console.log(`\n${CAS.length - fautes}/${CAS.length} rapports sans faute de forme. Sortie : ${SORTIE}`);
  await app.close();
  await pool.end();
  process.exit(fautes > 0 ? 1 : 0);
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
