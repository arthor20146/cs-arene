/* CS Arena - client (three.js r128) */
(function () {
'use strict';
const { CFG, WEAPONS, BOXES, SITES } = CS;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R = CFG.radius;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ============================================================
   Rendu / scène
   ============================================================ */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3e8);
scene.fog = new THREE.Fog(0x9cc3e8, 45, 140);
const cam = new THREE.PerspectiveCamera(78, 1, 0.05, 220);
cam.rotation.order = 'YXZ';
scene.add(cam);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6050, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d8, 0.75);
sun.position.set(30, 60, 20);
scene.add(sun);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cam.aspect = window.innerWidth / window.innerHeight;
  cam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function canvasTex(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size || 128;
  draw(c.getContext('2d'), c.width);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const sandTex = canvasTex((g, s) => {
  g.fillStyle = '#c9b287'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = (i % 2 ? 'rgba(110,85,50,' : 'rgba(255,245,210,') + (Math.random() * 0.14) + ')';
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  g.strokeStyle = 'rgba(80,60,30,.18)'; g.strokeRect(0, 0, s, s);
});
const wallTex = canvasTex((g, s) => {
  g.fillStyle = '#b79c6c'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(70,50,25,.45)'; g.lineWidth = 2;
  for (let y = 0; y < 4; y++) {
    const yy = y * s / 4; g.beginPath(); g.moveTo(0, yy); g.lineTo(s, yy); g.stroke();
    for (let x = 0; x < 2; x++) { const xx = ((x + (y % 2) * 0.5) * s / 2) % s; g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + s / 4); g.stroke(); }
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(60,40,20,' + Math.random() * 0.08 + ')'; g.fillRect(Math.random() * s, Math.random() * s, 3, 3); }
});
const crateTex = canvasTex((g, s) => {
  g.fillStyle = '#8a6335'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#4e3418'; g.lineWidth = 5; g.strokeRect(3, 3, s - 6, s - 6);
  g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  for (let i = 0; i < 200; i++) { g.fillStyle = 'rgba(40,20,0,' + Math.random() * 0.1 + ')'; g.fillRect(Math.random() * s, Math.random() * s, 2, 8); }
});

const worldMeshes = [];
(function buildWorld() {
  const gt = sandTex.clone(); gt.needsUpdate = true; gt.repeat.set(24, 24);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground); worldMeshes.push(ground);
  BOXES.forEach((b) => {
    const crate = b.h <= 2.7;
    const t = (crate ? crateTex : wallTex).clone(); t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(Math.max(b.w, b.d) / 3)), Math.max(1, Math.round(b.h / 3)));
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ map: t }));
    m.position.set(b.x, b.h / 2, b.z);
    scene.add(m); worldMeshes.push(m);
  });
  Object.keys(SITES).forEach((k) => {
    const s = SITES[k];
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.35, s.r, 56), new THREE.MeshBasicMaterial({ color: 0xd8432f, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.03, s.z); scene.add(ring);
    const lt = canvasTex((g, sz) => { g.clearRect(0, 0, sz, sz); g.fillStyle = 'rgba(216,67,47,.8)'; g.font = 'bold 110px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, sz / 2, sz / 2 + 6); }, 128);
    lt.wrapS = lt.wrapT = THREE.ClampToEdgeWrapping;
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: lt, transparent: true }));
    letter.rotation.x = -Math.PI / 2; letter.position.set(s.x, 0.04, s.z); scene.add(letter);
  });
})();

/* ============================================================
   État
   ============================================================ */
let ws = null, myId = null, myTeam = null, connected = false, locked = false;
let joinInfo = { name: '', room: 'main', team: 'auto' };
const S = { ph: 'wait', te: 0, rd: 0, sc: { T: 0, CT: 0 }, b: { s: 'none', x: 0, z: 0 }, pl: new Map(), me: null, recv: 0, names: new Map() };
const ui = { buy: false, chat: false, board: false };
const K = {};
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, kick: 0, burst: 0, ground: true, crouch: 0, shake: 0, bob: 0, stepD: 0 };
let cur = 'glock', lastCur = 'knife', ammo = {}, reloading = false, rlEnd = 0, nextShot = 0, swapT = 0;
let fireHeld = false, fireLatch = false, scoped = false, rmbHeld = false, aiming = false, adsT = 0, needRefill = false, lastInv = { p: null, s: null };
let specId = null, banTimer = 0, noticeTimer = 0, hitTimer = 0, dmgTimer = 0;
let sens = parseFloat(store.get('cs_sens', '1')) || 1;
let vol = parseFloat(store.get('cs_vol', '0.6'));
if (!isFinite(vol)) vol = 0.6;
const remotes = new Map();

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
  P.x = clamp(P.x, -39.6, 39.6); P.z = clamp(P.z, -39.6, 39.6);
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
const fxPool = [];
for (let i = 0; i < 90; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  m.visible = false; scene.add(m); fxPool.push({ m, v: new THREE.Vector3(), life: 0 });
}
let fxIdx = 0;
function puff(pos, color, n, speed, grav) {
  for (let i = 0; i < n; i++) {
    const f = fxPool[fxIdx++ % fxPool.length];
    f.m.position.copy(pos); f.m.material.color.setHex(color); f.m.visible = true;
    f.v.set((Math.random() - 0.5), Math.random() * 0.8 + 0.1, (Math.random() - 0.5)).multiplyScalar(speed || 3);
    f.life = 0.35 + Math.random() * 0.25; f.g = grav == null ? 9 : grav;
  }
}
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 }));
  l.visible = false; l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 });
}
let trIdx = 0;
function tracer(a, b) {
  const t = tracers[trIdx++ % tracers.length];
  const p = t.l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
  t.l.visible = true; t.life = 0.06;
}
const holes = [];
const holeGeo = new THREE.PlaneGeometry(0.14, 0.14);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
function hole(point, normal) {
  let h;
  if (holes.length < 60) { h = new THREE.Mesh(holeGeo, holeMat); scene.add(h); holes.push(h); }
  else { h = holes.shift(); holes.push(h); }
  h.position.copy(point).addScaledVector(normal, 0.012);
  h.lookAt(point.clone().add(normal));
  h.visible = true;
}
function clearHoles() { holes.forEach((h) => { h.visible = false; }); }

