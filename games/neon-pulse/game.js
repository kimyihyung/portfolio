/* NEON PULSE — a four-lane rhythm runner.
   Three.js is bundled locally (./vendor/three.module.min.js): after the document and its two
   local scripts load, the page makes no network request of any kind. */
import * as THREE from './vendor/three.module.min.js';

/* ═══════════════════════════════ config ═══════════════════════════════ */
const BPM = 128;
const SPB = 60 / BPM;            // seconds per beat
const S16 = SPB / 4;             // sixteenth note
const BARS = 48;
const SONG_LEN = BARS * 4 * SPB; // 90 s
const LANES = 4;

const PLAY_HALF = 4.62;                 // world half-width of the four lanes
const LANE_W = (PLAY_HALF * 2) / LANES;
const LANE_X = [-1.5, -0.5, 0.5, 1.5].map((k) => k * LANE_W);
const NOTE_Y = 1.02;

const W_PERFECT = 0.052;
const W_GREAT = 0.100;
const W_GOOD = 0.150;
const W_MISS = 0.195;

const LANE_COLOR = [0x38e8ff, 0xa77bff, 0xff6ec7, 0xffd166];

const DIFFS = {
  easy:   { speed: 12.0, label: 'Easy',   mult12: 10 },
  normal: { speed: 15.0, label: 'Normal', mult12: 12 },
  hard:   { speed: 18.0, label: 'Hard',   mult12: 14 }
};

const STORE = {
  best: 'neon-pulse.best',
  plays: 'neon-pulse.plays',
  sound: 'neon-pulse.sound',
  diff: 'neon-pulse.diff',
  bestKey(d) { return 'neon-pulse.best.' + d; }
};

const CODE_LANE = {
  KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3,
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
  Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3,
  ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3
};
const KEY_LANE = { d: 0, f: 1, j: 2, k: 3, '1': 0, '2': 1, '3': 2, '4': 3 };

