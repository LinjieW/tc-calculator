/* Model tests — web/model.js in plain node, no browser. CI runs this on ubuntu:

     node tools/model.test.js

   Every expected value below was computed INDEPENDENTLY from the rules (the
   workbook's formulas, IRS Rev. Proc. 2025-32, SSA, IRC 219 / 225 and Schedule
   1-A, the DC OTR table) — never read back from this model. The derivation is
   written next to each one, so a failure says which rule moved. If you change
   the shipped defaults, recompute them by hand; do not paste in what the model
   prints, or this becomes a test that agrees with whatever the model does. */
"use strict";
var M = require("../web/model.js");

var fails = 0, passes = 0;
function near(got, want, tol, name) {
  var okv = typeof got === "number" && Math.abs(got - want) <= (tol || 0.005);
  if (okv) passes++; else { fails++; console.log("FAIL " + name + ": got " + got + ", want " + want); }
}
function is(got, want, name) {
  if (got === want) passes++; else { fails++; console.log("FAIL " + name + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); }
}

function A(over) { var a = M.clone(M.DEFAULTS); for (var k in over || {}) a[k] = over[k]; return a; }
function T(over) { var t = M.cloneTax(M.TAX_DEFAULTS); for (var k in over || {}) t[k] = over[k]; return t; }
function tax(a, t, h) { return M.computeTax(M.compute(a, h), a, t); }

/* ---- pre-tax, the workbook (defaults, 250 h) ----
   regular 100,000 / 2,080 = 48.076923; OT rate x1.5 = 72.115385; OT pay 18,028.85;
   cash 100,000 + 18,028.85 + 4,000 = 122,028.85; match 5% x (100,000 + 18,028.85)
   = 5,901.44; profit 2,000; stipend 1,200; total 131,130.29. */
var c = M.compute(A(), 250);
near(c.stdHourly, 48.076923, 1e-6, "regular rate");
near(c.otHourly, 72.115385, 1e-6, "OT rate");
near(c.cash, 122028.846, 0.001, "total cash");
near(c.match, 5901.442, 0.001, "401(k) match (base + OT)");
near(c.total, 131130.288, 0.001, "total package");
near(M.compute(A({ matchOT: 0 }), 250).match, 5000, 1e-9, "401(k) match, base only");
/* Backup!B52: ROUND(MAX(0,(25% x 100,000 - 4,000) / 72.115385), 0) = ROUND(291.2) = 291 */
is(M.hoursForTarget(A(), 0.25), 291, "reverse lookup at 25%");
is(M.hoursForTarget(A(), 0.04), 0, "reverse lookup covered by the bonus alone");
is(M.schedule(A()).length, 26, "schedule rows 0..625 step 25");
/* 0..4000 step 10 wants 401 rows; the cap is 400, so the warning must fire. */
is(M.scheduleRowCount(A({ maxH: 4000, step: 10 })), 401, "row count before the cap");
is(M.schedule(A({ maxH: 4000, step: 10 })).length, 400, "schedule capped");
/* PTO 80 h: 52 - 80/40 = 50 working weeks; worked 2,080 - 80 + 250 = 2,250 h. */
near(M.workWeeks(A()), 50, 1e-9, "working weeks");
near(c.workedHours, 2250, 1e-9, "worked hours");
/* PTO within half a week of the whole year: no working weeks, and no worked
   hours either — one predicate for both. */
is(isFinite(M.workedHours(A({ ptoHours: 2070 }), 0)), false, "worked hours undefined when weeks are");

/* ---- tax at the defaults ----
   FICA wages 122,028.85 - 4,400 (payroll HSA) = 117,628.85: SS 6.2% = 7,292.99,
   Medicare 1.45% = 1,705.62, FICA 8,998.61.
   AGI 122,028.85 - 24,500 - 4,400 = 93,128.85. OT premium 250 x 48.076923 x 0.5
   = 6,009.62, under the 12,500 cap, MAGI under 150,000: deduction 6,009.62.
   Federal taxable 93,128.85 - 16,100 - 6,009.62 = 71,019.23:
     1,240 + 4,560 + 22% x 20,619.23 = 10,336.23.
   DC (follows the OT deduction by default) taxable 71,019.23:
     400 + 1,800 + 1,300 + 8.5% x 11,019.23 = 4,436.63.
   Take-home 122,028.85 - 24,500 - 4,400 - 23,771.47 = 69,357.37. */
var x = tax(A(), T(), 250);
near(x.fica, 8998.607, 0.001, "FICA");
near(x.agi, 93128.846, 0.001, "AGI");
near(x.otDeduction, 6009.615, 0.001, "OT deduction");
near(x.fedTax, 10336.231, 0.001, "federal tax");
near(x.dcTax, 4436.635, 0.001, "DC tax");
near(x.takeHome, 69357.374, 0.001, "take-home");
near(tax(A(), T({ dcOtDed: 0 }), 250).dcTax, 4947.452, 0.001, "DC tax without the OT deduction");
/* Marginal rate on an ORDINARY dollar: 7.65 + 22 + 8.5 = 38.15%. */
near(M.marginalRate(M.compute(A(), 250), A(), T()), 0.3815, 1e-9, "marginal rate");
/* One more OT hour: 72.1154 - 7.65% x 72.1154 - (22% + 8.5%) x (72.1154 - 24.0385)
   = 72.1154 - 5.5168 - 14.6635 = 51.9351. */
