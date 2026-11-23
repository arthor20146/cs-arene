/* CS Arena - client (three.js r128) */
(function () {
'use strict';
const { CFG, WEAPONS, SHOP, MAPS, GREN } = CS;
// grenades : touches 4 à 7 (le serveur fait foi pour les prix et les quantités)
const NADES = ['flash', 'smoke', 'he', 'molo'];
const NADE_UI = {
  flash: { short: 'FLASH', stat: 'Aveugle ceux qui la regardent' },
  smoke: { short: 'FUMI', stat: 'Nuage opaque pendant ' + CFG.smokeTime + ' s' },
  he: { short: 'FRAG', stat: 'Dégâts d\'explosion jusqu\'à ' + CFG.heRadius + ' m' },
  molo: { short: 'MOLO', stat: 'Flammes au sol pendant ' + CFG.fireTime + ' s' }
};
const isNade = (id) => !!(id && GREN[id]);
// côté client, une grenade se manipule comme une arme (emplacement 4) : nom, vitesse, vue subjective
NADES.forEach((k) => {
  if (!WEAPONS[k]) WEAPONS[k] = { n: GREN[k].n, slot: 4, price: GREN[k].price, team: '', dmg: 0, hs: 1, rof: 0.5, range: 0, mag: 0, res: 0, auto: 0, spread: 0, rec: 0, rl: 0, spd: 1, kill: 300, cls: 'grenade', fall: 1, pen: 0, ap: 0 };
});
let MAP = MAPS.dust, BOXES = MAP.boxes, SITES = MAP.sites; // carte actuelle (changée par setMap)
/* ---------- cartes perso (éditeur) ----------
   l_<id> : carte de « Mes cartes » (localStorage cs_maps), envoyée au serveur au lancement de la partie
   u_<id> : carte enregistrée sur le serveur (chargée à la demande par /maps/get) */
function localMaps() { try { const a = JSON.parse(localStorage.getItem('cs_maps') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
localMaps().forEach((m) => { try { MAPS['l_' + m.id] = CS.buildCustom(m.data, 'l_' + m.id); } catch (e) {} });
const mapLoads = {};
function loadCustom(id) {
  if (MAPS[id]) return Promise.resolve(true);
  if (!/^u_[a-f0-9]{10}$/.test(String(id))) return Promise.resolve(false);
  return mapLoads[id] || (mapLoads[id] = fetch('/maps/get?id=' + id).then((r) => r.json())
    .then((r) => { if (r.ok) MAPS[id] = CS.buildCustom(r.map, id); return !!r.ok; })
    .catch(() => false).then((ok) => { delete mapLoads[id]; return ok; }));
}
async function uploadMap(src) {
  const r = await fetch('/maps/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map: src, tok: Account.token() || '' }) });
  const j = await r.json().catch(() => ({ ok: false, err: 'Réponse invalide du serveur' }));
  if (!j.ok) throw new Error(j.err || 'Échec de l\'envoi');
  MAPS[j.id] = CS.buildCustom(src, j.id);
  return j.id;
}
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = CFG.radius;
const cfg = Settings.cfg;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ============================================================
   Rendu / scène
   ============================================================ */
const canvas = $('c');
const { renderer, scene, cam, vmScene } = GFX.init(canvas);
const fx = GFX.fx;
let FOV = cfg.fov;
cam.fov = FOV;
GFX.setScale(cfg.renderScale);
const vmCam = new THREE.PerspectiveCamera(50, 1, 0.01, 8);
GFX.setVmCam(vmCam);
function resize() {
  GFX.resize();
  vmCam.aspect = window.innerWidth / window.innerHeight; vmCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let worldMeshes = [];
function setMap(id) {
  const M = MAPS[id] || MAPS.dust;
  if (worldMeshes.length && M === MAP) return;
  MAP = M; BOXES = M.boxes; SITES = M.sites;
  hiddenSig = ''; hiddenSet = new Set();
  worldMeshes = GFX.buildWorld(M);
  fx.clear();
  if (connected) { clearDummies(); clearTargets(); }   // zone de test : changement de carte
  Snd.setAmbient(M.style || M.id);
}

/* ============================================================
   État
   ============================================================ */
let ws = null, myId = null, myTeam = null, connected = false, locked = false;
let joinInfo = { name: '', room: 'main', team: 'auto', map: 'dust', lobby: false };
function inLobby() { return connected && S.lb === 1 && S.ph === 'wait'; }
const S = { ph: 'wait', te: 0, rd: 0, sc: { T: 0, CT: 0 }, b: { s: 'none', x: 0, z: 0 }, pl: new Map(), me: null, recv: 0, names: new Map() };
const ui = { buy: false, chat: false, board: false, map: false, panel: false };
const K = {};
// une action est-elle maintenue ? (touches choisies dans Paramètres)
const down = (a) => { const b = Settings.binds[a]; return !!((b[0] && K[b[0]]) || (b[1] && K[b[1]])); };
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, recP: 0, recY: 0, burst: 0, ground: true, crouch: 0, shake: 0, bob: 0, stepD: 0, tag: 0, landT: 0, stam: 1, dip: 0, dipV: 0, roll: 0, swayX: 0, swayY: 0, mouseX: 0, mouseY: 0, sunK: 1, sunT: 1, deadT: 0, deadSide: 1, deadHs: false, deadDir: 1 };
let cur = 'glock', lastCur = 'knife', ammo = {}, reloading = false, rlEnd = 0, rlDur = 1, rlStage = 0, rlEmpty = false, rlNext = 0, nextShot = 0, swapT = 0;
let fireHeld = false, fireLatch = false, scoped = false, rmbHeld = false, aiming = false, adsT = 0, needRefill = false, lastInv = { p: null, s: null };
let specId = null, banTimer = 0, noticeTimer = 0, hitTimer = 0, dmgTimer = 0;
// grenades : lancer en cours (thrT), arme d'avant, quantité prévue avant la mise à jour du serveur
let thrT = -1, thrSoft = false, thrSent = false, prevGun = 'knife';
const nloc = {};
let crouchTog = false, bgMuted = false, fpsN = 0, fpsT = 0;
const remotes = new Map();
// mode « Rien n'est à sa place »
let tpSeq = 0, tpName = '', warpWarn = 0, warpHit = 0, glitchOn = false, warpOp = -1, hiddenSig = '', hiddenSet = new Set();
let chosenMode = '';

const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const alive = () => !!(S.me && S.me.al);
const teamName = (t) => (t === 'T' ? 'Terroristes' : 'Anti-terroristes');

/* ============================================================
   Collisions (joueur local)
   ============================================================ */
function collide() {
  for (const b of BOXES) {
    if (P.y >= b.h - 0.55) continue;
    const hx = b.w / 2, hz = b.d / 2;
    const cx = clamp(P.x, b.x - hx, b.x + hx), cz = clamp(P.z, b.z - hz, b.z + hz);
    const dx = P.x - cx, dz = P.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < R * R) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); P.x = cx + dx / d * R; P.z = cz + dz / d * R; }
      else {
        const px = hx - Math.abs(P.x - b.x), pz = hz - Math.abs(P.z - b.z);
        if (px < pz) P.x += (P.x > b.x ? 1 : -1) * (px + R); else P.z += (P.z > b.z ? 1 : -1) * (pz + R);
      }
    }
  }
  // barrières sans hauteur (stand de tir : on ne passe pas le comptoir)
  for (const b of (MAP.bar || [])) {
    const hx = b.w / 2, hz = b.d / 2;
    const cx = clamp(P.x, b.x - hx, b.x + hx), cz = clamp(P.z, b.z - hz, b.z + hz);
    const dx = P.x - cx, dz = P.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < R * R) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2); P.x = cx + dx / d * R; P.z = cz + dz / d * R; }
      else P.z = b.z + hz + R;   // coincé dedans : on revient côté tireur
    }
  }
  P.x = clamp(P.x, -MAP.hx + 0.4, MAP.hx - 0.4); P.z = clamp(P.z, -MAP.hz + 0.4, MAP.hz - 0.4);
}
function groundAt(x, z, y) {
  let g = 0;
  for (const b of BOXES) {
    if (b.h <= y + 0.55 && b.h > g && Math.abs(x - b.x) < b.w / 2 + R * 0.6 && Math.abs(z - b.z) < b.d / 2 + R * 0.6) g = b.h;
  }
  return g;
}

/* ============================================================
   Effets : particules, traçantes, impacts
   ============================================================ */
const IMPACT = {
  sand:  { dust: [0.62, 0.5, 0.34], bits: [0.42, 0.33, 0.22], hole: new THREE.Color(0.5, 0.42, 0.32), sc: 1.1 },
  stone: { dust: [0.72, 0.65, 0.54], bits: [0.55, 0.48, 0.38], hole: new THREE.Color(0.9, 0.85, 0.8), sc: 0.9 },
  wood:  { dust: [0.5, 0.38, 0.24], bits: [0.42, 0.28, 0.14], hole: new THREE.Color(0.7, 0.55, 0.42), sc: 0.8 },
  metal: { dust: [0.3, 0.3, 0.3], bits: [0.2, 0.2, 0.2], hole: new THREE.Color(0.55, 0.55, 0.6), sc: 0.55 }
};
function impact(point, normal, mat, audible) {
  const I = IMPACT[mat] || IMPACT.stone;
  fx.smoke(_i.copy(point).addScaledVector(normal, 0.05), I.dust, 3, 1.1, 0.5, 0.75, 0.2);
  fx.debris(point, normal, I.bits, mat === 'sand' ? 4 : 7, 2.6);
  if (mat === 'metal') fx.sparks(point, normal, 8);
  fx.hole(point, normal, I.hole, I.sc);
  if (audible) { const sp = spatial(point.x, point.y, point.z); if (sp.d < 45) Snd.impact(mat, sp.v, sp.pan, sp); }
}
const _i = new THREE.Vector3();

/* ============================================================
   Bombe
   ============================================================ */
const bombMesh = Models.bomb();
const bombLed = bombMesh.userData.led;
bombMesh.visible = false; scene.add(bombMesh);
let nextBeep = 0, ledT = 0;

// un mur entre le joueur et le point (x, z) ?
function blocked(x, z) {
  const dx = x - P.x, dz = z - P.z;
  for (const b of BOXES) {
    if (b.h < 2.4) continue;
    let t0 = 0, t1 = 1;
    const ax = [[dx, P.x, b.x - b.w / 2, b.x + b.w / 2], [dz, P.z, b.z - b.d / 2, b.z + b.d / 2]];
    let hit = true;
    for (const [d, o, lo, hi] of ax) {
      if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) { hit = false; break; } continue; }
      let a = (lo - o) / d, c = (hi - o) / d; if (a > c) { const q = a; a = c; c = q; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}
function spatial(x, y, z) {
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz, y - (P.y + 1.5));
  const wall = d > 1.5 && blocked(x, z);
  let v = Math.pow(clamp(1 - d / 110, 0.04, 1), 1.5) * (wall ? 0.62 : 1);
  const pan = (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / Math.max(d, 0.5);
  const lp = wall ? 750 : d > 12 ? Math.max(1800, 16000 - d * 260) : 0; // l'air et les murs absorbent les aigus
  return { v, pan, d, lp, delay: Math.min(0.28, d / 343), wet: clamp(0.5 + d / 60, 0.5, 1.2) };
}

function updateBomb(dt, now) {
  const b = S.b;
  let ghost = null;
  if (b.s === 'carried') remotes.forEach((r) => { if (r.alive && r.e.q === 1) ghost = r; });
  if (b.s === 'planted' || b.s === 'dropped') {
    if (!bombMesh.visible) bombMesh.rotation.y = b.x * 7 % 6.28;
    bombMesh.visible = true; bombMesh.position.set(b.x, 0.01, b.z);
  } else if (ghost) {       // un autre joueur est en train de poser la bombe devant lui
    const y = ghost.g.rotation.y, gp = ghost.rig.actK;
    bombMesh.visible = gp > 0.5; bombMesh.rotation.y = y;
    bombMesh.position.set(ghost.g.position.x - Math.sin(y) * 0.55, 0.01, ghost.g.position.z - Math.cos(y) * 0.55);
  } else bombMesh.visible = false;
  if (b.s === 'planted') {
    const left = Math.max(0, S.te - (now - S.recv) / 1000);
    if (now / 1000 >= nextBeep) {
      const sp = spatial(b.x, 0.2, b.z);
      Snd.beep(sp.v, sp.pan);
      ledT = 0.1;
      nextBeep = now / 1000 + 0.12 + 0.88 * Math.pow(left / CFG.bombTime, 1.3);
    }
  }
  ledT -= dt;
  bombLed.material.color.setRGB(ledT > 0 ? 12 : 0.16, 0.02, 0.02);
}
/* ============================================================
   Mode « Rien n'est à sa place » : murs qui disparaissent, permutations, transfuges, armes bloquées
   ============================================================ */
const DZ = '#c99bff';
// hb = indices des obstacles disparus (envoyés par le serveur)
function applyHidden(hb, anim) {
  const sig = (hb || []).join(',');
  if (sig === hiddenSig) return;
  const prev = hiddenSet; hiddenSig = sig; hiddenSet = new Set(hb || []);
  BOXES = hiddenSet.size ? MAP.boxes.filter((b, i) => !hiddenSet.has(i)) : MAP.boxes;
  worldMeshes = GFX.setHidden(hb, anim);
  if (!anim) return;
  MAP.boxes.forEach((b, i) => {
    if (prev.has(i) === hiddenSet.has(i)) return;
    const c = new THREE.Vector3(b.x, Math.min(b.h, 3) / 2, b.z);
    fx.smoke(c, [0.5, 0.36, 0.78], 8, Math.max(b.w, b.d) * 0.6, 2.4, 1.6, 0.3);
    fx.sparks(c, UP, 12);
    const sp = spatial(b.x, 1, b.z); if (sp.d < 50) Snd.thud(sp.v, sp.pan, sp);
  });
}
const jammed = (id) => { const w = WEAPONS[id]; return !!(S.jm && w && w.slot === S.jm.s); };
function onTeleport(m) {
  if (m.k) { P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vz = 0; P.vy = Math.min(0, P.vy); tpSeq = m.s; return; }   // position refusée par le serveur
  P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.yaw = m.yaw; P.pitch = 0; P.recP = P.recY = 0;
  P.ground = m.y < 0.05; P.landT = 0; P.burst = 0;
  tpSeq = m.s; tpName = m.n || ''; scoped = false; fireLatch = false;
}
function onChaos(m) {
  warpWarn = 0; warpHit = 0.9; Snd.warp();
  P.shake = Math.max(P.shake, 0.22);
  const key = Settings.key;
  if (m.k === 'teams') {
    const ns = m.ns || [];
    if ((m.ids || []).indexOf(myId) >= 0) streak('TU CHANGES DE CAMP', 'Jusqu\'à la fin de la manche · tes coéquipiers sont maintenant tes ennemis', DZ);
    else streak('TRANSFUGES', ns.slice(0, -1).join(', ') + ' et ' + ns[ns.length - 1] + ' changent de camp', DZ);
  } else if (m.k === 'score') streak('SCORES INVERSÉS', 'Les points des deux camps ont été échangés', DZ);
  else if (m.k === 'walls') {
    applyHidden(m.hb, true);
    const t = [m.off ? m.off + ' mur' + (m.off > 1 ? 's ont disparu' : ' a disparu') : '', m.on ? m.on + (m.on > 1 ? ' sont revenus' : ' est revenu') : ''].filter(Boolean).join(' · ');
    streak('LES MURS BOUGENT', t, DZ);
  } else if (m.k === 'jam') {
    streak(m.s === 1 ? 'ARMES PRINCIPALES BLOQUÉES' : 'PISTOLETS BLOQUÉS', 'Pendant ' + m.t + ' s · ' + (m.s === 1 ? 'sors ton pistolet (' + key('slot2') + ')' : 'prends ton arme principale (' + key('slot1') + ')'), DZ);
  } else if (m.k === 'swap') {
    remotes.forEach((r) => { r.init = false; });   // les autres joueurs sautent à leur nouvelle place
    streak('PERMUTATION', alive() && tpName ? 'Tu as pris la place de ' + tpName : m.all ? 'Tout le monde a changé de place' : m.n + ' joueurs ont échangé leur place', DZ);
    tpName = '';
  } else if (m.k === 'invert') streak('COMMANDES INVERSÉES', 'Avant et arrière, gauche et droite sont échangés pendant ' + m.t + ' s', DZ);
  else if (m.k === 'restore') { applyHidden(m.hb || [], true); streak('TOUT EST EN PLACE', 'Murs, armes et commandes reviennent à la normale', DZ); }
}

/* ============================================================
   Grenades : en vol, fumée, feu, explosions, aveuglement
   (le serveur simule les trajectoires et les effets ; ici, on les montre)
   ============================================================ */
const flying = new Map();   // id -> { g, sp, sv, t, k, bt }
const zones = new Map();    // id -> { k, x, y, z, r, left, g, mats, sprites, sfx, emit }
let smokeA = -1, smokeShown = 0, blindCapNext = false, blindShown = -1, blindImgShown = -1;
const smokeTex = (function () {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = GFX.rng(31);
  for (let i = 0; i < 46; i++) {
    const a = r() * 6.28, d = r() * 30, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, rad = 16 + r() * 28;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  // bord fondu : pas de carré visible
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S / 2); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
})();
// lumières des feux : créées une fois (ajouter une lumière en jeu recompile tous les matériaux)
const fireLights = [0, 1].map(() => { const l = new THREE.PointLight(0xff8a30, 0, 9, 2); l.visible = GFX.Q.lights; scene.add(l); l.used = null; return l; });

function syncFlying(list) {
  const now = performance.now() / 1000, seen = new Set();
  list.forEach((e) => {
    seen.add(e.i);
    const p = new THREE.Vector3(e.x, e.y, e.z), v = new THREE.Vector3(e.vx, e.vy, e.vz);
    let f = flying.get(e.i);
    if (!f) {
      const g = Models.nade(e.k); g.scale.setScalar(1.15); g.position.copy(p); scene.add(g);
      f = { g, sp: p, sv: v, t: now, k: e.k, bt: 0 }; flying.set(e.i, f); return;
    }
    const ov = f.sv;
    if (((ov.y < -1 && v.y > 0.2) || ov.length() - v.length() > 4.5) && now - f.bt > 0.12) {   // rebond
      f.bt = now; const s = spatial(p.x, p.y, p.z); if (s.d < 40) Snd.bounce(s.v, s.pan, s);
    }
    f.sp = p; f.sv = v; f.t = now;
  });
  flying.forEach((f, i) => { if (!seen.has(i)) { scene.remove(f.g); flying.delete(i); } });
}

function makeSmoke(z) {
  const g = new THREE.Group(); g.position.set(z.x, z.y, z.z);
  const n = GFX.quality === 'high' ? 34 : GFX.quality === 'med' ? 26 : 16, r = GFX.rng((z.i * 7919) >>> 0);
  z.mats = [0, 1, 2, 3].map((i) => new THREE.SpriteMaterial({ map: smokeTex, color: new THREE.Color(0.66, 0.68, 0.7), transparent: true, depthWrite: false, opacity: 0, rotation: i * 1.6 }));
  z.sprites = [];
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * z.r * 0.78, h = 0.5 + r() * 2.4 * (1 - d / (z.r * 1.3));
    const s = new THREE.Sprite(z.mats[i % 4]);
    s.userData = { to: new THREE.Vector3(Math.cos(a) * d, h, Math.sin(a) * d), sz: 2.6 + r() * 1.4 };
    s.renderOrder = 6; g.add(s); z.sprites.push(s);
  }
  scene.add(g); z.g = g;
}
function syncZones(list) {
  const seen = new Set();
  list.forEach((e) => {
    seen.add(e.i);
    let z = zones.get(e.i);
    if (!z) {
      z = { i: e.i, k: e.k, x: e.x, y: e.y, z: e.z, r: e.r, left: e.l, sfx: 0, emit: 0 };
      if (e.k === 'smoke') makeSmoke(z);
      else fx.hole(new THREE.Vector3(e.x, e.y + 0.02, e.z), UP, new THREE.Color(0.06, 0.05, 0.04), 16);   // sol brûlé
      zones.set(e.i, z);
    }
    z.left = e.l;
  });
  zones.forEach((z, i) => { if (!seen.has(i)) endZone(i); });
}
function endZone(i) {
  const z = zones.get(i); zones.delete(i);
  if (z.g) { scene.remove(z.g); z.mats.forEach((m) => m.dispose()); }
  fireLights.forEach((l) => { if (l.used === z) { l.used = null; l.intensity = 0; } });
}
function clearNades() {
  flying.forEach((f) => scene.remove(f.g)); flying.clear();
  Array.from(zones.keys()).forEach(endZone);
  smokeA = 0;
}
// densité de fumée autour d'un point (0 = rien, 1 = on ne voit plus rien)
function smokeDensity(x, y, z) {
  let best = 0;
  zones.forEach((s) => {
    if (s.k !== 'smoke') return;
    const dy = y - s.y; if (dy > 4 || dy < -2) return;
    const k = clamp((s.r * 0.95 - Math.hypot(x - s.x, z - s.z)) / 1.6, 0, 1);
    best = Math.max(best, k * clamp(s.left / 1.5, 0, 1));
  });
  return best;
}