function updateFx(dt) {
  fxPool.forEach((f) => {
    if (!f.m.visible) return;
    f.life -= dt;
    if (f.life <= 0) { f.m.visible = false; return; }
    f.v.y -= f.g * dt;
    f.m.position.addScaledVector(f.v, dt);
  });
  tracers.forEach((t) => { if (t.l.visible) { t.life -= dt; if (t.life <= 0) t.l.visible = false; } });
}

/* ============================================================
   Bombe
   ============================================================ */
const bombMesh = new THREE.Group();
const bombLed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x550000 }));
bombLed.position.set(0.15, 0.2, 0);
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.4), new THREE.MeshLambertMaterial({ color: 0x3b4a30 }));
  body.position.y = 0.1;
  bombMesh.add(body, bombLed);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.42), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  strap.position.set(-0.15, 0.11, 0);
  bombMesh.add(strap);
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8 }));
boom.visible = false; scene.add(boom);
let boomT = 0, nextBeep = 0, ledT = 0;

function spatial(x, y, z) {
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz, y - (P.y + 1.5));
  const v = Math.pow(clamp(1 - d / 90, 0.03, 1), 1.3);
  const pan = (dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)) / Math.max(d, 0.5);
  return { v, pan, d };
}

function updateBomb(dt, now) {
  const b = S.b;
  if (b.s === 'planted' || b.s === 'dropped') {
    bombMesh.visible = true; bombMesh.position.set(b.x, 0, b.z);
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
  bombLed.material.color.setHex(ledT > 0 ? 0xff2020 : 0x550000);
  if (boom.visible) {
    boomT += dt;
    const s = 1 + boomT * 28;
    boom.scale.setScalar(s);
    boom.material.opacity = Math.max(0, 0.8 - boomT * 1.1);
    if (boomT > 0.8) boom.visible = false;
  }
}
function explosionFx() {
  const b = S.b;
  boom.position.set(b.x, 1, b.z); boom.scale.setScalar(1); boom.visible = true; boomT = 0;
  const sp = spatial(b.x, 1, b.z);
  Snd.explode(Math.max(0.35, sp.v));
  P.shake = Math.max(P.shake, 0.6 * Math.max(0.3, sp.v));
  $('flash').style.transition = 'none'; $('flash').style.opacity = String(Math.min(1, 0.9 * Math.max(0.3, sp.v)));
  setTimeout(() => { $('flash').style.transition = 'opacity 1.2s'; $('flash').style.opacity = '0'; }, 40);
  for (let i = 0; i < 60; i++) puff(new THREE.Vector3(b.x, 0.6, b.z), i % 2 ? 0xff9a30 : 0x444444, 1, 14, 5);
}

/* ============================================================
   Joueurs distants
   ============================================================ */
function bx(g, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); g.add(m); return m;
}
function label(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Trebuchet MS, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.8, 0.45, 1); s.position.y = 2.15; s.renderOrder = 10;
  return s;
}
const TEAM_COL = { T: { body: 0xa8742f, legs: 0x4b3b27 }, CT: { body: 0x2f62a8, legs: 0x1f3550 } };

function makeRemote(e) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const mBody = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const mLegs = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const mHead = new THREE.MeshLambertMaterial({ color: 0xe0b896 });
  const mGun = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });
  const legs = bx(g, 0.5, 0.8, 0.28, mLegs, 0, 0.4, 0);
  const torso = bx(g, 0.56, 0.7, 0.32, mBody, 0, 1.15, 0);
  const head = bx(g, 0.28, 0.3, 0.28, mHead, 0, 1.66, 0);
  const aL = bx(g, 0.13, 0.55, 0.13, mBody, -0.36, 1.12, 0);
  const aR = bx(g, 0.13, 0.55, 0.13, mBody, 0.36, 1.12, 0);
  const gun = bx(g, 0.07, 0.1, 0.5, mGun, 0.2, 1.15, -0.35);
  const muz = bx(g, 0.12, 0.12, 0.12, new THREE.MeshBasicMaterial({ color: 0xffd060 }), 0.2, 1.15, -0.65);
  muz.visible = false;
  head.userData = { pid: e.i, head: 1 };
  [legs, torso, aL, aR].forEach((m) => { m.userData = { pid: e.i }; });
  const r = { id: e.i, g, mBody, mLegs, gun, muz, hit: [head, torso, legs, aL, aR], team: null, w: null, tp: new THREE.Vector3(), init: false, alive: false, tyaw: 0, label: null, step: 0, muzT: 0, e };
  r.label = label(e.n, '#ffffff'); g.add(r.label);
  scene.add(g);
  return r;
}
function setRemoteTeam(r, t) {
  r.team = t;
  const c = TEAM_COL[t] || { body: 0x777777, legs: 0x333333 };
  r.mBody.color.setHex(c.body); r.mLegs.color.setHex(c.legs);
}
function setRemoteGun(r, w) {
  r.w = w;
  const W = WEAPONS[w]; const len = W && W.vm ? W.vm.l : 0.2;
  r.gun.visible = w !== 'knife';
  r.gun.scale.z = Math.max(0.3, len / 0.5);
  r.gun.position.z = -0.12 - len * 0.5;
  r.muz.position.z = -0.15 - len;
}
function removeRemote(id) {
  const r = remotes.get(id); if (!r) return;
  scene.remove(r.g); remotes.delete(id);
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-14 * dt);
  remotes.forEach((r) => {
    const px = r.g.position.x, pz = r.g.position.z;
    r.g.position.x += (r.tp.x - px) * k; r.g.position.y += (r.tp.y - r.g.position.y) * k; r.g.position.z += (r.tp.z - pz) * k;
    let dy = r.tyaw - r.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.g.rotation.y += dy * k;
    const e = r.e;
    r.label.visible = r.alive && r.team === myTeam;
    if (r.alive) {
      r.g.rotation.x += (0 - r.g.rotation.x) * k;
      r.g.scale.y = e.c ? 0.82 : 1;
      const mv = Math.hypot(r.g.position.x - px, r.g.position.z - pz);
      r.step += mv;
      if (r.step > 2.4 && dt > 0) {
        r.step = 0;
        if (!e.c && mv / dt > 3.5) { const sp = spatial(r.g.position.x, 0, r.g.position.z); if (sp.d < 28) Snd.step(sp.v * 0.8, sp.pan); }
      }
    } else {
      r.g.rotation.x += (Math.PI / 2 - r.g.rotation.x) * Math.min(1, 8 * dt);
      r.g.scale.y = 1;
    }
    r.muzT -= dt; r.muz.visible = r.muzT > 0;
  });
}

