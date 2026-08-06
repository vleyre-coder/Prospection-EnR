/**
 * Une ingestion ne doit pas etre jetee pour un 503 transitoire.
 *
 * POURQUOI CE FICHIER EXISTE. Le client HTTP reessayait trois fois, avec 400 ms puis 800 ms d'attente :
 * **1,2 seconde en tout**. C'est le bon ordre de grandeur pour une coupure reseau, et beaucoup trop
 * court pour un 503 — un service qui repond 503 signale une surcharge, et demande d'attendre.
 *
 * Constate deux fois a l'execution reelle, et c'est ce qui a impose la correction :
 *   - l'ingestion des ZAER (1,09 million d'objets) a recu quatre 503 d'affilee et a abandonne au bout
 *     de seize secondes, apres zero objet ;
 *   - l'ingestion des communes a abandonne apres 1,2 seconde, egalement apres zero objet.
 *
 * MAIS ALLONGER L'ATTENTE PARTOUT SERAIT UNE FAUTE SYMETRIQUE, et c'est le point que ces tests
 * verrouillent. Les quatorze connecteurs interroges pendant la qualification d'une parcelle doivent
 * echouer VITE : le critere passe au gris, la qualification continue, l'echec est remonte. Bloquer
 * trois minutes sur une parcelle parmi plusieurs centaines rendrait une campagne interminable pour
 * rien. D'ou deux profils, et deux tests qui interdisent de les confondre.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTES_PAR_PROFIL } from '../src/http.js';

test('le profil reactif reste court : un appel par parcelle ne doit pas bloquer', () => {
  const total = ATTENTES_PAR_PROFIL.reactif.reduce((a, b) => a + b, 0);
  assert.ok(
    total <= 10_000,
    `le profil reactif cumule ${total} ms : un critere doit passer au gris vite, pas bloquer la ` +
      "qualification d'une parcelle parmi plusieurs centaines.",
  );
  assert.ok(ATTENTES_PAR_PROFIL.reactif[0]! <= 1_000, 'la premiere reprise doit etre immediate');
});

test('le profil patient attend assez pour survivre a une surcharge de service', () => {
  const total = ATTENTES_PAR_PROFIL.patient.reduce((a, b) => a + b, 0);
  assert.ok(
    total >= 120_000,
    `le profil patient cumule ${total} ms. Sept secondes ne sont pas une attente face a un 503 : ` +
      'une ingestion de plusieurs minutes ne doit pas etre jetee pour une surcharge passagere.',
  );
  // Croissant : une attente qui ne croit pas insiste au pire moment, quand le service est le plus charge.
  const p = ATTENTES_PAR_PROFIL.patient;
  for (let i = 1; i < p.length; i += 1) {
    assert.ok(p[i]! > p[i - 1]!, `les paliers patients doivent croitre (palier ${i})`);
  }
});

test('le profil patient est nettement plus long que le reactif, et ce n’est pas un hasard', () => {
  const reactif = ATTENTES_PAR_PROFIL.reactif.reduce((a, b) => a + b, 0);
  const patient = ATTENTES_PAR_PROFIL.patient.reduce((a, b) => a + b, 0);
  assert.ok(
    patient > reactif * 10,
    'les deux profils doivent differer d’un ordre de grandeur, sinon la distinction ne sert a rien ' +
      'et l’un des deux usages est mal servi.',
  );
});

test('toutes les ingestions utilisent le profil patient', async () => {
  /**
   * LE CONTROLE STRUCTUREL, et il est necessaire.
   *
   * Le defaut d'origine n'etait pas une mauvaise valeur : c'etait un job d'ingestion qui utilisait la
   * politique de reprise des appels par parcelle, sans que rien ne le signale. Verifier les valeurs ne
   * suffit donc pas — il faut verifier que chaque appel d'ingestion DEMANDE le bon profil.
   *
   * Le controle porte sur la source parce que c'est la seule facon de le tenir : declencher un 503
   * reel depuis un test demanderait un service factice, et une ingestion nationale ne se rejoue pas
   * dans une suite de tests.
   */
  const { readFileSync, readdirSync } = await import('node:fs');
  const base = new URL('../src/ingestion/', import.meta.url);
  const manquants: string[] = [];

  for (const fichier of readdirSync(base)) {
    if (!fichier.endsWith('.ts')) continue;
    const source = readFileSync(new URL(fichier, base), 'utf8')
      // Les commentaires citent `jsonExterne` et `profilAttente` : les retirer evite qu'une
      // explication ne fasse passer le controle.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

    /**
     * Chaque appel `jsonExterne`, examine sur une FENETRE apres son nom.
     *
     * Premiere ecriture : un motif qui capturait « jusqu'au premier bloc entre accolades ». Il
     * s'arretait sur le PARAMETRE DE TYPE generique — `jsonExterne<{ last_update?: string }>` — et ne
     * voyait donc jamais l'objet d'options. Les deux appels deja corriges etaient signales manquants.
     *
     * Une fenetre de caracteres est grossiere mais juste : l'objet d'options d'un appel `jsonExterne`
     * du depot tient toujours dans les 700 caracteres qui suivent, et le nom `profilAttente`
     * n'apparait nulle part ailleurs qu'a cet endroit.
     */
    // `jsonExterne<` ou `jsonExterne(` : les APPELS, et non la ligne d'import, que la premiere
    // version signalait — le nom y figure aussi.
    for (const m of source.matchAll(/jsonExterne\s*[<(]/g)) {
      const fenetre = source.slice(m.index!, m.index! + 700);
      // On s'arrete au prochain appel `jsonExterne` pour ne pas lire les options du suivant.
      const suivant = fenetre.search(/jsonExterne\s*[<(]/);
      void suivant;
      const apres = fenetre.slice(1).search(/jsonExterne\s*[<(]/);
      const portee = apres >= 0 ? fenetre.slice(0, apres + 1) : fenetre;
      if (!/profilAttente/.test(portee)) {
        manquants.push(`${fichier} : ${portee.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    manquants.sort(),
    [],
    'ces appels d’ingestion utilisent la politique de reprise des appels par parcelle (1,2 seconde). ' +
      'Un 503 transitoire ferait donc abandonner toute l’ingestion. Ajoutez ' +
      "`profilAttente: 'patient'`.",
  );
});

test('les appels par PARCELLE n’utilisent pas le profil patient', async () => {
  /**
   * Le contrôle inverse, et il compte autant.
   *
   * Un connecteur de qualification qui attendrait trois minutes sur un 503 bloquerait la campagne
   * entière : à 1 000 parcelles et un seul service en surcharge, cela ferait cinquante heures d'attente
   * pour des critères qui doivent simplement passer au gris.
   */
  // Import dynamique et non `require` : ce fichier est un module ESM, ou `require` n'existe pas.
  const { readFileSync, readdirSync } = await import('node:fs');
  const base = new URL('../src/connecteurs/', import.meta.url);
  const patients: string[] = [];

  for (const fichier of readdirSync(base)) {
    if (!fichier.endsWith('.ts')) continue;
    const source = readFileSync(new URL(fichier, base), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    if (/profilAttente:\s*'patient'/.test(source)) patients.push(fichier);
  }

  assert.deepEqual(
    patients.sort(),
    [],
    'ces connecteurs de qualification demandent le profil patient. Un 503 y ferait attendre trois ' +
      'minutes par parcelle, alors que le comportement voulu est un critere gris et une campagne qui ' +
      'continue.',
  );
});
