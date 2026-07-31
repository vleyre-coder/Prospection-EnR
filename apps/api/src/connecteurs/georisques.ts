/**
 * Connecteur Georisques (BRGM / MTE).
 *
 * Pieges verifies (docs/API_CONTRACTS.md §6) :
 *   - `latlon` s'ecrit `lon,lat` ; `rayon` est plafonne a 10 000 m ;
 *   - trois enveloppes de reponse coexistent : `{data}` (majorite),
 *     `{content, pageNumber}` (gaspar/ppr*, pagination 0-based, parametre `codeInsee`),
 *     et un objet nu pour `/rga` ;
 *   - `/rga` renvoie un CORPS VIDE avec un HTTP 200 hors zone argileuse : il faut traiter
 *     ce cas comme "alea nul" et non comme une erreur.
 */

import type { Eau, Risques, Topographie } from '@enr/core';
import { config } from '../config.js';
import { avecParams, jsonExterne } from '../http.js';
import type { Position } from '../geo.js';

const CONNECTEUR = 'georisques';

interface EnveloppeA<T> {
  results?: number;
  page?: number;
  total_pages?: number;
  data?: T[];
}

interface EnveloppeB<T> {
  totalElements?: number;
  totalPages?: number;
  pageNumber?: number;
  content?: T[];
}

function latlon(pt: Position): string {
  return `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
}

async function formeA<T>(
  chemin: string,
  params: Record<string, string | number | undefined>,
): Promise<T[] | null> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/${chemin}`, { page_size: 50, ...params });
    const rep = await jsonExterne<EnveloppeA<T>>(url, { connecteur: CONNECTEUR, timeoutMs: 25000 });
    return rep.data ?? [];
  } catch {
    return null;
  }
}

