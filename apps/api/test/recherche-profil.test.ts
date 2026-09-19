/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * MODE 2 — LA RECHERCHE AU SEUIL DU DEVELOPPEUR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROTEGE, ET C'EST LA SECONDE MOITIE DU §2.3. La recherche evalue au seuil
 * DEVELOPPEUR quand il existe, au seuil reglementaire sinon. Trois choses peuvent mal tourner, et
 * aucune ne se signale toute seule :
 *
 *   1. le seuil du profil n'est PAS applique. La recherche rend alors le meme resultat qu'un
 *      balayage sans profil, et l'operateur remet au developpeur un dossier qui ne respecte pas
 *      son cahier des charges ;
 *   2. le seuil est applique APRES la pagination. Le `total` compte alors les lignes d'avant, la
 *      page 2 ne commence pas ou la page 1 s'arrete, et l'ecran affiche « 240 résultats » au-dessus
 *      d'une liste qui en montre neuf ;
 *   3. un seuil que rien ne sait mesurer est IGNORE EN SILENCE. C'est le pire des trois :
 *      l'operateur croit son filtre actif. 250 des 292 contraintes sont aujourd'hui dans ce cas.
 *
 * La traduction en conditions SQL repond aux deux premiers par construction ; le troisieme exige
 * que la route REMONTE ce qu'elle n'a pas applique, et c'est teste ici.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { traduireProfil } from '../src/services/profil-en-filtres.js';
import { construireServeur } from '../src/serveur.js';
import {
  creerCommunesFictives,
  supprimerCommunesFictives,
  DEP_LOCAL,
  INSEE_LOCAL,
  PT,
  versEst,
} from './aides/communes-fictives.js';

type Serveur = Awaited<ReturnType<typeof construireServeur>>;
/** Voir `profils-seuils.test.ts` : decrire six formes de reponse a la main ne prouverait rien. */
type Reponse = any;

const SECRET = 'secret-de-test-uniquement';
/** Recul eolien : seuil ferme, sens etabli, et une correspondance vers `bati.distanceHabitationM`. */
const ID_RECUL = 'eolien_terrestre__eloignement_500_m_des_habitations';
/** Contrainte de PRESENCE : mesuree par recouvrement, donc intraduisible en seuil chiffre. */
const ID_ZNIEFF = 'eolien_terrestre__znieff_type_i';
/** Contrainte auto_sig SANS correspondance vers une grandeur du releve. */
const ID_SANS_MESURE = 'eolien_terrestre__enjeux_chiropteres_recul_lisieres_garde_au_sol';

let baseDisponible = false;
let app: Serveur | null = null;

/**
 * POPULATION DE TEST, SEMEE PAR CE FICHIER — et il a fallu une base vide pour s'en apercevoir.
 *
 * Ma premiere ecriture s'appuyait sur ce que la base de reference contenait deja : 71 parcelles a
 * plus de 500 m d'une habitation. Le test passait, et il etait FAUX — sur une base neuve, celle
 * que l'integration continue construit a chaque execution, il n'y avait aucune parcelle et
 * l'assertion « le seuil legal doit laisser des parcelles » tombait. Un test qui depend de donnees
 * qu'il n'a pas posees ne prouve que l'etat de la machine sur laquelle il tourne.
 *
 * Trois parcelles suffisent, et leurs distances sont choisies pour ENCADRER le seuil legal de
 * 500 m : une nettement au-dessus, une juste au-dessus, une nettement en dessous. Un filtre a
 * 500 m doit en retenir exactement deux — un filtre absent en retiendrait trois, un filtre
 * inverse une seule.
 */
const PARCELLES = [
  { suffixe: 'A', distanceHabitationM: 1200 },
  { suffixe: 'B', distanceHabitationM: 500 },
  { suffixe: 'C', distanceHabitationM: 120 },
];

