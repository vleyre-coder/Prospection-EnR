/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE CAHIER DES CHARGES REMIS AU DEVELOPPEUR — un Word editable, par filiere
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * LA DEMANDE. « Il faudrait que je puisse editer une liste d'informations exhaustive et necessaire
 * sous Word, que je puisse editer et transmettre a un developpeur en fonction du projet — solaire,
 * eolien, methanisation — pour avoir tout le cahier des charges, et pouvoir ensuite le transmettre
 * dans le logiciel. »
 *
 * CE QUE CE DOCUMENT EST : le formulaire qu'on envoie AVANT la recherche. Le developpeur le
 * remplit — surface, territoire, seuils, exclusions — le renvoie, et l'operateur reporte les
 * valeurs dans l'outil de recherche. C'est l'aller du cycle ; le « Dossier developpeur » PDF en
 * est le retour, une fois les parcelles trouvees.
 *
 * ═══ LE POINT QUI DECIDE DE SON UTILITE : CHAQUE LIGNE PORTE SON IDENTIFIANT TECHNIQUE
 *
 * Un cahier des charges rempli en toutes lettres oblige a RETRADUIRE chaque ligne au retour :
 * « distance a la voirie » designe-t-il `acces.distanceVoirieM` ou la distance au poste ? Cette
 * traduction, faite de memoire et a chaque dossier, est exactement ou se perd un critere.
 *
 * Chaque seuil du tableau porte donc la GRANDEUR telle que le logiciel la nomme. Le report
 * redevient une recopie, et la colonne sert de verification : une grandeur absente du formulaire
 * de recherche se voit immediatement.
 *
 * ═══ CE QUE CE DOCUMENT NE FAIT PAS, ET IL FAUT LE DIRE
 *
 * IL NE SE REIMPORTE PAS. Word remplit des cellules, mais rien ne garantit qu'un destinataire ne
 * fusionnera pas deux lignes, n'ecrira pas « ~500 » ou « entre 3 et 5 km » dans une case attendue
 * numerique, ou ne repondra pas dans un courriel a cote. Un analyseur .docx aurait donc deux
 * comportements possibles : refuser des documents legitimes, ou deviner — et deviner un seuil de
 * recherche, c'est produire une liste de parcelles qui ne correspond pas a la demande, sans que
 * personne ne puisse s'en apercevoir.
 *
 * La saisie reste donc MANUELLE, et le document est construit pour la rendre mecanique : une ligne
 * par grandeur, dans l'ordre du formulaire, avec l'identifiant en clair. C'est un choix, pas une
 * limite subie, et il est ecrit noir sur blanc dans le document lui-meme.
 */

import {
  AVERTISSEMENTS,
  CRITERES,
  FAMILLES_LIBELLES,
  FILIERES_META,
  PONDERATIONS_DEFAUT,
  REFERENTIEL_DERNIERE_VERIFICATION,
  REGLES,
  SEUILS_RECHERCHE,
  type Filiere,
} from '@enr/core';
import { construireDocx, type Bloc } from './docx.js';

