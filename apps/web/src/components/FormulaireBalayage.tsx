/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * BALAYAGE D'UN TERRITOIRE PAR CRITERES — l'outil de recherche, par opposition a la navigation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUI MANQUAIT, ET C'EST UNE DEMANDE EXPLICITE. Toute l'application partait jusqu'ici de la
 * CARTE : on se deplace, on cadre un secteur, on qualifie, on regarde ce qui sort. C'est une
 * demarche de navigation, et elle suppose de savoir OU chercher. La demande est l'inverse :
 * « je veux un projet avec tant d'hectares minimum, dans telle zone, de telle typologie [...] et
 * la l'outil me scanne tout un departement ou toute une region pour me sortir toutes les parcelles
 * propices ». On part des CRITERES, et le territoire est une entree du formulaire, pas le cadrage
 * d'un ecran.
 *
 * LES QUATRE CRITERES SONT CEUX QUI ONT ETE NOMMES, dans l'ordre ou ils l'ont ete :
 *   - la surface minimale — le premier tri de tout developpeur ;
 *   - le territoire — un departement, plusieurs, ou une region entiere ;
 *   - la typologie — filiere, et pour le solaire le regime d'implantation (agrivoltaisme, terrain
 *     degrade, terrain inculte, defrichement) ;
 *   - la zone — zone d'acceleration des ENR, et types de zone du PLU.
 *
 * POURQUOI CE FORMULAIRE NE REDUPLIQUE PAS LE PANNEAU DE FILTRES. Les deux ecrivent le MEME etat
 * (`etat.filtres`) : un critere regle ici l'est aussi sur la carte, et reciproquement. Deux jeux de
 * criteres independants auraient laisse l'operateur exporter un CSV filtre autrement que ce qu'il
 * venait de lire. Le formulaire porte donc ce que le panneau n'a pas, et RECAPITULE le reste avec
 * de quoi y revenir.
 *
 * CE QUE L'OUTIL NE PEUT PAS FAIRE, ET IL LE DIT. Il ne balaie pas le cadastre : il balaie ce qui a
 * ete QUALIFIE. Un departement compte des centaines de milliers de parcelles, une campagne en
 * couvre quelques milliers. Le compte de parcelles qualifiees s'affiche donc a cote de chaque
 * territoire AVANT le lancement, et la couverture du resultat le redit apres — sans quoi
 * « 0 resultat » se lirait « rien a prospecter ici », qui est la conclusion la plus couteuse qu'un
 * outil de prospection puisse faire tirer.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FAMILLES_CULTURE,
  FILIERES_META,
  GROUPES_CULTURE,
  LIBELLES_REGIME,
  ORDRE_REGIMES,
  TYPES_SOL,
  groupesDesFamilles,
  typesSolDuRegime,
  type Filiere,
} from '@enr/core';
import { api, type TerritoireInterrogeable } from '../api/client.js';
import { useEtat } from '../store/etat.js';
import { formatNombre } from '../utils/geometrie.js';

/**
 * Types de zone du PLU proposes, avec ce qu'ils designent.
 *
 * CE SONT LES VALEURS DU STANDARD CNIG, celles que le Geoportail de l'urbanisme publie dans le
 * champ `typezone` de la couche `zone-urba`. La liste n'est pas fermee cote serveur — le GPU ne
 * normalise pas ce champ, et une commune peut publier une variante locale — mais elle couvre ce
 * qu'on rencontre. Le champ libre reste possible par l'API ; le selecteur, lui, evite la faute de
 * saisie qui ne ramenerait rien.
 */
const ZONES_PLU: Array<[string, string]> = [
  ['A', 'A — agricole'],
  ['N', 'N — naturelle et forestière'],
  ['U', 'U — urbanisée'],
  ['AUC', 'AUc — à urbaniser, ouverte'],
  ['AUS', 'AUs — à urbaniser, fermée'],
];

