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

## Version Windows (.exe)

Installe [Node.js](https://nodejs.org) 18 ou plus, puis double-clique sur `build-exe.bat` (ou `npm install` puis `npm run dist`). Le fichier `dist/CS-Arena.exe` est un exécutable unique, sans installation : il lance le serveur du jeu et ouvre la fenêtre en plein écran (F11 pour basculer). Les amis du même réseau rejoignent via `http://TON-IP:3000` dans un navigateur. Pour jouer sur un serveur déjà en ligne : `CS-Arena.exe --url=https://ton-serveur.fly.dev`. Pour tester sans fabriquer l'exe : `npm run app`.

## Stand de tir

Menu **STAND DE TIR** (ou bouton du même nom dans le lobby). Partie privée sur une carte dédiée : un couloir de tir de 44 m avec un comptoir, des lignes au sol tous les 10 m et quelques caisses. Touche **P** : choix de la difficulté et de la durée, départ, résultats et classement.

| Difficulté | Temps à l'écran | Distance | Cibles à la fois | En mouvement |
|---|---|---|---|---|
| Facile | 3,2 s | 8 à 22 m | 1 | aucune |
| Moyen | 2 s | 10 à 32 m | 2 | 1 sur 4 |
| Difficile | 1,3 s | 14 à 46 m | 3 | 1 sur 2 |
| Expert | 0,8 s | 12 à 60 m | 3 | 3 sur 4, plus petites |

- Deux sortes de cibles qui se lèvent puis se baissent : ronde (10 anneaux, la mouche au centre) et silhouette (tête, centre, buste). Une balle qui passe à côté de la silhouette continue sa route.
- Durée 30, 60 ou 90 s, ou **Libre**. Score : endroit touché × rapidité × distance × série (jusqu'à ×2). Une cible ratée casse la série.
- Résultats : points, touchées, ratées, précision, temps de réaction moyen, meilleure série. Record sur l'appareil, et avec un compte : record enregistré et **classement** (top 10 par difficulté et durée).
- Boutique gratuite avec toutes les armes des deux camps, réserve de munitions illimitée, pas de combat entre joueurs.

## Zone de test

Menu **ZONE DE TEST** (ou bouton du lobby). Partie privée qui ne s'arrête jamais (réapparition après 3 s), sur la carte **Labo** (ou n'importe quelle carte, au menu ou dans le panneau). Labo : ligne de pénétration (bois, béton, tôle, muret, fût), hauteurs de saut de 0,5 à 2,6 m, terrasse avec escalier, deux sites de bombe. Touche **P** : outils.

- **Joueur** : invincible, munitions infinies (pas de recharge), grenades illimitées, vol libre (Espace monte, C descend), soigner + gilet et casque, réapparaître, changer de camp tout de suite.
- **Mannequins** (12 au plus) : T ou CT, avec ou sans gilet et casque, fixes ou en mouvement. Les dégâts sont calculés comme sur le serveur (zone, distance, obstacles traversés, gilet) et s'affichent au point d'impact. Ils encaissent aussi la grenade à fragmentation, tombent, puis se relèvent.
- **Infos de test** : position, vitesse, au sol / en l'air, dispersion de l'arme, détail du dernier tir.
- **Téléportation** (départs, sites, milieu), **bombe** (on la reçoit, on la pose, on change de camp pour la désamorcer ; la partie continue), **désordres** à la demande (murs, armes bloquées, commandes inversées, tout remettre en place), nettoyage des grenades et des impacts.

Côté code : le serveur gère les modes `range` et `sandbox` (`practice`, `tickPractice`, `sandbox()` pour les commandes `sb`, options `opt`). Cibles et mannequins n'existent que chez le joueur (`game.js`, section « Entraînement »).

## Comptes joueurs

Bouton **COMPTE** (menu et lobby). Pseudo de 3 à 16 caractères, mot de passe de 6 caractères ou plus, chiffré avec scrypt. Le jeton de session est gardé dans le navigateur (6 appareils au plus). Sans compte, on joue en invité ; un invité ne peut pas prendre le pseudo d'un compte (il reçoit une `*`).

- Profil : niveau et XP, éliminations, morts, K/D, tirs à la tête, manches et matchs gagnés, MVP, ACE (parties en ligne uniquement), records du stand de tir. Changement de mot de passe (déconnecte les autres appareils).
- Dans le tableau des scores, les joueurs avec un compte ont ✔ et leur niveau.
- API (POST, JSON) : `/api/register`, `/api/login`, `/api/me`, `/api/logout`, `/api/password`, `/api/range`, `/api/top`. Trop d'essais depuis la même adresse : refus pendant une minute.
- Les comptes sont dans `DATA_DIR/accounts.json` (`./data` par défaut, `/data` dans Docker, le dossier de l'application pour le `.exe`). **Sur Fly.io**, sans volume, le fichier est effacé à chaque redéploiement : crée un volume (`fly volumes create cs_data --size 1`) et ajoute dans `fly.toml` :

```toml
[mounts]
  source = "cs_data"
  destination = "/data"
```

Sur Render, il faut de même un disque persistant monté sur `/data`.

## Rendu réaliste

Tout est généré au chargement, sans fichier image ni son :

- matériaux PBR (couleur, relief, rugosité) calculés dans le navigateur, ciel avec nuages, éclairage par le ciel, ombres dynamiques, brouillard de distance ;
- décor : fenêtres, portes, câbles, conteneurs, grues, ville à l'horizon, flaques sur les Docks ;
- soldats articulés (marche, accroupi, rechargement, chute) et 21 modèles d'armes ;
- tenues : camouflage désert (T) et numérique (CT), gilet et poches en nylon cousu, gants et bottes en cuir grainé, genouillères, coudières, poche à eau, radio et casque antibruit (CT), foulard et lunettes (T), montre au poignet en vue subjective ;
- armes : acier brossé avec rayures et arêtes usées, polymère granuleux, bois verni ; décor : fissures et coulures sur les murs, granulats et traces d'eau sur le béton, peinture écaillée des conteneurs, noeuds du bois des caisses, gravillons de l'asphalte ;
- particules, douilles, impacts selon la matière, sang, traçantes, flamme de bouche ;
- son : écho, retard selon la distance, murs qui étouffent, balles qui sifflent, acouphène après l'explosion ;
- grenades : nuage de fumée en volume, flammes et sol brûlé, explosion, éclair aveuglant avec image rémanente.

**Qualité graphique** (menu et pause) : `Basse` (sans ombres, pour les petits PC), `Moyenne`, `Haute` (occlusion ambiante, halo lumineux, anticrénelage). Les textures plus fines de `Haute` s'appliquent au prochain chargement de la page.

## Paramètres

Bouton **Paramètres** dans le menu principal et dans la pause (Échap en jeu). Tout est enregistré dans le navigateur (`cs_settings`) et appliqué tout de suite.

- **Contrôles** : sensibilité (et sensibilité en visée), axe vertical inversé, visée et accroupi en maintenu ou en bascule.
- **Touches** : chaque action accepte deux touches. Clic sur une case puis appui sur la touche ; Échap annule, Suppr ou clic droit efface. Une touche déjà prise est retirée à l'ancienne action. Les noms suivent la disposition réelle du clavier (AZERTY sur Chrome et Edge).
- **Vidéo** : qualité graphique, résolution de rendu (50 à 100 %), champ de vision (60 à 110°), secousses et balancement, plein écran automatique, compteur d'images par seconde.
- **Réticule** : couleur, épaisseur, longueur, opacité, point central, avec aperçu.
- **Audio** : volume, ambiance, son de touche, son coupé en arrière-plan, test du son.
- **Interface** : radar (affichage et taille), marqueur de touche, éliminations, chat.

Les réglages sont lus dans `settings.js` (`Settings.cfg`, `Settings.binds`) ; `game.js` les applique dans `applySetting`. Pour ajouter un réglage : une ligne dans `DEF` et dans `TABS` (`settings.js`), puis un `case` dans `applySetting`.

## Animations (pose, désamorçage, recharge, mort)

- **Pose de la bombe** (`E` maintenu) : l'arme descend hors du champ, la bombe monte du bas de l'écran et les deux mains tapent le code, avec un bip à chaque pression et une LED de plus en plus rapide. Les autres joueurs voient le soldat s'accroupir, se pencher et poser la bombe devant lui.
- **Désamorçage** : une main tape sur le pavé, l'autre travaille sur les fils. Avec le kit, une pince s'ouvre et se ferme (son de coupe).
- **Recharge** : l'arme se redresse, le chargeur usagé tombe de la main, qui va chercher le suivant à la ceinture, le remonte et le claque. Les soldats distants font le même geste (cartouche par cartouche aux fusils à pompe).
- **Mort** : les genoux plient, les bras partent en l'air, puis le corps bascule (tête renversée sur une balle à la tête) et rebondit au sol. À la première personne, la caméra tombe et bascule du côté opposé au tireur avant de passer en spectateur (≈ 1,8 s).
- Le serveur envoie dans le snapshot `q` (1 pose, 2 désamorçage), `g` (progression) et `kt` (kit) ; la bombe est posée 0,55 m devant le joueur.

## Ace, séries et MVP

- **ACE** : un joueur élimine toute l'équipe adverse dans la même manche (5 sur 5 ; avec moins de 5 adversaires, tous les adversaires, à partir de 3). Grande bannière dorée, fanfare et message pour tout le monde.
- **Séries** : double, triple et quadruple kill dans la manche (annonce + son pour le joueur, message pour les autres à partir de 3). **Premier sang** à la première élimination de la manche.
- **MVP** de la manche : celui qui a posé ou désamorcé la bombe, sinon le meilleur tueur de l'équipe gagnante. Affiché à la fin de manche.
- Le tableau des scores (Tab) montre les colonnes ★ (MVP) et ACE. Le serveur compte les kills par manche (`rk`) et envoie `rk`, `fb`, `ace` dans le message `kill`, et `mvp` dans `rend`.

## Mode « Rien n'est à sa place »

À choisir dans le menu (carte **MODE**) ou par l'hôte dans le lobby. Les règles de la bombe ne changent pas, mais de temps en temps un **désordre** frappe tout le monde. Tout est tiré au sort :

- **combien** : à chaque manche, aucun désordre (environ 1 manche sur 3), un seul (4 sur 10), deux (2 sur 10) ou, rarement, trois ;
- **quand** : n'importe quand entre 10 s après le début de la manche et 12 s avant la fin, avec au moins 20 s entre deux désordres ;
- **alerte** : 3 fois sur 4, il est annoncé 3 s avant, sans dire lequel (bips, image qui se déchire). La 4e fois, il tombe par surprise ;
- **lequel et avec quelle ampleur** (jamais deux fois de suite le même) :
  - **Transfuges** : un T et un CT (parfois deux de chaque) changent de camp jusqu'à la fin de la manche. Les anciens coéquipiers deviennent des ennemis (et l'inverse). Si le porteur de la bombe passe CT, il la lâche.
  - **Scores inversés** : les points des deux camps sont échangés, ainsi que les séries de défaites.
  - **Les murs bougent** : 1 à 4 obstacles disparaissent ou réapparaissent (murs intérieurs, caisses, conteneurs). Un mur disparu ne bloque plus ni les joueurs ni les balles, et on tombe s'il était sous nos pieds. Un mur ne réapparaît jamais sur un joueur, la bombe ou une arme au sol. Sur la carte (M), les murs disparus sont en pointillés violets.
  - **Armes bloquées** : les armes principales ou les pistolets ne tirent plus, pendant 6 à 14 s. Le serveur refuse aussi leurs touches.
  - **Permutation** : des joueurs tirés au sort (au moins 2, une fois sur deux tous les vivants) prennent chacun la place d'un autre (position, regard, posture). Aucun d'eux ne reste à sa place.
  - **Commandes inversées** : avancer recule et gauche va à droite, pendant 5 à 10 s.

À chaque nouvelle manche, tout revient en place : les camps d'origine et tous les murs. L'effet visuel est coupé si **Secousses de l'écran** est à 0 %.

Côté code : `phaseBoxes(map)` (`shared.js`) donne la liste des obstacles qui peuvent disparaître, la même pour le serveur et les clients. `gfx.js` construit chacun à part (`setHidden`), et `server.js` tire le programme de chaque manche (`planChaos`) puis les événements (`chaos`). Le snapshot envoie `md` (mode), `hb` (murs cachés), `jm` (arme bloquée), `iv` (commandes inversées) et `hf` (mi-temps passée). Après une permutation, le client renvoie `tp` dans `st` pour que le serveur ignore les positions envoyées avant la téléportation.

## Éditeur de cartes

Page `editor.html` (bouton **ÉDITEUR DE CARTES** du menu). **Réservé au compte `faze`** : le serveur refuse d'enregistrer une carte pour tout autre compte, et le bouton n'apparaît pas pour les autres joueurs. Pour changer les comptes autorisés : variable d'environnement `MAP_EDITORS=faze,autre`.

- Vue de dessus de la carte (80 × 80 m, T en bas, CT en haut) avec grille magnétique. Outils : mur, muret, caisse, grande caisse, conteneur (couleur, 1 à 3 étages), fût, terrasse, escalier, toit / passage couvert, sites A et B, départs T et CT, flèches au sol, gomme.
- Sélection multiple, poignées, Ctrl+Z / Ctrl+Y, copier-coller, miroir, « Symétriser gauche → droite ».
- **Vérification** en direct : sites, départs dans un mur, site ou départ CT inaccessible depuis le départ T, départs qui se voient. Calque « Zones accessibles ».
- **Vue 3D** avec le rendu du jeu (vol libre ou à pied), **Tester** (zone de test), **Jouer dessus** (menu avec la carte choisie), **Partager** (lien `?cmap=…&room=…` pour les amis, qui n'ont pas besoin de l'éditeur).
- **Ajouter une carte au jeu pour de bon** : **Exporter…** → *Télécharger le fichier de la carte* (`carte-<nom>.json`). Ce fichier se donne à Claude, qui l'ajoute dans `shared.js` (une ligne `addEditorMap(...)` sous « Cartes ajoutées depuis l'éditeur »). Le bouton du menu apparaît tout seul, avec le nom, le sous-titre et la couleur choisis dans le panneau CARTE.
- Mes cartes : dans le navigateur. Cartes envoyées : `DATA_DIR/maps.json` et la base Supabase (ligne `maps`) si elle est configurée. Exporter : fichier `.json`, ou code à coller dans `shared.js` pour ajouter la carte au jeu pour de bon.
- Côté code : `sanitizeMap` / `buildCustom` (`shared.js`), routes `/maps/save`, `/maps/get`, `/maps/list`, `/maps/can` (`server.js`).

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

