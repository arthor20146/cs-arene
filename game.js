/* CS Arena - client (three.js r128) */
(function () {
'use strict';
const { CFG, WEAPONS, SHOP, MAPS } = CS;
let MAP = MAPS.dust, BOXES = MAP.boxes, SITES = MAP.sites; // carte actuelle (changée par setMap)
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
const { renderer, scene, cam, vmScene } = GFX.init(canvas);
const fx = GFX.fx;
const FOV = 68;
cam.fov = FOV;
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
  worldMeshes = GFX.buildWorld(M);
  fx.clear();
  Snd.setAmbient(M.style || M.id);
}

/* ============================================================
   État
   ============================================================ */
let ws = null, myId = null, myTeam = null, connected = false, locked = false;
let joinInfo = { name: '', room: 'main', team: 'auto', map: 'dust' };
const S = { ph: 'wait', te: 0, rd: 0, sc: { T: 0, CT: 0 }, b: { s: 'none', x: 0, z: 0 }, pl: new Map(), me: null, recv: 0, names: new Map() };
const ui = { buy: false, chat: false, board: false };
const K = {};
const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, recP: 0, recY: 0, burst: 0, ground: true, crouch: 0, shake: 0, bob: 0, stepD: 0, tag: 0, landT: 0, stam: 1, dip: 0, dipV: 0, roll: 0, swayX: 0, swayY: 0, mouseX: 0, mouseY: 0, sunK: 1, sunT: 1, deadT: 0 };
let cur = 'glock', lastCur = 'knife', ammo = {}, reloading = false, rlEnd = 0, rlDur = 1, rlStage = 0, rlEmpty = false, rlNext = 0, nextShot = 0, swapT = 0;
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
  if (b.s === 'planted' || b.s === 'dropped') {
    if (!bombMesh.visible) bombMesh.rotation.y = b.x * 7 % 6.28;
    bombMesh.visible = true; bombMesh.position.set(b.x, 0.01, b.z);
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
function setRemoteGun(r, w) { r.w = w; r.rig.setGun(w); }
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
      r.rig.update(dt, { speed: r.alive ? r.vs : 0, fw: r.fw, sd: r.sd, crouch: e.c, pitch: e.p || 0, reload: e.l, dead: !r.alive });
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
  knife:   { p: [0.18, -0.16, -0.36], ads: 0.3, elR: [0.36, -0.46, 0.1], elL: [-0.3, -0.6, 0.2] }
};
const vmPivot = new THREE.Group(); vmScene.add(vmPivot);
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
  V = Models.gunVM(id);
  vmPivot.add(V.group);
  V.pos = VMPOS[V.info.class] || VMPOS.rifle;
  const t = myTeam === 'CT' ? 'CT' : 'T';
  if (armTeam !== t) {
    if (armR) vmScene.remove(armR, armL);
    armR = Models.vmArm(t, false); armL = Models.vmArm(t, true); vmScene.add(armR, armL); armTeam = t;
  }
  armL.visible = id !== 'knife';
  V.magHome = V.mag.position.clone();
  if (id !== 'knife') {
    const q = new THREE.PlaneGeometry(0.34, 0.34);
    vmFlash = new THREE.Group();
    const a = new THREE.Mesh(q, flashMat), b = new THREE.Mesh(q, flashMat); b.rotation.y = Math.PI / 2; b.position.z = -0.08; b.scale.set(1, 0.6, 1);
    vmFlash.add(a, b); vmFlash.position.copy(V.info.muzzle); vmFlash.visible = false; V.group.add(vmFlash);
  } else vmFlash = null;
  Snd.part('draw');
}
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _h2 = new THREE.Vector3();
function poseVM(dt, now, showVM) {
  const on = showVM && !scoped;
  vmPivot.visible = on; if (armR) { armR.visible = on; armL.visible = on && cur !== 'knife'; }
  if (!on || !V) return;
  const w = WEAPONS[cur], inf = V.info, pos = V.pos;
  // balancement de marche, respiration, inertie de la souris
  P.swayX += (clamp(P.mouseX * 0.00028, -0.05, 0.05) - P.swayX) * Math.min(1, 9 * dt);
  P.swayY += (clamp(P.mouseY * 0.00028, -0.04, 0.04) - P.swayY) * Math.min(1, 9 * dt);
  P.mouseX = 0; P.mouseY = 0;
  const spd = Math.hypot(P.vx, P.vz), mv = Math.min(1, spd / 5), a = 1 - adsT * 0.86;
  const bx = Math.sin(P.bob * 0.5) * 0.006 * mv * a, by = Math.abs(Math.sin(P.bob * 0.5)) * 0.006 * mv * a;
  const br = Math.sin(now * 1.3) * 0.0016 * a;
  const ax = pos.p[0] + (-inf.sight.x - pos.p[0]) * adsT, ay = pos.p[1] + (-inf.sight.y - pos.p[1]) * adsT, az = pos.p[2] + (-pos.ads - inf.sight.z - pos.p[2]) * adsT;
  const swp = swapT > 0 ? swapT / 0.42 : 0, swe = swp * swp;
  let rx = 0, rz = 0, ry = 0, ox = 0, oy = 0, oz = 0, magY = 0, magVis = true, lhx = 0, lhy = 0, lhz = 0, handK = 0;
  V.pump.position.z = 0; V.slide.position.z = 0;
  if (reloading) {
    const T = clamp(1 - (rlEnd - now) / Math.max(0.1, rlDur), 0, 1);
    const inn = Math.min(1, T / 0.14), oun = Math.min(1, (1 - T) / 0.14), e = inn * oun * (2 - inn * oun) * 1;
    if (w.shell) {
      rx = 0.28 * e; rz = -0.32 * e; oy = -0.03 * e; handK = 1;
      const q = (T * 7) % 1; lhy = -0.05 - Math.sin(q * 3.14) * 0.09;
    } else {
      rx = 0.2 * e; rz = -0.46 * e; ry = 0.14 * e; oy = -0.03 * e; ox = -0.02 * e;
      if (T > 0.16 && T < 0.34) magY = -((T - 0.16) / 0.18) * 0.34;
      else if (T >= 0.34 && T < 0.52) magVis = false;
      else if (T >= 0.52 && T < 0.7) magY = -(1 - (T - 0.52) / 0.18) * 0.3;
      if (T > 0.14 && T < 0.8) handK = 1;
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
  vmSlide *= Math.exp(-26 * dt);
  if (w.cls === 'pistol' && !w.bolt) V.slide.position.z += vmSlide * 0.03 + (ammo[cur] && ammo[cur].mag === 0 ? 0.03 : 0);
  vmPivot.position.set(ax + bx + ox + P.swayX * 0.6 - P.roll * 0.3, ay + by + br + oy - swe * 0.3 - P.dip * 0.5 + P.swayY * 0.4, az + oz + vmKick * 0.042);
  vmPivot.rotation.set(rx + vmKick * 0.06 * (1 - adsT * 0.6) + swe * 0.9 + P.swayY * 0.9, ry + P.swayX * 1.3, rz + P.swayX * 0.8 - P.roll * 1.6);
  V.mag.position.y = magY; V.mag.visible = magVis;
  vmPivot.updateMatrixWorld(true);
  // mains sur l'arme
  V.group.localToWorld(_h.copy(inf.handR)); armR.position.copy(_h); armR.lookAt(_e.fromArray(pos.elR).setX(pos.elR[0] * (1 - adsT * 0.5)));
  armR.updateMatrixWorld(true);
  if (armL.visible) {
    V.group.localToWorld(_h.copy(inf.handL));
    if (handK) { V.group.localToWorld(_h2.set(0, -0.11 + magY * 0.9 + lhy * 0.5, inf.class === 'pistol' ? 0.05 : -0.08)); _h.lerp(_h2, 0.95); }
    if (V.pump.position.z) _h.z += V.pump.position.z;
    armL.position.copy(_h); armL.lookAt(_e.fromArray(pos.elL).setX(pos.elL[0] * (1 - adsT * 0.3)));
  }
}

function full(id) { const w = WEAPONS[id]; return { mag: w.mag, res: w.res }; }
function owned() { const m = S.me; return m ? [m.p, m.s, 'knife'].filter(Boolean) : ['knife']; }
function selectWeapon(id) {
  if (!id || id === cur || !owned().includes(id) || !alive()) return;
  lastCur = cur; cur = id;
  reloading = false; scoped = false; fireLatch = false;
  swapT = 0.42; nextShot = performance.now() / 1000 + (WEAPONS[id].slot === 1 ? 0.62 : 0.42);
  buildVM(cur);
}
function selectBest() {
  const m = S.me; const id = (m && (m.p || m.s)) || 'knife';
  cur = id; reloading = false; scoped = false; swapT = 0.42; nextShot = performance.now() / 1000 + 0.45;
  buildVM(cur);
}
function refillAmmo() { ammo = { knife: { mag: 0, res: 0 } }; owned().forEach((id) => { if (id !== 'knife') ammo[id] = full(id); }); }

function ammoMsg() { const a = ammo[cur]; return a ? [a.mag, a.res] : undefined; }
function dropCurrent() {
  if (!alive() || cur === 'knife') return;
  send({ type: 'drop', am: ammoMsg() });
  Snd.part('out');
}

function reload() {
  const w = WEAPONS[cur], a = ammo[cur];
  if (!a || !w.mag || reloading || a.mag >= w.mag || a.res <= 0) return;
  const now = performance.now() / 1000;
  reloading = true; scoped = false; rlStage = 0; rlEmpty = a.mag === 0;
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
  return alive() && locked && !ui.buy && !ui.chat && (S.ph === 'live' || S.ph === 'end');
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
  if (reloading) {
    if (w.shell && a && a.mag > 0) { reloading = false; nextShot = now + 0.12; } // on interrompt le rechargement
    return false;
  }
  if (cur === 'knife') return slash(now, w);
  if (!a) return false;
  if (a.mag <= 0) { nextShot = now + 0.3; Snd.click(); fireLatch = false; if (a.res > 0) reload(); return false; }
  a.mag--; nextShot = now + w.rof;
  fireLatch = false;
  lastShot = now;

  cam.updateMatrixWorld(true);
  const org = cam.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const sp = spreadNow(w);
  const targets = worldMeshes.concat(enemyMeshes());
  const pellets = w.pellets || 1;
  const hits = {};
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
      if (d.pid) {
        const e = hits[d.pid] || (hits[d.pid] = { z: {}, p: 0, hs: false });
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
  Object.keys(hits).forEach((pid) => {
    const e = hits[pid];
    send({ type: 'hit', t: +pid, z: e.z, p: e.p });
    hitMark(e.hs);
  });
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [firstEnd.x, firstEnd.y, firstEnd.z], n: firstN ? [firstN.x, firstN.y, firstN.z] : null, s: firstS });
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
  if (h && h.object.userData.pid) {
    const zone = h.object.userData.zone;
    send({ type: 'hit', t: h.object.userData.pid, z: { [zone === 'h' ? 'c' : zone]: 1 }, p: 0 });
    fx.blood(h.point, fwd.clone().negate(), 10); hitMark(false);
  } else if (h) impact(h.point, worldNormal(h), h.object.userData.mat, true);
  send({ type: 'shoot', o: [org.x, org.y - 0.1, org.z], e: [org.x + fwd.x * 0.5, org.y + fwd.y * 0.5, org.z + fwd.z * 0.5] });
  return true;
}

function hitMark(hs) {
  const el = $('hitm'); el.className = hs ? 'hs' : ''; el.style.opacity = '1'; hitTimer = 0.14;
  Snd.hit(hs);
}

/* ============================================================
   Réseau
   ============================================================ */
function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  $('err').textContent = '';
  try { ws = new WebSocket(url); } catch (e) { $('err').textContent = 'Connexion impossible.'; return; }
  ws.onopen = () => send({ type: 'join', name: joinInfo.name, room: joinInfo.room, team: joinInfo.team, map: joinInfo.map });
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
  syncDrops([]);
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('err').textContent = text || '';
  $('play').disabled = false;
  closeBuy(true);
}