const T = (key, fallback) => {
  const fn = window.NP_T;
  const v = fn && fn(key);
  return v == null ? (fallback == null ? '' : fallback) : v;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const $ = (id) => document.getElementById(id);

/* ═══════════════════════════════ chart ═══════════════════════════════
   A bar is a step list plus one lane digit per step on a 16-step grid.
   The same seed is used on every run, so a score means the same thing
   on every device and a chart can be learned. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAT = {
  h: [
    { s: [0, 8], l: '12' }, { s: [0, 8], l: '21' }, { s: [0, 8], l: '34' },
    { s: [0, 8], l: '43' }, { s: [0, 6, 8, 12], l: '1234' }, { s: [0, 8], l: '13' }
  ],
  q: [
    { s: [0, 4, 8, 12], l: '1234' }, { s: [0, 4, 8, 12], l: '1212' },
    { s: [0, 4, 8, 12], l: '2343' }, { s: [0, 4, 8, 12], l: '1133' },
    { s: [0, 4, 8, 12], l: '3212' }, { s: [0, 4, 8, 12], l: '4231' },
    { s: [0, 4, 8, 12], l: '1323' }, { s: [0, 4, 8, 12], l: '2413' }
  ],
  e: [
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '12343214' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '12123434' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '13241324' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '43212343' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '12341234' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '13132424' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '23432121' },
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '12431243' }
  ],
  m: [
    { s: [0, 2, 4, 6, 8, 10, 12, 14], l: '12434321' },
    { s: [0, 3, 4, 6, 8, 11, 12, 14], l: '13243142' },
    { s: [0, 2, 4, 7, 8, 10, 12, 15], l: '12343214' },
    { s: [0, 2, 3, 6, 8, 10, 11, 14], l: '12134342' },
    { s: [0, 2, 4, 6, 9, 10, 12, 14], l: '13242313' },
    { s: [0, 2, 5, 6, 8, 10, 13, 14], l: '12434231' }
  ],
  x: [
    { s: [0, 1, 2, 3, 8, 9, 10, 11], l: '12342341' },
    { s: [0, 1, 2, 3, 8, 10, 12, 14], l: '43213412' },
    { s: [0, 2, 4, 5, 6, 7, 12, 14], l: '12341243' },
    { s: [0, 1, 2, 3, 6, 8, 10, 12], l: '12431324' },
    { s: [0, 2, 4, 6, 8, 9, 10, 11], l: '13244312' },
    { s: [0, 1, 4, 5, 8, 9, 12, 13], l: '12341234' }
  ]
};

const SECTIONS = [
  { from: 0, to: 1, kind: 'silent' },
  { from: 2, to: 3, kind: 'intro' },
  { from: 4, to: 11, kind: 'verse' },
  { from: 12, to: 15, kind: 'build' },
  { from: 16, to: 23, kind: 'chorus' },
  { from: 24, to: 27, kind: 'break' },
  { from: 28, to: 35, kind: 'verse2' },
  { from: 36, to: 43, kind: 'chorus2' },
  { from: 44, to: 46, kind: 'outro' },
  { from: 47, to: 47, kind: 'final' }
];

const SECTION_KEY = {
  silent: 'sec_intro', intro: 'sec_intro', verse: 'sec_verse', build: 'sec_build',
  chorus: 'sec_chorus', break: 'sec_break', verse2: 'sec_verse2', chorus2: 'sec_chorus2',
  outro: 'sec_outro', final: 'sec_final'
};

function sectionAt(bar) {
  for (let i = 0; i < SECTIONS.length; i++) {
    if (bar >= SECTIONS[i].from && bar <= SECTIONS[i].to) return SECTIONS[i];
  }
  return SECTIONS[SECTIONS.length - 1];
}

function poolsFor(kind, diff) {
  const easy = diff === 'easy', hard = diff === 'hard';
  switch (kind) {
    case 'silent': return null;
    case 'intro': return ['h'];
    case 'verse': return easy ? ['q'] : hard ? ['e', 'm'] : ['q', 'e'];
    case 'build': return easy ? ['q'] : hard ? ['m', 'e'] : ['e', 'q'];
    case 'chorus': return easy ? ['q', 'e'] : hard ? ['m', 'e'] : ['e', 'm'];
    case 'break': return ['h', 'q'];
    case 'verse2': return easy ? ['q', 'e'] : hard ? ['m', 'x'] : ['e', 'm'];
    case 'chorus2': return easy ? ['e', 'q'] : hard ? ['x', 'm'] : ['m', 'e'];
    case 'outro': return ['q', 'h'];
    case 'final': return null;
    default: return ['q'];
  }
}

const SCALE = [69, 72, 74, 76, 79]; // A minor pentatonic

function buildChart(diff) {
  const rnd = mulberry32(0x5ea1 + diff.length * 977 + (diff === 'easy' ? 0 : diff === 'hard' ? 7 : 3) * 131);
  const notes = [];
  let lastLaneStr = '';

  for (let bar = 2; bar < BARS; bar++) {
    const sec = sectionAt(bar);
    if (sec.kind === 'final') {
      notes.push({ t: bar * 4 * SPB, lane: 1, pitch: 76 });
      continue;
    }
    const pools = poolsFor(sec.kind, diff);
    if (!pools) continue;

    let poolKey = pools[(rnd() * pools.length) | 0];
    if (bar === BARS - 2) poolKey = 'q'; // breathe before the last chord
    const arr = PAT[poolKey];

    let pat = arr[(rnd() * arr.length) | 0];
    let guard = 0;
    while (pat.l === lastLaneStr && guard++ < 8) pat = arr[(rnd() * arr.length) | 0];
    lastLaneStr = pat.l;

    for (let i = 0; i < pat.s.length; i++) {
      const step = pat.s[i];
      const lane = Number(pat.l[i]) - 1;
      if (lane < 0 || lane >= LANES) continue;
      const t = bar * 4 * SPB + step * S16;
      const contour = (step + lane * 2 + bar) % SCALE.length;
      const oct = step === 0 ? 12 : 0;
      notes.push({ t: t, lane: lane, pitch: SCALE[contour] + oct });
    }
  }

  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  for (let i = 0; i < notes.length; i++) {
    notes[i].id = i;
    notes[i].judged = false;
    notes[i].kind = null;
  }
  return notes;
}

/* ═══════════════════════════════ audio ═══════════════════════════════ */
class Synth {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.latency = 0.02;
  }

  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); }
    catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
    this.ctx = ctx;
    const c = ctx;

    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 3.4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(c.destination);

    this.music = c.createGain();
    this.music.gain.value = 0.9;
    this.music.connect(this.master);

    this.drums = c.createGain();
    this.drums.gain.value = 0.8;
    this.drums.connect(this.music);

    this.lead = c.createGain();
    this.lead.gain.value = 0.9;
    this.lead.connect(this.master);

    this.rev = c.createConvolver();
    this.rev.buffer = this.makeImpulse(1.9, 2.7);
    this.revGain = c.createGain();
    this.revGain.gain.value = 0.28;
    this.rev.connect(this.revGain);
    this.revGain.connect(this.master);

    this.noiseBuf = this.makeNoise(1.2);

    let lat = (c.outputLatency || 0) + (c.baseLatency || 0);
    if (!isFinite(lat) || lat <= 0) lat = 0.02;
    this.latency = Math.min(0.09, lat);
    this.ready = true;
    return true;
  }

  resume() {
    if (!this.ready) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (!this.ready) return;
    if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setMuted(m) {
    this.muted = !!m;
    if (!this.ready) return;
    const g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.muted ? 0 : 0.8, now + 0.12);
  }

  makeNoise(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay);
      }
    }
    return buf;
  }

  noise(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(t);
    s.stop(t + dur + 0.02);
    return s;
  }

  kick(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(43, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * (v || 1), t + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.28);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.32);
  }

  snare(t, v) {
    const c = this.ctx;
    const n = this.noise(t, 0.2), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 1750; f.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34 * (v || 1), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.17);
    n.connect(f); f.connect(g); g.connect(this.drums);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(196, t);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.14 * (v || 1), t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0006, t + 0.09);
    o.connect(og); og.connect(this.drums);
    o.start(t); o.stop(t + 0.11);
  }

  hat(t, v, open) {
    const c = this.ctx;
    const n = this.noise(t, open ? 0.22 : 0.06), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 7600;
    const dur = open ? 0.17 : 0.032;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * (v || 1), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    n.connect(f); f.connect(g); g.connect(this.drums);
  }

  bass(t, midi, dur, v) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f / 2;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(280, t);
    lp.frequency.linearRampToValueAtTime(640, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(190, t + dur);
    lp.Q.value = 5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * (v || 1), t + 0.012);
    g.gain.setValueAtTime(0.28 * (v || 1), t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.music);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  pad(t, midis, dur, v) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.7;
    const amp = 0.07 * (v || 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.6);
    g.gain.setValueAtTime(amp, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g); g.connect(this.music); g.connect(this.rev);
    for (let i = 0; i < midis.length; i++) {
      const f = 440 * Math.pow(2, (midis[i] - 69) / 12);
      for (let k = 0; k < 2; k++) {
        const o = c.createOscillator();
        o.type = k === 0 ? 'triangle' : 'sine';
        o.frequency.value = f * (k === 0 ? 1 : 2.002);
        o.detune.value = k === 0 ? -4 : 5;
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  arp(t, midi, v) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045 * (v || 1), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.12);
    o.connect(g); g.connect(this.music); g.connect(this.rev);
    o.start(t); o.stop(t + 0.14);
  }

  /* the hit note — the player is playing the melody */
  pluck(t, midi, pan, vel, quality) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = c.createGain(), lp = c.createBiquadFilter(), p = c.createStereoPanner();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.32);
    p.pan.value = clamp(pan, -1, 1);
    const amp = 0.24 * (vel == null ? 1 : vel);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.46);
    lp.connect(g); g.connect(p);
    p.connect(this.lead); p.connect(this.rev);

    const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
    o1.type = 'triangle'; o1.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2; g2.gain.value = 0.32;
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    o1.start(t); o2.start(t); o1.stop(t + 0.5); o2.stop(t + 0.5);

    if (quality === 'perfect') {
      const o3 = c.createOscillator(), g3 = c.createGain();
      o3.type = 'sine'; o3.frequency.value = f * 4;
      g3.gain.setValueAtTime(0.0001, t);
      g3.gain.exponentialRampToValueAtTime(0.045, t + 0.004);
      g3.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
      o3.connect(g3); g3.connect(this.lead);
      o3.start(t); o3.stop(t + 0.18);
    }
  }

  thud(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = 'square';
    o.frequency.setValueAtTime(132, t);
    o.frequency.exponentialRampToValueAtTime(64, t + 0.09);
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * (v || 1), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.12);
    o.connect(lp); lp.connect(g); g.connect(this.lead);
    o.start(t); o.stop(t + 0.14);
  }

  chime(t, high) {
    const c = this.ctx;
    const notes = high ? [81, 85, 88] : [76, 81, 84];
    for (let i = 0; i < notes.length; i++) {
      const f = 440 * Math.pow(2, (notes[i] - 69) / 12);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const at = t + i * 0.055;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.07, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.34);
      o.connect(g); g.connect(this.lead); g.connect(this.rev);
      o.start(at); o.stop(at + 0.36);
    }
  }

  tick(t, accent) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = accent ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.14 : 0.08, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
    o.connect(g); g.connect(this.lead);
    o.start(t); o.stop(t + 0.11);
  }

  crash(t) {
    const c = this.ctx;
    const n = this.noise(t, 1.4), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'highpass'; f.frequency.value = 4200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 1.2);
    n.connect(f); f.connect(g); g.connect(this.drums); g.connect(this.rev);
  }
}

