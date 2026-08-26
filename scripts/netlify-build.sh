#!/usr/bin/env bash
#
# Construction de l'interface pour un hebergeur de sites statiques (Netlify, Vercel,
# Cloudflare Pages, GitHub Pages…).
#
# Variables :
#   URL_API            (obligatoire) racine de l'API, ex. https://enr-api.onrender.com
#   APPEL_DIRECT       (optionnel)   1 = l'interface appelle URL_API directement, en CORS.
#                                    Par defaut, l'hebergeur reproxifie /api vers URL_API,
#                                    ce qui garde une origine unique et evite tout CORS.
#   MOT_DE_PASSE_SITE  (obligatoire) mot de passe du portail d'acces de l'interface, voir
#                                    netlify/edge-functions/portail.ts. Au moins 16
#                                    caracteres, verifie par scripts/portail-mot-de-passe.mjs.
#   UTILISATEUR_SITE   (optionnel)   identifiant du portail ; « prospection » par defaut.
#   PORTAIL_DESACTIVE  (optionnel)   1 = assumer explicitement un site public, sans portail.
#
# Le choix par defaut — la reproxification — a une limite qu'il faut connaitre : les
# passerelles des hebergeurs statiques coupent les requetes longues (de l'ordre de la
# trentaine de secondes). Or la qualification d'une emprise interroge une vingtaine de
# sources officielles limitees en debit et peut durer plusieurs minutes. Si vous
# qualifiez de grandes emprises depuis l'interface, preferez APPEL_DIRECT=1, ou lancez
# la qualification par lots cote serveur.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${URL_API:-}" ]; then
  echo "URL_API n'est pas definie : l'interface ne saurait pas ou joindre l'API." >&2
  echo "Definissez-la dans les variables d'environnement du site, ex. :" >&2
  echo "  URL_API=https://enr-api.exemple.fr" >&2
  exit 1
fi

# Normalisation : pas de barre oblique finale, sinon les URLs contiendraient '//api'.
URL_API="${URL_API%/}"

# --- Portail d'acces ---------------------------------------------------------------------
#
# Le meme choix que `AUTH_DESACTIVEE` cote API : on ne publie pas sans authentification par
# distraction. Il faut soit un mot de passe, soit une declaration explicite de site public.
# La fonction edge, elle, se retire silencieusement si le mot de passe est absent : c'est
# ici, a la construction, que l'oubli doit se voir — un site inaccessible en production est
# une panne, un refus de construire est un rappel.
if [ "${PORTAIL_DESACTIVE:-}" = '1' ]; then
  echo "AVERTISSEMENT : PORTAIL_DESACTIVE=1. L'interface sera PUBLIQUE." >&2
  echo "  N'importe qui pourra ouvrir l'application et voir le formulaire de connexion," >&2
  echo "  la carte de fond et les zonages publics. Seules les donnees restent protegees," >&2
  echo "  par l'authentification de l'API." >&2
elif [ -z "${MOT_DE_PASSE_SITE:-}" ]; then
  echo "MOT_DE_PASSE_SITE n'est pas definie : le portail d'acces serait inactif et" >&2
  echo "l'interface publique. Deux issues, a choisir sciemment :" >&2
  echo >&2
  echo "  1. proteger le site — dans Netlify, Site configuration > Environment variables :" >&2
  echo "       MOT_DE_PASSE_SITE = $(node scripts/portail-mot-de-passe.mjs --proposer)" >&2
  echo "       UTILISATEUR_SITE  = prospection        (optionnel)" >&2
  echo >&2
  echo "  2. assumer un site public — ajouter PORTAIL_DESACTIVE=1 aux memes variables." >&2
  exit 1
else
  # La robustesse du mot de passe est verifiee, pas supposee : le portail n'a pas d'autre
  # frein a la force brute que le plafond par IP declare dans la fonction edge.
  node scripts/portail-mot-de-passe.mjs || exit 1
  echo "Portail d'acces actif : identifiant « ${UTILISATEUR_SITE:-prospection} »."
  echo "  Il protege l'INTERFACE, pas les donnees : /api reste garde par les jetons de l'API."
fi

# Les dependances sont installees par l'hebergeur avant l'execution de ce script
# (Netlify, Vercel et Cloudflare Pages le font a partir du package-lock.json).
npm run build -w @enr/core

if [ "${APPEL_DIRECT:-}" = '1' ]; then
  echo "Mode appel direct : l'interface appellera ${URL_API} en CORS."
  echo "Pensez a declarer l'origine de ce site dans ORIGINES_AUTORISEES cote API."
  VITE_URL_API="$URL_API" npm run build -w @enr/web
  # Aucune redirection /api : les appels partent vers une autre origine.
  printf '/*  /index.html  200\n' > apps/web/dist/_redirects
else
  echo "Mode reproxification : /api sera relaye vers ${URL_API}."
  # VITE_URL_API reste vide : l'interface appelle /api sur sa propre origine.
  npm run build -w @enr/web
  cat > apps/web/dist/_redirects <<FIN
# Relais vers l'API : meme origine pour le navigateur, aucun CORS a regler.
/api/*  ${URL_API}/api/:splat  200
# Application a page unique : toute autre URL rend index.html.
/*      /index.html            200
FIN
fi

echo "Interface construite dans apps/web/dist :"
cat apps/web/dist/_redirects
