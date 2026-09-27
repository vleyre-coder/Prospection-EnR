/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN SEUIL « AU MOINS X » DOIT VOIR LA BORNE, UN SEUIL « AU PLUS X » NE LE DOIT PAS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Quand aucun objet n'est trouvé dans un rayon interrogé exhaustivement, le connecteur ne rend pas
 * la distance mais le RAYON : « au-delà de 1 000 m ». Mesuré le 28/09/2026 sur les 301 parcelles de
 * la base : c'est le cas de **299 d'entre elles** pour les cours d'eau.
 *
 * SANS CE TRAITEMENT, LE FILTRE LES ÉCARTERAIT TOUTES EN SILENCE. Un développeur écrivant « au
 * moins 35 m d'un cours d'eau » dans son cahier des charges recevrait deux parcelles sur trois
 * cents — non pour un manque de recul, mais parce que le recul est si grand qu'il n'a pas été
 * mesuré. C'est exactement le défaut corrigé le 26/09 sur la capacité des postes, transposé à une
 * autre grandeur : une liste courte, plausible, et fausse.
 *
 * ═══ LE SENS DE LA COMPARAISON DÉCIDE, ET C'EST LE POINT DÉLICAT
 *
 *   - `min` (« au moins X ») : une borne B prouve le seuil dès lors que B ≥ X. La distance réelle
 *     dépasse B, donc elle dépasse X a fortiori. **On lit la borne à défaut de la mesure.**
 *   - `max` (« au plus X ») : une borne ne prouve RIEN. La distance réelle est supérieure à B, sans
 *     majorant connu — elle peut dépasser X. **La parcelle doit être écartée.** C'est le sens
 *     d'erreur prudent : un seuil qu'on ne peut pas vérifier n'est jamais réputé satisfait.
 *
 * Les deux moitiés comptent. Lire la borne dans les deux sens retiendrait des parcelles sur un
 * seuil qu'elles ne satisfont peut-être pas — une erreur qui va, elle, dans le mauvais sens.
 *
 * Le territoire est entièrement fictif et placé en pleine mer : ces tests ne lisent ni n'écrivent
 * aucune donnée réelle.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { construireServeur } from '../src/serveur.js';
import {
  creerCommunesFictives,
  INSEE_LOCAL,
  DEP_LOCAL,
  PT,
  supprimerCommunesFictives,
} from './aides/communes-fictives.js';

type Serveur = Awaited<ReturnType<typeof construireServeur>>;

/** Parcelle dont la distance au cours d'eau n'est connue que par une borne. */
const IDU_BORNE = `${INSEE_LOCAL}000ZB0001`;
/** Parcelle dont la distance est réellement mesurée, et courte. */
const IDU_MESURE = `${INSEE_LOCAL}000ZB0002`;
const SECRET = 'secret-de-test-uniquement';

let app: Serveur | null = null;
let baseDisponible = false;

function entetes(): Record<string, string> {
  return {
    authorization: `Bearer ${app!.jwt.sign({
      id: '00000000-0000-0000-0000-000000000002',
      email: 'prospection@local',
      nom: 'prospection',
      role: 'prospection',
      habiliteDonneesProprietaires: false,
    })}`,
  };
}

