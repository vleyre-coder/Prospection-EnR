/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LES DEUX FACONS DE TRAVAILLER, VERIFIEES DE BOUT EN BOUT SUR LES CINQ FILIERES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE SCRIPT VERIFIE, ET POURQUOI AUCUN AUTRE GARDE NE LE FAIT. Les tests unitaires
 * verifient des fonctions, les tests de base verifient des routes, le bout en bout verifie des
 * ecrans. Aucun ne verifie ce que l'exploitant a decrit : deux PARCOURS complets, chacun traversant
 * la base, le moteur, la cartographie et deux generateurs de documents, pour chacune des cinq
 * filieres. Une filiere peut etre parfaitement testee piece par piece et n'avoir, ce jour-la, plus
 * une seule parcelle classee — donc plus aucun dossier a editer. Ce script mesure la chaine entiere.
 *
 *   A. PURE PROSPECTION
 *      A1  des parcelles sont selectionnables (non ecartees) dans la filiere ;
 *      A2  un dossier PDF sort d'une selection LIBRE, et il est substantiel ;
 *      A3  les vues thematiques y sont — le zonage, le relief, les milieux, le parcellaire ;
 *      A4  le meme dossier sort en courriel pret a envoyer.
 *
 *   B. CAHIER DES CHARGES D'UN DEVELOPPEUR
 *      B1  un cahier des charges VIERGE s'edite, pour l'envoyer au developpeur ;
 *      B2  ses criteres, une fois renvoyes et saisis, rendent des parcelles ;
 *      B3  le cahier des charges REMPLI s'edite et differe du vierge ;
 *      B4  un dossier sort de la selection issue de la recherche.
 *
 * ═══ CE QUE MESURE L'ETAPE A3, ET CE QU'ELLE A COUTE DE NE PAS EXISTER
 *
 * Un dossier de 300 ko et un dossier de 1 500 ko ont le meme code de reponse. La difference est que
 * le second porte les images qui decident du projet — constructibilite, pente, milieux, exploitant
 * agricole. Un plafond de zoom mal pose, une couche qui cesse de repondre, une option perdue dans un
 * remaniement : le dossier continue de sortir, plus leger, et personne ne le voit. A3 lit le TEXTE
 * du PDF et exige que chaque legende y soit.
 *
 * ═══ CE QU'IL NE VERIFIE PAS
 *
 * Il ne juge pas la JUSTESSE des valeurs — c'est le travail du referentiel et de ses tests. Il
 * verifie que la chaine porte quelque chose de bout en bout, sur chaque filiere, ce qu'aucun test
 * unitaire ne peut dire.
 *
 * ═══ USAGE
 *
 *   DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/enr_e2e npx tsx scripts/verifier-parcours.mts
 *
 * Sortie non nulle si une seule etape echoue. La base doit etre semee et qualifiee ; le script ne
 * seme rien et n'ecrit rien — il ne fait que lire et produire des documents en memoire.
 */

import { FILIERES } from '@enr/core';
import { pool, requete } from '../apps/api/src/bdd.js';
import { construireServeur } from '../apps/api/src/serveur.js';
import { texteDuPdf } from '../apps/api/test/aides/texte-pdf.js';

/** Les legendes des vues que le dossier doit porter, telles qu'elles sont ecrites dans le PDF. */
const VUES_ATTENDUES = [
  'Zonage du document',
  'Relief',
  'Milieux',
  'Parcellaire agricole',
  'photographie aérienne',
] as const;

/** Nombre de parcelles par dossier de controle : assez pour un vrai document, assez peu pour aller vite. */
const PARCELLES_PAR_DOSSIER = 3;

const app = await construireServeur({ secretJwt: 'verification-des-parcours' });

/*
 * L'OPERATEUR DE CONTROLE N'EST PAS HABILITE AUX DONNEES DES PROPRIETAIRES. C'est volontaire : le
 * parcours doit fonctionner entierement sans elles, sans quoi une habilitation deviendrait de fait
 * necessaire pour editer un dossier — exactement ce que le cadre RGPD interdit.
 */
const jeton = app.jwt.sign({
  id: '00000000-0000-0000-0000-000000000002',
  email: 'controle@local',
  nom: 'controle',
  role: 'admin',
  habiliteDonneesProprietaires: false,
});
const entetes = { authorization: `Bearer ${jeton}` };

const reussies: string[] = [];
const echouees: string[] = [];
const dit = (vrai: boolean, texte: string): void => {
  (vrai ? reussies : echouees).push(texte);
};

