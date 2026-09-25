/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES DEUX COURRIERS DE LA PROSPECTION — demande d'identite, et premier contact
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CES DEUX-LA, ET DANS CET ORDRE. Le depot dit deja, dans le connecteur cadastre, que
 * l'identite d'un proprietaire « s'obtient apres demande documentee aupres de la DGFiP ou de la
 * mairie » — aucune API publique ne l'expose legalement. La prospection enchaine donc deux
 * courriers, et ils ne s'adressent pas au meme destinataire :
 *
 *   1. le SERVICE DE LA PUBLICITE FONCIERE (ou la mairie), pour obtenir l'identite du proprietaire
 *      d'une parcelle designee. Ce courrier ne contient AUCUNE donnee personnelle : c'est celui
 *      qu'on envoie precisement parce qu'on ne les a pas ;
 *   2. le PROPRIETAIRE ou l'EXPLOITANT, une fois son identite connue, pour un premier contact.
 *
 * CE QUE CE MODULE REFUSE DE FAIRE, ET C'EST L'ESSENTIEL. Il n'invente aucun fondement juridique.
 * Rediger a la place de l'operateur un courrier qui CITE un article de loi que personne n'a
 * verifie serait la pire sortie possible : le courrier part sur papier a en-tete, engage
 * l'entreprise, et l'erreur se decouvre en face. Les references que le depot ne tient pas de
 * source sure sont donc des ESPACES A COMPLETER, visibles comme tels — pas des affirmations.
 *
 * Ce qui est rempli automatiquement, en revanche, l'est exactement : la designation cadastrale
 * (commune, section, numero, contenance) vient du cadastre, et c'est la seule chose qu'un courrier
 * de ce type doit absolument ne pas se tromper.
 */

import { randomBytes } from 'node:crypto';
import type { ParcelleEnBase } from '../depots/parcelles.js';

/** Les deux courriers que la prospection sait preparer. */
export const TYPES_COURRIER = ['sdif', 'proprietaire'] as const;
export type TypeCourrier = (typeof TYPES_COURRIER)[number];

/**
 * Ce que l'operateur fournit, et que le modele ne peut pas deviner.
 *
 * TOUT EST FACULTATIF, et c'est deliberé : un courrier a moitie rempli, avec ses trous visibles,
 * est utilisable — l'operateur complete dans son traitement de texte. Un courrier refuse parce
 * qu'il manque une ligne d'adresse ne l'est pas.
 */
export interface ContexteCourrier {

  /** Nom de la personne qui signe. */

  /** Coordonnees de rappel : telephone, courriel. */
  /** Nom du projet ou du developpeur, quand l'operateur travaille pour un tiers. */
  projet?: string | null;
  /**
   * Destinataire, saisi librement par l'operateur.
   *
   * REGIME RGPD RETENU POUR CE CHAMP : saisie libre et persistee, sans barriere d'habilitation —
   * c'est l'arbitrage du proprietaire du projet. Deux choses restent non negociables et ne
   * dependent pas de cet arbitrage : ce nom n'entre JAMAIS dans une tuile cartographique ni dans
   * un export qu'on n'a pas demande, et la preparation d'un courrier qui le porte est journalisee.
   */
  destinataire?: string | null;
  /** Adresse postale du destinataire, saisie librement. */
  adresse?: string | null;
}

export interface Courrier {
  objet: string;
  corps: string;
  /**
   * Ce qui reste a completer, nomme.
   *
   * SANS CETTE LISTE, LES TROUS SE DECOUVRENT A LA RELECTURE — ou pas du tout. Un courrier qui
   * part avec « [ADRESSE DU SERVICE] » dans le corps est une faute professionnelle visible par le
   * destinataire, et c'est exactement le genre de chose qu'un generateur doit signaler plutot que
   * de laisser passer.
   */
  aCompleter: string[];
}

/** Marque un espace a completer, de facon impossible a manquer a la relecture. */
function trou(quoi: string): string {
  return `[${quoi.toUpperCase()}]`;
}

