/* CS Arena - pass de combat : 30 paliers qui se débloquent en jouant (compte requis), skins d'armes et de couteaux.
   Fenêtre avec la grille des paliers, un aperçu 3D qui tourne et le bouton Équiper. */
window.Pass = (function () {
'use strict';
const $ = (id) => document.getElementById(id);
let isOpen = false, sel = '', busy = false, msg = '', tab = 'pass', selW = 'ak47';
let pv = null;   // aperçu 3D

function h(tag, attrs) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  });
  for (let i = 2; i < arguments.length; i++) {
    const c = arguments[i];
    if (c == null || c === false) continue;
    (Array.isArray(c) ? c : [c]).forEach((x) => e.append(x && x.nodeType ? x : document.createTextNode(String(x))));
  }
  return e;
}
const tierOf = () => (Account.user && Account.user.bp) || { xp: 0, tier: 0, cur: 0, need: CS.PASS.tiers[0].xp };
const msOf = (w) => CS.masteryLv(((Account.user && Account.user.ms) || {})[w] | 0);
const MS_W = () => Object.keys(CS.WEAPONS).filter((w) => CS.SKINS[w + '_m1']);
// skin débloqué ? (pass : palier atteint ; maîtrise : niveau de l'arme)
function owned(id) {
  const d = CS.SKINS[id]; if (!d || !Account.user) return false;
  return d.ms ? msOf(d.w).lv >= d.ms : tierOf().tier >= d.tier;
}

/* ---------- aperçu 3D ---------- */
function preview() {
  if (pv) return pv;
  const c = document.createElement('canvas'); c.className = 'bp-cv'; c.width = 720; c.height = 400;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true }); } catch (e) { return (pv = { c, fail: true }); }
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(1); renderer.setSize(720, 400, false);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 720 / 400, 0.05, 20);
  // reflets : petite pièce lumineuse
  const envS = new THREE.Scene();
  const sph = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const col = [], P = sph.geometry.attributes.position;
  for (let i = 0; i < P.count; i++) { const y = P.getY(i) / 5, k = 0.5 + y * 0.5; col.push(0.08 + k * 0.6, 0.09 + k * 0.62, 0.1 + k * 0.68); }
  sph.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); envS.add(sph);
  [[2.5, 2, 1, 6], [-3, 1, -1, 3], [0, 3.5, -2, 4]].forEach((b) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(b[3], b[3], b[3]) })); m.position.set(b[0], b[1], b[2]); envS.add(m); });
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envS, 0.02).texture; pm.dispose();
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2); key.position.set(2, 3, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec4ff, 1.2); rim.position.set(-3, 1, -2); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x20262c, 0.5));
  const holder = new THREE.Group(); scene.add(holder);
  pv = { c, renderer, scene, cam, holder, id: '', t: 0, raf: 0, last: 0 };
  return pv;
}
function setPreview(skin) {
  const P = preview(); if (P.fail) return;
  if (P.id === skin) return;
  P.id = skin;
  while (P.holder.children.length) P.holder.remove(P.holder.children[0]);
  const d = CS.SKINS[skin]; if (!d) return;
  const g = Models.gunTP(d.w, skin);
  // centrer et cadrer l'arme
  const box = new THREE.Box3().setFromObject(g), ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  g.position.sub(ctr); const piv = new THREE.Group(); piv.add(g); P.holder.add(piv);
  const L = Math.max(sz.x, sz.y, sz.z);
  P.cam.position.set(0, L * 0.25, L * 2.15); P.cam.lookAt(0, 0, 0);
  P.piv = piv;
}
function loop(now) {
  if (!isOpen || !pv || pv.fail) return;
  const dt = Math.min(0.05, (now - (pv.last || now)) / 1000); pv.last = now; pv.t += dt;
  if (pv.piv) { pv.piv.rotation.y = Math.PI / 2 + Math.sin(pv.t * 0.6) * 1.1; pv.piv.rotation.x = Math.sin(pv.t * 0.4) * 0.12; }
  pv.renderer.render(pv.scene, pv.cam);
  pv.raf = requestAnimationFrame(loop);
}

