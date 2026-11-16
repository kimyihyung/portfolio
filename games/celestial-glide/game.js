/* ══════════════════════════════════════════════════════════════════════
   Celestial Glide — a Three.js endless dodge racer
   Everything on screen is generated in code: the nebula is a fragment
   shader, the rings, crystals and motes are primitives, the sparks and
   starfield are vertex pools. No textures, no models, no downloads
   beyond the three.js module itself.
   ══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { AudioEngine } from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (dt, k) => 1 - Math.exp(-dt * k);

window.__cgErrors = window.__cgErrors || [];
window.__cgReady = false;

/* ── dimensions ─────────────────────────────────────────────────────── */
/* The corridor is authored at a fixed size and then scaled by K so that a
   narrow (portrait) viewport frames exactly the same composition as a wide
   one. K is derived from the camera frustum in resize(); on a desktop aspect
   it is 1, so the authored numbers below are the desktop field. */
const FIELD_W = 7.4;     // authored field half-width
const FIELD_H = 4.6;     // authored field half-height
let K = 1;               // viewport scale (1 on wide screens, smaller on portrait)
let FX = FIELD_W * K;    // effective field half-width in world units
let FY = FIELD_H * K;    // effective field half-height in world units
const SPAWN_Z = 205;     // where objects are born
const KILL_Z = 1.2;      // rocks and motes are culled just past the ship
const RING_KILL_Z = 6;   // rings grow past the camera, then die
const COMBO_TIME = 5;    // seconds of combo memory
const CAM_BACK = 10.4;

