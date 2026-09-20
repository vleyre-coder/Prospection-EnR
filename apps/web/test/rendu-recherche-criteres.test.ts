/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * L'OUTIL DE RECHERCHE PAR CRITERES, ET LA PHRASE QU'IL NE DOIT JAMAIS LAISSER LIRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROTEGE EN PRIORITE. Le balayage d'un territoire ne porte pas sur le cadastre :
 * il porte sur les parcelles QUALIFIEES. Un departement compte des centaines de milliers de
 * parcelles, une campagne en couvre quelques milliers. Une recherche sur un departement jamais
 * qualifie repondait donc « 0 résultat » et « Aucune parcelle ne correspond aux filtres » — deux
 * phrases exactes, et une conclusion FAUSSE : l'operateur en deduit qu'il n'y a rien a prospecter,
 * et passe au departement suivant.
 *
 * Aucun message d'erreur n'aurait signale ce contresens : le serveur repond 200, correctement. Seul
 * le bandeau de couverture le distingue, et c'est pour cela que trois de ces tests portent sur lui.
 *
 * CE QUE CE FICHIER PROTEGE ENSUITE. La traduction « typologie -> nature du sol » : le regime
 * d'implantation (agrivoltaisme, terrain degrade...) est DEDUIT de la nature du sol, il n'est pas
 * une colonne cherchable. Le formulaire doit donc proposer le vocabulaire metier et filtrer sur la
 * donnee reelle — sans quoi un critere serait annonce et pas applique.
 *
 * ENFIN, LA ROBUSTESSE DU BANDEAU. `couverture` est arrivee dans la reponse apres coup. Ma premiere
 * ecriture la destructurait sans precaution : une capture enregistree avant, ou une reponse en
 * cache, faisait disparaitre le TABLEAU ENTIER derriere un ecran blanc. Perdre le bandeau est
 * benin ; perdre les resultats parce que le bandeau manque d'un champ ne l'est pas.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import {
  FAMILLES_CULTURE,
  FILIERES_META,
  GROUPES_CULTURE,
  REGIME_PAR_TYPE_SOL,
  SEUILS_RECHERCHE,
  TYPES_SOL,
  groupesDesFamilles,
  typesSolDuRegime,
} from '@enr/core';
import { VueListe } from '../src/components/VueListe.js';
import type {
  CouvertureRecherche,
  LigneListe,
  ProfilApplique,
  TerritoireInterrogeable,
} from '../src/api/client.js';
import { referentiel, rendreResolu, texte } from './aides/rendu.js';

/** Une ligne de resultat minimale : ces tests portent sur le cadre, pas sur les cellules. */
const LIGNE: LigneListe = {
  idu: '28001000AB0001',
  nomCommune: 'Commune d’essai',
  section: 'AB',
  numero: '0001',
  surfaceHa: 12.5,
  statutScore: 'vert',
  scoreGlobal: 71.2,
  nbKnockOutsBloquants: 0,
  statutProspection: null,
  distancePosteKm: 2.4,
  lineaireRaccordementKm: 3.24,
  pentePct: 1.8,
  typeSol: 'agricole_exploite',
  centroide: [1.5, 48.4],
};

const TERRITOIRES: { regions: TerritoireInterrogeable[]; departements: TerritoireInterrogeable[] } = {
  regions: [
    { code: '24', nom: 'Centre-Val de Loire', codeRegion: null, communes: 1754, parcellesQualifiees: 301 },
    { code: '53', nom: 'Bretagne', codeRegion: null, communes: 1202, parcellesQualifiees: 0 },
  ],
  departements: [
    { code: '28', nom: 'Eure-et-Loir', codeRegion: '24', communes: 365, parcellesQualifiees: 301 },
    { code: '18', nom: 'Cher', codeRegion: '24', communes: 287, parcellesQualifiees: 0 },
    { code: '35', nom: 'Ille-et-Vilaine', codeRegion: '53', communes: 333, parcellesQualifiees: 0 },
  ],
};

function afficher(
  donnees: {
    total: number;
    resultats: LigneListe[];
    couverture?: CouvertureRecherche;
    /** Bloc du MODE 2 : present seulement quand un profil est applique. */
    profil?: ProfilApplique;
  },
  options: { mode?: 'liste' | 'recherche'; etat?: Record<string, unknown> } = {},
): string {
  return texte(
    rendreResolu(
      h(VueListe, {
        filiere: 'solaire_sol',
        referentiel,
        onOuvrir: () => undefined,
        mode: options.mode ?? 'recherche',
      }),
      // Le formulaire de balayage interroge `territoires` : ne pas l'amorcer laisserait le
      // selecteur en chargement, et le test passerait sur un formulaire vide.
      { liste: donnees, territoires: TERRITOIRES },
      { limiterALEmprise: false, ...(options.etat ?? {}) },
    ),
  );
}

