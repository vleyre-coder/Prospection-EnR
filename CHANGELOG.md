# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Les versions suivent [SemVer](https://semver.org/lang/fr/) ; l'application n'a pas encore atteint
`1.0.0`, ce qui signifie que le format du snapshot et celui du score peuvent encore changer.

Chaque entrée qui corrige un défaut de fiabilité porte la référence de l'audit qui l'a trouvé, dans
`docs/AUDIT-N.md`. C'est délibéré : sur un outil d'aide à la décision, savoir **depuis quand** un
chiffre est juste importe autant que savoir qu'il l'est. Un rapport produit avant une correction
n'a pas la même valeur qu'un rapport produit après.

## [Non publié]

### Corrigé — fiabilité

- **La détection des plans de prévention des risques ne fonctionnait pas** (audit 7). Le connecteur
  lisait `libelle_risque_long` puis `libelle_risque` ; le champ réel est `libPpr`. L'application
  **affirmait** « pas de PPRI, pas de PPRIF, pas de PPRT, aléa inondation nul » sur toutes les
  parcelles de France. Vérifié sur cinq communes qui en ont : Arles (submersion marine), Aix
  (6 plans), Nice (7), Montpellier, Lyon. Une parcelle en zone rouge de PPRI pouvait ressortir
  verte. La classification porte désormais sur le sigle de type, le vocabulaire réel étant codé
  (`PPRN-I`, `PPRI`, `PPRi`, `PPRL`, `PER-I`, `PPRIF`, `PPRN-MVT`, `PPRN-RGA`, `PPRN-S`) et non
  rédigé ; un plan multirisque compte dans chacune de ses familles ; un libellé illisible reste
  indéterminé plutôt que rangé par défaut.
- **Un tiers du bâti était exclu de la qualification des habitations** (audit 6), dans le sens
  favorable. `usage_1 = "Indifférencié"` représente 33,9 % du bâti mesuré et était écarté, alors
  que la règle de prudence documentée ne s'appliquait qu'aux usages vides — soit 0,0 % des cas.
  Effet mesuré : 28 → 83 habitations dans les 500 m sur une parcelle réelle, et le knock-out du
  recul de 500 m (art. L.515-44) se déclenche désormais.
- **Le WFS tronquait ses réponses en silence** (audit 5). En tissu dense, la distance à
  l'habitation la plus proche était fausse de deux ordres de grandeur — 558 m annoncés à Bourges
  pour 0 m réels — et toujours dans le sens favorable. Emprise dégressive et refus de toute
  distance non démontrée.
- **Une pente pouvait atteindre 1 665 %** (audit 4), sur 14 % des parcelles, par ajustement de plan
  mal conditionné.
- **L'arrêté de protection de biotope n'était alimenté par aucune source** (audit 6) : le knock-out
  existait mais ne pouvait mathématiquement jamais se déclencher, alors qu'un APPB est une
  protection absolue et non dérogeable (art. R.411-15 du code de l'environnement).
- **Une chaîne vide devenait zéro à l'ingestion** (audit 7). `Number('')` vaut 0 : une coordonnée
  non renseignée produisait `[0, 0]`, un point dans le golfe de Guinée, ingéré comme une géométrie
  valide sur un jeu de 46 000 monuments.
- **Les compteurs de risques plafonnaient à 50** (audits 6 et 7), faute de pagination : Menton
  annonçait 148 mouvements de terrain, Lyon 214 sites pollués. Sans effet sur la note — les courbes
  saturent avant — mais la valeur affichée était fausse.

### Corrigé — exactitude des livrables

- **Le nom du site Natura 2000 était toujours nul** (audit 6) et la carte étiquetait ces sites par
  leur **code** (audit 7) : « FR9301590 » au lieu de « Camargue ». Champ réel : `sitename`.
- **Aucun lien vers une fiche INPN ne fonctionnait** (audit 7), sur aucun calque : le champ est
  `url`, pas `url_fiche`.
- **Le nom de zonage naturel affiché désignait un autre site que la distance affichée** (audit 6),
  dans 4 cas sur 5 mesurés.
- **Le type de document d'urbanisme était toujours « non renseigné »** (audit 6). Champ réel :
  `du_type`.
- **Le séparateur décimal était un point** dans la colonne des poids du rapport et dans quatre
  autres textes (audit 5).

### Ajouté

- **Zones réglementaires des PPR** : la sévérité maximale des zones que le plan contient est
  exploitée, avec sa portée dite explicitement — ce n'est pas la zone applicable à la parcelle,
  qui reste à lire sur le règlement graphique.
- **Veille sur la dégradation silencieuse des sources** (`services/veille-sources.ts`) : un champ
  dont le taux de renseignement s'effondre sur un lot signale un contrat rompu, même si tout
  répond HTTP 200. C'est le signal qui manquait aux audits 5, 6 et 7.
- **Contrôles permanents en CI** : contrats des sources externes vérifiés contre des propriétés
  capturées en production, champs orphelins dans les deux sens, vérification par mutation, et
  échec de la CI si le référentiel réglementaire n'a pas été revu depuis 180 jours.
- **Instruments de calibration** : `scripts/campagne-validation.mjs` prépare et dépouille une
  campagne de vérification par un expert ; `docs/CALIBRATION.md` porte les emplacements de saisie
  des données réelles qui manquent (devis de raccordement, décisions de gestionnaire, rendements
  locaux, revue juridique datée, test utilisateur).
- **Reprise d'une base privée de sa table de suivi des migrations** (`migrate -- --adopter`).

### Modifié

- Le catalogue de couches ne contient plus que celles qu'une ingestion alimente : 18 des
  21 entrées étaient grisées, dont 7 fonctionnaient dans l'autre panneau sous le même nom.

## Méthode de publication

Une version se publie quand les trois conditions sont réunies :

1. la CI est verte, **mutation comprise** — une mutation qui passe signale un test décoratif ;
2. aucun défaut de fiabilité connu n'est ouvert, ou chacun est déclaré ici avec son effet ;
3. `REFERENTIEL_DERNIERE_VERIFICATION` a moins de 180 jours.

Le numéro de version est porté par `package.json` et une étiquette git `vX.Y.Z`.