/* ── persisted best run ─────────────────────────────────────────────── */
const HS_KEY = 'celestial-glide.hs';
const store = {
  read() {
    const empty = { score: 0, gates: 0, combo: 0, runs: 0, dist: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(HS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return empty;
      return {
        score: raw.score | 0, gates: raw.gates | 0, combo: raw.combo | 0,
        runs: raw.runs | 0, dist: raw.dist | 0
      };
    } catch (e) { return empty; }
  },
  write(o) {
    try { localStorage.setItem(HS_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
};
let BEST = store.read();

/* ── run state ──────────────────────────────────────────────────────── */
const S = {
  phase: 'idle',        // idle | run | pause | over
  px: 0, py: 0, tx: 0, ty: 0, vx: 0, vy: 0,
  speed: 0, dist: 0, score: 0, combo: 0, comboT: 0, mult: 1,
  shield: 3, boost: 1, boostT: 0,
  invuln: 0, shake: 0, flash: 0,
  time: 0, runTime: 0, gates: 0, bestCombo: 0, peakMult: 1, sector: 1,
  nextWave: 0, fps: 60, frames: 0, acc: 0, quality: 1,
  newRecord: false, overAt: 0
};

let LANG = document.documentElement.getAttribute('lang') === 'ko' ? 'ko' : 'en';
function t(key) {
  const dict = window.CG_STRINGS || {};
  const pack = dict[LANG] || dict.en || {};
  return pack[key] !== undefined ? pack[key] : (dict.en && dict.en[key]) || key;
}

/* ══════════════════════════════════════════════════════════════════════
   renderer / scene
   ══════════════════════════════════════════════════════════════════════ */
const canvas = $('#scene');
let renderer = null;
let small = window.matchMedia('(max-width: 760px)').matches;

function noWebGL(msg) {
  window.__cgErrors.push(String(msg));
  document.body.classList.add('no-gl');
  const fb = $('#fallback');
  if (fb) fb.classList.add('on');
  const loader = $('#loader');
  if (loader) loader.classList.add('hidden');
}

try {
  const probe = document.createElement('canvas');
  const ctx = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!ctx) throw new Error('WebGL unavailable');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: !small, alpha: false, stencil: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 2 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x04060f, 1);
} catch (e) {
  noWebGL(e && e.message ? e.message : e);
}

const scene = new THREE.Scene();
/* near 0.5 (nothing in the scene is closer than the ship, ~10 units away)
   keeps the far/near ratio at 1:2400, so depth comparisons stay exact and no
   pair of surfaces can trade places in the depth buffer. */
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / Math.max(1, window.innerHeight), 0.5, 1200);
camera.position.set(0, 2.4, CAM_BACK);

/* ── nebula sky ─────────────────────────────────────────────────────── */
const skyUniforms = {
  uTime: { value: 0 },
  uQual: { value: 1 },
  uHue: { value: 0 }
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec3 vDir;
    uniform float uTime;
    uniform float uQual;
    uniform float uHue;

    float h3(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }
    float n3(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      float a = mix(mix(mix(h3(i + vec3(0,0,0)), h3(i + vec3(1,0,0)), f.x),
                        mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x),
                        mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
      return a;
    }
    void main() {
      vec3 d = normalize(vDir);
      float a = uTime * 0.016;
      float c = cos(a), s = sin(a);
      d.xy = mat2(c, -s, s, c) * d.xy;

      vec3 p = d * 2.6 + vec3(0.0, uTime * 0.012, 0.0);
      float t = uTime * 0.028;
      float f = 0.58 * n3(p + vec3(t, -t * 0.7, t * 0.5));
      f += 0.30 * n3(p * 2.15 + vec3(-t * 1.4, t * 0.8, 0.0));
      if (uQual > 0.5) f += 0.16 * n3(p * 4.4 + vec3(t * 2.0, 0.0, -t * 1.3));

      float band = smoothstep(0.24, 0.95, f);
      float core = smoothstep(0.60, 1.02, f);

      vec3 base = vec3(0.022, 0.032, 0.075);
      vec3 deep = vec3(0.13, 0.19, 0.56);
      vec3 warm = vec3(0.64, 0.26, 0.86);
      vec3 gold = vec3(0.66, 0.38, 0.14);

      vec3 col = mix(base, deep, band * 1.05);
      col = mix(col, warm, pow(band, 2.2) * 0.66);
      col = mix(col, gold, pow(core, 2.0) * 0.34 * (0.55 + 0.45 * sin(uHue)));

      float dust = smoothstep(0.40, 0.66, n3(p * 1.35 + vec3(t * 0.6, 0.0, -t * 0.4)));
      col *= mix(1.0, 0.26, dust);

      float forward = smoothstep(0.15, 1.0, -d.z);
      col += vec3(0.06, 0.15, 0.38) * pow(forward, 3.0) * 0.9;

      float vig = smoothstep(1.25, 0.1, length(d.xy));
      col *= 0.55 + 0.45 * vig;

      float g = h3(floor(d * 260.0));
      col += vec3(0.7, 0.82, 1.0) * step(0.9988, g) * 0.9;

      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skyMat);
sky.scale.setScalar(700);
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

/* ── starfield ──────────────────────────────────────────────────────── */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,.85)');
  grad.addColorStop(0.55, 'rgba(190,225,255,.22)');
  grad.addColorStop(1, 'rgba(140,190,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const GLOW = glowTexture();

const STAR_N = small ? 2200 : 3600;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_N * 3);
const starCol = new Float32Array(STAR_N * 3);
const starSize = new Float32Array(STAR_N);
for (let i = 0; i < STAR_N; i++) {
  starPos[i * 3] = rnd(-260, 260);
  starPos[i * 3 + 1] = rnd(-170, 170);
  starPos[i * 3 + 2] = rnd(-900, 30);
  const tint = Math.random();
  const c = new THREE.Color().setHSL(tint < 0.5 ? 0.58 : (tint < 0.82 ? 0.72 : 0.09), 0.55, 0.62 + Math.random() * 0.3);
  starCol[i * 3] = c.r; starCol[i * 3 + 1] = c.g; starCol[i * 3 + 2] = c.b;
  starSize[i] = rnd(0.5, 1.7);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
const starMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: GLOW },
    uPixel: { value: renderer ? renderer.getPixelRatio() : 1 },
    uScale: { value: 220 },
    uMax: { value: 13 }
  },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute float aSize;
    varying vec3 vC;
    uniform float uPixel;
    uniform float uScale;
    uniform float uMax;
    void main() {
      vC = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = -mv.z;
      gl_PointSize = aSize * uPixel * (uScale / max(dist, 1.0));
      gl_PointSize = clamp(gl_PointSize, 0.0, uMax);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vC;
    uniform sampler2D uMap;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      if (tex.a < 0.01) discard;
      gl_FragColor = vec4(vC * (0.7 + tex.a * 0.7), tex.a);
    }`,
  vertexColors: true
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

/* near-field dust: the same shader, a much closer box, so speed reads */
const DUST_N = small ? 260 : 430;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3);
const dustCol = new Float32Array(DUST_N * 3);
const dustSize = new Float32Array(DUST_N);
for (let i = 0; i < DUST_N; i++) {
  dustPos[i * 3] = rnd(-17, 17);
  dustPos[i * 3 + 1] = rnd(-11, 11);
  dustPos[i * 3 + 2] = rnd(-150, 8);
  dustCol[i * 3] = 0.26; dustCol[i * 3 + 1] = 0.42; dustCol[i * 3 + 2] = 0.62;
  dustSize[i] = rnd(0.22, 0.6);
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));
const dustMat = starMat.clone();
dustMat.uniforms.uScale.value = 120;
dustMat.uniforms.uMax.value = 8;
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);

/* ── lights (only the ship uses lit materials) ──────────────────────── */
scene.add(new THREE.HemisphereLight(0x5a7bff, 0x080a14, 0.75));
const keyLight = new THREE.DirectionalLight(0xc9dcff, 1.25);
keyLight.position.set(3.5, 6, 4);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xa06bff, 0.9);
rimLight.position.set(-5, -2, -6);
scene.add(rimLight);

/* ══════════════════════════════════════════════════════════════════════
   the ship
   ══════════════════════════════════════════════════════════════════════ */
const ship = new THREE.Group();
ship.scale.setScalar(0.58 * K);
scene.add(ship);

const hullMat = new THREE.MeshStandardMaterial({
  color: 0x7f9ac4, metalness: 0.22, roughness: 0.42,
  emissive: 0x2c5ea0, emissiveIntensity: 0.55, flatShading: true
});
const wingMat = new THREE.MeshStandardMaterial({
  color: 0x5c78a8, metalness: 0.3, roughness: 0.48,
  emissive: 0x2f5c96, emissiveIntensity: 0.6, flatShading: true
});
{
  const hull = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), hullMat);
  hull.scale.set(0.86, 0.34, 2.1);

  const wingGeo = new THREE.BoxGeometry(1.95, 0.06, 0.78);
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(-1.18, -0.02, 0.62);
  wingL.rotation.z = 0.18;
  wingL.rotation.y = -0.42;
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.position.set(1.18, -0.02, 0.62);
  wingR.rotation.z = -0.18;
  wingR.rotation.y = 0.42;

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 0.8), hullMat);
  fin.position.set(0, 0.3, 0.72);

  const spineMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 1.9), spineMat);
  spine.position.set(0, 0.27, -0.05);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }));
  canopy.scale.set(1, 0.5, 1.4);
  canopy.position.set(0, 0.12, -0.62);

  /* wingtip beacons */
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff9ec4, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const tipGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const tipL = new THREE.Mesh(tipGeo, tipMat);
  tipL.position.set(-2.02, -0.06, 1.24);
  const tipR = new THREE.Mesh(tipGeo, tipMat);
  tipR.position.set(2.02, -0.06, 1.24);

  /* engine nozzles */
  const nozMat = new THREE.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const nozGeo = new THREE.CircleGeometry(0.16, 12);
  const nozL = new THREE.Mesh(nozGeo, nozMat);
  nozL.position.set(-0.42, 0, 1.02);
  nozL.rotation.y = Math.PI;
  const nozR = new THREE.Mesh(nozGeo, nozMat);
  nozR.position.set(0.42, 0, 1.02);
  nozR.rotation.y = Math.PI;

  ship.add(hull, wingL, wingR, fin, spine, canopy, tipL, tipR, nozL, nozR);
  ship.userData.hull = hull;
}

const engineGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: GLOW, color: 0x6fe0ff, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, opacity: 0.55
}));
engineGlow.scale.set(2.4, 2.4, 1);
engineGlow.position.set(0, 0, 2.1);
ship.add(engineGlow);

const shipLight = new THREE.PointLight(0x6fd8ff, 2.2, 26, 2);
shipLight.position.set(0, 0, 1.2);
ship.add(shipLight);

/* shield bubble */
const shieldUniforms = { uColor: { value: new THREE.Color(0x74e2ff) }, uPower: { value: 0.55 }, uTime: { value: 0 } };
const shieldBubble = new THREE.Mesh(
  new THREE.SphereGeometry(2.35, 24, 16),
  new THREE.ShaderMaterial({
    uniforms: shieldUniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      uniform vec3 uColor; uniform float uPower; uniform float uTime;
      void main() {
        vec3 V = normalize(-vP);
        float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.6);
        float band = 0.5 + 0.5 * sin(vP.y * 5.0 - uTime * 3.2);
        float a = f * uPower * (0.55 + band * 0.45);
        gl_FragColor = vec4(uColor, a);
      }`
  })
);
shieldBubble.position.set(0, 0, 0.1);
ship.add(shieldBubble);

