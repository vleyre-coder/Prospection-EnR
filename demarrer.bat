@echo off
REM ===========================================================================
REM  Prospection EnR - lancement sur Windows, SANS Docker et SANS Git.
REM
REM  Double-cliquez sur ce fichier. Il verifie ce qui est installe, prepare la
REM  base de donnees si besoin, compile l'application et l'ouvre dans votre
REM  navigateur.
REM
REM  Deux logiciels doivent etre installes au prealable (une seule fois) :
REM    1. Node.js        https://nodejs.org/fr/download
REM    2. PostgreSQL     https://www.postgresql.org/download/windows/
REM       en cochant PostGIS dans le Stack Builder a la fin de l'installation.
REM
REM  Voir docs/WINDOWS.md pour la marche a suivre en images.
REM ===========================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"
title Prospection EnR

echo.
echo  ==========================================================
echo    Prospection EnR
echo  ==========================================================
echo.

REM --------------------------------------------------------------- Node.js ---
where node >nul 2>nul
if errorlevel 1 goto pas_de_node

for /f "delims=" %%v in ('node -v') do set VERSION_NODE=%%v
set VERSION_NODE=!VERSION_NODE:v=!
for /f "tokens=1 delims=." %%a in ("!VERSION_NODE!") do set MAJEUR_NODE=%%a
if !MAJEUR_NODE! LSS 20 goto node_trop_ancien
echo  [OK]  Node.js !VERSION_NODE!

where npm >nul 2>nul
if errorlevel 1 goto pas_de_node

REM ------------------------------------------------- Emplacement du dossier ---
REM Verification faite AVANT l'installation des composants, qui prend plusieurs
REM minutes : la decouvrir au moment de la compilation ferait perdre ce temps.
REM
REM Un « & » dans le chemin casse la compilation de facon deroutante. npm ajoute
REM le dossier node_modules\.bin au PATH puis appelle cmd.exe, qui traite le « & »
REM comme un separateur de commandes : le PATH est coupe en deux et les outils de
REM compilation deviennent introuvables. Meme probleme avec ^, ! et %.
REM Node fait le test, plutot que batch : il est deja verifie present, et il n'a
REM pas les pieges d'analyse de cmd sur ces caracteres precis.
node -e "const p = process.cwd(); if (/[&^!%%]/.test(p)) process.exit(3); if (p.length > 130) process.exit(4);"
if errorlevel 4 goto chemin_trop_long
if errorlevel 3 goto chemin_caracteres_interdits
echo  [OK]  Emplacement du dossier utilisable

REM ------------------------------------------------------------ PostgreSQL ---
REM psql n'est pas toujours ajoute au PATH par l'installateur : on cherche aussi
REM aux emplacements standards, de la version la plus recente a la plus ancienne.
set PSQL=
where psql >nul 2>nul
if not errorlevel 1 set PSQL=psql

if "!PSQL!"=="" (
  for %%V in (18 17 16 15 14) do (
    if "!PSQL!"=="" (
      if exist "C:\Program Files\PostgreSQL\%%V\bin\psql.exe" set PSQL=C:\Program Files\PostgreSQL\%%V\bin\psql.exe
    )
  )
)
if "!PSQL!"=="" goto pas_de_postgres
echo  [OK]  PostgreSQL trouve

REM ------------------------------------------------- La base est-elle prete ---
REM Le test porte sur PostGIS et non sur la seule connexion : c'est PostGIS qui
REM manque le plus souvent, et sans lui l'application ne peut rien afficher.
set PGPASSWORD=enr
"!PSQL!" -U enr -h 127.0.0.1 -d prospection_enr -c "SELECT postgis_version()" >nul 2>nul
if not errorlevel 1 (
  echo  [OK]  Base de donnees prete
  goto configuration
)

