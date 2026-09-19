/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE VERDICT REFERENTIEL SUR LA FICHE — mode 1, toujours au seuil reglementaire
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE BLOC AJOUTE, ET CE QU'IL NE REMPLACE PAS. La fiche portait deja un SCORE, qui classe
 * les parcelles favorables entre elles. Elle ne disait pas si la parcelle est instruisable au
 * regard des 292 contraintes du referentiel. Un score de 82/100 sur une parcelle en cœur de parc
 * national n'a aucun sens ; le score reste, le verdict s'ajoute, et les deux repondent a deux
 * questions differentes.
 *
 * CE QUE L'ECRAN DOIT DIRE, ET QUE RIEN D'AUTRE NE DIRA :
 *
 *   1. CE QUI N'A PAS ETE REGARDE. C'est la moitie la plus importante du bloc. Le referentiel
 *      depasse largement ce que le releve mesure — 42 contraintes rattachees sur 292 — et un
 *      « a instruire » qui ne dirait pas combien de contraintes sont restees sans donnee se
 *      lirait comme un jugement, alors que c'est un aveu. L'operateur doit voir la difference
 *      entre « quatre contraintes posent probleme » et « quarante-neuf n'ont pas pu etre
 *      evaluees » ;
 *   2. QUELLE CONTRAINTE A FAIT BASCULER la parcelle, nommee, avec son seuil et sa reference ;
 *   3. QUE CE VERDICT EST CELUI DU DROIT, pas celui d'un cahier des charges. Un operateur qui
 *      vient de travailler sur le profil d'un developpeur exigeant doit savoir que cette fiche,
 *      elle, ne s'en sert pas.
 *
 * Le detail complet est replie dans un `<details>` natif : cinquante lignes deployees d'office
 * noieraient les trois informations ci-dessus, et un repli pilote par un etat React sortirait le
 * contenu du rendu serveur, donc des tests.
 */

import type { ContrainteEvaluee, ResultatVerdict } from '@enr/scoring';

/** Libelle et couleur de chaque verdict. La couleur reprend la palette des feux du score. */
const VERDICTS: Record<string, { libelle: string; classe: string; explication: string }> = {
  favorable: {
    libelle: 'Favorable',
    classe: 'verdict-favorable',
    explication:
      'Toutes les contraintes du référentiel ont pu être évaluées, et aucune n’est enfreinte.',
  },
  a_instruire: {
    libelle: 'À instruire',
    classe: 'verdict-instruire',
    explication:
      'Une contrainte au moins est enfreinte, incertaine, ou n’a pas pu être évaluée faute de donnée.',
  },
  defavorable: {
    libelle: 'Défavorable',
    classe: 'verdict-defavorable',
    explication:
      'Une contrainte rédhibitoire du référentiel est enfreinte au seuil réglementaire. Aucune qualité de la parcelle ne la compense.',
  },
};

/** Libelle de chaque etat, du point de vue de l'operateur. */
const ETATS: Record<ContrainteEvaluee['etat'], string> = {
  respectee: 'Respectée',
  enfreinte: 'Non respectée',
  a_verifier: 'À vérifier',
  donnee_absente: 'Non évaluée',
  cadre: 'Procédure',
};

