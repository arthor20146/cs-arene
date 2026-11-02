/* CS Arena - moteur de rendu réaliste (three.js r128)
   Textures procédurales PBR, ciel, lumière, ombres, post-traitement, décor des cartes, particules.
   Aucun fichier image : tout est généré au chargement. */
window.GFX = (function () {
'use strict';
const QUALITIES = {
  low:  { label: 'Basse',   ratio: 1,   shadow: 0,    post: false, decor: 0.35, tex: 512,  aniso: 2,  lights: false },
  med:  { label: 'Moyenne', ratio: 1.5, shadow: 2048, post: false, decor: 1,    tex: 512,  aniso: 8,  lights: true },
  high: { label: 'Haute',   ratio: 2,   shadow: 4096, post: true,  decor: 1,    tex: 1024, aniso: 16, lights: true }
};
let qname = 'med', Q = QUALITIES.med;
try { const s = localStorage.getItem('cs_quality'); if (QUALITIES[s]) { qname = s; Q = QUALITIES[s]; } } catch (e) {}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- bruit périodique (textures sans raccord) ---------- */
const TAB = new Float32Array(65536);
{ const r = rng(12345); for (let i = 0; i < TAB.length; i++) TAB[i] = r(); }
function vnoise(x, y, p, o) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => TAB[(((a % p + p) % p) * 263 + ((b % p + p) % p) * 71 + o * 1009) & 65535];
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, base, oct, o) {
  let s = 0, a = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) { s += a * vnoise(u * p, v * p, p, (o || 0) + i); n += a; a *= 0.5; p *= 2; }
  return s / n;
}

/* ---------- surfaces PBR ---------- */
function makeSurface(size, fn, opt) {
  opt = opt || {};
  const N = size, hgt = new Float32Array(N * N);
  const mkc = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cA = mkc(), cN = mkc(), cR = mkc();
  const gA = cA.getContext('2d'), gN = cN.getContext('2d'), gR = cR.getContext('2d');
  const iA = gA.createImageData(N, N), iN = gN.createImageData(N, N), iR = gR.createImageData(N, N);
  const out = { r: 0, g: 0, b: 0, h: 0, ro: 1, me: 0 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    fn((x + 0.5) / N, (y + 0.5) / N, out);
    const i = (y * N + x) * 4;
    iA.data[i] = clamp(out.r, 0, 1) * 255; iA.data[i + 1] = clamp(out.g, 0, 1) * 255; iA.data[i + 2] = clamp(out.b, 0, 1) * 255; iA.data[i + 3] = 255;
    iR.data[i] = 0; iR.data[i + 1] = clamp(out.ro, 0, 1) * 255; iR.data[i + 2] = clamp(out.me, 0, 1) * 255; iR.data[i + 3] = 255;
    hgt[y * N + x] = out.h;
  }
  const st = (opt.normal || 2) * N / 512;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hL = hgt[y * N + (x + N - 1) % N], hR = hgt[y * N + (x + 1) % N], hU = hgt[((y + N - 1) % N) * N + x], hD = hgt[((y + 1) % N) * N + x];
    let nx = (hL - hR) * st, ny = (hU - hD) * st * -1, nz = 1 / 8; // y inversé : convention OpenGL
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    iN.data[i] = (nx * 0.5 + 0.5) * 255; iN.data[i + 1] = (ny * 0.5 + 0.5) * 255; iN.data[i + 2] = (nz * 0.5 + 0.5) * 255; iN.data[i + 3] = 255;
  }
  gA.putImageData(iA, 0, 0); gN.putImageData(iN, 0, 0); gR.putImageData(iR, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Q.aniso;
    if (srgb) t.encoding = THREE.sRGBEncoding; return t;
  };
  return { map: tex(cA, true), normalMap: tex(cN), roughnessMap: tex(cR) };
}
const hex3 = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const mix3 = (o, a, b, t) => { o.r = mix(a[0], b[0], t); o.g = mix(a[1], b[1], t); o.b = mix(a[2], b[2], t); };

const SURF = {
  sand(u, v, o) {
    const n = fbm(u, v, 4, 5), f = fbm(u, v, 40, 3, 7), rip = Math.sin((v * 22 + n * 7) * 6.283) * 0.5 + 0.5;
    mix3(o, hex3(0xcdb284), hex3(0xa2845a), sstep(0.32, 0.68, n));
    const k = 0.9 + 0.2 * f; o.r *= k; o.g *= k; o.b *= k;
    const peb = sstep(0.74, 0.8, fbm(u, v, 64, 2, 3));
    if (peb > 0) { const c = 0.8 + 0.3 * f; o.r = mix(o.r, 0.58 * c, peb * 0.7); o.g = mix(o.g, 0.5 * c, peb * 0.7); o.b = mix(o.b, 0.4 * c, peb * 0.7); }
    o.h = 0.5 * n + 0.035 * rip + 0.2 * f + peb * 0.12; o.ro = 0.92; o.me = 0;
  },
  plaster(u, v, o) {
    const n = fbm(u, v, 3, 6), st = fbm(u * 1, v, 2, 4, 5), f = fbm(u, v, 48, 3, 2);
    const chip = sstep(0.715, 0.725, fbm(u, v, 5, 6, 9));
    mix3(o, hex3(0xcbb691), hex3(0xa8926c), sstep(0.3, 0.7, st));
    const k = 0.92 + 0.16 * f; o.r *= k; o.g *= k; o.b *= k;
    if (chip > 0) {
      const row = Math.floor(v * 16), bx = (u * 8 + (row % 2) * 0.5) % 1, by = (v * 16) % 1;
      const mortar = bx < 0.05 || by < 0.1 ? 1 : 0;
      const b = mortar ? [0.55, 0.5, 0.42] : [0.6, 0.45, 0.34];
      o.r = mix(o.r, b[0] * k, chip); o.g = mix(o.g, b[1] * k, chip); o.b = mix(o.b, b[2] * k, chip);
    }
    o.h = 0.55 + 0.28 * n + 0.1 * f - chip * 0.5; o.ro = 0.9; o.me = 0;
  },
  stone(u, v, o) {
    const rows = 4, cols = 2, ry = v * rows, row = Math.floor(ry), fy = ry - row;
    const rx = u * cols + (row % 2) * 0.5, col = Math.floor(rx), fx = rx - col;
    const id = TAB[(((col % cols) + cols) % cols * 31 + row * 97) & 65535];
    const e = Math.min(Math.min(fx, 1 - fx) * 2.2, Math.min(fy, 1 - fy));
    const edge = sstep(0.02, 0.08, e);
    const n = fbm(u, v, 8, 4, 11), f = fbm(u, v, 48, 2, 4);
    const c = 0.82 + 0.28 * id;
    mix3(o, [0.46, 0.41, 0.33], [0.74 * c, 0.64 * c, 0.48 * c], edge * (0.7 + 0.3 * n));
    const k = 0.85 + 0.3 * f * n + 0.1; o.r *= k; o.g *= k; o.b *= k;
    o.h = edge * (0.55 + 0.1 * id) + 0.3 * n + 0.08 * f; o.ro = 0.88; o.me = 0;
  },
  concrete(u, v, o) {
    const n = fbm(u, v, 3, 6, 21), f = fbm(u, v, 60, 2, 8), st = fbm(u * 0.5 + 0.1, v, 6, 3, 13);
    const streak = fbm(u, v * 0.0 + 0.3, 16, 3, 14);
    const seam = Math.abs(v * 2 % 1 - 0.5) > 0.495 || Math.abs(u % 1 - 0.5) > 0.497 ? 1 : 0;
    const tu = (u * 2) % 1 - 0.5, tv = (v * 2 + 0.5) % 1 - 0.5, tie = Math.hypot(tu, tv) < 0.022 ? 1 : 0;
    const c = 0.46 + 0.17 * n + 0.1 * st - 0.09 * streak * (1 - v * 0.3);
    o.r = c * 1.0; o.g = c * 0.985; o.b = c * 0.95;
    const k = 0.93 + 0.14 * f; o.r *= k; o.g *= k; o.b *= k;
    if (seam || tie) { o.r *= 0.55; o.g *= 0.55; o.b *= 0.55; }
    o.h = 0.6 + 0.16 * n + 0.14 * f - (seam ? 0.5 : 0) - (tie ? 0.7 : 0); o.ro = 0.86; o.me = 0;
  },
  crate(u, v, o) {
    const fr = 0.11, inF = u < fr || u > 1 - fr || v < fr || v > 1 - fr;
    const d1 = Math.abs(u - v), inD = !inF && d1 < 0.07;
    const pl = inF ? 0 : Math.floor(u * 5), plK = TAB[(pl * 131 + (inD ? 500 : 0)) & 65535];
    const a = inF ? (u < fr || u > 1 - fr ? 1 : 0) : inD ? 2 : 0;
    const g = a === 0 || a === 1 ? fbm(u * 0.08 + plK, v, 12, 4, 31) : fbm(v, u * 0.08 + plK, 12, 4, 31);
    const fine = a === 0 || a === 1 ? vnoise(u * 180, v * 12, 16384, 2) : vnoise(v * 180, u * 12, 16384, 2);
    const c = 0.8 + 0.3 * plK;
    mix3(o, [0.56 * c, 0.41 * c, 0.24 * c], [0.36 * c, 0.24 * c, 0.13 * c], sstep(0.35, 0.65, g * 0.75 + fine * 0.25));
    const gapP = inF ? 0 : (Math.abs((u * 5) % 1 - 0.5) > 0.47 && !inD ? 1 : 0);
    let edge = 0;
    if (!inF) edge = Math.max(sstep(fr + 0.012, fr, Math.min(u, 1 - u, v, 1 - v)), inD ? sstep(0.06, 0.07, d1) : 0);
    if (gapP || edge > 0.2) { o.r *= 0.32; o.g *= 0.32; o.b *= 0.32; }
    o.h = (inF || inD ? 0.8 : 0.5) + g * 0.18 + fine * 0.05 - gapP * 0.5 - edge * 0.2; o.ro = 0.8; o.me = 0;
    const nu = (Math.min(u, 1 - u) - fr / 2), nv = (Math.min(v, 1 - v) - fr / 2);
    if (Math.hypot(nu, nv) < 0.011) { o.r = o.g = o.b = 0.2; o.me = 0.9; o.ro = 0.4; }
  },
  ribs(u, v, o) {
    const r = (u * 10) % 1, p = sstep(0.1, 0.22, r) - sstep(0.6, 0.72, r);
    const n = fbm(u, v, 4, 5, 41), dirt = fbm(u * 2 % 1, v, 3, 4, 42), f = fbm(u, v, 50, 2, 6);
    const rust = sstep(0.73, 0.78, n + (v > 0.92 ? 0.12 : 0) + (1 - p) * 0.02);
    const streak = sstep(0.42, 0.72, fbm(u, 0.2, 20, 3, 44)) * v;
    const c = 0.78 + 0.14 * f - 0.3 * streak - 0.22 * sstep(0.45, 0.8, dirt);
    o.r = c; o.g = c; o.b = c;
    if (rust > 0) { const k = 0.7 + 0.5 * f; o.r = mix(o.r, 0.46 * k, rust); o.g = mix(o.g, 0.26 * k, rust); o.b = mix(o.b, 0.15 * k, rust); }
    o.h = p * 0.9 + 0.05 * n - rust * 0.07; o.ro = mix(0.48, 0.92, rust); o.me = mix(0.75, 0.1, rust);
  },
  asphalt(u, v, o) {
    const n = fbm(u, v, 4, 5, 51), a = vnoise(u * 220, v * 220, 16384, 3), b = vnoise(u * 90, v * 90, 8192, 5);
    const crack = sstep(0.008, 0.003, Math.abs(fbm(u, v, 3, 5, 52) - 0.5));
    const c = 0.19 + 0.08 * n + 0.09 * (a - 0.5) + 0.05 * (b - 0.5);
    o.r = c * 1.02; o.g = c; o.b = c * 0.98;
    if (crack) { o.r *= 1 - crack * 0.7; o.g *= 1 - crack * 0.7; o.b *= 1 - crack * 0.7; }
    o.h = 0.6 + 0.3 * a + 0.14 * b - crack * 0.5; o.ro = 0.72 + 0.16 * n; o.me = 0;
  },
  fabric(u, v, o) {
    const w = Math.sin(u * 188.5) * Math.sin(v * 188.5), n = fbm(u, v, 6, 4, 61);
    const c = 0.82 + 0.1 * w + 0.16 * (n - 0.5); o.r = o.g = o.b = c;
    o.h = 0.5 + 0.3 * w + 0.3 * n; o.ro = 0.92; o.me = 0;
  },
  wood(u, v, o) {
    const g = fbm(u * 0.25, v, 8, 4, 71), r = Math.sin((v * 30 + g * 14) * 3.14) * 0.5 + 0.5;
    mix3(o, [0.4, 0.22, 0.1], [0.2, 0.1, 0.05], r * 0.7 + g * 0.3);
    o.h = r * 0.2 + g * 0.2; o.ro = 0.48; o.me = 0;
  }
};
const surf = {};
function getSurface(k) { return surf[k] || (surf[k] = makeSurface(k === 'fabric' || k === 'wood' ? 512 : Q.tex, SURF[k], { normal: { ribs: 3.2, crate: 2.2, sand: 1.1, stone: 3, plaster: 2.2, fabric: 0.8, concrete: 1.8, asphalt: 2.2, wood: 0.5 }[k] })); }

