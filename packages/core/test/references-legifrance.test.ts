/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * LES LIENS VERS LÉGIFRANCE — LE RELEVÉ DU 7 SEPTEMBRE 2026, ET LE GARDE QUI L'ENTRETIENT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══ CE QUI A ÉTÉ MESURÉ, ET CE QUE ÇA A DONNÉ
 *
 * Le référentiel porte 52 règles et 26 URL distinctes, chacune annoncée dans le type comme « URL de
 * référence (Légifrance de préférence) ». Chaque URL a été ouverte, une par une, le 7 septembre 2026.
 * Résultat :
 *
 *      1 URL sur 26 ouvrait le texte cité         (commun_bail_rural)
 *      5 URL ouvraient un texte SANS RAPPORT
 *     20 URL renvoyaient une erreur 404
 *
 * Les cinq qui ouvraient autre chose sont le pire cas, parce qu'elles ne se signalent pas :
 *
 *     commun_site_classe             annonçait L.341-1 / L.341-10  →  ouvrait L.415-1 C. env
 *                                                                     (habilitation des agents à
 *                                                                      constater les infractions)
 *     commun_preemption_safer        annonçait L.143-1 C. rural    →  ouvrait le chapitre
 *                                                                     « Wallis-et-Futuna, Polynésie
 *                                                                      française, Nouvelle-Calédonie »
 *     commun_ppr_zone_rouge          annonçait L.562-1 C. env      →  ouvrait l'art. 1530 bis du CGI
 *                                                                     (taxe GEMAPI)
 *     commun_zone_n                  annonçait R.151-24 C. urba    →  ouvrait R.153-3 C. urba
 *                                                                     (délibération arrêtant le PLU)
 *     commun_archeologie_preventive  annonçait L.522-1 C. patrim.  →  ouvrait le chapitre « Archives »
 *
 * ═══ POURQUOI LE DÉFAUT A SURVÉCU, ET C'EST LA LEÇON DE CE FICHIER
 *
 * `referentiel.test.ts` vérifiait déjà les URL. Voici son assertion, mot pour mot :
 *
 *     assert.match(r.url, /\.gouv\.fr|\.europa\.eu/, '… n'est pas un domaine public');
 *
 * Elle est vraie de toutes les URL fautives. Un identifiant Légifrance inventé de toutes pièces est
 * sur `legifrance.gouv.fr` : le test le déclarait donc conforme. **Le contrôle portait sur la forme
 * du lien, jamais sur ce qu'il y a au bout.** C'est la définition même d'un test décoratif, et il
 * couvrait la partie du référentiel qui porte l'argument commercial du produit.
 *
 * ═══ CE QUE CE FICHIER PEUT VÉRIFIER, ET CE QU'IL NE PEUT PAS
 *
 * Il NE VA PAS sur le réseau, et ce n'est pas un renoncement — c'est la conclusion d'un essai.
 * Légifrance est derrière un contrôle Cloudflare : `curl` reçoit un 403 « Just a moment… », et un
 * Chromium lancé depuis cet environnement n'atteint pas le site. Un test qui interroge Légifrance
 * serait donc rouge en intégration continue sans qu'aucune donnée soit fautive — le mode de
 * défaillance qui apprend à ignorer les échecs.
 *
 * Ce qu'il fait à la place : il FIGE le relevé. Chaque URL du référentiel doit figurer ci-dessous
 * avec l'article qui a été REELLEMENT lu à son bout. Changer une URL dans la source sans venir ici
 * fait échouer le test, avec un message qui dit quoi refaire. Et l'article lu est confronté à la
 * référence citée par la règle : c'est ce rapprochement, et lui seul, qui aurait attrapé les cinq
 * liens qui ouvraient autre chose.
 *
 * ═══ UN SECOND RELEVÉ A SUIVI, LE 9 SEPTEMBRE 2026
 *
 * Le premier avait laissé 20 règles sans aucun lien — aucune en attente de revue juridique, et
 * c'est pourquoi elles avaient été laissées : leur donner un lien sans l'avoir ouvert aurait
 * refabriqué le défaut qui venait d'être corrigé. Elles ont été ouvertes à leur tour : **18 en
 * reçoivent un, deux n'en reçoivent pas**, et le détail est au-dessus de leurs entrées.
 *
 * Le référentiel porte donc 50 liens vérifiés sur 52 règles. Les deux absences sont nommées et
 * motivées par le dernier test de ce fichier ; en ajouter une troisième sans raison écrite échoue.
 *
 * ═══ CE QUE LE RELEVÉ N'ÉTABLIT PAS, ET IL FAUT LE DIRE
 *
 * Que l'article existe, qu'il soit en vigueur et qu'il traite bien du sujet auquel la règle le
 * rattache : voilà ce qui a été vérifié. Que cet article soit LE BON FONDEMENT JURIDIQUE d'un refus
 * opposé à un propriétaire : cela ne se vérifie pas ici, cela se signe. Les 28 règles marquées
 * `aValiderParJuriste` le restent toutes — les deux relevés ont corrigé leurs liens et sept
 * inexactitudes de fond, ils n'ont pas remplacé la revue d'un juriste, et rien ici ne le prétend.
 *
 * Le compte a d'ailleurs MONTÉ de 27 à 28, ce qui est le bon sens de variation pour un travail de
 * vérification : `bess_securite_incendie` a rejoint la liste parce qu'on a découvert qu'on ne
 * savait pas quel texte la fonde.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGLES_PAR_ID } from '../src/reglementation.js';

