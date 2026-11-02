import ClerkKit
import SwiftUI

struct RootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppSession.self) private var session
    @AppStorage("revline.onboardingCompleted") private var onboarded = false

    var body: some View {
        Group {
            if !onboarded { OnboardingView { onboarded = true } }
            else if !clerk.isLoaded { ProgressView("Connecting to Revline…") }
            else if clerk.session == nil { WelcomeView() }
            else if session.authenticated {
                if session.purchases.status == nil {
                    VStack(spacing: 16) {
                        if let error = session.purchases.error {
                            ErrorBanner(message: error)
                            Button("Retry") { Task { await session.purchases.observe(userID: clerk.user?.id ?? "") } }
                        } else { ProgressView("Checking your membership…") }
                    }.padding(24)
                } else if session.purchases.status?.needsPayment == true && session.purchases.status?.active != true {
                    MembershipView()
                } else { TabView {
                    ProjectsView()
                        .tabItem { Label("Projects", systemImage: "rectangle.stack") }
                    SettingsView()
                        .tabItem { Label("Account", systemImage: "person.crop.circle") }
                } }
            } else if let error = session.connectionError {
                ContentUnavailableView {
                    Label("Couldn’t connect", systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Try again") { Task { await session.synchronize(signedIn: true) } }
                        .buttonStyle(.borderedProminent)
                    Button("Sign out") { Task { await session.signOut() } }
                }
            } else { ProgressView("Opening your workspace…") }
        }
        .background(RevlineTheme.background)
        .task(id: clerk.session?.id) { await session.synchronize(signedIn: clerk.session != nil) }
        .task { await session.observeConnection() }
        .task(id: session.authenticated) {
            if session.authenticated, let userID = clerk.user?.id { await session.purchases.observe(userID: userID) }
            else { session.purchases.reset() }
        }
        .task(id: session.authenticated) { if session.authenticated { await session.purchases.observeTransactions() } }
    }
}
