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
  RACINE_API,
  type Amorcage,
  type LigneListe,
  type ResultatRecherche,
} from './api/client.js';
import { Connexion } from './components/Connexion.js';
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

  // Authentification requise : l'API a refuse l'identite courante.
  if ((moi.error as ErreurApi | undefined)?.estNonAuthentifie) {
    return (
      <Connexion
        onConnecte={() => {
          // Toutes les requetes ont ete faites sans jeton : on les rejoue.
          void clientRequetes.invalidateQueries();
        }}
      />
    );
  }

  if (referentiel.isLoading || moi.isLoading) {
    return (
      <div className="application">
        <div className="chargement" style={{ margin: 'auto' }}>
          <span className="tourniquet" />
          Chargement du referentiel…
        </div>
      </div>
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

      <BandeauAvertissements referentiel={ref} sourcesPerimees={sante.data?.sourcesPerimees ?? []} />

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

  const qualifierEmprise = (): void => {
    const m = carteRef.current;
    if (!m) return;
    if (m.getZoom() < 13) {
      setQualification('Zoomez davantage : la qualification porte sur l’emprise visible.');
      return;
    }
    const b = m.getBounds();
    setQualification('Qualification en cours — interrogation des sources officielles…');
    void api
      .qualifierEmprise([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], etat.filiere)
      .then((r) => {
        setQualification(
          `${r.nbEnrichies} parcelle(s) qualifiee(s) sur ${r.nbParcelles} (${Math.round(r.dureeMs / 1000)} s)` +
            (r.nbEchecs > 0 ? `, ${r.nbEchecs} en echec` : '') +
            '. Rafraichissez la carte si besoin.',
        );
        // Les tuiles sont en cache navigateur : on force leur rechargement.
        const src = m.getSource('parcelles') as maplibregl.VectorTileSource | undefined;
        src?.setTiles([
          `${RACINE_API}/api/carte/tuiles/parcelles/{z}/{x}/{y}.mvt?filiere=${etat.filiere}&t=${Date.now()}`,
        ]);
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

      {qualification && (
        <div className="mesure-info" style={{ top: 58 }}>
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
}: {
  referentiel: Parameters<typeof Carte>[0]['referentiel'];
  sourcesPerimees: string[];
}): JSX.Element | null {
  const etat = useEtat();
  const globaux = referentiel.avertissements.filter(
    (a) => a.portee === 'global' && !etat.avertissementsMasques.includes(a.id),
  );

  if (globaux.length === 0 && sourcesPerimees.length === 0) return null;

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
    </>
  );
}
