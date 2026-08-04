/** Routes de referentiel et de sante : tout ce dont le frontend a besoin au demarrage. */

import type { FastifyInstance } from 'fastify';
import {
  AVERTISSEMENTS,
  COULEURS_SATURATION,
  COULEURS_SCORE,
  COULEURS_SCORE_REMPLISSAGE,
  COULEUR_REDHIBITOIRE,
  COULEUR_REDHIBITOIRE_REMPLISSAGE,
  CRITERES,
  DESCRIPTIONS_SCORE,
  DESCRIPTION_REDHIBITOIRE,
  FAMILLES_LIBELLES,
  FILIERES,
  FILIERES_META,
  LIBELLES_SATURATION,
  LIBELLES_SCORE,
  LIBELLE_REDHIBITOIRE,
  PONDERATIONS_DEFAUT,
  REFERENTIEL_DERNIERE_VERIFICATION,
  REGLES,
  STATUTS_PROSPECTION,
  STATUTS_PROSPECTION_META,
} from '@enr/core';
import { VERSION_MOTEUR, LIBELLES_REGIME, RESERVE_REGIME } from '@enr/scoring';
import { bddDisponible, requeteUne } from '../bdd.js';
import { config } from '../config.js';
import { CALQUES } from '../calques.js';
import { etatAmorcage } from '../amorcage.js';
import {
  compterContraintes,
  compterPostes,
  etatSources,
  sourcesPerimees,
} from '../depots/sources.js';

/** Couches cartographiques exposees au frontend, avec leur presentation. */
export const COUCHES = [
  { id: 'postes_sources', libelle: 'Postes sources', groupe: 'reseaux', typeGeom: 'point', couleur: '#0f766e' },
  { id: 'reseau_gaz', libelle: 'Reseau gaz et injection', groupe: 'reseaux', typeGeom: 'ligne', couleur: '#a16207' },
  { id: 'natura2000_habitats', libelle: 'Natura 2000 - habitats', groupe: 'environnement', typeGeom: 'polygone', couleur: '#15803d' },
  { id: 'natura2000_oiseaux', libelle: 'Natura 2000 - oiseaux', groupe: 'environnement', typeGeom: 'polygone', couleur: '#22c55e' },
  { id: 'znieff1', libelle: 'ZNIEFF de type I', groupe: 'environnement', typeGeom: 'polygone', couleur: '#65a30d' },
  { id: 'znieff2', libelle: 'ZNIEFF de type II', groupe: 'environnement', typeGeom: 'polygone', couleur: '#a3e635' },
  { id: 'reserve_naturelle', libelle: 'Reserves naturelles', groupe: 'environnement', typeGeom: 'polygone', couleur: '#166534' },
  { id: 'appb', libelle: 'Protection de biotope (APPB)', groupe: 'environnement', typeGeom: 'polygone', couleur: '#14532d' },
  { id: 'parc_national', libelle: 'Parcs nationaux', groupe: 'environnement', typeGeom: 'polygone', couleur: '#047857' },
  { id: 'parc_naturel_regional', libelle: 'Parcs naturels regionaux', groupe: 'environnement', typeGeom: 'polygone', couleur: '#5eead4' },
  { id: 'zone_humide', libelle: 'Zones humides (pre-reperage)', groupe: 'environnement', typeGeom: 'polygone', couleur: '#0891b2' },
  { id: 'monument_historique', libelle: 'Monuments historiques', groupe: 'patrimoine', typeGeom: 'point', couleur: '#7c3aed' },
  { id: 'site_classe', libelle: 'Sites classes', groupe: 'patrimoine', typeGeom: 'polygone', couleur: '#6d28d9' },
  { id: 'site_inscrit', libelle: 'Sites inscrits', groupe: 'patrimoine', typeGeom: 'polygone', couleur: '#a78bfa' },
  { id: 'ppri', libelle: 'Risque inondation (PPRI)', groupe: 'risques', typeGeom: 'polygone', couleur: '#1d4ed8' },
  { id: 'pprif', libelle: 'Risque incendie (PPRif)', groupe: 'risques', typeGeom: 'polygone', couleur: '#ea580c' },
  { id: 'pprt', libelle: 'Risque technologique (PPRT)', groupe: 'risques', typeGeom: 'polygone', couleur: '#be123c' },
  { id: 'radar', libelle: 'Radars et servitudes aeronautiques', groupe: 'risques', typeGeom: 'polygone', couleur: '#9f1239' },
  { id: 'zaer', libelle: "Zones d'acceleration des ENR", groupe: 'urbanisme', typeGeom: 'polygone', couleur: '#0284c7' },
  { id: 'document_cadre_pv', libelle: 'Document-cadre PV au sol', groupe: 'urbanisme', typeGeom: 'polygone', couleur: '#0369a1' },
  { id: 'aoc_viticole', libelle: 'Aires AOP viticoles', groupe: 'agriculture', typeGeom: 'polygone', couleur: '#86198f' },
  { id: 'elevage', libelle: "Exploitations d'elevage", groupe: 'agriculture', typeGeom: 'point', couleur: '#b45309' },
  { id: 'industrie_agroalimentaire', libelle: 'Industries agroalimentaires', groupe: 'agriculture', typeGeom: 'point', couleur: '#92400e' },
] as const;

