/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PROFILS DE RECHERCHE — le cahier des charges d'un developpeur, rejouable
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CES ROUTES PERMETTENT, ET CE QU'ELLES INTERDISENT. Elles editent le seuil DEVELOPPEUR,
 * jamais le seuil REGLEMENTAIRE : ce dernier vient du classeur, il est genere dans le code et
 * aucune route n'expose de quoi le modifier. C'est le §2.3 du cahier des charges, et le refus est
 * structurel — il n'y a simplement pas de chemin.
 *
 * TROIS CONTROLES QUI COMPTENT, dans l'ordre ou ils se posent :
 *
 *   1. l'identifiant de contrainte EXISTE dans le referentiel, et appartient a la filiere du
 *      profil. Sans cela, une faute de frappe enregistrerait un seuil que rien n'appliquera
 *      jamais — et le developpeur croirait son exigence prise en compte ;
 *   2. la contrainte est PARAMETRABLE, c'est-a-dire mesurable. Accepter un seuil sur une
 *      contrainte sans couche SIG promet un filtre qui ne filtrera rien ;
 *   3. le seuil DURCIT. Un seuil plus permissif que la reglementation ferait remonter du foncier
 *      que le droit interdit, dans un dossier de prospection remis a un tiers. C'est la faute la
 *      plus grave que ce formulaire puisse produire, et elle serait parfaitement muette.
 */

import type { FastifyInstance } from 'fastify';
import {
  FILIERES_REFERENTIEL,
  assouplit,
  conditionDeReference,
  contrainteParId,
  contraintesDeFiliere,
  contraintesParametrables,
  raisonsNonAutomatique,
  sensReglementaire,
  sensRequis,
  type ContrainteReferentiel,
  type FiliereReferentiel,
  type SensSeuil,
} from '@enr/core';
import * as depot from '../depots/profils.js';
import { erreur } from './erreurs.js';
import { ErreurValidation, lecteur } from '../validation.js';

/** Forme d'un identifiant UUID, celle que la base produit pour un profil. */
const MOTIF_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Plafond du nombre de seuils d'un profil.
 *
 * 25 contraintes sont parametrables aujourd'hui, toutes filieres confondues, et un profil ne
 * concerne qu'une filiere. La borne est donc large — elle ne genera personne — mais elle existe :
 * sans elle, un corps de requete pourrait porter des milliers de lignes et autant d'insertions
 * dans une seule transaction.
 */
const MAX_SEUILS = 50;

/** Un seuil valide, pret a etre ecrit. */
interface SeuilValide {
  contrainteId: string;
  valeur: number;
  unite: string;
  sens: SensSeuil | null;
  motif: string;
}

/**
 * Valide la liste des seuils d'un profil contre le referentiel de sa filiere.
 *
 * Leve `ErreurValidation`, que le serveur rend deja en 400 avec le champ fautif. Chaque refus
 * nomme la contrainte concernee : « le seuil est invalide » sur un formulaire de vingt lignes
 * n'aide personne a corriger.
 */
