/**
 * Carte MapLibre.
 *
 * Deux dimensions visuelles distinctes, exigence du cahier des charges :
 *   - le SCORE DE PROPICE gouverne le REMPLISSAGE des parcelles ;
 *   - l'ETAT DE PROSPECTION gouverne le CONTOUR (couleur et motif de tiretes).
 *
 * La coloration est faite par expression de style sur les attributs de la tuile vectorielle,
 * jamais cote serveur : changer de filiere ne fait que changer l'URL de la source, et un
 * deplacement de curseur de ponderation applique les nouveaux statuts par `setFeatureState`,
 * sans retelecharger les tuiles.
 */

import { useEffect, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification, type Map as CarteMapLibre } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feu } from '@enr/core';
import {
  api,
  jetonEnregistre,
  signalerSessionExpiree,
  RACINE_ABSOLUE,
  type PosteSourceProps,
  type Referentiel,
} from '../api/client.js';
import { ponderationCourante, useEtat, type FondCarte } from '../store/etat.js';
import { cercleGeodesique, formatSurface, surfaceAnneauHa, longueurLigneM, formatLongueur } from '../utils/geometrie.js';

/**
 * Cadrage d'ouverture : la France metropolitaine entiere, Corse comprise.
 *
 * On cadre sur des BORNES et non sur un couple centre/zoom : le zoom qui fait tenir la
 * France depend de la taille de la fenetre, et une valeur fixe couperait le pays sur un
 * ecran large ou laisserait du vide sur un ecran haut.
 */
const VUE_FRANCE: [[number, number], [number, number]] = [
  [-5.2, 41.3],
  [9.6, 51.1],
];

/**
 * Bornes de navigation : France metropolitaine, avec une marge de respiration.
 *
 * L'application ne couvre que ce territoire — les sources interrogees sont toutes
 * francaises. Laisser l'utilisateur naviguer sur l'Europe donnerait a croire le contraire,
 * et une emprise europeenne n'a de toute facon aucun sens pour une qualification. La marge
 * evite l'effet de butee desagreable au bord de la carte.
 */
const BORNES_FRANCE: [[number, number], [number, number]] = [
  [-6.2, 40.5],
  [10.6, 51.9],
];

/**
 * Zoom minimal. 4,6 et non 5 : sur une fenetre etroite, faire tenir la France demande un
 * zoom plus faible, et un plancher trop haut empecherait le cadrage d'ouverture d'aboutir.
 * Les bornes de navigation, elles, restent le vrai garde-fou.
 */
const ZOOM_MIN = 4.6;

/**
 * Zoom a partir duquel les parcelles sont servies. Doit rester aligne sur
 * `ZOOM_MIN_PARCELLES` cote API, qui refuse les tuiles en dessous : la valeur est donc
 * lue dans le referentiel et cette constante n'est qu'un repli.
 */
const ZOOM_MIN_PARCELLES_DEFAUT = 12;

/**
 * Police des etiquettes, servie par le relais de l'API.
 *
 * MapLibre exige une source de glyphes pour afficher le moindre libelle. La faire pointer
 * vers un domaine externe reviendrait a perdre les numeros de parcelle dans les reseaux
 * filtrants - exactement la situation ou le fond de carte est deja relaye.
 */
const POLICE_ETIQUETTES = ['Open Sans Regular'];
const URL_GLYPHES = `${RACINE_ABSOLUE}/api/carte/polices/{fontstack}/{range}.pbf`;

const TUILES_IGN = {
  plan:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
    '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  ortho:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
    '&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
};

const ATTRIBUTION = '&copy; IGN &mdash; Geoplateforme';

/**
 * Relais de tuiles servi par l'API.
 *
 * Les tuiles IGN sont demandees en direct par defaut : c'est le chemin le plus court et il
 * beneficie du reseau de diffusion de la Geoplateforme. Mais dans un reseau filtrant les
 * sorties, ou derriere un proxy que le navigateur ne traverse pas, `data.geopf.fr` est
 * injoignable depuis le poste alors que le serveur y accede sans peine. La carte bascule
 * alors automatiquement sur le relais, plutot que de rester vide.
 */
const TUILES_RELAIS: Record<FondCarte, string> = {
  plan: `${RACINE_ABSOLUE}/api/carte/fond/plan/{z}/{x}/{y}`,
  ortho: `${RACINE_ABSOLUE}/api/carte/fond/ortho/{z}/{x}/{y}`,
};

/**
 * Attache le jeton aux requetes de tuiles parcellaires.
 *
 * Ces tuiles portent le statut de prospection : l'API les protege desormais. MapLibre
 * charge les tuiles depuis un Web Worker, mais `transformRequest` est evalue sur le fil
 * principal - les en-tetes qu'il renvoie sont transmis au worker avec la requete. C'est le
 * seul point d'accroche possible : on ne peut pas poser d'en-tete sur une URL de source.
 *
 * Le filtre est volontairement etroit. Les tuiles IGN n'ont pas a recevoir notre jeton, et
 * les glyphes non plus : les envoyer a un tiers reviendrait a fuiter une authentification.
 */
function transformerRequete(url: string): maplibregl.RequestParameters {
  const jeton = jetonEnregistre();
  if (jeton && url.startsWith(`${RACINE_ABSOLUE}/api/carte/tuiles/parcelles/`)) {
    return { url, headers: { Authorization: `Bearer ${jeton}` } };
  }
  return { url };
}

/** Motifs de contour par statut de prospection, distincts du codage de score. */
const MOTIFS: Record<string, number[] | null> = {
  aucun: null,
  pointille: [1, 1.5],
  tiret: [3, 1.5],
  plein: null,
  hachure: [0.5, 1],
};

