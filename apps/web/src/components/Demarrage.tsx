/**
 * Ecran d'ouverture.
 *
 * Deux exigences en tension : donner une identite visuelle a l'outil, et ne jamais retarder
 * le travail. D'ou trois partis pris :
 *
 *   - l'animation se deroule PENDANT le chargement du referentiel, pas apres. Elle occupe un
 *     temps d'attente qui existe de toute facon ;
 *   - elle est bornee a 2,6 secondes et s'efface, meme si le reseau est lent : un ecran
 *     d'accueil qui s'eternise devient un ecran de chargement ;
 *   - elle ne s'affiche qu'une fois par session (`sessionStorage`). Revoir la meme animation
 *     apres chaque rechargement de page pendant une journee de travail serait penible.
 *
 * Les quatre symboles sont ceux des quatre filieres, dans l'ordre du selecteur : l'animation
 * enonce donc ce que fait l'outil, elle n'est pas decorative.
 */

import { useEffect, useState } from 'react';

const CLE_SESSION = 'enr_accueil_vu';
/** Duree totale, generique comprise. Volontairement courte. */
const DUREE_MS = 2600;

export function accueilDejaVu(): boolean {
  try {
    return sessionStorage.getItem(CLE_SESSION) === '1';
  } catch {
    // Stockage indisponible : on affiche l'animation, c'est sans consequence.
    return false;
  }
}

function marquerVu(): void {
  try {
    sessionStorage.setItem(CLE_SESSION, '1');
  } catch {
    /* sans consequence */
  }
}

/** Les quatre filieres, dans l'ordre du selecteur. */
const SYMBOLES: Array<{ id: string; libelle: string; dessin: JSX.Element }> = [
  {
    id: 'solaire',
    libelle: 'Solaire',
    // Panneau incline sur ses pieds, avec le soleil.
    dessin: (
      <>
        <circle cx="17.5" cy="6.5" r="3" />
        <path d="M17.5 1.5v1.5M17.5 10v1.5M13 6.5h1.5M20.5 6.5H22M14.3 3.3l1 1M20.2 9.2l1 1M14.3 9.7l1-1M20.2 3.8l1-1" />
        <path d="M3 19h13l-2.5-8H5.5L3 19Z" />
        <path d="M9.5 19v4M6 23h7" />
        <path d="M5.8 15.7h9.4" />
      </>
    ),
  },
  {
    id: 'eolien',
    libelle: 'Éolien',
    // Mat et trois pales.
    dessin: (
      <>
        <path d="M12 12v11M8.5 23h7" />
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 10.4V2.5M13.4 12.9l6.9 4M10.6 12.9l-6.9 4" />
      </>
    ),
  },
  {
    id: 'bess',
    libelle: 'Stockage',
    // Batterie avec son eclair.
    dessin: (
      <>
        <rect x="2.5" y="7" width="17" height="11" rx="2" />
        <path d="M19.5 10.5h2v4h-2" />
        <path d="M11.5 9.5 8.5 13h3l-1 3 3.5-4h-3l1-2.5Z" />
      </>
    ),
  },
  {
    id: 'methanisation',
    libelle: 'Méthanisation',
    // Digesteur a toit bombe et sa torchere.
    dessin: (
      <>
        <path d="M4 20V13a8 8 0 0 1 16 0v7Z" />
        <path d="M4 20h16" />
        <path d="M12 13.5c1.6-1.2 1.6-2.8 0-4-1.6 1.2-1.6 2.8 0 4Z" />
        <path d="M8 20v-3M16 20v-3" />
      </>
    ),
  },
];

export function Demarrage({ onTermine }: { onTermine: () => void }): JSX.Element {
  const [sortie, setSortie] = useState(false);

  useEffect(() => {
    // Le fondu de sortie occupe les 400 dernieres millisecondes.
    const versSortie = window.setTimeout(() => setSortie(true), DUREE_MS - 400);
    const fin = window.setTimeout(() => {
      marquerVu();
      onTermine();
    }, DUREE_MS);

    // Toute touche ou tout clic abrege : personne ne doit subir une animation.
    const abreger = (): void => {
      marquerVu();
      onTermine();
    };
    window.addEventListener('keydown', abreger);
    window.addEventListener('pointerdown', abreger);

    return () => {
      window.clearTimeout(versSortie);
      window.clearTimeout(fin);
      window.removeEventListener('keydown', abreger);
      window.removeEventListener('pointerdown', abreger);
    };
  }, [onTermine]);

  return (
    <div className={sortie ? 'accueil accueil-sortie' : 'accueil'} role="status" aria-label="Ouverture de Prospection EnR">
      <div className="accueil-contenu">
        <h1 className="accueil-titre">
          Prospection<span className="accueil-titre-accent"> EnR</span>
        </h1>
        <p className="accueil-sous-titre">Aide à la décision foncière &mdash; France</p>

        <div className="accueil-symboles">
          {SYMBOLES.map((s, i) => (
            <span
              key={s.id}
              className="accueil-symbole"
              // Chaque symbole entre puis sort a son tour ; le decalage vaut un quart de la
              // sequence utile, ce qui evite tout chevauchement.
              style={{ animationDelay: `${0.25 + i * 0.42}s` }}
              title={s.libelle}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {s.dessin}
              </svg>
            </span>
          ))}
        </div>

        <div className="accueil-jauge">
          <span />
        </div>
      </div>
    </div>
  );
}