/* ============================================================
   Arme locale (viewmodel)
   ============================================================ */
let vm = null, vmFlash = null, vmKick = 0;
const VM_BASE = new THREE.Vector3(0.2, -0.2, -0.42);
const VM_ADS = new THREE.Vector3(0, -0.085, -0.34);   // arme centrée quand on vise
function buildVM(id) {
  if (vm) cam.remove(vm);
  const w = WEAPONS[id], g = new THREE.Group();
  const mk = (c) => new THREE.MeshLambertMaterial({ color: c });
  const skin = mk(0xcfa07a), dark = mk(0x1d1d1d);
  if (id === 'knife') {
    bx(g, 0.025, 0.07, 0.3, mk(0xd0d5d9), 0, 0, -0.3);
    bx(g, 0.035, 0.045, 0.13, mk(0x222222), 0, -0.01, -0.07);
    bx(g, 0.08, 0.08, 0.14, skin, 0, -0.05, 0.02);
    vmFlash = null;
  } else {
    const L = w.vm.l, m = mk(w.vm.c);
    bx(g, 0.06, 0.09, L, m, 0, 0, -L / 2);
    bx(g, 0.028, 0.028, L * 0.45, dark, 0, 0.015, -L - L * 0.2);
    const grip = bx(g, 0.045, 0.12, 0.06, dark, 0, -0.1, -L * 0.15); grip.rotation.x = 0.25;
    if (w.slot === 1) { bx(g, 0.05, 0.1, 0.045, dark, 0, -0.1, -L * 0.5); bx(g, 0.05, 0.08, 0.26, m, 0, -0.015, 0.14); }
    bx(g, 0.075, 0.075, 0.14, skin, 0, -0.065, -L * 0.15);
    if (L > 0.45) bx(g, 0.075, 0.075, 0.12, skin, 0.01, -0.06, -L * 0.7);
    vmFlash = bx(g, 0.2, 0.2, 0.01, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9, depthTest: false }), 0, 0.015, -L - L * 0.35);
    vmFlash.visible = false; vmFlash.renderOrder = 5;
  }
  g.position.copy(VM_BASE);
  cam.add(g); vm = g;
}

function full(id) { const w = WEAPONS[id]; return { mag: w.mag, res: w.res }; }
function owned() { const m = S.me; return m ? [m.p, m.s, 'knife'].filter(Boolean) : ['knife']; }
function selectWeapon(id) {
  if (!id || id === cur || !owned().includes(id) || !alive()) return;
  lastCur = cur; cur = id;
  reloading = false; scoped = false; fireLatch = false;
  swapT = 0.28; nextShot = performance.now() / 1000 + 0.35;
  buildVM(cur);
}
function selectBest() {
  const m = S.me; const id = (m && (m.p || m.s)) || 'knife';
  cur = id; reloading = false; scoped = false; swapT = 0.28; nextShot = performance.now() / 1000 + 0.3;
  buildVM(cur);
}
function refillAmmo() { ammo = { knife: { mag: 0, res: 0 } }; owned().forEach((id) => { if (id !== 'knife') ammo[id] = full(id); }); }

function reload() {
  const w = WEAPONS[cur], a = ammo[cur];
  if (!a || !w.mag || reloading || a.mag >= w.mag || a.res <= 0) return;
  reloading = true; rlEnd = performance.now() / 1000 + w.rl; scoped = false;
  Snd.reload();
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
  return out;
}
function worldNormal(h) {
  return h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
}

function canShoot() {
  return alive() && locked && !ui.buy && !ui.chat && (S.ph === 'live' || S.ph === 'end');
}

