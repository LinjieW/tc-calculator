/* ============================================================
   ui.js — the controllers that make the CSS behave like a native app.
   Zero dependencies, zero network. Single IIFE exposes window.UIKit.

   Pairs with motion.js (window.Motion). Motion is OPTIONAL: every
   controller here falls back to an instant, un-animated placement when
   it is missing, so a page that ships only ui.js is still correct —
   just not fluid.

   CSS contract (what the stylesheet must provide for each part).
   Every line below was checked against components.css:
     segmented   .segmented (position:relative) > .seg-thumb (absolutely
                 positioned; the controller writes width/height/transform/
                 opacity, and the stylesheet must NOT transition transform --
                 a CSS transition and the spring both writing transform every
                 frame is what makes the thumb stutter)
     chrome      .topbar, .topbar.scrolled, .topbar.title-shown,
                 .topbar .topbar-title, .page-title, .page-title.echoed
                 (the page-title selector MUST match the one components.css
                 styles, or the collapse silently never engages -- nothing
                 errors, the echo just never appears),
                 the optional secondary bar .subbar + .subbar.scrolled,
                 and the JS-written --topbar-h custom property
     edgeFade    .fade-l / .fade-r on the scroller. components.css scopes the
                 masks to .h-scroll.fade-l / .h-scroll.fade-r, so the scroller
                 itself must also carry .h-scroll or the toggled class styles
                 nothing.
     popover     .pop-anchor (position:relative) CONTAINING its .popover, plus
                 the JS-written --hx custom property: components.css applies it
                 as margin-left on .popover and counter-shifts the ::after
                 arrow by -hx. Nothing else writes --hx -- without
                 UIKit.popover() the clamp sits at its 0px fallback and a
                 popover near a window edge runs off screen.
     sliders     input[type=range] reading the --fill percentage
     riseIn      @keyframes ui-rise
     sheet       the scrim element carries .hidden (closed) and .closing
                 (reverse-path exit), and a global .hidden{display:none}
                 must exist; the animated panel lives inside it (default
                 .sheet -- this MUST match the selector components.css
                 animates on .scrim.closing, or the animationend listener
                 never attaches and every close silently falls through to
                 the 400ms starvation timer)
     theme       html[data-theme] (components.css keys :root[data-theme="dark"]),
                 html.theme-easing (the transition burst lives in tokens.css)
     toast       .toast, .toast.err, .toast.leaving, .toast.hidden
   Every selector above is an option except .seg-thumb and the state
   classes; rename them in one place if your stylesheet disagrees.
   ============================================================ */