/* ---------- renderer / scène ---------- */
let renderer, scene, cam, sun, hemi, vmScene, vmSun, vmHemi, vmFill, muzzleL, pmrem = null;
const sunDir = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
const post = {};

function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = Q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.enabled = Q.shadow > 0;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(78, 1, 0.05, 900);
  cam.rotation.order = 'YXZ';
  scene.add(cam);
  hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 0.3);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = Q.shadow > 0;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  muzzleL = new THREE.PointLight(0xffb060, 0, 11, 2);
  muzzleL.visible = Q.lights;
  scene.add(muzzleL);
  vmScene = new THREE.Scene();
  vmHemi = new THREE.HemisphereLight(0xffffff, 0x777777, 0.3);
  vmSun = new THREE.DirectionalLight(0xffffff, 2);
  vmFill = new THREE.PointLight(0xffb060, 0, 3, 2);
  vmScene.add(vmHemi, vmSun, vmFill);
  applyShadow();
  initPost();
  resize();
  fx.init();
  return { renderer, scene, cam, vmScene };
}
function applyShadow() {
  if (!Q.shadow) return;
  const s = sun.shadow, c = s.camera, R = 60;
  c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 10; c.far = 260; c.updateProjectionMatrix();
  s.mapSize.set(Q.shadow, Q.shadow);
  if (s.map) { s.map.dispose(); s.map = null; }
}
function setQuality(name) {
  if (!QUALITIES[name] || name === qname) return;
  qname = name; Q = QUALITIES[name];
  try { localStorage.setItem('cs_quality', name); } catch (e) {}
  renderer.shadowMap.enabled = Q.shadow > 0;
  sun.castShadow = Q.shadow > 0;
  applyShadow();
  muzzleL.visible = Q.lights;
  renderer.toneMapping = Q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  const mark = (o) => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; }); };
  scene.traverse(mark); vmScene.traverse(mark);
  resize();
  if (cur.map) buildWorld(cur.map, true);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.ratio));
  renderer.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  resizePost(Math.floor(w * pr), Math.floor(h * pr));
  fx.resize(h * pr);
}

/* ---------- ciel (calculé une fois puis stocké dans un cubemap) ---------- */
const SKY = {
  dust: { sun: [0.58, 0.55, 0.42], col: 0xfff0d8, sunI: 2.5, zen: 0x2f6fc0, hor: 0xcfdde4, gnd: 0xc2a579, fog: 0xd9d2c0, dens: 0.0042, cloud: 0.42, cDark: 0.72, hemi: 0.1, env: 0.62 },
  docks: { sun: [-0.5, 0.44, 0.52], col: 0xffe1bd, sunI: 1.5, zen: 0x5a7288, hor: 0xc9ccc8, gnd: 0x4f5458, fog: 0xb8bfc2, dens: 0.0085, cloud: 0.82, cDark: 0.5, hemi: 0.14, env: 0.8 }
};
const skyFrag = `
varying vec3 vDir; uniform vec3 uZen,uHor,uGnd,uSun,uSunCol; uniform float uCloud,uCDark;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fb(vec2 p){float s=0.,a=.5;for(int i=0;i<6;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir); float y=d.y;
  vec3 c=mix(uHor,uZen,pow(clamp(y*1.25,0.,1.),.62));
  float s=max(dot(d,uSun),0.);
  c+=uSunCol*(pow(s,8.)*.16+pow(s,120.)*.5);
  if(y>0.){
    vec2 p=d.xz/(y+.12)*1.6;
    float f=fb(p+3.); float f2=fb(p+3.+uSun.xz*.14);
    float cov=smoothstep(1.-uCloud-.06,1.-uCloud+.26,f+.04)*smoothstep(.0,.13,y);
    float lit=clamp(.62+(f-f2)*3.2,0.,1.);
    vec3 cc=mix(vec3(uCDark)*vec3(.92,.95,1.),vec3(1.),lit)*(1.+pow(s,6.)*.35);
    c=mix(c,cc*1.03,cov*.95);
    s*=1.-cov*.9;
  }
  c+=uSunCol*smoothstep(.9996,.99985,s)*7.;
  if(y<0.)c=mix(uHor*.96,uGnd,smoothstep(0.,-.12,y));
  gl_FragColor=vec4(c,1.);
}`;
let skyRT = null, envRT = null, skyDome = null;
function setSky(id) {
  const K = SKY[id] || SKY.dust;
  const sd = new THREE.Vector3().fromArray(K.sun).normalize();
  sunDir.copy(sd);
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uZen: { value: lin(K.zen) }, uHor: { value: lin(K.hor) }, uGnd: { value: lin(K.gnd) }, uSun: { value: sd }, uSunCol: { value: lin(K.col) }, uCloud: { value: K.cloud }, uCDark: { value: K.cDark } },
    vertexShader: 'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: skyFrag
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat); sc.add(dome);
  if (skyRT) skyRT.dispose(); if (envRT) envRT.dispose();
  const hf = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const ressz = Q.tex >= 1024 ? 1024 : 512;
  skyRT = new THREE.WebGLCubeRenderTarget(ressz, { type: hf ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, format: THREE.RGBAFormat });
  const cc = new THREE.CubeCamera(0.5, 200, skyRT);
  const et = renderer.outputEncoding, tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding;
  cc.update(renderer, sc);
  renderer.outputEncoding = et; renderer.toneMapping = tm;
  if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileCubemapShader(); }
  envRT = pmrem.fromCubemap(skyRT.texture);
  mat.dispose(); dome.geometry.dispose();
  // dôme fixe autour de la caméra : lit le ciel précalculé
  if (!skyDome) {
    skyDome = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { t: { value: null } },
      vertexShader: 'varying vec3 vD;void main(){vD=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}',
      fragmentShader: 'varying vec3 vD;uniform samplerCube t;void main(){gl_FragColor=textureCube(t,vD);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}'
    }));
    skyDome.frustumCulled = false; skyDome.renderOrder = -10; scene.add(skyDome);
  }
  skyDome.material.uniforms.t.value = skyRT.texture;
  scene.background = new THREE.Color(0x8fa8bd);
  scene.environment = envRT.texture; vmScene.environment = envRT.texture;
  scene.fog = new THREE.FogExp2(lin(K.fog).getHex(), K.dens);
  sun.color.copy(lin(K.col)); sun.intensity = K.sunI;
  hemi.color.copy(lin(K.zen).lerp(new THREE.Color(1, 1, 1), 0.6)); hemi.groundColor.copy(lin(K.gnd)); hemi.intensity = K.hemi;
  sun.position.copy(sd).multiplyScalar(130); sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
  vmSun.color.copy(sun.color); vmSun.position.copy(sd).multiplyScalar(5);
  vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor);
  Object.keys(mats).forEach((k) => { mats[k].envMapIntensity = K.env; });
  cur.sky = K;
}
// vm : éclairage du bras selon qu'on est au soleil ou à l'ombre
function setVmSun(k, viewCam) { const K = cur.sky || SKY.dust; vmSun.intensity = K.sunI * (0.14 + 0.72 * k); vmHemi.intensity = K.hemi * 1.2; }

