//  wkprint.swift — render the page to a PDF exactly the way the app's Cmd+P does,
//  with no panels, so the @media print rules can actually be looked at.
//
//  Gotcha 19 ("the dark theme prints black") survives in real apps precisely
//  because nobody ever runs this.
//
//    swiftc -O tools/wkprint.swift -o /tmp/wkprint
//    /tmp/wkprint <index.html> <out.pdf> [dark|light]

import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: wkprint <html> <out.pdf> [dark|light]\n".data(using: .utf8)!)
    exit(2)
}
let htmlURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let theme = args.count > 3 ? args[3] : "light"

final class P: NSObject, WKNavigationDelegate {
    let web: WKWebView
    init(_ w: WKWebView) { web = w }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Force the theme under test, then let the page settle before printing.
        web.evaluateJavaScript("document.documentElement.dataset.theme = '\(theme)'; 1") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.render() }
        }
    }

    func render() {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.topMargin = 28; info.bottomMargin = 28
        info.leftMargin = 28; info.rightMargin = 28
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = outURL

        // Diagnostic guard: cap the job so a pagination blow-up shows up as a
        // small file rather than filling the disk.
        info.dictionary()[NSPrintInfo.AttributeKey.firstPage] = 1
        info.dictionary()[NSPrintInfo.AttributeKey.lastPage] = 12

        let op = web.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        if ProcessInfo.processInfo.environment["WKPRINT_FRAME"] == "paper" {
            let printable = NSSize(width: info.paperSize.width - info.leftMargin - info.rightMargin,
                                   height: info.paperSize.height - info.topMargin - info.bottomMargin)
            op.view?.frame = NSRect(origin: .zero, size: printable)
        }
        if let v = op.view {
            FileHandle.standardError.write("print view frame: \(v.frame)\n".data(using: .utf8)!)
        }
        let ok = op.run()
        print(ok ? "printed \(outURL.path)" : "print operation returned false")
        exit(ok ? 0 : 1)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write("nav failed: \(error)\n".data(using: .utf8)!); exit(3)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(ProcessInfo.processInfo.environment["WKPRINT_VISIBLE"] == "1" ? .regular : .accessory)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 900), configuration: WKWebViewConfiguration())
let p = P(web)
web.navigationDelegate = p
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 900),
                      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
window.contentView = web
if ProcessInfo.processInfo.environment["WKPRINT_VISIBLE"] == "1" {
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
} else {
    window.orderBack(nil)
}
web.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 40) {
    FileHandle.standardError.write("timeout\n".data(using: .utf8)!); exit(4)
}
app.run()
