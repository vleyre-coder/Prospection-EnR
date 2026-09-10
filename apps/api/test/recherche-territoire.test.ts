/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * BALAYAGE D'UN TERRITOIRE PAR CRITERES — contre la base, parce que rien d'autre ne le prouve
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER VERIFIE, ET POURQUOI IL LUI FAUT UNE BASE. Les quatre criteres ajoutes par
 * l'outil de recherche sont du SQL, et pour trois d'entre eux du SQL sur du JSONB :
 *
 *   - `codesDepartement` -> `p.code_departement = ANY($n)` ;
 *   - `codeRegion`       -> sous-requete sur `commune.code_region` ;
 *   - `enZaerSeulement`  -> `COALESCE((snapshot -> 'urbanisme' -> 'zaer' ->> 'present')::boolean, false)` ;
 *   - `typesZonePlu`     -> `EXISTS (... jsonb_array_elements(snapshot -> 'urbanisme' -> 'zonages') ...)`.
 *
 * Un chemin JSONB faux ne provoque aucune erreur : `->>` sur une cle absente rend `NULL`, et la
 * condition devient simplement fausse. Le filtre serait donc ANNONCE et jamais applique — ou
 * appliqué à l'envers — sans qu'aucun typage ni aucune revue ne le voie. Seule une lecture de base
 * le tranche.
 *
 * ET LA COUVERTURE, qui est la raison d'etre de tout ce chantier. La recherche ne porte que sur les
 * parcelles QUALIFIEES : sur un departement jamais balaye elle repond « 0 resultat », ce qui se lit
 * « aucun foncier propice » et fait passer au departement suivant. `CouvertureRecherche` distingue
 * les deux, et ces tests exigent que ses comptes soient pris SANS les criteres de l'utilisateur —
 * une couverture qui subirait les criteres vaudrait toujours le nombre de resultats, et ne dirait
 * plus rien.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { filtrerParcelles, territoiresInterrogeables } from '../src/services/recherche.js';
import {
  creerCommunesFictives,
  supprimerCommunesFictives,
  DEP_LOCAL,
  DEP_VOISIN,
  INSEE_LOCAL,
  INSEE_VOISIN,
  PT,
  REGION_FICTIVE,
  versEst,
} from './aides/communes-fictives.js';

/**
 * Population de test, decrite par ce qui la distingue.
 *
 * QUATRE PARCELLES SUFFISENT, et le choix de leurs proprietes est ce qui rend les tests
 * DISCRIMINANTS. Chacune casse un filtre different :
 *
 *   - `A` : dep 99, en ZAER, zonage A         -> retenue par tous les criteres ;
 *   - `B` : dep 99, hors ZAER, zonage A       -> ecartee par le seul critere ZAER ;
 *   - `C` : dep 99, en ZAER, zonage N puis U  -> ecartee par le seul critere de zonage `A` ;
 *   - `D` : dep 98, en ZAER, zonage A         -> ecartee par le seul critere de departement.
 *
 * Un jeu ou toutes les parcelles partagent leurs proprietes laisserait passer un filtre inverse :
 * il rendrait tout, ou rien, dans les deux cas.
 */
interface Cas {
  suffixe: string;
  dep: string;
  insee: string;
  zaer: boolean;
  /** Le snapshot est-il present du tout ? `false` teste le COALESCE a `false`. */
  snapshot: boolean;
  zonages: string[];
}

const CAS: Cas[] = [
  { suffixe: 'A', dep: DEP_LOCAL, insee: INSEE_LOCAL, zaer: true, snapshot: true, zonages: ['A'] },
  { suffixe: 'B', dep: DEP_LOCAL, insee: INSEE_LOCAL, zaer: false, snapshot: true, zonages: ['A'] },
  {
    suffixe: 'C',
    dep: DEP_LOCAL,
    insee: INSEE_LOCAL,
    zaer: true,
    snapshot: true,
    // Deux zonages, en minuscules DELIBEREMENT : le Geoportail de l'urbanisme ne normalise pas
    // `typezone`, et le SQL compare `upper()` des deux cotes. Ecrire 'n' ici verifie ce
    // `upper()` : sans lui, chercher 'N' ne trouverait pas cette parcelle.
    zonages: ['n', 'u'],
  },
  { suffixe: 'D', dep: DEP_VOISIN, insee: INSEE_VOISIN, zaer: true, snapshot: true, zonages: ['A'] },
  // Cinquieme cas, sans snapshot du tout : il ne doit JAMAIS etre retenu par « uniquement en ZAER ».
  { suffixe: 'E', dep: DEP_LOCAL, insee: INSEE_LOCAL, zaer: false, snapshot: false, zonages: [] },
];