function fire() {
  const w = WEAPONS[cur], a = ammo[cur], now = performance.now() / 1000;
  if (now < nextShot || reloading || swapT > 0.05) return false;
  if (cur === 'knife') return slash(now, w);
  if (!a) return false;
  if (a.mag <= 0) { nextShot = now + 0.25; Snd.click(); if (a.res > 0) reload(); return false; }
  a.mag--; nextShot = now + w.rof;
  fireLatch = false;

  cam.updateMatrixWorld(true);
  const org = cam.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const spd = Math.hypot(P.vx, P.vz);
  let sp = w.spread + (spd / 6) * (w.spread * 2 + 0.012) + (P.ground ? 0 : 0.04) + P.burst * 0.0016;
  if (P.crouch > 0.5) sp *= 0.65;
  if (aiming) sp *= 0.45;           // visée : tir plus précis
  if (cur === 'awp') sp = scoped ? 0.0005 + (spd / 6) * 0.03 : 0.07;
  const targets = worldMeshes.concat(enemyMeshes());
  const pellets = w.pellets || 1;
  const hits = {};
  let firstEnd = null;
  for (let i = 0; i < pellets; i++) {
    const dir = fwd.clone().addScaledVector(rt, (Math.random() - 0.5) * 2 * sp).addScaledVector(up, (Math.random() - 0.5) * 2 * sp).normalize();
    rc.set(org, dir); rc.far = w.range;
    const hs = rc.intersectObjects(targets, false);
    const h = hs[0];
    const end = h ? h.point.clone() : org.clone().addScaledVector(dir, 80);
    if (!firstEnd) firstEnd = end.clone();
    const muzzle = vm && !scoped ? vm.localToWorld(_v1.set(0, 0.015, -(w.vm.l + 0.2))).clone() : org.clone().addScaledVector(fwd, 0.4);
    tracer(muzzle, end);
    if (h) {
      const pid = h.object.userData.pid;
      if (pid) {
        const e = hits[pid] || (hits[pid] = { n: 0, hs: false });
        e.n++; if (h.object.userData.head) e.hs = true;
        puff(h.point, 0xaa1111, 5, 3.5, 8);
      } else {
        const n = worldNormal(h);
        puff(h.point, 0xd8c8a0, 4, 2.5, 9);
        hole(h.point, n);
      }
    }
  }
  Object.keys(hits).forEach((pid) => {
    const e = hits[pid];
    send({ type: 'hit', t: +pid, n: e.n, hs: e.hs ? 1 : 0 });
    hitMark(e.hs);
  });
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [firstEnd.x, firstEnd.y, firstEnd.z] });
  Snd.shot(cur, 1);
  P.kick += w.rec * (0.9 + Math.random() * 0.4) * (cur === 'awp' && scoped ? 0.4 : 1) * (aiming ? 0.75 : 1);
  P.yaw += (Math.random() - 0.5) * w.rec * 0.5;
  P.burst = Math.min(30, P.burst + 1);
  vmKick = Math.min(1, vmKick + (w.slot === 1 ? 0.7 : 0.5));
  if (vmFlash) { vmFlash.visible = true; vmFlash.rotation.z = Math.random() * 6; vmFlash.scale.setScalar(0.7 + Math.random() * 0.6); flashT = 0.045; }
  if (cur === 'awp') { scoped = false; }
  if (a.mag <= 0 && a.res > 0 && cur !== 'awp') setTimeout(() => { if (alive() && ammo[cur] && ammo[cur].mag <= 0) reload(); }, 150);
  else if (a.mag <= 0 && a.res > 0) setTimeout(() => { if (alive() && ammo[cur] && ammo[cur].mag <= 0) reload(); }, 600);
  return true;
}
let flashT = 0;

function slash(now, w) {
  nextShot = now + w.rof; fireLatch = false;
  cam.updateMatrixWorld(true);
  const org = cam.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  rc.set(org, fwd); rc.far = w.range;
  const h = rc.intersectObjects(worldMeshes.concat(enemyMeshes()), false)[0];
  vmKick = 1.2;
  Snd.knife(1);
  if (h && h.object.userData.pid) {
    send({ type: 'hit', t: h.object.userData.pid, n: 1, hs: 0 });
    puff(h.point, 0xaa1111, 6, 3.5, 8); hitMark(false);
  } else if (h) puff(h.point, 0xd8c8a0, 3, 2, 9);
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [org.x + fwd.x * 0.5, org.y + fwd.y * 0.5, org.z + fwd.z * 0.5] });
  return true;
}

function hitMark(hs) {
  const el = $('hitm'); el.className = hs ? 'hs' : ''; el.style.opacity = '1'; hitTimer = 0.18;
  Snd.hit(hs);
}

/* ============================================================
   Réseau
   ============================================================ */
