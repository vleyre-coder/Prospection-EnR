/**
 * Barre superieure : selecteur de filiere (controle principal), recherche unifiee,
 * bascule de fond de carte, vue et theme.
 */

import { useEffect, useRef, useState } from 'react';
import type { Filiere } from '@enr/core';
import { api, type Referentiel, type ResultatRecherche } from '../api/client.js';
import { useEtat } from '../store/etat.js';

interface Props {
  referentiel: Referentiel;
  onAllerVers: (r: ResultatRecherche) => void;
  /** Absent en mode developpement (authentification desactivee) : rien a deconnecter. */
  utilisateur?: { email: string; role: string } | null;
  onDeconnexion?: () => void;
}

/** Icones en ligne : aucune ressource externe, aucun chargement differe. */
function Icone({ nom }: { nom: string }): JSX.Element {
  const chemins: Record<string, JSX.Element> = {
    sun: (
      <>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
      </>
    ),
    wind: (
      <>
        <path d="M3 8h11a3 3 0 1 0-3-3" />
        <path d="M3 16h8a2.6 2.6 0 1 1-2.6 2.6" />
        <path d="M3 12h16a2.6 2.6 0 1 0-2.6-2.6" />
      </>
    ),
    battery: (
      <>
        <rect x="2" y="7" width="16" height="10" rx="2" />
        <path d="M20.5 10.5v3" />
        <path d="M9.5 9.5 7 12.5h3l-1 2.5 3-3.5H9l1-2z" />
      </>
    ),
    leaf: (
      <>
        <path d="M4 20c0-8 5-14 16-15 0 11-6 16-13 16H4z" />
        <path d="M4 20c3-5 7-8 12-9.5" />
      </>
    ),
    loupe: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </>
    ),
    alerte: (
      <>
        <path d="M12 3.5 22 20H2L12 3.5z" />
        <path d="M12 9.5v5M12 17.2v.1" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {chemins[nom] ?? chemins['sun']}
    </svg>
  );
}

export { Icone };