function seuilsValides(brut: unknown, filiere: FiliereReferentiel): SeuilValide[] {
  if (brut === undefined || brut === null) return [];
  if (!Array.isArray(brut)) throw new ErreurValidation('seuils', 'Champ `seuils` : tableau attendu.');
  if (brut.length > MAX_SEUILS) {
    throw new ErreurValidation('seuils', `Champ \`seuils\` : au plus ${MAX_SEUILS} seuils par profil.`);
  }

  const parametrables = new Map(
    contraintesParametrables(contraintesDeFiliere(filiere)).map((c) => [c.id, c]),
  );
  const vus = new Set<string>();
  const valides: SeuilValide[] = [];

  for (const entree of brut) {
    const c = lecteur(entree, 'seuil');
    const contrainteId = c.texte('contrainteId', { max: 200, motif: /^[a-z_]+__[a-z0-9_]+$/, description: 'identifiant de contrainte' });
    const valeur = c.nombre('valeur');
    const sens = c.parmi('sens', ['min', 'max'] as const);
    const motif = c.texteOuVide('motif', { max: 2000 });
    c.refuserInconnus();

    if (!contrainteId) throw new ErreurValidation('contrainteId', 'Champ `contrainteId` requis.');
    if (valeur === undefined) {
      throw new ErreurValidation('valeur', `Seuil « ${contrainteId} » : champ \`valeur\` requis.`);
    }

    /*
     * Un doublon est REFUSE, pas ecrase. La cle primaire (profil, contrainte) le rejetterait de
     * toute facon en 500 ; le refuser ici rend une 400 lisible. Et si l'on ecrasait, l'operateur
     * n'aurait aucun moyen de savoir laquelle de ses deux saisies a survecu.
     */
    if (vus.has(contrainteId)) {
      throw new ErreurValidation('seuils', `Seuil en double pour « ${contrainteId} ».`);
    }
    vus.add(contrainteId);

    const contrainte = contrainteParId(contrainteId);
    if (!contrainte) {
      throw new ErreurValidation(
        'contrainteId',
        `Contrainte inconnue : « ${contrainteId} ». Une faute de frappe enregistrerait un seuil que rien n'appliquerait.`,
      );
    }
    if (contrainte.filiere !== filiere) {
      throw new ErreurValidation(
        'contrainteId',
        `La contrainte « ${contrainte.nom} » releve de la filiere ${contrainte.filiere}, pas de ${filiere}.`,
      );
    }

    const parametrable = parametrables.get(contrainteId);
    if (!parametrable) {
      throw new ErreurValidation(
        'contrainteId',
        `La contrainte « ${contrainte.nom} » n'est pas parametrable : ` +
          `${raisonsNonAutomatique(contrainte).join(', ')}. Un seuil saisi ici ne filtrerait rien.`,
      );
    }

    valides.push({
      contrainteId,
      valeur,
      unite: uniteAttendue(parametrable),
      sens: sensValide(parametrable, sens, valeur),
      motif: motif ?? '',
    });
  }

  return valides;
}

/**
 * L'unite est RECOPIEE du referentiel, jamais lue du corps de requete.
 *
 * Laisser le client l'envoyer ouvrirait la porte a « 400 » en km la ou la contrainte se mesure en
 * metres : un facteur mille, accepte sans bruit, qui viderait ou remplirait la recherche selon le
 * sens. L'operateur choisit une valeur, pas une unite.
 */
function uniteAttendue(contrainte: ContrainteReferentiel): string {
  return conditionDeReference(contrainte)?.unite ?? '';
}

/**
 * Le sens : recopie quand le classeur l'etablit, exige de l'operateur sinon — et jamais devine.
 *
 * Le durcissement est verifie ICI parce que c'est le seul endroit qui connaisse a la fois la
 * valeur saisie et la condition reglementaire.
 */
function sensValide(
  contrainte: ContrainteReferentiel,
  saisi: SensSeuil | undefined,
  valeur: number,
): SensSeuil | null {
  const reference = conditionDeReference(contrainte);
  const etabli = sensReglementaire(contrainte);

  if (!sensRequis(contrainte)) {
    /*
     * Le sens est etabli par le classeur. Un `sens` envoye quand meme est REFUSE et non ignore :
     * l'ignorer laisserait croire au client que son choix a ete pris en compte, alors que la
     * contrainte s'appliquera dans l'autre sens. Une contrainte inversee en silence est
     * exactement ce que ce module doit rendre impossible.
     */
    if (saisi !== undefined && saisi !== etabli) {
      throw new ErreurValidation(
        'sens',
        `« ${contrainte.nom} » : le classeur etablit le sens (« ${contrainte.seuilReglementaire} »), ` +
          'il ne peut pas etre choisi.',
      );
    }
    if (reference && assouplit(reference, valeur)) {
      throw new ErreurValidation(
        'valeur',
        `« ${contrainte.nom} » : ${valeur} ${reference.unite} assouplit la reglementation ` +
          `(« ${contrainte.seuilReglementaire} »). Un seuil developpeur ne peut que durcir.`,
      );
    }
    return null;
  }

  if (saisi === undefined) {
    throw new ErreurValidation(
      'sens',
      `« ${contrainte.nom} » : le classeur ne dit pas si « ${contrainte.seuilReglementaire} » est ` +
        'un minimum ou un maximum. Precisez `sens` : "min" ou "max".',
    );
  }
  return saisi;
}

