/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LA COUVERTURE SE DIT EN DEUX CHIFFRES — et l'écart entre eux n'est pas cosmétique
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE LE RAPPORT ANNONÇAIT, mesuré le 26/09/2026 sur une parcelle de méthanisation réelle :
 *
 *     « 90 sur 100 — Sous conditions / à étudier »
 *     « Couverture des données : 81 % »
 *     « Critère déterminant : Densité d'intrants mobilisables et débouché »
 *
 * Le poids réellement évalué était de **46,8 %**, et le critère nommé « déterminant » — 16,5 % à
 * lui seul — faisait partie des NON ÉVALUÉS.
 *
 * ═══ LES 81 % N'ÉTAIENT PAS UN BUG, ET C'EST TOUT LE PROBLÈME
 *
 * `couvertureDonnees` exclut de son dénominateur les critères sans source sur le territoire. C'est
 * justifié POUR CLASSER : un critère absent partout ne discrimine rien, et l'inclure ferait
 * basculer la filière entière en gris sans rien apprendre. Le chiffre répond à « parmi ce qui était
 * mesurable ici, qu'a-t-on mesuré ? ».
 *
 * Ce n'est pas la question du développeur qui reçoit le document. Lui demande « quelle part du
 * sujet a été regardée ? » — d'où `couvertureCatalogue`.
 *
 * CE FICHIER GARDE LES DEUX SENS À LA FOIS : que le premier reste bien celui qui fonde le statut,
 * et que le second descende bien quand une source manque. Une correction qui les rendrait égaux
 * ferait disparaître l'information qu'on vient d'ajouter, sans casser aucun autre test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot } from '@enr/core';
import { calculerScore } from '../dist/index.js';

function snapshot(): ParcelleSnapshot {
  return snapshotVide(
    {
      idu: '28390000ZL0030',
      codeInsee: '28390',
      nomCommune: 'Tillay-le-Péneux',
      prefixe: '000',
      section: 'ZL',
      numero: '0030',
      contenanceM2: 73100,
      surfaceCalculeeM2: 73100,
      centroide: [1.77236, 48.14363],
      codeDepartement: '28',
    },
    '2026-09-26T09:00:00.000Z',
  );
}

test('LES DEUX COUVERTURES EXISTENT, ET LA SECONDE N’EST JAMAIS LA PLUS GENEREUSE', () => {
  /*
   * L'INÉGALITÉ EST STRUCTURELLE : le dénominateur du catalogue inclut celui du mesurable, plus
   * les critères sans source. Le second chiffre ne peut donc qu'être inférieur ou égal. S'il
   * devenait supérieur, c'est que l'un des deux dénominateurs aurait changé de sens.
   */
  for (const filiere of ['methanisation', 'eolien_terrestre', 'solaire_sol', 'bess', 'agrivoltaisme'] as const) {
    const s = calculerScore(snapshot(), filiere);
    assert.ok(
      s.couvertureCatalogue <= s.couvertureDonnees + 1e-9,
      `${filiere} : le sujet complet (${s.couvertureCatalogue}) ne peut pas dépasser le mesurable (${s.couvertureDonnees})`,
    );
    assert.ok(s.couvertureCatalogue >= 0 && s.couvertureCatalogue <= 1);
  }
});