// ---------------------------------------------------------------------------
// Le bandeau de couverture : trois situations, trois messages
// ---------------------------------------------------------------------------

test('UN TERRITOIRE JAMAIS QUALIFIE NE SE LIT PAS « AUCUN FONCIER PROPICE »', () => {
  const t = afficher({
    total: 0,
    resultats: [],
    couverture: {
      departementsDemandes: ['18'],
      parcellesQualifiees: 0,
      communesAvecParcelle: 0,
      communesDuTerritoire: 287,
      seuilsRenseignes: [],
    },
  });

  /*
   * C'EST LE TEST CENTRAL DE CE FICHIER. Sans le bandeau, l'ecran ne portait que « 0 résultat » et
   * « Aucune parcelle ne correspond aux filtres » : exact, et trompeur. Il faut donc que la phrase
   * qui distingue les deux cas soit REELLEMENT a l'ecran.
   */
  assert.match(t, /jamais été qualifié/i, 'le bandeau doit dire que le territoire n’a pas ete balaye');
  assert.match(t, /18/, 'le departement concerne doit etre nomme');
  assert.match(
    t,
    /ne veut donc pas dire/i,
    'le bandeau doit refuser explicitement la lecture « aucun foncier propice »',
  );
  // Et l'invitation doit porter sur la QUALIFICATION, non sur les criteres : changer les criteres
  // ne changerait rien sur un territoire vide.
  assert.match(t, /qualification/i);
});

test('UN TERRITOIRE PARTIELLEMENT QUALIFIE ANNONCE UN PLANCHER, PAS UN INVENTAIRE', () => {
  const t = afficher({
    total: 12,
    resultats: [LIGNE],
    couverture: {
      departementsDemandes: ['28'],
      parcellesQualifiees: 301,
      // 40 communes sur 365 : 11 %, tres loin des 90 % au-dela desquels « partiel » n'informe plus.
      communesAvecParcelle: 40,
      communesDuTerritoire: 365,
      seuilsRenseignes: [],
    },
  });

  assert.match(t, /12 parcelles? retenues?/i);
  assert.match(t, /301 qualifiées/i, 'le denominateur doit etre affiche : 12 sur 301 se lit autrement que 12 sur 40 000');
  assert.match(t, /40 communes? sur\s+365/i);
  assert.match(t, /11 %/, 'la part de communes couvertes doit etre chiffree');
  assert.match(
    t,
    /partiellement qualifié/i,
    'sous 90 % de communes couvertes, le resultat doit etre annonce comme un minimum',
  );
  assert.match(t, /un minimum, pas un inventaire/i);
});

test('UN TERRITOIRE COUVERT N’AFFICHE PAS LA RESERVE « PARTIELLEMENT QUALIFIE »', () => {
  /*
   * Le seuil compte autant que le message. Une reserve affichee en permanence cesse d'etre lue, et
   * l'application perdrait alors le seul signal qui distingue un inventaire d'un echantillon.
   */
  const t = afficher({
    total: 120,
    resultats: [LIGNE],
    couverture: {
      departementsDemandes: ['28'],
      parcellesQualifiees: 4000,
      communesAvecParcelle: 360,
      communesDuTerritoire: 365,
      seuilsRenseignes: [],
    },
  });

  assert.match(t, /360 communes? sur\s+365/i);
  assert.doesNotMatch(t, /partiellement qualifié/i);
  assert.doesNotMatch(t, /jamais été qualifié/i);
});

test('SANS TERRITOIRE DEMANDE, LE BANDEAU SE TAIT', () => {
  // La couverture n'a pas de denominateur quand la recherche porte sur toute la base : un bandeau
  // qui parle toujours ne se lit plus.
  const t = afficher({
    total: 3,
    resultats: [LIGNE],
    couverture: {
      departementsDemandes: [],
      parcellesQualifiees: 301,
      communesAvecParcelle: 40,
      communesDuTerritoire: null,
      seuilsRenseignes: [],
    },
  });

  assert.doesNotMatch(t, /parcelles? retenues? sur/i);
  assert.doesNotMatch(t, /partiellement qualifié/i);
  // Le tableau, lui, doit bien etre la.
  assert.match(t, /AB\s+0001/);
});