(function () {
  "use strict";

  var reduceMQ = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)")) || null;
  function reduceMotion() {
    if (window.Motion && Motion.prefersReducedMotion) return Motion.prefersReducedMotion();
    return !!(reduceMQ && reduceMQ.matches);
  }

  // Stand-in used when motion.js is absent: same surface as a spring, but every
  // move lands immediately. Controllers below never branch on "do we have Motion" —
  // they just ask for a spring and get one that may not animate.
  function stubSpring() {
    var x = 0, cb = null;
    var api = {
      set: function (v) { x = v; if (cb) cb(x, 0); return api; },
      to: function (v, o) { x = v; if (cb) cb(x, 0); if (o && o.onRest) o.onRest(); return api; },
      stop: function () { return api; },
      onFrame: function (f) { cb = f; return api; },
      value: function () { return x; },
      velocity: function () { return 0; },
      isAnimating: function () { return false; }
    };
    return api;
  }
  function spring(token) {
    return window.Motion ? Motion.spring(token) : stubSpring();
  }

  function el(target, root) {
    if (!target) return null;
    if (target.nodeType === 1) return target;
    return (root || document).querySelector(target);
  }

  /* ---------------------------------------------------------- segmented */

  // Every group registered with rehomeOnShow, so a page transition can re-place
  // the thumbs of controls that just became visible. See rehomeSegments().
  var rehomeList = [];

  // iOS-style segmented control: a sliding thumb rides behind the active segment.
  // ONE controller serves both shapes — a horizontal pill row and a vertical rail —
  // because the thumb is driven by TWO springs (X and Y), and a horizontal group is
  // simply the case where the Y spring never has anywhere to go.
  //
  //   UIKit.segmented(container, {
  //     segment: 'button',                              // selector for the segments
  //     isActive: function (seg) { ... },               // which one is on
  //     rehomeOnShow: true                              // lives inside a page that toggles display
  //   })
  //
  // isActive defaults to the two conventions worth supporting: aria-pressed="true"
  // (buttons that toggle in place) and .active (rows whose markup is regenerated).
  function segmented(container, opts) {
    container = el(container);
    if (!container) return null;
    opts = opts || {};
    var segSel = opts.segment || "button";
    var isActive = opts.isActive || function (b) {
      return b.getAttribute("aria-pressed") === "true" ||
             b.getAttribute("aria-selected") === "true" ||
             b.classList.contains("active");
    };

    var sx = spring("SNAPPY"), sy = spring("SNAPPY");
    var thumb = null;
    // placed = "the thumb has a real home". Without it the very first placement
    // would animate from 0,0 — the thumb would visibly fly in from the corner on
    // load. The first reposition therefore always sets, never springs.
    var placed = false;
    var pending = false, pendAnim = true;

    function paint() {
      if (thumb) thumb.style.transform = "translate(" + sx.value() + "px," + sy.value() + "px)";
    }
    sx.onFrame(paint); sy.onFrame(paint);

    function ensureThumb() {
      thumb = container.querySelector(":scope > .seg-thumb");
      if (!thumb) {
        thumb = document.createElement("div");
        thumb.className = "seg-thumb";
        // Seed the transform BEFORE insertion. A group whose innerHTML is
        // regenerated loses its thumb; a fresh one with no transform paints one
        // frame at 0,0 before the spring's first frame lands. That flash is the
        // whole reason this line exists.
        thumb.style.transform = "translate(" + sx.value() + "px," + sy.value() + "px)";
        container.insertBefore(thumb, container.firstChild);
      }
    }

    function activeSeg() {
      var list = container.querySelectorAll(segSel);
      for (var i = 0; i < list.length; i++) if (isActive(list[i])) return list[i];
      return null;
    }

    function reposition(animate) {
      ensureThumb();
      var a = activeSeg();
      // No active segment, or a zero-width one (the group is display:none right
      // now) — hide the thumb rather than parking it somewhere wrong.
      if (!a || !a.offsetWidth) { thumb.style.opacity = "0"; return; }
      thumb.style.opacity = "1";
      thumb.style.width = a.offsetWidth + "px";
      thumb.style.height = a.offsetHeight + "px";
      if (animate && placed) { sx.to(a.offsetLeft); sy.to(a.offsetTop); }
      else { sx.set(a.offsetLeft); sy.set(a.offsetTop); }
      placed = true;
    }

    // Coalesce to one placement per microtask. A single user click can fire several
    // mutations (clear aria-pressed on the old segment, set it on the new, swap a
    // class) and each would otherwise retarget the springs, which reads as a stutter.
    // The pending run keeps animate=false if ANY caller in the batch asked for it —
    // a resize inside the batch means the geometry moved under us, and a spring
    // toward geometry the user never saw is a lie.
    function schedule(animate) {
      pendAnim = pending ? (pendAnim && animate) : animate;
      if (pending) return;
      pending = true;
      Promise.resolve().then(function () {
        pending = false;
        var an = pendAnim; pendAnim = true;
        reposition(an);
      });
    }

    var mo = new MutationObserver(function () { schedule(true); });
    mo.observe(container, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-pressed", "class", "aria-selected"]
    });

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { schedule(false); });
      ro.observe(container);
    }

    var rehome = function () { reposition(false); };
    if (opts.rehomeOnShow) rehomeList.push(rehome);

    reposition(false);

    return {
      reposition: rehome,
      destroy: function () {
        mo.disconnect();
        if (ro) ro.disconnect();
        var i = rehomeList.indexOf(rehome);
        if (i >= 0) rehomeList.splice(i, 1);
      }
    };
  }

  // Re-place every thumb in a group that may have just become visible.
  // ResizeObserver does NOT fire when an element becomes visible through an
  // ANCESTOR's display toggle — the observed box never changed size, it only
  // started having one. Call this after any page/view transition.
  function rehomeSegments() {
    for (var i = 0; i < rehomeList.length; i++) rehomeList[i]();
  }

  /* ------------------------------------------------------------- chrome */

  var chromeInstances = [];

  // The COMPLETE option surface of chrome(). Anything not on this list is ignored,
  // which is why an unknown key warns below: a plausible-looking option that does
  // nothing (a `title:` meant for titleSlot, say) leaves the collapse dead with no
  // error to explain it.
  var CHROME_OPTS = { bar: 1, titleSlot: 1, largeTitle: 1, sticky: 1 };

  // Scroll state for the top bar plus Apple's large-title collapse: once the page's
  // big title scrolls under the bar, the bar echoes it compactly, and drops it again
  // on scroll-up. The echo is a cross-fade in both directions, hence .echoed.
  //
  //   UIKit.chrome({
  //     bar:        '.topbar',        // the bar element itself
  //     titleSlot:  '.topbar-title',  // the compact echo slot INSIDE the bar
  //     largeTitle: '.page-title',    // the page's big title that collapses into it
  //     sticky:     '.subbar'         // optional second bar that also gets .scrolled
  //   })
  function chrome(opts) {
    opts = opts || {};
    for (var k in opts) if (!CHROME_OPTS[k]) console.warn(
      'UIKit.chrome: unknown option "' + k + '" is ignored — expected bar / titleSlot / largeTitle / sticky');
    var barSel = opts.bar || ".topbar";
    var slotSel = opts.titleSlot || ".topbar-title";
    var titleSel = opts.largeTitle || ".page-title";
    var stickySel = opts.sticky || ".subbar"; // optional secondary bar that also gets .scrolled

    // --topbar-h is measured in JS because nothing in CSS can name "whatever this
    // bar ends up being". Its height depends on its own content (a button row that
    // appears only on some pages) and it wraps on narrow viewports, so the value
    // that scroll-margin, sticky offsets and page padding need is only knowable
    // after layout. Re-measure on resize and after any content change.
    function measure() {
      var tb = document.querySelector(barSel);
      if (tb) document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
    }

    function update() {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var tb = document.querySelector(barSel);
      if (tb) tb.classList.toggle("scrolled", y > 2);

      var sub = stickySel ? document.querySelector(stickySel) : null;
      if (sub && tb) {
        // Only once it has actually stuck to the bar, and only while it is on screen.
        sub.classList.toggle("scrolled",
          sub.offsetParent !== null && sub.getBoundingClientRect().top <= tb.getBoundingClientRect().bottom + 1);
      }

      if (!tb) return;
      var slot = tb.querySelector(slotSel);
      if (!slot) return;

      // First VISIBLE large title in document order. offsetParent === null means the
      // page holding it is display:none, and a hidden title must not drive the bar.
      var big = null;
      var all = document.querySelectorAll(titleSel);
      for (var i = 0; i < all.length; i++) {
        if (all[i].offsetParent !== null) { big = all[i]; break; }
      }

      var show = false;
      if (big) {
        show = big.getBoundingClientRect().bottom < tb.getBoundingClientRect().bottom + 4;
        if (show && slot.textContent !== big.textContent) slot.textContent = big.textContent;
      }
      tb.classList.toggle("title-shown", show);

      // Two-way cross-fade: ONLY the echoed title fades out. A page can hold several
      // large titles, and the ones still fully in view must stay at full strength —
      // fading all of them is how the page below the bar goes grey for no reason.
      var echoed = document.querySelectorAll(titleSel + ".echoed");
      for (var j = 0; j < echoed.length; j++) {
        if (echoed[j] !== big || !show) echoed[j].classList.remove("echoed");
      }
      if (big && show) big.classList.add("echoed");
    }

    var onScroll = function () { update(); };
    var onResize = function () { measure(); update(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    measure(); update();

    var inst = {
      measure: measure,
      update: update,
      destroy: function () {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        var i = chromeInstances.indexOf(inst);
        if (i >= 0) chromeInstances.splice(i, 1);
      }
    };
    chromeInstances.push(inst);
    return inst;
  }

  /* ----------------------------------------------------------- edgeFade */

  // State-driven edge fades for a horizontal scroller: fade ONLY the side that is
  // actually hiding content. An always-on mask ate the tail of whatever sat flush
  // against the edge — the last digits of a number, the end of a label — even when
  // nothing was scrolled away at all.
  function edgeFade(target) {
    var node = el(target);
    if (!node) return null;
    var update = function () {
      var can = node.scrollWidth - node.clientWidth > 1;
      node.classList.toggle("fade-l", can && node.scrollLeft > 2);
      node.classList.toggle("fade-r", can && node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
    };
    if (!node._edgeFadeWired) {
      node._edgeFadeWired = true;
      node.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
    }
    update();
    return update;
  }

  /* ------------------------------------------------------------ popover */

  // Keep a popover inside the viewport. The box is CSS-centred on its anchor
  // (left:50% + translateX(-50%)), so an anchor near a window edge pushes it off
  // screen. Just before hover/focus reveals it, measure and clamp the horizontal
  // shift into --hx; the stylesheet folds --hx in as MARGIN-LEFT and counter-shifts
  // the ::after arrow by -hx, so the arrow keeps pointing at the anchor while the
  // box slides sideways. (Why margin and not part of the transform: calc(% + px)
  // inside translateX does not resolve reliably in WebKit — the percentage silently
  // wins and the box jumps back under the anchor or lands off screen. See
  // references/gotchas.md.)
  //
  // The measurement is deliberately TRANSFORM-INDEPENDENT: the centre comes from the
  // ANCHOR's rect, the width from the popover's offsetWidth. Reading the popover's
  // own getBoundingClientRect() would measure it through its hidden
  // translateX(-50%) scale(.9) state and clamp against a corrupted width and origin.
  // offsetWidth is still real while the box is hidden because it is hidden with
  // visibility, not display — a display:none popover would measure 0.
  var POP_MARGIN = 8;          // px of breathing room kept on both viewport edges
  var popSel = ".popover";     // the box; set by popover(), read by both functions

  function positionPopover(anchor) {
    anchor = el(anchor);
    if (!anchor) return;
    var pop = anchor.querySelector(popSel);
    if (!pop) return;
    var r = anchor.getBoundingClientRect(), center = r.left + r.width / 2, w = pop.offsetWidth;
    var dx = 0;
    if (center - w / 2 < POP_MARGIN) dx = POP_MARGIN - (center - w / 2);
    else if (center + w / 2 > window.innerWidth - POP_MARGIN) dx = (window.innerWidth - POP_MARGIN) - (center + w / 2);
    pop.style.setProperty("--hx", dx.toFixed(1) + "px");
  }

  //   UIKit.popover({ anchor: '.pop-anchor', popover: '.popover' })
  // Arms the clamp for the whole document, once.
  var popArmed = false;
  function popover(opts) {
    opts = opts || {};
    var anchorSel = opts.anchor || ".pop-anchor";
    popSel = opts.popover || popSel;
    if (popArmed) return;      // the delegation is document-wide; arming twice only doubles the work
    popArmed = true;
    var from = function (e) {
      var t = e.target, a = t && t.closest && t.closest(anchorSel);
      if (a) positionPopover(a);
    };
    // Delegated from document so popovers in markup built AFTER load are covered
    // without re-wiring, and in the CAPTURE phase so the clamp still runs when a
    // handler nearer the target stops propagation. This positions just BEFORE the
    // reveal rather than on a timer: the event arrives before :hover / :focus has
    // painted, so the box is never seen at the wrong offset.
    // focusin is not redundant with pointerover — a keyboard user reveals the box
    // through :focus and must get exactly the same clamp as a mouse user.
    document.addEventListener("pointerover", from, true);
    document.addEventListener("focusin", from, true);
  }

  /* ------------------------------------------------------------ sliders */

  // Set --fill so the CSS gradient fills the track up to the current value.
  function paintSlider(node) {
    node = el(node);
    if (!node) return;
    var lo = parseFloat(node.min), hi = parseFloat(node.max), v = parseFloat(node.value);
    var min = isNaN(lo) ? 0 : lo, max = isNaN(hi) ? 100 : hi;
    var pct = max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
    node.style.setProperty("--fill", pct + "%");
  }
  function paintSliders(root) {
    var list = (el(root) || document).querySelectorAll("input[type=range]");
    for (var i = 0; i < list.length; i++) paintSlider(list[i]);
  }
  // Delegated so sliders rendered later are covered without re-wiring; capture
  // phase so it still runs when a handler on the input stops propagation.
  var slidersWatched = false;
  function watchSliders() {
    if (slidersWatched) return;
    slidersWatched = true;
    document.addEventListener("input", function (e) {
      if (e.target && e.target.type === "range") paintSlider(e.target);
    }, true);
    paintSliders();
  }

  /* ------------------------------------------------------------- refresh */

  // What a page/view transition owes the UI: thumbs re-placed (their container may
  // have just gained a size), sliders painted (they may have just been rendered),
  // chrome re-measured (the bar's height can differ per page) and the large-title
  // echo recomputed for the newly visible title.
  function refresh(root) {
    rehomeSegments();
    paintSliders(root);
    for (var i = 0; i < chromeInstances.length; i++) {
      chromeInstances[i].measure();
      chromeInstances[i].update();
    }
  }

  /* ------------------------------------------------------- reveal gating */

  var animSeen = Object.create(null);

  // A keyed reveal plays ONCE PER RESULT OBJECT. Tab returns, cursor drags and
  // language switches all re-render from the SAME object and must not replay the
  // show — a reveal narrates "new data arrived", nothing else. Identity is the
  // test, not equality: a recomputed-but-identical result IS new data.
  function animOnce(key, obj) {
    if (obj == null) return false;
    if (animSeen[key] === obj) return false;
    animSeen[key] = obj;
    return true;
  }
  animOnce.reset = function (key) {
    if (key == null) animSeen = Object.create(null);
    else delete animSeen[key];
  };

  /* -------------------------------------------------------------- riseIn */

  // Staggered block entrance. The WHOLE unit rises into place together, then its
  // contents draw within it — animating only the inner marks while the surrounding
  // block popped is what read as abrupt.
  //   UIKit.riseIn(header, chart, caption)
  function riseIn() {
    if (reduceMotion()) return;
    var i = 0;
    for (var n = 0; n < arguments.length; n++) {
      (function (node) {
        if (!node) return;
        var delay = i++ * 70;
        node.style.animation = "none"; void node.offsetWidth; // restart cleanly on re-runs
        node.style.animation = "ui-rise .32s cubic-bezier(.32,.72,0,1) " + delay + "ms both";
        var onEnd;
        var done = function () {
          node.style.animation = "";                 // back to the element's natural state
          node.removeEventListener("animationend", onEnd);
          clearTimeout(node._riseT);
        };
        onEnd = function (e) { if (e.target === node) done(); };
        node.addEventListener("animationend", onEnd);
        clearTimeout(node._riseT);
        // Safety net. animation-fill-mode:both holds the block at opacity 0 until
        // something clears the inline animation — and a throttled or backgrounded
        // tab can skip the animationend event entirely. Without this timer the
        // block stays invisible forever, with no error anywhere to explain it.
        node._riseT = setTimeout(done, delay + 500);
      })(arguments[n]);
    }
  }

  /* -------------------------------------------------------------- sheets */

  // A close that is still winding down owns a pending timer AND an animationend
  // listener. Reopening before either fires would let the old close land on the
  // NEWLY opened sheet and hide it, so both handles live on the element and every
  // open disarms them first.
  function cancelSheetClose(m) {
    if (m._closeT != null) { clearTimeout(m._closeT); m._closeT = null; }
    if (m._closeEnd) {
      var panel = m.querySelector(m._panelSel || ".sheet");
      if (panel) panel.removeEventListener("animationend", m._closeEnd);
      m._closeEnd = null;
    }
  }

  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
                  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function focusables(m) {
    var out = [];
    var list = m.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < list.length; i++) if (list[i].offsetParent !== null) out.push(list[i]);
    return out;
  }

  function sheetKeys(e) {
    var m = e.currentTarget;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sheetClose(m); return; }
    if (e.key !== "Tab") return;
    // Trap: a sheet is modal, so Tab must cycle inside it. Falling out to the page
    // behind leaves the keyboard user driving content they cannot see.
    var f = focusables(m);
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    var next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
    e.preventDefault();
    f[next].focus({ preventScroll: true });
  }

  //   UIKit.sheet.open(el, {panel: '.sheet', focus: el|selector})
  function sheetOpen(target, opts) {
    var m = el(target);
    if (!m) return;
    opts = opts || {};
    m._panelSel = opts.panel || m._panelSel || ".sheet";
    var opener = document.activeElement;
    cancelSheetClose(m);
    // Only remember the opener on a real open. Re-opening an already-open sheet
    // would otherwise overwrite it with something inside the sheet, and the close
    // would return focus into a detached corner of the page.
    if (m.classList.contains("hidden")) m._opener = opener;
    m.classList.remove("hidden", "closing");
    if (!m._keysWired) { m._keysWired = true; m.addEventListener("keydown", sheetKeys); }
    var first = opts.focus ? el(opts.focus, m) : focusables(m)[0];
    if (first) first.focus({ preventScroll: true });
  }

  // Exit plays the reverse path of the entrance, then hides. Esc, the scrim and the
  // close button all share this one path — three exits that look different is how a
  // sheet stops feeling like an object with a position.
  function sheetClose(target) {
    var m = el(target);
    if (!m) return;
    if (m.classList.contains("hidden") || m.classList.contains("closing")) return;
    var finish = function () {
      cancelSheetClose(m);
      m.classList.remove("closing");
      m.classList.add("hidden");
      // Restore focus to whatever opened it. isConnected because the opener may
      // have been re-rendered away while the sheet was up; focusing a detached
      // node silently drops focus to <body>.
      if (m._opener && m._opener.isConnected) m._opener.focus({ preventScroll: true });
      m._opener = null;
    };
    if (reduceMotion()) { finish(); return; }
    var panel = m.querySelector(m._panelSel || ".sheet");
    m._closeEnd = function (e) { if (e.target === panel) finish(); };
    if (panel) panel.addEventListener("animationend", m._closeEnd); else m._closeEnd = null;
    m._closeT = setTimeout(finish, 400); // animationend never arrives if rAF is paused
    m.classList.add("closing");
  }

  /* --------------------------------------------------------------- theme */

  // Dark <-> light is a brightness jump; cross-fade the flip instead of flashing it.
  // The easing class arms broad color transitions for just this moment, then disarms —
  // leaving them armed would put a lag on every ordinary hover and state change.
  //
  // This function changes APPEARANCE ONLY: no navigation, no DOM rebuild, no
  // recomputation. Re-running the page render to change theme is exactly how you
  // lose the user's scroll position, their open disclosures, half-typed input and
  // focus — all so the colors could change. Let the CSS tokens do it.
  function themeSet(name) {
    var root = document.documentElement;
    root.classList.add("theme-easing");
    clearTimeout(root._themeT);
    root._themeT = setTimeout(function () { root.classList.remove("theme-easing"); }, 380);
    root.dataset.theme = name;
    try { localStorage.setItem("ui_theme", name); } catch (e) { /* private mode: still flips, just not remembered */ }
    return name;
  }
  var theme = {
    get: function () { return document.documentElement.dataset.theme || ""; },
    set: themeSet,
    toggle: function () { return themeSet(theme.get() === "dark" ? "light" : "dark"); },
    // Re-apply the remembered choice. This is NOT the boot path, and cannot be:
    // ui.js loads at the END of the body, so by the time anything here could run,
    // the page has already painted in the wrong theme. The only fix for the boot
    // flash is a tiny BLOCKING inline script in <head>, ahead of first paint:
    //   <script>try{document.documentElement.dataset.theme=localStorage.getItem("ui_theme")||"light"}catch(e){}</script>
    // restore() is for re-applying the choice LATER — after a route change, or
    // anything else that rebuilds or resets <html>'s attributes.
    restore: function (fallback) {
      var saved = null;
      try { saved = localStorage.getItem("ui_theme"); } catch (e) { saved = null; }
      var root = document.documentElement;
      var name = saved || fallback || root.dataset.theme || "light";
      root.dataset.theme = name;   // no easing class: this is not a transition, it is the initial state
      return name;
    }
  };

  /* --------------------------------------------------------------- toast */

  var tT = null, tT2 = null;
  // Enters rising, leaves sinking along the same path. The exit is a two-beat:
  // .leaving fades and sinks, then .hidden removes it. Both timers are cancelled on
  // a fresh toast so rapid messages never fight a wind-down already in flight.
  function toast(msg, isError) {
    if (!msg) return;
    var t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "toast" + (isError ? " err" : "");
    clearTimeout(tT); clearTimeout(tT2);
    tT = setTimeout(function () {
      t.classList.add("leaving");
      tT2 = setTimeout(function () { t.classList.add("hidden"); t.classList.remove("leaving"); }, 260);
    }, 3600);
    return t;
  }

  window.UIKit = {
    segmented: segmented,
    rehomeSegments: rehomeSegments,
    chrome: chrome,
    edgeFade: edgeFade,
    popover: popover,
    positionPopover: positionPopover,
    paintSlider: paintSlider,
    paintSliders: paintSliders,
    watchSliders: watchSliders,
    refresh: refresh,
    animOnce: animOnce,
    riseIn: riseIn,
    sheet: { open: sheetOpen, close: sheetClose },
    theme: theme,
    toast: toast,
    reduceMotion: reduceMotion
  };
})();