/* ── engine trail ───────────────────────────────────────────────────── */
const TRAIL_N = small ? 120 : 190;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailLife = new Float32Array(TRAIL_N);
const trailSeed = new Float32Array(TRAIL_N);
for (let i = 0; i < TRAIL_N; i++) { trailLife[i] = 0; trailSeed[i] = Math.random(); }
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('aLife', new THREE.BufferAttribute(trailLife, 1));
trailGeo.setAttribute('aSeed', new THREE.BufferAttribute(trailSeed, 1));
const trailMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: GLOW }, uPixel: { value: 1 }, uBoost: { value: 0 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute float aLife; attribute float aSeed;
    varying float vLife; varying float vSeed;
    uniform float uPixel;
    void main() {
      vLife = aLife; vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uPixel * (1.1 + aSeed * 2.0) * aLife * (30.0 / max(-mv.z, 1.0));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vLife; varying float vSeed;
    uniform sampler2D uMap; uniform float uBoost;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      if (tex.a < 0.01) discard;
      vec3 c = mix(vec3(0.42, 0.86, 1.0), vec3(0.70, 0.55, 1.0), vSeed);
      c = mix(c, vec3(1.0, 0.82, 0.42), uBoost * 0.65);
      gl_FragColor = vec4(c, tex.a * vLife * 0.85);
    }`
});
const trail = new THREE.Points(trailGeo, trailMat);
trail.frustumCulled = false;
scene.add(trail);
let trailHead = 0;

/* ── sparks (explosions, gate bursts, mote pops) ─────────────────────── */
const SPARK_N = 460;
const sparkPos = new Float32Array(SPARK_N * 3);
const sparkLife = new Float32Array(SPARK_N);
const sparkCol = new Float32Array(SPARK_N * 3);
const sparkVel = new Float32Array(SPARK_N * 3);
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(sparkLife, 1));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const sparkMat = new THREE.ShaderMaterial({
  uniforms: { uMap: { value: GLOW }, uPixel: { value: 1 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  vertexShader: /* glsl */`
    attribute float aLife; varying float vLife; varying vec3 vC; uniform float uPixel;
    void main() {
      vLife = aLife; vC = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(uPixel * 1.7 * (0.25 + aLife) * (38.0 / max(-mv.z, 1.0)), 20.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vLife; varying vec3 vC; uniform sampler2D uMap;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      if (tex.a < 0.02) discard;
      gl_FragColor = vec4(vC, tex.a * vLife);
    }`
});
const sparks = new THREE.Points(sparkGeo, sparkMat);
sparks.frustumCulled = false;
scene.add(sparks);
let sparkHead = 0;

function emitSparks(x, y, z, n, color, spread) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const k = sparkHead % SPARK_N;
    sparkHead++;
    sparkPos[k * 3] = x + rnd(-0.3, 0.3);
    sparkPos[k * 3 + 1] = y + rnd(-0.3, 0.3);
    sparkPos[k * 3 + 2] = z + rnd(-0.3, 0.3);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(rnd(-1, 1));
    const sp = rnd(0.35, 1) * (spread || 9);
    sparkVel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
    sparkVel[k * 3 + 1] = Math.sin(ph) * Math.sin(th) * sp;
    sparkVel[k * 3 + 2] = Math.cos(ph) * sp * 0.7;
    sparkLife[k] = rnd(0.55, 1);
    sparkCol[k * 3] = c.r; sparkCol[k * 3 + 1] = c.g; sparkCol[k * 3 + 2] = c.b;
  }
  sparkGeo.attributes.color.needsUpdate = true;
}

/* ── boost streaks ──────────────────────────────────────────────────── */
const STREAK_N = 22;
const streakMat = new THREE.MeshBasicMaterial({
  color: 0xbfe6ff, transparent: true, opacity: 0, depthWrite: false,
  blending: THREE.AdditiveBlending
});
const streaks = new THREE.Group();
scene.add(streaks);
for (let i = 0; i < STREAK_N; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.05, rnd(3, 9)), streakMat);
  m.position.set(rnd(-10, 10), rnd(-7, 7), rnd(-160, 10));
  m.userData.v = rnd(1.6, 3.2);
  streaks.add(m);
}

/* ══════════════════════════════════════════════════════════════════════
   obstacle pools
   ══════════════════════════════════════════════════════════════════════ */
const ringCoreGeo = new THREE.TorusGeometry(1, 0.062, 8, 60);
const ringHaloGeo = new THREE.TorusGeometry(1, 0.19, 8, 60);
const discGeo = new THREE.CircleGeometry(1, 48);

function basic(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
  });
}
const RING_COL = { cyan: 0x7cd6ff, gold: 0xffce7a };
const ringCoreMats = { cyan: basic(RING_COL.cyan, 0.95), gold: basic(RING_COL.gold, 0.98) };
const ringHaloMats = { cyan: basic(RING_COL.cyan, 0.15), gold: basic(RING_COL.gold, 0.18) };

const discMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8fe0ff) }, uPower: { value: 0.9 } },
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uPower;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      if (r > 1.0) discard;
      float ripple = 0.5 + 0.5 * sin(r * 15.0 - uTime * 3.0);
      float edge = smoothstep(0.55, 1.0, r);
      float a = (1.0 - r) * 0.10 + ripple * edge * 0.28 + edge * 0.20;
      gl_FragColor = vec4(uColor, a * uPower);
    }`
});

const ROCK_MATS = [
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x9b6bff) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      uniform vec3 uColor; uniform float uTime;
      void main() {
        float d = clamp(dot(normalize(vN), normalize(-vP)), 0.0, 1.0);
        float rim = pow(1.0 - d, 2.6);
        float facet = 0.45 + 0.55 * abs(sin(dot(vN, vec3(2.7, 3.9, 1.3)) * 2.4));
        float pulse = 0.78 + 0.22 * sin(uTime * 1.6 + vP.y * 1.4);
        vec3 col = uColor * (0.34 * facet) * pulse;
        col += uColor * rim * 2.6 * pulse;
        col += vec3(0.55, 0.78, 1.0) * pow(1.0 - d, 5.0) * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }`
  }),
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xff5f8d) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      uniform vec3 uColor; uniform float uTime;
      void main() {
        float d = clamp(dot(normalize(vN), normalize(-vP)), 0.0, 1.0);
        float rim = pow(1.0 - d, 2.6);
        float facet = 0.45 + 0.55 * abs(sin(dot(vN, vec3(2.7, 3.9, 1.3)) * 2.4));
        float pulse = 0.78 + 0.22 * sin(uTime * 1.6 + vP.y * 1.4);
        vec3 col = uColor * (0.36 * facet) * pulse;
        col += uColor * rim * 2.4 * pulse;
        col += vec3(1.0, 0.8, 0.55) * pow(1.0 - d, 5.0) * 0.4;
        gl_FragColor = vec4(col, 1.0);
      }`
  })
];

const rockGeo = new THREE.IcosahedronGeometry(1, 0);
const moteGeo = new THREE.OctahedronGeometry(0.34, 0);
const moteMat = new THREE.MeshBasicMaterial({
  color: 0xffd88a, transparent: true, opacity: 0.95, depthWrite: false,
  blending: THREE.AdditiveBlending
});
const moteHaloMat = new THREE.SpriteMaterial({
  map: GLOW, color: 0xffc45e, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, opacity: 0.85
});

const rings = [];
const rocks = [];
const motes = [];

function newRing() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(ringCoreGeo, ringCoreMats.cyan);
  const halo = new THREE.Mesh(ringHaloGeo, ringHaloMats.cyan);
  const disc = new THREE.Mesh(discGeo, discMat);
  /* Three concentric layers at the same place: they are additive and write no
     depth, but giving each its own z (1.5 cm apart) and draw order makes the
     sort deterministic, so the bright core always sits over the halo and no
     layer can flicker against another at distance. */
  disc.position.z = -0.03;
  halo.position.z = -0.015;
  disc.renderOrder = 0;
  halo.renderOrder = 1;
  core.renderOrder = 2;
  g.add(core, halo, disc);
  g.visible = false;
  scene.add(g);
  return { g, core, halo, disc, active: false, gold: false, hole: 3, px: 0, py: 0, pz: 0, spin: 0 };
}
function newRock() {
  const m = new THREE.Mesh(rockGeo, ROCK_MATS[0]);
  m.visible = false;
  scene.add(m);
  return { g: m, active: false, r: 1, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
}
function newMote() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(moteGeo, moteMat);
  const halo = new THREE.Sprite(moteHaloMat);  halo.scale.set(1.5, 1.5, 1);
  g.add(core, halo);
  g.visible = false;
  scene.add(g);
  return { g, core, active: false, px: 0, py: 0, pz: 0 };
}
for (let i = 0; i < 9; i++) rings.push(newRing());
for (let i = 0; i < 30; i++) rocks.push(newRock());
for (let i = 0; i < 6; i++) motes.push(newMote());

