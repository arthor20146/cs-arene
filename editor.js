/* CS Arena - éditeur de cartes : vue de dessus, blocs, escaliers, passages couverts, sites, départs, flèches au sol.
   La carte est enregistrée au format source de shared.js (sanitizeMap / buildCustom) : la même chose sert à l'éditeur,
   au serveur et au jeu. Mes cartes : localStorage « cs_maps » ; brouillon : « cs_map_draft ». */
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => String(r2(v)).replace('.', ',');
const CONT = [['r', 0xb5432f, 'Rouge'], ['u', 0x2f6db5, 'Bleu'], ['g', 0x3f8a4a, 'Vert'], ['y', 0xc98a2b, 'Jaune'], ['v', 0x7a3fa0, 'Violet'], ['w', 0xd8d8d0, 'Blanc'], ['k', 0x34383c, 'Gris']];
const hexs = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const LIMIT = 800, MAXSP = 10, STEP = 0.6;

/* ============================================================
   Données de la carte (objets de l'éditeur) <-> format source
   ============================================================ */
// k : box | stairs | arch | site | spawn | mark
let D = { name: 'Ma carte', style: 'dust', sky: 'dust', w: 80, d: 80, objs: [] };
const HX = () => (D.w || 80) / 2, HZ = () => (D.d || 80) / 2;   // demi-largeur, demi-profondeur
let localId = null;           // identifiant dans « Mes cartes »
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

function fromSource(src) {
  const S = CS.sanitizeMap(src), objs = [];
  S.boxes.forEach((b) => objs.push(Object.assign({ k: 'box' }, b, { t: b.t || '' })));
  S.stairs.forEach((s) => objs.push(Object.assign({ k: 'stairs' }, s)));
  S.arches.forEach((a) => objs.push({ k: 'arch', x: a[0], z: a[1], w: a[2], d: a[3], y: a[4], th: a[5] }));
  S.marks.forEach((m) => objs.push({ k: 'mark', x: m[0], z: m[1], dx: m[2], dz: m[3], l: m[4] }));
  Object.keys(S.sites).forEach((id) => objs.push(Object.assign({ k: 'site', id }, S.sites[id])));
  ['T', 'CT'].forEach((team) => S.spawns[team].forEach((p) => objs.push(Object.assign({ k: 'spawn', team }, p))));
  return { name: S.name, style: S.style, sky: S.sky, desc: S.desc, col: S.col, w: S.w, d: S.d, objs };
}
function toSource(d) {
  d = d || D;
  const src = { v: 1, name: d.name, style: d.style, sky: d.sky, desc: d.desc || '', col: d.col || '#c99bff', w: d.w || 80, d: d.d || 80, boxes: [], stairs: [], arches: [], marks: [], sites: {}, spawns: { T: [], CT: [] } };
  d.objs.forEach((o) => {
    if (o.k === 'box') { const b = { x: o.x, z: o.z, w: o.w, d: o.d, h: o.h }; if (o.t) b.t = o.t; if (o.t === 'cont') b.c = o.c; src.boxes.push(b); }
    else if (o.k === 'stairs') src.stairs.push({ x: o.x, z: o.z, w: o.w, dir: o.dir, n: o.n });
    else if (o.k === 'arch') src.arches.push([o.x, o.z, o.w, o.d, o.y, o.th]);
    else if (o.k === 'mark') src.marks.push([o.x, o.z, o.dx, o.dz, o.l]);
    else if (o.k === 'site') src.sites[o.id] = { x: o.x, z: o.z, r: o.r };
    else if (o.k === 'spawn') { const p = { x: o.x, z: o.z }; if (o.yaw != null) p.yaw = o.yaw; src.spawns[o.team].push(p); }
  });
  return CS.sanitizeMap(src);
}
function blankMap() {
  const sp = CS.makeSpawns(), objs = [];
  ['T', 'CT'].forEach((team) => sp[team].forEach((p) => objs.push({ k: 'spawn', team, x: p.x, z: p.z })));
  objs.push({ k: 'site', id: 'A', x: -26, z: -20, r: 6.5 }, { k: 'site', id: 'B', x: 26, z: -20, r: 6.5 });
  return { name: 'Ma carte', style: 'dust', sky: 'dust', w: 80, d: 80, objs };
}

/* ---------- stockage local ---------- */
const LS = {
  list() { try { const a = JSON.parse(localStorage.getItem('cs_maps') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  put(list) { try { localStorage.setItem('cs_maps', JSON.stringify(list)); return true; } catch (e) { toast('Stockage du navigateur plein : exporte la carte en fichier', true); return false; } },
  draft(v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('cs_map_draft') || 'null'); localStorage.setItem('cs_map_draft', JSON.stringify(v)); } catch (e) { return null; } }
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let savedSig = '';
function saveLocal(silent) {
  D.name = ($('mname').value.trim() || 'Ma carte').slice(0, 24);
  const data = toSource(), list = LS.list();
  if (!localId) localId = newId();
  const i = list.findIndex((m) => m.id === localId), e = { id: localId, name: data.name, data, at: Date.now() };
  if (i >= 0) list[i] = e; else list.unshift(e);
  if (!LS.put(list)) return null;
  savedSig = JSON.stringify(data); markSaved();
  if (!silent) toast('Carte enregistrée : « ' + data.name + ' »');
  return localId;
}
function markSaved() {
  const sig = JSON.stringify(toSource());
  $('saved').textContent = !localId ? 'Pas encore enregistrée' : sig === savedSig ? '✔ Enregistrée' : '● Modifications non enregistrées';
  $('saved').style.color = sig === savedSig && localId ? 'var(--ok)' : '';
}

/* ============================================================
   Annuler / rétablir
   ============================================================ */
const undo = [], redo = [];
let before = null;
const snap = () => JSON.stringify({ n: D.name, s: D.style, k: D.sky, de: D.desc, co: D.col, w: D.w, d: D.d, o: D.objs });
function restore(sig) { const v = JSON.parse(sig); D.name = v.n; D.style = v.s; D.sky = v.k; D.desc = v.de; D.col = v.co; D.w = v.w || 80; D.d = v.d || 80; D.objs = v.o; sel.clear(); syncMapPane(); changed(); }
function begin() { if (before === null) before = snap(); }
function commit() {
  if (before === null) return;
  const now = snap();
  if (now !== before) { undo.push(before); if (undo.length > 150) undo.shift(); redo.length = 0; changed(); }
  before = null;
}
function doUndo() { if (!undo.length) return; redo.push(snap()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snap()); restore(redo.pop()); }
let draftT = 0;
function changed(noDraft) {
  validateSoon(); draw(); props(); stats(); markSaved();
  $('bUndo').disabled = !undo.length; $('bRedo').disabled = !redo.length;
  if (!noDraft) { clearTimeout(draftT); draftT = setTimeout(() => LS.draft({ id: localId, data: toSource(), saved: savedSig }), 400); }
}

/* ============================================================
   Outils
   ============================================================ */
const TOOLS = [
  { id: 'select', n: 'Sélection', key: 'V', ic: 'sel' },
  '-',
  { id: 'wall', n: 'Mur', key: '1', ic: 'wall', h: 6, t: '', dw: 6, dd: 1, tip: 'Mur infranchissable. Glisse pour tracer, clic pour un mur de 6 m.' },
  { id: 'low', n: 'Muret', key: '2', ic: 'low', h: 1.1, t: 'w', dw: 4, dd: 0.6, tip: 'Muret de pierre : on tire par-dessus, accroupi on est caché.' },
  { id: 'crate', n: 'Caisse', key: '3', ic: 'crate', h: 1.4, t: '', dw: 2, dd: 2, tip: 'Caisse en bois (les balles la traversent). On saute dessus jusqu\'à 1,5 m.' },
  { id: 'bigcrate', n: 'Gde caisse', key: '4', ic: 'bigcrate', h: 2.4, t: '', dw: 2.5, dd: 2.5, tip: 'Grande caisse : cache un joueur debout.' },
  { id: 'cont', n: 'Conteneur', key: '5', ic: 'cont', h: 2.6, t: 'cont', dw: 6, dd: 2.5, tip: 'Conteneur en tôle (les fusils le traversent). Taille réelle : 6 ou 12 m × 2,5 m, 2,6 m par étage.' },
  { id: 'barrel', n: 'Fût', key: '6', ic: 'barrel', tip: 'Fût métallique. Clic pour le poser.' },
  { id: 'plat', n: 'Terrasse', key: '7', ic: 'plat', h: 2.5, t: 'w', dw: 6, dd: 6, tip: 'Bloc de pierre sur lequel on marche (terrasse, balcon). Ajoute un escalier pour y monter.' },
  { id: 'stairs', n: 'Escalier', key: '8', ic: 'stairs', tip: 'Glisse depuis le pied de l\'escalier dans le sens de la montée. Marches de 0,5 m, franchies sans sauter.' },
  { id: 'arch', n: 'Toit', key: '9', ic: 'arch', tip: 'Passage couvert, arche ou toit : décor au-dessus des têtes, il arrête les balles mais pas les joueurs.' },
  '-',
  { id: 'siteA', n: 'Site A', key: 'A', ic: 'siteA', tip: 'Zone où les T posent la bombe. Clic pour la placer (une seule par lettre).' },
  { id: 'siteB', n: 'Site B', key: 'B', ic: 'siteB', tip: 'Deuxième site de bombe.' },
  { id: 'spT', n: 'Départ T', key: 'T', ic: 'spT', tip: 'Point de départ des Terroristes (10 au plus). Mets-en au moins 5.' },
  { id: 'spCT', n: 'Départ CT', key: 'C', ic: 'spCT', tip: 'Point de départ des Anti-terroristes (10 au plus).' },
  { id: 'mark', n: 'Flèche', key: 'F', ic: 'mark', tip: 'Flèche peinte au sol vers un site. Glisse dans le sens de la flèche.' },
  '-',
  { id: 'erase', n: 'Gomme', key: 'X', ic: 'erase', tip: 'Clic sur un objet pour l\'effacer (ou glisser pour en effacer plusieurs).' }
];
const TOOL = {}; TOOLS.forEach((t) => { if (t.id) TOOL[t.id] = t; });
let tool = 'select';
const opt = { contC: 0xb5432f, contN: 1, markL: 'A', wallH: 6 };
function icon(id) {
  const c = document.createElement('canvas'); c.width = 40; c.height = 28; const g = c.getContext('2d');
  const R = (x, y, w, h, f, s) => { g.fillStyle = f; g.fillRect(x, y, w, h); if (s) { g.strokeStyle = s; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); } };
  switch (id) {
    case 'sel': g.fillStyle = '#eef2f5'; g.beginPath(); g.moveTo(14, 3); g.lineTo(14, 24); g.lineTo(19, 19); g.lineTo(23, 26); g.lineTo(26, 24); g.lineTo(22, 17); g.lineTo(29, 17); g.closePath(); g.fill(); break;
    case 'wall': R(4, 10, 32, 8, '#59636c', '#9aa7b2'); break;
    case 'low': R(6, 11, 28, 6, '#a89a7c', '#d9ccb0'); break;
    case 'crate': R(12, 6, 16, 16, '#8a6335', '#c79a5c'); g.strokeStyle = '#c79a5c'; g.beginPath(); g.moveTo(12, 6); g.lineTo(28, 22); g.stroke(); break;
    case 'bigcrate': R(9, 3, 22, 22, '#7a5428', '#c79a5c'); g.strokeStyle = '#c79a5c'; g.beginPath(); g.moveTo(9, 3); g.lineTo(31, 25); g.moveTo(31, 3); g.lineTo(9, 25); g.stroke(); break;
    case 'cont': R(3, 8, 34, 12, '#b5432f', '#e48a72'); g.strokeStyle = 'rgba(0,0,0,.35)'; for (let x = 7; x < 36; x += 4) { g.beginPath(); g.moveTo(x, 9); g.lineTo(x, 19); g.stroke(); } break;
    case 'barrel': g.fillStyle = '#7d8388'; g.beginPath(); g.arc(20, 14, 8, 0, 7); g.fill(); g.strokeStyle = '#c3c9ce'; g.lineWidth = 1.5; g.stroke(); g.beginPath(); g.arc(20, 14, 4, 0, 7); g.stroke(); break;
    case 'plat': R(6, 4, 28, 20, '#b39a6e', '#e6d3ab'); g.strokeStyle = 'rgba(0,0,0,.25)'; for (let i = -20; i < 40; i += 6) { g.beginPath(); g.moveTo(6 + i, 24); g.lineTo(26 + i, 4); g.stroke(); } break;
    case 'stairs': for (let i = 0; i < 5; i++) R(10, 3 + i * 4.5, 20, 4, 'rgb(' + (150 + i * 18) + ',' + (135 + i * 16) + ',' + (110 + i * 14) + ')'); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(20, 1); g.lineTo(25, 7); g.lineTo(15, 7); g.fill(); break;
    case 'arch': g.setLineDash([3, 2]); g.strokeStyle = '#e6c25a'; g.lineWidth = 2; g.strokeRect(5, 6, 30, 16); g.setLineDash([]); g.strokeStyle = 'rgba(230,194,90,.45)'; for (let i = 0; i < 30; i += 5) { g.beginPath(); g.moveTo(5 + i, 22); g.lineTo(11 + i, 6); g.stroke(); } break;
    case 'siteA': case 'siteB': g.fillStyle = 'rgba(216,67,47,.3)'; g.beginPath(); g.arc(20, 14, 11, 0, 7); g.fill(); g.strokeStyle = '#e8503a'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(id === 'siteA' ? 'A' : 'B', 20, 15); break;
    case 'spT': case 'spCT': g.fillStyle = id === 'spT' ? '#e0a040' : '#5aa0ff'; g.beginPath(); g.arc(20, 16, 7, 0, 7); g.fill(); g.beginPath(); g.moveTo(20, 2); g.lineTo(25, 9); g.lineTo(15, 9); g.fill(); break;
    case 'mark': g.strokeStyle = '#e8503a'; g.fillStyle = '#e8503a'; g.lineWidth = 3; g.beginPath(); g.moveTo(5, 14); g.lineTo(27, 14); g.stroke(); g.beginPath(); g.moveTo(35, 14); g.lineTo(26, 8); g.lineTo(26, 20); g.fill(); break;
    case 'erase': g.save(); g.translate(20, 14); g.rotate(-0.6); R(-11, -6, 22, 12, '#e5483f'); R(-11, -6, 8, 12, '#f0c9c5'); g.restore(); break;
  }
  return c;
}
function buildTools() {
  const box = $('tools');
  TOOLS.forEach((t) => {
    if (t === '-') { box.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button'); b.dataset.t = t.id; b.title = t.n + ' (' + t.key + ')' + (t.tip ? ' — ' + t.tip : '');
    const k = document.createElement('kbd'); k.textContent = t.key;
    const s = document.createElement('small'); s.textContent = t.n;
    b.append(k, icon(t.ic), s); b.addEventListener('click', () => setTool(t.id));
    box.appendChild(b);
  });
}
function setTool(id) {
  tool = id; drag = null;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.t === id));
  $('sTool').textContent = TOOL[id].n;
  cv.style.cursor = id === 'select' ? 'default' : 'crosshair';
  hint(); props(); draw();
}
function hint(text) {
  const t = TOOL[tool];
  $('hint').innerHTML = '';
  const b = document.createElement('b'); b.textContent = t.n; $('hint').append(b, document.createTextNode(' · ' + (text || t.tip || 'Clic : choisir · glisser : déplacer ou encadrer · poignées : redimensionner')));
}

