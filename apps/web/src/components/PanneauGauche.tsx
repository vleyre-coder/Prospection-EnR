/**
 * Panneau lateral gauche : filtres, ponderations, couches et legende.
 *
 * Les filtres sont construits DYNAMIQUEMENT a partir de la filiere : afficher un curseur de
 * pente pour du stockage ou un seuil d'eloignement de l'habitat pour du solaire au sol
 * encombrerait l'interface sans servir la decision.
 *
 * La legende est toujours visible et explique les DEUX dimensions du rendu, plus l'etat des
 * postes sources.
 */

import { useState } from 'react';
import {
  ORDRE_TYPES_SOL,
  TYPES_SOL as TABLE_TYPES_SOL,
  volOiseauPourLineaireKm,
  type Feu,
  type Filiere,
} from '@enr/core';
import { api, type Referentiel } from '../api/client.js';
import { FEUX, STATUTS, useEtat } from '../store/etat.js';

interface Props {
  referentiel: Referentiel;
}

/** Criteres de filtre pertinents par filiere. */
const FILTRES_PAR_FILIERE: Record<Filiere, Array<'pente' | 'distanceHabitation' | 'capacitePoste' | 'typeSol'>> = {
  solaire_sol: ['pente', 'typeSol', 'capacitePoste'],
  eolien_terrestre: ['distanceHabitation', 'capacitePoste'],
  bess: ['capacitePoste', 'pente', 'typeSol'],
  methanisation: ['distanceHabitation', 'pente'],
};

/**
 * Les pastilles de nature du sol, prises du vocabulaire partage.
 *
 * CETTE LISTE ETAIT UNE TROISIEME COPIE. `@enr/scoring` portait la table longue, l'export PDF la
 * lui empruntait depuis un audit precedent, et ce fichier en gardait une version courte a lui —
 * pendant que la vue Liste, faute d'y avoir acces, affichait la valeur d'enumeration brute.
 * `@enr/core` porte desormais les deux longueurs ; il ne reste plus qu'un endroit a corriger le
 * jour ou un libelle change.
 */
const TYPES_SOL: Array<[string, string]> = ORDRE_TYPES_SOL.map((id) => [id, TABLE_TYPES_SOL[id].court]);

