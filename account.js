/* CS Arena - comptes joueurs : connexion, création, profil (niveau, statistiques, records du stand de tir).
   Le serveur garde les comptes (/api/...). Ici : jeton de session, appels à l'API et fenêtre « Compte ».
   game.js lit Account.user / Account.token() et réagit via Account.on(fn). */
window.Account = (function () {
'use strict';
const $ = (id) => document.getElementById(id);
const KEY = 'cs_tok';
let tok = null, user = null, isOpen = false, tab = 'login', busy = false, msg = '', msgOk = false, pwOpen = false;
const listeners = [];
try { tok = localStorage.getItem(KEY); } catch (e) {}

const DIFF = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile', expert: 'Expert' };
const DURS = [30, 60, 90];

async function api(path, body) {
  try {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    try { return await r.json(); } catch (e) { return { ok: false, err: 'Réponse invalide du serveur' }; }
  } catch (e) { return { ok: false, err: 'Serveur injoignable' }; }
}
function setSession(t, u) {
  tok = t || null; user = u || null;
  try { if (tok) localStorage.setItem(KEY, tok); else localStorage.removeItem(KEY); } catch (e) {}
  emit();
}
function emit() { listeners.forEach((f) => { try { f(user); } catch (e) { console.error(e); } }); if (isOpen) render(); }

async function refresh() {
  if (!tok) { user = null; emit(); return null; }
  const r = await api('me', { tok });
  if (r.ok) { user = r.user; emit(); }
  else if (r.err !== 'Serveur injoignable') setSession(null, null);   // jeton expiré ou révoqué
  return user;
}
async function login(name, pass) { const r = await api('login', { name, pass }); if (r.ok) setSession(r.tok, r.user); return r; }
async function register(name, pass) { const r = await api('register', { name, pass }); if (r.ok) setSession(r.tok, r.user); return r; }
async function logout() { const t = tok; setSession(null, null); if (t) await api('logout', { tok: t }); }
// fin d'une série minutée au stand de tir
async function submitRange(res) {
  if (!tok) return { ok: false };
  const r = await api('range', Object.assign({ tok }, res));
  if (r.ok && r.user) { user = r.user; emit(); }
  return r;
}
const top = (d, t) => api('top', { d, t });
// pass de combat : équiper (skin = '' pour retirer) un skin débloqué
async function equip(w, skin) {
  if (!tok) return { ok: false, err: 'Connecte-toi pour équiper des skins' };
  const r = await api('equip', { tok, w, skin: skin || '' });
  if (r.ok && r.user) { user = r.user; emit(); }
  else if (r.code === 401) setSession(null, null);
  return r;
}
const skinOf = (w) => (user && user.eq && user.eq[w]) || '';

/* ---------- fenêtre « Compte » ---------- */
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
    (Array.isArray(c) ? c : [c]).forEach((x) => e.append(x && x.nodeType ? x : document.createTextNode(String(x))));
  }
  return e;
}
const fmtDate = (t) => { try { return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };
const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + ' %' : '—');

function say(t, ok) { msg = t || ''; msgOk = !!ok; const m = document.querySelector('#account .amsg'); if (m) { m.textContent = msg; m.classList.toggle('ok', msgOk); } }

function render() {
  const card = $('accCard'); if (!card) return;
  card.textContent = '';
  card.append(h('div', { class: 'sethead' }, h('h2', null, user ? 'Mon compte' : 'Compte joueur'), h('button', { class: 'x', type: 'button', 'aria-label': 'Fermer', onclick: close }, '✕')));
  const body = h('div', { class: 'abody' });
  card.append(body);
  if (!user) renderAuth(body); else renderProfile(body);
}

