/**
 * Ecran de connexion.
 *
 * N'apparait que lorsque l'authentification est active : en developpement
 * (AUTH_DESACTIVEE), l'API repond directement avec un utilisateur et cet ecran est
 * saute. Le message d'erreur ne distingue jamais « compte inconnu » de « mot de passe
 * errone », conformement au comportement de l'API.
 */

import { useState } from 'react';
import { api, definirJeton, ErreurApi, type Utilisateur } from '../api/client.js';

export function Connexion({ onConnecte }: { onConnecte: (u: Utilisateur) => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const soumettre = (e: React.FormEvent): void => {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    void api
      .connexion(email.trim(), motDePasse)
      .then((r) => {
        definirJeton(r.token);
        onConnecte(r.utilisateur);
      })
      .catch((err: ErreurApi) =>
        setErreur(
          err.estReseau
            ? "L'API est injoignable. Verifiez que le serveur est demarre."
            : err.message,
        ),
      )
      .finally(() => setEnCours(false));
  };

  return (
    <div className="application">
      <form className="connexion" onSubmit={soumettre}>
        <h1>Prospection ENR</h1>
        <p className="connexion-sous-titre">
          Identification et priorisation des parcelles a demarcher, filiere par filiere.
        </p>

        <label htmlFor="connexion-email">Adresse electronique</label>
        <input
          id="connexion-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="connexion-mdp">Mot de passe</label>
        <input
          id="connexion-mdp"
          type="password"
          autoComplete="current-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
        />

        {erreur && (
          <p className="connexion-erreur" role="alert">
            {erreur}
          </p>
        )}

        <button type="submit" className="bouton bouton-principal" disabled={enCours}>
          {enCours ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="connexion-aide">
          Au premier demarrage, les identifiants sont ceux definis par <code>ADMIN_EMAIL</code> et{' '}
          <code>ADMIN_MOT_DE_PASSE</code>. Si vous ne les avez pas definis, le mot de passe genere
          est affiche dans les journaux du serveur (<code>docker compose logs api</code>).
        </p>
      </form>
    </div>
  );
}