/* ═══════════════════════════════ scene ═══════════════════════════════ */
const canvas = $('scene');
let renderer, scene, camera, noteMesh, coreMesh, floorMat, glowTex, stars, horizon;
const pads = [];
const bursts = [];
const VFOV = 58;
let cameraD = 9;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpColor = new THREE.Color();

function makeGlowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.24)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x04050c, 1);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x04050c, 26, 92);
  camera = new THREE.PerspectiveCamera(VFOV, 1, 0.1, 260);

  floorMat = new THREE.ShaderMaterial({
    uniforms: {
      uSong: { value: 0 },
      uSpeed: { value: 15 },
      uPulse: { value: 0 },
      uLaneW: { value: LANE_W },
      uHalf: { value: PLAY_HALF },
      uColorA: { value: new THREE.Color(0x2f8cff) },
      uColorB: { value: new THREE.Color(0xa14bff) }
    },
    vertexShader: `
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vW;
      uniform float uSong, uSpeed, uPulse, uLaneW, uHalf;
      uniform vec3 uColorA, uColorB;
      void main(){
        float x = vW.x, z = vW.z;
        float bx = (x + uHalf) / uLaneW;
        float fx = abs(fract(bx + 0.5) - 0.5);
        float vline = smoothstep(0.05, 0.0, fx);
        float edge = smoothstep(0.015, 0.0, abs(abs(x) - uHalf));
        float gz = (z - uSong * uSpeed) / 3.0;
        float fz = abs(fract(gz + 0.5) - 0.5);
        float hline = smoothstep(0.03, 0.0, fz);
        float far = smoothstep(-96.0, -26.0, z);
        float nearFade = smoothstep(16.0, 1.0, z);
        float fade = far * nearFade;
        vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * sin(x * 0.45 + 1.2));
        float lane = 1.0 - abs(fract(bx) * 2.0 - 1.0);
        float a = (vline * 0.45 + hline * 0.24 + edge * 0.9) * fade;
        a += uPulse * 0.08 * fade * lane;
        col += uPulse * 0.45 * lane * vec3(0.35, 0.55, 1.0);
        gl_FragColor = vec4(col * (0.9 + uPulse * 0.7), a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PLAY_HALF * 2 + 0.05, 172), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -68);
  scene.add(floor);

  /* The side walls used to be flat dark planes, which read as two hard-edged
     black slabs floating over the horizon. They are now a soft neon gradient
     that is bright at the floor, fades out with height and with distance, so
     the corridor has edges without any visible seam. */
  const wallMat = new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color(0x2f6bff) },
      uColorB: { value: new THREE.Color(0x7a35ff) }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv; varying vec3 vW;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vW;
      uniform vec3 uColorA, uColorB;
      void main(){
        float up = 1.0 - smoothstep(0.0, 11.0, vW.y);    // bright at the floor
        float far = smoothstep(-118.0, -32.0, vW.z);    // fade into the distance
        float band = 0.5 + 0.5 * sin(vW.z * 0.42);
        vec3 col = mix(uColorA, uColorB, band);
        float a = up * up * far * 0.22;
        a += (1.0 - smoothstep(0.0, 0.9, abs(vW.y))) * far * 0.10;   // lip at the floor
        gl_FragColor = vec4(col * (0.55 + up * 0.9), a);
      }`
  });
  const wallGeo = new THREE.PlaneGeometry(172, 26);
  const wallL = new THREE.Mesh(wallGeo, wallMat);
  wallL.rotation.y = Math.PI / 2;
  wallL.position.set(-PLAY_HALF - 0.08, 8, -68);
  scene.add(wallL);
  const wallR = wallL.clone();
  wallR.position.x = PLAY_HALF + 0.08;
  scene.add(wallR);

  glowTex = makeGlowTexture();

  horizon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x4b6bff, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  horizon.scale.set(48, 26, 1);
  horizon.position.set(0, 3.4, -96);
  scene.add(horizon);

  const N = 900;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 34;
    pos[i * 3 + 1] = Math.random() * 26 - 1;
    pos[i * 3 + 2] = -Math.random() * 120 + 8;
    const t = Math.random();
    col[i * 3] = 0.35 + t * 0.5;
    col[i * 3 + 1] = 0.55 + t * 0.35;
    col[i * 3 + 2] = 1.0;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({
    /* a round glow sprite, not a bare square point */
    size: 0.24, map: glowTex, alphaTest: 0.02, vertexColors: true, transparent: true,
    opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    sizeAttenuation: true, fog: false
  }));
  scene.add(stars);

  const MAXN = 128;
  const box = new THREE.BoxGeometry(1, 1, 1);
  noteMesh = new THREE.InstancedMesh(
    box,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAXN
  );
  noteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  noteMesh.frustumCulled = false;

  coreMesh = new THREE.InstancedMesh(
    box,
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    MAXN
  );
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coreMesh.frustumCulled = false;

  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < MAXN; i++) {
    noteMesh.setColorAt(i, white);
    tmpM.makeScale(0, 0, 0);
    noteMesh.setMatrixAt(i, tmpM);
    coreMesh.setMatrixAt(i, tmpM);
  }
  if (noteMesh.instanceColor) noteMesh.instanceColor.needsUpdate = true;
  scene.add(noteMesh);
  scene.add(coreMesh);

  for (let i = 0; i < LANES; i++) {
    const padMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(LANE_COLOR[i]) },
        uGlow: { value: 0.18 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor; uniform float uGlow;
        void main(){
          /* soft pad: bright rim, calm centre, no hard rectangle edge */
          vec2 d = abs(vUv - 0.5) * 2.0;
          float side = 1.0 - smoothstep(0.55, 1.0, d.x);
          float across = 1.0 - smoothstep(0.35, 1.0, d.y);
          float a = side * across * (0.34 + uGlow);
          gl_FragColor = vec4(uColor * (1.0 + uGlow), a);
        }`
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 0.9, 0.5), padMat);
    pad.position.set(LANE_X[i], NOTE_Y, 0.03);
    scene.add(pad);

    /* A light column per lane. It fades to nothing at the top, so it reads as
       a beam rising off the hit pad instead of a flat panel with a hard edge. */
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(LANE_COLOR[i]) },
        uFlash: { value: 0 },
        uPulse: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor; uniform float uFlash; uniform float uPulse;
        void main(){
          float h = 1.0 - vUv.y;                // 1 at the pad, 0 at the top
          float side = 1.0 - smoothstep(0.22, 0.5, abs(vUv.x - 0.5));  // soft sides
          float a = pow(h, 2.6) * side * (0.16 + uFlash * 0.55 + uPulse * 0.06);
          gl_FragColor = vec4(uColor * (0.85 + uFlash * 1.4), a);
        }`
    });
    const pillar = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 0.86, 7), pillarMat);
    pillar.position.set(LANE_X[i], NOTE_Y + 3.5, -8);
    scene.add(pillar);

    pads.push({ mat: padMat, pillar: pillarMat, flash: 0 });
  }
  pads.lineMat = new THREE.MeshBasicMaterial({
    color: 0xbfe8ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(PLAY_HALF * 2, 0.055), pads.lineMat);
  line.position.set(0, NOTE_Y, -0.02);
  scene.add(line);

  for (let i = 0; i < 20; i++) {
    const mat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1, 1, 1);
    sp.visible = false;
    scene.add(sp);
    bursts.push({ sprite: sp, mat: mat, life: 0, max: 0.34, size: 2.4 });
  }
}

