/**
 * Diagnostic : combien de parcelles l'application ecarte-t-elle, et sans le dire ?
 *
 * Ecrit apres un signalement d'usage : une parcelle precise, demandee par un collegue, n'a pu etre ni
 * qualifiee ni meme VUE sur la carte en zoomant. Ce script mesure, commune par commune, l'ecart entre
 * ce que le cadastre contient et ce que l'application retient.
 *
 * Il ne corrige rien : il compte. Chaque chiffre qu'il produit est destine a etre cite.
 */

import { requete, pool } from '../src/bdd.js';
import { config } from '../src/config.js';
import { avecParams, jsonExterne } from '../src/http.js';

interface Feature {
  properties: { idu?: string; contenance?: number | string };
  geometry: unknown;
}
interface Collection {
  features: Feature[];
  numberMatched?: number;
  totalFeatures?: number;
}

/** Toutes les parcelles d'une commune, page par page, SANS aucun plafond. */
async function toutesLesParcelles(codeInsee: string): Promise<{ total: number; contenances: number[] }> {
  const contenances: number[] = [];
  let total = 0;
  const pas = 1000;
  for (let debut = 0; ; debut += pas) {
    const url = avecParams(`${config.sources.apicarto}/cadastre/parcelle`, {
      code_insee: codeInsee,
      _limit: pas,
      _start: debut,
    });
    const fc = await jsonExterne<Collection>(url, { connecteur: 'diagnostic', timeoutMs: 60000 });
    total = fc.numberMatched ?? fc.totalFeatures ?? total;
    for (const f of fc.features) contenances.push(Number(f.properties.contenance ?? 0));
    if (fc.features.length < pas) break;
    if (debut > 50_000) break; // garde-fou du diagnostic lui-meme
  }
  return { total: total || contenances.length, contenances };
}

async function principal(): Promise<void> {
  const seuil = config.qualification.surfaceMinM2;
  const plafond = config.carte.limiteParcelles;
  console.log(`Seuil de surface applique par l'application : ${seuil} m2`);
  console.log(`Plafond par requete d'emprise             : ${plafond} parcelles\n`);

  const communes = (
    await requete<{ code_insee: string; nom: string }>(
      `SELECT DISTINCT p.code_insee, coalesce(p.nom_commune, p.code_insee) AS nom
         FROM parcelle p ORDER BY 1 LIMIT 3`,
    )
  ).map((l) => ({ code: l.code_insee, nom: l.nom }));

  if (communes.length === 0) {
    console.log('Aucune commune en base : rien a comparer.');
    await pool.end();
    return;
  }

  console.log(
    'commune'.padEnd(26) +
      'cadastre'.padStart(10) +
      `>= ${seuil} m2`.padStart(14) +
      'ECARTEES'.padStart(10) +
      'part'.padStart(8) +
      'en base'.padStart(9),
  );
  console.log('-'.repeat(77));

  for (const c of communes) {
    const { total, contenances } = await toutesLesParcelles(c.code);
    const retenues = contenances.filter((m) => m >= seuil).length;
    const ecartees = contenances.length - retenues;
    const enBase = (
      await requete<{ n: number }>('SELECT count(*)::int AS n FROM parcelle WHERE code_insee = $1', [
        c.code,
      ])
    )[0]!.n;
    console.log(
      `${c.nom} (${c.code})`.padEnd(26) +
        String(total).padStart(10) +
        String(retenues).padStart(14) +
        String(ecartees).padStart(10) +
        `${Math.round((ecartees / Math.max(1, contenances.length)) * 100)} %`.padStart(8) +
        String(enBase).padStart(9),
    );
    if (total > plafond) {
      console.log(
        `    ATTENTION : ${total} parcelles depassent le plafond de ${plafond} par requete. ` +
          'Une emprise couvrant cette commune serait TRONQUEE en silence.',
      );
    }
  }

  await pool.end();
}

principal().catch((err) => {
  console.error(err);
  process.exit(1);
});
