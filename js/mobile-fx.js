/* ==========================================================================
   mobile-fx.js — 폰·태블릿(≤1024px) 전용 스크롤·터치 인터랙션
   --------------------------------------------------------------------------
   skrollr를 쓰지 않는다. 네이티브 터치 스크롤 위에서
     · requestAnimationFrame 으로 스크롤 진행률(--p)과 씬별 진행률을 계산
     · IntersectionObserver 로 진입 리빌(is-in)을 트리거
     · pointerdown/pointermove 로 카드 스포트라이트·3D 틸트·리플
   만 담당한다. 터치 스크롤은 절대 가로막지 않는다(preventDefault 없음).
   1025px 이상으로 넓어지면 스스로 정리(teardown)하고 PC 동작만 남긴다.
   ========================================================================== */
(function () {
  'use strict';

  var MQ = window.matchMedia('(max-width: 1024px)');
  var RMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var root = document.documentElement;

  var active = false;
  var rafId = 0;
  var io = null;
  var els = null;
  var stickTop = 78;
  var cleanups = [];

  /* ---------- 유틸 ---------- */
  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function r3(v) {
    return Math.round(v * 1000) / 1000;
  }
  function all(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function setVar(el, name, value) {    if (!el) return;
    if (typeof value === 'number') value = r3(value);
    var prev = el.__mfx && el.__mfx[name];
    if (prev === value) return;
    if (!el.__mfx) el.__mfx = {};
    el.__mfx[name] = value;
    el.style.setProperty(name, value);
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(function () {
      target.removeEventListener(type, fn, opts);
    });
  }

  /* ---------- 텍스트를 단어 단위로 쪼개 클립 리빌 준비 ---------- */
  function splitWords(el, maxDelaySteps) {
    if (!el || el.__mfxSplit) return false;
    el.__mfxSplit = true;

    var nodes = Array.prototype.slice.call(el.childNodes);
    nodes.forEach(function (node) {
      if (node.nodeType === 3) {
        var text = node.nodeValue;
        if (!/\S/.test(text)) {
          // 공백만 있는 노드는 그대로 두면 단어 사이 간격이 사라지므로 하나로 정리
          if (text.length) node.nodeValue = ' ';
          return;
        }
        var frag = document.createDocumentFragment();
        text.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(' '));
          } else {
            var w = document.createElement('span');
            w.className = 'mfx-w';
            var inner = document.createElement('span');
            inner.className = 'mfx-w__i';
            inner.textContent = part;
            w.appendChild(inner);
            frag.appendChild(w);
          }
        });
        el.replaceChild(frag, node);
      } else if (node.nodeType === 1 && node.tagName !== 'BR') {
        splitWords(node, maxDelaySteps);
      }
    });

    all('.mfx-w', el).forEach(function (w, i) {
      w.style.setProperty('--i', Math.min(i, maxDelaySteps || 16));
    });
    return true;
  }

  /* ---------- 리플 레이어 ---------- */
  function rippleLayer(el) {
    var layer = el.querySelector(':scope > .mfx-ripple');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'mfx-ripple';
      layer.setAttribute('aria-hidden', 'true');
      el.appendChild(layer);
    }
    return layer;
  }

  function spawnRipple(el, x, y) {
    if (RMQ.matches) return;
    var layer = rippleLayer(el);
    var i = document.createElement('i');
    i.style.left = x + 'px';
    i.style.top = y + 'px';
    layer.appendChild(i);
    window.setTimeout(function () {
      if (i.parentNode) i.parentNode.removeChild(i);
    }, 760);
  }

  /* ---------- 터치 스포트라이트 + 3D 틸트 + 리플 ---------- */
  function attachTilt(el, maxDeg) {
    var pressed = false;
    var moveTimer = 0;
    var deg = typeof maxDeg === 'number' ? maxDeg : 6;

    function point(e) {
      var rect = el.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        w: rect.width || 1,
        h: rect.height || 1
      };
    }

    function apply(e) {
      var p = point(e);
      setVar(el, '--mx', Math.round((p.x / p.w) * 100) + '%');
      setVar(el, '--my', Math.round((p.y / p.h) * 100) + '%');
      setVar(el, '--spot', 1);
      var ry = ((p.x / p.w) - 0.5) * 2 * deg;
      var rx = -((p.y / p.h) - 0.5) * 2 * deg * 0.72;
      setVar(el, '--ty', ry.toFixed(2) + 'deg');
      setVar(el, '--tx', rx.toFixed(2) + 'deg');
    }

    function reset() {
      pressed = false;
      el.classList.remove('is-press');
      setVar(el, '--spot', 0);
      setVar(el, '--tx', '0deg');
      setVar(el, '--ty', '0deg');
    }

    on(el, 'pointerdown', function (e) {
      pressed = true;
      el.classList.add('is-press');
      var p = point(e);
      spawnRipple(el, p.x, p.y);
      apply(e);
      if (e.pointerType === 'mouse') return;
      // 손가락이 스크롤을 시작하면 브라우저가 pointercancel을 보낸다
      window.setTimeout(function () {
        if (pressed) el.classList.remove('is-press');
      }, 420);
    }, { passive: true });

    on(el, 'pointermove', function (e) {
      if (e.pointerType === 'mouse' || pressed) {
        apply(e);
        if (pressed) {
          window.clearTimeout(moveTimer);
          moveTimer = window.setTimeout(function () {
            if (pressed) el.classList.remove('is-press');
          }, 420);
        }
      }
    }, { passive: true });

    on(el, 'pointerup', function () {
      window.setTimeout(reset, 240);
    }, { passive: true });

    on(el, 'pointercancel', reset, { passive: true });
    on(el, 'pointerleave', function () {
      if (!pressed) reset();
    }, { passive: true });
  }

  /* ---------- 앰비언트 색온도 ---------- */
  var PALETTE = [
    { at: 0.0, a: [58, 100, 64], b: [122, 104, 86] },
    { at: 0.24, a: [36, 74, 48], b: [58, 100, 64] },
    { at: 0.48, a: [129, 122, 107], b: [46, 88, 58] },
    { at: 0.72, a: [168, 128, 74], b: [38, 70, 52] },
    { at: 1.0, a: [196, 148, 82], b: [34, 40, 30] }
  ];

  function ambient(p) {
    var i = 0;
    while (i < PALETTE.length - 2 && p > PALETTE[i + 1].at) i++;
    var s = PALETTE[i];
    var e = PALETTE[i + 1];
    var t = clamp01((p - s.at) / Math.max(0.0001, e.at - s.at));
    var a = [0, 1, 2].map(function (k) {
      return Math.round(s.a[k] + (e.a[k] - s.a[k]) * t);
    });
    var b = [0, 1, 2].map(function (k) {
      return Math.round(s.b[k] + (e.b[k] - s.b[k]) * t);
    });
    setVar(root, '--amb-a', 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',0.55)');
    setVar(root, '--amb-b', 'rgba(' + b[0] + ',' + b[1] + ',' + b[2] + ',0.42)');
  }

  /* ---------- 매 프레임 계산 ---------- */
  function frame() {
    rafId = 0;
    if (!active || !els) return;

    var vh = window.innerHeight || 1;
    var y = window.pageYOffset || root.scrollTop || 0;
    var max = Math.max(1, (root.scrollHeight || document.body.scrollHeight) - vh);
    var p = clamp01(y / max);

    setVar(root, '--p', p);
    if (els.bar) els.bar.style.transform = 'scaleX(' + r3(p) + ')';
    if (els.header) els.header.classList.toggle('is-scrolled', y > 10);
    if (els.top) els.top.classList.toggle('is-shown', p > 0.06 && y > vh * 0.6);

    ambient(p);

    /* 히어로 스티키 씬 */
    if (els.hero) {
      var hr = els.hero.getBoundingClientRect();
      var span = Math.max(1, hr.height - vh);
      var hp = clamp01(-hr.top / span);
      var out = clamp01((hp - 0.72) / 0.28);

      setVar(els.hero, '--hero-zoom', 1 + hp * 0.34);
      setVar(els.hero, '--hero-shift', Math.round(-hp * vh * 0.12) + 'px');
      setVar(els.hero, '--hero-blur', clamp01(hp * 1.45));
      setVar(els.hero, '--hero-lift', Math.round(-hp * vh * 0.2) + 'px');
      setVar(els.hero, '--hero-scale', 1 + hp * 0.14);
      setVar(els.hero, '--hero-fade', clamp01(1 - hp * 1.6));
      setVar(els.hero, '--hero-drift', Math.round(hp * 34) + 'px');
      setVar(els.hero, '--hero-cue', clamp01(1 - hp * 3.2));
      setVar(els.hero, '--hero-eyebrow', Math.round(-hp * vh * 0.06) + 'px');
      setVar(els.hero, '--hero-out', out);
      if (els.heroStage) {
        els.heroStage.style.setProperty('--hero-dim', r3(clamp01(1 - out * 1.05)));
      }
    }

    /* 스티키 스택 카드 */
    if (els.cards && els.cards.length) {
      for (var i = 0; i < els.cards.length; i++) {
        var card = els.cards[i];
        var next = els.cards[i + 1];
        if (!next) continue;
        var nr = next.getBoundingClientRect();
        var cr = card.getBoundingClientRect();
        var myTop = stickTop + i * 10;
        var cover = clamp01((myTop + cr.height - nr.top) / Math.max(1, cr.height));
        setVar(card, '--stack', 1 - cover * 0.03);
      }
    }

    /* 리빌 보조 장치 */
    if (els.reveals && els.reveals.length) {
      var rest = [];
      for (var k = 0; k < els.reveals.length; k++) {
        var rv = els.reveals[k];
        var rr = rv.getBoundingClientRect();
        if (rr.top < vh * 0.92 && rr.bottom > vh * 0.02) {
          rv.classList.add('is-in');
        } else {
          rest.push(rv);
        }
      }
      els.reveals = rest;
    }

    /* 패럴랙스 */
    if (els.parallax) {
      for (var j = 0; j < els.parallax.length; j++) {
        var item = els.parallax[j];
        var r = item.el.getBoundingClientRect();
        if (r.bottom < -240 || r.top > vh + 240) continue;
        var mid = r.top + r.height / 2 - vh / 2;
        var val = -(mid / vh) * item.strength;
        if (item.bg) {
          setVar(item.el, '--bpy', Math.round(48 + val * 0.35) + '%');
        } else {
          setVar(item.el, '--par', Math.round(val) + 'px');
        }
      }
    }
  }

  function requestFrame() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(frame);
  }

  /* ---------- 초기화 ---------- */
  function measure() {
    if (!els) return;
    if (els.header) {
      stickTop = Math.round(els.header.getBoundingClientRect().height) + 14;
    }
    root.style.setProperty('--stick-top', stickTop + 'px');

    /* 카드 덱 높이를 가장 큰 카드에 맞춰 통일한다 */
    if (els.cards && els.cards.length) {
      root.style.removeProperty('--card-h');
      var maxH = 0;
      els.cards.forEach(function (box) {
        var inner = box.querySelector('.sec_ani');
        if (inner) maxH = Math.max(maxH, Math.ceil(inner.getBoundingClientRect().height));
      });
      if (maxH > 0) root.style.setProperty('--card-h', maxH + 'px');
    }
  }

  function setup() {
    if (active) return;
    active = true;

    els = {
      header: document.querySelector('header'),
      hero: document.getElementById('mfxHero'),
      heroStage: document.querySelector('.mfx-hero__stage'),
      bar: document.getElementById('mfxProgressBar'),
      top: document.getElementById('mfxTop'),
      cards: [],
      parallax: [],
      reveals: []
    };

    if (!els.heroStage) els.heroStage = document.querySelector('.mfx-hero__stage');

    /* 스택 카드 */
    all('#section2 .box').forEach(function (box) {
      if (box.querySelector('.sec_ani')) {
        box.style.setProperty('--idx', els.cards.length);
        els.cards.push(box);
      }
    });

    /* 히어로 타이틀 라인 지연 인덱스 */
    all('.mfx-line').forEach(function (line, i) {
      line.style.setProperty('--i', i);
    });

    /* 단어 리빌 */
    all('.m-about, #section1 .sec1_ani6, #section1 .sec1_ani7, #section3 .sec1_ani1, #section3 .sec1_ani7, #section4 .sec1_ani1')
      .forEach(function (el) {
        splitWords(el, 16);
      });

    /* EFFECT 제목 단어 리빌 */
    all('#section4 .sec2_ani2 > div').forEach(function (div, i) {
      if (div.__mfxSplit) return;
      div.__mfxSplit = true;
      var span = document.createElement('span');
      span.innerHTML = div.innerHTML;
      div.innerHTML = '';
      div.appendChild(span);
      span.style.setProperty('--di', i);
    });

    /* 타일 스태거 인덱스 */
    all('#section3 .ani1_La').forEach(function (el, i) {
      el.style.setProperty('--i', i);
    });
    all('#section4 .sec1_ani2, #section4 .sec1_ani3, #section4 .sec1_ani4, #section4 .sec1_ani5')
      .forEach(function (el, i) {
        el.style.setProperty('--i', i);
      });

    /* IntersectionObserver 리빌 */
    var revealTargets = all(
      [
        '#section1 .sec1_ani6',
        '#section1 .sec1_ani4',
        '#section1 .sec1_ani7',
        '#section1 .sec1_ani5 .m-about',
        '#section2 .box',
        '#section3 .sec1_ani1',
        '#section3 .sec1_ani3',
        '#section3 .ani1_La',
        '#section3 .sec1_ani7',
        '#section4 .sec1_ani1',
        '#section4 .sec1_ani2',
        '#section4 .sec1_ani3',
        '#section4 .sec1_ani4',
        '#section4 .sec1_ani5',
        '#section4 .sec2_ani1',
        '#section4 .sec2_ani2',
        '#section4 .sec2_ani3',
        '#section4 .sec2_ani4',
        '#section4 .sec2_ani5',
        '#section4 .sec2_ani6',
        '#section4 .sec2_ani7'
      ].join(',')
    );

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
      revealTargets.forEach(function (el) {
        io.observe(el);
      });
    } else {
      revealTargets.forEach(function (el) {
        el.classList.add('is-in');
      });
    }

    /* clip-path로 가려진 요소는 IntersectionObserver가 교차 면적을 0으로 보기도
       하므로, 프레임 안에서 위치로도 확실히 깨운다(보조 장치). */
    els.reveals = [];
    revealTargets.forEach(function (el) {
      if (!el.classList.contains('is-in')) {
        els.reveals.push(el);
      }
    });

    /* 패럴랙스 대상 */
    [
      { sel: '#section1 .sec1_ani4', strength: 46 },
      { sel: '#section3 .sec1_ani3', strength: 40, bg: true },
      { sel: '#section4 .sec2_ani1', strength: 26 },
      { sel: '#section4 .sec2_ani3', strength: 34 },
      { sel: '#section4 .sec2_ani4', strength: 26 },
      { sel: '#section4 .sec2_ani5', strength: 34 },
      { sel: '#section4 .sec2_ani6', strength: 26 },
      { sel: '#section4 .sec2_ani7', strength: 34 }
    ].forEach(function (cfg) {
      all(cfg.sel).forEach(function (el) {
        els.parallax.push({ el: el, strength: cfg.strength, bg: !!cfg.bg });
      });
    });

    /* 터치 스포트라이트·틸트 */
    all('#section2 .sec_ani').forEach(function (el) {
      attachTilt(el, 7);
    });
    all('#section3 .ani1_La').forEach(function (el) {
      attachTilt(el, 5);
    });
    all('#section4 .sec1_ani2, #section4 .sec1_ani3, #section4 .sec1_ani4, #section4 .sec1_ani5')
      .forEach(function (el) {
        attachTilt(el, 6);
      });

    /* 맨 위로 */
    if (els.top) {
      on(els.top, 'click', function () {
        window.scrollTo({ top: 0, behavior: RMQ.matches ? 'auto' : 'smooth' });
      });
    }

    /* 스크롤·리사이즈 */
    on(window, 'scroll', requestFrame, { passive: true });
    on(window, 'resize', function () {
      measure();
      requestFrame();
    }, { passive: true });
    on(window, 'orientationchange', function () {
      measure();
      requestFrame();
    }, { passive: true });

    measure();
    requestFrame();
    window.setTimeout(measure, 350);
    window.setTimeout(requestFrame, 350);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        measure();
        requestFrame();
      });
    }
    on(window, 'load', function () {
      measure();
      requestFrame();
    });
  }

  function teardown() {
    if (!active) return;
    active = false;

    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (io) {
      io.disconnect();
      io = null;
    }
    cleanups.forEach(function (fn) {
      fn();
    });
    cleanups = [];

    /* PC로 돌아가면 모바일 효과 흔적을 지운다 (skrollr가 위치를 다시 계산) */
    if (els) {
      var touched = [els.hero, els.heroStage, root].concat(els.cards || []);
      (els.parallax || []).forEach(function (item) {
        touched.push(item.el);
      });
      touched.forEach(function (el) {
        if (!el) return;
        el.style.removeProperty('--hero-zoom');
        el.style.removeProperty('--hero-shift');
        el.style.removeProperty('--hero-blur');
        el.style.removeProperty('--hero-lift');
        el.style.removeProperty('--hero-scale');
        el.style.removeProperty('--hero-fade');
        el.style.removeProperty('--hero-drift');
        el.style.removeProperty('--hero-cue');
        el.style.removeProperty('--hero-eyebrow');
        el.style.removeProperty('--hero-out');
        el.style.removeProperty('--hero-dim');
        el.style.removeProperty('--stack');
        el.style.removeProperty('--out');
        el.style.removeProperty('--par');
        el.style.removeProperty('--bpy');
        if (el.__mfx) el.__mfx = null;
      });
      if (els.bar) els.bar.style.transform = '';
      root.style.removeProperty('--card-h');
      root.style.removeProperty('--stick-top');
      root.style.removeProperty('--p');
      root.style.removeProperty('--amb-a');
      root.style.removeProperty('--amb-b');
      (els.cards || []).forEach(function (box) {
        box.style.removeProperty('--idx');
      });
      if (els.top) els.top.classList.remove('is-shown');
      if (els.header) els.header.classList.remove('is-scrolled');
      all('#section2 .sec_ani, #section3 .ani1_La, #section4 .sec1_ani2, #section4 .sec1_ani3, #section4 .sec1_ani4, #section4 .sec1_ani5')
        .forEach(function (el) {
          ['--tx', '--ty', '--spot', '--mx', '--my'].forEach(function (v) {
            el.style.removeProperty(v);
          });
          el.__mfx = null;
          el.classList.remove('is-press');
          var layer = el.querySelector(':scope > .mfx-ripple');
          if (layer) layer.parentNode.removeChild(layer);
        });
    }
    els = null;
  }

  function sync() {
    if (MQ.matches) {
      setup();
    } else {
      teardown();
    }
  }

  if (MQ.addEventListener) {
    MQ.addEventListener('change', sync);
  } else if (MQ.addListener) {
    MQ.addListener(sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
