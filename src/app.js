/**
 * FemFast — client behaviour for the static build.
 *
 * The markup is prerendered, so nothing here builds a page from scratch: it
 * attaches to the elements the build emitted (tagged with data-ff="...") and
 * updates their text, styles and attributes. The style strings below are the
 * same ones the component produced, so an updated element is byte-identical
 * to how the renderer would have drawn it.
 *
 * The check-in's plan logic is NOT reimplemented here. createPlan() comes from
 * plan.js, which the build prepends to this file and also inlines into the
 * component it prerenders with — one implementation, two callers. That is what
 * keeps the 12:12 floor, the overrides and the "Adjusted for" chips and tags
 * identical to the export.
 */
(function () {
  'use strict';

  var DATA = /*__DATA__*/null;
  if (!DATA) return;

  var PLAN = createPlan(DATA);
  var PHASES = DATA.phases.phases;
  var CYCLE = DATA.phases.cycleLength;
  var QUESTIONS = PLAN.QUESTIONS;
  var TOTAL = QUESTIONS.length;
  var RATING = DATA.rating;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var ff = function (name, root) { return $('[data-ff="' + name + '"]', root); };
  var ffAll = function (name, root) { return $$('[data-ff="' + name + '"]', root); };
  var reduceMotion = function () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  var phaseFor = PLAN.phaseFor;

  /* ===================================================== landing: the wheel */

  function initWheel() {
    var dayEl = ff('day');
    if (!dayEl) return;

    var svg = $('#phases svg');
    var drag = ff('wheelDrag');
    var hint = ff('dragHint');
    var pills = ffAll('legend');
    var marker = svg && svg.querySelector('g[transform^="rotate("][style*="transition"]');
    var iconG = marker && marker.querySelector('g[transform^="rotate("]');
    var icon = marker && marker.querySelector('image');
    var arcs = svg ? $$('circle[stroke-dasharray]', svg).filter(function (c) {
      return c.getAttribute('r') === '42';
    }) : [];

    var state = { day: 6, selected: '', touched: false };
    var timer = null, resumeTimer = null;
    var STEP_MS = 1100, RESUME_AFTER = 12000;

    function paint() {
      var ph = state.selected
        ? (PHASES.filter(function (p) { return p.id === state.selected; })[0] || phaseFor(state.day))
        : phaseFor(state.day);

      dayEl.textContent = 'Day ' + state.day;
      setText('phasePill', ph.name);
      setText('phaseRange', 'DAY ' + ph.start + '–' + ph.end + ' OF ' + CYCLE);
      setText('phaseBody', ph.body);
      setText('fast', ph.fast);
      setText('food', ph.food);
      setText('train', ph.train);
      setText('supp', ph.supp);

      // marker orbits; the glyph counter-rotates so it never tilts
      var deg = ((state.day - 0.5) / CYCLE) * 360;
      if (marker) marker.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 50 50)');
      if (iconG) iconG.setAttribute('transform', 'rotate(' + (-deg).toFixed(2) + ' 50 8)');
      if (icon) {
        var href = '/assets/phase-' + ph.id + '.png';
        icon.setAttribute('href', href);
        icon.setAttribute('xlink:href', href);
      }

      // arcs only dim when a phase has been explicitly selected
      var dimmed = !!state.selected;
      arcs.forEach(function (arc, i) {
        var p = PHASES[i];
        if (!p) return;
        arc.setAttribute('stroke-opacity', dimmed ? (p.id === ph.id ? '1' : '0.3') : '1');
      });

      pills.forEach(function (btn) {
        var p = PHASES.filter(function (x) { return x.id === btn.getAttribute('data-phase'); })[0];
        if (!p) return;
        var on = p.id === ph.id;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.setAttribute('style', [
          'cursor:pointer', "font-family:'SF Pro Text',-apple-system,sans-serif", 'font-size:14px',
          'font-weight:600', 'padding:11px 18px', 'min-height:44px', 'border-radius:100px',
          'transition:background .2s,color .2s,border-color .2s',
          on ? 'border:1px solid ' + p.ink : 'border:1px solid #EFDCD3',
          on ? 'background:' + p.ink : 'background:transparent',
          on ? 'color:#FDF9F6' : 'color:#5F5062'
        ].join(';'));
      });

      if (hint) {
        hint.setAttribute('style',
          'display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:7px 14px;' +
          'border-radius:100px;font-size:12.5px;color:#5F5062;background:rgba(255,255,255,0.82);' +
          'border:1px solid #EFDCD3;' +
          (state.touched ? 'opacity:0.55;transition:opacity .4s ease'
                         : 'animation:ff-hint-pulse 2.6s ease-in-out infinite'));
      }
    }

    function setText(name, value) {
      var el = ff(name);
      if (el) el.textContent = value;
    }

    function startAuto() {
      if (timer || reduceMotion()) return;
      timer = setInterval(function () {
        state.day = state.day >= CYCLE ? 1 : state.day + 1;
        state.selected = '';
        paint();
      }, STEP_MS);
    }
    function stopAuto() { clearInterval(timer); timer = null; }
    function takeOver() {
      stopAuto();
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startAuto, RESUME_AFTER);
    }

    // drag anywhere on the dial to scrub the cycle
    function dayFromEvent(e) {
      var r = drag.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      var a = Math.atan2(dx, -dy) * 180 / Math.PI;
      if (a < 0) a += 360;
      return Math.min(CYCLE, Math.floor(a / 360 * CYCLE) + 1);
    }
    if (drag) {
      var dragging = false;
      drag.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { drag.setPointerCapture(e.pointerId); } catch (err) {}
        takeOver();
        state.day = dayFromEvent(e);
        state.selected = '';
        state.touched = true;
        paint();
      });
      drag.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        state.day = dayFromEvent(e);
        state.selected = '';
        paint();
      });
      var end = function (e) {
        dragging = false;
        try { drag.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      drag.addEventListener('pointerup', end);
      drag.addEventListener('pointercancel', end);
    }

    pills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-phase');
        var p = PHASES.filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        takeOver();
        state.day = p.start;
        state.selected = '';
        state.touched = true;
        paint();
      });
    });

    // only animate while the dial is actually on screen
    if ('IntersectionObserver' in window && svg) {
      new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) startAuto(); else stopAuto();
      }, { threshold: 0.35 }).observe(svg);
    } else {
      startAuto();
    }
    paint();
  }

  /* =========================================================== landing: FAQ */

  function initFaq() {
    var btns = ffAll('faqBtn');
    if (!btns.length) return;
    var open = 0;

    function paint() {
      btns.forEach(function (btn, i) {
        var isOpen = open === i;
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        // the "+" is the button's last *direct* child — a descendant query
        // would match the span wrapping the question text instead
        var icon = btn.children[btn.children.length - 1];
        if (icon) {
          icon.setAttribute('style', [
            'flex:0 0 auto', 'width:26px', 'height:26px', 'border-radius:50%',
            'display:flex', 'align-items:center', 'justify-content:center',
            'font-family:Outfit,sans-serif', 'font-weight:600', 'font-size:17px', 'line-height:1',
            'transition:transform .28s cubic-bezier(.2,.7,.2,1),background .2s,color .2s',
            isOpen ? 'background:#8D4F83' : 'background:#F8EDF5',
            isOpen ? 'color:#FDF9F6' : 'color:#8D4F83',
            isOpen ? 'transform:rotate(45deg)' : 'transform:rotate(0deg)'
          ].join(';'));
        }

        // the answer opens by max-height, not display, so it can animate
        var panel = btn.nextElementSibling;
        if (panel) {
          panel.setAttribute('style', [
            'overflow:hidden',
            'transition:max-height .34s cubic-bezier(.2,.7,.2,1),opacity .28s ease',
            isOpen ? 'max-height:340px' : 'max-height:0px',
            isOpen ? 'opacity:1' : 'opacity:0'
          ].join(';'));
        }
      });
    }

    btns.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        open = open === i ? -1 : i;
        paint();
      });
    });
    paint();
  }

  /* =================================================== landing: sticky bar  */

  function initStickyBar() {
    var bar = ff('stickyBar');
    if (!bar) return;
    var queued = false;

    // Dropping the nav and shortening the CTA on phones is handled in CSS, not
    // here: one prerendered document serves every width, so deciding it in JS
    // would redraw the header after first paint and shove the page up.
    function read() {
      var narrow = window.innerWidth < 760;
      var past = window.scrollY > Math.max(320, window.innerHeight * 0.75);
      var want = narrow && past;
      bar.style.display = want ? '' : 'none';
      // keep the footer clear of the bar
      document.body.style.paddingBottom = want ? '78px' : '';
    }
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; read(); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    read();
  }

  /* ==================================================== landing: hero tilt  */

  function initTilt() {
    var el = ff('heroTilt');
    if (!el || reduceMotion()) return;
    var inner = el.querySelector('[data-hero-device]') || el.firstElementChild;
    if (!inner) return;
    inner.style.transition = 'transform .5s cubic-bezier(.2,.7,.2,1)';
    inner.style.transformStyle = 'preserve-3d';
    var frame = null;
    window.addEventListener('pointermove', function (e) {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        var r = el.getBoundingClientRect();
        var x = (e.clientX - (r.left + r.width / 2)) / r.width;
        var y = (e.clientY - (r.top + r.height / 2)) / r.height;
        inner.style.transition = 'transform .12s linear';
        inner.style.transform = 'rotateY(' + (x * 11).toFixed(2) + 'deg) rotateX(' +
          (-y * 8).toFixed(2) + 'deg) translateZ(22px)';
      });
    }, { passive: true });
    el.addEventListener('pointerleave', function () {
      inner.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1)';
      inner.style.transform = 'rotateY(0deg) rotateX(0deg) translateZ(0)';
    });
  }

  /* =================================================== landing: hero shader */

  var FRAG = [
    'precision highp float;',
    'uniform vec2 u_res; uniform float u_t;',
    'float silk(vec2 p, float t){',
    '  float a = sin(p.x * 1.7 + sin(p.y * 1.15 + t * 0.22) * 1.9 + t * 0.17);',
    '  float b = sin(p.y * 2.1 + sin(p.x * 1.45 - t * 0.15) * 1.7 - t * 0.12);',
    '  float c = sin((p.x + p.y) * 1.25 + sin((p.x - p.y) * 0.95 + t * 0.09) * 1.5);',
    '  return (a + b + c) / 3.0 * 0.5 + 0.5;',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec2 q = vec2(uv.x * (u_res.x / u_res.y), uv.y) * 2.6;',
    '  float warp = silk(q * 0.55, u_t * 0.7);',
    '  float n = silk(q + warp * 1.4, u_t);',
    '  vec3 cream = vec3(0.992, 0.976, 0.965);',
    '  vec3 blush = vec3(0.996, 0.941, 0.910);',
    '  vec3 rose  = vec3(0.996, 0.867, 0.816);',
    '  vec3 lilac = vec3(0.925, 0.659, 0.698);',
    '  float m = smoothstep(0.18, 0.88, n);',
    '  vec3 col = mix(cream, blush, smoothstep(0.0, 0.6, m));',
    '  col = mix(col, rose, smoothstep(0.4, 0.95, m) * 0.5);',
    '  col = mix(col, lilac, smoothstep(0.55, 1.05, m * 0.7 + uv.x * 0.45) * 0.42);',
    '  float band = 0.5 + 0.5 * sin((m * 5.2) + warp * 3.0 + u_t * 0.08);',
    '  col = mix(col, lilac, band * 0.08);',
    '  float glow = smoothstep(0.7, 0.05, distance(uv, vec2(0.9, 0.9)));',
    '  col = mix(col, vec3(0.925, 0.659, 0.698), glow * 0.35);',
    '  col = mix(col, cream, smoothstep(0.55, 0.05, uv.x) * 0.55);',
    '  col = mix(col, cream, smoothstep(0.4, 0.0, uv.y) * 0.55);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var FALLBACK_BG = 'linear-gradient(160deg,#FDF9F6,#FEF0E8 55%,#FFDDD0)';

  function initShader() {
    var cv = ff('shader');
    if (!cv) return;
    var gl = cv.getContext('webgl', {
      antialias: false, alpha: true, premultipliedAlpha: false,
      preserveDrawingBuffer: true, powerPreference: 'low-power'
    });
    if (!gl) { cv.style.background = FALLBACK_BG; return; }

    var mk = function (type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    var prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.style.background = FALLBACK_BG; return; }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uRes = gl.getUniformLocation(prog, 'u_res');
    var uT = gl.getUniformLocation(prog, 'u_t');

    var SCALE = 0.42;
    var size = function () {
      var w = Math.max(1, Math.round(cv.clientWidth * SCALE));
      var h = Math.max(1, Math.round(cv.clientHeight * SCALE));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
    };
    var draw = function (t) { size(); gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLES, 0, 3); };

    draw(12);                        // guarantee a painted frame up front
    if (reduceMotion()) return;      // ...and stop there if motion is unwanted

    var visible = true, last = 0, raf = null;
    var loop = function (now) {
      raf = null;
      if (!visible) return;
      if (now - last > 33) { last = now; draw(now / 1000); }
      raf = requestAnimationFrame(loop);
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(loop);
      }, { threshold: 0 }).observe(cv);
    }
    raf = requestAnimationFrame(loop);
  }

  /* ========================================================== the check-in  */

  function initCheckin() {
    var panel = ff('panel');
    if (!panel) return;

    var blocks = ffAll('questionBlock');
    var building = ff('buildingBlock');
    var result = ff('resultBlock');
    var counter = ff('stepCount');
    var progress = ff('progress');
    var closeBtn = ff('close');

    var state = { step: 0, answers: {}, building: false };
    var buildTimer = null;

    /* ---- option / continue styling, matching the component exactly ------ */
    function optionStyle(on) {
      return [
        'display:flex', 'align-items:center', 'gap:14px', 'width:100%', 'cursor:pointer',
        "font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif",
        'padding:20px 24px', 'border-radius:16px', 'text-align:left', 'outline:none',
        'transition:background .18s,border-color .18s,box-shadow .18s,transform .18s cubic-bezier(.2,.7,.2,1)',
        on ? 'background:rgba(141,79,131,0.08)' : 'background:#FFFFFF',
        on ? 'border:2px solid #8D4F83' : 'border:2px solid #F0E2DB',
        on ? 'box-shadow:0 10px 22px -14px rgba(141,79,131,0.45)' : 'box-shadow:0 1px 2px rgba(69,55,72,0.04)',
        'color:#453748'
      ].join(';');
    }
    function markStyle(on, multi) {
      return [
        'flex:0 0 auto', 'width:22px', 'height:22px', 'border-radius:' + (multi ? '6px' : '50%'),
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:12px', 'font-weight:700', 'line-height:1',
        'transition:background .18s,border-color .18s,color .18s',
        on ? 'background:#8D4F83' : 'background:#FFFFFF',
        on ? 'border:1.5px solid #8D4F83' : 'border:1.5px solid #DCC9D6',
        on ? 'color:#FDF9F6' : 'color:transparent'
      ].join(';');
    }
    var CONT = [
      'border:none', 'cursor:pointer', 'font-family:Outfit,sans-serif', 'font-weight:700',
      'font-size:16.5px', 'color:#FDF9F6', 'background:#8D4F83', 'padding:17px 30px',
      'border-radius:16px', 'box-shadow:0 14px 28px -12px rgba(141,79,131,0.55)',
      'transition:transform .18s cubic-bezier(.2,.7,.2,1),background .18s'
    ].join(';');

    /* ---- painting ------------------------------------------------------- */
    function currentQuestion() {
      return QUESTIONS[Math.min(state.step, QUESTIONS.length - 1)];
    }
    function answerFor(q) { return state.answers[q.id]; }
    function isChosen(q, v) {
      var a = answerFor(q);
      return q.multi ? (a || []).indexOf(v) > -1 : a === v;
    }
    function hasAnswer(q) {
      var a = answerFor(q);
      return q.multi ? (a || []).length > 0 : !!a;
    }

    function paint() {
      var done = state.step >= QUESTIONS.length;
      var isBuilding = done && state.building;
      var isResult = done && !state.building;
      var isQuestion = !done;

      blocks.forEach(function (b, i) { b.style.display = isQuestion && i === state.step ? '' : 'none'; });
      if (building) building.style.display = isBuilding ? '' : 'none';
      if (result) result.style.display = isResult ? '' : 'none';

      if (counter) counter.textContent = isBuilding ? '' : isResult ? 'Done' : 'Step ' + (state.step + 1) + ' of ' + TOTAL;
      if (progress) {
        var pct = done ? 100 : Math.round(((state.step + 0.6) / (TOTAL + 0.6)) * 100);
        progress.setAttribute('style',
          'height:100%;border-radius:100px;background:linear-gradient(90deg,#F0788E,#8D4F83);width:' +
          pct + '%;transition:width .45s cubic-bezier(.2,.7,.2,1)');
      }

      if (isQuestion) paintQuestion();
      if (isResult) paintResult();

      try { history.replaceState(null, '', '#check-in/' + (state.step + 1)); } catch (err) {}
      // the page scrolls with the window now, not inside the panel
      window.scrollTo(0, 0);
      var heading = isQuestion ? ff('qTitle', blocks[state.step])
                  : isBuilding ? ff('buildingHeading')
                  : ff('resultHeadline');
      if (heading && heading.focus) heading.focus({ preventScroll: true });
    }

    function paintQuestion() {
      var block = blocks[state.step];
      var q = currentQuestion();
      if (!block) return;

      ffAll('opt', block).forEach(function (btn) {
        var v = btn.getAttribute('data-v');
        var on = isChosen(q, v);
        btn.setAttribute('style', optionStyle(on));
        var mk = ff('optMark', btn);
        if (mk) {
          mk.setAttribute('style', markStyle(on, !!q.multi));
          mk.textContent = q.multi ? '✓' : '●';
        }
      });

      var cont = ff('continue', block);
      if (cont) {
        var ok = hasAnswer(q);
        cont.disabled = !ok;
        cont.setAttribute('aria-disabled', ok ? 'false' : 'true');
        cont.setAttribute('style', ok ? CONT : CONT + ';opacity:0.45;cursor:not-allowed;box-shadow:none');
      }
      var back = ff('back', block);
      if (back) back.style.display = state.step > 0 ? '' : 'none';
    }

    function paintResult() {
      if (!result) return;
      var vals = PLAN.resultVals(state.answers);

      var set = function (name, text) {
        var el = ff(name, result);
        if (el) el.textContent = text;
      };
      set('resultHeadline', vals.resultHeadline);
      set('resultBody', vals.resultBody);
      set('resultPhase', vals.resultPhase);
      set('resultPhaseNote', vals.resultPhaseNote);

      var badge = ff('resultBadge', result);
      if (badge) badge.src = vals.resultBadge.replace('./assets/', '/assets/');

      // "Adjusted for" chips: one prerendered chip is cloned to size
      var wrap = ff('adjustWrap', result);
      if (wrap) {
        wrap.style.display = vals.hasAdjust ? '' : 'none';
        var existing = ffAll('chip', wrap);
        var template = existing[0];
        if (template) {
          existing.slice(1).forEach(function (c) { c.remove(); });
          vals.adjustChips.forEach(function (chip, i) {
            var node = i === 0 ? template : template.cloneNode(true);
            node.textContent = chip.label;
            node.setAttribute('style', chip.style);
            if (i > 0) wrap.appendChild(node);
          });
          template.style.display = vals.adjustChips.length ? '' : 'none';
        }
      }

      // the four plan rows, each with its optional "Adjusted for ..." tag
      ffAll('row', result).forEach(function (row) {
        var label = row.getAttribute('data-row');
        var v = vals.resultRows.filter(function (r) { return r.label === label; })[0];
        if (!v) return;
        var value = ff('rowValue', row);
        if (value) value.textContent = v.value;
        var tag = ff('rowTag', row);
        if (tag) { tag.textContent = v.tag; tag.setAttribute('style', v.tagStyle); }
        var note = ff('rowNote', row);
        if (note) { note.textContent = v.note; note.setAttribute('style', v.noteStyle); }
      });
    }

    /* ---- navigation ----------------------------------------------------- */
    function goStep(step) {
      var s = Math.max(0, Math.min(TOTAL, step));
      var entering = s >= QUESTIONS.length && state.step < QUESTIONS.length;
      state.step = s;
      state.building = entering;
      clearTimeout(buildTimer);
      paint();
      if (entering) {
        buildTimer = setTimeout(function () {
          state.building = false;
          paint();
        }, reduceMotion() ? 250 : 2100);
      }
    }

    blocks.forEach(function (block, i) {
      ffAll('opt', block).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var q = QUESTIONS[i];
          var v = btn.getAttribute('data-v');
          if (q.multi) {
            var cur = (state.answers[q.id] || []).slice();
            var at = cur.indexOf(v);
            if (at > -1) cur.splice(at, 1); else cur.push(v);
            state.answers[q.id] = cur;
          } else {
            state.answers[q.id] = v;
          }
          paintQuestion();
        });
      });
      var cont = ff('continue', block);
      if (cont) cont.addEventListener('click', function () { goStep(state.step + 1); });
      var skip = ff('skip', block);
      if (skip) skip.addEventListener('click', function () { goStep(state.step + 1); });
      var back = ff('back', block);
      if (back) back.addEventListener('click', function () { goStep(state.step - 1); });
    });

    var restart = ff('restart');
    if (restart) restart.addEventListener('click', function () {
      state.answers = {};
      state.building = false;
      goStep(0);
    });

    // the check-in is its own route now, so closing means going back to the site
    if (closeBtn) {
      var home = document.createElement('a');
      home.href = '/';
      home.setAttribute('aria-label', closeBtn.getAttribute('aria-label') || 'Close the check-in');
      home.setAttribute('style', closeBtn.getAttribute('style') +
        ';display:flex;align-items:center;justify-content:center;text-decoration:none');
      home.className = closeBtn.className;
      home.textContent = closeBtn.textContent;
      closeBtn.replaceWith(home);
    }

    paint();
  }

  /* ================================================================= boot  */

  function boot() {
    try { initShader(); } catch (e) {}
    try { initTilt(); } catch (e) {}
    try { initWheel(); } catch (e) {}
    try { initFaq(); } catch (e) {}
    try { initStickyBar(); } catch (e) {}
    try { initCheckin(); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
