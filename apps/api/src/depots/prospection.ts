/** Depot du pipeline de prospection : leads, evenements, sites. */

import type { Feu, Filiere, Lead, LeadEvenement, StatutProspection } from '@enr/core';
import { requete, requeteUne, transaction } from '../bdd.js';
import type { GeoJsonGeometry } from '../geo.js';

interface LigneLead {
  id: string;
  idu: string | null;
  site_id: string | null;
  filiere: Filiere;
  statut: StatutProspection;
  notes: string | null;
  assigne_a: string | null;
  score_initial: number | null;
  created_at: Date;
  updated_at: Date;
}

interface LigneEvenement {
  id: string;
  date: Date;
  type: LeadEvenement['type'];
  auteur: string;
  ancien_statut: StatutProspection | null;
  nouveau_statut: StatutProspection | null;
  commentaire: string | null;
}

function versLead(l: LigneLead, historique: LeadEvenement[] = []): Lead {
  return {
    id: l.id,
    idu: l.idu,
    siteId: l.site_id,
    filiere: l.filiere,
    statut: l.statut,
    notes: l.notes,
    scoreInitial: l.score_initial,
    historique,
    assigneA: l.assigne_a,
    createdAt: l.created_at.toISOString(),
    updatedAt: l.updated_at.toISOString(),
  };
}

function versEvenement(l: LigneEvenement): LeadEvenement {
  return {
    id: l.id,
    date: l.date.toISOString(),
    type: l.type,
    auteur: l.auteur,
    ancienStatut: l.ancien_statut,
    nouveauStatut: l.nouveau_statut,
    commentaire: l.commentaire,
  };
}

export async function leadParId(id: string): Promise<Lead | null> {
  const l = await requeteUne<LigneLead>(`SELECT * FROM lead WHERE id = $1`, [id]);
  if (!l) return null;
  return versLead(l, await historique(id));
}

export async function leadParParcelle(idu: string, filiere: Filiere): Promise<Lead | null> {
  const l = await requeteUne<LigneLead>(`SELECT * FROM lead WHERE idu = $1 AND filiere = $2`, [
    idu,
    filiere,
  ]);
  if (!l) return null;
  return versLead(l, await historique(l.id));
}

export async function historique(leadId: string): Promise<LeadEvenement[]> {
  const lignes = await requete<LigneEvenement>(
    `SELECT id, date, type, auteur, ancien_statut, nouveau_statut, commentaire
       FROM lead_evenement WHERE lead_id = $1 ORDER BY date DESC, id DESC`,
    [leadId],
  );
  return lignes.map(versEvenement);
}

export interface FiltresLeads {
  filiere?: Filiere;
  statuts?: StatutProspection[];
  assigneA?: string;
  limite?: number;
  decalage?: number;
}

