/* Données partagées client + serveur (armes, carte, réglages) */
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
  const WEAPONS = {
    knife:  { n: 'Couteau',  slot: 3, price: 0,    team: '',   dmg: 45,  hs: 1,   rof: 0.6,  range: 2.7, mag: 0,  res: 0,   auto: 0, spread: 0,    rec: 0,     rl: 0,   spd: 1.1,  kill: 1500 },
    glock:  { n: 'Glock-18', slot: 2, price: 0,    team: 'T',  dmg: 26,  hs: 3.3, rof: 0.14, range: 100, mag: 20, res: 120, auto: 0, spread: 0.010, rec: 0.012, rl: 1.8, spd: 1.0,  kill: 300,  vm: { l: 0.28, c: 0x333333 } },
    usp:    { n: 'USP-S',    slot: 2, price: 0,    team: 'CT', dmg: 30,  hs: 3.3, rof: 0.16, range: 100, mag: 12, res: 72,  auto: 0, spread: 0.008, rec: 0.014, rl: 1.9, spd: 1.0,  kill: 300,  vm: { l: 0.32, c: 0x3a3f46 } },
    deagle: { n: 'Desert Eagle', slot: 2, price: 700, team: '', dmg: 56, hs: 3.3, rof: 0.35, range: 120, mag: 7,  res: 35,  auto: 0, spread: 0.006, rec: 0.045, rl: 2.2, spd: 0.97, kill: 300,  vm: { l: 0.38, c: 0xb8b8b8 } },
    mac10:  { n: 'MAC-10',   slot: 1, price: 1050, team: 'T',  dmg: 24,  hs: 3.0, rof: 0.07, range: 70,  mag: 30, res: 100, auto: 1, spread: 0.022, rec: 0.010, rl: 2.1, spd: 1.05, kill: 600,  vm: { l: 0.40, c: 0x2c2c2c } },
    mp9:    { n: 'MP9',      slot: 1, price: 1250, team: 'CT', dmg: 25,  hs: 3.0, rof: 0.075,range: 70,  mag: 30, res: 120, auto: 1, spread: 0.020, rec: 0.010, rl: 2.1, spd: 1.05, kill: 600,  vm: { l: 0.42, c: 0x2f3438 } },
    nova:   { n: 'Nova',     slot: 1, price: 1200, team: '',   dmg: 18,  hs: 1.5, rof: 0.9,  range: 40,  mag: 8,  res: 32,  auto: 0, spread: 0.055, rec: 0.055, rl: 2.6, spd: 1.0,  kill: 900,  pellets: 8, vm: { l: 0.75, c: 0x5a4a35 } },
    ak47:   { n: 'AK-47',    slot: 1, price: 2700, team: 'T',  dmg: 36,  hs: 3.3, rof: 0.10, range: 200, mag: 30, res: 90,  auto: 1, spread: 0.008, rec: 0.017, rl: 2.4, spd: 0.95, kill: 300,  vm: { l: 0.70, c: 0x6b4a2a } },
    m4a1:   { n: 'M4A1-S',   slot: 1, price: 3100, team: 'CT', dmg: 33,  hs: 3.3, rof: 0.09, range: 200, mag: 25, res: 75,  auto: 1, spread: 0.007, rec: 0.014, rl: 2.4, spd: 0.95, kill: 300,  vm: { l: 0.68, c: 0x3c4046 } },
    awp:    { n: 'AWP',      slot: 1, price: 4750, team: '',   dmg: 115, hs: 1.6, rof: 1.45, range: 300, mag: 5,  res: 30,  auto: 0, spread: 0.0,   rec: 0.06,  rl: 3.0, spd: 0.85, kill: 100,  ap: 0.8, scope: 1, vm: { l: 0.95, c: 0x2e4a2e } }
  };

  const B = (x, z, w, d, h) => ({ x, z, w, d, h });
  // Carte "Dust" simplifiée : T au sud (z>0), CT au nord (z<0), sites A (ouest) et B (est)
  const BOXES = [
    // enceinte
    B(0, -40.5, 82, 1, 10), B(0, 40.5, 82, 1, 10), B(-40.5, 0, 1, 80, 10), B(40.5, 0, 1, 80, 10),
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
  ];

  const SITES = { A: { x: -27, z: -14, r: 6.5 }, B: { x: 27, z: -14, r: 6.5 } };

  const SPAWNS = { T: [], CT: [] };
  for (let i = 0; i < 10; i++) {
    const x = -9 + (i % 5) * 4.5;
    SPAWNS.T.push({ x, y: 0, z: 35 + (i / 5 | 0) * 3, yaw: 0 });
    SPAWNS.CT.push({ x, y: 0, z: -35 - (i / 5 | 0) * 3, yaw: Math.PI });
  }

  return { CFG, WEAPONS, BOXES, SITES, SPAWNS };
});
