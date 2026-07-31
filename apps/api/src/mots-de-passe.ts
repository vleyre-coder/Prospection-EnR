/**
 * Hachage et verification des mots de passe.
 *
 * scrypt avec un sel par utilisateur, et comparaison en temps constant pour ne pas
 * fuiter d'information par le temps de reponse. Module isole afin que l'amorcage
 * puisse creer un compte sans dependre des routes HTTP.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hacherMotDePasse(motDePasse: string): string {
  const sel = randomBytes(16).toString('hex');
  const cle = scryptSync(motDePasse, sel, 64).toString('hex');
  return `scrypt$${sel}$${cle}`;
}

export function verifierMotDePasse(motDePasse: string, hash: string): boolean {
  const [algo, sel, cle] = hash.split('$');
  if (algo !== 'scrypt' || !sel || !cle) return false;
  const candidat = scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(cle, 'hex');
  return candidat.length === attendu.length && timingSafeEqual(candidat, attendu);
}

/** Mot de passe initial lisible, genere quand l'exploitant n'en a fourni aucun. */
export function motDePasseAleatoire(): string {
  // Alphabet sans caracteres ambigus (0/O, 1/l/I) : ce mot de passe est destine a etre
  // recopie a la main depuis les journaux.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const octets = randomBytes(20);
  return Array.from(octets, (o) => alphabet[o % alphabet.length]).join('');
}