function onMsg(m) {
  switch (m.type) {
    case 'welcome':
      myId = m.id; myTeam = null; connected = true; S.me = null; setMap(m.map); ammo = {}; cur = 'glock'; lastInv = { p: null, s: null };
      $('play').disabled = false;
      buildVM(cur);
      tryLock();
      break;
    case 'err': $('err').textContent = m.text; $('play').disabled = false; try { ws.close(); } catch (e) {} break;
    case 'snap': onSnap(m); break;
    case 'spawn':
      P.x = m.x; P.y = m.y; P.z = m.z; P.vx = P.vy = P.vz = 0; P.yaw = m.yaw; P.pitch = 0; P.recP = P.recY = 0; P.burst = 0; P.tag = 0; P.landT = 0; P.stam = 1;
      needRefill = true; scoped = false; reloading = false; specId = null; fx.clear();
      break;
    case 'shoot': onRemoteShot(m); break;
    case 'kill': onKill(m); break;
    case 'hitc': if (m.kill) Snd.kill(); break;
    case 'got': gotAmmo[m.w] = { mag: m.mag, res: m.res }; Snd.part('in'); break;
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
  if (m.mp && m.mp !== MAP.id) setMap(m.mp);
  if (m.dp) syncDrops(m.dp);
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
    if (r.team !== e.t && e.t) setRemoteTeam(r, e.t);
    if (!r.rig) continue;
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
  if (oldTeam && myTeam && oldTeam !== myTeam) buildVM(cur);
  if (needRefill) { refillAmmo(); needRefill = false; selectBest(); }
  else {
    const given = (id) => { const g = gotAmmo[id]; delete gotAmmo[id]; return g || full(id); };
    if (me.p && me.p !== lastInv.p) { ammo[me.p] = given(me.p); selectWeapon(me.p); }
    if (me.s && me.s !== lastInv.s) { ammo[me.s] = given(me.s); if (!me.p || cur === lastInv.s) selectWeapon(me.s); }
    if (me.al && !owned().includes(cur)) selectBest();
  }
  lastInv = { p: me.p, s: me.s };
}

/* ---------- armes au sol ---------- */
const drops = new Map();
const gotAmmo = {};
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
  // chute du corps : à l'opposé du tireur
  const vr = remotes.get(m.v);
  if (vr && vr.rig) {
    const kp = m.k === myId ? P : (remotes.get(m.k) ? remotes.get(m.k).g.position : null);
    if (kp) {
      const dx = kp.x - vr.g.position.x, dz = kp.z - vr.g.position.z, y = vr.g.rotation.y;
      const front = -dx * Math.sin(y) - dz * Math.cos(y), side = dx * Math.cos(y) - dz * Math.sin(y);
      vr.rig.deadDir = front >= 0 ? 1 : -1; vr.rig.deadSide = clamp(side / (Math.hypot(dx, dz) || 1), -1, 1);
    } else vr.rig.deadDir = Math.random() < 0.5 ? 1 : -1;
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

function onRoundStart(m) {
  Snd.roundStart();
  banner('MANCHE ' + m.round, '#ffffff', 'Phase d\'achat : appuie sur B', 2200);
  fx.clear(); closeBuy(true);
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
  const t = myTeam === 'CT' ? 'CT' : 'T';
  return SHOP[t].concat([['Équipement', ['armor', 'helmet'].concat(t === 'CT' ? ['kit'] : [])]]);
}
let buySig = '';
function renderBuy(force) {
  const me = S.me; if (!me) return;
  const sig = [me.mo, me.p, me.s, me.ar, me.he, me.k, me.bo, myTeam].join('|');
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
      if (id === 'armor') { name = 'Gilet pare-balles'; price = 650; stat = 'Protège torse, ventre et bras'; has = me.ar >= 100; }
      else if (id === 'helmet') { name = 'Gilet + casque'; price = me.ar >= 100 ? 350 : 1000; stat = 'Protège aussi la tête'; has = !!me.he; }
      else if (id === 'kit') { name = 'Kit de désamorçage'; price = 400; stat = 'Désamorçage 2x plus rapide'; has = !!me.k; }
      else { const w = WEAPONS[id]; name = w.n; price = w.price; stat = w.dmg + (w.pellets ? ' x' + w.pellets : '') + ' dégâts · ' + w.mag + ' balles' + (w.pen ? ' · perforant' : ''); has = me.p === id || me.s === id; }
      const b = document.createElement('button');
      b.className = 'item' + (has ? ' own' : ''); b.disabled = has || me.mo < price || !me.bo;
      const k = document.createElement('span'); k.className = 'k'; k.textContent = n <= 9 ? String(n) : n === 10 ? '0' : '';
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
// Les navigateurs réservent Ctrl+W, Ctrl+T et Ctrl+N : une page ne peut pas les bloquer,
// sauf en plein écran avec l'API Keyboard Lock (Chrome, Edge, Opera, en https ou localhost).
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyN', 'KeyB', 'KeyC', 'Tab'];
let kbLock = false, leaving = false, ctrlHint = false;
function lockKeys() {
  if (!navigator.keyboard || !navigator.keyboard.lock) return;
  navigator.keyboard.lock(LOCK_KEYS).then(() => { kbLock = true; }).catch(() => {});
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
  else if (root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).then(lockKeys).catch(() => {});
}
// filet de sécurité : le navigateur demande confirmation avant de fermer la partie
window.addEventListener('beforeunload', (e) => {
  if (!connected || leaving) return;
  e.preventDefault(); e.returnValue = '';
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { Object.keys(K).forEach((k) => { K[k] = false; }); fireHeld = false; fireLatch = false; scoped = false; rmbHeld = false; send({ type: 'act', on: 0 }); }
});
canvas.addEventListener('click', () => { if (connected && !ui.buy && !locked) tryLock(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const s = 0.0022 * sens * (cam.fov / FOV);
  P.mouseX += e.movementX; P.mouseY += e.movementY;
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
  // en jeu, Ctrl sert à s'accroupir : pas de Ctrl+S (enregistrer), Ctrl+D (favori), Ctrl+A, etc.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (!kbLock && !ctrlHint && e.code === 'ControlLeft') { ctrlHint = true; notice('Attention : hors plein écran, Ctrl+W ferme la page. Utilise C pour t\'accroupir.', '#ff9a3c'); }
  }
  if (e.code === 'Tab') { e.preventDefault(); ui.board = true; return; }
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'KeyB') { e.preventDefault(); if (ui.buy) closeBuy(); else openBuy(); return; }
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
    if (e.code === 'KeyE' && alive()) send({ type: 'act', on: 1 });
    if (e.code === 'KeyR') reload();
    if (e.code === 'KeyQ') dropCurrent();
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
let chosenMap = MAPS[store.get('cs_map', 'dust')] ? store.get('cs_map', 'dust') : 'dust';
function paintMaps() { document.querySelectorAll('#maps button').forEach((b) => b.classList.toggle('on', b.dataset.m === chosenMap)); }
paintMaps(); setMap(chosenMap);
document.querySelectorAll('#maps button').forEach((b) => b.addEventListener('click', () => { chosenMap = b.dataset.m; store.set('cs_map', chosenMap); paintMaps(); if (!connected) setMap(chosenMap); }));

function startGame() {
  Snd.init(); Snd.setVolume(vol); Snd.setAmbient(MAP.style || MAP.id);
  const name = $('name').value.trim() || 'Joueur' + Math.floor(Math.random() * 900 + 100);
  const room = $('room').value.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'main';
  store.set('cs_name', $('name').value.trim()); store.set('cs_room', $('room').value.trim()); store.set('cs_team', chosenTeam);
  joinInfo = { name, room, team: chosenTeam, map: chosenMap };
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
function paintQuality() { document.querySelectorAll('.qual button').forEach((b) => b.classList.toggle('on', b.dataset.q === GFX.quality)); }
paintQuality();
document.querySelectorAll('.qual button').forEach((b) => b.addEventListener('click', () => {
  GFX.setQuality(b.dataset.q); worldMeshes = GFX.rays; resize(); fx.clear(); paintQuality();
}));
$('resume').addEventListener('click', tryLock);
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) tryLock(); });
$('leave').addEventListener('click', () => { leaving = true; try { ws.close(); } catch (e) {} location.reload(); });

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
  $('icons').textContent = (me.bm ? 'Bombe · ' : '') + (me.he ? 'Casque · ' : '') + (me.k ? 'Kit' : '');
  if (ui.buy) { if (!me.bo || !me.al) closeBuy(true); else renderBuy(); }

  // invites
  let prompt = '';
  if (me.al) {
    if (me.bm && S.ph === 'live') {
      const inSite = Object.keys(SITES).some((k) => Math.hypot(P.x - SITES[k].x, P.z - SITES[k].z) <= SITES[k].r);
      if (inSite) prompt = 'Maintiens E pour poser la bombe';
    }
    if (myTeam === 'CT' && S.b.s === 'planted' && Math.hypot(P.x - S.b.x, P.z - S.b.z) < 2.4) prompt = 'Maintiens E pour désamorcer';
    if (!prompt) {
      const d = nearestDrop();
      if (d) {
        const W = WEAPONS[d.w], held = W.slot === 1 ? me.p : me.s;
        prompt = (held ? 'E : échanger contre ' : 'E : ramasser ') + W.n + ' (' + d.m + ' / ' + d.s + ')';
      }
    }
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
  $('cross').style.display = scoped || aiming || !alive() || cur === 'knife' ? 'none' : 'block';
}

/* ============================================================
   Boucle principale
   ============================================================ */
let last = performance.now(), sendAcc = 0, ovAcc = 0, menuT = 0, sunAcc = 0, heartT = 0, crossGap = 6;
function update(dt, now) {
  const w = WEAPONS[cur];
  const isAlive = alive();
  const frozen = S.ph === 'freeze' || S.ph === 'wait';
  // visée au clic droit (toutes les armes sauf couteau et armes à lunette)
  aiming = rmbHeld && isAlive && locked && cur !== 'knife' && !w.scope && !reloading && swapT <= 0 && !ui.buy && !ui.chat;
  adsT += ((aiming ? 1 : 0) - adsT) * Math.min(1, 11 * dt);
  P.tag = Math.max(0, P.tag - dt); P.landT = Math.max(0, P.landT - dt * 2.2);

  // --- mouvement (inertie : on ne s'arrête pas net)
  if (isAlive) {
    const f = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    const r = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    const len = Math.hypot(f, r) || 1;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const crouching = !!(K.KeyC || K.ControlLeft);
    const back = f < 0 ? 0.85 : 1;
    let spd = 6.1 * (w.spd || 1) * back * (K.ShiftLeft ? 0.5 : 1) * (crouching ? 0.42 : 1) * (scoped ? 0.55 : 1) * (aiming ? 0.62 : 1) * (P.tag > 0 ? 0.55 : 1) * (1 - P.landT * 0.55);
    if (frozen) spd = 0;
    const tx = (-sy * f + cy * r) / len * spd, tz = (-cy * f - sy * r) / len * spd;
    const moving = f || r, ctl = P.ground ? (moving ? 9 : 12) : 0.9;
    P.vx += (tx - P.vx) * Math.min(1, ctl * dt); P.vz += (tz - P.vz) * Math.min(1, ctl * dt);
    P.crouch += ((crouching ? 1 : 0) - P.crouch) * Math.min(1, 9 * dt);
    P.stam = Math.min(1, P.stam + dt * 0.45);
    if (K.Space && P.ground && !frozen) { P.vy = 6.5 * (0.72 + 0.28 * P.stam); P.ground = false; P.stam = Math.max(0, P.stam - 0.55); }
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
      if (P.stepD > 2.15) { P.stepD = 0; if (sp > 3.3 && !K.ShiftLeft && !crouching) Snd.step(surfaceAt(P.x, P.z, P.y), 0.32); }
    }
    P.roll += (clamp(r * Math.min(1, sp / 6), -1, 1) * 0.012 - P.roll) * Math.min(1, 8 * dt);
    // affaissement à l'atterrissage (ressort amorti)
    P.dipV += (-P.dip * 90 - P.dipV * 14) * dt; P.dip += P.dipV * dt;
  }

  // --- armes
  swapT = Math.max(0, swapT - dt);
  if (reloading) {
    const a = ammo[cur], W = WEAPONS[cur];
    if (W.shell) { // cartouche par cartouche
      if (now >= rlNext && a && a.mag < W.mag && a.res > 0) { rlNext += 0.5; a.mag++; a.res--; Snd.part('shell'); }
      if (now >= rlEnd || !a || a.mag >= W.mag || a.res <= 0) { reloading = false; if (a && W.pump && rlEmpty) { boltT = 1; Snd.part('pump'); } }
    } else if (now >= rlEnd) {
      reloading = false;
      if (a) { const take = Math.min(W.mag - a.mag, a.res); a.mag += take; a.res -= take; }
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
    const r = specId && remotes.get(specId);
    if (r && r.alive) { cx = r.g.position.x; cz = r.g.position.z; ey = r.g.position.y + (r.e.c ? 1.15 : 1.62); yaw = r.g.rotation.y; pitch = r.e.p || 0; }
    else { if (!specId || !remotes.get(specId) || !remotes.get(specId).alive) { specId = null; cycleSpec(); } P.deadT = Math.min(1, P.deadT + dt * 2.2); ey = P.y + 1.6 - 1.3 * P.deadT * P.deadT; roll = 0.45 * P.deadT; }
    showVM = false;
  }
  if (isAlive) P.deadT = 0;
  // respiration et tremblement de lunette (Maj pour retenir son souffle)
  if (scoped) {
    const k = K.ShiftLeft ? 0.2 : 1, t = now;
    pitch += (Math.sin(t * 0.9) * 0.0028 + Math.sin(t * 2.1) * 0.0011) * k; yaw += Math.cos(t * 0.67) * 0.0034 * k;
  } else if (isAlive) pitch += Math.sin(now * 1.2) * 0.00045;
  const mv = Math.min(1, Math.hypot(P.vx, P.vz) / 5);
  const bob = isAlive ? Math.sin(P.bob) * 0.016 * mv * (1 - adsT * 0.7) : 0;
  P.shake = Math.max(0, P.shake - dt * 1.3);
  const sh = P.shake * 0.05;
  cam.position.set(cx + (Math.random() - 0.5) * sh, ey + bob + (Math.random() - 0.5) * sh, cz + (Math.random() - 0.5) * sh);
  cam.rotation.set(pitch + (Math.random() - 0.5) * sh, yaw, roll + (Math.random() - 0.5) * sh * 0.5);
  const optic = V && V.info.optic;
  const wantFov = scoped ? (cur === 'awp' ? 14 : 20) : aiming ? (optic ? 36 : 52) : FOV;
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
  $('hurtlow').style.opacity = isAlive && hp <= 30 ? String(0.35 + (30 - hp) / 45) : '0';

  // --- réseau (état du joueur)
  sendAcc += dt;
  if (sendAcc >= 0.033) {
    sendAcc = 0;
    if (isAlive) send({ type: 'st', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), yaw: +(P.yaw + P.recY).toFixed(3), pitch: +(P.pitch + P.recP).toFixed(3), c: P.crouch > 0.5 ? 1 : 0, w: cur, rl: reloading ? 1 : 0, am: ammoMsg() });
  }
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  const now = t / 1000;
  if (connected && S.me) {
    update(dt, now);
    updateRemotes(dt); updateBomb(dt, t); updateDrops(dt);
    fx.update(dt, (p) => { const s = spatial(p.x, p.y, p.z); if (s.d < 8) Snd.casing(s.v); });
    hudAcc += dt;
    if (hudAcc > 0.1) { hudAcc = 0; updateHud(); }
    drawRadar();
    // fondus HUD
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) $('hitm').style.opacity = '0'; }
    if (hurtT > 0) { hurtT -= dt; if (hurtT <= 0) { const h = $('hurt'); h.style.transition = 'opacity .7s'; h.style.opacity = '0'; } }
    if (dmgTimer > 0) { dmgTimer -= dt; if (dmgTimer <= 0) $('dmgdir').firstElementChild.style.opacity = '0'; }
  } else {
    // décor de menu : caméra qui tourne autour de la carte
    menuT += dt * 0.08;
    cam.position.set(Math.sin(menuT) * 26, 7.5, Math.cos(menuT) * 26);
    cam.rotation.set(-0.16, menuT, 0);
    poseVM(dt, now, false);
    fx.update(dt);
  }
  if (banTimer > 0) { banTimer -= dt; if (banTimer <= 0) $('banner').style.opacity = '0'; }
  if (noticeTimer > 0) { noticeTimer -= dt; if (noticeTimer <= 0) $('notice').textContent = ''; }
  ovAcc += dt;
  if (ovAcc > 0.15) { ovAcc = 0; refreshOverlays(); }
  GFX.render(now);
}
buildVM('glock');
requestAnimationFrame(frame);
})();
