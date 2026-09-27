/**
 * Ingestion des couches nationales servies par le WFS de la Geoplateforme.
 *
 * POURQUOI CE FICHIER EXISTE. L'audit 8 a trouve que six couches etaient LUES en base et ecrites par
 * aucune ingestion, dont les deux qui portaient ses defauts les plus graves :
 *
 *   - `site_classe` et `site_inscrit` faisaient valoir au critere `pat_sites` 90/100 en feu VERT avec
 *     la phrase « Aucun site classe ni inscrit dans le rayon d'analyse », partout en France, sur zero
 *     donnee — et rendaient le knock-out eolien du site classe structurellement inatteignable, alors
 *     que l'article L. 341-10 du code de l'environnement y impose une autorisation ministerielle
 *     speciale jamais accordee pour un parc eolien ;
 *   - `zaer` laissait gris en permanence l'argument reglementaire le plus utile de la prospection
 *     depuis la loi APER.
 *
 * Le correctif immediat de l'audit avait rendu ces couches GRISES, ce qui etait honnete. Ce fichier
 * les rend RENSEIGNEES, ce qui est mieux : une source nationale existe pour les deux.
 *
 * DEUX PIEGES DE VOCABULAIRE, mesures sur les donnees reelles avant d'ecrire une ligne de
 * correspondance. C'est la lecon des audits 5 a 8 : le defaut n'est jamais dans le calcul, il est
 * dans la traduction d'un vocabulaire code qu'on a suppose au lieu de le mesurer.
 *
 *   1. `zaer.filiere` vaut `SOLAIRE_PV` pour 430 zones sur 600 echantillonnees — mais
 *      `detail_filiere1` vaut `TOIT` pour 293 d'entre elles. Une ZAER photovoltaique EN TOITURE n'a
 *      aucun rapport avec la prospection fonciere : traduire `SOLAIRE_PV` en `solaire_sol` sans lire
 *      le detail ferait dire a l'application « cette parcelle est en zone d'acceleration solaire au
 *      sol » a propos d'une toiture de maison de quartier. C'est exactement la forme du defaut
 *      `libPpr` de l'audit 7 : le champ existe, le code est correct, le sens est faux.
 *   2. `STE.typesite` compte cinq valeurs, dont trois ne sont PAS des sites proteges au sens des
 *      articles L. 341-1 et L. 341-10 : `Patrimoine mondial` (UNESCO), `Grand Site de France` et
 *      `Projet Grand Site de France` sont des LABELS. Les ranger en site classe donnerait un
 *      knock-out eolien sur un label sans portee reglementaire propre.
 *
 * Dans les deux cas, une valeur non reconnue n'est jamais rangee par defaut : elle est journalisee et
 * la zone n'entre dans aucune filiere. Mieux vaut une zone ignoree qu'une zone mal classee.
 */

import type { Filiere } from '@enr/core';
import { config } from '../config.js';
import { journal } from '../journal.js';
import { requete } from '../bdd.js';
import { ATTENTES_PAR_PROFIL, avecParams } from '../http.js';
import { enregistrerCouverture, enregistrerIngestion } from '../depots/sources.js';
import { effacerDisparus } from './disparus.js';
import { oublierPresenceCouches } from '../connecteurs/couches.js';
import { centroideDe } from '../geo.js';
import { createHash } from 'node:crypto';
import { entitesDepuisFlux } from './flux-geojson.js';

/** Empreinte courte et stable d'une chaine, pour construire une cle naturelle reproductible. */
function empreinte(valeur: string): string {
  return createHash('sha1').update(valeur).digest('hex').slice(0, 16);
}

/**
 * Taille de page WFS.
 *
 * Le service plafonne `COUNT` a 5 000. Demander davantage ne provoque pas d'erreur : il renvoie
 * silencieusement 5 000 objets, ce qui, sur une pagination par `STARTINDEX`, ferait sauter des
 * pages entieres sans que rien ne le signale. La valeur est donc celle du plafond, pas au-dela.
 */
const TAILLE_PAGE = 5000;

/** Garde-fou : au-dela, quelque chose ne va pas dans la pagination plutot que dans les donnees. */
const PAGES_MAX = 400;

/**
 * Attentes entre deux tentatives, PARTAGEES avec la couche HTTP.
 *
 * Calibrees sur le comportement REEL du service : un 503 signale une surcharge, pas une erreur de
 * requete, et sept secondes ne sont pas une attente. Cette echelle est celle du profil `patient` de
 * `jsonExterne` — la meme politique doit valoir pour toutes les ingestions, qu'elles passent par le
 * client JSON ou par le lecteur de flux. En tenir une copie ici les aurait laissees deriver.
 */
const ATTENTES_MS = ATTENTES_PAR_PROFIL.patient;

/** Respiration entre deux pages, pour ne pas provoquer la surcharge qu'on devrait ensuite absorber. */
const PAUSE_ENTRE_PAGES_MS = 400;

interface Entite {
  properties: Record<string, unknown> | null;
  geometry: unknown;
}

/**
 * Completude d'une pagination, remontee a l'appelant.
 *
 * POURQUOI CE DRAPEAU — audit 9, defaut D1. Le generateur savait deja distinguer « derniere page
 * atteinte » de « borne de securite atteinte », mais il ne le disait qu'au journal. Or c'est
 * exactement l'information dont depend le droit d'effacer ce qui a disparu de la source : effacer sur
 * une lecture partielle supprimerait des objets reels. Le drapeau part a faux et ne passe a vrai que
 * sur la seule sortie qui prouve la completude.
 */
export interface EtatPagination {
  complete: boolean;
}

/**
 * Parcourt une couche WFS page par page, en GeoJSON.
 *
 * La pagination est verifiee a chaque tour : une page qui renvoie moins que la taille demandee est
 * la derniere. On ne se fie PAS a `numberMatched`, qui n'est pas toujours renseigne sur ce service.
 */
async function* objetsWfs(
  typeName: string,
  etat?: EtatPagination,
  filtreCql?: string,
  /**
   * Parametres supplementaires, passes tels quels au service.
   *
   * Ajoute pour le RPG, qui ne porte NI code commune NI code departement dans ses attributs : la
   * seule facon de n'en demander qu'une partie est un `BBOX`. Le filtre CQL ne convenait pas — il
   * suppose de connaitre le nom de la colonne geometrique de la couche, qui varie d'une couche a
   * l'autre sur ce service.
   */
  parametresSupplementaires?: Record<string, string>,
): AsyncGenerator<Entite> {
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const url = avecParams(config.sources.geoplateformeWfs, {
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: typeName,
      OUTPUTFORMAT: 'application/json',
      SRSNAME: 'EPSG:4326',
      COUNT: String(TAILLE_PAGE),
      STARTINDEX: String(page * TAILLE_PAGE),
      ...(filtreCql ? { CQL_FILTER: filtreCql } : {}),
      ...(parametresSupplementaires ?? {}),
    });

    /**
     * REPRISE SUR ECHEC TRANSITOIRE, et non abandon.
     *
     * Constate a la premiere execution reelle : apres avoir servi 7 634 objets de la couche
     * metropolitaine, le service a repondu 400 sur la premiere page de la couche suivante — et la
     * meme requete a reussi quelques secondes plus tard. Sans reprise, l'ingestion abandonnait les
     * trois couches d'outre-mer et se declarait terminee : le critere serait reste faussement
     * silencieux en Guadeloupe, en Martinique, en Guyane et a La Reunion. Une ingestion partielle qui
     * se croit complete est precisement le defaut que ce fichier corrige.
     *
     * ATTENTES RECALIBREES A LA SECONDE EXECUTION REELLE. La premiere version attendait 1 s, 2 s puis
     * 4 s : sept secondes en tout. L'ingestion des ZAER a recu quatre 503 d'affilee et a abandonne au
     * bout de seize secondes, apres zero objet. Un 503 n'est pas une erreur de requete, c'est un
     * service qui demande d'attendre : sept secondes ne sont pas une attente. Sur une couche de
     * 1,09 million d'objets, rencontrer une surcharge est certain, et abandonner tout le travail pour
     * cela est inacceptable. Les paliers vont donc jusqu'a deux minutes.
     */
    let recus = 0;
    let derniereErreur: unknown = null;
    for (let tentative = 0; tentative < ATTENTES_MS.length + 1; tentative += 1) {
      recus = 0;
      try {
        for await (const entite of entitesDepuisFlux(url)) {
          recus += 1;
          yield entite as Entite;
        }
        derniereErreur = null;
        break;
      } catch (err) {
        derniereErreur = err;
        if (recus > 0) {
          // Des objets ont deja ete emis : rejouer la page les reemettra. L'insertion est idempotente
          // sur la cle naturelle et le lot est dedoublonne, donc c'est sans consequence — mais il faut
          // le dire, sinon un decompte superieur au nombre reel d'objets resterait inexplique.
          journal.warn({ typeName, page, recus, err }, 'Page WFS interrompue en cours de flux');
        }
        const attente = ATTENTES_MS[tentative];
        if (attente == null) break;
        journal.warn(
          { typeName, page, tentative: tentative + 1, attenteMs: attente },
          'Page WFS en échec : nouvelle tentative après attente',
        );
        await new Promise((r) => setTimeout(r, attente));
      }
    }
    if (derniereErreur) throw derniereErreur;

    journal.debug({ typeName, page, recus }, 'Page WFS ingeree');
    // Page plus courte que demandee : c'est la derniere, et la SEULE sortie qui prouve la
    // completude. Toutes les autres — exception remontee, borne de securite — laissent le drapeau
    // a faux, ce qui interdit toute suppression en aval (voir ingestion/disparus.ts).
    if (recus < TAILLE_PAGE) {
      if (etat) etat.complete = true;
      return;
    }

    // Respiration entre les pages. Sans elle, une couche de 218 pages est demandee aussi vite que le
    // reseau le permet, ce qui declenche precisement les 503 que la reprise doit ensuite absorber.
    // Mieux vaut ne pas les provoquer.
    await new Promise((r) => setTimeout(r, PAUSE_ENTRE_PAGES_MS));
  }
  // Sortir par la borne de pages est une anomalie : la dire, plutot que produire un jeu tronque
  // qu'on prendrait pour complet.
  journal.warn(
    { typeName, pagesMax: PAGES_MAX },
    'Pagination WFS interrompue par la borne de sécurité : le jeu ingere est peut-être incomplet',
  );
}

