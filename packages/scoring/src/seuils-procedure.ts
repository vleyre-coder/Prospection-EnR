/**
 * Seuils de procedure a rappeler dans la fiche parcelle.
 *
 * Chaque seuil est presente avec sa reference juridique et sa date d'entree en vigueur,
 * et son applicabilite est evaluee au vu de la puissance / du tonnage envisage lorsque
 * l'utilisateur les renseigne.
 */

import type { Filiere, OptionsScoring, ParcelleSnapshot, SeuilProcedure } from '@enr/core';
import { REGLES } from '@enr/core';
import { formatNombre } from './notes.js';

function seuil(
  filiere: Filiere,
  cle: string,
  applicable: boolean | null,
  commentaire: string | null = null,
): SeuilProcedure | null {
  const regle = REGLES[filiere]?.[cle];
  if (!regle) return null;
  return {
    regleId: regle.id,
    libelle: regle.libelle,
    reference: regle.reference,
    dateEntreeEnVigueur: regle.dateEntreeEnVigueur,
    applicable,
    commentaire: commentaire ?? regle.commentaire ?? null,
  };
}

/**
 * Un rappel de procedure COMMUN aux quatre filieres, lu dans le groupe `commun` du referentiel.
 *
 * Les autorisations transversales — defrichement, especes protegees, incidences Natura 2000, archeologie
 * preventive — ne dependent pas de la filiere. Les dupliquer dans chaque bloc serait quatre fois la meme
 * regle a corriger.
 */
function seuilCommun(
  cle: string,
  applicable: boolean | null,
  commentaire: string | null = null,
): SeuilProcedure | null {
  const regle = REGLES['commun']?.[cle];
  if (!regle) return null;
  return {
    regleId: regle.id,
    libelle: regle.libelle,
    reference: regle.reference,
    dateEntreeEnVigueur: regle.dateEntreeEnVigueur,
    applicable,
    commentaire: commentaire ?? regle.commentaire ?? null,
  };
}

/**
 * LES QUATRE AUTORISATIONS TRANSVERSALES, avec leur applicabilite quand elle est MESUREE.
 *
 * `null` n'est pas un aveu de faiblesse ici, c'est la reponse juste : `preEnjeuEspeces` et
 * `sensibiliteArcheologique` sont mis a `null` par les connecteurs, deliberement — le premier portait
 * une valeur inventee, retiree a l'audit 6. Annoncer « non applicable » sur une donnee absente serait
 * exactement le defaut que ces audits poursuivent. « A verifier » est la seule reponse honnete, et elle
 * a de la valeur : elle rappelle au prospecteur ce qui reste a instruire.
 */
function proceduresTransversales(s: ParcelleSnapshot): Array<SeuilProcedure | null> {
  const f = s.occupationSol.foret;
  const natura =
    s.milieux.natura2000Habitats.recouvre === true || s.milieux.natura2000Oiseaux.recouvre === true
      ? true
      : s.milieux.natura2000Habitats.recouvre == null && s.milieux.natura2000Oiseaux.recouvre == null
        ? null
        : // Hors site : l'evaluation reste due si le projet est susceptible d'affecter le site, ce que
          // la proximite suffit a rendre plausible. On ne conclut donc « non » qu'au-dela de 5 km.
          (() => {
            const d = [s.milieux.natura2000Habitats.distanceM, s.milieux.natura2000Oiseaux.distanceM]
              .filter((x): x is number => x != null)
              .sort((a, b) => a - b)[0];
            return d == null ? null : d <= 5000 ? true : false;
          })();

  return [
    seuilCommun(
      'defrichement',
      s.milieux.enjeuDefrichement,
      s.milieux.enjeuDefrichement === true
        ? `Parcelle boisee${f.partBoisee != null ? ` a environ ${formatNombre(f.partBoisee * 100, '%', 0)}` : ''} : une autorisation de defrichement et sa compensation sont a prevoir, avec un delai d'instruction propre.`
        : null,
    ),
    // Aucune source nationale ne prejuge l'enjeu especes a la parcelle : toujours « a verifier ».
    seuilCommun('especes_protegees', null),
    seuilCommun(
      'natura2000_incidences',
      natura,
      natura === true ? 'Site Natura 2000 recouvrant ou proche : evaluation des incidences a produire.' : null,
    ),
    seuilCommun('archeologie_preventive', null),
  ];
}

/** Puissance PV installable estimee, en MWc, a raison d'environ 1 MWc par hectare cloture. */
export function puissancePvEstimeeMwc(surfaceHa: number | null, agrivoltaique: boolean): number | null {
  if (surfaceHa == null) return null;
  const densite = agrivoltaique ? 0.5 : 1.0;
  return Math.round(surfaceHa * densite * 100) / 100;
}

