/* Sons synthétisés avec WebAudio (aucun fichier à charger) :
   détonations en couches, écho de l'environnement, distance, murs qui étouffent le son */
window.Snd = (function () {
  let ctx = null, master = null, muffle = null, noise = null, verb = null, wetBus = null, vol = 0.6, amb = null, ambGain = null, ringG = null;
  const W = () => (window.CS ? CS.WEAPONS : {});

  // réponse d'impulsion : échos sur les murs + queue ouverte (extérieur)
  function impulse(dur, echoes) {
    const sr = ctx.sampleRate, len = Math.floor(sr * dur), b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4) * 0.3; }
      echoes.forEach((e) => {
        const s = Math.floor((e[0] + (ch ? 0.006 : 0)) * sr), n = Math.floor(0.05 * sr);
        for (let i = 0; i < n && s + i < len; i++) d[s + i] += (Math.random() * 2 - 1) * e[1] * Math.pow(1 - i / n, 2);
      });
    }
    return b;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = vol;
      muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.16;
      muffle.connect(comp); comp.connect(master); master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      verb = ctx.createConvolver(); verb.buffer = impulse(1.8, [[0.09, 0.5], [0.17, 0.34], [0.31, 0.22], [0.52, 0.12]]);
      wetBus = ctx.createGain(); wetBus.gain.value = 0.42;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
      wetBus.connect(hp); hp.connect(verb); verb.connect(muffle);
      // acouphène
      ringG = ctx.createGain(); ringG.gain.value = 0;
      const ro = ctx.createOscillator(); ro.frequency.value = 3700; ro.connect(ringG); ringG.connect(master); ro.start();
    } catch (e) { ctx = null; }
  }

  // sortie d'un son : o = { pan, lp, delay, wet }
  function out(o) {
    let n = muffle, first;
    const chain = [];
    if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); chain.push(p); }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; chain.push(f); }
    if (!chain.length && !o.wet) return n;
    const inp = ctx.createGain();
    let c = inp; chain.forEach((x) => { c.connect(x); c = x; }); c.connect(muffle);
    if (o.wet) { const w = ctx.createGain(); w.gain.value = o.wet; c.connect(w); w.connect(wetBus); }
    return inp;
  }

  function burst(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0), dur = o.dur || 0.1;
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1500, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweep), t + dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.5), t + (o.atk || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out(o));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  function tone(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0), dur = o.dur || 0.1;
    const os = ctx.createOscillator(); os.type = o.wave || 'sine';
    os.frequency.setValueAtTime(o.freq || 440, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, o.vol || 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(out(o));
    os.start(t); os.stop(t + dur + 0.05);
  }

  const shotProfile = {
    glock: { f: 1800, d: 0.09, t: 160 }, usp: { f: 1400, d: 0.1, t: 140 }, deagle: { f: 900, d: 0.18, t: 90 },
    mac10: { f: 2200, d: 0.07, t: 170 }, mp9: { f: 2000, d: 0.07, t: 160 }, nova: { f: 700, d: 0.22, t: 70 },
    ak47: { f: 1100, d: 0.14, t: 100 }, m4a1: { f: 1500, d: 0.1, t: 120 }, awp: { f: 500, d: 0.35, t: 55 },
    p250: { f: 1600, d: 0.1, t: 150 }, tec9: { f: 1900, d: 0.09, t: 165 }, fiveseven: { f: 1700, d: 0.09, t: 155 },
    ump45: { f: 1300, d: 0.09, t: 130 }, p90: { f: 2100, d: 0.07, t: 165 }, xm1014: { f: 750, d: 0.2, t: 75 },
    galil: { f: 1200, d: 0.12, t: 110 }, famas: { f: 1350, d: 0.11, t: 115 }, sg553: { f: 1000, d: 0.14, t: 95 },
    aug: { f: 1250, d: 0.12, t: 105 }, ssg08: { f: 700, d: 0.28, t: 70 }
  };
  const STEP = {
    sand: (v, o) => { burst({ ...o, freq: 900, sweep: 300, dur: 0.11, vol: 0.2 * v, q: 0.5, atk: 0.012 }); burst({ ...o, freq: 3200, dur: 0.07, vol: 0.05 * v, q: 0.7, type: 'highpass', delay: 0.02 }); },
    stone: (v, o) => { burst({ ...o, freq: 420, dur: 0.05, vol: 0.32 * v, q: 1.3 }); burst({ ...o, freq: 2400, dur: 0.02, vol: 0.09 * v, q: 2 }); },
    wood: (v, o) => { tone({ ...o, freq: 170, to: 95, dur: 0.07, vol: 0.34 * v }); burst({ ...o, freq: 900, dur: 0.03, vol: 0.12 * v, q: 2 }); },
    metal: (v, o) => { tone({ ...o, freq: 300, to: 220, dur: 0.16, vol: 0.14 * v, wave: 'triangle' }); tone({ ...o, freq: 1270, to: 1190, dur: 0.1, vol: 0.05 * v, wave: 'triangle' }); burst({ ...o, freq: 700, dur: 0.04, vol: 0.2 * v, q: 1.5 }); }
  };

  return {
    init,
    setVolume(v) { vol = v; if (master) master.gain.value = v; },
    setAmbient(id) {
      if (!ctx) return;
      if (amb) { try { amb.stop(); } catch (e) {} amb = null; }
      amb = ctx.createBufferSource(); amb.buffer = noise; amb.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = id === 'docks' ? 300 : 520; f.Q.value = 0.4;
      ambGain = ctx.createGain(); ambGain.gain.value = id === 'docks' ? 0.05 : 0.038;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 200; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      amb.connect(f); f.connect(ambGain); ambGain.connect(muffle); amb.start();
    },
    // o : { pan, lp, delay, wet } (distance/mur calculés par game.js)
    shot(id, v, pan, x) {
      const p = shotProfile[id]; if (!ctx || !p) return;
      v = v == null ? 1 : v; x = x || {};
      const w = W()[id] || {}, o = { pan, lp: x.lp, delay: x.delay };
      if (w.sup) {
        burst({ ...o, freq: 1500, sweep: 700, dur: 0.07, vol: 0.34 * v, q: 0.6, wet: 0.1 });
        burst({ ...o, freq: 4200, dur: 0.02, vol: 0.12 * v, q: 2 });
        tone({ ...o, freq: 160, to: 90, dur: 0.05, vol: 0.14 * v });
        return;
      }
      const wet = (x.wet == null ? 0.65 : x.wet);
      burst({ ...o, freq: 2600, dur: 0.018, vol: 0.85 * v, type: 'highpass', q: 0.4 });
      burst({ ...o, freq: p.f, sweep: p.f * 0.3, dur: p.d, vol: 0.8 * v, q: 0.7, wet });
      tone({ ...o, freq: p.t * 1.9, to: p.t * 0.45, dur: p.d * 1.5, vol: 0.75 * v });
      burst({ ...o, freq: 500, sweep: 90, dur: p.d * 3.4, vol: 0.32 * v, q: 0.4, type: 'lowpass', wet: wet * 0.8, delay: (x.delay || 0) + 0.008 });
    },
    knife(v) { burst({ freq: 3500, sweep: 800, dur: 0.12, vol: 0.2 * (v == null ? 1 : v), type: 'highpass' }); },
    part(k) {
      if (k === 'out') { burst({ freq: 2100, dur: 0.035, vol: 0.28, q: 5 }); burst({ freq: 900, dur: 0.05, vol: 0.14, q: 3, delay: 0.04 }); }
      else if (k === 'in') { burst({ freq: 1500, dur: 0.05, vol: 0.34, q: 4 }); burst({ freq: 3100, dur: 0.025, vol: 0.34, q: 6, delay: 0.05 }); }
      else if (k === 'bolt') { burst({ freq: 2600, dur: 0.03, vol: 0.32, q: 6 }); burst({ freq: 1900, dur: 0.05, vol: 0.4, q: 5, delay: 0.1 }); }
      else if (k === 'shell') { burst({ freq: 1200, dur: 0.05, vol: 0.32, q: 3 }); burst({ freq: 2400, dur: 0.02, vol: 0.2, q: 6, delay: 0.05 }); }
      else if (k === 'pump') { burst({ freq: 800, dur: 0.07, vol: 0.4, q: 2 }); burst({ freq: 1300, dur: 0.07, vol: 0.42, q: 3, delay: 0.14 }); }
      else if (k === 'draw') { burst({ freq: 2200, sweep: 3400, dur: 0.08, vol: 0.08, q: 3 }); burst({ freq: 1400, dur: 0.03, vol: 0.14, q: 4, delay: 0.1 }); }
    },
    click() { burst({ freq: 3000, dur: 0.03, vol: 0.2, q: 5 }); },
    step(s, v, pan, x) { const f = STEP[s] || STEP.sand; if (ctx) f(v == null ? 0.5 : v, { pan, lp: x && x.lp, delay: x && x.delay }); },
    land(s, v) { const f = STEP[s] || STEP.sand; if (ctx) { f(v * 1.3, {}); tone({ freq: 90, to: 50, dur: 0.1, vol: 0.2 * v }); } },
    impact(m, v, pan, x) {
      if (!ctx) return; const o = { pan, lp: x && x.lp, delay: x && x.delay };
      if (m === 'metal') { tone({ ...o, freq: 1900 + Math.random() * 900, to: 1200, dur: 0.14, vol: 0.13 * v, wave: 'triangle' }); burst({ ...o, freq: 3200, dur: 0.03, vol: 0.24 * v, q: 2 }); }
      else if (m === 'wood') { burst({ ...o, freq: 700, dur: 0.05, vol: 0.32 * v, q: 1.6 }); tone({ ...o, freq: 220, to: 130, dur: 0.06, vol: 0.18 * v }); }
      else if (m === 'sand') burst({ ...o, freq: 800, sweep: 260, dur: 0.08, vol: 0.22 * v, q: 0.6 });
      else burst({ ...o, freq: 2100, sweep: 900, dur: 0.05, vol: 0.28 * v, q: 1 });
    },
    casing(v) { if (ctx) { const f = 3400 + Math.random() * 1800; tone({ freq: f, to: f * 0.97, dur: 0.06, vol: 0.03 * v, wave: 'triangle' }); } },
    whiz(pan) { burst({ freq: 1100, sweep: 3200, dur: 0.1, vol: 0.2, q: 2.5, pan }); burst({ freq: 3600, dur: 0.012, vol: 0.2, type: 'highpass', pan, delay: 0.04 }); },
    hit(hs) { if (hs) { tone({ freq: 2500, to: 1900, dur: 0.1, vol: 0.09, wave: 'triangle' }); burst({ freq: 3000, dur: 0.02, vol: 0.14, q: 3 }); } else burst({ freq: 420, dur: 0.06, vol: 0.28, q: 1.2 }); },
    kill() { tone({ wave: 'sine', freq: 320, to: 210, dur: 0.12, vol: 0.14 }); },
    hurt(hs) { burst({ freq: 300, dur: 0.15, vol: 0.5, q: 0.7 }); tone({ freq: 120, to: 60, dur: 0.14, vol: 0.5 }); if (hs) tone({ wave: 'triangle', freq: 2300, to: 1600, dur: 0.2, vol: 0.12 }); },
    heart(v) { tone({ freq: 62, to: 44, dur: 0.11, vol: 0.5 * v }); tone({ freq: 56, to: 42, dur: 0.13, vol: 0.38 * v, delay: 0.21 }); },
    // onde de choc : son étouffé et sifflement
    ring(k) {
      if (!ctx) return; const t = ctx.currentTime, d = 1 + 3.5 * k;
      muffle.frequency.cancelScheduledValues(t); muffle.frequency.setValueAtTime(Math.max(250, 2400 * (1 - k)), t); muffle.frequency.exponentialRampToValueAtTime(20000, t + d);
      ringG.gain.cancelScheduledValues(t); ringG.gain.setValueAtTime(0.032 * k, t); ringG.gain.exponentialRampToValueAtTime(0.0001, t + d);
    },
    beep(v, pan) { tone({ wave: 'square', freq: 1200, dur: 0.09, vol: 0.14 * (v == null ? 1 : v), pan, wet: 0.2 }); },
    // pavé numérique de la bombe et pince qui coupe le fil
    keypad() { tone({ wave: 'square', freq: 1750 + Math.random() * 250, dur: 0.035, vol: 0.05 }); burst({ freq: 2800, dur: 0.012, vol: 0.1, q: 4 }); },
    snip() { burst({ freq: 4200, dur: 0.025, vol: 0.22, q: 6, type: 'highpass' }); tone({ wave: 'triangle', freq: 2400, to: 1500, dur: 0.05, vol: 0.06 }); },
    magdrop() { burst({ freq: 700, dur: 0.05, vol: 0.2, q: 2 }); tone({ wave: 'triangle', freq: 200, to: 120, dur: 0.05, vol: 0.1 }); },
    thud(v, pan, x) { x = x || {}; burst({ freq: 180, sweep: 70, dur: 0.16, vol: 0.5 * (v == null ? 1 : v), q: 0.7, type: 'lowpass', pan, lp: x.lp, delay: x.delay }); burst({ freq: 900, dur: 0.05, vol: 0.18 * (v == null ? 1 : v), q: 1.2, pan, lp: x.lp, delay: x.delay }); },
    plant() { [0, 0.14, 0.28].forEach((d, i) => tone({ wave: 'square', freq: [500, 800, 1200][i], dur: 0.1, vol: 0.14, delay: d })); },
    defused() { tone({ freq: 600, dur: 0.15, vol: 0.25 }); tone({ freq: 900, dur: 0.3, vol: 0.25, delay: 0.15 }); },
    explode(v, x) {
      v = v == null ? 1 : v; x = x || {};
      const o = { lp: x.lp, delay: x.delay };
      burst({ ...o, freq: 3000, dur: 0.05, vol: 1 * v, type: 'highpass' });
      burst({ ...o, freq: 900, sweep: 50, dur: 2.6, vol: 1 * v, q: 0.5, type: 'lowpass', wet: 1 });
      tone({ ...o, freq: 80, to: 22, dur: 2.2, vol: 1 * v });
    },
    buy() { burst({ freq: 2600, dur: 0.03, vol: 0.14, q: 5 }); burst({ freq: 1500, dur: 0.05, vol: 0.18, q: 4, delay: 0.07 }); },
    roundStart() { tone({ wave: 'triangle', freq: 520, dur: 0.15, vol: 0.18 }); tone({ wave: 'triangle', freq: 780, dur: 0.25, vol: 0.18, delay: 0.15 }); },
    win() { [520, 660, 780, 1040].forEach((f, i) => tone({ wave: 'triangle', freq: f, dur: 0.22, vol: 0.16, delay: i * 0.12 })); },
    lose() { [440, 370, 300].forEach((f, i) => tone({ wave: 'triangle', freq: f, dur: 0.28, vol: 0.16, delay: i * 0.16 })); }
  };
})();
