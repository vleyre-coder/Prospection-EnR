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
import { configurationsFatales } from '../src/config.js';

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

// ---------------------------------------------------------------------------
// La SONDE doit dire la meme chose que les ROUTES — audit 11
// ---------------------------------------------------------------------------

test('la sonde declare l’application de bureau OPERANTE sur la boucle locale', () => {
  /**
   * LE DEFAUT MESURE. `/api/sante` repondait `hors_service` avec « AUTH_DESACTIVEE est actif en
   * production : toutes les routes protegees repondent en erreur. Retirez cette variable » —
   * pendant que `GET /api/leads?limite=5` rendait 200 sur le meme serveur. Verifie en lancant
   * les deux, port 3231, base reelle.
   *
   * Le diagnostic errone n'etait pas le plus grave : le CONSEIL cassait l'application. Retirer
   * `MODE_BUREAU` est exactement ce qui fait rendre 500 a toutes les routes utiles, et
   * `donnees/journal.txt` est le fichier qu'un utilisateur ouvre quand quelque chose ne va pas.
   */
  assert.deepEqual(
    configurationsFatales({
      env: 'production',
      hote: '127.0.0.1',
      auth: { desactivee: true, modeBureau: true },
    }),
    [],
    "le mode bureau sur la boucle locale est l'exception NOMMEE : rien n'est fatal",
  );
});

test('la sonde nomme le vrai danger quand le mode bureau est expose au reseau', () => {
  // Mesure : sur `0.0.0.0`, les routes protegees rendent 500. La sonde doit le dire, et surtout
  // dire POURQUOI — une instance joignable sans authentification, ce qui n'est pas la meme faute
  // qu'un `AUTH_DESACTIVEE` oublie.
  const f = configurationsFatales({
    env: 'production',
    hote: '0.0.0.0',
    auth: { desactivee: true, modeBureau: true },
  });
  assert.equal(f.length, 2, 'les deux causes sont reelles et distinctes');
  assert.ok(
    f.some((m) => m.includes('0.0.0.0') && /boucle locale/.test(m)),
    "l'hote fautif doit etre cite : c'est lui qu'il faut changer",
  );
});

test('la sonde signale AUTH_DESACTIVEE en production sans mode bureau', () => {
  const f = configurationsFatales({
    env: 'production',
    hote: '0.0.0.0',
    auth: { desactivee: true, modeBureau: false },
  });
  assert.equal(f.length, 1);
  assert.match(f[0] ?? '', /AUTH_DESACTIVEE/);
});

test('le temoin : une authentification active ne declenche rien', () => {
  // Sans ce temoin, une fonction qui refuserait tout passerait les trois tests precedents.
  for (const hote of ['0.0.0.0', '127.0.0.1', 'enr.exemple.fr']) {
    assert.deepEqual(
      configurationsFatales({ env: 'production', hote, auth: { desactivee: false, modeBureau: false } }),
      [],
      `aucune configuration fatale attendue sur ${hote} quand l'authentification est active`,
    );
  }
});
