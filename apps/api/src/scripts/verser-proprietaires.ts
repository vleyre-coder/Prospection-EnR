/**
 * Versement des donnees de propriete dans `proprietaire_parcelle`.
 *
 * POURQUOI CE SCRIPT EXISTE. La table n'est alimentee par aucun connecteur, et elle ne le sera
 * pas : aucune API publique n'expose legalement les donnees nominatives de propriete. Elles
 * s'obtiennent par demande documentee aupres du service de la publicite fonciere (DGFiP) ou
 * de la mairie, dans le cadre d'un motif legitime — ce que le code general des impots autorise
 * a l'article L.107 A pour la consultation du fichier immobilier, et ce que la commune peut
 * communiquer sur le fondement du code des relations entre le public et l'administration.
 *
 * Le resultat de cette demande arrive en tableur. Sans ce script, l'utilisateur disposait d'une
 * fonction complete cote lecture — habilitation, motif obligatoire, journalisation stricte,
 * avertissements — protegeant un tiroir qu'aucun moyen ne permettait de remplir. C'etait la
 * derniere piece manquante, et elle est petite.
 *
 * CE SCRIPT N'INVENTE RIEN. Il refuse tout enregistrement sans origine documentee et sans date
 * de purge : ce sont les deux obligations qui rendent la conservation licite. Une donnee
 * nominative sans provenance ni echeance n'a pas a entrer dans la base.
 *
 * Usage :
 *   npm run verser:proprietaires --workspace @enr/api -- fichier.csv
 *
 * Format attendu, separateur point-virgule, premiere ligne d'en-tetes :
 *
 *   idu;nb_comptes;indivision;proprietaire_public;nominatif;origine_donnee;purge_prevue_le
 *   283900000C0843;2;oui;non;{"noms":["DUPONT Jean"]};Demande DGFiP du 12/05/2026;2027-05-12
 *
 * Le champ `nominatif` peut etre laisse brut comme ci-dessus, ou echappe selon les regles CSV
 * (`"{""noms"":[""DUPONT Jean""]}"`) : les deux formes sont acceptees. Il ne doit en revanche
 * jamais contenir de point-virgule non echappe.
 *
 * - `idu` : 14 caracteres, obligatoire.
 * - `nb_comptes`, `indivision`, `proprietaire_public` : facultatifs.
 * - `nominatif` : JSON libre, facultatif. C'est le champ a caractere personnel.
 * - `origine_donnee` : OBLIGATOIRE, texte libre identifiant la demande. Sans elle, impossible
 *   de repondre a un exercice de droit d'acces ni de justifier la detention.
 * - `purge_prevue_le` : OBLIGATOIRE, date ISO. Une donnee personnelle conservee sans limite de
 *   duree est conservee illicitement.
 */

import { readFileSync } from 'node:fs';
import { pool, requete } from '../bdd.js';
import { journal } from '../journal.js';

interface LigneVersement {
  idu: string;
  nbComptes: number | null;
  indivision: boolean | null;
  proprietairePublic: boolean | null;
  nominatif: unknown;
  origineDonnee: string;
  purgePrevueLe: string;
}

/**
 * Decoupe une ligne CSV a separateur point-virgule.
 *
 * Un guillemet n'ouvre un champ echappe que s'il est le PREMIER caractere de ce champ, comme
 * le veut le format. Sans cette condition, un champ JSON non echappe tel que
 * `{"noms":["A","B"]}` — forme que produisent la plupart des tableurs — voyait son premier
 * guillemet interne ouvrir un echappement, et le JSON ressortait sans ses guillemets, donc
 * invalide. Les deux formes sont desormais acceptees : `{"a":1}` brut, et `"{""a"":1}"`
 * echappe selon les regles.
 */
export function decouperLigneCsv(ligne: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let dansGuillemets = false;
  let debutDeChamp = true;

  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i]!;
    if (dansGuillemets) {
      if (c === '"') {
        // Guillemet double a l'interieur d'un champ echappe : un seul guillemet litteral.
        if (ligne[i + 1] === '"') {
          courant += '"';
          i += 1;
        } else {
          dansGuillemets = false;
        }
      } else {
        courant += c;
      }
    } else if (c === '"' && debutDeChamp) {
      dansGuillemets = true;
      debutDeChamp = false;
    } else if (c === ';') {
      champs.push(courant);
      courant = '';
      debutDeChamp = true;
    } else {
      courant += c;
      debutDeChamp = false;
    }
  }
  champs.push(courant);
  return champs;
}

const booleen = (v: string): boolean | null => {
  const t = v.trim().toLowerCase();
  if (t === '') return null;
  if (['oui', 'true', '1', 'o'].includes(t)) return true;
  if (['non', 'false', '0', 'n'].includes(t)) return false;
  throw new Error(`valeur booleenne non comprise : « ${v} » (attendu oui/non)`);
};

/**
 * Analyse le fichier et REFUSE tout en bloc si une ligne est irrecevable.
 *
 * Le tout ou rien est delibere : un versement partiel de donnees personnelles laisserait la
 * base dans un etat que personne n'a decrit, et l'operateur ne saurait pas ce qui a ete
 * enregistre. Mieux vaut corriger le fichier et recommencer.
 */
