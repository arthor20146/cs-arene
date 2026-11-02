// Serveur CS Arena : sert /public + salles WebSocket (logique de manches, économie, bombe, dégâts)
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
// Docker : fichiers client dans ./public ; dépôt à plat (npm start en local) : à la racine
const PUB = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const CS = require(path.join(PUB, 'shared.js'));
const { CFG, ZONES, WEAPONS, MAPS } = CS;

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
    this.players.forEach((p) => { p.k = 0; p.d = 0; p.survived = false; this.resetLoadout(p, true); p.alive = false; });
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
  takeDrop(p, d) {
    const w = WEAPONS[d.w];
    this.drops.splice(this.drops.indexOf(d), 1);
    this.dropsDirty = true;
    if (w.slot === 1) p.inv.primary = d.w; else p.inv.secondary = d.w;
    p.inv.cur = d.w;
    p.am[d.w] = [d.mag, d.res];
    send(p.ws, { type: 'got', w: d.w, mag: d.mag, res: d.res });
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
    this.takeDrop(p, d);
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

  endRound(winner, reason) {
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
    this.bcast({ type: 'rend', w: winner, r: reason, sc: this.score, over: over ? 1 : 0 });
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
    if (k && k !== v) {
      k.k++;
      const w = WEAPONS[wid];
      k.money = Math.min(CFG.maxMoney, k.money + (w ? w.kill : 300));
    }
    this.bcast({ type: 'kill', k: k ? k.id : 0, v: v.id, w: wid || 'bomb', hs: hs ? 1 : 0 });
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
    const w = WEAPONS[item];
    if (!w || w.slot === 3 || w.price <= 0) return;
    if (w.team && w.team !== p.team) return;
    if (p.money < w.price) return;
    p.money -= w.price;
    if (w.slot === 1) p.inv.primary = item; else p.inv.secondary = item;
    p.inv.cur = item;
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
    } else if (this.phase === 'end') {
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
          b.s = 'planted'; b.c = null; b.x = p.x; b.y = 0; b.z = p.z; b.site = site; b.at = now + CFG.bombTime * 1000;
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
          this.endRound('CT', 'defuse');
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
      this.endRound('T', 'bomb');
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
      c: p.c, w: p.inv.cur, a: p.alive ? 1 : 0, k: p.k, d: p.d, h: p.helmet ? 1 : 0, l: p.rl ? 1 : 0
    }));
    const buyOpen = this.phase === 'freeze' || (this.phase === 'live' && now < this.liveStart + CFG.buyExtra * 1000);
    const common = {
      type: 'snap', mp: this.map.id, ph: this.phase, te: r2(te), rd: this.round, sc: this.score,
      b: { s: b.s, x: r2(b.x), y: r2(b.y), z: r2(b.z), c: b.c, site: b.site }, pl
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
        al: p.alive ? 1 : 0, bo: buyOpen && p.alive ? 1 : 0, t: p.team
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
        if (typeof m.w === 'string' && (m.w === p.inv.primary || m.w === p.inv.secondary || m.w === 'knife')) p.inv.cur = m.w;
        this.noteAmmo(p, m.am);
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
      case 'act': {
        if (!m.on) { p.act = null; p.pg = 0; return; }
        if (!p.alive) return;
        if (this.phase === 'freeze') { this.swapDrop(p); break; }
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
      k: 0, d: 0, survived: false, act: null, pg: 0, lastSt: 0, lastHit: new Map(), lastChat: 0, alive_ws: true, rl: 0, am: {}
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
