/**
 * Exports : fiche parcelle en PDF, selections en GeoJSON / Shapefile / CSV.
 *
 * Tout export est journalise (`journal_acces`) : l'application manipule des donnees de
 * prospection fonciere, dont la diffusion doit rester tracable.
 */

import PDFDocument from 'pdfkit';
import type { EvaluationCritere, Feu, ParcelleSnapshot, ResultatScore } from '@enr/core';
import {
  AVERTISSEMENTS,
  FAMILLES_LIBELLES,
  FILIERES_META,
  LIBELLES_SCORE,
  REFERENTIEL_DERNIERE_VERIFICATION,
} from '@enr/core';
import { LIBELLES_REGIME } from '@enr/scoring';
import type { ParcelleEnBase } from '../depots/parcelles.js';
import type { LigneResultatFiltre } from './recherche.js';

// ---------------------------------------------------------------------------
// PDF : fiche parcelle imprimable
// ---------------------------------------------------------------------------

const COULEUR_FEU: Record<Feu, string> = {
  vert: '#16a34a',
  orange: '#d97706',
  rouge: '#dc2626',
  gris: '#9ca3af',
};

/** Retire les caracteres non latin-1 : les polices PDF standard ne les gerent pas. */
function texteSur(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
}

export function ficheParcellePdf(
  parcelle: ParcelleEnBase,
  snapshot: ParcelleSnapshot,
  score: ResultatScore,
): NodeJS.ReadableStream {
  const doc = new PDFDocument({ size: 'A4', margin: 42, info: {
    Title: `Fiche parcelle ${parcelle.idu} - ${FILIERES_META[score.filiere].libelleCourt}`,
    Author: 'Prospection EnR',
  } });

  const largeur = doc.page.width - 84;

  // --- En-tete ------------------------------------------------------------
  doc.fontSize(17).font('Helvetica-Bold').text(texteSur(`Fiche parcelle - ${FILIERES_META[score.filiere].libelle}`));
  doc.moveDown(0.2);
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#475569')
    .text(
      texteSur(
        `${parcelle.nomCommune ?? parcelle.codeInsee} (${parcelle.codeInsee}) - section ${parcelle.section} n° ${parcelle.numero} - IDU ${parcelle.idu}`,
      ),
    );
  doc.fillColor('#000');
  doc.moveDown(0.6);

  // --- Bandeau de score ---------------------------------------------------
  const hauteurBandeau = 54;
  const y0 = doc.y;
  doc.roundedRect(42, y0, largeur, hauteurBandeau, 4).fill(COULEUR_FEU[score.statut]);
  doc
    .fillColor('#fff')
    .fontSize(24)
    .font('Helvetica-Bold')
    .text(score.scoreGlobal != null ? `${score.scoreGlobal.toFixed(0)}/100` : 'ECARTEE', 54, y0 + 8);
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(texteSur(LIBELLES_SCORE[score.statut]), 54, y0 + 36);
  doc
    .fontSize(9)
    .text(
      texteSur(
        `Couverture de donnees ${Math.round(score.couvertureDonnees * 100)} %` +
          (score.regimeImplantation ? ` - ${LIBELLES_REGIME[score.regimeImplantation] ?? score.regimeImplantation}` : ''),
      ),
      largeur / 2 + 20,
      y0 + 12,
      { width: largeur / 2 - 20, align: 'right' },
    );
  doc
    .fontSize(8)
    .text(
      texteSur(
        `Surface ${((parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000).toFixed(2)} ha - calcul du ${new Date(score.dateCalcul).toLocaleDateString('fr-FR')}`,
      ),
      largeur / 2 + 20,
      y0 + 34,
      { width: largeur / 2 - 20, align: 'right' },
    );
  doc.fillColor('#000');
  doc.y = y0 + hauteurBandeau + 14;

  // --- Criteres redhibitoires --------------------------------------------
  if (score.knockOuts.length > 0) {
    titre(doc, 'Criteres redhibitoires');
    for (const k of score.knockOuts) {
      const debutY = doc.y;
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(k.derogeable ? '#b45309' : '#b91c1c');
      doc.text(texteSur(`${k.derogeable ? '[DEROGEABLE] ' : '[BLOQUANT] '}${k.libelle}`), 48, debutY, {
        width: largeur - 12,
      });
      doc.font('Helvetica').fillColor('#1f2937').fontSize(8.5);
      doc.text(texteSur(k.motif), 48, doc.y + 1, { width: largeur - 12 });
      doc.moveDown(0.4);
      doc.fillColor('#000');
    }
    doc.moveDown(0.2);
  }

  // --- Synthese -----------------------------------------------------------
  titre(doc, 'Synthese');
  if (score.pointsForts.length > 0) {
    doc.fontSize(9).font('Helvetica-Bold').text('Points forts');
    doc.font('Helvetica').fontSize(8.5);
    for (const p of score.pointsForts) {
      doc.text(texteSur(`- ${p.libelle} : ${p.valeur}`), { indent: 8 });
    }
    doc.moveDown(0.3);
  }
  if (score.pointsVigilance.length > 0) {
    doc.fontSize(9).font('Helvetica-Bold').text('Points de vigilance');
    doc.font('Helvetica').fontSize(8.5);
    for (const p of score.pointsVigilance) {
      doc.text(texteSur(`- ${p.libelle} : ${p.valeur}`), { indent: 8 });
    }
    doc.moveDown(0.3);
  }

  // --- Seuils de procedure ------------------------------------------------
  if (score.seuilsProcedure.length > 0) {
    titre(doc, 'Seuils de procedure applicables');
    doc.fontSize(8).font('Helvetica');
    for (const s of score.seuilsProcedure) {
      const marque = s.applicable === true ? '[X]' : s.applicable === false ? '[ ]' : '[?]';
      doc.text(texteSur(`${marque} ${s.libelle}`), { indent: 8 });
      doc.fillColor('#64748b').fontSize(7.2);
      doc.text(texteSur(`${s.reference} - en vigueur depuis le ${s.dateEntreeEnVigueur}`), { indent: 20 });
      doc.fillColor('#000').fontSize(8);
    }
    doc.moveDown(0.3);
  }

  // --- Detail des criteres, par famille -----------------------------------
  titre(doc, 'Detail des criteres');
  const parFamille = new Map<string, EvaluationCritere[]>();
  for (const c of score.criteres) {
    parFamille.set(c.famille, [...(parFamille.get(c.famille) ?? []), c]);
  }
  for (const [famille, criteres] of parFamille) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a');
    doc.text(texteSur(FAMILLES_LIBELLES[famille as keyof typeof FAMILLES_LIBELLES] ?? famille));
    doc.fillColor('#000').font('Helvetica').fontSize(8);
    for (const c of criteres) {
      const y = doc.y + 2;
      doc.circle(52, y + 3, 2.6).fill(COULEUR_FEU[c.feu]);
      doc.fillColor('#000');
      doc.text(texteSur(c.libelle), 60, y, { width: largeur * 0.42, continued: false });
      const yLigne = y;
      doc.text(texteSur(c.valeurAffichee), 60 + largeur * 0.42, yLigne, {
        width: largeur * 0.36,
      });
      doc
        .fillColor('#64748b')
        .text(
          c.note != null ? `${c.note.toFixed(0)}/100 - poids ${(c.poids * 100).toFixed(1)} %` : 'non evalue',
          60 + largeur * 0.78,
          yLigne,
          { width: largeur * 0.22 },
        );
      doc.fillColor('#000');
      doc.y = Math.max(doc.y, yLigne + 11);
    }
    doc.moveDown(0.2);
  }

  // --- Sources ------------------------------------------------------------
  if (doc.y > doc.page.height - 200) doc.addPage();
  titre(doc, 'Sources et fraicheur des donnees');
  doc.fontSize(7.5).font('Helvetica').fillColor('#334155');
  for (const s of Object.values(snapshot.sources)) {
    doc.text(
      texteSur(
        `- ${s.nom}${s.millesime ? ` (millesime ${s.millesime})` : ''} - interrogee le ${new Date(s.dateInterrogation).toLocaleDateString('fr-FR')} - valeur ${s.valeurJuridique}`,
      ),
      { indent: 8 },
    );
  }
  doc.fillColor('#000');
  doc.moveDown(0.5);

  // --- Avertissements (non negociables) -----------------------------------
  if (doc.y > doc.page.height - 190) doc.addPage();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#b91c1c').text('Avertissements');
  doc.font('Helvetica').fontSize(7.2).fillColor('#1f2937');
  for (const a of AVERTISSEMENTS.filter((x) => x.portee === 'global')) {
    doc.text(texteSur(`${a.titre} - ${a.texte}`), { align: 'justify' });
    doc.moveDown(0.2);
  }
  doc.text(
    texteSur(
      `Referentiel reglementaire verifie le ${REFERENTIEL_DERNIERE_VERIFICATION}. Moteur de scoring version ${score.versionMoteur}. Le contour cadastral est indicatif et sans valeur juridique.`,
    ),
  );
  doc.fillColor('#000');

  doc.end();
  return doc;
}

