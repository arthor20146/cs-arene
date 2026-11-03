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
    penLoss: 0.6,        // dégâts conservés à chaque obstacle traversé
    tagTime: 0.45,       // s de ralentissement quand on est touché
    maxDrops: 24,        // armes au sol par salle
    pickRange: 1.9,      // m : portée de E pour prendre une arme
    pickAuto: 1.0        // m : ramassage automatique si l'emplacement est libre
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
    }
  };
  // carte en grille : on en déduit les obstacles, auxquels s'ajoutent les éléments fins (escaliers, parapets)
  MAPS.medina.boxes = ENCLOSURE.concat(fromGrid(MAPS.medina.grid, 6, 2.6), MAPS.medina.extra);
  MAPS.dust.style = 'dust'; MAPS.docks.style = 'docks';

  // Compatibilité : anciennes variables = carte Dust
  const BOXES = MAPS.dust.boxes, SITES = MAPS.dust.sites, SPAWNS = MAPS.dust.spawns;

  return { CFG, ZONES, WEAPONS, SHOP, MAPS, BOXES, SITES, SPAWNS };
});
