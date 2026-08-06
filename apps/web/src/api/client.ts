/**
 * Client de l'API interne.
 *
 * Toutes les erreurs sont normalisees en `ErreurApi` : l'interface peut ainsi afficher un
 * message francais exploitable plutot qu'un ecran vide. Une source externe indisponible
 * (502 `source_indisponible`) est signalee comme telle, car elle n'invalide pas la fiche :
 * elle laisse simplement des criteres non evalues.
 */

/**
 * Racine de l'API.
 *
 * Vide par defaut : l'interface et l'API partagent alors la meme origine, ce qui est le cas
 * quand l'API sert le build (installation locale) et quand un hebergeur de sites statiques
 * reproxifie `/api`. Renseigner `VITE_URL_API` a la construction permet de deployer
 * l'interface seule, sur une origine differente de celle de l'API — l'API doit alors
 * declarer cette origine dans `ORIGINES_AUTORISEES`.
 */
export const RACINE_API: string = (
  (import.meta.env['VITE_URL_API'] as string | undefined) ?? ''
).replace(/\/+$/, '');

/**
 * Meme racine, mais toujours ABSOLUE.
 *
 * A reserver aux ressources chargees par MapLibre : tuiles vectorielles et glyphes sont
 * recuperes dans un Web Worker, ou une URL relative ne se resout pas contre le document.
 * Elle echoue alors silencieusement, tuile par tuile, et la carte reste vide sans erreur
 * reseau visible. Les appels `fetch` ordinaires, eux, se contentent de `RACINE_API`.
 */
export const RACINE_ABSOLUE: string =
  RACINE_API || (typeof location !== 'undefined' ? location.origin : '');

import { estSessionExpiree } from '../utils/affichage.js';
import type {
  Avertissement,
  DefinitionCritere,
  Feu,
  Filiere,
  FiliereMeta,
  Lead,
  ParcelleSnapshot,
  ProfilPonderation,
  RegleReglementaire,
  ResultatScore,
  StatutProspection,
  StatutProspectionMeta,
} from '@enr/core';

export class ErreurApi extends Error {
  constructor(
    readonly code: string,
    override readonly message: string,
    readonly statut: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ErreurApi';
  }

  /** Une source externe momentanement indisponible : degradation, pas echec. */
  get estSourceIndisponible(): boolean {
    return this.code === 'source_indisponible';
  }

  get estReseau(): boolean {
    return this.statut === 0;
  }

  /** Jeton absent, invalide ou expire : il faut se reconnecter. */
  get estNonAuthentifie(): boolean {
    return this.statut === 401;
  }
}

let jeton: string | null = null;

export function definirJeton(valeur: string | null): void {
  jeton = valeur;
  if (valeur) localStorage.setItem('enr_jeton', valeur);
  else localStorage.removeItem('enr_jeton');
}

export function jetonEnregistre(): string | null {
  jeton ??= localStorage.getItem('enr_jeton');
  return jeton;
}

/**
 * Notification de session expiree.
 *
 * Le jeton dure 12 h. Passe ce delai, les requetes echouent en 401 - y compris celles des
 * TUILES, que MapLibre emet depuis un worker et dont l'echec ne remonte a aucun composant
 * React. L'utilisateur se retrouvait alors devant une carte vide, sans message, et concluait
 * a une panne. Tout point du code qui constate un 401 le signale ici ; l'application bascule
 * sur l'ecran de connexion.
 */
const ecouteursSession = new Set<() => void>();

export function surSessionExpiree(ecouteur: () => void): () => void {
  ecouteursSession.add(ecouteur);
  return () => ecouteursSession.delete(ecouteur);
}

let sessionDejaSignalee = false;

export function signalerSessionExpiree(): void {
  // Une carte emet une erreur par tuile : sans ce verrou, une centaine de notifications
  // partiraient pour un seul evenement.
  if (sessionDejaSignalee) return;
  sessionDejaSignalee = true;
  definirJeton(null);
  for (const e of ecouteursSession) e();
}

