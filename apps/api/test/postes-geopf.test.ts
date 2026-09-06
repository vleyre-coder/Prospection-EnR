/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES POSTES DEDUITS DE LA BD TOPO — ce qui doit etre garde n'est pas le chargement
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE CONNECTEUR A DE PARTICULIER. Il ne recopie pas une source : il en DEDUIT une, par un
 * raisonnement geometrique. La BD TOPO publie des postes de transformation sans tension et sans
 * capacite, et des lignes electriques avec leur tension. Le connecteur croise les deux pour ne
 * retenir que les postes en contact avec une ligne de 150 kV ou moins.
 *
 * TROIS FACONS DE CASSER CE RAISONNEMENT SANS QUE RIEN NE LE MONTRE, et ce sont les trois que ce
 * fichier verrouille :
 *
 *   1. RETENIR LES POSTES SANS LIGNE. La couche compte 4 128 postes, dont 920 ne touchent aucune
 *      ligne HTB — pour l'essentiel des transformateurs de distribution. Les inclure ferait scorer
 *      une parcelle voisine d'un transformateur de rue comme parfaitement raccordee, sur le critere
 *      qui pese le plus lourd. C'est le pire defaut possible de cette fonctionnalite : un faux
 *      positif confiant, la ou l'absence de donnee etait au moins honnete ;
 *   2. RETENIR LES POSTES PUREMENT THT. 353 postes ne touchent que du 225 ou du 400 kV : c'est le
 *      reseau de transport, ou un projet de 10 MW ne se raccorde pas. Le seuil de 150 kV est la
 *      frontiere HTB1 / HTB2, et il doit rester une decision explicite ;
 *   3. INVENTER UNE CAPACITE. La BD TOPO n'en publie aucune. Un jour, quelqu'un voudra remplir
 *      `capacite_residuelle_mw` « en attendant mieux », et le dossier de site annoncera une capacite
 *      d'accueil fabriquee a un developpeur. Le test l'interdit.
 *
 * CES TESTS N'APPELLENT PAS LE RESEAU. Le raisonnement du connecteur est en SQL : il est donc
 * verifiable en semant a la main quelques postes et quelques lignes dans les tables de travail, ce
 * qui permet de poser exactement les cas limites — un poste a 1 m d'une ligne, un poste 400 kV
 * seul, un poste deja connu de Capareseau. Une execution reelle ne les produirait pas a la demande.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import { retenirPostes } from '../src/ingestion/postes-geopf.js';
import { postesLesPlusProches } from '../src/connecteurs/locales.js';
import { enregistrerCouverture } from '../src/depots/sources.js';
// Territoire fictif PARTAGE : l'import passe par le garde de serialisation (audit 11).
import { DEP_LOCAL } from './aides/communes-fictives.js';

/** Departement fictif : aucune donnee reelle ne le porte. */
const DEP = DEP_LOCAL;
const CONNECTEUR = 'postes_geopf';

function ignorer(): boolean {
  if (!process.env['DATABASE_URL']) {
    process.stderr.write('# base indisponible : deduction des postes BD TOPO ignoree\n');
    return true;
  }
  return false;
}

/**
 * Seme les tables de travail du connecteur, puis lance SA fonction de deduction.
 *
 * LE POINT ESSENTIEL : `retenirPostes` est le code de production, pas une copie. Ma premiere
 * version de ce fichier rejouait la requete dans le test — verifie par mutation, casser le
 * critere de contact, monter le seuil a 400 kV ou inventer une capacite ne faisait alors echouer
 * AUCUN test. Trois gardes decoratifs, dans le fichier meme qui pretendait les tenir.
 */
