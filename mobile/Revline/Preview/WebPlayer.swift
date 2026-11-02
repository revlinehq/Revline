import SwiftUI
import WebKit

struct WebPlayer: UIViewRepresentable {
    let projectID: String
    let session: AppSession
    let controller: PlayerController

    func makeCoordinator() -> Coordinator { Coordinator(session: session, controller: controller) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "revline")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        view.isInspectable = false
        controller.webView = view
        let url = session.configuration.webURL.appending(path: "mobile/player/\(projectID)")
        context.coordinator.playerURL = url
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "revline")
        coordinator.controller.webView = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let session: AppSession
        let controller: PlayerController
        var playerURL: URL?

        init(session: AppSession, controller: PlayerController) {
            self.session = session; self.controller = controller
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  message.frameInfo.securityOrigin.host == playerURL?.host,
                  message.frameInfo.securityOrigin.protocol == playerURL?.scheme,
                  let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
            switch kind {
            case "bridgeReady":
                controller.bridgeReady = true
                Task { await controller.authenticate(session) }
            case "needsAuth": Task { await controller.authenticate(session) }
            case "ready": controller.ready = true; controller.error = nil
            case "time":
                if !controller.scrubbing, let time = body["time"] as? Double, time.isFinite { controller.time = time }
            case "playing": controller.playing = body["playing"] as? Bool ?? false
            case "error": controller.error = body["message"] as? String ?? "Preview unavailable."
            default: break
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard navigationAction.targetFrame?.isMainFrame != false else { return .allow }
            guard let url = navigationAction.request.url, let playerURL,
                  url.scheme == playerURL.scheme, url.host == playerURL.host,
                  url.port == playerURL.port, url.path == playerURL.path else { return .cancel }
            return .allow
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            controller.error = "The preview server is unavailable. Check your connection and retry."
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            controller.error = "The preview needs to reload."
            controller.playing = false
        }
    }
}
