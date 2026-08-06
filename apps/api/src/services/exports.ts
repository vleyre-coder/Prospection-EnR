/**
 * Exports : fiche parcelle en PDF, selections en GeoJSON / Shapefile / CSV.
 *
 * Tout export est journalise (`journal_acces`) : l'application manipule des donnees de
 * prospection fonciere, dont la diffusion doit rester tracable.
 */

import PDFDocument from 'pdfkit';
import type { EvaluationCritere, Feu, ParcelleSnapshot, ResultatScore } from '@enr/core';
import {
  AVERTISSEMENTS,
  FAMILLES_LIBELLES,
  FILIERES_META,
  LIBELLES_SCORE,
  REFERENTIEL_DERNIERE_VERIFICATION,
} from '@enr/core';
import { COEFFICIENT_TRACE, formatNombre, LIBELLES_REGIME, lineaireRaccordementKm } from '@enr/scoring';
import type { ParcelleEnBase } from '../depots/parcelles.js';
import type { LigneResultatFiltre } from './recherche.js';

// ---------------------------------------------------------------------------
// PDF : rapport de qualification de parcelle
//
// Le rapport est destine a etre remis tel quel : il doit donc se lire seul, sans
// l'application. D'ou trois exigences de mise en page, qui expliquent le detour par les
// fonctions utilitaires ci-dessous plutot que des appels directs a pdfkit :
//
//   1. AUCUN texte ne doit se chevaucher. pdfkit ne gere pas la hauteur de ligne d'un
//      tableau : positionner trois colonnes a des abscisses fixes puis avancer d'une
//      hauteur constante fait deborder la premiere cellule qui passe a la ligne. La
//      hauteur de chaque rangee est donc MESUREE (`heightOfString`) avant d'ecrire.
//   2. Aucune coupure au milieu d'un bloc indivisible : `assurerPlace` provoque un saut
//      de page avant, pas apres.
//   3. Un pied de page sur chaque page, avec la pagination et l'avertissement principal.
//      Cela impose `bufferPages` : la pagination n'est connue qu'a la fin.
// ---------------------------------------------------------------------------

const COULEUR_FEU: Record<Feu, string> = {
  vert: '#16a34a',
  orange: '#d97706',
  rouge: '#dc2626',
  gris: '#9ca3af',
};

/** Teintes de fond, tres claires, pour les bandeaux et encadres. */
const FOND_FEU: Record<Feu, string> = {
  vert: '#f0fdf4',
  orange: '#fffbeb',
  rouge: '#fef2f2',
  gris: '#f8fafc',
};

const ENCRE = '#111827';
const ENCRE_FAIBLE = '#64748b';
const FILET = '#e2e8f0';

const MARGE = 42;
const HAUT = 46;
/** Reserve du pied de page : rien ne doit descendre en dessous. */
const BAS = 58;

/**
 * Assainit une chaine pour les polices PDF standard, qui ne connaissent que WinAnsi.
 *
 * Les caracteres typographiques courants sont remplaces par leur equivalent ASCII ; ce
 * qui reste hors du jeu Latin-1 est retire. Sans cela, un simple « ≥ » venu d'un libelle
 * reglementaire produit un caractere parasite au milieu d'une phrase.
 */
function net(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•●]/g, '-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/×/g, 'x')
    .replace(/[←-⇿]/g, '->')
    // Tout ce qui sort de Latin-1 est retire plutot que rendu de travers (les polices PDF
    // standard sont encodees en WinAnsi). Bornes ecrites en sequences d'echappement : la
    // version litterale contenait un octet NUL, qui rendait le fichier « binaire » pour les
    // outils de recherche et exposait la classe de caracteres a une reindentation malheureuse.
    .replace(/[^\u0000-\u00FF]/g, '');
}

/**
 * Etat de l'arrete de protection de biotope, pour le rapport.
 *
 * Trois etats a distinguer, et la nuance porte : « aucun dans le rayon analyse » est un CONSTAT,
 * « non renseigne » signale que la source n'a pas repondu. Confondre les deux ferait passer une
 * panne de connecteur pour une absence de contrainte.
 */
function libelleAppb(a: { recouvre: boolean | null; distanceM: number | null; nom: string | null }): string {
  if (a.recouvre === true) return `recouvrement${a.nom ? ` - ${a.nom}` : ''}`;
  if (a.recouvre == null) return 'non renseigne';
  if (a.distanceM == null) return 'aucun dans le rayon analyse';
  return `${Math.round(a.distanceM)} m${a.nom ? ` - ${a.nom}` : ''}`;
}

type Doc = PDFKit.PDFDocument;

function largeurUtile(doc: Doc): number {
  return doc.page.width - 2 * MARGE;
}

