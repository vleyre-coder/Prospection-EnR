/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ECRITURE DE DOCUMENTS WORD (.docx) — Office Open XML, sans dependance
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE MODULE, ET POURQUOI IL N'INSTALLE RIEN. Le proprietaire demande un document
 * « sous Word que je puisse editer et transmettre a un developpeur ». Un PDF ne convient pas : il
 * se lit, il ne se remplit pas. Il fallait donc du .docx.
 *
 * Trois voies existaient :
 *   1. ajouter la bibliotheque `docx` — 1,5 Mo de dependance transitive pour ecrire des
 *      paragraphes et deux tableaux, dans un depot qui compte onze dependances en tout et qui
 *      s'installe chez l'utilisateur final sans reseau. Refuse ;
 *   2. produire un .rtf ou un .doc HTML renomme. Word les ouvre, mais en signalant un format
 *      inattendu, et le rendu depend de la version. Un document remis a un tiers ne s'ouvre pas
 *      avec un avertissement ;
 *   3. ecrire l'Office Open XML a la main. Retenu : un .docx est une archive ZIP de quatre
 *      fichiers XML, et `zipper()` existe deja dans ce depot pour les archives Shapefile.
 *
 * CE QUE CE MODULE COUVRE, ET CE QU'IL NE COUVRE PAS. Titres, paragraphes, listes, tableaux avec
 * en-tete, gras, et sauts de page : de quoi ecrire un cahier des charges lisible et EDITABLE.
 * Pas d'images, pas de styles complexes, pas de numerotation automatique — tout ce qui n'est pas
 * necessaire est absent, parce que chaque element ajoute est une facon de plus de produire un
 * fichier que Word refuse d'ouvrir.
 *
 * LA REGLE QUI GOUVERNE TOUT LE FICHIER : Word est INTOLERANT. Un caractere `&` non echappe, une
 * balise fermee dans le desordre, un `w:tblGrid` absent, et le fichier s'ouvre sur « Le fichier
 * .docx ne peut pas etre ouvert car son contenu pose probleme » — sans dire lequel. D'ou
 * l'echappement systematique en un seul point (`echapper`), et un test qui DEZIPPE le resultat
 * pour verifier la presence et la bonne formation de chaque partie.
 */

import { zipper } from './shapefile.js';

// ---------------------------------------------------------------------------
// Modele de document
// ---------------------------------------------------------------------------

export type Bloc =
  | { type: 'titre'; texte: string }
  | { type: 'soustitre'; texte: string }
  | { type: 'section'; texte: string }
  | { type: 'soussection'; texte: string }
  | { type: 'paragraphe'; texte: string; gras?: boolean; petit?: boolean }
  | { type: 'puce'; texte: string }
  | { type: 'tableau'; entetes: string[]; lignes: string[][]; largeurs?: number[] }
  | { type: 'sautDePage' };

/**
 * Echappement XML, en UN SEUL POINT.
 *
 * Les cinq entites sont obligatoires, mais ce n'est pas le piege principal. Word REFUSE D'OUVRIR
 * un document contenant un caractere de controle non autorise par XML 1.0 — et les libelles de ce
 * depot viennent de sources externes (Geoportail, INPN, Legifrance) qui en charrient. Ils sont
 * donc retires plutot qu'echappes : un caractere invisible ne vaut pas un fichier illisible.
 * Tabulation, saut de ligne et retour chariot sont conserves, ils sont licites.
 */
function echapper(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Un « run » de texte, avec conservation des espaces.
 *
 * `xml:space="preserve"` n'est pas decoratif : sans lui, Word supprime les espaces de tete et de
 * queue, et « 500 m » colle au libelle precedent dans les cellules composees.
 */
function run(texte: string, options: { gras?: boolean; petit?: boolean } = {}): string {
  const proprietes =
    options.gras || options.petit
      ? `<w:rPr>${options.gras ? '<w:b/>' : ''}${options.petit ? '<w:sz w:val="16"/>' : ''}</w:rPr>`
      : '';
  return `<w:r>${proprietes}<w:t xml:space="preserve">${echapper(texte)}</w:t></w:r>`;
}

function paragraphe(
  texte: string,
  options: { style?: string; gras?: boolean; petit?: boolean } = {},
): string {
  const proprietes = options.style ? `<w:pPr><w:pStyle w:val="${options.style}"/></w:pPr>` : '';
  return `<w:p>${proprietes}${run(texte, options)}</w:p>`;
}

/**
 * Cellule de tableau.
 *
 * `w:tcW` EST OBLIGATOIRE, meme a zero : Word ouvre un document sans lui, mais LibreOffice rend
 * alors des colonnes de largeur nulle — verifie a l'ouverture. La largeur est exprimee en
 * cinquantiemes de pourcent (`pct`), ce qui rend le tableau independant du format de page.
 */
function cellule(texte: string, largeurPct: number, gras = false): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${Math.round(largeurPct * 50)}" w:type="pct"/>` +
    `${gras ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>' : ''}</w:tcPr>` +
    `<w:p>${run(texte, { gras, petit: true })}</w:p></w:tc>`
  );
}

