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
import { config, configurationsFatales } from '../config.js';
import { CALQUES } from '../calques.js';
import { etatAmorcage } from '../amorcage.js';
import { nbARafraichir } from '../depots/parcelles.js';
import { empreinteReferentiel } from './divers.js';
import {
  compterContraintes,
  compterPostes,
  etatSources,
  sourcesPerimees,
} from '../depots/sources.js';

/** Couches cartographiques exposees au frontend, avec leur presentation. */
/**
 * Couches servies par le service de tuiles depuis la base, avec leur presentation.
 *
 * NE CONTIENT QUE CE QUI PEUT S'AFFICHER. Ce catalogue en comptait 21 entrees dont 18 restaient
 * grisees, sous une note affirmant qu'elles « ne peuvent rien afficher » — alors que sept d'entre
 * elles (Natura 2000 habitats et oiseaux, ZNIEFF 1 et 2, reserves naturelles, parcs nationaux et
 * regionaux) etaient PLEINEMENT FONCTIONNELLES dans le panneau « Calques cartographiques », sous
 * le meme nom, en interrogeant les services en direct. L'utilisateur voyait donc la meme couche
 * deux fois : une fois desactivee avec une explication fausse, une fois active et utile.
 *
 * La regle est desormais simple : une couche ne figure ici que si une ingestion l'alimente. Tout
 * le reste releve de `CALQUES` (voir `apps/api/src/calques.ts`), qui porte son propre etat, sa
 * source et son millesime.
 */
export const COUCHES = [
  { id: 'postes_sources', libelle: 'Postes sources', groupe: 'reseaux', typeGeom: 'point', couleur: '#0f766e' },
  { id: 'reseau_gaz', libelle: 'Reseau gaz et injection', groupe: 'reseaux', typeGeom: 'ligne', couleur: '#a16207' },
  { id: 'monument_historique', libelle: 'Monuments historiques', groupe: 'patrimoine', typeGeom: 'point', couleur: '#7c3aed' },
] as const;

export async function routesReferentiel(app: FastifyInstance): Promise<void> {
  app.get('/api/sante', async () => {
    const [bdd, sources, perimees, aRafraichir] = await Promise.all([
      bddDisponible(),
      etatSources().catch(() => []),
      sourcesPerimees().catch(() => []),
      /**
       * Parcelles en retard sur la donnee — audit 9, defaut A2.
       *
       * Ce retard etait purement invisible : un snapshot ne vieillissait que par son age, et
       * l'empreinte du moteur ne couvre pas la donnee. Apres une ingestion, la carte et les listes
       * continuaient d'afficher l'etat d'avant, sans qu'aucun indicateur ne l'indique.
       */
      nbARafraichir().catch(() => null),
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
    /**
     * Le calcul vit dans `config.ts` — voir `configurationsFatales()` — et non ici.
     *
     * POURQUOI IL A DEMENAGE, audit 11. Ecrit en ligne, il lisait le `config` global : pour
     * l'exercer il fallait lancer un vrai serveur avec un environnement prepare, ce qu'aucun test
     * ne faisait. Il etait donc faux sans que rien ne le dise — il ignorait `MODE_BUREAU`, donc
     * declarait l'application de bureau `hors_service` a la seconde ou ses routes protegees
     * rendaient 200, et prescrivait de retirer la variable qui la fait marcher. Deplace et
     * parametre, il est teste en quatre cas sans lancer quoi que ce soit.
     */
    const fatales = configurationsFatales(config);
    const fatale = fatales.length > 0;

    return {
      // `hors_service` et non `degrade` : degrade signifie « fonctionne moins bien », ici rien ne
      // fonctionne. Une sonde de deploiement doit pouvoir distinguer les deux.
      statut: fatale ? 'hors_service' : bdd ? 'ok' : 'degrade',
      version: '0.1.0',
      versionMoteur: VERSION_MOTEUR,
      baseDeDonnees: bdd ? 'ok' : 'indisponible',
      /** Vide en fonctionnement normal. Non vide : l'instance ne doit pas recevoir de trafic. */
      configurationsFatales: fatales,
      // Avancement du chargement initial des donnees nationales : sans cette information,
      // un premier demarrage donne une carte vide sans explication.
      amorcage,
      sources,
      sourcesPerimees: perimees,
      /**
       * Nombre de parcelles dont le snapshot est absent, perime par l'age, ou anterieur a la
       * derniere ingestion touchant leur departement. `null` si la base n'a pas repondu.
       *
       * Non nul apres une ingestion : les parcelles concernees affichent l'etat d'avant jusqu'a
       * leur prochaine consultation ou un appel a `POST /api/qualification/rafraichir`.
       */
      parcellesARafraichir: aRafraichir,
    };
  });

  app.get('/api/referentiel', async (req, rep) => {
    /**
     * Validation par ETag.
     *
     * Le referentiel est la plus grosse reponse de l'API — catalogue des criteres, reglementation
     * datee, ponderations, avertissements, palette, couches — et il ne change qu'au deploiement
     * ou lorsqu'une couche est ingeree. Le renvoyer entier a chaque chargement de page est du
     * gaspillage pur.
     *
     * `empreinteReferentiel()` existait depuis le troisieme audit et n'etait appelee par
     * personne : c'est le troisieme mecanisme ecrit puis oublie du projet. L'empreinte couvre les
     * ponderations et la version du moteur, donc tout changement de calcul invalide le cache.
     */
    const etag = `W/"${empreinteReferentiel()}"`;
    if (req.headers['if-none-match'] === etag) return rep.code(304).send();
    rep.header('ETag', etag);
    // `no-cache` et non `no-store` : le client doit revalider a chaque fois, mais il a le droit
    // de garder la reponse et de recevoir un 304. Un referentiel servi depuis un cache sans
    // revalidation ferait afficher une reglementation perimee, ce qui est exclu.
    rep.header('Cache-Control', 'no-cache');

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
