/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE POTENTIEL D'UNE COMMUNE — ce que l'on peut dire d'un territoire SANS l'avoir qualifie
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI MANQUAIT, ET CE QUE L'ECRAN MONTRAIT A LA PLACE. La colonne `commune_score_filiere.potentiel`
 * existe depuis l'origine, avec ce commentaire dans le schema : « indicateur de potentiel 0-100,
 * calcule sur des criteres disponibles a l'echelle communale ». Elle n'etait ECRITE PAR AUCUN CODE.
 *
 * Et la carte nationale, elle, ne l'utilisait pas : elle colorait les communes par la part de VERT
 * parmi les parcelles DEJA QUALIFIEES, en laissant transparentes celles qui n'en ont aucune. Or
 * presque aucune commune n'en a. La vue nationale etait donc vide, pendant que sa legende annoncait
 * « potentiel par commune » — deux choses differentes, dont l'une n'existait pas.
 *
 * ═══ CE QUE CET INDICATEUR EST, ET CE QU'IL N'EST PAS
 *
 * Il repond a UNE question, et une seule : « par ou commencer a regarder ». Ce n'est pas un score de
 * parcelle, il ne dit rien d'un terrain precis, et il ne remplace aucune qualification. Il est
 * calcule sur les deux seules grandeurs disponibles pour les 34 875 communes de France.
 *
 * ═══ AXE 1 — LE RACCORDEMENT, ET C'EST UNE MESURE
 *
 * Distance du territoire communal au poste source le plus proche, passee par la MEME courbe que le
 * critere de la fiche parcelle. Le partage n'est pas une economie de code : deux baremes distincts
 * finiraient par se contredire, et l'operateur verrait une commune verte remplie de parcelles
 * oranges sur le meme motif. Distribution mesuree sur les 34 875 communes : mediane 4,4 km,
 * p90 10,2 km, p99 16,4 km.
 *
 * ═══ AXE 2 — LA DISPONIBILITE FONCIERE, ET C'EST UN PROXY QUI SE DECLARE
 *
 * LE DEFAUT QUE CET AXE EVITE. Le raccordement seul aurait rendu PARIS VERT : la capitale est a
 * quelques centaines de metres d'un poste source. Une carte qui designe Paris comme terrain de
 * prospection photovoltaique au sol est exactement le « faux positif confiant » que ce depot traque.
 *
 * La densite de population est le seul indicateur de disponibilite fonciere present nationalement.
 * C'est un PROXY, et il ne faut pas le vendre pour autre chose : il ne mesure pas le sol, il mesure
 * l'habitat. Une commune peu dense a probablement du foncier ouvert ; une commune dense n'en a
 * probablement pas. « Probablement » est le mot juste, et le libelle de l'axe le dit.
 *
 * SES PALIERS SONT DES PERCENTILES MESURES, pas des chiffres choisis :
 *
 *     p10    9,7 hab/km2        p75     97,4        p97     878,1
 *     p25   18,2                p90    251,5        p99    2 523,6
 *     mediane 40,4
 *
 * La moitie rurale de la France est donc a 100, et les 3 % les plus urbains sous 25.
 *
 * ═══ POURQUOI LE MINIMUM ET NON UNE MOYENNE
 *
 * Un projet a besoin des DEUX : du reseau et du sol. Une commune tres bien raccordee mais entierement
 * batie ne vaut rien pour la prospection ; une commune vide a 60 km de tout poste non plus. Une
 * moyenne ponderee les compenserait l'une par l'autre et produirait un « milieu » qui ne correspond
 * a aucun territoire reel. Le facteur LIMITANT gouverne — c'est aussi la lecture prudente, et celle
 * que le reste du moteur applique deja avec ses limites de viabilite.
 *
 * ═══ ET L'ABSENCE D'UN SEUL AXE SUFFIT A NE RIEN CONCLURE
 *
 * Les DEUX axes sont exiges. Ma premiere version prenait le minimum des axes disponibles, et une
 * commune rurale sans poste source ingere ressortait alors a « 100, VERT » : l'absence de la donnee
 * la plus determinante se lisait comme une bonne nouvelle. Une commune dont un axe manque est donc
 * GRISE, jamais notee — et le detail dit lequel manque, pour que le gris soit diagnosticable.
 */

import type { Feu, Filiere } from '@enr/core';
import { PONDERATIONS_DEFAUT } from '@enr/core';
import { COURBE_DISTANCE_POSTE } from './criteres-eval.js';
import { lineaireRaccordementKm } from './implantation.js';
import { paliers, type Palier } from './notes.js';

/**
 * Note de disponibilite fonciere presumee, en habitants par kilometre carre.
 *
 * Les abscisses sont les percentiles releves sur les 34 875 communes (voir l'en-tete). Les
 * ordonnees traduisent une lecture de prospection : au-dessous de la mediane on est en rural
 * ouvert, au-dela du p97 on est en ville et il n'y a pas de foncier au sol a chercher.
 */
export const COURBE_DENSITE: readonly Palier[] = [
  [0, 100],
  [40, 100],
  [100, 85],
  [250, 60],
  [880, 25],
  [2500, 5],
  [5000, 0],
];