// ---------------------------------------------------------------------------
// ZAER
// ---------------------------------------------------------------------------

const COUCHE_ZAER = 'zaer:zaer';

/**
 * Details de filiere photovoltaique qui concernent le FONCIER.
 *
 * Mesure sur 600 zones : `TOIT` 293, `SOL` 80, `OMBRIERE` 38, `SURFACE` 17, vide 158. Seuls `SOL` et
 * `SURFACE` designent une implantation au sol sur terrain nu. `OMBRIERE` est un ombrage de parking —
 * un projet reel, mais qui ne se prospecte pas comme du foncier agricole, et dont l'assimilation
 * ferait ressortir des parkings dans une recherche de terres.
 */
const DETAILS_PV_AU_SOL = new Set(['SOL', 'SURFACE']);

/**
 * Details qui designent une implantation qui n'est PAS du foncier : toiture, ombriere de parking.
 *
 * Enumerer les exclusions plutot que de les deduire par complement est ce qui permet le troisieme
 * etat : ni « au sol », ni « exclu », mais « la deliberation ne dit pas ». Voir la migration 016.
 */
const DETAILS_PV_HORS_FONCIER = new Set(['TOIT', 'TOITURE', 'OMBRIERE', 'PARKING']);

/**
 * Le detail d'implantation d'une ZAER photovoltaique, en trois etats.
 *
 * POURQUOI TROIS ET NON DEUX. La regle d'origine ne retenait que « SOL » et ecartait tout le reste,
 * ce qui confond « la deliberation dit que c'est une toiture » et « la deliberation ne dit rien ».
 * Mesure sur la source : au national, `detail_filiere1` est vide pour 10 % des ZAER PV ; dans
 * l'Eure-et-Loir, pour 93 % d'entre elles. La confusion coutait donc 4 656 zones sur ce seul
 * departement — ecartees en silence, alors que la commune les a bien designees pour du
 * photovoltaique.
 */
export function implantationPv(detail: string | null | undefined): 'sol' | 'hors_foncier' | 'inconnue' {
  const d = (detail ?? '').trim().toUpperCase();
  if (DETAILS_PV_AU_SOL.has(d)) return 'sol';
  if (DETAILS_PV_HORS_FONCIER.has(d)) return 'hors_foncier';
  return 'inconnue';
}

/**
 * Vocabulaires non reconnus rencontres, avec leur nombre d'occurrences.
 *
 * Comptes plutot que journalises un par un : voir la branche `default` de `filieresZaer`. Le
 * decompte est restitue par `vocabulairesInconnus()` en fin d'ingestion, ce qui donne l'information
 * utile — QUOI et COMBIEN — sans le bruit.
 */
const inconnus = new Map<string, number>();

/** Vocabulaires non reconnus rencontres depuis le dernier `oublierVocabulairesInconnus()`. */
export function vocabulairesInconnus(): Record<string, number> {
  return Object.fromEntries(inconnus);
}

/** Remet le decompte a zero. Appele au debut de chaque ingestion. */
export function oublierVocabulairesInconnus(): void {
  inconnus.clear();
}

/**
 * Traduit une ZAER en filieres de l'application.
 *
 * Fonction pure et exportee : c'est la traduction d'un vocabulaire code, donc l'endroit exact ou les
 * audits 5 a 8 ont trouve leurs defauts. Elle doit etre testable sans reseau ni base.
 *
 * Retourne une liste VIDE lorsque la zone ne concerne aucune filiere couverte, ou lorsque son
 * vocabulaire n'est pas reconnu. Une zone sans filiere n'est pas ingeree : elle ne peut donc jamais
 * faire dire a l'application qu'une parcelle est en zone d'acceleration pour une filiere qu'elle ne
 * vise pas.
 */
export function filieresZaer(
  filiere: string | null | undefined,
  detail: string | null | undefined,
): Filiere[] {
  const f = (filiere ?? '').trim().toUpperCase();
  const d = (detail ?? '').trim().toUpperCase();

  switch (f) {
    case 'SOLAIRE_PV':
      /*
       * LE PIEGE PRINCIPAL. 58 % des ZAER photovoltaiques echantillonnees au national sont des
       * TOITURES. Elles restent ecartees : ce n'est pas du foncier.
       *
       * Une implantation INCONNUE, elle, est desormais retenue — voir `implantationPv` et la
       * migration 016. Elle est marquee `implantation_precisee = false` en base, ce qui la rend
       * proposable a la prospection sans lui laisser ouvrir le moindre argument reglementaire.
       */
      return implantationPv(d) === 'hors_foncier' ? [] : ['solaire_sol'];
    case 'EOLIEN':
      return ['eolien_terrestre'];
    case 'BIOMETHANE':
      return ['methanisation'];
    case 'BIOMASSE':
      // `BIOMASSE` couvre surtout les chaufferies bois, qui ne sont pas de la methanisation. Seul le
      // detail explicitement methanogene est retenu.
      return d === 'METHANE_COGE' || d === 'INJECTION' ? ['methanisation'] : [];
    case 'SOLAIRE_THERMIQUE':
    case 'GEOTHERMIE':
    case 'HYDROELECTRICITE':
      // Filieres reelles, hors perimetre de l'application. Ignorees sciemment, et non « par defaut ».
      return [];
    case '':
      // Champ vide : 1 zone sur 600. Indeterminee, donc ecartee.
      return [];
    default:
      // AGREGE et non journalise par zone : sur 1,09 million de zones, un changement de vocabulaire
      // cote source produirait un million de lignes de journal, ce qui noierait tout le reste et
      // saturerait le disque. Le decompte est restitue une fois, en fin d'ingestion.
      inconnus.set(`${f} / ${d}`, (inconnus.get(`${f} / ${d}`) ?? 0) + 1);
      return [];
  }
}

/**
 * Le stockage n'est PAS couvert par les ZAER, et la regle est PARTAGEE avec le moteur.
 *
 * Reexportee depuis `@enr/core` et non redefinie ici : une regle metier ecrite deux fois se
 * desynchronise. Le moteur s'en sert pour declarer le critere sans source pour cette filiere ; ce
 * fichier s'en sert pour documenter qu'aucune correspondance de `filieresZaer` ne peut la produire —
 * ce qu'un test verifie en balayant tout le vocabulaire de la source.
 */
