/**
 * Depot des profils de recherche et de leurs seuils developpeur.
 *
 * Un profil enregistre le cahier des charges d'un developpeur pour qu'il soit rejouable. Voir
 * `db/migrations/018_profils_recherche.sql` pour ce que la base porte et ce qu'elle refuse de
 * porter — le seuil REGLEMENTAIRE n'y est pas, et ne doit pas y etre.
 */

import type { FiliereReferentiel, SensSeuil } from '@enr/core';
import { requete, requeteUne, transaction } from '../bdd.js';

export interface SeuilDeveloppeurEnBase {
  contrainteId: string;
  valeur: number;
  unite: string;
  sens: SensSeuil | null;
  motif: string;
  majPar: string | null;
  majLe: string;
}

export interface ProfilRecherche {
  id: string;
  nom: string;
  filiere: FiliereReferentiel;
  developpeur: string | null;
  criteres: Record<string, unknown>;
  notes: string | null;
  creePar: string | null;
  creeLe: string;
  majLe: string;
  seuils: SeuilDeveloppeurEnBase[];
}

/** Le profil sans ses seuils : ce que la liste affiche, plus le compte. */
export interface ProfilResume {
  id: string;
  nom: string;
  filiere: FiliereReferentiel;
  developpeur: string | null;
  notes: string | null;
  creePar: string | null;
  creeLe: string;
  majLe: string;
  nbSeuils: number;
}

interface LigneProfil {
  id: string;
  nom: string;
  filiere: FiliereReferentiel;
  developpeur: string | null;
  criteres: Record<string, unknown>;
  notes: string | null;
  cree_par: string | null;
  cree_le: Date;
  maj_le: Date;
}

interface LigneSeuil {
  contrainte_id: string;
  valeur: string;
  unite: string;
  sens: SensSeuil | null;
  motif: string;
  maj_par: string | null;
  maj_le: Date;
}

/**
 * `valeur` revient en CHAINE, parce que `numeric` n'entre pas dans un double sans perte.
 *
 * Le pilote `pg` a raison de ne pas convertir tout seul. Ici la conversion est sans danger — un
 * seuil est une distance ou une surface, jamais un montant a la unite pres — mais elle doit etre
 * ECRITE, faute de quoi `valeur` serait une chaine partout en aval et les comparaisons
 * `seuil > 400` deviendraient lexicographiques : « 1000 » serait alors plus petit que « 400 ».
 */
function versSeuil(l: LigneSeuil): SeuilDeveloppeurEnBase {
  return {
    contrainteId: l.contrainte_id,
    valeur: Number(l.valeur),
    unite: l.unite,
    sens: l.sens,
    motif: l.motif,
    majPar: l.maj_par,
    majLe: l.maj_le.toISOString(),
  };
}

function versProfil(l: LigneProfil, seuils: SeuilDeveloppeurEnBase[]): ProfilRecherche {
  return {
    id: l.id,
    nom: l.nom,
    filiere: l.filiere,
    developpeur: l.developpeur,
    criteres: l.criteres,
    notes: l.notes,
    creePar: l.cree_par,
    creeLe: l.cree_le.toISOString(),
    majLe: l.maj_le.toISOString(),
    seuils,
  };
}

export async function listerProfils(filiere?: FiliereReferentiel): Promise<ProfilResume[]> {
  const lignes = await requete<LigneProfil & { nb_seuils: number }>(
    `SELECT p.*, (SELECT count(*)::int FROM seuil_developpeur s WHERE s.profil_id = p.id) AS nb_seuils
       FROM profil_recherche p
      WHERE ($1::text IS NULL OR p.filiere = $1)
      -- Departage par l'identifiant : deux profils enregistres dans la meme milliseconde
      -- sortiraient sinon dans un ordre variable, et la pagination sauterait des lignes.
      ORDER BY p.maj_le DESC, p.id DESC`,
    [filiere ?? null],
  );
  return lignes.map((l) => ({
    id: l.id,
    nom: l.nom,
    filiere: l.filiere,
    developpeur: l.developpeur,
    notes: l.notes,
    creePar: l.cree_par,
    creeLe: l.cree_le.toISOString(),
    majLe: l.maj_le.toISOString(),
    nbSeuils: l.nb_seuils,
  }));
}

export async function profilParId(id: string): Promise<ProfilRecherche | null> {
  const profil = await requeteUne<LigneProfil>(`SELECT * FROM profil_recherche WHERE id = $1`, [id]);
  if (!profil) return null;
  const seuils = await requete<LigneSeuil>(
    `SELECT contrainte_id, valeur, unite, sens, motif, maj_par, maj_le
       FROM seuil_developpeur WHERE profil_id = $1 ORDER BY contrainte_id`,
    [id],
  );
  return versProfil(profil, seuils.map(versSeuil));
}

