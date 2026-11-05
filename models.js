/* CS Arena - modèles 3D procéduraux : armes, soldats articulés, bras en vue subjective, bombe */
window.Models = (function () {
'use strict';
const { lin, Batch } = GFX;
const V = THREE.Vector3;
const C = {
  black: lin(0x17181a), gun: lin(0x26282b), dark: lin(0x34373b), steel: lin(0x7c8086), silver: lin(0xb8bcc2), brass: lin(0xa98438),
  tan: lin(0x9a8560), od: lin(0x47503a), fde: lin(0x8a7a5a), awp: lin(0x3a4f3a), wood: lin(0xffffff), glass: lin(0x28384a), rub: lin(0x101010)
};
const CS_W = (id) => (window.CS && CS.WEAPONS[id]) || {};
const M = {};
function mats() {
  if (M.metal) return M;
  M.metal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.46, envMapIntensity: 0.7 });
  M.poly = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.62, envMapIntensity: 0.6 });
  const w = GFX.getSurface('wood');
  M.wood = new THREE.MeshStandardMaterial({ map: w.map, roughnessMap: w.roughnessMap, roughness: 1, vertexColors: true, envMapIntensity: 0.5 });
  const f = GFX.getSurface('fabric');
  M.cloth = new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, roughnessMap: f.roughnessMap, roughness: 1, vertexColors: true, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
  return M;
}
const eul = new THREE.Euler(), qq = new THREE.Quaternion(), one = new V(1, 1, 1);
const mtx = (x, y, z, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(new V(x, y, z), qq.clone().setFromEuler(eul.set(rx || 0, ry || 0, rz || 0)), new V(sx || 1, sy || 1, sz || 1));

class Kit {
  constructor() { this.b = new Batch(); }
  box(k, w, h, d, x, y, z, col, rx, ry, rz) { const g = new THREE.BoxGeometry(w, h, d); this.b.geo(k, g, mtx(x, y, z, rx, ry, rz), col); g.dispose(); }
  // cylindre d'axe z (avant/arrière) par défaut
  cyl(k, r1, r2, len, x, y, z, col, axis, seg) {
    const g = new THREE.CylinderGeometry(r2, r1, len, seg || 12);
    const m = axis === 'y' ? mtx(x, y, z) : axis === 'x' ? mtx(x, y, z, 0, 0, Math.PI / 2) : mtx(x, y, z, -Math.PI / 2);
    this.b.geo(k, g, m, col); g.dispose();
  }
  sph(k, rx, ry, rz, x, y, z, col, seg) { const g = new THREE.SphereGeometry(1, seg || 12, 8); this.b.geo(k, g, mtx(x, y, z, 0, 0, 0, rx, ry, rz), col, 2); g.dispose(); }
  // chargeur courbe (fusils)
  curvedMag(k, w, d, n, segL, curve, x, y, z, col) {
    let py = y, pz = z, a = 0;
    for (let i = 0; i < n; i++) { this.box(k, w, segL * 1.06, d, x, py, pz, col, a); a -= curve; py -= Math.cos(a) * segL; pz += Math.sin(-a) * -segL; }
  }
}

/* ---------- définition de chaque arme ---------- */
function pistol(t, o) {
  const m = t.main, sl = t.slide, mg = t.mag, L = o.L, H = o.H || 0.036, W = o.W || 0.03;
  sl.box('metal', W, H, L, 0, 0.044, -L / 2 + 0.055, o.c);
  sl.box('metal', W * 0.96, H * 0.25, L * 0.97, 0, 0.044 + H / 2 + 0.002, -L / 2 + 0.055, o.c);
  for (let i = 0; i < 6; i++) sl.box('metal', W + 0.001, H * 0.7, 0.003, 0, 0.044, 0.045 - i * 0.0065, C.black);
  sl.box('metal', 0.016, 0.009, 0.012, 0, 0.044 + H / 2 + 0.008, 0.045, C.black);
  sl.box('metal', 0.005, 0.009, 0.008, 0, 0.044 + H / 2 + 0.008, -L + 0.07, C.black);
  m.cyl('metal', 0.009, 0.009, 0.02, 0, 0.044, -L + 0.052, C.black);
  m.box('poly', W * 0.92, 0.024, L * 0.8, 0, 0.016, -L * 0.34 + 0.05, o.f || C.black);
  m.box('poly', W * 0.96, 0.125, 0.05, 0, -0.052, 0.032, o.f || C.black, -0.26);
  m.box('poly', W * 1.02, 0.1, 0.036, 0, -0.054, 0.034, C.rub, -0.26);
  m.box('poly', 0.008, 0.004, 0.055, 0, -0.022, -0.035, o.f || C.black); m.box('poly', 0.008, 0.024, 0.004, 0, -0.012, -0.062, o.f || C.black);
  m.box('metal', 0.004, 0.018, 0.006, 0, -0.008, -0.022, C.steel, 0.3);
  mg.box('poly', W * 0.85, 0.012, 0.05, 0, -0.118, 0.052, C.gun, -0.26);
  if (o.sup) { m.cyl('metal', 0.016, 0.016, 0.13, 0, 0.044, -L - 0.03, C.gun, 'z', 14); o.muz = -L - 0.1; }
  return { muzzle: new V(0, 0.044, o.muz || -L + 0.04), eject: new V(0.016, 0.06, -0.02), sight: new V(0, 0.044 + H / 2 + 0.014, 0.05), handR: new V(0, -0.05, 0.035), handL: new V(-0.012, -0.075, 0.03), class: 'pistol', len: L };
}
function rifleBase(t, o) {
  const m = t.main, mg = t.mag, c = o.c || C.gun, bL = o.barrel || 0.2;
  // boîtier
  m.box('metal', 0.042, 0.07, o.rec || 0.3, 0, 0.012, -(o.rec || 0.3) / 2 + 0.09, c);
  m.box('metal', 0.03, 0.012, (o.rec || 0.3) * 0.9, 0, 0.052, -(o.rec || 0.3) / 2 + 0.08, o.top || c);
  t.slide.box('metal', 0.012, 0.02, 0.055, 0.024, 0.024, -0.03, C.steel);
  // garde-main
  const zh = 0.09 - (o.rec || 0.3), hL = o.hg || 0.2;
  return { m, mg, c, zh, hL, bL };
}
function rail(m, y, z0, z1, c) { const n = Math.floor((z1 - z0) / 0.012); m.box('metal', 0.022, 0.006, z1 - z0, 0, y, (z0 + z1) / 2, c); for (let i = 0; i < n; i += 2) m.box('metal', 0.024, 0.005, 0.006, 0, y + 0.004, z0 + i * 0.012, c); }
function scopeOn(m, z, y, L, r) {
  m.cyl('metal', r, r, L * 0.5, 0, y, z, C.black, 'z', 16);
  m.cyl('metal', r, r * 1.5, L * 0.22, 0, y, z - L * 0.34, C.black, 'z', 16); m.cyl('metal', r * 1.5, r * 1.3, L * 0.2, 0, y, z + L * 0.34, C.black, 'z', 16);
  m.cyl('metal', r * 1.25, r * 1.25, 0.014, 0, y + r, z, C.gun, 'y'); m.cyl('metal', r * 1.25, r * 1.25, 0.014, r, y, z, C.gun, 'x');
  m.box('metal', 0.024, y * 0.5, 0.02, 0, y * 0.72, z - L * 0.18, C.gun); m.box('metal', 0.024, y * 0.5, 0.02, 0, y * 0.72, z + L * 0.18, C.gun);
  m.cyl('poly', r * 1.42, r * 1.42, 0.002, 0, y, z - L * 0.45, C.glass, 'z', 16); m.cyl('poly', r * 1.2, r * 1.2, 0.002, 0, y, z + L * 0.45, C.glass, 'z', 16);
}
function grip(m, z, col, k) { m.box(k || 'poly', 0.03, 0.12, 0.046, 0, -0.078, z, col || C.black, -0.3); }
function guardT(m, z, col) { m.box('poly', 0.01, 0.004, 0.07, 0, -0.04, z - 0.03, col || C.black); m.box('poly', 0.01, 0.02, 0.004, 0, -0.03, z - 0.065, col || C.black); }

const DEF = {
  glock(t) { return pistol(t, { L: 0.19, c: C.gun }); },
  usp(t) { return pistol(t, { L: 0.2, c: C.dark, f: C.gun, sup: 1 }); },
  p250(t) { return pistol(t, { L: 0.18, c: C.steel, f: C.black }); },
  fiveseven(t) { return pistol(t, { L: 0.2, c: C.dark, f: C.fde, H: 0.032 }); },
  deagle(t) { return pistol(t, { L: 0.26, H: 0.05, W: 0.036, c: C.silver, f: C.black }); },
  tec9(t) {
    const m = t.main, r = 0.21;
    m.box('metal', 0.034, 0.05, 0.19, 0, 0.03, -0.05, C.dark); t.slide.box('metal', 0.03, 0.012, 0.03, 0.022, 0.046, 0.005, C.steel);
    for (let i = 0; i < 9; i++) m.box('metal', 0.04, 0.05, 0.006, 0, 0.03, -0.13 - i * 0.012, C.gun);
    m.cyl('metal', 0.015, 0.015, 0.08, 0, 0.03, -0.2, C.black); m.box('poly', 0.03, 0.115, 0.05, 0, -0.05, 0.02, C.black, -0.2);
    t.mag.box('metal', 0.02, 0.16, 0.034, 0, -0.08, -0.095, C.gun);
    return { muzzle: new V(0, 0.03, -0.24), eject: new V(0.02, 0.05, -0.02), sight: new V(0, 0.072, 0.04), handR: new V(0, -0.05, 0.022), handL: new V(0, -0.06, -0.095), class: 'pistol', len: 0.24 };
  },
  mac10(t) {
    const m = t.main;
    m.box('metal', 0.05, 0.075, 0.24, 0, 0.015, -0.05, C.gun); m.box('metal', 0.02, 0.012, 0.04, 0, 0.058, 0, C.black);
    m.cyl('metal', 0.014, 0.014, 0.07, 0, 0.018, -0.2, C.black); t.slide.box('metal', 0.012, 0.018, 0.03, 0, 0.056, -0.09, C.steel);
    m.box('poly', 0.034, 0.1, 0.05, 0, -0.07, -0.0, C.black); t.mag.box('metal', 0.026, 0.16, 0.042, 0, -0.14, 0, C.dark); guardT(m, -0.03);
    m.box('metal', 0.012, 0.012, 0.2, 0.02, -0.005, 0.15, C.steel); m.box('metal', 0.012, 0.012, 0.2, -0.02, -0.005, 0.15, C.steel); m.box('metal', 0.052, 0.05, 0.012, 0, -0.01, 0.25, C.black);
    return { muzzle: new V(0, 0.018, -0.24), eject: new V(0.03, 0.05, -0.08), sight: new V(0, 0.082, 0.02), handR: new V(0, -0.07, 0), handL: new V(0, -0.02, -0.14), class: 'smg', len: 0.3 };
  },
  mp9(t) {
    const m = t.main;
    m.box('poly', 0.044, 0.075, 0.27, 0, 0.012, -0.08, C.black); rail(m, 0.054, -0.2, 0.04, C.gun); m.box('poly', 0.04, 0.045, 0.1, 0, -0.03, -0.17, C.black);
    m.box('poly', 0.03, 0.05, 0.02, 0, -0.08, -0.17, C.black, 0.25); m.cyl('metal', 0.012, 0.012, 0.06, 0, 0.018, -0.24, C.gun);
    t.slide.box('metal', 0.012, 0.016, 0.03, 0.026, 0.03, -0.04, C.steel); m.box('poly', 0.034, 0.1, 0.05, 0, -0.07, 0, C.black);
    t.mag.box('metal', 0.024, 0.17, 0.04, 0, -0.14, 0, C.gun); guardT(m, -0.03);
    m.box('metal', 0.04, 0.01, 0.2, 0, 0.02, 0.14, C.gun); m.box('poly', 0.05, 0.08, 0.016, 0, 0.0, 0.24, C.black);
    m.box('metal', 0.014, 0.018, 0.01, 0, 0.066, 0.02, C.black);
    return { muzzle: new V(0, 0.018, -0.275), eject: new V(0.024, 0.05, -0.08), sight: new V(0, 0.08, 0.03), handR: new V(0, -0.07, 0), handL: new V(0, -0.075, -0.17), class: 'smg', len: 0.34 };
  },
  ump45(t) {
    const m = t.main;
    m.box('poly', 0.05, 0.085, 0.38, 0, 0.01, -0.12, C.black); m.box('poly', 0.044, 0.04, 0.16, 0, -0.04, -0.23, C.black); rail(m, 0.058, -0.25, 0.03, C.gun);
    m.cyl('metal', 0.014, 0.014, 0.09, 0, 0.015, -0.34, C.gun); m.box('metal', 0.012, 0.03, 0.01, 0, 0.076, -0.26, C.black); m.box('metal', 0.03, 0.022, 0.012, 0, 0.074, 0.03, C.black);
    t.slide.box('metal', 0.014, 0.016, 0.03, 0.03, 0.03, -0.17, C.steel); grip(m, 0.03); guardT(m, 0.0);
    t.mag.curvedMag('poly', 0.026, 0.05, 5, 0.04, 0.05, 0, -0.06, -0.1, C.gun);
    m.box('poly', 0.03, 0.02, 0.22, 0, 0.03, 0.17, C.black); m.box('poly', 0.03, 0.09, 0.03, 0, -0.01, 0.28, C.black); m.box('poly', 0.03, 0.02, 0.1, 0, -0.04, 0.23, C.black);
    return { muzzle: new V(0, 0.015, -0.385), eject: new V(0.028, 0.05, -0.08), sight: new V(0, 0.092, 0.04), handR: new V(0, -0.07, 0.035), handL: new V(0, -0.07, -0.24), class: 'smg', len: 0.46 };
  },
  p90(t) {
    const m = t.main;
    m.box('poly', 0.05, 0.11, 0.42, 0, -0.018, -0.03, lin(0x2c3029)); m.sph('poly', 0.03, 0.09, 0.09, 0, -0.03, 0.18, lin(0x2c3029));
    m.cyl('metal', 0.013, 0.013, 0.06, 0, 0.012, -0.27, C.black); m.box('poly', 0.03, 0.1, 0.05, 0, -0.1, -0.09, lin(0x2c3029), 0.25);
    m.box('poly', 0.05, 0.05, 0.11, 0, 0.066, -0.05, C.black); t.mag.box('poly', 0.05, 0.022, 0.3, 0, 0.05, 0.02, lin(0x8a8a78));
    t.slide.box('metal', 0.012, 0.012, 0.03, 0.03, 0.01, -0.13, C.steel);
    return { muzzle: new V(0, 0.012, -0.3), eject: new V(0, -0.08, 0.05), sight: new V(0, 0.103, -0.02), handR: new V(0, -0.1, -0.09), handL: new V(0, -0.075, -0.2), class: 'smg', len: 0.44 };
  },
  nova(t) { return shotgun(t, { pump: 1, c: C.gun, s: C.black }); },
  xm1014(t) { return shotgun(t, { c: C.dark, s: C.black }); },
  ak47(t) {
    const m = t.main;
    m.box('metal', 0.042, 0.068, 0.3, 0, 0.012, -0.05, C.dark); m.cyl('metal', 0.0205, 0.0205, 0.27, 0, 0.044, -0.04, C.gun, 'z', 14); for (let i = 0; i < 5; i++) m.box('metal', 0.03, 0.002, 0.006, 0, 0.0645, 0.04 - i * 0.03, C.black);
    t.slide.box('metal', 0.016, 0.014, 0.04, 0.026, 0.03, -0.09, C.steel);
    m.box('wood', 0.04, 0.042, 0.2, 0, -0.008, -0.3, C.wood); m.box('wood', 0.03, 0.022, 0.16, 0, 0.05, -0.3, C.wood);
    m.cyl('metal', 0.008, 0.008, 0.26, 0, 0.05, -0.4, C.gun, 'z', 8); m.cyl('metal', 0.0085, 0.0085, 0.46, 0, 0.02, -0.46, C.gun, 'z', 10);
    m.box('metal', 0.022, 0.05, 0.03, 0, 0.044, -0.52, C.gun); m.box('metal', 0.014, 0.05, 0.016, 0, 0.05, -0.655, C.gun); m.box('metal', 0.006, 0.024, 0.008, 0, 0.082, -0.655, C.black); m.cyl('metal', 0.012, 0.016, 0.03, 0, 0.02, -0.7, C.black);
    m.box('metal', 0.016, 0.02, 0.05, 0, 0.066, -0.17, C.gun); 
    m.box('wood', 0.03, 0.12, 0.05, 0, -0.08, 0.05, C.wood, -0.3); guardT(m, 0.02, C.gun);
    m.box('wood', 0.034, 0.05, 0.27, 0, -0.016, 0.22, C.wood, -0.1); m.box('wood', 0.036, 0.11, 0.022, 0, -0.036, 0.355, C.wood, -0.1); m.box('wood', 0.034, 0.05, 0.1, 0, -0.058, 0.3, C.wood, -0.1);
    t.mag.curvedMag('metal', 0.024, 0.058, 6, 0.04, 0.07, 0, -0.04, -0.08, lin(0x3d3a33));
    return { muzzle: new V(0, 0.02, -0.72), eject: new V(0.024, 0.05, -0.06), sight: new V(0, 0.081, 0.0), handR: new V(0, -0.08, 0.05), handL: new V(0, -0.045, -0.3), class: 'rifle', len: 0.88 };
  },
  galil(t) {
    const m = t.main;
    m.box('metal', 0.044, 0.07, 0.32, 0, 0.012, -0.06, C.gun); m.box('poly', 0.044, 0.058, 0.22, 0, 0.0, -0.32, C.black); for (let i = 0; i < 6; i++) m.box('poly', 0.046, 0.02, 0.012, 0, 0.0, -0.25 - i * 0.03, C.gun);
    m.cyl('metal', 0.008, 0.008, 0.26, 0, 0.042, -0.36, C.gun, 'z', 8); m.cyl('metal', 0.0085, 0.0085, 0.34, 0, 0.018, -0.5, C.gun, 'z', 10); m.cyl('metal', 0.014, 0.012, 0.06, 0, 0.018, -0.68, C.black);
    m.box('metal', 0.012, 0.07, 0.012, 0, 0.054, -0.56, C.black); m.box('metal', 0.02, 0.026, 0.02, 0, 0.06, -0.0, C.black); t.slide.box('metal', 0.012, 0.02, 0.05, 0.026, 0.03, -0.08, C.steel);
    grip(m, 0.05); guardT(m, 0.02); t.mag.curvedMag('metal', 0.026, 0.06, 6, 0.04, 0.055, 0, -0.045, -0.09, C.dark);
    m.box('metal', 0.012, 0.012, 0.22, 0.016, 0.01, 0.2, C.steel); m.box('metal', 0.012, 0.012, 0.22, -0.016, 0.01, 0.2, C.steel); m.box('poly', 0.03, 0.1, 0.02, 0, -0.02, 0.31, C.black);
    return { muzzle: new V(0, 0.018, -0.71), eject: new V(0.024, 0.05, -0.06), sight: new V(0, 0.08, 0.01), handR: new V(0, -0.08, 0.05), handL: new V(0, -0.03, -0.33), class: 'rifle', len: 0.86 };
  },
  m4a1(t) {
    const m = t.main;
    m.box('metal', 0.04, 0.06, 0.26, 0, 0.016, -0.05, C.gun); m.box('metal', 0.04, 0.05, 0.06, 0, -0.03, -0.09, C.gun); rail(m, 0.05, -0.18, 0.07, C.black);
    m.cyl('poly', 0.026, 0.026, 0.26, 0, 0.018, -0.31, C.black, 'z', 10); rail(m, 0.05, -0.44, -0.18, C.black);
    m.cyl('metal', 0.022, 0.022, 0.2, 0, 0.018, -0.54, C.gun, 'z', 14); m.box('metal', 0.008, 0.03, 0.03, 0, 0.074, -0.42, C.black); m.box('metal', 0.02, 0.03, 0.02, 0, 0.07, 0.05, C.black);
    t.slide.box('metal', 0.02, 0.012, 0.03, 0, 0.042, 0.075, C.steel); grip(m, 0.06); guardT(m, 0.03);
    t.mag.box('metal', 0.024, 0.14, 0.056, 0, -0.1, -0.08, C.dark, 0.06);
    m.cyl('metal', 0.015, 0.015, 0.2, 0, 0.016, 0.17, C.gun); m.box('poly', 0.032, 0.06, 0.15, 0, 0.0, 0.24, C.black); m.box('poly', 0.034, 0.11, 0.018, 0, -0.016, 0.32, C.rub);
    return { muzzle: new V(0, 0.018, -0.645), eject: new V(0.024, 0.05, -0.05), sight: new V(0, 0.09, 0.055), handR: new V(0, -0.08, 0.06), handL: new V(0, -0.02, -0.33), class: 'rifle', len: 0.95 };
  },
  sg553(t) {
    const m = t.main;
    m.box('poly', 0.046, 0.075, 0.33, 0, 0.01, -0.07, lin(0x2c3226)); m.box('poly', 0.046, 0.05, 0.2, 0, 0.0, -0.33, lin(0x2c3226)); m.cyl('metal', 0.009, 0.009, 0.3, 0, 0.02, -0.5, C.gun); m.cyl('metal', 0.014, 0.012, 0.05, 0, 0.02, -0.66, C.black);
    rail(m, 0.05, -0.24, 0.08, C.black); scopeOn(m, -0.08, 0.095, 0.17, 0.016); t.slide.box('metal', 0.012, 0.02, 0.04, 0.03, 0.028, -0.1, C.steel);
    grip(m, 0.05); guardT(m, 0.02); t.mag.curvedMag('poly', 0.026, 0.056, 6, 0.04, 0.05, 0, -0.045, -0.1, lin(0x8a6a2f));
    m.box('poly', 0.03, 0.03, 0.26, 0, -0.005, 0.21, lin(0x2c3226)); m.box('poly', 0.03, 0.11, 0.02, 0, -0.02, 0.335, C.rub);
    return { muzzle: new V(0, 0.02, -0.685), eject: new V(0.026, 0.05, -0.06), sight: new V(0, 0.095, 0.01), handR: new V(0, -0.08, 0.05), handL: new V(0, -0.03, -0.32), class: 'rifle', optic: 1, len: 0.9 };
  },
  famas(t) {
    const m = t.main, c = lin(0x30343a);
    m.box('poly', 0.05, 0.085, 0.56, 0, 0.0, 0.07, c); m.box('poly', 0.045, 0.05, 0.2, 0, -0.012, -0.28, c); m.box('poly', 0.05, 0.12, 0.022, 0, -0.018, 0.355, C.rub);
    m.cyl('metal', 0.009, 0.009, 0.26, 0, 0.012, -0.42, C.gun); m.cyl('metal', 0.014, 0.012, 0.06, 0, 0.012, -0.55, C.black);
    m.box('poly', 0.018, 0.012, 0.42, 0, 0.098, 0.0, C.black); m.box('poly', 0.016, 0.06, 0.02, 0, 0.07, -0.2, C.black); m.box('poly', 0.016, 0.06, 0.02, 0, 0.07, 0.19, C.black);
    t.slide.box('metal', 0.02, 0.012, 0.03, 0, 0.056, 0.1, C.steel); m.box('poly', 0.03, 0.1, 0.046, 0, -0.08, -0.08, C.black, -0.25); m.box('poly', 0.05, 0.012, 0.13, 0, -0.1, -0.11, C.gun);
    t.mag.box('metal', 0.024, 0.13, 0.055, 0, -0.1, 0.13, C.dark);
    return { muzzle: new V(0, 0.012, -0.58), eject: new V(0.028, 0.03, 0.15), sight: new V(0, 0.125, 0.14), handR: new V(0, -0.075, -0.08), handL: new V(0, -0.045, -0.3), class: 'rifle', len: 0.76 };
  },
  aug(t) {
    const m = t.main, c = lin(0x3c4a42);
    m.box('poly', 0.05, 0.09, 0.42, 0, -0.01, 0.13, c); m.cyl('metal', 0.022, 0.024, 0.22, 0, 0.012, -0.2, C.gun, 'z', 10); m.cyl('metal', 0.01, 0.01, 0.2, 0, 0.012, -0.4, C.gun); m.cyl('metal', 0.014, 0.012, 0.06, 0, 0.012, -0.52, C.black);
    m.box('poly', 0.03, 0.1, 0.04, 0, -0.08, -0.12, c, 0.15); m.box('poly', 0.03, 0.1, 0.045, 0, -0.085, 0.02, c, -0.2); m.box('poly', 0.05, 0.01, 0.17, 0, -0.14, -0.05, c);
    scopeOn(m, 0.0, 0.095, 0.2, 0.017); t.mag.box('poly', 0.026, 0.13, 0.058, 0, -0.11, 0.16, lin(0x8e9a90), 0.1);
    t.slide.box('metal', 0.012, 0.016, 0.03, 0.03, 0.03, 0.02, C.steel);
    return { muzzle: new V(0, 0.012, -0.55), eject: new V(0.028, 0.03, 0.14), sight: new V(0, 0.095, 0.12), handR: new V(0, -0.075, 0.02), handL: new V(0, -0.075, -0.12), class: 'rifle', optic: 1, len: 0.79 };
  },
  ssg08(t) { return sniper(t, { c: C.fde, L: 0.84 }); },
  awp(t) { return sniper(t, { c: C.awp, L: 0.92, big: 1 }); }
};
function shotgun(t, o) {
  const m = t.main;
  m.box('metal', 0.04, 0.06, 0.22, 0, 0.01, -0.02, o.c); m.cyl('metal', 0.0115, 0.0115, 0.52, 0, 0.022, -0.38, o.c, 'z', 12); m.cyl('metal', 0.015, 0.015, 0.46, 0, -0.016, -0.34, C.gun, 'z', 12);
  m.box('metal', 0.03, 0.03, 0.02, 0, 0.0, -0.58, C.gun); m.box('metal', 0.006, 0.012, 0.006, 0, 0.042, -0.62, C.brass); m.box('metal', 0.018, 0.01, 0.03, 0, 0.046, 0.05, C.black);
  m.box('poly', 0.03, 0.12, 0.05, 0, -0.07, 0.11, o.s, -0.4); guardT(m, 0.06);
  m.box('poly', 0.034, 0.05, 0.27, 0, -0.018, 0.25, o.s, -0.12); m.box('poly', 0.036, 0.13, 0.02, 0, -0.05, 0.39, C.rub, -0.12);
  (o.pump ? t.pump : m).box('poly', 0.044, 0.042, 0.17, 0, -0.018, -0.3, o.s);
  if (o.pump) for (let i = 0; i < 8; i++) t.pump.box('poly', 0.046, 0.044, 0.006, 0, -0.018, -0.37 + i * 0.02, C.gun);
  else t.slide.box('metal', 0.014, 0.018, 0.04, 0.024, 0.024, -0.04, C.steel);
  return { muzzle: new V(0, 0.022, -0.65), eject: new V(0.024, 0.03, -0.03), sight: new V(0, 0.058, 0.05), handR: new V(0, -0.075, 0.11), handL: new V(0, -0.045, -0.3), class: 'shotgun', len: 1.0 };
}
function sniper(t, o) {
  const m = t.main, L = o.L, c = o.c;
  m.box('metal', 0.034, 0.056, 0.3, 0, 0.014, -0.05, C.gun); m.cyl('metal', 0.013, 0.009, L * 0.72, 0, 0.022, -0.2 - L * 0.36, C.gun, 'z', 12);
  if (o.big) for (let i = 0; i < 7; i++) m.box('metal', 0.022, 0.003, 0.03, 0, 0.033, -0.3 - i * 0.05, C.black);
  m.cyl('metal', 0.018, 0.016, 0.1, 0, 0.022, -0.2 - L * 0.72 - 0.02, C.black);
  rail(m, 0.046, -0.2, 0.1, C.black); scopeOn(m, -0.05, 0.1, 0.36, 0.02);
  t.slide.cyl('metal', 0.011, 0.011, 0.11, 0.0, 0.03, 0.08, C.steel); t.slide.box('metal', 0.05, 0.008, 0.01, 0.028, 0.02, 0.08, C.steel, 0, 0, -0.35); t.slide.sph('metal', 0.012, 0.012, 0.012, 0.054, 0.012, 0.08, C.black);
  m.box('poly', 0.05, 0.05, 0.44, 0, -0.022, -0.26, c); m.box('poly', 0.044, 0.1, 0.05, 0, -0.078, 0.06, c, -0.38); guardT(m, 0.02);
  m.box('poly', 0.04, 0.05, 0.28, 0, -0.018, 0.25, c, -0.06); m.box('poly', 0.03, 0.04, 0.16, 0, 0.022, 0.21, c); m.box('poly', 0.042, 0.13, 0.02, 0, -0.04, 0.395, C.rub, -0.06); m.box('poly', 0.04, 0.05, 0.08, 0, -0.08, 0.32, c, -0.06);
  t.mag.box('metal', 0.03, 0.06, 0.09, 0, -0.07, -0.08, C.black);
  return { muzzle: new V(0, 0.022, -0.2 - L * 0.72 - 0.08), eject: new V(0.024, 0.04, 0.02), sight: new V(0, 0.1, 0.16), handR: new V(0, -0.08, 0.07), handL: new V(0, -0.05, -0.32), class: 'sniper', optic: 1, len: 1.25 };
}
function knifeDef(t) {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.19, 0.004); s.quadraticCurveTo(0.2, 0.012, 0.21, 0.018); s.lineTo(0.14, 0.036); s.lineTo(0, 0.034); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0014, bevelSize: 0.0016, bevelSegments: 1, steps: 1 });
  // l'UV de ExtrudeGeometry est présent : on peut l'ajouter tel quel
  t.main.b.geo('metal', g, mtx(0, 0.008, 0.0, 0, Math.PI / 2, 0), C.silver); g.dispose();
  t.main.box('poly', 0.02, 0.03, 0.115, 0, 0.022, 0.06, C.black); t.main.box('metal', 0.022, 0.05, 0.008, 0, 0.022, 0.003, C.steel); t.main.box('metal', 0.02, 0.032, 0.008, 0, 0.022, 0.12, C.steel);
  return { muzzle: new V(0, 0.02, -0.2), eject: new V(), sight: new V(0, 0.04, 0.05), handR: new V(0, 0.022, 0.06), handL: new V(-0.12, -0.2, 0.05), class: 'knife', len: 0.3 };
}

