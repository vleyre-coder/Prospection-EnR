/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES DEUX COURRIERS, DEPUIS LA FICHE — préparer, relire, puis envoyer depuis SA messagerie
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE BLOC N'ENVOIE PAS. Rien. Il prépare un texte, le montre, et donne trois façons de le
 * reprendre : le copier, ouvrir le client de messagerie, télécharger un `.eml`. L'envoi part
 * toujours du compte de l'opérateur, depuis son propre outil — ce sont des courriers qui engagent
 * l'entreprise, et la relecture avant envoi n'est pas une option.
 *
 * LES TROUS SONT AFFICHÉS EN PREMIER, avant le corps. Un courrier qui part avec
 * « [ADRESSE DU SERVICE] » dedans est une faute visible par le destinataire ; la liste doit donc
 * se lire avant le texte, pas après l'avoir parcouru.
 *
 * CE QUI EST MÉMORISÉ, ET CE QUI NE L'EST PAS. Le bloc de signature (raison sociale, nom, qualité,
 * coordonnées) est le même à chaque courrier : le ressaisir dix fois par jour serait absurde, il
 * est donc conservé sur le poste. Le NOM ET L'ADRESSE DU DESTINATAIRE ne le sont jamais. La saisie
 * de ces deux champs est libre et l'API la journalise, mais les conserver ici les sortirait de ce
 * dispositif : ils dormiraient dans le navigateur, sans trace, sans effacement et sans rapport
 * avec la parcelle ouverte — jusqu'à se retrouver, par simple inattention, dans le courrier
 * suivant, adressé à quelqu'un d'autre.
 */

import { useState } from 'react';
import { api, ErreurApi, type ContexteCourrier, type CourrierPrepare, type TypeCourrier } from '../api/client.js';

/** Clef du bloc mémorisé sur le poste. Ne contient aucune donnée personnelle. */
const CLEF_SIGNATURE = 'enr.courrier.signature';

/**
 * LES SEULS CHAMPS QUE CE POSTE CONSERVE, et la liste est close.
 *
 * Elle est exportée pour être vérifiée : y voir apparaître `destinataire` ou `adresse` doit faire
 * échouer un test, pas passer une relecture. Ce sont les deux seuls champs du courrier qui portent
 * des données personnelles, et les conserver ici les ferait sortir du dispositif de journalisation
 * tenu par l'API.
 */
/*
 * LA LISTE S'EST VIDÉE DE SES QUATRE CHAMPS D'EXPÉDITEUR, et c'est un gain de confidentialité
 * autant que d'ergonomie. Raison sociale, signataire, qualité et coordonnées de rappel étaient
 * conservés sur le poste ; ils ne le sont plus, parce que le courrier ne les porte plus — la
 * messagerie professionnelle s'en charge. Ne reste que la nature du projet, qui ne désigne
 * personne.
 */
export const CHAMPS_MEMORISES = ['projet'] as const;

/** Les champs mémorisables. Ni destinataire ni adresse : ce sont des données personnelles. */
export type Signature = Pick<ContexteCourrier, (typeof CHAMPS_MEMORISES)[number]>;

function signatureMemorisee(): Signature {
  try {
    const brut = window.localStorage.getItem(CLEF_SIGNATURE);
    return brut ? filtrerMemorisables(JSON.parse(brut) as Record<string, unknown>) : {};
  } catch {
    // Un stockage indisponible (navigation privée, quota) ne doit pas empêcher d'écrire un courrier.
    return {};
  }
}

/**
 * Ne garde que les champs de la liste close — a l'écriture COMME a la lecture.
 *
 * Au filtre d'écriture près, un enregistrement laissé par une version antérieure reviendrait
 * indéfiniment : personne ne relit un `localStorage`, et un nom de propriétaire y dormirait sans
 * date, sans trace et sans effacement.
 */
export function filtrerMemorisables(source: Record<string, unknown>): Signature {
  const retenu: Record<string, unknown> = {};
  for (const champ of CHAMPS_MEMORISES) {
    if (typeof source[champ] === 'string') retenu[champ] = source[champ];
  }
  return retenu as Signature;
}

function memoriserSignature(s: Signature): void {
  try {
    window.localStorage.setItem(CLEF_SIGNATURE, JSON.stringify(filtrerMemorisables(s)));
  } catch {
    /* sans effet : la saisie reste valable pour le courrier en cours */
  }
}

