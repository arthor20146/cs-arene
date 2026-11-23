// Serveur CS Arena : sert /public, API des comptes (/api/...) + salles WebSocket (manches, économie, bombe, dégâts, entraînement)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
// Docker : fichiers client dans ./public ; dépôt à plat (npm start en local) : à la racine
const PUB = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const CS = require(path.join(PUB, 'shared.js'));
const { CFG, ZONES, WEAPONS, GREN, MAPS, phaseBoxes, SKINS, PASS, passTier, MASTERY, masteryLv, armorHit } = CS;
const GR = 0.11; // rayon d'une grenade (m)
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffled = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
if (process.env.MAX_ROUNDS) CFG.maxRounds = parseInt(process.env.MAX_ROUNDS, 10) || CFG.maxRounds;
if (process.env.MIN_PLAYERS) CFG.minPlayers = parseInt(process.env.MIN_PLAYERS, 10) || CFG.minPlayers;

/* ============================================================
   Comptes : pseudo + mot de passe (scrypt), sessions par jeton, statistiques, records du stand de tir.
   Tout est rangé dans DATA_DIR/accounts.json (dossier ./data par défaut).
   ============================================================ */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const RANGE_DIFFS = ['easy', 'medium', 'hard', 'expert'], RANGE_DURS = [30, 60, 90];
const Acc = (function () {
  const FILE = path.join(DATA_DIR, 'accounts.json');
  let db = { v: 1, users: {} }, dirty = false, writing = false;
  const tokens = new Map();                      // jeton -> clé du compte (pseudo en minuscules)
  // Base de données Supabase (gratuite) si SUPABASE_URL et SUPABASE_KEY sont définis : les comptes survivent
  // aux redémarrages de l'hébergeur. Sinon : fichier DATA_DIR/accounts.json.
  const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), SB_KEY = process.env.SUPABASE_KEY || '';
  const useDb = !!(SB_URL && SB_KEY);
  // ancienne clé service_role (JWT « eyJ… ») : aussi dans Authorization ; nouvelle clé secrète « sb_secret_… » : apikey seulement
  const SB_H = Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' }, SB_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SB_KEY } : {});
  let loaded = !useDb;                           // tant que la base n'est pas lue, on n'écrit rien (pour ne pas l'effacer)
  const index = () => { tokens.clear(); Object.keys(db.users).forEach((k) => (db.users[k].tokens || []).forEach((t) => tokens.set(t.t, k))); };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  if (!useDb) {
    try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (raw && raw.users) db = raw; } catch (e) {}
    index();
    console.log('Comptes : ' + Object.keys(db.users).length + ' (fichier ' + FILE + ')');
  }
  async function loadDb() {
    try {
      const r = await fetch(SB_URL + '/rest/v1/cs_store?id=eq.accounts&select=data', { headers: SB_H, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const rows = await r.json();
      if (rows.length && rows[0].data && rows[0].data.users) {
        // fusion : un compte créé pendant le chargement n'est pas perdu
        const cur = db.users; db = rows[0].data; Object.keys(cur).forEach((k) => { if (!db.users[k]) db.users[k] = cur[k]; });
      }
      index(); loaded = true;
      console.log('Comptes : ' + Object.keys(db.users).length + ' (base de données Supabase)');
    } catch (e) {
      console.error('Lecture de la base de données impossible (nouvel essai dans 10 s) :', e.message);
      setTimeout(loadDb, 10000);
    }
  }
  const ready = useDb ? Promise.race([loadDb(), new Promise((res) => setTimeout(res, 20000))]) : Promise.resolve();

  // écriture différée : base de données (upsert d'une ligne) ou fichier (temporaire puis renommage)
  const save = () => { dirty = true; };
  async function flush() {
    if (!dirty || writing || !loaded) return;
    dirty = false; writing = true;
    const body = JSON.stringify(db);
    try {
      if (useDb) {
        const r = await fetch(SB_URL + '/rest/v1/cs_store', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, SB_H),
          body: '[{"id":"accounts","data":' + body + ',"updated_at":"' + new Date().toISOString() + '"}]', signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      }
      // copie locale (aussi utile en secours avec la base de données)
      await fs.promises.writeFile(FILE + '.tmp', body); await fs.promises.rename(FILE + '.tmp', FILE);
    } catch (e) { dirty = true; console.error('Sauvegarde des comptes impossible :', e.message); }
    writing = false;
  }
  setInterval(flush, 2500).unref();
  // l'hébergeur arrête le serveur (mise en veille, redéploiement) : on enregistre avant de quitter
  let quitting = false;
  const bye = async () => { if (quitting) return; quitting = true; for (let i = 0; i < 20 && writing; i++) await new Promise((r) => setTimeout(r, 250)); await flush(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);

  const STAT0 = () => ({ kills: 0, deaths: 0, hs: 0, rounds: 0, roundWins: 0, matches: 0, matchWins: 0, mvp: 0, aces: 0, range: 0 });
  const xpOf = (s) => s.kills * 10 + s.hs * 2 + s.roundWins * 20 + s.matches * 40 + s.matchWins * 100 + s.mvp * 25 + s.aces * 150 + s.range * 15;
  const levelOf = (x) => Math.floor(Math.sqrt(x / 120)) + 1;   // niveau n à partir de 120 × (n-1)² XP
  function pub(u) {
    const s = Object.assign(STAT0(), u.stats), xp = xpOf(s), lv = levelOf(xp);
    const bx = u.bp | 0, bt = passTier(bx);
    return { name: u.name, created: u.created, stats: s, range: u.range || {}, xp, lv, cur: 120 * (lv - 1) * (lv - 1), next: 120 * lv * lv,
      bp: { xp: bx, tier: bt.tier, cur: bt.cur, need: bt.need }, eq: Object.assign({}, u.eq || {}), ms: Object.assign({}, u.ms || {}) };
  }
  // pass de combat : ajoute de l'XP, renvoie le palier et s'il vient d'en passer un (ou plusieurs)
  function pass(k, x) {
    const u = db.users[k]; if (!u || !(x > 0)) return { tier: u ? passTier(u.bp | 0).tier : 0, up: [] };
    const t0 = passTier(u.bp | 0).tier;
    u.bp = (u.bp | 0) + Math.round(x); save();
    const t1 = passTier(u.bp).tier, up = [];
    for (let t = t0 + 1; t <= t1; t++) up.push(t);
    return { tier: t1, up, xp: u.bp };
  }
  // maîtrise d'une arme : ajoute de l'XP, renvoie les niveaux passés
  function mastery(k, w, x) {
    const u = db.users[k]; if (!u || !WEAPONS[w] || !(x > 0)) return { up: [] };
    const ms = u.ms || (u.ms = {}), l0 = masteryLv(ms[w] | 0).lv;
    ms[w] = (ms[w] | 0) + Math.round(x); save();
    const l1 = masteryLv(ms[w]).lv, up = [];
    for (let l = l0 + 1; l <= l1; l++) up.push(l);
    return { lv: l1, xp: ms[w], up };
  }
  // skins équipés : { arme: skin } (seulement les skins débloqués)
  const eqOf = (k) => Object.assign({}, (db.users[k] && db.users[k].eq) || {});
  const eqListeners = [];
  function equip(m) {
    const u = byTok(m.tok); if (!u) return { ok: false, err: 'Session expirée, reconnecte-toi', code: 401 };
    const w = String(m.w || ''), id = String(m.skin || '');
    if (!WEAPONS[w]) return { ok: false, err: 'Arme inconnue' };
    const eq = u.eq || (u.eq = {});
    if (id === '') delete eq[w];
    else {
      const S = SKINS[id];
      if (!S || S.w !== w) return { ok: false, err: 'Skin inconnu' };
      if (S.ms) { if (masteryLv((u.ms || {})[w] | 0).lv < S.ms) return { ok: false, err: 'Skin pas encore débloqué (maîtrise niveau ' + S.ms + ')' }; }
      else if (passTier(u.bp | 0).tier < S.tier) return { ok: false, err: 'Skin pas encore débloqué (palier ' + S.tier + ')' };
      eq[w] = id;
    }
    save();
    eqListeners.forEach((f) => f(keyOf(u), Object.assign({}, eq)));
    return { ok: true, user: pub(u) };
  }
  const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
  const hash = (pass, salt) => new Promise((res, rej) => crypto.scrypt(pass, salt, 64, (e, k) => (e ? rej(e) : res(k.toString('hex')))));
  function newToken(k) {
    const u = db.users[k], t = crypto.randomBytes(24).toString('hex');
    u.tokens = (u.tokens || []).concat([{ t, at: Date.now() }]);
    while (u.tokens.length > 6) tokens.delete(u.tokens.shift().t);   // 6 appareils connectés au plus
    tokens.set(t, k); save();
    return t;
  }
  const byTok = (t) => { const k = typeof t === 'string' ? tokens.get(t) : null; return k && db.users[k] ? db.users[k] : null; };
  const keyOf = (u) => u.name.toLowerCase();
  const okPass = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 72;

  async function register(name, pass) {
    name = typeof name === 'string' ? name.trim() : '';
    if (!NAME_RE.test(name)) return { ok: false, err: 'Pseudo : 3 à 16 caractères (lettres, chiffres, - et _)' };
    if (!okPass(pass)) return { ok: false, err: 'Mot de passe : au moins 6 caractères' };
    const k = name.toLowerCase();
    if (db.users[k]) return { ok: false, err: 'Ce pseudo est déjà pris' };
    const salt = crypto.randomBytes(16).toString('hex');
    const h = await hash(pass, salt);
    if (db.users[k]) return { ok: false, err: 'Ce pseudo est déjà pris' };
    db.users[k] = { name, salt, hash: h, created: Date.now(), tokens: [], stats: STAT0(), range: {} };
    const tok = newToken(k);
    return { ok: true, tok, user: pub(db.users[k]) };
  }
  async function login(name, pass) {
    const k = typeof name === 'string' ? name.trim().toLowerCase() : '', u = db.users[k];
    if (!u || typeof pass !== 'string') { await hash('x', 'y'); return { ok: false, err: 'Pseudo ou mot de passe incorrect' }; }
    const h = await hash(pass, u.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'))) return { ok: false, err: 'Pseudo ou mot de passe incorrect' };
    return { ok: true, tok: newToken(k), user: pub(u) };
  }
  function logout(t) {
    const u = byTok(t); if (!u) return;
    u.tokens = (u.tokens || []).filter((x) => x.t !== t); tokens.delete(t); save();
  }
  async function changePass(t, old, pass) {
    const u = byTok(t); if (!u) return { ok: false, err: 'Session expirée, reconnecte-toi', code: 401 };
    const h = await hash(typeof old === 'string' ? old : '', u.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'))) return { ok: false, err: 'Ancien mot de passe incorrect' };
    if (!okPass(pass)) return { ok: false, err: 'Nouveau mot de passe : au moins 6 caractères' };
    u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await hash(pass, u.salt);
    // les autres appareils sont déconnectés
    (u.tokens || []).forEach((x) => { if (x.t !== t) tokens.delete(x.t); });
    u.tokens = (u.tokens || []).filter((x) => x.t === t); save();
    return { ok: true };
  }
  // ajoute des statistiques à un compte ; renvoie son niveau
  function stat(k, d) {
    const u = db.users[k]; if (!u) return 0;
    const s = u.stats || (u.stats = STAT0());
    Object.keys(d).forEach((n) => { s[n] = (s[n] || 0) + (d[n] | 0); });
    save();
    return levelOf(xpOf(Object.assign(STAT0(), s)));
  }
  const level = (k) => (db.users[k] ? levelOf(xpOf(Object.assign(STAT0(), db.users[k].stats))) : 0);
  // fin d'une série au stand de tir : record par difficulté et durée
  function range(m) {
    const u = byTok(m.tok); if (!u) return { ok: false, err: 'Session expirée, reconnecte-toi', code: 401 };
    const d = m.d, t = m.t | 0;
    if (RANGE_DIFFS.indexOf(d) < 0 || RANGE_DURS.indexOf(t) < 0) return { ok: false, err: 'Série invalide' };
    const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
    const r = { score: n(m.score, 999999), hits: n(m.hits, 9999), miss: n(m.miss, 9999), acc: n(m.acc, 100), rt: n(m.rt, 99999), combo: n(m.combo, 9999), at: Date.now() };
    const key = d + '_' + t, R = u.range || (u.range = {}), prev = R[key];
    const rec = !prev || r.score > prev.score;
    if (rec) R[key] = r;
    (u.stats || (u.stats = STAT0())).range = (u.stats.range || 0) + 1;
    // pass : un peu d'XP par série terminée (plafonné chaque jour)
    const day = new Date().toISOString().slice(0, 10);
    if (!u.bpDay || u.bpDay.d !== day) u.bpDay = { d: day, x: 0 };
    const gx = Math.min(PASS.gain.range, PASS.gain.rangeDay - u.bpDay.x);
    let up = [];
    if (gx > 0) { u.bpDay.x += gx; up = pass(keyOf(u), gx).up; }
    save();
    return { ok: true, rec, prev: prev ? prev.score : 0, bpx: Math.max(0, gx), up, user: pub(u) };
  }
  function top(d, t) {
    const key = d + '_' + (t | 0), list = [];
    Object.keys(db.users).forEach((k) => { const r = db.users[k].range && db.users[k].range[key]; if (r) list.push({ n: db.users[k].name, s: r.score, a: r.acc, h: r.hits }); });
    list.sort((a, b) => b.s - a.s);
    return { ok: true, list: list.slice(0, 10) };
  }
  // trop d'essais depuis la même adresse
  const tries = new Map();
  setInterval(() => { const now = Date.now(); tries.forEach((e, k) => { if (now > e[1]) tries.delete(k); }); }, 60000).unref();
  function limited(key, n) { const now = Date.now(); let e = tries.get(key); if (!e || now > e[1]) { e = [0, now + 60000]; tries.set(key, e); } return ++e[0] > n; }
  const SLOW = { ok: false, err: 'Trop d\'essais : réessaie dans une minute', code: 429 };

  async function route(r, m, ip) {
    if (!loaded) return { ok: false, err: 'Le serveur démarre, réessaie dans quelques secondes', code: 503 };
    switch (r) {
      case 'register': return limited('r' + ip, 6) ? SLOW : register(m.name, m.pass);
      case 'login': return limited('l' + ip, 12) ? SLOW : login(m.name, m.pass);
      case 'me': { const u = byTok(m.tok); return u ? { ok: true, user: pub(u) } : { ok: false, err: 'Session expirée', code: 401 }; }
      case 'logout': logout(m.tok); return { ok: true };
      case 'password': return limited('p' + ip, 8) ? SLOW : changePass(m.tok, m.old, m.pass);
      case 'range': return range(m);
      case 'top': return top(m.d, m.t);
      case 'equip': return equip(m);
    }
    return { ok: false, err: 'Introuvable', code: 404 };
  }
  return { ready, route, byTok, keyOf, stat, level, pass, mastery, eqOf, onEquip: (f) => eqListeners.push(f), exists: (n) => !!db.users[String(n).toLowerCase()] };
})();

/* ============================================================
   Cartes perso (éditeur de cartes) : envoyées par l'éditeur ou le menu, rangées par empreinte (u_xxxxxxxxxx).
   Fichier DATA_DIR/maps.json, et base Supabase (ligne « maps ») si elle est configurée.
   POST /maps/save { map } -> { ok, id }   GET /maps/get?id=u_... -> { ok, map }   GET /maps/list -> { ok, list }
   ============================================================ */
const CMaps = (function () {
  const FILE = path.join(DATA_DIR, 'maps.json'), MAX = 500;
  const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), SB_KEY = process.env.SUPABASE_KEY || '', useDb = !!(SB_URL && SB_KEY);
  const SB_H = Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' }, SB_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SB_KEY } : {});
  let db = {};   // id -> { map, at, name, n }
  const reg = (id) => { try { MAPS[id] = CS.buildCustom(db[id].map, id); } catch (e) { delete db[id]; } };
  const loadAll = (raw) => { if (raw && typeof raw === 'object') Object.keys(raw).forEach((id) => { if (/^u_[a-f0-9]{10}$/.test(id) && raw[id] && raw[id].map && !db[id]) { db[id] = raw[id]; reg(id); } }); };
  try { loadAll(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
  (async function loadDb() {
    if (!useDb) return;
    try {
      const r = await fetch(SB_URL + '/rest/v1/cs_store?id=eq.maps&select=data', { headers: SB_H, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json(); if (rows.length) loadAll(rows[0].data);
    } catch (e) { console.error('Cartes perso : lecture de la base impossible :', e.message); setTimeout(loadDb, 30000); }
  })();
  if (Object.keys(db).length) console.log('Cartes perso : ' + Object.keys(db).length);
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const body = JSON.stringify(db);
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); await fs.promises.writeFile(FILE + '.tmp', body); await fs.promises.rename(FILE + '.tmp', FILE); } catch (e) { console.error('Cartes perso : écriture impossible :', e.message); }
      if (useDb) {
        try {
          await fetch(SB_URL + '/rest/v1/cs_store', { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, SB_H),
            body: '[{"id":"maps","data":' + body + ',"updated_at":"' + new Date().toISOString() + '"}]', signal: AbortSignal.timeout(20000) });
        } catch (e) { console.error('Cartes perso : envoi à la base impossible :', e.message); }
      }
    }, 800);
  };
  const hits = new Map();   // limite : 30 envois par minute et par adresse
  function save(src, ip) {
    const now = Date.now(), h = (hits.get(ip) || []).filter((t) => now - t < 60000);
    if (h.length >= 30) return { ok: false, err: 'Trop d\'envois, réessaie dans une minute', code: 429 };
    h.push(now); hits.set(ip, h);
    const map = CS.sanitizeMap(src);
    const id = 'u_' + crypto.createHash('sha1').update(JSON.stringify(map)).digest('hex').slice(0, 10);
    if (!db[id]) {
      db[id] = { map, at: now, name: map.name, n: map.boxes.length };
      const ids = Object.keys(db);
      if (ids.length > MAX) {   // les plus anciennes qui ne servent dans aucune salle s'en vont
        ids.sort((a, b) => db[a].at - db[b].at).slice(0, ids.length - MAX).forEach((k) => { if (k !== id && !Array.from(rooms.values()).some((r) => r.map.id === k)) { delete db[k]; delete MAPS[k]; } });
      }
      persist();
    } else db[id].at = now;
    reg(id);
    return { ok: true, id };
  }
  const get = (id) => (db[id] ? { ok: true, map: db[id].map } : { ok: false, err: 'Carte introuvable', code: 404 });
  const list = () => ({ ok: true, list: Object.keys(db).sort((a, b) => db[b].at - db[a].at).slice(0, 60).map((id) => ({ id, name: db[id].name, n: db[id].n, at: db[id].at })) });
  return { save, get, list };
})();
// éditeur de cartes réservé à certains comptes (variable MAP_EDITORS, séparés par des virgules ; « faze » par défaut)
const EDITORS = (process.env.MAP_EDITORS || 'faze').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const canEdit = (tok) => { const u = Acc.byTok(tok); return !!(u && EDITORS.indexOf(u.name.toLowerCase()) >= 0); };
function mapsRoute(req, res, url) {
  const q = new URLSearchParams((req.url || '').split('?')[1] || '');
  if (req.method === 'GET' && url === 'get') { const o = CMaps.get(String(q.get('id') || '')); return json(res, o.ok ? 200 : o.code, o); }
  if (req.method === 'GET' && url === 'list') return json(res, 200, CMaps.list());
  if (req.method !== 'POST' || (url !== 'save' && url !== 'can')) return json(res, 404, { ok: false, err: 'Inconnu' });
  let body = '', size = 0, dead = false;
  req.on('data', (c) => { size += c.length; if (size > 262144) { dead = true; json(res, 413, { ok: false, err: 'Carte trop grosse' }); req.destroy(); } else body += c; });
  req.on('end', () => {
    if (dead) return;
    let m; try { m = JSON.parse(body || '{}'); } catch (e) { return json(res, 400, { ok: false, err: 'Carte illisible' }); }
    const ok = canEdit(m && m.tok);
    if (url === 'can') return json(res, 200, { ok: true, can: ok });
    if (!ok) return json(res, 403, { ok: false, err: 'L\'éditeur de cartes est réservé au compte administrateur', code: 403 });
    const ip = String(req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '');
    const o = CMaps.save(m && m.map, ip); json(res, o.ok ? 200 : o.code, o);
  });
}