function freeFrom(arr) {
  for (let i = 0; i < arr.length; i++) if (!arr[i].active) return arr[i];
  return null;
}
function park(o) {
  o.active = false;
  o.g.visible = false;
  o.g.position.set(0, 0, -9999);
}

/* ══════════════════════════════════════════════════════════════════════
   spawning
   ══════════════════════════════════════════════════════════════════════ */
function sectorOf(dist) { return 1 + Math.floor(dist / 700); }

function spawnRing(x, y, radius, gold) {
  const o = freeFrom(rings);
  if (!o) return null;
  o.active = true;
  o.gold = !!gold;
  o.hole = radius;
  o.spin = rnd(-0.5, 0.5);
  o.g.visible = true;
  o.g.position.set(x, y, -SPAWN_Z);
  o.g.scale.setScalar(radius);
  o.core.material = ringCoreMats[gold ? 'gold' : 'cyan'];
  o.halo.material = ringHaloMats[gold ? 'gold' : 'cyan'];
  o.disc.visible = true;
  o.px = x; o.py = y; o.pz = -SPAWN_Z;
  return o;
}

function spawnRock(x, y, scale) {
  const o = freeFrom(rocks);
  if (!o) return null;
  o.active = true;
  o.r = scale;
  o.g.visible = true;
  o.g.position.set(x, y, -SPAWN_Z - rnd(0, 14));
  o.g.scale.setScalar(scale);
  o.g.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
  o.g.material = ROCK_MATS[Math.random() < 0.55 ? 0 : 1];
  o.px = x; o.py = y; o.pz = o.g.position.z;
  o.rx = rnd(-0.9, 0.9); o.ry = rnd(-0.9, 0.9); o.rz = rnd(-0.9, 0.9);
  return o;
}

function spawnMote(x, y) {
  const o = freeFrom(motes);
  if (!o) return null;
  o.active = true;
  o.g.visible = true;
  o.g.scale.setScalar(K);
  o.g.position.set(x, y, -SPAWN_Z - rnd(0, 20));
  o.px = x; o.py = y; o.pz = o.g.position.z;
  return o;
}

function laneX() { return rnd(-FX + 1.2 * K, FX - 1.2 * K); }
function laneY() { return rnd(-FY + 1 * K, FY - 1 * K); }

function spawnGate() {
  const s = S.sector;
  const radius = clamp(3.35 - (s - 1) * 0.14, 2.35, 3.35) * K;
  const gold = Math.random() < 0.14;
  const x = rnd(-FX + radius * 0.55, FX - radius * 0.55);
  const y = rnd(-FY + radius * 0.35, FY - radius * 0.35);
  spawnRing(x, y, radius, gold);
  if (Math.random() < 0.3) spawnMote(x, y);
}

function spawnRockLine() {
  const cols = [-5.4, -1.9, 1.9, 5.4].map((c) => c * K);
  const skip = Math.floor(rnd(0, 4));
  const y = rnd(-1.8, 1.8) * K;
  for (let i = 0; i < cols.length; i++) {
    if (i === skip) continue;
    spawnRock(cols[i] + rnd(-0.3, 0.3) * K, y + rnd(-0.5, 0.5) * K, rnd(0.72, 1.1) * K);
  }
}

function spawnRockCluster() {
  const n = S.sector > 3 ? 3 : 2;
  let x = laneX();
  let y = laneY();
  for (let i = 0; i < n; i++) {
    spawnRock(clamp(x, -FX, FX), clamp(y, -FY, FY), rnd(0.7, 1.15) * K);
    x += rnd(-3.4, 3.4) * K;
    y += rnd(-2.2, 2.2) * K;
  }
}

function spawnGateWithRocks() {
  const s = S.sector;
  const radius = clamp(3.2 - (s - 1) * 0.12, 2.4, 3.2) * K;
  const x = rnd(-FX + radius + 0.6 * K, FX - radius - 0.6 * K);
  const y = rnd(-FY + radius * 0.4, FY - radius * 0.4);
  spawnRing(x, y, radius, Math.random() < 0.18);
  const side = Math.random() < 0.5 ? -1 : 1;
  spawnRock(clamp(x + side * (radius + 2.2 * K), -FX, FX), y + rnd(-1.2, 1.2) * K, rnd(0.7, 1) * K);
  spawnRock(clamp(x - side * (radius + 2.2 * K), -FX, FX), y + rnd(-1.2, 1.2) * K, rnd(0.7, 1) * K);
}

function spawnWave() {
  const r = Math.random();
  if (r < 0.5) spawnGate();
  else if (r < 0.74) spawnRockLine();
  else if (r < 0.9) spawnGateWithRocks();
  else spawnRockCluster();

  if (Math.random() < 0.22) spawnMote(laneX(), laneY());

  const s = S.sector;
  S.nextWave = S.dist + clamp(74 - s * 5.5, 34, 74) * rnd(0.85, 1.15);
}

/* A short runway of objects already in flight, so the first second of a run
   is not empty sky. Positions are set directly instead of at SPAWN_Z. */
function prewarm() {
  const g1 = spawnRing(0, 0, 3.2 * K, false);
  if (g1) { g1.g.position.z = -52; g1.pz = -52; }
  const r1 = spawnRock(-4.2 * K, 1.4 * K, 0.95 * K);
  if (r1) { r1.g.position.z = -96; r1.pz = -96; }
  const r2 = spawnRock(4.4 * K, -1.6 * K, 0.85 * K);
  if (r2) { r2.g.position.z = -92; r2.pz = -92; }
  const g2 = spawnRing(1.6 * K, -0.6 * K, 3.0 * K, false);
  if (g2) { g2.g.position.z = -148; g2.pz = -148; }
  const m1 = spawnMote(0, 2.4 * K);
  if (m1) { m1.g.position.z = -60; m1.pz = -60; }
}

/* ══════════════════════════════════════════════════════════════════════
   game events
   ══════════════════════════════════════════════════════════════════════ */
const audio = new AudioEngine();
const ui = {
  score: $('#hudScore'), best: $('#hudBest'), mult: $('#hudMult'),
  shield: $('#hudShield'), boost: $('#hudBoost'), speed: $('#hudSpeed'),
  sector: $('#hudSector'), comboBar: $('#comboBar'), popups: $('#popups'),
  start: $('#ovStart'), pause: $('#ovPause'), over: $('#ovOver'),
  finalScore: $('#finalScore'), finalBest: $('#finalBest'), finalGates: $('#finalGates'),
  finalCombo: $('#finalCombo'), finalDist: $('#finalDist'), record: $('#recordBadge'),
  startBest: $('#startBest'), startRuns: $('#startRuns'), hint: $('#hint'),
  pauseBtn: $('#btnPause'), soundBtn: $('#btnSound'), toast: $('#toast'), flash: $('#flash')
};

