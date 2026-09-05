/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CE QUE L'APPLICATION PROPOSE — LA PREMIERE CHOSE QU'ON VOIT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE L'ECRAN MONTRAIT AVANT. Le panneau de gauche s'ouvrait sur des FILTRES, puis des
 * ponderations, puis des couches. Autrement dit sur des reglages — et il fallait deja savoir ou
 * chercher pour que l'outil dise quoi penser de cet endroit-la. La carte nationale, elle, etait
 * vide : la colonne de potentiel communal qu'elle est censee colorer n'est ecrite par aucun code.
 *
 * CE PANNEAU RENVERSE L'ORDRE. Il repond a « ou aller ? » avant qu'on ait rien regle : les zones
 * d'acceleration designees par les communes pour la filiere courante, les plus grandes d'abord,
 * cliquables pour s'y rendre. Les reglages restent, plus bas, pour affiner — ce qui est leur place.
 *
 * TROIS ETATS, ET LEUR DISTINCTION EST TOUT L'INTERET :
 *
 *   - des zones : on les propose ;
 *   - aucune zone SUR UN TERRITOIRE INGERE : « rien ici », qui est une information ;
 *   - aucune zone parce que RIEN N'A ETE INGERE : « on n'en sait rien », qui est une information
 *     tout a fait differente, et que l'application doit dire au lieu de laisser croire la premiere.
 *
 * Le troisieme etat est le seul honnete aujourd'hui sur la plus grande partie du territoire :
 * l'ingestion nationale des ZAER n'a jamais tourne. Afficher une liste vide y ferait conclure
 * « il n'y a rien a prospecter », ce qui serait faux — et c'est exactement la famille de fautes
 * que ce projet traque.
 */

import { useQuery } from '@tanstack/react-query';
import type { Filiere } from '@enr/core';
import {
  api,
  type Referentiel,
  type ReponseZones,
  type ZoneProposee,
} from '../api/client.js';
import { formatNombre } from '../utils/geometrie.js';

interface Props {
  filiere: Filiere;
  referentiel: Referentiel;
  /** Recentre la carte sur l'emprise de la zone. */
  onAllerVers: (bbox: [number, number, number, number]) => void;
}

/** Nombre de zones demandees. Au-dela, la liste ne se lit plus. */
const LIMITE = 40;

export function PanneauZones({ filiere, referentiel, onAllerVers }: Props): JSX.Element {
  /*
   * L'EMPRISE N'ENTRE PAS DANS LA REQUETE, et c'est deliberé. Le panneau doit proposer quelque
   * chose des l'ouverture, quand la carte montre la France entiere et qu'aucune emprise utile
   * n'existe. Restreindre a ce qu'on regarde deja reviendrait a demander de trouver d'abord.
   */
  const requete = useQuery({
    queryKey: ['zones', filiere],
    queryFn: () => api.zones(filiere, undefined, LIMITE),
    retry: 1,
  });

  const meta = referentiel.filieres.find((f) => f.id === filiere);

  return (
    <details className="section" open>
      <summary>
        Zones à prospecter
        {requete.data && <span className="compteur-section">{requete.data.zones.length}</span>}
      </summary>
      <div className="section-corps">
        <p className="aide-section">
          Zones d’accélération désignées par les communes pour {meta?.libelleCourt ?? 'cette filière'},
          les plus grandes d’abord. Cliquez pour vous y rendre.
        </p>

        {requete.isLoading && (
          <div className="chargement">
            <span className="tourniquet" />
            Recherche des zones…
          </div>
        )}

        {requete.isError && (
          <div className="erreur-encart" style={{ margin: 0 }}>
            Les zones n’ont pas pu être chargées.
          </div>
        )}

        {requete.data && <Resultats donnees={requete.data} onAllerVers={onAllerVers} />}
      </div>
    </details>
  );
}

/**
 * La partie qui DIT quelque chose, isolee de la requete.
 *
 * Exportee pour etre montee directement dans les tests : les trois etats — des zones, aucune zone
 * sur un territoire ingere, aucune donnee du tout — sont le coeur de ce composant, et les tenir
 * derriere un `useQuery` reviendrait a ne pas les tenir.
 */
