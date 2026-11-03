# CS Arena

FPS tactique **Terroristes contre Anti-terroristes**, jouable dans le navigateur en multijoueur (three.js + WebSocket).
Basé sur l'architecture de FPS Arena (serveur Node + `ws`), mais dans un projet séparé.

## Lancer

```bash
npm install
npm start          # http://localhost:3000
```

Plusieurs onglets ou plusieurs PC sur le même réseau peuvent rejoindre la même **salle** (champ « Salle » du menu, ou `?room=mon-code` dans l'URL).
Le serveur accepte 10 joueurs par salle. Avec un seul joueur, tu es en mode entraînement (la manche ne s'arrête pas à l'élimination).

Variables d'environnement : `PORT`, `MAX_ROUNDS` (30 par défaut, premier à 16), `MIN_PLAYERS` (1), `MAP` (carte par défaut si personne n'en choisit : `dust`, `docks`, `medina` ou `cargo`).

## Rendu réaliste

Tout est généré au chargement, sans fichier image ni son :

- matériaux PBR (couleur, relief, rugosité) calculés dans le navigateur, ciel avec nuages, éclairage par le ciel, ombres dynamiques, brouillard de distance ;
- décor : fenêtres, portes, câbles, conteneurs, grues, ville à l'horizon, flaques sur les Docks ;
- soldats articulés (marche, accroupi, rechargement, chute) et 21 modèles d'armes ;
- particules, douilles, impacts selon la matière, sang, traçantes, flamme de bouche ;
- son : écho, retard selon la distance, murs qui étouffent, balles qui sifflent, acouphène après l'explosion.

**Qualité graphique** (menu et pause) : `Basse` (sans ombres, pour les petits PC), `Moyenne`, `Haute` (occlusion ambiante, halo lumineux, anticrénelage). Les textures plus fines de `Haute` s'appliquent au prochain chargement de la page.

## Cartes

- **Dust** : désert, deux sites séparés par une ligne de murs à 3 portes.
- **Docks** : port industriel avec conteneurs, entrepôt central qui coupe le milieu en deux voies.

- **Médina** : ville en fin d'après-midi, construite sur trois axes comme une carte de Counter-Strike. À l'ouest, la Longue A mène à la grande place par des portes étroites. Au centre, la rue du milieu donne sur l'escalier du balcon de A et sur la porte B. À l'est, les tunnels couverts débouchent dans la cour du palais (site B), dominée par une terrasse. Une ruelle côté T relie la Longue au milieu, et une liaison relie le milieu aux tunnels.
- **Cargo** : terminal à conteneurs sous un ciel bas. Le quai ouest mène au site A, l'allée centrale passe sous un portique et longe le hangar, la voie B arrive par l'est. Le site B est plus proche des T que le site A, et ses entrées sont plus serrées. Les conteneurs sont à l'échelle réelle (6 ou 12 m, 1 à 3 étages) et les fusils les traversent. Certains se grimpent depuis une caisse.

Sur ces deux cartes, chaque site a trois entrées. Des flèches au sol et des lettres peintes sur les murs indiquent les sites A et B, et les deux départs ne se voient pas.

La carte est choisie dans le menu par le premier joueur qui crée la salle. Les joueurs qui rejoignent ensuite arrivent sur la même carte.
Pour ajouter une carte : copie un bloc dans `MAPS` (fichier `shared.js`) et ajoute un bouton dans `index.html` (`<button data-m="mon-id">`). Deux méthodes sont possibles :

- **Grille**, comme Médina : la carte est dessinée en texte (`grid`, 40 lignes de 40 caractères, 1 caractère = 2 m) et la légende se trouve au-dessus de `fromGrid`. Les éléments plus fins vont dans `extra` : `stairs(...)` pour un escalier (marches de 0,5 m, franchies sans sauter), `B(...)` pour un parapet.
- **Liste de blocs**, comme Cargo : `B(...)` pour un bâtiment ou une caisse, `K(x, z, longueur, 'x' ou 'z', étages, couleur)` pour un conteneur.

Dans les deux cas, il faut laisser libres les zones de départ en haut et en bas, au centre. Options de décor d'une carte : `arches` (portes et passages couverts), `signs` (lettres sur les murs), `marks` (flèches au sol), `lines` (linge), `awnings` (auvents), `stripes` et `rails` (marquage au sol).

## Réalisme du combat

