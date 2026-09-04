/**
 * Bornes de vraisemblance des grandeurs physiques du snapshot.
 *
 * POURQUOI CE MODULE EXISTE. Le quatrieme audit a trouve que 7 parcelles reelles sur 49 portaient
 * une pente de plus de 100 %, jusqu'a 1 666 % pour 1,8 m de denivele. Le calcul est corrige et
 * teste, mais le vrai enseignement etait ailleurs : **la valeur avait ete ECRITE en base sans que
 * rien ne s'y oppose**, et elle y a survecu trois audits parce qu'aucun test ne l'imaginait.
 *
 * Un test unitaire verifie ce qu'on a pense a verifier. Une borne de vraisemblance attrape ce
 * qu'on n'a pas imagine — un connecteur qui change d'unite, une API qui renvoie des pieds au lieu
 * de metres, une regression numerique dans un calcul non teste. C'est le seul garde-fou qui
 * protege des defauts a venir plutot que des defauts connus.
 *
 * CE QU'ELLES FONT, ET CE QU'ELLES NE FONT PAS. Une valeur hors bornes est ramenee a `null`, JAMAIS
 * ecretee. Ecreter fabriquerait une valeur plausible a partir d'une valeur fausse : une pente de
 * 1 666 % deviendrait 100 %, ce qui est encore faux mais ne se voit plus. `null` produit un critere
 * GRIS et abaisse la couverture de donnees — l'application dit alors qu'elle ne sait pas, ce qui
 * est exact.
 *
 * COMMENT LES BORNES SONT CHOISIES. Chacune rejette l'IMPOSSIBLE, pas l'improbable. Une pente de
 * 80 % existe en France, une pente de 200 % n'est pas un terrain. Le seuil est donc pose au-dela
 * du cas reel le plus extreme connu, avec sa justification : une borne trop serree ecarterait des
 * parcelles legitimes, ce qui serait un defaut plus grave que celui qu'elle corrige.
 */

import type { ParcelleSnapshot } from './types.js';

export interface BorneGrandeur {
  /** Chemin pointe dans le snapshot, ex. `topographie.pentePct`. */
  chemin: string;
  min: number;
  max: number;
  unite: string;
  /** Justification de la borne. Une borne sans motif finit par etre resserree a tort. */
  motif: string;
}

/**
 * Bornes des grandeurs physiques, France metropolitaine et departements d'outre-mer.
 *
 * Les champs booleens, textuels et enumeres n'y figurent pas : leur validite est portee par le
 * typage. Seules les grandeurs NUMERIQUES peuvent prendre une valeur syntaxiquement correcte et
 * physiquement absurde.
 */
