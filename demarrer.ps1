# Lance l'application de prospection ENR sous Windows.
#
#   .\demarrer.ps1            demarre (construit les images au besoin)
#   .\demarrer.ps1 -Arreter   arrete tout, sans rien effacer
#   .\demarrer.ps1 -Etat      etat des conteneurs et avancement des donnees
#   .\demarrer.ps1 -Journaux  suit les journaux de l'API
#   .\demarrer.ps1 -Effacer   arrete ET supprime la base
#
# Si Windows refuse d'executer ce script, autorisez-le pour la session en cours :
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# Rien d'autre n'est requis que Docker Desktop. Migrations, secret de signature, compte
# administrateur et donnees nationales sont mis en place par l'application elle-meme.

param(
  [switch]$Arreter,
  [switch]$Etat,
  [switch]$Journaux,
  [switch]$Effacer
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$portWeb = if ($env:PORT_WEB) { $env:PORT_WEB } else { '8080' }
$adresse = "http://localhost:$portWeb"

# --- Verification de Docker --------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host @'
Docker n'est pas installe.

  Installez Docker Desktop : https://docs.docker.com/desktop/install/windows-install/
  Puis relancez .\demarrer.ps1
'@ -ForegroundColor Yellow
  exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker est installe mais ne repond pas : demarrez Docker Desktop, puis relancez." -ForegroundColor Yellow
  exit 1
}

if ($Arreter) {
  docker compose stop
  Write-Host "Arrete. Vos donnees sont conservees. Relancez avec .\demarrer.ps1"
  exit 0
}

if ($Journaux) {
  docker compose logs -f api
  exit 0
}

if ($Etat) {
  docker compose ps
  try {
    (Invoke-WebRequest -Uri "$adresse/api/sante" -UseBasicParsing).Content
  } catch {
    Write-Host "L'API ne repond pas encore."
  }
  exit 0
}

if ($Effacer) {
  $reponse = Read-Host "Supprimer la base et les donnees telechargees ? [oui/non]"
  if ($reponse -ne 'oui') { Write-Host 'Annule.'; exit 0 }
  docker compose down -v
  Write-Host "Efface. Le prochain lancement rechargera les donnees nationales."
  exit 0
}

# --- Fichier de configuration ------------------------------------------------
# Facultatif : l'application fonctionne sans. On le cree pour que l'utilisateur ait un
# endroit evident ou regler le port ou les identifiants.
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Fichier .env cree depuis .env.example.'
}

Write-Host 'Construction et demarrage (quelques minutes la premiere fois)…'
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host -NoNewline 'Demarrage'
foreach ($i in 1..90) {
  try {
    Invoke-WebRequest -Uri "$adresse/api/sante" -UseBasicParsing -TimeoutSec 3 *> $null
    Write-Host ' — pret.'
    break
  } catch {
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
  }
}

Write-Host @"

------------------------------------------------------------------
  L'application est accessible : $adresse

  Au premier lancement, les donnees nationales (35 000 communes,
  3 100 postes sources, monuments historiques, gisement de vent)
  se chargent en arriere-plan pendant 10 a 15 minutes. L'interface
  est utilisable pendant ce temps et affiche l'avancement.

  Identifiants : ceux de ADMIN_EMAIL / ADMIN_MOT_DE_PASSE dans .env.
  Si vous ne les avez pas definis, le mot de passe genere au premier
  demarrage est affiche par :   .\demarrer.ps1 -Journaux

  Suivre le chargement  : .\demarrer.ps1 -Journaux
  Arreter               : .\demarrer.ps1 -Arreter
------------------------------------------------------------------
"@

Start-Process $adresse