function json(res, code, o) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); }
function api(req, res, r) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, err: 'Méthode non autorisée' });
  let body = '', size = 0, dead = false;
  req.on('data', (c) => { size += c.length; if (size > 4096) { dead = true; json(res, 413, { ok: false, err: 'Requête trop grosse' }); req.destroy(); } else body += c; });
  req.on('end', async () => {
    if (dead) return;
    let m;
    try { m = JSON.parse(body || '{}'); } catch (e) { return json(res, 400, { ok: false, err: 'Requête invalide' }); }
    if (!m || typeof m !== 'object') m = {};
    const ip = String(req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '');
    try { const out = await Acc.route(r, m, ip); json(res, out.ok ? 200 : (out.code || 400), out); }
    catch (e) { console.error(e); json(res, 500, { ok: false, err: 'Erreur du serveur' }); }
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.startsWith('/api/')) return api(req, res, url.slice(5));
  if (url.startsWith('/maps/')) return mapsRoute(req, res, url.slice(6));
  const rel = url === '/' ? '/index.html' : url;
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 2048 });
const rooms = new Map();
Acc.onEquip((k, eq) => rooms.forEach((r) => r.players.forEach((p) => { if (p.acc === k) p.eq = eq; })));
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const send = (ws, o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

class Room {
  constructor(name, mapId, mode) {
    this.name = name;
    // '' bombe · 'desordre' rien n'est à sa place · 'range' stand de tir · 'sandbox' zone de test
    this.mode = ['desordre', 'range', 'sandbox'].indexOf(mode) >= 0 ? mode : '';
    const M = MAPS[mapId];
    if (this.mode === 'range') this.map = MAPS.range;
    else if (this.mode === 'sandbox') this.map = M || MAPS.labo;
    else this.map = (M && !M.practice) ? M : (MAPS[process.env.MAP] || MAPS.dust); // carte choisie par le créateur de la salle
    this.spawnN = 0; this.bombReset = 0;
    this.hidden = new Set();                                    // obstacles disparus (indices dans map.boxes)
    this.chaosQ = []; this.jam = null; this.inv = 0; this.lastChaos = '';
    this.players = new Map();
    this.nextId = 1;
    this.nextDrop = 1;
    this.nextG = 1;
    this.snapN = 0;
    this.lobby = false;   // salle en mode lobby : la partie démarre quand l'hôte la lance
    this.host = 0;
    this.lobbyAt = 0;     // fin du compte à rebours quand tout le monde est prêt
    this.resetMatch();
    this.timer = setInterval(() => this.tick(), CFG.tick);
  }

  /* ---------- utilitaires ---------- */
  get practice() { return this.mode === 'range' || this.mode === 'sandbox'; }
  god(t) { return this.mode === 'sandbox' && !!(t.opt && t.opt.god); }        // zone de test : invincible
  all() { return Array.from(this.players.values()); }
  team(t) { return this.all().filter((p) => p.team === t); }
  alive(t) { return this.all().filter((p) => p.team === t && p.alive); }
  bcast(o, exceptId) { const s = JSON.stringify(o); this.players.forEach((p, id) => { if (id !== exceptId && p.ws.readyState === WebSocket.OPEN) p.ws.send(s); }); }
  msg(text, kind) { this.bcast({ type: 'msg', text, kind: kind || '' }); }

  defaultSecondary(team) { return team === 'CT' ? 'usp' : 'glock'; }
  resetLoadout(p, full) {
    p.hp = 100; p.armor = 0; p.helmet = false; p.kit = false;
    p.g = { flash: 0, smoke: 0, he: 0, molo: 0 };
    p.inv = { primary: null, secondary: this.defaultSecondary(p.team), cur: this.defaultSecondary(p.team) };
    if (full) p.money = CFG.startMoney;
  }

  resetMatch() {
    this.round = 0;
    this.score = { T: 0, CT: 0 };
    this.loss = { T: 0, CT: 0 };
    this.phase = 'wait';
    this.phaseEnd = 0;
    this.liveStart = 0;
    this.started = { T: 0, CT: 0 };
    this.bomb = { s: 'none', x: 0, y: 0, z: 0, c: null, site: '', at: 0 };
    this.drops = []; this.dropsDirty = true;
    this.gren = []; this.zones = [];
    this.firstBlood = false;
    this.players.forEach((p) => { p.k = 0; p.d = 0; p.ac = 0; p.mv = 0; p.rk = 0; p.survived = false; this.resetLoadout(p, true); p.alive = false; p.ready = false; });
    this.lobbyAt = 0;
  }

  // obstacles présents (ceux qui ont disparu ne comptent plus)
  solid() { return this.hidden.size ? this.map.boxes.filter((b, i) => !this.hidden.has(i)) : this.map.boxes; }

  /* ---------- armes au sol ---------- */
  groundY(x, z, y) {
    let g = 0;
    for (const b of this.solid()) {
      if (b.h <= y + 0.2 && b.h > g && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) g = b.h;
    }
    return g;
  }
  ammoOf(p, id) {
    const w = WEAPONS[id], a = p.am[id];
    return a ? a : [w.mag, w.res];
  }
  // pose l'arme devant le joueur (à ses pieds si un mur est juste devant)
  dropWeapon(p, id, dist) {
    const w = WEAPONS[id];
    if (!w || w.slot === 3) return;
    const [mag, res] = this.ammoOf(p, id);
    let x = p.x - Math.sin(p.yaw) * dist, z = p.z - Math.cos(p.yaw) * dist;
    const inWall = this.solid().some((b) => b.h > p.y + 0.2 && Math.abs(x - b.x) < b.w / 2 + 0.1 && Math.abs(z - b.z) < b.d / 2 + 0.1);
    if (inWall) { x = p.x; z = p.z; }
    const hx = this.map.hx - 0.5, hz = this.map.hz - 0.5;
    x = Math.max(-hx, Math.min(hx, x)); z = Math.max(-hz, Math.min(hz, z));
    this.drops.push({
      i: this.nextDrop++, w: id, x: r2(x), y: r2(this.groundY(x, z, p.y)), z: r2(z), r: r2(Math.random() * 6.28),
      ox: r2(p.x), oy: r2(p.y), oz: r2(p.z), mag, res, by: p.id, at: Date.now()
    });
    while (this.drops.length > CFG.maxDrops) this.drops.shift();
    this.dropsDirty = true;
    if (p.inv.primary === id) p.inv.primary = null; else if (p.inv.secondary === id) p.inv.secondary = null;
    delete p.am[id];
    if (p.bought) delete p.bought[id];          // une arme jetée n'est plus remboursable
    if (p.inv.cur === id) p.inv.cur = p.inv.primary || p.inv.secondary || 'knife';
  }
  takeDrop(p, d, manual) {
    const w = WEAPONS[d.w], i = this.drops.indexOf(d);
    if (i >= 0) this.drops.splice(i, 1); // i < 0 : déjà sortie de la liste (plus de maxDrops armes au sol)
    this.dropsDirty = true;
    if (w.slot === 1) p.inv.primary = d.w; else p.inv.secondary = d.w;
    p.inv.cur = d.w;
    p.am[d.w] = [d.mag, d.res];
    send(p.ws, { type: 'got', w: d.w, mag: d.mag, res: d.res, sel: manual ? 1 : 0 });
  }
  nearDrop(p, range) {
    let best = null, bd = range;
    for (const d of this.drops) {
      const n = Math.hypot(p.x - d.x, p.z - d.z);
      if (n <= bd && Math.abs(p.y - d.y) < 1.5) { bd = n; best = d; }
    }
    return best;
  }
  // E : prend l'arme la plus proche, en échange de celle de même type
  swapDrop(p) {
    const d = this.nearDrop(p, CFG.pickRange);
    if (!d) return;
    const held = WEAPONS[d.w].slot === 1 ? p.inv.primary : p.inv.secondary;
    if (held) this.dropWeapon(p, held, 0.5);
    this.takeDrop(p, d, true);
  }
  // on passe sur une arme : ramassée seulement si l'emplacement est libre
  autoPickup() {
    for (const p of this.all()) {
      if (!p.alive) continue;
      for (const d of this.drops.slice()) {
        const n = Math.hypot(p.x - d.x, p.z - d.z);
        if (d.by === p.id) { if (n > 2.2) d.by = 0; continue; } // celui qui jette ne la reprend pas tout de suite
        if (n > CFG.pickAuto || Math.abs(p.y - d.y) >= 1.5) continue;
        const free = WEAPONS[d.w].slot === 1 ? !p.inv.primary : !p.inv.secondary;
        if (free) { this.takeDrop(p, d); break; }
      }
    }
  }

  /* ---------- équipes ---------- */
  chooseTeam(p, want) {
    const nT = this.team('T').filter((q) => q !== p).length;
    const nC = this.team('CT').filter((q) => q !== p).length;
    if (want !== 'T' && want !== 'CT') want = nT <= nC ? 'T' : 'CT';
    const other = want === 'T' ? nC : nT, mine = want === 'T' ? nT : nC;
    if (mine > other + 1) { send(p.ws, { type: 'msg', text: 'Équipe pleine : équilibrage des équipes', kind: 'err' }); want = want === 'T' ? 'CT' : 'T'; }
    return want;
  }

  /* ---------- manches ---------- */
  spawnPlayer(p, idx) {
    const list = this.map.spawns[p.team];
    const sp = list[idx % list.length];
    p.x = sp.x; p.y = sp.y; p.z = sp.z; p.yaw = sp.yaw; p.pitch = 0; p.c = 0;
    p.alive = true; p.hp = 100; p.act = null; p.pg = 0; p.rlS = 0; p.shot = null;
    // contrôle des déplacements : on repart du point d'apparition ; les positions encore en route
    // (envoyées avant l'apparition) sont ignorées pendant 0,3 s. Compatible avec tous les clients.
    p.spawnT = Date.now(); p.ax = sp.x; p.ay = sp.y; p.az = sp.z; p.aT = p.spawnT; p.aTp = p.tp || 0; p.mvB = 2; p.gY = sp.y; p.airS = 0; p.hist = [];
    send(p.ws, { type: 'spawn', x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
  }

  startRound() {
    const now = Date.now();
    this.round++;
    // désordre de la manche précédente : chacun retrouve son camp, les murs reviennent
    this.all().forEach((p) => { if (p.home) { p.team = p.home; p.home = null; } });
    this.hidden = new Set(); this.jam = null; this.inv = 0; this.chaosQ = [];
    let fullReset = this.round === 1;
    if (this.round - 1 === CFG.maxRounds / 2) { // mi-temps : on inverse les camps
      this.all().forEach((p) => { if (p.team) p.team = p.team === 'T' ? 'CT' : 'T'; });
      this.score = { T: this.score.CT, CT: this.score.T };
      this.loss = { T: 0, CT: 0 };
      fullReset = true;
      this.msg('Mi-temps : les équipes changent de camp', 'info');
    }
    this.all().forEach((p) => {
      if (p.pending && p.pending !== p.team) { p.team = p.pending; p.survived = false; }
      p.pending = null;
      if (!p.team) p.team = this.chooseTeam(p, 'auto');
    });
    this.drops = []; this.dropsDirty = true;
    this.gren = []; this.zones = [];
    this.firstBlood = false;
    this.all().forEach((p) => { p.rk = 0; });
    const idx = { T: 0, CT: 0 };
    this.all().forEach((p) => {
      p.am = {}; p.bought = {};
      if (fullReset) { p.survived = false; this.resetLoadout(p, true); }
      else if (!p.survived) this.resetLoadout(p, false);
      this.spawnPlayer(p, idx[p.team]++);
    });
    this.started = { T: this.alive('T').length, CT: this.alive('CT').length };
    // bombe
    const ts = this.alive('T');
    if (ts.length) {
      const c = ts[Math.floor(Math.random() * ts.length)];
      this.bomb = { s: 'carried', x: c.x, y: 0, z: c.z, c: c.id, site: '', at: 0 };
    } else this.bomb = { s: 'none', x: 0, y: 0, z: 0, c: null, site: '', at: 0 };
    if (this.practice) {   // entraînement : pas de phase d'achat, la manche ne finit jamais, argent illimité
      this.bomb = { s: 'none', x: 0, y: 0, z: 0, c: null, site: '', at: 0 }; this.bombReset = 0;
      this.all().forEach((p) => { p.money = CFG.maxMoney; });
      this.phase = 'live'; this.liveStart = now; this.phaseEnd = now + 864e5;
      this.bcast({ type: 'rstart', round: this.round, pm: this.mode });
      return;
    }
    this.phase = 'freeze';
    this.phaseEnd = now + CFG.freeze * 1000;
    this.bcast({ type: 'rstart', round: this.round });
  }

  /* ---------- mode « Rien n'est à sa place » : des désordres au hasard, de temps en temps ----------
     Chaque manche tire son nombre d'événements (souvent 0 ou 1, parfois 2 ou 3) et leurs moments.
     Le type d'événement et son ampleur sont aussi tirés au sort. */
  planChaos(now) {
    const r = Math.random(), n = r < 0.35 ? 0 : r < 0.75 ? 1 : r < 0.95 ? 2 : 3;
    const t0 = 10000, t1 = CFG.live * 1000 - 12000, q = [];
    for (let tries = 0; q.length < n && tries < 50; tries++) {
      const t = t0 + Math.random() * (t1 - t0);
      if (q.every((u) => Math.abs(u - t) > 20000)) q.push(t);
    }
    // 1 fois sur 4, pas d'alerte : le désordre tombe par surprise
    this.chaosQ = q.sort((a, b) => a - b).map((t) => ({ at: now + t, warn: Math.random() < 0.75, warned: false }));
  }
  tickChaos(now) {
    const e = this.chaosQ && this.chaosQ[0];
    if (!e) return;
    if (e.warn && !e.warned && now >= e.at - 3000) { e.warned = true; this.bcast({ type: 'shift', t: 3 }); }
    if (now >= e.at) { this.chaosQ.shift(); this.chaos(now); }
  }
  chaos(now) {
    const T = this.alive('T'), C = this.alive('CT');
    const kinds = [];
    if (T.length && C.length) kinds.push('teams');
    if (this.score.T !== this.score.CT) kinds.push('score');
    if (phaseBoxes(this.map).length) kinds.push('walls');
    if (!this.jam || now > this.jam.until) kinds.push('jam');
    if (T.length + C.length >= 2) kinds.push('swap');
    if (now > this.inv) kinds.push('invert');
    const pool = kinds.filter((k) => k !== this.lastChaos);
    const k = pick(pool.length ? pool : kinds);
    if (!k) return;
    this.lastChaos = k;
    const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    if (k === 'teams') this.chaosTeams(T, C);
    else if (k === 'score') {
      this.score = { T: this.score.CT, CT: this.score.T }; this.loss = { T: this.loss.CT, CT: this.loss.T };
      this.bcast({ type: 'chaos', k, sc: this.score });
    } else if (k === 'walls') this.chaosWalls(rand(1, 4));
    else if (k === 'jam') {
      const s = Math.random() < 0.5 ? 1 : 2, t = rand(6, 14);
      this.jam = { s, until: now + t * 1000 };
      this.bcast({ type: 'chaos', k, s, t });
    } else if (k === 'swap') this.permute();
    else if (k === 'invert') { const t = rand(5, 10); this.inv = now + t * 1000; this.bcast({ type: 'chaos', k, t }); }
  }

  // des T et des CT (1 paire, parfois 2) échangent leur camp jusqu'à la fin de la manche
  chaosTeams(T, C) {
    const pairs = Math.min(T.length, C.length, Math.random() < 0.7 ? 1 : 2);
    const a = shuffled(T).slice(0, pairs), b = shuffled(C).slice(0, pairs), who = a.concat(b);
    who.forEach((p) => { if (!p.home) p.home = p.team; p.team = p.team === 'T' ? 'CT' : 'T'; p.act = null; p.pg = 0; });
    const bm = this.bomb;
    const carrier = a.find((p) => bm.s === 'carried' && bm.c === p.id);
    if (carrier) { bm.s = 'dropped'; bm.c = null; bm.x = carrier.x; bm.y = 0; bm.z = carrier.z; }
    this.bcast({ type: 'chaos', k: 'teams', ids: who.map((p) => p.id), ns: who.map((p) => p.name) });
  }

  // n murs disparaissent ou réapparaissent (jamais sur un joueur, la bombe ou une arme au sol)
  chaosWalls(n) {
    const boxes = this.map.boxes, bm = this.bomb;
    const under = (b) => {
      const inB = (x, z, m) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m;
      return this.all().some((p) => p.alive && inB(p.x, p.z, 0.6)) || ((bm.s === 'planted' || bm.s === 'dropped') && inB(bm.x, bm.z, 1)) || this.drops.some((d) => inB(d.x, d.z, 0.3)) || this.gren.some((g) => inB(g.x, g.z, 0.3));
    };
    let on = 0, off = 0;
    for (const i of shuffled(phaseBoxes(this.map))) {
      if (on + off >= n) break;
      if (this.hidden.has(i)) { if (!under(boxes[i])) { this.hidden.delete(i); on++; } }
      else { this.hidden.add(i); off++; }
    }
    this.bcast({ type: 'chaos', k: 'walls', hb: Array.from(this.hidden), on, off });
  }

  // permutation : des joueurs vivants tirés au sort (au moins 2, parfois tous) prennent la place d'un autre
  // (position, regard, posture). Permutation en un seul cycle (Sattolo) : aucun d'eux ne reste à sa place.
  permute() {
    const alive = shuffled(this.all().filter((p) => p.alive));
    if (alive.length < 2) return;
    const list = alive.slice(0, Math.random() < 0.5 ? alive.length : 2 + Math.floor(Math.random() * (alive.length - 1)));
    const spots = list.map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, c: p.c, n: p.name }));
    const idx = list.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * i); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    list.forEach((p, i) => {
      const d = spots[idx[i]];
      p.x = d.x; p.y = d.y; p.z = d.z; p.yaw = d.yaw; p.c = d.c; p.act = null; p.pg = 0;
      p.tp = (p.tp || 0) + 1;   // les positions envoyées avant la téléportation sont ignorées
      send(p.ws, { type: 'tp', x: r2(d.x), y: r2(d.y), z: r2(d.z), yaw: r2(d.yaw), c: d.c, s: p.tp, n: d.n });
    });
    this.bcast({ type: 'chaos', k: 'swap', n: list.length, all: list.length === alive.length ? 1 : 0 });
  }

  // MVP de la manche : celui qui a posé / désamorcé, sinon le meilleur tueur du camp vainqueur
  pickMvp(winner, hero) {
    let m = hero ? this.players.get(hero) : null;
    if (!m) {
      const c = this.team(winner).filter((p) => p.rk > 0).sort((a, b) => b.rk - a.rk || (b.alive ? 1 : 0) - (a.alive ? 1 : 0));
      m = c[0] || null;
    }
    if (m) m.mv++;
    return m;
  }

  endRound(winner, reason, hero) {
    if (this.phase !== 'live' || this.practice) return;
    const loser = winner === 'T' ? 'CT' : 'T';
    this.score[winner]++;
    this.loss[winner] = 0;
    this.loss[loser] = Math.min(this.loss[loser] + 1, 4);
    const win = 3250 + (reason === 'bomb' ? 250 : 0);
    const lose = 1400 + 500 * (this.loss[loser] - 1);
    this.all().forEach((p) => {
      if (!p.team) return;
      p.survived = p.alive;
      const gain = p.team === winner ? win : (this.started[p.team] > 0 ? lose : 0);
      p.money = Math.min(CFG.maxMoney, p.money + gain);
    });
    this.phase = 'end';
    this.phaseEnd = Date.now() + CFG.end * 1000;
    const winTarget = CFG.maxRounds / 2 + 1;
    const over = this.score[winner] >= winTarget;
    const mvp = this.pickMvp(winner, hero);
    // statistiques des comptes et XP du pass (une manche ne compte que s'il y avait des adversaires)
    const real = this.started.T > 0 && this.started.CT > 0, G = PASS.gain;
    this.all().forEach((p) => {
      if (!p.acc || !p.team) return;
      const d = { rounds: 1, roundWins: p.team === winner ? 1 : 0, mvp: mvp === p ? 1 : 0 };
      if (over) { d.matches = 1; d.matchWins = p.team === winner ? 1 : 0; }
      p.lv = Acc.stat(p.acc, d);
      if (real) this.passGain(p, G.round + d.roundWins * G.roundWin + d.mvp * G.mvp + (over ? G.match + d.matchWins * G.matchWin : 0));
    });
    this.bcast({ type: 'rend', w: winner, r: reason, sc: this.score, over: over ? 1 : 0, mvp: mvp ? { i: mvp.id, n: mvp.name, k: mvp.rk, h: hero && mvp.id === hero ? 1 : 0 } : null });
    if (over) { this.phase = 'match'; this.phaseEnd = Date.now() + 10000; }
  }

  // XP du pass de combat (parties en ligne seulement) ; prévient le joueur quand il passe un palier
  passGain(p, x) {
    if (!p.acc || this.practice || !(x > 0)) return;
    const r = Acc.pass(p.acc, x);
    send(p.ws, { type: 'bpx', x, xp: r.xp });
    r.up.forEach((t) => send(p.ws, { type: 'bp', t, sk: PASS.tiers[t - 1].skin }));
  }

  checkEnd(now) {
    if (this.phase !== 'live' || this.practice) return;
    const aT = this.alive('T').length, aC = this.alive('CT').length, b = this.bomb;
    if (b.s === 'planted') {
      if (this.started.CT > 0 && aC === 0) this.endRound('T', 'elim');
    } else {
      if (this.started.T > 0 && aT === 0) this.endRound('CT', 'elim');
      else if (this.started.CT > 0 && aC === 0) this.endRound('T', 'elim');
      else if (now >= this.phaseEnd) this.endRound('CT', 'time');
    }
  }

  /* ---------- combat ---------- */
  killPlayer(v, k, wid, hs) {
    if (!v.alive) return;
    v.alive = false; v.hp = 0; v.d++; v.act = null; v.pg = 0; v.diedAt = Date.now();
    const held = v.inv.primary || v.inv.secondary;
    if (held && !this.practice) this.dropWeapon(v, held, 0.6);   // entraînement : on garde ses armes
    if (this.bomb.s === 'carried' && this.bomb.c === v.id) {
      this.bomb.s = 'dropped'; this.bomb.c = null; this.bomb.x = v.x; this.bomb.y = 0; this.bomb.z = v.z;
    }
    let rk = 0, fb = 0, ace = 0;
    if (k && k !== v) {
      k.k++;
      const w = WEAPONS[wid];
      k.money = Math.min(CFG.maxMoney, k.money + (w ? w.kill : 300));
      rk = ++k.rk;
      if (!this.firstBlood) { this.firstBlood = true; fb = 1; }
      // ACE : il a éliminé toute l'équipe adverse (5 sur 5, ou tous les adversaires si moins de 5, au moins 3)
      const foes = this.started[v.team] || 0;
      if (foes >= 3 && rk >= Math.min(5, foes)) { ace = 1; k.ac++; }
      if (k.acc && !this.practice) k.lv = Acc.stat(k.acc, { kills: 1, hs: hs ? 1 : 0, aces: ace });
      if (k.team !== v.team) {
        this.passGain(k, PASS.gain.kill + (hs ? PASS.gain.hs : 0) + ace * PASS.gain.ace);
        // maîtrise de l'arme utilisée
        if (k.acc && !this.practice && WEAPONS[wid]) {
          const G = MASTERY.gain, r = Acc.mastery(k.acc, wid, (wid === 'knife' ? G.knife : G.kill) + (hs ? G.hs : 0));
          r.up.forEach((l) => { const rw = MASTERY.rewards.find((x) => x.lv === l); send(k.ws, { type: 'ms', w: wid, lv: l, sk: rw ? wid + '_' + rw.k : '' }); });
        }
      }
    }
    if (v.acc && !this.practice) v.lv = Acc.stat(v.acc, { deaths: 1 });
    this.bcast({ type: 'kill', k: k ? k.id : 0, v: v.id, w: wid || 'bomb', hs: hs ? 1 : 0, rk, fb, ace });
  }

  onHit(sh, m) {
    const t = this.players.get(num(m.t));
    if (!t || !sh.alive || !t.alive || sh.id === t.id || sh.team === t.team) return;
    if (this.phase !== 'live' || this.mode === 'range') return;   // stand de tir : pas de combat entre joueurs
    const wid = sh.inv.cur, w = WEAPONS[wid];
    if (!w) return;
    const now = Date.now();
    if (this.jam && now < this.jam.until && w.slot === this.jam.s) return;   // arme bloquée
    // anti-triche : chaque touche doit suivre un tir accepté (au plus une cible par plomb), sans mur infranchissable entre les deux
    const s = sh.shot;
    if (!s || now - s.t > 450 || s.w !== wid || s.n <= 0) return;
    if (!this.losOk(sh, t, w)) { this.flag(sh, 'tir à travers les murs', now, 0.5); return; }
    s.n--;
    // une balle par cible : un tir de chevrotine peut toucher plusieurs joueurs
    const last = sh.lastHit.get(t.id) || 0;
    if (now - last < w.rof * 1000 * 0.6) return;
    sh.lastHit.set(t.id, now);
    const dist = Math.hypot(sh.x - t.x, sh.z - t.z);
    if (dist > w.range + 3) return;
    // zones touchées : { h: nb, c: nb, s: nb, a: nb, l: nb } (plombs ou balle unique)
    const z = m.z && typeof m.z === 'object' ? m.z : { c: 1 };
    let left = w.pellets || 1, dmg = 0, hs = false;
    const ar0 = t.armor;
    const pen = Math.max(0, Math.min(3, num(m.p) | 0));
    const base = w.dmg * Math.pow(w.fall, dist / 25) * Math.pow(CFG.penLoss, pen);
    for (const k of ['h', 'c', 's', 'a', 'l']) {
      const n = Math.min(left, Math.max(0, num(z[k]) | 0));
      if (!n) continue;
      left -= n;
      let d = base * n * (k === 'h' ? w.hs : ZONES[k]);
      if (k === 'h') hs = hs || !w.pellets;
      if (k === 'h' && t.helmet) d *= 1 - (1 - CFG.armorHead) * (1 - w.ap);   // casque
      else if (k !== 'h' && k !== 'l') {                                      // gilet : il s'use et finit par casser
        const r = armorHit(d, t.armor, 1 - (1 - CFG.armorBody) * (1 - w.ap));
        d = r.d; t.armor = r.armor;
      }
      dmg += d;
    }
    if (dmg <= 0) return;
    const broke = ar0 > 0 && t.armor <= 0 ? 1 : 0;   // le gilet vient de casser
    dmg = Math.round(dmg);
    if (!this.god(t)) t.hp -= dmg;
    send(sh.ws, { type: 'hitc', hs: hs ? 1 : 0, kill: t.hp <= 0 ? 1 : 0, ab: broke });
    send(t.ws, { type: 'hurt', dx: r2(sh.x - t.x), dz: r2(sh.z - t.z), dmg, hs: hs ? 1 : 0, ab: broke });
    if (t.hp <= 0) { this.killPlayer(t, sh, wid, hs); this.checkEnd(now); }
  }

  buy(p, item) {
    const now = Date.now();
    const P = this.practice;   // entraînement : boutique toujours ouverte, gratuite, armes des deux camps
    const open = p.alive && (P || this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000));
    if (!open) return;
    const can = (c) => P || p.money >= c, pay = (c) => { if (!P) p.money -= c; };
    if (item === 'armor') {
      if (p.armor >= 100 || !can(650)) return;
      pay(650); p.armor = 100; return;
    }
    if (item === 'helmet') { // gilet + casque (350 si on a déjà le gilet)
      const cost = p.armor >= 100 ? 350 : 1000;
      if (p.helmet || !can(cost)) return;
      pay(cost); p.armor = 100; p.helmet = true; return;
    }
    if (item === 'kit') {
      if ((p.team !== 'CT' && !P) || p.kit || !can(400)) return;
      pay(400); p.kit = true; return;
    }
    if (GREN[item]) {
      const gd = GREN[item];
      if (!can(gd.price) || p.g[item] >= gd.max || this.gTotal(p) >= CFG.grenTotal) return;
      pay(gd.price); p.g[item]++; return;
    }
    const w = WEAPONS[item];
    if (!w || w.slot === 3 || (w.price <= 0 && !P)) return;
    if (w.team && w.team !== p.team && !P) return;
    if (!can(w.price)) return;
    const held = w.slot === 1 ? p.inv.primary : p.inv.secondary;
    if (held === item) return;                 // déjà en main : on ne paie pas deux fois
    pay(w.price);
    if (held && !P) this.dropWeapon(p, held, 0.9);   // l'ancienne arme tombe au sol
    if (held && P) delete p.am[held];                // entraînement : elle est simplement remplacée
    if (w.slot === 1) p.inv.primary = item; else p.inv.secondary = item;
    p.inv.cur = item;
    delete p.am[item];                         // arme neuve : munitions pleines
    if (!P) p.bought[item] = w.price;          // achetée à cette manche : revendable tant que la boutique est ouverte
  }

  // revente d'une arme achetée pendant cette manche (remboursement intégral)
  sell(p, item) {
    const now = Date.now();
    const open = p.alive && (this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000));
    if (!open || !p.bought || !p.bought[item]) return;
    if (p.inv.primary !== item && p.inv.secondary !== item) return;
    p.money = Math.min(CFG.maxMoney, p.money + p.bought[item]);
    delete p.bought[item]; delete p.am[item];
    if (p.inv.primary === item) p.inv.primary = null; else p.inv.secondary = null;
    if (p.inv.cur === item) p.inv.cur = p.inv.primary || p.inv.secondary || 'knife';
  }

  /* ---------- grenades ---------- */
  gTotal(p) { return p.g.flash + p.g.smoke + p.g.he + p.g.molo; }

  // le segment a->b traverse-t-il un obstacle ? (volumes du sol à leur hauteur, un peu réduits)
  segBlocked(ax, ay, az, bx, by, bz) {
    const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
    for (const b of this.solid()) {
      const lo = [b.x - b.w / 2 + 0.04, 0, b.z - b.d / 2 + 0.04], hi = [b.x + b.w / 2 - 0.04, b.h - 0.04, b.z + b.d / 2 - 0.04];
      let t0 = 0, t1 = 1, hit = true;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { hit = false; break; } continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const q = a; a = c; c = q; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  }

  // volume le plus haut qui touche la sphère de la grenade en (x, y, z)
  gOverlap(x, y, z, r) {
    let best = null;
    for (const b of this.solid()) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r && y - r < b.h && (!best || b.h > best.h)) best = b;
    }
    return best;
  }

  throwGren(p, m, now) {
    if (!p.alive || this.phase !== 'live') return;
    const k = m.k, def = GREN[k];
    if (!def || !(p.g[k] > 0) || now - p.lastThrow < 450 || this.gren.length >= 40) return;
    if (!Array.isArray(m.d)) return;
    const d = m.d.slice(0, 3).map((v) => num(v));
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (dl < 0.5) return;
    d[0] /= dl; d[1] /= dl; d[2] /= dl;
    p.lastThrow = now;
    const soft = m.s ? 1 : 0;
    const ox = p.x, oy = p.y + (p.c ? CFG.eyeCrouch : CFG.eye) - 0.15, oz = p.z;
    let sx = ox + d[0] * 0.45, sy = oy + d[1] * 0.45, sz = oz + d[2] * 0.45;
    if (this.segBlocked(ox, oy, oz, sx, sy, sz) || this.gOverlap(sx, sy, sz, GR)) { sx = ox; sy = oy; sz = oz; }
    sy = Math.max(sy, GR + 0.02);
    // arc : on relève un peu le tir, vitesse plus faible pour un lancer court
    const sp = soft ? 8.5 : 19, up = soft ? 0.32 : 0.15;
    let ux = d[0], uy = d[1] + up, uz = d[2];
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    // le mouvement du joueur s'ajoute un peu (lancer en courant)
    let mvx = 0, mvz = 0;
    if (Array.isArray(m.v)) { mvx = num(m.v[0]); mvz = num(m.v[1]); const ml = Math.hypot(mvx, mvz); if (ml > 7) { mvx *= 7 / ml; mvz *= 7 / ml; } }
    const g = { i: this.nextG++, k, owner: p.id, x: sx, y: sy, z: sz, vx: ux * sp + mvx * 0.7, vy: uy * sp, vz: uz * sp + mvz * 0.7, at: now + def.fuse * 1000 };
    this.gren.push(g);
    if (!(this.mode === 'sandbox' && p.opt && p.opt.infN)) p.g[k]--;   // zone de test : grenades illimitées
    if (p.inv.cur === k && p.g[k] <= 0) p.inv.cur = p.inv.primary || p.inv.secondary || 'knife';
    this.bcast({ type: 'throw', id: p.id, k, x: r2(sx), y: r2(sy), z: r2(sz) }, p.id);
  }

  // un pas de physique : gravité, rebonds sur les murs, caisses et le sol. Renvoie vrai si la grenade touche le sol / un dessus
  stepGren(g, dt) {
    let floor = false;
    g.vy -= 20 * dt;
    const nx = g.x + g.vx * dt;
    if (this.gOverlap(nx, g.y, g.z, GR)) { g.vx *= -0.42; g.vz *= 0.85; } else g.x = nx;
    const nz = g.z + g.vz * dt;
    if (this.gOverlap(g.x, g.y, nz, GR)) { g.vz *= -0.42; g.vx *= 0.85; } else g.z = nz;
    let ny = g.y + g.vy * dt, landed = false;
    const b = this.gOverlap(g.x, ny, g.z, GR);
    if (b) {
      if (g.vy < 0 && g.y - GR >= b.h - 0.06) { ny = b.h + GR; landed = true; }
      else { ny = g.y; g.vy *= -0.3; }
    } else if (ny < GR) { ny = GR; landed = true; }
    g.y = ny;
    if (landed) {
      floor = true;
      if (g.vy < -1.5) { g.vy = -g.vy * 0.4; g.vx *= 0.7; g.vz *= 0.7; }
      else {
        g.vy = 0;
        const f = Math.max(0, 1 - 4 * dt); g.vx *= f; g.vz *= f;
        if (Math.hypot(g.vx, g.vz) < 0.25) { g.vx = 0; g.vz = 0; }
      }
    }
    g.x = Math.max(-this.map.hx + 0.4, Math.min(this.map.hx - 0.4, g.x)); g.z = Math.max(-this.map.hz + 0.4, Math.min(this.map.hz - 0.4, g.z));
    return floor;
  }

  tickGren(now) {
    const steps = Math.max(1, Math.round(CFG.tick / 10));
    for (const g of this.gren.slice()) {
      let floor = false;
      for (let i = 0; i < steps; i++) if (this.stepGren(g, 0.01)) floor = true;
      if (now >= g.at || (g.k === 'molo' && floor && now - (g.at - GREN.molo.fuse * 1000) > 120)) this.detonate(g, now);
    }
    // zones : fumée et feu
    for (const z of this.zones.slice()) {
      if (now >= z.until) { this.zones.splice(this.zones.indexOf(z), 1); continue; }
      if (z.k !== 'fire' || this.phase !== 'live' || now < z.next) continue;
      z.next = now + CFG.fireTick * 1000;
      const owner = this.players.get(z.owner) || null;
      let any = false;
      this.all().forEach((t) => {
        if (!t.alive || (owner && t.team === owner.team && t.id !== owner.id)) return;
        if (this.mode === 'range' && owner && t !== owner) return;
        if (Math.hypot(t.x - z.x, t.z - z.z) > z.r || Math.abs(t.y - z.y) > 2.2) return;
        if (this.segBlocked(z.x, z.y + 0.5, z.z, t.x, t.y + 0.5, t.z)) return;
        if (!this.god(t)) t.hp -= CFG.fireDmg;
        send(t.ws, { type: 'hurt', dx: 0, dz: 0, dmg: CFG.fireDmg, hs: 0, fire: 1 });
        any = true;
        if (t.hp <= 0) this.killPlayer(t, owner, 'molo', false);
      });
      if (any) this.checkEnd(now);
    }
  }

  detonate(g, now) {
    const i = this.gren.indexOf(g);
    if (i >= 0) this.gren.splice(i, 1);
    const owner = this.players.get(g.owner) || null;
    const x = r2(g.x), y = r2(Math.max(g.y, 0.15)), z = r2(g.z);
    this.bcast({ type: 'gev', e: 'pop', k: g.k, x, y, z });
    if (g.k === 'flash') this.popFlash(g);
    else if (g.k === 'he') this.popHE(g, owner, now);
    else if (g.k === 'smoke') {
      // la fumée éteint les feux proches
      this.zones = this.zones.filter((q) => !(q.k === 'fire' && Math.hypot(q.x - g.x, q.z - g.z) < CFG.smokeRadius + 1.2));
      this.zones.push({ i: this.nextG++, k: 'smoke', x, y, z, r: CFG.smokeRadius, until: now + CFG.smokeTime * 1000, owner: g.owner });
    } else if (g.k === 'molo') {
      const gy = this.groundY(g.x, g.z, g.y);
      this.zones.push({ i: this.nextG++, k: 'fire', x, y: r2(gy), z, r: CFG.fireRadius, until: now + CFG.fireTime * 1000, next: now + 200, owner: g.owner });
    }
  }

  // aveuglement : dépend de la distance, de la vue directe et de la direction du regard
  popFlash(g) {
    this.all().forEach((t) => {
      if (!t.alive) return;
      const ex = t.x, ey = t.y + (t.c ? CFG.eyeCrouch : CFG.eye), ez = t.z;
      const dx = g.x - ex, dy = g.y - ey, dz = g.z - ez, dist = Math.hypot(dx, dy, dz);
      if (dist > CFG.flashRange) return;
      if (this.segBlocked(g.x, Math.max(g.y, 0.2), g.z, ex, ey, ez)) return;
      const cp = Math.cos(t.pitch);
      const fx = -Math.sin(t.yaw) * cp, fy = Math.sin(t.pitch), fz = -Math.cos(t.yaw) * cp;
      const dot = dist > 0.01 ? (fx * dx + fy * dy + fz * dz) / dist : 1;
      const f = (dot + 1) / 2, face = 0.14 + 0.86 * f * f;
      const total = 5.0 * face * Math.pow(1 - dist / CFG.flashRange, 0.8);
      if (total < 0.3) return;
      send(t.ws, { type: 'blind', w: r2(total * 0.42), t: r2(total) });
    });
  }

  // fragmentation : dégâts selon la distance, arrêtés par les murs, pas de tir allié (mais on se blesse soi-même)
  popHE(g, owner, now) {
    if (this.phase !== 'live') return;
    const R = CFG.heRadius;
    this.all().forEach((t) => {
      if (!t.alive || (owner && t.team === owner.team && t.id !== owner.id)) return;
      if (this.mode === 'range' && owner && t !== owner) return;
      const cy = t.y + (t.c ? 0.7 : 1.0);
      const d = Math.hypot(g.x - t.x, g.y - cy, g.z - t.z);
      if (d > R) return;
      if (this.segBlocked(g.x, Math.max(g.y, 0.2), g.z, t.x, cy, t.z)) return;
      let dmg = CFG.heDmg * Math.pow(1 - d / R, 1.25);
      const ar0 = t.armor, ah = armorHit(dmg, t.armor, CFG.armorBody);
      dmg = Math.round(ah.d);
      if (dmg < 1) return;
      t.armor = ah.armor;
      const broke = ar0 > 0 && t.armor <= 0 ? 1 : 0;
      if (!this.god(t)) t.hp -= dmg;
      send(t.ws, { type: 'hurt', dx: r2(g.x - t.x), dz: r2(g.z - t.z), dmg, hs: 0, ab: broke });
      if (owner && owner !== t) send(owner.ws, { type: 'hitc', hs: 0, kill: t.hp <= 0 ? 1 : 0 });
      if (t.hp <= 0) this.killPlayer(t, owner, 'he', false);
    });
    this.checkEnd(now);
  }

  // la bombe est posée 0,55 m devant le joueur (à ses pieds si un mur gêne)
  bombSpot(p) {
    const x = p.x - Math.sin(p.yaw) * 0.55, z = p.z - Math.cos(p.yaw) * 0.55;
    const inWall = this.solid().some((b) => b.h > 0.4 && Math.abs(x - b.x) < b.w / 2 + 0.15 && Math.abs(z - b.z) < b.d / 2 + 0.15);
    return inWall ? { x: p.x, z: p.z } : { x, z };
  }

  /* ---------- boucle ---------- */
  tick() {
    const now = Date.now();
    if (this.players.size === 0) { clearInterval(this.timer); rooms.delete(this.name); return; }

    if (this.phase === 'wait') {
      if (!this.lobby) { if (this.players.size >= CFG.minPlayers) this.startRound(); }
      else {   // lobby : compte à rebours de 5 s quand tous les joueurs sont prêts
        const all = this.all();
        if (all.length >= CFG.minPlayers && all.every((q) => q.ready)) {
          if (!this.lobbyAt) this.lobbyAt = now + 5000;
          if (now >= this.lobbyAt) { this.lobbyAt = 0; this.startRound(); }
        } else this.lobbyAt = 0;
      }
    } else if (this.phase === 'freeze') {
      this.autoPickup();
      if (now >= this.phaseEnd) {
        this.phase = 'live'; this.liveStart = now; this.phaseEnd = now + CFG.live * 1000;
        if (this.mode === 'desordre') this.planChaos(now); else this.chaosQ = [];
      }
    } else if (this.phase === 'live') {
      this.tickLive(now);
      this.tickGren(now);
    } else if (this.phase === 'end') {
      this.tickGren(now);
      this.autoPickup(); // le dernier kill termine la manche : son arme reste à prendre
      if (now >= this.phaseEnd) this.startRound();
    } else if (this.phase === 'match') {
      if (now >= this.phaseEnd) this.resetMatch();
    }
    this.snapshot(now);
  }

  tickLive(now) {
    if (this.mode === 'desordre') this.tickChaos(now);   // désordre éventuel de la manche
    if (this.practice) this.tickPractice(now);
    const b = this.bomb;
    this.autoPickup();
    // ramassage de la bombe
    if (b.s === 'dropped') {
      for (const p of this.alive('T')) {
        if (Math.hypot(p.x - b.x, p.z - b.z) < 1.6) { b.s = 'carried'; b.c = p.id; break; }
      }
    }
    // actions (poser / désamorcer)
    this.players.forEach((p) => {
      if (!p.act) { p.pg = 0; return; }
      const a = p.act;
      const moved = Math.hypot(p.x - a.x, p.z - a.z);
      if (!p.alive || moved > 0.8) { p.act = null; p.pg = 0; return; }
      if (a.type === 'plant') {
        const ok = p.team === 'T' && b.s === 'carried' && b.c === p.id;
        if (!ok) { p.act = null; p.pg = 0; return; }
        p.pg = (now - a.t) / (CFG.plant * 1000);
        if (p.pg >= 1) {
          const SITES = this.map.sites;
          const site = Object.keys(SITES).find((k) => Math.hypot(p.x - SITES[k].x, p.z - SITES[k].z) <= SITES[k].r);
          if (!site) { p.act = null; p.pg = 0; return; }
          const bp = this.bombSpot(p);
          b.s = 'planted'; b.c = null; b.by = p.id; b.x = bp.x; b.y = 0; b.z = bp.z; b.site = site; b.at = now + CFG.bombTime * 1000;
          p.money = Math.min(CFG.maxMoney, p.money + 300);
          p.act = null; p.pg = 0;
          this.bcast({ type: 'msg', text: 'La bombe a été posée sur le site ' + site, kind: 'bomb' });
        }
      } else if (a.type === 'defuse') {
        const ok = p.team === 'CT' && b.s === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < 2.4;
        if (!ok) { p.act = null; p.pg = 0; return; }
        const dur = (p.kit ? CFG.defuseKit : CFG.defuse) * 1000;
        p.pg = (now - a.t) / dur;
        if (p.pg >= 1) {
          b.s = 'defused'; p.act = null; p.pg = 0;
          this.bcast({ type: 'msg', text: 'La bombe a été désamorcée', kind: 'bomb' });
          if (this.practice) this.bombReset = now + 3000; else this.endRound('CT', 'defuse', p.id);
        }
      }
    });
    if (this.phase !== 'live') return;
    // explosion
    if (b.s === 'planted' && now >= b.at) {
      b.s = 'exploded';
      this.all().forEach((p) => {
        if (!p.alive || this.god(p)) return;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < 12) this.killPlayer(p, null, 'bomb', false);
        else if (d < 25) { p.hp -= Math.round(150 * (1 - (d - 12) / 13)); if (p.hp <= 0) this.killPlayer(p, null, 'bomb', false); }
      });
      if (this.practice) { this.bombReset = now + 4000; this.msg('La bombe a explosé · la zone de test continue', 'bomb'); return; }
      this.endRound('T', 'bomb', b.by);
      return;
    }
    this.checkEnd(now);
  }

  /* ---------- entraînement (stand de tir, zone de test) ---------- */
  tickPractice(now) {
    this.all().forEach((p) => {
      p.money = CFG.maxMoney;
      if (!p.alive && p.team && now - (p.diedAt || 0) > 3000) this.spawnPlayer(p, this.spawnN++);   // réapparition après 3 s
    });
    if (this.bombReset && now >= this.bombReset) { this.bomb = { s: 'none', x: 0, y: 0, z: 0, c: null, site: '', at: 0 }; this.bombReset = 0; }
  }
  // commandes du panneau de la zone de test
  sandbox(p, m) {
    const a = m.a, bm = this.bomb;
    const dropBomb = () => { if (bm.s === 'carried' && bm.c === p.id) { bm.s = 'dropped'; bm.c = null; bm.x = p.x; bm.y = 0; bm.z = p.z; } };
    if (a === 'team' && (m.team === 'T' || m.team === 'CT') && m.team !== p.team) {
      p.team = m.team; p.home = null; p.act = null; p.pg = 0;
      if (p.team !== 'T') dropBomb();
      // le pistolet de départ suit le camp
      const base = this.defaultSecondary(p.team);
      if (p.inv.secondary === 'glock' || p.inv.secondary === 'usp') {
        const old = p.inv.secondary; p.inv.secondary = base; delete p.am[old];
        if (p.inv.cur === old) p.inv.cur = base;
      }
    } else if (a === 'heal') { if (p.alive) { p.hp = 100; p.armor = 100; p.helmet = true; } }
    else if (a === 'respawn') this.spawnPlayer(p, this.spawnN++);
    else if (a === 'tp') {
      if (!p.alive) return;
      p.x = Math.max(-this.map.hx + 0.5, Math.min(this.map.hx - 0.5, num(m.x))); p.z = Math.max(-this.map.hz + 0.5, Math.min(this.map.hz - 0.5, num(m.z))); p.y = Math.max(0, Math.min(22, num(m.y)));
      p.yaw = num(m.yaw, p.yaw); p.act = null; p.pg = 0; p.tp = (p.tp || 0) + 1;
      send(p.ws, { type: 'tp', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), c: 0, s: p.tp, n: '' });
    } else if (a === 'bomb') {
      if (!p.alive) return;
      if (p.team !== 'T') this.sandbox(p, { a: 'team', team: 'T' });
      this.bomb = { s: 'carried', x: p.x, y: 0, z: p.z, c: p.id, site: '', at: 0 }; this.bombReset = 0;
    } else if (a === 'map' && typeof m.map === 'string' && MAPS[m.map] && MAPS[m.map] !== this.map) {
      this.map = MAPS[m.map]; this.hidden = new Set(); this.jam = null; this.inv = 0;
      this.drops = []; this.dropsDirty = true; this.gren = []; this.zones = [];
      this.bomb = { s: 'none', x: 0, y: 0, z: 0, c: null, site: '', at: 0 }; this.bombReset = 0;
      this.all().forEach((q) => { if (q.team) this.spawnPlayer(q, this.spawnN++); });
      this.msg('Carte : ' + this.map.name, 'info');
    } else if (a === 'chaos') {
      const now = Date.now(), rand = (x, y) => x + Math.floor(Math.random() * (y - x + 1));
      if (m.k === 'walls') { if (phaseBoxes(this.map).length) this.chaosWalls(rand(1, 4)); }
      else if (m.k === 'jam') { const s = m.s === 2 ? 2 : 1, t = rand(6, 14); this.jam = { s, until: now + t * 1000 }; this.bcast({ type: 'chaos', k: 'jam', s, t }); }
      else if (m.k === 'invert') { const t = rand(5, 10); this.inv = now + t * 1000; this.bcast({ type: 'chaos', k: 'invert', t }); }
      else if (m.k === 'restore') { this.hidden = new Set(); this.jam = null; this.inv = 0; this.bcast({ type: 'chaos', k: 'restore', hb: [] }); }
    } else if (a === 'clear') { this.gren = []; this.zones = []; this.drops = []; this.dropsDirty = true; }
  }

  snapshot(now) {
    const b = this.bomb;
    let te;
    if (this.phase === 'live' && b.s === 'planted') te = Math.max(0, (b.at - now) / 1000);
    else te = Math.max(0, (this.phaseEnd - now) / 1000);
    const pl = this.all().map((p) => ({
      i: p.id, n: p.name, t: p.team, x: r2(p.x), y: r2(p.y), z: r2(p.z), r: r2(p.yaw), p: r2(p.pitch),
      c: p.c, w: p.inv.cur, a: p.alive ? 1 : 0, rdy: p.ready ? 1 : 0, k: p.k, d: p.d, h: p.helmet ? 1 : 0, l: p.rl ? 1 : 0,
      q: p.act ? (p.act.type === 'plant' ? 1 : 2) : 0, g: p.act ? r2(Math.min(1, p.pg || 0)) : 0, kt: p.kit ? 1 : 0, ac: p.ac, mv: p.mv,
      vf: p.acc ? 1 : 0, lv: p.lv || 0, sk: (p.eq && p.eq[p.inv.cur]) || undefined
    }));
    const buyOpen = this.practice || this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000);
    const common = {
      type: 'snap', mp: this.map.id, ph: this.phase, te: r2(te), rd: this.round, sc: this.score,
      hf: this.round > CFG.maxRounds / 2 ? 1 : 0, md: this.mode === 'desordre' ? 1 : 0, pm: this.practice ? this.mode : '', hb: Array.from(this.hidden),
      jm: this.jam && now < this.jam.until ? { s: this.jam.s, t: r2((this.jam.until - now) / 1000) } : 0,
      iv: now < this.inv ? r2((this.inv - now) / 1000) : 0,
      b: { s: b.s, x: r2(b.x), y: r2(b.y), z: r2(b.z), c: b.c, site: b.site }, pl,
      gr: this.gren.map((g) => ({ i: g.i, k: g.k, x: r2(g.x), y: r2(g.y), z: r2(g.z), vx: r2(g.vx), vy: r2(g.vy), vz: r2(g.vz) })),
      zn: this.zones.map((z) => ({ i: z.i, k: z.k, x: z.x, y: z.y, z: z.z, r: z.r, l: r2(Math.max(0, (z.until - now) / 1000)) }))
    };
    if (this.lobby) { common.lb = 1; common.ho = this.host; common.lc = this.lobbyAt ? r2(Math.max(0, (this.lobbyAt - now) / 1000)) : 0; }
    // armes au sol : à chaque changement, et chaque seconde pour ceux qui arrivent
    if (this.dropsDirty || ++this.snapN >= 20) {
      common.dp = this.drops.map((d) => ({ i: d.i, w: d.w, x: d.x, y: d.y, z: d.z, r: d.r, ox: d.ox, oy: d.oy, oz: d.oz, n: now - d.at < 500 ? 1 : 0, m: d.mag, s: d.res }));
      this.dropsDirty = false; this.snapN = 0;
    }
    this.players.forEach((p) => {
      common.me = {
        hp: Math.max(0, p.hp), tp: p.tp || 0, ar: Math.round(p.armor), he: p.helmet ? 1 : 0, mo: p.money, p: p.inv.primary, s: p.inv.secondary,
        k: p.kit ? 1 : 0, bm: b.s === 'carried' && b.c === p.id ? 1 : 0, pg: r2(Math.min(1, p.pg || 0)),
        al: p.alive ? 1 : 0, bo: buyOpen && p.alive ? 1 : 0, t: p.team, g: p.g,
        sl: buyOpen && p.alive ? Object.keys(p.bought).filter((id) => p.inv.primary === id || p.inv.secondary === id) : []
      };
      send(p.ws, common);
    });
  }

  /* ---------- messages client ---------- */
  onMessage(p, m) {
    const now = Date.now();
    switch (m.type) {
      case 'st': {
        if (now - p.lastSt < 25) return;
        p.lastSt = now;
        // message parti avant une permutation : ancienne position, on l'ignore
        const stale = (p.tp || 0) !== (num(m.tp) | 0);
        if (!stale) { p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.c = m.c ? 1 : 0; }
        p.rl = m.rl ? 1 : 0;
        if (typeof m.w === 'string' && (m.w === p.inv.primary || m.w === p.inv.secondary || m.w === 'knife' || (GREN[m.w] && p.g[m.w] > 0))) p.inv.cur = m.w;
        this.reloadTick(p, !!m.rl, now);
        if (m.w === p.inv.cur) this.noteAmmo(p, m.am, now); // sinon : message parti avant un échange d'arme
        if (!p.alive || this.phase === 'freeze' || stale || now - (p.spawnT || 0) < 300) return;
        const HX = this.map.hx, HZ = this.map.hz;
        const nx = Math.max(-HX, Math.min(HX, num(m.x, p.x))), ny = Math.max(0, Math.min(22, num(m.y, p.y))), nz = Math.max(-HZ, Math.min(HZ, num(m.z, p.z)));
        if (!this.practice && !this.moveOk(p, nx, ny, nz, now)) { this.correct(p, now); break; }
        p.x = nx; p.y = ny; p.z = nz;
        (p.hist || (p.hist = [])).push([now, nx, ny, nz, p.c]);
        while (p.hist.length && now - p.hist[0][0] > 400) p.hist.shift();
        break;
      }
      case 'shoot': {
        if (!p.alive || !Array.isArray(m.o) || !Array.isArray(m.e)) return;
        if (!this.fireOk(p, now)) return;   // trop rapide, chargeur vide ou arme bloquée : le tir ne compte pas
        this.bcast({
          type: 'shoot', id: p.id, w: p.inv.cur,
          o: m.o.slice(0, 3).map((v) => r2(num(v))), e: m.e.slice(0, 3).map((v) => r2(num(v))),
          n: Array.isArray(m.n) ? m.n.slice(0, 3).map((v) => r2(num(v))) : null,
          s: typeof m.s === 'string' ? m.s.slice(0, 8) : ''
        }, p.id);
        break;
      }
      case 'hit': this.onHit(p, m); break;
      case 'drop': {
        if (!p.alive) return;
        this.noteAmmo(p, m.am);
        if (p.inv.cur !== 'knife') this.dropWeapon(p, p.inv.cur, 1.1);
        break;
      }
      case 'buy': if (typeof m.item === 'string') this.buy(p, m.item); break;
      case 'sell': if (typeof m.item === 'string') this.sell(p, m.item); break;
      case 'throw': this.throwGren(p, m, now); break;
      case 'act': {
        if (!m.on) { p.act = null; p.pg = 0; return; }
        if (!p.alive) return;
        if (this.phase === 'freeze' || this.phase === 'end') { this.swapDrop(p); break; }
        if (this.phase !== 'live') return;
        const b = this.bomb;
        if (p.team === 'T' && b.s === 'carried' && b.c === p.id) {
          const SITES = this.map.sites;
          const inSite = Object.keys(SITES).some((k) => Math.hypot(p.x - SITES[k].x, p.z - SITES[k].z) <= SITES[k].r);
          if (inSite && p.y < 0.5) { p.act = { type: 'plant', t: now, x: p.x, z: p.z }; break; }
        } else if (p.team === 'CT' && b.s === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < 2.4) {
          p.act = { type: 'defuse', t: now, x: p.x, z: p.z };
          break;
        }
        this.swapDrop(p); // la bombe reste prioritaire sur E
        break;
      }
      case 'start': {   // l'hôte lance sans attendre que tout le monde soit prêt
        if (this.lobby && this.phase === 'wait' && p.id === this.host && this.players.size >= CFG.minPlayers) { this.lobbyAt = 0; this.startRound(); }
        break;
      }
      case 'ready': {
        if (this.lobby && this.phase === 'wait') p.ready = !!m.on;
        break;
      }
      case 'sb': if (this.mode === 'sandbox') this.sandbox(p, m); break;
      case 'opt': if (this.mode === 'sandbox') p.opt = { god: !!m.god, infN: !!m.infN }; break;
      case 'lmap': {   // l'hôte choisit la carte
        if (this.lobby && this.phase === 'wait' && p.id === this.host && typeof m.map === 'string' && MAPS[m.map] && !MAPS[m.map].practice && this.map !== MAPS[m.map]) {
          this.map = MAPS[m.map]; this.hidden = new Set(); this.all().forEach((q) => { q.ready = false; });
          this.msg('Carte : ' + this.map.name, 'info');
        }
        break;
      }
      case 'lmode': {  // l'hôte choisit le mode : bombe classique ou « rien n'est à sa place »
        const md = m.mode === 'desordre' ? 'desordre' : '';
        if (this.lobby && this.phase === 'wait' && p.id === this.host && md !== this.mode) {
          this.mode = md; this.all().forEach((q) => { q.ready = false; });
          this.msg('Mode : ' + (md ? 'Rien n\'est à sa place' : 'Bombe'), 'info');
        }
        break;
      }
      case 'kick': {   // l'hôte expulse un joueur du lobby
        if (this.lobby && this.phase === 'wait' && p.id === this.host) {
          const t = this.players.get(m.id | 0);
          if (t && t !== p) { send(t.ws, { type: 'err', text: 'Tu as été expulsé du lobby' }); try { t.ws.close(); } catch (e) {} }
        }
        break;
      }
      case 'team': {
        const want = this.chooseTeam(p, m.team);
        if (this.lobby && this.phase === 'wait') {   // dans le lobby : changement immédiat, 5 places par camp
          const side = (m.team === 'T' || m.team === 'CT') ? m.team : null;
          if (side) { if (this.team(side).filter((q) => q !== p).length < CFG.maxPlayers / 2) p.team = side; else send(p.ws, { type: 'msg', text: 'Équipe complète', kind: 'err' }); }
          else p.team = want;
          break;
        }
        if (!p.team) { p.team = want; }
        else if (want !== p.team) { p.pending = want; send(p.ws, { type: 'msg', text: 'Changement d\'équipe à la prochaine manche', kind: 'info' }); }
        break;
      }
      case 'chat': {
        if (now - p.lastChat < 600 || typeof m.text !== 'string') return;
        p.lastChat = now;
        const text = m.text.replace(/[\u0000-\u001f<>]/g, '').slice(0, 120).trim();
        if (text) this.bcast({ type: 'chat', i: p.id, n: p.name, t: p.team, x: text });
        break;
      }
    }
  }

  // munitions de l'arme en main, connues du client : on les garde pour le dépôt au sol
  noteAmmo(p, am, now) {
    now = now || Date.now();
    const id = p.inv.cur, w = WEAPONS[id];
    if (!w || !w.mag || !Array.isArray(am)) return;
    const mag = Math.max(0, Math.min(w.mag, num(am[0]) | 0)), res = Math.max(0, Math.min(w.res, num(am[1]) | 0));
    if (this.practice) { p.am[id] = [mag, res]; return; }   // entraînement : munitions libres
    const a = this.ammoOf(p, id);
    if (p.rlS) return;   // rechargement en cours : le serveur fera le compte à la fin
    // le client en annonce plus que le serveur n'en compte : munitions inventées ou désynchronisées, on corrige
    if ((mag > a[0] || res > a[1]) && now - (p.amT || 0) > 900) { p.amT = now; send(p.ws, { type: 'am', w: id, mag: a[0], res: a[1] }); }
    p.am[id] = [Math.min(mag, a[0]), Math.min(res, a[1])];
  }

  /* ---------- anti-triche : déplacement, cadence de tir, munitions, ligne de tir ---------- */
  // compteur de fautes (s'efface en une dizaine de secondes) ; trop de fautes : expulsion
  flag(p, why, now, w) {
    now = now || Date.now();
    p.vio = (p.vio || 0) * Math.exp(-(now - (p.vioT || now)) / 10000) + (w || 1); p.vioT = now;
    if (p.vio > 30 && !p.kicked) {
      p.kicked = true;
      console.log('Anti-triche : ' + p.name + ' expulsé (' + why + ') de la salle ' + this.name);
      send(p.ws, { type: 'err', text: 'Expulsé : triche détectée (' + why + ')' });
      this.msg(p.name + ' a été expulsé (triche détectée)', 'err');
      setTimeout(() => { try { p.ws.close(); } catch (e) {} }, 200);
    }
    return false;
  }
  // sol sous un joueur (avec son rayon : debout au bord d'une caisse, on est dessus)
  floorAt(x, z, y) {
    let g = 0;
    for (const b of this.solid()) if (b.h <= y + 0.3 && b.h > g && Math.abs(x - b.x) <= b.w / 2 + 0.45 && Math.abs(z - b.z) <= b.d / 2 + 0.45) g = b.h;
    return g;
  }
  // nouvelle position plausible ? vitesse (avec une réserve pour les à-coups du réseau), murs, hauteur de saut, temps en l'air
  moveOk(p, x, y, z, now) {
    if (p.aTp !== p.tp || !p.aT) { p.ax = p.x; p.ay = p.y; p.az = p.z; p.aT = now; p.aTp = p.tp; p.mvB = 2; p.gY = p.y; p.airS = 0; }
    const dt = Math.min(1, (now - p.aT) / 1000), VMAX = 7.2;
    p.aT = now;
    p.mvB = Math.min(VMAX * 0.75, p.mvB + VMAX * dt);
    const d = Math.hypot(x - p.ax, z - p.az);
    if (d > p.mvB + 0.3) return this.flag(p, 'vitesse', now);
    const yy = Math.max(p.ay, y) + 0.62;
    if (d > 0.02 && this.segBlocked(p.ax, yy, p.az, x, yy, z)) return this.flag(p, 'traverse les murs', now, 0.5);
    const fl = this.floorAt(x, z, y);
    if (y <= fl + 0.3) { p.gY = y; p.airS = 0; } else if (!p.airS) p.airS = now;
    if (y > p.ay + 0.02 && y > p.gY + 1.35) return this.flag(p, 'vol', now);
    if (p.airS && now - p.airS > 2500 && y > fl + 0.5) return this.flag(p, 'vol', now);
    p.mvB -= d; p.ax = x; p.ay = y; p.az = z;
    return true;
  }
  // position refusée : on renvoie le joueur à la dernière position acceptée (sans toucher à sa visée)
  correct(p, now) {
    if (now - (p.corT || 0) < 250) return;
    p.corT = now; p.tp = (p.tp || 0) + 1; p.aTp = p.tp;
    p.x = p.ax; p.y = p.ay; p.z = p.az; p.mvB = 2; p.airS = 0;
    send(p.ws, { type: 'tp', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), c: p.c, s: p.tp, n: '', k: 1 });
  }
  // rechargement : commencé quand le client annonce rl = 1, terminé quand il repasse à 0 (ou change d'arme)
  reloadTick(p, rl, now) {
    if (rl && !p.rlS && p.alive) { p.rlS = now; p.rlW = p.inv.cur; return; }
    if (p.rlS && (!rl || p.inv.cur !== p.rlW)) this.finishReload(p, now);
  }
  finishReload(p, now) {
    const id = p.rlW, w = WEAPONS[id], el = now - p.rlS; p.rlS = 0;
    if (!w || !w.mag || p.inv.cur !== id && !(p.inv.primary === id || p.inv.secondary === id)) return;
    if (p.inv.cur !== id) return;   // arme changée pendant le rechargement : rien n'est rechargé (comme chez le client)
    const a = this.ammoOf(p, id).slice(), room = Math.min(w.mag - a[0], this.practice ? w.mag : a[1]);
    if (room <= 0) return;
    let n = 0;
    if (w.shell) n = el >= 360 ? Math.min(room, Math.floor((el - 360) / 500) + 1) : 0;   // une cartouche toutes les 0,5 s
    else if (el >= w.rl * 1000 * 0.8) n = room;
    a[0] += n; if (!this.practice) a[1] -= n;
    p.am[id] = a;
  }
  // un tir : cadence (crédit de tirs qui se remplit à la cadence de l'arme), chargeur, arme bloquée
  fireOk(p, now) {
    const id = p.inv.cur, w = WEAPONS[id];
    if (!w || GREN[id]) return false;
    if (this.jam && now < this.jam.until && w.slot === this.jam.s) return false;
    if (p.rlS) this.finishReload(p, now);   // fusil à pompe : tirer interrompt le rechargement
    // crédit par arme (changer d'arme ne le remplit pas plus vite : la sortie de l'arme prend déjà 0,4 s)
    const F = p.fire || (p.fire = {}), f = F[id] || (F[id] = { c: 2, t: now });
    f.c = Math.min(2, f.c + (now - f.t) / 1000 / w.rof); f.t = now;
    if (f.c < 0.65) { this.flag(p, 'cadence de tir', now, 0.25); return false; }
    if (w.mag && !(this.mode === 'sandbox')) {
      const a = this.ammoOf(p, id).slice();
      if (a[0] <= 0) { if (now - (p.amT || 0) > 900) { p.amT = now; send(p.ws, { type: 'am', w: id, mag: a[0], res: a[1] }); } return false; }
      a[0]--; p.am[id] = a;
    }
    f.c -= 1;
    p.shot = { t: now, w: id, n: w.pellets || 1 };
    return true;
  }
  // ligne de tir : du regard du tireur à la tête, au torse ou aux jambes de la cible (positions des 400 dernières ms),
  // sans mur infranchissable et en traversant au plus 2 obstacles que l'arme perce (bois, tôle)
  losOk(sh, t, w) {
    const ey = sh.y + (sh.c ? 1.15 : 1.62);
    const pens = (b) => (b.t === 'w' ? 0 : b.t === 'cont' || b.t === 'barrel' ? 2 : b.h <= 2.7 ? 1 : 0);
    const clear = (x, y, z) => {
      let n = 0;
      for (const b of this.segBoxes(sh.x, ey, sh.z, x, y, z)) { const pb = pens(b); if (!pb || w.pen < pb || ++n > 2) return false; }
      return true;
    };
    const pts = [[t.x, t.y, t.z, t.c]].concat(t.hist || []).map((h) => (h.length === 4 ? h : [h[1], h[2], h[3], h[4]]));
    return pts.some(([x, y, z, c]) => [0.45, 1.0, c ? 1.15 : 1.6].some((dy) => clear(x, y + dy, z)));
  }
  // obstacles traversés par le segment a->b
  segBoxes(ax, ay, az, bx, by, bz) {
    const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az], out = [];
    for (const b of this.solid()) {
      if (b.h >= 10 && (Math.abs(Math.abs(b.x) - this.map.hx - 0.5) < 0.01 || Math.abs(Math.abs(b.z) - this.map.hz - 0.5) < 0.01)) continue;   // enceinte
      const lo = [b.x - b.w / 2 + 0.1, 0, b.z - b.d / 2 + 0.1], hi = [b.x + b.w / 2 - 0.1, b.h - 0.08, b.z + b.d / 2 - 0.1];
      let t0 = 0, t1 = 1, hit = true;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { hit = false; break; } continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) { const q = a; a = c; c = q; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) out.push(b);
    }
    return out;
  }

  addPlayer(ws, name, want, acc) {
    const id = this.nextId++;
    const p = {
      id, ws, name, team: null, pending: null, alive: false, hp: 100, armor: 0, kit: false, money: CFG.startMoney,
      helmet: false, inv: { primary: null, secondary: 'glock', cur: 'glock' }, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, c: 0,
      k: 0, d: 0, ac: 0, mv: 0, rk: 0, survived: false, act: null, pg: 0, lastSt: 0, lastHit: new Map(), lastChat: 0, lastThrow: 0, alive_ws: true, rl: 0, am: {}, bought: {}, g: { flash: 0, smoke: 0, he: 0, molo: 0 }
    };
    p.ready = false; p.opt = { god: false, infN: false }; p.acc = acc ? acc.key : null; p.lv = acc ? acc.lv : 0; p.eq = acc ? Acc.eqOf(acc.key) : {};
    this.players.set(id, p);
    if (this.lobby && !this.host) this.host = id;
    p.team = this.chooseTeam(p, want);
    this.resetLoadout(p, true);
    // entraînement : on apparaît tout de suite, argent illimité
    if (this.practice && this.phase === 'live') { p.money = CFG.maxMoney; this.spawnPlayer(p, this.spawnN++); this.started[p.team]++; }
    // arrivée en cours de phase d'achat : on le fait apparaître directement
    else if (this.phase === 'freeze') {
      this.spawnPlayer(p, this.team(p.team).length);
      this.started[p.team]++;
    }
    return p;
  }

  removePlayer(p) {
    if (this.bomb.s === 'carried' && this.bomb.c === p.id) {
      this.bomb.s = 'dropped'; this.bomb.c = null; this.bomb.x = p.x; this.bomb.z = p.z;
    }
    this.players.delete(p.id);
    if (this.host === p.id) this.host = this.players.size ? this.players.keys().next().value : 0;   // l'hôte part : le plus ancien joueur reprend
    this.bcast({ type: 'leave', id: p.id });
    this.checkEnd(Date.now());
  }
}

