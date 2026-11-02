import ClerkKit
import ClerkKitUI
import SwiftUI

struct SettingsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppSession.self) private var session
    @State private var profile = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        UserButton().frame(width: 52, height: 52)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(clerk.user?.firstName ?? "Your account").font(.headline)
                            Text("Your workspace, everywhere.").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 12)
                    Button("Manage account", systemImage: "person.crop.circle") { profile = true }
                } footer: { Text("Manage your profile, security, connected sign-in methods, or delete your account.") }
                Section("Preferences") {
                    Label("Dark appearance", systemImage: "moon")
                    Label("\(session.connected ? "Connected" : "Reconnecting…")", systemImage: session.connected ? "checkmark.icloud" : "icloud.slash")
                }
                Section("Membership") {
                    LabeledContent("Plan", value: session.purchases.status?.plan.capitalized ?? "Loading…")
                    if session.purchases.status?.complimentary == true { Text("Complimentary membership").font(.footnote).foregroundStyle(.secondary) }
                    if session.purchases.status?.subscriptionSource == "apple" {
                        Link("Manage in App Store", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                    }
                    Button("Restore purchases") { Task { _ = await session.purchases.restorePurchases() } }
                        .disabled(session.purchases.restoring)
                    if let message = session.purchases.notice ?? session.purchases.error { Text(message).font(.footnote).foregroundStyle(.secondary) }
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                    Text("Your projects and edits sync with Revline on the web.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                #if DEBUG
                Section("Development") {
                    LabeledContent("Environment", value: session.configuration.environment)
                    Text(session.configuration.convexURL.host ?? "").font(.caption).foregroundStyle(.secondary)
                    Text(session.configuration.webURL.absoluteString).font(.caption).foregroundStyle(.secondary)
                }
                #endif
                Section {
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("Sign out of Revline?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        }
                }
            }
            .navigationTitle("Account")
            .sheet(isPresented: $profile) { UserProfileView().revlineClerkTheme() }
        }
    }
}
