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

Variables d'environnement : `PORT`, `MAX_ROUNDS` (30 par défaut, premier à 16), `MIN_PLAYERS` (1), `MAP` (carte par défaut si personne n'en choisit : `dust` ou `docks`).

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

La carte est choisie dans le menu par le premier joueur qui crée la salle. Les joueurs qui rejoignent ensuite arrivent sur la même carte.
Pour ajouter une carte : copie un bloc dans `MAPS` (fichier `shared.js`) et ajoute un bouton dans `index.html` (`<button data-m="mon-id">`).

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
- Mi-temps : les équipes changent de camp. Les survivants gardent leur équipement, les morts repartent avec le pistolet de base.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D (ou W A S D) | Se déplacer |
| Souris / clic gauche | Viser / tirer |
| Clic droit (maintenu) | Viser par les organes de visée · armes à lunette : lunette |
| Espace / C / Maj | Sauter / s'accroupir / marcher |
| R, 1 2 3, molette, Q | Recharger, armes, arme précédente |
| B | Boutique (1 à 9 pour acheter) |
| E (maintenu) | Poser / désamorcer la bombe |
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