/** A appeler apres une reconnexion reussie, pour rearmer la detection. */
export function reinitialiserDetectionSession(): void {
  sessionDejaSignalee = false;
}

async function appeler<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown; enTetes?: Record<string, string> } = {},
): Promise<T> {
  // Lu avant l'appel : `signalerSessionExpiree` efface le jeton, et un 401 concurrent
  // aurait sinon vu un jeton deja nul et conclu a tort qu'il n'y avait pas de session.
  const jetonPresent = jetonEnregistre() != null;
  let reponse: Response;
  try {
    reponse = await fetch(`${RACINE_API}${chemin}`, {
      method: options.methode ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.corps ? { 'Content-Type': 'application/json' } : {}),
        ...(jetonEnregistre() ? { Authorization: `Bearer ${jetonEnregistre()}` } : {}),
        ...(options.enTetes ?? {}),
      },
      body: options.corps ? JSON.stringify(options.corps) : undefined,
    });
  } catch {
    throw new ErreurApi(
      'reseau',
      "L'API est injoignable. Verifiez que le serveur est demarre.",
      0,
    );
  }

  if (reponse.status === 204) return undefined as T;

  const typeContenu = reponse.headers.get('content-type') ?? '';
  if (!reponse.ok) {
    // La regle est dans `estSessionExpiree`, ou elle est testee : un 401 n'est une
    // EXPIRATION que s'il y avait une session, et la route de connexion repond 401 sur un
    // mot de passe faux — ce qui n'est pas une expiration mais une erreur de saisie.
    if (estSessionExpiree(reponse.status, jetonPresent, chemin)) {
      signalerSessionExpiree();
    }
    if (typeContenu.includes('json')) {
      const corps = (await reponse.json().catch(() => null)) as
        | { erreur?: { code?: string; message?: string; details?: unknown } }
        | null;
      throw new ErreurApi(
        corps?.erreur?.code ?? 'erreur',
        corps?.erreur?.message ?? `Erreur ${reponse.status}`,
        reponse.status,
        corps?.erreur?.details,
      );
    }
    throw new ErreurApi('erreur', `Erreur ${reponse.status}`, reponse.status);
  }

  return (await reponse.json()) as T;
}

// ---------------------------------------------------------------------------
// Types de reponse
// ---------------------------------------------------------------------------

export interface EtatSource {
  connecteur: string;
  nom: string;
  modeAcces: string;
  millesime: string | null;
  dateDerniereIngestion: string | null;
  couverture: string;
  dernierStatut: string | null;
  perimee: boolean;
  ageJours: number | null;
  valeurJuridique: string;
  avertissement: string | null;
}

export interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  role: 'admin' | 'prospection' | 'lecture';
  habiliteDonneesProprietaires: boolean;
}

export interface EtapeAmorcage {
  nom: string;
  libelle: string;
  duree: string;
  indispensable: boolean;
  statut: 'attente' | 'en_cours' | 'ok' | 'echec' | 'deja_present';
  message: string | null;
}

/** Avancement du chargement initial des donnees nationales, au premier demarrage. */
export interface Amorcage {
  enCours: boolean;
  debutLe: string | null;
  finLe: string | null;
  etapes: EtapeAmorcage[];
}

export interface Sante {
  /** `ok`, `degrade` (base indisponible) ou `hors_service` (configuration fatale). */
  statut: string;
  /**
   * Configurations qui empechent l'instance de servir les routes protegees. Vide en
   * fonctionnement normal ; non vide, l'instance ne doit pas recevoir de trafic.
   */
  configurationsFatales?: string[];
  version: string;
  versionMoteur: string;
  baseDeDonnees: string;
  amorcage?: Amorcage;
  sources: EtatSource[];
  sourcesPerimees: string[];
  /**
   * Parcelles dont le snapshot est absent, perime par l'age, ou ANTERIEUR a la derniere ingestion
   * touchant leur departement. `null` si la base n'a pas repondu.
   *
   * Audit 9, defaut A2 : ce retard etait invisible. Un snapshot ne vieillissait que par son age, et
   * l'empreinte du moteur ne couvre pas la donnee — apres une ingestion, la carte et les listes
   * continuaient d'afficher l'etat d'avant sans que rien ne l'indique.
   */
  parcellesARafraichir?: number | null;
}

