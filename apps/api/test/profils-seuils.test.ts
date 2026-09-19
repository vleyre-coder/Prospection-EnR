/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PROFILS DE RECHERCHE ET SEUILS DEVELOPPEUR — ce que l'ecriture doit refuser
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROTEGE. Le formulaire de seuils developpeur peut produire une faute
 * silencieuse et couteuse : un seuil PLUS PERMISSIF que la reglementation. La recherche ferait
 * alors remonter du foncier que le droit interdit, et l'operateur constituerait un dossier de
 * prospection dessus — sans qu'aucun message, aucun journal, aucun ecran rouge ne le signale.
 * C'est un refus, pas un avertissement, et il se teste.
 *
 * Trois autres refus valent autant, pour la meme raison — l'erreur serait muette :
 *   - un identifiant de contrainte inconnu (faute de frappe) : le seuil serait enregistre et
 *     n'appliquerait rien, pendant que le developpeur croit son exigence prise en compte ;
 *   - une contrainte d'une AUTRE filiere : idem, avec en plus un formulaire qui paraitra coherent ;
 *   - un sens choisi la ou le classeur l'etablit : la contrainte s'appliquerait a l'envers.
 *
 * Une partie de ces controles est PURE et se teste sans base ; le reste exige un aller-retour
 * reel, parce qu'une transaction a moitie ecrite ne se voit pas autrement.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, requete } from '../src/bdd.js';
import * as depot from '../src/depots/profils.js';
import { construireServeur } from '../src/serveur.js';

/**
 * Le type du serveur est DEDUIT de la fabrique, et non reimporte de `fastify`.
 *
 * `FastifyInstance` sans ses parametres generiques n'est pas le meme type que celui que
 * `construireServeur` rend — le serveur porte son propre logger — et l'affectation ne compile pas.
 */
type Serveur = Awaited<ReturnType<typeof construireServeur>>;

/**
 * Forme laxiste du corps de reponse, assumee et bornee a ce fichier.
 *
 * Decrire les six formes rendues par ces routes donnerait six interfaces qu'il faudrait tenir a
 * jour a la main — et un test qui recopie le type qu'il verifie ne verifie plus rien. `unknown`
 * obligerait a un transtypage par acces. Un index large laisse les assertions lisibles, et c'est
 * `assert` qui fait le travail de verification.
 */
type Reponse = any;

/** Le cas nomme par le §9.2 du cahier des charges. */
const ID_TIERS = 'methanisation__distance_d_implantation_aux_tiers_habitations_erp';
/** Recul eolien de 500 m : seuil reglementaire FERME et sens etabli (« ≥ 500 m »). */
const ID_RECUL = 'eolien_terrestre__eloignement_500_m_des_habitations';