function buildKit(id) {
  const t = { main: new Kit(), mag: new Kit(), slide: new Kit(), pump: new Kit() };
  const info = (id === 'knife' ? knifeDef : DEF[id])(t);
  return { t, info };
}
const KEYS = ['metal', 'poly', 'wood'];
function meshes(kit) {
  const g = new THREE.Group();
  KEYS.forEach((k) => { const m = kit.b.mesh(k, mats()[k], false, false); if (m) g.add(m); });
  return g;
}
// arme en vue subjective : pièces mobiles séparées
function gunVM(id) {
  const { t, info } = buildKit(id), g = new THREE.Group();
  const main = meshes(t.main), mag = meshes(t.mag), slide = meshes(t.slide), pump = meshes(t.pump);
  g.add(main, mag, slide, pump);
  return { group: g, mag, slide, pump, info };
}
// arme en vue externe : une seule géométrie, partagée
const tpCache = {};
function gunTP(id) {
  if (!tpCache[id]) {
    const { t, info } = buildKit(id);
    const parts = [];
    const shared = {};
    [t.main, t.mag, t.slide, t.pump].forEach((kit) => { KEYS.forEach((k) => { const b = kit.b.b[k]; if (b) { const s = shared[k] || (shared[k] = { p: [], n: [], u: [], c: [] }); s.p.push(...b.p); s.n.push(...b.n); s.u.push(...b.u); s.c.push(...b.c); } }); });
    const bt = new Batch(); bt.b = shared;
    KEYS.forEach((k) => { const m = bt.mesh(k, mats()[k], true, false); if (m) parts.push(m); });
    tpCache[id] = { parts, info };
  }
  const c = tpCache[id], g = new THREE.Group();
  c.parts.forEach((m) => { const n = new THREE.Mesh(m.geometry, m.material); n.castShadow = true; g.add(n); });
  g.userData.info = c.info;
  return g;
}