/* ---------- construction géométrique fusionnée ---------- */
class Batch {
  constructor() { this.b = {}; }
  get(k) { return this.b[k] || (this.b[k] = { p: [], n: [], u: [], c: [] }); }
  // quadrilatère : o = coin, a et b = vecteurs d'arête, uv depuis deux couples
  quad(k, o, a, b, n, u0, v0, u1, v1, c0, c1) {
    const B = this.get(k);
    const P = [o, [o[0] + a[0], o[1] + a[1], o[2] + a[2]], [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]], [o[0] + b[0], o[1] + b[1], o[2] + b[2]]];
    const U = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], C = [c0, c0, c1, c1];
    [0, 1, 2, 0, 2, 3].forEach((i) => { B.p.push(...P[i]); B.n.push(...n); B.u.push(...U[i]); B.c.push(C[i].r, C[i].g, C[i].b); });
  }
  geo(k, g, m, col, uvScale) {
    const B = this.get(k), gg = g.index ? g.toNonIndexed() : g;
    const P = gg.attributes.position, N = gg.attributes.normal, U = gg.attributes.uv;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); B.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); B.n.push(v.x, v.y, v.z);
      B.u.push(U.getX(i) * (uvScale || 1), U.getY(i) * (uvScale || 1)); B.c.push(col.r, col.g, col.b);
    }
  }
  // poutre/câble cylindrique entre deux points
  beam(k, a, b, r, col, seg) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    const g = new THREE.CylinderGeometry(r, r, L, seg || 5, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.geo(k, g, m, col); g.dispose();
  }
  // boîte visible avec textures à l'échelle du monde ; bands = [[y0,y1,surface,c0,c1],...]
  box(x, y0, z, w, h, d, tile, bands, topK, topCol, fit) {
    const hx = w / 2, hz = d / 2, y1 = y0 + h;
    const F = [
      [[x - hx, 0, z + hz], [w, 0, 0], [0, 0, 1], w],
      [[x + hx, 0, z + hz], [0, 0, -d], [1, 0, 0], d],
      [[x + hx, 0, z - hz], [-w, 0, 0], [0, 0, -1], w],
      [[x - hx, 0, z - hz], [0, 0, d], [-1, 0, 0], d]
    ];
    F.forEach((f) => {
      const off = fit ? 0 : (x + z * 1.7) * 0.37 % 1;
      const us = fit ? Math.max(1, Math.round(f[3] / tile)) : f[3] / tile;
      bands.forEach((b) => {
        const vs0 = fit ? Math.round(b[0] / tile) : b[0] / tile;
        const vs1 = fit ? Math.max(vs0 + 1, Math.round(b[1] / tile)) : b[1] / tile;
        this.quad(b[2], [f[0][0], b[0] + y0, f[0][2]], f[1], [0, b[1] - b[0], 0], f[2], off, vs0, off + us, vs1, b[3], b[4]);
      });
    });
    const ur = fit ? Math.max(1, Math.round(w / tile)) : w / tile, vr = fit ? Math.max(1, Math.round(d / tile)) : d / tile;
    this.quad(topK, [x - hx, y1, z + hz], [w, 0, 0], [0, 0, -d], [0, 1, 0], 0, 0, ur, vr, topCol, topCol);
  }
  mesh(k, mat, shadow, recv) {
    const B = this.b[k]; if (!B || !B.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    computeTangentSign(g);
    const m = new THREE.Mesh(g, mat); m.castShadow = !!shadow; m.receiveShadow = recv !== false; return m;
  }
}
function computeTangentSign() { /* three r128 calcule les tangentes dans le shader (dérivées) */ }

const mats = {};
function surfMat(k, o) {
  if (mats[k]) return mats[k];
  const s = getSurface(k);
  return (mats[k] = new THREE.MeshStandardMaterial(Object.assign({
    map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, metalnessMap: k === 'ribs' ? s.roughnessMap : null,
    roughness: 1, metalness: k === 'ribs' ? 1 : 0, vertexColors: true, envMapIntensity: 1
  }, o || {})));
}

/* ---------- atlas de détails muraux (fenêtres, portes, panneaux...) ---------- */
let atlas = null;
const AT = { win: 0, winB: 1, door: 2, doorW: 3, A: 4, B: 5, tag: 6, poster: 7, vent: 8, stain: 9, hazard: 10, sign: 11, lbl1: 12, lbl2: 13, lbl3: 14, lbl4: 15 };
function atlasTex() {
  if (atlas) return atlas;
  const S = 1024, C = S / 4, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = rng(77);
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * C, Math.floor(i / 4) * C); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
  const planks = (col, n, x, y, w, h) => { for (let i = 0; i < n; i++) { const k = 0.85 + r() * 0.25; g.fillStyle = col(k); g.fillRect(x + i * w / n, y, w / n - 1.5, h); g.fillStyle = 'rgba(0,0,0,.25)'; for (let j = 0; j < 4; j++) g.fillRect(x + i * w / n + r() * w / n, y, 1, h); } };
  const blue = (k) => `rgb(${50 * k | 0},${98 * k | 0},${122 * k | 0})`, brown = (k) => `rgb(${84 * k | 0},${56 * k | 0},${34 * k | 0})`;
  const win = (c1) => () => {
    g.fillStyle = '#6a5a44'; g.fillRect(26, 6, C - 52, C - 12);
    g.fillStyle = '#17181b'; g.fillRect(36, 16, C - 72, C - 32);
    g.strokeStyle = '#3a342c'; g.lineWidth = 6;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(36 + i * (C - 72) / 4, 16); g.lineTo(36 + i * (C - 72) / 4, C - 16); g.stroke(); }
    planks(c1, 3, 4, 14, 40, C - 28); planks(c1, 3, C - 44, 14, 40, C - 28);
  };
  cell(AT.win, win(blue)); cell(AT.winB, win(brown));
  const door = (c1) => () => { g.fillStyle = '#51452f'; g.fillRect(40, 0, C - 80, C); planks(c1, 6, 50, 10, C - 100, C - 10); g.fillStyle = '#1b1b1b'; g.fillRect(C - 76, C * 0.55, 8, 22); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(50, C - 22, C - 100, 22); };
  cell(AT.door, door(blue)); cell(AT.doorW, door(brown));
  const big = (t, col) => () => { g.font = 'bold 170px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(t, C * 0.38, C * 0.5); g.beginPath(); g.moveTo(C * 0.68, C * 0.38); g.lineTo(C * 0.93, C * 0.5); g.lineTo(C * 0.68, C * 0.62); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 320; i++) { g.fillStyle = 'rgba(0,0,0,' + r() * 0.5 + ')'; g.fillRect(r() * C, r() * C, 1 + r() * 7, 1 + r() * 3); } };
  cell(AT.A, big('A', 'rgba(205,46,30,.92)')); cell(AT.B, big('B', 'rgba(205,46,30,.92)'));
  cell(AT.tag, () => { g.lineCap = 'round'; ['rgba(30,30,34,.8)', 'rgba(170,40,50,.65)'].forEach((s, j) => { g.strokeStyle = s; g.lineWidth = 9 - j * 3; g.beginPath(); let x = 20 + j * 8, y = C * 0.6; g.moveTo(x, y); for (let i = 0; i < 12; i++) { x += 16; y = C * 0.5 + (r() - 0.5) * 90; g.quadraticCurveTo(x - 8, y + 30, x, y); } g.stroke(); }); });
  cell(AT.poster, () => { g.fillStyle = '#b5a98c'; g.fillRect(50, 24, C - 100, C - 48); g.fillStyle = '#8e2b22'; g.fillRect(64, 40, C - 128, 56); g.fillStyle = '#2d2a26'; for (let i = 0; i < 6; i++) g.fillRect(64, 112 + i * 18, (C - 128) * (0.6 + r() * 0.4), 8); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(C - 50, C - 24); g.lineTo(C - 110, C - 24); g.lineTo(C - 50, C - 88); g.fill(); });
  cell(AT.vent, () => { g.fillStyle = '#6f7274'; g.fillRect(30, 44, C - 60, C - 88); for (let i = 0; i < 9; i++) { g.fillStyle = '#26282a'; g.fillRect(40, 56 + i * 17, C - 80, 8); } g.fillStyle = 'rgba(110,60,25,.5)'; g.fillRect(30, C - 60, C - 60, 18); });
  cell(AT.stain, () => { for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(30,22,14,.05)'; const w = 8 + r() * 26; g.fillRect(C / 2 - 50 + r() * 100 - w / 2, 0, w, 40 + r() * 200); } });
  cell(AT.hazard, () => { for (let i = -6; i < 14; i++) { g.fillStyle = i % 2 ? '#d9a71e' : '#191919'; g.beginPath(); g.moveTo(i * 36, 0); g.lineTo(i * 36 + 36, 0); g.lineTo(i * 36 + 36 - C, C); g.lineTo(i * 36 - C, C); g.fill(); } });
  cell(AT.sign, () => { g.fillStyle = '#e6e2d6'; g.fillRect(14, 50, C - 28, C - 100); g.fillStyle = '#b5281e'; g.fillRect(14, 50, C - 28, 56); g.fillStyle = '#fff'; g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.fillText('DANGER', C / 2, 92); g.fillStyle = '#222'; g.font = 'bold 22px Arial'; g.fillText('ZONE INTERDITE', C / 2, 140); g.font = '17px Arial'; g.fillText('Port de sécurité', C / 2, 170); });
  ['KESTREL', 'NORDMAR', 'HALVOR', 'TERRAMAR'].forEach((t, i) => cell(AT.lbl1 + i, () => { g.fillStyle = 'rgba(240,240,235,.9)'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, C / 2, C / 2 - 16); g.font = '20px Arial'; g.fillText('CONTAINER LINE', C / 2, C / 2 + 26); g.globalCompositeOperation = 'destination-out'; for (let j = 0; j < 200; j++) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(r() * C, r() * C, 4, 2); } }));
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = Q.aniso;
  return (atlas = t);
}