function layout() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const aspect = w / h;

  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 700 ? 2 : 1.75) * quality);
  camera.aspect = aspect;

  const tan = Math.tan((VFOV * Math.PI) / 360);
  const need = PLAY_HALF / (tan * aspect);
  cameraD = clamp(need * 1.04, 7.4, 27);
  camera.position.set(0, 2.0 + cameraD * 0.3, cameraD);
  camera.lookAt(0, 1.0, -cameraD * 2.2);
  camera.fov = VFOV;
  camera.updateProjectionMatrix();
}

/* ═══════════════════════════════ state ═══════════════════════════════ */
const synth = new Synth();
const state = {
  mode: 'menu',
  diff: 'normal',
  notes: [],
  total: 0,
  score: 0,
  combo: 0,
  maxCombo: 0,
  counts: { perfect: 0, great: 0, good: 0, miss: 0 },
  startT: 0,
  step: 0,
  cursor: 0,
  pausedAt: 0,
  lastScore: -1,
  beatPulse: 0,
  shake: 0,
  sectionName: '',
  plays: 0,
  clockSrc: 'perf',
  lastSong: 0
};

let quality = 1;
let idleT = 0;

function readNum(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return dflt;
    const n = Number(v);
    return isFinite(n) ? n : dflt;
  } catch (e) { return dflt; }
}
function readStr(key, dflt) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v;
  } catch (e) { return dflt; }
}
function write(key, val) {
  try { localStorage.setItem(key, String(val)); } catch (e) { /* private mode */ }
}

function best(diff) { return readNum(STORE.bestKey(diff), 0); }
function setBest(diff, v) { write(STORE.bestKey(diff), v); if (v > readNum(STORE.best, 0)) write(STORE.best, v); }

/* One clock drives the chart. Web Audio time is used while the context is
   really running; when it is not — a device with no audio output, a context
   the browser keeps locked — the run falls back to the wall clock instead of
   freezing at zero. The chart, the judging and the HUD all read this, so a
   silent run is still a playable run. */
function rawClock() {
  const c = synth.ctx;
  if (synth.ready && c && c.state === 'running') return c.currentTime - synth.latency;
  return performance.now() / 1000;
}
function clockSrc() {
  return synth.ready && synth.ctx && synth.ctx.state === 'running' ? 'audio' : 'perf';
}
const nowSong = () => rawClock() - state.startT;