function updateNades(dt, now) {
  const tnow = performance.now() / 1000;
  flying.forEach((f) => {
    const dtt = Math.min(tnow - f.t, 0.2), sv = f.sv;
    const tg = _v3.copy(f.sp);
    if (sv.lengthSq() > 0.0025) tg.addScaledVector(sv, dtt).y -= 10 * dtt * dtt;
    tg.y = Math.max(tg.y, 0.11);
    f.g.position.lerp(tg, 1 - Math.exp(-20 * dt));
    if (Math.hypot(sv.x, sv.z) > 0.3) f.g.rotateOnWorldAxis(_v2.set(sv.z, 0, -sv.x).normalize(), sv.length() * 0.9 * dt);
  });
  zones.forEach((z) => {
    z.left -= dt;
    if (z.k === 'smoke') {
      const age = CFG.smokeTime - z.left, grow = sstep(age / 1.4);
      const op = 0.93 * clamp(age / 0.5, 0, 1) * clamp(z.left / 1.5, 0, 1);
      z.mats.forEach((m, i) => { m.opacity = op; m.rotation += dt * 0.03 * (i % 2 ? 1 : -1); });
      z.sprites.forEach((s) => { s.position.copy(s.userData.to).multiplyScalar(0.35 + 0.65 * grow); s.scale.setScalar(s.userData.sz * (0.35 + 0.65 * grow)); });
      return;
    }
    if (z.left < 0.15) return;
    // feu : flammes et fumée noire, émises en continu
    z.emit += dt * (GFX.quality === 'low' ? 26 : 48);
    while (z.emit >= 1) {
      z.emit--;
      const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * z.r * 0.85;
      fx.emit({ add: 1, x: z.x + Math.cos(a) * d, y: z.y + 0.08, z: z.z + Math.sin(a) * d, vx: (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 0.4, g: -1.6, dr: 1.2, life: 0.45 + Math.random() * 0.45, s0: 1.5, s1: 0.45, c: [2.4, 0.75 + Math.random() * 0.45, 0.12], a: 0.85 });
      if (Math.random() < 0.18) fx.emit({ x: z.x + Math.cos(a) * d * 0.6, y: z.y + 0.9, z: z.z + Math.sin(a) * d * 0.6, vx: (Math.random() - 0.5) * 0.5, vy: 0.6 + Math.random() * 0.7, vz: (Math.random() - 0.5) * 0.5, g: -0.4, dr: 0.8, life: 2 + Math.random(), s0: 1.2, s1: 3, c: [0.05, 0.045, 0.04], a: 0.5 });
    }
    let L = fireLights.find((l) => l.used === z) || fireLights.find((l) => !l.used);
    if (L) { L.used = z; L.position.set(z.x, z.y + 0.9, z.z); L.intensity = (2.6 + Math.sin(now * 19) * 0.4 + Math.random() * 0.5) * clamp(z.left / 0.8, 0, 1); }
    z.sfx -= dt;
    if (z.sfx <= 0) { z.sfx = 1.2; const s = spatial(z.x, z.y + 0.3, z.z); if (s.d < 35) Snd.fire(s.v, s.pan, s); }
  });
  fireLights.forEach((l) => { l.visible = GFX.Q.lights; if (l.used && !zones.has(l.used.i)) { l.used = null; l.intensity = 0; } });
  // dans la fumée : écran gris
  const dens = connected ? smokeDensity(cam.position.x, cam.position.y, cam.position.z) * 0.96 : 0;
  smokeA += (dens - smokeA) * Math.min(1, 7 * dt);
  const sa = Math.round(smokeA * 50) / 50;
  if (sa !== smokeShown) { smokeShown = sa; $('smokeov').style.opacity = String(sa); }
}

function onThrowMsg(m) {
  const s = spatial(m.x, m.y, m.z); if (s.d < 40) Snd.throwN(s.v, s.pan, s);
  const r = remotes.get(m.id); if (r && r.rig) r.rig.kick = 1;
}
function nadePop(m) {
  const pos = new THREE.Vector3(m.x, m.y, m.z), sp = spatial(m.x, m.y, m.z);
  if (m.k === 'flash') {
    Snd.flashbang(sp.v, sp.pan, sp);
    fx.flash(_i.copy(pos).setY(pos.y + 0.3), 24); fx.sparks(pos, UP, 26);
    fx.emit({ add: 1, x: pos.x, y: pos.y + 0.3, z: pos.z, vx: 0, vy: 0, vz: 0, g: 0, dr: 0, life: 0.32, s0: 1, s1: 9, c: [30, 30, 28], a: 1 });
  } else if (m.k === 'he') {
    Snd.nadeHE(Math.max(0.35, sp.v), { lp: sp.lp, delay: sp.delay });
    fx.flash(pos, 12);
    for (let i = 0; i < 36; i++) { const a = Math.random() * 6.28, e = Math.random() * 1.4, s = 3 + Math.random() * 9; fx.emit({ add: 1, x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, g: -0.5, dr: 3.2, life: 0.3 + Math.random() * 0.35, s0: 1, s1: 2.6, c: [8, 4.2, 0.8], a: 0.75 }); }
    fx.smoke(pos, [0.1, 0.095, 0.09], 26, 5, 4, 2.4, 0.4);
    fx.sparks(pos, UP, 30); fx.debris(_i.set(pos.x, 0.05, pos.z), UP, [0.5, 0.42, 0.32], 14, 5);
    fx.hole(_i.set(pos.x, 0.02, pos.z), UP, new THREE.Color(0.05, 0.05, 0.05), 12);
    const near = clamp(1 - sp.d / 22, 0, 1);
    P.shake = Math.max(P.shake, near * 0.8);
    if (dummies.size) heDummies(pos);
    if (alive() && sp.d < 9) Snd.ring(clamp(1 - sp.d / 9, 0, 0.8));
  } else if (m.k === 'smoke') Snd.smokePop(sp.v, sp.pan, sp);
  else if (m.k === 'molo') {
    Snd.molo(sp.v, sp.pan, sp);
    fx.flash(pos, 9);
    for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 5; fx.emit({ add: 1, x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: 1 + Math.random() * 3, vz: Math.sin(a) * s, g: 1, dr: 3, life: 0.4 + Math.random() * 0.4, s0: 0.6, s1: 1.8, c: [6, 2.8, 0.5], a: 0.8 }); }
    fx.debris(pos, UP, [0.5, 0.7, 0.5], 8, 3);
  }
}

// aveuglement : on garde une image de l'écran (rémanence), voile blanc, puis l'image s'estompe
let blindW = 0, blindT = 0, blindAge = 99;
function startBlind(w, t) {
  if (!alive()) return;
  const was = blindAge < blindT;
  blindW = w; blindT = t; blindAge = 0;
  if (!was) blindCapNext = true;   // capture juste après le prochain rendu
  Snd.ring(clamp(t / 4.5, 0.15, 1));
}
function endBlind() { blindAge = blindT = 99; }
function resetNadeState() { thrT = -1; Object.keys(nloc).forEach((k) => delete nloc[k]); endBlind(); }
function updateBlind(dt) {
  let wa = 0, ia = 0;
  if (blindAge < blindT && alive()) {
    blindAge += dt;
    const a = blindAge;
    wa = a < blindW ? 1 : clamp(1 - (a - blindW) / 0.9, 0, 1);
    ia = a < blindW ? 1 : clamp(1 - (a - blindW) / Math.max(0.1, blindT - blindW), 0, 1);
  } else blindAge = blindT;
  wa = Math.round(wa * 100) / 100; ia = Math.round(ia * 100) / 100;
  if (wa !== blindShown) { blindShown = wa; $('blind').style.opacity = String(wa); }
  if (ia !== blindImgShown) { blindImgShown = ia; $('blindimg').style.opacity = String(ia); }
}

function explosionFx() {
  const b = S.b;
  const pos = new THREE.Vector3(b.x, 0.8, b.z);
  fx.fireball(pos); fx.flash(pos, 14);
  fx.hole(new THREE.Vector3(b.x, 0.02, b.z), new THREE.Vector3(0, 1, 0), new THREE.Color(0.05, 0.05, 0.05), 28);
  const sp = spatial(b.x, 1, b.z);
  Snd.explode(Math.max(0.4, sp.v), { lp: sp.lp, delay: sp.delay });
  const near = clamp(1 - sp.d / 35, 0, 1);
  if (alive() && near > 0) Snd.ring(near);
  P.shake = Math.max(P.shake, 0.3 + 0.7 * near);
  $('flash').style.transition = 'none'; $('flash').style.opacity = String(Math.min(0.95, 0.15 + near));
  setTimeout(() => { $('flash').style.transition = 'opacity 1.4s'; $('flash').style.opacity = '0'; }, 40);
}

/* ============================================================
   Joueurs distants
   ============================================================ */
function label(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Trebuchet MS, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(1.5, 0.375, 1); s.position.y = 2.1; s.renderOrder = 10;
  return s;
}
const blobTex = GFX.blobShadow();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
const blobGeo = new THREE.PlaneGeometry(1.3, 1.3);

function makeRemote(e) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const r = { id: e.i, g, rig: null, hit: [], team: null, w: null, tp: new THREE.Vector3(), init: false, alive: false, tyaw: 0, label: null, step: 0, e, vs: 0, fw: 0, sd: 0, pooled: false };
  r.blob = new THREE.Mesh(blobGeo, blobMat); r.blob.rotation.x = -Math.PI / 2; r.blob.position.y = 0.03; g.add(r.blob);
  r.label = label(e.n, '#ffffff'); g.add(r.label);
  scene.add(g);
  return r;
}
function setRemoteTeam(r, t) {
  r.team = t;
  if (r.rig) r.g.remove(r.rig.root);
  r.rig = new Models.Rig(t === 'CT' ? 'CT' : 'T', r.id);
  r.g.add(r.rig.root); r.hit = r.rig.hits;
  r.w = null;
}
function setRemoteGun(r, w, sk) { r.w = w; r.sk = sk || ''; r.rig.setGun(w, sk); }
function removeRemote(id) {
  const r = remotes.get(id); if (!r) return;
  scene.remove(r.g); remotes.delete(id);
}

const _l = new THREE.Vector3();
function updateRemotes(dt) {
  const k = 1 - Math.exp(-14 * dt);
  remotes.forEach((r) => {
    const px = r.g.position.x, pz = r.g.position.z;
    r.g.position.x += (r.tp.x - px) * k; r.g.position.y += (r.tp.y - r.g.position.y) * k; r.g.position.z += (r.tp.z - pz) * k;
    let dy = r.tyaw - r.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.g.rotation.y += dy * k;
    const e = r.e;
    r.label.visible = r.alive && r.team === myTeam;
    r.blob.visible = !GFX.Q.shadow;
    const dx = r.g.position.x - px, dz = r.g.position.z - pz, mv = Math.hypot(dx, dz), sp = dt > 0 ? mv / dt : 0;
    r.vs += (sp - r.vs) * Math.min(1, 10 * dt);
    if (mv > 1e-4) {
      const sy = Math.sin(r.g.rotation.y), cy = Math.cos(r.g.rotation.y);
      r.fw += ((-dx * sy - dz * cy) / mv - r.fw) * Math.min(1, 8 * dt); r.sd += ((dx * cy - dz * sy) / mv - r.sd) * Math.min(1, 8 * dt);
    }
    if (r.alive) {
      r.pooled = false;
      r.step += mv;
      if (r.step > 2.2 && dt > 0) {
        r.step = 0;
        if (!e.c && r.vs > 3.4) { const s = spatial(r.g.position.x, 0, r.g.position.z); if (s.d < 30) Snd.step(surfaceAt(r.g.position.x, r.g.position.z, r.g.position.y), s.v * 0.9, s.pan, s); }
      }
    }
    if (r.rig) {
      r.rig.helmet.visible = !!e.h;
      const q = r.alive ? (e.q | 0) : 0;
      let tx = 0, tz = -0.55;
      if (q === 2) { // bombe posée : on la vise depuis la position du soldat
        const dx = S.b.x - r.g.position.x, dz = S.b.z - r.g.position.z, yy = r.g.rotation.y;
        tx = dx * Math.cos(yy) - dz * Math.sin(yy); tz = dx * Math.sin(yy) + dz * Math.cos(yy);
      }
      r.rig.update(dt, { speed: r.alive ? r.vs : 0, fw: r.fw, sd: r.sd, crouch: e.c, pitch: e.p || 0, reload: e.l, rlDur: (WEAPONS[r.w] || {}).rl, dead: !r.alive, act: q, pg: e.g || 0, tx, tz });
      if (q) { r.tapT = (r.tapT || 0) - dt; if (r.tapT <= 0) { r.tapT = 0.35; const sp = spatial(r.g.position.x, 0.5, r.g.position.z); if (sp.d < 25) Snd.beep(sp.v * 0.35, sp.pan); } }
      if (!r.alive && r.rig.dead >= 1 && !r.pooled) { // flaque de sang sous le corps
        r.pooled = true;
        fx.bloodDecal(_l.set(r.g.position.x, r.g.position.y + 0.015, r.g.position.z), UP, 1.5 + Math.random() * 0.8);
      }
    }
  });
}
const UP = new THREE.Vector3(0, 1, 0);

/* ============================================================
   Arme locale (viewmodel)
   ============================================================ */
const VMPOS = {
  pistol:  { p: [0.125, -0.115, -0.42], ads: 0.42, elR: [0.3, -0.46, 0.1], elL: [-0.12, -0.5, 0.0] },
  smg:     { p: [0.16, -0.15, -0.4], ads: 0.42, elR: [0.34, -0.46, 0.1], elL: [-0.2, -0.56, 0.0] },
  rifle:   { p: [0.16, -0.16, -0.44], ads: 0.5, elR: [0.36, -0.46, 0.08], elL: [-0.16, -0.58, -0.08] },
  shotgun: { p: [0.16, -0.16, -0.44], ads: 0.5, elR: [0.36, -0.46, 0.08], elL: [-0.16, -0.58, -0.08] },
  sniper:  { p: [0.16, -0.16, -0.44], ads: 0.5, elR: [0.36, -0.46, 0.08], elL: [-0.16, -0.58, -0.08] },
  knife:   { p: [0.18, -0.16, -0.36], ads: 0.3, elR: [0.36, -0.46, 0.1], elL: [-0.3, -0.6, 0.2] },
  grenade: { p: [0.2, -0.21, -0.44], ads: 0.3, elR: [0.34, -0.46, 0.1], elL: [-0.3, -0.6, 0.2] }
};
const vmPivot = new THREE.Group(); vmScene.add(vmPivot);
let actFp = 0, actKindFp = 1, actTFp = 0, tapN = 0, snipN = 0, rlDropped = false, rlDropNow = false, vmBomb = null, vmCutter = null, dropMag = null;
let V = null, armR = null, armL = null, armTeam = null, vmFlash = null, vmKick = 0, vmSlide = 0, boltT = 0, slash01 = 0;
const flashTex = (function () {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-in'; g.translate(S / 2, S / 2); g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, r = i % 2 ? 16 : 62; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
})();
const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(5, 3.5, 2), toneMapped: false, side: THREE.DoubleSide });

function buildVM(id) {
  if (V) vmPivot.remove(V.group);
  V = Models.gunVM(id, Account.skinOf(id));   // skin équipé (pass de combat)
  V.id = id; V.sk = Account.skinOf(id);
  vmPivot.add(V.group);
  V.pos = VMPOS[V.info.class] || VMPOS.rifle;
  const t = myTeam === 'CT' ? 'CT' : 'T';
  if (armTeam !== t) {
    if (armR) vmScene.remove(armR, armL);
    armR = Models.vmArm(t, false); armL = Models.vmArm(t, true); vmScene.add(armR, armL); armTeam = t;
  }
  armL.visible = id !== 'knife' && !isNade(id);
  V.magHome = V.mag.position.clone();
  if (id !== 'knife' && !isNade(id)) {
    const q = new THREE.PlaneGeometry(0.34, 0.34);
    vmFlash = new THREE.Group();
    const a = new THREE.Mesh(q, flashMat), b = new THREE.Mesh(q, flashMat); b.rotation.y = Math.PI / 2; b.position.z = -0.08; b.scale.set(1, 0.6, 1);
    vmFlash.add(a, b); vmFlash.position.copy(V.info.muzzle); vmFlash.visible = false; V.group.add(vmFlash);
  } else vmFlash = null;
  Snd.part('draw');
}
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _h2 = new THREE.Vector3();
// objets de la vue subjective : bombe tenue en main, pince du kit, chargeur qui tombe
vmBomb = Models.bomb(); vmBomb.visible = false; vmBomb.scale.setScalar(1.25); vmScene.add(vmBomb);
{
  const mk = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.4 });
  vmCutter = new THREE.Group();
  vmCutter.jaw = [0, 1].map((i) => {
    const j = new THREE.Group(), blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.07), mk(0x9aa0a6)), grip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.1), mk(0xb02a22));
    blade.position.z = -0.035; grip.position.z = 0.05; j.add(blade, grip); vmCutter.add(j); return j;
  });
  vmCutter.visible = false; vmScene.add(vmCutter);
  dropMag = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.11, 0.045), mk(0x1d1f22)); dropMag.visible = false; dropMag.vel = new THREE.Vector3(); vmScene.add(dropMag);
}
const _bR = new THREE.Vector3(), _bL = new THREE.Vector3(), _pw = new THREE.Vector3();
const sstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
// fusils à lunette sans mode sniper (AUG, SG 553) : en visée, on regarde dans la lunette (sinon le tube cache tout)
const opticView = () => !!(aiming && V && V.info.optic && !WEAPONS[cur].scope && adsT > 0.8 && alive());
let opticShown = false;
function poseVM(dt, now, showVM) {
  const ov = opticView();
  if (ov !== opticShown) { opticShown = ov; $('scope2').style.display = ov ? 'block' : 'none'; }
  const on = showVM && !scoped && !ov;
  const A = actFp, ease = sstep(A);
  vmPivot.visible = on; if (armR) { armR.visible = on; armL.visible = on && ((cur !== 'knife' && !isNade(cur)) || A > 0.02); }
  vmBomb.visible = on && A > 0.01;
  vmCutter.visible = vmBomb.visible && actKindFp === 2 && !!(S.me && S.me.k);
  // chargeur jeté : petite chute
  if (dropMag.visible) {
    dropMag.vel.y -= 5 * dt; dropMag.position.addScaledVector(dropMag.vel, dt); dropMag.rotation.x += dt * 5; dropMag.rotation.z += dt * 3;
    if (dropMag.position.y < -0.6 || !on) dropMag.visible = false;
  }
  if (!on || !V) return;
  const w = WEAPONS[cur], inf = V.info, pos = V.pos;
  // balancement de marche, respiration, inertie de la souris
  P.swayX += (clamp(P.mouseX * 0.00028, -0.05, 0.05) - P.swayX) * Math.min(1, 9 * dt);
  P.swayY += (clamp(P.mouseY * 0.00028, -0.04, 0.04) - P.swayY) * Math.min(1, 9 * dt);
  P.mouseX = 0; P.mouseY = 0;
  const spd = Math.hypot(P.vx, P.vz), mv = Math.min(1, spd / 5), a = 1 - adsT * 0.86;
  const bx = Math.sin(P.bob * 0.5) * 0.006 * mv * a * cfg.bob, by = Math.abs(Math.sin(P.bob * 0.5)) * 0.006 * mv * a * cfg.bob;
  const br = Math.sin(now * 1.3) * 0.0016 * a;
  const ax = pos.p[0] + (-inf.sight.x - pos.p[0]) * adsT, ay = pos.p[1] + (-inf.sight.y - pos.p[1]) * adsT, az = pos.p[2] + (-pos.ads - inf.sight.z - pos.p[2]) * adsT;
  const swp = swapT > 0 ? swapT / 0.42 : 0, swe = swp * swp;
  let rx = 0, rz = 0, ry = 0, ox = 0, oy = 0, oz = 0, magY = 0, magVis = true, lhy = 0, hk = 0, pf = 0;
  V.pump.position.z = 0; V.slide.position.z = 0;
  if (reloading) {
    const T = clamp(1 - (rlEnd - now) / Math.max(0.1, rlDur), 0, 1);
    const inn = Math.min(1, T / 0.14), oun = Math.min(1, (1 - T) / 0.14), e = inn * oun * (2 - inn * oun) * 1;
    if (w.shell) {
      rx = 0.28 * e; rz = -0.32 * e; oy = -0.03 * e; hk = e;
      const q = (T * 7) % 1; lhy = -0.05 - Math.sin(q * 3.14) * 0.09;
    } else {
      // l'arme monte vers le centre et s'incline : on voit le puits de chargeur et la main qui travaille
      rx = 0.38 * e; rz = -0.5 * e; ry = 0.34 * e; oy = 0.055 * e; ox = -0.075 * e; oz = 0.02 * e;
      if (T > 0.16 && T < 0.34) magY = -((T - 0.16) / 0.18) * 0.34;
      else if (T >= 0.34 && T < 0.52) magVis = false;
      else if (T >= 0.52 && T < 0.7) magY = -(1 - (T - 0.52) / 0.18) * 0.3;
      hk = clamp(Math.min(T / 0.14, (0.86 - T) / 0.1), 0, 1);
      // la main jette le chargeur, va chercher le suivant à la ceinture et le remonte
      if (T >= 0.34 && T < 0.52) pf = sstep((T - 0.34) / 0.08) * (1 - sstep((T - 0.45) / 0.07));
      if (T > 0.7 && T < 0.82) { const q = Math.sin((T - 0.7) / 0.12 * Math.PI); rx += 0.07 * q; oy -= 0.012 * q; }   // il claque le chargeur
      if (T >= 0.34 && !rlDropped) { rlDropped = true; rlDropNow = true; }
      if (rlStage === 0 && T > 0.16) { rlStage = 1; Snd.part('out'); }
      if (rlStage === 1 && T > 0.66) { rlStage = 2; Snd.part('in'); }
      if (rlEmpty && rlStage === 2 && T > 0.8) { rlStage = 3; Snd.part('bolt'); }
      if (rlEmpty && T > 0.8) { V.slide.position.z = Math.sin((T - 0.8) / 0.2 * 3.14) * 0.07; rx += 0.08 * Math.sin((T - 0.8) / 0.2 * 3.14); }
    }
  }
  if (boltT > 0) {
    boltT = Math.max(0, boltT - dt / 0.85);
    const q = Math.sin((1 - boltT) * 3.14);
    if (w.bolt) { V.slide.position.z = q * 0.11; rz = -0.14 * q; rx += 0.08 * q; }
    if (w.pump) { V.pump.position.z = q * 0.1; rx += 0.05 * q; }
  }
  if (cur === 'knife') { rx -= slash01 * 1.1; ry = 0.6 * slash01; oz = -slash01 * 0.14; ox = -slash01 * 0.1; slash01 *= Math.exp(-9 * dt); }
  // grenade : le bras recule (goupille tirée), puis part vers l'avant ; la grenade quitte la main à 0,22 s
  if (isNade(cur) && thrT >= 0) {
    if (thrT < 0.22) { const u = sstep(thrT / 0.22); rx += 0.55 * u; oz += 0.14 * u; oy += 0.05 * u; ox += 0.04 * u; }
    else { const u = Math.min(1, (thrT - 0.22) / 0.28), e = 1 - (1 - u) * (1 - u); rx += 0.55 - 1.2 * e; oz += 0.14 - 0.4 * e; oy += 0.05 - 0.1 * e; ox += 0.04 - 0.04 * e; }
  }
  if (V.flame) V.flame.scale.set(1 + Math.sin(now * 31) * 0.12, 1.6 + Math.sin(now * 23) * 0.3, 1);
  vmSlide *= Math.exp(-26 * dt);
  if (w.cls === 'pistol' && !w.bolt) V.slide.position.z += vmSlide * 0.03 + (ammo[cur] && ammo[cur].mag === 0 ? 0.03 : 0);
  // pose / désamorçage : l'arme descend et bascule hors du champ, les deux mains passent sur la bombe
  oy -= 0.5 * ease; rx += 0.9 * ease; ox -= 0.05 * ease;
  V.group.visible = ease < 0.92 && !(isNade(cur) && thrT >= 0.22);
  vmPivot.position.set(ax + bx + ox + P.swayX * 0.6 - P.roll * 0.3, ay + by + br + oy - swe * 0.3 - P.dip * 0.5 + P.swayY * 0.4, az + oz + vmKick * 0.042);
  vmPivot.rotation.set(rx + vmKick * 0.06 * (1 - adsT * 0.6) + swe * 0.9 + P.swayY * 0.9, ry + P.swayX * 1.3, rz + P.swayX * 0.8 - P.roll * 1.6);
  V.mag.position.y = magY; V.mag.visible = magVis;
  vmPivot.updateMatrixWorld(true);
  // la bombe monte du bas de l'écran, clavier incliné vers le joueur
  if (A > 0.01) {
    const t = actTFp, pg = S.me ? S.me.pg : 0;
    vmBomb.position.set(0.0, -0.58 + 0.42 * ease, -0.56 + 0.02 * Math.sin(t * 3) * ease);
    vmBomb.rotation.set(0.95 + (actKindFp === 1 ? Math.sin(t * 9) * 0.01 : 0), 0.04 * Math.sin(t * 2), 0);
    vmBomb.updateMatrixWorld(true);
    if (actKindFp === 1) {            // pose : la main droite tape le code, la gauche tient le boîtier
      _bR.set(0.02, 0.125 + Math.abs(Math.sin(t * 9)) * 0.03, 0.0); _bL.set(-0.17, 0.07, 0.03);
    } else {                          // désamorçage : la gauche tape, la droite travaille sur les fils
      _bR.set(0.095 + Math.sin(t * 6) * 0.01, 0.15 + (S.me && S.me.k ? 0 : Math.abs(Math.sin(t * 7)) * 0.02), 0.05);
      _bL.set(-0.02, 0.125 + Math.abs(Math.sin(t * 9 + 1.6)) * 0.03, 0.0);
    }
    vmBomb.localToWorld(_bR); vmBomb.localToWorld(_bL);
    // chaque pression du doigt = un bip
    const n = Math.floor((t * 9 + (actKindFp === 1 ? 0 : 1.6)) / Math.PI);
    if (n !== tapN) { tapN = n; if (actTFp > 0.05) Snd.keypad(); }
    // LED qui clignote de plus en plus vite
    vmBomb.userData.led.material.color.setRGB(Math.sin(now * (6 + 16 * pg)) > 0 ? 12 : 0.16, 0.02, 0.02);
    if (vmCutter.visible) {           // pince du kit : s'ouvre et se ferme
      const open = 0.05 + 0.2 * Math.max(0, Math.sin(t * 8));
      vmCutter.jaw[0].rotation.y = open; vmCutter.jaw[1].rotation.y = -open;
      vmCutter.position.copy(_bR).add(_pw.set(0.0, 0.025, -0.05)); vmCutter.rotation.set(0.5, 0, 0); vmCutter.scale.setScalar(1.7);
      const sn = Math.floor(t * 8 / (2 * Math.PI) + 0.25);
      if (sn !== snipN) { snipN = sn; if (actTFp > 0.1) Snd.snip(); }
    }
  }
  // mains sur l'arme
  V.group.localToWorld(_h.copy(inf.handR));
  if (A > 0.01) _h.lerp(_bR, ease);
  armR.position.copy(_h); armR.lookAt(_e.fromArray(pos.elR).setX(pos.elR[0] * (1 - adsT * 0.5)));
  armR.updateMatrixWorld(true);
  if (armL.visible) {
    V.group.localToWorld(_h.copy(inf.handL));
    if (hk > 0) {
      V.group.localToWorld(_h2.set(0, -0.11 + magY * 0.9 + lhy * 0.5, inf.class === 'pistol' ? 0.05 : -0.08));
      if (pf > 0) _h2.lerp(V.group.localToWorld(_pw.set(-0.2, -0.5, 0.05)), pf);
      _h.lerp(_h2, hk * 0.95);
    }
    if (V.pump.position.z) _h.z += V.pump.position.z;
    if (A > 0.01) _h.lerp(_bL, ease);
    if (rlDropNow) {                  // le chargeur usagé tombe de la main
      rlDropNow = false; dropMag.visible = true; dropMag.position.copy(_h); dropMag.rotation.set(0, 0, 0); dropMag.vel.set(-0.25, 0.05, 0.1);
      Snd.magdrop();
    }
    armL.position.copy(_h); armL.lookAt(_e.fromArray(pos.elL).setX(pos.elL[0] * (1 - adsT * 0.3)));
  }
}

