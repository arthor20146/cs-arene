/* CS Arena - menu des paramètres : réglages enregistrés, touches personnalisables, interface à onglets.
   game.js lit Settings.cfg (valeurs), Settings.binds (touches) et réagit via Settings.on(fn). */
window.Settings = (function () {
'use strict';
const $ = (id) => document.getElementById(id);
const KEY = 'cs_settings';

/* ---------- actions et touches par défaut (codes physiques : KeyW = la touche W d'un clavier QWERTY, Z sur AZERTY) ---------- */
const ACTIONS = [
  { id: 'fwd',    n: 'Avancer',                g: 'Déplacement', d: ['KeyW', 'ArrowUp'] },
  { id: 'back',   n: 'Reculer',                g: 'Déplacement', d: ['KeyS', 'ArrowDown'] },
  { id: 'left',   n: 'Aller à gauche',         g: 'Déplacement', d: ['KeyA', 'ArrowLeft'] },
  { id: 'right',  n: 'Aller à droite',         g: 'Déplacement', d: ['KeyD', 'ArrowRight'] },
  { id: 'jump',   n: 'Sauter',                 g: 'Déplacement', d: ['Space', ''] },
  { id: 'crouch', n: 'S\'accroupir',           g: 'Déplacement', d: ['KeyC', 'ControlLeft'] },
  { id: 'walk',   n: 'Marcher (silencieux)',   g: 'Déplacement', d: ['ShiftLeft', ''] },
  { id: 'reload', n: 'Recharger',              g: 'Armes', d: ['KeyR', ''] },
  { id: 'slot1',  n: 'Arme principale',        g: 'Armes', d: ['Digit1', 'Numpad1'] },
  { id: 'slot2',  n: 'Arme secondaire',        g: 'Armes', d: ['Digit2', 'Numpad2'] },
  { id: 'slot3',  n: 'Couteau',                g: 'Armes', d: ['Digit3', 'Numpad3'] },
  { id: 'drop',   n: 'Jeter son arme',         g: 'Armes', d: ['KeyQ', ''] },
  { id: 'use',    n: 'Utiliser (ramasser, poser, désamorcer)', g: 'Actions', d: ['KeyE', ''] },
  { id: 'buy',    n: 'Boutique',               g: 'Actions', d: ['KeyB', ''] },
  { id: 'map',    n: 'Carte',                  g: 'Actions', d: ['KeyM', ''] },
  { id: 'scores', n: 'Tableau des scores',     g: 'Actions', d: ['Tab', ''] },
  { id: 'chat',   n: 'Chat',                   g: 'Actions', d: ['Enter', ''] }
];

const DEF = {
  sens: 1, adsSens: 1, invertY: false, toggleAim: false, toggleCrouch: false,
  fov: 68, renderScale: 1, shake: 1, bob: 1, autoFs: true, fps: false,
  crossColor: '#7dff7d', crossThick: 2, crossLen: 7, crossLines: true, crossDot: false, crossOpacity: 1,
  vol: 0.6, ambient: 1, hitSound: true, muteBg: false,
  radar: true, radarSize: 170, hitmarker: true, feed: true, chatlog: true
};

/* ---------- onglets et lignes de réglages ---------- */
const pct = (v) => Math.round(v * 100) + '%';
const TABS = [
  { id: 'controls', n: 'Contrôles', rows: [
    { key: 'sens', t: 'range', n: 'Sensibilité de la souris', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
    { key: 'adsSens', t: 'range', n: 'Sensibilité en visée', d: 'Multiplicateur appliqué en visée et à la lunette, en plus du zoom.', min: 0.3, max: 1.5, step: 0.05, fmt: (v) => v.toFixed(2) },
    { key: 'invertY', t: 'toggle', n: 'Inverser l\'axe vertical' },
    { key: 'toggleAim', t: 'seg', n: 'Visée (clic droit)', d: 'Maintenir : tu vises tant que tu appuies. Basculer : un clic vise, un autre arrête.', opts: [[false, 'Maintenir'], [true, 'Basculer']] },
    { key: 'toggleCrouch', t: 'seg', n: 'S\'accroupir', opts: [[false, 'Maintenir'], [true, 'Basculer']] }
  ] },
  { id: 'keys', n: 'Touches' },
  { id: 'video', n: 'Vidéo', rows: [
    { id: 'quality', t: 'seg', n: 'Qualité graphique', d: 'Basse : sans ombres, pour les petits PC. Haute : occlusion ambiante, halo lumineux, anticrénelage (les textures plus fines s\'appliquent au prochain chargement de la page).',
      get: () => (window.GFX ? GFX.quality : 'med'), set: (v) => emit('quality', v), reset: () => emit('quality', 'med'),
      opts: [['low', 'Basse'], ['med', 'Moyenne'], ['high', 'Haute']] },
    { key: 'renderScale', t: 'range', lazy: true, n: 'Résolution de rendu', d: 'Baisse-la pour gagner des images par seconde. L\'interface reste nette.', min: 0.5, max: 1, step: 0.05, fmt: pct },
    { key: 'fov', t: 'range', n: 'Champ de vision', d: 'Plus il est grand, plus tu vois sur les côtés.', min: 60, max: 110, step: 1, fmt: (v) => Math.round(v) + '°' },
    { key: 'shake', t: 'range', n: 'Secousses de l\'écran', d: 'Explosions, tirs reçus, blessures.', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'bob', t: 'range', n: 'Balancement de la marche', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'autoFs', t: 'toggle', n: 'Plein écran automatique', d: 'Au lancement de la partie. Sur Chrome et Edge, cela protège aussi Ctrl+W.' },
    { key: 'fps', t: 'toggle', n: 'Afficher les images par seconde' }
  ] },
  { id: 'cross', n: 'Réticule', rows: [
    { t: 'preview' },
    { key: 'crossColor', t: 'color', n: 'Couleur', colors: ['#7dff7d', '#ffffff', '#ffe84a', '#4af0ff', '#ff5ad8', '#ff4a4a'] },
    { key: 'crossThick', t: 'range', n: 'Épaisseur', min: 1, max: 6, step: 1, fmt: (v) => v + ' px' },
    { key: 'crossLen', t: 'range', n: 'Longueur des branches', min: 2, max: 20, step: 1, fmt: (v) => v + ' px' },
    { key: 'crossOpacity', t: 'range', n: 'Opacité', min: 0.3, max: 1, step: 0.05, fmt: pct },
    { key: 'crossLines', t: 'toggle', n: 'Branches du réticule', d: 'Désactivé : seul le point central reste affiché.' },
    { key: 'crossDot', t: 'toggle', n: 'Point central', d: 'Toujours affiché quand les branches sont désactivées.' }
  ] },
  { id: 'audio', n: 'Audio', rows: [
    { key: 'vol', t: 'range', n: 'Volume général', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'ambient', t: 'range', n: 'Ambiance', d: 'Vent et bruit de fond de la carte.', min: 0, max: 2, step: 0.05, fmt: pct },
    { key: 'hitSound', t: 'toggle', n: 'Son de touche', d: 'Petit bruit quand tu touches ou élimines un ennemi.' },
    { key: 'muteBg', t: 'toggle', n: 'Couper le son en arrière-plan', d: 'Quand la fenêtre n\'est plus au premier plan.' },
    { t: 'button', n: 'Tester le son', label: 'Jouer un tir', run: () => emit('test') }
  ] },
  { id: 'ui', n: 'Interface', rows: [
    { key: 'radar', t: 'toggle', n: 'Afficher le radar' },
    { key: 'radarSize', t: 'range', n: 'Taille du radar', min: 100, max: 260, step: 5, fmt: (v) => Math.round(v) + ' px' },
    { key: 'hitmarker', t: 'toggle', n: 'Marqueur de touche', d: 'Croix blanche (rouge à la tête) au centre de l\'écran.' },
    { key: 'feed', t: 'toggle', n: 'Afficher les éliminations' },
    { key: 'chatlog', t: 'toggle', n: 'Afficher le chat' }
  ] }
];

/* ---------- état : cfg et binds gardent la même référence (game.js les lit directement) ---------- */
const cfg = Object.assign({}, DEF);
const binds = {};
ACTIONS.forEach((a) => { binds[a.id] = a.d.slice(); });
let rev = {};                       // code -> [actions]
const listeners = [];
let isOpen = false, curTab = 'controls', listening = null, msgTimer = 0, resetArm = 0;
let layout = null;                  // disposition réelle du clavier (Chrome, Edge)
const learned = {};                 // code -> caractère vu pendant le jeu (autres navigateurs)

const rowsOf = (t) => t.rows || [];
function limits(key) { for (const t of TABS) for (const r of rowsOf(t)) if (r.key === key && r.min != null) return r; return null; }
function clampCfg() {
  Object.keys(DEF).forEach((k) => {
    const l = limits(k);
    if (l && typeof cfg[k] === 'number') cfg[k] = Math.max(l.min, Math.min(l.max, isFinite(cfg[k]) ? cfg[k] : DEF[k]));
  });
  if (!/^#[0-9a-f]{6}$/i.test(cfg.crossColor)) cfg.crossColor = DEF.crossColor;
}
function rebuildRev() {
  rev = {};
  ACTIONS.forEach((a) => binds[a.id].forEach((c) => { if (c) (rev[c] || (rev[c] = [])).push(a.id); }));
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (raw && typeof raw === 'object') {
    Object.keys(DEF).forEach((k) => { const v = raw.cfg && raw.cfg[k]; if (typeof v === typeof DEF[k]) cfg[k] = v; });
    if (raw.binds && typeof raw.binds === 'object') {
      ACTIONS.forEach((a) => {
        const b = raw.binds[a.id];
        if (Array.isArray(b)) binds[a.id] = [0, 1].map((i) => (typeof b[i] === 'string' && b[i].length < 24 ? b[i] : ''));
      });
    }
  } else {
    // anciens réglages (version sans menu)
    try {
      const s = parseFloat(localStorage.getItem('cs_sens')), v = parseFloat(localStorage.getItem('cs_vol'));
      if (isFinite(s) && s > 0) cfg.sens = s;
      if (isFinite(v)) cfg.vol = v;
    } catch (e) {}
  }
  clampCfg(); rebuildRev();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, cfg, binds })); } catch (e) {}
}
function emit(key, value) { listeners.forEach((f) => { try { f(key, value === undefined ? cfg[key] : value); } catch (e) { console.error(e); } }); }

