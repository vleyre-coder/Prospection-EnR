/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES DEUX COURRIERS — ce qu'ils disent, et surtout ce qu'ils n'inventent pas
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE JOUE ICI. Ces courriers partent sur papier a en-tete et engagent l'entreprise qui les
 * signe. Deux fautes seraient graves, et aucune ne se verrait a la relecture d'un ecran :
 *
 *   1. une DESIGNATION CADASTRALE fausse. C'est la seule partie du courrier qui doit etre exacte
 *      a coup sur : un service de la publicite fonciere saisi sur la mauvaise parcelle repond sur
 *      la mauvaise parcelle, et le proprietaire contacte a tort ne l'oublie pas ;
 *   2. un FONDEMENT JURIDIQUE INVENTE. Le depot n'en tient aucune source sure — il ecrit seulement
 *      que la donnee « s'obtient apres demande documentee ». Un generateur qui citerait un article
 *      precis ferait signer a l'operateur une affirmation que personne n'a verifiee.
 *
 * Et une troisieme, purement technique mais qui gache le courrier : un `.eml` mal encode s'ouvre
 * en mojibake. Le corps est en francais accentue a chaque ligne.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construireCourrier,
  courrierProprietaire,
  courrierSdif,
  versEml,
} from '../src/services/courriers.js';
import type { ParcelleEnBase } from '../src/depots/parcelles.js';

/** Parcelle d'essai, avec des valeurs distinctes pour que toute confusion se voie. */
const PARCELLE = {
  idu: '28399000ZC0123',
  codeInsee: '28399',
  nomCommune: 'Tillay-le-Péneux',
  codeDepartement: '28',
  prefixe: '000',
  section: 'ZC',
  numero: '0123',
  contenanceM2: 125000,
  surfaceCalculeeM2: 124800,
  geometrie: null,
  centroide: [1.75, 48.15],
  dateRecuperation: '2026-09-01T00:00:00.000Z',
} as unknown as ParcelleEnBase;

test('LA DESIGNATION CADASTRALE EST EXACTE, ET COMPLETE', () => {
  /*
   * La seule partie du courrier qui ne doit JAMAIS etre approximative. Un service saisi sur la
   * mauvaise parcelle repond sur la mauvaise parcelle.
   */
  for (const courrier of [courrierSdif(PARCELLE), courrierProprietaire(PARCELLE)]) {
    assert.match(courrier.corps, /Tillay-le-Péneux/, 'la commune doit etre nommee');
    assert.match(courrier.corps, /INSEE 28399/, 'le code INSEE leve l’ambiguite entre homonymes');
    assert.match(courrier.corps, /section ZC/);
    assert.match(courrier.corps, /numéro 0123/);
    assert.match(courrier.corps, /28399000ZC0123/, 'l’IDU doit figurer : c’est la reference sure');
    // 124 800 m2 = 12,48 ha, en notation francaise.
    assert.match(courrier.corps, /12,48 ha/, 'la contenance doit etre juste et en français');
  }
});

test('AUCUN FONDEMENT JURIDIQUE N’EST INVENTE', () => {
  /*
   * LE REFUS LE PLUS IMPORTANT DE CE MODULE. Le depot ecrit, dans le connecteur cadastre, que
   * l'identite d'un proprietaire « s'obtient apres demande documentee aupres de la DGFiP ou de la
   * mairie ». Il n'en dit pas plus, et pour cause : la procedure varie selon le service saisi, le
   * motif et le departement.
   *
   * Faire citer au courrier un article precis serait inventer un fondement que personne n'a
   * verifie, sur un document qui part sur papier a en-tete. Le courrier laisse donc un espace
   * NOMME, et le signale dans `aCompleter`.
   */
  const c = courrierSdif(PARCELLE);
  assert.doesNotMatch(
    c.corps,
    /article\s+[LRD]\.?\s*\d/i,
    'aucun article de loi ne doit etre cite : le depot n’en tient aucune source sure',
  );
  assert.match(c.corps, /Fondement de la demande\s*:/, 'la place du fondement est prevue');
  assert.ok(
    c.aCompleter.some((x) => /fondement/i.test(x)),
    'et il est signale comme restant a completer',
  );
});

