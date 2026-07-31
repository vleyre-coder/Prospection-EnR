/**
 * Etat global de l'application.
 *
 * Un seul store : le choix de la filiere pilote presque tout l'affichage, et le disperser
 * entre plusieurs contextes rendrait les recalculs difficiles a suivre.
 */

import { create } from 'zustand';
import { FILIERES_META } from '@enr/core';
import type { Feu, Filiere, StatutProspection } from '@enr/core';
import type { FiltresRecherche } from '../api/client.js';

export type FondCarte = 'plan' | 'ortho';
export type Vue = 'carte' | 'liste' | 'tableau';
export type OutilDessin = 'aucun' | 'polygone' | 'mesure' | 'selection';

export interface EtatApp {
  filiere: Filiere;
  vue: Vue;
  fond: FondCarte;
  theme: 'clair' | 'sombre' | 'systeme';

  /** Parcelle dont la fiche est ouverte. */
  iduSelectionne: string | null;
  /** Selection multiple, pour agreger en site. */
  idusSelectionnes: string[];

  /** Couches de contraintes activees. */
  couchesActives: string[];
  /** Rayon de raccordement economique affiche autour des postes, en km. 0 = masque. */
  rayonRaccordementKm: number;
  /**
   * Vrai des que l'utilisateur a deplace le curseur du rayon.
   *
   * Tant que c'est faux, changer de filiere reprend la valeur par defaut de la nouvelle
   * filiere : le rayon economique d'un parc eolien n'a rien a voir avec celui d'un
   * stockage. Une fois le curseur touche, le choix de l'utilisateur prime et n'est plus
   * ecrase dans son dos.
   */
  rayonPersonnalise: boolean;
  afficherPostes: boolean;
  afficherReseauGaz: boolean;

  /** Surcharges de ponderation par filiere (curseurs). */
  ponderations: Partial<Record<Filiere, Record<string, number>>>;
  seuils: Partial<Record<Filiere, { seuilVert: number; seuilOrange: number }>>;

  filtres: Partial<FiltresRecherche>;

  outil: OutilDessin;
  /** Avertissements globaux masques pour la session en cours uniquement. */
  avertissementsMasques: string[];
  panneauGaucheOuvert: boolean;

  definirFiliere: (f: Filiere) => void;
  definirVue: (v: Vue) => void;
  definirFond: (f: FondCarte) => void;
  definirTheme: (t: 'clair' | 'sombre' | 'systeme') => void;
  selectionnerParcelle: (idu: string | null) => void;
  basculerSelection: (idu: string) => void;
  viderSelection: () => void;
  basculerCouche: (id: string) => void;
  definirRayon: (km: number) => void;
  /** Revient au rayon par defaut de la filiere courante. */
  reinitialiserRayon: () => void;
  basculerPostes: () => void;
  basculerReseauGaz: () => void;
  definirPoids: (critereId: string, poids: number) => void;
  reinitialiserPoids: () => void;
  definirSeuils: (seuilVert: number, seuilOrange: number) => void;
  definirFiltres: (f: Partial<FiltresRecherche>) => void;
  reinitialiserFiltres: () => void;
  definirOutil: (o: OutilDessin) => void;
  masquerAvertissement: (id: string) => void;
  basculerPanneauGauche: () => void;
}

const CLE_PREFERENCES = 'enr_preferences';

interface Preferences {
  filiere?: Filiere;
  fond?: FondCarte;
  theme?: 'clair' | 'sombre' | 'systeme';
  couchesActives?: string[];
  rayonRaccordementKm?: number;
  rayonPersonnalise?: boolean;
  ponderations?: Partial<Record<Filiere, Record<string, number>>>;
}

function chargerPreferences(): Preferences {
  try {
    return JSON.parse(localStorage.getItem(CLE_PREFERENCES) ?? '{}') as Preferences;
  } catch {
    return {};
  }
}

function enregistrerPreferences(e: EtatApp): void {
  const p: Preferences = {
    filiere: e.filiere,
    fond: e.fond,
    theme: e.theme,
    couchesActives: e.couchesActives,
    rayonRaccordementKm: e.rayonRaccordementKm,
    rayonPersonnalise: e.rayonPersonnalise,
    ponderations: e.ponderations,
  };
  try {
    localStorage.setItem(CLE_PREFERENCES, JSON.stringify(p));
  } catch {
    // Stockage indisponible (navigation privee) : les preferences ne sont pas persistees,
    // ce qui est sans consequence fonctionnelle.
  }
}

const prefs = chargerPreferences();

