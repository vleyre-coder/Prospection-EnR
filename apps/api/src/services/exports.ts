/**
 * Exports : fiche parcelle en PDF, selections en GeoJSON / Shapefile / CSV.
 *
 * Tout export est journalise (`journal_acces`) : l'application manipule des donnees de
 * prospection fonciere, dont la diffusion doit rester tracable.
 */

import PDFDocument from 'pdfkit';
import type {
  EvaluationCritere,
  Feu,
  Filiere,
  ParcelleSnapshot,
  ResultatScore,
  StatutProspection,
} from '@enr/core';
import {
  AVERTISSEMENTS,
  FAMILLES_LIBELLES,
  FILIERES_META,
  LIBELLES_SCORE,
  LIBELLE_REDHIBITOIRE,
  REFERENTIEL_DERNIERE_VERIFICATION,
  REGLES_PAR_ID,
  STATUTS_PROSPECTION_META,
} from '@enr/core';
import {
  COEFFICIENT_TRACE,
  formatNombre,
  LIBELLES_REGIME,
  LIBELLES_TYPE_SOL,
  lineaireRaccordementKm,
  puissanceEstimee,
  surfaceUtileSiteHa,
  verificationsAvantContact,
} from '@enr/scoring';
import { reparerDoubleEncodage } from '../texte.js';
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
  /*
   * LA DERNIERE LIGNE DE DEFENSE CONTRE UN DOUBLE ENCODAGE, et elle est necessaire MEME si la
   * reparation est faite a l'ingestion.
   *
   * Le correctif de fond vit dans le connecteur GPU : les libelles y sont repares en arrivant. Mais
   * les instantanes DEJA EN BASE portent le texte casse jusqu'a leur prochain enrichissement, qui
   * peut etre a trente jours. Entre-temps, ces libelles partent dans des documents remis a des
   * tiers, ou « ChÃ¢teau de VilleprÃ©vost » fait douter du reste du document.
   *
   * Reparer AVANT le nettoyage Latin-1, et non apres : `net` retire tout ce qui sort de Latin-1, ce
   * qui ne casserait rien ici mais empecherait la reparation de reconnaitre sa propre trace.
   */
  return reparerDoubleEncodage(String(s))
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
 * Etat d'un zonage naturel (APPB, Natura 2000, ZNIEFF...), pour les documents remis.
 *
 * Trois etats a distinguer, et la nuance porte : « aucun dans le rayon analyse » est un CONSTAT,
 * « non renseigne » signale que la source n'a pas repondu. Confondre les deux ferait passer une
 * panne de connecteur pour une absence de contrainte.
 */
