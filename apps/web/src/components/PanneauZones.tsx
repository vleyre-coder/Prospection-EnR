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

  const rangs = rangsParTitre(donnees.zones);

  return (
    <>
      <ul className="liste-zones">
        {donnees.zones.map((z) => (
          <Zone key={z.id} zone={z} rang={rangs.get(z.id)} onAllerVers={onAllerVers} />
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

/** Le titre sous lequel une zone s'affiche — commune d'abord, a defaut son propre nom. */
export function titreZone(zone: Pick<ZoneProposee, 'id' | 'nom' | 'nomCommune'>): string {
  return zone.nomCommune ?? zone.nom ?? `Zone ${zone.id}`;
}

/**
 * Le rang de chaque zone parmi celles qui portent LE MEME TITRE, quand elles sont plusieurs.
 *
 * LE DEFAUT QUE CELA CORRIGE, vu sur une capture de la vue reelle. Une commune designe souvent
 * plusieurs zones d'acceleration, et le titre d'une carte est le nom de la COMMUNE : la liste
 * affichait « Écrosnes (28) » en 2e position et « Écrosnes (28) » en 8e, avec des surfaces
 * differentes et rien pour les distinguer. L'operateur lit un doublon, soupconne un defaut
 * d'affichage, et n'ouvre pas la seconde.
 *
 * AUCUN AUTRE CHAMP NE LES SEPARE, et c'est pour cela que le rang est la seule reponse honnete :
 * `nom_commune` est joint depuis la table des communes, donc identique par construction, et le nom
 * porte par la deliberation ne vaut pas mieux — mesure sur la base de bout en bout, 7 664 zones ne
 * portent que 448 noms distincts, le plus souvent le nom de la commune en capitales.
 *
 * Les zones seules n'ont pas de rang : numeroter « 1 sur 1 » ajouterait du bruit a la majorite des
 * cartes pour ne rien dire.
 */
export function rangsParTitre(
  zones: ReadonlyArray<Pick<ZoneProposee, 'id' | 'nom' | 'nomCommune'>>,
): Map<string, { i: number; n: number }> {
  const parTitre = new Map<string, string[]>();
  for (const z of zones) {
    const titre = titreZone(z);
    const deja = parTitre.get(titre);
    if (deja) deja.push(z.id);
    else parTitre.set(titre, [z.id]);
  }
  const rangs = new Map<string, { i: number; n: number }>();
  for (const ids of parTitre.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, i) => rangs.set(id, { i: i + 1, n: ids.length }));
  }
  return rangs;
}

function Zone({
  zone,
  rang,
  onAllerVers,
}: {
  zone: ZoneProposee;
  rang: { i: number; n: number } | undefined;
  onAllerVers: (bbox: [number, number, number, number]) => void;
}): JSX.Element {
  const titre = titreZone(zone);
  return (
    <li>
      <button type="button" className="zone" onClick={() => onAllerVers(zone.bbox)}>
        <span className="zone-titre">
          {titre}
          {zone.codeDepartement && <span className="zone-dep"> ({zone.codeDepartement})</span>}
          {/*
            LE RANG N'APPARAIT QUE S'IL Y A AMBIGUITE : deux cartes de meme titre dans la meme
            liste. Il dit « ce n'est pas la meme zone », ce qu'aucun autre champ affiche ne dit.
          */}
          {rang && (
            <span
              className="zone-dep"
              title={`Cette commune a désigné ${rang.n} zones d’accélération. Elles sont listées séparément, de la plus grande à la plus petite.`}
            >
              {' '}
              — zone {rang.i} sur {rang.n}
            </span>
          )}
        </span>
        <span className="zone-mesures">
          <strong>{formatNombre(zone.surfaceUtileHa, 'ha', 1)}</strong> utiles sur{' '}
          {formatNombre(zone.surfaceHa, 'ha', 1)}
          {/*
            LA DISTANCE AU POSTE SOURCE, sur la ligne des mesures et non dans une etiquette.
            Sur une zone d'acceleration, l'argument reglementaire est deja acquis : ce qui reste a
            decider est economique, et c'est le raccordement qui le decide. Cette distance
            n'existait pas avant l'ingestion des postes deduits de la BD TOPO.
          */}
          {zone.distancePosteKm != null && (
            <>
              {' · '}
              <span title="Distance à vol d’oiseau du poste source le plus proche. La capacité d’accueil, elle, reste inconnue : elle se demande au gestionnaire de réseau.">
                poste à <strong>{formatNombre(zone.distancePosteKm, 'km', 1)}</strong>
              </span>
            </>
          )}
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
          {/*
            UNE DESIGNATION A L'ECHELLE DE LA COMMUNE N'EST PAS UN SITE, et le dire evite un
            aller-retour inutile. Mesure sur un departement reel : 24 zones sur 7 664 couvrent plus
            de la moitie de leur commune, dont 14 plus de 80 %. Le tri les place desormais apres les
            sites — mais celui qui les rencontre doit savoir ce qu'il regarde.
          */}
          {zone.designationCommunale === true && (
            <span
              className="zone-etiquette"
              title="La délibération couvre plus de la moitié du territoire communal : c’est une désignation d’échelle communale, pas une emprise de projet. Le signal politique est favorable, le site reste à trouver."
            >
              désignation à l’échelle de la commune
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
