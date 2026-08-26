import type { Config, Context } from '@netlify/edge-functions';

/**
 * PORTAIL D'ACCES DE L'INTERFACE HEBERGEE SUR NETLIFY.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE PORTAIL PROTEGE, ET CE QU'IL NE PROTEGE PAS. A lire avant de s'y fier.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Netlify n'heberge que l'INTERFACE : l'API et sa base PostGIS tournent ailleurs
 * (voir docs/HEBERGEMENT.md). Ce portail est donc une porte de rue posee devant le
 * batiment, pas la serrure du coffre :
 *
 *   • il empeche qu'un inconnu — ou un moteur de recherche — ouvre l'interface et decouvre
 *     l'existence de l'outil, sa carte, ses filieres, la forme de vos donnees ;
 *   • il NE protege PAS les donnees, parce que l'API reste joignable a sa propre URL,
 *     que ce portail existe ou non. Ce qui protege les donnees, c'est l'authentification
 *     de l'API elle-meme : formulaire de connexion, jetons JWT, roles, habilitation
 *     explicite pour les donnees de proprietaires, journalisation des consultations.
 *
 * Autrement dit : ce portail s'AJOUTE a l'authentification de l'application, il ne la
 * remplace pas. Un mot de passe partage ne dit pas QUI a consulte QUOI ; les obligations
 * du RGPD sur les donnees nominatives de proprietaires reposent entierement sur l'API.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI `/api/*` EST EXCLU. Ce n'est pas un oubli, c'est une necessite technique.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * En mode reproxification (le mode par defaut de scripts/netlify-build.sh), Netlify relaie
 * `/api/*` vers l'API : pour le navigateur, tout vient de la meme origine. Or l'interface
 * pose elle-meme un en-tete `Authorization: Bearer <jeton>` sur CHAQUE requete adressee a
 * son origine — apps/web/src/api/client.ts pour les appels JSON, et
 * apps/web/src/components/Carte.tsx (`transformerRequete`) pour les tuiles, les calques,
 * le fond de carte et les glyphes.
 *
 * L'authentification HTTP Basic utilise LE MEME en-tete. Si ce portail exigeait du Basic
 * sur `/api/*`, alors, une fois l'utilisateur connecte, l'en-tete `Bearer` remplacerait
 * l'en-tete `Basic` et le portail repondrait 401 a tous les appels d'API. Et l'interface
 * traite tout 401 venant de son origine comme une session expiree : elle renverrait
 * l'utilisateur au formulaire de connexion — une boucle de deconnexion sur une session
 * parfaitement valide. C'est exactement le defaut deja rencontre et documente dans
 * Carte.tsx ; il ne sera pas reintroduit par la porte d'entree.
 *
 * Cette exclusion ne coute rien en securite : le meme chemin est de toute facon ouvert a
 * l'URL propre de l'API, et il y est garde par les jetons JWT.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * FORCE BRUTE.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Deux mesures, et aucune illusion sur leur portee :
 *
 *   1. `config.rateLimit` ci-dessous plafonne les requetes par adresse IP. C'est une
 *      fonctionnalite Netlify declarative, disponible sur tous les forfaits lorsqu'elle
 *      est declaree dans le code (deux regles au maximum sur les forfaits gratuits).
 *   2. scripts/netlify-build.sh REFUSE de construire le site si `MOT_DE_PASSE_SITE` est
 *      absent, ou trop court, ou devinable. C'est la mesure qui compte vraiment : un
 *      plafond par IP se contourne avec plusieurs IP, un mot de passe de 24 caracteres
 *      tires au hasard ne se devine pas.
 *
 * La comparaison se fait sur les empreintes SHA-256 et non sur les chaines, pour que la
 * duree de la reponse ne renseigne pas sur le nombre de caracteres corrects.
 */

/** Nom d'utilisateur par defaut, si `UTILISATEUR_SITE` n'est pas renseigne. */
const UTILISATEUR_DEFAUT = 'prospection';

/**
 * Ce que le portail annonce au navigateur ; s'affiche dans la boite de dialogue.
 *
 * EN ASCII PUR, ET CE N'EST PAS UNE COQUETTERIE. La premiere version portait un tiret cadratin
 * (« Prospection EnR — acces reserve »). Un en-tete HTTP ne transporte que des octets latin-1 :
 * `new Response(...)` levait `Cannot convert argument to a ByteString`, donc la fonction edge
 * plantait — 500 — sur CHAQUE visite non authentifiee. Le portail n'aurait jamais laisse
 * personne entrer, et n'aurait rien protege non plus. Trouve par le test qui appelle vraiment
 * `reponseRefus()` ; illisible a la relecture du code.
 */