function tableau(entetes: string[], lignes: string[][], largeurs?: number[]): string {
  const n = entetes.length;
  const parts = largeurs ?? entetes.map(() => 100 / n);
  // `w:tblGrid` est exige par la specification : sans lui Word signale un contenu illisible.
  const grille = parts.map((p) => `<w:gridCol w:w="${Math.round((p / 100) * 9360)}"/>`).join('');
  const bordure = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((c) => `<w:${c} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
    .join('');
  const enTete =
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
    entetes.map((e, i) => cellule(e, parts[i] ?? 100 / n, true)).join('') +
    '</w:tr>';
  const corps = lignes
    .map(
      (l) =>
        '<w:tr>' +
        entetes.map((_, i) => cellule(l[i] ?? '', parts[i] ?? 100 / n)).join('') +
        '</w:tr>',
    )
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${bordure}</w:tblBorders></w:tblPr>` +
    `<w:tblGrid>${grille}</w:tblGrid>${enTete}${corps}</w:tbl>` +
    // Un paragraphe vide APRES chaque tableau : deux tableaux consecutifs fusionnent sinon en un
    // seul, ce qui melange leurs colonnes.
    '<w:p/>'
  );
}

function rendreBloc(b: Bloc): string {
  switch (b.type) {
    case 'titre':
      return paragraphe(b.texte, { style: 'Title' });
    case 'soustitre':
      return paragraphe(b.texte, { style: 'Subtitle' });
    case 'section':
      return paragraphe(b.texte, { style: 'Heading1' });
    case 'soussection':
      return paragraphe(b.texte, { style: 'Heading2' });
    case 'paragraphe':
      return paragraphe(b.texte, { gras: b.gras ?? false, petit: b.petit ?? false });
    case 'puce':
      return paragraphe(b.texte, { style: 'ListParagraph' });
    case 'tableau':
      return tableau(b.entetes, b.lignes, b.largeurs);
    case 'sautDePage':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
}

/**
 * Feuille de styles minimale.
 *
 * ELLE EXISTE POUR QUE LE DOCUMENT RESTE EDITABLE, et c'est tout son interet. Sans styles nommes,
 * il aurait fallu poser la mise en forme sur chaque paragraphe : le destinataire n'aurait alors
 * eu aucun moyen de changer l'allure du document autrement qu'a la main, ligne par ligne. Avec
 * eux, le volet de navigation de Word fonctionne, la table des matieres se genere, et modifier un
 * style change tout le document — ce qu'on attend d'un cahier des charges qu'on va s'approprier.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="0F5B8A"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:sz w:val="22"/><w:color w:val="595959"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="120"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="0F5B8A"/></w:pBdr></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="0F5B8A"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:after="60"/></w:pPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const RELS_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Construit un fichier .docx complet.
 *
 * `titre` alimente les proprietes du document : c'est ce que Word affiche dans sa barre de titre
 * et ce qu'un gestionnaire documentaire indexe. Un document sans titre arrive chez le destinataire
 * sous le nom « Document1 ».
 */
export function construireDocx(titre: string, blocs: Bloc[]): Buffer {
  const corps = blocs.map(rendreBloc).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${corps}<w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/>
  </w:sectPr></w:body>
</w:document>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${echapper(titre)}</dc:title>
  <dc:creator>Prospection EnR</dc:creator>
  <cp:lastModifiedBy>Prospection EnR</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>`;

  return zipper([
    { nom: '[Content_Types].xml', contenu: Buffer.from(CONTENT_TYPES, 'utf8') },
    { nom: '_rels/.rels', contenu: Buffer.from(RELS, 'utf8') },
    { nom: 'docProps/core.xml', contenu: Buffer.from(core, 'utf8') },
    { nom: 'word/_rels/document.xml.rels', contenu: Buffer.from(RELS_DOCUMENT, 'utf8') },
    { nom: 'word/styles.xml', contenu: Buffer.from(STYLES, 'utf8') },
    { nom: 'word/document.xml', contenu: Buffer.from(document, 'utf8') },
  ]);
}