// grenades possédées (le serveur envoie me.g ; nloc évite un 2e lancer avant sa mise à jour)
function nHave(k) {
  const m = S.me; let n = m && m.g ? (m.g[k] | 0) : 0;
  const l = nloc[k]; if (l && performance.now() / 1000 < l[1]) n = Math.min(n, l[0]);
  return n;
}
function ownedAll() { const o = owned(); NADES.forEach((k) => { if (nHave(k) > 0) o.splice(o.length - 1, 0, k); }); return o; }
function selectNade(k) { if (nHave(k) > 0) selectWeapon(k); }
function cycleNade() {
  const list = NADES.filter((k) => nHave(k) > 0); if (!list.length) return;
  selectWeapon(list[(list.indexOf(cur) + 1) % list.length]);
}
function full(id) { const w = WEAPONS[id]; return { mag: w.mag, res: w.res }; }
function owned() { const m = S.me; return m ? [m.p, m.s, 'knife'].filter(Boolean) : ['knife']; }
function selectWeapon(id) {
  if (!id || id === cur || !ownedAll().includes(id) || !alive() || thrT >= 0) return;
  if (!isNade(cur)) prevGun = cur;
  lastCur = cur; cur = id; thrT = -1;
  reloading = false; scoped = false; fireLatch = false;
  swapT = 0.42; nextShot = performance.now() / 1000 + (WEAPONS[id].slot === 1 ? 0.62 : 0.42);
  buildVM(cur);
}
function selectBest() {
  const m = S.me; const id = (m && (m.p || m.s)) || 'knife';
  cur = id; reloading = false; scoped = false; swapT = 0.42; nextShot = performance.now() / 1000 + 0.45; thrT = -1;
  buildVM(cur);
}
function refillAmmo() { ammo = { knife: { mag: 0, res: 0 } }; owned().forEach((id) => { if (id !== 'knife') ammo[id] = full(id); }); }

function ammoMsg() { const a = ammo[cur]; return a ? [a.mag, a.res] : undefined; }
function dropCurrent() {
  if (!alive() || cur === 'knife' || isNade(cur)) return;
  send({ type: 'drop', am: ammoMsg() });
  Snd.part('out');
}

function reload() {
  const w = WEAPONS[cur], a = ammo[cur];
  if (!a || !w.mag || reloading || a.mag >= w.mag || a.res <= 0 || actFp > 0.2) return;
  const now = performance.now() / 1000;
  reloading = true; scoped = false; rlStage = 0; rlEmpty = a.mag === 0; rlDropped = false;
  if (w.shell) { // une cartouche à la fois : on peut tirer pour interrompre
    const n = Math.min(w.mag - a.mag, a.res);
    rlDur = 0.3 + n * 0.5; rlNext = now + 0.45;
  } else rlDur = w.rl * (rlEmpty ? 1.15 : 1); // chargeur vide : il faut aussi réarmer
  rlEnd = now + rlDur;
}

function eyeHeight() { return CFG.eye + (CFG.eyeCrouch - CFG.eye) * P.crouch; }

/* ============================================================
   Tir
   ============================================================ */
const rc = new THREE.Raycaster();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
function enemyMeshes() {
  const out = [];
  remotes.forEach((r) => { if (r.alive && r.team && r.team !== myTeam) r.hit.forEach((m) => out.push(m)); });
  // entraînement : mannequins et cibles du stand de tir
  dummies.forEach((d) => { if (d.hp > 0) d.rig.hits.forEach((m) => out.push(m)); });
  tgts.forEach((t) => { if (!t.hit && t.st !== 'fall') out.push(t.plate); });
  return out;
}
function worldNormal(h) {
  return h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
}
// sol sous le joueur : bruit de pas
function surfaceAt(x, z, y) {
  if (y > 0.2) for (const b of BOXES) {
    if (Math.abs(b.h - y) < 0.3 && Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3) return b.t === 'w' ? 'stone' : b.t ? 'metal' : b.h <= 2.7 ? 'wood' : 'stone';
  }
  if ((MAP.style || MAP.id) === 'dust') { for (const k in SITES) if (Math.abs(x - SITES[k].x) < SITES[k].r + 1.6 && Math.abs(z - SITES[k].z) < SITES[k].r + 1.6) return 'stone'; return 'sand'; }
  return 'stone';
}

function canShoot() {
  return alive() && locked && !ui.buy && !ui.chat && actFp < 0.2 && (S.ph === 'live' || S.ph === 'end');
}

// dispersion instantanée (radians) selon le mouvement, la position et la rafale
function spreadNow(w) {
  const spd = Math.hypot(P.vx, P.vz), m = spd / 6;
  const fam = { pistol: 0.032, smg: 0.04, shotgun: 0.03, rifle: 0.075, sniper: 0.09, knife: 0 }[w.cls] || 0.05;
  let sp = w.spread + m * m * fam + (spd < 1.5 ? 0 : 0.002) + (P.ground ? 0 : 0.09) + P.landT * 0.05 + P.burst * P.burst * 0.00014;
  if (P.crouch > 0.5) sp *= 0.65;
  if (aiming) sp *= 0.5;
  if (w.scope) sp = scoped ? 0.0004 + m * 0.06 + (P.ground ? 0 : 0.08) : (cur === 'awp' ? 0.08 : 0.05);
  return sp;
}
function fire() {
  const w = WEAPONS[cur], a = ammo[cur], now = performance.now() / 1000;
  if (now < nextShot || swapT > 0.05) return false;
  if (isNade(cur)) return throwNade(false);
  if (jammed(cur)) { nextShot = now + 0.35; fireLatch = false; Snd.click(); return false; }   // arme bloquée par le désordre
  if (reloading) {
    if (w.shell && a && a.mag > 0) { reloading = false; nextShot = now + 0.12; } // on interrompt le rechargement
    return false;
  }
  if (cur === 'knife') return slash(now, w);
  if (!a) return false;
  if (a.mag <= 0) { nextShot = now + 0.3; Snd.click(); fireLatch = false; if (a.res > 0) reload(); return false; }
  if (!(isSandbox() && PR.infMag)) a.mag--;   // zone de test : chargeur infini
  nextShot = now + w.rof;
  fireLatch = false;
  lastShot = now;
  if (RG.on && RG.cd <= 0 && isRange()) RG.shots++;

  cam.updateMatrixWorld(true);
  const org = cam.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const sp = spreadNow(w);
  const targets = worldMeshes.concat(enemyMeshes());
  const pellets = w.pellets || 1;
  const hits = {}, tHits = {};
  let firstEnd = null, firstN = null, firstS = '';
  const muzzle = org.clone().addScaledVector(fwd, 0.55).addScaledVector(rt, scoped ? 0 : 0.13 * (1 - adsT)).addScaledVector(up, -0.09);
  for (let i = 0; i < pellets; i++) {
    const a0 = Math.random() * 6.283, r0 = sp * (w.pellets ? Math.sqrt(Math.random()) : Math.random() * Math.sqrt(Math.random()) * 1.4);
    const dir = fwd.clone().addScaledVector(rt, Math.cos(a0) * r0).addScaledVector(up, Math.sin(a0) * r0).normalize();
    rc.set(org, dir); rc.far = w.range;
    const list = rc.intersectObjects(targets, false);
    let pen = 0, end = null, nor = null, sur = '';
    for (const h of list) {
      const d = h.object.userData;
      if (d.tgt) {   // cible du stand de tir (une balle qui passe à côté de la silhouette continue sa route)
        const res = rangeHitTest(d.tgt, h); if (!res) continue;
        const prev = tHits[d.tgt]; if (!prev || better(res, prev.res)) tHits[d.tgt] = { res, pt: h.point.clone() };
        end = h.point.clone(); nor = dir.clone().negate(); sur = '';
        break;
      }
      if (d.pid) {
        const e = hits[d.pid] || (hits[d.pid] = { z: {}, p: 0, hs: false, pt: h.point.clone() });
        e.z[d.zone] = (e.z[d.zone] || 0) + 1; e.p = Math.max(e.p, pen); if (d.zone === 'h') e.hs = true;
        const back = dir.clone().negate();
        fx.blood(h.point, back, 9);
        // éclaboussure sur le mur derrière
        rc.set(h.point, dir); rc.far = 3;
        const bh = rc.intersectObjects(worldMeshes, false)[0];
        if (bh && !w.pellets) fx.bloodDecal(bh.point, worldNormal(bh), 0.5 + Math.random() * 0.5);
        end = h.point.clone(); nor = back; sur = 'blood';
        break;
      }
      const n = worldNormal(h);
      if (!nor) { nor = n; sur = d.mat; }
      impact(h.point, n, d.mat, i === 0);
      end = h.point.clone();
      if (d.pen && w.pen >= d.pen && pen < 2) { pen++; continue; } // la balle traverse
      break;
    }
    if (!end) end = org.clone().addScaledVector(dir, 90);
    if (i === 0) { firstEnd = end.clone(); firstN = nor; firstS = sur; }
    if ((tracerN++ % 3 === 0) || w.pellets) fx.tracer(muzzle, end);
  }
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [firstEnd.x, firstEnd.y, firstEnd.z], n: firstN ? [firstN.x, firstN.y, firstN.z] : null, s: firstS });
  Object.keys(tHits).forEach((id) => scoreTarget(tHits[id].res, tHits[id].pt));
  Object.keys(hits).forEach((pid) => {
    const e = hits[pid], dm = dummies.get(pid);
    if (dm) { const dist = Math.hypot(P.x - dm.g.position.x, P.z - dm.g.position.z); hurtDummy(dm, calcDamage(w, dist, e.p, e.z, dm.armor, dm.helmet), e.pt, cur, dist, e.p); }
    else send({ type: 'hit', t: +pid, z: e.z, p: e.p });
    hitMark(e.hs);
  });
  Snd.shot(cur, 1, 0, { wet: 0.5 });

  // recul : suit un motif (monte, puis dérive de chaque côté)
  const n = P.burst, k = (w.scope && scoped ? 0.45 : 1) * (aiming ? 0.8 : 1) * (P.crouch > 0.5 ? 0.85 : 1);
  const rise = n < 8 ? 1 : n < 16 ? 0.45 : 0.2;
  P.recP += w.rec * rise * k * (0.95 + Math.random() * 0.2);
  const drift = n > 5 ? Math.sin(n * 0.5 + recSeed) * w.rec * 0.9 : (Math.random() - 0.5) * w.rec * 0.35;
  P.recY += drift * k;
  P.burst = Math.min(30, P.burst + 1);
  if (w.cls === 'shotgun') P.recP += 0.01;
  vmKick = Math.min(1.1, vmKick + (w.slot === 1 ? 0.6 : 0.5) * (w.bolt ? 1.6 : 1)); vmSlide = 1;
  if (vmFlash && !w.sup) { vmFlash.visible = true; vmFlash.rotation.z = Math.random() * 6; const s = 0.7 + Math.random() * 0.6; vmFlash.scale.setScalar(s * (w.pellets ? 1.5 : 1)); flashT = 0.04; }
  if (!w.sup) { fx.flash(muzzle, 1); fx.smoke(muzzle, [0.5, 0.5, 0.5], 1, 0.5, 0.26, 0.5); }
  // douille
  const ej = () => {
    if (!alive()) return;
    const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), r2 = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const p = cam.position.clone().addScaledVector(f2, 0.34).addScaledVector(r2, 0.2); p.y -= 0.1;
    fx.casing(p, r2.clone().multiplyScalar(2 + Math.random()).add(new THREE.Vector3(P.vx, 1.6 + Math.random(), P.vz)));
  };
  if (w.bolt || w.pump) setTimeout(() => { if (cur === lastBolt) { boltT = 1; Snd.part(w.bolt ? 'bolt' : 'pump'); setTimeout(ej, 280); } }, 220), lastBolt = cur;
  else ej();
  if (w.scope) { scoped = false; }
  if (a.mag <= 0 && a.res > 0) setTimeout(() => { if (alive() && ammo[cur] && ammo[cur].mag <= 0) reload(); }, w.scope ? 900 : 260);
  return true;
}
let flashT = 0, lastShot = 0, tracerN = 0, recSeed = 0, lastBolt = '';

function slash(now, w) {
  nextShot = now + w.rof; fireLatch = false;
  cam.updateMatrixWorld(true);
  const org = cam.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  rc.set(org, fwd); rc.far = w.range;
  const h = rc.intersectObjects(worldMeshes.concat(enemyMeshes()), false)[0];
  slash01 = 1;
  Snd.knife(1);
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [org.x + fwd.x * 0.5, org.y + fwd.y * 0.5, org.z + fwd.z * 0.5] });
  if (h && h.object.userData.pid) {
    const zone = h.object.userData.zone, z = { [zone === 'h' ? 'c' : zone]: 1 }, dm = dummies.get(h.object.userData.pid);
    if (dm) hurtDummy(dm, calcDamage(w, h.distance, 0, z, dm.armor, dm.helmet), h.point, 'knife', h.distance, 0);
    else send({ type: 'hit', t: h.object.userData.pid, z, p: 0 });
    fx.blood(h.point, fwd.clone().negate(), 10); hitMark(false);
  } else if (h && h.object.userData.tgt) { const res = rangeHitTest(h.object.userData.tgt, h); if (res) scoreTarget(res, h.point); }
  else if (h) impact(h.point, worldNormal(h), h.object.userData.mat, true);
  return true;
}

/* ---------- lancer d'une grenade : clic gauche = loin, clic droit = court ---------- */
function throwNade(soft) {
  fireLatch = false;
  if (thrT >= 0 || !canShoot() || S.ph !== 'live' || !isNade(cur) || nHave(cur) <= 0 || swapT > 0.05) return false;
  thrT = 0; thrSoft = soft; thrSent = false; scoped = false; reloading = false;
  Snd.pin();
  return true;
}
function releaseNade() {
  thrSent = true;
  cam.updateMatrixWorld(true);
  const f = _v3.set(0, 0, -1).applyQuaternion(cam.quaternion);
  if (!(isSandbox() && PR.infNades)) nloc[cur] = [nHave(cur) - 1, performance.now() / 1000 + 1.2];
  Snd.throwN(0.8);
  send({ type: 'throw', k: cur, d: [+f.x.toFixed(3), +f.y.toFixed(3), +f.z.toFixed(3)], s: thrSoft ? 1 : 0, v: [+P.vx.toFixed(2), +P.vz.toFixed(2)] });
}
function afterThrow() {
  thrT = -1;
  if (!alive()) return;
  if (nHave(cur) > 0) { swapT = 0.42; nextShot = performance.now() / 1000 + 0.3; buildVM(cur); }   // il en reste : on en sort une autre
  else if (prevGun !== cur && ownedAll().includes(prevGun)) selectWeapon(prevGun);
  else selectBest();
}

function hitMark(hs) {
  if (cfg.hitmarker) { const el = $('hitm'); el.className = hs ? 'hs' : ''; el.style.opacity = '1'; hitTimer = 0.14; }
  if (cfg.hitSound) Snd.hit(hs);
}

/* ============================================================
   Réseau
   ============================================================ */