/* ============================================================
   Vue : caméra 2D
   ============================================================ */
const cv = $('cv'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const view = { x: 0, z: 0, s: 9 };   // s = pixels par mètre
let snapStep = 0.5, showReach = false, showLabels = true;
function resize() {
  const r = $('stage').getBoundingClientRect(); DPR = window.devicePixelRatio || 1;
  W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  draw();
}
const sx = (x) => (x - view.x) * view.s + W / 2, sz = (z) => (z - view.z) * view.s + H / 2;
const wx = (px) => (px - W / 2) / view.s + view.x, wz = (py) => (py - H / 2) / view.s + view.z;
const snapV = (v) => Math.round(v / snapStep) * snapStep;
function fit() { view.x = 0; view.z = 0; view.s = Math.max(1, Math.min(W / (2 * HX() + 8), H / (2 * HZ() + 8))); draw(); }
function zoomAt(f, px, py) {
  const ax = wx(px), az = wz(py);
  view.s = clamp(view.s * f, 2, 90);
  view.x = ax - (px - W / 2) / view.s; view.z = az - (py - H / 2) / view.s;
  draw();
}

/* ============================================================
   Géométrie des objets
   ============================================================ */
function stairsRect(o) {
  const d = DIRV[o.dir], L = o.n * STEP;
  const cx = o.x + d[0] * L / 2, cz = o.z + d[1] * L / 2;
  return d[0] ? { x: cx, z: cz, w: L, d: o.w } : { x: cx, z: cz, w: o.w, d: L };
}
function rectOf(o) {
  if (o.k === 'box' || o.k === 'arch') return { x: o.x, z: o.z, w: o.w, d: o.d };
  if (o.k === 'stairs') return stairsRect(o);
  if (o.k === 'site') return { x: o.x, z: o.z, w: o.r * 2, d: o.r * 2 };
  return { x: o.x, z: o.z, w: 1.4, d: 1.4 };
}
function inRect(r, x, z, m) { m = m || 0; return Math.abs(x - r.x) <= r.w / 2 + m && Math.abs(z - r.z) <= r.d / 2 + m; }
// objet sous le curseur : petits objets d'abord
function pick(x, z) {
  const tol = 6 / view.s;
  let best = null, bestA = Infinity;
  const consider = (o, a) => { if (a < bestA) { best = o; bestA = a; } };
  D.objs.forEach((o) => {
    if (o.k === 'spawn' && Math.hypot(x - o.x, z - o.z) < 0.7 + tol) consider(o, -2);
    else if (o.k === 'mark' && Math.hypot(x - o.x, z - o.z) < 1 + tol) consider(o, -1);
    else if (o.k === 'site') { const d = Math.hypot(x - o.x, z - o.z); if (d < 1.6 + tol || Math.abs(d - o.r) < tol * 1.5) consider(o, -0.5); }
    else if (o.k === 'box' || o.k === 'stairs' || o.k === 'arch') { const r = rectOf(o); if (inRect(r, x, z, tol * 0.6)) consider(o, r.w * r.d + (o.k === 'arch' ? 0.5 : 0)); }
  });
  return best;
}
function cloneObj(o) { return JSON.parse(JSON.stringify(o)); }
function move(o, dx, dz) { o.x = r2(clamp(o.x + dx, -HX(), HX())); o.z = r2(clamp(o.z + dz, -HZ(), HZ())); }
function rotate(o) {
  if (o.k === 'box' || o.k === 'arch') { const w = o.w; o.w = o.d; o.d = w; }
  else if (o.k === 'stairs') {   // quart de tour autour du centre
    const r0 = stairsRect(o); o.dir = { n: 'e', e: 's', s: 'w', w: 'n' }[o.dir];
    const d = DIRV[o.dir], L = o.n * STEP; o.x = r2(r0.x - d[0] * L / 2); o.z = r2(r0.z - d[1] * L / 2);
  } else if (o.k === 'mark') { const a = Math.atan2(o.dz, o.dx) + Math.PI / 4; o.dx = r2(Math.cos(a)); o.dz = r2(Math.sin(a)); }
  else if (o.k === 'spawn') { const y = o.yaw != null ? o.yaw : autoYaw(o); o.yaw = r2(((y - Math.PI / 4) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)); }
}
const autoYaw = (o) => Math.atan2(o.x, o.z);
const countBoxes = () => D.objs.filter((o) => o.k === 'box').length + D.objs.filter((o) => o.k === 'stairs').reduce((a, o) => a + o.n, 0);

/* ============================================================
   Dessin
   ============================================================ */
const sel = new Set();
let hover = null, drag = null, mouse = { x: 0, z: 0, px: 0, py: 0, in: false };
function boxFill(o) {
  const k = 0.7 + 0.3 * Math.min(1, o.h / 8);
  const sh = (c) => 'rgb(' + Math.round(((c >> 16) & 255) * k) + ',' + Math.round(((c >> 8) & 255) * k) + ',' + Math.round((c & 255) * k) + ')';
  if (o.t === 'cont') return sh(o.c);
  if (o.t === 'barrel') return '#7d8388';
  if (o.t === 'w') return o.h >= 2 ? sh(0xb39a6e) : sh(0xa89a7c);
  if (o.h <= 2.7) return sh(0x8a6335);
  return D.style === 'dust' ? sh(0x8d7c5d) : sh(0x5c646b);
}
let reach = null;
function draw() {
  if (!W) return;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
  // sol de la carte
  const hx = HX(), hz = HZ();
  g.fillStyle = D.style === 'dust' ? '#3d3627' : '#2a2e32'; g.fillRect(sx(-hx), sz(-hz), 2 * hx * view.s, 2 * hz * view.s);
  // grille
  const step = view.s >= 14 ? 1 : view.s >= 6 ? 2 : 5;
  g.lineWidth = 1;
  const gl = (v) => (v === 0 ? 'rgba(255,255,255,.22)' : v % 10 === 0 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.045)');
  for (let v = -Math.floor(hx / step) * step; v <= hx; v += step) { g.strokeStyle = gl(v); g.beginPath(); g.moveTo(Math.round(sx(v)) + 0.5, sz(-hz)); g.lineTo(Math.round(sx(v)) + 0.5, sz(hz)); g.stroke(); }
  for (let v = -Math.floor(hz / step) * step; v <= hz; v += step) { g.strokeStyle = gl(v); g.beginPath(); g.moveTo(sx(-hx), Math.round(sz(v)) + 0.5); g.lineTo(sx(hx), Math.round(sz(v)) + 0.5); g.stroke(); }
  // repères : zones de départ, nord/sud
  g.fillStyle = 'rgba(255,255,255,.28)'; g.font = '11px Trebuchet MS'; g.textAlign = 'center';
  g.fillText('NORD · CT · ' + (2 * hx) + ' × ' + (2 * hz) + ' m', sx(0), sz(-hz) - 8); g.fillText('SUD · T', sx(0), sz(hz) + 16);
  if (showReach && reach) drawReach();
  // enceinte
  g.strokeStyle = '#6b757e'; g.lineWidth = Math.max(2, view.s); g.strokeRect(sx(-hx) - view.s / 2, sz(-hz) - view.s / 2, (2 * hx + 1) * view.s, (2 * hz + 1) * view.s);
  // sites
  D.objs.forEach((o) => { if (o.k !== 'site') return;
    g.fillStyle = 'rgba(216,67,47,.16)'; g.strokeStyle = 'rgba(232,80,58,.9)'; g.lineWidth = 2; g.setLineDash([8, 5]);
    g.beginPath(); g.arc(sx(o.x), sz(o.z), o.r * view.s, 0, 7); g.fill(); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold ' + Math.max(14, view.s * 3) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.id, sx(o.x), sz(o.z));
  });
  // flèches au sol
  D.objs.forEach((o) => { if (o.k !== 'mark') return; drawMark(o); });
  // ombres puis blocs (les plus hauts par-dessus)
  const solids = D.objs.filter((o) => o.k === 'box').sort((a, b) => a.h - b.h);
  g.fillStyle = 'rgba(0,0,0,.35)';
  solids.forEach((o) => { const off = Math.min(1.2, o.h * 0.12) * view.s; g.fillRect(sx(o.x - o.w / 2) + off, sz(o.z - o.d / 2) + off, o.w * view.s, o.d * view.s); });
  D.objs.forEach((o) => { if (o.k === 'stairs') drawStairs(o); });
  solids.forEach(drawBox);
  D.objs.forEach((o) => { if (o.k === 'arch') drawArch(o); });
  D.objs.forEach((o) => { if (o.k === 'spawn') drawSpawn(o); });
  issueMarks();
  // survol, sélection, poignées
  if (hover && !sel.has(hover) && tool !== 'erase') outline(hover, 'rgba(79,227,255,.45)', 1);
  if (hover && tool === 'erase') outline(hover, '#ff5a4a', 2);
  sel.forEach((o) => outline(o, '#4fe3ff', 2));
  const hs = handlesOf(); hs.forEach((h) => { g.fillStyle = '#4fe3ff'; g.fillRect(h.px - 4, h.py - 4, 8, 8); g.strokeStyle = '#002a33'; g.lineWidth = 1; g.strokeRect(h.px - 4.5, h.py - 4.5, 9, 9); });
  drawDrag();
}
function drawBox(o) {
  const x = sx(o.x - o.w / 2), y = sz(o.z - o.d / 2), w = o.w * view.s, h = o.d * view.s;
  if (o.t === 'barrel') {
    g.fillStyle = '#7d8388'; g.beginPath(); g.arc(sx(o.x), sz(o.z), 0.4 * view.s, 0, 7); g.fill(); g.strokeStyle = '#c3c9ce'; g.lineWidth = 1; g.stroke(); return;
  }
  g.fillStyle = boxFill(o); g.fillRect(x, y, w, h);
  if (o.t === 'cont' && view.s > 5) {   // nervures de la tôle
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 1; const along = o.w >= o.d, L = along ? w : h;
    for (let t = 0.35 * view.s; t < L; t += 0.35 * view.s * 2) { g.beginPath(); if (along) { g.moveTo(x + t, y); g.lineTo(x + t, y + h); } else { g.moveTo(x, y + t); g.lineTo(x + w, y + t); } g.stroke(); }
  }
  if (o.t === 'w' && o.h >= 2) {   // terrasse : hachures, on y marche
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    for (let t = -h; t < w; t += 8) { g.beginPath(); g.moveTo(x + t, y + h); g.lineTo(x + t + h, y); g.stroke(); } g.restore();
  }
  if (!o.t && o.h <= 2.7 && view.s > 6) { g.strokeStyle = 'rgba(255,220,160,.28)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (showLabels && w > 26 && h > 13) { g.fillStyle = 'rgba(255,255,255,.82)'; g.font = '11px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fmt(o.h) + ' m', x + w / 2, y + h / 2); }
}
function drawStairs(o) {
  const d = DIRV[o.dir];
  for (let i = 0; i < o.n; i++) {
    const cx = o.x + d[0] * (i + 0.5) * STEP, cz = o.z + d[1] * (i + 0.5) * STEP, sw = d[0] ? STEP : o.w, sd = d[0] ? o.w : STEP;
    const k = 0.55 + 0.45 * (i + 1) / Math.max(o.n, 1);
    g.fillStyle = 'rgb(' + Math.round(190 * k) + ',' + Math.round(172 * k) + ',' + Math.round(140 * k) + ')';
    g.fillRect(sx(cx - sw / 2), sz(cz - sd / 2), sw * view.s, sd * view.s);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.strokeRect(sx(cx - sw / 2) + 0.5, sz(cz - sd / 2) + 0.5, sw * view.s - 1, sd * view.s - 1);
  }
  const r = stairsRect(o), L = o.n * STEP;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2;
  const ax = sx(o.x + d[0] * 0.2), az = sz(o.z + d[1] * 0.2), bx = sx(o.x + d[0] * (L - 0.2)), bz = sz(o.z + d[1] * (L - 0.2));
  g.beginPath(); g.moveTo(ax, az); g.lineTo(bx, bz); g.stroke();
  const a = Math.atan2(bz - az, bx - ax); g.beginPath(); g.moveTo(bx, bz); g.lineTo(bx - Math.cos(a - 0.5) * 8, bz - Math.sin(a - 0.5) * 8); g.lineTo(bx - Math.cos(a + 0.5) * 8, bz - Math.sin(a + 0.5) * 8); g.fill();
  if (showLabels && view.s > 6) { g.font = '11px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillText('→ ' + fmt(o.n * 0.5) + ' m', sx(r.x), sz(r.z) + (d[0] ? -9 : 0) + 0.5); }
}
function drawArch(o) {
  const x = sx(o.x - o.w / 2), y = sz(o.z - o.d / 2), w = o.w * view.s, h = o.d * view.s;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(230,194,90,.12)'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(230,194,90,.35)'; g.lineWidth = 1; for (let t = -h; t < w; t += 7) { g.beginPath(); g.moveTo(x + t, y + h); g.lineTo(x + t + h, y); g.stroke(); }
  g.restore();
  g.setLineDash([6, 4]); g.strokeStyle = '#e6c25a'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); g.setLineDash([]);
  if (showLabels && w > 40 && h > 13) { g.fillStyle = '#f3dc93'; g.font = '11px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('toit ' + fmt(o.y) + ' m', x + w / 2, y + h / 2); }
}
function drawSpawn(o) {
  const c = o.team === 'T' ? '#e0a040' : '#5aa0ff', x = sx(o.x), y = sz(o.z), r = Math.max(4, 0.4 * view.s);
  const yaw = o.yaw != null ? o.yaw : autoYaw(o), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + fx * r * 2.4, y + fz * r * 2.4); g.stroke();
  g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; g.stroke();
  if (view.s > 7) { const i = D.objs.filter((p) => p.k === 'spawn' && p.team === o.team).indexOf(o) + 1; g.fillStyle = '#111'; g.font = 'bold ' + Math.round(r * 1.2) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i), x, y + 0.5); }
}
function drawMark(o) {
  const x = sx(o.x), y = sz(o.z), a = Math.atan2(o.dz, o.dx), s = view.s;
  g.save(); g.translate(x, y); g.rotate(a); g.strokeStyle = 'rgba(232,80,58,.9)'; g.fillStyle = 'rgba(232,80,58,.9)'; g.lineWidth = Math.max(2, 0.14 * s);
  g.beginPath(); g.moveTo(-0.1 * s, 0); g.lineTo(0.72 * s, 0); g.stroke();
  g.beginPath(); g.moveTo(0.95 * s, 0); g.lineTo(0.55 * s, -0.26 * s); g.lineTo(0.55 * s, 0.26 * s); g.closePath(); g.fill(); g.restore();
  g.fillStyle = 'rgba(232,80,58,.95)'; g.font = 'bold ' + Math.max(10, 0.8 * s) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(o.l, x - Math.cos(a) * 0.55 * s, y - Math.sin(a) * 0.55 * s);
}
function outline(o, col, lw) {
  g.strokeStyle = col; g.lineWidth = lw;
  if (o.k === 'site') { g.beginPath(); g.arc(sx(o.x), sz(o.z), o.r * view.s, 0, 7); g.stroke(); return; }
  if (o.k === 'spawn' || o.k === 'mark') { g.beginPath(); g.arc(sx(o.x), sz(o.z), Math.max(8, 0.8 * view.s), 0, 7); g.stroke(); return; }
  const r = rectOf(o); g.strokeRect(sx(r.x - r.w / 2) - 1.5, sz(r.z - r.d / 2) - 1.5, r.w * view.s + 3, r.d * view.s + 3);
}
// poignées : un seul bloc / toit sélectionné (8 poignées), un site (bord), un escalier (bout)
function handlesOf() {
  if (sel.size !== 1 || tool !== 'select') return [];
  const o = sel.values().next().value, out = [];
  if ((o.k === 'box' && o.t !== 'barrel') || o.k === 'arch') {
    [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].forEach(([hx, hz]) => out.push({ hx, hz, px: sx(o.x + hx * o.w / 2), py: sz(o.z + hz * o.d / 2) }));
  } else if (o.k === 'site') out.push({ ring: 1, px: sx(o.x + o.r), py: sz(o.z) });
  else if (o.k === 'stairs') { const d = DIRV[o.dir], L = o.n * STEP; out.push({ end: 1, px: sx(o.x + d[0] * L), py: sz(o.z + d[1] * L) }); }
  return out;
}
function drawDrag() {
  if (!drag) return;
  if (drag.m === 'marquee' || drag.m === 'erase') {
    const x = Math.min(drag.px0, mouse.px), y = Math.min(drag.py0, mouse.py), w = Math.abs(mouse.px - drag.px0), h = Math.abs(mouse.py - drag.py0);
    g.fillStyle = drag.m === 'erase' ? 'rgba(229,72,63,.12)' : 'rgba(79,227,255,.1)'; g.fillRect(x, y, w, h);
    g.strokeStyle = drag.m === 'erase' ? '#e5483f' : '#4fe3ff'; g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(x + 0.5, y + 0.5, w, h); g.setLineDash([]);
  } else if (drag.m === 'create' && drag.prev) {
    const o = drag.prev;
    if (o.k === 'box') drawBox(o); else if (o.k === 'arch') drawArch(o); else if (o.k === 'stairs') drawStairs(o); else if (o.k === 'mark') drawMark(o);
    const r = rectOf(o);
    g.fillStyle = '#4fe3ff'; g.font = '12px Trebuchet MS'; g.textAlign = 'left'; g.textBaseline = 'top';
    const txt = o.k === 'stairs' ? o.n + ' marches · ' + fmt(o.n * 0.5) + ' m de haut' : o.k === 'mark' ? 'Flèche ' + o.l : fmt(r.w) + ' × ' + fmt(r.d) + ' m';
    g.fillText(txt, mouse.px + 14, mouse.py + 12);
  }
}