function idu(suffixe: string): string {
  return `${DEP_LOCAL}001000YY000${suffixe}`;
}

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM profil_recherche WHERE nom LIKE 'Profil mode 2%'`);
  const idus = PARCELLES.map((p) => idu(p.suffixe));
  await requete(`DELETE FROM parcelle_snapshot WHERE idu = ANY($1)`, [idus]);
  await requete(`DELETE FROM score_parcelle_filiere WHERE idu = ANY($1)`, [idus]);
  await requete(`DELETE FROM parcelle WHERE idu = ANY($1)`, [idus]);
}

async function peupler(): Promise<void> {
  await creerCommunesFictives();
  for (const [i, p] of PARCELLES.entries()) {
    const lon = PT[0] + versEst(100 * (i + 1));
    await requete(
      `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                             contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation)
       VALUES ($1, $2, 'Commune fictive', $3, '000', 'YY', $4, 120000, 120000,
               ST_SetSRID(
                 ST_MakeEnvelope($5::float8, $6::float8, $5::float8 + 0.0001, $6::float8 + 0.0001, 4326),
                 4326),
               ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), current_date)
       ON CONFLICT (idu) DO NOTHING`,
      [idu(p.suffixe), INSEE_LOCAL, DEP_LOCAL, `000${p.suffixe}`.slice(-4), lon, PT[1]],
    );
    await requete(
      `INSERT INTO score_parcelle_filiere (idu, filiere, statut, score_global, detail,
                                           couverture_donnees, version_moteur)
       VALUES ($1, 'eolien_terrestre', 'orange', 60.0, '{}'::jsonb, 1, 'test-recherche-profil')
       ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET score_global = 60.0`,
      [idu(p.suffixe)],
    );
    await requete(
      `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture)
       VALUES ($1, $2::jsonb, '{}'::text[], 1)
       ON CONFLICT (idu) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [idu(p.suffixe), JSON.stringify({ bati: { distanceHabitationM: p.distanceHabitationM } })],
    );
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM profil_recherche LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await nettoyer();
  await peupler();
  app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await app?.close();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : recherche par profil ignoree (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

function entetes(): Record<string, string> {
  const jeton = app!.jwt.sign({
    id: '00000000-0000-0000-0000-000000000002',
    email: 'prospection@local',
    nom: 'prospection',
    role: 'prospection',
    habiliteDonneesProprietaires: false,
  });
  return { authorization: `Bearer ${jeton}` };
}

async function appeler(
  methode: 'GET' | 'POST' | 'DELETE',
  url: string,
  corps?: unknown,
): Promise<{ statut: number; corps: Reponse }> {
  const rep = await app!.inject({
    method: methode,
    url,
    payload: corps as object | undefined,
    headers: entetes(),
  });
  return { statut: rep.statusCode, corps: rep.body ? JSON.parse(rep.body) : null };
}

/** Cree un profil eolien portant les seuils demandes, et rend son identifiant. */
async function profilAvec(nom: string, seuils: unknown[]): Promise<string> {
  const { statut, corps } = await appeler('POST', '/api/profils', {
    nom,
    filiere: 'eolien_terrestre',
    seuils,
  });
  assert.equal(statut, 201, JSON.stringify(corps));
  return corps.id as string;
}

test('LA TRADUCTION N’INVENTE AUCUNE CONDITION, ET DIT CE QU’ELLE N’A PAS SU TRADUIRE', () => {
  /*
   * Test PUR : il n'a pas besoin de base, et c'est voulu. La traduction est la piece dont une
   * erreur serait la plus couteuse, et elle doit pouvoir etre exercee sans monter un serveur.
   */
  const traduction = traduireProfil([
    { contrainteId: ID_RECUL, valeur: 700 },
    { contrainteId: ID_SANS_MESURE, valeur: 300 },
    { contrainteId: ID_ZNIEFF, valeur: 1 },
    { contrainteId: 'eolien_terrestre__contrainte_disparue', valeur: 5 },
  ]);

  // Une seule condition, celle dont la grandeur est reellement mesuree.
  assert.deepEqual(traduction.seuils, [{ chemin: 'bati.distanceHabitationM', min: 700 }]);

  /*
   * Et les trois autres sont NOMMEES avec leur raison. Les taire serait laisser croire a
   * l'operateur que quatre exigences filtrent, quand une seule le fait.
   */
  const raisons = Object.fromEntries(traduction.ignores.map((i) => [i.contrainteId, i.raison]));
  assert.equal(raisons[ID_SANS_MESURE], 'grandeur_non_mesuree');
  assert.equal(raisons[ID_ZNIEFF], 'mode_presence');
  assert.equal(raisons['eolien_terrestre__contrainte_disparue'], 'contrainte_inconnue');
  assert.equal(traduction.ignores.length, 3);
});

test('LE SENS VIENT DU CLASSEUR QUAND IL L’ETABLIT, ET DE L’OPERATEUR SINON', () => {
  // « ≥ 500 m » : le sens est etabli, donc `min`, meme si l'operateur envoie autre chose.
  const etabli = traduireProfil([{ contrainteId: ID_RECUL, valeur: 700, sens: 'max' }]);
  assert.deepEqual(etabli.seuils, [{ chemin: 'bati.distanceHabitationM', min: 700 }]);

  /*
   * A l'inverse, sur une contrainte dont le classeur ne donne pas le sens, il vient de
   * l'operateur — et son absence fait IGNORER le seuil plutot que d'en deviner un. Deviner se
   * tromperait environ une fois sur deux, en silence.
   */
  const ID_MH = 'eolien_terrestre__monuments_historiques_abords_pda_500_m';
  const avecSens = traduireProfil([{ contrainteId: ID_MH, valeur: 800, sens: 'min' }]);
  assert.deepEqual(avecSens.seuils, [{ chemin: 'patrimoine.monumentHistorique.distanceM', min: 800 }]);

  const sansSens = traduireProfil([{ contrainteId: ID_MH, valeur: 800 }]);
  assert.deepEqual(sansSens.seuils, []);
  assert.equal(sansSens.ignores[0]?.raison, 'sens_indetermine');

  // `null` et `undefined` disent la meme chose : la base ne connait pas `undefined`.
  const sensNul = traduireProfil([{ contrainteId: ID_MH, valeur: 800, sens: null }]);
  assert.deepEqual(sensNul.seuils, []);
});

test('§2.3 — LA RECHERCHE AVEC PROFIL APPLIQUE REELLEMENT LE SEUIL DU DEVELOPPEUR', async () => {
  if (ignorer()) return;

  const large = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 50,
  });
  assert.equal(large.statut, 200, JSON.stringify(large.corps));

  /*
   * Un seuil volontairement INATTEIGNABLE : 40 km d'une habitation. Le point de France le plus
   * eloigne d'une maison est a une quinzaine de kilometres, donc aucun resultat ne doit survivre.
   * C'est la seule facon de prouver que la condition est REELLEMENT appliquee sur une base dont
   * on ne connait pas le contenu a l'avance : un seuil permissif rendrait le meme nombre que sans
   * profil, et ne prouverait rien.
   */
  const id = await profilAvec('Profil mode 2 — inatteignable', [
    { contrainteId: ID_RECUL, valeur: 40000, motif: 'Seuil de test' },
  ]);

  const filtre = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 50,
    profilId: id,
  });
  assert.equal(filtre.statut, 200, JSON.stringify(filtre.corps));
  assert.equal(filtre.corps.total, 0, 'aucune parcelle n’est a 40 km d’une habitation');
  assert.equal(filtre.corps.profil.seuilsAppliques, 1);
  assert.deepEqual(filtre.corps.profil.seuilsIgnores, []);

  // Et le meme appel sans profil retrouve le resultat large : le profil n'a rien casse.
  const apres = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 50,
  });
  assert.equal(apres.corps.total, large.corps.total, 'la recherche sans profil est inchangee');

  await appeler('DELETE', `/api/profils/${id}`);
});