async function deduire(kvMax?: number): Promise<Array<{ id: string; tension: string | null; capacite: number | null }>> {
  await requete(`DELETE FROM poste_source WHERE connecteur = $1`, [CONNECTEUR]);
  /*
   * SANS ARGUMENT, LE SEUIL PAR DEFAUT DU CONNECTEUR S'APPLIQUE — et c'est indispensable.
   * Ma premiere version donnait a cette aide son PROPRE defaut de 150 : le seuil du code de
   * production n'etait donc jamais exercé, et la mutation qui le porte a 400 kV ne faisait echouer
   * aucun test. Un test qui recopie la valeur qu'il pretend verifier ne verifie rien.
   */
  await (kvMax === undefined ? retenirPostes() : retenirPostes(kvMax));
  return requete(
    `SELECT id, tension, capacite_residuelle_mw AS capacite
       FROM poste_source WHERE connecteur = $1 ORDER BY id`,
    [CONNECTEUR],
  );
}

/** Identifiant tel que le connecteur l'ecrit. */
const idDe = (cleabs: string): string => `geopf:${cleabs}`;

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  /*
   * VIDEES, JAMAIS SUPPRIMEES. Ces deux tables appartiennent au schema depuis la migration 017 :
   * les faire tomber ici les retirait pour TOUS les fichiers suivants de la meme base, et le garde
   * `sql-analysable.test.ts` echouait ensuite en « relation ing_poste_geopf does not exist » — un
   * echec a distance, dans un fichier qui n'y est pour rien. Trouve en relancant `test:base` sur
   * une base fraiche.
   */
  await requete(`TRUNCATE ing_poste_geopf, ing_ligne_geopf`);

  /*
   * Un carre de 100 m de cote par poste, place le long d'un axe est-ouest en Lambert-93, et des
   * lignes droites qui le traversent ou l'evitent. Les coordonnees sont arbitraires mais METRIQUES :
   * c'est ce qui rend « a 300 m » verifiable.
   */
  const carre = (x: number): string =>
    `ST_GeomFromText('POLYGON((${x} 6800000, ${x + 100} 6800000, ${x + 100} 6800100, ${x} 6800100, ${x} 6800000))', 2154)`;
  const semerPoste = async (cleabs: string, x: number): Promise<void> => {
    await requete(
      `INSERT INTO ing_poste_geopf (cleabs, geom, g2154)
       VALUES ($1, ST_Multi(ST_Transform(${carre(x)}, 4326)), ST_Multi(${carre(x)}))`,
      [cleabs],
    );
  };
  await semerPoste('P_63', 400000);
  await semerPoste('P_400', 500000);
  await semerPoste('P_MIXTE', 600000);
  await semerPoste('P_SANS', 700000);

  const ligne = (x1: number, x2: number, y: number): string =>
    `ST_GeomFromText('LINESTRING(${x1} ${y}, ${x2} ${y})', 2154)`;
  const semerLigne = async (
    cleabs: string,
    voltage: string,
    gestionnaire: string | null,
    geo: string,
  ): Promise<void> => {
    await requete(
      `INSERT INTO ing_ligne_geopf (cleabs, voltage, gestionnaire, geom, g2154)
       VALUES ($1, $2, $3, ST_Transform(${geo}, 4326), ${geo})`,
      [cleabs, voltage, gestionnaire],
    );
  };
  // Traverse P_63.
  await semerLigne('L1', '63 kV', "Réseau de Transport d'Electricité", ligne(399000, 401000, 6800050));
  // Traverse P_400 : reseau de transport pur.
  await semerLigne('L2', '400 kV', null, ligne(499000, 501000, 6800050));
  // Deux lignes traversent P_MIXTE : une THT et une HTB1.
  await semerLigne('L3', '225 kV', null, ligne(599000, 601000, 6800050));
  await semerLigne('L4', '90 kV', null, ligne(599000, 601000, 6800060));
  // Passe a 300 m au sud de P_SANS : proche, mais sans contact.
  await semerLigne('L5', '63 kV', null, ligne(699000, 701000, 6799700));
});