## Grenades

Quatre grenades, achetées dans la boutique (section **Grenades**), **4 au maximum** en tout :

| Touche | Grenade | Prix | Max | Effet |
|---|---|---|---|---|
| 4 | Flash | $200 | 2 | Aveugle ceux qui la voient : écran blanc puis image figée qui s'estompe, et sifflement. Plus on la regarde en face et de près, plus ça dure (jusqu'à 42 m, arrêtée par les murs). Le lanceur peut s'aveugler lui-même. |
| 5 | Fumigène | $300 | 1 | Nuage opaque de 3,8 m de rayon pendant 18 s. Dedans, l'écran devient gris. Il éteint les feux proches. |
| 6 | Frag | $300 | 1 | Explosion : jusqu'à 100 dégâts au centre, 10 m de rayon, arrêtée par les murs, réduite par le gilet. Pas de dégâts aux coéquipiers, mais on peut se blesser soi-même. |
| 7 | Molotov | $400 | 1 | Éclate au premier contact avec le sol : flammes de 3,4 m de rayon pendant 7 s, 8 dégâts toutes les 0,5 s. |

- **G** : grenade suivante. La molette passe aussi par les grenades.
- **Clic gauche** : lancer loin. **Clic droit** : lancer court (en cloche). Le mouvement du joueur s'ajoute au lancer.
- On ne lance qu'une fois la manche commencée. Après le lancer, on reprend l'arme d'avant (ou la grenade suivante du même type).
- Les grenades se gardent d'une manche à l'autre si on survit ; un mort les perd.
- Sur le radar et la carte (M) : fumées en gris, feux en orange.

