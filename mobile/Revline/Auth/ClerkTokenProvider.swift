import ClerkKit
@preconcurrency import ConvexMobile
import Foundation

@MainActor
final class ClerkTokenProvider: AuthProvider {
    typealias T = String
    private var refreshTask: Task<Void, Never>?

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        let token = try await Self.token()
        refreshTask?.cancel()
        refreshTask = Task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(40))
                    try Task.checkCancellation()
                    onIdToken(try await Self.token())
                } catch is CancellationError { return }
                catch { onIdToken(nil) }
            }
        }
        return token
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await login(onIdToken: onIdToken)
    }

    func logout() async throws {
        refreshTask?.cancel()
        refreshTask = nil
    }

    nonisolated func extractIdToken(from authResult: String) -> String { authResult }

    static func token() async throws -> String {
        guard let session = Clerk.shared.session,
              let token = try await session.getToken(.init(template: "convex")) else {
            throw AppFailure("Your session is unavailable. Sign in again.")
        }
        return token
    }
}
