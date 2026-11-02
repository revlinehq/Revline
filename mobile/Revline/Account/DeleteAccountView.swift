import AuthenticationServices
import ClerkKit
import SwiftUI

struct DeleteAccountView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmation = ""
    @State private var confirming = false
    @State private var busy = false
    @State private var error: String?
    @State private var appleAuthorizationCode: String?

    private var usesApple: Bool {
        Clerk.shared.user?.externalAccounts.contains { $0.provider == "apple" || $0.provider == "oauth_apple" } == true
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Delete your Revline account?").font(.headline)
                    Text("Your sign-in account will be deleted. Revline will remove access immediately and queue permanent removal of your projects, chat, uploaded media and exports. This cannot be undone.")
                }.revlineRows()
                Section("Subscriptions") {
                    Text("Your web membership will stop renewing as part of deletion. Pending web subscriptions are cancelled.")
                    Text("Deleting your account does not cancel an App Store subscription. Cancel it in Apple subscription settings to prevent future charges.")
                    Link("Manage App Store subscriptions", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                }.revlineRows()
                Section("Type DELETE to confirm") {
                    TextField("DELETE", text: $confirmation).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    if usesApple {
                        Text("Confirm the linked Apple account so Revline can revoke its access before deletion.")
                        SignInWithAppleButton(.continue) { request in
                            request.requestedScopes = []
                        } onCompletion: { result in
                            do {
                                let authorization = try result.get()
                                guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                                      let data = credential.authorizationCode,
                                      let code = String(data: data, encoding: .utf8) else {
                                    throw AppFailure("Apple did not confirm this account.")
                                }
                                appleAuthorizationCode = code
                            } catch { self.error = AppFailure.describe(error) }
                        }
                        .signInWithAppleButtonStyle(.white).frame(height: 44).disabled(busy)
                        if appleAuthorizationCode != nil { Label("Apple account confirmed", systemImage: "checkmark.circle") }
                    }
                    Button(role: .destructive) { confirming = true } label: {
                        ActionLabel(title: "Delete account permanently", busyTitle: "Deleting account…", busy: busy)
                    }.disabled(confirmation != "DELETE" || busy || (usesApple && appleAuthorizationCode == nil))
                    .confirmationDialog("Permanently delete your account and data?", isPresented: $confirming, titleVisibility: .visible) {
                        Button("Delete account", role: .destructive) { Task { await remove() } }
                    }
                }.revlineRows()
                if let error { Section { ErrorBanner(message: error) }.revlineRows() }
            }
            .revlineSurface(.revlinePopover)
            .navigationTitle("Delete account").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: dismiss.callAsFunction).disabled(busy) } }
        }
        .interactiveDismissDisabled(busy)
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            try await session.deleteAccount(appleAuthorizationCode: appleAuthorizationCode)
            dismiss()
        } catch { appleAuthorizationCode = nil; self.error = AppFailure.describe(error) }
    }
}
