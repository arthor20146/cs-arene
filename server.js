// Serveur CS Arena : sert /public + salles WebSocket (logique de manches, économie, bombe, dégâts)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
// Docker : fichiers client dans ./public ; dépôt à plat (npm start en local) : à la racine
const PUB = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const CS = require(path.join(PUB, 'shared.js'));
const { CFG, ZONES, WEAPONS, GREN, MAPS } = CS;
const GR = 0.11; // rayon d'une grenade (m)

const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
if (process.env.MAX_ROUNDS) CFG.maxRounds = parseInt(process.env.MAX_ROUNDS, 10) || CFG.maxRounds;
if (process.env.MIN_PLAYERS) CFG.minPlayers = parseInt(process.env.MIN_PLAYERS, 10) || CFG.minPlayers;

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
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
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const r2 = (v) => Math.round(v * 100) / 100;
const send = (ws, o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

class Room {
  constructor(name, mapId) {
    this.name = name;
    this.map = MAPS[mapId] || MAPS[process.env.MAP] || MAPS.dust; // carte choisie par le créateur de la salle
    this.players = new Map();
    this.nextId = 1;
    this.nextDrop = 1;
    this.nextG = 1;
    this.snapN = 0;
    this.resetMatch();
    this.timer = setInterval(() => this.tick(), CFG.tick);
  }

  /* ---------- utilitaires ---------- */
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
    this.players.forEach((p) => { p.k = 0; p.d = 0; p.ac = 0; p.mv = 0; p.rk = 0; p.survived = false; this.resetLoadout(p, true); p.alive = false; });
  }

  /* ---------- armes au sol ---------- */
  groundY(x, z, y) {
    let g = 0;
    for (const b of this.map.boxes) {
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
    const inWall = this.map.boxes.some((b) => b.h > p.y + 0.2 && Math.abs(x - b.x) < b.w / 2 + 0.1 && Math.abs(z - b.z) < b.d / 2 + 0.1);
    if (inWall) { x = p.x; z = p.z; }
    x = Math.max(-39.5, Math.min(39.5, x)); z = Math.max(-39.5, Math.min(39.5, z));
    this.drops.push({
      i: this.nextDrop++, w: id, x: r2(x), y: r2(this.groundY(x, z, p.y)), z: r2(z), r: r2(Math.random() * 6.28),
      ox: r2(p.x), oy: r2(p.y), oz: r2(p.z), mag, res, by: p.id, at: Date.now()
    });
    while (this.drops.length > CFG.maxDrops) this.drops.shift();
    this.dropsDirty = true;
    if (p.inv.primary === id) p.inv.primary = null; else if (p.inv.secondary === id) p.inv.secondary = null;
    delete p.am[id];
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
    p.alive = true; p.hp = 100; p.act = null; p.pg = 0;
    send(p.ws, { type: 'spawn', x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
  }

  startRound() {
    const now = Date.now();
    this.round++;
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
      p.am = {};
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
    this.phase = 'freeze';
    this.phaseEnd = now + CFG.freeze * 1000;
    this.bcast({ type: 'rstart', round: this.round });
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
    if (this.phase !== 'live') return;
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
    this.bcast({ type: 'rend', w: winner, r: reason, sc: this.score, over: over ? 1 : 0, mvp: mvp ? { i: mvp.id, n: mvp.name, k: mvp.rk, h: hero && mvp.id === hero ? 1 : 0 } : null });
    if (over) { this.phase = 'match'; this.phaseEnd = Date.now() + 10000; }
  }

  checkEnd(now) {
    if (this.phase !== 'live') return;
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
    v.alive = false; v.hp = 0; v.d++; v.act = null; v.pg = 0;
    const held = v.inv.primary || v.inv.secondary;
    if (held) this.dropWeapon(v, held, 0.6);
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
    }
    this.bcast({ type: 'kill', k: k ? k.id : 0, v: v.id, w: wid || 'bomb', hs: hs ? 1 : 0, rk, fb, ace });
  }

  onHit(sh, m) {
    const t = this.players.get(num(m.t));
    if (!t || !sh.alive || !t.alive || sh.id === t.id || sh.team === t.team) return;
    if (this.phase !== 'live') return;
    const wid = sh.inv.cur, w = WEAPONS[wid];
    if (!w) return;
    const now = Date.now();
    // une balle par cible : un tir de chevrotine peut toucher plusieurs joueurs
    const last = sh.lastHit.get(t.id) || 0;
    if (now - last < w.rof * 1000 * 0.6) return;
    sh.lastHit.set(t.id, now);
    const dist = Math.hypot(sh.x - t.x, sh.z - t.z);
    if (dist > w.range + 3) return;
    // zones touchées : { h: nb, c: nb, s: nb, a: nb, l: nb } (plombs ou balle unique)
    const z = m.z && typeof m.z === 'object' ? m.z : { c: 1 };
    let left = w.pellets || 1, dmg = 0, armored = 0, hs = false;
    const pen = Math.max(0, Math.min(3, num(m.p) | 0));
    const base = w.dmg * Math.pow(w.fall, dist / 25) * Math.pow(CFG.penLoss, pen);
    for (const k of ['h', 'c', 's', 'a', 'l']) {
      const n = Math.min(left, Math.max(0, num(z[k]) | 0));
      if (!n) continue;
      left -= n;
      let d = base * n * (k === 'h' ? w.hs : ZONES[k]);
      const covered = k === 'l' ? false : k === 'h' ? t.helmet : t.armor > 0;
      if (k === 'h') hs = hs || !w.pellets;
      if (covered) {
        let mult = k === 'h' ? CFG.armorHead : CFG.armorBody;
        mult = 1 - (1 - mult) * (1 - w.ap);
        armored += d;
        d *= mult;
      }
      dmg += d;
    }
    if (dmg <= 0) return;
    if (armored) t.armor = Math.max(0, t.armor - armored * 0.3 * (1 - w.ap * 0.5));
    dmg = Math.round(dmg);
    t.hp -= dmg;
    send(sh.ws, { type: 'hitc', hs: hs ? 1 : 0, kill: t.hp <= 0 ? 1 : 0 });
    send(t.ws, { type: 'hurt', dx: r2(sh.x - t.x), dz: r2(sh.z - t.z), dmg, hs: hs ? 1 : 0 });
    if (t.hp <= 0) { this.killPlayer(t, sh, wid, hs); this.checkEnd(now); }
  }

  buy(p, item) {
    const now = Date.now();
    const open = p.alive && (this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000));
    if (!open) return;
    if (item === 'armor') {
      if (p.armor >= 100 || p.money < 650) return;
      p.money -= 650; p.armor = 100; return;
    }
    if (item === 'helmet') { // gilet + casque (350 si on a déjà le gilet)
      const cost = p.armor >= 100 ? 350 : 1000;
      if (p.helmet || p.money < cost) return;
      p.money -= cost; p.armor = 100; p.helmet = true; return;
    }
    if (item === 'kit') {
      if (p.team !== 'CT' || p.kit || p.money < 400) return;
      p.money -= 400; p.kit = true; return;
    }
    if (GREN[item]) {
      const gd = GREN[item];
      if (p.money < gd.price || p.g[item] >= gd.max || this.gTotal(p) >= CFG.grenTotal) return;
      p.money -= gd.price; p.g[item]++; return;
    }
    const w = WEAPONS[item];
    if (!w || w.slot === 3 || w.price <= 0) return;
    if (w.team && w.team !== p.team) return;
    if (p.money < w.price) return;
    const held = w.slot === 1 ? p.inv.primary : p.inv.secondary;
    if (held === item) return;                 // déjà en main : on ne paie pas deux fois
    p.money -= w.price;
    if (held) this.dropWeapon(p, held, 0.9);   // l'ancienne arme tombe au sol
    if (w.slot === 1) p.inv.primary = item; else p.inv.secondary = item;
    p.inv.cur = item;
    delete p.am[item];                         // arme neuve : munitions pleines
  }


  /* ---------- grenades ---------- */
  gTotal(p) { return p.g.flash + p.g.smoke + p.g.he + p.g.molo; }

  // le segment a->b traverse-t-il un obstacle ? (volumes du sol à leur hauteur, un peu réduits)
  segBlocked(ax, ay, az, bx, by, bz) {
    const o = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
    for (const b of this.map.boxes) {
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
    for (const b of this.map.boxes) {
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
    p.g[k]--;
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
    g.x = Math.max(-39.6, Math.min(39.6, g.x)); g.z = Math.max(-39.6, Math.min(39.6, g.z));
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
        if (Math.hypot(t.x - z.x, t.z - z.z) > z.r || Math.abs(t.y - z.y) > 2.2) return;
        if (this.segBlocked(z.x, z.y + 0.5, z.z, t.x, t.y + 0.5, t.z)) return;
        t.hp -= CFG.fireDmg;
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
      const cy = t.y + (t.c ? 0.7 : 1.0);
      const d = Math.hypot(g.x - t.x, g.y - cy, g.z - t.z);
      if (d > R) return;
      if (this.segBlocked(g.x, Math.max(g.y, 0.2), g.z, t.x, cy, t.z)) return;
      let dmg = CFG.heDmg * Math.pow(1 - d / R, 1.25);
      if (t.armor > 0) { dmg *= CFG.armorBody; t.armor = Math.max(0, t.armor - dmg * 0.4); }
      dmg = Math.round(dmg);
      if (dmg < 1) return;
      t.hp -= dmg;
      send(t.ws, { type: 'hurt', dx: r2(g.x - t.x), dz: r2(g.z - t.z), dmg, hs: 0 });
      if (owner && owner !== t) send(owner.ws, { type: 'hitc', hs: 0, kill: t.hp <= 0 ? 1 : 0 });
      if (t.hp <= 0) this.killPlayer(t, owner, 'he', false);
    });
    this.checkEnd(now);
  }

  // la bombe est posée 0,55 m devant le joueur (à ses pieds si un mur gêne)
  bombSpot(p) {
    const x = p.x - Math.sin(p.yaw) * 0.55, z = p.z - Math.cos(p.yaw) * 0.55;
    const inWall = this.map.boxes.some((b) => b.h > 0.4 && Math.abs(x - b.x) < b.w / 2 + 0.15 && Math.abs(z - b.z) < b.d / 2 + 0.15);
    return inWall ? { x: p.x, z: p.z } : { x, z };
  }

  /* ---------- boucle ---------- */
  tick() {
    const now = Date.now();
    if (this.players.size === 0) { clearInterval(this.timer); rooms.delete(this.name); return; }

    if (this.phase === 'wait') {
      if (this.players.size >= CFG.minPlayers) this.startRound();
    } else if (this.phase === 'freeze') {
      this.autoPickup();
      if (now >= this.phaseEnd) { this.phase = 'live'; this.liveStart = now; this.phaseEnd = now + CFG.live * 1000; }
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
          this.endRound('CT', 'defuse', p.id);
        }
      }
    });
    if (this.phase !== 'live') return;
    // explosion
    if (b.s === 'planted' && now >= b.at) {
      b.s = 'exploded';
      this.all().forEach((p) => {
        if (!p.alive) return;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < 12) this.killPlayer(p, null, 'bomb', false);
        else if (d < 25) { p.hp -= Math.round(150 * (1 - (d - 12) / 13)); if (p.hp <= 0) this.killPlayer(p, null, 'bomb', false); }
      });
      this.endRound('T', 'bomb', b.by);
      return;
    }
    this.checkEnd(now);
  }

  snapshot(now) {
    const b = this.bomb;
    let te;
    if (this.phase === 'live' && b.s === 'planted') te = Math.max(0, (b.at - now) / 1000);
    else te = Math.max(0, (this.phaseEnd - now) / 1000);
    const pl = this.all().map((p) => ({
      i: p.id, n: p.name, t: p.team, x: r2(p.x), y: r2(p.y), z: r2(p.z), r: r2(p.yaw), p: r2(p.pitch),
      c: p.c, w: p.inv.cur, a: p.alive ? 1 : 0, k: p.k, d: p.d, h: p.helmet ? 1 : 0, l: p.rl ? 1 : 0,
      q: p.act ? (p.act.type === 'plant' ? 1 : 2) : 0, g: p.act ? r2(Math.min(1, p.pg || 0)) : 0, kt: p.kit ? 1 : 0, ac: p.ac, mv: p.mv
    }));
    const buyOpen = this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000);
    const common = {
      type: 'snap', mp: this.map.id, ph: this.phase, te: r2(te), rd: this.round, sc: this.score,
      b: { s: b.s, x: r2(b.x), y: r2(b.y), z: r2(b.z), c: b.c, site: b.site }, pl,
      gr: this.gren.map((g) => ({ i: g.i, k: g.k, x: r2(g.x), y: r2(g.y), z: r2(g.z), vx: r2(g.vx), vy: r2(g.vy), vz: r2(g.vz) })),
      zn: this.zones.map((z) => ({ i: z.i, k: z.k, x: z.x, y: z.y, z: z.z, r: z.r, l: r2(Math.max(0, (z.until - now) / 1000)) }))
    };
    // armes au sol : à chaque changement, et chaque seconde pour ceux qui arrivent
    if (this.dropsDirty || ++this.snapN >= 20) {
      common.dp = this.drops.map((d) => ({ i: d.i, w: d.w, x: d.x, y: d.y, z: d.z, r: d.r, ox: d.ox, oy: d.oy, oz: d.oz, n: now - d.at < 500 ? 1 : 0, m: d.mag, s: d.res }));
      this.dropsDirty = false; this.snapN = 0;
    }
    this.players.forEach((p) => {
      common.me = {
        hp: Math.max(0, p.hp), ar: Math.round(p.armor), he: p.helmet ? 1 : 0, mo: p.money, p: p.inv.primary, s: p.inv.secondary,
        k: p.kit ? 1 : 0, bm: b.s === 'carried' && b.c === p.id ? 1 : 0, pg: r2(Math.min(1, p.pg || 0)),
        al: p.alive ? 1 : 0, bo: buyOpen && p.alive ? 1 : 0, t: p.team, g: p.g
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
        p.yaw = num(m.yaw); p.pitch = num(m.pitch); p.c = m.c ? 1 : 0; p.rl = m.rl ? 1 : 0;
        if (typeof m.w === 'string' && (m.w === p.inv.primary || m.w === p.inv.secondary || m.w === 'knife' || (GREN[m.w] && p.g[m.w] > 0))) p.inv.cur = m.w;
        if (m.w === p.inv.cur) this.noteAmmo(p, m.am); // sinon : message parti avant un échange d'arme
        if (!p.alive || this.phase === 'freeze') return;
        p.x = Math.max(-40, Math.min(40, num(m.x, p.x)));
        p.y = Math.max(0, Math.min(8, num(m.y, p.y)));
        p.z = Math.max(-40, Math.min(40, num(m.z, p.z)));
        break;
      }
      case 'shoot': {
        if (!p.alive || !Array.isArray(m.o) || !Array.isArray(m.e)) return;
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
      case 'team': {
        const want = this.chooseTeam(p, m.team);
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
  noteAmmo(p, am) {
    const id = p.inv.cur, w = WEAPONS[id];
    if (!w || !w.mag || !Array.isArray(am)) return;
    p.am[id] = [Math.max(0, Math.min(w.mag, num(am[0]) | 0)), Math.max(0, Math.min(w.res, num(am[1]) | 0))];
  }

  addPlayer(ws, name, want) {
    const id = this.nextId++;
    const p = {
      id, ws, name, team: null, pending: null, alive: false, hp: 100, armor: 0, kit: false, money: CFG.startMoney,
      helmet: false, inv: { primary: null, secondary: 'glock', cur: 'glock' }, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, c: 0,
      k: 0, d: 0, ac: 0, mv: 0, rk: 0, survived: false, act: null, pg: 0, lastSt: 0, lastHit: new Map(), lastChat: 0, lastThrow: 0, alive_ws: true, rl: 0, am: {}, g: { flash: 0, smoke: 0, he: 0, molo: 0 }
    };
    this.players.set(id, p);
    p.team = this.chooseTeam(p, want);
    this.resetLoadout(p, true);
    // arrivée en cours de phase d'achat : on le fait apparaître directement
    if (this.phase === 'freeze') {
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
      if (!r) { r = new Room(rn, typeof m.map === 'string' ? m.map : ''); rooms.set(rn, r); }
      if (r.players.size >= CFG.maxPlayers) { send(ws, { type: 'err', text: 'Salle pleine (' + CFG.maxPlayers + ' joueurs max)' }); return; }
      const name = String(m.name || 'Joueur').replace(/[\u0000-\u001f<>]/g, '').slice(0, 16).trim() || 'Joueur';
      room = r;
      me = r.addPlayer(ws, name, m.team);
      send(ws, { type: 'welcome', id: me.id, room: rn, map: r.map.id, cfg: { maxRounds: CFG.maxRounds } });
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

server.listen(PORT, '0.0.0.0', () => console.log('CS Arena en ligne sur le port ' + PORT));
