/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE VERDICT A L'ECRAN — ce qu'il ne doit jamais cesser de dire
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TROIS PHRASES, ET CHACUNE EMPECHE UN CONTRESENS PRECIS :
 *
 *   1. « non évaluée » n'est pas « rien à signaler ». Le referentiel depasse largement ce que le
 *      releve mesure : un « à instruire » qui ne dirait pas combien de contraintes sont restees
 *      sans donnee se lirait comme un jugement porte sur la parcelle, alors que c'est un aveu sur
 *      la donnee. L'operateur reglerait le mauvais probleme ;
 *   2. cette fiche evalue au SEUIL REGLEMENTAIRE. Un operateur qui vient de regler le profil d'un
 *      developpeur exigeant croira sinon que la fiche en tient compte, et lira un verdict comme
 *      s'il venait du droit ;
 *   3. les procedures — permis de construire, regime ICPE — sont HORS verdict. Sans le dire,
 *      leur absence de la liste des contraintes passe pour un oubli.
 *
 * Le detail est dans un `<details>` natif, donc present au rendu serveur : un repli pilote par un
 * etat React sortirait ces phrases du document, et elles deviendraient intestables autrement
 * qu'avec un navigateur.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { BlocVerdict } from '../src/components/BlocVerdict.js';
import type { ContrainteEvaluee, ResultatVerdict } from '@enr/scoring';
import { rendre, texte } from './aides/rendu.js';

function contrainte(p: Partial<ContrainteEvaluee> = {}): ContrainteEvaluee {
  return {
    contrainteId: 'eolien_terrestre__eloignement_500_m_des_habitations',
    nom: 'Éloignement 500 m des habitations',
    categorie: 'A. Distances habitations',
    caractere: 'redhibitoire',
    etat: 'respectee',
    seuilReglementaire: '≥ 500 m (modulable à la hausse)',
    referenceReglementaire: 'Art. L515-44 C. env.',
    coucheSig: 'Bâti IGN BD TOPO',
    condition: { operateur: 'min', valeur: 500, unite: 'm' },
    origineSeuil: 'reglementaire',
    conditionReglementaire: null,
    motifDeveloppeur: null,
    valeurMesuree: 800,
    cheminMesure: 'bati.distanceHabitationM',
    raisons: [],
    ...p,
  };
}

function resultat(p: Partial<ResultatVerdict> = {}): ResultatVerdict {
  const contraintes = p.contraintes ?? [contrainte()];
  return {
    filiere: 'eolien_terrestre',
    verdict: 'favorable',
    mode: 'reglementaire',
    contrainteDecisive: null,
    contraintes,
    ecartsCahierDesCharges: [],
    cadres: [],
    atouts: [],
    couverture: {
      total: contraintes.length,
      respectees: contraintes.filter((c) => c.etat === 'respectee').length,
      enfreintes: contraintes.filter((c) => c.etat === 'enfreinte').length,
      aVerifier: contraintes.filter((c) => c.etat === 'a_verifier').length,
      donneesAbsentes: contraintes.filter((c) => c.etat === 'donnee_absente').length,
    },
    ...p,
  };
}

function rendu(v: ResultatVerdict): string {
  return texte(rendre(h(BlocVerdict, { verdict: v })));
}

test('L’ECRAN DIT QUE LA FICHE EST EVALUEE AU SEUIL REGLEMENTAIRE', () => {
  const t = rendu(resultat());

  /*
   * LE §2.3 RENDU VISIBLE. Sans cette phrase, un operateur qui a ouvert le profil d'un developpeur
   * exigeant croira que la fiche en tient compte — et lira « défavorable » comme s'il venait du
   * droit, alors qu'il viendrait d'une exigence commerciale.
   */
  assert.match(t, /seuil réglementaire/);
  assert.match(t, /jamais à cette fiche/);
});

test('« NON EVALUEE » EST ANNONCE COMME UNE LACUNE, PAS COMME UN FEU VERT', () => {
  const v = resultat({
    verdict: 'a_instruire',
    contraintes: [
      contrainte({ etat: 'respectee' }),
      contrainte({
        contrainteId: 'eolien_terrestre__znieff_type_i',
        nom: 'ZNIEFF de type I',
        etat: 'donnee_absente',
        valeurMesuree: null,
        cheminMesure: null,
        coucheSig: 'INPN (ZNIEFF 1)',
      }),
    ],
  });
  const t = rendu(v);

  assert.match(t, /1 non évaluée/);
  // La phrase qui fait la difference entre un jugement et un aveu.
  assert.match(t, /ne sont pas des contraintes absentes/);
  assert.match(t, /la donnée\s+nécessaire manque au relevé/);
  // Et la source attendue est nommee, pour que la lacune soit actionnable.
  assert.match(t, /Source attendue\s*:\s*INPN \(ZNIEFF 1\)/);
});