/* ---------- monde ---------- */
const cur = { map: null, group: null, rays: [], sky: null, mid: '' };
const WHITE = new THREE.Color(1, 1, 1);
const shade = (k, tint) => { const c = (tint || WHITE).clone(); c.multiplyScalar(k); return c; };

// arches au-dessus des passages : bloquent les balles, pas le joueur (hors de portée)
const ARCHES = {
  dust: [[-31, 2, 6, 1.5, 3.6, 2.4], [0, 2, 8, 1.5, 3.8, 2.2], [31, 2, 6, 1.5, 3.6, 2.4]],
  docks: [[0, -4, 8, 1.5, 4.5, 0.7]]
};
// signalétique peinte sur les murs : x, y, z, normale x, normale z, cellule
const SIGNS = {
  dust: [[-24, 2.5, 2.76, 0, 1, 'A'], [24, 2.5, 2.76, 0, 1, 'B'], [-13.2, 2.5, -9, 1, 0, 'A'], [13.2, 2.5, -9, -1, 0, 'B']],
  docks: [[-31, 2.5, -3.24, 0, 1, 'A'], [31, 2.5, -3.24, 0, 1, 'B'], [-11.2, 2.5, -24, 1, 0, 'A'], [11.2, 2.5, -22, -1, 0, 'B']]
};

function blobShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}

