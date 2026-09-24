//  wkshot.swift — screenshot the page from a real WKWebView, which is the
//  renderer the shipped app uses. Looking at the page in another engine answers
//  a different question (see the note at the top of wkcheck.swift).
//
//    swiftc -O tools/wkshot.swift -o /tmp/wkshot
//    /tmp/wkshot <index.html> <out.png> <width> <height> [light|dark] [scrollY]

import Cocoa
import WebKit

let a = CommandLine.arguments
guard a.count >= 5, let w = Double(a[3]), let h = Double(a[4]) else {
    FileHandle.standardError.write("usage: wkshot <html> <out.png> <w> <h> [theme] [scrollY]\n".data(using: .utf8)!)
    exit(2)
}
let out = URL(fileURLWithPath: a[2])
let theme = a.count > 5 ? a[5] : "light"
let scrollY = a.count > 6 ? (Double(a[6]) ?? 0) : 0

final class S: NSObject, WKNavigationDelegate {
    let web: WKWebView
    init(_ v: WKWebView) { web = v }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // WKSHOT_JS runs extra setup in the page before the shot — used to capture a
        // state that only exists after interaction (a theme TOGGLE, not a theme set).
        var extra = ""
        if let path = ProcessInfo.processInfo.environment["WKSHOT_JS"],
           let src = try? String(contentsOfFile: path, encoding: .utf8) { extra = src }
        let js = "document.documentElement.dataset.theme='\(theme)';"
               + "try{localStorage.removeItem('ot_calc_v1')}catch(e){};"
               + "window.scrollTo(0,\(scrollY));" + extra + " 1"
        web.evaluateJavaScript(js) { _, _ in
            // Settle: springs place, the chart renders, the sticky bars update.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                self.web.evaluateJavaScript("window.scrollTo(0,\(scrollY)); 1") { _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.shoot() }
                }
            }
        }
    }

    func shoot() {
        web.takeSnapshot(with: nil) { image, err in
            guard let image = image,
                  let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                FileHandle.standardError.write("snapshot failed: \(String(describing: err))\n".data(using: .utf8)!)
                exit(3)
            }
            do { try png.write(to: out); print("wrote \(out.path) \(rep.pixelsWide)x\(rep.pixelsHigh)") }
            catch { FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!); exit(4) }
            exit(0)
        }
    }

    func webView(_ v: WKWebView, didFail n: WKNavigation!, withError e: Error) {
        FileHandle.standardError.write("nav failed: \(e)\n".data(using: .utf8)!); exit(5)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let cfg = WKWebViewConfiguration()
cfg.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: cfg)
let s = S(web)
web.navigationDelegate = s
let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h),
                   styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
win.contentView = web
win.orderBack(nil)
web.loadFileURL(URL(fileURLWithPath: a[1]), allowingReadAccessTo: URL(fileURLWithPath: a[1]).deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { FileHandle.standardError.write("timeout\n".data(using:.utf8)!); exit(6) }
app.run()