/**
 * Lien `mailto:`, ou `null` quand le courrier n'y tient pas.
 *
 * LE `mailto:` PASSE LE CORPS DANS UNE URL, et les clients la tronquent — la limite pratique tourne
 * autour de 2 000 caractères. Ces courriers en font plus de 1 200 avec leurs trous, et l'encodage
 * d'un accent en triple la place. Au-delà du plafond on ne propose PAS le raccourci : une coupe
 * silencieuse au milieu d'un courrier qui part sur papier à en-tête est pire que son absence.
 */
export function lienMessagerie(
  destinataire: string,
  courrier: Pick<CourrierPrepare, 'objet' | 'corps'>,
): string | null {
  const PLAFOND = 1900;
  const url =
    `mailto:${encodeURIComponent(destinataire)}` +
    `?subject=${encodeURIComponent(courrier.objet)}&body=${encodeURIComponent(courrier.corps)}`;
  return url.length <= PLAFOND ? url : null;
}

const LIBELLES: Record<TypeCourrier, { onglet: string; aide: string }> = {
  sdif: {
    onglet: 'Demande d’identité',
    aide:
      'Au service de la publicité foncière ou à la mairie. Ce courrier ne porte aucune donnée ' +
      'personnelle : son objet est précisément d’en obtenir. Le fondement de la demande est laissé ' +
      'à compléter — il dépend du service saisi, et aucune source sûre ne permet de le préremplir.',
  },
  proprietaire: {
    onglet: 'Premier contact',
    aide:
      'Au propriétaire ou à l’exploitant, une fois son identité connue. Aucun montant, aucune ' +
      'puissance : ce sont des éléments de négociation, et ils vous appartiennent.',
  },
};

/**
 * Les deux seuls champs du courrier qui portent des données personnelles.
 *
 * COMPOSANT SÉPARÉ, ET C'EST DÉLIBÉRÉ : ils ne s'affichent que pour le courrier au propriétaire,
 * donc derrière un état React qu'un rendu de test ne peut pas atteindre. Isolés ici, la mention
 * qui les accompagne est vérifiable — et elle doit l'être, parce qu'un dispositif de traçabilité
 * que l'opérateur ignore est un dispositif qu'il contourne sans le vouloir, en recopiant le nom
 * ailleurs.
 */
export function ChampsDestinataire({
  destinataire,
  adresse,
  surDestinataire,
  surAdresse,
}: {
  destinataire: string;
  adresse: string;
  surDestinataire: (v: string) => void;
  surAdresse: (v: string) => void;
}): JSX.Element {
  return (
    <>
      <div className="champ">
        <label htmlFor="courrier-destinataire">Destinataire</label>
        <input
          id="courrier-destinataire"
          value={destinataire}
          placeholder="Madame Dupont"
          onChange={(e) => surDestinataire(e.target.value)}
        />
      </div>
      <div className="champ">
        <label htmlFor="courrier-adresse">Adresse du destinataire</label>
        <textarea
          id="courrier-adresse"
          rows={2}
          value={adresse}
          onChange={(e) => surAdresse(e.target.value)}
        />
      </div>
      <p style={{ fontSize: 11, color: 'var(--texte-faible)', margin: '0 0 9px' }}>
        Ces deux champs ne sont pas conservés sur ce poste. La préparation d’un courrier nominatif
        est journalisée.
      </p>
    </>
  );
}

