/* ============================================================
   model.js — the compensation and tax model, and nothing else.

   Pure functions over plain objects: no DOM, no storage, no formatting. The
   page loads this before app.js (as window.OTModel); node loads the same file
   with require(), which is what lets tools/model.test.js check every figure on
   a machine with no browser at all — CI runs it on ubuntu.

   The pre-tax part is a line-for-line port of the Backup sheet in
   OT_Compensation_Total_Package_Exhibit.xlsx. Every formula carries the cell it
   came from, because that sheet is the spec and this file is the only place the
   two can drift apart.
   ============================================================ */
(function (root) {
  "use strict";

  /* ILLUSTRATIVE STARTING VALUES — round numbers, not anybody's package.
     The structure and every formula below come from the workbook's Backup sheet
     (cells noted per line); the VALUES are deliberately generic, because this
     repo is public and a calculator whose defaults are the author's real salary
     publishes that salary. Type your own in the 假设 panel once — they are kept
     in this browser's localStorage and never leave the device.

     If you do change these, the expected constants have to change with them —
     the E block at the top of tools/checks.js and tools/model.test.js. Recompute
     them from the formulas, not from what this app prints. */
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
       match. 1/0 rather than true/false on purpose: restoreState() coerces every
       saved assumption to a number and drops anything else, so a boolean would
       silently fail to restore. The workbook includes OT, so 1 is the default. */
    matchOT: 1
  };

  var STEPS = [10, 25, 50, 100];

  /* The schedule never grows past this many rows: a 1-hour step against a
     100k-hour ceiling would otherwise build a table nobody asked for and freeze
     the window while doing it. */
  var MAX_ROWS = 400;

  /* ---------- tax defaults ----------
     2026, single filer. Every one of these is editable in the UI, because the
     point is that next January you look the new numbers up and type them in —
     not that you trust a constant baked in by whoever wrote this.

       Federal brackets + standard deduction  IRS Rev. Proc. 2025-32
       DC brackets                            DC OTR, unchanged since 2022 (not indexed)
       DC standard deduction                  DC OTR 2026 D-40ES booklet
       Social Security wage base              SSA, 2026
       401(k) / IRA / HSA limits              IRS, 2026
       IRA deduction phase-out (covered)      IRS, 2026: $81,000-$91,000 single
       Overtime deduction                     OBBBA (IRC 225), in force 2025-2028

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
    /* Whether DC follows the federal overtime deduction. It has moved year to
       year — DC decoupled for 2025, Congress disapproved the temporary decoupling
       act, and the CFO's 2026 guidance administers 2026 consistent with OBBBA —
       so it is a switch, defaulted to the current guidance, not a rule. */
    dcOtDed: 1,
    otCap: 12500,
    otPhase: 150000,
    c401k: 24500,           // prefilled at the limit, as asked
    c401kLimit: 24500,
    hsa: 4400,              // self-only, prefilled at the limit
    hsaLimit: 4400,
    hsaPayroll: 1,
    ira: 0,
    iraLimit: 7500,
    /* Covered by a workplace retirement plan. Anyone deferring into the 401(k)
       or receiving the profit share is, which is why it defaults on. */
    iraCovered: 1,
    iraPhaseLo: 81000,
    iraPhaseHi: 91000
  };

  var TAX_NUM = ["year", "fedStd", "dcStd", "fica", "ssRate", "ssBase", "medRate",
                 "addMedRate", "addMedThr", "otDed", "dcOtDed", "otCap", "otPhase",
                 "c401k", "c401kLimit", "hsa", "hsaLimit", "hsaPayroll", "ira", "iraLimit",
                 "iraCovered", "iraPhaseLo", "iraPhaseHi"];

  /* The user's own choices — what they contribute and which rules apply to them —
     as opposed to the TABLE (rates, bands, limits, thresholds), which is the same
     for everyone in a given year. A new year's defaults replace the table and
     leave these alone, and so does 恢复默认税表. */
  var TAX_PERSONAL = ["c401k", "hsa", "hsaPayroll", "ira", "iraCovered", "fica", "otDed", "dcOtDed"];

  function clone(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }

  /* The bracket arrays are nested, so a shallow clone would hand every reset the
     same rows the user had already edited. */
  function cloneTax(o) {
    var r = clone(o);
    r.fedBrackets = o.fedBrackets.map(function (b) { return [b[0], b[1]]; });
    r.dcBrackets = o.dcBrackets.map(function (b) { return [b[0], b[1]]; });
    return r;
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
     number when the assumptions make it meaningless (PTO at or near a full
     year): a plausible-looking wrong divisor is worse than a dash plus a
     warning. */
  function workWeeks(a) {
    if (!(a.stdHours > 0)) return NaN;
    var perWeek = a.stdHours / 52;
    var w = 52 - (Math.max(0, a.ptoHours || 0) / perWeek);
    return w >= 0.5 ? w : NaN;
  }

  /* Annual hours actually worked, PTO removed and overtime added. Undefined on
     exactly the same condition as workWeeks — one predicate, so the page can
     never show a per-hour figure next to a "no working weeks" message. */
  function workedHours(a, h) {
    if (!isFinite(workWeeks(a))) return NaN;
    return a.stdHours - Math.max(0, a.ptoHours || 0) + h;
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
    var worked = workedHours(a, h);
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
      workedHours: worked,
      effHourly: cash / worked,
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

  /* How many rows the schedule WANTS (0, step, 2*step ... up to maxH), before the
     cap. The truncation warning compares this, not maxH / step, with MAX_ROWS:
     0..4000 at a step of 10 is 401 rows, not 400. */
  function scheduleRowCount(a) {
    var step = a.step > 0 ? a.step : 25, max = a.maxH > 0 ? a.maxH : 0;
    return Math.floor(max / step) + 1;
  }

  function schedule(a) {
    var rows = [], step = a.step > 0 ? a.step : 25, h = 0;
    var max = a.maxH > 0 ? a.maxH : 0;
    while (h <= max && rows.length < MAX_ROWS) { rows.push(compute(a, h)); h += step; }
    return rows;
  }

  /* ---------- tax ----------
     Deliberately downstream of everything above: computeTax() READS a pre-tax
     result and never feeds back into it, so the workbook model stays exactly what
     the workbook says no matter what happens in here. */

  function bracketTax(income, brackets) {
    /* NaN in, NaN out. With standard hours at 0 the wages are undefined, and
       answering "$0 tax" for an undefined income is exactly the plausible wrong
       number the guard on rates() exists to prevent. */
    if (!isFinite(income)) return NaN;
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

  /* The ways a bracket table can be typed that bracketTax will read differently
     from how it looks — it never guesses, it skips — so the page can say so
     instead of quietly taxing a different table. */
  function bracketIssues(rows) {
    var out = [], lower = 0;
    for (var i = 0; i < rows.length; i++) {
      var top = rows[i][0];
      if (top === null || top === undefined) {
        if (i < rows.length - 1) out.push({ i: i, kind: "open-not-last" });
        break;                                        // everything after an open band is unreachable
      }
      if (top <= lower) { out.push({ i: i, kind: "not-ascending" }); continue; }
      lower = top;
    }
    return out;
  }

  /* The traditional-IRA deduction limit for someone covered by a workplace plan.
     The MAGI here is AGI figured WITHOUT the IRA deduction itself (IRC
     219(g)(3)(A)) — measured after it, a contribution could argue its own way
     back under the band. Across the band the limit shrinks in proportion; the
     reduction is rounded DOWN to $10, and a limit that survives at all is at
     least $200 (219(g)(2)(B),(C)). */
  function iraDeductionLimit(magi, t) {
    var limit = Math.max(0, t.iraLimit || 0);
    if (!t.iraCovered) return limit;
    var lo = t.iraPhaseLo, hi = t.iraPhaseHi;
    if (!(magi > lo)) return limit;
    if (!(hi > lo) || magi >= hi) return 0;
    var cut = Math.floor(limit * (magi - lo) / (hi - lo) / 10 + 1e-9) * 10;
    var left = Math.max(0, limit - cut);
    return left > 0 && left < 200 ? 200 : left;
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

    /* A nondeductible IRA contribution still leaves the pay packet — take-home
       subtracts the full amount below — it just does not cut the tax. */
    var iraMagi = Math.max(0, fedWages - (hsaPayroll ? 0 : hsa));
    var iraCap = iraDeductionLimit(iraMagi, t);
    var iraDeduction = Math.min(ira, iraCap);
    var agi = Math.max(0, iraMagi - iraDeduction);

    /* Qualified overtime compensation (IRC 225(c)) is overtime that section 7 of
       the FLSA REQUIRES, and only the part above the regular rate. The FLSA
       requires time-and-a-half, so at most half the regular rate per hour
       qualifies: at a 2x policy rate the second half-rate of premium is the
       employer's, not the statute's. An FLSA-exempt employee has none at all,
       whatever they are paid — that is what the otDed switch is for. */
    var qualMult = Math.max(0, Math.min(a.otMult, 1.5) - 1);
    var otPremium = Math.max(0, c.h * c.stdHourly * qualMult);

    /* IRC 225(b): the deduction is the smaller of that premium and $12,500, and
       THAT amount is reduced by $100 for every full $1,000 of MAGI over $150,000.
       Two things the statute and Schedule 1-A (lines 15-21) are exact about and
       that are easy to get backwards: the reduction comes off the deduction, not
       off the $12,500 cap — cutting the cap leaves anyone whose premium is under
       it untouched until the cap falls below the premium — and a partial $1,000
       does not count (line 19: "decrease the result to the next lower whole
       number"; rounding up is the car-loan deduction's rule, not this one's). */
    var over = Math.max(0, agi - t.otPhase);
    var otAllowed = Math.min(otPremium, Math.max(0, t.otCap));
    var otReduction = Math.floor(over / 1000 + 1e-9) * 100;
    var otYearOk = t.year >= 2025 && t.year <= 2028;    // enacted for 2025 through 2028
    var otDeduction = t.otDed && otYearOk ? Math.max(0, otAllowed - otReduction) : 0;

    var fedTaxable = Math.max(0, agi - t.fedStd - otDeduction);
    /* DC starts from federal AGI; whether it takes the overtime deduction too is
       the dcOtDed switch (see TAX_DEFAULTS). */
    var dcTaxable = Math.max(0, agi - t.dcStd - (t.dcOtDed ? otDeduction : 0));

    var fedTax = bracketTax(fedTaxable, t.fedBrackets);
    var dcTax = bracketTax(dcTaxable, t.dcBrackets);
    var totalTax = fedTax + dcTax + fica;

    return {
      wages: wages, k401: k401, hsa: hsa, ira: ira,
      fica: fica, ss: ss, med: med, ficaWages: ficaWages,
      iraMagi: iraMagi, iraCap: iraCap, iraDeduction: iraDeduction,
      agi: agi, otPremium: otPremium, otAllowed: otAllowed, otReduction: otReduction,
      otYearOk: otYearOk, otDeduction: otDeduction,
      fedTaxable: fedTaxable, dcTaxable: dcTaxable,
      fedTax: fedTax, dcTax: dcTax, totalTax: totalTax,
      takeHome: wages - k401 - hsa - ira - totalTax,
      effRate: wages > 0 ? totalTax / wages : NaN
    };
  }

  /* The rate on the NEXT dollar of ordinary wages, measured rather than derived
     from the bracket table — that way it automatically accounts for FICA, the
     wage base and additional Medicare all at once. An overtime dollar is taxed
     differently (see otNetPerHour). */
  function marginalRate(c, a, t) {
    var step = 1000;
    var bumped = {};
    for (var k in c) if (c.hasOwnProperty(k)) bumped[k] = c[k];
    bumped.cash = c.cash + step;
    var lo = computeTax(c, a, t), hi = computeTax(bumped, a, t);
    return (hi.totalTax - lo.totalTax) / step;
  }

  /* What one more overtime hour actually leaves after every tax it touches. NOT
     otHourly x (1 - marginalRate): part of an overtime dollar is qualified
     premium, which the overtime deduction takes back out of taxable income, so
     it is taxed less than the ordinary dollar marginalRate measures. Measured by
     difference, over $1,000 of overtime pay rather than one hour, because the
     OBBBA phase-out moves in $100 steps per $1,000 of MAGI and a one-hour
     difference would jump. */
  function otNetPerHour(a, t, h) {
    var c0 = compute(a, h);
    if (!(c0.otHourly > 0)) return NaN;
    var dh = 1000 / c0.otHourly;
    var c1 = compute(a, h + dh);
    return (computeTax(c1, a, t).takeHome - computeTax(c0, a, t).takeHome) / dh;
  }

  /* ---------- persistence ----------
     The page owns localStorage; this owns what a saved blob MEANS, so it can be
     tested without a browser. */

  var STORE_VERSION = 2;
  /* Saves made before the version stamp existed were all made against the 2026
     table — it is the only one that ever shipped without one. */
  var LEGACY_TABLE_YEAR = 2026;

  /* Number(null) and Number("") are both 0, and 0 is finite — so a stored null
     would quietly become a $0 salary. Only a real number, or a non-empty numeric
     string, counts as a value. */
  function num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") return Number(v);
    return NaN;
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
      var top = row[0] === null || row[0] === undefined ? null : num(row[0]);
      var rate = num(row[1]);
      if (top !== null && (!isFinite(top) || top < 0)) continue;
      if (!isFinite(rate) || rate < 0) continue;
      out.push([top, rate]);
    }
    return out.length ? out : fallback;
  }

  function freshState() {
    return { a: clone(DEFAULTS), t: cloneTax(TAX_DEFAULTS), h: 250, prec: 0, target: 25 };
  }

  /* Turn a parsed saved blob back into a state. Anything missing, malformed or
     out of shape falls back to the default for that field alone.

     The tax TABLE is stamped with the defaults year it was saved against. When
     this build ships a newer table, a returning visitor gets it — without that,
     save() having stored the whole table on their first visit would pin them to
     it forever, whether or not they ever opened the editor. Their own choices
     (TAX_PERSONAL) carry over. The one exception is a 401(k) or HSA figure that
     sat exactly at an ordinary old limit: that is what "prefilled at the limit"
     meant, so it follows the limit up. A limit the user had raised past this
     year's default (a catch-up) is theirs and is left alone. `taxUpdatedFrom` and
     `taxMoved` tell the page to say what happened. */
  function restoreState(saved) {
    var s = freshState();
    s.taxUpdatedFrom = null;
    s.taxMoved = [];
    if (!saved || typeof saved !== "object") return s;

    if (saved.a && typeof saved.a === "object") {
      for (var k in DEFAULTS) {
        if (!DEFAULTS.hasOwnProperty(k)) continue;
        var v = num(saved.a[k]);
        if (isFinite(v)) s.a[k] = v;
      }
    }
    if (STEPS.indexOf(s.a.step) === -1) s.a.step = DEFAULTS.step;

    if (saved.t && typeof saved.t === "object") {
      var tv = num(saved.tv);
      if (!isFinite(tv)) tv = LEGACY_TABLE_YEAR;
      var stale = tv < TAX_DEFAULTS.year;
      var keys = stale ? TAX_PERSONAL : TAX_NUM;
      for (var j = 0; j < keys.length; j++) {
        var tk = keys[j], x = num(saved.t[tk]);
        if (isFinite(x)) s.t[tk] = x;
      }
      if (stale) {
        [["c401k", "c401kLimit"], ["hsa", "hsaLimit"]].forEach(function (p) {
          var was = num(saved.t[p[0]]), oldLimit = num(saved.t[p[1]]), newLimit = TAX_DEFAULTS[p[1]];
          if (isFinite(was) && was === oldLimit && oldLimit <= newLimit && was !== newLimit) {
            s.t[p[0]] = newLimit;
            s.taxMoved.push([p[0], was, newLimit]);
          }
        });
        s.taxUpdatedFrom = tv;
      } else {
        s.t.fedBrackets = sanitizeBrackets(saved.t.fedBrackets, s.t.fedBrackets);
        s.t.dcBrackets = sanitizeBrackets(saved.t.dcBrackets, s.t.dcBrackets);
      }
    }

    var h = num(saved.h);
    if (isFinite(h)) s.h = Math.max(0, Math.round(h));
    if (saved.prec === 2 || saved.prec === 0) s.prec = saved.prec;
    var target = num(saved.target);
    if (isFinite(target)) s.target = Math.max(0, target);
    return s;
  }

  function serializeState(s) {
    return JSON.stringify({
      v: STORE_VERSION, tv: TAX_DEFAULTS.year,
      a: s.a, t: s.t, h: s.h, prec: s.prec, target: s.target
    });
  }

  /* Put the table back to this build's defaults and keep the user's own choices. */
  function resetTaxTable(t) {
    var r = cloneTax(TAX_DEFAULTS);
    TAX_PERSONAL.forEach(function (k) { r[k] = t[k]; });
    return r;
  }

  var api = {
    DEFAULTS: DEFAULTS, STEPS: STEPS, MAX_ROWS: MAX_ROWS,
    TAX_DEFAULTS: TAX_DEFAULTS, TAX_NUM: TAX_NUM, TAX_PERSONAL: TAX_PERSONAL,
    clone: clone, cloneTax: cloneTax,
    rates: rates, workWeeks: workWeeks, workedHours: workedHours, compute: compute,
    roundHalfAway: roundHalfAway, hoursForTarget: hoursForTarget,
    scheduleRowCount: scheduleRowCount, schedule: schedule,
    bracketTax: bracketTax, bracketIssues: bracketIssues, iraDeductionLimit: iraDeductionLimit,
    computeTax: computeTax, marginalRate: marginalRate, otNetPerHour: otNetPerHour,
    num: num, sanitizeBrackets: sanitizeBrackets, freshState: freshState,
    restoreState: restoreState, serializeState: serializeState, resetTaxTable: resetTaxTable
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OTModel = api;
}(typeof window !== "undefined" ? window : this));