function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  $('err').textContent = '';
  try { ws = new WebSocket(url); } catch (e) { $('err').textContent = 'Connexion impossible.'; return; }
  ws.onopen = () => send({ type: 'join', name: joinInfo.name, room: joinInfo.room, team: joinInfo.team });
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  ws.onclose = () => {
    if (connected) { connected = false; leaveToMenu('Connexion au serveur perdue.'); }
    else if (!$('err').textContent) $('err').textContent = 'Connexion impossible. Le serveur est-il lancé ?';
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function leaveToMenu(text) {
  connected = false; S.me = null;
  remotes.forEach((r, id) => removeRemote(id));
  if (document.pointerLockElement) document.exitPointerLock();
  $('err').textContent = text || '';
  $('play').disabled = false;
  closeBuy(true);
}

function onMsg(m) {
  switch (m.type) {
    case 'welcome':
      myId = m.id; myTeam = null; connected = true; S.me = null; ammo = {}; cur = 'glock'; lastInv = { p: null, s: null };
      $('play').disabled = false;
      buildVM(cur);
      tryLock();
      break;
    case 'err': $('err').textContent = m.text; $('play').disabled = false; try { ws.close(); } catch (e) {} break;
    case 'snap': onSnap(m); break;
    case 'spawn':
      P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.yaw = m.yaw; P.pitch = 0; P.kick = 0; P.burst = 0;
      needRefill = true; scoped = false; reloading = false; specId = null; clearHoles();
      break;
    case 'shoot': onRemoteShot(m); break;
    case 'kill': onKill(m); break;
    case 'hitc': if (m.kill) Snd.kill(); break;
    case 'hurt': onHurt(m); break;
    case 'msg': notice(m.text, m.kind === 'err' ? '#ff7b6e' : m.kind === 'bomb' ? '#ff9a3c' : '#ffd65a'); break;
    case 'chat': addChat(m); break;
    case 'rstart': onRoundStart(m); break;
    case 'rend': onRoundEnd(m); break;
    case 'leave': removeRemote(m.id); break;
  }
}

function onSnap(m) {
  const prev = S.me, pb = S.b.s;
  S.ph = m.ph; S.te = m.te; S.rd = m.rd; S.sc = m.sc; S.b = m.b; S.recv = performance.now();
  const oldTeam = myTeam;
  S.me = m.me; myTeam = m.me.t;
  if (oldTeam && myTeam && oldTeam !== myTeam) {
    banner('MI-TEMPS', '#ffffff', 'Tu joues maintenant ' + teamName(myTeam) + ' · ton score te suit', 4000);
  }
  S.pl = new Map();
  const seen = new Set();
  for (const e of m.pl) {
    S.pl.set(e.i, e); S.names.set(e.i, { n: e.n, t: e.t });
    if (e.i === myId) continue;
    seen.add(e.i);
    let r = remotes.get(e.i);
    if (!r) { r = makeRemote(e); remotes.set(e.i, r); }
    r.e = e; r.alive = !!e.a;
    if (r.team !== e.t) setRemoteTeam(r, e.t);
    if (r.w !== e.w) setRemoteGun(r, e.w);
    r.tp.set(e.x, e.y, e.z); r.tyaw = e.r;
    if (!r.init) { r.g.position.copy(r.tp); r.g.rotation.y = e.r; r.init = true; }
  }
  remotes.forEach((r, id) => { if (!seen.has(id)) removeRemote(id); });

  if (pb !== 'planted' && m.b.s === 'planted') Snd.plant();
  if (pb === 'planted' && m.b.s === 'exploded') explosionFx();
  if (pb === 'planted' && m.b.s === 'defused') Snd.defused();
  if (pb !== 'planted' && m.b.s === 'planted') nextBeep = 0;

  const me = m.me;
  if (prev && prev.al && !me.al) { scoped = false; reloading = false; P.shake = Math.max(P.shake, 0.4); }
  if (needRefill) { refillAmmo(); needRefill = false; selectBest(); }
  else {
    if (me.p && me.p !== lastInv.p) { ammo[me.p] = full(me.p); selectWeapon(me.p); }
    if (me.s && me.s !== lastInv.s) { ammo[me.s] = full(me.s); if (!me.p || cur === lastInv.s) selectWeapon(me.s); }
    if (!owned().includes(cur)) selectBest();
  }
  lastInv = { p: me.p, s: me.s };
}

function onRemoteShot(m) {
  const r = remotes.get(m.id);
  const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]), e = new THREE.Vector3(m.e[0], m.e[1], m.e[2]);
  const sp = spatial(o.x, o.y, o.z);
  if (m.w === 'knife') Snd.knife(sp.v); else { Snd.shot(m.w, sp.v, sp.pan); tracer(o.clone().lerp(e, 0.04), e); }
  if (r) r.muzT = 0.05;
}

function onKill(m) {
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
  Snd.hurt();
  const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = String(clamp(0.35 + m.dmg / 60, 0.35, 1));
  hurtT = 0.9; dmgTimer = 1.0;
  P.shake = Math.max(P.shake, clamp(m.dmg / 80, 0.1, 0.5));
  const f = _v1.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), r = _v2.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const a = Math.atan2(m.dx * r.x + m.dz * r.z, m.dx * f.x + m.dz * f.z);
  const d = $('dmgdir'); d.style.transform = 'rotate(' + a + 'rad)'; d.firstElementChild.style.opacity = '1';
}
let hurtT = 0;

function onRoundStart(m) {
  Snd.roundStart();
  banner('MANCHE ' + m.round, '#ffffff', 'Phase d\'achat : appuie sur B', 2200);
  clearHoles(); closeBuy(true);
}
function onRoundEnd(m) {
  const reasons = { elim: 'Équipe adverse éliminée', bomb: 'La bombe a explosé', defuse: 'Bombe désamorcée', time: 'Temps écoulé' };
  const win = m.w === myTeam;
  banner(teamName(m.w).toUpperCase() + ' GAGNENT', m.w === 'T' ? '#e0a040' : '#5aa0ff', (reasons[m.r] || '') + (m.over ? ' · Fin du match' : ''), 5000);
  if (win) Snd.win(); else Snd.lose();
}

function banner(text, color, sub, ms) {
  const b = $('banner'); b.textContent = text; b.style.color = color;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; s.style.color = '#fff'; b.appendChild(s); }
  b.style.opacity = '1'; banTimer = ms / 1000;
}
function notice(text, color) { const n = $('notice'); n.textContent = text; n.style.color = color || '#ffd65a'; noticeTimer = 3.5; }

function addChat(m) {
  const row = document.createElement('div');
  const a = document.createElement('span'); a.className = 't' + m.t; a.textContent = m.n + ': ';
  const b = document.createElement('span'); b.textContent = m.x;
  row.append(a, b);
  const log = $('chatlog'); log.appendChild(row);
  while (log.children.length > 6) log.removeChild(log.firstChild);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 9000);
}

