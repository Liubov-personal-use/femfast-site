const PLAN = createPlan(DATA);
const CYCLE = DATA.phases.cycleLength;
const PHASES = DATA.phases.phases;
const OV = DATA.phases.planOverrides;
const phaseFor = d => PHASES.find(p => d >= p.start && d <= p.end) || PHASES[0];

const QUESTIONS = PLAN.QUESTIONS;


// Ratings and reviews are static content, edited in /data/rating.json and
// /data/reviews.json and rendered verbatim. Nothing fetches them at runtime.
//
// A verified entry (from the real pull) carries rating + title + createdDate and
// renders the star row, the title and the "App Store review" byline. The seeded
// entries below are the site's existing testimonials: they carry NONE of those
// fields, so nothing claims an App Store rating or date that was never fetched.
const RATING = DATA.rating;

// Entries live in /data/reviews.json, transcribed from the App Store product page
// (screenshots supplied by the team, 21 Sep 2026) and rendered verbatim — typos and
// punctuation untouched. Edit that file to change the section; no markup change needed.
const REVIEWS = DATA.reviews.reviews;


const FAQS = [
  { q: "My cycle is irregular. Can I still use it?",
    a: "Yes \u2014 that's the case we built hardest around. Tell us roughly where you are, or that you don't know. It sharpens over the first six weeks." },
    { q: "Why does the plan change every week?",
    a: "Because your body does. A plan that stays flat is wrong three weeks out of four." },
  { q: "Do I have to fast?",
    a: "No. Turn it off and FemFast still times your food, training and supplements. The timing is the point." },
  { q: "Is fasting right for everyone?",
    a: "No. Not if you're pregnant or breastfeeding, have any history of disordered eating, or take medication that needs food. FemFast asks first and won't suggest it. When in doubt, ask your clinician." },
  { q: "What do you do with my data?",
    a: "Nothing on this page is stored. In the app it builds your plan and nothing else \u2014 never sold, never shared. Delete it all in one tap." },
  { q: "How fast will I see results?",
    a: "Energy and cravings usually shift within one cycle. Weight follows over two or three." },
  ];


const PHASE_BY_DAY = PLAN.PHASE_BY_DAY;
const CYCLE_COPY = PLAN.CYCLE_COPY;