/** Avancement d'une campagne de qualification menee en arriere-plan. */
export interface DemandeEnAttente {
  id: string;
  /** Rang dans la file, 1 = prochaine a demarrer. */
  position: number;
  demandeeLe: string;
  utilisateurId: string | null;
  bbox: [number, number, number, number];
  nbParcellesEstime: number | null;
}

export interface EtatQualification {
  enCours: boolean;
  phase: 'recuperation' | 'enrichissement' | 'terminee' | 'aucune';
  total: number;
  traitees: number;
  echecs: number;
  debutLe: string | null;
  finLe: string | null;
  message: string | null;
  resteSecondes: number | null;
  /**
   * Demandes acceptees mais pas encore demarrees. Une seule campagne s'execute a la fois,
   * parce que les sources publiques plafonnent a une requete par seconde ; les demandes
   * suivantes attendent leur tour au lieu d'etre refusees.
   */
  fileAttente: DemandeEnAttente[];
  /**
   * Derniere campagne connue, lue en base. `null` pendant une campagne en cours.
   *
   * Indispensable apres un redemarrage : l'etat en memoire est alors vide, et sans cette
   * information un lot arrete a 49 parcelles sur 1 500 est indiscernable d'un lot complet.
   */
  derniereCampagne?: {
    debutLe: string;
    finLe: string | null;
    total: number;
    traitees: number;
    echecs: number;
    interrompue: boolean;
    message: string | null;
  } | null;
}

export interface CoucheMeta {
  id: string;
  libelle: string;
  groupe: string;
  typeGeom: string;
  couleur: string;
  /** Objets effectivement en base. 0 = couche non ingeree, rien a afficher. */
  nbObjets?: number;
}

/** Calque cartographique du catalogue, avec son etat et sa provenance. */
export interface CalqueMeta {
  id: string;
  libelle: string;
  groupe: string;
  couleur: string;
  mode: 'raster' | 'vecteur_api' | 'vecteur_base';
  legende: string;
  avertissement: string | null;
  zoomMin: number | null;
  source: {
    nom: string;
    millesime: string | null;
    url: string | null;
    valeurJuridique: 'opposable' | 'indicative' | 'pre_reperage';
  };
  /** `zoom_requis` : le service ne produit rien en vue large, il faut zoomer. */
  etat: 'disponible' | 'zoom_requis' | 'indisponible';
  nbObjets: number | null;
}

export interface Referentiel {
  filieres: FiliereMeta[];
  criteres: Record<string, DefinitionCritere>;
  famillesLibelles: Record<string, string>;
  ponderationsDefaut: Record<Filiere, ProfilPonderation>;
  reglementation: Record<string, Record<string, RegleReglementaire>>;
  libellesRegime: Record<string, string>;
  /** Reserve a afficher avec le regime d'implantation : il est presume, non etabli. */
  reserveRegime: string;
  referentielDerniereVerification: string;
  avertissements: Avertissement[];
  palette: {
    couleursScore: Record<Feu, string>;
    couleursScoreRemplissage: Record<Feu, string>;
    libellesScore: Record<Feu, string>;
    descriptionsScore: Record<Feu, string>;
    /** Rouge des parcelles frappees d'un critere eliminatoire, distinct du rouge de score faible. */
    couleurRedhibitoire: string;
    couleurRedhibitoireRemplissage: string;
    libelleRedhibitoire: string;
    descriptionRedhibitoire: string;
    couleursSaturation: Record<string, string>;
    libellesSaturation: Record<string, string>;
  };
  statutsProspection: StatutProspectionMeta[];
  couches: CoucheMeta[];
  calques?: CalqueMeta[];
  /** Reglages de carte servis par l'API, pour ne pas dupliquer de constantes cote client. */
  carte?: {
    zoomMinParcelles: number;
    zoomMaxCommunes: number;
  };
}

