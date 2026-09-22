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
          ? "flex:1 1 100%;margin:2px 0 0;font-size:14px;line-height:1.5;color:rgba(69,55,72,0.74)"
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
