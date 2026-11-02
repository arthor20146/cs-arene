/* Données partagées client + serveur (armes, cartes, réglages) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CS = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const CFG = {
    tick: 50,            // ms (logique serveur + snapshots)
    freeze: 10,          // s de phase d'achat
    live: 115,           // s de manche
    end: 6,              // s entre deux manches
    plant: 3.2,          // s pour poser la bombe
    defuse: 10,          // s pour désamorcer
    defuseKit: 5,        // s avec kit
    bombTime: 40,        // s avant explosion
    buyExtra: 20,        // s d'achat autorisé après le début de la manche
    startMoney: 800,
    maxMoney: 16000,
    maxRounds: 30,       // premier à 16
    minPlayers: 1,       // 1 = mode entraînement possible en solo
    maxPlayers: 10,
    eye: 1.65,
    eyeCrouch: 1.15,
    radius: 0.4,
    armorBody: 0.7,      // multiplicateur de dégâts corps si gilet
    armorHead: 0.85
  };

  // slot 1 = principale, 2 = secondaire, 3 = couteau
  // team : 'T' = Terroristes seulement, 'CT' = Anti-terroristes seulement, '' = les deux
  // scope : 1 = arme à lunette (clic droit = lunette au lieu de la visée normale)
  const WEAPONS = {
    knife:  { n: 'Couteau',  slot: 3, price: 0,    team: '',   dmg: 45,  hs: 1,   rof: 0.6,  range: 2.7, mag: 0,  res: 0,   auto: 0, spread: 0,    rec: 0,     rl: 0,   spd: 1.1,  kill: 1500 },
    // --- pistolets
    glock:  { n: 'Glock-18', slot: 2, price: 0,    team: 'T',  dmg: 26,  hs: 3.3, rof: 0.14, range: 100, mag: 20, res: 120, auto: 0, spread: 0.010, rec: 0.012, rl: 1.8, spd: 1.0,  kill: 300,  vm: { l: 0.28, c: 0x333333 } },
    usp:    { n: 'USP-S',    slot: 2, price: 0,    team: 'CT', dmg: 30,  hs: 3.3, rof: 0.16, range: 100, mag: 12, res: 72,  auto: 0, spread: 0.008, rec: 0.014, rl: 1.9, spd: 1.0,  kill: 300,  vm: { l: 0.32, c: 0x3a3f46 } },
    p250:   { n: 'P250',     slot: 2, price: 300,  team: '',   dmg: 38,  hs: 3.3, rof: 0.15, range: 90,  mag: 13, res: 26,  auto: 0, spread: 0.010, rec: 0.020, rl: 2.0, spd: 1.0,  kill: 300,  vm: { l: 0.27, c: 0x555a60 } },
    tec9:   { n: 'Tec-9',    slot: 2, price: 500,  team: 'T',  dmg: 30,  hs: 3.3, rof: 0.12, range: 90,  mag: 18, res: 90,  auto: 0, spread: 0.012, rec: 0.016, rl: 2.0, spd: 1.0,  kill: 300,  vm: { l: 0.30, c: 0x4a4a3a } },
    fiveseven: { n: 'Five-SeveN', slot: 2, price: 500, team: 'CT', dmg: 31, hs: 3.3, rof: 0.13, range: 100, mag: 20, res: 100, auto: 0, spread: 0.009, rec: 0.015, rl: 2.0, spd: 1.0, kill: 300, vm: { l: 0.30, c: 0x2a2f35 } },
    deagle: { n: 'Desert Eagle', slot: 2, price: 700, team: '', dmg: 56, hs: 3.3, rof: 0.35, range: 120, mag: 7,  res: 35,  auto: 0, spread: 0.006, rec: 0.045, rl: 2.2, spd: 0.97, kill: 300,  vm: { l: 0.38, c: 0xb8b8b8 } },
    // --- pistolets-mitrailleurs
    mac10:  { n: 'MAC-10',   slot: 1, price: 1050, team: 'T',  dmg: 24,  hs: 3.0, rof: 0.07, range: 70,  mag: 30, res: 100, auto: 1, spread: 0.022, rec: 0.010, rl: 2.1, spd: 1.05, kill: 600,  vm: { l: 0.40, c: 0x2c2c2c } },
    mp9:    { n: 'MP9',      slot: 1, price: 1250, team: 'CT', dmg: 25,  hs: 3.0, rof: 0.075,range: 70,  mag: 30, res: 120, auto: 1, spread: 0.020, rec: 0.010, rl: 2.1, spd: 1.05, kill: 600,  vm: { l: 0.42, c: 0x2f3438 } },
    ump45:  { n: 'UMP-45',   slot: 1, price: 1200, team: '',   dmg: 30,  hs: 3.0, rof: 0.09, range: 80,  mag: 25, res: 100, auto: 1, spread: 0.018, rec: 0.012, rl: 2.4, spd: 1.03, kill: 600,  vm: { l: 0.50, c: 0x3a3a3a } },
    p90:    { n: 'P90',      slot: 1, price: 2350, team: '',   dmg: 26,  hs: 3.0, rof: 0.07, range: 80,  mag: 50, res: 100, auto: 1, spread: 0.019, rec: 0.008, rl: 3.0, spd: 1.02, kill: 300,  vm: { l: 0.50, c: 0x2e3a2e } },
    // --- armes lourdes
    nova:   { n: 'Nova',     slot: 1, price: 1200, team: '',   dmg: 18,  hs: 1.5, rof: 0.9,  range: 40,  mag: 8,  res: 32,  auto: 0, spread: 0.055, rec: 0.055, rl: 2.6, spd: 1.0,  kill: 900,  pellets: 8, vm: { l: 0.75, c: 0x5a4a35 } },
    xm1014: { n: 'XM1014',   slot: 1, price: 2000, team: '',   dmg: 18,  hs: 1.5, rof: 0.35, range: 35,  mag: 7,  res: 32,  auto: 1, spread: 0.060, rec: 0.040, rl: 2.8, spd: 0.97, kill: 900,  pellets: 6, vm: { l: 0.75, c: 0x3a3a3a } },
    // --- fusils
    galil:  { n: 'Galil AR', slot: 1, price: 1800, team: 'T',  dmg: 30,  hs: 3.3, rof: 0.09, range: 180, mag: 35, res: 90,  auto: 1, spread: 0.010, rec: 0.014, rl: 2.6, spd: 0.96, kill: 300,  vm: { l: 0.66, c: 0x5a5a40 } },
    famas:  { n: 'FAMAS',    slot: 1, price: 2050, team: 'CT', dmg: 30,  hs: 3.3, rof: 0.09, range: 180, mag: 25, res: 90,  auto: 1, spread: 0.010, rec: 0.013, rl: 2.6, spd: 0.96, kill: 300,  vm: { l: 0.60, c: 0x3a4048 } },
    ak47:   { n: 'AK-47',    slot: 1, price: 2700, team: 'T',  dmg: 36,  hs: 3.3, rof: 0.10, range: 200, mag: 30, res: 90,  auto: 1, spread: 0.008, rec: 0.017, rl: 2.4, spd: 0.95, kill: 300,  vm: { l: 0.70, c: 0x6b4a2a } },
    m4a1:   { n: 'M4A1-S',   slot: 1, price: 3100, team: 'CT', dmg: 33,  hs: 3.3, rof: 0.09, range: 200, mag: 25, res: 75,  auto: 1, spread: 0.007, rec: 0.014, rl: 2.4, spd: 0.95, kill: 300,  vm: { l: 0.68, c: 0x3c4046 } },
    sg553:  { n: 'SG 553',   slot: 1, price: 3000, team: 'T',  dmg: 38,  hs: 3.3, rof: 0.10, range: 220, mag: 30, res: 90,  auto: 1, spread: 0.007, rec: 0.018, rl: 2.8, spd: 0.93, kill: 300,  vm: { l: 0.72, c: 0x4a5038 } },
    aug:    { n: 'AUG',      slot: 1, price: 3300, team: 'CT', dmg: 34,  hs: 3.3, rof: 0.095,range: 220, mag: 30, res: 90,  auto: 1, spread: 0.006, rec: 0.015, rl: 2.8, spd: 0.93, kill: 300,  vm: { l: 0.66, c: 0x4a5a50 } },
    // --- fusils à lunette
    ssg08:  { n: 'SSG 08',   slot: 1, price: 1700, team: '',   dmg: 88,  hs: 2.5, rof: 1.25, range: 300, mag: 10, res: 90,  auto: 0, spread: 0.0,   rec: 0.04,  rl: 3.2, spd: 1.0,  kill: 300,  scope: 1, vm: { l: 0.88, c: 0x3a3f46 } },
    awp:    { n: 'AWP',      slot: 1, price: 4750, team: '',   dmg: 115, hs: 1.6, rof: 1.45, range: 300, mag: 5,  res: 30,  auto: 0, spread: 0.0,   rec: 0.06,  rl: 3.0, spd: 0.85, kill: 100,  ap: 0.8, scope: 1, vm: { l: 0.95, c: 0x2e4a2e } }
  };

  // Boutique : quelles armes chaque camp peut acheter, rangées par catégorie
  const SHOP = {
    T: [
      ['Pistolets', ['p250', 'tec9', 'deagle']],
      ['Pistolets-mitrailleurs', ['mac10', 'ump45', 'p90']],
      ['Armes lourdes', ['nova', 'xm1014']],
      ['Fusils', ['galil', 'ak47', 'sg553']],
      ['Lunettes', ['ssg08', 'awp']]
    ],
    CT: [
      ['Pistolets', ['p250', 'fiveseven', 'deagle']],
      ['Pistolets-mitrailleurs', ['mp9', 'ump45', 'p90']],
      ['Armes lourdes', ['nova', 'xm1014']],
      ['Fusils', ['famas', 'm4a1', 'aug']],
      ['Lunettes', ['ssg08', 'awp']]
    ]
  };

  // B(x, z, largeur, profondeur, hauteur, type, couleur)
  // type : rien = auto (mur si haut, caisse si bas), 'cont' = conteneur coloré
  const B = (x, z, w, d, h, t, c) => ({ x, z, w, d, h, t, c });

  // T au sud (z>0), CT au nord (z<0) sur toutes les cartes
  function makeSpawns() {
    const s = { T: [], CT: [] };
    for (let i = 0; i < 10; i++) {
      const x = -9 + (i % 5) * 4.5;
      s.T.push({ x, y: 0, z: 35 + (i / 5 | 0) * 3, yaw: 0 });
      s.CT.push({ x, y: 0, z: -35 - (i / 5 | 0) * 3, yaw: Math.PI });
    }
    return s;
  }
  const ENCLOSURE = [B(0, -40.5, 82, 1, 10), B(0, 40.5, 82, 1, 10), B(-40.5, 0, 1, 80, 10), B(40.5, 0, 1, 80, 10)];

  const MAPS = {
    // ---------- Carte 1 : Dust (désert) ----------
    dust: {
      id: 'dust', name: 'Dust',
      theme: { sky: 0x9cc3e8, ground: '#c9b287', wall: '#b79c6c', crate: '#8a6335' },
      boxes: ENCLOSURE.concat([
        // couloirs côté T
        B(-14, 18.5, 1.5, 25, 6), B(14, 18.5, 1.5, 25, 6),
        // ligne centrale z=2 avec 3 portes (x=-31, 0, 31)
        B(-37, 2, 6, 1.5, 6), B(-21, 2, 14, 1.5, 6), B(37, 2, 6, 1.5, 6), B(21, 2, 14, 1.5, 6),
        B(-9, 2, 10, 1.5, 6), B(9, 2, 10, 1.5, 6),
        // murs entre sites et zone CT / milieu
        B(-14, -32, 1.5, 16, 6), B(-14, -9, 1.5, 10, 6), B(14, -32, 1.5, 16, 6), B(14, -9, 1.5, 10, 6),
        // couvertures centrales
        B(-20, 33, 3, 2, 1.5), B(20, 33, 3, 2, 1.5), B(0, 18, 5, 5, 2.2), B(-6, 10, 3, 3, 1.5), B(6, 10, 3, 3, 1.5),
        B(0, -14, 4, 4, 2.2), B(-8, -20, 3, 2, 1.5), B(8, -20, 3, 2, 1.5),
        // site A
        B(-30, -20, 4, 4, 2.6), B(-22, -10, 3, 3, 2), B(-34, -8, 2.5, 6, 1.5), B(-24, -25, 5, 2, 1.5),
        // site B
        B(30, -20, 4, 4, 2.6), B(22, -10, 3, 3, 2), B(34, -8, 2.5, 6, 1.5), B(24, -25, 5, 2, 1.5),
        // petites caisses sur lesquelles on peut sauter
        B(-27, -3, 2, 2, 0.9), B(27, -3, 2, 2, 0.9)
      ]),
      sites: { A: { x: -27, z: -14, r: 6.5 }, B: { x: 27, z: -14, r: 6.5 } },
      spawns: makeSpawns()
    },

    // ---------- Carte 2 : Docks (port industriel, conteneurs) ----------
    docks: {
      id: 'docks', name: 'Docks',
      theme: { sky: 0xaebccb, ground: '#6e7277', wall: '#6f6a64', crate: '#7a5a34' },
      boxes: ENCLOSURE.concat([
        // entrepôt central (on ne peut pas passer à travers)
        B(0, 9, 10, 12, 7),
        // murs qui séparent les 3 voies côté T
        B(-18, 12, 1.5, 16, 6), B(18, 12, 1.5, 16, 6),
        // ligne z=-4 avec 3 passages : A (x -22..-10), milieu (x -4..4), B (x 10..22)
        B(-31, -4, 18, 1.5, 6), B(-7, -4, 6, 1.5, 6), B(7, -4, 6, 1.5, 6), B(31, -4, 18, 1.5, 6),
        // murs entre les sites et le spawn CT
        B(-12, -24, 1.5, 16, 6), B(12, -22, 1.5, 12, 6),
        // spawn T : conteneurs et caisses
        B(-26, 26, 10, 2.5, 2.6, 'cont', 0xb5432f), B(26, 26, 10, 2.5, 2.6, 'cont', 0x2f6db5),
        B(-8, 22, 2.5, 5, 1.4), B(8, 22, 2.5, 5, 1.4),
        // voie gauche (vers A)
        B(-30, 10, 3, 3, 1.4), B(-34, 18, 2.5, 7, 2.6, 'cont', 0x3f8a4a), B(-26, 1, 3, 3, 1.4),
        // voie droite (vers B)
        B(30, 10, 7, 2.5, 2.6, 'cont', 0xc98a2b), B(34, 1, 3, 3, 1.4), B(25, 17, 3, 3, 1.4),
        // milieu côté CT
        B(0, -14, 7, 2.5, 2.6, 'cont', 0x7a3fa0), B(0, -26, 3, 3, 4),
        B(-6, -9, 2, 2, 0.9), B(6, -9, 2, 2, 0.9),
        // site A
        B(-31, -14, 6, 2.5, 2.6, 'cont', 0x2f6db5), B(-19, -22, 2.5, 6, 2.6, 'cont', 0xb5432f),
        B(-33, -27, 4, 4, 1.4), B(-25, -34, 8, 2.5, 5.2, 'cont', 0x3f8a4a),
        // site B
        B(31, -11, 2.5, 6, 2.6, 'cont', 0xc98a2b), B(22, -24, 6, 2.5, 2.6, 'cont', 0x7a3fa0),
        B(33, -28, 4, 4, 1.4), B(19, -13, 3, 3, 1.4)
      ]),
      sites: { A: { x: -26, z: -20, r: 6.5 }, B: { x: 26, z: -18, r: 6.5 } },
      spawns: makeSpawns()
    }
  };

  // Compatibilité : anciennes variables = carte Dust
  const BOXES = MAPS.dust.boxes, SITES = MAPS.dust.sites, SPAWNS = MAPS.dust.spawns;

  return { CFG, WEAPONS, SHOP, MAPS, BOXES, SITES, SPAWNS };
});
