import Combine
@preconcurrency import ConvexMobile
import Foundation

typealias ConvexArguments = [String: (any ConvexEncodable & Sendable)?]

@MainActor
func observeConvex<Value: Decodable & Sendable>(
    _ client: ConvexClient,
    _ name: String,
    arguments: ConvexArguments = [:],
    as type: Value.Type,
    receive: @MainActor (Value) -> Void,
    onError: @MainActor (String) -> Void
) async {
    do {
        for try await value in client.subscribe(to: name, with: arguments, yielding: type).values {
            try Task.checkCancellation()
            receive(value)
        }
    } catch {
        if !Task.isCancelled { onError(AppFailure.describe(error)) }
    }
}
