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
        ═══════════════════════════════════════════════════════════════════════════════════════════
        LES AVERTISSEMENTS DU §12 TIENNENT SUR UNE LIGNE, ET SE DEPLIENT
        ═══════════════════════════════════════════════════════════════════════════════════════════

        CE QUI A CHANGE, ET SUR QUELLE MESURE. Ces deux textes s'affichaient ENTIERS, cote a cote.
        Mesure au navigateur, a la connexion, avant toute donnee :

            1600 x 1000 : barre 98 + §12  88 + etat 31 = 217 px, soit 22 % de la fenetre
            1280 x  800 : barre 98 + §12 106 + etat 31 = 235 px, soit 29 % de la fenetre

        Sur l'ecran d'un ordinateur portable ordinaire, PRESQUE UN TIERS de la fenetre etait
        occupe par du chrome avant la moindre parcelle. Le proprietaire l'a signale trois fois.

        LE COMMENTAIRE PRECEDENT CONCLUAIT L'INVERSE : « ce bloc ne peut pas maigrir beaucoup, le
        texte doit rester ENTIER, donc la seule variable est le nombre de lignes ». La conclusion
        etait juste SOUS SA PREMISSE — et c'est la premisse que le proprietaire a levee.

        CE QUI EST CONSERVE, ET CE QUI EST DEPLACE. Les TITRES restent visibles en permanence : ce
        sont eux qui portent la mise en garde (« Aide a la decision, pas une garantie de
        faisabilite »). Les textes complets sont a UN clic, dans le meme element, et le retrait
        definitif reste offert pour chacun.

        POURQUOI CE N'EST PAS UN AFFAIBLISSEMENT. Deux pavés de cinq lignes qu'on ne lit jamais ne
        protègent personne : ils sont du papier peint. Un titre lisible plus un texte accessible a
        de meilleures chances d'etre reellement lu. Et la protection qui ENGAGE est ailleurs, elle
        n'a pas bouge : le rapport PDF porte une section entiere de ces memes textes et un pied de
        page sur chaque page — c'est le document qui sort de l'application et qu'on remet a un
        tiers.
      */}
      {globaux.length > 0 && (
        <details className="bandeau bandeau-repliable bandeau-garde">
          <summary>
            <Icone nom="alerte" />
            <span className="titres-avertissements">
              {globaux.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <strong>{a.titre}</strong>
                </span>
              ))}
            </span>
          </summary>
          <div className="bandeau-detail">
            {globaux.map((a) => (
              <p key={a.id}>
                <strong>{a.titre}.</strong> {a.texte}{' '}
                <button
                  type="button"
                  className="bouton-discret"
                  title="Retirer cet avertissement — définitivement. Le bouton « Avertissements » de la barre supérieure le rappelle, et le rapport PDF le porte toujours."
                  onClick={() => etat.masquerAvertissement(a.id)}
                >
                  Retirer
                </button>
              </p>
            ))}
          </div>
        </details>
      )}
      {/*
        LES DEUX ALERTES DE FRAICHEUR SONT REUNIES EN UNE SEULE LIGNE, repliee.
        Elles occupaient deux bandeaux pleins. Additionnes aux deux avertissements de la section 12,
        les quatre bandeaux mesuraient 200 px sur une hauteur de 1 000 — un cinquieme de l'ecran avant
        la moindre donnee, mesure sur capture. Or ce sont des ETATS D'EXPLOITATION, pas des mises en
        garde de methode : leur chiffre suffit a l'ecran, le detail se deplie.

        La distinction avec la section 12 est deliberee : celle-la s'affiche ENTIERE tant qu'on ne l'a
        pas retiree, parce qu'elle ne parle pas de l'etat des donnees mais de ce que l'outil ne
        garantit pas. Celle-ci se replie d'emblee, parce qu'un chiffre suffit a decider s'il faut
        aller voir.
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
                <strong>Sources à rafraîchir.</strong> {sourcesPerimees.length} source(s) dépassent
                leur périodicité de mise à jour ({sourcesPerimees.join(', ')}). Les critères
                concernés peuvent être obsolètes ou indisponibles.
              </p>
            )}
            {enRetard && (
              <p>
                <strong>Parcelles en retard sur la donnée.</strong> {parcellesARafraichir}{' '}
                parcelle(s) ont été qualifiées avant la dernière ingestion de leur département : la
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