export function construireSeuilsProcedure(
  s: ParcelleSnapshot,
  filiere: Filiere,
  options: OptionsScoring,
  surfaceHa: number | null,
  regimeImplantation: string | null,
): SeuilProcedure[] {
  const out: Array<SeuilProcedure | null> = [...proceduresTransversales(s)];

  if (filiere === 'solaire_sol') {
    const p =
      options.puissanceEnvisageeMw ?? puissancePvEstimeeMwc(surfaceHa, regimeImplantation === 'agrivoltaisme');
    const pct = p == null ? null : p;
    out.push(
      seuil(
        filiere,
        'permis_construire',
        pct == null ? null : pct >= 3,
        pct == null
          ? null
          // `formatNombre` et non l'interpolation brute : `${pct}` ecrivait « 0.38 MWc », avec un
          // point decimal, dans une phrase qui contient par ailleurs « 0,5 MWc/ha ». Mesure sur
          // 439 parcelles x 4 filieres : 435 occurrences (audit 10, defaut B1).
          : `Puissance estimee ${formatNombre(pct, 'MWc', 2)} : ${pct >= 3 ? 'permis de construire' : 'declaration prealable'} (estimation a raison de ${regimeImplantation === 'agrivoltaisme' ? '0,5' : '1'} MWc/ha).`,
      ),
      seuil(filiere, 'eval_env_systematique', pct == null ? null : pct >= 3),
      seuil(filiere, 'eval_env_cas_par_cas', pct == null ? null : pct >= 0.3 && pct < 3),
    );
    /**
     * La compensation agricole collective : declenchee par la NATURE DU SOL, pas par la puissance.
     *
     * Le seuil de surface est fixe par arrete prefectoral, entre un et cinq hectares selon les
     * departements : l'application ne peut donc pas trancher, et ne le pretend pas. Elle signale
     * l'applicabilite probable des que le sol est agricole exploite, et laisse « a verifier » quand la
     * nature du sol n'est pas connue.
     */
    const solAgricole = s.occupationSol.typeSol;
    out.push(
      seuil(
        filiere,
        'compensation_agricole',
        solAgricole == null ? null : solAgricole === 'agricole_exploite',
        solAgricole === 'agricole_exploite'
          ? `Sol agricole exploite${surfaceHa != null ? ` sur ${formatNombre(surfaceHa, 'ha', 2)}` : ''} : l'etude prealable est probablement due. Le seuil de surface est fixe par arrete prefectoral — le verifier aupres de la DDT${regimeImplantation === 'agrivoltaisme' ? '. Une configuration agrivoltaique maintenant une production significative peut en dispenser' : ''}.`
          : null,
      ),
      seuil(filiere, 'demantelement', true),
    );

    if (regimeImplantation === 'agrivoltaisme') {
      out.push(
        seuil(filiere, 'agri_taux_couverture', true),
        seuil(
          filiere,
          'agri_zone_temoin',
          true,
          surfaceHa != null && surfaceHa <= 1
            ? "Installation de moins de 1 ha : une dispense de zone temoin est envisageable."
            : null,
        ),
        seuil(filiere, 'agri_avis_cdpenaf', true),
      );
    }
    if (regimeImplantation === 'pv_sol_document_cadre') {
      out.push(
        seuil(filiere, 'document_cadre_departemental', true),
        seuil(filiere, 'date_reference_inculte', true),
      );
    }
    if (s.occupationSol.aop.presente === true) {
      out.push(seuil(filiere, 'aop_viticole', s.occupationSol.aop.viticole === true));
    }
  }

  if (filiere === 'eolien_terrestre') {
    out.push(
      seuil(filiere, 'icpe_2980', true),
      seuil(filiere, 'distance_habitation', true),
      seuil(filiere, 'rayon_enquete_publique', true),
      seuil(
        filiere,
        'monument_historique',
        s.patrimoine.monumentHistorique.dansPerimetreProtection ?? null,
      ),
      seuil(filiere, 'radar', s.risques.radars.length > 0 ? true : null),
    );
  }

  if (filiere === 'eolien_terrestre') {
    out.push(
      // Mesure directe : la servitude recouvre la parcelle, ou non, ou l'on ne sait pas.
      seuil(
        filiere,
        'faisceaux_hertziens',
        s.risques.faisceauxHertziens,
        s.risques.faisceauxHertziens === true
          ? "La parcelle est grevee d'une servitude de protection radioelectrique : l'implantation devra degager le faisceau, ce qui contraint fortement le plan de masse."
          : null,
      ),
      // Systematique des lors que la rubrique 2980 est franchie, c'est-a-dire pour tout parc.
      seuil(filiere, 'autorisation_environnementale', true),
    );
  }

  if (filiere === 'bess') {
    const p = options.puissanceEnvisageeMw;
    out.push(
      seuil(
        filiere,
        'icpe_2925_2',
        p == null ? true : p * 1000 > 600,
        p == null
          ? "Tout projet de taille industrielle depasse le seuil de 600 kW : regime de declaration a minima."
          : `Puissance envisagee ${p} MW : ${p * 1000 > 600 ? 'declaration ICPE 2925-2 requise' : 'sous le seuil de declaration'}.`,
      ),
      seuil(filiere, 'securite_incendie', true),
      seuil(filiere, 'chimie_lfp', true),
      /**
       * LES TROIS RAPPELS AJOUTES POUR ETOFFER LA FILIERE LA PLUS MINCE.
       *
       * Leur applicabilite est EVALUEE quand la donnee existe, et laissee a `null` sinon — jamais
       * affirmee. C'est la difference entre un rappel de procedure et une conclusion.
       */
      // L'acces engins : `false` signifie « pas d'acces poids lourds identifie », donc exigence
      // certainement critique ; `true` ne dispense pas de la voie engins du SDIS, d'ou `true` aussi.
      seuil(
        filiere,
        'acces_engins',
        s.acces.accesPoidsLourds == null ? null : true,
        s.acces.accesPoidsLourds === false
          ? 'Aucun acces poids lourds identifie : la livraison des conteneurs et la voie engins du SDIS ' +
            'sont a traiter avant tout engagement.'
          : null,
      ),
      // Les effets domino ne s'examinent que s'il y a un voisinage industriel. `icpeProches` compte les
      // installations classees a proximite ; `null` = couche non ingeree, et l'on ne conclut pas.
      seuil(
        filiere,
        'effets_domino',
        s.risques.icpeProches == null ? null : s.risques.icpeProches > 0,
        s.risques.icpeProches != null && s.risques.icpeProches > 0
          ? `${s.risques.icpeProches} installation(s) classee(s) a proximite : l'instruction examinera les effets domino dans les deux sens.`
          : null,
      ),
      // Le S3REnR : rappel systematique, parce que c'est le point de methode le plus couteux a
      // decouvrir tard sur cette filiere.
      seuil(filiere, 'raccordement_s3renr', true),
    );
  }

  if (filiere === 'methanisation') {
    const t = options.tonnageEnvisageTj;
    out.push(
      seuil(filiere, 'icpe_2781_declaration', t == null ? null : t < 30),
      seuil(filiere, 'icpe_2781_enregistrement', t == null ? null : t >= 30 && t <= 100),
      seuil(filiere, 'icpe_2781_autorisation', t == null ? null : t > 100),
      seuil(filiere, 'distance_habitation', true),
      seuil(filiere, 'distance_eau', true),
      seuil(filiere, 'plan_epandage', true),
      seuil(filiere, 'iota', null),
      seuil(
        filiere,
        'injection',
        // Le droit a l'injection s'apprecie sur la distance a la CANALISATION, pas au site
        // d'injection existant (audit 8, E5). Sans canalisation ingeree, le seuil reste inconnu.
        s.raccordement.reseauGaz.distanceCanalisationKm == null
          ? null
          : s.raccordement.reseauGaz.distanceCanalisationKm <= 10,
      ),
      /**
       * Les deux rappels ajoutes pour cette filiere.
       *
       * L'agrement sanitaire est declenche par la PRESENCE D'ELEVAGES dans le rayon
       * d'approvisionnement, qui rend probables des intrants d'origine animale. C'est un indice, pas une
       * certitude : le plan d'approvisionnement reel seul conclut, et le commentaire le dit.
       */
      seuil(
        filiere,
        'sous_produits_animaux',
        s.gisement.elevagesRayon10km == null ? null : s.gisement.elevagesRayon10km > 0,
        s.gisement.elevagesRayon10km != null && s.gisement.elevagesRayon10km > 0
          ? `${s.gisement.elevagesRayon10km} elevage(s) dans le rayon d'approvisionnement : des intrants d'origine animale sont probables, ce qui appelle un agrement sanitaire distinct de l'ICPE.`
          : null,
      ),
      seuil(
        filiere,
        'acces_engins',
        s.acces.accesPoidsLourds == null ? null : true,
        s.acces.accesPoidsLourds === false
          ? "Aucun acces poids lourds identifie : sur cette filiere le trafic est QUOTIDIEN, et l'acces conditionne autant l'autorisation que l'acceptabilite locale."
          : null,
      ),
    );
  }

  return out.filter((x): x is SeuilProcedure => x !== null);
}
