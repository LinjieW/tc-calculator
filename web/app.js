/* ============================================================
   app.js — the page: formatting, rendering and input wiring.

   The model itself (the workbook's formulas, the tax rules, what a saved blob
   means) is web/model.js, which loads first and which tools/model.test.js runs
   in node.
   ============================================================ */
(function () {
  "use strict";

  /* The model — every formula, the tax rules, and what a saved blob means — is
     web/model.js, loaded first. This file is the page: formatting, rendering,
     and wiring the inputs to the model. */
  var M = window.OTModel;
  var DEFAULTS = M.DEFAULTS, STEPS = M.STEPS, TAX_DEFAULTS = M.TAX_DEFAULTS;
  var clone = M.clone, rates = M.rates, workWeeks = M.workWeeks, compute = M.compute;
  var hoursForTarget = M.hoursForTarget, schedule = M.schedule;
  var computeTax = M.computeTax, marginalRate = M.marginalRate, otNetPerHour = M.otNetPerHour;

  /* ---------- storage ---------- */

  /* The key predates the version stamp that now lives INSIDE the blob (see
     serializeState); it is kept so that figures saved by earlier builds carry
     over instead of vanishing. */
  var STORE = "ot_calc_v1";

  var state = M.freshState();
  /* Set by load() when the saved tax table was older than this build's defaults
     and has just been replaced by them; the page says so once, after the first
     render. */
  var taxUpdatedFrom = null, taxMoved = [];

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    var s = M.restoreState(saved);
    taxUpdatedFrom = s.taxUpdatedFrom;
    taxMoved = s.taxMoved;
    delete s.taxUpdatedFrom;
    delete s.taxMoved;
    state = s;
  }

  function save() {
    try { localStorage.setItem(STORE, M.serializeState(state)); } catch (e) { /* private window, quota */ }
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

  /* Every message the page speaks goes through here. The kit's toast element is
     display:none between messages and gets its text in the same task that
     reveals it, which screen readers do not reliably announce; a visually hidden
     status region that is always in the tree does. Messages from one render are
     QUEUED and spoken together — two calls in a row used to overwrite each other
     before either was read. The region is cleared first and refilled a beat
     later, so the same message twice in a row is still announced. */
  var announceQueue = [], announceTimer = null;
  function announce(msg) {
    var r = $("srStatus");
    if (!r || !msg) return;
    if (announceQueue.indexOf(msg) === -1) announceQueue.push(msg);
    if (announceTimer) return;
    r.textContent = "";
    announceTimer = setTimeout(function () {
      r.textContent = announceQueue.join(" ");
      announceQueue = [];
      announceTimer = null;
    }, 30);
  }

  function toast(msg, bad) {
    var el = UIKit.toast(msg, !!bad);
    announce(msg);
    return el;
  }

  /* 撤销 lives next to the button that did the reset, not inside the toast: the
     kit's toast leaves on a fixed 3.6 s timer whether or not it has focus, and it
     sits at the end of the page — 14 to 54 Tab stops away. Here it is the very
     next stop after the reset button, and it stays for 10 s. Undo hands focus
     back to the reset button. */
  var undoTimers = {};
  function offerUndo(btnId, resetBtnId, run) {
    var b = $(btnId);
    if (!b) return;
    clearTimeout(undoTimers[btnId]);
    b.hidden = false;
    b.onclick = function () {
      clearTimeout(undoTimers[btnId]);
      b.hidden = true;
      run();
      var r = $(resetBtnId);
      if (r) r.focus();
    };
    undoTimers[btnId] = setTimeout(function () {
      var hadFocus = document.activeElement === b;
      b.hidden = true;
      if (hadFocus && $(resetBtnId)) $(resetBtnId).focus();
    }, 10000);
  }

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
    txt("matchBaseNote", withOT ? "原表口径" : "与原表口径不同");
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

  function renderNumbers(c, tx) {
    var d = displayOf(c, state.a);
    txt("heroVal", money(d.total));
    /* The take-home figure is the one most people came for, and on a first visit
       its own section starts below the fold — so the hero carries it too. */
    txt("heroSub", isFinite(d.total)
      ? "在 " + hrs(d.h) + " 加班下，总现金薪酬 " + money(d.cash) + " + 雇主福利 " + money(d.benefits) + "。"
      : "请先填写有效的基本工资与标准年工时。");
    txt("heroTake", isFinite(d.total) && isFinite(tx.home) ? "税后到手约 " + money(tx.home) + "（估算，见下方「税后」）" : "");

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
    var a = state.a, w = workWeeks(a), pto = Math.max(0, a.ptoHours || 0);
    /* Name the actual cause. With standard hours at 0 there are no weeks either,
       and blaming PTO for that sends the reader to the wrong field. */
    txt("dialNote", isFinite(w)
      ? "按 " + (Math.round(w * 10) / 10) + " 个工作周折算（一年 52 周，减去 " + nf(0).format(pto) +
        " 小时 PTO）。滑杆与两个输入框始终同步；下方「显示步长」只决定明细表每行的间隔。"
      : !(a.stdHours > 0)
        ? "标准年工时为 0，没有可用的工作周，折合每周无法计算。"
        : "PTO 几乎占满了标准年工时，没有可用的工作周，折合每周无法计算。");
  }

  var lastWarn = "";
  function renderWarnings() {
    var a = state.a, msgs = [];
    var bad = { aBase: !(a.base > 0), aHours: !(a.stdHours > 0),
                aPto: a.stdHours > 0 && !isFinite(workWeeks(a)) };
    if (bad.aBase) msgs.push("基本工资必须大于 0，否则时薪与等效年终奖都无法计算。");
    if (bad.aHours) msgs.push("标准年工时必须大于 0。");
    if (M.scheduleRowCount(a) > M.MAX_ROWS) msgs.push("明细表上限相对步长过大，表格已截断到 " + M.MAX_ROWS + " 行。");
    if (state.h > a.maxH) msgs.push("当前加班小时超出了明细表上限，曲线与表格只画到上限为止。");
    if (bad.aPto)
      msgs.push("PTO 几乎占满了标准年工时，没有工作周可言，「折合每工作周」和「实际时薪」都算不出来。");

    /* The message box sits near the top of the page and the field that caused it
       can be a dozen screens further down on a phone, so the FIELD is marked too —
       visibly (the kit's .invalid) and for AT (aria-invalid). */
    for (var id in bad) {
      if (!bad.hasOwnProperty(id) || !els[id]) continue;
      els[id].classList.toggle("invalid", bad[id]);
      if (bad[id]) els[id].setAttribute("aria-invalid", "true"); else els[id].removeAttribute("aria-invalid");
    }

    var box = els.warnBox, text = msgs.join(" ");
    if (text !== lastWarn && text) announce(text);
    lastWarn = text;
    if (!box) return;
    if (!msgs.length) { box.hidden = true; box.textContent = ""; return; }
    box.hidden = false;
    box.textContent = text;
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

  /* Neither table depends on the selected hours — only on the assumptions, the
     precision and (for the reverse table) the target — so a slider drag rebuilds
     neither; markCurrent moves the highlight. At the 400-row cap a rebuild per
     input event is what made a drag miss its frames. */
  var schedKey = null, revKey = null;

  function renderSchedule() {
    var t = els.schedTable;
    if (!t) return;
    var key = JSON.stringify(state.a) + "|" + state.prec;
    if (key === schedKey) return;
    schedKey = key;
    var rows = schedule(state.a);
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
    var key = JSON.stringify(state.a) + "|" + state.prec + "|" + state.target;
    if (key === revKey) return;
    revKey = key;
    var body = t.tBodies[0], html = "", i;
    for (i = 10; i <= 50; i += 5) {
      var need = hoursForTarget(state.a, i / 100);
      var c = compute(state.a, isFinite(need) ? need : 0);
      var d = displayOf(c, state.a);
      html += "<tr" + (isFinite(need) ? ' data-h="' + need + '"' : "") + ">" +
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
  /* Remembered by ROW, not by hour value: in the reverse table several targets
     can need the same number of hours (every target the bonus alone already
     covers needs 0 h), and looking the button up by its hours hands focus to the
     first of them rather than the one that was pressed. */
  var pendingFocus = null;
  function rememberJumpFocus(btn) {
    var tr = btn && btn.closest("tr"), table = btn && btn.closest("table");
    pendingFocus = tr && table ? { table: table.id, row: tr.sectionRowIndex } : null;
  }
  /* Only ever GIVES BACK focus that the rebuild took away — i.e. when it is on
     <body>. A restore left armed by a jump that turned out to be a no-op used to
     fire on the next unrelated render and yank focus out of whatever field the
     user had moved on to. */
  function restoreJumpFocus() {
    if (!pendingFocus) return;
    var p = pendingFocus;
    pendingFocus = null;
    var a = document.activeElement;
    if (a && a !== document.body) return;
    var t = document.getElementById(p.table);
    var tr = t && t.tBodies[0] && t.tBodies[0].rows[p.row];
    var b = tr && tr.querySelector(".hjump");
    if (b) b.focus();
  }

  /* Only rows that STAND FOR an hour count. The waterfall and the bracket tables
     have no data-h, and Number(null) is 0 — so at 0 overtime hours every one of
     their rows used to light up as "current". */
  function markCurrent() {
    [].forEach.call(document.querySelectorAll(".table tbody tr[data-h]"), function (tr) {
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
  function clearMixSelection() {
    mixPinned = null;
    mixHover = null;
    paintMixActive();
  }
  function toggleMixPin(key) {
    if (mixPinned === key) { clearMixSelection(); return; }
    mixPinned = key;
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
    iraPhaseLo: "iraPhaseLo", iraPhaseHi: "iraPhaseHi",
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

  /* The fields, switches and labels — everything EXCEPT the bracket rows. Kept
     apart because the blur handlers call this: rebuilding the bracket <tbody>
     on blur replaced the very input focus was moving into, so Tab from 联邦标准
     扣除 landed on <body> and the next Tab went back to the top of the page. */
  function renderTaxFields() {
    for (var id in TAX_FIELDS) {
      if (!TAX_FIELDS.hasOwnProperty(id)) continue;
      var el = $(id);
      if (el && document.activeElement !== el) el.value = String(state.t[TAX_FIELDS[id]]);
    }
    var cb = $("cHsaPayroll");
    if (cb) cb.checked = !!state.t.hsaPayroll;
    var cov = $("cIraCovered");
    if (cov) cov.checked = !!state.t.iraCovered;

    [["ficaToggle", "fica", "ficaNote"], ["otDedToggle", "otDed", "otDedNote"],
     ["dcOtDedToggle", "dcOtDed", "dcOtDedNote"]].forEach(function (x) {
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
    /* Named from the defaults this build ships, not hard-coded in the markup — a
       2027 build would otherwise offer to "restore 2026" and do something else. */
    txt("taxResetBtn", "恢复 " + TAX_DEFAULTS.year + " 默认税表");
    txt("dcSubNote", "taxable = AGI − DC 标准扣除" + (state.t.dcOtDed ? " − 加班扣除" : ""));
  }

  function renderTaxInputs() {
    renderTaxFields();
    renderBrackets("fedBrackets", "fedBrackets");
    renderBrackets("dcBrackets", "dcBrackets");
  }

  /* bracketTax never guesses at a mistyped table — it skips what it cannot read —
     so say what it skipped, next to the table. */
  var lastBrWarn = {};
  function renderBracketHints() {
    [["fedBrackets", "fedBrHint"], ["dcBrackets", "dcBrHint"]].forEach(function (x) {
      var el = $(x[1]);
      if (!el) return;
      var issues = M.bracketIssues(state.t[x[0]]);
      var msgs = issues.map(function (p) {
        return p.kind === "open-not-last"
          ? "第 " + (p.i + 1) + " 档上限留空表示「以上全部」，它后面的档都不会参与计算——只有最后一档可以留空。"
          : "第 " + (p.i + 1) + " 档上限不高于上一档，这一档没有参与计算。";
      });
      el.hidden = !msgs.length;
      el.textContent = msgs.join(" ");
      /* Same treatment as every other warning: marked on the offending ceiling
         and spoken once when it changes. */
      var bad = issues.map(function (p) { return p.i; });
      [].forEach.call(document.querySelectorAll("#" + x[0] + ' input[data-f="top"]'), function (inp) {
        var on = bad.indexOf(Number(inp.getAttribute("data-i"))) !== -1;
        inp.classList.toggle("invalid", on);
        if (on) { inp.setAttribute("aria-invalid", "true"); inp.setAttribute("aria-describedby", x[1]); }
        else { inp.removeAttribute("aria-invalid"); inp.removeAttribute("aria-describedby"); }
      });
      var text = el.textContent;
      if (text && text !== lastBrWarn[x[0]]) announce(text);
      lastBrWarn[x[0]] = text;
    });
  }

  /* The tax result in display space: quantized the same way the rest of the page
     is, with take-home the SUM of the lines above it rather than a separately
     rounded figure — same rule, same reason (see displayOf). */
  function taxDisplay(c) {
    var x = computeTax(c, state.a, state.t);
    var wages = q(x.wages), k401 = q(x.k401), hsa = q(x.hsa), ira = q(x.ira);
    var fed = q(x.fedTax), dc = q(x.dcTax), fica = q(x.fica);
    var taxSum = fed + dc + fica;
    return { x: x, wages: wages, k401: k401, hsa: hsa, ira: ira, fed: fed, dc: dc, fica: fica,
             taxSum: taxSum, home: wages - k401 - hsa - ira - taxSum };
  }

  var lastContribWarn = "";
  function renderTax(c, tx) {
    var t = state.t, x = tx.x;
    var wages = tx.wages, home = tx.home, taxSum = tx.taxSum;

    txt("tHome", money(home));
    txt("tTax", money(taxSum));
    txt("tEff", wages > 0 ? pct(taxSum / wages) : "—");
    txt("tMarg", pct(marginalRate(c, state.a, t)));

    /* The after-tax counterparts of the pre-tax strip, with PTO inside the
       divisor because these are hours actually WORKED, not hours paid.
       每加班小时净得 is measured, not derived from the marginal rate: an overtime
       dollar partly escapes federal (and DC) tax through the overtime deduction,
       so it is not taxed like the ordinary dollar 边际税率 describes. */
    txt("tEffHourly", rate(home / c.workedHours));
    txt("tOtNet", rate(otNetPerHour(state.a, t, state.h)));
    var wk = workWeeks(state.a);
    txt("tPerWeek", isFinite(wk) ? money(home / wk) : "—");

    var rows = [
      ["总现金薪酬", wages, "+"],
      ["401(k) 员工供款", -tx.k401, "-"],
      ["HSA 供款", -tx.hsa, "-"],
      ["传统 IRA 供款", -tx.ira, "-"],
      ["联邦所得税", -tx.fed, "-"],
      ["DC 所得税", -tx.dc, "-"],
      ["FICA（社保 + 医保）", -tx.fica, "-"],
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

    /* Say what the overtime deduction actually did, step by step, and who it is
       for. "计入" on its own tells you neither that it was phased out to zero nor
       that an FLSA-exempt employee never had it. */
    var hint = $("otDedHint");
    if (hint) {
      var flsa = "只有 FLSA 要求支付的加班才算：豁免（exempt）员工即使公司按 1.5 倍付了加班费，也不能扣。";
      if (!t.otDed) {
        hint.textContent = "不计入加班扣除，加班费按普通工资全额计税。";
      } else if (!isFinite(x.otPremium)) {
        hint.textContent = "请先填写有效的基本工资与标准年工时。";
      } else if (!x.otYearOk) {
        hint.textContent = "OBBBA 加班扣除只适用于 2025–2028 税年，" + Math.round(t.year) + " 年不计。";
      } else if (!(x.otPremium > 0)) {
        hint.textContent = "当前没有可扣除的加班溢价（没有加班，或倍率不高于 1 倍）。" + flsa;
      } else {
        hint.textContent = "可扣除的加班溢价 " + money(x.otPremium) + "（时薪一倍以上、至多 1.5 倍的那部分）" +
          (x.otAllowed < x.otPremium ? "，按上限 " + money(t.otCap) + " 计" : "") +
          (x.otReduction > 0 ? "；MAGI 超过 " + money(t.otPhase) + "，退坡扣减 " + money(x.otReduction) : "") +
          "，实际扣除 " + money(x.otDeduction) + "，" +
          (t.dcOtDed ? "联邦和 DC 都扣。" : "只作用于联邦所得税。") + flsa;
      }
    }

    var ih = $("iraHint");
    if (ih) {
      var phased = x.ira > 0 && t.iraCovered && x.iraMagi > t.iraPhaseLo;
      ih.hidden = !phased;
      if (phased) {
        var full = x.iraDeduction >= x.ira;
        ih.textContent = "有公司退休计划时，传统 IRA 的抵扣按 MAGI（不扣 IRA 本身）在 " +
          money(t.iraPhaseLo) + "–" + money(t.iraPhaseHi) + " 之间退坡。你的 MAGI 约 " + money(x.iraMagi) + "，" +
          (full ? "可抵扣额度降到 " + money(x.iraCap) + "，这笔供款仍然全部可抵扣。"
                : (x.iraDeduction > 0 ? "只能抵扣 " + money(x.iraDeduction) + "，其余不可抵扣" : "这笔供款不可抵扣") +
                  "；税额已按此计算，不可抵扣的部分照样从到手里扣掉。");
      }
    }

    /* Over a limit is not necessarily wrong — catch-up contributions are legal —
       so the figure is used as typed and the page says what it would take. Over
       the wages, though, is never a real payslip. */
    var cw = [], yr = Math.round(t.year);
    if (x.k401 > t.c401kLimit) cw.push("401(k) 供款超过 " + yr + " 年上限 " + money(t.c401kLimit) +
      "：超出部分只有 50 岁以上的追加供款（catch-up）才成立，页面按你填的数计算。");
    if (x.hsa > t.hsaLimit) cw.push("HSA 供款超过上限 " + money(t.hsaLimit) + "：只有家庭计划或 55 岁以上的追加供款才可能更高，页面按你填的数计算。");
    if (x.ira > t.iraLimit) cw.push("IRA 供款超过上限 " + money(t.iraLimit) + "：可抵扣的部分以上限为准；50 岁以上有追加额度，请把「IRA 上限」改成对应数字。");
    if (x.k401 + x.hsa + x.ira > x.wages)
      cw.push("供款合计 " + money(tx.k401 + tx.hsa + tx.ira) + " 超过了总现金薪酬 " + money(wages) + "，到手成了负数——请检查供款或工资。");
    var ch = $("contribHint");
    if (ch) {
      ch.hidden = !cw.length;
      ch.textContent = cw.join(" ");
    }
    var cwText = cw.join(" ");
    if (cwText && cwText !== lastContribWarn) announce(cwText);
    lastContribWarn = cwText;
  }

  /* The compact title echo in the top bar carries live figures instead of
     repeating the page title: the assumptions sit far below the results, and
     this keeps an answer on screen while you edit them. */
  function renderTopbarLive(c, tx) {
    var el = $("topbarTitle");
    if (!el) return;
    /* Whole dollars regardless of 精确: it is a glance readout in 13px of bar, and
       with cents the take-home alone no longer fits a phone. */
    var d = displayOf(c, state.a);
    function whole(v) { return isFinite(v) ? (v < 0 ? "-$" : "$") + nf(0).format(Math.abs(Math.round(v))) : "—"; }
    el.innerHTML = '<span class="tl-total"><span class="tl-lab">总薪酬包 </span>' + esc(whole(d.total)) +
      '<span class="tl-sep"> · </span></span><span class="tl-take"><span class="tl-lab2">到手 </span>' +
      esc(whole(tx.home)) + '</span><span class="tl-rate"><span class="tl-sep"> · </span>' +
      '<span class="tl-lab2">有效税率 </span><span class="tl-rate-val">' +
      esc(tx.wages > 0 ? pct(tx.taxSum / tx.wages) : "—") + '</span></span>';
  }

  /* ---------- the one render entry point ---------- */

  function render() {
    var c = compute(state.a, state.h), tx = taxDisplay(c);
    renderDial();
    renderNumbers(c, tx);
    renderWarnings();
    renderMix();
    renderSchedule();
    renderReverse();
    renderTax(c, tx);
    renderBracketHints();
    renderTopbarLive(c, tx);
    /* After every tbody has been (re)built, not inside any one of them:
       markCurrent marks rows across tables. */
    markCurrent();
    restoreJumpFocus();
    save();
  }

  /* ---------- export ---------- */

  var NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.app);

  function tableText(sep) {
    var a = state.a, t = state.t, rows = schedule(a), r = rates(a), out = [];
    /* A field holding the separator, a quote or a newline has to be quoted, or the
       importer silently splits one cell into two. Cheap here, invisible when missing. */
    function cell(v) {
      var s = v === null || v === undefined ? "" : String(v);
      return /["\n\r]/.test(s) || s.indexOf(sep) !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function line(arr) { out.push(arr.map(cell).join(sep)); }
    /* Every column labelled "%" carries percentage points (5 = 5%), never a
       fraction under a % label — pasted into a sheet, 0.05 under "(%)" reads as a
       twentieth of a percent. */
    function pp(v) { return r6(v * 100); }
    var cNow = compute(a, state.h), xx = computeTax(cNow, a, t);
    line(["加班与总薪酬测算"]);
    line([]);
    line(["假设"]);
    line(["基本工资 ($/yr)", a.base]);
    line(["标准年工时 (h)", a.stdHours]);
    line(["加班倍率 (x)", a.otMult]);
    line(["年终奖 ($/yr)", a.bonus]);
    line(["401(k) 雇主匹配 (%)", pp(a.matchPct)]);
    line(["401(k) 匹配计算基数", a.matchOT ? "基本工资 + 加班费（原表口径）" : "仅基本工资"]);
    line(["利润分享 (% of base)", pp(a.profitPct)]);
    line(["通讯补贴 ($/yr)", a.stipend]);
    line(["PTO (h/yr)", a.ptoHours]);
    line(["标准时薪 ($/h)", r6(r.stdHourly)]);
    line(["加班时薪 ($/h)", r6(r.otHourly)]);
    line(["工作周数（扣除 PTO）", r2(workWeeks(a))]);
    line(["实际工作小时（含加班）", r2(cNow.workedHours)]);
    line(["实际时薪 ($/h)", r2(cNow.effHourly)]);
    line([]);
    line(["加班 (h)", "加班费", "变动薪酬", "等效年终奖 (%)", "总现金薪酬", "401(k) 匹配", "利润分享", "通讯补贴", "总薪酬包"]);
    rows.forEach(function (x) {
      line([x.h, r2(x.otPay), r2(x.variable), r6(x.eqBonus * 100), r2(x.cash), r2(x.match), r2(x.profit), r2(x.stipend), r2(x.total)]);
    });
    line([]);
    line(["税后（" + Math.round(t.year) + " 税表，单身，标准扣除）"]);
    line(["加班小时", state.h]);
    line(["总现金薪酬", r2(xx.wages)]);
    line(["401(k) 员工供款", r2(xx.k401)]);
    line(["HSA 供款" + (t.hsaPayroll ? "（工资扣除）" : "（非工资扣除）"), r2(xx.hsa)]);
    line(["传统 IRA 供款", r2(xx.ira)]);
    line(["其中可抵扣的 IRA", r2(xx.iraDeduction)]);
    line(["AGI", r2(xx.agi)]);
    line(["OBBBA 加班扣除" + (t.otDed ? "" : "（未计入）"), r2(xx.otDeduction)]);
    line(["联邦应税所得", r2(xx.fedTaxable)]);
    line(["联邦所得税", r2(xx.fedTax)]);
    line(["DC 应税所得" + (t.dcOtDed ? "（扣加班扣除）" : "（不扣加班扣除）"), r2(xx.dcTaxable)]);
    line(["DC 所得税", r2(xx.dcTax)]);
    line(["FICA" + (t.fica ? "" : "（未计入）"), r2(xx.fica)]);
    line(["到手现金", r2(xx.takeHome)]);
    line(["税后实际时薪 ($/h)", r2(xx.takeHome / cNow.workedHours)]);
    line(["每加班小时税后净得 ($/h)", r2(otNetPerHour(a, t, state.h))]);
    line(["税后每工作周 ($)", r2(xx.takeHome / workWeeks(a))]);
    line([]);
    line(["反查：目标等效年终奖 → 需要加班小时"]);
    line(["目标 (%)", "需要加班 (h)"]);
    for (var p = 10; p <= 50; p += 5) line([p, r6(hoursForTarget(a, p / 100))]);
    /* The target the user actually typed, which is usually not on the 5% grid. */
    if ([10, 15, 20, 25, 30, 35, 40, 45, 50].indexOf(state.target) === -1)
      line([r6(state.target), r6(hoursForTarget(a, state.target / 100))]);
    return out.join("\n");
  }
  function r2(v) { return isFinite(v) ? Math.round(v * 100) / 100 : ""; }
  function r6(v) { return isFinite(v) ? Math.round(v * 1e6) / 1e6 : ""; }

  /* A date, not the salary: a file name is visible wherever the file is — a
     Downloads list, an attachment chip, a shared folder — without being opened. */
  function exportName() {
    var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; };
    return "OT_Compensation_" + d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + ".csv";
  }

  function exportCSV() {
    /* The BOM is what makes Excel open a UTF-8 CSV with Chinese headers without
       mangling them. Both paths get it, so the file is identical either way. */
    var text = "\ufeff" + tableText(",");
    var name = exportName();
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
      toast("已导出 " + name);
    } catch (e) {
      toast("导出失败：" + e.message, true);
    }
  }

  function copyTable() {
    var text = tableText("\t");
    var done = function () { toast("表格已复制，可直接粘进 Excel。"); };
    var fail = function () { toast("复制失败，请改用导出 CSV。", true); };
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
    /* The large title fades while it is echoed in the bar — scroll state, and
       printing always starts scrolled, so it would print at 30% grey. */
    [].forEach.call(root.querySelectorAll(".echoed"), function (n) { n.classList.remove("echoed"); });
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
    toast: function (m, bad) { toast(m, !!bad); }
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

  /* The defaults are example figures, not the workbook's: say so, and make the
     reset undoable — it overwrites whatever real numbers were typed in. */
  function doReset() {
    var before = { a: clone(state.a), h: state.h, target: state.target };
    state.a = clone(DEFAULTS);
    state.h = 250;
    state.target = 25;
    if (els.revPct) els.revPct.value = "25";
    renderAssumptions();
    render();
    toast("已恢复默认示例值——10 秒内可以按旁边的「撤销」撤回。");
    offerUndo("resetUndo", "resetBtn", function () {
      state.a = before.a; state.h = before.h; state.target = before.target;
      if (els.revPct) els.revPct.value = String(state.target);
      renderAssumptions();
      render();
      toast("已撤销恢复。");
    });
  }

  /* ---------- wiring ---------- */

  load();
  renderAssumptions();
  if (els.revPct) els.revPct.value = String(state.target);

  /* The kit echoes the page title into a HIDDEN slot; that is what drives
     .title-shown. The visible compact slot (#topbarTitle) carries live figures
     instead, written by renderTopbarLive — see there. */
  UIKit.chrome({ titleSlot: "#topbarEcho" });

  /* UIKit.chrome() re-measures --topbar-h on window resize only. This bar can
     also change height on its OWN (the compact slot appearing, a font loading),
     and nothing fires a resize for that.
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
  UIKit.segmented("#dcOtDedToggle");
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
  /* A value the model refused (empty, negative) must not stay on screen next to
     a result computed from something else. */
  on(els.revPct, "blur", function () { this.value = String(state.target); });

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
        /* A year is a label: stored whole, so the tag, the CSV header and the
           2025-2028 overtime-deduction window all read the same year. */
        state.t[key] = key === "year" ? Math.round(v) : v;
        if (key === "year" || key === "c401kLimit" || key === "hsaLimit" || key === "iraLimit") renderTaxFields();
        render();
      });
      /* Fields only — never the bracket rows (see renderTaxFields). */
      on($(id), "blur", function () { renderTaxFields(); });
    }(tid, TAX_FIELDS[tid]));
  }

  on($("cHsaPayroll"), "change", function () {
    state.t.hsaPayroll = this.checked ? 1 : 0;
    render();
  });
  on($("cIraCovered"), "change", function () {
    state.t.iraCovered = this.checked ? 1 : 0;
    render();
  });

  [["ficaToggle", "fica"], ["otDedToggle", "otDed"], ["dcOtDedToggle", "dcOtDed"]].forEach(function (x) {
    on($(x[0]), "click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      state.t[x[1]] = b.getAttribute("data-on") === "1" ? 1 : 0;
      renderTaxFields();
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

  /* Leaving a bracket cell puts the model's value back into it. Without this a
     cleared or negative rate stayed on screen while the tax went on using the
     old one. */
  on($("secTax"), "focusout", function (e) {
    var el = e.target;
    if (!el.getAttribute || !el.getAttribute("data-br")) return;
    var row = state.t[el.getAttribute("data-br")][Number(el.getAttribute("data-i"))];
    if (!row) return;
    var v = el.getAttribute("data-f") === "top" ? row[0] : row[1];
    el.value = v === null ? "" : String(v);
  });

  /* After the rows are rebuilt the control that was used is gone; hand focus to
     the nearest thing that still means the same place. */
  function focusBracket(key, i, sel) {
    var t = $(key), rows = t && t.tBodies[0].rows;
    if (!rows || !rows.length) return;
    var el = rows[Math.max(0, Math.min(i, rows.length - 1))].querySelector(sel);
    if (el) el.focus();
  }

  on($("secTax"), "click", function (e) {
    var del = e.target.closest ? e.target.closest(".br-del") : null;
    if (del) {
      var key = del.getAttribute("data-br"), i = Number(del.getAttribute("data-i"));
      if (state.t[key].length > 1) {
        state.t[key].splice(i, 1);
        renderTaxInputs();
        render();
        focusBracket(key, i, ".br-del");
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
      var at;
      if (lastTop === null && rows.length) {
        at = rows.length - 1;
        rows.splice(at, 0, [Math.max(0, rows.length > 1 ? Number(rows[rows.length - 2][0]) + 10000 : 10000), lastRate]);
      } else {
        at = rows.length;
        rows.push([null, lastRate]);
      }
      renderTaxInputs();
      render();
      focusBracket(k, at, 'input[data-f="top"]');
    }
  });

  /* The TABLE goes back to this build's defaults; what you contribute and which
     rules apply to you stay (TAX_PERSONAL) — resetting the rates is not a reason
     to lose your 401(k) figure. Undoable either way. */
  on($("taxResetBtn"), "click", function () {
    var before = M.cloneTax(state.t);
    state.t = M.resetTaxTable(state.t);
    renderTaxInputs();
    render();
    toast("税表已恢复到 " + TAX_DEFAULTS.year + " 年的默认值，你的供款和开关没有动；10 秒内可以撤回。");
    offerUndo("taxUndo", "taxResetBtn", function () {
      state.t = before;
      renderTaxInputs();
      render();
      toast("已撤销恢复。");
    });
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
    if (b) {
      if (Number(b.getAttribute("data-h")) !== state.h) rememberJumpFocus(b);
      setHours(b.getAttribute("data-h"));
      return;
    }
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
      setMixHover(t ? t.getAttribute("data-key") : null);
    });
    panel.addEventListener("mouseleave", function () { setMixHover(null); });
    panel.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".mix-slice, .mix-row") : null;
      if (t) toggleMixPin(t.getAttribute("data-key"));
    });
    // Includes the donut centre, card whitespace and the rest of the page.
    // Keep the clicked control's own action and normal focus behaviour intact.
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".mix-slice, .mix-row") : null;
      if (!t && (mixPinned || mixHover)) clearMixSelection();
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
  }());

  /* Quick-jump bar. scrollIntoView honours html{scroll-padding-top}, which is
     calc(--topbar-h + 48px) — so the target clears BOTH sticky bars. Focus moves
     to the section's heading too, without scrolling: otherwise the page scrolled
     but focus stayed in the bar, and the next Tab snapped back to the top. */
  [].forEach.call(document.querySelectorAll("[data-jump]"), function (b) {
    b.addEventListener("click", function () {
      var t = document.getElementById(b.getAttribute("data-jump"));
      if (!t) return;
      t.scrollIntoView({ behavior: UIKit.reduceMotion() ? "auto" : "smooth", block: "start" });
      var h = t.querySelector("h2") || t;
      h.setAttribute("tabindex", "-1");
      try { h.focus({ preventScroll: true }); } catch (e) { /* old engines: leave focus where it was */ }
    });
  });

  /* The info dot opens on hover and on focus. Escape closes it WITHOUT moving
     focus (blurring it sent the next Tab back to the top of the page) and closes
     a pointer-opened one too (WCAG 1.4.13); Enter/Space toggle it, as its
     role=button promises. The class comes off again when the pointer leaves or
     focus moves on. Escape also releases a pinned donut slice wherever focus is —
     a slice pinned by mouse never had focus inside the chart. */
  function popAnchors() { return [].slice.call(document.querySelectorAll(".pop-anchor")); }
  document.addEventListener("keydown", function (e) {
    var a = document.activeElement;
    var onAnchor = a && a.classList && a.classList.contains("pop-anchor");
    if (e.key === "Escape") {
      popAnchors().forEach(function (p) {
        if (p === a || p.matches(":hover")) p.classList.add("pop-dismissed");
      });
      if (mixPinned || mixHover) clearMixSelection();
    } else if (onAnchor && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      a.classList.toggle("pop-dismissed");
    }
  });
  popAnchors().forEach(function (p) {
    p.addEventListener("blur", function () { p.classList.remove("pop-dismissed"); });
    p.addEventListener("mouseleave", function () { p.classList.remove("pop-dismissed"); });
  });
  /* The kit clamps a popover into the viewport only when it is revealed, but the
     HIDDEN box still takes part in layout — so at 414-480px the lede's popover
     stuck out past the right edge and the whole page scrolled sideways. Clamp
     every one up front and again on resize. */
  /* WebKit applies the new --hx margin but keeps the page's scrollable overflow
     from BEFORE it (measured: box inside the viewport, scrollWidth still 478 at
     430px) until the block CONTAINING the anchor is laid out again — re-laying
     out the popover alone does not clear it. Same stale-layout shape as
     forceRestyle's other cases, and the same cure, applied to that block. */
  function clampPopovers() {
    popAnchors().forEach(function (p) {
      UIKit.positionPopover(p);
      if (p.parentElement) p.parentElement.setAttribute("data-pop-host", "");
    });
    forceRestyle("[data-pop-host]");
  }
  clampPopovers();
  window.addEventListener("resize", clampPopovers);

  render();
  pushTheme();
  if (taxUpdatedFrom !== null) {
    var NAMES = { c401k: "401(k)", hsa: "HSA" };
    var moved = taxMoved.map(function (m) {
      return NAMES[m[0]] + " 供款跟着上限从 " + nf(0).format(m[1]) + " 调到 " + nf(0).format(m[2]);
    });
    toast("税表已从 " + taxUpdatedFrom + " 年更新到 " + TAX_DEFAULTS.year + " 年的默认值" +
      (moved.length ? "；" + moved.join("，") + "；其余供款和开关保持不变。" : "，你的供款和开关保持不变。"));
  }

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
