/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN SEUIL SUR LA CAPACITE DU POSTE SE LIT SUR LE POSTE QUI LA PORTE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, le 26/09/2026, sur les 301 parcelles de la base :
 *
 *   - `posteLePlusProche.capaciteResiduelleMw` renseigne sur **17** parcelles pour un seuil a
 *     1 MW ;
 *   - un poste ALTERNATIF renseigne sur **291**.
 *
 * Les postes viennent de deux sources : la BD TOPO donne la POSITION de tous, Capareseau la
 * CAPACITE d'accueil et la QUOTE-PART de certains. Le plus proche est presque toujours un poste
 * BD TOPO, sans capacite.
 *
 * Un developpeur ecrivant « capacite residuelle >= 1 MW » dans son cahier des charges recevait
 * donc 17 parcelles sur 301 — **91 % du parc ecarte en silence**, non pour un manque de capacite
 * mais parce que la valeur se trouvait sur un autre poste du MEME instantane. Aucun message,
 * aucun journal : juste une liste courte, parfaitement plausible.
 *
 * ═══ C'EST LE MEME DEFAUT QUE CELUI DU MOTEUR, SUR L'AUTRE VERSANT
 *
 * Le critere de notation avait ete repare la veille ; le filtre de recherche, non. Les deux
 * lisent desormais la meme chose — le poste le plus proche QUI PORTE la grandeur — sans quoi la
 * liste et la fiche auraient repondu differemment a la meme question, ce qui est la pire des
 * deux erreurs possibles : chacune plausible, et contradictoires.
 *
 * Le territoire est entierement fictif et place en pleine mer : ces tests ne lisent ni n'ecrivent
 * aucune donnee reelle.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { construireServeur } from '../src/serveur.js';
import { creerCommunesFictives, INSEE_LOCAL, DEP_LOCAL, PT, supprimerCommunesFictives } from './aides/communes-fictives.js';

type Serveur = Awaited<ReturnType<typeof construireServeur>>;

const IDU = `${INSEE_LOCAL}000ZC0001`;
const SECRET = 'secret-de-test-uniquement';
let app: Serveur | null = null;
let baseDisponible = false;

/** Un poste sans capacite (BD TOPO) tout pres, un poste AVEC capacite un peu plus loin. */
const RACCORDEMENT = {
  posteLePlusProche: {
    id: 'geopf:PROCHE',
    nom: 'Poste de transformation 90 kV',
    gestionnaire: 'autre_grd',
    tension: '90 kV',
    distanceKm: 4.2,
    capaciteResiduelleMw: null,
    etatSaturation: null,
    fileAttenteMw: null,
    quotePartEurParKw: null,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  },
  postesAlternatifs: [
    {
      id: 'LOIN',
      nom: 'POSTE LOINTAIN',
      gestionnaire: 'Enedis',
      tension: 'HTA',
      distanceKm: 12.5,
      capaciteResiduelleMw: 40,
      etatSaturation: 'disponible',
      fileAttenteMw: null,
      quotePartEurParKw: 200,
      renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
      enProjet: false,
    },
    {
      id: 'PRES',
      nom: 'POSTE PROCHE RENSEIGNE',
      gestionnaire: 'Enedis',
      tension: 'HTA',
      distanceKm: 5.1,
      capaciteResiduelleMw: 8,
      etatSaturation: 'disponible',
      fileAttenteMw: null,
      quotePartEurParKw: 45,
      renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
      enProjet: false,
    },
  ],
  reseauGaz: {
    distanceCanalisationKm: null,
    distanceSiteInjectionKm: null,
    gestionnaire: null,
    capaciteInjectionNm3h: null,
    reboursNecessaire: null,
  },
};

