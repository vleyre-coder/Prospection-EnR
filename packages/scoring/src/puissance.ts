/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA PUISSANCE ESTIMEE DU PROJET — ET LES TROIS FILIERES OU ELLE NE SE DEDUIT PAS D'UNE SURFACE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI EST DEMANDE : « la puissance estimative du projet en prenant la puissance moyenne qu'on
 * peut installer sur un hectare ». La demande est legitime — c'est le premier chiffre qu'un
 * developpeur regarde — et elle a une reponse en photovoltaique.
 *
 * ELLE N'EN A PAS DANS LES TROIS AUTRES FILIERES, et le dire est plus utile que de rendre un
 * nombre :
 *
 *   - EOLIEN : la puissance d'un parc, c'est un nombre de machines multiplie par la puissance
 *     unitaire. Le nombre de machines depend de l'espacement impose par les sillages (typiquement
 *     3 a 5 diametres de rotor), de la forme du terrain, des distances aux habitations et des
 *     servitudes radar. Deux terrains de 40 ha peuvent porter une machine ou quatre. Une densite
 *     MW/ha appliquee mecaniquement produirait un chiffre faux avec l'air d'etre calcule ;
 *   - STOCKAGE (BESS) : la puissance est fixee par le RACCORDEMENT, pas par le sol. Un conteneur
 *     occupe quelques dizaines de metres carres ; ce qui borne le projet, c'est la capacite
 *     d'accueil du poste source. Estimer depuis la surface reviendrait a ignorer la seule
 *     contrainte qui compte ;
 *   - METHANISATION : la puissance suit le TONNAGE D'INTRANTS mobilisable dans le rayon
 *     d'approvisionnement, pas l'emprise de l'unite. Un methaniseur de 500 kW et un de 2 MW
 *     occupent des surfaces voisines.
 *
 * Rendre `null` avec un motif lisible, plutot qu'un nombre plausible, est la meme regle que partout
 * ailleurs dans ce projet : ne jamais affirmer plus que ce que la methode permet.
 */

import type { Filiere } from '@enr/core';

export interface PuissanceEstimee {
  /** Puissance crete estimee, en MWc. `null` si la filiere ne se deduit pas d'une surface. */
  mwc: number | null;
  /** Densite retenue, en MWc par hectare utile. `null` si sans objet. */
  densiteMwcParHa: number | null;
  /** Comment le chiffre est obtenu, ou pourquoi il n'y en a pas. Affichable tel quel. */
  methode: string;
}

/**
 * Densites retenues en photovoltaique, en MWc par hectare CLOTURE.
 *
 * L'ordre de grandeur d'une centrale au sol contemporaine est de 1 MWc par hectare cloture, modules
 * bifaciaux et rangees espacees comprises. En agrivoltaisme la couverture est plafonnee — le decret
 * du 8 avril 2024 pose une presomption de conformite sous 40 % — donc la puissance par hectare
 * tombe environ de moitie.
 */
const DENSITE_PV_MWC_PAR_HA = 1.0;
const DENSITE_AGRIVOLTAISME_MWC_PAR_HA = 0.5;

/**
 * Estime la puissance installable a partir de la surface UTILE, quand la filiere le permet.
 *
 * La surface utile et non la surface cadastrale : c'est celle qui reste apres deduction de la bande
 * perimetrale, et c'est elle qu'on cloture. Prendre le cadastre surestimerait le projet de la
 * difference exacte que le reste du moteur s'applique a retrancher.
 */
export function puissanceEstimee(
  filiere: Filiere,
  surfaceUtileHa: number | null,
  regimeImplantation?: string | null,
): PuissanceEstimee {
  if (filiere === 'solaire_sol') {
    const agrivoltaique = regimeImplantation === 'agrivoltaisme';
    const densite = agrivoltaique ? DENSITE_AGRIVOLTAISME_MWC_PAR_HA : DENSITE_PV_MWC_PAR_HA;
    if (surfaceUtileHa == null || !Number.isFinite(surfaceUtileHa) || surfaceUtileHa <= 0) {
      return {
        mwc: null,
        densiteMwcParHa: densite,
        methode:
          'Surface utile inconnue : la puissance ne peut pas être estimée. Elle se déduit de la ' +
          'surface clôturée, pas de la contenance cadastrale.',
      };
    }
    return {
      mwc: Math.round(surfaceUtileHa * densite * 100) / 100,
      densiteMwcParHa: densite,
      methode:
        `Estimation à raison de ${agrivoltaique ? '0,5' : '1'} MWc par hectare utile` +
        (agrivoltaique
          ? ', taux de couverture agrivoltaïque plafonné (décret du 8 avril 2024).'
          : ', ordre de grandeur d’une centrale au sol contemporaine.') +
        ' Ordre de grandeur : la puissance réelle dépend du calepinage, de l’orientation des rangées ' +
        'et de la capacité d’accueil du poste source.',
    };
  }

  if (filiere === 'eolien_terrestre') {
    return {
      mwc: null,
      densiteMwcParHa: null,
      methode:
        'Non estimable depuis une surface. La puissance d’un parc est un nombre de machines ' +
        'multiplié par leur puissance unitaire ; le nombre de machines dépend de l’espacement ' +
        'imposé par les sillages, de la forme du terrain, des distances à l’habitat et des ' +
        'servitudes radar. Deux terrains de même surface peuvent porter une machine ou quatre.',
    };
  }

  if (filiere === 'bess') {
    return {
      mwc: null,
      densiteMwcParHa: null,
      methode:
        'Non estimable depuis une surface. La puissance d’un stockage est fixée par la capacité ' +
        'd’accueil du poste source, pas par l’emprise : un conteneur occupe quelques dizaines de ' +
        'mètres carrés.',
    };
  }

  return {
    mwc: null,
    densiteMwcParHa: null,
    methode:
      'Non estimable depuis une surface. La puissance d’une unité de méthanisation suit le tonnage ' +
      'd’intrants mobilisable dans le rayon d’approvisionnement, pas l’emprise de l’unité.',
  };
}