function paintGround(M) {
  const S = 2048, W = 92, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = rng(M.id === 'dust' ? 5 : 6), px = S / W;
  const X = (x) => (x + W / 2) * px, Y = (z) => (z + W / 2) * px;
  const blob = (x, y, rad, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col + a + ')'); gr.addColorStop(1, col + '0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); };
  for (let i = 0; i < 260; i++) blob(r() * S, r() * S, 40 + r() * 170, r() < 0.5 ? 'rgba(30,22,14,' : 'rgba(235,220,190,', M.id === 'dust' ? 0.11 : 0.055);
  if (M.id === 'dust') { // traces de pas et de pneus
    g.strokeStyle = 'rgba(60,44,28,.06)'; g.lineWidth = 7;
    for (let i = 0; i < 40; i++) { g.beginPath(); const x = r() * S; let y = r() * S; g.moveTo(x, y); g.bezierCurveTo(x + r() * 300 - 150, y + 150, x + r() * 300 - 150, y + 300, x + r() * 200 - 100, y + 500); g.stroke(); }
  } else { // marquage au sol, rails, huile
    for (let i = 0; i < 40; i++) blob(r() * S, r() * S, 12 + r() * 46, 'rgba(8,8,10,', 0.5);
    g.setLineDash([60, 40]); g.strokeStyle = 'rgba(214,170,40,.72)'; g.lineWidth = 12;
    [[-23, -40, -23, 40], [23, -40, 23, 40], [-40, 30, 40, 30]].forEach((l) => { g.beginPath(); g.moveTo(X(l[0]), Y(l[1])); g.lineTo(X(l[2]), Y(l[3])); g.stroke(); });
    g.setLineDash([]); g.strokeStyle = 'rgba(70,72,76,.9)'; g.lineWidth = 6;
    [-37.4, -36.0].forEach((x) => { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), S); g.stroke(); });
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(r() * S, r() * S, 2 + r() * 12, 2 + r() * 12); } g.globalCompositeOperation = 'source-over';
  }
  // ombre de contact au pied de chaque obstacle
  g.save(); g.shadowColor = 'rgba(0,0,0,1)'; g.fillStyle = '#000';
  M.boxes.forEach((b) => {
    g.shadowBlur = 26 * Math.min(1.6, 0.5 + b.h / 4) * (px / 22); g.globalAlpha = 0.62;
    g.fillRect(X(b.x - b.w / 2), Y(b.z - b.d / 2), b.w * px, b.d * px);
  });
  g.restore();
  // sites de bombe : peinture au pochoir (usée)
  Object.keys(M.sites).forEach((k) => {
    const s = M.sites[k], col = 'rgba(190,42,30,';
    g.strokeStyle = col + '.62)'; g.lineWidth = 0.28 * px; g.setLineDash([1.6 * px, 1.0 * px]); g.beginPath(); g.arc(X(s.x), Y(s.z), s.r * px, 0, 7); g.stroke(); g.setLineDash([]);
    g.font = 'bold ' + (5 * px | 0) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col + '.68)'; g.fillText(k, X(s.x), Y(s.z));
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1400; i++) { g.fillStyle = 'rgba(0,0,0,' + r() * 0.5 + ')'; const a = r() * 7, d = r() * (s.r + 1) * px; g.fillRect(X(s.x) + Math.cos(a) * d, Y(s.z) + Math.sin(a) * d, 2 + r() * 14, 2 + r() * 7); }
    g.globalCompositeOperation = 'source-over';
  });
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = Q.aniso; return t;
}
function paintPuddles(seed) {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rng(seed);
  for (let i = 0; i < 14; i++) {
    const x = r() * S, y = r() * S; g.fillStyle = 'rgba(255,255,255,.9)'; g.filter = 'none';
    g.beginPath(); for (let a = 0; a < 6.3; a += 0.3) { const d = (24 + r() * 16) * (1 + (i % 3)); const px = x + Math.cos(a) * d * 1.6, py = y + Math.sin(a) * d; a ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.shadowColor = '#fff'; g.shadowBlur = 8; g.fill();
  }
  const t = new THREE.CanvasTexture(c); return t;
}

function buildWorld(M, force) {
  if (cur.group && cur.map === M && !force) return cur.rays;
  if (cur.mid !== M.id) { setSky(M.id); cur.mid = M.id; }
  if (cur.group) {
    scene.remove(cur.group);
    cur.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.userData.ownMat) { if (o.material.map) o.material.map.dispose(); if (o.material.alphaMap) o.material.alphaMap.dispose(); o.material.dispose(); } });
  }
  const G = new THREE.Group(); scene.add(G);
  cur.group = G; cur.map = M; cur.rays = [];
  const dust = M.id === 'dust', r = rng(dust ? 91 : 92), B = new Batch(), D = new Batch(), Far = new Batch();
  const wallK = dust ? 'plaster' : 'concrete', baseK = dust ? 'stone' : 'concrete', groundK = dust ? 'sand' : 'asphalt';
  const rayGroup = new THREE.Group(); G.add(rayGroup);
  const addRay = (x, y, z, w, h, d, mat, pen) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), RAYMAT);
    m.position.set(x, y + h / 2, z); m.visible = false; m.userData = { mat, pen }; m.updateMatrixWorld(); rayGroup.add(m); cur.rays.push(m);
  };
  // sol : maille 200 m + grand disque pour l'horizon
  const gm = surfMat(groundK).clone(); gm.vertexColors = false; gm.map = gm.map.clone(); gm.normalMap = gm.normalMap.clone(); gm.roughnessMap = gm.roughnessMap.clone();
  [gm.map, gm.normalMap, gm.roughnessMap].forEach((t) => { t.repeat.set(dust ? 300 : 260, dust ? 300 : 260); t.needsUpdate = true; });
  const groundGeo = new THREE.CircleGeometry(600, 48);
  const ground = new THREE.Mesh(groundGeo, gm); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.ownMat = true; G.add(ground);
  const gRay = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), RAYMAT); gRay.rotation.x = -Math.PI / 2; gRay.visible = false; gRay.userData = { mat: dust ? 'sand' : 'stone', pen: 0 }; gRay.updateMatrixWorld(); rayGroup.add(gRay); cur.rays.push(gRay);
  const ovT = paintGround(M);
  const ov = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), new THREE.MeshStandardMaterial({ map: ovT, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  ov.rotation.x = -Math.PI / 2; ov.position.y = 0.012; ov.receiveShadow = true; ov.renderOrder = 1; ov.userData.ownMat = true; G.add(ov);
  if (!dust) { // flaques : reflets du ciel
    const pt = paintPuddles(4);
    const pud = new THREE.Mesh(new THREE.PlaneGeometry(84, 84), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.08, metalness: 0, transparent: true, alphaMap: pt, opacity: 0.62, depthWrite: false, envMapIntensity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pud.rotation.x = -Math.PI / 2; pud.position.y = 0.016; pud.renderOrder = 2; pud.userData.ownMat = true; G.add(pud);
  }
  // obstacles
  M.boxes.forEach((b, i) => {
    const tint = new THREE.Color().setHSL(0, 0, 0.88 + r() * 0.14);
    const big = b.h >= 2.8 && b.t !== 'cont';
    if (b.t === 'cont') {
      const col = lin(b.c || 0x777777);
      B.box(b.x, 0, b.z, b.w, b.h, b.d, 2.44, [[0, 0.5, 'ribs', shade(0.58, col), shade(0.92, col)], [0.5, b.h, 'ribs', shade(0.92, col), shade(1.08, col)]], 'ribs', shade(0.75, col));
      const long = b.w > b.d, L = long ? b.w : b.d, T = long ? b.d : b.w, h = b.h;
      const addF = (ox, oz, w, d, y, hh, k) => { B.box(b.x + ox, y, b.z + oz, w, hh, d, 1, [[0, hh, 'ribs', shade(k * 0.8, col), shade(k, col)]], 'ribs', shade(k, col)); };
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((p) => { const a = p[0] * ((long ? L : T) / 2 - 0.05), e = p[1] * ((long ? T : L) / 2 - 0.05); addF(a, e, 0.16, 0.16, 0, h, 0.72); });
      const tiers = h > 3 ? 2 : 1, th = h / tiers;
      for (let t = 0; t < tiers; t++) { // longerons
        [0.04, th - 0.06].forEach((y) => { const yy = t * th + y; if (long) { addF(0, b.d / 2 - 0.05, b.w, 0.14, yy, 0.13, 0.72); addF(0, -b.d / 2 + 0.05, b.w, 0.14, yy, 0.13, 0.72); } else { addF(b.w / 2 - 0.05, 0, 0.14, b.d, yy, 0.13, 0.72); addF(-b.w / 2 + 0.05, 0, 0.14, b.d, yy, 0.13, 0.72); } });
      }
      // portes : barres de fermeture sur un petit côté
      const end = long ? 1 : 0;
      for (let k = -1; k <= 1; k += 2) for (let q = -1; q <= 1; q += 2) {
        const off = q * T * 0.15 * (k > 0 ? 1 : 1.9), e = (long ? L : L) / 2 + 0.05;
        const a = new THREE.Vector3(end ? e : off, 0.1, end ? off : e), bb = new THREE.Vector3(end ? e : off, h - 0.1, end ? off : e);
        a.x += b.x; a.z += b.z; bb.x += b.x; bb.z += b.z;
        B.beam('ribs', a, bb, 0.022, shade(0.5, col), 6);
      }
      // nom de compagnie sur le flanc
      const lb = AT.lbl1 + (i % 4), sz = Math.min(L * 0.6, 3.4);
      if (long) decal(D, b.x, 1.4, b.z + b.d / 2 + 0.03, 0, 1, sz, sz, lb); else decal(D, b.x + b.w / 2 + 0.03, 1.4, b.z, 1, 0, sz, sz, lb);
      addRay(b.x, 0, b.z, b.w, b.h, b.d, 'metal', 2);
    } else if (b.t === 'barrel') {
      const pal = [0x35506a, 0x7a2d24, 0x3d5a3a, 0x6b6a60], col = lin(pal[i % 4]);
      const g = new THREE.CylinderGeometry(0.33, 0.33, 1.0, 18, 1, true), mx = new THREE.Matrix4().makeTranslation(b.x, 0.5, b.z);
      B.geo('ribsS', g, mx, col, 1); g.dispose();
      const cap = new THREE.CircleGeometry(0.33, 18); B.geo('ribsS', cap, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(b.x, 1.0, b.z), shade(0.7, col), 0.3); cap.dispose();
      [0.02, 0.33, 0.66, 0.98].forEach((y) => { const t = new THREE.TorusGeometry(0.335, 0.015, 5, 18); B.geo('ribsS', t, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(b.x, y, b.z), shade(0.8, col), 0.1); t.dispose(); });
      addRay(b.x, 0, b.z, 0.66, 1, 0.66, 'metal', 2);
    } else if (big) {
      const isWh = !dust && b.h === 7;
      const wc = shade(1, tint), low = shade(0.56, tint), mid = shade(0.86, tint), top = shade(1.05, tint);
      if (isWh) {
        const c = lin(0x6f7d78);
        B.box(b.x, 0, b.z, b.w, b.h, b.d, 2.44, [[0, 1.0, 'concrete', low, wc], [1.0, b.h, 'ribs', shade(0.85, c), shade(1, c)]], 'ribs', shade(0.6, c));
      } else if (dust) {
        B.box(b.x, 0, b.z, b.w, b.h, b.d, 6.4, [[0, 1.0, 'stone', low, mid], [1.0, 2.0, 'plaster', mid, wc], [2.0, b.h - 0.32, 'plaster', wc, top], [b.h - 0.32, b.h, 'stone', top, top]], 'stone', shade(0.9, tint));
        B.box(b.x, b.h, b.z, b.w + 0.2, 0.14, b.d + 0.2, 3, [[0, 0.14, 'stone', shade(0.9, tint), top]], 'stone', top);
      } else {
        B.box(b.x, 0, b.z, b.w, b.h, b.d, 4, [[0, 0.6, 'concrete', low, mid], [0.6, 2.2, 'concrete', mid, wc], [2.2, b.h, 'concrete', wc, top]], 'concrete', shade(0.8, tint));
        B.box(b.x, b.h, b.z, b.w + 0.1, 0.1, b.d + 0.1, 4, [[0, 0.1, 'concrete', mid, mid]], 'concrete', mid);
      }
      addRay(b.x, 0, b.z, b.w, b.h, b.d, isWh ? 'metal' : 'stone', 0);
    } else {
      const wood = shade(1, tint);
      B.box(b.x, 0, b.z, b.w, b.h, b.d, 1.3, [[0, b.h, 'crate', shade(0.72, tint), wood]], 'crate', shade(0.92, tint), true);
      addRay(b.x, 0, b.z, b.w, b.h, b.d, 'wood', 1);
    }
  });
  // arches
  (ARCHES[M.id] || []).forEach((a) => {
    const [x, z, w, d, y, h] = a;
    if (dust) {
      B.box(x, y, z, w, h, d, 3, [[0, 0.26, 'stone', shade(0.7), shade(0.82)], [0.26, h - 0.32, 'plaster', shade(0.9), shade(1)], [h - 0.32, h, 'stone', shade(1), shade(1)]], 'stone', shade(0.9));
      const yb = lin(0x3a2c1e);
      B.box(x, y - 0.22, z, w + 0.5, 0.22, 0.32, 1.3, [[0, 0.22, 'crate', shade(0.75, yb), shade(1, yb)]], 'crate', yb);
    } else {
      B.box(x, y, z, w, h, d, 2.44, [[0, h, 'ribs', shade(0.5, lin(0xc9a12c)), shade(0.7, lin(0xc9a12c))]], 'ribs', shade(0.4));
      decal(D, x, y + h / 2, z + d / 2 + 0.02, 0, 1, 0.65, 0.65, AT.hazard); decal(D, x - 2, y + h / 2, z + d / 2 + 0.02, 0, 1, 0.65, 0.65, AT.hazard); decal(D, x + 2, y + h / 2, z + d / 2 + 0.02, 0, 1, 0.65, 0.65, AT.hazard);
    }
    addRay(x, y, z, w, h, d, dust ? 'stone' : 'metal', 0);
  });
  // pavage dur autour des sites sur Dust
  if (dust) Object.keys(M.sites).forEach((k) => {
    const s = M.sites[k], R = s.r + 1.6;
    B.quad('stone', [s.x - R, 0.008, s.z + R], [2 * R, 0, 0], [0, 0, -2 * R], [0, 1, 0], 0, 0, 2 * R / 2.2, 2 * R / 2.2, shade(0.78), shade(0.78));
  });
  // détails muraux : parcourt les grands murs
  M.boxes.forEach((b) => {
    if (b.h < 5.5 || b.t) return;
    const long = b.w > b.d, L = Math.max(b.w, b.d), isEnc = b.h >= 10;
    if (L < 3.5) return;
    [1, -1].forEach((s) => {
      const nx = long ? 0 : s, nz = long ? s : 0;
      const step = dust ? 7.5 : 11;
      for (let t = -L / 2 + 2.6; t < L / 2 - 2; t += step + r() * 3) {
        if (r() > Q.decor * 0.9) continue;
        const px = b.x + (long ? t : s * (b.w / 2 + 0.018)), pz = b.z + (long ? s * (b.d / 2 + 0.018) : t);
        const kind = r();
        if (dust) {
          if (kind < 0.42) { decal(D, px, isEnc ? 3.8 + (r() < 0.4 ? 3 : 0) : 3.7, pz, nx, nz, 1.5, 1.5, r() < 0.5 ? AT.win : AT.winB); }
          else if (kind < 0.62) decal(D, px, 1.1, pz, nx, nz, 2.2, 2.2, r() < 0.5 ? AT.door : AT.doorW);
          else if (kind < 0.76) decal(D, px, 1.5, pz, nx, nz, 1.4, 1.4, AT.poster);
          else decal(D, px, 1.5, pz, nx, nz, 2.3, 2.3, AT.tag);
          decal(D, px + nz * 0.4, b.h - 1.6, pz + nx * 0.4, nx, nz, 3, 3, AT.stain);
        } else {
          if (kind < 0.35) decal(D, px, 3.8, pz, nx, nz, 1.4, 1.4, AT.vent);
          else if (kind < 0.6) decal(D, px, 1.5, pz, nx, nz, 1.3, 1.3, AT.sign);
          else if (kind < 0.8) decal(D, px, 0.3, pz, nx, nz, 1.3, 0.6, AT.hazard);
          else decal(D, px, 1.5, pz, nx, nz, 2.3, 2.3, AT.tag);
          decal(D, px + nz * 0.5, b.h - 1.6, pz + nx * 0.5, nx, nz, 3.2, 3.2, AT.stain);
        }
        // tuyau de descente
        if (r() < 0.2) { const off = 0.08; B.beam('ribsS', new THREE.Vector3(px + nx * off + nz, 0, pz + nz * off + nx), new THREE.Vector3(px + nx * off + nz, b.h, pz + nz * off + nx), 0.05, lin(0x54575a), 7); }
      }
    });
  });
  (SIGNS[M.id] || []).forEach((s) => decal(D, s[0], s[1], s[2], s[3], s[4], 2.2, 2.2, AT[s[5]]));

  // bâches / auvents (Dust)
  const clothB = new Batch();
  if (dust) {
    [[-20, 2.77, 1, 0xb5442e], [21, 2.77, 1, 0x2e6b8a], [-9, 1.23, -1, 0xcda034], [9, 1.23, -1, 0x7c3a2e]].forEach((a) => {
      const [x, z, s, c] = a, w = 3.6, col = lin(c);
      for (let i = 0; i < 6; i++) {
        const cc = i % 2 ? col : lin(0xe6dcc6), xx = x - w / 2 + i * w / 6;
        clothB.quad('c', [xx, 3.3, z], [w / 6, 0, 0], [0, -0.55, s * 1.25], [0, 0.83, s * 0.55], 0, 0, 1, 1, cc, shade(0.85, cc));
      }
      [-1, 1].forEach((k) => B.beam('ribsS', new THREE.Vector3(x + k * w / 2, 2.75, z + s * 1.25), new THREE.Vector3(x + k * w / 2, 3.25, z), 0.02, lin(0x3a3a3a), 5));
    });
    // sacs de sable au pied des murs
    const sand = new THREE.SphereGeometry(1, 10, 6), lc = lin(0xb6a27c);
    [[-20, 3.45], [-20.8, 3.45], [-19.2, 3.45], [20, 3.45], [20.8, 3.45], [19.2, 3.45], [-3.5, -7], [3.5, -7]].forEach((p, i) => {
      for (let l = 0; l < 2; l++) { const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0] + l * 0.3, 0.13 + l * 0.22, p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 0.3), new THREE.Vector3(0.42, 0.14, 0.24)); B.geo('sand0', sand, m, shade(0.85 + r() * 0.2, lc), 0.3); }
    });
    sand.dispose();
    // poteaux et câbles électriques au-dessus des rues
    const poles = [[-14, 30], [14, 30], [-14, -2], [14, -2], [-14, -38], [14, -38]], wood = lin(0x3d2a1a), cable = lin(0x15151a);
    const tops = poles.map((p) => { const a = new THREE.Vector3(p[0] + 0.0, 0, p[1]), b = new THREE.Vector3(p[0], 8.6, p[1]); if (Math.abs(p[0]) === 14 && p[1] > 3) a.x = b.x = p[0] * 1.0; Far.beam('ribsS', a, b, 0.09, wood, 6); Far.beam('ribsS', new THREE.Vector3(p[0] - 0.7, 8.2, p[1]), new THREE.Vector3(p[0] + 0.7, 8.2, p[1]), 0.05, wood, 5); return b; });
    [[0, 1], [2, 3], [4, 5], [0, 2], [1, 3], [2, 4], [3, 5]].forEach((l) => {
      const a = tops[l[0]], b = tops[l[1]];
      [-0.6, 0.6].forEach((o) => { let pv = null; for (let i = 0; i <= 8; i++) { const t = i / 8, p = a.clone().lerp(b, t); p.x += o * (a.z === b.z ? 0 : 1); p.z += o * (a.z === b.z ? 1 : 0) * 0; p.y -= 0.2 + 1.1 * 4 * t * (1 - t) * 0.5; if (pv) Far.beam('ribsS', pv, p, 0.012, cable, 3); pv = p; } });
    });
  } else {
    // lampadaires de quai
    const pol = lin(0x4d5356);
    [[-38, 12], [38, 12], [-38, -24], [38, -24], [0, 38.6]].forEach((p) => {
      Far.beam('ribsS', new THREE.Vector3(p[0], 0, p[1]), new THREE.Vector3(p[0], 11, p[1]), 0.12, pol, 7);
      Far.beam('ribsS', new THREE.Vector3(p[0], 11, p[1]), new THREE.Vector3(p[0] * 0.92, 11.6, p[1]), 0.06, pol, 6);
    });
    // bollards d'amarrage
    const bc = lin(0x2a2c2e);
    [[-38, 34], [38, 34], [-38, -6], [38, -6]].forEach((p) => { const g = new THREE.CylinderGeometry(0.22, 0.3, 0.8, 12), m = new THREE.Matrix4().makeTranslation(p[0], 0.4, p[1]); B.geo('ribsS', g, m, bc, 0.5); g.dispose(); });
  }
  // horizon
  if (dust) {
    const pl = [0xfff6e6, 0xefe2cc, 0xfffdf6, 0xdccdb4];
    for (let i = 0; i < 90; i++) {
      const a = r() * 6.283, d = 58 + r() * 150, x = Math.cos(a) * d, z = Math.sin(a) * d, w = 10 + r() * 16, dp = 10 + r() * 16, h = 7 + r() * 13 + (d > 130 ? 6 : 0);
      const c = lin(pl[i % 4]), low = shade(0.74, c);
      Far.box(x, 0, z, w, h, dp, 3, [[0, h, 'plaster', low, c]], 'plaster', shade(0.8, c));
      if (r() < 0.16) { const g = new THREE.SphereGeometry(w * 0.34, 14, 8, 0, 6.3, 0, 1.57), m = new THREE.Matrix4().makeTranslation(x, h, z); Far.geo('plaster', g, m, shade(0.9, r() < 0.5 ? c : lin(0x9fb3bb)), 3); g.dispose(); }
      if (r() < 0.05) { const g = new THREE.CylinderGeometry(1.1, 1.5, 28 + r() * 10, 10), m = new THREE.Matrix4().makeTranslation(x + w, 15, z); Far.geo('plaster', g, m, c, 2); g.dispose(); }
    }
  } else {
    const steel = lin(0xa24f2a), blue = lin(0x2a4f73);
    [[-74, -30, 0], [-82, 40, 0], [80, 10, 1]].forEach((g) => {
      const [x, z] = g, c = g[2] ? blue : steel;
      [[-9, -8], [9, -8], [-9, 8], [9, 8]].forEach((p) => Far.box(x + p[0], 0, z + p[1], 1.5, 34, 1.5, 2.44, [[0, 34, 'ribs', shade(0.6, c), c]], 'ribs', c));
      Far.box(x, 32.6, z, 20.5, 1.4, 18, 2.44, [[0, 1.4, 'ribs', shade(0.7, c), c]], 'ribs', c);
      Far.box(x, 34, z, 60, 2.8, 2.6, 2.44, [[0, 2.8, 'ribs', shade(0.7, c), c]], 'ribs', c);
      Far.box(x, 36.8, z, 3.5, 12, 2.5, 2.44, [[0, 12, 'ribs', c, c]], 'ribs', c);
      Far.beam('ribsS', new THREE.Vector3(x + 1.7, 48, z), new THREE.Vector3(x + 29, 37, z), 0.14, c, 5); Far.beam('ribsS', new THREE.Vector3(x - 1.7, 48, z), new THREE.Vector3(x - 29, 37, z), 0.14, c, 5);
      Far.beam('ribsS', new THREE.Vector3(x + 12, 34, z), new THREE.Vector3(x + 12, 12, z), 0.05, lin(0x222222), 4);
    });
    const hull = lin(0x2c3440);
    Far.box(-150, 0, 0, 40, 18, 200, 8, [[0, 12, 'ribs', shade(0.45, lin(0x7d2a22)), shade(0.65, hull)], [12, 18, 'ribs', shade(0.7, hull), hull]], 'ribs', hull);
    Far.box(-150, 18, 70, 24, 22, 28, 4, [[0, 22, 'concrete', shade(0.95), WHITE]], 'concrete', shade(0.8));
    const pal = [0xb5432f, 0x2f6db5, 0x3f8a4a, 0xc98a2b, 0x7a3fa0, 0x8a8f96];
    for (let i = 0; i < 90; i++) {
      const row = i % 7, col = (i / 7) | 0, c = lin(pal[(i * 7 + (i >> 2)) % 6]), side = i % 2 ? 1 : -1;
      const x = side * (56 + row * 3.2), z = -60 + col * 8.5, y = ((i * 13) % 3) * 2.6;
      for (let t = 0; t <= y / 2.6; t++) Far.box(x, t * 2.6, z, 2.5, 2.55, 7.5, 2.44, [[0, 2.55, 'ribs', shade(0.72, c), c]], 'ribs', shade(0.7, c));
    }
  }
  // assemblage
  const add = (m, parent) => { if (m) (parent || G).add(m); return m; };
  ['plaster', 'stone', 'concrete', 'crate', 'ribs'].forEach((k) => add(B.mesh(k, surfMat(k), true)));
  add(B.mesh('ribsS', metalPlain(), true));
  add(B.mesh('sand0', surfMat(groundK === 'sand' ? 'sand' : 'crate'), true));
  ['plaster', 'stone', 'concrete', 'ribs'].forEach((k) => add(Far.mesh(k, surfMat(k), false, false)));
  add(Far.mesh('ribsS', metalPlain(), true, false));
  const dm = D.mesh('d', decalMat(), false); if (dm) { add(dm); dm.renderOrder = 2; }
  const cl = clothB.mesh('c', clothMat(), true); if (cl) add(cl);
  // petits cailloux instanciés
  const nRocks = Math.round((dust ? 340 : 140) * Q.decor);
  if (nRocks) {
    const rg = new THREE.IcosahedronGeometry(0.06, 0);
    const rocks = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: dust ? lin(0x8a7458) : lin(0x4a4a4a), roughness: 0.95 }), nRocks);
    const mx = new THREE.Matrix4(), walls = M.boxes.filter((b) => b.h > 1);
    for (let i = 0; i < nRocks; i++) {
      const b = walls[Math.floor(r() * walls.length)], side = r() < 0.5, s = r() < 0.5 ? 1 : -1, off = 0.1 + r() * r() * 1.2;
      const x = side ? b.x + s * (b.w / 2 + off) : b.x + (r() - 0.5) * b.w, z = side ? b.z + (r() - 0.5) * b.d : b.z + s * (b.d / 2 + off), sc = 0.5 + r() * r() * 2.5;
      mx.compose(new THREE.Vector3(x, 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(sc, sc * 0.7, sc));
      rocks.setMatrixAt(i, mx);
    }
    rocks.receiveShadow = true; rocks.userData.ownMat = true; G.add(rocks);
  }
  return cur.rays;
}
const RAYMAT = new THREE.MeshBasicMaterial();
let _mp = null, _dm = null, _cm = null;
function metalPlain() { return _mp || (_mp = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.55 })); }
function clothMat() { return _cm || (_cm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })); }
function decalMat() {
  return _dm || (_dm = new THREE.MeshStandardMaterial({ map: atlasTex(), transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
function decal(B, x, y, z, nx, nz, w, h, cell) {
  const u0 = (cell % 4) / 4, v1 = 1 - Math.floor(cell / 4) / 4, u1 = u0 + 0.25, v0 = v1 - 0.25;
  const ax = nz * w, az = -nx * w; // axe horizontal, orienté pour lire depuis l'extérieur
  const c = WHITE;
  B.quad('d', [x - ax / 2, y - h / 2, z - az / 2], [ax, 0, az], [0, h, 0], [nx, 0, nz], u0, v0, u1, v1, c, c);
}

/* ---------- post-traitement (qualité Haute) ---------- */
const QUADV = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
function initPost() {
  const hf = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  post.ok = !!hf;
  if (!hf) return;
  post.scene = new THREE.Scene(); post.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  post.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); post.quad.frustumCulled = false; post.scene.add(post.quad);
  const mk = (frag, u, extra) => new THREE.ShaderMaterial(Object.assign({ vertexShader: QUADV, fragmentShader: frag, uniforms: u, depthTest: false, depthWrite: false, toneMapped: false }, extra || {}));
  post.bright = mk('varying vec2 vUv;uniform sampler2D t;void main(){vec3 c=texture2D(t,vUv).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(1.,2.2,l),1.);}', { t: { value: null } });
  post.blur = mk('varying vec2 vUv;uniform sampler2D t;uniform vec2 d;void main(){vec3 c=texture2D(t,vUv).rgb*.227;c+=(texture2D(t,vUv+d*1.385).rgb+texture2D(t,vUv-d*1.385).rgb)*.316;c+=(texture2D(t,vUv+d*3.23).rgb+texture2D(t,vUv-d*3.23).rgb)*.07;gl_FragColor=vec4(c,1.);}', { t: { value: null }, d: { value: new THREE.Vector2() } });
  post.ao = mk(`varying vec2 vUv;uniform sampler2D tD;uniform float near,far,tanH,asp;
float vz(vec2 u){float d=texture2D(tD,u).x;return near*far/((far-near)*d-far);}
vec3 vp(vec2 u){float z=vz(u);vec2 n=u*2.-1.;return vec3(n.x*tanH*asp*-z,n.y*tanH*-z,z);}
float h(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
void main(){float d0=texture2D(tD,vUv).x;if(d0>=1.){gl_FragColor=vec4(1.);return;}
vec3 p=vp(vUv);vec3 n=normalize(cross(dFdx(p),dFdy(p)));float R=.7;float pr=R/(-p.z*tanH)*.5;pr=min(pr,.12);
float a=h(gl_FragCoord.xy)*6.283,ao=0.;
for(int i=0;i<10;i++){float t=(float(i)+.5)/10.;float r=sqrt(t);float an=a+float(i)*2.4;vec2 s=vUv+vec2(cos(an)/asp,sin(an))*r*pr;vec3 v=vp(s)-p;float l=length(v);float rng=smoothstep(R*1.6,R*.5,l);ao+=rng*max(dot(v,n)/max(l,.01)-.08,0.);}
ao=1.-ao/10.*1.7;float f=smoothstep(60.,20.,-p.z);gl_FragColor=vec4(vec3(mix(1.,clamp(ao,0.,1.),f)),1.);}`,
  { tD: { value: null }, near: { value: 0.05 }, far: { value: 900 }, tanH: { value: 1 }, asp: { value: 1 } }, { extensions: { derivatives: true } });
  post.mul = mk('varying vec2 vUv;uniform sampler2D t;uniform vec2 px;void main(){float a=texture2D(t,vUv).r;a+=texture2D(t,vUv+px*vec2(1.5,.5)).r+texture2D(t,vUv+px*vec2(-.5,1.5)).r+texture2D(t,vUv+px*vec2(-1.5,-.5)).r+texture2D(t,vUv+px*vec2(.5,-1.5)).r;gl_FragColor=vec4(vec3(a/5.),1.);}',
    { t: { value: null }, px: { value: new THREE.Vector2() } }, { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  post.final = mk(`varying vec2 vUv;uniform sampler2D t,tB;uniform vec2 px;uniform float time;
const mat3 I=mat3(.59719,.07600,.02840,.35458,.90834,.13383,.04823,.01566,.83777);
const mat3 O=mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602);
vec3 fit(vec3 v){vec3 a=v*(v+.0245786)-.000090537;vec3 b=v*(.983729*v+.4329510)+.238081;return a/b;}
vec3 aces(vec3 c){c*=1./.6;c=I*c;c=fit(c);c=O*c;return clamp(c,0.,1.);}
vec3 tm(vec3 c){return pow(aces(c),vec3(1./2.2));}
float L(vec3 c){return dot(c,vec3(.299,.587,.114));}
void main(){
 vec3 b=texture2D(tB,vUv).rgb;
 vec3 c0=tm(texture2D(t,vUv).rgb+b*.5);
 float lM=L(c0);
 vec3 a=tm(texture2D(t,vUv+px*vec2(-1,-1)).rgb),e=tm(texture2D(t,vUv+px*vec2(1,-1)).rgb),f=tm(texture2D(t,vUv+px*vec2(-1,1)).rgb),g=tm(texture2D(t,vUv+px*vec2(1,1)).rgb);
 float lA=L(a),lE=L(e),lF=L(f),lG=L(g);
 float mn=min(lM,min(min(lA,lE),min(lF,lG))),mx=max(lM,max(max(lA,lE),max(lF,lG)));
 vec2 dir=vec2(-((lA+lE)-(lF+lG)),(lA+lF)-(lE+lG));
 float rd=1./(min(abs(dir.x),abs(dir.y))+.02);dir=clamp(dir*rd,-4.,4.)*px;
 vec3 c=c0;
 if(mx-mn>.06){vec3 c1=.5*(tm(texture2D(t,vUv+dir*-.17).rgb)+tm(texture2D(t,vUv+dir*.17).rgb));c=c1;}
 vec2 q=vUv-.5;float v=1.-dot(q,q)*.5;c*=v;
 float n=fract(sin(dot(vUv*vec2(12.9,78.2),vec2(12.99,78.23))+time)*43758.5);c+=(n-.5)*.012;
 c=mix(vec3(L(c)),c,1.06);
 gl_FragColor=vec4(c,1.);}`, { t: { value: null }, tB: { value: null }, px: { value: new THREE.Vector2() }, time: { value: 0 } });
}
function resizePost(w, h) {
  if (!post.ok) return;
  if (post.rt) { post.rt.dispose(); post.rt.depthTexture.dispose(); post.b1.dispose(); post.b2.dispose(); post.rtAO.dispose(); }
  const lin0 = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType, format: THREE.RGBAFormat };
  post.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true });
  post.rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  post.b1 = new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), lin0);
  post.b2 = new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), lin0);
  post.rtAO = new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  post.w = w; post.h = h;
}
function pass(mat, target) { post.quad.material = mat; renderer.setRenderTarget(target); renderer.render(post.scene, post.cam); }