async function semer(): Promise<void> {
  await requete(
    `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                           contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation, updated_at)
     VALUES ($1, $2, 'Commune fictive de seuil', $3, '000', 'ZC', '0001', 120000, 119000,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
             ST_SetSRID(ST_MakePoint($5, $6), 4326), now(), now())
     ON CONFLICT (idu) DO UPDATE SET updated_at = now()`,
    [
      IDU,
      INSEE_LOCAL,
      DEP_LOCAL,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [[[PT[0], PT[1]], [PT[0] + 0.004, PT[1]], [PT[0] + 0.004, PT[1] + 0.004], [PT[0], PT[1] + 0.004], [PT[0], PT[1]]]],
      }),
      PT[0] + 0.002,
      PT[1] + 0.002,
    ],
  );
  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, date_snapshot)
     VALUES ($1, $2::jsonb, '{}', now())
     ON CONFLICT (idu) DO UPDATE SET snapshot = EXCLUDED.snapshot, date_snapshot = now()`,
    [IDU, JSON.stringify({ raccordement: RACCORDEMENT })],
  );
  await requete(
    `INSERT INTO score_parcelle_filiere
       (idu, filiere, score_global, statut, couverture_donnees, detail, version_moteur, date_calcul)
     VALUES ($1, 'bess', 70, 'orange', 0.9, '{}'::jsonb, 'test-seuil', now())
     ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET statut = EXCLUDED.statut`,
    [IDU],
  );
}

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM score_parcelle_filiere WHERE idu = $1`, [IDU]);
  await requete(`DELETE FROM parcelle_snapshot WHERE idu = $1`, [IDU]);
  await requete(`DELETE FROM parcelle WHERE idu = $1`, [IDU]);
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM parcelle_snapshot LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await nettoyer();
  await semer();
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
    process.stderr.write('# base indisponible : seuils de poste ignores (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/** La parcelle fictive ressort-elle pour ce seuil ? */
async function retenue(chemin: string, borne: { min?: number; max?: number }): Promise<boolean> {
  const rep = await app!.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    payload: { filiere: 'bess', limite: 50, seuils: [{ chemin, ...borne }] },
  });
  assert.equal(rep.statusCode, 200, rep.body.slice(0, 200));
  const corps = rep.json() as { resultats?: Array<{ idu: string }> };
  return (corps.resultats ?? []).some((r) => r.idu === IDU);
}

test('UN SEUIL DE CAPACITE TROUVE LA VALEUR SUR LE POSTE QUI LA PORTE', async () => {
  if (ignorer()) return;
  /*
   * Le poste le plus proche n'a AUCUNE capacite ; un alternatif a 5,1 km en porte 8 MW. Lire
   * seulement le plus proche ecartait la parcelle — c'est le cas des 91 % mesures.
   */
  assert.equal(
    await retenue('raccordement.posteLePlusProche.capaciteResiduelleMw', { min: 5 }),
    true,
    'la capacite portee par un poste alternatif doit etre vue par le seuil',
  );
});

test('LE SEUIL RESTE UN SEUIL : AU-DESSUS DE LA VALEUR, LA PARCELLE SORT', async () => {
  if (ignorer()) return;
  /**
   * LE CONTRE-EXEMPLE INDISPENSABLE. Une lecture trop large — le MAXIMUM sur tous les postes, par
   * exemple — retiendrait la parcelle pour 40 MW portes par un poste a 12,5 km, alors que le
   * critere de notation, lui, retient le poste RENSEIGNE LE PLUS PROCHE, soit 8 MW.
   *
   * La liste et la fiche repondraient alors differemment a la meme question : chacune plausible,
   * et contradictoires. C'est ce que ce test interdit.
   */
  assert.equal(
    await retenue('raccordement.posteLePlusProche.capaciteResiduelleMw', { min: 20 }),
    false,
    'le poste retenu est le plus PROCHE qui porte la grandeur (8 MW), pas le mieux dote (40 MW)',
  );
});

test('LA QUOTE-PART SUIT LA MEME LECTURE', async () => {
  if (ignorer()) return;
  // Le poste renseigne le plus proche porte 45 EUR/kW ; le lointain, 200.
  assert.equal(await retenue('raccordement.posteLePlusProche.quotePartEurParKw', { max: 50 }), true);
  assert.equal(
    await retenue('raccordement.posteLePlusProche.quotePartEurParKw', { max: 20 }),
    false,
    'un seuil plus exigeant que la valeur du poste retenu doit ecarter la parcelle',
  );
});

test('UNE GRANDEUR ORDINAIRE SE LIT TOUJOURS A SON CHEMIN', async () => {
  if (ignorer()) return;
  /*
   * La lecture speciale ne vaut QUE pour les grandeurs de Capareseau. Si elle debordait sur les
   * autres chemins, tout seuil se mettrait a chercher dans une liste de postes — et ne trouverait
   * plus rien. Ce garde borne la correction a ce qu'elle doit couvrir.
   */
  assert.equal(
    await retenue('raccordement.posteLePlusProche.distanceKm', { max: 5 }),
    true,
    'la distance du poste le plus proche (4,2 km) se lit bien a son chemin',
  );
  assert.equal(await retenue('raccordement.posteLePlusProche.distanceKm', { max: 3 }), false);
});