test('LE COURRIER AU PROPRIETAIRE N’AVANCE NI MONTANT NI PUISSANCE', () => {
  /*
   * Un courrier qui annoncerait « environ 3 000 € par hectare et par an » engagerait l'expediteur
   * sur un montant que personne n'a valide. Ce sont des elements de negociation, fixes par le
   * developpeur, et un generateur n'a pas a les suggerer.
   */
  const c = courrierProprietaire(PARCELLE, { projet: 'photovoltaïque au sol' });
  assert.doesNotMatch(c.corps, /€|euros?\b/i, 'aucun montant');
  assert.doesNotMatch(c.corps, /\bMW\b|mégawatts?/i, 'aucune puissance');
  assert.doesNotMatch(c.corps, /loyer|redevance|indemnit/i, 'aucune promesse financiere');

  // Et il dit ce qu'il est : une etude prealable qui n'engage personne.
  assert.match(c.corps, /aucune décision n’est prise/);
  assert.match(c.corps, /rien ne vous engage/);
});

test('LES TROUS SONT VISIBLES, ET NOMMES', () => {
  /*
   * Un courrier qui part avec « [ADRESSE DU SERVICE] » dans le corps est une faute visible par le
   * destinataire. Le generateur doit donc les signaler — les trous se decouvrent sinon a la
   * relecture, ou pas du tout.
   */
  const c = courrierSdif(PARCELLE);
  assert.ok(c.aCompleter.length > 0, 'un courrier vierge a forcement des trous');
  // Chaque trou du corps est en majuscules entre crochets : impossible a manquer.
  const trous = c.corps.match(/\[[^\]]+\]/g) ?? [];
  assert.ok(trous.length > 0, 'les trous doivent etre marques dans le corps');
  for (const t of trous) {
    assert.equal(t, t.toUpperCase(), `le trou ${t} doit etre en majuscules`);
  }

  // Et un courrier complet n'en laisse plus sur les champs fournis.
  const rempli = courrierSdif(PARCELLE, {
    expediteur: 'Dimeo Énergie',
    signataire: 'Jean Dupont',
    qualite: 'chargé de développement foncier',
    coordonnees: '02 37 00 00 00 — contact@example.fr',
    projet: 'photovoltaïque au sol',
  });
  assert.match(rempli.corps, /Dimeo Énergie/);
  assert.match(rempli.corps, /chargé de développement foncier/);
  assert.ok(
    !rempli.aCompleter.some((x) => /signataire|expéditeur|projet/i.test(x)),
    `il reste des trous couverts par la saisie : ${rempli.aCompleter.join(', ')}`,
  );
});