export function Resultats({
  donnees,
  onAllerVers,
}: {
  donnees: ReponseZones;
  onAllerVers: (bbox: [number, number, number, number]) => void;
}): JSX.Element {
  if (donnees.zones.length === 0) {
    /*
     * ICI SE JOUE LA DIFFERENCE ENTRE « RIEN » ET « ON N'EN SAIT RIEN ».
     * Une liste vide sans cette distinction se lit « il n'y a rien a prospecter », ce qui est faux
     * partout ou la donnee n'a pas ete ingeree — c'est-a-dire presque partout aujourd'hui.
     */
    if (!donnees.couverture.donneePresente) {
      return (
        <div className="vide">
          <strong>Aucune zone n’a encore été ingérée.</strong>
          <br />
          Ce n’est pas « il n’y a rien à prospecter » : c’est « l’application n’en sait rien ». Les
          zones d’accélération sont publiées au niveau national ; il faut les charger, département
          par département.
          <br />
          <code className="commande">npm run ingest -w @enr/api -- zaer_local:28</code>
        </div>
      );
    }
    return (
      <div className="vide">
        Aucune zone d’accélération ne vise cette filière dans les départements chargés
        {donnees.couverture.departementsIngeres.length > 0 && (
          <> ({donnees.couverture.departementsIngeres.join(', ')})</>
        )}
        .
        {donnees.nbTropPetites > 0 && (
          <>
            {' '}
            {donnees.nbTropPetites} zone(s) ont été écartées, trop petites : il en faut au moins{' '}
            {formatNombre(donnees.surfaceUtileMinHa, 'ha', 0)} utiles pour cette filière.
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="liste-zones">
        {donnees.zones.map((z) => (
          <Zone key={z.id} zone={z} onAllerVers={onAllerVers} />
        ))}
      </ul>
      {/*
        La couverture est rappelee SOUS la liste, meme quand elle n'est pas vide : une liste de
        quarante zones toutes situees dans un seul departement pourrait faire croire que le reste du
        pays a ete regarde et n'a rien donne.
      */}
      <p className="aide-section">
        Départements chargés : {donnees.couverture.departementsIngeres.join(', ') || 'aucun'}. Le
        reste du territoire n’a pas été ingéré — l’application n’en dit rien, ni dans un sens ni
        dans l’autre.
      </p>
    </>
  );
}

function Zone({
  zone,
  onAllerVers,
}: {
  zone: ZoneProposee;
  onAllerVers: (bbox: [number, number, number, number]) => void;
}): JSX.Element {
  const titre = zone.nomCommune ?? zone.nom ?? `Zone ${zone.id}`;
  return (
    <li>
      <button type="button" className="zone" onClick={() => onAllerVers(zone.bbox)}>
        <span className="zone-titre">
          {titre}
          {zone.codeDepartement && <span className="zone-dep"> ({zone.codeDepartement})</span>}
        </span>
        <span className="zone-mesures">
          <strong>{formatNombre(zone.surfaceUtileHa, 'ha', 1)}</strong> utiles sur{' '}
          {formatNombre(zone.surfaceHa, 'ha', 1)}
        </span>
        <span className="zone-notes">
          {/*
            L'IMPLANTATION NON PRECISEE EST DITE, PAS CACHEE. La deliberation designe le terrain
            pour du photovoltaique sans indiquer s'il s'agit du sol ou d'une toiture. C'est une
            piste reelle — dans certains departements, 93 % des zones sont dans ce cas — mais elle
            ne vaut aucun argument reglementaire, et le moteur de scoring l'ignore.
          */}
          {!zone.implantationPrecisee && (
            <span className="zone-etiquette" title="La délibération ne dit pas si la zone vise le sol ou des toitures. La zone est proposée, mais n’ouvre aucun argument réglementaire.">
              implantation non précisée
            </span>
          )}
          {zone.nbParcellesQualifiees > 0 && (
            <span className="zone-etiquette zone-vue">
              {zone.nbParcellesQualifiees} parcelle(s) déjà qualifiée(s)
              {zone.nbPropices > 0 && <> · {zone.nbPropices} propice(s)</>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