test('UNE REPONSE SANS COUVERTURE N’EFFACE PAS LE TABLEAU', () => {
  /*
   * LE DEFAUT QUE J'AI PRODUIT ET MESURE. `BandeauCouverture` destructurait `couverture` sans
   * precaution : sur une reponse qui n'en portait pas — capture de reference anterieure, cache du
   * navigateur, serveur plus ancien — React remontait « Cannot destructure property
   * departementsDemandes of undefined » et TOUTE la vue disparaissait. Quatre tests de rendu
   * existants l'ont attrape.
   */
  const t = afficher({ total: 1, resultats: [LIGNE] });
  assert.match(t, /AB\s+0001/, 'les resultats doivent rester affiches sans le bloc de couverture');
  assert.match(t, /Commune d’essai/);
});

// ---------------------------------------------------------------------------
// Le formulaire de criteres
// ---------------------------------------------------------------------------

test('LE FORMULAIRE PORTE LES QUATRE CRITERES DEMANDES', () => {
  const t = afficher({ total: 1, resultats: [LIGNE] });

  // 1. surface minimale, 2. territoire, 3. typologie, 4. zone.
  assert.match(t, /Surface minimale par parcelle/i);
  assert.match(t, /Territoire à balayer/i);
  assert.match(t, /Typologie d[’']implantation/i);
  assert.match(t, /zone d[’']accélération/i);
});

test('LE SEUIL DE SURFACE DIT QU’IL PORTE SUR LA PARCELLE, ET NON SUR LE PROJET', () => {
  /*
   * CONTRESENS A FORT COUT. Un projet de 20 ha s'assemble couramment avec huit parcelles de
   * 2,5 ha. Un operateur qui saisit « 20 ha » en croyant decrire son projet ferait disparaitre
   * tout le foncier reellement mobilisable, et concluerait que le territoire n'a rien a offrir.
   */
  const t = afficher({ total: 1, resultats: [LIGNE] });
  assert.match(t, /chaque parcelle cadastrale, pas au projet/i);
  assert.match(t, /plusieurs parcelles plus petites/i);
});

test('LE SELECTEUR DE TERRITOIRE DISTINGUE « JAMAIS BALAYE » D’UN COMPTE A ZERO', () => {
  const t = afficher({ total: 1, resultats: [LIGNE] });

  // Les trois departements du jeu sont proposes, avec leur nom : un code seul ne se choisit pas.
  assert.match(t, /Eure-et-Loir/);
  assert.match(t, /Cher/);
  // Et le departement sans parcelle qualifiee porte la mention, non le chiffre 0 — « 0 » se lirait
  // comme une absence CONSTATEE de foncier propice.
  assert.match(t, /jamais balayé/i);
  assert.match(
    t,
    /n[’']a jamais été balayé, ce qui n[’']est pas la même chose qu[’']un département sans foncier/i,
    'la note doit expliquer ce que 0 signifie, avant le lancement',
  );
});

test('LA TYPOLOGIE PROPOSE LE VOCABULAIRE METIER, PAS LES VALEURS D’ENUMERATION', () => {
  const t = afficher({ total: 1, resultats: [LIGNE] });

  // La pastille du regime `agrivoltaisme` est nommee par la nature de sol qu'elle filtre, et NON
  // « Agrivoltaisme » : ce mot designe la filiere, presente au meme ecran dans la barre du haut.
  assert.match(t, /Terrain agricole exploité/i);
  assert.match(t, /Terrain dégradé/i);
  assert.match(t, /Terrain inculte/i);
  assert.match(t, /défrichement/i);
  // Le regime est PRESUME, deduit d'une couche d'occupation du sol : le formulaire doit le dire la
  // ou le critere est saisi, et pas seulement dans la fiche.
  assert.match(t, /présumé/i);
  // Et jamais l'identifiant technique.
  assert.doesNotMatch(t, /pv_sol_/);
  assert.doesNotMatch(t, /agricole_exploite/);
});

test('CHAQUE TYPOLOGIE PROPOSEE SE TRADUIT EN AU MOINS UNE NATURE DE SOL', () => {
  /*
   * Garde de coherence entre l'interface et la donnee. Une typologie dont la reciproque serait vide
   * s'afficherait comme une pastille cliquable qui ne filtre rien : le critere serait annonce et
   * pas applique, ce qui est pire qu'un critere absent.
   */
  for (const regime of new Set(Object.values(REGIME_PAR_TYPE_SOL))) {
    const naturels = typesSolDuRegime(regime);
    assert.ok(naturels.length > 0, `typologie sans nature de sol : ${regime}`);
    for (const n of naturels) {
      assert.ok(TYPES_SOL[n], `nature de sol inconnue rendue par la reciproque : ${n}`);
    }
  }
});

test('LA VUE LISTE N’AFFICHE PAS LE FORMULAIRE DE BALAYAGE', () => {
  /*
   * Les deux vues partagent le meme composant. Si le formulaire s'affichait aussi en vue « Liste »,
   * il y prendrait la place des resultats pour un usage — le balayage d'un territoire — qui n'est
   * pas celui de cette vue. La distinction doit donc etre verifiee, et non supposee.
   */
  const t = texte(
    rendreResolu(
      h(VueListe, {
        filiere: 'solaire_sol',
        referentiel,
        onOuvrir: () => undefined,
        mode: 'liste',
      }),
      { liste: { total: 1, resultats: [LIGNE] } },
      { limiterALEmprise: false },
    ),
  );
  assert.doesNotMatch(t, /Territoire à balayer/i);
  assert.doesNotMatch(t, /Recherche de foncier par critères/i);
  assert.match(t, /AB\s+0001/, 'la vue liste doit rester fonctionnelle');
});

test('LE PIED DE FORMULAIRE DIT SUR QUOI LE BALAYAGE PORTE', () => {
  // Sans territoire choisi, le recapitulatif doit l'annoncer plutot que de rester muet : c'est la
  // seule ligne qui rappelle que la recherche porte sur toute la base qualifiee.
  const t = afficher({ total: 1, resultats: [LIGNE] });
  assert.match(t, /Balayage sur toute la base qualifiée/i);
});

test('LE BALAYAGE SIGNALE QU’IL EST BRIDE PAR L’EMPRISE DE LA CARTE', () => {
  /*
   * Deux demandes contradictoires peuvent coexister : « balaie le departement 28 » et « limite a la
   * zone affichee ». La seconde gagne en SQL. Le formulaire desactive la borne quand on choisit un
   * territoire, mais si elle est active a l'arrivee, il faut le dire — sinon le balayage ne porte
   * que sur l'ecran, silencieusement.
   */
  const t = afficher(
    { total: 1, resultats: [LIGNE] },
    { etat: { limiterALEmprise: true, empriseCourante: [1, 48, 2, 49] } },
  );
  assert.match(t, /limité à la zone affichée sur la carte/i);
});

// ---------------------------------------------------------------------------
// Le type de projet et le type d'agriculture
// ---------------------------------------------------------------------------

test('LE TYPE DE PROJET EST UN CRITERE DU FORMULAIRE, ET LES QUATRE FILIERES Y SONT', () => {
  /*
   * Le proprietaire l'enumere parmi les criteres qu'un developpeur donne : « le type de projet, si
   * c'est un projet agri-PV, methanisation, BESS ou encore eolien ». Il vivait jusqu'ici seulement
   * dans la barre superieure, ou il se lit comme un mode d'affichage plutot que comme une entree
   * de recherche.
   */
  const t = afficher({ total: 1, resultats: [LIGNE] });
  assert.match(t, /Type de projet/i);
  assert.match(t, /Filière recherchée/i);
  for (const m of Object.values(FILIERES_META)) {
    assert.ok(t.includes(m.libelle), `la filiere « ${m.libelle} » doit etre proposee`);
  }
  // Et l'ecran doit dire que ce selecteur commande la MEME filiere que la barre du haut : deux
  // commandes pour un seul etat se lisent sinon comme deux reglages independants.
  assert.match(t, /même filière que la barre du haut/i);
});

test('LE TYPE D’AGRICULTURE PROPOSE DES FAMILLES D’USAGE, PAS LES 27 GROUPES DU RPG', () => {
  /*
   * LE MANQUE QUE CE BLOC COMBLE. `typesSol` ne connait que « agricole exploité » : une prairie
   * pâturée et un champ de blé y sont la même chose, alors que ce sont deux projets, deux
   * interlocuteurs et deux types de structure. C'est la distinction demandée — « un type
   * d'agriculture bien spécifique, ça peut être aussi de l'élevage ».
   *
   * Et le découpage est proposé en FAMILLES : un développeur demande « de l'élevage », pas « les
   * groupes 16, 17, 18 et 19 ».
   */
  const t = afficher({ total: 1, resultats: [LIGNE] });
  assert.match(t, /Type d[’']agriculture/i);
  for (const f of FAMILLES_CULTURE) {
    assert.ok(t.includes(f.libelle), `la famille « ${f.libelle} » doit etre proposee`);
  }
  assert.match(t, /Élevage et prairies/);

  // La réserve qui évite un contresens : une parcelle sans déclaration PAC n'est jamais retenue
  // par ce critère, et l'écran doit dire où la chercher.
  assert.match(t, /sans déclaration/i);
  assert.match(t, /Terrain inculte/i);
  // Et le décalage du RPG est dit : « prairie permanente » relevé de 2023 n'affirme rien sur ce
  // qui pousse aujourd'hui.
  assert.match(t, /deux ans de décalage/i);
});

test('LES FAMILLES DE CULTURE SE TRADUISENT TOUTES EN GROUPES REELS', () => {
  /*
   * Garde de cohérence entre l'interface et la donnée, jumeau de celui des typologies. Une famille
   * dont la réciproque serait vide s'afficherait comme une pastille cliquable qui ne filtre rien :
   * le critère serait annoncé et pas appliqué, ce qui est pire qu'un critère absent.
   */
  for (const f of FAMILLES_CULTURE) {
    const groupes = groupesDesFamilles([f.id]);
    assert.ok(groupes.length > 0, `famille sans groupe : ${f.id}`);
    for (const g of groupes) {
      assert.ok(GROUPES_CULTURE[g], `groupe inconnu rendu par la famille ${f.id} : ${g}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Les seuils, et le diagnostic qui empêche « 0 résultat » de mentir à nouveau
// ---------------------------------------------------------------------------

test('LE FORMULAIRE PROPOSE LES SEUILS DE LA FILIÈRE, CRITÈRE ROI EN TÊTE', () => {
  /*
   * LE PLUS GROS TROU DE LA RECHERCHE. L'application évalue 43 critères et la recherche n'en
   * laissait régler qu'une poignée : le critère roi de trois filières sur quatre — irradiation,
   * vent, intrants — était INTROUVABLE. Un outil de recherche qui ne sait pas chercher par le
   * critère roi de sa filière ne cherche pas.
   */
  const t = afficher({ total: 1, resultats: [LIGNE] });
  for (const s of SEUILS_RECHERCHE.solaire_sol) {
    assert.ok(t.includes(s.libelle), `seuil absent du formulaire : ${s.libelle}`);
  }
  assert.match(t, /Irradiation globale horizontale minimale/);
  assert.match(t, /kWh\/m²\/an/);
  assert.match(t, /au moins|au plus/);

  /*
   * LA VALEUR GRISE N'EST PAS UN FILTRE ACTIF, et l'écran doit le dire. Un opérateur qui voit
   * « 1250 » en gris pourrait croire le seuil appliqué, et conclure que le territoire ne porte que
   * du foncier au-dessus de ce seuil.
   */
  assert.match(t, /ordres de grandeur usuels/i);
  assert.match(t, /tant que la case est vide/i);
});

test('UN SEUIL SUR UNE GRANDEUR JAMAIS MESURÉE LE DIT, PLUTÔT QUE DE RENDRE « 0 RÉSULTAT »', () => {
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LE DÉFAUT QUE J'AI INTRODUIT AVEC LES SEUILS, ET QUE CE TEST FIGE
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * Le filtre écarte toute parcelle dont la grandeur n'est pas renseignée — bon sens d'erreur. Mais
   * mesure sur la base de référence : `foncier.nbProprietairesEstime` est nul sur les 301 parcelles,
   * la donnée de propriété exigeant une habilitation. Demander « au plus 2 propriétaires » rend
   * donc zéro, exactement comme si aucune parcelle ne convenait — alors que le territoire est
   * qualifié et que le bandeau annonce ses parcelles.
   */
  const t = afficher({
    total: 0,
    resultats: [],
    couverture: {
      departementsDemandes: ['28'],
      parcellesQualifiees: 301,
      communesAvecParcelle: 40,
      communesDuTerritoire: 365,
      seuilsRenseignes: [
        { chemin: 'foncier.nbProprietairesEstime', renseignees: 0 },
        { chemin: 'gisement.irradiationKwhM2An', renseignees: 301 },
      ],
    },
  });

  assert.match(t, /n’est mesuré sur aucune parcelle/i);
  assert.match(t, /foncier\.nbProprietairesEstime/, 'la grandeur fautive doit être nommée');
  assert.doesNotMatch(
    t,
    /gisement\.irradiationKwhM2An/,
    'une grandeur bien mesurée ne doit pas être accusée',
  );
  // Et la phrase doit refuser explicitement la lecture « aucune parcelle ne conviendrait ».
  assert.match(t, /pour cette raison/i);
  assert.match(t, /Retirez ce seuil/i);
});

test('TOUS LES SEUILS MESURÉS : LE DIAGNOSTIC SE TAIT ET LA COUVERTURE ORDINAIRE REPREND', () => {
  // Un diagnostic qui parle toujours ne se lit plus : il ne doit apparaître que s'il a une cause.
  const t = afficher({
    total: 12,
    resultats: [LIGNE],
    couverture: {
      departementsDemandes: ['28'],
      parcellesQualifiees: 301,
      communesAvecParcelle: 40,
      communesDuTerritoire: 365,
      seuilsRenseignes: [{ chemin: 'gisement.irradiationKwhM2An', renseignees: 301 }],
    },
  });
  assert.doesNotMatch(t, /mesuré sur aucune parcelle/i);
  assert.match(t, /12 parcelles? retenues?/i, 'le bandeau de couverture ordinaire doit reprendre');
});

test('LE CAHIER DES CHARGES WORD EST PROPOSÉ, ET RESTE ACTIF SUR UNE LISTE VIDE', () => {
  /*
   * C'est la différence de nature avec les autres exports : le CSV, le Shapefile et le dossier
   * portent des RÉSULTATS et n'ont aucun sens sans résultat. Le cahier des charges porte la
   * DEMANDE — on l'envoie au développeur avant d'avoir cherché quoi que ce soit. Le griser sur une
   * liste vide interdirait le seul moment où l'on en a le plus besoin.
   */
  const t = afficher({ total: 0, resultats: [] });
  assert.match(t, /Cahier des charges \(Word\)/);
});

test('LE BANDEAU DU CAHIER DES CHARGES DIT CE QUI N’A PAS ETE APPLIQUE', () => {
  /*
   * LA MOITIE QUI COMPTE. Un seuil saisi par le developpeur et silencieusement ecarte est la pire
   * des reponses : l'operateur croit son filtre actif, remet un dossier, et personne ne sait que
   * l'exigence n'a jamais ete verifiee. 250 des 292 contraintes du referentiel n'ont aujourd'hui
   * aucune grandeur mesuree en face — ce n'est pas un cas limite, c'est le cas courant.
   */
  const t = afficher({
    total: 12,
    resultats: [LIGNE],
    profil: {
      id: '11111111-1111-1111-1111-111111111111',
      nom: 'Éolien — Développeur X',
      developpeur: 'Développeur X',
      seuilsAppliques: 1,
      seuilsIgnores: [
        {
          contrainteId: 'eolien_terrestre__enjeux_chiropteres_recul_lisieres_garde_au_sol',
          nom: 'Enjeux chiroptères — recul lisières',
          raison: 'grandeur_non_mesuree',
          message:
            '« Enjeux chiroptères — recul lisières » : aucune grandeur du relevé ne mesure cette contrainte, le seuil n’a pas été appliqué.',
        },
      ],
    },
  });

  assert.match(t, /Cahier des charges\s*«\s*Éolien — Développeur X\s*»/);
  assert.match(t, /1 seuil appliqué/);
  assert.match(t, /1 non appliqué/);
  assert.match(t, /aucune grandeur du relevé ne mesure cette contrainte/);
});

test('SANS PROFIL, AUCUN BANDEAU DE CAHIER DES CHARGES N’APPARAIT', () => {
  /*
   * NON-REGRESSION DU MODE SANS PROFIL. Un bandeau affiche a vide ferait croire a un cahier des
   * charges applique la ou il n'y en a pas — et l'operateur tiendrait sa liste pour plus filtree
   * qu'elle ne l'est.
   */
  const t = afficher({ total: 12, resultats: [LIGNE] });
  /*
   * L'assertion vise le bandeau, PAS la chaine « cahier des charges » : le bouton d'export
   * « Cahier des charges (Word) » porte deja ces mots, et une assertion large accusait donc un
   * ecran parfaitement correct. C'est le guillemet ouvrant du NOM du profil qui distingue les deux.
   */
  assert.doesNotMatch(t, /Cahier des charges\s*«/);
  assert.doesNotMatch(t, /seuil appliqué/);
  // Le bouton d'export, lui, doit toujours etre la : c'est la non-regression du mode sans profil.
  assert.match(t, /Cahier des charges \(Word\)/);
});
