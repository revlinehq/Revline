import ClerkKit
import Combine
@preconcurrency import ConvexMobile
import Foundation
import Observation

@MainActor @Observable
final class AppSession {
    let configuration: AppConfiguration
    let client: ConvexClientWithAuth<String>
    let purchases: PurchaseCoordinator
    var authenticated = false
    var connecting = false
    var connectionError: String?
    var connected = false
    var aiConsentGranted = false
    private var consentNeedsSync = false

    init(configuration: AppConfiguration) {
        self.configuration = configuration
        client = ConvexClientWithAuth(deploymentUrl: configuration.convexURL.absoluteString,
                                      authProvider: ClerkTokenProvider())
        purchases = PurchaseCoordinator(client: client)
    }

    func synchronize(signedIn: Bool) async {
        connectionError = nil
        authenticated = false
        if !signedIn {
            await client.logout()
            connecting = false
            return
        }
        connecting = true
        let result = await client.loginFromCache()
        switch result {
        case .success:
            do {
                let _: String = try await client.mutation("users:store")
                for try await user in client.subscribe(to: "users:current", yielding: AIConsentStatus?.self).values {
                    let localPermission = UserDefaults.standard.bool(forKey: consentCacheKey)
                    aiConsentGranted = user?.aiConsentVersion.map { $0 == 1 } ?? localPermission
                    consentNeedsSync = user?.aiConsentVersion == nil && localPermission
                    break
                }
                authenticated = true
            } catch { connectionError = AppFailure.describe(error) }
        case .failure(let error): connectionError = AppFailure.describe(error)
        }
        connecting = false
    }

    func observeConnection() async {
        for await state in client.watchWebSocketState().values {
            connected = state == .connected
        }
    }

    private var consentCacheKey: String { "revline.aiSharingConsent.v1.\(Clerk.shared.user?.id ?? "signed-out")" }

    func synchronizeAIConsent() async throws {
        if consentNeedsSync { try await setAIConsent(true) }
    }

    func setAIConsent(_ accepted: Bool) async throws {
        do {
            try await client.mutation("users:setAIConsent", with: ["accepted": accepted])
            consentNeedsSync = false
        }
        catch {
            // Older deployments have no consent mutation. Preserve explicit local permission until the shared endpoint ships.
            let message = String(describing: error)
            guard message.contains("users:setAIConsent"), message.contains("Could not find public function") else { throw error }
        }
        UserDefaults.standard.set(accepted, forKey: consentCacheKey)
        aiConsentGranted = accepted
        if !accepted { consentNeedsSync = false }
    }

    func deleteAccount(appleAuthorizationCode: String?) async throws {
        let cacheKey = consentCacheKey
        var arguments: ConvexArguments = ["policyVersion": 1.0, "confirmation": "DELETE"]
        if let appleAuthorizationCode { arguments["appleAuthorizationCode"] = appleAuthorizationCode }
        try await client.action("accountDeletionActions:remove", with: arguments)
        UserDefaults.standard.removeObject(forKey: cacheKey)
        await client.logout()
        try? await Clerk.shared.auth.signOut()
        _ = try? await Clerk.shared.refreshClient()
        aiConsentGranted = false
        authenticated = false
    }

    func signOut() async {
        do { try await Clerk.shared.auth.signOut() }
        catch { connectionError = AppFailure.describe(error) }
    }
}