function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  $('err').textContent = '';
  try { ws = new WebSocket(url); } catch (e) { $('err').textContent = 'Connexion impossible.'; return; }
  ws.onopen = () => send({ type: 'join', name: joinInfo.name, room: joinInfo.room, team: joinInfo.team, map: joinInfo.map, mode: joinInfo.mode, lobby: joinInfo.lobby ? 1 : 0, tok: Account.token() || '' });
  let hold = null;   // carte perso inconnue : on la télécharge avant de traiter les messages
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (hold) { hold.push(m); return; }
    if (m.type === 'welcome' && !MAPS[m.map]) {
      hold = [m];
      loadCustom(m.map).then(() => { const q = hold; hold = null; q.forEach(onMsg); });
      return;
    }
    onMsg(m);
  };
  ws.onclose = () => {
    if (connected) { connected = false; leaveToMenu('Connexion au serveur perdue.'); }
    else if (!$('err').textContent) $('err').textContent = 'Connexion impossible. Le serveur est-il lancé ?';
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function leaveToMenu(text) {
  connected = false; S.me = null; S.lb = 0; lbSig = '';
  $('lobby').classList.add('hide');
  remotes.forEach((r, id) => removeRemote(id));
  syncDrops([]); clearNades(); resetNadeState(); clearPractice(); closePanel(true); S.pm = '';
  ui.map = false; $('bigmap').classList.add('hide');
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('err').textContent = text || '';
  $('play').disabled = false;
  closeBuy(true);
}

function onMsg(m) {
  switch (m.type) {
    case 'welcome':
      myId = m.id; myTeam = null; connected = true; S.me = null; S.pm = m.pm || ''; setMap(m.map); ammo = {}; cur = 'glock'; lastInv = { p: null, s: null };
      clearPractice(); PR.hintT = 10;
      if (S.pm === 'sandbox') sendOpts();
      clearNades(); resetNadeState();
      tpSeq = 0; S.hf = undefined;
      $('play').disabled = false;
      buildVM(cur);
      S.lb = joinInfo.lobby ? 1 : 0; S.ph = 'wait';
      if (!joinInfo.lobby) tryLock();
      break;
    case 'err':
      if (connected) { connected = false; leaveToMenu(m.text); }
      else { $('err').textContent = m.text; $('play').disabled = false; }
      try { ws.close(); } catch (e) {}
      break;
    case 'am': if (ammo[m.w] && !reloading) { ammo[m.w].mag = m.mag | 0; ammo[m.w].res = m.res | 0; } break;
    case 'snap': onSnap(m); break;
    case 'spawn':
      P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.yaw = m.yaw; P.pitch = 0; P.recP = P.recY = 0; P.burst = 0; P.tag = 0; P.landT = 0; P.stam = 1;
      if (m.s != null) tpSeq = m.s;
      needRefill = true; scoped = false; reloading = false; crouchTog = false; specId = null; fx.clear(); resetNadeState();
      if (S.pm === 'sandbox') PR.hintT = Math.max(PR.hintT, 6);
      break;
    case 'shoot': onRemoteShot(m); break;
    case 'kill': onKill(m); break;
    case 'hitc': if (m.kill && cfg.hitSound) Snd.kill(); if (m.ab && !m.kill) notice('Gilet adverse détruit', '#9cc4ff'); break;
    case 'bpx': bpXp(m.x); break;
    case 'bp': bpUnlock(m.t, m.sk); break;
    case 'ms': msUp(m.w, m.lv, m.sk); break;
    case 'got': gotAmmo[m.w] = { mag: m.mag, res: m.res }; if (m.sel) pickSel = m.w; Snd.part('in'); break;
    case 'hurt': onHurt(m); break;
    case 'msg': notice(m.text, m.kind === 'err' ? '#ff7b6e' : m.kind === 'bomb' ? '#ff9a3c' : '#ffd65a'); break;
    case 'chat': addChat(m); break;
    case 'rstart': onRoundStart(m); break;
    case 'rend': onRoundEnd(m); break;
    case 'leave': removeRemote(m.id); break;
    case 'shift': warpWarn = m.t || 3; Snd.warn(); notice('⚠ DÉSORDRE DANS 3 SECONDES…', DZ); break;
    case 'tp': onTeleport(m); break;
    case 'chaos': onChaos(m); break;
    case 'throw': onThrowMsg(m); break;
    case 'gev': nadePop(m); break;
    case 'blind': startBlind(+m.w || 0, +m.t || 0); break;
  }
}

function onSnap(m) {
  const prev = S.me, pb = S.b.s;
  const wasLobby = inLobby();
  S.lb = m.lb ? 1 : 0; S.ho = m.ho || 0; S.lc = m.lc || 0;
  S.ph = m.ph; S.te = m.te; S.rd = m.rd; S.sc = m.sc; S.b = m.b; S.recv = performance.now();
  if (m.mp && m.mp !== MAP.id) { if (MAPS[m.mp]) setMap(m.mp); else loadCustom(m.mp); }   // carte perso : la suivante une fois chargée
  S.md = m.md ? 1 : 0; S.jm = m.jm || 0; S.iv = m.iv || 0; S.pm = m.pm || '';
  // première arrivée au stand de tir : on ouvre le choix de la difficulté
  if (S.pm === 'range' && PR.shown !== joinInfo.room && m.me && m.me.al) { PR.shown = joinInfo.room; setTimeout(openPanel, 400); }
  if (m.hb) applyHidden(m.hb, !!prev);
  if (m.dp) syncDrops(m.dp);
  syncFlying(m.gr || []); syncZones(m.zn || []);
  const oldTeam = myTeam;
  S.me = m.me; myTeam = m.me.t;
  const lob = inLobby();
  // mi-temps (un changement de camp peut aussi venir d'un transfuge : on se fie au numéro de manche)
  if (!lob && S.hf === 0 && m.hf === 1) {
    banner('MI-TEMPS', '#ffffff', 'Tu joues maintenant ' + teamName(myTeam) + ' · ton score te suit', 4000);
  }
  S.hf = m.hf;
  S.pl = new Map();
  const seen = new Set();
  for (const e of m.pl) {
    S.pl.set(e.i, e); S.names.set(e.i, { n: e.n, t: e.t });
    if (e.i === myId || lob) continue;
    seen.add(e.i);
    let r = remotes.get(e.i);
    if (!r) { r = makeRemote(e); remotes.set(e.i, r); }
    r.e = e; r.alive = !!e.a;
    if (r.team !== e.t && e.t) setRemoteTeam(r, e.t);
    if (!r.rig) continue;
    if (r.w !== e.w || r.sk !== (e.sk || '')) setRemoteGun(r, e.w, e.sk);
    r.tp.set(e.x, e.y, e.z); r.tyaw = e.r;
    if (!r.init) { r.g.position.copy(r.tp); r.g.rotation.y = e.r; r.init = true; }
  }
  remotes.forEach((r, id) => { if (!seen.has(id)) removeRemote(id); });

  if (lob) { if (document.pointerLockElement) document.exitPointerLock(); renderLobby(m); }
  else if (wasLobby) { $('lobby').classList.add('hide'); lbSig = ''; tryLock(); }
  if (pb !== 'planted' && m.b.s === 'planted') Snd.plant();
  if (pb === 'planted' && m.b.s === 'exploded') explosionFx();
  if (pb === 'planted' && m.b.s === 'defused') Snd.defused();
  if (pb !== 'planted' && m.b.s === 'planted') nextBeep = 0;

  const me = m.me;
  if (prev && prev.al && !me.al) { scoped = false; reloading = false; P.shake = Math.max(P.shake, 0.4); }
  if (oldTeam && myTeam && oldTeam !== myTeam) buildVM(cur);
  if (needRefill) { refillAmmo(); needRefill = false; selectBest(); }
  else {
    const given = (id) => { const g = gotAmmo[id]; delete gotAmmo[id]; return g || full(id); };
    if (me.p && me.p !== lastInv.p) { ammo[me.p] = given(me.p); selectWeapon(me.p); }
    if (me.s && me.s !== lastInv.s) { ammo[me.s] = given(me.s); if (!me.p || cur === lastInv.s) selectWeapon(me.s); }
    // échange contre le même modèle : l'inventaire ne change pas, seulement les munitions
    Object.keys(gotAmmo).forEach((id) => { if (owned().includes(id)) { ammo[id] = given(id); if (id === cur) reloading = false; } });
    if (pickSel) { selectWeapon(pickSel); pickSel = null; }           // prise avec E : l'arme passe en main
    if (me.al && thrT < 0 && !ownedAll().includes(cur)) selectBest();
  }
  lastInv = { p: me.p, s: me.s };
}

/* ---------- armes au sol ---------- */
const drops = new Map();
const gotAmmo = {};
let pickSel = null;
function syncDrops(list) {
  const seen = new Set();
  list.forEach((d) => {
    seen.add(d.i);
    let e = drops.get(d.i);
    if (!e) {
      const g = Models.gunTP(d.w);
      g.traverse((o) => { o.receiveShadow = true; });
      g.rotation.set(0, d.r, Math.PI / 2);          // couchée sur le flanc
      scene.add(g);
      e = { d, g, t: d.n ? 0 : 1 };
      drops.set(d.i, e);
    }
    e.d = d;
  });
  drops.forEach((e, id) => { if (!seen.has(id)) { scene.remove(e.g); drops.delete(id); } });
}
function updateDrops(dt) {
  drops.forEach((e) => {
    const d = e.d, was = e.t;
    e.t = Math.min(1, e.t + dt / 0.38);
    const t = e.t, y0 = d.oy + 1.05;
    e.g.position.set(d.ox + (d.x - d.ox) * t, y0 + (d.y - y0) * t * t + 0.9 * t * (1 - t) + 0.035, d.oz + (d.z - d.oz) * t);
    if (t < 1) e.g.rotation.x = (1 - t) * 3.2;
    else if (was < 1) { e.g.rotation.x = 0; const sp = spatial(d.x, d.y, d.z); if (sp.d < 30) Snd.impact('metal', sp.v * 0.8, sp.pan, sp); }
  });
}
function nearestDrop() {
  let best = null, bd = CFG.pickRange;
  drops.forEach((e) => {
    const n = Math.hypot(P.x - e.d.x, P.z - e.d.z);
    if (n <= bd && Math.abs(P.y - e.d.y) < 1.5) { bd = n; best = e.d; }
  });
  return best;
}

function onRemoteShot(m) {
  const r = remotes.get(m.id), W = WEAPONS[m.w];
  const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]), e = new THREE.Vector3(m.e[0], m.e[1], m.e[2]);
  const sp = spatial(o.x, o.y, o.z);
  if (m.w === 'knife') { Snd.knife(sp.v); return; }
  Snd.shot(m.w, sp.v, sp.pan, sp);
  const muz = r && r.rig && r.rig.gun ? r.rig.muzzle(new THREE.Vector3()) : o;
  if (r && r.rig) r.rig.kick = 1;
  if (W && !W.sup) {
    fx.flash(muz, 1); fx.smoke(muz, [0.5, 0.5, 0.5], 1, 0.5, 0.3, 0.5);
    fx.emit({ add: 1, x: muz.x, y: muz.y, z: muz.z, vx: 0, vy: 0, vz: 0, g: 0, dr: 0, life: 0.05, s0: 0.5, s1: 0.32, c: [7, 4.2, 1.6], a: 1 });
    if (remoteTr++ % 3 === 0) fx.tracer(muz, e);
  }
  // impact visible par tout le monde
  if (m.s && m.n) {
    const n = new THREE.Vector3(m.n[0], m.n[1], m.n[2]);
    if (m.s === 'blood') fx.blood(e, n, 9); else impact(e, n, m.s, true);
  }
  // balle qui frôle : sifflement
  const dir = _v1.subVectors(e, o), L = dir.length(); dir.divideScalar(L || 1);
  const me = _v2.set(P.x, P.y + 1.4, P.z).sub(o), t = me.dot(dir);
  if (alive() && t > 3 && t < L + 8) { const miss = me.addScaledVector(dir, -t).length(); if (miss < 2) Snd.whiz(sp.pan); }
}
let remoteTr = 0;

function onKill(m) {
  killAnnounce(m);
  // chute du corps : à l'opposé du tireur
  const vr = remotes.get(m.v);
  if (vr && vr.rig) {
    const kp = m.k === myId ? P : (remotes.get(m.k) ? remotes.get(m.k).g.position : null);
    if (kp) {
      const dx = kp.x - vr.g.position.x, dz = kp.z - vr.g.position.z, y = vr.g.rotation.y;
      const front = -dx * Math.sin(y) - dz * Math.cos(y), side = dx * Math.cos(y) - dz * Math.sin(y);
      vr.rig.deadDir = front >= 0 ? 1 : -1; vr.rig.deadSide = clamp(side / (Math.hypot(dx, dz) || 1), -1, 1);
    } else vr.rig.deadDir = Math.random() < 0.5 ? 1 : -1;
    vr.rig.deadHs = !!m.hs;
    const sp = spatial(vr.g.position.x, 0, vr.g.position.z);
    if (sp.d < 40) setTimeout(() => Snd.thud(sp.v, sp.pan, sp), 420);
  }
  if (m.v === myId) {                 // ma propre chute : du côté opposé au tireur
    const kr = m.k === myId ? null : remotes.get(m.k);
    if (kr) {
      const dx = kr.g.position.x - P.x, dz = kr.g.position.z - P.z, L = Math.hypot(dx, dz) || 1;
      const front = -dx * Math.sin(P.yaw) - dz * Math.cos(P.yaw), side = dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw);
      P.deadDir = front >= 0 ? -1 : 1; P.deadSide = side >= 0 ? -1 : 1; if (Math.abs(side / L) < 0.2) P.deadSide = Math.random() < 0.5 ? 1 : -1;
    } else { P.deadDir = 1; P.deadSide = Math.random() < 0.5 ? 1 : -1; }
    P.deadHs = !!m.hs; P.deadT = 0;
    setTimeout(() => Snd.thud(0.8), 380);
  }
  const k = S.names.get(m.k), v = S.names.get(m.v);
  const row = document.createElement('div');
  if (m.k === myId || m.v === myId) row.className = 'me';
  const add = (txt, cls) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = txt; row.appendChild(s); };
  if (m.w === 'bomb' || !k) { add((v ? v.n : '?'), v ? 't' + v.t : ''); add(' a été soufflé par la bombe'); }
  else {
    add(k.n, 't' + k.t);
    add(' [' + ((WEAPONS[m.w] && WEAPONS[m.w].n) || m.w) + (m.hs ? ' · tête' : '') + '] ');
    add(v ? v.n : '?', v ? 't' + v.t : '');
  }
  const feed = $('feed'); feed.appendChild(row);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 7000);
}

function onHurt(m) {
  if (m.ab) { notice('TON GILET EST DÉTRUIT', '#ff7b6e'); Snd.impact('metal', 0.9, 0, {}); }
  if (m.fire) {   // brûlure : petit voile rouge, pas de direction
    Snd.hurt(0); const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = '0.45'; hurtT = 0.5; P.shake = Math.max(P.shake, 0.1);
    return;
  }
  Snd.hurt(m.hs);
  const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = String(clamp(0.3 + m.dmg / 60, 0.3, 1));
  hurtT = 0.7; dmgTimer = 1.0;
  P.shake = Math.max(P.shake, clamp(m.dmg / 90, 0.08, 0.45));
  P.tag = CFG.tagTime;                                     // touché : ralenti
  P.recP += clamp(m.dmg / 900, 0.006, 0.05) * (m.hs ? 1.6 : 1); P.recY += (Math.random() - 0.5) * 0.02;   // la visée saute
  const f = _v1.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), r = _v2.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const a = Math.atan2(m.dx * r.x + m.dz * r.z, m.dx * f.x + m.dz * f.z);
  const d = $('dmgdir'); d.style.transform = 'rotate(' + a + 'rad)'; d.firstElementChild.style.opacity = '1';
}
let hurtT = 0;

/* ---------- séries de kills, premier sang, ACE ---------- */
let streakTimer = 0;
function streak(text, sub, color, ace) {
  const e = $('streak'); e.className = ''; void e.offsetWidth;       // relance l'animation
  e.textContent = text; e.style.color = color || '';
  if (sub) { const s = document.createElement('small'); s.textContent = sub; e.appendChild(s); }
  e.className = (ace ? 'ace ' : '') + 'show'; if (!ace) e.style.fontSize = '46px';
  else e.style.fontSize = '';
}
const MULTI = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRUPLE KILL' };
function killAnnounce(m) {
  const k = S.names.get(m.k); if (!k || m.k === m.v) return;
  const col = k.t === 'T' ? '#e0a040' : '#5aa0ff';
  if (m.ace) {
    Snd.ace();
    if (m.k === myId) streak('ACE !', 'Tu as éliminé toute l\'équipe adverse', '', true);
    else streak('ACE', k.n + ' a éliminé toute l\'équipe adverse', col, true);
    notice('★ ACE de ' + k.n + ' ★', '#ffd24a');
    return;
  }
  if (m.fb) {
    if (m.k === myId) { Snd.firstBlood(); streak('PREMIER SANG', '', '#ff5a4a'); }
    else notice('Premier sang : ' + k.n, '#ff8a7a');
  }
  if (m.k === myId && MULTI[m.rk]) { Snd.multi(m.rk); setTimeout(() => streak(MULTI[m.rk], m.rk + ' kills dans la manche', '#ffd24a'), m.fb ? 900 : 0); }
  else if (m.k !== myId && m.rk >= 3) notice(k.n + ' : ' + m.rk + ' kills dans la manche', col);
}

function onRoundStart(m) {
  Snd.roundStart();
  if (m.pm === 'range') banner('STAND DE TIR', '#ffd24a', Settings.key('tools') + ' : difficulté et départ · ' + Settings.key('buy') + ' : armes gratuites', 3000);
  else if (m.pm === 'sandbox') banner('ZONE DE TEST', DZ, Settings.key('tools') + ' : outils de test · ' + Settings.key('buy') + ' : armes gratuites', 3000);
  else banner('MANCHE ' + m.round, '#ffffff', 'Phase d\'achat : appuie sur ' + Settings.key('buy'), 2200);
  fx.clear(); clearNades(); resetNadeState(); closeBuy(true); $('streak').className = '';
}
function onRoundEnd(m) {
  const reasons = { elim: 'Équipe adverse éliminée', bomb: 'La bombe a explosé', defuse: 'Bombe désamorcée', time: 'Temps écoulé' };
  const win = m.w === myTeam;
  banner(teamName(m.w).toUpperCase() + ' GAGNENT', m.w === 'T' ? '#e0a040' : '#5aa0ff', (reasons[m.r] || '') + (m.over ? ' · Fin du match' : ''), 5000);
  if (win) Snd.win(); else Snd.lose();
  if (m.mvp) {
    const t = S.names.get(m.mvp.i), why = m.mvp.h ? (m.r === 'defuse' ? 'a désamorcé la bombe' : 'a posé la bombe') : m.mvp.k + ' kill' + (m.mvp.k > 1 ? 's' : '');
    setTimeout(() => { Snd.mvp(); notice('★ MVP : ' + m.mvp.n + ' (' + why + ')' + (m.mvp.i === myId ? ' ★ C\'est toi !' : ''), '#ffd24a'); }, 900);
  }
}

function banner(text, color, sub, ms) {
  const b = $('banner'); b.textContent = text; b.style.color = color;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; s.style.color = '#fff'; b.appendChild(s); }
  b.style.opacity = '1'; banTimer = ms / 1000;
}
function notice(text, color) { const n = $('notice'); n.textContent = text; n.style.color = color || '#ffd65a'; noticeTimer = 3.5; }

function addChat(m) {
  if (inLobby()) {
    const r = document.createElement('div'), a = document.createElement('span'), b = document.createElement('span');
    a.className = 't' + m.t; a.textContent = m.n + ': '; b.textContent = m.x; r.append(a, b);
    const l = $('lchat'); l.appendChild(r); while (l.children.length > 40) l.removeChild(l.firstChild); l.scrollTop = l.scrollHeight;
    return;
  }
  const row = document.createElement('div');
  const a = document.createElement('span'); a.className = 't' + m.t; a.textContent = m.n + ': ';
  const b = document.createElement('span'); b.textContent = m.x;
  row.append(a, b);
  const log = $('chatlog'); log.appendChild(row);
  while (log.children.length > 6) log.removeChild(log.firstChild);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 9000);
}

/* ============================================================
   Entraînement : stand de tir (cibles) et zone de test (mannequins, outils)
   Le serveur garde la partie ouverte (pas de fin de manche, boutique gratuite, réapparition) ;
   cibles et mannequins n'existent que chez le joueur : touches et dégâts sont calculés ici.
   ============================================================ */
const PR = { god: false, infMag: false, infNades: false, fly: false, dmgNum: true, info: true, dArmor: false, dHelmet: false, dMove: false, hintT: 0, shown: '', lastHit: '' };
try { const sv = JSON.parse(store.get('cs_sandbox', '{}')); if (sv && typeof sv === 'object') Object.keys(sv).forEach((k) => { if (typeof PR[k] === 'boolean' && k !== 'fly') PR[k] = !!sv[k]; }); } catch (e) {}
function savePR() { const o = {}; ['god', 'infMag', 'infNades', 'dmgNum', 'info', 'dArmor', 'dHelmet', 'dMove'].forEach((k) => { o[k] = PR[k]; }); store.set('cs_sandbox', JSON.stringify(o)); }
const practice = () => connected && !!S.pm;
const isRange = () => connected && S.pm === 'range';
const isSandbox = () => connected && S.pm === 'sandbox';
function sendOpts() { if (isSandbox()) send({ type: 'opt', god: PR.god ? 1 : 0, infN: PR.infNades ? 1 : 0 }); }

/* ---------- textes flottants (dégâts, points) : taille constante à l'écran ---------- */
const pops = [];
function popText(pos, text, color, big) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = 'bold ' + (big ? 62 : 50) + 'px Trebuchet MS, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 256, 50); g.fillStyle = color; g.fillText(text, 256, 50);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, toneMapped: false }));
  const d = Math.max(3, Math.hypot(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z));
  const hh = d * 2 * Math.tan(cam.fov * Math.PI / 360) * (big ? 0.062 : 0.048);
  s.scale.set(hh * 512 / 96, hh, 1); s.position.copy(pos); s.renderOrder = 12; scene.add(s);
  pops.push({ s, t: 0, v: hh * 1.3 });
  while (pops.length > 24) dropPop(0);
}
function dropPop(i) { const p = pops[i]; scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); pops.splice(i, 1); }
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt; p.s.position.y += p.v * dt * (1 - p.t);
    p.s.material.opacity = clamp(2.4 * (1 - p.t / 1.15), 0, 1);
    if (p.t >= 1.15) dropPop(i);
  }
}

/* ---------- dégâts calculés comme sur le serveur (zones, distance, obstacles traversés, gilet, casque) ---------- */
const ZONE_N = { h: 'tête', c: 'torse', s: 'ventre', a: 'bras', l: 'jambes' };
function calcDamage(w, dist, pen, z, armor, helmet) {
  let left = w.pellets || 1, dmg = 0, armored = 0, hs = false, zone = '';
  const base = w.dmg * Math.pow(w.fall, dist / 25) * Math.pow(CFG.penLoss, pen);
  ['h', 'c', 's', 'a', 'l'].forEach((k) => {
    const n = Math.min(left, z[k] | 0); if (!n) return;
    left -= n;
    let d = base * n * (k === 'h' ? w.hs : CS.ZONES[k]);
    if (k === 'h' && !w.pellets) hs = true;
    if (!zone) zone = k;
    if (k === 'h' && helmet) { armored += d; d *= 1 - (1 - CFG.armorHead) * (1 - w.ap); }
    else if (k !== 'h' && k !== 'l' && armor > 0) { armored += d; const r = CS.armorHit(d, armor, 1 - (1 - CFG.armorBody) * (1 - w.ap)); d = r.d; armor = r.armor; }
    dmg += d;
  });
  return { dmg: Math.round(dmg), armored, hs, zone, armor };
}

/* ---------- mannequins (zone de test) ---------- */
const dummies = new Map();
let dumN = 0;
function dummyLabel(d) {
  if (d.lbl) { d.g.remove(d.lbl); d.lbl.material.map.dispose(); d.lbl.material.dispose(); }
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'), col = d.hp <= 0 ? '#ff6a5a' : d.team === 'CT' ? '#9cc4ff' : '#ffcf8a';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.85)';
  g.font = 'bold 44px Trebuchet MS, Arial'; const t1 = d.hp > 0 ? d.hp + ' PV' : 'K.O.';
  g.strokeText(t1, 256, 30); g.fillStyle = col; g.fillText(t1, 256, 30);
  g.font = 'bold 26px Trebuchet MS, Arial'; const t2 = [d.armor > 0 ? 'gilet ' + Math.round(d.armor) : 'sans gilet', d.helmet ? 'casque' : ''].filter(Boolean).join(' · ');
  g.strokeText(t2, 256, 74); g.fillStyle = '#dfe6ec'; g.fillText(t2, 256, 74);
  d.lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, toneMapped: false }));
  d.lbl.position.y = 2.25; d.lbl.scale.set(1.6, 0.3, 1); d.lbl.renderOrder = 10; d.g.add(d.lbl);
}
// devant le joueur, à 6 m au plus, sur un emplacement libre
function dummySpot() {
  const fx0 = -Math.sin(P.yaw), fz0 = -Math.cos(P.yaw);
  for (let dist = 6; dist >= 1.5; dist -= 0.5) {
    const x = clamp(P.x + fx0 * dist, -MAP.hx + 1, MAP.hx - 1), z = clamp(P.z + fz0 * dist, -MAP.hz + 1, MAP.hz - 1);
    const ok = !BOXES.some((b) => b.h > P.y + 0.55 && Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5) &&
      Array.from(dummies.values()).every((o) => Math.hypot(o.x0 - x, o.z0 - z) > 0.9);
    if (ok) return { x, z };
  }
  return null;
}
function addDummy(team) {
  if (!alive()) return;
  if (dummies.size >= 12) { notice('12 mannequins au maximum', '#ff7b6e'); return; }
  const spot = dummySpot();
  if (!spot) { notice('Pas de place devant toi pour un mannequin', '#ff7b6e'); return; }
  const id = 'd' + (++dumN), rig = new Models.Rig(team, id);
  rig.setGun(team === 'CT' ? 'm4a1' : 'ak47');
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(rig.root);
  const x = spot.x, z = spot.z, yaw = P.yaw + Math.PI;
  g.position.set(x, groundAt(x, z, P.y), z); g.rotation.y = yaw;
  const blob = new THREE.Mesh(blobGeo, blobMat); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.visible = !GFX.Q.shadow; g.add(blob);
  scene.add(g);
  const d = { id, team, rig, g, x0: x, z0: z, yaw, hp: 100, ar0: PR.dArmor ? 100 : 0, armor: PR.dArmor ? 100 : 0, helmet: PR.dHelmet, move: PR.dMove, t: Math.random() * 6, deadT: 0, lbl: null };
  rig.helmet.visible = d.helmet;
  dummies.set(id, d); dummyLabel(d);
  Snd.part('draw');
}
function clearDummies() { dummies.forEach((d) => { scene.remove(d.g); if (d.lbl) { d.lbl.material.map.dispose(); d.lbl.material.dispose(); } }); dummies.clear(); }
function hurtDummy(d, r, pt, wid, dist, pen) {
  if (d.hp <= 0 || r.dmg <= 0) return;
  const w = WEAPONS[wid] || {};
  const ar0 = d.armor;
  if (r.armor != null) d.armor = r.armor;
  d.hp = Math.max(0, d.hp - r.dmg);
  if (PR.dmgNum && pt) popText(_i.copy(pt).setY(pt.y + 0.3), '-' + r.dmg + (r.hs ? ' TÊTE' : ''), r.hs ? '#ff5a4a' : r.armored ? '#9cc4ff' : '#ffffff', r.hs);
  PR.lastHit = (w.n || wid) + ' · ' + (ZONE_N[r.zone] || 'explosion') + ' · ' + dist.toFixed(1) + ' m' +
    (pen ? ' · ' + pen + ' obstacle' + (pen > 1 ? 's traversés' : ' traversé') : '') + ' → ' + r.dmg + ' dégâts' + (r.armored ? ' (protégé)' : '') +
    (ar0 > 0 && d.armor <= 0 ? ' · GILET DÉTRUIT' : '');
  if (d.hp <= 0) {
    const dx = P.x - d.g.position.x, dz = P.z - d.g.position.z, y = d.g.rotation.y;
    d.rig.deadDir = -dx * Math.sin(y) - dz * Math.cos(y) >= 0 ? 1 : -1; d.rig.deadSide = (Math.random() - 0.5) * 0.6; d.rig.deadHs = !!r.hs; d.deadT = 0;
    if (cfg.hitSound) Snd.kill();
    PR.lastHit += ' · ÉLIMINÉ';
    setTimeout(() => { const sp = spatial(d.g.position.x, 0, d.g.position.z); Snd.thud(sp.v, sp.pan, sp); }, 420);
  }
  dummyLabel(d);
}
// grenade à fragmentation : le serveur ne connaît pas les mannequins, on calcule ici (même formule, arrêtée par les murs)
function heDummies(pos) {
  dummies.forEach((d) => {
    if (d.hp <= 0) return;
    const c = new THREE.Vector3(d.g.position.x, d.g.position.y + 1.0, d.g.position.z), dist = c.distanceTo(pos);
    if (dist > CFG.heRadius) return;
    rc.set(pos, _v2.subVectors(c, pos).normalize()); rc.far = Math.max(0.01, dist - 0.3);
    if (rc.intersectObjects(worldMeshes, false).length) return;
    const ah = CS.armorHit(CFG.heDmg * Math.pow(1 - dist / CFG.heRadius, 1.25), d.armor, CFG.armorBody);
    hurtDummy(d, { dmg: Math.round(ah.d), armored: 0, hs: false, zone: '', armor: ah.armor }, c, 'he', dist, 0);
  });
}
function updateDummies(dt) {
  dummies.forEach((d) => {
    if (d.hp <= 0) {
      d.deadT += dt; d.rig.update(dt, { dead: true, speed: 0, fw: 0, sd: 0 });
      if (d.deadT > 2.6) { d.hp = 100; d.armor = d.ar0; d.deadT = 0; dummyLabel(d); }   // il se relève
      return;
    }
    let speed = 0, sd = 0;
    if (d.move) {   // va-et-vient de côté
      d.t += dt;
      const f = 0.75, off = Math.sin(d.t * f) * 3.2, v = Math.cos(d.t * f) * f * 3.2;
      d.g.position.x = d.x0 + Math.cos(d.yaw) * off; d.g.position.z = d.z0 - Math.sin(d.yaw) * off;
      speed = Math.abs(v); sd = v >= 0 ? 1 : -1;
    }
    d.rig.update(dt, { speed, fw: 0, sd, crouch: 0, pitch: 0, reload: 0, dead: false, act: 0 });
  });
}