/** Lit le corps commun a la creation et au remplacement. */
function ecritureValide(corps: unknown): depot.EcritureProfil {
  const c = lecteur(corps);
  const nom = c.texte('nom', { max: 120 });
  const filiere = c.parmi('filiere', FILIERES_REFERENTIEL);
  const developpeur = c.texteOuVide('developpeur', { max: 200 });
  const notes = c.texteOuVide('notes', { max: 5000 });
  // Les criteres passent par la validation de la recherche, a la RELECTURE et non a l'ecriture :
  // voir `GET /api/profils/:id`. Les stocker tels quels permet de conserver un profil dont un
  // filtre a disparu, plutot que de refuser de l'enregistrer.
  const criteres = c.brutValideAilleurs('criteres');
  const seuilsBruts = c.brutValideAilleurs('seuils');
  c.refuserInconnus();

  if (!nom) throw new ErreurValidation('nom', 'Champ `nom` requis : c’est ce que l’operateur lit dans la liste.');
  if (!filiere) {
    throw new ErreurValidation('filiere', `Champ \`filiere\` requis, parmi ${FILIERES_REFERENTIEL.join(', ')}.`);
  }
  if (criteres !== undefined && criteres !== null) {
    if (typeof criteres !== 'object' || Array.isArray(criteres)) {
      throw new ErreurValidation('criteres', 'Champ `criteres` : objet JSON attendu.');
    }
  }

  return {
    nom,
    filiere,
    developpeur: developpeur ?? null,
    criteres: (criteres as Record<string, unknown> | undefined) ?? {},
    notes: notes ?? null,
    seuils: seuilsValides(seuilsBruts, filiere),
  };
}