export function analyser(contenu: string): LigneVersement[] {
  const lignes = contenu
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lignes.length < 2) throw new Error('fichier vide ou reduit a ses en-tetes');

  const entetes = decouperLigneCsv(lignes[0]!).map((e) => e.trim().toLowerCase());
  const requis = ['idu', 'origine_donnee', 'purge_prevue_le'];
  for (const r of requis) {
    if (!entetes.includes(r)) throw new Error(`colonne obligatoire absente : ${r}`);
  }
  const index = (nom: string): number => entetes.indexOf(nom);

  const out: LigneVersement[] = [];
  const vues = new Set<string>();

  for (let n = 1; n < lignes.length; n += 1) {
    const champs = decouperLigneCsv(lignes[n]!);
    const lire = (nom: string): string => {
      const i = index(nom);
      return i === -1 ? '' : (champs[i] ?? '').trim();
    };
    const situe = (msg: string): Error => new Error(`ligne ${n + 1} : ${msg}`);

    const idu = lire('idu');
    if (idu.length !== 14) throw situe(`IDU invalide « ${idu} » (14 caracteres attendus)`);
    if (vues.has(idu)) throw situe(`IDU en doublon dans le fichier : ${idu}`);
    vues.add(idu);

    const origine = lire('origine_donnee');
    if (origine === '') {
      throw situe(
        "origine_donnee est obligatoire : sans provenance documentee, la detention d'une donnee " +
          "personnelle n'est pas justifiable et un droit d'acces est impossible a honorer",
      );
    }

    const purge = lire('purge_prevue_le');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purge)) {
      throw situe(
        `purge_prevue_le est obligatoire au format AAAA-MM-JJ (recu « ${purge} ») : une donnee ` +
          'personnelle conservee sans echeance est conservee illicitement',
      );
    }
    if (Number.isNaN(Date.parse(purge))) throw situe(`date de purge invalide : ${purge}`);

    const brutNb = lire('nb_comptes');
    const nbComptes = brutNb === '' ? null : Number(brutNb);
    if (nbComptes != null && !Number.isInteger(nbComptes)) {
      throw situe(`nb_comptes doit etre entier (recu « ${brutNb} »)`);
    }

    const brutNominatif = lire('nominatif');
    let nominatif: unknown = null;
    if (brutNominatif !== '') {
      try {
        nominatif = JSON.parse(brutNominatif);
      } catch {
        throw situe('nominatif doit etre du JSON valide');
      }
    }

    try {
      out.push({
        idu,
        nbComptes,
        indivision: booleen(lire('indivision')),
        proprietairePublic: booleen(lire('proprietaire_public')),
        nominatif,
        origineDonnee: origine,
        purgePrevueLe: purge,
      });
    } catch (err) {
      throw situe((err as Error).message);
    }
  }

  return out;
}

async function principal(): Promise<void> {
  const chemin = process.argv[2];
  if (!chemin) {
    journal.error(
      'Usage : npm run verser:proprietaires --workspace @enr/api -- fichier.csv\n' +
        'Format documente en tete de src/scripts/verser-proprietaires.ts',
    );
    process.exit(2);
  }

  const lignes = analyser(readFileSync(chemin, 'utf8'));

  // Les IDU absents de la table parcelle arretent le versement AVANT toute ecriture : la cle
  // etrangere echouerait de toute facon, mais au milieu du lot, laissant une partie des
  // donnees personnelles versee et l'autre non. Mieux vaut le dire d'emblee, avec la liste.
  const inconnus = await requete<{ idu: string }>(
    `SELECT v.idu FROM unnest($1::text[]) AS v(idu)
      WHERE NOT EXISTS (SELECT 1 FROM parcelle p WHERE p.idu = v.idu)`,
    [lignes.map((l) => l.idu)],
  );
  if (inconnus.length > 0) {
    journal.error(
      { idus: inconnus.map((i) => i.idu) },
      `${inconnus.length} IDU absent(s) de la table parcelle : qualifiez d'abord ces parcelles, ` +
        'sinon le versement echouerait sur la cle etrangere',
    );
    process.exit(1);
  }

  let verses = 0;
  for (const l of lignes) {
    await requete(
      `INSERT INTO proprietaire_parcelle
         (idu, nb_comptes, indivision, proprietaire_public, nominatif, origine_donnee,
          purge_prevue_le, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, now())
       ON CONFLICT (idu) DO UPDATE SET
         nb_comptes = EXCLUDED.nb_comptes,
         indivision = EXCLUDED.indivision,
         proprietaire_public = EXCLUDED.proprietaire_public,
         nominatif = EXCLUDED.nominatif,
         origine_donnee = EXCLUDED.origine_donnee,
         purge_prevue_le = EXCLUDED.purge_prevue_le,
         updated_at = now()`,
      [
        l.idu,
        l.nbComptes,
        l.indivision,
        l.proprietairePublic,
        l.nominatif == null ? null : JSON.stringify(l.nominatif),
        l.origineDonnee,
        l.purgePrevueLe,
      ],
    );
    verses += 1;
  }

  journal.info(
    { verses, fichier: chemin },
    `${verses} enregistrement(s) de propriete verse(s). Les consultations sont desormais ` +
      'possibles pour les utilisateurs habilites, avec motif obligatoire et journalisation.',
  );
  await pool.end();
}

// Le module est aussi importe par les tests : on ne lance le versement que s'il est le point
// d'entree du processus.
if (process.argv[1]?.includes('verser-proprietaires')) {
  principal().catch((err: unknown) => {
    journal.error({ err }, `Versement refuse : ${(err as Error).message}`);
    process.exit(1);
  });
}