/* ============================================================
   Souris
   ============================================================ */
function createAt(x0, z0, x1, z1, isClick) {
  const t = TOOL[tool];
  if (tool === 'stairs') {
    const dx = x1 - x0, dz = z1 - z0, horiz = Math.abs(dx) > Math.abs(dz);
    const dir = horiz ? (dx >= 0 ? 'e' : 'w') : (dz >= 0 ? 's' : 'n');
    const n = isClick ? 5 : clamp(Math.round(Math.max(Math.abs(dx), Math.abs(dz)) / STEP), 1, 16);
    return { k: 'stairs', x: r2(x0), z: r2(z0), w: 3, dir, n };
  }
  if (tool === 'mark') {
    let dx = x1 - x0, dz = z1 - z0; if (isClick || Math.hypot(dx, dz) < 0.5) { dx = 0; dz = -1; }
    const a = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { k: 'mark', x: r2(x0), z: r2(z0), dx: r2(Math.cos(a)), dz: r2(Math.sin(a)), l: opt.markL };
  }
  let w, d, cx, cz;
  if (isClick) {
    w = tool === 'arch' ? 6 : t.dw; d = tool === 'arch' ? 3 : t.dd;
    if (tool === 'cont') { w = 6; d = 2.5; }
    cx = x0; cz = z0;
  } else {
    w = Math.max(0.2, Math.abs(x1 - x0)); d = Math.max(0.2, Math.abs(z1 - z0)); cx = (x0 + x1) / 2; cz = (z0 + z1) / 2;
    if (tool === 'cont') {   // un conteneur garde sa largeur réelle de 2,5 m
      if (w >= d) { d = 2.5; cz = z0 + Math.sign(z1 - z0 || 1) * 1.25; } else { w = 2.5; cx = x0 + Math.sign(x1 - x0 || 1) * 1.25; }
    }
  }
  if (tool === 'arch') return { k: 'arch', x: r2(cx), z: r2(cz), w: r2(w), d: r2(d), y: 3.2, th: 0.8 };
  const o = { k: 'box', x: r2(cx), z: r2(cz), w: r2(w), d: r2(d), h: t.h, t: t.t };
  if (tool === 'wall') o.h = opt.wallH;
  if (tool === 'cont') { o.c = opt.contC; o.h = r2(2.6 * opt.contN); }
  return o;
}
function placePoint(x, z) {
  begin();
  if (tool === 'barrel') { const o = { k: 'box', x: r2(x), z: r2(z), w: 0.8, d: 0.8, h: 1.1, t: 'barrel' }; D.objs.push(o); sel.clear(); sel.add(o); }
  else if (tool === 'siteA' || tool === 'siteB') {
    const id = tool === 'siteA' ? 'A' : 'B';
    let o = D.objs.find((q) => q.k === 'site' && q.id === id);
    if (o) { o.x = r2(x); o.z = r2(z); } else { o = { k: 'site', id, x: r2(x), z: r2(z), r: 6.5 }; D.objs.push(o); }
    sel.clear(); sel.add(o);
  } else if (tool === 'spT' || tool === 'spCT') {
    const team = tool === 'spT' ? 'T' : 'CT';
    if (D.objs.filter((q) => q.k === 'spawn' && q.team === team).length >= MAXSP) { toast(MAXSP + ' départs ' + team + ' au maximum', true); before = null; return; }
    const o = { k: 'spawn', team, x: r2(clamp(x, -HX() + 0.5, HX() - 0.5)), z: r2(clamp(z, -HZ() + 0.5, HZ() - 0.5)) }; D.objs.push(o); sel.clear(); sel.add(o);
  }
  commit();
}
function eraseRect(px0, py0, px1, py1) {
  const x0 = wx(Math.min(px0, px1)), x1 = wx(Math.max(px0, px1)), z0 = wz(Math.min(py0, py1)), z1 = wz(Math.max(py0, py1));
  return D.objs.filter((o) => { const r = rectOf(o); return r.x >= x0 && r.x <= x1 && r.z >= z0 && r.z <= z1; });
}
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('mousedown', (e) => {
  const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top, x = wx(px), z = wz(py);
  document.activeElement && document.activeElement.blur && document.activeElement !== document.body && document.activeElement.blur();
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) { drag = { m: 'pan', px0: px, py0: py, vx: view.x, vz: view.z }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (tool === 'select') {
    const h = handlesOf().find((q) => Math.abs(q.px - px) < 7 && Math.abs(q.py - py) < 7);
    if (h) { const o = sel.values().next().value; begin(); drag = { m: 'handle', h, o, o0: cloneObj(o) }; return; }
    const o = pick(x, z);
    if (o) {
      if (e.shiftKey) { if (sel.has(o)) sel.delete(o); else sel.add(o); draw(); props(); return; }
      if (!sel.has(o)) { sel.clear(); sel.add(o); }
      if (e.altKey) {   // Alt + glisser : copie
        begin(); const copies = Array.from(sel).filter((q) => q.k !== 'site').map(cloneObj);
        D.objs.push(...copies); sel.clear(); copies.forEach((c) => sel.add(c));
      } else begin();
      drag = { m: 'move', x0: x, z0: z, start: Array.from(sel).map((q) => [q, q.x, q.z]), lead: o };
      draw(); props(); return;
    }
    if (!e.shiftKey) sel.clear();
    drag = { m: 'marquee', px0: px, py0: py, add: e.shiftKey }; draw(); props(); return;
  }
  if (tool === 'erase') {
    const o = pick(x, z);
    if (o) { begin(); D.objs.splice(D.objs.indexOf(o), 1); sel.delete(o); hover = null; commit(); return; }
    drag = { m: 'erase', px0: px, py0: py }; return;
  }
  if (['barrel', 'siteA', 'siteB', 'spT', 'spCT'].indexOf(tool) >= 0) { placePoint(snapV(x), snapV(z)); return; }
  drag = { m: 'create', x0: snapV(x), z0: snapV(z), px0: px, py0: py };
  drag.prev = createAt(drag.x0, drag.z0, drag.x0, drag.z0, true); draw();
});
window.addEventListener('mousemove', (e) => {
  const rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top;
  mouse.px = px; mouse.py = py; mouse.x = wx(px); mouse.z = wz(py);
  mouse.in = px >= 0 && py >= 0 && px <= W && py <= H;
  $('sPos').textContent = mouse.in ? 'x ' + fmt(snapV(mouse.x)) + '  z ' + fmt(snapV(mouse.z)) : '—';
  if (!drag) {
    if (!mouse.in) return;
    const h = tool === 'select' && handlesOf().find((q) => Math.abs(q.px - px) < 7 && Math.abs(q.py - py) < 7);
    const nh = (tool === 'select' || tool === 'erase') ? pick(mouse.x, mouse.z) : null;
    cv.style.cursor = h ? (h.ring || h.end ? 'ew-resize' : (h.hx && h.hz ? (h.hx === h.hz ? 'nwse-resize' : 'nesw-resize') : h.hx ? 'ew-resize' : 'ns-resize')) : tool === 'select' ? (nh ? 'move' : 'default') : 'crosshair';
    if (nh !== hover) { hover = nh; draw(); }
    if (tool !== 'select' && tool !== 'erase') draw();   // aperçu de l'outil sous le curseur
    return;
  }
  if (drag.m === 'pan') { view.x = drag.vx - (px - drag.px0) / view.s; view.z = drag.vz - (py - drag.py0) / view.s; draw(); return; }
  if (drag.m === 'move') {
    const L = drag.start.find((s) => s[0] === drag.lead);
    const nx = snapV(L[1] + mouse.x - drag.x0), nz = snapV(L[2] + mouse.z - drag.z0), dx = nx - L[1], dz = nz - L[2];
    drag.start.forEach(([o, x, z]) => { o.x = x; o.z = z; move(o, dx, dz); });
    drag.moved = true; draw(); return;
  }
  if (drag.m === 'handle') {
    const o = drag.o, o0 = drag.o0, h = drag.h, x = snapV(mouse.x), z = snapV(mouse.z);
    if (h.ring) o.r = r2(clamp(Math.hypot(mouse.x - o.x, mouse.z - o.z), 2, 12));
    else if (h.end) { const d = DIRV[o.dir]; o.n = clamp(Math.round(((mouse.x - o.x) * d[0] + (mouse.z - o.z) * d[1]) / STEP), 1, 16); }
    else {
      let x0 = o0.x - o0.w / 2, x1 = o0.x + o0.w / 2, z0 = o0.z - o0.d / 2, z1 = o0.z + o0.d / 2;
      if (h.hx < 0) x0 = Math.min(x, x1 - 0.2); if (h.hx > 0) x1 = Math.max(x, x0 + 0.2);
      if (h.hz < 0) z0 = Math.min(z, z1 - 0.2); if (h.hz > 0) z1 = Math.max(z, z0 + 0.2);
      o.x = r2((x0 + x1) / 2); o.z = r2((z0 + z1) / 2); o.w = r2(x1 - x0); o.d = r2(z1 - z0);
    }
    draw(); props(); return;
  }
  if (drag.m === 'create') {
    const moved = Math.hypot(px - drag.px0, py - drag.py0) > 4;
    drag.prev = createAt(drag.x0, drag.z0, snapV(mouse.x), snapV(mouse.z), !moved);
    if (tool === 'stairs' || tool === 'mark') drag.prev = createAt(drag.x0, drag.z0, mouse.x, mouse.z, !moved);
    draw(); return;
  }
  draw();
});
window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.m === 'pan') { cv.style.cursor = tool === 'select' ? 'default' : 'crosshair'; return; }
  if (d.m === 'move' || d.m === 'handle') { commit(); draw(); props(); return; }
  if (d.m === 'marquee') {
    if (Math.hypot(mouse.px - d.px0, mouse.py - d.py0) > 3) eraseRect(d.px0, d.py0, mouse.px, mouse.py).forEach((o) => sel.add(o));
    draw(); props(); return;
  }
  if (d.m === 'erase') {
    const list = eraseRect(d.px0, d.py0, mouse.px, mouse.py);
    if (list.length) { begin(); D.objs = D.objs.filter((o) => list.indexOf(o) < 0); sel.clear(); commit(); }
    draw(); return;
  }
  if (d.m === 'create' && d.prev) {
    if (d.prev.k !== 'mark' && d.prev.k !== 'stairs' && d.prev.k !== 'site' && countBoxes() >= LIMIT) { toast(LIMIT + ' blocs au maximum', true); draw(); return; }
    begin(); D.objs.push(d.prev); sel.clear(); sel.add(d.prev); commit();
  }
});
cv.addEventListener('wheel', (e) => { e.preventDefault(); const rc = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rc.left, e.clientY - rc.top); $('sZoom').textContent = 'Zoom ' + Math.round(view.s / 9 * 100) + ' %'; }, { passive: false });
cv.addEventListener('mouseleave', () => { if (hover) { hover = null; draw(); } $('sPos').textContent = '—'; });
// aperçu de l'outil sous le curseur (sans cliquer)
const _draw = draw;
draw = function () {
  _draw();
  if (!drag && mouse.in && tool !== 'select' && tool !== 'erase') {
    const x = snapV(mouse.x), z = snapV(mouse.z);
    g.globalAlpha = 0.45;
    if (['wall', 'low', 'crate', 'bigcrate', 'cont', 'plat', 'arch'].indexOf(tool) >= 0) { const o = createAt(x, z, x, z, true); if (o.k === 'arch') drawArch(o); else drawBox(o); }
    else if (tool === 'barrel') drawBox({ k: 'box', x, z, w: 0.8, d: 0.8, h: 1.1, t: 'barrel' });
    else if (tool === 'spT' || tool === 'spCT') drawSpawn({ k: 'spawn', team: tool === 'spT' ? 'T' : 'CT', x, z });
    else if (tool === 'siteA' || tool === 'siteB') { g.strokeStyle = '#e8503a'; g.lineWidth = 2; g.beginPath(); g.arc(sx(x), sz(z), 6.5 * view.s, 0, 7); g.stroke(); }
    else if (tool === 'stairs') drawStairs({ k: 'stairs', x, z, w: 3, dir: 'n', n: 5 });
    else if (tool === 'mark') drawMark({ k: 'mark', x, z, dx: 0, dz: -1, l: opt.markL });
    g.globalAlpha = 1;
  }
};

