import ClerkKitUI
import ClerkKit
import SwiftUI

struct WelcomeView: View {
    @Environment(Clerk.self) private var clerk
    @State private var showAuth = false
    @State private var error: String?
    @State private var signingInWithApple = false
    @State private var introduction = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image("MotionDesign").resizable().scaledToFit()
                        .clipShape(.rect(cornerRadius: 12))
                        .accessibilityLabel("A motion film made in Revline")
                    Text("Every cut. Your call.").font(.largeTitle).bold()
                    Text("Edit footage, find the best moments, and build motion in conversation.")
                        .foregroundStyle(Color.revlineMuted)
                    Button("Explore Revline") { introduction = true }
                        .buttonStyle(.borderless).frame(minHeight: 44)
                    if let error { ErrorBanner(message: error) }
                }
                .padding().frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 12) {
                    Button { showAuth = true } label: { ActionLabel(title: "Sign in to Revline") }
                        .buttonStyle(.borderedProminent)
                    Button(action: signInWithApple) {
                        if signingInWithApple {
                            ActionLabel(title: "Sign in with Apple", busyTitle: "Connecting…", busy: true)
                        } else {
                            Label("Sign in with Apple", systemImage: "apple.logo").frame(maxWidth: .infinity, minHeight: 28)
                        }
                    }.buttonStyle(.bordered).disabled(signingInWithApple)
                    Text("Your projects stay in sync across iPhone and the web.")
                        .font(.footnote).foregroundStyle(Color.revlineMuted).multilineTextAlignment(.center)
                }
                .controlSize(.large).padding().frame(maxWidth: .infinity)
                .background(Color.revlineCard)
            }
            .revlineSurface()
            .navigationTitle("Revline")
            .sheet(isPresented: $showAuth) { AuthView().presentationBackground(Color.revlinePopover) }
            .sheet(isPresented: $introduction) { OnboardingView { introduction = false } }
        }
    }

    private func signInWithApple() {
        signingInWithApple = true
        Task {
            defer { signingInWithApple = false }
            do { try await clerk.auth.signInWithApple() }
            catch { self.error = AppFailure.describe(error) }
        }
    }
}