/* ═══════════════════════════════ music ═══════════════════════════════ */
const CHORD = [
  { root: 45, triad: [57, 60, 64] }, // Am
  { root: 41, triad: [53, 57, 60] }, // F
  { root: 48, triad: [48, 52, 55] }, // C
  { root: 43, triad: [55, 59, 62] }  // G
];

function levelAt(bar) {
  const kind = sectionAt(bar).kind;
  switch (kind) {
    case 'silent': return 0;
    case 'intro': return 1;
    case 'verse': return 2;
    case 'build': return bar < 14 ? 2 : 3;
    case 'chorus': return 3;
    case 'break': return 1;
    case 'verse2': return 2;
    case 'chorus2': return 4;
    case 'outro': return 2;
    case 'final': return 2;
    default: return 1;
  }
}

function scheduleStep(stepIdx, when) {
  const bar = Math.floor(stepIdx / 16);
  const s = stepIdx % 16;
  const ch = CHORD[bar % 4];

  // count-in: a click you can trust, over a held chord
  if (bar < 2) {
    if (s === 0) synth.pad(when, ch.triad.map((n) => n + 12), 2 * 4 * SPB, 0.7);
    if (s % 4 === 0) synth.tick(when, s === 0);
    return;
  }

  const lvl = levelAt(bar);

  if (s === 0 && bar % 4 === 0) {
    synth.pad(when, ch.triad.map((n) => n + 12), 4 * 4 * SPB * 0.96, lvl >= 3 ? 1 : 0.8);
  }

  if (lvl === 1 && (s === 0 || s === 8)) synth.arp(when, ch.triad[s === 0 ? 0 : 2] + 24, 0.7);

  if (lvl === 1) {
    if (s === 0 || s === 8) synth.kick(when, 0.7);
  } else if (lvl === 2) {
    if (s === 0 || s === 8 || s === 11) synth.kick(when, 0.85);
  } else if (lvl === 3) {
    if (s % 4 === 0) synth.kick(when, 0.9);
    else if (s === 14) synth.kick(when, 0.5);
  } else {
    if (s % 4 === 0) synth.kick(when, 1);
    if (s === 10) synth.kick(when, 0.45);
  }

  if (lvl >= 2 && (s === 4 || s === 12)) synth.snare(when, lvl === 4 ? 1 : 0.8);
  if (lvl === 4 && (s === 7 || s === 15) && bar % 2 === 1) synth.snare(when, 0.32);

  if (lvl === 2 && s % 2 === 0) synth.hat(when, s % 4 === 0 ? 0.9 : 0.5, false);
  if (lvl === 3 && s % 2 === 0) synth.hat(when, s % 4 === 0 ? 1 : 0.6, s === 14);
  if (lvl === 4) synth.hat(when, s % 4 === 0 ? 1 : s % 2 === 0 ? 0.55 : 0.28, s === 14);

  if (sectionAt(bar).kind === 'build') {
    const inBar = bar - 12;
    if (inBar >= 2 && s % (inBar === 2 ? 4 : 2) === 0) synth.snare(when, inBar === 3 ? 0.45 + s * 0.02 : 0.3);
  }

  if (lvl >= 2 && (s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14)) {
    const midi = s === 6 || s === 14 ? ch.root + 7 : ch.root;
    synth.bass(when, midi, S16 * 1.7, lvl >= 3 ? 0.95 : 0.72);
  }
  if (lvl === 1 && s === 0) synth.bass(when, ch.root, SPB * 1.6, 0.5);

  if (bar === BARS - 1) {
    if (s === 0) {
      synth.crash(when);
      synth.pad(when, ch.triad.map((n) => n + 12), 3 * SPB, 1);
    }
    return;
  }
}

/* ═══════════════════════════════ judging ═══════════════════════════════ */
function multOf(combo) {
  return 1 + Math.min(7, Math.floor(combo / DIFFS[state.diff].mult12));
}

function judge(note, delta) {
  note.judged = true;
  let kind = 'good';
  if (delta <= W_PERFECT) kind = 'perfect';
  else if (delta <= W_GREAT) kind = 'great';
  note.kind = kind;

  const base = kind === 'perfect' ? 100 : kind === 'great' ? 62 : 28;
  state.combo += 1;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  state.counts[kind] += 1;
  state.score += base * multOf(state.combo);

  if (synth.ready) {
    synth.pluck(synth.ctx.currentTime + 0.004, note.pitch, (note.lane - 1.5) * 0.42, kind === 'perfect' ? 1 : 0.78, kind);
  }
  pads[note.lane].flash = 1;
  burst(note.lane, kind);
  showJudge(kind);

  if (state.combo > 0 && state.combo % 25 === 0 && synth.ready) {
    synth.chime(synth.ctx.currentTime + 0.02, state.combo >= 100);
  }
}

function missNote(note) {
  note.judged = true;
  note.kind = 'miss';
  state.counts.miss += 1;
  state.combo = 0;
  if (synth.ready) synth.thud(synth.ctx.currentTime + 0.005, 0.85);
  showJudge('miss');
  state.shake = 0.24;
  const v = $('vignette');
  if (v) { v.classList.remove('on'); void v.offsetWidth; v.classList.add('on'); }
}

function burst(lane, kind) {
  let slot = null;
  for (let i = 0; i < bursts.length; i++) if (bursts[i].life <= 0) { slot = bursts[i]; break; }
  if (!slot) slot = bursts[0];
  slot.life = slot.max;
  slot.sprite.visible = true;
  slot.sprite.position.set(LANE_X[lane], NOTE_Y, 0.4);
  slot.mat.color.setHex(kind === 'good' ? 0xdfe9ff : LANE_COLOR[lane]);
  slot.mat.opacity = 1;
  slot.size = kind === 'perfect' ? 3.6 : kind === 'great' ? 2.7 : 2.0;
}