/* ============================================================
   Clavier
   ============================================================ */
let spaceDown = false, clip = null;
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
window.addEventListener('keydown', (e) => {
  if (!$('v3').classList.contains('hide')) return;            // vue 3D : ses propres touches
  if (document.querySelector('.ov:not(.hide)')) { if (e.code === 'Escape') closeDialogs(); return; }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.code === 'KeyS') { e.preventDefault(); saveLocal(); return; }
  if (typing()) { if (e.code === 'Escape' || e.code === 'Enter') document.activeElement.blur(); return; }
  if (ctrl && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if (ctrl && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
  if (ctrl && e.code === 'KeyA') { e.preventDefault(); sel.clear(); D.objs.forEach((o) => sel.add(o)); setTool('select'); return; }
  if (ctrl && e.code === 'KeyC') { if (sel.size) { clip = Array.from(sel).filter((o) => o.k !== 'site').map(cloneObj); toast(clip.length + ' objet' + (clip.length > 1 ? 's copiés' : ' copié')); } return; }
  if (ctrl && e.code === 'KeyV') { if (clip && clip.length) paste(clip, true); return; }
  if (ctrl && e.code === 'KeyD') { e.preventDefault(); if (sel.size) paste(Array.from(sel).filter((o) => o.k !== 'site').map(cloneObj), false); return; }
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') { delSel(); e.preventDefault(); return; }
  if (e.code === 'Escape') { if (drag && drag.m !== 'pan') { if (before !== null) { restore(before); before = null; } drag = null; } sel.clear(); setTool('select'); return; }
  if (e.code === 'Home') { fit(); return; }
  if (e.code === 'KeyR' && !ctrl && sel.size) { begin(); sel.forEach(rotate); commit(); return; }
  if (e.code.startsWith('Arrow') && sel.size) {
    e.preventDefault(); const s = snapStep * (e.shiftKey ? 5 : 1);
    const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.code];
    begin(); sel.forEach((o) => move(o, d[0], d[1])); commit(); return;
  }
  if ((e.code === 'PageUp' || e.code === 'PageDown') && sel.size) {
    e.preventDefault(); const s = e.code === 'PageUp' ? 0.5 : -0.5; begin();
    sel.forEach((o) => { if (o.k === 'box' && o.t !== 'barrel') o.h = r2(clamp(o.h + (o.t === 'cont' ? s * 5.2 : s), 0.2, 20)); else if (o.k === 'stairs') o.n = clamp(o.n + Math.sign(s), 1, 16); else if (o.k === 'arch') o.y = r2(clamp(o.y + s, 1.5, 12)); });
    commit(); return;
  }
  if (ctrl || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toUpperCase() : '';
  const t = TOOLS.find((q) => q.key === k);
  if (t) { setTool(t.id); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
function delSel() {
  if (!sel.size) return;
  begin(); D.objs = D.objs.filter((o) => !sel.has(o)); sel.clear(); hover = null; commit();
}
function paste(list, atMouse) {
  if (!list.length) return;
  const sp = { T: 0, CT: 0 }; D.objs.forEach((o) => { if (o.k === 'spawn') sp[o.team]++; });
  list = list.filter((o) => o.k !== 'spawn' || sp[o.team]++ < MAXSP);
  if (!list.length) { toast('Plus de place pour des départs', true); return; }
  let dx = 2, dz = 2;
  if (atMouse && mouse.in) {
    const cx = list.reduce((a, o) => a + o.x, 0) / list.length, cz = list.reduce((a, o) => a + o.z, 0) / list.length;
    dx = snapV(mouse.x - cx); dz = snapV(mouse.z - cz);
  }
  begin(); const copies = list.map(cloneObj); copies.forEach((o) => move(o, dx, dz)); D.objs.push(...copies);
  sel.clear(); copies.forEach((o) => sel.add(o)); setTool('select'); commit();
}

/* ============================================================
   Panneau des propriétés
   ============================================================ */
const KIND_N = { box: 'Bloc', stairs: 'Escalier', arch: 'Toit / passage couvert', site: 'Site de bombe', spawn: 'Départ', mark: 'Flèche au sol' };
function boxKind(o) { return o.t === 'cont' ? 'Conteneur' : o.t === 'barrel' ? 'Fût' : o.t === 'w' ? (o.h >= 2 ? 'Terrasse' : 'Muret') : o.h <= 2.7 ? 'Caisse' : 'Mur'; }
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => { const v = attrs[k]; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); });
  kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}
// champ numérique : modifie un ou plusieurs objets
function numRow(label, list, key, min, max, step, opts) {
  opts = opts || {};
  const vals = list.map((o) => (opts.get ? opts.get(o) : o[key]));
  const same = vals.every((v) => v === vals[0]);
  const inp = el('input', { type: 'number', min, max, step, value: same ? r2(vals[0]) : '', placeholder: same ? '' : 'plusieurs' });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value); if (!isFinite(v)) return;
    begin(); list.forEach((o) => { const c = clamp(v, min, max); if (opts.set) opts.set(o, c); else o[key] = r2(c); }); commit();
  });
  return el('div', { class: 'row' }, el('label', null, label), inp);
}
function props() {
  const P = $('props'); P.textContent = '';
  const list = Array.from(sel);
  $('sSel').textContent = list.length ? list.length + ' sélectionné' + (list.length > 1 ? 's' : '') : '';
  if (!list.length) { $('selTitle').textContent = 'OUTIL · ' + TOOL[tool].n.toUpperCase(); toolOptions(P); return; }
  const kinds = Array.from(new Set(list.map((o) => o.k)));
  const o = list[0], one = list.length === 1;
  $('selTitle').textContent = one ? (o.k === 'box' ? boxKind(o) : KIND_N[o.k]).toUpperCase() + (o.k === 'site' ? ' ' + o.id : o.k === 'spawn' ? ' ' + o.team : '') : list.length + ' OBJETS';
  if (kinds.length === 1 || list.every((q) => q.k === 'box' || q.k === 'arch')) {
    P.append(el('div', { class: 'row2' }, numRow('X', list, 'x', -HX(), HX(), 0.5), numRow('Z', list, 'z', -HZ(), HZ(), 0.5)));
  }
  if (kinds.length === 1 && o.k === 'box') {
    const all = (f) => list.every(f);
    if (!all((q) => q.t === 'barrel')) {
      P.append(el('div', { class: 'row2' }, numRow('Largeur (x)', list, 'w', 0.2, 2 * HX(), 0.5), numRow('Profondeur (z)', list, 'd', 0.2, 2 * HZ(), 0.5)));
      P.append(numRow('Hauteur (m)', list, 'h', 0.2, 20, 0.1));
      const ts = el('select', null, [['', 'Auto : caisse ≤ 2,7 m, mur au-dessus'], ['w', 'Pierre (muret, terrasse, marches)'], ['cont', 'Conteneur en tôle']].map(([v, n]) => el('option', { value: v, selected: all((q) => q.t === v) }, n)));
      if (!list.every((q) => q.t === list[0].t)) ts.prepend(el('option', { value: '?', selected: true }, '(plusieurs)'));
      ts.addEventListener('change', () => { if (ts.value === '?') return; begin(); list.forEach((q) => { q.t = ts.value; if (q.t === 'cont' && q.c == null) q.c = opt.contC; }); commit(); });
      P.append(el('div', { class: 'row' }, el('label', null, 'Matière'), ts));
      if (all((q) => q.t === 'cont')) {
        P.append(el('div', { class: 'row' }, el('label', null, 'Couleur'), swatches(list[0].c, (c) => { begin(); list.forEach((q) => { q.c = c; }); commit(); })));
        P.append(el('div', { class: 'row' }, el('label', null, 'Étages'), el('div', { class: 'btns', style: 'margin:0' }, [1, 2, 3].map((n) => el('button', { class: all((q) => Math.abs(q.h - 2.6 * n) < 0.01) ? 'on' : '', onclick: () => { begin(); list.forEach((q) => { q.h = r2(2.6 * n); }); commit(); } }, String(n))))));
        P.append(el('div', { class: 'row' }, el('label', null, 'Longueur'), el('div', { class: 'btns', style: 'margin:0' }, [6, 12].map((L) => el('button', { onclick: () => { begin(); list.forEach((q) => { if (q.w >= q.d) { q.w = L; q.d = 2.5; } else { q.d = L; q.w = 2.5; } }); commit(); } }, L + ' m')))));
      }
      P.append(el('p', { class: 'muted' }, heightNote(list)));
    }
  } else if (kinds.length === 1 && o.k === 'stairs') {
    P.append(numRow('Largeur', list, 'w', 0.6, 12, 0.5));
    P.append(numRow('Marches', list, 'n', 1, 16, 1, { set: (q, v) => { q.n = Math.round(v); } }));
    if (one) {
      const ds = el('select', null, [['n', 'Monte vers le nord (haut)'], ['s', 'Monte vers le sud (bas)'], ['e', 'Monte vers l\'est (droite)'], ['w', 'Monte vers l\'ouest (gauche)']].map(([v, n]) => el('option', { value: v, selected: o.dir === v }, n)));
      ds.addEventListener('change', () => { begin(); o.dir = ds.value; commit(); });
      P.append(el('div', { class: 'row' }, el('label', null, 'Sens'), ds));
      P.append(el('p', { class: 'muted' }, 'Arrive à ' + fmt(o.n * 0.5) + ' m de haut, sur ' + fmt(o.n * STEP) + ' m de long. Pose une terrasse de la même hauteur au bout.'));
    }
  } else if (kinds.length === 1 && o.k === 'arch') {
    P.append(el('div', { class: 'row2' }, numRow('Largeur (x)', list, 'w', 0.4, 60, 0.5), numRow('Profondeur (z)', list, 'd', 0.4, 60, 0.5)));
    P.append(el('div', { class: 'row2' }, numRow('Hauteur du bas', list, 'y', 1.5, 12, 0.1), numRow('Épaisseur', list, 'th', 0.2, 4, 0.1)));
    P.append(el('p', { class: 'muted' }, 'Décor au-dessus des têtes (toit, linteau, portique). Il ne bloque pas les joueurs, mais il arrête les balles et la lumière.'));
  } else if (kinds.length === 1 && o.k === 'site') {
    P.append(numRow('Rayon (m)', list, 'r', 2, 12, 0.5));
    P.append(el('p', { class: 'muted' }, 'Les T posent la bombe dans ce cercle. 6,5 m sur les cartes du jeu.'));
  } else if (kinds.length === 1 && o.k === 'spawn') {
    if (one) {
      const auto = o.yaw == null;
      const cb = el('input', { type: 'checkbox', checked: auto });
      cb.addEventListener('change', () => { begin(); o.yaw = cb.checked ? undefined : r2(autoYaw(o)); if (cb.checked) delete o.yaw; commit(); });
      P.append(el('div', { class: 'row' }, el('label', null, 'Regard'), el('label', { style: 'display:flex;gap:6px;align-items:center' }, cb, 'Vers le centre de la carte')));
      if (!auto) P.append(numRow('Angle (°)', list, 'yaw', -360, 360, 15, { get: (q) => Math.round(((-q.yaw * 180 / Math.PI) % 360 + 360) % 360), set: (q, v) => { q.yaw = r2(-v * Math.PI / 180); } }));
      P.append(el('p', { class: 'muted' }, 'R : tourner de 45°. 0° = regarde vers le nord, 90° = vers l\'est.'));
    }
  } else if (kinds.length === 1 && o.k === 'mark') {
    if (one) P.append(el('div', { class: 'row' }, el('label', null, 'Lettre'), el('div', { class: 'btns', style: 'margin:0' }, ['A', 'B'].map((l) => el('button', { class: o.l === l ? 'on' : '', onclick: () => { begin(); o.l = l; commit(); } }, l)))));
    P.append(el('p', { class: 'muted' }, 'R : tourner de 45°.'));
  }
  const canDup = list.some((q) => q.k !== 'site');
  P.append(el('div', { class: 'btns' },
    list.some((q) => q.k !== 'site') ? el('button', { onclick: () => { begin(); sel.forEach(rotate); commit(); }, title: 'R' }, '⟳ Pivoter') : null,
    canDup ? el('button', { onclick: () => paste(list.filter((q) => q.k !== 'site').map(cloneObj), false), title: 'Ctrl+D' }, 'Dupliquer') : null,
    list.every((q) => q.k === 'box' || q.k === 'arch' || q.k === 'stairs') && list.length > 1 ? el('button', { onclick: () => mirror(list, 'x') }, 'Miroir ↔') : null,
    list.every((q) => q.k === 'box' || q.k === 'arch' || q.k === 'stairs') && list.length > 1 ? el('button', { onclick: () => mirror(list, 'z') }, 'Miroir ↕') : null,
    el('button', { class: 'danger', onclick: delSel, title: 'Suppr' }, 'Supprimer')));
}
function heightNote(list) {
  const h = list[0].h; if (!list.every((q) => q.h === h)) return '';
  if (list[0].t === 'cont') return 'Les fusils traversent la tôle.';
  if (h <= 0.55) return 'On monte dessus en marchant.';
  if (h <= 1.5) return 'On monte dessus en sautant. Accroupi derrière, on est caché à partir de 1,1 m.';
  if (h <= 2.7) return 'Trop haut pour sauter dessus : il cache un joueur debout.' + (list[0].t ? '' : ' Bois : les balles le traversent.');
  return 'Mur : bloque les joueurs et les balles.';
}
function swatches(cur, fn) {
  const box = el('div', { class: 'sw' });
  CONT.forEach(([k, c, n]) => box.append(el('button', { title: n, class: cur === c ? 'on' : '', style: 'background:' + hexs(c), onclick: () => fn(c) })));
  const inp = el('input', { type: 'color', value: hexs(cur || 0xb5432f), title: 'Autre couleur', style: 'width:30px;height:24px;padding:0;border:0;background:none' });
  inp.addEventListener('change', () => fn(parseInt(inp.value.slice(1), 16)));
  box.append(inp);
  return box;
}
// miroir d'une sélection (pour faire des côtés A et B symétriques) : une copie de l'autre côté
function mirror(list, axis) {
  begin();
  const copies = list.map(cloneObj);
  copies.forEach((o) => {
    if (axis === 'x') { o.x = -o.x; if (o.k === 'stairs') { if (o.dir === 'e' || o.dir === 'w') o.dir = o.dir === 'e' ? 'w' : 'e'; } }
    else { o.z = -o.z; if (o.k === 'stairs') { if (o.dir === 'n' || o.dir === 's') o.dir = o.dir === 'n' ? 's' : 'n'; } }
  });
  D.objs.push(...copies); sel.clear(); copies.forEach((o) => sel.add(o)); commit();
}
function toolOptions(P) {
  const t = TOOL[tool];
  if (tool === 'select') {
    P.append(el('p', { class: 'muted' }, 'Rien de sélectionné. Choisis un outil à gauche (ou sa touche), puis glisse sur la carte pour tracer.'));
    P.append(el('div', { class: 'btns' },
      el('button', { onclick: () => symmetrize('x') }, 'Symétriser gauche → droite'),
      el('button', { onclick: () => { sel.clear(); D.objs.forEach((o) => sel.add(o)); draw(); props(); } }, 'Tout sélectionner')));
    P.append(el('p', { class: 'muted' }, 'Symétriser : recopie en miroir tous les blocs de la moitié gauche (x < 0) sur la moitié droite, qui est d\'abord vidée.'));
    return;
  }
  if (t.tip) P.append(el('p', { class: 'muted' }, t.tip));
  if (tool === 'wall') {
    const n = el('input', { type: 'number', min: 2.8, max: 20, step: 0.5, value: opt.wallH }); n.addEventListener('change', () => { opt.wallH = clamp(+n.value || 6, 2.8, 20); });
    P.append(el('div', { class: 'row' }, el('label', null, 'Hauteur'), n));
  }
  if (tool === 'cont') {
    P.append(el('div', { class: 'row' }, el('label', null, 'Couleur'), swatches(opt.contC, (c) => { opt.contC = c; props(); })));
    P.append(el('div', { class: 'row' }, el('label', null, 'Étages'), el('div', { class: 'btns', style: 'margin:0' }, [1, 2, 3].map((n) => el('button', { class: opt.contN === n ? 'on' : '', onclick: () => { opt.contN = n; props(); } }, String(n))))));
  }
  if (tool === 'mark') P.append(el('div', { class: 'row' }, el('label', null, 'Lettre'), el('div', { class: 'btns', style: 'margin:0' }, ['A', 'B'].map((l) => el('button', { class: opt.markL === l ? 'on' : '', onclick: () => { opt.markL = l; props(); } }, l)))));
}
function symmetrize(axis) {
  begin();
  const keep = D.objs.filter((o) => !((o.k === 'box' || o.k === 'arch' || o.k === 'stairs' || o.k === 'mark') && rectOf(o).x > 0.01));
  const src = keep.filter((o) => (o.k === 'box' || o.k === 'arch' || o.k === 'stairs' || o.k === 'mark') && rectOf(o).x < -0.01);
  const copies = src.map(cloneObj);
  copies.forEach((o) => {
    o.x = -o.x;
    if (o.k === 'stairs' && (o.dir === 'e' || o.dir === 'w')) o.dir = o.dir === 'e' ? 'w' : 'e';
    if (o.k === 'mark') { o.dx = -o.dx; if (o.l === 'A') o.l = 'B'; else o.l = 'A'; }
  });
  D.objs = keep.concat(copies); sel.clear(); commit();
  toast(copies.length + ' objets recopiés en miroir');
}