export { FILIERES_HORS_ZAER } from '@enr/core';

/**
 * Ingere les zones d'acceleration, tout le pays ou seulement quelques departements.
 *
 * POURQUOI LE FILTRE EXISTE. La couche nationale porte 1 089 671 objets. Tant que l'ingestion etait
 * tout-ou-rien, la seule facon d'avoir la moindre zone en base etait de tout ingerer — des heures de
 * travail et plusieurs gigaoctets — ce qui revenait a n'en avoir aucune. Or l'application propose
 * desormais ces zones comme reponse a « ou prospecter » : elle a besoin qu'on puisse allumer un
 * departement en quelques minutes, puis un autre. Le filtre est celui de la source elle-meme
 * (`CQL_FILTER` sur l'attribut `dep`), donc c'est le serveur qui trie, pas nous apres coup.
 *
 * CE QUE LE FILTRE INTERDIT, et le code s'en garde : l'effacement des disparus. `effacerDisparus`
 * supprime ce que la pagination n'a pas revu ; sur une ingestion limitee au 28, cela effacerait
 * toutes les zones des autres departements. La pagination n'est donc declaree complete, et
 * l'effacement autorise, que sur une ingestion NATIONALE.
 */
export async function ingererZaer(departements?: readonly string[]): Promise<{
  connecteur: string;
  nbObjets: number;
  nbSansGeometrie: number;
  nbSansFiliere: number;
  millesime: string | null;
  departements: string[] | null;
}> {
  let nbObjets = 0;
  let nbSansGeometrie = 0;
  let nbSansFiliere = 0;
  oublierVocabulairesInconnus();
  /**
   * Horodatage pris AVANT la premiere insertion, et etat de pagination.
   *
   * Toute zone dont `updated_at` precede cet instant n'a pas ete revue par cette execution : elle a
   * disparu de la source. La suppression n'est tentee que si la pagination est prouvee complete, et
   * refusee au-dela d'un plafond de volumetrie (audit 9, defaut D1).
   */
  const debutRun = new Date();
  const pagination: EtatPagination = { complete: false };

  // Les filieres sont portees par une CHAINE et non un tableau : voir le commentaire dans la requete.
  // Le dernier membre porte « oui »/« non » : l'implantation est-elle precisee par la
  // deliberation ? Une chaine et non un booleen, parce que `unnest` recoit des `text[]`
  // homogenes.
  type Ligne = [string, string | null, string | null, string, string, string | null, string, string];
  const lot: Ligne[] = [];

  const viderLot = async (): Promise<void> => {
    if (lot.length === 0) return;
    await requete(
      `INSERT INTO zaer
         (identifiant_source, code_insee, code_departement, filieres, geom, date_deliberation,
          attributs, source_document, est_demonstration, implantation_precisee)
       -- DISTINCT ON : une page rejouee apres un echec transitoire reemet ses objets, et
       -- ON CONFLICT DO UPDATE refuse de toucher deux fois la meme ligne dans une seule commande
       -- (« cannot affect row a second time »). Le defaut s'est produit sur l'ingestion des sites, ou
       -- la source elle-meme repete la cle ; ici il ne surviendrait qu'apres une reprise, donc de
       -- facon intermittente, le pire cas a diagnostiquer.
       SELECT DISTINCT ON (d.identifiant)
              d.identifiant, d.insee, d.dep,
              -- LES FILIERES PASSENT EN CHAINE, PUIS SONT REDECOUPEES.
              --
              -- Passer un text[][] a unnest ne fonctionne pas : PostgreSQL APLATIT les tableaux
              -- multidimensionnels, si bien qu'un tableau de listes de filieres devient une seule
              -- longue liste sans frontieres de lignes. L'erreur reelle etait « column filieres is of
              -- type text[] but expression is of type text » : le type signalait la faute, pas sa
              -- cause. Une chaine par ligne, redecoupee ici, est univoque. Les valeurs de filiere ne
              -- contiennent pas de virgule, par construction de filieresZaer, qui ne produit que des
              -- identifiants du domaine.
              string_to_array(d.filieres, ','),
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(d.geom), 4326)),
              d.valid_date::date, d.attributs::jsonb, 'WFS Geoplateforme zaer:zaer', false,
              d.precisee = 'oui'
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                     $8::text[])
              AS d(identifiant, insee, dep, filieres, geom, valid_date, attributs, precisee)
       ON CONFLICT (identifiant_source) WHERE identifiant_source IS NOT NULL DO UPDATE SET
         code_insee = EXCLUDED.code_insee,
         code_departement = EXCLUDED.code_departement,
         filieres = EXCLUDED.filieres,
         geom = EXCLUDED.geom,
         date_deliberation = EXCLUDED.date_deliberation,
         attributs = EXCLUDED.attributs,
         implantation_precisee = EXCLUDED.implantation_precisee,
         -- Revue par cette ingestion : c'est ce qui la distingue d'une ligne oubliee, donc disparue
         -- de la source (audit 9, defaut D1).
         updated_at = now()`,
      [
        lot.map((l) => l[0]),
        lot.map((l) => l[1]),
        lot.map((l) => l[2]),
        lot.map((l) => l[3]),
        lot.map((l) => l[4]),
        lot.map((l) => l[5]),
        lot.map((l) => l[6]),
        lot.map((l) => l[7]),
      ],
    );
    lot.length = 0;
  };

  try {
    /*
     * Le filtre est passe a la SOURCE. `dep IN ('28','45')` en CQL : c'est le serveur qui restreint,
     * donc on ne telecharge pas un million d'objets pour en garder dix mille.
     */
    const filtre =
      departements && departements.length > 0
        ? `dep IN (${departements.map((d) => `'${d.replace(/'/g, "''")}'`).join(',')})`
        : undefined;
    for await (const entite of objetsWfs(COUCHE_ZAER, pagination, filtre)) {
      const p = entite.properties ?? {};
      const g = entite.geometry;
      if (!g || typeof g !== 'object') {
        nbSansGeometrie += 1;
        continue;
      }

      const filieres = filieresZaer(
        typeof p['filiere'] === 'string' ? p['filiere'] : null,
        typeof p['detail_filiere1'] === 'string' ? p['detail_filiere1'] : null,
      );
      if (filieres.length === 0) {
        // Hors perimetre ou vocabulaire non reconnu : la zone n'est pas ingeree. Elle ne pourra donc
        // pas faire dire a l'application qu'une parcelle est en ZAER pour une filiere non visee.
        nbSansFiliere += 1;
        continue;
      }

      const insee = typeof p['cog'] === 'string' ? p['cog'].slice(0, 5) : null;
      // Le departement vient de `dep` s'il est present, sinon des deux premiers chiffres du code
      // commune — qui les portent, sauf en Corse et en outre-mer ou `dep` est renseigne.
      const dep = typeof p['dep'] === 'string' && p['dep'] !== ''
        ? p['dep'].padStart(2, '0').slice(0, 3)
        : (insee?.slice(0, 2) ?? null);

      lot.push([
        `${COUCHE_ZAER}/${String(p['id'] ?? `${insee}-${nbObjets}`)}`,
        insee,
        dep,
        filieres.join(','),
        JSON.stringify(g),
        typeof p['valid_date'] === 'string' && p['valid_date'] !== '' ? p['valid_date'] : null,
        JSON.stringify({
          nom: p['nom'] ?? null,
          filiereSource: p['filiere'] ?? null,
          detailFiliere: p['detail_filiere1'] ?? null,
          usageSol: p['usage_sol'] ?? null,
          productibleMwhAn: p['productible'] ?? null,
          puissanceMw: p['puissance'] ?? null,
          epci: p['epci'] ?? null,
          commentaire: p['commentaire'] ?? null,
        }),
        /*
         * L'implantation n'est « precisee » que pour le photovoltaique, seule filiere dont la
         * source distingue le sol de la toiture. Pour l'eolien et la methanisation, la question ne
         * se pose pas : une eolienne et un methaniseur sont au sol par nature, la deliberation est
         * donc precise par construction.
         */
        p['filiere'] === 'SOLAIRE_PV' &&
        implantationPv(typeof p['detail_filiere1'] === 'string' ? p['detail_filiere1'] : null) !==
          'sol'
          ? 'non'
          : 'oui',
      ]);
      nbObjets += 1;

      if (lot.length >= 500) await viderLot();
      if (nbObjets % 20000 === 0) journal.info({ nbObjets, nbSansFiliere }, 'ZAER ingerees');
    }
    await viderLot();
  } catch (err) {
    journal.error({ err }, "Échec de l'ingestion des ZAER");
    await enregistrerIngestion('zaer_local', 'echec', (err as Error).message, nbObjets);
    return {
      connecteur: 'zaer_local',
      nbObjets,
      nbSansGeometrie,
      nbSansFiliere,
      millesime: null,
      departements: departements ? [...departements] : null,
    };
  }

  /*
   * Zones retirees de la source : une deliberation annulee ou revisee ne doit pas survivre en base.
   *
   * L'EFFACEMENT EST INTERDIT SUR UNE INGESTION PARTIELLE. `effacerDisparus` supprime ce que la
   * pagination n'a pas revu. Sur une ingestion limitee au 28, « pas revu » comprend les zones de
   * tous les autres departements : l'effacement viderait la base a chaque ingestion departementale.
   * La pagination peut etre complete au sens du parcours — toutes les pages du FILTRE ont ete lues —
   * sans que le territoire le soit. Les deux notions sont distinctes et ne l'etaient pas.
   */
  const parcoursNational = !departements || departements.length === 0;
  const disparus = await effacerDisparus(
    { table: 'zaer', connecteur: 'zaer_local' },
    debutRun,
    pagination.complete && parcoursNational,
  );

  // Couverture PAR DEPARTEMENT : sans elle, `zaer()` ne peut pas distinguer « aucune ZAER ici » de
  // « ce departement n'a pas ete ingere », et le critere resterait gris malgre l'ingestion.
  const parDep = await requete<{ code_departement: string | null; n: number }>(
    `SELECT code_departement, count(*)::int AS n FROM zaer
      WHERE est_demonstration = false GROUP BY code_departement`,
  );
  for (const d of parDep) {
    if (d.code_departement) {
      await enregistrerCouverture('zaer_local', 'zaer', d.code_departement, d.n);
    }
  }
  oublierPresenceCouches();

  // Les vocabulaires non reconnus sont restitues UNE fois, avec leur decompte. Un changement de
  // vocabulaire cote source se voit ici, et nulle part ailleurs : sans cette ligne, des zones
  // disparaitraient en silence de l'ingestion suivante.
  const nonReconnus = vocabulairesInconnus();
  if (Object.keys(nonReconnus).length > 0) {
    journal.warn(
      { nonReconnus },
      'Vocabulaires de filière ZAER non reconnus : ces zones ont été ignorées plutôt que rangées par ' +
        'défaut. Compléter filieresZaer() si l’une de ces filières entre dans le périmètre.',
    );
  }

  await enregistrerIngestion(
    'zaer_local',
    nbObjets > 0 ? 'ok' : 'echec',
    `${nbObjets} zones retenues, ${nbSansFiliere} hors perimetre ou filiere non reconnue, ` +
      `${nbSansGeometrie} sans geometrie, ${parDep.length} departements couverts, ` +
      `${disparus.supprimes} disparues effacees (${disparus.motif})`,
    nbObjets,
  );
  return {
    connecteur: 'zaer_local',
    nbObjets,
    nbSansGeometrie,
    nbSansFiliere,
    millesime: null,
    departements: departements ? [...departements] : null,
  };
}