export function BlocCourriers({ idu }: { idu: string }): JSX.Element {
  const [type, setType] = useState<TypeCourrier>('sdif');
  const [signature, setSignature] = useState<Signature>(signatureMemorisee);
  const [destinataire, setDestinataire] = useState('');
  const [adresse, setAdresse] = useState('');
  const [courrier, setCourrier] = useState<CourrierPrepare | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const contexte = (): ContexteCourrier => ({
    ...signature,
    ...(type === 'proprietaire' ? { destinataire, adresse } : {}),
  });

  const majSignature = (champ: keyof Signature, valeur: string): void => {
    const suivante = { ...signature, [champ]: valeur };
    setSignature(suivante);
    memoriserSignature(suivante);
  };

  const preparer = (): void => {
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    void api
      .courrier(idu, type, contexte())
      .then(setCourrier)
      .catch((e: ErreurApi) => {
        setCourrier(null);
        setErreur(e.message);
      })
      .finally(() => setEnCours(false));
  };

  /*
   * LE CORPS EST MODIFIABLE ICI. L'opérateur complète les trous et ajuste une phrase sans quitter
   * l'écran ; sinon il copie, colle, corrige ailleurs, et la version relue n'est plus celle que le
   * générateur a produite. Le `.eml`, lui, est régénéré côté serveur : il ne reprend donc pas ces
   * retouches, et le bouton le dit.
   */
  const changerCorps = (texte: string): void => {
    if (courrier) setCourrier({ ...courrier, corps: texte });
  };

  const copier = (): void => {
    if (!courrier) return;
    void navigator.clipboard
      .writeText(`${courrier.objet}\n\n${courrier.corps}`)
      .then(() => setMessage('Objet et corps copiés dans le presse-papiers.'))
      .catch(() => setErreur('Copie impossible : sélectionnez le texte et copiez-le à la main.'));
  };

  const lienMailto = courrier
    ? lienMessagerie(type === 'proprietaire' ? destinataire : '', courrier)
    : null;

  const telecharger = (): void => {
    setErreur(null);
    void api
      .telechargerCourrier(idu, type, contexte())
      .then(() => setMessage('Fichier .eml téléchargé — ouvrez-le pour le modifier et l’envoyer.'))
      .catch((e: ErreurApi) => setErreur(e.message));
  };

  return (
    <details className="section">
      <summary>Courriers</summary>
      <div className="section-corps">
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(Object.keys(LIBELLES) as TypeCourrier[]).map((t) => (
            <button
              key={t}
              type="button"
              className="bouton"
              aria-pressed={t === type}
              onClick={() => {
                setType(t);
                setCourrier(null);
                setMessage(null);
                setErreur(null);
              }}
            >
              {LIBELLES[t].onglet}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--texte-faible)', margin: '0 0 9px' }}>
          {LIBELLES[type].aide}
        </p>

        <div className="champ">
          <label htmlFor="courrier-projet">Nature du projet</label>
          <input
            id="courrier-projet"
            value={signature.projet ?? ''}
            placeholder="photovoltaïque au sol, parc éolien…"
            onChange={(e) => majSignature('projet', e.target.value)}
          />
        </div>
        {/*
          NI SIGNATAIRE NI COORDONNÉES : la messagerie professionnelle porte déjà l'expéditeur en
          en-tête et la signature dans le corps. Les redemander ici faisait saisir deux fois la
          même chose, et produisait un courrier qui, collé dans un courriel, affichait la signature
          en double.
        */}
        {type === 'proprietaire' && (
          <ChampsDestinataire
            destinataire={destinataire}
            adresse={adresse}
            surDestinataire={setDestinataire}
            surAdresse={setAdresse}
          />
        )}

        <button type="button" className="bouton" onClick={preparer} disabled={enCours}>
          {enCours ? 'Préparation…' : 'Préparer le courrier'}
        </button>

        {courrier && (
          <div style={{ marginTop: 10 }}>
            {courrier.aCompleter.length > 0 && (
              <>
                <div className="legende-titre">Reste à compléter</div>
                <ul className="points-liste">
                  {courrier.aCompleter.map((x) => (
                    <li key={x}>
                      <span className="val" style={{ fontWeight: 400 }}>
                        {x}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="champ" style={{ marginTop: 8 }}>
              <label htmlFor="courrier-objet">Objet</label>
              <input id="courrier-objet" value={courrier.objet} readOnly />
            </div>
            <div className="champ">
              <label htmlFor="courrier-corps">Corps — relisez avant d’envoyer</label>
              <textarea
                id="courrier-corps"
                rows={16}
                value={courrier.corps}
                onChange={(e) => changerCorps(e.target.value)}
                style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="bouton" onClick={copier}>
                Copier
              </button>
              {lienMailto ? (
                <a className="bouton" href={lienMailto}>
                  Ouvrir dans la messagerie
                </a>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--texte-faible)', alignSelf: 'center' }}>
                  Courrier trop long pour un lien de messagerie : utilisez le fichier .eml.
                </span>
              )}
              <button type="button" className="bouton" onClick={telecharger}>
                Télécharger .eml
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--texte-faible)', margin: '6px 0 0' }}>
              Le fichier .eml est régénéré à partir des champs ci-dessus : vos retouches du corps
              n’y figurent pas. Pour les conserver, utilisez « Copier ».
            </p>
          </div>
        )}

        {message && <p style={{ fontSize: 11.5, color: 'var(--accent)' }}>{message}</p>}
        {erreur && <p style={{ fontSize: 11.5, color: 'var(--rouge)' }}>{erreur}</p>}
      </div>
    </details>
  );
}
