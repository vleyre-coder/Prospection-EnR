/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE CAHIER DES CHARGES WORD — le fichier s'ouvre-t-il, et dit-il ce qu'il doit dire
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. Le .docx est ecrit a la main — Office Open XML, sans bibliotheque —
 * et Word est INTOLERANT : un `&` non echappe, un `w:tblGrid` absent, un caractere de controle
 * herite d'une source externe, et le document s'ouvre sur « le contenu pose probleme », sans dire
 * lequel. Aucun typage ne protege de cela. Seule une relecture du fichier PRODUIT le fait.
 *
 * CE TEST EST HERMETIQUE, ET C'EST UN CHOIX. LibreOffice a servi d'instrument pendant le
 * developpement : `libreoffice --headless --convert-to txt` charge les quatre documents « as a
 * Writer document » et en restitue le texte, titres et cellules compris. Mais un test qui
 * dependrait d'un paquet systeme serait vert sur une machine, ignore sur une autre, et rouge nulle
 * part pour une bonne raison — le meme raisonnement que pour hunspell et le dictionnaire.
 *
 * Le test lit donc l'archive avec `node:zlib` seul, et verifie ce qui fait echouer Word :
 *   - les six parties attendues sont presentes, et `[Content_Types].xml` vient EN PREMIER ;
 *   - chaque partie XML est bien formee — balises equilibrees, entites echappees ;
 *   - chaque partie declaree dans les types de contenu existe reellement, et reciproquement ;
 *   - aucun caractere de controle interdit par XML 1.0 ne subsiste.
 *
 * ET SUR LE FOND : qu'un cahier des charges sans la colonne des identifiants techniques, sans les
 * regles a valider par un juriste, ou sans ses reserves, ne parte pas chez un tiers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { FILIERES, FILIERES_META, SEUILS_RECHERCHE } from '@enr/core';
import { cahierDesChargesDocx } from '../src/services/cahier-des-charges.js';

/**
 * Lit une archive ZIP produite par `zipper()` : nom de partie -> contenu.
 *
 * Volontairement minimal — il ne lit que ce que `zipper` ecrit : deflate brut, pas de descripteur
 * de donnees, pas de ZIP64. Un lecteur generique masquerait justement les ecarts qu'on cherche.
 */
function lireZip(archive: Buffer): Map<string, string> {
  const parties = new Map<string, string>();
  let i = 0;
  while (i + 30 <= archive.length && archive.readUInt32LE(i) === 0x04034b50) {
    const tailleCompressee = archive.readUInt32LE(i + 18);
    const tailleNom = archive.readUInt16LE(i + 26);
    const tailleExtra = archive.readUInt16LE(i + 28);
    const nom = archive.subarray(i + 30, i + 30 + tailleNom).toString('utf8');
    const debut = i + 30 + tailleNom + tailleExtra;
    const donnees = archive.subarray(debut, debut + tailleCompressee);
    parties.set(nom, inflateRawSync(donnees).toString('utf8'));
    i = debut + tailleCompressee;
  }
  return parties;
}

/** Ordre des parties dans l'archive, tel qu'ecrit. */
function nomsEnOrdre(archive: Buffer): string[] {
  const noms: string[] = [];
  let i = 0;
  while (i + 30 <= archive.length && archive.readUInt32LE(i) === 0x04034b50) {
    const tailleCompressee = archive.readUInt32LE(i + 18);
    const tailleNom = archive.readUInt16LE(i + 26);
    const tailleExtra = archive.readUInt16LE(i + 28);
    noms.push(archive.subarray(i + 30, i + 30 + tailleNom).toString('utf8'));
    i = i + 30 + tailleNom + tailleExtra + tailleCompressee;
  }
  return noms;
}

/**
 * Verification de bonne formation, suffisante pour ce que ce module produit.
 *
 * Elle empile les balises ouvrantes et exige que chaque fermeture corresponde. Ce n'est pas un
 * analyseur XML complet — il n'y en a pas dans les dependances — mais c'est ce qui attrape les
 * deux fautes reellement possibles ici : une balise oubliee, et un fragment interpole qui ouvre
 * une balise qu'il ne ferme pas.
 */
function malFormation(xml: string): string | null {
  const pile: string[] = [];
  const balise = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = balise.exec(xml)) != null) {
    const [, fermante, nom, attributs, autoFermante] = m;
    if (nom!.startsWith('?') || nom!.startsWith('!')) continue;
    if (attributs!.endsWith('/') || autoFermante === '/') continue;
    if (fermante === '/') {
      const dernier = pile.pop();
      if (dernier !== nom) return `</${nom}> ferme <${dernier ?? 'rien'}>`;
    } else {
      pile.push(nom!);
    }
  }
  return pile.length === 0 ? null : `balises non fermees : ${pile.join(', ')}`;
}