const DOMAINE_AUTH = 'Prospection EnR - acces reserve';

/**
 * Separateur employe pour comparer le couple identifiant/mot de passe d'un seul coup.
 *
 * L'OCTET NUL, ET ECRIT EN ECHAPPEMENT. Il ne peut apparaitre ni dans un en-tete HTTP ni
 * dans une variable d'environnement — c'est ce qui rend la concatenation injective, donc
 * la comparaison honnete (voir `coupleValide`). Il est ecrit `\u0000` et non colle
 * litteralement dans la chaine : la premiere version de ce fichier contenait trois octets
 * nuls bruts, ce qui suffisait a faire classer le source comme BINAIRE par grep — donc
 * invisible a toute recherche dans le depot, et a la merci du premier outil qui nettoie
 * les caracteres de controle. Le code faisait ce qu'il faut ; le fichier, non.
 */
const SEPARATEUR = '\u0000';

export interface Reglages {
  utilisateur: string;
  motDePasse: string;
}

/**
 * Lit les reglages dans l'environnement Netlify.
 *
 * `typeof Netlify === 'undefined'` : hors du runtime Netlify (les tests de ce depot
 * appellent directement les fonctions ci-dessous), la variable globale n'existe pas.
 * On ne veut pas d'une exception a l'import.
 */
export function lireReglages(): Reglages {
  const lire = (nom: string): string =>
    typeof Netlify === 'undefined' ? '' : (Netlify.env.get(nom) ?? '');
  return {
    utilisateur: lire('UTILISATEUR_SITE').trim() || UTILISATEUR_DEFAUT,
    motDePasse: lire('MOT_DE_PASSE_SITE'),
  };
}

/**
 * Decode la partie base64 d'un en-tete Basic.
 *
 * `atob` rend une chaine d'octets ; les mots de passe peuvent contenir des caracteres
 * accentues, que le navigateur envoie en UTF-8 (`charset="UTF-8"` dans notre defi). Il
 * faut donc repasser par les octets avant de decoder.
 */
function decoderBase64(valeur: string): string | null {
  try {
    const binaire = atob(valeur);
    const octets = Uint8Array.from(binaire, (caractere) => caractere.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(octets);
  } catch {
    return null;
  }
}

/** Extrait le couple identifiant / mot de passe d'un en-tete `Authorization`. */
export function lireEnTeteBasic(enTete: string | null): { utilisateur: string; motDePasse: string } | null {
  if (!enTete) return null;
  const separateur = enTete.indexOf(' ');
  if (separateur < 0) return null;
  // Le schema est insensible a la casse (RFC 7235) : `basic`, `Basic`, `BASIC`.
  if (enTete.slice(0, separateur).toLowerCase() !== 'basic') return null;
  const paire = decoderBase64(enTete.slice(separateur + 1).trim());
  if (paire == null) return null;
  // Premier deux-points seulement : un mot de passe a parfaitement le droit d'en contenir.
  const coupure = paire.indexOf(':');
  if (coupure < 0) return null;
  return { utilisateur: paire.slice(0, coupure), motDePasse: paire.slice(coupure + 1) };
}

async function empreinte(valeur: string): Promise<Uint8Array> {
  const octets = new TextEncoder().encode(valeur);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', octets));
}

/** Comparaison a duree constante de deux empreintes de meme longueur. */
function memeEmpreinte(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return ecart === 0;
}

/**
 * Compare le couple presente au couple attendu, sans fuite de duree.
 *
 * Les deux valeurs sont concatenees avec un separateur qui ne peut pas apparaitre dans
 * l'une d'elles (l'octet nul n'est pas transmissible dans un en-tete HTTP), pour qu'un
 * identifiant long ne puisse pas se faire passer pour un mot de passe.
 */
async function coupleValide(
  presente: { utilisateur: string; motDePasse: string },
  attendu: Reglages,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    empreinte(`${presente.utilisateur}${SEPARATEUR}${presente.motDePasse}`),
    empreinte(`${attendu.utilisateur}${SEPARATEUR}${attendu.motDePasse}`),
  ]);
  return memeEmpreinte(a, b);
}

/**
 * Verdict du portail. Trois valeurs, et pas deux :
 *
 *   - `ouvert`   : laisser passer, l'identification est bonne ;
 *   - `refuse`   : demander l'identification ;
 *   - `inactif`  : aucun mot de passe configure, le portail se retire. Le garde-fou
 *                  contre cet etat est dans scripts/netlify-build.sh, qui refuse de
 *                  construire le site sans mot de passe. Ici, se retirer silencieusement
 *                  vaut mieux que rendre le site inaccessible sur une variable oubliee.
 */
