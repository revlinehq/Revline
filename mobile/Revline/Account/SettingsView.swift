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
                    HStack {
                        UserButton().frame(width: 44, height: 44)
                        VStack(alignment: .leading) {
                            Text(clerk.user?.firstName ?? "Your account").font(.headline)
                            Text("Your workspace, everywhere.").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Button("Manage account", systemImage: "person.crop.circle") { profile = true }
                } footer: {
                    Text("Manage your profile, sign-in methods, security, or delete your account.")
                }
                Section("Workspace") {
                    LabeledContent("Appearance", value: "Dark")
                    Label(session.connected ? "Connected" : "Reconnecting…", systemImage: session.connected ? "checkmark.icloud" : "icloud.slash")
                }
                Section("Membership") {
                    LabeledContent("Plan", value: session.purchases.status?.plan.capitalized ?? "Loading…")
                    if session.purchases.status?.complimentary == true {
                        Text("Complimentary membership").foregroundStyle(.secondary)
                    }
                    if session.purchases.status?.subscriptionSource == "apple",
                       let url = URL(string: "https://apps.apple.com/account/subscriptions") {
                        Link("Manage in App Store", destination: url)
                    }
                    Button { Task { _ = await session.purchases.restorePurchases() } } label: {
                        if session.purchases.restoring { ProgressView("Restoring…") }
                        else { Text("Restore purchases") }
                    }.disabled(session.purchases.restoring)
                    if let error = session.purchases.error { ErrorBanner(message: error) }
                    else if let notice = session.purchases.notice { Text(notice).foregroundStyle(.secondary) }
                }
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                    Text("Your projects and edits sync with Revline on the web.").foregroundStyle(.secondary)
                }
                #if DEBUG
                Section("Development") {
                    LabeledContent("Environment", value: session.configuration.environment)
                    Text(session.configuration.convexURL.host ?? "").foregroundStyle(.secondary)
                    Text(session.configuration.webURL.absoluteString).foregroundStyle(.secondary)
                }
                #endif
                Section {
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("Sign out of Revline?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Account")
            .sheet(isPresented: $profile) { UserProfileView() }
        }
    }
}