/* ============================================================
   Boutique
   ============================================================ */
function buyItems() {
  const t = myTeam;
  return [
    ['Pistolets', ['deagle']],
    ['Pistolets-mitrailleurs', [t === 'T' ? 'mac10' : 'mp9']],
    ['Armes lourdes', ['nova']],
    ['Fusils', [t === 'T' ? 'ak47' : 'm4a1', 'awp']],
    ['Équipement', ['armor'].concat(t === 'CT' ? ['kit'] : [])]
  ];
}
let buySig = '';
function renderBuy(force) {
  const me = S.me; if (!me) return;
  const sig = [me.mo, me.p, me.s, me.ar, me.k, me.bo, myTeam].join('|');
  if (!force && sig === buySig) return;
  buySig = sig;
  $('buyMoney').textContent = '$' + me.mo;
  const body = $('buyBody'); body.textContent = '';
  let n = 0;
  buyItems().forEach(([title, ids]) => {
    const g = document.createElement('div'); g.className = 'grp'; g.textContent = title; body.appendChild(g);
    const wrap = document.createElement('div'); wrap.className = 'items'; body.appendChild(wrap);
    ids.forEach((id) => {
      n++;
      let name, price, stat, has = false;
      if (id === 'armor') { name = 'Gilet + casque'; price = 650; stat = 'Réduit les dégâts reçus'; has = me.ar >= 100; }
      else if (id === 'kit') { name = 'Kit de désamorçage'; price = 400; stat = 'Désamorçage 2x plus rapide'; has = !!me.k; }
      else { const w = WEAPONS[id]; name = w.n; price = w.price; stat = w.dmg + (w.pellets ? ' x' + w.pellets : '') + ' dégâts · ' + w.mag + ' balles'; has = me.p === id || me.s === id; }
      const b = document.createElement('button');
      b.className = 'item' + (has ? ' own' : ''); b.disabled = has || me.mo < price || !me.bo;
      const k = document.createElement('span'); k.className = 'k'; k.textContent = String(n);
      const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = name;
      const pr = document.createElement('div'); pr.className = 'pr'; pr.textContent = has ? 'Acheté' : '$' + price;
      const st = document.createElement('div'); st.className = 'st'; st.textContent = stat;
      b.append(k, nm, pr, st);
      b.dataset.id = id;
      b.addEventListener('click', () => doBuy(id));
      wrap.appendChild(b);
    });
  });
}
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
function tryLock() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { Object.keys(K).forEach((k) => { K[k] = false; }); fireHeld = false; fireLatch = false; scoped = false; rmbHeld = false; send({ type: 'act', on: 0 }); }
});
canvas.addEventListener('click', () => { if (connected && !ui.buy && !locked) tryLock(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const s = 0.0022 * sens * (scoped ? 0.35 : aiming ? 0.7 : 1);
  P.yaw -= e.movementX * s;
  P.pitch = clamp(P.pitch - e.movementY * s, -1.5, 1.5);
});

document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) {
    if (!alive()) { cycleSpec(); return; }
    fireHeld = true; fireLatch = true;
  } else if (e.button === 2) {
    rmbHeld = true;                                   // maintenu = viser
    if (alive() && WEAPONS[cur].scope && !reloading) { scoped = !scoped; Snd.click(); } // AWP : lunette
  }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; if (e.button === 2) rmbHeld = false; });
document.addEventListener('wheel', (e) => {
  if (!locked || !alive()) return;
  const o = owned(); const i = o.indexOf(cur);
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
  if (ui.chat) {
    if (e.code === 'Enter') { const t = chatIn.value.trim(); if (t) send({ type: 'chat', text: t }); closeChat(); }
    else if (e.code === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Tab') { e.preventDefault(); ui.board = true; return; }
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'KeyB') { e.preventDefault(); if (ui.buy) closeBuy(); else openBuy(); return; }
  if (e.code === 'Escape' && ui.buy) { closeBuy(); return; }
  if (ui.buy) {
    const m = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (m) { const btn = $('buyBody').querySelectorAll('button.item')[+m[2] - 1]; if (btn && !btn.disabled) doBuy(btn.dataset.id); }
    return;
  }
  if (!locked) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (!e.repeat) {
    K[e.code] = true;
    if (e.code === 'KeyE' && alive()) send({ type: 'act', on: 1 });
    if (e.code === 'KeyR') reload();
    if (e.code === 'KeyQ') selectWeapon(lastCur);
    if (e.code === 'Digit1' || e.code === 'Numpad1') selectWeapon(S.me && S.me.p);
    if (e.code === 'Digit2' || e.code === 'Numpad2') selectWeapon(S.me && S.me.s);
    if (e.code === 'Digit3' || e.code === 'Numpad3') selectWeapon('knife');
  }
});
document.addEventListener('keyup', (e) => {
  K[e.code] = false;
  if (e.code === 'Tab') ui.board = false;
  if (e.code === 'KeyE') send({ type: 'act', on: 0 });
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

function startGame() {
  Snd.init(); Snd.setVolume(vol);
  const name = $('name').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
  const room = $('room').value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'main';
  store.set('cs_name', $('name').value.trim()); store.set('cs_room', $('room').value.trim()); store.set('cs_team', chosenTeam);
  joinInfo = { name, room, team: chosenTeam };
  $('play').disabled = true; $('err').textContent = 'Connexion…';
  connect();
}
$('play').addEventListener('click', startGame);
$('name').addEventListener('keydown', (e) => { if (e.code === 'Enter') startGame(); });
$('room').addEventListener('keydown', (e) => { if (e.code === 'Enter') startGame(); });

$('sens').value = sens; $('vol').value = vol;
const syncSliders = () => { $('sensv').textContent = sens.toFixed(2); $('volv').textContent = Math.round(vol * 100) + '%'; };
syncSliders();
$('sens').addEventListener('input', (e) => { sens = parseFloat(e.target.value); store.set('cs_sens', String(sens)); syncSliders(); });
$('vol').addEventListener('input', (e) => { vol = parseFloat(e.target.value); store.set('cs_vol', String(vol)); Snd.setVolume(vol); syncSliders(); });
$('resume').addEventListener('click', tryLock);
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) tryLock(); });
$('leave').addEventListener('click', () => { try { ws.close(); } catch (e) {} location.reload(); });