// ---------------------------------------------------------------------------
// Sites classes et inscrits
// ---------------------------------------------------------------------------

/**
 * Couches de sites, metropole et outre-mer.
 *
 * Les quatre sont ingerees : ne prendre que la metropole rendrait le critere faussement vert en
 * Guadeloupe, en Martinique, en Guyane et a La Reunion — la meme faute que celle corrigee ici, sur
 * un territoire plus petit.
 */
/**
 * La couche nationale du RPG sur la Geoplateforme.
 *
 * Le millesime fait partie du NOM de la couche, comme pour les sites proteges : il tournera, et
 * l'ingestion echouera alors franchement plutot que de rendre zero parcelle en silence. Le bilan
 * nomme la couche, ce qui rend le diagnostic immediat.
 */
const COUCHE_RPG =
  'IGNF_RPG_PARCELLES-AGRICOLES-CATEGORISEES_2024:parcelles_agricole_categorisees_2024';

const COUCHES_SITES = [
  'sites_metropole_gpkg_26-01-2026_wfs:STE_Metropole',
  'sites_guadeloupe_martinique_gpkg_26-01-2026_wfs:site_guadeloupe_martinique',
  'sites_guyane_gpkg_26-01-2026_wfs:STE_Guyane',
  'sites_reunion_gpkg_26-01-2026_wfs:STE_Reunion',
] as const;

/**
 * Traduit `typesite` en type de contrainte.
 *
 * Vocabulaire MESURE sur 400 objets reels : `Site inscrit` 256, `Site classe` 136,
 * `Patrimoine mondial` 4, `Grand Site de France` 3, `Projet Grand Site de France` 1.
 *
 * LES TROIS DERNIERS NE SONT PAS DES SITES PROTEGES au sens des articles L. 341-1 et L. 341-10 du
 * code de l'environnement : ce sont des LABELS. « Grand Site de France » est attribue a des
 * ensembles deja classes, « Patrimoine mondial » releve de l'UNESCO. Les ranger en `site_classe`
 * declencherait un knock-out eolien non derogeable sur un label sans portee reglementaire propre —
 * l'erreur symetrique de celle que cette ingestion corrige, et tout aussi grave.
 *
 * Retourne `null` sur toute valeur non reconnue : l'objet n'est alors pas ingere.
 */
export function typeSite(typesite: string | null | undefined): 'site_classe' | 'site_inscrit' | null {
  const t = (typesite ?? '')
    .trim()
    .toLowerCase()
    // Les libelles sont accentues dans la source (« Site classé ») : la comparaison se fait sur une
    // forme sans accent, faute de quoi une variation d'encodage suffirait a tout ecarter en silence.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (t === 'site classe') return 'site_classe';
  if (t === 'site inscrit') return 'site_inscrit';
  return null;
}

/**
 * Convertit une date francaise `JJ/MM/AAAA` en date ISO.
 *
 * `datecrea` vaut `10/12/1975` dans la source. Passee telle quelle a PostgreSQL, elle serait
 * interpretee selon le `DateStyle` du serveur : `10/12/1975` vaut le 10 decembre en francais et le
 * 12 octobre en anglais. Une date de classement fausse de deux mois n'a pas de consequence pratique,
 * mais une date qui change selon la configuration du serveur est un defaut de reproductibilite —
 * et le meme piege sur une date d'arrete de PPR en aurait une.
 */
export function dateFrancaiseEnIso(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(brut.trim());
  if (!m) return null;
  const [, jour, mois, annee] = m;
  return `${annee}-${mois}-${jour}`;
}