function render(t) {
  if (skyDome) skyDome.position.copy(cam.position);
  if (!Q.post || !post.ok) {
    renderer.autoClear = true; renderer.render(scene, cam);
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam); renderer.autoClear = true;
    return;
  }
  const p = post; renderer.autoClear = true;
  renderer.setRenderTarget(p.rt); renderer.clear(); renderer.render(scene, cam);
  renderer.autoClear = false;
  p.ao.uniforms.tD.value = p.rt.depthTexture; p.ao.uniforms.near.value = cam.near; p.ao.uniforms.far.value = cam.far;
  p.ao.uniforms.tanH.value = Math.tan(cam.fov * Math.PI / 360); p.ao.uniforms.asp.value = cam.aspect;
  pass(p.ao, p.rtAO);
  p.mul.uniforms.t.value = p.rtAO.texture; p.mul.uniforms.px.value.set(1 / p.rtAO.width, 1 / p.rtAO.height);
  pass(p.mul, p.rt);
  renderer.setRenderTarget(p.rt); renderer.clearDepth(); renderer.render(vmScene, vmCam);
  p.bright.uniforms.t.value = p.rt.texture; pass(p.bright, p.b1);
  const px = 1 / p.b1.width, py = 1 / p.b1.height;
  for (let i = 0; i < 2; i++) {
    p.blur.uniforms.t.value = p.b1.texture; p.blur.uniforms.d.value.set(px * (1 + i), 0); pass(p.blur, p.b2);
    p.blur.uniforms.t.value = p.b2.texture; p.blur.uniforms.d.value.set(0, py * (1 + i)); pass(p.blur, p.b1);
  }
  const f = p.final.uniforms; f.t.value = p.rt.texture; f.tB.value = p.b1.texture; f.px.value.set(1 / p.w, 1 / p.h); f.time.value = t % 10;
  pass(p.final, null);
  renderer.autoClear = true;
}
let vmCam = null;
function setVmCam(c) { vmCam = c; }

