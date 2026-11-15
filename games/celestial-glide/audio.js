/* ══════════════════════════════════════════════════════════════════════
   Celestial Glide — procedural audio
   Every sound is synthesised at runtime with the Web Audio API: no audio
   files, no downloads, nothing to buffer. A drone pad + arpeggio carries
   the music, and short envelopes cover the game events.
   ══════════════════════════════════════════════════════════════════════ */

const PREF = 'celestial-glide.sound';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    try { this.enabled = localStorage.getItem(PREF) !== '0'; } catch (e) { /* private mode */ }

    this.intensity = 0;
    this._bgm = null;
    this._step = 0;
    this._next = 0;
    this._running = false;
    this._bpm = 104;

    /* A-minor pentatonic figures; -1 is a rest. One pattern per sector band. */
    this.patterns = [
      [0, -1, 2, -1, 4, -1, 2, -1, 0, -1, 3, -1, 5, -1, 3, -1],
      [0, -1, 2, 4, -1, 5, -1, 2, 4, -1, 7, -1, 5, 4, 2, -1],
      [0, 4, 7, 9, -1, 7, 4, 2, 0, 4, 7, 11, 9, 7, 4, 2]
    ];
  }

  /* ── lifecycle ───────────────────────────────────────────────────── */

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ready;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 20;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.24;
      master.connect(comp);
      comp.connect(ctx.destination);

      const rev = ctx.createConvolver();
      rev.buffer = this._impulse(2.6);
      const revOut = ctx.createGain();
      revOut.gain.value = 0.30;
      rev.connect(revOut);
      revOut.connect(master);

      const music = ctx.createGain();
      music.gain.value = 0.62;
      music.connect(master);
      music.connect(rev);

      const sfx = ctx.createGain();
      sfx.gain.value = 0.95;
      sfx.connect(master);
      sfx.connect(rev);

      this.master = master;
      this.rev = rev;
      this.music = music;
      this.sfxBus = sfx;
      this.noise = this._noiseBuf(1.6);
      this.ready = true;
      if (this.enabled) this._to(0.62, 1.1);
      return true;
    } catch (e) {
      this.ready = false;
      return false;
    }
  }

  get ok() { return this.ready && this.enabled && this.ctx && this.ctx.state === 'running'; }

  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem(PREF, this.enabled ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!this.ready) { if (this.enabled) this.init(); return; }
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._to(this.enabled ? 0.62 : 0, 0.22);
  }

  _to(v, t) {
    if (!this.ready) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + t);
    } catch (e) { /* ignore */ }
  }

  /* ── music ───────────────────────────────────────────────────────── */

  startMusic() {
    if (!this.ready || this._running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    try {
      const bus = ctx.createGain();
      bus.gain.value = 0;
      bus.connect(this.music);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.Q.value = 0.8;
      lp.connect(bus);

      const oscs = [];
      [[55, 'sawtooth', 0.14], [82.41, 'sawtooth', 0.10], [110, 'triangle', 0.09], [164.81, 'triangle', 0.05]]
        .forEach(([f, type, amp], i) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          o.detune.value = i % 2 ? -7 : 7;
          const g = ctx.createGain();
          g.gain.value = amp;
          o.connect(g);
          g.connect(lp);
          o.start(now);
          oscs.push(o);
        });

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.055;
      const lg = ctx.createGain();
      lg.gain.value = 150;
      lfo.connect(lg);
      lg.connect(lp.frequency);
      lfo.start(now);

      bus.gain.linearRampToValueAtTime(0.5, now + 3.5);
      this._bgm = { bus, lp, oscs, lfo };
      this._running = true;
      this._step = 0;
      this._next = now + 0.12;
      this.setIntensity(this.intensity);
    } catch (e) { /* audio is a bonus, never fatal */ }
  }

  stopMusic() {
    if (!this._running || !this._bgm) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const bgm = this._bgm;
    this._running = false;
    this._bgm = null;
    try {
      bgm.bus.gain.cancelScheduledValues(now);
      bgm.bus.gain.setValueAtTime(bgm.bus.gain.value, now);
      bgm.bus.gain.linearRampToValueAtTime(0, now + 1.1);
      bgm.oscs.forEach((o) => { try { o.stop(now + 1.3); } catch (e) {} });
      try { bgm.lfo.stop(now + 1.3); } catch (e) {}
    } catch (e) { /* ignore */ }
  }

  setIntensity(v) {
    this.intensity = Math.max(0, Math.min(2, v | 0));
    this._bpm = 104 + this.intensity * 9;
    if (this._bgm) {
      const now = this.ctx.currentTime;
      try {
        this._bgm.lp.frequency.cancelScheduledValues(now);
        this._bgm.lp.frequency.setTargetAtTime(520 + this.intensity * 240, now, 1.4);
      } catch (e) { /* ignore */ }
    }
  }

  /* Called once per animation frame while a run is live. */
  tick() {
    if (!this._running || !this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this._next < now - 0.4) this._next = now + 0.05;
    if (this._next < now) this._next = now + 0.02;
    while (this._next < now + 0.3) {
      this._note(this._next, this._step);
      this._next += 60 / this._bpm / 2;
      this._step++;
    }
  }

  _note(t, step) {
    const ctx = this.ctx;
    const pat = this.patterns[this.intensity] || this.patterns[0];
    const deg = pat[step % pat.length];
    if (deg >= 0) {
      const f = 220 * Math.pow(2, deg / 12);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.58);
      o.connect(g);
      g.connect(this.music);
      o.start(t);
      o.stop(t + 0.62);
    }
    if (step % 8 === 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(54, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
      o.connect(g);
      g.connect(this.music);
      o.start(t);
      o.stop(t + 0.95);
    }
  }

  /* ── effects ─────────────────────────────────────────────────────── */

  sfx(name, arg) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    try {
      switch (name) {
        case 'gate': return this._gate(t, arg || 0);
        case 'hit': return this._hit(t);
        case 'boost': return this._boost(t);
        case 'mote': return this._mote(t);
        case 'over': return this._over(t);
        case 'start': return this._start(t);
        case 'click': return this._blip(t, 520, 0.05, 0.05);
        case 'record': return this._arp(t, [0, 4, 7, 12], 0.09, 0.09);
        default: return;
      }
    } catch (e) { /* ignore */ }
  }

  _blip(t, f, dur, amp, type) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _arp(t, semis, gap, amp) {
    semis.forEach((s, i) => {
      this._blip(t + i * gap, 440 * Math.pow(2, s / 12), 0.34, amp, 'triangle');
    });
  }

  _gate(t, tier) {
    const ctx = this.ctx;
    const base = 620 * Math.pow(2, Math.min(7, tier) / 12);
    [[1, 0.09, 'sine'], [1.5, 0.05, 'triangle'], [2, 0.028, 'sine']].forEach(([m, amp, type]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(base * m, t);
      o.frequency.exponentialRampToValueAtTime(base * m * 1.01, t + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(g);
      g.connect(this.sfxBus);
      o.start(t);
      o.stop(t + 0.45);
    });
  }

  _hit(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.52);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.34, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(og);
    og.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.58);
  }

  _boost(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.8);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.72);
  }

  _mote(t) {
    this._arp(t, [0, 4, 9], 0.055, 0.075);
  }

  _over(t) {
    const ctx = this.ctx;
    [0, 3, 7, 10].forEach((s, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(220 * Math.pow(2, s / 12), t + i * 0.06);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(240, t + 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.08 + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.sfxBus);
      o.start(t + i * 0.06);
      o.stop(t + 2);
    });
  }

  _start(t) {
    this._arp(t, [0, 7, 12, 19], 0.075, 0.085);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.62);
  }

  /* ── buffers ─────────────────────────────────────────────────────── */

  _impulse(dur) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) * (1 - t * 0.2);
      }
    }
    return buf;
  }

  _noiseBuf(dur) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
