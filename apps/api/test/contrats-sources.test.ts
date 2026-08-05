/**
 * Contrats des sources externes : les champs que le code LIT existent-ils vraiment ?
 *
 * POURQUOI CE FICHIER EXISTE. Le sixieme audit a trouve trois defauts d'une meme famille, qu'aucun
 * test unitaire ne pouvait attraper parce qu'ils ne sont pas des erreurs de logique mais des
 * erreurs de contrat :
 *
 *   - `gpu/document` : le connecteur lisait `typedoc`. Le champ reel est `du_type`. Resultat,
 *     `typeDocument` etait TOUJOURS nul et chaque fiche affichait « non renseigne » ;
 *   - `nature/natura-habitat` et `natura-oiseaux` : le connecteur lisait `nom_site` puis `nom`.
 *     Le champ reel est `sitename`. Le nom du site Natura 2000 etait donc TOUJOURS nul, sur la
 *     contrainte qui decide precisement d'une evaluation des incidences.
 *
 * Dans les deux cas le code compilait, tous les tests passaient, et la valeur etait simplement
 * absente — le mode de defaillance le plus discret qui soit. Un test ecrit depuis le code n'y
 * change rien : il verifie que le code lit bien `typedoc`, ce qu'il faisait.
 *
 * Ce qui l'attrape, c'est la confrontation a la donnee reelle. Le fichier
 * `fixtures/proprietes-sources.json` porte la liste des proprietes REELLEMENT renvoyees par
 * chaque point d'entree, capturee sur les services de production. Ce test verifie que tout champ
 * dont le code depend y figure.
 *
 * QUAND UN TEST D'ICI ECHOUE, deux causes possibles, et la difference compte :
 *   - le code lit un champ qui n'existe pas -> corriger le connecteur ;
 *   - la source a renomme un champ -> recapturer la fixture, puis corriger le connecteur.
 * Dans les deux cas, ne jamais ajouter le champ a la fixture a la main : elle ne vaut que parce
 * qu'elle vient du service.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Fixture {
  _capture: string;
  endpoints: Record<string, string[] | null>;
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('./fixtures/proprietes-sources.json', import.meta.url), 'utf8'),
) as Fixture;

/**
 * Champs dont un connecteur DEPEND, point d'entree par point d'entree.
 *
 * A tenir a jour : quand un connecteur commence a lire un nouveau champ, il s'ajoute ici. C'est
 * le prix de la garde, et il est faible au regard de ce qu'elle attrape.
 *
 * Ne pas y mettre les champs seulement declares dans une interface sans etre lus : ce test
 * protege les valeurs qui remontent au snapshot, pas les declarations de confort.
 */
const CHAMPS_LUS: Record<string, readonly string[]> = {
  // --- GPU (urbanisme) ---
  'apicarto/gpu/zone-urba': ['libelle', 'libelong', 'typezone', 'destdomi', 'urlfic', 'datappro'],
  'apicarto/gpu/document': ['du_type'],
  'apicarto/gpu/municipality': ['is_rnu'],
  'apicarto/gpu/prescription-surf': ['typepsc', 'libelle', 'txt', 'nature'],
  'apicarto/gpu/assiette-sup-s': ['suptype', 'nomsuplitt'],

  // --- Nature (milieux naturels) ---
  // Le nom du site change de champ selon la couche : `sitename` pour Natura 2000, `nom` pour
  // les couches d'inventaire et de protection. C'est precisement le piege corrige.
  'apicarto/nature/natura-habitat': ['sitename'],
  'apicarto/nature/natura-oiseaux': ['sitename'],
  'apicarto/nature/znieff1': ['nom'],
  'apicarto/nature/znieff2': ['nom'],
  'apicarto/nature/pnr': ['nom'],
  'apicarto/nature/rnn': ['nom'],

  // --- WFS Geoplateforme ---
  'wfs/BDTOPO_V3:batiment': ['usage_1', 'usage_2', 'nature', 'nombre_de_logements'],
  'wfs/BDTOPO_V3:troncon_de_route': ['nature', 'largeur_de_chaussee'],
  // Le WFS PatriNat emploie `nom_site`, la ou API Carto emploie `sitename` ou `nom` : c'est
  // l'origine de la confusion d'un connecteur a l'autre.
  'wfs/patrinat_apb:apb': ['nom_site'],
  'wfs/RPG.LATEST:parcelles_graphiques': ['code_cultu', 'code_group'],
};

test('la fixture couvre tous les points d’entree surveilles', () => {
  for (const endpoint of Object.keys(CHAMPS_LUS)) {
    const proprietes = fixture.endpoints[endpoint];
    assert.ok(
      proprietes !== undefined,
      `${endpoint} n'est pas dans la fixture : recapturez-la avant d'ajouter des champs surveilles`,
    );
    assert.ok(
      proprietes !== null && proprietes.length > 0,
      `${endpoint} a ete capture sans aucune feature : la capture doit viser une emprise ou la couche existe`,
    );
  }
});