/** Provoque un saut de page si le bloc a venir ne tient pas entierement. */
function assurerPlace(doc: Doc, hauteur: number): void {
  if (doc.y + hauteur > doc.page.height - BAS) {
    doc.addPage();
    doc.y = HAUT;
  }
}

/**
 * `hauteurBloc` est la place a reserver pour le titre ET le debut de ce qui le suit :
 * un titre seul en bas de page, suivi d'un tableau qui commence a la page d'apres, se lit
 * mal. Par defaut, le titre plus une rangee.
 */
function titreSection(doc: Doc, texte: string, hauteurBloc = 34): void {
  assurerPlace(doc, hauteurBloc);
  doc.moveDown(0.5);
  doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#0f172a').text(net(texte).toUpperCase(), MARGE, doc.y, {
    characterSpacing: 0.6,
  });
  const y = doc.y + 2;
  doc
    .moveTo(MARGE, y)
    .lineTo(doc.page.width - MARGE, y)
    .lineWidth(0.8)
    .strokeColor('#94a3b8')
    .stroke();
  doc.y = y + 6;
  doc.fillColor(ENCRE).font('Helvetica').fontSize(9);
}

interface Colonne {
  titre: string;
  /** Part de la largeur utile, entre 0 et 1. */
  part: number;
  align?: 'left' | 'right';
}

/**
 * Tableau a hauteur de rangee calculee. `pastille` colore un point devant la premiere
 * cellule, ce qui permet de porter le feu tricolore sans colonne supplementaire.
 */
function tableau(
  doc: Doc,
  colonnes: Colonne[],
  rangees: Array<{ cellules: string[]; pastille?: Feu; gras?: boolean; sousTitre?: boolean }>,
): void {
  const total = largeurUtile(doc);
  const largeurs = colonnes.map((c) => c.part * total);
  // Abscisse de chaque colonne : marge plus la somme des largeurs precedentes.
  const xs: number[] = [];
  let curseur = MARGE;
  for (const l of largeurs) {
    xs.push(curseur);
    curseur += l;
  }

  /** Hauteur reelle d'une rangee : la plus haute de ses cellules, jamais une constante. */
  const hauteurRangee = (rangee: { cellules: string[]; pastille?: Feu; gras?: boolean }): number => {
    const decalage = rangee.pastille ? 9 : 0;
    doc.fontSize(8.4).font(rangee.gras ? 'Helvetica-Bold' : 'Helvetica');
    return (
      Math.max(
        ...rangee.cellules.map((c, i) =>
          doc.heightOfString(net(c), { width: largeurs[i]! - (i === 0 ? decalage : 0) - 6 }),
        ),
      ) + 5
    );
  };

  /** Hauteur de l'en-tete : mesuree elle aussi, un libelle long passant a la ligne. */
  const hauteurEnTete = (): number => {
    doc.fontSize(7.6).font('Helvetica-Bold');
    return (
      Math.max(
        ...colonnes.map((c, i) => doc.heightOfString(net(c.titre).toUpperCase(), { width: largeurs[i]! - 6 })),
      ) + 6
    );
  };

  const enTete = (): void => {
    const h = hauteurEnTete();
    doc.fontSize(7.6).font('Helvetica-Bold').fillColor(ENCRE_FAIBLE);
    const y = doc.y;
    colonnes.forEach((c, i) => {
      doc.text(net(c.titre).toUpperCase(), xs[i]!, y, {
        width: largeurs[i]! - 6,
        align: c.align ?? 'left',
      });
    });
    doc.y = y + h;
    doc
      .moveTo(MARGE, doc.y - 3)
      .lineTo(doc.page.width - MARGE, doc.y - 3)
      .lineWidth(0.5)
      .strokeColor(FILET)
      .stroke();
    doc.fillColor(ENCRE).font('Helvetica').fontSize(8.4);
  };

  // L'en-tete n'est trace que si la premiere rangee tient aussi : sinon il resterait
  // seul en bas de page, suivi d'un second en-tete sur la page d'apres.
  const premiere = rangees[0];
  assurerPlace(doc, hauteurEnTete() + 4 + (premiere ? hauteurRangee(premiere) : 16));
  enTete();

  let alterne = false;
  for (const rangee of rangees) {
    const decalage = rangee.pastille ? 9 : 0;
    const hauteur = hauteurRangee(rangee);

    if (doc.y + hauteur > doc.page.height - BAS) {
      doc.addPage();
      doc.y = HAUT;
      enTete();
      doc.fontSize(8.4).font(rangee.gras ? 'Helvetica-Bold' : 'Helvetica');
    }

    const y = doc.y;
    if (rangee.sousTitre) {
      // Un sous-titre de famille se lit comme un intercalaire, pas comme une donnee :
      // fond marque, et il ne participe pas a l'alternance des rangees.
      doc.rect(MARGE - 3, y - 2, total + 6, hauteur).fill('#eef2f7');
      doc.fillColor(ENCRE);
      alterne = false;
    } else {
      if (alterne) {
        doc.rect(MARGE - 3, y - 2, total + 6, hauteur).fill('#f8fafc');
        doc.fillColor(ENCRE);
      }
      alterne = !alterne;
    }
    doc.fontSize(8.4).font(rangee.gras ? 'Helvetica-Bold' : 'Helvetica');

    if (rangee.pastille) {
      doc.circle(MARGE + 3, y + 4.4, 2.7).fill(COULEUR_FEU[rangee.pastille]);
      doc.fillColor(ENCRE);
    }

    rangee.cellules.forEach((c, i) => {
      doc.text(net(c), xs[i]! + (i === 0 ? decalage : 0), y, {
        width: largeurs[i]! - (i === 0 ? decalage : 0) - 6,
        align: colonnes[i]?.align ?? 'left',
      });
    });

    doc.y = y + hauteur;
    doc.fillColor(ENCRE);
  }
  doc.moveDown(0.2);
}

