/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA NOTE QUI ACCOMPAGNE LA FICHE — ce qu'on lit AVANT d'ouvrir la piece jointe
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI ELLE EXISTE. La fiche PDF porte tout : le verdict, les cartes, les critères un par un,
 * les sources. C'est exactement ce qui la rend impossible à lire dans un fil de discussion. Un
 * destinataire qui reçoit un document de six pages sans un mot décide, en trois secondes, s'il
 * l'ouvre — et ces trois secondes se jouent sur le corps du courriel.
 *
 * ═══ CE QUE LA NOTE DIT, ET DANS QUEL ORDRE
 *
 * L'ordre n'est pas décoratif : il suit les questions d'un développeur qui qualifie un terrain.
 * Où est-ce et combien ça fait, quel est le verdict et sur quoi il repose, ce qui bloque, ce qui
 * reste à vérifier. Le détail est dans la pièce jointe ; la note dit s'il vaut la peine d'y aller.
 *
 * ═══ CE QU'ELLE NE FAIT PAS
 *
 * ELLE NE PORTE NI EXPÉDITEUR NI SIGNATURE. Le courriel part de la messagerie professionnelle de
 * l'opérateur, qui pose déjà l'un en en-tête et l'autre dans le corps ; les écrire ici afficherait
 * la signature EN DOUBLE. C'est le même arbitrage que pour les courriers aux propriétaires.
 *
 * ELLE NE PORTE AUCUNE DONNÉE DE PROPRIÉTÉ. Un courriel se transfère, s'archive et sort du
 * dispositif de journalisation dès qu'il est parti. Le nom d'un propriétaire n'a rien à y faire :
 * c'est une note technique sur un terrain, pas sur une personne.
 *
 * ELLE N'AFFIRME RIEN QUE LE SCORE N'AFFIRME. Une couverture insuffisante est écrite comme telle,
 * jamais tue : c'est la différence entre « aucune contrainte » et « aucune contrainte regardée ».
 */

import { LIBELLES_SCORE, LIBELLES_REGIME, type ParcelleSnapshot, type ResultatScore } from '@enr/core';
import { FILIERES_META } from '@enr/core';
import type { ParcelleEnBase } from '../depots/parcelles.js';
import type { Courrier } from './courriers.js';
import {
  chiffresDuSite,
  type ContexteDossier,
  type ParcelleDuDossier,
} from './exports.js';

/** Un nombre tel que le français l'écrit : virgule décimale, jamais de point. */
function nb(v: number | null | undefined, decimales = 2): string {
  return v == null ? '-' : v.toFixed(decimales).replace('.', ',');
}

/**
 * La surface, dite avec sa PROVENANCE.
 *
 * LES DEUX NE SONT PAS LA MEME GRANDEUR. La contenance cadastrale est une valeur juridique portée
 * au plan ; la surface calculée est mesurée sur le contour, et les deux diffèrent régulièrement de
 * quelques pour cent. Écrire « 5,29 ha au cadastre » en donnant la seconde — ce que faisait la
 * première version, et ce qu'un test a relevé — attribue au cadastre un chiffre qui n'est pas le
 * sien, dans un message qui sort de l'application.
 */
function surfaceDite(p: ParcelleEnBase): string {
  if (p.contenanceM2 != null) return `${nb(p.contenanceM2 / 10000)} ha au cadastre`;
  if (p.surfaceCalculeeM2 != null) {
    return `${nb(p.surfaceCalculeeM2 / 10000)} ha mesurés sur le contour (contenance cadastrale absente)`;
  }
  return 'surface inconnue';
}

/**
 * La note technique d'une parcelle, en texte brut.
 *
 * Texte BRUT et non HTML : un courriel de prospection se relit et se complète avant de partir, et
 * un corps en HTML se modifie mal dans un client de messagerie. La fiche jointe porte la mise en
 * forme ; le corps porte les faits.
 */