/* ============================================================
   HUD
   ============================================================ */
const radar = $('radar'), rctx = radar.getContext('2d');
function drawRadar() {
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
  $('roundl').textContent = 'Manche ' + S.rd + (S.ph === 'freeze' ? ' · achat' : '');
  $('hpn').textContent = me.hp; $('hpn').classList.toggle('low', me.hp <= 30);
  $('arn').textContent = me.ar;
  $('money').textContent = '$' + me.mo;
  const w = WEAPONS[cur], a = ammo[cur];
  $('wname').textContent = w.n + (reloading ? ' · rechargement…' : '');
  $('mag').textContent = w.mag && a ? a.mag : '-'; $('res').textContent = w.mag && a ? a.res : '-';
  $('icons').textContent = (me.bm ? 'Bombe ' : '') + (me.k ? 'Kit ' : '');
  if (ui.buy) { if (!me.bo || !me.al) closeBuy(true); else renderBuy(); }

  // invites
  let prompt = '';
  if (me.al) {
    if (me.bm && S.ph === 'live') {
      const inSite = Object.keys(SITES).some((k) => Math.hypot(P.x - SITES[k].x, P.z - SITES[k].z) <= SITES[k].r);
      if (inSite) prompt = 'Maintiens E pour poser la bombe';
    }
    if (myTeam === 'CT' && S.b.s === 'planted' && Math.hypot(P.x - S.b.x, P.z - S.b.z) < 2.4) prompt = 'Maintiens E pour désamorcer';
    if (S.ph === 'freeze' && !prompt) prompt = 'B : boutique';
  }
  $('prompt').textContent = prompt;
  $('progw').style.display = me.pg > 0 ? 'block' : 'none';
  $('prog').style.width = Math.round(me.pg * 100) + '%';

  // spectateur
  const spec = $('spec');
  if (!me.al && connected && (S.ph === 'live' || S.ph === 'freeze' || S.ph === 'end')) {
    const r = specId && remotes.get(specId);
    spec.textContent = r && r.alive ? 'Spectateur : ' + r.e.n + ' (clic pour changer)' : 'Tu es mort : prochaine manche bientôt';
  } else spec.textContent = '';

  if (ui.board) renderBoard(); $('board').classList.toggle('hide', !ui.board);
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
    tb.innerHTML = '<tr><th>' + teamName(tm) + '</th><th class="num">Kills</th><th class="num">Morts</th></tr>';
    rows.filter((p) => p.t === tm).sort((a, b) => b.k - a.k || a.d - b.d).forEach((p) => {
      const tr = document.createElement('tr');
      if (p.i === myId) tr.className = 'me'; if (!p.a) tr.className += ' dead';
      const a = document.createElement('td'); a.textContent = p.n; a.className = 't' + tm;
      const b = document.createElement('td'); b.className = 'num'; b.textContent = p.k;
      const c = document.createElement('td'); c.className = 'num'; c.textContent = p.d;
      tr.append(a, b, c); tb.appendChild(tr);
    });
    board.appendChild(tb);
  });
}

function refreshOverlays() {
  $('menu').classList.toggle('hide', connected);
  $('hud').classList.toggle('hide', !connected);
  $('pause').classList.toggle('hide', !(connected && !locked && !ui.buy));
  $('scope').style.display = scoped && alive() ? 'block' : 'none';
  $('cross').style.display = scoped ? 'none' : 'block';
}

/* ============================================================
   Boucle principale
   ============================================================ */
