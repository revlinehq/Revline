import Foundation
import Observation
import WebKit

@MainActor @Observable
final class PlayerController {
    var time = 0.0
    var playing = false
    var ready = false
    var bridgeReady = false
    var scrubbing = false
    var error: String?
    var reloadID = 0
    weak var webView: WKWebView?
    var timelineID = "main"

    func playPause() { send(["kind": playing ? "pause" : "play"]) }
    func pause() { send(["kind": "pause"]) }
    func seek(_ time: Double) { self.time = time; send(["kind": "seek", "time": time]) }
    func selectTimeline(_ id: String) {
        timelineID = id
        time = 0; playing = false
        send(["kind": "timeline", "timelineId": id])
    }

    func authenticate(_ session: AppSession) async {
        guard bridgeReady else { return }
        do {
            let token = try await ClerkTokenProvider.token()
            send(["kind": "authenticate", "token": token, "deploymentURL": session.configuration.convexURL.absoluteString])
            send(["kind": "timeline", "timelineId": timelineID])
        } catch { self.error = AppFailure.describe(error) }
    }

    func send(_ payload: [String: Any]) {
        guard bridgeReady, let webView else { return }
        Task {
            _ = try? await webView.callAsyncJavaScript("window.revlinePlayer?.receive(payload)", arguments: ["payload": payload],
                                                     in: nil, contentWorld: .page)
        }
    }

    func retry() {
        error = nil; ready = false; bridgeReady = false; playing = false
        reloadID += 1
    }
}