/* ---------- noms de touches ---------- */
if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
  navigator.keyboard.getLayoutMap().then((m) => { layout = m; refreshLabels(); }).catch(() => {});
}
window.addEventListener('keydown', (e) => { if (e.key && e.key.length === 1 && e.code && !learned[e.code]) { learned[e.code] = e.key; if (isOpen) paintKeys(); } }, true);
const SPECIAL = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
  AltLeft: 'Alt gauche', AltRight: 'Alt droite', Enter: 'Entrée', NumpadEnter: 'Entrée (pavé)', Tab: 'Tab', CapsLock: 'Verr. maj',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Retour', Delete: 'Suppr', Insert: 'Inser',
  Home: 'Début', End: 'Fin', PageUp: 'Page ↑', PageDown: 'Page ↓', NumpadAdd: 'Pavé +', NumpadSubtract: 'Pavé −',
  NumpadMultiply: 'Pavé ×', NumpadDivide: 'Pavé ÷', NumpadDecimal: 'Pavé .', ContextMenu: 'Menu'
};
function label(code) {
  if (!code) return '—';
  let m;
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Pavé ' + m[1];
  if (SPECIAL[code]) return SPECIAL[code];
  if (layout && layout.get(code)) return layout.get(code).toUpperCase();
  if (learned[code]) return learned[code].toUpperCase();
  if ((m = /^Key(.)$/.exec(code))) return m[1];
  return code;
}
// touche principale d'une action (pour les messages du jeu)
function key(action) { const b = binds[action] || []; return label(b[0] || b[1]); }
function keysOf(action) { const b = binds[action] || []; const l = b.filter(Boolean).map(label); return l.length ? l.join(' / ') : '—'; }
function actionsOf(code) { return rev[code] || NONE; }
const NONE = [];
// touches à réserver au navigateur en plein écran (Keyboard Lock)
function lockCodes() {
  const s = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyN', 'KeyB', 'KeyC', 'Tab']);
  Object.keys(rev).forEach((c) => { if (/^(Key|Digit|Arrow|Tab$|Space$)/.test(c)) s.add(c); });
  return Array.from(s);
}