let last = performance.now(), sendAcc = 0, ovAcc = 0, menuT = 0;
function update(dt, now) {
  const w = WEAPONS[cur];
  const isAlive = alive();
  const frozen = S.ph === 'freeze' || S.ph === 'wait';
  // visée au clic droit (toutes les armes sauf couteau et AWP qui a sa lunette)
  aiming = rmbHeld && isAlive && locked && cur !== 'knife' && !w.scope && !reloading && swapT <= 0 && !ui.buy && !ui.chat;
  adsT += ((aiming ? 1 : 0) - adsT) * Math.min(1, 14 * dt);

  // --- mouvement
  if (isAlive) {
    const f = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    const r = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    const len = Math.hypot(f, r) || 1;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const crouching = !!(K.KeyC || K.ControlLeft);
    let spd = 6 * (w.spd || 1) * (K.ShiftLeft ? 0.55 : 1) * (crouching ? 0.5 : 1) * (scoped ? 0.6 : 1) * (aiming ? 0.7 : 1);
    if (frozen) spd = 0;
    const tx = (-sy * f + cy * r) / len * spd, tz = (-cy * f - sy * r) / len * spd;
    const ctl = P.ground ? 11 : 1.6;
    P.vx += (tx - P.vx) * Math.min(1, ctl * dt); P.vz += (tz - P.vz) * Math.min(1, ctl * dt);
    P.crouch += ((crouching ? 1 : 0) - P.crouch) * Math.min(1, 12 * dt);
    if (K.Space && P.ground && !frozen) { P.vy = 6.6; P.ground = false; }
    P.vy -= 22 * dt;
    P.x += P.vx * dt; P.z += P.vz * dt;
    collide();
    P.y += P.vy * dt;
    const g = groundAt(P.x, P.z, P.y);
    if (P.y <= g) { P.y = g; P.vy = 0; P.ground = true; } else P.ground = false;
    const sp = Math.hypot(P.vx, P.vz);
    if (P.ground && sp > 0.5) { P.bob += dt * sp * 1.9; P.stepD += sp * dt; if (P.stepD > 2.4) { P.stepD = 0; if (sp > 3.6 && !K.ShiftLeft && !crouching) Snd.step(0.35); } }
  }

  // --- armes
  swapT = Math.max(0, swapT - dt);
  if (reloading && now >= rlEnd) {
    reloading = false;
    const a = ammo[cur], W = WEAPONS[cur];
    if (a) { const take = Math.min(W.mag - a.mag, a.res); a.mag += take; a.res -= take; }
  }
  if (isAlive && canShoot()) {
    if (w.auto ? fireHeld : fireLatch) fire();
  }
  P.burst = Math.max(0, P.burst - dt * 14);
  P.kick -= P.kick * Math.min(1, 9 * dt);
  vmKick -= vmKick * Math.min(1, 14 * dt);
  if (flashT > 0) { flashT -= dt; if (flashT <= 0 && vmFlash) vmFlash.visible = false; }
  if (!isAlive) { fireHeld = false; fireLatch = false; }

  // --- caméra
  let ey = P.y + eyeHeight(), cx = P.x, cz = P.z, yaw = P.yaw, pitch = P.pitch, showVM = isAlive;
  if (!isAlive && connected) {
    const r = specId && remotes.get(specId);
    if (r && r.alive) { cx = r.g.position.x; cz = r.g.position.z; ey = r.g.position.y + 1.6; yaw = r.g.rotation.y; pitch = r.e.p || 0; }
    else { if (!specId || !remotes.get(specId) || !remotes.get(specId).alive) { specId = null; cycleSpec(); } ey = P.y + 0.5; }
    showVM = false;
  }
  const bob = isAlive ? Math.sin(P.bob) * 0.02 * Math.min(1, Math.hypot(P.vx, P.vz) / 5) : 0;
  P.shake = Math.max(0, P.shake - dt * 1.6);
  const sh = P.shake * 0.05;
  cam.position.set(cx + (Math.random() - 0.5) * sh, ey + bob + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
  cam.rotation.set(pitch + P.kick + (Math.random() - 0.5) * sh, yaw, 0);
  const wantFov = scoped ? 24 : aiming ? 58 : 78;
  if (Math.abs(cam.fov - wantFov) > 0.1) { cam.fov += (wantFov - cam.fov) * Math.min(1, 14 * dt); cam.updateProjectionMatrix(); }
  if (vm) {
    vm.visible = showVM && !scoped;
    const rlp = reloading ? Math.sin(clamp(1 - (rlEnd - now) / Math.max(0.1, w.rl), 0, 1) * Math.PI) : 0;
    const swp = swapT > 0 ? swapT / 0.28 : 0;
    const bobK = 1 - adsT * 0.8; // moins de balancement en visée
    const bx0 = VM_BASE.x + (VM_ADS.x - VM_BASE.x) * adsT, by0 = VM_BASE.y + (VM_ADS.y - VM_BASE.y) * adsT, bz0 = VM_BASE.z + (VM_ADS.z - VM_BASE.z) * adsT;
    vm.position.set(bx0 + Math.sin(P.bob * 0.5) * 0.008 * bobK, by0 - rlp * 0.22 - swp * 0.25 + Math.abs(Math.sin(P.bob)) * 0.008 * bobK, bz0 + vmKick * 0.07 * (1 - adsT * 0.5));
    vm.rotation.set(vmKick * 0.12 + rlp * 0.5, 0, -rlp * 0.3);
  }

  // --- réseau (état du joueur)
  sendAcc += dt;
  if (sendAcc >= 0.033) {
    sendAcc = 0;
    if (isAlive) send({ type: 'st', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), c: P.crouch > 0.5 ? 1 : 0, w: cur });
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const now = t / 1000;
  if (connected && S.me) {
    update(dt, now);
    updateRemotes(dt); updateBomb(dt, t);
    updateFx(dt);
    hudAcc += dt;
    if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
    drawRadar();
    // fondus HUD
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitm').style.opacity = '0'; }
    if (hurtT > 0) { hurtT -= dt; if (hurtT <= 0) { const h = $('hurt'); h.style.transition = 'opacity .7s'; h.style.opacity = '0'; } }
    if (dmgTimer > 0) { dmgTimer -= dt; if (dmgTimer <= 0) $('dmgdir').firstElementChild.style.opacity = '0'; }
  } else {
    // décor de menu : caméra qui tourne autour de la carte
    menuT += dt * 0.12;
    cam.position.set(Math.sin(menuT) * 30, 14, Math.cos(menuT) * 30);
    cam.rotation.set(-0.35, menuT, 0);
    if (vm) vm.visible = false;
    updateFx(dt);
  }
  if (banTimer > 0) { banTimer -= dt; if (banTimer <= 0) $('banner').style.opacity = '0'; }
  if (noticeTimer > 0) { noticeTimer -= dt; if (noticeTimer <= 0) $('notice').textContent = ''; }
  ovAcc += dt;
  if (ovAcc > 0.15) { ovAcc = 0; refreshOverlays(); }
  renderer.render(scene, cam);
}
buildVM('glock');
requestAnimationFrame(frame);
})();
