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
import { libelleTypeSol } from '@enr/core';
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
import {
  api,
  ErreurApi,
  type FicheParcelle as Fiche,
  type Referentiel,
  type VerificationAvantContact,
} from '../api/client.js';
import { ponderationCourante, STATUTS, useEtat } from '../store/etat.js';
import { formatDate, formatDateHeure, formatNombre } from '../utils/geometrie.js';
import { libelleCultureRpg, valeurAffichable } from '../utils/affichage.js';

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
            altimétrie, raccordement)…
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
              " Les critères concernés resteront non évalués : l'absence de donnée ne vaut pas absence de contrainte."}
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
            Rafraîchir
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
            département {fiche.parcelle.codeDepartement}
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

        <AvantContact points={fiche.avantContact ?? []} referentiel={referentiel} />

        <BlocProspection fiche={fiche} filiere={filiere} score={score} />

        <BlocExports idu={idu} filiere={filiere} />

        <div className="note-bas">
          <strong>Traçabilité.</strong> {Object.keys(fiche.snapshot.sources).length} source(s)
          interrogée(s) le {formatDateHeure(fiche.snapshot.dateSnapshot)}.{' '}
          {fiche.connecteursEnEchec.length > 0 && (
            <>
              {fiche.connecteursEnEchec.length} connecteur(s) en échec (
              {fiche.connecteursEnEchec.join(', ')}) : les critères correspondants sont grises.{' '}
            </>
          )}
          Moteur de scoring version {score.versionMoteur}. Référentiel réglementaire vérifié le{' '}
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
  // Un knock-out BLOQUANT ecarte la parcelle en droit ; un knock-out derogeable ne fait que
  // plafonner. Seul le premier justifie la couleur et le libelle redhibitoires.
  const redhibitoire = score.knockOuts.some((k) => !k.derogeable);
  const couleur = redhibitoire
    ? referentiel.palette.couleurRedhibitoire
    : referentiel.palette.couleursScore[score.statut];
  const reserveRegime = referentiel.reserveRegime;
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
            <span className="valeur">ÉCARTÉE</span>
          ) : (
            <>
              <span className="valeur">{Math.round(score.scoreGlobal)}</span>
              <span className="sur">/ 100</span>
            </>
          )}
        </div>
        <div className="synthese-texte">
          {/* Un rouge redhibitoire et un rouge de score faible portaient le meme libelle.
              Le premier est definitif en l'etat du droit, le second est une question de
              priorite : la fiche doit les nommer differemment, comme la carte les colore
              differemment. */}
          <div className="synthese-statut">
            {redhibitoire
              ? referentiel.palette.libelleRedhibitoire
              : referentiel.palette.libellesScore[score.statut]}
          </div>
          <div className="synthese-regime" title={score.regimeImplantation ? reserveRegime : undefined}>
            {score.regimeImplantation
              ? (referentiel.libellesRegime[score.regimeImplantation] ?? score.regimeImplantation)
              : redhibitoire
                ? referentiel.palette.descriptionRedhibitoire
                : referentiel.palette.descriptionsScore[score.statut]}
          </div>
          {score.regimeImplantation && <div className="synthese-reserve">{reserveRegime}</div>}
          <div className="synthese-regime">
            {formatNombre(surfaceHa, 'ha', 2)}
            {personnalise && ' · pondération personnalisée'}
          </div>
          <div className="jauge" aria-hidden>
            <div style={{ width: `${Math.round(score.couvertureDonnees * 100)}%` }} />
          </div>
          <div className="jauge-legende">
            Couverture de données : {Math.round(score.couvertureDonnees * 100)} %
            {score.couvertureDonnees < 0.8 &&
              ` — ${score.criteres.filter((c) => c.note == null).length} critère(s) non evalue(s)`}
          </div>
        </div>
      </div>

      {score.knockOuts.map((k) => (
        <CarteKnockOut key={k.id} ko={k} referentiel={referentiel} />
      ))}

      {score.limitesViabilite.map((l) => (
        <div key={l.id} className="carte-ko derogeable">
          <div className="entete">
            <span className="marqueur">Viabilité</span>
            {l.libelle}
          </div>
          <p className="motif">{l.motif}</p>
        </div>
      ))}

      <details className="section" open>
        <summary>Synthèse</summary>
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
            Seuils de procédure applicables
            <span className="compteur-section">{score.seuilsProcedure.length}</span>
          </summary>
          <div className="section-corps">
            {score.seuilsProcedure.map((s) => (
              <LigneSeuil key={s.regleId} seuil={s} />
            ))}
            <p style={{ fontSize: 10.5, color: 'var(--texte-faible)', marginTop: 9 }}>
              Les seuils réglementaires évoluent : la date d&apos;entrée en vigueur de chaque
              règle appliquée est indiquee. Vérifiez la version en vigueur à la date de votre
              dépôt.
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
        <span className="marqueur">{ko.derogeable ? 'Dérogeable' : 'Rédhibitoire'}</span>
        {ko.libelle}
      </div>
      <p className="motif">{ko.motif}</p>
      {regle && (
        <div className="regle">
          {regle.reference} &middot; en vigueur depuis le {formatDate(regle.dateEntreeEnVigueur)}
          {regle.instable && ' · seuil susceptible d’avoir evolue'}
          {/* Une reference redigee sans relecture juridique le dit : voir REGLES_COMMUNES. */}
          {regle.aValiderParJuriste && ' · référence à faire valider par un juriste'}
        </div>
      )}
      {ko.source && (
        <div className="regle">
          Source : {ko.source.nom}
          {ko.source.millesime ? ` (millésime ${ko.source.millesime})` : ''}
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
          ? 'Applicable au vu des caractéristiques estimées'
          : seuil.applicable === false
            ? 'Non applicable'
            : 'Applicabilité indéterminée'
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AVANT D'APPELER — CE QUE L'OPERATEUR IGNORE ENCORE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * SA PLACE EST ICI, juste avant le bloc de prospection, et pas ailleurs : le bloc suivant est celui
 * ou l'on cree un contact et ou l'on decroche. Un point de vigilance lu APRES l'appel ne sert a
 * rien, et lu en tete de fiche il serait noye sous le score.
 *
 * CE QUE CE BLOC N'EST PAS : un avertissement de plus. Les avertissements du §12 disent ce que
 * l'OUTIL ne garantit pas. Celui-ci dit ce que la PARCELLE reserve — un fermier en place, une
 * indivision, un acces qui traverse chez le voisin — et il porte, pour chaque point, la question a
 * poser telle quelle. C'est une liste de travail, pas une mise en garde.
 */
function AvantContact({
  points,
  referentiel,
}: {
  points: VerificationAvantContact[];
  referentiel: Referentiel;
}): JSX.Element | null {
  if (points.length === 0) return null;
  const LIBELLE_GRAVITE: Record<VerificationAvantContact['gravite'], string> = {
    arret: 'peut arrêter',
    delai: 'décale le calendrier',
    contexte: 'change l’interlocuteur',
  };
  return (
    <details className="section" open>
      <summary>
        Avant d’appeler le propriétaire
        <span className="compteur-section">{points.length}</span>
      </summary>
      <div className="section-corps">
        <p className="aide-section">
          Ce que les données montrent, ce qu’elles ne peuvent pas montrer, et la question à poser.
          Aucun de ces points n’entre dans le score.
        </p>
        {points.map((p) => {
          // Meme resolution que pour les criteres : le referentiel expose la reglementation par
          // groupes, pas indexee par identifiant.
          const regle = p.regleLiee
            ? Object.values(referentiel.reglementation)
                .flatMap((g) => Object.values(g))
                .find((r) => r.id === p.regleLiee)
            : undefined;
          return (
            <div key={p.id} className={`avant-contact gravite-${p.gravite}`}>
              <div className="entete">
                <span className="marqueur">{LIBELLE_GRAVITE[p.gravite]}</span>
                {p.titre}
              </div>
              <p className="motif">{p.texte}</p>
              <p className="question">
                <strong>À demander :</strong> {p.question}
              </p>
              {regle && (
                <p className="reference">
                  {regle.reference}
                  {regle.aValiderParJuriste && (
                    <> · référence à faire valider par un juriste</>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

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
        Détail des critères
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
            {/*
              `formatNombre` et non `toFixed` : ce dernier ecrit un point decimal, et cette ligne
              s'affiche a cote de « 19,05 ha » sur la meme fiche. C'est le defaut B1 de l'audit 10 —
              deux conventions typographiques dans une meme phrase francaise — a l'endroit ou son
              garde ne regardait pas : celui-ci inspecte les chaines produites par le MOTEUR, et le
              poids est mis en forme par l'interface elle-meme. Mesure sur les cinq fiches reelles
              capturees : 29 occurrences par fiche, une par critere.
            */}
            poids {formatNombre(critere.poids * 100, '%', 1)}
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
              <span className="nom">Source non renseignée</span>
              <div style={{ color: 'var(--texte-faible)' }}>
                Ce critère n&apos;a pas pu être rattache à une source : la donnée est indisponible.
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
              {r.instable && ' · règle instable ou déclinée localement'}
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
            <dt>Millésime</dt>
            <dd>{source.millesime}</dd>
          </>
        )}
        {source.dateMiseAJour && (
          <>
            <dt>Mise à jour</dt>
            <dd>{formatDate(source.dateMiseAJour)}</dd>
          </>
        )}
        <dt>Interrogée le</dt>
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

/**
 * Habillage de `valeurAffichable`. La DECISION vit dans `utils/affichage.ts`, ou elle est testee sans
 * DOM ; ce composant ne fait que la placer. La separation vient de l'audit 8 : ces six lignes
 * decidaient de ce que le prospecteur lit sur chaque champ de la fiche, et aucun test ne pouvait les
 * atteindre parce que ce fichier importe le client d'API, qui lit `import.meta.env`.
 */
function val(v: unknown, unite = ''): JSX.Element {
  const r = valeurAffichable(v, unite, formatNombre);
  if (r.absente) return <span className="absent">donnée indisponible</span>;
  return <>{r.texte}</>;
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
  if (z.recouvre === null && z.distanceM === null) return <span className="absent">donnée indisponible</span>;
  if (z.recouvre) return <>Recouvrement{z.nom ? ` — ${z.nom}` : ''}</>;
  if (z.distanceM == null) return <>hors zonage</>;
  return (
    <>
      {/*
        Meme correction qu'au poids des criteres : `toFixed` ecrivait « 7.8 km » dans une fiche qui
        ecrit « 19,05 ha » deux lignes plus haut. La precision est conservee a une decimale — le
        defaut est le separateur, pas le nombre de chiffres, et changer ce dernier depasserait la
        correction.
      */}
      {z.distanceM < 1000
        ? `${Math.round(z.distanceM)} m`
        : formatNombre(z.distanceM / 1000, 'km', 1)}
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
        titre="Identité"
        cible="identite"
        referentiel={referentiel}
        enfants={[
          ['Commune', val(`${s.identite.nomCommune} (${s.identite.codeInsee})`)],
          ['Préfixe / section / n°', val(`${s.identite.prefixe} ${s.identite.section} ${s.identite.numero}`)],
          ['Contenance cadastrale', val(s.identite.contenanceM2, 'm²')],
          ['Surface calculée', val(s.identite.surfaceCalculeeM2, 'm²')],
          ['Département', val(s.identite.codeDepartement)],
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
                          règlement
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
                    {p.estEbc && ' — espace boisé classe'}
                    {p.estEmplacementReserve && ' — emplacement réserve'}
                  </div>
                ))}
              </>
            ),
          ],
          ['Servitudes', s.urbanisme.servitudes.length ? <>{s.urbanisme.servitudes.join(', ')}</> : <>aucune</>],
          [
            'Zone d’accélération ENR',
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
            // Trois etats distincts, et non deux (audit 8, D5) : `null` = la couche n'a pas ete
            // ingeree pour ce departement, `false` = le departement n'a pas arrete de document-cadre,
            // ce qui est le cas de la majorite d'entre eux. Les confondre affichait « departement
            // non ingere » sur un fait vrai.
            s.urbanisme.documentCadrePvSol.departementCouvert == null ? (
              <span className="absent">département non ingere</span>
            ) : s.urbanisme.documentCadrePvSol.departementCouvert === false ? (
              <>aucun document-cadre départemental</>
            ) : (
              <>
                {s.urbanisme.documentCadrePvSol.parcelleEligible == null
                  ? 'éligibilité à apprécier'
                  : s.urbanisme.documentCadrePvSol.parcelleEligible
                    ? 'parcelle éligible'
                    : 'parcelle non éligible'}
                {s.urbanisme.documentCadrePvSol.dateArrete
                  ? ` — arrêté du ${formatDate(s.urbanisme.documentCadrePvSol.dateArrete)}`
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
          // La fiche affichait `agricole_exploite`, souligne compris, la ou le PDF ecrit
          // « Terrain agricole exploité ». Meme table, meme mot, desormais.
          ['Type de sol retenu', val(libelleTypeSol(s.occupationSol.typeSol, 'long'))],
          [
            'Culture (RPG)',
            /* « donnee indisponible » et « aucune declaration » ne sont pas la meme chose :
               la premiere dit que le RPG n'a pas repondu, la seconde qu'il a repondu et
               qu'aucun ilot ne recouvre la parcelle. C'est ce dernier cas qui rend une
               parcelle interessante en solaire, il ne doit pas se lire comme une lacune.
               Decision extraite dans utils/affichage, ou elle est testee. */
            ((): JSX.Element => {
              const r = libelleCultureRpg(s.occupationSol.rpg);
              return r.absent ? <span className="absent">{r.texte}</span> : <>{r.texte}</>;
            })(),
          ],
          ['Code culture', val(s.occupationSol.rpg.codeCulture)],
          ['Millésime RPG', val(s.occupationSol.rpg.millesime)],
          ['Millésimes declares', val(s.occupationSol.rpg.anneesDeclareesConsecutives)],
          ['Inculte depuis le 10/03/2013', s.occupationSol.inculteDepuis2013 == null ? <span className="absent">à démontrer (historique RPG et photo-interprétation)</span> : val(s.occupationSol.inculteDepuis2013)],
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
        titre="Topographie et géotechnique"
        referentiel={referentiel}
        enfants={[
          ['Pente moyenne', val(s.topographie.pentePct, '%')],
          ['Pente maximale', val(s.topographie.penteMaxPct, '%')],
          ['Orientation', val(s.topographie.orientationDeg, '°')],
          ['Altitude', val(s.topographie.altitudeM, 'm')],
          ['Dénivelé', val(s.topographie.deniveleM, 'm')],
          ['Aléa retrait-gonflement des argiles', val(s.topographie.aleaArgiles)],
          ['Cavités souterraines (< 1 km)', val(s.topographie.cavitesProches)],
          ['Mouvements de terrain (< 1 km)', val(s.topographie.mouvementsTerrain)],
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
                {{ oui: 'cartographiee', non: 'hors zonage cartographie', a_confirmer: 'à confirmer' }[
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
          ['Aléa inondation', val(s.eau.inondation.alea)],
          ['Zonage PPRI', val(s.eau.inondation.zonagePpri)],
          ['Territoire à risque important (TRI)', val(s.eau.inondation.dansTri)],
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
          ['Arrêté de protection de biotope', zonageTexte(s.milieux.appb)],
          ['Réserve naturelle', zonageTexte(s.milieux.reserveNaturelle)],
          ['Cœur de parc national', zonageTexte(s.milieux.coeurParcNational)],
          ['Parc naturel régional', zonageTexte(s.milieux.parcNaturelRegional)],
          [
            'Trame verte et bleue',
            s.milieux.trameVerteBleue.reservoir == null && s.milieux.trameVerteBleue.corridor == null
              ? val(null)
              : val(
                  s.milieux.trameVerteBleue.reservoir
                    ? 'réservoir de biodiversité'
                    : s.milieux.trameVerteBleue.corridor
                      ? 'corridor'
                      : 'hors trame',
                ),
          ],
          ['Enjeu défrichement', val(s.milieux.enjeuDefrichement)],
          ['Pre-enjeu espèces protégées', val(s.milieux.preEnjeuEspeces, '/100')],
          // Aucune source nationale ne publie ces deux sensibilites a la parcelle. Le
          // champ existe pour accueillir un atlas DREAL ou LPO le jour ou il sera ingere ;
          // tant qu'il est vide, on le dit, plutot que d'afficher une case blanche qui se
          // lit « rien a signaler ».
          [
            'Sensibilité avifaune',
            s.milieux.sensibiliteAvifaune == null
              ? val('aucune source ingérée - à vérifier auprès de la DREAL / LPO')
              : val(s.milieux.sensibiliteAvifaune, '/100'),
          ],
          [
            'Sensibilité chiroptères',
            s.milieux.sensibiliteChiropteres == null
              ? val('aucune source ingérée - à vérifier auprès de la DREAL / LPO')
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
          ['Dans un périmètre de protection', val(s.patrimoine.monumentHistorique.dansPerimetreProtection)],
          ['Site classe', zonageTexte(s.patrimoine.siteClasse)],
          ['Site inscrit', zonageTexte(s.patrimoine.siteInscrit)],
          ['Site patrimonial remarquable', zonageTexte(s.patrimoine.spr)],
          ['Avis de l’ABF requis', val(s.patrimoine.avisAbfRequis)],
          // Cet indice etait auparavant fabrique a partir du nombre de monuments
          // alentour, ce qui ne mesure aucune covisibilite reelle. Il ne sera renseigne
          // que par une etude paysagere.
          [
            'Indice de covisibilité',
            s.patrimoine.covisibiliteIndice == null
              ? val('non evalue - relevé d’une étude paysagere')
              : val(s.patrimoine.covisibiliteIndice, '/100'),
          ],
          ['Sensibilité archéologique', val(s.patrimoine.sensibiliteArcheologique)],
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
          ['Servitudes aéronautiques', val(s.risques.servitudesAeronautiques)],
          ['Faisceaux hertziens', val(s.risques.faisceauxHertziens)],
          ['Réseaux enterres', s.risques.reseauxEnterres.length ? <>{s.risques.reseauxEnterres.join(', ')}</> : val(null)],
          ['Sites et sols pollues (< 500 m)', val(s.risques.sitesPollues)],
          ['ICPE à proximité', val(s.risques.icpeProches)],
          ['Obligation de débroussaillement', val(s.risques.obligationDebroussaillement)],
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
          ['Capacité résiduelle', val(poste?.capaciteResiduelleMw, 'MW')],
          ['État de saturation', val(poste?.etatSaturation)],
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
          // Deux lignes et non une : la canalisation gouverne le raccordement, le site d'injection
          // existant n'est qu'un indicateur de maturite de la filiere (audit 8, E5).
          [
            'Canalisation de gaz la plus proche',
            s.raccordement.reseauGaz.distanceCanalisationKm != null ? (
              val(s.raccordement.reseauGaz.distanceCanalisationKm, 'km')
            ) : (
              <span className="absent">tracé non ingere</span>
            ),
          ],
          [
            'Site d’injection existant',
            val(s.raccordement.reseauGaz.distanceSiteInjectionKm, 'km'),
          ],
          ['Gestionnaire gaz', val(s.raccordement.reseauGaz.gestionnaire)],
          ['Capacité d’injection', val(s.raccordement.reseauGaz.capaciteInjectionNm3h, 'Nm³/h')],
          ['Rebours nécessaire', val(s.raccordement.reseauGaz.reboursNecessaire)],
        ]}
      />

      <Rubrique
        titre="Gisement, bati et accès"
        referentiel={referentiel}
        enfants={[
          ['Irradiation', val(s.gisement.irradiationKwhM2An, 'kWh/m²/an')],
          ['Productible estimé', val(s.gisement.productibleKwhKwcAn, 'kWh/kWc/an')],
          ['Vent à 100 m', val(s.gisement.ventVitesse100mMs, 'm/s')],
          ['Intrants méthanisables', val(s.gisement.intrantsMethaTonnesMsAn, 't MS/an')],
          ['Élevages (< 10 km)', val(s.gisement.elevagesRayon10km)],
          ['Industries agroalimentaires (< 20 km)', val(s.gisement.iaaRayon20km)],
          ['Surfaces d’épandage (< 10 km)', val(s.gisement.surfacesEpandageHa, 'ha')],
          ['Habitation la plus proche', val(s.bati.distanceHabitationM, 'm')],
          ['Habitations dans 500 m', val(s.bati.nbHabitationsRayon500m)],
          ['Zone d’habitat la plus proche', val(s.bati.distanceZoneHabitatM, 'm')],
          ['Voirie carrossable', val(s.acces.distanceVoirieM, 'm')],
          ['Accès poids lourds', val(s.acces.accesPoidsLourds)],
        ]}
      />

      <Rubrique
        titre="Foncier"
        cible="foncier"
        referentiel={referentiel}
        enfants={[
          ['Propriétaires estimes', val(s.foncier.nbProprietairesEstime)],
          ['Indivision probable', val(s.foncier.indivisionProbable)],
          ['Surface d’un seul tenant', val(s.foncier.surfaceDunSeulTenantHa, 'ha')],
          ['Indice de morcellement', val(s.foncier.morcellementIndice, '/100')],
          ['Propriétaire public', val(s.foncier.proprietairePublic)],
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
      setMessage('Statut enregistré.');
      invalider();
    },
    onError: (e: ErreurApi) => setMessage(`Échec : ${e.message}`),
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
          setMessage('Notes enregistrées.');
          invalider();
        })
        .catch((e: ErreurApi) => setMessage(`Échec : ${e.message}`));
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
          <label htmlFor="statut-prospection">État de prospection</label>
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
            placeholder="Propriétaire, contacts, historique des échanges…"
            onChange={(e) => enregistrerNotes(e.target.value)}
          />
        </div>

        {fiche.lead && fiche.lead.scoreInitial != null && score.scoreGlobal != null && (
          <p style={{ fontSize: 11.5, color: 'var(--texte-faible)', margin: '0 0 8px' }}>
            Score à la prise en prospection : {fiche.lead.scoreInitial} · score actuel :{' '}
            {score.scoreGlobal}
            {Math.abs(fiche.lead.scoreInitial - score.scoreGlobal) > 5 &&
              ' — écart notable, les données sources ont evolue.'}
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