for (const [endpoint, champs] of Object.entries(CHAMPS_LUS)) {
  test(`${endpoint} — les champs lus par le connecteur existent`, () => {
    const reelles = fixture.endpoints[endpoint];
    assert.ok(reelles, `${endpoint} absent de la fixture`);
    const manquants = champs.filter((c) => !reelles.includes(c));
    assert.deepEqual(
      manquants,
      [],
      `champ(s) lu(s) par le code mais absent(s) de la reponse reelle : ${manquants.join(', ')}. ` +
        `Proprietes reellement disponibles : ${reelles.join(', ')}`,
    );
  });
}

/**
 * Champs DECLARES par les interfaces de chaque connecteur, extraits du code source.
 *
 * Le controle par table (`CHAMPS_LUS`) ne suffit pas : il attrape un champ nouvellement declare
 * qui n'existe pas, mais pas la derive inverse — le connecteur qui repart lire `typedoc` alors
 * que la table dit `du_type`. Verifie par mutation : seul le typage s'en apercevait, et seulement
 * parce que l'interface avait ete changee en meme temps.
 *
 * On extrait donc les proprietes des interfaces `Proprietes*` du connecteur et on exige que
 * CHACUNE existe dans au moins une reponse reelle du ou des points d'entree que ce fichier
 * interroge. Une interface devient ainsi un contrat verifie, et non une declaration d'intention.
 */
const INTERFACES_SURVEILLEES: ReadonlyArray<{
  fichier: string;
  interfaces: readonly string[];
  endpoints: readonly string[];
}> = [
  {
    fichier: '../src/connecteurs/gpu.ts',
    interfaces: ['ProprietesZoneUrba', 'ProprietesPrescription', 'ProprietesDocument', 'ProprietesMunicipality'],
    endpoints: [
      'apicarto/gpu/zone-urba',
      'apicarto/gpu/prescription-surf',
      'apicarto/gpu/document',
      'apicarto/gpu/municipality',
      'apicarto/gpu/assiette-sup-s',
    ],
  },
  {
    fichier: '../src/connecteurs/nature.ts',
    interfaces: ['ProprietesInpn'],
    endpoints: [
      'apicarto/nature/natura-habitat',
      'apicarto/nature/natura-oiseaux',
      'apicarto/nature/znieff1',
      'apicarto/nature/znieff2',
      'apicarto/nature/pnr',
      'apicarto/nature/rnn',
    ],
  },
  {
    fichier: '../src/connecteurs/wfs.ts',
    interfaces: ['ProprietesBatiment', 'ProprietesRoute'],
    endpoints: ['wfs/BDTOPO_V3:batiment', 'wfs/BDTOPO_V3:troncon_de_route'],
  },
];

/** Proprietes declarees par une interface TypeScript, dans un fichier source. */
function proprietesDeclarees(source: string, nom: string): string[] {
  const debut = source.indexOf(`interface ${nom} {`);
  if (debut === -1) return [];
  const fin = source.indexOf('\n}', debut);
  const corps = source.slice(debut, fin);
  return [...corps.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\??:/gim)].map((m) => m[1]!);
}

for (const { fichier, interfaces, endpoints } of INTERFACES_SURVEILLEES) {
  test(`${fichier} — toute propriete declaree existe dans une reponse reelle`, () => {
    const source = readFileSync(new URL(fichier, import.meta.url), 'utf8');
    const disponibles = new Set(endpoints.flatMap((e) => fixture.endpoints[e] ?? []));
    assert.ok(disponibles.size > 0, `aucune propriete capturee pour ${fichier}`);

    const fantomes: string[] = [];
    for (const nom of interfaces) {
      const declarees = proprietesDeclarees(source, nom);
      assert.ok(declarees.length > 0, `interface ${nom} introuvable ou vide dans ${fichier}`);
      for (const c of declarees) {
        if (!disponibles.has(c)) fantomes.push(`${nom}.${c}`);
      }
    }
    assert.deepEqual(
      fantomes,
      [],
      `propriete(s) declaree(s) qui n'existent dans aucune reponse reelle : ${fantomes.join(', ')}. ` +
        "Une propriete inexistante se lit sans erreur et rend la valeur nulle POUR TOUJOURS : " +
        'supprimez-la, ou corrigez son nom.',
    );
  });
}

test('les pieges corriges par l’audit 6 restent verrouilles', () => {
  // Ces trois assertions sont redondantes avec la boucle ci-dessus, et c'est voulu : elles
  // nomment le defaut, de sorte qu'un echec dise ce qui est casse et non seulement qu'il l'est.
  const doc = fixture.endpoints['apicarto/gpu/document'];
  assert.ok(doc?.includes('du_type'), 'le type de document est dans du_type');
  assert.ok(!doc?.includes('typedoc'), 'typedoc n’existe pas : le lire rendait typeDocument toujours nul');

  const natura = fixture.endpoints['apicarto/nature/natura-habitat'];
  assert.ok(natura?.includes('sitename'), 'le nom du site Natura 2000 est dans sitename');
  assert.ok(
    !natura?.includes('nom_site') && !natura?.includes('nom'),
    'ni nom_site ni nom n’existent sur les couches Natura 2000 d’API Carto',
  );

  const znieff = fixture.endpoints['apicarto/nature/znieff1'];
  assert.ok(znieff?.includes('nom'), 'le nom de la ZNIEFF est dans nom');
  assert.ok(!znieff?.includes('sitename'), 'sitename n’existe pas sur les ZNIEFF : les couches diffèrent');
});