export function PanneauGauche({ referentiel }: Props): JSX.Element {
  const etat = useEtat();
  const { filiere } = etat;
  const meta = referentiel.filieres.find((f) => f.id === filiere);
  const pertinents = FILTRES_PAR_FILIERE[filiere];

  return (
    <aside className="panneau panneau-gauche">
      <div className="panneau-entete">
        <h2>{meta?.libelleCourt ?? 'Filière'}</h2>
        <button
          type="button"
          className="bouton-discret"
          style={{ marginLeft: 'auto' }}
          onClick={etat.basculerPanneauGauche}
          title="Replier le panneau"
        >
          Replier
        </button>
      </div>

      <div className="panneau-contenu">
        {/*
          LA PRESENTATION DE LA FILIERE EST REPLIEE, sauf son critere determinant.
          Mesure sur une capture en 1600x1000 : ce bloc occupait 110 px en permanence pour trois
          paragraphes qu'on lit une fois. Le critere determinant, lui, sert a chaque changement de
          filiere — il reste donc a l'ecran, et le reste est a un clic.
        */}
        {meta && (
          <div className="filiere-resume">
            <p className="filiere-critere">
              <strong>Critère déterminant :</strong> {meta.critereRoi}
            </p>
            <details className="filiere-detail">
              <summary>Ce que couvre cette filière</summary>
              <p>{meta.description}</p>
              <p className="note">
                Surface indicative : {meta.surfaceUtileMinHa} ha minimum,{' '}
                {meta.surfaceUtileOptimaleHa} ha pour une pleine compétitivité (seuils économiques,
                non réglementaires).
              </p>
            </details>
          </div>
        )}

        {/*
          L'ORDRE EST CELUI DE L'USAGE, et il etait inverse.
          La legende venait en premier, ouverte, et poussait filtres, calques et couches sous la
          ligne de flottaison : sur une capture en 1600x1000, le panneau n'affichait RIEN
          d'actionnable sans defiler. Une legende se consulte, des filtres se manipulent.
        */}
        <Filtres referentiel={referentiel} pertinents={pertinents} />
        <Couches referentiel={referentiel} />
        <Calques referentiel={referentiel} />
        <Ponderations referentiel={referentiel} />
        <Legende referentiel={referentiel} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Legende
// ---------------------------------------------------------------------------

function Legende({ referentiel }: { referentiel: Referentiel }): JSX.Element {
  const p = referentiel.palette;
  /**
   * FERMEE PAR DEFAUT, et c'est un changement assume.
   *
   * Elle etait ouverte, en tete de panneau, et mesurait plus de 700 px : a elle seule, elle remplissait
   * la hauteur de l'ecran et repoussait filtres, calques et couches hors de vue. Une legende est de la
   * DOCUMENTATION — on la lit une fois, on y revient rarement — la ou les filtres sont l'outil de
   * travail. Elle reste entiere, complete et a un clic ; rien n'est supprime.
   */
  return (
    <details className="section">
      <summary>Légende</summary>
      <div className="section-corps">
        <div className="legende-bloc">
          <div className="legende-titre">Score de la parcelle</div>
          <p className="legende-note">Couleur de remplissage de la parcelle sur la carte.</p>
          {/* Une parcelle jamais analysee ne porte aucune couleur : c'est le cas le plus
              frequent, et le confondre avec un jugement defavorable serait grave. */}
          <div className="legende-ligne">
            <span
              className="legende-pave"
              style={{ background: 'transparent', borderStyle: 'solid', borderColor: 'var(--bordure-forte)' }}
            />
            <span>
              <strong>Non analysée</strong>
              <span className="desc">
                Aucun score calcule : la parcelle n&apos;est pas colorée, seul son contour
                apparaît. Lancez « Qualifier l&apos;emprise » sur votre secteur.
              </span>
            </span>
          </div>
          {FEUX.map((f) => (
            <div key={f} className="legende-ligne">
              <span
                className="legende-pave"
                style={{ background: p.couleursScoreRemplissage[f], opacity: 0.75 }}
              />
              <span>
                <strong>{p.libellesScore[f]}</strong>
                <span className="desc">{p.descriptionsScore[f]}</span>
              </span>
            </div>
          ))}
          {/* Cinquieme entree, et non un quatrieme statut : le redhibitoire se superpose au
              rouge. « Impossible en l'etat du droit » et « mal classe » partageaient la meme
              couleur, alors qu'ils n'appellent pas la meme decision. */}
          <div className="legende-ligne">
            <span
              className="legende-pave"
              style={{ background: p.couleurRedhibitoireRemplissage, opacity: 0.85 }}
            />
            <span>
              <strong>{p.libelleRedhibitoire}</strong>
              <span className="desc">{p.descriptionRedhibitoire}</span>
            </span>
          </div>
        </div>

        <div className="legende-bloc">
          <div className="legende-titre">Ou en est votre démarchage</div>
          <p className="legende-note">
            Couleur et style du <strong>contour</strong> de la parcelle. Cela n&apos;a rien à voir
            avec le score : une parcelle peut être excellente et jamais contactee, ou médiocre et
            déjà sous promesse. Le statut se change dans la fiche de la parcelle, onglet
            prospection.
          </p>
          {referentiel.statutsProspection.map((s) => (
            <div key={s.id} className="legende-ligne">
              <span
                className="legende-trait"
                style={{
                  borderTopColor: s.couleur,
                  borderTopStyle:
                    s.motif === 'pointille'
                      ? 'dotted'
                      : s.motif === 'tiret' || s.motif === 'hachure'
                        ? 'dashed'
                        : 'solid',
                }}
              />
              <span>{s.libelle}</span>
            </div>
          ))}
        </div>

        <div className="legende-bloc">
          <div className="legende-titre">Postes sources</div>
          {['disponible', 'tendu', 'sature'].map((e) => (
            <div key={e} className="legende-ligne">
              <span
                className="point"
                style={{ background: p.couleursSaturation[e], width: 12, height: 12, marginTop: 3 }}
              />
              <span>{p.libellesSaturation[e]}</span>
            </div>
          ))}
          <div className="legende-ligne">
            <span
              className="legende-pave"
              style={{ background: 'transparent', borderStyle: 'dashed', borderColor: '#0f766e' }}
            />
            <span>
              Poste en projet ou en renforcement
              <span className="desc">
                Un poste sature peut redevenir intéressant à l&apos;horizon du projet.
              </span>
            </span>
          </div>
          <div className="legende-ligne">
            <span
              className="legende-pave"
              style={{
                background: 'transparent',
                borderRadius: '50%',
                borderStyle: 'dashed',
                borderColor: 'var(--texte-faible)',
              }}
            />
            <span>Rayon de raccordement économique indicatif</span>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--texte-faible)', margin: '5px 0 0' }}>
            Carre : RTE. Cercle : Enedis ou autre gestionnaire de distribution.
          </p>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

function Filtres({
  referentiel,
  pertinents,
}: {
  referentiel: Referentiel;
  pertinents: Array<'pente' | 'distanceHabitation' | 'capacitePoste' | 'typeSol'>;
}): JSX.Element {
  const etat = useEtat();
  const f = etat.filtres;
  const maj = etat.definirFiltres;

  return (
    <details className="section" open>
      <summary>
        Filtres
        {Object.keys(f).length > 0 && <span className="compteur-section">{Object.keys(f).length}</span>}
      </summary>
      <div className="section-corps">
        <div className="champ champ-duo">
          <div className="champ">
            <label htmlFor="surf-min">Surface min. (ha)</label>
            <input
              id="surf-min"
              type="number"
              min={0}
              step={0.5}
              value={f.surfaceMinHa ?? ''}
              onChange={(e) => maj({ surfaceMinHa: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div className="champ">
            <label htmlFor="surf-max">Surface max. (ha)</label>
            <input
              id="surf-max"
              type="number"
              min={0}
              step={0.5}
              value={f.surfaceMaxHa ?? ''}
              onChange={(e) => maj({ surfaceMaxHa: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </div>

        <div className="champ">
          <label htmlFor="dist-poste">Linéaire de raccordement max. (km de tracé)</label>
          <p className="legende-note">
            Filtre le tracé estimé, pas le vol d&apos;oiseau : c&apos;est la même grandeur que
            le rayon dessine sur la carte et que la note du critère de raccordement.
          </p>
          <input
            id="dist-poste"
            type="number"
            min={0}
            step={1}
            value={f.distancePosteMaxKm ?? ''}
            onChange={(e) =>
              maj({ distancePosteMaxKm: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>

        {pertinents.includes('capacitePoste') && (
          <div className="champ">
            <label htmlFor="cap-poste">Capacité résiduelle min. du poste (MW)</label>
            <input
              id="cap-poste"
              type="number"
              min={0}
              step={1}
              value={f.capacitePosteMinMw ?? ''}
              onChange={(e) =>
                maj({ capacitePosteMinMw: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
        )}

        {pertinents.includes('pente') && (
          <div className="champ">
            <label htmlFor="pente-max">Pente max. (%)</label>
            <input
              id="pente-max"
              type="number"
              min={0}
              step={0.5}
              value={f.penteMaxPct ?? ''}
              onChange={(e) => maj({ penteMaxPct: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        )}

        <div className="champ">
          <label htmlFor="score-min">Score minimal</label>
          <input
            id="score-min"
            type="number"
            min={0}
            max={100}
            step={5}
            value={f.scoreMin ?? ''}
            onChange={(e) => maj({ scoreMin: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>

        {/* Le filtre par statut de score a ete retire : la couleur de la parcelle le donne
            deja sur la carte, la vue liste est triable par score, et « score minimum »
            ci-dessus couvre le seul besoin reel, celui d'ecarter le bas du classement.
            Un filtre qu'on ne regle jamais est un filtre a supprimer. */}

        <div className="champ">
          <label>État de prospection</label>
          <div className="pastilles">
            {STATUTS.map((s) => {
              const actif = f.statutsProspection?.includes(s) ?? false;
              const m = referentiel.statutsProspection.find((x) => x.id === s);
              return (
                <button
                  key={s}
                  type="button"
                  className="pastille"
                  aria-pressed={actif}
                  onClick={() =>
                    maj({
                      statutsProspection: actif
                        ? (f.statutsProspection ?? []).filter((x) => x !== s)
                        : [...(f.statutsProspection ?? []), s],
                    })
                  }
                >
                  <span className="point" style={{ background: m?.couleur }} />
                  {m?.libelle ?? s}
                </button>
              );
            })}
          </div>
        </div>

        {pertinents.includes('typeSol') && (
          <div className="champ">
            <label>Nature du sol</label>
            <div className="pastilles">
              {TYPES_SOL.map(([id, libelle]) => {
                const actif = f.typesSol?.includes(id) ?? false;
                return (
                  <button
                    key={id}
                    type="button"
                    className="pastille"
                    aria-pressed={actif}
                    onClick={() =>
                      maj({
                        typesSol: actif
                          ? (f.typesSol ?? []).filter((x) => x !== id)
                          : [...(f.typesSol ?? []), id],
                      })
                    }
                  >
                    {libelle}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="champ">
          <label>Exclusions</label>
          {(
            [
              ['exclureKnockOuts', 'Exclure les parcelles rédhibitoires'],
              ['exclureNatura2000', 'Exclure les recouvrements Natura 2000'],
              ['exclureZoneHumide', 'Exclure les zones humides cartographiées'],
              ['exclureAop', 'Exclure les aires AOP'],
            ] as const
          ).map(([cle, libelle]) => (
            <label key={cle} className="case">
              <input
                type="checkbox"
                checked={Boolean(f[cle])}
                onChange={(e) => maj({ [cle]: e.target.checked || undefined })}
              />
              {libelle}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className="bouton bouton-principal"
            onClick={() => useEtat.getState().definirVue('liste')}
          >
            Voir les resultats
          </button>
          <button type="button" className="bouton" onClick={etat.reinitialiserFiltres}>
            Réinitialiser
          </button>
        </div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Ponderations
// ---------------------------------------------------------------------------

function Ponderations({ referentiel }: { referentiel: Referentiel }): JSX.Element {
  const etat = useEtat();
  const { filiere } = etat;
  const defaut = referentiel.ponderationsDefaut[filiere];
  const surcharges = etat.ponderations[filiere] ?? {};
  const [nomProfil, setNomProfil] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const parFamille = new Map<string, Array<[string, number]>>();
  for (const [id, poids] of Object.entries(defaut.poids)) {
    const famille = referentiel.criteres[id]?.famille ?? 'autre';
    parFamille.set(famille, [...(parFamille.get(famille) ?? []), [id, surcharges[id] ?? poids]]);
  }

  const modifie = Object.keys(surcharges).length > 0;

  return (
    <details className="section">
      <summary>
        Pondérations
        {modifie && <span className="compteur-section">{Object.keys(surcharges).length} modifiée(s)</span>}
      </summary>
      <div className="section-corps">
        <p style={{ fontSize: 11.5, color: 'var(--texte-faible)', margin: '0 0 8px' }}>
          Les poids sont normalisés à 100 % sur les critères réellement evaluables. Déplacer un
          curseur recolore immédiatement la carte.
        </p>

        {[...parFamille.entries()].map(([famille, criteres]) => (
          <div key={famille}>
            <div className="groupe-famille">{referentiel.famillesLibelles[famille] ?? famille}</div>
            {criteres.map(([id, poids]) => (
              <div key={id} className="curseur">
                <label htmlFor={`p-${id}`} title={referentiel.criteres[id]?.explication}>
                  {referentiel.criteres[id]?.libelle ?? id}
                </label>
                <span className="valeur">{poids}</span>
                <input
                  id={`p-${id}`}
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={poids}
                  onChange={(e) => etat.definirPoids(id, Number(e.target.value))}
                />
              </div>
            ))}
          </div>
        ))}

        <div className="champ champ-duo" style={{ marginTop: 11 }}>
          <div className="champ">
            <label htmlFor="seuil-vert">Seuil « propice »</label>
            <input
              id="seuil-vert"
              type="number"
              min={0}
              max={100}
              value={etat.seuils[filiere]?.seuilVert ?? defaut.seuilVert}
              onChange={(e) =>
                etat.definirSeuils(
                  Number(e.target.value),
                  etat.seuils[filiere]?.seuilOrange ?? defaut.seuilOrange,
                )
              }
            />
          </div>
          <div className="champ">
            <label htmlFor="seuil-orange">Seuil « écarté »</label>
            <input
              id="seuil-orange"
              type="number"
              min={0}
              max={100}
              value={etat.seuils[filiere]?.seuilOrange ?? defaut.seuilOrange}
              onChange={(e) =>
                etat.definirSeuils(
                  etat.seuils[filiere]?.seuilVert ?? defaut.seuilVert,
                  Number(e.target.value),
                )
              }
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div className="champ" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="nom-profil">Enregistrer sous</label>
            <input
              id="nom-profil"
              value={nomProfil}
              placeholder="Nom du profil"
              onChange={(e) => setNomProfil(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="bouton"
            disabled={!nomProfil.trim()}
            onClick={() =>
              void api
                .enregistrerPonderation({
                  nom: nomProfil.trim(),
                  filiere,
                  poids: { ...defaut.poids, ...surcharges },
                  seuilVert: etat.seuils[filiere]?.seuilVert ?? defaut.seuilVert,
                  seuilOrange: etat.seuils[filiere]?.seuilOrange ?? defaut.seuilOrange,
                })
                .then(() => {
                  setMessage(`Profil « ${nomProfil} » enregistre.`);
                  setNomProfil('');
                })
                .catch((e: Error) => setMessage(`Échec : ${e.message}`))
            }
          >
            Enregistrer
          </button>
        </div>

        <button
          type="button"
          className="bouton"
          style={{ marginTop: 7 }}
          disabled={!modifie}
          onClick={etat.reinitialiserPoids}
        >
          Revenir aux poids par défaut
        </button>
        {message && <p style={{ fontSize: 11.5, color: 'var(--accent)' }}>{message}</p>}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Couches
// ---------------------------------------------------------------------------

function Couches({ referentiel }: { referentiel: Referentiel }): JSX.Element {
  const etat = useEtat();
  const filiereMeta = referentiel.filieres.find((f) => f.id === etat.filiere);
  const rayonFiliere = filiereMeta?.rayonRaccordementKm ?? 5;
  const couchesIndisponibles = referentiel.couches.filter(
    (c) => c.groupe !== 'reseaux' && (c.nbObjets ?? 1) === 0,
  ).length;
  const groupes = new Map<string, typeof referentiel.couches>();
  for (const c of referentiel.couches) {
    groupes.set(c.groupe, [...(groupes.get(c.groupe) ?? []), c]);
  }

  const libellesGroupes: Record<string, string> = {
    reseaux: 'Réseaux',
    environnement: 'Environnement',
    patrimoine: 'Patrimoine',
    risques: 'Risques',
    urbanisme: 'Urbanisme',
    agriculture: 'Agriculture',
  };

  return (
    <details className="section" open>
      <summary>
        Couches
        <span className="compteur-section">{etat.couchesActives.length} active(s)</span>
      </summary>
      <div className="section-corps">
        <div className="legende-titre">Réseaux</div>
        <label className="case">
          <input type="checkbox" checked={etat.afficherPostes} onChange={etat.basculerPostes} />
          Postes sources et capacités
        </label>
        <label className="case">
          <input
            type="checkbox"
            checked={etat.afficherReseauGaz}
            onChange={etat.basculerReseauGaz}
          />
          Réseau gaz et points d&apos;injection
        </label>

        <div className="champ" style={{ marginTop: 7 }}>
          <label htmlFor="rayon">
            Rayon de raccordement affiché :{' '}
            {etat.rayonRaccordementKm > 0
              ? `${etat.rayonRaccordementKm} km de tracé estimé`
              : 'masque'}
          </label>
          {/* Le cercle est geodesique, le budget est un lineaire : la conversion doit etre
              lisible, sinon l'utilisateur mesure le cercle sur la carte et croit a une
              erreur d'echelle. Le score note la meme grandeur que celle affichee ici. */}
          {etat.rayonRaccordementKm > 0 && (
            <p className="legende-note">
              Soit un cercle de{' '}
              {volOiseauPourLineaireKm(etat.rayonRaccordementKm).toLocaleString('fr-FR', {
                maximumFractionDigits: 1,
              })}{' '}
              km à vol d&apos;oiseau. C&apos;est le linéaire pose qui se paie, et c&apos;est lui
              que note le critère de raccordement.
            </p>
          )}
          <p className="legende-note">
            {etat.rayonPersonnalise ? (
              <>
                Valeur que vous avez choisie.{' '}
                <button type="button" className="bouton-discret" onClick={etat.reinitialiserRayon}>
                  Revenir à la valeur de la filière ({rayonFiliere} km)
                </button>
              </>
            ) : (
              <>
                Valeur indicative pour la filière {filiereMeta?.libelleCourt ?? ''} : le coût de
                raccordement se rapporte à la puissance évacuée, il change donc avec la filière.
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[0, 2, 5, 10, 20].map((km) => (
              <button
                key={km}
                type="button"
                className="pastille"
                aria-pressed={etat.rayonRaccordementKm === km}
                onClick={() => etat.definirRayon(km)}
              >
                {km === 0 ? 'aucun' : `${km} km`}
              </button>
            ))}
          </div>
          <input
            id="rayon"
            type="range"
            min={0}
            max={30}
            step={1}
            value={etat.rayonRaccordementKm}
            onChange={(e) => etat.definirRayon(Number(e.target.value))}
            style={{ marginTop: 5 }}
          />
        </div>

        {[...groupes.entries()]
          .filter(([g]) => g !== 'reseaux')
          .map(([groupe, couches]) => (
            <div key={groupe}>
              <div className="groupe-famille">{libellesGroupes[groupe] ?? groupe}</div>
              {couches.map((c) => {
                // Une couche sans objet en base ne peut rien afficher. Le dire, plutot que
                // de laisser cocher une case sans effet et conclure a une panne.
                const disponible = (c.nbObjets ?? 1) > 0;
                return (
                  <label
                    key={c.id}
                    className={disponible ? 'case' : 'case case-indisponible'}
                    title={
                      disponible
                        ? `${c.nbObjets?.toLocaleString('fr-FR') ?? ''} objet(s) en base`
                        : "Couche non ingérée : rien à afficher sur la carte. Le critère correspondant est néanmoins evalue parcelle par parcelle, en interrogeant la source au moment de la qualification."
                    }
                  >
                    <input
                      type="checkbox"
                      checked={disponible && etat.couchesActives.includes(c.id)}
                      disabled={!disponible}
                      onChange={() => etat.basculerCouche(c.id)}
                    />
                    <span
                      className="point"
                      style={{ background: c.couleur, marginTop: 4, marginRight: 2 }}
                    />
                    {c.libelle}
                    {!disponible && <span className="etiquette-indisponible">non ingérée</span>}
                  </label>
                );
              })}
            </div>
          ))}

        {couchesIndisponibles > 0 && (
          <p className="legende-note" style={{ marginTop: 8 }}>
            <strong>{couchesIndisponibles} couche(s) grisee(s) :</strong> l&apos;ingestion
            correspondante n&apos;a pas encore été lancée sur cette installation. Voir la section
            « Calques cartographiques » ci-dessous, qui interroge les services officiels en direct
            et ne dépend pas de l&apos;ingestion.
          </p>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Calques cartographiques
// ---------------------------------------------------------------------------

const LIBELLES_GROUPES_CALQUES: Record<string, string> = {
  foret: 'Forets et boisements',
  environnement: 'Milieux naturels protégés',
  patrimoine: 'Patrimoine',
  risques: 'Risques',
  urbanisme: 'Urbanisme',
  agriculture: 'Agriculture',
};

const LIBELLES_VALEUR: Record<string, string> = {
  opposable: 'opposable',
  indicative: 'indicative',
  pre_reperage: 'pre-reperage',
};

/**
 * Liste des calques, avec pour chacun son etat, sa source et son millesime.
 *
 * Trois etats seulement, et l'etat ne parle jamais de la mecanique interne : ce qui compte
 * pour l'utilisateur, c'est de savoir si le calque va s'afficher. Un calque « a zoomer »
 * n'est pas indisponible : son service ne produit simplement rien en vue nationale.
 */
function Calques({ referentiel }: { referentiel: Referentiel }): JSX.Element | null {
  const etat = useEtat();
  const calques = referentiel.calques ?? [];
  if (calques.length === 0) return null;

  const groupes = new Map<string, typeof calques>();
  for (const c of calques) groupes.set(c.groupe, [...(groupes.get(c.groupe) ?? []), c]);

  return (
    <details className="section" open>
      <summary>
        Calques cartographiques
        <span className="compteur-section">{etat.calquesActifs.length} actif(s)</span>
      </summary>
      <div className="section-corps">
        <p className="legende-note">
          Contraintes de référence affichees en superposition. Chaque calque indique sa source et
          son millésime : une contrainte sans provenance datee n&apos;est pas opposable dans un
          dossier.
        </p>

        {[...groupes.entries()].map(([groupe, liste]) => (
          <div key={groupe}>
            <div className="groupe-famille">{LIBELLES_GROUPES_CALQUES[groupe] ?? groupe}</div>
            {liste.map((c) => {
              const actif = etat.calquesActifs.includes(c.id);
              const chargement = etat.calquesEnChargement.includes(c.id);
              const indisponible = c.etat === 'indisponible';
              return (
                <div key={c.id} className="calque">
                  <label className={indisponible ? 'case case-indisponible' : 'case'}>
                    <input
                      type="checkbox"
                      checked={actif && !indisponible}
                      disabled={indisponible}
                      onChange={() => etat.basculerCalque(c.id)}
                    />
                    <span
                      className="point"
                      style={{ background: c.couleur, marginTop: 4, marginRight: 2 }}
                    />
                    <span className="calque-libelle">{c.libelle}</span>
                    {chargement && <span className="tourniquet" style={{ marginLeft: 4 }} />}
                    {!chargement && indisponible && (
                      <span className="etiquette-indisponible">indisponible</span>
                    )}
                    {!chargement && !indisponible && c.zoomMin != null && (
                      <span className="etiquette-zoom" title={`Visible à partir du zoom ${c.zoomMin}`}>
                        zoom {c.zoomMin}+
                      </span>
                    )}
                  </label>
                  {actif && !indisponible && (
                    <p className="calque-detail">
                      {c.legende}
                      <br />
                      <span className="calque-source">
                        {c.source.nom}
                        {c.source.millesime ? ` — ${c.source.millesime}` : ''} — valeur{' '}
                        {LIBELLES_VALEUR[c.source.valeurJuridique] ?? c.source.valeurJuridique}
                      </span>
                      {c.avertissement && (
                        <>
                          <br />
                          <span className="calque-avertissement">{c.avertissement}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </details>
  );
}

export type { Feu };
