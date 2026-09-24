# UI refinement acceptance — 2026-09-24

Preserves the existing light/dark palette and calculation model.

## Changes

- Align compact chrome gutters with the page column.
- Fit precise monetary values on narrow screens; stack the nested tax metrics
  at 360px and below and size the hero for the 320px layout.
- Clear donut pin and hover state when clicking the centre, card whitespace or
  elsewhere, clicking the selected item again, or pressing Escape. Escape keeps
  keyboard focus. New pointer movement can preview slices again.
- Add effective tax rate to the collapsed header using the tax panel's existing
  tax-total / cash-compensation calculation and precision. Zero income shows —.
- Keep all three header readouts visible on phones using three compact lines next
  to the controls. Reserve the same height before collapse to prevent page jumps.
- Give the screenshot and acceptance hosts nonpersistent data stores so test
  resets and sample captures are isolated from saved usage.

## Verification

- Existing model suite: 76 passed.
- Existing `tools/checks.js`: source and bundled HTML at 1100×900, 390×840 and
  430×932; checks real WKWebView rendering and production interactions.
- `tools/header-checks.js`: 320, 390, 430, 560, 561, 600, 820, 821 and 1100px
  widths at 900px height. Checks rate values in both precisions, zero income,
  panel parity, visible readouts, clipping, controls overlap, page overflow and
  stable chrome height during collapse.
- `tools/mix-checks.js`: production slice/legend event handlers, blank/centre/
  outside dismissal, repeat click, Escape and focus, moving off a slice, switching
  selection and unchanged result. The original implementation failed this probe.
- Real browser screenshots: desktop collapsed header, 390px precise tax panel,
  and 320px three-line compact header. Temporary viewport overrides restored.
- Native installed App: startup from `/Applications/薪酬测算.app`, saved inputs
  restored, desktop collapsed header visually checked. Builds are ad-hoc signed.

Run the probes with the repository's native host, for example:

```sh
swiftc -O tools/wkcheck.swift -o /tmp/tc-wkcheck
/tmp/tc-wkcheck "$PWD/index.html" "$PWD/tools/header-checks.js" 320 900
/tmp/tc-wkcheck "$PWD/index.html" "$PWD/tools/mix-checks.js" 390 840
```

The local `artifacts/ui-polish/` folder retains raw runs and sample screenshots;
these are deliberately not committed. No personal native-app values are included
in this report or the committed tests. Physical iPhone touch/safe-area behaviour,
system text scaling, arbitrary extreme amounts and native export/print dialogs
were not exercised. This is a local build/install acceptance, not a web deployment.