/* ---------- réticule ---------- */
function applyCrosshair(el) {
  if (!el) return;
  el.style.setProperty('--cc', cfg.crossColor);
  el.style.setProperty('--ct', cfg.crossThick + 'px');
  el.style.setProperty('--cl', cfg.crossLen + 'px');
  el.style.setProperty('--co', String(cfg.crossOpacity));
  el.classList.toggle('hasdot', !!cfg.crossDot);
  el.classList.toggle('nolines', !cfg.crossLines);
}

/* ---------- aide des touches (menu principal) ---------- */
function renderHelp(box) {
  if (!box) return;
  box.textContent = '';
  const row = (k, text) => {
    const b = document.createElement('b'); b.textContent = k;
    const s = document.createElement('span'); s.textContent = text;
    box.append(b, s);
  };
  row([key('fwd'), key('left'), key('back'), key('right')].join(' '), 'Se déplacer');
  row('Souris', 'Clic gauche : tirer · clic droit : viser · lunette (' + key('walk') + ' retient le souffle)');
  row(keysOf('jump') + ' · ' + keysOf('crouch') + ' · ' + keysOf('walk'), 'Sauter · s\'accroupir · marcher');
  row(key('reload') + ' · ' + [key('slot1'), key('slot2'), key('slot3')].join(' ') + ' · Molette', 'Recharger · changer d\'arme');
  row(key('drop'), 'Jeter son arme au sol');
  row(key('buy'), 'Boutique (début de manche)');
  row(key('use'), 'Prendre une arme au sol · maintenu : poser / désamorcer la bombe');
  row(key('map'), 'Afficher ou fermer la carte');
  row(key('scores') + ' · ' + key('chat'), 'Scores · chat');
}
function refreshLabels() { renderHelp($('keysHelp')); if (isOpen) paintKeys(); }