export async function routesReferentiel(app: FastifyInstance): Promise<void> {
  app.get('/api/sante', async () => {
    const [bdd, sources, perimees] = await Promise.all([
      bddDisponible(),
      etatSources().catch(() => []),
      sourcesPerimees().catch(() => []),
    ]);
    const amorcage = etatAmorcage();

    /**
     * Configurations FATALES : l'instance demarre, mais aucune route protegee ne peut repondre.
     *
     * Sans ce controle, `/api/sante` repondait `statut: 'ok'` alors que toute route protegee
     * renvoyait 500 `configuration_invalide` : un deploiement passait au vert sur une instance
     * entierement inoperante, et une bascule de trafic y envoyait les utilisateurs. Une sonde de
     * sante qui ignore la cause d'une panne totale ne remplit pas son office.
     *
     * Le choix d'echouer a la requete plutot qu'au demarrage reste le bon — cela echoue ferme et
     * laisse `/api/sante` diagnostiquer — mais il exige que la sonde le sache.
     */
    const configurationsFatales: string[] = [];
    if (config.auth.desactivee && config.env === 'production') {
      configurationsFatales.push(
        'AUTH_DESACTIVEE est actif en production : toutes les routes protegees repondent en erreur. ' +
          'Retirez cette variable.',
      );
    }
    const fatale = configurationsFatales.length > 0;

    return {
      // `hors_service` et non `degrade` : degrade signifie « fonctionne moins bien », ici rien ne
      // fonctionne. Une sonde de deploiement doit pouvoir distinguer les deux.
      statut: fatale ? 'hors_service' : bdd ? 'ok' : 'degrade',
      version: '0.1.0',
      versionMoteur: VERSION_MOTEUR,
      baseDeDonnees: bdd ? 'ok' : 'indisponible',
      /** Vide en fonctionnement normal. Non vide : l'instance ne doit pas recevoir de trafic. */
      configurationsFatales,
      // Avancement du chargement initial des donnees nationales : sans cette information,
      // un premier demarrage donne une carte vide sans explication.
      amorcage,
      sources,
      sourcesPerimees: perimees,
    };
  });

  app.get('/api/referentiel', async () => {
    /**
     * Volumetrie reelle de chaque couche.
     *
     * Une case a cocher qui n'affiche jamais rien est pire qu'une case absente :
     * l'utilisateur conclut que l'application est cassee. L'interface a donc besoin de
     * savoir quelles couches sont effectivement ingerees. Les couches de reseaux ne
     * viennent pas de `contrainte` et sont traitees a part.
     */
    const volumetrie = await compterContraintes().catch(() => ({}) as Record<string, number>);
    const postes = await compterPostes().catch(() => ({ total: 0, parEtat: {} }));
    const gaz = await requeteUne<{ n: number }>(
      'SELECT count(*)::int AS n FROM point_injection_gaz',
    ).catch(() => null);

    const nbObjetsCouche = (id: string): number => {
      if (id === 'postes_sources') return postes.total;
      if (id === 'reseau_gaz') return gaz?.n ?? 0;
      return volumetrie[id] ?? 0;
    };

    return {
      filieres: FILIERES.map((f) => FILIERES_META[f]),
      criteres: CRITERES,
      famillesLibelles: FAMILLES_LIBELLES,
      ponderationsDefaut: PONDERATIONS_DEFAUT,
      reglementation: REGLES,
      libellesRegime: LIBELLES_REGIME,
      // Reserve attachee au regime : il est DEDUIT de la nature du sol, pas etabli.
      reserveRegime: RESERVE_REGIME,
      referentielDerniereVerification: REFERENTIEL_DERNIERE_VERIFICATION,
      avertissements: AVERTISSEMENTS,
      palette: {
        couleursScore: COULEURS_SCORE,
        couleursScoreRemplissage: COULEURS_SCORE_REMPLISSAGE,
        libellesScore: LIBELLES_SCORE,
        descriptionsScore: DESCRIPTIONS_SCORE,
        couleursSaturation: COULEURS_SATURATION,
        libellesSaturation: LIBELLES_SATURATION,
        // Le redhibitoire est une CINQUIEME entree de legende, pas un quatrieme statut :
        // il se superpose au rouge pour distinguer « impossible » de « mal classe ».
        couleurRedhibitoire: COULEUR_REDHIBITOIRE,
        couleurRedhibitoireRemplissage: COULEUR_REDHIBITOIRE_REMPLISSAGE,
        libelleRedhibitoire: LIBELLE_REDHIBITOIRE,
        descriptionRedhibitoire: DESCRIPTION_REDHIBITOIRE,
      },
      statutsProspection: STATUTS_PROSPECTION.map((s) => STATUTS_PROSPECTION_META[s]),
      // `nbObjets` dit la verite sur chaque couche : 0 signifie « rien a afficher »,
      // ce que l'interface doit annoncer au lieu de laisser croire a une panne.
      couches: COUCHES.map((c) => ({ ...c, nbObjets: nbObjetsCouche(c.id) })),
      /**
       * Calques cartographiques, avec leur etat.
       *
       * Trois etats seulement, et jamais « non ingere » : ce que l'utilisateur doit savoir,
       * c'est si le calque s'affichera ou non, pas comment il est alimente en interne.
       *   - `disponible`   : le calque s'affiche des activation ;
       *   - `zoom_requis`  : il s'affichera, mais le service ne produit rien en vue large ;
       *   - `indisponible` : rien a afficher (uniquement si la base est vide pour un calque
       *                      qui en depend).
       */
      calques: CALQUES.map((c) => ({
        id: c.id,
        libelle: c.libelle,
        groupe: c.groupe,
        couleur: c.couleur,
        mode: c.mode,
        legende: c.legende,
        avertissement: c.avertissement ?? null,
        zoomMin: c.zoomMin ?? null,
        source: c.source,
        etat:
          c.mode === 'vecteur_base' && (volumetrie[c.typeBase ?? ''] ?? 0) === 0
            ? 'indisponible'
            : c.zoomMin != null
              ? 'zoom_requis'
              : 'disponible',
        nbObjets: c.mode === 'vecteur_base' ? (volumetrie[c.typeBase ?? ''] ?? 0) : null,
      })),
      // Reglages de carte : le client les lit ici plutot que de dupliquer des constantes
      // qui doivent rester alignees sur celles du service de tuiles. Le rayon de
      // raccordement par defaut est deja porte par chaque filiere ci-dessus.
      carte: {
        zoomMinParcelles: config.carte.zoomMinParcelles,
        zoomMaxCommunes: config.carte.zoomMaxCommunes,
      },
    };
  });
}