function titre(doc: PDFKit.PDFDocument, texte: string): void {
  if (doc.y > doc.page.height - 90) doc.addPage();
  doc.moveDown(0.2);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text(texteSur(texte));
  doc
    .moveTo(42, doc.y + 1)
    .lineTo(doc.page.width - 42, doc.y + 1)
    .strokeColor('#cbd5e1')
    .lineWidth(0.6)
    .stroke();
  doc.fillColor('#000').font('Helvetica').moveDown(0.35);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** CSV a separateur point-virgule, avec BOM UTF-8 : ouverture directe dans Excel FR. */
export function csvResultats(lignes: LigneResultatFiltre[]): string {
  const entetes = [
    'IDU',
    'Commune',
    'Section',
    'Numero',
    'Surface (ha)',
    'Statut score',
    'Score global',
    'Statut prospection',
    'Distance poste source (km)',
    'Pente (%)',
    'Type de sol',
    'Longitude',
    'Latitude',
  ];
  const echapper = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  };
  const nombre = (n: number | null): string => (n == null ? '' : String(n).replace('.', ','));

  const corps = lignes.map((l) =>
    [
      l.idu,
      l.nomCommune,
      l.section,
      l.numero,
      nombre(l.surfaceHa),
      l.statutScore,
      nombre(l.scoreGlobal),
      l.statutProspection,
      nombre(l.distancePosteKm),
      nombre(l.pentePct),
      l.typeSol,
      nombre(l.centroide[0]),
      nombre(l.centroide[1]),
    ]
      .map(echapper)
      .join(';'),
  );

  return `﻿${entetes.join(';')}\n${corps.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

export function geojsonParcelles(
  parcelles: Array<{ parcelle: ParcelleEnBase; score: ResultatScore | null }>,
): unknown {
  return {
    type: 'FeatureCollection',
    // Le CRS est implicitement WGS84 en GeoJSON (RFC 7946) : on documente la provenance.
    metadata: {
      producteur: 'Prospection EnR',
      dateExport: new Date().toISOString(),
      avertissement:
        "Contours issus du Plan Cadastral Informatise : indicatifs, sans valeur juridique. Scores fournis a titre d'aide a la decision.",
    },
    features: parcelles.map(({ parcelle, score }) => ({
      type: 'Feature',
      geometry: parcelle.geometrie,
      properties: {
        idu: parcelle.idu,
        code_insee: parcelle.codeInsee,
        nom_commune: parcelle.nomCommune,
        section: parcelle.section,
        numero: parcelle.numero,
        surface_ha:
          Math.round(((parcelle.surfaceCalculeeM2 ?? parcelle.contenanceM2 ?? 0) / 10000) * 100) / 100,
        filiere: score?.filiere ?? null,
        statut_score: score?.statut ?? null,
        score_global: score?.scoreGlobal ?? null,
        couverture_donnees: score?.couvertureDonnees ?? null,
        nb_knock_outs: score?.knockOuts.length ?? null,
        regime_implantation: score?.regimeImplantation ?? null,
        knock_outs: score?.knockOuts.map((k) => k.libelle).join(' | ') ?? null,
      },
    })),
  };
}
