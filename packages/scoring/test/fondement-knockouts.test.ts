/**
 * Le fondement juridique de chaque knock-out : declare, ou explicitement absent.
 *
 * POURQUOI CE FICHIER EXISTE. Un knock-out ECARTE une parcelle, et son motif part dans le rapport PDF
 * remis au proprietaire, sous la mention « Fondement : … ». Deux defauts de cette famille ont deja ete
 * trouves, a deux moments differents :
 *
 *   - chantier C : « Fondement : eol_distance_habitation » — une cle de code donnee comme base juridique ;
 *   - cette verification : `ko_eol_servitude_aero` — une servitude aeronautique de degagement fondee sur
 *     l'arrete du 26 aout 2011 relatif aux RADARS. Deux contraintes distinctes, deux regimes distincts.
 *     La reference n'etait pas une cle technique cette fois, elle etait simplement FAUSSE — et rien ne
 *     pouvait le voir, puisqu'elle appartenait bien a la famille eolienne.
 *
 * CE QUE CE FICHIER PEUT ET NE PEUT PAS FAIRE. Aucun test ne verifiera qu'un texte de loi regit bien la
 * contrainte a laquelle on le rattache : c'est un jugement juridique. Ce qu'il peut faire, c'est
 * interdire la DERIVE SILENCIEUSE — figer, knock-out par knock-out, le fondement attendu, et faire
 * echouer toute attribution ajoutee, retiree ou changee sans decision explicite.
 *
 * Les `null` ne sont donc pas des trous : ce sont des absences ASSUMEES, chacune avec son motif. Six
 * d'entre elles sont de nature juridique et attendent une revue de juriste (voir
 * `docs/VERIFICATION-COUVERTURE.md`) ; les autres n'ont aucune base reglementaire a citer.
 */

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
/**
 * `dist` et non `src`, comme les autres tests de ce paquet : il s'execute sous
 * `node --test --experimental-strip-types`, qui ne remappe pas `.js` vers `.ts`. La LISTE vient donc du
 * paquet construit ; les ATTRIBUTIONS, elles, sont relues dans la source — c'est la seule facon de voir
 * un argument passe a `ko()`, qu'aucune valeur exportee ne porte.
 */
import { IDS_KNOCK_OUTS } from '../dist/index.js';

/**
 * Fondement attendu par knock-out. `null` = aucune reference, volontairement.
 *
 * A tenir a jour : c'est le prix de la garde, et il est faible au regard de ce qu'elle protege — une
 * base juridique erronee dans un document remis a un tiers.
 */
const FONDEMENT_ATTENDU: Record<string, string | null> = {
  // --- Attributions etablies ---
  ko_aop_viticole: 'pv_aop_viticole',
  ko_hors_document_cadre: 'pv_document_cadre',
  ko_eol_habitation_500: 'eol_distance_habitation',
  ko_eol_zone_habitat_500: 'eol_distance_habitation',
  ko_eol_mh_500: 'eol_monument_historique',
  ko_eol_radar: 'eol_radar',
  ko_metha_habitation_200: 'metha_distance_habitation',
  ko_metha_captage: 'metha_distance_eau',
  ko_metha_cours_eau: 'metha_distance_eau',

  // --- Absences de nature JURIDIQUE : a soumettre a un juriste ---
  // Chacune pourrait porter une reference ; aucune ne doit en porter une non verifiee.
  ko_zone_humide: null,
  ko_ppri_rouge: null,
  ko_ebc: null,
  ko_emplacement_reserve: null,
  ko_zonage_naturel: null,
  ko_eol_site_classe: null,
  // Corrige par cette verification : citait l'arrete « radars », qui ne regit pas les servitudes de
  // degagement. Doit rester a `null` jusqu'a validation du texte applicable.
  ko_eol_servitude_aero: null,

  // --- Absence de nature TECHNIQUE : il n'y a pas de texte a citer ---
  // La saturation d'un poste source est un fait de reseau, pas une regle de droit.
  ko_poste_sature: null,
};

/** Les attributions reellement ecrites dans le code, relues depuis la source. */
function attributionsReelles(): Map<string, string | null> {
  const s = readFileSync(new URL('../src/knockouts.ts', import.meta.url), 'utf8');
  const out = new Map<string, string | null>();
  let i = 0;
  while ((i = s.indexOf('ko(', i)) !== -1) {
    // `ko(` precede d'un caractere de mot est un autre identifiant (`function ko(`, `koRadar(`…).
    if (/[A-Za-z0-9_.]/.test(s[i - 1] ?? '')) {
      i += 3;
      continue;
    }
    let prof = 0;
    let j = i + 2;
    for (; j < s.length; j += 1) {
      if (s[j] === '(') prof += 1;
      else if (s[j] === ')') {
        prof -= 1;
        if (prof === 0) break;
      }
    }
    const appel = s.slice(i, j + 1);
    const id = /ko\(\s*'([a-z0-9_]+)'/.exec(appel)?.[1];
    if (id) {
      out.set(id, /'((?:pv|agri|eol|bess|metha)_[a-z0-9_]+)'/.exec(appel)?.[1] ?? null);
    }
    i = j + 1;
  }
  return out;
}

test('la table couvre TOUS les knock-outs declares, et rien de plus', () => {
  // Sans cela, un knock-out ajoute echapperait a la garde en silence — le mode de defaillance de tous
  // les controles par liste maintenue a la main.
  const declares = [...IDS_KNOCK_OUTS].sort();
  const surveilles = Object.keys(FONDEMENT_ATTENDU).sort();
  assert.deepEqual(
    surveilles,
    declares,
    'la table des fondements et la liste des knock-outs ont divergé : completez FONDEMENT_ATTENDU, ' +
      'en decidant explicitement si le nouveau knock-out porte une base juridique ou non.',
  );
});

test('chaque knock-out porte EXACTEMENT le fondement attendu', () => {
  const reelles = attributionsReelles();
  const ecarts: string[] = [];
  for (const [id, attendu] of Object.entries(FONDEMENT_ATTENDU)) {
    if (!reelles.has(id)) {
      ecarts.push(`${id} : aucun appel ko() trouve dans la source`);
      continue;
    }
    const reel = reelles.get(id) ?? null;
    if (reel !== attendu) {
      ecarts.push(`${id} : ${reel ?? 'aucun'} au lieu de ${attendu ?? 'aucun'}`);
    }
  }
  assert.deepEqual(
    ecarts,
    [],
    `fondement(s) juridique(s) modifie(s) sans decision : ${ecarts.join(' ; ')}. Une base juridique ` +
      "erronee part dans le rapport remis au proprietaire, sous la mention « Fondement : … » : c'est " +
      'le defaut qui a rendu ce fichier necessaire.',
  );
});

test('LE DEFAUT CORRIGE : la servitude aeronautique ne cite plus l’arrete « radars »', () => {
  /**
   * Redondant avec la boucle ci-dessus, et c'est voulu : il NOMME le defaut, de sorte qu'un echec dise
   * ce qui est casse et non seulement qu'il l'est.
   */
  assert.equal(
    attributionsReelles().get('ko_eol_servitude_aero') ?? null,
    null,
    "l'arrete du 26 aout 2011 porte sur les RADARS ; il ne fonde pas une servitude aeronautique de " +
      'degagement. Aucune reference ne vaut mieux qu’une reference fausse dans un document remis a un tiers.',
  );
});
