@echo off
REM Ouvre le navigateur des que l'application repond.
REM
REM Appele en arriere-plan par demarrer.bat : ouvrir le navigateur tout de suite
REM afficherait une page d'erreur, le serveur ayant besoin de quelques secondes
REM pour compiler son schema et ouvrir son port.

set ADRESSE=http://localhost:3000

for /l %%i in (1,1,120) do (
  curl -s -o nul -m 2 "%ADRESSE%/api/sante" >nul 2>nul
  if not errorlevel 1 (
    start "" "%ADRESSE%"
    exit /b 0
  )
  timeout /t 2 /nobreak >nul
)

REM Au bout de quatre minutes, l'ouverture automatique est abandonnee : le
REM message affiche dans la fenetre du serveur indique l'adresse a saisir.
exit /b 1