let judgeTimer = 0;
function showJudge(kind) {
  const el = $('judge');
  if (!el) return;
  el.textContent = T(kind, kind);
  el.className = kind + ' on';
  judgeTimer = kind === 'miss' ? 0.46 : 0.3;

  const cb = $('combo');
  if (!cb) return;
  if (state.combo >= 2) {
    cb.textContent = state.combo + (state.combo >= 100 ? '' : '');
    cb.className = 'on' + (state.combo >= 50 ? ' hot' : '');
  } else {
    cb.className = '';
  }
}

/* ═══════════════════════════════ input ═══════════════════════════════ */
const held = [false, false, false, false];

function press(lane) {
  if (state.mode !== 'play') return;
  const sp = nowSong();
  let bestNote = null, bestD = 1e9;
  for (let i = state.cursor; i < state.notes.length; i++) {
    const n = state.notes[i];
    if (n.t > sp + W_MISS) break;
    if (n.judged || n.lane !== lane) continue;
    const d = Math.abs(n.t - sp);
    if (d < bestD) { bestD = d; bestNote = n; }
  }
  if (bestNote && bestD <= W_MISS) {
    judge(bestNote, bestD);
  } else {
    pads[lane].flash = Math.max(pads[lane].flash, 0.3);
    if (synth.ready && sp > 0.2) synth.thud(synth.ctx.currentTime + 0.004, 0.14);
  }
}

function laneOf(e) {
  if (e.code && CODE_LANE[e.code] !== undefined) return CODE_LANE[e.code];
  const k = String(e.key || '').toLowerCase();
  return KEY_LANE[k] === undefined ? null : KEY_LANE[k];
}

window.addEventListener('keydown', (e) => {
  const k = String(e.key || '').toLowerCase();
  if (k === ' ' || k === 'enter') {
    if (state.mode === 'menu' || state.mode === 'over') { e.preventDefault(); startRun(); }
    else if (state.mode === 'pause') { e.preventDefault(); resumeRun(); }
    else if (state.mode === 'play' && k === ' ') e.preventDefault();
    return;
  }
  if (k === 'escape' || k === 'p') {
    if (state.mode === 'play') { e.preventDefault(); pauseRun(); }
    else if (state.mode === 'pause') { e.preventDefault(); resumeRun(); }
    return;
  }
  if (k === 'm') { toggleSound(); return; }
  const lane = laneOf(e);
  if (lane === null) return;
  e.preventDefault();
  if (e.repeat) return;
  press(lane);
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'play') return;
  e.preventDefault();
  const span = window.innerWidth / LANES;
  press(clamp(Math.floor(e.clientX / span), 0, LANES - 1));
}, { passive: false });

const padBtns = document.querySelectorAll('#pads button');
for (let i = 0; i < padBtns.length; i++) {
  const el = padBtns[i];
  const lane = Number(el.getAttribute('data-k'));
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (lane >= 0 && lane < LANES) press(lane);
  }, { passive: false });
}

/* ═══════════════════════════════ run control ═══════════════════════════════ */
function startRun() {
  /* Audio is optional: if the device gives us no output, the run continues on
     the wall clock and plays silently. */
  synth.init();
  synth.resume();

  state.notes = buildChart(state.diff);
  state.total = state.notes.length;
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  state.step = 0;
  state.cursor = 0;
  state.beatPulse = 0;
  state.shake = 0;
  state.sectionName = '';
  state.plays = readNum(STORE.plays, 0) + 1;
  write(STORE.plays, state.plays);
  write(STORE.diff, state.diff);
  state.clockSrc = clockSrc();
  state.startT = rawClock() + 0.42;
  state.lastSong = 0;
  state.mode = 'play';

  setOverlay('ovStart', false);
  setOverlay('ovOver', false);
  setOverlay('ovPause', false);
  document.body.classList.add('playing');
  const cb = $('combo');
  if (cb) cb.className = '';
  const j = $('judge');
  if (j) j.className = '';
  updateHud(true);
}

function pauseRun() {
  if (state.mode !== 'play') return;
  state.pausedAt = nowSong();
  state.mode = 'pause';
  synth.suspend();
  setOverlay('ovPause', true);
  document.body.classList.remove('playing');
}

function resumeRun() {
  if (state.mode !== 'pause') return;
  synth.resume();
  state.clockSrc = clockSrc();
  state.startT = rawClock() - state.pausedAt;
  state.lastSong = state.pausedAt;
  state.mode = 'play';
  setOverlay('ovPause', false);
  document.body.classList.add('playing');
}

function quitToMenu() {
  state.mode = 'menu';
  synth.suspend();
  setOverlay('ovPause', false);
  setOverlay('ovOver', false);
  setOverlay('ovStart', true);
  document.body.classList.remove('playing');
  refreshMenuStats();
}

function finishRun() {
  if (state.mode !== 'play') return;
  state.mode = 'over';
  document.body.classList.remove('playing');

  const total = state.total || 1;
  const acc = ((state.counts.perfect + state.counts.great * 0.65 + state.counts.good * 0.3) / total) * 100;
  const rank = acc >= 96 && state.counts.miss === 0 ? 'S'
    : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 65 ? 'C' : 'D';
  const prev = best(state.diff);
  const isRecord = state.score > prev;
  if (isRecord) setBest(state.diff, state.score);

  $('overScore').textContent = state.score.toLocaleString('en-US');
  $('overAcc').textContent = acc.toFixed(1) + '%';
  $('overCombo').textContent = state.maxCombo;
  $('overPerfect').textContent = state.counts.perfect;
  $('overGreat').textContent = state.counts.great;
  $('overGood').textContent = state.counts.good;
  $('overMiss').textContent = state.counts.miss;
  $('overRank').textContent = rank;
  $('overRank').className = 'rank r' + rank;
  $('overBest').textContent = best(state.diff).toLocaleString('en-US');
  $('overDiff').textContent = T('diff' + state.diff, DIFFS[state.diff].label);
  const badge = $('recordBadge');
  if (badge) badge.classList.toggle('on', isRecord);
  const fc = $('fullCombo');
  if (fc) fc.classList.toggle('on', state.counts.miss === 0 && state.total > 0);

  setOverlay('ovOver', true);
  if (synth.ready) synth.chime(synth.ctx.currentTime + 0.05, acc >= 95);
  refreshMenuStats();
}