export interface ParcelleCarte {
  idu: string;
  codeInsee: string;
  nomCommune: string | null;
  codeDepartement: string;
  section: string;
  numero: string;
  prefixe: string;
  contenanceM2: number | null;
  surfaceCalculeeM2: number | null;
  geometrie: { type: string; coordinates: unknown };
  centroide: [number, number];
  dateRecuperation: string;
}

export interface FicheParcelle {
  parcelle: ParcelleCarte;
  snapshot: ParcelleSnapshot;
  score: ResultatScore;
  lead: Lead | null;
  connecteursEnEchec: string[];
  avertissements: Avertissement[];
}

export interface PosteSourceProps {
  id: string;
  nom: string;
  gestionnaire: 'RTE' | 'Enedis' | 'autre_grd';
  tension: string | null;
  capaciteResiduelleMw: number | null;
  etatSaturation: 'disponible' | 'tendu' | 'sature' | null;
  fileAttenteMw: number | null;
  quotePartEurParKw: number | null;
  enProjet: boolean;
  renforcement: { prevu: boolean; horizon: string | null; capaciteAttendueMw: number | null };
  dateDonnee: string | null;
}

export interface CollectionPostes {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: PosteSourceProps;
  }>;
  avertissement: string;
}

export interface ResultatRecherche {
  type: 'parcelle' | 'adresse' | 'commune' | 'coordonnees' | 'poste_source';
  libelle: string;
  sousTitre: string | null;
  centroide: [number, number];
  bbox: [number, number, number, number] | null;
  idu: string | null;
  codeInsee: string | null;
}

export interface LigneListe {
  idu: string;
  nomCommune: string | null;
  section: string;
  numero: string;
  surfaceHa: number | null;
  statutScore: Feu | null;
  scoreGlobal: number | null;
  /** Knock-outs NON derogeables : distingue « mal notee » de « reglementairement ecartee ». */
  nbKnockOutsBloquants: number;
  statutProspection: StatutProspection | null;
  /** Vol d'oiseau, tel que mesure. */
  distancePosteKm: number | null;
  /** Lineaire de trace estime : la grandeur notee, et celle qui se paie. */
  lineaireRaccordementKm: number | null;
  pentePct: number | null;
  typeSol: string | null;
  centroide: [number, number];
}

export interface FiltresRecherche {
  filiere: Filiere;
  bbox?: [number, number, number, number];
  codeDepartement?: string;
  surfaceMinHa?: number;
  surfaceMaxHa?: number;
  distancePosteMaxKm?: number;
  capacitePosteMinMw?: number;
  penteMaxPct?: number;
  scoreMin?: number;
  statutsScore?: Feu[];
  statutsProspection?: StatutProspection[];
  typesSol?: string[];
  exclureNatura2000?: boolean;
  exclureZoneHumide?: boolean;
  exclureAop?: boolean;
  exclureKnockOuts?: boolean;
  tri?: 'score_desc' | 'score_asc' | 'surface_desc' | 'distance_poste_asc';
  limite?: number;
  decalage?: number;
}

export interface TableauDeBord {
  parStatut: Record<string, number>;
  surfaceSecuriseeHa: number;
  surfaceEnNegociationHa: number;
  evolution: Array<{ mois: string; nouveaux: number; securises: number }>;
  repartitionScores: Record<string, number>;
}