function fmt(n) { return Math.floor(n).toLocaleString('en-US'); }

function popup(text, kind) {
  if (!ui.popups) return;
  const el = document.createElement('div');
  el.className = 'pop' + (kind ? ' ' + kind : '');
  el.textContent = text;
  ui.popups.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function toast(text) {
  if (!ui.toast) return;
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => ui.toast.classList.remove('on'), 1600);
}

function bumpCombo(n) {
  S.combo += n;
  S.comboT = COMBO_TIME;
  S.mult = clamp(1 + Math.floor(S.combo / 3), 1, 8);
  if (S.combo > S.bestCombo) S.bestCombo = S.combo;
  if (S.mult > S.peakMult) S.peakMult = S.mult;
}

function onGate(o) {
  S.gates++;
  const gold = o.gold;
  const gain = Math.round(150 * S.mult * (gold ? 2 : 1));
  S.score += gain;
  bumpCombo(gold ? 3 : 2);
  S.boost = clamp(S.boost + (gold ? 2 : 1), 0, 3);
  emitSparks(o.g.position.x, o.g.position.y, 0, gold ? 30 : 20, gold ? 0xffc45e : 0x7cd6ff, 11);
  popup('+' + fmt(gain) + (S.mult > 1 ? ' ×' + S.mult : ''), gold ? 'gold' : 'gate');
  audio.sfx('gate', S.mult - 1);
  if (gold) toast(t('goldGate'));
}

function onNearMiss(o) {
  const gain = Math.round(40 * S.mult);
  S.score += gain;
  bumpCombo(1);
  popup(t('nearMiss') + ' +' + fmt(gain), 'near');
  emitSparks(o.g.position.x, o.g.position.y, 0, 6, 0xff9ec4, 6);
}

function onMote(o) {
  S.score += 200 * S.mult;
  if (S.shield < 3 && Math.random() < 0.55) {
    S.shield++;
    toast(t('moteShield'));
  } else {
    S.boost = clamp(S.boost + 1, 0, 3);
    toast(t('moteBoost'));
  }
  bumpCombo(1);
  const p = o.g.position;
  emitSparks(p.x, p.y, 0, 22, 0xffd88a, 8);
  popup('+' + fmt(200 * S.mult), 'mote');
  audio.sfx('mote');
  park(o);
}

function onHit(o) {
  const p = (o && o.g) ? o.g.position : { x: S.px, y: S.py };
  if (S.invuln > 0) return;
  if (o) park(o);
  if (S.shield > 0) {
    S.shield--;
    S.invuln = 1.7;
    S.shake = 1;
    S.flash = 0.8;
    S.combo = 0;
    S.mult = 1;
    S.comboT = 0;
    S.boostT = 0;
    emitSparks(p.x, p.y, 0, 46, S.shield === 0 ? 0xff6b8a : 0x9fb8ff, 16);
    audio.sfx('hit');
    popup(t('shieldLost'), 'hit');
    if (S.shield === 0) toast(t('lastShield'));
  } else {
    endRun();
  }
}

/* ══════════════════════════════════════════════════════════════════════
   run lifecycle
   ══════════════════════════════════════════════════════════════════════ */
function clearObjects() {
  rings.forEach(park); rocks.forEach(park); motes.forEach(park);
  for (let i = 0; i < SPARK_N; i++) { sparkLife[i] = 0; sparkPos[i * 3 + 2] = -9999; }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.aLife.needsUpdate = true;
  for (let i = 0; i < TRAIL_N; i++) trailLife[i] = 0;
  trailGeo.attributes.aLife.needsUpdate = true;
}

function resetRun() {
  S.px = 0; S.py = 0; S.tx = 0; S.ty = 0; S.vx = 0; S.vy = 0;
  S.speed = 24; S.dist = 0; S.score = 0; S.combo = 0; S.comboT = 0; S.mult = 1;
  S.shield = 3; S.boost = 3; S.boostT = 0;
  S.invuln = 0; S.shake = 0; S.flash = 0; S.runTime = 0;
  S.gates = 0; S.bestCombo = 0; S.peakMult = 1; S.sector = 1; S.nextWave = 150;
  S.newRecord = false;
  clearObjects();
  prewarm();
  ship.visible = true;
  ship.position.set(0, 0, 0);
  stars.visible = true;
}

function startRun() {
  audio.init();
  audio.setIntensity(0);
  audio.startMusic();
  resetRun();
  S.phase = 'run';
  document.body.classList.add('playing');
  ui.start.classList.remove('on');
  ui.over.classList.remove('on');
  ui.pause.classList.remove('on');
  hideLoader();
  audio.sfx('start');
  renderHud(true);
}

function pauseRun() {
  if (S.phase !== 'run') return;
  S.phase = 'pause';
  document.body.classList.remove('playing');
  ui.pause.classList.add('on');
  syncToggleLabels();
}

function resumeRun() {
  if (S.phase !== 'pause') return;
  S.phase = 'run';
  document.body.classList.add('playing');
  ui.pause.classList.remove('on');
  audio.init();
  audio.startMusic();
  lastT = performance.now();
}

function endRun() {
  S.phase = 'over';
  S.overAt = performance.now();
  document.body.classList.remove('playing');
  S.shake = 1.4;
  S.flash = 1;
  emitSparks(S.px, S.py, 0, 90, 0xff8fb0, 20);
  emitSparks(S.px, S.py, 0, 40, 0xffd88a, 12);
  ship.visible = false;
  audio.sfx('over');
  audio.stopMusic();
  ui.soundBtn.classList.remove('playing');

  const score = Math.floor(S.score);
  S.newRecord = score > BEST.score;
  if (S.newRecord) {
    BEST.score = score;
    setTimeout(() => audio.sfx('record'));
  }
  BEST.gates = Math.max(BEST.gates, S.gates);
  BEST.combo = Math.max(BEST.combo, S.bestCombo);
  BEST.runs = (BEST.runs || 0) + 1;
  BEST.dist = Math.max(BEST.dist || 0, Math.floor(S.dist));
  store.write(BEST);

  ui.finalScore.textContent = fmt(score);
  ui.finalBest.textContent = fmt(BEST.score);
  ui.finalGates.textContent = fmt(S.gates);
  ui.finalCombo.textContent = '×' + fmt(S.peakMult);
  ui.finalDist.textContent = fmt(S.dist) + ' u';
  ui.record.classList.toggle('on', S.newRecord);
  ui.over.classList.add('on');
  renderHud(true);
}

/* ══════════════════════════════════════════════════════════════════════
   input
   ══════════════════════════════════════════════════════════════════════ */
const keys = Object.create(null);
let drag = null;

function pointerToField(e) {
  const r = canvas.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
  return { x: nx * FX, y: ny * FY, r };
}

