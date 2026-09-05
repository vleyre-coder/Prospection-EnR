/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AVANT D'APPELER LE PROPRIETAIRE — CE QUE L'OPERATEUR IGNORE ENCORE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LA DEMANDE QUI A FAIT NAITRE CE FICHIER : « que quand on contacte un proprietaire foncier, il
 * n'y ait pas de surprise ». C'est un critere d'evaluation redoutable, parce qu'il ne se mesure
 * pas en points de score : une parcelle peut afficher 82/100 et le premier appel s'arreter net.
 *
 * CE QUE L'AUDIT A TROUVE, en cherchant les mots plutot qu'en supposant. Sur 43 criteres et
 * 12 familles, la famille FONCIER n'en comptait que deux — nombre de proprietaires, facilite de
 * maitrise. Et quatre notions qui arretent une negociation n'apparaissaient NULLE PART dans le
 * depot, recherche faite sur l'ensemble des sources :
 *
 *   - « fermage », « fermier », « eviction » : zero occurrence ;
 *   - « preemption », « SAFER » : zero occurrence ;
 *   - « enclave » : zero occurrence.
 *
 * Autrement dit l'outil savait dire qu'une parcelle est « agricole exploitee » — il l'ecrit sur la
 * fiche — sans jamais en tirer la consequence : s'il y a une culture, il y a un exploitant, et si
 * le proprietaire n'est pas cet exploitant, c'est le FERMIER qui decide. C'est la surprise la plus
 * banale de la prospection fonciere, et la donnee etait deja en base.
 *
 * CE QUE CE MODULE N'EST PAS. Ce ne sont pas des criteres : ils ne notent rien et ne changent aucun
 * score. Un bail rural ne rend pas un terrain moins ensoleille — il rend l'accord plus long, ou
 * impossible. Les melanger au score reviendrait a confondre « ce terrain vaut-il quelque chose » et
 * « puis-je l'obtenir », qui sont deux questions distinctes et se posent dans cet ordre.
 *
 * CE QU'IL PROMET, ET CE QU'IL NE PROMET PAS. Chaque point dit ce que la donnee montre, ce qu'elle
 * ne peut pas montrer, et la question a poser. Aucun ne conclut a la place de l'operateur : le RPG
 * ne publie pas l'identite de l'exploitant, aucune source nationale ne publie les perimetres SAFER,
 * et le cadastre ne dit pas si une succession est reglee. Un point qui affirmerait « bail rural en
 * cours » serait exactement la faute que ce projet traque depuis dix audits.
 */

import type { Filiere, ParcelleSnapshot } from '@enr/core';

/**
 * Gravite d'un point a verifier.
 *
 * Elle ne dit PAS la probabilite, elle dit ce que l'operateur risque de decouvrir trop tard :
 *
 *   - `arret` : peut arreter la negociation, quel que soit l'interet du terrain ;
 *   - `delai` : ne l'arrete pas, mais deplace le calendrier de plusieurs mois ;
 *   - `contexte` : change l'interlocuteur ou la forme de la demarche.
 */
export type GraviteVerification = 'arret' | 'delai' | 'contexte';

export interface VerificationAvantContact {
  id: string;
  gravite: GraviteVerification;
  titre: string;
  /** Ce que la donnee montre, ce qu'elle ne montre pas, et la question a poser. */
  texte: string;
  /** Question a poser telle quelle au proprietaire. */
  question: string;
  /** Identifiant de la regle du referentiel qui la fonde, s'il y en a une. */
  regleLiee?: string;
}

/** Les filieres qui laissent l'exploitation agricole se poursuivre sur place. */
const FILIERES_COMPATIBLES_AGRICULTURE = new Set<Filiere>(['methanisation']);

/**
 * Les verifications a faire avant de contacter le proprietaire, pour cette parcelle et cette
 * filiere.
 *
 * FONCTION PURE : elle ne lit que le snapshot deja constitue. Aucun appel reseau, aucune requete —
 * donc testable en entier sans base ni service exterieur, ce qui est la condition pour que ces
 * phrases-la soient reellement gardees.
 */
