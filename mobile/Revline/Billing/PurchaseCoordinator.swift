import ClerkKit
@preconcurrency import ConvexMobile
import Foundation
import Observation
import StoreKit
import SuperwallKit

@MainActor @Observable
final class PurchaseCoordinator: PurchaseController {
    private let client: ConvexClient
    private let configured: Bool
    private let productIDs: Set<String>
    private var identifiedUser: String?
    private var registeredUser: String?
    var status: BillingStatus?
    var error: String?
    var notice: String?
    var restoring = false

    init(client: ConvexClient) {
        self.client = client
        func setting(_ key: String) -> String? {
            guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
                  !value.isEmpty, !value.contains("$("), !value.hasPrefix("YOUR_") else { return nil }
            return value
        }
        productIDs = Set([setting("RevlineProProduct"), setting("RevlineUltraProduct")].compactMap { $0 })
        let key = setting("RevlineSuperwallKey")
        configured = key != nil
        if let key { Superwall.configure(apiKey: key, purchaseController: self) }
    }

    func observe(userID: String) async {
        if identifiedUser != userID {
            identifiedUser = userID; registeredUser = nil; status = nil
            if configured { Superwall.shared.identify(userId: userID) }
        }
        await observeConvex(client, "billing:status", as: BillingStatus.self) { [self] value in
            status = value
            error = nil
            guard configured else { return }
            if value.active {
                let entitlements: Set<Entitlement> = value.plan == "ultra" ? [Entitlement(id: "pro"), Entitlement(id: "ultra")] : [Entitlement(id: "pro")]
                Superwall.shared.subscriptionStatus = .active(entitlements)
            } else { Superwall.shared.subscriptionStatus = .inactive }
        } onError: { [self] in error = $0 }
    }

    func presentPaywall() {
        guard status?.needsPayment == true, status?.active != true else { return }
        guard configured else { error = "Subscriptions are unavailable in this build. Please try again later."; return }
        let handler = PaywallPresentationHandler()
        handler.onError { [weak self] error in Task { @MainActor in self?.error = AppFailure.describe(error) } }
        handler.onSkip { [weak self] _ in Task { @MainActor in self?.notice = "Choose a membership to start editing, or restore an existing purchase." } }
        Superwall.shared.register(placement: "onboarding_paywall", handler: handler)
    }

    func presentOnboardingPaywallIfNeeded() {
        guard let identifiedUser, registeredUser != identifiedUser, status?.needsPayment == true, status?.active != true else { return }
        registeredUser = identifiedUser
        presentPaywall()
    }

    func purchase(product: StoreProduct) async -> PurchaseResult {
        guard let userID = Clerk.shared.user?.id, userID == identifiedUser,
              let storeProduct = product.sk2Product, productIDs.contains(storeProduct.id) else {
            return .failed(AppFailure("This subscription is unavailable. Please try again later."))
        }
        if status?.active == true { return .failed(AppFailure("Your Revline membership is already active.")) }
        do {
            let tokenString: String = try await client.mutation("appleBilling:accountToken")
            guard let token = UUID(uuidString: tokenString) else { throw AppFailure("Could not link this purchase to your account.") }
            switch try await storeProduct.purchase(options: [.appAccountToken(token)]) {
            case .success(let verification):
                guard case .verified(let transaction) = verification else { throw AppFailure("Apple could not verify this purchase.") }
                try await sync(verification.jwsRepresentation)
                await transaction.finish()
                return .purchased
            case .userCancelled: return .cancelled
            case .pending: notice = "Your purchase is awaiting approval."; return .pending
            @unknown default: return .failed(AppFailure("The purchase could not be completed."))
            }
        } catch { self.error = AppFailure.describe(error); return .failed(error) }
    }

    func restorePurchases() async -> RestorationResult {
        restoring = true; error = nil; notice = nil
        defer { restoring = false }
        do {
            try await AppStore.sync()
            var count = 0
            for await verification in Transaction.currentEntitlements {
                guard case .verified(let transaction) = verification, productIDs.contains(transaction.productID) else { continue }
                try await sync(verification.jwsRepresentation)
                count += 1
            }
            notice = count == 0 ? "No App Store subscriptions were found for this Apple account." : "Purchases restored. Your membership will update shortly."
            return .restored
        } catch { self.error = AppFailure.describe(error); return .failed(error) }
    }

    func observeTransactions() async {
        for await verification in Transaction.updates {
            guard !Task.isCancelled else { return }
            guard case .verified(let transaction) = verification, productIDs.contains(transaction.productID) else { continue }
            do {
                try await sync(verification.jwsRepresentation)
                await transaction.finish()
            } catch { self.error = AppFailure.describe(error) }
        }
    }

    func reset() {
        status = nil; identifiedUser = nil; registeredUser = nil; error = nil; notice = nil
        if configured { Superwall.shared.reset(); Superwall.shared.subscriptionStatus = .unknown }
    }

    private func sync(_ jws: String) async throws {
        try await client.action("appleBillingActions:syncTransaction", with: ["signedTransaction": jws])
    }
}