export async function listerLeads(f: FiltresLeads): Promise<{ total: number; resultats: Lead[] }> {
  const conditions: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (f.filiere) {
    params.push(f.filiere);
    conditions.push(`filiere = $${params.length}`);
  }
  if (f.statuts?.length) {
    params.push(f.statuts);
    conditions.push(`statut = ANY($${params.length})`);
  }
  if (f.assigneA) {
    params.push(f.assigneA);
    conditions.push(`assigne_a = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  const total = await requeteUne<{ n: number }>(
    `SELECT count(*)::int AS n FROM lead WHERE ${where}`,
    params,
  );

  params.push(f.limite ?? 100, f.decalage ?? 0);
  const lignes = await requete<LigneLead>(
    // `updated_at` n'est pas unique : un changement de statut en lot horodate plusieurs leads a la
    // meme milliseconde. Avec un `OFFSET`, des leads apparaissaient deux fois et d'autres jamais
    // (audit 9, defaut A1). L'identifiant du lead departe : il est unique, donc le tri est total.
    `SELECT * FROM lead WHERE ${where}
      ORDER BY updated_at DESC, id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: total?.n ?? 0, resultats: lignes.map((l) => versLead(l)) };
}

export async function creerLead(
  donnees: {
    idu?: string | null;
    siteId?: string | null;
    filiere: Filiere;
    statut?: StatutProspection;
    notes?: string | null;
    assigneA?: string | null;
    scoreInitial?: number | null;
  },
  auteur: string,
): Promise<Lead> {
  return transaction(async (client) => {
    const res = await client.query<LigneLead>(
      `INSERT INTO lead (idu, site_id, filiere, statut, notes, assigne_a, score_initial)
       VALUES ($1, $2, $3, COALESCE($4, 'a_prospecter'), $5, $6, $7)
       ON CONFLICT (idu, filiere) WHERE idu IS NOT NULL DO UPDATE SET updated_at = now()
       RETURNING *`,
      [
        donnees.idu ?? null,
        donnees.siteId ?? null,
        donnees.filiere,
        donnees.statut ?? null,
        donnees.notes ?? null,
        donnees.assigneA ?? null,
        donnees.scoreInitial ?? null,
      ],
    );
    return versLead(res.rows[0]!);
  }, auteur);
}

export async function majLead(
  id: string,
  champs: { statut?: StatutProspection; notes?: string | null; assigneA?: string | null },
  auteur: string,
): Promise<Lead | null> {
  return transaction(async (client) => {
    const res = await client.query<LigneLead>(
      `UPDATE lead SET
         statut = COALESCE($2, statut),
         notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
         assigne_a = CASE WHEN $5::boolean THEN $6 ELSE assigne_a END,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        champs.statut ?? null,
        champs.notes !== undefined,
        champs.notes ?? null,
        champs.assigneA !== undefined,
        champs.assigneA ?? null,
      ],
    );
    const l = res.rows[0];
    if (!l) return null;
    const evenements = await client.query<LigneEvenement>(
      `SELECT id, date, type, auteur, ancien_statut, nouveau_statut, commentaire
         FROM lead_evenement WHERE lead_id = $1 ORDER BY date DESC, id DESC`,
      [id],
    );
    return versLead(l, evenements.rows.map(versEvenement));
  }, auteur);
}

export async function ajouterEvenement(
  leadId: string,
  type: LeadEvenement['type'],
  auteur: string,
  commentaire: string | null,
): Promise<LeadEvenement | null> {
  const l = await requeteUne<LigneEvenement>(
    `INSERT INTO lead_evenement (lead_id, type, auteur, commentaire)
     VALUES ($1, $2, $3, $4)
     RETURNING id, date, type, auteur, ancien_statut, nouveau_statut, commentaire`,
    [leadId, type, auteur, commentaire],
  );
  return l ? versEvenement(l) : null;
}

export async function supprimerLead(id: string): Promise<boolean> {
  const l = await requeteUne<{ id: string }>(`DELETE FROM lead WHERE id = $1 RETURNING id`, [id]);
  return l != null;
}

/** Statuts de prospection pour un lot de parcelles (rendu du contour sur la carte). */
export async function statutsProspectionParIdus(
  idus: string[],
  filiere: Filiere,
): Promise<Record<string, StatutProspection>> {
  if (idus.length === 0) return {};
  const lignes = await requete<{ idu: string; statut: StatutProspection }>(
    `SELECT idu, statut FROM lead WHERE idu = ANY($1) AND filiere = $2`,
    [idus, filiere],
  );
  return Object.fromEntries(lignes.map((l) => [l.idu, l.statut]));
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export interface SiteEnBase {
  id: string;
  nom: string;
  filiere: Filiere;
  commentaire: string | null;
  scoreGlobal: number | null;
  statutScore: Feu | null;
  surfaceHa: number | null;
  geometrie: GeoJsonGeometry | null;
  idus: string[];
  createdAt: string;
}

interface LigneSite {
  id: string;
  nom: string;
  filiere: Filiere;
  commentaire: string | null;
  score_global: number | null;
  statut_score: Feu | null;
  surface_ha: number | null;
  geometrie: string | null;
  created_at: Date;
}

async function versSite(l: LigneSite): Promise<SiteEnBase> {
  const idus = await requete<{ idu: string }>(`SELECT idu FROM site_parcelle WHERE site_id = $1`, [l.id]);
  return {
    id: l.id,
    nom: l.nom,
    filiere: l.filiere,
    commentaire: l.commentaire,
    scoreGlobal: l.score_global,
    statutScore: l.statut_score,
    surfaceHa: l.surface_ha,
    geometrie: l.geometrie ? (JSON.parse(l.geometrie) as GeoJsonGeometry) : null,
    idus: idus.map((i) => i.idu),
    createdAt: l.created_at.toISOString(),
  };
}

const SELECT_SITE = `
  SELECT id, nom, filiere, commentaire, score_global, statut_score, surface_ha,
         ST_AsGeoJSON(geom) AS geometrie, created_at
    FROM site`;

export async function siteParId(id: string): Promise<SiteEnBase | null> {
  const l = await requeteUne<LigneSite>(`${SELECT_SITE} WHERE id = $1`, [id]);
  return l ? versSite(l) : null;
}

export async function listerSites(filiere?: Filiere): Promise<SiteEnBase[]> {
  const lignes = filiere
    // Departage par l'identifiant : deux sites crees dans la meme transaction partagent
    // `created_at`, et leur ordre d'affichage changeait d'un chargement a l'autre.
    ? await requete<LigneSite>(`${SELECT_SITE} WHERE filiere = $1 ORDER BY created_at DESC, id ASC`, [
        filiere,
      ])
    : await requete<LigneSite>(`${SELECT_SITE} ORDER BY created_at DESC, id ASC`);
  return Promise.all(lignes.map(versSite));
}

/**
 * Cree un site a partir d'une liste de parcelles ou d'une emprise dessinee.
 * Lorsqu'une emprise est fournie, les parcelles qu'elle intersecte sont rattachees.
 */
export async function creerSite(donnees: {
  nom: string;
  filiere: Filiere;
  idus?: string[];
  geometrie?: GeoJsonGeometry | null;
  commentaire?: string | null;
}): Promise<SiteEnBase> {
  return transaction<string>(async (client) => {
    const res = await client.query<{ id: string }>(
      `INSERT INTO site (nom, filiere, commentaire, geom)
       VALUES ($1, $2, $3,
               CASE WHEN $4::text IS NULL THEN NULL
                    ELSE ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))) END)
       RETURNING id`,
      [donnees.nom, donnees.filiere, donnees.commentaire ?? null, donnees.geometrie ? JSON.stringify(donnees.geometrie) : null],
    );
    const siteId = res.rows[0]!.id;

    if (donnees.idus?.length) {
      await client.query(
        `INSERT INTO site_parcelle (site_id, idu)
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [siteId, donnees.idus],
      );
    } else if (donnees.geometrie) {
      await client.query(
        `INSERT INTO site_parcelle (site_id, idu)
         SELECT $1, p.idu FROM parcelle p, site s
          WHERE s.id = $1 AND ST_Intersects(p.geom, s.geom)
         ON CONFLICT DO NOTHING`,
        [siteId],
      );
    }

    // L'emprise du site est l'union des parcelles rattachees lorsqu'aucune n'a ete dessinee.
    await client.query(
      `UPDATE site s SET
         geom = COALESCE(s.geom, (
           SELECT ST_Multi(ST_Union(p.geom)) FROM parcelle p
             JOIN site_parcelle sp ON sp.idu = p.idu
            WHERE sp.site_id = s.id)),
         surface_ha = (
           SELECT COALESCE(sum(ST_Area(ST_Transform(p.geom, 2154))) / 10000.0, 0)
             FROM parcelle p JOIN site_parcelle sp ON sp.idu = p.idu
            WHERE sp.site_id = s.id),
         updated_at = now()
       WHERE s.id = $1`,
      [siteId],
    );

    return siteId;
  }).then(async (siteId) => {
    // La relecture a lieu APRES la validation de la transaction : `versSite` interroge le
    // pool, qui ne voit pas les lignes non encore validees de `site_parcelle`.
    const site = await siteParId(siteId);
    if (!site) throw new Error(`Site ${siteId} introuvable apres creation`);
    return site;
  });
}