/* ---------- modification d'une touche ---------- */
function say(text) {
  const m = $('setMsg'); if (!m) return;
  m.textContent = text || '';
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { m.textContent = ''; }, 4500);
}
function setBind(action, slot, code) {
  const mine = binds[action];
  if (code) {
    ACTIONS.forEach((a) => {
      const b = binds[a.id];
      for (let i = 0; i < 2; i++) {
        if (b[i] !== code || (a.id === action && i === slot)) continue;
        b[i] = '';
        if (a.id !== action) say('« ' + label(code) + ' » n\'est plus utilisée pour « ' + a.n + ' »');
      }
    });
  }
  mine[slot] = code;
  rebuildRev(); save(); emit('binds');
  refreshLabels();
}
function startListen(action, slot) { listening = { action, slot }; paintKeys(); }
function stopListen() { if (!listening) return; listening = null; paintKeys(); }

/* ---------- construction de l'interface ---------- */
function h(tag, attrs) {
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
    if (Array.isArray(c)) c.forEach((x) => e.append(x.nodeType ? x : document.createTextNode(x)));
    else e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
const getVal = (r) => (r.get ? r.get() : cfg[r.key]);
function setVal(r, v) {
  if (r.set) { r.set(v); return; }
  cfg[r.key] = typeof v === 'number' ? +v.toFixed(3) : v;
  save(); emit(r.key);
  if (r.key.indexOf('cross') === 0) previewCross();
}

let kbBtns = [], previewEl = null;
function paintKeys() {
  kbBtns.forEach((o) => {
    const on = listening && listening.action === o.id && listening.slot === o.i;
    o.b.classList.toggle('listen', !!on);
    o.b.classList.toggle('empty', !on && !binds[o.id][o.i]);
    o.b.textContent = on ? 'Appuie sur une touche…' : label(binds[o.id][o.i]);
  });
}
function previewCross() {
  if (!previewEl) return;
  applyCrosshair(previewEl);
  const c = previewEl.children, g = 6;
  c[0].style.transform = 'translateY(' + (-g) + 'px)'; c[1].style.transform = 'translateY(' + g + 'px)';
  c[2].style.transform = 'translateX(' + (-g) + 'px)'; c[3].style.transform = 'translateX(' + g + 'px)';
}

function control(r) {
  if (r.t === 'range') {
    const inp = h('input', { type: 'range', min: r.min, max: r.max, step: r.step });
    const out = h('span', { class: 'val' });
    inp.value = getVal(r); out.textContent = r.fmt(+inp.value);
    inp.addEventListener('input', () => {
      out.textContent = r.fmt(+inp.value);
      if (!r.lazy) setVal(r, parseFloat(inp.value));
    });
    if (r.lazy) inp.addEventListener('change', () => setVal(r, parseFloat(inp.value)));
    return h('div', { class: 'ctl rng' }, inp, out);
  }
  if (r.t === 'toggle') {
    const b = h('button', { class: 'sw', type: 'button', role: 'switch' });
    const txt = h('span', { class: 'swt' });
    const sync = () => { const on = !!getVal(r); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); txt.textContent = on ? 'Activé' : 'Désactivé'; };
    b.addEventListener('click', () => { setVal(r, !getVal(r)); sync(); });
    sync();
    return h('div', { class: 'ctl tg' }, txt, b);
  }
  if (r.t === 'seg') {
    const wrap = h('div', { class: 'ctl seg' });
    const btns = r.opts.map(([v, n]) => {
      const b = h('button', { type: 'button' }, n);
      b.addEventListener('click', () => { setVal(r, v); sync(); });
      wrap.append(b); return [v, b];
    });
    const sync = () => { const cur = getVal(r); btns.forEach(([v, b]) => b.classList.toggle('on', v === cur)); };
    sync();
    return wrap;
  }
  if (r.t === 'color') {
    const wrap = h('div', { class: 'ctl swatches' });
    const custom = h('input', { type: 'color', 'aria-label': 'Couleur personnalisée' });
    const sw = r.colors.map((c) => {
      const b = h('button', { class: 'swatch', type: 'button', title: c, style: 'background:' + c });
      b.addEventListener('click', () => { setVal(r, c); sync(); });
      wrap.append(b); return [c, b];
    });
    custom.addEventListener('input', () => { setVal(r, custom.value); sync(); });
    wrap.append(custom);
    const sync = () => { const cur = String(getVal(r)).toLowerCase(); sw.forEach(([c, b]) => b.classList.toggle('on', c === cur)); custom.value = cur; };
    sync();
    return wrap;
  }
  if (r.t === 'button') return h('div', { class: 'ctl' }, h('button', { class: 'act', type: 'button', onclick: r.run }, r.label));
  return h('div');
}