/* ---------- stand de tir ---------- */
const RANGE_DIFF = {
  easy:   { n: 'FACILE',    life: 3.2, gap: 0.7,  max: 1, dmin: 8,  dmax: 22, size: 1.15, move: 0,    spd: 0,   pts: 100, d: 'Grandes cibles · 3 s · 8 à 22 m · immobiles' },
  medium: { n: 'MOYEN',     life: 2.0, gap: 0.5,  max: 2, dmin: 10, dmax: 32, size: 0.95, move: 0.25, spd: 1.6, pts: 150, d: '2 s · 10 à 32 m · deux à la fois · une sur quatre bouge' },
  hard:   { n: 'DIFFICILE', life: 1.3, gap: 0.35, max: 3, dmin: 14, dmax: 46, size: 0.78, move: 0.5,  spd: 2.6, pts: 220, d: '1,3 s · 14 à 46 m · trois à la fois · une sur deux bouge' },
  expert: { n: 'EXPERT',    life: 0.8, gap: 0.22, max: 3, dmin: 12, dmax: 60, size: 0.62, move: 0.75, spd: 3.6, pts: 320, d: '0,8 s · jusqu\'à 60 m · petites, rapides, presque toutes en mouvement' }
};
const RG = { diff: store.get('cs_rdiff', 'medium'), dur: +store.get('cs_rdur', '60'), on: false, cd: 0, left: 0, score: 0, hits: 0, miss: 0, shots: 0, combo: 0, best: 0, rt: [], next: 0, last: null, cdShown: -1, top: null, topKey: '' };
if (!RANGE_DIFF[RG.diff]) RG.diff = 'medium';
if ([0, 30, 60, 90].indexOf(RG.dur) < 0) RG.dur = 60;
const tgts = [];
let tgtN = 0;
// cible ronde : 10 anneaux, centre rouge
const discMat = (function () {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#ece7da'; g.fillRect(0, 0, S, S);
  for (let i = 1; i <= 10; i++) {
    const r = (11 - i) / 10 * (S / 2 - 1);
    g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.fillStyle = i === 10 ? '#c8281e' : i >= 7 ? '#1d1d1d' : '#ece7da'; g.fill();
    g.lineWidth = 2; g.strokeStyle = i >= 7 ? '#d9d3c5' : '#2a2a2a'; g.stroke();
    if (i <= 8) { g.fillStyle = i >= 7 ? '#d9d3c5' : '#2a2a2a'; g.font = 'bold 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i), S / 2 + r - 6.4, S / 2); }
  }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
})();
// silhouette : tête, cou, buste (zone centrale marquée) — la même forme sert au dessin et aux touches
function silhZone(u, v) {
  const hx = (u - 0.5) / 0.17, hy = (v - 0.875) / 0.085;
  if (hx * hx + hy * hy <= 1) return 'h';
  if (v >= 0.775 && v < 0.81 && Math.abs(u - 0.5) < 0.07) return 'c';
  if (v < 0.78) {
    const hw = v > 0.66 ? 0.47 - (v - 0.66) * 1.6 : 0.36 + v * 0.168;
    if (Math.abs(u - 0.5) < hw) return Math.abs(u - 0.5) < 0.15 && v > 0.36 && v < 0.68 ? 'x' : 'c';
  }
  return null;
}
const silhMat = (function () {
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), im = g.createImageData(W, H);
  const zAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : silhZone((x + 0.5) / W, 1 - (y + 0.5) / H));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = zAt(x, y), i = (y * W + x) * 4;
    if (!z) { im.data[i + 3] = 0; continue; }
    const edge = zAt(x - 1, y) !== z || zAt(x + 1, y) !== z || zAt(x, y - 1) !== z || zAt(x, y + 1) !== z;
    const col = edge ? [24, 28, 22] : z === 'h' ? [112, 126, 98] : z === 'x' ? [96, 110, 84] : [82, 96, 72];
    const n = (Math.random() - 0.5) * 8;
    im.data[i] = col[0] + n; im.data[i + 1] = col[1] + n; im.data[i + 2] = col[2] + n; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
})();
const postGeo = new THREE.BoxGeometry(0.05, 1, 0.05); postGeo.translate(0, 0.5, 0);
const postMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.7 });
const footGeo = new THREE.BoxGeometry(0.5, 0.06, 0.32), backMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });

function spawnTarget(D) {
  let x = 0, z = 0, ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    const dist = D.dmin + Math.random() * (D.dmax - D.dmin);
    x = -12 + Math.random() * 24; z = 30.5 - dist;
    ok = z > -34.5 && !BOXES.some((b) => b.h > 0.3 && b.h < 9 && Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8) &&
      tgts.every((t) => Math.hypot(t.x - x, t.z - z) > 2.5);
  }
  if (!ok) return;
  const kind = Math.random() < 0.5 ? 'disc' : 'silh', s = D.size * (0.9 + Math.random() * 0.2);
  const root = new THREE.Group(), piv = new THREE.Group(); root.add(piv);
  root.position.set(x, 0, z); root.rotation.y = Math.atan2(P.x - x, P.z - z);   // face au tireur
  const foot = new THREE.Mesh(footGeo, postMat); foot.position.y = 0.03; root.add(foot);
  const post = new THREE.Mesh(postGeo, postMat); post.castShadow = true; piv.add(post);
  let plate;
  if (kind === 'disc') {
    const R = 0.42 * s, cy = 1.3;
    plate = new THREE.Mesh(new THREE.CircleGeometry(R, 40), discMat); plate.position.y = cy;
    const back = new THREE.Mesh(new THREE.CircleGeometry(R * 1.07, 40), backMat); back.position.set(0, cy, -0.012); piv.add(back);
    post.scale.y = cy - R * 0.5;
  } else {
    const Hs = 1.3 * s, Ws = 0.62 * s;
    plate = new THREE.Mesh(new THREE.PlaneGeometry(Ws, Hs), silhMat); plate.position.y = 0.55 + Hs / 2;
    post.scale.y = 0.56;
  }
  plate.castShadow = true; plate.userData = { tgt: ++tgtN }; piv.add(plate);
  piv.rotation.x = -Math.PI / 2;
  scene.add(root); root.updateMatrixWorld(true);
  const vx = Math.random() < D.move ? (Math.random() < 0.5 ? -1 : 1) * D.spd * (0.8 + Math.random() * 0.4) : 0;
  tgts.push({ id: tgtN, root, piv, plate, kind, x, z, vx, st: 'rise', t: 0, life: D.life * (0.85 + Math.random() * 0.3), upAt: 0, hit: false });
  const sp = spatial(x, 0.5, z); Snd.impact('metal', sp.v * 0.45, sp.pan, sp);
}
function removeTarget(i) {
  const t = tgts[i]; scene.remove(t.root);
  t.piv.children.forEach((m) => { if (m.geometry !== postGeo) m.geometry.dispose(); });
  tgts.splice(i, 1);
}
function clearTargets() { while (tgts.length) removeTarget(0); }
// une balle a touché la plaque : où ? (null si elle passe à côté de la silhouette)
function rangeHitTest(id, h) {
  const t = tgts.find((q) => q.id === id);
  if (!t || t.hit || !(t.st === 'up' || (t.st === 'rise' && t.t > 0.08)) || !h.uv) return null;
  if (t.kind === 'disc') {
    const r = Math.hypot(h.uv.x - 0.5, h.uv.y - 0.5) * 2; if (r > 1) return null;
    const ring = clamp(10 - Math.floor(r * 10), 1, 10);
    return { t, ring, zone: ring >= 9 ? 'x' : 'c' };
  }
  const zone = silhZone(h.uv.x, h.uv.y);
  return zone ? { t, ring: 0, zone } : null;
}
const better = (a, b) => (a.ring || (a.zone === 'h' ? 12 : a.zone === 'x' ? 9 : 5)) > (b.ring || (b.zone === 'h' ? 12 : b.zone === 'x' ? 9 : 5));
function scoreTarget(res, point) {
  const t = res.t, D = RANGE_DIFF[RG.diff];
  t.st = 'fall'; t.t = 0; t.hit = true;
  Snd.impact('metal', 0.9, 0, {}); hitMark(res.zone === 'h');
  fx.sparks(point, _v3.set(P.x - point.x, 0, P.z - point.z).normalize(), 6);
  if (!RG.on || RG.cd > 0) return;
  const react = t.upAt ? (performance.now() - t.upAt) / 1000 : 0, quick = clamp(1 - react / t.life, 0, 1);
  const mult = t.kind === 'disc' ? 0.5 + res.ring * 0.08 : res.zone === 'h' ? 1.6 : res.zone === 'x' ? 1.2 : 1;
  RG.combo++; RG.best = Math.max(RG.best, RG.combo);
  const dist = Math.hypot(t.x - P.x, t.z - P.z);
  const pts = Math.max(5, Math.round(D.pts * mult * (0.6 + 0.4 * quick) * (1 + Math.min(1, (RG.combo - 1) * 0.1)) * (1 + dist / 60) / 5) * 5);
  RG.score += pts; RG.hits++; RG.rt.push(react * 1000);
  const top = t.kind === 'disc' ? res.ring === 10 ? 'MOUCHE' : String(res.ring) : res.zone === 'h' ? 'TÊTE' : res.zone === 'x' ? 'CENTRE' : '';
  popText(point, (top ? top + ' ' : '') + '+' + pts + (RG.combo >= 3 ? ' ×' + RG.combo : ''), res.zone === 'h' || res.ring >= 9 ? '#ffd24a' : '#ffffff', res.zone === 'h' || res.ring === 10);
}
function updateTargets(dt) {
  for (let i = tgts.length - 1; i >= 0; i--) {
    const t = tgts[i]; t.t += dt;
    if (t.st === 'rise') {
      const k = Math.min(1, t.t / 0.16); t.piv.rotation.x = -Math.PI / 2 * (1 - sstep(k));
      if (k >= 1) { t.st = 'up'; t.t = 0; t.upAt = performance.now(); }
    } else if (t.st === 'up') {
      if (t.vx) {
        t.x += t.vx * dt;
        if (t.x < -12.8 || t.x > 12.8) { t.vx = -t.vx; t.x = clamp(t.x, -12.8, 12.8); }
        t.root.position.x = t.x; t.root.rotation.y = Math.atan2(P.x - t.x, P.z - t.z);
      }
      if (t.t >= t.life) {   // trop lent : la cible se baisse
        t.st = 'fall'; t.t = 0;
        if (RG.on && RG.cd <= 0) { RG.miss++; RG.combo = 0; popText(_i.set(t.x, 1.4, t.z), 'RATÉE', '#9aa7b2'); }
      }
    } else {
      const k = Math.min(1, t.t / (t.hit ? 0.14 : 0.24));
      t.piv.rotation.x = -Math.PI / 2 * sstep(k) + (t.hit ? Math.sin(k * Math.PI) * 0.15 : 0);
      if (k >= 1) { removeTarget(i); continue; }
    }
    t.root.updateMatrixWorld(true);
  }
}
function startRange() {
  clearTargets();
  Object.assign(RG, { on: true, cd: 2.99, left: RG.dur, score: 0, hits: 0, miss: 0, shots: 0, combo: 0, best: 0, rt: [], next: 0.25, cdShown: -1 });
  store.set('cs_rdiff', RG.diff); store.set('cs_rdur', String(RG.dur));
}
function stopRange(finished) {
  if (!RG.on) return;
  RG.on = false; clearTargets();
  const acc = RG.shots ? Math.round(RG.hits / RG.shots * 100) : 0;
  const rt = RG.rt.length ? Math.round(RG.rt.reduce((a, b) => a + b, 0) / RG.rt.length) : 0;
  const res = { d: RG.diff, t: RG.dur, score: RG.score, hits: RG.hits, miss: RG.miss, acc, rt, combo: RG.best, shots: RG.shots, done: !!finished, rec: null, prev: 0, local: 0, newLocal: false };
  RG.last = res;
  if (!finished) return;
  Snd.win();
  banner('SÉRIE TERMINÉE', '#ffd24a', RG.score + ' points · ' + acc + ' % de précision', 3200);
  if (RG.dur) {
    const key = 'cs_rbest_' + res.d + '_' + res.t, lb = +store.get(key, '0') || 0;
    res.local = lb; if (res.score > lb) { res.newLocal = true; store.set(key, String(res.score)); }
    if (Account.user) Account.submitRange(res).then((r) => { if (r.ok) { res.rec = r.rec; res.prev = r.prev; RG.topKey = ''; if (ui.panel) renderPanel(); } });
  }
  setTimeout(() => { if (isRange() && !RG.on) openPanel(); }, 1600);
}
function updateRange(dt) {
  updateTargets(dt);
  if (!RG.on) return;
  if (!isRange() || !alive()) { stopRange(false); return; }
  if (RG.cd > 0) {
    RG.cd -= dt;
    const n = Math.ceil(RG.cd);
    if (n !== RG.cdShown) {
      RG.cdShown = n;
      if (n > 0) { banner(String(n), '#ffffff', RANGE_DIFF[RG.diff].n + ' · ' + (RG.dur ? RG.dur + ' s' : 'libre'), 900); Snd.beep(0.7, 0); }
      else { banner('TIREZ !', '#8ccf4d', '', 700); Snd.roundStart(); }
    }
    return;
  }
  if (RG.dur) { RG.left -= dt; if (RG.left <= 0) { RG.left = 0; stopRange(true); return; } }
  const D = RANGE_DIFF[RG.diff];
  RG.next -= dt;
  if (RG.next <= 0 && tgts.filter((t) => t.st !== 'fall').length < D.max) { spawnTarget(D); RG.next = D.gap * (0.6 + Math.random() * 0.8); }
}

function clearPractice() { clearTargets(); clearDummies(); while (pops.length) dropPop(0); RG.on = false; PR.fly = false; PR.lastHit = ''; }
function updatePractice(dt) {
  updateRange(dt); updateDummies(dt); updatePops(dt);
  if (PR.hintT > 0) PR.hintT -= dt;
}

/* ---------- panneau d'entraînement (touche P) ---------- */
function el(tag, attrs) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  });
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    (Array.isArray(c) ? c : [c]).forEach((x) => { if (x != null && x !== false) e.append(x.nodeType ? x : document.createTextNode(String(x))); });
  }
  return e;
}
function openPanel() {
  if (!practice()) return;
  ui.panel = true; $('pracPanel').classList.remove('hide');
  if (document.pointerLockElement) document.exitPointerLock();
  renderPanel();
}
function closePanel(noLock) {
  if (!ui.panel) return;
  ui.panel = false; $('pracPanel').classList.add('hide');
  if (!noLock && connected) tryLock();
}
$('pracPanel').addEventListener('mousedown', (e) => { if (e.target === $('pracPanel')) closePanel(); });
$('pracPause').addEventListener('click', () => openPanel());
function renderPanel() {
  const card = $('pracCard'); if (!card || !ui.panel) return;
  card.textContent = '';
  const range = isRange();
  card.className = 'card pcard' + (range ? ' prange' : ' psand');
  card.append(el('div', { class: 'sethead' }, el('h2', null, range ? 'Stand de tir' : 'Zone de test'), el('button', { class: 'x', type: 'button', 'aria-label': 'Fermer', onclick: () => closePanel() }, '✕')));
  const body = el('div', { class: 'pbody' }); card.append(body);
  if (range) rangePanel(body); else sandboxPanel(body);
}
const toggle = (on, fn) => el('button', { type: 'button', class: 'sw' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: fn });
function optRow(name, desc, key, after) {
  return el('div', { class: 'prow' }, el('div', { class: 'lbl' }, el('div', { class: 'nm' }, name), desc ? el('div', { class: 'ds' }, desc) : null),
    toggle(PR[key], () => { PR[key] = !PR[key]; savePR(); if (after) after(); renderPanel(); }));
}
const pbtn = (text, fn, cls) => el('button', { type: 'button', class: 'pb' + (cls ? ' ' + cls : ''), onclick: fn }, text);

function rangePanel(body) {
  const r = RG.last;
  if (r && r.done) {
    const recTxt = !RG.dur && !r.t ? 'Mode libre : pas de record' :
      Account.user ? (r.rec === true ? '★ NOUVEAU RECORD (ancien : ' + r.prev + ')' : r.rec === false ? 'Ton record : ' + r.prev : 'Enregistrement…')
        : (r.newLocal ? '★ Nouveau record sur cet appareil' : 'Record sur cet appareil : ' + r.local);
    body.append(el('div', { class: 'pres' },
      el('div', { class: 'big' }, el('b', null, String(r.score)), el('small', null, 'POINTS · ' + RANGE_DIFF[r.d].n + (r.t ? ' · ' + r.t + ' s' : ' · libre'))),
      el('div', { class: 'pstats' }, [['Touchées', r.hits], ['Ratées', r.miss], ['Précision', r.acc + ' %'], ['Réaction', r.rt ? r.rt + ' ms' : '—'], ['Meilleure série', '×' + r.combo]]
        .map(([n, v]) => el('div', null, el('b', null, String(v)), el('small', null, n)))),
      el('div', { class: 'prec' + (r.rec || r.newLocal ? ' gold' : '') }, recTxt,
        !Account.user && r.t ? el('button', { type: 'button', class: 'linkb', onclick: () => Account.open() }, 'Crée un compte pour garder tes records et entrer au classement') : null)));
  }
  body.append(el('div', { class: 'grp' }, 'DIFFICULTÉ'));
  const dc = el('div', { class: 'cards pdiff' });
  Object.keys(RANGE_DIFF).forEach((k) => {
    const D = RANGE_DIFF[k];
    dc.append(el('button', { type: 'button', class: (RG.diff === k ? 'on ' : '') + 'd-' + k, onclick: () => { RG.diff = k; store.set('cs_rdiff', k); renderPanel(); } }, el('b', null, D.n), el('small', null, D.d)));
  });
  body.append(dc);
  body.append(el('div', { class: 'grp' }, 'DURÉE'));
  const seg = el('div', { class: 'ctl seg' });
  [[30, '30 s'], [60, '60 s'], [90, '90 s'], [0, 'Libre']].forEach(([v, n]) => seg.append(el('button', { type: 'button', class: RG.dur === v ? 'on' : '', onclick: () => { RG.dur = v; store.set('cs_rdur', String(v)); renderPanel(); } }, n)));
  body.append(seg);
  body.append(el('div', { class: 'prow2' },
    pbtn(RG.on ? 'RECOMMENCER' : 'COMMENCER', () => { startRange(); closePanel(); }, 'go'),
    RG.on ? pbtn('Arrêter la série', () => { stopRange(false); renderPanel(); }) : null));
  body.append(el('p', { class: 'hint' }, 'Les cibles se lèvent, restent un moment puis se baissent. Le score dépend de l\'endroit touché (centre, tête), de ta rapidité, de la distance et de ta série. ' +
    Settings.key('buy') + ' : boutique gratuite avec toutes les armes · munitions illimitées · ' + Settings.key('tools') + ' : ce panneau. Entrée : commencer.'));
  // classement des comptes (séries minutées seulement)
  if (RG.dur) {
    const key = RG.diff + '_' + RG.dur;
    body.append(el('div', { class: 'grp' }, 'CLASSEMENT · ' + RANGE_DIFF[RG.diff].n + ' · ' + RG.dur + ' S'));
    const box = el('div', { class: 'ptop' }, RG.topKey === key && RG.top ? null : 'Chargement…');
    if (RG.topKey === key && RG.top) {
      if (!RG.top.length) box.append('Personne pour l\'instant : à toi de jouer !');
      RG.top.forEach((e, i) => box.append(el('div', { class: Account.user && e.n === Account.user.name ? 'me' : '' }, el('i', null, String(i + 1)), el('span', null, e.n), el('b', null, String(e.s)), el('small', null, e.a + ' %'))));
    } else {
      RG.topKey = key; RG.top = null;
      Account.top(RG.diff, RG.dur).then((r) => { if (RG.topKey === key) { RG.top = r.ok ? r.list : []; renderPanel(); } });
    }
    body.append(box);
    if (!Account.user) body.append(el('button', { type: 'button', class: 'linkb', onclick: () => Account.open() }, 'Se connecter pour enregistrer ses scores'));
  }
}

