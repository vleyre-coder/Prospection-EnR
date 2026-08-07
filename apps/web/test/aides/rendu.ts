/**
 * Monter les vrais composants et lire le HTML qu'ils produisent.
 *
 * POURQUOI CE MODULE EXISTE — audit 10, §D3, et le constat qui l'accompagne : **aucun test du projet
 * n'avait jamais affiche une page.** Les cinq fichiers de test de `apps/web` verifiaient des
 * fonctions pures et des proprietes du source ; le ratio lignes de test / lignes de source y etait de
 * 0,11, quatre fois moins que l'API, sur la seule partie que l'utilisateur regarde.
 *
 * Ce que cela coutait concretement : les deux defauts de forme de l'audit 10 — les points decimaux
 * dans les phrases francaises (B1) et les dates ISO du rapport (B2) — vivaient dans du texte
 * REELLEMENT AFFICHE. Ils ont ete trouves en pilotant un navigateur a la main, une fois. Rien ne les
 * empechait de revenir des le lendemain.
 *
 * COMMENT, SANS AJOUTER UNE SEULE DEPENDANCE. `react-dom/server` est deja installe — c'est une
 * dependance de l'application. `renderToStaticMarkup` execute la vraie phase de rendu de React sur
 * l'arbre reel de composants et rend le HTML produit, sans DOM, sans jsdom, sans navigateur.
 *
 * CE QUE CELA NE COUVRE PAS, et il faut le dire pour ne pas surestimer ces tests : le rendu serveur
 * n'execute pas les `useEffect`, ne declenche aucun evenement, et ne peut donc rien dire des clics ni
 * des transitions d'etat. Il couvre exactement une chose — **le texte que le composant produit a
 * partir d'un etat donne** — et c'est precisement la que vivaient les defauts de l'audit 10. Les
 * interactions restent du ressort des tests de bout en bout, dont la decision revient au proprietaire
 * du projet (§G1).
 */

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Filiere } from '@enr/core';
import type { FicheParcelle as Fiche, Referentiel } from '../../src/api/client.js';
import { useEtat } from '../../src/store/etat.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(ICI, '../fixtures');

/**
 * LE PIEGE LE PLUS DANGEREUX DE CE FICHIER, et il ne se signale pas tout seul.
 *
 * Zustand v5 lit son etat par `useSyncExternalStore`, auquel il passe TROIS fonctions : l'abonnement,
 * l'instantane client (`getState`) et **l'instantane serveur (`getInitialState`)**. En rendu serveur,
 * React appelle le troisieme. Le choix est deliberé cote zustand — il garantit que le HTML du serveur
 * correspond a l'etat initial du client, donc qu'il n'y a pas d'ecart d'hydratation.
 *
 * Consequence ici : `useEtat.setState(...)` avant un `renderToStaticMarkup` **n'a aucun effet sur ce
 * qui est rendu**. Le composant voit l'etat par defaut, toujours.
 *
 * Ce n'est pas une nuisance mineure, c'est un producteur de tests DECORATIFS — la categorie exacte
 * que la verification par mutation existe pour debusquer. Un test qui masque un avertissement puis
 * verifie qu'il a disparu passerait sans rien prouver si l'assertion etait ecrite dans l'autre sens ;
 * et toute branche pilotee par le store se serait rendue avec l'etat par defaut, en silence. Trouve
 * en constatant qu'un avertissement masque restait affiche.
 *
 * LA CORRECTION, et pourquoi ce n'est pas celle a laquelle on pense d'abord. Reassigner
 * `useEtat.getInitialState` ne sert a rien : `create()` fait `Object.assign(hook, api)`, donc la
 * propriete du hook est une COPIE de la fonction, tandis que le rendu appelle celle de l'`api`
 * interne. Essaye, et sans effet.
 *
 * Ce qui marche s'appuie sur une propriete verifiable de zustand : `getInitialState()` renvoie
 * l'objet d'etat capture a la creation, et `setState` REMPLACE cet objet par un nouveau. Tant que
 * personne n'a appele `setState`, l'etat courant EST l'objet initial. Muter cet objet en place fait
 * donc voir la modification aux deux instantanes a la fois.
 *
 * La condition « tant que personne n'a appele `setState` » est fragile, alors elle n'est pas
 * supposee : elle est verifiee a chaque rendu, et sa rupture leve. Une hypothese tacite dans de
 * l'outillage de test est exactement ce qui produit un test decoratif.
 */
type ApiEtat = { getInitialState: () => Record<string, unknown> };
const ETAT_PAR_DEFAUT: Record<string, unknown> = { ...(useEtat.getState() as object) };

