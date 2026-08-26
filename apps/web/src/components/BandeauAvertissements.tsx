/**
 * Bandeau d'avertissements : la section 12 du cahier des charges, et les deux alertes de fraicheur.
 *
 * POURQUOI CE FICHIER EXISTE, alors que ce composant a longtemps vecu dans `App.tsx`. Il porte trois
 * choses qui partagent une propriete desagreable : **leur disparition ne casse rien.** Aucune page ne
 * planterait, aucun test ne tomberait, et l'outil se mettrait a mentir par omission.
 *
 *   1. Les avertissements de portee GLOBALE — la section 12. C'est la clause non negociable de
 *      l'outil, celle qui repond « non » a « peut-on traiter un feu vert comme une conclusion ».
 *   2. Le bandeau « parcelles en retard sur la donnee », ne du defaut A2 de l'audit 9.
 *   3. Le bouton de reprise, masque aux comptes en lecture seule (audit 9).
 *
 * Reste dans `App.tsx`, ce composant n'etait joignable qu'en montant `App` en entier — donc la carte
 * MapLibre, donc un navigateur. Il etait par construction hors d'atteinte de tout test. L'extraire
 * n'est pas un contournement : un composant a sa place dans `components/`, et la dependance de ce
 * bandeau au graphe d'imports de la carte n'avait aucune raison d'exister.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Referentiel } from '../api/client.js';
import { useEtat } from '../store/etat.js';
import { Icone } from './BarreSuperieure.js';

export function BandeauAvertissements({
  referentiel,
  sourcesPerimees,
  parcellesARafraichir,
  role,
}: {
  referentiel: Referentiel;
  sourcesPerimees: string[];
  parcellesARafraichir: number | null;
  role: 'admin' | 'prospection' | 'lecture' | null;
}): JSX.Element | null {
  const etat = useEtat();
  const clientRequetes = useQueryClient();
  const [rafraichissementEnCours, setRafraichissementEnCours] = useState(false);
  const globaux = referentiel.avertissements.filter(
    (a) => a.portee === 'global' && !etat.avertissementsMasques.includes(a.id),
  );

  const enRetard = parcellesARafraichir != null && parcellesARafraichir > 0;
  // Un rafraichissement consomme le quota des sources publiques : la route le refuse a un compte en
  // lecture seule, et l'interface ne doit pas proposer une action vouee au 403.
  const peutRafraichir = role === 'admin' || role === 'prospection';
  if (globaux.length === 0 && sourcesPerimees.length === 0 && !enRetard) return null;

  return (
    <>
      {globaux.map((a) => (
        <div key={a.id} className="bandeau">
          <Icone nom="alerte" />
          <p>
            <strong>{a.titre}.</strong> {a.texte}
          </p>
          <button
            type="button"
            className="bouton-discret fermer"
            title="Masquer pour cette session — l’avertissement reapparaitra au prochain chargement"
            onClick={() => etat.masquerAvertissement(a.id)}
          >
            Masquer
          </button>
        </div>
      ))}
      {/*
        LES DEUX ALERTES DE FRAICHEUR SONT REUNIES EN UNE SEULE LIGNE, repliee.
        Elles occupaient deux bandeaux pleins. Additionnes aux deux avertissements de la section 12,
        les quatre bandeaux mesuraient 200 px sur une hauteur de 1 000 — un cinquieme de l'ecran avant
        la moindre donnee, mesure sur capture. Or ce sont des ETATS D'EXPLOITATION, pas des mises en
        garde de methode : leur chiffre suffit a l'ecran, le detail se deplie.

        La distinction avec la section 12 est deliberee : celle-la reste ouverte, entiere et permanente,
        parce qu'elle ne parle pas de l'etat des donnees mais de ce que l'outil ne garantit pas.
      */}
      {(sourcesPerimees.length > 0 || enRetard) && (
        <details className="bandeau bandeau-etat">
          <summary>
            <Icone nom="alerte" />
            <strong>Etat des donnees :</strong>
            {sourcesPerimees.length > 0 && (
              <span> {sourcesPerimees.length} source(s) a rafraichir</span>
            )}
            {sourcesPerimees.length > 0 && enRetard && <span> ·</span>}
            {enRetard && <span> {parcellesARafraichir} parcelle(s) en retard sur la donnee</span>}
          </summary>
          <div className="bandeau-detail">
            {sourcesPerimees.length > 0 && (
              <p>
                <strong>Sources a rafraichir.</strong> {sourcesPerimees.length} source(s) depassent
                leur periodicite de mise a jour ({sourcesPerimees.join(', ')}). Les criteres
                concernes peuvent etre obsoletes ou indisponibles.
              </p>
            )}
            {enRetard && (
              <p>
                <strong>Parcelles en retard sur la donnee.</strong> {parcellesARafraichir}{' '}
                parcelle(s) ont ete qualifiees avant la derniere ingestion de leur departement : la
                carte et les listes affichent pour elles l&apos;etat d&apos;avant. Ouvrir une fiche
                met la parcelle a jour{peutRafraichir ? ' ; le bouton reprend un lot' : ''}.
              </p>
            )}
            {enRetard && peutRafraichir && (
              <button
                type="button"
                className="bouton-discret"
                disabled={rafraichissementEnCours}
                onClick={() => {
                  setRafraichissementEnCours(true);
                  void api
                    .rafraichirParcelles()
                    .catch(() => undefined)
                    .finally(() => {
                      setRafraichissementEnCours(false);
                      // La sante porte le compteur, les scores portent la carte : les deux changent.
                      void clientRequetes.invalidateQueries();
                    });
                }}
              >
                {rafraichissementEnCours ? 'Rafraichissement…' : 'Rafraichir un lot'}
              </button>
            )}
          </div>
        </details>
      )}
    </>
  );
}