function libelleZonage(a: { recouvre: boolean | null; distanceM: number | null; nom: string | null }): string {
  if (a.recouvre === true) return `recouvrement${a.nom ? ` - ${a.nom}` : ''}`;
  if (a.recouvre == null) return 'non renseigné';
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
  v == null ? 'non renseigné' : v ? 'oui' : 'non';

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
  if (rpg.anneesDeclareesConsecutives == null) return 'non renseigné (RPG non consulté)';
  return 'aucune déclaration PAC';
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
      Subject: `Parcelle ${parcelle.idu}, filière ${meta.libelle}`,
    },
  });

  const total = largeurUtile(doc);
  const surfaceHa = (parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000;

  // ===================================================================== tete
  doc.fontSize(7.8).font('Helvetica-Bold').fillColor(ENCRE_FAIBLE);
  doc.text('PROSPECTION ENR - RAPPORT DE QUALIFICATION FONCIÈRE', MARGE, HAUT, {
    characterSpacing: 0.8,
  });
  doc.fontSize(19).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text(net(`${parcelle.nomCommune ?? parcelle.codeInsee} - parcelle ${parcelle.section} ${parcelle.numero}`), MARGE, doc.y + 4);
  doc.fontSize(10).font('Helvetica').fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      `Filière étudiée : ${meta.libelle}  -  IDU ${parcelle.idu}  -  ${surfaceHa.toFixed(2).replace('.', ',')} ha  -  rapport du ${dateFr(new Date())}`,
    ),
    MARGE,
    doc.y + 2,
  );
  doc.y += 10;

  // ============================================================== verdict
  // Colonne de droite du bandeau : les libelles de regime peuvent passer a la ligne, donc
  // la hauteur du bandeau est deduite de leur hauteur reelle au lieu d'etre fixee.
  const infos = [
    `Couverture des données : ${Math.round(score.couvertureDonnees * 100)} %`,
    score.regimeImplantation
      ? `Régime : ${LIBELLES_REGIME[score.regimeImplantation] ?? score.regimeImplantation}`
      : "Régime d'implantation non déterminé",
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
        ? `${score.knockOuts.length} critère(s) rédhibitoire(s) déclenché(s)`
        : `Critère déterminant : ${meta.critereRoi}`,
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
    titreSection(doc, 'Critères rédhibitoires');
    for (const k of score.knockOuts) {
      /**
       * Le FONDEMENT, pas son identifiant technique.
       *
       * Le rapport ecrivait « Fondement : eol_distance_habitation » — une cle de code, dans le
       * document qu'un prospecteur remet a un proprietaire pour lui expliquer pourquoi sa parcelle
       * est ecartee. La fiche, elle, resout la meme cle contre le referentiel et affiche
       * « Code de l'environnement, art. L.515-44 · en vigueur depuis le … ». Les deux livrables ne
       * disaient donc pas la meme chose, et c'est le rapport qui disait la moins utile des deux.
       *
       * Trouve en relisant un rapport par filiere (audit 10, risque F2) : le cas n'apparait que sur
       * une parcelle ECARTEE, et la seule relecture faite jusque-la portait sur une parcelle qui ne
       * l'etait pas.
       */
      const regle = k.regleLiee ? REGLES_PAR_ID[k.regleLiee] : undefined;
      /**
       * UNE REFERENCE NON RELUE PAR UN JURISTE LE DIT, dans le document lui-meme.
       *
       * Onze knock-outs ecartaient une parcelle sans citer aucun texte ; les references qui comblent ce
       * vide ont ete redigees a la demande du proprietaire, mais sans relecture juridique. Les imprimer
       * comme les autres reviendrait a affirmer une verification qui n'a pas eu lieu — dans le document
       * meme que le prospecteur remet au proprietaire pour justifier un refus.
       */
      const fondement = regle
        ? `Fondement : ${regle.reference} (en vigueur depuis le ${dateFr(regle.dateEntreeEnVigueur)})` +
          (regle.aValiderParJuriste ? ' - référence à faire valider par un juriste' : '')
        : k.regleLiee
          ? `Fondement : ${k.regleLiee}`
          : null;
      encadre(doc, k.derogeable ? 'orange' : 'rouge', `${k.derogeable ? 'Dérogeable' : 'Bloquant'} - ${k.libelle}`, [
        k.motif,
        ...(fondement ? [fondement] : []),
      ]);
    }
  }

  // ============================================================ limites
  if (score.limitesViabilite.length > 0) {
    titreSection(doc, 'Limites de viabilité économique');
    tableau(
      doc,
      [
        { titre: 'Facteur limitant', part: 0.4 },
        { titre: 'Constat', part: 0.6 },
      ],
      score.limitesViabilite.map((l) => ({
        cellules: [l.libelle, l.motif],
        pastille: l.statutMaximal,
      })),
    );
  }

  // =========================================================== synthese
  titreSection(doc, 'Synthèse');
  if (score.pointsForts.length === 0 && score.pointsVigilance.length === 0) {
    doc.fontSize(8.6).fillColor(ENCRE_FAIBLE).text('Aucun point saillant : tous les critères évalués sont dans la moyenne.', MARGE, doc.y, { width: total });
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
        { titre: 'Critère', part: 0.44 },
        { titre: 'Valeur mesurée', part: 0.4 },
      ],
      lignes,
    );
  }

  // ================================================= carte d'identite
  titreSection(doc, 'Carte d\'identité de la parcelle');
  const urba = snapshot.urbanisme;
  const zonagePrincipal = [...urba.zonages].sort((a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0))[0];
  grilleCles(doc, [
    ['Commune', `${parcelle.nomCommune ?? '-'} (${parcelle.codeInsee})`],
    ['Département', snapshot.identite.codeDepartement || parcelle.codeInsee.slice(0, 2)],
    ['Section / numéro', `${parcelle.section} ${parcelle.numero}`],
    ['Identifiant (IDU)', parcelle.idu],
    ['Contenance cadastrale', nb(parcelle.contenanceM2 != null ? parcelle.contenanceM2 / 10000 : null, 'ha', 2)],
    ['Surface calculée', nb(parcelle.surfaceCalculeeM2 != null ? parcelle.surfaceCalculeeM2 / 10000 : null, 'ha', 2)],
    [
      'Coordonnées (WGS84)',
      // EXCEPTION AU SEPARATEUR FRANCAIS, deliberee : la paire est deja separee par une
      // virgule, donc « 48,15000 N, 1,75000 E » serait ambigu. Et ces coordonnees sont faites
      // pour etre recopiees dans un outil cartographique, qui attend le point decimal.
      snapshot.identite.centroide
        ? `${snapshot.identite.centroide[1].toFixed(5)} N, ${snapshot.identite.centroide[0].toFixed(5)} E`
        : '-',
    ],
    ['Document d\'urbanisme', urba.typeDocument ?? (urba.couvertParGpu === false ? 'non publié au GPU' : 'non renseigné')],
    ['Zonage dominant', zonagePrincipal ? `${zonagePrincipal.libelle ?? '-'} (${zonagePrincipal.typeZone ?? '?'})` : 'non renseigné'],
    // Le libelle, pas la cle : le rapport ecrivait « agricole_exploite » quand la fiche affichait
    // « Terrain agricole exploite ». Meme table pour les deux, desormais.
    [
      'Occupation du sol',
      snapshot.occupationSol.typeSol
        ? (LIBELLES_TYPE_SOL[snapshot.occupationSol.typeSol] ?? snapshot.occupationSol.typeSol)
        : 'non determinee',
    ],
    ['Culture déclarée (RPG)', libelleRpg(snapshot.occupationSol.rpg)],
    ['Pente moyenne', nb(snapshot.topographie.pentePct, '%', 1)],
    ['Altitude', nb(snapshot.topographie.altitudeM, 'm')],
    ['Dénivelé', nb(snapshot.topographie.deniveleM, 'm')],
    ['Habitation la plus proche', nb(snapshot.bati.distanceHabitationM, 'm')],
    ['Zone d\'accélération ENR', urba.zaer.present == null ? 'non renseigné' : ouiNon(urba.zaer.present)],
    // L'arrete de protection de biotope figurait dans l'interface et PAS dans le rapport : un
    // APPB a 200 m etait visible a l'ecran et absent du document transmis. Or c'est une
    // protection absolue (art. R.411-15 du code de l'environnement), non derogeable par une
    // modification du document d'urbanisme : elle ne peut pas manquer au livrable. Un
    // recouvrement, lui, declenche un knock-out et apparait deja en tete de rapport.
    ['Protection de biotope (APPB)', libelleZonage(snapshot.milieux.appb)],
  ]);
  if (zonagePrincipal?.urlReglement) {
    doc.fontSize(7.6).fillColor(ENCRE_FAIBLE).text(net(`Règlement applicable : ${zonagePrincipal.urlReglement}`), MARGE, doc.y, { width: total });
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
          { titre: 'Tracé estimé', part: 0.11, align: 'right' },
          { titre: 'Capacité', part: 0.11, align: 'right' },
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
            p.etatSaturation ?? 'non renseigné',
            p.renforcement.prevu
              ? `prevu ${p.renforcement.horizon ?? ''} ${p.renforcement.capaciteAttendueMw != null ? `(+${nb(p.renforcement.capaciteAttendueMw, 'MW', 0)})` : ''}`.trim()
              : p.renforcement.prevu === false
                ? 'aucun'
                : 'non renseigné',
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
            `Tracé estimé = vol d'oiseau majoré de ${Math.round((COEFFICIENT_TRACE - 1) * 100)} % ` +
              '(contournement du parcellaire et de la voirie). C\'est cette valeur qui est notée ' +
              'dans la synthèse ; elle ne remplace pas une étude de tracé.',
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
            : 'tracé non ingere - à demander à GRDF / GRTgaz',
        ],
        [
          'Site d\'injection existant le plus proche',
          racc.reseauGaz.distanceSiteInjectionKm != null
            ? `${nb(racc.reseauGaz.distanceSiteInjectionKm, 'km', 1)} (indicateur de filière, non une distance de raccordement)`
            : 'aucun recense',
        ],
        ['Gestionnaire', racc.reseauGaz.gestionnaire ?? 'non renseigné'],
        ['Rebours nécessaire', ouiNon(racc.reseauGaz.reboursNecessaire)],
        [
          'Capacité d\'injection',
          racc.reseauGaz.capaciteInjectionNm3h != null
            ? nb(racc.reseauGaz.capaciteInjectionNm3h, 'Nm3/h', 0)
            : 'non publiée',
        ],
      ]);
    }
  }

  // ================================================= seuils de procedure
  if (score.seuilsProcedure.length > 0) {
    titreSection(doc, 'Seuils de procédure applicables');
    tableau(
      doc,
      [
        { titre: 'Procédure', part: 0.46 },
        { titre: 'Applicable', part: 0.14 },
        { titre: 'Fondement et date d\'entrée en vigueur', part: 0.4 },
      ],
      score.seuilsProcedure.map((s) => ({
        cellules: [
          s.libelle,
          s.applicable === true ? 'oui' : s.applicable === false ? 'non' : 'à vérifier',
          // `dateFr` et non la date brute : le rapport ecrit « rapport du 07/08/2026 » en tete, et
          // affichait « depuis le 2022-10-01 » ici. Deux conventions de date dans un document remis a
          // un proprietaire ou a un financeur (audit 10, defaut B2).
          `${s.reference} - depuis le ${dateFr(s.dateEntreeEnVigueur)}` +
            (REGLES_PAR_ID[s.regleId]?.aValiderParJuriste
              ? ' - référence à faire valider par un juriste'
              : ''),
        ],
        pastille: s.applicable === true ? 'orange' : s.applicable === false ? 'vert' : 'gris',
      })),
    );
  }

  // ============================================ detail des criteres
  // Le detail est long : on reserve de quoi loger le titre, sa note de lecture, l'en-tete
  // du tableau et ses premieres rangees, sinon la section s'ouvre en fin de page pour rien.
  titreSection(doc, 'Détail des critères évalués', 140);
  doc.fontSize(8).fillColor(ENCRE_FAIBLE).text(
    net(
      'La pastille porte le feu du critère. Une pastille grise signale une donnée indisponible : ' +
        'le critère n\'est alors pas note et ne participe pas au score, ce qui abaisse la couverture des données.',
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
      { titre: 'Critère', part: 0.38 },
      { titre: 'Valeur mesurée', part: 0.38 },
      { titre: 'Note /100', part: 0.12, align: 'right' },
      { titre: 'Poids', part: 0.12, align: 'right' },
    ],
    rangees,
  );

  // ============================================== commentaires des criteres
  const commentes = score.criteres.filter((c) => c.commentaire);
  if (commentes.length > 0) {
    titreSection(doc, 'Précisions par critère', 90);
    tableau(
      doc,
      [
        { titre: 'Critère', part: 0.3 },
        { titre: 'Precision', part: 0.7 },
      ],
      commentes.map((c) => ({ cellules: [c.libelle, c.commentaire ?? ''], pastille: c.feu })),
    );
  }

  // ===================================================== sources
  titreSection(doc, 'Sources et fraîcheur des données');
  const sources = Object.values(snapshot.sources);
  tableau(
    doc,
    [
      { titre: 'Source', part: 0.42 },
      { titre: 'Millésime', part: 0.14 },
      { titre: 'Interrogée le', part: 0.16 },
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
            ? 'pre-reperage, à confirmer'
            : 'indicative',
      ],
      pastille: s.valeurJuridique === 'opposable' ? 'vert' : s.valeurJuridique === 'indicative' ? 'orange' : 'gris',
    })),
  );
  if (connecteursEnEchec.length > 0) {
    encadre(doc, 'gris', 'Sources non interrogeables au moment du calcul', [
      `${connecteursEnEchec.join(', ')}. Les critères qui en dépendent sont restés non évalués. ` +
        'Relancer la qualification de la parcelle permettra de les compléter.',
    ]);
  }

  /*
   * ============================================= avant d'appeler le proprietaire
   *
   * CE BLOC EST DANS LE PDF, et pas seulement a l'ecran, parce que c'est le PDF qu'on emporte au
   * rendez-vous. Une liste de verifications consultee sur un ecran resté au bureau ne sert a rien
   * le jour ou l'on est assis en face du proprietaire.
   *
   * Il precede les avertissements du §12 : ceux-la disent ce que l'OUTIL ne garantit pas, celui-ci
   * ce que la PARCELLE reserve. Le second est actionnable, le premier est une mise en garde de
   * methode — l'actionnable passe devant.
   */
  const aVerifier = verificationsAvantContact(snapshot, score.filiere, {
    regimeImplantation: score.regimeImplantation ?? null,
  });
  if (aVerifier.length > 0) {
    titreSection(doc, 'Avant de contacter le propriétaire');
    for (const v of aVerifier) {
      assurerPlace(doc, 34);
      doc
        .fontSize(8.4)
        .font('Helvetica-Bold')
        .fillColor('#0f172a')
        .text(net(v.titre), MARGE, doc.y, { width: total });
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#334155')
        .text(net(v.texte), MARGE, doc.y + 1, { width: total, align: 'justify' });
      doc
        .fontSize(8)
        .font('Helvetica-Oblique')
        .fillColor('#0f172a')
        .text(net(`À demander : ${v.question}`), MARGE, doc.y + 1, { width: total });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.3);
  }

  // ============================================= avertissements
  titreSection(doc, 'Avertissements - à lire avant tout usage');
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
      `Référentiel réglementaire vérifié le ${dateFr(REFERENTIEL_DERNIERE_VERIFICATION)}. Moteur de scoring version ${score.versionMoteur}. ` +
        'Le contour cadastral est issu du Plan Cadastral Informatisé : il est indicatif et sans valeur juridique. ' +
        'Seul un document d\'arpentage établi par un géomètre-expert fait foi.',
    ),
    MARGE,
    doc.y,
    { width: total, align: 'justify' },
  );

  piedsDePage(doc, `Prospection EnR - aide à la décision, pas une garantie de faisabilité - parcelle ${parcelle.idu}`);

  doc.end();
  return doc;
}

