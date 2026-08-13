/**
 * Semer des fiches de parcelle REELLES en base, depuis les fixtures capturees.
 *
 * POURQUOI CE FICHIER EXISTE — un defaut trouve en verifiant le present chantier par mutation, et il
 * cassait la CI. `rapport-pdf.test.ts` choisissait ses parcelles PAR UNE REQUETE sur la base : « la plus
 * grande parcelle qualifiee dans chaque filiere ». Le raisonnement etait bon (ne jamais ecrire un
 * identifiant en dur, et travailler sur de la donnee reelle), mais sa consequence ne l'etait pas — la
 * portee du test devenait une propriete de la MACHINE :
 *
 *   - sur ma base de developpement, quatre filieres couvertes et une parcelle ecartee : les deux
 *     mutations correspondantes etaient attrapees ;
 *   - sur une base vierge fraichement migree — celle de la CI — aucune parcelle du tout : le fichier
 *     s'ignorait en entier, les deux mutations passaient, et le script de mutation signalait
 *     legitimement deux tests decoratifs. **Le job de mutation de la CI echouait donc.**
 *   - sur une base semee pour les tests de bout en bout, une seule filiere, et la plus grande parcelle
 *     se trouvait n'avoir aucune nature de sol renseignee : la mutation qui replace le libelle par la
 *     cle d'enumeration ne produisait alors rien a trouver.
 *
 * Un test qui reduit sa portee selon la base l'ANNONCAIT (c'est ce qui a permis de comprendre), mais
 * annoncer ne suffit pas quand la portee tombe a zero : la garde disparait sans que rien n'echoue.
 *
 * CE MODULE FOURNIT DONC LA DONNEE AU TEST, plutot que de l'y chercher. Elle reste REELLE — ce sont les
 * reponses d'API capturees pour les tests de rendu, geometries comprises — mais elle est REIDENTIFIEE
 * vers un departement fictif : un test ne doit jamais ecrire sur l'identifiant d'une parcelle veritable,
 * qui existerait dans la base de production de quelqu'un.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composerIdu } from '@enr/core';
import { requete } from '../../src/bdd.js';

const ICI = dirname(fileURLToPath(import.meta.url));
/** Les fixtures vivent avec les tests de rendu de l'interface : une seule capture pour les deux usages. */
const FIXTURES = resolve(ICI, '../../../web/test/fixtures');

export interface FicheSemee {
  parcelle: {
    idu: string;
    codeInsee: string;
    nomCommune: string | null;
    codeDepartement: string;
    prefixe: string;
    section: string;
    numero: string;
    contenanceM2: number | null;
    surfaceCalculeeM2: number | null;
    geometrie: unknown;
    centroide: [number, number];
  };
  snapshot: { identite?: Record<string, unknown> } & Record<string, unknown>;
  connecteursEnEchec: string[];
  score: {
    filiere: string;
    statut: string;
    scoreGlobal: number | null;
    couvertureDonnees: number;
    knockOuts: Array<{ derogeable: boolean }>;
    regimeImplantation: string | null;
    versionMoteur: string;
  } & Record<string, unknown>;
}

/** Les fiches capturees, dans l'ordre des fichiers. Leve si le repertoire est vide. */
export function lireFiches(): { fichier: string; fiche: FicheSemee }[] {
  const fichiers = readdirSync(FIXTURES).filter((f) => f.startsWith('fiche-') && f.endsWith('.json'));
  if (fichiers.length === 0) {
    throw new Error(
      `Aucune fixture dans ${FIXTURES}. Regenerez-les avec ` +
        '`npx tsx apps/api/scripts/capturer-fixtures-web.ts` contre une base peuplee.',
    );
  }
  return fichiers.map((fichier) => ({
    fichier,
    fiche: JSON.parse(readFileSync(join(FIXTURES, fichier), 'utf8')) as FicheSemee,
  }));
}

/**
 * Deplace une fiche vers une commune fictive, identifiant compris.
 *
 * La section et le numero sont CONSERVES : ils rendent la parcelle reconnaissable d'une fixture a
 * l'autre, et l'identifiant reste un identifiant valide de quatorze caracteres — recompose par la regle
 * du noyau, pas par une concatenation locale. Le contenu de l'instantane et du score n'est pas touche :
 * c'est lui qui porte la valeur de preuve.
 */