/** Levee quand le nom est deja pris. La route la rend en 409, avec le nom en conflit. */
export class NomDeProfilPris extends Error {
  constructor(readonly nom: string) {
    super(`Un profil nomme « ${nom} » existe deja`);
    this.name = 'NomDeProfilPris';
  }
}

/** Code PostgreSQL d'une violation de contrainte d'unicite. */
const VIOLATION_UNICITE = '23505';

function estViolationUnicite(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === VIOLATION_UNICITE;
}

export interface EcritureProfil {
  nom: string;
  filiere: FiliereReferentiel;
  developpeur: string | null;
  criteres: Record<string, unknown>;
  notes: string | null;
  seuils: readonly {
    contrainteId: string;
    valeur: number;
    unite: string;
    sens: SensSeuil | null;
    motif: string;
  }[];
}

/**
 * Cree un profil et ses seuils, ou rien du tout.
 *
 * TRANSACTION, et ce n'est pas de la precaution de principe : un profil cree avec la moitie de ses
 * seuils est PIRE qu'un echec. L'operateur le rouvrirait, verrait ses criteres, lancerait la
 * recherche — et obtiendrait un resultat plus large que le cahier des charges du developpeur, sans
 * qu'aucun message ne le signale.
 */
export async function creerProfil(
  ecriture: EcritureProfil,
  auteur: string,
): Promise<ProfilRecherche> {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<LigneProfil>(
        `INSERT INTO profil_recherche (nom, filiere, developpeur, criteres, notes, cree_par)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *`,
        [
          ecriture.nom,
          ecriture.filiere,
          ecriture.developpeur,
          JSON.stringify(ecriture.criteres),
          ecriture.notes,
          auteur,
        ],
      );
      const profil = rows[0]!;
      const seuils = await ecrireSeuils(client, profil.id, ecriture.seuils, auteur);
      return versProfil(profil, seuils);
    });
  } catch (err) {
    if (estViolationUnicite(err)) throw new NomDeProfilPris(ecriture.nom);
    throw err;
  }
}

/**
 * Remplace un profil et TOUS ses seuils.
 *
 * REMPLACEMENT INTEGRAL, et non fusion. Une fusion obligerait a inventer une facon de supprimer un
 * seuil — un `null` ? une liste a part ? — et l'interface d'edition envoie de toute facon l'etat
 * complet du formulaire. Surtout, une fusion silencieuse conserverait un seuil que l'operateur
 * vient de retirer de l'ecran : il croirait l'avoir supprime, et la recherche continuerait de
 * l'appliquer.
 */
export async function remplacerProfil(
  id: string,
  ecriture: EcritureProfil,
  auteur: string,
): Promise<ProfilRecherche | null> {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<LigneProfil>(
        `UPDATE profil_recherche
            SET nom = $2, filiere = $3, developpeur = $4, criteres = $5::jsonb, notes = $6,
                maj_le = now()
          WHERE id = $1 RETURNING *`,
        [
          id,
          ecriture.nom,
          ecriture.filiere,
          ecriture.developpeur,
          JSON.stringify(ecriture.criteres),
          ecriture.notes,
        ],
      );
      const profil = rows[0];
      if (!profil) return null;
      await client.query(`DELETE FROM seuil_developpeur WHERE profil_id = $1`, [id]);
      const seuils = await ecrireSeuils(client, id, ecriture.seuils, auteur);
      return versProfil(profil, seuils);
    });
  } catch (err) {
    if (estViolationUnicite(err)) throw new NomDeProfilPris(ecriture.nom);
    throw err;
  }
}

async function ecrireSeuils(
  client: { query: (texte: string, valeurs: unknown[]) => Promise<{ rows: LigneSeuil[] }> },
  profilId: string,
  seuils: EcritureProfil['seuils'],
  auteur: string,
): Promise<SeuilDeveloppeurEnBase[]> {
  const ecrits: SeuilDeveloppeurEnBase[] = [];
  for (const s of seuils) {
    const { rows } = await client.query(
      `INSERT INTO seuil_developpeur (profil_id, contrainte_id, valeur, unite, sens, motif, maj_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING contrainte_id, valeur, unite, sens, motif, maj_par, maj_le`,
      [profilId, s.contrainteId, s.valeur, s.unite, s.sens, s.motif, auteur],
    );
    ecrits.push(versSeuil(rows[0]!));
  }
  return ecrits.sort((a, b) => a.contrainteId.localeCompare(b.contrainteId));
}

export async function supprimerProfil(id: string): Promise<boolean> {
  // Les seuils partent avec, par `ON DELETE CASCADE` : des seuils orphelins survivraient sinon a
  // leur profil sans qu'aucune vue ne les montre.
  const lignes = await requete<{ id: string }>(
    `DELETE FROM profil_recherche WHERE id = $1 RETURNING id`,
    [id],
  );
  return lignes.length > 0;
}