/**
 * Pied de page sur chaque page : mention permanente a gauche, pagination a droite.
 *
 * Exige `bufferPages: true` a la creation du document — le nombre total de pages n'est connu
 * qu'a la fin. Sorti de `ficheParcellePdf` le jour ou un second document a eu besoin du meme
 * pied : la mention « aide a la decision, pas une garantie de faisabilite » est la seule qui
 * suive le lecteur d'un bout a l'autre d'un livrable imprime, elle ne doit pas exister en deux
 * exemplaires susceptibles de diverger.
 */
function piedsDePage(doc: Doc, mention: string): void {
  const total = largeurUtile(doc);
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
    doc.text(net(mention), MARGE, y, { width: total * 0.75, lineBreak: false });
    doc.text(`${i + 1} / ${pages.count}`, MARGE + total * 0.75, y, {
      width: total * 0.25,
      align: 'right',
      lineBreak: false,
    });
  }
}

// ---------------------------------------------------------------------------
// PDF : dossier de site (plusieurs parcelles)
//
// CE QUE CE DOCUMENT EST, ET POURQUOI IL N'EST PAS UNE CONCATENATION DE FICHES.
//
// La fiche parcelle repond a « ce terrain vaut-il un appel ». Le dossier de site repond a une
// question posee plus tard, et par quelqu'un d'autre : le proprietaire a dit oui, et il faut
// remettre a un DEVELOPPEUR de quoi instruire un projet. Trois differences en decoulent, et
// aucune ne s'obtient en agrafant des fiches :
//
//   1. LES GRANDEURS SONT CELLES DU SITE, pas celles d'une parcelle. Une surface utile de site
//      n'est pas la somme des surfaces utiles : si les parcelles sont jointives, les limites
//      interieures ne portent pas de cloture. `surfaceUtileSiteHa` tranche selon la contiguite
//      REELLE, mesuree en base, et le dossier ecrit laquelle des deux methodes il a appliquee ;
//   2. LA LECTURE EST PAR THEME, pas par parcelle. Un developpeur lit « le raccordement du
//      site », « l'urbanisme du site » — il compare les parcelles entre elles sur un meme
//      critere. Douze fiches obligeraient a reconstruire ces tableaux a la main ;
//   3. LES RESERVES SONT AGREGEES ET REMONTEES EN TETE. Un knock-out bloquant sur une seule
//      parcelle d'un ensemble condamne souvent l'ensemble : noye en page 40 d'une concatenation,
//      il se decouvre apres la promesse faite au proprietaire.
// ---------------------------------------------------------------------------

export interface ParcelleDuDossier {
  parcelle: ParcelleEnBase;
  snapshot: ParcelleSnapshot;
  score: ResultatScore;
  connecteursEnEchec: string[];
  /** Statut de prospection, s'il existe un lead pour cette parcelle et cette filiere. */
  statutProspection: StatutProspection | null;
}

export interface ContexteDossier {
  filiere: Filiere;
  /**
   * Nombre de groupes de parcelles contigus, mesure en base (`nbGroupesContigus`).
   * `null` = indeterminable : traite comme disperse, ce qui est le sens prudent.
   */
  nbGroupesContigus: number | null;
}

/** Rose des vents a huit branches, pour rendre une orientation lisible sans calcul mental. */
function cardinal(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '-';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  // Le degre en toutes lettres serait plus sur, mais « ° » est dans Latin-1 : `net` le conserve.
  return `${points[i]} (${Math.round(deg)}°)`;
}