test('LE TOTAL ET LA PAGE RESTENT COHERENTS : LE FILTRE EST DANS LE SQL', async () => {
  if (ignorer()) return;

  /*
   * L'INVARIANT QUI A DICTE L'ARCHITECTURE. Filtrer la page apres coup aurait ete plus simple, et
   * aurait produit un `total` compte AVANT le tri : « 240 résultats » au-dessus d'une liste qui en
   * montre neuf, et une page 2 qui ne commence pas ou la page 1 s'arrete.
   *
   * LE SEUIL EST CELUI DE LA LOI, 500 m, ET NON UNE VALEUR PERMISSIVE. Ma premiere ecriture
   * demandait 1 m « pour garder des resultats a compter » — et l'ecriture du profil l'a refusee,
   * a juste titre : un seuil developpeur ne peut que DURCIR. Le controle de l'etape 3 a donc
   * attrape mon propre test. 500 m n'assouplit rien et laisse 71 parcelles sur 301 dans la base
   * de reference, de quoi remplir plusieurs pages.
   */
  const id = await profilAvec('Profil mode 2 — au seuil legal', [
    { contrainteId: ID_RECUL, valeur: 500, motif: 'Seuil de test' },
  ]);

  const r = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 5,
    profilId: id,
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(
    r.corps.resultats.length <= r.corps.total,
    `page de ${r.corps.resultats.length} lignes pour un total annonce de ${r.corps.total}`,
  );
  assert.ok(r.corps.resultats.length <= 5, 'la limite est respectee');
  /*
   * Le test doit DISCRIMINER : un filtre qui ne rendrait rien satisferait « page <= total » sans
   * rien prouver. On exige donc des resultats, et une page pleine quand le total les permet.
   */
  assert.equal(r.corps.profil.seuilsAppliques, 1);

  /*
   * LE COMPTE EXACT, SUR LA POPULATION QUE CE FICHIER A SEMEE. Trois parcelles encadrent le seuil
   * legal de 500 m : 1200 m, 500 m et 120 m. Un filtre « au moins 500 m » doit en retenir
   * exactement DEUX — un filtre absent en retiendrait trois, un filtre inverse une seule.
   *
   * Compter sur les seules parcelles semees, et non sur le total de la base : d'autres fichiers de
   * test peuvent en avoir laisse, et un test qui depend du contenu de la machine ne prouve rien.
   */
  const retenus = (await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    codesDepartement: [DEP_LOCAL],
    limite: 50,
    profilId: id,
  })).corps.resultats.map((l: { idu: string }) => l.idu).sort();
  assert.deepEqual(retenus, [idu('A'), idu('B')].sort(), 'seules les parcelles a ≥ 500 m sont retenues');

  // Et sans profil, les trois remontent : c'est bien le seuil qui filtre, et rien d'autre.
  const sans = (await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    codesDepartement: [DEP_LOCAL],
    limite: 50,
  })).corps.resultats.map((l: { idu: string }) => l.idu).sort();
  assert.deepEqual(sans, [idu('A'), idu('B'), idu('C')].sort());

  assert.ok(r.corps.resultats.length <= r.corps.total, 'la page ne depasse jamais le total');

  await appeler('DELETE', `/api/profils/${id}`);
});

