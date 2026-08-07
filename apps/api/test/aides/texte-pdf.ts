/**
 * Extraction du texte d'un PDF, sans dependance ni binaire externe.
 *
 * POURQUOI PAS `pdftotext`. La relecture des rapports (audit 10, risque F2) a d'abord ete faite avec
 * l'outil de poppler. Il fait tres bien le travail, mais il n'est pas installe partout : en faire une
 * dependance de la CI, c'est accepter que la verification saute silencieusement le jour ou l'image
 * change. Une verification qui peut disparaitre sans bruit ne protege rien — c'est la lecon de H4 de
 * l'audit 10, sous une autre forme.
 *
 * COMMENT. Un PDF produit par pdfkit range son contenu dans des flux compresses en Flate. Chacun
 * contient des operateurs de dessin de texte : `(…) Tj` pour une chaine, `[(…) n (…)] TJ` pour une
 * chaine avec crenage. Il suffit donc de decompresser les flux et d'y relever les chaines. `zlib` est
 * dans Node, et rien d'autre n'est necessaire.
 *
 * CE QUE CELA NE FAIT PAS, et il faut le dire : aucune mise en page n'est reconstituee. L'ordre des
 * chaines est celui du dessin, les colonnes ne sont pas recomposees, et deux mots voisins a l'ecran
 * peuvent etre eloignes dans la sortie. C'est sans consequence pour ce qu'on cherche — la PRESENCE
 * d'un libelle et la FORME des nombres et des dates — et cela ne conviendrait pas pour verifier une
 * mise en page. Verifie sur les rapports reels : le texte extrait couvre les memes phrases que
 * `pdftotext`, aux espacements pres.
 */

import { inflateSync } from 'node:zlib';

/** Sequences d'echappement d'une chaine litterale PDF. */
const ECHAPPEMENTS: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
};

/**
 * Les chaines d'un flux de contenu, dans l'ordre du dessin.
 *
 * DEUX FORMES, et il faut les deux. La specification PDF autorise la chaine litterale `(texte)` et la
 * chaine hexadecimale `<74657874 65>`. La premiere version de ce module ne lisait que la litterale, et
 * n'extrayait donc RIEN : pdfkit ecrit ses chaines en hexadecimal. Cinq flux corrects, deux cents
 * chaines par flux, et zero caractere en sortie.
 *
 * Ce silence aurait ete le pire des resultats. Un garde typographique sur un texte vide ne trouve
 * aucune faute et se declare satisfait — le test decoratif parfait. C'est pour cela que
 * `texteDuPdf` est appele derriere un controle de longueur minimale dans les tests : une extraction
 * qui echoue doit se voir, pas se taire.
 *
 * Le decodage de la forme litterale est ecrit a la main plutot que par une expression reguliere : les
 * parentheses peuvent s'imbriquer et etre echappees, et une expression reguliere se trompe des le
 * premier libelle contenant « (PLUi) », c'est-a-dire des la premiere page d'un rapport reel.
 */
function chaines(contenu: string): string[] {
  const sorties: string[] = [];
  for (let i = 0; i < contenu.length; i += 1) {
    const c = contenu[i]!;

    // Forme hexadecimale : <48656c6c6f>. `<<` ouvre un dictionnaire et n'est pas une chaine.
    if (c === '<' && contenu[i + 1] !== '<') {
      const fin = contenu.indexOf('>', i + 1);
      if (fin < 0) continue;
      const corps = contenu.slice(i + 1, fin).replace(/\s+/g, '');
      if (corps.length > 0 && /^[0-9a-fA-F]+$/.test(corps)) {
        // Un chiffre final manquant vaut zero, selon la specification.
        const pair = corps.length % 2 === 0 ? corps : `${corps}0`;
        let s = '';
        for (let k = 0; k < pair.length; k += 2) {
          s += String.fromCharCode(parseInt(pair.slice(k, k + 2), 16));
        }
        sorties.push(s);
        i = fin;
      }
      continue;
    }

    if (c !== '(') continue;
    let profondeur = 1;
    let j = i + 1;
    let s = '';
    while (j < contenu.length && profondeur > 0) {
      const d = contenu[j]!;
      if (d === '\\') {
        const suivant = contenu[j + 1] ?? '';
        if (/[0-7]/.test(suivant)) {
          // Octal : \ddd, un a trois chiffres. Les accents de WinAnsi arrivent sous cette forme.
          const octal = /^[0-7]{1,3}/.exec(contenu.slice(j + 1))![0];
          s += String.fromCharCode(parseInt(octal, 8));
          j += 1 + octal.length;
          continue;
        }
        s += ECHAPPEMENTS[suivant] ?? suivant;
        j += 2;
        continue;
      }
      if (d === '(') profondeur += 1;
      else if (d === ')') {
        profondeur -= 1;
        if (profondeur === 0) break;
      }
      s += d;
      j += 1;
    }
    sorties.push(s);
    i = j;
  }
  return sorties;
}

/**
 * Le texte d'un PDF, dans l'ordre du dessin.
 *
 * LE DECOUPAGE EN MOTS EST LE POINT DELICAT, et la premiere version se trompait dans les deux sens.
 *
 * pdfkit ecrit une ligne de texte comme un seul operateur `TJ`, dont le tableau alterne des morceaux
 * de chaine et des nombres de crenage : `[<5052> 20 <4f5350454354494f4e> …] TJ`. Ces nombres ajustent
 * l'espacement entre GLYPHES — ils ne separent pas des mots. Joindre tous les morceaux par une espace
 * donnait « PR OSPECTION ENR - RAPPOR T DE Q U ALIFICA TION », ou plus aucun libelle n'est
 * reconnaissable : un test cherchant « Irradiation » ne l'aurait jamais trouve, et aurait echoue pour
 * une raison etrangere a ce qu'il verifie.
 *
 * A l'inverse, tout coller sans separateur recollerait deux operateurs voisins — la fin d'une cellule
 * de tableau et le debut de la suivante — et fabriquerait des nombres a rallonge que le garde
 * typographique signalerait a tort.
 *
 * La regle correcte suit donc la structure du PDF : **concatener a l'interieur d'un operateur,
 * separer entre operateurs.** Les mots restent entiers, les cellules restent distinctes.
 */
export function texteDuPdf(pdf: Buffer): string {
  const brut = pdf.toString('latin1');
  const operateurs: string[] = [];
  const flux = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = flux.exec(brut)) !== null) {
    const donnees = Buffer.from(m[1]!, 'latin1');
    let contenu: string;
    try {
      contenu = inflateSync(donnees).toString('latin1');
    } catch {
      // Flux non compresse (ou police embarquee) : on tente tel quel, sinon on passe.
      contenu = donnees.toString('latin1');
    }
    if (!/\bTJ\b|\bTj\b/.test(contenu)) continue;

    // Un operateur d'affichage : soit `[ ... ] TJ`, soit une chaine seule suivie de `Tj`.
    const affichage = /\[([\s\S]*?)\]\s*TJ|((?:\([\s\S]*?\)|<[0-9a-fA-F\s]*>))\s*Tj/g;
    let o: RegExpExecArray | null;
    while ((o = affichage.exec(contenu)) !== null) {
      operateurs.push(chaines(o[1] ?? o[2] ?? '').join(''));
    }
  }
  return operateurs.join(' ').replace(/[ \t]+/g, ' ');
}