function paneKeys(pane) {
  pane.append(h('p', { class: 'hint' }, 'Clique sur une case puis appuie sur la touche voulue. Chaque action accepte deux touches. Échap annule, Suppr ou clic droit efface la case.'));
  let g = '';
  ACTIONS.forEach((a) => {
    if (a.g !== g) { g = a.g; pane.append(h('div', { class: 'grp' }, g)); }
    const ctl = h('div', { class: 'ctl kbs' });
    [0, 1].forEach((i) => {
      const b = h('button', { class: 'kb', type: 'button' });
      b.addEventListener('click', () => { if (listening && listening.action === a.id && listening.slot === i) stopListen(); else startListen(a.id, i); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); stopListen(); setBind(a.id, i, ''); });
      kbBtns.push({ b, id: a.id, i }); ctl.append(b);
    });
    pane.append(h('div', { class: 'srow' }, h('div', { class: 'lbl' }, h('div', { class: 'nm' }, a.n)), ctl));
  });
  pane.append(h('div', { class: 'grp' }, 'Souris (fixe)'));
  [['Tirer', 'Clic gauche'], ['Viser · lunette', 'Clic droit'], ['Changer d\'arme', 'Molette']].forEach(([n, k]) => {
    pane.append(h('div', { class: 'srow' }, h('div', { class: 'lbl' }, h('div', { class: 'nm' }, n)), h('div', { class: 'ctl' }, h('span', { class: 'fixed' }, k))));
  });
  paintKeys();
}

