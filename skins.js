/* CS Arena - skins d'armes du pass de combat : motifs procéduraux répétables (512 px) et matériaux triplanaires.
   Les mêmes images sont exportées pour la version Godot (export/export.js). */
window.Skins = (function () {
  'use strict';
  const S = 512;
  const SK = () => (window.CS && CS.SKINS) || {};
  const cache = {}, mats = {}, thumbs = {};

  // ---------- outils ----------
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // bruit de valeur répétable : px, py = nombre de cellules sur la largeur (la texture boucle)
  function noise(seed) {
    const R = rng(seed), T = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) T[i] = R();
    const at = (x, y) => T[((y & 63) * 64 + (x & 63)) & 4095];
    return (u, v, px, py) => {   // u, v dans [0, 1)
      const x = u * px, y = v * py, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const m = (a, b) => ((a % b) + b) % b;
      const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
      const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  function fbm(n, u, v, p, oct, py) {
    let s = 0, a = 0.5, f = 1, w = 0;
    for (let i = 0; i < oct; i++) { s += a * n(u, v, p * f, (py || p) * f); w += a; a *= 0.5; f *= 2; }
    return s / w;
  }
  // remplit l'image pixel par pixel : f(u, v) -> [r, g, b]
  function pixels(g, f) {
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = f(x / S, y / S), i = (y * S + x) * 4;
      d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  // dessin répété sur les bords (la texture boucle)
  function wrap(g, fn) { for (let dx = -S; dx <= S; dx += S) for (let dy = -S; dy <= S; dy += S) { g.save(); g.translate(dx, dy); fn(); g.restore(); } }
  const css = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')';

  // ---------- motifs ----------
  const PAT = {
    solid(g, C, R, seed) {   // peinture unie, légèrement brossée
      const n = noise(seed), n2 = noise(seed + 7);
      pixels(g, (u, v) => { const b = fbm(n, u, v, 2, 3, 48), m = fbm(n2, u, v, 4, 3); return mix(C[0], C[1] || C[0], clamp(b * 0.7 + m * 0.5 - 0.25, 0, 1)); });
    },
    camo(g, C, R, seed) {   // taches arrondies superposées
      const L = C.slice(1).map((c, i) => ({ c, n: noise(seed + 11 * (i + 1)), t: 0.52 + i * 0.02 }));
      pixels(g, (u, v) => {
        let c = C[0];
        for (const l of L) { const h = fbm(l.n, u, v, 3, 4); if (h > l.t) c = mix(c, l.c, sstep(l.t, l.t + 0.015, h)); }
        return c;
      });
    },
    digital(g, C, R, seed) {   // camouflage en pixels
      const n = noise(seed), n2 = noise(seed + 3), cell = 16;
      for (let y = 0; y < S; y += cell / 2) for (let x = 0; x < S; x += cell / 2) {
        const u = (x + cell / 4) / S, v = (y + cell / 4) / S;
        const h = fbm(n, u, v, 4, 3) * 0.75 + n2(u, v, 32, 32) * 0.25;
        const i = h < 0.38 ? 0 : h < 0.5 ? 1 : h < 0.62 ? 2 : 3;
        g.fillStyle = css(C[Math.min(i, C.length - 1)]); g.fillRect(x, y, cell / 2, cell / 2);
      }
    },
    circuit(g, C, R, seed) {   // pistes lumineuses sur fond sombre
      const n = noise(seed);
      pixels(g, (u, v) => mix(C[0], C[2], fbm(n, u, v, 3, 3) * 0.35));
      const cell = 32, N = S / cell;
      const lines = [];
      for (let i = 0; i < 46; i++) {
        let x = (R() * N) | 0, y = (R() * N) | 0; const pts = [[x, y]];
        let dir = (R() * 4) | 0;
        for (let k = 0; k < 3 + ((R() * 5) | 0); k++) {
          const L = 1 + ((R() * 3) | 0);
          const d = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1]][dir];
          x += d[0] * L; y += d[1] * L; pts.push([x, y]);
          dir = R() < 0.5 ? (dir + 1) % 4 : R() < 0.5 ? 4 + ((R() * 2) | 0) : dir;
        }
        lines.push({ pts, bright: R() < 0.55 });
      }
      wrap(g, () => {
        for (const l of lines) {
          g.strokeStyle = css(l.bright ? C[1] : C[2]); g.lineWidth = l.bright ? 3 : 2; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); l.pts.forEach((p, i) => (i ? g.lineTo(p[0] * cell, p[1] * cell) : g.moveTo(p[0] * cell, p[1] * cell))); g.stroke();
          const e = l.pts[l.pts.length - 1];
          g.fillStyle = css(C[1]); g.beginPath(); g.arc(e[0] * cell, e[1] * cell, l.bright ? 5 : 3.5, 0, 6.283); g.fill();
          g.fillStyle = css(C[0]); g.beginPath(); g.arc(e[0] * cell, e[1] * cell, l.bright ? 2 : 1.5, 0, 6.283); g.fill();
        }
      });
    },
    hex(g, C, R, seed) {   // nid d'abeilles
      const n = noise(seed), nx = 8, ny = 10, sx = S / nx, sy = S / ny, rx = sx / Math.sqrt(3), ry = sy / 1.5;
      g.fillStyle = css(C[0]); g.fillRect(0, 0, S, S);
      wrap(g, () => {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const cx = i * sx + (j % 2 ? sx / 2 : 0), cy = j * sy;
          const h = n(i / nx, j / ny, nx, ny);
          g.beginPath();
          for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * ry * 0.9); }
          g.closePath();
          g.fillStyle = css(mix(C[0], C[1], h > 0.7 ? 0.9 : h * 0.55)); g.fill();
          g.strokeStyle = css(C[2], h > 0.78 ? 1 : 0.45); g.lineWidth = h > 0.78 ? 3 : 1.6; g.stroke();
        }
      });
    },
    damascus(g, C, R, seed) {   // acier de Damas : couches ondulées
      const n = noise(seed);
      pixels(g, (u, v) => {
        const w = fbm(n, u, v, 3, 4);
        const s = Math.sin((v * 10 + w * 3.2 + Math.sin(u * 6.283 * 2) * 0.35) * 6.283);
        const t = s * 0.5 + 0.5;
        const base = mix(C[0], C[1], sstep(0.2, 0.85, t));
        return mix(base, C[2], sstep(0.88, 1, 1 - Math.abs(s)) * 0.55);
      });
    },
    carbon(g, C, R) {   // fibre de carbone tissée (2/2)
      const c = 16;
      for (let y = 0; y < S; y += c) for (let x = 0; x < S; x += c) {
        const k = ((x / c + y / c) | 0) % 4 < 2;
        const gr = k ? g.createLinearGradient(x, y, x + c, y) : g.createLinearGradient(x, y, x, y + c);
        gr.addColorStop(0, css(C[0])); gr.addColorStop(0.5, css(C[1])); gr.addColorStop(1, css(C[0]));
        g.fillStyle = gr; g.fillRect(x, y, c, c);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, c - 1, c - 1);
      }
    },
    splatter(g, C, R, seed) {   // peinture projetée
      const n = noise(seed);
      pixels(g, (u, v) => mix(C[0], mix(C[0], [0, 0, 0], 0.25), fbm(n, u, v, 4, 3) * 0.6));
      const spl = [];
      for (let i = 0; i < 60; i++) spl.push({ x: R() * S, y: R() * S, r: 6 + R() * R() * 46, c: C[1 + ((R() * (C.length - 1)) | 0)], d: 4 + ((R() * 9) | 0), a: R() * 6.283 });
      wrap(g, () => {
        for (const s of spl) {
          g.fillStyle = css(s.c);
          g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
          for (let k = 0; k < s.d; k++) {   // gouttes autour
            const a = s.a + k * 1.7, d = s.r * (1.1 + ((k * 37) % 10) / 6), r = s.r * (0.08 + ((k * 13) % 7) / 40);
            g.beginPath(); g.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, r, 0, 6.283); g.fill();
          }
        }
      });
    },
    tiger(g, C, R, seed) {   // rayures de tigre
      const n = noise(seed), n2 = noise(seed + 5);
      pixels(g, (u, v) => {
        const w = fbm(n, u, v, 3, 4), t = fbm(n2, u, v, 2, 3);
        const s = Math.sin((u * 7 + w * 2.6) * 6.283);
        const stripe = sstep(0.55 - t * 0.5, 0.62 - t * 0.5, s);
        const base = mix(C[0], C[2] || C[0], sstep(0.3, 0.9, w));
        return mix(base, C[1], stripe);
      });
    },
    marble(g, C, R, seed) {   // marbre veiné
      const n = noise(seed), n2 = noise(seed + 9);
      pixels(g, (u, v) => {
        const w = fbm(n, u, v, 3, 5);
        const s = Math.sin(((u + v) * 3 + w * 5) * 6.283) * 0.5 + 0.5;
        const base = mix(C[0], C[1], sstep(0.15, 0.95, fbm(n2, u, v, 2, 3)));
        return mix(base, C[2], Math.pow(1 - Math.abs(s * 2 - 1), 10) * 0.9);
      });
    },
    scales(g, C, R, seed) {   // écailles qui se chevauchent
      const n = noise(seed), nx = 8, ny = 16, sx = S / nx, sy = S / ny, r = sx * 0.62;
      g.fillStyle = css(C[2]); g.fillRect(0, 0, S, S);
      wrap(g, () => {
        for (let j = ny; j >= -1; j--) for (let i = -1; i <= nx; i++) {
          const cx = i * sx + (j % 2 ? sx / 2 : 0), cy = j * sy;
          const h = n((((i % nx) + nx) % nx) / nx, (((j % ny) + ny) % ny) / ny, nx, ny);
          const gr = g.createRadialGradient(cx, cy - r * 0.35, r * 0.1, cx, cy, r);
          gr.addColorStop(0, css(mix(C[1], C[2], 0.25 + h * 0.3))); gr.addColorStop(0.65, css(mix(C[1], C[0], 0.35 + h * 0.3))); gr.addColorStop(1, css(C[0]));
          g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI); g.lineTo(cx - r, cy); g.fill();
          g.strokeStyle = css(C[2], 0.6); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r - 1, 0.15, Math.PI - 0.15); g.stroke();
        }
      });
    },
    waves(g, C, R, seed) {   // houle profonde
      const n = noise(seed);
      pixels(g, (u, v) => {
        const w = fbm(n, u, v, 3, 5);
        const s = Math.sin((v * 6 + w * 2.4 + Math.sin(u * 6.283 * 3) * 0.12) * 6.283) * 0.5 + 0.5;
        const base = mix(C[0], C[1], sstep(0.1, 0.9, w));
        return mix(base, C[2], sstep(0.82, 0.98, s) * 0.85);
      });
    }
  };

  // image du skin (canvas 512 px, mise en cache)
  function canvas(id) {
    if (cache[id]) return cache[id];
    const d = SK()[id]; if (!d) return null;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), seed = hashStr(id);
    (PAT[d.pat] || PAT.solid)(g, d.c.map(hex), rng(seed), seed);
    // usure légère : petits éclats plus clairs
    const R = rng(seed + 99);
    g.globalAlpha = 0.07; g.fillStyle = '#ffffff';
    for (let i = 0; i < 160; i++) g.fillRect(R() * S, R() * S, 1 + R() * 3, 1);
    g.globalAlpha = 1;
    return (cache[id] = c);
  }
  // vignette (data URL) pour l'interface
  function thumb(id, size) {
    const k = id + '@' + (size || 96);
    if (thumbs[k]) return thumbs[k];
    const src = canvas(id); if (!src) return '';
    const c = document.createElement('canvas'); c.width = c.height = size || 96;
    c.getContext('2d').drawImage(src, 0, 0, S / 2, S / 2, 0, 0, c.width, c.height);
    return (thumbs[k] = c.toDataURL());
  }
  // matériau : motif projeté sur l'arme dans les 3 axes (pas besoin d'UV), lueur pour les motifs néon
  function material(id) {
    if (mats[id]) return mats[id];
    const d = SK()[id]; if (!d) return null;
    const tex = new THREE.CanvasTexture(canvas(id));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: d.met == null ? 0.3 : d.met, roughness: d.rough == null ? 0.5 : d.rough, envMapIntensity: 0.9 });
    const U = { tpMap: { value: tex }, tpScale: { value: d.sc || 4 }, tpGlow: { value: d.glow || 0 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTpP;\nvarying vec3 vTpN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTpP = position;\nvTpN = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTpP;\nvarying vec3 vTpN;\nuniform sampler2D tpMap;\nuniform float tpScale;\nuniform float tpGlow;')
        .replace('#include <map_fragment>', [
          'vec3 tpW = pow(abs(normalize(vTpN)), vec3(4.0)); tpW /= (tpW.x + tpW.y + tpW.z);',
          'vec3 tpQ = vTpP * tpScale;',
          'vec4 tpC = texture2D(tpMap, tpQ.zy) * tpW.x + texture2D(tpMap, tpQ.xz) * tpW.y + texture2D(tpMap, tpQ.xy) * tpW.z;',
          'tpC.rgb = pow(tpC.rgb, vec3(2.2));',
          'diffuseColor.rgb *= tpC.rgb;'].join('\n'))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tpC.rgb * tpGlow * smoothstep(0.08, 0.5, max(tpC.r, max(tpC.g, tpC.b)));');
    };
    m.customProgramCacheKey = () => 'skin-tp';
    m.userData.skin = id;
    return (mats[id] = m);
  }
  // nom affiché : « AK-47 | Tigre rouge »
  function label(id) {
    const d = SK()[id]; if (!d) return '';
    const w = window.CS && CS.WEAPONS[d.w];
    return (w ? w.n : d.w) + ' | ' + d.n;
  }
  return { canvas, thumb, material, label, SIZE: S };
})();