export function verificationsAvantContact(
  s: ParcelleSnapshot,
  filiere: Filiere,
  options?: { regimeImplantation?: string | null },
): VerificationAvantContact[] {
  const points: VerificationAvantContact[] = [];
  const agrivoltaisme = options?.regimeImplantation === 'agrivoltaisme';

  // --- Le fermier en place ---------------------------------------------------------------
  const annees = s.occupationSol.rpg.anneesDeclareesConsecutives;
  const recouvrement = s.occupationSol.rpg.partRecouvrement;
  const exploitee =
    (annees != null && annees > 0) || (recouvrement != null && recouvrement > 0.1);
  if (exploitee) {
    /*
     * LE POINT LE PLUS UTILE DE CE FICHIER, et le moins cher : la donnee etait deja la.
     *
     * Une declaration a la PAC prouve qu'un EXPLOITANT travaille la parcelle. Elle ne dit pas qui :
     * le RPG est anonymise. Le proprietaire peut donc etre cet exploitant — auquel cas il n'y a
     * rien a negocier de plus — ou un bailleur, auquel cas le preneur a un droit au renouvellement
     * et une indemnite d'eviction. Les deux cas se ressemblent parfaitement dans les donnees.
     */
    const duree =
      annees != null && annees > 0
        ? `déclarée à la PAC sur ${annees} campagne${annees > 1 ? 's' : ''} consécutive${annees > 1 ? 's' : ''}`
        : 'couverte par un îlot déclaré à la PAC';
    points.push({
      id: 'bail_rural',
      gravite: agrivoltaisme || FILIERES_COMPATIBLES_AGRICULTURE.has(filiere) ? 'delai' : 'arret',
      titre: 'Un exploitant travaille cette parcelle',
      texte:
        `La parcelle est ${duree} : quelqu’un la cultive. Le RPG n’indique pas qui — il est ` +
        'anonymisé — donc rien ne permet de savoir depuis les données si le propriétaire ' +
        'l’exploite lui-même. S’il ne l’exploite pas, la mise à disposition est présumée bail ' +
        'rural même sans écrit, et c’est le preneur qui décide : il a un droit au renouvellement, ' +
        'et sortir la terre de l’usage agricole suppose son accord ou une résiliation assortie ' +
        'd’une indemnité d’éviction. ' +
        (agrivoltaisme || FILIERES_COMPATIBLES_AGRICULTURE.has(filiere)
          ? 'Ici l’exploitation se poursuit : le bail n’est pas à rompre, mais il est à avenanter, ' +
            'et le partage de la valeur se négocie à trois.'
          : 'Ici la terre quitte l’usage agricole : l’accord du preneur est une condition, pas une ' +
            'formalité.'),
      question:
        'Exploitez-vous vous-même cette parcelle ? Sinon, qui la cultive, et depuis quand ?',
      regleLiee: 'commun_bail_rural',
    });
  }

  // --- Qui decide ------------------------------------------------------------------------
  const nb = s.foncier.nbProprietairesEstime;
  if (s.foncier.proprietairePublic === true) {
    points.push({
      id: 'proprietaire_public',
      gravite: 'contexte',
      titre: 'Le propriétaire est une personne publique',
      texte:
        'Le compte cadastral est public (commune, État, établissement public…). La démarche n’est ' +
        'pas une négociation de gré à gré : l’occupation en vue d’une exploitation économique passe ' +
        'par une procédure de sélection préalable, et la décision par une délibération. Le ' +
        'calendrier ne se compare pas à celui d’un propriétaire privé.',
      question:
        'Quelle est la procédure prévue — mise en concurrence, appel à projets — et quel est le ' +
        'calendrier des délibérations ?',
      regleLiee: 'commun_proprietaire_public',
    });
  } else if (nb != null && nb > 1) {
    points.push({
      id: 'plusieurs_proprietaires',
      gravite: 'delai',
      titre: `${nb} comptes cadastraux sur cette parcelle`,
      texte:
        `Le cadastre porte ${nb} comptes : l’accord doit être unanime, et un seul refus suffit. ` +
        (s.foncier.indivisionProbable === true
          ? 'L’indivision est probable — souvent une succession non réglée, où les indivisaires ne ' +
            'sont pas tous identifiés ni joignables.'
          : 'Le cadastre ne dit pas si ces comptes relèvent d’une indivision ou de propriétés ' +
            'distinctes.'),
      question:
        'Êtes-vous seul décisionnaire, ou d’autres personnes doivent-elles donner leur accord ?',
    });
  } else if (nb == null) {
    /*
     * L'ABSENCE DE DONNEE EST ELLE-MEME UN POINT. Sans cette ligne, une fiche sans information de
     * propriete se lit « un seul proprietaire » — c'est-a-dire le cas le plus simple — alors que
     * l'application n'en sait rien. C'est exactement la confusion que le reste du projet combat.
     */
    points.push({
      id: 'propriete_inconnue',
      gravite: 'contexte',
      titre: 'La propriété n’est pas renseignée',
      texte:
        'L’application ne dispose d’aucune information de propriété pour cette parcelle : ni le ' +
        'nombre de comptes, ni l’indivision, ni le caractère public. Ce n’est pas « un seul ' +
        'propriétaire », c’est « on ne sait pas ». Les données de propriété relèvent d’une demande ' +
        'encadrée auprès du service de la publicité foncière ou de la mairie.',
      question: 'À obtenir avant l’appel : relevé de propriété.',
    });
  }

  // --- L'acces ---------------------------------------------------------------------------
  const distanceVoirie = s.acces.distanceVoirieM;
  if (distanceVoirie != null && distanceVoirie > 0) {
    points.push({
      id: 'acces_par_un_tiers',
      gravite: 'arret',
      titre: 'La parcelle ne touche aucune voirie',
      texte:
        `La voirie carrossable la plus proche est à ${Math.round(distanceVoirie)} m : l’accès ` +
        'traversera un fonds voisin. Une servitude de passage se négocie avec un TIERS, qui n’est ' +
        'pas votre interlocuteur et n’a aucun intérêt au projet. Le droit de passage pour cause ' +
        'd’enclave existe, mais son assiette et son indemnité se discutent — et il ne garantit pas ' +
        'un gabarit poids lourds, indispensable en phase chantier.',
      question:
        'Par où accède-t-on à la parcelle aujourd’hui, et sur le terrain de qui ? Existe-t-il une ' +
        'servitude écrite ?',
      regleLiee: 'commun_parcelle_enclavee',
    });
  }

  // --- La forme de l'accord --------------------------------------------------------------
  if (exploitee || s.occupationSol.typeSol === 'agricole_exploite') {
    points.push({
      id: 'preemption_safer',
      gravite: 'contexte',
      titre: 'En cas de vente, la SAFER peut préempter',
      texte:
        'La préemption des SAFER vise les aliénations à titre onéreux de biens agricoles. Un bail ' +
        'emphytéotique ou à construction — la forme habituelle d’un projet ENR — n’est pas une ' +
        'aliénation et y échappe en principe ; une vente, non. Aucune source nationale ne publie ' +
        'les périmètres d’intervention : la SAFER compétente se consulte, elle ne se déduit pas des ' +
        'données.',
      question:
        'Souhaitez-vous vendre ou louer ? La forme retenue change les intervenants et le calendrier.',
      regleLiee: 'commun_preemption_safer',
    });
  }

  return points;
}