export const useEtat = create<EtatApp>((set, get) => ({
  filiere: prefs.filiere ?? 'solaire_sol',
  vue: 'carte',
  fond: prefs.fond ?? 'plan',
  theme: prefs.theme ?? 'systeme',
  iduSelectionne: null,
  idusSelectionnes: [],
  couchesActives: prefs.couchesActives ?? ['natura2000_habitats', 'zone_humide'],
  rayonRaccordementKm:
    prefs.rayonPersonnalise && prefs.rayonRaccordementKm != null
      ? prefs.rayonRaccordementKm
      : FILIERES_META[prefs.filiere ?? 'solaire_sol'].rayonRaccordementKm,
  rayonPersonnalise: prefs.rayonPersonnalise ?? false,
  afficherPostes: true,
  afficherReseauGaz: false,
  ponderations: prefs.ponderations ?? {},
  seuils: {},
  filtres: {},
  outil: 'aucun',
  avertissementsMasques: [],
  panneauGaucheOuvert: true,

  definirFiliere: (filiere) => {
    set({ filiere });
    // Le rayon de raccordement economique depend de la puissance evacuee, donc de la
    // filiere : il suit le changement tant que l'utilisateur ne l'a pas fixe lui-meme.
    if (!get().rayonPersonnalise) {
      set({ rayonRaccordementKm: FILIERES_META[filiere].rayonRaccordementKm });
    }
    // Le reseau gaz n'a de sens que pour la methanisation : on l'active et le desactive
    // avec la filiere, sans figer le choix de l'utilisateur ensuite.
    if (filiere === 'methanisation' && !get().afficherReseauGaz) set({ afficherReseauGaz: true });
    enregistrerPreferences(get());
  },
  definirVue: (vue) => set({ vue }),
  definirFond: (fond) => {
    set({ fond });
    enregistrerPreferences(get());
  },
  definirTheme: (theme) => {
    set({ theme });
    enregistrerPreferences(get());
  },
  selectionnerParcelle: (iduSelectionne) => set({ iduSelectionne }),
  basculerSelection: (idu) =>
    set((e) => ({
      idusSelectionnes: e.idusSelectionnes.includes(idu)
        ? e.idusSelectionnes.filter((i) => i !== idu)
        : [...e.idusSelectionnes, idu],
    })),
  viderSelection: () => set({ idusSelectionnes: [] }),
  basculerCouche: (id) => {
    set((e) => ({
      couchesActives: e.couchesActives.includes(id)
        ? e.couchesActives.filter((c) => c !== id)
        : [...e.couchesActives, id],
    }));
    enregistrerPreferences(get());
  },
  definirRayon: (rayonRaccordementKm) => {
    set({ rayonRaccordementKm, rayonPersonnalise: true });
    enregistrerPreferences(get());
  },
  reinitialiserRayon: () => {
    set((e) => ({
      rayonRaccordementKm: FILIERES_META[e.filiere].rayonRaccordementKm,
      rayonPersonnalise: false,
    }));
    enregistrerPreferences(get());
  },
  basculerPostes: () => set((e) => ({ afficherPostes: !e.afficherPostes })),
  basculerReseauGaz: () => set((e) => ({ afficherReseauGaz: !e.afficherReseauGaz })),
  definirPoids: (critereId, poids) => {
    set((e) => ({
      ponderations: {
        ...e.ponderations,
        [e.filiere]: { ...(e.ponderations[e.filiere] ?? {}), [critereId]: poids },
      },
    }));
    enregistrerPreferences(get());
  },
  reinitialiserPoids: () => {
    set((e) => ({ ponderations: { ...e.ponderations, [e.filiere]: {} }, seuils: { ...e.seuils, [e.filiere]: undefined } }));
    enregistrerPreferences(get());
  },
  definirSeuils: (seuilVert, seuilOrange) =>
    set((e) => ({ seuils: { ...e.seuils, [e.filiere]: { seuilVert, seuilOrange } } })),
  definirFiltres: (f) => set((e) => ({ filtres: { ...e.filtres, ...f } })),
  reinitialiserFiltres: () => set({ filtres: {} }),
  definirOutil: (outil) => set({ outil }),
  masquerAvertissement: (id) =>
    set((e) => ({ avertissementsMasques: [...e.avertissementsMasques, id] })),
  basculerPanneauGauche: () => set((e) => ({ panneauGaucheOuvert: !e.panneauGaucheOuvert })),
}));

/** Ponderation effective de la filiere courante, prete a etre envoyee a l'API. */
export function ponderationCourante(e: EtatApp): { poids?: Record<string, number>; seuilVert?: number; seuilOrange?: number } | undefined {
  const poids = e.ponderations[e.filiere];
  const seuils = e.seuils[e.filiere];
  if ((!poids || Object.keys(poids).length === 0) && !seuils) return undefined;
  return { ...(poids && Object.keys(poids).length > 0 ? { poids } : {}), ...(seuils ?? {}) };
}

export const STATUTS: StatutProspection[] = [
  'a_prospecter',
  'contact_pris',
  'en_negociation',
  'securise',
  'ecarte',
];

export const FEUX: Feu[] = ['vert', 'orange', 'rouge', 'gris'];