/** Date du jour en francais, pour l'en-tete du document. */
function aujourdHui(): string {
  return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Une ligne « a remplir » : la case est vide, et elle doit le rester. */
const A_REMPLIR = '';

/**
 * Construit le cahier des charges d'une filiere.
 *
 * `criteresCourants` est FACULTATIF et change la nature du document. Sans lui, c'est un formulaire
 * vierge a envoyer. Avec lui — les criteres actuellement regles dans l'outil — c'est le
 * COMPTE RENDU de la recherche qu'on vient de lancer, a joindre aux resultats pour que le
 * developpeur sache exactement ce qui a ete cherche. Les deux usages ont ete demandes, et un seul
 * document sert les deux : seules les cases changent.
 */
export function cahierDesChargesDocx(
  filiere: Filiere,
  criteresCourants?: Record<string, unknown>,
): Buffer {
  const meta = FILIERES_META[filiere];
  const seuils = SEUILS_RECHERCHE[filiere];
  const rempli = criteresCourants != null;
  const blocs: Bloc[] = [];

  // ── En-tete ──────────────────────────────────────────────────────────────
  blocs.push(
    { type: 'titre', texte: `Cahier des charges — ${meta.libelle}` },
    {
      type: 'soustitre',
      texte: rempli
        ? `Critères de la recherche lancée le ${aujourdHui()}`
        : `Formulaire à remplir par le développeur — édité le ${aujourdHui()}`,
    },
    {
      type: 'paragraphe',
      texte: rempli
        ? "Ce document restitue les critères effectivement appliqués à la recherche dont les résultats vous sont remis. Il se complète et se corrige : renvoyez-le annoté pour relancer une recherche."
        : "Remplissez la colonne « Valeur demandée ». Les cases laissées vides ne sont pas filtrées — elles n'écartent rien. Renvoyez ce document : les valeurs seront reportées dans l'outil de recherche, grandeur par grandeur.",
    },
    {
      type: 'paragraphe',
      texte: `Critère déterminant de la filière : ${meta.critereRoi}`,
      petit: true,
    },
  );

  // ── 1. Le projet ─────────────────────────────────────────────────────────
  blocs.push(
    { type: 'section', texte: '1. Le projet recherché' },
    {
      type: 'tableau',
      entetes: ['Information', 'Valeur', 'Précision'],
      largeurs: [32, 28, 40],
      lignes: [
        ['Porteur du projet', A_REMPLIR, 'Société qui portera le développement'],
        ['Filière', meta.libelle, 'Détermine les critères évalués et les règles applicables'],
        ['Puissance visée', A_REMPLIR, 'MWc en solaire, MW en éolien et stockage, Nm³/h en injection'],
        [
          'Surface recherchée',
          A_REMPLIR,
          `Hectares. Repère de la filière : ${meta.surfaceUtileMinHa} ha minimum, ${meta.surfaceUtileOptimaleHa} ha pour la pleine compétitivité`,
        ],
        ['Échéance de mise en service', A_REMPLIR, 'Conditionne la tolérance au délai de raccordement'],
        ['Mode de maîtrise foncière', A_REMPLIR, 'Bail emphytéotique, promesse de bail, acquisition'],
      ],
    },
  );

  // ── 2. Le territoire ─────────────────────────────────────────────────────
  blocs.push(
    { type: 'section', texte: '2. Le territoire à balayer' },
    {
      type: 'paragraphe',
      texte:
        "L'outil balaie un département, plusieurs, ou une région entière. Il ne balaie pas le cadastre : il balaie les parcelles déjà qualifiées. Un territoire jamais qualifié rend « 0 résultat », ce qui ne signifie pas qu'il n'y a rien à y prospecter.",
    },
    {
      type: 'tableau',
      entetes: ['Périmètre', 'Valeur demandée', 'Grandeur dans le logiciel'],
      largeurs: [32, 33, 35],
      lignes: [
        ['Région', valeurCourante(criteresCourants, 'codeRegion'), 'codeRegion'],
        [
          'Départements',
          valeurCourante(criteresCourants, 'codesDepartement'),
          'codesDepartement',
        ],
        ['Commune précise (facultatif)', valeurCourante(criteresCourants, 'codeInsee'), 'codeInsee'],
      ],
    },
  );

  // ── 3. Les seuils ────────────────────────────────────────────────────────
  blocs.push(
    { type: 'section', texte: '3. Les seuils de recherche' },
    {
      type: 'paragraphe',
      texte:
        "Dans l'ordre où ils éliminent. Le premier est le critère roi de la filière. Une case vide n'écarte rien.",
    },
    {
      type: 'tableau',
      entetes: ['Critère', 'Sens', 'Unité', 'Usuel', 'Valeur demandée', 'Grandeur dans le logiciel'],
      largeurs: [30, 8, 12, 8, 14, 28],
      lignes: seuils.map((s) => [
        s.libelle,
        s.sens === 'min' ? 'au moins' : 'au plus',
        s.unite,
        String(s.usuel),
        seuilCourant(criteresCourants, s.chemin, s.sens),
        s.chemin,
      ]),
    },
    { type: 'soussection', texte: 'Ce que chaque seuil décide' },
    ...seuils.map<Bloc>((s) => ({ type: 'puce', texte: `${s.libelle} — ${s.aide}` })),
  );

  // ── 4. Nature du terrain ─────────────────────────────────────────────────
  blocs.push(
    { type: 'sautDePage' },
    { type: 'section', texte: '4. Nature du terrain et urbanisme' },
    {
      type: 'tableau',
      entetes: ['Critère', 'Valeur demandée', 'Précision', 'Grandeur dans le logiciel'],
      largeurs: [26, 20, 30, 24],
      lignes: [
        [
          "Typologie d'implantation",
          valeurCourante(criteresCourants, 'typesSol'),
          filiere === 'solaire_sol'
            ? 'Agrivoltaïsme, terrain dégradé ou artificialisé, terrain inculte, avec défrichement — régime PRÉSUMÉ, déduit de la nature du sol'
            : 'Nature du sol recherchée',
          'typesSol',
        ],
        [
          "Type d'agriculture déclaré",
          valeurCourante(criteresCourants, 'groupesCulture'),
          "Élevage et prairies, grandes cultures, vignes et vergers, maraîchage, gel. D'après la déclaration PAC, qui paraît avec environ deux ans de décalage",
          'groupesCulture',
        ],
        [
          "Uniquement en zone d'accélération (ZAER)",
          valeurCourante(criteresCourants, 'enZaerSeulement'),
          "Oui / non. Toutes les communes n'ont pas délibéré : l'absence de ZAER n'est pas un obstacle",
          'enZaerSeulement',
        ],
        [
          'Zonage du PLU',
          valeurCourante(criteresCourants, 'typesZonePlu'),
          'A, N, U, AUc, AUs. Retient une parcelle qui TOUCHE la zone, même partiellement',
          'typesZonePlu',
        ],
        [
          'Surface minimale par parcelle',
          valeurCourante(criteresCourants, 'surfaceMinHa'),
          'Hectares. Porte sur la PARCELLE cadastrale, pas sur le projet : un projet de 20 ha s’assemble souvent avec plusieurs parcelles plus petites',
          'surfaceMinHa',
        ],
        [
          'Surface maximale par parcelle',
          valeurCourante(criteresCourants, 'surfaceMaxHa'),
          'Hectares',
          'surfaceMaxHa',
        ],
      ],
    },
    { type: 'soussection', texte: 'Exclusions' },
    {
      type: 'tableau',
      entetes: ['Exclure', 'Demandé', 'Grandeur dans le logiciel'],
      largeurs: [46, 18, 36],
      lignes: [
        ['Parcelles rédhibitoires (motif éliminatoire non dérogeable)', valeurCourante(criteresCourants, 'exclureKnockOuts'), 'exclureKnockOuts'],
        ['Recouvrements Natura 2000 (habitats et oiseaux)', valeurCourante(criteresCourants, 'exclureNatura2000'), 'exclureNatura2000'],
        ['Zones humides cartographiées', valeurCourante(criteresCourants, 'exclureZoneHumide'), 'exclureZoneHumide'],
        ['Aires AOP', valeurCourante(criteresCourants, 'exclureAop'), 'exclureAop'],
      ],
    },
  );

  // ── 5. Ce que l'application evalue ───────────────────────────────────────
  const poids = PONDERATIONS_DEFAUT[filiere].poids;
  // La famille est typee comme une union fermee dans `@enr/core` : la carte porte donc ce type,
  // et non `string`, pour que `FAMILLES_LIBELLES` s'indexe sans assertion.
  const parFamille = new Map<keyof typeof FAMILLES_LIBELLES, string[]>();
  for (const id of Object.keys(poids)) {
    const c = CRITERES[id];
    if (!c) continue;
    parFamille.set(c.famille, [...(parFamille.get(c.famille) ?? []), id]);
  }
  blocs.push(
    { type: 'sautDePage' },
    { type: 'section', texte: `5. Les ${Object.keys(poids).length} critères évalués automatiquement` },
    {
      type: 'paragraphe',
      texte:
        "Ils sont notés pour chaque parcelle retenue, et figurent dans le dossier remis avec les résultats. Ils n'ont pas à être renseignés ici : l'application les mesure. Un critère qu'elle ne peut pas mesurer reste GRIS, jamais favorable.",
    },
    ...[...parFamille.entries()].flatMap<Bloc>(([famille, ids]) => [
      { type: 'soussection', texte: FAMILLES_LIBELLES[famille] },
      {
        type: 'tableau',
        entetes: ['Critère', 'Unité', 'Poids', 'Ce qu’il mesure'],
        largeurs: [24, 12, 8, 56],
        lignes: ids.map((id) => {
          const c = CRITERES[id]!;
          return [c.libelle, c.unite ?? '—', String(poids[id] ?? 0), c.explication];
        }),
      },
    ]),
  );

  // ── 6. Le cadre reglementaire ────────────────────────────────────────────
  const reglesFiliere = Object.values(REGLES[filiere] ?? {});
  const reglesCommunes = Object.values(REGLES['commun'] ?? {});
  const toutes = [...reglesFiliere, ...reglesCommunes];
  const aValider = toutes.filter((r) => r.aValiderParJuriste);
  blocs.push(
    { type: 'sautDePage' },
    { type: 'section', texte: `6. Le cadre réglementaire appliqué (${toutes.length} règles)` },
    {
      type: 'paragraphe',
      texte: `Référentiel vérifié le ${REFERENTIEL_DERNIERE_VERIFICATION}. Chaque règle porte sa référence, sa date d'entrée en vigueur et le lien vers le texte.`,
    },
    {
      type: 'paragraphe',
      gras: true,
      texte: `${aValider.length} de ces ${toutes.length} règles n'ont pas encore été validées par un juriste. Elles sont signalées « à valider » ci-dessous et ne doivent pas être opposées telles quelles.`,
    },
    { type: 'soussection', texte: `Propres à la filière (${reglesFiliere.length})` },
    { type: 'tableau', entetes: ['Règle', 'Référence', 'En vigueur', 'À valider'], largeurs: [30, 42, 14, 14], lignes: reglesFiliere.map(ligneRegle) },
    { type: 'soussection', texte: `Communes à toutes les filières (${reglesCommunes.length})` },
    { type: 'tableau', entetes: ['Règle', 'Référence', 'En vigueur', 'À valider'], largeurs: [30, 42, 14, 14], lignes: reglesCommunes.map(ligneRegle) },
  );

  // ── 7. Les limites, dites ici et pas en note de bas de page ──────────────
  blocs.push(
    { type: 'sautDePage' },
    { type: 'section', texte: '7. Ce que cet outil ne sait pas' },
    {
      type: 'paragraphe',
      texte:
        "Cette section n'est pas une clause de style. Elle liste ce que l'application ne mesure pas, pour qu'aucun silence ne passe pour une absence d'enjeu.",
    },
    ...AVERTISSEMENTS.map<Bloc>((a) => ({ type: 'puce', texte: `${a.titre} — ${a.texte}` })),
    { type: 'soussection', texte: 'Sur la réutilisation de ce document' },
    {
      type: 'puce',
      texte:
        "Ce cahier des charges ne se réimporte pas automatiquement : les valeurs sont reportées à la main dans l'outil. La colonne « Grandeur dans le logiciel » donne le nom exact de chaque critère pour que le report soit une recopie et non une traduction.",
    },
    {
      type: 'puce',
      texte:
        "Les scores sont une aide à la priorisation, pas une garantie de faisabilité. Le contour cadastral est indicatif et sans valeur juridique.",
    },
  );

  return construireDocx(`Cahier des charges — ${meta.libelle}`, blocs);
}

function ligneRegle(r: {
  libelle: string;
  reference: string;
  dateEntreeEnVigueur: string;
  aValiderParJuriste?: boolean;
}): string[] {
  return [
    r.libelle,
    r.reference,
    // Le format francais : une date ISO dans un document remis a un tiers se lit mal, et le
    // reste du depot l'interdit deja dans les exports.
    r.dateEntreeEnVigueur.split('-').reverse().join('/'),
    r.aValiderParJuriste ? 'à valider' : '',
  ];
}

/**
 * La valeur actuellement reglee pour un critere, ou une case vide.
 *
 * VIDE PLUTOT QUE « — » OU « non renseigne » : la case doit rester REMPLISSABLE. Un tiret invite
 * a ecrire a cote, et « non renseigne » se confond avec une reponse.
 */
function valeurCourante(criteres: Record<string, unknown> | undefined, cle: string): string {
  const v = criteres?.[cle];
  if (v === undefined || v === null) return A_REMPLIR;
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : A_REMPLIR;
  if (typeof v === 'boolean') return v ? 'oui' : A_REMPLIR;
  return String(v);
}

/** Le seuil actuellement regle pour une grandeur, dans le sens attendu. */
function seuilCourant(
  criteres: Record<string, unknown> | undefined,
  chemin: string,
  sens: 'min' | 'max',
): string {
  const liste = criteres?.['seuils'];
  if (!Array.isArray(liste)) return A_REMPLIR;
  const s = liste.find(
    (x) => x != null && typeof x === 'object' && (x as { chemin?: unknown }).chemin === chemin,
  ) as { min?: number; max?: number } | undefined;
  const v = sens === 'min' ? s?.min : s?.max;
  return v == null ? A_REMPLIR : String(v);
}