/* ============================================================
   Vérification : départs, sites, zones accessibles
   ============================================================ */
// carte de hauteur (cases de 0,5 m) : un joueur (rayon 0,4 m) passe d'une case à l'autre s'il monte de 0,5 m au plus,
// ou de 1,45 m au plus en sautant ; il peut toujours descendre
const CELL = 0.5;
let NX = 160, NZ = 160, GX = 40, GZ = 40;   // cases de la grille et demi-tailles (fixées à chaque vérification)
function heightGrid(M) {
  GX = M.hx; GZ = M.hz; NX = Math.round(2 * GX / CELL); NZ = Math.round(2 * GZ / CELL);
  const hg = new Float32Array(NX * NZ);
  M.boxes.forEach((b, idx) => {
    if (idx < 4) return;   // enceinte (bord de carte, traité plus bas)
    const m = CS.CFG.radius - 0.05;
    const i0 = clamp(Math.floor((b.x - b.w / 2 - m + GX) / CELL), 0, NX - 1), i1 = clamp(Math.ceil((b.x + b.w / 2 + m + GX) / CELL) - 1, 0, NX - 1);
    const j0 = clamp(Math.floor((b.z - b.d / 2 - m + GZ) / CELL), 0, NZ - 1), j1 = clamp(Math.ceil((b.z + b.d / 2 + m + GZ) / CELL) - 1, 0, NZ - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * NX + i; if (b.h > hg[k]) hg[k] = b.h; }
  });
  // bord de la carte (enceinte)
  for (let i = 0; i < NX; i++) { hg[i] = hg[(NZ - 1) * NX + i] = 99; }
  for (let j = 0; j < NZ; j++) { hg[j * NX] = hg[j * NX + NX - 1] = 99; }
  return hg;
}
function flood(hg, starts) {
  const seen = new Uint8Array(NX * NZ), q = [];
  starts.forEach(([x, z]) => { const k = cellOf(x, z); if (!seen[k]) { seen[k] = 1; q.push(k); } });
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % NX, j = (k / NX) | 0, y = hg[k];
    const nb = [i > 0 ? k - 1 : -1, i < NX - 1 ? k + 1 : -1, j > 0 ? k - NX : -1, j < NZ - 1 ? k + NX : -1];
    for (const n of nb) { if (n < 0 || seen[n]) continue; if (hg[n] - y <= 1.45 && hg[n] < 50) { seen[n] = 1; q.push(n); } }
  }
  return seen;
}
const cellOf = (x, z) => clamp(Math.floor((z + GZ) / CELL), 0, NZ - 1) * NX + clamp(Math.floor((x + GX) / CELL), 0, NX - 1);
let issues = [], vT = 0;
function validateSoon() { clearTimeout(vT); vT = setTimeout(validate, 120); }
function validate() {
  const M = CS.buildCustom(toSource(), 'ed_check'), hg = heightGrid(M), out = [];
  const push = (lv, text, focus) => out.push({ lv, text, focus });
  const sites = D.objs.filter((o) => o.k === 'site'), sp = { T: D.objs.filter((o) => o.k === 'spawn' && o.team === 'T'), CT: D.objs.filter((o) => o.k === 'spawn' && o.team === 'CT') };
  if (!sites.length) push('err', 'Aucun site de bombe : les T ne pourront pas poser la bombe (outil Site A, touche A).');
  else if (sites.length === 1) push('warn', 'Un seul site de bombe. Les cartes classiques en ont deux.', sites[0]);
  ['T', 'CT'].forEach((t) => {
    if (!sp[t].length) push('warn', 'Aucun départ ' + t + ' : les départs habituels (' + (t === 'T' ? 'en bas' : 'en haut') + ' au centre) seront utilisés.');
    else if (sp[t].length < 5) push('warn', sp[t].length + ' départ' + (sp[t].length > 1 ? 's' : '') + ' ' + t + ' seulement : au-delà, les joueurs apparaissent les uns sur les autres. Mets-en 5 au moins.', sp[t][0]);
  });
  // départ dans un obstacle
  const inSolid = (x, z) => M.boxes.find((b) => b.h > 0.55 && b.t !== 'w' && Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3);
  ['T', 'CT'].forEach((t) => M.spawns[t].forEach((p, i) => {
    const b = inSolid(p.x, p.z) || (p.y === 0 && M.boxes.find((q) => q.t === 'w' && q.h > 0.55 && Math.abs(p.x - q.x) < q.w / 2 && Math.abs(p.z - q.z) < q.d / 2));
    if (b) push('err', 'Le départ ' + t + ' n° ' + (i + 1) + ' est dans un obstacle.', sp[t][i] || { x: p.x, z: p.z, k: 'pt' });
  }));
  sp.T.concat(sp.CT).forEach((a, i, all) => { for (let j = i + 1; j < all.length; j++) if (Math.hypot(a.x - all[j].x, a.z - all[j].z) < 0.9) { push('warn', 'Deux départs se touchent (moins de 0,9 m).', a); return; } });
  // accès
  const fromT = flood(hg, M.spawns.T.map((p) => [p.x, p.z])), fromCT = flood(hg, M.spawns.CT.map((p) => [p.x, p.z]));
  reach = { T: fromT, CT: fromCT };
  if (!M.spawns.CT.some((p) => fromT[cellOf(p.x, p.z)])) push('err', 'Le départ CT est inaccessible depuis le départ T : il faut un passage entre les deux.');
  sites.forEach((s) => {
    const ok = (f) => { for (let a = 0; a < 6.28; a += 0.5) for (let r = 0; r <= s.r * 0.6; r += 0.5) if (f[cellOf(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r)]) return true; return false; };
    if (!ok(fromT)) push('err', 'Le site ' + s.id + ' est inaccessible depuis le départ T.', s);
    else if (!ok(fromCT)) push('warn', 'Le site ' + s.id + ' est inaccessible depuis le départ CT.', s);
    const b = inSolid(s.x, s.z); if (b && b.h > 1.5) push('warn', 'Le centre du site ' + s.id + ' est dans un obstacle.', s);
  });
  if (sites.length === 2 && Math.hypot(sites[0].x - sites[1].x, sites[0].z - sites[1].z) < sites[0].r + sites[1].r) push('warn', 'Les sites A et B se chevauchent.', sites[0]);
  // les départs se voient-ils ? (vue directe à hauteur des yeux)
  if (M.spawns.T.length && M.spawns.CT.length) {
    const a = M.spawns.T[0], b = M.spawns.CT[0];
    if (!blockedLine(M, a.x, a.z, b.x, b.z)) push('warn', 'Les deux départs se voient en ligne droite : un sniper peut tirer dès le début de la manche. Ajoute un mur au milieu.');
  }
  const nb = countBoxes();
  if (nb > LIMIT * 0.9) push(nb > LIMIT ? 'err' : 'warn', nb + ' blocs (le maximum est ' + LIMIT + ').');
  if (!out.length) push('ok', 'Tout est bon : la carte est jouable.');
  issues = out; renderIssues(); draw();
}
function blockedLine(M, x0, z0, x1, z1) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.25);
  for (let i = 1; i < n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    if (M.boxes.some((b, idx) => idx >= 4 && b.h >= 1.8 && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2)) return true;
  }
  return false;
}
function renderIssues() {
  const box = $('issues'); box.textContent = '';
  issues.forEach((it) => {
    const d = el('div', { class: it.lv }, el('b', null, it.lv === 'err' ? '✖' : it.lv === 'warn' ? '!' : '✔'), el('span', null, it.text));
    if (it.focus) d.addEventListener('click', () => { view.x = it.focus.x; view.z = it.focus.z; view.s = Math.max(view.s, 12); if (D.objs.indexOf(it.focus) >= 0) { sel.clear(); sel.add(it.focus); setTool('select'); } draw(); props(); });
    box.append(d);
  });
}
function issueMarks() {
  issues.forEach((it) => {
    if (it.lv === 'ok' || !it.focus || it.focus.k === 'site') return;
    g.strokeStyle = it.lv === 'err' ? '#e5483f' : '#ffb23c'; g.lineWidth = 2; g.beginPath(); g.arc(sx(it.focus.x), sz(it.focus.z), Math.max(12, view.s * 1.2), 0, 7); g.stroke();
  });
}
function drawReach() {
  if (!reach.T || reach.T.length !== NX * NZ) return;
  const c = document.createElement('canvas'); c.width = NX; c.height = NZ; const cg = c.getContext('2d'), im = cg.createImageData(NX, NZ);
  for (let k = 0; k < NX * NZ; k++) {
    const t = reach.T[k], ct = reach.CT[k], i = k * 4;
    if (!t && !ct) { im.data[i + 3] = 0; continue; }
    im.data[i] = t && ct ? 120 : t ? 140 : 70; im.data[i + 1] = t && ct ? 220 : t ? 210 : 150; im.data[i + 2] = t && ct ? 120 : t ? 80 : 255; im.data[i + 3] = 70;
  }
  cg.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(c, sx(-GX), sz(-GZ), 2 * GX * view.s, 2 * GZ * view.s); g.imageSmoothingEnabled = true;
}
function stats() {
  const n = (k) => D.objs.filter((o) => o.k === k).length;
  $('mStats').innerHTML = '';
  [[countBoxes() + ' / ' + LIMIT, 'BLOCS'], [n('spawn'), 'DÉPARTS'], [n('site'), 'SITES']].forEach(([v, l]) => $('mStats').append(el('div', null, el('b', null, String(v)), el('small', null, l))));
}