/** Severite d'un plan de prevention, en clair. */
const LIBELLES_SEVERITE_PLAN: Record<string, string> = {
  interdiction_stricte: 'interdiction stricte',
  interdiction: 'interdiction',
  prescriptions: 'prescriptions',
  precaution: 'précaution',
};

export function dossierSitePdf(
  parcelles: ParcelleDuDossier[],
  contexte: ContexteDossier,
): NodeJS.ReadableStream {
  const meta = FILIERES_META[contexte.filiere];
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: HAUT, bottom: BAS, left: MARGE, right: MARGE },
    bufferPages: true,
    info: {
      Title: `Dossier de site - ${parcelles.length} parcelle(s) - ${meta.libelleCourt}`,
      Author: 'Prospection EnR',
      Subject: `Dossier de site, filière ${meta.libelle}`,
    },
  });
  const total = largeurUtile(doc);

  const surfaceHa = (p: ParcelleEnBase): number | null => {
    const m2 = p.surfaceCalculeeM2 ?? p.contenanceM2;
    return m2 == null ? null : m2 / 10000;
  };

  const communes = [
    ...new Set(parcelles.map((p) => p.parcelle.nomCommune ?? p.parcelle.codeInsee)),
  ].sort();
  const multiCommune = communes.length > 1;
  /**
   * Reference courte d'une parcelle dans les tableaux thematiques.
   *
   * La commune n'est ajoutee que lorsqu'il y en a plusieurs : sur un site d'une seule commune,
   * la repeter douze fois occupe une colonne pour rien ; sur un site a cheval, « AB 12 » sans
   * commune designe potentiellement deux parcelles differentes.
   */
  const ref = (p: ParcelleEnBase): string =>
    multiCommune
      ? `${p.nomCommune ?? p.codeInsee} ${p.section} ${p.numero}`
      : `${p.section} ${p.numero}`;

  // ===================================================================== tete
  doc.fontSize(7.8).font('Helvetica-Bold').fillColor(ENCRE_FAIBLE);
  doc.text('PROSPECTION ENR - DOSSIER DE SITE', MARGE, HAUT, { characterSpacing: 0.8 });
  doc.fontSize(19).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text(
    net(communes.length <= 3 ? communes.join(', ') : `${communes.slice(0, 3).join(', ')} et ${communes.length - 3} autre${communes.length - 3 > 1 ? 's' : ''} commune${communes.length - 3 > 1 ? 's' : ''}`),
    MARGE,
    doc.y + 4,
    { width: total },
  );
  doc.fontSize(10).font('Helvetica').fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      `${parcelles.length} parcelle${parcelles.length > 1 ? 's' : ''}  -  filière ${meta.libelle}  -  dossier du ${dateFr(new Date())}`,
    ),
    MARGE,
    doc.y + 2,
    { width: total },
  );
  doc.y += 12;
  doc.fillColor(ENCRE);

  // ============================================================ chiffres du site
  const surface = surfaceUtileSiteHa(
    parcelles.map((p) => surfaceHa(p.parcelle)),
    parcelles.map((p) => p.snapshot.foncier.morcellementIndice),
    contexte.filiere,
    contexte.nbGroupesContigus,
  );

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LE REGIME D'IMPLANTATION DU SITE N'EXISTE QUE S'IL EST UNANIME — ET SINON, ON PREND LE BAS
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * Le regime (agrivoltaisme, terrain degrade...) change la densite de puissance du SIMPLE AU
   * DOUBLE : 1 MWc par hectare en centrale au sol, 0,5 en agrivoltaisme ou la couverture est
   * plafonnee. Le deduire d'une parcelle sur douze, ou prendre le plus frequent, produirait un
   * chiffre de projet fonde sur une majorite silencieuse.
   *
   * CE QUE LA PREMIERE VERSION FAISAIT, ET POURQUOI C'ETAIT LE MAUVAIS DEFAUT. Faute d'unanimite,
   * elle passait `null` — c'est-a-dire qu'elle retombait sur la densite de REFERENCE, la plus
   * haute. Mesure sur les deux parcelles de fixtures, dont les regimes different : le dossier
   * annoncait 19,08 MWc en ecrivant deux lignes plus haut « regime heterogene selon les
   * parcelles ». Un site partiellement agrivoltaique etait donc chiffre comme s'il ne l'etait
   * pas, et l'ecart va jusqu'au double.
   *
   * Entre plusieurs regimes possibles, le dossier retient donc la densite LA PLUS BASSE. Un site
   * sous-estime coute une etude ; un site surestime coute une promesse faite a un proprietaire et
   * un modele economique refait.
   */
  const regimes = new Set(parcelles.map((p) => p.score.regimeImplantation ?? null));
  const regimeUnanime = regimes.size === 1 ? [...regimes][0] : undefined;
  const candidates = [...regimes].map((r) => puissanceEstimee(contexte.filiere, surface.netteHa, r));
  const puissance =
    regimes.size === 1
      ? candidates[0]!
      : (candidates
          .filter((p) => p.mwc != null)
          .sort((a, b) => a.mwc! - b.mwc!)[0] ?? candidates[0]!);

  const emprise =
    contexte.nbGroupesContigus == null
      ? 'contiguïté indéterminée (traitée comme dispersée)'
      : contexte.nbGroupesContigus === 1
        ? "un seul tenant"
        : `${contexte.nbGroupesContigus} emprises séparées`;

  titreSection(doc, 'Le site en chiffres');
  grilleCles(doc, [
    ['Filière étudiée', meta.libelle],
    ['Parcelles', `${parcelles.length}`],
    ['Emprise', emprise],
    ['Communes', `${communes.length}`],
    ['Surface cadastrale cumulée', nb(surface.bruteHa, 'ha', 2)],
    ['Surface utile estimée', nb(surface.netteHa, 'ha', 2)],
    [
      'Puissance estimée',
      puissance.mwc != null ? nb(puissance.mwc, 'MWc', 2) : 'non déductible d’une surface',
    ],
    [
      'Régime d’implantation',
      regimeUnanime == null
        ? regimes.size > 1
          ? 'hétérogène selon les parcelles'
          : 'non déterminé'
        : (LIBELLES_REGIME[regimeUnanime] ?? regimeUnanime),
    ],
  ]);

  /*
   * LA METHODE SOUS LES DEUX CHIFFRES QUI SERONT REPRIS AILLEURS.
   *
   * La surface utile et la puissance sont les deux lignes qu'un developpeur recopie dans son
   * propre modele. Elles quittent donc ce document, et la phrase qui les qualifie doit voyager
   * avec elles — sans quoi une estimation d'ordre de grandeur devient, deux tableurs plus loin,
   * une donnee d'entree.
   */
  doc.fontSize(7.8).fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      `Surface utile : ${
        surface.methode === 'emprise_unique'
          ? "les parcelles forment une emprise unique, la bande périmétrale est déduite du contour d'ensemble."
          : "les parcelles ne forment pas une emprise unique (ou la contiguïté est inconnue) : la bande périmétrale est déduite parcelle par parcelle, puis sommée. C'est le calcul prudent."
      }`,
    ),
    MARGE,
    doc.y,
    { width: total, align: 'justify' },
  );
  doc.text(
    net(
      `Puissance : ${puissance.methode}` +
        (regimes.size > 1 && puissance.mwc != null
          ? " Les parcelles ne relèvent pas toutes du même régime d'implantation : c'est la densité " +
            'la plus basse des régimes présents qui est retenue, soit le chiffrage prudent.'
          : ''),
    ),
    MARGE,
    doc.y + 2,
    { width: total, align: 'justify' },
  );
  doc.fillColor(ENCRE).moveDown(0.4);

  // ================================================================ reserves
  /*
   * LES RESERVES AVANT TOUT LE RESTE.
   *
   * Un dossier se constitue apres un accord de principe du proprietaire : le risque propre a ce
   * moment-la n'est plus de rater un terrain, c'est d'engager une negociation sur un terrain
   * deja disqualifie. Ce bloc est donc en page une, avant les tableaux thematiques.
   */
  const bloquantes = parcelles.filter((p) => p.score.knockOuts.some((k) => !k.derogeable));
  const derogeables = parcelles.filter(
    (p) => p.score.knockOuts.length > 0 && !p.score.knockOuts.some((k) => !k.derogeable),
  );
  if (bloquantes.length > 0 || derogeables.length > 0) {
    titreSection(doc, 'Réserves sur les parcelles du dossier');
    for (const p of bloquantes) {
      encadre(
        doc,
        'rouge',
        `${ref(p.parcelle)} - ${LIBELLE_REDHIBITOIRE}`,
        p.score.knockOuts.filter((k) => !k.derogeable).map((k) => `${k.libelle} : ${k.motif}`),
      );
    }
    for (const p of derogeables) {
      encadre(
        doc,
        'orange',
        `${ref(p.parcelle)} - sous condition de dérogation`,
        p.score.knockOuts.map((k) => `${k.libelle} : ${k.motif}`),
      );
    }
  }

  // ============================================================ liste des parcelles
  titreSection(doc, 'Parcelles du dossier', 90);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.14 },
      { titre: 'Commune', part: 0.2 },
      { titre: 'Identifiant (IDU)', part: 0.22 },
      { titre: 'Surface', part: 0.12, align: 'right' },
      { titre: 'Score', part: 0.1, align: 'right' },
      { titre: 'Prospection', part: 0.22 },
    ],
    parcelles.map((p) => ({
      cellules: [
        `${p.parcelle.section} ${p.parcelle.numero}`,
        p.parcelle.nomCommune ?? p.parcelle.codeInsee,
        p.parcelle.idu,
        nb(surfaceHa(p.parcelle), 'ha', 2),
        p.score.scoreGlobal != null ? p.score.scoreGlobal.toFixed(0) : 'écartée',
        p.statutProspection
          ? STATUTS_PROSPECTION_META[p.statutProspection].libelle
          : 'aucun suivi enregistré',
      ],
      pastille: p.score.statut,
    })),
  );

  // ======================================================== acces et transports
  titreSection(doc, 'Accès et transports', 90);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.22 },
      { titre: 'Voirie carrossable', part: 0.18, align: 'right' },
      { titre: 'Accès poids lourds', part: 0.2 },
      { titre: 'Habitation la plus proche', part: 0.2, align: 'right' },
      { titre: 'Bâtiments dans 500 m', part: 0.2, align: 'right' },
    ],
    parcelles.map((p) => ({
      cellules: [
        ref(p.parcelle),
        p.snapshot.acces.distanceVoirieM == null
          ? 'non renseigné'
          : p.snapshot.acces.distanceVoirieM <= 0
            ? 'parcelle riveraine'
            : nb(p.snapshot.acces.distanceVoirieM, 'm'),
        ouiNon(p.snapshot.acces.accesPoidsLourds),
        nb(p.snapshot.bati.distanceHabitationM, 'm'),
        nb(p.snapshot.bati.nbHabitationsRayon500m),
      ],
      pastille:
        p.snapshot.acces.distanceVoirieM == null
          ? 'gris'
          : p.snapshot.acces.distanceVoirieM <= 0
            ? 'vert'
            : 'orange',
    })),
  );
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      'La voirie mesurée est le réseau routier carrossable de la BD TOPO. Le dossier ne couvre ni ' +
        "le fer, ni la voie d'eau, ni le gabarit réel des ouvrages d'art sur l'itinéraire : un " +
        'convoi exceptionnel (pales, transformateurs, conteneurs) se vérifie auprès du ' +
        'gestionnaire de voirie, pas sur une carte.',
    ),
    MARGE,
    doc.y + 2,
    { width: total, align: 'justify' },
  );
  doc.fillColor(ENCRE).moveDown(0.3);

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * RACCORDEMENT — LA SECTION EST TOUJOURS ECRITE, MEME VIDE
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * LE DEFAUT TROUVE EN RELISANT LE DOCUMENT PRODUIT, et non en relisant le code. Sur les fixtures,
   * le connecteur des postes sources est en echec : `posteLePlusProche` vaut `null` partout, et la
   * section entiere disparaissait. Le dossier passait donc d'« Accès et transports » a « Urbanisme
   * applicable » sans un mot.
   *
   * Pour un lecteur, une section absente d'un sommaire thematique ne se lit pas « donnee
   * manquante » : elle se lit « sans objet ». Or le raccordement est LE critere dimensionnant d'un
   * projet ENR — c'est lui qui decide du budget et souvent du calendrier. Le taire est la faute que
   * ce depot traque depuis dix audits, appliquee a la donnee la plus chere du dossier.
   *
   * La fiche parcelle a la meme construction conditionnelle, et c'est defendable la-bas : elle est
   * lue a l'ecran, a cote d'une interface qui affiche l'etat des connecteurs. Le dossier, lui, part
   * seul chez un tiers.
   */
  const avecPoste = parcelles.filter((p) => p.snapshot.raccordement.posteLePlusProche != null);
  titreSection(doc, 'Raccordement électrique', 90);
  if (avecPoste.length === 0) {
    encadre(doc, 'gris', 'Aucun poste source renseigné pour ce site', [
      "Le raccordement n'a pas pu être documenté : la couche des postes sources n'est pas ingérée, " +
        "ou elle n'a pas répondu au moment du calcul. Ce n'est PAS un constat d'absence de " +
        'contrainte — le raccordement reste le poste de coût dimensionnant du projet.',
      'À obtenir avant toute décision : la capacité résiduelle et la file d’attente du poste ' +
        'envisagé (Capareseau), et le schéma régional de raccordement (S3REnR) applicable.',
    ]);
  } else {
    if (avecPoste.length < parcelles.length) {
      encadre(doc, 'gris', 'Raccordement documenté sur une partie du site seulement', [
        `${avecPoste.length} parcelle(s) sur ${parcelles.length} portent un poste source renseigné. ` +
          "Les autres ne figurent pas dans le tableau ci-dessous : leur raccordement n'est pas " +
          'documenté, il n’est pas réputé plus simple.',
      ]);
    }
    tableau(
      doc,
      [
        { titre: 'Parcelle', part: 0.16 },
        { titre: 'Poste source', part: 0.2 },
        { titre: 'Gestionnaire', part: 0.12 },
        { titre: 'Vol d\'oiseau', part: 0.12, align: 'right' },
        { titre: 'Tracé estimé', part: 0.12, align: 'right' },
        { titre: 'Capacité', part: 0.13, align: 'right' },
        { titre: 'Saturation', part: 0.15 },
      ],
      avecPoste.map((p) => {
        const poste = p.snapshot.raccordement.posteLePlusProche!;
        return {
          cellules: [
            ref(p.parcelle),
            poste.nom,
            poste.gestionnaire,
            nb(poste.distanceKm, 'km', 1),
            nb(lineaireRaccordementKm(poste.distanceKm), 'km', 1),
            poste.capaciteResiduelleMw != null ? nb(poste.capaciteResiduelleMw, 'MW', 1) : 'inconnue',
            poste.etatSaturation ?? 'non renseigné',
          ],
          pastille:
            poste.etatSaturation === 'disponible'
              ? ('vert' as Feu)
              : poste.etatSaturation === 'tendu'
                ? ('orange' as Feu)
                : poste.etatSaturation === 'sature'
                  ? ('rouge' as Feu)
                  : ('gris' as Feu),
        };
      }),
    );
    doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
    doc.text(
      net(
        `Tracé estimé = vol d'oiseau majoré de ${Math.round((COEFFICIENT_TRACE - 1) * 100)} % ` +
          '(contournement du parcellaire et de la voirie). La capacité résiduelle est une valeur ' +
          "indicative publiée par Capareseau : elle n'est pas une réservation, et la file d'attente " +
          'peut la consommer avant le dépôt de la demande.',
      ),
      MARGE,
      doc.y + 2,
      { width: total, align: 'justify' },
    );
    doc.fillColor(ENCRE).moveDown(0.3);
  }

  // =============================================================== urbanisme
  titreSection(doc, 'Urbanisme applicable', 90);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.16 },
      { titre: 'Document', part: 0.12 },
      { titre: 'Zonage dominant', part: 0.28 },
      { titre: 'Part', part: 0.1, align: 'right' },
      { titre: 'Zone d\'accélération ENR', part: 0.16 },
      { titre: 'Servitudes (SUP)', part: 0.18 },
    ],
    parcelles.map((p) => {
      const u = p.snapshot.urbanisme;
      const zone = [...u.zonages].sort(
        (a, b) => (b.partRecouvrement ?? 0) - (a.partRecouvrement ?? 0),
      )[0];
      return {
        cellules: [
          ref(p.parcelle),
          u.typeDocument ?? (u.couvertParGpu === false ? 'non publié' : 'non renseigné'),
          zone ? `${zone.libelle ?? '-'} (${zone.typeZone ?? '?'})` : 'non renseigné',
          zone?.partRecouvrement != null ? `${Math.round(zone.partRecouvrement * 100)} %` : '-',
          u.zaer.present == null ? 'non renseigné' : ouiNon(u.zaer.present),
          u.servitudes.length > 0 ? u.servitudes.join(', ') : 'aucune relevée',
        ],
        pastille: (u.typeDocument == null ? 'gris' : 'vert') as Feu,
      };
    }),
  );
  const reglements = [
    ...new Set(
      parcelles
        .flatMap((p) => p.snapshot.urbanisme.zonages.map((z) => z.urlReglement))
        .filter((u): u is string => u != null && u !== ''),
    ),
  ];
  if (reglements.length > 0) {
    doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
    doc.text(net('Règlements applicables :'), MARGE, doc.y + 2, { width: total });
    for (const url of reglements) doc.text(net(url), MARGE, doc.y, { width: total });
    doc.fillColor(ENCRE).moveDown(0.3);
  }

  // ============================================================ eau et inondation
  titreSection(doc, 'Eau et inondation', 90);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.16 },
      { titre: 'PPRI sur la commune', part: 0.14 },
      { titre: 'Sévérité maximale du plan', part: 0.2 },
      { titre: 'Aléa', part: 0.1 },
      { titre: 'TRI', part: 0.1 },
      { titre: 'Cours d\'eau', part: 0.14, align: 'right' },
      { titre: 'Zone humide', part: 0.16 },
    ],
    parcelles.map((p) => {
      const e = p.snapshot.eau;
      const ppri = p.snapshot.risques.ppri;
      return {
        cellules: [
          ref(p.parcelle),
          ppri.present == null ? 'non renseigné' : ouiNon(ppri.present),
          ppri.severitePlan
            ? (LIBELLES_SEVERITE_PLAN[ppri.severitePlan] ?? ppri.severitePlan)
            : ppri.present === false
              ? 'sans objet'
              : 'non renseignée',
          e.inondation.alea ?? 'non renseigné',
          e.inondation.dansTri == null ? 'non renseigné' : ouiNon(e.inondation.dansTri),
          nb(e.distanceCoursEauM, 'm'),
          e.zoneHumide === 'a_confirmer' ? 'à confirmer' : (e.zoneHumide ?? 'non renseigné'),
        ],
        pastille: (ppri.present == null
          ? 'gris'
          : ppri.present === false
            ? 'vert'
            : 'orange') as Feu,
      };
    }),
  );
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      "L'API Géorisques expose la liste des zones réglementaires d'un plan, pas leur géométrie : " +
        'la colonne « sévérité maximale » décrit ce que le PLAN contient, et non la zone applicable ' +
        'à la parcelle. Cette dernière se lit sur le règlement graphique, en mairie ou en ' +
        'préfecture — elle conditionne la constructibilité et doit être obtenue avant tout ' +
        'engagement. Le repérage des zones humides est cartographique : il ne remplace pas un ' +
        'sondage pédologique.',
    ),
    MARGE,
    doc.y + 2,
    { width: total, align: 'justify' },
  );
  doc.fillColor(ENCRE).moveDown(0.3);

  // ============================================================= milieux et foret
  titreSection(doc, 'Milieux naturels et boisement', 90);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.16 },
      { titre: 'Boisement (BD Forêt)', part: 0.18 },
      { titre: 'Part boisée', part: 0.1, align: 'right' },
      { titre: 'Enjeu défrichement', part: 0.14 },
      { titre: 'Natura 2000', part: 0.22 },
      { titre: 'ZNIEFF de type 1', part: 0.2 },
    ],
    parcelles.map((p) => {
      const m = p.snapshot.milieux;
      const f = p.snapshot.occupationSol.foret;
      return {
        cellules: [
          ref(p.parcelle),
          f.recouvre == null
            ? 'non renseigné'
            : f.recouvre
              ? `boisée${f.type ? ` - ${f.type}` : ''}`
              : 'non boisée',
          f.partBoisee != null ? `${Math.round(f.partBoisee * 100)} %` : '-',
          ouiNon(m.enjeuDefrichement),
          `Habitats : ${libelleZonage(m.natura2000Habitats)}\nOiseaux : ${libelleZonage(m.natura2000Oiseaux)}`,
          libelleZonage(m.znieff1),
        ],
        pastille: (f.recouvre == null
          ? 'gris'
          : f.recouvre
            ? 'orange'
            : 'vert') as Feu,
      };
    }),
  );
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      'Un boisement déclenche une autorisation de défrichement (art. L.341-3 du code forestier) et, ' +
        "le plus souvent, une compensation. Le caractère boisé s'apprécie sur l'état RÉEL du terrain, " +
        "pas sur la BD Forêt, dont le millésime peut avoir plusieurs années : une friche reboisée " +
        'depuis relève du défrichement même si la couche l’ignore.',
    ),
    MARGE,
    doc.y + 2,
    { width: total, align: 'justify' },
  );
  doc.fillColor(ENCRE).moveDown(0.3);

  // ============================================================== topographie
  titreSection(doc, 'Topographie et sous-sol', 90);
  const penteEstimee = parcelles.some((p) => p.snapshot.topographie.penteEstimeeParPaires === true);
  tableau(
    doc,
    [
      { titre: 'Parcelle', part: 0.17 },
      { titre: 'Pente moyenne', part: 0.14, align: 'right' },
      { titre: 'Pente max', part: 0.11, align: 'right' },
      { titre: 'Altitude', part: 0.11, align: 'right' },
      { titre: 'Dénivelé', part: 0.11, align: 'right' },
      { titre: 'Orientation', part: 0.14 },
      { titre: 'Aléa argiles', part: 0.11 },
      { titre: 'Cavités < 1 km', part: 0.11, align: 'right' },
    ],
    parcelles.map((p) => {
      const t = p.snapshot.topographie;
      return {
        cellules: [
          ref(p.parcelle),
          t.pentePct == null
            ? '-'
            : `${nb(t.pentePct, '%', 1)}${t.penteEstimeeParPaires === true ? ' *' : ''}`,
          nb(t.penteMaxPct, '%', 1),
          nb(t.altitudeM, 'm'),
          nb(t.deniveleM, 'm'),
          cardinal(t.orientationDeg),
          t.aleaArgiles ?? 'non renseigné',
          nb(t.cavitesProches),
        ],
        pastille: (t.pentePct == null ? 'gris' : t.pentePct <= 5 ? 'vert' : t.pentePct <= 10 ? 'orange' : 'rouge') as Feu,
      };
    }),
  );
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE);
  doc.text(
    net(
      (penteEstimee
        ? '* Pente obtenue par différences entre paires de points et non par régression du plan des ' +
          'altitudes : cette méthode retient la plus forte pente locale, elle SURÉVALUE donc la pente ' +
          'moyenne. '
        : '') +
        'Les valeurs sont dérivées du modèle numérique de terrain : elles situent le site, elles ne ' +
        'remplacent pas un levé topographique, qui reste nécessaire au plan de masse et au calcul ' +
        'des terrassements.',
    ),
    MARGE,
    doc.y + 2,
    { width: total, align: 'justify' },
  );
  doc.fillColor(ENCRE).moveDown(0.3);

  // ================================================= avant de contacter le proprietaire
  /*
   * AGREGE ET DEDUPLIQUE, avec la liste des parcelles concernees.
   *
   * Repeter douze fois le meme paragraphe sur le bail rural ferait perdre l'information au lieu de
   * la porter : ce qui compte ici, c'est QUELLES parcelles sont concernees par chaque point.
   */
  const points = new Map<string, { texte: string; question: string; titre: string; gravite: string; refs: string[] }>();
  for (const p of parcelles) {
    for (const v of verificationsAvantContact(p.snapshot, contexte.filiere, {
      regimeImplantation: p.score.regimeImplantation ?? null,
    })) {
      const existant = points.get(v.id);
      if (existant) existant.refs.push(ref(p.parcelle));
      else
        points.set(v.id, {
          titre: v.titre,
          texte: v.texte,
          question: v.question,
          gravite: v.gravite,
          refs: [ref(p.parcelle)],
        });
    }
  }
  if (points.size > 0) {
    titreSection(doc, 'Points à lever avec le propriétaire');
    for (const v of points.values()) {
      assurerPlace(doc, 40);
      doc.fontSize(8.4).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text(net(v.titre), MARGE, doc.y, { width: total });
      doc.fontSize(7.6).font('Helvetica').fillColor(ENCRE_FAIBLE);
      doc.text(
        net(
          `${v.refs.length === parcelles.length ? 'Toutes les parcelles' : `Parcelle${v.refs.length > 1 ? 's' : ''} ${v.refs.join(', ')}`} - ${
            v.gravite === 'arret'
              ? 'peut arrêter la négociation'
              : v.gravite === 'delai'
                ? 'déplace le calendrier'
                : 'change l’interlocuteur ou la démarche'
          }`,
        ),
        MARGE,
        doc.y + 1,
        { width: total },
      );
      doc.fontSize(8).font('Helvetica').fillColor('#334155');
      doc.text(net(v.texte), MARGE, doc.y + 1, { width: total, align: 'justify' });
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#0f172a');
      doc.text(net(`À demander : ${v.question}`), MARGE, doc.y + 1, { width: total });
      doc.moveDown(0.35);
    }
    doc.fillColor(ENCRE).moveDown(0.2);
  }

  // ===================================================================== sources
  /*
   * UNE SOURCE INTERROGEE A DOUZE DATES DIFFERENTES N'A QU'UNE FRAICHEUR : LA PLUS ANCIENNE.
   *
   * Afficher la plus recente laisserait croire que tout le dossier a ete constitue ce jour-la,
   * alors qu'une parcelle qualifiee il y a trois mois porte des donnees de trois mois.
   */
  const sources = new Map<string, { nom: string; millesime: string | null; date: string; valeurJuridique: string }>();
  for (const p of parcelles) {
    for (const [cle, s] of Object.entries(p.snapshot.sources)) {
      const existant = sources.get(cle);
      if (!existant || new Date(s.dateInterrogation) < new Date(existant.date)) {
        sources.set(cle, {
          nom: s.nom,
          millesime: s.millesime ?? null,
          date: s.dateInterrogation,
          valeurJuridique: s.valeurJuridique,
        });
      }
    }
  }
  titreSection(doc, 'Sources et fraîcheur des données', 90);
  tableau(
    doc,
    [
      { titre: 'Source', part: 0.42 },
      { titre: 'Millésime', part: 0.14 },
      { titre: 'Interrogée le (au plus tôt)', part: 0.2 },
      { titre: 'Valeur juridique', part: 0.24 },
    ],
    [...sources.values()].map((s) => ({
      cellules: [
        s.nom,
        s.millesime ?? '-',
        dateFr(s.date),
        s.valeurJuridique === 'opposable'
          ? 'opposable'
          : s.valeurJuridique === 'pre_reperage'
            ? 'pré-repérage, à confirmer'
            : 'indicative',
      ],
      pastille: (s.valeurJuridique === 'opposable'
        ? 'vert'
        : s.valeurJuridique === 'indicative'
          ? 'orange'
          : 'gris') as Feu,
    })),
  );
  const echecs = [...new Set(parcelles.flatMap((p) => p.connecteursEnEchec))];
  if (echecs.length > 0) {
    encadre(doc, 'gris', 'Sources non interrogeables au moment du calcul', [
      `${echecs.join(', ')}. Les critères qui en dépendent sont restés non évalués sur au moins ` +
        'une parcelle du dossier : les cases correspondantes ne signifient pas « aucune contrainte ».',
    ]);
  }

  // ============================================================= avertissements
  titreSection(doc, 'Avertissements - à lire avant tout usage');
  for (const a of AVERTISSEMENTS.filter((x) => x.portee === 'global')) {
    assurerPlace(doc, 26);
    doc.fontSize(8.4).font('Helvetica-Bold').fillColor('#0f172a').text(net(a.titre), MARGE, doc.y, { width: total });
    doc.fontSize(8).font('Helvetica').fillColor('#334155').text(net(a.texte), MARGE, doc.y + 1, {
      width: total,
      align: 'justify',
    });
    doc.moveDown(0.35);
  }
  assurerPlace(doc, 34);
  doc.fontSize(7.6).fillColor(ENCRE_FAIBLE).text(
    net(
      `Référentiel réglementaire vérifié le ${dateFr(REFERENTIEL_DERNIERE_VERIFICATION)}. Moteur de scoring version ${parcelles[0]?.score.versionMoteur ?? '-'}. ` +
        "Ce dossier rassemble des données publiques pré-analysées pour préparer l'instruction d'un " +
        "projet ; il ne constitue ni une étude de faisabilité, ni une étude d'impact, ni un avis " +
        "juridique. Le contour cadastral est issu du Plan Cadastral Informatisé : il est indicatif " +
        "et sans valeur juridique. Seul un document d'arpentage établi par un géomètre-expert fait foi.",
    ),
    MARGE,
    doc.y,
    { width: total, align: 'justify' },
  );

  piedsDePage(
    doc,
    `Prospection EnR - dossier de site - aide à la décision, pas une garantie de faisabilité`,
  );

  doc.end();
  return doc;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Nombre de decimales conservees pour les coordonnees exportees.
 *
 * SIX, et le chiffre se justifie : a la latitude de la France metropolitaine, la sixieme decimale de
 * longitude vaut environ 7 cm, la sixieme de latitude environ 11 cm. C'est deja bien plus fin que la
 * precision du Plan Cadastral Informatisé dont ces centroides sont issus, et que l'application
 * qualifie d'indicatif dans chacun de ses avertissements.
 *
 * Ce qui etait ecrit avant : `1.7455783348199738` — dix-sept chiffres significatifs, soit une
 * precision affichee de l'ordre du dixieme de nanometre. Ce n'est pas une precision, c'est la
 * representation binaire d'un flottant rendue telle quelle. Sur un livrable transmis a un tiers, elle
 * suggere une exactitude qui n'existe pas — la meme faute de forme que les points decimaux et les
 * dates ISO des audits precedents, appliquee cette fois a un chiffre.
 */
