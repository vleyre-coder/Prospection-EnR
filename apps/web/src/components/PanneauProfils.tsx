/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PROFILS DE RECHERCHE — le cahier des charges d'un developpeur, rejouable
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE PANNEAU RESOUT. Un developpeur remet ses criteres ; l'operateur les saisit ; la
 * semaine suivante le meme developpeur revient avec une variante. Retaper vingt criteres de
 * memoire garantit qu'on finira par en oublier un — et un critere oublie ne se voit pas dans le
 * resultat, il l'elargit.
 *
 * LES DEUX MOITIES DU PANNEAU, ET POURQUOI ELLES SONT ENSEMBLE. En haut, les profils : charger,
 * enregistrer, remplacer, supprimer. En bas, les seuils propres au developpeur. Les seconds
 * n'existent qu'attaches aux premiers : un seuil developpeur n'est pas une correction du
 * referentiel mais l'exigence d'UN projet, et deux developpeurs peuvent demander 400 m et 250 m de
 * la meme chose le meme mois sans qu'aucun des deux ait tort.
 *
 * CE QUE L'ECRAN DIT ET QUE LE CODE NE POURRAIT PAS DEVINER :
 *
 *   - le texte reglementaire est RECOPIE du classeur, jamais reformule. C'est lui que l'operateur
 *     cite au developpeur pour expliquer un ecart, et « au moins 500 m » n'est pas la meme chose
 *     que « ≥ 500 m (modulable à la hausse) » ;
 *   - un seuil ne peut que DURCIR. Le serveur refuse l'inverse ; l'ecran l'annonce avant la
 *     saisie, parce qu'un refus qui arrive apres coup fait perdre le travail ;
 *   - quand le classeur ne dit pas si son nombre est un minimum ou un maximum, le sens est
 *     DEMANDE. Aucun defaut n'est defendable : « 500 m des monuments » veut dire au moins,
 *     « 0,5 ha de defrichement » veut dire au plus ;
 *   - un seuil reglementaire non etabli est signale. Filtrer dessus reste utile — c'est meme la
 *     que l'exigence du developpeur sert le plus — mais la parcelle retenue n'est pas pour autant
 *     declaree conforme.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ErreurApi,
  type ContrainteParametrable,
  type EcritureProfil,
  type FiltresRecherche,
  type ProfilRecherche,
} from '../api/client.js';
import { useEtat } from '../store/etat.js';

/** Un seuil en cours de saisie. `valeur` reste une CHAINE tant que l'operateur tape. */
interface SaisieSeuil {
  valeur: string;
  sens: 'min' | 'max' | '';
  motif: string;
}

/** Etat de saisie du panneau, par identifiant de contrainte. */
type Saisies = Record<string, SaisieSeuil>;

const VIDE: SaisieSeuil = { valeur: '', sens: '', motif: '' };

