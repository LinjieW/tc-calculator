//  main.swift — the macOS host for the OT compensation calculator.
//
//  A single window holding a WKWebView that loads Resources/web/index.html from
//  inside the bundle. Everything the app knows how to compute lives in that web
//  layer; this file owns the things only AppKit can do — the window, the menu
//  bar, printing, saving a file, and keeping the window's own chrome in the same
//  theme as the page.
//
//  Built with swiftc directly (see build.sh): no Xcode project, no dependencies,
//  no network.

import Cocoa
import WebKit

// MARK: - constants

let kAppName = "薪酬测算"
let kBundleID = "local.otcalc"
let kFrameAutosave = "OTCalcMainWindow"

// MARK: - window controller

final class AppController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {

    var window: NSWindow!
    var webView: WKWebView!

    // MARK: launch

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        buildWindow()
        load()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // Re-open the window from the Dock after the user has closed it.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    private func buildWindow() {
        let cfg = WKWebViewConfiguration()
        let controller = WKUserContentController()

        // The page detects the host by the presence of this handler
        // (window.webkit.messageHandlers.app), so nothing else is injected.
        controller.add(self, name: "app")
        cfg.userContentController = controller
        cfg.suppressesIncrementalRendering = false

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1060, height: 760), configuration: cfg)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        // The page paints its own background a frame later; without this the gap
        // between window-open and first paint is a white flash in dark mode.
        webView.setValue(false, forKey: "drawsBackground")

        // A two-finger swipe must not navigate "back" out of the app's only page.
        webView.allowsBackForwardNavigationGestures = false
        // Pinch-to-zoom from the start, not only after the first menu zoom.
        webView.allowsMagnification = true

        // NOT .fullSizeContentView. Extending the content under the title bar looks
        // seamless in a screenshot and is wrong to use: the traffic lights would sit
        // on top of the page's own wordmark, and AppKit hands every click in that
        // strip to the title bar for window dragging — so the segmented control and
        // the theme button, which live in the page's top bar, would be dead across
        // their upper half. A normal title bar, drawn transparent over a window
        // background that tracks the theme, gets the calm look without that trade.
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1060, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = kAppName
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 420, height: 480)
        window.delegate = self
        window.contentView = webView
        // Start in the SYSTEM appearance. The page picks its theme from
        // prefers-color-scheme on a first launch, and that media query reads this
        // window's appearance — pinning it to light here made every first launch
        // light, even in Dark Mode. The page's own report replaces it a moment later.
        applyWindowTheme(dark: NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)

        // setFrameAutosaveName only names the slot; setFrameUsingName is what reads
        // it back, and it returns false when nothing has been stored yet. Calling
        // center() unconditionally — as this did — threw the restored position away
        // on every launch, so the window walked back to the middle of the screen
        // however the user had placed it.
        window.setFrameAutosaveName(kFrameAutosave)
        if !window.setFrameUsingName(kFrameAutosave) {
            window.setContentSize(NSSize(width: 1060, height: 760))
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // OTCALC_DEBUG=1 prints where the window actually ended up. Worth keeping:
        // a window can be perfectly correct and still invisible for reasons outside
        // the app (a locked screen, a display that went away, a stale saved frame),
        // and without this the only symptom is "nothing happened".
        if ProcessInfo.processInfo.environment["OTCALC_DEBUG"] == "1" {
            FileHandle.standardError.write(
                ("frame=\(window.frame) visible=\(window.isVisible) "
                 + "screen=\(String(describing: window.screen?.frame)) "
                 + "main=\(String(describing: NSScreen.main?.frame))\n").data(using: .utf8)!)
        }
    }

    private func load() {
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("web") else { return }
        let index = dir.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: index.path) else {
            presentFatal("找不到界面资源 web/index.html，请重新运行 build.sh。")
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: dir)
    }

    private func presentFatal(_ msg: String) {
        let a = NSAlert()
        a.messageText = kAppName
        a.informativeText = msg
        a.alertStyle = .critical
        a.runModal()
    }

    // MARK: web -> native

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "saveFile":
            let name = (body["name"] as? String) ?? "export.csv"
            let data = (body["data"] as? String) ?? ""
            saveFile(suggested: name, contents: data)

        case "print":
            openPrintSnapshot(html: (body["html"] as? String) ?? "")

        case "language":
            applyLanguage(english: (body["value"] as? String) == "en")

        case "theme":
            // Keep the window's own chrome (title bar, scrollbars, sheets, the
            // Dock menu's contextual bits) in the same theme as the page. Without
            // this the page goes charcoal and the title bar stays bright white.
            applyWindowTheme(dark: (body["value"] as? String) == "dark")

        default:
            break
        }
    }

    /// Keep the window's own chrome in the page's theme. The background colour is
    /// not cosmetic: the title bar is transparent, so this is what is drawn behind
    /// it, and it is also what fills the window during a live resize and in the
    /// frame before the page first paints — a white flash in dark mode otherwise.
    /// The values are tokens.css's --bg-base for each theme.
    private func applyWindowTheme(dark: Bool) {
        guard let window = window else { return }
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.backgroundColor = dark
            ? NSColor(srgbRed: 0x1D / 255.0, green: 0x1B / 255.0, blue: 0x19 / 255.0, alpha: 1)
            : NSColor(srgbRed: 0xEA / 255.0, green: 0xE7 / 255.0, blue: 0xE1 / 255.0, alpha: 1)
    }

    private func saveFile(suggested: String, contents: String) {
        guard let window = window else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggested
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try contents.write(to: url, atomically: true, encoding: .utf8)
                self.toast("已导出 \(url.lastPathComponent)", bad: false)
            } catch {
                self.toast("导出失败：\(error.localizedDescription)", bad: true)
            }
        }
    }

    /// Report back through the page's own toast so success and failure look the
    /// same wherever the action was started from — menu bar or button.
    private func toast(_ msg: String, bad: Bool) {
        // JSON-encode rather than hand-escaping. These strings carry a file name the
        // user chose and an error message from the system, and hand-escaping quotes
        // and backslashes leaves the rest: a newline (legal in a macOS file name) or
        // a U+2028 closes the JS string literal early and the whole call becomes a
        // syntax error, so the toast silently never appears.
        let literal: String
        if let data = try? JSONSerialization.data(withJSONObject: [msg], options: []),
           let arr = String(data: data, encoding: .utf8) {
            literal = String(arr.dropFirst().dropLast())   // ["..."] -> "..."
        } else {
            literal = "\"\""
        }
        webView.evaluateJavaScript("window.AppBridge && AppBridge.toast(\(literal), \(bad))",
                                   completionHandler: nil)
    }

    // MARK: native -> web

    @objc func exportCSV(_ sender: Any?) {
        webView.evaluateJavaScript("window.AppBridge && AppBridge.exportCSV()", completionHandler: nil)
    }

    @objc func copyTable(_ sender: Any?) {
        webView.evaluateJavaScript("window.AppBridge && AppBridge.copyTable()", completionHandler: nil)
    }

    @objc func toggleTheme(_ sender: Any?) {
        webView.evaluateJavaScript("window.AppBridge && AppBridge.toggleTheme()", completionHandler: nil)
    }

    @objc func resetAssumptions(_ sender: Any?) {
        webView.evaluateJavaScript("window.AppBridge && AppBridge.reset()", completionHandler: nil)
    }

    @objc func reloadPage(_ sender: Any?) {
        load()
    }

    // MARK: printing
    //
    // WKWebView.printOperation(with:) does NOT work here and it fails silently in
    // the worst possible way. Measured on this machine (binary linked against the
    // CLT's 11.3 SDK, running on macOS 27): every page comes out completely blank
    // — 3 bytes of content stream per page — and with no page cap the job
    // paginates away until it has written over a gigabyte of empty PDF. A plain
    // "<h1>HELLO</h1>" document printed exactly the same way, so it is the old
    // SDK's print path, not this page. window.print() is no better: the delegate
    // that would service it (WKUIDelegate.webView(_:printFrame:)) does not exist
    // before the 12.0 SDK, so it is a no-op.
    //
    // So printing goes where a working print engine already lives: the page is
    // serialised to a single self-contained HTML file — current values and theme
    // included, the three stylesheets inlined from the bundle — and handed to the
    // default browser, whose Cmd+P applies the same @media print rules.
    @objc func printPage(_ sender: Any?) {
        webView.evaluateJavaScript("window.AppBridge && AppBridge.printSnapshot()", completionHandler: nil)
    }

    private func openPrintSnapshot(html: String) {
        let styles = ["tokens.css", "components.css", "app.css"].compactMap { name -> String? in
            guard let url = Bundle.main.resourceURL?.appendingPathComponent("web/\(name)"),
                  let css = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            return "<style>\n" + css + "\n</style>"
        }.joined(separator: "\n")

        guard styles.count > 0 else {
            toast("找不到样式表，无法生成打印页。", bad: true)
            return
        }

        let full = html.replacingOccurrences(of: "<!--APP_CSS-->", with: styles)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("薪酬测算-打印.html")
        do {
            try full.write(to: url, atomically: true, encoding: .utf8)
            if NSWorkspace.shared.open(url) {
                toast("已在浏览器中打开打印页，按 ⌘P 打印或存为 PDF。", bad: false)
            } else {
                toast("无法打开浏览器。", bad: true)
            }
        } catch {
            toast("生成打印页失败：\(error.localizedDescription)", bad: true)
        }
    }

    // MARK: zoom

    // pageZoom, not magnification: magnification scales the rendered page without
    // re-laying it out, so at 150% a third of the window was simply cropped off.
    // pageZoom is text-zoom-like — the layout reflows to the new size.
    @objc func zoomIn(_ sender: Any?) { setZoom(webView.pageZoom + 0.1) }
    @objc func zoomOut(_ sender: Any?) { setZoom(webView.pageZoom - 0.1) }
    @objc func zoomActual(_ sender: Any?) { setZoom(1.0) }

    // A pinch sets magnification, which scales without reflowing; menu zoom takes
    // over from it rather than stacking on top of it, so ⌘0 really means 100%.
    private func setZoom(_ value: CGFloat) {
        webView.magnification = 1.0
        webView.pageZoom = min(max(value, 0.6), 2.0)
    }

    // MARK: menu

    private func buildMenu() {
        let main = NSMenu()

        // --- app menu ---
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 \(kAppName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        // No key equivalent on purpose: ⌘⇧R sat one modifier away from ⌘R reload
        // and overwrote the typed-in figures. The page's own reset is undoable; a
        // menu item you have to reach for is enough.
        add(appMenu, "恢复默认假设", #selector(resetAssumptions(_:)), "", [])
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(kAppName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(kAppName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // --- file ---
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "文件")
        add(fileMenu, "导出 CSV…", #selector(exportCSV(_:)), "s", [.command])
        add(fileMenu, "复制表格", #selector(copyTable(_:)), "c", [.command, .shift])
        fileMenu.addItem(.separator())
        add(fileMenu, "打印 / 存为 PDF…", #selector(printPage(_:)), "p", [.command])
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        // --- edit ---
        // Not decoration: without this menu, Cmd+C / Cmd+V / Cmd+A do nothing in
        // the page's own text fields, because those shortcuts are delivered by the
        // responder chain and nothing is there to catch them.
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        // --- view ---
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "显示")
        add(viewMenu, "切换深色 / 浅色", #selector(toggleTheme(_:)), "d", [.command, .shift])
        viewMenu.addItem(.separator())
        add(viewMenu, "实际大小", #selector(zoomActual(_:)), "0", [.command])
        add(viewMenu, "放大", #selector(zoomIn(_:)), "+", [.command])
        add(viewMenu, "缩小", #selector(zoomOut(_:)), "-", [.command])
        viewMenu.addItem(.separator())
        add(viewMenu, "重新载入", #selector(reloadPage(_:)), "r", [.command])
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        // --- window ---
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    private func applyLanguage(english: Bool) {
        // Rebuild the same menu actions and shortcuts, then localize their titles.
        buildMenu()
        window?.title = english ? "Compensation" : kAppName
        guard english else { return }
        let titles = [
            "关于 \(kAppName)": "About Compensation", "恢复默认假设": "Restore Default Assumptions",
            "隐藏 \(kAppName)": "Hide Compensation", "隐藏其他": "Hide Others", "显示全部": "Show All",
            "退出 \(kAppName)": "Quit Compensation", "文件": "File", "导出 CSV…": "Export CSV…",
            "复制表格": "Copy Table", "打印 / 存为 PDF…": "Print / Save as PDF…", "关闭窗口": "Close Window",
            "编辑": "Edit", "撤销": "Undo", "重做": "Redo", "剪切": "Cut", "拷贝": "Copy", "粘贴": "Paste", "全选": "Select All",
            "显示": "View", "切换深色 / 浅色": "Toggle Dark / Light", "实际大小": "Actual Size",
            "放大": "Zoom In", "缩小": "Zoom Out", "重新载入": "Reload", "窗口": "Window", "最小化": "Minimize", "缩放": "Zoom"
        ]
        func translate(_ menu: NSMenu) {
            menu.title = titles[menu.title] ?? menu.title
            for item in menu.items {
                item.title = titles[item.title] ?? item.title
                if let sub = item.submenu { translate(sub) }
            }
        }
        if let menu = NSApp.mainMenu { translate(menu) }
    }

    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String, _ mods: NSEvent.ModifierFlags) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = mods
        item.target = self
        menu.addItem(item)
    }

    // MARK: navigation policy

    // Everything this app shows is in the bundle's web/ folder, and only that may
    // load here. "Any file URL" was not a safe stand-in: dropping a file on the
    // window navigates to it (as .other, not .linkActivated), so a dropped HTML
    // page replaced the app AND got the native bridge and this origin's
    // localStorage — the saved figures. A link the user actually clicked to
    // somewhere else opens in their browser; anything else is refused.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL {
            let webDir = Bundle.main.resourceURL?.appendingPathComponent("web").standardizedFileURL.path ?? ""
            let path = url.standardizedFileURL.path
            decisionHandler(!webDir.isEmpty && (path == webDir || path.hasPrefix(webDir + "/")) ? .allow : .cancel)
            return
        }
        if navigationAction.navigationType == .linkActivated,
           let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
}

// MARK: - boot

let app = NSApplication.shared
let controller = AppController()
app.delegate = controller
app.setActivationPolicy(.regular)
app.run()