function sandboxPanel(body) {
  const sb = (o) => send(Object.assign({ type: 'sb' }, o));
  const cols = el('div', { class: 'pcols' }), c1 = el('div'), c2 = el('div');
  cols.append(c1, c2); body.append(cols);
  c1.append(el('div', { class: 'grp' }, 'JOUEUR'),
    optRow('Invincible', 'Tu reçois les coups (effets, direction) sans perdre de vie.', 'god', sendOpts),
    optRow('Munitions infinies', 'Le chargeur ne se vide jamais. La réserve est toujours illimitée ici.', 'infMag'),
    optRow('Grenades illimitées', 'Achète une grenade une fois, elle revient après chaque lancer.', 'infNades', sendOpts),
    el('div', { class: 'prow' }, el('div', { class: 'lbl' }, el('div', { class: 'nm' }, 'Vol libre'), el('div', { class: 'ds' }, 'Sans gravité ni murs. ' + Settings.key('jump') + ' monte, ' + Settings.key('crouch') + ' descend, ' + Settings.key('walk') + ' ralentit.')),
      toggle(PR.fly, () => { PR.fly = !PR.fly; if (!PR.fly) P.vy = 0; renderPanel(); })),
    el('div', { class: 'pbtns' }, pbtn('Soigner + gilet et casque', () => sb({ a: 'heal' })), pbtn('Réapparaître', () => sb({ a: 'respawn' }))),
    el('div', { class: 'prow' }, el('div', { class: 'lbl' }, el('div', { class: 'nm' }, 'Camp')),
      el('div', { class: 'ctl seg' }, ['T', 'CT'].map((t) => el('button', { type: 'button', class: myTeam === t ? 'on' : '', onclick: () => { sb({ a: 'team', team: t }); setTimeout(renderPanel, 250); } }, t === 'T' ? 'Terroriste' : 'Anti-terroriste')))),
    el('div', { class: 'grp' }, 'MANNEQUINS (' + dummies.size + ')'),
    el('div', { class: 'pbtns' }, pbtn('+ Mannequin T', () => { addDummy('T'); renderPanel(); }), pbtn('+ Mannequin CT', () => { addDummy('CT'); renderPanel(); }), pbtn('Tout supprimer', () => { clearDummies(); renderPanel(); })),
    optRow('Gilet pare-balles', 'Pour les prochains mannequins.', 'dArmor'),
    optRow('Casque', 'Pour les prochains mannequins.', 'dHelmet'),
    optRow('En mouvement', 'Ils marchent de gauche à droite.', 'dMove'),
    optRow('Afficher les dégâts', 'Chiffres au point d\'impact (rouge : tête, bleu : protégé).', 'dmgNum'),
    optRow('Infos de test', 'Position, vitesse, dispersion et détail du dernier tir.', 'info'));
  const go = (x, z) => { sb({ a: 'tp', x, y: groundAt(x, z, 0), z, yaw: P.yaw }); closePanel(); };
  const tp = [['Départ T', MAP.spawns.T[0]], ['Départ CT', MAP.spawns.CT[0]]].map(([n, s]) => pbtn(n, () => go(s.x, s.z)));
  Object.keys(SITES).forEach((k) => tp.push(pbtn('Site ' + k, () => go(SITES[k].x, SITES[k].z))));
  tp.push(pbtn('Milieu', () => go(0, 0)));
  c2.append(el('div', { class: 'grp' }, 'TÉLÉPORTATION'), el('div', { class: 'pbtns' }, tp),
    el('div', { class: 'grp' }, 'BOMBE'),
    el('div', { class: 'pbtns' }, pbtn('Recevoir la bombe', () => { sb({ a: 'bomb' }); closePanel(); })),
    el('p', { class: 'hint' }, 'Tu passes Terroriste. Pose-la sur un site (' + Settings.key('use') + ' maintenu), puis change de camp pour la désamorcer. Explosion ou désamorçage : la partie continue.'),
    el('div', { class: 'grp' }, 'CARTE'),
    el('div', { class: 'pbtns maps' }, Object.keys(MAPS).filter((id) => !MAPS[id].custom || id === MAP.id).map((id) => pbtn(MAPS[id].name, () => { sb({ a: 'map', map: id }); closePanel(); }, MAP.id === id ? 'on' : ''))),
    el('div', { class: 'grp' }, 'DÉSORDRE (MODE « RIEN N\'EST À SA PLACE »)'),
    el('div', { class: 'pbtns' }, pbtn('Murs qui bougent', () => sb({ a: 'chaos', k: 'walls' })), pbtn('Armes principales bloquées', () => sb({ a: 'chaos', k: 'jam', s: 1 })),
      pbtn('Pistolets bloqués', () => sb({ a: 'chaos', k: 'jam', s: 2 })), pbtn('Commandes inversées', () => sb({ a: 'chaos', k: 'invert' })), pbtn('Tout remettre en place', () => sb({ a: 'chaos', k: 'restore' }))),
    el('div', { class: 'grp' }, 'NETTOYER'),
    el('div', { class: 'pbtns' }, pbtn('Grenades, feux et armes au sol', () => sb({ a: 'clear' })), pbtn('Impacts et sang', () => fx.clear())),
    el('p', { class: 'hint' }, Settings.key('buy') + ' : boutique gratuite, toutes les armes des deux camps · ' + Settings.key('tools') + ' : ce panneau. Les mannequins encaissent aussi les grenades à fragmentation.'));
}

/* ============================================================
   Boutique
   ============================================================ */
const PRACTICE_SHOP = [
  ['Pistolets', ['glock', 'usp', 'p250', 'tec9', 'fiveseven', 'deagle']], ['Pistolets-mitrailleurs', ['mac10', 'mp9', 'ump45', 'p90']],
  ['Armes lourdes', ['nova', 'xm1014']], ['Fusils', ['galil', 'famas', 'ak47', 'm4a1', 'sg553', 'aug']], ['Lunettes', ['ssg08', 'awp']]
];
function buyItems() {
  const t = myTeam === 'CT' ? 'CT' : 'T';
  // entraînement : toutes les armes des deux camps, gratuites
  if (S.pm) return PRACTICE_SHOP.concat([['Équipement', ['armor', 'helmet', 'kit']], ['Grenades (' + CFG.grenTotal + ' au maximum)', NADES]]);
  return SHOP[t].concat([['Équipement', ['armor', 'helmet'].concat(t === 'CT' ? ['kit'] : [])], ['Grenades (' + CFG.grenTotal + ' au maximum)', NADES]]);
}
let buySig = '';
function renderBuy(force) {
  const me = S.me; if (!me) return;
  const sig = [me.mo, me.p, me.s, me.ar, me.he, me.k, me.bo, myTeam, (me.sl || []).join(','), JSON.stringify(me.g || {})].join('|');
  if (!force && sig === buySig) return;
  buySig = sig;
  $('buyMoney').textContent = S.pm ? 'Entraînement : tout est gratuit' : '$' + me.mo;
  const body = $('buyBody'); body.textContent = '';
  // armes achetées à cette manche : revendables au prix payé tant que la boutique est ouverte
  if (me.sl && me.sl.length && me.bo) {
    const g = document.createElement('div'); g.className = 'grp'; g.textContent = 'Revendre (achetées à cette manche)'; body.appendChild(g);
    const wrap = document.createElement('div'); wrap.className = 'items'; body.appendChild(wrap);
    me.sl.forEach((id) => {
      const w = WEAPONS[id]; if (!w) return;
      const b = document.createElement('button'); b.className = 'sellb';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = w.n;
      const pr = document.createElement('div'); pr.className = 'pr'; pr.textContent = 'Vendre · +$' + w.price;
      b.append(nm, pr); b.dataset.id = id;
      b.addEventListener('click', () => doSell(id));
      wrap.appendChild(b);
    });
  }
  let n = 0;
  buyItems().forEach(([title, ids]) => {
    const g = document.createElement('div'); g.className = 'grp'; g.textContent = title; body.appendChild(g);
    const wrap = document.createElement('div'); wrap.className = 'items'; body.appendChild(wrap);
    ids.forEach((id) => {
      n++;
      let name, price, stat, has = false;
      if (id === 'armor') { name = 'Gilet pare-balles'; price = 650; stat = 'Protège torse, ventre et bras'; has = me.ar >= 100; }
      else if (id === 'helmet') { name = 'Gilet + casque'; price = me.ar >= 100 ? 350 : 1000; stat = 'Protège aussi la tête'; has = !!me.he; }
      else if (id === 'kit') { name = 'Kit de désamorçage'; price = 400; stat = 'Désamorçage 2x plus rapide'; has = !!me.k; }
      else if (isNade(id)) {
        const gm = me.g || {}, cnt = gm[id] | 0, tot = NADES.reduce((a, k) => a + (gm[k] | 0), 0);
        name = GREN[id].n; price = GREN[id].price;
        stat = NADE_UI[id].stat + (cnt ? ' · en stock : ' + cnt : '') + (GREN[id].max > 1 ? ' · ' + GREN[id].max + ' max' : '');
        has = cnt >= GREN[id].max || tot >= CFG.grenTotal;
      }
      else { const w = WEAPONS[id]; name = w.n; price = w.price; stat = w.dmg + (w.pellets ? ' x' + w.pellets : '') + ' dégâts · ' + w.mag + ' balles' + (w.pen ? ' · perforant' : ''); has = me.p === id || me.s === id; }
      const b = document.createElement('button');
      b.className = 'item' + (has ? ' own' : ''); b.disabled = has || (!S.pm && me.mo < price) || !me.bo;
      const k = document.createElement('span'); k.className = 'k'; k.textContent = n <= 9 ? String(n) : n === 10 ? '0' : '';
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = name;
      const pr = document.createElement('div'); pr.className = 'pr'; pr.textContent = has ? (isNade(id) ? 'Maximum' : 'Acheté') : S.pm ? 'Gratuit' : '$' + price;
      const st = document.createElement('div'); st.className = 'st'; st.textContent = stat;
      b.append(k, nm, pr, st);
      b.dataset.id = id;
      b.addEventListener('click', () => doBuy(id));
      wrap.appendChild(b);
    });
  });
}
function doSell(id) { send({ type: 'sell', item: id }); Snd.buy(); setTimeout(() => { if (ui.buy) renderBuy(true); }, 150); }
function doBuy(id) { send({ type: 'buy', item: id }); Snd.buy(); setTimeout(() => { if (ui.buy) renderBuy(); }, 150); }
function openBuy() {
  if (!alive()) return;
  if (!S.me.bo) { notice('La phase d\'achat est terminée', '#ff7b6e'); return; }
  ui.buy = true; renderBuy(true); $('buy').classList.remove('hide');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeBuy(silent) {
  if (!ui.buy && silent) return;
  ui.buy = false; $('buy').classList.add('hide');
  if (!silent && connected) tryLock();
}
$('buyClose').addEventListener('click', () => closeBuy());

/* ============================================================
   Entrées
   ============================================================ */
// Les navigateurs réservent Ctrl+W, Ctrl+T et Ctrl+N : une page ne peut pas les bloquer,
// sauf en plein écran avec l'API Keyboard Lock (Chrome, Edge, Opera, en https ou localhost).
let kbLock = false, leaving = false, ctrlHint = false;
function lockKeys() {
  if (!navigator.keyboard || !navigator.keyboard.lock) return;
  navigator.keyboard.lock(Settings.lockCodes()).then(() => { kbLock = true; }).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) kbLock = false; });
function pointerLock() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
function tryLock() {
  // la souris d'abord : le plein écran consomme le clic de l'utilisateur et bloquerait la capture ensuite
  pointerLock();
  const root = document.documentElement;
  if (document.fullscreenElement) { if (!kbLock) lockKeys(); }
  else if (cfg.autoFs && root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).then(lockKeys).catch(() => {});
}
// filet de sécurité : le navigateur demande confirmation avant de fermer la partie
window.addEventListener('beforeunload', (e) => {
  if (!connected || leaving) return;
  e.preventDefault(); e.returnValue = '';
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { Object.keys(K).forEach((k) => { K[k] = false; }); crouchTog = false; fireHeld = false; fireLatch = false; scoped = false; rmbHeld = false; send({ type: 'act', on: 0 }); }
});
canvas.addEventListener('click', () => { if (connected && !ui.buy && !ui.panel && !locked) tryLock(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const s = 0.0022 * cfg.sens * (cam.fov / FOV) * (scoped || aiming ? cfg.adsSens : 1);
  P.mouseX += e.movementX; P.mouseY += e.movementY;
  P.yaw -= e.movementX * s;
  P.pitch = clamp(P.pitch - e.movementY * s * (cfg.invertY ? -1 : 1), -1.5, 1.5);
});

document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) {
    if (!alive()) { cycleSpec(); return; }
    fireHeld = true; fireLatch = true;
  } else if (e.button === 2) {
    if (alive() && isNade(cur)) { throwNade(true); return; }   // grenade : lancer court
    rmbHeld = cfg.toggleAim ? !rmbHeld : true;        // maintenu = viser (ou bascule)
    if (alive() && WEAPONS[cur].scope && !reloading) { scoped = !scoped; Snd.click(); } // AWP : lunette
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; if (e.button === 2 && !cfg.toggleAim) rmbHeld = false; });
document.addEventListener('wheel', (e) => {
  if (!locked || !alive()) return;
  const o = ownedAll(); const i = o.indexOf(cur);
  selectWeapon(o[(i + (e.deltaY > 0 ? 1 : o.length - 1)) % o.length]);
}, { passive: true });

function cycleSpec() {
  const list = Array.from(remotes.values()).filter((r) => r.alive && r.team === myTeam).map((r) => r.id);
  if (!list.length) { specId = null; return; }
  specId = list[(list.indexOf(specId) + 1) % list.length];
}

const chatIn = $('chatin');
function openChat() { ui.chat = true; chatIn.classList.remove('hide'); chatIn.value = ''; chatIn.focus(); }
function closeChat() { ui.chat = false; chatIn.classList.add('hide'); chatIn.blur(); canvas.focus && canvas.focus(); }

document.addEventListener('keydown', (e) => {
  if (!connected) return;
  if (inLobby()) { if (e.code === 'Escape' && document.activeElement !== $('lbIn')) leaveLobby(); return; }
  if (ui.chat) {
    if (e.code === 'Enter') { const t = chatIn.value.trim(); if (t) send({ type: 'chat', text: t }); closeChat(); }
    else if (e.code === 'Escape') closeChat();
    return;
  }
  // en jeu, Ctrl sert à s'accroupir : pas de Ctrl+S (enregistrer), Ctrl+D (favori), Ctrl+A, etc.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (!kbLock && !ctrlHint && e.code === 'ControlLeft') { ctrlHint = true; notice('Attention : hors plein écran, Ctrl+W ferme la page. Tu peux changer la touche d\'accroupi dans Paramètres.', '#ff9a3c'); }
  }
  const A = Settings.actionsOf(e.code), has = (a) => A.indexOf(a) >= 0;
  // panneau d'entraînement (stand de tir / zone de test)
  if (has('tools') && practice() && !e.repeat) { e.preventDefault(); if (ui.panel) closePanel(); else { if (ui.buy) closeBuy(true); openPanel(); } return; }
  if (ui.panel) {
    if (e.code === 'Escape') closePanel(true);
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && isRange()) { startRange(); closePanel(); }
    return;
  }
  if (has('scores')) { e.preventDefault(); ui.board = true; return; }
  if (has('chat')) { e.preventDefault(); openChat(); return; }
  if (has('buy')) { e.preventDefault(); if (ui.buy) closeBuy(); else openBuy(); return; }
  if (e.code === 'Escape' && ui.buy) { closeBuy(); return; }
  if (ui.buy) {
    const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (m) { const btn = $('buyBody').querySelectorAll('button.item')[m[2] === '0' ? 9 : +m[2] - 1]; if (btn && !btn.disabled) doBuy(btn.dataset.id); }
    return;
  }
  if (!locked) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (!e.repeat) {
    K[e.code] = true;
    if (has('use') && alive()) send({ type: 'act', on: 1 });
    if (has('reload')) reload();
    if (has('map')) { ui.map = !ui.map; $('bigmap').classList.toggle('hide', !ui.map); }
    if (has('drop')) dropCurrent();
    if (has('crouch') && cfg.toggleCrouch) crouchTog = !crouchTog;
    if (has('slot1')) selectWeapon(S.me && S.me.p);
    if (has('slot2')) selectWeapon(S.me && S.me.s);
    if (has('slot3')) selectWeapon('knife');
    if (has('nade1')) selectNade('flash');
    if (has('nade2')) selectNade('smoke');
    if (has('nade3')) selectNade('he');
    if (has('nade4')) selectNade('molo');
    if (has('nadeNext')) cycleNade();
  }
});
document.addEventListener('keyup', (e) => {
  K[e.code] = false;
  const A = Settings.actionsOf(e.code);
  if (A.indexOf('scores') >= 0) ui.board = false;
  if (A.indexOf('use') >= 0) send({ type: 'act', on: 0 });
});
window.addEventListener('blur', () => { Object.keys(K).forEach((k) => { K[k] = false; }); fireHeld = false; rmbHeld = false; ui.board = false; send({ type: 'act', on: 0 }); });

/* ============================================================
   Menu
   ============================================================ */
$('name').value = store.get('cs_name', '');
$('room').value = (new URLSearchParams(location.search).get('room')) || store.get('cs_room', '');
let chosenTeam = store.get('cs_team', 'auto');
function paintTeams() { document.querySelectorAll('#teams button').forEach((b) => b.classList.toggle('on', b.dataset.t === chosenTeam)); }
paintTeams();
document.querySelectorAll('#teams button').forEach((b) => b.addEventListener('click', () => { chosenTeam = b.dataset.t; paintTeams(); }));
// cartes ajoutées depuis l'éditeur (addEditorMap dans shared.js) : un bouton chacune, avant la carte LABO
Object.keys(MAPS).forEach((id) => {
  const M = MAPS[id]; if (!M.ed || document.querySelector('#maps button[data-m="' + id + '"]')) return;
  const b = document.createElement('button'); b.dataset.m = id; b.style.setProperty('--c', M.ed.col);
  const t = document.createElement('b'); t.textContent = M.name.toUpperCase(); const s = document.createElement('small'); s.textContent = M.ed.desc;
  b.append(t, s); $('maps').insertBefore(b, $('maps').querySelector('.practice-only'));
});
let chosenMap = MAPS[store.get('cs_map', 'dust')] ? store.get('cs_map', 'dust') : 'dust';
function paintMaps() { document.querySelectorAll('#maps button, #cmaps button[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === chosenMap)); }
// éditeur de cartes : réservé au(x) compte(s) autorisé(s) par le serveur
let canEdit = false, canTok = null;
function checkEditor() {
  const t = Account.token() || '', key = t + '|' + (Account.user ? Account.user.name : '');
  if (key === canTok) return; canTok = key;
  if (!t || !Account.user) { canEdit = false; buildMyMaps(); return; }
  fetch('/maps/can', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tok: t }) })
    .then((r) => r.json()).then((r) => { canEdit = !!(r && r.can); buildMyMaps(); }).catch(() => {});
}
// « Mes cartes » (éditeur) dans le menu
function buildMyMaps() {
  const box = $('cmaps'); if (!box) return;
  box.textContent = '';
  $('navEdit').classList.toggle('hide', !canEdit);
  const shared = /^u_/.test(chosenMap) && MAPS[chosenMap];
  box.classList.toggle('hide', !canEdit && !shared); box.previousElementSibling.classList.toggle('hide', !canEdit && !shared);
  const add = (id, name, sub, col) => {
    const b = document.createElement('button'); if (id) b.dataset.m = id; b.style.setProperty('--c', col || '#c99bff');
    const t = document.createElement('b'); t.textContent = name; const s = document.createElement('small'); s.textContent = sub; b.append(t, s);
    box.appendChild(b); return b;
  };
  if (canEdit) localMaps().forEach((m) => {
    const b = add('l_' + m.id, m.name.toUpperCase(), 'Carte perso · ' + m.data.boxes.length + ' blocs');
    b.title = 'Clic : choisir · double-clic : modifier dans l\'éditeur';
    b.addEventListener('click', () => { chosenMap = b.dataset.m; store.set('cs_map', chosenMap); paintMaps(); if (!connected) setMap(chosenMap); });
    b.addEventListener('dblclick', () => { location.href = 'editor.html?open=' + encodeURIComponent(m.id); });
  });
  // carte partagée par un lien (?cmap=)
  if (/^u_/.test(chosenMap) && MAPS[chosenMap]) {
    const b = add(chosenMap, MAPS[chosenMap].name.toUpperCase(), 'Carte partagée', '#8ccf4d');
    b.addEventListener('click', () => { paintMaps(); });
  }
  if (canEdit) { const n = add('', '+ CRÉER UNE CARTE', 'Ouvrir l\'éditeur', '#9aa7b2'); n.addEventListener('click', () => { location.href = 'editor.html'; }); }
  paintMaps();
}
buildMyMaps(); setMap(chosenMap);
chosenMode = store.get('cs_mode', '') === 'desordre' ? 'desordre' : '';
const MODE_N = { '': 'BOMBE', desordre: 'DÉSORDRE', range: 'STAND DE TIR', sandbox: 'ZONE DE TEST' };
const isPracticeMode = (m) => m === 'range' || m === 'sandbox';
function paintModes() {
  const pm = isPracticeMode(chosenMode);
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mo === chosenMode));
  $('modeChip').textContent = 'MODE · ' + MODE_N[chosenMode];
  // la carte LABO n'existe qu'en zone de test ; le stand de tir a sa propre carte et pas d'équipes
  document.querySelectorAll('.practice-only').forEach((b) => { b.style.display = chosenMode === 'sandbox' ? '' : 'none'; });
  if (chosenMode !== 'sandbox' && MAPS[chosenMap].practice) { chosenMap = 'dust'; paintMaps(); if (!connected) setMap(chosenMap); }
  const showMaps = chosenMode !== 'range';
  $('maps').style.display = showMaps ? '' : 'none'; $('maps').previousElementSibling.style.display = showMaps ? '' : 'none';
  $('cmaps').style.display = showMaps ? '' : 'none'; $('cmaps').previousElementSibling.style.display = showMaps ? '' : 'none';
  $('teams').style.display = chosenMode === 'range' ? 'none' : ''; $('teams').previousElementSibling.style.display = chosenMode === 'range' ? 'none' : '';
  $('lobbyRow').classList.toggle('hide', pm);
  $('pracNote').classList.toggle('hide', !pm);
  $('pracNote').textContent = chosenMode === 'range'
    ? 'Partie privée sur le stand de tir : cibles qui apparaissent et disparaissent, 4 difficultés, records et classement. Le code de salle est facultatif (donne le même à un ami pour vous entraîner ensemble).'
    : chosenMode === 'sandbox' ? 'Partie privée pour tout tester : mannequins, invincibilité, munitions infinies, vol libre, téléportation, bombe, désordres, toutes les cartes. Le code de salle est facultatif.' : '';
  $('play').textContent = chosenMode === 'range' ? 'ENTRER AU STAND DE TIR' : chosenMode === 'sandbox' ? 'ENTRER DANS LA ZONE DE TEST' : 'JOUER';
  $('navPlay').classList.toggle('on', !pm); $('navRange').classList.toggle('on', chosenMode === 'range'); $('navTest').classList.toggle('on', chosenMode === 'sandbox');
}
paintModes();
function pickMode(mo) {
  // la zone de test s'ouvre sur la carte LABO (on peut en choisir une autre)
  if (mo === 'sandbox' && chosenMode !== 'sandbox' && !(MAPS[chosenMap] && MAPS[chosenMap].custom)) { chosenMap = 'labo'; paintMaps(); if (!connected) setMap(chosenMap); }
  chosenMode = mo; if (!isPracticeMode(mo)) store.set('cs_mode', mo); paintModes();
}
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => pickMode(b.dataset.mo)));
document.querySelectorAll('#maps button').forEach((b) => b.addEventListener('click', () => { chosenMap = b.dataset.m; store.set('cs_map', chosenMap); paintMaps(); if (!connected) setMap(chosenMap); }));
$('navRange').addEventListener('click', () => pickMode('range'));
$('navTest').addEventListener('click', () => pickMode('sandbox'));
$('navAcc').addEventListener('click', () => Account.open());
$('navPass').addEventListener('click', () => Pass.open());
$('navEdit').addEventListener('click', () => { location.href = 'editor.html'; });

// compte : le pseudo du compte remplace le champ PSEUDO
function paintAccount(u) {
  const nm = $('name');
  if (u) { nm.value = u.name; nm.disabled = true; nm.title = 'Pseudo de ton compte'; }
  else { if (nm.disabled) nm.value = store.get('cs_name', ''); nm.disabled = false; nm.title = ''; }
  const who = $('menuWho'); who.textContent = '';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'whob';
  b.textContent = u ? '✔ ' + u.name + ' · niveau ' + u.lv : 'Invité · se connecter';
  b.addEventListener('click', () => Account.open()); who.appendChild(b);
  $('lbAcc').textContent = u ? '✔ ' + u.name.toUpperCase() + ' · NV ' + u.lv : 'COMPTE';
}
Account.on(paintAccount); paintAccount(Account.user);
Account.on(checkEditor); checkEditor();
// skin changé depuis le pass : l'arme en main se met à jour
Account.on(() => { if (V && V.id && V.sk !== Account.skinOf(V.id) && !isNade(V.id)) buildVM(V.id); });