export function noteParcelle(
  parcelle: ParcelleEnBase,
  snapshot: ParcelleSnapshot,
  score: ResultatScore,
): Courrier {
  const meta = FILIERES_META[score.filiere];
  const commune = parcelle.nomCommune ?? parcelle.codeInsee;

  const lignes: string[] = [];

  lignes.push(
    `Parcelle ${parcelle.section} ${parcelle.numero} - ${commune} (${parcelle.codeDepartement})`,
    `IDU ${parcelle.idu} - ${surfaceDite(parcelle)}`,
    `Filière étudiée : ${meta.libelle}`,
    '',
  );

  // ═══ le verdict, et ce qui le fonde
  const couverture = Math.round(score.couvertureDonnees * 100);
  lignes.push(
    `VERDICT : ${LIBELLES_SCORE[score.statut]}` +
      (score.scoreGlobal != null ? ` - ${score.scoreGlobal.toFixed(0)}/100` : ''),
    `Couverture des données : ${couverture} %`,
  );
  if (score.regimeImplantation) {
    lignes.push(
      `Régime d'implantation : ${LIBELLES_REGIME[score.regimeImplantation] ?? score.regimeImplantation}`,
    );
  }
  lignes.push('');

  // ═══ ce qui bloque
  if (score.knockOuts.length > 0) {
    lignes.push('CE QUI BLOQUE OU CONDITIONNE :');
    for (const k of score.knockOuts) {
      lignes.push(`- ${k.derogeable ? '[dérogeable]' : '[bloquant]'} ${k.libelle} : ${k.motif}`);
    }
    lignes.push('');
  }

  if (score.limitesViabilite.length > 0) {
    lignes.push('LIMITES DE VIABILITÉ ÉCONOMIQUE :');
    for (const l of score.limitesViabilite) lignes.push(`- ${l.libelle} : ${l.motif}`);
    lignes.push('');
  }

  // ═══ les points saillants, tels que la fiche les calcule — jamais recalculés ici
  if (score.pointsForts.length > 0) {
    lignes.push('ATOUTS :');
    for (const p of score.pointsForts) lignes.push(`- ${p.libelle} : ${p.valeur}`);
    lignes.push('');
  }
  if (score.pointsVigilance.length > 0) {
    lignes.push('POINTS DE VIGILANCE :');
    for (const p of score.pointsVigilance) lignes.push(`- ${p.libelle} : ${p.valeur}`);
    lignes.push('');
  }

  // ═══ le raccordement, que tout développeur demande en premier
  const poste = snapshot.raccordement.posteLePlusProche;
  if (poste) {
    lignes.push(
      `Poste source le plus proche : ${poste.nom}, ${nb(poste.distanceKm, 1)} km à vol d'oiseau.`,
      '',
    );
  }

  /*
   * L'INCERTITUDE EST ÉCRITE, ET ELLE VIENT AVANT LA PIÈCE JOINTE. Une couverture insuffisante ne
   * veut pas dire « pas de contrainte » : elle veut dire que personne n'a regardé. Le taire dans
   * le corps d'un courriel, alors que la fiche le dit, reviendrait à laisser le lecteur pressé —
   * celui qui n'ouvrira pas la pièce jointe — repartir avec la conclusion inverse.
   */
  if (score.statut === 'gris') {
    lignes.push(
      "ATTENTION : la couverture des données est insuffisante pour conclure. Les critères non " +
        "renseignés ne sont pas des critères sans contrainte : ils n'ont pas été évalués.",
      '',
    );
  }

  lignes.push(
    'La fiche complète est jointe : cartes de situation et d’environnement, critères détaillés, ' +
      'sources et millésimes, et ce qui reste à vérifier avant tout dépôt.',
    '',
    "Document d'aide à la décision, pas une garantie de faisabilité. Le contour cadastral est " +
      'indicatif et sans valeur juridique.',
  );

  return {
    objet: `${commune} - parcelle ${parcelle.section} ${parcelle.numero} - ${meta.libelleCourt}`,
    corps: lignes.join('\n'),
    /*
     * AUCUN TROU À COMPLÉTER, et c'est une différence de nature avec les courriers. Un courrier au
     * propriétaire porte des mentions que seul l'opérateur peut écrire ; cette note-ci ne dit que
     * ce que l'application a mesuré. Un trou y serait un aveu que la fiche est incomplète.
     */
    aCompleter: [],
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA NOTE D'UN SITE — ce qu'on lit avant d'ouvrir un dossier de plusieurs parcelles
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ELLE NE RECALCULE RIEN. La surface utile et la puissance sont les deux chiffres les plus repris
 * d'un dossier — ceux qu'un développeur recopie dans son modèle économique. Les recalculer ici
 * créerait DEUX VÉRITÉS, et le jour où l'une des deux bouge, rien ne signalerait que l'autre n'a
 * pas suivi. Elle appelle donc `chiffresDuSite`, la fonction même dont le PDF se sert.
 *
 * ELLE DIT CE QUI EST EXPLOITABLE, PAS SEULEMENT CE QUI EST SÉLECTIONNÉ. Un site dont trois
 * parcelles sur douze portent un rédhibitoire bloquant n'a pas la surface qu'annonce la sélection.
 * Le dossier rend les deux chiffres côte à côte pour cette raison ; la note fait de même, sans quoi
 * le lecteur pressé repartirait avec le plus flatteur des deux.
 */
export function noteSite(
  parcelles: ParcelleDuDossier[],
  contexte: ContexteDossier,
): Courrier {
  const meta = FILIERES_META[contexte.filiere];
  const chiffres = chiffresDuSite(parcelles, contexte);
  const communes = [
    ...new Set(parcelles.map((p) => p.parcelle.nomCommune ?? p.parcelle.codeInsee)),
  ].sort();

  const lignes: string[] = [];
  lignes.push(
    `Site de ${parcelles.length} parcelle${parcelles.length > 1 ? 's' : ''} - ` +
      (communes.length <= 3 ? communes.join(', ') : `${communes.slice(0, 3).join(', ')} et ${communes.length - 3} autres`),
    `Filière étudiée : ${meta.libelle}`,
    `Emprise : ${chiffres.emprise}`,
    '',
    `Surface utile estimée : ${nb(chiffres.surface.netteHa)} ha`,
  );
  if (chiffres.puissance.mwc != null) {
    lignes.push(`Puissance estimée : ${nb(chiffres.puissance.mwc)} MWc`);
  }

  /*
   * LE CHIFFRE EXPLOITABLE, À CÔTÉ DU CHIFFRE TOTAL. C'est le défaut que le dossier a corrigé
   * avant nous : annoncer une surface qui compte du foncier juridiquement hors d'atteinte, pendant
   * qu'une autre section dit que ces parcelles sont écartées. Deux affirmations contradictoires
   * dans le même message, et c'est la première, la plus visible, qui est fausse.
   */
  if (chiffres.partiel && chiffres.surfaceExploitable != null) {
    lignes.push(
      '',
      `ATTENTION : ${parcelles.length - chiffres.exploitables.length} parcelle(s) portent un ` +
        'critère rédhibitoire bloquant. Hors celles-ci, la surface utile tombe à ' +
        `${nb(chiffres.surfaceExploitable.netteHa)} ha` +
        (chiffres.puissanceExploitable?.mwc != null
          ? ` et la puissance à ${nb(chiffres.puissanceExploitable.mwc)} MWc.`
          : '.'),
    );
  }

  if (chiffres.regimes.size > 1) {
    lignes.push(
      '',
      "Le régime d'implantation est hétérogène selon les parcelles : c'est la densité la plus " +
        'basse qui est retenue, soit le chiffrage prudent.',
    );
  }

  lignes.push(
    '',
    'Le dossier complet est joint : cartes de situation et d’environnement, verdict réglementaire ' +
      'parcelle par parcelle, réserves, procédures applicables et sources.',
    '',
    "Document d'aide à la décision, pas une garantie de faisabilité. Les contours cadastraux sont " +
      'indicatifs et sans valeur juridique.',
  );

  return {
    objet:
      `${communes[0] ?? 'Site'}${communes.length > 1 ? ' et alentours' : ''} - site de ` +
      `${parcelles.length} parcelle${parcelles.length > 1 ? 's' : ''} - ${meta.libelleCourt}`,
    corps: lignes.join('\n'),
    aCompleter: [],
  };
}
