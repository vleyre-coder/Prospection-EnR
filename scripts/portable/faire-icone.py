#!/usr/bin/env python3
"""
Fabrique l'icone de l'application de bureau.

POURQUOI UN SCRIPT PLUTOT QU'UN FICHIER DEPOSE. Une icone livree sans sa recette devient
intouchable : personne n'ose la reprendre, et elle vieillit. Ici, la forme est du code — on
peut changer une couleur, regenerer, comparer.

POURQUOI PYTHON DANS UN DEPOT NODE. C'est un generateur d'ARTEFACT, lance a la main quand le
dessin change, jamais en integration continue ni a la construction de l'archive. La chaine de
fabrication, elle, reste entierement en Node : elle se contente de lire `icone.ico`.

LE DESSIN, ET LA CONTRAINTE QUI LE GOUVERNE. Une icone Windows est vue a 16 pixels dans la
barre des taches, et c'est cette taille qui commande tout : a 16 px, un degrade se transforme
en bouillie et un trait fin disparait. D'ou trois masses seulement, fortement contrastees :
    - un fond sombre arrondi, qui detache l'icone de n'importe quel fond d'ecran ;
    - une parcelle — un quadrilatere irregulier, la forme meme du metier — en vert franc ;
    - un soleil ambre en haut a droite, la seule note chaude, qui donne l'energie.
Le rendu se fait a 1024 px puis est reduit par LANCZOS pour chaque taille : dessiner
directement en 16 px donnerait des bords en escalier.

Usage : python3 scripts/portable/faire-icone.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SORTIE = Path(__file__).parent / "icone.ico"

# Rendu de travail : large, puis reduit. 8 fois la plus grande taille livree.
COTE = 1024

FOND = (14, 33, 43, 255)          # bleu-nuit profond, lisible sur clair comme sur sombre
PARCELLE = (74, 176, 106, 255)    # vert franc
PARCELLE_BORD = (28, 94, 56, 255)
SOLEIL = (240, 176, 62, 255)      # ambre


def dessiner() -> Image.Image:
    image = Image.new("RGBA", (COTE, COTE), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)

    # Fond arrondi. Le rayon vaut un cinquieme du cote : au-dela l'icone devient un jeton,
    # en deca elle ne se distingue plus d'un dossier.
    d.rounded_rectangle([0, 0, COTE - 1, COTE - 1], radius=COTE // 5, fill=FOND)

    # La parcelle : un quadrilatere IRREGULIER. Un rectangle ferait « document » ; c'est
    # l'irregularite qui evoque le cadastre.
    u = COTE / 100
    # Geometrie arretee EN REGARDANT LE RENDU A 16 PX, pas sur le papier. La premiere version
    # collait la parcelle au soleil : a 16 px les deux masses fusionnaient en une seule tache.
    # La parcelle est donc descendue et retrecie, ce qui degage un vide net entre les deux.
    parcelle = [
        (20 * u, 62 * u),
        (42 * u, 38 * u),
        (74 * u, 50 * u),
        (64 * u, 84 * u),
        (28 * u, 81 * u),
    ]
    d.polygon(parcelle, fill=PARCELLE, outline=PARCELLE_BORD, width=int(3 * u))

    # Une limite interne : deux lots, comme sur un plan. Elle disparait a 16 px, et c'est
    # voulu — elle n'enrichit que les grandes tailles.
    d.line([(42 * u, 38 * u), (48 * u, 82 * u)], fill=PARCELLE_BORD, width=int(2.5 * u))

    # Le soleil, detache du bord pour survivre au rognage des lanceurs qui ajoutent une marge.
    r = 10 * u
    cx, cy = 78 * u, 22 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SOLEIL)

    return image


def main() -> None:
    grande = dessiner()
    # Les six tailles que Windows pioche selon le contexte : barre des taches, bureau,
    # explorateur en grandes icones, boite de dialogue.
    tailles = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    grande.save(SORTIE, format="ICO", sizes=tailles)
    print(f"{SORTIE} ecrit — {SORTIE.stat().st_size} octets, {len(tailles)} tailles")


if __name__ == "__main__":
    main()
