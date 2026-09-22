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
            self.web.evaluateJavaScript(self.js) { _, err in
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
                exit(0)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.poll() }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let cfg = WKWebViewConfiguration()
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
