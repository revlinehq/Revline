import ClerkKit
import SwiftUI

struct ClerkConnectionView: View {
    @Environment(Clerk.self) private var clerk
    @State private var error: String?
    @State private var refreshID = 0

    var body: some View {
        Group {
            if let error {
                WorkspaceStateView(title: "Couldn’t connect to Revline", description: error, symbol: "wifi.slash", actionTitle: "Try again") {
                    refreshID += 1
                }
            } else {
                WorkspaceStateView(title: "Connecting to Revline…", loading: true)
            }
        }
        .task(id: refreshID) { await connect() }
    }

    private func connect() async {
        error = nil
        do {
            try await clerk.refreshEnvironment()
            try await clerk.refreshClient()
            if !clerk.isLoaded { error = "Sign-in could not finish loading. Please try again." }
        } catch is CancellationError {
            return
        } catch {
            self.error = AppFailure.describe(error)
        }
    }
}
