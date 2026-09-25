/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE RESCORING REPREND UNE PARCELLE A QUI IL NE MANQUE QU'UNE SEULE FILIERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE DEFAUT MESURE. `idusSansScoreCourant` exigeait qu'il n'existe AUCUN score a la version
 * courante du moteur, toutes filieres confondues. Une parcelle notee sur quatre filieres et pas
 * sur la cinquieme etait donc jugee a jour, et le rescoring ne la reprenait JAMAIS.
 *
 * COMMENT IL A ETE TROUVE : en voulant simplement remesurer les chiffres d'un audit. La suite de
 * bout en bout avait efface les scores solaires de 299 parcelles sur 301 ; `rescorerTout` a rendu
 * « nbParcelles: 0 » et n'a rien recalcule. Apres correction, la meme commande a repris les 299
 * parcelles et reecrit 1 495 scores.
 *
 * ═══ POURQUOI C'EST GRAVE AILLEURS QUE SUR UNE BASE D'ESSAI
 *
 * LE CAS REEL EST L'AJOUT D'UNE FILIERE. Le jour ou l'agrivoltaisme est devenu la cinquieme,
 * toutes les parcelles existantes portaient deja quatre scores a la version courante : aucune
 * n'aurait ete reprise, et la nouvelle filiere serait restee vide sur l'ensemble du parc.
 *
 * ET LA PANNE EST SILENCIEUSE. Une parcelle sans score pour une filiere ne produit ni erreur ni
 * compteur : elle sort simplement de la carte, des listes et des exports pour cette filiere. Rien,
 * a l'ecran, ne distingue « aucune parcelle propice » de « aucune parcelle calculee ».
 *
 * Le territoire est entierement fictif et place en pleine mer : ces tests ne lisent ni n'ecrivent
 * aucune donnee reelle.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FILIERES } from '@enr/core';
import { VERSION_MOTEUR } from '@enr/scoring';
import { pool, requete } from '../src/bdd.js';
import { idusSansScoreCourant } from '../src/depots/parcelles.js';
import {
  creerCommunesFictives,
  INSEE_LOCAL,
  DEP_LOCAL,
  PT,
  supprimerCommunesFictives,
} from './aides/communes-fictives.js';

/**
 * L'IDU FICTIF FAIT EXACTEMENT QUATORZE CARACTERES, comme un vrai : code INSEE, prefixe, section,
 * numero. La colonne est un `varchar(14)` — un identifiant lisible du genre « TEST-RESCORE-0001 »
 * est refuse par la base, ce qu'une premiere version de ce fichier a decouvert a l'execution.
 */
const IDU = `${INSEE_LOCAL}000ZR0001`;
let baseDisponible = false;

