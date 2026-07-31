#!/usr/bin/env bash
#
# Lancement sans Docker, sur macOS ou Linux.
#
#   ./demarrer-sans-docker.sh
#
# Deux prerequis, a installer une seule fois :
#   - Node.js 20 ou plus              https://nodejs.org/fr/download
#   - PostgreSQL avec PostGIS
#       macOS : https://postgresapp.com  (PostGIS est deja inclus)
#       Debian/Ubuntu : sudo apt install postgresql postgresql-16-postgis-3
#
# L'equivalent Windows est demarrer.bat. La voie Docker (./demarrer.sh) reste
# plus simple quand Docker fonctionne : elle n'exige aucun de ces prerequis.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
BASE=prospection_enr

echo
echo "  =========================================================="
echo "    Prospection EnR - lancement sans Docker"
echo "  =========================================================="
echo

# ------------------------------------------------------------------ Node.js --
if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js n'est pas installe : https://nodejs.org/fr/download" >&2
  exit 1
fi
majeur=$(node -v | sed 's/^v//; s/\..*//')
if [ "$majeur" -lt 20 ]; then
  echo "  [X] Node.js $(node -v) est trop ancien : il faut la version 20 ou plus." >&2
  exit 1
fi
echo "  [OK]  Node.js $(node -v)"

# --------------------------------------------------------------- PostgreSQL --
if ! command -v psql >/dev/null 2>&1; then
  cat >&2 <<'FIN'
  [X] PostgreSQL n'est pas installe, ou psql n'est pas dans le PATH.

      macOS         : https://postgresapp.com (PostGIS inclus), puis, dans
                      Preferences, cocher l'ajout des outils en ligne de commande.
      Debian/Ubuntu : sudo apt install postgresql postgresql-16-postgis-3
FIN
  exit 1
fi
echo "  [OK]  PostgreSQL trouve"

# ------------------------------------------------- La base est-elle prete ? --
# Le test porte sur PostGIS et non sur la seule connexion : c'est PostGIS qui
# manque le plus souvent, et sans lui l'application ne peut rien afficher.
if PGPASSWORD=enr psql -U enr -h 127.0.0.1 -d "$BASE" -c 'SELECT postgis_version()' >/dev/null 2>&1; then
  echo "  [OK]  Base de donnees prete"
else
  echo "  Preparation de la base (a faire une seule fois)…"

  # Il n'y a pas UNE facon de se connecter en administrateur : elle depend de
  # l'installation. Postgres.app fait de l'utilisateur courant un
  # superutilisateur ; les paquets Linux reservent ce role au compte systeme
  # postgres, joignable par le socket. On essaie donc dans l'ordre du plus
  # courant au plus contraignant, plutot que d'en supposer une seule.
  essayer_admin() { "$@" -d postgres -c 'SELECT 1' >/dev/null 2>&1; }

  admin_cmd=''
  if essayer_admin psql -h 127.0.0.1; then
    admin_cmd='psql -h 127.0.0.1'
  elif essayer_admin psql; then
    admin_cmd='psql'
  elif command -v sudo >/dev/null 2>&1 && essayer_admin sudo -n -u postgres psql; then
    admin_cmd='sudo -n -u postgres psql'
  elif essayer_admin psql -U postgres -h 127.0.0.1; then
    admin_cmd='psql -U postgres -h 127.0.0.1'
  else
    cat >&2 <<'FIN'
  [X] Impossible de se connecter a PostgreSQL en administrateur.

      Verifiez d'abord que le service est demarre. Si c'est le cas, preparez la
      base a la main, puis relancez ce script :

        sudo -u postgres psql -c "CREATE ROLE enr LOGIN PASSWORD 'enr'"
        sudo -u postgres psql -c "CREATE DATABASE prospection_enr OWNER enr"
        sudo -u postgres psql -d prospection_enr -c "CREATE EXTENSION postgis"
FIN
    exit 1
  fi

  # Le decoupage en mots de $admin_cmd est voulu : la variable porte une
  # commande complete, choisie ci-dessus.
  # shellcheck disable=SC2086
  admin_psql() { $admin_cmd "$@"; }

  admin_psql -d postgres -c \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'enr') THEN CREATE ROLE enr LOGIN PASSWORD 'enr'; END IF; END \$\$" >/dev/null
  admin_psql -d postgres -c "CREATE DATABASE $BASE OWNER enr" >/dev/null 2>&1 || true

  if ! admin_psql -d "$BASE" -c \
    'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist' >/dev/null; then
    echo "  [X] PostGIS n'est pas disponible dans cette installation PostgreSQL." >&2
    echo "      macOS : Postgres.app l'inclut. Linux : installez postgresql-<version>-postgis-3." >&2
    exit 1
  fi
  echo "  [OK]  Base de donnees preparee"
fi

# --------------------------------------------------------------------- .env --
# Installation locale : ecoute uniquement sur cette machine et sans
# authentification, pour eviter un ecran de connexion inutile sur un poste
# personnel. Ne PAS utiliser tel quel sur un serveur partage.
if [ ! -f .env ]; then
  cat > .env <<FIN
DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/$BASE
NODE_ENV=development
HOTE=127.0.0.1
PORT=$PORT
AUTH_DESACTIVEE=true
MIGRATIONS_AUTO=true
AMORCAGE_AUTO=true
FIN
  echo "  [OK]  Fichier .env cree"
fi

# --------------------------------------------------------------- Composants --
if [ ! -d node_modules ]; then
  echo
  echo "  Installation des composants - comptez 2 a 5 minutes la premiere fois."
  npm install
fi

echo
echo "  Compilation de l'application…"
npm run build

cat <<FIN

  ==========================================================
    Demarrage sur http://localhost:${PORT}

    Au PREMIER lancement, les donnees nationales se chargent
    en arriere-plan pendant 10 a 15 minutes. L'application est
    utilisable pendant ce temps et affiche l'avancement.

    Pour arreter : Ctrl+C
  ==========================================================

FIN

# Ouverture du navigateur des que le port repond, sans bloquer le demarrage.
(
  for _ in $(seq 1 120); do
    if curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/sante" >/dev/null 2>&1; then
      command -v open >/dev/null 2>&1 && open "http://localhost:${PORT}" >/dev/null 2>&1 && exit 0
      command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 && exit 0
      exit 0
    fi
    sleep 2
  done
) &

exec node apps/api/dist/serveur.js