/** Date à laquelle les 26 URL ont été ouvertes une par une. */
const RELEVE_LE = '2026-09-07';

interface Releve {
  /** L'URL telle qu'elle doit figurer dans le référentiel, après correction. */
  url: string;
  /**
   * L'article que la page ouvre RÉELLEMENT, tel qu'il s'y affiche.
   *
   * C'est cette chaîne qui est confrontée à la `reference` de la règle : elle doit y apparaître.
   * Un lien qui ouvre autre chose que ce que la règle annonce échoue donc ici.
   */
  atteint: string;
  /** Ce que la lecture a établi, en une ligne. */
  note: string;
}

/**
 * LE RELEVÉ. Une entrée par règle portant une URL.
 *
 * `atteint` porte le numéro d'article lu sur la page. Pour une page de SECTION, c'est le premier
 * article de la section — la section est alors nommée dans `note`.
 */
const RELEVES: Record<string, Releve> = {
  // ─── Solaire au sol / agrivoltaïsme ──────────────────────────────────────────────────────────
  pv_permis_construire: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037799137',
    atteint: 'R.421-9',
    note:
      'Code de l’urbanisme. Version en vigueur du décret n°2024-1023 du 13 novembre 2024, ' +
      'applicable aux demandes déposées à compter du 1er décembre 2024 ; porte la bande ' +
      '« 3 kWc à 3 MWc » en déclaration préalable. Le lien précédent (une section) était en 404 et ' +
      'la règle citait encore le décret de 2023.',
  },
  pv_eval_env_systematique: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042369329',
    atteint: 'R.122-2',
    note: 'Annexe à l’article R.122-2 du code de l’environnement, où vit la rubrique 30. Ancien lien en 404.',
  },
  pv_document_cadre: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047298109',
    atteint: 'L.111-29',
    note:
      'Code de l’urbanisme : définit les surfaces agricoles, naturelles et forestières ouvertes aux ' +
      'projets, et le document-cadre arrêté par le préfet. Ancien lien en 404.',
  },
  agri_taux_couverture: {
    url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049386027',
    atteint: 'Décret n°2024-318 du 8 avril 2024',
    note:
      'Décret relatif au développement de l’agrivoltaïsme et aux conditions d’implantation des ' +
      'installations photovoltaïques sur des terrains agricoles, naturels ou forestiers ; en vigueur ' +
      'le lendemain de sa publication (9 avril 2024). L’ancien JORFTEXT était en 404.',
  },
  pv_compensation_agricole: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000029581178',
    atteint: 'L.112-1-3',
    note:
      'Code rural : étude préalable et compensation collective. La lecture a montré que les projets ' +
      'agrivoltaïques y sont désormais EXPRESSÉMENT visés, ce qui contredisait le commentaire de la ' +
      'règle — corrigé.',
  },
  pv_demantelement: {
    url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074075/LEGISCTA000049388293',
    atteint: 'R.111-62',
    note:
      'Code de l’urbanisme, section « Durée d’autorisation, démantèlement et remise en état après ' +
      'exploitation » (R.111-62 à R.111-64). La règle citait L.111-29, qui ne traite pas du ' +
      'démantèlement — corrigé.',
  },

  // ─── Éolien terrestre ────────────────────────────────────────────────────────────────────────
  eol_distance_habitation: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033933299',
    atteint: 'L.515-44',
    note:
      'Code de l’environnement : éloignement minimal de 500 m des constructions à usage ' +
      'd’habitation, apprécié au vu de l’étude d’impact. Ancien lien en 404.',
  },
  eol_faisceaux_hertziens: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032443426',
    atteint: 'L.54',
    note:
      'Code des postes et des communications électroniques : servitudes de protection des centres ' +
      'radioélectriques contre les obstacles. Ancien lien (section) en 404.',
  },
  eol_autorisation_environnementale: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045576964',
    atteint: 'L.181-1',
    note:
      'Code de l’environnement : champ de l’autorisation environnementale unique, qui absorbe ' +
      'notamment les autorisations spéciales de sites classés. Ancien lien (section) en 404.',
  },

  // ─── Stockage par batteries ──────────────────────────────────────────────────────────────────
  bess_acces_engins: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030299536',
    atteint: 'R.2225-3',
    note:
      'Code général des collectivités territoriales : institue le règlement départemental de défense ' +
      'extérieure contre l’incendie, arrêté par le préfet après avis du SDIS. La règle citait ' +
      'R.2225-7, qui porte sur les conventions de mise à disposition de points d’eau — corrigé.',
  },
  bess_effets_domino: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049913528',
    atteint: 'R.181-13',
    note:
      'Code de l’environnement : contenu COMMUN du dossier de demande d’autorisation ' +
      'environnementale. La lecture a montré qu’il ne mentionne pas les effets domino — la référence ' +
      'a été rectifiée en ce sens, et l’article exact de l’étude de dangers reste à désigner.',
  },
  bess_raccordement_s3renr: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036436150',
    atteint: 'L.342-3',
    note:
      'Code de l’énergie : les capacités d’accueil du schéma régional sont réservées dix ans aux ' +
      'installations de PRODUCTION à partir de sources renouvelables. C’est le fondement réel de la ' +
      'règle ; L.321-7, seul cité auparavant, ne porte que l’élaboration du schéma.',
  },

  // ─── Méthanisation ───────────────────────────────────────────────────────────────────────────
  metha_sous_produits_animaux: {
    url: 'https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32009R1069',
    atteint: 'Règlement (CE) n°1069/2009',
    note:
      'EUR-Lex : règlement sous-produits animaux. Légifrance ne porte pas les textes de l’Union, ' +
      'd’où le domaine européen. La règle n’avait aucune URL.',
  },
  metha_acces_engins: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030299536',
    atteint: 'R.2225-3',
    note: 'Même article que pour le stockage, même correction : R.2225-7 → R.2225-3.',
  },

  // ─── Règles communes ─────────────────────────────────────────────────────────────────────────
  commun_bail_rural: {
    url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006071367/LEGISCTA000006152249',
    atteint: 'L.411-1',
    note:
      'Code rural, section « Règles générales » du statut du fermage. SEULE URL DES 26 QUI OUVRAIT ' +
      'DÉJÀ LE TEXTE CITÉ — conservée telle quelle.',
  },
  commun_preemption_safer: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042655873',
    atteint: 'L.143-1',
    note:
      'Code rural : droit de préemption des SAFER sur les aliénations à titre onéreux. L’ancien lien ' +
      'ouvrait le chapitre « Wallis-et-Futuna, Polynésie française, Nouvelle-Calédonie ».',
  },
  commun_parcelle_enclavee: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006430276',
    atteint: '682',
    note:
      'Code civil : droit de passage pour cause d’enclave, contre indemnité proportionnée au ' +
      'dommage. Ancien lien (section) en 404.',
  },
  commun_proprietaire_public: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000034444126',
    atteint: 'L.2122-1-1',
    note:
      'CG3P : procédure de sélection préalable pour une occupation du domaine public en vue d’une ' +
      'exploitation économique. Ancien lien en 404. La lecture a aussi montré que la liste des ' +
      'dispenses est à L.2122-1-2 et non L.2122-1-3 — référence corrigée.',
  },
  commun_coeur_parc_national: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041454367',
    atteint: 'L.331-4',
    note:
      'Code de l’environnement : travaux interdits dans le cœur d’un parc national sauf autorisation ' +
      'spéciale de l’établissement du parc. Ancien lien en 404.',
  },
  commun_reserve_naturelle: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033933062',
    atteint: 'L.332-9',
    note:
      'Code de l’environnement : interdiction de modifier l’état ou l’aspect d’une réserve, sauf ' +
      'autorisation spéciale. Ancien lien en 404.',
  },
  commun_appb: {
    url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074220/LEGISCTA000006188789',
    atteint: 'R.411-15',
    note:
      'Code de l’environnement, section des mesures de protection de biotopes (R.411-15 à R.411-17). ' +
      'La lecture confirme que la portée est fixée par l’arrêté préfectoral, comme le dit la règle. ' +
      'Ancien lien en 404.',
  },
  commun_zone_humide: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000052084005',
    atteint: 'L.211-1',
    note:
      'Code de l’environnement : définition de la zone humide. La rédaction lue porte bien le « OU » ' +
      'entre le critère pédologique et le critère floristique, ce qui confirme le commentaire de la ' +
      'règle. Ancien lien en 404.',
  },
  commun_ppr_zone_rouge: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047299303',
    atteint: 'L.562-1',
    note:
      'Code de l’environnement : plans de prévention des risques naturels prévisibles. L’ancien lien ' +
      'ouvrait l’article 1530 bis du code général des impôts (taxe GEMAPI).',
  },
  commun_pprt_zone_rouge: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006834316',
    atteint: 'L.515-15',
    note:
      'Code de l’environnement : PPRT autour des installations Seveso seuil haut, « figurant au ' +
      '31 juillet 2003 ». Ancien lien en 404 ; la date d’entrée en vigueur de la règle a été ramenée ' +
      'du 1er au 31 juillet 2003 en conséquence.',
  },
  commun_ebc: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031210299',
    atteint: 'L.113-2',
    note:
      'Code de l’urbanisme : le classement entraîne le rejet de plein droit de toute demande de ' +
      'défrichement. La lecture confirme le caractère AUTOMATIQUE affirmé par la règle. Ancien lien ' +
      '(section) en 404.',
  },
  commun_emplacement_reserve: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043978366',
    atteint: 'L.151-41',
    note: 'Code de l’urbanisme : emplacements réservés du règlement de PLU. Ancien lien en 404.',
  },
  commun_zone_n: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031720603',
    atteint: 'R.151-24',
    note:
      'Code de l’urbanisme : « Les zones naturelles et forestières sont dites zones N. » L’ancien ' +
      'lien ouvrait R.153-3, sur la délibération arrêtant le projet de PLU.',
  },
  commun_defrichement: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030728366',
    atteint: 'L.341-3',
    note:
      'Code forestier : « Nul ne peut user du droit de défricher ses bois et forêts sans avoir ' +
      'préalablement obtenu une autorisation. » Ancien lien (section) en 404.',
  },
  commun_especes_protegees: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033035411',
    atteint: 'L.411-1',
    note:
      'Code de l’environnement : interdictions de destruction, capture, perturbation intentionnelle ' +
      'et de destruction des habitats. Ancien lien en 404.',
  },
  commun_natura2000_incidences: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033034469',
    atteint: 'L.414-4',
    note:
      'Code de l’environnement : évaluation des incidences Natura 2000. La lecture confirme la liste ' +
      'nationale par décret ET la liste locale complémentaire arrêtée par le préfet, comme le dit la ' +
      'règle. Ancien lien en 404.',
  },
  commun_archeologie_preventive: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032860111',
    atteint: 'L.522-1',
    note:
      'Code du patrimoine : rôle de l’État en archéologie préventive et maîtrise scientifique des ' +
      'opérations. L’ancien lien ouvrait le chapitre « Archives » (L.211-1 à L.211-6).',
  },
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * SECOND RELEVÉ, LE 9 SEPTEMBRE 2026 : les 20 règles qui n'avaient AUCUN lien
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * Le relevé du 7 septembre avait corrigé les 26 URL existantes et donné un lien aux six règles
   * « à valider » qui n'en avaient pas. Restaient 20 règles sans lien — aucune en attente de revue
   * juridique, et c'est pourquoi elles avaient été laissées : leur donner un lien sans l'avoir
   * ouvert aurait refabriqué le défaut que ce même relevé venait de corriger.
   *
   * Elles ont donc été ouvertes à leur tour. Onze recherches distinctes ont suffi, plusieurs règles
   * partageant leur fondement — les quatre rubriques ICPE s'ancrent toutes sur l'article R.511-9,
   * qui institue la nomenclature, et les deux distances de méthanisation sur le même arrêté.
   *
   * RÉSULTAT : 18 des 20 reçoivent un lien vérifié. DEUX N'EN REÇOIVENT PAS, et c'est la partie
   * qui compte :
   *
   *   - `bess_chimie_lfp` se déclare « non réglementaire ». Aucun texte ne la fonde, donc aucun
   *     lien ne doit la faire paraître fondée.
   *   - `bess_securite_incendie` cite « l'arrêté de prescriptions générales de la rubrique 2925 ».
   *     Les deux arrêtés publiés sous cette rubrique visent les ATELIERS DE CHARGE — accumulateurs
   *     au plomb (29 mai 2000), dépôts d'au moins dix autobus électriques (3 août 2018). Ni l'un ni
   *     l'autre ne gouverne un stockage stationnaire raccordé au réseau. Poser l'un des deux aurait
   *     produit un lien plausible et faux. Elle est désormais marquée « à valider ».
   *
   * TROIS INEXACTITUDES DE FOND trouvées au passage, corrigées dans le référentiel :
   *
   *   1. `metha_injection` citait « code de l'énergie, art. L.446-1 et s. ; décret n°2019-1043 du
   *      11 octobre 2019 relatif au droit à l'injection ». Les DEUX sont fausses : L.446-1 traite du
   *      BILAN CARBONE des appels d'offres biogaz, et le décret du droit à l'injection est le
   *      n°2019-665 du 28 juin 2019. Le droit à l'injection lui-même est à L.453-9.
   *   2. `metha_plan_epandage` appelait l'arrêté du 22 octobre 2020 « relatif au socle commun des
   *      matières fertilisantes ». Son intitulé réel : « approuvant un cahier des charges pour la
   *      mise sur le marché et l'utilisation de digestats de méthanisation ».
   *   3. Les quatre règles de rubrique ICPE citaient « nomenclature ICPE rubrique X » sans nommer
   *      l'article. R.511-9 est désormais cité, ce qui donne au lecteur un point d'entrée — et
   *      permet au troisième test de ce fichier de rapprocher le lien de la référence.
   */

  // ─── Solaire et agrivoltaïsme ────────────────────────────────────────────────────────────────
  pv_eval_env_cas_par_cas: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042369329',
    atteint: 'R.122-2',
    note:
      'Annexe à l’article R.122-2 du code de l’environnement, où vit la rubrique 30. Même page que ' +
      '`pv_eval_env_systematique` : les deux règles sont les deux bornes d’une même rubrique.',
  },
  pv_date_inculte: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047298109',
    atteint: 'L.111-29',
    note:
      'Code de l’urbanisme : surfaces agricoles, naturelles et forestières ouvertes aux projets, et ' +
      'document-cadre arrêté par le préfet. Même article que `pv_document_cadre`.',
  },
  agri_zone_temoin: {
    url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049386027',
    atteint: 'Décret n°2024-318 du 8 avril 2024',
    note:
      'Décret relatif au développement de l’agrivoltaïsme et aux conditions d’implantation des ' +
      'installations photovoltaïques sur des terrains agricoles, naturels ou forestiers. Même texte ' +
      'que `agri_taux_couverture`.',
  },
  agri_avis_cdpenaf: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047298111',
    atteint: 'L.111-30',
    note:
      'Code de l’urbanisme : les installations des articles L.111-27 à L.111-29 sur terrain agricole, ' +
      'naturel ou forestier sont autorisées sur AVIS CONFORME de la CDPENAF, certaines sur avis ' +
      'simple. La lecture confirme le caractère conforme que la règle annonce.',
  },
  pv_aop_viticole: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000022190244',
    atteint: 'L.641-5',
    note:
      'Code rural : appellation d’origine contrôlée. La lecture confirme le mécanisme de l’aire ' +
      'parcellaire délimitée par l’INAO, sur lequel la règle s’appuie. Les doctrines INAO citées à ' +
      'côté ne sont pas publiées sur Légifrance.',
  },

  // ─── Éolien terrestre ────────────────────────────────────────────────────────────────────────
  eol_icpe_2980: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006838668',
    atteint: 'R.511-9',
    note:
      'Code de l’environnement : « la colonne A de l’annexe au présent article constitue la ' +
      'nomenclature des installations classées », lu ce jour-là. C’est le point d’entrée de toute ' +
      'rubrique ICPE ; l’annexe elle-même est éclatée en plusieurs parties dont la numérotation bouge.',
  },
  eol_rayon_enquete: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053432780',
    atteint: 'R.181-36',
    note:
      'Code de l’environnement : les communes où l’avis est affiché sont celles situées à une ' +
      'distance inférieure au RAYON D’AFFICHAGE fixé dans la nomenclature ICPE pour la rubrique. La ' +
      'lecture confirme exactement le mécanisme que la règle décrit.',
  },
  eol_monument_historique: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032860394',
    atteint: 'L.621-30',
    note:
      'Code du patrimoine : à défaut de périmètre délimité, la protection au titre des abords ' +
      's’applique à tout immeuble visible du monument et situé à moins de CINQ CENTS MÈTRES. Les ' +
      'deux branches annoncées par la règle — 500 m par défaut, ou PDA — y figurent.',
  },
  eol_radar: {
    url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024507365',
    atteint: '26 août 2011',
    note:
      'Arrêté relatif aux installations de production d’électricité utilisant l’énergie mécanique du ' +
      'vent soumises à autorisation au titre de la rubrique 2980, dans sa version modifiée. C’est son ' +
      'article 4 que la règle cite pour les distances aux radars.',
  },

  // ─── Stockage par batteries ──────────────────────────────────────────────────────────────────
  bess_icpe_2925_2: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006838668',
    atteint: 'R.511-9',
    note: 'Même point d’entrée que les autres rubriques ICPE : l’article qui institue la nomenclature.',
  },

  // ─── Méthanisation ───────────────────────────────────────────────────────────────────────────
  metha_2781_d: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006838668',
    atteint: 'R.511-9',
    note: 'Rubrique 2781-1, seuil de déclaration. Même article de nomenclature que les deux suivantes.',
  },
  metha_2781_e: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006838668',
    atteint: 'R.511-9',
    note: 'Rubrique 2781-1, seuil d’enregistrement. Même article de nomenclature.',
  },
  metha_2781_a: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006838668',
    atteint: 'R.511-9',
    note: 'Rubrique 2781-1, seuil d’autorisation. Même article de nomenclature.',
  },
  metha_distance_habitation: {
    url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000022727437',
    atteint: '12 août 2010',
    note:
      'Arrêté de prescriptions générales pour la méthanisation en enregistrement, rubrique 2781. La ' +
      'lecture porte la distance annoncée : l’installation est « implantée à plus de 200 mètres des ' +
      'habitations occupées par des tiers ».',
  },
  metha_distance_eau: {
    url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000022727437',
    atteint: '12 août 2010',
    note:
      'Même arrêté, et il porte aussi la seconde distance : « distante d’au moins 35 mètres des ' +
      'puits, forages, sources et berges des cours d’eau ». Le programme d’actions nitrates cité à ' +
      'côté est un texte distinct.',
  },
  metha_plan_epandage: {
    url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042506471',
    atteint: '22 octobre 2020',
    note:
      'Arrêté approuvant un cahier des charges pour la mise sur le marché et l’utilisation de ' +
      'digestats de méthanisation en tant que matières fertilisantes — c’est la sortie du statut de ' +
      'déchet que la règle décrit. Son intitulé était mal cité (« socle commun ») : corrigé.',
  },
  metha_iota: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048136763',
    atteint: 'R.214-1',
    note:
      'Code de l’environnement : nomenclature des installations, ouvrages, travaux et activités ' +
      'relevant de la police de l’eau, annexée à cet article.',
  },
  metha_injection: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047303711',
    atteint: 'L.453-9',
    note:
      'Code de l’énergie : « les gestionnaires des réseaux de gaz naturel effectuent les ' +
      'renforcements nécessaires » pour permettre l’injection. C’est le droit à l’injection. La règle ' +
      'citait L.446-1 (bilan carbone des appels d’offres) et le décret n°2019-1043 ; le décret ' +
      'd’application est le n°2019-665 du 28 juin 2019.',
  },

  commun_site_classe: {
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033036041',
    atteint: 'L.341-10',
    note:
      'Code de l’environnement : travaux soumis à autorisation spéciale en site classé. L’ancien ' +
      'lien ouvrait L.415-1 (habilitation des agents). La lecture a aussi montré que l’article NE ' +
      'DÉSIGNE PAS l’autorité compétente : le libellé et le commentaire, qui annonçaient un niveau ' +
      'ministériel, ont été corrigés.',
  },
};