/* ============================================================
   Carte : nom, décor, ciel
   ============================================================ */
function syncMapPane() { $('mW').value = D.w || 80; $('mD').value = D.d || 80; document.querySelectorAll('#mSizes button').forEach((b) => b.classList.toggle('on', +b.dataset.w === D.w && +b.dataset.w === D.d)); $('mname').value = D.name; $('mStyle').value = D.style; $('mSky').value = D.sky; $('mDesc').value = D.desc || ''; $('mCol').value = D.col || '#c99bff'; }
// taille : les objets restent à leur place ; ceux qui sortent de la carte sont supprimés (après confirmation),
// les départs laissés à leur place habituelle suivent le bord
function setSize(w, d) {
  w = Math.round(clamp(+w || 80, CS.MAP_MIN, CS.MAP_MAX) / 2) * 2; d = Math.round(clamp(+d || 80, CS.MAP_MIN, CS.MAP_MAX) / 2) * 2;
  if (w === D.w && d === D.d) { syncMapPane(); return; }
  const hx = w / 2, hz = d / 2;
  const out = D.objs.filter((o) => { const r = rectOf(o); return o.k !== 'site' && o.k !== 'spawn' && (Math.abs(r.x) - r.w / 2 > hx || Math.abs(r.z) - r.d / 2 > hz); });
  if (out.length && !confirm(out.length + ' objet' + (out.length > 1 ? 's sont' : ' est') + ' en dehors de la nouvelle taille (' + w + ' × ' + d + ' m) et ' + (out.length > 1 ? 'seront supprimés' : 'sera supprimé') + '. Continuer ?')) { syncMapPane(); return; }
  begin();
  const oldDef = CS.makeSpawns(HZ()), newDef = CS.makeSpawns(hz);
  D.objs = D.objs.filter((o) => out.indexOf(o) < 0);
  D.objs.forEach((o) => {
    if (o.k === 'spawn') { const i = oldDef[o.team].findIndex((p) => Math.abs(p.x - o.x) < 0.01 && Math.abs(p.z - o.z) < 0.01); if (i >= 0) { o.x = newDef[o.team][i].x; o.z = newDef[o.team][i].z; } }
    if (o.k === 'box' || o.k === 'arch') { o.w = Math.min(o.w, w); o.d = Math.min(o.d, d); }
    o.x = r2(clamp(o.x, -hx + (o.k === 'spawn' ? 0.5 : 0), hx - (o.k === 'spawn' ? 0.5 : 0))); o.z = r2(clamp(o.z, -hz + (o.k === 'spawn' ? 0.5 : 0), hz - (o.k === 'spawn' ? 0.5 : 0)));
  });
  D.w = w; D.d = d; sel.clear(); commit(); syncMapPane(); fit();
}
$('mW').addEventListener('change', () => setSize($('mW').value, D.d));
$('mD').addEventListener('change', () => setSize(D.w, $('mD').value));
document.querySelectorAll('#mSizes button').forEach((b) => b.addEventListener('click', () => setSize(+b.dataset.w, +b.dataset.w)));
$('mDesc').addEventListener('input', () => { begin(); D.desc = $('mDesc').value.slice(0, 40); commit(); });
$('mCol').addEventListener('input', () => { begin(); D.col = $('mCol').value; commit(); });
$('mname').addEventListener('input', () => { begin(); D.name = $('mname').value.slice(0, 24); commit(); });
$('mStyle').addEventListener('change', () => { begin(); D.style = $('mStyle').value; if (D.sky === 'dust' || D.sky === 'docks') D.sky = D.style; syncMapPane(); commit(); });
$('mSky').addEventListener('change', () => { begin(); D.sky = $('mSky').value; commit(); });