canvas.addEventListener('pointerdown', (e) => {
  if (S.phase !== 'run') return;
  if (e.pointerType === 'mouse') {
    const p = pointerToField(e);
    S.tx = p.x; S.ty = p.y;
  } else {
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: S.tx, by: S.ty };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (S.phase !== 'run') return;
  if (e.pointerType === 'mouse') {
    const p = pointerToField(e);
    S.tx = p.x;
    S.ty = p.y;
  } else if (drag && drag.id === e.pointerId) {
    const r = canvas.getBoundingClientRect();
    S.tx = clamp(drag.bx + ((e.clientX - drag.sx) / r.width) * FX * 2.1, -FX, FX);
    S.ty = clamp(drag.by - ((e.clientY - drag.sy) / r.height) * FY * 2.1, -FY, FY);
    e.preventDefault();
  }
}, { passive: false });

function endDrag(e) {
  if (drag && drag.id === (e.pointerId === undefined ? drag.id : e.pointerId)) drag = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', endDrag);

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (S.phase === 'run' && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', ' '].includes(k)) {
    e.preventDefault();
  }
  keys[k] = true;
  if (k === ' ' || k === 'shift') tryBoost();
  if (k === 'escape' || k === 'p') { S.phase === 'run' ? pauseRun() : S.phase === 'pause' ? resumeRun() : null; }
  if (k === 'enter') {
    if (S.phase === 'idle' || S.phase === 'over') startRun();
    else if (S.phase === 'pause') resumeRun();
  }
  if (k === 'm') toggleSound();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function tryBoost() {
  if (S.phase !== 'run' || S.boost <= 0 || S.boostT > 0) return;
  S.boost--;
  S.boostT = 2.1;
  S.shake = 0.45;
  audio.sfx('boost');
  emitSparks(S.px, S.py, 1.5, 26, 0xaee6ff, 10);
  popup(t('boostPop'), 'boost');
}

/* ══════════════════════════════════════════════════════════════════════
   update
   ══════════════════════════════════════════════════════════════════════ */
function stepPool(arr, dz, dt, killZ) {
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o.active) continue;
    o.px = o.g.position.x;
    o.py = o.g.position.y;
    o.pz = o.g.position.z;
    o.g.position.z += dz;

    if (o.pz < 0 && o.g.position.z >= 0) testCross(o, arr === rings, arr === motes);
    if (!o.active) continue;

    if (o.g.position.z > killZ) { park(o); continue; }

    if (arr === rings) {
      o.g.rotation.z += o.spin * dt;
      o.disc.material.uniforms.uTime.value = S.time;
      const zz = o.g.position.z;
      /* past the ship a gate opens outward and sweeps off the frame */
      o.g.scale.setScalar(o.hole * (zz > 0 ? 1 + zz * 0.55 : 1));
      o.halo.scale.setScalar(1 + Math.sin(S.time * 3 + o.g.position.x) * 0.02);
    } else if (arr === rocks) {
      o.g.rotation.x += o.rx * dt;
      o.g.rotation.y += o.ry * dt;
      o.g.rotation.z += o.rz * dt;
    } else {
      o.core.rotation.y += dt * 2.4;
      o.core.rotation.x += dt * 1.1;
      o.g.position.y += Math.sin(S.time * 2 + o.px) * dt * 0.35;
    }
  }
}

function testCross(o, isRing, isMote) {
  const z0 = o.pz;
  const z1 = o.g.position.z;
  const t = (0 - z0) / Math.max(0.0001, z1 - z0);
  const x = lerp(o.px, o.g.position.x, t);
  const y = lerp(o.py, o.g.position.y, t);
  const d = Math.hypot(x - S.px, y - S.py);

  if (isRing) {
    const hole = o.hole - 0.55 * K;
    const band = o.hole * 0.075 + 0.55 * K;
    if (d < hole) onGate(o);
    else if (Math.abs(d - o.hole) < band) onHit(o);
    return;
  }
  if (isMote) {
    if (d < 1.15 * K) onMote(o);
    return;
  }
  if (d < o.r * 0.92 + 0.5 * K) onHit(o);
  else if (d < o.r + 2.1 * K) onNearMiss(o);
}

function updatePlayer(dt) {
  const ax = 24 * dt;
  if (keys.arrowleft || keys.a) S.tx -= ax;
  if (keys.arrowright || keys.d) S.tx += ax;
  if (keys.arrowup || keys.w) S.ty += ax;
  if (keys.arrowdown || keys.s) S.ty -= ax;
  S.tx = clamp(S.tx, -FX, FX);
  S.ty = clamp(S.ty, -FY, FY);

  const prevX = S.px;
  const prevY = S.py;
  const k = damp(dt, 11);
  S.px = lerp(S.px, S.tx, k);
  S.py = lerp(S.py, S.ty, k);
  const iv = Math.max(dt, 1 / 240);
  S.vx = lerp(S.vx, (S.px - prevX) / iv, 0.3);
  S.vy = lerp(S.vy, (S.py - prevY) / iv, 0.3);

  ship.position.set(S.px, S.py + Math.sin(S.time * 2.4) * 0.06, 0);
  ship.rotation.z = clamp(-S.vx * 0.021, -0.5, 0.5);
  ship.rotation.x = clamp(-S.vy * 0.012, -0.26, 0.26);
  ship.rotation.y = clamp(-S.vx * 0.006, -0.16, 0.16);

  if (S.invuln > 0) {
    S.invuln -= dt;
    ship.visible = Math.floor(S.time * 20) % 2 === 0 || S.invuln <= 0;
  } else if (S.phase === 'run') {
    ship.visible = true;
  }
  /* the bubble is a flare, not a permanent ball: it shows on a hit */
  const flare = S.invuln > 0;
  shieldBubble.visible = flare;
  shieldUniforms.uPower.value = 0.42;
  shieldUniforms.uTime.value = S.time;
  shieldBubble.rotation.y += dt * 0.4;
}

function updateTrail(dt) {
  const boosting = S.boostT > 0;
  for (let i = 0; i < TRAIL_N; i++) {
    if (trailLife[i] > 0) {
      trailLife[i] -= dt * (boosting ? 1.6 : 2.6);
      trailPos[i * 3 + 2] += S.speed * dt * 0.4;
      trailPos[i * 3] += (Math.random() - 0.5) * 0.06;
      trailPos[i * 3 + 1] += (Math.random() - 0.5) * 0.06;
    }
  }
  const emit = boosting ? 6 : 3;
  for (let n = 0; n < emit; n++) {
    const i = trailHead % TRAIL_N;
    trailHead++;
    const spread = boosting ? 0.55 : 0.2;
    trailPos[i * 3] = S.px + rnd(-spread, spread) * 0.5;
    trailPos[i * 3 + 1] = S.py + rnd(-spread, spread) * 0.35;
    trailPos[i * 3 + 2] = 0.85 + rnd(0, 0.25);
    trailLife[i] = 1;
    trailSeed[i] = Math.random();
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.aLife.needsUpdate = true;
  trailGeo.attributes.aSeed.needsUpdate = true;
  trailMat.uniforms.uBoost.value = boosting ? 1 : 0;
}

function updateSparks(dt, dz) {
  let any = false;
  for (let i = 0; i < SPARK_N; i++) {
    if (sparkLife[i] <= 0) continue;
    any = true;
    sparkLife[i] -= dt * 1.4;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt + dz;
    sparkVel[i * 3] *= 0.955;
    sparkVel[i * 3 + 1] *= 0.955;
    sparkVel[i * 3 + 2] *= 0.955;
    if (sparkLife[i] <= 0) sparkPos[i * 3 + 2] = -9999;
  }
  if (any) {
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aLife.needsUpdate = true;
  }
}

function updateStars(dz) {
  const arr = starGeo.attributes.position.array;
  for (let i = 0; i < STAR_N; i++) {
    arr[i * 3 + 2] += dz * 0.9;
    if (arr[i * 3 + 2] > 40) {
      arr[i * 3 + 2] = -900;
      arr[i * 3] = rnd(-260, 260);
      arr[i * 3 + 1] = rnd(-170, 170);
    }
  }
  starGeo.attributes.position.needsUpdate = true;
  stars.rotation.z += dz * 0.00004;

  const darr = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_N; i++) {
    darr[i * 3 + 2] += dz * 1.45;
    if (darr[i * 3 + 2] > 8) {
      darr[i * 3 + 2] -= 158;
      darr[i * 3] = rnd(-17, 17);
      darr[i * 3 + 1] = rnd(-11, 11);
    }
  }
  dustGeo.attributes.position.needsUpdate = true;
}

