import Foundation

struct ChatMessage: Decodable, Identifiable, Sendable {
    let id: String
    let role: String
    let order: Double
    let stepOrder: Double
    let status: String?
    var parts: [JSONValue]
    var text: String { parts.filter { $0["type"]?.string == "text" }.compactMap { $0["text"]?.string }.joined(separator: "\n\n") }
    var tools: [JSONValue] { parts.filter { $0["type"]?.string?.hasPrefix("tool-") == true } }
}

struct MessagePage: Decodable, Sendable {
    let page: [ChatMessage]
    let isDone: Bool
    let continueCursor: String
    let streams: MessageStreams
}

struct MessageStreams: Decodable, Sendable {
    let kind: String
    let messages: [MessageStream]?
    let deltas: [MessageDelta]?
}

struct MessageStream: Decodable, Sendable {
    let streamId: String
    let order: Double
    let stepOrder: Double
    let status: String
    let format: String?
}

struct MessageDelta: Decodable, Sendable {
    let streamId: String
    let start: Double
    let end: Double
    let parts: [JSONValue]
}