/* ============================================================
   Ouvrir, enregistrer, exporter, partager
   ============================================================ */
function load(src, id, saved) {
  D = fromSource(src); localId = id || null; savedSig = saved != null ? saved : JSON.stringify(toSource());
  undo.length = 0; redo.length = 0; sel.clear(); syncMapPane(); fit(); changed();
}
function thumb(src, size) {
  const M = CS.buildCustom(src, 'ed_th'), E = 2 * Math.max(M.hx, M.hz) + 2;
  const c = el('canvas', { width: size, height: size }), t = c.getContext('2d'), k = size / E;
  const X = (x) => x * k + size / 2;
  t.fillStyle = '#0d1013'; t.fillRect(0, 0, size, size);
  t.fillStyle = M.style === 'dust' ? '#3d3627' : '#2a2e32'; t.fillRect(X(-M.hx - 1), X(-M.hz - 1), (2 * M.hx + 2) * k, (2 * M.hz + 2) * k);
  M.boxes.slice().sort((a, b) => a.h - b.h).forEach((b) => { t.fillStyle = boxFill({ t: b.t, h: b.h, c: b.c }); t.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), Math.max(1, b.w * k), Math.max(1, b.d * k)); });
  Object.keys(M.sites).forEach((s) => { const q = M.sites[s]; t.strokeStyle = '#e8503a'; t.lineWidth = 1.5; t.beginPath(); t.arc(X(q.x), X(q.z), q.r * k, 0, 7); t.stroke(); });
  return c;
}
function openDialog(id) { closeDialogs(); $(id).classList.remove('hide'); }
function closeDialogs() { document.querySelectorAll('.ov:not(#lock)').forEach((o) => o.classList.add('hide')); }
document.querySelectorAll('.ov:not(#lock)').forEach((o) => { o.addEventListener('mousedown', (e) => { if (e.target === o) closeDialogs(); }); o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeDialogs)); });
function confirmLeave() { return JSON.stringify(toSource()) === savedSig || !D.objs.length || confirm('La carte actuelle a des modifications non enregistrées. Continuer quand même ?'); }
function showOpen() {
  const mine = $('oMine'); mine.textContent = '';
  const list = LS.list();
  if (!list.length) mine.append(el('span', { class: 'muted' }, 'Aucune carte enregistrée pour l\'instant.'));
  list.forEach((m) => {
    const c = thumb(m.data, 150); c.addEventListener('click', () => { if (confirmLeave()) { load(m.data, m.id); closeDialogs(); } });
    mine.append(el('div', { class: 'mitem' }, c, el('b', null, m.name), el('small', null, new Date(m.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + m.data.boxes.length + ' blocs'),
      el('div', { class: 'btns' },
        el('button', { onclick: () => { if (confirmLeave()) { load(m.data, m.id); closeDialogs(); } } }, 'Ouvrir'),
        el('button', { onclick: () => { const d = JSON.parse(JSON.stringify(m.data)); d.name = (d.name + ' (copie)').slice(0, 24); if (confirmLeave()) { load(d, null); closeDialogs(); } } }, 'Copier'),
        el('button', { class: 'danger', onclick: () => { if (!confirm('Supprimer « ' + m.name + ' » de ce navigateur ?')) return; LS.put(LS.list().filter((q) => q.id !== m.id)); if (localId === m.id) { localId = null; savedSig = ''; markSaved(); } showOpen(); } }, 'Supprimer'))));
  });
  const gm = $('oGame'); gm.textContent = '';
  const blank = el('div', { class: 'mitem' }, thumb(toSource(blankMap()), 150), el('b', null, 'Carte vide'), el('small', null, 'Enceinte, départs et deux sites'), el('div', { class: 'btns' }, el('button', { onclick: () => { if (confirmLeave()) { load(toSource(blankMap()), null); closeDialogs(); } } }, 'Commencer')));
  gm.append(blank);
  ['dust', 'docks', 'medina', 'cargo', 'labo'].concat(Object.keys(CS.MAPS).filter((id) => CS.MAPS[id].ed)).forEach((id) => {
    const src = CS.mapToSource(CS.MAPS[id]);
    if (CS.MAPS[id].ed) { src.name = CS.MAPS[id].name; src.desc = CS.MAPS[id].ed.desc; src.col = CS.MAPS[id].ed.col; }
    gm.append(el('div', { class: 'mitem' }, thumb(src, 150), el('b', null, CS.MAPS[id].name), el('small', null, src.boxes.length + ' blocs'), el('div', { class: 'btns' }, el('button', { onclick: () => { if (confirmLeave()) { load(src, null); closeDialogs(); } } }, 'Partir de cette carte'))));
  });
  const sv = $('oServer'); sv.textContent = ''; sv.append(el('span', { class: 'muted' }, 'Chargement…'));
  fetch('/maps/list').then((r) => r.json()).then((r) => {
    sv.textContent = '';
    if (!r.ok || !r.list.length) { sv.append(el('span', { class: 'muted' }, 'Aucune carte partagée sur ce serveur.')); return; }
    r.list.forEach((m) => {
      const b = el('div', { class: 'mitem' }, el('b', null, m.name), el('small', null, m.n + ' blocs · ' + m.id), el('div', { class: 'btns' }, el('button', { onclick: () => {
        fetch('/maps/get?id=' + m.id).then((x) => x.json()).then((x) => { if (x.ok && confirmLeave()) { load(x.map, null); closeDialogs(); } });
      } }, 'Ouvrir une copie')));
      sv.append(b);
    });
  }).catch(() => { sv.textContent = ''; sv.append(el('span', { class: 'muted' }, 'Serveur injoignable (ouvre l\'éditeur depuis le jeu lancé).')); });
  openDialog('dOpen');
}
$('oImport').addEventListener('click', () => $('oFile').click());
$('oFile').addEventListener('change', () => {
  const f = $('oFile').files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { const d = JSON.parse(r.result); if (!d || !Array.isArray(d.boxes)) throw new Error(); if (confirmLeave()) { load(d, null); closeDialogs(); toast('Carte importée'); } } catch (e) { toast('Ce fichier n\'est pas une carte CS Arena', true); } };
  r.readAsText(f); $('oFile').value = '';
});
const slug = (s) => (s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ma_carte').slice(0, 20);
const mapIdOf = (name) => { const s = slug(name); return /^[a-z_]/.test(s) ? s : 'c_' + s; };
function showExport() {
  const src = toSource(), id = mapIdOf(src.name);
  $('eFile').textContent = 'carte-' + id + '.json';
  $('eCode').value = '  addEditorMap(\'' + id + '\', ' + JSON.stringify(src) + ');\n';
  const e = issues.filter((i) => i.lv === 'err');
  $('eWarn').textContent = e.length ? '⚠ La vérification signale encore : ' + e.map((i) => i.text).join(' · ') : '';
  openDialog('dExport');
}
$('eCopy').addEventListener('click', () => { $('eCode').select(); navigator.clipboard ? navigator.clipboard.writeText($('eCode').value).then(() => toast('Code copié')) : document.execCommand('copy'); });
// fichier à donner pour ajouter la carte au jeu : la carte au format de shared.js, plus son identifiant
$('eJson').addEventListener('click', () => {
  const src = toSource(), id = mapIdOf(src.name);
  const file = Object.assign({ csArenaMap: 1, id, exported: new Date().toISOString() }, src);
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'carte-' + id + '.json' }); document.body.append(a); a.click(); a.remove();
  saveLocal(true); toast('Fichier carte-' + id + '.json téléchargé');
});
async function upload() {
  const r = await fetch('/maps/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map: toSource(), tok: tokOf() }) });
  const j = await r.json().catch(() => ({ ok: false, err: 'Réponse invalide' }));
  if (!j.ok) throw new Error(j.err || 'Échec de l\'envoi');
  return j.id;
}
function blocking() { const e = issues.filter((i) => i.lv === 'err'); return e.length ? e : null; }
$('bShare').addEventListener('click', async () => {
  saveLocal(true);
  try {
    const id = await upload(), room = 'c' + Math.random().toString(36).slice(2, 7);
    $('shLink').value = location.origin + '/?cmap=' + id + '&room=' + room; $('shId').textContent = id; $('shRoom').textContent = room;
    openDialog('dShare');
  } catch (e) { toast('Partage impossible : ' + (e.message === 'Failed to fetch' ? 'serveur injoignable' : e.message), true); }
});
$('shCopy').addEventListener('click', () => { $('shLink').select(); (navigator.clipboard ? navigator.clipboard.writeText($('shLink').value) : Promise.resolve(document.execCommand('copy'))).then(() => toast('Lien copié')); });
// tester / jouer : la carte est enregistrée dans « Mes cartes », le menu du jeu la propose (l_<id>)
function goGame(mode) {
  const e = blocking();
  if (e && !confirm('La vérification signale ' + e.length + ' problème' + (e.length > 1 ? 's' : '') + ' :\n\n• ' + e.map((i) => i.text).join('\n• ') + '\n\nLancer quand même ?')) return;
  const id = saveLocal(true); if (!id) return;
  try {
    localStorage.setItem('cs_map', 'l_' + id);
    if (mode === 'sandbox') sessionStorage.setItem('cs_go', 'sandbox'); else sessionStorage.setItem('cs_menu', '1');
    sessionStorage.setItem('cs_from_editor', id);
  } catch (err) {}
  location.href = 'index.html';
}
$('bTest').addEventListener('click', () => goGame('sandbox'));
$('bPlay').addEventListener('click', () => goGame(''));
$('bBack').addEventListener('click', () => { if (!confirmLeave()) return; try { sessionStorage.setItem('cs_menu', '1'); } catch (e) {} location.href = 'index.html'; });
$('bNew').addEventListener('click', () => { if (confirmLeave()) load(toSource(blankMap()), null); });
$('bOpen').addEventListener('click', showOpen);
$('bSave').addEventListener('click', () => saveLocal());
$('bExport').addEventListener('click', showExport);
$('bUndo').addEventListener('click', doUndo);
$('bRedo').addEventListener('click', doRedo);
$('zIn').addEventListener('click', () => zoomAt(1.3, W / 2, H / 2));
$('zOut').addEventListener('click', () => zoomAt(1 / 1.3, W / 2, H / 2));
$('zFit').addEventListener('click', fit);
$('lReach').addEventListener('click', () => { showReach = !showReach; $('lReach').classList.toggle('on', showReach); draw(); });
$('lLabels').addEventListener('click', () => { showLabels = !showLabels; $('lLabels').classList.toggle('on', showLabels); draw(); });
const SNAPS = [0.25, 0.5, 1, 2];
$('lSnap').addEventListener('click', () => { snapStep = SNAPS[(SNAPS.indexOf(snapStep) + 1) % SNAPS.length]; $('lSnap').textContent = 'Grille : ' + fmt(snapStep) + ' m'; });
let toastT = 0;
function toast(t, bad) { const e = $('toast'); e.textContent = t; e.className = 'on' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => { e.className = bad ? 'bad' : ''; }, 2600); }