function renderAuth(body) {
  body.append(h('p', { class: 'sub' }, 'Ton compte garde tes statistiques (éliminations, victoires, MVP, ACE), ton niveau et tes records au stand de tir, sur tous tes appareils. Sans compte, tu joues en invité.'));
  const tabs = h('div', { class: 'ctl seg atabs' });
  [['login', 'Se connecter'], ['register', 'Créer un compte']].forEach(([id, n]) => tabs.append(h('button', { type: 'button', class: tab === id ? 'on' : '', onclick: () => { tab = id; msg = ''; render(); } }, n)));
  body.append(tabs);
  const name = h('input', { type: 'text', id: 'accName', maxlength: 16, autocomplete: 'username', placeholder: '3 à 16 caractères' });
  const pass = h('input', { type: 'password', id: 'accPass', maxlength: 72, autocomplete: tab === 'login' ? 'current-password' : 'new-password', placeholder: 'Au moins 6 caractères' });
  const pass2 = tab === 'register' ? h('input', { type: 'password', id: 'accPass2', maxlength: 72, autocomplete: 'new-password', placeholder: 'Le même mot de passe' }) : null;
  try { const last = localStorage.getItem('cs_name'); if (last) name.value = last; } catch (e) {}
  const go = async () => {
    if (busy) return;
    const n = name.value.trim(), p = pass.value;
    if (tab === 'register' && pass2.value !== p) { say('Les deux mots de passe ne sont pas identiques'); return; }
    busy = true; say(tab === 'login' ? 'Connexion…' : 'Création du compte…', true);
    const r = tab === 'login' ? await login(n, p) : await register(n, p);
    busy = false;
    if (!r.ok) say(r.err || 'Échec'); else { msg = ''; render(); }
  };
  [name, pass, pass2].forEach((i) => { if (i) i.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'NumpadEnter') go(); }); });
  body.append(
    h('label', { class: 'f', for: 'accName' }, 'PSEUDO'), name,
    h('label', { class: 'f', for: 'accPass' }, 'MOT DE PASSE'), pass,
    pass2 ? h('label', { class: 'f', for: 'accPass2' }, 'CONFIRMER LE MOT DE PASSE') : null, pass2,
    h('div', { class: 'amsg' + (msgOk ? ' ok' : '') }, msg),
    h('button', { class: 'go', type: 'button', onclick: go }, tab === 'login' ? 'SE CONNECTER' : 'CRÉER MON COMPTE'),
    h('p', { class: 'hint' }, 'Pseudo : lettres, chiffres, - et _. Le mot de passe est chiffré sur le serveur (scrypt) et n\'est jamais stocké en clair.')
  );
  setTimeout(() => (name.value ? pass : name).focus(), 30);
}

