/**
 * Seuils de procedure a rappeler dans la fiche parcelle.
 *
 * Chaque seuil est presente avec sa reference juridique et sa date d'entree en vigueur,
 * et son applicabilite est evaluee au vu de la puissance / du tonnage envisage lorsque
 * l'utilisateur les renseigne.
 */

import type { Filiere, OptionsScoring, ParcelleSnapshot, SeuilProcedure } from '@enr/core';
import { REGLES } from '@enr/core';

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
  const out: Array<SeuilProcedure | null> = [];

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
          : `Puissance estimee ${pct} MWc : ${pct >= 3 ? 'permis de construire' : 'declaration prealable'} (estimation a raison de ${regimeImplantation === 'agrivoltaisme' ? '0,5' : '1'} MWc/ha).`,
      ),
      seuil(filiere, 'eval_env_systematique', pct == null ? null : pct >= 3),
      seuil(filiere, 'eval_env_cas_par_cas', pct == null ? null : pct >= 0.3 && pct < 3),
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
        s.raccordement.reseauGaz.distanceKm == null ? null : s.raccordement.reseauGaz.distanceKm <= 10,
      ),
    );
  }

  return out.filter((x): x is SeuilProcedure => x !== null);
}