export async function routesProfils(app: FastifyInstance): Promise<void> {
  /**
   * Les contraintes qu'un developpeur peut parametrer, avec ce qu'il faut pour les afficher.
   *
   * L'interface a besoin de bien plus que des identifiants : le texte reglementaire tel quel, la
   * reference, l'unite, et surtout si le sens doit etre demande. Sans cela elle devrait
   * reimplementer les regles du referentiel cote client, et les deux divergeraient.
   */
  app.get<{ Querystring: { filiere?: string } }>('/api/profils/contraintes', async (req, rep) => {
    const filiere = req.query.filiere;
    if (filiere !== undefined && !(FILIERES_REFERENTIEL as readonly string[]).includes(filiere)) {
      return erreur(rep, 400, 'filiere_invalide', `Filiere inconnue : ${filiere}`);
    }
    const filieres = filiere
      ? [filiere as FiliereReferentiel]
      : [...FILIERES_REFERENTIEL];

    return filieres.flatMap((f) =>
      contraintesParametrables(contraintesDeFiliere(f)).map((c) => {
        const reference = conditionDeReference(c);
        return {
          id: c.id,
          filiere: c.filiere,
          categorie: c.categorie,
          nom: c.nom,
          description: c.description,
          // Recopie du classeur, jamais reformule : c'est ce que l'operateur doit pouvoir citer.
          seuilReglementaire: c.seuilReglementaire,
          referenceReglementaire: c.referenceReglementaire,
          coucheSig: c.coucheSig,
          caractere: c.caractere,
          unite: reference?.unite ?? '',
          valeurReglementaire: reference?.valeur ?? null,
          operateurReglementaire: reference?.operateur ?? null,
          sensEtabli: sensReglementaire(c),
          sensRequis: sensRequis(c),
          /**
           * Le seuil reglementaire est-il ferme ?
           *
           * `false` n'empeche pas de parametrer — c'est meme la que l'exigence du developpeur sert
           * le plus — mais l'interface doit le DIRE, sinon l'operateur croira que le filtre
           * etablit la conformite.
           */
          reglementaireEtabli: raisonsNonAutomatique(c).length === 0,
          raisons: raisonsNonAutomatique(c),
        };
      }),
    );
  });

  app.get<{ Querystring: { filiere?: string } }>('/api/profils', async (req, rep) => {
    const filiere = req.query.filiere;
    if (filiere !== undefined && !(FILIERES_REFERENTIEL as readonly string[]).includes(filiere)) {
      return erreur(rep, 400, 'filiere_invalide', `Filiere inconnue : ${filiere}`);
    }
    return depot.listerProfils(filiere as FiliereReferentiel | undefined);
  });

  app.get<{ Params: { id: string } }>('/api/profils/:id', async (req, rep) => {
    if (!MOTIF_UUID.test(req.params.id)) {
      return erreur(rep, 400, 'identifiant_invalide', 'Identifiant de profil invalide');
    }
    const profil = await depot.profilParId(req.params.id);
    if (!profil) return erreur(rep, 404, 'profil_introuvable', 'Profil introuvable');

    /**
     * SEUILS ORPHELINS : signales, jamais effaces ni passes sous silence.
     *
     * Une revision du classeur peut renommer ou retirer une contrainte. Le seuil enregistre pour
     * elle ne s'appliquera plus. Le supprimer ferait disparaitre une exigence du developpeur sans
     * trace ; l'ignorer ferait croire qu'elle est toujours active. Le profil est donc rendu avec
     * la liste, et l'interface affiche un avertissement.
     */
    const orphelins = profil.seuils.filter((s) => contrainteParId(s.contrainteId) === null);
    return { ...profil, seuilsOrphelins: orphelins.map((s) => s.contrainteId) };
  });

  app.post('/api/profils', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre rôle ne permet pas d’enregistrer un profil');
    }
    const ecriture = ecritureValide(req.body);
    try {
      const profil = await depot.creerProfil(ecriture, req.utilisateur?.email ?? 'systeme');
      return rep.code(201).send(profil);
    } catch (err) {
      if (err instanceof depot.NomDeProfilPris) {
        return erreur(rep, 409, 'nom_de_profil_pris', err.message);
      }
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>('/api/profils/:id', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre rôle ne permet pas de modifier un profil');
    }
    if (!MOTIF_UUID.test(req.params.id)) {
      return erreur(rep, 400, 'identifiant_invalide', 'Identifiant de profil invalide');
    }
    const ecriture = ecritureValide(req.body);
    try {
      const profil = await depot.remplacerProfil(
        req.params.id,
        ecriture,
        req.utilisateur?.email ?? 'systeme',
      );
      if (!profil) return erreur(rep, 404, 'profil_introuvable', 'Profil introuvable');
      return profil;
    } catch (err) {
      if (err instanceof depot.NomDeProfilPris) {
        return erreur(rep, 409, 'nom_de_profil_pris', err.message);
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/profils/:id', async (req, rep) => {
    if (req.utilisateur?.role === 'lecture') {
      return erreur(rep, 403, 'lecture_seule', 'Votre rôle ne permet pas de supprimer un profil');
    }
    if (!MOTIF_UUID.test(req.params.id)) {
      return erreur(rep, 400, 'identifiant_invalide', 'Identifiant de profil invalide');
    }
    const supprime = await depot.supprimerProfil(req.params.id);
    if (!supprime) return erreur(rep, 404, 'profil_introuvable', 'Profil introuvable');
    return rep.code(204).send();
  });
}
