/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES POSTES SOURCES PAR LA GEOMETRIE, QUAND LA CAPACITE N'EST PAS ACCESSIBLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE PROBLEME QUE CE FICHIER RESOUT, et il etait le plus couteux du depot. La table `poste_source`
 * etait VIDE : `postesLesPlusProches` ne rendait rien, `postes_sources` partait dans les
 * connecteurs en echec, et TOUS les criteres de raccordement passaient au gris. Or le raccordement
 * est le critere qui decide de l'economie d'un projet — mesure sur la base de demonstration, les
 * deux parcelles qualifiees affichaient « Donnees manquantes » au lieu d'un verdict.
 *
 * POURQUOI PAS CAPARESEAU. C'est la seule source publique de CAPACITE d'accueil, et le connecteur
 * qui la lit existe et fonctionne (`postes-sources.ts`). Elle reste donc la source de reference.
 * Mais elle n'expose ni API ni jeu de donnees ouvert, et son site n'est pas toujours joignable :
 * quand il ne l'est pas, l'application n'a RIEN. Ce fichier est le second chemin.
 *
 * ═══ LE CRITERE, ET POURQUOI IL EST DEFENDABLE
 *
 * La BD TOPO publie `poste_de_transformation` : 4 128 objets en service, avec geometrie, mais
 * SANS nom, SANS tension et SANS capacite. Prise telle quelle, cette couche serait un piege : elle
 * ne distingue pas un poste source HTB/HTA d'un transformateur de quartier, et une parcelle voisine
 * d'un transformateur de rue serait notee « parfaitement raccordee ». Mesure : l'attribut
 * `importance` ne discrimine pas — 3 819 objets sur 4 128 portent la meme valeur.
 *
 * LA COUCHE `ligne_electrique`, ELLE, PORTE LA TENSION. Et elle ne contient QUE de la HTB : 400 kV
 * (1 368), 225 kV (3 367), 150 kV (114), 63 kV (6 660). Aucune HTA, aucune BT. Un poste qui touche
 * une de ces lignes est donc, par construction, raccorde au reseau de transport ou de repartition.
 *
 * MESURE DE LA DISTANCE POSTE -> LIGNE HTB LA PLUS PROCHE, sur les 4 128 postes en service :
 *
 *     0 m (contact)            3 208
 *     <=  25 m                    75
 *     <=  50 m                    40
 *     <= 100 m                    60
 *     <= 250 m                    84
 *     250 m - 2 km               337
 *     aucune ligne < 2 km        324
 *
 * La coupure est nette : un poste touche la ligne, ou il en est loin. Le critere retenu est donc le
 * CONTACT, qui ne demande aucun seuil arbitraire a justifier.
 *
 * ═══ ET LA TENSION FILTRE LE RESTE, ce qui est la seconde moitie du raisonnement
 *
 * Un poste 400 kV n'est pas un point d'injection pour un projet de 10 MW : on s'y raccorde a
 * partir de plusieurs dizaines de megawatts. Le poste SOURCE d'un projet reparti est alimente en
 * HTB1 — 63, 90 ou 150 kV — et transforme en HTA. Repartition mesuree des postes en contact :
 *
 *     touchent une ligne <= 150 kV (poste source plausible)   2 833
 *     touchent SEULEMENT du 225 / 400 kV (reseau de transport)  354
 *     tension de la ligne non renseignee                         21
 *
 * 2 833 est l'ordre de grandeur reel du parc francais de postes sources. Les 354 postes purement
 * THT sont ECARTES : les compter aurait produit des faux positifs sur le critere le plus lourd.
 *
 * ═══ CE QUE CE CONNECTEUR N'ECRIT PAS, ET NE DOIT JAMAIS ECRIRE
 *
 * `capacite_residuelle_mw`, `etat_saturation`, `file_attente_mw`, `quote_part_eur_par_kw`,
 * `renforcement_*` restent NULS. La BD TOPO ne les publie pas, et rien ne permet de les deduire
 * d'une geometrie. Le critere de saturation reste donc GRIS, ce qui est la reponse juste : le
 * dossier ecrit « capacite inconnue » et renvoie a Capareseau. La distance, elle, devient connue —
 * et c'est le terme dominant du cout de raccordement.
 *
 * Le NOM non plus n'est pas invente : la BD TOPO n'en publie aucun, et `nom` porte donc la tension
 * relevee sur les lignes en contact, pas un toponyme fabrique.
 */