for (const filiere of FILIERES) {
  // ─── A. PURE PROSPECTION ──────────────────────────────────────────────────────────────────────
  const selection = (
    await requete<{ idu: string }>(
      `SELECT idu FROM score_parcelle_filiere
        WHERE filiere = $1 AND statut <> 'rouge'
        ORDER BY score_global DESC NULLS LAST
        LIMIT $2`,
      [filiere, PARCELLES_PAR_DOSSIER],
    )
  ).map((r) => r.idu);
  dit(selection.length > 0, `${filiere} A1 · parcelles selectionnables (${selection.length})`);
  if (selection.length === 0) continue;

  const dossier = await app.inject({
    method: 'POST',
    url: '/api/exports/dossier',
    payload: { idus: selection, filiere, format: 'pdf' },
    headers: entetes,
  });
  const ko = Math.round(dossier.rawPayload.length / 1024);
  dit(
    dossier.statusCode === 200 && dossier.rawPayload.length > 200_000,
    `${filiere} A2 · dossier depuis une selection libre (${dossier.statusCode}, ${ko} ko)`,
  );

  if (dossier.statusCode === 200) {
    const texte = texteDuPdf(dossier.rawPayload);
    const absentes = VUES_ATTENDUES.filter((v) => !texte.includes(v));
    dit(
      absentes.length === 0,
      `${filiere} A3 · vues du dossier${absentes.length ? ` — MANQUE : ${absentes.join(', ')}` : ''}`,
    );
  }

  const courriel = await app.inject({
    method: 'POST',
    url: '/api/exports/dossier',
    payload: { idus: selection, filiere, format: 'eml' },
    headers: entetes,
  });
  dit(courriel.statusCode === 200, `${filiere} A4 · dossier pret a envoyer (${courriel.statusCode})`);

  // ─── B. CAHIER DES CHARGES ────────────────────────────────────────────────────────────────────
  const vierge = await app.inject({
    method: 'POST',
    url: '/api/exports/cahier-des-charges',
    payload: { filiere },
    headers: entetes,
  });
  dit(
    vierge.statusCode === 200 && vierge.rawPayload.length > 5_000,
    `${filiere} B1 · cahier des charges VIERGE (${vierge.statusCode}, ` +
      `${Math.round(vierge.rawPayload.length / 1024)} ko)`,
  );

  /*
   * LE DEVELOPPEUR A RENVOYE SA FICHE, l'operateur saisit ses criteres. Le seuil choisi ici est
   * volontairement doux : ce qu'on mesure est que la chaine porte un critere jusqu'aux parcelles,
   * pas la severite d'un filtre.
   */
  const criteres = { filiere, limite: 20, seuils: [{ chemin: 'eau.distanceCoursEauM', min: 35 }] };
  const recherche = await app.inject({
    method: 'POST',
    url: '/api/recherche/parcelles',
    payload: criteres,
    headers: entetes,
  });
  const trouvees = (recherche.json() as { resultats?: Array<{ idu: string }> }).resultats ?? [];
  dit(
    recherche.statusCode === 200 && trouvees.length > 0,
    `${filiere} B2 · recherche sur le cahier des charges du developpeur (${trouvees.length} parcelles)`,
  );

  const rempli = await app.inject({
    method: 'POST',
    url: '/api/exports/cahier-des-charges',
    payload: { filiere, criteres },
    headers: entetes,
  });
  /*
   * DISTINCT DU VIERGE, et c'est la seule chose qui prouve que les criteres ont ete reportes. Deux
   * documents de meme taille signifieraient que le compte rendu remis avec les resultats ne dit pas
   * ce qui a ete cherche — un document de tracabilite qui ne trace rien.
   */
  dit(
    rempli.statusCode === 200 && rempli.rawPayload.length !== vierge.rawPayload.length,
    `${filiere} B3 · cahier des charges REMPLI, distinct du vierge (${rempli.statusCode})`,
  );

  const issuesDeLaRecherche = trouvees.slice(0, PARCELLES_PAR_DOSSIER).map((r) => r.idu);
  if (issuesDeLaRecherche.length === 0) {
    echouees.push(`${filiere} B4 · aucune parcelle issue de la recherche`);
  } else {
    const dossierB = await app.inject({
      method: 'POST',
      url: '/api/exports/dossier',
      payload: { idus: issuesDeLaRecherche, filiere, format: 'pdf' },
      headers: entetes,
    });
    dit(
      dossierB.statusCode === 200,
      `${filiere} B4 · dossier depuis la selection issue de la recherche (${dossierB.statusCode})`,
    );
  }
}

for (const l of reussies) console.log(`OK    ${l}`);
for (const l of echouees) console.log(`ECHEC ${l}`);
console.log(`\n${reussies.length}/${reussies.length + echouees.length} etapes reussies`);

await app.close();
await pool.end();
if (echouees.length > 0) process.exitCode = 1;