export interface AxePotentiel {
  /** Note 0-100, ou `null` si la donnee de cet axe manque. */
  note: number | null;
  /** Valeur brute mesuree, dans l'unite de l'axe. */
  valeur: number | null;
  /** Ce que l'axe mesure, en toutes lettres — repris tel quel a l'ecran. */
  libelle: string;
}

export interface PotentielCommunal {
  /** Indicateur 0-100, ou `null` si aucun axe n'est renseigne. */
  potentiel: number | null;
  statut: Feu;
  axes: Record<string, AxePotentiel>;
  /** L'axe qui gouverne, c'est-a-dire le plus faible. `null` si le potentiel est inconnu. */
  facteurLimitant: string | null;
  methode: string;
}

export interface EntreePotentiel {
  /** Distance du territoire communal au poste source le plus proche, a vol d'oiseau, en km. */
  distancePosteKm: number | null;
  /** Densite de population, en habitants par kilometre carre. */
  densiteHabKm2: number | null;
}

/**
 * Indicateur de potentiel d'une commune pour une filiere.
 *
 * FONCTION PURE : elle ne lit aucune base. C'est ce qui permet de la tester sur les cas qui
 * comptent — Paris bien raccordee mais batie, une commune rurale isolee, une commune sans aucune
 * donnee — sans dependre de ce qu'une base contient ce jour-la.
 */
export function potentielCommunal(entree: EntreePotentiel, filiere: Filiere): PotentielCommunal {
  const raccordement: AxePotentiel = {
    note:
      entree.distancePosteKm == null || !Number.isFinite(entree.distancePosteKm)
        ? null
        : // Le LINEAIRE estime, pas le vol d'oiseau : les abscisses de la courbe sont dans cette
          // unite, et c'est le lineaire qui se paie. Meme conversion que la fiche parcelle.
          paliers(lineaireRaccordementKm(entree.distancePosteKm), COURBE_DISTANCE_POSTE[filiere]),
    valeur: entree.distancePosteKm,
    libelle: 'Distance au poste source le plus proche',
  };

  const foncier: AxePotentiel = {
    note:
      entree.densiteHabKm2 == null || !Number.isFinite(entree.densiteHabKm2)
        ? null
        : paliers(entree.densiteHabKm2, COURBE_DENSITE),
    valeur: entree.densiteHabKm2,
    libelle: 'Disponibilité foncière présumée (densité de population)',
  };

  const axes = { raccordement, foncier };
  const manquants = Object.entries(axes).filter(([, a]) => a.note == null);

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * TOUS LES AXES SONT EXIGES — le defaut trouve en eprouvant la fonction sur ses cas limites
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * MA PREMIERE VERSION prenait le minimum des axes DISPONIBLES. Consequence mesuree : une commune
   * rurale dont aucun poste source n'est ingere ressortait a « 100, VERT » — le seul axe renseigne
   * etant la densite, et elle etant excellente. Autrement dit l'absence de la donnee la plus
   * determinante se lisait comme une bonne nouvelle, sur la carte que l'operateur regarde en
   * premier. C'est exactement la faute que ce depot traque depuis quinze audits.
   *
   * Un potentiel partiel n'est donc pas rendu. Le detail dit lequel des axes manque, ce qui rend
   * l'absence diagnosticable — une commune grise apres ingestion des postes signale un trou de
   * couverture, pas un mauvais territoire.
   */
  if (manquants.length > 0) {
    return {
      potentiel: null,
      statut: 'gris',
      axes,
      facteurLimitant: null,
      methode:
        `Non noté : ${manquants.map(([, a]) => a.libelle.toLowerCase()).join(' et ')} ` +
        `${manquants.length > 1 ? 'sont inconnus' : 'est inconnu'}. Ce n’est PAS un potentiel ` +
        'faible, c’est un potentiel inconnu — un projet a besoin des deux, et il en manque un.',
    };
  }

  const notees = Object.entries(axes).filter(
    (e): e is [string, AxePotentiel & { note: number }] => e[1].note != null,
  );

  const [nomLimitant, axeLimitant] = notees.reduce((a, b) => (b[1].note < a[1].note ? b : a));
  const potentiel = Math.round(axeLimitant.note * 10) / 10;

  /*
   * LES SEUILS DE COULEUR SONT CEUX DE LA FILIERE, repris du profil de ponderation par defaut.
   * Une echelle de couleurs propre a la carte nationale ferait qu'une commune « verte » n'aurait
   * pas le meme sens qu'une parcelle verte, sur le meme ecran et dans la meme palette.
   */
  const seuils = PONDERATIONS_DEFAUT[filiere];
  const statut: Feu =
    potentiel >= seuils.seuilVert ? 'vert' : potentiel >= seuils.seuilOrange ? 'orange' : 'rouge';

  return {
    potentiel,
    statut,
    axes,
    facteurLimitant: nomLimitant,
    methode:
      `Facteur limitant : ${axeLimitant.libelle.toLowerCase()}. Un projet a besoin du réseau ET ` +
      'du sol : c’est donc le plus faible des deux axes qui gouverne, et non leur moyenne. ' +
      'Indicateur de priorisation à l’échelle communale — il ne qualifie aucune parcelle.',
  };
}