- Dégâts par zone : tête, torse, ventre (+25 %), bras (-15 %), jambes (-28 %). Le gilet protège torse, ventre et bras ; le casque protège la tête.
- Les dégâts baissent avec la distance selon la famille d'arme.
- Pénétration : les balles traversent le bois, et la tôle des conteneurs pour les fusils, en perdant 40 % de dégâts.
- Recul en motif (monte, puis dérive), précision qui chute en mouvement et en l'air, réticule dynamique.
- Rechargement plus long chargeur vide, cartouche par cartouche aux fusils à pompe (tirer interrompt), réarmement manuel de l'AWP, du SSG 08 et de la Nova.
- Inertie, ralentissement quand on est touché ou à l'atterrissage, sauts répétés plus courts, souffle à la lunette (Maj pour le retenir).

## Armes

- **Terroristes** : Glock-18 (départ), Tec-9, Galil AR, AK-47, SG 553, MAC-10
- **Anti-terroristes** : USP-S (départ), Five-SeveN, FAMAS, M4A1-S, AUG, MP9
- **Les deux camps** : P250, Desert Eagle, UMP-45, P90, Nova, XM1014, SSG 08, AWP

## Règles de jeu

- Manches de 1 min 55, phase d'achat de 10 s (+20 s encore possibles après le début).
- **T** : poser la bombe sur le site A ou B (maintenir `E` 3,2 s dans la zone rouge). **CT** : empêcher la pose ou désamorcer (10 s, 5 s avec kit).
- Une manche se termine par élimination, explosion, désamorçage ou fin du temps (victoire CT si la bombe n'est pas posée).
- Équipement : gilet $650, gilet + casque $1000. Économie : départ $800, victoire +$3250, défaite +$1400 (+$500 par défaite d'affilée, max 4), kills selon l'arme, pose de la bombe +$300.
- Armes au sol : `Q` jette l'arme en main, et un joueur tué lâche sa meilleure arme, avec ses munitions. On ramasse en passant dessus si l'emplacement est libre, ou avec `E` pour échanger. Acheter une arme alors qu'on en porte une du même type fait tomber l'ancienne, avec ses munitions. Les armes au sol disparaissent à chaque nouvelle manche.
- Mi-temps : les équipes changent de camp. Les survivants gardent leur équipement, les morts repartent avec le pistolet de base.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D (ou W A S D) | Se déplacer |
| Souris / clic gauche | Viser / tirer |
| Clic droit (maintenu) | Viser par les organes de visée · armes à lunette : lunette |
| Espace / C / Maj | Sauter / s'accroupir / marcher |
| R, 1 2 3, molette | Recharger, changer d'arme |
| Q | Jeter son arme au sol (touche A sur AZERTY) |
| B | Boutique (1 à 9 pour acheter) |
| E | Prendre une arme au sol · maintenu : poser / désamorcer la bombe |
| M | Afficher ou fermer la carte complète |
| Tab / Entrée | Scores / chat |

**Ctrl et le navigateur :** le jeu passe en plein écran au lancement. Sur Chrome, Edge et Opera (en https ou localhost), cela protège Ctrl+W pendant la partie. Sur Firefox et Safari, Ctrl+W ne peut pas être bloqué : le navigateur demande confirmation, et il vaut mieux s'accroupir avec C. Echap quitte le plein écran et affiche la pause ; cliquer sur Reprendre y retourne.

## Fichiers

```
server.js      serveur HTTP + salles WebSocket (manches, économie, bombe, dégâts)
shared.js      armes, cartes, réglages (utilisé par le serveur ET le client)
game.js        mouvement, tir, réseau, HUD, radar
gfx.js         rendu : textures, ciel, lumière, décor, post-traitement, particules
models.js      armes, soldats articulés, bras, bombe
audio.js       sons synthétisés (aucun fichier audio)
three.min.js   three.js r128, servi par le jeu (plus de CDN)
index.html     menu, HUD, boutique
style.css
Dockerfile     déploiement Fly.io / Docker (range les fichiers client dans /app/public)
```

## Architecture réseau

- Le client envoie sa position (30 Hz) ; le serveur renvoie un snapshot de la salle (20 Hz).
- Le serveur décide de tout ce qui compte : phases de manche, argent, achats, bombe, PV, morts, scores. Les dégâts sont recalculés côté serveur depuis la table d'armes (cadence, portée, équipe, armure).
- Le client détecte les impacts (raycast) et envoie « j'ai touché X ». C'est simple et fluide, mais un tricheur motivé pourrait tricher ; pour une partie entre amis c'est suffisant.

## Pistes d'amélioration

Grenades (fumigène, flash, explosive), bots, plus de cartes, déplacement validé côté serveur.
