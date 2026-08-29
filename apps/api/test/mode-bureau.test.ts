/**
 * Le mode bureau : pas de mot de passe sur un poste, et rien de plus.
 *
 * POURQUOI CE FICHIER EXISTE, ET CE QU'IL A COUTE DE NE PAS L'AVOIR. L'application portable
 * pose `NODE_ENV=production` — c'est ce qui garde la politique CORS restrictive — et
 * `AUTH_DESACTIVEE=true`, parce qu'un prospecteur qui double-clique sur une icone a deja
 * ouvert sa session Windows. Or le serveur REFUSE cette combinaison, a juste titre : c'est le
 * garde-fou qui empeche de mettre en ligne un serveur sans authentification.
 *
 * Resultat, constate en lancant vraiment l'archive : l'interface s'affichait, et toutes les
 * routes utiles rendaient 500 « AUTH_DESACTIVEE est interdit en production ». Une carte vide.
 * Le defaut ne se voyait NI a la relecture — les deux variables sont correctes prises
 * separement — NI sur `/api/sante`, qui est publique et repondait 200.
 *
 * `MODE_BUREAU` nomme l'exception. Ce fichier verifie qu'elle reste une exception :
 *
 *   - elle exige une ECOUTE SUR LA BOUCLE LOCALE. C'est la condition qui a du mordant : elle
 *     porte sur ce que la machine expose reellement, et non sur une variable qu'on recopie
 *     d'un fichier de configuration a l'autre. Un serveur sur `0.0.0.0` ne peut pas s'en
 *     prevaloir, meme en posant le drapeau ;
 *   - sans le drapeau, le refus de production reste entier.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estBoucleLocale } from '../src/serveur.js';

test('la boucle locale est reconnue sous toutes ses ecritures', () => {
  for (const hote of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '127.0.1.1', ' 127.0.0.1 ']) {
    assert.equal(estBoucleLocale(hote), true, `${hote} est une adresse de boucle locale`);
  }
});

test('tout ce qui est joignable depuis le reseau est refuse', () => {
  /**
   * `0.0.0.0` est le DEFAUT de la configuration, et le cas de tout hebergement : c'est
   * l'entree qui compte le plus dans cette liste. `192.168.x` et `10.x` sont des adresses
   * privees — privees ne veut pas dire locales : le poste voisin y accede.
   */
  for (const hote of ['0.0.0.0', '192.168.1.20', '10.0.0.5', '172.16.0.1', 'enr.exemple.fr', '', '::']) {
    assert.equal(estBoucleLocale(hote), false, `${hote} est joignable depuis ailleurs`);
  }
});

test('une adresse qui COMMENCE par 127 mais n’en est pas une reste refusee', () => {
  /**
   * Le piege classique d'un controle par prefixe. `127.0.0.1.exemple.fr` est un nom de
   * domaine que n'importe qui peut faire pointer ou il veut ; `1270.0.0.1` n'est pas une
   * adresse. Aucun des deux ne doit ouvrir le mode bureau.
   */
  for (const hote of ['127.0.0.1.exemple.fr', '1270.0.0.1', '127exemple.fr', 'localhost.evil.com']) {
    assert.equal(estBoucleLocale(hote), false, `${hote} ne doit pas passer pour la boucle locale`);
  }
});
