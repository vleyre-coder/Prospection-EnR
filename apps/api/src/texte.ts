/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * REPARER UN TEXTE DOUBLEMENT ENCODE — UN DEFAUT QUI VIENT DE LA SOURCE, PAS DE NOUS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, et non suppose. Le dossier de site imprimait, dans la colonne des servitudes
 * d'utilite publique : « ac1, ChÃ¢teau de VilleprÃ©vost ». Premiere hypothese, la plus probable et la
 * plus honteuse : notre couche HTTP lit du UTF-8 comme du Latin-1. Elle est FAUSSE, et la
 * verification a pris une commande :
 *
 *     curl .../api/gpu/assiette-sup-s?geom=... | grep -o 'nomsuplitt":"[^"]*"' | od -c
 *     → C   h  303 203 302 242  t   e   a   u
 *
 * Soit, en hexadecimal, `C3 83 C2 A2`. En UTF-8 valide, cela se lit « Ã¢ » — deux caracteres. Le
 * caractere voulu, « â », s'ecrit `C3 A2`. La chaine a donc ete encodee DEUX FOIS en UTF-8 quelque
 * part en amont de l'API, et l'API la republie telle quelle. Notre analyse JSON est correcte : elle
 * restitue fidelement ce qui lui est servi.
 *
 * POURQUOI REPARER PLUTOT QUE LAISSER PASSER. Ces libelles partent dans un dossier remis a un
 * developpeur ou a un proprietaire. Un nom de monument historique illisible dans un document remis
 * n'est pas une bizarrerie de terminal : c'est ce qui fait douter du reste du document.
 *
 * POURQUOI CE N'EST PAS DANGEREUX, et c'est la seule question qui vaille pour une reparation
 * automatique de texte. La transformation n'est appliquee que si les DEUX conditions tiennent :
 *
 *   1. tous les points de code de la chaine tiennent sur un octet (< U+0100), sans quoi la lecture
 *      en Latin-1 serait deja une perte ;
 *   2. la relecture en UTF-8 des octets ainsi obtenus est VALIDE, c'est-a-dire ne produit aucun
 *      caractere de remplacement U+FFFD, et change reellement la chaine.
 *
 * Un texte francais correct — « Château de Villeprévost » — echoue a la condition 2 : ses octets
 * Latin-1 `43 68 E2 74 ...` ne forment pas une sequence UTF-8 valide, la relecture rend U+FFFD, et
 * la chaine est renvoyee inchangee. Un texte purement ASCII echoue a la condition 2 aussi
 * (relecture identique). Seul le double encodage passe les deux.
 *
 * CE QUE CETTE FONCTION NE FAIT PAS. Elle ne devine pas un encodage, elle ne corrige pas une faute
 * de frappe, et elle ne touche pas au sens. Elle annule une transformation mecanique dont la trace
 * est reconnaissable, ou elle ne fait rien.
 */

/**
 * Annule un double encodage UTF-8, ou rend la chaine inchangee.
 *
 * `null` et la chaine vide traversent sans traitement : ce sont des absences, pas des textes.
 */
export function reparerDoubleEncodage<T extends string | null | undefined>(texte: T): T {
  if (texte == null || texte === '') return texte;
  const s = String(texte);

  /*
   * Le marqueur : le double encodage d'un caractere Latin-1 accentue commence TOUJOURS par
   * `C3 83` (« Ã ») ou `C2` (« Â »). Sans l'un des deux, il n'y a rien a annuler, et l'on evite un
   * aller-retour d'octets sur chaque libelle traverse.
   */
  if (!/[ÃÂ]/.test(s)) return texte;

  // Condition 1 : la chaine doit tenir en Latin-1, sinon la conversion perdrait de l'information.
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 0xff) return texte;
  }

  const relu = Buffer.from(s, 'latin1').toString('utf8');
  // Condition 2 : la relecture doit etre du UTF-8 VALIDE, et doit changer quelque chose.
  if (relu === s || relu.includes('�')) return texte;
  return relu as T;
}

/**
 * Repare les valeurs TEXTUELLES d'un objet de proprietes, en place dans une copie.
 *
 * POURQUOI SEULEMENT LES PROPRIETES, ET PAS LA REPONSE ENTIERE. Le choke point ideal serait
 * `jsonExterne` : tout texte venu du dehors y passe. Mais une collection d'entites porte aussi ses
 * GEOMETRIES, c'est-a-dire des dizaines de milliers de nombres, et parcourir cet arbre a chaque
 * requete pour y chercher des chaines couterait bien plus que le defaut repare. Les proprietes sont
 * le seul endroit ou vivent les libelles, et elles sont plates.
 *
 * La copie est superficielle : les valeurs non textuelles sont reprises par reference, sans etre
 * examinees ni modifiees.
 */
export function reparerProprietes<P>(proprietes: P): P {
  if (proprietes == null || typeof proprietes !== 'object') return proprietes;
  const sortie: Record<string, unknown> = { ...(proprietes as Record<string, unknown>) };
  for (const [cle, valeur] of Object.entries(sortie)) {
    if (typeof valeur === 'string') sortie[cle] = reparerDoubleEncodage(valeur);
  }
  return sortie as P;
}
