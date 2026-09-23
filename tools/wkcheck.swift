//  wkcheck.swift — run a JS acceptance script against the page inside a real
//  WKWebView, which is the renderer the shipped app actually uses.
//
//  The kit's own gotcha list opens with two bugs that are perfectly fine in
//  Chrome and broken only in WKWebView (a collapsed SVG flex item, and
//  calc(% + px) inside translateX). Checking the page in any other engine does
//  not answer the question this harness answers.
//
//    swiftc -O tools/wkcheck.swift -o /tmp/wkcheck
//    /tmp/wkcheck <index.html> <checks.js> <width> <height>
//
//  The JS is expected to set window.__RESULT to a JSON string when it is done;
//  this polls for it so the script may be asynchronous.

import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 5,
      let width = Double(args[3]), let height = Double(args[4]) else {
    FileHandle.standardError.write("usage: wkcheck <html> <js> <width> <height>\n".data(using: .utf8)!)
    exit(2)
}
let htmlURL = URL(fileURLWithPath: args[1])
let jsSource: String
do { jsSource = try String(contentsOf: URL(fileURLWithPath: args[2]), encoding: .utf8) }
catch { FileHandle.standardError.write("cannot read js: \(error)\n".data(using: .utf8)!); exit(2) }

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(3)
}

final class Harness: NSObject, WKNavigationDelegate {
    let web: WKWebView
    let js: String
    var polls = 0

    init(web: WKWebView, js: String) { self.web = web; self.js = js }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Let the page's own init settle (springs place, first render runs).
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            // `void 0` last, so the completion value is always serialisable: a script
            // whose last expression is an async IIFE returns a Promise, which
            // WebKit reports as an error and the run never got polled.
            self.web.evaluateJavaScript(self.js + "\n;void 0") { _, err in
                if let e = err {
                    fail("JS threw while starting checks: \(e)")
                }
                self.poll()
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("navigation failed: \(error)")
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("provisional navigation failed: \(error)")
    }

    func poll() {
        polls += 1
        if polls > 900 {
            // Print whatever the script got through before it stalled — a bare
            // "timed out" says nothing about which check is hanging.
            web.evaluateJavaScript("window.__PARTIAL || 'no partial'") { v, _ in
                fail("timed out waiting for window.__RESULT; partial = \(v ?? "nil")")
            }
            return
        }
        web.evaluateJavaScript("window.__RESULT || null") { value, _ in
            if let s = value as? String {
                print(s)
                // Fail loudly: a script (or CI) running this must not have to parse
                // the JSON to learn that checks failed.
                if let data = s.data(using: .utf8),
                   let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let pass = obj["pass"] as? Bool, !pass {
                    exit(1)
                }
                exit(0)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.poll() }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let cfg = WKWebViewConfiguration()

// Keep the page's timers running when the window is not visible — behind other
// windows, on another Space, or with the screen LOCKED. WebKit throttles and then
// suspends DOM timers of a hidden page, so an asynchronous check script simply
// stops at its next setTimeout and the run times out. These are private WKPreferences
// setters (present since macOS 10.13); each is called only if it exists, with nil as
// the BOOL argument (= NO). The process-level App Nap assertion covers this process.
for name in ["_setHiddenPageDOMTimerThrottlingEnabled:",
             "_setHiddenPageDOMTimerThrottlingAutoIncreases:",
             "_setPageVisibilityBasedProcessSuppressionEnabled:"] {
    let sel = NSSelectorFromString(name)
    if cfg.preferences.responds(to: sel) { _ = cfg.preferences.perform(sel, with: nil) }
}
let activity = ProcessInfo.processInfo.beginActivity(
    options: [.userInitiated, .idleSystemSleepDisabled], reason: "WKWebView acceptance checks")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: cfg)
let harness = Harness(web: web, js: jsSource)
web.navigationDelegate = harness

// A real window, so layout, sticky positioning and scrolling behave as they do in
// the app rather than in a detached view.
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                      styleMask: [.titled, .closable, .resizable],
                      backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)

web.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())

DispatchQueue.main.asyncAfter(deadline: .now() + 180) { fail("hard timeout") }
app.run()
