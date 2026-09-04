/**
 * Vue liste : resultats des filtres, triables, exportables en CSV.
 * Un clic sur une ligne ouvre la fiche et recentre la carte.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Filiere } from '@enr/core';
import { api, ErreurApi, type LigneListe, type Referentiel } from '../api/client.js';
import { useEtat } from '../store/etat.js';
import { formatNombre } from '../utils/geometrie.js';
import { etiquetteStatut } from '../utils/affichage.js';

type Tri = 'score_desc' | 'score_asc' | 'surface_desc' | 'distance_poste_asc';

interface Props {
  filiere: Filiere;
  referentiel: Referentiel;
  onOuvrir: (ligne: LigneListe) => void;
}

export function VueListe({ filiere, referentiel, onOuvrir }: Props): JSX.Element {
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
  const requete = useQuery({
    queryKey: ['liste', filtres],
    queryFn: () => api.filtrer(filtres),
    retry: 1,
  });

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Parcelles qualifiées
          {requete.data && (
            <span style={{ fontWeight: 400, color: 'var(--texte-faible)', fontSize: 13 }}>
              {' '}
              — {requete.data.total} résultat{requete.data.total > 1 ? 's' : ''}
              {requete.data.total > requete.data.resultats.length &&
                ` (${requete.data.resultats.length} affiches)`}
              {borne
                ? ' — dans la zone affichée'
                : ' — sur tout le territoire qualifie'}
            </span>
          )}
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            title="Limite la liste et les exports aux parcelles visibles sur la carte."
          >
            <input
              type="checkbox"
              checked={etat.limiterALEmprise}
              onChange={() => etat.basculerLimiteEmprise()}
            />
            Limiter à la zone affichée
          </label>
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
          <button type="button" className="bouton" onClick={() => etat.definirVue('carte')}>
            Retour à la carte
          </button>
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
              );
              return (
                <tr key={l.idu} onClick={() => onOuvrir(l)}>
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
                  {/* La colonne donne le trace estime — la grandeur notee et facturee — et
                      rappelle le vol d'oiseau en infobulle plutot que d'afficher deux
                      nombres dans une cellule etroite. */}
                  <td
                    className="num"
                    title={
                      l.distancePosteKm == null
                        ? undefined
                        : `${formatNombre(l.distancePosteKm, 'km', 1)} a vol d'oiseau`
                    }
                  >
                    {formatNombre(l.lineaireRaccordementKm, 'km', 1)}
                  </td>
                  <td className="num">{formatNombre(l.pentePct, '%', 1)}</td>
                  <td>{l.typeSol?.replace(/_/g, ' ') ?? '—'}</td>
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