/* ---------- pass de combat : XP gagnée et paliers débloqués ---------- */
let bpXpT = 0, bpXpSum = 0, bpToastT = 0;
function bpXp(x) {
  const el = $('bpXp'); if (!el) return;
  bpXpSum = (performance.now() - bpXpT < 2500 ? bpXpSum : 0) + x; bpXpT = performance.now();
  el.textContent = '+' + bpXpSum + ' XP · pass de combat'; el.classList.add('on');
  setTimeout(() => { if (performance.now() - bpXpT >= 2400) el.classList.remove('on'); }, 2500);
}
function msUp(w, lv, sk) {
  if (sk && CS.SKINS[sk]) { bpToast('MAÎTRISE ' + (WEAPONS[w] ? WEAPONS[w].n.toUpperCase() : w) + ' · NIVEAU ' + lv, sk, 'Skin exclusif débloqué · équipe-le depuis le menu'); }
  else notice('Maîtrise ' + (WEAPONS[w] ? WEAPONS[w].n : w) + ' : niveau ' + lv, '#ffd24a');
  Account.refresh();
}
function bpUnlock(t, sk) { bpToast('PALIER ' + t + ' DÉBLOQUÉ', sk, 'Pass de combat · équipe-le depuis le menu'); Account.refresh(); }
function bpToast(title, sk, sub) {
  const el = $('bpToast'); if (!el || !CS.SKINS[sk]) return;
  el.innerHTML = '';
  const sw = document.createElement('i'); sw.className = 'bp-sw'; sw.style.backgroundImage = 'url(' + Skins.thumb(sk, 96) + ')';
  const tx = document.createElement('div');
  tx.innerHTML = '<small></small><b></b><span></span>';
  tx.querySelector('small').textContent = title; tx.querySelector('b').textContent = Skins.label(sk); tx.querySelector('span').textContent = sub;
  el.append(sw, tx); el.classList.add('on');
  Snd.multi && Snd.multi(2);
  clearTimeout(bpToastT); bpToastT = setTimeout(() => el.classList.remove('on'), 5000);
}

function startGame() {
  Snd.init(); applyVolume(); Snd.setAmbientLevel(cfg.ambient); Snd.setAmbient(MAP.style || MAP.id);
  const u = Account.user, pm = isPracticeMode(chosenMode) ? chosenMode : '';
  const name = (u && u.name) || $('name').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
  const typed = $('room').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  // entraînement : salle privée (code aléatoire, ou le code choisi pour s'entraîner à plusieurs)
  const room = pm ? ((pm === 'range' ? 'tir_' : 'test_') + (typed || Math.random().toString(36).slice(2, 8))).slice(0, 16) : (typed || 'main');
  if (!u) store.set('cs_name', $('name').value.trim());
  store.set('cs_room', $('room').value.trim()); store.set('cs_team', chosenTeam);
  if (!pm) store.set('cs_lobby', $('lobbyChk').checked ? '1' : '0');
  const map = pm === 'range' ? 'range' : pm ? chosenMap : (MAPS[chosenMap].practice ? 'dust' : chosenMap);
  joinInfo = { name, room, team: chosenTeam, map, mode: chosenMode, lobby: pm ? false : $('lobbyChk').checked };
  $('play').disabled = true; $('err').textContent = 'Connexion…';
  if (/^l_/.test(map)) {
    const lm = localMaps().find((x) => 'l_' + x.id === map);
    if (!lm) { $('err').textContent = 'Carte introuvable dans ce navigateur'; $('play').disabled = false; return; }
    $('err').textContent = 'Envoi de la carte au serveur…';
    uploadMap(lm.data).then((id) => { joinInfo.map = id; $('err').textContent = 'Connexion…'; connect(); })
      .catch((e) => { $('err').textContent = 'Carte : ' + (e.message === 'Failed to fetch' ? 'serveur injoignable' : e.message); $('play').disabled = false; });
    return;
  }
  connect();
}
$('lobbyChk').checked = store.get('cs_lobby', '1') !== '0';
$('play').addEventListener('click', startGame);
$('name').addEventListener('keydown', (e) => { if (e.code === 'Enter') startGame(); });
$('room').addEventListener('keydown', (e) => { if (e.code === 'Enter') startGame(); });

/* ---------- Paramètres : le module settings.js enregistre les valeurs, ici on les applique ---------- */
function applyVolume() {
  bgMuted = !!(cfg.muteBg && (document.hidden || !document.hasFocus()));
  Snd.setVolume(bgMuted ? 0 : cfg.vol);
}
function applySetting(k, v) {
  switch (k) {
    case 'fov': FOV = cfg.fov; cam.fov = FOV; cam.updateProjectionMatrix(); break;
    case 'renderScale': GFX.setScale(cfg.renderScale); resize(); fx.clear(); break;
    case 'quality': GFX.setQuality(v); worldMeshes = GFX.rays; resize(); fx.clear(); break;
    case 'vol': case 'muteBg': applyVolume(); break;
    case 'ambient': Snd.setAmbientLevel(cfg.ambient); break;
    case 'radar': $('radar').style.display = cfg.radar ? '' : 'none'; break;
    case 'radarSize': $('radar').style.width = $('radar').style.height = cfg.radarSize + 'px'; break;
    case 'feed': $('hud').classList.toggle('nofeed', !cfg.feed); break;
    case 'chatlog': $('hud').classList.toggle('nochat', !cfg.chatlog); break;
    case 'fps': $('fps').textContent = ''; fpsN = 0; fpsT = performance.now(); break;
    case 'crossColor': case 'crossThick': case 'crossLen': case 'crossOpacity': case 'crossDot': case 'crossLines': Settings.applyCrosshair($('cross')); break;
    case 'binds': if (document.fullscreenElement) lockKeys(); break;
    case 'test': Snd.init(); applyVolume(); Snd.setAmbientLevel(cfg.ambient); Snd.shot('ak47', 1, 0, { wet: 0.5 }); break;
  }
}
Settings.on(applySetting);
Object.keys(cfg).forEach((k) => applySetting(k, cfg[k]));
window.addEventListener('blur', applyVolume); window.addEventListener('focus', applyVolume); document.addEventListener('visibilitychange', applyVolume);
$('setMenu').addEventListener('click', () => Settings.open());
$('navPlay').addEventListener('click', () => { if (isPracticeMode(chosenMode)) pickMode(store.get('cs_mode', '') === 'desordre' ? 'desordre' : ''); $('name').focus(); });
$('setPause').addEventListener('click', () => Settings.open());
$('resume').addEventListener('click', tryLock);
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) tryLock(); });
$('leave').addEventListener('click', () => { leaving = true; try { sessionStorage.setItem('cs_menu', '1'); } catch (e) {} try { ws.close(); } catch (e) {} location.reload(); });

/* ============================================================
   HUD
   ============================================================ */
const radar = $('radar'), rctx = radar.getContext('2d');
function drawRadar() {
  if (!cfg.radar) return;
  const s = radar.width, c = s / 2, scale = c / 32;
  rctx.clearRect(0, 0, s, s);
  rctx.save();
  rctx.beginPath(); rctx.arc(c, c, c - 2, 0, 7); rctx.clip();
  rctx.translate(c, c); rctx.rotate(P.yaw); rctx.scale(scale, scale); rctx.translate(-P.x, -P.z);
  rctx.fillStyle = 'rgba(120,140,155,.55)';
  BOXES.forEach((b) => { if (b.h > 1) rctx.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d); });
  rctx.strokeStyle = 'rgba(216,67,47,.8)'; rctx.lineWidth = 0.5;
  Object.keys(SITES).forEach((k) => {
    const st = SITES[k]; rctx.beginPath(); rctx.arc(st.x, st.z, st.r, 0, 7); rctx.stroke();
    rctx.save(); rctx.translate(st.x, st.z); rctx.rotate(-P.yaw); rctx.fillStyle = 'rgba(216,67,47,.95)'; rctx.font = 'bold 8px Arial'; rctx.textAlign = 'center'; rctx.textBaseline = 'middle'; rctx.fillText(k, 0, 0); rctx.restore();
  });
  // fumées et feux
  zones.forEach((z) => { rctx.fillStyle = z.k === 'smoke' ? 'rgba(190,195,205,.6)' : 'rgba(255,115,25,.65)'; rctx.beginPath(); rctx.arc(z.x, z.z, z.r, 0, 7); rctx.fill(); });
  // coéquipiers
  remotes.forEach((r) => {
    if (!r.alive || r.team !== myTeam) return;
    rctx.fillStyle = myTeam === 'T' ? '#e0a040' : '#5aa0ff';
    rctx.beginPath(); rctx.arc(r.g.position.x, r.g.position.z, 1.4, 0, 7); rctx.fill();
  });
  // bombe
  const b = S.b;
  if (b.s === 'planted' || (b.s === 'dropped' && myTeam === 'T')) {
    rctx.fillStyle = '#ff3030'; rctx.beginPath(); rctx.arc(b.x, b.z, 1.7, 0, 7); rctx.fill();
  }
  rctx.restore();
  rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.moveTo(c, c - 8); rctx.lineTo(c + 5, c + 5); rctx.lineTo(c - 5, c + 5); rctx.closePath(); rctx.fill();
}

// carte complète (touche M) : vue du dessus, nord en haut. Le décor est dessiné une fois par carte.
const bigmap = $('bigmap'), bctx = bigmap.getContext('2d');
const BIG = bigmap.width;
let BIGS = BIG / 84;   // pixels par mètre : la carte et une petite marge (recalculé pour chaque carte)
const bx = (x) => BIG / 2 + x * BIGS, bz = (z) => BIG / 2 + z * BIGS;
let bigBg = null, bigId = '';
function bigBackground() {
  const c = document.createElement('canvas'); c.width = c.height = BIG;
  const g = c.getContext('2d');
  BIGS = BIG / (2 * Math.max(MAP.hx, MAP.hz) + 4);
  g.fillStyle = 'rgba(12,15,18,.84)'; g.fillRect(0, 0, BIG, BIG);
  g.fillStyle = (MAP.style || MAP.id) === 'dust' ? '#5e5442' : '#40454a'; g.fillRect(bx(-MAP.hx), bz(-MAP.hz), 2 * MAP.hx * BIGS, 2 * MAP.hz * BIGS);
  BOXES.forEach((b) => {
    if (b.t === 'barrel') g.fillStyle = '#8b8f93';
    else if (b.t === 'cont') g.fillStyle = '#' + (b.c || 0x777777).toString(16).padStart(6, '0');
    else if (b.t === 'w') g.fillStyle = '#92876f';
    else if (b.h <= 2.7) g.fillStyle = '#9a7443';
    else g.fillStyle = '#1b1f23';
    g.fillRect(bx(b.x - b.w / 2), bz(b.z - b.d / 2), b.w * BIGS, b.d * BIGS);
  });
  // murs disparus : contour en pointillés
  g.setLineDash([6, 6]); g.strokeStyle = 'rgba(201,155,255,.85)'; g.lineWidth = 2;
  hiddenSet.forEach((i) => { const b = MAP.boxes[i]; if (b) g.strokeRect(bx(b.x - b.w / 2), bz(b.z - b.d / 2), b.w * BIGS, b.d * BIGS); });
  g.setLineDash([]);
  Object.keys(SITES).forEach((k) => {
    const st = SITES[k];
    g.fillStyle = 'rgba(216,67,47,.2)'; g.strokeStyle = 'rgba(232,80,58,.95)'; g.lineWidth = 3;
    g.beginPath(); g.arc(bx(st.x), bz(st.z), st.r * BIGS, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, bx(st.x), bz(st.z));
  });
  g.font = 'bold 18px Arial'; g.textAlign = 'center';
  const sT = MAP.spawns.T[0], sC = MAP.spawns.CT[0];
  g.fillStyle = '#5aa0ff'; g.fillText('DÉPART CT', bx(sC.x), bz(sC.z) + 30);
  g.fillStyle = '#e0a040'; g.fillText('DÉPART T', bx(sT.x), bz(sT.z) - 18);
  return c;
}
function drawBigMap() {
  if (bigId !== MAP.id + '|' + hiddenSig) { bigBg = bigBackground(); bigId = MAP.id + '|' + hiddenSig; }
  const g = bctx;
  g.clearRect(0, 0, BIG, BIG); g.drawImage(bigBg, 0, 0);
  const col = myTeam === 'T' ? '#e0a040' : '#5aa0ff';
  zones.forEach((z) => { g.fillStyle = z.k === 'smoke' ? 'rgba(195,200,208,.7)' : 'rgba(255,115,25,.75)'; g.beginPath(); g.arc(bx(z.x), bz(z.z), z.r * BIGS, 0, 7); g.fill(); });
  // coéquipiers seulement, comme sur le radar
  g.font = 'bold 17px Arial'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  remotes.forEach((r) => {
    if (!r.alive || r.team !== myTeam) return;
    const x = bx(r.g.position.x), y = bz(r.g.position.z);
    g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillText(r.e.n, x, y - 11);
  });
  const b = S.b;
  if (b.s === 'planted' || (b.s === 'dropped' && myTeam === 'T')) {
    const blink = b.s !== 'planted' || Math.floor(performance.now() / 300) % 2 === 0;
    if (blink) { g.fillStyle = '#ff3030'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(bx(b.x), bz(b.z), 10, 0, 7); g.fill(); g.stroke(); }
  }
  if (alive()) { // toi : flèche dans le sens du regard
    g.save(); g.translate(bx(P.x), bz(P.z)); g.rotate(-P.yaw);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -17); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}

const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
let hudAcc = 0;
function updateHud() {
  const me = S.me; if (!me) return;
  const mine = myTeam === 'CT' ? 'CT' : 'T', opp = mine === 'T' ? 'CT' : 'T';
  const col = { T: '#e0a040', CT: '#5aa0ff' };
  $('sCT').textContent = S.sc[mine]; $('sCT').style.color = col[mine];
  $('sCT').nextElementSibling.textContent = 'TOI · ' + teamName(mine).toUpperCase();
  $('sT').textContent = S.sc[opp]; $('sT').style.color = col[opp];
  $('sT').nextElementSibling.textContent = teamName(opp).toUpperCase();
  const left = Math.max(0, S.te - (performance.now() - S.recv) / 1000);
  const t = $('timer');
  t.classList.toggle('bomb', S.b.s === 'planted');
  t.textContent = S.ph === 'wait' ? '--:--' : fmt(left);
  $('roundl').textContent = S.pm === 'range' ? 'Stand de tir' : S.pm === 'sandbox' ? 'Zone de test' : 'Manche ' + S.rd + (S.ph === 'freeze' ? ' · achat' : '') + (S.md ? ' · désordre' : '');
  if (S.pm) renderPracHud();
  $('hpn').textContent = me.hp; $('hpn').classList.toggle('low', me.hp <= 30);
  $('arn').textContent = me.ar;
  $('money').textContent = S.pm ? 'GRATUIT' : '$' + me.mo;
  const w = WEAPONS[cur], a = ammo[cur];
  $('wname').textContent = w.n + (jammed(cur) ? ' · BLOQUÉE ' + Math.ceil(S.jm.t) + ' s' : '') + (reloading ? ' · rechargement…' : '');
  $('wname').style.color = jammed(cur) ? DZ : '';
  $('mag').textContent = isNade(cur) ? nHave(cur) : w.mag && a ? a.mag : '-'; $('res').textContent = w.mag && a ? a.res : '-';
  renderNadeHud();
  $('icons').textContent = (S.iv > 0 ? 'Commandes inversées ' + Math.ceil(S.iv) + ' s · ' : '') + (me.bm ? 'Bombe · ' : '') + (me.he ? 'Casque · ' : '') + (me.k ? 'Kit' : '');
  if (ui.buy) { if (!me.bo || !me.al) closeBuy(true); else renderBuy(); }

  // invites
  let prompt = '';
  if (me.al) {
    if (me.bm && S.ph === 'live') {
      const inSite = Object.keys(SITES).some((k) => Math.hypot(P.x - SITES[k].x, P.z - SITES[k].z) <= SITES[k].r);
      if (inSite) prompt = 'Maintiens ' + Settings.key('use') + ' pour poser la bombe';
    }
    if (myTeam === 'CT' && S.b.s === 'planted' && Math.hypot(P.x - S.b.x, P.z - S.b.z) < 2.4) prompt = 'Maintiens ' + Settings.key('use') + ' pour désamorcer';
    if (!prompt) {
      const d = nearestDrop();
      if (d) {
        const W = WEAPONS[d.w], held = W.slot === 1 ? me.p : me.s;
        prompt = Settings.key('use') + (held ? ' : échanger contre ' : ' : ramasser ') + W.n + ' (' + d.m + ' / ' + d.s + ')';
      }
    }
    if (!prompt && isNade(cur) && S.ph === 'freeze') prompt = 'Les grenades se lancent une fois la manche commencée';
    if (S.ph === 'freeze' && !prompt) prompt = Settings.key('buy') + ' : boutique';
    if (!prompt && S.pm === 'range' && !RG.on) prompt = Settings.key('tools') + ' : choisir la difficulté et commencer · ' + Settings.key('buy') + ' : armes gratuites';
    if (!prompt && S.pm === 'sandbox' && PR.hintT > 0) prompt = Settings.key('tools') + ' : outils de test (mannequins, invincible, vol libre…) · ' + Settings.key('buy') + ' : armes gratuites';
  }
  $('prompt').textContent = prompt;
  $('progw').style.display = me.pg > 0 ? 'block' : 'none';
  $('prog').style.width = Math.round(me.pg * 100) + '%';

  // spectateur
  const spec = $('spec');
  if (!me.al && connected && (S.ph === 'live' || S.ph === 'freeze' || S.ph === 'end')) {
    const r = specId && remotes.get(specId);
    spec.textContent = S.pm ? 'Réapparition dans quelques secondes…' : r && r.alive ? 'Spectateur : ' + r.e.n + ' (clic pour changer)' : 'Tu es mort : prochaine manche bientôt';
  } else spec.textContent = '';

  if (ui.board) renderBoard(); $('board').classList.toggle('hide', !ui.board);
}

// bandeau du stand de tir / de la zone de test et infos de test
let pracSig = '', infoSig = '';
function renderPracHud() {
  let h;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (S.pm === 'range') {
    const D = RANGE_DIFF[RG.diff];
    if (RG.on) {
      const acc = RG.shots ? Math.round(RG.hits / RG.shots * 100) + ' %' : '—';
      const time = RG.cd > 0 ? 'Prêt…' : RG.dur ? fmt(RG.left) : '∞';
      h = '<div class="pt">' + D.n + '</div><div class="pc"><b class="' + (RG.dur && RG.left < 10 && RG.cd <= 0 ? 'low' : '') + '">' + time + '</b><small>TEMPS</small></div>' +
        '<div class="pc"><b>' + RG.score + '</b><small>POINTS</small></div><div class="pc"><b>' + RG.hits + '</b><small>TOUCHÉES</small></div>' +
        '<div class="pc"><b>' + RG.miss + '</b><small>RATÉES</small></div><div class="pc"><b>' + acc + '</b><small>PRÉCISION</small></div>' +
        '<div class="pc"><b class="' + (RG.combo >= 3 ? 'gold' : '') + '">×' + RG.combo + '</b><small>SÉRIE</small></div>';
    } else h = '<div class="pt">STAND DE TIR</div><div class="pm">' + D.n + ' · ' + (RG.dur ? RG.dur + ' s' : 'libre') + ' · ' + esc(Settings.key('tools')) + ' pour commencer</div>';
  } else {
    const f = [PR.god ? 'INVINCIBLE' : '', PR.infMag ? 'MUNITIONS INFINIES' : '', PR.infNades ? 'GRENADES ILLIMITÉES' : '', PR.fly ? 'VOL LIBRE' : '', dummies.size ? dummies.size + ' MANNEQUIN' + (dummies.size > 1 ? 'S' : '') : ''].filter(Boolean);
    h = '<div class="pt dz">ZONE DE TEST · ' + esc(MAP.name.toUpperCase()) + '</div><div class="pm">' + (f.length ? f.join(' · ') : 'Mode normal') + ' · ' + esc(Settings.key('tools')) + ' : outils</div>';
  }
  if (h !== pracSig) { pracSig = h; $('prac').innerHTML = h; }
  // infos de test (zone de test)
  const show = S.pm === 'sandbox' && PR.info;
  $('testinfo').classList.toggle('hide', !show);
  if (show) {
    const w = WEAPONS[cur], sp = Math.hypot(P.vx, P.vz);
    const t = 'X ' + P.x.toFixed(1) + '  Y ' + P.y.toFixed(2) + '  Z ' + P.z.toFixed(1) + '\n' +
      'Vitesse ' + sp.toFixed(1) + ' m/s · ' + (PR.fly ? 'vol libre' : P.ground ? 'au sol' : 'en l\'air') + (P.crouch > 0.5 ? ' · accroupi' : '') + '\n' +
      'Arme ' + w.n + (w.dmg ? ' · ' + w.dmg + ' dégâts · dispersion ' + (spreadNow(w) * 1000).toFixed(1) + ' mrad' : '') + '\n' +
      (PR.lastHit ? 'Dernier tir : ' + PR.lastHit : 'Tire sur un mannequin pour voir le détail des dégâts');
    if (t !== infoSig) { infoSig = t; $('testinfo').textContent = t; }
  }
}

// grenades portées, avec leur touche : « 4 FLASH ×2 · 5 FUMI » (celle en main en blanc)
let nadeSig = '';
function renderNadeHud() {
  const keys = { flash: 'nade1', smoke: 'nade2', he: 'nade3', molo: 'nade4' };
  const list = NADES.filter((k) => nHave(k) > 0).map((k) => [k, Settings.key(keys[k]) + ' ' + NADE_UI[k].short + (nHave(k) > 1 ? ' ×' + nHave(k) : '')]);
  const sig = JSON.stringify([list, cur]); if (sig === nadeSig) return; nadeSig = sig;
  const box = $('nades'); box.textContent = '';
  list.forEach(([k, t], i) => {
    if (i) box.appendChild(document.createTextNode(' · '));
    const e = document.createElement(k === cur ? 'b' : 'span'); e.textContent = t; box.appendChild(e);
  });
}

function renderBoard() {
  const rows = Array.from(S.pl.values());
  const board = $('board'); board.textContent = '';
  const head = document.createElement('div'); head.className = 'head';
  const mine = myTeam === 'CT' ? 'CT' : 'T', opp = mine === 'T' ? 'CT' : 'T';
  const l = document.createElement('span'); l.className = 't' + mine; l.textContent = 'Toi · ' + teamName(mine) + ' ' + S.sc[mine];
  const rr = document.createElement('span'); rr.className = 't' + opp; rr.textContent = teamName(opp) + ' ' + S.sc[opp];
  head.append(l, rr); board.appendChild(head);
  [mine, opp].forEach((tm) => {
    const tb = document.createElement('table');
    tb.innerHTML = '<tr><th>' + teamName(tm) + '</th><th class="num">★</th><th class="num">ACE</th><th class="num">Kills</th><th class="num">Morts</th></tr>';
    rows.filter((p) => p.t === tm).sort((a, b) => b.k - a.k || a.d - b.d).forEach((p) => {
      const tr = document.createElement('tr');
      if (p.i === myId) tr.className = 'me'; if (!p.a) tr.className += ' dead';
      const a = document.createElement('td'); a.textContent = p.n; a.className = 't' + tm;
      if (p.vf) { const v = document.createElement('small'); v.className = 'blv'; v.textContent = ' ✔ nv ' + p.lv; v.title = 'Compte joueur'; a.appendChild(v); }
      const b = document.createElement('td'); b.className = 'num'; b.textContent = p.k;
      const c = document.createElement('td'); c.className = 'num'; c.textContent = p.d;
      const mv = document.createElement('td'); mv.className = 'num'; mv.textContent = p.mv || '';
      const ac = document.createElement('td'); ac.className = 'num ac'; ac.textContent = p.ac || '';
      tr.append(a, mv, ac, b, c); tb.appendChild(tr);
    });
    board.appendChild(tb);
  });
}


