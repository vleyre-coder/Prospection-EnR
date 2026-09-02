/**
 * L'amorce nationale : ce que l'archive distribuee embarque, et surtout ce qu'elle n'embarque pas.
 *
 * POURQUOI CE FICHIER EST LE PLUS SERIEUX DE CE CHANTIER. L'amorce part vers quiconque recoit
 * l'archive. Une table de trop, et ce sont des donnees nominatives de proprietaires — ou le
 * secret de signature des jetons — diffusees en autant de copies que de telechargements. Il
 * n'existe pas de rattrapage : un fichier distribue ne se reprend pas.
 *
 * TROIS PROPRIETES, ET AUCUNE NE TIENT SANS TEST :
 *
 *   1. **Toute table du schema est classee explicitement.** C'est la propriete qui protege
 *      l'AVENIR. Une table ajoutee par une migration future n'a aucune raison d'etre devinee
 *      correctement par une liste ecrite aujourd'hui — mais elle a toutes les chances de
 *      passer inapercue. Le test lit `db/migrations/` et exige une decision.
 *   2. **Les tables sensibles sont ecartees, nommement.** `proprietaire_parcelle`,
 *      `utilisateur`, `journal_acces`, et `parametre` — dont le commentaire de schema dit
 *      litteralement « Ne jamais exposer », parce qu'elle porte le secret de signature.
 *   3. **Aucune entree fantome.** Une ligne des listes qui ne correspond a aucune table reelle
 *      est un piege : elle donne l'illusion qu'un cas est traite. Si `proprietaire_parcelle`
 *      etait renommee demain, l'entree resterait dans la liste des ecartees, le test
 *      d'exclusion continuerait de passer, et la table renommee tomberait dans les non
 *      classees — d'ou l'utilite d'exiger les deux sens.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLES_ECARTEES,
  TABLES_EMBARQUEES,
  classer,
  tablesDuSchema,
  verifierAmorce,
} from '../../../scripts/portable/amorce.mjs';

const SCHEMA: string[] = tablesDuSchema();

test('le schema est bien lu depuis les migrations', () => {
  // Temoin : si la lecture renvoyait une liste vide, tous les tests suivants passeraient
  // pour de mauvaises raisons.
  assert.ok(SCHEMA.length >= 20, `seulement ${SCHEMA.length} table(s) lues dans db/migrations`);
  for (const attendue of ['commune', 'poste_source', 'proprietaire_parcelle', 'parametre']) {
    assert.ok(SCHEMA.includes(attendue), `${attendue} devrait figurer au schema`);
  }
});

test('AUCUNE table du schema n’est laissee sans decision', () => {
  const { nonClassees } = classer(SCHEMA) as { nonClassees: string[] };
  assert.deepEqual(
    nonClassees,
    [],
    'Ces tables ne sont ni embarquees ni ecartees. Trancher est obligatoire : ne pas le faire, ' +
      "c'est laisser le hasard decider si des donnees partent dans une archive distribuee.",
  );
});

test('une table INCONNUE tombe dans les non classees, jamais dans les embarquees', () => {
  /**
   * LE TROU QUE LA VERIFICATION PAR MUTATION A TROUVE. Le test precedent passe la liste
   * REELLE du schema, ou tout est deja classe : la branche « table inconnue » ne s'executait
   * donc jamais, et muter `nonClassees.push` en `embarquees.push` ne faisait echouer personne.
   * Autrement dit, la propriete qui protege l'AVENIR — une migration future qui ajoute une
   * table — n'etait pas testee du tout, alors que c'est la seule raison d'etre du classement.
   *
   * Il faut donc une table qui n'existe pas au schema. C'est le cas d'usage reel : demain,
   * quelqu'un ajoute `contact_proprietaire` et ne pense pas a l'amorce.
   */
  const r = classer(['commune', 'table_ajoutee_demain', 'proprietaire_parcelle']) as {
    embarquees: string[];
    ecartees: string[];
    nonClassees: string[];
  };
  assert.deepEqual(r.nonClassees, ['table_ajoutee_demain']);
  assert.deepEqual(r.embarquees, ['commune'], 'une inconnue ne doit JAMAIS etre embarquee');
  assert.deepEqual(r.ecartees, ['proprietaire_parcelle']);
});

test('les tables sensibles sont ecartees, nommement', () => {
  const sensibles = [
    ['proprietaire_parcelle', 'donnees nominatives de proprietaires'],
    ['utilisateur', 'comptes et empreintes de mots de passe'],
    ['journal_acces', 'journal des consultations, donnee RGPD'],
    ['parametre', 'secret de signature des jetons'],
    ['lead', 'pipeline commercial'],
    ['lead_evenement', 'historique du pipeline commercial'],
  ] as const;
  for (const [table, pourquoi] of sensibles) {
    assert.ok(
      Object.hasOwn(TABLES_ECARTEES as object, table),
      `${table} doit etre ecartee de l'amorce (${pourquoi})`,
    );
    assert.ok(
      !Object.hasOwn(TABLES_EMBARQUEES as object, table),
      `${table} ne doit surtout pas etre embarquee`,
    );
  }
});

