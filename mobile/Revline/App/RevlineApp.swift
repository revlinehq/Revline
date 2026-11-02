import ClerkKit
import ClerkKitUI
import SwiftUI

@main
struct RevlineApp: App {
    private let configuration: Result<AppConfiguration, Error>
    @State private var session: AppSession?

    init() {
        let result = Result { try AppConfiguration.load() }
        configuration = result
        if case .success(let config) = result {
            Clerk.configure(publishableKey: config.clerkKey)
            _session = State(initialValue: AppSession(configuration: config))
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let session {
                    RootView().environment(session).environment(Clerk.shared)
                } else if case .failure(let error) = configuration {
                    WorkspaceStateView(title: "Setup required", description: AppFailure.describe(error), symbol: "gearshape")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .preferredColorScheme(.dark)
        }
    }
}
