/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LE BLOC COURRIERS — ce qu'il ne doit jamais garder, et ce qu'il ne doit jamais couper
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * TROIS CHOSES SE JOUENT ICI, et aucune ne se verrait a la relecture d'un ecran.
 *
 *   1. CE QUE LE POSTE CONSERVE. Le bloc de signature revient a chaque courrier : le memoriser est
 *      une commodite evidente. Le NOM et l'ADRESSE du destinataire, eux, sont les deux seuls
 *      champs qui portent des donnees personnelles. L'arbitrage du proprietaire du projet est la
 *      saisie libre et persistee — cote serveur, ou elle est journalisee. Les conserver dans le
 *      navigateur les sortirait de ce dispositif : ils y dormiraient sans trace, sans effacement
 *      et sans rapport avec la parcelle ouverte, jusqu'a reapparaitre dans le courrier suivant,
 *      adresse a quelqu'un d'autre. C'est un defaut qui ne se voit qu'une fois le courrier parti.
 *
 *   2. CE QUE LE `mailto:` COUPE. Un client de messagerie tronque une URL trop longue, en silence.
 *      Un courrier coupe au milieu d'une phrase qui part sur papier a en-tete est une faute
 *      visible par le destinataire, et par lui seul.
 *
 *   3. QUEL COURRIER EST OUVERT. Deux courriers, deux destinataires, deux regimes. Le formulaire
 *      de demande d'identite ne doit PAS demander le nom du proprietaire : son objet meme est de
 *      l'obtenir, et un champ qui le reclame est un contresens qui se propage au courrier.
 *
 * `renderToStaticMarkup` n'execute ni les effets ni les clics : il dit ce que le composant produit
 * a partir d'un etat donne. Le choix du type de courrier est un etat React, donc le rendu ne
 * montre que le premier onglet — c'est justement celui dont l'invariant 3 parle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import {
  BlocCourriers,
  ChampsDestinataire,
  CHAMPS_MEMORISES,
  filtrerMemorisables,
  lienMessagerie,
} from '../src/components/BlocCourriers.js';
import { rendre, texte } from './aides/rendu.js';

test('AUCUNE DONNEE PERSONNELLE N’EST CONSERVEE SUR LE POSTE', () => {
  /*
   * L'INVARIANT LE PLUS IMPORTANT DE CE FICHIER. La liste est close et verifiee ici, et non
   * seulement relue : un champ ajoute par commodite — « on garde aussi l'adresse, c'est plus
   * pratique » — doit faire echouer un test, pas passer une relecture.
   */
  const interdits = ['destinataire', 'adresse'];
  for (const champ of interdits) {
    assert.ok(
      !(CHAMPS_MEMORISES as readonly string[]).includes(champ),
      `« ${champ} » porte une donnee personnelle : il ne doit jamais etre memorise sur le poste`,
    );
  }

  // Et le filtre tient a la LECTURE aussi : un enregistrement laisse par une version anterieure
  // reviendrait sinon indefiniment, puisque personne ne relit un `localStorage`.
  const pollue = filtrerMemorisables({
    expediteur: 'Dimeo Énergie',
    destinataire: 'Madame Dupont',
    adresse: '3 rue des Tilleuls, 28399 Tillay-le-Péneux',
  });
  assert.deepEqual(pollue, { expediteur: 'Dimeo Énergie' });
});

test('UN COURRIER TROP LONG N’EST PAS OFFERT AU LIEN DE MESSAGERIE', () => {
  /*
   * La coupe d'un `mailto:` est SILENCIEUSE : le client ouvre un brouillon qui a l'air complet, et
   * la phrase manquante ne se decouvre qu'a la reception. Mieux vaut donc pas de raccourci du tout.
   */
  const court = lienMessagerie('a@b.fr', { objet: 'Objet', corps: 'Bonjour.' });
  assert.ok(court?.startsWith('mailto:a%40b.fr?subject=Objet&body='));

  const long = lienMessagerie('a@b.fr', { objet: 'Objet', corps: 'é'.repeat(700) });
  assert.equal(long, null, 'un corps qui deborde doit retirer le raccourci, pas etre tronque');

  // La mesure porte bien sur l'URL ENCODEE : un accent y occupe neuf caracteres, pas un.
  assert.ok('é'.repeat(700).length < 1900, 'le texte brut, lui, tiendrait — c’est tout le piege');
});

test('LE FORMULAIRE DE DEMANDE D’IDENTITE NE RECLAME PAS L’IDENTITE', () => {
  /*
   * Contresens qui se propage au courrier : le courrier au service de la publicite fonciere est
   * celui qu'on envoie PARCE QU'ON N'A PAS le nom du proprietaire.
   */
  const html = rendre(h(BlocCourriers, { idu: '28399000ZC0123' }));
  const lu = texte(html);

  assert.match(lu, /Demande d’identité/, 'les deux courriers doivent etre proposes');
  assert.match(lu, /Premier contact/);
  assert.match(lu, /Raison sociale de l’expéditeur/, 'le bloc de signature est toujours demande');
  assert.doesNotMatch(lu, /Destinataire/, 'pas de destinataire sur la demande d’identité');
  assert.doesNotMatch(lu, /Adresse du destinataire/);

  // Et l'ecran dit pourquoi le fondement reste vide, sans quoi l'operateur le croit oublie.
  assert.match(lu, /fondement de la demande est laissé à compléter/i);
});

test('L’ECRAN ANNONCE CE QU’IL FAIT DE LA SAISIE NOMINATIVE', () => {
  /*
   * L'API journalise la preparation d'un courrier nominatif. Un dispositif de traçabilite que
   * l'operateur ignore est un dispositif qu'il contourne sans le vouloir — en recopiant le nom
   * ailleurs, par exemple.
   */
  const lu = texte(
    rendre(
      h(ChampsDestinataire, {
        destinataire: '',
        adresse: '',
        surDestinataire: () => {},
        surAdresse: () => {},
      }),
    ),
  );
  assert.match(lu, /Destinataire/, 'les champs nominatifs sont bien la, pour ce courrier-ci');
  assert.match(lu, /ne sont pas conservés sur ce poste/);
  assert.match(lu, /journalisée/);
});