export const BORNES_SNAPSHOT: readonly BorneGrandeur[] = [
  // -- Topographie ---------------------------------------------------------
  {
    chemin: 'topographie.pentePct',
    min: 0,
    max: 100,
    unite: '%',
    motif:
      "100 % vaut 45 degrés. Aucune parcelle cadastrale exploitable n'à une pente MOYENNE de " +
      "45 degrés : au-delà on decrit une falaise, pas un terrain. C'est la borne qui aurait " +
      'arrêté les 1 666 % constates.',
  },
  {
    chemin: 'topographie.penteMaxPct',
    min: 0,
    max: 200,
    unite: '%',
    motif:
      'Plus permissive que la pente moyenne, et a dessein : la pente MAXIMALE est une mesure ' +
      'locale entre deux points, et un talus ou un front de taille à l’intérieur d’une parcelle ' +
      'peut dépasser 45 degrés sans que la parcelle soit une falaise.',
  },
  {
    chemin: 'topographie.orientationDeg',
    min: 0,
    max: 360,
    unite: '°',
    motif:
      'Azimut en degrés. 360 est accepte comme synonyme de 0 plutôt que refuse sur une question ' +
      'de convention : le calcul normalise dans [0, 360[ mais un arrondi peut produire 360, et ' +
      "effacer une orientation juste pour un demi-degré serait un défaut, pas une protection.",
  },
  {
    chemin: 'topographie.altitudeM',
    min: -20,
    max: 4810,
    unite: 'm',
    motif:
      'Le point le plus bas de France métropolitaine est dans le delta du Rhône, a environ -2 m ; ' +
      '-20 laisse la marge d’une donnée altimétrique bruitée en zone de polder. Le plafond est le ' +
      'sommet du Mont-Blanc. Une altitude hors de cet intervalle designe une erreur de source ou ' +
      "une confusion d'unité, pas un terrain français.",
  },
  {
    chemin: 'topographie.deniveleM',
    min: 0,
    max: 1500,
    unite: 'm',
    motif:
      'Dénivelé à l’intérieur d’UNE parcelle cadastrale. 1 500 m est déjà extraordinaire — cela ' +
      'suppose une parcelle de montagne de plusieurs centaines d’hectares. Au-delà, la géométrie ' +
      'ou le semis altimétrique est en cause.',
  },
  { chemin: 'topographie.cavitesProches', min: 0, max: 100_000, unite: 'cavites', motif: "Dénombrement d'objets dans un rayon de proximité. Un compte de cet ordre ne designe pas un territoire dense mais une requête spatiale qui a perdu son filtre d'emprise et compte tout le département." },
  { chemin: 'topographie.mouvementsTerrain', min: 0, max: 100_000, unite: 'evenements', motif: "Dénombrement d'objets dans un rayon de proximité. Un compte de cet ordre ne designe pas un territoire dense mais une requête spatiale qui a perdu son filtre d'emprise et compte tout le département." },

  // -- Eau -----------------------------------------------------------------
  {
    chemin: 'eau.distanceCoursEauM',
    min: 0,
    max: 100_000,
    unite: 'm',
    motif:
      'Aucun point de France n’est à plus de quelques dizaines de kilomètres d’un cours d’eau ' +
      'recense. 100 km est une borne large qui ne rejette que l’absurde.',
  },
  {
    chemin: 'eau.captageAep.distanceM',
    min: 0,
    max: 200_000,
    unite: 'm',
    motif:
      'Distance au périmètre de protection de captage le plus proche. La France en compte plus de ' +
      '33 000 : aucun point du territoire n’en est eloigne de 200 km. La borne ne rattrape donc ' +
      "qu'une confusion d'unité ou une distance calculée dans une autre projection.",
  },

  // -- Occupation du sol ---------------------------------------------------
  { chemin: 'occupationSol.rpg.partRecouvrement', min: 0, max: 1, unite: 'part', motif: "Part d'une surface : bornée entre 0 et 1 par définition. Une valeur supérieure a 1 trahit un rapport calcule sur deux surfaces de référence différentes — c'est exactement le défaut qui faisait valoir 1 a presque tous les zonages de PLU et reduisait le « zonage dominant » à l'ordre de réponse du service." },
  {
    chemin: 'occupationSol.rpg.anneesDeclareesConsecutives',
    min: 0,
    max: 30,
    unite: 'annees',
    motif:
      'Le RPG existe depuis 2007 et le connecteur interroge sept millésimes. 30 laisse la marge ' +
      "d'un élargissement de la profondeur d'historique sans avoir à toucher cette borne.",
  },
  { chemin: 'occupationSol.foret.partBoisee', min: 0, max: 1, unite: 'part', motif: "Part d'une surface : bornée entre 0 et 1 par définition. Une valeur supérieure a 1 trahit un rapport calcule sur deux surfaces de référence différentes — c'est exactement le défaut qui faisait valoir 1 a presque tous les zonages de PLU et reduisait le « zonage dominant » à l'ordre de réponse du service." },
  { chemin: 'occupationSol.potentielAgronomique', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },

  // -- Milieux et patrimoine : parts et distances --------------------------
  ...['natura2000Habitats', 'natura2000Oiseaux', 'znieff1', 'znieff2', 'appb', 'reserveNaturelle', 'coeurParcNational', 'parcNaturelRegional'].flatMap(
    (z): BorneGrandeur[] => [
      { chemin: `milieux.${z}.partRecouvrement`, min: 0, max: 1, unite: 'part', motif: "Part d'une surface : bornée entre 0 et 1 par définition. Une valeur supérieure a 1 trahit un rapport calcule sur deux surfaces de référence différentes — c'est exactement le défaut qui faisait valoir 1 a presque tous les zonages de PLU et reduisait le « zonage dominant » à l'ordre de réponse du service." },
      { chemin: `milieux.${z}.distanceM`, min: 0, max: 300_000, unite: 'm', motif: 'Distance au zonage le plus proche. Le point de France le plus eloigne d’un site Natura 2000 est à moins de 100 km ; 300 km ne rejette que l’absurde.' },
    ],
  ),
  { chemin: 'milieux.preEnjeuEspeces', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },
  { chemin: 'milieux.sensibiliteAvifaune', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },
  { chemin: 'milieux.sensibiliteChiropteres', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },
  ...['siteClasse', 'siteInscrit', 'spr'].flatMap((z): BorneGrandeur[] => [
    { chemin: `patrimoine.${z}.partRecouvrement`, min: 0, max: 1, unite: 'part', motif: "Part d'une surface : bornée entre 0 et 1 par définition. Une valeur supérieure a 1 trahit un rapport calcule sur deux surfaces de référence différentes — c'est exactement le défaut qui faisait valoir 1 a presque tous les zonages de PLU et reduisait le « zonage dominant » à l'ordre de réponse du service." },
    { chemin: `patrimoine.${z}.distanceM`, min: 0, max: 300_000, unite: 'm', motif: 'Distance au zonage patrimonial le plus proche.' },
  ]),
  { chemin: 'patrimoine.monumentHistorique.distanceM', min: 0, max: 300_000, unite: 'm', motif: 'Distance au monument le plus proche. La France en compte plus de 45 000 : aucun point n’en est eloigne de 300 km.' },
  { chemin: 'patrimoine.covisibiliteIndice', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },

  // -- Risques -------------------------------------------------------------
  { chemin: 'risques.sitesPollues', min: 0, max: 100_000, unite: 'sites', motif: "Dénombrement d'objets dans un rayon de proximité. Un compte de cet ordre ne designe pas un territoire dense mais une requête spatiale qui a perdu son filtre d'emprise et compte tout le département." },
  { chemin: 'risques.icpeProches', min: 0, max: 100_000, unite: 'installations', motif: "Dénombrement d'objets dans un rayon de proximité. Un compte de cet ordre ne designe pas un territoire dense mais une requête spatiale qui a perdu son filtre d'emprise et compte tout le département." },

  // -- Raccordement --------------------------------------------------------
  {
    chemin: 'raccordement.posteLePlusProche.distanceKm',
    min: 0,
    max: 500,
    unite: 'km',
    motif:
      'Le réseau public de distribution maille tout le territoire : la distance au poste source ' +
      'le plus proche depasse rarement 30 km. 500 km rejette une confusion mètre / kilomètre.',
  },
  { chemin: 'raccordement.posteLePlusProche.capaciteResiduelleMw', min: 0, max: 10_000, unite: 'MW', motif: 'Capacité d’accueil d’un poste source. Le plus gros poste français reste très en dessous de 10 GW.' },
  { chemin: 'raccordement.posteLePlusProche.fileAttenteMw', min: 0, max: 100_000, unite: 'MW', motif: 'Puissance des projets en file d’attente, cumulable : borne large.' },
  { chemin: 'raccordement.posteLePlusProche.quotePartEurParKw', min: 0, max: 1_000, unite: 'EUR/kW', motif: 'Quote-part S3REnR. Les schémas publies se situent entre 10 et 150 EUR/kW.' },
  // Les deux distances gaz sont bornees separement depuis l'audit 8 : la canalisation gouverne le
  // raccordement, le site d'injection existant n'est qu'un indicateur de territoire. C'est le controle
  // des bornes qui a rattrape l'oubli de cette ligne lors du renommage — la preuve qu'il sert.
  { chemin: 'raccordement.reseauGaz.distanceCanalisationKm', min: 0, max: 500, unite: 'km', motif: 'Distance à la canalisation de gaz. Même raisonnement que pour le poste source.' },
  { chemin: 'raccordement.reseauGaz.distanceSiteInjectionKm', min: 0, max: 1000, unite: 'km', motif: 'Distance au site d’injection de biomethane existant le plus proche. Borne plus large que celle des canalisations : les sites d’injection sont rares, donc parfois très éloignés.' },
  { chemin: 'raccordement.reseauGaz.capaciteInjectionNm3h', min: 0, max: 100_000, unite: 'Nm3/h', motif: 'Capacité d’injection d’un point du réseau.' },

  // -- Gisement ------------------------------------------------------------
  {
    chemin: 'gisement.irradiationKwhM2An',
    min: 700,
    max: 2_400,
    unite: 'kWh/m2/an',
    motif:
      "L'irradiation globale horizontale va d'environ 1 000 kWh/m2/an dans le nord de la France a " +
      '1 800 en Corse, et jusqu’a environ 2 100 dans les départements d’outre-mer. Une valeur sous ' +
      '700 ou au-delà de 2 400 signale une confusion d’unité (Wh, MJ) ou une source hors sujet — et ' +
      'ce critère est structurant en solaire.',
  },
  { chemin: 'gisement.productibleKwhKwcAn', min: 600, max: 2_000, unite: 'kWh/kWc/an', motif: 'Productible spécifique. 900 a 1 400 en métropole, jusqu’a 1 700 outre-mer.' },
  {
    chemin: 'gisement.ventVitesse100mMs',
    min: 0,
    max: 20,
    unite: 'm/s',
    motif:
      'Vitesse MOYENNE annuelle a 100 m. Elle va d’environ 3 m/s en fond de vallée abritée a 9 ou ' +
      '10 m/s sur les cotes les plus exposées. 20 m/s serait une moyenne de tempête permanente : ' +
      'la valeur decrit alors une rafale ou une autre grandeur.',
  },
  { chemin: 'gisement.intrantsMethaTonnesMsAn', min: 0, max: 1_000_000, unite: 't MS/an', motif: 'Tonnage mobilisable dans un rayon de 10 km. Borne large : un bassin très agricole reste très en dessous.' },
  {
    chemin: 'gisement.elevagesRayon10km',
    min: 0,
    max: 100_000,
    unite: 'elevages',
    motif:
      "Dénombrement des élevages dans un rayon de 10 km. Le département le plus dense de France en " +
      "compte quelques milliers au total : un compte de cet ordre designe une requête spatiale qui " +
      "a perdu son filtre d'emprise, pas un bassin d'élevage.",
  },
  {
    chemin: 'gisement.iaaRayon20km',
    min: 0,
    max: 100_000,
    unite: 'etablissements',
    motif:
      "Dénombrement des industries agroalimentaires dans un rayon de 20 km. Même raisonnement que " +
      "pour les élevages : la France en compte environ 18 000 au total, tous départements " +
      'confondus.',
  },
  { chemin: 'gisement.surfacesEpandageHa', min: 0, max: 1_000_000, unite: 'ha', motif: 'Surfaces d’epandage mobilisables. Borne large.' },

  // -- Bati et acces -------------------------------------------------------
  {
    chemin: 'bati.distanceHabitationM',
    min: 0,
    max: 50_000,
    unite: 'm',
    motif:
      'Le point de France métropolitaine le plus eloigne d’une habitation est à une quinzaine de ' +
      'kilomètres. 50 km rejette une confusion d’unité sans écarter aucun cas réel — et ce critère ' +
      'fonde le knock-out du recul de 500 m en éolien.',
  },
  { chemin: 'bati.nbHabitationsRayon500m', min: 0, max: 100_000, unite: 'batiments', motif: 'Dénombrement dans un rayon de 500 m. Même en coeur urbain dense, on reste très en dessous.' },
  { chemin: 'bati.distanceZoneHabitatM', min: 0, max: 100_000, unite: 'm', motif: 'Distance au zonage U ou AU le plus proche.' },
  { chemin: 'bati.densiteBati1km', min: 0, max: 100_000, unite: 'batiments/km2', motif: 'Proxy d’urbanisation, exprime en dénombrement sur 1 km2.' },
  { chemin: 'acces.distanceVoirieM', min: 0, max: 50_000, unite: 'm', motif: 'Distance à la voirie carrossable la plus proche.' },

  // -- Foncier -------------------------------------------------------------
  { chemin: 'foncier.nbProprietairesEstime', min: 0, max: 10_000, unite: 'comptes', motif: 'Nombre de comptes cadastraux. Une indivision très large reste très en dessous.' },
  { chemin: 'foncier.surfaceDunSeulTenantHa', min: 0, max: 100_000, unite: 'ha', motif: 'La plus grande commune de France métropolitaine couvre environ 75 000 ha : une emprise d’un seul tenant ne peut pas la dépasser.' },
  { chemin: 'foncier.morcellementIndice', min: 0, max: 100, unite: '/100', motif: "Indice normalise 0-100 par construction. Hors de cet intervalle, c'est le barème de dérivation qui est en cause, pas la parcelle : l'indice est calcule par l'application, aucune source ne le fournit." },
];