async function formeB<T>(chemin: string, codeInsee: string): Promise<T[] | null> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/${chemin}`, {
      codeInsee,
      pageSize: 50,
    });
    const rep = await jsonExterne<EnveloppeB<T>>(url, { connecteur: CONNECTEUR, timeoutMs: 25000 });
    return rep.content ?? [];
  } catch {
    return null;
  }
}

/** Alea retrait-gonflement des argiles. Corps vide en HTTP 200 = hors zone argileuse. */
async function aleaArgiles(pt: Position): Promise<Topographie['aleaArgiles']> {
  try {
    const url = avecParams(`${config.sources.georisques}/v1/rga`, { latlon: latlon(pt) });
    const rep = await jsonExterne<{ codeExposition?: string; exposition?: string } | string>(url, {
      connecteur: CONNECTEUR,
    });
    // Corps vide (chaine vide) : aucune exposition recensee a ce point.
    if (typeof rep === 'string') return rep.trim() === '' ? 'nul' : null;
    const code = rep.codeExposition;
    if (code == null) return 'nul';
    return code === '1' ? 'faible' : code === '2' ? 'moyen' : code === '3' ? 'fort' : null;
  } catch {
    return null;
  }
}

interface PprBrut {
  libelle_risque_long?: string | null;
  libelle_risque?: string | null;
  code_national_ppr?: string | null;
  date_approbation?: string | null;
  libelle_etat?: string | null;
}

/** Classe un PPR selon la famille de risque qu'il couvre. */
function familleRisque(libelle: string): 'inondation' | 'incendie' | 'technologique' | 'mouvement' | null {
  const l = libelle.toLowerCase();
  if (l.includes('inondation') || l.includes('submersion') || l.includes('crue')) return 'inondation';
  if (l.includes('foret') || l.includes('forêt') || l.includes('incendie') || l.includes('feu')) return 'incendie';
  if (l.includes('technolog') || l.includes('industriel')) return 'technologique';
  if (l.includes('mouvement') || l.includes('terrain') || l.includes('argile')) return 'mouvement';
  return null;
}

/**
 * Recupere les risques et contraintes d'eau d'une parcelle.
 *
 * Les PPR sont recenses au niveau COMMUNAL : l'application signale donc la presence d'un
 * PPR, mais ne peut pas determiner le zonage reglementaire applicable a la parcelle
 * (rouge / bleu). Le zonage reste a lire sur le reglement du PPR, ce que la fiche indique.
 */
export async function risquesEtEau(
  centroide: Position,
  codeInsee: string,
): Promise<{
  risques: Partial<Risques>;
  eau: Partial<Eau>;
  topographie: Partial<Topographie>;
  echecs: string[];
}> {
  const echecs: string[] = [];

  const [argiles, cavites, mvt, pprn, pprt, tri, triZonage, casias, icpe] = await Promise.all([
    aleaArgiles(centroide),
    formeA<{ id_cavite?: string }>('cavites', { latlon: latlon(centroide), rayon: 1000 }),
    formeA<{ id_mvt?: string }>('mvt', { code_insee: codeInsee }),
    formeB<PprBrut>('gaspar/pprn', codeInsee),
    formeB<PprBrut>('gaspar/pprt', codeInsee),
    formeA<{ libelle_tri?: string }>('gaspar/tri', { code_insee: codeInsee }),
    formeA<{ libelle_tri?: string }>('tri_zonage', { latlon: latlon(centroide) }),
    formeA<{ nom_usuel?: string }>('ssp/casias', { latlon: latlon(centroide), rayon: 500 }),
    formeA<{ raison_sociale?: string }>('installations_classees', {
      latlon: latlon(centroide),
      rayon: 2000,
    }),
  ]);

  if (cavites == null) echecs.push('georisques/cavites');
  if (pprn == null) echecs.push('georisques/gaspar/pprn');
  if (casias == null) echecs.push('georisques/ssp/casias');

  const tousPpr = [...(pprn ?? []), ...(pprt ?? [])];
  const parFamille = new Map<string, PprBrut[]>();
  for (const p of tousPpr) {
    const f = familleRisque(p.libelle_risque_long ?? p.libelle_risque ?? '');
    if (!f) continue;
    parFamille.set(f, [...(parFamille.get(f) ?? []), p]);
  }

  const risques: Partial<Risques> = {
    ppri:
      pprn == null
        ? { present: null, zonage: null }
        : {
            present: parFamille.has('inondation'),
            // Le zonage reglementaire n'est pas expose par l'API : il reste a lire sur le PPR.
            zonage: null,
          },
    pprif:
      pprn == null ? { present: null, zonage: null } : { present: parFamille.has('incendie'), zonage: null },
    pprt:
      pprt == null ? { present: null, zonage: null } : { present: parFamille.has('technologique'), zonage: null },
    sitesPollues: casias == null ? null : casias.length,
    icpeProches: icpe == null ? null : icpe.length,
    // Les servitudes aeronautiques et les radars ne sont pas exposes par Georisques :
    // ils relevent d'une ingestion dediee (DGAC, Meteo-France) non couverte a ce stade.
    radars: [],
    servitudesAeronautiques: null,
    faisceauxHertziens: null,
    reseauxEnterres: [],
    obligationDebroussaillement: parFamille.has('incendie') ? true : null,
  };

  const eau: Partial<Eau> = {
    inondation: {
      zonagePpri: null,
      alea:
        triZonage == null && tri == null
          ? null
          : (triZonage?.length ?? 0) > 0
            ? 'fort'
            : parFamille.has('inondation')
              ? 'moyen'
              : 'nul',
      dansTri: tri == null ? null : tri.length > 0,
    },
    // Les perimetres de protection de captage relevent des ARS et des SUP du GPU :
    // non exposes de facon homogene, laisses a null (critere gris) plutot qu'inventes.
    captageAep: { dansPerimetre: null, type: null, distanceM: null },
    karst: null,
  };

  const topographie: Partial<Topographie> = {
    aleaArgiles: argiles,
    cavitesProches: cavites == null ? null : cavites.length,
    mouvementsTerrain: mvt == null ? null : mvt.length,
  };

  return { risques, eau, topographie, echecs };
}