async function semer(idu: string, numero: string, eau: unknown, decalage: number): Promise<void> {
  await requete(
    `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                           contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation, updated_at)
     VALUES ($1, $2, 'Commune fictive de borne', $3, '000', 'ZB', $4, 120000, 119000,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)),
             ST_SetSRID(ST_MakePoint($6, $7), 4326), now(), now())
     ON CONFLICT (idu) DO UPDATE SET updated_at = now()`,
    [
      idu,
      INSEE_LOCAL,
      DEP_LOCAL,
      numero,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [PT[0] + decalage, PT[1]],
            [PT[0] + decalage + 0.003, PT[1]],
            [PT[0] + decalage + 0.003, PT[1] + 0.003],
            [PT[0] + decalage, PT[1] + 0.003],
            [PT[0] + decalage, PT[1]],
          ],
        ],
      }),
      PT[0] + decalage + 0.0015,
      PT[1] + 0.0015,
    ],
  );
  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, date_snapshot)
     VALUES ($1, $2::jsonb, '{}', now())
     ON CONFLICT (idu) DO UPDATE SET snapshot = EXCLUDED.snapshot, date_snapshot = now()`,
    [idu, JSON.stringify({ eau })],
  );
  await requete(
    `INSERT INTO score_parcelle_filiere
       (idu, filiere, score_global, statut, couverture_donnees, detail, version_moteur, date_calcul)
     VALUES ($1, 'methanisation', 70, 'orange', 0.9, '{}'::jsonb, 'test-borne', now())
     ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET statut = EXCLUDED.statut`,
    [idu],
  );
}

async function nettoyer(): Promise<void> {
  for (const idu of [IDU_BORNE, IDU_MESURE]) {
    await requete(`DELETE FROM score_parcelle_filiere WHERE idu = $1`, [idu]);
    await requete(`DELETE FROM parcelle_snapshot WHERE idu = $1`, [idu]);
    await requete(`DELETE FROM parcelle WHERE idu = $1`, [idu]);
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM parcelle_snapshot LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await nettoyer();
  // Aucun cours d'eau trouve dans 1 000 m : seule la borne est connue.
  await semer(IDU_BORNE, '0001', { distanceCoursEauM: null, coursEauAuDelaDeM: 1000 }, 0);
  // Distance reellement mesuree, et courte : elle sert de contre-exemple aux deux sens.
  await semer(IDU_MESURE, '0002', { distanceCoursEauM: 20, coursEauAuDelaDeM: null }, 0.01);
  app = await construireServeur({ secretJwt: SECRET });
});

after(async () => {
  if (app) await app.close();
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!app) {
    process.stderr.write('# base indisponible : seuils de borne ignores (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/** Les IDU fictifs retenus par ce seuil. */
async function retenues(borne: { min?: number; max?: number }): Promise<string[]> {
  const rep = await app!.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    payload: {
      filiere: 'methanisation',
      limite: 50,
      seuils: [{ chemin: 'eau.distanceCoursEauM', ...borne }],
    },
    headers: entetes(),
  });
  assert.equal(rep.statusCode, 200, rep.body.slice(0, 200));
  const corps = rep.json() as { resultats?: Array<{ idu: string }> };
  return (corps.resultats ?? []).map((r) => r.idu).filter((i) => i.startsWith(INSEE_LOCAL));
}

test('UN SEUIL « AU MOINS » RETIENT LA PARCELLE DONT SEULE LA BORNE EST CONNUE', async () => {
  if (ignorer()) return;
  /*
   * 35 m est le seuil reglementaire de la methanisation. La parcelle n'a aucun cours d'eau a moins
   * de 1 000 m : elle le satisfait a fortiori, et l'ecarter serait ecarter la meilleure situation
   * possible parce qu'elle est trop favorable pour avoir ete mesuree.
   */
  const r = await retenues({ min: 35 });
  assert.ok(r.includes(IDU_BORNE), 'la borne démontrée doit satisfaire un seuil « au moins »');
  assert.ok(!r.includes(IDU_MESURE), 'la parcelle mesurée à 20 m ne satisfait pas 35 m');
});

test('UN SEUIL « AU MOINS » PLUS EXIGEANT QUE LA BORNE ECARTE LA PARCELLE', async () => {
  if (ignorer()) return;
  /**
   * LE CONTRE-EXEMPLE QUI BORNE LA CORRECTION. « Au-delà de 1 000 m » ne démontre pas « au moins
   * 2 000 m ». Si le filtre retenait la parcelle ici, il traiterait la borne comme une valeur
   * arbitrairement grande — et retiendrait des parcelles sur un seuil qu'elles ne satisfont
   * peut-être pas, ce qui est l'erreur dans le mauvais sens.
   */
  const r = await retenues({ min: 2000 });
  assert.ok(
    !r.includes(IDU_BORNE),
    'une borne de 1 000 m ne peut pas démontrer un seuil de 2 000 m',
  );
});

test('UN SEUIL « AU PLUS » NE SE LAISSE JAMAIS SATISFAIRE PAR UNE BORNE', async () => {
  if (ignorer()) return;
  /**
   * LA MOITIÉ QU'ON OUBLIE, et celle qui ferait le plus de dégâts.
   *
   * La distance réelle est SUPÉRIEURE à la borne, sans majorant connu : elle peut dépasser le seuil
   * demandé. Lire la borne ici retiendrait la parcelle sur une condition indémontrable — et un
   * développeur cherchant une parcelle PROCHE d'un cours d'eau (pour un prélèvement, un rejet)
   * recevrait précisément celles qui en sont le plus éloignées.
   */
  const r = await retenues({ max: 5000 });
  assert.ok(
    !r.includes(IDU_BORNE),
    'la borne ne majore rien : elle ne peut pas satisfaire un seuil « au plus »',
  );
  assert.ok(r.includes(IDU_MESURE), 'la parcelle réellement mesurée, elle, doit ressortir');
});

test('UNE GRANDEUR SANS BORNE DECLAREE SE LIT TOUJOURS A SON CHEMIN', async () => {
  if (ignorer()) return;
  /*
   * La lecture par borne ne vaut QUE pour les grandeurs qui en déclarent une. Si elle débordait,
   * tout seuil se mettrait à chercher un champ de repli inexistant, et ne retiendrait plus rien.
   */
  const rep = await app!.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    payload: {
      filiere: 'methanisation',
      limite: 50,
      seuils: [{ chemin: 'acces.distanceVoirieM', max: 50000 }],
    },
    headers: entetes(),
  });
  assert.equal(rep.statusCode, 200, rep.body.slice(0, 200));
  /*
   * Aucune des deux parcelles fictives ne porte cette grandeur : un chemin sans borne declaree se
   * lit a son chemin et rien d'autre, donc aucune ne ressort. C'est le comportement d'origine, et
   * il doit rester intact.
   */
  const corps = rep.json() as { resultats?: Array<{ idu: string }> };
  const fictives = (corps.resultats ?? []).map((r) => r.idu).filter((i) => i.startsWith(INSEE_LOCAL));
  assert.deepEqual(fictives, [], 'la lecture par borne ne doit pas deborder sur les autres chemins');
});
