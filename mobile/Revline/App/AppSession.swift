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

    func signOut() async {
        do { try await Clerk.shared.auth.signOut() }
        catch { connectionError = AppFailure.describe(error) }
    }
}