test('UN SEUIL QUE RIEN NE SAIT MESURER EST REMONTE, PAS TU', async () => {
  if (ignorer()) return;

  /*
   * LE CAS LE PLUS DANGEREUX. Le seuil est enregistre, le profil parait complet, la recherche
   * repond 200 — et l'exigence n'a jamais ete verifiee. 250 des 292 contraintes sont aujourd'hui
   * sans grandeur mesuree en face : ce n'est pas un cas limite, c'est le cas courant.
   */
  const id = await profilAvec('Profil mode 2 — non mesurable', [
    { contrainteId: ID_SANS_MESURE, valeur: 300, motif: 'Recul lisieres' },
  ]);

  const r = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 5,
    profilId: id,
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.profil.seuilsAppliques, 0);
  assert.equal(r.corps.profil.seuilsIgnores.length, 1);
  assert.equal(r.corps.profil.seuilsIgnores[0].raison, 'grandeur_non_mesuree');
  // Le message est ECRIT POUR ETRE LU : il nomme la contrainte et dit ce qui n'a pas eu lieu.
  assert.match(r.corps.profil.seuilsIgnores[0].message, /aucune grandeur du relevé/);
  assert.match(r.corps.profil.seuilsIgnores[0].message, /n'a pas été appliqué/);

  await appeler('DELETE', `/api/profils/${id}`);
});

test('UN PROFIL D’UNE AUTRE FILIERE EST REFUSE, ET NON APPLIQUE A VIDE', async () => {
  if (ignorer()) return;

  /*
   * Ses contraintes appartiennent a une autre filiere, donc AUCUNE condition n'en sortirait : la
   * recherche rendrait exactement le meme resultat que sans profil, et l'operateur croirait le
   * cahier des charges applique. Un refus explicite vaut mieux qu'un filtre vide.
   */
  const { corps: cree } = await appeler('POST', '/api/profils', {
    nom: 'Profil mode 2 — methanisation',
    filiere: 'methanisation',
    seuils: [],
  });

  const r = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 5,
    profilId: cree.id,
  });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.erreur.code, 'profil_autre_filiere');
  assert.match(r.corps.erreur.message, /methanisation/);

  await appeler('DELETE', `/api/profils/${cree.id}`);
});

test('UN PROFIL INCONNU OU MAL FORME NE DESCEND PAS JUSQU’A LA BASE', async () => {
  if (ignorer()) return;

  const malForme = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    profilId: 'pas-un-uuid',
  });
  assert.equal(malForme.statut, 400);
  assert.equal(malForme.corps.erreur.code, 'profil_invalide');

  const inconnu = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    profilId: '11111111-1111-1111-1111-111111111111',
  });
  assert.equal(inconnu.statut, 404);
  assert.equal(inconnu.corps.erreur.code, 'profil_introuvable');
});

test('SANS PROFIL, LA REPONSE NE PORTE AUCUN BLOC DE PROFIL', async () => {
  if (ignorer()) return;

  /*
   * NON-REGRESSION DU MODE SANS PROFIL, exigee par le cahier des charges. La recherche classique
   * doit repondre exactement comme avant : un bloc `profil` vide ou nul ferait afficher un
   * bandeau de cahier des charges la ou il n'y en a pas.
   */
  const r = await appeler('POST', '/api/recherche/parcelles', {
    filiere: 'eolien_terrestre',
    limite: 3,
  });
  assert.equal(r.statut, 200);
  assert.ok(!('profil' in r.corps), 'aucune cle `profil` sans profil demande');
  assert.ok('couverture' in r.corps, 'la couverture, elle, reste toujours presente');
});