export async function ingererSitesProteges(): Promise<{
  connecteur: string;
  nbObjets: number;
  nbSansGeometrie: number;
  nbNonReconnus: number;
  millesime: string | null;
}> {
  let nbObjets = 0;
  let nbSansGeometrie = 0;
  let nbNonReconnus = 0;
  /**
   * Horodatage pris AVANT la premiere insertion, et completude de chacune des couches.
   *
   * Un seul drapeau ne suffit pas : les sites sont repartis sur plusieurs couches — metropole et
   * outre-mer — et l'ingestion doit etre complete sur TOUTES avant de s'autoriser a effacer, sans
   * quoi un echec sur la couche guadeloupeenne ferait supprimer les sites de Guadeloupe.
   */
  const debutRun = new Date();
  const paginations: EtatPagination[] = [];

  type Ligne = [string, string, string, string, string | null, string | null, string];
  const lot: Ligne[] = [];

  /**
   * UN SITE, PLUSIEURS PARTIES — defaut trouve a la premiere execution reelle.
   *
   * La source decoupe un site en autant de lignes que de parties geometriques, toutes portant le
   * MEME `idsup` : le site d'Alesia en compte 24, le Val Suzon 16. Mesure sur 1 500 objets :
   * 1 400 `idsup` distincts, donc 100 lignes surnumeraires, et 34 objets sans `idsup` du tout.
   *
   * PostgreSQL a refuse net : « ON CONFLICT DO UPDATE command cannot affect row a second time ». Le
   * reflexe serait de dedupliquer sur la cle — et ce serait une PERTE SILENCIEUSE de 23 parties du
   * site d'Alesia sur 24, exactement la classe de defaut que cette ingestion corrige.
   *
   * Un site protege est UN objet juridique. Ses parties se REUNISSENT :
   *   - `ST_Collect` dans le lot regroupe les parties presentes dans la meme page ;
   *   - `ST_Union` sur conflit fusionne avec les parties deja inserees par une page precedente.
   * L'operation est associative et idempotente : reunir un site avec l'une de ses propres parties le
   * laisse inchange, donc une seconde ingestion ne modifie rien.
   */
  const viderLot = async (): Promise<void> => {
    if (lot.length === 0) return;
    await requete(
      `INSERT INTO contrainte
         (type, sous_type, nom, identifiant_source, geom, date_donnee, attributs, connecteur,
          code_departement)
       SELECT d.type, d.type,
              min(d.nom), d.identifiant,
              ST_Multi(ST_UnaryUnion(ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(d.geom), 4326)))),
              min(d.date_donnee)::date, min(d.attributs)::jsonb, 'patrimoine_sites', min(d.dep)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS d(type, nom, identifiant, geom, date_donnee, dep, attributs)
        GROUP BY d.type, d.identifiant
       ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
         sous_type = EXCLUDED.sous_type,
         nom = EXCLUDED.nom,
         -- Reunion et non remplacement : les parties d'un meme site arrivent sur plusieurs pages.
         geom = ST_Multi(ST_UnaryUnion(ST_Collect(contrainte.geom, EXCLUDED.geom))),
         date_donnee = EXCLUDED.date_donnee,
         attributs = EXCLUDED.attributs,
         code_departement = EXCLUDED.code_departement,
         -- Voir audit 9, defaut D1 : sans cette ligne, rien ne distingue un objet revu d'un objet
         -- disparu de la source.
         updated_at = now()`,
      [
        lot.map((l) => l[0]),
        lot.map((l) => l[1]),
        lot.map((l) => l[2]),
        lot.map((l) => l[3]),
        lot.map((l) => l[4]),
        lot.map((l) => l[5]),
        lot.map((l) => l[6]),
      ],
    );
    lot.length = 0;
  };

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * UNE COUCHE EN ECHEC N'EMPORTE PLUS LES AUTRES — defaut MESURE le 26/09/2026
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * CE QUI S'EST PASSE. La couche Guadeloupe-Martinique a rendu 400. Le `try` englobait la boucle
   * entiere : le `catch` a donc rendu la main AVANT l'etape de couverture, alors que la couche
   * METROPOLE etait deja entierement ingeree. Resultat mesure : **6 617 sites classes et inscrits
   * ecrits dans `contrainte`, et ZERO ligne de couverture**. Or `patrimoine()` interroge la
   * couverture, pas la table : pour le moteur, la couche n'existait toujours pas. Les criteres
   * `pat_sites` sont restes gris sur les 301 parcelles, avec la donnee en base.
   *
   * ET LE JOURNAL DISAIT « Ingestion terminee, 7 634 objets ». L'exploitant n'avait aucune raison
   * de soupconner que rien n'etait exploitable.
   *
   * POURQUOI CELA SE REPRODUIRA. Le nom de la couche fautive porte une DATE —
   * `sites_guadeloupe_martinique_gpkg_26-01-2026_wfs` — que le fournisseur fait tourner. Chaque
   * rotation d'un millesime outre-mer desactivait donc silencieusement la metropole entiere.
   *
   * CHAQUE COUCHE EST DESORMAIS ISOLEE. Ce qui a ete lu est conserve, la couverture est enregistree
   * pour ce qui est arrive, et les echecs sont NOMMES dans le bilan. L'effacement des disparus,
   * lui, reste interdit des qu'une pagination est incomplete : on ne supprime jamais sur une
   * lecture partielle.
   */
  const couchesEnEchec: Array<{ couche: string; message: string }> = [];

  for (const couche of COUCHES_SITES) {
    try {
      const pagination: EtatPagination = { complete: false };
      paginations.push(pagination);
      for await (const entite of objetsWfs(couche, pagination)) {
        const p = entite.properties ?? {};
        const g = entite.geometry;
        if (!g || typeof g !== 'object') {
          nbSansGeometrie += 1;
          continue;
        }
        const type = typeSite(typeof p['typesite'] === 'string' ? p['typesite'] : null);
        if (!type) {
          // Label sans portee reglementaire propre, ou valeur inconnue : non ingere.
          nbNonReconnus += 1;
          continue;
        }

        const idsup = typeof p['idsup'] === 'string' && p['idsup'] !== '' ? p['idsup'] : null;
        /**
         * LE DEPARTEMENT NE SE LIT PAS DANS `idsup` — defaut trouve par verification apres ingestion.
         *
         * Premiere ecriture : `idsup.split('-')[1].slice(0, 2)`, en supposant que le segment central
         * de `AC2-130010002-447` commencait par le code departement. Il n'en est rien : `130010002`
         * est un identifiant NATIONAL de servitude, et ses deux premiers caracteres valent `13` pour
         * tout le pays. Les 6 617 sites ingeres se sont donc retrouves tous dans le departement 13.
         *
         * La consequence aurait annule tout l'interet de la correction : `patrimoine()` filtre la
         * couverture PAR DEPARTEMENT, donc seules les parcelles des Bouches-du-Rhone auraient vu les
         * sites, et les 95 autres departements auraient continue d'afficher un critere gris — ou,
         * pire, une absence constatee si la couverture avait ete enregistree nationalement.
         *
         * Le departement est donc laisse a `null` ici et deduit APRES insertion par jointure spatiale
         * sur la table `commune`, qui est la seule source fiable. Un site dont le departement reste
         * inconnu n'est pas compte dans la couverture : il vaut mieux un critere gris qu'une
         * couverture fausse.
         */
        const dep = null;

        /**
         * Cle de repli pour les 2,3 % d'objets sans `idsup`.
         *
         * Un compteur (`${type}-${nbObjets}`) etait la premiere ecriture, et il est NON IDEMPOTENT :
         * l'ordre de parcours du WFS n'est pas garanti stable, donc une seconde ingestion aurait
         * cree des doublons sous d'autres cles. Une empreinte de la geometrie l'est : le meme objet
         * produit toujours la meme cle, et deux objets distincts n'entrent pas en collision.
         */
        const cle = idsup ?? `sans-idsup-${empreinte(JSON.stringify(g))}`;

        lot.push([
          type,
          String(p['nomgen'] ?? idsup ?? 'sans nom').slice(0, 300),
          `${couche}/${cle}`,
          JSON.stringify(g),
          dateFrancaiseEnIso(p['datecrea']),
          dep,
          JSON.stringify({
            idsup,
            typeSource: p['typesite'] ?? null,
            gestionnaire: p['gestnom'] ?? null,
            // `surfdclha` porte des valeurs incoherentes avec son nom (12 613 pour une parcelle
            // insulaire) : conservee brute a titre documentaire, jamais utilisee dans un calcul.
            surfaceDeclareeSource: p['surfdclha'] ?? null,
            description: p['descrip'] ?? null,
          }),
        ]);
        nbObjets += 1;
        if (lot.length >= 500) await viderLot();
      }
      journal.info({ couche, nbObjets }, 'Couche de sites ingérée');
      await viderLot();
    } catch (err) {
      /*
       * LE LOT EST VIDE AVANT DE PASSER A LA SUITE. Sans cela, les objets d'une couche interrompue
       * resteraient en memoire et seraient ecrits avec ceux de la couche suivante — ou perdus.
       */
      await viderLot().catch(() => undefined);
      couchesEnEchec.push({ couche, message: (err as Error).message });
      journal.error({ err, couche }, "Échec d'une couche de sites : les autres continuent");
    }
  }

  /**
   * Rattachement geographique des sites a leur departement.
   *
   * Par jointure spatiale sur `commune`, seule source fiable (voir le commentaire sur `dep`
   * ci-dessus). Le centroide suffit : un site a cheval sur deux departements est rattache a celui de
   * son centre, ce qui n'a aucune consequence — la couverture sert a savoir si le SECTEUR a ete
   * regarde, et les deux departements le sont des lors que la couche nationale est ingeree.
   *
   * Si la table `commune` est vide, aucun rattachement n'est possible : la couverture ne sera pas
   * enregistree, `patrimoine()` retournera `null`, et le critere restera gris. C'est le bon
   * comportement — et il faut le DIRE, sans quoi l'exploitant croirait l'ingestion complete.
   */
  const communes = await requete<{ n: number }>(`SELECT count(*)::int AS n FROM commune`);
  if ((communes[0]?.n ?? 0) === 0) {
    journal.warn(
      { nbObjets },
      'Sites ingérés mais table `commune` vide : impossible de les rattacher à un département, donc ' +
        'aucune couverture enregistrée et critère patrimonial toujours gris. Lancer ' +
        '`npm run ingest -- communes` puis relancer cette ingestion.',
    );
  } else {
    const rattaches = await requete<{ n: number }>(
      `WITH maj AS (
         UPDATE contrainte c
            SET code_departement = com.code_departement
           FROM commune com
          WHERE c.connecteur = 'patrimoine_sites'
            AND ST_Intersects(com.geom, ST_Centroid(c.geom))
          RETURNING 1
       )
       SELECT count(*)::int AS n FROM maj`,
    );
    journal.info(
      { rattaches: rattaches[0]?.n ?? 0, total: nbObjets },
      'Sites rattaches à leur département par jointure spatiale',
    );
  }

  /**
   * Sites retires de la source : un declassement doit disparaitre de la base.
   *
   * La condition est exigeante a dessein : toutes les couches doivent avoir ete lues jusqu'a leur
   * derniere page. Une seule interruption suffit a interdire la suppression.
   */
  const disparus = await effacerDisparus(
    { table: 'contrainte', connecteur: 'patrimoine_sites' },
    debutRun,
    paginations.length === COUCHES_SITES.length && paginations.every((p) => p.complete),
  );

  /**
   * Couverture PAR DEPARTEMENT ET PAR TYPE.
   *
   * Par TYPE et non seulement par departement : c'est ce qui manquait a l'audit 8. `patrimoine()`
   * interroge la couverture type par type, et un departement ou seuls des sites inscrits existent ne
   * doit pas laisser affirmer l'absence de site classe.
   */
  const parDepEtType = await requete<{ code_departement: string | null; type: string; n: number }>(
    `SELECT code_departement, type, count(*)::int AS n FROM contrainte
      WHERE connecteur = 'patrimoine_sites' GROUP BY code_departement, type`,
  );
  for (const d of parDepEtType) {
    if (d.code_departement) {
      await enregistrerCouverture('patrimoine_sites', d.type, d.code_departement, d.n);
    }
  }
  oublierPresenceCouches();

  /*
   * LE BILAN NOMME LES COUCHES EN ECHEC. « ok » sur une ingestion dont une couche sur quatre n'a
   * rien rendu est un mensonge par omission : c'est precisement ce que disait le journal le jour ou
   * 6 617 sites sont restes invisibles. L'etat devient « partiel », et les couches fautives sont
   * ecrites en clair — leur nom porte un millesime que le fournisseur fait tourner, donc la
   * prochaine panne ressemblera a celle-ci et doit se diagnostiquer en une ligne.
   */
  const etat = nbObjets === 0 ? 'echec' : couchesEnEchec.length > 0 ? 'partiel' : 'ok';
  if (couchesEnEchec.length > 0) {
    journal.warn(
      { couchesEnEchec, nbObjets, couples: parDepEtType.length },
      'Ingestion des sites PARTIELLE : les couches lues sont exploitables, les autres non',
    );
  }
  await enregistrerIngestion(
    'patrimoine_sites',
    etat,
    `${nbObjets} sites classes et inscrits, ${nbNonReconnus} labels ou types non reconnus ecartes, ` +
      `${nbSansGeometrie} sans geometrie, ${parDepEtType.length} couples departement/type couverts, ` +
      `${disparus.supprimes} disparus effaces (${disparus.motif})` +
      (couchesEnEchec.length > 0
        ? `. COUCHES EN ECHEC : ${couchesEnEchec.map((c) => `${c.couche} (${c.message.slice(0, 120)})`).join(' ; ')}`
        : ''),
    nbObjets,
  );
  return { connecteur: 'patrimoine_sites', nbObjets, nbSansGeometrie, nbNonReconnus, millesime: null };
}

