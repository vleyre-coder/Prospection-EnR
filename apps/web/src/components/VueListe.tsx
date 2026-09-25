/**
 * Vue liste : resultats des filtres, triables, exportables en CSV.
 * Un clic sur une ligne ouvre la fiche et recentre la carte.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { libelleTypeSol, type Filiere } from '@enr/core';
import {
  api,
  ErreurApi,
  type CouvertureRecherche,
  type ProfilApplique,
  type LigneListe,
  type Referentiel,
} from '../api/client.js';
import { useEtat } from '../store/etat.js';
import { formatNombre } from '../utils/geometrie.js';
import { etiquetteStatut } from '../utils/affichage.js';
import { FormulaireBalayage } from './FormulaireBalayage.js';
import { BoutonExport } from './BoutonExport.js';

type Tri = 'score_desc' | 'score_asc' | 'surface_desc' | 'distance_poste_asc';

interface Props {
  filiere: Filiere;
  referentiel: Referentiel;
  onOuvrir: (ligne: LigneListe) => void;
  /**
   * `liste` : les parcelles qualifiees de l'emprise regardee.
   * `recherche` : le meme tableau, precede du formulaire de balayage par criteres.
   *
   * Le defaut vaut `liste` pour que les appelants existants n'aient rien a changer.
   */
  mode?: 'liste' | 'recherche';
}