/* ---------- fenêtre ---------- */
function render() {
  const card = $('passCard'); if (!card) return;
  card.innerHTML = '';
  const u = Account.user, T = tierOf(), tiers = CS.PASS.tiers, G = CS.PASS.gain;
  if (!sel || !CS.SKINS[sel]) sel = tiers[Math.min(tiers.length - 1, T.tier)].skin;
  const max = T.tier >= tiers.length;
  const tabs = h('div', { class: 'bp-tabs' },
    h('button', { type: 'button', class: tab === 'pass' ? 'on' : '', onclick: () => { tab = 'pass'; sel = tiers[Math.min(tiers.length - 1, T.tier)].skin; msg = ''; render(); } }, 'PASS DE COMBAT'),
    h('button', { type: 'button', class: tab === 'ms' ? 'on' : '', onclick: () => { tab = 'ms'; sel = selW + '_m1'; msg = ''; render(); } }, 'MAÎTRISE DES ARMES'));
  card.append(h('div', { class: 'bp-head' },
    h('div', null, h('small', null, tab === 'pass' ? 'PASS DE COMBAT · ' + CS.PASS.season.toUpperCase() : 'MAÎTRISE DES ARMES · SKINS EXCLUSIFS'),
      h('h2', null, tab === 'ms' ? 'Plus tu joues une arme, plus elle progresse' : u ? 'Palier ' + T.tier + ' / ' + tiers.length : 'Pass de combat')),
    tabs,
    h('button', { type: 'button', class: 'x', onclick: close, title: 'Fermer (Échap)' }, '✕')));
  if (!u) {
    card.append(h('div', { class: 'bp-guest' }, tab === 'pass' ? 'Le pass est gratuit : crée un compte (ou connecte-toi) et joue en ligne pour débloquer les 30 skins.' : 'La maîtrise est enregistrée sur ton compte : connecte-toi et élimine des adversaires en ligne pour faire progresser tes armes.',
      h('button', { type: 'button', class: 'primary', onclick: () => { close(); Account.open(); } }, 'Se connecter / créer un compte')));
  }
  if (tab === 'ms') { renderMastery(card); return; }
  if (u) {
    const pct = max ? 100 : Math.round(T.cur / Math.max(1, T.need) * 100);
    card.append(h('div', { class: 'bp-prog' },
      h('div', { class: 'bp-bar' }, h('i', { style: 'width:' + pct + '%' })),
      h('span', null, max ? 'Pass terminé : toutes les récompenses sont débloquées !' : T.cur + ' / ' + T.need + ' XP vers le palier ' + (T.tier + 1) + ' · ' + T.xp + ' XP au total')));
  }
  const body = h('div', { class: 'bp-body' });
  // grille des paliers
  const grid = h('div', { class: 'bp-grid' });
  tiers.forEach((t) => {
    const d = CS.SKINS[t.skin], own = u && T.tier >= t.t, eq = u && Account.skinOf(d.w) === t.skin;
    const R = CS.RAR[d.r];
    grid.append(h('button', {
      type: 'button', class: 'bp-tile' + (own ? ' own' : ' lock') + (eq ? ' eq' : '') + (sel === t.skin ? ' sel' : ''),
      style: '--rc:' + R.col, title: Skins.label(t.skin), onclick: () => { sel = t.skin; msg = ''; render(); }
    },
      h('b', null, String(t.t)),
      h('span', { class: 'bp-sw', style: 'background-image:url(' + Skins.thumb(t.skin, 96) + ')' }),
      h('small', null, (CS.WEAPONS[d.w].n || d.w)), h('em', null, d.n),
      own ? (eq ? h('i', { class: 'st' }, '✔') : null) : h('i', { class: 'st' }, '🔒')));
  });
  body.append(grid);
  body.append(sidePanel(h('div', { class: 'bp-how' }, h('b', null, 'Gagner de l\'XP (parties en ligne)'),
      h('div', null, 'Manche jouée +' + G.round + ' · manche gagnée +' + G.roundWin),
      h('div', null, 'Élimination +' + G.kill + ' (+' + G.hs + ' à la tête) · ACE +' + G.ace),
      h('div', null, 'MVP +' + G.mvp + ' · match terminé +' + G.match + ' (+' + G.matchWin + ' si victoire)'),
      h('div', null, 'Série au stand de tir +' + G.range + ' (' + G.rangeDay + ' XP par jour au plus)'),
      h('div', { class: 'dim' }, 'Une manche compte s\'il y a des joueurs dans les deux camps. Pas d\'XP en zone de test.'))));
  card.append(body);
  setPreview(sel);
}
// onglet maîtrise : les armes, leur niveau et leurs 3 skins exclusifs
function renderMastery(card) {
  const u = Account.user, body = h('div', { class: 'bp-body' }), grid = h('div', { class: 'bp-grid ms' });
  MS_W().forEach((w) => {
    const L = msOf(w), pct = L.lv >= CS.MASTERY.max ? 100 : Math.round(L.cur / Math.max(1, L.need) * 100);
    const eqm = u && /_m[123]$/.test(Account.skinOf(w));
    grid.append(h('button', { type: 'button', class: 'bp-tile ms-tile' + (selW === w ? ' sel' : ''), style: '--rc:' + (L.lv >= 10 ? '#f0b43c' : L.lv >= 6 ? '#9a5cff' : L.lv >= 3 ? '#4b7bff' : '#3b4650'),
      onclick: () => { selW = w; sel = w + '_m1'; for (const r of CS.MASTERY.rewards) if (L.lv >= r.lv) sel = w + '_' + r.k; msg = ''; render(); } },
      h('em', null, CS.WEAPONS[w].n), h('small', null, 'Niveau ' + L.lv + ' / ' + CS.MASTERY.max + (eqm ? ' · ✔' : '')),
      h('span', { class: 'ms-bar' }, h('i', { style: 'width:' + pct + '%' })),
      h('span', { class: 'ms-sw' }, CS.MASTERY.rewards.map((r) => h('i', { class: L.lv >= r.lv ? '' : 'lock', style: 'background-image:url(' + Skins.thumb(w + '_' + r.k, 48) + ')' })))));
  });
  body.append(grid);
  const L = msOf(selW), G = CS.MASTERY.gain;
  const list = h('div', { class: 'ms-list' }, CS.MASTERY.rewards.map((r) => {
    const id = selW + '_' + r.k;
    return h('button', { type: 'button', class: 'ms-rw' + (sel === id ? ' sel' : '') + (L.lv >= r.lv ? '' : ' lock'), onclick: () => { sel = id; msg = ''; render(); } },
      h('i', { style: 'background-image:url(' + Skins.thumb(id, 64) + ')' }), h('b', null, r.n), h('small', null, 'Niv. ' + r.lv));
  }));
  body.append(sidePanel(h('div', { class: 'bp-how' },
    h('b', null, CS.WEAPONS[selW].n + ' · niveau ' + L.lv + ' / ' + CS.MASTERY.max),
    h('div', null, L.lv >= CS.MASTERY.max ? 'Maîtrise complète !' : L.cur + ' / ' + L.need + ' XP vers le niveau ' + (L.lv + 1)),
    h('div', null, 'Élimination avec cette arme +' + (selW === 'knife' ? G.knife : G.kill) + ' (+' + G.hs + ' à la tête)'),
    h('div', { class: 'dim' }, 'Parties en ligne seulement. Skins exclusifs aux niveaux 3, 6 et 10.')), list));
  card.append(body);
  setPreview(sel);
}
// panneau de droite : aperçu 3D, nom, bouton Équiper
function sidePanel(how, extra) {
  const u = Account.user, d = CS.SKINS[sel], R = CS.RAR[d.r], own = owned(sel), eq = u && Account.skinOf(d.w) === sel, T = tierOf();
  const P = preview();
  const need = d.ms ? 'Se débloque au niveau ' + d.ms + ' de maîtrise de l\'arme.' : 'Se débloque au palier ' + d.tier + (u ? ' (encore ' + Math.max(0, xpTo(d.tier) - T.xp) + ' XP).' : '.');
  return h('div', { class: 'bp-side' },
    P.fail ? h('div', { class: 'bp-cv bp-sw', style: 'background-image:url(' + Skins.thumb(sel, 256) + ')' }) : P.c,
    extra || null,
    h('div', { class: 'bp-rar', style: 'color:' + R.col }, R.n.toUpperCase() + (d.ms ? ' · MAÎTRISE NIV. ' + d.ms : ' · PALIER ' + d.tier)),
    h('h3', null, Skins.label(sel)),
    h('p', null, own ? (eq ? 'Équipé : tout le monde le voit sur ton arme en partie.' : 'Débloqué. Équipe-le pour le montrer en partie.')
      : need),
    own ? h('button', { type: 'button', class: 'primary', disabled: busy, onclick: () => doEquip(d.w, eq ? '' : sel) }, eq ? 'Retirer le skin' : 'Équiper') : h('button', { type: 'button', disabled: true }, '🔒 Verrouillé'),
    msg ? h('div', { class: 'bp-msg' }, msg) : null,
    how);
}
function xpTo(t) { let x = 0; for (let i = 0; i < t; i++) x += CS.PASS.tiers[i].xp; return x; }
async function doEquip(w, skin) {
  busy = true; msg = ''; render();
  const r = await Account.equip(w, skin);
  busy = false; msg = r.ok ? '' : (r.err || 'Échec'); render();
}
function open(skin) {
  const el = $('pass'); if (!el) return;
  isOpen = true; msg = ''; if (skin) sel = skin;
  el.classList.remove('hide');
  if (document.pointerLockElement) document.exitPointerLock();
  render(); Account.refresh();
  if (pv && !pv.fail) { pv.last = 0; cancelAnimationFrame(pv.raf); pv.raf = requestAnimationFrame(loop); }
}
function close() {
  const el = $('pass'); if (!el) return;
  isOpen = false; el.classList.add('hide');
  if (pv && pv.raf) cancelAnimationFrame(pv.raf);
}
Account.on(() => { if (isOpen) render(); });
window.addEventListener('keydown', (e) => {
  if (!isOpen) return;
  e.stopImmediatePropagation();
  if (e.code === 'Escape') { e.preventDefault(); close(); }
}, true);
window.addEventListener('keyup', (e) => { if (isOpen) e.stopImmediatePropagation(); }, true);
{ const el = $('pass'); if (el) el.addEventListener('mousedown', (e) => { if (e.target === el) close(); }); }

return { open, close, get isOpen() { return isOpen; } };
})();