function poserEtat(partiel: Record<string, unknown>): void {
  const courant = useEtat.getState() as unknown as Record<string, unknown>;
  const initial = (useEtat as unknown as ApiEtat).getInitialState();
  if (courant !== initial) {
    throw new Error(
      'Le store a ete remplace par un setState : le rendu serveur lira desormais l’etat initial et ' +
        'ignorera silencieusement tout etat pose par les tests. Utilisez le parametre `etat` de ' +
        '`rendre()`, qui mute l’objet en place, et jamais `useEtat.setState` dans un test de rendu.',
    );
  }
  // Retour aux valeurs par defaut avant application : deux rendus successifs ne doivent pas
  // s'influencer, et un test qui passe grace a l'etat laisse par un precedent ne prouve rien.
  Object.assign(courant, ETAT_PAR_DEFAUT, partiel);
}

/** Un cas capture : le nom du fichier, la parcelle, la filiere, et la raison de sa presence. */
export interface CasCapture {
  nom: string;
  idu: string;
  filiere: Filiere;
  pourquoi: string;
}

function lire<T>(fichier: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, fichier), 'utf8')) as T;
}

export const CAS: CasCapture[] = lire<CasCapture[]>('index.json');
export const referentiel: Referentiel = lire<Referentiel>('referentiel.json');

export function fiche(nom: string): Fiche {
  return lire<Fiche>(`fiche-${nom}.json`);
}

/**
 * Un client de requetes dont le cache est DEJA rempli, et dont le reseau est coupe.
 *
 * `queryFn` leve : si un composant demandait une donnee que le test n'a pas prevue, l'echec doit etre
 * bruyant. Un test qui laisse partir une requete reelle est le defaut B4 de l'audit 10 — celui qui
 * lancait une campagne d'enrichissement de 438 parcelles a chaque `npm test`.
 */
function clientAmorce(entrees: Array<[readonly unknown[], unknown]>): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
        queryFn: () => {
          throw new Error(
            'Requete reseau non prevue dans un test de rendu : amorcez le cache pour cette cle.',
          );
        },
      },
    },
  });
  for (const [cle, valeur] of entrees) client.setQueryData(cle, valeur);
  return client;
}

/**
 * Rend un composant et renvoie le HTML produit.
 *
 * L'etat global est repositionne a chaque appel : deux rendus successifs ne doivent pas s'influencer,
 * et un test qui passe seulement parce qu'un precedent a laisse un etat derriere lui ne prouve rien.
 */
export function rendre(
  element: ReactElement,
  entreesCache: Array<[readonly unknown[], unknown]> = [],
  etat: Record<string, unknown> = {},
): string {
  poserEtat(etat);
  const client = clientAmorce(entreesCache);
  try {
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, element),
    );
  } finally {
    client.clear();
  }
}

/**
 * Rend un composant dont les cles de requete DEPENDENT DE SON PROPRE ETAT.
 *
 * `VueListe` interroge `['liste', filtres]`, ou `filtres` est calcule dans le composant a partir du
 * store, des props et d'un tri local. Amorcer le cache demanderait de reconstruire cet objet a
 * l'identique dans le test — c'est-a-dire de recopier la logique que le test est cense verifier. Un
 * test qui recopie son sujet ne le verifie pas : il se verifie lui-meme.
 *
 * La solution laisse le composant declarer ses requetes. Premier rendu : le composant s'abonne, les
 * cles apparaissent dans le cache, le HTML produit est celui de l'etat « en chargement » et on le
 * jette. On amorce alors CES cles-la — reconnues par leur premier segment, le nom de la requete — et
 * on rend une seconde fois. Aucune cle n'est devinee.
 */
export function rendreResolu(
  element: ReactElement,
  donneesParNom: Record<string, unknown>,
  etat: Record<string, unknown> = {},
): string {
  poserEtat(etat);
  const client = clientAmorce([]);
  try {
    // Premier rendu, jete : il ne sert qu'a faire declarer les requetes.
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));

    const cles = client.getQueryCache().getAll().map((q) => q.queryKey);
    const amorcees = new Set<string>();
    for (const cle of cles) {
      const nom = String(cle[0]);
      if (!(nom in donneesParNom)) continue;
      client.setQueryData(cle, donneesParNom[nom]);
      amorcees.add(nom);
    }
    const oubliees = Object.keys(donneesParNom).filter((n) => !amorcees.has(n));
    if (oubliees.length > 0) {
      // Sinon le test passerait sur un composant en chargement, sans jamais afficher la donnee —
      // exactement le genre de test decoratif que ce fichier existe pour eviter.
      throw new Error(
        `Donnees fournies pour des requetes que le composant n'a pas emises : ${oubliees.join(', ')}. ` +
          `Requetes observees : ${cles.map((c) => String(c[0])).join(', ') || 'aucune'}.`,
      );
    }
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));
  } finally {
    client.clear();
  }
}

/**
 * Le HTML debarrasse de ses balises : le texte que l'utilisateur lit reellement.
 *
 * Les entites HTML sont retablies, sans quoi une apostrophe typographique ou un espace insecable —
 * tous deux presents dans les libelles du projet — apparaitraient comme `&#x27;` et fausseraient
 * toute recherche de motif.
 */
export function texte(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ');
}
