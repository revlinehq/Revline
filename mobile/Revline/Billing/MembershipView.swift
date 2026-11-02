import StoreKit
import SwiftUI

struct MembershipView: View {
    @Environment(AppSession.self) private var session
    @State private var deleting = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Make room for your next story", systemImage: "rectangle.stack").font(.title2).bold()
                    Text("Edit footage by prompt, find the best clips, and build motion in one workspace.").foregroundStyle(Color.revlineMuted)
                }.revlineRows()
                Section {
                    Text("7 days free, then \(session.purchases.monthlyProduct?.displayPrice ?? "$39")/month").font(.title2).bold()
                    Text("For eligible new subscribers. Cancel anytime in Apple subscription settings. The subscription renews monthly until cancelled. Apple shows your local price and trial eligibility before you confirm.").font(.subheadline).foregroundStyle(Color.revlineMuted)
                    if let product = session.purchases.monthlyProduct {
                        LabeledContent("Your App Store price", value: "\(product.displayPrice) / month")
                    }
                    Button { Task { await session.purchases.purchaseMonthly() } } label: {
                        ActionLabel(title: session.purchases.trialEligible ? "Start 7-day free trial" : "Continue with monthly membership", busyTitle: "Connecting to App Store…", busy: session.purchases.purchasing)
                    }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(session.purchases.purchasing)
                }.revlineRows()
                Section {
                    Button { Task { _ = await session.purchases.restorePurchases() } } label: {
                        if session.purchases.restoring { ProgressView("Restoring…") }
                        else { Text("Restore purchases") }
                    }.disabled(session.purchases.restoring)
                    LegalLinks()
                    Link("Apple standard EULA", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
                    if let error = session.purchases.error { ErrorBanner(message: error) }
                    if let notice = session.purchases.notice { Text(notice).foregroundStyle(Color.revlineMuted) }
                }.revlineRows()
                Section("Account") {
                    Button("Sign out") { Task { await session.signOut() } }
                    Button("Delete account", role: .destructive) { deleting = true }
                }.revlineRows()
            }
            .listStyle(.insetGrouped).revlineSurface()
            .navigationTitle("Membership")
        }
        .sheet(isPresented: $deleting) { DeleteAccountView() }
        .task {
            await session.purchases.loadMonthlyProduct()
            session.purchases.presentOnboardingPaywallIfNeeded()
        }
    }
}
