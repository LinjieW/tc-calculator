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


## 2026-09-24 — 中英文切换

- 右上角 EN / 中文；语言单独记忆，不调用模型或保存薪酬状态。原地替换文本及可访问性属性，保留结果节点、输入、滚动、展开状态及环形图选择。
- 页面、动态税务/校验提示、图表说明、表格标签、复制/CSV、打印快照和 macOS 菜单支持英文。英文窄屏滑杆标签独立一行；修复 WebKit 翻译后浮层造成的残留横向空白。品牌 tokens 未改。
- `node tools/model.test.js`：76 passed。原有 `tools/checks.js`：源码及单文件 HTML 各在 1100×900、390×840、430×932 下 0 failure。
- 新增 `tools/language-checks.js`：320、390、430、560、600、680、681、820、821、1000、1100px 宽度均通过。检查双语往返、数据不改、节点不重建、图表钉选与滚动保留、动态文案和 ARIA、顶栏不截断/重叠、复制与打印语言。最后针对 320/390/560 重验滑杆可用宽度、IRA 两种退坡提示、非适用税年、新增税档。
- 浏览器真实查看桌面英文构成区、390px 英文首页及税后区，覆盖深浅主题；刷新后保留英文。测试结束恢复中文、原有深色主题与视口。
- `/Applications/薪酬测算.app` 已更新并重启。安装内容与构建产物一致，ad-hoc 签名校验通过。原生实际切换中英文，File 菜单命令为英文；重载后保留英文及原有输入，随后恢复中文。
- 未在实体 iPhone 验收；系统原生保存/打印对话框仍遵循 macOS 系统语言。