/** Pose la parcelle fictive et son snapshot, sans aucun score. */
async function poserParcelle(): Promise<void> {
  await requete(
    `INSERT INTO parcelle
       (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
        contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation, updated_at)
     VALUES ($1, $2, 'Commune fictive de rescoring', $3, '000', 'ZR', '0001', 50000, 49800,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
             ST_SetSRID(ST_MakePoint($5, $6), 4326), now(), now())
     ON CONFLICT (idu) DO UPDATE SET updated_at = now()`,
    [
      IDU,
      INSEE_LOCAL,
      DEP_LOCAL,
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [PT[0], PT[1]],
            [PT[0] + 0.002, PT[1]],
            [PT[0] + 0.002, PT[1] + 0.002],
            [PT[0], PT[1] + 0.002],
            [PT[0], PT[1]],
          ],
        ],
      }),
      PT[0] + 0.001,
      PT[1] + 0.001,
    ],
  );
  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, date_snapshot)
     VALUES ($1, '{}'::jsonb, '{}', now())
     ON CONFLICT (idu) DO UPDATE SET date_snapshot = now()`,
    [IDU],
  );
}

/** Ecrit un score a la version COURANTE du moteur pour chacune des filieres donnees. */
async function noter(filieres: readonly string[]): Promise<void> {
  for (const filiere of filieres) {
    await requete(
      `INSERT INTO score_parcelle_filiere
         (idu, filiere, score_global, statut, couverture_donnees, detail, version_moteur,
          date_calcul)
       VALUES ($1, $2, 50, 'orange', 0.9, '{}'::jsonb, $3, now())
       ON CONFLICT (idu, filiere, profil_ponderation)
         DO UPDATE SET version_moteur = EXCLUDED.version_moteur`,
      [IDU, filiere, VERSION_MOTEUR],
    );
  }
}

async function nettoyer(): Promise<void> {
  await requete(`DELETE FROM score_parcelle_filiere WHERE idu = $1`, [IDU]);
  await requete(`DELETE FROM parcelle_snapshot WHERE idu = $1`, [IDU]);
  await requete(`DELETE FROM parcelle WHERE idu = $1`, [IDU]);
}

before(async () => {
  if (!process.env['DATABASE_URL']) return;
  try {
    await requete(`SELECT 1 FROM parcelle_snapshot LIMIT 1`);
  } catch (err) {
    throw new Error(
      `DATABASE_URL est defini mais la base est injoignable : ${(err as Error).message}. ` +
        'Ces tests ne doivent pas passer a vide — soit la base repond, soit DATABASE_URL est absent.',
      { cause: err },
    );
  }
  baseDisponible = true;
  await creerCommunesFictives();
  await nettoyer();
});

after(async () => {
  if (baseDisponible) {
    await nettoyer();
    await supprimerCommunesFictives();
  }
  await pool.end().catch(() => undefined);
});

function ignorer(): boolean {
  if (!baseDisponible) {
    process.stderr.write('# base indisponible : rescoring ignore (DATABASE_URL requis)\n');
    return true;
  }
  return false;
}

/** La parcelle fictive figure-t-elle dans la population a recalculer ? */
async function reprise(filieres: readonly string[]): Promise<boolean> {
  const idus = await idusSansScoreCourant(VERSION_MOTEUR, filieres, 100000);
  return idus.includes(IDU);
}

test('UNE SEULE FILIERE MANQUANTE SUFFIT A REPRENDRE LA PARCELLE', async () => {
  if (ignorer()) return;
  await nettoyer();
  await poserParcelle();

  // Toutes les filieres SAUF une : c'est exactement l'etat qui passait inapercu.
  const [absente, ...notees] = FILIERES;
  assert.ok(absente && notees.length >= 3, 'le depot doit porter au moins quatre filieres');
  await noter(notees);

  assert.equal(
    await reprise(FILIERES),
    true,
    `il manque « ${absente} » : la parcelle doit etre reprise par le rescoring`,
  );
});

test('UNE PARCELLE COMPLETE N’EST PAS REPRISE — SANS QUOI LE RESCORING NE FINIRAIT JAMAIS', async () => {
  if (ignorer()) return;
  await nettoyer();
  await poserParcelle();
  await noter(FILIERES);

  /*
   * LE CONTRE-EXEMPLE EST INDISPENSABLE. `rescorerSiVersionObsolete` boucle tant que la selection
   * rend des parcelles : une selection qui rendrait TOUJOURS tout le monde tournerait sans fin au
   * demarrage du serveur, en recalculant le parc entier a chaque tour. Une correction trop large
   * aurait remplace une panne silencieuse par une boucle infinie.
   */
  assert.equal(await reprise(FILIERES), false, 'rien ne manque : la parcelle ne doit pas revenir');
});

test('LA SELECTION SUIT LES FILIERES DEMANDEES, ET NON LA LISTE COMPLETE', async () => {
  if (ignorer()) return;
  await nettoyer();
  await poserParcelle();

  const [absente, ...notees] = FILIERES;
  assert.ok(absente && notees[0]);
  await noter(notees);

  /*
   * `rescorerTout` accepte un sous-ensemble de filieres — c'est ce que fait
   * `npm run rescorer -- solaire_sol`. Demander une filiere DEJA notee ne doit rien reprendre :
   * sinon un rescoring cible recalculerait tout le parc, pour rien.
   */
  assert.equal(await reprise([notees[0]]), false, 'cette filiere est notee : rien a reprendre');
  assert.equal(await reprise([absente]), true, 'celle-ci manque : elle doit etre reprise');
});