/* ---------- soldats ---------- */
const LOOK = {
  T: { jacket: 0x75654a, pants: 0x4c4333, vest: 0x362f25, gear: 0x2a251d, head: 0x1a1a1c, band: 0xa8552a, boot: 0x241b12 },
  CT: { jacket: 0x2e3a4a, pants: 0x262f3c, vest: 0x171a1f, gear: 0x0f1114, head: 0x1a1c20, band: 0x3a6fb5, boot: 0x101114 }
};
const SKIN = lin(0xc4946f), GLOVE = lin(0x141517);
function segGeos(team) {
  const L = LOOK[team], c = (h) => lin(h), s = {};
  const mk = (fn) => { const k = new Kit(); fn(k); return k; };
  s.hips = mk((k) => {
    k.sph('cloth', 0.175, 0.12, 0.125, 0, 0, 0, c(L.pants)); k.box('cloth', 0.34, 0.045, 0.22, 0, 0.07, 0, c(L.gear));
    k.box('cloth', 0.07, 0.11, 0.08, -0.17, -0.02, 0.0, c(L.gear)); k.box('cloth', 0.05, 0.08, 0.05, 0.05, 0.03, 0.13, c(L.gear));
  });
  s.torso = mk((k) => {
    k.sph('cloth', 0.205, 0.28, 0.135, 0, 0.26, 0, c(L.jacket)); k.sph('cloth', 0.235, 0.115, 0.13, 0, 0.42, 0, c(L.jacket));
    k.box('cloth', 0.33, 0.36, 0.2, 0, 0.22, 0, c(L.vest)); k.box('cloth', 0.3, 0.26, 0.04, 0, 0.26, -0.115, c(L.vest));
    for (let i = -1; i <= 1; i++) { k.box('cloth', 0.085, 0.15, 0.05, i * 0.1, 0.13, -0.135, c(L.gear)); k.box('cloth', 0.08, 0.02, 0.054, i * 0.1, 0.205, -0.137, c(L.vest)); }
    k.box('cloth', 0.04, 0.2, 0.22, -0.17, 0.2, 0, c(L.gear)); k.box('cloth', 0.04, 0.2, 0.22, 0.17, 0.2, 0, c(L.gear));
    k.box('cloth', 0.27, 0.34, 0.11, 0, 0.27, 0.15, c(L.gear)); k.box('cloth', 0.05, 0.3, 0.02, -0.1, 0.42, -0.06, c(L.gear), 0.1); k.box('cloth', 0.05, 0.3, 0.02, 0.1, 0.42, -0.06, c(L.gear), 0.1);
    k.cyl('skin', 0.05, 0.05, 0.08, 0, 0.53, 0, team === 'T' ? c(L.head) : SKIN, 'y', 10);
  });
  s.head = mk((k) => {
    if (team === 'T') {
      k.sph('cloth', 0.094, 0.116, 0.104, 0, 0.1, -0.005, c(L.head), 14);
      k.box('skin', 0.13, 0.03, 0.02, 0, 0.125, -0.098, SKIN); k.sph('skin', 0.012, 0.012, 0.006, -0.036, 0.125, -0.106, lin(0x1a120c)); k.sph('skin', 0.012, 0.012, 0.006, 0.036, 0.125, -0.106, lin(0x1a120c));
      k.sph('cloth', 0.12, 0.05, 0.12, 0, 0.0, 0.0, c(L.jacket));
    } else {
      k.sph('skin', 0.09, 0.112, 0.1, 0, 0.1, -0.004, SKIN, 14); k.sph('cloth', 0.092, 0.06, 0.1, 0, 0.044, -0.006, c(L.head)); k.sph('skin', 0.016, 0.022, 0.018, 0, 0.09, -0.102, SKIN);
      k.box('metal', 0.15, 0.05, 0.03, 0, 0.13, -0.094, lin(0x0a0d12)); k.box('cloth', 0.19, 0.03, 0.2, 0, 0.135, 0.012, c(L.gear));
    }
  });
  s.helmet = mk((k) => {
    const g = new THREE.SphereGeometry(1, 16, 9, 0, 6.3, 0, 1.75); k.b.geo('cloth', g, mtx(0, 0.125, 0.0, 0, 0, 0, 0.116, 0.112, 0.128), c(L.gear), 2); g.dispose();
    k.box('metal', 0.03, 0.02, 0.018, 0, 0.21, -0.1, C.black);
  });
  const up = (col, band) => mk((k) => {
    k.cyl('cloth', 0.062, 0.05, 0.3, 0, -0.14, 0, col, 'y', 10); k.sph('cloth', 0.068, 0.068, 0.068, 0, -0.01, 0, col);
    if (band) k.cyl('cloth', 0.058, 0.056, 0.05, 0, -0.1, 0, c(L.band), 'y', 10);
  });
  s.armU = up(c(L.jacket), true);
  s.armL = mk((k) => { k.cyl('cloth', 0.05, 0.038, 0.25, 0, -0.125, 0, c(L.jacket), 'y', 10); k.sph('cloth', 0.05, 0.05, 0.05, 0, 0, 0, c(L.jacket)); k.sph('skin', 0.042, 0.052, 0.05, 0, -0.285, -0.01, GLOVE); });
  s.thigh = mk((k) => { k.cyl('cloth', 0.1, 0.072, 0.43, 0, -0.21, 0, c(L.pants), 'y', 10); k.sph('cloth', 0.1, 0.1, 0.1, 0, 0, 0, c(L.pants)); k.box('cloth', 0.05, 0.14, 0.09, -0.078, -0.2, 0, c(L.gear)); });
  s.shin = mk((k) => {
    k.cyl('cloth', 0.074, 0.056, 0.36, 0, -0.18, 0, c(L.pants), 'y', 10); k.sph('cloth', 0.074, 0.074, 0.074, 0, 0, 0, c(L.pants));
    if (team === 'CT') k.box('cloth', 0.09, 0.1, 0.03, 0, 0.0, -0.06, c(L.gear));
    k.cyl('cloth', 0.058, 0.05, 0.16, 0, -0.35, 0, c(L.boot), 'y', 10); k.box('cloth', 0.09, 0.05, 0.26, 0, -0.415, -0.05, c(L.boot)); k.box('cloth', 0.094, 0.018, 0.27, 0, -0.438, -0.05, C.rub);
  });
  const out = {};
  Object.keys(s).forEach((n) => {
    const shared = s[n].b.b, keys = Object.keys(shared), gs = {};
    keys.forEach((k) => { const bt = new Batch(); bt.b = { [k]: shared[k] }; gs[k] = bt.mesh(k, k === 'skin' ? mats().skin : k === 'metal' ? mats().metal : mats().cloth, true, true); });
    out[n] = gs;
  });
  return out;
}
const segCache = {};
const segOf = (t) => segCache[t] || (segCache[t] = segGeos(t));

