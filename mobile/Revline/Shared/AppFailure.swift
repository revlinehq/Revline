import Foundation
import ConvexMobile

struct AppFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }

    static func describe(_ error: Error) -> String {
        if case ClientError.ConvexError(let data) = error,
           let value = try? JSONDecoder().decode(JSONValue.self, from: Data(data.utf8)),
           let message = value.string ?? value["message"]?.string {
            return message
        }
        if let failure = error as? AppFailure { return failure.message }
        if error is CancellationError { return "Cancelled." }
        if let urlError = error as? URLError {
            return urlError.code == .notConnectedToInternet
                ? "You’re offline. Reconnect to continue."
                : "The connection was interrupted. Try again."
        }
        return error.localizedDescription
    }
}