export const DECIMALES_COORDONNEES = 6;

/**
 * CSV a separateur point-virgule, avec BOM UTF-8 : ouverture directe dans Excel FR.
 *
 * LES VALEURS SONT DES LIBELLES, PAS DES CLES D'ENUMERATION, depuis la decision du proprietaire de
 * changer le format. Le fichier ecrivait `gris`, `a_prospecter`, `agricole_exploite` — le vocabulaire
 * interne du code — la ou l'ecran affiche « Donnees manquantes », « A prospecter », « Terrain agricole
 * exploite ». Un destinataire externe n'a pas la cle de lecture, et le fichier ne disait donc pas la
 * meme chose que l'application qui l'a produit.
 *
 * ATTENTION, C'EST UN CHANGEMENT CASSANT, et il est assume : un tableau croise ou un filtre construit
 * sur les anciennes valeurs ne les trouvera plus. Le CHANGELOG le signale comme tel. Les libelles
 * viennent des memes tables que l'interface — `LIBELLES_SCORE`, `STATUTS_PROSPECTION_META`,
 * `LIBELLES_TYPE_SOL` — et non de copies locales : un libelle est une decision de vocabulaire, il ne
 * doit exister qu'a un seul endroit.
 */
export function csvResultats(lignes: LigneResultatFiltre[]): string {
  const entetes = [
    'IDU',
    'Commune',
    'Section',
    'Numéro',
    'Surface (ha)',
    'Statut score',
    'Écartée réglementairement',
    'Score global',
    'Statut prospection',
    'Vol d\'oiseau poste source (km)',
    'Tracé estimé poste source (km)',
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
  /**
   * Coordonnee bornee, virgule decimale comprise.
   *
   * La virgule est la bonne ponctuation ICI, contrairement au rapport PDF : le fichier est separe par
   * des points-virgules et destine a s'ouvrir dans Excel en configuration francaise, ou un point
   * decimal serait lu comme du texte. Le PDF, lui, ecrit ses coordonnees avec un point parce qu'elles
   * y sont destinees a etre collees dans un outil cartographique. Les deux choix sont opposes et tous
   * deux corrects : c'est le destinataire qui tranche, pas une regle uniforme.
   */
  const coordonnee = (n: number): string => n.toFixed(DECIMALES_COORDONNEES).replace('.', ',');

  const corps = lignes.map((l) =>
    [
      l.idu,
      l.nomCommune,
      l.section,
      l.numero,
      nombre(l.surfaceHa),
      /**
       * Le libelle du statut, et le cas REDHIBITOIRE distingue — comme a l'ecran.
       *
       * La palette separe deliberement deux rouges : celui d'un score faible et celui d'une parcelle
       * ecartee par un critere eliminatoire. La liste affiche « Redhibitoire » pour la seconde. Un CSV
       * qui ecrirait « Score faible » dans les deux cas perdrait la distinction la plus lourde du
       * fichier, celle qui separe « peu interessante » de « juridiquement fermee ».
       */
      l.nbKnockOutsBloquants > 0
        ? LIBELLE_REDHIBITOIRE
        // `statutScore` a `null` signifie « pas encore qualifiee » : la case reste vide plutot que de
        // fabriquer un libelle pour une absence, comme pour le statut de prospection.
        : (l.statutScore ? LIBELLES_SCORE[l.statutScore] : ''),
      // Le statut seul ne distingue pas un score faible d'une exclusion reglementaire :
      // les deux valent 'rouge'. La colonne dediee evite de relire la fiche pour trancher.
      l.nbKnockOutsBloquants > 0 ? 'oui' : 'non',
      nombre(l.scoreGlobal),
      // `null` signifie « aucun suivi ouvert », ce qui n'est pas un statut : la case reste vide,
      // plutôt que de fabriquer un libelle pour une absence.
      l.statutProspection ? STATUTS_PROSPECTION_META[l.statutProspection]?.libelle : '',
      nombre(l.distancePosteKm),
      nombre(l.lineaireRaccordementKm),
      nombre(l.pentePct),
      // `typeSol` est type `string` ici (il traverse SQL) : l'indexation est donc gardee, et la valeur
      // brute sert de repli plutot que de laisser une case vide sur une valeur inconnue de la table.
      l.typeSol ? ((LIBELLES_TYPE_SOL as Record<string, string | undefined>)[l.typeSol] ?? l.typeSol) : '',
      coordonnee(l.centroide[0]),
      coordonnee(l.centroide[1]),
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
        "Contours issus du Plan Cadastral Informatisé : indicatifs, sans valeur juridique. Scores fournis à titre d'aide à la décision.",
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
        /**
         * LES LIBELLES SONT AJOUTES, LES CLES SONT CONSERVEES — et l'asymetrie avec le CSV est
         * deliberee.
         *
         * Le CSV s'ouvre dans un tableur : son destinataire est un humain, et les cles
         * d'enumeration y ont donc ete REMPLACEES par des libelles. Le GeoJSON, lui, est consomme
         * par des programmes et des SIG, ou une cle stable est precisement ce qu'on veut : la
         * remplacer casserait tout filtre, toute regle de symbologie, tout script ecrit dessus.
         *
         * Mais un SIG affiche aussi sa table d'attributs a un humain, qui n'a pas plus la cle de
         * lecture ici qu'ailleurs. Les deux besoins ne s'opposent pas : on ajoute la colonne
         * lisible a cote de la colonne stable, ce qui ne casse rien et rend le fichier
         * comprehensible sans documentation.
         */
        statut_score_libelle: score?.statut ? LIBELLES_SCORE[score.statut] : null,
        regime_implantation_libelle: score?.regimeImplantation
          ? (LIBELLES_REGIME[score.regimeImplantation] ?? score.regimeImplantation)
          : null,
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