const SH_R = new V(0.215, 0.43, 0), SH_L = new V(-0.215, 0.43, 0), POLE_R = new V(0.55, -0.8, 0.25), POLE_L = new V(-0.6, -0.8, 0.1);
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _e = new V(), _f = new V(), _g = new V(), _h = new V(), _e2 = new V(), _p = new V(), DOWN = new V(0, -1, 0), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const LEN = 0.285;
// bras à deux segments : place le coude pour que la main atteigne la cible
function solve(upper, fore, S, H, pole) {
  _d.subVectors(H, S); let D = _d.length(); _d.divideScalar(D || 1);
  D = Math.min(D, LEN * 1.98);
  const a = D / 2, h = Math.sqrt(Math.max(0, LEN * LEN - a * a));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(_d).multiplyScalar(a).addScaledVector(_p, h);          // épaule -> coude
  const d1 = _a2.copy(_e).normalize();
  upper.quaternion.setFromUnitVectors(DOWN, d1);
  const d2 = _b2.copy(_d).multiplyScalar(D).sub(_e).normalize();  // coude -> main
  _qi.copy(upper.quaternion).invert();
  d2.applyQuaternion(_qi);
  fore.quaternion.setFromUnitVectors(DOWN, d2);
}
const _a2 = new V(), _b2 = new V();