const PARTIES_ATTENDUES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'docProps/core.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/document.xml',
];

for (const filiere of FILIERES) {
  test(`LE CAHIER DES CHARGES ${filiere} EST UN .DOCX VALIDE`, () => {
    const archive = cahierDesChargesDocx(filiere);
    const parties = lireZip(archive);

    for (const p of PARTIES_ATTENDUES) {
      assert.ok(parties.has(p), `partie manquante : ${p}`);
    }
    /*
     * `[Content_Types].xml` DOIT etre la premiere entree de l'archive : c'est une exigence de la
     * specification Open Packaging Conventions, et plusieurs lecteurs refusent le paquet sinon.
     */
    assert.equal(nomsEnOrdre(archive)[0], '[Content_Types].xml');

    for (const [nom, contenu] of parties) {
      const faute = malFormation(contenu);
      assert.equal(faute, null, `${filiere} / ${nom} : ${faute ?? ''}`);
      // Caracteres de controle interdits par XML 1.0. Word refuse le document entier pour un seul.
      // eslint-disable-next-line no-control-regex
      const interdits = contenu.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
      assert.equal(interdits, null, `${filiere} / ${nom} : caractere de controle interdit`);
    }

    /*
     * Chaque partie declaree dans les types de contenu doit EXISTER, et chaque partie XML de
     * l'archive doit etre declaree. Un `Override` orphelin, ou une partie non declaree, est
     * exactement ce qui produit « le contenu pose probleme » sans autre precision.
     */
    const types = parties.get('[Content_Types].xml')!;
    for (const m of types.matchAll(/PartName="\/([^"]+)"/g)) {
      assert.ok(parties.has(m[1]!), `type de contenu declare pour une partie absente : ${m[1]}`);
    }
    assert.ok(types.includes('wordprocessingml.document.main+xml'), 'type du document principal absent');

    /*
     * CHAQUE TABLEAU PORTE SA GRILLE. `w:tblGrid` est exige par la specification Open Packaging
     * Conventions : sans lui, Word signale un contenu illisible et n'ouvre pas le document. La
     * verification de bonne formation ne le voit pas — un tableau sans grille reste du XML
     * parfaitement equilibre. C'est une mutation qui me l'a montre : elle a survecu.
     */
    const doc = parties.get('word/document.xml')!;
    const nbTableaux = (doc.match(/<w:tbl>/g) ?? []).length;
    const nbGrilles = (doc.match(/<w:tblGrid>/g) ?? []).length;
    assert.ok(nbTableaux > 0, 'le cahier des charges doit porter des tableaux');
    assert.equal(
      nbGrilles,
      nbTableaux,
      `${nbTableaux} tableaux pour ${nbGrilles} grilles : un tableau sans w:tblGrid rend le ` +
        'document illisible par Word',
    );
  });

  test(`LE CAHIER DES CHARGES ${filiere} PORTE CE QU'IL DOIT PORTER`, () => {
    const doc = lireZip(cahierDesChargesDocx(filiere)).get('word/document.xml')!;
    const meta = FILIERES_META[filiere];

    assert.ok(doc.includes(echappe(meta.libelle)), 'la filiere doit etre nommee');
    assert.ok(doc.includes('Cahier des charges'), 'le titre doit etre present');

    /*
     * LES SEPT SECTIONS. Un document remis a un tiers qui perdrait sa section reglementaire ou ses
     * reserves ne serait pas un document incomplet : il serait TROMPEUR, parce qu'il aurait
     * l'apparence de l'exhaustivite.
     */
    for (const titre of [
      'Le projet recherch',
      'Le territoire',
      'Les seuils de recherche',
      'Nature du terrain',
      'valu',
      'cadre r',
      'ne sait pas',
    ]) {
      assert.ok(doc.includes(titre), `section absente : ${titre}`);
    }

    /*
     * LA COLONNE DES IDENTIFIANTS TECHNIQUES, qui est ce qui rend le document exploitable au
     * retour. Sans elle, chaque ligne doit etre RETRADUITE de memoire vers le formulaire, et c'est
     * exactement la qu'un critere se perd.
     */
    /*
     * COMPTEE, ET NON SEULEMENT PRESENTE. Ma premiere assertion se contentait de `includes` : or
     * CINQ tableaux portent cette colonne (territoire, seuils, nature du terrain, exclusions,
     * projet). Renommer celle du tableau des SEUILS — le seul qui compte vraiment, puisque c'est
     * lui qu'on recopie grandeur par grandeur — laissait donc les quatre autres valider
     * l'assertion. La mutation a survecu et l'a montre.
     */
    const nbColonnes = (doc.match(/Grandeur dans le logiciel/g) ?? []).length;
    assert.equal(
      nbColonnes,
      5,
      `la colonne des identifiants techniques apparait ${nbColonnes} fois au lieu de 5 : un ` +
        'tableau a perdu la colonne qui rend le document recopiable sans retraduction',
    );
    for (const s of SEUILS_RECHERCHE[filiere]) {
      assert.ok(doc.includes(echappe(s.chemin)), `grandeur absente du document : ${s.chemin}`);
      assert.ok(doc.includes(echappe(s.libelle)), `libelle absent : ${s.libelle}`);
    }

    /*
     * LES DEUX RESERVES QUI ENGAGENT, et elles sont verifiees sur leur PHRASE, non sur un fragment.
     * Mes premieres assertions cherchaient `'valid'` — qui apparait dans « valeur demandee » — et
     * repetaient deux fois le meme motif dans une disjonction. Elles auraient survecu a la
     * disparition complete des deux reserves : un test decoratif sur le point le plus sensible du
     * document.
     */
    assert.ok(
      /valid&#xE9;es par un juriste|valid\u00e9es par un juriste|valid.{0,4}es par un juriste/.test(doc),
      'le nombre de regles non validees par un juriste doit etre annonce',
    );
    assert.ok(
      doc.includes('&#xE0; valider') || doc.includes('\u00e0 valider') || /&#224; valider|. valider/.test(doc),
      'les regles concernees doivent porter la mention « a valider »',
    );
    assert.ok(
      doc.includes('import') && /ne se r.{0,6}importe pas/.test(doc),
      'le document doit dire explicitement qu’il ne se reimporte pas automatiquement',
    );
  });
}