export function BlocVerdict({ verdict }: { verdict: ResultatVerdict }): JSX.Element {
  const meta = VERDICTS[verdict.verdict] ?? VERDICTS['a_instruire']!;
  const { total, respectees, enfreintes, aVerifier, donneesAbsentes } = verdict.couverture;

  /*
   * ═════════════════════════════════════════════════════════════════════════════════════════════
   * « A INSTRUIRE PARCE QU'ON N'A PAS LA DONNEE » N'EST PAS « A INSTRUIRE PARCE QUE ÇA COINCE »
   * ═════════════════════════════════════════════════════════════════════════════════════════════
   *
   * MESURE QUI A MOTIVE CETTE DISTINCTION. Sur 200 parcelles reelles de la base de reference, en
   * solaire au sol : 200 verdicts « à instruire », 4 contraintes respectees en moyenne, 0 enfreinte,
   * et 51 non evaluees sur 56. Autrement dit, la totalite des parcelles bascule pour la MEME raison
   * — le releve ne porte pas encore les couches necessaires — et aucune ne bascule sur un fait.
   *
   * Un « à instruire » uniforme se lit comme un jugement porte sur chaque parcelle. L'operateur en
   * conclurait que son foncier est mediocre, alors que la phrase honnete est « nous n'avons pas
   * regarde ». La nuance est donc portee par l'explication elle-meme, et non reservee au detail que
   * personne ne deplie.
   */
  const faute = enfreintes > 0 || aVerifier > 0;
  const explication =
    verdict.verdict === 'a_instruire' && !faute && donneesAbsentes > 0
      ? `Aucune contrainte n’est enfreinte parmi celles qui ont pu être évaluées. ` +
        `Le verdict reste réservé parce que ${donneesAbsentes} contrainte${donneesAbsentes > 1 ? 's' : ''} ` +
        `sur ${total} n’${donneesAbsentes > 1 ? 'ont' : 'a'} pas de donnée au relevé — c’est une lacune ` +
        `de notre couverture, pas un défaut de la parcelle.`
      : meta.explication;

  /*
   * Les contraintes qui MERITENT D'ETRE LUES viennent en tete : enfreintes d'abord, puis les
   * incertaines, puis les lacunes. Les respectees ferment la liste — ce sont celles dont
   * l'operateur n'a rien a faire, et les mettre en premier ferait defiler pour rien.
   */
  const ORDRE: Record<ContrainteEvaluee['etat'], number> = {
    enfreinte: 0,
    a_verifier: 1,
    donnee_absente: 2,
    respectee: 3,
    cadre: 4,
  };
  const triees = [...verdict.contraintes].sort((a, b) => ORDRE[a.etat] - ORDRE[b.etat]);

  return (
    <section className="bloc-verdict" aria-label="Verdict réglementaire">
      <div className="verdict-entete">
        <span className={`verdict-pastille ${meta.classe}`}>{meta.libelle}</span>
        <span className="verdict-explication">{explication}</span>
      </div>

      {/*
        LA PHRASE QUI EMPECHE LE CONTRESENS DU §2.3. Sans elle, un operateur qui vient de regler le
        profil d'un developpeur exigeant croira que cette fiche en tient compte, et lira un verdict
        comme s'il venait du droit.
      */}
      <p className="verdict-mode">
        Évalué au <strong>seuil réglementaire</strong>. Les exigences propres à un développeur
        s’appliquent à la recherche, jamais à cette fiche.
      </p>

      {verdict.contrainteDecisive && (
        <div className="verdict-decisive">
          {/*
            « DÉCISIVE » N'EST JUSTE QUE SI QUELQUE CHOSE A REELLEMENT TRANCHE.
            
            Le moteur designe toujours ce qui explique le verdict : faute d'infraction, il retombe
            sur la contrainte non evaluee la plus severe. Annoncer « contrainte décisive » sur une
            parcelle dont aucune contrainte n'est enfreinte ferait lire un motif de rejet la ou il
            n'y a qu'une donnee manquante — et le choix de cette ligne parmi cinquante lacunes est
            arbitraire. Le titre dit donc ce que la ligne est vraiment.
          */}
          <strong>
            {verdict.contrainteDecisive.etat === 'enfreinte'
              ? `Contrainte décisive : ${verdict.contrainteDecisive.nom}`
              : `Premier point à instruire : ${verdict.contrainteDecisive.nom}`}
          </strong>
          <LigneContrainte contrainte={verdict.contrainteDecisive} />
        </div>
      )}

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════════
        CE QUI N'A PAS ETE REGARDE, ANNONCE AVANT LE DETAIL
        ═══════════════════════════════════════════════════════════════════════════════════════

        Le referentiel couvre plus que ce que le releve mesure. Un « à instruire » sans ce compte
        se lirait comme un jugement porte sur la parcelle, alors que c'est le plus souvent un aveu
        sur la donnee — et l'operateur reglerait le mauvais probleme.
      */}
      <p className="verdict-couverture">
        {total} contrainte{total > 1 ? 's' : ''} au référentiel pour cette filière&nbsp;:{' '}
        <span className="verdict-compte-ok">{respectees} respectée{respectees > 1 ? 's' : ''}</span>
        {', '}
        <span className="verdict-compte-ko">{enfreintes} non respectée{enfreintes > 1 ? 's' : ''}</span>
        {', '}
        <span className="verdict-compte-doute">{aVerifier} à vérifier</span>
        {', '}
        <span className="verdict-compte-absent">
          {donneesAbsentes} non évaluée{donneesAbsentes > 1 ? 's' : ''}
        </span>
        .
      </p>
      {donneesAbsentes > 0 && (
        <p className="verdict-lacune">
          Les contraintes « non évaluées » ne sont pas des contraintes absentes&nbsp;: la donnée
          nécessaire manque au relevé. Elles restent à instruire manuellement.
        </p>
      )}

      <details className="verdict-detail">
        <summary>Détail des {total} contraintes</summary>
        <ul className="verdict-liste">
          {triees.map((c) => (
            <li key={c.contrainteId} className={`verdict-item verdict-${c.etat}`}>
              <div className="verdict-item-entete">
                <span className="verdict-etat">{ETATS[c.etat]}</span>
                <span className="verdict-nom">{c.nom}</span>
                <span className="verdict-categorie">{c.categorie}</span>
              </div>
              <LigneContrainte contrainte={c} />
            </li>
          ))}
        </ul>
      </details>

      {verdict.cadres.length > 0 && (
        <details className="verdict-detail">
          {/*
            LES PROCEDURES SONT HORS VERDICT, et le dire evite la question « pourquoi le permis de
            construire n'apparait-il pas dans les contraintes ? ». Il est requis pour tout projet :
            le compter mettrait chaque parcelle « à instruire » pour une formalité universelle.
          */}
          <summary>
            {verdict.cadres.length} procédure{verdict.cadres.length > 1 ? 's' : ''} applicable
            {verdict.cadres.length > 1 ? 's' : ''} au projet
          </summary>
          <p className="verdict-lacune">
            Applicables à tout projet de la filière, quelle que soit la parcelle&nbsp;: elles
            n’entrent donc pas dans le verdict.
          </p>
          <ul className="verdict-liste">
            {verdict.cadres.map((c) => (
              <li key={c.contrainteId} className="verdict-item verdict-cadre">
                <div className="verdict-item-entete">
                  <span className="verdict-nom">{c.nom}</span>
                </div>
                <div className="verdict-reglementaire">
                  {c.seuilReglementaire}
                  {c.referenceReglementaire && <> — {c.referenceReglementaire}</>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Le detail d'une contrainte : le seuil applique, la mesure, et la reference.
 *
 * LES TROIS ENSEMBLE, ET C'EST LA DEMANDE DU CAHIER DES CHARGES. Le seuil sans la mesure ne dit
 * pas pourquoi la parcelle bascule ; la mesure sans la reference ne permet pas de verifier ; et
 * le texte du classeur est RECOPIE, jamais reformule, parce que c'est lui que l'operateur cite.
 */
function LigneContrainte({ contrainte: c }: { contrainte: ContrainteEvaluee }): JSX.Element {
  return (
    <div className="verdict-ligne">
      <div className="verdict-reglementaire">
        Référentiel&nbsp;: <em>{c.seuilReglementaire}</em>
        {c.referenceReglementaire && <> — {c.referenceReglementaire}</>}
      </div>

      {c.valeurMesuree !== null && c.cheminMesure && (
        <div className="verdict-mesure">
          Mesuré&nbsp;: {c.valeurMesuree} {c.condition?.unite ?? ''}{' '}
          {/* Le chemin rend la mesure VERIFIABLE : sans lui, un chiffre faux est indiscernable
              d'un chiffre juste, et l'operateur n'a aucun moyen de remonter a sa source. */}
          <span className="verdict-chemin">({c.cheminMesure})</span>
        </div>
      )}

      {c.etat === 'donnee_absente' && (
        <div className="verdict-mesure">
          Aucune donnée au relevé pour cette contrainte. Source attendue&nbsp;: {c.coucheSig}.
        </div>
      )}

      {c.origineSeuil === 'developpeur' && c.conditionReglementaire && (
        <div className="verdict-mesure">
          Seuil appliqué&nbsp;: exigence du développeur ({c.condition?.valeur}{' '}
          {c.condition?.unite}). La réglementation, elle, demande «&nbsp;{c.seuilReglementaire}
          &nbsp;».
          {c.motifDeveloppeur && <> Motif&nbsp;: {c.motifDeveloppeur}</>}
        </div>
      )}
    </div>
  );
}
