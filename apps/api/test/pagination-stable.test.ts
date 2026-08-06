/**
 * Completude et reproductibilite des listes triees.
 *
 * POURQUOI CE FICHIER EXISTE — audit 9, defaut A1. Toutes les listes de l'application sont triees
 * puis tronquees : la liste des parcelles (`filtrerParcelles`), le CSV qui en est exporte, les
 * parcelles dessinees sur la carte, les leads, les suggestions de recherche. Aucune ne portait de
 * departage : le tri s'arretait au critere demande — le score, la surface, la date.
 *
 * Or `ORDER BY score` ne definit AUCUN ordre entre parcelles de meme score, et le score est arrondi
 * au dixieme : sur 0-100 il n'existe que 1 001 valeurs, donc une campagne departementale de 200 000
 * parcelles compte quelques centaines d'ex aequo par valeur. PostgreSQL est alors libre de renvoyer
 * les ex aequo dans l'ordre qui l'arrange, et il en change selon le plan retenu. Mesures faites sur
 * 200 000 lignes, requete et donnees identiques, seul le plan differant :
 *
 *   - `LIMIT 300` : 113 des 300 parcelles renvoyees changent (38 %) entre plan sequentiel et plan
 *     parallele ; 107 changent apres la simple creation d'un index.
 *   - `LIMIT 25 OFFSET 0` puis `OFFSET 25` : 20 des 25 parcelles de la page 2 etaient DEJA sur la
 *     page 1, et 21 des 50 meilleures n'apparaissaient sur aucune des deux pages.
 *
 * Consequence metier : « les 300 meilleures parcelles » n'etait pas une liste, c'etait un tirage.
 * Deux prospecteurs aux memes filtres n'obtenaient pas les memes parcelles, le meme prospecteur
 * n'obtenait pas deux fois la meme liste, et des parcelles du haut du classement restaient
 * invisibles sans le moindre signe. C'est la famille de defauts des audits precedents — affirmer
 * plus que ce que la donnee permet — appliquee au CLASSEMENT.
 *
 * CE QUE CES TESTS VERIFIENT, et pourquoi ils ne peuvent pas passer a vide : ils paginent une
 * population reellement inseree en base et exigent que la reunion des pages soit EXACTEMENT la
 * population. Sur 200 parcelles ex aequo paginees par 20, la version sans departage en perd 3 de
 * facon reproductible — mesure avant correction, sur cette base, avec ces parametres.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { filtrerParcelles } from '../src/services/recherche.js';
import { listerLeads } from '../src/depots/prospection.js';

/** Departement fictif : aucune donnee reelle ne porte ce code. */
const DEP = '99';
const INSEE = '99001';
/** Emprise de test, en pleine mer au large de la Bretagne : rien de reel ne s'y trouve. */
const LON0 = -6.5;
const LAT0 = 47.0;
/** Population de test. 200 suffit a exposer le defaut ; au-dela le test ne devient que plus lent. */
const NB = 200;
/** Taille de page. 10 pages de 20 sur 200 parcelles. */
const PAGE = 20;

let baseDisponible = false;

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM lead WHERE idu LIKE $1`, [`${DEP}%`]);
  await requete(`DELETE FROM parcelle WHERE code_departement = $1`, [DEP]);
}

function idu(i: number): string {
  // 14 caracteres, format cadastral : departement + commune + prefixe + section + numero.
  return `${DEP}001000AA${String(i).padStart(4, '0')}`;
}

/**
 * Insere `NB` parcelles STRICTEMENT ex aequo : meme score, meme surface.
 *
 * L'egalite parfaite est le cas limite, et c'est le bon cas de test : elle ne cree pas le defaut,
 * elle le rend visible sur une population reduite. En production les ex aequo sont partiels mais
 * massifs, l'effet est le meme.
 */
async function peupler(): Promise<void> {
  for (let i = 1; i <= NB; i += 1) {
    // Les parcelles sont alignees en longitude, toutes dans la meme emprise de test.
    const lon = LON0 + i * 0.0001;
    await requete(
      `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                             contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation)
       VALUES ($1, $2, 'Commune de test', $3, '000', 'AA', $4, 50000, 50000,
               ST_SetSRID(
                 ST_MakeEnvelope($5::float8, $6::float8, $5::float8 + 0.00005, $6::float8 + 0.00005, 4326),
                 4326),
               ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), current_date)
       ON CONFLICT (idu) DO NOTHING`,
      [idu(i), INSEE, DEP, String(i), lon, LAT0],
    );
    await requete(
      `INSERT INTO score_parcelle_filiere (idu, filiere, statut, score_global, detail,
                                           couverture_donnees, version_moteur)
       VALUES ($1, 'solaire_sol', 'orange', 70.0, '{}'::jsonb, 1, 'test-pagination')
       ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET score_global = 70.0`,
      [idu(i)],
    );
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM parcelle LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await nettoyer();
  await peupler();
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : test pagination ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/**
 * Parcourt toutes les pages et rend la liste des IDU, doublons compris.
 *
 * Rendre la liste BRUTE et non un ensemble est essentiel : c'est la difference entre le nombre de
 * lignes et le nombre de valeurs distinctes qui revele le defaut.
 */
async function toutesLesPages(tri: 'score_desc' | 'surface_desc'): Promise<string[]> {
  const vus: string[] = [];
  for (let decalage = 0; decalage < NB; decalage += PAGE) {
    const { resultats } = await filtrerParcelles({
      filiere: 'solaire_sol',
      codeDepartement: DEP,
      tri,
      limite: PAGE,
      decalage,
    });
    vus.push(...resultats.map((r) => r.idu));
  }
  return vus;
}

for (const tri of ['score_desc', 'surface_desc'] as const) {
  test(`tri ${tri} : la reunion des pages est exactement la population`, async () => {
    if (ignorer()) return;
    const vus = await toutesLesPages(tri);
    const distincts = new Set(vus);

    // Le message porte les deux chiffres : « vues deux fois » et « jamais vues » sont le meme
    // nombre, et c'est ce nombre qui compte pour l'utilisateur.
    assert.equal(
      distincts.size,
      NB,
      `${vus.length - distincts.size} parcelle(s) vue(s) deux fois, donc autant jamais vue(s) : ` +
        `${distincts.size} parcelles distinctes sur ${NB} en base. Le tri ${tri} n'est pas total.`,
    );
    assert.equal(vus.length, NB, 'chaque page doit etre pleine');
  });
}

