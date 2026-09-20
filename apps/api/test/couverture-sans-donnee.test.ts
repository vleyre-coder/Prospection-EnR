/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE COUVERTURE ANNONCEE SANS AUCUNE DONNEE DERRIERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, audit 13, sur la base de bout en bout : `couverture_ingestion` annoncait
 * **2 830 postes sources sur 101 departements**, dont le 28 ou vivent les 301 parcelles de test.
 * La table `poste_source` etait **vide**. Rien, nulle part, ne detectait l'ecart.
 *
 * POURQUOI CE N'EST PAS UNE INCOHERENCE DE COMPTAGE. `couverture_ingestion` est la table sur
 * laquelle le moteur s'appuie pour separer les deux phrases que ce projet distingue depuis douze
 * audits : « aucune contrainte trouvee ici » et « on n'a rien regarde ici ». Une ligne de
 * couverture qui survit a la disparition de ses donnees fait dire a l'application « regarde, rien
 * trouve » — donc un feu vert — la ou il n'y a rien du tout. C'est mot pour mot le defaut C1 de
 * l'audit 8, reouvert par une autre porte.
 *
 * CE QUI A SAUVE LE CAS MESURE, et pourquoi cela ne suffisait pas : `racc_distance_poste` ne
 * consulte pas la couverture, il repond `indispo` des qu'aucun poste n'est trouve. La protection
 * tenait donc a ce qu'un critere ait ete ecrit d'une facon plutot que d'une autre. Le patrimoine,
 * lui, consulte bel et bien la couverture.
 *
 * LE TERRITOIRE EST FICTIF, comme dans `couverture-disque.test.ts` et pour la meme raison : ces
 * tests ecrivent des lignes de couverture, et ils ne doivent toucher aucune donnee reelle.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { couverturesIncoherentes } from '../src/depots/sources.js';

/**
 * UN VRAI CONNECTEUR, ET LE DEPARTEMENT FICTIF.
 *
 * `couverture_ingestion.connecteur` porte une cle etrangere vers `source_donnee` : un connecteur
 * invente est refuse par la base, et c'est une bonne chose — une ligne de couverture ne peut pas
 * decrire une source qui n'existe pas. Le test emprunte donc un connecteur reel et ecrit sur le
 * departement 99, fictif dans tout ce depot, ce qui rend le nettoyage sans risque : aucune ligne
 * reelle ne porte ce code.
 */
const CONNECTEUR = 'document_cadre_local';
const DEP = '99';

let baseDisponible = false;

async function nettoyer(): Promise<void> {
  await requete(
    `DELETE FROM couverture_ingestion WHERE connecteur = $1 AND code_departement = $2`,
    [CONNECTEUR, DEP],
  );
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM couverture_ingestion LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await nettoyer();
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : couverture sans donnee ignoree (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

test('UNE COUVERTURE QUI ANNONCE DES OBJETS SUR UNE CIBLE VIDE EST SIGNALEE', async () => {
  if (ignorer()) return;

  /*
   * Le type vise `contrainte`, et une valeur qu'aucune ingestion reelle n'ecrit : la cible est donc
   * vide par construction, quelle que soit la base sur laquelle ce test tourne — la base semee de
   * bout en bout comme la base jetable de la CI.
   */
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ($1, 'type_qui_n_existe_pas', $2, 1200)`,
    [CONNECTEUR, DEP],
  );

  const signalees = await couverturesIncoherentes();
  const mienne = signalees.find((c) => c.connecteur === CONNECTEUR && c.type === 'type_qui_n_existe_pas');
  assert.ok(
    mienne,
    'une couverture annoncant 1 200 objets sur une cible vide doit etre signalee — ' +
      `obtenu : ${JSON.stringify(signalees)}`,
  );
  // Le compte annonce est rendu : sans lui, le message ne dit pas l'ampleur de ce qui manque.
  assert.equal(mienne.objetsAnnonces, 1200);
  assert.equal(mienne.departements, 1);
});

test('UNE COUVERTURE DONT LA CIBLE EST PEUPLEE N’EST PAS SIGNALEE', async () => {
  if (ignorer()) return;

  /*
   * LE CONTRE-EXEMPLE EST INDISPENSABLE : un garde qui signale tout ne signale rien. On vise ici
   * `zaer`, une table peuplee sur la base semee. Si elle est vide — base jetable de la CI —, le
   * test ne prouverait rien et le dit plutot que de passer a tort.
   */
  const [z] = await requete<{ n: string }>(`SELECT COUNT(*)::text AS n FROM zaer`);
  if (Number(z?.n ?? 0) === 0) {
    process.stderr.write('# table zaer vide : contre-exemple non observable sur cette base\n');
    return;
  }

  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ($1, 'zaer', $2, 7664)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET nb_objets = EXCLUDED.nb_objets`,
    [CONNECTEUR, DEP],
  );

  const signalees = await couverturesIncoherentes();
  assert.ok(
    !signalees.some((c) => c.connecteur === CONNECTEUR && c.type === 'zaer'),
    'une couverture dont la table porte des lignes ne doit jamais etre signalee',
  );
});

test('UNE COUVERTURE A ZERO OBJET N’EST PAS UNE INCOHERENCE', async () => {
  if (ignorer()) return;

  /*
   * « Regarde, et il n'y avait rien » est une reponse LEGITIME, et meme la plus utile de cette
   * table : c'est elle qui autorise une absence constatee. La signaler ferait de ce garde un
   * bruit permanent, et un garde bruyant finit desactive.
   */
  await nettoyer();
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets)
     VALUES ($1, 'type_qui_n_existe_pas', $2, 0)`,
    [CONNECTEUR, DEP],
  );

  const signalees = await couverturesIncoherentes();
  assert.ok(
    !signalees.some((c) => c.connecteur === CONNECTEUR && c.type === 'type_qui_n_existe_pas'),
    'une couverture annoncant zero objet decrit une absence constatee, pas une incoherence',
  );
});