/* ============================================================
   Lobby
   ============================================================ */
let lbSig = '';
function leaveLobby() { leaving = true; try { sessionStorage.setItem('cs_menu', '1'); } catch (e) {} try { ws.close(); } catch (e) {} location.reload(); }
$('lbBack').addEventListener('click', leaveLobby);
// raccourcis du lobby : on quitte la salle et on entre directement dans l'entraînement
function goPractice(mode) { leaving = true; try { sessionStorage.setItem('cs_go', mode); } catch (e) {} try { ws.close(); } catch (e) {} location.reload(); }
$('lbRange').addEventListener('click', () => goPractice('range'));
$('lbTest').addEventListener('click', () => goPractice('sandbox'));
$('lbAcc').addEventListener('click', () => Account.open());
$('lbPass').addEventListener('click', () => Pass.open());
$('lbJoinT').addEventListener('click', () => send({ type: 'team', team: 'T' }));
$('lbJoinCT').addEventListener('click', () => send({ type: 'team', team: 'CT' }));
$('lbReady').addEventListener('click', () => { const on = !(S.pl && S.pl.get(myId) && S.pl.get(myId).rdy); send({ type: 'ready', on: on ? 1 : 0 }); });
$('lbStart').addEventListener('click', () => send({ type: 'start' }));
$('lbIn').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.code === 'Enter') { const t = $('lbIn').value.trim(); if (t) send({ type: 'chat', text: t }); $('lbIn').value = ''; }
  else if (e.code === 'Escape') $('lbIn').blur();
});
function renderLobby(m) {
  const lobby = $('lobby'); lobby.classList.remove('hide');
  const host = S.ho, isHost = host === myId, list = m.pl.slice();
  const sig = JSON.stringify([list.map((e) => [e.i, e.n, e.t, e.rdy]), host, m.mp, m.md, Math.ceil(S.lc || 0)]);
  if (sig === lbSig) return; lbSig = sig;
  const mine = (list.find((e) => e.i === myId) || {}).t, meRdy = !!(list.find((e) => e.i === myId) || {}).rdy;
  $('lbRoom').textContent = 'SALLE « ' + (joinInfo.room || '') + ' »';
  // cartes
  const mp = $('lbMaps'); mp.innerHTML = '';
  Object.keys(MAPS).forEach((id) => {
    if (MAPS[id].practice || /^l_/.test(id) || (MAPS[id].custom && id !== m.mp)) return;   // ni entraînement, ni cartes perso (sauf celle de la salle)
    const b = document.createElement('button'); b.className = id === m.mp ? 'on' : ''; b.disabled = !isHost;
    b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = MAPS[id].name.toUpperCase(); b.lastChild.textContent = isHost ? '' : (id === m.mp ? 'choisie par l\u2019hôte' : '');
    b.addEventListener('click', () => send({ type: 'lmap', map: id }));
    mp.appendChild(b);
  });
  // mode
  const mdBox = $('lbModes'); mdBox.innerHTML = '';
  [['', 'BOMBE', 'classique'], ['desordre', 'RIEN N’EST À SA PLACE', 'désordre']].forEach(([id, n, d]) => {
    const on = (m.md ? 'desordre' : '') === id;
    const b = document.createElement('button'); b.className = (on ? 'on' : '') + (id ? ' dz' : ''); b.disabled = !isHost;
    b.innerHTML = '<b></b><small></small>'; b.firstChild.textContent = n; b.lastChild.textContent = d;
    b.addEventListener('click', () => send({ type: 'lmode', mode: id }));
    mdBox.appendChild(b);
  });
  // équipes
  ['T', 'CT'].forEach((t) => {
    const box = $(t === 'T' ? 'lbT' : 'lbCT'); box.innerHTML = '';
    const mem = list.filter((e) => e.t === t);
    for (let i = 0; i < 5; i++) {
      const e = mem[i], d = document.createElement('div'); d.className = 'slot' + (e ? '' : ' free') + (e && e.i === myId ? ' me' : '');
      if (!e) d.textContent = '— place libre —';
      else {
        const n = document.createElement('span'); n.textContent = (e.i === host ? '★ ' : '') + e.n + (e.i === myId ? ' (toi)' : ''); d.appendChild(n);
        const s = document.createElement('em'); s.textContent = e.rdy ? 'PRÊT' : '…'; if (e.rdy) s.className = 'ok'; d.appendChild(s);
        if (isHost && e.i !== myId) { const k = document.createElement('button'); k.textContent = '✕'; k.title = 'Expulser'; k.addEventListener('click', () => send({ type: 'kick', id: e.i })); d.appendChild(k); }
      }
      box.appendChild(d);
    }
  });
  $('lbJoinT').style.display = mine === 'T' ? 'none' : ''; $('lbJoinCT').style.display = mine === 'CT' ? 'none' : '';
  $('lbCount').textContent = list.length + '/10';
  // bas
  const everyone = list.length > 0 && list.every((e) => e.rdy);
  $('lbMode').textContent = (m.md ? 'DÉSORDRE' : 'BOMBE') + ' · ' + ((MAPS[m.mp] || {}).name || '').toUpperCase();
  $('lbWait').textContent = list.length < 2 ? 'SEUL DANS LE LOBBY · INVITE TES AMIS OU LANCE' : everyone ? 'TOUT LE MONDE EST PRÊT' : 'EN ATTENTE DES JOUEURS PRÊTS…';
  $('lbCountdown').textContent = S.lc > 0 ? 'LA PARTIE COMMENCE DANS ' + Math.ceil(S.lc) + '…' : '';
  const rb = $('lbReady'); rb.textContent = meRdy ? 'ANNULER' : 'PRÊT'; rb.classList.toggle('on', !meRdy);
  const sb = $('lbStart'); sb.style.display = isHost ? '' : 'none'; sb.disabled = false;
}

function refreshOverlays() {
  $('menu').classList.toggle('hide', connected);
  $('hud').classList.toggle('hide', !connected || inLobby());
  $('pause').classList.toggle('hide', !(connected && !locked && !ui.buy && !ui.panel && !inLobby()));
  $('pracPause').classList.toggle('hide', !practice());
  $('top').classList.toggle('hide', practice());
  $('prac').classList.toggle('hide', !practice());
  $('scope').style.display = scoped && alive() ? 'block' : 'none';
  $('cross').style.display = scoped || aiming || !alive() || cur === 'knife' || isNade(cur) ? 'none' : 'block';
}

/* ============================================================
   Boucle principale
   ============================================================ */
let last = performance.now(), sendAcc = 0, ovAcc = 0, menuT = 0, sunAcc = 0, heartT = 0, crossGap = 6;
function update(dt, now) {
  const w = WEAPONS[cur];
  const isAlive = alive();
  if (!isAlive) crouchTog = false;
  const frozen = S.ph === 'freeze' || S.ph === 'wait';
  // visée au clic droit (toutes les armes sauf couteau et armes à lunette)
  // pose / désamorçage de la bombe en cours ? (progression envoyée par le serveur)
  const meAct = isAlive && S.me.pg > 0 ? (myTeam === 'T' ? 1 : 2) : 0;
  if (meAct) { if (!actFp) { tapN = 0; snipN = 0; Snd.part('draw'); } actKindFp = meAct; actTFp += dt; scoped = false; reloading = false; }
  actFp += ((meAct ? 1 : 0) - actFp) * Math.min(1, 9 * dt);
  if (!meAct && actFp < 0.01) { actFp = 0; actTFp = 0; }
  aiming = rmbHeld && isAlive && locked && cur !== 'knife' && !isNade(cur) && !w.scope && !reloading && swapT <= 0 && !ui.buy && !ui.chat && actFp < 0.1;
  adsT += ((aiming ? 1 : 0) - adsT) * Math.min(1, 11 * dt);
  P.tag = Math.max(0, P.tag - dt); P.landT = Math.max(0, P.landT - dt * 2.2);

  // --- mouvement (inertie : on ne s'arrête pas net)
  if (isAlive) {
    let f = (down('fwd') ? 1 : 0) - (down('back') ? 1 : 0);
    let r = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
    if (S.iv > 0) { f = -f; r = -r; }   // désordre : commandes inversées
    const len = Math.hypot(f, r) || 1;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const crouching = cfg.toggleCrouch ? crouchTog : down('crouch');
    const back = f < 0 ? 0.85 : 1;
    let spd = 6.1 * (w.spd || 1) * back * (down('walk') ? 0.5 : 1) * (crouching ? 0.42 : 1) * (scoped ? 0.55 : 1) * (aiming ? 0.62 : 1) * (P.tag > 0 ? 0.55 : 1) * (1 - P.landT * 0.55);
    if (frozen) spd = 0;
    const tx = (-sy * f + cy * r) / len * spd, tz = (-cy * f - sy * r) / len * spd;
    if (PR.fly && isSandbox()) {   // zone de test : vol libre, sans gravité ni collisions
      const k2 = Math.min(1, 8 * dt), fs = 10 * (down('walk') ? 0.35 : 1), up = (down('jump') ? 1 : 0) - (down('crouch') ? 1 : 0);
      P.vx += ((-sy * f + cy * r) / len * fs - P.vx) * k2; P.vz += ((-cy * f - sy * r) / len * fs - P.vz) * k2; P.vy += (up * fs * 0.8 - P.vy) * k2;
      P.x = clamp(P.x + P.vx * dt, -MAP.hx + 0.4, MAP.hx - 0.4); P.z = clamp(P.z + P.vz * dt, -MAP.hz + 0.4, MAP.hz - 0.4); P.y = clamp(P.y + P.vy * dt, 0, 40);
      P.ground = true; P.landT = 0; P.crouch += (0 - P.crouch) * Math.min(1, 9 * dt);
    } else {
    const moving = f || r, ctl = P.ground ? (moving ? 9 : 12) : 0.9;
    P.vx += (tx - P.vx) * Math.min(1, ctl * dt); P.vz += (tz - P.vz) * Math.min(1, ctl * dt);
    P.crouch += ((crouching ? 1 : 0) - P.crouch) * Math.min(1, 9 * dt);
    P.stam = Math.min(1, P.stam + dt * 0.45);
    if (down('jump') && P.ground && !frozen) { P.vy = 6.5 * (0.72 + 0.28 * P.stam); P.ground = false; P.stam = Math.max(0, P.stam - 0.55); }
    P.vy -= 21 * dt;
    P.x += P.vx * dt; P.z += P.vz * dt;
    collide();
    const vy0 = P.vy;
    P.y += P.vy * dt;
    const g = groundAt(P.x, P.z, P.y);
    if (P.y <= g) {
      if (!P.ground && vy0 < -2.5) {
        const hard = clamp(-vy0 / 9, 0, 1);
        P.landT = Math.max(P.landT, 0.2 + 0.5 * hard); P.dipV = -1.2 * hard - 0.5;
        Snd.land(surfaceAt(P.x, P.z, g), 0.4 + hard * 0.5);
      }
      P.y = g; P.vy = 0; P.ground = true;
    } else P.ground = false;
    const sp = Math.hypot(P.vx, P.vz);
    if (P.ground && sp > 0.5) {
      P.bob += dt * sp * 2.05; P.stepD += sp * dt;
      if (P.stepD > 2.15) { P.stepD = 0; if (sp > 3.3 && !down('walk') && !crouching) Snd.step(surfaceAt(P.x, P.z, P.y), 0.32); }
    }
    }
    P.roll += (clamp(r * Math.min(1, Math.hypot(P.vx, P.vz) / 6), -1, 1) * 0.012 - P.roll) * Math.min(1, 8 * dt);
    // affaissement à l'atterrissage (ressort amorti)
    P.dipV += (-P.dip * 90 - P.dipV * 14) * dt; P.dip += P.dipV * dt;
  }

  // --- armes
  swapT = Math.max(0, swapT - dt);
  if (thrT >= 0) {           // lancer de grenade en cours
    if (!isAlive) thrT = -1;
    else { thrT += dt; if (!thrSent && thrT >= 0.22) releaseNade(); if (thrT >= 0.5) afterThrow(); }
  }
  if (reloading) {
    const a = ammo[cur], W = WEAPONS[cur];
    if (W.shell) { // cartouche par cartouche
      if (now >= rlNext && a && a.mag < W.mag && a.res > 0) { rlNext += 0.5; a.mag++; if (!practice()) a.res--; Snd.part('shell'); }
      if (now >= rlEnd || !a || a.mag >= W.mag || a.res <= 0) { reloading = false; if (a && W.pump && rlEmpty) { boltT = 1; Snd.part('pump'); } }
    } else if (now >= rlEnd) {
      reloading = false;
      if (a) { const take = Math.min(W.mag - a.mag, a.res); a.mag += take; if (!practice()) a.res -= take; }   // entraînement : réserve illimitée
    }
  }
  if (isAlive && canShoot()) {
    if (w.auto ? fireHeld : fireLatch) fire();
  }
  // retour du recul quand on cesse de tirer
  const firing = now - lastShot < Math.max(0.16, w.rof * 1.4);
  if (!firing) {
    const k = Math.exp(-(w.scope ? 5 : 7.5) * dt);
    P.recP *= k; P.recY *= k;
    P.burst = Math.max(0, P.burst - dt * 16);
    if (P.burst < 1) recSeed = Math.random() * 6.28;
  }
  vmKick -= vmKick * Math.min(1, 11 * dt);
  if (flashT > 0) { flashT -= dt; if (flashT <= 0 && vmFlash) vmFlash.visible = false; }
  if (!isAlive) { fireHeld = false; fireLatch = false; P.recP = P.recY = 0; }

  // --- caméra
  let ey = P.y + eyeHeight() + P.dip * 0.6, cx = P.x, cz = P.z, yaw = P.yaw + P.recY, pitch = P.pitch + P.recP, showVM = isAlive, roll = -P.roll;
  if (!isAlive && connected) {
    // d'abord on s'effondre (≈ 0,6 s), ensuite seulement on passe en spectateur
    P.deadT += dt;
    let r = specId && remotes.get(specId);
    if ((!r || !r.alive) && P.deadT > 1.8) { specId = null; cycleSpec(); r = specId && remotes.get(specId); }
    if (P.deadT > 1.8 && r && r.alive) { cx = r.g.position.x; cz = r.g.position.z; ey = r.g.position.y + (r.e.c ? 1.15 : 1.62); yaw = r.g.rotation.y; pitch = r.e.p || 0; }
    else {
      const d = Math.min(1, P.deadT * 1.7), fall = d * d, sm = d * d * (3 - 2 * d);
      ey = P.y + eyeHeight() - (eyeHeight() - 0.28) * fall;
      roll = P.deadSide * 1.0 * sm;
      pitch += P.deadHs ? 0.45 * Math.sin(Math.min(1, d * 1.6) * Math.PI * 0.5) - 0.1 * d : -0.4 * Math.sin(d * Math.PI) + 0.25 * d;
      cx += Math.sin(yaw) * 0.45 * sm * P.deadDir; cz += Math.cos(yaw) * 0.45 * sm * P.deadDir;
    }
    showVM = false;
  }
  if (isAlive) P.deadT = 0;
  if (isAlive && actFp > 0.01) { pitch -= 0.3 * sstep(actFp); ey -= 0.1 * sstep(actFp); }   // on se baisse et on regarde la bombe
  // respiration et tremblement de lunette (Maj pour retenir son souffle)
  if (scoped) {
    const k = down('walk') ? 0.2 : 1, t = now;
    pitch += (Math.sin(t * 0.9) * 0.0028 + Math.sin(t * 2.1) * 0.0011) * k; yaw += Math.cos(t * 0.67) * 0.0034 * k;
  } else if (isAlive) pitch += Math.sin(now * 1.2) * 0.00045;
  const mv = Math.min(1, Math.hypot(P.vx, P.vz) / 5);
  const bob = isAlive ? Math.sin(P.bob) * 0.016 * cfg.bob * mv * (1 - adsT * 0.7) : 0;
  P.shake = Math.max(0, P.shake - dt * 1.3);
  const sh = P.shake * 0.05 * cfg.shake;
  cam.position.set(cx + (Math.random() - 0.5) * sh, ey + bob + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
  cam.rotation.set(pitch + (Math.random() - 0.5) * sh, yaw, roll + (Math.random() - 0.5) * sh * 0.5);
  const optic = V && V.info.optic;
  const wantFov = scoped ? (cur === 'awp' ? 14 : 20) : aiming ? FOV * (optic ? 0.53 : 0.765) : FOV;
  if (Math.abs(cam.fov - wantFov) > 0.05) { cam.fov += (wantFov - cam.fov) * Math.min(1, 12 * dt); cam.updateProjectionMatrix(); }
  const vfov = 50 - adsT * 8;
  if (Math.abs(vmCam.fov - vfov) > 0.05) { vmCam.fov = vfov; vmCam.updateProjectionMatrix(); }
  poseVM(dt, now, showVM);

  // bras éclairés selon qu'on est au soleil ou à l'ombre
  sunAcc += dt;
  if (sunAcc > 0.15 && GFX.rays.length) {
    sunAcc = 0;
    rc.set(_v1.set(cx, ey, cz), GFX.sunDir); rc.far = 40;
    P.sunT = rc.intersectObjects(worldMeshes, false).length ? 0 : 1;
  }
  P.sunK += (P.sunT - P.sunK) * Math.min(1, 6 * dt);
  GFX.setVmSun(P.sunK);

  // réticule dynamique : s'ouvre avec la dispersion
  if (isAlive && cur !== 'knife') {
    const px = spreadNow(w) * (window.innerHeight / 2) / Math.tan(cam.fov * Math.PI / 360);
    crossGap += (clamp(px, 3, 70) - crossGap) * Math.min(1, 20 * dt);
    const g = crossGap, c = $('cross').children;
    c[0].style.transform = 'translateY(' + (-g) + 'px)'; c[1].style.transform = 'translateY(' + g + 'px)';
    c[2].style.transform = 'translateX(' + (-g) + 'px)'; c[3].style.transform = 'translateX(' + g + 'px)';
  }
  // blessure grave : battements de coeur
  const hp = S.me ? S.me.hp : 100;
  if (isAlive && hp <= 30) { heartT -= dt; if (heartT <= 0) { heartT = 1.05; Snd.heart(0.5 + (30 - hp) / 60); } }
  $('hurtlow').style.opacity = isAlive && hp <= 30 ? String(0.35 + (30 - hp) / 45) : (!isAlive && connected && P.deadT > 0 && P.deadT < 1.8 ? '1' : '0');

  // --- réseau (état du joueur)
  sendAcc += dt;
  if (sendAcc >= 0.033) {
    sendAcc = 0;
    if (isAlive) send({ type: 'st', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +(P.yaw + P.recY).toFixed(3), pitch: +(P.pitch + P.recP).toFixed(3), c: P.crouch > 0.5 ? 1 : 0, w: cur, rl: reloading ? 1 : 0, am: ammoMsg(), tp: tpSeq });
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  if (cfg.fps) { fpsN++; if (t - fpsT >= 500) { $('fps').textContent = Math.round(fpsN * 1000 / (t - fpsT)) + ' FPS'; fpsN = 0; fpsT = t; } }
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const now = t / 1000;
  if (connected && S.me && !inLobby()) {
    update(dt, now);
    updateRemotes(dt); updateBomb(dt, t); updateDrops(dt); updateNades(dt, now); updateBlind(dt); updatePractice(dt);
    fx.update(dt, (p) => { const s = spatial(p.x, p.y, p.z); if (s.d < 8) Snd.casing(s.v); });
    hudAcc += dt;
    if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
    drawRadar();
    if (ui.map) drawBigMap();
    // fondus HUD
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitm').style.opacity = '0'; }
    if (hurtT > 0) { hurtT -= dt; if (hurtT <= 0) { const h = $('hurt'); h.style.transition = 'opacity .7s'; h.style.opacity = '0'; } }
    if (dmgTimer > 0) { dmgTimer -= dt; if (dmgTimer <= 0) $('dmgdir').firstElementChild.style.opacity = '0'; }
  } else {
    // décor de menu : caméra qui tourne autour de la carte
    menuT += dt * 0.08;
    const orb = 26 * Math.max(MAP.hx, MAP.hz) / 40;
    cam.position.set(Math.sin(menuT) * orb, 7.5 * Math.max(1, orb / 26), Math.cos(menuT) * orb);
    cam.rotation.set(-0.16, menuT, 0);
    poseVM(dt, now, false);
    fx.update(dt);
  }
  // désordre : l'image se déchire juste avant et juste après l'événement
  if (warpWarn > 0) warpWarn = Math.max(0, warpWarn - dt);
  if (warpHit > 0) warpHit = Math.max(0, warpHit - dt);
  const gl = cfg.shake > 0 && ((warpWarn > 0 && warpWarn < 0.9) || warpHit > 0.35);
  if (gl !== glitchOn) { glitchOn = gl; canvas.classList.toggle('glitch', gl); }
  const wo = Math.round((warpHit > 0 ? Math.min(1, warpHit / 0.6) : warpWarn > 0 ? (1 - warpWarn / 3) * 0.55 : 0) * 50) / 50;
  if (wo !== warpOp) { warpOp = wo; $('warp').style.opacity = String(wo); }
  if (banTimer > 0) { banTimer -= dt; if (banTimer <= 0) $('banner').style.opacity = '0'; }
  if (noticeTimer > 0) { noticeTimer -= dt; if (noticeTimer <= 0) $('notice').textContent = ''; }
  ovAcc += dt;
  if (ovAcc > 0.15) { ovAcc = 0; refreshOverlays(); }
  GFX.render(now);
  // grenade flash : on garde l'image qui vient d'être rendue (avant que le navigateur ne vide le canvas)
  if (blindCapNext) {
    blindCapNext = false;
    const bc = $('blindimg'); bc.width = 480; bc.height = Math.round(480 * canvas.height / Math.max(1, canvas.width));
    try { bc.getContext('2d').drawImage(canvas, 0, 0, bc.width, bc.height); } catch (e) {}
  }
}
buildVM('glock');
requestAnimationFrame(frame);

// à l'ouverture du site : direct dans le lobby (sauf si on vient de quitter volontairement)
{
  let skip = false, go = '';
  try { skip = sessionStorage.getItem('cs_menu') === '1'; sessionStorage.removeItem('cs_menu'); go = sessionStorage.getItem('cs_go') || ''; sessionStorage.removeItem('cs_go'); } catch (e) {}
  // depuis le lobby : stand de tir ou zone de test directement
  const cm = new URLSearchParams(location.search).get('cmap');
  if (cm) {   // lien d'une carte partagée : on la charge, on la choisit, puis direction le lobby de la salle
    $('err').textContent = 'Chargement de la carte…';
    loadCustom(cm).then((ok) => {
      if (!ok) { $('err').textContent = 'Carte partagée introuvable sur ce serveur'; return; }
      $('err').textContent = '';
      if (isPracticeMode(chosenMode)) pickMode('');
      chosenMap = cm; setMap(cm); buildMyMaps();
      if (!skip) { $('lobbyChk').checked = true; startGame(); }
    });
  }
  else if (isPracticeMode(go)) { pickMode(go); setTimeout(startGame, 300); }
  else if (!skip) setTimeout(() => { if (isPracticeMode(chosenMode)) pickMode(''); $('lobbyChk').checked = true; startGame(); }, 300);
}
})();