test('les leads se paginent sans doublon ni omission a date de mise a jour identique', async () => {
  if (ignorer()) return;
  // Toute la population horodatee a la MEME milliseconde : le cas d'un changement de statut en lot.
  for (let i = 1; i <= NB; i += 1) {
    await requete(
      `INSERT INTO lead (idu, filiere, statut, updated_at)
       VALUES ($1, 'solaire_sol', 'a_prospecter', '2026-01-01T00:00:00Z')
       ON CONFLICT (idu, filiere) WHERE idu IS NOT NULL DO UPDATE SET updated_at = '2026-01-01T00:00:00Z'`,
      [idu(i)],
    );
  }
  const vus: string[] = [];
  for (let decalage = 0; decalage < NB; decalage += PAGE) {
    const { resultats } = await listerLeads({ filiere: 'solaire_sol', limite: PAGE, decalage });
    vus.push(...resultats.map((l) => l.id));
  }
  assert.equal(
    new Set(vus).size,
    NB,
    `${vus.length - new Set(vus).size} lead(s) vu(s) deux fois : le tri par updated_at n'est pas total`,
  );
});

/**
 * Garde structurel : tout tri suivi d'une troncature doit finir par une colonne unique.
 *
 * POURQUOI UN TEST SUR LE TEXTE DU CODE. Les deux tests ci-dessus prouvent le defaut la ou il fait
 * le plus de degats, mais ils ne protegent que deux requetes. L'application en compte une vingtaine
 * qui trient puis tronquent, et le prochain tri ecrit sans departage repasserait inapercu : le
 * defaut ne casse rien, il ne fait que rendre une liste incomplete, silencieusement.
 *
 * La regle verifiee est mecanique et se lit dans le SQL : si un litteral contient a la fois un
 * `ORDER BY` et une troncature (`LIMIT` ou `OFFSET`), alors le dernier terme du tri doit etre une
 * colonne unique. Les tris SANS troncature sont hors regle : ils renvoient tout, donc ils ne peuvent
 * rien omettre — leur ordre entre ex aequo n'est qu'une question de presentation.
 */
test('tout tri suivi d une troncature finit par une colonne unique', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  // Chemin resolu depuis le module et non depuis le repertoire courant : le test doit dire la meme
  // chose lance depuis la racine du depot ou depuis `apps/api`.
  const racine = fileURLToPath(new URL('../src/', import.meta.url));

  /** Colonnes uniques du schema, seules admises comme dernier terme de tri. */
  const UNIQUES = ['id', 'idu', 'identifiant_source', 'code_insee', 'nom'];

  function fichiers(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) return fichiers(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  }

  const manquants: string[] = [];
  for (const f of fichiers(racine)) {
    const source = readFileSync(f, 'utf8');
    // Les litteraux SQL du projet sont tous des gabarits : on les isole pour ne pas confondre une
    // requete avec la prose des commentaires qui l'entoure.
    for (const litteral of source.match(/`[^`]*`/g) ?? []) {
      if (!/\bORDER BY\b/i.test(litteral)) continue;
      if (!/\b(LIMIT|OFFSET)\b/i.test(litteral)) continue;
      // Le tri va de `ORDER BY` a la troncature, aux fins de ligne ou a la fermeture de fenetre.
      const m = litteral.match(/\bORDER BY\b([\s\S]*?)(?=\bLIMIT\b|\bOFFSET\b|\)\s*AS\s+rang)/i);
      if (!m?.[1]) continue;
      const termes = m[1]
        // Les commentaires SQL font partie du litteral et contiennent des virgules.
        .replace(/--[^\n]*/g, '')
        .trim()
        .replace(/\s+/g, ' ');
      // Interpolation d'un tri construit ailleurs : la regle s'applique a l'endroit ou il est ecrit.
      if (termes.includes('${')) continue;
      const dernier = termes.split(',').pop()?.trim().split(/\s+/)[0] ?? '';
      const colonne = dernier.replace(/^[a-z]+\./i, '').toLowerCase();
      if (!UNIQUES.includes(colonne)) {
        manquants.push(`${f} : ORDER BY ${termes}`);
      }
    }
  }

  assert.deepEqual(
    manquants,
    [],
    'ces tris sont tronques sans ordre total : les ex aequo ecartes par la troncature changent ' +
      `d'un plan a l'autre.\n  ${manquants.join('\n  ')}`,
  );
});
