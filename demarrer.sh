#!/usr/bin/env bash
#
# Lance l'application de prospection ENR.
#
#   ./demarrer.sh            demarre (construit les images au besoin)
#   ./demarrer.sh --arreter  arrete tout, sans rien effacer
#   ./demarrer.sh --etat     affiche l'etat des conteneurs et l'avancement des donnees
#   ./demarrer.sh --journaux suit les journaux de l'API
#   ./demarrer.sh --effacer  arrete ET supprime la base (tout est recharge au prochain lancement)
#
# Rien d'autre n'est requis que Docker. Migrations, secret de signature, compte
# administrateur et donnees nationales sont mis en place par l'application elle-meme.

set -euo pipefail
cd "$(dirname "$0")"

PORT_WEB="${PORT_WEB:-8080}"

# --- Validation de l'argument, avant tout le reste ---------------------------
# Une option mal orthographiee doit etre signalee comme telle, et non masquee par un
# message sur Docker.
case "${1:-}" in
  '' | --arreter | --journaux | --etat | --effacer) : ;;
  *)
    echo "Option inconnue : $1" >&2
    echo "Attendu : aucune option, --arreter, --journaux, --etat ou --effacer." >&2
    exit 1
    ;;
esac

# --- Choix de la commande Docker Compose -------------------------------------
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  cat >&2 <<'FIN'
Docker n'est pas disponible.

  macOS / Windows : installez Docker Desktop  →  https://docs.docker.com/get-docker/
  Linux           : sudo apt install docker.io docker-compose-plugin

Puis relancez ./demarrer.sh
FIN
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker est installe mais ne repond pas : demarrez Docker Desktop, puis relancez." >&2
  exit 1
fi

case "${1:-}" in
  --arreter)
    compose stop
    echo "Arrete. Vos donnees sont conservees. Relancez avec ./demarrer.sh"
    exit 0
    ;;
  --journaux)
    compose logs -f api
    exit 0
    ;;
  --etat)
    compose ps
    echo
    curl -fsS "http://localhost:${PORT_WEB}/api/sante" 2>/dev/null \
      | (command -v python3 >/dev/null && python3 -m json.tool || cat) \
      || echo "L'API ne repond pas encore."
    exit 0
    ;;
  --effacer)
    read -r -p "Supprimer la base et les donnees telechargees ? [oui/non] " reponse
    [ "$reponse" = "oui" ] || { echo "Annule."; exit 0; }
    compose down -v
    echo "Efface. Le prochain lancement rechargera les donnees nationales."
    exit 0
    ;;
esac

# --- Fichier de configuration ------------------------------------------------
# Facultatif : l'application fonctionne sans. On le cree pour que l'utilisateur ait un
# endroit evident ou regler le port ou les identifiants.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Fichier .env cree depuis .env.example."
fi

echo "Construction et demarrage (quelques minutes la premiere fois)…"
compose up -d --build

# --- Attente de l'interface --------------------------------------------------
printf "Demarrage"
for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:${PORT_WEB}/api/sante" >/dev/null 2>&1; then
    echo " — pret."
    break
  fi
  printf "."
  sleep 2
done
echo

ADRESSE="http://localhost:${PORT_WEB}"
cat <<FIN
------------------------------------------------------------------
  L'application est accessible : ${ADRESSE}

  Au premier lancement, les donnees nationales (35 000 communes,
  3 100 postes sources, monuments historiques, gisement de vent)
  se chargent en arriere-plan pendant 10 a 15 minutes. L'interface
  est utilisable pendant ce temps et affiche l'avancement.

  Identifiants : ceux de ADMIN_EMAIL / ADMIN_MOT_DE_PASSE dans .env.
  Si vous ne les avez pas definis, le mot de passe genere au premier
  demarrage est affiche par :   ./demarrer.sh --journaux

  Suivre le chargement  : ./demarrer.sh --journaux
  Arreter               : ./demarrer.sh --arreter
------------------------------------------------------------------
FIN

# Ouverture du navigateur, sans echouer si l'environnement n'en a pas.
if command -v open >/dev/null 2>&1; then open "$ADRESSE" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$ADRESSE" >/dev/null 2>&1 || true
fi
