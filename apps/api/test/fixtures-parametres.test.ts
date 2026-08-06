/**
 * Une fixture doit etre capturee avec la requete que la PRODUCTION emet.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 8 a trouve un defaut dans mon propre dispositif de controle,
 * pas dans l'application : la fixture PVGIS avait ete capturee SANS les parametres que le connecteur
 * envoie reellement. `solaire()` envoie `optimalangles=1` ; la capture ne l'avait pas.
 *
 * Les noms de champs etaient identiques dans les deux cas, donc le test de contrat n'etait pas
 * invalide : ce qu'il verifiait etait exact. Mais l'ecart de VALEURS etait de 17 % (1 474 contre
 * 1 261 kWh/m²/an), et surtout une fixture qui n'utilise pas les parametres de production ne prouve
 * rien au-dela du nommage : elle ne verrait pas un champ qui n'apparait que sous certains parametres,
 * ni un champ qui disparait.
 *
 * C'est la meme faute que celle de l'audit 7 sur mon controle de contrat, qui ne couvrait que
 * 3 connecteurs sur 14 sans le dire : un controle dont le perimetre est plus etroit que ce qu'il
 * annonce est pire qu'aucun controle, parce qu'il rassure.
 *
 * La regle est donc verifiee mecaniquement : tout parametre que le code envoie doit figurer dans
 * l'URL enregistree de la fixture correspondante.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), 'utf8');
}

interface Index {
  _capture: string;
  urls: Record<string, string>;
}

const index = JSON.parse(lire('./fixtures/reponses/_index.json')) as Index;

/**
 * Parametres que la production envoie, par fixture.
 *
 * Cette table est DECLARATIVE, et le test suivant verifie qu'elle correspond au code : une table
 * maintenue a la main se perime, et c'est exactement ce qui est arrive au controle de contrat de
 * l'audit 7. Deux verifications donc, dans les deux sens.
 */
const PARAMETRES_ATTENDUS: Record<string, { fichier: string; appel: string; parametres: readonly string[] }> = {
  'pvgis-pvcalc-beauce': {
    fichier: '../src/connecteurs/gisement.ts',
    appel: 're.jrc.ec.europa.eu/api/v5_2/PVcalc',
    // `optimalangles` est celui qui manquait, et c'est le plus structurant : sans lui, PVGIS calcule
    // a plat et rend 17 % de moins.
    parametres: ['lat', 'lon', 'peakpower', 'loss', 'optimalangles', 'outputformat'],
  },
};

test('chaque fixture est capturee avec les parametres que la production envoie', () => {
  for (const [nom, attendu] of Object.entries(PARAMETRES_ATTENDUS)) {
    const brut = index.urls[nom];
    assert.ok(brut, `la fixture ${nom} doit figurer dans _index.json`);
    const url = new URL(brut);
    for (const p of attendu.parametres) {
      assert.ok(
        url.searchParams.has(p),
        `la fixture ${nom} a ete capturee sans le parametre \`${p}\`, que le connecteur envoie. ` +
          'Une reponse obtenue avec d’autres parametres ne prouve rien sur le contrat : recapturez-la.',
      );
    }
  }
});

test('la table des parametres attendus correspond au code, et ne se perime pas', () => {
  /**
   * Le controle inverse, et c'est lui qui compte sur le long terme.
   *
   * Une table declarative se perime en silence : le jour ou le connecteur ajoute un parametre, la
   * fixture cesse de refleter la production et rien ne le signale. On relit donc l'appel dans la
   * source et on verifie que la table le couvre EXACTEMENT — ni plus, ni moins.
   */
  for (const [nom, attendu] of Object.entries(PARAMETRES_ATTENDUS)) {
    const source = lire(attendu.fichier);
    const position = source.indexOf(attendu.appel);
    assert.ok(position > 0, `l’appel ${attendu.appel} n’existe plus dans ${attendu.fichier}`);

    // Le bloc d'objet qui suit l'URL porte les parametres, un par ligne : `cle: valeur,`.
    const bloc = source.slice(position, source.indexOf('});', position));
    const trouves = [...bloc.matchAll(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]!);

    assert.deepEqual(
      [...trouves].sort(),
      [...attendu.parametres].sort(),
      `les parametres envoyes par ${attendu.fichier} ne correspondent plus a la table de ${nom}. ` +
        'Mettez la table a jour ET recapturez la fixture : une fixture obtenue avec d’anciens ' +
        'parametres ne verifie plus le contrat reellement utilise.',
    );
  }
});

test('la fixture PVGIS porte les champs que le connecteur lit, aux valeurs attendues', () => {
  /**
   * Le contrat lui-meme. Les deux cles sont litteralement `H(i)_y` et `E_y`, parentheses incluses :
   * c'est ecrit dans le connecteur, et c'est le genre de nom qu'une relecture « corrige » en `H_i_y`
   * sans rien casser au typage — le champ devient simplement `undefined` pour toujours.
   */
  const fixture = JSON.parse(lire('./fixtures/reponses/pvgis-pvcalc-beauce.json')) as {
    outputs?: { totals?: { fixed?: Record<string, number> } };
  };
  const fixed = fixture.outputs?.totals?.fixed;
  assert.ok(fixed, 'la fixture doit porter outputs.totals.fixed');
  assert.ok(typeof fixed['H(i)_y'] === 'number', 'la cle `H(i)_y` doit exister, parentheses incluses');
  assert.ok(typeof fixed['E_y'] === 'number', 'la cle `E_y` doit exister');

  /**
   * Bornes de vraisemblance, et non egalite : PVGIS republie ses series de reanalyse, donc la valeur
   * bouge de quelques dixieme de pourcent d'une annee sur l'autre. Ce qui doit rester vrai est
   * l'ordre de grandeur, et surtout le fait que les modules sont INCLINES — a plat, la Beauce rend
   * environ 1 261 kWh/m²/an, ce qui tomberait sous la borne basse et signalerait la perte du
   * parametre `optimalangles`.
   */
  assert.ok(
    fixed['H(i)_y']! > 1350 && fixed['H(i)_y']! < 1600,
    `irradiation dans le plan des modules invraisemblable pour la Beauce inclinee : ${fixed['H(i)_y']}. ` +
      'Une valeur autour de 1 260 signale une capture faite sans `optimalangles`.',
  );
  assert.ok(
    fixed['E_y']! > 1050 && fixed['E_y']! < 1300,
    `productible specifique invraisemblable : ${fixed['E_y']}`,
  );
});

test('toutes les fixtures enregistrees ont une URL absolue et datee', () => {
  // Une fixture sans provenance n'est pas verifiable : on ne peut ni la recapturer ni savoir de quand
  // elle date. C'est ce qui distingue une fixture d'un jeu de donnees invente.
  assert.match(index._capture, /^\d{4}-\d{2}-\d{2}$/, 'la date de capture doit etre renseignee');
  assert.ok(Object.keys(index.urls).length >= 14, 'le nombre de fixtures ne doit pas diminuer');
  for (const [nom, url] of Object.entries(index.urls)) {
    assert.doesNotThrow(() => new URL(url), `la fixture ${nom} doit porter une URL absolue`);
    assert.match(url, /^https:\/\//, `la fixture ${nom} doit venir d’un service en HTTPS`);
  }
});