/** Grandeur trouvee hors de ses bornes. */
export interface AnomalieBorne {
  chemin: string;
  valeur: number;
  min: number;
  max: number;
  unite: string;
  motif: string;
}

function lire(objet: unknown, chemin: readonly string[]): unknown {
  let courant: unknown = objet;
  for (const cle of chemin) {
    if (courant == null || typeof courant !== 'object') return undefined;
    courant = (courant as Record<string, unknown>)[cle];
  }
  return courant;
}

function ecrireNull(objet: unknown, chemin: readonly string[]): void {
  const parent = lire(objet, chemin.slice(0, -1));
  const derniere = chemin[chemin.length - 1];
  if (parent != null && typeof parent === 'object' && derniere != null) {
    (parent as Record<string, unknown>)[derniere] = null;
  }
}

/**
 * Releve les grandeurs hors bornes, sans rien modifier.
 *
 * Une valeur `null`, absente ou non finie n'est pas une anomalie de BORNE : l'absence de donnee
 * est un etat legitime et abondamment gere ailleurs. `NaN` et `Infinity`, en revanche, sont
 * signales — ils traduisent une division par zero ou une lecture ratee, et se propageraient dans
 * les calculs sans jamais declencher de comparaison.
 */
export function verifierBornes(snapshot: ParcelleSnapshot): AnomalieBorne[] {
  const anomalies: AnomalieBorne[] = [];
  for (const b of BORNES_SNAPSHOT) {
    const v = lire(snapshot, b.chemin.split('.'));
    if (v == null) continue;
    if (typeof v !== 'number') continue;
    if (Number.isFinite(v) && v >= b.min && v <= b.max) continue;
    anomalies.push({ chemin: b.chemin, valeur: v, min: b.min, max: b.max, unite: b.unite, motif: b.motif });
  }
  return anomalies;
}

/**
 * Ramene a `null` toute grandeur hors bornes, et rend la liste des anomalies.
 *
 * MUTE le snapshot recu, a dessein : cette fonction est appelee juste avant la persistance, sur un
 * objet qui vient d'etre construit et qui n'est partage avec personne. En faire une copie profonde
 * couterait un parcours complet a chaque parcelle qualifiee, pour proteger d'un partage qui
 * n'existe pas.
 *
 * `null` et non un ecretage : voir l'en-tete du module. Une valeur ecretee reste fausse et cesse
 * d'etre visible.
 */
export function assainirSnapshot(snapshot: ParcelleSnapshot): AnomalieBorne[] {
  const anomalies = verifierBornes(snapshot);
  for (const a of anomalies) ecrireNull(snapshot, a.chemin.split('.'));
  return anomalies;
}