// ---------------------------------------------------------------------------
// Surface agricole par commune, depuis le RPG
// ---------------------------------------------------------------------------

/**
 * Ce run a-t-il relu EN ENTIER tous les departements qui portent des lignes en base ?
 *
 * Fonction PURE, exportee pour etre testee, et c'est justifie : c'est la condition qui autorise une
 * SUPPRESSION. Le perimetre d'`effacerDisparus` est le connecteur, pas le departement, alors que ce
 * job s'execute departement par departement — lui declarer un parcours complet apres avoir ingere le
 * seul 28 ferait passer pour disparues les communes du 41, du 45 et du 91, ingerees la veille et
 * parfaitement valides.
 *
 * Un departement en base dont le code est `null` interdit la suppression : on ne peut pas affirmer
 * l'avoir relu.
 */
export function tousDepartementsRelus(
  depsEnBase: readonly (string | null)[],
  depsComplets: readonly string[],
  parcoursComplet: boolean,
): boolean {
  if (!parcoursComplet) return false;
  return depsEnBase.every((d) => d != null && depsComplets.includes(d));
}

/**
 * Identifiant stable d'une parcelle RPG, ou `null` si la source n'en porte aucun.
 *
 * `iup` est l'identifiant unique de la parcelle au RPG — un UUID, verifie sur la source le
 * 27/09/2026. Le repli sur pacage/ilot/parcelle couvre un millesime qui cesserait de l'exposer :
 * le triplet identifie la parcelle dans la declaration de son exploitant.
 *
 * RETOURNE `null` PLUTOT QU'UNE CHAINE VIDE OU CONSTANTE. Une cle constante ferait s'effondrer
 * toutes les parcelles sans identifiant sur une seule ligne : au lieu d'un doublon possible, on
 * perdrait des milliers d'hectares reels. L'appelant est ainsi force de fabriquer une cle unique.
 */
export function cleParcelleRpg(proprietes: Record<string, unknown>): string | null {
  const iup = proprietes['iup'];
  if (typeof iup === 'string' && iup.length > 0) return iup;
  const pacage = proprietes['pacage'];
  if (typeof pacage === 'string' && pacage.length > 0) {
    const ilot = proprietes['num_ilot'];
    const parcel = proprietes['num_parcel'];
    if (ilot != null && parcel != null) return `${pacage}/${String(ilot)}/${String(parcel)}`;
  }
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE REGISTRE PARCELLAIRE GRAPHIQUE, AGREGE PAR COMMUNE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE JOB EXISTE. Le connecteur de gisement sait estimer les intrants methanisables et le
 * debouche d'epandage depuis TROIS couches — elevages, industries agroalimentaires, surfaces
 * agricoles communales. Toute la machinerie est ecrite, testee, et attend depuis l'audit 8. Aucune
 * des trois n'etait ingeree. Consequence mesuree le 26/09/2026 : `gis_intrants` (16,5 % du poids de
 * la methanisation, son critere ROI) et `gis_debouche_epandage` (7,3 %) gris sur les 301 parcelles.
 *
 * CETTE COUCHE-CI DEBLOQUE L'EPANDAGE A ELLE SEULE — le connecteur distingue l'etat de chaque
 * couche, et `surfacesEpandageHa` ne depend que de celle-ci. Elle est aussi l'un des trois termes
 * du total d'intrants, qui reste `null` tant que les trois ne sont pas la : un total partiel serait
 * une borne inferieure presentee comme une estimation.
 *
 * ═══ POURQUOI PAR DEPARTEMENT, ET NON EN UNE FOIS
 *
 * Le RPG national porte environ neuf millions de parcelles. Mesure sur l'emprise du departement 28 :
 * 49 643 parcelles, 5,7 Mo et 20 s par page de 5 000. Un departement demande donc quelques minutes ;
 * la France entiere demanderait une journee et personne ne l'attendrait. La forme `job:departements`
 * existe deja pour exactement cette raison (voir `ingerer.ts`).
 *
 * ═══ POURQUOI UN BBOX ET NON UN FILTRE
 *
 * Le RPG ne porte NI code commune NI code departement dans ses attributs — seulement un numero de
 * pacage, la culture, et la surface administrative. La commune ne peut donc etre determinee que
 * GEOGRAPHIQUEMENT, par jointure avec la table `commune`. C'est aussi pourquoi les geometries sont
 * telechargees : sans elles, aucune parcelle n'est attribuable.
 *
 * ═══ LES PARCELLES DEBORDANTES SONT ECARTEES, ET C'EST LE POINT DELICAT DE CE JOB
 *
 * L'emprise rectangulaire d'un departement deborde largement sur ses voisins. Ma premiere version
 * rattachait les parcelles debordantes a leur vraie commune, en se disant qu'une surface agricole
 * ne s'arrete pas a une limite administrative. C'ETAIT FAUX, et d'une facon qui ne se serait jamais
 * vue : une commune voisine A CHEVAL sur le bord du rectangle n'aurait ete lue qu'en PARTIE — ses
 * parcelles hors rectangle n'etant jamais telechargees — et la somme obtenue, un SOUS-COMPTE, se
 * serait presentee comme une mesure. Un total d'hectares trop bas ne ressemble pas a une erreur : il
 * ressemble a une commune peu agricole.
 *
 * Seules les communes des departements DEMANDES sont donc retenues : l'emprise les contient
 * entierement, donc chacune est lue en entier. Une parcelle tombant dans un departement non demande
 * est comptee a part et jetee.
 *
 * ═══ ET LA FRONTIERE, ALORS ?
 *
 * Le rayon de 10 km du connecteur franchit bien les frontieres, et une parcelle du 28 proche du 45
 * doit voir les surfaces du 45. La reponse n'est pas de ramasser un bout de 45 au passage : c'est
 * `disqueEntierementCouvert`, qui laisse le critere GRIS tant que tous les departements traverses
 * par le disque ne sont pas ingeres (audit 9, defaut A3). Pour rendre un departement reellement
 * exploitable, il faut donc l'ingerer AVEC SES VOISINS — ce que la forme `rpg_communal:28,45,41`
 * permet en une commande.
 */
