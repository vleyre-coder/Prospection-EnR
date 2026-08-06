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
import { avecParams } from '../http.js';
import { enregistrerCouverture, enregistrerIngestion } from '../depots/sources.js';
import { oublierPresenceCouches } from '../connecteurs/couches.js';
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
 * Attentes entre deux tentatives, en millisecondes.
 *
 * Calibrees sur le comportement REEL du service, et non sur une progression theorique. Un 503 signale
 * une surcharge, pas une erreur de requete : il demande d'attendre, et sept secondes ne sont pas une
 * attente. La derniere tentative intervient donc apres plus de trois minutes cumulees, ce qui est
 * negligeable devant une ingestion d'une heure et evite de jeter tout le travail.
 */
const ATTENTES_MS = [5_000, 15_000, 45_000, 120_000] as const;

/** Respiration entre deux pages, pour ne pas provoquer la surcharge qu'on devrait ensuite absorber. */
const PAUSE_ENTRE_PAGES_MS = 400;

interface Entite {
  properties: Record<string, unknown> | null;
  geometry: unknown;
}

/**
 * Parcourt une couche WFS page par page, en GeoJSON.
 *
 * La pagination est verifiee a chaque tour : une page qui renvoie moins que la taille demandee est
 * la derniere. On ne se fie PAS a `numberMatched`, qui n'est pas toujours renseigne sur ce service.
 */
async function* objetsWfs(typeName: string): AsyncGenerator<Entite> {
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
          'Page WFS en echec : nouvelle tentative apres attente',
        );
        await new Promise((r) => setTimeout(r, attente));
      }
    }
    if (derniereErreur) throw derniereErreur;

    journal.debug({ typeName, page, recus }, 'Page WFS ingeree');
    if (recus < TAILLE_PAGE) return;

    // Respiration entre les pages. Sans elle, une couche de 218 pages est demandee aussi vite que le
    // reseau le permet, ce qui declenche precisement les 503 que la reprise doit ensuite absorber.
    // Mieux vaut ne pas les provoquer.
    await new Promise((r) => setTimeout(r, PAUSE_ENTRE_PAGES_MS));
  }
  // Sortir par la borne de pages est une anomalie : la dire, plutot que produire un jeu tronque
  // qu'on prendrait pour complet.
  journal.warn(
    { typeName, pagesMax: PAGES_MAX },
    'Pagination WFS interrompue par la borne de securite : le jeu ingere est peut-etre incomplet',
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
      // LE PIEGE PRINCIPAL. 68 % des ZAER photovoltaiques echantillonnees sont des TOITURES.
      return DETAILS_PV_AU_SOL.has(d) ? ['solaire_sol'] : [];
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

export async function ingererZaer(): Promise<{
  connecteur: string;
  nbObjets: number;
  nbSansGeometrie: number;
  nbSansFiliere: number;
  millesime: string | null;
}> {
  let nbObjets = 0;
  let nbSansGeometrie = 0;
  let nbSansFiliere = 0;
  oublierVocabulairesInconnus();

  // Les filieres sont portees par une CHAINE et non un tableau : voir le commentaire dans la requete.
  type Ligne = [string, string | null, string | null, string, string, string | null, string];
  const lot: Ligne[] = [];

  const viderLot = async (): Promise<void> => {
    if (lot.length === 0) return;
    await requete(
      `INSERT INTO zaer
         (identifiant_source, code_insee, code_departement, filieres, geom, date_deliberation,
          attributs, source_document, est_demonstration)
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
              d.valid_date::date, d.attributs::jsonb, 'WFS Geoplateforme zaer:zaer', false
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS d(identifiant, insee, dep, filieres, geom, valid_date, attributs)
       ON CONFLICT (identifiant_source) WHERE identifiant_source IS NOT NULL DO UPDATE SET
         code_insee = EXCLUDED.code_insee,
         code_departement = EXCLUDED.code_departement,
         filieres = EXCLUDED.filieres,
         geom = EXCLUDED.geom,
         date_deliberation = EXCLUDED.date_deliberation,
         attributs = EXCLUDED.attributs`,
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

  try {
    for await (const entite of objetsWfs(COUCHE_ZAER)) {
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
      ]);
      nbObjets += 1;

      if (lot.length >= 500) await viderLot();
      if (nbObjets % 20000 === 0) journal.info({ nbObjets, nbSansFiliere }, 'ZAER ingerees');
    }
    await viderLot();
  } catch (err) {
    journal.error({ err }, "Echec de l'ingestion des ZAER");
    await enregistrerIngestion('zaer_local', 'echec', (err as Error).message, nbObjets);
    return { connecteur: 'zaer_local', nbObjets, nbSansGeometrie, nbSansFiliere, millesime: null };
  }

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
      'Vocabulaires de filiere ZAER non reconnus : ces zones ont ete ignorees plutot que rangees par ' +
        'defaut. Completer filieresZaer() si l’une de ces filieres entre dans le perimetre.',
    );
  }

  await enregistrerIngestion(
    'zaer_local',
    nbObjets > 0 ? 'ok' : 'echec',
    `${nbObjets} zones retenues, ${nbSansFiliere} hors perimetre ou filiere non reconnue, ` +
      `${nbSansGeometrie} sans geometrie, ${parDep.length} departements couverts`,
    nbObjets,
  );
  return { connecteur: 'zaer_local', nbObjets, nbSansGeometrie, nbSansFiliere, millesime: null };
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
         code_departement = EXCLUDED.code_departement`,
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

  try {
    for (const couche of COUCHES_SITES) {
      for await (const entite of objetsWfs(couche)) {
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
      journal.info({ couche, nbObjets }, 'Couche de sites ingeree');
    }
    await viderLot();
  } catch (err) {
    journal.error({ err }, "Echec de l'ingestion des sites proteges");
    await enregistrerIngestion('patrimoine_sites', 'echec', (err as Error).message, nbObjets);
    return { connecteur: 'patrimoine_sites', nbObjets, nbSansGeometrie, nbNonReconnus, millesime: null };
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
      'Sites ingeres mais table `commune` vide : impossible de les rattacher a un departement, donc ' +
        'aucune couverture enregistree et critere patrimonial toujours gris. Lancer ' +
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
      'Sites rattaches a leur departement par jointure spatiale',
    );
  }

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

  await enregistrerIngestion(
    'patrimoine_sites',
    nbObjets > 0 ? 'ok' : 'echec',
    `${nbObjets} sites classes et inscrits, ${nbNonReconnus} labels ou types non reconnus ecartes, ` +
      `${nbSansGeometrie} sans geometrie, ${parDepEtType.length} couples departement/type couverts`,
    nbObjets,
  );
  return { connecteur: 'patrimoine_sites', nbObjets, nbSansGeometrie, nbNonReconnus, millesime: null };
}
