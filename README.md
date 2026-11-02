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

Variables d'environnement : `PORT`, `MAX_ROUNDS` (30 par défaut, premier à 16), `MIN_PLAYERS` (1).

## Règles de jeu

- Manches de 1 min 55, phase d'achat de 10 s (+20 s encore possibles après le début).
- **T** : poser la bombe sur le site A ou B (maintenir `E` 3,2 s dans la zone rouge). **CT** : empêcher la pose ou désamorcer (10 s, 5 s avec kit).
- Une manche se termine par élimination, explosion, désamorçage ou fin du temps (victoire CT si la bombe n'est pas posée).
- Économie : départ $800, victoire +$3250, défaite +$1400 (+$500 par défaite d'affilée, max 4), kills selon l'arme, pose de la bombe +$300.
- Mi-temps : les équipes changent de camp. Les survivants gardent leur équipement, les morts repartent avec le pistolet de base.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D (ou W A S D) | Se déplacer |
| Souris / clic gauche | Viser / tirer |
| Clic droit | Lunette de l'AWP |
| Espace / C / Maj | Sauter / s'accroupir / marcher |
| R, 1 2 3, molette, Q | Recharger, armes, arme précédente |
| B | Boutique (1 à 9 pour acheter) |
| E (maintenu) | Poser / désamorcer la bombe |
| Tab / Entrée | Scores / chat |

## Fichiers

```
server.js          serveur HTTP + salles WebSocket (manches, économie, bombe, dégâts)
public/shared.js   armes, carte, réglages (utilisé par le serveur ET le client)
public/game.js     rendu three.js, mouvement, tir, réseau, HUD, radar
public/audio.js    sons synthétisés (aucun fichier audio)
public/index.html  menu, HUD, boutique
public/style.css
Dockerfile         déploiement Render / Docker
```

## Architecture réseau

- Le client envoie sa position (30 Hz) ; le serveur renvoie un snapshot de la salle (20 Hz).
- Le serveur décide de tout ce qui compte : phases de manche, argent, achats, bombe, PV, morts, scores. Les dégâts sont recalculés côté serveur depuis la table d'armes (cadence, portée, équipe, armure).
- Le client détecte les impacts (raycast) et envoie « j'ai touché X ». C'est simple et fluide, mais un tricheur motivé pourrait tricher ; pour une partie entre amis c'est suffisant.

## Pistes d'amélioration

Grenades (fumigène, flash, explosive), bots, plusieurs cartes, déplacement validé côté serveur, sons de pas selon le sol.