import { config } from '../config.js';
import { avecParams } from '../http.js';
import { journal } from '../journal.js';
import { requete } from '../bdd.js';
import { enregistrerCouverture } from '../depots/sources.js';
import { calculerPotentielCommunal } from '../services/potentiel-communal.js';

const CONNECTEUR = 'postes_geopf';

const COUCHE_POSTES = 'BDTOPO_V3:poste_de_transformation';
const COUCHE_LIGNES = 'BDTOPO_V3:ligne_electrique';

/** Taille de page du WFS de la Geoplateforme : le service plafonne a 5 000. */
const TAILLE_PAGE = 5000;
/** Garde-fou de pagination : au-dela, le defaut est dans la boucle, pas dans la donnee. */
const PAGES_MAX = 40;

/**
 * Tensions retenues, en kilovolts.
 *
 * HTB1 : un poste alimente en 63, 90 ou 150 kV transforme vers la HTA et accueille les projets
 * repartis. Au-dessus, on est sur le reseau de transport, ou l'on ne se raccorde qu'a partir de
 * plusieurs dizaines de megawatts — voir le commentaire d'en-tete et ses mesures.
 */
const KV_MAX_POSTE_SOURCE = 150;

interface Entite {
  properties: Record<string, unknown> | null;
  geometry: unknown;
}

/** Une page de la couche, en GeoJSON. Leve si le service refuse. */
async function pageWfs(typeName: string, debut: number, cql: string): Promise<Entite[]> {
  const url = avecParams(config.sources.geoplateformeWfs, {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
    COUNT: String(TAILLE_PAGE),
    STARTINDEX: String(debut),
    CQL_FILTER: cql,
  });
  const reponse = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!reponse.ok) throw new Error(`${typeName} @${debut} : HTTP ${reponse.status}`);
  const corps = (await reponse.json()) as { features?: Entite[] };
  return corps.features ?? [];
}

/**
 * Charge une couche entiere dans une table de travail.
 *
 * PAR LOTS, et non ligne a ligne : la premiere version inserait chaque objet dans son propre
 * aller-retour SQL et mettait plusieurs minutes pour 18 000 objets. Le gain n'est pas cosmetique,
 * c'est la difference entre une ingestion et une attente.
 *
 * `ST_Force2D` est INDISPENSABLE : la BD TOPO publie des geometries a trois dimensions, et une
 * colonne declaree en 2D les refuse (« Geometry has Z dimension but column does not »).
 */
async function chargerCouche(
  table: string,
  typeName: string,
  cql: string,
  colonnes: readonly string[],
  extraire: (p: Record<string, unknown>) => readonly unknown[],
): Promise<number> {
  let total = 0;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const entites = await pageWfs(typeName, page * TAILLE_PAGE, cql);
    if (entites.length > 0) {
      const valeurs: unknown[] = [];
      const morceaux: string[] = [];
      for (const e of entites) {
        if (!e.geometry) continue;
        const p = e.properties ?? {};
        const ligne = [...extraire(p), JSON.stringify(e.geometry)];
        const base = valeurs.length;
        morceaux.push(
          `(${ligne.map((_, i) => `$${base + i + 1}`).slice(0, -1).join(', ')}, ` +
            `ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($${base + ligne.length}), 4326)))`,
        );
        valeurs.push(...ligne);
      }
      if (morceaux.length > 0) {
        await requete(
          `INSERT INTO ${table} (${colonnes.join(', ')}) VALUES ${morceaux.join(', ')}
           ON CONFLICT DO NOTHING`,
          valeurs,
        );
        total += morceaux.length;
      }
    }
    if (entites.length < TAILLE_PAGE) return total;
  }
  throw new Error(`${typeName} : ${PAGES_MAX} pages atteintes, pagination suspecte`);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE RAISONNEMENT, SEPARE DU TELECHARGEMENT — et exporte pour etre reellement teste
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CETTE SEPARATION EXISTE, et ce n'est pas une preference d'architecture. Ma premiere
 * version gardait tout dans `ingererPostesGeoplateforme`, et le fichier de test rejouait le SQL
 * DANS LE TEST. Verifie par mutation : casser le critere de contact, monter le seuil de tension a
 * 400 kV, ou inventer une capacite d'accueil ne faisait echouer AUCUN test. Trois gardes qui
 * n'en etaient pas — le test verifiait une copie du raisonnement, pas le raisonnement.
 *
 * Le telechargement a besoin du reseau ; la deduction n'en a pas besoin. Elle est donc ici, elle
 * lit deux tables de travail deja remplies, et le test les seme a la main pour poser exactement les
 * cas limites : un poste a 300 m d'une ligne, un poste purement THT, un poste mixte.
 */
