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

  const filtres = { ...etat.filtres, filiere, tri, limite: 300 };
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
    ['Poste source', 'distance_poste_asc', true],
    ['Pente', null, true],
    ['Nature du sol', null, false],
    ['Prospection', null, false],
  ];

  return (
    <div className="vue-plein">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Parcelles qualifiees
          {requete.data && (
            <span style={{ fontWeight: 400, color: 'var(--texte-faible)', fontSize: 13 }}>
              {' '}
              — {requete.data.total} resultat{requete.data.total > 1 ? 's' : ''}
              {requete.data.total > requete.data.resultats.length &&
                ` (${requete.data.resultats.length} affiches)`}
            </span>
          )}
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
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
            Retour a la carte
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
          Les parcelles doivent d&apos;abord etre qualifiees : deplacez-vous sur la carte au-dela du
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
              return (
                <tr key={l.idu} onClick={() => onOuvrir(l)}>
                  <td>{l.nomCommune ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--police-mono)', fontSize: 11.5 }}>
                    {l.section} {l.numero}
                  </td>
                  <td className="num">{formatNombre(l.surfaceHa, 'ha', 2)}</td>
                  <td>
                    {l.statutScore && (
                      <span
                        className="etiquette-statut"
                        style={{ background: referentiel.palette.couleursScore[l.statutScore] }}
                      >
                        {referentiel.palette.libellesScore[l.statutScore]}
                      </span>
                    )}
                  </td>
                  <td className="num">{l.scoreGlobal == null ? '—' : Math.round(l.scoreGlobal)}</td>
                  <td className="num">{formatNombre(l.distancePosteKm, 'km', 1)}</td>
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
        Les scores sont une aide a la priorisation et non une garantie de faisabilite. Le contour
        cadastral est indicatif et sans valeur juridique.
      </p>
    </div>
  );
}