class Rig {
  constructor(team, pid) {
    this.root = new THREE.Group(); this.team = team; this.hits = [];
    this.pelvis = new THREE.Group(); this.root.add(this.pelvis);
    const S = segOf(team), seg = (name, parent, zone, x, y, z) => {
      const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g);
      Object.keys(S[name]).forEach((k) => {
        const m = new THREE.Mesh(S[name][k].geometry, S[name][k].material); m.castShadow = true; m.receiveShadow = true;
        if (zone) { m.userData = { pid, zone }; this.hits.push(m); }
        g.add(m);
      });
      return g;
    };
    this.pelvis.position.y = 0.95;
    this.hips = seg('hips', this.pelvis, 's');
    this.spine = seg('torso', this.pelvis, 'c', 0, 0.06, 0);
    this.head = seg('head', this.spine, 'h', 0, 0.54, 0);
    this.helmet = seg('helmet', this.head, 'h');
    this.uR = seg('armU', this.spine, 'a', 0.215, 0.43, 0); this.fR = seg('armL', this.uR, 'a', 0, -0.285, 0);
    this.uL = seg('armU', this.spine, 'a', -0.215, 0.43, 0); this.fL = seg('armL', this.uL, 'a', 0, -0.285, 0);
    this.tR = seg('thigh', this.pelvis, 'l', 0.1, -0.03, 0); this.sR = seg('shin', this.tR, 'l', 0, -0.44, 0);
    this.tL = seg('thigh', this.pelvis, 'l', -0.1, -0.03, 0); this.sL = seg('shin', this.tL, 'l', 0, -0.44, 0);
    this.gunMount = new THREE.Group(); this.spine.add(this.gunMount);
    this.gun = null; this.gunId = null; this.cls = 'pistol';
    this.ph = 0; this.c = 0; this.kick = 0; this.dead = 0; this.deadDir = 1; this.deadSide = 0; this.deadHs = false; this.rl = 0; this.rnd = Math.random();
    this.actK = 0; this.actT = 0; this.actKind = 1; this.rlT = 0;
  }
  setGun(id) {
    if (this.gun) { this.gunMount.remove(this.gun); this.gun = null; }
    this.gunId = id; const g = gunTP(id); this.gun = g; this.gunMount.add(g);
    this.cls = g.userData.info.class; this.info = g.userData.info;
    const ri = this.cls === 'rifle' || this.cls === 'sniper' || this.cls === 'shotgun' || this.info.len > 0.4;
    this.long = ri;
    if (this.cls === 'knife') g.position.set(0.24, 0.16, -0.26);
    else if (ri) g.position.set(0.1, 0.42, -0.18); else g.position.set(0.05, 0.42, -0.46);
  }
  muzzle(v) { return this.gun.localToWorld(v.copy(this.info.muzzle)); }
  update(dt, s) {
    // s : vitesse (m/s), fw et sd (direction locale -1..1), crouch 0/1, pitch, reload, rlDur,
    //     act (0 rien, 1 pose la bombe, 2 désamorce), pg (progression), tx/tz (cible au sol, repère du joueur, avant = -z)
    const k = 1 - Math.exp(-12 * dt);
    const act = s.act | 0;
    this.actK += ((act ? 1 : 0) - this.actK) * (1 - Math.exp(-9 * dt));
    if (act) { this.actT += dt; this.actKind = act; } else if (this.actK < 0.01) this.actT = 0;
    const A = this.actK;
    this.c += (((s.crouch || act) ? 1 : 0) - this.c) * k;
    this.kick *= Math.exp(-14 * dt);
    if (s.dead) return this.updDead(dt);
    this.dead = 0; this.root.rotation.set(0, 0, 0); this.root.position.y = 0;
    this.head.rotation.y = 0; this.head.rotation.z = 0;
    if (this.gun) this.gun.visible = A < 0.55;       // les deux mains sont prises : l'arme est portée dans le dos
    const v = Math.min(s.speed, 7), mv = Math.min(1, v / 2.5) * (1 - A);
    this.ph += dt * (v * 2.25 + (v > 0.1 ? 1.2 : 0)) * (s.fw < -0.3 ? -1 : 1);
    const sw = Math.sin(this.ph), sw2 = Math.sin(this.ph + Math.PI), c = this.c;
    const amp = 0.58 * mv * (1 - 0.45 * c) * (0.6 + 0.4 * Math.abs(s.fw)), knee = (a) => Math.max(0, Math.sin(a - 0.6)) * 0.95 * mv;
    const side = s.sd * mv * 0.14;
    const y0 = 0.95 - 0.42 * c - 0.1 * A;
    this.pelvis.position.y = y0 + Math.abs(Math.cos(this.ph)) * 0.024 * mv - 0.012 * mv;
    this.pelvis.rotation.y = sw * 0.08 * mv;
    this.pelvis.rotation.z = -side * 0.4;
    const cTh = (1.32 + 0.25 * A) * c, cSh = (-2.1 - 0.2 * A) * c;
    this.tR.rotation.set(cTh * (1) + sw * amp, 0, -0.03 - side); this.sR.rotation.x = cSh - knee(this.ph + 1.6);
    this.tL.rotation.set(cTh * 0.8 + sw2 * amp, 0, 0.03 - side); this.sL.rotation.x = cSh * 0.72 - knee(this.ph + 1.6 + Math.PI);
    if (c > 0.01) { this.tL.rotation.z = 0.03 - 0.1 * c; this.tR.rotation.z = -0.03 + 0.1 * c; }
    const lean = 0.08 + 0.05 * mv + 0.3 * c + 0.6 * A;
    const pit = GFX.clamp(s.pitch, -1.2, 1.2) * (1 - A);
    // penché vers l'avant (-z) : rotation x négative ; regarde en haut : pitch positif = buste relevé
    this.spine.rotation.set(-lean + pit * 0.45, -this.pelvis.rotation.y, 0);
    this.head.rotation.x = pit * 0.45 + lean * 0.6 - 0.45 * A;
    // rechargement : minuteur propre à ce soldat
    const rlOn = s.reload && A < 0.5;
    this.rlT = rlOn ? this.rlT + dt : 0;
    const r = rlOn ? 1 : 0;
    this.rl += (r - this.rl) * k; const rl = this.rl, K = this.kick;
    const shell = this.gunId && CS_W(this.gunId).shell;
    const dur = Math.max(0.8, s.rlDur || 2), u = shell ? 0 : (this.rlT / dur) % 1;
    // l'arme suit le regard, les mains suivent l'arme (cinématique inverse)
    let slap = 0;
    if (!shell && rlOn && u > 0.78 && u < 0.9) slap = Math.sin((u - 0.78) / 0.12 * Math.PI);
    this.gunMount.rotation.set(pit * 0.55 - rl * 0.5 - K * 0.09 + lean * 0.9 * (1 - A) + slap * 0.1, 0, rl * (shell ? 0.12 : 0.34));
    this.gunMount.position.set(0, -rl * 0.05, K * 0.05);
    this.gunMount.updateMatrix();
    if (this.gun) this.gun.updateMatrix();
    // mains : cibles dans le repère du buste
    const hR = _a.copy(this.info.handR), hL = _b.copy(this.info.handL);
    this.toSpine(hR); this.toSpine(hL);
    if (rl > 0.01) {
      const P0 = _c.set(-0.14, 0.1, -0.14);                                  // pochette de chargeurs, à la ceinture
      const mw = this.toSpine(_g.copy(this.info.handR).add(_h.set(0, 0.02, -0.07)));  // puits de chargeur
      const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      let tgt;
      if (shell) {                                                           // une cartouche à la fois : pochette -> arme
        const q = (this.rlT % 0.5) / 0.5;
        tgt = _e2.copy(mw).lerp(P0, Math.pow(Math.sin(q * Math.PI), 0.8));
      } else if (u < 0.15) tgt = _e2.copy(hL).lerp(mw, sm(u / 0.15));
      else if (u < 0.32) tgt = _e2.copy(mw).add(_h.set(-0.02, -0.1 * sm((u - 0.15) / 0.17), 0.0));  // le chargeur sort
      else if (u < 0.42) tgt = _e2.copy(mw).add(_h.set(-0.02, -0.1, 0)).lerp(P0, sm((u - 0.32) / 0.1));
      else if (u < 0.56) tgt = _e2.copy(P0).add(_h.set(0, Math.sin((u - 0.42) * 40) * 0.008, 0));        // il en saisit un autre
      else if (u < 0.78) tgt = _e2.copy(P0).lerp(mw, sm((u - 0.56) / 0.22));
      else if (u < 0.9) tgt = _e2.copy(mw).add(_h.set(0, slap * -0.025, 0));                              // il le claque
      else tgt = _e2.copy(mw).lerp(hL, sm((u - 0.9) / 0.1));
      hL.lerp(tgt, rl);
    }
    if (A > 0.01) {
      const sx = this.spine.rotation.x, cs = Math.cos(sx), sn = Math.sin(sx);
      const dX = s.tx || 0, dY = 0.07 - (this.pelvis.position.y + 0.06), dZ = s.tz != null ? s.tz : -0.55;
      const ty = dY * cs + dZ * sn, tz = -dY * sn + dZ * cs, t = this.actT;
      const tapR = this.actKind === 1 ? Math.abs(Math.sin(t * 9)) * 0.035 : 0.014 * Math.sin(t * 7);
      const tapL = this.actKind === 2 ? Math.abs(Math.sin(t * 9 + 1.6)) * 0.035 : 0;
      const wob = this.actKind === 2 ? Math.cos(t * 5) * 0.012 : 0;
      hR.lerp(_f.set(dX + 0.06 + wob, ty + tapR, tz), A);
      hL.lerp(_f.set(dX - 0.1, ty + tapL, tz + 0.05), A);
    }
    if (this.cls === 'knife' && A < 0.02 && rl < 0.01) {
      solve(this.uR, this.fR, SH_R, hR, POLE_R);
      this.uL.rotation.set(sw2 * 0.35 * mv + 0.2, 0, 0.12); this.fL.rotation.set(0.5, 0, 0);
    } else {
      solve(this.uR, this.fR, SH_R, hR, POLE_R);
      solve(this.uL, this.fL, SH_L, hL, POLE_L);
    }
  }
  toSpine(v) { return v.applyMatrix4(this.gun.matrix).applyMatrix4(this.gunMount.matrix); }
  updDead(dt) {
    if (this.gun) this.gun.visible = false;
    this.dead = Math.min(1, this.dead + dt * (this.deadHs ? 1.7 : 1.25));
    const t = this.dead, sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    const buck = sm(t / 0.4), fall = sm((t - 0.18) / 0.82), dir = this.deadDir, R = this.rnd;
    const bend = buck * (1 - fall), bounce = t > 0.78 ? Math.sin((t - 0.78) * 14) * 0.035 * (1 - t) * 4 : 0;
    // les genoux plient, puis le corps bascule autour des pieds et rebondit au sol
    this.root.rotation.x = dir * 1.52 * Math.pow(fall, 1.5) + bounce * dir;
    this.root.rotation.z = this.deadSide * 0.35 * fall;
    this.root.position.y = 0.11 * fall;
    this.pelvis.position.y = 0.95 - 0.4 * bend - 0.03 * fall;
    this.pelvis.rotation.set(0, 0, 0);
    this.tR.rotation.set(1.25 * bend + (0.1 + R * 0.5) * fall, 0, -0.12 * fall);
    this.sR.rotation.x = -2.0 * bend - 0.5 * R * fall;
    this.tL.rotation.set(0.9 * bend + (0.5 - R * 0.4) * fall, 0, 0.16 * fall);
    this.sL.rotation.x = -1.7 * bend - (0.4 + R * 0.5) * fall;
    // bras : lancés en l'air au moment de l'impact, puis retombent
    this.uR.rotation.set(-0.9 * bend + (-0.3 + R * 1.2) * fall, 0, 0.45 * bend + (0.3 + R * 1.2) * fall);
    this.fR.rotation.set(0.5 * bend + (0.2 + R) * fall, 0, 0);
    this.uL.rotation.set(-0.7 * bend + (0.5 - R * 1.4) * fall, 0, -0.5 * bend + (-0.6 - R * 0.6) * fall);
    this.fL.rotation.set(0.6 * bend + 0.4 * fall, 0, 0);
    this.spine.rotation.set(dir > 0 ? -0.45 * bend - 0.06 * fall : 0.3 * bend + 0.1 * fall, 0, 0);
    // balle dans la tête : la tête part en arrière
    this.head.rotation.x = (this.deadHs ? 0.75 : 0.15) * bend - dir * 0.2 * fall;
    this.head.rotation.y = (R - 0.5) * fall; this.head.rotation.z = (this.deadHs ? (R - 0.5) * 0.5 * bend : 0);
    return t >= 1;
  }
}