echo.
echo  La base de donnees doit etre preparee. C'est a faire une seule fois.
echo  Entrez le mot de passe du compte "postgres" : celui que vous avez choisi
echo  pendant l'installation de PostgreSQL.
echo.
set "MDP_POSTGRES="
set /p MDP_POSTGRES=  Mot de passe postgres :
if "!MDP_POSTGRES!"=="" goto mot_de_passe_vide

set PGPASSWORD=!MDP_POSTGRES!
"!PSQL!" -U postgres -h 127.0.0.1 -d postgres -c "SELECT 1" >nul 2>nul
if errorlevel 1 goto connexion_refusee

echo  Creation du compte et de la base...
"!PSQL!" -U postgres -h 127.0.0.1 -d postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'enr') THEN CREATE ROLE enr LOGIN PASSWORD 'enr'; END IF; END $$" >nul
"!PSQL!" -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE prospection_enr OWNER enr" >nul 2>nul

echo  Activation de PostGIS...
"!PSQL!" -U postgres -h 127.0.0.1 -d prospection_enr -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist" >nul
if errorlevel 1 goto pas_de_postgis

set PGPASSWORD=enr
"!PSQL!" -U enr -h 127.0.0.1 -d prospection_enr -c "SELECT postgis_version()" >nul 2>nul
if errorlevel 1 goto pas_de_postgis
echo  [OK]  Base de donnees preparee

:configuration
REM ----------------------------------------------------------- Fichier .env ---
REM Ecrit une seule fois. Installation locale : ecoute uniquement sur cette
REM machine (127.0.0.1) et sans authentification, pour eviter un ecran de
REM connexion inutile sur un poste personnel. Ne PAS utiliser tel quel sur un
REM serveur partage - voir docs/HEBERGEMENT.md.
if not exist ".env" (
  >.env  echo DATABASE_URL=postgres://enr:enr@127.0.0.1:5432/prospection_enr
  >>.env echo NODE_ENV=development
  >>.env echo HOTE=127.0.0.1
  >>.env echo PORT=3000
  >>.env echo AUTH_DESACTIVEE=true
  >>.env echo MIGRATIONS_AUTO=true
  >>.env echo AMORCAGE_AUTO=true
  echo  [OK]  Fichier .env cree
)

REM ---------------------------------------------------------- Dependances ----
if not exist "node_modules" (
  echo.
  echo  Installation des composants - comptez 2 a 5 minutes la premiere fois.
  call npm install
  if errorlevel 1 goto echec_npm
)

echo.
echo  Compilation de l'application...
call npm run build
if errorlevel 1 goto echec_build

REM ---------------------------------------------------------- Lancement ------
echo.
echo  ==========================================================
echo    Demarrage. Le navigateur s'ouvrira automatiquement.
echo.
echo    Au PREMIER lancement, l'application telecharge les
echo    donnees nationales pendant 10 a 15 minutes. Elle est
echo    utilisable pendant ce temps et affiche l'avancement.
echo.
echo    Adresse : http://localhost:3000
echo    Pour arreter : fermez cette fenetre.
echo  ==========================================================
echo.

start "" /min "%~dp0scripts\ouvrir-navigateur.bat"
node apps\api\dist\serveur.js
goto fin

REM =========================================================== Diagnostics ===

:pas_de_node
echo  [X]   Node.js n'est pas installe.
echo.
echo        Telechargez la version LTS ici, puis relancez ce fichier :
echo        https://nodejs.org/fr/download
echo.
echo        Choisissez "Windows Installer (.msi)" 64-bit, puis Suivant
echo        jusqu'a la fin. Aucune option a changer.
start "" https://nodejs.org/fr/download
goto erreur

:node_trop_ancien
echo  [X]   Node.js !VERSION_NODE! est trop ancien : il faut la version 20 ou plus.
echo.
echo        Reinstallez la version LTS depuis https://nodejs.org/fr/download
start "" https://nodejs.org/fr/download
goto erreur