test('aucune entree fantome dans les deux listes', () => {
  /**
   * Une entree qui ne correspond a aucune table reelle donne l'illusion qu'un cas est traite.
   * Le scenario a craindre est un RENOMMAGE : `proprietaire_parcelle` deviendrait
   * `proprietaire`, l'ancienne entree resterait dans les ecartees — le test d'exclusion
   * passerait toujours — et la nouvelle table tomberait dans les non classees. Exiger les
   * deux sens ferme ce trou.
   */
  const fantomes = [...Object.keys(TABLES_EMBARQUEES), ...Object.keys(TABLES_ECARTEES)].filter(
    (t) => !SCHEMA.includes(t),
  );
  assert.deepEqual(fantomes, [], 'ces entrees ne correspondent a aucune table du schema');
});

test('chaque table classee porte un motif lisible', () => {
  // Un classement sans motif se retourne au premier doute, faute de savoir pourquoi il a ete
  // fait. C'est particulierement vrai des exclusions : ce sont celles qu'on est tente de lever.
  for (const [table, motif] of Object.entries({ ...TABLES_EMBARQUEES, ...TABLES_ECARTEES })) {
    assert.ok(
      typeof motif === 'string' && motif.length > 20,
      `motif trop court pour ${table} : « ${motif} »`,
    );
  }
});

test('l’amorce embarque bien les donnees de reference attendues', () => {
  /**
   * L'autre moitie du contrat. Une amorce qui n'excluerait rien serait dangereuse ; une
   * amorce qui n'inclurait rien serait inutile, et le premier lancement retelechargerait tout
   * — exactement ce qu'elle doit eviter.
   */
  for (const attendue of ['commune', 'poste_source', 'contrainte', 'couverture_ingestion']) {
    assert.ok(
      Object.hasOwn(TABLES_EMBARQUEES as object, attendue),
      `${attendue} est une donnee publique de reference : elle doit etre embarquee`,
    );
  }
});

test('le controle du fichier produit REFUSE un dump qui contient une table ecartee', async () => {
  /**
   * LA CEINTURE, EN PLUS DES BRETELLES, et elle n'est pas superflue. Le classement decide de
   * la commande `pg_dump` ; ce controle-ci porte sur le FICHIER REELLEMENT PRODUIT. Les deux
   * peuvent divergent : `pg_dump --table` accepte des MOTIFS, une faute de frappe elargit la
   * selection sans rien signaler, et une dependance de schema peut entrainer une table
   * voisine. Le seul controle qui vaille est celui qui relit ce qu'on s'apprete a distribuer.
   *
   * Le test fabrique un dump fautif — commune (legitime) plus utilisateur et parametre — et
   * exige que les deux intrus soient nommes.
   */
  const { gzipSync } = await import('node:zlib');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joindre } = await import('node:path');

  const dump = [
    'COPY public.commune (code_insee, nom) FROM stdin;',
    '28001\tAbondant',
    '\\.',
    'COPY public.utilisateur (email, mot_de_passe_hash) FROM stdin;',
    'victor@exemple.fr\tHASH-PRIVE',
    '\\.',
    'COPY parametre (cle, valeur) FROM stdin;',
    'secret_jwt\tSECRET-QUI-NE-DOIT-JAMAIS-SORTIR',
    '\\.',
    '',
  ].join('\n');

  const dossier = mkdtempSync(joindre(tmpdir(), 'amorce-'));
  const chemin = joindre(dossier, 'essai.sql.gz');
  writeFileSync(chemin, gzipSync(Buffer.from(dump, 'utf8')));

  const r = (await verifierAmorce(chemin)) as {
    tablesTrouvees: string[];
    fautes: string[];
  };
  assert.deepEqual(r.tablesTrouvees, ['commune', 'parametre', 'utilisateur']);
  assert.deepEqual(
    r.fautes.sort(),
    ['parametre', 'utilisateur'],
    'les deux intrus doivent etre nommes, pas seulement comptes',
  );

  // `COPY parametre` sans prefixe `public.` doit etre reconnu aussi : pg_dump ecrit l'une ou
  // l'autre forme selon ses options, et un controle qui n'en verrait qu'une serait aveugle
  // la moitie du temps.
  assert.ok(r.fautes.includes('parametre'), 'la forme sans prefixe de schema doit etre vue');
});

test('un dump propre passe le controle', async () => {
  // Le temoin. Sans lui, le test precedent reussirait aussi avec un controle qui refuse tout.
  const { gzipSync } = await import('node:zlib');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joindre } = await import('node:path');

  const dump = 'COPY public.commune (code_insee) FROM stdin;\n28001\n\\.\n';
  const dossier = mkdtempSync(joindre(tmpdir(), 'amorce-ok-'));
  const chemin = joindre(dossier, 'essai.sql.gz');
  writeFileSync(chemin, gzipSync(Buffer.from(dump, 'utf8')));

  const r = (await verifierAmorce(chemin)) as { fautes: string[]; tablesTrouvees: string[] };
  assert.deepEqual(r.fautes, []);
  assert.deepEqual(r.tablesTrouvees, ['commune']);
});
