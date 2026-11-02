import SwiftUI

struct MembershipView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Spacer()
            Image(systemName: "rectangle.stack").font(.largeTitle.weight(.light)).foregroundStyle(.secondary)
            Text("Make room for\nyour next story.").font(.largeTitle.weight(.semibold)).tracking(-0.8)
            Text("A Revline membership brings prompt editing, clipping, and motion design to your workspace.")
                .foregroundStyle(.secondary).lineSpacing(4)
            if let error = session.purchases.error { ErrorBanner(message: error) }
            if let notice = session.purchases.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
            Button("Choose a membership") { session.purchases.presentPaywall() }
                .buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                .controlSize(.large)
            Button("Restore purchases") { Task { _ = await session.purchases.restorePurchases() } }
                .disabled(session.purchases.restoring)
            Spacer()
            Button("Sign out") { Task { await session.signOut() } }.font(.footnote).foregroundStyle(.secondary)
        }
        .padding(28).frame(maxWidth: 540).frame(maxWidth: .infinity)
        .task { session.purchases.presentOnboardingPaywallIfNeeded() }
    }
}
