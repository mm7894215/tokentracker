import AppKit
import WebKit

@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {

    static let shared = DashboardWindowController()

    private var window: NSWindow?
    private var webView: WKWebView?
    private var loadingOverlay: NSView?

    private override init() {
        super.init()
    }

    // MARK: - Public

    func showWindow() {
        // 关闭 menu bar popover
        for window in NSApp.windows where window.className.contains("Popover") {
            window.close()
        }

        // Reuse existing window if possible
        if let window {
            NSApp.setActivationPolicy(.regular)
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        // Create WKWebView — transparent until loaded
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView

        // Container view holds webView + drag bar + loading overlay
        let container = NSView()
        container.wantsLayer = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)

        // Titlebar drag area — transparent, sits above webView so window is draggable
        let dragBar = TitlebarDragView()
        dragBar.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(dragBar)

        // Loading overlay with spinner
        let overlay = makeLoadingOverlay()
        overlay.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(overlay)
        self.loadingOverlay = overlay

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            dragBar.topAnchor.constraint(equalTo: container.topAnchor),
            dragBar.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            dragBar.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            dragBar.heightAnchor.constraint(equalToConstant: 56),
            overlay.topAnchor.constraint(equalTo: container.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])

        // Create window
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 1000),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 800, height: 600)
        window.title = "TokenTracker"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        let toolbar = NSToolbar(identifier: "DashboardToolbar")
        toolbar.showsBaselineSeparator = false
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.contentView = container
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("DashboardWindow")
        window.center()
        // Match system appearance for loading background
        window.backgroundColor = NSColor.windowBackgroundColor
        self.window = window

        // Load dashboard
        if let url = URL(string: Constants.serverBaseURL + "?app=1") {
            webView.load(URLRequest(url: url))
        }

        // Switch to regular app (shows dock icon), then show window
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func reload() {
        webView?.reload()
    }

    // MARK: - Loading Overlay

    private func makeLoadingOverlay() -> NSView {
        let overlay = NSView()
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimation(nil)
        overlay.addSubview(spinner)

        let label = NSTextField(labelWithString: "Loading Dashboard…")
        label.font = .systemFont(ofSize: 13)
        label.textColor = .secondaryLabelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(label)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -12),
            label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
        ])
        return overlay
    }

    private func dismissLoadingOverlay() {
        guard let overlay = loadingOverlay else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.3
            overlay.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            overlay.removeFromSuperview()
            self?.loadingOverlay = nil
            // Restore webView background after content is ready
            self?.webView?.setValue(true, forKey: "drawsBackground")
        }
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        loadingOverlay = nil
        webView = nil
        window = nil
        DispatchQueue.main.async {
            let hasVisibleWindows = NSApp.windows.contains { $0.isVisible && !$0.isKind(of: NSPanel.self) }
            if !hasVisibleWindows {
                NSApp.setActivationPolicy(.accessory)
            }
        }
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 禁用文本选中 + 为透明标题栏留出顶部间距
        let css = """
            * { -webkit-user-select: none !important; }
            input, textarea { -webkit-user-select: text !important; }
            body { padding-top: 28px !important; }
            ::-webkit-scrollbar { display: none !important; }
            """
        let js = "var s=document.createElement('style');s.textContent='\(css.replacingOccurrences(of: "\n", with: " "))';document.head.appendChild(s);"
        webView.evaluateJavaScript(js)
        // Page loaded — dismiss the loading overlay
        dismissLoadingOverlay()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, let url = URL(string: Constants.serverBaseURL + "?app=1") else { return }
            self.webView?.load(URLRequest(url: url))
        }
    }
}

// MARK: - Titlebar Drag View

/// Transparent view overlaying the titlebar area to enable window dragging
/// while WKWebView is fullSizeContentView.
private final class TitlebarDragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
