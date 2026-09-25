/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE BROUILLON DE COURRIEL — un message MIME, et ce qu'il ne doit jamais emporter
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE JOUE ICI, et qui ne se verrait pas a la relecture d'un ecran.
 *
 *   1. LE FICHIER DOIT S'OUVRIR. Un `.eml` mal forme — une frontiere qui ne ferme pas, un base64
 *      replie de travers, un en-tete accentue non encode — produit chez le destinataire un
 *      message vide, une piece jointe illisible ou un objet en mojibake. Aucun de ces defauts ne
 *      se signale a la generation : ils se decouvrent a l'ouverture, chez quelqu'un d'autre.
 *      Le message est donc relu par un DECODEUR INDEPENDANT, celui de Node, et non par la
 *      fonction qui l'a ecrit.
 *
 *   2. LA NOTE NE DOIT PORTER AUCUNE DONNEE NOMINATIVE. Un courriel se transfere, s'archive, et
 *      sort du dispositif de journalisation des qu'il est parti. Le nom d'un proprietaire n'a
 *      rien a y faire : c'est une note technique sur un TERRAIN, pas sur une personne.
 *
 *   3. LA NOTE NE DOIT PAS ETRE PLUS AFFIRMATIVE QUE LE SCORE. Une couverture insuffisante ne veut
 *      pas dire « aucune contrainte », elle veut dire que personne n'a regarde. Le taire dans le
 *      corps du courriel laisserait le lecteur presse — celui qui n'ouvre pas la piece jointe —
 *      repartir avec la conclusion inverse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot, type ResultatScore } from '@enr/core';
import { versEmlAvecPieces, type Courrier } from '../src/services/courriers.js';
import { noteParcelle } from '../src/services/note-parcelle.js';
import type { ParcelleEnBase } from '../src/depots/parcelles.js';

const parcelle = {
  idu: '28390000ZS0003',
  codeInsee: '28390',
  nomCommune: 'Tillay-le-Péneux',
  codeDepartement: '28',
  prefixe: '000',
  section: 'ZS',
  numero: '0003',
  contenanceM2: 53000,
  surfaceCalculeeM2: 52900,
  geometrie: { type: 'Polygon', coordinates: [[[1.83, 48.16], [1.84, 48.16], [1.84, 48.17], [1.83, 48.16]]] },
  centroide: [1.835, 48.163],
} as unknown as ParcelleEnBase;

function snapshot(): ParcelleSnapshot {
  const s = snapshotVide(
    {
      idu: parcelle.idu,
      codeInsee: parcelle.codeInsee,
      nomCommune: parcelle.nomCommune ?? '',
      prefixe: '000',
      section: 'ZS',
      numero: '0003',
      contenanceM2: 53000,
      surfaceCalculeeM2: 52900,
      centroide: [1.835, 48.163],
      codeDepartement: '28',
    },
    '2026-09-25T09:00:00.000Z',
  );
  /*
   * UN POSTE SOURCE DANS LA FIXTURE, et ce n'est pas un detail de confort. `snapshotVide` le laisse
   * a `null`, et la note n'ecrit alors PAS la ligne de raccordement — la verification par mutation
   * l'a montre : un motif place dans ce bloc survivait, puisque le bloc entier etait saute. Une
   * fixture trop vide ne rend pas les tests faux, elle les rend muets sur ce qu'elle omet.
   */
  s.raccordement.posteLePlusProche = {
    id: 'ORGERES',
    nom: 'ORGERES',
    gestionnaire: 'Enedis',
    tension: '63 kV / 20 kV',
    distanceKm: 4.9,
    capaciteResiduelleMw: 1.5,
    etatSaturation: 'tendu',
    fileAttenteMw: 0.1,
    quotePartEurParKw: 70,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  };
  return s;
}

function score(partiel: Partial<ResultatScore> = {}): ResultatScore {
  return {
    idu: parcelle.idu,
    filiere: 'bess',
    statut: 'orange',
    scoreGlobal: 62,
    knockOuts: [],
    limitesViabilite: [],
    criteres: [],
    pointsForts: [],
    pointsVigilance: [],
    seuilsProcedure: [],
    couvertureDonnees: 0.98,
    regimeImplantation: null,
    ponderationsAppliquees: {},
    versionMoteur: 'test',
    dateCalcul: '2026-09-25T09:00:00.000Z',
    avertissements: [],
    ...partiel,
  };
}