wss.on('connection', (ws) => {
  let room = null, me = null;
  ws.on('pong', () => { if (me) me.alive_ws = true; else ws.isAlive = true; });
  ws.isAlive = true;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!me) {
      if (m.type !== 'join') return;
      const rn = String(m.room || 'main').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'main';
      let r = rooms.get(rn);
      if (!r) { r = new Room(rn, typeof m.map === 'string' ? m.map : '', m.mode); r.lobby = !r.practice && (m.lobby === 1 || m.lobby === true); rooms.set(rn, r); }
      if (r.players.size >= CFG.maxPlayers) { send(ws, { type: 'err', text: 'Salle pleine (' + CFG.maxPlayers + ' joueurs max)' }); return; }
      // compte connecté : son pseudo fait foi ; un invité ne peut pas prendre le pseudo d'un compte
      const u = Acc.byTok(m.tok);
      let name = String(m.name || 'Joueur').replace(/[\u0000-\u001f<>]/g, '').slice(0, 16).trim() || 'Joueur';
      let acc = null;
      if (u) { name = u.name; acc = { key: Acc.keyOf(u), lv: Acc.level(Acc.keyOf(u)) }; }
      else if (Acc.exists(name)) name = name.slice(0, 15) + '*';
      room = r;
      me = r.addPlayer(ws, name, m.team, acc);
      send(ws, { type: 'welcome', id: me.id, room: rn, map: r.map.id, pm: r.practice ? r.mode : '', name, acc: acc ? 1 : 0, cfg: { maxRounds: CFG.maxRounds } });
      r.msg(name + ' a rejoint la partie', 'info');
      return;
    }
    room.onMessage(me, m);
  });

  ws.on('close', () => { if (room && me) room.removePlayer(me); });
  ws.on('error', () => {});
});

// Ping régulier (proxy Render) + nettoyage des connexions mortes
setInterval(() => {
  wss.clients.forEach((ws) => {
    rooms.forEach((r) => r.players.forEach((p) => { if (p.ws === ws) { if (!p.alive_ws) return ws.terminate(); p.alive_ws = false; } }));
    try { ws.ping(); } catch (e) {}
  });
}, 25000);

Acc.ready.then(() => server.listen(PORT, '0.0.0.0', () => console.log('CS Arena en ligne sur le port ' + PORT)));
