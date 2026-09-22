/* ============================================================
   motion.js — vendored spring engine (Apple fluid-interfaces model).
   Zero dependencies, zero network. Single IIFE exposes window.Motion.
   rAF-driven; it animates only the NUMBER it is told to, and the
   consumer maps that number to transform/opacity.

   Two-parameter model (SwiftUI-style): damping = zeta (1.0 = critical),
   response = 2*pi/omega0 (perceived duration). Per frame we re-solve the
   exact closed form from the CURRENT presentation value + velocity, so
   retargeting mid-flight continues without a jump and is dt-stable.

   Usage:
     var s = Motion.spring("SNAPPY");
     s.onFrame(function (v) { el.style.transform = "translateX(" + v + "px)"; });
     s.set(0);                       // no animation
     s.to(120, { velocity: 800 });   // gesture release hands velocity over
     s.stop();                       // freeze at the current presentation value

   2D motion = TWO independent springs (X and Y each carry their own
   velocity). Never drive a 2D distance from one spring.
   ============================================================ */
(function () {
  "use strict";

  var reduceMQ = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)")) || null;
  function prefersReducedMotion() { return !!(reduceMQ && reduceMQ.matches); }

  // Rest thresholds: below these in both position (px) and velocity (px/s)
  // the spring is snapped to target and considered at rest.
  var REST_DX = 0.05, REST_DV = 0.05;
  var MAX_DT = 1 / 15; // clamp long frames (background tab, GC pause) for stability

  function Spring(opts) {
    opts = opts || {};
    var zeta = opts.damping != null ? opts.damping : 1.0;
    var response = opts.response != null ? opts.response : 0.35;
    var omega0 = (2 * Math.PI) / response;

    var x = 0;        // current presentation value
    var v = 0;        // current velocity (units/s)
    var target = 0;
    var raf = null;
    var last = 0;
    var frameCb = null;
    var restCb = null;

    function emit() { if (frameCb) frameCb(x, v); }

    function settled() {
      return Math.abs(x - target) < REST_DX && Math.abs(v) < REST_DV;
    }

    // Advance the exact analytical solution by dt seconds, in place.
    function integrate(dt) {
      if (dt <= 0) return;
      var c = x - target;          // offset from target
      if (zeta < 1) {              // underdamped
        var wd = omega0 * Math.sqrt(1 - zeta * zeta);
        var e = Math.exp(-zeta * omega0 * dt);
        var cw = Math.cos(wd * dt), sw = Math.sin(wd * dt);
        var A = c;
        var B = (v + zeta * omega0 * c) / wd;
        x = target + e * (A * cw + B * sw);
        v = e * ((B * wd - zeta * omega0 * A) * cw - (A * wd + zeta * omega0 * B) * sw);
      } else if (zeta === 1) {     // critically damped
        var e1 = Math.exp(-omega0 * dt);
        var A1 = c;
        var B1 = v + omega0 * c;
        x = target + (A1 + B1 * dt) * e1;
        v = (B1 - omega0 * (A1 + B1 * dt)) * e1;
      } else {                     // overdamped (two real roots)
        var s = omega0 * Math.sqrt(zeta * zeta - 1);
        var r1 = -zeta * omega0 + s;
        var r2 = -zeta * omega0 - s;
        var A2 = (v - r2 * c) / (r1 - r2);
        var B2 = c - A2;
        var er1 = Math.exp(r1 * dt), er2 = Math.exp(r2 * dt);
        x = target + A2 * er1 + B2 * er2;
        v = A2 * r1 * er1 + B2 * r2 * er2;
      }
    }

    function step(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (dt > MAX_DT) dt = MAX_DT;
      if (dt < 0) dt = 0;
      integrate(dt);
      if (settled()) {
        x = target; v = 0;
        raf = null;
        emit();
        var cb = restCb; restCb = null;
        if (cb) cb();
      } else {
        emit();
        raf = requestAnimationFrame(step);
      }
    }

    var api = {
      // Jump to a value with no animation (also cancels any in-flight run).
      set: function (value) {
        api.stop();
        x = value; v = 0; target = value;
        emit();
        return api;
      },
      // Animate to `value`. opts.velocity injects an initial velocity
      // (e.g. a gesture-release throw, px/s). opts.onRest fires once settled.
      to: function (value, o) {
        o = o || {};
        target = value;
        if (o.velocity != null) v = o.velocity;
        if (prefersReducedMotion()) {   // degrade: snap, no spring
          if (raf) { cancelAnimationFrame(raf); raf = null; }
          x = value; v = 0;
          emit();
          restCb = null;
          if (o.onRest) o.onRest();
          return api;
        }
        restCb = o.onRest || null;
        if (raf == null) { last = performance.now(); raf = requestAnimationFrame(step); }
        return api;
      },
      // Freeze at the current presentation value (keeps x & v for hand-off).
      stop: function () {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        restCb = null;
        return api;
      },
      onFrame: function (cb) { frameCb = cb; return api; },
      // Live retune (e.g. recompute after a language switch); keeps x/v.
      configure: function (damping, resp) {
        if (damping != null) zeta = damping;
        if (resp != null) { response = resp; omega0 = (2 * Math.PI) / response; }
        return api;
      },
      value: function () { return x; },
      velocity: function () { return v; },
      isAnimating: function () { return raf != null; }
    };
    return api;
  }

  // Only these three token triples are allowed app-wide. Adding a fourth is how
  // a motion system starts to feel arbitrary; retune these instead.
  var TOKENS = {
    DEFAULT: { damping: 1.0, response: 0.35 }, // non-gesture (thumb, chevron, ✓)
    SNAPPY:  { damping: 1.0, response: 0.25 }, // segmented thumb, small controls
    THROW:   { damping: 0.8, response: 0.40 }  // gesture momentum release only
  };

  window.Motion = {
    Spring: Spring,
    tokens: TOKENS,
    // Convenience: Motion.spring("SNAPPY") or Motion.spring("SNAPPY", {velocity})
    spring: function (tokenName, overrides) {
      var t = TOKENS[tokenName] || TOKENS.DEFAULT;
      var cfg = { damping: t.damping, response: t.response };
      if (overrides) { for (var k in overrides) if (overrides.hasOwnProperty(k)) cfg[k] = overrides[k]; }
      return Spring(cfg);
    },
    prefersReducedMotion: prefersReducedMotion
  };
})();
