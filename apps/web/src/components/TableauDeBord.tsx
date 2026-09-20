/**
 * Tableau de bord de portefeuille.
 * Graphiques en SVG ecrit a la main : aucune bibliotheque de rendu supplementaire.
 */

import { useQuery } from '@tanstack/react-query';
import type { Filiere } from '@enr/core';
import { api, type Referentiel } from '../api/client.js';
import { useEtat } from '../store/etat.js';
import { formatNombre } from '../utils/geometrie.js';

interface Props {
  filiere: Filiere;
  referentiel: Referentiel;
}

export function TableauDeBord({ filiere, referentiel }: Props): JSX.Element {
  const etat = useEtat();
  const requete = useQuery({
    queryKey: ['tableau-de-bord', filiere],
    queryFn: () => api.tableauDeBord(filiere),
  });

  const meta = referentiel.filieres.find((f) => f.id === filiere);

  if (requete.isLoading) {
    return (
      <div className="vue-plein">
        <div className="chargement">
          <span className="tourniquet" />
          Chargement du portefeuille…
        </div>
      </div>
    );
  }

  const d = requete.data;

  return (
    <div className="vue-plein">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 13 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Portefeuille — {meta?.libelleCourt}</h2>
        <button
          type="button"
          className="bouton"
          style={{ marginLeft: 'auto' }}
          onClick={() => etat.definirVue('carte')}
        >
          Retour à la carte
        </button>
      </div>

      {!d ? (
        <div className="vide">Données indisponibles.</div>
      ) : (
        <>
          <div className="cartes-indicateurs">
            <div className="indicateur">
              <div className="lib">Parcelles qualifiées</div>
              <div className="val">{d.repartitionScores['total'] ?? 0}</div>
              <div className="sous">
                {d.repartitionScores['vert'] ?? 0} propices ·{' '}
                {d.repartitionScores['orange'] ?? 0} sous conditions
              </div>
            </div>
            <div className="indicateur">
              <div className="lib">En prospection</div>
              <div className="val">
                {Object.entries(d.parStatut)
                  .filter(([s]) => s !== 'ecarte')
                  .reduce((a, [, n]) => a + n, 0)}
              </div>
              <div className="sous">{d.parStatut['ecarte'] ?? 0} écartée(s)</div>
            </div>
            <div className="indicateur">
              <div className="lib">Surface sécurisée</div>
              <div className="val">{formatNombre(d.surfaceSecuriseeHa, '', 1)}</div>
              <div className="sous">hectares</div>
            </div>
            <div className="indicateur">
              <div className="lib">En négociation</div>
              <div className="val">{formatNombre(d.surfaceEnNegociationHa, '', 1)}</div>
              <div className="sous">hectares</div>
            </div>
          </div>

          <div className="bloc-graphique">
            <h3>Répartition du potentiel</h3>
            <BarresEmpilees
              donnees={(['vert', 'orange', 'rouge', 'gris'] as const).map((f) => ({
                libelle: referentiel.palette.libellesScore[f],
                valeur: d.repartitionScores[f] ?? 0,
                couleur: referentiel.palette.couleursScore[f],
              }))}
            />
          </div>

          <div className="bloc-graphique">
            <h3>Pipeline de prospection</h3>
            <BarresEmpilees
              donnees={referentiel.statutsProspection.map((s) => ({
                libelle: s.libelle,
                valeur: d.parStatut[s.id] ?? 0,
                couleur: s.couleur,
              }))}
            />
          </div>

          <div className="bloc-graphique">
            <h3>Activité sur 12 mois</h3>
            {d.evolution.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--texte-faible)', margin: 0 }}>
                Aucun événement enregistré sur la période.
              </p>
            ) : (
              <Courbes donnees={d.evolution} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BarresEmpilees({
  donnees,
}: {
  donnees: Array<{ libelle: string; valeur: number; couleur: string }>;
}): JSX.Element {
  const total = donnees.reduce((a, d) => a + d.valeur, 0);
  if (total === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--texte-faible)', margin: 0 }}>
        Aucune donnée : qualifiez des parcelles depuis la carte.
      </p>
    );
  }
  return (
    <>
      <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden' }}>
        {donnees
          .filter((d) => d.valeur > 0)
          .map((d) => (
            <div
              key={d.libelle}
              style={{ width: `${(d.valeur / total) * 100}%`, background: d.couleur }}
              title={`${d.libelle} : ${d.valeur}`}
            />
          ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 9 }}>
        {donnees.map((d) => (
          <span key={d.libelle} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="point" style={{ background: d.couleur }} />
            {d.libelle}
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{d.valeur}</strong>
            <span style={{ color: 'var(--texte-faible)' }}>
              ({Math.round((d.valeur / total) * 100)} %)
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * Les valeurs portees par l'axe vertical, de haut en bas, sans doublon.
 *
 * LE DEFAUT QUE CETTE FONCTION REMPLACE, mesure sur le portefeuille de bout en bout. L'axe etait
 * fixe a trois graduations — `[0, 0.5, 1]` fois le maximum — et chaque libelle etait arrondi. Sur
 * un portefeuille d'un seul lead, donc `maxi = 1`, `Math.round(0.5)` vaut 1 en JavaScript : l'axe
 * affichait **1, 1, 0**, deux fois le meme nombre a deux hauteurs differentes. Un point valant 1 se
 * lisait alors aussi bien au sommet qu'au milieu du graphique. Ce n'est pas un defaut de coin :
 * c'est l'etat NORMAL d'un portefeuille qui demarre, c'est-a-dire ce que l'operateur voit le
 * premier jour.
 *
 * LA REGLE : les comptages sont des ENTIERS, donc l'axe n'en montre jamais deux identiques. En
 * dessous de quatre, chaque entier a sa graduation ; au-dela, on garde les trois reperes habituels
 * (0, la moitie, le maximum) et le doublon devient impossible par construction — pour tout
 * `haut >= 4`, `Math.round(haut / 2)` tombe entre 2 et `haut - 2`, donc jamais sur 0 ni sur `haut`.
 *
 * UN `new Set` ENVELOPPAIT CE RETOUR, et il a ete retire : la campagne de mutation l'a montre
 * MORT. Casser la premiere branche ne faisait echouer aucun test, parce que le Set rattrapait le
 * doublon ; casser le Set n'en faisait echouer aucun non plus, parce que la premiere branche
 * couvrait deja tous les cas ou un doublon pouvait naitre. Deux protections dont aucune n'est
 * necessaire, c'est du code que personne ne peut plus raisonner — la lecon du bloc mort de
 * `verdict.ts`. La garantie tient desormais a une seule regle, ecrite, et le garde la mesure sur
 * toute la plage utile.
 *
 * `Math.max(1, …)` PORTE LE CAS DU PORTEFEUILLE VIDE : sans lui l'axe se replierait sur la seule
 * graduation 0, et le graphique perdrait son cadre le jour ou il est le plus consulte — le premier.
 */
export function graduations(maxi: number): number[] {
  const haut = Math.max(1, Math.round(maxi));
  if (haut <= 3) return [...Array(haut + 1).keys()];
  return [0, Math.round(haut / 2), haut];
}

function Courbes({
  donnees,
}: {
  donnees: Array<{ mois: string; nouveaux: number; securises: number }>;
}): JSX.Element {
  const largeur = 640;
  const hauteur = 170;
  const marge = { haut: 10, bas: 26, gauche: 30, droite: 10 };
  const maxi = Math.max(1, ...donnees.map((d) => Math.max(d.nouveaux, d.securises)));
  const pasX =
    donnees.length > 1
      ? (largeur - marge.gauche - marge.droite) / (donnees.length - 1)
      : 0;

  const y = (v: number): number =>
    hauteur - marge.bas - (v / maxi) * (hauteur - marge.haut - marge.bas);
  const x = (i: number): number => marge.gauche + i * pasX;

  const chemin = (cle: 'nouveaux' | 'securises'): string =>
    donnees.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d[cle])}`).join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} style={{ width: '100%', minWidth: 420, height: 'auto' }} role="img" aria-label="Activité sur 12 mois">
        {graduations(maxi).map((v) => (
          <g key={v}>
            <line
              x1={marge.gauche}
              x2={largeur - marge.droite}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--bordure)"
              strokeWidth="1"
            />
            <text x={4} y={y(v) + 3.5} fontSize="9" fill="var(--texte-faible)">
              {v}
            </text>
          </g>
        ))}
        <path d={chemin('nouveaux')} fill="none" stroke="var(--accent)" strokeWidth="2" />
        <path d={chemin('securises')} fill="none" stroke="var(--vert)" strokeWidth="2" />
        {donnees.map((d, i) => (
          <text
            key={d.mois}
            x={x(i)}
            y={hauteur - 8}
            fontSize="9"
            fill="var(--texte-faible)"
            textAnchor="middle"
          >
            {d.mois.slice(5)}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="point" style={{ background: 'var(--accent)' }} />
          Nouveaux leads
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="point" style={{ background: 'var(--vert)' }} />
          Passages en « sécurisé »
        </span>
      </div>
    </div>
  );
}