export async function retenirPostes(kvMax = KV_MAX_POSTE_SOURCE): Promise<{
  postesRetenus: number;
  ecartesThtSeule: number;
  ecartesSansLigne: number;
  ecartesDoublonCapareseau: number;
}> {
  const [compte] = await requete<{ tht: number; sans: number }>(
    `WITH j AS (
       SELECT p.cleabs, min(${'kv(l.voltage)'}) AS kv_min
         FROM ing_poste_geopf p
         JOIN ing_ligne_geopf l ON ST_Intersects(p.g2154, l.g2154)
        GROUP BY p.cleabs)
     SELECT
       (SELECT count(*)::int FROM j WHERE kv_min > $1) AS tht,
       (SELECT count(*)::int FROM ing_poste_geopf p
         WHERE NOT EXISTS (SELECT 1 FROM j WHERE j.cleabs = p.cleabs)) AS sans`.replace(
      'kv(l.voltage)',
      "NULLIF(regexp_replace(l.voltage, '[^0-9]', '', 'g'), '')::int",
    ),
    [kvMax],
  );

  /*
   * L'INSERTION FINALE, et les trois regles qu'elle applique.
   *
   *   1. seuls les postes en CONTACT avec une ligne de tension <= 150 kV sont retenus ;
   *   2. la tension inscrite est la PLUS BASSE des lignes en contact — c'est le niveau auquel on
   *      se raccorde, pas le plus impressionnant du site ;
   *   3. un poste deja connu par CAPARESEAU a moins de 500 m n'est pas double. Capareseau porte la
   *      capacite ; le doubler ferait apparaitre deux fois le meme poste physique dans la liste des
   *      postes alternatifs de la fiche, avec deux verdicts differents sur la saturation.
   */
  const [insere] = await requete<{ n: number; doublons: number }>(
    `WITH j AS (
       SELECT p.cleabs,
              p.geom,
              min(NULLIF(regexp_replace(l.voltage, '[^0-9]', '', 'g'), '')::int) AS kv,
              -- Le gestionnaire de la ligne de PLUS BASSE tension : c'est celle a laquelle on se
              -- raccorde. Mesure sur la couche : 12 523 lignes portent « Réseau de Transport
              -- d'Electricité », 1 967 ne portent rien. Tout le reste tombera en autre_grd
              -- plutot que d'etre suppose Enedis, ce que la source ne dit pas.
              (array_agg(l.gestionnaire ORDER BY NULLIF(regexp_replace(l.voltage, '[^0-9]', '', 'g'), '')::int NULLS LAST))[1] AS gestionnaire
         FROM ing_poste_geopf p
         JOIN ing_ligne_geopf l ON ST_Intersects(p.g2154, l.g2154)
        GROUP BY p.cleabs, p.geom
       HAVING min(NULLIF(regexp_replace(l.voltage, '[^0-9]', '', 'g'), '')::int) <= $1
     ),
     situe AS (
       SELECT j.*,
              ST_Centroid(j.geom) AS pt,
              EXISTS (
                SELECT 1 FROM poste_source ps
                 WHERE ps.connecteur IS DISTINCT FROM $2
                   AND ST_DWithin(ps.geom::geography, ST_Centroid(j.geom)::geography, 500)
              ) AS doublon
         FROM j
     ),
     retenus AS (
       SELECT s.*, c.code_insee, c.nom AS nom_commune, c.code_departement
         FROM situe s
         LEFT JOIN commune c ON ST_Contains(c.geom, s.pt)
        WHERE NOT s.doublon
     ),
     ecrits AS (
       INSERT INTO poste_source
         (id, nom, gestionnaire, tension, code_insee, nom_commune, code_departement, geom,
          capacite_residuelle_mw, etat_saturation, en_projet, connecteur, date_donnee)
       SELECT 'geopf:' || cleabs,
              'Poste de transformation ' || kv || ' kV',
              CASE
                WHEN gestionnaire ILIKE '%transport%electricit%' THEN 'RTE'
                WHEN gestionnaire ILIKE '%rte%' THEN 'RTE'
                WHEN gestionnaire ILIKE '%enedis%' THEN 'Enedis'
                ELSE 'autre_grd'
              END,
              kv || ' kV', code_insee, nom_commune, code_departement, pt,
              NULL, NULL, false, $2, current_date
         FROM retenus
       ON CONFLICT (id) DO UPDATE SET
         tension = EXCLUDED.tension,
         code_insee = EXCLUDED.code_insee,
         nom_commune = EXCLUDED.nom_commune,
         code_departement = EXCLUDED.code_departement,
         geom = EXCLUDED.geom,
         updated_at = now()
       RETURNING 1
     )
     SELECT (SELECT count(*)::int FROM ecrits) AS n,
            (SELECT count(*)::int FROM situe WHERE doublon) AS doublons`,
    [kvMax, CONNECTEUR],
  );

  /*
   * LA COUVERTURE, sans laquelle rien de tout cela ne sert.
   *
   * `postesLesPlusProches` refuse de rendre un poste tant que le disque balaye n'est pas declare
   * ingere : c'est le garde qui empeche d'annoncer « le plus proche » sur une base trouee. La
   * requete WFS etant NATIONALE et sa pagination verifiee, tout departement portant des communes
   * est couvert — y compris ceux ou aucun poste n'a ete trouve, et c'est justement le cas qu'il
   * faut pouvoir distinguer de « pas ingere ».
   */
  return {
    postesRetenus: insere?.n ?? 0,
    ecartesThtSeule: compte?.tht ?? 0,
    ecartesSansLigne: compte?.sans ?? 0,
    ecartesDoublonCapareseau: insere?.doublons ?? 0,
  };
}