test('UN CAHIER DES CHARGES VIERGE LAISSE LES CASES VIDES', () => {
  /*
   * LA CASE DOIT RESTER REMPLISSABLE. Un tiret ou « non renseigne » invite a ecrire a cote, ou se
   * confond avec une reponse. Le test compare les deux versions du meme document : la vierge doit
   * etre STRICTEMENT plus courte, puisqu'elle ne porte aucune valeur.
   */
  const vierge = lireZip(cahierDesChargesDocx('solaire_sol')).get('word/document.xml')!;
  const rempli = lireZip(
    cahierDesChargesDocx('solaire_sol', {
      codeRegion: '24',
      codesDepartement: ['28', '45'],
      surfaceMinHa: 12,
      enZaerSeulement: true,
      seuils: [{ chemin: 'gisement.irradiationKwhM2An', min: 1300 }],
    }),
  ).get('word/document.xml')!;

  assert.ok(!vierge.includes('>24<'), 'le document vierge ne doit porter aucune valeur de critere');
  assert.ok(rempli.includes('24'), 'la region reglee doit apparaitre');
  assert.ok(rempli.includes('28, 45'), 'les departements regles doivent apparaitre');
  assert.ok(rempli.includes('1300'), 'le seuil regle doit apparaitre');
  assert.ok(rempli.includes('12'), 'la surface minimale reglee doit apparaitre');
  // Et l'en-tete change de nature : formulaire a remplir contre compte rendu de recherche.
  assert.ok(vierge.includes('remplir par le d'), 'le vierge est un formulaire a remplir');
  assert.ok(rempli.includes('recherche lanc'), 'le rempli est un compte rendu de recherche');
});

test('UN LIBELLE CONTENANT DES CARACTERES XML NE CASSE PAS LE DOCUMENT', () => {
  /*
   * LA FAUTE LA PLUS BANALE, ET LA PLUS FATALE. Les libelles de ce depot viennent de sources
   * externes — Geoportail, INPN, Legifrance — et contiennent des esperluettes (« Eau & milieux »),
   * des chevrons et des apostrophes. Un seul `&` non echappe rend le document illisible par Word.
   *
   * Le test passe par la voie normale, `criteresCourants`, qui est le seul endroit ou du texte
   * arbitraire entre dans le document.
   */
  const doc = lireZip(
    cahierDesChargesDocx('bess', { codeRegion: '<&"\'>', codesDepartement: ['A&B'] }),
  ).get('word/document.xml')!;

  assert.equal(malFormation(doc), null, 'le document doit rester bien forme');
  assert.ok(doc.includes('&amp;'), 'l’esperluette doit etre echappee');
  assert.ok(doc.includes('&lt;') && doc.includes('&gt;'), 'les chevrons doivent etre echappes');
  // Et aucune esperluette NUE ne subsiste : `&` non suivi d'une entite est ce que Word refuse.
  assert.equal(doc.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g), null, 'esperluette nue dans le document');
});

/** Echappement identique a celui du module, pour comparer ce qui est reellement ecrit. */
function echappe(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