function setOverlay(id, on) {
  const el = $(id);
  if (el) el.classList.toggle('on', !!on);
}

function refreshMenuStats() {
  const n = $('menuBest');
  if (n) n.textContent = best(state.diff).toLocaleString('en-US');
  const p = $('menuPlays');
  if (p) p.textContent = readNum(STORE.plays, 0);
  const d = document.querySelectorAll('[data-diff]');
  for (let i = 0; i < d.length; i++) d[i].classList.toggle('on', d[i].getAttribute('data-diff') === state.diff);
}

function selectDiff(d) {
  if (!DIFFS[d]) return;
  state.diff = d;
  write(STORE.diff, d);
  refreshMenuStats();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  const d = t.closest('[data-diff]');
  if (d) { selectDiff(d.getAttribute('data-diff')); return; }
  const b = t.closest('[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act');
  if (act === 'play') startRun();
  else if (act === 'pause') pauseRun();
  else if (act === 'resume') resumeRun();
  else if (act === 'retry') startRun();
  else if (act === 'menu') quitToMenu();
  else if (act === 'sound') toggleSound();
});

/* ═══════════════════════════════ sound ═══════════════════════════════ */
function toggleSound() {
  const on = readStr(STORE.sound, '1') !== '0';
  write(STORE.sound, on ? '0' : '1');
  synth.init();
  synth.setMuted(!on);
  syncSoundButton();
}
function syncSoundButton() {
  const on = readStr(STORE.sound, '1') !== '0';
  const btn = $('btnSound');
  if (!btn) return;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const ico = btn.querySelector('.ico');
  if (ico) ico.textContent = on ? '🔊' : '🔇';
  const lbl = btn.querySelector('.lbl');
  if (lbl) lbl.textContent = on ? T('soundOn', 'Sound') : T('soundOff', 'Muted');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'play') pauseRun();
});

/* ═══════════════════════════════ HUD ═══════════════════════════════ */
let lastComboShown = -1;

function updateHud(force) {
  const scoreEl = $('score');
  if (scoreEl && (state.score !== state.lastScore || force)) {
    scoreEl.textContent = state.score.toLocaleString('en-US');
    state.lastScore = state.score;
  }
  const comboEl = $('combo');
  if (comboEl && (state.combo !== lastComboShown || force)) {
    lastComboShown = state.combo;
    if (state.combo >= 2) comboEl.textContent = state.combo;
    else if (comboEl.className.indexOf('on') >= 0) comboEl.className = '';
  }
  const multEl = $('mult');
  if (multEl) multEl.textContent = '×' + multOf(state.combo);
  const accEl = $('acc');
  if (accEl) {
    const done = state.counts.perfect + state.counts.great + state.counts.good + state.counts.miss;
    const acc = done ? ((state.counts.perfect + state.counts.great * 0.65 + state.counts.good * 0.3) / done) * 100 : 100;
    accEl.textContent = acc.toFixed(1) + '%';
  }
  const bestEl = $('hudBest');
  if (bestEl && force) bestEl.textContent = best(state.diff).toLocaleString('en-US');
  const secEl = $('section');
  if (secEl && secEl.getAttribute('data-k') !== state.sectionName) {
    secEl.setAttribute('data-k', state.sectionName);
    secEl.textContent = state.sectionName ? T(SECTION_KEY[state.sectionName] || 'sec_verse', '') : '';
  }
  const bar = $('progressFill');
  if (bar) bar.style.width = clamp((nowSong() / SONG_LEN) * 100, 0, 100).toFixed(2) + '%';
}