export function BarreSuperieure({
  referentiel,
  onAllerVers,
  utilisateur,
  onDeconnexion,
}: Props): JSX.Element {
  const etat = useEtat();

  return (
    <header className="barre">
      <div className="marque">
        <strong>Prospection EnR</strong>
        <span>aide à la décision foncière</span>
      </div>

      <nav className="filieres" aria-label="Sélection de la filière">
        {referentiel.filieres.map((f) => (
          <button
            key={f.id}
            type="button"
            className="filiere-onglet"
            aria-pressed={etat.filiere === f.id}
            title={`${f.libelle} — ${f.critereRoi}`}
            onClick={() => etat.definirFiliere(f.id as Filiere)}
          >
            <Icone nom={f.icone} />
            <span>{f.libelleCourt}</span>
          </button>
        ))}
      </nav>

      <Recherche onAllerVers={onAllerVers} />

      <div className="barre-espace" />

      <div className="groupe-boutons" role="group" aria-label="Vue">
        {(
          [
            ['carte', 'Carte'],
            ['liste', 'Liste'],
            ['tableau', 'Tableau de bord'],
          ] as const
        ).map(([v, libelle]) => (
          <button
            key={v}
            type="button"
            className="bouton-groupe"
            aria-pressed={etat.vue === v}
            onClick={() => etat.definirVue(v)}
          >
            {libelle}
          </button>
        ))}
      </div>

      <div className="groupe-boutons" role="group" aria-label="Fond de carte">
        <button
          type="button"
          className="bouton-groupe"
          aria-pressed={etat.fond === 'plan'}
          onClick={() => etat.definirFond('plan')}
        >
          Plan
        </button>
        <button
          type="button"
          className="bouton-groupe"
          aria-pressed={etat.fond === 'ortho'}
          onClick={() => etat.definirFond('ortho')}
        >
          Ortho
        </button>
      </div>

      <button
        type="button"
        className="bouton"
        title="Basculer le thème clair / sombre"
        onClick={() => etat.definirTheme(etat.theme === 'sombre' ? 'clair' : 'sombre')}
      >
        {etat.theme === 'sombre' ? 'Clair' : 'Sombre'}
      </button>

      {/*
        LA DECONNEXION EST SEPAREE DES COMMANDES D'AFFICHAGE.
        « Sombre » et « Quitter » etaient deux boutons identiques et colles : viser le theme et
        fermer sa session se jouaient a quelques pixels, pour deux consequences sans commune
        mesure — l'une se rattrape d'un clic, l'autre ramene a l'ecran de connexion et perd la
        position de la carte. Un filet les separe, et le libelle dit ce qui va se passer plutot
        que « Quitter », qui peut aussi se lire « quitter la vue ».
      */}
      {utilisateur && onDeconnexion && (
        <>
          <span className="separateur-barre" aria-hidden="true" />
          <button
            type="button"
            className="bouton bouton-quitter"
            title={`Se déconnecter — ${utilisateur.email}, rôle ${utilisateur.role}`}
            onClick={onDeconnexion}
          >
            Se déconnecter
          </button>
        </>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Recherche unifiee
// ---------------------------------------------------------------------------

function Recherche({ onAllerVers }: { onAllerVers: (r: ResultatRecherche) => void }): JSX.Element {
  const [texte, setTexte] = useState('');
  const [resultats, setResultats] = useState<ResultatRecherche[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [indice, setIndice] = useState(0);
  const [chargement, setChargement] = useState(false);
  const minuteur = useRef<number | null>(null);
  const conteneur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surClicExterieur = (e: MouseEvent): void => {
      if (!conteneur.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('mousedown', surClicExterieur);
    return () => document.removeEventListener('mousedown', surClicExterieur);
  }, []);

  const chercher = (valeur: string): void => {
    setTexte(valeur);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    if (valeur.trim().length < 2) {
      setResultats([]);
      setOuvert(false);
      return;
    }
    setChargement(true);
    minuteur.current = window.setTimeout(() => {
      void api
        .rechercher(valeur)
        .then((r) => {
          setResultats(r.resultats);
          setIndice(0);
          setOuvert(true);
        })
        .catch(() => setResultats([]))
        .finally(() => setChargement(false));
    }, 280);
  };

  const choisir = (r: ResultatRecherche): void => {
    onAllerVers(r);
    setOuvert(false);
    setTexte(r.libelle);
  };

  const libellesType: Record<string, string> = {
    parcelle: 'parcelle',
    adresse: 'adresse',
    commune: 'commune',
    coordonnees: 'coord.',
    poste_source: 'poste',
  };

  return (
    <div className="recherche" ref={conteneur}>
      <span className="loupe">
        <Icone nom="loupe" />
      </span>
      <input
        type="search"
        value={texte}
        placeholder="Adresse, commune, 28390 0C 843, IDU, 48.15 1.75…"
        aria-label="Recherche"
        onChange={(e) => chercher(e.target.value)}
        onFocus={() => resultats.length > 0 && setOuvert(true)}
        onKeyDown={(e) => {
          if (!ouvert || resultats.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndice((i) => Math.min(i + 1, resultats.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndice((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const r = resultats[indice];
            if (r) choisir(r);
          } else if (e.key === 'Escape') {
            setOuvert(false);
          }
        }}
      />
      {ouvert && (
        <div className="resultats-recherche" role="listbox">
          {chargement && <div className="chargement"><span className="tourniquet" />Recherche…</div>}
          {!chargement && resultats.length === 0 && (
            <div style={{ padding: '9px 10px', fontSize: 12, color: 'var(--texte-faible)' }}>
              Aucun résultat.
            </div>
          )}
          {resultats.map((r, i) => (
            <button
              key={`${r.type}-${r.libelle}-${i}`}
              type="button"
              className="resultat-item"
              data-actif={i === indice}
              role="option"
              aria-selected={i === indice}
              onClick={() => choisir(r)}
              onMouseEnter={() => setIndice(i)}
            >
              <div className="titre">
                <span className="etiquette-type">{libellesType[r.type] ?? r.type}</span>
                {r.libelle}
              </div>
              {r.sousTitre && <div className="sous">{r.sousTitre}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