function updateStreaks(dt, dz) {
  const visible = S.boostT > 0 || S.speed > 46;
  streakMat.opacity = lerp(streakMat.opacity, visible ? (S.boostT > 0 ? 0.55 : 0.18) : 0, damp(dt, 6));
  for (let i = 0; i < STREAK_N; i++) {
    const m = streaks.children[i];
    m.position.z += (dz + 30) * m.userData.v * dt;
    if (m.position.z > 14) {
      m.position.set(rnd(-10, 10), rnd(-7, 7), rnd(-170, -90));
      m.scale.y = rnd(0.6, 1.6);
    }
  }
}

function updateCamera(dt) {
  if (S.phase === 'idle') {
    /* slow cinematic drift behind the start panel */
    const a = S.time * 0.09;
    camera.position.set(Math.sin(a) * 3.4, 1.5 + Math.sin(a * 0.7) * 0.5, CAM_BACK - 1.2 + Math.cos(a) * 2.4);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, -1.1, -7);
    if (Math.abs(camera.fov - 64) > 0.05) { camera.fov = 64; camera.updateProjectionMatrix(); }
    return;
  }
  const boostPush = S.boostT > 0 ? 1.9 : 0;
  const shake = S.shake;
  const sx = (Math.random() - 0.5) * shake * 0.9;
  const sy = (Math.random() - 0.5) * shake * 0.9;
  camera.position.x = lerp(camera.position.x, S.px * 0.42 + sx, damp(dt, 5.5));
  camera.position.y = lerp(camera.position.y, 2.5 + S.py * 0.5 + sy, damp(dt, 5.5));
  camera.position.z = lerp(camera.position.z, CAM_BACK + boostPush, damp(dt, 3.4));

  const roll = clamp(-S.vx * 0.0045, -0.09, 0.09) + (Math.random() - 0.5) * shake * 0.02;
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(S.px * 0.7, S.py * 0.72 + 0.35, -18);

  const fovTarget = 62 + (S.boostT > 0 ? 11 : 0) + clamp(S.speed / 14, 0, 5) + shake * 3;
  if (Math.abs(camera.fov - fovTarget) > 0.02) {
    camera.fov = lerp(camera.fov, fovTarget, damp(dt, 3.2));
    camera.updateProjectionMatrix();
  }
  S.shake = Math.max(0, S.shake - dt * 2.4);
}

let lastHud = {};
function renderHud(force) {
  const h = lastHud;
  const score = Math.floor(S.score);
  if (force || h.score !== score) { if (ui.score) ui.score.textContent = fmt(score); h.score = score; }
  if (force || h.best !== BEST.score) { if (ui.best) ui.best.textContent = fmt(BEST.score); h.best = BEST.score; }
  if (force || h.mult !== S.mult) {
    if (ui.mult) {
      ui.mult.textContent = '×' + S.mult;
      ui.mult.classList.toggle('hot', S.mult >= 4);
    }
    h.mult = S.mult;
  }
  if (force || h.speed !== Math.round(S.speed)) {
    if (ui.speed) ui.speed.textContent = String(Math.round(S.speed));
    h.speed = Math.round(S.speed);
  }
  if (force || h.sector !== S.sector) {
    if (ui.sector) ui.sector.textContent = String(S.sector);
    h.sector = S.sector;
  }
  if (force || h.shield !== S.shield) {
    if (ui.shield) {
      const pips = ui.shield.children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < S.shield);
    }
    h.shield = S.shield;
  }
  if (force || h.boost !== S.boost) {
    if (ui.boost) {
      const pips = ui.boost.children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < S.boost);
    }
    h.boost = S.boost;
  }
  if (ui.comboBar) {
    const pct = clamp(S.comboT / COMBO_TIME, 0, 1) * 100;
    if (force || Math.abs((h.pct || 0) - pct) > 1.5) {
      ui.comboBar.style.width = pct.toFixed(1) + '%';
      h.pct = pct;
      ui.comboBar.parentNode.classList.toggle('hot', S.mult >= 4);
    }
  }
  if (ui.pauseBtn) ui.pauseBtn.disabled = S.phase !== 'run';
}

/* ── main loop ──────────────────────────────────────────────────────── */
let lastT = performance.now();
let fpsAcc = 0, fpsN = 0, degradeStep = 0, lastFlash = -1;

