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
  /** Raison sociale de l'expediteur, telle qu'elle doit apparaitre. */
  expediteur?: string | null;
  /** Nom de la personne qui signe. */
  signataire?: string | null;
  /** Qualite du signataire (« chargé de développement foncier »). */
  qualite?: string | null;
  /** Coordonnees de rappel : telephone, courriel. */
  coordonnees?: string | null;
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

/** Bloc de signature, avec ses trous nommes. */
function signature(ctx: ContexteCourrier, aCompleter: string[]): string {
  const signataire = ctx.signataire?.trim();
  const qualite = ctx.qualite?.trim();
  const coordonnees = ctx.coordonnees?.trim();
  if (!signataire) aCompleter.push('le nom du signataire');
  if (!qualite) aCompleter.push('la qualité du signataire');
  if (!coordonnees) aCompleter.push('les coordonnées de rappel');
  return [
    signataire ?? trou('nom du signataire'),
    qualite ?? trou('qualité du signataire'),
    coordonnees ?? trou('téléphone et courriel'),
  ].join('\n');
}

/** En-tete expediteur. */
function entete(ctx: ContexteCourrier, aCompleter: string[]): string {
  const expediteur = ctx.expediteur?.trim();
  if (!expediteur) aCompleter.push('la raison sociale de l’expéditeur');
  return expediteur ?? trou('raison sociale de l’expéditeur');
}

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
  const expediteur = entete(ctx, aCompleter);
  const projet = ctx.projet?.trim();
  if (!projet) aCompleter.push('la nature du projet envisagé');
  aCompleter.push('l’adresse du service destinataire');
  aCompleter.push('le fondement de la demande, à vérifier auprès du service saisi');

  const corps = [
    expediteur,
    '',
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
    '',
    signature(ctx, aCompleter),
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
  const expediteur = entete(ctx, aCompleter);
  const destinataire = ctx.destinataire?.trim();
  const adresse = ctx.adresse?.trim();
  const projet = ctx.projet?.trim();
  if (!destinataire) aCompleter.push('le nom du destinataire');
  if (!adresse) aCompleter.push('l’adresse du destinataire');
  if (!projet) aCompleter.push('la nature du projet envisagé');

  const corps = [
    expediteur,
    '',
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
    '',
    signature(ctx, aCompleter),
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