const FILIERE = 'solaire_sol' as const;
let baseDisponible = false;

function idu(c: Cas): string {
  return `${c.dep}001000ZZ000${c.suffixe}`;
}

async function nettoyer(): Promise<void> {
  const idus = CAS.map(idu);
  await requete(`DELETE FROM parcelle_snapshot WHERE idu = ANY($1)`, [idus]);
  await requete(`DELETE FROM score_parcelle_filiere WHERE idu = ANY($1)`, [idus]);
  await requete(`DELETE FROM parcelle WHERE idu = ANY($1)`, [idus]);
}

async function peupler(): Promise<void> {
  await creerCommunesFictives();
  for (const [i, c] of CAS.entries()) {
    const lon = PT[0] + versEst(100 * (i + 1));
    await requete(
      `INSERT INTO parcelle (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
                             contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation)
       VALUES ($1, $2, 'Commune fictive', $3, '000', 'ZZ', $4, 120000, 120000,
               ST_SetSRID(
                 ST_MakeEnvelope($5::float8, $6::float8, $5::float8 + 0.0001, $6::float8 + 0.0001, 4326),
                 4326),
               ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), current_date)
       ON CONFLICT (idu) DO NOTHING`,
      [idu(c), c.insee, c.dep, `000${c.suffixe}`.slice(-4), lon, PT[1]],
    );
    await requete(
      `INSERT INTO score_parcelle_filiere (idu, filiere, statut, score_global, detail,
                                           couverture_donnees, version_moteur)
       VALUES ($1, $2, 'orange', 60.0, '{}'::jsonb, 1, 'test-recherche-territoire')
       ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET score_global = 60.0`,
      [idu(c), FILIERE],
    );
    if (!c.snapshot) continue;
    const snapshot = {
      urbanisme: {
        zaer: { present: c.zaer },
        zonages: c.zonages.map((z) => ({ typeZone: z, libelle: z, partRecouvrement: 1 })),
      },
    };
    await requete(
      `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture)
       VALUES ($1, $2::jsonb, '{}'::text[], 1)
       ON CONFLICT (idu) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [idu(c), JSON.stringify(snapshot)],
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
        'Ces tests ne doivent pas passer a vide.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await nettoyer();
  await peupler();
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : recherche par territoire ignoree (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/** Les suffixes retenus, tries : plus lisible qu'une liste d'IDU dans un message d'echec. */
async function retenus(filtres: Record<string, unknown>): Promise<string[]> {
  const { resultats } = await filtrerParcelles({ filiere: FILIERE, limite: 50, ...filtres });
  return resultats
    .map((r) => r.idu)
    .filter((i) => CAS.some((c) => idu(c) === i))
    .map((i) => i.slice(-1))
    .sort();
}

// ---------------------------------------------------------------------------
// Territoire : departements et region
// ---------------------------------------------------------------------------

test('UNE LISTE DE DEPARTEMENTS BALAIE EXACTEMENT CES DEPARTEMENTS', async () => {
  if (ignorer()) return;
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL] }), ['A', 'B', 'C', 'E']);
  assert.deepEqual(await retenus({ codesDepartement: [DEP_VOISIN] }), ['D']);
  // Les deux ensemble : c'est le cas que `codeDepartement` seul ne savait pas exprimer, et la
  // raison d'etre du champ.
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL, DEP_VOISIN] }), [
    'A',
    'B',
    'C',
    'D',
    'E',
  ]);
});

test('UNE REGION SE RESOUT EN SES DEPARTEMENTS PAR LA TABLE COMMUNE', async () => {
  if (ignorer()) return;
  /*
   * La correspondance vient de la DONNEE et n'est codee en dur nulle part : les deux communes
   * fictives portent `code_region = '99'`, et la region doit donc rendre les deux departements.
   * Un test qui n'exercerait qu'un seul departement par region ne distinguerait pas cette
   * resolution d'un simple `code_departement = code_region`.
   */
  assert.deepEqual(await retenus({ codeRegion: REGION_FICTIVE }), ['A', 'B', 'C', 'D', 'E']);
  // Une region sans commune ne rend rien — et surtout pas tout, ce qui serait le signe d'un
  // filtre qui saute.
  assert.deepEqual(await retenus({ codeRegion: '00' }), []);
});

test('REGION ET DEPARTEMENTS SE CUMULENT, ILS NE S’ADDITIONNENT PAS', async () => {
  if (ignorer()) return;
  /*
   * « La region 99, mais seulement le departement 98 » doit rendre le 98 seul. L'ecriture naive —
   * un OR entre les deux criteres — aurait rendu toute la region, c'est-a-dire PLUS que ce qui est
   * demande. C'est le sens d'erreur inacceptable pour un outil de tri : elargir en silence.
   */
  assert.deepEqual(
    await retenus({ codeRegion: REGION_FICTIVE, codesDepartement: [DEP_VOISIN] }),
    ['D'],
  );
  // Et une intersection vide rend vide, sans se rabattre sur l'un des deux criteres.
  assert.deepEqual(await retenus({ codeRegion: '00', codesDepartement: [DEP_LOCAL] }), []);

  /*
   * ET LA COUVERTURE DOIT DIRE LE MEME PERIMETRE QUE LE SQL.
   *
   * DEFAUT MESURE PAR MUTATION, non par relecture. Le filtre SQL applique region ET departements
   * comme deux conditions independantes, donc il cumule correctement quoi qu'il arrive. La
   * COUVERTURE, elle, passe par `departementsDuTerritoire` : remplacer son intersection par une
   * union laissait les resultats justes et faisait mentir le bandeau — « balayage sur
   * 2 departements » pour un resultat pris sur un seul, avec un denominateur gonfle du double.
   * Ma premiere version de ce test ne verifiait que `retenus()` : la mutation a survecu, et c'est
   * elle qui a montre le trou.
   */
  const { couverture } = await filtrerParcelles({
    filiere: FILIERE,
    codeRegion: REGION_FICTIVE,
    codesDepartement: [DEP_VOISIN],
    limite: 50,
  });
  assert.deepEqual(
    couverture.departementsDemandes,
    [DEP_VOISIN],
    'le bandeau doit nommer le perimetre REELLEMENT balaye, pas la region demandee',
  );
  assert.equal(
    couverture.parcellesQualifiees,
    1,
    'le denominateur doit porter sur le seul departement retenu : gonfle, il ferait paraitre le ' +
      'territoire moins exploite qu’il ne l’est',
  );
});

// ---------------------------------------------------------------------------
// Urbanisme : ZAER et zonage du PLU
// ---------------------------------------------------------------------------

test('« UNIQUEMENT EN ZAER » N’INVENTE JAMAIS UNE ZAER ABSENTE', async () => {
  if (ignorer()) return;
  const r = await retenus({ codesDepartement: [DEP_LOCAL], enZaerSeulement: true });
  assert.deepEqual(r, ['A', 'C']);
  /*
   * LE SENS DU COALESCE EST LE POINT SENSIBLE. `E` n'a AUCUN snapshot : sans `COALESCE(..., false)`
   * la condition serait `NULL = true`, donc fausse — mais un `COALESCE(..., true)` ecrit par
   * inadvertance la ferait apparaitre comme situee en zone d'acceleration. Le sens d'erreur
   * acceptable est de perdre une occasion, jamais d'en inventer une : une ZAER annoncee a tort
   * enverrait un prospecteur defendre un argument qui n'existe pas.
   */
  assert.ok(!r.includes('E'), 'une parcelle sans snapshot ne doit pas etre presumee en ZAER');
  assert.ok(!r.includes('B'), 'une parcelle dont le snapshot dit `present: false` doit etre ecartee');
});

test('LE ZONAGE PLU RETIENT UNE PARCELLE QUI TOUCHE LA ZONE, ET IGNORE LA CASSE', async () => {
  if (ignorer()) return;
  // `A` et `B` portent un zonage 'A' ; `C` porte 'n' et 'u' en minuscules.
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL], typesZonePlu: ['A'] }), ['A', 'B']);
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL], typesZonePlu: ['N'] }), ['C']);
  // « TOUCHE », et non « a pour dominante » : `C` est rendue par 'N' comme par 'U', puisqu'elle
  // porte les deux.
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL], typesZonePlu: ['U'] }), ['C']);
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL], typesZonePlu: ['N', 'A'] }), [
    'A',
    'B',
    'C',
  ]);
  // Un type absent de la base ne rend rien, et surtout pas tout.
  assert.deepEqual(await retenus({ codesDepartement: [DEP_LOCAL], typesZonePlu: ['AUC'] }), []);
});

test('LES CRITERES D’URBANISME SE CUMULENT ENTRE EUX', async () => {
  if (ignorer()) return;
  // En ZAER ET zonage A : `A` seule (`B` est hors ZAER, `C` n'est pas en zone A).
  assert.deepEqual(
    await retenus({ codesDepartement: [DEP_LOCAL], enZaerSeulement: true, typesZonePlu: ['A'] }),
    ['A'],
  );
});

// ---------------------------------------------------------------------------
// La couverture : ce qui empeche « 0 resultat » de mentir
// ---------------------------------------------------------------------------

test('LA COUVERTURE EST PRISE SANS LES CRITERES DE L’UTILISATEUR', async () => {
  if (ignorer()) return;
  /*
   * C'EST LE TEST QUI DONNE SON SENS AU BLOC. Si la couverture subissait les criteres, elle
   * vaudrait toujours le nombre de resultats et n'informerait plus de rien : « 1 sur 1 » se lirait
   * comme un territoire entierement exploite. On demande donc un filtre TRES restrictif et on
   * exige que le denominateur reste celui du territoire.
   */
  const { total, couverture } = await filtrerParcelles({
    filiere: FILIERE,
    codesDepartement: [DEP_LOCAL],
    enZaerSeulement: true,
    typesZonePlu: ['A'],
    limite: 50,
  });

  assert.equal(total, 1, 'un seul cas repond a ces trois criteres');
  assert.deepEqual(couverture.departementsDemandes, [DEP_LOCAL]);
  assert.ok(
    couverture.parcellesQualifiees >= 4,
    `le denominateur doit compter les 4 parcelles du departement, vaut ${couverture.parcellesQualifiees}`,
  );
  assert.ok(couverture.parcellesQualifiees > total, 'sinon la couverture n’apporte rien');
  assert.ok((couverture.communesDuTerritoire ?? 0) >= 1);
  assert.ok(couverture.communesAvecParcelle >= 1);
});

test('UNE REGION DEMANDEE EST DEVELOPPEE DANS LA COUVERTURE', async () => {
  if (ignorer()) return;
  // L'operateur a nomme une region ; le bandeau doit nommer les departements REELLEMENT balayes,
  // faute de quoi il ne dirait pas sur quoi le resultat porte.
  const { couverture } = await filtrerParcelles({
    filiere: FILIERE,
    codeRegion: REGION_FICTIVE,
    limite: 50,
  });
  assert.deepEqual(couverture.departementsDemandes, [DEP_VOISIN, DEP_LOCAL].sort());
});

test('SANS TERRITOIRE, LA COUVERTURE NE PRETEND PAS EN CONNAITRE UN', async () => {
  if (ignorer()) return;
  /*
   * `communesDuTerritoire` a `null` et non a 0 : la question n'a pas de denominateur quand la
   * recherche porte sur toute la base. Rendre 0 aurait fait afficher « 0 commune sur 0 », soit une
   * couverture nulle sur une recherche parfaitement valide.
   */
  const { couverture } = await filtrerParcelles({ filiere: FILIERE, limite: 5 });
  assert.deepEqual(couverture.departementsDemandes, []);
  assert.equal(couverture.communesDuTerritoire, null);
});

test('UN TERRITOIRE JAMAIS QUALIFIE SE DISTINGUE D’UN TERRITOIRE SANS RESULTAT', async () => {
  if (ignorer()) return;
  /*
   * LE DEFAUT D'ORIGINE, en deux appels. Les deux rendent `total: 0`. Seule la couverture dit que
   * le premier n'a rien a comparer, et que le second a ete balaye sans rien trouver — deux
   * conclusions opposees pour l'operateur : qualifier, ou revoir ses criteres.
   */
  const jamais = await filtrerParcelles({
    filiere: FILIERE,
    // Un departement qui n'existe pas : aucune parcelle, aucune commune.
    codesDepartement: ['00'],
    limite: 5,
  });
  assert.equal(jamais.total, 0);
  assert.equal(jamais.couverture.parcellesQualifiees, 0);

  const balayeSansResultat = await filtrerParcelles({
    filiere: FILIERE,
    codesDepartement: [DEP_LOCAL],
    // Aucune parcelle du jeu ne fait 5 000 ha.
    surfaceMinHa: 5000,
    limite: 5,
  });
  assert.equal(balayeSansResultat.total, 0);
  assert.ok(
    balayeSansResultat.couverture.parcellesQualifiees >= 4,
    'un territoire balaye doit annoncer ses parcelles qualifiees meme quand les criteres ne rendent rien',
  );
});

// ---------------------------------------------------------------------------
// Le selecteur de territoires
// ---------------------------------------------------------------------------

test('LE SELECTEUR NOMME LES TERRITOIRES ET COMPTE CE QUE LA BASE CONTIENT', async () => {
  if (ignorer()) return;
  const { regions, departements } = await territoiresInterrogeables(FILIERE);

  // La nomenclature est complete, et vient de `@enr/core` : ni la base ni l'interface ne la
  // portent.
  assert.equal(regions.length, 18);
  assert.equal(departements.length, 101);
  const eureEtLoir = departements.find((d) => d.code === '28');
  assert.equal(eureEtLoir?.nom, 'Eure-et-Loir');
  assert.equal(eureEtLoir?.codeRegion, '24');

  /*
   * LES COMPTES VIENNENT DE LA BASE, ET LE TEST DOIT LE PROUVER. Les departements fictifs 98 et 99
   * ne figurent pas dans la nomenclature — ils n'existent pas — donc le selecteur ne les propose
   * pas, ce qui est correct. En revanche chaque territoire propose porte un compte, et la somme
   * des departements d'une region doit egaler celui de la region : une agregation fausse
   * afficherait des chiffres qui ne s'additionnent pas, ce qu'un operateur remarque tout de suite.
   */
  for (const r of regions) {
    const siens = departements.filter((d) => d.codeRegion === r.code);
    assert.equal(
      r.parcellesQualifiees,
      siens.reduce((s, d) => s + (d.parcellesQualifiees ?? 0), 0),
      `region ${r.code} : le compte ne correspond pas a la somme de ses departements`,
    );
    assert.equal(
      r.communes,
      siens.reduce((s, d) => s + d.communes, 0),
      `region ${r.code} : le nombre de communes ne correspond pas a la somme de ses departements`,
    );
  }
});

test('SANS FILIERE, LE SELECTEUR RENVOIE `null` ET NON ZERO', async () => {
  if (ignorer()) return;
  // Afficher « 0 parcelle qualifiee » sans avoir precise la filiere serait une absence CONSTATEE
  // alors qu'aucune mesure n'a ete faite. `null` dit « non mesure », ce qui est la verite.
  const sansFiliere = await territoiresInterrogeables();
  assert.ok(sansFiliere.departements.every((d) => d.parcellesQualifiees === null));
  assert.ok(sansFiliere.regions.every((r) => r.parcellesQualifiees === null));

  /*
   * LE COMPTE DE COMMUNES, LUI, NE DEPEND PAS DE LA FILIERE, et c'est ce qu'il faut verifier —
   * non qu'il soit non nul.
   *
   * MA PREMIERE ECRITURE AFFIRMAIT `communes > 0` quelque part, et elle a echoue sur une base
   * fraichement migree : les seules communes qu'y trouvent les tests sont les deux communes
   * FICTIVES des departements 98 et 99, qui n'existent pas dans la nomenclature et ne sont donc
   * proposees par aucun selecteur — a juste titre. L'assertion mesurait l'HISTOIRE de la base,
   * pas le code. Celle-ci mesure le code : les deux appels doivent rendre les memes communes.
   */
  const avecFiliere = await territoiresInterrogeables(FILIERE);
  assert.deepEqual(
    sansFiliere.departements.map((d) => [d.code, d.communes]),
    avecFiliere.departements.map((d) => [d.code, d.communes]),
  );
});