export async function majScoreSite(
  id: string,
  scoreGlobal: number | null,
  statut: Feu,
  detail: unknown,
): Promise<void> {
  await requete(
    `UPDATE site SET score_global = $2, statut_score = $3, detail_score = $4, updated_at = now()
      WHERE id = $1`,
    [id, scoreGlobal, statut, JSON.stringify(detail)],
  );
}

export async function supprimerSite(id: string): Promise<boolean> {
  const l = await requeteUne<{ id: string }>(`DELETE FROM site WHERE id = $1 RETURNING id`, [id]);
  return l != null;
}

/** Tableau de bord : compteurs de prospection et surface securisee. */
export async function tableauDeBord(filiere: Filiere): Promise<{
  parStatut: Record<string, number>;
  surfaceSecuriseeHa: number;
  surfaceEnNegociationHa: number;
  evolution: Array<{ mois: string; nouveaux: number; securises: number }>;
}> {
  const [statuts, surfaces, evolution] = await Promise.all([
    requete<{ statut: string; n: number }>(
      `SELECT statut, count(*)::int AS n FROM lead WHERE filiere = $1 GROUP BY statut`,
      [filiere],
    ),
    requete<{ statut: string; ha: number | null }>(
      `SELECT l.statut, sum(ST_Area(ST_Transform(p.geom, 2154))) / 10000.0 AS ha
         FROM lead l JOIN parcelle p ON p.idu = l.idu
        WHERE l.filiere = $1 GROUP BY l.statut`,
      [filiere],
    ),
    requete<{ mois: string; nouveaux: number; securises: number }>(
      `SELECT to_char(date_trunc('month', e.date), 'YYYY-MM') AS mois,
              count(*) FILTER (WHERE e.type = 'creation')::int AS nouveaux,
              count(*) FILTER (WHERE e.nouveau_statut = 'securise')::int AS securises
         FROM lead_evenement e JOIN lead l ON l.id = e.lead_id
        WHERE l.filiere = $1 AND e.date > now() - interval '12 months'
        GROUP BY 1 ORDER BY 1`,
      [filiere],
    ),
  ]);

  const parSurface = Object.fromEntries(surfaces.map((s) => [s.statut, s.ha ?? 0]));
  return {
    parStatut: Object.fromEntries(statuts.map((s) => [s.statut, s.n])),
    surfaceSecuriseeHa: Math.round((parSurface['securise'] ?? 0) * 100) / 100,
    surfaceEnNegociationHa: Math.round((parSurface['en_negociation'] ?? 0) * 100) / 100,
    evolution,
  };
}

