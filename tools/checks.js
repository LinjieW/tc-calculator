/* Acceptance checks, run inside a real WKWebView by tools/wkcheck.swift.
   Sets window.__RESULT to a JSON string when finished. */
(function () {
  var R = { viewport: window.innerWidth + "x" + window.innerHeight, fail: [], info: {} };
  function ok(cond, name, detail) { if (!cond) R.fail.push(name + (detail ? " — " + detail : "")); }
  function stage(s) { R.info.stage = s; try { window.__PARTIAL = JSON.stringify(R); } catch (e) {} }

  /* ---- EXPECTED VALUES ----
     Computed independently from the workbook's formulas and the published 2026
     IRS / DC tables — never read back from the app, which is the only way an
     expectation proves anything.

     They correspond to web/app.js's shipping DEFAULTS. If you change those, these
     have to be recomputed by hand: each one is sensitive to the order the display
     rounding happens in, so do not derive them by reading the app's own output —
     that turns this suite into a test that agrees with whatever the app does. */
  var E = {
    hero: "$131,130", cash: "$122,029", benefits: "$9,101",
    stdRate: "$48.08", otRate: "$72.12",
    basePay: 100000, ptoPay: "$3,846", ptoField: "80",
    worked: "2,250 h", eff: "$54.24",
    perWeek: "5.00", perWeekNoPto: "4.81", workedNoPto: "2,330 h",
    matchWithOT: 5901, matchNoOT: 5000, matchField: "5",
    at400hero: "$142,488", at400cash: "$132,846",
    base200kOtRate: "$144.23", base200kCash: "$261,692",
    home: 68847, homeStr: "$68,847", taxStr: "$24,282",
    /* The marginal rate is FICA 7.65 + federal 22 + DC 8.5 = exactly 38.15%, which
       is a rounding TIE at one decimal. Whether it renders as 38.1 or 38.2 comes
       down to which side of 38.15 the floating-point subtraction lands on — the
       app renders 38.1 and an independent computation of the same arithmetic
       gives 38.2; neither is wrong. So this one is asserted as a number with a
       tolerance; a string equality here is a test that flakes on float noise. */
    margValue: 38.15, margTolerance: 0.06,
    taxEff: "$30.60", taxOtNet: "$44.60", taxPerWeek: "$1,377",
    /* The OBBBA deduction here is 6,009.615 and both the with- and without-
       deduction taxable incomes sit inside the 22% band, so removing it costs a
       flat 22%. With other figures it can straddle 22%/24% — a flat marginal
       band is a property of THESE numbers, not a general rule. */
    otDeduction: 6009.615, otMarginalBand: 0.22,
    /* The bottom federal band is 12,400 wide, so 10% -> 20% costs 1,240.
       Independent of the assumptions: it is the tax table, not the salary. */
    bottomBandCost: 1240
  };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function round(n) { return Math.round(n * 10) / 10; }
  function state_step_guess() { return 25; }
  /* html{scroll-behavior:smooth} means scrollTo returns long before the page has
     arrived. Sampling a "before" position mid-animation and comparing it to a
     settled "after" produced a failure that came and went with the viewport
     height — a flake in the harness, not a defect in the app. Wait for it. */
  async function scrollSettled(y) {
    window.scrollTo(0, y);
    var last = -1, same = 0;
    for (var i = 0; i < 40 && same < 3; i++) {
      await new Promise(function (r) { setTimeout(r, 50); });
      var now = Math.round(window.scrollY);
      same = now === last ? same + 1 : 0;
      last = now;
    }
    return last;
  }

  function setSlider(h) {
    var sl = document.getElementById("hSlider");
    sl.value = String(h);
    sl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function finish() {
    R.pass = R.fail.length === 0;
    window.__RESULT = JSON.stringify(R);
  }

  (async function run() {
    try {
      await wait(200);
      var de = document.documentElement;

      /* A file:// origin keeps its localStorage between runs, so without this the
         suite starts from whatever the LAST run left behind and every hard-coded
         expectation below is measuring the wrong model. Reset to the workbook
         defaults first, and clear the store so the next run starts clean too. */
      try { localStorage.removeItem("ot_calc_v1"); } catch (e) {}
      document.getElementById("resetBtn").click();
      await wait(350);

      /* ---- the kit actually wired up ---- */
      ok(typeof window.UIKit === "object", "UIKit missing");
      ok(typeof window.Motion === "object", "Motion missing (segmented thumb would not spring)");
      var thumb = document.querySelector("#precToggle .seg-thumb");
      ok(!!thumb, "segmented thumb never inserted");
      /* Inserted is not the same as rendered: WKWebView leaves the JS-written
         inline width at a computed 0px, so the sliding pill silently never
         appears (see forceRestyle in app.js). */
      R.info.thumb = thumb ? getComputedStyle(thumb).width + " x " + getComputedStyle(thumb).height : "(none)";
      ok(thumb && parseFloat(getComputedStyle(thumb).width) > 10,
         "segmented thumb is present but has no size — the pill never renders", R.info.thumb);

      stage("model");
      /* ---- model, against the workbook ---- */
      R.info.hero = document.getElementById("heroVal").textContent;
      R.info.rows = document.querySelectorAll("#schedTable tbody tr").length;
      R.info.revRows = document.querySelectorAll("#revTable tbody tr").length;
      ok(R.info.rows === 26, "schedule row count", R.info.rows + " (want 26 for 0..625 step 25)");
      ok(R.info.revRows === 9, "reverse row count", R.info.revRows);
      ok(R.info.hero === E.hero, "hero value at 250h", R.info.hero);
      R.info.stdRate = document.getElementById("sStd").textContent;
      R.info.otRate = document.getElementById("sOt").textContent;
      ok(R.info.stdRate === E.stdRate, "std hourly keeps cents", R.info.stdRate);
      ok(R.info.otRate === E.otRate, "OT hourly keeps cents", R.info.otRate);

      stage("svg");
      /* ---- gotcha 1: WKWebView collapses an SVG flex item sized only by max-width ---- */
      var chartEl = document.getElementById("mixChart");
      var svg = chartEl.getBoundingClientRect();
      R.info.svg = round(svg.width) + "x" + round(svg.height);
      ok(svg.width > 100 && svg.height > 100, "donut collapsed in WKWebView", R.info.svg);
      ok(Math.abs(svg.width / svg.height - 1) < 0.05, "donut aspect ratio drifted from its viewBox", R.info.svg);
      ok(chartEl.querySelectorAll("circle").length >= 5, "donut has too few slices",
         String(chartEl.querySelectorAll("circle").length));
      ok(getComputedStyle(chartEl).display !== "none", "donut hidden while it has content");

      /* every slice must be painted with a token reference, so a theme flip
         recolours an already-rendered chart with no redraw */
      var badStroke = [].filter.call(chartEl.querySelectorAll("circle"), function (c) {
        return (c.getAttribute("stroke") || "").indexOf("var(--") !== 0;
      }).length;
      ok(badStroke === 0, "a donut slice is not painted from a token", String(badStroke));

      /* ---- the legend's parts must add up to the total in the hole ---- */
      function numTxt(t) { var n = Number(String(t).replace(/[$,\s]/g, "")); return isFinite(n) ? n : NaN; }
      var legendVals = [].map.call(document.querySelectorAll("#mixLegend .mix-val"), function (e) { return numTxt(e.textContent); });
      var centreTxt = chartEl.querySelectorAll("text");
      var centre = numTxt(centreTxt[centreTxt.length - 1].textContent);
      var legendSum = legendVals.reduce(function (a, b) { return a + b; }, 0);
      R.info.donut = { slices: legendVals.length, sum: legendSum, centre: centre };
      ok(legendVals.length === 7, "donut legend should list seven parts", String(legendVals.length));
      /* The PTO slice is carved OUT of the base, so the two must add back to the
         full base salary — otherwise the chart is inventing or losing money. */
      R.info.baseSplit = { worked: legendVals[0], pto: legendVals[1], sum: legendVals[0] + legendVals[1] };
      ok(Math.abs(R.info.baseSplit.sum - E.basePay) < 1e-9,
         "worked base + PTO does not add back to the base salary", JSON.stringify(R.info.baseSplit));
      ok(Math.abs(R.info.baseSplit.pto - Number(E.ptoPay.replace(/[$,]/g, ""))) < 1e-9, "PTO slice wrong",
         String(R.info.baseSplit.pto));
      ok(Math.abs(legendSum - centre) < 1e-9, "donut legend does not add up to the total in the hole",
         JSON.stringify(R.info.donut));
      var pcts = [].map.call(document.querySelectorAll("#mixLegend .mix-pct"), function (e) { return parseFloat(e.textContent); });
      R.info.donutPctSum = Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) * 10) / 10;
      ok(Math.abs(R.info.donutPctSum - 100) <= 0.3, "donut shares do not sum to 100%", String(R.info.donutPctSum));

      /* Setting PTO to 0 must drop the slice entirely rather than draw a zero-width
         one, and hand its dollars back to the worked base. */
      var ptoIn = document.getElementById("aPto");
      ptoIn.value = "0";
      ptoIn.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(350);
      var v0 = [].map.call(document.querySelectorAll("#mixLegend .mix-val"), function (e) { return numTxt(e.textContent); });
      var t0 = chartEl.querySelectorAll("text");
      R.info.donutNoPto = { slices: v0.length, first: v0[0], sum: v0.reduce(function (a, b) { return a + b; }, 0),
                            centre: numTxt(t0[t0.length - 1].textContent) };
      ok(R.info.donutNoPto.slices === 6, "PTO slice should disappear at 0 hours", String(R.info.donutNoPto.slices));
      ok(R.info.donutNoPto.first === E.basePay, "base slice should be the whole salary at PTO 0", String(R.info.donutNoPto.first));
      ok(Math.abs(R.info.donutNoPto.sum - R.info.donutNoPto.centre) < 1e-9,
         "donut stopped reconciling at PTO 0", JSON.stringify(R.info.donutNoPto));
      ptoIn.value = "160";
      ptoIn.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(350);

      /* ---- the 401(k) match base toggle ---- */
      var mb = document.getElementById("matchBaseToggle");
      ok(!!mb, "401(k) match base toggle missing");
      var matchWithOT = numTxt(document.getElementById("sMatch").textContent);
      mb.querySelector('button[data-mot="0"]').click();
      await wait(300);
      var matchNoOT = numTxt(document.getElementById("sMatch").textContent);
      R.info.matchToggle = { withOT: matchWithOT, withoutOT: matchNoOT,
                             unit: document.getElementById("aMatchUnit").textContent,
                             note: document.getElementById("matchBaseNote").textContent };
      ok(matchWithOT === E.matchWithOT, "match with OT wrong", String(matchWithOT));
      ok(matchNoOT === E.matchNoOT, "match without OT wrong", String(matchNoOT));
      ok(R.info.matchToggle.unit.indexOf("加班") === -1, "match unit label still claims OT is included",
         R.info.matchToggle.unit);
      ok(R.info.matchToggle.note === "与原表不同", "off-book state not flagged", R.info.matchToggle.note);
      /* the donut must follow the toggle */
      var afterToggleSum = [].map.call(document.querySelectorAll("#mixLegend .mix-val"), function (e) { return numTxt(e.textContent); })
        .reduce(function (a, b) { return a + b; }, 0);
      var t2 = chartEl.querySelectorAll("text");
      ok(Math.abs(afterToggleSum - numTxt(t2[t2.length - 1].textContent)) < 1e-9,
         "donut stopped adding up after the match toggle");
      mb.querySelector('button[data-mot="1"]').click();
      await wait(300);
      ok(numTxt(document.getElementById("sMatch").textContent) === E.matchWithOT, "match did not return to the base+OT basis");

      /* ---- gotcha 22: an animation-name that does not resolve is a silent no-op ---- */
      var riseTarget = document.querySelector(".hero-grid > .stat");
      riseTarget.style.animation = "none"; void riseTarget.offsetWidth;
      riseTarget.style.animation = "ui-rise .32s cubic-bezier(.32,.72,0,1) both";
      await wait(60);
      R.info.riseAnimations = riseTarget.getAnimations ? riseTarget.getAnimations().length : "n/a";
      ok(!riseTarget.getAnimations || riseTarget.getAnimations().length > 0,
         "@keyframes ui-rise does not resolve (riseIn is a no-op)");
      riseTarget.style.animation = "";

      stage("popover");
      /* ---- gotcha 2 / 21: the popover must be clamped INTO the viewport ---- */
      var anchor = document.querySelector(".pop-anchor");
      var pop = anchor && anchor.querySelector(".popover");
      if (pop) {
        anchor.focus();
        await wait(220);
        var pr = pop.getBoundingClientRect();
        R.info.popover = round(pr.left) + ".." + round(pr.right) + " of " + window.innerWidth;
        ok(pr.right <= window.innerWidth + 1 && pr.left >= -1, "popover runs off screen", R.info.popover);
        anchor.blur();
      } else { R.fail.push("pop-anchor/.popover missing"); }

      /* ---- gotcha 18: no horizontal overflow, measured not eyeballed ---- */
      R.info.scrollWidth = de.scrollWidth;
      ok(de.scrollWidth === window.innerWidth, "horizontal overflow",
         de.scrollWidth + " vs viewport " + window.innerWidth);

      stage("sticky");
      /* ---- gotcha 5: the quick-jump bar's edge fade must be ARMED and state-driven.
         The six labels wrapped to two lines at 375px until this bar became an
         h-scroll; the fade that comes with it is only correct if UIKit.edgeFade
         was actually called, and a missing call is silent — the bar just scrolls
         with no fade, which looks deliberate. */
      var sbar = document.getElementById("subbarScroll");
      ok(!!sbar, "quick-jump bar missing its scroller id");
      R.info.subbar = { wired: !!(sbar && sbar._edgeFadeWired),
                        noWrap: sbar ? [].every.call(sbar.querySelectorAll(".btn-ghost"), function (b) {
                          return b.getBoundingClientRect().height < 40;
                        }) : false };
      ok(R.info.subbar.wired, "UIKit.edgeFade was never armed on the quick-jump bar");
      ok(R.info.subbar.noWrap, "a quick-jump label wrapped to two lines");
      if (sbar) {
        /* Add filler until the bar genuinely overflows. One button is enough at
           375px and not at 1100px, where the bar has 1000px to play with — an
           assertion that assumed one was enough failed on the wide viewport for
           a bar that was behaving correctly. */
        var filler = [];
        for (var fi = 0; fi < 14 && sbar.scrollWidth - sbar.clientWidth <= 20; fi++) {
          var wide = document.createElement("button");
          wide.className = "btn-ghost sm quiet";
          wide.textContent = "一个刻意很长的导航项用来制造溢出";
          sbar.appendChild(wide);
          filler.push(wide);
        }
        window.dispatchEvent(new Event("resize"));
        await wait(250);
        R.info.subbarFade = { hidden: sbar.scrollWidth - sbar.clientWidth,
                              r: sbar.classList.contains("fade-r"),
                              l: sbar.classList.contains("fade-l") };
        ok(R.info.subbarFade.hidden > 1 && R.info.subbarFade.r && !R.info.subbarFade.l,
           "edge fade wrong with content hidden on the right only", JSON.stringify(R.info.subbarFade));
        sbar.scrollLeft = sbar.scrollWidth;
        await wait(250);
        R.info.subbarFadeEnd = { l: sbar.classList.contains("fade-l"), r: sbar.classList.contains("fade-r") };
        ok(R.info.subbarFadeEnd.l, "edge fade did not appear on the left after scrolling to the end",
           JSON.stringify(R.info.subbarFadeEnd));
        sbar.scrollLeft = 0;
        filler.forEach(function (n) { n.remove(); });
        window.dispatchEvent(new Event("resize"));
        await wait(250);
        R.info.subbarFadeRestored = { l: sbar.classList.contains("fade-l"), r: sbar.classList.contains("fade-r") };
        ok(!R.info.subbarFadeRestored.l, "a fade stayed on with nothing hidden (gotcha 5)",
           JSON.stringify(R.info.subbarFadeRestored));
      }

      /* ---- gotcha 6: the sub-bar must never tuck under the top bar ---- */
      var tb = document.querySelector(".topbar"), sub = document.querySelector(".subbar");
      var worst = 0, samples = [];
      var ys = [0, 300, 700, 1500, Math.max(0, de.scrollHeight - window.innerHeight)];
      for (var i = 0; i < ys.length; i++) {
        await scrollSettled(ys[i]);
        var hidden = Math.round(tb.getBoundingClientRect().bottom - sub.getBoundingClientRect().top);
        samples.push({ y: Math.round(window.scrollY), barH: tb.offsetHeight,
                       cssVar: getComputedStyle(de).getPropertyValue("--topbar-h").trim(), hidden: hidden });
        if (hidden > worst) worst = hidden;
      }
      R.info.stickySamples = samples;
      ok(worst <= 1, "sub-bar tucked under the top bar", worst + "px hidden");
      ok(samples.every(function (s) { return s.cssVar === s.barH + "px"; }),
         "--topbar-h drifted from the measured bar height");

      /* large-title echo must have actually run at least once */
      R.info.echoFired = samples.some(function (s, i) { return i > 0; }) &&
                         document.getElementById("topbarTitle").textContent.length > 0;
      ok(R.info.echoFired, "large-title echo never populated the compact slot");

      stage("theme");
      /* ---- gotcha 10: a theme flip must not rebuild anything ---- */
      var hx = document.getElementById("hExact");

      /* Pin the starting theme. The page boots from localStorage, so without this
         the flip direction — and therefore every colour asserted below — is
         whatever the previous run happened to leave behind. Setting the attribute
         directly is the one path that restyles cleanly (see setTheme in app.js). */
      de.dataset.theme = "light";
      try { localStorage.setItem("ui_theme", "light"); } catch (e) {}
      await wait(250);

      /* Set up the state the flip must preserve, THEN settle the scroll. Focusing
         a field near the top of the page scrolls it into view, so doing it after
         the scroll would move the page and blame the theme for it. */
      hx.focus(); hx.value = "137";
      var scrollBefore = await scrollSettled(600);
      var themeBefore = de.dataset.theme;
      AppBridge.toggleTheme();
      await wait(450);
      R.info.themeFlip = {
        from: themeBefore, to: de.dataset.theme,
        scrollBefore: scrollBefore, scrollAfter: Math.round(window.scrollY),
        maxScroll: Math.round(de.scrollHeight - window.innerHeight),
        scrollKept: Math.abs(Math.round(window.scrollY) - scrollBefore) <= 2,
        inputKept: hx.value === "137",
        focusKept: document.activeElement === hx
      };
      ok(R.info.themeFlip.to !== themeBefore, "theme did not change");
      ok(R.info.themeFlip.scrollKept, "theme flip lost the scroll position");
      ok(R.info.themeFlip.inputKept, "theme flip lost uncommitted input");
      ok(R.info.themeFlip.focusKept, "theme flip lost focus");

      /* ---- the WHOLE page must restyle, not just the root's tokens ---- */
      R.info.afterFlip = {
        rootToken: getComputedStyle(de).getPropertyValue("--bg-base").trim(),
        body: getComputedStyle(document.body).backgroundColor,
        panel: getComputedStyle(document.querySelector(".panel")).backgroundColor,
        title: getComputedStyle(document.querySelector(".panel-title")).color
      };
      ok(R.info.afterFlip.body === "rgb(29, 27, 25)" && R.info.afterFlip.panel === "rgb(43, 41, 37)",
         "page did not restyle when the theme flipped", JSON.stringify(R.info.afterFlip));

      /* ---- form controls must actually restyle when the theme flips ----
         WKWebView leaves them stale (see repaintFormControls in app.js), which puts
         near-white text on a near-white field. Compare against the SAME page booted
         straight into dark, where the correct value is --bg-base. */
      function bgOf(id) { return getComputedStyle(document.getElementById(id)).backgroundColor; }
      R.info.darkFieldBg = { revPct: bgOf("revPct"), aBase: bgOf("aBase"), aStep: bgOf("aStep") };
      var baseTok = getComputedStyle(de).getPropertyValue("--bg-base").trim();
      function hexToRgb(h) {
        h = h.replace("#", "");
        return "rgb(" + parseInt(h.slice(0, 2), 16) + ", " + parseInt(h.slice(2, 4), 16) + ", " + parseInt(h.slice(4, 6), 16) + ")";
      }
      R.info.darkFieldWant = hexToRgb(baseTok);
      ok(R.info.darkFieldBg.revPct === R.info.darkFieldWant &&
         R.info.darkFieldBg.aBase === R.info.darkFieldWant &&
         R.info.darkFieldBg.aStep === R.info.darkFieldWant,
         "form controls kept the light background after the theme flipped",
         JSON.stringify(R.info.darkFieldBg) + " want " + R.info.darkFieldWant);
      /* and the flip must not have stolen focus from the field being typed in */
      ok(document.activeElement === hx, "theme flip lost focus out of the field");

      /* dark theme depth ladder: base < inset < elevated in BOTH themes (gotcha 7) */
      function lum(v) {
        var m = getComputedStyle(de).getPropertyValue(v).trim().replace("#", "");
        return parseInt(m.slice(0, 2), 16) + parseInt(m.slice(2, 4), 16) + parseInt(m.slice(4, 6), 16);
      }
      R.info.ladderDark = [lum("--bg-base"), lum("--bg-inset"), lum("--bg-elevated")];
      ok(R.info.ladderDark[0] < R.info.ladderDark[1] && R.info.ladderDark[1] < R.info.ladderDark[2],
         "dark depth ladder inverted", JSON.stringify(R.info.ladderDark));

      /* ---- color-scheme follows the theme (gotcha 17) ---- */
      R.info.colorSchemeDark = getComputedStyle(de).colorScheme;
      ok(/dark/.test(R.info.colorSchemeDark), "color-scheme not dark in dark theme", R.info.colorSchemeDark);

      AppBridge.toggleTheme();
      await wait(420);
      R.info.ladderLight = [lum("--bg-base"), lum("--bg-inset"), lum("--bg-elevated")];
      ok(R.info.ladderLight[0] < R.info.ladderLight[1] && R.info.ladderLight[1] < R.info.ladderLight[2],
         "light depth ladder inverted", JSON.stringify(R.info.ladderLight));
      R.info.colorSchemeLight = getComputedStyle(de).colorScheme;
      ok(/light/.test(R.info.colorSchemeLight), "color-scheme not light in light theme", R.info.colorSchemeLight);
      hx.value = ""; hx.blur();

      stage("keyboard");
      /* ---- keyboard: everything operable is reachable, and the row jump works ---- */
      var focusables = document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])');
      R.info.focusableCount = focusables.length;
      ok(focusables.length > 20, "suspiciously few focusable elements", String(focusables.length));
      var jump = document.querySelector("#schedTable tbody .hjump");
      ok(!!jump, "table row has no keyboard-reachable jump control");
      if (jump) {
        jump.focus();
        ok(document.activeElement === jump, "row jump button cannot take focus");
        var wanted = jump.getAttribute("data-h");
        jump.click();
        await wait(220);
        R.info.jumpedTo = document.getElementById("hExact").value;
        ok(R.info.jumpedTo === wanted, "row jump did not move the model", R.info.jumpedTo + " vs " + wanted);
        ok(!!document.querySelector("#schedTable tbody tr.is-current"), "no current row after a jump");
      }

      stage("slider");
      /* ---- the slider drives the model and the fill token ---- */
      var sl = document.getElementById("hSlider");
      sl.value = "400";
      sl.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(260);
      R.info.at400 = {
        hero: document.getElementById("heroVal").textContent,
        cash: document.getElementById("mCash").textContent,
        fill: sl.style.getPropertyValue("--fill") || getComputedStyle(sl).getPropertyValue("--fill")
      };
      ok(R.info.at400.hero === E.at400hero, "hero wrong at 400h", R.info.at400.hero);
      ok(R.info.at400.cash === E.at400cash, "total cash wrong at 400h", R.info.at400.cash);
      ok(String(R.info.at400.fill).indexOf("64") === 0, "slider --fill not painted", String(R.info.at400.fill));

      stage("assumptions");
      /* ---- assumptions recompute, and a percent is scaled exactly once ---- */
      var base = document.getElementById("aBase");
      base.value = "200000";
      base.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(260);
      // 200000/2080*1.5 = 144.230769; 400h -> 57692.31 OT pay; cash = 200000+57692.31+5000
      R.info.base200k = {
        otRate: document.getElementById("sOt").textContent,
        cash: document.getElementById("mCash").textContent
      };
      ok(R.info.base200k.otRate === E.base200kOtRate, "OT rate wrong after base change", R.info.base200k.otRate);
      ok(R.info.base200k.cash === E.base200kCash, "cash wrong after base change", R.info.base200k.cash);

      var mp = document.getElementById("aMatch");
      R.info.matchFieldValue = mp.value;
      ok(mp.value === E.matchField, "401(k) match field should read a percent, not a fraction", mp.value);

      /* zero base must degrade to a dash, never to $Infinity */
      base.value = "0";
      base.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(260);
      R.info.zeroBase = {
        hero: document.getElementById("heroVal").textContent,
        eq: document.getElementById("mEq").textContent,
        warn: !document.getElementById("warnBox").hidden
      };
      ok(R.info.zeroBase.eq === "—", "eq bonus at base 0 is not a dash", R.info.zeroBase.eq);
      ok(R.info.zeroBase.warn, "no warning shown at base 0");
      ok(R.info.zeroBase.hero.indexOf("Infinity") === -1 && R.info.zeroBase.hero.indexOf("NaN") === -1,
         "hero shows a non-number at base 0", R.info.zeroBase.hero);

      document.getElementById("resetBtn").click();
      await wait(300);
      R.info.afterReset = document.getElementById("heroVal").textContent;
      ok(R.info.afterReset === E.hero, "reset did not restore the shipping defaults", R.info.afterReset);

      stage("sums");
      /* ---- the page's arithmetic must agree with itself ----
         Every identity a reader can check by eye, checked by eye's equivalent:
         parse the rendered strings back and add them up. */
      function num(t) { var n = Number(String(t).replace(/[$,\s]/g, "")); return isFinite(n) ? n : NaN; }
      var sumMismatch = [];
      [].forEach.call(document.querySelectorAll("#schedTable tbody tr"), function (tr) {
        var c = [].map.call(tr.cells, function (td) { return td.textContent.trim(); });
        var parts = num(c[4]) + num(c[5]) + num(c[6]) + num(c[7]);   // cash + match + profit + stipend
        if (Math.abs(parts - num(c[8])) > 1e-9) sumMismatch.push({ h: c[0], parts: parts, total: num(c[8]) });
      });
      R.info.rowSumMismatches = sumMismatch.length;
      ok(sumMismatch.length === 0, "schedule row parts do not add to its total",
         JSON.stringify(sumMismatch.slice(0, 4)));

      var heroN = num(document.getElementById("heroVal").textContent);
      var subM = document.getElementById("heroSub").textContent.match(/\$[\d,.]+/g) || [];
      R.info.heroCheck = { hero: heroN, parts: subM.map(num) };
      ok(subM.length === 2 && Math.abs(num(subM[0]) + num(subM[1]) - heroN) < 1e-9,
         "hero subtitle does not add up to the hero number", JSON.stringify(R.info.heroCheck));

      var benefitN = num(document.getElementById("sBenefit").textContent);
      var partsN = num(document.getElementById("sMatch").textContent) +
                   num(document.getElementById("sProfit").textContent) +
                   num(document.getElementById("sStipend").textContent);
      ok(Math.abs(benefitN - partsN) < 1e-9, "benefit strip does not add up",
         benefitN + " vs " + partsN);

      /* the same must hold in cents mode, where the residues are different */
      document.querySelector('#precToggle button[data-prec="2"]').click();
      await wait(300);
      var mism2 = 0;
      [].forEach.call(document.querySelectorAll("#schedTable tbody tr"), function (tr) {
        var c = [].map.call(tr.cells, function (td) { return td.textContent.trim(); });
        if (Math.abs((num(c[4]) + num(c[5]) + num(c[6]) + num(c[7])) - num(c[8])) > 1e-6) mism2++;
      });
      R.info.rowSumMismatchesCents = mism2;
      ok(mism2 === 0, "schedule rows do not add up in cents mode", String(mism2));
      document.querySelector('#precToggle button[data-prec="0"]').click();
      await wait(300);

      stage("roundtrip");
      /* ---- the hours/week field must round-trip its own output ---- */
      var hw = document.getElementById("hWeek"), hx2 = document.getElementById("hExact");
      var roundTrip = [];
      var probeHours = [85, 155, 224, 293, 363, 432, 501, 571, 625, 1, 7, 137];
      for (var pi = 0; pi < probeHours.length; pi++) {
        setSlider(probeHours[pi]);
        await wait(90);
        var shown = hw.value;
        hw.value = shown;
        hw.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(90);
        if (Number(hx2.value) !== probeHours[pi]) {
          roundTrip.push({ h: probeHours[pi], shown: shown, became: hx2.value });
        }
      }
      R.info.perWeekRoundTrip = roundTrip;
      ok(roundTrip.length === 0, "hours/week field does not round-trip its own value",
         JSON.stringify(roundTrip.slice(0, 3)));

      stage("reverse");
      /* ---- the reverse table's current row must actually get marked ---- */
      var revJump = document.querySelector("#revTable tbody .hjump");
      revJump.focus();
      var revH = revJump.getAttribute("data-h");
      revJump.click();
      await wait(300);
      R.info.reverseMarked = !!document.querySelector('#revTable tbody tr.is-current');
      ok(R.info.reverseMarked, "reverse table never marks its current row");
      R.info.schedMarkedToo = !!document.querySelector("#schedTable tbody tr.is-current") ||
                              Number(revH) % state_step_guess() !== 0;
      /* ---- and the keyboard must not lose its place when the table rebuilds ---- */
      R.info.focusAfterJump = document.activeElement && document.activeElement.className;
      ok(document.activeElement && document.activeElement.classList &&
         document.activeElement.classList.contains("hjump"),
         "row jump threw focus away when it rebuilt the table", String(R.info.focusAfterJump));

      stage("jumplabel");
      /* ---- the jump button must still announce the hour it jumps to ---- */
      var anyJump = document.querySelector("#schedTable tbody .hjump");
      R.info.jumpLabel = anyJump.getAttribute("aria-label");
      ok(R.info.jumpLabel.indexOf(anyJump.textContent.trim()) === 0,
         "row jump's accessible name drops its visible text", R.info.jumpLabel);

      stage("chartaria");
      /* ---- the chart's live text alternative must be its NAME ---- */
      var chart = document.getElementById("mixChart");
      R.info.chartLabelled = chart.getAttribute("aria-labelledby");
      R.info.chartLabel = (chart.getAttribute("aria-label") || "").slice(0, 60);
      ok(!chart.getAttribute("aria-labelledby"),
         "aria-labelledby would override the live aria-label", String(R.info.chartLabelled));
      ok(/\d/.test(chart.getAttribute("aria-label") || ""),
         "chart aria-label carries no numbers", R.info.chartLabel);

      stage("pto");
      /* Earlier stages leave the model at whatever they last clicked; every figure
         below is hand-computed for the defaults at 250 hours. */
      document.getElementById("resetBtn").click();
      await wait(400);

      /* ---- PTO ----
         160 hours = 4 weeks at a 40h basis, so 48 working weeks and 1,920 worked
         hours before overtime. It must move the per-week conversion and the
         effective rate, and must move NOTHING with a dollar sign that the
         workbook defines. */
      function nTxt(id) { return Number(String(document.getElementById(id).textContent).replace(/[$,\sh]/g, "")); }
      R.info.pto = {
        worked: document.getElementById("sWorked").textContent,
        eff: document.getElementById("sEff").textContent,
        value: document.getElementById("sPto").textContent,
        perWeek: document.getElementById("hWeek").value,
        field: document.getElementById("aPto").value
      };
      ok(R.info.pto.field === E.ptoField, "PTO field not prefilled", R.info.pto.field);
      ok(R.info.pto.worked === E.worked, "worked hours wrong (stdHours - PTO + OT)", R.info.pto.worked);
      ok(R.info.pto.eff === E.eff, "effective hourly wrong", R.info.pto.eff);
      ok(R.info.pto.value === E.ptoPay, "PTO nominal value wrong", R.info.pto.value);
      ok(R.info.pto.perWeek === E.perWeek, "per-week not using working weeks", R.info.pto.perWeek);

      /* Setting PTO to zero must restore the 52-week figure and leave every
         workbook number untouched. */
      var heroBefore = document.getElementById("heroVal").textContent;
      var otBefore = document.getElementById("sOt").textContent;
      var matchBefore = document.getElementById("sMatch").textContent;
      var homeBefore = document.getElementById("tHome").textContent;
      var ptoField = document.getElementById("aPto");
      ptoField.value = "0";
      ptoField.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(350);
      R.info.ptoZero = {
        perWeek: document.getElementById("hWeek").value,
        worked: document.getElementById("sWorked").textContent,
        heroSame: document.getElementById("heroVal").textContent === heroBefore,
        otSame: document.getElementById("sOt").textContent === otBefore,
        matchSame: document.getElementById("sMatch").textContent === matchBefore,
        homeSame: document.getElementById("tHome").textContent === homeBefore
      };
      ok(R.info.ptoZero.perWeek === E.perWeekNoPto, "per-week did not fall back to 52 weeks at PTO 0", R.info.ptoZero.perWeek);
      ok(R.info.ptoZero.worked === E.workedNoPto, "worked hours wrong at PTO 0", R.info.ptoZero.worked);
      ok(R.info.ptoZero.heroSame && R.info.ptoZero.otSame && R.info.ptoZero.matchSame && R.info.ptoZero.homeSame,
         "PTO changed a figure it must not touch", JSON.stringify(R.info.ptoZero));

      /* The per-week field must still round-trip against the NEW divisor. */
      ptoField.value = "160";
      ptoField.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(350);
      var hw2 = document.getElementById("hWeek"), hx3 = document.getElementById("hExact");
      var rtFails = [];
      var probe2 = [85, 155, 250, 293, 400, 625];
      for (var pj = 0; pj < probe2.length; pj++) {
        setSlider(probe2[pj]);
        await wait(90);
        var shown2 = hw2.value;
        hw2.value = shown2;
        hw2.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(90);
        if (Number(hx3.value) !== probe2[pj]) rtFails.push({ h: probe2[pj], shown: shown2, became: hx3.value });
      }
      R.info.ptoRoundTrip = rtFails;
      ok(rtFails.length === 0, "per-week round trip broke with the PTO divisor", JSON.stringify(rtFails));

      /* An impossible PTO must degrade to a dash and a warning, not a wrong number. */
      ptoField.value = "2080";
      ptoField.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(350);
      R.info.ptoImpossible = {
        eff: document.getElementById("sEff").textContent,
        perWeekDisabled: document.getElementById("hWeek").disabled,
        warned: !document.getElementById("warnBox").hidden
      };
      ok(R.info.ptoImpossible.eff === "—", "effective rate should be a dash when PTO eats the year", R.info.ptoImpossible.eff);
      ok(R.info.ptoImpossible.perWeekDisabled, "per-week field should be disabled when there are no working weeks");
      ok(R.info.ptoImpossible.warned, "no warning for PTO >= standard hours");
      document.getElementById("resetBtn").click();
      await wait(400);

      stage("tax");
      /* Earlier stages have moved the model around (a row jump left it at 85
         hours), and every figure below is hand-computed for the defaults at 250.
         Put it back first. */
      document.getElementById("resetBtn").click();
      await wait(400);
      ok(document.getElementById("hExact").value === "250", "reset did not return to 250 hours",
         document.getElementById("hExact").value);

      /* ---- take-home, against the 2026 IRS / DC tables ---- */
      function txtNum(id) { var n = Number(String(document.getElementById(id).textContent).replace(/[$,%\s]/g, "")); return n; }
      R.info.tax = {
        home: document.getElementById("tHome").textContent,
        tax: document.getElementById("tTax").textContent,
        eff: document.getElementById("tEff").textContent,
        marg: document.getElementById("tMarg").textContent
      };
      ok(R.info.tax.home === E.homeStr, "take-home wrong", R.info.tax.home);
      ok(R.info.tax.tax === E.taxStr, "total tax wrong", R.info.tax.tax);
      ok(Math.abs(parseFloat(R.info.tax.marg) - E.margValue) <= E.margTolerance,
         "marginal rate wrong", R.info.tax.marg + " vs " + E.margValue + "%");

      /* After-tax per-hour figures, PTO inside the divisor (2,170 hours worked).
         take-home / hours worked, OT rate x (1 - marginal), take-home / working
         weeks. */
      R.info.taxHourly = {
        eff: document.getElementById("tEffHourly").textContent,
        otNet: document.getElementById("tOtNet").textContent,
        perWeek: document.getElementById("tPerWeek").textContent
      };
      ok(R.info.taxHourly.eff === E.taxEff, "after-tax effective hourly wrong", R.info.taxHourly.eff);
      ok(R.info.taxHourly.otNet === E.taxOtNet, "after-tax net per OT hour wrong", R.info.taxHourly.otNet);
      ok(R.info.taxHourly.perWeek === E.taxPerWeek, "after-tax per working week wrong", R.info.taxHourly.perWeek);

      /* the waterfall must reconcile: every line above the last must sum to it */
      var wfRows = [].map.call(document.querySelectorAll("#waterfall tbody tr"), function (tr) {
        return Number(String(tr.cells[1].textContent).replace(/[$,\s]/g, ""));
      });
      var wfSum = wfRows.slice(0, -1).reduce(function (a, b) { return a + b; }, 0);
      R.info.waterfall = { lines: wfRows.length, sum: wfSum, total: wfRows[wfRows.length - 1] };
      ok(wfRows.length === 8, "waterfall should have 8 lines", String(wfRows.length));
      ok(Math.abs(wfSum - wfRows[wfRows.length - 1]) < 1e-9, "waterfall does not reconcile",
         JSON.stringify(R.info.waterfall));
      var badMoney = [].filter.call(document.querySelectorAll("#waterfall tbody td"), function (td) {
        return /\$-/.test(td.textContent);
      }).length;
      ok(badMoney === 0, "a waterfall line printed the sign inside the currency symbol", String(badMoney));
      var negZero = [].filter.call(document.querySelectorAll("#waterfall tbody td"), function (td) {
        return td.textContent.trim() === "-$0" || td.textContent.trim() === "-0.0%";
      }).length;
      ok(negZero === 0, "a waterfall line printed negative zero", String(negZero));

      /* FICA toggle must move the number by exactly the FICA line */
      var ficaLine = wfRows[6];
      document.querySelector('#ficaToggle button[data-on="0"]').click();
      await wait(320);
      var homeNoFica = txtNum("tHome");
      R.info.ficaToggle = { with: E.home, without: homeNoFica, line: ficaLine };
      ok(Math.abs(homeNoFica - (E.home - ficaLine)) < 1.5, "FICA toggle did not move take-home by the FICA line",
         JSON.stringify(R.info.ficaToggle));
      document.querySelector('#ficaToggle button[data-on="1"]').click();
      await wait(320);
      ok(txtNum("tHome") === E.home, "take-home did not return after re-enabling FICA", String(txtNum("tHome")));

      /* OBBBA toggle: removing the deduction raises federal taxable income by it,
         so the cost is that income taxed at the band(s) it moves through — see
         E.otDeduction / E.otMarginalBand. */
      document.querySelector('#otDedToggle button[data-on="0"]').click();
      await wait(320);
      R.info.otToggle = { off: txtNum("tHome"), delta: E.home - txtNum("tHome") };
      ok(Math.abs(R.info.otToggle.delta - E.otDeduction * E.otMarginalBand) < 2,
         "OBBBA toggle delta wrong", JSON.stringify(R.info.otToggle));
      document.querySelector('#otDedToggle button[data-on="1"]').click();
      await wait(320);

      /* the bracket editor must be live */
      var fedRows = document.querySelectorAll("#fedBrackets tbody tr").length;
      var dcRows = document.querySelectorAll("#dcBrackets tbody tr").length;
      R.info.brackets = { fed: fedRows, dc: dcRows };
      ok(fedRows === 7 && dcRows === 7, "bracket tables wrong size", JSON.stringify(R.info.brackets));
      R.info.yearTag = document.getElementById("taxYearTag").textContent;
      ok(R.info.yearTag.indexOf(",") === -1, "the tax year printed with a thousands separator", R.info.yearTag);
      var firstRate = document.querySelector('#fedBrackets input[data-f="rate"]');
      firstRate.value = "20";
      firstRate.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(320);
      R.info.bracketEdit = txtNum("tHome");
      /* the bottom band is 12,400 wide; 10% -> 20% costs another $1,240 */
      ok(Math.abs((E.home - R.info.bracketEdit) - E.bottomBandCost) < 2,
         "editing the bottom federal rate did not move tax by the right amount",
         String(E.home - R.info.bracketEdit));
      document.getElementById("taxResetBtn").click();
      await wait(350);
      ok(txtNum("tHome") === E.home, "tax reset did not restore the defaults", String(txtNum("tHome")));

      stage("print");
      /* ---- print ----
         WKWebView treats a file:// stylesheet as cross-origin, so .cssRules throws
         here and counting @media print blocks from inside the page is not a signal
         either way. Record what IS knowable; the real print check is a headless
         render to PDF (tools/wkprint.swift), because gotcha 19 is only visible on
         paper. */
      R.info.styleSheets = document.styleSheets.length;
      R.info.cssRulesReadable = (function () {
        try { return !!document.styleSheets[0].cssRules; } catch (e) { return false; }
      }());
      if (R.info.cssRulesReadable) {
        var printBlocks = 0;
        for (var i = 0; i < document.styleSheets.length; i++) {
          try {
            var rules = document.styleSheets[i].cssRules;
            for (var j = 0; j < rules.length; j++) {
              if (rules[j].media && String(rules[j].media.mediaText).indexOf("print") !== -1) printBlocks++;
            }
          } catch (e) { /* cross-origin */ }
        }
        R.info.printBlocks = printBlocks;
        ok(printBlocks >= 2, "no @media print block reached the page", String(printBlocks));
      }
      ok(R.info.styleSheets === 3, "wrong number of stylesheets loaded", String(R.info.styleSheets));

      try { localStorage.removeItem("ot_calc_v1"); } catch (e) {}
      finish();
    } catch (e) {
      R.fail.push("EXCEPTION: " + (e && e.message) + " @ " + (e && e.stack || "").split("\n")[1]);
      finish();
    }
  }());
}());
