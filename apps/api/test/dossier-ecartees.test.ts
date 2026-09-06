/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE PARCELLE ECARTEE NE DOIT PAS GONFLER LE CHIFFRE DE PROJET
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE DEFAUT, trouve en mesurant la charge du dossier et non en cherchant celui-la. `surfaceUtileSiteHa`
 * recevait TOUTES les parcelles de la selection, y compris celles portant un critere redhibitoire
 * BLOQUANT. Le dossier annoncait donc, en page une, une surface et une puissance qui comptaient du
 * foncier juridiquement hors d'atteinte — pendant que la section « Reserves », dix centimetres plus
 * bas, expliquait que cette parcelle-la etait ecartee.
 *
 * POURQUOI C'EST LE PIRE ENDROIT OU SE TROMPER. Ces deux nombres sont exactement ceux qu'un
 * developpeur recopie dans son modele economique. Une reserve enterree trois sections plus loin ne
 * les rattrape pas : le chiffre est deja parti.
 *
 * POURQUOI CE FICHIER N'A PAS BESOIN DE BASE. La faute est entierement dans `dossierSitePdf`, une
 * fonction pure de ses entrees. La construire a la main permet de poser exactement le cas qui
 * manque aux fixtures — une parcelle solaire BLOQUANTE a cote d'une parcelle saine — au lieu
 * d'esperer qu'une base en contienne une. Le fichier tourne donc dans `npm test`, sans serialisation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identiteDepuisIdu, snapshotVide, type Feu, type KnockOut, type ResultatScore } from '@enr/core';
import { dossierSitePdf, type ParcelleDuDossier } from '../src/services/exports.js';
import { texteDuPdf } from './aides/texte-pdf.js';
import type { ParcelleEnBase } from '../src/depots/parcelles.js';

/** Departement 99, en pleine mer : le territoire fictif du depot. */
const IDU_SAINE = '990010000A0001';
const IDU_BLOQUEE = '990010000A0002';

function parcelle(idu: string, numero: string, hectares: number): ParcelleEnBase {
  return {
    idu,
    codeInsee: '99001',
    nomCommune: 'Commune fictive',
    codeDepartement: '99',
    prefixe: '000',
    section: '0A',
    numero,
    contenanceM2: hectares * 10000,
    surfaceCalculeeM2: hectares * 10000,
    geometrie: { type: 'Polygon', coordinates: [[[-6.5, 47], [-6.49, 47], [-6.49, 47.01], [-6.5, 47.01], [-6.5, 47]]] },
    centroide: [-6.495, 47.005],
    dateRecuperation: new Date().toISOString(),
  } as ParcelleEnBase;
}

function score(idu: string, statut: Feu, knockOuts: KnockOut[]): ResultatScore {
  return {
    idu,
    filiere: 'solaire_sol',
    statut,
    scoreGlobal: statut === 'rouge' ? null : 70,
    knockOuts,
    limitesViabilite: [],
    criteres: [],
    pointsForts: [],
    pointsVigilance: [],
    seuilsProcedure: [],
    couvertureDonnees: 0.9,
    regimeImplantation: null,
    ponderationsAppliquees: {},
    versionMoteur: '0.0.0+test',
    dateCalcul: new Date().toISOString(),
    avertissements: [],
  };
}

function entree(idu: string, numero: string, hectares: number, bloquee: boolean): ParcelleDuDossier {
  const ko: KnockOut[] = bloquee
    ? [
        {
          id: 'test_bloquant',
          libelle: 'Zonage incompatible',
          motif: 'Cas de test : critère rédhibitoire bloquant.',
          derogeable: false,
          regleLiee: null,
        } as unknown as KnockOut,
      ]
    : [];
  return {
    parcelle: parcelle(idu, numero, hectares),
    snapshot: snapshotVide(identiteDepuisIdu(idu)),
    score: score(idu, bloquee ? 'rouge' : 'vert', ko),
    connecteursEnEchec: [],
    statutProspection: null,
  };
}

