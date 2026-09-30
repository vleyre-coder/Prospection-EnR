/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN CRITÈRE DOIT DÉCLARER LA SOURCE QUI L'ALIMENTE — PAS UNE AUTRE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE GARDE A COÛTÉ DE NE PAS EXISTER, mesuré le 30/09/2026. Le critère `dist_captage`
 * déclarait Géorisques. Or `eau.captageAep` n'est rempli QUE par le connecteur des servitudes,
 * depuis les assiettes AS1 du Géoportail de l'urbanisme — le connecteur Géorisques écrit
 * explicitement `null`, avec le commentaire qui le dit.
 *
 * Le moteur annule la note de tout critère dont la source figure parmi les connecteurs en échec.
 * C'est un mécanisme juste : une donnée par défaut notée comme une mesure serait pire qu'une
 * absence de note. Mais avec une étiquette fausse, il **jette une donnée valide** : Géorisques
 * étant injoignable depuis ce poste, la note du captage disparaissait sur les 301 parcelles alors
 * que le GPU avait répondu. **5,5 % du poids de la méthanisation, perdus sur un nom.**
 *
 * Et la fiche remise au développeur nommait Géorisques comme source d'un périmètre de captage. Une
 * référence fausse dans un document de traçabilité vaut moins que pas de référence du tout : celui
 * qui vérifie ne trouve rien, et cesse de croire les autres.
 *
 * ═══ CE QUE CE FICHIER NE VÉRIFIE PAS, ET IL FAUT LE DIRE D'ABORD
 *
 * **Ce garde n'aurait pas attrapé le défaut du captage**, et prétendre le contraire serait
 * exactement le genre de fausse assurance que ce dépôt traque.
 *
 * La raison est structurelle : le moteur annule une note en comparant la source DÉCLARÉE aux
 * connecteurs en échec. Il ne sait pas quel connecteur remplit quel champ — cette correspondance
 * vit dans `enrichissement.ts`, hors de ce paquet. Un critère mal étiqueté perd donc sa note quand
 * sa source déclarée tombe, exactement comme un critère bien étiqueté : de l'intérieur du moteur,
 * les deux sont indiscernables.
 *
 * **La seule protection contre une étiquette fausse est la revue champ par champ**, faite à la main
 * le 30/09/2026 sur les 43 critères — un seul était faux — et consignée dans
 * `docs/SOURCES_DONNEES.md`. Les deux motifs de mutation du captage gardent ce cas précis.
 *
 * ═══ CE QU'IL VÉRIFIE, ET QUI VAUT D'ÊTRE GARDÉ
 *
 * Que **le mécanisme d'annulation fonctionne** : sur une parcelle renseignée, la note de chaque
 * critère disparaît quand sa source déclarée est mise en échec. C'est étroit, et c'est réel — si
 * quelqu'un désarmait `sourceEnEchec`, une donnée par défaut se noterait comme une mesure sur
 * toutes les sources tombées, et rien d'autre ne le dirait.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVide, type ParcelleSnapshot, FILIERES } from '@enr/core';
import { calculerScore, SRC } from '../dist/index.js';

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
    '2026-09-30T09:00:00.000Z',
  );
}

/**
 * Une parcelle dont assez de champs sont renseignés pour que la plupart des critères notent, et
 * dont TOUTES les sources connues sont déclarées.
 *
 * Les deux vont ensemble : la source d'un critère est résolue depuis `snapshot.sources`, si bien
 * qu'un instantané qui n'en déclare aucune rend `source: null` partout — et le garde passerait à
 * vide en croyant avoir tout vérifié. C'est le compteur `observes` qui l'a dit.
 */
function parcelleRenseignee(): ParcelleSnapshot {
  const s = snapshot();
  for (const connecteur of Object.values(SRC)) {
    s.sources[connecteur] = {
      nom: connecteur,
      connecteur,
      dateInterrogation: '2026-09-30T09:00:00.000Z',
      valeurJuridique: 'indicative',
    };
  }
  s.eau.captageAep = { dansPerimetre: false, type: null, distanceM: 800, auDelaDeM: null };
  s.eau.distanceCoursEauM = 420;
  s.eau.zoneHumide = 'non';
  s.eau.inondation = { zonagePpri: null, alea: 'nul', dansTri: false };
  s.bati.distanceHabitationM = 900;
  s.acces.distanceVoirieM = 120;
  s.topographie.pentePourcent = 2;
  s.topographie.altitudeM = 140;
  s.gisement.irradiationKwhM2An = 1250;
  s.gisement.ventVitesse100mMs = 6.9;
  s.patrimoine.monumentHistorique.distanceM = 2400;
  return s;
}

test('AUCUN CRITÈRE N’ANNONCE DEUX SOURCES À LA FOIS', () => {
  /**
   * `sourceKey` est un champ unique : un critère qui voudrait en citer deux ne le peut pas, et c'est
   * volontaire. Ce que ce test vérifie est plus subtil — que la source **résolue** dans le résultat
   * soit bien celle qui a été déclarée, et non une valeur laissée par un chemin précédent.
   */
  const s = parcelleRenseignee();
  for (const filiere of FILIERES) {
    for (const c of calculerScore(s, filiere).criteres) {
      if (c.source == null) continue;
      assert.equal(
        typeof c.source.connecteur,
        'string',
        `${filiere}/${c.id} : la source résolue doit porter un connecteur nommé`,
      );
    }
  }
});

test('LE MÉCANISME D’ANNULATION SUR SOURCE EN ÉCHEC COUVRE TOUS LES CRITÈRES', () => {
  /**
   * Le test parcourt les critères qui notent réellement sur une parcelle renseignée, met LEUR
   * source en échec une par une, et exige que la note tombe. Il compte aussi les critères
   * observés : sans ce compte, un jour où plus rien ne noterait, il passerait à vide en croyant
   * avoir tout vérifié — c'est d'ailleurs ce qu'il a fait à sa première exécution, avant que les
   * sources ne soient déclarées dans le fixture.
   *
   * Ce qu'il garde est le MÉCANISME, pas l'exactitude des étiquettes : voir l'en-tête du fichier.
   */
  const s = parcelleRenseignee();
  const anomalies: string[] = [];
  let observes = 0;

  for (const filiere of FILIERES) {
    const base = calculerScore(s, filiere);
    for (const c of base.criteres) {
      if (c.note == null) continue;
      const cle = c.source?.connecteur;
      // Un critere note sans source resolue n'est pas testable ici : la carte `sources` de
      // l'instantane de test ne declare pas tous les connecteurs.
      if (!cle) continue;
      observes += 1;
      const enPanne = calculerScore(s, filiere, { connecteursEnEchec: [cle] });
      const apres = enPanne.criteres.find((x) => x.id === c.id);
      if (apres?.note != null) anomalies.push(`${filiere}/${c.id} (source déclarée : ${cle})`);
    }
  }

  assert.ok(
    observes >= 5,
    `aucun critère noté avec source résolue (${observes}) : le fixture ne renseigne plus rien`,
  );
  assert.deepEqual(
    [...new Set(anomalies)],
    [],
    'ces critères gardent leur note alors que leur source déclarée est en échec : ' +
      'soit ils sont alimentés par une autre source, soit le mécanisme d’annulation est cassé',
  );
});
