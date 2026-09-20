/** Depot du referentiel des sources : fraicheur, couverture, journal d'ingestion. */

import { requete, requeteUne } from '../bdd.js';
import { journal } from '../journal.js';
import { CONNECTEURS } from '../connecteurs/base.js';

export interface EtatSource {
  connecteur: string;
  nom: string;
  modeAcces: string;
  millesime: string | null;
  dateDerniereIngestion: string | null;
  periodiciteJours: number | null;
  couverture: string;
  dernierStatut: string | null;
  dernierMessage: string | null;
  nbEnregistrements: number | null;
  perimee: boolean;
  ageJours: number | null;
  valeurJuridique: string;
  avertissement: string | null;
}

/** Enregistre en base les connecteurs declares dans le code (idempotent). */
export async function synchroniserReferentiel(): Promise<number> {
  for (const c of Object.values(CONNECTEURS)) {
    await requete(
      `INSERT INTO source_donnee
         (connecteur, nom, url, mode_acces, periodicite_jours, valeur_juridique, couverture,
          avertissement, millesime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (connecteur) DO UPDATE SET
         nom = EXCLUDED.nom,
         url = EXCLUDED.url,
         mode_acces = EXCLUDED.mode_acces,
         periodicite_jours = EXCLUDED.periodicite_jours,
         valeur_juridique = EXCLUDED.valeur_juridique,
         couverture = EXCLUDED.couverture,
         avertissement = EXCLUDED.avertissement`,
      [
        c.connecteur,
        c.nom,
        c.url,
        c.modeAcces,
        c.periodiciteJours,
        c.valeurJuridique,
        c.couverture,
        c.avertissement ?? null,
        c.millesime ?? null,
      ],
    );
  }
  return Object.keys(CONNECTEURS).length;
}

export async function etatSources(): Promise<EtatSource[]> {
  const lignes = await requete<{
    connecteur: string;
    nom: string;
    mode_acces: string;
    millesime: string | null;
    date_derniere_ingestion: Date | null;
    periodicite_jours: number | null;
    couverture: string;
    dernier_statut: string | null;
    perimee: boolean;
    age_jours: number | null;
  }>(`SELECT * FROM v_source_fraicheur ORDER BY connecteur`);

  return lignes.map((l) => {
    const decl = CONNECTEURS[l.connecteur];
    return {
      connecteur: l.connecteur,
      nom: l.nom,
      modeAcces: l.mode_acces,
      millesime: l.millesime,
      dateDerniereIngestion: l.date_derniere_ingestion?.toISOString() ?? null,
      periodiciteJours: l.periodicite_jours,
      couverture: l.couverture,
      dernierStatut: l.dernier_statut,
      dernierMessage: null,
      nbEnregistrements: null,
      perimee: l.perimee,
      ageJours: l.age_jours,
      valeurJuridique: decl?.valeurJuridique ?? 'indicative',
      avertissement: decl?.avertissement ?? null,
    };
  });
}

export async function enregistrerIngestion(
  connecteur: string,
  statut: 'ok' | 'echec' | 'partiel',
  message: string | null,
  nbEnregistrements: number | null,
  millesime?: string | null,
): Promise<void> {
  await requete(
    `UPDATE source_donnee SET
       date_derniere_ingestion = CASE WHEN $2 = 'echec' THEN date_derniere_ingestion ELSE now() END,
       dernier_statut = $2,
       dernier_message = $3,
       nb_enregistrements = COALESCE($4, nb_enregistrements),
       millesime = COALESCE($5, millesime)
     WHERE connecteur = $1`,
    [connecteur, statut, message, nbEnregistrements, millesime ?? null],
  );
}

export async function enregistrerCouverture(
  connecteur: string,
  type: string,
  codeDepartement: string,
  nbObjets: number,
  sourceDocument?: string | null,
): Promise<void> {
  await requete(
    `INSERT INTO couverture_ingestion (connecteur, type, code_departement, nb_objets, source_document)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (connecteur, type, code_departement) DO UPDATE SET
       nb_objets = EXCLUDED.nb_objets,
       source_document = EXCLUDED.source_document,
       date_ingestion = now()`,
    [connecteur, type, codeDepartement, nbObjets, sourceDocument ?? null],
  );
}