after(async () => {
  if (process.env['DATABASE_URL']) {
    await requete(`TRUNCATE ing_poste_geopf, ing_ligne_geopf`).catch(() => undefined);
    /*
     * LES POSTES SEMES SONT RETIRES, et l'oubli s'est paye a distance. `poste_source` est une table
     * PARTAGEE : les trois postes fictifs laisses ici faisaient echouer `couverture-disque.test.ts`
     * en « 3 !== 1 », dans un fichier qui n'a rien a voir avec celui-ci. Un test qui ne rend pas la
     * base telle qu'il l'a trouvee accuse le code d'un defaut qui lui appartient.
     */
    await requete(`DELETE FROM poste_source WHERE id LIKE 'geopf:P_%'`).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
});

test('UN POSTE SANS LIGNE HTB N’EST JAMAIS RETENU, meme a 300 m', async () => {
  if (ignorer()) return;
  const retenus = (await deduire()).map((r) => r.id);
  assert.ok(
    !retenus.includes(idDe('P_SANS')),
    'un poste sans contact avec une ligne HTB a ete retenu. La couche compte 920 postes dans ce ' +
      'cas : ce sont des transformateurs de distribution, et une parcelle voisine serait notee ' +
      '« parfaitement raccordee » sur le critere le plus lourd du score.',
  );
});

test('UN POSTE PUREMENT THT (400 kV) EST ECARTE', async () => {
  if (ignorer()) return;
  const retenus = (await deduire()).map((r) => r.id);
  assert.ok(
    !retenus.includes(idDe('P_400')),
    'un poste ne touchant que du 400 kV a ete retenu. C’est le reseau de transport : un projet de ' +
      '10 MW ne s’y raccorde pas, et le compter produit un faux positif de proximite.',
  );
});

test('UN POSTE MIXTE EST RETENU A SA TENSION LA PLUS BASSE', async () => {
  if (ignorer()) return;
  const retenus = await deduire();
  const mixte = retenus.find((r) => r.id === idDe('P_MIXTE'));
  assert.ok(mixte, 'un poste touchant a la fois du 225 kV et du 90 kV doit etre retenu');
  assert.equal(
    mixte.tension,
    '90 kV',
    'la tension inscrite doit etre la PLUS BASSE des lignes en contact — c’est le niveau auquel on ' +
      'se raccorde, pas le plus impressionnant du site',
  );
});

test('LE SEUIL DE TENSION EST UNE DECISION, et il se voit', async () => {
  if (ignorer()) return;
  /*
   * Le meme jeu de donnees, lu a deux seuils. Si le seuil cessait d'etre applique, les deux
   * lectures rendraient la meme chose et la frontiere HTB1 / HTB2 aurait disparu en silence.
   */
  const sous150 = (await deduire(150)).map((r) => r.id).sort();
  const sous400 = (await deduire(400)).map((r) => r.id).sort();
  assert.deepEqual(sous150, [idDe('P_63'), idDe('P_MIXTE')]);
  assert.deepEqual(sous400, [idDe('P_400'), idDe('P_63'), idDe('P_MIXTE')]);
});

test('AUCUNE CAPACITE N’EST INVENTEE par ce connecteur', async () => {
  if (ignorer()) return;
  /*
   * LE GARDE LE PLUS IMPORTANT DE CE FICHIER, et le seul qui porte sur la table reelle. La BD TOPO
   * ne publie AUCUNE capacite d'accueil. Le jour ou quelqu'un remplira `capacite_residuelle_mw`
   * « en attendant mieux », le dossier de site annoncera a un developpeur une capacite fabriquee —
   * et rien, dans le document, ne dira qu'elle l'est.
   */
  const [l] = await requete<{ n: number; capacites: number; saturations: number; files: number }>(
    `SELECT count(*)::int AS n,
            count(capacite_residuelle_mw)::int AS capacites,
            count(etat_saturation)::int AS saturations,
            count(file_attente_mw)::int AS files
       FROM poste_source WHERE connecteur = $1`,
    [CONNECTEUR],
  );
  if ((l?.n ?? 0) === 0) {
    process.stderr.write('# aucun poste BD TOPO en base : garde de capacite non exerce\n');
    return;
  }
  assert.equal(l!.capacites, 0, `${l!.capacites} poste(s) BD TOPO portent une capacite d’accueil`);
  assert.equal(l!.saturations, 0, `${l!.saturations} poste(s) BD TOPO portent un etat de saturation`);
  assert.equal(l!.files, 0, `${l!.files} poste(s) BD TOPO portent une file d’attente`);
});

test('le connecteur est declare dans le referentiel des sources', async () => {
  if (ignorer()) return;
  /*
   * `poste_source.connecteur` reference `source_donnee` : un connecteur absent du referentiel fait
   * echouer l'insertion sur une cle etrangere, APRES le telechargement. C'est exactement ce qui
   * s'est produit a la premiere execution reelle.
   */
  const [l] = await requete<{ n: number; avertissement: string | null }>(
    `SELECT count(*)::int AS n, max(avertissement) AS avertissement
       FROM source_donnee WHERE connecteur = $1`,
    [CONNECTEUR],
  );
  assert.equal(l?.n, 1, 'le connecteur doit etre inscrit dans `source_donnee`');
  assert.ok(
    /capacit/i.test(l?.avertissement ?? ''),
    'l’avertissement de la source doit dire qu’elle ne porte AUCUNE capacite : c’est ce texte que ' +
      'la fiche et le dossier reprennent sous le poste',
  );
});

test('le territoire fictif ne porte aucun poste deduit', async () => {
  if (ignorer()) return;
  // Garde d'hygiene : ce fichier ne doit rien laisser derriere lui dans le departement partage.
  const [l] = await requete<{ n: number }>(
    `SELECT count(*)::int AS n FROM poste_source WHERE code_departement = $1`,
    [DEP],
  );
  assert.equal(l?.n, 0);
});

test('LE CONNECTEUR D’ORIGINE REMONTE AVEC LES POSTES', async () => {
  if (ignorer()) return;
  /*
   * POURQUOI CE GARDE EXISTE. Deux sources alimentent `poste_source` : Capareseau, qui publie la
   * capacite d'accueil, et la BD TOPO, qui n'a que la position. L'enrichissement cite les sources
   * du snapshot a partir de cette liste ; si elle revenait vide, la fiche et le dossier
   * attribueraient a CAPARESEAU une position venue de la BD TOPO — et lui feraient porter son
   * avertissement sur les capacites, sous un poste dont la capacite est justement inconnue.
   */
  await deduire();
  // Le poste P_63 est en Lambert-93 (400 050, 6 800 050) : on interroge son voisinage immediat.
  const [pt] = await requete<{ lon: number; lat: number }>(
    `SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM poste_source WHERE id = $1`,
    [idDe('P_63')],
  );
  assert.ok(pt, 'le poste temoin doit avoir ete ecrit');
  // La couverture du departement du poste est declaree, sinon la lecture refuse par construction.
  const [dep] = await requete<{ d: string | null }>(
    `SELECT code_departement AS d FROM poste_source WHERE id = $1`,
    [idDe('P_63')],
  );
  if (dep?.d == null) {
    process.stderr.write('# poste temoin hors commune connue : garde de tracabilite non exerce\n');
    return;
  }
  await enregistrerCouverture(CONNECTEUR, 'poste_source', dep.d, 1, 'test');
  const r = await postesLesPlusProches([pt!.lon, pt!.lat], 1);
  assert.ok(r.postes.length > 0, 'le poste temoin doit etre trouve');
  assert.deepEqual(
    r.connecteurs,
    [CONNECTEUR],
    `la liste des connecteurs d'origine doit nommer ${CONNECTEUR} : sans elle, la fiche cite ` +
      'Capareseau pour une donnee qu’elle n’a pas fournie',
  );
});