test('« A INSTRUIRE FAUTE DE DONNEE » NE SE DIT PAS COMME « A INSTRUIRE PARCE QUE ÇA COINCE »', () => {
  /*
   * MESURE QUI A MOTIVE CE TEST. Sur 200 parcelles reelles de la base de reference, en solaire au
   * sol : 200 verdicts « à instruire », 0 enfreinte, et 51 contraintes non evaluees sur 56. La
   * totalite du foncier bascule pour la MEME raison — le releve ne porte pas encore les couches
   * necessaires — et aucune parcelle ne bascule sur un fait.
   *
   * Un « à instruire » uniforme se lit alors comme un jugement porte sur chaque parcelle, et
   * l'operateur conclut que son foncier est mediocre. La phrase honnete est « nous n'avons pas
   * regarde », et elle doit etre visible sans deplier le detail.
   */
  const lacunaire = resultat({
    verdict: 'a_instruire',
    contraintes: [
      contrainte({ etat: 'respectee' }),
      contrainte({ contrainteId: 'x', etat: 'donnee_absente', valeurMesuree: null, cheminMesure: null }),
    ],
  });
  const t = rendu(lacunaire);
  assert.match(t, /lacune\s+de notre couverture, pas un défaut de la parcelle/);
  assert.match(t, /Aucune contrainte n’est enfreinte parmi celles qui ont pu être évaluées/);

  // A l'inverse, une vraie infraction garde l'explication generique : rien n'est a excuser.
  const reel = resultat({
    verdict: 'a_instruire',
    contraintes: [contrainte({ contrainteId: 'y', etat: 'enfreinte', caractere: 'penalisant' })],
  });
  const t2 = rendu(reel);
  assert.doesNotMatch(t2, /lacune de notre couverture/);
  assert.match(t2, /Une contrainte au moins est enfreinte/);
});

test('UNE LACUNE N’EST PAS ANNONCEE COMME « DECISIVE »', () => {
  /*
   * VU EN RELISANT LE PDF RENDU, puis corrige des deux cotes. Le moteur designe toujours ce qui
   * explique le verdict ; faute d'infraction, il retombe sur la contrainte non evaluee la plus
   * severe. L'ecran annoncait donc « Contrainte décisive : … » sur une parcelle dont AUCUNE
   * contrainte n'est enfreinte — un motif de rejet la ou il n'y a qu'une donnee manquante. Le
   * choix de cette ligne parmi cinquante lacunes est d'ailleurs arbitraire.
   */
  const lacune = contrainte({
    nom: 'Terres agricoles cultivées',
    etat: 'donnee_absente',
    valeurMesuree: null,
    cheminMesure: null,
  });
  const t = rendu(
    resultat({ verdict: 'a_instruire', contraintes: [lacune], contrainteDecisive: lacune }),
  );
  assert.doesNotMatch(t, /Contrainte décisive/, 'rien n’a tranche : rien n’est decisif');
  assert.match(t, /Premier point à instruire\s*:\s*Terres agricoles cultivées/);

  // A l'inverse, une infraction constatee est bien « décisive » : c'est elle qui a fait basculer.
  const faute = contrainte({ etat: 'enfreinte', valeurMesuree: 300 });
  const t2 = rendu(
    resultat({ verdict: 'defavorable', contraintes: [faute], contrainteDecisive: faute }),
  );
  assert.match(t2, /Contrainte décisive\s*:\s*Éloignement 500 m des habitations/);
});

test('LES COMPTES DE COUVERTURE SONT AFFICHES, ET DISTINGUENT LES QUATRE ETATS', () => {
  const v = resultat({
    verdict: 'a_instruire',
    contraintes: [
      contrainte({ etat: 'respectee' }),
      contrainte({ contrainteId: 'a', etat: 'enfreinte' }),
      contrainte({ contrainteId: 'b', etat: 'a_verifier' }),
      contrainte({ contrainteId: 'c', etat: 'donnee_absente' }),
    ],
  });
  const t = rendu(v);

  assert.match(t, /4 contraintes au référentiel/);
  assert.match(t, /1 respectée/);
  assert.match(t, /1 non respectée/);
  assert.match(t, /1 à vérifier/);
  assert.match(t, /1 non évaluée/);
});