near(M.otNetPerHour(A(), T(), 250), 51.935, 0.001, "net per OT hour");

/* ---- the OBBBA overtime deduction (IRC 225, Schedule 1-A lines 15-21) ---- */
/* Only the FLSA's half-rate premium qualifies: at 2x it is still 250 x 48.0769 x 0.5. */
near(tax(A({ otMult: 2 }), T(), 250).otPremium, 6009.615, 0.001, "premium capped at the FLSA half-rate");
is(tax(A({ otMult: 1 }), T(), 250).otPremium, 0, "no premium at straight time");
/* Base 200,000, 250 h: premium 250 x 96.1538 x 0.5 = 12,019.23 (under 12,500).
   AGI 200,000 + 36,057.69 + 4,000 - 24,500 - 4,400 = 211,157.69; over 61,157.69 ->
   61 full thousands (round DOWN) -> 6,100 off the DEDUCTION: 12,019.23 - 6,100 = 5,919.23.
   (Cutting the cap instead would give min(12,019.23, 6,300) = 6,300.) */
var b200 = tax(A({ base: 200000 }), T(), 250);
near(b200.otReduction, 6100, 1e-9, "phase-out rounds down to whole thousands");
near(b200.otDeduction, 5919.23, 0.005, "phase-out comes off the deduction, not the cap");
/* Base 231,000, 100 h: premium 5,552.88; AGI 222,758.65 -> 72 x 100 = 7,200 >= premium -> 0. */
near(tax(A({ base: 231000 }), T(), 100).otDeduction, 0, 1e-9, "deduction phased out completely");
/* The window: 2025-2028 only. */
is(tax(A(), T({ year: 2029 }), 250).otDeduction, 0, "no OT deduction after 2028");
is(tax(A(), T({ otDed: 0 }), 250).otDeduction, 0, "switched off (FLSA-exempt)");
/* Boundaries, premium well over the cap (base 150k, 625 h: premium 22,536.06). */
(function () {
  var a = A({ base: 150000 }), t = T();
  function dedAt(agiTarget) {
    // shift the bonus so AGI lands exactly on agiTarget
    var base = tax(a, t, 625), shift = agiTarget - base.agi;
    return tax(A({ base: 150000, bonus: a.bonus + shift }), t, 625).otDeduction;
  }
  near(dedAt(150999), 12500, 0.01, "MAGI 150,999: nothing off");
  near(dedAt(151000), 12400, 0.01, "MAGI 151,000: 100 off");
  near(dedAt(274999), 100, 0.01, "MAGI 274,999: 124 x 100 off");
  near(dedAt(275000), 0, 0.01, "MAGI 275,000: fully phased out");
}());

/* ---- traditional IRA (IRC 219(g), 2026 single, covered: 81,000-91,000) ---- */
/* Defaults + IRA 7,500: MAGI before the IRA 93,128.85 >= 91,000 -> 0 deductible;
   tax unchanged, take-home 69,357.37 - 7,500 = 61,857.37. */
var ira = tax(A(), T({ ira: 7500 }), 250);
near(ira.iraMagi, 93128.846, 0.001, "IRA MAGI is before the IRA deduction");
is(ira.iraDeduction, 0, "IRA fully nondeductible past the band");
near(ira.takeHome, 61857.374, 0.001, "nondeductible IRA still leaves take-home");
is(tax(A(), T({ ira: 7500, iraCovered: 0 }), 250).iraDeduction, 7500, "not covered: fully deductible");
/* MAGI 86,000: cut 7,500 x 5,000/10,000 = 3,750 -> 3,750 deductible. */
is(M.iraDeductionLimit(86000, T()), 3750, "halfway through the band");
/* MAGI 86,004: cut 3,753 -> rounded DOWN to 3,750 -> 3,750 (the $10 rule). */
is(M.iraDeductionLimit(86004, T()), 3750, "reduction rounded down to $10");
/* MAGI 90,950: cut 7,462.5 -> 7,460 -> 40 left -> the $200 floor. */
is(M.iraDeductionLimit(90950, T()), 200, "$200 floor");
is(M.iraDeductionLimit(81000, T()), 7500, "at the start of the band: full");
is(M.iraDeductionLimit(91000, T()), 0, "at the end of the band: none");

/* ---- undefined wages stay undefined ---- */
var bad = tax(A({ stdHours: 0 }), T(), 250);
is(isFinite(bad.fedTax) || isFinite(bad.dcTax) || isFinite(bad.takeHome), false, "stdHours 0: no tax figures, not $0");
is(isFinite(M.marginalRate(M.compute(A({ stdHours: 0 }), 250), A({ stdHours: 0 }), T({ fica: 0 }))), false, "stdHours 0: no marginal rate");