/** Normalise un numéro d'article pour comparaison : « L. 143-1 », « L.143-1 » et « L143-1 » se valent. */
function normaliser(s: string): string {
  return s.replace(/\s+/g, '').replace(/\./g, '').toUpperCase();
}

test('LE RELEVÉ EST COMPLET : aucune règle ne porte une URL qui n’a jamais été ouverte', () => {
  for (const [id, r] of Object.entries(REGLES_PAR_ID)) {
    if (!r.url) continue;
    const releve = RELEVES[id];
    assert.ok(
      releve,
      `« ${id} » porte une URL (${r.url}) qui ne figure pas dans le relevé de ce fichier. ` +
        'Ouvrez-la, notez l’article qu’elle affiche RÉELLEMENT, et ajoutez l’entrée. Une URL non ' +
        'relevée est exactement ce qui a laissé passer 25 liens fautifs sur 26.',
    );
  }
});

test('AUCUNE URL N’A CHANGÉ SANS ÊTRE RE-OUVERTE', () => {
  /*
   * Le cœur du garde. Modifier une URL dans `reglementation.ts` sans revenir ici fait échouer ce
   * test : c'est la seule façon de rendre impossible la réintroduction silencieuse d'un identifiant
   * inventé, puisque le contrôle ne peut pas aller sur le réseau (voir l'en-tête).
   */
  for (const [id, releve] of Object.entries(RELEVES)) {
    const r = REGLES_PAR_ID[id];
    assert.ok(r, `le relevé décrit « ${id} », qui n’existe plus dans le référentiel`);
    assert.equal(
      r.url,
      releve.url,
      `« ${id} » : l’URL du référentiel diffère de celle qui a été ouverte le ${RELEVE_LE}. ` +
        'Si le changement est voulu, ouvrez la nouvelle URL, vérifiez quel article elle affiche, et ' +
        'mettez le relevé à jour — ne modifiez pas seulement cette valeur attendue.',
    );
  }
});