const FRAG = `precision highp float;
uniform vec2 u_res; uniform float u_t;
float silk(vec2 p, float t){
  float a = sin(p.x * 1.7 + sin(p.y * 1.15 + t * 0.22) * 1.9 + t * 0.17);
  float b = sin(p.y * 2.1 + sin(p.x * 1.45 - t * 0.15) * 1.7 - t * 0.12);
  float c = sin((p.x + p.y) * 1.25 + sin((p.x - p.y) * 0.95 + t * 0.09) * 1.5);
  return (a + b + c) / 3.0 * 0.5 + 0.5;
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 q = vec2(uv.x * (u_res.x / u_res.y), uv.y) * 2.6;
  float warp = silk(q * 0.55, u_t * 0.7);
  float n = silk(q + warp * 1.4, u_t);
  vec3 cream = vec3(0.992, 0.976, 0.965);
  vec3 blush = vec3(0.996, 0.941, 0.910);
  vec3 rose  = vec3(0.996, 0.867, 0.816);
  vec3 lilac = vec3(0.925, 0.659, 0.698);
  float m = smoothstep(0.18, 0.88, n);
  vec3 col = mix(cream, blush, smoothstep(0.0, 0.6, m));
  col = mix(col, rose, smoothstep(0.4, 0.95, m) * 0.5);
  col = mix(col, lilac, smoothstep(0.55, 1.05, m * 0.7 + uv.x * 0.45) * 0.42);
  float band = 0.5 + 0.5 * sin((m * 5.2) + warp * 3.0 + u_t * 0.08);
  col = mix(col, lilac, band * 0.08);
  float glow = smoothstep(0.7, 0.05, distance(uv, vec2(0.9, 0.9)));
  col = mix(col, vec3(0.925, 0.659, 0.698), glow * 0.35);
  col = mix(col, cream, smoothstep(0.55, 0.05, uv.x) * 0.55);
  col = mix(col, cream, smoothstep(0.4, 0.0, uv.y) * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;


class Component extends DCLogic {
  // INIT_STATE lets the build prerender a specific state (a given quiz step,
  // the sticky bar, the result screen) so the static markup for every state can
  // be captured from the real renderer instead of being hand-written.
  state = Object.assign({ plan: "quarterly", pickedPlan: false, hoverPlan: "", focusPlan: "", day: 6, dragging: false, quizOpen: false, step: 0, answers: {}, building: false, openFaq: 0, stickyBar: false, narrow: false }, INIT_STATE);

  toggleFaq = i => this.setState(s => ({ openFaq: s.openFaq === i ? -1 : i }));

  // real 11pm questions, not feature bullets — the timestamp is the argument
  ASKS = [
    { time: "07:15", q: "What should I eat today?" },
    { time: "13:20", q: "Work dinner Thursday — can I move my eating window?" },
    { time: "18:05", q: "How can I improve my mood?" },
    { time: "22:40", q: "I'm exhausted. Is this my phase, or is this me?" }
  ];
;

  planCards = {};
  PLAN_ORDER = ["quarterly", "annual", "monthly"];

  // ARIA radiogroup: arrows move and select, wrapping; roving tabindex keeps one tab stop
  onPlanKey(e, id) {
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const dir = keys[e.key];
    if (dir) {
      e.preventDefault();
      const order = this.PLAN_ORDER;
      const i = order.indexOf(id);
      const next = order[(i + dir + order.length) % order.length];
      this.setState({ plan: next, pickedPlan: true }, () => {
        const el = this.planCards[next];
        if (el && el.focus) el.focus();
      });
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      this.setState({ plan: id, pickedPlan: true });
    }
  }

  // Sticky bar: narrow viewports only, and only once the hero CTA has scrolled away —
  // showing it over the hero would just duplicate a button already on screen.
  initStickyBar() {
    const read = () => {
      const narrow = window.innerWidth < 760;
      const past = window.scrollY > Math.max(320, window.innerHeight * 0.75);
      const want = narrow && past;
      if (want !== this.state.stickyBar || narrow !== this.state.narrow) this.setState({ stickyBar: want, narrow: narrow });
      // keep the footer clear of the bar
      document.body.style.paddingBottom = want ? "78px" : "";
    };
    let queued = false;
    this.onStickyScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; read(); });
    };
    window.addEventListener("scroll", this.onStickyScroll, { passive: true });
    window.addEventListener("resize", this.onStickyScroll, { passive: true });
    read();
  }

  TOTAL = QUESTIONS.length;

  openQuiz = e => {
    if (e && e.preventDefault) e.preventDefault();
    this.stopAuto();
    this.lastFocus = document.activeElement;
    this.setState({ quizOpen: true, step: 0 }, () => { this.setLandingInert(true); this.focusStep(); });
    this.syncHash(0);
    document.documentElement.style.overflow = "hidden";
  };
  closeQuiz = e => {
    if (e && e.preventDefault) e.preventDefault();
    this.setState({ quizOpen: false });
    this.setLandingInert(false);
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
    document.documentElement.style.overflow = "";
    if (location.hash.indexOf("#check-in") === 0) history.replaceState(null, "", location.pathname + location.search);
  };
  restart = () => { this.setState({ step: 0, answers: {}, building: false }); this.syncHash(0); };
  syncHash(step) {
    try { history.replaceState(null, "", "#check-in/" + (step + 1)); } catch (err) {}
  }
  goStep(step) {
    const s = Math.max(0, Math.min(this.TOTAL, step));
    const entering = s >= QUESTIONS.length && this.state.step < QUESTIONS.length;
    this.setState({ step: s, building: entering }, () => {
      if (this.quizPanel) this.quizPanel.scrollTop = 0;
      this.focusStep();
    });
    this.syncHash(s);
    clearTimeout(this.buildTimer);
    if (entering) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.buildTimer = setTimeout(() => this.setState({ building: false }, () => this.focusStep()), still ? 250 : 2100);
    }
  }
  focusStep() {
    const h = this.stepHeading;
    if (h && typeof h.focus === "function") h.focus({ preventScroll: true });
  }
  setLandingInert(on) {
    const el = this.landing;
    if (!el) return;
    if (on) { el.setAttribute("inert", ""); el.setAttribute("aria-hidden", "true"); }
    else { el.removeAttribute("inert"); el.removeAttribute("aria-hidden"); }
  }

  next = () => this.goStep(this.state.step + 1);
  back = () => this.goStep(this.state.step - 1);

  pickAnswer(q, v) {
    const answers = Object.assign({}, this.state.answers);
    if (q.multi) {
      const cur = answers[q.id] ? answers[q.id].slice() : [];
      const i = cur.indexOf(v);
      if (i > -1) cur.splice(i, 1); else cur.push(v);
      answers[q.id] = cur;
      this.setState({ answers: answers });
    } else {
      answers[q.id] = v;
      this.setState({ answers: answers });
    }
  }

  onQuizKey = e => {
    if (!this.state.quizOpen) return;
    if (e.key === "Escape") this.closeQuiz();
  };


  shaderRef = el => { this.canvas = el; };
  heroTiltRef = el => { this.tilt = el; };

  planSectionRef = el => { this.planSection = el; };
  planStackRef = el => { this.planStack = el; };
  planTiltRef = el => { this.planTilt = el; };
  glowRefs = {};
  quizPanelRef = el => { this.quizPanel = el; };
  stepHeadingRef = el => { this.stepHeading = el; };
  landingRef = el => { this.landing = el; };
  wheelBadgeRef = el => { this.wheelBadge = el; this.syncBadges(); };
  resultBadgeRef = el => { this.resultBadgeEl = el; this.syncBadges(); };

  // bitmap paths are applied post-render: a {{ hole }} on src/href is fetched
  // literally during the stream pass and 404s before values exist.
  syncBadges() {
    const wheel = this.wheelBadge;
    if (wheel) {
      const want = "./assets/phase-" + phaseFor(this.state.day).id + ".png";
      if (wheel.getAttribute("href") !== want) wheel.setAttribute("href", want);
    }
    const res = this.resultBadgeEl;
    if (res && this.state.step >= QUESTIONS.length) {
      const want = this.resultVals().resultBadge;
      if (res.getAttribute("src") !== want) res.setAttribute("src", want);
    }
  }

  componentDidMount() {
    this.initShader();
    this.initTilt();
    this.initAutoCycle();
    this.bindPlanPointer(null);
    this.initStickyBar();
    window.addEventListener("keydown", this.onQuizKey);
    if (location.hash.indexOf("#check-in") === 0) this.openQuiz();
  }

  bindPlanPointer(m) {
    const sec = this.planSection;
    if (!sec) return;
    const tilt = this.planTilt;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = null, pt = null;
    const apply = () => {
      frame = null;
      if (!pt) return;
      const r = sec.getBoundingClientRect();
      const nx = (pt.clientX - r.left) / r.width;
      const ny = 1 - (pt.clientY - r.top) / r.height;
      if (m) { m.x = Math.min(1.2, Math.max(-0.2, nx)); m.y = Math.min(1.2, Math.max(-0.2, ny)); }
      // the specular centre follows the cursor on the hovered card only; whether it
      // shows at all is decided by hover state in renderVals, so the two can't desync.
      const g = this.glowRefs[this.state.hoverPlan];
      if (g && g.parentElement) {
        const b = g.parentElement.getBoundingClientRect();
        const gx = ((pt.clientX - b.left) / b.width * 100).toFixed(1);
        const gy = ((pt.clientY - b.top) / b.height * 100).toFixed(1);
        g.style.backgroundImage = "radial-gradient(200px circle at " + gx + "% " + gy + "%, rgba(255,255,255,0.34), rgba(255,255,255,0.07) 45%, transparent 70%)";
      }
    };
    const move = e => { pt = e; this.planHover = true; if (!frame) frame = requestAnimationFrame(apply); };
    const leave = () => {
      this.planHover = false;
      if (m) { m.x = 0.68; m.y = 0.72; }
      this.setState({ hoverPlan: "" });
    };
    sec.addEventListener("pointermove", move, { passive: true });
    sec.addEventListener("pointerleave", leave);
    this.offPlan = () => {
      sec.removeEventListener("pointermove", move);
      sec.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }
  componentDidUpdate() { this.syncBadges(); }

  componentWillUnmount() {
    cancelAnimationFrame(this.raf);
    if (this.io) this.io.disconnect();
    if (this.offTilt) this.offTilt();
    clearInterval(this.cycleTimer);
    clearTimeout(this.resumeTimer);
    if (this.wheelIO) this.wheelIO.disconnect();
    if (this.offPlan) this.offPlan();
    window.removeEventListener("keydown", this.onQuizKey);
    window.removeEventListener("scroll", this.onStickyScroll);
    window.removeEventListener("resize", this.onStickyScroll);
    clearTimeout(this.advanceTimer);
    clearTimeout(this.buildTimer);
    document.documentElement.style.overflow = "";
  }

  quizVals() {
    const st = this.state;
    const step = st.step;
    const done = step >= QUESTIONS.length;
    const isBuilding = done && st.building;
    const isResult = done && !st.building;
    const isQuestion = !done;
    const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)];
    const ans = st.answers[q.id];
    // never start at zero — a visibly-begun bar reads as progress already made
    const pct = done ? 100 : Math.round(((step + 0.6) / (this.TOTAL + 0.6)) * 100);

    const btn = (on) => [
      "display:flex", "align-items:center", "gap:14px", "width:100%", "cursor:pointer",
      "font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif",
      "padding:20px 24px", "border-radius:16px", "text-align:left", "outline:none",
      "transition:background .18s,border-color .18s,box-shadow .18s,transform .18s cubic-bezier(.2,.7,.2,1)",
      on ? "background:rgba(141,79,131,0.08)" : "background:#FFFFFF",
      on ? "border:2px solid #8D4F83" : "border:2px solid #F0E2DB",
      on ? "box-shadow:0 10px 22px -14px rgba(141,79,131,0.45)" : "box-shadow:0 1px 2px rgba(69,55,72,0.04)",
      on ? "color:#453748" : "color:#453748"
    ].join(";");
    const mark = (on) => [
      "flex:0 0 auto", "width:22px", "height:22px", "border-radius:" + (q.multi ? "6px" : "50%"),
      "display:flex", "align-items:center", "justify-content:center",
      "font-size:12px", "font-weight:700", "line-height:1",
      "transition:background .18s,border-color .18s,color .18s",
      on ? "background:#8D4F83" : "background:#FFFFFF",
      on ? "border:1.5px solid #8D4F83" : "border:1.5px solid #DCC9D6",
      on ? "color:#FDF9F6" : "color:transparent"
    ].join(";");

    const chosen = v => q.multi ? (ans || []).indexOf(v) > -1 : ans === v;
    const hasAns = q.multi ? (ans || []).length > 0 : !!ans;
    const cont = [
      "border:none", "cursor:pointer", "font-family:Outfit,sans-serif", "font-weight:700",
      "font-size:16.5px", "color:#FDF9F6", "background:#8D4F83", "padding:17px 30px",
      "border-radius:16px", "box-shadow:0 14px 28px -12px rgba(141,79,131,0.55)",
      "transition:transform .18s cubic-bezier(.2,.7,.2,1),background .18s"
    ].join(";");

    const out = {
      quizOpen: st.quizOpen,
      isQuestion: isQuestion,
      isBuilding: isBuilding,
      isResult: isResult,
      openQuiz: this.openQuiz,
      closeQuiz: this.closeQuiz,
      restart: this.restart,
      next: this.next,
      back: this.back,
      quizPanelRef: this.quizPanelRef,
      stepHeadingRef: this.stepHeadingRef,
      landingRef: this.landingRef,
      asks: this.ASKS,
      showStickyBar: this.state.stickyBar && !this.state.quizOpen,
      // on phones the nav wraps to a second row and eats a quarter of the viewport;
      // the sticky bar carries the CTA there instead
      getAppStyle: "font-family:Outfit,sans-serif;font-weight:600;font-size:14.5px;color:#5F5062;transition:color .16s;display:" + (this.state.narrow ? "none" : "block"),
      headerCta: this.state.narrow ? "Start" : "Take the check-in",
      navStyle: "display:" + (this.state.narrow ? "none" : "flex") + ";flex-wrap:wrap;gap:8px 22px;font-size:14.5px;font-weight:500;color:#5F5062",
      faqs: FAQS.map((item, i) => {
        const open = this.state.openFaq === i;
        return {
          i: i,
          q: item.q,
          a: item.a,
          expanded: open ? "true" : "false",
          toggle: () => this.toggleFaq(i),
          iconStyle: [
            "flex:0 0 auto", "width:26px", "height:26px", "border-radius:50%",
            "display:flex", "align-items:center", "justify-content:center",
            "font-family:Outfit,sans-serif", "font-weight:600", "font-size:17px", "line-height:1",
            "transition:transform .28s cubic-bezier(.2,.7,.2,1),background .2s,color .2s",
            open ? "background:#8D4F83" : "background:#F8EDF5",
            open ? "color:#FDF9F6" : "color:#8D4F83",
            open ? "transform:rotate(45deg)" : "transform:rotate(0deg)"
          ].join(";"),
          bodyStyle: [
            "overflow:hidden",
            "transition:max-height .34s cubic-bezier(.2,.7,.2,1),opacity .28s ease",
            open ? "max-height:340px" : "max-height:0px",
            open ? "opacity:1" : "opacity:0"
          ].join(";")
        };
      }),
      ratingLine: RATING.average.toFixed(1) + " \u00b7 " + (Math.floor(RATING.count / 100) * 100).toLocaleString("en-US") + "+ ratings on the App Store",
      ratingStars: [1, 2, 3, 4, 5].map(i => ({
        style: "font-size:17px;line-height:1;color:" + (i <= Math.round(RATING.average) ? "#8D4F83" : "rgba(141,79,131,0.25)")
      })),
      reviewCards: REVIEWS.map(r => {
        const verified = !!(r.rating && r.createdDate);
        let meta = r.meta || r.reviewerNickname;
        if (verified) {
          const d = new Date(r.createdDate);
          const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
          meta = r.reviewerNickname + " \u00b7 " + month + " " + d.getFullYear() + " \u00b7 App Store review";
        }
        return {
          name: r.reviewerNickname,
          nameStyle: verified ? "display:none" : "font-family:Outfit,sans-serif;font-weight:700;font-size:18px;line-height:1.3;letter-spacing:-0.01em",
          title: r.title || "",
          titleStyle: verified && r.title ? "font-family:Outfit,sans-serif;font-weight:700;font-size:18px;line-height:1.3;letter-spacing:-0.01em" : "display:none",
          body: r.body.length > 400 ? r.body.slice(0, 400) + " [\u2026]" : r.body,
          meta: meta,
          href: RATING.url,
          ratingLabel: verified ? r.rating + " out of 5" : "",
          starsStyle: verified ? "display:inline-flex;gap:2px" : "display:none",
          stars: verified ? [1, 2, 3, 4, 5].map(i => ({
            style: "font-size:14px;line-height:1;letter-spacing:1px;color:" + (i <= r.rating ? "#8D4F83" : "rgba(141,79,131,0.25)")
          })) : []
        };
      }),
      wheelBadgeRef: this.wheelBadgeRef,
      resultBadgeRef: this.resultBadgeRef,
      stepKey: "s" + step,
      canGoBack: step > 0,
      stepCount: isBuilding ? "" : isResult ? "Done" : "Step " + (step + 1) + " of " + this.TOTAL,
      qHelpStyle: q.help
        ? "font-size:clamp(17px, 15.89px + 0.29vw, 20px);line-height:1.55;color:rgba(69,55,72,0.74);margin:0 0 24px;max-width:32em"
        : "display:none",
      continueStyle: hasAns ? cont : cont + ";opacity:0.45;cursor:not-allowed;box-shadow:none",
      continueDisabled: !hasAns,
      continueAria: hasAns ? "false" : "true",
      showContinue: isQuestion,
      showSkipLink: isQuestion && q.skippable === true,
      progressStyle: "height:100%;border-radius:100px;background:linear-gradient(90deg,#F0788E,#8D4F83);width:" + pct + "%;transition:width .45s cubic-bezier(.2,.7,.2,1)",

      qTitle: q.title,
      qHelp: q.help,
      buildSteps: ["Reading your cycle pattern", "Mapping your phase to today", "Writing your first day"].map((label, i) => ({
        label: label,
        dotStyle: [
          "flex:0 0 auto", "width:9px", "height:9px", "border-radius:50%",
          "background:#8D4F83",
          "animation:ff-pulse 1.5s ease-in-out " + (i * 0.45).toFixed(2) + "s infinite"
        ].join(";"),
        textStyle: "font-family:Outfit,sans-serif;font-weight:600;font-size:16px;color:#453748"
      })),
      qOptions: q.options.map(o => ({
        v: o.v,
        label: o.label,
        note: o.note || "",
        noteStyle: o.note ? "font-size:13.5px;color:#6E5D70" : "display:none",
        mark: q.multi ? "\u2713" : "\u25cf",
        markStyle: mark(chosen(o.v)),
        style: btn(chosen(o.v)),
        pick: () => this.pickAnswer(q, o.v)
      }))
    };

    if (isResult) Object.assign(out, this.resultVals());
    Object.assign(out, this.heroVals());
    return out;
  }

  // 12:12 floor coverage lives in plan.js and is run by the build.
  testFastingFloor() { return PLAN.testFastingFloor(); }

  // The plan itself lives in plan.js so the browser runs this exact code.
  resultVals() {
    return PLAN.resultVals(this.state.answers);
  }

  // Ambient auto-advance: one day at a time, ~31s for a full rotation — slow
  // enough that the day number is readable, quick enough that a phase change
  // arrives while you are still looking. Pauses the moment the user takes
  // over, resumes after they have been idle a while.
  STEP = 1100;
  RESUME_AFTER = 12000;

  initAutoCycle() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = this.wheel;
    if (!el) return;
    this.wheelIO = new IntersectionObserver(es => {
      if (es[0].isIntersecting) this.startAuto(); else this.stopAuto();
    }, { threshold: 0.35 });
    this.wheelIO.observe(el);
  }
  startAuto() {
    if (this.cycleTimer) return;
    this.cycleTimer = setInterval(() => {
      this.setState(s => ({ day: s.day >= CYCLE ? 1 : s.day + 1 }));
    }, this.STEP);
  }
  stopAuto() {
    clearInterval(this.cycleTimer);
    this.cycleTimer = null;
  }
  takeOver = () => {
    this.stopAuto();
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => this.startAuto(), this.RESUME_AFTER);
  };
  wheelRef = el => { this.wheel = el; };

  initShader() {
    const cv = this.canvas;
    if (!cv) return;
    const gl = cv.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) { cv.style.background = "linear-gradient(160deg,#FDF9F6,#FEF0E8 55%,#FFDDD0)"; return; }
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.style.background = "linear-gradient(160deg,#FDF9F6,#FEF0E8 55%,#FFDDD0)"; return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uT = gl.getUniformLocation(prog, "u_t");

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SCALE = 0.42;
    const size = () => {
      const w = Math.max(1, Math.round(cv.clientWidth * SCALE));
      const h = Math.max(1, Math.round(cv.clientHeight * SCALE));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uRes, cv.width, cv.height);
    };
    const draw = t => { size(); gl.uniform1f(uT, t); gl.drawArrays(gl.TRIANGLES, 0, 3); };

    draw(12);                       // guarantee a painted frame up front
    if (still) return;
    let visible = true, last = 0;
    this.io = new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible && !this.raf) this.raf = requestAnimationFrame(loop);
    }, { threshold: 0 });
    this.io.observe(cv);
    const loop = now => {
      this.raf = null;
      if (!visible) return;
      if (now - last > 33) { last = now; draw(now / 1000); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  initTilt() {
    const el = this.tilt;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const inner = el.querySelector("[data-hero-device]") || el.firstElementChild;
    if (!inner) return;
    inner.style.transition = "transform .5s cubic-bezier(.2,.7,.2,1)";
    inner.style.transformStyle = "preserve-3d";
    let frame = null;
    const move = e => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) / r.width;
        const y = (e.clientY - (r.top + r.height / 2)) / r.height;
        inner.style.transition = "transform .12s linear";
        inner.style.transform = "rotateY(" + (x * 11).toFixed(2) + "deg) rotateX(" + (-y * 8).toFixed(2) + "deg) translateZ(22px)";
      });
    };
    const leave = () => {
      inner.style.transition = "transform .6s cubic-bezier(.2,.7,.2,1)";
      inner.style.transform = "rotateY(0deg) rotateX(0deg) translateZ(0)";
    };
    window.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    this.offTilt = () => { window.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); if (frame) cancelAnimationFrame(frame); };
  }

  dayFromEvent(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (a < 0) a += 360;
    return Math.min(CYCLE, Math.floor(a / 360 * CYCLE) + 1);
  }
  onWheelDown = e => {
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    this.takeOver();
    if (!this.state.wheelTouched) this.setState({ wheelTouched: true });
    this.setState({ dragging: true, day: this.dayFromEvent(e) });
  };
  onWheelMove = e => { if (this.state.dragging) this.setState({ day: this.dayFromEvent(e) }); };
  onWheelUp = () => this.setState({ dragging: false });

  // The hero phone mockup paints two values over the dashboard screenshot.
  // Both follow the phase that heroMockup.day falls in, so they can never drift
  // from the wheel, the timeline or the check-in result.
  heroVals() {
    const d = DATA.phases.heroMockup.day;
    const ph = phaseFor(d);
    return {
      heroDay: String(d),
      heroSupp: ph.supp,
      heroRatingAvg: RATING.average.toFixed(1),
      heroRatingCount: (Math.floor(RATING.count / 100) * 100).toLocaleString("en-US")
    };
  }

  renderVals() {
    const rows = [
      { id: "quarterly", name: "3 months", note: "Try a full reset", price: "$17.99", perMonth: "$6.00 / month", badge: "Most popular", badgeKind: "popular" },
      { id: "annual", name: "12 months", note: "Support every phase, all year", price: "$47.99", perMonth: "$4.00 / month", badge: "Biggest saving", badgeKind: "saving" },
      { id: "monthly", name: "1 month", note: "Explore FemFast", price: "$9.99", perMonth: "$9.99 / month", badge: "", badgeKind: "" }
    ];
    const sel = this.state.pickedPlan ? this.state.plan : (this.props.defaultPlan ?? this.state.plan);
    const day = this.state.day;
    const ph = phaseFor(day);
    const op = id => (ph.id === id ? 1 : 0.78);
    return Object.assign(this.quizVals(), {
      day,
      phaseName: ph.name,
      phaseUpper: ph.name.toUpperCase(),
      phaseRange: "DAY " + ph.start + "\u2013" + ph.end + " OF " + CYCLE,
      phaseBody: ph.body,
      phaseFast: ph.fast,
      phaseFood: ph.food,
      phaseTrain: ph.train,
      phaseSupp: ph.supp,
      o1: op("menstrual"), o2: op("follicular"), o3: op("ovulatory"), o4: op("luteal"),
      markerColor: ph.color,
      dotDash: "0.9 18.847 ".repeat(ph.end - ph.start + 1) + "0 " + ((CYCLE - (ph.end - ph.start + 1)) * 19.747).toFixed(2),
      dotOffset: -((ph.start - 1) * 19.747 + 9.4).toFixed(2),
      markerTransform: "rotate(" + ((day - 0.5) / CYCLE * 360) + " 140 140)",
      shaderRef: this.shaderRef,
      wheelRef: this.wheelRef,
      heroTiltRef: this.heroTiltRef,
      onWheelDown: this.onWheelDown,
      onWheelMove: this.onWheelMove,
      onWheelUp: this.onWheelUp,
      // the wheel's ring, cut at day 1 and laid flat: same four spans, same
      // day proportions, same two-stop ramps. Every row of the table gets it,
      // so the table and the dial are visibly one object.
      ringSegs: PHASES.map(p => ({
        style: "flex:" + (p.end - p.start + 1) + " 1 0;border-radius:7px;background:linear-gradient(90deg," +
          p.ramp[0] + "," + p.ramp[1] + ")"
      })),
      // the hint pulses until the dial is first touched, then retires for good
      dragHintStyle: "display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:7px 14px;border-radius:100px;font-size:12.5px;color:#5F5062;background:rgba(255,255,255,0.82);border:1px solid #EFDCD3;"
        + (this.state.wheelTouched
            ? "opacity:0.55;transition:opacity .4s ease"
            : "animation:ff-hint-pulse 2.6s ease-in-out infinite"),
      legend: PHASES.map(p => {
        const on = p.id === ph.id;
        return {
          id: p.id,
          label: p.name,
          select: () => { this.takeOver(); this.setState({ day: p.start, wheelTouched: true }); },
          pressed: on ? "true" : "false",
          style: [
            "cursor:pointer", "font-family:'SF Pro Text',-apple-system,sans-serif", "font-size:14px",
            "font-weight:600", "padding:11px 18px", "min-height:44px", "border-radius:100px",
            "transition:background .2s,color .2s,border-color .2s",
            // secondary to the dial: hairline by default, phase fill only when active
            on ? "border:1px solid " + p.ink : "border:1px solid #EFDCD3",
            on ? "background:" + p.ink : "background:transparent",
            on ? "color:#FDF9F6" : "color:#5F5062"
          ].join(";")
        };
      }),
      selectedLine: (function () {
        const r = rows.find(x => x.id === sel) || rows[0];
        return "You picked " + r.name + " \u2014 " + r.price + ", refundable for 5 days";
      })(),
      planSectionRef: this.planSectionRef,
      planStackRef: this.planStackRef,
      planTiltRef: this.planTiltRef,
      // every number below is derived from PHASES — the same object the dial,
      // the hero phone and the quiz result read. Nothing is hardcoded in markup.
      phaseAxis: PHASES.map(p => {
        // a span under ~5 days cannot hold its own label, so it rides one line higher
        return {
          name: p.name,
          range: "Day " + p.start + "\u2013" + p.end,
          cellStyle: "min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;",
          nameStyle: "font-family:Outfit,sans-serif;font-weight:700;font-size:14px;line-height:1.3;white-space:nowrap;padding:0 6px;color:" + p.ink,
          rangeStyle: "font-size:12px;line-height:1.3;color:#5F5062;white-space:nowrap"
        };
      }),
      stripRows: (function () {
        const X = p => ((p.start - 1) / CYCLE) * 280;
        const W = p => ((p.end - p.start + 1) / CYCLE) * 280;
        const MID = p => X(p) + W(p) / 2;
        const maxFast = Math.max.apply(null, PHASES.map(p => p.fastHours));
        const H = 48;

        // fasting: stepped bars, height ∝ fasting hours
        const fastBars = PHASES.map(p => {
          const h = (p.fastHours / maxFast) * (H - 8);
          return { x: X(p) + 1, w: W(p) - 2, y: H - h, h: h, fill: p.color };
        });
        // training: two-level step, build weeks high
        const trainBars = PHASES.map(p => {
          const h = p.load * (H - 8);
          return { x: X(p) + 1, w: W(p) - 2, y: H - h, h: h, fill: p.color };
        });
        // food: a carb curve over a protein band, both from the same numbers
        const yOf = v => H - 6 - v * (H - 16);
        const carbPts = PHASES.map(p => [MID(p), yOf(p.carb)]);
        let line = "M 0 " + yOf(PHASES[0].carb).toFixed(1);
        carbPts.forEach((pt, i) => {
          const prev = i ? carbPts[i - 1] : [0, yOf(PHASES[0].carb)];
          const cx = (prev[0] + pt[0]) / 2;
          line += " C " + cx.toFixed(1) + " " + prev[1].toFixed(1) + ", " + cx.toFixed(1) + " " + pt[1].toFixed(1) + ", " + pt[0].toFixed(1) + " " + pt[1].toFixed(1);
        });
        const lastC = carbPts[carbPts.length - 1];
        line += " L 280 " + lastC[1].toFixed(1);

        const defs = [
          { key: "fast",  label: "Fasting",     bars: fastBars,  line: "", band: "",
            why: "Your longest window lands where insulin sensitivity is highest. It shortens before cravings peak." },
          { key: "food",  label: "Food",        bars: [],        line: line, band: "",
            series: [
              { text: "Carbs", top: (yOf(PHASES[PHASES.length - 1].carb) / H) * 100 }
            ],
            why: "Targets move with your phase. Nothing is banned." },
          { key: "train", label: "Training",    bars: trainBars, line: "", band: "",
            why: "Build weeks two and three. Weeks one and four are for recovery." },
          { key: "supp",  label: "Supplements", bars: [],        line: "", band: "",
            note: "Omega-3 daily, all month.",
            why: "What to take and when, each with its source in the app." }
        ];
        return defs.map(r => ({
          label: r.label,
          why: r.why,
          hasOverlay: r.key !== "supp",
          bars: r.bars,
          linePath: r.line,
          bandPath: r.band,
          note: r.note || "",
          noteStyle: r.note ? "margin-top:10px;font-size:13px;line-height:1.4;color:#5F5062" : "display:none",
          series: (r.series || []).map(s => ({
            text: s.text,
            style: "position:absolute;right:4px;top:" + s.top.toFixed(1) + "%;transform:translateY(-135%);font-size:12px;font-weight:500;white-space:nowrap;color:#5F5062"
          })),
          spans: PHASES.map(p => ({
            value: r.key === "supp"
              ? (function (t) { return t.charAt(0).toUpperCase() + t.slice(1); })(p.supp.split(",").map(s => s.trim()).filter(s => !/omega-3/i.test(s)).join(", "))
              : p[r.key],
            barStyle: "background-color:" + p.color + "99",
            dotStyle: "flex:0 0 auto;width:8px;height:8px;margin-top:5px;border-radius:50%;background:" + p.ink
          }))
        }));
      })(),
      plans: rows.map(r => {
        const on = r.badgeKind === "popular";
        const hov = this.state.hoverPlan === r.id;
        const foc = false;
        return {
          ...r,
          enter: () => this.setState({ hoverPlan: r.id }),
          leave: () => this.setState(s => (s.hoverPlan === r.id ? { hoverPlan: "" } : null)),
          glowRef: el => { this.glowRefs[r.id] = el; },
          glowStyle: "position:absolute;inset:0;overflow:hidden;border-radius:16px;pointer-events:none;transition:opacity .25s ease;opacity:" + (hov ? "1" : "0"),
          style: [
            "position:relative", "isolation:isolate",
            "display:flex", "align-items:center", "justify-content:space-between",
            "gap:16px", "width:100%", "text-align:left",
            "font-family:'SF Pro Text',-apple-system,BlinkMacSystemFont,sans-serif",
            "padding:27px 22px 17px", "border-radius:16px", "color:#FDF9F6",
            "transform-style:preserve-3d",
            "backdrop-filter:blur(14px) saturate(1.15)",
            "outline:none",
            "transition:background .22s,border-color .22s,box-shadow .22s,transform .22s cubic-bezier(.2,.7,.2,1)",
            on && hov ? "background:rgba(38,26,40,0.60)" : on ? "background:rgba(38,26,40,0.54)" : hov ? "background:rgba(38,26,40,0.50)" : "background:rgba(38,26,40,0.42)",
            on ? "border:1.5px solid #FDF9F6" : hov ? "border:1.5px solid rgba(253,249,246,0.52)" : "border:1.5px solid rgba(253,249,246,0.2)",
            "box-shadow:" + (foc ? "0 0 0 3px rgba(253,249,246,0.92), " : "") + (
              on && hov ? "0 30px 56px -20px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.46)"
              : on ? "0 26px 50px -20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.38)"
              : hov ? "0 20px 38px -18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.24)"
              : "0 8px 20px -18px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)"
            ),
            on && hov ? "transform:translateY(-5px) scale(1.018)" : on ? "transform:translateY(-3px)" : hov ? "transform:translateY(-2px)" : "transform:none"
          ].join(";"),
          badgeStyle: r.badge ? [
            "position:absolute", "top:0", "right:0", "z-index:1",
            "font-family:Outfit,sans-serif", "font-weight:700", "font-size:10.5px",
            "letter-spacing:0.08em", "text-transform:uppercase",
            "padding:5px 12px 6px", "border-radius:0 16px 0 16px",
            "pointer-events:none", "color:#4A2244",
            r.badgeKind === "saving" ? "background:#FEC2AB" : "background:#F9BDC2"
          ].join(";") : "display:none"
        };
      })
    });
  }
}