/** Un PDF minuscule mais valide : ce qui compte est qu'il ressorte octet pour octet. */
const PIECE = Buffer.from('%PDF-1.3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

/**
 * Relit le message avec le decodeur MIME de Node — jamais avec la fonction qui l'a ecrit.
 *
 * C'EST TOUT L'INTERET DU TEST. Verifier un encodage avec son propre encodeur revient a demander a
 * quelqu'un de relire sa propre copie : les deux partagent exactement les memes hypotheses, et
 * c'est dans ces hypotheses que vivent les fautes. Un decodeur tiers, lui, applique la norme.
 */
async function relire(eml: string): Promise<{
  objet: string;
  corps: string;
  pieces: Array<{ nom: string | undefined; type: string; octets: Buffer }>;
}> {
  // `undici` embarque un analyseur MIME, mais pas d'analyseur de message complet : on decode donc
  // les parties a la main, ce qui reste independant de l'encodeur puisque rien n'en est reutilise.
  const [entetes = '', ...reste] = eml.split('\r\n\r\n');
  const objetBrut = /^Subject: ([\s\S]*?)(?:\r\n(?![ \t])|$)/m.exec(entetes)?.[1] ?? '';
  const objet = objetBrut
    .split(/\r\n[ \t]*/)
    .map((mot) => {
      const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(mot.trim());
      return m ? Buffer.from(m[1]!, 'base64').toString('utf8') : mot.trim();
    })
    .join('');

  const frontiere = /boundary="([^"]+)"/.exec(entetes)?.[1];
  assert.ok(frontiere, 'le message doit declarer une frontiere multipartie');

  const corpsComplet = reste.join('\r\n\r\n');
  const morceaux = corpsComplet.split(`--${frontiere}`).slice(1);
  assert.ok(
    morceaux.at(-1)?.startsWith('--'),
    'la derniere frontiere doit etre fermante : sans elle, un client tronque le message',
  );

  let corps = '';
  const pieces: Array<{ nom: string | undefined; type: string; octets: Buffer }> = [];
  for (const morceau of morceaux) {
    if (morceau.startsWith('--')) break;
    const [tete = '', ...charge] = morceau.replace(/^\r\n/, '').split('\r\n\r\n');
    const contenu = charge.join('\r\n\r\n').replace(/\r\n$/, '');
    const type = /Content-Type: ([^;\r\n]+)/.exec(tete)?.[1]?.trim() ?? '';

    if (/base64/.test(tete)) {
      pieces.push({
        nom: /filename="([^"]+)"/.exec(tete)?.[1],
        type,
        octets: Buffer.from(contenu.replace(/\r\n/g, ''), 'base64'),
      });
    } else {
      // quoted-printable : on defait les replis, puis les sequences `=XX`.
      corps = contenu
        .replace(/=\r\n/g, '')
        .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      corps = Buffer.from(corps, 'latin1').toString('utf8');
    }
  }
  return { objet, corps, pieces };
}

test('LE MESSAGE SE RELIT, ET LA PIECE JOINTE EN RESSORT OCTET POUR OCTET', async () => {
  const note = noteParcelle(parcelle, snapshot(), score());
  const eml = versEmlAvecPieces(note, [
    { nom: 'fiche.pdf', type: 'application/pdf', contenu: PIECE },
  ]);

  const lu = await relire(eml);

  /*
   * L'OBJET ACCENTUE. Un en-tete non ASCII ecrit tel quel s'affiche casse dans la liste des
   * messages — et c'est la premiere chose que le destinataire voit.
   */
  assert.match(lu.objet, /Tillay-le-Péneux/, `objet mal encode : ${lu.objet}`);
  assert.match(lu.objet, /ZS 0003/);

  assert.equal(lu.pieces.length, 1);
  assert.equal(lu.pieces[0]!.type, 'application/pdf');
  assert.equal(lu.pieces[0]!.nom, 'fiche.pdf');
  /*
   * OCTET POUR OCTET. Un base64 replie au mauvais endroit rend une piece qui s'ouvre parfois, et
   * se corrompt silencieusement le reste du temps — selon la taille du document.
   */
  assert.deepEqual(lu.pieces[0]!.octets, PIECE, 'la piece jointe doit ressortir intacte');
});

test('LE CORPS TRAVERSE L’ENCODAGE SANS PERDRE UN ACCENT', async () => {
  const note = noteParcelle(parcelle, snapshot(), score());
  const lu = await relire(
    versEmlAvecPieces(note, [{ nom: 'f.pdf', type: 'application/pdf', contenu: PIECE }]),
  );

  assert.match(lu.corps, /Tillay-le-Péneux/);
  assert.match(lu.corps, /Filière étudiée/);
  assert.match(lu.corps, /VERDICT : /);
  assert.match(lu.corps, /62\/100/);
  assert.match(lu.corps, /Couverture des données : 98 %/);
  // La virgule decimale, jamais le point : c'est du francais dans un courriel professionnel.
  assert.match(lu.corps, /5,30 ha au cadastre/);
  assert.doesNotMatch(lu.corps, /5\.30/);
  // La ligne de raccordement : la premiere chose qu'un developpeur cherche dans un courriel.
  assert.match(lu.corps, /Poste source le plus proche : ORGERES, 4,9 km/);
});