function renderProfile(body) {
  const u = user, s = u.stats, span = Math.max(1, u.next - u.cur), prog = Math.max(0, Math.min(1, (u.xp - u.cur) / span));
  body.append(h('div', { class: 'aprof' },
    h('div', { class: 'alv' }, h('small', null, 'NIVEAU'), h('b', null, String(u.lv))),
    h('div', { class: 'aid' },
      h('div', { class: 'anm' }, u.name, h('span', { class: 'vf', title: 'Compte vérifié' }, '✔')),
      h('div', { class: 'asub' }, 'Membre depuis le ' + fmtDate(u.created)),
      h('div', { class: 'axp' }, h('i', { style: 'width:' + Math.round(prog * 100) + '%' })),
      h('div', { class: 'asub' }, u.xp + ' XP · encore ' + Math.max(0, u.next - u.xp) + ' XP pour le niveau ' + (u.lv + 1)))
  ));
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills ? s.kills.toFixed(2) : '—';
  const grid = h('div', { class: 'astats' });
  [['Éliminations', s.kills], ['Morts', s.deaths], ['Ratio K/D', kd], ['Tirs à la tête', pct(s.hs, s.kills)],
   ['Manches gagnées', s.roundWins + ' / ' + s.rounds], ['Matchs gagnés', s.matchWins + ' / ' + s.matches], ['MVP', s.mvp], ['ACE', s.aces]]
    .forEach(([n, v]) => grid.append(h('div', null, h('b', null, String(v)), h('small', null, n))));
  body.append(h('div', { class: 'grp' }, 'STATISTIQUES (parties en ligne)'), grid);
  // records du stand de tir
  const tb = h('table', { class: 'arec' });
  tb.append(h('tr', null, h('th', null, 'Stand de tir'), DURS.map((d) => h('th', { class: 'num' }, d + ' s'))));
  Object.keys(DIFF).forEach((k) => tb.append(h('tr', null, h('td', null, DIFF[k]), DURS.map((d) => { const r = u.range[k + '_' + d]; return h('td', { class: 'num' }, r ? String(r.score) : '—', r ? h('small', null, ' ' + r.acc + ' %') : null); }))));
  body.append(h('div', { class: 'grp' }, 'RECORDS AU STAND DE TIR (' + s.range + ' série' + (s.range > 1 ? 's' : '') + ')'), tb);
  // mot de passe
  if (pwOpen) {
    const o = h('input', { type: 'password', maxlength: 72, autocomplete: 'current-password', placeholder: 'Ancien mot de passe' });
    const n = h('input', { type: 'password', maxlength: 72, autocomplete: 'new-password', placeholder: 'Nouveau (6 caractères ou plus)' });
    const ok = async () => {
      if (busy) return; busy = true; say('Enregistrement…', true);
      const r = await api('password', { tok, old: o.value, pass: n.value }); busy = false;
      if (r.ok) { pwOpen = false; msg = 'Mot de passe changé · tes autres appareils sont déconnectés'; msgOk = true; render(); }
      else { say(r.err || 'Échec'); if (r.code === 401) setSession(null, null); }
    };
    [o, n].forEach((i) => i.addEventListener('keydown', (e) => { if (e.code === 'Enter') ok(); }));
    body.append(h('div', { class: 'grp' }, 'CHANGER LE MOT DE PASSE'), h('div', { class: 'fields' }, o, n), h('div', { class: 'abtns' }, h('button', { type: 'button', class: 'primary', onclick: ok }, 'Valider'), h('button', { type: 'button', onclick: () => { pwOpen = false; msg = ''; render(); } }, 'Annuler')));
    setTimeout(() => o.focus(), 30);
  }
  body.append(h('div', { class: 'amsg' + (msgOk ? ' ok' : '') }, msg));
  body.append(h('div', { class: 'abtns' },
    pwOpen ? null : h('button', { type: 'button', onclick: () => { pwOpen = true; msg = ''; render(); } }, 'Changer le mot de passe'),
    h('button', { type: 'button', onclick: () => { msg = 'Déconnecté'; msgOk = true; logout(); } }, 'Se déconnecter'),
    h('span', { class: 'grow' }),
    h('button', { type: 'button', class: 'primary', onclick: close }, 'Fermer')));
}

function open() {
  const el = $('account'); if (!el) return;
  isOpen = true; msg = ''; pwOpen = false; el.classList.remove('hide');
  if (document.pointerLockElement) document.exitPointerLock();
  render(); refresh();
}
function close() { const el = $('account'); if (!el) return; isOpen = false; el.classList.add('hide'); }

// tant que la fenêtre est ouverte, le jeu ne reçoit pas les touches (on peut taper son mot de passe)
window.addEventListener('keydown', (e) => {
  if (!isOpen) return;
  e.stopImmediatePropagation();
  if (e.code === 'Escape') { e.preventDefault(); close(); }
}, true);
window.addEventListener('keyup', (e) => { if (isOpen) e.stopImmediatePropagation(); }, true);
{
  const el = $('account');
  if (el) el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
}
refresh();

return {
  get user() { return user; }, token: () => tok, get isOpen() { return isOpen; },
  on(fn) { listeners.push(fn); }, open, close, refresh, logout, submitRange, top, equip, skinOf, DIFF
};
})();