/* ---------- effets : particules, traçantes, impacts, douilles ---------- */
const fx = (function () {
  const MAX = 700;
  let ptsA, ptsB, parts = [], unif, tracers = [], lines, trArr, deco = {}, casings = [], casIM, casIdx = 0, flashI = 0, flashPos = new THREE.Vector3();
  const pV = 'attribute float aSize;attribute vec4 aCol;varying vec4 vC;uniform float uS;void main(){vC=aCol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(aSize*uS/max(-mv.z,.1),400.);gl_Position=projectionMatrix*mv;}';
  const pF = 'varying vec4 vC;void main(){vec2 q=gl_PointCoord-.5;float d=dot(q,q)*4.;if(d>1.)discard;float a=vC.a*(1.-d)*(1.-d);gl_FragColor=vec4(vC.rgb,a);#include <tonemapping_fragment>\n#include <encodings_fragment>\n}';
  const pF2 = pF.replace('gl_FragColor=vec4(vC.rgb,a);#include', 'gl_FragColor=vec4(vC.rgb,a);\n#include');
  function pool(add) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ uniforms: unif, vertexShader: pV, fragmentShader: pF2, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 5; p.userData.list = []; scene.add(p); return p;
  }
  function holeTex() {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rng(8);
    const gr = g.createRadialGradient(S / 2, S / 2, 3, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.16, 'rgba(8,7,6,1)'); gr.addColorStop(0.24, 'rgba(50,42,34,.75)'); gr.addColorStop(0.55, 'rgba(70,60,50,.28)'); gr.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(10,8,6,.6)'; g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) { let a = r() * 6.28, d = 10; g.beginPath(); g.moveTo(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d); for (let j = 0; j < 4; j++) { a += (r() - 0.5) * 0.7; d += 6 + r() * 7; g.lineTo(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d); } g.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  function bloodTex() {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rng(9);
    g.fillStyle = 'rgba(70,4,4,.95)';
    for (let i = 0; i < 38; i++) { const a = r() * 6.28, d = r() * r() * 100, q = 6 + (1 - d / 100) * 30 * r(); g.beginPath(); g.ellipse(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, q, q * (0.5 + r() * 0.5), a, 0, 7); g.fill(); }
    for (let i = 0; i < 60; i++) { const a = r() * 6.28, d = 60 + r() * 62; g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0.8 + r() * 3, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  function inst(tex, n, sz, opt) {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshStandardMaterial(Object.assign({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.75 }, opt || {})), n);
    m.frustumCulled = false; m.count = 0; m.renderOrder = 3; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
    return { m, n, i: 0, fill: 0 };
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _c = new THREE.Color();
  function put(d, pos, nor, sc, col, rot) {
    _q.setFromUnitVectors(_z, nor);
    if (rot) { const q2 = new THREE.Quaternion().setFromAxisAngle(_z, rot); _q.multiply(q2); }
    _p.copy(pos).addScaledVector(nor, 0.008); _s.set(sc, sc, 1);
    _m.compose(_p, _q, _s); d.m.setMatrixAt(d.i, _m);
    if (col) { d.m.setColorAt(d.i, col); if (d.m.instanceColor) d.m.instanceColor.needsUpdate = true; }
    d.m.instanceMatrix.needsUpdate = true; d.i = (d.i + 1) % d.n; d.fill = Math.min(d.n, d.fill + 1); d.m.count = d.fill;
  }
  return {
    init() {
      unif = { uS: { value: 800 } };
      ptsA = pool(false); ptsB = pool(true);
      // traçantes
      const g = new THREE.BufferGeometry(); trArr = new Float32Array(24 * 6);
      g.setAttribute('position', new THREE.BufferAttribute(trArr, 3).setUsage(THREE.DynamicDrawUsage));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(3.4, 2.5, 1.2), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      lines.frustumCulled = false; scene.add(lines);
      for (let i = 0; i < 24; i++) tracers.push({ a: new THREE.Vector3(), d: new THREE.Vector3(), l: 0, t: 1e9 });
      deco.hole = inst(holeTex(), 140, 0.2);
      deco.blood = inst(bloodTex(), 50, 1.0, { roughness: 0.5, envMapIntensity: 0.25 });
      casIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.006, 0.026, 6), new THREE.MeshStandardMaterial({ color: 0xb8892f, metalness: 0.95, roughness: 0.3 }), 40);
      casIM.frustumCulled = false; casIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const m0 = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 40; i++) casIM.setMatrixAt(i, m0);
      scene.add(casIM);
      for (let i = 0; i < 40; i++) casings.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), s: 0, life: 0, b: 0 });
    },
    resize(h) { if (unif) unif.uS.value = h * 0.62; },
    emit(o) {
      const L = (o.add ? ptsB : ptsA).userData.list; if (L.length >= MAX) L.shift();
      L.push(o); o.t = 0;
    },
    smoke(pos, col, n, spread, size, life, up) {
      for (let i = 0; i < n; i++) this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: (Math.random() - 0.5) * spread, vy: (Math.random() * 0.7 + (up || 0.1)) * spread, vz: (Math.random() - 0.5) * spread, g: -0.2, dr: 2.8, life: life * (0.7 + Math.random() * 0.6), s0: size * 0.35, s1: size, c: col, a: 0.55 });
    },
    debris(pos, nor, col, n, sp) {
      for (let i = 0; i < n; i++) this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: nor.x * sp + (Math.random() - 0.5) * sp, vy: nor.y * sp + Math.random() * sp * 0.8, vz: nor.z * sp + (Math.random() - 0.5) * sp, g: 9.8, dr: 0.5, life: 0.35 + Math.random() * 0.35, s0: 0.025, s1: 0.02, c: col, a: 1 });
    },
    sparks(pos, nor, n) {
      for (let i = 0; i < n; i++) this.emit({ add: 1, x: pos.x, y: pos.y, z: pos.z, vx: nor.x * 5 + (Math.random() - 0.5) * 8, vy: nor.y * 5 + Math.random() * 6, vz: nor.z * 5 + (Math.random() - 0.5) * 8, g: 9.8, dr: 1, life: 0.12 + Math.random() * 0.22, s0: 0.03, s1: 0.012, c: [6, 3.6, 1.4], a: 1 });
    },
    blood(pos, dir, n) {
      for (let i = 0; i < n; i++) this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 2 + (Math.random() - 0.5) * 2.4, vy: dir.y * 2 + Math.random() * 1.8, vz: dir.z * 2 + (Math.random() - 0.5) * 2.4, g: 9.8, dr: 0.6, life: 0.3 + Math.random() * 0.25, s0: 0.05, s1: 0.03, c: [0.14, 0.005, 0.005], a: 0.95 });
      this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x, vy: 0.2, vz: dir.z, g: 0, dr: 3, life: 0.28, s0: 0.1, s1: 0.5, c: [0.2, 0.012, 0.012], a: 0.4 });
    },
    fireball(pos) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * 6.28, e = Math.random() * 1.5, s = 5 + Math.random() * 18;
        this.emit({ add: 1, x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, g: -1, dr: 3.6, life: 0.4 + Math.random() * 0.5, s0: 2, s1: 6, c: [9, 3.6 + Math.random() * 2, 0.7], a: 0.7 });
      }
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * 6.28, s = 2 + Math.random() * 12, k = 0.04 + Math.random() * 0.08;
        this.emit({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 9, vz: Math.sin(a) * s, g: -0.5, dr: 1.8, life: 2.5 + Math.random() * 3.5, s0: 3, s1: 11, c: [k, k * 0.95, k * 0.9], a: 0.7 });
      }
      this.sparks(pos, new THREE.Vector3(0, 1, 0), 60);
    },
    hole(pos, nor, col, sc) { put(deco.hole, pos, nor, sc || 1, col || WHITE, Math.random() * 6.28); },
    bloodDecal(pos, nor, sc) { put(deco.blood, pos, nor, sc, null, Math.random() * 6.28); },
    clear() { ['hole', 'blood'].forEach((k) => { const d = deco[k]; d.i = 0; d.fill = 0; d.m.count = 0; }); },
    tracer(a, b) {
      let T = tracers[0];
      for (const t of tracers) if (t.t > t.l) { T = t; break; }
      T.a.copy(a); T.d.subVectors(b, a); T.l = T.d.length(); T.d.divideScalar(T.l || 1); T.t = 0;
    },
    flash(pos, k) { muzzleL.position.copy(pos); flashI = k; },
    casing(pos, vel) {
      const c = casings[casIdx = (casIdx + 1) % casings.length];
      c.p.copy(pos); c.v.copy(vel); c.r.set(Math.random() * 6, Math.random() * 6, 0); c.s = 12; c.life = 2.2; c.b = 0;
    },
    update(dt, cb) {
      [ptsA, ptsB].forEach((p) => {
        const L = p.userData.list, P = p.geometry.attributes.position.array, C = p.geometry.attributes.aCol.array, S = p.geometry.attributes.aSize.array;
        let n = 0;
        for (let i = L.length - 1; i >= 0; i--) {
          const o = L[i]; o.t += dt;
          if (o.t >= o.life) { L.splice(i, 1); continue; }
          const k = Math.exp(-o.dr * dt); o.vx *= k; o.vy = o.vy * k - o.g * dt; o.vz *= k;
          o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
          if (o.y < 0.02) { o.y = 0.02; o.vy *= -0.2; o.vx *= 0.6; o.vz *= 0.6; }
          const t = o.t / o.life;
          P[n * 3] = o.x; P[n * 3 + 1] = o.y; P[n * 3 + 2] = o.z;
          C[n * 4] = o.c[0]; C[n * 4 + 1] = o.c[1]; C[n * 4 + 2] = o.c[2]; C[n * 4 + 3] = o.a * (1 - t) * Math.min(1, o.t * 30);
          S[n] = o.s0 + (o.s1 - o.s0) * Math.sqrt(t); n++;
        }
        p.geometry.setDrawRange(0, n);
        p.geometry.attributes.position.needsUpdate = p.geometry.attributes.aCol.needsUpdate = p.geometry.attributes.aSize.needsUpdate = true;
      });
      let n = 0;
      tracers.forEach((t) => {
        if (t.t > t.l) return;
        t.t += 340 * dt;
        const a = Math.min(t.t, t.l), b = Math.max(0, a - 5);
        trArr[n++] = t.a.x + t.d.x * b; trArr[n++] = t.a.y + t.d.y * b; trArr[n++] = t.a.z + t.d.z * b;
        trArr[n++] = t.a.x + t.d.x * a; trArr[n++] = t.a.y + t.d.y * a; trArr[n++] = t.a.z + t.d.z * a;
      });
      lines.geometry.setDrawRange(0, n / 3); lines.geometry.attributes.position.needsUpdate = true;
      flashI = Math.max(0, flashI - dt * 60);
      muzzleL.intensity = flashI * 3; vmFill.intensity = flashI * 1.2;
      casings.forEach((c, i) => {
        if (c.life <= 0) return;
        c.life -= dt; c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt); c.r.x += c.s * dt; c.r.y += c.s * 0.7 * dt;
        if (c.p.y < 0.012 && c.v.y < 0) { c.p.y = 0.012; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.s *= 0.6; if (c.b++ < 2 && cb) cb(c.p); }
        _q.setFromEuler(c.r); _s.set(1, 1, 1); if (c.life <= 0) _s.set(0, 0, 0);
        _m.compose(c.p, _q, _s); casIM.setMatrixAt(i, _m);
      });
      casIM.instanceMatrix.needsUpdate = true;
    }
  };
})();

return {
  QUALITIES, get quality() { return qname; }, get Q() { return Q; }, sunDir, init, resize, setQuality, render, setVmCam, setVmSun, buildWorld, fx, Batch, lin, rng, surfMat, getSurface, clamp, blobShadow,
  get scene() { return scene; }, get cam() { return cam; }, get renderer() { return renderer; }, get vmScene() { return vmScene; }, get rays() { return cur.rays; }
};
})();