:chemin_caracteres_interdits
echo  [X]   Le dossier est a un emplacement que Windows ne sait pas gerer ici.
echo.
echo        Emplacement actuel :
echo        %CD%
echo.
echo        Il contient un caractere que l'invite de commandes Windows utilise
echo        comme separateur - le plus souvent un ET COMMERCIAL ^&, parfois ^^, ^!
echo        ou pourcent. La compilation echouerait avec un message incomprehensible.
echo.
echo        LA SOLUTION, en une minute :
echo         1. fermez cette fenetre ;
echo         2. deplacez le dossier a la racine du disque, par exemple
echo            C:\Prospection-EnR
echo            (couper-coller depuis l'explorateur de fichiers) ;
echo         3. renommez-le simplement Prospection-EnR ;
echo         4. double-cliquez de nouveau sur demarrer.bat.
echo.
echo        Rien n'est perdu : les composants deja telecharges sont dans le
echo        dossier et se deplacent avec lui.
goto erreur

:chemin_trop_long
echo  [X]   Le chemin du dossier est trop long pour Windows.
echo.
echo        Emplacement actuel :
echo        %CD%
echo.
echo        Windows limite la longueur des chemins de fichiers, et l'application
echo        cree des dossiers imbriques qui depasseraient cette limite.
echo.
echo        LA SOLUTION : deplacez le dossier a la racine du disque et
echo        renommez-le, par exemple C:\Prospection-EnR, puis relancez.
goto erreur

:pas_de_postgres
echo  [X]   PostgreSQL n'est pas installe (ou pas a l'emplacement habituel).
echo.
echo        Telechargez-le ici, puis relancez ce fichier :
echo        https://www.postgresql.org/download/windows/
echo.
echo        DEUX POINTS IMPORTANTS pendant l'installation :
echo         - notez le mot de passe que vous choisissez pour le compte
echo           "postgres", il sera demande une fois ici ;
echo         - a la derniere etape, laissez le "Stack Builder" se lancer et
echo           cochez PostGIS dans la categorie "Spatial Extensions".
echo           Sans PostGIS, l'application ne peut pas afficher de carte.
start "" https://www.postgresql.org/download/windows/
goto erreur

:mot_de_passe_vide
echo.
echo  [X]   Aucun mot de passe saisi. Relancez ce fichier.
goto erreur

:connexion_refusee
echo.
echo  [X]   Connexion a PostgreSQL impossible.
echo.
echo        Deux causes possibles :
echo         - le mot de passe saisi n'est pas le bon ;
echo         - le service PostgreSQL n'est pas demarre. Pour le verifier,
echo           tapez services.msc dans le menu Demarrer, cherchez la ligne
echo           postgresql, clic droit puis Demarrer.
goto erreur

:pas_de_postgis
echo.
echo  [X]   PostGIS n'est pas installe dans PostgreSQL.
echo.
echo        C'est l'extension cartographique : sans elle, l'application ne
echo        peut pas produire de carte.
echo.
echo        Ouvrez le menu Demarrer, cherchez "Stack Builder", lancez-le,
echo        choisissez votre installation PostgreSQL, puis cochez PostGIS
echo        dans "Spatial Extensions". Relancez ensuite ce fichier.
goto erreur

:echec_npm
echo.
echo  [X]   L'installation des composants a echoue.
echo.
echo        Le plus souvent, c'est l'acces a Internet qui est filtre. Si votre
echo        entreprise utilise un proxy, ouvrez une invite de commandes ici et
echo        tapez, en remplacant l'adresse par celle de votre proxy :
echo          npm config set proxy http://proxy.mon-entreprise.fr:3128
echo          npm config set https-proxy http://proxy.mon-entreprise.fr:3128
echo        puis relancez ce fichier.
goto erreur

:echec_build
echo.
echo  [X]   La compilation a echoue. Le detail est affiche au-dessus.
goto erreur

:erreur
echo.
pause
exit /b 1

:fin
echo.
echo  Serveur arrete.
pause