/* ============================================================
   Vue 3D : le rendu du jeu (gfx.js), en vol libre ou à pied
   ============================================================ */
const V3 = { on: false, init: false, yaw: 0, pitch: -0.2, x: 0, y: 1.65, z: 30, vy: 0, walk: false, keys: {}, M: null, last: 0, raf: 0 };
function open3D() {
  $('v3').classList.remove('hide'); $('v3load').classList.remove('hide'); V3.on = true;
  setTimeout(() => {
    try {
      if (!V3.init) {
        const r = GFX.init($('v3c')); V3.cam = r.cam; GFX.setVmCam(new THREE.PerspectiveCamera(50, 1, 0.01, 8)); V3.init = true;
        window.addEventListener('resize', () => { if (V3.on) GFX.resize(); });
      }
      V3.M = CS.buildCustom(toSource(), 'ed_' + Date.now().toString(36));
      GFX.resize(); GFX.buildWorld(V3.M, true);
      if (!V3.placed) { place3('T'); V3.placed = true; }
      $('v3load').classList.add('hide');
      V3.last = performance.now(); cancelAnimationFrame(V3.raf); V3.raf = requestAnimationFrame(loop3);
    } catch (e) { console.error(e); $('v3load').textContent = 'Rendu 3D impossible sur cet appareil (WebGL).'; }
  }, 30);
}
function close3D() { V3.on = false; cancelAnimationFrame(V3.raf); if (document.pointerLockElement) document.exitPointerLock(); $('v3').classList.add('hide'); }
function place3(team) {
  const M = V3.M, p = (M.spawns[team] || [])[0] || { x: 0, z: team === 'T' ? M.hz - 5 : -M.hz + 5, y: 0, yaw: team === 'T' ? 0 : Math.PI };
  V3.x = p.x; V3.z = p.z; V3.y = (p.y || 0) + 1.65; V3.yaw = p.yaw; V3.pitch = -0.05; V3.vy = 0;
}
function ground3(x, z, y) { let gnd = 0; V3.M.boxes.forEach((b) => { if (b.h <= y + 0.55 && b.h > gnd && Math.abs(x - b.x) < b.w / 2 + 0.24 && Math.abs(z - b.z) < b.d / 2 + 0.24) gnd = b.h; }); return gnd; }
function collide3(feet) {
  V3.M.boxes.forEach((b) => {
    if (feet >= b.h - 0.55) return;
    const hx = b.w / 2, hz = b.d / 2, cx = clamp(V3.x, b.x - hx, b.x + hx), cz = clamp(V3.z, b.z - hz, b.z + hz), dx = V3.x - cx, dz = V3.z - cz, d2 = dx * dx + dz * dz, R = 0.4;
    if (d2 < R * R && d2 > 1e-8) { const d = Math.sqrt(d2); V3.x = cx + dx / d * R; V3.z = cz + dz / d * R; }
  });
}
function loop3(t) {
  if (!V3.on) return;
  V3.raf = requestAnimationFrame(loop3);
  const dt = Math.min(0.05, (t - V3.last) / 1000); V3.last = t;
  const K = V3.keys, f = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), r = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  const sy = Math.sin(V3.yaw), cy = Math.cos(V3.yaw), spd = (V3.walk ? 6.1 : 14) * (K.ShiftLeft || K.ShiftRight ? 0.35 : 1), len = Math.hypot(f, r) || 1;
  V3.x += (-sy * f + cy * r) / len * spd * dt; V3.z += (-cy * f - sy * r) / len * spd * dt;
  V3.x = clamp(V3.x, -V3.M.hx + 0.4, V3.M.hx - 0.4); V3.z = clamp(V3.z, -V3.M.hz + 0.4, V3.M.hz - 0.4);
  if (V3.walk) {
    let feet = V3.y - 1.65; collide3(feet);
    if (K.Space && feet <= ground3(V3.x, V3.z, feet) + 0.01) V3.vy = 6.5;
    V3.vy -= 21 * dt; feet += V3.vy * dt;
    const gnd = ground3(V3.x, V3.z, feet); if (feet <= gnd) { feet = gnd; V3.vy = 0; }
    V3.y = feet + 1.65;
  } else V3.y = clamp(V3.y + ((K.Space ? 1 : 0) - (K.KeyC || K.ControlLeft ? 1 : 0)) * spd * 0.8 * dt, 0.4, 200);
  const cam = V3.cam; cam.position.set(V3.x, V3.y, V3.z); cam.rotation.set(V3.pitch, V3.yaw, 0);
  if (Math.abs(cam.fov - 78) > 0.01) { cam.fov = 78; cam.updateProjectionMatrix(); }
  GFX.fx.update(dt); GFX.render(t / 1000);
}
$('b3d').addEventListener('click', open3D);
$('v3Close').addEventListener('click', close3D);
$('v3T').addEventListener('click', () => place3('T'));
$('v3CT').addEventListener('click', () => place3('CT'));
$('v3Top').addEventListener('click', () => { const k = Math.max(V3.M.hx, V3.M.hz) / 40; V3.walk = false; $('v3mode').textContent = 'vol'; V3.x = 0; V3.z = 34 * k; V3.y = 48 * k; V3.yaw = 0; V3.pitch = -0.95; });
$('v3c').addEventListener('click', () => { try { const p = $('v3c').requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} });
document.addEventListener('mousemove', (e) => {
  if (!V3.on || document.pointerLockElement !== $('v3c')) return;
  V3.yaw -= e.movementX * 0.0022; V3.pitch = clamp(V3.pitch - e.movementY * 0.0022, -1.5, 1.5);
});
window.addEventListener('keydown', (e) => {
  if (!V3.on) return;
  // AZERTY : Z Q S D sont aux places de W A S D (codes physiques)
  V3.keys[e.code] = true;
  if (e.code === 'KeyG') { V3.walk = !V3.walk; V3.vy = 0; $('v3mode').textContent = V3.walk ? 'à pied (Espace : sauter)' : 'vol'; }
  if (e.code === 'Escape' && !document.pointerLockElement) close3D();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => { V3.keys[e.code] = false; });
window.addEventListener('blur', () => { V3.keys = {}; });

/* ============================================================
   Démarrage : réservé au compte autorisé (le serveur vérifie)
   ============================================================ */
function tokOf() { try { return localStorage.getItem('cs_tok') || ''; } catch (e) { return ''; } }
fetch('/maps/can', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tok: tokOf() }) })
  .then((r) => r.json()).then((r) => { if (r && r.can) $('lock').remove(); else $('lock').classList.remove('hide'); })
  .catch(() => { $('lock').classList.remove('hide'); $('lockMsg').textContent = 'Serveur injoignable : lance le jeu (npm start) puis ouvre l\'éditeur depuis le menu.'; });
buildTools();
window.addEventListener('resize', resize);
resize();
{
  // brouillon de la dernière session, sinon carte demandée (?open=id), sinon carte vide
  const q = new URLSearchParams(location.search), want = q.get('open'), dr = LS.draft();
  const m = want && LS.list().find((x) => x.id === want);
  if (m) load(m.data, m.id);
  else if (dr && dr.data) load(dr.data, dr.id && LS.list().some((x) => x.id === dr.id) ? dr.id : null, dr.saved || '');
  else load(toSource(blankMap()), null);
}
setTool('select');
})();
