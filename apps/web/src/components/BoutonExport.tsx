/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * UN BOUTON D'EXPORT QUI DIT QU'IL TRAVAILLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE COMPOSANT EXISTE, et ce qui l'a rendu necessaire. Les exports etaient instantanes
 * tant qu'ils ne portaient que du texte : le fichier arrivait avant que l'operateur ait relache le
 * bouton. Depuis que la fiche et le dossier portent des cartes, leur preparation demande au serveur
 * de telecharger une vingtaine de tuiles a l'IGN — quelques secondes, parfois davantage.
 *
 * CE QUE CELA PRODUIT SANS RETOUR VISIBLE : l'operateur clique, rien ne bouge, il reclique. Chaque
 * clic relance une generation complete cote serveur, et le navigateur finit par recevoir trois
 * fichiers identiques. Un bouton qui ne dit pas qu'il travaille n'est pas seulement desagreable :
 * il multiplie la charge par le nombre de clics.
 *
 * LE BOUTON SE DESACTIVE PENDANT LA PREPARATION. C'est l'essentiel : le libelle qui change est un
 * confort, l'impossibilite de relancer est la correction.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

export interface ProprietesBoutonExport {
  /** L'action a jouer. Sa promesse tient lieu d'etat : tant qu'elle court, le bouton est occupe. */
  action: () => Promise<unknown>;
  /** Remonte l'echec a l'ecran appelant, qui sait ou l'afficher. */
  surErreur?: (message: string) => void;
  /**
   * Le libelle au repos. Il s'appelle `children` et non `enfants` : c'est le NOM QUE JSX IMPOSE,
   * et le renommer obligerait chaque appelant a le passer explicitement au lieu de l'ecrire entre
   * les balises. Une seule exception a la langue du depot, et elle est dictee par la bibliotheque.
   */
  children: ReactNode;
  /** Le libelle pendant la preparation. Par defaut, « Préparation… ». */
  pendant?: string;
  className?: string;
  desactive?: boolean;
  titre?: string;
}

export function BoutonExport({
  action,
  surErreur,
  children,
  pendant = 'Préparation…',
  className = 'bouton',
  desactive = false,
  titre,
}: ProprietesBoutonExport): JSX.Element {
  const [occupe, setOccupe] = useState(false);
  /*
   * LE COMPOSANT PEUT DISPARAITRE PENDANT L'ATTENTE — l'operateur ferme la fiche, change de vue,
   * deselectionne. Ecrire dans l'etat apres coup produit alors un avertissement React et, surtout,
   * une fuite : la promesse retient le composant demonte. Ce drapeau coute une ligne.
   */
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  return (
    <button
      type="button"
      className={className}
      disabled={desactive || occupe}
      title={titre}
      aria-busy={occupe}
      onClick={() => {
        setOccupe(true);
        void action()
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            surErreur?.(message);
          })
          .finally(() => {
            if (monte.current) setOccupe(false);
          });
      }}
    >
      {occupe ? (
        <>
          <span className="tourniquet" aria-hidden="true" /> {pendant}
        </>
      ) : (
        children
      )}
    </button>
  );
}