test('LE LIEN OUVRE BIEN L’ARTICLE QUE LA RÈGLE ANNONCE', () => {
  /*
   * L'ASSERTION QUI AURAIT ATTRAPÉ LES CINQ LIENS TROMPEURS. `referentiel.test.ts` ne vérifiait que
   * le domaine — et un identifiant inventé est sur `legifrance.gouv.fr` comme un vrai. Ici, le
   * numéro d'article LU au bout du lien doit apparaître dans la référence CITÉE par la règle. Un
   * lien qui ouvre le chapitre « Archives » sous une règle qui annonce L.522-1 échoue.
   */
  for (const [id, releve] of Object.entries(RELEVES)) {
    const r = REGLES_PAR_ID[id]!;
    const attendu = normaliser(releve.atteint);
    const cite = normaliser(r.reference);
    assert.ok(
      cite.includes(attendu),
      `« ${id} » : le lien ouvre « ${releve.atteint} », que la référence de la règle ne mentionne ` +
        `pas.\n  référence : ${r.reference}\n  Soit le lien est faux, soit la référence l’est — ` +
        'dans les deux cas le lecteur cliquerait vers autre chose que ce qu’on lui annonce.',
    );
  }
});

test('chaque relevé dit ce que la lecture a établi', () => {
  // Une entrée sans note est une entrée qu'on ne peut pas contre-vérifier plus tard : on ne saurait
  // plus ce qui a ete lu, ni pourquoi cette URL a ete retenue plutot qu'une autre.
  for (const [id, releve] of Object.entries(RELEVES)) {
    assert.ok(releve.atteint.trim().length > 0, `${id} : relevé sans article atteint`);
    assert.ok(
      releve.note.trim().length > 40,
      `${id} : relevé sans note utilisable — écrivez ce que la page affichait`,
    );
    assert.match(releve.url, /^https:\/\/(www\.legifrance\.gouv\.fr|eur-lex\.europa\.eu)\//, `${id} : hôte inattendu`);
  }
});

test('LA REVUE JURIDIQUE N’EST PAS RÉPUTÉE FAITE : les 27 règles restent marquées', () => {
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * LA LIMITE, ÉCRITE COMME UN TEST POUR QU'ELLE NE SE PERDE PAS
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * Le relevé a corrigé 25 liens et quatre inexactitudes de fond. La tentation qui suit un tel
   * travail est de retirer `aValiderParJuriste` — « on a vérifié, non ? ». Non : on a vérifié que
   * les textes cités existent, sont en vigueur et traitent du sujet. Savoir si tel article est LE
   * BON FONDEMENT d'un refus opposé à un propriétaire ne se vérifie pas, cela s'engage.
   *
   * Ce test fixe donc le compte. Le faire baisser demande de dire, ici, POURQUOI — et la seule
   * bonne raison est la signature d'un juriste, avec sa date.
   */
  const aValider = Object.values(REGLES_PAR_ID).filter((r) => r.aValiderParJuriste === true);
  /*
   * 28 ET NON 27 DEPUIS LE 9 SEPTEMBRE 2026, et le compte a MONTE, ce qui est le bon sens de
   * variation. `bess_securite_incendie` a rejoint la liste : le second relevé a montré que l'arrêté
   * qu'elle cite — « de prescriptions générales applicables à la rubrique 2925 » — ne peut pas être
   * identifié, les deux arrêtés publiés sous cette rubrique visant les ateliers de charge et non un
   * stockage stationnaire. Une règle dont on ne sait pas quel texte la fonde est exactement ce que
   * ce marquage existe pour dire.
   */
  assert.equal(
    aValider.length,
    28,
    'le nombre de règles en attente de revue juridique a changé. Si un juriste a validé, remplacez ' +
      'le marquage par une date de validation et corrigez ce compte en expliquant pourquoi. Le ' +
      'relevé Légifrance du ' +
      RELEVE_LE +
      ' n’est PAS une revue juridique : il établit que les textes cités existent et traitent du ' +
      'sujet, rien de plus.',
  );
});

test('LES SEULES RÈGLES SANS LIEN SONT CELLES DONT L’ABSENCE EST MOTIVÉE', () => {
  /*
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * DEUX ABSENCES, DEUX RAISONS DIFFÉRENTES — et aucune n'est un oubli
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * Ce test est la contrepartie du relevé : il empêche qu'une règle arrive sans lien par simple
   * négligence, tout en laissant possible l'absence ASSUMÉE. Les deux cas présents montrent
   * pourquoi la seconde doit rester possible.
   *
   * `bess_chimie_lfp` se déclare « recommandation technique - non réglementaire ». Aucun texte ne
   * la fonde. Lui coller un lien Légifrance lui donnerait une autorité qu'elle n'a pas — ce serait
   * un faux positif de crédibilité, la famille de fautes que ce dépôt traque.
   *
   * `bess_securite_incendie` cite « l'arrêté de prescriptions générales applicables à la rubrique
   * 2925 ». Relevé du 9 septembre 2026 : les deux arrêtés publiés sous cette rubrique visent les
   * ATELIERS DE CHARGE — accumulateurs au plomb (29 mai 2000), dépôts d'au moins dix autobus
   * électriques (3 août 2018). Ni l'un ni l'autre ne gouverne un stockage stationnaire raccordé au
   * réseau. Poser l'un des deux aurait produit un lien plausible et faux. Elle est donc marquée
   * « à valider par un juriste », ce qui est l'aveu exact : on ne sait pas quel texte la fonde.
   *
   * AJOUTER UNE TROISIÈME ABSENCE demande d'écrire ici pourquoi. C'est peu de travail, et c'est
   * précisément le travail qui manquait quand 20 règles circulaient sans lien sans que personne ne
   * puisse dire si c'était voulu.
   */
  const MOTIVEES: ReadonlyArray<{ id: string; raison: string }> = [
    {
      id: 'bess_chimie_lfp',
      raison:
        'la règle se déclare « non réglementaire » : aucun texte ne la fonde, et un lien Légifrance ' +
        'lui prêterait une autorité qu’elle n’a pas',
    },
    {
      id: 'bess_securite_incendie',
      raison:
        'l’arrêté applicable à la rubrique 2925-2 n’est pas identifié — les deux arrêtés publiés ' +
        'sous cette rubrique visent les ateliers de charge, pas le stockage stationnaire',
    },
  ];

  const sansLien = Object.entries(REGLES_PAR_ID)
    .filter(([, r]) => !r.url)
    .map(([id]) => id)
    .sort();

  assert.deepEqual(
    sansLien,
    MOTIVEES.map((m) => m.id).sort(),
    'une règle circule sans lien vers son texte sans que l’absence soit motivée. Ouvrez le texte ' +
      'et ajoutez son relevé ; ou, si aucun texte ne la fonde ou qu’il n’est pas identifiable, ' +
      'dites-le dans MOTIVEES — mais ne posez jamais un lien plausible sans l’avoir ouvert.',
  );

  for (const m of MOTIVEES) {
    assert.ok(
      m.raison.trim().length > 40,
      `${m.id} : une absence de lien sans raison écrite est un oubli déguisé`,
    );
  }
});