/* ---------- bras en vue subjective ---------- */
function vmArm(team, left) {
  const L = LOOK[team], k = new Kit(), g = new THREE.Group(), sleeve = lin(L.jacket);
  k.cyl('poly', 0.034, 0.044, 0.44, 0, 0, 0.24, sleeve, 'z', 14); k.cyl('poly', 0.045, 0.05, 0.3, 0, 0, 0.55, sleeve, 'z', 14);
  k.cyl('poly', 0.036, 0.036, 0.02, 0, 0, 0.03, lin(L.gear), 'z', 12); k.cyl('poly', 0.046, 0.046, 0.03, 0, 0, 0.3, lin(L.band), 'z', 12);
  k.box('skin', 0.065, 0.078, 0.082, 0, 0, -0.02, GLOVE);
  const s = left ? 1 : -1;
  for (let i = 0; i < 4; i++) { k.box('skin', 0.016, 0.018, 0.045, s * 0.018, 0.032 - i * 0.021, -0.078, GLOVE, 0.1, 0, 0); k.box('skin', 0.014, 0.016, 0.03, s * 0.012, 0.03 - i * 0.021, -0.102, lin(0x1c1d20), 0, s * 0.5, 0); }
  k.box('skin', 0.018, 0.022, 0.05, -s * 0.03, -0.002, -0.058, lin(0x1c1d20), 0, -s * 0.4, 0);
  ['poly', 'skin'].forEach((n) => { const m = k.b.mesh(n, n === 'skin' ? mats().skin : mats().poly, false, false); if (m) g.add(m); });
  return g;
}