function render() {
  const tabs = $('setTabs'), pane = $('setPane');
  if (!tabs || !pane) return;
  tabs.textContent = '';
  TABS.forEach((t) => {
    const b = h('button', { type: 'button', class: t.id === curTab ? 'on' : '' }, t.n);
    b.addEventListener('click', () => { if (curTab !== t.id) { listening = null; curTab = t.id; render(); } });
    tabs.append(b);
  });
  pane.textContent = ''; pane.scrollTop = 0; kbBtns = []; previewEl = null;
  const tab = TABS.find((t) => t.id === curTab);
  if (tab.id === 'keys') { paneKeys(pane); return; }
  rowsOf(tab).forEach((r) => {
    if (r.t === 'preview') {
      const xh = h('div', { class: 'xh' }, h('i', { class: 'u' }), h('i', { class: 'd' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('i', { class: 'dot' }));
      previewEl = xh; previewCross();
      pane.append(h('div', { class: 'xprev' }, xh));
      return;
    }
    pane.append(h('div', { class: 'srow' }, h('div', { class: 'lbl' }, h('div', { class: 'nm' }, r.n), r.d ? h('div', { class: 'ds' }, r.d) : null), control(r)));
  });
}

function resetTab() {
  const tab = TABS.find((t) => t.id === curTab);
  if (tab.id === 'keys') {
    ACTIONS.forEach((a) => { binds[a.id][0] = a.d[0]; binds[a.id][1] = a.d[1]; });
    rebuildRev(); save(); emit('binds'); refreshLabels();
  } else {
    rowsOf(tab).forEach((r) => {
      if (r.key) { cfg[r.key] = DEF[r.key]; emit(r.key); } else if (r.reset) r.reset();
    });
    save();
  }
  render(); say('Onglet réinitialisé');
}
function resetAll() {
  Object.keys(DEF).forEach((k) => { cfg[k] = DEF[k]; });
  ACTIONS.forEach((a) => { binds[a.id][0] = a.d[0]; binds[a.id][1] = a.d[1]; });
  rebuildRev(); save();
  Object.keys(DEF).forEach((k) => emit(k));
  emit('binds'); emit('quality', 'med');
  refreshLabels(); render(); say('Tous les réglages sont revenus aux valeurs par défaut');
}
function armResetAll() {
  const b = $('setResetAll');
  if (!resetArm) {
    b.textContent = 'Confirmer ?'; b.classList.add('warn');
    resetArm = setTimeout(() => { resetArm = 0; b.textContent = 'Tout réinitialiser'; b.classList.remove('warn'); }, 3000);
  } else {
    clearTimeout(resetArm); resetArm = 0; b.textContent = 'Tout réinitialiser'; b.classList.remove('warn');
    resetAll();
  }
}

function open(tab) {
  const el = $('settings'); if (!el) return;
  if (tab) curTab = tab;
  isOpen = true; listening = null; el.classList.remove('hide'); render();
}
function close() {
  const el = $('settings'); if (!el || !isOpen) return;
  isOpen = false; listening = null; el.classList.add('hide'); say('');
  emit('close');
}

/* ---------- clavier : tant que le menu est ouvert, le jeu ne reçoit aucune touche ---------- */
window.addEventListener('keydown', (e) => {
  if (!isOpen) return;
  e.stopImmediatePropagation();
  if (listening) {
    e.preventDefault();
    if (e.code === 'Escape') { stopListen(); return; }
    if (e.code === 'Delete' || e.code === 'Backspace') { const l = listening; listening = null; setBind(l.action, l.slot, ''); return; }
    if (!e.code || /^(Meta|OS)/.test(e.code)) return;
    const l = listening; listening = null;
    setBind(l.action, l.slot, e.code);
    return;
  }
  if (e.code === 'Escape') { e.preventDefault(); close(); }
}, true);
window.addEventListener('keyup', (e) => { if (isOpen && listening) e.stopImmediatePropagation(); }, true);

function init() {
  load();
  const el = $('settings'); if (!el) return;
  el.addEventListener('mousedown', (e) => {
    if (listening && !(e.target.closest && e.target.closest('.kb'))) stopListen();
    if (e.target === el) close();
  });
  $('setClose').addEventListener('click', close);
  $('setX').addEventListener('click', close);
  $('setResetTab').addEventListener('click', resetTab);
  $('setResetAll').addEventListener('click', armResetAll);
  renderHelp($('keysHelp'));
}
init();

return {
  cfg, binds, DEF, on(fn) { listeners.push(fn); },
  open, close, get isOpen() { return isOpen; },
  actionsOf, key, keysOf, label, lockCodes, applyCrosshair, renderHelp
};
})();
