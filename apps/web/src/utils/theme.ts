/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE THEME REELLEMENT APPLIQUE, pour le code qui ne peut pas passer par le CSS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE. Le theme est un reglage a TROIS valeurs — `clair`, `sombre`,
 * `systeme` —, et presque tout le rendu s'y adapte par le CSS, qui sait lire la preference du
 * systeme tout seul. La carte, elle, ne le peut pas : MapLibre peint ses tuiles dans un canevas, et
 * les proprietes de peinture d'une couche raster se reglent en JavaScript. Il faut donc, a cet
 * endroit precis, savoir si l'on est en sombre.
 *
 * LA REGLE EST RECOPIEE DU CSS, et c'est le seul point delicat. `global.css` ecrit :
 *
 *     @media (prefers-color-scheme: dark) { :root:not([data-theme='clair']) { … } }
 *     :root[data-theme='sombre'] { … }
 *
 * soit : sombre si le reglage vaut `sombre`, ou si le systeme est sombre et que le reglage ne
 * force pas `clair`. Toute autre lecture ferait diverger la carte du reste de l'ecran — un fond
 * assombri sous un habillage clair, ou l'inverse, ce qui se voit immediatement.
 */

import { useEffect, useState } from 'react';

export type Theme = 'clair' | 'sombre' | 'systeme';

/** Le theme demande se resout-il en sombre, compte tenu de la preference du systeme ? */
export function estSombre(theme: Theme, systemeSombre: boolean): boolean {
  if (theme === 'sombre') return true;
  if (theme === 'clair') return false;
  return systemeSombre;
}

/**
 * La preference du systeme, suivie en direct.
 *
 * `matchMedia` peut manquer — rendu cote serveur des tests, navigateur ancien : on repond alors
 * « clair », qui est le defaut de l'application, plutot que de lever.
 */
export function useSystemeSombre(): boolean {
  const [sombre, setSombre] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSombre(mq.matches);
    const surChangement = (e: MediaQueryListEvent): void => setSombre(e.matches);
    mq.addEventListener('change', surChangement);
    return () => mq.removeEventListener('change', surChangement);
  }, []);
  return sombre;
}

/** Le theme effectivement applique a l'ecran. */
export function useThemeSombre(theme: Theme): boolean {
  return estSombre(theme, useSystemeSombre());
}
