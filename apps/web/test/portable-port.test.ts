/**
 * LE PORT DE L'APPLICATION DE BUREAU, et le defaut le plus probable de tout ce chantier.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE L'AUDIT 11 A MESURE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Le lanceur servait l'application sur le port 3000, ecrit en dur, et commencait par demander
 * `GET http://127.0.0.1:3000/api/sante`. Si ca repondait 200, il concluait « l'application
 * etait deja ouverte », ouvrait le navigateur et sortait en SUCCES.
 *
 * Or 3000 est l'un des ports les plus disputes d'un poste de travail : Docker, un serveur de
 * developpement, Grafana, n'importe quelle application Electron. Mesure faite en placant sur
 * 3000 un service tiers qui repond 200 a tout — le cas ordinaire :
 *
 *     VERDICT DU LANCEUR : « l'application etait deja ouverte » -> ouvre le navigateur, exit 0
 *     CE QUI REPOND EN REALITE : {"service":"autre-chose"}
 *
 * Autrement dit : l'utilisateur double-clique, une page qui n'est pas la sienne s'ouvre, et
 * l'application ne demarre JAMAIS. Aucun message, aucune trace dans le journal, code de sortie
 * 0 — le pire cas possible pour quelqu'un qui n'a pas les moyens de diagnostiquer.
 *
 * DEUX FAUTES DISTINCTES, et il fallait corriger les deux :
 *
 *   1. la sonde acceptait n'importe quel 200. Reconnaitre son propre serveur demande de lire la
 *      REPONSE, d'ou `estNotreApplication()` ;
 *   2. le port etait fige. Meme en reconnaissant l'intrus, l'application n'aurait pas pu
 *      demarrer. Le port est donc CHOISI, comme cela se faisait deja pour PostgreSQL, et note
 *      dans `donnees/port.txt` — sans quoi le second double-clic ne saurait plus ou trouver la
 *      fenetre a ramener.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PORT_APPLICATION_DEPART,
  enregistrerPort,
  estNotreApplication,
  lirePortEnregistre,
  portLibre,
  // @ts-expect-error — module JavaScript sans declaration de types, comme les autres scripts.
} from '../../../scripts/portable/lanceur.mjs';

const reconnait = estNotreApplication as (corps: unknown) => boolean;
const lire = lirePortEnregistre as (racine: string) => number | null;
const noter = enregistrerPort as (racine: string, port: number) => void;
const libre = portLibre as (depart?: number, essais?: number) => Promise<number>;

test('LE CAS MESURE : un service tiers sur le port n’est PAS pris pour notre application', () => {
  // La reponse exacte relevee pendant la mesure.
  assert.equal(reconnait('{"service":"autre-chose"}'), false);
  // Et les autres formes qu'un service inconnu peut rendre avec un code 200.
  for (const corps of ['', 'OK', '<html><body>Grafana</body></html>', '[]', 'null', '{}']) {
    assert.equal(reconnait(corps), false, `« ${corps} » ne doit pas passer pour notre application`);
  }
});

test('le temoin : la vraie reponse de /api/sante est bien reconnue', () => {
  /**
   * Sans ce temoin, une fonction qui refuserait TOUT passerait le test precedent — et le
   * deuxieme double-clic redemarrerait alors un exemplaire par-dessus le premier, ce qui est
   * exactement le defaut que la sonde existait pour eviter.
   *
   * La signature retenue est celle que `/api/sante` rend toujours : `versionMoteur` et
   * `baseDeDonnees`. Extrait d'une reponse reelle, relevee sur un serveur lance en mode bureau.
   */
  const reelle = {
    statut: 'ok',
    version: '0.1.0',
    versionMoteur: '1.4.0+4d5349eb',
    baseDeDonnees: 'ok',
    configurationsFatales: [],
  };
  assert.equal(reconnait(reelle), true);
  assert.equal(reconnait(JSON.stringify(reelle)), true, 'la forme texte doit passer aussi');
  // Degrade ou hors service, c'est toujours NOTRE application : la fenetre doit etre ramenee.
  assert.equal(reconnait({ ...reelle, statut: 'degrade', baseDeDonnees: 'indisponible' }), true);
});

test('une reponse tronquee ou non-JSON ne fait pas tomber la sonde', () => {
  // Le lanceur ne doit jamais mourir sur la forme de la reponse d'un inconnu.
  for (const corps of ['{"versionMoteur"', undefined, null, 42, ['versionMoteur']]) {
    assert.equal(reconnait(corps), false);
  }
});

test('le port retenu est note, puis relu a l’identique', () => {
  const racine = mkdtempSync(join(tmpdir(), 'port-portable-'));
  try {
    assert.equal(lire(racine), null, 'sans fichier, aucun port connu');
    noter(racine, 3007);
    assert.equal(lire(racine), 3007, 'le second double-clic doit retrouver ce port');
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('un fichier de port abime est ignore, jamais cru', () => {
  /**
   * Le fichier vit dans un dossier que l'utilisateur ouvre : il peut etre vide, edite a la
   * main, ou tronque par un arret brutal. Un port fantaisiste ferait sonder n'importe quoi —
   * ou, avec un `0`, lever une exception au demarrage.
   */
  const racine = mkdtempSync(join(tmpdir(), 'port-abime-'));
  try {
    mkdirSync(join(racine, 'donnees'), { recursive: true });
    for (const contenu of ['', '   ', 'trois-mille', '0', '-1', '70000', '3000abc', '3.5']) {
      writeFileSync(join(racine, 'donnees', 'port.txt'), contenu);
      assert.equal(lire(racine), null, `« ${contenu} » ne doit pas etre pris pour un port`);
    }
    writeFileSync(join(racine, 'donnees', 'port.txt'), '3001\n');
    assert.equal(lire(racine), 3001, 'un port valide, saut de ligne compris, reste lu');
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('un port occupe ne bloque plus l’application : un autre est choisi', async () => {
  /**
   * LA SECONDE MOITIE DU DEFAUT. Reconnaitre l'intrus ne suffisait pas : avec un port fige,
   * l'application n'avait nulle part ou demarrer. On occupe donc reellement le port de depart
   * et on exige que la recherche en trouve un autre.
   */
  const { createServer } = await import('node:net');
  const squatteur = createServer();
  await new Promise<void>((r) => squatteur.listen(PORT_APPLICATION_DEPART as number, '127.0.0.1', () => r()));
  try {
    const port = await libre(PORT_APPLICATION_DEPART as number, 50);
    assert.notEqual(port, PORT_APPLICATION_DEPART, 'le port occupe ne doit pas etre retenu');
    assert.ok(
      port > (PORT_APPLICATION_DEPART as number) && port < (PORT_APPLICATION_DEPART as number) + 50,
      `port hors de la plage attendue : ${port}`,
    );
  } finally {
    await new Promise<void>((r) => squatteur.close(() => r()));
  }
});
