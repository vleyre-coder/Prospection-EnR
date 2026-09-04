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
      {/*
        LES AVERTISSEMENTS DU §12 SONT COTE A COTE, ET NON EMPILES.
        Ils ne sont ni replies ni abreges : l'audit 8 etablit qu'ils sont « la seule protection
        du lecteur » contre deux defauts connus du referentiel, et l'audit precedent avait deja
        tranche qu'ils resteraient « ouverts et entiers ». Cette contrainte n'est pas rediscutee.
        Ce qui l'est, c'est leur ENCOMBREMENT : empiles sur toute la largeur, les deux textes
        mesuraient 130 px sur 1 000 — 13 % de l'ecran, 22 % en fenetre de 800 px de haut, mesure
        sur capture. Une grille les met en colonnes des que la fenetre le permet : meme texte,
        entier, sur une seule rangee. Sous 760 px de large, elle repasse a une colonne, ou
        l'empilement redevient le bon choix.
      */}
      {globaux.length > 0 && (
        <div className="bandeaux-cadre">
          {globaux.map((a) => (
            <div key={a.id} className="bandeau bandeau-garde">
              <Icone nom="alerte" />
              <p>
                <strong>{a.titre}.</strong> {a.texte}
              </p>
              <button
                type="button"
                className="bouton-discret fermer"
                title="Masquer pour cette session — l’avertissement réapparaîtra au prochain chargement"
                onClick={() => etat.masquerAvertissement(a.id)}
              >
                Masquer
              </button>
            </div>
          ))}
        </div>
      )}
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
            <strong>État des données :</strong>
            {sourcesPerimees.length > 0 && (
              <span> {sourcesPerimees.length} source(s) à rafraîchir</span>
            )}
            {sourcesPerimees.length > 0 && enRetard && <span> ·</span>}
            {enRetard && <span> {parcellesARafraichir} parcelle(s) en retard sur la donnée</span>}
          </summary>
          <div className="bandeau-detail">
            {sourcesPerimees.length > 0 && (
              <p>
                <strong>Sources à rafraîchir.</strong> {sourcesPerimees.length} source(s) depassent
                leur periodicite de mise à jour ({sourcesPerimees.join(', ')}). Les critères
                concernés peuvent être obsoletes ou indisponibles.
              </p>
            )}
            {enRetard && (
              <p>
                <strong>Parcelles en retard sur la donnée.</strong> {parcellesARafraichir}{' '}
                parcelle(s) ont été qualifiées avant la derniere ingestion de leur département : la
                carte et les listes affichent pour elles l&apos;état d&apos;avant. Ouvrir une fiche
                met la parcelle à jour{peutRafraichir ? ' ; le bouton reprend un lot' : ''}.
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
                {rafraichissementEnCours ? 'Rafraichissement…' : 'Rafraîchir un lot'}
              </button>
            )}
          </div>
        </details>
      )}
    </>
  );
}