export function PanneauProfils(): JSX.Element {
  const etat = useEtat();
  const filiere = etat.filiere;
  const clientRequetes = useQueryClient();

  const [profilId, setProfilId] = useState<string>('');
  const [nom, setNom] = useState('');
  const [developpeur, setDeveloppeur] = useState('');
  const [saisies, setSaisies] = useState<Saisies>({});
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null);

  /*
   * Les filieres de l'application sont un sous-ensemble de celles du referentiel, avec les memes
   * identifiants. La conversion est donc une lecture, pas une traduction — mais elle est ecrite
   * ici plutot que dispersee, pour que l'ajout de l'agrivoltaisme comme filiere applicative ne
   * demande rien de plus.
   */
  const filiereReferentiel = filiere;

  const contraintes = useQuery({
    queryKey: ['contraintes-parametrables', filiereReferentiel],
    queryFn: () => api.contraintesParametrables(filiereReferentiel),
    // Le referentiel est fige au deploiement : le redemander a chaque montage est du gaspillage.
    staleTime: Infinity,
  });

  const profils = useQuery({
    queryKey: ['profils', filiereReferentiel],
    queryFn: () => api.profils(filiereReferentiel),
  });

  /*
   * Changer de filiere VIDE la saisie et la selection.
   *
   * Sans cela, les seuils d'un profil methanisation resteraient affiches apres un passage en
   * eolien, et l'enregistrement suivant serait refuse par le serveur — « contrainte d'une autre
   * filiere » — sur un formulaire qui paraissait pourtant coherent.
   */
  useEffect(() => {
    setProfilId('');
    setNom('');
    setDeveloppeur('');
    setSaisies({});
    setMessage(null);
  }, [filiere]);

  const saisie = (id: string): SaisieSeuil => saisies[id] ?? VIDE;
  const majSaisie = (id: string, champ: keyof SaisieSeuil, valeur: string): void => {
    setSaisies((s) => ({ ...s, [id]: { ...(s[id] ?? VIDE), [champ]: valeur } }));
    setMessage(null);
  };

  /**
   * Les seuils reellement renseignes, dans la forme attendue par l'API.
   *
   * UNE CASE VIDE N'EST PAS UN SEUIL A ZERO. C'est la meme regle que pour les seuils de recherche :
   * envoyer `0` pour une case effacee ne filtrerait rien sur un minimum, et viderait la liste sur
   * un maximum — dans les deux cas sans que l'operateur comprenne pourquoi.
   */
  const seuilsRenseignes = (): EcritureProfil['seuils'] =>
    (contraintes.data ?? []).flatMap((c) => {
      const s = saisie(c.id);
      if (s.valeur.trim() === '') return [];
      const valeur = Number(s.valeur);
      if (!Number.isFinite(valeur)) return [];
      return [
        {
          contrainteId: c.id,
          valeur,
          // Le sens n'est envoye QUE s'il est demande : le serveur refuse un sens impose la ou le
          // classeur l'etablit deja, et il a raison de le refuser plutot que de l'ignorer.
          ...(c.sensRequis && s.sens !== '' ? { sens: s.sens } : {}),
          ...(s.motif.trim() ? { motif: s.motif.trim() } : {}),
        },
      ];
    });

  const chargerProfil = async (id: string): Promise<void> => {
    setProfilId(id);
    setMessage(null);
    if (!id) {
      setNom('');
      setDeveloppeur('');
      setSaisies({});
      return;
    }
    try {
      const profil = await api.profil(id);
      appliquer(profil);
    } catch (err) {
      setMessage({ ton: 'erreur', texte: messageDErreur(err) });
    }
  };

  /**
   * Charger un profil ECRIT ses criteres dans le formulaire de recherche.
   *
   * C'est tout l'interet de l'enregistrement : l'operateur retrouve l'ecran dans l'etat ou il
   * l'avait laisse. Les criteres remplacent les courants au lieu de s'y ajouter — une fusion
   * laisserait trainer un departement d'une recherche precedente, et le balayage porterait sur un
   * territoire que personne n'a demande.
   */
  const appliquer = (profil: ProfilRecherche): void => {
    setNom(profil.nom);
    setDeveloppeur(profil.developpeur ?? '');
    const prochaines: Saisies = {};
    for (const s of profil.seuils) {
      prochaines[s.contrainteId] = {
        valeur: String(s.valeur),
        sens: s.sens ?? '',
        motif: s.motif,
      };
    }
    setSaisies(prochaines);
    etat.reinitialiserFiltres();
    etat.definirFiltres(profil.criteres as Partial<FiltresRecherche>);
    setMessage(
      profil.seuilsOrphelins.length > 0
        ? {
            ton: 'erreur',
            texte:
              `${profil.seuilsOrphelins.length} seuil(s) de ce profil portent sur une contrainte ` +
              'qui n’existe plus au référentiel : ' +
              `${profil.seuilsOrphelins.join(', ')}. Ils ne s’appliquent plus.`,
          }
        : { ton: 'ok', texte: `Profil « ${profil.nom} » chargé.` },
    );
  };

  const corps = (): EcritureProfil => ({
    nom: nom.trim(),
    filiere: filiereReferentiel,
    developpeur: developpeur.trim() || null,
    criteres: etat.filtres,
    seuils: seuilsRenseignes(),
  });

  const enregistrement = useMutation({
    mutationFn: async (mode: 'creer' | 'remplacer') =>
      mode === 'remplacer' && profilId
        ? api.remplacerProfil(profilId, corps())
        : api.creerProfil(corps()),
    onSuccess: async (profil) => {
      setProfilId(profil.id);
      setMessage({ ton: 'ok', texte: `Profil « ${profil.nom} » enregistré.` });
      await clientRequetes.invalidateQueries({ queryKey: ['profils'] });
    },
    onError: (err) => setMessage({ ton: 'erreur', texte: messageDErreur(err) }),
  });

  const suppression = useMutation({
    mutationFn: () => api.supprimerProfil(profilId),
    onSuccess: async () => {
      setMessage({ ton: 'ok', texte: 'Profil supprimé.' });
      setProfilId('');
      setNom('');
      setDeveloppeur('');
      setSaisies({});
      await clientRequetes.invalidateQueries({ queryKey: ['profils'] });
    },
    onError: (err) => setMessage({ ton: 'erreur', texte: messageDErreur(err) }),
  });

  const liste = profils.data ?? [];
  const parametrables = contraintes.data ?? [];
  const nbSeuils = seuilsRenseignes().length;
  const enregistrable = nom.trim().length > 0 && !enregistrement.isPending;

  return (
    <section className="profils" aria-label="Profils de recherche et seuils développeur">
      <div className="profils-barre">
        <label htmlFor="profil-choix">Profil enregistré</label>
        <select
          id="profil-choix"
          value={profilId}
          onChange={(e) => void chargerProfil(e.target.value)}
        >
          <option value="">— Nouveau profil —</option>
          {liste.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
              {p.developpeur ? ` — ${p.developpeur}` : ''}
              {p.nbSeuils > 0 ? ` (${p.nbSeuils} seuil${p.nbSeuils > 1 ? 's' : ''})` : ''}
            </option>
          ))}
        </select>

        <label htmlFor="profil-nom">Nom</label>
        <input
          id="profil-nom"
          type="text"
          value={nom}
          placeholder="ex. Méthanisation — Développeur X"
          onChange={(e) => {
            setNom(e.target.value);
            setMessage(null);
          }}
        />

        <label htmlFor="profil-dev">Développeur</label>
        <input
          id="profil-dev"
          type="text"
          value={developpeur}
          placeholder="facultatif"
          onChange={(e) => setDeveloppeur(e.target.value)}
        />

        <button
          type="button"
          className="bouton"
          disabled={!enregistrable}
          onClick={() => enregistrement.mutate(profilId ? 'remplacer' : 'creer')}
        >
          {profilId ? 'Remplacer' : 'Enregistrer'}
        </button>
        {profilId && (
          <>
            {/*
              « Enregistrer sous » CREE une copie sous le nom saisi. C'est le geste courant quand
              un developpeur revient avec une variante : on part de son profil, on change un seuil,
              et on garde les deux.
            */}
            <button
              type="button"
              className="bouton-discret"
              disabled={!enregistrable}
              onClick={() => enregistrement.mutate('creer')}
            >
              Enregistrer sous…
            </button>
            <button
              type="button"
              className="bouton-discret"
              disabled={suppression.isPending}
              onClick={() => suppression.mutate()}
            >
              Supprimer
            </button>
          </>
        )}
      </div>

      {message && (
        <p className={message.ton === 'ok' ? 'profils-message' : 'profils-message profils-erreur'}>
          {message.texte}
        </p>
      )}

      {/*
        `<details>` PLUTOT QU'UN ETAT REACT, et ce n'est pas un detail de style. Un repli pilote par
        `useState` retire le contenu de l'arbre : il devient invisible au rendu serveur, donc
        intestable autrement qu'avec un navigateur — et les phrases qui vivent la sont precisement
        celles qui empechent les deux contresens les plus couteux du §2.3. L'element natif garde le
        contenu dans le document, se replie sans JavaScript et porte son propre role d'accessibilite.
      */}
      <details className="profils-repli">
        <summary>
          Seuils du développeur
          {nbSeuils > 0 ? ` — ${nbSeuils} renseigné${nbSeuils > 1 ? 's' : ''}` : ''}
        </summary>
        <div className="profils-seuils">
          {/*
            LA PHRASE QUI EVITE DEUX CONTRESENS. « Ne peut que durcir » previent le refus avant la
            saisie ; « appliqué à la recherche, jamais à la carte » dit la regle du §2.3, sans
            laquelle un operateur croira la fiche parcelle influencee par le profil ouvert.
          */}
          <p className="balayage-note">
            Un seuil développeur ne peut que <strong>durcir</strong> la réglementation : une valeur
            plus permissive est refusée. Il s’applique à la <strong>recherche</strong> ; la
            fiche d’une parcelle reste évaluée au seuil réglementaire.
          </p>

          {contraintes.isLoading && <p className="balayage-note">Chargement du référentiel…</p>}
          {!contraintes.isLoading && parametrables.length === 0 && (
            <p className="balayage-note">
              Aucune contrainte paramétrable pour cette filière : elles supposent une couche
              nationale et un seuil chiffré au référentiel.
            </p>
          )}

          {parametrables.map((c) => (
            <LigneSeuil
              key={c.id}
              contrainte={c}
              saisie={saisie(c.id)}
              onChange={(champ, valeur) => majSaisie(c.id, champ, valeur)}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

/** Une contrainte paramétrable, avec son texte réglementaire et la saisie du développeur. */
function LigneSeuil({
  contrainte,
  saisie,
  onChange,
}: {
  contrainte: ContrainteParametrable;
  saisie: SaisieSeuil;
  onChange: (champ: keyof SaisieSeuil, valeur: string) => void;
}): JSX.Element {
  const champ = `seuil-${contrainte.id}`;
  return (
    <div className="profils-seuil">
      <div className="profils-seuil-entete">
        <strong>{contrainte.nom}</strong>
        <span className="profils-categorie">{contrainte.categorie}</span>
      </div>

      {/*
        RECOPIE, JAMAIS REFORMULE. C'est ce texte que l'operateur cite au developpeur quand il lui
        explique pourquoi une parcelle est ecartee, et la reference qui lui permet de le verifier.
      */}
      <p className="profils-reglementaire">
        Réglementation : <em>{contrainte.seuilReglementaire}</em>
        {contrainte.referenceReglementaire && <> — {contrainte.referenceReglementaire}</>}
      </p>

      {!contrainte.reglementaireEtabli && (
        <p className="profils-avertissement">
          Le seuil réglementaire n’est pas établi de façon ferme par le référentiel. Votre
          exigence filtrera bien les parcelles, mais leur <strong>conformité</strong> reste à
          vérifier.
        </p>
      )}

      <div className="profils-saisie">
        <label htmlFor={champ}>Exigence du développeur</label>
        <input
          id={champ}
          type="number"
          step="any"
          value={saisie.valeur}
          placeholder={contrainte.valeurReglementaire == null ? '' : String(contrainte.valeurReglementaire)}
          onChange={(e) => onChange('valeur', e.target.value)}
        />
        <span className="profils-unite">{contrainte.unite}</span>

        {contrainte.sensRequis ? (
          /*
            Le classeur ne dit pas si son nombre est un plancher ou un plafond. Aucun defaut n'est
            defendable — mesure faite sur le referentiel, les cas vont dans les deux sens — donc on
            demande, et l'option vide reste selectionnable pour ne pas imposer un choix par inertie.
          */
          <select
            aria-label={`Sens de l’exigence pour ${contrainte.nom}`}
            value={saisie.sens}
            onChange={(e) => onChange('sens', e.target.value)}
          >
            <option value="">Sens ?</option>
            <option value="min">au moins</option>
            <option value="max">au plus</option>
          </select>
        ) : (
          <span className="profils-sens">
            {contrainte.sensEtabli === 'max' ? 'au plus' : 'au moins'}
          </span>
        )}
      </div>

      <input
        type="text"
        className="profils-motif"
        aria-label={`Motif du seuil pour ${contrainte.nom}`}
        value={saisie.motif}
        placeholder="Motif — repris dans le dossier remis au développeur"
        onChange={(e) => onChange('motif', e.target.value)}
      />
    </div>
  );
}

/**
 * Message d'erreur lisible.
 *
 * Les refus du serveur sont ECRITS POUR ETRE LUS — ils citent la contrainte, la valeur et le texte
 * du classeur. Les remplacer par un « échec de l'enregistrement » generique jetterait la seule
 * information qui permette de corriger.
 */
function messageDErreur(err: unknown): string {
  if (err instanceof ErreurApi) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue';
}
