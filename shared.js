/* Données partagées client + serveur (armes, cartes, réglages) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CS = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const CFG = {
    tick: 50,            // ms (logique serveur + snapshots)
    freeze: 10,          // s de phase d'achat
    live: 115,           // s de manche
    end: 8,              // s entre deux manches (assez pour aller prendre l'arme du dernier tué)
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
    armorHead: 0.85,     // multiplicateur de dégâts tête si casque
    armorWear: 1.2,      // usure du gilet par point de dégât reçu sur le corps (> réduction : le gilet casse avant que la vie tombe à 0)
    penLoss: 0.6,        // dégâts conservés à chaque obstacle traversé
    tagTime: 0.45,       // s de ralentissement quand on est touché
    maxDrops: 24,        // armes au sol par salle
    pickRange: 1.9,      // m : portée de E pour prendre une arme
    pickAuto: 1.0,       // m : ramassage automatique si l'emplacement est libre
    // grenades
    grenTotal: 4,        // grenades portées au maximum
    flashRange: 42,      // m : portée de l'aveuglement
    heRadius: 10,        // m : rayon de la fragmentation
    heDmg: 100,          // dégâts au centre
    smokeTime: 18,       // s : durée du nuage
    smokeRadius: 3.8,
    fireTime: 7,         // s : durée du feu
    fireRadius: 3.4,
    fireTick: 0.5,       // s entre deux brûlures
    fireDmg: 8
  };

  // Grenades : max = nombre portable de ce type, fuse = délai avant l'effet (s)
  // La Molotov éclate au premier contact avec le sol (ou après fuse)
  const GREN = {
    flash: { n: 'Grenade flash', price: 200, max: 2, fuse: 1.6 },
    smoke: { n: 'Fumigène', price: 300, max: 1, fuse: 1.8 },
    he:    { n: 'Grenade à fragmentation', price: 300, max: 1, fuse: 1.6 },
    molo:  { n: 'Cocktail Molotov', price: 400, max: 1, fuse: 3.0 }
  };

  // Multiplicateurs de dégâts par zone du corps (h = tête : voir w.hs)
  // c = torse, s = ventre, a = bras, l = jambes
  const ZONES = { c: 1, s: 1.25, a: 0.85, l: 0.72 };

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

  // Caractéristiques réalistes, par famille d'arme :
  // cls = famille, fall = dégâts conservés tous les 25 m, ap = perce-gilet (0 à 1),
  // pen = 0 rien, 1 traverse le bois, 2 traverse aussi la tôle des conteneurs
  const FAMILY = {
    pistol:  { fall: 0.80, ap: 0.20, pen: 1, spd: 1.00 },
    smg:     { fall: 0.72, ap: 0.25, pen: 1, spd: 0.97 },
    shotgun: { fall: 0.35, ap: 0.10, pen: 0, spd: 0.88 },
    rifle:   { fall: 0.95, ap: 0.55, pen: 2, spd: 0.88 },
    sniper:  { fall: 1.00, ap: 0.80, pen: 2, spd: 0.84 }
  };
  const FAMILY_OF = {
    glock: 'pistol', usp: 'pistol', p250: 'pistol', tec9: 'pistol', fiveseven: 'pistol', deagle: 'pistol',
    mac10: 'smg', mp9: 'smg', ump45: 'smg', p90: 'smg', nova: 'shotgun', xm1014: 'shotgun',
    galil: 'rifle', famas: 'rifle', ak47: 'rifle', m4a1: 'rifle', sg553: 'rifle', aug: 'rifle', ssg08: 'sniper', awp: 'sniper'
  };
  Object.keys(FAMILY_OF).forEach((id) => {
    const f = FAMILY[FAMILY_OF[id]], w = WEAPONS[id];
    w.cls = FAMILY_OF[id]; w.fall = f.fall; w.pen = f.pen; w.spd = f.spd;
    if (w.ap === undefined) w.ap = f.ap;
  });
  WEAPONS.knife.cls = 'knife'; WEAPONS.knife.fall = 1; WEAPONS.knife.pen = 0; WEAPONS.knife.ap = 0.3; WEAPONS.knife.spd = 1.05;
  WEAPONS.deagle.ap = 0.6; WEAPONS.deagle.spd = 0.95; WEAPONS.deagle.pen = 2;
  WEAPONS.fiveseven.ap = 0.45; WEAPONS.p90.ap = 0.4;
  WEAPONS.awp.spd = 0.8;
  WEAPONS.usp.sup = 1; WEAPONS.m4a1.sup = 1;      // silencieux
  WEAPONS.nova.shell = 1; WEAPONS.xm1014.shell = 1; // rechargement cartouche par cartouche
  WEAPONS.nova.pump = 1; WEAPONS.ssg08.bolt = 1; WEAPONS.awp.bolt = 1; // réarmement manuel

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
  // hz = demi-profondeur de la carte (40 m pour les cartes de 80 × 80 m)
  function makeSpawns(hz) {
    hz = hz || 40;
    const s = { T: [], CT: [] };
    for (let i = 0; i < 10; i++) {
      const x = -9 + (i % 5) * 4.5;
      s.T.push({ x, y: 0, z: hz - 5 + (i / 5 | 0) * 3, yaw: 0 });
      s.CT.push({ x, y: 0, z: -hz + 5 - (i / 5 | 0) * 3, yaw: Math.PI });
    }
    return s;
  }
  // enceinte : 4 murs de 10 m autour d'une carte de 2hx × 2hz mètres
  const enclosure = (hx, hz) => [B(0, -hz - 0.5, 2 * hx + 2, 1, 10), B(0, hz + 0.5, 2 * hx + 2, 1, 10), B(-hx - 0.5, 0, 1, 2 * hz, 10), B(hx + 0.5, 0, 1, 2 * hz, 10)];
  const ENCLOSURE = enclosure(40, 40);

  // Carte dessinée en grille : 40 lignes de 40 caractères, 1 caractère = 2 m. Nord (CT) en haut, sud (T) en bas.
  // . sol   # bâtiment   H bâtiment plus haut   = muret   c petite caisse   C grande caisse   b fût
  // 5 terrasse de 2,5 m sur laquelle on marche (à desservir avec stairs)
  // r u g y v conteneurs de couleur (R U G Y V = plus hauts). Les cases identiques voisines forment un seul bloc.
  const CONT = { r: 0xb5432f, u: 0x2f6db5, g: 0x3f8a4a, y: 0xc98a2b, v: 0x7a3fa0 };
  function fromGrid(rows, wallH, contH) {
    const seen = rows.map((r) => r.split('').map(() => false)), out = [];
    const def = (ch) => {
      if (ch === '#') return { h: wallH };
      if (ch === 'H') return { h: wallH + 2 };
      if (ch === '5') return { h: 2.5, t: 'w' };
      if (ch === '=') return { h: 1.1, t: 'w' };
      if (ch === 'c') return { h: 1.4 };
      if (ch === 'C') return { h: 2.4 };
      const l = ch.toLowerCase();
      if (CONT[l]) return { h: ch === l ? contH : contH * 1.5, t: 'cont', c: CONT[l] };
      return null;
    };
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (seen[r][c] || ch === '.') continue;
        if (ch === 'b') { out.push(B(-40 + c * 2 + 1, -40 + r * 2 + 1, 0.8, 0.8, 1.1, 'barrel')); continue; }
        const d = def(ch); if (!d) continue;
        let w = 1, h = 1;
        while (c + w < row.length && row[c + w] === ch && !seen[r][c + w]) w++;
        for (;;) {
          if (r + h >= rows.length) break;
          let full = true;
          for (let i = 0; i < w; i++) if (rows[r + h][c + i] !== ch || seen[r + h][c + i]) { full = false; break; }
          if (!full) break;
          h++;
        }
        for (let a = 0; a < h; a++) for (let b = 0; b < w; b++) seen[r + a][c + b] = true;
        out.push(B(-40 + c * 2 + w, -40 + r * 2 + h, w * 2, h * 2, d.h, d.t, d.c));
      }
    });
    return out;
  }

  // Escalier : n marches de 0,5 m (franchies sans sauter), de largeur w.
  // (x, z) = pied de la première marche, (dx, dz) = sens de la montée.
  function stairs(x, z, w, dx, dz, n) {
    const run = 0.6, out = [];
    for (let i = 0; i < n; i++) {
      const cx = x + dx * (i + 0.5) * run, cz = z + dz * (i + 0.5) * run;
      out.push(dx ? B(cx, cz, run, w, (i + 1) * 0.5, 'w') : B(cx, cz, w, run, (i + 1) * 0.5, 'w'));
    }
    return out;
  }
  // Conteneur à l'échelle réelle : L = 6 ou 12 m, sens 'x' ou 'z', n = nombre d'étages (2,6 m chacun).
  const K = (x, z, L, sens, n, c) => (sens === 'x' ? B(x, z, L, 2.5, n * 2.6, 'cont', CONT[c]) : B(x, z, 2.5, L, n * 2.6, 'cont', CONT[c]));

  // Stand de tir : tout le monde part du pas de tir, face au nord (les cibles sont devant)
  function rangeSpawns() {
    const s = { T: [], CT: [] };
    for (let i = 0; i < 10; i++) {
      const p = { x: -11.2 + (i % 5) * 5.6, y: 0, z: 33.2 + (i / 5 | 0) * 2.4, yaw: 0 };
      s.T.push(p); s.CT.push(Object.assign({}, p));
    }
    return s;
  }

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
        B(-27, -3, 2, 2, 0.9), B(27, -3, 2, 2, 0.9),
        // fûts
        B(-12.6, 13, 0.8, 0.8, 1.1, 'barrel'), B(12.6, 24, 0.8, 0.8, 1.1, 'barrel'), B(-36, -14, 0.8, 0.8, 1.1, 'barrel'),
        B(36, -14, 0.8, 0.8, 1.1, 'barrel'), B(3, -24, 0.8, 0.8, 1.1, 'barrel')
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
        B(33, -28, 4, 4, 1.4), B(19, -13, 3, 3, 1.4),
        // fûts
        B(-16.6, 6, 0.8, 0.8, 1.1, 'barrel'), B(16.6, 15, 0.8, 0.8, 1.1, 'barrel'), B(-10, -28, 0.8, 0.8, 1.1, 'barrel'),
        B(10, -19, 0.8, 0.8, 1.1, 'barrel')
      ]),
      sites: { A: { x: -26, z: -20, r: 6.5 }, B: { x: 26, z: -18, r: 6.5 } },
      spawns: makeSpawns()
    },

    // ---------- Carte 3 : Médina (Longue A, milieu, tunnels B) ----------
    medina: {
      id: 'medina', name: 'Médina', style: 'dust',
      theme: { sky: 0xe0b98c, ground: '#c9b287', wall: '#b79c6c', crate: '#8a6335' },
      grid: [
        'HHHHHHHHHHHH................####HHHHHHHH',
        'HHHHHHHHHHHH................####HHHHHHHH',
        'HHHHHHHH........................HHHHHHHH',
        'HHHHHHHH........................HHHHHHHH',
        'HHHHHHHH........................HHHHHHHH',
        'HHHHHHHH........................HHHHHHHH',
        'HHHHHHHH....#######...######....HHHHHHHH',
        'HHHHHHHH....#######...##..........5555##',
        '###cc...........#.b...##..c.......5555##',
        '###...CC..c.....#.....##..c.......5555##',
        '###...CC........#c............CC......##',
        '###..........555#.............CC......##',
        '###..........555......##..............##',
        '###..==....cc555......##...CC......==.##',
        '###........cc555....==##...CC.........##',
        '###.............#.....##..............##',
        '##...############.....#########...######',
        '##...############.....#########...######',
        '##...#HHHHHHHHHHH.....########......####',
        '#....#HHHHHHHHHHH.....########......####',
        '#b...#HHHHHHHHHHHCC......###.....b..####',
        '#....#HHHHHHHHHHHCC.................####',
        '#....#HHHHHHHHHHH.................######',
        '#..==#HHHHHHHHHHH.....HHHHHHHH....######',
        '#....#HHH....HHHH.....HHHHHHHH......####',
        '#....#HHH....HHHH....cHHHHHHHH......####',
        '#.....................HHHHHHHH......####',
        '#.....................HHHHHHHH##....####',
        '#cc..####....#........HHHHHHHH##....####',
        '#....####....#......b.HHHHHHHH......####',
        '#....#########....####HHHHHHHH......####',
        '#....#########....####HHHHHHHH......####',
        '#....#########....####HHHHHHHH......####',
        '#...........##....####HHHHHH........####',
        '#...................................####',
        '#....b..............................####',
        '#...................................####',
        '############................############',
        '############................############',
        '############................############'
      ],
      extra: [].concat(
        stairs(-5.6, -13, 6, -1, 0, 4),          // escalier du milieu vers le balcon de A
        stairs(34, -17.6, 4, 0, -1, 4),          // escalier de la terrasse du palais
        [B(-13.7, -16, 0.6, 4, 3.6, 'w'), B(-11, -17.7, 6, 0.6, 3.6, 'w')]     // parapet du balcon : on tire par-dessus, accroupi derrière
      ),
      sites: { A: { x: -24, z: -15, r: 6.5 }, B: { x: 27, z: -17, r: 6.5 } },
      // [x, z, largeur, profondeur, bas, hauteur] : portes, tunnels, passages couverts
      arches: [[-33, -6, 6, 2, 3.2, 2.8], [1, -26, 6, 4, 3.2, 2.8], [6, -18, 2, 4, 3.2, 2.8], [25, -6, 6, 4, 3.2, 2.8], [26, 9, 12, 6, 3.2, 2.8], [26, 20, 12, 4, 3.2, 2.8], [-27, 14, 2, 4, 3.2, 2.8]],
      signs: [[-30.05, 2.6, 4, -1, 0, 'A'], [-5.95, 2.6, -4, 1, 0, 'A'], [3.95, 2.6, -13, -1, 0, 'B'], [-8, 2.6, -28.05, 0, -1, 'A'], [12, 2.6, -28.05, 0, -1, 'B'], [31.95, 2.6, 2, -1, 0, 'B']],
      marks: [[-30, 33, -1, 0, 'A'], [-35, 8, 0, -1, 'A'], [-2, 18, 0, -1, 'A'], [-3, 18, 1, 0, 'B'], [27, 30, 0, -1, 'B'], [24, 12, 0, -1, 'B'], [-14, -32, -1, 0, 'A'], [14, -32, 1, 0, 'B']],
      lines: [[-34, 20, 1, 4], [-34, 10, 1, 4], [-1, 6, 1, 5], [-1, -4, 1, 5], [28, 17, 1, 4], [-25, 14, 0, 2]],
      awnings: [[-29, -23.98, 1, 0xb5442e], [10, -25.98, 1, 0x2e6b8a], [0, 19.98, -1, 0xcda034], [14, -8.02, -1, 0x7c3a2e]],
      spawns: makeSpawns()
    },

    // ---------- Carte 4 : Cargo (terminal à conteneurs : quai, allée centrale, voie B) ----------
    cargo: {
      id: 'cargo', name: 'Cargo', style: 'docks',
      theme: { sky: 0x8d99a6, ground: '#6e7277', wall: '#6f6a64', crate: '#7a5a34' },
      boxes: ENCLOSURE.concat([
        // grands volumes : hangar, bureaux du port, entrepôt
        B(6, -15, 16, 14, 7), B(-20, 1, 12, 14, 6), B(8, 23, 24, 8, 7),
        // îlot de conteneurs entre le quai et le milieu
        K(-24.75, 20, 12, 'z', 2, 'r'), K(-14.75, 20, 12, 'z', 2, 'u'), K(-20, 15.25, 12, 'x', 3, 'g'), K(-20, 24.75, 12, 'x', 2, 'y'),
        // îlot entre l'allée et la liaison T
        K(4, 6.75, 12, 'x', 2, 'y'), K(14, 6.75, 8, 'x', 2, 'r'), K(4, 10.75, 12, 'x', 3, 'u'), K(14, 10.75, 8, 'x', 2, 'g'), K(-0.75, 8.75, 6.5, 'z', 2, 'v'), K(16.75, 8.75, 6.5, 'z', 2, 'u'),
        // quai : bord ouest et couvertures
        K(-38.75, 22, 12, 'z', 2, 'g'), K(-38.75, 4, 12, 'z', 2, 'y'), K(-32, 14, 6, 'z', 1, 'r'), K(-30.5, -3.5, 6, 'x', 1, 'u'),
        B(-34, 5.5, 2.4, 2.4, 1.4), B(-29, 24, 2.4, 2.4, 1.4), K(-27, 32, 6, 'x', 1, 'v'),
        // site A : murs
        K(-34, -34.25, 12, 'x', 3, 'r'), K(-27, -34.25, 2, 'x', 3, 'r'), K(-37, -11.25, 6, 'x', 2, 'g'), K(-22, -11.25, 12, 'x', 2, 'u'),
        K(-15.25, -15, 6, 'z', 2, 'v'), K(-15.25, -27, 6, 'z', 2, 'r'),
        // site A : couvertures
        K(-31, -24.5, 6, 'x', 1, 'u'), B(-27, -24.5, 2, 2.5, 1.4), K(-23, -17, 6, 'z', 2, 'g'), B(-33.5, -16.5, 2.4, 2.4, 1.4), K(-37.5, -24, 6, 'z', 2, 'v'),
        // bouchons du milieu : coupent la vue entre les départs
        K(-12, -26.25, 12, 'x', 2, 'y'), K(-6.5, 26.25, 5, 'x', 2, 'g'),
        // milieu : couvertures et portique
        K(-9, -5, 6, 'z', 1, 'r'), B(-6, 19, 2.4, 2.4, 2.4), B(-11.5, 21.5, 2.4, 2.4, 1.4), B(-5, 1, 6, 0.6, 1.1, 'w'), B(-13.2, 4, 1.2, 1.2, 6.5), B(-2.8, 4, 1.2, 1.2, 6.5),
        // allée vers B
        K(7, -1, 12, 'x', 1, 'g'), B(15, -3.5, 2.4, 2.4, 1.4),
        // liaison T
        B(8, 15.5, 2.4, 2.4, 1.4),
        // site B : murs
        K(19.25, -11, 10, 'z', 2, 'g'), K(19.25, 2.5, 7, 'z', 2, 'y'), K(32, -17.25, 12, 'x', 2, 'r'), K(39, -17.25, 2, 'x', 2, 'u'),
        K(21.75, 7.25, 6, 'x', 2, 'v'), K(36.5, 7.25, 7, 'x', 2, 'y'),
        // site B : couvertures
        K(33, -9, 6, 'z', 1, 'y'), K(35.5, -9, 6, 'z', 2, 'r'), B(33, -4.9, 2.5, 2.2, 1.4), K(24, -12, 6, 'x', 1, 'u'), B(27.9, -12, 1.8, 2.5, 1.4), B(25, -3, 2.4, 2.4, 1.4),
        // voie B
        K(33.25, 14.5, 12, 'z', 2, 'u'), K(33.25, 24.25, 7.5, 'z', 3, 'r'), K(36.5, 28.75, 7, 'x', 2, 'g'), K(25, 18, 6, 'z', 1, 'v'), B(29.5, 24, 2.4, 2.4, 1.4),
        // fûts
        B(-3.4, -21, 0.8, 0.8, 1.1, 'barrel'), B(21.6, 12, 0.8, 0.8, 1.1, 'barrel'), B(-27, -8.6, 0.8, 0.8, 1.1, 'barrel'), B(37, -14, 0.8, 0.8, 1.1, 'barrel'), B(-13, 9, 0.8, 0.8, 1.1, 'barrel')
      ]),
      sites: { A: { x: -28, z: -19, r: 6.5 }, B: { x: 28, z: -8, r: 6.5 } },
      arches: [[-31, -11.25, 6.4, 2.5, 4.4, 0.8], [29, 7.25, 8.6, 2.5, 4.4, 0.8], [-8, 4, 11.6, 1.2, 6.1, 0.9]],
      signs: [[-26.05, 2.6, 3, -1, 0, 'A'], [-13.95, 2.6, -2, 1, 0, 'A'], [10, 2.6, -7.95, 0, 1, 'B'], [8, 2.6, -22.05, 0, -1, 'B'], [20.05, 2.6, 23, 1, 0, 'B'], [-12, 2.6, -27.55, 0, -1, 'A']],
      marks: [[-20, 33, -1, 0, 'A'], [-33, 2, 0, -1, 'A'], [-9, 24, 0, -1, 'A'], [-7, 13, 1, 0, 'B'], [24, 30, 0, -1, 'B'], [8, 2.5, 1, 0, 'B'], [-14, -33, -1, 0, 'A'], [14, -26, 1, 0, 'B']],
      stripes: [[-26, 28, -26, -9], [-26, -9, -40, -9], [21, 8, 21, 27], [21, 27, 40, 27], [-2, 4, 19, 4]],
      rails: [-36, -34.5],
      spawns: makeSpawns()
    },

    // ---------- Entraînement : stand de tir (cibles gérées par le client) ----------
    range: {
      id: 'range', name: 'Stand de tir', style: 'docks', practice: 1,
      theme: { sky: 0xaebccb, ground: '#6e7277', wall: '#6f6a64', crate: '#7a5a34' },
      boxes: ENCLOSURE.concat([
        // couloir de tir de 28 m de large, butte au fond
        B(-14.5, 0, 1, 80, 6.5), B(14.5, 0, 1, 80, 6.5), B(0, -37.5, 28, 2, 9),
        // pas de tir : comptoir sur toute la largeur (on tire par-dessus), séparations des 5 postes
        B(0, 31.2, 28, 0.5, 1.1, 'w'),
        B(-8.4, 32.6, 0.25, 2, 1.6, 'w'), B(-2.8, 32.6, 0.25, 2, 1.6, 'w'), B(2.8, 32.6, 0.25, 2, 1.6, 'w'), B(8.4, 32.6, 0.25, 2, 1.6, 'w'),
        // couvertures dans la zone des cibles
        B(-9, 14, 3, 1, 1.4), B(7, 6, 3, 1, 1.4), B(-2, -6, 4, 1, 2.4), B(9, -16, 3, 1, 1.4), B(-9, -24, 3, 1, 1.4), B(4, -27, 4, 1, 2.4),
        // fond du stand : établis
        B(-11.5, 38.2, 4, 1.6, 1.1), B(11.5, 38.2, 4, 1.6, 1.1)
      ]),
      // barrière invisible au-dessus du comptoir : on tire par-dessus, mais on ne passe pas dans la zone des cibles
      bar: [{ x: 0, z: 31.2, w: 28, d: 0.5 }],
      sites: {},
      // lignes au sol tous les 10 m depuis le pas de tir
      stripes: [[-13.5, 30.5, 13.5, 30.5], [-13.5, 20.5, 13.5, 20.5], [-13.5, 10.5, 13.5, 10.5], [-13.5, 0.5, 13.5, 0.5], [-13.5, -9.5, 13.5, -9.5], [-13.5, -19.5, 13.5, -19.5], [-13.5, -29.5, 13.5, -29.5]],
      spawns: rangeSpawns()
    },

    // ---------- Entraînement : zone de test (pénétration, sauts, escalier, deux sites) ----------
    labo: {
      id: 'labo', name: 'Labo', style: 'docks', practice: 1,
      theme: { sky: 0xaebccb, ground: '#6e7277', wall: '#6f6a64', crate: '#7a5a34' },
      boxes: ENCLOSURE.concat([
        // ligne de pénétration (z = 6) : bois, béton, tôle de conteneur, muret, fût
        B(-30, 6, 5, 0.5, 2.4), B(-22, 6, 5, 0.8, 3.2), K(-13, 6, 6, 'x', 1, 'u'), B(-5, 6, 5, 0.6, 1.1, 'w'), B(1, 6, 0.8, 0.8, 1.1, 'barrel'),
        // hauteurs de saut : 0,5 m (on monte en marchant), 0,9 et 1,4 m (saut), 2 et 2,6 m (impossible)
        B(8, 14, 2, 2, 0.5), B(11, 14, 2, 2, 0.9), B(14, 14, 2, 2, 1.4), B(17, 14, 2, 2, 2.0), B(20, 14, 2, 2, 2.6),
        // terrasse de 2,5 m et son escalier
        B(30, 16.5, 6, 5, 2.5, 'w')
      ], stairs(30, 22, 4, 0, -1, 5), [
        // site A
        B(-26, -14, 3, 1, 1.4), B(-31, -27, 2, 2, 2.4), K(-21, -29, 6, 'x', 1, 'r'),
        // site B
        B(26, -14, 3, 1, 1.4), B(31, -27, 2, 2, 2.4), K(21, -29, 6, 'x', 1, 'g'),
        // milieu
        B(0, -18, 4, 4, 2.4), B(-9, -8, 1.5, 8, 6), B(9, -8, 1.5, 8, 6)
      ]),
      sites: { A: { x: -26, z: -22, r: 6.5 }, B: { x: 26, z: -22, r: 6.5 } },
      marks: [[-14, -32, -1, 0, 'A'], [14, -32, 1, 0, 'B']],
      spawns: makeSpawns()
    }
  };
  // carte en grille : on en déduit les obstacles, auxquels s'ajoutent les éléments fins (escaliers, parapets)
  MAPS.medina.boxes = ENCLOSURE.concat(fromGrid(MAPS.medina.grid, 6, 2.6), MAPS.medina.extra);
  MAPS.dust.style = 'dust'; MAPS.docks.style = 'docks';
  Object.keys(MAPS).forEach((k) => { MAPS[k].hx = MAPS[k].hx || 40; MAPS[k].hz = MAPS[k].hz || 40; });

  /* ---------- Cartes perso (éditeur de cartes) ----------
     Format source (JSON, celui de l'éditeur) :
       { v: 1, name, style: 'dust' | 'docks', sky: 'dust' | 'medina' | 'docks' | 'cargo' | 'labo',
         boxes: [{ x, z, w, d, h, t, c }], stairs: [{ x, z, w, dir: 'n'|'s'|'e'|'w', n }],
         arches: [[x, z, w, d, bas, épaisseur]], marks: [[x, z, dx, dz, 'A']],
         sites: { A: { x, z, r }, B: {...} }, spawns: { T: [{ x, z, yaw? }], CT: [...] } }
     sanitizeMap nettoie (le serveur et le jeu obtiennent exactement la même carte), buildCustom fabrique la carte jouable. */
  const MAP_T = { w: 1, cont: 1, barrel: 1 };
  const MAP_SKY = ['dust', 'medina', 'docks', 'cargo', 'labo'];
  const MAP_DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const MAP_MIN = 40, MAP_MAX = 160;
  function sanitizeMap(src) {
    src = src && typeof src === 'object' ? src : {};
    const n = (v, a, b, d) => { v = +v; if (!isFinite(v)) v = d; return Math.max(a, Math.min(b, Math.round(v * 100) / 100)); };
    const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []).filter((o) => o && typeof o === 'object');
    const style = src.style === 'docks' ? 'docks' : 'dust';
    // taille de la carte : 40 à 160 m de côté, par pas de 2 m (80 × 80 m par défaut)
    const size = (v) => Math.round(n(v, MAP_MIN, MAP_MAX, 80) / 2) * 2;
    const W = size(src.w), Dp = size(src.d), hx = W / 2, hz = Dp / 2;
    const out = {
      v: 1, name: String(src.name || 'Ma carte').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 24) || 'Ma carte',
      style, sky: MAP_SKY.indexOf(src.sky) >= 0 ? src.sky : style,
      desc: String(src.desc || '').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 40),
      col: /^#[0-9a-f]{6}$/i.test(src.col || '') ? src.col.toLowerCase() : '#c99bff',
      w: W, d: Dp,
      boxes: arr(src.boxes, 800).map((b) => {
        const t = MAP_T[b.t] ? b.t : '';
        const o = { x: n(b.x, -hx, hx, 0), z: n(b.z, -hz, hz, 0), w: n(b.w, 0.2, MAP_MAX, 2), d: n(b.d, 0.2, MAP_MAX, 2), h: n(b.h, 0.2, 20, 2) };
        if (t) o.t = t;
        if (t === 'barrel') { o.w = o.d = 0.8; o.h = 1.1; }
        if (t === 'cont') o.c = n(b.c, 0, 0xffffff, 0xb5432f) | 0;
        return o;
      }),
      stairs: arr(src.stairs, 40).filter((s) => MAP_DIR[s.dir]).map((s) => ({ x: n(s.x, -hx, hx, 0), z: n(s.z, -hz, hz, 0), w: n(s.w, 0.6, 12, 3), dir: s.dir, n: n(s.n, 1, 16, 4) | 0 })),
      arches: arr(src.arches, 40).filter(Array.isArray).map((a) => [n(a[0], -hx, hx, 0), n(a[1], -hz, hz, 0), n(a[2], 0.4, 60, 4), n(a[3], 0.4, 60, 2), n(a[4], 1.5, 12, 3.2), n(a[5], 0.2, 4, 0.8)]),
      marks: arr(src.marks, 60).filter(Array.isArray).map((m) => { const l = Math.hypot(+m[2] || 0, +m[3] || 0) || 1; return [n(m[0], -hx, hx, 0), n(m[1], -hz, hz, 0), n((+m[2] || 0) / l, -1, 1, 1), n((+m[3] || 0) / l, -1, 1, 0), m[4] === 'B' ? 'B' : 'A']; }),
      sites: {}, spawns: { T: [], CT: [] }
    };
    ['A', 'B'].forEach((k) => { const s = src.sites && src.sites[k]; if (s && typeof s === 'object') out.sites[k] = { x: n(s.x, -hx, hx, 0), z: n(s.z, -hz, hz, 0), r: n(s.r, 2, 12, 6.5) }; });
    ['T', 'CT'].forEach((t) => {
      out.spawns[t] = arr(src.spawns && src.spawns[t], 10).map((p) => {
        const o = { x: n(p.x, -hx + 0.5, hx - 0.5, 0), z: n(p.z, -hz + 0.5, hz - 0.5, 0) };
        if (p.yaw != null && isFinite(+p.yaw)) o.yaw = n(p.yaw, -7, 7, 0);
        return o;
      });
    });
    return out;
  }
  function buildCustom(src, id) {
    const S = sanitizeMap(src);
    const extra = [];
    S.stairs.forEach((s) => { const d = MAP_DIR[s.dir]; extra.push.apply(extra, stairs(s.x, s.z, s.w, d[0], d[1], s.n)); });
    const hx = S.w / 2, hz = S.d / 2;
    const boxes = enclosure(hx, hz).concat(S.boxes.map((b) => B(b.x, b.z, b.w, b.d, b.h, b.t, b.c)), extra);
    // départ posé sur une terrasse : on part à sa hauteur ; sans départ placé : départs habituels
    const floorAt = (x, z) => { let y = 0; boxes.forEach((b) => { if ((b.t === 'w' || b.h <= 0.55) && b.h <= 6 && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) y = Math.max(y, b.h); }); return y; };
    const def = makeSpawns(hz), spawns = {};
    ['T', 'CT'].forEach((t) => {
      spawns[t] = S.spawns[t].length ? S.spawns[t].map((p) => ({ x: p.x, y: floorAt(p.x, p.z), z: p.z, yaw: p.yaw != null ? p.yaw : Math.atan2(p.x, p.z) })) : def[t];
    });
    const dust = S.style === 'dust';
    return {
      id, name: S.name, style: S.style, sky: S.sky, custom: 1, hx, hz,
      theme: dust ? { sky: 0x9cc3e8, ground: '#c9b287', wall: '#b79c6c', crate: '#8a6335' } : { sky: 0xaebccb, ground: '#6e7277', wall: '#6f6a64', crate: '#7a5a34' },
      boxes, sites: S.sites, spawns, arches: S.arches, marks: S.marks, signs: [], awnings: [], lines: [], stripes: [], rails: []
    };
  }
  // l'inverse : une carte intégrée au format de l'éditeur (pour partir d'une carte existante)
  function mapToSource(M) {
    const hx = M.hx || 40, hz = M.hz || 40;
    const enc = (b) => b.h >= 10 && (Math.abs(Math.abs(b.x) - hx - 0.5) < 0.01 || Math.abs(Math.abs(b.z) - hz - 0.5) < 0.01);
    return sanitizeMap({
      name: M.name + ' (copie)', w: hx * 2, d: hz * 2, style: (M.style || M.id) === 'dust' ? 'dust' : 'docks', sky: MAP_SKY.indexOf(M.id) >= 0 ? M.id : (M.style || 'dust'),
      boxes: M.boxes.filter((b) => !enc(b)), arches: M.arches || [], marks: M.marks || [], sites: M.sites,
      spawns: { T: M.spawns.T.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw })), CT: M.spawns.CT.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw })) }
    });
  }

  // carte faite avec l'éditeur et ajoutée au jeu : elle a son bouton dans le menu (game.js) et passe partout comme une carte d'origine
  function addEditorMap(id, src) {
    const M = buildCustom(src, id), S = sanitizeMap(src);
    delete M.custom; M.ed = { desc: S.desc || 'Carte de l\'éditeur', col: S.col };
    MAPS[id] = M;
  }
  // ---------- Cartes ajoutées depuis l'éditeur (fichier .json donné par l'éditeur : une ligne par carte) ----------
  // addEditorMap('id_de_la_carte', { ...contenu du fichier... });

  // Compatibilité : anciennes variables = carte Dust
  const BOXES = MAPS.dust.boxes, SITES = MAPS.dust.sites, SPAWNS = MAPS.dust.spawns;

  // Mode « Rien n'est à sa place » : obstacles qui peuvent disparaître puis réapparaître pendant une manche.
  // Choix déterministe (même liste sur le serveur et chez chaque joueur) : murs intérieurs, caisses, conteneurs,
  // mais ni l'enceinte, ni les grands bâtiments, ni les escaliers, ni les terrasses.
  function phaseBoxes(M) {
    if (M._phase) return M._phase;
    let s = 0; for (const ch of M.id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const list = [];
    M.boxes.forEach((b, i) => {
      if (b.h >= 10 || b.h < 1.1 || b.t === 'barrel') return;
      if (b.w * b.d > 80 || Math.max(b.w, b.d) > 16) return;
      if (b.t === 'w' && (Math.min(b.w, b.d) <= 0.7 || b.h === 2.5)) return;
      if (Math.abs(b.z) > (M.hz || 40) - 9) return;     // les zones de départ restent intactes
      if (b.h >= 10 && (Math.abs(Math.abs(b.x) - (M.hx || 40) - 0.5) < 0.01 || Math.abs(Math.abs(b.z) - (M.hz || 40) - 0.5) < 0.01)) return;   // enceinte
      list.push(i);
    });
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return (M._phase = list.slice(0, 16));
  }

  /* ---------- Pass de combat (gratuit, il se débloque en jouant avec un compte) ----------
     Chaque palier donne un skin d'arme ou de couteau. pat = motif, c = couleurs, sc = répétitions du motif par mètre,
     met / rough = aspect métallique et rugosité, glow = lueur (motifs néon). */
  const RAR = {
    c: { n: 'Commun', col: '#8ea7c6' }, r: { n: 'Rare', col: '#4b7bff' }, e: { n: 'Épique', col: '#9a5cff' },
    l: { n: 'Légendaire', col: '#e04be8' }, m: { n: 'Mythique', col: '#f0b43c' }
  };
  const SKINS = {
    glock_sable:   { w: 'glock',     n: 'Sable chaud',      r: 'c', pat: 'camo',     c: ['#b49a6c', '#8a7048', '#d8c49a', '#5e4a30'], sc: 5, met: 0.1, rough: 0.75 },
    usp_nuit:      { w: 'usp',       n: 'Bleu nuit',        r: 'c', pat: 'solid',    c: ['#1d2a44', '#2c3d60'], sc: 4, met: 0.35, rough: 0.45 },
    p250_numerique:{ w: 'p250',      n: 'Numérique',        r: 'c', pat: 'digital',  c: ['#5a5f66', '#3a3e44', '#8a9098', '#22252a'], sc: 5, met: 0.15, rough: 0.7 },
    mac10_neon:    { w: 'mac10',     n: 'Néon rose',        r: 'r', pat: 'circuit',  c: ['#16121c', '#ff3fa8', '#7a2a66'], sc: 4, met: 0.3, rough: 0.5, glow: 1.6 },
    mp9_hexa:      { w: 'mp9',       n: 'Hexa sarcelle',    r: 'r', pat: 'hex',      c: ['#0f2e33', '#1f7a80', '#56d3cf'], sc: 6, met: 0.3, rough: 0.5 },
    knife_damas:   { w: 'knife',     n: 'Damas',            r: 'e', pat: 'damascus', c: ['#5d636b', '#c9ced6', '#2a2e33'], sc: 10, met: 0.9, rough: 0.28 },
    nova_foret:    { w: 'nova',      n: 'Forêt',            r: 'c', pat: 'camo',     c: ['#3c4a2c', '#5d6b3c', '#232a1a', '#7d7650'], sc: 3, met: 0.1, rough: 0.8 },
    ump45_carbone: { w: 'ump45',     n: 'Carbone',          r: 'r', pat: 'carbon',   c: ['#141518', '#3a3d44'], sc: 14, met: 0.35, rough: 0.35 },
    tec9_eclats:   { w: 'tec9',      n: 'Éclaboussures',    r: 'r', pat: 'splatter', c: ['#e9e4d8', '#e8402c', '#1b1b1d', '#f2b632'], sc: 4, met: 0.05, rough: 0.6 },
    famas_urbain:  { w: 'famas',     n: 'Urbain',           r: 'r', pat: 'digital',  c: ['#6c7a88', '#3d4854', '#a7b4c0', '#22292f'], sc: 4, met: 0.15, rough: 0.7 },
    galil_tigre:   { w: 'galil',     n: 'Tigre',            r: 'r', pat: 'tiger',    c: ['#d9822b', '#1a1410', '#f1b45a'], sc: 3, met: 0.1, rough: 0.6 },
    knife_tigre:   { w: 'knife',     n: 'Dents de tigre',   r: 'e', pat: 'tiger',    c: ['#e8a13a', '#24160c', '#ffd27a'], sc: 9, met: 0.75, rough: 0.3 },
    five_marbre:   { w: 'fiveseven', n: 'Marbre blanc',     r: 'e', pat: 'marble',   c: ['#e9e6df', '#9aa0a8', '#c8b07a'], sc: 4, met: 0.2, rough: 0.3 },
    p90_toxique:   { w: 'p90',       n: 'Toxique',          r: 'r', pat: 'splatter', c: ['#202418', '#a6ff2e', '#4c6a12', '#e8ff7a'], sc: 3, met: 0.1, rough: 0.6, glow: 0.7 },
    xm_ecailles:   { w: 'xm1014',    n: 'Écailles',         r: 'e', pat: 'scales',   c: ['#1f3a2c', '#4f9a6a', '#0d1a12'], sc: 7, met: 0.45, rough: 0.4 },
    deagle_laiton: { w: 'deagle',    n: 'Laiton poli',      r: 'e', pat: 'solid',    c: ['#b48a3c', '#e0bd6a'], sc: 4, met: 0.95, rough: 0.22 },
    sg_desert:     { w: 'sg553',     n: 'Désert',           r: 'r', pat: 'digital',  c: ['#c2a878', '#9a8058', '#e2d0a8', '#6a5638'], sc: 4, met: 0.1, rough: 0.75 },
    knife_aurore:  { w: 'knife',     n: 'Aurore',           r: 'e', pat: 'marble',   c: ['#2a1f5c', '#e0479e', '#3fd0ff'], sc: 6, met: 0.85, rough: 0.2 },
    aug_circuit:   { w: 'aug',       n: 'Circuit',          r: 'e', pat: 'circuit',  c: ['#0b151c', '#2ee6ff', '#145a6e'], sc: 4, met: 0.3, rough: 0.45, glow: 1.5 },
    m4_hexnuit:    { w: 'm4a1',      n: 'Hexa nuit',        r: 'e', pat: 'hex',      c: ['#0c0e14', '#2a3350', '#6f8cff'], sc: 6, met: 0.4, rough: 0.4, glow: 0.6 },
    ak_tigre:      { w: 'ak47',      n: 'Tigre rouge',      r: 'e', pat: 'tiger',    c: ['#b3201c', '#140c0c', '#ff5a3a'], sc: 3, met: 0.15, rough: 0.5 },
    ssg_abysses:   { w: 'ssg08',     n: 'Abysses',          r: 'e', pat: 'waves',    c: ['#06223e', '#1b6aa8', '#7fd6ff'], sc: 3, met: 0.3, rough: 0.4 },
    glock_dragon:  { w: 'glock',     n: 'Dragon',           r: 'l', pat: 'scales',   c: ['#5a0c0c', '#d8321e', '#ffb23a'], sc: 9, met: 0.55, rough: 0.35 },
    knife_jade:    { w: 'knife',     n: 'Écailles de jade', r: 'l', pat: 'scales',   c: ['#0e3a2a', '#2fb57a', '#b6ffd6'], sc: 14, met: 0.8, rough: 0.22 },
    m4_royal:      { w: 'm4a1',      n: 'Marbre royal',     r: 'l', pat: 'marble',   c: ['#2a0f45', '#7b3fd0', '#e6c46a'], sc: 3, met: 0.5, rough: 0.25 },
    awp_neon:      { w: 'awp',       n: 'Néon vert',        r: 'l', pat: 'circuit',  c: ['#06120a', '#3dff6e', '#1c6b33'], sc: 3, met: 0.3, rough: 0.4, glow: 1.8 },
    ak_arabesque:  { w: 'ak47',      n: 'Arabesque dorée',  r: 'l', pat: 'damascus', c: ['#1a1206', '#d9a83a', '#5a3d10'], sc: 4, met: 0.85, rough: 0.28 },
    usp_carbone:   { w: 'usp',       n: 'Carbone rouge',    r: 'l', pat: 'carbon',   c: ['#1a0606', '#c4221c'], sc: 16, met: 0.45, rough: 0.3 },
    awp_dragon:    { w: 'awp',       n: 'Dragon d\'or',     r: 'l', pat: 'scales',   c: ['#3a2206', '#e2a43a', '#fff0b0'], sc: 6, met: 0.85, rough: 0.25 },
    knife_or:      { w: 'knife',     n: 'Or massif',        r: 'm', pat: 'solid',    c: ['#c8922a', '#ffd86a'], sc: 6, met: 1.0, rough: 0.15 }
  };
  // ordre des récompenses : palier 1 à 30
  const PASS_ORDER = ['glock_sable', 'usp_nuit', 'p250_numerique', 'mac10_neon', 'mp9_hexa', 'knife_damas', 'nova_foret', 'ump45_carbone', 'tec9_eclats', 'famas_urbain',
    'galil_tigre', 'knife_tigre', 'five_marbre', 'p90_toxique', 'xm_ecailles', 'deagle_laiton', 'sg_desert', 'knife_aurore', 'aug_circuit', 'm4_hexnuit',
    'ak_tigre', 'ssg_abysses', 'glock_dragon', 'knife_jade', 'm4_royal', 'awp_neon', 'ak_arabesque', 'usp_carbone', 'awp_dragon', 'knife_or'];
  // XP pour passer chaque palier : 100, 105, 110… (≈ 5 200 XP au total, quelques heures de jeu)
  const PASS = {
    season: 'Saison 1', tiers: PASS_ORDER.map((id, i) => ({ t: i + 1, skin: id, xp: 100 + 5 * i })),
    // gains (parties en ligne, pas en entraînement)
    gain: { round: 15, roundWin: 20, kill: 15, hs: 5, ace: 75, mvp: 30, match: 60, matchWin: 120, range: 25, rangeDay: 250 }
  };
  PASS_ORDER.forEach((id, i) => { SKINS[id].id = id; SKINS[id].tier = i + 1; });

  /* ---------- Maîtrise des armes : chaque arme gagne des niveaux avec ses éliminations ----------
     Niveaux 1 à 10 ; skins exclusifs aux niveaux 3, 6 et 10 (on ne les obtient pas autrement). */
  const MASTERY = {
    max: 10, xp: (l) => 40 + 20 * (l - 1),                 // XP pour passer du niveau l-1 au niveau l
    gain: { kill: 10, hs: 5, knife: 15 },
    rewards: [
      { lv: 3, k: 'm1', n: 'Vétéran', r: 'r' },
      { lv: 6, k: 'm2', n: 'Élite', r: 'e' },
      { lv: 10, k: 'm3', n: 'Maître', r: 'm' }
    ]
  };
  Object.keys(WEAPONS).filter((w) => !GREN[w]).forEach((w, i) => {
    const hue = (i * 47) % 360, hsl = (h, sat, l) => {   // couleur propre à chaque arme pour les skins de maîtrise
      sat /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
      const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
      return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
    };
    SKINS[w + '_m1'] = { w, n: 'Vétéran', r: 'r', pat: 'carbon', c: ['#14161a', hsl(hue, 45, 32)], sc: w === 'knife' ? 18 : 12, met: 0.45, rough: 0.35, ms: 3 };
    SKINS[w + '_m2'] = { w, n: 'Élite', r: 'e', pat: 'hex', c: ['#0b0d12', hsl(hue, 55, 28), hsl(hue, 90, 62)], sc: w === 'knife' ? 12 : 6, met: 0.5, rough: 0.35, glow: 1.0, ms: 6 };
    SKINS[w + '_m3'] = { w, n: 'Maître', r: 'm', pat: 'damascus', c: ['#3a2a0c', '#f2c45a', hsl(hue, 80, 45)], sc: w === 'knife' ? 9 : 4, met: 0.95, rough: 0.2, glow: 0.35, ms: 10 };
  });
  Object.keys(SKINS).forEach((id) => { SKINS[id].id = id; });
  // niveau de maîtrise pour x XP : { lv, cur, need }
  function masteryLv(x) {
    let l = 0; x = Math.max(0, x | 0);
    while (l < MASTERY.max && x >= MASTERY.xp(l + 1)) { x -= MASTERY.xp(l + 1); l++; }
    return { lv: l, cur: l < MASTERY.max ? x : 0, need: l < MASTERY.max ? MASTERY.xp(l + 1) : 0 };
  }
  // palier atteint avec x XP : { tier, cur (XP dans le palier), need (XP du palier en cours, 0 au maximum) }
  function passTier(x) {
    let t = 0; x = Math.max(0, x | 0);
    while (t < PASS.tiers.length && x >= PASS.tiers[t].xp) { x -= PASS.tiers[t].xp; t++; }
    return { tier: t, cur: t < PASS.tiers.length ? x : 0, need: t < PASS.tiers.length ? PASS.tiers[t].xp : 0 };
  }

  // dégâts d'un coup sur une zone couverte par le gilet : d = dégâts bruts, armor = gilet restant, mult = part qui passe
  // le gilet s'use de d × armorWear ; s'il n'en reste pas assez, seule la part qu'il couvre encore est réduite
  function armorHit(d, armor, mult) {
    if (armor <= 0 || d <= 0) return { d, armor: Math.max(0, armor) };
    const wear = d * CFG.armorWear, f = Math.min(1, armor / wear);
    return { d: d * f * mult + d * (1 - f), armor: Math.max(0, armor - wear * f) };
  }

  return { CFG, ZONES, WEAPONS, GREN, SHOP, MAPS, BOXES, SITES, SPAWNS, phaseBoxes, SKINS, RAR, PASS, passTier, MASTERY, masteryLv, armorHit, sanitizeMap, buildCustom, mapToSource, makeSpawns, MAP_MIN, MAP_MAX };
});
