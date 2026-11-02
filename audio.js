/* Sons synthétisés avec WebAudio (aucun fichier à charger) */
window.Snd = (function () {
  let ctx = null, master = null, noise = null, vol = 0.6;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }

  function out(pan) {
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(master); return p;
    }
    return master;
  }

  // rafale de bruit filtrée
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
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.5), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out(o.pan));
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // note simple (bip, grondement)
  function tone(o) {
    if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0), dur = o.dur || 0.1;
    const os = ctx.createOscillator(); os.type = o.wave || 'sine';
    os.frequency.setValueAtTime(o.freq || 440, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, o.vol || 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); g.connect(out(o.pan));
    os.start(t); os.stop(t + dur + 0.05);
  }

  const shotProfile = {
    knife: null,
    glock: { f: 1800, d: 0.09, t: 160 }, usp: { f: 1400, d: 0.1, t: 140 }, deagle: { f: 900, d: 0.18, t: 90 },
    mac10: { f: 2200, d: 0.07, t: 170 }, mp9: { f: 2000, d: 0.07, t: 160 }, nova: { f: 700, d: 0.22, t: 70 },
    ak47: { f: 1100, d: 0.14, t: 100 }, m4a1: { f: 1500, d: 0.1, t: 120 }, awp: { f: 500, d: 0.35, t: 55 },
    p250: { f: 1600, d: 0.1, t: 150 }, tec9: { f: 1900, d: 0.09, t: 165 }, fiveseven: { f: 1700, d: 0.09, t: 155 },
    ump45: { f: 1300, d: 0.09, t: 130 }, p90: { f: 2100, d: 0.07, t: 165 }, xm1014: { f: 750, d: 0.2, t: 75 },
    galil: { f: 1200, d: 0.12, t: 110 }, famas: { f: 1350, d: 0.11, t: 115 }, sg553: { f: 1000, d: 0.14, t: 95 },
    aug: { f: 1250, d: 0.12, t: 105 }, ssg08: { f: 700, d: 0.28, t: 70 }
  };

  return {
    init,
    setVolume(v) { vol = v; if (master) master.gain.value = v; },
    shot(id, v, pan) {
      const p = shotProfile[id]; if (!ctx || !p) return;
      v = v == null ? 1 : v;
      burst({ freq: p.f, sweep: p.f * 0.35, dur: p.d, vol: 0.55 * v, q: 0.8, pan });
      tone({ wave: 'triangle', freq: p.t * 1.6, to: p.t * 0.5, dur: p.d * 1.2, vol: 0.45 * v, pan });
    },
    knife(v) { burst({ freq: 3500, sweep: 800, dur: 0.12, vol: 0.25 * (v == null ? 1 : v), type: 'highpass' }); },
    reload() {
      burst({ freq: 2600, dur: 0.04, vol: 0.2, q: 4 });
      burst({ freq: 1800, dur: 0.05, vol: 0.25, q: 4, delay: 0.55 });
      burst({ freq: 3000, dur: 0.04, vol: 0.3, q: 4, delay: 1.2 });
    },
    click() { burst({ freq: 3000, dur: 0.03, vol: 0.2, q: 5 }); },
    step(v, pan) { burst({ freq: 260, dur: 0.07, vol: 0.18 * (v == null ? 1 : v), q: 1.2, pan }); },
    hit(hs) { tone({ wave: 'square', freq: hs ? 1500 : 900, to: hs ? 1100 : 600, dur: 0.07, vol: 0.12 }); },
    kill() { tone({ wave: 'square', freq: 700, dur: 0.08, vol: 0.12 }); tone({ wave: 'square', freq: 1100, dur: 0.12, vol: 0.12, delay: 0.08 }); },
    hurt() { burst({ freq: 300, dur: 0.15, vol: 0.5, q: 0.7 }); tone({ wave: 'sawtooth', freq: 160, to: 80, dur: 0.15, vol: 0.2 }); },
    beep(v, pan) { tone({ wave: 'square', freq: 1200, dur: 0.09, vol: 0.2 * (v == null ? 1 : v), pan }); },
    plant() { tone({ wave: 'square', freq: 500, dur: 0.12, vol: 0.2 }); tone({ wave: 'square', freq: 800, dur: 0.12, vol: 0.2, delay: 0.14 }); tone({ wave: 'square', freq: 1200, dur: 0.2, vol: 0.2, delay: 0.28 }); },
    defused() { tone({ wave: 'sine', freq: 600, dur: 0.15, vol: 0.25 }); tone({ wave: 'sine', freq: 900, dur: 0.3, vol: 0.25, delay: 0.15 }); },
    explode(v) {
      v = v == null ? 1 : v;
      burst({ freq: 600, sweep: 60, dur: 1.6, vol: 0.9 * v, q: 0.5, type: 'lowpass' });
      tone({ wave: 'sine', freq: 90, to: 25, dur: 1.5, vol: 0.9 * v });
    },
    buy() { tone({ wave: 'triangle', freq: 900, dur: 0.06, vol: 0.2 }); tone({ wave: 'triangle', freq: 1300, dur: 0.08, vol: 0.2, delay: 0.06 }); },
    roundStart() { tone({ wave: 'triangle', freq: 520, dur: 0.15, vol: 0.25 }); tone({ wave: 'triangle', freq: 780, dur: 0.25, vol: 0.25, delay: 0.15 }); },
    win() { [520, 660, 780, 1040].forEach((f, i) => tone({ wave: 'triangle', freq: f, dur: 0.22, vol: 0.22, delay: i * 0.12 })); },
    lose() { [440, 370, 300].forEach((f, i) => tone({ wave: 'triangle', freq: f, dur: 0.28, vol: 0.22, delay: i * 0.16 })); }
  };
})();