export async function sourcesPerimees(): Promise<string[]> {
  const lignes = await requete<{ connecteur: string }>(
    `SELECT connecteur FROM v_source_fraicheur WHERE perimee = true`,
  );
  return lignes.map((l) => l.connecteur);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UNE COUVERTURE ANNONCEE DOIT AVOIR DES DONNEES DERRIERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI A ETE MESURE, audit 13, sur la base de bout en bout : `couverture_ingestion` annoncait
 * **2 830 postes sources sur 101 departements**, dont le 28 ou vivent les 301 parcelles. La table
 * `poste_source`, elle, etait **vide**. La table qui dit « cette couche a ete regardee ici » ment
 * donc sur ce que la base contient, et rien ne le detectait.
 *
 * POURQUOI C'EST LE DEFAUT LE PLUS GRAVE POSSIBLE ICI, et non une incoherence de comptage.
 * `couverture_ingestion` est precisement ce sur quoi le moteur s'appuie pour distinguer les deux
 * phrases que ce projet separe depuis douze audits : « aucune contrainte trouvee » et « on n'a rien
 * regarde ». `couchesPresentesDansDepartement()` la lit pour le patrimoine, `zones.ts` et
 * `potentiel-communal.ts` la lisent aussi. Une ligne de couverture survivant a la disparition de ses
 * donnees fait donc dire a l'application « regarde, rien trouve » — un feu vert — la ou il n'y a
 * rien du tout. C'est mot pour mot le defaut C1 de l'audit 8, reouvert par une autre porte.
 *
 * CE QUI A SAUVE LE CAS MESURE, et pourquoi cela ne suffit pas : le critere `racc_distance_poste`
 * ne consulte pas la couverture, il repond `indispo` des qu'aucun poste n'est trouve. La protection
 * tient donc a ce qu'un critere n'ait pas ete ecrit autrement — c'est-a-dire a rien. Le patrimoine,
 * lui, consulte bien la couverture : la meme incoherence sur `contrainte` produirait le feu vert.
 *
 * CE QUE CETTE FONCTION NE FAIT PAS. Elle ne compare pas les COMPTES, ni departement par
 * departement : un ecart de comptage a mille raisons legitimes — une reingestion partielle, un
 * objet ecarte parce que hors filiere, une geometrie refusee. Elle ne signale que le cas sans
 * ambiguite possible : **la couverture annonce des objets, et la cible est entierement vide**.
 * Un garde qui accuse a tort finit desactive ; celui-ci ne peut pas accuser a tort.
 */
export interface CouvertureIncoherente {
  connecteur: string;
  type: string;
  /** Objets annonces par la couverture, tous departements confondus. */
  objetsAnnonces: number;
  /** Nombre de departements pour lesquels la couverture affirme avoir regarde. */
  departements: number;
}

/**
 * Ou vivent les donnees d'un `type` de couverture.
 *
 * `couverture_ingestion.type` n'est pas uniformement un nom de table : pour les couches qui ont la
 * leur il l'est, pour les autres c'est la valeur de `contrainte.type`. La table est donc explicite,
 * et toute couche absente d'ici est supposee vivre dans `contrainte` — le cas general.
 */
const CIBLE_PAR_TYPE: Record<string, string> = {
  zaer: 'zaer',
  poste_source: 'poste_source',
  point_injection_gaz: 'point_injection_gaz',
};

export async function couverturesIncoherentes(): Promise<CouvertureIncoherente[]> {
  const annoncees = await requete<{
    connecteur: string;
    type: string;
    objets: string;
    departements: string;
  }>(
    `SELECT connecteur, type, SUM(nb_objets)::text AS objets, COUNT(*)::text AS departements
       FROM couverture_ingestion
      GROUP BY connecteur, type
     HAVING SUM(nb_objets) > 0`,
  );

  const incoherentes: CouvertureIncoherente[] = [];
  for (const a of annoncees) {
    const table = CIBLE_PAR_TYPE[a.type];
    /*
     * `EXISTS` et non `COUNT` : la question est « y a-t-il quoi que ce soit ? ». Sur une table de
     * plusieurs millions de lignes, un comptage complet pour repondre « oui » serait un balayage
     * inutile a chaque affichage du bandeau.
     */
    const [presence] = table
      ? // Le nom de table vient de `CIBLE_PAR_TYPE`, une constante du module : jamais de la requete.
        await requete<{ existe: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${table}) AS existe`)
      : await requete<{ existe: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM contrainte WHERE type = $1) AS existe`,
          [a.type],
        );
    if (presence?.existe === false) {
      incoherentes.push({
        connecteur: a.connecteur,
        type: a.type,
        objetsAnnonces: Number(a.objets),
        departements: Number(a.departements),
      });
    }
  }
  return incoherentes;
}