/**
 * Nombre de groupes de parcelles JOINTIVES dans un site.
 *
 * Le score de site deduit une bande perimetrale de la surface. Applique a la somme des
 * surfaces, ce modele suppose une emprise unique — et surestime donc la surface implantable
 * d'un site disperse, jusqu'a 38 % sur un cas a trois parcelles. Cette fonction fournit
 * l'information manquante : le moteur choisit alors entre le modele a une forme et une
 * deduction parcelle par parcelle.
 *
 * TOLERANCE DE 10 METRES D'ECART. Deux parcelles separees par un chemin d'exploitation ou une
 * voie communale sont exploitables comme une seule emprise : la liaison se pose sous la voirie
 * et la cloture se prolonge. Sans tolerance, tout site traverse par un chemin serait declare
 * disperse, ce qui est le cas le plus courant en milieu agricole. Au-dela, la separation
 * devient une route large ou une parcelle tierce a negocier : deux emprises distinctes.
 *
 * Mise en oeuvre : chaque parcelle est dilatee de 5 m avant l'union, ce qui referme tout
 * interstice de 10 m ou moins. Le buffer sert uniquement a compter les groupes ; aucune
 * surface n'en est deduite.
 *
 * Projection Lambert-93 (EPSG:2154) et non WGS84 : un buffer en degres n'aurait pas de sens
 * metrique et vaudrait 5 m en latitude pour environ 3,5 m en longitude a la latitude de la
 * France.
 *
 * `null` si une geometrie manque : l'appelant traite l'inconnu comme disperse, ce qui est le
 * sens prudent.
 */
export async function nbGroupesContigus(idus: string[]): Promise<number | null> {
  if (idus.length === 0) return null;
  if (idus.length === 1) return 1;

  const l = await requeteUne<{ n: number | null; manquantes: number }>(
    `WITH g AS (
       SELECT geom FROM parcelle WHERE idu = ANY($1)
     )
     SELECT
       CASE WHEN count(*) = 0 THEN NULL
            ELSE ST_NumGeometries(
                   ST_Multi(
                     ST_Union(ST_Buffer(ST_Transform(geom, 2154), 5))
                   )
                 )
       END AS n,
       ($2::int - count(*))::int AS manquantes
     FROM g`,
    [idus, idus.length],
  );

  // Une parcelle absente de la table rendrait le compte faux dans le sens optimiste : on
  // prefere rendre l'inconnu explicite.
  if (!l || l.n == null || l.manquantes > 0) return null;
  return l.n;
}
