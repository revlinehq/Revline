import ClerkKitUI
import ClerkKit
import SwiftUI

struct WelcomeView: View {
    @State private var showAuth = false
    @Environment(Clerk.self) private var clerk
    @State private var error: String?
    @State private var signingInWithApple = false

    var body: some View {
        GeometryReader { geometry in
            VStack(alignment: .leading, spacing: 24) {
                Label("revline", systemImage: "play.rectangle.fill")
                    .font(.title2.weight(.semibold))
                Spacer()
                Image(systemName: "rectangle.stack")
                    .font(.system(size: 64, weight: .ultraLight))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 16) {
                    Text("Every cut.\nYour call.")
                        .font(.largeTitle.weight(.semibold))
                        .tracking(-1)
                    Text("Bring your footage. Find your story.\nMake it yours, in conversation.")
                        .font(.body).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                UserButton(signedOutContent: {
                    Button { showAuth = true } label: {
                        HStack {
                            Text("Get started").fontWeight(.semibold)
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                        .padding(18).foregroundStyle(.black)
                        .background(.white, in: .rect(cornerRadius: 16))
                    }
                })
                Button {
                    signingInWithApple = true
                    Task {
                        defer { signingInWithApple = false }
                        do { try await clerk.auth.signInWithApple() }
                        catch { self.error = AppFailure.describe(error) }
                    }
                } label: {
                    HStack {
                        Spacer()
                        Label("Sign in with Apple", systemImage: "apple.logo").fontWeight(.medium)
                        if signingInWithApple { ProgressView() }
                        Spacer()
                    }
                    .padding(16).background(RevlineTheme.raised, in: .rect(cornerRadius: 16))
                }.disabled(signingInWithApple)
                if let error { Text(error).font(.footnote).foregroundStyle(.secondary) }
                Text("Sign in to your Revline account to pick up where you left off.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(28)
            .frame(maxWidth: 540, minHeight: geometry.size.height)
            .frame(maxWidth: .infinity)
        }
        .sheet(isPresented: $showAuth) { AuthView().revlineClerkTheme() }
    }
}
