/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE MEME PLAFOND DES DEUX COTES — un nombre ecrit deux fois finit par etre ecrit differemment
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE DOSSIER DE SITE PORTE SON PLAFOND A DEUX ENDROITS, et ce n'est pas evitable : l'API doit le
 * faire respecter (`MAX_PARCELLES_DOSSIER`, `routes/divers.ts`) et l'interface doit le dire AVANT
 * l'envoi, sans quoi l'operateur apprend la limite par un 400 (`MAX_DOSSIER`, `VueListe.tsx`).
 * `@enr/web` ne depend pas de `@enr/api` : la constante ne peut pas etre partagee.
 *
 * CE QUI ARRIVE QUAND ILS DIVERGENT, et les deux sens sont mauvais :
 *   - interface plus HAUTE que l'API : le bouton reste actif, l'export part, et revient en 400
 *     apres que l'operateur a coche soixante cases ;
 *   - interface plus BASSE : le bouton se desactive sur une selection que l'API aurait servie.
 *
 * Aucun test de comportement ne verrait cela — chaque cote est coherent avec lui-meme. C'est donc
 * un garde STRUCTUREL, qui lit les deux fichiers sur le disque. Il ne coute aucune base, aucun
 * navigateur, et il est le seul endroit du depot ou cette egalite peut etre affirmee.
 *
 * IL LIT LES SOURCES, PAS LES IMPORTS : importer `routes/divers.ts` depuis la suite de l'interface
 * entrainerait Fastify, la base et la configuration serveur dans un test de rendu.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '../../..');

/** Lit une constante numerique declaree `const NOM = 123;` dans un fichier source. */
function constante(chemin: string, nom: string): number {
  const source = readFileSync(join(RACINE, chemin), 'utf8');
  const m = new RegExp(`const ${nom} = (\\d[\\d_]*);`).exec(source);
  assert.ok(
    m,
    `constante \`${nom}\` introuvable dans ${chemin} : elle a ete renommee ou sa forme a change, ` +
      'et ce garde ne verifie donc plus rien. Mettez-le a jour plutot que de le supprimer.',
  );
  return Number(m![1]!.replace(/_/g, ''));
}

test('le plafond du dossier de site est le meme dans l’API et dans l’interface', () => {
  const api = constante('apps/api/src/routes/divers.ts', 'MAX_PARCELLES_DOSSIER');
  const web = constante('apps/web/src/components/VueListe.tsx', 'MAX_DOSSIER');
  assert.equal(
    web,
    api,
    `l’interface annonce un plafond de ${web} parcelles, l’API en applique ${api}. ` +
      (web > api
        ? 'L’operateur cochera des cases pour recevoir un refus.'
        : 'Le bouton se desactive sur une selection que l’API aurait servie.'),
  );
});

test('le plafond reste dans l’ordre de grandeur mesure', () => {
  /*
   * CE GARDE N'EST PAS UN CAPRICE DE VALEUR. Le plafond a d'abord valu 25, justifie par une phrase
   * qui avait la forme d'une mesure et n'en etait pas — « au-dela, la requete devient un deni de
   * service sur soi-meme ». La mesure, faite ensuite : 400 parcelles en 711 ms, 359 ko, +25 Mo de
   * tas, montee en charge lineaire et sans falaise. Deux ordres de grandeur d'ecart.
   *
   * La borne haute retenue ici, 500, n'est donc pas une limite machine : c'est le point au-dela
   * duquel le chiffre cesserait d'etre celui d'un SITE, et ou personne n'aurait re-mesure. Un
   * plafond qui grimperait seul jusqu'a 20 000 doit rencontrer une resistance ecrite.
   */
  const api = constante('apps/api/src/routes/divers.ts', 'MAX_PARCELLES_DOSSIER');
  assert.ok(
    api >= 10 && api <= 500,
    `plafond de ${api} parcelles : hors de la plage mesuree. En dessous de 10, des sites ordinaires ` +
      'en parcellaire morcele sont bloques ; au-dela de 500, le document depasse la centaine de ' +
      'pages et la mesure de charge n’a plus ete refaite.',
  );
});
