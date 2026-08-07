/**
 * Assemblage de l'application.
 *
 * Le referentiel est charge une seule fois au demarrage : il porte les filieres, les criteres,
 * la reglementation datee, la palette et les avertissements non negociables. Sans lui,
 * l'interface ne peut pas etre coherente : on affiche alors un ecran d'erreur explicite
 * plutot qu'une carte muette.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import {
  api,
  definirJeton,
  ErreurApi,
  jetonEnregistre,
  reinitialiserDetectionSession,
  RACINE_ABSOLUE,
  surSessionExpiree,
  type Amorcage,
  type LigneListe,
  type ResultatRecherche,
} from './api/client.js';
import { Connexion } from './components/Connexion.js';
import { accueilDejaVu, Demarrage } from './components/Demarrage.js';
import { useEtat } from './store/etat.js';
import { BarreSuperieure, Icone } from './components/BarreSuperieure.js';
import { PanneauGauche } from './components/PanneauGauche.js';
import { Carte } from './components/Carte.js';
import { FicheParcelle } from './components/FicheParcelle.js';
import { VueListe } from './components/VueListe.js';
import { TableauDeBord } from './components/TableauDeBord.js';

export function App(): JSX.Element {
  const etat = useEtat();
  const carteRef = useRef<maplibregl.Map | null>(null);
  const clientRequetes = useQueryClient();
  /**
   * Ecran d'ouverture. Il se superpose a l'application au lieu de la remplacer : le
   * referentiel et la carte se chargent DERRIERE l'animation, qui n'ajoute donc aucune
   * attente. Il n'apparait qu'une fois par session.
   */
  const [accueil, setAccueil] = useState(!accueilDejaVu());

  /**
   * Session expiree signalee ailleurs dans l'application - typiquement par une tuile
   * cartographique, dont l'echec ne remonte a aucun composant React.
   */
  const [sessionExpiree, setSessionExpiree] = useState(false);
  useEffect(() => surSessionExpiree(() => setSessionExpiree(true)), []);

  // Identite de l'utilisateur : en mode developpement l'API repond sans jeton, et l'ecran
  // de connexion n'apparait jamais. En mode authentifie, un 401 le declenche.
  const moi = useQuery({
    queryKey: ['moi'],
    queryFn: () => api.moi(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const referentiel = useQuery({
    queryKey: ['referentiel'],
    queryFn: () => api.referentiel(),
    staleTime: Infinity,
    retry: 2,
  });

  const sante = useQuery({
    queryKey: ['sante'],
    queryFn: () => api.sante(),
    // Pendant le chargement initial des donnees nationales, on suit l'avancement de pres ;
    // ensuite, la sante n'a pas besoin d'etre interrogee souvent.
    refetchInterval: (q) => (q.state.data?.amorcage?.enCours ? 10 * 1000 : 5 * 60 * 1000),
    retry: 1,
  });

  // Application du theme choisi.
  useEffect(() => {
    const racine = document.documentElement;
    if (etat.theme === 'systeme') racine.removeAttribute('data-theme');
    else racine.setAttribute('data-theme', etat.theme);
  }, [etat.theme]);

  // Raccourcis clavier utiles en reunion : 1 a 4 pour changer de filiere, Echap pour fermer.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent): void => {
      const cible = e.target as HTMLElement | null;
      if (cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName)) return;
      const filieres = referentiel.data?.filieres ?? [];
      const n = Number(e.key);
      if (n >= 1 && n <= filieres.length) {
        etat.definirFiliere(filieres[n - 1]!.id);
      } else if (e.key === 'Escape') {
        etat.selectionnerParcelle(null);
        etat.definirOutil('aucun');
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [referentiel.data, etat]);

  // Authentification requise : l'API a refuse l'identite courante, ou une requete - y
  // compris une tuile chargee par MapLibre - a rencontre un 401 en cours de session.
  if ((moi.error as ErreurApi | undefined)?.estNonAuthentifie || sessionExpiree) {
    return (
      <Connexion
        expiree={sessionExpiree}
        onConnecte={() => {
          reinitialiserDetectionSession();
          setSessionExpiree(false);
          // Toutes les requetes ont ete faites sans jeton : on les rejoue.
          void clientRequetes.invalidateQueries();
        }}
      />
    );
  }

  if (referentiel.isLoading || moi.isLoading) {
    return (
      <>
        {accueil && <Demarrage onTermine={() => setAccueil(false)} />}
        <div className="application">
          <div className="chargement" style={{ margin: 'auto' }}>
            <span className="tourniquet" />
            Chargement du referentiel…
          </div>
        </div>
      </>
    );
  }

  if (referentiel.isError || !referentiel.data) {
    const err = referentiel.error as ErreurApi | undefined;
    return (
      <div className="application">
        <div className="vide" style={{ margin: 'auto', maxWidth: 480 }}>
          <h2 style={{ fontSize: 16 }}>Application indisponible</h2>
          <p>
            {err?.estReseau
              ? "L'API est injoignable. Demarrez le serveur (npm run dev:api) et verifiez la base de donnees."
              : (err?.message ?? 'Erreur inconnue.')}
          </p>
          <button type="button" className="bouton" onClick={() => void referentiel.refetch()}>
            Reessayer
          </button>
        </div>
      </div>
    );
  }

  const ref = referentiel.data;

  const allerVers = (r: ResultatRecherche): void => {
    const m = carteRef.current;
    if (r.idu) etat.selectionnerParcelle(r.idu);
    if (!m) return;
    if (r.bbox) {
      m.fitBounds(
        [
          [r.bbox[0], r.bbox[1]],
          [r.bbox[2], r.bbox[3]],
        ],
        { padding: 90, maxZoom: 18, duration: 800 },
      );
    } else if (r.centroide[0] !== 0 || r.centroide[1] !== 0) {
      m.easeTo({
        center: r.centroide,
        zoom: r.type === 'commune' ? 13 : r.type === 'poste_source' ? 12 : 17,
        duration: 800,
      });
    }
    etat.definirVue('carte');
  };

  const ouvrirDepuisListe = (l: LigneListe): void => {
    etat.selectionnerParcelle(l.idu);
    etat.definirVue('carte');
    carteRef.current?.easeTo({ center: l.centroide, zoom: 17, duration: 700 });
  };

  return (
    <div className="application">
      {accueil && <Demarrage onTermine={() => setAccueil(false)} />}
      <BarreSuperieure
        referentiel={ref}
        onAllerVers={allerVers}
        // Le bouton de deconnexion n'a de sens que si un jeton est en jeu : en mode
        // developpement, l'API repond sans authentification.
        utilisateur={jetonEnregistre() ? (moi.data ?? null) : null}
        onDeconnexion={() => {
          definirJeton(null);
          void clientRequetes.invalidateQueries();
        }}
      />

      {sante.data?.amorcage && <BandeauAmorcage amorcage={sante.data.amorcage} />}

      <BandeauAvertissements
        referentiel={ref}
        sourcesPerimees={sante.data?.sourcesPerimees ?? []}
        parcellesARafraichir={sante.data?.parcellesARafraichir ?? null}
        role={moi.data?.role ?? null}
      />

      {sante.isError && (
        <div className="bandeau erreur">
          <Icone nom="alerte" />
          <p>
            L&apos;API ne repond plus. Les donnees affichees peuvent etre obsoletes et les
            enregistrements ne seront pas conserves.
          </p>
        </div>
      )}

      <div className="corps">
        {etat.panneauGaucheOuvert && <PanneauGauche referentiel={ref} />}

        <div className="zone-centrale">
          {!etat.panneauGaucheOuvert && (
            <button
              type="button"
              className="bouton poignee-gauche"
              onClick={etat.basculerPanneauGauche}
            >
              Filtres et legende
            </button>
          )}

          {/* La carte reste montee en permanence : la demonter perdrait le contexte WebGL
              et la position de navigation a chaque changement de vue. */}
          <CarteMontee referentiel={ref} carteRef={carteRef} visible={etat.vue === 'carte'} />

          {etat.vue === 'liste' && (
            <VueListe filiere={etat.filiere} referentiel={ref} onOuvrir={ouvrirDepuisListe} />
          )}
          {etat.vue === 'tableau' && <TableauDeBord filiere={etat.filiere} referentiel={ref} />}

          {etat.vue === 'carte' && <OutilsCarte carteRef={carteRef} />}
        </div>

        {etat.iduSelectionne && (
          <FicheParcelle idu={etat.iduSelectionne} filiere={etat.filiere} referentiel={ref} />
        )}
      </div>
    </div>
  );
}

/**
 * Conteneur de la carte : masquee mais conservee lorsque l'utilisateur passe en liste ou en
 * tableau de bord.
 */
function CarteMontee({
  referentiel,
  carteRef,
  visible,
}: {
  referentiel: Parameters<typeof Carte>[0]['referentiel'];
  carteRef: React.MutableRefObject<maplibregl.Map | null>;
  visible: boolean;
}): JSX.Element {
  return (
    <div
      style={{ position: 'absolute', inset: 0, visibility: visible ? 'visible' : 'hidden' }}
      aria-hidden={!visible}
    >
      <Carte
        referentiel={referentiel}
        onCarte={(m) => {
          carteRef.current = m;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outils de carte
// ---------------------------------------------------------------------------

function OutilsCarte({
  carteRef,
}: {
  carteRef: React.MutableRefObject<maplibregl.Map | null>;
}): JSX.Element {
  const etat = useEtat();
  const [qualification, setQualification] = useState<string | null>(null);
  /** Vrai pendant qu'une campagne tourne en arriere-plan : on suit son avancement. */
  const [suiviActif, setSuiviActif] = useState(false);

  /**
   * Au chargement, signaler une campagne restee inachevee.
   *
   * Un redemarrage du serveur vide l'etat en memoire : sans ce controle, l'utilisateur retrouvait
   * une carte portant 49 nouvelles parcelles et aucun message, donc un lot partiel indiscernable
   * d'un lot complet. La trace existait en base depuis le troisieme audit ; elle n'etait exposee
   * a personne.
   */
  useEffect(() => {
    void api
      .etatQualification()
      .then((e) => {
        if (e.enCours) {
          setSuiviActif(true);
          return;
        }
        const d = e.derniereCampagne;
        if (d?.interrompue) {
          setQualification(
            `Attention : la derniere campagne de qualification a ete interrompue a ` +
              `${d.traitees} parcelle(s) sur ${d.total}. Le lot est INCOMPLET — les parcelles ` +
              `manquantes n'ont pas ete interrogees, leur absence de la carte ne veut donc rien ` +
              `dire. Relancez la qualification sur le meme secteur pour le completer.`,
          );
        }
      })
      .catch(() => undefined);
    // Au montage uniquement : c'est un constat d'ouverture, pas un suivi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Recharge les tuiles : elles sont en cache navigateur et masqueraient le nouveau travail. */
  const rafraichirTuiles = (): void => {
    const m = carteRef.current;
    const src = m?.getSource('parcelles') as maplibregl.VectorTileSource | undefined;
    src?.setTiles([
      `${RACINE_ABSOLUE}/api/carte/tuiles/parcelles/{z}/{x}/{y}.mvt?filiere=${etat.filiere}&t=${Date.now()}`,
    ]);
  };

  // Suivi de la campagne en arriere-plan. L'interface reste utilisable pendant ce temps ;
  // sans ce suivi, l'utilisateur ne saurait pas si son secteur avance.
  useEffect(() => {
    if (!suiviActif) return;
    const minuteur = window.setInterval(() => {
      void api
        .etatQualification()
        .then((e) => {
          // La file doit rester visible pendant la campagne : sans elle, un utilisateur en
          // attente ne distingue pas « ma demande est perdue » de « mon tour vient ».
          const attente =
            e.fileAttente.length > 0
              ? ` — ${e.fileAttente.length} demande(s) en attente derriere`
              : '';
          setQualification(
            e.enCours
              ? `${e.message ?? 'Qualification en cours…'}${
                  e.resteSecondes != null && e.resteSecondes > 0
                    ? ` — encore ${Math.ceil(e.resteSecondes / 60)} min environ`
                    : ''
                }${attente}`
              : `${e.message ?? 'Qualification terminee'}. Carte mise a jour.`,
          );
          // Une campagne interrompue ne doit pas se conclure par « Carte mise a jour » : le lot
          // est incomplet et l'utilisateur doit le savoir avant de conclure sur son secteur.
          const d = e.derniereCampagne;
          if (!e.enCours && d?.interrompue) {
            setQualification(
              `Campagne INTERROMPUE a ${d.traitees} parcelle(s) sur ${d.total}. Le lot est ` +
                `incomplet : relancez la qualification sur le meme secteur.`,
            );
          }
          // Le suivi continue tant que la file n'est pas vide : la campagne suivante demarre
          // seule, et l'arreter ici priverait l'utilisateur de la voir avancer.
          if (!e.enCours && e.fileAttente.length === 0) {
            setSuiviActif(false);
            rafraichirTuiles();
          } else if (!e.enCours) {
            rafraichirTuiles();
          }
        })
        .catch(() => setSuiviActif(false));
    }, 4000);
    return () => window.clearInterval(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suiviActif, etat.filiere]);

  const qualifierEmprise = (): void => {
    const m = carteRef.current;
    if (!m) return;
    // Seuil bas : la qualification doit pouvoir porter sur plusieurs communes. En dessous,
    // l'emprise couvre un departement entier et represente des semaines de traitement.
    if (m.getZoom() < 10) {
      setQualification(
        'Zoomez un peu : au-dela de l’echelle du departement, la qualification demanderait des semaines. Le niveau d’une a quelques communes est le bon.',
      );
      return;
    }
    const b = m.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];

    setQualification('Estimation du volume…');
    void api
      .estimerEmprise(bbox)
      .then((est) => {
        // Au-dela de quelques dizaines de parcelles, l'utilisateur doit savoir a quoi il
        // s'engage : plusieurs minutes, parfois plus d'une heure.
        if (est.nbEstime > 40) {
          const ok = window.confirm(
            `Environ ${est.nbEstime} parcelles a qualifier sur ce secteur, soit de l'ordre de ` +
              `${est.dureeEstimeeMin} minutes.\n\n` +
              "Le traitement se fait en arriere-plan : vous pouvez continuer a travailler, " +
              "l'avancement s'affiche en bas de la carte.\n\nLancer la campagne ?",
          );
          if (!ok) {
            setQualification(null);
            return;
          }
        }
        setQualification('Qualification lancee — interrogation des sources officielles…');
        return api.qualifierEmprise(bbox, etat.filiere).then((r) => {
          if (r.mode === 'arriere_plan') {
            setSuiviActif(true);
            setQualification(
              r.position != null && r.position > 0
                ? `Demande enregistree en position ${r.position} : une campagne occupe deja les ` +
                    `sources, limitees a une requete par seconde. La votre demarrera seule.`
                : (r.etat?.message ?? 'Campagne lancee en arriere-plan…'),
            );
          } else {
            setQualification(
              `${r.nbEnrichies ?? 0} parcelle(s) qualifiee(s) sur ${r.nbParcelles ?? 0}` +
                ((r.nbEchecs ?? 0) > 0 ? `, ${r.nbEchecs} en echec` : '') +
                '. Carte mise a jour.',
            );
            rafraichirTuiles();
          }
        });
      })
      .catch((e: ErreurApi) => setQualification(`Echec : ${e.message}`));
  };

  return (
    <>
      <div className="outils-carte">
        <button
          type="button"
          className="bouton"
          onClick={qualifierEmprise}
          title="Recuperer et qualifier les parcelles de l'emprise visible"
        >
          Qualifier l&apos;emprise
        </button>
        <button
          type="button"
          className="bouton"
          aria-pressed={etat.outil === 'polygone'}
          onClick={() => etat.definirOutil(etat.outil === 'polygone' ? 'aucun' : 'polygone')}
          title="Tracer un perimetre et mesurer sa surface"
        >
          Dessiner
        </button>
        <button
          type="button"
          className="bouton"
          aria-pressed={etat.outil === 'mesure'}
          onClick={() => etat.definirOutil(etat.outil === 'mesure' ? 'aucun' : 'mesure')}
          title="Mesurer une distance"
        >
          Mesurer
        </button>
        <button
          type="button"
          className="bouton"
          aria-pressed={etat.outil === 'selection'}
          onClick={() => etat.definirOutil(etat.outil === 'selection' ? 'aucun' : 'selection')}
          title="Selectionner plusieurs parcelles (ou maintenir Maj)"
        >
          Selectionner
        </button>
      </div>

      {/* `aria-live` : l'avancement d'une campagne se met a jour toutes les 4 secondes sans
          interaction. Sans cette annonce, un lecteur d'ecran ne signale jamais ni la
          progression ni la fin du traitement. `polite` plutot que `assertive` : le message
          n'est pas urgent, il ne doit pas couper la lecture en cours. */}
      {qualification && (
        <div className="mesure-info" style={{ top: 58 }} role="status" aria-live="polite">
          <span>{qualification}</span>
          <button type="button" className="bouton-discret" onClick={() => setQualification(null)}>
            Fermer
          </button>
        </div>
      )}

      {etat.idusSelectionnes.length > 0 && (
        <div className="selection-info">
          <strong>{etat.idusSelectionnes.length}</strong> parcelle(s) selectionnee(s)
          <button
            type="button"
            className="bouton bouton-principal"
            onClick={() => {
              const nom = window.prompt('Nom du site :', 'Nouveau site');
              if (!nom) return;
              void api
                .creerSite({ nom, filiere: etat.filiere, idus: etat.idusSelectionnes })
                .then((s) => {
                  window.alert(
                    `Site « ${s.nom} » cree : ${s.idus.length} parcelle(s), ${s.surfaceHa ?? 0} ha, ` +
                      `score consolide ${s.scoreGlobal ?? 'non calcule'} (${s.statutScore ?? 'indetermine'}).`,
                  );
                  etat.viderSelection();
                })
                .catch((e: ErreurApi) => window.alert(`Creation impossible : ${e.message}`));
            }}
          >
            Agreger en site
          </button>
          <button
            type="button"
            className="bouton"
            onClick={() =>
              void api
                .exporter(
                  'geojson',
                  { idus: etat.idusSelectionnes, filiere: etat.filiere },
                  `selection-${etat.filiere}.geojson`,
                )
                .catch((e: ErreurApi) => window.alert(e.message))
            }
          >
            Exporter
          </button>
          <button type="button" className="bouton-discret" onClick={etat.viderSelection}>
            Vider
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bandeau de premier demarrage
// ---------------------------------------------------------------------------

/**
 * Au premier lancement, l'API charge les donnees nationales en arriere-plan (contours
 * communaux, postes sources, monuments, gisement de vent). Sans ce bandeau, l'utilisateur
 * verrait une carte vide et des criteres gris sans savoir que c'est temporaire.
 */
function BandeauAmorcage({ amorcage }: { amorcage: Amorcage }): JSX.Element | null {
  const enCours = amorcage.etapes.find((e) => e.statut === 'en_cours');
  const echecs = amorcage.etapes.filter((e) => e.statut === 'echec');

  if (amorcage.enCours) {
    const faites = amorcage.etapes.filter((e) => e.statut === 'ok' || e.statut === 'deja_present');
    return (
      <div className="bandeau">
        <span className="tourniquet" />
        <p>
          <strong>Premier demarrage : chargement des donnees nationales.</strong>{' '}
          {enCours
            ? `Etape en cours : ${enCours.libelle} (environ ${enCours.duree}).`
            : 'Preparation…'}{' '}
          {faites.length}/{amorcage.etapes.length} terminees. L&apos;application est utilisable
          pendant ce temps ; les couches concernees apparaitront au fur et a mesure.
        </p>
      </div>
    );
  }

  if (echecs.length > 0) {
    return (
      <div className="bandeau">
        <Icone nom="alerte" />
        <p>
          <strong>Chargement initial incomplet.</strong> {echecs.map((e) => e.libelle).join(', ')} —
          les criteres correspondants resteront gris. Relancez le chargement avec{' '}
          <code>npm run ingest -w @enr/api -- {echecs.map((e) => e.nom).join(' ')}</code>.
        </p>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bandeau d'avertissements (section 12 du cahier des charges)
// ---------------------------------------------------------------------------

function BandeauAvertissements({
  referentiel,
  sourcesPerimees,
  parcellesARafraichir,
  role,
}: {
  referentiel: Parameters<typeof Carte>[0]['referentiel'];
  sourcesPerimees: string[];
  parcellesARafraichir: number | null;
  role: 'admin' | 'prospection' | 'lecture' | null;
}): JSX.Element | null {
  const etat = useEtat();
  const clientRequetes = useQueryClient();
  const [rafraichissementEnCours, setRafraichissementEnCours] = useState(false);
  const globaux = referentiel.avertissements.filter(
    (a) => a.portee === 'global' && !etat.avertissementsMasques.includes(a.id),
  );

  const enRetard = parcellesARafraichir != null && parcellesARafraichir > 0;
  // Un rafraichissement consomme le quota des sources publiques : la route le refuse a un compte en
  // lecture seule, et l'interface ne doit pas proposer une action vouee au 403.
  const peutRafraichir = role === 'admin' || role === 'prospection';
  if (globaux.length === 0 && sourcesPerimees.length === 0 && !enRetard) return null;

  return (
    <>
      {globaux.map((a) => (
        <div key={a.id} className="bandeau">
          <Icone nom="alerte" />
          <p>
            <strong>{a.titre}.</strong> {a.texte}
          </p>
          <button
            type="button"
            className="bouton-discret fermer"
            title="Masquer pour cette session — l’avertissement reapparaitra au prochain chargement"
            onClick={() => etat.masquerAvertissement(a.id)}
          >
            Masquer
          </button>
        </div>
      ))}
      {sourcesPerimees.length > 0 && (
        <div className="bandeau">
          <Icone nom="alerte" />
          <p>
            <strong>Sources a rafraichir.</strong> {sourcesPerimees.length} source(s) depassent leur
            periodicite de mise a jour ({sourcesPerimees.join(', ')}). Les criteres concernes
            peuvent etre obsoletes ou indisponibles.
          </p>
        </div>
      )}
      {/*
        Retard entre la donnee ingeree et les parcelles deja qualifiees — audit 9, defaut A2.

        Le score ne se calcule pas sur les couches, mais sur le snapshot fige a l'enrichissement.
        Une ingestion de sites proteges, de ZAER ou de postes sources n'atteignait donc pas les
        parcelles deja qualifiees : leur snapshot restait valide au sens de l'age, et le recalcul par
        version de moteur le relisait fidelement. La carte affichait l'etat d'avant l'ingestion, sans
        que rien ne le dise. Ouvrir une fiche repare la parcelle concernee ; ce bandeau permet de
        reprendre le lot, et surtout de SAVOIR que le retard existe.
      */}
      {enRetard && (
        <div className="bandeau">
          <Icone nom="alerte" />
          <p>
            <strong>Parcelles en retard sur la donnee.</strong> {parcellesARafraichir} parcelle(s)
            ont ete qualifiees avant la derniere ingestion de leur departement : la carte et les
            listes affichent pour elles l&apos;etat d&apos;avant. Ouvrir une fiche met la parcelle a
            jour{peutRafraichir ? ' ; le bouton reprend un lot' : ''}.
          </p>
          {/*
            Le bouton n'apparait pas pour un compte en lecture seule : la route refuse l'operation
            avec un 403, et un bouton qui echoue en silence est pire que pas de bouton. Le RETARD
            reste affiche pour tout le monde — c'est une information, pas une action.
          */}
          {peutRafraichir && (
          <button
            type="button"
            className="bouton-discret"
            disabled={rafraichissementEnCours}
            onClick={() => {
              setRafraichissementEnCours(true);
              void api
                .rafraichirParcelles()
                .catch(() => undefined)
                .finally(() => {
                  setRafraichissementEnCours(false);
                  // La sante porte le compteur, les scores portent la carte : les deux changent.
                  void clientRequetes.invalidateQueries();
                });
            }}
          >
            {rafraichissementEnCours ? 'Rafraichissement…' : 'Rafraichir un lot'}
          </button>
          )}
        </div>
      )}
    </>
  );
}