test('SUR UNE FILIERE A SOURCES MANQUANTES, L’ECART EST REEL ET NON NUL', () => {
  /**
   * LE GARDE QUI COMPTE. Un `couvertureCatalogue` recopié depuis `couvertureDonnees` passerait le
   * test précédent sans rien dire de neuf — et le document réafficherait un seul chiffre.
   *
   * La méthanisation porte plusieurs critères sans source nationale ingérée : densité d'intrants,
   * débouché d'épandage, réseau gaz. Sur un instantané VIDE, le mesurable est nul partout, donc les
   * deux chiffres valent zéro : c'est la présence de critères SANS SOURCE, et non l'absence de
   * données, que ce test doit voir.
   *
   * LE SEUIL EST MESURÉ, PAS CHOISI. Sur cet instantané, ces critères pèsent **26 %** du catalogue
   * de la filière ; sur les 301 parcelles réellement qualifiées, où d'autres critères basculent
   * aussi en « sans source », l'écart constaté monte à 34 points. Le garde retient 20 % : assez bas
   * pour ne pas se déclencher sur une variation d'arrondi, assez haut pour tomber si quelqu'un
   * recopiait `couvertureCatalogue` depuis `couvertureDonnees`.
   *
   * On compare donc les deux DÉNOMINATEURS par la part que chaque critère déclare : la somme des
   * poids affichés vaut 1 sur le catalogue complet, et les critères gris « sans source » en
   * représentent une fraction mesurable.
   */
  const s = calculerScore(snapshot(), 'methanisation');
  const sansSource = s.criteres.filter((c) => /aucune source ingérée/i.test(c.valeurAffichee ?? ''));
  assert.ok(
    sansSource.length >= 3,
    `la méthanisation doit porter plusieurs critères sans source ingérée — ${sansSource.length} trouvé(s)`,
  );
  const partSansSource = sansSource.reduce((t, c) => t + c.poids, 0);
  assert.ok(
    partSansSource > 0.2,
    `ces critères doivent peser lourd : ${Math.round(partSansSource * 100)} % du catalogue`,
  );
});

test('DES QU’UN CRITERE EST RENSEIGNE, LES DEUX CHIFFRES DIVERGENT VRAIMENT', () => {
  /**
   * LE GARDE QUE LA VERIFICATION PAR MUTATION A EXIGE, et mon erreur est instructive.
   *
   * Les deux tests precedents verifiaient une INEGALITE (`catalogue <= mesurable`) et le POIDS des
   * criteres sans source. Aucun des deux ne tombe si l'on recopie simplement `couvertureCatalogue`
   * depuis `couvertureDonnees` : les deux chiffres restent coherents, simplement identiques, et le
   * document se remet a annoncer 81 % la ou 47 % du sujet a ete instruit. La mutation a survecu, et
   * elle avait raison.
   *
   * IL FAUT DONC UN CAS OU ILS DIFFERENT STRICTEMENT. Sur un instantane VIDE, aucun critere n'est
   * renseigne : `poidsRenseigne` vaut zero, et les deux chiffres valent zero. C'est la que le test
   * precedent se laissait berner.
   *
   * On renseigne donc UN critere — le poste source le plus proche — sur une filiere qui porte des
   * criteres sans source. Le numerateur devient non nul, les deux denominateurs different, et
   * l'ecart apparait.
   */
  const s = snapshot();
  s.raccordement.posteLePlusProche = {
    id: 'PS-TEST',
    nom: 'Poste de test',
    gestionnaire: 'Enedis',
    tension: '63 kV / 20 kV',
    distanceKm: 4.2,
    capaciteResiduelleMw: 12,
    etatSaturation: 'disponible',
    fileAttenteMw: null,
    quotePartEurParKw: 45,
    renforcement: { prevu: false, horizon: null, capaciteAttendueMw: null },
    enProjet: false,
  };

  const r = calculerScore(s, 'methanisation');
  assert.ok(r.couvertureDonnees > 0, 'au moins un critere doit etre renseigne pour que le test ait un sens');
  assert.ok(
    r.couvertureCatalogue < r.couvertureDonnees,
    `les deux chiffres doivent differer : mesurable ${r.couvertureDonnees}, catalogue ${r.couvertureCatalogue}`,
  );
  /*
   * ET L'ECART EST SUBSTANTIEL, pas un arrondi : c'est lui qui justifie la seconde ligne du
   * rapport. En dessous d'un point, la ligne ne s'affiche meme pas.
   */
  assert.ok(
    r.couvertureDonnees - r.couvertureCatalogue > 0.01,
    `ecart trop faible pour etre dit : ${r.couvertureDonnees - r.couvertureCatalogue}`,
  );
});
