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
                    RootView().environment(session).environment(Clerk.shared).revlineClerkTheme()
                } else if case .failure(let error) = configuration {
                    ContentUnavailableView("Setup required", systemImage: "gearshape",
                                           description: Text(AppFailure.describe(error)))
                }
            }
            .preferredColorScheme(.dark)
            .tint(.white)
        }
    }
}