/** Grille cle / valeur sur deux paires par rangee : compact et lisible. */
function grilleCles(doc: Doc, entrees: Array<[string, string]>): void {
  const total = largeurUtile(doc);
  const colonne = total / 2;
  const largeurCle = colonne * 0.42;
  const largeurValeur = colonne * 0.58 - 8;

  for (let i = 0; i < entrees.length; i += 2) {
    const paire = [entrees[i], entrees[i + 1]].filter((e): e is [string, string] => e != null);
    doc.fontSize(8.4);
    const hauteur =
      Math.max(
        ...paire.map(([cle, valeur]) =>
          Math.max(
            doc.heightOfString(net(cle), { width: largeurCle }),
            doc.heightOfString(net(valeur) || '-', { width: largeurValeur }),
          ),
        ),
      ) + 4;

    assurerPlace(doc, hauteur);
    const y = doc.y;
    paire.forEach(([cle, valeur], j) => {
      const x = MARGE + j * colonne;
      doc.font('Helvetica').fillColor(ENCRE_FAIBLE).text(net(cle), x, y, { width: largeurCle });
      doc
        .font('Helvetica-Bold')
        .fillColor(ENCRE)
        .text(net(valeur) || '-', x + largeurCle, y, { width: largeurValeur });
    });
    doc.y = y + hauteur;
  }
  doc.font('Helvetica').fillColor(ENCRE);
  doc.moveDown(0.2);
}

/** Encadre colore autour d'un texte : hauteur mesuree avant trace, sinon pas de cadre. */
function encadre(doc: Doc, feu: Feu, titre: string, corps: string[]): void {
  const total = largeurUtile(doc);
  const largeur = total - 20;
  doc.fontSize(9).font('Helvetica-Bold');
  let hauteur = doc.heightOfString(net(titre), { width: largeur }) + 2;
  doc.fontSize(8.2).font('Helvetica');
  for (const c of corps) hauteur += doc.heightOfString(net(c), { width: largeur }) + 2;
  hauteur += 14;

  assurerPlace(doc, hauteur);
  const y = doc.y;
  doc.roundedRect(MARGE, y, total, hauteur, 3).fillAndStroke(FOND_FEU[feu], COULEUR_FEU[feu]);
  doc.fillColor(COULEUR_FEU[feu]).fontSize(9).font('Helvetica-Bold').text(net(titre), MARGE + 10, y + 7, {
    width: largeur,
  });
  doc.fillColor('#1f2937').fontSize(8.2).font('Helvetica');
  for (const c of corps) doc.text(net(c), MARGE + 10, doc.y + 1, { width: largeur });
  doc.y = y + hauteur + 6;
  doc.fillColor(ENCRE);
}

const dateFr = (v: string | Date | null | undefined): string =>
  v == null ? '-' : new Date(v).toLocaleDateString('fr-FR');

const nb = (v: number | null | undefined, unite = '', decimales = 0): string =>
  v == null ? '-' : `${v.toFixed(decimales).replace('.', ',')}${unite ? ` ${unite}` : ''}`;

const ouiNon = (v: boolean | null | undefined): string =>
  v == null ? 'non renseigne' : v ? 'oui' : 'non';

/**
 * Culture RPG, en distinguant l'absence de declaration de l'absence de donnee.
 *
 * Ecrire « aucune declaration » quand le RPG n'a pas repondu est une affirmation de fait
 * tiree d'un vide : sur un rapport transmis a un proprietaire ou a un exploitant, c'est
 * une erreur opposable. `anneesDeclareesConsecutives` vaut `null` dans ce cas precis, et
 * `0` lorsque le RPG a bien repondu sans declaration sur la parcelle.
 */
export const libelleRpg = (rpg: ParcelleSnapshot['occupationSol']['rpg']): string => {
  if (rpg.libelleCulture) return rpg.libelleCulture;
  if (rpg.anneesDeclareesConsecutives == null) return 'non renseigne (RPG non consulte)';
  return 'aucune declaration PAC';
};