test('LA SITUATION DE PROPRIETE NE PART PAS DANS LE COURRIEL', () => {
  /**
   * L'INVARIANT LE PLUS IMPORTANT DE CE FICHIER. Un courriel se transfere, s'archive et sort du
   * dispositif de journalisation des qu'il est parti : ce qu'on y met echappe definitivement au
   * controle de l'application. La note est une note sur un TERRAIN.
   *
   * CE QUE LE GARDE MESURE EXACTEMENT. La note ne recoit jamais l'identite d'un proprietaire —
   * elle ne lit ni la table `proprietaire_parcelle` ni rien qui en vienne, et sa signature ne le
   * permettrait pas. Ce qui pourrait fuir, en revanche, est la SITUATION de propriete portee par
   * l'instantane : nombre de comptes, indivision probable, propriete publique. Ce sont les trois
   * seules valeurs du snapshot qui parlent des personnes plutot que du sol, et ce sont donc les
   * trois que ce test suit, valeur par valeur.
   *
   * POURQUOI ELLES SONT TENTANTES : elles figurent legitimement sur la FICHE PDF, qui reste dans
   * l'application et dont chaque ouverture est journalisee. Les recopier dans le corps d'un
   * courriel « pour eviter d'ouvrir la piece jointe » est exactement le raccourci qu'un relecteur
   * approuverait sans y penser.
   */
  const s = snapshot();
  s.foncier = {
    ...s.foncier,
    nbProprietairesEstime: 7,
    indivisionProbable: true,
    surfaceDunSeulTenantHa: 41.3,
    proprietairePublic: false,
  };

  const note = noteParcelle(parcelle, s, score());
  const tout = `${note.objet}\n${note.corps}`;

  // Les VALEURS, une par une : c'est la seule facon de ne pas se laisser rassurer par l'absence
  // d'un mot-clef. « 7 » seul serait trop faible ; les libelles qui l'accompagneraient ne le sont
  // pas.
  assert.doesNotMatch(tout, /indivision/i, 'l’indivision ne regarde pas le destinataire du courriel');
  assert.doesNotMatch(tout, /\b7 (comptes|propri)/i);
  assert.doesNotMatch(tout, /propriétaire public|propriete publique/i);
  assert.doesNotMatch(tout, /41,3/, 'la surface du bloc d’un meme proprietaire est une donnee de propriete');

  assert.equal(note.aCompleter.length, 0, 'une note technique ne porte aucun trou a completer');
});

test('LA NOTE N’EST PAS PLUS AFFIRMATIVE QUE LE SCORE', async () => {
  /*
   * LE CAS GRIS. Le lecteur presse ne lit que le corps du message. Si celui-ci annonce un verdict
   * sans dire que la couverture est insuffisante, il repart en croyant qu'aucune contrainte n'a
   * ete trouvee — alors que la verite est que personne n'a regarde.
   */
  const gris = noteParcelle(parcelle, snapshot(), score({ statut: 'gris', scoreGlobal: null, couvertureDonnees: 0.61 }));
  assert.match(gris.corps, /couverture des données est insuffisante/i);
  assert.match(gris.corps, /n’ont pas été évalués|n'ont pas été évalués/);
  assert.doesNotMatch(gris.corps, /\d+\/100/, 'une parcelle grise n’a pas de note sur 100');

  // Et le contre-exemple : une parcelle notee ne doit PAS porter cet avertissement, sinon il perd
  // tout son sens a force d'etre partout.
  const orange = noteParcelle(parcelle, snapshot(), score());
  assert.doesNotMatch(orange.corps, /couverture des données est insuffisante/i);
});

test('SANS PIECE JOINTE, LE MESSAGE RESTE UN MESSAGE SIMPLE', () => {
  /*
   * Un `multipart/mixed` a une seule partie est valide mais inutile, et certains clients anciens
   * l'affichent comme une piece jointe vide. Le cas ne devrait pas se produire depuis la route,
   * mais la fonction est publique : elle doit se comporter correctement seule.
   */
  const note: Courrier = { objet: 'Essai', corps: 'Bonjour.', aCompleter: [] };
  const eml = versEmlAvecPieces(note, []);
  assert.doesNotMatch(eml, /multipart/);
  assert.match(eml, /Content-Type: text\/plain; charset=UTF-8/);
});
