/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * « AUCUNE ZONE » ET « ON N'EN SAIT RIEN » NE SONT PAS LA MEME PHRASE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le panneau des zones a trois etats, et leur distinction est tout son interet. Le plus important
 * est le troisieme : sur la quasi-totalite du territoire, la ZAER n'a jamais ete ingeree. Y
 * afficher une liste vide ferait conclure « il n'y a rien a prospecter ici », ce qui est faux — et
 * c'est precisement la famille de fautes que ce projet traque depuis dix audits.
 *
 * Ces trois etats se lisent dans le TEXTE RENDU, pas dans une intention : ce fichier monte le
 * composant et lit ce qui sort.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { Resultats } from '../src/components/PanneauZones.js';
import { rendre, texte } from './aides/rendu.js';
import type { ReponseZones, ZoneProposee } from '../src/api/client.js';

const ZONE: ZoneProposee = {
  id: '1',
  nom: 'DAMMARIE PV',
  codeInsee: '28122',
  nomCommune: 'Dammarie',
  codeDepartement: '28',
  filieres: ['solaire_sol'],
  surfaceHa: 42.5,
  surfaceUtileHa: 39.8,
  dateDeliberation: '2025-04-23',
  centre: [1.49, 48.33],
  bbox: [1.4, 48.3, 1.5, 48.4],
  nbParcellesQualifiees: 0,
  nbPropices: 0,
  implantationPrecisee: true,
};

function rendu(donnees: ReponseZones): string {
  return texte(rendre(h(Resultats, { donnees, onAllerVers: () => undefined })));
}

test('des zones sont proposees, avec leur surface UTILE', () => {
  const t = rendu({
    zones: [ZONE],
    couverture: { departementsIngeres: ['28'], donneePresente: true },
    surfaceUtileMinHa: 1,
    nbTropPetites: 0,
  });
  assert.ok(t.includes('Dammarie'), 'le nom de la commune doit apparaitre');
  // La surface utile est le chiffre qui decide : c'est elle qu'on implante, pas la brute.
  assert.ok(/39[,.]8/.test(t), `la surface utile doit etre affichee — obtenu : ${t.slice(0, 200)}`);
});

test('AUCUNE DONNEE INGEREE : l’application dit qu’elle n’en sait rien', () => {
  /*
   * L'etat le plus important, et le seul honnete aujourd'hui sur presque tout le territoire. Le
   * texte doit dire que l'application IGNORE, pas qu'il n'y a rien.
   */
  const t = rendu({
    zones: [],
    couverture: { departementsIngeres: [], donneePresente: false },
    surfaceUtileMinHa: 1,
    nbTropPetites: 0,
  });
  assert.ok(/n’en sait rien|n'en sait rien/.test(t), `l’ignorance doit etre dite — obtenu : ${t}`);
  assert.ok(t.includes('ingest'), 'la commande d’ingestion doit etre donnee');
});

test('TERRITOIRE INGERE MAIS SANS ZONE : c’est « rien ici », et on nomme les departements', () => {
  const t = rendu({
    zones: [],
    couverture: { departementsIngeres: ['28', '45'], donneePresente: true },
    surfaceUtileMinHa: 1,
    nbTropPetites: 12,
  });
  assert.ok(t.includes('28'), 'les departements charges doivent etre nommes');
  assert.ok(t.includes('45'));
  assert.ok(!/n’en sait rien|n'en sait rien/.test(t), 'ce n’est PAS l’etat « on ignore »');
  // Les zones ecartees pour leur taille sont comptees : sans ce chiffre, « aucune zone » cache que
  // douze existaient et qu'elles etaient trop petites.
  assert.ok(t.includes('12'), 'les zones ecartees pour leur taille doivent etre comptees');
});

test('une implantation non precisee est SIGNALEE, pas tue', () => {
  const t = rendu({
    zones: [{ ...ZONE, implantationPrecisee: false }],
    couverture: { departementsIngeres: ['28'], donneePresente: true },
    surfaceUtileMinHa: 1,
    nbTropPetites: 0,
  });
  assert.ok(
    /implantation non pr[ée]cis[ée]e/.test(t),
    `la reserve doit etre visible — obtenu : ${t.slice(0, 300)}`,
  );
});

test('la couverture est rappelee MEME quand la liste n’est pas vide', () => {
  // Quarante zones toutes situees dans un departement pourraient faire croire que le reste du pays
  // a ete regarde et n'a rien donne.
  const t = rendu({
    zones: [ZONE],
    couverture: { departementsIngeres: ['28'], donneePresente: true },
    surfaceUtileMinHa: 1,
    nbTropPetites: 0,
  });
  assert.ok(/Départements chargés/.test(t), 'la couverture doit etre rappelee sous la liste');
});
