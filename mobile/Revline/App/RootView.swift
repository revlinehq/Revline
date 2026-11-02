import ClerkKit
import SwiftUI

struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppSession.self) private var session
    @AppStorage("revline.onboardingCompleted") private var onboarded = false

    var body: some View {
        Group {
            if !onboarded { OnboardingView { onboarded = true } }
            else if !clerk.isLoaded { ClerkConnectionView() }
            else if clerk.session == nil { WelcomeView() }
            else if session.authenticated {
                if session.purchases.status == nil {
                    VStack(spacing: 16) {
                        if let error = session.purchases.error {
                            ErrorBanner(message: error)
                            Button("Try again") { Task { await session.purchases.observe(userID: clerk.user?.id ?? "") } }
                                .buttonStyle(.bordered)
                        } else { WorkspaceStateView(title: "Checking your membership…", loading: true) }
                    }.padding(24)
                } else if session.purchases.status?.needsPayment == true && session.purchases.status?.active != true {
                    MembershipView()
                } else { WorkspaceTabs() }
            } else if let error = session.connectionError {
                VStack {
                    WorkspaceStateView(title: "Couldn’t connect", description: error, symbol: "wifi.slash", actionTitle: "Try again") {
                        Task { await session.synchronize(signedIn: true) }
                    }
                    Button("Sign out") { Task { await session.signOut() } }.buttonStyle(.borderless)
                }
            } else { WorkspaceStateView(title: "Opening your workspace…", loading: true) }
        }
        .task(id: clerk.session?.id) { await session.synchronize(signedIn: clerk.session != nil) }
        .task { await session.observeConnection() }
        .task(id: session.authenticated) {
            if session.authenticated, let userID = clerk.user?.id { await session.purchases.observe(userID: userID) }
            else { session.purchases.reset() }
        }
        .task(id: session.authenticated) { if session.authenticated { await session.purchases.observeTransactions() } }
    }
}