export async function ingererRpgCommunal(departements?: readonly string[]): Promise<{
  connecteur: string;
  nbParcelles: number;
  nbCommunes: number;
  nbHorsDepartements: number;
  departements: string[] | null;
}> {
  const deps = departements && departements.length > 0 ? [...departements] : null;
  if (!deps) {
    /*
     * REFUS EXPLICITE PLUTOT QUE NEUF MILLIONS DE PARCELLES. Un job qui accepterait « tout » ici
     * tournerait une journee avant de rendre quoi que ce soit, et serait interrompu — laissant une
     * couverture partielle qui se croit complete. Mieux vaut le dire.
     */
    await enregistrerIngestion(
      'rpg_communal',
      'echec',
      'Ce job exige des departements : le RPG national porte environ 9 millions de parcelles. ' +
        'Utilisez `npm run ingest -- rpg_communal:28,45`.',
      0,
    );
    return {
      connecteur: 'rpg_communal',
      nbParcelles: 0,
      nbCommunes: 0,
      nbHorsDepartements: 0,
      departements: null,
    };
  }

  let nbParcelles = 0;
  let nbSansGeometrie = 0;
  let nbHorsDepartement = 0;
  let nbCommunes = 0;
  /*
   * UN DEPARTEMENT EST TRAITE DE BOUT EN BOUT AVANT LE SUIVANT, et la table temporaire est videe
   * entre les deux. CE N'EST PAS UN DETAIL D'ORGANISATION, c'est la correction d'un faux compte.
   *
   * Ma premiere version accumulait les trois departements dans une seule table avant d'agreger. Or
   * les emprises RECTANGULAIRES de deux departements voisins se recouvrent largement : une parcelle
   * du Loir-et-Cher proche du Loiret est telechargee DEUX fois, une fois par emprise, et se
   * retrouvait donc deux fois dans la table. La commune la comptait deux fois.
   *
   * MESURE QUI L'A REVELE — et c'est la seule raison pour laquelle le defaut a ete vu : la somme
   * obtenue depassait la surface agricole utile REELLE du departement. Le RPG ne recense que les
   * surfaces declarees a la PAC : il est necessairement INFERIEUR a la SAU. Un total superieur est
   * donc impossible, et signale un double compte. Mesure sur le lot 41/45/91 : 302 885 ha pour le
   * Loir-et-Cher (SAU reelle 245 000), 454 247 pour le Loiret (340 000), 93 673 pour l'Essonne
   * (78 000) — de 20 a 34 % de trop. Le departement 28, ingere seul, donnait 439 950 ha pour une SAU
   * de 460 000 : sous la borne, donc juste. Aucun message d'erreur nulle part.
   *
   * Traiter un departement a la fois rend le double compte STRUCTURELLEMENT impossible : la seule
   * emprise presente en table est la sienne, et l'agregation ne retient que ses propres communes.
   */
  const depsComplets: string[] = [];
  /* Pris AVANT la premiere insertion : toute ligne plus ancienne n'a pas ete revue par ce run. */
  const debutRun = new Date();

  /*
   * UNE TABLE TEMPORAIRE, et non une insertion par parcelle. Des dizaines de milliers d'allers-
   * retours SQL par departement couteraient plus que le telechargement lui-meme. Les centroides y
   * sont deverses par lots, puis UNE seule requete fait la jointure spatiale et l'agregation.
   */
  await requete(
    `CREATE TEMP TABLE IF NOT EXISTS rpg_tmp (
       cle text PRIMARY KEY, lon float8, lat float8, surface_ha numeric)`,
  );

  /*
   * LA CLE NATURELLE EST INDISPENSABLE ICI, ET ELLE NE L'EST PAS AILLEURS.
   *
   * `objetsWfs` rejoue une page entiere quand le flux se coupe en cours de route, et le dit dans le
   * journal : « des objets ont deja ete emis, les reemettre est sans consequence, l'insertion est
   * idempotente sur la cle naturelle ». C'est vrai de toutes les autres ingestions, qui ECRIVENT un
   * objet par ligne sous une cle. Ce job-ci SOMME — et une somme n'est pas idempotente. Une coupure
   * a la septieme page du Loiret (observee le 27/09/2026 : 3 484 objets deja emis) ajoutait donc
   * 3 484 parcelles en double aux hectares de leurs communes, sans qu'aucun compteur ne bouge.
   *
   * `iup` est l'identifiant unique de la parcelle dans le RPG — un UUID, verifie sur la source. Le
   * repli sur pacage/ilot/parcelle couvre un millesime qui cesserait de l'exposer ; le repli final
   * sur un compteur garantit qu'une parcelle sans aucun identifiant est COMPTEE plutot que perdue,
   * quitte a risquer le doublon qu'elle seule pourrait causer.
   */
  let sansIdentifiant = 0;
  const cleDe = (p: Record<string, unknown>): string => {
    const cle = cleParcelleRpg(p);
    if (cle !== null) return cle;
    sansIdentifiant += 1;
    return `sans-id:${sansIdentifiant}`;
  };

  const lot: Array<[string, number, number, number]> = [];
  /*
   * Les cles DEJA dans le lot courant. `ON CONFLICT` ne tranche que les conflits avec ce qui est
   * deja EN TABLE : deux lignes de meme cle dans un meme `INSERT` font echouer l'insertion entiere.
   */
  const clesDuLot = new Set<string>();
  const viderLot = async (): Promise<void> => {
    if (lot.length === 0) return;
    await requete(
      `INSERT INTO rpg_tmp (cle, lon, lat, surface_ha)
       SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[], $4::numeric[])
       ON CONFLICT (cle) DO NOTHING`,
      [lot.map((l) => l[0]), lot.map((l) => l[1]), lot.map((l) => l[2]), lot.map((l) => l[3])],
    );
    lot.length = 0;
    clesDuLot.clear();
  };

  for (const dep of deps) {
    const [emprise] = await requete<{ lat_min: number; lon_min: number; lat_max: number; lon_max: number }>(
      `SELECT ST_YMin(e) AS lat_min, ST_XMin(e) AS lon_min, ST_YMax(e) AS lat_max, ST_XMax(e) AS lon_max
         FROM (SELECT ST_Extent(geom) AS e FROM commune WHERE code_departement = $1) t`,
      [dep],
    );
    if (!emprise || emprise.lat_min == null) {
      journal.warn({ dep }, 'Departement inconnu de la table `commune` : RPG non ingere pour lui');
      continue;
    }

    await requete(`TRUNCATE rpg_tmp`);
    lot.length = 0;
    clesDuLot.clear();
    const pagination: EtatPagination = { complete: false };
    // WFS 2.0 en EPSG:4326 : l'ordre des axes est lat,lon. Verifie a l'execution — l'ordre lon,lat
    // rend « numberMatched=0 » sans erreur, ce qui se lirait comme un departement sans agriculture.
    const bbox = `${emprise.lat_min},${emprise.lon_min},${emprise.lat_max},${emprise.lon_max}`;

    for await (const entite of objetsWfs(COUCHE_RPG, pagination, undefined, { BBOX: bbox })) {
      const p = entite.properties ?? {};
      const g = entite.geometry;
      if (!g || typeof g !== 'object') {
        nbSansGeometrie += 1;
        continue;
      }
      // `sf_adm_co` : surface administrative constatee, en hectares. `sf_adm_de` est la surface
      // DECLAREE ; la constatee est celle que l'administration retient.
      const surface = Number(p['sf_adm_co'] ?? p['sf_adm_de']);
      if (!Number.isFinite(surface) || surface <= 0) continue;

      const c = centroideDe(g as Parameters<typeof centroideDe>[0]);
      if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
        nbSansGeometrie += 1;
        continue;
      }
      nbParcelles += 1;
      const cle = cleDe(p);
      if (!clesDuLot.has(cle)) {
        clesDuLot.add(cle);
        lot.push([cle, c[0], c[1], surface]);
      }
      if (lot.length >= 5000) await viderLot();
      if (nbParcelles % 20000 === 0) journal.info({ nbParcelles, dep }, 'Parcelles RPG lues');
    }
    await viderLot();

    /*
     * LE COMPTE DU DEPARTEMENT SE LIT EN TABLE, et non sur les objets recus : c'est le nombre de
     * parcelles DISTINCTES retenues, une fois les doublons de page rejouee ecartes. Le compter a la
     * reception rendrait `nbHorsDepartement` faux du nombre de doublons.
     */
    const [compte] = await requete<{ n: number }>(`SELECT count(*)::int AS n FROM rpg_tmp`);
    const luesIci = compte?.n ?? 0;

    /*
     * LA JOINTURE SPATIALE, EN UNE REQUETE, ET SEULEMENT SUR LES COMMUNES DE CE DEPARTEMENT.
     *
     * Le centroide rattache une parcelle a une seule commune : une parcelle a cheval est comptee
     * dans celle de son centre. MESURE DE L'ECART QUE CELA PRODUIT, sur les 1 123 communes des
     * departements 28, 41, 45 et 91 : deux communes depassent leur propre superficie, de 1 et 2 %.
     * C'est la borne de l'erreur, et elle est sans consequence a l'echelle d'un rayon de 10 km. Ce
     * controle est aussi le meilleur detecteur de double compte disponible — une commune ne peut pas
     * porter plus d'hectares agricoles qu'elle n'a d'hectares — et c'est lui qui a confirme que la
     * correction du doublon avait pris : avant elle, le Loiret affichait 67 % de surface agricole
     * pour une realite de 55 %. Les
     * parcelles tombant hors du departement demande — le debordement de l'emprise rectangulaire sur
     * les voisins — sont ECARTEES : leur commune n'aurait ete lue qu'en partie (voir l'en-tete).
     */
    const agregats = await requete<{ code_insee: string; surface_ha: string; n: number }>(
      `SELECT c.code_insee, round(sum(t.surface_ha), 1)::text AS surface_ha, count(*)::int AS n
         FROM rpg_tmp t
         JOIN commune c ON ST_Contains(c.geom, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326))
        WHERE c.code_departement = $1
        GROUP BY c.code_insee`,
      [dep],
    );
    nbHorsDepartement += luesIci - agregats.reduce((t, a) => t + a.n, 0);

    for (const a of agregats) {
      await requete(
        `INSERT INTO contrainte
           (type, sous_type, nom, identifiant_source, geom, attributs, connecteur, code_departement,
            date_donnee)
         SELECT 'surface_agricole_commune', NULL,
                'Surface agricole déclarée - ' || c.nom, c.code_insee,
                ST_Centroid(c.geom), jsonb_build_object('surface_ha', $2::numeric, 'nb_parcelles', $3::int),
                'rpg_communal', c.code_departement, current_date
           FROM commune c WHERE c.code_insee = $1
         ON CONFLICT (connecteur, type, identifiant_source) DO UPDATE SET
           attributs = EXCLUDED.attributs,
           geom = EXCLUDED.geom,
           nom = EXCLUDED.nom,
           code_departement = EXCLUDED.code_departement,
           date_donnee = EXCLUDED.date_donnee,
           updated_at = now()`,
        [a.code_insee, a.surface_ha, a.n],
      );
    }

    /*
     * UN DEPARTEMENT N'EST DECLARE COUVERT QUE SI SA PAGINATION EST ALLEE AU BOUT. Une lecture
     * interrompue laisserait des communes lues a moitie — et le connecteur lirait leur somme
     * partielle comme un constat de terrain, ce qui est precisement le defaut que ce fichier
     * combat partout ailleurs.
     *
     * La couverture se declare pour le departement DEMANDE, meme a zero commune : une ligne a zero
     * signifie « on a regarde ici, il n'y a rien » et non « jamais regarde » (voir `couches.ts`).
     * Sans cela, un departement sans agriculture declaree resterait gris pour toujours.
     */
    if (pagination.complete) {
      await enregistrerCouverture('rpg_communal', 'surface_agricole_commune', dep, agregats.length);
      depsComplets.push(dep);
      nbCommunes += agregats.length;
    } else {
      journal.warn(
        { dep, luesIci },
        'Pagination RPG interrompue : aucune couverture declaree pour ce departement',
      );
    }
    journal.info({ dep, luesIci, communes: agregats.length }, 'Departement RPG termine');
  }
  await requete(`TRUNCATE rpg_tmp`);
  const complete = depsComplets.length === deps.length;
  if (depsComplets.length > 0) oublierPresenceCouches();

  /**
   * EFFACEMENT DES COMMUNES DISPARUES — sous une condition que les autres ingestions n'ont pas.
   *
   * Le perimetre d'`effacerDisparus` est le CONNECTEUR, pas le departement : il regarde toutes les
   * lignes `rpg_communal` de la table. Or ce job s'execute departement par departement. Lui
   * declarer un parcours « complet » apres avoir ingere le seul 28 ferait passer pour disparues
   * toutes les communes du 41, du 45 et du 91 — ingerees la veille, parfaitement valides, et
   * simplement pas regardees aujourd'hui.
   *
   * Le garde-fou de proportion les sauverait probablement, mais compter dessus serait s'en remettre
   * au hasard des volumes : sur une base ou le 28 pese la majorite des lignes, la suppression
   * passerait. La condition est donc explicite — on n'efface que si ce run a lu EN ENTIER tous les
   * departements qui portent des lignes.
   */
  const depsEnBase = await requete<{ code_departement: string | null }>(
    `SELECT DISTINCT code_departement FROM contrainte WHERE connecteur = 'rpg_communal'`,
  );
  const tousRelus = tousDepartementsRelus(
    depsEnBase.map((d) => d.code_departement),
    depsComplets,
    complete,
  );
  const disparus = await effacerDisparus(
    { table: 'contrainte', connecteur: 'rpg_communal' },
    debutRun,
    tousRelus,
  );
  if (disparus.supprimes > 0) {
    journal.info({ supprimes: disparus.supprimes, motif: disparus.motif }, 'Communes RPG disparues effacees');
  }

  await enregistrerIngestion(
    'rpg_communal',
    nbParcelles === 0 ? 'echec' : complete ? 'ok' : 'partiel',
    `${nbParcelles} parcelles RPG lues sur l'emprise de ${deps.length} departement(s), ` +
      `${nbCommunes} commune(s) renseignee(s), ${nbHorsDepartement} parcelle(s) ecartee(s) comme ` +
      `debordant hors des departements demandes, ${nbSansGeometrie} sans geometrie exploitable` +
      (complete
        ? ''
        : ` — COUVERTURE DECLAREE POUR ${depsComplets.length} DEPARTEMENT(S) SEULEMENT : ` +
          `${deps.filter((d) => !depsComplets.includes(d)).join(', ')} n'ont pas ete lus en entier`),
    nbParcelles,
  );

  return {
    connecteur: 'rpg_communal',
    nbParcelles,
    nbCommunes,
    nbHorsDepartements: nbHorsDepartement,
    departements: deps,
  };
}