function tick(now) {
  const dtRaw = (now - lastT) / 1000;
  lastT = now;
  const dt = Math.min(0.05, Math.max(0.0005, dtRaw));

  S.time += dt;
  skyUniforms.uTime.value = S.time;
  skyUniforms.uHue.value = S.time * 0.2;

  /* frame-time watchdog: step the resolution down once if a device struggles */
  fpsAcc += dtRaw;
  fpsN++;
  if (fpsN >= 90) {
    const avg = fpsAcc / fpsN;
    S.fps = Math.round(1 / Math.max(0.0001, avg));
    if (avg > 0.0225 && degradeStep < 2 && S.phase === 'run') {
      degradeStep++;
      const dpr = renderer.getPixelRatio();
      renderer.setPixelRatio(Math.max(1, dpr - 0.5));
      starMat.uniforms.uPixel.value = renderer.getPixelRatio();
      dustMat.uniforms.uPixel.value = renderer.getPixelRatio();
      trailMat.uniforms.uPixel.value = renderer.getPixelRatio();
      sparkMat.uniforms.uPixel.value = renderer.getPixelRatio();
      if (degradeStep === 2) skyUniforms.uQual.value = 0;
    }
    fpsAcc = 0; fpsN = 0;
  }

  if (S.phase === 'run') {
    S.runTime += dt;
    const base = Math.min(62, 24 + S.dist * 0.0125);
    S.speed = base * (S.boostT > 0 ? 1.72 : 1);
    if (S.boostT > 0) S.boostT = Math.max(0, S.boostT - dt);

    const dz = S.speed * dt;
    S.dist += dz;
    S.score += dz * 10 * S.mult;

    if (S.comboT > 0) {
      S.comboT -= dt;
      if (S.comboT <= 0) { S.combo = 0; S.mult = 1; }
    }

    const sec = sectorOf(S.dist);
    if (sec !== S.sector) {
      S.sector = sec;
      toast(t('sectorUp') + ' ' + sec);
      audio.setIntensity(Math.min(2, sec - 1));
      audio.sfx('gate', 3);
    }

    updatePlayer(dt);
    if (S.dist > S.nextWave) spawnWave();
    stepPool(rings, dz, dt, RING_KILL_Z);
    stepPool(rocks, dz, dt, KILL_Z);
    stepPool(motes, dz, dt, KILL_Z * 0.5);
    updateTrail(dt);
    updateSparks(dt, dz);
    updateStars(dz);
    updateStreaks(dt, dz);
    updateCamera(dt);
    audio.tick();
    renderHud(false);
  } else if (S.phase === 'idle') {
    updateStars(6 * dt);
    updateCamera(dt);
    ship.position.set(Math.sin(S.time * 0.5) * 0.9, -1.9 + Math.cos(S.time * 0.42) * 0.35, 0);
    ship.rotation.z = Math.sin(S.time * 0.5) * 0.09;
    ship.rotation.y = Math.sin(S.time * 0.3) * 0.18;
    ship.visible = true;
    shieldBubble.visible = false;
    shieldUniforms.uTime.value = S.time;
    updateSparks(dt, 0);
  } else if (S.phase === 'over') {
    updateStars(3 * dt);
    updateSparks(dt, 2 * dt * 10);
    updateStreaks(dt, 0);
    updateCamera(dt);
    updateTrail(dt);
  } else if (S.phase === 'pause') {
    /* frozen */
  }

  /* shadow-free single pass */
  renderer.render(scene, camera);

  if (S.flash > 0 || lastFlash > 0) {
    S.flash = Math.max(0, S.flash - dt * 2.4);
    const op = Math.round(S.flash * 60) / 100;
    if (op !== lastFlash && ui.flash) ui.flash.style.opacity = op.toFixed(2);
    lastFlash = op;
  }

  if (!window.__cgReady) {
    window.__cgReady = true;
    hideLoader();
  }
  requestAnimationFrame(tick);
}

function hideLoader() {
  const l = $('#loader');
  if (l) l.classList.add('hidden');
}

/* ── resize ─────────────────────────────────────────────────────────── */
function resize() {
  if (!renderer) return;
  small = window.matchMedia('(max-width: 760px)').matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  starMat.uniforms.uPixel.value = renderer.getPixelRatio();
      dustMat.uniforms.uPixel.value = renderer.getPixelRatio();
  trailMat.uniforms.uPixel.value = renderer.getPixelRatio();
  sparkMat.uniforms.uPixel.value = renderer.getPixelRatio();

  /* Fit the corridor to the frame. The half-width the camera can see at the
     play plane (z = 0) fixes the scale; the field keeps 75% of that width, as
     on a desktop. A portrait phone therefore gets the same composition, just
     smaller, instead of gates spawning outside the screen. */
  const tanHalf = Math.tan((62 * Math.PI) / 360);
  const halfW = tanHalf * CAM_BACK * camera.aspect;
  const k = clamp((halfW * 0.75) / FIELD_W, 0.26, 1);
  if (Math.abs(k - K) > 0.001) {
    const r = k / K;
    K = k;
    FX = FIELD_W * K;
    FY = FIELD_H * K;
    if (ship) ship.scale.setScalar(0.58 * K);
    /* objects already in flight keep their relative size */
    for (let i = 0; i < rings.length; i++) {
      const o = rings[i];
      if (!o.active) continue;
      o.hole *= r;
      o.g.scale.setScalar(o.hole);
    }
    for (let i = 0; i < rocks.length; i++) {
      const o = rocks[i];
      if (!o.active) continue;
      o.r *= r;
      o.g.scale.setScalar(o.r);
      o.g.position.x *= r; o.g.position.y *= r;
    }
    for (let i = 0; i < motes.length; i++) {
      const o = motes[i];
      if (!o.active) continue;
      o.g.scale.setScalar(K);
      o.g.position.x *= r; o.g.position.y *= r;
    }
    S.tx = clamp(S.tx, -FX, FX);
    S.ty = clamp(S.ty, -FY, FY);
  }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

/* ══════════════════════════════════════════════════════════════════════
   UI wiring
   ══════════════════════════════════════════════════════════════════════ */
function syncToggleLabels() {
  const on = audio.enabled;
  if (ui.soundBtn) {
    ui.soundBtn.classList.toggle('on', on);
    ui.soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.soundBtn.querySelector('.ico').textContent = on ? '🔊' : '🔇';
    ui.soundBtn.querySelector('.lbl').textContent = on ? t('soundOn') : t('soundOff');
  }
}

function toggleSound() {
  audio.init();
  audio.setEnabled(!audio.enabled);
  syncToggleLabels();
  if (audio.enabled && S.phase === 'run') audio.startMusic();
  if (audio.enabled) audio.sfx('click');
}

function bind(id, fn) {
  const el = $(id);
  if (el) el.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
}
bind('#btnPlay', startRun);
bind('#btnRetry', startRun);
bind('#btnResume', resumeRun);
bind('#btnPause', () => { S.phase === 'run' ? pauseRun() : resumeRun(); });
bind('#btnRestart', () => { ui.pause.classList.remove('on'); startRun(); });
bind('#btnSound', toggleSound);
bind('#btnBoost', (e) => { e.stopPropagation(); tryBoost(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.phase === 'run') pauseRun();
});

document.addEventListener('cg:lang', (e) => {
  LANG = (e.detail && e.detail.lang) === 'ko' ? 'ko' : 'en';
  syncToggleLabels();
  renderHud(true);
  if (ui.startBest) ui.startBest.textContent = fmt(BEST.score);
  if (ui.startRuns) ui.startRuns.textContent = fmt(BEST.runs || 0);
});

if (ui.startBest) ui.startBest.textContent = fmt(BEST.score);
if (ui.startRuns) ui.startRuns.textContent = fmt(BEST.runs || 0);
if (ui.best) ui.best.textContent = fmt(BEST.score);
syncToggleLabels();
renderHud(true);

/* ══════════════════════════════════════════════════════════════════════
   boot
   ══════════════════════════════════════════════════════════════════════ */
if (renderer) {
  resize();
  requestAnimationFrame((t) => { lastT = t; tick(t); });
} else {
  document.body.classList.add('no-gl');
}

/* test / automation surface */
window.CG = {
  get phase() { return S.phase; },
  get score() { return Math.floor(S.score); },
  get state() {
    return {
      phase: S.phase, score: Math.floor(S.score), dist: Math.floor(S.dist),
      shield: S.shield, boost: S.boost, mult: S.mult, sector: S.sector,
      gates: S.gates, best: BEST.score, fps: S.fps
    };
  },
  get stats() {
    return {
      fps: S.fps,
      calls: renderer ? renderer.info.render.calls : 0,
      triangles: renderer ? renderer.info.render.triangles : 0,
      pixelRatio: renderer ? renderer.getPixelRatio() : 0,
      errors: window.__cgErrors.slice()
    };
  },
  start: startRun,
  pause: pauseRun,
  resume: resumeRun,
  boost: tryBoost,
  end: endRun
};