export interface SiteResume {
  id: string;
  nom: string;
  filiere: Filiere;
  surfaceHa: number | null;
  scoreGlobal: number | null;
  statutScore: Feu | null;
  idus: string[];
  geometrie: { type: string; coordinates: unknown } | null;
  parcelles?: ResultatScore[];
  knockOutsConsolides?: unknown[];
}

// ---------------------------------------------------------------------------
// Points d'entree
// ---------------------------------------------------------------------------

export const api = {
  sante: () => appeler<Sante>('/api/sante'),
  referentiel: () => appeler<Referentiel>('/api/referentiel'),

  moi: () => appeler<Utilisateur>('/api/auth/moi'),
  connexion: (email: string, motDePasse: string) =>
    appeler<{ token: string; utilisateur: Utilisateur }>('/api/auth/connexion', {
      methode: 'POST',
      corps: { email, motDePasse },
    }),

  fiche: (idu: string, filiere: Filiere, rafraichir = false) =>
    appeler<FicheParcelle>(
      `/api/parcelles/${encodeURIComponent(idu)}?filiere=${filiere}${rafraichir ? '&rafraichir=true' : ''}`,
    ),

  scoreAvecPonderation: (
    idu: string,
    filiere: Filiere,
    ponderation: Partial<ProfilPonderation>,
    options?: { knockOutsDesactives?: string[]; puissanceEnvisageeMw?: number | null },
  ) =>
    appeler<ResultatScore>(`/api/parcelles/${encodeURIComponent(idu)}/score`, {
      methode: 'POST',
      corps: { filiere, ponderation, options },
    }),

  scoresLot: (idus: string[], filiere: Filiere, ponderation?: Partial<ProfilPonderation>) =>
    appeler<{ scores: Record<string, { statut: Feu; scoreGlobal: number | null; nbKnockOuts: number }> }>(
      '/api/parcelles/scores',
      { methode: 'POST', corps: { idus, filiere, ponderation } },
    ),

  qualifierEmprise: (bbox: [number, number, number, number], filiere: Filiere, surfaceMinM2?: number) =>
    appeler<{
      /** `arriere_plan` pour une emprise etendue : suivre ensuite `etatQualification()`. */
      mode: 'immediat' | 'arriere_plan';
      etat?: EtatQualification;
      /** Identifiant de la demande, pour la reconnaitre dans la file. */
      id?: string;
      /** 0 si la campagne a demarre tout de suite, sinon son rang dans la file. */
      position?: number;
      nbParcelles?: number;
      nbEnrichies?: number;
      nbEchecs?: number;
      dureeMs?: number;
    }>('/api/qualification/emprise', { methode: 'POST', corps: { bbox, filiere, surfaceMinM2 } }),

  etatQualification: () => appeler<EtatQualification>('/api/qualification/etat'),

  /**
   * Reprend un lot de parcelles en retard sur la donnee (audit 9, defaut A2).
   *
   * Le lot est borne cote serveur et la route partage la limitation de debit de la qualification :
   * un rafraichissement consomme le quota des API publiques comme une campagne. `restant` indique
   * s'il faut rappeler.
   */
  rafraichirParcelles: (limite?: number) =>
    appeler<{ nbParcelles: number; nbEnrichies?: number; nbEchecs?: number; restant: number }>(
      '/api/qualification/rafraichir',
      { methode: 'POST', corps: limite == null ? {} : { limite } },
    ),

  /** Zonages d'un calque vectoriel sur l'emprise visible. */
  zonage: (id: string, bbox: [number, number, number, number]) =>
    appeler<{
      type: 'FeatureCollection';
      features: unknown[];
      tropLarge?: boolean;
      partiel?: boolean;
      message?: string;
    }>(`/api/carte/zonage/${id}?bbox=${bbox.join(',')}`),

  estimerEmprise: (bbox: [number, number, number, number], surfaceMinM2?: number) =>
    appeler<{ nbEstime: number; dureeEstimeeMin: number; nbCellules: number }>(
      '/api/qualification/estimation',
      { methode: 'POST', corps: { bbox, surfaceMinM2 } },
    ),

  postesSources: (bbox: [number, number, number, number], rayonKm?: number | null) =>
    appeler<CollectionPostes & { rayons: { type: string; features: unknown[] } | null }>(
      `/api/carte/postes-sources?bbox=${bbox.join(',')}${rayonKm ? `&rayonKm=${rayonKm}` : ''}`,
    ),

  reseauGaz: (bbox: [number, number, number, number]) =>
    appeler<{ pointsInjection: GeoJSON.FeatureCollection; canalisations: GeoJSON.FeatureCollection }>(
      `/api/carte/reseau-gaz?bbox=${bbox.join(',')}`,
    ),

  couche: (type: string, bbox: [number, number, number, number]) =>
    appeler<GeoJSON.FeatureCollection>(
      `/api/carte/couche/${encodeURIComponent(type)}?bbox=${bbox.join(',')}`,
    ),

  rechercher: (q: string) =>
    appeler<{ resultats: ResultatRecherche[] }>(`/api/recherche?q=${encodeURIComponent(q)}`),

  filtrer: (filtres: FiltresRecherche) =>
    appeler<{ total: number; resultats: LigneListe[] }>('/api/recherche/parcelles', {
      methode: 'POST',
      corps: filtres,
    }),

  tableauDeBord: (filiere: Filiere) =>
    appeler<TableauDeBord>(`/api/tableau-de-bord?filiere=${filiere}`),

  creerLead: (corps: { idu?: string; siteId?: string; filiere: Filiere; statut?: string; notes?: string }) =>
    appeler<Lead>('/api/leads', { methode: 'POST', corps }),

  majLead: (id: string, corps: { statut?: string; notes?: string | null }) =>
    appeler<Lead>(`/api/leads/${id}`, { methode: 'PATCH', corps }),

  ajouterEvenement: (id: string, corps: { type: string; commentaire: string }) =>
    appeler<unknown>(`/api/leads/${id}/evenements`, { methode: 'POST', corps }),

  creerSite: (corps: {
    nom: string;
    filiere: Filiere;
    idus?: string[];
    geometrie?: GeoJSON.Geometry;
  }) => appeler<SiteResume>('/api/sites', { methode: 'POST', corps }),

  sites: (filiere: Filiere) => appeler<SiteResume[]>(`/api/sites?filiere=${filiere}`),

  ponderations: (filiere: Filiere) =>
    appeler<{ defaut: Record<Filiere, ProfilPonderation>; enregistres: Array<ProfilPonderation & { id: string; nom: string }> }>(
      `/api/ponderations?filiere=${filiere}`,
    ),

  enregistrerPonderation: (corps: {
    nom: string;
    filiere: Filiere;
    poids: Record<string, number>;
    seuilVert?: number;
    seuilOrange?: number;
    partage?: boolean;
  }) => appeler<{ id: string }>('/api/ponderations', { methode: 'POST', corps }),

  /** URL de telechargement direct (le navigateur gere le flux). */
  urlPdf: (idu: string, filiere: Filiere) =>
    `/api/exports/parcelle/${encodeURIComponent(idu)}.pdf?filiere=${filiere}`,

  exporter: async (
    format: 'geojson' | 'shapefile' | 'csv',
    corps: unknown,
    nomFichier: string,
  ): Promise<void> => {
    const reponse = await fetch(`${RACINE_API}/api/exports/${format}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jetonEnregistre() ? { Authorization: `Bearer ${jetonEnregistre()}` } : {}),
      },
      body: JSON.stringify(corps),
    });
    if (!reponse.ok) {
      const corpsErreur = (await reponse.json().catch(() => null)) as
        | { erreur?: { message?: string } }
        | null;
      throw new ErreurApi(
        'export',
        corpsErreur?.erreur?.message ?? `Export impossible (${reponse.status})`,
        reponse.status,
      );
    }
    const blob = await reponse.blob();
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
  },
};