/* ═══════════════════════════════ frame loop ═══════════════════════════════ */
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
let countLabel = '';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  idleT += dt;

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1.2) {
    const fps = fpsN / fpsAcc;
    if (fps < 42 && quality > 0.6) {
      quality = Math.max(0.6, quality - 0.15);
      layout();
    }
    fpsAcc = 0; fpsN = 0;
    const fb = $('fps');
    if (fb && document.body.classList.contains('debug')) fb.textContent = Math.round(fps) + ' fps';
  }

  const playing = state.mode === 'play';
  if (playing) {
    /* keep the song position continuous if the clock source changes mid-run
       (audio context waking up, or dying) */
    const src = clockSrc();
    if (src !== state.clockSrc) {
      state.startT = rawClock() - state.lastSong;
      state.clockSrc = src;
    }
  }
  const sp = playing ? nowSong() : state.mode === 'pause' ? state.pausedAt : state.mode === 'over' ? SONG_LEN : idleT;
  if (playing) state.lastSong = sp;
  const speed = DIFFS[state.diff].speed;

  if (playing && synth.ready && state.clockSrc === 'audio') {
    const horizonT = sp + 0.2;
    const now = synth.ctx.currentTime;
    while (state.step * S16 < horizonT && state.step < BARS * 16) {
      const when = state.startT + synth.latency + state.step * S16;
      /* never hand the audio engine a moment that has already passed: after a
         stall that would throw for every remaining step */
      if (when > now - 0.02) scheduleStep(state.step, when);
      state.step++;
    }
  }

  if (playing) {
    const beatPos = sp / SPB;
    const frac = beatPos - Math.floor(beatPos);
    state.beatPulse = Math.max(state.beatPulse * 0.85, Math.pow(1 - frac, 4) * 0.9);
    const kind = sectionAt(clamp(Math.floor(sp / (4 * SPB)), 0, BARS - 1)).kind;
    if (kind !== state.sectionName) {
      state.sectionName = kind;
      updateHud(false);
    }
  } else {
    state.beatPulse *= 0.9;
  }

  floorMat.uniforms.uSong.value = playing || state.mode === 'over' ? sp : idleT;
  floorMat.uniforms.uSpeed.value = speed;
  floorMat.uniforms.uPulse.value = state.beatPulse;
  if (horizon) horizon.material.opacity = 0.3 + state.beatPulse * 0.28;
  if (stars) stars.rotation.z += dt * 0.004;

  /* notes */
  let idx = 0;
  if (playing) {
    for (let i = 0; i < state.notes.length; i++) {
      const n = state.notes[i];
      const z = (sp - n.t) * speed;
      if (z < -96) break;
      if (z > 6) continue;
      if (n.judged) continue;
      if (idx >= 128) break;
      const x = LANE_X[n.lane];
      tmpQ.identity();
      tmpP.set(x, NOTE_Y, z);
      tmpS.set(LANE_W * 0.8, 0.3, 0.26);
      tmpM.compose(tmpP, tmpQ, tmpS);
      noteMesh.setMatrixAt(idx, tmpM);
      noteMesh.setColorAt(idx, tmpColor.setHex(LANE_COLOR[n.lane]));
      tmpS.set(LANE_W * 0.42, 0.13, 0.14);
      tmpM.compose(tmpP, tmpQ, tmpS);
      coreMesh.setMatrixAt(idx, tmpM);
      idx++;
    }

    for (let i = state.cursor; i < state.notes.length; i++) {
      const n = state.notes[i];
      if (n.t > sp - W_MISS) break;
      if (!n.judged) missNote(n);
    }
    while (state.cursor < state.notes.length && state.notes[state.cursor].judged) state.cursor++;
  }
  for (let i = idx; i < 128; i++) {
    tmpS.set(0, 0, 0);
    tmpP.set(0, -10, 0);
    tmpM.compose(tmpP, tmpQ, tmpS);
    noteMesh.setMatrixAt(i, tmpM);
    coreMesh.setMatrixAt(i, tmpM);
  }
  noteMesh.instanceMatrix.needsUpdate = true;
  coreMesh.instanceMatrix.needsUpdate = true;
  if (noteMesh.instanceColor) noteMesh.instanceColor.needsUpdate = true;

  for (let i = 0; i < LANES; i++) {
    const p = pads[i];
    p.flash = Math.max(0, p.flash - dt * 3.2);
    p.mat.uniforms.uGlow.value = 0.14 + p.flash * 0.8;
    p.pillar.uniforms.uFlash.value = p.flash;
    p.pillar.uniforms.uPulse.value = state.beatPulse;
  }
  pads.lineMat.opacity = 0.32 + state.beatPulse * 0.35;

  for (let i = 0; i < bursts.length; i++) {
    const b = bursts[i];
    if (b.life <= 0) { if (b.sprite.visible) b.sprite.visible = false; continue; }
    b.life -= dt;
    const k = 1 - Math.max(0, b.life) / b.max;
    b.mat.opacity = Math.max(0, 1 - k) * 0.9;
    const s = b.size * (0.5 + k * 1.2);
    b.sprite.scale.set(s, s * 0.6, 1);
    if (b.life <= 0) b.sprite.visible = false;
  }

  if (state.shake > 0) {
    state.shake = Math.max(0, state.shake - dt * 1.5);
    camera.position.x = (Math.random() - 0.5) * state.shake * 0.6;
    camera.position.y = 2.0 + cameraD * 0.3 + (Math.random() - 0.5) * state.shake * 0.45;
    if (state.shake === 0) {
      camera.position.x = 0;
      camera.position.y = 2.0 + cameraD * 0.3;
    }
  }

  if (judgeTimer > 0) {
    judgeTimer -= dt;
    if (judgeTimer <= 0) {
      const j = $('judge');
      if (j) j.classList.remove('on');
    }
  }

  if (playing) {
    updateHud(false);
    updateCountdown(sp);
    if (sp > SONG_LEN - 0.04) finishRun();
  }

  renderer.render(scene, camera);
}

function updateCountdown(sp) {
  const cd = $('countdown');
  if (!cd) return;
  const firstT = state.notes.length ? state.notes[0].t : 4 * SPB;
  const remain = firstT - sp;
  let label = '';
  if (remain > 0.02) {
    if (remain <= 4 * SPB) label = String(Math.max(1, Math.ceil(remain / SPB)));
  } else if (remain > -0.36) {
    label = 'GO';
  }
  if (label === countLabel) return;
  countLabel = label;
  cd.textContent = label;
  cd.className = label ? 'on' : '';
  if (label) { void cd.offsetWidth; cd.classList.add('tick'); }
}

/* ═══════════════════════════════ boot ═══════════════════════════════ */
function showFallback() {
  const l = $('loader');
  if (l) l.classList.add('hidden');
  const fb = $('fallback');
  if (fb) fb.classList.add('on');
}

function boot() {
  try {
    initScene();
  } catch (err) {
    showFallback();
    return;
  }
  window.__npReady = true;
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));

  state.diff = readStr(STORE.diff, 'normal');
  if (!DIFFS[state.diff]) state.diff = 'normal';
  synth.muted = readStr(STORE.sound, '1') === '0';
  syncSoundButton();
  refreshMenuStats();

  document.addEventListener('np:lang', () => {
    syncSoundButton();
    state.sectionName = '';
    updateHud(true);
    refreshMenuStats();
  });

  window.__NP = {
    state: state,
    notes: () => state.notes,
    press: press,
    start: startRun,
    finish: finishRun,
    songPos: nowSong,
    mult: multOf,
    buildChart: buildChart,
    camera: () => ({ d: cameraD, x: camera.position.x, y: camera.position.y })
  };

  setTimeout(() => {
    const l = $('loader');
    if (l) l.classList.add('hidden');
  }, 120);

  requestAnimationFrame(frame);
  updateHud(true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
