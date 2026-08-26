# Installer sur Windows sans Docker et sans Git

Ce guide est écrit pour être suivi sans rien connaître de Git, de Docker ni de la ligne de
commande. Comptez **20 minutes la première fois**, puis un double-clic les fois suivantes.

## Pourquoi ce n'est pas un simple `.exe`

Autant le dire franchement : cette application demande plus qu'un exécutable, et ce n'est pas
une coquetterie. Elle a besoin d'une **base de données cartographique** (PostgreSQL + PostGIS)
pour fabriquer les tuiles de la carte et calculer des distances sur le parcellaire national.
C'est le même moteur que celui qui fait tourner les portails d'urbanisme. Aucun exécutable ne
peut embarquer ça.

Concrètement : **deux installations classiques, une seule fois**, puis un fichier à
double-cliquer. Rien de plus.

---

## Étape 1 — Installer Node.js (5 minutes)

1. Aller sur **<https://nodejs.org/fr/download>**
2. Cliquer sur le bouton de téléchargement pour **Windows Installer (.msi)**, version 64-bit,
   « LTS » (la version recommandée).
3. Ouvrir le fichier téléchargé, puis **Suivant** jusqu'à la fin. Ne rien changer.

## Étape 2 — Installer PostgreSQL avec PostGIS (10 minutes)

1. Aller sur **<https://www.postgresql.org/download/windows/>**
2. Cliquer sur **Download the installer**, puis prendre la version **17** ou **18** pour
   Windows x86-64.
3. Lancer l'installateur, **Suivant** jusqu'à l'écran du mot de passe.

> ### ⚠️ Les deux seuls points à ne pas manquer
>
> **a) Le mot de passe.** L'installateur demande un mot de passe pour le compte
> `postgres`. **Notez-le** : il vous sera demandé une seule fois, au premier lancement de
> l'application. N'importe quel mot de passe convient.
>
> **b) PostGIS.** À la toute fin de l'installation, une case propose de lancer le
> **« Stack Builder »**. **Laissez-la cochée.** Le Stack Builder s'ouvre, vous demande de
> choisir votre installation PostgreSQL, puis affiche une liste de catégories : ouvrez
> **Spatial Extensions** et cochez **PostGIS**. Suivant, il télécharge et installe.
>
> Sans PostGIS, l'application démarre mais **ne peut afficher aucune carte**.

*Vous avez fermé le Stack Builder trop vite ?* Ce n'est pas grave : tapez « Stack Builder »
dans le menu Démarrer, il est installé et se relance quand vous voulez.

## Étape 3 — Récupérer l'application (2 minutes)

Pas besoin de Git.

1. Ouvrir **<https://github.com/Llegender/Prospection_EnR>**
2. Cliquer sur le bouton vert **`< > Code`**, puis sur **Download ZIP**.
3. **Clic droit → Extraire tout**, puis **déplacer et renommer le dossier en
   `C:\Prospection_EnR`.**

> ### ⚠️ L'emplacement du dossier compte vraiment
>
> Mettez le dossier **à la racine du disque**, avec un nom court :
> **`C:\Prospection_EnR`**. Ce n'est pas une préférence esthétique.
>
> **Un `&` dans le chemin casse la compilation.** Un dossier nommé
> `Desktop\Prototype & Test\…` fait échouer la construction avec un message
> incompréhensible : l'invite de commandes Windows traite le `&` comme un séparateur
> d'instructions, coupe en deux la liste des outils de compilation, et plus rien n'est
> trouvé. Les caractères `^`, `!` et `%` posent le même problème.
>
> **Un chemin trop long échoue aussi.** Windows limite la longueur des chemins ; le nom que
> GitHub donne au dossier (`Prospection_EnR-claude-enr-land-prospecting-app-i97pmk`), placé
> sous plusieurs sous-dossiers, suffit à dépasser la limite.
>
> `demarrer.bat` vérifie ces deux points **avant** de télécharger quoi que ce soit et vous
> dit quoi faire. Mais autant s'éviter l'aller-retour.
>
> Les espaces, en revanche, ne posent pas de problème : `C:\Users\Jean Dupont\…` fonctionne.

## Étape 4 — Lancer

Dans le dossier extrait, **double-cliquer sur `demarrer.bat`**.

Une fenêtre noire s'ouvre. C'est normal, c'est le journal de l'application — ne la fermez pas
tant que vous l'utilisez.

Elle va :

1. vérifier Node.js et PostgreSQL ;
2. **demander une seule fois le mot de passe `postgres`** de l'étape 2, pour créer la base ;
3. installer les composants (2 à 5 minutes, une seule fois) ;
4. compiler l'application (30 secondes) ;
5. **ouvrir votre navigateur** sur <http://localhost:3000>.