export interface ResultatPostesGeopf extends Record<string, unknown> {
  postesLus: number;
  lignesLues: number;
  postesRetenus: number;
  ecartesThtSeule: number;
  ecartesSansLigne: number;
  ecartesDoublonCapareseau: number;
  departementsCouverts: number;
}

/**
 * Ingere les postes sources deduits de la BD TOPO.
 *
 * IDEMPOTENT : les tables de travail sont recreees, et l'insertion finale est un upsert sur
 * l'identifiant `geopf:<cleabs>`.
 */
export async function ingererPostesGeoplateforme(): Promise<ResultatPostesGeopf> {
  /*
   * Les tables de travail sont declarees par la migration 017, et VIDEES ici plutot que creees.
   * La raison n'est pas le confort : une table creee a l'execution rend le SQL du connecteur
   * inanalysable, et le garde `sql-analysable.test.ts` — qui soumet chaque litteral a PostgreSQL —
   * echouait en « relation ing_poste_geopf does not exist ».
   */
  await requete(`TRUNCATE ing_poste_geopf, ing_ligne_geopf`);

  const postesLus = await chargerCouche(
    'ing_poste_geopf',
    COUCHE_POSTES,
    "etat_de_l_objet='En service'",
    ['cleabs', 'geom'],
    (p) => [String(p['cleabs'] ?? '')],
  );
  const lignesLues = await chargerCouche(
    'ing_ligne_geopf',
    COUCHE_LIGNES,
    "etat_de_l_objet='En service'",
    ['cleabs', 'voltage', 'gestionnaire', 'geom'],
    (p) => [String(p['cleabs'] ?? ''), p['voltage'] ?? null, p['gestionnaire'] ?? null],
  );
  journal.info({ connecteur: CONNECTEUR, postesLus, lignesLues }, 'Couches BD TOPO chargees');

  /*
   * PROJECTION EN LAMBERT-93 AVANT TOUTE MESURE, et c'est un correctif mesure.
   *
   * La premiere version croisait les couches en `::geography` sur du WGS84. Le cast empeche
   * l'usage de l'index GiST : la requete tournait encore apres VINGT-TROIS MINUTES. La meme
   * jointure sur des colonnes projetees et indexees rend en DOUZE SECONDES. Sur une ingestion
   * nationale, ce n'est pas une optimisation, c'est la difference entre faisable et non faisable.
   */
  await requete(`UPDATE ing_poste_geopf SET g2154 = ST_Transform(geom, 2154)`);
  await requete(`UPDATE ing_ligne_geopf SET g2154 = ST_Transform(geom, 2154)`);
  await requete(`ANALYZE ing_poste_geopf`);
  await requete(`ANALYZE ing_ligne_geopf`);

  const deduction = await retenirPostes();

  /*
   * SI LA TABLE DES COMMUNES EST VIDE, LE TRAVAIL NE SERT A RIEN — ET IL FAUT LE DIRE.
   *
   * La couverture se decrit par departement, et les departements viennent de `commune`. Sans
   * elles, aucune ligne de couverture n'est ecrite, `postesLesPlusProches` continue de refuser, et
   * les 2 847 postes ingeres restent inertes. Constate a la premiere execution reelle : l'ingestion
   * se declarait « terminee » avec `departementsCouverts: 0`, ce qui n'est un succes pour personne.
   *
   * Un avertissement nomme la commande a lancer, plutot que de laisser chercher.
   */
  const [nbCommunes] = await requete<{ n: number }>(`SELECT count(*)::int AS n FROM commune`);
  if ((nbCommunes?.n ?? 0) === 0) {
    journal.warn(
      { connecteur: CONNECTEUR },
      'Table `commune` vide : aucune couverture ne peut etre declaree, et les postes ingeres ' +
        'resteront inutilisables. Lancez d\'abord `npm run ingest -w @enr/api -- communes`.',
    );
  }

  const departements = await requete<{ code_departement: string; n: number }>(
    `SELECT d.code_departement,
            (SELECT count(*)::int FROM poste_source ps
              WHERE ps.connecteur = $1 AND ps.code_departement = d.code_departement) AS n
       FROM (SELECT DISTINCT code_departement FROM commune WHERE code_departement IS NOT NULL) d`,
    [CONNECTEUR],
  );
  for (const d of departements) {
    await enregistrerCouverture(CONNECTEUR, 'poste_source', d.code_departement, d.n, COUCHE_POSTES);
  }

  await requete(`TRUNCATE ing_poste_geopf, ing_ligne_geopf`);

  /*
   * LE POTENTIEL COMMUNAL EST RECALCULE DANS LA FOULEE, et ce n'est pas une commodite.
   *
   * Il repose sur la distance de chaque commune au poste le plus proche : cette ingestion la CHANGE.
   * Sans recalcul, la carte nationale continuerait d'afficher l'etat d'avant sans rien en dire —
   * exactement le defaut « le snapshot vieillit par l'arrivee de la donnee » corrige a l'audit 9,
   * transpose a l'echelle communale. Vingt secondes sur les huit de l'ingestion.
   *
   * L'echec n'interrompt pas l'ingestion : les postes, eux, sont ecrits et valides.
   */
  await calculerPotentielCommunal().catch((err: unknown) =>
    journal.warn(
      { err, connecteur: CONNECTEUR },
      'Potentiel communal non recalcule : la carte nationale reste sur son etat precedent. ' +
        'Relancez `npm run potentiel -w @enr/api`.',
    ),
  );

  const resultat: ResultatPostesGeopf = {
    postesLus,
    lignesLues,
    postesRetenus: deduction.postesRetenus,
    ecartesThtSeule: deduction.ecartesThtSeule,
    ecartesSansLigne: deduction.ecartesSansLigne,
    ecartesDoublonCapareseau: deduction.ecartesDoublonCapareseau,
    departementsCouverts: departements.length,
  };
  journal.info({ connecteur: CONNECTEUR, ...resultat }, 'Postes sources deduits de la BD TOPO');
  return resultat;
}
