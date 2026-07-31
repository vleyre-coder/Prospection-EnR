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

async function appeler<T>(
  chemin: string,
  options: { methode?: string; corps?: unknown; enTetes?: Record<string, string> } = {},
): Promise<T> {
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
  statut: string;
  version: string;
  versionMoteur: string;
  baseDeDonnees: string;
  amorcage?: Amorcage;
  sources: EtatSource[];
  sourcesPerimees: string[];
}

export interface CoucheMeta {
  id: string;
  libelle: string;
  groupe: string;
  typeGeom: string;
  couleur: string;
}

export interface Referentiel {
  filieres: FiliereMeta[];
  criteres: Record<string, DefinitionCritere>;
  famillesLibelles: Record<string, string>;
  ponderationsDefaut: Record<Filiere, ProfilPonderation>;
  reglementation: Record<string, Record<string, RegleReglementaire>>;
  libellesRegime: Record<string, string>;
  referentielDerniereVerification: string;
  avertissements: Avertissement[];
  palette: {
    couleursScore: Record<Feu, string>;
    couleursScoreRemplissage: Record<Feu, string>;
    libellesScore: Record<Feu, string>;
    descriptionsScore: Record<Feu, string>;
    couleursSaturation: Record<string, string>;
    libellesSaturation: Record<string, string>;
  };
  statutsProspection: StatutProspectionMeta[];
  couches: CoucheMeta[];
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
  statutProspection: StatutProspection | null;
  distancePosteKm: number | null;
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
    appeler<{ nbParcelles: number; nbEnrichies: number; nbEchecs: number; dureeMs: number }>(
      '/api/qualification/emprise',
      { methode: 'POST', corps: { bbox, filiere, surfaceMinM2 } },
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
