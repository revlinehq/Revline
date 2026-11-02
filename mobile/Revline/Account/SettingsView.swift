import ClerkKit
import SwiftUI

struct SettingsView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(AppSession.self) private var session
    @State private var deleting = false
    @State private var consent = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Image(systemName: "person.crop.circle").font(.largeTitle).frame(width: 44, height: 44).accessibilityHidden(true)
                        VStack(alignment: .leading) {
                            Text(clerk.user?.firstName ?? "Your account").font(.headline)
                            Text("Your workspace, everywhere.").font(.subheadline).foregroundStyle(Color.revlineMuted)
                        }
                    }
                } footer: {
                    Text("Your Revline account is shared with the web app.")
                }
                .revlineRows()
                Section("Workspace") {
                    LabeledContent("Appearance", value: "Dark")
                    Label(session.connected ? "Connected" : "Reconnecting…", systemImage: session.connected ? "checkmark.icloud" : "icloud.slash")
                }.revlineRows()
                Section("Membership") {
                    LabeledContent("Plan", value: session.purchases.status?.plan.capitalized ?? "Loading…")
                    if session.purchases.status?.complimentary == true {
                        Text("Complimentary membership").foregroundStyle(Color.revlineMuted)
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
                    else if let notice = session.purchases.notice { Text(notice).foregroundStyle(Color.revlineMuted) }
                }.revlineRows()
                Section("Privacy and account") {
                    Button("AI data sharing", systemImage: "hand.raised") { consent = true }
                    LegalLinks()
                    Button("Delete account", systemImage: "person.crop.circle.badge.minus", role: .destructive) { deleting = true }
                }.revlineRows()
                Section("About") {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
                    Text("Your projects and edits sync with Revline on the web.").foregroundStyle(Color.revlineMuted)
                }.revlineRows()
                #if DEBUG
                Section("Development") {
                    LabeledContent("Environment", value: session.configuration.environment)
                    Text(session.configuration.convexURL.host ?? "").foregroundStyle(Color.revlineMuted)
                    Text(session.configuration.webURL.absoluteString).foregroundStyle(Color.revlineMuted)
                }.revlineRows()
                #endif
                Section {
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("Sign out of Revline?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                        }
                }.revlineRows()
            }
            .listStyle(.insetGrouped)
            .revlineSurface()
            .navigationTitle("Account")
            .sheet(isPresented: $deleting) { DeleteAccountView() }
            .sheet(isPresented: $consent) { AIConsentView() }
        }
    }
}