Côté code : le serveur simule tout (`throwGren`, `stepGren` pour la trajectoire et les rebonds, `detonate`, `popFlash`, `popHE`, zones de fumée et de feu dans `tickGren`). Il envoie `gr` (grenades en vol) et `zn` (zones) dans le snapshot, `g` (grenades possédées) dans `me`, et les messages `throw`, `gev` (explosion) et `blind` (aveuglement). Le client (`game.js`, section « Grenades ») lisse les trajectoires et affiche les effets. Réglages dans `CFG` et `GREN` (`shared.js`).

## Armes

- **Terroristes** : Glock-18 (départ), Tec-9, Galil AR, AK-47, SG 553, MAC-10
- **Anti-terroristes** : USP-S (départ), Five-SeveN, FAMAS, M4A1-S, AUG, MP9
- **Les deux camps** : P250, Desert Eagle, UMP-45, P90, Nova, XM1014, SSG 08, AWP

## Règles de jeu

- Manches de 1 min 55, phase d'achat de 10 s (+20 s encore possibles après le début).
- **T** : poser la bombe sur le site A ou B (maintenir `E` 3,2 s dans la zone rouge). **CT** : empêcher la pose ou désamorcer (10 s, 5 s avec kit).
- Une manche se termine par élimination, explosion, désamorçage ou fin du temps (victoire CT si la bombe n'est pas posée).
- Équipement : gilet $650, gilet + casque $1000. Économie : départ $800, victoire +$3250, défaite +$1400 (+$500 par défaite d'affilée, max 4), kills selon l'arme, pose de la bombe +$300.
- Armes au sol : `Q` jette l'arme en main, et un joueur tué lâche sa meilleure arme, avec ses munitions. On ramasse en passant dessus si l'emplacement est libre, ou avec `E` pour échanger. Acheter une arme alors qu'on en porte une du même type fait tomber l'ancienne, avec ses munitions. Les armes au sol disparaissent à chaque nouvelle manche, mais on peut encore les prendre pendant les 8 s de fin de manche : l'arme du dernier ennemi tué se récupère donc aussi, et un survivant la garde à la manche suivante.
- Mi-temps : les équipes changent de camp. Les survivants gardent leur équipement, les morts repartent avec le pistolet de base.

## Commandes

| Touche | Action |
|---|---|
| Z Q S D (ou W A S D) | Se déplacer |
| Souris / clic gauche | Viser / tirer · grenade : lancer loin |
| Clic droit (maintenu) | Viser par les organes de visée · armes à lunette : lunette · grenade : lancer court |
| Espace / C / Maj | Sauter / s'accroupir / marcher |
| R, 1 2 3, molette | Recharger, changer d'arme |
| Q | Jeter son arme au sol (touche A sur AZERTY) |
| 4 5 6 7 · G | Grenades (flash, fumigène, frag, Molotov) · grenade suivante |
| B | Boutique (1 à 9 pour acheter) |
| E | Prendre une arme au sol · maintenu : poser / désamorcer la bombe |
| M | Afficher ou fermer la carte complète |
| P | Stand de tir : difficulté et départ · zone de test : outils |
| Tab / Entrée | Scores / chat |

**Ctrl et le navigateur :** le jeu passe en plein écran au lancement. Sur Chrome, Edge et Opera (en https ou localhost), cela protège Ctrl+W pendant la partie. Sur Firefox et Safari, Ctrl+W ne peut pas être bloqué : le navigateur demande confirmation, et il vaut mieux s'accroupir avec C. Echap quitte le plein écran et affiche la pause ; cliquer sur Reprendre y retourne.

## Fichiers

```
server.js      serveur HTTP + salles WebSocket (manches, économie, bombe, dégâts)
shared.js      armes, cartes, réglages (utilisé par le serveur ET le client)
game.js        mouvement, tir, réseau, HUD, radar
main.js        application Windows (Electron)
settings.js    menu Paramètres : réglages, touches personnalisables
account.js     comptes joueurs : connexion, création, profil, records
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

Bots, plus de cartes, déplacement validé côté serveur.

## Comptes joueurs

Pour que les comptes survivent aux redémarrages de Render, branche une base de données Supabase gratuite : voir **SUPABASE.md**.