test('LA CONTRAINTE DECISIVE EST NOMMEE, AVEC SON SEUIL ET SA REFERENCE', () => {
  const decisive = contrainte({ etat: 'enfreinte', valeurMesuree: 300 });
  const t = rendu(
    resultat({ verdict: 'defavorable', contraintes: [decisive], contrainteDecisive: decisive }),
  );

  assert.match(t, /Contrainte décisive\s*:\s*Éloignement 500 m des habitations/);
  // Le texte du classeur est RECOPIE, jamais reformule : c'est ce que l'operateur cite.
  assert.match(t, /≥ 500 m \(modulable à la hausse\)/);
  assert.match(t, /L515-44/);
  // Et la mesure est verifiable : le chemin du releve d'ou elle vient est affiche.
  assert.match(t, /Mesuré\s*:\s*300 m/);
  assert.match(t, /bati\.distanceHabitationM/);
});

test('UN SEUIL DEVELOPPEUR APPLIQUE NOMME LES DEUX VALEURS', () => {
  /*
   * Ce bloc sert aussi au mode 2. Quand un seuil developpeur s'applique, l'ecran doit porter les
   * DEUX valeurs : sans la seconde, l'operateur ne peut pas dire au developpeur que l'ecart vient
   * de sa propre exigence, donc qu'il est negociable.
   */
  const c = contrainte({
    etat: 'enfreinte',
    origineSeuil: 'developpeur',
    condition: { operateur: 'min', valeur: 1500, unite: 'm' },
    conditionReglementaire: { operateur: 'min', valeur: 500, unite: 'm' },
    motifDeveloppeur: 'Politique interne : 1,5 km',
    valeurMesuree: 800,
  });
  const t = rendu(resultat({ verdict: 'a_instruire', contraintes: [c], contrainteDecisive: c }));

  assert.match(t, /exigence du développeur \(1500 m\)/);
  assert.match(t, /La réglementation, elle, demande/);
  assert.match(t, /Politique interne/);
});

test('LES ATOUTS SONT RENDUS A PART, ET NE PASSENT PAS POUR DES PROBLEMES', () => {
  /*
   * Le classeur note ces lignes « favorable » — « en ZAEnR = bonus » — et toutes les communes
   * n'ont pas delibere. Les melanger aux contraintes ferait lire un « hors ZAEnR » comme un
   * defaut, alors que c'est seulement un argument de moins.
   */
  const t = rendu(
    resultat({
      atouts: [
        contrainte({
          contrainteId: 'solaire_sol__zones_d_acceleration_enr_zaenr',
          nom: 'Zones d’accélération ENR (ZAEnR)',
          caractere: 'favorable',
          etat: 'respectee',
          seuilReglementaire: 'En ZAEnR = bonus ; hors ZAEnR possible',
        }),
      ],
    }),
  );

  assert.match(t, /1 atout constaté sur 1/);
  assert.match(t, /Acquis/);
  assert.match(t, /ne pas en\s+bénéficier n’est pas un défaut/);
  assert.match(t, /Zones d’accélération ENR/);
});

test('LES PROCEDURES SONT RENDUES A PART, ET LE DISENT', () => {
  const t = rendu(
    resultat({
      cadres: [
        contrainte({
          contrainteId: 'eolien_terrestre__permis',
          nom: 'Permis de construire',
          caractere: 'cadre',
          etat: 'cadre',
          seuilReglementaire: 'Requis pour tout projet',
        }),
      ],
    }),
  );

  assert.match(t, /1 procédure applicable au projet/);
  // Sans cette phrase, l'absence du permis de construire dans la liste des contraintes passe pour
  // un oubli, alors que l'y mettre mettrait CHAQUE parcelle « à instruire ».
  assert.match(t, /quelle que soit la parcelle/);
  assert.match(t, /n’entrent donc pas dans le verdict/);
});

test('LES CONTRAINTES A LIRE VIENNENT AVANT CELLES QUI VONT BIEN', () => {
  /*
   * Une liste qui commencerait par les contraintes respectees ferait defiler pour rien : ce sont
   * justement celles dont l'operateur n'a rien a faire.
   */
  const v = resultat({
    verdict: 'a_instruire',
    contraintes: [
      contrainte({ contrainteId: 'ok', nom: 'Contrainte respectée', etat: 'respectee' }),
      contrainte({ contrainteId: 'ko', nom: 'Contrainte enfreinte', etat: 'enfreinte' }),
    ],
  });
  const t = rendu(v);

  assert.ok(
    t.indexOf('Contrainte enfreinte') < t.indexOf('Contrainte respectée'),
    'l’enfreinte doit apparaitre avant la respectée',
  );
});