async function texte(entrees: ParcelleDuDossier[]): Promise<string> {
  const flux = dossierSitePdf(entrees, { filiere: 'solaire_sol', nbGroupesContigus: null });
  const morceaux: Buffer[] = [];
  for await (const m of flux as AsyncIterable<Buffer>) morceaux.push(Buffer.from(m));
  return texteDuPdf(Buffer.concat(morceaux));
}

const sansEspaces = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
const contient = (t: string, phrase: string): boolean => sansEspaces(t).includes(sansEspaces(phrase));

test('LE CHIFFRE EXPLOITABLE EST DONNE A COTE DU TOTAL quand une parcelle est ecartee', async () => {
  const t = await texte([
    entree(IDU_SAINE, '0001', 20, false),
    entree(IDU_BLOQUEE, '0002', 30, true),
  ]);

  // Le total reste celui de la selection : elle est celle de l'operateur.
  assert.ok(
    contient(t, '50,00 ha'),
    'la surface cadastrale cumulee doit rester celle de la selection entiere (20 + 30 ha)',
  );

  /*
   * ET LE CHIFFRE INSTRUISIBLE EXISTE. Sans ces deux lignes, le dossier annonce en page une une
   * puissance qui compte 30 ha de foncier juridiquement hors d'atteinte, et rien a cote d'elle ne
   * le dit — la reserve est trois sections plus bas.
   */
  assert.ok(
    contient(t, 'Surface utile HORS parcelles écartées'),
    'la surface utile hors parcelles ecartees manque : le chiffre de projet compte du foncier ecarte',
  );
  assert.ok(
    contient(t, 'Puissance HORS parcelles écartées'),
    'la puissance hors parcelles ecartees manque',
  );
  assert.ok(
    contient(t, '2 dont 1 écartée'),
    'le compte des parcelles doit dire combien sont ecartees',
  );
  assert.ok(
    contient(t, 'ne disent pas la même chose'),
    'l’encadre qui explique la difference entre les deux chiffres manque',
  );
});

test('LES DEUX CHIFFRES DIFFERENT REELLEMENT : le second ne recopie pas le premier', async () => {
  /*
   * LE GARDE QUI COMPTE. Afficher deux libelles differents portant le MEME nombre serait pire que
   * de n'en afficher qu'un : le lecteur croirait que l'ecart a ete calcule et qu'il est nul. La
   * parcelle bloquee fait 30 ha sur 50 : le chiffre exploitable doit etre franchement plus bas.
   */
  const t = await texte([
    entree(IDU_SAINE, '0001', 20, false),
    entree(IDU_BLOQUEE, '0002', 30, true),
  ]);
  const surfaces = [...t.matchAll(/(\d+),(\d{2}) ha/g)].map((m) => Number(`${m[1]}.${m[2]}`));
  const puissances = [...t.matchAll(/(\d+),(\d{2}) MWc/g)].map((m) => Number(`${m[1]}.${m[2]}`));
  assert.ok(
    Math.max(...puissances) - Math.min(...puissances) > 1,
    `les puissances imprimees sont ${puissances.join(', ')} : le chiffre « hors parcelles ecartees » ` +
      "ne se distingue pas du total, alors que 30 ha sur 50 sont ecartes",
  );
  assert.ok(
    surfaces.some((s) => s > 15 && s < 21),
    `aucune surface proche des 20 ha exploitables parmi ${surfaces.join(', ')}`,
  );
});

test('SANS PARCELLE ECARTEE, le dossier ne montre PAS de second chiffre', async () => {
  /*
   * La faute symetrique, et elle est reelle : deux lignes de plus sur chaque dossier, portant
   * toujours la meme valeur que celles du dessus, apprendraient au lecteur a ne plus les lire — et
   * le jour ou elles different, il ne le verrait pas.
   */
  const t = await texte([
    entree(IDU_SAINE, '0001', 20, false),
    entree(IDU_BLOQUEE, '0002', 30, false),
  ]);
  assert.ok(
    !contient(t, 'HORS parcelles écartées'),
    'aucune parcelle n’est ecartee : les lignes « hors parcelles ecartees » ne doivent pas apparaitre',
  );
  assert.ok(!contient(t, 'ne disent pas la même chose'), 'l’encadre ne doit pas apparaitre non plus');
});