export function reidentifier(
  fiche: FicheSemee,
  cible: { codeInsee: string; codeDepartement: string; nomCommune: string },
): FicheSemee {
  const idu = composerIdu({
    codeInsee: cible.codeInsee,
    prefixe: fiche.parcelle.prefixe,
    section: fiche.parcelle.section,
    numero: fiche.parcelle.numero,
  });
  return {
    ...fiche,
    parcelle: {
      ...fiche.parcelle,
      idu,
      codeInsee: cible.codeInsee,
      codeDepartement: cible.codeDepartement,
      nomCommune: cible.nomCommune,
    },
    // L'instantane porte sa propre identite. La laisser en desaccord avec la ligne de parcelle
    // donnerait deux verites pour la meme parcelle — le defaut corrige dans le connecteur cadastre.
    snapshot: {
      ...fiche.snapshot,
      ...(fiche.snapshot.identite
        ? {
            identite: {
              ...fiche.snapshot.identite,
              idu,
              codeInsee: cible.codeInsee,
              codeDepartement: cible.codeDepartement,
              nomCommune: cible.nomCommune,
            },
          }
        : {}),
    },
  };
}

/**
 * Insere une fiche : parcelle, instantane, score. Idempotent.
 *
 * L'instantane est date de MAINTENANT, deliberement : la route de la fiche re-enrichit une parcelle dont
 * l'instantane est perime (audit 9, defaut A2), et re-enrichir signifie appeler les API externes.
 */
export async function semerFiche(fiche: FicheSemee): Promise<void> {
  const p = fiche.parcelle;
  await requete(
    `INSERT INTO parcelle
       (idu, code_insee, nom_commune, code_departement, prefixe, section, numero,
        contenance_m2, surface_calculee_m2, geom, centroide, date_recuperation, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)),
             ST_SetSRID(ST_MakePoint($11, $12), 4326), now(), now())
     ON CONFLICT (idu) DO UPDATE SET
       nom_commune = EXCLUDED.nom_commune,
       geom = EXCLUDED.geom,
       centroide = EXCLUDED.centroide,
       updated_at = now()`,
    [
      p.idu,
      p.codeInsee,
      p.nomCommune,
      p.codeDepartement,
      p.prefixe,
      p.section,
      p.numero,
      p.contenanceM2,
      p.surfaceCalculeeM2,
      JSON.stringify(p.geometrie),
      p.centroide[0],
      p.centroide[1],
    ],
  );

  await requete(
    `INSERT INTO parcelle_snapshot (idu, snapshot, connecteurs_en_echec, couverture, date_snapshot)
     VALUES ($1, $2::jsonb, $3, $4, now())
     ON CONFLICT (idu) DO UPDATE SET
       snapshot = EXCLUDED.snapshot,
       connecteurs_en_echec = EXCLUDED.connecteurs_en_echec,
       couverture = EXCLUDED.couverture,
       date_snapshot = now()`,
    [p.idu, JSON.stringify(fiche.snapshot), fiche.connecteursEnEchec, fiche.score.couvertureDonnees],
  );

  const s = fiche.score;
  await requete(
    `INSERT INTO score_parcelle_filiere
       (idu, filiere, statut, score_global, detail, couverture_donnees, nb_knock_outs,
        nb_knock_outs_bloquants, regime_implantation, profil_ponderation, version_moteur, date_calcul)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'defaut', $10, now())
     ON CONFLICT (idu, filiere, profil_ponderation) DO UPDATE SET
       statut = EXCLUDED.statut,
       score_global = EXCLUDED.score_global,
       detail = EXCLUDED.detail,
       couverture_donnees = EXCLUDED.couverture_donnees,
       nb_knock_outs = EXCLUDED.nb_knock_outs,
       nb_knock_outs_bloquants = EXCLUDED.nb_knock_outs_bloquants,
       regime_implantation = EXCLUDED.regime_implantation,
       version_moteur = EXCLUDED.version_moteur,
       date_calcul = now()`,
    [
      p.idu,
      s.filiere,
      s.statut,
      s.scoreGlobal,
      JSON.stringify(s),
      s.couvertureDonnees,
      s.knockOuts.length,
      s.knockOuts.filter((k) => !k.derogeable).length,
      s.regimeImplantation,
      s.versionMoteur,
    ],
  );
}

/** Retire tout ce qui a ete seme dans un departement fictif. */
export async function effacerDepartement(codeDepartement: string): Promise<void> {
  await requete(
    `DELETE FROM score_parcelle_filiere WHERE idu IN
       (SELECT idu FROM parcelle WHERE code_departement = $1)`,
    [codeDepartement],
  );
  await requete(
    `DELETE FROM parcelle_snapshot WHERE idu IN
       (SELECT idu FROM parcelle WHERE code_departement = $1)`,
    [codeDepartement],
  );
  await requete(`DELETE FROM parcelle WHERE code_departement = $1`, [codeDepartement]);
}