export interface DetailsJournal {
  utilisateurId?: string | null;
  email?: string | null;
  cible?: string | null;
  motif?: string | null;
  adresseIp?: string | null;
  userAgent?: string | null;
  details?: unknown;
}

/**
 * Ecrit une entree au journal d'acces.
 *
 * L'identifiant d'utilisateur est resolu par sous-requete : un identifiant inconnu de la
 * table `utilisateur` (compte supprime, ou utilisateur fictif du mode developpement) est
 * enregistre a NULL au lieu de violer la contrainte de cle etrangere. L'adresse de courriel
 * reste conservee, ce qui suffit a l'imputabilite.
 */
async function ecrireJournal(action: string, d: DetailsJournal): Promise<void> {
  await requete(
    `INSERT INTO journal_acces
       (utilisateur_id, email, action, cible, motif, adresse_ip, user_agent, details)
     VALUES ((SELECT id FROM utilisateur WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)`,
    [
      details0(d.utilisateurId),
      d.email ?? null,
      action,
      d.cible ?? null,
      d.motif ?? null,
      d.adresseIp ?? null,
      d.userAgent ?? null,
      d.details ? JSON.stringify(d.details) : null,
    ],
  );
}

/** Un identifiant non conforme au format UUID ferait echouer la sous-requete. */
function details0(id: string | null | undefined): string | null {
  if (!id) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/**
 * Journalisation courante (export, modification, connexion).
 *
 * Un echec de journalisation ne doit pas faire echouer l'action metier de l'utilisateur :
 * il est trace comme erreur applicative et remonte a la supervision.
 */
export async function journaliser(action: string, details: DetailsJournal = {}): Promise<void> {
  try {
    await ecrireJournal(action, details);
  } catch (err) {
    journal.error({ err, action, cible: details.cible }, "Échec d'écriture au journal d'accès");
  }
}

/**
 * Journalisation stricte, reservee aux consultations de donnees a caractere personnel.
 *
 * Ici, la journalisation EST la garantie de conformite : si elle echoue, l'acces doit etre
 * refuse. La fonction propage donc l'erreur a l'appelant.
 */
export async function journaliserStrict(action: string, details: DetailsJournal = {}): Promise<void> {
  await ecrireJournal(action, details);
}

export async function lireJournal(limite = 200): Promise<unknown[]> {
  return requete(
    `SELECT id, date, email, action, cible, motif, adresse_ip, details
       FROM journal_acces ORDER BY date DESC, id DESC LIMIT $1`,
    [limite],
  );
}

export async function compterContraintes(): Promise<Record<string, number>> {
  const lignes = await requete<{ type: string; n: number }>(
    `SELECT type, count(*)::int AS n FROM contrainte GROUP BY type ORDER BY type`,
  );
  return Object.fromEntries(lignes.map((l) => [l.type, l.n]));
}

export async function compterPostes(): Promise<{ total: number; parEtat: Record<string, number> }> {
  const total = await requeteUne<{ n: number }>(`SELECT count(*)::int AS n FROM poste_source`);
  const lignes = await requete<{ etat_saturation: string | null; n: number }>(
    `SELECT etat_saturation, count(*)::int AS n FROM poste_source GROUP BY etat_saturation`,
  );
  return {
    total: total?.n ?? 0,
    parEtat: Object.fromEntries(lignes.map((l) => [l.etat_saturation ?? 'inconnu', l.n])),
  };
}