/** Designation cadastrale complete. C'est la seule partie qui ne doit jamais etre approximative. */
function designation(p: ParcelleEnBase): string {
  /*
   * PARENTHESES INDISPENSABLES, et leur absence a coute la contenance entiere.
   *
   * `a ?? b == null ? x : y` se lit `(a ?? (b == null)) ? x : y` : avec une surface renseignee, la
   * condition valait `124800`, donc vrai, donc `null`. La contenance ne s'imprimait JAMAIS — et
   * rien ne le signalait, puisqu'une designation sans contenance reste une phrase correcte.
   */
  const surface = p.surfaceCalculeeM2 ?? p.contenanceM2;
  const ha = surface == null ? null : (surface / 10000).toFixed(2).replace('.', ',');
  return (
    `commune de ${p.nomCommune ?? p.codeInsee} (INSEE ${p.codeInsee}), ` +
    `section ${p.section}, numéro ${p.numero}` +
    (p.prefixe && p.prefixe !== '000' ? `, préfixe ${p.prefixe}` : '') +
    (ha ? `, d’une contenance d’environ ${ha} ha` : '') +
    ` — identifiant parcellaire ${p.idu}`
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * NI EN-TETE NI BLOC DE SIGNATURE — le client de messagerie s'en charge
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE RETIRE, et pourquoi. Ces courriers portaient une raison sociale en tete et un bloc
 * signataire / qualite / coordonnees en pied, saisis dans l'interface et memorises sur le poste.
 * Quatre champs a remplir avant d'obtenir la moindre ligne, et quatre trous a combler quand ils
 * restaient vides.
 *
 * Or ces courriers partent par la messagerie professionnelle de l'operateur, qui pose deja
 * l'expediteur dans l'en-tete du message et la signature dans le corps. Les redemander revenait a
 * faire saisir deux fois la meme chose, et a produire un document qui, colle dans un courriel,
 * affichait la signature EN DOUBLE.
 *
 * CE QUI RESTE : la nature du projet, qui n'est pas une donnee de l'expediteur mais du PROJET, et
 * sans laquelle le corps du courrier ne peut rien dire — « l'étude d'un projet … » resterait un
 * trou au milieu de la premiere phrase.
 */
/**
 * Courrier 1 — DEMANDE D'IDENTITE DU PROPRIETAIRE.
 *
 * Il ne porte aucune donnee personnelle, par construction : son objet meme est d'en obtenir.
 *
 * LA REFERENCE JURIDIQUE EST UN TROU, ET C'EST VOLONTAIRE. La procedure d'obtention des donnees
 * de propriete varie selon le service saisi (service de la publicite fonciere, mairie), le motif
 * invoque et le departement. Le depot n'en tient aucune source sure — il ecrit seulement, dans le
 * connecteur cadastre, que la donnee « s'obtient apres demande documentee ». Faire citer au
 * courrier un article precis serait inventer un fondement que personne n'a verifie, sur un
 * document qui part sur papier a en-tete.
 */
export function courrierSdif(p: ParcelleEnBase, ctx: ContexteCourrier = {}): Courrier {
  const aCompleter: string[] = [];
  const projet = ctx.projet?.trim();
  if (!projet) aCompleter.push('la nature du projet envisagé');
  aCompleter.push('l’adresse du service destinataire');
  aCompleter.push('le fondement de la demande, à vérifier auprès du service saisi');

  const corps = [
    trou('adresse du service de la publicité foncière ou de la mairie'),
    '',
    `Objet : demande de communication de l’identité du propriétaire d’une parcelle cadastrale`,
    '',
    'Madame, Monsieur,',
    '',
    `Dans le cadre de l’étude d’un projet ${projet ?? trou('nature du projet')}, nous souhaitons ` +
      'prendre contact avec le propriétaire de la parcelle suivante :',
    '',
    `    ${designation(p)}.`,
    '',
    'Nous vous saurions gré de bien vouloir nous communiquer les éléments permettant de ' +
      'l’identifier et de le contacter.',
    '',
    `Fondement de la demande : ${trou('à compléter et à vérifier auprès du service saisi')}.`,
    '',
    'Nous nous tenons à votre disposition pour tout justificatif complémentaire.',
    '',
    'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.',
  ].join('\n');

  return {
    objet: `Demande d’identité du propriétaire — parcelle ${p.idu}`,
    corps,
    aCompleter,
  };
}

/**
 * Courrier 2 — PREMIER CONTACT AVEC LE PROPRIETAIRE OU L'EXPLOITANT.
 *
 * CE QU'IL N'AFFIRME PAS. Aucun chiffre de loyer, aucune surface de projet, aucune puissance : ce
 * sont des elements de negociation que seul le developpeur fixe, et qu'un generateur ne doit pas
 * suggerer. Un courrier qui annoncerait « environ 3 000 € par hectare et par an » sur la foi d'un
 * modele engagerait l'expediteur sur un montant que personne n'a valide.
 *
 * Il propose un entretien, designe la parcelle sans erreur, et s'arrete la.
 */
export function courrierProprietaire(p: ParcelleEnBase, ctx: ContexteCourrier = {}): Courrier {
  const aCompleter: string[] = [];
  const destinataire = ctx.destinataire?.trim();
  const adresse = ctx.adresse?.trim();
  const projet = ctx.projet?.trim();
  if (!destinataire) aCompleter.push('le nom du destinataire');
  if (!adresse) aCompleter.push('l’adresse du destinataire');
  if (!projet) aCompleter.push('la nature du projet envisagé');

  const corps = [
    destinataire ?? trou('nom du destinataire'),
    adresse ?? trou('adresse du destinataire'),
    '',
    'Objet : votre parcelle et un projet d’énergie renouvelable',
    '',
    destinataire ? `${destinataire},` : 'Madame, Monsieur,',
    '',
    `Nous étudions l’implantation d’un projet ${projet ?? trou('nature du projet')} dans votre ` +
      'secteur, et votre parcelle retient notre attention :',
    '',
    `    ${designation(p)}.`,
    '',
    'À ce stade, il s’agit d’une étude préalable : aucune décision n’est prise, et rien ne vous ' +
      'engage. Nous souhaiterions simplement échanger avec vous sur les caractéristiques du ' +
      'terrain et sur son usage actuel.',
    '',
    'Si cette démarche vous intéresse, ou si vous souhaitez simplement en savoir plus, vous ' +
      'pouvez nous joindre aux coordonnées ci-dessous. Nous nous déplaçons volontiers.',
    '',
    'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.',
  ].join('\n');

  return {
    objet: `Votre parcelle ${p.section} ${p.numero} — projet d’énergie renouvelable`,
    corps,
    aCompleter,
  };
}

export function construireCourrier(
  type: TypeCourrier,
  p: ParcelleEnBase,
  ctx: ContexteCourrier = {},
): Courrier {
  return type === 'sdif' ? courrierSdif(p, ctx) : courrierProprietaire(p, ctx);
}

/**
 * Encode un courrier en message `.eml`, ouvrable par n'importe quel client de messagerie.
 *
 * POURQUOI `.eml` PLUTOT QU'UN `mailto:`. Un `mailto:` passe le corps dans une URL : les clients
 * le tronquent — la limite pratique tourne autour de 2 000 caracteres selon le navigateur et le
 * systeme — et les retours a la ligne y survivent mal. Ces courriers font plus de 1 200
 * caracteres avec leurs trous ; le `mailto:` les couperait au milieu, en silence. L'interface
 * propose donc les deux, mais le fichier est le chemin sur.
 *
 * ENCODAGE `quoted-printable`, et il est necessaire : le corps est en UTF-8 avec des accents a
 * chaque ligne, et un `.eml` en 8 bits brut s'affiche en mojibake dans plusieurs clients. On
 * encode donc tout octet non ASCII, plus le `=` lui-meme.
 */
export function versEml(courrier: Courrier, destinataire?: string | null): string {
  const lignes = [
    'MIME-Version: 1.0',
    enTeteEncodee('Subject', courrier.objet),
    ...(destinataire?.trim() ? [enTeteEncodee('To', destinataire.trim())] : []),
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(courrier.corps),
  ];
  // CRLF : la norme du format, et plusieurs clients refusent d'ouvrir un fichier en LF seul.
  return lignes.join('\r\n');
}

/** Une piece jointe : son nom de fichier, son type et ses octets. */
export interface PieceJointe {
  nom: string;
  type: string;
  contenu: Buffer;
}

/**
 * Un message `.eml` porteur d'une piece jointe — le brouillon d'un courriel, pret a relire.
 *
 * ═══ POURQUOI UN FICHIER PLUTOT QU'UN ENVOI
 *
 * RIEN NE PART D'ICI. L'application ne possede aucune boite d'envoi, et c'est un choix : un
 * courriel de prospection part de la messagerie PROFESSIONNELLE de l'operateur, sous son adresse,
 * avec son expediteur en en-tete et sa signature dans le corps — c'est d'ailleurs la raison pour
 * laquelle les courriers ne redemandent plus ces quatre champs. Un `.eml` s'ouvre d'un double-clic
 * dans Outlook ou Thunderbird : l'operateur relit, complete, et envoie lui-meme.
 *
 * ═══ POURQUOI PAS UN `mailto:`
 *
 * Un `mailto:` ne porte AUCUNE piece jointe — la specification ne le permet pas — et tronque en
 * silence un corps trop long. Or ce qu'on veut joindre est precisement le document illustre : les
 * cartes ne passent pas dans une URL.
 *
 * ═══ LES DEUX ENCODAGES NE SONT PAS LE MEME
 *
 * Le corps est du texte accentue : `quoted-printable`, comme pour un message simple. La piece,
 * elle, est binaire : `base64`, replie a 76 caracteres. Les melanger produit un fichier qu'un
 * client ouvre sans rien dire et affiche de travers.
 */
export function versEmlAvecPieces(
  courrier: Courrier,
  pieces: PieceJointe[],
  destinataire?: string | null,
): string {
  if (pieces.length === 0) return versEml(courrier, destinataire);

  /*
   * LA FRONTIERE NE DOIT APPARAITRE DANS AUCUNE PARTIE, sans quoi le message se coupe au mauvais
   * endroit. Une chaine fixe suffirait presque toujours ; un tirage aleatoire rend le « presque »
   * inutile, et le corps comme le base64 sont de toute facon incapables de la reproduire.
   */
  const frontiere = `----enr-${randomBytes(12).toString('hex')}`;

  const lignes = [
    'MIME-Version: 1.0',
    enTeteEncodee('Subject', courrier.objet),
    ...(destinataire?.trim() ? [enTeteEncodee('To', destinataire.trim())] : []),
    `Content-Type: multipart/mixed; boundary="${frontiere}"`,
    '',
    // Un client qui ne comprend pas le multipart affiche ceci. Il n'y en a plus guere, mais la
    // ligne coute un octet et evite un message vide chez celui qui resterait.
    'Ce message est au format MIME multipartie.',
    '',
    `--${frontiere}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(courrier.corps),
  ];

  for (const piece of pieces) {
    lignes.push(
      `--${frontiere}`,
      `Content-Type: ${piece.type}`,
      'Content-Transfer-Encoding: base64',
      // `filename*` en RFC 2231 porte les accents ; `filename` reste pour les clients anciens.
      `Content-Disposition: attachment; filename="${piece.nom.replace(/[^\w.\- ]/g, '_')}"`,
      '',
      piece.contenu.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    );
  }
  lignes.push(`--${frontiere}--`, '');

  return lignes.join('\r\n');
}

/**
 * En-tete non ASCII : encodage `=?UTF-8?B?...?=` (RFC 2047), replie si besoin.
 *
 * Un objet accentue ecrit tel quel dans un en-tete s'affiche casse. Le corps a son propre
 * encodage ; les en-tetes ont le leur, et ce n'est pas le meme.
 *
 * DEUX ERREURS SUCCESSIVES ONT MENE A CE CODE, et la seconde est la plus instructive.
 *
 *   1. Mon premier jet encodait l'objet d'un seul tenant : « Subject: » suivi d'un mot encode de
 *      101 caracteres, la ou la RFC 2047 plafonne un « encoded word » a 75. Des passerelles
 *      replient ou tronquent un en-tete trop long, et un objet tronque au milieu d'un mot encode
 *      ne se decode plus DU TOUT — pas partiellement : plus du tout.
 *   2. Mon deuxieme jet decoupait la source en tranches de 24 CARACTERES. Une tranche de 24
 *      caracteres tous accentues fait 48 octets, donc 64 caracteres de base64, donc 76 avec
 *      l'habillage — et 85 une fois « Subject: » devant. Le repli existait, et la ligne depassait
 *      quand meme. Le budget se compte en OCTETS, et il depend du prefixe de la ligne : le nom de
 *      l'en-tete sur la premiere, une simple espace sur les suivantes.
 *
 * On decoupe donc la source caractere par caractere — jamais au milieu d'un caractere multi-octet,
 * sans quoi le mot encode livrerait un octet orphelin — en respectant le budget de la ligne.
 */
function enTeteEncodee(nom: string, valeur: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(valeur)) return `${nom}: ${valeur}`;

  const MAX_LIGNE = 76;
  const HABILLAGE = '=?UTF-8?B??='.length;

  /** Octets de source qu'un mot encode peut porter sur une ligne dont le prefixe fait `n`. */
  const budget = (prefixe: number): number => {
    // Le base64 se compte par groupes de 4 caracteres pour 3 octets : on arrondit vers le bas.
    const base64 = Math.floor((MAX_LIGNE - prefixe - HABILLAGE) / 4) * 4;
    return (base64 / 4) * 3;
  };

  const caracteres = [...valeur];
  const mots: string[] = [];
  let index = 0;
  while (index < caracteres.length) {
    // La premiere ligne porte « Nom: », les suivantes la seule espace du repli d'en-tete.
    const tenable = budget(mots.length === 0 ? nom.length + 2 : 1);
    let octets = 0;
    let fin = index;
    while (fin < caracteres.length) {
      const taille = Buffer.byteLength(caracteres[fin]!, 'utf8');
      if (octets + taille > tenable) break;
      octets += taille;
      fin += 1;
    }
    // Garde-fou : un caractere plus large que le budget bouclerait indefiniment. Il en faudrait un
    // de plus de 30 octets, ce qui n'existe pas en UTF-8 — on ne laisse pas le cas ouvert pour
    // autant, un plafond futur plus bas suffirait a le rendre atteignable.
    if (fin === index) fin = index + 1;
    const morceau = caracteres.slice(index, fin).join('');
    mots.push(`=?UTF-8?B?${Buffer.from(morceau, 'utf8').toString('base64')}?=`);
    index = fin;
  }
  return `${nom}: ${mots.join('\r\n ')}`;
}

/** Encodage `quoted-printable` du corps, avec repliage des lignes a 76 caracteres. */
function quotedPrintable(texte: string): string {
  const encode = (ligne: string): string => {
    let sortie = '';
    for (const octet of Buffer.from(ligne, 'utf8')) {
      // `=` (0x3D) doit etre echappe meme s'il est imprimable : c'est le caractere d'echappement.
      if (octet >= 0x20 && octet <= 0x7e && octet !== 0x3d) sortie += String.fromCharCode(octet);
      else sortie += `=${octet.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return sortie;
  };

  return texte
    .split('\n')
    .map((ligne) => replier(encode(ligne)))
    .join('\r\n');
}

/**
 * Replie une ligne encodee a 76 caracteres, avec le « soft line break » `=`.
 *
 * LE PIEGE : on ne doit jamais couper AU MILIEU d'une sequence `=XX`, sinon l'octet se perd et le
 * texte se decode de travers. On recule donc jusqu'a une frontiere sure.
 */
function replier(ligne: string): string {
  const MAX = 75;
  const morceaux: string[] = [];
  let reste = ligne;
  while (reste.length > MAX) {
    let coupe = MAX;
    // Une sequence `=XX` occupe trois caracteres : reculer tant que la coupe tombe dedans.
    while (coupe > 0 && /=[0-9A-F]?$/.test(reste.slice(0, coupe))) coupe -= 1;
    morceaux.push(`${reste.slice(0, coupe)}=`);
    reste = reste.slice(coupe);
  }
  morceaux.push(reste);
  return morceaux.join('\r\n');
}
