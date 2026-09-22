/* ============================================================
   app.js — the compensation model and the page wiring.

   The model is a line-for-line port of the Backup sheet in
   OT_Compensation_Total_Package_Exhibit.xlsx. Every formula below carries the
   cell it came from, because that sheet is the spec and this file is the only
   place the two can drift apart.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- storage ---------- */

  var STORE = "ot_calc_v1";

  /* ILLUSTRATIVE STARTING VALUES — round numbers, not anybody's package.
     The structure and every formula below come from the workbook's Backup sheet
     (cells noted per line); the VALUES are deliberately generic, because this
     repo is public and a calculator whose defaults are the author's real salary
     publishes that salary. Type your own in the 假设 panel once — they are kept
     in this browser's localStorage and never leave the device.

     If you do change these, the acceptance suite's expected constants have to
     change with them — the E block at the top of tools/checks.js. Recompute them
     from the formulas, not from what this app prints. */
  var DEFAULTS = {
    base: 100000,      // Backup!B5  base salary, $/yr
    stdHours: 2080,    // Backup!B6  standard annual hours
    otMult: 1.5,       // Backup!B7  OT multiplier
    bonus: 4000,       // Backup!B8  fixed year-end bonus, $/yr
    matchPct: 0.05,    // Backup!B9  401(k) employer match, % of (base + OT pay)
    profitPct: 0.02,   // Backup!B10 profit share, % of base
    stipend: 1200,     // Backup!B11 mobile stipend, $/yr
    /* Paid time off. The workbook has no such row, and adding it changes no
       dollar figure anywhere: PTO is already inside the salary, so base, OT pay,
       total package, the 401(k) match and every tax number are identical with or
       without it. What it does change is the two things that depend on how many
       hours you ACTUALLY work — the effective rate per worked hour, and how many
       weeks are left to fit overtime into. */
    ptoHours: 80,      // 2 weeks
    step: 25,          // Backup!B12 display step, hours
    maxH: 625,         // Backup!B13 maximum OT hours shown
    /* Whether overtime pay counts as eligible compensation for the employer
       match. 1/0 rather than true/false on purpose: load() coerces every saved
       assumption with Number() and drops anything non-finite, so a boolean would
       silently fail to restore. The workbook includes OT, so 1 is the default. */
    matchOT: 1
  };

  var STEPS = [10, 25, 50, 100];

  /* ---------- tax defaults ----------
     2026, single filer. Every one of these is editable in the UI, because the
     point is that next January you look the new numbers up and type them in —
     not that you trust a constant baked in by whoever wrote this.

       Federal brackets + standard deduction  IRS Rev. Proc. 2025-32
       DC brackets                            DC OTR, unchanged since 2022 (not indexed)
       DC standard deduction                  DC OTR 2026 D-40ES booklet
       Social Security wage base              SSA, 2026
       401(k) / IRA / HSA limits              IRS, 2026
       Overtime deduction                     OBBBA, in force 2025-2028

     A bracket's first element is the top of that band; null means "and everything
     above". Rates are percentages, the way they are written down and the way the
     fields accept them. */
  var TAX_DEFAULTS = {
    year: 2026,
    fedStd: 16100,
    dcStd: 16100,
    fedBrackets: [[12400, 10], [50400, 12], [105700, 22], [201775, 24],
                  [256225, 32], [640600, 35], [null, 37]],
    dcBrackets: [[10000, 4], [40000, 6], [60000, 6.5], [250000, 8.5],
                 [500000, 9.25], [1000000, 9.75], [null, 10.75]],
    fica: 1,
    ssRate: 6.2,
    ssBase: 184500,
    medRate: 1.45,
    addMedRate: 0.9,
    addMedThr: 200000,      // not indexed; fixed at $200k for single filers
    otDed: 1,
    otCap: 12500,
    otPhase: 150000,
    c401k: 24500,           // prefilled at the limit, as asked
    c401kLimit: 24500,
    hsa: 4400,              // self-only, prefilled at the limit
    hsaLimit: 4400,
    hsaPayroll: 1,
    ira: 0,
    iraLimit: 7500
  };

  var TAX_NUM = ["year", "fedStd", "dcStd", "fica", "ssRate", "ssBase", "medRate",
                 "addMedRate", "addMedThr", "otDed", "otCap", "otPhase",
                 "c401k", "c401kLimit", "hsa", "hsaLimit", "hsaPayroll", "ira", "iraLimit"];

  var state = {
    a: clone(DEFAULTS),
    t: cloneTax(TAX_DEFAULTS),
    h: 250,
    prec: 0,           // decimal places for money; 0 = whole dollars, 2 = cents
    target: 25         // reverse-lookup target, in PERCENT (25 = 25%)
  };

  /* The bracket arrays are nested, so a shallow clone would hand every reset the
     same rows the user had already edited. */
  function cloneTax(o) {
    var r = clone(o);
    r.fedBrackets = o.fedBrackets.map(function (b) { return [b[0], b[1]]; });
    r.dcBrackets = o.dcBrackets.map(function (b) { return [b[0], b[1]]; });
    return r;
  }

  /* A stored bracket table is the one piece of saved state with a shape that can
     be wrong rather than just out of range, so it is validated rather than
     trusted: pairs only, finite non-negative rate, ceiling a number or null. */
  function sanitizeBrackets(raw, fallback) {
    if (!raw || !raw.length || typeof raw.length !== "number") return fallback;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var row = raw[i];
      if (!row || row.length < 2) continue;
      var top = row[0] === null || row[0] === undefined ? null : Number(row[0]);
      var rate = Number(row[1]);
      if (top !== null && (!isFinite(top) || top < 0)) continue;
      if (!isFinite(rate) || rate < 0) continue;
      out.push([top, rate]);
    }
    return out.length ? out : fallback;
  }

  function clone(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    if (!saved || typeof saved !== "object") return;
    if (saved.a && typeof saved.a === "object") {
      for (var k in DEFAULTS) {
        if (!DEFAULTS.hasOwnProperty(k)) continue;
        var v = Number(saved.a[k]);
        if (isFinite(v)) state.a[k] = v;
      }
    }
    if (saved.t && typeof saved.t === "object") {
      for (var j = 0; j < TAX_NUM.length; j++) {
        var tk = TAX_NUM[j], tv = Number(saved.t[tk]);
        if (isFinite(tv)) state.t[tk] = tv;
      }
      state.t.fedBrackets = sanitizeBrackets(saved.t.fedBrackets, state.t.fedBrackets);
      state.t.dcBrackets = sanitizeBrackets(saved.t.dcBrackets, state.t.dcBrackets);
    }
    if (isFinite(Number(saved.h))) state.h = Math.max(0, Number(saved.h));
    if (saved.prec === 2 || saved.prec === 0) state.prec = saved.prec;
    if (isFinite(Number(saved.target))) state.target = Number(saved.target);
    if (STEPS.indexOf(state.a.step) === -1) state.a.step = DEFAULTS.step;
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private window, quota */ }
  }

  /* ---------- the model ----------
     Backup!B16..B18 (derived rates) and Backup!A22:I47 (the schedule).
     Guarded: base or stdHours at 0 makes three of these divisions undefined, and
     an Infinity rendered as "$Infinity" is worse than an honest dash. */

  function rates(a) {
    /* Still base / 2080, deliberately. The overtime regular rate is the salary
       divided by the hours the salary is meant to cover, and PTO does not shrink
       that — dividing by 1,920 would INFLATE the OT rate, which is both wrong and
       flattering. PTO shows up further down, as the effective rate on hours
       actually worked. */
    var stdHourly = a.stdHours > 0 ? a.base / a.stdHours : NaN;   // Backup!B16 =B5/B6
    return {
      stdHourly: stdHourly,
      otHourly: stdHourly * a.otMult,                             // Backup!B17 =B16*B7
      profit: a.base * a.profitPct                                // Backup!B18 =B5*B10
    };
  }

  /* Weeks actually available to work in, after PTO. NaN rather than a clamped
     number when the assumptions make it meaningless (PTO at or beyond a full
     year): a plausible-looking wrong divisor is worse than a dash plus a
     warning. */
  function workWeeks(a) {
    if (!(a.stdHours > 0)) return NaN;
    var perWeek = a.stdHours / 52;
    var w = 52 - (Math.max(0, a.ptoHours || 0) / perWeek);
    return w >= 0.5 ? w : NaN;
  }

  /* Annual hours actually worked, PTO removed and overtime added. */
  function workedHours(a, h) {
    var base = a.stdHours - Math.max(0, a.ptoHours || 0);
    return base > 0 ? base + h : NaN;
  }

  function compute(a, h) {
    var r = rates(a);
    var otPay = h * r.otHourly;                                   // =A22*$B$17
    var variable = otPay + a.bonus;                               // =B22+$B$8
    var cash = a.base + variable;                                 // =$B$5+C22
    /* Backup!F22 = $B$9*($B$5+B22) — the workbook's match base is base + OT pay.
       With matchOT off the base is salary only, which is how plans that exclude
       overtime from eligible compensation actually work. */
    var match = a.matchPct * (a.base + (a.matchOT ? otPay : 0));
    var benefits = match + r.profit + a.stipend;
    return {
      h: h,
      stdHourly: r.stdHourly,
      otHourly: r.otHourly,
      otPay: otPay,
      variable: variable,
      eqBonus: a.base > 0 ? variable / a.base : NaN,              // =C22/$B$5
      cash: cash,
      match: match,
      profit: r.profit,                                           // =$B$18
      stipend: a.stipend,                                         // =$B$11
      benefits: benefits,
      total: cash + benefits,                                     // =E22+F22+G22+H22
      /* Not from the workbook — see ptoHours. */
      workedHours: workedHours(a, h),
      effHourly: cash / workedHours(a, h),
      ptoValue: Math.max(0, a.ptoHours || 0) * r.stdHourly
    };
  }

  /* Excel ROUND() is half-AWAY-from-zero; JS Math.round() is half-UP. They agree
     only for non-negative values — which MAX(0,...) guarantees here, but the
     helper states the rule rather than relying on the caller remembering it. */
  function roundHalfAway(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }

  /* Backup!B52 =ROUND(MAX(0,(A52*$B$5-$B$8)/$B$17),0)  — target is a FRACTION here. */
  function hoursForTarget(a, targetFrac) {
    var r = rates(a);
    if (!(r.otHourly > 0)) return NaN;
    return roundHalfAway(Math.max(0, (targetFrac * a.base - a.bonus) / r.otHourly));
  }

  function schedule(a) {
    var rows = [], step = a.step > 0 ? a.step : 25, h = 0;
    var max = a.maxH > 0 ? a.maxH : 0;
    /* Hard cap: a 1-hour step against a 100k-hour ceiling would otherwise build a
       table nobody asked for and freeze the window while doing it. */
    var limit = 400;
    while (h <= max && rows.length < limit) { rows.push(compute(a, h)); h += step; }
    return rows;
  }

  /* ---------- tax ----------
     Deliberately downstream of everything above: computeTax() READS a pre-tax
     result and never feeds back into it, so the workbook model stays exactly what
     the workbook says no matter what happens in here. */

  function bracketTax(income, brackets) {
    if (!(income > 0)) return 0;
    var tax = 0, lower = 0;
    for (var i = 0; i < brackets.length; i++) {
      var top = brackets[i][0];
      var ceiling = (top === null || top === undefined || !isFinite(top)) ? Infinity : top;
      if (ceiling <= lower) continue;                 // a ceiling below the band start is not a band
      var slice = Math.min(income, ceiling) - lower;
      if (slice <= 0) break;
      tax += slice * (brackets[i][1] / 100);
      lower = ceiling;
      if (!isFinite(ceiling)) break;
    }
    /* Income above the last finite ceiling with no open-ended band would simply
       go untaxed, which is a silent wrong answer — tax it at the top rate. */
    if (income > lower && brackets.length) tax += (income - lower) * (brackets[brackets.length - 1][1] / 100);
    return tax;
  }

  function computeTax(c, a, t) {
    var wages = c.cash;                                  // base + OT + bonus
    var k401 = Math.max(0, t.c401k || 0);
    var hsa = Math.max(0, t.hsa || 0);
    var ira = Math.max(0, t.ira || 0);
    var hsaPayroll = !!t.hsaPayroll;

    /* 401(k) deferrals do NOT reduce Social Security or Medicare wages; a
       cafeteria-plan HSA deduction does. That asymmetry is the whole reason the
       HSA question is a checkbox and not a footnote. */
    var ficaWages = Math.max(0, wages - (hsaPayroll ? hsa : 0));
    var ss = Math.min(ficaWages, Math.max(0, t.ssBase)) * (t.ssRate / 100);
    var med = ficaWages * (t.medRate / 100) +
              Math.max(0, ficaWages - t.addMedThr) * (t.addMedRate / 100);
    var fica = t.fica ? ss + med : 0;

    var fedWages = Math.max(0, wages - k401 - (hsaPayroll ? hsa : 0));
    var agi = Math.max(0, fedWages - ira - (hsaPayroll ? 0 : hsa));

    /* Only the PREMIUM half of time-and-a-half qualifies, not the whole overtime
       payment: at 1.5x that is one third of OT pay. */
    var otPremium = Math.max(0, c.h * c.stdHourly * (a.otMult - 1));
    var over = Math.max(0, agi - t.otPhase);
    /* $100 for each $1,000 over the threshold, a partial $1,000 counting as a
       whole one. */
    var cap = Math.max(0, t.otCap - Math.ceil(over / 1000) * 100);
    var otDeduction = t.otDed ? Math.min(otPremium, cap) : 0;

    var fedTaxable = Math.max(0, agi - t.fedStd - otDeduction);
    /* DC starts from federal AGI and does not conform to the overtime deduction. */
    var dcTaxable = Math.max(0, agi - t.dcStd);

    var fedTax = bracketTax(fedTaxable, t.fedBrackets);
    var dcTax = bracketTax(dcTaxable, t.dcBrackets);
    var totalTax = fedTax + dcTax + fica;

    return {
      wages: wages, k401: k401, hsa: hsa, ira: ira,
      fica: fica, ss: ss, med: med, ficaWages: ficaWages,
      agi: agi, otPremium: otPremium, otCap: cap, otDeduction: otDeduction,
      fedTaxable: fedTaxable, dcTaxable: dcTaxable,
      fedTax: fedTax, dcTax: dcTax, totalTax: totalTax,
      takeHome: wages - k401 - hsa - ira - totalTax,
      effRate: wages > 0 ? totalTax / wages : NaN
    };
  }

  /* The rate on the NEXT dollar of wages, measured rather than derived from the
     bracket table — that way it automatically accounts for FICA, the wage base,
     additional Medicare and the overtime phase-out all at once. */
  function marginalRate(c, a, t) {
    var step = 1000;
    var bumped = {};
    for (var k in c) if (c.hasOwnProperty(k)) bumped[k] = c[k];
    bumped.cash = c.cash + step;
    var lo = computeTax(c, a, t), hi = computeTax(bumped, a, t);
    return (hi.totalTax - lo.totalTax) / step;
  }

  /* ---------- formatting ---------- */

  var nfCache = {};
  function nf(dp) {
    if (!nfCache[dp]) nfCache[dp] = new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return nfCache[dp];
  }
  /* Normalising -0 is not pedantry: the waterfall negates each deduction, so a
     zero IRA contribution arrives here as -0 and Intl faithfully prints "$-0". */
  function zero(v) { return v === 0 ? 0 : v; }
  /* The sign goes OUTSIDE the currency symbol: "-$24,500", not "$-24,500". The
     latter is what you get by formatting the number and prepending a dollar sign,
     and it reads as a typo in a column of deductions. */
  function money(v) {
    if (!isFinite(v)) return "—";
    v = zero(v);
    return (v < 0 ? "-$" : "$") + nf(state.prec).format(Math.abs(v));
  }
  /* An hourly rate is not an annual figure: $48.08 shown as "$48" is a 0.2% error on
     the number every other number in this app is derived from, and the whole-dollar
     display mode exists for the six-figure totals, not for this. Rates always carry
     their cents. */
  function rate(v) {
    if (!isFinite(v)) return "—";
    return (v < 0 ? "-$" : "$") + nf(2).format(Math.abs(zero(v)));
  }
  function pct(v) { return isFinite(v) ? (zero(v) * 100).toFixed(state.prec ? 2 : 1) + "%" : "—"; }
  function hrs(v) { return isFinite(v) ? nf(0).format(v) + " h" : "—"; }
  /* Per WORKING week, not per calendar week. With four weeks of PTO there are 48
     weeks to fit overtime into, so 250 hours is 5.2 a week, not 4.8 — dividing by
     52 quietly understates the weekly commitment by 8%. */
  function perWeek(v) {
    var w = workWeeks(state.a);
    return isFinite(v) && isFinite(w) ? (v / w).toFixed(1) : "—";
  }
  /* The hours/week INPUT needs more precision than the prose, because whatever it
     shows the user can type straight back in — and the handler inverts it with
     round(w * 52). At one decimal that round trip is lossy for 505 of the 626
     hour values in range: the app prints 1.6 for 85 h, and re-entering its own
     1.6 silently moves the model to 83 h (a $199 swing at the defaults). Two
     decimals bound the error at 0.005 h/week = 0.26 h/year, comfortably inside
     the rounding step, so every value round-trips exactly. */
  function perWeekInput(v) {
    var w = workWeeks(state.a);
    return isFinite(v) && isFinite(w) ? (v / w).toFixed(2) : "";
  }
  /* Round a figure to what the reader will actually see. */
  function q(v) {
    if (!isFinite(v)) return v;
    var p = Math.pow(10, state.prec);
    return Math.round(v * p) / p;
  }

  /* DISPLAY figures, quantized once and then ADDED UP in display space.

     compute() is exact, and rounding each column on its own is what breaks the
     page's arithmetic: rounding each column on its own routinely leaves the parts
     a dollar off the total — with the workbook's own figures it happened on 10 of
     the 26 rows, printing "$193,594 + $16,716" under a headline of "$210,309". In
     a compensation sheet a total that contradicts its own parts is the kind of
     thing that makes someone stop trusting the whole page.

     So every identity the reader can actually check is made exact in the numbers
     they can see:
       变动薪酬   = 加班费 + 年终奖
       总现金薪酬 = 基本工资 + 变动薪酬
       雇主福利   = 401(k) + 利润分享 + 通讯补贴
       总薪酬包   = 总现金薪酬 + 雇主福利
     The cost is that the headline can land a dollar off the exact rounding of the
     true total. That is the right trade: the true total has a half-cent in it
     anyway, and a total that disagrees with its own parts has no defence at all.
     The CSV export deliberately does NOT go through this — an export carries the
     exact numbers (see tableText). */
  function displayOf(c, a) {
    var otPay = q(c.otPay), bonus = q(a.bonus), base = q(a.base);
    var variable = otPay + bonus;
    var cash = base + variable;

    /* The base salary, split for the donut into the part you were at work for and
       the part you were on PTO for. DERIVED BY SUBTRACTION, deliberately: rounding
       the two independently would let them miss the base by a dollar, and the
       whole point of the chart is that its parts add up. Clamped so an absurd PTO
       cannot make the worked part negative — a negative slice would be dropped by
       the renderer and the total would silently stop reconciling. */
    var ptoPay = isFinite(c.ptoValue) ? Math.min(q(c.ptoValue), base) : 0;
    var basePay = base - ptoPay;
    var match = q(c.match), profit = q(c.profit), stipend = q(c.stipend);
    var benefits = match + profit + stipend;
    return {
      h: c.h, base: base, basePay: basePay, ptoPay: ptoPay, bonus: bonus,
      otPay: otPay, variable: variable, cash: cash,
      match: match, profit: profit, stipend: stipend, benefits: benefits,
      total: cash + benefits,
      eqBonus: c.eqBonus, stdHourly: c.stdHourly, otHourly: c.otHourly
    };
  }

  /* ---------- dom ---------- */

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function txt(id, s) { var e = $(id); if (e) e.textContent = s; }

  var els = {};
  ["heroVal", "heroSub", "hSlider", "hSliderVal", "hExact", "hWeek", "hTicks",
   "mOtPay", "mVar", "mEq", "mCash", "sMatch", "sProfit", "sStipend", "sStd", "sOt", "sBenefit",
   "sWorked", "sEff", "sPto", "aPto", "tEffHourly", "tOtNet", "tPerWeek",
   "mixChart", "mixLegend", "mixDesc", "revPct", "revHours", "revSub", "revTable", "schedTable", "warnBox",
   "aBase", "aHours", "aMult", "aBonus", "aMatch", "aProfit", "aStipend", "aMax", "aStep"
  ].forEach(function (id) { els[id] = $(id); });

  /* field id -> [assumption key, scale]. Percent fields are entered as 6 and
     stored as 0.06; the scale is what keeps that conversion in ONE place. */
  var FIELDS = {
    aBase:    ["base", 1],
    aHours:   ["stdHours", 1],
    aMult:    ["otMult", 1],
    aBonus:   ["bonus", 1],
    aMatch:   ["matchPct", 100],
    aProfit:  ["profitPct", 100],
    aStipend: ["stipend", 1],
    aPto:     ["ptoHours", 1],
    aMax:     ["maxH", 1]
  };

  /* ---------- render ---------- */

  function renderAssumptions() {
    for (var id in FIELDS) {
      if (!FIELDS.hasOwnProperty(id)) continue;
      var f = FIELDS[id], el = els[id];
      if (!el) continue;
      var v = state.a[f[0]] * f[1];
      /* Round the display of a scaled percent: 0.06*100 is 6.000000000000001. */
      el.value = String(Math.round(v * 1e6) / 1e6);
    }
    if (els.aStep) els.aStep.value = String(state.a.step);

    /* The match-rate field's unit is a live statement of the formula, not a
       caption: with OT excluded, "% of 基本 + 加班费" would be a lie sitting
       directly above the number it describes. */
    var withOT = !!state.a.matchOT;
    txt("aMatchUnit", withOT ? "% of 基本 + 加班费" : "% of 基本工资");
    txt("matchBaseNote", withOT ? "跟随原表" : "与原表不同");
    var note = $("matchBaseNote");
    if (note) note.classList.toggle("off-book", !withOT);

    var grp = $("matchBaseToggle");
    if (grp) {
      [].forEach.call(grp.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String((b.getAttribute("data-mot") === "1") === withOT));
      });
    }
  }

  function renderDial() {
    var max = Math.max(state.a.maxH > 0 ? state.a.maxH : 0, state.h, 1);
    if (els.hSlider) {
      els.hSlider.max = String(max);
      els.hSlider.value = String(state.h);
      if (window.UIKit) UIKit.paintSlider(els.hSlider);
    }
    txt("hSliderVal", hrs(state.h));
    if (els.hExact && document.activeElement !== els.hExact) els.hExact.value = String(state.h);
    var weeksOk = isFinite(workWeeks(state.a));
    if (els.hWeek) {
      els.hWeek.disabled = !weeksOk;
      if (document.activeElement !== els.hWeek) els.hWeek.value = perWeekInput(state.h);
    }
    renderDialNote();
    if (els.hTicks) {
      els.hTicks.innerHTML = "";
      [0, Math.round(max / 2), max].forEach(function (t) {
        var s = document.createElement("span");
        s.textContent = nf(0).format(t);
        els.hTicks.appendChild(s);
      });
      alignTicks();
    }
  }

  /* The tick row labels the ENDS OF THE TRACK, so it has to start and stop where
     the track does — not where the row does. The kit's demo hardcodes the two
     margins (132px/84px) to match its own column widths; measuring them instead
     survives a label of a different length, a different language and a font that
     loads late, which a constant measured once does not. Same idiom as the kit's
     own JS-written --topbar-h / --fill / --hx. */
  function alignTicks() {
    var row = document.querySelector(".dial .slider-row");
    if (!row || !els.hSlider || !els.hTicks) return;
    var r = row.getBoundingClientRect(), s = els.hSlider.getBoundingClientRect();
    if (!(r.width > 0) || !(s.width > 0)) return;      // laid out yet?
    els.hTicks.style.marginLeft = Math.max(0, Math.round(s.left - r.left)) + "px";
    els.hTicks.style.marginRight = Math.max(0, Math.round(r.right - s.right)) + "px";
  }

  function renderNumbers(c) {
    var d = displayOf(c, state.a);
    txt("heroVal", money(d.total));
    txt("heroSub", isFinite(d.total)
      ? "在 " + hrs(d.h) + " 加班下，总现金薪酬 " + money(d.cash) + " + 雇主福利 " + money(d.benefits) + "。"
      : "请先填写有效的基本工资与标准年工时。");

    txt("mOtPay", money(d.otPay));
    txt("mVar", money(d.variable));
    txt("mEq", pct(d.eqBonus));
    txt("mCash", money(d.cash));

    txt("sMatch", money(d.match));
    txt("sProfit", money(d.profit));
    txt("sStipend", money(d.stipend));
    txt("sStd", rate(d.stdHourly));
    txt("sOt", rate(d.otHourly));
    txt("sBenefit", money(d.benefits));

    txt("sWorked", isFinite(c.workedHours) ? nf(0).format(Math.round(c.workedHours)) + " h" : "—");
    txt("sEff", rate(c.effHourly));
    txt("sPto", money(c.ptoValue));
  }

  /* The dial's note states the divisor it is actually using, because "per week"
     means two different numbers depending on PTO and the difference is the whole
     point of having entered it. */
  function renderDialNote() {
    var w = workWeeks(state.a), pto = Math.max(0, state.a.ptoHours || 0);
    txt("dialNote", isFinite(w)
      ? "按 " + (Math.round(w * 10) / 10) + " 个工作周折算（一年 52 周，减去 " + nf(0).format(pto) +
        " 小时 PTO）。滑杆与两个输入框始终同步；下方「显示步长」只决定明细表的行距。"
      : "PTO 超过了标准年工时，没有可用的工作周，折合每周无法计算。");
  }

  function renderWarnings() {
    var a = state.a, msgs = [];
    if (!(a.base > 0)) msgs.push("基本工资必须大于 0，否则时薪与等效年终奖都无法计算。");
    if (!(a.stdHours > 0)) msgs.push("标准年工时必须大于 0。");
    if (a.maxH > 0 && a.step > 0 && a.maxH / a.step > 400) msgs.push("明细表上限相对步长过大，表格已截断到 400 行。");
    if (state.h > a.maxH) msgs.push("当前加班小时超出了明细表上限，曲线与表格只画到上限为止。");
    if (a.stdHours > 0 && (a.ptoHours || 0) >= a.stdHours)
      msgs.push("PTO 不能达到或超过标准年工时，否则没有工作周可言，「折合每工作周」和「实际时薪」都算不出来。");
    var box = els.warnBox;
    if (!box) return;
    if (!msgs.length) { box.hidden = true; box.textContent = ""; return; }
    box.hidden = false;
    box.textContent = msgs.join(" ");
  }

  /* Narrow-screen card labels are copied from the LIVE header cells, so they
     follow any header rename for free; hardcoding them forks the copy. The
     aria-label does the same job for AT, which loses the row/column
     relationship the moment the table becomes a stack of cards. */
  function labelCells(table) {
    var heads = [].map.call(table.querySelectorAll("thead th"), function (th) { return th.textContent.trim(); });
    [].forEach.call(table.querySelectorAll("tbody tr"), function (row, rowIndex) {
      [].forEach.call(row.cells, function (cell, col) {
        cell.setAttribute("data-label", heads[col] || "");
        var b = cell.querySelector("button");
        /* The visible text comes FIRST and verbatim. An aria-label REPLACES the
           button's name, so "加班 (h) · 第 11 行" alone would announce the control
           without the one thing it is for — the number — and would leave voice
           control with no spoken name to match (WCAG 2.5.3). */
        if (b) b.setAttribute("aria-label",
          b.textContent.trim() + "，" + (heads[col] || "") + " · 第 " + (rowIndex + 1) + " 行，跳到这个小时数");
      });
    });
  }

  function jumpCell(h) {
    return '<button type="button" class="hjump" data-h="' + h + '">' + nf(0).format(h) + "</button>";
  }

  function renderSchedule(rows) {
    var t = els.schedTable;
    if (!t) return;
    var body = t.tBodies[0], html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = displayOf(rows[i], state.a);
      html += '<tr data-h="' + r.h + '">' +
        "<td>" + jumpCell(r.h) + "</td>" +
        "<td>" + money(r.otPay) + "</td>" +
        "<td>" + money(r.variable) + "</td>" +
        "<td>" + pct(r.eqBonus) + "</td>" +
        "<td>" + money(r.cash) + "</td>" +
        "<td>" + money(r.match) + "</td>" +
        "<td>" + money(r.profit) + "</td>" +
        "<td>" + money(r.stipend) + "</td>" +
        "<td>" + money(r.total) + "</td>" +
        "</tr>";
    }
    body.innerHTML = html;
    labelCells(t);
  }

  function renderReverse() {
    var t = els.revTable;
    if (!t) return;
    var body = t.tBodies[0], html = "", i;
    for (i = 10; i <= 50; i += 5) {
      var need = hoursForTarget(state.a, i / 100);
      var c = compute(state.a, isFinite(need) ? need : 0);
      var d = displayOf(c, state.a);
      html += '<tr data-h="' + (isFinite(need) ? need : 0) + '">' +
        "<td>" + i + "%</td>" +
        "<td>" + (isFinite(need) ? jumpCell(need) : "—") + "</td>" +
        "<td>" + perWeek(need) + "</td>" +
        "<td>" + (isFinite(need) ? money(d.total) : "—") + "</td>" +
        "</tr>";
    }
    body.innerHTML = html;
    labelCells(t);

    var need2 = hoursForTarget(state.a, state.target / 100);
    txt("revHours", isFinite(need2) ? nf(0).format(need2) + " h" : "—");
    txt("revSub", isFinite(need2)
      ? "折合每周 " + perWeek(need2) + " h，届时总薪酬包 " +
        money(displayOf(compute(state.a, need2), state.a).total)
      : "需要有效的加班时薪");
  }

  /* Rebuilding a tbody with innerHTML destroys whatever inside it had focus. A
     keyboard user pressing Enter on a row jump would land back on <body> with the
     page scrolled somewhere else — the control they were using stops existing as
     a direct result of using it. Remember which one it was and give it back. */
  var pendingFocus = null;
  function rememberJumpFocus(btn) {
    pendingFocus = btn && btn.closest("table") ?
      { table: btn.closest("table").id, h: btn.getAttribute("data-h") } : null;
  }
  function restoreJumpFocus() {
    if (!pendingFocus) return;
    var t = document.getElementById(pendingFocus.table);
    var b = t && t.querySelector('.hjump[data-h="' + pendingFocus.h + '"]');
    pendingFocus = null;
    if (b) b.focus();
  }

  function markCurrent() {
    [].forEach.call(document.querySelectorAll(".table tbody tr"), function (tr) {
      tr.classList.toggle("is-current", Number(tr.getAttribute("data-h")) === state.h);
    });
  }

  /* ---------- composition donut ----------
     Colours go in as var(--chart-*) so a theme flip recolours an ALREADY RENDERED
     chart with no redraw and no JS at all (gotcha 10). Nothing here reads a colour
     into JS.

     Six distinct hues, alternating warm and cool around the ring so no two
     neighbours are confusable: sage, aqua, mauve, coral, clay, slate. They are
     --chart-1/2/3 plus --accent-1/2/3, the latter re-valued in tokens.css (values
     only, no new names) because as shipped the accents duplicated the chart trio.
     An earlier version encoded the grouping in colour instead — mauve family for
     variable cash, clay family for employer benefits — but that needs the pale
     *-band tints, and a 2% slice of --chart-3-band on a --bg-elevated card is
     very nearly invisible. The grouping now lives in the interaction: hovering a
     slice lifts it and lights its row, which says the same thing and survives a
     reader who cannot tell two tints apart.

     Slice values come from displayOf, not from compute, so the legend's parts add
     up to the total printed in the middle — see the note on displayOf. */
  var MIX = [
    { key: "basePay", label: "基本工资（在岗）", color: "var(--chart-1)" },
    /* PTO is a slice OF the base salary, not money on top of it — the two
       together are the full base salary. It gets the neutral rather than a seventh hue
       on purpose: it is the one slice that is not "earned by working", and a
       band tint of the sage would have been another near-background colour. */
    { key: "ptoPay",  label: "PTO（带薪休假）",  color: "var(--chart-muted)" },
    { key: "otPay",   label: "加班费",          color: "var(--accent-1)" },
    { key: "bonus",   label: "年终奖",          color: "var(--chart-2)" },
    { key: "match",   label: "401(k) 雇主匹配", color: "var(--accent-2)" },
    { key: "profit",  label: "利润分享",        color: "var(--chart-3)" },
    { key: "stipend", label: "通讯补贴",        color: "var(--accent-3)" }
  ];

  var DONUT = { size: 240, r: 82, w: 32, gap: 2, pop: 9 };

  /* The donut's centre label is built as an SVG string, so anything interpolated
     into it has to be escaped. Today that is only a formatted number, but the
     escape is the thing that keeps it true after someone interpolates a label. */
  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* Which slice is lit. `hover` is transient, `pinned` survives the pointer
     leaving — a click (or Enter on a legend row) pins it so you can read the row
     without keeping the mouse still. Selection is deliberately NOT persisted: it
     is where you are looking right now, not a setting. */
  var mixHover = null, mixPinned = null;

  function mixActive() { return mixPinned || mixHover; }

  function paintMixActive() {
    var key = mixActive();
    var any = key != null;
    [].forEach.call(document.querySelectorAll(".mix-slice"), function (g) {
      var on = g.getAttribute("data-key") === key;
      g.classList.toggle("is-active", on);
      /* CSS owns the transition; the distance is per-slice, so JS owns the value.
         They never write the same property at the same time. */
      g.style.transform = on
        ? "translate(" + g.getAttribute("data-dx") + "px," + g.getAttribute("data-dy") + "px)"
        : "";
      g.classList.toggle("is-dim", any && !on);
    });
    [].forEach.call(document.querySelectorAll(".mix-row"), function (b) {
      var on = b.getAttribute("data-key") === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(b.getAttribute("data-key") === mixPinned));
    });
  }

  function setMixHover(key) { mixHover = key; paintMixActive(); }
  function toggleMixPin(key) {
    mixPinned = mixPinned === key ? null : key;
    paintMixActive();
  }

  function renderMix() {
    var svg = els.mixChart, legend = els.mixLegend;
    if (!svg || !legend) return;

    var d = displayOf(compute(state.a, state.h), state.a);
    var parts = [], i, total = 0;
    for (i = 0; i < MIX.length; i++) {
      var v = d[MIX[i].key];
      if (!isFinite(v) || v <= 0) continue;          // a zero slice is not a slice
      parts.push({ def: MIX[i], value: v });
      total += v;
    }

    if (!parts.length || !(total > 0) || !isFinite(d.total)) {
      svg.innerHTML = "";                            // :empty hides the box entirely
      legend.innerHTML = "";
      return;
    }

    var cx = DONUT.size / 2, cy = DONUT.size / 2, r = DONUT.r;
    var C = 2 * Math.PI * r;
    var slices = "", offset = 0, legendHTML = "", shares = [];

    function arc(color, width, drawn, at) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
             '" fill="none" stroke="' + color + '" stroke-width="' + width +
             '" stroke-dasharray="' + drawn.toFixed(2) + " " + (C - drawn).toFixed(2) +
             '" stroke-dashoffset="' + (-at).toFixed(2) +
             '" transform="rotate(-90 ' + cx + " " + cy + ')"/>';
    }

    for (i = 0; i < parts.length; i++) {
      var share = parts[i].value / total;
      var len = share * C;
      /* Keep the gap off the last sliver of a tiny slice, or a 0.9% stipend
         disappears into its own separator. */
      var drawn = Math.max(len - DONUT.gap, Math.min(len, 0.6));
      /* A hairline under every slice. Two of these tokens are pale band tints, and
         a 2% slice of --chart-3-band on a --bg-elevated card is very nearly
         invisible; the outline is what keeps the palest slice readable without
         reaching for a colour outside the palette. Drawn in two passes — all
         outlines, then all fills — so a slice's outline never sits on top of its
         neighbour's fill. */
      /* Each slice is its own <g> so it can be lifted out of the ring. The lift
         direction is the slice's own bisector, computed here because CSS cannot
         know it; CSS owns only the transition. */
      var mid = (offset + len / 2) / C * 2 * Math.PI - Math.PI / 2;
      var dx = (Math.cos(mid) * DONUT.pop).toFixed(2);
      var dy = (Math.sin(mid) * DONUT.pop).toFixed(2);
      slices += '<g class="mix-slice" data-key="' + parts[i].def.key +
                '" data-dx="' + dx + '" data-dy="' + dy + '">' +
                arc("var(--separator-strong)", DONUT.w + 2, drawn, offset) +
                arc(parts[i].def.color, DONUT.w, drawn, offset) +
                "</g>";
      offset += len;

      var pctTxt = (share * 100).toFixed(share < 0.01 ? 2 : 1) + "%";
      shares.push(parts[i].def.label + " " + pctTxt);
      /* A real <button>, so the slice a keyboard user is on is the slice that
         lifts — and so the pairing is not hover-only. */
      legendHTML += '<li><button type="button" class="mix-row" data-key="' + parts[i].def.key +
        '" aria-pressed="false">' +
        '<span class="mix-sw" style="background:' + parts[i].def.color + '"></span>' +
        '<span class="mix-name">' + parts[i].def.label + "</span>" +
        '<span class="mix-val">' + money(parts[i].value) + "</span>" +
        '<span class="mix-pct">' + pctTxt + "</span>" +
        "</button></li>";
    }

    /* The hole is the point of a donut: the total the slices explain. Sized as a
       chart annotation, not as a second hero — the page already has one of those. */
    var out = slices;
    out += '<text x="' + cx + '" y="' + (cy - 6) + '" text-anchor="middle" font-size="12" ' +
           'font-family="var(--font-text)" fill="var(--label-3)" ' +
           'letter-spacing="0.06em">TOTAL PACKAGE</text>';
    out += '<text x="' + cx + '" y="' + (cy + 20) + '" text-anchor="middle" font-size="23" ' +
           'font-weight="700" font-family="var(--font-num)" fill="var(--ink-number)" ' +
           'style="font-variant-numeric:tabular-nums" letter-spacing="-0.02em">' +
           esc(money(d.total)) + "</text>";

    svg.innerHTML = out;
    legend.innerHTML = legendHTML;
    paintMixActive();
    svg.setAttribute("aria-label",
      "总薪酬包 " + money(d.total) + " 的构成：" + shares.join("，") + "。");
  }

  /* ---------- tax rendering ---------- */

  var TAX_FIELDS = {
    c401k: "c401k", cHsa: "hsa", cIra: "ira",
    fedStd: "fedStd", dcStd: "dcStd",
    ssRate: "ssRate", ssBase: "ssBase", medRate: "medRate",
    addMedRate: "addMedRate", addMedThr: "addMedThr",
    otCap: "otCap", otPhase: "otPhase",
    c401kLimit: "c401kLimit", hsaLimit: "hsaLimit", iraLimit: "iraLimit",
    taxYear: "year"
  };

  function renderBrackets(tableId, key) {
    var t = $(tableId);
    if (!t) return;
    var rows = state.t[key], html = "";
    for (var i = 0; i < rows.length; i++) {
      var top = rows[i][0];
      html += '<tr>' +
        '<td><input type="number" min="0" step="100" inputmode="decimal" data-br="' + key + '" data-i="' + i +
          '" data-f="top" value="' + (top === null ? "" : top) + '" placeholder="以上" aria-label="第 ' + (i + 1) + ' 档上限"></td>' +
        '<td><input type="number" min="0" step="0.05" inputmode="decimal" data-br="' + key + '" data-i="' + i +
          '" data-f="rate" value="' + rows[i][1] + '" aria-label="第 ' + (i + 1) + ' 档税率"></td>' +
        '<td><button type="button" class="btn-ghost sm quiet br-del" data-br="' + key + '" data-i="' + i +
          '" aria-label="删除第 ' + (i + 1) + ' 档">删</button></td>' +
        "</tr>";
    }
    t.tBodies[0].innerHTML = html;
  }

  function renderTaxInputs() {
    for (var id in TAX_FIELDS) {
      if (!TAX_FIELDS.hasOwnProperty(id)) continue;
      var el = $(id);
      if (el && document.activeElement !== el) el.value = String(state.t[TAX_FIELDS[id]]);
    }
    var cb = $("cHsaPayroll");
    if (cb) cb.checked = !!state.t.hsaPayroll;

    [["ficaToggle", "fica", "ficaNote"], ["otDedToggle", "otDed", "otDedNote"]].forEach(function (x) {
      var g = $(x[0]);
      if (g) {
        [].forEach.call(g.querySelectorAll("button"), function (b) {
          b.setAttribute("aria-pressed", String((b.getAttribute("data-on") === "1") === !!state.t[x[1]]));
        });
      }
      txt(x[2], state.t[x[1]] ? "计入" : "不计");
      var n = $(x[2]);
      if (n) n.classList.toggle("off-book", !state.t[x[1]]);
    });

    txt("taxYearTag", String(Math.round(state.t.year)) + " 税率");   // a year is a label, not a quantity
    txt("c401kCap", "上限 " + nf(0).format(state.t.c401kLimit));
    txt("cHsaCap", "上限 " + nf(0).format(state.t.hsaLimit));
    txt("cIraCap", "上限 " + nf(0).format(state.t.iraLimit));

    renderBrackets("fedBrackets", "fedBrackets");
    renderBrackets("dcBrackets", "dcBrackets");
  }

  function renderTax(c) {
    var t = state.t, x = computeTax(c, state.a, t);
    var d = displayOf(c, state.a);

    /* Quantized the same way the rest of the page is, and the waterfall's last
       line is the SUM of the lines above it rather than a separately rounded
       figure — same rule, same reason (see displayOf). */
    var wages = q(x.wages), k401 = q(x.k401), hsa = q(x.hsa), ira = q(x.ira);
    var fed = q(x.fedTax), dc = q(x.dcTax), fica = q(x.fica);
    var taxSum = fed + dc + fica;
    var home = wages - k401 - hsa - ira - taxSum;

    txt("tHome", money(home));
    txt("tTax", money(taxSum));
    txt("tEff", wages > 0 ? pct(taxSum / wages) : "—");
    var marg = marginalRate(c, state.a, t);
    txt("tMarg", pct(marg));

    /* The after-tax counterparts of the pre-tax strip, with PTO inside the
       divisor because these are hours actually WORKED, not hours paid.
       每加班小时净得 uses the MARGINAL rate, not the effective one: an extra
       overtime hour is taxed at the top of the stack, not at the average. */
    txt("tEffHourly", rate(home / c.workedHours));
    txt("tOtNet", rate(c.otHourly * (1 - marg)));
    var wk = workWeeks(state.a);
    txt("tPerWeek", isFinite(wk) ? money(home / wk) : "—");

    var rows = [
      ["总现金薪酬", wages, "+"],
      ["401(k) 员工供款", -k401, "-"],
      ["HSA 供款", -hsa, "-"],
      ["传统 IRA 供款", -ira, "-"],
      ["联邦所得税", -fed, "-"],
      ["DC 所得税", -dc, "-"],
      ["FICA（社保 + 医保）", -fica, "-"],
      ["到手现金", home, "="]
    ];
    var body = $("waterfall") && $("waterfall").tBodies[0];
    if (body) {
      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var last = rows[i][2] === "=";
        html += '<tr' + (last ? ' class="wf-total"' : "") + ">" +
          "<td>" + rows[i][0] + "</td>" +
          "<td>" + money(rows[i][1]) + "</td>" +
          "<td>" + (wages > 0 ? pct(rows[i][1] / wages) : "—") + "</td>" +
          "</tr>";
      }
      body.innerHTML = html;
      labelCells($("waterfall"));
    }

    /* Say what the overtime deduction actually did. "计入" on its own does not
       tell you it was phased out to zero. */
    var hint = $("otDedHint");
    if (hint) {
      if (!t.otDed) {
        hint.textContent = "不计入加班扣除，加班费按普通工资全额计税。";
      } else if (!(x.otPremium > 0)) {
        hint.textContent = "当前没有加班，没有可扣除的溢价。";
      } else {
        hint.textContent = "加班溢价 " + money(x.otPremium) + "（时薪一倍以上的部分），" +
          "本年上限退坡后为 " + money(x.otCap) + "，实际扣除 " + money(x.otDeduction) +
          "，只作用于联邦所得税。";
      }
    }

    var ih = $("iraHint");
    if (ih) {
      var risky = x.ira > 0 && x.agi > 100000;
      ih.hidden = !risky;
      if (risky) {
        ih.textContent = "注意：AGI 约 " + money(x.agi) +
          "，如果你参加了公司的 401(k) 计划，这笔传统 IRA 供款很可能不可抵扣——" +
          "上面的税额按可抵扣算，请自行核对当年的退坡区间。";
      }
    }
  }

  /* ---------- the one render entry point ---------- */

  function render() {
    var c = compute(state.a, state.h);
    renderDial();
    renderNumbers(c);
    renderWarnings();
    renderMix();
    renderSchedule(schedule(state.a));
    renderReverse();
    renderTax(c);
    /* After BOTH tbodies have been rebuilt, not inside either one: markCurrent
       marks every .table, and running it from renderSchedule meant the reverse
       table's rows were replaced a moment later and never got the highlight. */
    markCurrent();
    restoreJumpFocus();
    save();
  }

  /* ---------- export ---------- */

  var NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.app);

  function tableText(sep) {
    var a = state.a, rows = schedule(a), r = rates(a), out = [];
    /* A field holding the separator, a quote or a newline has to be quoted, or the
       importer silently splits one cell into two. Cheap here, invisible when missing. */
    function cell(v) {
      var s = v === null || v === undefined ? "" : String(v);
      return /["\n\r]/.test(s) || s.indexOf(sep) !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function line(arr) { out.push(arr.map(cell).join(sep)); }
    line(["加班与总薪酬测算"]);
    line([]);
    line(["假设"]);
    line(["基本工资 ($/yr)", a.base]);
    line(["标准年工时 (h)", a.stdHours]);
    line(["加班倍率 (x)", a.otMult]);
    line(["年终奖 ($/yr)", a.bonus]);
    line(["401(k) 雇主匹配 (%)", a.matchPct]);
    line(["401(k) 匹配计算基数", a.matchOT ? "基本工资 + 加班费（原表口径）" : "仅基本工资"]);
    line(["利润分享 (% of base)", a.profitPct]);
    line(["通讯补贴 ($/yr)", a.stipend]);
    line(["PTO (h/yr)", a.ptoHours]);
    line(["标准时薪 ($/h)", r.stdHourly]);
    line(["加班时薪 ($/h)", r.otHourly]);
    line(["工作周数（扣除 PTO）", r2(workWeeks(a))]);
    var cNow = compute(a, state.h);
    line(["实际工作小时（含加班）", r2(cNow.workedHours)]);
    line(["实际时薪 ($/h)", r2(cNow.effHourly)]);
    line([]);
    line(["加班 (h)", "加班费", "变动薪酬", "等效年终奖", "总现金薪酬", "401(k) 匹配", "利润分享", "通讯补贴", "总薪酬包"]);
    rows.forEach(function (x) {
      line([x.h, r2(x.otPay), r2(x.variable), r6(x.eqBonus), r2(x.cash), r2(x.match), r2(x.profit), r2(x.stipend), r2(x.total)]);
    });
    line([]);
    var t = state.t, cNow2 = compute(a, state.h), xx = computeTax(cNow2, a, t);
    line(["税后（" + t.year + " 税表，单身，标准扣除）"]);
    line(["加班小时", state.h]);
    line(["总现金薪酬", r2(xx.wages)]);
    line(["401(k) 员工供款", r2(xx.k401)]);
    line(["HSA 供款" + (t.hsaPayroll ? "（工资扣除）" : "（非工资扣除）"), r2(xx.hsa)]);
    line(["传统 IRA 供款", r2(xx.ira)]);
    line(["AGI", r2(xx.agi)]);
    line(["OBBBA 加班扣除" + (t.otDed ? "" : "（未计入）"), r2(xx.otDeduction)]);
    line(["联邦应税所得", r2(xx.fedTaxable)]);
    line(["联邦所得税", r2(xx.fedTax)]);
    line(["DC 应税所得", r2(xx.dcTaxable)]);
    line(["DC 所得税", r2(xx.dcTax)]);
    line(["FICA" + (t.fica ? "" : "（未计入）"), r2(xx.fica)]);
    line(["到手现金", r2(xx.takeHome)]);
    line(["税后实际时薪 ($/h)", r2(xx.takeHome / cNow2.workedHours)]);
    line(["每加班小时税后净得 ($/h)", r2(cNow2.otHourly * (1 - marginalRate(cNow2, a, t)))]);
    line(["税后每工作周 ($)", r2(xx.takeHome / workWeeks(a))]);
    line([]);
    line(["反查：目标等效年终奖 → 需要加班小时"]);
    line(["目标 %", "需要加班 (h)"]);
    for (var p = 10; p <= 50; p += 5) line([p / 100, hoursForTarget(a, p / 100)]);
    return out.join("\n");
  }
  function r2(v) { return isFinite(v) ? Math.round(v * 100) / 100 : ""; }
  function r6(v) { return isFinite(v) ? Math.round(v * 1e6) / 1e6 : ""; }

  function exportCSV() {
    /* The BOM is what makes Excel open a UTF-8 CSV with Chinese headers without
       mangling them. Both paths get it, so the file is identical either way. */
    var text = "﻿" + tableText(",");
    var name = "OT_Compensation_" + nf(0).format(state.a.base).replace(/,/g, "") + ".csv";
    if (NATIVE) {
      window.webkit.messageHandlers.app.postMessage({ type: "saveFile", name: name, data: text });
      return;
    }
    try {
      var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      UIKit.toast("已导出 " + name);
    } catch (e) {
      UIKit.toast("导出失败：" + e.message, true);
    }
  }

  function copyTable() {
    var text = tableText("\t");
    var done = function () { UIKit.toast("表格已复制，可直接粘进 Excel。"); };
    var fail = function () { UIKit.toast("复制失败，请改用导出 CSV。", true); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
      return;
    }
    /* execCommand is the fallback for a WKWebView without async clipboard. */
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      ok ? done() : fail();
    } catch (e) { fail(); }
  }

  /* ---------- print ----------
     The host cannot print this WebKit view (see the note in main.swift: the old
     SDK's print path renders blank pages), so printing is a self-contained
     snapshot handed to a renderer that can. The snapshot is static HTML: no
     scripts, no stylesheet links — the host inlines the three stylesheets where
     the APP_CSS marker sits.

     An <input>'s typed value lives in the PROPERTY, not the attribute, so a
     plain serialisation of the DOM prints every assumption field EMPTY. Copying
     the live values onto their attributes first is what makes the paper match
     the screen. */
  function snapshotHTML() {
    [].forEach.call(document.querySelectorAll("input"), function (i) {
      if (i.type === "checkbox" || i.type === "radio") {
        if (i.checked) i.setAttribute("checked", "checked"); else i.removeAttribute("checked");
      } else {
        i.setAttribute("value", i.value);
      }
    });
    [].forEach.call(document.querySelectorAll("select"), function (sel) {
      [].forEach.call(sel.options, function (o) {
        if (o.selected) o.setAttribute("selected", "selected"); else o.removeAttribute("selected");
      });
    });

    var root = document.documentElement.cloneNode(true);
    [].forEach.call(root.querySelectorAll("script,link[rel=stylesheet],.ui-select-menu,.toast"),
      function (n) { n.parentNode.removeChild(n); });
    /* The disclosure is the exhibit's footnotes; on paper they are not optional. */
    [].forEach.call(root.querySelectorAll("details"), function (d) { d.setAttribute("open", "open"); });

    var head = root.querySelector("head");
    if (head) head.insertBefore(document.createComment("APP_CSS"), head.firstChild);
    return "<!DOCTYPE html>\n" + root.outerHTML;
  }

  function printSnapshot() {
    if (NATIVE) {
      try {
        window.webkit.messageHandlers.app.postMessage({ type: "print", html: snapshotHTML() });
        return;
      } catch (e) { /* fall through to the browser's own print */ }
    }
    window.print();
  }

  /* ---------- host bridge ---------- */

  /* WKWebView on this machine leaves some elements' computed style STALE until
     something forces them to recalculate once. Two places it bites this app, both
     measured in a real WKWebView rather than reasoned about:

       1. Theme flip. After data-theme goes dark, :root's --bg-inset is correctly
          #242220 and panels/bands/toasts all follow, but an <input>/<select> keeps
          the LIGHT background #F2EFE9 while its text colour switches to the dark
          --label #EDE9E1 — near-white on near-white, so the value you typed is
          unreadable.
       2. The segmented control's thumb. UIKit.segmented writes
          `width: 51px; height: 27px` as an INLINE style; the attribute is there and
          correct, and getComputedStyle still answers 0px. The iOS-style sliding
          pill simply never appears — the control degrades to a plain row of labels
          with no visible selection, which is exactly the "looks fine, isn't" shape
          the kit's own gotcha list is about.

     Toggling a class on the element is not enough (tested). Detaching and
     re-inserting works but throws focus and selection away. Hiding and restoring
     forces the recalculation with nothing the user can see, because no frame is
     painted between the two assignments in the same task. Once an element has been
     recalculated once it stays correct, including across later interactions. */
  function forceRestyle(selector) {
    var nodes = document.querySelectorAll(selector);
    if (!nodes.length) return;

    var active = document.activeElement, selStart = null, selEnd = null;
    try {
      if (active && typeof active.selectionStart === "number") {
        selStart = active.selectionStart; selEnd = active.selectionEnd;
      }
    } catch (e) { /* number inputs throw on selectionStart in some engines */ }

    /* Taking every field out of the flow shortens the document, and if the page
       is scrolled near the bottom the engine clamps scrollY on the spot — the
       restore puts the height back but not the position, so a theme toggle would
       jump the page. Nothing paints between these assignments, so putting the
       scroll back synchronously is invisible. */
    var sx = window.scrollX, sy = window.scrollY;

    var i, prev = [];
    for (i = 0; i < nodes.length; i++) { prev.push(nodes[i].style.display); nodes[i].style.display = "none"; }
    void document.body.offsetHeight;                 // force the recalculation
    for (i = 0; i < nodes.length; i++) nodes[i].style.display = prev[i];

    /* display:none blurs whatever had focus, so put the caret back — someone can
       hit the theme shortcut halfway through typing an assumption. preventScroll
       matters: a plain focus() scrolls the field back into view, which is its own
       way of throwing the reader's position away. */
    if (active && active.isConnected && typeof active.focus === "function") {
      try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
      if (selStart !== null) {
        try { active.setSelectionRange(selStart, selEnd); } catch (e) {}
      }
    }

    /* Put the page back — and keep putting it back for a moment.
       Hiding the element that currently has focus makes the engine blur it, and
       its focus recovery queues a SMOOTH scroll to the top that starts a few
       hundred milliseconds later. Measured: focus alone is fine, hiding alone is
       fine, both together send the page to scroll 0 at about +400ms. A single
       synchronous restore is still at 600 when it runs and is then overridden.
       Neither scroll-behavior:auto around the operation nor an explicit blur
       first prevents it; re-asserting the position does, because our scrollTo
       cancels the pending animation before it starts.

       Three attempts, all idempotent: synchronous, next frame, and once more
       shortly after. If rAF never fires the window is not on screen anyway. */
    var putBack = function () {
      if (window.scrollX !== sx || window.scrollY !== sy) window.scrollTo(sx, sy);
    };
    putBack();
    if (window.requestAnimationFrame) requestAnimationFrame(putBack);
    setTimeout(putBack, 60);
    setTimeout(putBack, 180);
  }

  function setTheme() {
    var root = document.documentElement;
    var next = UIKit.theme.get() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("ui_theme", next); } catch (e) { /* private mode */ }
    forceRestyle("input, select, textarea, .seg-thumb");
    pushTheme();
  }

  function pushTheme() {
    if (!NATIVE) return;
    try {
      window.webkit.messageHandlers.app.postMessage({ type: "theme", value: document.documentElement.dataset.theme });
    } catch (e) { /* bridge went away */ }
  }

  /* The native menu bar calls these; they are the app's only global surface. */
  window.AppBridge = {
    exportCSV: exportCSV,
    copyTable: copyTable,
    toggleTheme: setTheme,
    printSnapshot: printSnapshot,
    /* Exposed so the print pipeline can be exercised without a print dialog:
       the host assembles exactly this string. */
    snapshot: snapshotHTML,
    reset: doReset,
    toast: function (m, bad) { UIKit.toast(m, !!bad); }
  };

  /* ---------- input handling ---------- */

  function setHours(h, from) {
    h = Number(h);
    if (!isFinite(h)) return;
    h = Math.max(0, Math.round(h));
    if (h === state.h) {
      /* Still re-sync the OTHER fields: the user may have typed 250.4, which
         rounds back to the value we already hold but leaves their text alone. */
      if (from) renderDial();
      return;
    }
    state.h = h;
    render();
  }

  function readAssumption(id) {
    var f = FIELDS[id], el = els[id];
    if (!f || !el) return;
    var v = Number(el.value);
    if (el.value === "" || !isFinite(v)) return;         // mid-typing: leave the model alone
    if (v < 0) v = 0;
    state.a[f[0]] = v / f[1];
    render();
  }

  function doReset() {
    state.a = clone(DEFAULTS);
    state.h = 250;
    state.target = 25;
    if (els.revPct) els.revPct.value = "25";
    renderAssumptions();
    render();
    UIKit.toast("已恢复原表的默认假设。");
  }

  /* ---------- wiring ---------- */

  load();
  renderAssumptions();
  if (els.revPct) els.revPct.value = String(state.target);

  UIKit.chrome({ titleSlot: "#topbarTitle" });

  /* UIKit.chrome() re-measures --topbar-h on window resize only. This bar also
     changes height on its OWN: at narrow widths the compact title echo appears and
     the toolbar wraps to a second line, and nothing fires a resize for that.
     Measured in a real browser at 390px wide: the bar went 55 -> 95px while
     --topbar-h stayed at 55, and the sub-bar — pinned at calc(--topbar-h - 1px) —
     tucked 41px UNDER the top bar, hiding the quick-jump buttons entirely
     (gotcha 6: "chrome 内容变化时也要重量"). */
  (function watchChromeHeight() {
    var bar = document.querySelector(".topbar");
    if (!bar) return;
    var last = bar.offsetHeight, busy = false;

    function sync() {
      var h = bar.offsetHeight;
      if (busy || h === last) return;
      busy = true;
      /* last is updated BEFORE refresh() so a re-entrant delivery sees the new
         height and stops; the flag only guards the synchronous nesting. No timer
         and no rAF here on purpose — a coalescing frame that never arrives (a
         backgrounded window) would leave this permanently disarmed, which is the
         same shape as the bug it is fixing. refresh() is cheap. */
      try { last = h; UIKit.refresh(); } finally { busy = false; }
    }

    /* Two delivery paths, deliberately. The scroll listener is the one that MUST
       work: the height changes because of a scroll (the echo appears and the
       toolbar wraps), and UIKit.chrome() registered its own scroll handler first,
       so by the time this runs the echo has already been toggled. The observer is
       the general case — it also catches a font load or a reflow with no scroll —
       but it is not delivered in every embedder, so nothing depends on it alone. */
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("resize", alignTicks);
    if (typeof ResizeObserver === "function") {
      try { new ResizeObserver(sync).observe(bar); } catch (e) { /* older engines */ }
    }
  }());
  UIKit.segmented("#precToggle");
  UIKit.segmented("#matchBaseToggle");
  UIKit.segmented("#ficaToggle");
  UIKit.segmented("#otDedToggle");
  UIKit.watchSliders();
  UIKit.edgeFade("#subbarScroll");   // the quick-jump bar scrolls sideways on a phone
  UIKit.popover();

  on(els.hSlider, "input", function () { setHours(this.value); });
  on(els.hExact, "input", function () { setHours(this.value, "exact"); });
  on(els.hWeek, "input", function () {
    var v = Number(this.value), weeks = workWeeks(state.a);
    if (this.value === "" || !isFinite(v) || !isFinite(weeks)) return;
    setHours(Math.max(0, v) * weeks, "week");
  });
  /* On blur the field stops being the user's scratch space and goes back to
     showing the model's value. */
  on(els.hExact, "blur", renderDial);
  on(els.hWeek, "blur", renderDial);

  for (var fid in FIELDS) {
    if (!FIELDS.hasOwnProperty(fid)) continue;
    (function (id) {
      on(els[id], "input", function () { readAssumption(id); });
      on(els[id], "blur", function () { renderAssumptions(); });
    }(fid));
  }

  on(els.aStep, "change", function () {
    var v = Number(this.value);
    state.a.step = STEPS.indexOf(v) === -1 ? DEFAULTS.step : v;
    render();
  });

  on(els.revPct, "input", function () {
    var v = Number(this.value);
    if (this.value === "" || !isFinite(v)) return;
    state.target = Math.max(0, v);
    renderReverse();
    markCurrent();
    save();
  });

  /* Segmented controls: UIKit.segmented drives the THUMB only — switching
     aria-pressed is the app's job (SKILL.md, "这些要你自己写"). */
  on($("precToggle"), "click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    [].forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", "false"); });
    b.setAttribute("aria-pressed", "true");
    state.prec = Number(b.getAttribute("data-prec")) === 2 ? 2 : 0;
    render();
  });
  /* Restore the persisted precision into the control before its thumb is placed. */
  (function () {
    var g = $("precToggle");
    if (!g) return;
    [].forEach.call(g.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-prec")) === state.prec));
    });
    UIKit.refresh();
  }());

  /* ---- tax wiring ---- */
  renderTaxInputs();

  for (var tid in TAX_FIELDS) {
    if (!TAX_FIELDS.hasOwnProperty(tid)) continue;
    (function (id, key) {
      on($(id), "input", function () {
        if (this.value === "") return;              // mid-typing
        var v = Number(this.value);
        if (!isFinite(v) || v < 0) return;
        state.t[key] = v;
        if (key === "year") txt("taxYearTag", String(Math.round(v)) + " 税率");
        if (key === "c401kLimit" || key === "hsaLimit" || key === "iraLimit") renderTaxInputs();
        render();
      });
      on($(id), "blur", function () { renderTaxInputs(); });
    }(tid, TAX_FIELDS[tid]));
  }

  on($("cHsaPayroll"), "change", function () {
    state.t.hsaPayroll = this.checked ? 1 : 0;
    render();
  });

  [["ficaToggle", "fica"], ["otDedToggle", "otDed"]].forEach(function (x) {
    on($(x[0]), "click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      state.t[x[1]] = b.getAttribute("data-on") === "1" ? 1 : 0;
      renderTaxInputs();
      render();
    });
  });

  /* Bracket editing, delegated: the rows are rebuilt whenever the table changes. */
  on($("secTax"), "input", function (e) {
    var el = e.target;
    if (!el.getAttribute || !el.getAttribute("data-br")) return;
    var key = el.getAttribute("data-br"), i = Number(el.getAttribute("data-i"));
    var rows = state.t[key];
    if (!rows || !rows[i]) return;
    if (el.getAttribute("data-f") === "top") {
      /* Empty means "and everything above" — that is how the open-ended top band
         is expressed, so it has to be a legal value rather than a validation
         error. */
      rows[i][0] = el.value === "" ? null : Number(el.value);
      if (rows[i][0] !== null && !isFinite(rows[i][0])) rows[i][0] = null;
    } else {
      var r = Number(el.value);
      if (el.value === "" || !isFinite(r) || r < 0) return;
      rows[i][1] = r;
    }
    render();
  });

  on($("secTax"), "click", function (e) {
    var del = e.target.closest ? e.target.closest(".br-del") : null;
    if (del) {
      var key = del.getAttribute("data-br"), i = Number(del.getAttribute("data-i"));
      if (state.t[key].length > 1) {
        state.t[key].splice(i, 1);
        renderTaxInputs();
        render();
      }
      return;
    }
    var add = e.target.closest ? e.target.closest("[data-addrow]") : null;
    if (add) {
      var k = add.getAttribute("data-addrow") === "fed" ? "fedBrackets" : "dcBrackets";
      var rows = state.t[k];
      var lastTop = rows.length ? rows[rows.length - 1][0] : 0;
      var lastRate = rows.length ? rows[rows.length - 1][1] : 0;
      /* Insert BEFORE an open-ended top band, so adding a bracket never silently
         deletes the "and everything above" row. */
      if (lastTop === null && rows.length) {
        rows.splice(rows.length - 1, 0, [Math.max(0, rows.length > 1 ? Number(rows[rows.length - 2][0]) + 10000 : 10000), lastRate]);
      } else {
        rows.push([null, lastRate]);
      }
      renderTaxInputs();
      render();
    }
  });

  on($("taxResetBtn"), "click", function () {
    state.t = cloneTax(TAX_DEFAULTS);
    renderTaxInputs();
    render();
    UIKit.toast("税表已恢复到 " + TAX_DEFAULTS.year + " 年的默认值。");
  });

  on($("matchBaseToggle"), "click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    state.a.matchOT = b.getAttribute("data-mot") === "1" ? 1 : 0;
    renderAssumptions();          // moves aria-pressed, which moves the thumb
    render();
  });

  on($("themeToggle"), "click", setTheme);
  on($("copyBtn"), "click", copyTable);
  on($("csvBtn"), "click", exportCSV);
  on($("printBtn"), "click", printSnapshot);
  on($("resetBtn"), "click", doReset);

  /* Row jumps, delegated: the button is the keyboard path, the row is the
     mouse convenience, and both land in the same place. */
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var b = e.target.closest(".hjump");
    if (b) { rememberJumpFocus(b); setHours(b.getAttribute("data-h")); return; }
    var tr = e.target.closest(".table tbody tr[data-h]");
    if (tr) setHours(tr.getAttribute("data-h"));
  });

  /* Donut <-> legend, one active slice shared by both. Delegated, because both
     lists are rebuilt on every render. */
  (function wireMix() {
    var panel = $("secMix");
    if (!panel) return;

    panel.addEventListener("mouseover", function (e) {
      var t = e.target.closest ? e.target.closest(".mix-slice, .mix-row") : null;
      if (t) setMixHover(t.getAttribute("data-key"));
    });
    panel.addEventListener("mouseleave", function () { setMixHover(null); });
    panel.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".mix-slice, .mix-row") : null;
      if (t) toggleMixPin(t.getAttribute("data-key"));
    });
    /* Focus is the keyboard's hover. focusout clears only when focus has actually
       left the panel, not while it moves between two rows. */
    panel.addEventListener("focusin", function (e) {
      var t = e.target.closest ? e.target.closest(".mix-row") : null;
      setMixHover(t ? t.getAttribute("data-key") : null);
    });
    panel.addEventListener("focusout", function (e) {
      if (!panel.contains(e.relatedTarget)) setMixHover(null);
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mixPinned) { mixPinned = null; paintMixActive(); }
    });
  }());

  /* Quick-jump bar. scrollIntoView honours html{scroll-padding-top}, which is
     calc(--topbar-h + 48px) — so the target clears BOTH sticky bars. */
  [].forEach.call(document.querySelectorAll("[data-jump]"), function (b) {
    b.addEventListener("click", function () {
      var t = document.getElementById(b.getAttribute("data-jump"));
      if (t) t.scrollIntoView({ behavior: UIKit.reduceMotion() ? "auto" : "smooth", block: "start" });
    });
  });

  render();
  pushTheme();

  /* UIKit.segmented places the thumb in a microtask, so this has to run after
     that has landed — hence the timer rather than an inline call. If it never
     fires the control degrades to a plain row of labels, which still works. */
  setTimeout(function () { forceRestyle(".seg-thumb"); }, 0);

  /* One entrance, once — and only the hero block, as one unit. riseIn carries
     its own fallback timer, so a throttled tab cannot strand it faded. */
  UIKit.animOnce("intro", document.body) && UIKit.riseIn(
    document.querySelector(".hero-grid > .stat"),
    document.querySelector(".hero-grid > .panel")
  );
}());
