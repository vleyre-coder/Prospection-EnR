/**
 * Fiche parcelle : panneau lateral droit.
 *
 * Exigences couvertes :
 *   - toutes les rubriques du cahier des charges, dans l'ordre demande ;
 *   - un feu tricolore par critere, chaque critere depliable pour exposer la valeur brute,
 *     la SOURCE (nom, millesime, date d'interrogation, valeur juridique) et les regles
 *     reglementaires liees avec leur DATE d'entree en vigueur ;
 *   - une donnee absente s'affiche « donnee indisponible » et ne ressemble jamais a un
 *     critere satisfait ;
 *   - les avertissements contextuels sont rattaches a leur critere ou rubrique ;
 *   - mode impression : toutes les sections sont depliees (feuille de style).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Avertissement,
  EvaluationCritere,
  Feu,
  Filiere,
  KnockOut,
  ParcelleSnapshot,
  ResultatScore,
  SeuilProcedure,
  SourceRef,
  StatutProspection,
} from '@enr/core';
import { api, ErreurApi, type FicheParcelle as Fiche, type Referentiel } from '../api/client.js';
import { ponderationCourante, STATUTS, useEtat } from '../store/etat.js';
import { formatDate, formatDateHeure, formatNombre } from '../utils/geometrie.js';

interface Props {
  idu: string;
  filiere: Filiere;
  referentiel: Referentiel;
}

export function FicheParcelle({ idu, filiere, referentiel }: Props): JSX.Element {
  const etat = useEtat();
  const cache = useQueryClient();

  const requete = useQuery({
    queryKey: ['fiche', idu, filiere],
    queryFn: () => api.fiche(idu, filiere),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  // Lorsque l'utilisateur a modifie les ponderations, le score affiche doit etre celui de
  // SON profil, pas celui du profil par defaut stocke en base.
  const ponderation = ponderationCourante(etat);
  const scorePersonnalise = useQuery({
    queryKey: ['score-perso', idu, filiere, ponderation],
    queryFn: () => api.scoreAvecPonderation(idu, filiere, ponderation ?? {}),
    enabled: ponderation != null && requete.isSuccess,
    staleTime: 60 * 1000,
  });

  if (requete.isLoading) {
    return (
      <aside className="panneau panneau-droite">
        <div className="panneau-entete">
          <h2>Fiche parcelle</h2>
          <button
            type="button"
            className="bouton-discret"
            style={{ marginLeft: 'auto' }}
            onClick={() => etat.selectionnerParcelle(null)}
          >
            Fermer
          </button>
        </div>
        <div className="panneau-contenu" style={{ padding: 14 }}>
          <div className="chargement">
            <span className="tourniquet" />
            Interrogation des sources officielles (cadastre, urbanisme, RPG, risques,
            altimetrie, raccordement)…
          </div>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="squelette" style={{ width: `${95 - i * 6}%` }} />
          ))}
        </div>
      </aside>
    );
  }

  if (requete.isError || !requete.data) {
    const err = requete.error as ErreurApi | undefined;
    return (
      <aside className="panneau panneau-droite">
        <div className="panneau-entete">
          <h2>Fiche parcelle</h2>
          <button
            type="button"
            className="bouton-discret"
            style={{ marginLeft: 'auto' }}
            onClick={() => etat.selectionnerParcelle(null)}
          >
            Fermer
          </button>
        </div>
        <div className="erreur-encart">
          <strong>Qualification impossible</strong>
          <p style={{ margin: '5px 0 0' }}>
            {err?.message ?? 'Erreur inconnue.'}
            {err?.estSourceIndisponible &&
              " Les criteres concernes resteront non evalues : l'absence de donnee ne vaut pas absence de contrainte."}
          </p>
          <button
            type="button"
            className="bouton"
            style={{ marginTop: 9 }}
            onClick={() => void requete.refetch()}
          >
            Reessayer
          </button>
        </div>
      </aside>
    );
  }

  const fiche = requete.data;
  const score = scorePersonnalise.data ?? fiche.score;
  const personnalise = scorePersonnalise.data != null;

  return (
    <aside className="panneau panneau-droite">
      <div className="panneau-entete">
        <h2>Fiche parcelle</h2>
        <div className="fiche-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
          <button
            type="button"
            className="bouton-discret"
            title="Re-interroger toutes les sources"
            onClick={() => {
              void api.fiche(idu, filiere, true).then((f) => {
                cache.setQueryData(['fiche', idu, filiere], f);
              });
            }}
          >
            Rafraichir
          </button>
          <button type="button" className="bouton-discret" onClick={() => window.print()}>
            Imprimer
          </button>
          <button
            type="button"
            className="bouton-discret"
            onClick={() => etat.selectionnerParcelle(null)}
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="panneau-contenu">
        <div className="fiche-entete">
          <h2>
            {fiche.parcelle.nomCommune ?? fiche.parcelle.codeInsee} &mdash; section{' '}
            {fiche.parcelle.section} n° {fiche.parcelle.numero}
          </h2>
          <div className="reference">
            IDU {fiche.parcelle.idu} &middot; commune {fiche.parcelle.codeInsee} &middot;
            departement {fiche.parcelle.codeDepartement}
          </div>
        </div>

        <Synthese
          score={score}
          fiche={fiche}
          referentiel={referentiel}
          personnalise={personnalise}
        />

        <SectionCriteres score={score} referentiel={referentiel} />

        <RubriquesDonnees snapshot={fiche.snapshot} referentiel={referentiel} />

        <BlocProspection fiche={fiche} filiere={filiere} score={score} />

        <BlocExports idu={idu} filiere={filiere} />

        <div className="note-bas">
          <strong>Tracabilite.</strong> {Object.keys(fiche.snapshot.sources).length} source(s)
          interrogee(s) le {formatDateHeure(fiche.snapshot.dateSnapshot)}.{' '}
          {fiche.connecteursEnEchec.length > 0 && (
            <>
              {fiche.connecteursEnEchec.length} connecteur(s) en echec (
              {fiche.connecteursEnEchec.join(', ')}) : les criteres correspondants sont grises.{' '}
            </>
          )}
          Moteur de scoring version {score.versionMoteur}. Referentiel reglementaire verifie le{' '}
          {formatDate(referentiel.referentielDerniereVerification)}. Le contour cadastral est
          indicatif et sans valeur juridique.
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Synthese
// ---------------------------------------------------------------------------

function Synthese({
  score,
  fiche,
  referentiel,
  personnalise,
}: {
  score: ResultatScore;
  fiche: Fiche;
  referentiel: Referentiel;
  personnalise: boolean;
}): JSX.Element {
  const couleur = referentiel.palette.couleursScore[score.statut];
  const surfaceHa =
    (fiche.parcelle.surfaceCalculeeM2 ?? fiche.parcelle.contenanceM2 ?? 0) / 10000;

  return (
    <>
      <div className="synthese">
        <div
          className={`badge-score${score.scoreGlobal == null ? ' ecarte' : ''}`}
          style={{ background: couleur }}
        >
          {score.scoreGlobal == null ? (
            <span className="valeur">ECARTEE</span>
          ) : (
            <>
              <span className="valeur">{Math.round(score.scoreGlobal)}</span>
              <span className="sur">/ 100</span>
            </>
          )}
        </div>
        <div className="synthese-texte">
          <div className="synthese-statut">{referentiel.palette.libellesScore[score.statut]}</div>
          <div className="synthese-regime">
            {score.regimeImplantation
              ? (referentiel.libellesRegime[score.regimeImplantation] ?? score.regimeImplantation)
              : referentiel.palette.descriptionsScore[score.statut]}
          </div>
          <div className="synthese-regime">
            {formatNombre(surfaceHa, 'ha', 2)}
            {personnalise && ' · ponderation personnalisee'}
          </div>
          <div className="jauge" aria-hidden>
            <div style={{ width: `${Math.round(score.couvertureDonnees * 100)}%` }} />
          </div>
          <div className="jauge-legende">
            Couverture de donnees : {Math.round(score.couvertureDonnees * 100)} %
            {score.couvertureDonnees < 0.8 &&
              ` — ${score.criteres.filter((c) => c.note == null).length} critere(s) non evalue(s)`}
          </div>
        </div>
      </div>

      {score.knockOuts.map((k) => (
        <CarteKnockOut key={k.id} ko={k} referentiel={referentiel} />
      ))}

      {score.limitesViabilite.map((l) => (
        <div key={l.id} className="carte-ko derogeable">
          <div className="entete">
            <span className="marqueur">Viabilite</span>
            {l.libelle}
          </div>
          <p className="motif">{l.motif}</p>
        </div>
      ))}

      <details className="section" open>
        <summary>Synthese</summary>
        <div className="section-corps">
          {score.pointsForts.length > 0 && (
            <>
              <div className="legende-titre">Points forts</div>
              <ul className="points-liste">
                {score.pointsForts.map((p) => (
                  <li key={p.critereId}>
                    <span className="point" style={{ background: 'var(--vert)' }} />
                    <span className="lib">{p.libelle}</span>
                    <span className="val">{p.valeur}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {score.pointsVigilance.length > 0 && (
            <>
              <div className="legende-titre" style={{ marginTop: 11 }}>
                Points de vigilance
              </div>
              <ul className="points-liste">
                {score.pointsVigilance.map((p) => (
                  <li key={p.critereId}>
                    <span className="point" style={{ background: 'var(--orange)' }} />
                    <span className="lib">{p.libelle}</span>
                    <span className="val">{p.valeur}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>

      {score.seuilsProcedure.length > 0 && (
        <details className="section" open>
          <summary>
            Seuils de procedure applicables
            <span className="compteur-section">{score.seuilsProcedure.length}</span>
          </summary>
          <div className="section-corps">
            {score.seuilsProcedure.map((s) => (
              <LigneSeuil key={s.regleId} seuil={s} />
            ))}
            <p style={{ fontSize: 10.5, color: 'var(--texte-faible)', marginTop: 9 }}>
              Les seuils reglementaires evoluent : la date d&apos;entree en vigueur de chaque
              regle appliquee est indiquee. Verifiez la version en vigueur a la date de votre
              depot.
            </p>
          </div>
        </details>
      )}
    </>
  );
}

function CarteKnockOut({ ko, referentiel }: { ko: KnockOut; referentiel: Referentiel }): JSX.Element {
  const regle = ko.regleLiee
    ? Object.values(referentiel.reglementation)
        .flatMap((g) => Object.values(g))
        .find((r) => r.id === ko.regleLiee)
    : undefined;

  return (
    <div className={`carte-ko${ko.derogeable ? ' derogeable' : ''}`}>
      <div className="entete">
        <span className="marqueur">{ko.derogeable ? 'Derogeable' : 'Redhibitoire'}</span>
        {ko.libelle}
      </div>
      <p className="motif">{ko.motif}</p>
      {regle && (
        <div className="regle">
          {regle.reference} &middot; en vigueur depuis le {formatDate(regle.dateEntreeEnVigueur)}
          {regle.instable && ' · seuil susceptible d’avoir evolue'}
        </div>
      )}
      {ko.source && (
        <div className="regle">
          Source : {ko.source.nom}
          {ko.source.millesime ? ` (millesime ${ko.source.millesime})` : ''}
        </div>
      )}
    </div>
  );
}

function LigneSeuil({ seuil }: { seuil: SeuilProcedure }): JSX.Element {
  const marque = seuil.applicable === true ? '[×]' : seuil.applicable === false ? '[ ]' : '[?]';
  return (
    <div className="seuil-ligne">
      <span className="seuil-marque" title={
        seuil.applicable === true
          ? 'Applicable au vu des caracteristiques estimees'
          : seuil.applicable === false
            ? 'Non applicable'
            : 'Applicabilite indeterminee'
      }>{marque}</span>
      <span>
        {seuil.libelle}
        <span className="ref">
          {seuil.reference} &middot; en vigueur depuis le {formatDate(seuil.dateEntreeEnVigueur)}
        </span>
        {seuil.commentaire && (
          <span className="ref" style={{ fontStyle: 'italic' }}>
            {seuil.commentaire}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criteres, regroupes par famille
// ---------------------------------------------------------------------------

function SectionCriteres({
  score,
  referentiel,
}: {
  score: ResultatScore;
  referentiel: Referentiel;
}): JSX.Element {
  const parFamille = useMemo(() => {
    const m = new Map<string, EvaluationCritere[]>();
    for (const c of score.criteres) m.set(c.famille, [...(m.get(c.famille) ?? []), c]);
    return [...m.entries()];
  }, [score.criteres]);

  return (
    <details className="section" open>
      <summary>
        Detail des criteres
        <span className="compteur-section">
          {score.criteres.length} dont {score.criteres.filter((c) => c.note == null).length} non
          evalue(s)
        </span>
      </summary>
      <div className="section-corps">
        {parFamille.map(([famille, criteres]) => (
          <div key={famille}>
            <div className="groupe-famille">
              {referentiel.famillesLibelles[famille] ?? famille}
            </div>
            {criteres.map((c) => (
              <LigneCritere key={c.id} critere={c} referentiel={referentiel} />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function LigneCritere({
  critere,
  referentiel,
}: {
  critere: EvaluationCritere;
  referentiel: Referentiel;
}): JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const definition = referentiel.criteres[critere.id];
  const avertissements = referentiel.avertissements.filter(
    (a) => a.portee === 'contextuel' && a.cible?.includes(critere.id),
  );
  const regles = critere.reglesLiees
    .map((id) =>
      Object.values(referentiel.reglementation)
        .flatMap((g) => Object.values(g))
        .find((r) => r.id === id),
    )
    .filter((r): r is NonNullable<typeof r> => r != null);

  return (
    <div className="critere">
      <button
        type="button"
        className="critere-tete"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
      >
        <span
          className="feu"
          style={{ background: referentiel.palette.couleursScore[critere.feu] }}
          aria-label={referentiel.palette.libellesScore[critere.feu]}
        />
        <span className="lib">{critere.libelle}</span>
        <span className="val">{critere.valeurAffichee}</span>
        <span className="critere-poids">
          <span className="barre-poids" aria-hidden>
            <div style={{ width: `${Math.min(100, critere.poids * 400)}%` }} />
          </span>
          <span className="chiffre">
            poids {(critere.poids * 100).toFixed(1)} %
            {critere.note != null && ` · note ${Math.round(critere.note)}/100`}
          </span>
        </span>
      </button>

      {ouvert && (
        <div className="critere-detail">
          {definition && <p style={{ margin: '0 0 6px' }}>{definition.explication}</p>}
          {critere.commentaire && <p style={{ margin: '0 0 6px' }}>{critere.commentaire}</p>}

          <div>
            Valeur brute :{' '}
            <span className="brut">
              {critere.valeurBrute == null ? 'null' : String(critere.valeurBrute)}
              {definition?.unite ? ` ${definition.unite}` : ''}
            </span>
            {critere.note != null && (
              <>
                {' '}· contribution au score : <span className="brut">{critere.contribution}</span>
              </>
            )}
          </div>

          {critere.source ? (
            <BlocSource source={critere.source} />
          ) : (
            <div className="source-bloc">
              <span className="nom">Source non renseignee</span>
              <div style={{ color: 'var(--texte-faible)' }}>
                Ce critere n&apos;a pas pu etre rattache a une source : la donnee est indisponible.
              </div>
            </div>
          )}

          {regles.map((r) => (
            <div key={r.id} className="regle-bloc">
              <strong>{r.libelle}</strong>
              {r.valeur != null && ` — ${r.valeur} ${r.unite ?? ''}`}
              <br />
              {r.reference} &middot; en vigueur depuis le{' '}
              <span className="date">{formatDate(r.dateEntreeEnVigueur)}</span>
              {r.instable && ' · regle instable ou declinee localement'}
            </div>
          ))}

          {avertissements.map((a) => (
            <BlocAvertissement key={a.id} avertissement={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlocSource({ source }: { source: SourceRef }): JSX.Element {
  const juridique: Record<string, string> = {
    opposable: 'opposable',
    indicative: 'indicative',
    pre_reperage: 'pre-reperage seulement',
  };
  return (
    <div className="source-bloc">
      <span className="nom">{source.nom}</span>
      <dl>
        {source.millesime && (
          <>
            <dt>Millesime</dt>
            <dd>{source.millesime}</dd>
          </>
        )}
        {source.dateMiseAJour && (
          <>
            <dt>Mise a jour</dt>
            <dd>{formatDate(source.dateMiseAJour)}</dd>
          </>
        )}
        <dt>Interrogee le</dt>
        <dd>{formatDateHeure(source.dateInterrogation)}</dd>
        <dt>Valeur</dt>
        <dd>{juridique[source.valeurJuridique] ?? source.valeurJuridique}</dd>
      </dl>
      {source.avertissement && (
        <p style={{ margin: '5px 0 0', color: 'var(--texte-faible)' }}>{source.avertissement}</p>
      )}
    </div>
  );
}

function BlocAvertissement({ avertissement }: { avertissement: Avertissement }): JSX.Element {
  return (
    <div className="avertissement-contextuel">
      <strong>{avertissement.titre}</strong>
      {avertissement.texte}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rubriques de donnees brutes (section 6 du cahier des charges)
// ---------------------------------------------------------------------------

function val(v: unknown, unite = ''): JSX.Element {
  if (v == null || v === '') return <span className="absent">donnee indisponible</span>;
  if (typeof v === 'boolean') return <>{v ? 'oui' : 'non'}</>;
  if (typeof v === 'number') return <>{formatNombre(v, unite, Number.isInteger(v) ? 0 : 1)}</>;
  return <>{String(v)}</>;
}

function Rubrique({
  titre,
  cible,
  referentiel,
  enfants,
}: {
  titre: string;
  cible?: string;
  referentiel: Referentiel;
  enfants: Array<[string, JSX.Element]>;
}): JSX.Element {
  const avertissements = cible
    ? referentiel.avertissements.filter((a) => a.portee === 'contextuel' && a.cible?.includes(cible))
    : [];
  return (
    <details className="section">
      <summary>{titre}</summary>
      <div className="section-corps">
        <dl className="donnees">
          {enfants.map(([cle, contenu]) => (
            <div key={cle} style={{ display: 'contents' }}>
              <dt>{cle}</dt>
              <dd>{contenu}</dd>
            </div>
          ))}
        </dl>
        {avertissements.map((a) => (
          <BlocAvertissement key={a.id} avertissement={a} />
        ))}
      </div>
    </details>
  );
}

function zonageTexte(z: { recouvre: boolean | null; distanceM: number | null; nom: string | null }): JSX.Element {
  if (z.recouvre === null && z.distanceM === null) return <span className="absent">donnee indisponible</span>;
  if (z.recouvre) return <>Recouvrement{z.nom ? ` — ${z.nom}` : ''}</>;
  if (z.distanceM == null) return <>hors zonage</>;
  return (
    <>
      {z.distanceM < 1000 ? `${Math.round(z.distanceM)} m` : `${(z.distanceM / 1000).toFixed(1)} km`}
      {z.nom ? ` — ${z.nom}` : ''}
    </>
  );
}

function RubriquesDonnees({
  snapshot: s,
  referentiel,
}: {
  snapshot: ParcelleSnapshot;
  referentiel: Referentiel;
}): JSX.Element {
  const poste = s.raccordement.posteLePlusProche;
  return (
    <>
      <Rubrique
        titre="Identite"
        cible="identite"
        referentiel={referentiel}
        enfants={[
          ['Commune', val(`${s.identite.nomCommune} (${s.identite.codeInsee})`)],
          ['Prefixe / section / n°', val(`${s.identite.prefixe} ${s.identite.section} ${s.identite.numero}`)],
          ['Contenance cadastrale', val(s.identite.contenanceM2, 'm²')],
          ['Surface calculee', val(s.identite.surfaceCalculeeM2, 'm²')],
          ['Departement', val(s.identite.codeDepartement)],
        ]}
      />

      <Rubrique
        titre="Urbanisme"
        referentiel={referentiel}
        enfants={[
          ['Document', val(s.urbanisme.typeDocument)],
          ['Couvert par le GPU', val(s.urbanisme.couvertParGpu)],
          [
            'Zonage',
            s.urbanisme.zonages.length === 0 ? (
              val(null)
            ) : (
              <>
                {s.urbanisme.zonages.map((z, i) => (
                  <div key={i}>
                    {z.libelle ?? z.typeZone}
                    {z.typeZone && z.libelle !== z.typeZone ? ` (type ${z.typeZone})` : ''}
                    {z.dateApprobation ? ` — approuve le ${formatDate(z.dateApprobation)}` : ''}
                    {z.urlReglement && (
                      <>
                        {' '}
                        <a href={z.urlReglement} target="_blank" rel="noreferrer">
                          reglement
                        </a>
                      </>
                    )}
                  </div>
                ))}
              </>
            ),
          ],
          [
            'Prescriptions',
            s.urbanisme.prescriptions.length === 0 ? (
              <>aucune</>
            ) : (
              <>
                {s.urbanisme.prescriptions.map((p, i) => (
                  <div key={i}>
                    {p.libelle ?? p.type}
                    {p.estEbc && ' — espace boise classe'}
                    {p.estEmplacementReserve && ' — emplacement reserve'}
                  </div>
                ))}
              </>
            ),
          ],
          ['Servitudes', s.urbanisme.servitudes.length ? <>{s.urbanisme.servitudes.join(', ')}</> : <>aucune</>],
          [
            'Zone d’acceleration ENR',
            s.urbanisme.zaer.present == null ? (
              val(null)
            ) : s.urbanisme.zaer.present ? (
              <>
                oui{s.urbanisme.zaer.filieres.length ? ` (${s.urbanisme.zaer.filieres.join(', ')})` : ''}
                {s.urbanisme.zaer.dateDeliberation ? ` — ${formatDate(s.urbanisme.zaer.dateDeliberation)}` : ''}
              </>
            ) : (
              <>non</>
            ),
          ],
          [
            'Document-cadre PV au sol',
            !s.urbanisme.documentCadrePvSol.departementCouvert ? (
              <span className="absent">departement non ingere</span>
            ) : (
              <>
                {s.urbanisme.documentCadrePvSol.parcelleEligible == null
                  ? 'eligibilite a apprecier'
                  : s.urbanisme.documentCadrePvSol.parcelleEligible
                    ? 'parcelle eligible'
                    : 'parcelle non eligible'}
                {s.urbanisme.documentCadrePvSol.dateArrete
                  ? ` — arrete du ${formatDate(s.urbanisme.documentCadrePvSol.dateArrete)}`
                  : ''}
              </>
            ),
          ],
        ]}
      />

      <Rubrique
        titre="Occupation et nature du sol"
        referentiel={referentiel}
        enfants={[
          ['Type de sol retenu', val(s.occupationSol.typeSol)],
          ['Culture (RPG)', val(s.occupationSol.rpg.libelleCulture ?? s.occupationSol.rpg.libelleGroupeCulture)],
          ['Code culture', val(s.occupationSol.rpg.codeCulture)],
          ['Millesime RPG', val(s.occupationSol.rpg.millesime)],
          ['Millesimes declares', val(s.occupationSol.rpg.anneesDeclareesConsecutives)],
          ['Inculte depuis le 10/03/2013', s.occupationSol.inculteDepuis2013 == null ? <span className="absent">a demontrer (historique RPG et photo-interpretation)</span> : val(s.occupationSol.inculteDepuis2013)],
          [
            'AOP / AOC',
            s.occupationSol.aop.presente == null ? (
              val(null)
            ) : s.occupationSol.aop.presente ? (
              <>
                {s.occupationSol.aop.appellations.join(', ') || 'oui'}
                {s.occupationSol.aop.viticole && ' — viticole'}
              </>
            ) : (
              <>aucune</>
            ),
          ],
          ['Potentiel agronomique', val(s.occupationSol.potentielAgronomique, '/100')],
          [
            'Boisement',
            s.occupationSol.foret.recouvre == null
              ? val(null)
              : val(
                  s.occupationSol.foret.recouvre
                    ? `${Math.round((s.occupationSol.foret.partBoisee ?? 0) * 100)} %${s.occupationSol.foret.type ? ` (${s.occupationSol.foret.type})` : ''}`
                    : 'aucun',
                ),
          ],
        ]}
      />

      <Rubrique
        titre="Topographie et geotechnique"
        referentiel={referentiel}
        enfants={[
          ['Pente moyenne', val(s.topographie.pentePct, '%')],
          ['Pente maximale', val(s.topographie.penteMaxPct, '%')],
          ['Orientation', val(s.topographie.orientationDeg, '°')],
          ['Altitude', val(s.topographie.altitudeM, 'm')],
          ['Denivele', val(s.topographie.deniveleM, 'm')],
          ['Alea retrait-gonflement des argiles', val(s.topographie.aleaArgiles)],
          ['Cavites souterraines (< 1 km)', val(s.topographie.cavitesProches)],
          ['Mouvements de terrain', val(s.topographie.mouvementsTerrain)],
        ]}
      />

      <Rubrique
        titre="Eau et zones humides"
        cible="env_zone_humide"
        referentiel={referentiel}
        enfants={[
          [
            'Zone humide',
            s.eau.zoneHumide == null ? (
              val(null)
            ) : (
              <>
                {{ oui: 'cartographiee', non: 'hors zonage cartographie', a_confirmer: 'a confirmer' }[
                  s.eau.zoneHumide
                ]}
              </>
            ),
          ],
          ['Cours d’eau le plus proche', val(s.eau.distanceCoursEauM, 'm')],
          [
            'Captage AEP',
            s.eau.captageAep.dansPerimetre == null
              ? val(null)
              : s.eau.captageAep.dansPerimetre
                ? val(`perimetre ${s.eau.captageAep.type ?? 'non precise'}`)
                : val(s.eau.captageAep.distanceM, 'm'),
          ],
          ['Alea inondation', val(s.eau.inondation.alea)],
          ['Zonage PPRI', val(s.eau.inondation.zonagePpri)],
          ['Territoire a risque important (TRI)', val(s.eau.inondation.dansTri)],
          ['Contexte karstique', val(s.eau.karst)],
        ]}
      />

      <Rubrique
        titre="Milieux naturels"
        cible="env_especes_protegees"
        referentiel={referentiel}
        enfants={[
          ['Natura 2000 — habitats', zonageTexte(s.milieux.natura2000Habitats)],
          ['Natura 2000 — oiseaux', zonageTexte(s.milieux.natura2000Oiseaux)],
          ['ZNIEFF de type I', zonageTexte(s.milieux.znieff1)],
          ['ZNIEFF de type II', zonageTexte(s.milieux.znieff2)],
          ['Arrete de protection de biotope', zonageTexte(s.milieux.appb)],
          ['Reserve naturelle', zonageTexte(s.milieux.reserveNaturelle)],
          ['Coeur de parc national', zonageTexte(s.milieux.coeurParcNational)],
          ['Parc naturel regional', zonageTexte(s.milieux.parcNaturelRegional)],
          [
            'Trame verte et bleue',
            s.milieux.trameVerteBleue.reservoir == null && s.milieux.trameVerteBleue.corridor == null
              ? val(null)
              : val(
                  s.milieux.trameVerteBleue.reservoir
                    ? 'reservoir de biodiversite'
                    : s.milieux.trameVerteBleue.corridor
                      ? 'corridor'
                      : 'hors trame',
                ),
          ],
          ['Enjeu defrichement', val(s.milieux.enjeuDefrichement)],
          ['Pre-enjeu especes protegees', val(s.milieux.preEnjeuEspeces, '/100')],
          // Aucune source nationale ne publie ces deux sensibilites a la parcelle. Le
          // champ existe pour accueillir un atlas DREAL ou LPO le jour ou il sera ingere ;
          // tant qu'il est vide, on le dit, plutot que d'afficher une case blanche qui se
          // lit « rien a signaler ».
          [
            'Sensibilite avifaune',
            s.milieux.sensibiliteAvifaune == null
              ? val('aucune source ingeree - a verifier aupres de la DREAL / LPO')
              : val(s.milieux.sensibiliteAvifaune, '/100'),
          ],
          [
            'Sensibilite chiropteres',
            s.milieux.sensibiliteChiropteres == null
              ? val('aucune source ingeree - a verifier aupres de la DREAL / LPO')
              : val(s.milieux.sensibiliteChiropteres, '/100'),
          ],
        ]}
      />

      <Rubrique
        titre="Patrimoine et paysage"
        referentiel={referentiel}
        enfants={[
          ['Monument historique le plus proche', val(s.patrimoine.monumentHistorique.nom)],
          ['Distance', val(s.patrimoine.monumentHistorique.distanceM, 'm')],
          ['Dans un perimetre de protection', val(s.patrimoine.monumentHistorique.dansPerimetreProtection)],
          ['Site classe', zonageTexte(s.patrimoine.siteClasse)],
          ['Site inscrit', zonageTexte(s.patrimoine.siteInscrit)],
          ['Site patrimonial remarquable', zonageTexte(s.patrimoine.spr)],
          ['Avis de l’ABF requis', val(s.patrimoine.avisAbfRequis)],
          // Cet indice etait auparavant fabrique a partir du nombre de monuments
          // alentour, ce qui ne mesure aucune covisibilite reelle. Il ne sera renseigne
          // que par une etude paysagere.
          [
            'Indice de covisibilite',
            s.patrimoine.covisibiliteIndice == null
              ? val('non evalue - releve d’une etude paysagere')
              : val(s.patrimoine.covisibiliteIndice, '/100'),
          ],
          ['Sensibilite archeologique', val(s.patrimoine.sensibiliteArcheologique)],
        ]}
      />

      <Rubrique
        titre="Risques et servitudes"
        referentiel={referentiel}
        enfants={[
          ['PPRI', val(s.risques.ppri.present === null ? null : s.risques.ppri.present ? (s.risques.ppri.zonage ?? 'present') : 'absent')],
          ['PPRif', val(s.risques.pprif.present === null ? null : s.risques.pprif.present ? (s.risques.pprif.zonage ?? 'present') : 'absent')],
          ['PPRT', val(s.risques.pprt.present === null ? null : s.risques.pprt.present ? (s.risques.pprt.zonage ?? 'present') : 'absent')],
          [
            'Radars',
            s.risques.radars.length === 0 ? (
              val(null)
            ) : (
              <>
                {s.risques.radars.map((r, i) => (
                  <div key={i}>
                    {r.type} — {r.distanceKm} km
                    {r.distanceMinRequiseKm != null ? ` (requis ${r.distanceMinRequiseKm} km)` : ''}
                  </div>
                ))}
              </>
            ),
          ],
          ['Servitudes aeronautiques', val(s.risques.servitudesAeronautiques)],
          ['Faisceaux hertziens', val(s.risques.faisceauxHertziens)],
          ['Reseaux enterres', s.risques.reseauxEnterres.length ? <>{s.risques.reseauxEnterres.join(', ')}</> : val(null)],
          ['Sites et sols pollues (< 500 m)', val(s.risques.sitesPollues)],
          ['ICPE a proximite', val(s.risques.icpeProches)],
          ['Obligation de debroussaillement', val(s.risques.obligationDebroussaillement)],
        ]}
      />

      <Rubrique
        titre="Raccordement"
        cible="racc_capacite_residuelle"
        referentiel={referentiel}
        enfants={[
          ['Poste source le plus proche', val(poste?.nom)],
          ['Gestionnaire', val(poste?.gestionnaire)],
          ['Tension', val(poste?.tension)],
          ['Distance', val(poste?.distanceKm, 'km')],
          ['Capacite residuelle', val(poste?.capaciteResiduelleMw, 'MW')],
          ['Etat de saturation', val(poste?.etatSaturation)],
          ['File d’attente', val(poste?.fileAttenteMw, 'MW')],
          ['Quote-part S3REnR', val(poste?.quotePartEurParKw, 'EUR/kW')],
          [
            'Renforcement programme',
            poste?.renforcement.prevu == null
              ? val(null)
              : val(
                  poste.renforcement.prevu
                    ? `oui${poste.renforcement.horizon ? ` — ${poste.renforcement.horizon}` : ''}`
                    : 'non',
                ),
          ],
          [
            'Postes alternatifs',
            s.raccordement.postesAlternatifs.length === 0 ? (
              val(null)
            ) : (
              <>
                {s.raccordement.postesAlternatifs.map((p) => (
                  <div key={p.id}>
                    {p.nom} — {p.distanceKm} km
                    {p.capaciteResiduelleMw != null ? `, ${p.capaciteResiduelleMw} MW` : ''}
                    {p.etatSaturation ? ` (${p.etatSaturation})` : ''}
                  </div>
                ))}
              </>
            ),
          ],
          ['Reseau gaz le plus proche', val(s.raccordement.reseauGaz.distanceKm, 'km')],
          ['Gestionnaire gaz', val(s.raccordement.reseauGaz.gestionnaire)],
          ['Capacite d’injection', val(s.raccordement.reseauGaz.capaciteInjectionNm3h, 'Nm³/h')],
          ['Rebours necessaire', val(s.raccordement.reseauGaz.reboursNecessaire)],
        ]}
      />

      <Rubrique
        titre="Gisement, bati et acces"
        referentiel={referentiel}
        enfants={[
          ['Irradiation', val(s.gisement.irradiationKwhM2An, 'kWh/m²/an')],
          ['Productible estime', val(s.gisement.productibleKwhKwcAn, 'kWh/kWc/an')],
          ['Vent a 100 m', val(s.gisement.ventVitesse100mMs, 'm/s')],
          ['Intrants methanisables', val(s.gisement.intrantsMethaTonnesMsAn, 't MS/an')],
          ['Elevages (< 10 km)', val(s.gisement.elevagesRayon10km)],
          ['Industries agroalimentaires (< 20 km)', val(s.gisement.iaaRayon20km)],
          ['Surfaces d’epandage (< 10 km)', val(s.gisement.surfacesEpandageHa, 'ha')],
          ['Habitation la plus proche', val(s.bati.distanceHabitationM, 'm')],
          ['Habitations dans 500 m', val(s.bati.nbHabitationsRayon500m)],
          ['Zone d’habitat la plus proche', val(s.bati.distanceZoneHabitatM, 'm')],
          ['Voirie carrossable', val(s.acces.distanceVoirieM, 'm')],
          ['Acces poids lourds', val(s.acces.accesPoidsLourds)],
        ]}
      />

      <Rubrique
        titre="Foncier"
        cible="foncier"
        referentiel={referentiel}
        enfants={[
          ['Proprietaires estimes', val(s.foncier.nbProprietairesEstime)],
          ['Indivision probable', val(s.foncier.indivisionProbable)],
          ['Surface d’un seul tenant', val(s.foncier.surfaceDunSeulTenantHa, 'ha')],
          ['Indice de morcellement', val(s.foncier.morcellementIndice, '/100')],
          ['Proprietaire public', val(s.foncier.proprietairePublic)],
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Prospection
// ---------------------------------------------------------------------------

function BlocProspection({
  fiche,
  filiere,
  score,
}: {
  fiche: Fiche;
  filiere: Filiere;
  score: ResultatScore;
}): JSX.Element {
  const cache = useQueryClient();
  const [notes, setNotes] = useState(fiche.lead?.notes ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const minuteur = useRef<number | null>(null);

  useEffect(() => {
    setNotes(fiche.lead?.notes ?? '');
  }, [fiche.lead?.id, fiche.lead?.notes]);

  const invalider = (): void => {
    void cache.invalidateQueries({ queryKey: ['fiche', fiche.parcelle.idu, filiere] });
    void cache.invalidateQueries({ queryKey: ['tableau-de-bord'] });
  };

  const changerStatut = useMutation({
    mutationFn: async (statut: StatutProspection) => {
      if (fiche.lead) return api.majLead(fiche.lead.id, { statut });
      return api.creerLead({ idu: fiche.parcelle.idu, filiere, statut, notes });
    },
    onSuccess: () => {
      setMessage('Statut enregistre.');
      invalider();
    },
    onError: (e: ErreurApi) => setMessage(`Echec : ${e.message}`),
  });

  const enregistrerNotes = (texte: string): void => {
    setNotes(texte);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(() => {
      const action = fiche.lead
        ? api.majLead(fiche.lead.id, { notes: texte })
        : api.creerLead({ idu: fiche.parcelle.idu, filiere, notes: texte });
      void action
        .then(() => {
          setMessage('Notes enregistrees.');
          invalider();
        })
        .catch((e: ErreurApi) => setMessage(`Echec : ${e.message}`));
    }, 900);
  };

  return (
    <details className="section" open>
      <summary>
        Prospection
        {fiche.lead && <span className="compteur-section">{fiche.lead.statut}</span>}
      </summary>
      <div className="section-corps">
        <div className="champ">
          <label htmlFor="statut-prospection">Etat de prospection</label>
          <select
            id="statut-prospection"
            value={fiche.lead?.statut ?? ''}
            onChange={(e) => changerStatut.mutate(e.target.value as StatutProspection)}
          >
            <option value="" disabled>
              Non suivie — choisir un statut
            </option>
            {STATUTS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="champ">
          <label htmlFor="notes-prospection">Notes</label>
          <textarea
            id="notes-prospection"
            rows={3}
            value={notes}
            placeholder="Proprietaire, contacts, historique des echanges…"
            onChange={(e) => enregistrerNotes(e.target.value)}
          />
        </div>

        {fiche.lead && fiche.lead.scoreInitial != null && score.scoreGlobal != null && (
          <p style={{ fontSize: 11.5, color: 'var(--texte-faible)', margin: '0 0 8px' }}>
            Score a la prise en prospection : {fiche.lead.scoreInitial} · score actuel :{' '}
            {score.scoreGlobal}
            {Math.abs(fiche.lead.scoreInitial - score.scoreGlobal) > 5 &&
              ' — ecart notable, les donnees sources ont evolue.'}
          </p>
        )}

        {message && <p style={{ fontSize: 11.5, color: 'var(--accent)' }}>{message}</p>}

        {fiche.lead && fiche.lead.historique.length > 0 && (
          <>
            <div className="legende-titre" style={{ marginTop: 9 }}>
              Historique
            </div>
            <ul className="points-liste">
              {fiche.lead.historique.map((e) => (
                <li key={e.id}>
                  <span className="lib" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDateHeure(e.date)}
                  </span>
                  <span className="val" style={{ fontWeight: 400 }}>
                    {e.type === 'changement_statut'
                      ? `${e.ancienStatut ?? '—'} → ${e.nouveauStatut ?? '—'}`
                      : (e.commentaire ?? e.type)}{' '}
                    <span style={{ color: 'var(--texte-faible)' }}>({e.auteur})</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

function BlocExports({ idu, filiere }: { idu: string; filiere: Filiere }): JSX.Element {
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <details className="section fiche-actions" open>
      <summary>Exports</summary>
      <div className="section-corps" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a className="bouton" href={api.urlPdf(idu, filiere)} target="_blank" rel="noreferrer">
          Fiche PDF
        </a>
        <button
          type="button"
          className="bouton"
          onClick={() =>
            void api
              .exporter('geojson', { idus: [idu], filiere }, `${idu}-${filiere}.geojson`)
              .catch((e: ErreurApi) => setErreur(e.message))
          }
        >
          GeoJSON
        </button>
        <button
          type="button"
          className="bouton"
          onClick={() =>
            void api
              .exporter('shapefile', { idus: [idu], filiere }, `${idu}-${filiere}-shapefile.zip`)
              .catch((e: ErreurApi) => setErreur(e.message))
          }
        >
          Shapefile
        </button>
        {erreur && <p style={{ fontSize: 11.5, color: 'var(--rouge)', width: '100%' }}>{erreur}</p>}
      </div>
    </details>
  );
}

export type { Feu };
