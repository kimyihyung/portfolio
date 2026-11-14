/* ─────────────────────────────────────────────────────────────
   Portal 3D · shared sound engine
   - iOS Safari safe: the AudioContext is created inside a real user
     gesture, then a silent buffer is started and resume() is awaited.
   - Default OFF, remembered in localStorage.
   - No dependencies. Exposes window.PortalSound.
   ───────────────────────────────────────────────────────────── */
(function () {
  if (window.PortalSound) return;

  var LS_ON = 'pk3d.sound';
  var LS_VOL = 'pk3d.volume';
  var LS_HINT = 'pk3d.sound.hint';

  var Sound = {
    ctx: null,
    master: null,
    ambGain: null,
    ambNodes: null,
    on: false,
    vol: 0.6,
    kind: 'portal',
    ready: false,
    supported: !!(window.AudioContext || window.webkitAudioContext),
    _noise: null,
    _ui: null,

    /* ── persistence ───────────────────────────────────────── */
    read() {
      try {
        var s = localStorage.getItem(LS_ON);
        if (s !== null) this.on = s === '1';
        var v = parseFloat(localStorage.getItem(LS_VOL));
        if (!isNaN(v)) this.vol = Math.min(1, Math.max(0, v));
      } catch (e) {}
      return this;
    },
    save() {
      try {
        localStorage.setItem(LS_ON, this.on ? '1' : '0');
        localStorage.setItem(LS_VOL, String(this.vol));
      } catch (e) {}
    },

    /* ── context ───────────────────────────────────────────── */
    create() {
      if (this.ctx) return true;
      if (!this.supported) return false;
      var AC = window.AudioContext || window.webkitAudioContext;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        this.ready = true;
        this._silent();
        this.resume();
        return true;
      } catch (err) {
        if (window.__errors) window.__errors.push('audio: ' + err);
        this.ready = false;
        return false;
      }
    },

    /* A one-sample silent buffer started inside the gesture is what
       actually unlocks playback on older iOS Safari. */
    _silent() {
      if (!this.ctx) return;
      try {
        var b = this.ctx.createBuffer(1, 1, 22050);
        var s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
      } catch (e) {}
    },

    resume() {
      if (!this.ctx) return;
      var ctx = this.ctx;
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        try {
          var p = ctx.resume();
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      }
    },

    /* Any real gesture may unlock; called by the global listener. */
    unlock() {
      if (!this.ctx) {
        if (!this.on) return;
        if (!this.create()) return;
      }
      this.resume();
      this._silent();
      if (this.on) this._applyGain();
      if (this.on && this.ambNodes && this.ambGain) {
        var now = this.ctx.currentTime;
        this.ambGain.gain.cancelScheduledValues(now);
        this.ambGain.gain.linearRampToValueAtTime(0.9, now + 1.2);
      }
    },

    _applyGain() {
      if (!this.master || !this.ctx) return;
      var now = this.ctx.currentTime;
      var target = this.on ? Math.max(0, Math.min(1, this.vol)) * 0.9 : 0;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(target, now + (this.on ? 0.25 : 0.35));
    },

    /* ── public controls ───────────────────────────────────── */
    setEnabled(v) {
      this.on = !!v;
      if (this.on) {
        if (this.create()) {
          this.resume();
          if (this.kind && this.kind !== 'off') this.ambient(this.kind);
        }
      }
      this._applyGain();
      this.save();
      this.syncUI();
      return this.on;
    },
    toggle() { return this.setEnabled(!this.on); },
    setVolume(v) {
      this.vol = Math.min(1, Math.max(0, v));
      this._applyGain();
      this.save();
      this.syncUI();
    },

    /* ── ui binding ────────────────────────────────────────── */
    ui(root) {
      this._ui = root || null;
      var wrap = this._ui || document.querySelector('[data-snd]');
      if (!wrap) return this;
      this._wrap = wrap;
      this._btn = wrap.querySelector('.sndbtn');
      this._range = wrap.querySelector('.sndvol');
      var self = this;
      if (this._btn) {
        this._btn.addEventListener('click', function () {
          var on = self.toggle();
          if (on) self.play('toggle-on');
          self.toastHintOnce(true);
        });
      }
      if (this._range) {
        this._range.value = String(Math.round(this.vol * 100));
        this._range.addEventListener('input', function () {
          self.setVolume(parseFloat(this.value) / 100);
        });
        /* keep the page's swipe handlers from eating the drag */
        this._range.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        this._range.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
      }
      this.syncUI();
      return this;
    },
    syncUI() {
      var wrap = this._wrap;
      if (!wrap) return;
      wrap.classList.toggle('on', this.on);
      if (this._btn) {
        this._btn.setAttribute('aria-pressed', this.on ? 'true' : 'false');
        this._btn.setAttribute('aria-label', this.on ? '사운드 끄기' : '사운드 켜기');
        this._btn.setAttribute('title', this.on ? '사운드 끄기' : '사운드 켜기');
        var ico = this._btn.querySelector('.sndico');
        var lbl = this._btn.querySelector('.sndlbl');
        if (ico) ico.textContent = this.on ? '🔊' : '🔇';
        if (lbl) lbl.textContent = this.on ? '사운드 켜짐' : '사운드';
      }
      if (this._range) this._range.value = String(Math.round(this.vol * 100));
    },

    /* one gentle pulse so people find the control (never a nag) */
    hintPulse() {
      if (this.on) return;
      var seen = null;
      try { seen = localStorage.getItem(LS_HINT); } catch (e) {}
      if (seen) return;
      var wrap = this._wrap;
      if (!wrap) return;
      wrap.classList.add('hint');
      try { localStorage.setItem(LS_HINT, '1'); } catch (e) {}
      setTimeout(function () { wrap.classList.remove('hint'); }, 6400);
    },
    toastHintOnce() {},

    /* ── low level voices ──────────────────────────────────── */
    tone(freq, when, dur, peak, type) {
      var ctx = this.ctx;
      if (!ctx) return;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, when);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g).connect(this.master);
      o.start(when);
      o.stop(when + dur + 0.06);
    },
    _noiseBuffer() {
      if (this._noise) return this._noise;
      var ctx = this.ctx;
      var len = Math.floor(ctx.sampleRate * 1.2);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = 0.985 * last + 0.015 * w;
        d[i] = last * 2.6;
      }
      this._noise = buf;
      return buf;
    },
    swell(when, dur, freq, peak, q) {
      var ctx = this.ctx;
      if (!ctx) return;
      var src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, when);
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.45), when + dur);
      bp.Q.value = q || 0.9;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + dur * 0.28);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      src.connect(bp).connect(g).connect(this.master);
      src.start(when);
      src.stop(when + dur + 0.05);
    },

    /* ── cues ──────────────────────────────────────────────── */
    play(name, opt) {
      if (!this.on) return;
      if (!this.ctx || !this.ready) return;
      if (this.ctx.state !== 'running') { this.unlock(); if (this.ctx.state !== 'running') return; }
      var t = this.ctx.currentTime + 0.01;
      var o = opt || {};
      switch (name) {
        case 'move': {                     /* portal / star carousel step */
          var dir = o.dir === -1 ? -1 : 1;
          var base = 440;
          this.tone(base * (dir > 0 ? 1 : 0.84), t, 0.42, 0.055);
          this.tone(base * (dir > 0 ? 1.5 : 1.26), t + 0.075, 0.5, 0.045);
          break;
        }
        case 'open': {
          [523.25, 659.25, 880, 1174.66].forEach(function (f, i) {
            Sound.tone(f, t + i * 0.055, 1.15, 0.05 - i * 0.006);
          });
          this.swell(t, 0.7, 1800, 0.035, 0.8);
          break;
        }
        case 'close': {
          this.tone(523.25, t, 0.5, 0.04);
          this.tone(392.0, t + 0.07, 0.6, 0.035);
          break;
        }
        case 'star': {
          var scale = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5];
          var f2 = scale[(o.n || 0) % scale.length];
          this.tone(f2, t, 1.5, 0.052);
          this.tone(f2 * 2.005, t + 0.006, 0.75, 0.018);
          this.tone(f2 * 0.5, t, 1.9, 0.022);
          this.swell(t, 0.55, 3200, 0.018, 1.2);
          break;
        }
        case 'filter': {
          this.swell(t, 0.5, 1500, 0.05, 0.7);
          this.tone(392, t + 0.02, 0.3, 0.025);
          break;
        }
        case 'toggle-on': {
          this.tone(523.25, t, 0.45, 0.05);
          this.tone(783.99, t + 0.09, 0.7, 0.04);
          break;
        }
        case 'toggle-off': {
          this.tone(392, t, 0.35, 0.04);
          this.tone(261.63, t + 0.07, 0.5, 0.032);
          break;
        }
        case 'tick': this.tone(880, t, 0.12, 0.02); break;
      }
    },

    /* ── ambient bed ───────────────────────────────────────── */
    ambient(kind) {
      this.kind = kind || 'off';
      if (kind === 'off') { this.ambientOff(); return; }
      if (!this.on || !this.ctx) return;
      if (this.ambNodes) { this.setMode(kind); return; }
      var ctx = this.ctx;
      var now = ctx.currentTime;
      var self = this;
      var root = ctx.createGain();
      root.gain.value = 0;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 620;
      lp.Q.value = 0.4;
      root.connect(lp).connect(this.master);

      var nodes = [];
      var freqs = kind === 'galaxy' ? [98, 147, 196, 294] : [110, 164.8, 220];
      freqs.forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.detune.value = (i % 2 ? 6 : -6);
        var g = ctx.createGain();
        g.gain.value = i === 0 ? 0.1 : i === 1 ? 0.045 : 0.028;
        o.connect(g).connect(root);
        o.start(now);
        nodes.push(o);
      });
      /* slow breathing movement */
      var lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'galaxy' ? 0.06 : 0.09;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 140;
      lfo.connect(lfoGain).connect(lp.frequency);
      lfo.start(now);
      nodes.push(lfo);

      /* air layer */
      var air = ctx.createBufferSource();
      air.buffer = this._noiseBuffer();
      air.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'galaxy' ? 2600 : 1500;
      bp.Q.value = 0.5;
      var airGain = ctx.createGain();
      airGain.gain.value = kind === 'galaxy' ? 0.05 : 0.07;
      air.connect(bp).connect(airGain).connect(root);
      air.start(now);

      this.ambNodes = nodes;
      this.ambGain = root;
      this.ambAir = air;
      root.gain.cancelScheduledValues(now);
      root.gain.linearRampToValueAtTime(0.9, now + 1.8);
      /* keep it alive if the context gets suspended by iOS */
      if (!this._visHooked) {
        this._visHooked = true;
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible' && self.on) self.unlock();
        });
      }
    },
    setMode(kind) { this.kind = kind; },
    ambientOff() {
      if (!this.ambGain || !this.ctx) return;
      var now = this.ctx.currentTime;
      var g = this.ambGain;
      var nodes = this.ambNodes || [];
      g.gain.cancelScheduledValues(now);
      g.gain.linearRampToValueAtTime(0, now + 0.6);
      this.ambGain = null;
      this.ambNodes = null;
      setTimeout(function () {
        nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
        try { g.disconnect(); } catch (e) {}
      }, 800);
    },

    /* ── boot ──────────────────────────────────────────────── */
    boot(kind) {
      if (this._booted) {
        if (kind) this.kind = kind;
        this.syncUI();
        return this;
      }
      this._booted = true;
      this.read();
      this.kind = kind || 'portal';
      var self = this;
      var unlockOnce = function () {
        if (self.on && !self.ctx) self.create();
        if (self.on && self.ctx) {
          self.unlock();
          if (!self.ambNodes) self.ambient(self.kind);
        }
      };
      ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (ev) {
        document.addEventListener(ev, unlockOnce, { capture: true, passive: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && self.on) self.unlock();
      });
      if (this.on) this.syncUI();
      return this;
    }
  };

  Sound.boot();
  window.PortalSound = Sound;
})();