export async function verdict(
  requete: Request,
  reglages: Reglages,
): Promise<'ouvert' | 'refuse' | 'inactif'> {
  if (reglages.motDePasse === '') return 'inactif';
  const presente = lireEnTeteBasic(requete.headers.get('Authorization'));
  if (presente == null) return 'refuse';
  return (await coupleValide(presente, reglages)) ? 'ouvert' : 'refuse';
}

/**
 * Reponse de refus : le defi HTTP standard, plus une page lisible pour le cas ou le
 * visiteur annule la boite de dialogue.
 *
 * ELLE NE DIT PAS CE QU'ELLE GARDE. La premiere version parlait d'« application de
 * prospection fonciere » : c'est la seule page que verra un inconnu, et elle lui aurait
 * appris le metier de l'outil, son domaine, et — le nom d'utilisateur par defaut etant
 * « prospection » — un candidat serieux pour l'identifiant. Un collegue legitime, lui, sait
 * ou il frappe. La page reste donc utile et muette.
 */
export function reponseRefus(): Response {
  const page = `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acces reserve</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid;
         place-items: center; background: #0f1720; color: #e6edf3; padding: 1.5rem; }
  main { max-width: 34rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  p { line-height: 1.55; margin: 0 0 .75rem; color: #b9c4d0; }
</style>
<main>
  <h1>Accès réservé</h1>
  <p>Cette application n'est pas publique. Un identifiant et un mot de passe sont
     nécessaires pour l'ouvrir.</p>
  <p>Rechargez la page pour les saisir à nouveau, ou demandez-les à l'administrateur de
     l'application.</p>
</main>
</html>`;
  return new Response(page, {
    status: 401,
    headers: {
      // `charset="UTF-8"` : indique au navigateur d'encoder le couple en UTF-8, ce que
      // `decoderBase64` sait relire. Sans cela, un mot de passe accentue serait ambigu.
      'WWW-Authenticate': `Basic realm="${DOMAINE_AUTH}", charset="UTF-8"`,
      'Content-Type': 'text/html; charset=utf-8',
      // Ni le navigateur ni un intermediaire ne doivent garder cette reponse.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * La fonction edge elle-meme. Elle est exportee SOUS UN NOM en plus de l'etre par defaut :
 * Netlify ne lit que l'export par defaut, mais le dossier `netlify/` n'a pas de
 * `"type": "module"` — la package.json la plus proche est celle de la racine du depot — donc
 * l'outillage local traite ce fichier en CommonJS, et l'import par defaut y rend l'objet
 * d'exports au lieu de la fonction. Un export nomme evite ce detour d'interoperabilite sans
 * rien changer pour Netlify, plutot que de poser une package.json dans un dossier dont c'est
 * la plateforme qui fixe les conventions.
 */
export async function portail(requete: Request, contexte: Context): Promise<Response> {
  const issue = await verdict(requete, lireReglages());
  if (issue === 'refuse') return reponseRefus();
  return contexte.next();
}

export default portail;

export const config: Config = {
  path: '/*',
  /**
   * Voir l'explication en tete de fichier : ce chemin porte deja son propre en-tete
   * `Authorization: Bearer`, et le lui disputer casserait l'application.
   */
  excludedPath: ['/api/*'],
  /**
   * Plafond par adresse IP. Il faut qu'il soit large : la fonction voit passer TOUTES les
   * ressources statiques du site, et un premier affichage en demande une dizaine
   * (index.html, la feuille de style, et les quatre fragments de code — MapLibre, React,
   * les requetes, l'application). Plusieurs postes derriere une meme sortie internet
   * partagent une seule IP. 300 requetes par minute laisse donc respirer un bureau entier,
   * tout en ramenant une attaque par force brute a 300 essais par minute et par IP.
   *
   * `action` n'est volontairement pas renseigne : la documentation de Netlify et les types
   * de `@netlify/edge-functions` n'emploient pas la meme valeur pour le blocage
   * (`"block"` d'un cote, `"rate_limit"` de l'autre). Le defaut fait ce qu'on veut — 429 —
   * et ne parie pas sur celui des deux qui a raison.
   */
  rateLimit: {
    windowSize: 60,
    windowLimit: 300,
    aggregateBy: ['ip', 'domain'],
  },
};