/* ---- FICA edges ---- */
/* Base 250,000, no OT, no bonus, no contributions: SS on 184,500 = 11,439; Medicare
   1.45% x 250,000 + 0.9% x 50,000 = 4,075. */
var hi = tax(A({ base: 250000, bonus: 0 }), T({ c401k: 0, hsa: 0 }), 0);
near(hi.ss, 11439, 1e-6, "Social Security wage base");
near(hi.med, 4075, 1e-6, "Additional Medicare over 200,000");

/* ---- brackets ---- */
near(M.bracketTax(200000, M.TAX_DEFAULTS.fedBrackets), 40598, 1e-6, "federal bands to 200,000");
near(M.bracketTax(200000, M.TAX_DEFAULTS.dcBrackets), 15400, 1e-6, "DC bands to 200,000");
near(M.bracketTax(12400, M.TAX_DEFAULTS.fedBrackets), 1240, 1e-9, "income exactly at a ceiling");
is(M.bracketIssues(M.TAX_DEFAULTS.fedBrackets).length, 0, "shipped table is clean");
is(JSON.stringify(M.bracketIssues([[100, 10], [50, 20], [null, 30]])), '[{"i":1,"kind":"not-ascending"}]', "ceiling out of order");
is(JSON.stringify(M.bracketIssues([[100, 10], [null, 20], [300, 30]])), '[{"i":1,"kind":"open-not-last"}]', "open band in the middle");

/* ---- saved state ---- */
var fresh = M.restoreState(null);
is(fresh.a.base, 100000, "no saved state: defaults");
/* null is not zero */
var s1 = M.restoreState({ a: { base: null, bonus: "" }, h: null });
is(s1.a.base, 100000, "null salary is ignored, not 0");
is(s1.a.bonus, 4000, "empty-string bonus is ignored, not 0");
is(s1.h, 250, "null hours ignored");
is(M.restoreState({ a: { base: "120000" } }).a.base, 120000, "numeric string accepted");
is(M.restoreState({ a: { step: 7 } }).a.step, 25, "unknown step falls back");
/* a round trip */
var st = M.freshState(); st.a.base = 123456; st.t.c401k = 10000; st.t.fedStd = 20000; st.h = 300; st.prec = 2;
var back = M.restoreState(JSON.parse(M.serializeState(st)));
is(back.a.base, 123456, "round trip: assumption");
is(back.t.fedStd, 20000, "round trip: same-year table edit kept");
is(back.t.c401k, 10000, "round trip: contribution");
is(back.h + "/" + back.prec, "300/2", "round trip: hours and precision");
is(back.taxUpdatedFrom, null, "round trip: no update notice");
/* legacy blob (no stamp) is the 2026 table: kept as-is */
is(M.restoreState({ t: { fedStd: 20000 } }).t.fedStd, 20000, "legacy blob keeps its (2026) table");
/* a blob stamped with an OLDER year: table replaced, personal choices kept, a
   contribution that sat at the old limit follows the new one */
var old = { tv: M.TAX_DEFAULTS.year - 1,
            t: { fedStd: 1, ssBase: 1, c401k: 23500, c401kLimit: 23500, hsa: 1000, hsaLimit: 4300,
                 ira: 7000, otDed: 0, fedBrackets: [[1, 99], [null, 99]] } };
var mig = M.restoreState(old);
is(mig.taxUpdatedFrom, M.TAX_DEFAULTS.year - 1, "stale table reported");
is(mig.t.fedStd, M.TAX_DEFAULTS.fedStd, "stale table replaced (std deduction)");
is(mig.t.ssBase, M.TAX_DEFAULTS.ssBase, "stale table replaced (wage base)");
is(mig.t.fedBrackets[0][0], M.TAX_DEFAULTS.fedBrackets[0][0], "stale table replaced (brackets)");
is(mig.t.c401k, M.TAX_DEFAULTS.c401kLimit, "401(k) at the old limit moves to the new limit");
is(JSON.stringify(mig.taxMoved), JSON.stringify([["c401k", 23500, M.TAX_DEFAULTS.c401kLimit]]), "the move is reported");
/* a limit raised past this year's default is a catch-up, not a stale limit */
var cu = M.restoreState({ tv: M.TAX_DEFAULTS.year - 1, t: { c401k: 31000, c401kLimit: 31000 } });
is(cu.t.c401k + "/" + cu.taxMoved.length, "31000/0", "catch-up contribution left alone");
is(mig.t.hsa, 1000, "HSA below its old limit is kept");
is(mig.t.ira + "/" + mig.t.otDed, "7000/0", "personal choices kept");
/* corrupt brackets fall back */
is(M.restoreState({ tv: M.TAX_DEFAULTS.year, t: { fedBrackets: "x" } }).t.fedBrackets.length, 7, "corrupt brackets ignored");
/* 恢复默认税表 keeps personal choices */
var rt = M.resetTaxTable(T({ c401k: 10000, otDed: 0, fedStd: 1 }));
is(rt.c401k + "/" + rt.otDed + "/" + rt.fedStd, "10000/0/" + M.TAX_DEFAULTS.fedStd, "table reset keeps personal choices");

console.log((fails ? "FAILED " : "ok ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
