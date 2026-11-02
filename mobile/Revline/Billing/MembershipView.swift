import SwiftUI

struct MembershipView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Make room for your next story", systemImage: "rectangle.stack").font(.headline)
                    Text("Prompt editing, clipping, and motion design in one workspace. Choose a membership to start.")
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button { session.purchases.presentPaywall() } label: {
                        ActionLabel(title: "Choose a membership")
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                Section {
                    Button { Task { _ = await session.purchases.restorePurchases() } } label: {
                        if session.purchases.restoring { ProgressView("Restoring…") }
                        else { Text("Restore purchases") }
                    }.disabled(session.purchases.restoring)
                    if let error = session.purchases.error { ErrorBanner(message: error) }
                    if let notice = session.purchases.notice { Text(notice).foregroundStyle(.secondary) }
                }
                Section { Button("Sign out") { Task { await session.signOut() } } }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Membership")
        }
        .task { session.purchases.presentOnboardingPaywallIfNeeded() }
    }
}
