/** Identifiants de connecteurs, utilises comme cle dans `ParcelleSnapshot.sources`. */
export const SRC = {
  cadastre: 'apicarto_cadastre',
  gpu: 'apicarto_gpu',
  rpg: 'apicarto_rpg',
  aoc: 'apicarto_aoc',
  nature: 'apicarto_nature',
  georisques: 'georisques',
  alti: 'ign_alti',
  bdtopo: 'ign_bdtopo',
  bdforet: 'ign_bdforet',
  postes: 'postes_sources',
  gaz: 'reseau_gaz',
  gisement: 'gisement',
  zaer: 'zaer_local',
  docCadre: 'document_cadre_local',
  zonesHumides: 'zones_humides',
  patrimoine: 'patrimoine_culture',
  foncier: 'foncier_cadastre',
} as const;

export type SourceKey = (typeof SRC)[keyof typeof SRC];