export function VueListe({ filiere, referentiel, onOuvrir, mode = 'liste' }: Props): JSX.Element {
  const etat = useEtat();
  const [tri, setTri] = useState<Tri>('score_desc');
  const [erreurExport, setErreurExport] = useState<string | null>(null);

  /**
   * La liste se limite par defaut a l'emprise affichee.
   *
   * Sans cette borne, elle presentait toutes les parcelles qualifiees de la base : on
   * pouvait lire cote a cote deux parcelles distantes de 200 km, sans aucun indice que la
   * liste ne correspondait pas a la carte. Le bbox etait deja accepte par l'API ; il n'etait
   * simplement jamais transmis.
   */
  const borne = etat.limiterALEmprise && etat.empriseCourante != null;
  const filtres = {
    ...etat.filtres,
    filiere,
    tri,
    limite: 300,
    ...(borne ? { bbox: etat.empriseCourante! } : {}),
  };
  /*
   * Le profil entre dans la CLE de requete, et pas seulement dans l'appel.
   *
   * L'oublier ferait servir le resultat en cache du balayage precedent apres un changement de
   * profil : l'operateur verrait la liste d'un autre developpeur sous le nom du sien, sans
   * qu'aucun indicateur ne bouge. C'est le genre d'ecart qu'on ne rattrape pas ensuite.
   */
  const profilId = etat.profilId;
  const requete = useQuery({
    queryKey: ['liste', filtres, profilId],
    queryFn: () => api.filtrer(filtres, profilId ?? undefined),
    retry: 1,
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LA SELECTION : elle existait dans l'etat, elle n'existait nulle part a l'ecran
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * `idusSelectionnes` et `basculerSelection` vivaient dans le magasin depuis l'origine, et seule
   * la CARTE savait les alimenter — par un clic modifie, non decouvrable. La vue liste, qui est
   * pourtant l'endroit ou l'on compare et choisit, n'avait aucune case a cocher.
   *
   * LE PLAFOND EST DIT AVANT L'APPEL. La route refuse au-dela ; laisser le bouton actif pour
   * recevoir un 400 apprendrait la limite a l'utilisateur par un message d'erreur. Le compteur et
   * l'infobulle la donnent avant.
   *
   * CENT, et le chiffre doit rester egal a `MAX_PARCELLES_DOSSIER` cote API (`routes/divers.ts`),
   * ou est ecrite la mesure qui le justifie. Les deux valeurs sont tenues ensemble par un test.
   */
  const selection = etat.idusSelectionnes;
  const MAX_DOSSIER = 100;
  const idusAffiches = requete.data?.resultats.map((r) => r.idu) ?? [];
  const tousSelectionnes =
    idusAffiches.length > 0 && idusAffiches.every((idu) => selection.includes(idu));

  const colonnes: Array<[string, Tri | null, boolean]> = [
    ['Commune', null, false],
    ['Section / n°', null, false],
    ['Surface', 'surface_desc', true],
    ['Statut', null, false],
    ['Score', 'score_desc', true],
    ['Tracé estimé', 'distance_poste_asc', true],
    ['Pente', null, true],
    ['Nature du sol', null, false],
    ['Prospection', null, false],
  ];

  return (
    <div className="vue-plein">
      {mode === 'recherche' && (
        <>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Recherche de foncier par critères</h2>
          <p className="balayage-note" style={{ margin: '0 0 10px' }}>
            Décrivez le projet cherché, choisissez le territoire, et l&apos;outil sort toutes les
            parcelles déjà qualifiées qui répondent aux critères.
          </p>
          <FormulaireBalayage filiere={filiere} />
        </>
      )}
      {/*
        L'EN-TETE SE REPLIE, LES BOUTONS NON — corrige sur capture, pas sur intuition.
        Mesure a 1 600 px de large : quatre des cinq commandes coupaient leur libelle en deux
        (« Exporter en / CSV », « Retour a la / carte »), et le compteur de selection passait sous
        son propre bouton. La rangee etait rigide et les mots pliaient ; c'est l'inverse qu'il
        faut. `flexWrap` autorise une seconde rangee quand la place manque, `nowrap` sur les
        boutons interdit qu'un libelle se casse.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Parcelles qualifiées
          {requete.data && (
            <span style={{ fontWeight: 400, color: 'var(--texte-faible)', fontSize: 13 }}>
              {' '}
              — {requete.data.total} résultat{requete.data.total > 1 ? 's' : ''}
              {requete.data.total > requete.data.resultats.length &&
                ` (${requete.data.resultats.length} affichés)`}
              {borne
                ? ' — dans la zone affichée'
                : ' — sur tout le territoire qualifié'}
            </span>
          )}
        </h2>
        {/*
          LE COMPTEUR DE SELECTION, avec de quoi la defaire.
          La selection survit au changement de filtre et de vue : sans compteur, un dossier
          demande plus tard porterait des parcelles cochees dix minutes plus tot sur une autre
          emprise, sans que rien ne le rappelle.
        */}
        {selection.length > 0 && (
          <span style={{ fontSize: 13, color: 'var(--texte-faible)', whiteSpace: 'nowrap' }}>
            {selection.length} retenue{selection.length > 1 ? 's' : ''}
            <button
              type="button"
              className="bouton-discret"
              onClick={() => etat.viderSelection()}
              title="Décocher toutes les parcelles retenues"
            >
              vider
            </button>
          </span>
        )}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}
            title="Restreint la liste et les exports aux parcelles visibles sur la carte."
          >
            <input
              type="checkbox"
              checked={etat.limiterALEmprise}
              onChange={() => etat.basculerLimiteEmprise()}
            />
            Limiter à la zone affichée
          </label>
          {/*
            LE CAHIER DES CHARGES WORD, et il n'est PAS desactive quand la liste est vide.
            C'est la difference de nature avec les autres exports : le CSV, le Shapefile et le
            dossier portent des RESULTATS, donc ils n'ont aucun sens sans resultat. Le cahier des
            charges, lui, porte la DEMANDE — on l'envoie au developpeur avant d'avoir cherche quoi
            que ce soit, et c'est meme son usage principal. Le griser sur une liste vide
            interdirait le seul moment ou l'on en a le plus besoin.

            Les criteres courants y sont joints : envoye a vide il sert de formulaire, envoye avec
            ce qui est regle il devient le compte rendu de la recherche.
          */}
          <button
            type="button"
            className="bouton"
            title="Document Word éditable : le cahier des charges de la filière, à remplir par le développeur et à renvoyer."
            onClick={() =>
              void api
                .exporter(
                  'cahier-des-charges',
                  { filiere, criteres: filtres },
                  `cahier-des-charges-${filiere}.docx`,
                )
                .catch((e: ErreurApi) => setErreurExport(e.message))
            }
          >
            Cahier des charges (Word)
          </button>
          <button
            type="button"
            className="bouton"
            disabled={!requete.data?.resultats.length}
            onClick={() =>
              void api
                .exporter('csv', filtres, `parcelles-${filiere}.csv`)
                .catch((e: ErreurApi) => setErreurExport(e.message))
            }
          >
            Exporter en CSV
          </button>
          <button
            type="button"
            className="bouton"
            disabled={!requete.data?.resultats.length}
            onClick={() =>
              void api
                .exporter(
                  'shapefile',
                  { idus: requete.data?.resultats.map((r) => r.idu) ?? [], filiere },
                  `parcelles-${filiere}-shapefile.zip`,
                )
                .catch((e: ErreurApi) => setErreurExport(e.message))
            }
          >
            Shapefile
          </button>
          {/*
            LE DOSSIER DE SITE. Bouton toujours VISIBLE et desactive sans selection, plutot
            qu'apparaissant avec elle : une commande qui n'existe pas tant qu'on n'a pas devine
            comment la faire apparaitre ne se decouvre jamais. L'infobulle dit quoi faire.
          */}
          <BoutonExport
            className="bouton bouton-principal"
            desactive={selection.length === 0 || selection.length > MAX_DOSSIER}
            titre={
              selection.length === 0
                ? 'Cochez les parcelles retenues (colonne de gauche) pour constituer un dossier de site.'
                : selection.length > MAX_DOSSIER
                  ? `${selection.length} parcelles sélectionnées : le dossier est limité à ${MAX_DOSSIER}.`
                  : `Dossier complet des ${selection.length} parcelles retenues, avec cartes de situation et d’environnement, à remettre à un développeur.`
            }
            pendant="Composition du dossier…"
            action={() => {
              setErreurExport(null);
              return api.exporter('dossier', { idus: selection, filiere }, `dossier-site-${filiere}.pdf`);
            }}
            surErreur={setErreurExport}
          >
            Dossier développeur
            {selection.length > 0 ? ` (${selection.length})` : ''}
          </BoutonExport>
          {/*
            LE MEME DOSSIER, EN BROUILLON DE COURRIEL. C'est le livrable que l'operateur envoie a
            un developpeur : une piece jointe de six pages sans un mot ne s'ouvre pas. Rien ne part
            d'ici — le `.eml` s'ouvre dans la messagerie de l'operateur, qui y pose son expediteur
            et sa signature.
          */}
          <BoutonExport
            desactive={selection.length === 0 || selection.length > MAX_DOSSIER}
            titre={
              selection.length === 0
                ? 'Cochez les parcelles retenues pour préparer le courriel.'
                : 'Brouillon de courriel : synthèse du site en corps, dossier complet en pièce jointe. Rien n’est envoyé.'
            }
            pendant="Composition du courriel…"
            action={() => {
              setErreurExport(null);
              return api.telechargerDossierCourriel(selection, filiere);
            }}
            surErreur={setErreurExport}
          >
            Dossier par courriel
          </BoutonExport>
          {/*
            « Retour a la carte » RETIRE, et ce n'est pas une perte de fonction : le groupe « Vue »
            de la barre superieure porte deja Carte / Liste / Tableau de bord, il est visible en
            permanence et a trois metres de la. Deux commandes pour un meme geste, dans le meme
            champ de vision, encombrent la rangee qui en avait le moins besoin.
          */}
        </div>
      </div>

      {erreurExport && (
        <div className="erreur-encart" style={{ margin: '0 0 11px' }}>
          Export impossible : {erreurExport}
        </div>
      )}

      {requete.isLoading && (
        <div className="chargement">
          <span className="tourniquet" />
          Interrogation…
        </div>
      )}

      {requete.isError && (
        <div className="erreur-encart" style={{ margin: 0 }}>
          {(requete.error as ErreurApi).message}
        </div>
      )}

      {requete.data?.profil && <BandeauProfil profil={requete.data.profil} />}
      {requete.data && <BandeauCouverture couverture={requete.data.couverture} total={requete.data.total} />}

      {requete.data && requete.data.resultats.length === 0 && (
        <div className="vide">
          Aucune parcelle ne correspond aux filtres.
          <br />
          Les parcelles doivent d&apos;abord être qualifiées : deplacez-vous sur la carte au-delà du
          zoom 14 et lancez la qualification de l&apos;emprise.
        </div>
      )}

      {requete.data && requete.data.resultats.length > 0 && (
        <table className="tableau">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={tousSelectionnes}
                  aria-label={
                    tousSelectionnes
                      ? 'Désélectionner les parcelles affichées'
                      : 'Sélectionner les parcelles affichées'
                  }
                  title={
                    tousSelectionnes
                      ? 'Désélectionner les parcelles affichées'
                      : 'Sélectionner les parcelles affichées'
                  }
                  onChange={() => {
                    // Bascule sur les parcelles AFFICHEES seulement : la selection peut contenir
                    // des parcelles venues de la carte ou d'un autre filtre, et les effacer sans
                    // que l'utilisateur les voie serait une perte silencieuse.
                    for (const idu of idusAffiches) {
                      if (selection.includes(idu) === tousSelectionnes) etat.basculerSelection(idu);
                    }
                  }}
                />
              </th>
              {colonnes.map(([libelle, triCle, numerique]) => (
                <th
                  key={libelle}
                  className={numerique ? 'num' : undefined}
                  onClick={() => {
                    if (!triCle) return;
                    setTri(triCle === 'score_desc' && tri === 'score_desc' ? 'score_asc' : triCle);
                  }}
                  title={triCle ? 'Trier' : undefined}
                  style={{ cursor: triCle ? 'pointer' : 'default' }}
                >
                  {libelle}
                  {triCle && tri.startsWith(triCle.split('_')[0]!) ? ' ▾' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {requete.data.resultats.map((l) => {
              const statutProspection = referentiel.statutsProspection.find(
                (s) => s.id === l.statutProspection,
              );
              /*
               * L'ETIQUETTE EST CALCULEE UNE FOIS PAR LIGNE, et non plus dans la cellule.
               * Sa couleur sert desormais a DEUX endroits : la pastille de statut et la jauge
               * du score. Le score etait rendu en noir ordinaire alors que l'application porte
               * une palette de feux complete et s'en sert partout ailleurs : le chiffre central
               * du produit ne se lisait pas d'un coup d'oeil, il fallait comparer ligne a ligne.
               */
              const etiquette = etiquetteStatut(
                l.statutScore,
                l.nbKnockOutsBloquants,
                referentiel.palette,
                l.limiteViabilite,
              );
              return (
                <tr
                  key={l.idu}
                  onClick={() => onOuvrir(l)}
                  className={selection.includes(l.idu) ? 'ligne-selectionnee' : undefined}
                >
                  {/*
                    `stopPropagation` sur la CELLULE et pas seulement sur la case : sans cela, un
                    clic a cote de la case — dans la meme cellule — ouvrirait la fiche alors que
                    l'utilisateur visait la selection.
                  */}
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.includes(l.idu)}
                      aria-label={`Retenir la parcelle ${l.section} ${l.numero}`}
                      onChange={() => etat.basculerSelection(l.idu)}
                    />
                  </td>
                  <td>{l.nomCommune ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--police-mono)', fontSize: 11.5 }}>
                    {l.section} {l.numero}
                  </td>
                  <td className="num">{formatNombre(l.surfaceHa, 'ha', 2)}</td>
                  <td>
                    {/* La decision « redhibitoire ou score faible » vit dans
                        utils/affichage, pour etre testable : c'est la confusion des deux qui
                        a produit le defaut le plus couteux du troisieme audit. */}
                    {etiquette == null ? null : (
                      <span
                        className="etiquette-statut"
                        style={{ background: etiquette.couleur }}
                        title={etiquette.titre}
                      >
                        {etiquette.libelle}
                      </span>
                    )}
                  </td>
                  {/*
                    LE SCORE PORTE SA JAUGE. Le chiffre reste ecrit — c'est lui qui fait foi et
                    c'est lui qui part dans les exports — mais une barre de largeur
                    proportionnelle, dans la couleur du statut, rend la comparaison entre lignes
                    immediate. La couleur n'est PAS appliquee au texte : les teintes de la palette
                    sont concues comme des fonds, les passer en couleur de texte aurait degrade le
                    contraste sur les tons clairs.
                  */}
                  <td className="num cellule-score">
                    {l.scoreGlobal == null ? (
                      '—'
                    ) : (
                      <>
                        <strong>{Math.round(l.scoreGlobal)}</strong>
                        <span className="score-jauge" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.max(3, Math.min(100, l.scoreGlobal))}%`,
                              background: etiquette?.couleur ?? 'var(--bordure)',
                            }}
                          />
                        </span>
                      </>
                    )}
                  </td>
                  {/*
                    La colonne donne le trace estime — la grandeur notee et facturee — et rappelle
                    le vol d'oiseau en infobulle plutot que d'afficher deux nombres dans une
                    cellule etroite.

                    UN TIRET SANS EXPLICATION EST UNE AFFIRMATION VIDE. Sur un territoire ou la
                    couche des postes sources n'est pas ingeree, cette colonne rend « — » sur
                    CHAQUE ligne, et elle sert en plus de clef de tri : cliquer son en-tete ne
                    change alors rien, sans un mot. Mesure avant l'ingestion des postes : 301
                    lignes sur 301 vides, et rien a l'ecran pour distinguer « pas de poste
                    a proximite » de « on n'a pas regarde ». L'infobulle le dit maintenant, et
                    nomme les deux causes possibles plutot que d'en choisir une au hasard.
                  */}
                  <td
                    className="num"
                    title={
                      l.distancePosteKm == null
                        ? 'Distance au poste source non renseignée : soit la couche des postes ' +
                          "n'est pas ingérée sur ce territoire, soit cette parcelle n'a pas été " +
                          'requalifiée depuis sa dernière ingestion. Ce n’est pas une absence de ' +
                          'poste à proximité.'
                        : `${formatNombre(l.distancePosteKm, 'km', 1)} à vol d'oiseau`
                    }
                  >
                    {formatNombre(l.lineaireRaccordementKm, 'km', 1)}
                  </td>
                  <td className="num">{formatNombre(l.pentePct, '%', 1)}</td>
                  {/* La colonne montrait `agricole exploite` : la valeur d'enumeration, dont on
                      avait seulement remplace les soulignes par des espaces. Le vocabulaire est
                      desormais celui de `@enr/core`, partage avec la fiche, le PDF et le CSV. */}
                  <td>{libelleTypeSol(l.typeSol) ?? '—'}</td>
                  <td>
                    {statutProspection ? (
                      <span
                        className="etiquette-statut"
                        style={{ background: statutProspection.couleur }}
                      >
                        {statutProspection.libelle}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--texte-faible)' }}>non suivie</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--texte-faible)', marginTop: 11 }}>
        Les scores sont une aide à la priorisation et non une garantie de faisabilité. Le contour
        cadastral est indicatif et sans valeur juridique.
      </p>
    </div>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE LA RECHERCHE A REELLEMENT BALAYE — le bandeau qui empeche « 0 resultat » de mentir
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LE DEFAUT QU'IL CORRIGE. La liste ne portait que deux nombres : le total trouve et le nombre
 * affiche. Sur un departement jamais qualifie, elle rendait donc « 0 résultat » et « Aucune
 * parcelle ne correspond aux filtres » — deux phrases exactes et une conclusion FAUSSE. Un
 * operateur qui les lit conclut qu'il n'y a rien a prospecter dans ce departement, et passe au
 * suivant. C'est le contresens le plus couteux qu'un outil de prospection puisse produire, et
 * aucun message d'erreur ne l'aurait signale : le serveur repondait 200, correctement.
 *
 * TROIS SITUATIONS, TROIS MESSAGES DISTINCTS :
 *   - le territoire n'a jamais ete balaye        -> il faut le qualifier, pas changer les criteres ;
 *   - il est partiellement balaye                -> le resultat est un plancher, pas un inventaire ;
 *   - il est balaye et les criteres ne rendent rien -> ce sont bien les criteres qu'il faut revoir.
 *
 * ET IL NE S'AFFICHE PAS QUAND IL N'A RIEN A DIRE : sans territoire demande, la couverture n'a pas
 * de denominateur, donc pas de sens. Un bandeau qui parle toujours ne se lit plus.
 */
/**
 * Ce que le cahier des charges du developpeur a REELLEMENT fait a cette liste.
 *
 * LA MOITIE QUI COMPTE EST CELLE DES SEUILS IGNORES. Un seuil saisi par le developpeur et
 * silencieusement ecarte est la pire des reponses possibles : l'operateur croit son filtre actif,
 * remet un dossier, et personne ne sait que l'exigence n'a jamais ete verifiee. 250 des 292
 * contraintes du referentiel n'ont aujourd'hui aucune grandeur mesuree en face — ce n'est pas un
 * cas limite, c'est le cas courant.
 *
 * Le bandeau dit donc les deux nombres, et nomme chaque seuil non applique avec sa raison.
 */
function BandeauProfil({ profil }: { profil: ProfilApplique }): JSX.Element {
  const { seuilsAppliques, seuilsIgnores } = profil;
  return (
    <div className={seuilsIgnores.length > 0 ? 'bandeau-profil bandeau-profil-alerte' : 'bandeau-profil'}>
      <strong>
        Cahier des charges «&nbsp;{profil.nom}&nbsp;»
        {profil.developpeur ? ` — ${profil.developpeur}` : ''}
      </strong>{' '}
      : {seuilsAppliques} seuil{seuilsAppliques > 1 ? 's' : ''} appliqué
      {seuilsAppliques > 1 ? 's' : ''} à cette recherche
      {seuilsIgnores.length > 0 && (
        <>
          {', '}
          <strong>
            {seuilsIgnores.length} non appliqué{seuilsIgnores.length > 1 ? 's' : ''}
          </strong>
          {' :'}
          <ul className="bandeau-profil-liste">
            {seuilsIgnores.map((i) => (
              <li key={i.contrainteId}>{i.message}</li>
            ))}
          </ul>
        </>
      )}
      {seuilsIgnores.length === 0 && '.'}
    </div>
  );
}

function BandeauCouverture({
  couverture,
  total,
}: {
  /**
   * FACULTATIVE, ET LE TYPE DOIT LE DIRE. `couverture` est arrivee dans la reponse apres coup :
   * une capture de reference enregistree avant, un cache de navigateur, ou un serveur plus ancien
   * derriere le meme domaine la rendent absente. Ma premiere ecriture la destructurait sans
   * precaution — mes propres tests de rendu ont echoue avec « Cannot destructure property
   * departementsDemandes of undefined », et la liste ENTIERE disparaissait au profit d'un ecran
   * blanc. Perdre le bandeau est benin ; perdre le tableau des resultats parce que le bandeau
   * manque d'un champ ne l'est pas.
   */
  couverture: CouvertureRecherche | undefined;
  total: number;
}): JSX.Element | null {
  if (!couverture || !Array.isArray(couverture.departementsDemandes)) return null;
  const { departementsDemandes: deps, parcellesQualifiees, communesAvecParcelle } = couverture;

  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * UN SEUIL SUR UNE GRANDEUR JAMAIS MESUREE — « 0 resultat » ment a nouveau, autrement
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * LE FILTRE PAR SEUIL ecarte toute parcelle dont la grandeur n'est pas renseignee : c'est le bon
   * sens d'erreur, un seuil qu'on ne peut pas verifier ne doit pas etre repute satisfait. Mais la
   * consequence est brutale — mesure sur la base de reference, `foncier.nbProprietairesEstime` est
   * nul sur les 301 parcelles, parce que la donnee de propriete exige une habilitation et n'est
   * pas ingeree. Demander « au plus 2 proprietaires » rend donc ZERO, exactement comme si aucune
   * parcelle ne convenait.
   *
   * Le territoire est pourtant bien qualifie, et le bandeau annonce ses parcelles : sans cette
   * phrase, l'operateur conclurait qu'aucune parcelle du departement n'a moins de trois
   * proprietaires. Ce bloc passe AVANT le retour anticipe sur un territoire vide, parce qu'un
   * seuil non mesure se signale meme sans territoire demande.
   */
  const jamaisMesures = (couverture.seuilsRenseignes ?? []).filter((s) => s.renseignees === 0);
  if (jamaisMesures.length > 0) {
    return (
      <div className="couverture couverture-vide" role="status">
        <strong>
          {jamaisMesures.length > 1
            ? `${jamaisMesures.length} critères ne sont mesurés sur aucune parcelle`
            : 'Un critère n’est mesuré sur aucune parcelle'}{' '}
          du territoire.
        </strong>{' '}
        {jamaisMesures.map((s) => s.chemin).join(', ')} — la donnée n’a jamais été renseignée ici.
        Le résultat est donc vide <em>pour cette raison</em>, et non parce qu’aucune parcelle ne
        conviendrait. Retirez ce seuil pour voir ce que les autres critères donnent.
      </div>
    );
  }

  if (deps.length === 0) return null;

  const territoire = `${deps.length} département${deps.length > 1 ? 's' : ''} (${deps.join(', ')})`;

  if (parcellesQualifiees === 0) {
    return (
      <div className="couverture couverture-vide" role="status">
        <strong>Ce territoire n&apos;a jamais été qualifié.</strong> {territoire} : aucune parcelle
        n&apos;y a encore été évaluée pour cette filière. « 0 résultat » ne veut donc pas dire
        « aucun foncier propice » — il n&apos;y a rien à comparer. Lancez une qualification sur la
        carte avant de conclure.
      </div>
    );
  }

  const partCommunes =
    couverture.communesDuTerritoire && couverture.communesDuTerritoire > 0
      ? Math.round((communesAvecParcelle / couverture.communesDuTerritoire) * 100)
      : null;

  return (
    <div className="couverture" role="status">
      <strong>
        {formatNombre(total, '', 0)} parcelle{total > 1 ? 's' : ''} retenue{total > 1 ? 's' : ''}
      </strong>{' '}
      sur {formatNombre(parcellesQualifiees, '', 0)} qualifiée
      {parcellesQualifiees > 1 ? 's' : ''} dans {territoire}.{' '}
      {partCommunes != null && (
        <>
          Le balayage couvre {communesAvecParcelle} commune{communesAvecParcelle > 1 ? 's' : ''} sur{' '}
          {couverture.communesDuTerritoire} ({partCommunes} %).{' '}
        </>
      )}
      {/*
        LA PHRASE QUI COMPTE. Elle ne s'affiche que sous 90 % de communes couvertes, seuil au-dela
        duquel « partiel » cesserait d'informer. Le resultat est un PLANCHER : dire l'inverse — ou
        ne rien dire — laisserait croire a un inventaire.
      */}
      {partCommunes != null && partCommunes < 90 && (
        <em>
          Le territoire n&apos;est que partiellement qualifié : ce résultat est un minimum, pas un
          inventaire.
        </em>
      )}
    </div>
  );
}