const NOM = 'Profil de test — methanisation';
const SECRET = 'secret-de-test-uniquement';
let baseDisponible = false;
let app: Serveur | null = null;

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM profil_recherche WHERE nom LIKE 'Profil de test%'`);
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
  app = await construireServeur({ secretJwt: SECRET });
  await app.ready();
});

after(async () => {
  if (baseDisponible) await nettoyer();
  await app?.close();
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : profils de recherche ignores (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/**
 * En-tetes d'un role donne. Les routes de profils sont PROTEGEES : sans jeton elles rendent 401,
 * ce qui est le comportement attendu et non un detail de montage — un profil porte le cahier des
 * charges commercial d'un developpeur.
 */
function entetes(role: 'admin' | 'prospection' | 'lecture'): Record<string, string> {
  const jeton = app!.jwt.sign({
    id: `00000000-0000-0000-0000-00000000000${role === 'lecture' ? 1 : 2}`,
    email: `${role}@local`,
    nom: role,
    role,
    habiliteDonneesProprietaires: false,
  });
  return { authorization: `Bearer ${jeton}` };
}

/** Appelle une route et rend le couple statut / corps decode. */
async function appeler(
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  corps?: unknown,
  role: 'admin' | 'prospection' | 'lecture' = 'prospection',
): Promise<{ statut: number; corps: Reponse }> {
  const rep = await app!.inject({
    method: methode,
    url,
    payload: corps as object | undefined,
    headers: entetes(role),
  });
  return { statut: rep.statusCode, corps: rep.body ? JSON.parse(rep.body) : null };
}

test('LE CATALOGUE DES CONTRAINTES PARAMETRABLES DIT TOUT CE QU’IL FAUT POUR LES AFFICHER', async () => {
  if (ignorer()) return;

  const { statut, corps } = await appeler('GET', '/api/profils/contraintes?filiere=methanisation');
  assert.equal(statut, 200);
  assert.ok(Array.isArray(corps) && corps.length > 0);

  const tiers = corps.find((c: { id: string }) => c.id === ID_TIERS);
  assert.ok(tiers, 'le cas du §9.2 doit etre parametrable');

  /*
   * Le texte reglementaire est RECOPIE, jamais reformule : c'est ce que l'operateur doit pouvoir
   * citer au developpeur quand il lui explique pourquoi une parcelle est ecartee.
   */
  assert.equal(tiers.seuilReglementaire, '100 m (Déclaration) / 200 m (Enregistrement-Autorisation)');
  assert.equal(tiers.unite, 'm');
  assert.equal(tiers.sensRequis, true, 'le classeur ne dit pas si c’est un minimum ou un maximum');
  assert.equal(tiers.reglementaireEtabli, false);
  assert.deepEqual(tiers.raisons, ['extraction_incomplete']);

  // La filiere est respectee : aucune contrainte d'une autre filiere ne doit fuir dans la liste.
  for (const c of corps) assert.equal(c.filiere, 'methanisation');

  const { statut: mauvais } = await appeler('GET', '/api/profils/contraintes?filiere=inexistante');
  assert.equal(mauvais, 400);
});

test('§9.2 — UN PROFIL SE CREE, SE RELIT ET SE REJOUE A L’IDENTIQUE', async () => {
  if (ignorer()) return;

  const { statut, corps: cree } = await appeler('POST', '/api/profils', {
    nom: NOM,
    filiere: 'methanisation',
    developpeur: 'Developpeur X',
    criteres: { surfaceMinHa: 15, codeRegion: '44' },
    seuils: [
      { contrainteId: ID_TIERS, valeur: 400, sens: 'min', motif: 'Politique interne : 400 m' },
    ],
  });
  assert.equal(statut, 201, JSON.stringify(cree));
  assert.equal(cree.seuils.length, 1);
  assert.equal(cree.seuils[0].valeur, 400);
  /*
   * `valeur` doit revenir en NOMBRE. Le pilote rend les `numeric` en chaine, et une chaine qui
   * traverse jusqu'au comparateur rendrait « 1000 » plus petit que « 400 » — une comparaison
   * lexicographique, muette, et fausse precisement sur les grandes valeurs.
   */
  assert.equal(typeof cree.seuils[0].valeur, 'number');
  // L'unite vient du referentiel, pas du client : elle n'a pas ete envoyee.
  assert.equal(cree.seuils[0].unite, 'm');

  const { statut: lu, corps: relu } = await appeler('GET', `/api/profils/${cree.id}`);
  assert.equal(lu, 200);
  assert.deepEqual(relu.criteres, { surfaceMinHa: 15, codeRegion: '44' });
  assert.deepEqual(relu.seuils, cree.seuils);
  assert.deepEqual(relu.seuilsOrphelins, []);

  const { corps: liste } = await appeler('GET', '/api/profils?filiere=methanisation');
  const dansListe = liste.find((p: { id: string }) => p.id === cree.id);
  assert.ok(dansListe, 'le profil doit apparaitre dans sa filiere');
  assert.equal(dansListe.nbSeuils, 1);

  await appeler('DELETE', `/api/profils/${cree.id}`);
});

test('UN SEUIL PLUS PERMISSIF QUE LA REGLEMENTATION EST REFUSE', async () => {
  if (ignorer()) return;

  /*
   * LE REFUS LE PLUS IMPORTANT DE CE FICHIER. « ≥ 500 m » au classeur, 300 m dans le profil : la
   * recherche remonterait du foncier que l'arrete interdit, et le dossier remis au developpeur
   * porterait des parcelles inconstructibles. Le cahier des charges declare le seuil reglementaire
   * immuable — l'accepter comme borne basse sans le dire le rendrait modifiable par la fenetre.
   */
  const { statut, corps } = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — assouplissement',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 300, motif: 'trop permissif' }],
  });

  assert.equal(statut, 400, JSON.stringify(corps));
  assert.match(corps.erreur.message, /assouplit la reglementation/);
  // Le message doit CITER le texte du classeur : « c'est refuse » n'aide personne a corriger.
  assert.match(corps.erreur.message, /≥ 500 m/);

  // Le durcissement, lui, passe.
  const { statut: dur, corps: ok } = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — durcissement',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, motif: 'Marge de negociation' }],
  });
  assert.equal(dur, 201, JSON.stringify(ok));
  await appeler('DELETE', `/api/profils/${ok.id}`);
});

test('UNE CONTRAINTE INCONNUE OU D’UNE AUTRE FILIERE EST REFUSEE', async () => {
  if (ignorer()) return;

  const inconnue = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — inconnue',
    filiere: 'methanisation',
    seuils: [{ contrainteId: 'methanisation__contrainte_qui_nexiste_pas', valeur: 1, sens: 'min', motif: '' }],
  });
  assert.equal(inconnue.statut, 400);
  assert.match(inconnue.corps.erreur.message, /Contrainte inconnue/);

  /*
   * Contrainte REELLE, mais d'une autre filiere. C'est le cas le plus insidieux : le formulaire
   * parait coherent, l'identifiant existe, et le seuil serait enregistre pour ne jamais servir.
   */
  const ailleurs = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — mauvaise filiere',
    filiere: 'methanisation',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, motif: '' }],
  });
  assert.equal(ailleurs.statut, 400);
  assert.match(ailleurs.corps.erreur.message, /filiere eolien_terrestre, pas de methanisation/);
});

test('LE SENS EST EXIGE QUAND LE CLASSEUR NE LE DONNE PAS, ET REFUSE QUAND IL LE DONNE', async () => {
  if (ignorer()) return;

  // Cas §9.2 : « 100 m (Déclaration) / 200 m » ne dit pas minimum ou maximum.
  const sansSens = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — sens manquant',
    filiere: 'methanisation',
    seuils: [{ contrainteId: ID_TIERS, valeur: 400, motif: '' }],
  });
  assert.equal(sansSens.statut, 400);
  assert.match(sansSens.corps.erreur.message, /Precisez `sens`/);

  /*
   * A l'inverse, « ≥ 500 m » etablit le sens. Un `sens: 'max'` envoye quand meme est REFUSE et non
   * ignore : ignore, le client croirait son choix retenu alors que la contrainte s'appliquerait
   * dans l'autre sens — une contrainte inversee en silence.
   */
  const sensImpose = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — sens impose',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, sens: 'max', motif: '' }],
  });
  assert.equal(sensImpose.statut, 400);
  assert.match(sensImpose.corps.erreur.message, /le classeur etablit le sens/);
});

test('LE REMPLACEMENT EST INTEGRAL : UN SEUIL RETIRE DE L’ECRAN DISPARAIT VRAIMENT', async () => {
  if (ignorer()) return;

  const { corps: cree } = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — remplacement',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, motif: 'initial' }],
  });
  assert.equal(cree.seuils.length, 1);

  /*
   * POURQUOI CE TEST. Une fusion conserverait le seuil que l'operateur vient de retirer : il
   * croirait l'avoir supprime, et la recherche continuerait de l'appliquer. C'est exactement le
   * genre d'ecart entre l'ecran et le comportement que rien ne rattrape ensuite.
   */
  const { statut, corps: remplace } = await appeler('PUT', `/api/profils/${cree.id}`, {
    nom: 'Profil de test — remplacement',
    filiere: 'eolien_terrestre',
    seuils: [],
  });
  assert.equal(statut, 200);
  assert.deepEqual(remplace.seuils, []);

  const { corps: relu } = await appeler('GET', `/api/profils/${cree.id}`);
  assert.deepEqual(relu.seuils, [], 'le seuil retire doit avoir disparu de la base');

  await appeler('DELETE', `/api/profils/${cree.id}`);
});

test('UN NOM DEJA PRIS REND 409, ET NON UN DOUBLON', async () => {
  if (ignorer()) return;

  const premier = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — unicite',
    filiere: 'bess',
    seuils: [],
  });
  assert.equal(premier.statut, 201);

  /*
   * La casse ne doit pas suffire a creer un doublon : le nom est la SEULE chose que l'operateur
   * lit dans la liste, et deux entrees « Profil X » / « profil x » cote a cote le feraient
   * lancer une recherche sur les criteres d'un autre developpeur sans s'en apercevoir.
   */
  const second = await appeler('POST', '/api/profils', {
    nom: 'PROFIL DE TEST — UNICITE',
    filiere: 'bess',
    seuils: [],
  });
  assert.equal(second.statut, 409, JSON.stringify(second.corps));
  assert.match(second.corps.erreur.message, /existe deja/);

  await appeler('DELETE', `/api/profils/${premier.corps.id}`);
});

test('UN CHAMP INCONNU EST REFUSE, DANS LE PROFIL COMME DANS UN SEUIL', async () => {
  if (ignorer()) return;

  const profil = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — champ inconnu',
    filiere: 'bess',
    seuilsDeveloppeurs: [],
  });
  assert.equal(profil.statut, 400);
  assert.match(profil.corps.erreur.message, /inconnu/);

  /*
   * Et dans un seuil : `unite` est volontairement REFUSEE. Laisser le client l'envoyer ouvrirait
   * la porte a « 400 » en km la ou la contrainte se mesure en metres — un facteur mille accepte
   * sans bruit, qui viderait ou remplirait la recherche selon le sens.
   */
  const seuil = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — unite envoyee',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, unite: 'km', motif: '' }],
  });
  assert.equal(seuil.statut, 400);
  assert.match(seuil.corps.erreur.message, /inconnu/);
});

test('LA SUPPRESSION D’UN PROFIL EMPORTE SES SEUILS', async () => {
  if (ignorer()) return;

  const { corps: cree } = await appeler('POST', '/api/profils', {
    nom: 'Profil de test — cascade',
    filiere: 'eolien_terrestre',
    seuils: [{ contrainteId: ID_RECUL, valeur: 700, motif: 'x' }],
  });

  const { statut } = await appeler('DELETE', `/api/profils/${cree.id}`);
  assert.equal(statut, 204);

  // Des seuils orphelins survivraient a leur profil sans qu'aucune vue ne les montre.
  const restants = await requete(`SELECT 1 FROM seuil_developpeur WHERE profil_id = $1`, [cree.id]);
  assert.equal(restants.length, 0);

  const apres = await appeler('GET', `/api/profils/${cree.id}`);
  assert.equal(apres.statut, 404);
  // Et une seconde suppression ne doit pas pretendre avoir supprime quelque chose.
  const rejeu = await appeler('DELETE', `/api/profils/${cree.id}`);
  assert.equal(rejeu.statut, 404);
});

test('UN IDENTIFIANT MAL FORME NE DESCEND PAS JUSQU’A LA BASE', async () => {
  if (ignorer()) return;

  /*
   * Sans ce controle, `uuid = 'pas-un-uuid'` leve une erreur PostgreSQL de syntaxe et la route
   * rend 500 : une faute de saisie signalee comme une panne serveur, qui reveille une astreinte.
   */
  for (const methode of ['GET', 'DELETE'] as const) {
    const { statut } = await appeler(methode, '/api/profils/pas-un-uuid');
    assert.equal(statut, 400, `${methode} /api/profils/pas-un-uuid`);
  }
});

test('LE DEPOT REFUSE UN PROFIL A MOITIE ECRIT', async () => {
  if (ignorer()) return;

  /*
   * Un profil cree avec la moitie de ses seuils est PIRE qu'un echec : l'operateur le rouvre, voit
   * ses criteres, lance la recherche — et obtient un resultat plus large que le cahier des charges
   * du developpeur, sans qu'aucun message ne le signale. On provoque donc un echec d'insertion au
   * deuxieme seuil, en passant par le depot pour court-circuiter la validation de la route.
   */
  await assert.rejects(
    depot.creerProfil(
      {
        nom: 'Profil de test — transaction',
        filiere: 'eolien_terrestre',
        developpeur: null,
        criteres: {},
        notes: null,
        seuils: [
          { contrainteId: ID_RECUL, valeur: 700, unite: 'm', sens: null, motif: 'bon' },
          // `sens` hors de la contrainte CHECK : la base refuse la ligne.
          { contrainteId: ID_TIERS, valeur: 400, unite: 'm', sens: 'oblique' as never, motif: 'mauvais' },
        ],
      },
      'test',
    ),
  );

  const restants = await requete(
    `SELECT 1 FROM profil_recherche WHERE nom = 'Profil de test — transaction'`,
  );
  assert.equal(restants.length, 0, 'aucun profil ne doit subsister apres un echec partiel');
});