/** Une ligne du recapitulatif des criteres regles ailleurs. */
function recapitulatif(f: Record<string, unknown>): string[] {
  const lignes: string[] = [];
  if (f.surfaceMaxHa != null) lignes.push(`surface max. ${String(f.surfaceMaxHa)} ha`);
  if (f.distancePosteMaxKm != null) lignes.push(`tracé ≤ ${String(f.distancePosteMaxKm)} km`);
  if (f.capacitePosteMinMw != null) lignes.push(`capacité ≥ ${String(f.capacitePosteMinMw)} MW`);
  if (f.penteMaxPct != null) lignes.push(`pente ≤ ${String(f.penteMaxPct)} %`);
  if (f.scoreMin != null) lignes.push(`score ≥ ${String(f.scoreMin)}`);
  if (Array.isArray(f.statutsProspection) && f.statutsProspection.length > 0) {
    lignes.push(`${f.statutsProspection.length} état(s) de prospection`);
  }
  if (f.exclureKnockOuts) lignes.push('sans parcelle rédhibitoire');
  if (f.exclureNatura2000) lignes.push('hors Natura 2000');
  if (f.exclureZoneHumide) lignes.push('hors zone humide');
  if (f.exclureAop) lignes.push('hors AOP');
  return lignes;
}

export function FormulaireBalayage({ filiere }: { filiere: Filiere }): JSX.Element {
  const etat = useEtat();
  const f = etat.filtres;
  const maj = etat.definirFiltres;
  const [zonesOuvertes, setZonesOuvertes] = useState(false);

  const territoires = useQuery({
    queryKey: ['territoires', filiere],
    queryFn: () => api.territoires(filiere),
    // La nomenclature ne change pas pendant une session, et les comptes de parcelles ne bougent
    // qu'apres une qualification : inutile de la redemander a chaque montage du formulaire.
    staleTime: 5 * 60 * 1000,
  });

  const regions = territoires.data?.regions ?? [];
  const departements = territoires.data?.departements ?? [];
  const deLaRegion = f.codeRegion
    ? departements.filter((d) => d.codeRegion === f.codeRegion)
    : departements;

  /**
   * Choisir une region REMPLACE la selection de departements, elle ne s'y ajoute pas.
   *
   * Le serveur CUMULE les deux criteres (region ∩ departements explicites), ce qui est le bon
   * comportement pour « la region Centre-Val de Loire, sauf l'Indre ». Mais garder une selection
   * heritee d'une AUTRE region donnerait une intersection vide, et donc zero resultat sans qu'on
   * comprenne pourquoi.
   */
  const choisirRegion = (code: string): void => {
    maj({ codeRegion: code || undefined, codesDepartement: undefined });
    if (code) delimiterAuTerritoire();
  };

  /**
   * Balayer un territoire administratif et se limiter a l'emprise de la carte sont deux demandes
   * CONTRADICTOIRES : la seconde gagnerait en silence et le balayage ne porterait que sur ce qui
   * est a l'ecran. On leve donc la borne, et on le dit sur la ligne suivante.
   */
  const delimiterAuTerritoire = (): void => {
    if (etat.limiterALEmprise) etat.basculerLimiteEmprise();
  };

  const basculerDepartement = (code: string): void => {
    const actifs = f.codesDepartement ?? [];
    const apres = actifs.includes(code) ? actifs.filter((c) => c !== code) : [...actifs, code];
    maj({ codesDepartement: apres.length > 0 ? apres : undefined });
    if (apres.length > 0) delimiterAuTerritoire();
  };

  /**
   * La typologie d'implantation se traduit en natures de sol, et c'est la seule facon honnete de
   * l'ecrire. Le regime n'est pas une colonne cherchable en soi : il est DEDUIT de la nature du
   * sol (`REGIME_PAR_TYPE_SOL`, dans `@enr/core`). Filtrer sur les natures de sol correspondantes
   * donne exactement le meme ensemble, sans introduire un second chemin qui pourrait en diverger.
   */
  const regimeActif = (regime: string): boolean => {
    const attendus = typesSolDuRegime(regime);
    return attendus.length > 0 && attendus.every((t) => f.typesSol?.includes(t));
  };
  const basculerRegime = (regime: string): void => {
    const attendus = typesSolDuRegime(regime) as string[];
    const actuels = f.typesSol ?? [];
    const apres = regimeActif(regime)
      ? actuels.filter((t) => !attendus.includes(t))
      : [...new Set([...actuels, ...attendus])];
    maj({ typesSol: apres.length > 0 ? apres : undefined });
  };

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   * LE TYPE D'AGRICULTURE, par famille d'usage et non par groupe RPG
   * ═══════════════════════════════════════════════════════════════════════════════════════════
   *
   * POURQUOI PAR FAMILLE. Un developpeur demande « de l'elevage », pas « les groupes 16, 17, 18 et
   * 19 ». La traduction existe une fois, dans `@enr/core` (`FAMILLES_CULTURE`), ou elle se relit —
   * plutot qu'a chaque recherche, de memoire, dans la tete de l'operateur.
   *
   * CE QUI PART AU SERVEUR RESTE LE CODE. `groupesDesFamilles` developpe la selection avant
   * l'appel : le filtre SQL porte sur `codeGroupeCulture`, stable depuis 2015, et jamais sur le
   * libelle, qui depend de la date de qualification de chaque parcelle.
   */
  const familleActive = (id: string): boolean => {
    const attendus = groupesDesFamilles([id]);
    return attendus.length > 0 && attendus.every((g) => f.groupesCulture?.includes(g));
  };
  const basculerFamille = (id: string): void => {
    const attendus = groupesDesFamilles([id]);
    const actuels = f.groupesCulture ?? [];
    const apres = familleActive(id)
      ? actuels.filter((g) => !attendus.includes(g))
      : [...new Set([...actuels, ...attendus])];
    maj({ groupesCulture: apres.length > 0 ? apres : undefined });
  };

  const basculerZonePlu = (code: string): void => {
    const actifs = f.typesZonePlu ?? [];
    const apres = actifs.includes(code) ? actifs.filter((c) => c !== code) : [...actifs, code];
    maj({ typesZonePlu: apres.length > 0 ? apres : undefined });
  };

  const nbTerritoires =
    (f.codesDepartement?.length ?? 0) || (f.codeRegion ? deLaRegion.length : 0);
  const autres = recapitulatif(f as Record<string, unknown>);

  return (
    <section className="balayage" aria-label="Recherche de foncier par critères">
      <div className="balayage-grille">
        {/* --- 1. Surface ------------------------------------------------- */}
        <div className="balayage-bloc">
          <h3>Taille du projet</h3>
          <label htmlFor="bal-surf-min">Surface minimale par parcelle (ha)</label>
          <input
            id="bal-surf-min"
            type="number"
            min={0}
            step={0.5}
            value={f.surfaceMinHa ?? ''}
            placeholder="ex. 5"
            onChange={(e) => maj({ surfaceMinHa: e.target.value ? Number(e.target.value) : undefined })}
          />
          {/*
            LA PRECISION QUI EVITE UN CONTRESENS COUTEUX. Le seuil porte sur la PARCELLE
            cadastrale, pas sur le projet : un projet de 20 ha se monte couramment en agregeant
            huit parcelles de 2,5 ha, qu'un seuil a 20 ha ferait toutes disparaitre. Les parcelles
            retenues se regroupent ensuite en site depuis la liste.
          */}
          <p className="balayage-note">
            Seuil appliqué à chaque parcelle cadastrale, pas au projet : un projet de 20 ha
            s&apos;assemble souvent avec plusieurs parcelles plus petites. Cochez-les dans les
            résultats pour en faire un site.
          </p>
        </div>

        {/* --- 2. Territoire ---------------------------------------------- */}
        <div className="balayage-bloc">
          <h3>Territoire à balayer</h3>
          <label htmlFor="bal-region">Région</label>
          <select
            id="bal-region"
            value={f.codeRegion ?? ''}
            onChange={(e) => choisirRegion(e.target.value)}
          >
            <option value="">Toute la base qualifiée</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.nom}
                {r.parcellesQualifiees != null ? ` — ${formatNombre(r.parcellesQualifiees, '', 0)} parc.` : ''}
              </option>
            ))}
          </select>

          <label style={{ marginTop: 8 }}>
            Départements
            {f.codeRegion ? ' de la région' : ' (toute la France)'}
          </label>
          <p className="balayage-note">
            Aucun coché : {f.codeRegion ? 'toute la région' : 'toute la base'}. Le compte est
            celui des parcelles <strong>déjà qualifiées</strong> — un département à 0 n&apos;a
            jamais été balayé, ce qui n&apos;est pas la même chose qu&apos;un département sans
            foncier.
          </p>
          <div className="balayage-departements">
            {territoires.isLoading && <span className="balayage-note">Chargement…</span>}
            {deLaRegion.map((d) => (
              <LigneDepartement
                key={d.code}
                territoire={d}
                actif={f.codesDepartement?.includes(d.code) ?? false}
                onBasculer={() => basculerDepartement(d.code)}
              />
            ))}
          </div>
        </div>

        {/* --- 3. Typologie ----------------------------------------------- */}
        <div className="balayage-bloc">
          <h3>Type de projet</h3>
          {/*
            LE TYPE DE PROJET EST UN CRITERE DE RECHERCHE, et il doit donc etre dans le formulaire.
            Il vit aussi dans la barre superieure, ou il pilote toute l'application — carte,
            couches, ponderations. Les deux commandes ecrivent le MEME etat : il n'y a qu'une
            filiere courante, et changer de projet ici change bien tout le reste. Le rappeler
            evite de croire a deux reglages independants.
          */}
          <label htmlFor="bal-filiere">Filière recherchée</label>
          <select
            id="bal-filiere"
            value={filiere}
            onChange={(e) => etat.definirFiliere(e.target.value as Filiere)}
          >
            {Object.values(FILIERES_META).map((m) => (
              <option key={m.id} value={m.id}>
                {m.libelle}
              </option>
            ))}
          </select>
          <p className="balayage-note">
            Commande la même filière que la barre du haut : les couches, les pondérations et les
            critères évalués suivent.
          </p>

          <h3 style={{ marginTop: 8 }}>Typologie d&apos;implantation</h3>
          {filiere === 'solaire_sol' ? (
            <>
              <p className="balayage-note">
                Régime <strong>présumé</strong>, déduit de la nature du sol observée : il oriente la
                recherche, il ne qualifie aucun terrain.
              </p>
              <div className="pastilles">
                {ORDRE_REGIMES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="pastille"
                    aria-pressed={regimeActif(r)}
                    title={typesSolDuRegime(r)
                      .map((t) => TYPES_SOL[t].long)
                      .join(' ou ')}
                    onClick={() => basculerRegime(r)}
                  >
                    {libelleCourtRegime(r)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="balayage-note">
              Le régime d&apos;implantation ne s&apos;applique qu&apos;au solaire au sol. Pour cette
              filière, la nature du sol se règle dans le panneau « Filtres ».
            </p>
          )}
        </div>

        {/* --- 4. Type d'agriculture --------------------------------------- */}
        <div className="balayage-bloc">
          <h3>Type d&apos;agriculture</h3>
          {/*
            CE QUE `typesSol` NE DIT PAS. Il ne connait que « agricole exploite » : une prairie
            paturee et un champ de ble y sont la meme chose, alors que ce sont deux projets, deux
            interlocuteurs et deux types de structure. C'est la distinction que le proprietaire a
            nommee — « un type d'agriculture bien specifique, ca peut etre aussi de l'elevage ».
          */}
          <p className="balayage-note">
            D&apos;après la déclaration PAC (RPG). Une parcelle sans déclaration n&apos;est
            <strong> jamais</strong> retenue par ce critère : cherchez-la par « Terrain inculte ».
          </p>
          <div className="pastilles">
            {FAMILLES_CULTURE.map((fam) => (
              <button
                key={fam.id}
                type="button"
                className="pastille"
                aria-pressed={familleActive(fam.id)}
                title={`${fam.aide} — groupes RPG : ${fam.groupes
                  .map((g) => GROUPES_CULTURE[g] ?? g)
                  .join(', ')}`}
                onClick={() => basculerFamille(fam.id)}
              >
                {fam.libelle}
              </button>
            ))}
          </div>
          {/*
            LE MILLESIME EST DIT, parce que le RPG publie avec deux ans de retard : « prairie
            permanente » releve de 2023 n'affirme rien sur ce qui pousse aujourd'hui.
          */}
          <p className="balayage-note">
            Le RPG paraît avec environ deux ans de décalage : la culture déclarée oriente, elle ne
            constate pas l&apos;usage du jour.
          </p>
        </div>

        {/* --- 5. Zone ---------------------------------------------------- */}
        <div className="balayage-bloc">
          <h3>Zone</h3>
          <label className="case">
            <input
              type="checkbox"
              checked={Boolean(f.enZaerSeulement)}
              onChange={(e) => maj({ enZaerSeulement: e.target.checked || undefined })}
            />
            Uniquement en zone d&apos;accélération (ZAER)
          </label>
          {/*
            POURQUOI CE FILTRE EST LE PREMIER QU'ON DEMANDE. Sur une ZAER, l'argument
            reglementaire est deja porte par une deliberation communale : c'est le foncier le plus
            defendable a court terme. La reserve, elle, doit etre dite — toutes les communes n'ont
            pas delibere, et une absence de ZAER n'est pas un refus.
          */}
          <p className="balayage-note">
            Zonage délibéré par la commune (loi APER). Toutes les communes n&apos;ont pas encore
            délibéré : l&apos;absence de ZAER n&apos;est pas un obstacle, seulement un argument de
            moins.
          </p>

          <button
            type="button"
            className="bouton-discret"
            aria-expanded={zonesOuvertes}
            onClick={() => setZonesOuvertes((v) => !v)}
          >
            {zonesOuvertes ? 'Masquer' : 'Filtrer'} le zonage du PLU
            {f.typesZonePlu?.length ? ` (${f.typesZonePlu.length})` : ''}
          </button>
          {zonesOuvertes && (
            <>
              <p className="balayage-note">
                Retient une parcelle qui <strong>touche</strong> une zone de ce type, même
                partiellement — ce n&apos;est pas le zonage dominant.
              </p>
              <div className="pastilles">
                {ZONES_PLU.map(([code, libelle]) => (
                  <button
                    key={code}
                    type="button"
                    className="pastille"
                    aria-pressed={f.typesZonePlu?.includes(code) ?? false}
                    onClick={() => basculerZonePlu(code)}
                  >
                    {libelle}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* --- Recapitulatif et remise a zero ------------------------------- */}
      <div className="balayage-pied">
        <span className="balayage-note">
          {nbTerritoires > 0
            ? `Balayage sur ${nbTerritoires} département${nbTerritoires > 1 ? 's' : ''}`
            : 'Balayage sur toute la base qualifiée'}
          {etat.limiterALEmprise ? ' — limité à la zone affichée sur la carte' : ''}
          {autres.length > 0 && (
            <>
              {' — autres critères actifs : '}
              {autres.join(', ')}
            </>
          )}
        </span>
        <button type="button" className="bouton" onClick={etat.reinitialiserFiltres}>
          Réinitialiser les critères
        </button>
      </div>
    </section>
  );
}

/**
 * Libelle court du regime, pour une pastille.
 *
 * `LIBELLES_REGIME` porte des libelles complets — « Agrivoltaisme sur parcelle agricole exploitee
 * (presume) » — ecrits pour la fiche et pour les documents remis a un tiers. Ils ne tiennent pas
 * sur une pastille : la partie avant la premiere preposition suffit, et l'infobulle porte la
 * nature de sol exacte.
 */
function libelleCourtRegime(regime: string): string {
  const COURTS: Record<string, string> = {
    pv_sol_terrain_degrade: 'Terrain dégradé / artificialisé',
    agrivoltaisme: 'Agrivoltaïsme',
    pv_sol_document_cadre: 'Terrain inculte',
    pv_sol_defrichement: 'Avec défrichement',
  };
  return COURTS[regime] ?? LIBELLES_REGIME[regime] ?? regime;
}

/** Une case de departement, avec ce que la base en contient. */
function LigneDepartement({
  territoire,
  actif,
  onBasculer,
}: {
  territoire: TerritoireInterrogeable;
  actif: boolean;
  onBasculer: () => void;
}): JSX.Element {
  const n = territoire.parcellesQualifiees;
  return (
    <label className="case balayage-dep" title={`${territoire.communes} communes en base`}>
      <input type="checkbox" checked={actif} onChange={onBasculer} />
      <span className="balayage-dep-code">{territoire.code}</span>
      <span className="balayage-dep-nom">{territoire.nom}</span>
      {/*
        LE COMPTE EST GRISE A ZERO, ET C'EST DELIBERE. Un departement sans parcelle qualifiee
        reste PROPOSABLE — l'operateur peut vouloir le balayer pour constater qu'il est vide, ou
        y lancer une qualification. Le desactiver cacherait l'information au lieu de la donner.
      */}
      <span className={n === 0 ? 'balayage-dep-vide' : 'balayage-dep-nb'}>
        {n == null ? '' : n === 0 ? 'jamais balayé' : formatNombre(n, '', 0)}
      </span>
    </label>
  );
}