Au **premier** lancement seulement, l'application télécharge les données nationales — les
35 000 communes, les 3 119 postes sources, les monuments historiques, le gisement de vent —
pendant **10 à 15 minutes**. Un bandeau affiche l'avancement en haut de l'écran, et
**l'application est utilisable pendant ce temps**. Les fois suivantes, elle démarre en
quelques secondes.

## Les fois suivantes

Double-clic sur `demarrer.bat`. C'est tout. Pour arrêter : fermez la fenêtre noire.

Si vous voulez un accès plus rapide : clic droit sur `demarrer.bat` → **Envoyer vers → Bureau
(créer un raccourci)**.

---

## Si quelque chose bloque

Le fichier `demarrer.bat` affiche un message explicite pour chaque cas et ouvre au besoin la
page de téléchargement. Les situations les plus courantes :

| Message | Ce qu'il faut faire |
|---|---|
| `Node.js n'est pas installe` | refaire l'étape 1 |
| `PostgreSQL n'est pas installe` | refaire l'étape 2 |
| `Connexion a PostgreSQL impossible` | soit le mot de passe saisi n'est pas le bon, soit le service est arrêté : tapez `services.msc` dans le menu Démarrer, cherchez la ligne `postgresql`, clic droit → **Démarrer** |
| `PostGIS n'est pas installe` | lancer **Stack Builder** depuis le menu Démarrer et cocher PostGIS (point b de l'étape 2) |
| `L'installation des composants a echoue` | accès Internet filtré. Si votre entreprise a un proxy, le message affiche les deux commandes à taper |
| `Le dossier est a un emplacement que Windows ne sait pas gerer` | le chemin contient `&`, `^`, `!` ou `%` : déplacez le dossier vers `C:\Prospection_EnR` et relancez |
| `Le chemin du dossier est trop long` | même correction : `C:\Prospection_EnR` |
| `Cannot find module '…\typescript\bin\tsc'` pendant la compilation | c'est la signature d'un `&` dans le chemin : déplacez le dossier vers `C:\Prospection_EnR`, puis supprimez le dossier `node_modules` et relancez |
| Windows affiche « Windows a protégé votre ordinateur » | **Informations complémentaires** → **Exécuter quand même**. Le fichier vient de votre propre dépôt, pas d'Internet |

---

## Et Docker, alors ?

**Vous n'en avez plus besoin.** `demarrer.bat` ne l'utilise pas. Vous pouvez désinstaller
Docker Desktop si vous ne vous en servez pas ailleurs.

Docker reste la voie la plus courte **quand il fonctionne** (aucune installation de Node ni de
PostgreSQL), mais sur un poste d'entreprise Windows il échoue souvent, pour quatre raisons
qu'il vaut la peine de connaître si vous voulez le débloquer un jour :

1. **WSL 2 n'est pas installé.** C'est la cause la plus fréquente : Docker Desktop reste
   bloqué sur « Docker Desktop starting… ». Ouvrez PowerShell **en tant qu'administrateur** et
   tapez `wsl --install`, puis redémarrez le PC.
2. **La virtualisation est désactivée dans le BIOS.** Vérifiez dans le Gestionnaire des tâches
   → onglet **Performance** → **Processeur** : la ligne « Virtualisation » doit indiquer
   *Activé*. Sinon, il faut l'activer dans le BIOS (Intel VT-x ou AMD-V), ce qui demande
   souvent l'intervention de votre service informatique.
3. **Les droits administrateur manquent**, ou une stratégie d'entreprise bloque WSL et
   Hyper-V. Rien à faire sans votre service informatique.
4. **Docker Desktop n'est pas lancé.** Il ne démarre pas tout seul avec Windows : il faut
   l'ouvrir depuis le menu Démarrer et attendre que la baleine, en bas à gauche, devienne
   verte.

Si aucun de ces points ne débloque la situation, restez sur `demarrer.bat` : le résultat est
exactement le même application.

---

## Où sont mes données ?

- **La base** est dans PostgreSQL, sur votre PC. Rien ne part sur Internet, sauf les
  interrogations des sources publiques officielles (IGN, Géorisques, Capareseau…).
- **Le dossier** extrait à l'étape 3 contient le code et un fichier `.env` avec vos réglages.
- **Sauvegarde.** La seule chose non reconstituable est votre pipeline commercial (prospects,
  statuts, notes). Pour la sauvegarder, ouvrez une invite de commandes dans le dossier et
  tapez, en remplaçant le chemin par celui de votre PostgreSQL :

  ```
  "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U enr -h 127.0.0.1 prospection_enr > sauvegarde.sql
  ```

  Le mot de passe demandé est `enr`.

---

## Aller plus loin

- Utilisation de l'application, dépannage détaillé : [INSTALLATION.md](INSTALLATION.md)
- Mettre l'application en ligne pour y accéder à plusieurs :
  [HEBERGEMENT.md](HEBERGEMENT.md)
- Ce que fait le moteur de score, et pourquoi une parcelle est verte ou rouge :
  [SCORING.md](SCORING.md)
