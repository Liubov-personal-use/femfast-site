/**
 * Pure check-in logic: the questions, and the plan a given set of answers
 * produces. No DOM, no framework, no `this`.
 *
 * This file is the single implementation. The build inlines it into the
 * component script it prerenders with, and also into /assets/app.js which
 * runs in the browser — so the static render and the live check-in are the
 * same code, not two transcriptions of it.
 *
 * The 12:12 fasting floor is enforced in shortenFast() below and is covered
 * by testFastingFloor(), which the build runs over every
 * phase x goal x fasting x training x diet combination.
 */
function createPlan(DATA) {
  const CYCLE = DATA.phases.cycleLength;
  const PHASES = DATA.phases.phases;
  const OV = DATA.phases.planOverrides;
  const phaseFor = d => PHASES.find(p => d >= p.start && d <= p.end) || PHASES[0];
  const PHASE_BY_DAY = PHASES.reduce((m, p) => (m[String(p.start)] = p.id, m), {});

const CYCLE_COPY = {
  regular: "a regular cycle",
  variable: "a cycle that shifts a few days",
  unpredictable: "an unpredictable cycle",
  untracked: "a cycle you haven't tracked yet"
};

const QUESTIONS = [
  { id: "goal", title: "What would you most like to change?", help: "",
    options: [
      { v: "weight", label: "Lose weight that won't shift", note: "Doing everything right" },
      { v: "energy", label: "Have steadier energy", note: "Fewer crashes, fewer flat weeks" },
      { v: "cravings", label: "Stop fighting cravings", note: "Especially the week before your period" },
      { v: "strength", label: "Get stronger without burning out", note: "Hard when it counts, rest when it doesn't" }
    ] },
  { id: "cycle", title: "How does your cycle usually run?", help: "Pick the closest.",
    options: [
      { v: "regular", label: "Like clockwork", note: "Same length every month" },
      { v: "variable", label: "It varies by a few days", note: "Predictable enough, not exact" },
      { v: "unpredictable", label: "Quite unpredictable", note: "The length changes a lot month to month" },
      { v: "untracked", label: "I don't track it yet", note: "We'll start you somewhere sensible" }
    ] },
  { id: "day", title: "Where are you in your cycle today?", help: "Not sure is fine.",
    options: [
      { v: "1", label: "Day 1\u20135", note: "Period" },
      { v: "6", label: "Day 6\u201313", note: "After your period, before ovulation" },
      { v: "14", label: "Day 14\u201316", note: "Around mid-cycle" },
      { v: "17", label: "Day 17\u201328", note: "The week or two before your period" },
      { v: "unsure", label: "I'm not sure", note: "We'll work it out" }
    ] },
  { id: "fasting", title: "Have you fasted before?", help: "Either way is fine.",
    options: [
      { v: "never", label: "Never", note: "We'll start gently" },
      { v: "tried", label: "I've tried it", note: "It didn't quite stick" },
      { v: "sometimes", label: "On and off", note: "Some weeks are easier than others" },
      { v: "regular", label: "I fast regularly", note: "I want it timed better" }
    ] },
  { id: "training", title: "How often do you move right now?", help: "Honestly, not aspirationally.",
    options: [
      { v: "0", label: "Rarely", note: "We'll start with walking" },
      { v: "1", label: "Once or twice a week" },
      { v: "3", label: "Three or four times a week" },
      { v: "5", label: "Five or more", note: "Let's time it to your phases" }
    ] },
  { id: "diet", title: "Anything we should plan your food around?", help: "Any that apply, or skip.", multi: true, skippable: true,
    options: [
      { v: "veg", label: "Vegetarian or vegan" },
      { v: "gf", label: "Gluten-free" },
      { v: "df", label: "Dairy-free" },
      { v: "lowcarb", label: "Low carb" },
      { v: "none", label: "Nothing in particular" }
    ] }
];

  function resultVals(answers) {
    const a = answers || {};
    const cyc = a.cycle || "regular";
    const phaseId = PHASE_BY_DAY[a.day] || "follicular";
    const ph = PHASES.find(p => p.id === phaseId) || PHASES[1];
    const unsure = a.day === "unsure";
    const goal = a.goal || "weight";
    const diet = a.diet || [];
    const highPhase = phaseId === "follicular" || phaseId === "ovulatory";
    const phaseName = ph.name.toLowerCase();

    // base plan comes straight from the shared phase object
    const base = { Fasting: ph.fast, Food: ph.food, Training: ph.train, Supplements: ph.supp };
    const val = Object.assign({}, base);
    const tags = { Fasting: [], Food: [], Training: [], Supplements: [] };
    const chips = [];
    // a chip records an answered preference; a row tag records a value that actually moved
    const chip = label => { if (chips.indexOf(label) < 0) chips.push(label); };
    const addTag = (row, label, changed) => { chip(label); if (changed !== false) tags[row].push(label); };
    // no fasting window may fall below 12:12, in any phase, through any override
    const FLOOR = OV.fastingFloorHours;
    const shortenFast = (label) => {
      const h0 = ph.fastHours || 14;
      if (h0 <= FLOOR) return { value: FLOOR + ":" + (24 - FLOOR) + " \u2014 already your gentlest window", floored: true };
      const h = Math.max(FLOOR, h0 - 2);
      return { value: h + ":" + (24 - h) + " \u2014 " + label, floored: false };
    };
    let energyFloored = false;

    if (goal === "weight") {
      val.Food = OV.foodForWeightGoal;
      addTag("Food", "your goal");
    } else if (goal === "energy") {
      const f = shortenFast("shortened so you don't hit a wall");
      val.Fasting = f.value;
      energyFloored = f.floored;
      addTag("Fasting", "energy");
    } else if (goal === "cravings") {
      const had = new RegExp(OV.supplementForCravings, "i").test(ph.supp);
      if (!had) val.Supplements = ph.supp + ", " + OV.supplementForCravings;
      addTag("Supplements", "cravings", !had);
    } else if (goal === "strength") {
      val.Training = ph.train + (highPhase ? OV.trainingSuffixBuildWeek : OV.trainingSuffixRecoveryWeek);
      addTag("Training", "strength");
    }

    // retained questions override the goal on the same row, and take its tag with them
    const retag = (row, label) => { tags[row] = [label]; chip(label); };
    if (a.fasting === "never") {
      val.Fasting = shortenFast("a gentle start").value;
      retag("Fasting", "first fast");
    }
    if (a.training === "0") {
      val.Training = OV.trainingForNoRoutine;
      retag("Training", "your routine");
    }

    let foodNote = "";
    if (diet.indexOf("veg") > -1) { val.Food = val.Food + OV.foodSuffixVegetarian; addTag("Food", "vegetarian"); }
    if (diet.indexOf("gf") > -1) { val.Food = val.Food + OV.foodSuffixGlutenFree; addTag("Food", "gluten-free"); }
    if (diet.indexOf("df") > -1) { const had = new RegExp(OV.supplementForDairyFree, "i").test(val.Supplements); if (!had) val.Supplements = val.Supplements + ", " + OV.supplementForDairyFree; addTag("Supplements", "dairy-free", !had); }
    if (diet.indexOf("lowcarb") > -1) {
      foodNote = OV.lowCarbNote;
      chip("low carb");
    }

    const intro = {
      weight: "You're in your " + phaseName + " phase, and you told us the scale won't move even when you do everything right. " +
        (highPhase
          ? "This week your insulin sensitivity is highest, so the plan leans on it: your longest fast and your higher-carb days land now, while they count."
          : "This week your body is doing more work, so the plan protects it: a gentler fast and steadier carbs, with the longer window waiting for week two.") +
        " Next week the plan changes, because your body will.",
      energy: "You're in your " + phaseName + " phase, and you asked for steadier energy. " +
        (energyFloored
          ? "This week your window is already at its gentlest, so the change is in the food: carbs spread across the day, so there's no four o'clock wall."
          : "Your window is shorter than the phase default and carbs are spread across the day, so there's no four o'clock wall.") +
        " Next week the plan changes, because your body will.",
      cravings: "You're in your " + phaseName + " phase, and you told us cravings are the fight. This week they're quiet, so the plan builds a buffer: protein and fibre now, magnesium in your stack before the luteal week arrives. Next week the plan changes, because your body will.",
      strength: "You're in your " + phaseName + " phase, and you want to get stronger without burning out. " +
        (highPhase
          ? "This is a build week: strength and HIIT lead, and your fast is long because you can recover from it."
          : "This is a recovery week: walking, mobility and lighter lifts, with the heavy work waiting for week two.") +
        " In week four the plan pulls back before you have to."
    }[goal];

    const order = ["Fasting", "Food", "Training", "Supplements"];

    const tagStyle = "flex:0 0 auto;margin-left:auto;font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;line-height:1.3;color:#8D4F83;background:rgba(141,79,131,0.1);padding:4px 10px;border-radius:100px;white-space:nowrap";

    return {
      resultHeadline: unsure
        ? "Here's your first day \u2014 your baseline sharpens from here"
        : "Here's your first day, built for " + CYCLE_COPY[cyc],
      resultBody: intro,
      resultPhase: ph.name + " phase" + (unsure ? " (estimated)" : ""),
      resultPhaseNote: ph.body.split(".")[0] + ".",
      resultBadge: "./assets/phase-" + ph.id + ".png",
      hasAdjust: chips.length > 0,
      adjustChips: chips.map(c => ({
        label: c,
        style: "font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;line-height:1.3;color:#8D4F83;background:rgba(141,79,131,0.1);padding:5px 12px;border-radius:100px"
      })),
      resultRows: order.map(k => ({
        label: k,
        value: val[k],
        tag: tags[k].length ? "Adjusted for " + tags[k].join(", ") : "",
        tagStyle: tags[k].length ? tagStyle : "display:none",
        note: k === "Food" ? foodNote : "",
        noteStyle: (k === "Food" && foodNote)
          ? "flex:1 1 100%;margin:2px 0 0;font-size:14px;line-height:1.5;color:rgba(69,55,72,0.6)"
          : "display:none"
      }))
    };
  }

  // No phase x override combination may produce a fasting window under 12:12.
  function testFastingFloor() {
    const fails = [];
    const goals = ["weight", "energy", "cravings", "strength"];
    const fastings = ["never", "tried", "sometimes", "regular"];
    const trainings = ["0", "1", "3", "5"];
    const diets = [[], ["veg"], ["gf"], ["df"], ["lowcarb"], ["veg", "gf", "df", "lowcarb"]];
    for (const p of PHASES) for (const g of goals) for (const f of fastings) for (const t of trainings) for (const d of diets) {
      const answers = { goal: g, cycle: "regular", day: String(p.start), fasting: f, training: t, diet: d };
      const v = resultVals(answers).resultRows.find(r => r.label === "Fasting").value;
      const h = parseInt(v, 10);
      if (!(h >= 12)) fails.push(p.id + "/" + g + "/" + f + "/" + t + "/" + d.join("+") + " -> " + v);
    }
    return fails;
  }

  return { CYCLE, PHASES, OV, phaseFor, PHASE_BY_DAY, CYCLE_COPY, QUESTIONS, resultVals, testFastingFloor };
}

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

  var DATA = {"phases":{"_comment":"Single source of truth for every cycle-phase value on the site. The wheel, the timeline section, the hero phone mockup and the check-in result all read from this file. Do not hardcode any of these values in HTML or JS.","cycleLength":28,"phases":[{"id":"menstrual","name":"Menstrual","start":1,"end":5,"color":"#F0788E","ink":"#B8405A","ramp":["#F995A6","#F9BBC1"],"body":"Estrogen and progesterone bottom out. Recovery is the work this week.","fast":"12:12 — gentle","food":"Iron, warmth, steady carbs","train":"Walking, mobility, light lifts","supp":"Magnesium, iron, omega-3","fastHours":12,"carb":0.42,"protein":0.5,"load":0.4},{"id":"follicular","name":"Follicular","start":6,"end":13,"color":"#A8CC8A","ink":"#3B7F5E","ramp":["#D6ECCA","#E7EBBF"],"body":"Insulin sensitivity is on your side. Your longest fast, your hardest sessions.","fast":"16:8 — your longest window","food":"Higher carb, high fibre","train":"Strength and HIIT","supp":"B-complex, vitamin D, omega-3","fastHours":16,"carb":0.8,"protein":0.55,"load":1},{"id":"ovulatory","name":"Ovulatory","start":14,"end":16,"color":"#F4CE7A","ink":"#96610A","ramp":["#FEF1C2","#FDDDCE"],"body":"Peak output. Three days where a PR is actually likely.","fast":"14:10 — moderate","food":"Protein forward, anti-inflammatory","train":"Heavy strength, sprints","supp":"Omega-3, zinc, vitamin C","fastHours":14,"carb":0.58,"protein":0.82,"load":1},{"id":"luteal","name":"Luteal","start":17,"end":28,"color":"#BB86B2","ink":"#85589E","ramp":["#EBC5D3","#BB86B2"],"body":"Metabolism runs hotter, cravings turn physiological. Fasting pulls back.","fast":"12:12 — pulled back","food":"More carbs, more salt, magnesium","train":"Steady-state, moderate lifts","supp":"Magnesium glycinate, B6, calcium","fastHours":12,"carb":0.86,"protein":0.58,"load":0.65}],"heroMockup":{"_comment":"The phone screenshot in the hero shows one specific day. These two overlays are drawn on top of the PNG and must match the phase that day falls in.","day":8},"planOverrides":{"_comment":"Plan values the check-in substitutes when an answer overrides the phase default. Held here so no plan copy is hardcoded in JS. Changing these changes the check-in result; the 12:12 fasting floor is enforced in code and cannot be raised or lowered from this file.","foodForWeightGoal":"Higher carb, high fibre, protein at every meal","trainingForNoRoutine":"Walking and mobility to start","supplementForCravings":"magnesium","supplementForDairyFree":"calcium","foodSuffixVegetarian":" — lentils, tofu, eggs for protein","foodSuffixGlutenFree":" — oats, rice, quinoa","trainingSuffixBuildWeek":" — this is a build week","trainingSuffixRecoveryWeek":" — recovery week, don't push","lowCarbNote":"You said low carb. This is the week to bend it, and we'll tell you why in the app.","fastingFloorHours":12}},"rating":{"_comment":"manual — update when the App Store figures change.","average":4.8,"count":2100,"url":"https://apps.apple.com/pl/app/femfast-hormonal-weight-loss/id6744979369"}};
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
    var nav = ff('nav');
    if (!bar && !nav) return;
    var queued = false;
    var getApp = ff('getApp');
    var headerCta = ff('headerCta');

    function read() {
      var narrow = window.innerWidth < 760;

      // On phones the nav wraps onto a second row and eats a chunk of the
      // viewport, so it is dropped and the sticky bar carries the CTA instead.
      // The page is prerendered wide, so this has to be applied on load.
      if (nav) {
        nav.setAttribute('style',
          'display:' + (narrow ? 'none' : 'flex') +
          ';flex-wrap:wrap;gap:8px 22px;font-size:14.5px;font-weight:500;color:#5F5062');
      }
      if (getApp) {
        getApp.setAttribute('style',
          'font-family:Outfit,sans-serif;font-weight:600;font-size:14.5px;color:#5F5062;' +
          'transition:color .16s;display:' + (narrow ? 'none' : 'block'));
      }
      if (headerCta) headerCta.textContent = narrow ? 'Start' : 'Take the check-in';

      if (bar) {
        var past = window.scrollY > Math.max(320, window.innerHeight * 0.75);
        var want = narrow && past;
        bar.style.display = want ? '' : 'none';
        // keep the footer clear of the bar
        document.body.style.paddingBottom = want ? '78px' : '';
      }
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
      panel.scrollTop = 0;
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