/* ---------- bombe ---------- */
function bomb() {
  const k = new Kit(), g = new THREE.Group();
  [-0.075, 0, 0.075].forEach((x) => { k.box('poly', 0.07, 0.07, 0.3, x, 0.04, 0, lin(0x6a5f3f)); k.box('poly', 0.066, 0.002, 0.29, x, 0.0755, 0, lin(0x8a8159)); });
  k.box('cloth', 0.25, 0.08, 0.03, 0, 0.04, -0.09, lin(0x1c1c1e)); k.box('cloth', 0.25, 0.08, 0.03, 0, 0.04, 0.09, lin(0x1c1c1e));
  k.box('metal', 0.16, 0.024, 0.12, 0, 0.09, 0, lin(0x2a2c2e)); k.box('poly', 0.12, 0.004, 0.035, 0, 0.104, -0.03, lin(0x1a2f24));
  for (let i = 0; i < 12; i++) k.box('poly', 0.016, 0.004, 0.014, -0.05 + (i % 4) * 0.033, 0.104, 0.0 + ((i / 4) | 0) * 0.018, lin(0x777a7c));
  k.box('metal', 0.006, 0.09, 0.006, 0.09, 0.13, 0.05, lin(0x222222));
  ['poly', 'metal', 'cloth'].forEach((n) => { const m = k.b.mesh(n, mats()[n], true, true); if (m) g.add(m); });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x440000, toneMapped: false }));
  led.position.set(0.065, 0.108, 0.04); g.add(led); g.userData.led = led;
  return g;
}

return { gunVM, gunTP, Rig, vmArm, bomb, mats };
})();
