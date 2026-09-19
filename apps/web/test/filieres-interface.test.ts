/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE FILIERE AJOUTEE DOIT ARRIVER ENTIERE JUSQU'A L'ECRAN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROTEGE. L'ajout d'une filiere au référentiel fait échouer la compilation
 * partout où un `Record<Filiere, …>` existe — et c'est précisément ce qui rend dangereux les
 * endroits où elle ne la fait PAS échouer. Deux de ces endroits vivent dans l'interface, et
 * l'agrivoltaïsme est passé dans les deux sans un mot :
 *
 *   1. L'ICONE. `Icone` retombe sur le soleil quand le nom est inconnu — un repli raisonnable, qui
 *      évite une case vide. Mais une métadonnée annonçant une icône inexistante affiche alors un
 *      SECOND SOLEIL, identique à celui du solaire au sol, dans la barre où il faut précisément
 *      distinguer les deux filières. Rien n'échoue, et l'opérateur clique sur la mauvaise.
 *
 *   2. LE LIBELLE COURT. C'est le seul texte de l'onglet. Deux filières qui le partagent rendent
 *      la barre illisible, et le `title` ne se lit qu'au survol.
 *
 * Ces deux contrôles ne coûtent rien et se déclencheront à la prochaine filière.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILIERES, FILIERES_META } from '@enr/core';
import { CHEMINS_ICONES } from '../src/components/BarreSuperieure.js';

test('CHAQUE FILIERE A SON ICONE, ET AUCUNE NE TOMBE SUR LE REPLI', () => {
  const sansIcone: string[] = [];
  for (const f of FILIERES) {
    const nom = FILIERES_META[f].icone;
    if (!(nom in CHEMINS_ICONES)) sansIcone.push(`${f} annonce « ${nom} », qui n’existe pas`);
  }
  assert.deepEqual(
    sansIcone,
    [],
    `la filière retomberait sur le soleil, sans erreur : ${sansIcone.join(' ; ')}`,
  );
});

test('DEUX FILIERES NE PARTAGENT NI LEUR ICONE NI LEUR LIBELLE COURT', () => {
  /*
   * Le sélecteur de filière est le contrôle principal de l'application : tout le reste — couches
   * affichées, critères évalués, pondérations, verdict — en dépend. Deux onglets qui se ressemblent
   * y sont plus coûteux qu'ailleurs.
   */
  const icones = new Map<string, string>();
  const libelles = new Map<string, string>();
  for (const f of FILIERES) {
    const meta = FILIERES_META[f];
    const dejaIcone = icones.get(meta.icone);
    assert.equal(dejaIcone, undefined, `${f} et ${dejaIcone} portent l’icône « ${meta.icone} »`);
    icones.set(meta.icone, f);

    const dejaLibelle = libelles.get(meta.libelleCourt);
    assert.equal(
      dejaLibelle,
      undefined,
      `${f} et ${dejaLibelle} s’affichent tous deux « ${meta.libelleCourt} » dans la barre`,
    );
    libelles.set(meta.libelleCourt, f);
  }
});