interface Props {
  referentiel: Referentiel;
  /** Expose l'instance MapLibre au parent (recentrages depuis la recherche et la liste). */
  onCarte?: (m: CarteMapLibre) => void;
}

export function Carte({ referentiel, onCarte }: Props): JSX.Element {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteMapLibre | null>(null);
  const [pret, setPret] = useState(false);
  const [zoom, setZoom] = useState(5.5);
  const [mesure, setMesure] = useState<{ points: [number, number][]; surfaceHa: number; longueurM: number } | null>(null);
  const [fondInjoignable, setFondInjoignable] = useState(false);
  /** Passe a `true` lorsque les appels directs a l'IGN ont echoue et que le relais prend le relais. */
  const [fondViaRelais, setFondViaRelais] = useState(false);
  /** Message d'echec d'installation des couches metier, affiche plutot que masque. */
  const [couchesEnEchec, setCouchesEnEchec] = useState<string | null>(null);

  const etat = useEtat();
  const {
    filiere,
    fond,
    couchesActives,
    calquesActifs,
    rayonRaccordementKm,
    afficherPostes,
    afficherReseauGaz,
    outil,
    idusSelectionnes,
    iduSelectionne,
  } = etat;

  // Reference stable pour les gestionnaires d'evenements MapLibre, qui sont installes une
  // seule fois mais doivent lire l'etat courant.
  const etatRef = useRef(etat);
  etatRef.current = etat;

  // Aligne sur le service de tuiles, qui refuse les tuiles en dessous de ce zoom.
  const ZOOM_MIN_PARCELLES = referentiel.carte?.zoomMinParcelles ?? ZOOM_MIN_PARCELLES_DEFAUT;
  const ZOOM_MAX_COMMUNES = referentiel.carte?.zoomMaxCommunes ?? ZOOM_MIN_PARCELLES;

  const couleurs = referentiel.palette.couleursScoreRemplissage;
  const couleurRedhibitoire = referentiel.palette.couleurRedhibitoireRemplissage;
  const couleursStatut = Object.fromEntries(
    referentiel.statutsProspection.map((s) => [s.id, s.couleur]),
  );

  // ------------------------------------------------------------------ init
  useEffect(() => {
    if (!conteneur.current || carte.current) return;

    const m = new maplibregl.Map({
      container: conteneur.current,
      bounds: VUE_FRANCE,
      fitBoundsOptions: { padding: 24 },
      maxZoom: 19,
      minZoom: ZOOM_MIN,
      maxBounds: BORNES_FRANCE,
      // Sans cela, MapLibre repete le monde a l'horizontale et `getBounds()` peut renvoyer
      // des longitudes hors de [-180, 180] : de quoi lancer une qualification sur une
      // emprise absurde.
      renderWorldCopies: false,
      attributionControl: false,
      transformRequest: transformerRequete,
      style: {
        version: 8,
        glyphs: URL_GLYPHES,
        sources: {
          fond: {
            type: 'raster',
            tiles: [TUILES_IGN.plan],
            tileSize: 256,
            attribution: ATTRIBUTION,
            maxzoom: 19,
          },
        },
        layers: [
          { id: 'fond-carte', type: 'raster', source: 'fond' },
        ],
      },
    });

    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // L'instance est exposee immediatement : `fitBounds` et `easeTo` sont utilisables des
    // la construction, et un fond de carte injoignable ne doit pas empecher la navigation.
    onCarte?.(m);

    /**
     * Installation des couches metier.
     *
     * On ne s'appuie PAS uniquement sur l'evenement `load` : celui-ci n'est emis que
     * lorsque toutes les sources du style sont resolues, si bien qu'un fond de carte
     * injoignable prive l'utilisateur des parcelles, des scores et des couches de
     * contraintes - c'est-a-dire de tout ce qui fait la valeur de l'application.
     * On declenche donc l'installation des que le STYLE est pret, quel que soit l'etat des
     * tuiles du fond.
     */
    let couchesInstallees = false;
    let tentatives = 0;
    const installer = (): void => {
      if (couchesInstallees) return;
      tentatives += 1;
      try {
        installerCouches(m, filiere);
        couchesInstallees = true;
        setPret(true);
      } catch (err) {
        // Une premiere tentative peut echouer parce que le style n'est pas encore
        // analysable ; la suivante aboutira. Mais une erreur persistante doit etre
        // VISIBLE : silencieuse, elle laisse une carte sans parcelles ni scores, ce qui
        // ressemble a une absence de donnees et non a un defaut de code.
        if (tentatives >= 2) {
          // eslint-disable-next-line no-console
          console.error('Installation des couches cartographiques impossible', err);
          setCouchesEnEchec((err as Error).message);
        }
      }
    };

    // `style.load` garantit que le style est analyse, sans attendre la resolution des
    // sources : c'est le bon moment pour ajouter les couches metier.
    m.on('style.load', installer);
    m.on('load', installer);
    // Filet de securite : si aucun des deux evenements n'aboutit (fond injoignable, style
    // partiellement resolu), l'application doit malgre tout afficher les parcelles.
    const filet = window.setTimeout(installer, 2000);
    m.on('zoomend', () => setZoom(m.getZoom()));
    m.on('moveend', () => {
      setZoom(m.getZoom());
      // L'emprise affichee est publiee dans l'etat : c'est elle qui borne la vue liste.
      const b = m.getBounds();
      etatRef.current.definirEmprise([
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]);
    });

    // Un fond de carte muet est indiscernable d'une application cassee. Plutot que de le
    // signaler et s'en tenir la, on bascule sur le relais servi par l'API.
    let echecsDirects = 0;
    let bascule = false;
    m.on('error', (evenement) => {
      // `sourceId` n'est pas declare sur le type d'evenement, mais MapLibre le fournit pour
      // les erreurs de source.
      const e = evenement as unknown as {
        sourceId?: string;
        error?: { url?: string; status?: number };
      };
      const url = e.error?.url ?? '';

      // Session expiree : les tuiles parcellaires sont authentifiees depuis qu'elles portent
      // le statut de prospection. Sans ce traitement, un jeton perime laisse une carte vide
      // et muette - l'utilisateur conclut a une panne alors qu'il lui suffit de se
      // reconnecter. MapLibre expose le statut HTTP sur `AJAXError`.
      if (e.error?.status === 401 && url.startsWith(RACINE_ABSOLUE)) {
        signalerSessionExpiree();
        return;
      }

      const estFondDirect = url.includes('data.geopf.fr/wmts');
      const estRelais = url.includes('/api/carte/fond/');

      if (estRelais) {
        // Le relais echoue aussi : le serveur n'atteint pas l'IGN non plus.
        setFondInjoignable(true);
        return;
      }
      if (!estFondDirect && e.sourceId !== 'fond') {
        // Toute autre erreur de source concerne les donnees metier : la taire reviendrait a
        // presenter une carte incomplete comme une carte vide. `AbortError` est en revanche
        // attendu : changer de filiere appelle `setTiles`, qui annule les requetes en vol.
        const nom = (e.error as { name?: string } | undefined)?.name;
        if (nom !== 'AbortError') {
          // eslint-disable-next-line no-console
          console.warn('Erreur de source cartographique', e.sourceId, e.error);
        }
        return;
      }

      echecsDirects += 1;
      if (echecsDirects >= 3 && !bascule) {
        bascule = true;
        setFondViaRelais(true);
      }
    });

    carte.current = m;
    return () => {
      window.clearTimeout(filet);
      m.remove();
      carte.current = null;
    };
    // Les couches sont installees une fois ; les effets suivants les mettent a jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Installe les sources et couches vectorielles. */
  function installerCouches(m: CarteMapLibre, f: string): void {
    // --- Communes (vue nationale) ---
    m.addSource('communes', {
      type: 'vector',
      tiles: [`${RACINE_ABSOLUE}/api/carte/tuiles/communes/{z}/{x}/{y}.mvt?filiere=${f}`],
      minzoom: 5,
      maxzoom: 13,
    });
    m.addLayer({
      id: 'communes-remplissage',
      type: 'fill',
      source: 'communes',
      'source-layer': 'communes',
      maxzoom: ZOOM_MAX_COMMUNES,
      paint: {
        /**
         * Une commune n'est coloree QUE si elle contient des parcelles qualifiees.
         *
         * Le piege corrige ici : `ST_AsMVT` omet purement et simplement les attributs nuls,
         * si bien qu'une commune sans score n'a pas d'attribut `nb_parcelles_qualifiees`.
         * Un test `== 0` est alors faux (null n'est pas 0), la conversion `to-number` donne
         * 0, le ratio vaut 0 et la commune se peignait en ROUGE. Resultat : la France
         * entiere apparaissait redhibitoire au lancement, alors que rien n'avait ete
         * analyse. `has` distingue l'attribut absent de la valeur zero.
         */
        'fill-color': [
          'case',
          ['!', ['has', 'nb_parcelles_qualifiees']],
          'rgba(0,0,0,0)',
          ['<=', ['to-number', ['get', 'nb_parcelles_qualifiees'], 0], 0],
          'rgba(0,0,0,0)',
          [
            'interpolate',
            ['linear'],
            [
              '/',
              ['to-number', ['get', 'nb_vert'], 0],
              ['max', ['to-number', ['get', 'nb_parcelles_qualifiees'], 1], 1],
            ],
            0,
            couleurs.rouge,
            0.35,
            couleurs.orange,
            0.7,
            couleurs.vert,
          ],
        ] as ExpressionSpecification,
        'fill-opacity': 0.5,
      },
    });
    m.addLayer({
      id: 'communes-contour',
      type: 'line',
      source: 'communes',
      'source-layer': 'communes',
      maxzoom: ZOOM_MAX_COMMUNES,
      paint: { 'line-color': '#64748b', 'line-width': 0.4, 'line-opacity': 0.5 },
    });

    // --- Parcelles ---
    m.addSource('parcelles', {
      type: 'vector',
      tiles: [`${RACINE_ABSOLUE}/api/carte/tuiles/parcelles/{z}/{x}/{y}.mvt?filiere=${f}`],
      minzoom: ZOOM_MIN_PARCELLES,
      maxzoom: 19,
      promoteId: 'idu',
    });

    // Remplissage = SCORE. `feature-state` a priorite : il permet la recoloration
    // instantanee au deplacement des curseurs de ponderation.
    m.addLayer({
      id: 'parcelles-remplissage',
      type: 'fill',
      source: 'parcelles',
      'source-layer': 'parcelles',
      minzoom: ZOOM_MIN_PARCELLES,
      paint: {
        'fill-color': expressionCouleurScore(couleurs, couleurRedhibitoire),
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selectionnee'], false],
          0.82,
          0.55,
        ] as ExpressionSpecification,
      },
    });

    // Contour de parcellaire : la delimitation doit rester lisible meme en vue large, ou
    // les parcelles sont petites et le remplissage seul ne suffit pas a les distinguer.
    m.addLayer({
      id: 'parcelles-limites',
      type: 'line',
      source: 'parcelles',
      'source-layer': 'parcelles',
      minzoom: ZOOM_MIN_PARCELLES,
      paint: {
        'line-color': 'rgba(15,23,42,0.65)',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          ZOOM_MIN_PARCELLES,
          0.7,
          15,
          0.9,
          18,
          1.4,
        ] as ExpressionSpecification,
      },
    });

    // Contour = ETAT DE PROSPECTION. Une couche par motif, car `line-dasharray` n'accepte
    // pas d'expression dependante des donnees dans MapLibre.
    for (const statut of referentiel.statutsProspection) {
      const motif = MOTIFS[statut.motif] ?? null;
      m.addLayer({
        id: `prospection-${statut.id}`,
        type: 'line',
        source: 'parcelles',
        'source-layer': 'parcelles',
        minzoom: ZOOM_MIN_PARCELLES,
        filter: ['==', ['get', 'statut_prospection'], statut.id],
        paint: {
          'line-color': statut.couleur,
          'line-width': 2.6,
          ...(motif ? { 'line-dasharray': motif } : {}),
        },
      });
    }

    /**
     * Numeros de parcelle.
     *
     * Le fond IGN ne les affiche qu'a tres fort zoom : cette couche les rend lisibles des
     * que le parcellaire est exploitable. `text-halo` est indispensable au-dessus de
     * l'ortho-photographie, ou un texte sans cerne devient illisible.
     */
    m.addLayer({
      id: 'parcelles-numeros',
      type: 'symbol',
      source: 'parcelles',
      'source-layer': 'parcelles',
      minzoom: 14.5,
      layout: {
        'text-field': [
          'step',
          ['zoom'],
          ['get', 'numero'],
          16.5,
          ['concat', ['get', 'section'], ' ', ['get', 'numero']],
        ] as ExpressionSpecification,
        'text-font': POLICE_ETIQUETTES,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 9, 18, 13] as ExpressionSpecification,
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': 'rgba(255,255,255,0.9)',
        'text-halo-width': 1.4,
      },
    });

    // Parcelle ouverte dans la fiche, et parcelles cochees pour un site.
    m.addLayer({
      id: 'parcelles-selection',
      type: 'line',
      source: 'parcelles',
      'source-layer': 'parcelles',
      minzoom: ZOOM_MIN_PARCELLES,
      filter: ['in', ['get', 'idu'], ['literal', []]],
      paint: { 'line-color': '#0f172a', 'line-width': 3, 'line-dasharray': [2, 1] },
    });
    m.addLayer({
      id: 'parcelle-active',
      type: 'line',
      source: 'parcelles',
      'source-layer': 'parcelles',
      minzoom: ZOOM_MIN_PARCELLES,
      filter: ['==', ['get', 'idu'], ''],
      paint: { 'line-color': '#0f172a', 'line-width': 3.4 },
    });

    // --- Couches de contraintes (GeoJSON charge a la demande) ---
    for (const couche of referentiel.couches) {
      if (['postes_sources', 'reseau_gaz'].includes(couche.id)) continue;
      m.addSource(`c-${couche.id}`, { type: 'geojson', data: vide() });
      if (couche.typeGeom === 'point') {
        m.addLayer({
          id: `c-${couche.id}`,
          type: 'circle',
          source: `c-${couche.id}`,
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 4,
            'circle-color': couche.couleur,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff',
          },
        });
      } else {
        m.addLayer({
          id: `c-${couche.id}`,
          type: 'fill',
          source: `c-${couche.id}`,
          layout: { visibility: 'none' },
          paint: { 'fill-color': couche.couleur, 'fill-opacity': 0.28 },
        });
        m.addLayer({
          id: `c-${couche.id}-contour`,
          type: 'line',
          source: `c-${couche.id}`,
          layout: { visibility: 'none' },
          paint: { 'line-color': couche.couleur, 'line-width': 1.1 },
        });
      }
    }

    /**
     * Calques du catalogue : images relayees et zonages vectoriels.
     *
     * Ils sont installes SOUS les parcelles — inseres avant `parcelles-remplissage` — pour
     * que le parcellaire et les scores restent au premier plan : une contrainte est un
     * contexte, pas le sujet.
     */
    const premiereCoucheMetier = 'parcelles-remplissage';
    for (const calque of referentiel.calques ?? []) {
      if (calque.mode === 'raster') {
        m.addSource(`k-${calque.id}`, {
          type: 'raster',
          tiles: [`${RACINE_ABSOLUE}/api/carte/calque/${calque.id}/{z}/{x}/{y}`],
          tileSize: 256,
          maxzoom: 18,
        });
        m.addLayer(
          {
            id: `k-${calque.id}`,
            type: 'raster',
            source: `k-${calque.id}`,
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0.6 },
          },
          premiereCoucheMetier,
        );
      } else if (calque.mode === 'vecteur_api') {
        m.addSource(`k-${calque.id}`, { type: 'geojson', data: vide() });
        m.addLayer(
          {
            id: `k-${calque.id}`,
            type: 'fill',
            source: `k-${calque.id}`,
            layout: { visibility: 'none' },
            paint: { 'fill-color': calque.couleur, 'fill-opacity': 0.22 },
          },
          premiereCoucheMetier,
        );
        m.addLayer(
          {
            id: `k-${calque.id}-contour`,
            type: 'line',
            source: `k-${calque.id}`,
            layout: { visibility: 'none' },
            paint: { 'line-color': calque.couleur, 'line-width': 1.3 },
          },
          premiereCoucheMetier,
        );
      }
    }

    // --- Rayons de raccordement, sous les postes ---
    m.addSource('rayons', { type: 'geojson', data: vide() });
    m.addLayer({
      id: 'rayons-remplissage',
      type: 'fill',
      source: 'rayons',
      paint: {
        'fill-color': [
          'match',
          ['get', 'etatSaturation'],
          'disponible', referentiel.palette.couleursSaturation['disponible'] ?? '#15803d',
          'tendu', referentiel.palette.couleursSaturation['tendu'] ?? '#d97706',
          'sature', referentiel.palette.couleursSaturation['sature'] ?? '#b91c1c',
          '#6b7280',
        ] as ExpressionSpecification,
        'fill-opacity': 0.08,
      },
    });
    m.addLayer({
      id: 'rayons-contour',
      type: 'line',
      source: 'rayons',
      paint: { 'line-color': '#0f766e', 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.5 },
    });

    // --- Reseau gaz ---
    m.addSource('gaz-canalisations', { type: 'geojson', data: vide() });
    m.addLayer({
      id: 'gaz-canalisations',
      type: 'line',
      source: 'gaz-canalisations',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#a16207', 'line-width': 1.8, 'line-dasharray': [4, 2] },
    });
    m.addSource('gaz-points', { type: 'geojson', data: vide() });
    m.addLayer({
      id: 'gaz-points',
      type: 'circle',
      source: 'gaz-points',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 5,
        'circle-color': '#a16207',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
      },
    });

    // --- Postes sources : symbole distinct par gestionnaire, couleur = saturation ---
    m.addSource('postes', { type: 'geojson', data: vide() });
    const couleurSaturation: ExpressionSpecification = [
      'match',
      ['get', 'etatSaturation'],
      'disponible', referentiel.palette.couleursSaturation['disponible'] ?? '#15803d',
      'tendu', referentiel.palette.couleursSaturation['tendu'] ?? '#d97706',
      'sature', referentiel.palette.couleursSaturation['sature'] ?? '#b91c1c',
      referentiel.palette.couleursSaturation['inconnu'] ?? '#6b7280',
    ];
    // RTE : carre (gestionnaire du reseau de transport). Enedis et autres GRD : cercle.
    m.addLayer({
      id: 'postes-rte',
      type: 'symbol',
      source: 'postes',
      filter: ['==', ['get', 'gestionnaire'], 'RTE'],
      layout: { 'icon-image': 'carre', 'icon-allow-overlap': true, 'icon-size': 1 },
      paint: {},
    });
    m.addLayer({
      id: 'postes-grd',
      type: 'circle',
      source: 'postes',
      filter: ['!=', ['get', 'gestionnaire'], 'RTE'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 12, 7] as ExpressionSpecification,
        'circle-color': couleurSaturation,
        'circle-stroke-width': 2,
        // Un poste en projet ou en renforcement est distingue par un contour clair.
        'circle-stroke-color': [
          'case',
          ['any', ['get', 'enProjet'], ['get', ['literal', 'prevu'], ['get', 'renforcement']]],
          '#ffffff',
          '#0f172a',
        ] as ExpressionSpecification,
        'circle-opacity': ['case', ['get', 'enProjet'], 0.55, 0.95] as ExpressionSpecification,
      },
    });

    // Le symbole carre est genere en memoire : aucune ressource externe n'est chargee.
    m.addImage('carre', imageCarre(), { pixelRatio: 2 });
    m.setPaintProperty('postes-rte', 'icon-color', couleurSaturation);
  }

  // ------------------------------------------------------------------ interactions
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;

    const surClic = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      if (!f) return;
      const idu = String(f.properties?.['idu'] ?? '');
      if (!idu) return;
      const e2 = etatRef.current;
      // Majuscule ou outil de selection : on coche la parcelle pour constituer un site.
      if (e.originalEvent.shiftKey || e2.outil === 'selection') {
        e2.basculerSelection(idu);
      } else {
        e2.selectionnerParcelle(idu);
      }
    };

    const surClicCommune = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      if (!f) return;
      // Un clic sur une commune zoome jusqu'au niveau parcellaire.
      m.easeTo({ center: e.lngLat, zoom: ZOOM_MIN_PARCELLES + 0.5, duration: 700 });
    };

    let popup: maplibregl.Popup | null = null;
    const surSurvolPoste = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      if (!f) return;
      m.getCanvas().style.cursor = 'pointer';
      popup?.remove();
      popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(htmlPoste(f.properties as unknown as PosteSourceProps, referentiel))
        .addTo(m);
    };
    const surSortiePoste = (): void => {
      m.getCanvas().style.cursor = '';
      popup?.remove();
      popup = null;
    };

    const curseurPointeur = (): void => {
      m.getCanvas().style.cursor = 'pointer';
    };
    const curseurNormal = (): void => {
      m.getCanvas().style.cursor = '';
    };

    m.on('click', 'parcelles-remplissage', surClic);
    m.on('click', 'communes-remplissage', surClicCommune);
    m.on('mouseenter', 'parcelles-remplissage', curseurPointeur);
    m.on('mouseleave', 'parcelles-remplissage', curseurNormal);
    for (const c of ['postes-grd', 'postes-rte']) {
      m.on('mousemove', c, surSurvolPoste);
      m.on('mouseleave', c, surSortiePoste);
    }

    return () => {
      m.off('click', 'parcelles-remplissage', surClic);
      m.off('click', 'communes-remplissage', surClicCommune);
      m.off('mouseenter', 'parcelles-remplissage', curseurPointeur);
      m.off('mouseleave', 'parcelles-remplissage', curseurNormal);
      for (const c of ['postes-grd', 'postes-rte']) {
        m.off('mousemove', c, surSurvolPoste);
        m.off('mouseleave', c, surSortiePoste);
      }
      popup?.remove();
    };
  }, [pret, referentiel]);

  // ------------------------------------------------------------------ fond de carte
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    const source = m.getSource('fond') as maplibregl.RasterTileSource | undefined;
    source?.setTiles([fondViaRelais ? TUILES_RELAIS[fond] : TUILES_IGN[fond]]);
  }, [fond, fondViaRelais, pret]);

  // ------------------------------------------------------------------ filiere
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    // Changer de filiere change l'URL des tuiles : le style, lui, reste identique.
    (m.getSource('parcelles') as maplibregl.VectorTileSource | undefined)?.setTiles([
      `${RACINE_ABSOLUE}/api/carte/tuiles/parcelles/{z}/{x}/{y}.mvt?filiere=${filiere}`,
    ]);
    (m.getSource('communes') as maplibregl.VectorTileSource | undefined)?.setTiles([
      `${RACINE_ABSOLUE}/api/carte/tuiles/communes/{z}/{x}/{y}.mvt?filiere=${filiere}`,
    ]);
  }, [filiere, pret]);

  // ------------------------------------------------------------------ selection
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    m.setFilter('parcelles-selection', ['in', ['get', 'idu'], ['literal', idusSelectionnes]]);
    m.setFilter('parcelle-active', ['==', ['get', 'idu'], iduSelectionne ?? '']);
  }, [idusSelectionnes, iduSelectionne, pret]);

  // ------------------------------------------------------------------ couches de contraintes
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;

    for (const couche of referentiel.couches) {
      if (['postes_sources', 'reseau_gaz'].includes(couche.id)) continue;
      const actif = couchesActives.includes(couche.id);
      for (const id of [`c-${couche.id}`, `c-${couche.id}-contour`]) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', actif ? 'visible' : 'none');
      }
    }

    if (couchesActives.length === 0) return;
    const b = m.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    let annule = false;
    void Promise.all(
      couchesActives.map(async (id) => {
        try {
          const fc = await api.couche(id, bbox);
          if (annule) return;
          (m.getSource(`c-${id}`) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        } catch {
          // Couche indisponible : elle reste vide, la carte demeure utilisable.
        }
      }),
    );
    return () => {
      annule = true;
    };
  }, [couchesActives, zoom, pret, referentiel]);

  // ------------------------------------------------------------------ calques
  /**
   * Activation des calques et chargement des zonages vectoriels.
   *
   * L'activation est instantanee : la visibilite est basculee immediatement, sans attendre
   * la moindre requete. Les images sont servies par le relais, donc rien a charger ici ; les
   * zonages vectoriels sont demandes pour l'emprise visible, avec un etat de chargement
   * expose a l'interface pour qu'un calque lent ne passe pas pour un calque vide.
   */
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;

    for (const calque of referentiel.calques ?? []) {
      const actif = calquesActifs.includes(calque.id);
      for (const id of [`k-${calque.id}`, `k-${calque.id}-contour`]) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', actif ? 'visible' : 'none');
      }
    }

    const vectoriels = (referentiel.calques ?? []).filter(
      (c) => c.mode === 'vecteur_api' && calquesActifs.includes(c.id),
    );
    if (vectoriels.length === 0) {
      etat.definirCalquesEnChargement([]);
      return;
    }

    const b = m.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];

    let annule = false;
    etat.definirCalquesEnChargement(vectoriels.map((c) => c.id));
    void Promise.all(
      vectoriels.map(async (calque) => {
        try {
          const fc = await api.zonage(calque.id, bbox);
          if (annule) return;
          (m.getSource(`k-${calque.id}`) as maplibregl.GeoJSONSource | undefined)?.setData(
            fc as unknown as GeoJSON.FeatureCollection,
          );
        } catch {
          // Service momentanement indisponible : le calque reste vide et l'interface le dira.
        } finally {
          if (!annule) {
            etat.definirCalquesEnChargement((precedents) => precedents.filter((id) => id !== calque.id));
          }
        }
      }),
    );
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calquesActifs, zoom, pret, referentiel]);

  // ------------------------------------------------------------------ postes et rayons
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;

    for (const id of ['postes-grd', 'postes-rte']) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', afficherPostes ? 'visible' : 'none');
    }
    for (const id of ['rayons-remplissage', 'rayons-contour']) {
      if (m.getLayer(id)) {
        m.setLayoutProperty(
          id,
          'visibility',
          afficherPostes && rayonRaccordementKm > 0 ? 'visible' : 'none',
        );
      }
    }
    if (!afficherPostes) return;

    const b = m.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    let annule = false;
    void api
      .postesSources(bbox, null)
      .then((fc) => {
        if (annule) return;
        (m.getSource('postes') as maplibregl.GeoJSONSource | undefined)?.setData(fc);
        // Les cercles sont calcules cote client : le curseur de rayon reagit instantanement.
        if (rayonRaccordementKm > 0) {
          (m.getSource('rayons') as maplibregl.GeoJSONSource | undefined)?.setData({
            type: 'FeatureCollection',
            features: fc.features.map((f) => ({
              type: 'Feature' as const,
              geometry: cercleGeodesique(f.geometry.coordinates, rayonRaccordementKm * 1000),
              properties: { etatSaturation: f.properties.etatSaturation, nom: f.properties.nom },
            })),
          });
        }
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [afficherPostes, rayonRaccordementKm, zoom, pret]);

  // ------------------------------------------------------------------ reseau gaz
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;
    for (const id of ['gaz-canalisations', 'gaz-points']) {
      if (m.getLayer(id)) {
        m.setLayoutProperty(id, 'visibility', afficherReseauGaz ? 'visible' : 'none');
      }
    }
    if (!afficherReseauGaz) return;
    const b = m.getBounds();
    let annule = false;
    void api
      .reseauGaz([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      .then((r) => {
        if (annule) return;
        (m.getSource('gaz-points') as maplibregl.GeoJSONSource | undefined)?.setData(r.pointsInjection);
        (m.getSource('gaz-canalisations') as maplibregl.GeoJSONSource | undefined)?.setData(r.canalisations);
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [afficherReseauGaz, zoom, pret]);

  // ------------------------------------------------------------------ recoloration par ponderation
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret || zoom < ZOOM_MIN_PARCELLES) return;
    const ponderation = ponderationCourante(etatRef.current);
    if (!ponderation) {
      // Retour au profil par defaut : les statuts de la tuile reprennent la main.
      m.removeFeatureState({ source: 'parcelles', sourceLayer: 'parcelles' });
      return;
    }

    const entites = m.querySourceFeatures('parcelles', { sourceLayer: 'parcelles' });
    const idus = [...new Set(entites.map((f) => String(f.properties?.['idu'] ?? '')).filter(Boolean))];
    if (idus.length === 0) return;

    let annule = false;
    void api
      .scoresLot(idus.slice(0, 2000), filiere, ponderation)
      .then(({ scores }) => {
        if (annule) return;
        for (const [idu, s] of Object.entries(scores)) {
          m.setFeatureState(
            { source: 'parcelles', sourceLayer: 'parcelles', id: idu },
            { statut: s.statut },
          );
        }
      })
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [etat.ponderations, etat.seuils, filiere, zoom, pret]);

  // ------------------------------------------------------------------ outils de dessin
  useEffect(() => {
    const m = carte.current;
    if (!m || !pret) return;

    if (!m.getSource('dessin')) {
      m.addSource('dessin', { type: 'geojson', data: vide() });
      m.addLayer({
        id: 'dessin-remplissage',
        type: 'fill',
        source: 'dessin',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#0f5b8a', 'fill-opacity': 0.16 },
      });
      m.addLayer({
        id: 'dessin-ligne',
        type: 'line',
        source: 'dessin',
        paint: { 'line-color': '#0f5b8a', 'line-width': 2.2 },
      });
      m.addLayer({
        id: 'dessin-sommets',
        type: 'circle',
        source: 'dessin',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#fff',
          'circle-stroke-color': '#0f5b8a',
          'circle-stroke-width': 2,
        },
      });
    }

    if (outil !== 'polygone' && outil !== 'mesure') {
      (m.getSource('dessin') as maplibregl.GeoJSONSource | undefined)?.setData(vide());
      setMesure(null);
      m.getCanvas().style.cursor = '';
      return;
    }

    m.getCanvas().style.cursor = 'crosshair';
    const points: [number, number][] = [];

    const rafraichir = (): void => {
      const traits: GeoJSON.Feature[] = points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p },
        properties: {},
      }));
      if (points.length >= 2) {
        traits.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: outil === 'polygone' ? [...points, points[0]!] : points },
          properties: {},
        });
      }
      if (outil === 'polygone' && points.length >= 3) {
        traits.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...points, points[0]!]] },
          properties: {},
        });
      }
      (m.getSource('dessin') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: traits,
      });
      setMesure({
        points: [...points],
        surfaceHa: points.length >= 3 ? surfaceAnneauHa([...points, points[0]!]) : 0,
        longueurM: longueurLigneM(outil === 'polygone' && points.length >= 3 ? [...points, points[0]!] : points),
      });
    };

    const surClic = (e: maplibregl.MapMouseEvent): void => {
      points.push([e.lngLat.lng, e.lngLat.lat]);
      rafraichir();
    };
    const surDoubleClic = (e: maplibregl.MapMouseEvent): void => {
      e.preventDefault();
    };

    m.on('click', surClic);
    m.on('dblclick', surDoubleClic);
    return () => {
      m.off('click', surClic);
      m.off('dblclick', surDoubleClic);
    };
  }, [outil, pret]);

  const enVueNationale = zoom < ZOOM_MIN_PARCELLES;

  return (
    <>
      <div ref={conteneur} className="carte" role="application" aria-label="Carte de prospection" />

      {/* Echec d'installation des couches metier.
          Le message etait capture par `setCouchesEnEchec` mais n'etait affiche nulle part :
          l'utilisateur voyait une carte sans parcelles ni scores, ce qui ressemble a une
          absence de donnees et non a un defaut technique. C'est le cas le plus grave des
          trois, d'ou `alert` plutot que `status`. */}
      {couchesEnEchec && (
        <div className="erreur-encart" style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 5 }} role="alert">
          <strong>Couches cartographiques non installees</strong>
          <p style={{ margin: '4px 0 0' }}>
            Les parcelles, les scores et les contraintes ne peuvent pas s&apos;afficher :{' '}
            {couchesEnEchec}. Rechargez la page ; si le probleme persiste, signalez ce message.
          </p>
        </div>
      )}

      {/* Ces bandeaux apparaissent sans interaction, a la suite d'un echec reseau : ils
          doivent etre annonces, sinon l'information n'existe que visuellement. */}
      {fondInjoignable && (
        <div className="indice-zoom" style={{ bottom: 68 }} role="status" aria-live="polite">
          Fond cartographique IGN injoignable, y compris depuis le serveur : verifiez
          l&apos;acces a data.geopf.fr. Les parcelles, couches et scores restent utilisables.
        </div>
      )}

      {fondViaRelais && !fondInjoignable && (
        <div className="indice-zoom" style={{ bottom: 68 }} role="status" aria-live="polite">
          Fond cartographique servi via le relais de l&apos;application : l&apos;acces direct a
          data.geopf.fr est bloque depuis ce poste.
        </div>
      )}

      {enVueNationale && (
        <div className="indice-zoom">
          Vue nationale : potentiel par commune. Zoomez jusqu&apos;au niveau {ZOOM_MIN_PARCELLES} pour
          afficher les parcelles.
        </div>
      )}

      {mesure && mesure.points.length > 0 && (
        <div className="mesure-info">
          {outil === 'polygone' ? (
            <>
              <span>
                <strong>Surface</strong> {formatSurface(mesure.surfaceHa)}
              </span>
              <span>
                <strong>Perimetre</strong> {formatLongueur(mesure.longueurM)}
              </span>
            </>
          ) : (
            <span>
              <strong>Distance</strong> {formatLongueur(mesure.longueurM)}
            </span>
          )}
          <span style={{ color: 'var(--texte-faible)', fontSize: 11 }}>
            {mesure.points.length} point{mesure.points.length > 1 ? 's' : ''} &mdash; cliquez pour
            ajouter
          </span>
          {outil === 'polygone' && mesure.points.length >= 3 && (
            <button
              type="button"
              className="bouton bouton-principal"
              onClick={() => {
                const nom = window.prompt('Nom du site a creer :', 'Nouveau site');
                if (!nom) return;
                void api
                  .creerSite({
                    nom,
                    filiere,
                    geometrie: {
                      type: 'Polygon',
                      coordinates: [[...mesure.points, mesure.points[0]!]],
                    },
                  })
                  .then((s) => {
                    window.alert(
                      `Site « ${s.nom} » cree : ${s.idus.length} parcelle(s), ${s.surfaceHa ?? 0} ha, score ${s.scoreGlobal ?? 'non calcule'}.`,
                    );
                    useEtat.getState().definirOutil('aucun');
                  })
                  .catch((err: Error) => window.alert(`Creation impossible : ${err.message}`));
              }}
            >
              Creer un site
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Expression de couleur du remplissage.
 * `feature-state.statut` prime sur l'attribut de la tuile : c'est ce qui rend la
 * recoloration immediate lorsque l'utilisateur modifie les ponderations.
 */
/**
 * Couleur de remplissage d'une parcelle.
 *
 * Trois situations a ne pas confondre, et c'est tout l'enjeu :
 *   - parcelle NON QUALIFIEE (aucun score en base) : elle n'est pas coloree du tout. Seul son
 *     contour la signale. Une couleur supposerait un jugement qui n'a pas ete porte ;
 *   - parcelle qualifiee mais a couverture de donnees insuffisante : GRIS, statut a part
 *     entiere qui dit « l'application ne sait pas » ;
 *   - parcelle qualifiee et jugee : vert, orange ou rouge.
 *
 * `feature-state` prime, pour permettre la recoloration instantanee au deplacement des
 * curseurs de ponderation sans retelecharger les tuiles.
 */
function expressionCouleurScore(
  couleurs: Record<Feu, string>,
  couleurRedhibitoire: string,
): ExpressionSpecification {
  return [
    'case',
    // Ni statut recalcule a la volee, ni statut materialise : parcelle non analysee.
    [
      'all',
      ['!', ['to-boolean', ['feature-state', 'statut']]],
      ['!', ['has', 'statut_score']],
    ],
    'rgba(0,0,0,0)',
    /**
     * Critere eliminatoire declenche : rouge sombre, distinct du rouge de score faible.
     *
     * « Impossible en l'etat du droit » et « mal classe » n'appellent pas la meme decision,
     * et c'est sur la carte que se decide l'envoi d'un prospecteur. L'attribut etait deja
     * transporte par la tuile ; il n'etait simplement pas lu.
     *
     * Le recalcul a la volee des ponderations ne change pas les knock-outs - ils sont
     * reglementaires, pas ponderes - donc l'attribut de tuile fait foi meme lorsqu'un
     * `feature-state` surcharge le statut.
     */
    ['>', ['coalesce', ['get', 'nb_knock_outs'], 0], 0],
    couleurRedhibitoire,
    [
      'match',
      ['coalesce', ['feature-state', 'statut'], ['get', 'statut_score'], 'gris'],
      'vert',
      couleurs.vert,
      'orange',
      couleurs.orange,
      'rouge',
      couleurs.rouge,
      couleurs.gris,
    ],
  ] as ExpressionSpecification;
}

function vide(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** Symbole carre pour les postes RTE, genere sans ressource externe. */
function imageCarre(): { width: number; height: number; data: Uint8Array } {
  const t = 22;
  const data = new Uint8Array(t * t * 4);
  for (let y = 0; y < t; y += 1) {
    for (let x = 0; x < t; x += 1) {
      const i = (y * t + x) * 4;
      const bord = x < 3 || y < 3 || x >= t - 3 || y >= t - 3;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = bord ? 255 : 200;
    }
  }
  return { width: t, height: t, data };
}

function htmlPoste(p: PosteSourceProps, r: Referentiel): string {
  const echapper = (s: unknown): string =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const etat = p.etatSaturation ?? 'inconnu';
  const libelleEtat = r.palette.libellesSaturation[etat] ?? 'Etat inconnu';
  const couleur = r.palette.couleursSaturation[etat] ?? '#6b7280';

  const lignes: Array<[string, string]> = [];
  if (p.tension) lignes.push(['Tension', echapper(p.tension)]);
  lignes.push([
    'Capacite residuelle',
    p.capaciteResiduelleMw != null ? `${p.capaciteResiduelleMw} MW` : 'non publiee',
  ]);
  if (p.fileAttenteMw != null) lignes.push(["File d'attente", `${p.fileAttenteMw} MW`]);
  if (p.quotePartEurParKw != null) lignes.push(['Quote-part', `${p.quotePartEurParKw} EUR/kW`]);
  if (p.renforcement?.prevu) {
    lignes.push([
      'Renforcement',
      echapper(p.renforcement.horizon ?? 'programme') +
        (p.renforcement.capaciteAttendueMw != null ? ` (+${p.renforcement.capaciteAttendueMw} MW)` : ''),
    ]);
  }
  if (p.enProjet) lignes.push(['Statut', 'poste en projet']);
  if (p.dateDonnee) lignes.push(['Donnee du', echapper(p.dateDonnee)]);

  return `<div class="popup-poste">
    <h4>${echapper(p.nom)}</h4>
    <div style="font-size:11.5px;margin-bottom:5px">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${couleur};margin-right:5px"></span>
      ${echapper(p.gestionnaire)} &mdash; ${echapper(libelleEtat)}
    </div>
    <dl>${lignes.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <p class="note">Capacite indicative (Capareseau), non engageante : seule une etude de
    raccordement puis une proposition technique et financiere engagent une capacite.</p>
  </div>`;
}