test('LE .EML S’OUVRE ET SE DECODE SANS MOJIBAKE', () => {
  /*
   * Le corps est en francais accentue a chaque ligne. Un `.eml` en 8 bits brut s'affiche casse
   * dans plusieurs clients, et un en-tete `Subject:` accentue ecrit tel quel l'est toujours.
   * Les deux ont leur propre encodage, et ce n'est pas le meme.
   */
  const courrier = courrierProprietaire(PARCELLE, {
    destinataire: 'Monsieur Éloi Lefèvre',
    projet: 'photovoltaïque au sol',
  });
  const eml = versEml(courrier, 'Monsieur Éloi Lefèvre');

  assert.match(eml, /^MIME-Version: 1\.0\r\n/, 'un .eml commence par ses en-tetes');
  assert.match(eml, /Content-Transfer-Encoding: quoted-printable/);
  assert.match(eml, /charset=UTF-8/);
  // En-tete accentue : encode en RFC 2047, jamais brut.
  assert.match(eml, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.match(eml, /To: =\?UTF-8\?B\?/);

  /*
   * LA VERIFICATION QUI COMPTE : on DECODE, et on retrouve le texte d'origine. Verifier la
   * presence des en-tetes ne prouve rien sur le corps — c'est justement la que le mojibake se
   * loge.
   */
  const corpsEncode = eml.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  const decode = decoderQuotedPrintable(corpsEncode);
  assert.match(decode, /Tillay-le-Péneux/, 'les accents doivent survivre a l’aller-retour');
  assert.match(decode, /photovoltaïque au sol/);
  assert.match(decode, /Monsieur Éloi Lefèvre/);

  /*
   * Et l'objet se decode aussi — EN ENTIER. Un en-tete trop long se replie en plusieurs mots
   * encodes ; ne lire que le premier donnait un objet tronque a la premiere tranche, et le test
   * l'aurait accepte s'il s'etait contente de verifier que « ca se decode ».
   */
  assert.equal(objetDuMessage(eml), courrier.objet);
  assert.equal(enTeteDecodee(eml, 'To'), 'Monsieur Éloi Lefèvre');
});

test('UN EN-TETE ACCENTUE SE REPLIE SANS DEPASSER 76 CARACTERES', () => {
  /*
   * LE PIEGE QUI A SURVECU A UNE PREMIERE CORRECTION. Replier un en-tete ne suffit pas : encore
   * faut-il compter le budget en OCTETS, et y retrancher le prefixe de la ligne.
   *
   * Une tranche de 24 caracteres tous accentues fait 48 octets, donc 64 caracteres de base64,
   * donc 76 avec l'habillage `=?UTF-8?B?...?=` — et 85 une fois « Subject: » devant. Le repli
   * existait bel et bien, et la ligne depassait quand meme.
   */
  const nom = 'Mesdames Éloïse Frédérique Lefèvre-Château née Rouëssé et Amélie Désirée Vaÿssière';
  const eml = versEml(courrierProprietaire(PARCELLE, { destinataire: nom }), nom);

  for (const ligne of eml.split('\r\n')) {
    assert.ok(ligne.length <= 76, `en-tete de ${ligne.length} caracteres : « ${ligne} »`);
  }
  // Le repli a bien eu lieu, et le nom se reconstitue sans perdre un seul caractere.
  assert.ok(/To: =\?UTF-8\?B\?[^?]+\?=\r\n =\?UTF-8\?B\?/.test(eml), 'l’en-tête doit être replié');
  assert.equal(enTeteDecodee(eml, 'To'), nom);
});

test('AUCUNE LIGNE DU .EML NE DEPASSE LA LONGUEUR ADMISE', () => {
  /*
   * `quoted-printable` plafonne les lignes a 76 caracteres. Au-dela, des passerelles tronquent —
   * et la coupe ne doit JAMAIS tomber au milieu d'une sequence `=XX`, sinon l'octet se perd et le
   * texte se decode de travers a partir de la.
   */
  const long = courrierProprietaire(PARCELLE, {
    destinataire: 'Monsieur Éloi Lefèvre',
    adresse: 'Lieu-dit la Grande Métairie, route de Châteaudun, 28399 Tillay-le-Péneux',
    projet: 'photovoltaïque au sol avec préservation des continuités écologiques du secteur',
  });
  const eml = versEml(long, 'Monsieur Éloi Lefèvre');

  for (const ligne of eml.split('\r\n')) {
    assert.ok(ligne.length <= 76, `ligne de ${ligne.length} caracteres : « ${ligne.slice(0, 40)}… »`);
    // Une coupe au milieu d'une sequence laisserait un `=` suivi de moins de deux hexadecimaux.
    assert.doesNotMatch(ligne, /=[0-9A-F]$/, `coupe au milieu d’une sequence : « ${ligne.slice(-12)} »`);
  }

  // Et le tout se decode encore, ce qui est la vraie preuve que le repliage est correct.
  const corps = eml.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  assert.match(decoderQuotedPrintable(corps), /Grande Métairie/);
});

test('LES DEUX TYPES SE CONSTRUISENT PAR LEUR NOM', () => {
  assert.equal(construireCourrier('sdif', PARCELLE).objet, courrierSdif(PARCELLE).objet);
  assert.equal(
    construireCourrier('proprietaire', PARCELLE).objet,
    courrierProprietaire(PARCELLE).objet,
  );
  // Les deux objets sont DIFFERENTS : un seul objet pour deux courriers serait une confusion.
  assert.notEqual(courrierSdif(PARCELLE).objet, courrierProprietaire(PARCELLE).objet);
});

/**
 * Lit un en-tete replie et en decode tous les mots RFC 2047.
 *
 * Le repli d'en-tete est un CRLF suivi d'une espace ou d'une tabulation : la valeur continue sur
 * la ligne suivante. S'arreter au premier CRLF, c'est lire une valeur tronquee.
 */
function enTeteDecodee(eml: string, nom: string): string {
  const brut = new RegExp(`^${nom}: ((?:.*)(?:\\r\\n[ \\t].*)*)`, 'm').exec(eml)?.[1] ?? '';
  const mots = [...brut.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)];
  if (mots.length === 0) return brut;
  return mots.map((m) => Buffer.from(m[1]!, 'base64').toString('utf8')).join('');
}

const objetDuMessage = (eml: string): string => enTeteDecodee(eml, 'Subject');

/** Decodeur `quoted-printable` minimal, ecrit ici pour ne rien devoir au code teste. */
function decoderQuotedPrintable(texte: string): string {
  const sansRepli = texte.replace(/=\r\n/g, '');
  const octets: number[] = [];
  for (let i = 0; i < sansRepli.length; i += 1) {
    const c = sansRepli[i]!;
    if (c === '=' && /^[0-9A-F]{2}$/.test(sansRepli.slice(i + 1, i + 3))) {
      octets.push(parseInt(sansRepli.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      octets.push(c.charCodeAt(0));
    }
  }
  return Buffer.from(octets).toString('utf8');
}
