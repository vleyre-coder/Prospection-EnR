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
import { BandeauAvertissements } from './components/BandeauAvertissements.js';
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
    /**
     * MEME STRUCTURE QUE LA BRANCHE PRINCIPALE, et ce n'est pas cosmetique.
     *
     * L'ecran d'ouverture etait rendu ici dans un fragment, AVANT `div.application`, et plus bas dans
     * la branche principale comme PREMIER ENFANT de `div.application`. React reconcilie par position :
     * au passage du chargement a l'application, l'element changeait de parent, donc `Demarrage` etait
     * demonte puis remonte. Son effet repartait de zero — nouveau minuteur de deux secondes, nouveaux
     * ecouteurs — si bien que l'animation RECOMMENCAIT au moment ou l'application devenait prete, et
     * qu'une touche pressee avant la transition etait perdue.
     *
     * L'intention du composant est explicite : « Toute touche ou tout clic abrege : personne ne doit
     * subir une animation. » Elle etait donc trahie, precisement dans le cas le plus courant — un
     * utilisateur presse qui appuie sur une touche pendant le chargement.
     *
     * Trouve par les tests de bout en bout, qui sont seuls a pouvoir le voir : il faut un vrai
     * navigateur, une vraie transition d'etat et un vrai minuteur pour que le remontage se produise.
     * Aligner les deux structures suffit : la position de `Demarrage` ne change plus, React le
     * conserve monte, et son minuteur poursuit.
     */
    return (
      <div className="application">
        {accueil && <Demarrage onTermine={() => setAccueil(false)} />}
        <div className="chargement" style={{ margin: 'auto' }}>
          <span className="tourniquet" />
          Chargement du référentiel…
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
              ? "L'API est injoignable. Demarrez le serveur (npm run dev:api) et verifiez la base de données."
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
    } else if (r.centroide) {
      // Un resultat sans position ne deplace pas la carte. Le cas se produit quand le cadastre n'a pas
      // repondu : la parcelle est selectionnee et qualifiable, mais on ne sait pas ou elle est.
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
            L&apos;API ne repond plus. Les données affichees peuvent être obsoletes et les
            enregistrements ne seront pas conserves.
          </p>
        </div>
      )}

      <div className="corps">
        {/*
         * LE PANNEAU DE FILTRES NE S'AFFICHE PAS SUR LE TABLEAU DE BORD.
         *
         * Il y occupait 336 px de large — un cinquieme d'un ecran de 1 600, un tiers d'un ecran
         * de 900 — pour ne rien filtrer : `TableauDeBord` ne recoit que la filiere et le
         * referentiel, aucun critere du panneau ne l'atteint. Un controle qui occupe la place
         * sans rien commander n'est pas neutre, il fait chercher un effet qui n'existe pas.
         *
         * La preference d'ouverture est CONSERVEE et non forcee a « ferme » : revenir a la carte
         * doit retrouver le panneau tel qu'on l'avait laisse. D'ou un test sur la vue, et non un
         * changement d'etat.
         */}
        {etat.vue !== 'tableau' && etat.panneauGaucheOuvert && <PanneauGauche referentiel={ref} />}

        <div className="zone-centrale">
          {etat.vue !== 'tableau' && !etat.panneauGaucheOuvert && (
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

        {/*
          LA FICHE N'EST MONTEE QU'EN VUE CARTE, et c'est une correction d'ergonomie mesuree.
          Elle restait affichee en vue liste et en tableau de bord, ou elle prenait 470 px sur 1 600.
          Consequence observee sur une capture : le tableau de la liste, qui compte dix colonnes, etait
          comprime dans 800 px — chaque cellule passait sur deux lignes et la derniere colonne etait
          coupee au bord. Or la fiche n'a pas d'usage la : cliquer une ligne de la liste RAMENE a la
          carte et l'ouvre (`ouvrirDepuisListe`). La selection est conservee, seul l'affichage attend.
        */}
        {etat.iduSelectionne && etat.vue === 'carte' && (
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
      /**
       * `opacity` EN PLUS de `visibility`, et c'est un correctif.
       *
       * `visibility: hidden` se laisse annuler par un descendant qui redeclare `visibility: visible` —
       * ce que fait la feuille de style de MapLibre sur certains de ses controles. Resultat constate sur
       * capture : en vue liste, l'attribution « © IGN — Geoplateforme | © IGN — Plan Cadastral
       * Informatise » flottait par-dessus la derniere ligne du tableau.
       *
       * `opacity: 0` ne peut pas etre annulee par un descendant, et elle CONSERVE la mise en page : la
       * carte garde ses dimensions, donc aucun redimensionnement ni scintillement au retour — ce qui
       * etait la raison de ne pas employer `display: none`.
       */
      style={{
        position: 'absolute',
        inset: 0,
        visibility: visible ? 'visible' : 'hidden',
        opacity: visible ? 1 : 0,
      }}
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
  /**
   * CE QUE LA CAMPAGNE N'A PAS COUVERT, affiche a part du message d'avancement.
   *
   * A part, et c'est le point : le message d'avancement change toutes les quatre secondes et disparait
   * a la fin. Une information de cette portee — « la moitie du parcellaire n'a pas ete regardee » — doit
   * rester sous les yeux jusqu'a ce que l'utilisateur la ferme, sinon elle passe inapercue et le secteur
   * est cru complet.
   */
  const [couverture, setCouverture] = useState<string | null>(null);
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
            `Attention : la derniere campagne de qualification a été interrompue a ` +
              `${d.traitees} parcelle(s) sur ${d.total}. Le lot est INCOMPLET — les parcelles ` +
              `manquantes n'ont pas été interrogees, leur absence de la carte ne veut donc rien ` +
              `dire. Relancez la qualification sur le même secteur pour le compléter.`,
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
          // La couverture est connue des la fin de la phase de recuperation, soit bien avant la fin
          // de la campagne : la publier tout de suite permet d'arreter et de relancer autrement.
          if (e.couverture?.avertissement) setCouverture(e.couverture.avertissement);

          // Une campagne interrompue ne doit pas se conclure par « Carte mise a jour » : le lot
          // est incomplet et l'utilisateur doit le savoir avant de conclure sur son secteur.
          const d = e.derniereCampagne;
          if (!e.enCours && d?.interrompue) {
            setQualification(
              `Campagne INTERROMPUE a ${d.traitees} parcelle(s) sur ${d.total}. Le lot est ` +
                `incomplet : relancez la qualification sur le même secteur.`,
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
        'Zoomez un peu : au-delà de l’échelle du département, la qualification demanderait des semaines. Le niveau d’une a quelques communes est le bon.',
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
    setCouverture(null);
    void api
      .estimerEmprise(bbox)
      .then((est) => {
        /**
         * CE QUE LA CAMPAGNE VA ECARTER, dit AVANT de la lancer.
         *
         * Le dialogue annoncait un volume et une duree, et taisait les deux filtres qui decident du
         * perimetre reel : la surface minimale, et le plafond de lot. Un utilisateur approuvait donc une
         * campagne dont il ignorait qu'elle ne verrait pas la moitie du parcellaire — mesure sur la
         * Beauce : 55 a 60 % des parcelles ecartees par le seuil de 3 000 m2.
         */
        const reserves: string[] = [];
        if (est.nbEcarteesEstime > 0) {
          reserves.push(
            `Environ ${est.nbEcarteesEstime} parcelle(s) seront ECARTEES car plus petites que ` +
              `${(est.surfaceMinM2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha.`,
          );
        }
        if (est.plafonne) {
          reserves.push(
            'Le secteur depasse le plafond par campagne : il ne sera PAS couvert en entier. ' +
              'Decoupez-le en plusieurs campagnes pour le couvrir.',
          );
        }
        if (reserves.length > 0) {
          reserves.push(
            'Une parcelle precise peut toujours être qualifiee en la cliquant sur le cadastre, ' +
              'ou par sa référence dans la recherche.',
          );
        }
        // Le seuil de 40 vaut pour la duree. Les reserves, elles, doivent etre approuvees quel que
        // soit le volume : elles ne parlent pas du temps mais de ce que la campagne ne verra pas.
        if (est.nbEstime > 40 || reserves.length > 0) {
          const ok = window.confirm(
            `Environ ${est.nbEstime} parcelles a qualifier sur ce secteur, soit de l'ordre de ` +
              `${est.dureeEstimeeMin} minutes.\n\n` +
              (reserves.length > 0 ? `${reserves.join('\n\n')}\n\n` : '') +
              "Le traitement se fait en arrière-plan : vous pouvez continuer à travailler, " +
              "l'avancement s'affiche en bas de la carte.\n\nLancer la campagne ?",
          );
          if (!ok) {
            setQualification(null);
            return;
          }
        }
        setQualification('Qualification lancée — interrogation des sources officielles…');
        return api.qualifierEmprise(bbox, etat.filiere).then((r) => {
          if (r.mode === 'arriere_plan') {
            setSuiviActif(true);
            setQualification(
              r.position != null && r.position > 0
                ? `Demande enregistree en position ${r.position} : une campagne occupe deja les ` +
                    `sources, limitées à une requête par seconde. La votre demarrera seule.`
                : (r.etat?.message ?? 'Campagne lancée en arrière-plan…'),
            );
          } else {
            setQualification(
              `${r.nbEnrichies ?? 0} parcelle(s) qualifiee(s) sur ${r.nbParcelles ?? 0}` +
                ((r.nbEchecs ?? 0) > 0 ? `, ${r.nbEchecs} en echec` : '') +
                '. Carte mise a jour.',
            );
            // Meme regle que pour une campagne en arriere-plan : ce qui a ete ecarte doit se voir.
            if ((r.nbEcarteesSurface ?? 0) > 0) {
              setCouverture(
                `${r.nbEcarteesSurface} parcelle(s) du secteur n'ont PAS ete qualifiees : plus ` +
                  `petites que ${((r.surfaceMinAppliqueeM2 ?? 0) / 10000).toLocaleString('fr-FR', {
                    maximumFractionDigits: 2,
                  })} ha. Cliquez une parcelle du cadastre pour la qualifier malgre tout.`,
              );
            }
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
          title="Récupérer et qualifier les parcelles de l'emprise visible"
        >
          Qualifier l&apos;emprise
        </button>
        <button
          type="button"
          className="bouton"
          aria-pressed={etat.outil === 'polygone'}
          onClick={() => etat.definirOutil(etat.outil === 'polygone' ? 'aucun' : 'polygone')}
          title="Tracer un périmètre et mesurer sa surface"
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
          title="Sélectionner plusieurs parcelles (ou maintenir Maj)"
        >
          Sélectionner
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

      {/* La couverture incomplete reste affichee jusqu'a fermeture explicite : c'est une information
          sur ce que la campagne N'A PAS vu, et elle doit survivre au message d'avancement. `alert` et
          non `status` : sans elle, un secteur non regarde se lit comme un secteur sans interet. */}
      {couverture && (
        <div
          className="erreur-encart"
          style={{ position: 'absolute', top: 96, left: 12, right: 12, zIndex: 6 }}
          role="alert"
        >
          <strong>Couverture incomplète</strong>
          <p style={{ margin: '4px 0 0' }}>{couverture}</p>
          <button type="button" className="bouton-discret" onClick={() => setCouverture(null)}>
            J&apos;ai compris
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
          <strong>Premier démarrage : chargement des données nationales.</strong>{' '}
          {enCours
            ? `Etape en cours : ${enCours.libelle} (environ ${enCours.duree}).`
            : 'Preparation…'}{' '}
          {faites.length}/{amorcage.etapes.length} terminees. L&apos;application est utilisable
          pendant ce temps ; les couches concernees apparaitront au fur et à mesure.
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
          les critères correspondants resteront gris. Relancez le chargement avec{' '}
          <code>npm run ingest -w @enr/api -- {echecs.map((e) => e.nom).join(' ')}</code>.
        </p>
      </div>
    );
  }

  return null;
}

