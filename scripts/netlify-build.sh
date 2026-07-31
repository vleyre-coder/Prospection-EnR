#!/usr/bin/env bash
#
# Construction de l'interface pour un hebergeur de sites statiques (Netlify, Vercel,
# Cloudflare Pages, GitHub Pages…).
#
# Variables :
#   URL_API       (obligatoire) racine de l'API, ex. https://enr-api.onrender.com
#   APPEL_DIRECT  (optionnel)   1 = l'interface appelle URL_API directement, en CORS.
#                               Par defaut, l'hebergeur reproxifie /api vers URL_API,
#                               ce qui garde une origine unique et evite tout CORS.
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