export function ficheParcellePdf(
  parcelle: ParcelleEnBase,
  snapshot: ParcelleSnapshot,
  score: ResultatScore,
  /**
   * Connecteurs en echec au moment du calcul. Porte a cote du snapshot et non dedans :
   * c'est une information sur la collecte, pas sur la parcelle. Le rapport doit la
   * mentionner, sans quoi des criteres gris passeraient pour des absences de contrainte.
   */
  connecteursEnEchec: string[] = [],
): NodeJS.ReadableStream {
  const meta = FILIERES_META[score.filiere];
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: HAUT, bottom: BAS, left: MARGE, right: MARGE },
    // Necessaire pour paginer : le nombre total de pages n'est connu qu'a la fin.
    bufferPages: true,
    info: {
      Title: `Rapport de qualification ${parcelle.idu} - ${meta.libelleCourt}`,
      Author: 'Prospection EnR',
      Subject: `Parcelle ${parcelle.idu}, filiere ${meta.libelle}`,
    },
  });

  const total = largeurUtile(doc);
  const surfaceHa = (parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000;

  // ===================================================================== tete
  doc.fontSize(7.8).font('Helvetica-Bold').fillColor(ENCRE_FAIBLE);
  doc.text('PROSPECTION ENR - RAPPORT DE QUALIFICATION FONCIERE', MARGE, HAUT, {
    characterSpacing: 0.8,
  });
  doc.fontSize(19).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text(net(`${parcelle.nomCommune ?? parcelle.codeInsee} - parcelle ${parcelle.section} ${parcelle.numero}`), MARGE, doc.y + 4);
  doc.fontSize(10).font('Helvetica').fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      `Filiere etudiee : ${meta.libelle}  -  IDU ${parcelle.idu}  -  ${surfaceHa.toFixed(2).replace('.', ',')} ha  -  rapport du ${dateFr(new Date())}`,
    ),
    MARGE,
    doc.y + 2,
  );
  doc.y += 10;

  // ============================================================== verdict
  // Colonne de droite du bandeau : les libelles de regime peuvent passer a la ligne, donc
  // la hauteur du bandeau est deduite de leur hauteur reelle au lieu d'etre fixee.
  const infos = [
    `Couverture des donnees : ${Math.round(score.couvertureDonnees * 100)} %`,
    score.regimeImplantation
      ? `Regime : ${LIBELLES_REGIME[score.regimeImplantation] ?? score.regimeImplantation}`
      : "Regime d'implantation non determine",
    `Calcul du ${dateFr(score.dateCalcul)} - moteur ${score.versionMoteur}`,
  ];
  const largeurInfos = total * 0.34 - 16;
  doc.fontSize(8.4).font('Helvetica');
  const hInfos = infos.reduce((s, t) => s + doc.heightOfString(net(t), { width: largeurInfos }) + 2, 0);
  const hVerdict = Math.max(62, hInfos + 18);

  assurerPlace(doc, hVerdict);
  const yv = doc.y;
  doc.roundedRect(MARGE, yv, total, hVerdict, 4).fill(COULEUR_FEU[score.statut]);
  doc.fillColor('#ffffff');
  doc
    .fontSize(28)
    .font('Helvetica-Bold')
    .text(score.scoreGlobal != null ? `${score.scoreGlobal.toFixed(0)}` : '--', MARGE + 14, yv + 10, {
      width: 76,
    });
  doc.fontSize(9).font('Helvetica').text(score.scoreGlobal != null ? 'sur 100' : 'ecartee', MARGE + 16, yv + 42);
  doc.fontSize(13).font('Helvetica-Bold').text(net(LIBELLES_SCORE[score.statut]), MARGE + 100, yv + 13, {
    width: total * 0.42,
  });
  doc.fontSize(8.6).font('Helvetica').text(
    net(
      score.knockOuts.length > 0
        ? `${score.knockOuts.length} critere(s) redhibitoire(s) declenche(s)`
        : `Critere determinant : ${meta.critereRoi}`,
    ),
    MARGE + 100,
    yv + 32,
    { width: total * 0.42 },
  );
  const xd = MARGE + total * 0.66;
  doc.fontSize(8.4).font('Helvetica');
  doc.y = yv + 9;
  for (const info of infos) {
    doc.text(net(info), xd, doc.y, { width: largeurInfos, align: 'right' });
    doc.y += 2;
  }
  doc.fillColor(ENCRE);
  doc.y = yv + hVerdict + 8;

  // ==================================================== criteres redhibitoires
  if (score.knockOuts.length > 0) {
    titreSection(doc, 'Criteres redhibitoires');
    for (const k of score.knockOuts) {
      encadre(doc, k.derogeable ? 'orange' : 'rouge', `${k.derogeable ? 'Derogeable' : 'Bloquant'} - ${k.libelle}`, [
        k.motif,
        ...(k.regleLiee ? [`Fondement : ${k.regleLiee}`] : []),
      ]);
    }
  }

  // ============================================================ limites
  if (score.limitesViabilite.length > 0) {
    titreSection(doc, 'Limites de viabilite economique');
    tableau(
      doc,
      [
        { titre: 'Limite', part: 0.4 },
        { titre: 'Constat', part: 0.6 },
      ],
      score.limitesViabilite.map((l) => ({
        cellules: [l.libelle, l.motif],
        pastille: l.statutMaximal,
      })),
    );
  }

  // =========================================================== synthese
  titreSection(doc, 'Synthese');
  if (score.pointsForts.length === 0 && score.pointsVigilance.length === 0) {
    doc.fontSize(8.6).fillColor(ENCRE_FAIBLE).text('Aucun point saillant : tous les criteres evalues sont dans la moyenne.', MARGE, doc.y, { width: total });
    doc.fillColor(ENCRE);
  } else {
    const lignes: Array<{ cellules: string[]; pastille?: Feu }> = [
      ...score.pointsForts.map((p) => ({ cellules: ['Atout', p.libelle, p.valeur], pastille: 'vert' as Feu })),
      ...score.pointsVigilance.map((p) => ({
        cellules: ['Vigilance', p.libelle, p.valeur],
        pastille: 'orange' as Feu,
      })),
    ];
    tableau(
      doc,
      [
        { titre: 'Nature', part: 0.16 },
        { titre: 'Critere', part: 0.44 },
        { titre: 'Valeur mesuree', part: 0.4 },
      ],
      lignes,
    );
  }

  // ================================================= carte d'identite
  titreSection(doc, 'Carte d\'identite de la parcelle');
  const urba = snapshot.urbanisme;
  const zonagePrincipal = [...urba.zonages].sort((a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0))[0];
  grilleCles(doc, [
    ['Commune', `${parcelle.nomCommune ?? '-'} (${parcelle.codeInsee})`],
    ['Departement', snapshot.identite.codeDepartement || parcelle.codeInsee.slice(0, 2)],
    ['Section / numero', `${parcelle.section} ${parcelle.numero}`],
    ['Identifiant (IDU)', parcelle.idu],
    ['Contenance cadastrale', nb(parcelle.contenanceM2 != null ? parcelle.contenanceM2 / 10000 : null, 'ha', 2)],
    ['Surface calculee', nb(parcelle.surfaceCalculeeM2 != null ? parcelle.surfaceCalculeeM2 / 10000 : null, 'ha', 2)],
    [
      'Coordonnees (WGS84)',
      // EXCEPTION AU SEPARATEUR FRANCAIS, deliberee : la paire est deja separee par une
      // virgule, donc « 48,15000 N, 1,75000 E » serait ambigu. Et ces coordonnees sont faites
      // pour etre recopiees dans un outil cartographique, qui attend le point decimal.
      snapshot.identite.centroide
        ? `${snapshot.identite.centroide[1].toFixed(5)} N, ${snapshot.identite.centroide[0].toFixed(5)} E`
        : '-',
    ],
    ['Document d\'urbanisme', urba.typeDocument ?? (urba.couvertParGpu === false ? 'non publie au GPU' : 'non renseigne')],
    ['Zonage dominant', zonagePrincipal ? `${zonagePrincipal.libelle ?? '-'} (${zonagePrincipal.typeZone ?? '?'})` : 'non renseigne'],
    ['Occupation du sol', snapshot.occupationSol.typeSol ?? 'non determinee'],
    ['Culture declaree (RPG)', libelleRpg(snapshot.occupationSol.rpg)],
    ['Pente moyenne', nb(snapshot.topographie.pentePct, '%', 1)],
    ['Altitude', nb(snapshot.topographie.altitudeM, 'm')],
    ['Denivele', nb(snapshot.topographie.deniveleM, 'm')],
    ['Habitation la plus proche', nb(snapshot.bati.distanceHabitationM, 'm')],
    ['Zone d\'acceleration ENR', urba.zaer.present == null ? 'non renseigne' : ouiNon(urba.zaer.present)],
    // L'arrete de protection de biotope figurait dans l'interface et PAS dans le rapport : un
    // APPB a 200 m etait visible a l'ecran et absent du document transmis. Or c'est une
    // protection absolue (art. R.411-15 du code de l'environnement), non derogeable par une
    // modification du document d'urbanisme : elle ne peut pas manquer au livrable. Un
    // recouvrement, lui, declenche un knock-out et apparait deja en tete de rapport.
    ['Protection de biotope (APPB)', libelleAppb(snapshot.milieux.appb)],
  ]);
  if (zonagePrincipal?.urlReglement) {
    doc.fontSize(7.6).fillColor(ENCRE_FAIBLE).text(net(`Reglement applicable : ${zonagePrincipal.urlReglement}`), MARGE, doc.y, { width: total });
    doc.fillColor(ENCRE);
  }

  // =============================================================== raccordement
  const racc = snapshot.raccordement;
  const gazRenseigne =
    racc.reseauGaz.distanceCanalisationKm != null || racc.reseauGaz.distanceSiteInjectionKm != null;
  if (racc.posteLePlusProche || racc.postesAlternatifs.length > 0 || gazRenseigne) {
    titreSection(doc, 'Raccordement');
    const postes = [racc.posteLePlusProche, ...racc.postesAlternatifs].filter(
      (p): p is NonNullable<typeof p> => p != null,
    );
    if (postes.length > 0) {
      tableau(
        doc,
        [
          { titre: 'Poste source', part: 0.24 },
          { titre: 'Gestionnaire', part: 0.12 },
          // Deux colonnes et non une : la synthese raisonne sur le trace estime, et un
          // tableau qui n'affichait que le vol d'oiseau faisait se contredire le rapport
          // avec lui-meme (5,7 km en synthese, 4,2 km ici, sans mention du coefficient).
          { titre: 'Vol d\'oiseau', part: 0.11, align: 'right' },
          { titre: 'Trace estime', part: 0.11, align: 'right' },
          { titre: 'Capacite', part: 0.11, align: 'right' },
          { titre: 'Saturation', part: 0.13 },
          { titre: 'Renforcement', part: 0.18 },
        ],
        postes.map((p) => ({
          cellules: [
            p.nom,
            p.gestionnaire,
            nb(p.distanceKm, 'km', 1),
            p.distanceKm == null ? '-' : nb(lineaireRaccordementKm(p.distanceKm), 'km', 1),
            p.capaciteResiduelleMw != null ? nb(p.capaciteResiduelleMw, 'MW', 1) : 'inconnue',
            p.etatSaturation ?? 'non renseigne',
            p.renforcement.prevu
              ? `prevu ${p.renforcement.horizon ?? ''} ${p.renforcement.capaciteAttendueMw != null ? `(+${nb(p.renforcement.capaciteAttendueMw, 'MW', 0)})` : ''}`.trim()
              : p.renforcement.prevu === false
                ? 'aucun'
                : 'non renseigne',
          ],
          pastille:
            p.etatSaturation === 'disponible'
              ? 'vert'
              : p.etatSaturation === 'tendu'
                ? 'orange'
                : p.etatSaturation === 'sature'
                  ? 'rouge'
                  : 'gris',
        })),
      );
      // Sans cette ligne, le lecteur ne peut pas reconcilier les deux colonnes ni savoir
      // laquelle la synthese et le score utilisent.
      doc
        .fontSize(7.6)
        .fillColor(ENCRE_FAIBLE)
        .text(
          net(
            `Trace estime = vol d'oiseau majore de ${Math.round((COEFFICIENT_TRACE - 1) * 100)} % ` +
              '(contournement du parcellaire et de la voirie). C\'est cette valeur qui est notee ' +
              'dans la synthese ; elle ne remplace pas une etude de trace.',
          ),
          MARGE,
          doc.y + 2,
          { width: total },
        );
      doc.fillColor(ENCRE);
      doc.y += 4;
    }
    if (gazRenseigne) {
      grilleCles(doc, [
        // Les deux distances sont nommees pour ce qu'elles sont (audit 8, E5) : la canalisation
        // gouverne le raccordement, le site d'injection existant n'est qu'un indicateur de
        // territoire. Les confondre penalisait la methanisation de plusieurs kilometres.
        [
          'Canalisation de gaz la plus proche',
          racc.reseauGaz.distanceCanalisationKm != null
            ? nb(racc.reseauGaz.distanceCanalisationKm, 'km', 1)
            : 'trace non ingere - a demander a GRDF / GRTgaz',
        ],
        [
          'Site d\'injection existant le plus proche',
          racc.reseauGaz.distanceSiteInjectionKm != null
            ? `${nb(racc.reseauGaz.distanceSiteInjectionKm, 'km', 1)} (indicateur de filiere, non une distance de raccordement)`
            : 'aucun recense',
        ],
        ['Gestionnaire', racc.reseauGaz.gestionnaire ?? 'non renseigne'],
        ['Rebours necessaire', ouiNon(racc.reseauGaz.reboursNecessaire)],
        [
          'Capacite d\'injection',
          racc.reseauGaz.capaciteInjectionNm3h != null
            ? nb(racc.reseauGaz.capaciteInjectionNm3h, 'Nm3/h', 0)
            : 'non publiee',
        ],
      ]);
    }
  }

  // ================================================= seuils de procedure
  if (score.seuilsProcedure.length > 0) {
    titreSection(doc, 'Seuils de procedure applicables');
    tableau(
      doc,
      [
        { titre: 'Procedure', part: 0.46 },
        { titre: 'Applicable', part: 0.14 },
        { titre: 'Fondement et date d\'entree en vigueur', part: 0.4 },
      ],
      score.seuilsProcedure.map((s) => ({
        cellules: [
          s.libelle,
          s.applicable === true ? 'oui' : s.applicable === false ? 'non' : 'a verifier',
          `${s.reference} - depuis le ${s.dateEntreeEnVigueur}`,
        ],
        pastille: s.applicable === true ? 'orange' : s.applicable === false ? 'vert' : 'gris',
      })),
    );
  }

  // ============================================ detail des criteres
  // Le detail est long : on reserve de quoi loger le titre, sa note de lecture, l'en-tete
  // du tableau et ses premieres rangees, sinon la section s'ouvre en fin de page pour rien.
  titreSection(doc, 'Detail des criteres evalues', 140);
  doc.fontSize(8).fillColor(ENCRE_FAIBLE).text(
    net(
      'La pastille porte le feu du critere. Une pastille grise signale une donnee indisponible : ' +
        'le critere n\'est alors pas note et ne participe pas au score, ce qui abaisse la couverture des donnees.',
    ),
    MARGE,
    doc.y,
    { width: total },
  );
  doc.fillColor(ENCRE).moveDown(0.4);

  const parFamille = new Map<string, EvaluationCritere[]>();
  for (const c of score.criteres) {
    parFamille.set(c.famille, [...(parFamille.get(c.famille) ?? []), c]);
  }
  const rangees: Array<{ cellules: string[]; pastille?: Feu; gras?: boolean; sousTitre?: boolean }> = [];
  for (const [famille, criteres] of parFamille) {
    rangees.push({
      cellules: [FAMILLES_LIBELLES[famille as keyof typeof FAMILLES_LIBELLES] ?? famille, '', '', ''],
      gras: true,
      sousTitre: true,
    });
    for (const c of criteres) {
      rangees.push({
        cellules: [
          c.libelle,
          c.valeurAffichee || '-',
          c.note != null ? c.note.toFixed(0) : 'non evalue',
          // Separateur decimal francais : le rapport est destine a des lecteurs francophones,
          // et `toFixed` produit un point. `formatNombre` est la seule mise en forme du projet.
          formatNombre(c.poids * 100, '%'),
        ],
        pastille: c.feu,
      });
    }
  }
  tableau(
    doc,
    [
      { titre: 'Critere', part: 0.38 },
      { titre: 'Valeur mesuree', part: 0.38 },
      { titre: 'Note /100', part: 0.12, align: 'right' },
      { titre: 'Poids', part: 0.12, align: 'right' },
    ],
    rangees,
  );

  // ============================================== commentaires des criteres
  const commentes = score.criteres.filter((c) => c.commentaire);
  if (commentes.length > 0) {
    titreSection(doc, 'Precisions par critere', 90);
    tableau(
      doc,
      [
        { titre: 'Critere', part: 0.3 },
        { titre: 'Precision', part: 0.7 },
      ],
      commentes.map((c) => ({ cellules: [c.libelle, c.commentaire ?? ''], pastille: c.feu })),
    );
  }

  // ===================================================== sources
  titreSection(doc, 'Sources et fraicheur des donnees');
  const sources = Object.values(snapshot.sources);
  tableau(
    doc,
    [
      { titre: 'Source', part: 0.42 },
      { titre: 'Millesime', part: 0.14 },
      { titre: 'Interrogee le', part: 0.16 },
      { titre: 'Valeur juridique', part: 0.28 },
    ],
    sources.map((s) => ({
      cellules: [
        s.nom,
        s.millesime ?? '-',
        dateFr(s.dateInterrogation),
        s.valeurJuridique === 'opposable'
          ? 'opposable'
          : s.valeurJuridique === 'pre_reperage'
            ? 'pre-reperage, a confirmer'
            : 'indicative',
      ],
      pastille: s.valeurJuridique === 'opposable' ? 'vert' : s.valeurJuridique === 'indicative' ? 'orange' : 'gris',
    })),
  );
  if (connecteursEnEchec.length > 0) {
    encadre(doc, 'gris', 'Sources non interrogeables au moment du calcul', [
      `${connecteursEnEchec.join(', ')}. Les criteres qui en dependent sont restes non evalues. ` +
        'Relancer la qualification de la parcelle permettra de les completer.',
    ]);
  }

  // ============================================= avertissements
  titreSection(doc, 'Avertissements - a lire avant tout usage');
  for (const a of AVERTISSEMENTS.filter((x) => x.portee === 'global')) {
    assurerPlace(doc, 26);
    doc.fontSize(8.4).font('Helvetica-Bold').fillColor('#0f172a').text(net(a.titre), MARGE, doc.y, { width: total });
    doc.fontSize(8).font('Helvetica').fillColor('#334155').text(net(a.texte), MARGE, doc.y + 1, {
      width: total,
      align: 'justify',
    });
    doc.moveDown(0.35);
  }
  assurerPlace(doc, 30);
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE).text(
    net(
      `Referentiel reglementaire verifie le ${REFERENTIEL_DERNIERE_VERIFICATION}. Moteur de scoring version ${score.versionMoteur}. ` +
        'Le contour cadastral est issu du Plan Cadastral Informatise : il est indicatif et sans valeur juridique. ' +
        'Seul un document d\'arpentage etabli par un geometre-expert fait foi.',
    ),
    MARGE,
    doc.y,
    { width: total, align: 'justify' },
  );

  // ==================================================== pieds de page
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    // Le pied de page s'ecrit volontairement SOUS la marge basse. pdfkit interprete une
    // ecriture au-dela de cette marge comme un debordement et ajoute une page : annuler la
    // marge le temps du trace evite de tripler le document.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc
      .moveTo(MARGE, y - 6)
      .lineTo(doc.page.width - MARGE, y - 6)
      .lineWidth(0.5)
      .strokeColor(FILET)
      .stroke();
    doc.fontSize(7).font('Helvetica').fillColor(ENCRE_FAIBLE);
    doc.text(
      net(`Prospection EnR - aide a la decision, pas une garantie de faisabilite - parcelle ${parcelle.idu}`),
      MARGE,
      y,
      { width: total * 0.75, lineBreak: false },
    );
    doc.text(`${i + 1} / ${pages.count}`, MARGE + total * 0.75, y, {
      width: total * 0.25,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return doc;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** CSV a separateur point-virgule, avec BOM UTF-8 : ouverture directe dans Excel FR. */
export function csvResultats(lignes: LigneResultatFiltre[]): string {
  const entetes = [
    'IDU',
    'Commune',
    'Section',
    'Numero',
    'Surface (ha)',
    'Statut score',
    'Ecartee reglementairement',
    'Score global',
    'Statut prospection',
    'Vol d\'oiseau poste source (km)',
    'Trace estime poste source (km)',
    'Pente (%)',
    'Type de sol',
    'Longitude',
    'Latitude',
  ];
  const echapper = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  };
  const nombre = (n: number | null): string => (n == null ? '' : String(n).replace('.', ','));

  const corps = lignes.map((l) =>
    [
      l.idu,
      l.nomCommune,
      l.section,
      l.numero,
      nombre(l.surfaceHa),
      l.statutScore,
      // Le statut seul ne distingue pas un score faible d'une exclusion reglementaire :
      // les deux valent 'rouge'. La colonne dediee evite de relire la fiche pour trancher.
      l.nbKnockOutsBloquants > 0 ? 'oui' : 'non',
      nombre(l.scoreGlobal),
      l.statutProspection,
      nombre(l.distancePosteKm),
      nombre(l.lineaireRaccordementKm),
      nombre(l.pentePct),
      l.typeSol,
      nombre(l.centroide[0]),
      nombre(l.centroide[1]),
    ]
      .map(echapper)
      .join(';'),
  );

  return `﻿${entetes.join(';')}\n${corps.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

export function geojsonParcelles(
  parcelles: Array<{ parcelle: ParcelleEnBase; score: ResultatScore | null }>,
): unknown {
  return {
    type: 'FeatureCollection',
    // Le CRS est implicitement WGS84 en GeoJSON (RFC 7946) : on documente la provenance.
    metadata: {
      producteur: 'Prospection EnR',
      dateExport: new Date().toISOString(),
      avertissement:
        "Contours issus du Plan Cadastral Informatise : indicatifs, sans valeur juridique. Scores fournis a titre d'aide a la decision.",
    },
    features: parcelles.map(({ parcelle, score }) => ({
      type: 'Feature',
      geometry: parcelle.geometrie,
      properties: {
        idu: parcelle.idu,
        code_insee: parcelle.codeInsee,
        nom_commune: parcelle.nomCommune,
        section: parcelle.section,
        numero: parcelle.numero,
        surface_ha:
          Math.round(((parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000) * 100) / 100,
        filiere: score?.filiere ?? null,
        statut_score: score?.statut ?? null,
        score_global: score?.scoreGlobal ?? null,
        couverture_donnees: score?.couvertureDonnees ?? null,
        nb_knock_outs: score?.knockOuts.length ?? null,
        nb_ko_bloquants: score?.knockOuts.filter((k) => !k.derogeable).length ?? null,
        regime_implantation: score?.regimeImplantation ?? null,
        knock_outs: score?.knockOuts.map((k) => k.libelle).join(' | ') ?? null,
      },
    })),
  };
}
